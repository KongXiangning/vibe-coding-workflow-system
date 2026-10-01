#!/usr/bin/env node
/** Non-blocking management API. Deliberately imports no task/qualification kernel. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { taskCommand, taskStatus as buildTaskStatus, synchronizeTasks } from './task-management.mjs';

export const COMMANDS = ['context', 'record', 'snapshot', 'read', 'find', 'task', 'task-status', 'git-checkpoint'];
const STORE = '.workflow-system/records';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const clamp = (n, fallback, max) => Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
const failure = (code, message) => Object.assign(new Error(message), { code });
const issue = error => ({ code: error?.code ?? 'IO_ERROR', message: error instanceof Error ? error.message : String(error) });
const base = () => ({ runtime_role: 'assistance', development_gate: false, qualification: 'not-evaluated' });

// Protect this service's own I/O. This is not permission to edit product files.
function repositoryPath(root, requested) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0'))
    throw failure('UNSAFE_PATH', 'Expected a repository-relative path or an in-repository absolute path.');
  const normalized = requested.replace(/\\/g, '/');
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(path.resolve(root), absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || relative.split(path.sep).some(p => p.includes(':') || p.toLowerCase().replace(/[. ]+$/, '') === '.git'))
    throw failure('UNSAFE_PATH', 'Expected a repository-relative path without traversal into external or Git-control files.');
  return absolute;
}
function local(root, requested) {
  const absolute = repositoryPath(root, requested), relative = path.relative(path.resolve(root), absolute);
  let current = path.resolve(root);
  for (const part of [null, ...relative.split(path.sep)]) {
    if (part !== null) current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw failure('UNSAFE_PATH', 'Symbolic paths are not followed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}
function ensureParent(root, target) {
  const parent = path.posix.dirname(target);
  fs.mkdirSync(local(root, parent), { recursive: true });
  local(root, parent); // Recheck after directory creation.
}
function hashFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    if (!fs.fstatSync(fd).isFile()) throw failure('NOT_A_FILE', 'Expected a regular file.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
// Publish complete bytes without overwriting an existing record, including races.
function publish(root, target, bytes) {
  ensureParent(root, target);
  const file = local(root, target), temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, file); return true; }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  } finally { fs.rmSync(temp, { force: true }); }
}
function workflowHome(root, requested) {
  if (requested) { local(root, requested); return { home: requested, issues: [] }; }
  const fallback = 'docs/workflow';
  try {
    const profile = fs.readFileSync(local(root, '.workflow-system/PROJECT_PROFILE.yaml'), 'utf8');
    const match = /^[ \t]*workflow_home:[ \t]*(.*?)[ \t]*$/m.exec(profile);
    if (!match) return { home: fallback, issues: [] };
    let value = match[1].replace(/\s+#.*$/, '');
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw failure('PROFILE_HINT_UNREADABLE', 'Unclosed workflow_home quote.');
      value = value.slice(1, -1).replace(/''/g, "'");
    } else if (!/^[^{}\[\]&*!>|%@`#\r\n]+$/u.test(value)) throw failure('PROFILE_HINT_UNREADABLE', 'Pass workflow_home explicitly for a non-scalar YAML value.');
    local(root, value);
    return { home: value, issues: [] };
  } catch (error) {
    return { home: fallback, issues: error.code === 'ENOENT' ? [] : [issue(error)] };
  }
}
function evidenceObjectPaths(digest, home) {
  if (!/^[a-f0-9]{64}$/.test(digest ?? '')) throw failure('INVALID_DIGEST', 'A SHA-256 object reference must have 64 lowercase hexadecimal characters.');
  return [`${STORE}/evidence-objects/${digest}.blob`, `${home}/evidence-objects/${digest}.blob`];
}
function preserved(root, digest, home) {
  for (const candidate of evidenceObjectPaths(digest, home)) {
    const file = local(root, candidate);
    if (fs.existsSync(file)) {
      if (hashFile(file) !== digest) throw failure('OBJECT_CORRUPT', `Preserved object differs: ${candidate}`);
      return candidate;
    }
  }
  throw failure('HISTORICAL_OBJECT_UNAVAILABLE', `No preserved object for ${digest}; a digest cannot reconstruct missing bytes.`);
}
export function snapshot(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  if (input.sha256) {
    try { const ref = preserved(root, input.sha256, home); return { ...base(), status: 'found', ref, sha256: input.sha256, issues }; }
    catch (error) { if (error.code !== 'HISTORICAL_OBJECT_UNAVAILABLE' || !input.path) throw error; }
  }
  const source = local(root, input.path);
  const directory = `${STORE}/evidence-objects`;
  ensureParent(root, `${directory}/placeholder`);
  const temp = local(root, `${directory}/${randomUUID()}.tmp`);
  const fd = fs.openSync(source, 'r');
  let out;
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw failure('NOT_A_FILE', 'Only explicitly named regular files are captured.');
    out = fs.openSync(temp, 'wx', 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let count, size = 0;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      const part = buffer.subarray(0, count); hash.update(part); size += count;
      fs.writeFileSync(out, part);
    }
    fs.fsyncSync(out); fs.closeSync(out); out = undefined;
    const after = fs.fstatSync(fd), digest = hash.digest('hex');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw failure('SOURCE_CHANGED_DURING_CAPTURE', 'Source changed while being captured; no stable-source claim was made.');
    if (input.sha256 && input.sha256 !== digest)
      throw failure('HISTORICAL_OBJECT_UNAVAILABLE', 'The live file is not the requested historical content; it was not relabelled.');
    const ref = `${directory}/${digest}.blob`, target = local(root, ref);
    try { fs.linkSync(temp, target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (hashFile(target) !== digest) throw failure('OBJECT_CORRUPT', ref); }
    return { ...base(), status: 'saved', ref, sha256: digest, size, source_path: input.path, issues };
  } finally {
    fs.closeSync(fd); if (out !== undefined) fs.closeSync(out);
    fs.rmSync(temp, { force: true });
  }
}
function recordObservation(root, input) {
  // Keep caller fields verbatim. Missing IDs, stale revisions and unknown kinds
  // are association information, never qualifications for retaining the report.
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : { body: input };
  const payloadDigest = sha(JSON.stringify(stable(payload)));
  const key = typeof payload.idempotency_key === 'string' && payload.idempotency_key ? payload.idempotency_key : null;
  let id = key ? `key-${sha(key)}` : `${Date.now()}-${randomUUID()}`;
  let ref = `${STORE}/events/${id}.json`;
  const issues = [];
  for (;;) {
    const event = { schema_version: 1, kind: 'workflow-observation', recorded_at: new Date().toISOString(),
      payload_sha256: payloadDigest, assurance: 'caller-reported', payload, issues: [...issues] };
    if (publish(root, ref, json(event))) {
      // Raw observation is durable BEFORE optional file association/snapshotting.
      const attachments = [];
      for (const spec of Array.isArray(payload.files) ? payload.files : []) {
        try { attachments.push(snapshot(root, typeof spec === 'string' ? { path: spec, workflow_home: payload.workflow_home } : { workflow_home: payload.workflow_home, ...spec })); }
        catch (error) { attachments.push({ status: 'unavailable', request: spec, ...issue(error) }); }
      }
      let attachmentsRef = null;
      if (attachments.length) {
        attachmentsRef = `${STORE}/attachments/${id}.json`;
        try { publish(root, attachmentsRef, json({ event_ref: ref, captured_at: new Date().toISOString(), attachments })); }
        catch (error) { issues.push(issue(error)); attachmentsRef = null; }
      }
      return { ...base(), status: 'recorded', recorded: true, ref, sha256: sha(json(event)),
        attachments_ref: attachmentsRef, attachments, issues };
    }
    let previous;
    try { previous = JSON.parse(fs.readFileSync(local(root, ref), 'utf8')); }
    catch (error) { issues.push({ ...issue(error), unreadable_ref: ref }); }
    const sameRequest = payload.kind === 'task-event' && previous?.payload?.kind === 'task-event'
      && payload.request && previous.payload.request
      && JSON.stringify(stable(payload.request)) === JSON.stringify(stable(previous.payload.request));
    if (previous && sha(JSON.stringify(stable(previous.payload))) === previous.payload_sha256
      && (previous.payload_sha256 === payloadDigest || sameRequest)) {
      const a = `${STORE}/attachments/${id}.json`;
      return { ...base(), status: 'already-recorded', recorded: true, ref,
        attachments_ref: fs.existsSync(local(root, a)) ? a : null, issues: previous.issues ?? [],
        note: 'Replay does not rerun commands or recapture changed files.' };
    }
    issues.push({ code: 'IDEMPOTENCY_CONFLICT_RETAINED', conflicting_ref: ref,
      message: 'Different observation retained separately; the original was not overwritten.' });
    id = issues.length === 1 ? `conflict-${sha(key ?? id)}-${payloadDigest}` : `${Date.now()}-${randomUUID()}`;
    ref = `${STORE}/events/${id}.json`;
  }
}
// The raw store stays permissive. Management updates are a separately reported result.
const taskIO = () => ({ local, workflowHome, publish, record: recordObservation, snapshot });
export function task(root, input = {}) {
  try { return taskCommand(root, input, taskIO()); }
  catch (error) {
    if ((input?.action ?? 'status') === 'status') throw error;
    if (input?.action === 'rebuild') return { ...base(), status: 'unavailable', recorded: false, projection: { status: 'failed', ...issue(error) }, recovery_options: ['rebuild', 'defer'] };
    // A malformed management request must not destroy the original report/choice.
    const saved = recordObservation(root, { kind: 'unassociated-task-request', body: input });
    return { ...saved, association: 'unresolved', projection: { status: 'not-updated' },
      issues: [...saved.issues, issue(error)], recovery_options: ['link', 'correct', 'rebuild', 'defer'] };
  }
}
export function taskStatus(root, input = {}) { return buildTaskStatus(root, input, taskIO()); }
export function record(root, input) {
  const saved = recordObservation(root, input);
  try {
    const projection = synchronizeTasks(root, input && typeof input === 'object' ? input : {}, taskIO());
    return { ...saved, management: { ...projection, view: undefined },
      current_task_id: projection.view?.current_task_id ?? null };
  } catch (error) {
    return { ...saved, management: { status: 'failed', ...issue(error), recovery_options: ['rebuild', 'defer'] } };
  }
}
export function read(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  let ref = input.path ?? input.ref;
  if (input.sha256) {
    try { ref = preserved(root, input.sha256, home); }
    catch (error) {
      if (error.code !== 'HISTORICAL_OBJECT_UNAVAILABLE' || !ref || hashFile(local(root, ref)) !== input.sha256) throw error;
    }
  }
  const file = local(root, ref), fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw failure('NOT_A_FILE', ref);
    const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
    const length = Math.min(clamp(input.max_bytes, 8192, 65536), Math.max(0, stat.size - offset));
    const bytes = Buffer.alloc(length), count = fs.readSync(fd, bytes, 0, length, offset);
    const page = bytes.subarray(0, count);
    return { ...base(), status: 'read', ref, sha256: input.sha256 ?? null, size: stat.size, offset,
      next_offset: offset + count < stat.size ? offset + count : null,
      encoding: 'base64', data: page.toString('base64'), text_preview: page.toString('utf8'),
      issues, note: 'Base64 is exact; UTF-8 preview may split a character at a byte-page boundary. Historical availability does not imply current applicability.' };
  } finally { fs.closeSync(fd); }
}
export function find(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  const query = typeof input.query === 'string' ? input.query : '';
  const needle = Buffer.from(query);
  if (needle.length > 4096) throw failure('QUERY_TOO_LONG', 'Use a shorter literal search; this is a search request limit, not a workflow gate.');
  const roots = input.roots ?? [STORE, home, 'TASKS'];
  if (!Array.isArray(roots) || roots.some(p => typeof p !== 'string')) throw failure('INVALID_SEARCH_ROOTS', 'roots must be relative paths.');
  let pending = roots.slice().reverse().map(p => ({ path: p, offset: 0, named: false }));
  if (input.cursor) {
    const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
    if (cursor.query !== query || !Array.isArray(cursor.pending)) throw failure('INVALID_CURSOR', 'Use a cursor from this literal query.');
    pending = cursor.pending;
  }
  const matches = [], max = clamp(input.max_results, 20, 100);
  let remaining = clamp(input.scan_bytes, 1048576, 4194304), visited = 0;
  while (pending.length && matches.length < max && remaining > 0 && visited++ < 2000) {
    const item = pending.pop();
    try {
      const file = local(root, item.path), stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        const names = fs.readdirSync(file).filter(n => !['.git', 'node_modules'].includes(n) && !n.endsWith('.tmp')).sort().reverse();
        pending.push(...names.map(n => ({ path: `${item.path}/${n}`, offset: 0, named: false })));
        continue;
      }
      if (!stat.isFile()) continue;
      if (!item.named && (!query || item.path.includes(query))) {
        matches.push({ path: item.path, offset: null, match: 'path' }); item.named = true;
        if (!query) continue;
        if (matches.length >= max) { pending.push(item); break; }
      }
      item.named = true;
      const offset = Number.isSafeInteger(item.offset) && item.offset >= 0 ? item.offset : 0;
      const length = Math.min(65536, remaining, Math.max(0, stat.size - offset));
      if (!length) continue;
      const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(length + Math.max(0, needle.length - 1));
      let count;
      try { count = fs.readSync(fd, buffer, 0, buffer.length, offset); }
      finally { fs.closeSync(fd); }
      remaining -= length;
      const bytes = buffer.subarray(0, count); let from = 0, next = offset + length;
      while (needle.length && from < length) {
        const at = bytes.indexOf(needle, from);
        if (at < 0 || at >= length) break;
        matches.push({ path: item.path, offset: offset + at, match: 'content',
          excerpt: bytes.subarray(Math.max(0, at - 80), Math.min(count, at + needle.length + 160)).toString('utf8') });
        from = at + 1;
        if (matches.length >= max) { next = offset + from; break; }
      }
      if (next < stat.size) pending.push({ ...item, offset: next });
    } catch (error) { if (error.code !== 'ENOENT') issues.push({ path: item.path, ...issue(error) }); }
  }
  return { ...base(), status: pending.length ? 'partial' : 'complete', matches, issues,
    next_cursor: pending.length ? Buffer.from(JSON.stringify({ query, pending })).toString('base64url') : null,
    note: 'Literal search over stored bytes, without active-task validation. Pagination is not a failure. Concurrent additions may require a fresh search.' };
}
export function context(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  const candidates = [`${home}/CURRENT_TASK.md`, `${home}/task-data`, `${home}/task-history`,
    `${home}/evidence-objects`, `${STORE}/events`, `${STORE}/legacy`, `${STORE}/task-view.json`, 'TASKS'];
  const sources = [];
  for (const candidate of candidates) {
    try { if (fs.existsSync(local(root, candidate))) sources.push(candidate); }
    catch (error) { issues.push({ path: candidate, ...issue(error) }); }
  }
  const management = taskStatus(root, input);
  return { ...base(), status: 'available', workflow_home: home, sources, issues,
    current_task: management.current_task, current_task_id: management.current_task_id,
    tasks: management.tasks, management,
    records: find(root, { query: input.task_ref ?? '', roots: [`${STORE}/events`], max_results: input.max_results ?? 20 }),
    note: 'Current task state is computed from the whole task journal; sources/search hits are navigation only. Inspect management.issues and unassociated_records. A closed task is not verified completion.' };
}
// Presentation only: keep the complete reducer and the existing JS APIs unchanged.
function queryOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw failure('INVALID_QUERY', 'Expected a JSON object.');
  if (input.task_id !== undefined || input.plan_ref !== undefined)
    throw failure('INVALID_QUERY', 'Use task_ref for selection; step detail reads the adopted/legacy plan. Read historical plan refs with read.');
  const detail = input.detail ?? 'summary';
  if (!['summary', 'task', 'step', 'full'].includes(detail))
    throw failure('INVALID_QUERY', 'detail must be summary, task, step or full.');
  for (const key of ['task_ref', 'step_id', 'expected_view_revision']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim()))
      throw failure('INVALID_QUERY', `${key} must be a nonempty string when supplied.`);
  }
  if (detail === 'step' && !input.step_id)
    throw failure('INVALID_QUERY', 'Step detail requires step_id; it reads the adopted/legacy plan only.');
  if (input.step_id !== undefined && detail !== 'step')
    throw failure('INVALID_QUERY', 'step_id requires detail=step; no selector is silently ignored.');
  const offset = input.offset ?? 0, limit = input.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw failure('INVALID_QUERY', 'Summary offset must be nonnegative and limit must be 1..100.');
  if (detail !== 'summary' && (input.offset !== undefined || input.limit !== undefined))
    throw failure('INVALID_QUERY', 'offset/limit paginate task summaries only.');
  if (offset > 0 && !input.expected_view_revision)
    throw failure('INVALID_QUERY', 'Continue summaries with expected_view_revision from the preceding page.');
  return { detail, offset, limit };
}
function stepSummary(step) {
  return { id: step.id, title: step.title ?? null, state: step.state,
    legacy_step_status: step.legacy_step_status, execution_ref: step.execution_ref,
    execution_result: step.execution?.result ?? null, review_ref: step.review_ref,
    review_status: step.review_status, review_choice: step.review_choice,
    review_decision_ref: step.review_decision_ref, disposition_ref: step.disposition_ref,
    finding_count: Array.isArray(step.findings) ? step.findings.length : 0, test_count: step.tests.length };
}
function followUpRequest(home, fields) { return { ...fields, workflow_home: home }; }
function taskSummary(task, home) {
  const step = task.steps.find(s => s.id === task.current_step_id);
  const disposition = task.dispositions.find(d => d.ref === task.lifecycle_ref);
  return { task_id: task.task_id, display_id: task.display_id, title: task.title,
    lifecycle: task.lifecycle, lifecycle_ref: task.lifecycle_ref,
    plan_status: task.plan_status, adopted_plan_ref: task.adopted_plan_ref, adopted_by: task.adopted_by,
    legacy_plan_ref: task.legacy_plan_ref, legacy_source: task.legacy_source,
    current_step_id: task.current_step_id, current_step: step ? stepSummary(step) : null,
    next_route: task.next_route, next_mode: task.next_mode, next_action: task.next_action,
    recommendation_only: task.recommendation_only,
    remaining_work: disposition?.remaining_work ?? null, gaps: disposition?.gaps ?? null,
    counts: { steps: task.steps.length,
      unfinished_steps: task.steps.filter(s => !['finished', 'skipped', 'closed'].includes(s.state)).length,
      findings_in_current_plan: task.steps.reduce((n, s) => n + (Array.isArray(s.findings) ? s.findings.length : 0), 0),
      plans: task.plans.length, executions: task.executions.length, tests: task.tests.length,
      reviews: task.reviews.length, review_decisions: task.review_decisions.length, commits: task.commits.length },
    detail_request: followUpRequest(home, { detail: 'task', task_ref: task.task_id }) };
}
function presentStatus(view, input, options) {
  if (input.expected_view_revision && input.expected_view_revision !== view.view_revision)
    throw failure('QUERY_VIEW_CHANGED', 'The live view changed; restart the query. This is not a workflow gate.');
  if (options.detail === 'full') return view;
  const selected = input.task_ref ? view.selected_task : view.current_task;
  const detailRequest = selected ? followUpRequest(view.workflow_home, { detail: 'task', task_ref: selected.task_id }) : null;
  const counts = {};
  for (const task of view.tasks) counts[task.lifecycle] = (counts[task.lifecycle] ?? 0) + 1;
  const output = { ...base(), kind: 'task-query/v1', detail: options.detail, status: view.status,
    source_revision: view.source_revision, view_revision: view.view_revision, workflow_home: view.workflow_home,
    current_task_id: view.current_task_id,
    selection: { requested_task_ref: input.task_ref ?? null, task_id: selected?.task_id ?? null,
      status: selected ? 'resolved' : 'unresolved',
      detail_request: detailRequest },
    health: view.health, state_completeness: view.state_completeness, records_scanned: view.records_scanned,
    projection: view.projection, recovery_options: view.recovery_options,
    // Diagnostics are deliberately NOT paged or filtered to the selected task.
    issues: view.issues, unassociated_records: view.unassociated_records,
    task_count: view.tasks.length, lifecycle_counts: counts,
    coverage: { computation: 'full-journal-rebuild', diagnostics: 'all', history: 'not-expanded' },
    note: 'Presentation of the complete live rebuild. Omitted detail is not absent history, clean review or permission. Read record refs with read; use detail=full for the compatibility view.' };
  if (options.detail === 'summary') {
    const tasks = input.task_ref ? (selected ? [selected] : []) : view.tasks;
    const end = Math.min(options.offset + options.limit, tasks.length);
    return { ...output, tasks: tasks.slice(options.offset, end).map(task => taskSummary(task, view.workflow_home)),
      pagination: { total: tasks.length, offset: options.offset, limit: options.limit,
        next_offset: end < tasks.length ? end : null, view_revision: view.view_revision,
        next_request: end < tasks.length ? followUpRequest(view.workflow_home, { detail: 'summary', offset: end, limit: options.limit,
          expected_view_revision: view.view_revision,
          ...(input.task_ref ? { task_ref: input.task_ref } : {}) }) : null } };
  }
  if (options.detail === 'task') return { ...output,
    coverage: { ...output.coverage, history: 'selected-task' }, task: selected ?? null };
  // Never reinterpret a historical plan, ambiguous selector or unknown step as the current one.
  const matches = selected?.steps.filter(s => s.id === input.step_id) ?? [];
  const step = matches.length === 1 ? matches[0] : null;
  return { ...output,
    selection: { ...output.selection, requested_step_id: input.step_id,
      step_status: step ? 'resolved' : 'unresolved' },
    task: selected ? { task_id: selected.task_id, display_id: selected.display_id, lifecycle: selected.lifecycle,
      adopted_plan_ref: selected.adopted_plan_ref, legacy_plan_ref: selected.legacy_plan_ref } : null,
    coverage: { ...output.coverage, history: 'selected-step-projection-only' },
    step, review: step ? selected.reviews.find(r => r.ref === step.review_ref) ?? null : null,
    detail_request: detailRequest };
}
/** Agent-facing read APIs. The low-level taskStatus/context exports stay full for existing callers. */
export function queryStatus(root, input = {}) {
  const options = queryOptions(input);
  return presentStatus(taskStatus(root, input), input, options);
}
export function queryContext(root, input = {}) {
  const options = queryOptions(input), result = context(root, input);
  const management = presentStatus(result.management, input, options);
  if (options.detail === 'full') return result;
  return { ...base(), status: result.status, workflow_home: result.workflow_home,
    sources: result.sources, issues: result.issues, management,
    note: 'Task data occurs once under management. Use its detail requests or explicit find/read for evidence; navigation is not task state.' };
}

// Checkpoint planning/verifying is deliberately read-only. The Skill owns configuration,
// staging and commit under the user's instruction; a manifest is not an approval token.
function checkpointGit(root, args, input, accepted = [0], encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: root, input, encoding, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) throw failure('GIT_READ_FAILED', (result.stderr?.toString() || result.stdout?.toString() || `Git exited ${result.status}`).trim());
  return result;
}
function checkpointPath(root, value) {
  const relative = path.relative(path.resolve(root), repositoryPath(root, value)).split(path.sep).join('/');
  if (!relative) throw failure('EXACT_PATH_REQUIRED', 'Name a file, not the repository root.');
  return relative;
}
function checkpointTree(root, revision) {
  if (!revision) return new Map();
  const result = new Map();
  for (const line of checkpointGit(root, ['ls-tree', '-r', '-z', '--full-tree', revision]).stdout.split('\0').filter(Boolean)) {
    const at = line.indexOf('\t'), [mode, type, oid] = line.slice(0, at).split(' ');
    result.set(line.slice(at + 1), { mode, oid, type });
  }
  return result;
}
function checkpointIndex(root) {
  const entries = new Map(), unmerged = new Set();
  for (const line of checkpointGit(root, ['ls-files', '--stage', '-z']).stdout.split('\0').filter(Boolean)) {
    const at = line.indexOf('\t'), [mode, oid, stage] = line.slice(0, at).split(' '), ref = line.slice(at + 1);
    if (stage !== '0') unmerged.add(ref);
    else entries.set(ref, { mode, oid, type: mode === '160000' ? 'commit' : 'blob' });
  }
  return { entries, unmerged: [...unmerged] };
}
const checkpointEqual = (a, b) => a?.mode === b?.mode && a?.oid === b?.oid;
const checkpointDiff = (before, after) => [...new Set([...before.keys(), ...after.keys()])].filter(ref => !checkpointEqual(before.get(ref), after.get(ref))).sort();
const checkpointTreeDigest = entries => sha(JSON.stringify([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([ref, e]) => [ref, e.mode, e.oid])));
function checkpointFile(root, ref, algorithm) {
  const fd = fs.openSync(local(root, ref), 'r');
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw failure('NOT_A_FILE', `Not a regular file: ${ref}`);
    const contentHash = createHash('sha256'), objectHash = createHash(algorithm).update(`blob ${before.size}\0`), buffer = Buffer.alloc(65536);
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { contentHash.update(buffer.subarray(0, n)); objectHash.update(buffer.subarray(0, n)); }
    const after = fs.fstatSync(fd), current = fs.lstatSync(local(root, ref));
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => before[k] !== after[k] || after[k] !== current[k]))
      throw failure('SOURCE_CHANGED', `File changed during checkpoint inspection: ${ref}`);
    return { sha256: contentHash.digest('hex'), raw_git_oid: objectHash.digest('hex'), size: before.size };
  } finally { fs.closeSync(fd); }
}
function checkpointIndexFile(root, entry) {
  if (entry.mode === '160000') return { mode: entry.mode, raw_git_oid: entry.oid, sha256: null, size: null };
  if (!['100644', '100755', '120000'].includes(entry.mode)) throw failure('UNSUPPORTED_GIT_ENTRY', `Unsupported Git mode: ${entry.mode}`);
  const bytes = checkpointGit(root, ['cat-file', 'blob', entry.oid], undefined, [0], null).stdout;
  return { mode: entry.mode, raw_git_oid: entry.oid, sha256: sha(bytes), size: bytes.length };
}
function checkpointBusinessFile(root, ref, algorithm, entry, symlinks) {
  if (entry?.mode === '160000') throw failure('GITLINK_INDEX_SOURCE_REQUIRED', 'Review/stage the intended submodule pointer and re-plan with source=index; no submodule work is replayed.');
  const parent = local(root, path.posix.dirname(ref)), file = path.join(parent, path.posix.basename(ref));
  const before = fs.lstatSync(file);
  if (before.isSymbolicLink()) {
    const bytes = fs.readlinkSync(file, { encoding: 'buffer' }), after = fs.lstatSync(file);
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => before[k] !== after[k]))
      throw failure('SOURCE_CHANGED', `Link changed during checkpoint inspection: ${ref}`);
    return { mode: '120000', sha256: sha(bytes), size: bytes.length,
      raw_git_oid: createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
  }
  const metadata = checkpointFile(root, ref, algorithm);
  return entry?.mode === '120000' && !symlinks ? { ...metadata, mode: '120000' } : metadata;
}
function checkpointRole(ref, display) {
  if (ref === display) return 'display';
  if (ref === `${STORE}/.gitignore` || ref === `${STORE}/.gitattributes`) return 'configuration';
  if (new RegExp(`^${STORE.replaceAll('.', '\\.')}\/(events|attachments|task-labels)\/[^/]+\\.json$`).test(ref)
    || new RegExp(`^${STORE.replaceAll('.', '\\.')}\/evidence-objects\/[a-f0-9]{64}\\.blob$`).test(ref)
    || ref === `${STORE}/legacy/baseline.json` || new RegExp(`^${STORE.replaceAll('.', '\\.')}\/legacy\/current-[a-f0-9]{64}\\.md$`).test(ref)) return 'fact';
  if (new RegExp(`^${STORE.replaceAll('.', '\\.')}\/legacy\/display-(?:[a-f0-9]{64}|capture-[a-f0-9-]+)\\.md$`).test(ref)) return 'recovery';
  if (ref === `${STORE}/task-view.json` || ref.startsWith(`${STORE}/task-views/`)) return 'derived';
  if (ref.startsWith(`${STORE}/`) && (ref.endsWith('.tmp') || /^task-view.*\.lock$/.test(path.posix.basename(ref)))) return 'temporary';
  return 'unclassified';
}
function checkpointObjectPath(root, ref) {
  const target = checkpointPath(root, ref), directory = path.posix.dirname(target);
  const digest = /^([a-f0-9]{64})\.blob$/.exec(path.posix.basename(target))?.[1];
  if (!digest || path.posix.basename(directory) !== 'evidence-objects') return null;
  const home = path.posix.dirname(directory);
  return evidenceObjectPaths(digest, home).map(p => checkpointPath(root, p)).includes(target) ? target : null;
}
function checkpointInventory(root, display, business = []) {
  const files = new Map(), issues = [], pending = [STORE];
  while (pending.length) {
    const ref = pending.pop();
    try {
      const file = local(root, ref), stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(file).sort().reverse()) pending.push(`${ref}/${entry}`);
      } else if (stat.isFile()) files.set(ref, checkpointRole(ref, display));
      else issues.push({ code: 'UNSUPPORTED_RECORD_ENTRY', path: ref });
    } catch (error) { if (error.code !== 'ENOENT') issues.push({ ...issue(error), path: ref }); }
  }
  // Follow typed attachment refs, not arbitrary text or a scan of the old workflow home.
  const objects = new Set(), referenceIssues = [];
  function includeObject(ref, from) {
    try {
      const target = checkpointObjectPath(root, ref);
      if (!target) { referenceIssues.push({ code: 'ATTACHMENT_OBJECT_REF_UNSUPPORTED', from, path: ref }); return; }
      objects.add(target);
      const stat = fs.lstatSync(local(root, target));
      if (!stat.isFile()) throw failure('NOT_A_FILE', `Not a regular preserved object: ${target}`);
      files.set(target, 'fact');
    } catch (error) { if (error.code !== 'ENOENT') referenceIssues.push({ ...issue(error), from, path: ref }); }
  }
  for (const [ref, role] of files) {
    if (role !== 'fact' || !ref.startsWith(`${STORE}/attachments/`)) continue;
    try {
      const value = JSON.parse(fs.readFileSync(local(root, ref), 'utf8'));
      for (const attachment of Array.isArray(value.attachments) ? value.attachments : [])
        if (attachment.status !== 'unavailable' && attachment.ref) includeObject(attachment.ref, ref);
    } catch { /* The reference check reports unreadable manifests without discarding their bytes. */ }
  }
  for (const ref of business) if (checkpointObjectPath(root, ref)) includeObject(ref, null);
  for (const directory of new Set([...objects].map(ref => path.posix.dirname(ref)))) {
    const ref = `${directory}/.gitattributes`;
    try { if (fs.lstatSync(local(root, ref)).isFile()) files.set(ref, 'configuration'); }
    catch (error) { if (error.code !== 'ENOENT') issues.push({ ...issue(error), path: ref }); }
  }
  return { files, issues, evidence_objects: objects, reference_issues: referenceIssues };
}
function checkpointAttributes(root, refs, cached = false) {
  if (!refs.length) return new Map();
  const attrs = ['text', 'filter', 'ident', 'working-tree-encoding'];
  const values = checkpointGit(root, ['check-attr', ...(cached ? ['--cached'] : []), '-z', '--stdin', ...attrs], refs.join('\0') + '\0').stdout.split('\0');
  const result = new Map();
  for (let i = 0; i + 2 < values.length; i += 3) {
    const row = result.get(values[i]) ?? {}; row[values[i + 1]] = values[i + 2]; result.set(values[i], row);
  }
  return result;
}
function checkpointPolicy(root, home, generatedDisplay, evidenceObjects = []) {
  const legacyDirectories = [...new Set(evidenceObjects.filter(ref => !ref.startsWith(`${STORE}/`))
    .map(ref => path.posix.dirname(ref)))].sort();
  const definitions = [
    [`${STORE}/.gitignore`, '/task-view.json\n/task-views/\n/task-view*.lock\n**/*.tmp\n'],
    [`${STORE}/.gitattributes`, '** -text -filter -ident -working-tree-encoding\n'],
    ...legacyDirectories.map(directory => [`${directory}/.gitattributes`, '*.blob -text -filter -ident -working-tree-encoding\n']),
    ...(generatedDisplay ? [[`${home}/.gitignore`, '/CURRENT_TASK.md\n']] : []),
  ];
  const edits = [], paths = [], issues = [];
  for (const [ref, body] of definitions) {
    paths.push(ref);
    const begin = '# BEGIN vNext checkpoint Git policy', end = '# END vNext checkpoint Git policy';
    let bytes = null;
    try { bytes = fs.readFileSync(local(root, ref)); } catch (error) { if (error.code !== 'ENOENT') { issues.push({ ...issue(error), path: ref }); continue; } }
    let text;
    try { text = bytes === null ? '' : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { issues.push({ code: 'POLICY_ENCODING_UNSUPPORTED', path: ref }); continue; }
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const block = `${begin}\n${body}${end}\n`.replaceAll('\n', newline);
    if (text.includes(begin) || text.includes(end)) {
      if (!text.includes(block) || text.split(begin).length !== 2 || text.split(end).length !== 2)
        issues.push({ code: 'POLICY_BLOCK_EDITED', path: ref, message: 'Keep project customizations; reconcile the policy explicitly, do not overwrite it.' });
      continue;
    }
    if (/@frozen|DO NOT MODIFY/i.test(text)) { issues.push({ code: 'POLICY_FILE_FROZEN', path: ref }); continue; }
    edits.push({ path: ref, before_sha256: bytes === null ? null : sha(bytes),
      content: text + (text && !text.endsWith('\n') ? newline : '') + block,
      existing_content_retained: true, project_policy_review: bytes !== null });
  }
  return { edits, paths, issues };
}
function checkpointReferences(root, inventory, selected) {
  const issues = [...inventory.reference_issues], check = (ref, from, attachment = false) => {
    if (typeof ref !== 'string' || (!attachment && !ref.startsWith(`${STORE}/`))) return;
    try {
      const target = checkpointPath(root, ref);
      if (!inventory.files.has(target)) issues.push({ code: 'REFERENCE_MISSING', from, path: target });
      else if (!selected.has(target)) issues.push({ code: 'REFERENCE_NOT_SELECTED', from, path: target });
      return target;
    } catch (error) { issues.push({ ...issue(error), from, path: ref }); }
  };
  for (const [ref, role] of inventory.files) {
    if (role !== 'fact') continue;
    try {
      if (!ref.endsWith('.json')) {
        // Blobs and legacy Markdown are checked by their byte-addressed names, not parsed as JSON.
        continue;
      }
      const value = JSON.parse(fs.readFileSync(local(root, ref), 'utf8'));
      if (ref.startsWith(`${STORE}/events/`)) {
        if (!value.payload || sha(JSON.stringify(stable(value.payload))) !== value.payload_sha256)
          issues.push({ code: 'EVENT_DIGEST_MISMATCH', path: ref });
        const visit = value => {
          if (Array.isArray(value)) { for (const v of value) visit(v); }
          else if (value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
              if (k === 'ref' || k.endsWith('_ref') || ['parents', 'execution_refs'].includes(k)) {
                for (const item of Array.isArray(v) ? v : [v]) check(item, ref);
              }
              visit(v);
            }
          }
        };
        visit(value.payload);
        if (Array.isArray(value.payload?.files) && value.payload.files.length)
          check(`${STORE}/attachments/${path.posix.basename(ref)}`, ref);
      } else if (ref.startsWith(`${STORE}/attachments/`)) {
        check(value.event_ref, ref);
        for (const attachment of Array.isArray(value.attachments) ? value.attachments : []) {
          if (attachment.status === 'unavailable') issues.push({ code: 'RETAINED_ATTACHMENT_UNAVAILABLE', path: ref, request: attachment.request });
          else {
            const target = check(attachment.ref, ref, true);
            if (!attachment.ref) issues.push({ code: 'ATTACHMENT_REF_MISSING', path: ref });
            const object = selected.get(target);
            if (object && (attachment.sha256 !== object.sha256 || (attachment.size !== undefined && attachment.size !== object.size)))
              issues.push({ code: 'ATTACHMENT_METADATA_MISMATCH', path: ref, object_ref: attachment.ref });
          }
        }
      } else if (ref === `${STORE}/legacy/baseline.json`) {
        check(value.ref, ref);
        const original = selected.get(value.ref);
        if (original && value.sha256 !== original.sha256) issues.push({ code: 'BASELINE_DIGEST_MISMATCH', path: ref });
      }
    } catch (error) { issues.push({ code: 'RETAINED_RECORD_UNREADABLE', path: ref, message: error.message }); }
  }
  return issues;
}
/** Project checkpoint inventory and actual Git verification; never stages, commits or deletes. */
export function gitCheckpoint(root, input = {}) {
  const action = input.action ?? 'plan';
  if (!['plan', 'verify-index', 'verify-commit'].includes(action)) throw failure('INVALID_CHECKPOINT_ACTION', action);
  const top = checkpointGit(root, ['rev-parse', '--show-toplevel']).stdout.trim();
  if (path.resolve(top) !== path.resolve(root)) throw failure('CHECKPOINT_ROOT_MISMATCH', 'Use the exact Git worktree root.');
  const algorithm = checkpointGit(root, ['rev-parse', '--show-object-format']).stdout.trim();
  if (!['sha1', 'sha256'].includes(algorithm)) throw failure('UNSUPPORTED_GIT_OBJECT_FORMAT', algorithm);
  const headResult = checkpointGit(root, ['rev-parse', '--verify', '-q', 'HEAD'], undefined, [0, 1]);
  const head = headResult.status === 0 ? headResult.stdout.trim() : null;
  if (action !== 'plan') return verifyCheckpoint(root, input, head, algorithm);
  const mode = input.mode ?? 'checkpoint';
  if (!['checkpoint', 'paths'].includes(mode)) throw failure('INVALID_CHECKPOINT_MODE', mode);
  const source = input.source ?? 'worktree';
  if (!['worktree', 'index'].includes(source)) throw failure('INVALID_CHECKPOINT_SOURCE', 'source must be worktree or index; it selects the business content, not authority.');
  const exactPaths = values => {
    if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) throw failure('EXACT_PATHS_REQUIRED', 'Use an array of exact file paths, not a glob or directory.');
    return [...new Set(values.map(v => checkpointPath(root, v)))].sort();
  };
  const business = exactPaths(input.business_paths ?? []), exclusions = exactPaths(input.exclude_paths ?? []);
  const excluded = ref => exclusions.some(p => ref === p || ref.startsWith(`${p}/`));
  const { home, issues: homeIssues } = workflowHome(root, input.workflow_home), display = `${home}/CURRENT_TASK.md`;
  let generatedDisplay = false, displayHasMarker = false;
  try {
    const bytes = fs.readFileSync(local(root, display)), text = bytes.toString('utf8');
    displayHasMarker = text.includes('<!-- vnext-task-view/v1 -->');
    const revision = /^view_revision: ([a-f0-9]{64})$/m.exec(text)?.[1];
    generatedDisplay = text.includes('<!-- vnext-task-view/v1 -->') && !!revision
      && fs.readFileSync(local(root, `${STORE}/task-views/${revision}.md`)).equals(bytes);
  } catch (error) { if (error.code !== 'ENOENT') homeIssues.push({ ...issue(error), path: display }); }
  const inventory = checkpointInventory(root, display, source === 'worktree' ? business : []), before = checkpointTree(root, head), index = checkpointIndex(root);
  const symlinks = checkpointGit(root, ['config', '--bool', 'core.symlinks'], undefined, [0, 1]).stdout.trim() !== 'false';
  const selected = new Set(business.filter(ref => !excluded(ref)));
  const omitted = [], problems = [...homeIssues, ...inventory.issues], policy = mode === 'checkpoint'
    ? checkpointPolicy(root, home, generatedDisplay, [...inventory.evidence_objects].filter(ref => inventory.files.has(ref) && !excluded(ref)))
    : { edits: [], paths: [], issues: [] };
  if (mode === 'checkpoint') {
    for (const [ref, role] of inventory.files) {
      if (['fact', 'recovery', 'configuration'].includes(role) && !excluded(ref)) selected.add(ref);
      else omitted.push({ path: ref, role, reason: excluded(ref) ? 'user-excluded' : ['derived', 'temporary'].includes(role) ? 'local-generated' : 'classification-required' });
    }
    for (const ref of policy.paths) if (!excluded(ref) && fs.existsSync(local(root, ref))) selected.add(ref);
    for (const ref of [...before.keys(), ...index.entries.keys()]) {
      if (['fact', 'recovery'].includes(checkpointRole(ref, display)) && !inventory.files.has(ref))
        problems.push({ code: 'PERSISTENT_FILE_MISSING', path: ref, message: 'Do not silently stage this deletion as checkpoint cleanup.' });
    }
    for (const registry of ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md'])
      if (fs.existsSync(local(root, registry)) && policy.edits.length) problems.push({ code: 'FREEZE_POLICY_REVIEW', path: registry });
  }
  const configuration = policy.edits.filter(e => !excluded(e.path));
  for (const e of policy.edits.filter(e => excluded(e.path))) omitted.push({ path: e.path, role: 'configuration', reason: 'user-excluded' });
  problems.push(...policy.issues);
  if (mode === 'checkpoint' && displayHasMarker && !generatedDisplay)
    problems.push({ code: 'DISPLAY_DRIFT_RETAINED', path: display, message: 'No matching saved generated view. Keep the file and resolve/preserve its content; do not newly ignore or untrack it.' });
  const files = [], deletions = [];
  for (const ref of [...selected].sort()) {
    const fileSource = source === 'index' && business.includes(ref) ? 'index' : 'worktree';
    const object = checkpointObjectPath(root, ref), byteExact = ref.startsWith(`${STORE}/`) || !!object;
    let role = inventory.files.get(ref);
    if (!role) {
      if (object) role = 'fact';
      else if (policy.paths.includes(ref)) role = 'configuration';
      else role = 'business';
    }
    try {
      let metadata;
      if (fileSource === 'index') {
        const entry = index.entries.get(ref);
        if (!entry) {
          if (before.has(ref)) { deletions.push(ref); continue; }
          throw failure('INDEX_PATH_NOT_FOUND', `No selected index or HEAD entry: ${ref}`);
        }
        if (byteExact && !['100644', '100755'].includes(entry.mode)) throw failure('UNSUPPORTED_PERSISTENT_ENTRY', `Preserved records require regular blobs: ${ref}`);
        metadata = checkpointIndexFile(root, entry);
      } else if (role === 'business') metadata = checkpointBusinessFile(root, ref, algorithm, index.entries.get(ref), symlinks);
      else metadata = checkpointFile(root, ref, algorithm);
      files.push({ path: ref, role, source: fileSource, byte_exact: byteExact, ...metadata });
    } catch (error) {
      if (error.code === 'ENOENT' && business.includes(ref) && before.has(ref) && mode === 'paths') deletions.push(ref);
      else if (error.code === 'ENOENT' && business.includes(ref) && before.has(ref) && !ref.startsWith(`${STORE}/`)) deletions.push(ref);
      else problems.push({ ...issue(error), path: ref });
    }
  }
  const untrack = [], untrackFiles = [], trackedDerived = [];
  if (mode === 'checkpoint') for (const ref of new Set([...before.keys(), ...index.entries.keys()])) {
    const role = checkpointRole(ref, display);
    if (!(['derived', 'temporary'].includes(role) || (role === 'display' && generatedDisplay)) || selected.has(ref) || excluded(ref)) continue;
    trackedDerived.push(ref);
    if (input.untrack_derived === true) {
      if (!checkpointEqual(before.get(ref), index.entries.get(ref)) || index.unmerged.includes(ref)) {
        problems.push({ code: 'STAGED_DERIVED_CHANGE', path: ref, message: 'Retain staged work until the user selects its disposition.' });
      } else {
        untrack.push(ref);
        try { untrackFiles.push({ path: ref, ...checkpointFile(root, ref, algorithm) }); }
        catch (error) { if (error.code !== 'ENOENT') problems.push({ ...issue(error), path: ref }); }
      }
    }
  }
  const indexChanges = checkpointDiff(before, index.entries), chosen = new Set([...files.map(f => f.path), ...deletions, ...untrack]);
  const outside = indexChanges.filter(ref => !chosen.has(ref));
  if (outside.length) problems.push({ code: 'STAGED_OUTSIDE_SCOPE', paths: outside, message: 'Preserve the existing index; do not reset or include unrelated staged changes.' });
  if (index.unmerged.length) problems.push({ code: 'UNMERGED_INDEX', paths: index.unmerged });
  const worktreeFiles = files.filter(f => f.source === 'worktree');
  const ignored = worktreeFiles.length ? new Set(checkpointGit(root, ['check-ignore', '-z', '--stdin'], worktreeFiles.map(f => f.path).join('\0') + '\0', [0, 1]).stdout.split('\0').filter(Boolean)) : new Set();
  for (const ref of ignored) problems.push({ code: 'SELECTED_PATH_IGNORED', path: ref, message: 'Do not force-add or override project exclusions without the actual user choice.' });
  const attrs = checkpointAttributes(root, worktreeFiles.filter(f => f.byte_exact).map(f => f.path));
  const indexAttrs = checkpointAttributes(root, files.filter(f => f.byte_exact && f.source === 'index').map(f => f.path), true);
  for (const f of files) {
    if (f.role === 'fact' && before.has(f.path) && before.get(f.path).oid !== f.raw_git_oid)
      problems.push({ code: 'TRACKED_FACT_CHANGED', path: f.path, message: 'Inspect the immutable-history change; do not silently overwrite it during a checkpoint.' });
    const attributes = (f.source === 'index' ? indexAttrs : attrs).get(f.path);
    if (f.byte_exact && Object.values(attributes ?? {}).some(v => !['unset', 'unspecified'].includes(v)))
      problems.push({ code: 'BYTE_ATTRIBUTE_REVIEW', path: f.path, attributes });
    if (f.source !== 'index' && indexChanges.includes(f.path) && index.entries.has(f.path) && index.entries.get(f.path).oid !== f.raw_git_oid)
      problems.push({ code: 'PRESTAGED_CONTENT_DIFFERS', path: f.path, message: 'Inspect staged hunks/normalization; do not silently replace a partial stage.' });
  }
  const referenceIssues = mode === 'checkpoint' ? checkpointReferences(root, inventory, new Map(files.map(f => [f.path, f]))) : [];
  for (const f of files) {
    const named = /\/([a-f0-9]{64})\.blob$/.exec(f.path)?.[1] ?? /\/legacy\/(?:current|display)-([a-f0-9]{64})\.md$/.exec(f.path)?.[1];
    if (named && f.mode !== '160000' && named !== f.sha256) referenceIssues.push({ code: 'PRESERVED_DIGEST_MISMATCH', path: f.path });
  }
  const addPaths = files.filter(f => f.source !== 'index' && (!index.entries.has(f.path) || index.entries.get(f.path).oid !== f.raw_git_oid || f.role === 'business')).map(f => f.path);
  const plan = { kind: 'git-checkpoint-plan/v1', root: path.resolve(root), base_head: head, object_format: algorithm, mode, source,
    workflow_home: home, business_paths: business, exclude_paths: exclusions, files, delete_paths: deletions,
    add_paths: [...new Set([...addPaths, ...(source === 'worktree' ? deletions : [])])].sort(), untrack_paths: untrack.sort(), untrack_files: untrackFiles,
    configuration, tracked_derived_retained: trackedDerived.filter(p => !untrack.includes(p)), omitted,
    issues: problems, reference_issues: referenceIssues };
  return { ...base(), status: 'planned', ...plan,
    counts: { selected: files.length, facts: files.filter(f => f.role === 'fact').length, recovery: files.filter(f => f.role === 'recovery').length,
      add: plan.add_paths.length, untrack: untrack.length, omitted: omitted.length },
    note: 'Project-wide records are candidates under the Skill checkpoint policy, not permission. Apply authorized configuration, re-plan, review the index, then verify. Reference gaps do not prohibit preserving existing bytes. Keep this plan in an OS temporary file, not in records.' };
}
function verifyCheckpoint(root, input, head, algorithm) {
  const plan = input.plan;
  if (plan?.kind !== 'git-checkpoint-plan/v1' || !Array.isArray(plan.files) || !Array.isArray(plan.add_paths) || !Array.isArray(plan.delete_paths) || !Array.isArray(plan.untrack_paths)
    || path.resolve(plan.root ?? '') !== path.resolve(root) || plan.object_format !== algorithm
    || (plan.base_head !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(plan.base_head ?? '')))
    throw failure('INVALID_CHECKPOINT_PLAN', 'Use the plan from this worktree; a plan is data, not authority.');
  const normalize = ref => checkpointPath(root, ref);
  for (const f of plan.files) {
    normalize(f.path);
    const gitlink = f.mode === '160000' && f.source === 'index' && f.role === 'business' && !f.byte_exact;
    const persistent = f.byte_exact || f.path.startsWith(`${STORE}/`) || !!checkpointObjectPath(root, f.path);
    if ((!gitlink && !/^[a-f0-9]{64}$/.test(f.sha256)) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(f.raw_git_oid)
      || (f.source !== undefined && !['worktree', 'index'].includes(f.source))
      || (f.mode !== undefined && !['100644', '100755', '120000', '160000'].includes(f.mode))
      || (persistent && f.mode !== undefined && !['100644', '100755'].includes(f.mode))
      || (f.mode === '160000' && !gitlink)) throw failure('INVALID_CHECKPOINT_PLAN', 'Invalid file digest, source or Git mode.');
  }
  const allowed = new Set([...plan.files.map(f => f.path), ...plan.delete_paths.map(normalize), ...plan.untrack_paths.map(normalize)]);
  const problems = [], referenceIssues = [...(plan.reference_issues ?? [])], isCommit = input.action === 'verify-commit';
  const objectPaths = new Set(plan.files.filter(f => checkpointObjectPath(root, f.path)).map(f => f.path));
  const byteExactFiles = plan.files.filter(f => f.byte_exact || objectPaths.has(f.path));
  const symlinks = checkpointGit(root, ['config', '--bool', 'core.symlinks'], undefined, [0, 1]).stdout.trim() !== 'false';
  function storageIssue(problem) {
    problems.push(problem);
    if (objectPaths.has(problem.path)) referenceIssues.push(problem);
  }
  if (plan.configuration?.length) problems.push({ code: 'CONFIGURATION_PENDING', message: 'Apply only authorized policy edits and re-plan before staging.' });
  let target, commit = null;
  if (isCommit) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(input.commit_sha ?? '')) throw failure('COMMIT_SHA_REQUIRED', 'Pass the actual full commit SHA.');
    commit = checkpointGit(root, ['rev-parse', '--verify', `${input.commit_sha}^{commit}`]).stdout.trim();
    const parents = checkpointGit(root, ['rev-list', '--parents', '-n', '1', commit]).stdout.trim().split(' ').slice(1);
    if (parents.length !== (plan.base_head ? 1 : 0) || (plan.base_head && parents[0] !== plan.base_head)) problems.push({ code: 'COMMIT_BASE_DIFFERS', expected: plan.base_head, actual: parents });
    target = checkpointTree(root, commit);
  } else {
    if (head !== plan.base_head) problems.push({ code: 'HEAD_CHANGED', expected: plan.base_head, actual: head });
    const index = checkpointIndex(root); target = index.entries;
    if (index.unmerged.length) problems.push({ code: 'UNMERGED_INDEX', paths: index.unmerged });
  }
  if (!isCommit) {
    const attrs = checkpointAttributes(root, byteExactFiles.map(f => f.path), true);
    for (const [ref, row] of attrs) if (row.text !== 'unset' || ['filter', 'ident', 'working-tree-encoding'].some(k => !['unset', 'unspecified'].includes(row[k])))
      storageIssue({ code: 'INDEX_BYTE_ATTRIBUTES_UNSAFE', path: ref, attributes: row });
  }
  const outside = checkpointDiff(checkpointTree(root, plan.base_head), target).filter(ref => !allowed.has(ref));
  if (outside.length) problems.push({ code: 'OUTSIDE_SCOPE', paths: outside });
  for (const f of plan.files) {
    const stored = target.get(f.path);
    const modes = f.mode ? [f.mode] : ['100644', '100755'];
    if (!stored) storageIssue({ code: 'PLANNED_FILE_NOT_SAVED', path: f.path });
    else {
      if (!modes.includes(stored.mode)) storageIssue({ code: 'STORED_MODE_DIFFERS', path: f.path, expected: modes, actual: stored.mode });
      if ((f.source === 'index' || f.mode === '120000' || f.byte_exact || objectPaths.has(f.path)) && stored.oid !== f.raw_git_oid)
        storageIssue({ code: f.mode === '160000' ? 'STORED_GITLINK_DIFFERS' : 'STORED_BYTES_DIFFER', path: f.path, expected: f.raw_git_oid, actual: stored.oid });
    }
    if (!isCommit && f.source !== 'index') {
      try {
        const current = f.role === 'business' ? checkpointBusinessFile(root, f.path, algorithm, f.mode ? { mode: f.mode } : null, symlinks) : checkpointFile(root, f.path, algorithm);
        if (current.sha256 !== f.sha256 || current.mode !== f.mode)
          problems.push({ code: 'SOURCE_CHANGED_SINCE_PLAN', path: f.path });
      }
      catch (error) { problems.push({ ...issue(error), path: f.path }); }
    }
  }
  for (const ref of [...plan.delete_paths, ...plan.untrack_paths]) if (target.has(ref)) problems.push({ code: 'PLANNED_INDEX_REMOVAL_MISSING', path: ref });
  for (const f of plan.untrack_files ?? []) {
    try {
      if (checkpointFile(root, normalize(f.path), algorithm).sha256 !== f.sha256) {
        let stillGenerated = false;
        if (f.path === `${plan.workflow_home}/CURRENT_TASK.md`) {
          const bytes = fs.readFileSync(local(root, f.path)), text = bytes.toString('utf8');
          const revision = /^view_revision: ([a-f0-9]{64})$/m.exec(text)?.[1];
          try { stillGenerated = text.includes('<!-- vnext-task-view/v1 -->') && !!revision && fs.readFileSync(local(root, `${STORE}/task-views/${revision}.md`)).equals(bytes); } catch { /* Not a recognized projection. */ }
        }
        if (!stillGenerated) problems.push({ code: 'UNTRACKED_SOURCE_CHANGED', path: f.path });
      }
    }
    catch (error) { problems.push({ ...issue(error), path: f.path }); }
  }
  const treeDigest = checkpointTreeDigest(target);
  if (isCommit && input.index_verification?.tree_sha256 && input.index_verification.tree_sha256 !== treeDigest)
    problems.push({ code: 'COMMITTED_TREE_DIFFERS_FROM_REVIEWED_INDEX' });
  const inventory = checkpointInventory(root, `${plan.workflow_home}/CURRENT_TASK.md`, plan.files.filter(f => f.source !== 'index').map(f => f.path)), saved = new Map(plan.files.map(f => [f.path, f]));
  const remaining = [...inventory.issues.map(i => ({ ...i, reason: 'unreadable' }))];
  for (const f of byteExactFiles) if (!inventory.files.has(f.path)) remaining.push({ path: f.path, role: f.role, reason: 'missing-from-worktree' });
  for (const [ref, role] of inventory.files) if (['fact', 'recovery', 'configuration', 'unclassified'].includes(role)) {
    try {
      const f = checkpointFile(root, ref, algorithm);
      if (target.get(ref)?.oid !== f.raw_git_oid) remaining.push({ path: ref, role,
        reason: !saved.has(ref) ? 'not-in-planned-snapshot' : 'changed-after-planning' });
    } catch (error) { remaining.push({ ...issue(error), path: ref, reason: 'unreadable' }); }
  }
  return { ...base(), status: problems.length ? 'mismatch' : 'verified', kind: 'git-checkpoint-verification/v1',
    phase: isCommit ? 'commit' : 'index', commit_sha: commit, base_head: plan.base_head,
    tree_sha256: treeDigest, snapshot_verified: problems.length === 0,
    reviewed_index_compared: isCommit && !!input.index_verification?.tree_sha256,
    reference_health: referenceIssues.length ? 'gaps-retained' : 'no-known-gaps',
    reference_issues: referenceIssues, planning_issues: plan.issues ?? [], issues: problems, remaining_records: remaining,
    scope_exclusions: plan.exclude_paths, recovery_files_retained: plan.files.filter(f => f.role === 'recovery').length,
    note: 'Checks the planned Git snapshot, not task completion, secret safety, future writes or remote backup. No file/index/history was modified. New records after planning remain for a later authorized checkpoint; do not recursively commit.' };
}

export async function runAssistance(argv = process.argv.slice(2)) {
  let command = argv[0] ?? 'context', root = process.cwd();
  try {
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
      else throw failure('INVALID_ARGUMENT', 'Usage: assistance.mjs <context|record|snapshot|read|find|task|task-status|git-checkpoint> --root <project>; JSON on stdin.');
    }
    if (!COMMANDS.includes(command)) throw failure('UNKNOWN_COMMAND', command);
    if (!fs.statSync(root).isDirectory()) throw failure('INVALID_ROOT', root);
    const text = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8');
    let input;
    try { input = text.trim() ? JSON.parse(text) : {}; }
    catch (error) { if (command !== 'record') throw error; input = { kind: 'raw-observation', body: text }; }
    const statusQuery = command === 'task' && (input?.action ?? 'status') === 'status';
    const result = statusQuery ? queryStatus(root, input)
      : { context: queryContext, record, snapshot, read, find, task, 'task-status': queryStatus, 'git-checkpoint': gitCheckpoint }[command](root, input);
    console.log(json(result)); return command === 'git-checkpoint' && result.status === 'mismatch' ? 1 : 0;
  } catch (error) {
    console.log(json({ ...base(), status: 'unavailable', recorded: false, command, ...issue(error),
      next_action: 'Report this service failure; retain output elsewhere when authorized. Do not turn it into a development stop, rerun business commands, or claim successful persistence.' }));
    return 1; // A real service failure, not a workflow veto and not fake success.
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runAssistance();
