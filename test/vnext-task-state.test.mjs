import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import fsMutable from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { task, queryStatus, queryContext, taskStatus, record, snapshot, read, find } from '../runtime/vnext/support/assistance.mjs';

const runtime = fileURLToPath(new URL('../runtime/vnext/support/', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const file = (root, ref) => path.join(root, ref);
const bytes = (root, ref) => fs.readFileSync(file(root, ref));
const plan = title => ({ title, goal: 'Recover one connection', steps: [{ id: 'S1', title: 'Implement reconnect' }] });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-task-state-'));
  t.after(() => {
    const absolute = path.resolve(root);
    assert(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert(path.basename(absolute).startsWith('vnext-task-state-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return root;
}
function files(root, ref = '') {
  if (!fs.existsSync(file(root, ref))) return [];
  return fs.readdirSync(file(root, ref), { withFileTypes: true }).flatMap(entry => {
    const child = ref ? `${ref}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, child) : [child];
  }).sort();
}
function detail(root, id) { return queryStatus(root, { detail: 'task', task_ref: id }).task; }
function write(root, id, action, input = {}) {
  const view = queryStatus(root, { task_ref: id });
  const result = task(root, { action, task_ref: id, expected_revision: view.tasks[0].revision,
    expected_project_revision: view.project_revision, idempotency_key: randomUUID(), ...input });
  assert.notEqual(result.status, 'failed', JSON.stringify(result));
  return result;
}
function prepare(root, title = 'Reconnect', input = {}) {
  const created = task(root, { action: 'prepare', idempotency_key: randomUUID(), plan: plan(title), ...input });
  assert.equal(created.recorded, true, JSON.stringify(created));
  return created;
}
function active(root, title, input) {
  const created = prepare(root, title, input);
  write(root, created.task_id, 'adopt', { plan_ref: created.result.plan_ref, focus: true });
  return created;
}
function execution(root, id, summary = 'Implemented current reconnect') {
  return write(root, id, 'execution', { step_id: 'S1', summary, source_revision: 'fixture-code-r1' }).result.execution_ref;
}
function check(root, id, ref, environment = 'unit', result = 'passed', extra = {}) {
  return write(root, id, 'test', { check_id: 'single-connection', environment_id: environment, execution_ref: ref,
    command: 'node --test reconnect.test.mjs', result, summary: 'Current observed result', ...extra });
}

test('fresh reads are read-only; creation and bounded writes keep one Task record', t => {
  const root = fixture(t);
  assert.equal(queryStatus(root).kind, 'task-query/v2');
  assert.equal(queryContext(root).management.task_count, 0);
  assert.deepEqual(files(root), []);
  assert.equal(task(root, { action: 'rebuild' }).recorded, false);
  assert.deepEqual(files(root), []);
  const created = active(root), id = created.task_id, ref = execution(root, id);
  const sourceHash = sha(bytes(root, created.source_ref));
  assert.equal(detail(root, id).source_sha256, sourceHash);
  assert.equal(queryStatus(root).tasks[0].source_sha256, sourceHash);
  assert.equal(queryStatus(root).tasks[0].temporary_directory, `.workflow-system/tmp/tasks/${sha(id)}`);
  assert.equal(queryStatus(root, { detail: 'step', task_ref: id, step_id: 'S1' }).task.source_sha256, sourceHash);
  check(root, id, ref);
  const before = files(root), size = bytes(root, created.source_ref).length;
  for (let index = 0; index < 100; index++) check(root, id, ref, 'unit', index % 2 ? 'passed' : 'failed');
  assert.deepEqual(files(root), before);
  assert.equal(files(root, '.workflow-system/tasks').filter(ref => ref !== '.workflow-system/tasks/state.json').length, 1);
  assert(!files(root).some(ref => ref.includes('/events/') || ref.includes('/task-views/') || ref.includes('/legacy/')));
  assert(bytes(root, created.source_ref).length <= size + 20);
  assert.equal(detail(root, id).steps[0].tests.length, 1);
  const readBefore = files(root).map(ref => [ref, sha(bytes(root, ref)), fs.statSync(file(root, ref)).mtimeMs]);
  queryStatus(root); queryContext(root); taskStatus(root); detail(root, id);
  read(root, { ref: created.source_ref }); find(root, { query: 'Reconnect' });
  assert.deepEqual(files(root).map(ref => [ref, sha(bytes(root, ref)), fs.statSync(file(root, ref)).mtimeMs]), readBefore);
});

test('checks preserve other environments, findings and actual gaps through closure', t => {
  const root = fixture(t), created = active(root), id = created.task_id, ref = execution(root, id);
  check(root, id, ref, 'unit', 'failed'); check(root, id, ref, 'device', 'failed'); check(root, id, ref, 'unit', 'passed');
  const reviewed = write(root, id, 'review', { stage: 'change', execution_ref: ref, verdict: 'findings',
    findings: [{ finding_id: 'device-duplicate', summary: 'Duplicate connection on device' }] });
  write(root, id, 'review-decision', { review_ref: reviewed.result.review_ref, choice: 'defer' });
  write(root, id, 'close', { remaining_work: ['Device failure; background not tested'],
    delivery: { summary: 'Implementation exists; device fails', items: [{ owner_id: 'REQ-1', point_id: 'FP-1',
      plan_ref: created.result.plan_ref, step_id: 'S1', coverage: 'Foreground reconnect', implementation: 'implemented', verification: 'failed' }] } });
  const current = detail(root, id);
  assert.equal(current.lifecycle, 'closed'); assert.equal(current.current_step_id, null);
  assert.equal(current.steps[0].state, 'executed'); assert.equal(current.steps[0].tests.length, 2);
  assert.equal(current.steps[0].tests.find(check => check.environment_id === 'device').result, 'failed');
  assert.equal(current.steps[0].findings[0].finding_id, 'device-duplicate');
  assert.equal(current.delivery.items[0].verification, 'failed'); assert.equal(current.remaining_work.length, 1);
  assert.equal(queryStatus(root).current_task_id, null);
});

test('new execution invalidates old checks, review and finish without losing open findings', t => {
  const root = fixture(t), { task_id: id } = active(root), ref = execution(root, id);
  check(root, id, ref);
  write(root, id, 'review', { stage: 'change', execution_ref: ref, verdict: 'clean', findings: [{ finding_id: 'open', summary: 'Still unverified' }] });
  write(root, id, 'step', { state: 'finished' });
  const next = execution(root, id, 'Changed code again');
  const current = detail(root, id).steps[0];
  assert.notEqual(next, ref); assert.equal(current.state, 'executed'); assert.equal(current.review_status, 'not-reviewed');
  assert.equal(current.disposition, null); assert.equal(current.tests[0].applies_to_current_execution, false);
  assert.equal(current.findings.length, 1);
  check(root, id, next); assert.equal(detail(root, id).steps[0].tests[0].applies_to_current_execution, true);
});

test('creation and latest mutation replay without new writes; stale and conflicting inputs fail explicitly', t => {
  const root = fixture(t), request = { action: 'prepare', idempotency_key: 'new-one', plan: plan('Idempotent') };
  const created = task(root, request), baseline = files(root).map(ref => [ref, sha(bytes(root, ref))]);
  const again = task(root, request);
  assert.equal(again.status, 'already-applied'); assert.equal(again.task_id, created.task_id);
  assert.deepEqual(files(root).map(ref => [ref, sha(bytes(root, ref))]), baseline);
  const altered = task(root, { ...request, plan: plan('Different') }); assert.equal(altered.code, 'IDEMPOTENCY_CONFLICT');
  const update = { action: 'adopt', task_ref: created.task_id, expected_revision: 1, expected_project_revision: 1,
    idempotency_key: 'adopt-one', plan_ref: created.result.plan_ref, focus: true };
  const adopted = task(root, update), original = bytes(root, created.source_ref);
  assert.equal(task(root, update).status, 'already-applied'); assert.deepEqual(bytes(root, created.source_ref), original);
  const stale = task(root, { action: 'pause', task_ref: created.task_id, expected_revision: 1, idempotency_key: 'stale' });
  assert.equal(stale.code, 'REVISION_CONFLICT'); assert.equal(stale.recorded, false);
  const creationReplay = task(root, request);
  assert.equal(creationReplay.task_id, created.task_id); assert.equal(creationReplay.result.plan_ref, created.result.plan_ref);
  assert.equal(detail(root, created.task_id).revision, adopted.revision);
});

test('candidate replacement stays bounded; adopted and explicitly retained scopes remain addressable', t => {
  const root = fixture(t), created = prepare(root), id = created.task_id;
  const old = created.result.plan_ref;
  write(root, id, 'prepare', { plan: plan('Revised draft') });
  assert.equal(detail(root, id).plans.length, 1); assert(!detail(root, id).plans.some(plan => plan.ref === old));
  const candidate = detail(root, id).candidate_plan_ref;
  write(root, id, 'adopt', { plan_ref: candidate });
  for (let index = 0; index < 10; index++) write(root, id, 'prepare', { plan: plan(`Draft ${index}`) });
  assert.equal(detail(root, id).plans.length, 2);
  const retained = detail(root, id).candidate_plan_ref;
  write(root, id, 'prepare', { retain_plan_refs: [retained], plan: plan('New candidate') });
  assert.equal(detail(root, id).plans.length, 3);
  assert(detail(root, id).plans.some(plan => plan.ref === retained));
  assert.equal(detail(root, id).adopted_plan_ref, candidate);
});

test('temporary reports overwrite their slot; capture metadata stays small and Git ignores blobs', t => {
  const root = fixture(t), created = active(root), id = created.task_id;
  fs.writeFileSync(file(root, 'run.log'), Buffer.alloc(2 * 1024 * 1024, 120));
  const first = snapshot(root, { task_ref: id, path: 'run.log' });
  const again = snapshot(root, { task_ref: id, path: 'run.log' });
  assert.equal(first.ref, again.ref); assert.equal(first.size, 2 * 1024 * 1024); assert(!('data' in first));
  assert(JSON.stringify(first).length < 1200);
  const one = record(root, { task_ref: id, report_key: 'latest', body: 'first', evidence_refs: [{ sha256: first.sha256 }] });
  assert.equal(one.attachments[0].status, 'referenced'); assert.equal(one.attachments[0].ref, first.ref);
  const two = record(root, { task_ref: id, report_key: 'latest', body: 'second' });
  assert.equal(one.ref, two.ref); assert.equal(JSON.parse(bytes(root, two.ref)).body, 'second');
  assert.equal(files(root).filter(ref => ref.endsWith('.blob')).length, 1);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  assert.equal(execFileSync('git', ['check-ignore', '--', first.ref], { cwd: root, encoding: 'utf8' }).trim().replaceAll('\\', '/'), first.ref);
  assert.equal(find(root, { query: 'second' }).matches.some(match => match.path === two.ref), false);
  assert(find(root, { query: 'second', roots: [path.posix.dirname(two.ref)] }).matches.some(match => match.path === two.ref));
});

test('cleanup removes only a closed Task temporary files and keeps final bytes and retained evidence', t => {
  const root = fixture(t), a = active(root, 'Task A'), b = prepare(root, 'Task B');
  fs.writeFileSync(file(root, 'device.log'), 'actual device failure');
  const aBlob = snapshot(root, { task_ref: a.task_id, path: 'device.log' });
  const bBlob = snapshot(root, { task_ref: b.task_id, path: 'device.log' });
  const reject = task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: detail(root, a.task_id).revision });
  assert.equal(reject.code, 'TASK_NOT_CLOSED'); assert(fs.existsSync(file(root, aBlob.ref)));
  write(root, a.task_id, 'close', { remaining_work: ['Device problem remains'] });
  const retained = write(root, a.task_id, 'retain', { ref: aBlob.ref, purpose: 'Non-reproducible device failure' });
  assert.equal(path.posix.extname(retained.result.ref), '.log');
  const before = bytes(root, a.source_ref), revision = detail(root, a.task_id).revision;
  const cleaned = task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: revision });
  assert.equal(cleaned.status, 'clean'); assert(cleaned.removed_files > 0); assert.deepEqual(bytes(root, a.source_ref), before);
  assert(!fs.existsSync(file(root, path.posix.dirname(path.posix.dirname(aBlob.ref)))));
  assert(fs.existsSync(file(root, bBlob.ref))); assert(fs.existsSync(file(root, 'device.log')));
  assert.equal(Buffer.from(read(root, { ref: retained.result.ref, sha256: retained.result.sha256 }).data, 'base64').toString(), 'actual device failure');
  assert.equal(task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: revision }).removed_files, 0);
  assert.throws(() => snapshot(root, { task_ref: a.task_id, path: 'device.log' }), error => error.code === 'TASK_CLOSED');
  write(root, a.task_id, 'resume', { focus: false });
  const resumed = snapshot(root, { task_ref: a.task_id, path: 'device.log' });
  assert.equal(task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: revision }).code, 'REVISION_CONFLICT');
  assert(fs.existsSync(file(root, resumed.ref)));
});

test('another Task temporary dependency and filesystem links are not followed by retain or cleanup', t => {
  const root = fixture(t), a = active(root, 'A'), b = prepare(root, 'B');
  fs.writeFileSync(file(root, 'run.txt'), 'do not lose');
  const blob = snapshot(root, { task_ref: b.task_id, path: 'run.txt' });
  const report = record(root, { task_ref: a.task_id, report_key: 'wrong-owner', body: 'Do not borrow B temporary evidence',
    evidence_refs: [{ ref: blob.ref, sha256: blob.sha256 }] });
  assert.equal(report.attachments[0].code, 'TEMPORARY_OWNER_MISMATCH');
  const rejected = write(root, b.task_id, 'close'); assert(rejected.recorded);
  const response = task(root, { action: 'retain', task_ref: a.task_id, expected_revision: detail(root, a.task_id).revision,
    idempotency_key: randomUUID(), ref: blob.ref, purpose: 'Wrong owner' });
  assert.equal(response.code, 'TEMPORARY_OWNER_MISMATCH'); assert(fs.existsSync(file(root, blob.ref)));
  write(root, a.task_id, 'close');
  const temp = `.workflow-system/tmp/tasks/${sha(a.task_id)}`;
  fs.mkdirSync(file(root, temp), { recursive: true });
  const outside = file(root, 'keep'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  fs.symlinkSync(outside, file(root, `${temp}/link`), process.platform === 'win32' ? 'junction' : 'dir');
  const cleaned = task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: detail(root, a.task_id).revision });
  assert.equal(cleaned.code, 'UNSAFE_PATH'); assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('late capture cannot publish after closure; partial cleanup is truthful and retryable', t => {
  const root = fixture(t), a = active(root), id = a.task_id;
  fs.writeFileSync(file(root, 'run.txt'), 'failure');
  const originalWrite = fsMutable.writeSync; let closed;
  fsMutable.writeSync = function(fd, buffer, ...args) {
    const result = originalWrite.call(this, fd, buffer, ...args);
    if (!closed && Buffer.isBuffer(buffer) && buffer.toString() === 'failure') closed = write(root, id, 'close');
    return result;
  };
  syncBuiltinESMExports();
  try { assert.throws(() => snapshot(root, { task_ref: id, path: 'run.txt' }), error => error.code === 'TASK_CLOSED'); }
  finally { fsMutable.writeSync = originalWrite; syncBuiltinESMExports(); }
  assert.equal(closed.recorded, true); assert.equal(files(root).filter(ref => ref.endsWith('.blob')).length, 0);
  assert.equal(task(root, { action: 'cleanup', task_ref: id, expected_revision: closed.revision }).status, 'clean');
});

test('fact persistence and view publication failures are distinct; rebuild leaves facts alone', t => {
  const root = fixture(t), a = active(root), cache = '.workflow-system/records/task-view.json';
  fs.unlinkSync(file(root, cache)); fs.mkdirSync(file(root, cache));
  const written = write(root, a.task_id, 'execution', { step_id: 'S1', summary: 'Actual work saved despite cache failure' });
  assert.equal(written.status, 'recorded-pending-view'); assert.equal(written.recorded, true);
  assert.equal(written.projection.cache, 'failed');
  const result = written.result.execution_ref;
  const current = detail(root, a.task_id), before = bytes(root, a.source_ref);
  assert.equal(current.steps[0].execution_ref, result);
  fs.rmdirSync(file(root, cache));
  const rebuilt = task(root, { action: 'rebuild' }); assert.equal(rebuilt.recorded, false); assert.equal(rebuilt.projection.cache, 'current');
  assert.deepEqual(bytes(root, a.source_ref), before);
});

test('cleanup reports real deletion failure and retries without changing the closed Task', t => {
  const root = fixture(t), a = active(root); fs.writeFileSync(file(root, 'run.txt'), 'retained until cleanup');
  const blob = snapshot(root, { task_ref: a.task_id, path: 'run.txt' }); write(root, a.task_id, 'close');
  const revision = detail(root, a.task_id).revision, before = bytes(root, a.source_ref), unlink = fsMutable.unlinkSync;
  fsMutable.unlinkSync = function(target) {
    if (path.resolve(target) === path.resolve(file(root, blob.ref))) throw Object.assign(new Error('fixture file busy'), { code: 'EBUSY' });
    return unlink.call(this, target);
  };
  syncBuiltinESMExports();
  try {
    const result = task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: revision });
    assert.equal(result.status, 'partial'); assert(result.remaining_refs.includes(blob.ref));
    assert(result.issues.some(issue => issue.code === 'EBUSY')); assert.deepEqual(bytes(root, a.source_ref), before);
  } finally { fsMutable.unlinkSync = unlink; syncBuiltinESMExports(); }
  assert.equal(task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: revision }).status, 'clean');
  assert.deepEqual(bytes(root, a.source_ref), before);
});

test('fixed display recovery preserves external edits and late saves without per-revision copies', t => {
  const root = fixture(t), a = active(root), display = 'docs/workflow/CURRENT_TASK.md';
  const fd = fs.openSync(file(root, display), 'a');
  try {
    write(root, a.task_id, 'close');
    fs.writeSync(fd, '\nLate editor note must survive\n');
  } finally { fs.closeSync(fd); }
  const created = prepare(root, 'Next task');
  assert.equal(created.status, 'recorded-pending-view');
  assert(created.issues.some(issue => issue.code === 'DISPLAY_RECOVERY_PENDING'));
  assert.match(bytes(root, '.workflow-system/records/task-view-recovery.md').toString(), /Late editor note/);
  assert.equal(files(root, '.workflow-system/records').length, 3);
});

test('the contract fixture retains its Task ID, PRODUCT scope, timestamps and failed device result', t => {
  const root = fixture(t), example = JSON.parse(fs.readFileSync(new URL('../docs/ops/contract-examples/task-state-v1.json', import.meta.url)));
  assert.equal(example.query_examples.summary.response.tasks[0].source_sha256,
    sha(JSON.stringify(example.task_record, null, 2) + '\n'));
  fs.mkdirSync(file(root, '.workflow-system/tasks'), { recursive: true });
  fs.writeFileSync(file(root, example.task_file), JSON.stringify(example.task_record));
  fs.writeFileSync(file(root, '.workflow-system/tasks/state.json'), JSON.stringify(example.project_state));
  const current = detail(root, example.task_record.task_id), binding = example.product_binding.task;
  assert.equal(current.task_id, binding.task_id); assert.equal(current.adopted_plan_ref, binding.plan_ref);
  assert(current.steps.some(step => step.id === binding.step_id));
  assert.equal(current.created_at, example.task_record.created_at); assert.equal(current.closed_at, example.task_record.closed_at);
  assert.equal(current.steps[0].tests.find(check => check.environment_id === 'android-device-example').result, 'failed');
  assert.equal(task(root, example.write_examples.close.request).status, 'already-applied');
  const recordSha = sha(bytes(root, example.task_file));
  assert.equal(read(root, { ref: example.task_file, sha256: recordSha }).actual_sha256, recordSha);
  fs.writeFileSync(file(root, example.task_file), JSON.stringify({ ...example.task_record, title: 'Changed current title' }));
  assert.throws(() => read(root, { ref: example.task_file, sha256: recordSha }), error => error.code === 'OBJECT_CORRUPT');
  for (const [taskId, display] of [['TASK-003', 'TASK-002'], ['task-third', 'TASK-003']]) {
    fs.writeFileSync(file(root, `.workflow-system/tasks/${sha(taskId)}.json`), JSON.stringify({
      ...example.task_record, task_id: taskId, display_id: display, creation_key: null, last_write: null }));
  }
  assert.equal(detail(root, 'TASK-003').task_id, 'TASK-003');
  assert.equal(detail(root, ' 003 ').task_id, 'task-third');
  fs.writeFileSync(file(root, `.workflow-system/tasks/${sha('unlabelled-import')}.json`), JSON.stringify({
    ...example.task_record, task_id: 'unlabelled-import', display_id: null, creation_key: null, last_write: null }));
  assert.equal(queryStatus(root).selection.status, 'unresolved');
  assert.equal(prepare(root, 'Counter after imported scopes').task_id !== null, true);
  assert(queryStatus(root).tasks.some(task => task.display_id === 'TASK-004'));
});

test('an unreadable unrelated Task stays visible as a gap without blocking a known Task update', t => {
  const root = fixture(t), a = active(root), b = prepare(root, 'Damaged metadata');
  fs.writeFileSync(file(root, b.source_ref), '{broken');
  const result = write(root, a.task_id, 'execution', { summary: 'Known task work', step_id: 'S1' });
  assert.equal(result.recorded, true);
  const view = queryStatus(root); assert.equal(view.coverage.complete, false);
  assert(view.issues.some(issue => issue.path === b.source_ref)); assert(detail(root, a.task_id).steps[0].execution_ref);
});

test('v2 selection, pagination and references bind the actual current view', t => {
  const root = fixture(t), first = prepare(root, 'First'); prepare(root, 'Second');
  const page = queryStatus(root, { limit: 1 }); assert.equal(page.tasks.length, 1); assert(page.pagination.next_request);
  assert.equal(queryStatus(root, page.pagination.next_request).tasks.length, 1);
  const selection = queryStatus(root, { task_ref: first.task_id }).tasks[0];
  assert.equal(detail(root, first.task_id).creation_key, undefined); assert.equal(detail(root, first.task_id).last_write, undefined);
  const raw = read(root, { ref: first.source_ref }); assert.equal(JSON.parse(Buffer.from(raw.data, 'base64')).task_id, first.task_id);
  write(root, first.task_id, 'adopt', { plan_ref: first.result.plan_ref });
  assert.throws(() => queryStatus(root, selection.detail_request), error => error.code === 'QUERY_VIEW_CHANGED');
  assert.throws(() => queryStatus(root, { detail: 'full' }), error => error.code === 'INVALID_QUERY');
  assert.throws(() => read(root, { ref: first.result.plan_ref }), error => error.code === 'ENOENT');
  assert.equal(queryStatus(root, { task_ref: 'unknown' }).selection.status, 'unresolved');
});

test('derived prerequisites return only to the unchanged actual parent position', t => {
  const root = fixture(t), parent = active(root, 'Parent'); execution(root, parent.task_id);
  const child = active(root, 'Prerequisite', { origin: { parent_task_id: parent.task_id, reason: 'Shared contract',
    return_policy: 'auto', resume_context: 'Continue reconnect' } });
  const closed = write(root, child.task_id, 'close', { dependency: { state: 'satisfied', summary: 'Shared contract delivered' } });
  assert.equal(closed.recorded, true); assert.equal(queryStatus(root).current_task_id, parent.task_id);
  assert.equal(detail(root, child.task_id).return_result.status, 'returned');
  assert.equal(detail(root, parent.task_id).continuation.from_task_id, child.task_id);
  assert.equal(queryStatus(root).next_action, 'continue-step');
  assert.equal(detail(root, parent.task_id).steps[0].state, 'executed');
  check(root, parent.task_id, detail(root, parent.task_id).steps[0].execution_ref);
  assert.equal(detail(root, parent.task_id).continuation, null);
});

test('a closed unresolved prerequisite can return after an actual satisfied outcome is recorded', t => {
  const root = fixture(t), parent = active(root, 'Parent'), child = active(root, 'Child', {
    origin: { parent_task_id: parent.task_id, reason: 'Prerequisite', return_policy: 'auto' } });
  write(root, child.task_id, 'close'); assert.equal(queryStatus(root).current_task_id, null);
  assert.equal(detail(root, child.task_id).dependency.state, 'unresolved');
  write(root, child.task_id, 'dependency', { dependency: { state: 'satisfied', summary: 'Delivered now' } });
  assert.equal(queryStatus(root).current_task_id, parent.task_id);
  assert.equal(detail(root, child.task_id).return_result.status, 'returned');
});

test('existing journals and unknown project formats never silently switch data authority', t => {
  const root = fixture(t);
  fs.mkdirSync(file(root, '.workflow-system/records/events'), { recursive: true });
  const created = task(root, { action: 'prepare', plan: plan('Legacy') });
  assert(created.ref.startsWith('.workflow-system/records/events/')); assert.equal(queryStatus(root).kind, 'task-query/v1');
  assert(!fs.existsSync(file(root, '.workflow-system/tasks/state.json')));
  const other = fixture(t); fs.mkdirSync(file(other, '.workflow-system/tasks'), { recursive: true });
  fs.writeFileSync(file(other, '.workflow-system/tasks/state.json'), JSON.stringify({ kind: 'unknown', schema_version: 999 }));
  assert.throws(() => queryStatus(other), error => error.code === 'TASK_STATE_FORMAT_UNSUPPORTED');
  assert.throws(() => record(other, { report_key: 'x', body: 'x' }), error => error.code === 'TASK_STATE_FORMAT_UNSUPPORTED');
  assert(!fs.existsSync(file(other, '.workflow-system/records/events')));
});

test('native copied Runtime works and a Git-only clone needs no temporary blobs for Task facts', t => {
  const root = fixture(t), a = active(root); fs.writeFileSync(file(root, 'run.txt'), 'temporary output');
  snapshot(root, { task_ref: a.task_id, path: 'run.txt' }); write(root, a.task_id, 'close', { remaining_work: ['Device pending'] });
  task(root, { action: 'cleanup', task_ref: a.task_id, expected_revision: detail(root, a.task_id).revision });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  execFileSync('git', ['add', '--', '.workflow-system/tasks'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Task facts'], { cwd: root });
  const clone = file(fixture(t), 'clone'); execFileSync('git', ['clone', '-q', '--no-local', root, clone]);
  assert(!fs.existsSync(file(clone, '.workflow-system/tmp'))); assert.equal(detail(clone, a.task_id).remaining_work[0], 'Device pending');
  const installed = file(clone, '.workflow-system/runtime/support'); fs.mkdirSync(installed, { recursive: true });
  for (const name of ['assistance.mjs', 'task-management.mjs', 'task-state.mjs', 'task-event-codec.mjs', 'record-storage.mjs']) fs.copyFileSync(path.join(runtime, name), path.join(installed, name));
  const queried = spawnSync(process.execPath, [path.join(installed, 'assistance.mjs'), 'task-status', '--root', clone], { input: '{}', encoding: 'utf8' });
  assert.equal(queried.status, 0, queried.stderr); assert.equal(JSON.parse(queried.stdout).kind, 'task-query/v2');
});

test('two native writers never overwrite each other with an old Task revision', async t => {
  const root = fixture(t), a = active(root), revision = detail(root, a.task_id).revision;
  function run(name) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(runtime, 'assistance.mjs'), 'task', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
      child.on('error', reject); child.on('close', () => { try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error(stderr || stdout, { cause: error })); } });
      child.stdin.end(JSON.stringify({ action: 'execution', task_ref: a.task_id, expected_revision: revision, idempotency_key: name, summary: name }));
    });
  }
  const results = await Promise.all([run('writer-one'), run('writer-two')]);
  assert.equal(results.filter(result => result.recorded === true).length, 1, JSON.stringify(results));
  const rejected = results.find(result => result.recorded === false);
  assert(['REVISION_CONFLICT', 'VIEW_BUSY'].includes(rejected.code)); assert.equal(detail(root, a.task_id).revision, revision + 1);
});

test('native CLI leaves no lock, display or capture staging files in a non-ASCII project', t => {
  const root = file(fixture(t), '中文 项目'); fs.mkdirSync(root);
  fs.mkdirSync(file(root, '.workflow-system'));
  fs.writeFileSync(file(root, '.workflow-system/PROJECT_PROFILE.yaml'), 'paths:\n  workflow_home: notes/工作流\n');
  function invoke(command, input) {
    const response = spawnSync(process.execPath, [path.join(runtime, 'assistance.mjs'), command, '--root', root], {
      input: JSON.stringify(input), encoding: 'utf8', windowsHide: true,
    });
    assert.equal(response.status, 0, response.stderr || response.stdout); return JSON.parse(response.stdout);
  }
  const created = invoke('task', { action: 'prepare', idempotency_key: randomUUID(), plan: plan('中文路径') });
  function update(action, input = {}) {
    const view = invoke('task-status', { task_ref: created.task_id });
    return invoke('task', { action, task_ref: created.task_id, expected_revision: view.tasks[0].revision,
      expected_project_revision: view.project_revision, idempotency_key: randomUUID(), ...input });
  }
  update('adopt', { plan_ref: created.result.plan_ref, focus: true });
  update('execution', { step_id: 'S1', summary: '原生调用' });
  const temporary = invoke('task-status', { detail: 'task', task_ref: created.task_id }).task.temporary_directory;
  fs.mkdirSync(file(root, temporary), { recursive: true }); fs.writeFileSync(file(root, `${temporary}/run.log`), 'same capture bytes');
  const captured = invoke('snapshot', { task_ref: created.task_id, path: `${temporary}/run.log` });
  invoke('snapshot', { task_ref: created.task_id, path: `${temporary}/run.log` });
  update('retain', { ref: captured.ref, purpose: 'selected sample' });
  update('close');
  const sealed = bytes(root, created.source_ref);
  assert.deepEqual(files(root).filter(ref => ref.endsWith('.tmp')), []);
  assert.equal(update('cleanup').status, 'clean');
  assert.deepEqual(bytes(root, created.source_ref), sealed);
  assert.deepEqual(files(root).filter(ref => ref.endsWith('.tmp')), []);
  assert.deepEqual(files(root, '.workflow-system/records'), [
    '.workflow-system/records/task-view-baseline.json', '.workflow-system/records/task-view-recovery.md', '.workflow-system/records/task-view.json',
  ]);
});
