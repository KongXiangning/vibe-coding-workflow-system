import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { record, read, find, context, snapshot, task, taskStatus, queryStatus, queryContext } from '../runtime/vnext/support/assistance.mjs';

const runtime = fileURLToPath(new URL('../runtime/vnext/support/assistance.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-assistance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/workflow'), { recursive: true });
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), '---\nbroken: [\nworkflow_status: blocked_by_replan\n');
  fs.writeFileSync(path.join(root, '.workflow-system/PROJECT_PROFILE.yaml'), 'paths:\n  workflow_home: docs/workflow\n');
  return root;
}
const contents = (root, ref) => fs.readFileSync(path.join(root, ref));

test('stale or malformed active state cannot prevent observation retention, search or a user stop', t => {
  const root = fixture(t), old = contents(root, 'docs/workflow/CURRENT_TASK.md');
  const payload = { kind: 'test-run', task_ref: 'old-task', source_revision: 'old-revision',
    body: { command: 'selected-test', result: 'failed', report: 'actual failure remains a failure' },
    files: ['missing-report.txt'] };
  const saved = record(root, payload);
  assert.equal(saved.recorded, true);
  assert.equal(saved.attachments[0].status, 'unavailable');
  assert.deepEqual(JSON.parse(contents(root, saved.ref)).payload, payload);
  assert.equal(saved.qualification, 'not-evaluated');
  assert.equal(read(root, { ref: saved.ref, sha256: saved.sha256 }).status, 'read');
  assert.equal(read(root, { path: path.join(root, saved.ref) }).status, 'read');
  assert.equal(read(root, { path: saved.ref.replaceAll('/', '\\') }).status, 'read');
  assert.ok(find(root, { query: 'actual failure remains' }).matches.some(m => m.path === saved.ref));
  assert.equal(context(root, { task_ref: 'old-task' }).status, 'available');
  const stopped = record(root, { kind: 'task-disposition', task_ref: 'old-task',
    body: { user_decision: 'Stop with the known failures retained', state: 'closed', verification: 'incomplete', previous: saved.ref } });
  assert.equal(stopped.recorded, true);
  assert.deepEqual(contents(root, 'docs/workflow/CURRENT_TASK.md'), old);
  assert.deepEqual(JSON.parse(contents(root, saved.ref)).payload, payload);
});

test('a saved historical body survives live-file changes; old-format evidence is readable without current qualification', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'report.txt'), 'version A: test failed\n');
  const object = snapshot(root, { path: 'report.txt' });
  fs.writeFileSync(path.join(root, 'report.txt'), 'version B: no test run\n');
  assert.equal(Buffer.from(read(root, { path: 'report.txt', sha256: object.sha256 }).data, 'base64').toString(), 'version A: test failed\n');
  assert.equal(snapshot(root, { path: 'report.txt', sha256: object.sha256 }).ref, object.ref);
  const bytes = Buffer.from('genuine legacy test report'), hash = createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.join(root, 'custom/evidence-objects'), { recursive: true });
  fs.writeFileSync(path.join(root, `custom/evidence-objects/${hash}.blob`), bytes);
  assert.deepEqual(Buffer.from(read(root, { sha256: hash, workflow_home: 'custom' }).data, 'base64'), bytes);
  fs.writeFileSync(path.join(root, object.ref), 'tampered');
  assert.throws(() => read(root, { sha256: object.sha256 }), /Preserved object differs/);
  assert.equal(record(root, { kind: 'execution', body: 'development continues with damaged historical evidence reported' }).recorded, true);
  assert.equal(fs.readFileSync(path.join(root, 'report.txt'), 'utf8'), 'version B: no test run\n');
});

test('exact replay does not recapture files; conflicting reports are retained separately without rewriting the original', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'report.txt'), 'failed');
  const payload = { kind: 'test-run', idempotency_key: 'run-1', body: { result: 'failed' }, files: ['report.txt'] };
  const first = record(root, payload), before = contents(root, first.ref), attachment = contents(root, first.attachments_ref);
  fs.writeFileSync(path.join(root, 'report.txt'), 'changed later');
  const replay = record(root, payload);
  assert.equal(replay.status, 'already-recorded');
  assert.equal(replay.ref, first.ref);
  assert.deepEqual(contents(root, first.attachments_ref), attachment);
  const conflict = record(root, { ...payload, body: { result: 'passed', claimed_by: 'caller' } });
  assert.equal(conflict.recorded, true);
  assert.notEqual(conflict.ref, first.ref);
  assert.equal(conflict.issues[0].code, 'IDEMPOTENCY_CONFLICT_RETAINED');
  assert.deepEqual(contents(root, first.ref), before);
  assert.equal(conflict.qualification, 'not-evaluated');
  assert.equal(record(root, { ...payload, body: { result: 'passed', claimed_by: 'caller' } }).status, 'already-recorded');
  fs.writeFileSync(path.join(root, first.ref), '{corrupt old record');
  const afterCorruption = record(root, { ...payload, body: 'a new observation despite a damaged old key record' });
  assert.equal(afterCorruption.recorded, true);
  assert.equal(contents(root, first.ref).toString(), '{corrupt old record');
});

test('large historic objects and paginated literal queries work without a one-MiB evidence admission gate', t => {
  const root = fixture(t), bytes = Buffer.alloc(2 * 1024 * 1024, 120);
  Buffer.from('old-test-needle').copy(bytes, 65532);
  Buffer.from('old-test-needle').copy(bytes, bytes.length - 20);
  fs.writeFileSync(path.join(root, 'report.txt'), bytes);
  const object = snapshot(root, { path: 'report.txt' });
  let cursor, matches = [];
  do {
    const page = find(root, { query: 'old-test-needle', roots: [object.ref], scan_bytes: 32768, max_results: 1, cursor });
    matches.push(...page.matches); cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(matches.map(m => m.offset), [65532, bytes.length - 20]);
  const tail = read(root, { sha256: object.sha256, offset: bytes.length - 30 });
  assert.deepEqual(Buffer.from(tail.data, 'base64'), bytes.subarray(bytes.length - 30));
  assert.equal(tail.next_offset, null);
});

test('unsafe attachment paths cannot write outside management storage or destroy the retained report', t => {
  const root = fixture(t), original = contents(root, 'docs/workflow/CURRENT_TASK.md');
  assert.throws(() => snapshot(root, { path: '../outside' }), /repository-relative/);
  const saved = record(root, { body: 'real observation', files: ['../outside', '.git/config'] });
  assert.equal(saved.recorded, true);
  assert.equal(saved.attachments.length, 2);
  assert.ok(saved.attachments.every(a => a.status === 'unavailable'));
  assert.deepEqual(contents(root, 'docs/workflow/CURRENT_TASK.md'), original);
});

test('the installed native entry works without kernel/dependencies; concurrent replays do not duplicate a report', async t => {
  const root = fixture(t), installed = path.join(root, '.workflow-system/runtime/support/assistance.mjs');
  fs.mkdirSync(path.dirname(installed), { recursive: true }); fs.copyFileSync(runtime, installed);
  fs.copyFileSync(path.join(path.dirname(runtime), 'task-management.mjs'), path.join(path.dirname(installed), 'task-management.mjs'));
  const call = payload => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [installed, 'record', '--root', root]);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('error', reject); child.on('close', code => code ? reject(new Error(stderr || stdout)) : resolve(JSON.parse(stdout)));
    child.stdin.end(JSON.stringify(payload));
  });
  const result = await Promise.all([call({ body: 'same real failure', idempotency_key: 'concurrent' }), call({ body: 'same real failure', idempotency_key: 'concurrent' })]);
  assert.equal(result[0].ref, result[1].ref);
  assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, 1);
  const badRead = spawnSync(process.execPath, [installed, 'read', '--root', root], { input: '{"path":"missing.txt"}', encoding: 'utf8' });
  assert.equal(badRead.status, 1);
  assert.equal(JSON.parse(badRead.stdout).recorded, false);
  assert.equal(JSON.parse(badRead.stdout).development_gate, false);
  assert.equal((await call({ kind: 'execution', body: 'independent next observation' })).recorded, true);
});

// Query projections exercise the real reducer and store, not a fabricated summary.
function queryFixture(t) {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), '<!-- vnext-task-view/v1 -->\n');
  return root;
}
function addPlan(root, title = 'Query fixture') {
  return task(root, { action: 'prepare', plan: { title, goal: 'Retain actual work',
    acceptance: ['Read the original report'], design: 'original plan detail '.repeat(1000),
    steps: [{ id: 'S1', title: 'First', environment: ['local Node'], validation: ['targeted test'] },
      { id: 'S2', title: 'Second' }] } });
}
function treeState(root) {
  const found = [];
  function visit(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.statSync(file);
      if (stat.isDirectory()) visit(file);
      else found.push([path.relative(root, file), stat.mtimeMs,
        createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    }
  }
  visit(root); return found;
}
function assertSameManagement(compact, full) {
  for (const key of ['source_revision', 'view_revision', 'current_task_id', 'health', 'state_completeness',
    'records_scanned', 'projection', 'issues', 'unassociated_records', 'recovery_options'])
    assert.deepEqual(compact[key], full[key], key);
  assert.equal(compact.development_gate, false);
  assert.equal(compact.qualification, 'not-evaluated');
  assert.equal(compact.task_count, full.tasks.length);
}

test('summary and context present all-fact state once; detail reads preserve failed work, decisions and bytes', t => {
  const root = queryFixture(t), prepared = addPlan(root);
  task(root, { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref, decision_text: 'use this plan' });
  fs.writeFileSync(path.join(root, 'report.txt'), 'original failed report\r\n');
  const run = task(root, { action: 'execution', result: 'failed', source_revision: 'actually-tested',
    observations: 'full execution detail '.repeat(2000), files: ['report.txt'] });
  task(root, { action: 'test', command: 'selected test', result: 'failed' });
  const review = task(root, { action: 'review', stage: 'change', execution_ref: run.ref, verdict: 'findings',
    provenance: 'self-review', findings: [{ id: 'F1', text: 'Still broken' }] });
  const choice = task(root, { action: 'review-decision', review_ref: review.ref, choice: 'defer',
    decision_text: 'Keep the finding and defer the repair' });
  task(root, { action: 'step', state: 'in-progress', decision_ref: choice.ref, remaining_work: ['F1'] });
  const other = addPlan(root, 'Closed work');
  task(root, { action: 'close', task_id: other.task_id, remaining_work: ['Device check not run'], gaps: ['Separate recorded gap'] });
  record(root, { kind: 'decision', body: 'Unassociated real user text' });
  // A damaged persisted cache must not influence either summary or detail.
  fs.writeFileSync(path.join(root, '.workflow-system/records/task-view.json'), '{bad cache');
  const before = treeState(root), full = taskStatus(root), summary = queryStatus(root);
  assertSameManagement(summary, full);
  assert.equal(summary.projection.cache, 'unreadable');
  const current = summary.tasks.find(x => x.task_id === prepared.task_id);
  assert.equal(current.current_step.execution_result, 'failed');
  assert.equal(current.current_step.review_status, 'findings');
  assert.equal(current.current_step.review_choice, 'defer');
  assert.equal(current.current_step.finding_count, 1);
  assert.equal(current.current_step.test_count, 1);
  assert.equal(current.current_step.review_decision_ref, choice.ref);
  assert.equal(Object.hasOwn(current, 'plans'), false);
  assert.equal(Object.hasOwn(current, 'executions'), false);
  assert.deepEqual(summary.tasks.find(x => x.task_id === other.task_id).remaining_work, ['Device check not run']);
  assert.deepEqual(summary.tasks.find(x => x.task_id === other.task_id).gaps, ['Separate recorded gap']);
  assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length / 4);
  const detail = queryStatus(root, current.detail_request);
  assert.deepEqual(detail.task, full.tasks.find(x => x.task_id === prepared.task_id));
  assertSameManagement(detail, full);
  const step = queryStatus(root, { detail: 'step', task_ref: prepared.task_id, step_id: 'S1' });
  assert.deepEqual(step.step, detail.task.steps[0]);
  assert.deepEqual(step.review, detail.task.reviews.find(x => x.ref === review.ref));
  assert.equal(step.coverage.history, 'selected-step-projection-only');
  const parts = []; let offset = 0;
  do {
    const page = read(root, { ref: step.step.execution_ref, offset });
    parts.push(Buffer.from(page.data, 'base64')); offset = page.next_offset;
  } while (offset !== null);
  const raw = JSON.parse(Buffer.concat(parts));
  assert.equal(raw.payload.task_event.data.result, 'failed');
  const attachment = JSON.parse(contents(root, `.workflow-system/records/attachments/${path.basename(run.ref)}`));
  assert.equal(Buffer.from(read(root, { sha256: attachment.attachments[0].sha256 }).data, 'base64').toString(), 'original failed report\r\n');
  assert.deepEqual(queryStatus(root, { detail: 'full' }), full);
  const compactContext = queryContext(root), legacyContext = context(root, {});
  assert.deepEqual(compactContext.management, summary);
  for (const field of ['tasks', 'current_task', 'current_task_id', 'records']) assert.equal(Object.hasOwn(compactContext, field), false);
  assert.deepEqual(queryContext(root, { detail: 'full' }), legacyContext);
  assert.ok(Object.hasOwn(legacyContext, 'current_task')); // Existing JS callers remain compatible.
  assert.deepEqual(treeState(root), before);
});

test('summary retains global conflicts, unreadable and deferred unassociated records even when selecting another task', t => {
  const root = queryFixture(t), first = addPlan(root, 'First'), second = addPlan(root, 'Second');
  task(root, { action: 'adopt', task_id: first.task_id, plan_ref: first.ref, focus: false });
  task(root, { action: 'adopt', task_id: second.task_id, plan_ref: second.ref, focus: false });
  const ambiguous = queryStatus(root);
  assert.equal(ambiguous.current_task_id, null);
  assert.equal(ambiguous.lifecycle_counts.active, 2);
  assert.ok(ambiguous.issues.some(x => x.code === 'FOCUS_CHOICE_REQUIRED'));
  assert.equal(queryStatus(root, { detail: 'task' }).task, null);
  const alternative = task(root, { action: 'prepare', task_id: second.task_id, parents: [second.ref],
    plan: { title: 'Alternative', steps: [{ id: 'S1', title: 'Other work' }] } });
  task(root, { action: 'adopt', task_id: second.task_id, plan_ref: alternative.ref, focus: false,
    parents: [second.ref, alternative.ref] });
  const unlinked = record(root, { kind: 'decision', body: 'A retained decision with no association' });
  const issueId = taskStatus(root).issues.find(x => x.code === 'UNASSOCIATED_RECORD' && x.ref === unlinked.ref).id;
  task(root, { action: 'defer', issue_ids: [issueId], reason: 'Keep the gap visible' });
  fs.writeFileSync(path.join(root, '.workflow-system/records/events/unreadable.json'), '{broken');
  const before = treeState(root), input = { task_ref: first.task_id, limit: 1 };
  const full = taskStatus(root, input), summary = queryStatus(root, input);
  assertSameManagement(summary, full);
  assert.equal(summary.tasks.length, 1);
  assert.equal(summary.tasks[0].task_id, first.task_id);
  assert.ok(summary.issues.some(x => x.code === 'RECORD_CONFLICT'));
  assert.ok(summary.issues.some(x => x.code === 'RECORD_UNREADABLE'));
  assert.ok(summary.issues.find(x => x.id === issueId).deferred_by.length);
  assert.equal(queryStatus(root, { detail: 'task', task_ref: 'missing-task' }).task, null);
  const missingStep = queryStatus(root, { detail: 'step', task_ref: first.task_id, step_id: 'missing' });
  assert.equal(missingStep.selection.step_status, 'unresolved');
  assert.equal(missingStep.step, null);
  assert.deepEqual(treeState(root), before);
});

test('summary pagination exposes complete task counts, requires a matching live revision and never truncates diagnostics', t => {
  const root = queryFixture(t);
  for (let i = 0; i < 23; i++) task(root, { action: 'prepare', plan: { title: `Task ${i}`, steps: [] } });
  record(root, { kind: 'decision', body: 'Pending association across every page' });
  const first = queryStatus(root), full = taskStatus(root), before = treeState(root);
  assert.equal(first.tasks.length, 20);
  assert.equal(first.pagination.total, 23);
  const next = queryStatus(root, first.pagination.next_request);
  assert.equal(next.pagination.next_offset, null);
  assert.deepEqual([...first.tasks, ...next.tasks].map(x => x.task_id), full.tasks.map(x => x.task_id));
  assert.deepEqual(next.issues, first.issues);
  assert.deepEqual(next.unassociated_records, first.unassociated_records);
  assert.deepEqual(treeState(root), before);
  assert.throws(() => queryStatus(root, { offset: 20 }), { code: 'INVALID_QUERY' });
  record(root, { kind: 'observation', body: 'Facts changed between reads' });
  const changed = treeState(root);
  assert.throws(() => queryStatus(root, { offset: 20, expected_view_revision: first.view_revision }), { code: 'QUERY_VIEW_CHANGED' });
  assert.deepEqual(treeState(root), changed);
});

test('query selectors fail explicitly without writes; a closed task remains selectable and an empty store stays empty', t => {
  const root = queryFixture(t), before = treeState(root), empty = queryStatus(root);
  assert.equal(empty.task_count, 0);
  assert.equal(empty.selection.status, 'unresolved');
  for (const input of [null, [], { detail: 'unknown' }, { task_ref: '' }, { detail: 'step' },
    { limit: 101 }, { offset: -1 }, { step_id: 'S1' }, { detail: 'task', limit: 1 },
    { task_id: 'would-be-ignored' }, { detail: 'step', step_id: 'S1', plan_ref: 'old-plan' }])
    assert.throws(() => queryStatus(root, input), { code: 'INVALID_QUERY' });
  assert.deepEqual(treeState(root), before);
  const prepared = addPlan(root);
  task(root, { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref });
  task(root, { action: 'close', task_id: prepared.task_id, remaining_work: ['S1 not run'] });
  const stopped = treeState(root);
  const selected = queryStatus(root, { detail: 'task', task_ref: prepared.task.display_id });
  assert.equal(selected.current_task_id, null);
  assert.equal(selected.task.task_id, prepared.task_id);
  assert.equal(selected.task.lifecycle, 'closed');
  assert.deepEqual(treeState(root), stopped);
});

test('installed CLI defaults to compact queries, supports full compatibility and keeps writes on the old result contract', t => {
  const root = queryFixture(t), prepared = addPlan(root);
  task(root, { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref });
  const installed = path.join(root, '.workflow-system/runtime/support/assistance.mjs');
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.copyFileSync(runtime, installed);
  fs.copyFileSync(path.join(path.dirname(runtime), 'task-management.mjs'), path.join(path.dirname(installed), 'task-management.mjs'));
  const call = (command, input = {}, status = 0) => {
    const result = spawnSync(process.execPath, [installed, command, '--root', root],
      { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, status, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  const before = treeState(root), expected = queryStatus(root);
  assert.deepEqual(call('task-status'), expected);
  assert.deepEqual(call('task', { action: 'status' }), expected);
  assert.deepEqual(call('task'), expected);
  assert.deepEqual(call('context').management, expected);
  assert.deepEqual(call('task-status', { detail: 'full' }), JSON.parse(JSON.stringify(taskStatus(root))));
  assert.deepEqual(call('context', { detail: 'full' }), JSON.parse(JSON.stringify(context(root, {}))));
  assert.equal(call('task-status', { detail: 'step', task_ref: prepared.task_id, step_id: 'S1' }).step.id, 'S1');
  const badQuery = call('task', { action: 'status', detail: 'bad' }, 1);
  assert.equal(badQuery.code, 'INVALID_QUERY');
  assert.equal(badQuery.recorded, false);
  assert.equal(badQuery.development_gate, false);
  assert.deepEqual(treeState(root), before);
  const written = call('task', { action: 'execution', result: 'failed', detail: 'caller-owned arbitrary field' });
  assert.equal(written.recorded, true);
  assert.equal(written.association, 'applied');
  assert.equal(written.task.steps[0].execution.result, 'failed');
  assert.ok(Array.isArray(written.task.plans));
  assert.equal(JSON.parse(contents(root, written.ref)).payload.request.detail, 'caller-owned arbitrary field');
});
