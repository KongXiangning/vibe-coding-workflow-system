/** Read-only diagnostics, never authority or a transaction. Logical byte counts
 * use stable UTF-8 JSON, not the size of an object-reference wrapper. Physical
 * counts use file lengths (not allocated disk blocks). No metrics are persisted.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import { readTaskBasisReferenceFromBody, validateVNextRuntimeState } from './kernel';
import { prepareTaskProjection } from './task-projection';
import {
  TaskStore, sha256, stableJson, migrationSemanticModel, taskStoreDefinitionPayload,
  type TaskStoreCurrent, type TaskStoreEvent, type TaskStoreObjectReference,
} from './task-store';

type RecordValue = Record<string, any>;
const isRecord = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const omitted = (v: RecordValue, keys: string[]) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
const bytes = (v: unknown) => v == null ? 0 : Buffer.byteLength(stableJson(v), 'utf8');
const LIMITS = { files: 4096, events: 1024, objects: 512, read_bytes: 8 * 1024 * 1024 } as const;
const LOGICAL_KEYS = ['definition_bytes', 'claim_evidence_bytes', 'pending_review_bytes', 'execution_hot_state_bytes', 'logical_state_bytes'] as const;
type LogicalSizes = Record<typeof LOGICAL_KEYS[number], number>;
type NullableLogicalSizes = Record<typeof LOGICAL_KEYS[number], number | null>;
const nullLogical = (): NullableLogicalSizes => Object.fromEntries(LOGICAL_KEYS.map(k => [k, null])) as NullableLogicalSizes;

export type TaskStorageMetrics = {
  kind: 'task-storage-metrics/v1'; read_only: true; diagnostic_only: true;
  status: 'complete' | 'partial' | 'unavailable'; unit: 'byte';
  source_revision: string; document_id: string; representation: string;
  logical_encoding: 'stable-json-utf8/v1'; logical_fields_overlap: true;
  active_projection_bytes: number;
  definition_bytes: number | null; claim_evidence_bytes: number | null;
  pending_review_bytes: number | null; execution_hot_state_bytes: number | null; logical_state_bytes: number | null;
  task_basis_bytes: number | null; aggregate_total_bytes: number | null;
  external_history_bytes: number | null; committed_material_bytes: number | null;
  physical_breakdown: null | { objects_bytes: number; events_bytes: number; indexes_bytes: number; manifest_bytes: number; other_bytes: number; files: number };
  previous_transaction_delta: {
    status: 'available' | 'partial' | 'unavailable'; reason: string | null;
    event_sequence: number | null; previous_event_sequence: number | null;
    event_type: string | null; operation_kind: string | null; action: string | null; recorded_at: string | null;
    from_source_revision: string | null; to_source_revision: string;
    active_projection_bytes: number | null; task_basis_bytes: number | null;
    definition_bytes: number | null; claim_evidence_bytes: number | null;
    pending_review_bytes: number | null; execution_hot_state_bytes: number | null; logical_state_bytes: number | null;
    committed_material_bytes: number | null;
    aggregate_total_bytes: null;
  };
  coverage: { event_history: 'complete' | 'partial' | 'unavailable'; physical_inventory: 'complete' | 'unavailable';
    limits: typeof LIMITS; notes: string[] };
};

function unavailable(code: string): never { throw new Error(code); }
function codeOf(error: unknown): string {
  const code = error instanceof Error ? error.message.split(':', 1)[0]! : '';
  return /^[A-Z][A-Z0-9_]+$/u.test(code) ? code : 'MEASUREMENT_UNAVAILABLE';
}
function logicalSizes(current: TaskStoreCurrent): LogicalSizes {
  // Both the current task and historical wire input use the canonical defaults.
  // Histories are outside this logical view: do not hydrate or validate them here.
  // Unsupported historical state throws only into the diagnostic attempt wrapper.
  const runtimeState = validateVNextRuntimeState(omitted(current.runtimeState, ['execution_log', 'applied_proposals']), { storeBackedHistory: true });
  const normalizedCurrent = { ...current, runtimeState };
  const normalized = migrationSemanticModel(normalizedCurrent) as RecordValue;
  const runtime = normalized.runtime_state;
  return {
    definition_bytes: bytes(taskStoreDefinitionPayload(normalizedCurrent, 'task-definition/v2')),
    claim_evidence_bytes: bytes(runtime.claim_evidence),
    pending_review_bytes: bytes(runtime.pending_review_result),
    execution_hot_state_bytes: bytes(omitted(runtime, ['claim_evidence', 'pending_review_result'])),
    logical_state_bytes: bytes(runtime),
  };
}

/** This API receives an already read canonical task. Optional diagnostics must
 * not turn a successful validation into a blocked task, initialize a store, or
 * consume a receipt. Existing canonical integrity validation remains separate.
 */
export function taskStorageMetrics(rootInput: string, current: TaskStoreCurrent): TaskStorageMetrics {
  const result: TaskStorageMetrics = {
    kind: 'task-storage-metrics/v1', read_only: true, diagnostic_only: true, status: 'complete', unit: 'byte',
    source_revision: current.sourceTuple.revision, document_id: current.sourceTuple.document_id,
    representation: String((current.frontmatter?.task_store as RecordValue | undefined)?.format ?? 'legacy-inline'),
    logical_encoding: 'stable-json-utf8/v1', logical_fields_overlap: true,
    active_projection_bytes: Buffer.byteLength(current.raw, 'utf8'), ...nullLogical(),
    task_basis_bytes: null, aggregate_total_bytes: null, external_history_bytes: null, committed_material_bytes: null, physical_breakdown: null,
    previous_transaction_delta: { status: 'unavailable', reason: 'NO_PREVIOUS_EVENT', event_sequence: null,
      previous_event_sequence: null, event_type: null, operation_kind: null, action: null, recorded_at: null,
      from_source_revision: null, to_source_revision: current.sourceTuple.revision,
      active_projection_bytes: null, task_basis_bytes: null, ...nullLogical(), committed_material_bytes: null, aggregate_total_bytes: null },
    coverage: { event_history: 'unavailable', physical_inventory: 'unavailable', limits: { ...LIMITS },
      notes: ['LOGICAL_FIELDS_OVERLAP_DO_NOT_SUM', 'HISTORICAL_FILESYSTEM_TOTAL_NOT_RETAINED'] },
  };
  const note = (message: string) => { if (!result.coverage.notes.includes(message)) result.coverage.notes.push(message); result.status = 'partial'; };
  const attempt = <T>(read: () => T): T | null => { try { return read(); } catch (error) { note(codeOf(error)); return null; } };
  const logical = attempt(() => logicalSizes(current));
  if (logical) Object.assign(result, logical);
  const root = path.resolve(rootInput);
  let readBytes = 0;
  let objectReads = 0;
  const safeStat = (file: string): fs.Stats => {
    const relative = path.relative(root, file);
    if (relative.split(path.sep).includes('..') || path.isAbsolute(relative)) return unavailable('METRICS_UNSAFE_PATH');
    let cursor = root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) return unavailable('METRICS_SYMLINK');
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return unavailable('METRICS_NOT_REGULAR_FILE');
    return stat;
  };
  const chargeRead = (file: string) => {
    readBytes += safeStat(file).size;
    if (readBytes > LIMITS.read_bytes) unavailable('METRICS_READ_BUDGET');
  };
  // undefined means a malformed/unreadable reference; null alone means no link.
  const basis = attempt(() => ({ reference: readTaskBasisReferenceFromBody(current.body) }))?.reference;
  result.task_basis_bytes = basis === undefined ? null : basis === null ? 0 : attempt(() => {
    const file = path.resolve(root, basis.path.replace(/\\/gu, '/'));
    chargeRead(file);
    const content = fs.readFileSync(file);
    if (sha256(content) !== basis.revision) return unavailable('METRICS_BASIS_REVISION_MISMATCH');
    return content.length;
  });

  let verifySample: (() => void) | undefined;
  attempt(() => {
    const store = TaskStore.forCurrent(root, current);
    const readManifest = () => {
      if (!fs.existsSync(store.paths.manifest)) return null;
      safeStat(store.paths.manifest);
      return fs.readFileSync(store.paths.manifest, 'utf8');
    };
    // Capture the comparison baseline BEFORE the independently parsed manifest.
    // A commit between those reads must not become the new sampling baseline.
    const manifestBytes = readManifest();
    const sourceStat = safeStat(current.filePath);
    const signature = (s: fs.Stats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    verifySample = () => {
      if (store.hasPendingCommit || readManifest() !== manifestBytes
        || signature(safeStat(current.filePath)) !== signature(sourceStat)) unavailable('METRICS_SAMPLE_CHANGED');
    };
    chargeRead(current.filePath);
    if (sha256(fs.readFileSync(current.filePath)) !== current.sourceTuple.revision) return unavailable('METRICS_SAMPLE_CHANGED');
    const manifest = store.manifest;
    verifySample();
    if (!manifest) { note('NO_COMMITTED_AGGREGATE'); return; }
    if (manifest.head.source_revision !== current.sourceTuple.revision) return unavailable('METRICS_SAMPLE_CHANGED');
    const objects = new Map<string, ReturnType<TaskStore['readObject']>>();
    const getObject = (ref: TaskStoreObjectReference) => {
      if (!ref || !/^[a-f0-9]{64}$/u.test(ref.sha256)) return unavailable('METRICS_REFERENCE_INVALID');
      let object = objects.get(ref.sha256);
      if (!object) {
        if (++objectReads > LIMITS.objects) return unavailable('METRICS_OBJECT_BUDGET');
        chargeRead(path.join(store.paths.objects, `${ref.sha256}.json`));
        object = store.readObject(ref, ref.object_type); // hash, identity and committed membership
        objects.set(ref.sha256, object);
      }
      return object;
    };
    const eventFile = (event: Pick<TaskStoreEvent, 'sequence' | 'event_hash'>) => path.join(store.paths.events, `${String(event.sequence).padStart(12, '0')}-${event.event_hash}.json`);
    const getEvent = (sequence: number, event_hash: string) => {
      chargeRead(eventFile({ sequence, event_hash }));
      return store.readEvent({ sequence, event_hash });
    };

    // Inventory reads only file metadata, never scans product code or follows
    // symlinks. It may include orphan/prepared material; committed totals below
    // are computed separately, and truncated inventory is never a full total.
    const inventory = attempt(() => {
      const sizes = new Map<string, number>(); let visits = 0;
      const walk = (directory: string) => {
        const dir = fs.opendirSync(directory);
        try {
          for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
            if (++visits > LIMITS.files) return unavailable('METRICS_INVENTORY_BUDGET');
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) return unavailable('METRICS_SYMLINK');
            if (entry.isDirectory()) walk(file);
            else sizes.set(path.relative(store.paths.directory, file).split(path.sep).join('/'), safeStat(file).size);
          }
        } finally { dir.closeSync(); }
      };
      walk(store.paths.directory);
      const group = { objects_bytes: 0, events_bytes: 0, indexes_bytes: 0, manifest_bytes: 0, other_bytes: 0, files: sizes.size };
      for (const [name, size] of sizes) {
        const key = name.startsWith('objects/') ? 'objects_bytes' : name.startsWith('events/') ? 'events_bytes'
          : name.startsWith('indexes/') ? 'indexes_bytes' : name === 'manifest.json' ? 'manifest_bytes' : 'other_bytes';
        group[key] += size;
      }
      result.physical_breakdown = group;
      result.aggregate_total_bytes = group.objects_bytes + group.events_bytes + group.indexes_bytes + group.manifest_bytes + group.other_bytes;
      result.coverage.physical_inventory = 'complete';
      return sizes;
    });
    const events: TaskStoreEvent[] = [];
    // Resolve the current pair before optional full-history accounting so a
    // large audit chain cannot spend the budget needed for the useful delta.
    attempt(() => {
      if (manifest.head.event_sequence && manifest.head.event_hash) {
        const head = getEvent(manifest.head.event_sequence, manifest.head.event_hash);
        events.push(head);
        if (head.sequence > 1 && head.previous_event_hash) events.push(getEvent(head.sequence - 1, head.previous_event_hash));
      }
    });
    const finishHistory = () => {
      if (result.coverage.event_history === 'complete') return;
      let sequence = events.length ? events[events.length - 1]!.sequence - 1 : manifest.head.event_sequence;
      let hash = events.length ? events[events.length - 1]!.previous_event_hash : manifest.head.event_hash;
      while (sequence > 0 && hash) {
        if (events.length >= LIMITS.events) return unavailable('METRICS_EVENT_BUDGET');
        const event = getEvent(sequence, hash);
        events.push(event); sequence--; hash = event.previous_event_hash;
      }
      if (sequence !== 0 || hash !== null) return unavailable('METRICS_EVENT_CHAIN_INCOMPLETE');
      result.coverage.event_history = 'complete';
    };
    const head = events[0]; const previousEvent = events[1];
    const delta = result.previous_transaction_delta;
    if (!head && manifest.head.event_sequence > 0) delta.reason = 'HEAD_EVENT_UNAVAILABLE';
    else if (head && head.sequence > 1 && !previousEvent) delta.reason = 'PREVIOUS_EVENT_UNAVAILABLE';
    if (head) {
      Object.assign(delta, { event_sequence: head.sequence, previous_event_sequence: previousEvent?.sequence ?? null,
        event_type: head.event_type, operation_kind: head.operation_kind, recorded_at: head.metadata.recorded_at,
        from_source_revision: head.source_revision });
      attempt(() => {
        const ref = head.object_refs.proposal;
        const value = ref && typeof ref !== 'string' ? getObject(ref).payload as RecordValue : head.transaction?.proposal as RecordValue;
        delta.action = typeof value?.semantic_delta?.action === 'string' ? value.semantic_delta.action : null;
      });
    }
    const currentRefs = new Set<string>();
    // Metric-only resolution of the existing immutable v3 schema. This never
    // supplies an executable task; unknown historical shapes yield null metrics.
    const resolveV3 = (definitionRef: TaskStoreObjectReference, stateRef: TaskStoreObjectReference,
      sourceRevision: string, visited: Set<string>): TaskStoreCurrent => {
      const payload = (ref: TaskStoreObjectReference): any => { visited.add(ref.sha256); return getObject(ref).payload; };
      const value = (v: any): any => {
        if (!isRecord(v)) return unavailable('METRICS_HISTORICAL_SHAPE_UNSUPPORTED');
        if ('value' in v) return v.value;
        const resolved = payload(v.ref);
        return v.ref.object_type === 'other' ? resolved.value : resolved;
      };
      const definition = payload(definitionRef); const state = payload(stateRef);
      if (definition.kind !== 'vnext-active-definition/v1' || state.kind !== 'vnext-active-state/v1'
        || stableJson(state.definition) !== stableJson(definitionRef)) return unavailable('METRICS_HISTORICAL_SHAPE_UNSUPPORTED');
      const runtime = Object.fromEntries(Object.entries(state.runtime).map(([k, v]) => [k, value(v)]));
      if (Array.isArray(definition.claim_definitions)) runtime.claim_evidence = definition.claim_definitions.map((v: unknown, i: number) => {
        const claim = value(v); const progress = state.claim_states[i];
        if (claim.claim_id !== progress?.claim_id || claim.slots.length !== progress.slots.length) return unavailable('METRICS_HISTORICAL_SHAPE_UNSUPPORTED');
        return { ...claim, slots: claim.slots.map((slot: RecordValue, j: number) => {
          if (slot.slot_id !== progress.slots[j]?.slot_id) return unavailable('METRICS_HISTORICAL_SHAPE_UNSUPPORTED');
          return { ...slot, ...Object.fromEntries(Object.entries(progress.slots[j].fields).map(([k, v]) => [k, value(v)])) };
        }) };
      });
      const body = definition.sections.map((section: RecordValue) => 'dynamic' in section ? value(state.dynamic_body[section.dynamic]) : value(section.text)).join('');
      const binding = { schema_version: 1, kind: 'vnext-current-task-store-binding', format: 'compact-v3',
        manifest_path: `${store.paths.relativeRoot}/manifest.json`, history: { execution_log: 'task-store', applied_proposals: 'task-store' },
        projection: { definition: definitionRef, state: stateRef } };
      const frontmatter = { ...definition.frontmatter, task_store: binding, runtime_state: runtime };
      return { ...current, body, frontmatter, runtimeState: runtime, raw: '',
        sourceTuple: { ...current.sourceTuple, revision: sourceRevision, task_id: runtime.task_id, task_slug: runtime.task_slug } };
    };
    const currentClosure = result.representation === 'compact-v3'
      ? attempt(() => resolveV3(manifest.object_refs.definition, manifest.object_refs.state, current.sourceTuple.revision, currentRefs)) : null;

    if (head && previousEvent && previousEvent.resulting_source_revision === head.source_revision) {
      const before = attempt(() => {
        // Prefer the exact migration preimage, if available. Legacy states store
        // report digests, so do not invent missing reports from those snapshots.
        const ref = head.object_refs['legacy-locator-alias'] ?? (previousEvent.sequence === 1 ? manifest.object_refs.legacy_source : undefined);
        if (ref && typeof ref !== 'string') {
          const p = getObject(ref).payload as RecordValue;
          if (p.source_revision === head.source_revision && typeof p.raw_base64 === 'string') {
            const raw = Buffer.from(p.raw_base64, 'base64').toString('utf8');
            if (sha256(raw) !== head.source_revision) return unavailable('METRICS_HISTORY_HASH_MISMATCH');
            const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
            if (!m) return unavailable('METRICS_HISTORICAL_SHAPE_UNSUPPORTED');
            const fm = parse(m[1]!) as RecordValue;
            if (fm.document_id !== current.sourceTuple.document_id) return unavailable('METRICS_HISTORY_IDENTITY_MISMATCH');
            if (fm.task_store?.format !== 'compact-v3') return { ...current, raw, frontmatter: fm,
              body: raw.slice(m[0].length), runtimeState: fm.runtime_state, sourceTuple: { ...current.sourceTuple, revision: head.source_revision } };
            const restored = resolveV3(previousEvent.object_refs.definition as TaskStoreObjectReference, previousEvent.object_refs.state as TaskStoreObjectReference, head.source_revision, new Set());
            if (stableJson(fm.task_store.projection) !== stableJson((restored.frontmatter!.task_store as RecordValue).projection)) return unavailable('METRICS_HISTORY_IDENTITY_MISMATCH');
            return { ...restored, raw };
          }
        }
        return resolveV3(previousEvent.object_refs.definition as TaskStoreObjectReference, previousEvent.object_refs.state as TaskStoreObjectReference, head.source_revision, new Set());
      });
      if (before && logical) {
        const old = logicalSizes(before);
        for (const key of LOGICAL_KEYS) delta[key] = logical[key] - old[key];
        let oldRaw = before.raw;
        if (!oldRaw) attempt(() => {
          const expanded = `---\n${stringify(before.frontmatter).trimEnd()}\n---\n${before.body}`;
          const candidate = prepareTaskProjection(expanded).content;
          // Re-rendered lengths are exact ONLY if the historical physical hash
          // matches. An older emitter is not silently treated as today's bytes.
          if (sha256(candidate) === head.source_revision) oldRaw = candidate;
        });
        if (oldRaw) delta.active_projection_bytes = result.active_projection_bytes - Buffer.byteLength(oldRaw, 'utf8');
        const priorBasis = readTaskBasisReferenceFromBody(before.body);
        if (basis !== undefined && stableJson(priorBasis) === stableJson(basis) && result.task_basis_bytes !== null) delta.task_basis_bytes = 0;
        else if (priorBasis === null && result.task_basis_bytes !== null) delta.task_basis_bytes = result.task_basis_bytes;
        else if (priorBasis && result.task_basis_bytes !== null) attempt(() => {
          attempt(finishHistory);
          for (const event of events.slice(1)) for (const ref of Object.values(event.object_refs)) {
            if (!ref || typeof ref === 'string' || ref.object_type !== 'task-basis') continue;
            const p = getObject(ref).payload as RecordValue;
            if (p.path !== priorBasis.path || p.basis_revision !== priorBasis.revision || typeof p.raw_base64 !== 'string') continue;
            const raw = Buffer.from(p.raw_base64, 'base64');
            if (sha256(raw) === priorBasis.revision) { delta.task_basis_bytes = result.task_basis_bytes! - raw.length; return; }
          }
        });
        delta.status = delta.active_projection_bytes !== null && delta.task_basis_bytes !== null ? 'available' : 'partial';
        delta.reason = delta.status === 'available' ? null : 'HISTORICAL_PHYSICAL_BYTES_UNAVAILABLE';
      } else delta.reason = 'HISTORICAL_LOGICAL_MATERIAL_UNAVAILABLE';
    } else if (head && previousEvent) delta.reason = 'EVENT_SOURCE_DISCONTINUITY';

    attempt(finishHistory);
    if (result.coverage.event_history !== 'complete' && events.length) result.coverage.event_history = 'partial';
    if (inventory && result.coverage.event_history === 'complete') attempt(() => {
      const known = new Set<string>(); let committed = 0; let beforeHead = 0;
      const sizeOf = (name: string) => inventory.get(name) ?? unavailable('METRICS_COMMITTED_FILE_MISSING');
      for (const event of [...events].reverse()) {
        beforeHead = committed;
        for (const ref of Object.values(event.object_refs)) {
          const hash = typeof ref === 'string' ? ref : ref?.sha256;
          if (hash && !known.has(hash)) { known.add(hash); committed += sizeOf(`objects/${hash}.json`); }
        }
        const length = sizeOf(`events/${path.basename(eventFile(event))}`);
        committed += length;
      }
      result.committed_material_bytes = committed;
      if (previousEvent) delta.committed_material_bytes = committed - beforeHead;
      if (currentClosure && currentRefs.size) {
        let active = 0;
        for (const hash of currentRefs) {
          if (!known.has(hash)) return unavailable('METRICS_CURRENT_MATERIAL_NOT_COMMITTED');
          active += sizeOf(`objects/${hash}.json`);
        }
        result.external_history_bytes = committed - active; // non-selected committed objects + events, counted once
      } else note('LEGACY_CURRENT_MATERIAL_CLOSURE_UNAVAILABLE');
    });
  });
  // Also check after a partial diagnostic failure; an early return/throw must
  // not bypass concurrent-head detection. No locks, writes or automatic retries.
  if (verifySample) try { verifySample(); } catch (error) {
    note(codeOf(error));
    note('METRICS_SAMPLE_CHANGED');
  }
  const delta = result.previous_transaction_delta;
  if (delta.previous_event_sequence !== null) {
    const fields = [...LOGICAL_KEYS, 'active_projection_bytes', 'task_basis_bytes', 'committed_material_bytes'] as const;
    const available = fields.filter(key => delta[key] !== null).length;
    delta.status = available === fields.length ? 'available' : available ? 'partial' : 'unavailable';
    if (delta.status === 'available') delta.reason = null;
    else if (delta.reason === null) delta.reason = 'COMMITTED_MATERIAL_COVERAGE_INCOMPLETE';
  }
  if (result.coverage.event_history !== 'complete' || result.coverage.physical_inventory !== 'complete'
    || (result.previous_transaction_delta.reason !== 'NO_PREVIOUS_EVENT' && result.previous_transaction_delta.status !== 'available')) result.status = 'partial';
  if (result.coverage.notes.includes('METRICS_SAMPLE_CHANGED')) {
    result.status = 'unavailable';
    Object.assign(result, nullLogical());
    result.task_basis_bytes = result.aggregate_total_bytes = result.external_history_bytes = result.committed_material_bytes = null;
    result.coverage.event_history = result.coverage.physical_inventory = 'unavailable';
    // Keep only the supplied source identity/physical length, not mixed counters.
    result.physical_breakdown = null; result.previous_transaction_delta = { ...result.previous_transaction_delta,
      status: 'unavailable', reason: 'METRICS_SAMPLE_CHANGED', ...nullLogical(), active_projection_bytes: null, task_basis_bytes: null, committed_material_bytes: null };
  }
  return result;
}
