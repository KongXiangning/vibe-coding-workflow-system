import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { task, taskStatus, record, context, read } from '../runtime/vnext/support/assistance.mjs';

const RUNTIME = fileURLToPath(new URL('../runtime/vnext/support/', import.meta.url));
const bytes = (root, ref) => fs.readFileSync(path.join(root, ref));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-task-management-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.mkdirSync(path.join(root, 'docs/workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), [
    '---', 'schema_version: 1', 'kind: vnext-current-task', 'document_id: doc-old004',
    'runtime_state:', '  task_id: "004"', '  task_slug: historical-work', '  workflow_status: active',
    '  lifecycle_state: active', '  active_step_id: S3', '  active_step_status: ready', '---', '# Old task', ''
  ].join('\n'));
  return root;
}
const plan = title => ({ title, goal: 'wire integration', acceptance: ['first page displays actual event'],
  steps: [{ id: 'S1', title: 'wire and hash', validation: ['targeted regression'], environment: ['local Node'] },
    { id: 'S2', title: 'first page smoke', environment: ['Android device', 'external host'] }] });
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('close 004, prepare/adopt 005, execute/review/dispose/commit/close share one state without qualification gates', t => {
  const root = fixture(t), legacy = bytes(root, 'docs/workflow/CURRENT_TASK.md');
  assert.equal(taskStatus(root).current_task.steps[0].state, 'legacy-state');
  assert.equal(taskStatus(root).current_task.steps[0].legacy_step_status, 'ready');
  const legacyRun = task(root, { action: 'execution', result: 'blocked', source_revision: 'legacy-worktree' });
  assert.equal(legacyRun.association, 'applied');
  assert.equal(legacyRun.task.steps[0].execution.result, 'blocked');
  const closed = task(root, { action: 'close', task_ref: 'TASK-004', decision_text: 'close with stale reports retained', remaining_work: ['four old reports stale', 'uncommitted changes'] });
  assert.equal(closed.task.lifecycle, 'closed'); assert.equal(taskStatus(root).current_task, null);
  assert.match(bytes(root, 'docs/workflow/CURRENT_TASK.md').toString(), /TASK-004 \| closed/);
  const created = task(root, { action: 'prepare', plan: plan('App integration'), idempotency_key: 'new-app' });
  assert.equal(created.task.display_id, 'TASK-005'); assert.equal(created.task.plan_status, 'candidate');
  assert.equal(taskStatus(root).current_task, null);
  const draft = task(root, { action: 'review', task_id: created.task_id, stage: 'draft', plan_ref: created.ref, verdict: 'clean', conditions: ['preserve backups'] });
  assert.equal(draft.task.plan_status, 'candidate');
  const adopt = task(root, { action: 'adopt', task_id: created.task_id, plan_ref: created.ref, review_ref: draft.ref, decision_text: 'confirm', idempotency_key: 'adopt-app' });
  assert.equal(adopt.task.plan_status, 'adopted'); assert.equal(adopt.current_task_id, created.task_id);
  assert.equal(context(root, {}).current_task.display_id, 'TASK-005');
  assert.equal(taskStatus(root).current_task.current_step_id, 'S1');
  assert.deepEqual(taskStatus(root).current_task.steps[1].environment, ['Android device', 'external host']);
  const run = task(root, { action: 'execution', result: 'failed', source_revision: 'worktree-A', commands: [{ command: 'selected test', result: 'failed' }] });
  assert.equal(run.task.steps[0].execution.result, 'failed'); assert.equal(run.task.steps[0].review_status, 'not-reviewed');
  const review = task(root, { action: 'review', stage: 'change', execution_ref: run.ref, verdict: 'findings', findings: [{ id: 'F1', text: 'known issue' }], provenance: 'self-review' });
  const disposition = task(root, { action: 'review-decision', review_ref: review.ref, choice: 'accept', decision_text: 'keep finding, finish S1' });
  assert.equal(disposition.task.steps[0].review_status, 'findings');
  assert.equal(disposition.task.steps[0].findings.length, 1);
  assert.equal(disposition.task.steps[0].review_choice, 'accept');
  assert.equal(disposition.task.next_mode, null);
  const finished = task(root, { action: 'step', state: 'finished', decision_ref: disposition.ref, remaining_work: ['F1 remains'] });
  assert.equal(finished.task.current_step_id, 'S2'); assert.equal(finished.task.steps[0].execution.result, 'failed');
  git(root, ['init', '-q']); git(root, ['config', 'user.name', 'test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(path.join(root, 'app.txt'), 'a real change'); git(root, ['add', 'app.txt']); git(root, ['commit', '-qm', 'real test commit']);
  const sha = git(root, ['rev-parse', 'HEAD']);
  const committed = task(root, { action: 'git', sha, execution_refs: [run.ref] });
  assert.equal(committed.task.commits[0].verification, 'local-git-object');
  assert.equal(committed.task.commits[0].pushed, 'not-inferred');
  task(root, { action: 'step', state: 'skipped', decision_text: 'defer device smoke' });
  const end = task(root, { action: 'close', decision_text: 'close with gaps', remaining_work: ['device smoke not run', 'F1'] });
  assert.equal(end.task.lifecycle, 'closed'); assert.equal(end.current_task_id, null);
  const after = taskStatus(root); assert.equal(after.tasks.find(x => x.display_id === 'TASK-004').lifecycle, 'closed');
  assert.equal(after.tasks.find(x => x.display_id === 'TASK-005').steps[0].review_status, 'findings');
  assert.equal(after.projection.display, 'current');
  const baseline = JSON.parse(bytes(root, '.workflow-system/records/legacy/baseline.json'));
  assert.deepEqual(bytes(root, baseline.ref), legacy);
  const replay = task(root, { action: 'adopt', task_id: created.task_id, plan_ref: created.ref, review_ref: draft.ref, decision_text: 'confirm', idempotency_key: 'adopt-app' });
  assert.equal(replay.ref, adopt.ref); assert.equal(replay.task.lifecycle, 'closed');
  // A later recorded old run cannot reopen the task, replace the adoption or turn a finding clean.
  task(root, { action: 'execution', task_id: created.task_id, plan_ref: created.ref, step_id: 'S1', result: 'blocked', historical: true });
  assert.equal(taskStatus(root).current_task, null);
  assert.equal(git(root, ['rev-list', '--count', 'HEAD']), '1');
});

test('fact/view failure split, read-through freshness, display preservation and rebuild do not replay work', t => {
  const root = fixture(t);
  task(root, { action: 'close', task_ref: '004', decision_text: 'stop' });
  const created = task(root, { action: 'prepare', plan: plan('freshness') });
  const cache = path.join(root, '.workflow-system/records/task-view.json'); fs.rmSync(cache); fs.mkdirSync(cache);
  const adopted = task(root, { action: 'adopt', task_id: created.task_id, plan_ref: created.ref, decision_text: 'confirm' });
  assert.equal(adopted.recorded, true); assert.equal(adopted.projection.status, 'failed');
  const current = context(root, {}).current_task; assert.equal(current.task_id, created.task_id); assert.equal(current.plan_status, 'adopted');
  assert.equal(taskStatus(root).projection.cache, 'unreadable');
  const original = bytes(root, adopted.ref); fs.rmdirSync(cache);
  const rebuilt = task(root, { action: 'rebuild' }); assert.equal(rebuilt.rebuild.status, 'updated'); assert.deepEqual(bytes(root, adopted.ref), original);
  const display = path.join(root, 'docs/workflow/CURRENT_TASK.md'); fs.appendFileSync(display, '\nUser note must survive\n');
  const changed = task(root, { action: 'pause', task_id: created.task_id, decision_text: 'pause now' });
  assert.equal(changed.projection.display, 'drift'); assert.match(fs.readFileSync(display, 'utf8'), /User note must survive/);
  const prior = fs.readFileSync(display);
  task(root, { action: 'rebuild', overwrite_display: true });
  const snapshots = fs.readdirSync(path.join(root, '.workflow-system/records/legacy')).filter(n => n.endsWith('.md'));
  assert.ok(snapshots.some(n => bytes(root, `.workflow-system/records/legacy/${n}`).equals(prior)));
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === created.task_id).lifecycle, 'paused');
});

test('existing unnumbered plan/review/adoption can be linked without rerunning or rewriting original facts', t => {
  const root = fixture(t);
  const oldClose = record(root, { kind: 'task-disposition', task_ref: 'TASK-004', body: { state: 'closed', remaining_work: ['stale evidence'] } });
  const oldPlan = record(root, { kind: 'plan', body: plan('Previously confirmed App plan') });
  const oldReview = record(root, { kind: 'review', body: { verdict: 'clean', findings: [] }, links: [{ relation: 'reviews', ref: oldPlan.ref }] });
  const oldDecision = record(root, { kind: 'decision', body: { user_text: 'confirm this revised plan' }, links: [{ relation: 'adopts', ref: oldPlan.ref }, { relation: 'after', ref: oldReview.ref }] });
  const before = [oldClose, oldPlan, oldReview, oldDecision].map(x => bytes(root, x.ref));
  const imported = task(root, { action: 'link', record_ref: oldPlan.ref, event: { action: 'prepare', data: { create: true, plan: plan('Previously confirmed App plan') } } });
  assert.equal(imported.task.display_id, 'TASK-005');
  task(root, { action: 'link', record_ref: oldReview.ref, event: { action: 'review', task_id: imported.task_id, data: { stage: 'draft', plan_ref: oldPlan.ref } } });
  task(root, { action: 'link', record_ref: oldDecision.ref, event: { action: 'adopt', task_id: imported.task_id, data: { plan_ref: oldPlan.ref, activate: true, focus: true, decision_source: oldDecision.ref } } });
  const wrongLink = task(root, { action: 'link', record_ref: 'missing-old-observation', event: { action: 'review' } });
  assert.equal(wrongLink.recorded, true); assert.equal(wrongLink.association, 'unresolved');
  const badSelection = task(root, { action: 'resolve', conflict_id: 'missing', selected_ref: oldPlan.ref });
  assert.equal(badSelection.recorded, true); assert.equal(badSelection.association, 'unresolved');
  const view = taskStatus(root);
  assert.equal(view.current_task.display_id, 'TASK-005'); assert.equal(view.current_task.adopted_plan_ref, oldPlan.ref);
  assert.equal(view.current_task.adopted_by, oldDecision.ref); assert.equal(view.current_task.steps[0].state, 'not-started');
  for (const [i, result] of [oldClose, oldPlan, oldReview, oldDecision].entries()) assert.deepEqual(bytes(root, result.ref), before[i]);
});

test('causal conflicting adoptions need a choice; supplementation/correction preserve wrong originals and decision history', t => {
  const root = fixture(t); task(root, { action: 'close', task_ref: '004' });
  const a = task(root, { action: 'prepare', plan: plan('A') });
  const b = task(root, { action: 'prepare', task_id: a.task_id, plan: plan('B'), base_plan_ref: a.ref });
  const heads = taskStatus(root).heads;
  const first = task(root, { action: 'adopt', task_id: a.task_id, plan_ref: a.ref, parents: heads, activate: true, focus: true, decision_text: 'choose A' });
  task(root, { action: 'adopt', task_id: a.task_id, plan_ref: b.ref, parents: heads, activate: true, focus: true, decision_text: 'choose B' });
  let state = taskStatus(root); const conflict = state.issues.find(x => x.code === 'RECORD_CONFLICT' && x.field.endsWith(':plan'));
  assert.ok(conflict); assert.equal(state.tasks.find(t => t.task_id === a.task_id).plan_status, 'ambiguous');
  task(root, { action: 'defer', issue_ids: [conflict.id], decision_text: 'not now' });
  assert.ok(taskStatus(root).issues.find(x => x.id === conflict.id).deferred_by);
  task(root, { action: 'resolve', conflict_id: conflict.id, selected_ref: first.ref, decision_text: 'A controls, retain B' });
  state = taskStatus(root); assert.equal(state.current_task.adopted_plan_ref, a.ref);
  const wrong = task(root, { action: 'execution', task_id: 'task-unknown', plan_ref: a.ref, step_id: 'S1', result: 'failed' });
  assert.equal(wrong.recorded, true); assert.equal(wrong.association, 'unresolved');
  const raw = bytes(root, wrong.ref);
  task(root, { action: 'correct', record_ref: wrong.ref, event: { task_id: a.task_id }, reason: 'correct mistaken task linkage', decision_text: 'use original failed result' });
  state = taskStatus(root); assert.equal(state.current_task.steps[0].execution.result, 'failed');
  assert.deepEqual(bytes(root, wrong.ref), raw);
  const other = task(root, { action: 'prepare', plan: plan('Other task') });
  const badReview = task(root, { action: 'review', task_id: other.task_id, stage: 'change', execution_ref: wrong.ref, verdict: 'clean' });
  assert.equal(badReview.association, 'unresolved');
  assert.equal(taskStatus(root).current_task.steps[0].review_status, 'not-reviewed');
});

test('installed native CLI allocates stable noncolliding tasks and exact concurrent retries do not duplicate adoption', async t => {
  const root = fixture(t); task(root, { action: 'close', task_ref: '004' });
  const directory = path.join(root, '.workflow-system/runtime/support'); fs.mkdirSync(directory, { recursive: true });
  for (const name of ['assistance.mjs', 'task-management.mjs']) fs.copyFileSync(path.join(RUNTIME, name), path.join(directory, name));
  const call = input => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(directory, 'assistance.mjs'), 'task', '--root', root]);
    let out = '', err = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
    child.on('error', reject); child.on('close', code => code ? reject(new Error(err || out)) : resolve(JSON.parse(out)));
    child.stdin.end(JSON.stringify(input));
  });
  const created = await Promise.all(['one', 'two'].map(k => call({ action: 'prepare', plan: plan(k), idempotency_key: k })));
  assert.notEqual(created[0].task_id, created[1].task_id);
  const view = taskStatus(root); assert.deepEqual(view.tasks.filter(t => !t.task_id.startsWith('legacy-')).map(t => t.display_id).sort(), ['TASK-005', 'TASK-006']);
  const input = { action: 'adopt', task_id: created[0].task_id, plan_ref: created[0].ref, decision_text: 'confirm', idempotency_key: 'same-adoption' };
  const copies = await Promise.all([call(input), call(input)]); assert.equal(copies[0].ref, copies[1].ref);
  const final = taskStatus(root); assert.equal(final.tasks.find(t => t.task_id === created[0].task_id).adopted_plan_ref, created[0].ref);
});
