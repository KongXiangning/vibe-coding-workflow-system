/** Current Task records and task-owned temporary materials; no business execution. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { atomicReplace, viewLock, removeTemporaryFile } from './task-management.mjs';
import { storeRead, storeStat } from './record-storage.mjs';

const TASKS = '.workflow-system/tasks';
const PROJECT = `${TASKS}/state.json`;
const TEMP = '.workflow-system/tmp/tasks';
const CACHE = '.workflow-system/records/task-view.json';
const BASELINE = '.workflow-system/records/task-view-baseline.json';
const RECOVERY = '.workflow-system/records/task-view-recovery.md';
const lifeStates = new Set(['draft', 'active', 'paused', 'closed', 'ambiguous']);
const doneStates = new Set(['finished', 'skipped', 'closed']);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const now = () => new Date().toISOString();
const base = () => ({ runtime_role: 'assistance', development_gate: false, qualification: 'not-evaluated' });
const failure = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });
const issue = error => ({ code: error.code ?? 'MANAGEMENT_IO_FAILED', message: error.message });
const taskFile = id => `${TASKS}/${hash(id)}.json`;
const tempDirectory = id => `${TEMP}/${hash(id)}`;
const emptyProject = () => ({ kind: 'vnext-task-project-state', schema_version: 1, revision: 0, current_task_id: null, next_display_number: 1, focus_revision: 0 });

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw failure('INVALID_ARGUMENT', `${name} must be a nonempty string.`);
  return value;
}
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('INVALID_ARGUMENT', `${name} must be an object.`);
  return value;
}
function readJson(root, ref, io) { return JSON.parse(fs.readFileSync(io.local(root, ref), 'utf8')); }
function writeJson(root, ref, value, io) { atomicReplace(root, ref, json(value), io); }
function exists(root, ref, io) { return fs.existsSync(io.local(root, ref)); }
function projectState(root, io) {
  if (!exists(root, PROJECT, io)) return null;
  return validateProject(readJson(root, PROJECT, io));
}
export function validateProject(value) {
  if (value.kind !== 'vnext-task-project-state' || value.schema_version !== 1)
    throw failure('TASK_STATE_FORMAT_UNSUPPORTED', 'Unknown Task project-state format.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.next_display_number)
    || value.next_display_number < 1 || (value.current_task_id !== null && typeof value.current_task_id !== 'string')
    || (value.focus_revision !== undefined && (!Number.isSafeInteger(value.focus_revision) || value.focus_revision < 0)))
    throw failure('TASK_STATE_INVALID', 'Invalid Task project-state fields.');
  for (const source of value.migration?.preserved_sources ?? [])
    if (typeof source.path !== 'string' || !source.path.startsWith('.workflow-system/records/')
      || source.path.includes('\\') || source.path.split('/').some(part => !part || part === '..' || part === '.')
      || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.size) || source.size < 0)
      throw failure('TASK_STATE_INVALID', 'Invalid preserved migration source.');
  return value;
}

/** These are byte-pinned citations, not a live journal requiring all old causal parents. */
export function migrationSources(bytes) {
  return validateProject(JSON.parse(bytes.toString('utf8'))).migration?.preserved_sources ?? [];
}

/** Existing projects stay journal-based until an explicit migration publishes PROJECT. */
export function taskStateMode(root, input, io) {
  if (projectState(root, io)) return 'state';
  if (exists(root, TASKS, io) && fs.readdirSync(io.local(root, TASKS)).some(name => name.endsWith('.json')))
    throw failure('TASK_STATE_INCOMPLETE', 'Task files exist without a project state; recover the incomplete publication explicitly.');
  const { home } = io.workflowHome(root, input?.workflow_home);
  const legacy = ['events', 'attachments', 'evidence-objects', 'task-labels', 'archives', 'legacy'].map(name => `.workflow-system/records/${name}`);
  legacy.push(`${home}/CURRENT_TASK.md`, `${home}/task-data`, `${home}/task-history`, `${home}/task-archive`, 'TASKS');
  return legacy.some(ref => exists(root, ref, io)) ? 'journal' : 'fresh';
}

function taskNames(root, io) {
  if (!exists(root, TASKS, io)) return [];
  return fs.readdirSync(io.local(root, TASKS)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
}
function signature(root, ref, io) {
  const stat = fs.statSync(io.local(root, ref));
  if (!stat.isFile()) throw failure('TASK_STATE_INVALID', `Expected a regular Task file: ${ref}`);
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
export function validateTask(task, ref) {
  if (task.kind !== 'vnext-task-state' || task.schema_version !== 1 || typeof task.task_id !== 'string'
    || !task.task_id.trim() || taskFile(task.task_id) !== ref || !lifeStates.has(task.lifecycle)
    || !Number.isSafeInteger(task.revision) || task.revision < 1 || !Array.isArray(task.plans)
    || typeof task.title !== 'string' || !task.title.trim() || !Array.isArray(task.remaining_work)
    || !['constraints', 'decisions', 'product_refs', 'retained_artifacts'].every(key => Array.isArray(task[key]))
    || !task.relations || !task.delivery || typeof task.delivery.summary !== 'string' || !Array.isArray(task.delivery.items))
    throw failure('TASK_STATE_INVALID', `Invalid Task record: ${ref}`);
  for (const key of ['constraints', 'decisions']) {
    const ids = task[key].map(item => item?.id);
    if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length)
      throw failure('TASK_STATE_INVALID', `Invalid ${key}: ${ref}`);
  }
  for (const item of task.delivery.items)
    if (!['implemented', 'partial', 'not-implemented', 'unknown'].includes(item.implementation)
      || !['passed', 'failed', 'not-run', 'unknown'].includes(item.verification))
      throw failure('TASK_STATE_INVALID', `Invalid delivery result: ${ref}`);
  const plans = new Set();
  for (const plan of task.plans) {
    if (typeof plan.ref !== 'string' || plans.has(plan.ref) || !Array.isArray(plan.steps))
      throw failure('TASK_STATE_INVALID', `Invalid or duplicate plan: ${ref}`);
    plans.add(plan.ref);
    const steps = new Set();
    for (const step of plan.steps) {
      if (typeof step.id !== 'string' || steps.has(step.id) || typeof step.state !== 'string'
        || !Array.isArray(step.checks) || !Array.isArray(step.findings)) throw failure('TASK_STATE_INVALID', `Invalid step: ${ref}`);
      steps.add(step.id);
      const checks = step.checks.map(check => JSON.stringify([check.check_id, check.environment_id]));
      if (new Set(checks).size !== checks.length || step.checks.some(check => typeof check.check_id !== 'string'
        || !check.check_id.trim() || typeof check.environment_id !== 'string' || !check.environment_id.trim()
        || !['passed', 'failed', 'not-run', 'unknown'].includes(check.result))) throw failure('TASK_STATE_INVALID', `Invalid verification item: ${ref}`);
    }
  }
  for (const key of ['adopted_plan_ref', 'candidate_plan_ref'])
    if (task[key] !== null && !plans.has(task[key])) throw failure('TASK_STATE_INVALID', `Unknown ${key}: ${ref}`);
}

/** Direct durable dependencies only; logical plan/execution IDs and temporary inputs are not files. */
export function taskStateReferences(ref, bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (ref === PROJECT) {
    validateProject(value);
    return [...(value.current_task_id === null ? [] : [{ path: taskFile(value.current_task_id) }]),
      ...(value.migration?.preserved_sources ?? []).map(source => ({ path: source.path, sha256: source.sha256, size: source.size }))];
  }
  validateTask(value, ref);
  const references = [{ path: PROJECT }];
  for (const id of [value.relations.origin?.parent_task_id, value.relations.continuation?.from_task_id])
    if (typeof id === 'string') references.push({ path: taskFile(id) });
  for (const artifact of value.retained_artifacts) {
    if (typeof artifact?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || typeof artifact.path !== 'string'
      || !new RegExp(`^${TASKS.replaceAll('.', '\\.')}/retained/${hash(value.task_id)}/${artifact.sha256}\\.[a-zA-Z0-9]{1,10}$`).test(artifact.path))
      throw failure('RETAINED_ARTIFACT_INVALID', `Invalid retained material in ${ref}`);
    references.push({ path: artifact.path, sha256: artifact.sha256, size: artifact.size });
  }
  return references;
}

export function taskGitPolicyDefinitions(home, generatedDisplay = false) {
  return [
    ['.workflow-system/.gitignore', '/tmp/tasks/\n/records/task-view.json\n/records/task-views/\n/records/task-view*.lock\n/records/task-view-baseline.json\n/records/task-view-recovery.md\n/tasks/**/*.tmp\n'],
    ['.workflow-system/.gitattributes', '/tasks/** -text -filter -ident -working-tree-encoding\n'],
    ...(generatedDisplay ? [[`${home}/.gitignore`, '/CURRENT_TASK.md\n']] : []),
  ];
}

/** Propose project-owned policy blocks; the caller applies them in its own transaction. */
export function gitPolicyEdits(root, definitions, local) {
  const edits = [], paths = [], issues = [];
  for (const [ref, body] of definitions) {
    paths.push(ref);
    const begin = '# BEGIN vNext checkpoint Git policy', end = '# END vNext checkpoint Git policy';
    let bytes = null;
    try { bytes = fs.readFileSync(local(root, ref)); }
    catch (error) { if (error.code !== 'ENOENT') { issues.push({ ...issue(error), path: ref }); continue; } }
    let content;
    try { content = bytes === null ? '' : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { issues.push({ code: 'POLICY_ENCODING_UNSUPPORTED', path: ref }); continue; }
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const block = `${begin}\n${body}${end}\n`.replaceAll('\n', newline);
    if (content.includes(begin) || content.includes(end)) {
      const prior = `${begin}\n/task-view.json\n/task-views/\n/task-view*.lock\n**/*.tmp\n${end}\n`.replaceAll('\n', newline);
      if (ref === '.workflow-system/records/.gitignore' && content.includes(prior)
        && prior !== block && content.split(begin).length === 2 && content.split(end).length === 2
        && !/@frozen|DO NOT MODIFY/i.test(content)) {
        edits.push({ path: ref, before_sha256: hash(bytes), content: content.replace(prior, block),
          existing_content_retained: true, project_policy_review: true });
        continue;
      }
      if (!content.includes(block) || content.split(begin).length !== 2 || content.split(end).length !== 2)
        issues.push({ code: 'POLICY_BLOCK_EDITED', path: ref, message: 'Keep project customizations; reconcile the policy explicitly, do not overwrite it.' });
      continue;
    }
    if (/@frozen|DO NOT MODIFY/i.test(content)) { issues.push({ code: 'POLICY_FILE_FROZEN', path: ref }); continue; }
    edits.push({ path: ref, before_sha256: bytes === null ? null : hash(bytes),
      content: content + (content && !content.endsWith('\n') ? newline : '') + block,
      existing_content_retained: true, project_policy_review: bytes !== null });
  }
  return { edits, paths, issues };
}

function loadState(root, input, io) {
  const { home, issues: homeIssues } = io.workflowHome(root, input.workflow_home);
  for (let attempt = 0; attempt < 3; attempt++) {
    const beforeProject = exists(root, PROJECT, io) ? fs.readFileSync(io.local(root, PROJECT), 'utf8') : null;
    const project = beforeProject === null ? emptyProject() : validateProject(JSON.parse(beforeProject));
    const names = taskNames(root, io), tasks = [], issues = [...homeIssues, ...(project.migration?.issues ?? [])], hashes = [], stamps = [];
    for (const name of names) {
      const ref = `${TASKS}/${name}`;
      try {
        const before = signature(root, ref, io), bytes = fs.readFileSync(io.local(root, ref));
        stamps.push([ref, before]); hashes.push([ref, hash(bytes)]);
        const task = JSON.parse(bytes); validateTask(task, ref); tasks.push(task);
      } catch (error) { issues.push({ path: ref, ...issue(error) }); }
    }
    let changed = false;
    try {
      const afterProject = exists(root, PROJECT, io) ? fs.readFileSync(io.local(root, PROJECT), 'utf8') : null;
      changed = beforeProject !== afterProject || JSON.stringify(names) !== JSON.stringify(taskNames(root, io))
        || stamps.some(([ref, before]) => signature(root, ref, io) !== before);
    } catch (error) { if (error.code !== 'ENOENT') throw error; changed = true; }
    if (changed) continue;
    if (project.current_task_id !== null && !tasks.some(task => task.task_id === project.current_task_id && task.lifecycle !== 'closed'))
      issues.push({ code: 'FOCUS_UNRESOLVED', message: 'The saved focus has no readable open Task.' });
    return { project, tasks, issues, source_hashes: Object.fromEntries(hashes), workflow_home: home,
      view_revision: hash([home, project, hashes, issues]) };
  }
  throw failure('QUERY_VIEW_CHANGED', 'Task records changed during this read; restart the query.');
}
function selectTask(view, requested, required = true) {
  const ref = requested ?? view.project.current_task_id;
  if (ref === null || ref === undefined) {
    if (required) throw failure('TASK_SELECTION_UNRESOLVED', 'Use one readable, unambiguous Task identity.');
    return null;
  }
  const exact = view.tasks.find(task => task.task_id === ref);
  if (exact) return exact;
  const number = typeof ref === 'string' && /^(?:TASK[- _]?)?\d+$/i.test(ref.trim())
    ? `TASK-${String(Number(ref.trim().replace(/^TASK[- _]?/i, ''))).padStart(3, '0')}` : ref;
  const matches = view.tasks.filter(task => task.display_id === number);
  if (matches.length === 1) return matches[0];
  if (required) throw failure('TASK_SELECTION_UNRESOLVED', 'Use one readable, unambiguous Task identity.');
  return null;
}
function adoptedPlan(task) { return task.plans.find(plan => plan.ref === task.adopted_plan_ref) ?? null; }
function currentStep(task) {
  const plan = adoptedPlan(task);
  if (!plan || task.lifecycle === 'closed') return null;
  return plan.steps.find(step => step.id === task.work_position?.step_id && !doneStates.has(step.state))
    ?? plan.steps.find(step => !doneStates.has(step.state)) ?? null;
}
function stepTarget(task, input) {
  const plan = task.plans.find(plan => plan.ref === (input.plan_ref ?? task.adopted_plan_ref));
  if (!plan || plan.ref !== task.adopted_plan_ref) throw failure('PLAN_NOT_ADOPTED', 'Current work must identify the adopted plan.');
  const step = plan.steps.find(step => step.id === (input.step_id ?? currentStep(task)?.id));
  if (!step) throw failure('STEP_UNRESOLVED', 'No exact step could be selected.');
  return { plan, step };
}
function dependencies(task, view) {
  return view.tasks.filter(child => child.relations.origin?.parent_task_id === task.task_id
    && child.relations.origin.parent_plan_ref === task.adopted_plan_ref)
    .map(child => ({ task_id: child.task_id, parent_step_id: child.relations.origin.parent_step_id,
      lifecycle: child.lifecycle, state: child.relations.dependency.state, return_result: child.relations.return_result }));
}
function stepView(step, source) {
  const execution = step.execution;
  const review = step.review && (step.review.stage === 'draft' || step.review.execution_ref === execution?.ref) ? step.review : null;
  return { ...structuredClone(step), source_ref: source, execution_ref: execution?.ref ?? null,
    review_ref: review?.ref ?? null, review, review_status: review?.verdict ?? 'not-reviewed',
    review_choice: review && step.review_decision?.review_ref === review.ref ? step.review_decision.choice : null,
    disposition_ref: step.disposition?.ref ?? null,
    tests: step.checks.map(check => ({ ...check, applies_to_current_execution: !!execution && check.execution_ref === execution.ref })) };
}
function route(task, step) {
  if (task.lifecycle === 'closed') return { next_route: null, next_mode: null, next_action: null };
  if (task.lifecycle === 'paused' || task.lifecycle === 'ambiguous') return { next_route: 'task-lifecycle', next_mode: null, next_action: 'inspect-task' };
  if (!task.adopted_plan_ref) return { next_route: 'review-draft', next_mode: null, next_action: 'inspect-plan' };
  if (!step) return { next_route: 'close-task', next_mode: null, next_action: null };
  if (!step.execution) return { next_route: 'execute-step', next_mode: null, next_action: 'implement-step' };
  if (!step.review) return { next_route: 'review-change', next_mode: null, next_action: 'review-step' };
  const repair = step.findings.length > 0 && !['accept', 'defer', 'continue'].includes(step.review_choice);
  return { next_route: 'execute-step', next_mode: repair ? 'repair' : 'finish', next_action: repair ? 'repair-step' : 'finish-step' };
}
function taskView(task, view) {
  const source = taskFile(task.task_id), plan = adoptedPlan(task);
  const steps = (plan?.steps ?? []).map(step => stepView(step, source)), current = currentStep(task);
  const result = structuredClone(task); delete result.creation_key; delete result.creation_request_sha256;
  delete result.creation_plan_ref; delete result.last_write;
  const deps = dependencies(task, view), continuation = structuredClone(task.relations.continuation);
  if (continuation) {
    const child = view.tasks.find(row => row.task_id === continuation.from_task_id);
    if (task.lifecycle !== 'active' || continuation.plan_ref !== task.adopted_plan_ref || continuation.step_id !== current?.id
      || (continuation.checkpoint && hash(checkpoint(task, continuation.step_id)) !== hash(continuation.checkpoint))) continuation.status = 'parent-changed';
    else if (!child || child.relations.origin?.parent_task_id !== task.task_id) continuation.status = 'origin-unresolved';
    else if (child.lifecycle === 'ambiguous') continuation.status = 'child-state-unresolved';
    else if (deps.some(dep => dep.lifecycle !== 'closed' || dep.state !== 'satisfied')) continuation.status = 'dependency-unresolved';
    else continuation.status = 'ready';
  }
  const step = steps.find(step => step.id === current?.id) ?? null;
  const advice = continuation?.status === 'ready'
    ? { next_route: 'execute-step', next_mode: null, next_action: 'continue-step' } : route(task, step);
  return { ...result, source_ref: source, source_sha256: view.source_hashes[source], temporary_directory: tempDirectory(task.task_id), plan, steps,
    plan_status: task.migration?.scope_qualification ?? (plan ? 'adopted' : 'candidate'), current_step_id: current?.id ?? null,
    origin: task.relations.origin, dependency: task.relations.dependency, return_entry: task.relations.return_entry,
    return_result: task.relations.return_result, continuation, dependencies: deps,
    waiting_on_task_ids: deps.filter(dep => dep.lifecycle !== 'closed' || !['satisfied', 'cancelled'].includes(dep.state)).map(dep => dep.task_id),
    ...advice, recommendation_only: true };
}
function detailRequest(view, task, detail = 'task', stepId) {
  return { detail, task_ref: task.task_id, workflow_home: view.workflow_home, expected_view_revision: view.view_revision,
    ...(stepId === undefined ? {} : { step_id: stepId }) };
}
function summary(task, view) {
  const current = task.steps.find(step => step.id === task.current_step_id);
  return { task_id: task.task_id, display_id: task.display_id, title: task.title, revision: task.revision, lifecycle: task.lifecycle,
    created_at: task.created_at, closed_at: task.closed_at, adopted_plan_ref: task.adopted_plan_ref,
    current_step_id: task.current_step_id, current_step: current ? { id: current.id, title: current.title, state: current.state,
      execution_ref: current.execution_ref, review_status: current.review_status, finding_count: current.findings.length,
      test_count: current.tests.length } : null,
    source_ref: task.source_ref, source_sha256: task.source_sha256, temporary_directory: task.temporary_directory,
    remaining_work: task.remaining_work, origin: task.origin, dependency: task.dependency,
    dependencies: task.dependencies, continuation: task.continuation, return_result: task.return_result,
    next_route: task.next_route, next_mode: task.next_mode, next_action: task.next_action, detail_request: detailRequest(view, task) };
}

export function stateQuery(root, input, io) {
  object(input, 'query');
  if (input.task_id !== undefined || input.plan_ref !== undefined) throw failure('INVALID_QUERY', 'Use task_ref; step queries select the adopted plan.');
  const detail = input.detail ?? 'summary', offset = input.offset ?? 0, limit = input.limit ?? 20;
  if (!['summary', 'task', 'step'].includes(detail) || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (detail !== 'summary' && (input.offset !== undefined || input.limit !== undefined))
    || (detail === 'step' ? !input.step_id : input.step_id !== undefined) || (offset > 0 && !input.expected_view_revision))
    throw failure('INVALID_QUERY', 'Invalid Task query detail, step or pagination.');
  for (const key of ['task_ref', 'step_id', 'expected_view_revision']) if (input[key] !== undefined) text(input[key], key);
  const view = loadState(root, input, io);
  if (input.expected_view_revision && input.expected_view_revision !== view.view_revision)
    throw failure('QUERY_VIEW_CHANGED', 'The Task view changed; restart this read.');
  const selected = selectTask(view, input.task_ref, false), tasks = view.tasks.map(task => taskView(task, view));
  const task = tasks.find(task => task.task_id === selected?.task_id) ?? null, counts = {};
  const focused = tasks.find(task => task.task_id === view.project.current_task_id);
  const advice = focused ? { next_route: focused.next_route, next_mode: focused.next_mode, next_action: focused.next_action }
    : { next_route: null, next_mode: null, next_action: null };
  for (const row of tasks) counts[row.lifecycle] = (counts[row.lifecycle] ?? 0) + 1;
  const result = { ...base(), kind: 'task-query/v2', status: 'available', detail, workflow_home: view.workflow_home,
    view_revision: view.view_revision, project_revision: view.project.revision,
    current_task_id: view.project.current_task_id, selection: { requested_task_ref: input.task_ref ?? null,
      task_id: task?.task_id ?? null, status: task ? 'resolved' : 'unresolved', detail_request: task ? detailRequest(view, task) : null },
    task_count: tasks.length, lifecycle_counts: counts, coverage: { storage: 'task-state', history: 'not-retained', complete: view.issues.length === 0 },
    issues: view.issues, ...advice,
    next_task_id: view.project.current_task_id, next_step_id: focused?.current_step_id ?? null };
  if (detail === 'summary') {
    const rows = input.task_ref ? (task ? [task] : []) : tasks, end = Math.min(offset + limit, rows.length);
    return { ...result, tasks: rows.slice(offset, end).map(row => summary(row, view)),
      pagination: { total: rows.length, offset, limit, next_offset: end < rows.length ? end : null, view_revision: view.view_revision,
        next_request: end < rows.length ? { detail: 'summary', workflow_home: view.workflow_home, expected_view_revision: view.view_revision,
          offset: end, limit, ...(input.task_ref ? { task_ref: input.task_ref } : {}) } : null } };
  }
  if (detail === 'task') return { ...result, task };
  const step = task?.steps.find(step => step.id === input.step_id) ?? null;
  return { ...result, selection: { ...result.selection, requested_step_id: input.step_id, step_status: step ? 'resolved' : 'unresolved' },
    task: task ? { task_id: task.task_id, lifecycle: task.lifecycle, revision: task.revision, adopted_plan_ref: task.adopted_plan_ref,
      source_ref: task.source_ref, source_sha256: task.source_sha256 } : null,
    step, review: step?.review ?? null };
}

function displayText(view) {
  const clean = value => String(value ?? '').replace(/[\r\n|]/g, ' '), current = view.tasks.find(task => task.task_id === view.project.current_task_id);
  const body = ['# CURRENT_TASK', '', '> Generated current Task display. Query assistance.mjs task-status/context for task facts.', '',
    '## Current work', current ? `- Task: ${clean(current.display_id)} (${clean(current.task_id)}) — ${clean(current.title)}` : '- No current task focus.',
    `- Adopted plan: ${clean(current?.adopted_plan_ref)}`, `- Step: ${clean(current && currentStep(current)?.id)}`, '',
    '| Task | Lifecycle | Plan |', '| --- | --- | --- |',
    ...view.tasks.map(task => `| ${clean(task.display_id)} | ${clean(task.lifecycle)} | ${clean(task.adopted_plan_ref)} |`), '',
    '## Remaining work', ...view.tasks.flatMap(task => task.remaining_work.map(item => `- ${clean(task.display_id)}: ${clean(item)}`)), '',
    'This display is not execution permission, test certification or complete operation history.', ''].join('\n');
  return ['---', 'schema_version: 2', 'kind: vnext-task-view', `display_revision: ${hash(body)}`, '---', '<!-- vnext-task-view/v2 -->', body].join('\n');
}
function publishView(root, input, io) {
  const view = loadState(root, input, io), projection = { cache: 'current', display: 'current' }, issues = [];
  const tasks = view.tasks.map(task => taskView(task, view));
  try { writeJson(root, CACHE, { kind: 'task-view/v2', workflow_home: view.workflow_home, view_revision: view.view_revision,
    project_revision: view.project.revision, current_task_id: view.project.current_task_id, tasks,
    coverage: { storage: 'task-state', history: 'not-retained', complete: view.issues.length === 0 }, issues: view.issues }, io); }
  catch (error) { projection.cache = 'failed'; issues.push({ path: CACHE, ...issue(error) }); }
  try {
    publishDisplay(root, `${view.workflow_home}/CURRENT_TASK.md`, displayText(view), input, io);
  } catch (error) { projection.display = 'failed'; issues.push(issue(error)); }
  return { view, projection, issues };
}

function publishDisplay(root, target, next, input, io) {
  const previous = exists(root, target, io) ? fs.readFileSync(io.local(root, target)) : null;
  const baseline = exists(root, BASELINE, io) ? readJson(root, BASELINE, io) : { current_sha256: null, recovery_sha256: null };
  if (previous?.equals(Buffer.from(next))) {
    if (baseline.current_sha256 !== hash(previous)) writeJson(root, BASELINE, { ...baseline, current_sha256: hash(previous) }, io);
    return;
  }
  if (previous !== null && /@frozen|DO NOT MODIFY/i.test(previous.toString().slice(0, 2048))) throw failure('DISPLAY_FROZEN', 'The current display is frozen.');
  if (previous !== null && hash(previous) !== baseline.current_sha256 && input.overwrite_display !== true)
    throw failure('CURRENT_TASK_DRIFT', 'The display was edited; retain and explicitly resolve those edits.');
  if (exists(root, RECOVERY, io) && hash(fs.readFileSync(io.local(root, RECOVERY))) !== baseline.recovery_sha256)
    throw failure('DISPLAY_RECOVERY_PENDING', 'The fixed recovery file contains unresolved edits.');
  const staging = `${target}.${randomUUID()}.tmp`;
  let captured = false;
  fs.mkdirSync(path.dirname(io.local(root, target)), { recursive: true });
  try {
    atomicReplace(root, staging, next, io);
    if (previous !== null) {
      if (exists(root, RECOVERY, io)) fs.unlinkSync(io.local(root, RECOVERY));
      // Keep the prior inode at one fixed path so an old editor handle cannot silently lose a late save.
      fs.renameSync(io.local(root, target), io.local(root, RECOVERY)); captured = true;
      if (!fs.readFileSync(io.local(root, RECOVERY)).equals(previous)) throw failure('CURRENT_TASK_DRIFT', 'The display changed during publication.');
    }
    fs.linkSync(io.local(root, staging), io.local(root, target));
    writeJson(root, BASELINE, { current_sha256: hash(next), recovery_sha256: captured ? hash(previous) : baseline.recovery_sha256 }, io);
  } finally {
    if (captured && !exists(root, target, io)) fs.linkSync(io.local(root, RECOVERY), io.local(root, target));
    removeTemporaryFile(io.local(root, staging));
  }
}

function planDefinition(input) {
  const value = object(input, 'plan');
  if (!Array.isArray(value.steps)) throw failure('INVALID_PLAN', 'plan.steps must be an array.');
  const definition = scopeDefinition(value), ids = new Set();
  const steps = definition.steps.map((value, index) => {
    const definition = typeof value === 'string' ? { id: `S${index + 1}`, title: value } : object(value, 'step');
    const id = text(definition.id ?? `S${index + 1}`, 'step.id');
    if (ids.has(id)) throw failure('INVALID_PLAN', 'Step IDs must be unique within one plan.');
    ids.add(id);
    return { ...structuredClone(definition), id, title: text(definition.title, 'step.title'), state: 'not-started',
      execution: null, checks: [], review: null, review_decision: null, findings: [], disposition: null };
  });
  return { ...definition, ref: `plan-${randomUUID()}`, title: text(value.title, 'plan.title'),
    steps, review: null };
}
function scopeDefinition(plan) {
  const definition = structuredClone(plan);
  for (const key of ['ref', 'review', 'adopted_at', 'retained']) delete definition[key];
  definition.steps = definition.steps.map(step => {
    if (typeof step === 'string') return step;
    for (const key of ['state', 'execution', 'execution_ref', 'checks', 'tests', 'review', 'review_ref', 'review_status',
      'review_decision', 'review_choice', 'findings', 'disposition', 'disposition_ref', 'source_ref']) delete step[key];
    return step;
  });
  return definition;
}
function newTask(input, view) {
  const plan = planDefinition(input.plan ?? { title: input.title, steps: input.steps ?? [] });
  let number = view.project.next_display_number;
  for (const task of view.tasks) {
    const match = /^TASK-(\d+)$/.exec(task.display_id);
    if (match && Number.isSafeInteger(Number(match[1]))) number = Math.max(number, Number(match[1]) + 1);
  }
  return { kind: 'vnext-task-state', schema_version: 1, task_id: `task-${randomUUID()}`,
    display_id: `TASK-${String(number).padStart(3, '0')}`, title: plan.title,
    revision: 0, created_at: now(), closed_at: null, lifecycle: 'draft', creation_key: input.idempotency_key,
    creation_request_sha256: hash(input), creation_plan_ref: plan.ref, last_write: null, adopted_plan_ref: null, candidate_plan_ref: plan.ref,
    work_position: null, plans: [plan], product_refs: [], constraints: [], decisions: [], remaining_work: [],
    delivery: { summary: '', items: [] }, relations: { origin: null, dependency: { state: 'not-applicable', summary: null },
      return_entry: null, return_result: null, continuation: null }, retained_artifacts: [] };
}
function upsert(rows, item, key) {
  const index = rows.findIndex(row => key(row) === key(item));
  if (index < 0) rows.push(item); else rows[index] = item;
}
function saveDecision(task, input, scope) {
  if (input.decision) {
    const decision = structuredClone(object(input.decision, 'decision'));
    text(decision.id, 'decision.id'); text(decision.text, 'decision.text');
    upsert(task.decisions, decision, row => row.id);
  } else if (typeof input.decision_text === 'string' && input.decision_text.trim()) {
    const id = input.decision_id ?? `decision-${scope}`;
    upsert(task.decisions, { id, choice: input.choice ?? input.action, text: input.decision_text,
      source: input.decision_source ?? { kind: 'text', label: 'caller-reported decision', text: input.decision_text } }, row => row.id);
  }
}
function requireRevision(task, input) {
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision !== task.revision)
    throw failure('REVISION_CONFLICT', 'Task revision differs; read the current record before updating.', { current_revision: task.revision });
}
function setFocus(project, taskId, input) {
  if (project.current_task_id === taskId) return false;
  if (input.expected_project_revision !== project.revision) throw failure('PROJECT_REVISION_CONFLICT', 'Project focus changed; read its current revision.');
  project.current_task_id = taskId; project.focus_revision = (project.focus_revision ?? 0) + 1; return true;
}
function checkpoint(task, stepId) {
  const step = adoptedPlan(task)?.steps.find(step => step.id === stepId);
  return { parent_task_id: task.task_id, parent_plan_ref: task.adopted_plan_ref, parent_step_id: stepId,
    lifecycle: task.lifecycle, step_digest: hash(step ?? null) };
}
function setOrigin(task, input, view) {
  if (!input.origin) return;
  const requested = object(input.origin, 'origin'), parent = selectTask(view, requested.parent_task_id ?? requested.parent_task_ref);
  const plan = requested.parent_plan_ref ?? parent.adopted_plan_ref, stepId = requested.parent_step_id ?? currentStep(parent)?.id;
  if (parent.relations.origin || parent.lifecycle !== 'active' || parent.adopted_plan_ref !== plan || currentStep(parent)?.id !== stepId)
    throw failure('INVALID_ORIGIN', 'Derivation requires the actual active parent step, at one level.');
  if (view.tasks.some(child => child.relations.origin?.parent_task_id === parent.task_id
    && child.relations.origin.parent_plan_ref === plan && child.relations.origin.parent_step_id === stepId
    && !(child.lifecycle === 'closed' && ['satisfied', 'cancelled'].includes(child.relations.dependency.state))))
    throw failure('DEPENDENCY_ALREADY_OPEN', 'This parent step already has an outstanding prerequisite Task.');
  task.relations.origin = { ...structuredClone(requested), parent_task_id: parent.task_id, parent_plan_ref: plan,
    parent_step_id: stepId, return_policy: requested.return_policy ?? 'manual' };
  task.relations.dependency = { state: 'unresolved', summary: null };
  delete task.relations.origin.parent_task_ref;
  if (!['auto', 'manual'].includes(task.relations.origin.return_policy)) throw failure('INVALID_ORIGIN', 'Unknown return policy.');
}
function focusTask(task, input, view) {
  if (task.lifecycle === 'closed') throw failure('TASK_CLOSED', 'A closed Task cannot become the current work focus.');
  const project = view.project, oldFocus = project.current_task_id, origin = task.relations.origin;
  const changed = setFocus(project, task.task_id, input);
  if (changed && origin && oldFocus === origin.parent_task_id) {
    const parent = selectTask(view, origin.parent_task_id);
    if (parent.lifecycle === 'active' && parent.adopted_plan_ref === origin.parent_plan_ref && currentStep(parent)?.id === origin.parent_step_id)
      task.relations.return_entry = { ...checkpoint(parent, origin.parent_step_id), focus_revision: project.focus_revision };
  }
  if (input.return_from) {
    const child = selectTask(view, input.return_from);
    if (child.relations.origin?.parent_task_id !== task.task_id) throw failure('INVALID_RETURN', 'return_from must identify an actual derived Task.');
    task.relations.continuation = { from_task_id: child.task_id, plan_ref: child.relations.origin.parent_plan_ref,
      step_id: child.relations.origin.parent_step_id, resume_context: child.relations.origin.resume_context ?? null,
      checkpoint: checkpoint(task, child.relations.origin.parent_step_id),
      status: child.relations.dependency.state === 'satisfied' ? 'ready' : 'dependency-unresolved' };
  }
}
function dependencyResult(value) {
  object(value, 'dependency');
  if (!['satisfied', 'unresolved', 'cancelled'].includes(value.state) || (value.state === 'satisfied' && !value.summary?.trim()))
    throw failure('INVALID_DEPENDENCY', 'A satisfied dependency requires an actual summary; use unresolved or cancelled otherwise.');
  return structuredClone(value);
}
function returnToParent(task, view, input, changedParents) {
  const origin = task.relations.origin;
  if (!origin || task.relations.return_result?.status === 'returned') return;
  let status = 'dependency-unresolved';
  if (task.relations.dependency.state === 'satisfied') {
    if (task.lifecycle !== 'closed') status = 'awaiting-close';
    else if (origin.return_policy !== 'auto') status = 'manual';
    else {
      const entry = task.relations.return_entry, parent = view.tasks.find(row => row.task_id === origin.parent_task_id);
      if (!entry) status = 'no-return-checkpoint';
      else if (!((view.project.current_task_id === task.task_id && (view.project.focus_revision ?? 0) === entry.focus_revision)
        || (view.project.current_task_id === null && entry.closed_focus_revision === view.project.focus_revision))) status = 'focus-changed';
      else if (!parent || hash(checkpoint(parent, origin.parent_step_id)) !== hash(Object.fromEntries(Object.entries(entry)
        .filter(([key]) => !['focus_revision', 'closed_focus_revision'].includes(key))))) status = 'parent-changed';
      else {
        setFocus(view.project, parent.task_id, input);
        parent.relations.continuation = { from_task_id: task.task_id, plan_ref: origin.parent_plan_ref, step_id: origin.parent_step_id,
          resume_context: origin.resume_context ?? null, checkpoint: checkpoint(parent, origin.parent_step_id), status: 'ready' };
        changedParents.add(parent.task_id); status = 'returned';
      }
    }
  }
  task.relations.return_result = { status, parent_task_id: origin.parent_task_id, parent_plan_ref: origin.parent_plan_ref, parent_step_id: origin.parent_step_id };
}

function commonFields(task, input) {
  for (const key of ['remaining_work', 'constraints', 'product_refs']) if (input[key] !== undefined) {
    if (!Array.isArray(input[key])) throw failure('INVALID_ARGUMENT', `${key} must be an array.`);
    task[key] = structuredClone(input[key]);
  }
  if (input.delivery !== undefined) {
    const delivery = object(input.delivery, 'delivery');
    if (typeof delivery.summary !== 'string' || !Array.isArray(delivery.items)) throw failure('INVALID_ARGUMENT', 'delivery requires summary and items.');
    task.delivery = structuredClone(delivery);
  }
  saveDecision(task, input, input.action);
}
function mergeFindings(step, findings) {
  if (!Array.isArray(findings)) throw failure('INVALID_ARGUMENT', 'findings must be an array.');
  for (const item of findings) {
    const finding = structuredClone(object(item, 'finding'));
    finding.finding_id = text(finding.finding_id ?? finding.id, 'finding_id');
    upsert(step.findings, finding, row => row.finding_id);
  }
}
function applyAction(root, task, input, view, changedParents, io) {
  const action = input.action;
  if (task.lifecycle === 'closed' && ['adopt', 'execution', 'test', 'review', 'review-decision', 'step', 'pause'].includes(action))
    throw failure('TASK_CLOSED', 'Resume explicitly before recording new ordinary implementation.');
  let result = {};
  if (action === 'prepare') {
    if (input.origin) throw failure('INVALID_ORIGIN', 'A plan revision cannot replace task ancestry.');
    const plan = planDefinition(input.plan ?? { title: input.title, steps: input.steps ?? [] });
    const old = task.plans.find(row => row.ref === (task.candidate_plan_ref ?? task.adopted_plan_ref));
    for (const ref of input.retain_plan_refs ?? []) {
      const retained = task.plans.find(row => row.ref === ref);
      if (!retained) throw failure('PLAN_UNRESOLVED', 'A retained scope must identify an existing plan.');
      retained.retained = true;
    }
    if (old && hash(scopeDefinition(old)) === hash(scopeDefinition(plan))) return { plan_ref: old.ref };
    if (old && old.ref !== task.adopted_plan_ref && !old.adopted_at && !old.retained && !old.steps.some(step => step.findings.length || step.execution))
      task.plans = task.plans.filter(row => row.ref !== old.ref);
    task.plans.push(plan); task.candidate_plan_ref = plan.ref; result.plan_ref = plan.ref;
  } else if (action === 'adopt') {
    const plan = task.plans.find(plan => plan.ref === (input.plan_ref ?? task.candidate_plan_ref));
    if (!plan) throw failure('PLAN_UNRESOLVED', 'Adoption requires an existing exact plan.');
    plan.adopted_at ??= now(); task.adopted_plan_ref = plan.ref;
    if (task.candidate_plan_ref === plan.ref) task.candidate_plan_ref = null;
    if (task.lifecycle === 'draft') task.lifecycle = 'active';
    task.work_position = { plan_ref: plan.ref, step_id: plan.steps.find(step => !doneStates.has(step.state))?.id ?? null };
    if (input.focus === true || (input.focus !== false && view.project.current_task_id === null)) focusTask(task, input, view);
    result.plan_ref = plan.ref;
  } else if (['execution', 'test', 'review', 'review-decision', 'step'].includes(action)) {
    if (action === 'review' && input.stage === 'draft') {
      const plan = task.plans.find(plan => plan.ref === (input.plan_ref ?? task.candidate_plan_ref));
      if (!plan) throw failure('PLAN_UNRESOLVED', 'Draft review must identify the actual plan.');
      plan.review = { ref: `review-${randomUUID()}`, stage: 'draft', verdict: input.verdict ?? 'unknown', coverage: input.coverage ?? null,
        provenance: input.provenance ?? 'caller-reported', findings: structuredClone(input.findings ?? []), recorded_at: now() };
      result.review_ref = plan.review.ref;
    } else {
      const { plan, step } = stepTarget(task, input);
      if (action === 'execution') {
        step.execution = { ref: `execution-${randomUUID()}`, summary: text(input.summary ?? input.result, 'summary'),
          source_revision: input.source_revision ?? null, commands: structuredClone(input.commands ?? []), recorded_at: now() };
        step.state = 'executed'; step.review = null; step.review_decision = null; step.disposition = null;
        task.work_position = { plan_ref: plan.ref, step_id: step.id }; result.execution_ref = step.execution.ref;
      } else if (action === 'test') {
        if (!step.execution || input.execution_ref !== step.execution.ref) throw failure('EXECUTION_CHANGED', 'Test result must identify the current actual execution.');
        const reported = text(input.result, 'result'), known = ['passed', 'failed', 'not-run', 'unknown'].includes(reported);
        const check = { check_id: text(input.check_id, 'check_id'), environment_id: text(input.environment_id, 'environment_id'),
          title: input.title ?? input.check_id, command: text(input.command, 'command'), selector: input.selector ?? null,
          result: known ? reported : 'unknown', summary: known ? input.summary ?? '' : `${reported}: ${input.summary ?? ''}`,
          execution_ref: step.execution.ref, subject: structuredClone(input.subject ?? { revision: input.source_revision ?? null }), observed_at: input.observed_at ?? now() };
        upsert(step.checks, check, row => JSON.stringify([row.check_id, row.environment_id])); result.check_id = check.check_id;
      } else if (action === 'review') {
        if (!step.execution || input.execution_ref !== step.execution.ref) throw failure('EXECUTION_CHANGED', 'Change review must identify the current actual execution.');
        step.review = { ref: `review-${randomUUID()}`, stage: 'change', execution_ref: step.execution.ref, verdict: input.verdict ?? 'unknown',
          coverage: input.coverage ?? null, provenance: input.provenance ?? 'caller-reported', recorded_at: now() };
        step.review_decision = null; mergeFindings(step, input.findings ?? []); result.review_ref = step.review.ref;
      } else if (action === 'review-decision') {
        if (!step.review || input.review_ref !== step.review.ref) throw failure('REVIEW_CHANGED', 'Identify the current review before disposition.');
        step.review_decision = { review_ref: step.review.ref, choice: text(input.choice, 'choice'), decision_id: input.decision_id ?? null };
        for (const id of [...(input.resolved_finding_ids ?? []), ...(input.accepted_finding_ids ?? [])]) {
          const finding = step.findings.find(row => row.finding_id === id);
          if (!finding) throw failure('FINDING_UNRESOLVED', `Unknown finding: ${id}`);
          if (input.accepted_finding_ids?.includes(id)) upsert(task.constraints,
            { id: `accepted-${id}`, text: input.decision_text ?? finding.summary, finding_id: id }, row => row.id);
          step.findings = step.findings.filter(row => row.finding_id !== id);
        }
      } else {
        if (!['finished', 'skipped', 'closed', 'in-progress', 'not-started'].includes(input.state)) throw failure('INVALID_STEP_STATE', 'Unknown work disposition.');
        step.state = input.state; step.disposition = { ref: `disposition-${randomUUID()}`, execution_ref: step.execution?.ref ?? null,
          state: input.state, reason: input.reason ?? input.decision_text ?? null, remaining_work: structuredClone(input.remaining_work ?? []) };
        task.work_position = { plan_ref: plan.ref, step_id: plan.steps.find(row => !doneStates.has(row.state))?.id ?? step.id };
      }
      task.relations.continuation = null;
    }
  } else if (action === 'close') {
    task.lifecycle = 'closed'; task.closed_at ??= now();
    if (input.dependency !== undefined) {
      if (!task.relations.origin) throw failure('INVALID_DEPENDENCY', 'A prerequisite outcome requires an actual derived origin.');
      task.relations.dependency = dependencyResult(input.dependency);
    }
    returnToParent(task, view, input, changedParents);
    if (view.project.current_task_id === task.task_id) {
      setFocus(view.project, null, input);
      if (task.relations.return_entry) task.relations.return_entry.closed_focus_revision = view.project.focus_revision;
    }
    result.lifecycle = 'closed';
  } else if (action === 'pause' || action === 'resume') {
    task.lifecycle = action === 'pause' ? 'paused' : 'active'; task.closed_at = null;
    if (action === 'pause' && view.project.current_task_id === task.task_id) setFocus(view.project, null, input);
    if (action === 'resume' && (input.focus === true || (input.focus !== false && view.project.current_task_id === null))) focusTask(task, input, view);
  } else if (action === 'focus') focusTask(task, input, view);
  else if (action === 'dependency') {
    if (!task.relations.origin) throw failure('INVALID_DEPENDENCY', 'A prerequisite outcome requires an actual derived origin.');
    task.relations.dependency = dependencyResult(input.dependency); returnToParent(task, view, input, changedParents);
  } else if (action === 'git') {
    const requested = text(input.sha ?? input.commit_sha, 'sha');
    if (!/^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/.test(requested)) throw failure('INVALID_COMMIT', 'Use an actual full Git commit SHA.');
    let sha = requested, available = false;
    try { sha = execFileSync('git', ['rev-parse', '--verify', `${requested}^{commit}`], { cwd: root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); available = true; }
    catch { /* The explicit association remains unverified; no Git write is attempted. */ }
    task.commits ??= []; upsert(task.commits, { sha, object_available: available, pushed: 'not-inferred', deployed: 'not-inferred' }, row => row.sha);
    result.sha = sha;
  } else if (action === 'retain') result = retainMaterial(root, task, input, io);
  else if (['correct', 'resolve', 'defer'].includes(action)) correctTask(task, input);
  else throw failure('UNKNOWN_TASK_ACTION', `Unsupported Task action: ${action}`);
  commonFields(task, input); return result;
}

function correctTask(task, input) {
  const target = object(input.target ?? {}, 'target');
  if (input.action === 'resolve') {
    if (target.field !== 'lifecycle' || task.lifecycle !== 'ambiguous' || !lifeStates.has(input.selected_value) || input.selected_value === 'ambiguous')
      throw failure('INVALID_RESOLUTION', 'Resolve only an existing ambiguous lifecycle with its actual selected value.');
    text(input.reason, 'reason'); task.lifecycle = input.selected_value; return;
  }
  let value = task;
  if (target.plan_ref) {
    const plan = task.plans.find(plan => plan.ref === target.plan_ref);
    if (!plan || !target.step_id) throw failure('INVALID_TARGET', 'Plan definitions are versioned; target an existing step result for correction.');
    value = plan.steps.find(step => step.id === target.step_id);
    if (!value) throw failure('INVALID_TARGET', 'Unknown step.');
    if (target.check_id) value = value.checks.find(check => check.check_id === target.check_id && check.environment_id === target.environment_id);
    else if (target.finding_id) value = value.findings.find(finding => finding.finding_id === target.finding_id);
    if (!value) throw failure('INVALID_TARGET', 'Unknown check or finding.');
  }
  if (input.action === 'defer') {
    text(input.reason, 'reason');
    if (target.finding_id) value.disposition = { state: 'deferred', reason: input.reason };
    else upsert(task.constraints, { id: `deferred-${hash(target).slice(0, 16)}`, text: input.reason }, row => row.id);
    return;
  }
  const changes = object(input.changes, 'changes'); text(input.reason, 'reason');
  let allowed = ['findings'];
  if (value === task) allowed = ['title', 'product_refs', 'constraints', 'decisions', 'remaining_work', 'delivery'];
  else if (target.check_id) allowed = ['title', 'command', 'selector', 'result', 'summary', 'subject', 'observed_at'];
  else if (target.finding_id) allowed = ['summary', 'disposition', 'severity'];
  for (const [key, next] of Object.entries(changes)) {
    if (!allowed.includes(key)) throw failure('INVALID_CORRECTION', `Cannot replace ${key} through this correction target.`);
    value[key] = structuredClone(next);
  }
}

export function stateTask(root, input, io) {
  let saved = null, result = {}, projectSaved = false;
  try {
    object(input, 'task request');
    for (const key of ['files', 'evidence_refs'])
      if (input[key] !== undefined && !Array.isArray(input[key])) throw failure('INVALID_ARGUMENT', `${key} must be an array.`);
    if (input.action === 'close' && (input.files?.length || input.evidence_refs?.length))
      throw failure('INVALID_ARGUMENT', 'Capture or retain materials before close; closure seals temporary inputs.');
    if (input.action === 'cleanup') return cleanupMaterials(root, input, io);
    if (input.action === 'rebuild') return viewLock(root, io, () => {
      if (!projectState(root, io)) return { ...base(), kind: 'task-write/v1', status: 'applied', recorded: false,
        task_id: null, revision: null, project_revision: 0, source_ref: null, association: 'not-applicable',
        projection: { cache: 'not-created', display: 'not-created' }, issues: [], detail_request: null };
      const published = publishView(root, input, io);
      const task = selectTask(published.view, input.task_ref ?? input.task_id, false);
      return { ...base(), kind: 'task-write/v1', status: published.issues.length ? 'recorded-pending-view' : 'applied', recorded: false,
        task_id: task?.task_id ?? null, revision: task?.revision ?? null, project_revision: published.view.project.revision,
        source_ref: task ? taskFile(task.task_id) : null, association: 'not-applicable',
        detail_request: task ? detailRequest(published.view, task) : null, projection: published.projection, issues: published.issues };
    });
    text(input.idempotency_key, 'idempotency_key');
    const response = viewLock(root, io, () => {
      const mode = taskStateMode(root, input, io), view = loadState(root, input, io);
      const creating = input.action === 'prepare' && input.task_ref === undefined && input.task_id === undefined;
      if (mode === 'fresh' && !creating) throw failure('TASK_SELECTION_UNRESOLVED', 'Create or select a Task before writing its state.');
      const creation = creating && view.tasks.find(task => task.creation_key === input.idempotency_key);
      let task = creation || (creating ? newTask(input, view) : selectTask(view, input.task_ref ?? input.task_id));
      const replay = creation || task.last_write?.key === input.idempotency_key;
      if (replay) {
        const digest = creation ? task.creation_request_sha256 : task.last_write.request_sha256;
        if (digest === undefined || digest === null) throw failure('IDEMPOTENCY_ORIGIN_UNAVAILABLE', 'The original request digest was not retained.');
        if (digest !== hash(input)) throw failure('IDEMPOTENCY_CONFLICT', 'This request key belongs to different input.');
        let replayResult = task.last_write?.result ?? {};
        if (creation && task.last_write?.key !== input.idempotency_key) {
          const retained = task.plans.some(plan => plan.ref === task.creation_plan_ref);
          replayResult = { task_id: task.task_id, plan_ref: retained ? task.creation_plan_ref : null, initial_plan_retained: retained };
        }
        const issues = input.files?.length || input.evidence_refs?.length
          ? [{ code: 'ATTACHMENTS_NOT_REPLAYED', message: 'Task facts were already saved; attachments were not recaptured or reverified. Read their temporary manifest explicitly.' }] : [];
        return writeResponse(task, view, false, 'already-applied', replayResult, { cache: 'not-updated', display: 'not-updated', focus: 'not-updated' }, issues);
      }
      if (!creating) requireRevision(task, input);
      const before = creating ? null : hash(task), beforeProject = hash(view.project), changedParents = new Set();
      task = structuredClone(task);
      if (creating) {
        setOrigin(task, input, view); commonFields(task, input); view.tasks.push(task);
        view.project.next_display_number = Number(task.display_id.slice(5)) + 1; result = { plan_ref: task.candidate_plan_ref };
      } else {
        view.tasks = view.tasks.map(row => row.task_id === task.task_id ? task : row);
        result = applyAction(root, task, input, view, changedParents, io);
      }
      const changed = creating || hash(task) !== before;
      if (hash(view.project) !== beforeProject) view.project.revision++;
      if (changed) {
        task.revision++;
        task.last_write = { key: input.idempotency_key, request_sha256: hash(input), result };
        validateTask(task, taskFile(task.task_id));
      }
      // Reserve project numbering before publishing a new Task; gaps are preferable to duplicate labels.
      if (creating || hash(view.project) !== beforeProject) {
        validateProject(view.project); writeJson(root, PROJECT, view.project, io); projectSaved = true;
      }
      if (changed) { writeJson(root, taskFile(task.task_id), task, io); saved = task; }
      for (const id of changedParents) {
        const parent = view.tasks.find(row => row.task_id === id); parent.revision++;
        parent.last_write = { key: `return:${input.idempotency_key}`, request_sha256: hash(input), result: { from_task_id: task.task_id } };
        writeJson(root, taskFile(parent.task_id), parent, io);
      }
      const published = publishView(root, input, io);
      return writeResponse(task, published.view, changed, published.issues.length ? 'recorded-pending-view' : 'applied', result,
        { ...published.projection, focus: projectSaved ? 'updated' : 'unchanged' }, published.issues);
    });
    if (response.recorded && (input.files?.length || input.evidence_refs?.length))
      response.attachments = attachments(root, input, response.task_id, response.revision, io);
    return response;
  } catch (error) {
    return { ...base(), kind: 'task-write/v1', status: saved ? 'recorded-pending-view' : 'failed', recorded: !!saved,
      task_id: saved?.task_id ?? input?.task_ref ?? input?.task_id ?? null, revision: saved?.revision ?? error.current_revision ?? null,
      result, project_updated: projectSaved, ...issue(error), issues: [issue(error)] };
  }
}
function writeResponse(task, view, recorded, status, result, projection, issues) {
  return { ...base(), kind: 'task-write/v1', status, recorded, task_id: task.task_id, revision: task.revision,
    project_revision: view.project.revision, source_ref: taskFile(task.task_id), association: 'applied', result,
    projection, issues, detail_request: detailRequest(view, task) };
}

export function stateContext(root, input, io) {
  const management = stateQuery(root, input, io);
  return { ...base(), status: 'available', workflow_home: management.workflow_home,
    sources: [TASKS, management.workflow_home], issues: management.issues, management };
}

// Temporary-material operations are below; their writes never alter the Task record.
function writableTask(root, input, io) {
  const view = loadState(root, input, io), task = selectTask(view, input.task_ref ?? input.task_id);
  if (task.lifecycle === 'closed') throw failure('TASK_CLOSED', 'This Task is closed; its temporary inputs are sealed.');
  if (input.expected_revision !== undefined) requireRevision(task, input);
  return { task, view };
}
function ensureTemporary(root, task, io) {
  const directory = tempDirectory(task.task_id), ignore = `${TEMP}/.gitignore`;
  fs.mkdirSync(io.local(root, directory), { recursive: true });
  if (!exists(root, ignore, io)) atomicReplace(root, ignore, '*\n!.gitignore\n', io);
  return directory;
}
function materialManifest(root, task, io) {
  const ref = `${tempDirectory(task.task_id)}/attachments.json`;
  if (!exists(root, ref, io)) return { kind: 'task-temporary-attachments/v1', task_id: task.task_id, files: [] };
  const manifest = readJson(root, ref, io);
  if (manifest.kind !== 'task-temporary-attachments/v1' || manifest.task_id !== task.task_id || !Array.isArray(manifest.files))
    throw failure('TEMPORARY_MANIFEST_INVALID', 'Unknown temporary attachment manifest.');
  return manifest;
}
function ownedTemporary(root, task, requested, io) {
  const absolute = io.local(root, text(requested, 'ref'));
  const ref = path.relative(path.resolve(root), absolute).split(path.sep).join('/');
  if (!ref.startsWith(`${tempDirectory(task.task_id)}/`)) throw failure('TEMPORARY_OWNER_MISMATCH', 'The material does not belong to this Task.');
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw failure('NOT_A_FILE', 'Only task-owned regular files can be retained.');
  return { ref, absolute, stat };
}
function fileDigest(absolute) {
  const fd = fs.openSync(absolute, 'r'), digest = createHash('sha256'), buffer = Buffer.alloc(65536);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, count));
    return digest.digest('hex');
  } finally { fs.closeSync(fd); }
}

export function stateSnapshot(root, input, io) {
  const { task } = writableTask(root, input, io);
  const source = io.local(root, text(input.path, 'path'));
  const sourceRef = path.relative(path.resolve(root), source).split(path.sep).join('/');
  const directory = ensureTemporary(root, task, io), staging = `${directory}/.capture-${randomUUID()}.tmp`;
  const stagedFile = io.local(root, staging), logical = !fs.existsSync(source);
  let fd, out;
  try {
    fd = logical ? undefined : fs.openSync(source, 'r');
    const before = logical ? storeStat(root, sourceRef) : fs.fstatSync(fd);
    if (!logical && !before.isFile()) throw failure('NOT_A_FILE', 'Only regular explicit files are captured.');
    out = fs.openSync(stagedFile, 'wx', 0o600);
    const digest = createHash('sha256'), buffer = Buffer.alloc(65536);
    let size = 0;
    for (;;) {
      const bytes = logical ? storeRead(root, sourceRef, { offset: size, length: buffer.length }).bytes
        : buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, null));
      if (!bytes.length) break;
      digest.update(bytes);
      for (let written = 0; written < bytes.length;) {
        const count = fs.writeSync(out, bytes, written, bytes.length - written);
        if (count <= 0) throw failure('CAPTURE_WRITE_FAILED', 'The temporary capture could not be written completely.');
        written += count;
      }
      size += bytes.length;
    }
    fs.fsyncSync(out); fs.closeSync(out); out = undefined;
    const after = logical ? storeStat(root, sourceRef) : fs.fstatSync(fd), sha256 = digest.digest('hex');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || (logical && before.sha256 !== after.sha256)) throw failure('SOURCE_CHANGED_DURING_CAPTURE', 'The source changed during capture.');
    if (input.sha256 !== undefined && input.sha256 !== sha256) throw failure('SOURCE_DIGEST_MISMATCH', 'Current source bytes do not match the requested digest.');
    return viewLock(root, io, () => {
      const { task: current } = writableTask(root, { ...input, task_ref: task.task_id, expected_revision: task.revision }, io);
      const ref = `${directory}/blobs/${sha256}.blob`, target = io.local(root, ref);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) {
        if (fileDigest(target) !== sha256) throw failure('OBJECT_CORRUPT', 'The existing Task temporary object differs.');
      } else fs.renameSync(stagedFile, target);
      const manifest = materialManifest(root, current, io);
      upsert(manifest.files, { ref, sha256, size, source_path: sourceRef, captured_at: now() }, item => item.ref);
      writeJson(root, `${directory}/attachments.json`, manifest, io);
      return { ...base(), status: 'saved', task_id: task.task_id, revision: current.revision, ref, sha256, size, source_path: sourceRef };
    });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (out !== undefined) fs.closeSync(out);
    removeTemporaryFile(io.local(root, staging));
  }
}

function attachments(root, input, taskId, revision, io) {
  const results = [];
  for (const spec of input.files ?? []) {
    try { results.push(stateSnapshot(root, { ...(typeof spec === 'string' ? { path: spec } : spec), task_ref: taskId, expected_revision: revision }, io)); }
    catch (error) { results.push({ status: 'unavailable', ...issue(error) }); }
  }
  for (const spec of input.evidence_refs ?? []) {
    try {
      object(spec, 'evidence reference');
      if (!/^[a-f0-9]{64}$/.test(spec.sha256 ?? '')) throw failure('INVALID_DIGEST', 'Use a lowercase SHA256 evidence digest.');
      const view = loadState(root, {}, io), task = selectTask(view, taskId);
      let requested = spec.ref;
      if (requested === undefined) {
        requested = task.retained_artifacts.find(item => item.sha256 === spec.sha256)?.path;
        const temporary = `${tempDirectory(taskId)}/blobs/${spec.sha256}.blob`;
        if (!requested && exists(root, temporary, io)) requested = temporary;
        if (!requested) { results.push(io.reference(root, spec, input.workflow_home)); continue; }
      }
      const absolute = io.local(root, text(requested, 'ref'));
      const ref = path.relative(path.resolve(root), absolute).split(path.sep).join('/');
      if (ref.startsWith(`${TEMP}/`) && !ref.startsWith(`${tempDirectory(taskId)}/`))
        throw failure('TEMPORARY_OWNER_MISMATCH', 'Another Task temporary object is not a permanent dependency.');
      const temporary = ref.startsWith(`${tempDirectory(taskId)}/blobs/`) && path.posix.basename(ref) === `${spec.sha256}.blob`;
      const retained = ref.startsWith(`${TASKS}/retained/`) && path.posix.basename(ref).startsWith(`${spec.sha256}.`);
      if (!temporary && !retained) {
        results.push(io.reference(root, spec, input.workflow_home));
        continue;
      }
      const sha256 = fileDigest(absolute), size = fs.statSync(absolute).size;
      if (spec.sha256 !== sha256 || (spec.size !== undefined && spec.size !== size)) throw failure('OBJECT_CORRUPT', 'The evidence reference differs from actual bytes.');
      if (task.lifecycle === 'closed') throw failure('TASK_CLOSED', 'This Task no longer accepts temporary associations.');
      results.push({ status: 'referenced', ref, sha256, size, live_source_read: false });
    } catch (error) { results.push({ status: 'unavailable', ...issue(error) }); }
  }
  return results;
}
export function stateRecord(root, input, io) {
  object(input, 'report'); text(input.report_key, 'report_key');
  if (input.files !== undefined && !Array.isArray(input.files)) throw failure('INVALID_ARGUMENT', 'files must be an array.');
  if (input.evidence_refs !== undefined && !Array.isArray(input.evidence_refs)) throw failure('INVALID_ARGUMENT', 'evidence_refs must be an array.');
  const saved = viewLock(root, io, () => {
    const { task } = writableTask(root, input, io), directory = ensureTemporary(root, task, io);
    const ref = `${directory}/reports/${hash(input.report_key)}.json`;
    const report = { kind: 'task-temporary-report/v1', task_id: task.task_id, report_key: input.report_key,
      body: input.body ?? null, requested_files: input.files ?? [], evidence_refs: input.evidence_refs ?? [], recorded_at: now() };
    writeJson(root, ref, report, io);
    return { ...base(), status: 'recorded', recorded: true, task_id: task.task_id, revision: task.revision,
      ref, size: Buffer.byteLength(json(report)), sha256: hash(json(report)) };
  });
  saved.attachments = attachments(root, input, saved.task_id, saved.revision, io);
  return saved;
}

function retainMaterial(root, task, input, io) {
  const source = ownedTemporary(root, task, input.ref, io), purpose = text(input.purpose, 'purpose');
  const manifest = materialManifest(root, task, io), entry = manifest.files.find(item => item.ref === source.ref);
  const sha256 = fileDigest(source.absolute);
  if (entry && (entry.sha256 !== sha256 || entry.size !== source.stat.size)) throw failure('OBJECT_CORRUPT', 'The selected attachment was changed.');
  const extension = path.posix.extname(entry?.source_path ?? source.ref);
  const suffix = /^\.[a-zA-Z0-9]{1,10}$/.test(extension) && extension !== '.blob' ? extension : '.bin';
  const ref = `${TASKS}/retained/${hash(task.task_id)}/${sha256}${suffix}`, target = io.local(root, ref);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const staging = `${target}.${randomUUID()}.tmp`;
    try { fs.copyFileSync(source.absolute, staging, fs.constants.COPYFILE_EXCL); fs.renameSync(staging, target); }
    finally { removeTemporaryFile(staging); }
  }
  if (fileDigest(target) !== sha256) throw failure('OBJECT_CORRUPT', 'The retained artifact differs.');
  const artifact = { artifact_id: `artifact-${sha256}`, path: ref, sha256, size: source.stat.size, purpose };
  upsert(task.retained_artifacts, artifact, row => row.artifact_id);
  return { ref, sha256, size: source.stat.size, artifact_id: artifact.artifact_id };
}
function temporaryFiles(root, directory, io, files = [], directories = []) {
  if (!exists(root, directory, io)) return { files, directories };
  for (const item of fs.readdirSync(io.local(root, directory), { withFileTypes: true })) {
    const ref = `${directory}/${item.name}`, absolute = io.local(root, ref), stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) temporaryFiles(root, ref, io, files, directories);
    else if (stat.isFile()) files.push({ ref, size: stat.size });
    else throw failure('UNSAFE_PATH', `Unsupported entry in Task temporary directory: ${ref}`);
  }
  directories.push(directory);
  return { files, directories };
}
function cleanupMaterials(root, input, io) {
  return viewLock(root, io, () => {
    const view = loadState(root, input, io), task = selectTask(view, input.task_ref ?? input.task_id);
    requireRevision(task, input);
    if (task.lifecycle !== 'closed') throw failure('TASK_NOT_CLOSED', 'Temporary cleanup requires an already closed Task.');
    const directory = tempDirectory(task.task_id), { files, directories } = temporaryFiles(root, directory, io);
    const result = { ...base(), kind: 'task-cleanup/v1', status: 'clean', task_id: task.task_id, revision: task.revision,
      removed_files: 0, removed_bytes: 0, remaining_refs: [], issues: [] };
    for (const file of files) {
      try { fs.unlinkSync(io.local(root, file.ref)); result.removed_files++; result.removed_bytes += file.size; }
      catch (error) { result.remaining_refs.push(file.ref); result.issues.push({ path: file.ref, ...issue(error) }); }
    }
    for (const ref of directories) {
      try { fs.rmdirSync(io.local(root, ref)); }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') { result.remaining_refs.push(ref); result.issues.push({ path: ref, ...issue(error) }); } }
    }
    if (result.remaining_refs.length || exists(root, directory, io)) result.status = 'partial';
    return result;
  });
}

export function stateFindRoots(root, input, io) {
  const { home } = io.workflowHome(root, input.workflow_home);
  return [TASKS, home, 'TASKS'];
}
