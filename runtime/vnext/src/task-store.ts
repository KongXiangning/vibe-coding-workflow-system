/**
 * Content-addressed task aggregate storage.
 *
 * The legacy CURRENT_TASK representation remains the compatibility source for
 * the current Runtime.  This module stores the same task as a small aggregate:
 * immutable objects, immutable transaction events, and rebuildable indexes.
 * It deliberately has no dependency on kernel.ts so the storage boundary can
 * be used by both the Runtime and the read-only context projector.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import { persistLegacyReviewPreimages } from './review-preimage-store';
import { ACTIVE_TASK_FORMAT, expandTaskProjection, prepareTaskProjection, persistTaskProjection, projectionDigest, type PreparedTaskContent } from './task-projection';

export const TASK_STORE_SCHEMA_VERSION = 1 as const;
/**
 * The envelope schema remains v1 for compatibility.  The format marker is
 * separate so an old sidecar keeps its v1 definition-hash algorithm until an
 * explicit storage migration opts it into the compact representation.
 */
export const TASK_STORE_FORMAT_VERSION = 2 as const;
export const TASK_DEFINITION_REVISION_V1 = 'task-definition/v1' as const;
export const TASK_DEFINITION_REVISION_V2 = 'task-definition/v2' as const;
export const TASK_STATE_REVISION_V1 = 'task-state/v1' as const;
export const TASK_STORE_KIND = 'vnext-task-store-manifest' as const;
export const TASK_OBJECT_KIND = 'vnext-task-object' as const;
export const TASK_EVENT_KIND = 'vnext-task-event' as const;
export const TASK_STORE_MANIFEST_FILE = 'manifest.json' as const;
export const TASK_STORE_DEFAULT_PAGE_BYTES = 16 * 1024;
export const TASK_STORE_MAX_PAGE_BYTES = 64 * 1024;

const DOCUMENT_ID = /^doc-[a-f0-9]{24}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EVENT_FILE = /^(\d+)-([a-f0-9]{64})\.json$/u;
const TASK_STORE_OBJECT_TYPES = new Set<TaskStoreObjectType>([
  'definition', 'state', 'current-snapshot', 'legacy-current-task', 'task-basis',
  'proposal', 'result', 'semantic-delta', 'transaction', 'execution-log-entry',
  'evidence-report', 'review-receipt', 'history-material', 'other',
]);

export type TaskStoreErrorCode =
  | 'TASK_STORE_PATH_INVALID'
  | 'TASK_STORE_MANIFEST_INVALID'
  | 'TASK_STORE_OBJECT_INVALID'
  | 'TASK_STORE_OBJECT_MISSING'
  | 'TASK_STORE_OBJECT_NOT_COMMITTED'
  | 'TASK_STORE_OBJECT_CONFLICT'
  | 'TASK_STORE_EVENT_INVALID'
  | 'TASK_STORE_EVENT_MISSING'
  | 'TASK_STORE_EVENT_NOT_COMMITTED'
  | 'TASK_STORE_EVENT_CONFLICT'
  | 'TASK_STORE_IDENTITY_CONFLICT'
  | 'TASK_STORE_SOURCE_CONFLICT'
  | 'TASK_STORE_INDEX_INVALID'
  | 'TASK_STORE_MIGRATION_SOURCE_STALE';

export class TaskStoreError extends Error {
  readonly code: TaskStoreErrorCode;

  constructor(code: TaskStoreErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'TaskStoreError';
    this.code = code;
  }
}

export type TaskStoreCurrent = {
  filePath: string;
  relativePath: string;
  raw: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  runtimeState: Record<string, unknown>;
  sourceTuple: {
    path: string;
    revision: string;
    document_id: string;
    task_id: string;
    task_slug: string;
    workflow_status: string;
    lifecycle_state: string;
    active_step_id: string;
    active_step_status: string;
    finding_queue_revision: number;
    resume_requires_review: boolean;
    resume_review_reasons: string[];
  };
};

export type TaskStoreObjectType =
  | 'definition'
  | 'state'
  | 'current-snapshot'
  | 'legacy-current-task'
  | 'task-basis'
  | 'proposal'
  | 'result'
  | 'semantic-delta'
  | 'transaction'
  | 'execution-log-entry'
  | 'evidence-report'
  | 'review-receipt'
  | 'history-material'
  | 'other';

export type TaskStoreObject = {
  schema_version: typeof TASK_STORE_SCHEMA_VERSION;
  kind: typeof TASK_OBJECT_KIND;
  object_type: TaskStoreObjectType;
  document_id: string;
  payload: unknown;
};

export type TaskStoreObjectReference = {
  sha256: string;
  object_type: TaskStoreObjectType;
};

export type TaskStoreEvent = {
  schema_version: typeof TASK_STORE_SCHEMA_VERSION;
  kind: typeof TASK_EVENT_KIND;
  document_id: string;
  sequence: number;
  event_id: string;
  event_type: 'legacy-import' | 'transaction' | 'external-current-sync' | 'storage-migration';
  operation_kind: string;
  idempotency_key: string | null;
  proposal_digest: string | null;
  source_revision: string;
  resulting_source_revision: string;
  definition_revision: string;
  state_revision: string;
  previous_event_hash: string | null;
  object_refs: Record<string, TaskStoreObjectReference | string | null>;
  /**
   * A transaction points at its one authoritative proposal/result objects.
   * Older v1 events may still contain inline payloads; new events never copy
   * large semantic deltas into the event envelope.
   */
  transaction?: {
    proposal?: unknown;
    result?: unknown;
    semantic_delta?: unknown;
    execution_log_entries?: unknown[];
    applied_proposals?: unknown[];
  };
  metadata: {
    committed: boolean;
    status: string;
    message?: string;
    code?: string;
    recorded_at: string;
  };
  event_hash: string;
};

export type TaskStoreIndexEntry = {
  idempotency_key: string;
  operation_kind: string;
  proposal_digest: string;
  source_revision: string;
  event_path: string;
  event_id: string;
  sequence: number;
  legacy: boolean;
};

export type TaskStoreManifest = {
  schema_version: typeof TASK_STORE_SCHEMA_VERSION;
  kind: typeof TASK_STORE_KIND;
  document_id: string;
  task_id: string;
  task_slug: string;
  current_task_path: string;
  storage_root: string;
  created_at: string;
  updated_at: string;
  head: {
    source_revision: string;
    definition_revision: string;
    state_revision: string;
    event_sequence: number;
    event_id: string | null;
    event_hash: string | null;
    event_range: { first: number | null; last: number | null };
  };
  object_refs: {
    definition: TaskStoreObjectReference;
    state: TaskStoreObjectReference;
    current_snapshot: TaskStoreObjectReference;
    legacy_source?: TaskStoreObjectReference;
  };
  counts: {
    events: number;
    objects: number;
    idempotency_entries: number;
  };
  compatibility: {
    legacy_current_task: true;
    hot_window_is_cache: true;
    full_history_persistent: true;
  };
  storage_format: 'vnext-task-store/v1' | 'vnext-task-store/v2';
  definition_revision_algorithm: typeof TASK_DEFINITION_REVISION_V1 | typeof TASK_DEFINITION_REVISION_V2;
  state_revision_algorithm: typeof TASK_STATE_REVISION_V1;
  current_representation: 'legacy-inline' | 'compact-v2' | 'compact-v3';
};

export type TaskStorePaths = {
  root: string;
  workflowHome: string;
  documentId: string;
  relativeRoot: string;
  directory: string;
  objects: string;
  events: string;
  indexes: string;
  manifest: string;
  pending: string;
  idempotencyIndex: string;
  legacyIdempotencyIndex: string;
  eventIndex: string;
  legacyEventIndex: string;
};

export type TaskStoreCommitInput = {
  before: TaskStoreCurrent;
  after: TaskStoreCurrent;
  proposal: unknown;
  result: {
    status: string;
    committed: boolean;
    operation_kind?: string;
    idempotency_key?: string;
    message?: string;
    code?: string;
  };
  recorded_at?: string;
};

export type TaskStoreIdempotencyMatch = TaskStoreIndexEntry & { event: TaskStoreEvent };

type TaskStorePending = {
  schema_version: 1;
  kind: 'vnext-task-store-pending-commit';
  document_id: string;
  sequence: number;
  source_revision: string;
  resulting_source_revision: string;
  idempotency_key: string | null;
  proposal_digest: string | null;
  phase?: 'prepared' | 'current-published' | 'store-published';
  proposal?: unknown;
  result?: unknown;
  write_targets?: string[];
  write_set?: TaskStorePendingWrite[];
  /**
   * Exact transient recovery material.  It is removed with the pending
   * marker after publication; it is not part of the retained event history.
   * Keeping the rendered bytes and state here lets a restart finish one
   * already-approved commit without re-running the product operation.
   */
  before_raw?: string;
  after_raw?: string;
  before_runtime_state?: unknown;
  after_runtime_state?: unknown;
  execution_log_entries?: unknown[];
  applied_proposals?: unknown[];
  previous_manifest_head?: { source_revision: string; event_sequence: number; event_hash: string | null };
};

export type TaskStorePendingWrite = {
  path: string;
  before_content: string | null;
  after_content: string | null;
};

export type TaskStoreCommitIntent = {
  before: TaskStoreCurrent;
  after_source_revision: string;
  proposal: unknown;
  result?: TaskStoreCommitInput['result'];
  write_targets: string[];
  after?: TaskStoreCurrent;
  write_set?: TaskStorePendingWrite[];
};

export type TaskStoreValidationReport = {
  status: 'valid' | 'invalid';
  validation_scope: 'aggregate-and-full-history';
  document_id: string;
  manifest_path: string;
  verified_objects: number;
  verified_events: number;
  verified_idempotency_entries: number;
  errors: string[];
};

export type TaskStoreCurrentValidationReport = {
  status: 'valid' | 'invalid' | 'unavailable';
  validation_scope: 'current-aggregate';
  document_id: string;
  manifest_path: string;
  verified_objects: number;
  verified_head_event: boolean;
  errors: string[];
};

export type TaskStoreMeasure = {
  document_id: string;
  root: string;
  total_bytes: number;
  files: number;
  objects_bytes: number;
  events_bytes: number;
  indexes_bytes: number;
  manifest_bytes: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function digest(value: unknown): string {
  return sha256(stableJson(value));
}

function assertDocumentId(value: string): void {
  if (!DOCUMENT_ID.test(value)) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `document_id is invalid: ${value}`);
}

function normalizeRelative(value: string, label: string): string {
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized) || normalized.split('/').includes('..') || /[\0\r\n]/u.test(normalized)) {
    throw new TaskStoreError('TASK_STORE_PATH_INVALID', `${label} must be a safe repository-relative path.`);
  }
  return normalized;
}

function workflowHomeForRoot(root: string): string {
  const profilePath = path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml');
  if (!fs.existsSync(profilePath)) return 'docs/workflow';
  try {
    const parsed = parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
    const paths = record(parsed?.paths) ? parsed.paths : {};
    const value = typeof paths.workflow_home === 'string' ? paths.workflow_home.trim() : 'docs/workflow';
    return value ? normalizeRelative(value, 'workflow_home').replace(/\/$/u, '') : '';
  } catch (error) {
    throw new TaskStoreError('TASK_STORE_PATH_INVALID', `PROJECT_PROFILE.yaml cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function taskStorePaths(rootInput: string, documentId: string): TaskStorePaths {
  const root = path.resolve(rootInput);
  assertDocumentId(documentId);
  const workflowHome = workflowHomeForRoot(root);
  const relativeRoot = normalizeRelative(path.posix.join(workflowHome, 'task-data', documentId), 'task store root');
  assertNoSymlink(root, relativeRoot);
  const directory = path.join(root, ...relativeRoot.split('/'));
  const objects = path.join(directory, 'objects');
  const events = path.join(directory, 'events');
  const indexes = path.join(directory, 'indexes');
  return {
    root,
    workflowHome,
    documentId,
    relativeRoot,
    directory,
    objects,
    events,
    indexes,
    manifest: path.join(directory, TASK_STORE_MANIFEST_FILE),
    pending: path.join(indexes, 'pending.json'),
    // Idempotency entries are append-only facts.  The reader accepts the
    // original JSON-array form as a compatibility fallback, while new stores
    // avoid rewriting the entire key index on every commit.
    idempotencyIndex: path.join(indexes, 'idempotency.jsonl'),
    legacyIdempotencyIndex: path.join(indexes, 'idempotency.json'),
    // This is a rebuildable append journal rather than a canonical JSON
    // array.  Appending one bounded index entry avoids rewriting the entire
    // event index for every commit; readers still use the event files as the
    // authority and can rebuild this journal at any time.
    eventIndex: path.join(indexes, 'events.jsonl'),
    legacyEventIndex: path.join(indexes, 'events.json'),
  };
}

function relativePath(root: string, value: string): string {
  const relative = path.relative(root, value).replace(/\\/gu, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new TaskStoreError('TASK_STORE_PATH_INVALID', `path escapes project root: ${value}`);
  }
  return relative;
}

function assertNoSymlink(root: string, relative: string): void {
  let cursor = path.resolve(root);
  for (const part of relative.split('/').filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `task store path traverses a symbolic link: ${relative}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function atomicWrite(filePath: string, content: string, sync = true): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, content, 'utf8');
    if (sync) fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filePath);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function writeJson(filePath: string, value: unknown, sync = true): void {
  atomicWrite(filePath, `${stableJson(value)}\n`, sync);
}

/**
 * Write pre-commit immutable material directly to its content-addressed
 * filename. The manifest is the aggregate commit point: if a process exits
 * before publication, a partial file is an uncommitted orphan and is repaired
 * on the next attempt. Every referenced object/event is still digest-checked
 * on read, so a pre-commit fragment can never be accepted as committed data.
 */
function writePrecommitFile(filePath: string, content: string, committed: () => boolean, conflictCode: TaskStoreErrorCode, label: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) return;
    if (committed()) throw new TaskStoreError(conflictCode, `${label} has different bytes after it was committed.`);
    fs.rmSync(filePath, { force: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${filePath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function copyWithout<T extends Record<string, unknown>>(value: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/**
 * Review baselines are immutable raw blobs, not canonical task-state data.
 * Keep this normalization local to the storage boundary so legacy inline
 * tasks remain readable while every new state/snapshot projection is compact.
 */
function withoutInlineReviewPreimageContent(value: Record<string, unknown>): Record<string, unknown> {
  const normalized = structuredClone(value) as Record<string, unknown>;
  const coverage = record(normalized.review_coverage) ? normalized.review_coverage : null;
  if (coverage && Array.isArray(coverage.preimages)) {
    coverage.preimages = coverage.preimages.map(item => record(item) ? copyWithout(item, ['content_base64']) : item);
  }
  return normalized;
}

function markdownSections(body: string): Array<{ title: string; text: string }> {
  const normalized = body.replace(/\r\n?/gu, '\n');
  const headings = [...normalized.matchAll(/^##\s+(.+?)\s*$/gmu)];
  return headings.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < headings.length ? (headings[index + 1]!.index ?? normalized.length) : normalized.length;
    return { title: match[1]!.trim(), text: normalized.slice(start, end).replace(/^\n/u, '').trimEnd() };
  });
}

function slotDefinitionV1(slot: Record<string, unknown>): Record<string, unknown> {
  return copyWithout(slot, ['report', 'prerequisite_receipt']);
}

function slotDefinitionV2(slot: Record<string, unknown>): Record<string, unknown> {
  // disposition/evidence_refs are execution state.  Including either in the
  // definition digest made a normal result write look like a replan and
  // caused context reuse to miss the intended definition version.
  return copyWithout(slot, ['disposition', 'evidence_refs', 'report', 'prerequisite_receipt', 'user_decision']);
}

function definitionSections(current: TaskStoreCurrent, includeDynamicSections: boolean): Array<{ title: string; text: string }> {
  const dynamicTitles = new Set([
    '任务信息', 'Task Information',
    '执行记录', 'Execution Log',
    '审查问题队列', 'Review Queue',
    '传播治理记录', 'Propagation Governance',
  ]);
  return markdownSections(current.body)
    .filter(section => includeDynamicSections || !dynamicTitles.has(section.title))
    .map(section => ({ title: section.title, text: section.text }));
}

function claimDefinitionPayload(current: TaskStoreCurrent, version: 1 | 2): unknown[] {
  const state = current.runtimeState;
  return Array.isArray(state.claim_evidence)
    ? state.claim_evidence.map(item => {
      if (!record(item)) return item;
      return {
        ...copyWithout(item, ['slots']),
        slots: Array.isArray(item.slots) ? item.slots.filter(record).map(slot => version === 1 ? slotDefinitionV1(slot) : slotDefinitionV2(slot)) : [],
      };
    })
    : [];
}

function definitionPayloadV1(current: TaskStoreCurrent): Record<string, unknown> {
  const sections = markdownSections(current.body)
    .filter(section => !['任务信息', 'Task Information', '执行记录', 'Execution Log'].includes(section.title))
    .map(section => ({ title: section.title, text: section.text }));
  const claims = claimDefinitionPayload(current, 1);
  return {
    schema_version: 1,
    kind: TASK_DEFINITION_REVISION_V1,
    document_id: current.sourceTuple.document_id,
    task_id: current.sourceTuple.task_id,
    source_path: current.relativePath,
    sections,
    claim_evidence_plan: claims,
    evidence_plan_revision: current.runtimeState.evidence_plan_revision ?? null,
  };
}

function definitionPayloadV2(current: TaskStoreCurrent): Record<string, unknown> {
  const frontmatter = current.frontmatter ?? {};
  return {
    schema_version: 2,
    kind: TASK_DEFINITION_REVISION_V2,
    revision_algorithm: TASK_DEFINITION_REVISION_V2,
    document_id: current.sourceTuple.document_id,
    task_id: current.sourceTuple.task_id,
    source_path: current.relativePath,
    ...(frontmatter.mutation_authority_version === 2 && frontmatter.mutation_authority !== undefined
      ? {
        mutation_authority_version: 2,
        mutation_authority: frontmatter.mutation_authority,
      }
      : {}),
    // Only frozen definition sections participate.  Current status, audit,
    // findings and propagation bookkeeping stay in the state/event views.
    sections: definitionSections(current, false),
    claim_evidence_plan: claimDefinitionPayload(current, 2),
    evidence_plan_revision: current.runtimeState.evidence_plan_revision ?? null,
  };
}

function definitionPayload(current: TaskStoreCurrent, algorithm: TaskStoreManifest['definition_revision_algorithm'] = TASK_DEFINITION_REVISION_V2): Record<string, unknown> {
  return algorithm === TASK_DEFINITION_REVISION_V1 ? definitionPayloadV1(current) : definitionPayloadV2(current);
}

function compactCurrent(current: TaskStoreCurrent): boolean {
  const binding = record(current.frontmatter?.task_store) ? current.frontmatter?.task_store : null;
  return binding !== null && ['compact-v2', ACTIVE_TASK_FORMAT].includes(binding.format as string);
}

function currentRepresentation(current: TaskStoreCurrent): TaskStoreManifest['current_representation'] {
  return current.frontmatter?.task_store && record(current.frontmatter.task_store) && current.frontmatter.task_store.format === ACTIVE_TASK_FORMAT
    ? ACTIVE_TASK_FORMAT : compactCurrent(current) ? 'compact-v2' : 'legacy-inline';
}

function projectionMaterial(current: TaskStoreCurrent): PreparedTaskContent | null {
  return currentRepresentation(current) === ACTIVE_TASK_FORMAT
    ? expandTaskProjection(current.raw, current.filePath, current.relativePath) : null;
}

function storedCurrentPayload(current: TaskStoreCurrent, type: 'definition' | 'state', fallback: Record<string, unknown>): unknown {
  const material = projectionMaterial(current);
  if (!material) return fallback;
  const binding = current.frontmatter!.task_store as Record<string, any>;
  const sha = binding.projection[type].sha256;
  const object = material.objects.find(object => projectionDigest(object) === sha && object.object_type === type);
  if (!object) throw new TaskStoreError('TASK_STORE_OBJECT_MISSING', 'Projection root is missing.');
  return object.payload;
}

function stateSnapshotPayload(current: TaskStoreCurrent): Record<string, unknown> {
  const state = withoutInlineReviewPreimageContent(current.runtimeState);
  const snapshot = copyWithout(state, ['execution_log', 'applied_proposals', 'claim_evidence']);
  snapshot.claim_evidence = Array.isArray(state.claim_evidence)
    ? state.claim_evidence.map(item => {
      if (!record(item)) return item;
      const slots = Array.isArray(item.slots) ? item.slots.filter(record).map(slot => ({
        ...copyWithout(slot, ['report', 'prerequisite_receipt']),
        report_digest: slot.report === undefined ? null : digest(slot.report),
        prerequisite_receipt_digest: slot.prerequisite_receipt === undefined ? null : digest(slot.prerequisite_receipt),
      })) : [];
      return { ...copyWithout(item, ['slots']), slots };
    })
    : [];
  // The review-resolution default added after 0.20.5 is semantically
  // identical to the omitted field persisted by 0.20.5, so it must not change
  // the task-state/v1 revision of an existing compact task.
  const pendingReview = snapshot.pending_review_result;
  if (record(pendingReview)
    && Array.isArray(pendingReview.resolved_fingerprints)
    && pendingReview.resolved_fingerprints.length === 0) {
    snapshot.pending_review_result = copyWithout(pendingReview, ['resolved_fingerprints']);
  }
  return {
    schema_version: 1,
    kind: 'task-state-snapshot/v1',
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    runtime_state: snapshot,
  };
}

function currentSnapshotPayload(current: TaskStoreCurrent, definitionRevision: string, stateRevision: string): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: 'task-current-snapshot/v1',
    document_id: current.sourceTuple.document_id,
    task_id: current.sourceTuple.task_id,
    task_slug: current.sourceTuple.task_slug,
    source_path: current.relativePath,
    source_revision: current.sourceTuple.revision,
    definition_revision: definitionRevision,
    state_revision: stateRevision,
    active_step_id: current.sourceTuple.active_step_id,
    active_step_status: current.sourceTuple.active_step_status,
    workflow_status: current.sourceTuple.workflow_status,
    lifecycle_state: current.sourceTuple.lifecycle_state,
    resume_requires_review: current.sourceTuple.resume_requires_review,
    resume_review_reasons: current.sourceTuple.resume_review_reasons,
  };
}

function objectRef(objectType: TaskStoreObjectType, sha: string): TaskStoreObjectReference {
  return { sha256: sha, object_type: objectType };
}

function refSha(value: TaskStoreObjectReference | string | null | undefined): string | null {
  if (typeof value === 'string') return SHA256.test(value) ? value : null;
  return value && SHA256.test(value.sha256) ? value.sha256 : null;
}

function isObjectReference(value: unknown): value is TaskStoreObjectReference {
  return record(value)
    && typeof value.sha256 === 'string'
    && SHA256.test(value.sha256)
    && typeof value.object_type === 'string'
    && TASK_STORE_OBJECT_TYPES.has(value.object_type as TaskStoreObjectType);
}

function storedProposalPayload(
  proposal: unknown,
  claimEvidenceReference: TaskStoreObjectReference | undefined,
  executionResultReference: TaskStoreObjectReference | undefined,
): unknown {
  if (!record(proposal) || !record(proposal.semantic_delta) || (claimEvidenceReference === undefined && executionResultReference === undefined)) {
    return proposal;
  }
  return {
    schema_version: 2,
    kind: 'vnext-proposal/v2',
    proposal: copyWithout(proposal, ['semantic_delta']),
    semantic_delta: copyWithout(proposal.semantic_delta, ['claim_evidence', 'execution_result']),
    ...(claimEvidenceReference === undefined ? {} : { claim_evidence_ref: claimEvidenceReference }),
    ...(executionResultReference === undefined ? {} : { execution_result_ref: executionResultReference }),
  };
}

type CommittedObjectCache = {
  eventSequence: number;
  eventHash: string | null;
  hashes: Set<string>;
};

type CommittedEventCache = {
  eventSequence: number;
  eventHash: string | null;
  events: TaskStoreEvent[];
  fileSignatures: Map<number, string[]>;
  directorySignature: string;
};

// Runtime applies construct a short-lived TaskStore around each canonical
// write. Keep the verified committed-object set process-local so repeated
// writes do not rescan every historical event just to classify an unchanged
// content-addressed object. The manifest head invalidates the cache when a
// different process advances the aggregate; the event directory is still the
// source used to rebuild it.
const committedObjectCaches = new Map<string, CommittedObjectCache>();
const committedEventCaches = new Map<string, CommittedEventCache>();
type ExecutionHistoryCache = {
  events: TaskStoreEvent[];
  history: unknown[];
  lengths: number[];
};
const executionHistoryCaches = new Map<string, ExecutionHistoryCache>();
type AppliedProposalCache = {
  events: TaskStoreEvent[];
  ledger: unknown[];
};
const appliedProposalCaches = new Map<string, AppliedProposalCache>();
type IndexFileCache = {
  fileSize: number;
  modifiedAt: number;
  changedAt: number;
  format: 'jsonl' | 'json';
  entries: TaskStoreIndexEntry[];
};
const indexFileCaches = new Map<string, IndexFileCache>();
type IdempotencyEventCache = {
  eventSequence: number;
  eventHash: string | null;
  byKey: Map<string, TaskStoreIdempotencyMatch[]>;
};
const idempotencyEventCaches = new Map<string, IdempotencyEventCache>();

function committedObjectCacheKey(paths: TaskStorePaths): string {
  return path.resolve(paths.directory);
}

function addObjectReferences(hashes: Set<string>, references: Iterable<TaskStoreObjectReference | string | null | undefined>): void {
  for (const reference of references) {
    const hash = refSha(reference);
    if (hash) hashes.add(hash);
  }
}

function loadCommittedObjectCache(paths: TaskStorePaths, manifest: TaskStoreManifest): CommittedObjectCache {
  const key = committedObjectCacheKey(paths);
  const cached = committedObjectCaches.get(key);
  if (cached && cached.eventSequence === manifest.head.event_sequence && cached.eventHash === manifest.head.event_hash) return cached;

  const hashes = new Set<string>();
  addObjectReferences(hashes, [
    manifest.object_refs.definition,
    manifest.object_refs.state,
    manifest.object_refs.current_snapshot,
    manifest.object_refs.legacy_source,
  ]);
  for (const event of committedEventFiles(paths, manifest, true)) {
    addObjectReferences(hashes, Object.values(event.object_refs) as Array<TaskStoreObjectReference | string | null | undefined>);
  }
  const next = { eventSequence: manifest.head.event_sequence, eventHash: manifest.head.event_hash, hashes };
  committedObjectCaches.set(key, next);
  return next;
}

function rememberCommittedObjectReferences(paths: TaskStorePaths, manifest: TaskStoreManifest, references: Iterable<TaskStoreObjectReference | string | null | undefined>): void {
  const key = committedObjectCacheKey(paths);
  const cached = committedObjectCaches.get(key);
  const next = cached && cached.eventSequence <= manifest.head.event_sequence
    ? { eventSequence: manifest.head.event_sequence, eventHash: manifest.head.event_hash, hashes: new Set(cached.hashes) }
    : loadCommittedObjectCache(paths, manifest);
  addObjectReferences(next.hashes, [
    manifest.object_refs.definition,
    manifest.object_refs.state,
    manifest.object_refs.current_snapshot,
    manifest.object_refs.legacy_source,
  ]);
  addObjectReferences(next.hashes, references);
  committedObjectCaches.set(key, next);
}

function idempotencyEventCacheKey(paths: TaskStorePaths): string {
  return path.resolve(paths.directory);
}

function loadIdempotencyEventCache(paths: TaskStorePaths, manifest: TaskStoreManifest): IdempotencyEventCache {
  const key = idempotencyEventCacheKey(paths);
  const cached = idempotencyEventCaches.get(key);
  if (cached && cached.eventSequence === manifest.head.event_sequence && cached.eventHash === manifest.head.event_hash) return cached;
  const byKey = new Map<string, TaskStoreIdempotencyMatch[]>();
  for (const event of committedEventFiles(paths, manifest, true)) {
    if (!event.idempotency_key || !event.proposal_digest) continue;
    const relative = path.posix.join(paths.relativeRoot, 'events', `${String(event.sequence).padStart(12, '0')}-${event.event_hash}.json`);
    const indexEntry: TaskStoreIndexEntry = {
      idempotency_key: event.idempotency_key,
      operation_kind: event.operation_kind,
      proposal_digest: event.proposal_digest,
      source_revision: event.source_revision,
      event_path: relative,
      event_id: event.event_id,
      sequence: event.sequence,
      legacy: event.event_type === 'legacy-import',
    };
    const values = byKey.get(indexEntry.idempotency_key) ?? [];
    values.push({ ...indexEntry, event });
    byKey.set(indexEntry.idempotency_key, values);
  }
  const next = { eventSequence: manifest.head.event_sequence, eventHash: manifest.head.event_hash, byKey };
  idempotencyEventCaches.set(key, next);
  return next;
}

function rememberIdempotencyMatches(paths: TaskStorePaths, manifest: TaskStoreManifest, matches: readonly TaskStoreIdempotencyMatch[]): void {
  const key = idempotencyEventCacheKey(paths);
  const cached = idempotencyEventCaches.get(key);
  const next = cached && cached.eventSequence <= manifest.head.event_sequence
    ? { eventSequence: manifest.head.event_sequence, eventHash: manifest.head.event_hash, byKey: new Map([...cached.byKey].map(([itemKey, values]) => [itemKey, [...values]])) }
    : loadIdempotencyEventCache(paths, manifest);
  for (const match of matches) {
    const values = next.byKey.get(match.idempotency_key) ?? [];
    if (!values.some(value => value.event.event_id === match.event.event_id)) values.push(match);
    next.byKey.set(match.idempotency_key, values);
  }
  idempotencyEventCaches.set(key, next);
}

function objectFile(paths: TaskStorePaths, sha: string): string {
  if (!SHA256.test(sha)) throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'object reference is not a SHA-256 digest.');
  return path.join(paths.objects, `${sha}.json`);
}

function eventFile(paths: TaskStorePaths, sequence: number, eventHash: string): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !SHA256.test(eventHash)) {
    throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'event reference is invalid.');
  }
  return path.join(paths.events, `${String(sequence).padStart(12, '0')}-${eventHash}.json`);
}

function assertObjectReference(value: unknown, location: string): TaskStoreObjectReference {
  if (!record(value) || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) || typeof value.object_type !== 'string' || !TASK_STORE_OBJECT_TYPES.has(value.object_type as TaskStoreObjectType)) {
    throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${location} is not an exact object reference.`);
  }
  return { sha256: value.sha256, object_type: value.object_type as TaskStoreObjectType };
}

function validateManifest(value: unknown, paths: TaskStorePaths): TaskStoreManifest {
  if (!record(value) || value.schema_version !== 1 || value.kind !== TASK_STORE_KIND) {
    throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${paths.manifest} has an unsupported manifest header.`);
  }
  if (value.document_id !== paths.documentId || typeof value.task_id !== 'string' || typeof value.task_slug !== 'string') {
    throw new TaskStoreError('TASK_STORE_IDENTITY_CONFLICT', `${paths.manifest} identity does not match the task-data path.`);
  }
  const head = record(value.head) ? value.head : null;
  if (!head || typeof head.source_revision !== 'string' || !SHA256.test(head.source_revision)
    || typeof head.definition_revision !== 'string' || !SHA256.test(head.definition_revision)
    || typeof head.state_revision !== 'string' || !SHA256.test(head.state_revision)
    || !Number.isSafeInteger(head.event_sequence) || head.event_sequence < 0) {
    throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${paths.manifest} has an invalid aggregate head.`);
  }
  const refs = record(value.object_refs) ? value.object_refs : null;
  if (!refs) throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${paths.manifest} has no object references.`);
  const objectRefs = {
    definition: assertObjectReference(refs.definition, 'manifest.object_refs.definition'),
    state: assertObjectReference(refs.state, 'manifest.object_refs.state'),
    current_snapshot: assertObjectReference(refs.current_snapshot, 'manifest.object_refs.current_snapshot'),
    ...(refs.legacy_source === undefined ? {} : { legacy_source: assertObjectReference(refs.legacy_source, 'manifest.object_refs.legacy_source') }),
  } as TaskStoreManifest['object_refs'];
  const counts = record(value.counts) ? value.counts : null;
  if (!counts || !Number.isSafeInteger(counts.events) || counts.events < 0 || !Number.isSafeInteger(counts.objects) || counts.objects < 0 || !Number.isSafeInteger(counts.idempotency_entries) || counts.idempotency_entries < 0) {
    throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${paths.manifest} has invalid counts.`);
  }
  return {
    schema_version: 1,
    kind: TASK_STORE_KIND,
    document_id: paths.documentId,
    task_id: value.task_id as string,
    task_slug: value.task_slug as string,
    current_task_path: typeof value.current_task_path === 'string' ? normalizeRelative(value.current_task_path, 'manifest.current_task_path') : '',
    storage_root: paths.relativeRoot,
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : '',
    head: {
      source_revision: head.source_revision as string,
      definition_revision: head.definition_revision as string,
      state_revision: head.state_revision as string,
      event_sequence: head.event_sequence as number,
      event_id: typeof head.event_id === 'string' ? head.event_id : null,
      event_hash: typeof head.event_hash === 'string' ? head.event_hash : null,
      event_range: record(head.event_range) && (head.event_range.first === null || Number.isSafeInteger(head.event_range.first)) && (head.event_range.last === null || Number.isSafeInteger(head.event_range.last))
        ? { first: head.event_range.first as number | null, last: head.event_range.last as number | null }
        : { first: null, last: null },
    },
    object_refs: objectRefs,
    counts: { events: counts.events as number, objects: counts.objects as number, idempotency_entries: counts.idempotency_entries as number },
    compatibility: { legacy_current_task: true, hot_window_is_cache: true, full_history_persistent: true },
    storage_format: value.storage_format === 'vnext-task-store/v2' ? 'vnext-task-store/v2' : 'vnext-task-store/v1',
    definition_revision_algorithm: value.definition_revision_algorithm === TASK_DEFINITION_REVISION_V2 ? TASK_DEFINITION_REVISION_V2 : TASK_DEFINITION_REVISION_V1,
    state_revision_algorithm: TASK_STATE_REVISION_V1,
    current_representation: value.current_representation === ACTIVE_TASK_FORMAT ? ACTIVE_TASK_FORMAT : value.current_representation === 'compact-v2' ? 'compact-v2' : 'legacy-inline',
  };
}

function validateEvent(value: unknown, paths: TaskStorePaths, expectedPath?: string): TaskStoreEvent {
  if (!record(value) || value.schema_version !== 1 || value.kind !== TASK_EVENT_KIND) {
    throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `${expectedPath ?? 'event'} has an unsupported event header.`);
  }
  if (value.document_id !== paths.documentId || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || typeof value.event_id !== 'string') {
    throw new TaskStoreError('TASK_STORE_IDENTITY_CONFLICT', `${expectedPath ?? 'event'} identity or sequence is invalid.`);
  }
  for (const key of ['source_revision', 'resulting_source_revision', 'definition_revision', 'state_revision'] as const) {
    if (typeof value[key] !== 'string' || !SHA256.test(value[key] as string)) throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `${expectedPath ?? 'event'}.${key} is not a SHA-256 digest.`);
  }
  if (typeof value.event_hash !== 'string' || !SHA256.test(value.event_hash)) throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `${expectedPath ?? 'event'}.event_hash is invalid.`);
  const unsigned = { ...value };
  delete unsigned.event_hash;
  if (sha256(stableJson(unsigned)) !== value.event_hash) throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `${expectedPath ?? 'event'} event_hash does not match its content.`);
  const eventType = value.event_type;
  if (eventType !== 'legacy-import' && eventType !== 'transaction' && eventType !== 'external-current-sync' && eventType !== 'storage-migration') throw new TaskStoreEventError('TASK_STORE_EVENT_INVALID', `${expectedPath ?? 'event'} event_type is invalid.`);
  if (!record(value.object_refs)) throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `${expectedPath ?? 'event'}.object_refs is invalid.`);
  for (const [key, reference] of Object.entries(value.object_refs)) {
    if (reference !== null) assertObjectReference(reference, `${expectedPath ?? 'event'}.object_refs.${key}`);
  }
  const metadata = record(value.metadata) ? value.metadata : null;
  if (!metadata || typeof metadata.status !== 'string' || typeof metadata.recorded_at !== 'string' || typeof metadata.committed !== 'boolean') throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `${expectedPath ?? 'event'} metadata is invalid.`);
  return value as unknown as TaskStoreEvent;
}

function readEventFile(paths: TaskStorePaths, name: string): TaskStoreEvent {
  const match = EVENT_FILE.exec(name);
  if (!match) throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `event filename is invalid: ${name}`);
  const sequence = Number(match[1]);
  const eventHash = match[2]!;
  const relative = path.posix.join(paths.relativeRoot, 'events', name);
  const file = path.join(paths.events, name);
  assertNoSymlink(paths.root, relative);
  if (!fs.existsSync(file)) throw new TaskStoreError('TASK_STORE_EVENT_MISSING', `event is missing: ${relative}`);
  const event = validateEvent(readJson(file), paths, relative);
  if (event.sequence !== sequence || event.event_hash !== eventHash) {
    throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `${relative} filename does not match the event identity.`);
  }
  return event;
}

/**
 * Return only the event chain acknowledged by the current manifest head.
 * Extra files in the event directory are precommit/orphan material until the
 * chain reaches them; they must never become queryable facts merely because
 * their sequence is below the head or an index points at them.
 */
function committedEventFiles(paths: TaskStorePaths, manifest: TaskStoreManifest, useCache = false): TaskStoreEvent[] {
  const headSequence = manifest.head.event_sequence;
  if (headSequence === 0) return [];
  const cacheKey = committedObjectCacheKey(paths);
  if (!fs.existsSync(paths.events)) throw new TaskStoreError('TASK_STORE_EVENT_MISSING', 'the committed event directory is missing.');
  assertNoSymlink(paths.root, relativePath(paths.root, paths.events));
  const directoryStat = fs.statSync(paths.events);
  const directorySignature = `${directoryStat.size}:${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`;
  const cached = useCache ? committedEventCaches.get(cacheKey) : undefined;
  if (cached && cached.eventSequence === headSequence && cached.eventHash === manifest.head.event_hash
    && cached.directorySignature === directorySignature) return cached.events;
  const bySequence = new Map<number, Array<{ name: string; signature: string }>>();
  for (const entry of fs.readdirSync(paths.events, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = EVENT_FILE.exec(entry.name);
    if (!match) continue;
    const sequence = Number(match[1]);
    if (sequence > headSequence) continue;
    const file = path.join(paths.events, entry.name);
    assertNoSymlink(paths.root, relativePath(paths.root, file));
    const stat = fs.statSync(file);
    const names = bySequence.get(sequence) ?? [];
    names.push({ name: entry.name, signature: `${entry.name}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` });
    bySequence.set(sequence, names);
  }

  const signatureFor = (sequence: number): string[] => (bySequence.get(sequence) ?? []).map(item => item.signature).sort();
  const cachedPrefixMatches = cached !== undefined && cached.eventSequence <= headSequence
    && [...cached.fileSignatures.keys()].every(sequence => {
      if (sequence > headSequence) return false;
      return JSON.stringify(cached.fileSignatures.get(sequence)) === JSON.stringify(signatureFor(sequence));
    });

  // A normal Runtime write appends exactly one event.  Reuse the previously
  // verified prefix and validate only the new suffix, while still checking
  // event file metadata so a changed/corrupt old file invalidates the cache.
  // Full validators continue to call this function without useCache and
  // rebuild the complete chain.
  const events: TaskStoreEvent[] = cachedPrefixMatches ? [...cached!.events] : [];
  let previous: string | null = cachedPrefixMatches ? cached!.eventHash : null;
  const firstSequence = cachedPrefixMatches ? cached!.eventSequence + 1 : 1;
  for (let sequence = firstSequence; sequence <= headSequence; sequence += 1) {
    const names = bySequence.get(sequence) ?? [];
    if (names.length === 0) throw new TaskStoreError('TASK_STORE_EVENT_MISSING', `committed event sequence ${sequence} is missing.`);
    const candidates: TaskStoreEvent[] = [];
    let firstError: unknown;
    for (const item of names) {
      try { candidates.push(readEventFile(paths, item.name)); }
      catch (error) { firstError ??= error; }
    }
    const matching = candidates.filter(event => event.previous_event_hash === previous);
    if (matching.length > 1) throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', `committed event sequence ${sequence} has multiple valid successors.`);
    if (matching.length === 0) {
      const detail = firstError instanceof Error ? ` ${firstError.message}` : '';
      throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `no event at sequence ${sequence} extends the committed chain.${detail}`);
    }
    const event = matching[0]!;
    events.push(event);
    previous = event.event_hash;
  }
  if (previous !== manifest.head.event_hash) throw new TaskStoreError('TASK_STORE_EVENT_INVALID', 'manifest head does not match the committed event chain.');
  if (useCache) {
    const fileSignatures = new Map<number, string[]>();
    for (let sequence = 1; sequence <= headSequence; sequence += 1) fileSignatures.set(sequence, signatureFor(sequence));
    committedEventCaches.set(cacheKey, { eventSequence: headSequence, eventHash: manifest.head.event_hash, events, fileSignatures, directorySignature });
  }
  return events;
}

// Kept separate to make accidental use of Error for a storage protocol error
// visible in stack traces while preserving the public TaskStoreError code.
class TaskStoreEventError extends TaskStoreError {}

function validateObject(value: unknown, paths: TaskStorePaths, sha: string): TaskStoreObject {
  if (!record(value) || value.schema_version !== 1 || value.kind !== TASK_OBJECT_KIND || value.document_id !== paths.documentId || typeof value.object_type !== 'string' || !TASK_STORE_OBJECT_TYPES.has(value.object_type as TaskStoreObjectType) || !('payload' in value)) {
    throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `object ${sha} has an invalid envelope.`);
  }
  if (digest(value) !== sha) throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `object ${sha} content hash does not match its filename.`);
  return value as unknown as TaskStoreObject;
}

function historyRawFromObject(object: TaskStoreObject, sourceRevision: string): string | null {
  if (!['history-material', 'legacy-current-task'].includes(object.object_type) || !record(object.payload)) return null;
  const payload = object.payload;
  if (payload.source_revision !== sourceRevision) return null;
  if (typeof payload.raw_base64 === 'string') {
    const rawBytes = Buffer.from(payload.raw_base64, 'base64');
    const expectedDigest = typeof payload.raw_sha256 === 'string' ? payload.raw_sha256 : sourceRevision;
    if (sha256(rawBytes) !== expectedDigest || expectedDigest !== sourceRevision) {
      throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `retained history preimage digest does not match ${sourceRevision}.`);
    }
    return rawBytes.toString('utf8');
  }
  if (typeof payload.package_base64 !== 'string') return null;
  const packageBytes = Buffer.from(payload.package_base64, 'base64');
  if (typeof payload.package_sha256 === 'string' && sha256(packageBytes) !== payload.package_sha256) {
    throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `history material package digest does not match ${sourceRevision}.`);
  }
  let packageValue: Record<string, unknown>;
  try {
    packageValue = JSON.parse(packageBytes.toString('utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `history material package ${sourceRevision} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (packageValue.kind !== 'vnext-task-definition-history' || packageValue.source_revision !== sourceRevision || typeof packageValue.current_task_base64 !== 'string') {
    throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `history material package ${sourceRevision} has an invalid preimage envelope.`);
  }
  const currentBytes = Buffer.from(packageValue.current_task_base64, 'base64');
  if (sha256(currentBytes) !== sourceRevision) throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `history material preimage digest does not match ${sourceRevision}.`);
  return currentBytes.toString('utf8');
}

function legacyAppliedProposals(object: TaskStoreObject): unknown[] {
  if (object.object_type !== 'legacy-current-task' || !record(object.payload)) return [];
  const payload = object.payload;
  if (Array.isArray(payload.applied_proposals)) return payload.applied_proposals;
  if (typeof payload.raw_base64 !== 'string') return [];
  let raw: string;
  try {
    raw = Buffer.from(payload.raw_base64, 'base64').toString('utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
    if (!match) return [];
    const parsed = parse(match[1]) as unknown;
    const runtime = record(parsed) && record(parsed.runtime_state) ? parsed.runtime_state : null;
    return runtime && Array.isArray(runtime.applied_proposals) ? runtime.applied_proposals : [];
  } catch (error) {
    throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `legacy CURRENT_TASK preimage cannot be parsed for its idempotency ledger: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function legacyExecutionLog(object: TaskStoreObject): unknown[] {
  if (object.object_type !== 'legacy-current-task' || !record(object.payload)) return [];
  const payload = object.payload;
  if (Array.isArray(payload.execution_log)) return payload.execution_log;
  if (typeof payload.raw_base64 !== 'string') return [];
  try {
    const raw = Buffer.from(payload.raw_base64, 'base64').toString('utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
    if (!match) return [];
    const parsed = parse(match[1]) as unknown;
    const runtime = record(parsed) && record(parsed.runtime_state) ? parsed.runtime_state : null;
    return runtime && Array.isArray(runtime.execution_log) ? runtime.execution_log : [];
  } catch (error) {
    throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `legacy CURRENT_TASK preimage cannot be parsed for its execution history: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function nowIso(value?: string): string {
  const result = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(result))) throw new TaskStoreError('TASK_STORE_EVENT_INVALID', `invalid timestamp: ${result}`);
  return result;
}

function proposalDigest(value: unknown): string | null {
  return value === undefined ? null : digest(value);
}

function optionalDigest(value: unknown): string | null {
  return value === undefined ? null : digest(value);
}

function linkedTaskBasisReference(body: string): { path: string; revision: string } | null {
  const match = /##\s+(?:任务输入依据|Task Basis)\s*\r?\n\s*\r?\n-\s*path:\s*`([^`]+)`\s*\r?\n-\s*revision:\s*`([a-f0-9]{64})`/mu.exec(body);
  if (!match) return null;
  return { path: normalizeRelative(match[1]!.replace(/\\/gu, '/'), 'task basis path'), revision: match[2]! };
}

function taskBasisPayload(root: string, current: TaskStoreCurrent): unknown | null {
  const reference = linkedTaskBasisReference(current.body);
  if (!reference) return null;
  const file = path.resolve(root, ...reference.path.split('/'));
  const relative = relativePath(path.resolve(root), file);
  assertNoSymlink(path.resolve(root), relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return {
      schema_version: 1,
      kind: 'task-basis-material/v1',
      path: reference.path,
      basis_revision: reference.revision,
      available: false,
      raw_base64: null,
      raw_bytes: 0,
      actual_revision: null,
    };
  }
  const bytes = fs.readFileSync(file);
  const actualRevision = sha256(bytes);
  return {
    schema_version: 1,
    kind: 'task-basis-material/v1',
    path: reference.path,
    basis_revision: reference.revision,
    available: true,
    raw_base64: bytes.toString('base64'),
    raw_bytes: bytes.length,
    actual_revision: actualRevision,
    revision_matches: actualRevision === reference.revision,
  };
}

function historyMaterialPayloads(root: string, current: TaskStoreCurrent): unknown[] {
  const resolvedRoot = path.resolve(root);
  const directory = path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id);
  const directoryRelative = relativePath(resolvedRoot, directory);
  assertNoSymlink(resolvedRoot, directoryRelative);
  if (!fs.existsSync(directory)) return [];
  const payloads: unknown[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `history material cannot traverse a symbolic link: ${entry.name}`);
    if (!entry.isFile()) continue;
    const match = /^([a-f0-9]{64})\.json$/u.exec(entry.name);
    if (!match) continue;
    const file = path.join(directory, entry.name);
    const relative = relativePath(resolvedRoot, file);
    assertNoSymlink(resolvedRoot, relative);
    const bytes = fs.readFileSync(file);
    payloads.push({
      schema_version: 1,
      kind: 'task-history-material/v1',
      source_revision: match[1],
      package_path: relative,
      package_sha256: sha256(bytes),
      package_bytes: bytes.length,
      package_base64: bytes.toString('base64'),
    });
  }
  return payloads;
}

function claimSlotMap(current: TaskStoreCurrent | undefined): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  const claims = current && Array.isArray(current.runtimeState.claim_evidence) ? current.runtimeState.claim_evidence : [];
  for (const claim of claims) {
    if (!record(claim) || !Array.isArray(claim.slots)) continue;
    const claimId = typeof claim.claim_id === 'string' ? claim.claim_id : '';
    for (const slot of claim.slots) {
      if (!record(slot)) continue;
      const slotId = typeof slot.slot_id === 'string' ? slot.slot_id : '';
      result.set(`${claimId}\u0000${slotId}`, slot);
    }
  }
  return result;
}

function lineCount(raw: string): number {
  return raw.split(/\r\n?|\n/u).length;
}

function legacyLineMap(raw: string, replacementSourceRevision: string | null = null): Record<string, unknown> {
  const oldLineCount = lineCount(raw);
  return {
    kind: 'vnext-current-task-line-map/v1',
    source_revision: sha256(raw),
    old_line_count: oldLineCount,
    replacement_source_revision: replacementSourceRevision,
    replacement_line_count: null,
    // Compact rendering intentionally has no one-to-one Markdown line map.
    // The whole old range therefore resolves through its exact preimage.
    ranges: [{ old_line_start: 1, old_line_end: oldLineCount, new_line_start: null, new_line_end: null, locator: 'history-material' }],
  };
}

function legacyLocatorPayload(raw: string, sourceRevision: string, sourcePath: string, replacementSourceRevision: string | null): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: 'vnext-current-task-locator-alias/v1',
    source_revision: sourceRevision,
    source_path: sourcePath,
    raw_base64: Buffer.from(raw, 'utf8').toString('base64'),
    raw_sha256: sha256(raw),
    raw_bytes: Buffer.byteLength(raw, 'utf8'),
    line_map: legacyLineMap(raw, replacementSourceRevision),
  };
}

function collectObjectPayloads(current: TaskStoreCurrent, includeExecutionLog = true, root?: string, compareTo?: TaskStoreCurrent): Array<{ object_type: TaskStoreObjectType; payload: unknown }> {
  const payloads: Array<{ object_type: TaskStoreObjectType; payload: unknown }> = [];
  const seen = new Set<string>();
  const add = (objectType: TaskStoreObjectType, payload: unknown): void => {
    const key = `${objectType}:${digest(payload)}`;
    if (seen.has(key)) return;
    seen.add(key);
    payloads.push({ object_type: objectType, payload });
  };
  const state = current.runtimeState;
  const previousMaterial = new Set((compareTo ? projectionMaterial(compareTo)?.objects ?? [] : []).map(projectionDigest));
  for (const object of projectionMaterial(current)?.objects ?? []) {
    if (!previousMaterial.has(projectionDigest(object))) add(object.object_type, object.payload);
  }
  if (root) {
    const basis = taskBasisPayload(root, current);
    const previousBasis = compareTo ? taskBasisPayload(root, compareTo) : null;
    if (basis !== null && (!compareTo || optionalDigest(basis) !== optionalDigest(previousBasis))) add('task-basis', basis);
    if (includeExecutionLog) {
      for (const history of historyMaterialPayloads(root, current)) add('history-material', history);
    }
  }
  const previousSlots = claimSlotMap(compareTo);
  if (Array.isArray(state.claim_evidence)) {
    for (const claim of state.claim_evidence) {
      if (!record(claim) || !Array.isArray(claim.slots)) continue;
      for (const slot of claim.slots) {
        if (!record(slot)) continue;
        const claimId = typeof claim.claim_id === 'string' ? claim.claim_id : '';
        const slotId = typeof slot.slot_id === 'string' ? slot.slot_id : '';
        const previous = previousSlots.get(`${claimId}\u0000${slotId}`);
        if (slot.report !== undefined && (!compareTo || !previous || optionalDigest(slot.report) !== optionalDigest(previous.report))) add('evidence-report', slot.report);
        if (slot.prerequisite_receipt !== undefined && (!compareTo || !previous || optionalDigest(slot.prerequisite_receipt) !== optionalDigest(previous.prerequisite_receipt))) add('review-receipt', slot.prerequisite_receipt);
      }
    }
  }
  if (includeExecutionLog && Array.isArray(state.execution_log)) {
    // The initial import walks every legacy execution record so migration is
    // lossless.  Subsequent commits pass includeExecutionLog=false: their
    // changed entries are carried by the transaction event instead of being
    // copied into the current snapshot.
    for (const entry of state.execution_log) {
      if (record(entry)) {
        add('execution-log-entry', entry);
        if (entry.review_receipt !== undefined) add('review-receipt', entry.review_receipt);
        if (record(entry.execution_result)) {
          for (const report of Array.isArray(entry.execution_result.validation_results) ? entry.execution_result.validation_results : []) add('evidence-report', report);
        }
      }
    }
  }
  return payloads;
}

function newlyAppendedExecutionEntries(before: TaskStoreCurrent, after: TaskStoreCurrent): unknown[] {
  const beforeEntries = Array.isArray(before.runtimeState.execution_log) ? before.runtimeState.execution_log : [];
  const afterEntries = Array.isArray(after.runtimeState.execution_log) ? after.runtimeState.execution_log : [];
  if (afterEntries.length === 0) return [];
  if (beforeEntries.length === 0) return afterEntries;
  // A suffix-window rotation or an earlier-entry rewrite must never make the
  // resulting 256-entry hot view look like a full transaction delta.  Audit
  // records carry an idempotency identity; compare each identity's complete
  // payload and emit only identities that are new or whose payload changed.
  const beforeByKey = new Map<string, Set<string>>();
  for (const entry of beforeEntries) {
    if (!record(entry) || typeof entry.idempotency_key !== 'string') continue;
    const values = beforeByKey.get(entry.idempotency_key) ?? new Set<string>();
    values.add(stableJson(entry));
    beforeByKey.set(entry.idempotency_key, values);
  }
  const delta = afterEntries.filter(entry => {
    if (!record(entry) || typeof entry.idempotency_key !== 'string') return false;
    return !beforeByKey.get(entry.idempotency_key)?.has(stableJson(entry));
  });
  if (delta.length > 0) return delta;
  // Unkeyed records are not expected in a validated Runtime log.  Preserve a
  // simple append-only suffix for compatibility, but never copy the whole
  // resulting log when the relationship cannot be proven.
  const beforeJson = beforeEntries.map(stableJson);
  const prefix = beforeJson.reduce((count, value, index) => value === stableJson(afterEntries[index]) ? count + 1 : count, 0);
  return afterEntries.length > prefix ? afterEntries.slice(prefix) : [];
}

function newlyAppendedAppliedProposals(before: TaskStoreCurrent, after: TaskStoreCurrent): unknown[] {
  const beforeEntries = Array.isArray(before.runtimeState.applied_proposals) ? before.runtimeState.applied_proposals : [];
  const afterEntries = Array.isArray(after.runtimeState.applied_proposals) ? after.runtimeState.applied_proposals : [];
  if (afterEntries.length === 0) return [];
  if (beforeEntries.length === 0) return afterEntries;
  const beforeByKey = new Map<string, Set<string>>();
  for (const entry of beforeEntries) {
    if (!record(entry) || typeof entry.idempotency_key !== 'string') continue;
    const values = beforeByKey.get(entry.idempotency_key) ?? new Set<string>();
    values.add(stableJson(entry));
    beforeByKey.set(entry.idempotency_key, values);
  }
  const delta = afterEntries.filter(entry => {
    if (!record(entry) || typeof entry.idempotency_key !== 'string') return false;
    return !beforeByKey.get(entry.idempotency_key)?.has(stableJson(entry));
  });
  if (delta.length > 0) return delta;
  const beforeJson = beforeEntries.map(stableJson);
  const prefix = beforeJson.reduce((count, value, index) => value === stableJson(afterEntries[index]) ? count + 1 : count, 0);
  return afterEntries.length > prefix ? afterEntries.slice(prefix) : [];
}

function storedExecutionEntryPayload(
  entry: unknown,
  claimEvidenceReference: TaskStoreObjectReference | undefined,
  executionResultReference: TaskStoreObjectReference | undefined,
): Record<string, unknown> {
  if (!record(entry)) {
    return {
      schema_version: 2,
      kind: 'vnext-execution-log-entry/v2',
      entry,
    };
  }
  return {
    schema_version: 2,
    kind: 'vnext-execution-log-entry/v2',
    // Large, unchanged claim evidence and execution results live in their own
    // content-addressed objects.  Each event still owns an exact entry
    // reference, so equal payloads are deduplicated without merging facts.
    entry: copyWithout(entry, ['claim_evidence', 'execution_result']),
    ...(claimEvidenceReference === undefined ? {} : { claim_evidence_ref: claimEvidenceReference }),
    ...(executionResultReference === undefined ? {} : { execution_result_ref: executionResultReference }),
  };
}

function directoryBytes(directory: string): { bytes: number; files: number } {
  if (!fs.existsSync(directory)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `symbolic link is not allowed in task store: ${full}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        bytes += fs.statSync(full).size;
        files++;
      }
    }
  };
  visit(directory);
  return { bytes, files };
}

export class TaskStore {
  readonly paths: TaskStorePaths;
  private newlyReferencedObjects = new Set<string>();

  constructor(root: string, documentId: string) {
    this.paths = taskStorePaths(root, documentId);
  }

  static forCurrent(root: string, current: TaskStoreCurrent): TaskStore {
    return new TaskStore(root, current.sourceTuple.document_id);
  }

  get exists(): boolean {
    return fs.existsSync(this.paths.manifest);
  }

  /** A pending marker is recovery state, never a committed task fact. */
  get hasPendingCommit(): boolean {
    return this.readPending() !== null;
  }

  get pendingCommit(): unknown | null {
    return this.readPending();
  }

  get manifest(): TaskStoreManifest | null {
    if (!fs.existsSync(this.paths.manifest)) return null;
    return validateManifest(readJson(this.paths.manifest), this.paths);
  }

  private storeObject(documentId: string, objectType: TaskStoreObjectType, payload: unknown, sourceRevision?: string, recordedAt?: string): TaskStoreObjectReference {
    const object: TaskStoreObject = {
      schema_version: 1,
      kind: TASK_OBJECT_KIND,
      object_type: objectType,
      document_id: documentId,
      payload,
    };
    const hash = digest(object);
    const file = objectFile(this.paths, hash);
    assertNoSymlink(this.paths.root, relativePath(this.paths.root, file));
    const content = `${stableJson(object)}\n`;
    const fileExists = fs.existsSync(file);
    const committedBefore = fileExists ? this.objectIsCommitted(hash) : false;
    if (fileExists) {
      if (fs.readFileSync(file, 'utf8') !== content) {
        if (this.objectIsCommitted(hash)) throw new TaskStoreError('TASK_STORE_OBJECT_CONFLICT', `existing object ${hash} has different bytes.`);
        // A process may have exited while publishing an unreferenced
        // pre-commit object. It is safe to repair only that exact orphan.
        fs.rmSync(file, { force: true });
        writePrecommitFile(file, content, () => this.objectIsCommitted(hash), 'TASK_STORE_OBJECT_CONFLICT', `object ${hash}`);
      }
    } else {
      // The object is pre-commit material; the manifest remains the commit
      // point and future reads verify the content-addressed bytes.
      writePrecommitFile(file, content, () => this.objectIsCommitted(hash), 'TASK_STORE_OBJECT_CONFLICT', `object ${hash}`);
    }
    if (!committedBefore) this.newlyReferencedObjects.add(hash);
    return objectRef(objectType, hash);
  }

  readObject(reference: string | TaskStoreObjectReference, expectedObjectType?: TaskStoreObjectType): TaskStoreObject {
    const hash = refSha(reference);
    if (!hash) throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'object reference is invalid.');
    const manifest = this.manifest;
    if (!manifest || !loadCommittedObjectCache(this.paths, manifest).hashes.has(hash)) {
      throw new TaskStoreError('TASK_STORE_OBJECT_NOT_COMMITTED', `object ${hash} is not acknowledged by the aggregate head.`);
    }
    const file = objectFile(this.paths, hash);
    assertNoSymlink(this.paths.root, relativePath(this.paths.root, file));
    if (!fs.existsSync(file)) throw new TaskStoreError('TASK_STORE_OBJECT_MISSING', `object ${hash} is missing.`);
    const object = validateObject(readJson(file), this.paths, hash);
    if (expectedObjectType !== undefined && object.object_type !== expectedObjectType) {
      throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', `object ${hash} has type ${object.object_type}; expected ${expectedObjectType}.`);
    }
    return object;
  }

  /** Read one exact historical CURRENT_TASK preimage from committed material. */
  readHistoryMaterial(sourceRevision: string): string | null {
    if (!SHA256.test(sourceRevision)) throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'history source revision is invalid.');
    const manifest = this.manifest;
    if (!manifest) return null;
    const references = new Map<string, TaskStoreObjectReference>();
    const add = (value: TaskStoreObjectReference | string | null | undefined): void => {
      if (!value || typeof value === 'string' || !['history-material', 'legacy-current-task'].includes(value.object_type)) return;
      references.set(value.sha256, value);
    };
    add(manifest.object_refs.legacy_source);
    for (const event of this.listEvents()) {
      for (const value of Object.values(event.object_refs)) add(value);
    }
    for (const reference of references.values()) {
      const raw = historyRawFromObject(this.readObject(reference), sourceRevision);
      if (raw !== null) return raw;
    }
    return null;
  }

  /** Resolve an old line locator against the exact retained source preimage. */
  readHistoryLocator(sourceRevision: string, oldLine: number): { source_revision: string; old_line: number; old_line_count: number; text: string; locator: 'exact-preimage' } | null {
    if (!Number.isSafeInteger(oldLine) || oldLine < 1) throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'history old_line must be a positive integer.');
    const raw = this.readHistoryMaterial(sourceRevision);
    if (raw === null) return null;
    const lines = raw.split(/\r\n?|\n/u);
    if (oldLine > lines.length) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `history old_line ${oldLine} is outside the retained source preimage.`);
    return { source_revision: sourceRevision, old_line: oldLine, old_line_count: lines.length, text: lines[oldLine - 1] ?? '', locator: 'exact-preimage' };
  }

  private restoreStoredExecutionEntry(object: TaskStoreObject): unknown {
    const payload = object.payload;
    if (!record(payload) || payload.kind !== 'vnext-execution-log-entry/v2' || !('entry' in payload)) return payload;
    const entry = record(payload.entry) ? { ...payload.entry } : payload.entry;
    if (!record(entry)) return entry;
    if (payload.claim_evidence_ref !== undefined) {
      const claimObject = this.readObject(payload.claim_evidence_ref as TaskStoreObjectReference, 'other');
      const claimPayload = claimObject.payload;
      entry.claim_evidence = record(claimPayload) && claimPayload.kind === 'vnext-execution-claim-evidence/v1'
        ? claimPayload.claim_evidence
        : claimPayload;
    }
    if (payload.execution_result_ref !== undefined) {
      const resultObject = this.readObject(payload.execution_result_ref as TaskStoreObjectReference, 'result');
      entry.execution_result = resultObject.payload;
    }
    return entry;
  }

  private restoreStoredProposal(object: TaskStoreObject): unknown {
    const payload = object.payload;
    if (!record(payload) || payload.kind !== 'vnext-proposal/v2' || !('proposal' in payload)) return payload;
    if (!record(payload.proposal)) {
      throw new TaskStoreError('TASK_STORE_OBJECT_INVALID', 'vnext-proposal/v2 is missing its proposal record.');
    }
    const proposal = { ...payload.proposal };
    if (!('semantic_delta' in payload)) return proposal;
    const semanticDelta = record(payload.semantic_delta) ? { ...payload.semantic_delta } : payload.semantic_delta;
    if (record(semanticDelta)) {
      if (payload.claim_evidence_ref !== undefined) {
        const claimObject = this.readObject(payload.claim_evidence_ref as TaskStoreObjectReference, 'other');
        const claimPayload = claimObject.payload;
        semanticDelta.claim_evidence = record(claimPayload) && claimPayload.kind === 'vnext-execution-claim-evidence/v1'
          ? claimPayload.claim_evidence
          : claimPayload;
      }
      if (payload.execution_result_ref !== undefined) {
        const resultObject = this.readObject(payload.execution_result_ref as TaskStoreObjectReference, 'result');
        semanticDelta.execution_result = resultObject.payload;
      }
    }
    proposal.semantic_delta = semanticDelta;
    return proposal;
  }

  /** Read a committed transaction payload and restore its exact legacy shape. */
  readTransactionPayload(reference: TaskStoreObjectReference, expected: 'proposal' | 'result'): unknown {
    const object = this.readObject(reference, expected);
    return expected === 'proposal' ? this.restoreStoredProposal(object) : object.payload;
  }

  /**
   * Reconstruct the complete execution history from the committed chain.
   * This is intentionally separate from latestEvents(): the latter is a
   * display window, while this method is the Runtime's fact source.
   */
  readExecutionLog(): unknown[] {
    return this.readExecutionLogThroughSourceRevision(null);
  }

  /**
   * Reconstruct the execution history visible at one committed CURRENT_TASK
   * source revision.  Compact historical preimages intentionally retain only
   * the rendered definition/state and therefore need the event chain's
   * before-boundary rather than the latest aggregate history.  This keeps
   * recovery validation exact after a compact replan without treating later
   * events as if they already existed in the old task version.
   */
  readExecutionLogAtSourceRevision(sourceRevision: string): unknown[] {
    if (!SHA256.test(sourceRevision)) throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'historical source revision is invalid.');
    return this.readExecutionLogThroughSourceRevision(sourceRevision);
  }

  private readExecutionLogThroughSourceRevision(sourceRevision: string | null): unknown[] {
    const manifest = this.manifest;
    if (!manifest) return [];
    const events = committedEventFiles(this.paths, manifest, true);
    const cacheKey = committedObjectCacheKey(this.paths);
    const cached = executionHistoryCaches.get(cacheKey);
    const sharedPrefix = cached !== undefined
      && cached.events.length <= events.length
      && cached.events.every((event, index) => events[index] === event);
    let history = sharedPrefix ? [...cached!.history] : [];
    const lengths = sharedPrefix ? [...cached!.lengths] : [];
    const firstSequence = sharedPrefix ? cached!.events.length : 0;
    for (let index = firstSequence; index < events.length; index += 1) {
      const event = events[index]!;
      if (event.event_type === 'legacy-import') {
        const legacyReference = Object.values(event.object_refs).find(reference =>
          record(reference) && reference.object_type === 'legacy-current-task') as TaskStoreObjectReference | undefined;
        const reference = legacyReference ?? this.manifest?.object_refs.legacy_source;
        if (reference) history.push(...legacyExecutionLog(this.readObject(reference)));
      } else {
        const entries = event.transaction?.execution_log_entries;
        if (Array.isArray(entries)) {
          history.push(...entries);
        } else {
          for (const [key, reference] of Object.entries(event.object_refs)) {
            if (!key.startsWith('execution-log-entry:') || !reference) continue;
            history.push(this.restoreStoredExecutionEntry(this.readObject(reference as TaskStoreObjectReference)));
          }
        }
      }
      lengths[index] = history.length;
    }
    executionHistoryCaches.set(cacheKey, { events, history, lengths });
    if (sourceRevision === null) return history.slice();
    const boundary = events.findIndex(event => event.resulting_source_revision === sourceRevision);
    if (boundary < 0) throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', `no committed event ends at source revision ${sourceRevision}.`);
    return history.slice(0, lengths[boundary] ?? 0);
  }

  /** Reconstruct every persisted idempotency fact, including pre-window keys. */
  readAppliedProposals(): unknown[] {
    const manifest = this.manifest;
    if (!manifest) return [];
    const events = committedEventFiles(this.paths, manifest, true);
    const cacheKey = committedObjectCacheKey(this.paths);
    const cached = appliedProposalCaches.get(cacheKey);
    const sharedPrefix = cached !== undefined
      && cached.events.length <= events.length
      && cached.events.every((event, index) => events[index] === event);
    const ledger = sharedPrefix ? [...cached!.ledger] : [];
    const firstSequence = sharedPrefix ? cached!.events.length : 0;
    for (let index = firstSequence; index < events.length; index += 1) {
      const event = events[index]!;
      // Storage maintenance is not a Runtime proposal.  Keeping its event in
      // the aggregate chain is necessary for recovery/audit, but exposing its
      // idempotency key as a business ledger entry would change the task's
      // historical Runtime state during a representation-only migration.
      if (event.event_type === 'storage-migration') continue;
      if (event.event_type === 'legacy-import') {
        const legacyReference = Object.values(event.object_refs).find(reference =>
          record(reference) && reference.object_type === 'legacy-current-task') as TaskStoreObjectReference | undefined;
        const reference = legacyReference ?? this.manifest?.object_refs.legacy_source;
        if (reference) ledger.push(...legacyAppliedProposals(this.readObject(reference)));
        continue;
      }
      const explicit = event.transaction?.applied_proposals;
      if (Array.isArray(explicit)) {
        ledger.push(...explicit);
        continue;
      }
      if (event.idempotency_key && event.proposal_digest) {
        ledger.push({
          idempotency_key: event.idempotency_key,
          operation_kind: event.operation_kind,
          proposal_digest: event.proposal_digest,
          source_revision: event.source_revision,
        });
      }
    }
    appliedProposalCaches.set(cacheKey, { events, ledger });
    return ledger.slice();
  }

  hydrateHistory(current: TaskStoreCurrent): {
    execution_log: unknown[];
    applied_proposals: unknown[];
  } {
    this.assertCurrentIdentity(current);
    if (!this.manifest) throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', 'compact CURRENT_TASK requires a committed task-store manifest.');
    return { execution_log: this.readExecutionLog(), applied_proposals: this.readAppliedProposals() };
  }

  private readIndexFile(file: string): TaskStoreIndexEntry[] {
    if (!fs.existsSync(file)) return [];
    const stat = fs.statSync(file);
    const cached = indexFileCaches.get(file);
    if (cached && cached.fileSize === stat.size && cached.modifiedAt === stat.mtimeMs && cached.changedAt === stat.ctimeMs) return cached.entries;
    if (cached && cached.format === 'jsonl' && stat.size > cached.fileSize && cached.changedAt === stat.ctimeMs) {
      const fd = fs.openSync(file, 'r');
      let suffix = '';
      try {
        const bytes = Buffer.alloc(stat.size - cached.fileSize);
        fs.readSync(fd, bytes, 0, bytes.length, cached.fileSize);
        suffix = bytes.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
      const lines = suffix.split(/\r?\n/u).filter(Boolean);
      const additions = lines.map((line, index) => {
        let value: unknown;
        try { value = JSON.parse(line) as unknown; }
        catch (error) { throw new TaskStoreError('TASK_STORE_INDEX_INVALID', `${file} journal line ${index} is invalid: ${error instanceof Error ? error.message : String(error)}`); }
        return value;
      });
      const entries = [...cached.entries, ...this.validateIndexEntries(additions, file, cached.entries.length)];
      indexFileCaches.set(file, { fileSize: stat.size, modifiedAt: stat.mtimeMs, changedAt: stat.ctimeMs, format: 'jsonl', entries });
      return entries;
    }
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    let values: unknown[];
    if (raw.startsWith('[')) {
      let value: unknown;
      try { value = JSON.parse(raw) as unknown; } catch (error) { throw new TaskStoreError('TASK_STORE_INDEX_INVALID', `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
      if (!Array.isArray(value)) throw new TaskStoreError('TASK_STORE_INDEX_INVALID', `${file} is not an array.`);
      values = value;
    } else {
      const lines = raw.split(/\r?\n/u).filter(Boolean);
      values = [];
      for (let index = 0; index < lines.length; index += 1) {
        try { values.push(JSON.parse(lines[index]!) as unknown); }
        catch (error) {
          // An append-only index can have a torn final line after a process
          // exit. The event chain is authoritative and lookup will rebuild
          // the missing entry from committed events.
          if (index === lines.length - 1) break;
          throw new TaskStoreError('TASK_STORE_INDEX_INVALID', `${file} journal line ${index} is invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const entries = this.validateIndexEntries(values, file, 0);
    indexFileCaches.set(file, { fileSize: stat.size, modifiedAt: stat.mtimeMs, changedAt: stat.ctimeMs, format: raw.startsWith('[') ? 'json' : 'jsonl', entries });
    return entries;
  }

  private validateIndexEntries(values: readonly unknown[], file: string, offset: number): TaskStoreIndexEntry[] {
    return values.map((item, index) => {
      if (!record(item) || typeof item.idempotency_key !== 'string' || typeof item.operation_kind !== 'string' || typeof item.proposal_digest !== 'string' || !SHA256.test(item.proposal_digest) || typeof item.source_revision !== 'string' || !SHA256.test(item.source_revision) || typeof item.event_path !== 'string' || typeof item.event_id !== 'string' || !Number.isSafeInteger(item.sequence) || (item.sequence as number) < 1 || typeof item.legacy !== 'boolean') {
        throw new TaskStoreError('TASK_STORE_INDEX_INVALID', `idempotency index entry ${offset + index} in ${file} is invalid.`);
      }
      return item as unknown as TaskStoreIndexEntry;
    });
  }

  private readIndex(): TaskStoreIndexEntry[] {
    // Releases before the append-journal optimization wrote idempotency.json
    // as one JSON array. Read both names during the compatibility window; the
    // event files remain authoritative if either index is absent or stale.
    const entries = [this.paths.idempotencyIndex, this.paths.legacyIdempotencyIndex]
      .flatMap(file => this.readIndexFile(file));
    const unique = new Map<string, TaskStoreIndexEntry>();
    for (const entry of entries) {
      const identity = stableJson(entry);
      if (!unique.has(identity)) unique.set(identity, entry);
    }
    return [...unique.values()];
  }

  private readEventPath(relative: string): TaskStoreEvent {
    const normalized = normalizeRelative(relative, 'event reference');
    if (!normalized.startsWith(`${this.paths.relativeRoot}/events/`)) throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'event reference is outside this task store.');
    const basename = path.posix.basename(normalized);
    const match = EVENT_FILE.exec(basename);
    if (!match) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `event filename is invalid: ${relative}`);
    const sequence = Number(match[1]);
    const eventHash = match[2]!;
    const manifest = this.manifest;
    if (!manifest) throw new TaskStoreError('TASK_STORE_EVENT_NOT_COMMITTED', `event is not acknowledged by an aggregate head: ${relative}`);
    if (sequence > manifest.head.event_sequence) throw new TaskStoreError('TASK_STORE_EVENT_NOT_COMMITTED', `event is not acknowledged by the aggregate head: ${relative}`);
    const event = readEventFile(this.paths, basename);
    // The exact file is read and hash-checked above. Reuse the process-local
    // verified chain for repeated index/idempotency lookups; public list
    // queries still rebuild the chain so a changed directory cannot be hidden
    // by a stale cache.
    const committed = committedEventFiles(this.paths, manifest, true).find(item => item.sequence === sequence);
    if (!committed || committed.event_hash !== eventHash) throw new TaskStoreError('TASK_STORE_EVENT_NOT_COMMITTED', `event is not part of the committed aggregate chain: ${relative}`);
    return event;
  }

  readEvent(reference: string | { sequence: number; event_hash: string }): TaskStoreEvent {
    const relative = typeof reference === 'string'
      ? reference
      : path.posix.join(this.paths.relativeRoot, 'events', `${String(reference.sequence).padStart(12, '0')}-${reference.event_hash}.json`);
    return this.readEventPath(relative);
  }

  listEvents(): TaskStoreEvent[] {
    const manifest = this.manifest;
    return manifest ? committedEventFiles(this.paths, manifest) : [];
  }

  private writeIndexes(events: readonly TaskStoreEvent[], idempotency: readonly TaskStoreIndexEntry[]): void {
    const eventIndex = events.map(event => this.eventIndexEntry(event));
    atomicWrite(this.paths.eventIndex, eventIndex.map(item => stableJson(item)).join('\n') + (eventIndex.length ? '\n' : ''), false);
    atomicWrite(this.paths.idempotencyIndex, idempotency.map(item => stableJson(item)).join('\n') + (idempotency.length ? '\n' : ''), false);
  }

  private eventIndexEntry(event: TaskStoreEvent): Record<string, unknown> {
    return {
      sequence: event.sequence,
      event_id: event.event_id,
      event_hash: event.event_hash,
      path: path.posix.join(this.paths.relativeRoot, 'events', `${String(event.sequence).padStart(12, '0')}-${event.event_hash}.json`),
      operation_kind: event.operation_kind,
      idempotency_key: event.idempotency_key,
      source_revision: event.source_revision,
    };
  }

  private appendIndexes(event: TaskStoreEvent, idempotency: readonly TaskStoreIndexEntry[]): void {
    // The event directory is authoritative.  The journal is deliberately
    // append-only and rebuildable; a torn final line is ignored/rebuilt by a
    // future maintenance pass rather than being allowed to change facts.
    const entry = `${stableJson(this.eventIndexEntry(event))}\n`;
    fs.mkdirSync(path.dirname(this.paths.eventIndex), { recursive: true });
    fs.appendFileSync(this.paths.eventIndex, entry, 'utf8');
    const idempotencyEntry = idempotency.find(item => item.sequence === event.sequence && item.event_id === event.event_id && item.event_path.endsWith(`${String(event.sequence).padStart(12, '0')}-${event.event_hash}.json`));
    if (idempotencyEntry) fs.appendFileSync(this.paths.idempotencyIndex, `${stableJson(idempotencyEntry)}\n`, 'utf8');
  }

  private makeEvent(
    eventType: TaskStoreEvent['event_type'],
    current: TaskStoreCurrent,
    manifest: TaskStoreManifest,
    refs: Record<string, TaskStoreObjectReference | string | null>,
    input: { operationKind: string; idempotencyKey?: string | null; proposalDigest?: string | null; status: string; committed: boolean; message?: string; code?: string; recordedAt?: string; transaction?: TaskStoreEvent['transaction'] },
  ): TaskStoreEvent {
    const sequence = manifest.head.event_sequence + 1;
    const eventId = `${current.sourceTuple.document_id}:event:${sequence}`;
    const base = {
      schema_version: 1 as const,
      kind: TASK_EVENT_KIND,
      document_id: current.sourceTuple.document_id,
      sequence,
      event_id: eventId,
      event_type: eventType,
      operation_kind: input.operationKind,
      idempotency_key: input.idempotencyKey ?? null,
      proposal_digest: input.proposalDigest ?? null,
      source_revision: manifest.head.source_revision,
      resulting_source_revision: current.sourceTuple.revision,
      definition_revision: manifest.head.definition_revision,
      state_revision: manifest.head.state_revision,
      previous_event_hash: manifest.head.event_hash,
      object_refs: refs,
      ...(input.transaction === undefined ? {} : { transaction: input.transaction }),
      metadata: {
        committed: input.committed,
        status: input.status,
        ...(input.message === undefined ? {} : { message: input.message }),
        ...(input.code === undefined ? {} : { code: input.code }),
        recorded_at: nowIso(input.recordedAt),
      },
    };
    return { ...base, event_hash: sha256(stableJson(base)) };
  }

  private writeEvent(event: TaskStoreEvent): string {
    const file = eventFile(this.paths, event.sequence, event.event_hash);
    assertNoSymlink(this.paths.root, relativePath(this.paths.root, file));
    const content = `${stableJson(event)}\n`;
    writePrecommitFile(file, content, () => this.eventIsCommitted(event.sequence), 'TASK_STORE_EVENT_CONFLICT', `event ${event.event_id}`);
    return relativePath(this.paths.root, file);
  }

  private objectIsCommitted(hash: string): boolean {
    const manifest = this.manifest;
    if (!manifest) return false;
    return loadCommittedObjectCache(this.paths, manifest).hashes.has(hash);
  }

  private eventIsCommitted(sequence: number): boolean {
    const manifest = this.manifest;
    return Boolean(manifest && sequence <= manifest.head.event_sequence);
  }

  private readPending(): TaskStorePending | null {
    if (!fs.existsSync(this.paths.pending)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(this.paths.pending, 'utf8')) as Record<string, unknown>;
      if (value.schema_version !== 1 || value.kind !== 'vnext-task-store-pending-commit' || value.document_id !== this.paths.documentId
        || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1
        || typeof value.source_revision !== 'string' || !SHA256.test(value.source_revision)
        || typeof value.resulting_source_revision !== 'string' || !SHA256.test(value.resulting_source_revision)
        || (value.idempotency_key !== null && typeof value.idempotency_key !== 'string')
        || (value.proposal_digest !== null && (typeof value.proposal_digest !== 'string' || !SHA256.test(value.proposal_digest)))) {
        throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending} has an invalid pending transaction marker.`);
      }
      if (value.phase !== undefined && !['prepared', 'current-published', 'store-published'].includes(value.phase as string)) {
        throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.phase is invalid.`);
      }
      if (value.write_targets !== undefined && (!Array.isArray(value.write_targets) || value.write_targets.some(item => typeof item !== 'string'))) {
        throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.write_targets is invalid.`);
      }
      if (value.write_set !== undefined) {
        if (!Array.isArray(value.write_set) || value.write_set.length === 0) {
          throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.write_set is invalid.`);
        }
        const paths = new Set<string>();
        for (const [index, item] of value.write_set.entries()) {
          if (!record(item) || typeof item.path !== 'string' || (item.before_content !== null && typeof item.before_content !== 'string') || (item.after_content !== null && typeof item.after_content !== 'string')) {
            throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.write_set[${index}] is invalid.`);
          }
          const normalized = normalizeRelative(item.path, `${this.paths.pending}.write_set[${index}].path`);
          if (paths.has(normalized)) throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.write_set contains duplicate path ${normalized}.`);
          paths.add(normalized);
        }
      }
      for (const key of ['before_raw', 'after_raw'] as const) {
        if (value[key] !== undefined && typeof value[key] !== 'string') {
          throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.${key} must be a string when present.`);
        }
      }
      for (const key of ['before_runtime_state', 'after_runtime_state'] as const) {
        if (value[key] !== undefined && !record(value[key])) {
          throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.${key} must be an object when present.`);
        }
      }
      for (const key of ['execution_log_entries', 'applied_proposals'] as const) {
        if (value[key] !== undefined && !Array.isArray(value[key])) {
          throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.${key} must be an array when present.`);
        }
      }
      if (value.previous_manifest_head !== undefined) {
        const head = record(value.previous_manifest_head) ? value.previous_manifest_head : null;
        if (!head || typeof head.source_revision !== 'string' || !SHA256.test(head.source_revision)
          || !Number.isSafeInteger(head.event_sequence) || (head.event_sequence as number) < 0
          || (head.event_hash !== null && (typeof head.event_hash !== 'string' || !SHA256.test(head.event_hash)))) {
          throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending}.previous_manifest_head is invalid.`);
        }
      }
      return value as unknown as TaskStorePending;
    } catch (error) {
      if (error instanceof TaskStoreError) throw error;
      throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', `${this.paths.pending} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private writePending(pending: TaskStorePending): void {
    assertNoSymlink(this.paths.root, relativePath(this.paths.root, this.paths.indexes));
    fs.mkdirSync(path.dirname(this.paths.pending), { recursive: true });
    // This marker only describes an in-flight precommit. It is never a
    // committed task fact and is removed after manifest publication.
    writeJson(this.paths.pending, pending);
  }

  private clearPending(): void {
    try { fs.rmSync(this.paths.pending, { force: true }); } catch { /* recovery will clear a stale marker on the next read */ }
  }

  /**
   * Persist the exact commit intent before a canonical file is published.
   * The proposal/result and write set are recovery material, not merely a
   * digest, so a restart can finish one known transaction without re-running
   * the product operation.
   */
  stageCommit(input: TaskStoreCommitIntent): void {
    this.assertCurrentIdentity(input.before);
    if (!SHA256.test(input.after_source_revision)) throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'pending resulting source revision is invalid.');
    const manifest = this.ensureInitialized(input.before);
    const key = record(input.proposal) && typeof input.proposal.idempotency_key === 'string' ? input.proposal.idempotency_key : null;
    const proposalHash = proposalDigest(input.proposal);
    const normalizedTargets = input.write_targets.map(target => normalizeRelative(target, 'pending write target'));
    const writeSet = input.write_set === undefined
      ? input.after === undefined
        ? undefined
        : [{ path: input.before.relativePath, before_content: input.before.raw, after_content: input.after.raw }]
      : input.write_set.map((item, index) => ({
        path: normalizeRelative(item.path, `pending write set[${index}].path`),
        before_content: item.before_content,
        after_content: item.after_content,
      }));
    if (writeSet !== undefined) {
      const paths = new Set<string>();
      for (const item of writeSet) {
        if (paths.has(item.path)) throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', `pending write set contains duplicate path ${item.path}.`);
        paths.add(item.path);
        const file = path.join(this.paths.root, ...item.path.split('/'));
        assertNoSymlink(this.paths.root, item.path);
        const actual = fs.existsSync(file)
          ? (fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : (() => { throw new TaskStoreError('TASK_STORE_PATH_INVALID', `pending write target is not a regular file: ${item.path}`); })())
          : null;
        if (actual !== item.before_content) throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', `pending write target changed before staging: ${item.path}`);
      }
    }
    const compactHistory = compactCurrent(input.before) || (input.after !== undefined && compactCurrent(input.after));
    const beforeRuntimeState = compactHistory && input.after !== undefined
      ? copyWithout(withoutInlineReviewPreimageContent(input.before.runtimeState), ['execution_log', 'applied_proposals'])
      : withoutInlineReviewPreimageContent(input.before.runtimeState);
    const afterRuntimeState = compactHistory && input.after !== undefined
      ? copyWithout(withoutInlineReviewPreimageContent(input.after.runtimeState), ['execution_log', 'applied_proposals'])
      : input.after === undefined ? undefined : withoutInlineReviewPreimageContent(input.after.runtimeState);
    const executionLogEntries = compactHistory && input.after !== undefined
      ? newlyAppendedExecutionEntries(input.before, input.after)
      : undefined;
    const appliedProposals = compactHistory && input.after !== undefined
      ? newlyAppendedAppliedProposals(input.before, input.after)
      : undefined;
    const existing = this.readPending();
    if (existing) {
      if (existing.sequence !== manifest.head.event_sequence + 1
        || existing.source_revision !== input.before.sourceTuple.revision
        || existing.resulting_source_revision !== input.after_source_revision
        || existing.idempotency_key !== key
        || existing.proposal_digest !== proposalHash) {
        throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'an unfinished task-store intent does not match the requested write.');
      }
      return;
    }
    this.writePending({
      schema_version: 1,
      kind: 'vnext-task-store-pending-commit',
      document_id: input.before.sourceTuple.document_id,
      sequence: manifest.head.event_sequence + 1,
      source_revision: input.before.sourceTuple.revision,
      resulting_source_revision: input.after_source_revision,
      idempotency_key: key,
      proposal_digest: proposalHash,
      phase: 'prepared',
      proposal: input.proposal,
      ...(input.result === undefined ? {} : { result: input.result }),
      write_targets: normalizedTargets,
      ...(writeSet === undefined ? {} : { write_set: writeSet }),
      ...(input.after === undefined ? {} : {
        before_raw: input.before.raw,
        after_raw: input.after.raw,
        before_runtime_state: beforeRuntimeState,
        after_runtime_state: afterRuntimeState,
        ...(executionLogEntries === undefined ? {} : { execution_log_entries: executionLogEntries }),
        ...(appliedProposals === undefined ? {} : { applied_proposals: appliedProposals }),
      }),
      previous_manifest_head: {
        source_revision: manifest.head.source_revision,
        event_sequence: manifest.head.event_sequence,
        event_hash: manifest.head.event_hash,
      },
    });
  }

  markCurrentPublished(resultingSourceRevision: string): void {
    if (!SHA256.test(resultingSourceRevision)) throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'published source revision is invalid.');
    const pending = this.readPending();
    if (!pending || pending.resulting_source_revision !== resultingSourceRevision) {
      throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'cannot mark a task-store commit published without its exact pending intent.');
    }
    this.writePending({ ...pending, phase: 'current-published' });
  }

  clearPendingForNoCommit(): void {
    this.clearPending();
  }

  private findOrphanTransaction(previous: TaskStoreManifest, after: TaskStoreCurrent, definition: TaskStoreObjectReference, state: TaskStoreObjectReference, idempotencyKey: string | null, proposalHash: string | null, proposal: unknown, proposalReference?: TaskStoreObjectReference, operationKind?: string): TaskStoreEvent | null {
    if (!idempotencyKey || !proposalHash || !fs.existsSync(this.paths.events)) return null;
    const sequence = previous.head.event_sequence + 1;
    for (const entry of fs.readdirSync(this.paths.events, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = EVENT_FILE.exec(entry.name);
      if (!match || Number(match[1]) !== sequence) continue;
      try {
        const event = readEventFile(this.paths, entry.name);
        const eventProposal = event.transaction?.proposal;
        const proposalMatches = proposalReference && isObjectReference(eventProposal)
          ? eventProposal.object_type === 'proposal' && eventProposal.sha256 === proposalReference.sha256
          : eventProposal !== undefined && digest(eventProposal) === digest(proposal);
        if (event.event_type !== (operationKind === 'task-storage-migration' ? 'storage-migration' : 'transaction')
          || event.previous_event_hash !== previous.head.event_hash
          || event.idempotency_key !== idempotencyKey
          || event.proposal_digest !== proposalHash
          || event.resulting_source_revision !== after.sourceTuple.revision
          || refSha(event.object_refs.definition) !== definition.sha256
          || refSha(event.object_refs.state) !== state.sha256
          || !event.transaction
          || !proposalMatches) continue;
        return event;
      } catch {
        // Invalid/unreadable precommit files are not candidates for recovery.
      }
    }
    return null;
  }

  private buildManifest(current: TaskStoreCurrent, previous: TaskStoreManifest | null, refs: { definition: TaskStoreObjectReference; state: TaskStoreObjectReference; currentSnapshot: TaskStoreObjectReference; legacySource?: TaskStoreObjectReference }, event: TaskStoreEvent | null, objectCount: number, idempotencyCount: number, recordedAt?: string, algorithms?: { definition: TaskStoreManifest['definition_revision_algorithm']; representation: TaskStoreManifest['current_representation'] }): TaskStoreManifest {
    const definitionAlgorithm = algorithms?.definition ?? previous?.definition_revision_algorithm ?? (compactCurrent(current) ? TASK_DEFINITION_REVISION_V2 : TASK_DEFINITION_REVISION_V1);
    const representation = algorithms?.representation ?? previous?.current_representation ?? currentRepresentation(current);
    const first = event ? (previous?.head.event_range.first ?? event.sequence) : (previous?.head.event_range.first ?? null);
    return {
      schema_version: 1,
      kind: TASK_STORE_KIND,
      document_id: current.sourceTuple.document_id,
      task_id: current.sourceTuple.task_id,
      task_slug: current.sourceTuple.task_slug,
      current_task_path: current.relativePath,
      storage_root: this.paths.relativeRoot,
      created_at: previous?.created_at ?? nowIso(recordedAt),
      updated_at: nowIso(recordedAt),
      head: {
        source_revision: current.sourceTuple.revision,
        // Revisions are business-level payload revisions; object references
        // remain wrapper hashes and therefore need not equal these values.
        definition_revision: taskStoreDefinitionRevision(current, definitionAlgorithm),
        state_revision: taskStoreStateRevision(current),
        event_sequence: event?.sequence ?? previous?.head.event_sequence ?? 0,
        event_id: event?.event_id ?? previous?.head.event_id ?? null,
        event_hash: event?.event_hash ?? previous?.head.event_hash ?? null,
        event_range: { first, last: event?.sequence ?? previous?.head.event_range.last ?? null },
      },
      object_refs: {
        definition: refs.definition,
        state: refs.state,
        current_snapshot: refs.currentSnapshot,
        ...(refs.legacySource === undefined ? {} : { legacy_source: refs.legacySource }),
      },
      counts: {
        events: event ? (previous?.counts.events ?? 0) + 1 : (previous?.counts.events ?? 0),
        objects: objectCount,
        idempotency_entries: idempotencyCount,
      },
      compatibility: { legacy_current_task: true, hot_window_is_cache: true, full_history_persistent: true },
      storage_format: representation !== 'legacy-inline' ? 'vnext-task-store/v2' : 'vnext-task-store/v1',
      definition_revision_algorithm: definitionAlgorithm,
      state_revision_algorithm: TASK_STATE_REVISION_V1,
      current_representation: representation,
    };
  }

  private writeManifest(manifest: TaskStoreManifest): void {
    // The canonical CURRENT_TASK publication already owns the governance
    // lock. Sidecar files use atomic rename; an interrupted write leaves the
    // previous manifest valid and any unreferenced objects/events recoverable.
    assertNoSymlink(this.paths.root, relativePath(this.paths.root, this.paths.manifest));
    writeJson(this.paths.manifest, manifest, false);
  }

  private assertCurrentIdentity(current: TaskStoreCurrent): void {
    if (current.sourceTuple.document_id !== this.paths.documentId) throw new TaskStoreError('TASK_STORE_IDENTITY_CONFLICT', 'current task document_id does not match task-data path.');
  }

  /**
   * Initialize the sidecar from an existing legacy CURRENT_TASK.  The import
   * is lossless for bytes and known runtime records; it does not rewrite the
   * current file and its synthetic event is explicitly marked legacy-import.
   */
  ensureInitialized(current: TaskStoreCurrent, recordedAt?: string): TaskStoreManifest {
    this.assertCurrentIdentity(current);
    const existing = this.manifest;
    if (existing) {
      if (existing.task_id !== current.sourceTuple.task_id || existing.task_slug !== current.sourceTuple.task_slug || existing.current_task_path !== current.relativePath) {
        throw new TaskStoreError('TASK_STORE_IDENTITY_CONFLICT', 'existing task store identity conflicts with CURRENT_TASK.');
      }
      if (existing.head.source_revision !== current.sourceTuple.revision) {
        return this.reconcileExternalCurrent(current, recordedAt);
      }
      return existing;
    }
    this.newlyReferencedObjects.clear();
    fs.mkdirSync(this.paths.objects, { recursive: true });
    fs.mkdirSync(this.paths.events, { recursive: true });
    fs.mkdirSync(this.paths.indexes, { recursive: true });
    // A store created by the v0.19.5 Runtime uses the v2 definition algorithm.
    // Existing v0.19.4 manifests are read with their recorded v1 algorithm
    // above and are never re-hashed until explicit migration.
    const definitionAlgorithm = TASK_DEFINITION_REVISION_V2;
    const representation = currentRepresentation(current);
    const definition = this.storeObject(current.sourceTuple.document_id, 'definition', storedCurrentPayload(current, 'definition', definitionPayload(current, definitionAlgorithm)), current.sourceTuple.revision, recordedAt);
    const state = this.storeObject(current.sourceTuple.document_id, 'state', storedCurrentPayload(current, 'state', stateSnapshotPayload(current)), current.sourceTuple.revision, recordedAt);
    const legacySource = this.storeObject(current.sourceTuple.document_id, 'legacy-current-task', {
      source_revision: current.sourceTuple.revision,
      source_path: current.relativePath,
      raw_base64: Buffer.from(current.raw, 'utf8').toString('base64'),
      raw_sha256: current.sourceTuple.revision,
      raw_bytes: Buffer.byteLength(current.raw),
      line_map: legacyLineMap(current.raw),
      // A newly-created compact document has no inline history for the
      // legacy preimage parser to recover. Keep the exact initial records in
      // the one import object so the first committed aggregate is lossless.
      ...(compactCurrent(current) ? {
        execution_log: current.runtimeState.execution_log,
        applied_proposals: current.runtimeState.applied_proposals,
      } : {}),
    }, current.sourceTuple.revision, recordedAt);
    // The state object is also the current-state node.  The manifest keeps a
    // separately named current_snapshot reference for readers, but it points
    // to the same immutable payload instead of copying it once per event.
    const empty: TaskStoreManifest = this.buildManifest(current, null, { definition, state, currentSnapshot: state, legacySource }, null, 0, 0, recordedAt, {
      definition: definitionAlgorithm,
      representation,
    });
    const initialPayloadRefs: Record<string, TaskStoreObjectReference> = {};
    for (const payload of collectObjectPayloads(current, true, this.paths.root)) {
      const reference = this.storeObject(current.sourceTuple.document_id, payload.object_type, payload.payload, current.sourceTuple.revision, recordedAt);
      initialPayloadRefs[`${payload.object_type}:${reference.sha256}`] = reference;
    }
    const legacyEvent = this.makeEvent('legacy-import', current, empty, {
      definition,
      state,
      current_snapshot: state,
      legacy_source: legacySource,
      ...initialPayloadRefs,
    }, {
      operationKind: 'legacy-import',
      status: 'imported',
      committed: true,
      message: 'Legacy CURRENT_TASK was imported without rewriting its bytes.',
      recordedAt,
    });
    const eventPath = this.writeEvent(legacyEvent);
    const applied = Array.isArray(current.runtimeState.applied_proposals) ? current.runtimeState.applied_proposals : [];
    const index: TaskStoreIndexEntry[] = applied.filter(record).map(item => ({
      idempotency_key: typeof item.idempotency_key === 'string' ? item.idempotency_key : '',
      operation_kind: typeof item.operation_kind === 'string' ? item.operation_kind : 'task-state-transaction',
      proposal_digest: typeof item.proposal_digest === 'string' && SHA256.test(item.proposal_digest) ? item.proposal_digest : digest(item),
      source_revision: typeof item.source_revision === 'string' && SHA256.test(item.source_revision) ? item.source_revision : current.sourceTuple.revision,
      event_path: eventPath,
      event_id: legacyEvent.event_id,
      sequence: legacyEvent.sequence,
      legacy: true,
    })).filter(item => item.idempotency_key.length > 0);
    this.writeIndexes([legacyEvent], index);
    const manifest = this.buildManifest(current, empty, { definition, state, currentSnapshot: state, legacySource }, legacyEvent, this.newlyReferencedObjects.size, index.length, recordedAt, {
      definition: definitionAlgorithm,
      representation,
    });
    this.writeManifest(manifest);
    rememberCommittedObjectReferences(this.paths, manifest, Object.values(legacyEvent.object_refs));
    rememberIdempotencyMatches(this.paths, manifest, index.map(entry => ({ ...entry, event: legacyEvent })));
    return manifest;
  }

  private reconcileExternalCurrent(current: TaskStoreCurrent, recordedAt?: string): TaskStoreManifest {
    const previous = this.manifest;
    if (!previous) return this.ensureInitialized(current, recordedAt);
    if (previous.current_representation !== 'legacy-inline') {
      throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'compact CURRENT_TASK changed without a matching governed task-store journal; recovery is required.');
    }
    this.newlyReferencedObjects.clear();
    const definitionAlgorithm = previous.definition_revision_algorithm;
    const definition = this.storeObject(current.sourceTuple.document_id, 'definition', storedCurrentPayload(current, 'definition', definitionPayload(current, definitionAlgorithm)), current.sourceTuple.revision, recordedAt);
    const state = this.storeObject(current.sourceTuple.document_id, 'state', storedCurrentPayload(current, 'state', stateSnapshotPayload(current)), current.sourceTuple.revision, recordedAt);
    const stagedManifest: TaskStoreManifest = {
      ...previous,
      head: {
        ...previous.head,
        source_revision: current.sourceTuple.revision,
        definition_revision: taskStoreDefinitionRevision(current, definitionAlgorithm),
        state_revision: taskStoreStateRevision(current),
      },
    };
    const refs: Record<string, TaskStoreObjectReference | string | null> = { definition, state, current_snapshot: state };
    // A legacy writer can advance the canonical file without giving Runtime
    // a before/after pair. Capture all material visible at this boundary once
    // so the sidecar remains lossless; subsequent governed commits use the
    // before/after comparison and reference only changed reports/receipts.
    for (const payload of collectObjectPayloads(current, true, this.paths.root)) {
      const reference = this.storeObject(current.sourceTuple.document_id, payload.object_type, payload.payload, current.sourceTuple.revision, recordedAt);
      refs[`${payload.object_type}:${reference.sha256}`] = reference;
    }
    const event = this.makeEvent('external-current-sync', current, stagedManifest, refs, {
      operationKind: 'external-current-sync',
      status: 'reconciled',
      committed: true,
      message: 'A legacy/current writer advanced CURRENT_TASK before the sidecar commit was observed.',
      recordedAt,
    });
    const eventPath = this.writeEvent(event);
    const index = this.readIndex();
    this.appendIndexes(event, index);
    const manifest = this.buildManifest(current, previous, { definition, state, currentSnapshot: state, ...(previous.object_refs.legacy_source ? { legacySource: previous.object_refs.legacy_source } : {}) }, event, previous.counts.objects + this.newlyReferencedObjects.size, index.length, recordedAt);
    this.writeManifest(manifest);
    rememberCommittedObjectReferences(this.paths, manifest, Object.values(event.object_refs));
    return manifest;
  }

  /** Record one committed Runtime transaction without duplicating unchanged objects. */
  recordCommit(input: TaskStoreCommitInput): TaskStoreManifest | null {
    this.assertCurrentIdentity(input.before);
    this.assertCurrentIdentity(input.after);
    if (!input.result.committed) return this.manifest;
    this.newlyReferencedObjects.clear();
    const previous = this.ensureInitialized(input.before, input.recorded_at);
    // Initialization/reconciliation has its own manifest count.  Count only
    // objects created by this transaction from this point onward; scanning a
    // growing directory for every commit made long audit runs needlessly
    // quadratic on Windows.
    this.newlyReferencedObjects.clear();
    const key = input.result.idempotency_key ?? (record(input.proposal) && typeof input.proposal.idempotency_key === 'string' ? input.proposal.idempotency_key : null);
    const proposalHash = proposalDigest(input.proposal);
    let recoveryPending = false;
    const pending = this.readPending();
    if (pending) {
      if (pending.sequence <= previous.head.event_sequence) {
        this.clearPending();
      } else if (pending.sequence !== previous.head.event_sequence + 1
        || pending.source_revision !== input.before.sourceTuple.revision
        || pending.resulting_source_revision !== input.after.sourceTuple.revision
        || pending.idempotency_key !== key
        || pending.proposal_digest !== proposalHash) {
        throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'an unfinished task-store transaction does not match this commit request.');
      } else {
        if (pending.proposal !== undefined && digest(pending.proposal) !== digest(input.proposal)) {
          throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'pending task-store intent contains different proposal bytes.');
        }
        recoveryPending = true;
      }
    }
    if (key && proposalHash) {
      const prior = this.lookupIdempotency(key);
      if (prior) {
        if (prior.proposal_digest !== proposalHash) throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', `idempotency key ${key} is bound to different proposal bytes.`);
        return previous;
      }
    }
    this.writePending({
      schema_version: 1,
      kind: 'vnext-task-store-pending-commit',
      document_id: input.after.sourceTuple.document_id,
      sequence: previous.head.event_sequence + 1,
      source_revision: input.before.sourceTuple.revision,
      resulting_source_revision: input.after.sourceTuple.revision,
      idempotency_key: key,
      proposal_digest: proposalHash,
      phase: 'current-published',
      proposal: input.proposal,
      result: input.result,
      write_targets: [input.after.relativePath],
      ...(pending?.before_raw === undefined ? {} : { before_raw: pending.before_raw }),
      ...(pending?.after_raw === undefined ? {} : { after_raw: pending.after_raw }),
      ...(pending?.before_runtime_state === undefined ? {} : { before_runtime_state: pending.before_runtime_state }),
      ...(pending?.after_runtime_state === undefined ? {} : { after_runtime_state: pending.after_runtime_state }),
      ...(pending?.execution_log_entries === undefined ? {} : { execution_log_entries: pending.execution_log_entries }),
      ...(pending?.applied_proposals === undefined ? {} : { applied_proposals: pending.applied_proposals }),
      ...(pending?.write_set === undefined ? {} : { write_set: pending.write_set }),
      previous_manifest_head: {
        source_revision: previous.head.source_revision,
        event_sequence: previous.head.event_sequence,
        event_hash: previous.head.event_hash,
      },
    });
    const definitionAlgorithm = compactCurrent(input.after) ? TASK_DEFINITION_REVISION_V2 : previous.definition_revision_algorithm;
    const definition = this.storeObject(input.after.sourceTuple.document_id, 'definition', storedCurrentPayload(input.after, 'definition', definitionPayload(input.after, definitionAlgorithm)), input.after.sourceTuple.revision, input.recorded_at);
    const state = this.storeObject(input.after.sourceTuple.document_id, 'state', storedCurrentPayload(input.after, 'state', stateSnapshotPayload(input.after)), input.after.sourceTuple.revision, input.recorded_at);
    const refs: Record<string, TaskStoreObjectReference | string | null> = {
      definition,
      state,
    };
    const proposalRecord = record(input.proposal) ? input.proposal : null;
    const proposalSemanticDelta = proposalRecord && record(proposalRecord.semantic_delta) ? proposalRecord.semantic_delta : null;
    const proposalClaimEvidenceReference = proposalSemanticDelta && proposalSemanticDelta.claim_evidence !== undefined
      ? this.storeObject(input.after.sourceTuple.document_id, 'other', {
        schema_version: 1,
        kind: 'vnext-execution-claim-evidence/v1',
        claim_evidence: proposalSemanticDelta.claim_evidence,
      }, input.after.sourceTuple.revision, input.recorded_at)
      : undefined;
    const proposalExecutionResultReference = proposalSemanticDelta && proposalSemanticDelta.execution_result !== undefined
      ? this.storeObject(input.after.sourceTuple.document_id, 'result', proposalSemanticDelta.execution_result, input.after.sourceTuple.revision, input.recorded_at)
      : undefined;
    const proposalReference = this.storeObject(
      input.after.sourceTuple.document_id,
      'proposal',
      storedProposalPayload(input.proposal, proposalClaimEvidenceReference, proposalExecutionResultReference),
      input.after.sourceTuple.revision,
      input.recorded_at,
    );
    const resultReference = this.storeObject(
      input.after.sourceTuple.document_id,
      'result',
      input.result,
      input.after.sourceTuple.revision,
      input.recorded_at,
    );
    refs.proposal = proposalReference;
    refs.result = resultReference;
    if (proposalClaimEvidenceReference) refs['proposal-claim-evidence'] = proposalClaimEvidenceReference;
    if (proposalExecutionResultReference) refs['proposal-execution-result'] = proposalExecutionResultReference;
    if (input.result.operation_kind === 'task-storage-migration'
      || (previous.current_representation !== currentRepresentation(input.after) && compactCurrent(input.after))) {
      const locatorAlias = this.storeObject(
        input.after.sourceTuple.document_id,
        'history-material',
        legacyLocatorPayload(input.before.raw, input.before.sourceTuple.revision, input.before.relativePath, input.after.sourceTuple.revision),
        input.after.sourceTuple.revision,
        input.recorded_at,
      );
      refs['legacy-locator-alias'] = locatorAlias;
    }
    for (const payload of collectObjectPayloads(input.after, false, this.paths.root, input.before)) {
      const reference = this.storeObject(input.after.sourceTuple.document_id, payload.object_type, payload.payload, input.after.sourceTuple.revision, input.recorded_at);
      const keyName = `${payload.object_type}:${reference.sha256}`;
      refs[keyName] = reference;
    }
    refs.current_snapshot = state;
    const executionEntries = newlyAppendedExecutionEntries(input.before, input.after);
    executionEntries.forEach((entry, index) => {
      const entryRecord = record(entry) ? entry : null;
      const claimEvidenceReference = entryRecord && entryRecord.claim_evidence !== undefined
        ? this.storeObject(input.after.sourceTuple.document_id, 'other', {
          schema_version: 1,
          kind: 'vnext-execution-claim-evidence/v1',
          claim_evidence: entryRecord.claim_evidence,
        }, input.after.sourceTuple.revision, input.recorded_at)
        : undefined;
      const executionResultReference = entryRecord && entryRecord.execution_result !== undefined
        ? this.storeObject(input.after.sourceTuple.document_id, 'result', entryRecord.execution_result, input.after.sourceTuple.revision, input.recorded_at)
        : undefined;
      const executionEntryReference = this.storeObject(
        input.after.sourceTuple.document_id,
        'execution-log-entry',
        storedExecutionEntryPayload(entry, claimEvidenceReference, executionResultReference),
        input.after.sourceTuple.revision,
        input.recorded_at,
      );
      refs[`execution-log-entry:${String(index).padStart(6, '0')}:${executionEntryReference.sha256}`] = executionEntryReference;
      if (claimEvidenceReference) refs[`execution-claim-evidence:${String(index).padStart(6, '0')}:${claimEvidenceReference.sha256}`] = claimEvidenceReference;
      if (executionResultReference) refs[`execution-result:${String(index).padStart(6, '0')}:${executionResultReference.sha256}`] = executionResultReference;
    });
    const stagedManifest: TaskStoreManifest = {
      ...previous,
      head: {
        ...previous.head,
        source_revision: input.before.sourceTuple.revision,
        definition_revision: taskStoreDefinitionRevision(input.after, definitionAlgorithm),
        state_revision: taskStoreStateRevision(input.after),
      },
    };
    const operationKind = input.result.operation_kind ?? (proposalRecord && typeof proposalRecord.operation_kind === 'string' ? proposalRecord.operation_kind : 'unknown');
    const recoveredEvent = recoveryPending
      ? this.findOrphanTransaction(previous, input.after, definition, state, key, proposalHash, input.proposal, proposalReference, operationKind)
      : null;
    const eventType = input.result.operation_kind === 'task-storage-migration' ? 'storage-migration' : 'transaction';
    const event = recoveredEvent ?? this.makeEvent(eventType, input.after, stagedManifest, refs, {
        operationKind,
        idempotencyKey: key,
        proposalDigest: proposalHash,
        status: input.result.status,
        committed: input.result.committed,
        message: input.result.message,
        code: input.result.code,
        recordedAt: input.recorded_at,
        transaction: { proposal: proposalReference, result: resultReference },
      });
    const eventPath = recoveredEvent
      ? relativePath(this.paths.root, eventFile(this.paths, recoveredEvent.sequence, recoveredEvent.event_hash))
      : this.writeEvent(event);
    const index = this.readIndex();
    if (key && proposalHash) index.push({
      idempotency_key: key,
      operation_kind: event.operation_kind,
      proposal_digest: proposalHash,
      source_revision: input.before.sourceTuple.revision,
      event_path: eventPath,
      event_id: event.event_id,
      sequence: event.sequence,
      legacy: false,
    });
    const uniqueIndex = [...new Map(index.map(item => [stableJson(item), item])).values()];
    this.appendIndexes(event, uniqueIndex);
    const manifest = this.buildManifest(input.after, previous, {
      definition,
      state,
      currentSnapshot: state,
      ...(previous.object_refs.legacy_source ? { legacySource: previous.object_refs.legacy_source } : {}),
    }, event, previous.counts.objects + this.newlyReferencedObjects.size, uniqueIndex.length, input.recorded_at, {
      definition: definitionAlgorithm,
      representation: compactCurrent(input.after) ? currentRepresentation(input.after) : previous.current_representation,
    });
    this.writeManifest(manifest);
    rememberCommittedObjectReferences(this.paths, manifest, Object.values(event.object_refs));
    if (key && proposalHash) {
      rememberIdempotencyMatches(this.paths, manifest, [{
        idempotency_key: key,
        operation_kind: event.operation_kind,
        proposal_digest: proposalHash,
        source_revision: input.before.sourceTuple.revision,
        event_path: eventPath,
        event_id: event.event_id,
        sequence: event.sequence,
        legacy: false,
        event,
      }]);
    }
    this.clearPending();
    return manifest;
  }

  lookupIdempotency(idempotencyKey: string): TaskStoreIdempotencyMatch | null {
    const manifest = this.manifest;
    if (!manifest) return null;
    let entries = this.readIndex();
    let matches = entries.filter(item => item.idempotency_key === idempotencyKey && item.sequence <= manifest.head.event_sequence);
    if (matches.length === 0) {
      // A missing key is expected for every first-seen proposal. Replaying
      // the whole event directory on that path made a long audit run
      // quadratic. Build the authoritative event fallback once per aggregate
      // head, then answer subsequent misses from that verified map.
      const cachedMatches = loadIdempotencyEventCache(this.paths, manifest).byKey.get(idempotencyKey) ?? [];
      matches = cachedMatches.map(match => ({
        idempotency_key: match.idempotency_key,
        operation_kind: match.operation_kind,
        proposal_digest: match.proposal_digest,
        source_revision: match.source_revision,
        event_path: match.event_path,
        event_id: match.event_id,
        sequence: match.sequence,
        legacy: match.legacy,
      }));
    }
    if (matches.length === 0) return null;
    const proposalDigests = new Set(matches.map(item => item.proposal_digest));
    if (proposalDigests.size > 1) {
      throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', `idempotency key ${idempotencyKey} has multiple committed proposal payloads; the historical query is ambiguous.`);
    }
    // Multiple exact index rows can occur when a legacy JSON index and its
    // append-journal successor are both retained. They are the same event
    // fact after readIndex de-duplication, so selecting the first is safe.
    const entry = matches[0]!;
    // Re-read the exact event file even when the process-local fallback map
    // has a matching entry. This detects deletion or tampering after the map
    // was built and re-checks membership in the committed event chain.
    const event = this.readEvent(entry.event_path);
    let legacyEntryVerified = false;
    if (entry.legacy && event.event_type === 'legacy-import' && event.proposal_digest === null) {
      const legacyRef = manifest.object_refs.legacy_source;
      if (legacyRef) {
        const legacy = this.readObject(legacyRef);
        const applied = legacyAppliedProposals(legacy);
        legacyEntryVerified = applied.some(item => record(item) && item.idempotency_key === entry.idempotency_key && item.proposal_digest === entry.proposal_digest && item.operation_kind === entry.operation_kind);
      }
    }
    if (event.document_id !== this.paths.documentId || event.event_id !== entry.event_id || event.sequence !== entry.sequence || (event.idempotency_key !== entry.idempotency_key && !legacyEntryVerified) || (event.proposal_digest !== entry.proposal_digest && !legacyEntryVerified)) {
      throw new TaskStoreError('TASK_STORE_INDEX_INVALID', `idempotency index entry ${idempotencyKey} does not point to the committed event.`);
    }
    return { ...entry, event };
  }

  latestEvents(limit = 16): TaskStoreEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new TaskStoreError('TASK_STORE_INDEX_INVALID', 'latest event limit must be 1..256.');
    return this.listEvents().slice(-limit);
  }

  measure(): TaskStoreMeasure {
    const objects = directoryBytes(this.paths.objects);
    const events = directoryBytes(this.paths.events);
    const indexes = directoryBytes(this.paths.indexes);
    const manifestBytes = fs.existsSync(this.paths.manifest) ? fs.statSync(this.paths.manifest).size : 0;
    return {
      document_id: this.paths.documentId,
      root: this.paths.relativeRoot,
      total_bytes: objects.bytes + events.bytes + indexes.bytes + manifestBytes,
      files: objects.files + events.files + indexes.files + (manifestBytes > 0 ? 1 : 0),
      objects_bytes: objects.bytes,
      events_bytes: events.bytes,
      indexes_bytes: indexes.bytes,
      manifest_bytes: manifestBytes,
    };
  }

  /** Validate only the committed head and its directly referenced objects. */
  validateCurrentAggregate(current: TaskStoreCurrent): TaskStoreCurrentValidationReport {
    const errors: string[] = [];
    const manifestPath = this.paths.relativeRoot + '/' + TASK_STORE_MANIFEST_FILE;
    let manifest: TaskStoreManifest | null = null;
    try { manifest = this.manifest; } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    if (!manifest) {
      return {
        status: errors.length > 0 ? 'invalid' : 'unavailable',
        validation_scope: 'current-aggregate',
        document_id: this.paths.documentId,
        manifest_path: manifestPath,
        verified_objects: 0,
        verified_head_event: false,
        errors,
      };
    }
    try {
      this.assertCurrentIdentity(current);
      if (manifest.current_task_path !== current.relativePath) errors.push('manifest current_task_path does not match CURRENT_TASK.');
      if (manifest.task_id !== current.sourceTuple.task_id || manifest.task_slug !== current.sourceTuple.task_slug) errors.push('manifest task identity does not match CURRENT_TASK.');
      if (manifest.head.source_revision !== current.sourceTuple.revision) errors.push('manifest head source_revision does not match CURRENT_TASK.');
      if (currentRepresentation(current) === ACTIVE_TASK_FORMAT) {
        const binding = current.frontmatter!.task_store as Record<string, any>;
        if (stableJson(binding.projection.definition) !== stableJson(manifest.object_refs.definition)
          || stableJson(binding.projection.state) !== stableJson(manifest.object_refs.state)) errors.push('projection roots differ from the committed aggregate.');
        for (const object of projectionMaterial(current)!.objects) this.readObject({ object_type: object.object_type, sha256: projectionDigest(object) });
      }
      const expectedDefinitionRevision = taskStoreDefinitionRevision(current, manifest.definition_revision_algorithm);
      const expectedStateRevision = taskStoreStateRevision(current);
      if (manifest.head.definition_revision !== expectedDefinitionRevision) errors.push('manifest definition revision does not match the governed CURRENT_TASK definition.');
      if (manifest.head.state_revision !== expectedStateRevision || manifest.object_refs.current_snapshot.sha256 !== manifest.object_refs.state.sha256) errors.push('manifest state revision does not match the governed CURRENT_TASK state.');
      const currentReferences = new Map<string, TaskStoreObjectReference>();
      for (const ref of [manifest.object_refs.definition, manifest.object_refs.state, manifest.object_refs.current_snapshot, manifest.object_refs.legacy_source].filter(Boolean) as TaskStoreObjectReference[]) {
        this.readObject(ref);
        currentReferences.set(ref.sha256, ref);
      }
      let verifiedHeadEvent = false;
      if (manifest.head.event_sequence === 0 || manifest.head.event_hash === null) {
        if (manifest.head.event_sequence !== 0 || manifest.head.event_hash !== null || manifest.head.event_id !== null) errors.push('manifest has an incomplete empty event head.');
      } else {
        if (manifest.head.event_id === null) errors.push('manifest head event_id is missing.');
        const event = this.readEvent({ sequence: manifest.head.event_sequence, event_hash: manifest.head.event_hash });
        if (event.event_id !== manifest.head.event_id || event.resulting_source_revision !== current.sourceTuple.revision) errors.push('manifest head event does not result in the current source revision.');
        verifiedHeadEvent = true;
      }
      return {
        status: errors.length === 0 ? 'valid' : 'invalid',
        validation_scope: 'current-aggregate',
        document_id: this.paths.documentId,
        manifest_path: manifestPath,
        verified_objects: errors.length === 0 ? currentReferences.size : 0,
        verified_head_event: verifiedHeadEvent,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return {
        status: 'invalid',
        validation_scope: 'current-aggregate',
        document_id: this.paths.documentId,
        manifest_path: manifestPath,
        verified_objects: 0,
        verified_head_event: false,
        errors,
      };
    }
  }

  deepValidate(): TaskStoreValidationReport {
    const errors: string[] = [];
    let manifest: TaskStoreManifest | null = null;
    try { manifest = this.manifest; } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    let objects = 0;
    let events = 0;
    let idempotency = 0;
    if (manifest) {
      const verifiedObjectHashes = new Set<string>();
      const verifyObject = (ref: TaskStoreObjectReference): void => {
        if (verifiedObjectHashes.has(ref.sha256)) return;
        try {
          this.readObject(ref);
          verifiedObjectHashes.add(ref.sha256);
        } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      };
      for (const ref of [manifest.object_refs.definition, manifest.object_refs.state, manifest.object_refs.current_snapshot, manifest.object_refs.legacy_source].filter(Boolean) as TaskStoreObjectReference[]) {
        verifyObject(ref);
      }
      let previous: string | null = null;
      try {
        const allEvents = this.listEvents();
        for (const event of allEvents) {
          if (event.sequence !== events + 1) errors.push(`event sequence gap at ${event.sequence}`);
          if (event.previous_event_hash !== previous) errors.push(`event chain mismatch at ${event.event_id}`);
          previous = event.event_hash;
          events++;
          for (const ref of Object.values(event.object_refs)) {
            if (ref === null) continue;
            verifyObject(ref as TaskStoreObjectReference);
          }
        }
        if (manifest.head.event_hash !== previous || manifest.head.event_sequence !== (allEvents.at(-1)?.sequence ?? 0)) errors.push('manifest head does not match the full event chain.');
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      try {
        const entries = this.readIndex();
        idempotency = entries.length;
        for (const entry of entries) this.lookupIdempotency(entry.idempotency_key);
        if (entries.length !== manifest.counts.idempotency_entries) errors.push('manifest idempotency count differs from the index.');
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      if (manifest.counts.events !== events) errors.push('manifest event count differs from the event directory.');
      objects = verifiedObjectHashes.size;
      if (manifest.counts.objects !== objects) errors.push(`manifest object count ${manifest.counts.objects} differs from committed references ${objects}.`);
    }
    return {
      status: errors.length === 0 && manifest !== null ? 'valid' : 'invalid',
      validation_scope: 'aggregate-and-full-history',
      document_id: this.paths.documentId,
      manifest_path: this.paths.relativeRoot + '/' + TASK_STORE_MANIFEST_FILE,
      verified_objects: objects,
      verified_events: events,
      verified_idempotency_entries: idempotency,
      errors,
    };
  }

  exportAggregate(): { manifest: TaskStoreManifest; objects: Array<{ sha256: string; object: TaskStoreObject }>; events: TaskStoreEvent[]; measure: TaskStoreMeasure } {
    const manifest = this.manifest;
    if (!manifest) throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', 'task store is not initialized.');
    const references = new Map<string, TaskStoreObjectReference>();
    const add = (value: TaskStoreObjectReference | string | null | undefined): void => {
      if (!value || typeof value === 'string') return;
      references.set(value.sha256, value);
    };
    add(manifest.object_refs.definition);
    add(manifest.object_refs.state);
    add(manifest.object_refs.current_snapshot);
    add(manifest.object_refs.legacy_source);
    const events = this.listEvents();
    for (const event of events) for (const value of Object.values(event.object_refs)) add(value);
    const objects: Array<{ sha256: string; object: TaskStoreObject }> = [...references.values()]
      .map(reference => ({ sha256: reference.sha256, object: this.readObject(reference) }));
    return { manifest, objects: objects.sort((a, b) => a.sha256.localeCompare(b.sha256)), events, measure: this.measure() };
  }
}

export function taskStoreForRoot(root: string, documentId: string): TaskStore {
  return new TaskStore(root, documentId);
}

export function taskStoreDefinitionPayload(current: TaskStoreCurrent, algorithm: TaskStoreManifest['definition_revision_algorithm'] = TASK_DEFINITION_REVISION_V2): Record<string, unknown> {
  return definitionPayload(current, algorithm);
}

export function taskStoreStateSnapshotPayload(current: TaskStoreCurrent): Record<string, unknown> {
  return stateSnapshotPayload(current);
}

export function taskStoreDefinitionRevision(current: TaskStoreCurrent, algorithm: TaskStoreManifest['definition_revision_algorithm'] = TASK_DEFINITION_REVISION_V2): string {
  return digest(definitionPayload(current, algorithm));
}

export function taskStoreDefinitionRevisionForManifest(current: TaskStoreCurrent, manifest: TaskStoreManifest | null): string {
  return taskStoreDefinitionRevision(current, manifest?.definition_revision_algorithm ?? TASK_DEFINITION_REVISION_V2);
}

export function taskStoreStateRevision(current: TaskStoreCurrent): string {
  return digest(stateSnapshotPayload(current));
}

export function taskStoreHistoryPath(root: string, current: TaskStoreCurrent, sourceRevision: string): string {
  if (!SHA256.test(sourceRevision)) throw new TaskStoreError('TASK_STORE_PATH_INVALID', 'history source revision is invalid.');
  const directory = path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id);
  const rootResolved = path.resolve(root);
  const normalized = relativePath(rootResolved, directory);
  return path.join(rootResolved, ...path.posix.join(normalized, `${sourceRevision}.json`).split('/'));
}

export type TaskStorageMigrationPreview = {
  status: 'preview' | 'already-migrated';
  operation_kind: 'task-storage-migration';
  document_id: string;
  source_revision: string;
  current_task_path: string;
  manifest_path: string;
  legacy_bytes: number;
  projected_bytes: number;
  definition_revision: string;
  state_revision: string;
  existing_store: boolean;
  semantic_model_digest: string;
  planned_objects: string[];
  planned_events: string[];
};

function compactHistoryBody(body: string, executionLog: readonly unknown[]): string {
  const normalized = body.replace(/\r\n?/gu, '\n');
  const headings = [...normalized.matchAll(/^##\s+(.+?)\s*$/gmu)];
  const index = headings.findIndex(match => ['执行记录', 'Execution Log'].includes(match[1]!.trim()));
  if (index < 0) throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', 'CURRENT_TASK is missing ## 执行记录 for compact migration.');
  const heading = headings[index]!;
  const contentStart = (heading.index ?? 0) + heading[0].length;
  const nextHeading = headings.slice(index + 1).find(match => (match[0]!.match(/^#/u)?.[0].length ?? 2) <= 2);
  const contentEnd = nextHeading?.index ?? normalized.length;
  const previews = executionLog.filter(record).slice(-8).map(item => {
    const action = typeof item.action === 'string' ? item.action : 'step-execution';
    const key = typeof item.idempotency_key === 'string' ? item.idempotency_key : 'unknown';
    const step = typeof item.step_id === 'string' ? ` | step=${item.step_id}` : '';
    const status = typeof item.status === 'string' ? ` | status=${item.status}` : '';
    return `- ${action} | key=${key}${step}${status}`;
  });
  let preview = [
    '- Store-backed history is retained under task-data; use task-read for exact historical reads.',
    '- This section is a bounded navigation preview and is not the Runtime fact source.',
    ...(previews.length > 0 ? ['', ...previews] : []),
  ].join('\n');
  if (Buffer.byteLength(preview, 'utf8') > 8192) preview = Buffer.from(preview, 'utf8').subarray(0, 8192).toString('utf8');
  return normalized.slice(0, contentStart) + `\n${preview}\n\n` + normalized.slice(contentEnd);
}

function compactCurrentRaw(current: TaskStoreCurrent, store: TaskStore): PreparedTaskContent {
  const frontmatter = structuredClone(current.frontmatter ?? {}) as Record<string, unknown>;
  const runtime = withoutInlineReviewPreimageContent(current.runtimeState);
  delete runtime.execution_log;
  delete runtime.applied_proposals;
  frontmatter.runtime_state = runtime;
  frontmatter.task_store = {
    schema_version: 1, kind: 'vnext-current-task-store-binding', format: ACTIVE_TASK_FORMAT,
    manifest_path: `${store.paths.relativeRoot}/manifest.json`,
    history: { execution_log: 'task-store', applied_proposals: 'task-store' },
  };
  const body = compactHistoryBody(current.body, Array.isArray(current.runtimeState.execution_log) ? current.runtimeState.execution_log : []);
  return prepareTaskProjection(`---\n${stringify(frontmatter).trimEnd()}\n---\n${body}`);
}

function compactAfter(current: TaskStoreCurrent, prepared: PreparedTaskContent): TaskStoreCurrent {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(prepared.expandedContent)!;
  const frontmatter = parse(match[1]!) as Record<string, unknown>;
  return { ...current, raw: prepared.content, body: prepared.expandedContent.slice(match[0].length), frontmatter,
    runtimeState: withoutInlineReviewPreimageContent(current.runtimeState),
    sourceTuple: { ...current.sourceTuple, revision: sha256(prepared.content) } };
}

export function migrationSemanticModel(current: TaskStoreCurrent): unknown {
  return {
    identity: {
      path: current.relativePath,
      document_id: current.sourceTuple.document_id,
      task_id: current.sourceTuple.task_id,
      task_slug: current.sourceTuple.task_slug,
    },
    frontmatter: copyWithout(current.frontmatter ?? {}, ['task_store', 'runtime_state']),
    // The representation change removes only the two compatibility history
    // arrays from the canonical file. All other runtime state must compare
    // byte-for-byte at the normalized value level.
    runtime_state: copyWithout(withoutInlineReviewPreimageContent(current.runtimeState), ['execution_log', 'applied_proposals']),
    definition_sections: definitionSections(current, true).filter(section => !['执行记录', 'Execution Log'].includes(section.title)),
  };
}

function hasLegacyInlineReviewPreimages(current: TaskStoreCurrent): boolean {
  const coverage = record(current.runtimeState.review_coverage) ? current.runtimeState.review_coverage : null;
  return Array.isArray(coverage?.preimages)
    && coverage.preimages.some(item => record(item) && Object.prototype.hasOwnProperty.call(item, 'content_base64'));
}

/** Return exact preimages only for a committed storage-migration-only suffix.
 * Storage proves the event lineage and physical bytes; the kernel must compare
 * their normalized logical models using the same parser as the current task.
 * A non-storage transaction, orphan or pending publication is never an alias.
 */
export function readStorageMigrationLineage(root: string, current: TaskStoreCurrent, sourceRevision: string): string[] | null {
  if (!SHA256.test(sourceRevision)) return null;
  const store = TaskStore.forCurrent(root, current);
  const manifest = store.manifest;
  if (!manifest || store.hasPendingCommit || manifest.head.source_revision !== current.sourceTuple.revision
    || sha256(current.raw) !== current.sourceTuple.revision) return null;
  let revision = current.sourceTuple.revision;
  const preimages: string[] = [];
  const events = store.listEvents(); // Validates the complete committed hash chain.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.resulting_source_revision !== revision || event.event_type !== 'storage-migration'
      || event.operation_kind !== 'task-storage-migration' || !event.metadata.committed
      || event.metadata.status !== 'success') return null;
    const raw = store.readHistoryMaterial(event.source_revision);
    if (raw === null || sha256(raw) !== event.source_revision) return null;
    preimages.push(raw);
    if (event.source_revision === sourceRevision) return preimages;
    revision = event.source_revision;
  }
  return null;
}

export function previewTaskStorageMigration(root: string, current: TaskStoreCurrent): TaskStorageMigrationPreview {
  const store = TaskStore.forCurrent(root, current);
  const manifest = store.manifest;
  const legacyInlineReviewPreimages = hasLegacyInlineReviewPreimages(current);
  const definitionRevision = taskStoreDefinitionRevision(current);
  const stateRevision = taskStoreStateRevision(current);
  return {
    status: manifest?.current_representation === ACTIVE_TASK_FORMAT && !legacyInlineReviewPreimages ? 'already-migrated' : 'preview',
    operation_kind: 'task-storage-migration',
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    current_task_path: current.relativePath,
    manifest_path: `${store.paths.relativeRoot}/${TASK_STORE_MANIFEST_FILE}`,
    legacy_bytes: Buffer.byteLength(current.raw),
    projected_bytes: Buffer.byteLength(compactCurrentRaw(current, store).content),
    definition_revision: definitionRevision,
    state_revision: stateRevision,
    existing_store: manifest !== null,
    semantic_model_digest: digest({ task_id: current.sourceTuple.task_id, task_slug: current.sourceTuple.task_slug, workflow_status: current.sourceTuple.workflow_status, lifecycle_state: current.sourceTuple.lifecycle_state, active_step_id: current.sourceTuple.active_step_id, definition_revision: definitionRevision, state_revision: stateRevision }),
    planned_objects: ['definition', 'state', 'other', 'evidence-report', 'review-receipt', 'legacy-current-task'],
    planned_events: manifest?.current_representation === ACTIVE_TASK_FORMAT && !legacyInlineReviewPreimages ? [] : [manifest ? 'storage-migration' : 'legacy-import', 'storage-migration'],
  };
}

export function commitTaskStorageMigration(root: string, current: TaskStoreCurrent, sourceRevision: string): { status: 'committed' | 'no-op'; operation_kind: 'task-storage-migration'; source_revision: string; manifest: TaskStoreManifest } {
  const store = TaskStore.forCurrent(root, current);
  const existing = store.manifest;
  if (sourceRevision !== current.sourceTuple.revision) {
    // The exact migration may have published CURRENT_TASK before its caller
    // observed success. Only its acknowledged resulting head is a replay;
    // another state change remains stale and cannot be silently adopted.
    const previous = SHA256.test(sourceRevision)
      ? store.lookupIdempotency(`task-storage-migration-v3-${current.sourceTuple.document_id}-${sourceRevision.slice(0, 16)}`) : null;
    if (existing?.current_representation === ACTIVE_TASK_FORMAT
      && existing.head.source_revision === current.sourceTuple.revision
      && previous?.source_revision === sourceRevision
      && previous.event.event_type === 'storage-migration'
      && previous.event.resulting_source_revision === current.sourceTuple.revision) {
      return { status: 'no-op', operation_kind: 'task-storage-migration', source_revision: sourceRevision, manifest: existing };
    }
    throw new TaskStoreError('TASK_STORE_MIGRATION_SOURCE_STALE', 'migration source_revision does not match the exact current CURRENT_TASK bytes.');
  }
  const legacyInlineReviewPreimages = hasLegacyInlineReviewPreimages(current);
  if (existing?.current_representation === ACTIVE_TASK_FORMAT && !legacyInlineReviewPreimages) {
    if (existing.head.source_revision !== current.sourceTuple.revision) throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'compact task-store manifest does not match the requested migration source.');
    return { status: 'no-op', operation_kind: 'task-storage-migration', source_revision: sourceRevision, manifest: existing };
  }
  // Decode and publish legacy review baselines before the canonical compact
  // representation can refer to their digest-only identities. A failed
  // decode or blob write leaves CURRENT_TASK untouched and therefore still
  // readable through its legacy inline baseline.
  const coverage = record(current.runtimeState.review_coverage) ? current.runtimeState.review_coverage : null;
  if (coverage && Array.isArray(coverage.preimages)) persistLegacyReviewPreimages(root, coverage.preimages);
  store.ensureInitialized(current);
  const prepared = compactCurrentRaw(current, store);
  const compactRaw = prepared.content;
  const after = compactAfter(current, prepared);
  if (digest(migrationSemanticModel(current)) !== digest(migrationSemanticModel(after))) {
    throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'storage migration changed the normalized task model outside its representation boundary.');
  }
  const proposal = {
    schema_version: 1,
    kind: 'vnext-storage-migration-proposal',
    operation_kind: 'task-storage-migration',
    idempotency_key: `task-storage-migration-v3-${current.sourceTuple.document_id}-${sourceRevision.slice(0, 16)}`,
    source_revision: sourceRevision,
  };
  const result = { status: 'success', committed: true, operation_kind: 'task-storage-migration', idempotency_key: proposal.idempotency_key } as const;
  persistTaskProjection(prepared, current.filePath, current.relativePath);
  store.stageCommit({ before: current, after, after_source_revision: after.sourceTuple.revision, proposal, result, write_targets: [current.relativePath] });
  atomicWrite(current.filePath, compactRaw);
  store.markCurrentPublished(after.sourceTuple.revision);
  const manifest = store.recordCommit({ before: current, after, proposal, result });
  if (!manifest || manifest.current_representation !== ACTIVE_TASK_FORMAT || manifest.head.source_revision !== after.sourceTuple.revision) {
    throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'compact migration did not publish a matching aggregate head.');
  }
  return { status: 'committed', operation_kind: 'task-storage-migration', source_revision: sourceRevision, manifest };
}
