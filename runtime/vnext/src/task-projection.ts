/**
 * Lossless CURRENT_TASK wire representation. The file selects immutable task
 * material; it is not a second editable definition. No workflow decisions are
 * made here, and building a projection performs no I/O (including in dry runs).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import type { TaskStoreObject, TaskStoreObjectReference, TaskStoreObjectType } from './task-store';

type RecordValue = Record<string, any>;
type StoredValue = { value: unknown } | { ref: TaskStoreObjectReference };
export type PreparedTaskContent = {
  content: string;
  expandedContent: string;
  objects: TaskStoreObject[];
};
export const ACTIVE_TASK_FORMAT = 'compact-v3' as const;
const DYNAMIC_SECTIONS = new Set(['任务信息', 'Task Information', '执行记录', 'Execution Log', '审查问题队列', 'Review Queue', '传播治理记录', 'Propagation Governance']);
const SLOT_STATE = ['disposition', 'evidence_refs', 'report', 'prerequisite_receipt', 'user_decision'] as const;
const HOT_FIELDS = ['schema_version', 'task_id', 'task_slug', 'workflow_status', 'lifecycle_state', 'active_step_id', 'active_step_status', 'finding_queue_revision', 'resume_requires_review', 'resume_review_reasons'];
const HASH = /^[a-f0-9]{64}$/u;
const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const without = (value: RecordValue, keys: readonly string[]): RecordValue => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
export function projectionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(projectionJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${projectionJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const projectionDigest = (value: unknown): string => crypto.createHash('sha256').update(projectionJson(value)).digest('hex');
function invalid(detail: string): never { throw new Error(`TASK_PROJECTION_INVALID: ${detail}`); }
function frontmatterOf(raw: string): { frontmatter: RecordValue; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (!match) return invalid('missing frontmatter');
  const frontmatter: unknown = parse(match[1]!);
  if (!isRecord(frontmatter)) return invalid('invalid frontmatter');
  return { frontmatter, body: raw.slice(match[0].length) };
}
function bodyParts(body: string): Array<{ title: string; text: string }> {
  const headings = [...body.matchAll(/^##[ \t]+(.+?)[ \t]*\r?$/gmu)];
  const parts = [{ title: '', text: body.slice(0, headings[0]?.index ?? body.length) }];
  headings.forEach((h, i) => parts.push({ title: h[1]!.trim(), text: body.slice(h.index!, headings[i + 1]?.index ?? body.length) }));
  return parts;
}
function excerpt(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.replace(/[\r\n|`]/gu, ' ').slice(0, max) : '';
}
function previewBody(body: string, runtime: RecordValue): string {
  const active = String(runtime.active_step_id ?? '');
  const parts = bodyParts(body);
  const steps = parts.find(p => ['实施步骤', 'Implementation Steps'].includes(p.title))?.text ?? '';
  const step = steps.split(/(?=^###\s)/mu).find(s => new RegExp(`^###\\s+${active.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:[\\s:：.、—-]|$)`, 'mu').test(s));
  const basis = parts.find(p => ['任务输入依据', 'Task Basis'].includes(p.title));
  const due = (Array.isArray(runtime.claim_evidence) ? runtime.claim_evidence : []).flatMap((claim: RecordValue) =>
    (Array.isArray(claim.slots) ? claim.slots : []).filter((slot: RecordValue) => slot.due_step_id === active).map((slot: RecordValue) =>
      `- ${excerpt(claim.claim_id, 64)} / ${excerpt(slot.slot_id, 64)} / ${excerpt(slot.check?.check_id, 64)}: ${excerpt(slot.report?.status ?? slot.disposition ?? 'missing', 64)}${slot.user_decision ? `; decision=${excerpt(slot.user_decision.kind ?? slot.user_decision.decision_id, 64)}` : ''}`));
  return [
    '# CURRENT_TASK', '',
    '> Runtime-generated active projection. References select the complete immutable definition and state.',
    '> This summary is not an execution grant. Use task-context/task-read for exact obligations, authority and evidence.', '',
    '## 当前步骤', `- ${excerpt(active)}${step ? ` — ${excerpt(step.split(/\r?\n/u)[0]!.replace(/^###\s*/u, ''))}` : ''}`,
    `- workflow: ${excerpt(runtime.workflow_status)}; lifecycle: ${excerpt(runtime.lifecycle_state)}; step: ${excerpt(runtime.active_step_status)}`, '',
    '## 当前到期证据', ...(due.length ? due : ['- none; inspect task-context for prerequisites and remaining obligations']), '',
    ...(basis ? [basis.text.trimEnd(), ''] : []),
    '## 精确读取', '- `task-context`: current definition, step, gates and dependencies (paged).',
    '- `task-read`: exact definition, state, report, review and historical material.',
    '- `task-export`: complete retained aggregate; no audit history is discarded.', '',
  ].join('\n');
}

/** Split stable definitions from changing state, and intern exact large values.
 * We preserve author-written Markdown verbatim; no heuristic semantic rewriting.
 */
export function prepareTaskProjection(expandedContent: string): PreparedTaskContent {
  const { frontmatter: fm, body } = frontmatterOf(expandedContent);
  if (!isRecord(fm.task_store) || !isRecord(fm.runtime_state) || !/^doc-[a-f0-9]{24}$/u.test(fm.document_id)) return invalid('projection requires a store-bound task');
  const runtime = without(fm.runtime_state, ['execution_log', 'applied_proposals']);
  const objects = new Map<string, TaskStoreObject>();
  const add = (object_type: TaskStoreObjectType, payload: unknown): TaskStoreObjectReference => {
    const object: TaskStoreObject = { schema_version: 1, kind: 'vnext-task-object', object_type, document_id: fm.document_id, payload };
    const sha256 = projectionDigest(object);
    objects.set(sha256, object);
    return { object_type, sha256 };
  };
  const storeValue = (value: unknown, objectType: TaskStoreObjectType = 'other', force = false): StoredValue => {
    if (value === undefined) return invalid('undefined stored value');
    if (!force && Buffer.byteLength(projectionJson(value)) < 512) return { value };
    return { ref: add(objectType, objectType === 'other' ? { kind: 'vnext-task-material/v1', value } : value) };
  };
  const dynamicBody: RecordValue = {};
  const sections = bodyParts(body).map((part, index) => {
    if (DYNAMIC_SECTIONS.has(part.title)) { dynamicBody[index] = storeValue(part.text, 'other', true); return { dynamic: index }; }
    return { text: storeValue(part.text, 'other', true) };
  });
  const claims = runtime.claim_evidence;
  const claimStates: unknown[] = [];
  const claimDefinitions = Array.isArray(claims) ? claims.map((claim: RecordValue) => {
    claimStates.push({ claim_id: claim.claim_id, slots: claim.slots.map((slot: RecordValue) => ({
      slot_id: slot.slot_id, fields: Object.fromEntries(SLOT_STATE.filter(k => slot[k] !== undefined).map(k => [k,
        storeValue(slot[k], k === 'report' ? 'evidence-report' : k === 'prerequisite_receipt' ? 'review-receipt' : 'other', slot[k] !== null && ['report', 'prerequisite_receipt', 'user_decision'].includes(k))])),
    })) });
    return storeValue({ ...without(claim, ['slots']), slots: claim.slots.map((slot: RecordValue) => without(slot, SLOT_STATE)) }, 'other', true);
  }) : null;
  const definition = add('definition', {
    kind: 'vnext-active-definition/v1',
    frontmatter: without(fm, ['runtime_state', 'task_store']),
    sections, claim_definitions: claimDefinitions,
  });
  const state = add('state', {
    kind: 'vnext-active-state/v1', definition,
    runtime: Object.fromEntries(Object.entries(without(runtime, Array.isArray(claims) ? ['claim_evidence'] : [])).map(([k, v]) => [k, storeValue(v)])),
    claim_states: claimStates, dynamic_body: dynamicBody,
  });
  const binding = { ...without(fm.task_store, ['projection']), format: ACTIVE_TASK_FORMAT, projection: { definition, state } };
  const hot = Object.fromEntries(HOT_FIELDS.filter(k => runtime[k] !== undefined).map(k => [k, runtime[k]]));
  const content = `---\n${stringify({ schema_version: fm.schema_version, kind: fm.kind, document_id: fm.document_id, task_store: binding, runtime_state: hot }).trimEnd()}\n---\n${previewBody(body, runtime)}`;
  const expanded = `---\n${stringify({ ...fm, task_store: binding, runtime_state: runtime }).trimEnd()}\n---\n${body}`;
  return { content, expandedContent: expanded, objects: [...objects.values()] };
}

function location(filePath: string, relativePath: string, documentId: string): { root: string; directory: string } {
  if (path.isAbsolute(relativePath) || relativePath.split('/').some(p => !p || p === '.' || p === '..') || !/^doc-[a-f0-9]{24}$/u.test(documentId)) return invalid('unsafe task location');
  let root = path.resolve(filePath);
  for (const _part of relativePath.split('/')) root = path.dirname(root);
  if (path.resolve(root, relativePath) !== path.resolve(filePath)) return invalid('task path mismatch');
  return { root, directory: path.join(root, path.posix.dirname(relativePath), 'task-data', documentId, 'objects') };
}
function safePath(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return invalid('material escapes project');
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) return invalid('material traverses a symbolic link');
  }
}
/** Unreferenced preparation is not a commit. The existing journal/manifest is
 * still responsible for publishing/acknowledging the complete object graph.
 */
export function persistTaskProjection(prepared: PreparedTaskContent, filePath: string, relativePath: string): void {
  if (!prepared.objects.length) return;
  const fm = frontmatterOf(prepared.content).frontmatter;
  const { root, directory } = location(filePath, relativePath, fm.document_id);
  safePath(root, directory);
  fs.mkdirSync(directory, { recursive: true });
  for (const object of prepared.objects) {
    const file = path.join(directory, `${projectionDigest(object)}.json`);
    safePath(root, file);
    const bytes = `${projectionJson(object)}\n`;
    if (fs.existsSync(file)) {
      if (!fs.lstatSync(file).isFile() || fs.readFileSync(file, 'utf8') !== bytes) return invalid('immutable material conflicts');
      continue;
    }
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx');
      try { fs.writeFileSync(fd, bytes, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary); }
  }
}

export function expandTaskProjection(raw: string, filePath: string, relativePath: string, prepared?: PreparedTaskContent): PreparedTaskContent {
  const { frontmatter: fm } = frontmatterOf(raw);
  if (fm.task_store?.format !== ACTIVE_TASK_FORMAT) return { content: raw, expandedContent: raw, objects: [] };
  const { root, directory } = location(filePath, relativePath, fm.document_id);
  if (fm.task_store.manifest_path !== `${path.posix.dirname(relativePath)}/task-data/${fm.document_id}/manifest.json`) return invalid('manifest identity mismatch');
  const supplied = new Map((prepared?.objects ?? []).map(obj => [projectionDigest(obj), obj]));
  const objects = new Map<string, TaskStoreObject>();
  const get = (ref: unknown, type?: string): any => {
    if (!isRecord(ref) || Object.keys(ref).sort().join(',') !== 'object_type,sha256' || !HASH.test(ref.sha256) || (type && ref.object_type !== type)) return invalid('invalid object reference');
    let object: any = objects.get(ref.sha256) ?? supplied.get(ref.sha256);
    if (!object) {
      const file = path.join(directory, `${ref.sha256}.json`); safePath(root, file);
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return invalid(`missing material ${ref.sha256}`);
      object = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    if (!isRecord(object) || object.kind !== 'vnext-task-object' || object.schema_version !== 1 || object.document_id !== fm.document_id || object.object_type !== ref.object_type || projectionDigest(object) !== ref.sha256) return invalid('material content/identity mismatch');
    objects.set(ref.sha256, object as TaskStoreObject);
    return object.payload;
  };
  const value = (stored: unknown): any => {
    if (!isRecord(stored) || Object.keys(stored).length !== 1) return invalid('invalid stored value');
    if ('value' in stored) return stored.value;
    if (!('ref' in stored)) return invalid('invalid stored reference');
    const payload = get(stored.ref);
    if (stored.ref.object_type !== 'other') return payload;
    if (!isRecord(payload) || payload.kind !== 'vnext-task-material/v1' || !('value' in payload)) return invalid('invalid material payload');
    return payload.value;
  };
  const projection = fm.task_store.projection;
  if (!isRecord(projection) || Object.keys(projection).sort().join(',') !== 'definition,state') return invalid('projection roots missing');
  const definition = get(projection.definition, 'definition');
  const state = get(projection.state, 'state');
  if (definition?.kind !== 'vnext-active-definition/v1' || state?.kind !== 'vnext-active-state/v1' || projectionJson(state.definition) !== projectionJson(projection.definition)) return invalid('definition/state roots disagree');
  if (!Array.isArray(definition.sections) || !Array.isArray(state.claim_states) || !isRecord(state.runtime) || !isRecord(state.dynamic_body) || !isRecord(definition.frontmatter)) return invalid('invalid material structure');
  const runtime = Object.fromEntries(Object.entries(state.runtime).map(([k, v]) => [k, value(v)]));
  if (Array.isArray(definition.claim_definitions)) {
    if (state.claim_states.length !== definition.claim_definitions.length) return invalid('claim state count mismatch');
    runtime.claim_evidence = definition.claim_definitions.map((stored: StoredValue, index: number) => {
      const claim = value(stored); const progress = state.claim_states[index];
      if (claim.claim_id !== progress?.claim_id || !Array.isArray(claim.slots) || !Array.isArray(progress.slots) || claim.slots.length !== progress.slots.length) return invalid('claim identity mismatch');
      return { ...claim, slots: claim.slots.map((slot: RecordValue, i: number) => {
        const next = progress.slots[i];
        if (slot.slot_id !== next?.slot_id || !isRecord(next.fields) || Object.keys(next.fields).some(k => !SLOT_STATE.includes(k as any))) return invalid('slot identity mismatch');
        return { ...slot, ...Object.fromEntries(Object.entries(next.fields).map(([k, v]) => [k, value(v)])) };
      }) };
    });
  } else if (definition.claim_definitions !== null) return invalid('invalid claim definitions');
  const body = definition.sections.map((section: RecordValue) => {
    const text = 'dynamic' in section ? value(state.dynamic_body[section.dynamic]) : value(section.text);
    if (typeof text !== 'string') return invalid('invalid section text');
    return text;
  }).join('');
  const expandedContent = `---\n${stringify({ ...definition.frontmatter, task_store: fm.task_store, runtime_state: runtime }).trimEnd()}\n---\n${body}`;
  // Also binds the small summary and hot fields: there is no independently
  // editable duplicate authority hidden in the readable projection.
  const rebuilt = prepareTaskProjection(expandedContent);
  if (rebuilt.content !== raw) return invalid('projection differs from its selected material');
  return { content: raw, expandedContent, objects: [...objects.values()] };
}
