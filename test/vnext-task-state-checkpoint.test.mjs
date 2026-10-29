import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gitCheckpoint, task, queryStatus, snapshot, record } from '../runtime/vnext/support/assistance.mjs';

const PROJECT = '.workflow-system/tasks/state.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = (root, ref) => fs.readFileSync(path.join(root, ref));
function put(root, ref, data) { fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), data); }
function git(root, args, input) {
  const result = spawnSync('git', [...(args[0] === 'check-ignore' ? [] : ['--literal-pathspecs']), ...args], { cwd: root, input, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-state-checkpoint-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('vnext-state-checkpoint-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  git(root, ['init', '-q']); git(root, ['config', 'user.name', 'fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  put(root, 'app.txt', 'base\n'); git(root, ['add', '--', 'app.txt']); git(root, ['commit', '-qm', 'base']);
  return root;
}
function prepared(root, input = {}) {
  for (const edit of gitCheckpoint(root, input).configuration) {
    assert.equal(fs.existsSync(path.join(root, edit.path)) ? sha(bytes(root, edit.path)) : null, edit.before_sha256);
    put(root, edit.path, edit.content);
  }
  return gitCheckpoint(root, input);
}
function write(root, id, action, input = {}) {
  const view = queryStatus(root, { task_ref: id });
  const result = task(root, { action, task_ref: id, expected_revision: view.tasks[0].revision,
    expected_project_revision: view.project_revision, idempotency_key: randomUUID(), ...input });
  assert.notEqual(result.status, 'failed', JSON.stringify(result)); return result;
}
function active(root, title = 'Reconnect') {
  const created = task(root, { action: 'prepare', idempotency_key: randomUUID(), plan: {
    title, goal: 'One connection', steps: [{ id: 'S1', title: 'Reconnect' }] } });
  assert.equal(created.recorded, true);
  write(root, created.task_id, 'adopt', { plan_ref: created.result.plan_ref }); return created;
}
function commit(root, plan) {
  assert.deepEqual(plan.issues, [], JSON.stringify(plan.issues));
  if (plan.add_paths.length) git(root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], plan.add_paths.join('\0') + '\0');
  const index = gitCheckpoint(root, { action: 'verify-index', plan });
  assert.equal(index.status, 'verified', JSON.stringify(index.issues));
  git(root, ['commit', '-qm', 'Task state checkpoint']);
  const saved = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: git(root, ['rev-parse', 'HEAD']), index_verification: index });
  assert.equal(saved.status, 'verified', JSON.stringify(saved.issues)); return saved;
}

test('current Task bytes can change across real Git commits; cleanup keeps final facts and clones need no temporary material', t => {
  const root = fixture(t);
  git(root, ['config', 'core.autocrlf', 'true']);
  put(root, '.gitattributes', '*.json text eol=crlf\n'); git(root, ['add', '--', '.gitattributes']); git(root, ['commit', '-qm', 'project policy']);
  const created = active(root), id = created.task_id;
  const first = prepared(root, { record_paths: [created.source_ref, PROJECT] });
  assert.equal(first.files.find(file => file.path === created.source_ref).role, 'task-state');
  assert.equal(commit(root, first).reference_health, 'no-known-gaps');
  const execution = write(root, id, 'execution', { step_id: 'S1', summary: 'Current implementation' }).result.execution_ref;
  write(root, id, 'test', { step_id: 'S1', check_id: 'single', environment_id: 'device', execution_ref: execution,
    result: 'failed', summary: 'Duplicate connection remains', command: 'node --test reconnect.test.mjs' });
  const raw = `.workflow-system/tmp/tasks/${sha(id)}/device.log`;
  put(root, raw, 'device failure\r\n');
  const captured = snapshot(root, { task_ref: id, path: raw });
  const retained = write(root, id, 'retain', { ref: captured.ref, purpose: 'Selected field failure' }).result.ref;
  record(root, { task_ref: id, report_key: 'latest', body: 'Large replaceable execution output' });
  write(root, id, 'close', { remaining_work: ['Device fails'], delivery: { summary: 'Implemented, device failure remains', items: [
    { owner_id: 'REQ-1', point_id: 'FP-1', plan_ref: created.result.plan_ref, step_id: 'S1', coverage: 'Foreground reconnect', implementation: 'implemented', verification: 'failed' }] } });
  const final = bytes(root, created.source_ref);
  assert.equal(write(root, id, 'cleanup').status, 'clean');
  assert.deepEqual(bytes(root, created.source_ref), final);
  assert.equal(fs.existsSync(path.join(root, raw)), false);
  const plan = prepared(root, { record_paths: [created.source_ref, PROJECT, retained] });
  assert.deepEqual(plan.reference_issues, []);
  assert(!plan.issues.some(issue => issue.code === 'TRACKED_FACT_CHANGED'));
  assert(!plan.files.some(file => /\/tmp\/|task-view|CURRENT_TASK\.md$/.test(file.path)));
  assert.equal(commit(root, plan).reference_health, 'no-known-gaps');
  assert.equal(git(root, ['show', `HEAD:${created.source_ref}`]), final.toString().trim());
  assert.equal(git(root, ['check-ignore', '--', '.workflow-system/records/task-view-recovery.md']), '.workflow-system/records/task-view-recovery.md');
  const clone = path.join(root, 'clone'); git(root, ['clone', '-q', '--no-local', root, clone]);
  const taskView = queryStatus(clone, { detail: 'task', task_ref: id }).task;
  assert.equal(taskView.task_id, id); assert.equal(taskView.steps[0].tests[0].result, 'failed');
  assert.deepEqual(taskView.remaining_work, ['Device fails']); assert.equal(taskView.delivery.items[0].point_id, 'FP-1');
  assert.equal(fs.existsSync(path.join(clone, '.workflow-system/tmp')), false);
  assert.equal(fs.existsSync(path.join(clone, 'docs/workflow/CURRENT_TASK.md')), false);
  assert.deepEqual(bytes(clone, created.source_ref), final);
});

test('incremental selection reports direct durable gaps without reading old events, logical IDs or another Task', t => {
  const root = fixture(t), a = active(root), b = task(root, { action: 'prepare', idempotency_key: randomUUID(), title: 'Other Task' });
  put(root, '.workflow-system/records/events/unrelated.json', 'not JSON; not a selected current-state dependency');
  const plan = prepared(root, { record_paths: [a.source_ref, PROJECT] });
  assert.deepEqual(plan.issues, []); assert.deepEqual(plan.reference_issues, []);
  assert(!plan.files.some(file => file.path === b.source_ref || file.path.includes('/events/')));
  const missingProject = prepared(root, { record_paths: [a.source_ref] });
  assert(missingProject.reference_issues.some(issue => issue.code === 'REFERENCE_MISSING' && issue.path === PROJECT));
});

test('retained material is a formal dependency; a temporary report or blob is never selected as a business file', t => {
  const root = fixture(t), created = active(root), id = created.task_id;
  put(root, 'run.log', 'failure');
  const captured = snapshot(root, { task_ref: id, path: 'run.log' });
  const retained = write(root, id, 'retain', { ref: captured.ref, purpose: 'Selected failure' }).result.ref;
  const request = { record_paths: [created.source_ref, PROJECT], business_paths: [captured.ref, '.workflow-system/records/task-view.json', 'docs/workflow/CURRENT_TASK.md'] };
  const plan = prepared(root, request);
  assert(!plan.files.some(file => request.business_paths.includes(file.path)));
  assert.equal(plan.omitted.filter(file => file.reason === 'local-generated').length, 3);
  assert(plan.reference_issues.some(issue => issue.path === retained && issue.code === 'REFERENCE_MISSING'));
  const selected = prepared(root, { record_paths: [created.source_ref, PROJECT, retained] });
  assert.deepEqual(selected.reference_issues, []);
  put(root, retained, 'tampered');
  const changed = gitCheckpoint(root, { record_paths: [created.source_ref, PROJECT, retained] });
  assert(changed.reference_issues.some(issue => issue.code === 'RETAINED_ARTIFACT_BYTES_DIFFER'));
});

test('staged-only current Task content stays selected even when its working copy advances', t => {
  const root = fixture(t), created = active(root);
  commit(root, prepared(root, { record_paths: [created.source_ref, PROJECT] }));
  write(root, created.task_id, 'pause');
  git(root, ['add', '--', created.source_ref, PROJECT]);
  const staged = git(root, ['show', `:${created.source_ref}`]);
  write(root, created.task_id, 'resume');
  const plan = gitCheckpoint(root, { mode: 'paths', source: 'index', business_paths: [created.source_ref, PROJECT] });
  assert.deepEqual(plan.issues, []); assert.deepEqual(plan.configuration, []);
  assert.equal(gitCheckpoint(root, { action: 'verify-index', plan }).status, 'verified');
  assert.equal(git(root, ['show', `:${created.source_ref}`]), staged);
});

test('edited displays and project Git rules stay visible for explicit resolution', t => {
  const root = fixture(t), created = active(root);
  put(root, 'docs/workflow/CURRENT_TASK.md', bytes(root, 'docs/workflow/CURRENT_TASK.md') + '\nexternal decision\n');
  put(root, '.workflow-system/.gitignore', '# project rule\r\n/local-tool/\r\n');
  const plan = gitCheckpoint(root, { record_paths: [created.source_ref, PROJECT] });
  assert(!plan.configuration.some(edit => edit.path === 'docs/workflow/.gitignore'));
  assert(plan.configuration.find(edit => edit.path === '.workflow-system/.gitignore').content.startsWith('# project rule\r\n/local-tool/\r\n'));
  put(root, '.workflow-system/.gitattributes', '# DO NOT MODIFY\n');
  const frozen = gitCheckpoint(root, { record_paths: [created.source_ref, PROJECT] });
  assert(frozen.issues.some(issue => issue.code === 'POLICY_FILE_FROZEN'));
  assert.equal(bytes(root, '.workflow-system/.gitattributes').toString(), '# DO NOT MODIFY\n');
});

test('a fixed recovery copy with external edits is not silently removed from Git tracking', t => {
  const root = fixture(t), created = active(root), recovery = '.workflow-system/records/task-view-recovery.md';
  prepared(root, { record_paths: [created.source_ref, PROJECT] });
  git(root, ['add', '-f', '--', recovery]); git(root, ['commit', '-qm', 'previously tracked recovery fixture']);
  put(root, recovery, bytes(root, recovery) + '\nexternal user decision\n');
  const plan = gitCheckpoint(root, { mode: 'checkpoint', untrack_derived: true });
  assert(!plan.untrack_paths.includes(recovery));
  assert(plan.tracked_derived_retained.includes(recovery));
  assert(plan.issues.some(issue => issue.code === 'RECOVERY_DRIFT_RETAINED'));
  assert(bytes(root, recovery).toString().includes('external user decision'));
});

test('an absent current Task is a durable-data gap, not an implicit business deletion', t => {
  const root = fixture(t), created = active(root);
  commit(root, prepared(root, { record_paths: [created.source_ref, PROJECT] }));
  fs.unlinkSync(path.join(root, created.source_ref));
  const plan = gitCheckpoint(root, { business_paths: [created.source_ref] });
  assert(!plan.delete_paths.includes(created.source_ref));
  assert(plan.issues.some(issue => issue.path === created.source_ref));
});
