import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import fsMutable from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { task, taskStatus, record, context, read, queryStatus, queryContext } from '../runtime/vnext/support/assistance.mjs';
import { synchronizeTasks } from '../runtime/vnext/support/task-management.mjs';

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
  assert.equal(disposition.task.next_mode, 'finish');
  const finished = task(root, { action: 'step', state: 'finished', decision_ref: disposition.ref, remaining_work: ['F1 remains'] });
  assert.equal(finished.task.current_step_id, 'S2'); assert.equal(finished.task.steps[0].execution.result, 'failed');
  const skipped = task(root, { action: 'step', state: 'skipped', decision_text: 'defer device smoke' });
  assert.equal(skipped.task.commits.length, 0);
  assert.equal(skipped.task.next_route, 'close-task');
  git(root, ['init', '-q']); git(root, ['config', 'user.name', 'test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(path.join(root, 'app.txt'), 'a real change');
  git(root, ['add', '--', 'app.txt', '.workflow-system/records', 'docs/workflow']);
  git(root, ['commit', '-qm', 'real test commit']);
  const sha = git(root, ['rev-parse', 'HEAD']);
  const afterCommit = taskStatus(root).current_task;
  assert.equal(afterCommit.next_route, 'close-task');
  assert.equal(afterCommit.commits.length, 0);
  assert.equal(git(root, ['status', '--porcelain']), '');
  // A persistent Git association is a separate, explicitly requested management write.
  const committed = task(root, { action: 'git', sha, execution_refs: [run.ref] });
  assert.equal(committed.task.commits[0].verification, 'local-git-object');
  assert.equal(committed.task.commits[0].pushed, 'not-inferred');
  const closeRequest = { action: 'close', decision_text: 'close with gaps', remaining_work: ['device smoke not run', 'F1'], idempotency_key: 'close-app' };
  const end = task(root, closeRequest);
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
  const closeBytes = bytes(root, end.ref);
  const resumed = task(root, { action: 'resume', task_id: created.task_id, decision_text: 'resume with gaps retained' });
  const eventsBeforeReplay = fs.readdirSync(path.join(root, '.workflow-system/records/events')).sort();
  const closeReplay = task(root, closeRequest);
  assert.equal(closeReplay.ref, end.ref);
  assert.equal(closeReplay.recorded, true);
  assert.equal(closeReplay.status, 'applied');
  assert.equal(closeReplay.association, 'applied');
  assert.equal(closeReplay.issues.some(i => i.code === 'ASSOCIATION_NOT_APPLIED'), false);
  assert.equal(closeReplay.task.lifecycle, 'active');
  assert.equal(closeReplay.task.lifecycle_ref, resumed.ref);
  assert.ok(closeReplay.task.dispositions.some(d => d.ref === end.ref && d.action === 'close'));
  assert.deepEqual(bytes(root, end.ref), closeBytes);
  assert.deepEqual(fs.readdirSync(path.join(root, '.workflow-system/records/events')).sort(), eventsBeforeReplay);
  assert.equal(taskStatus(root).current_task.lifecycle_ref, resumed.ref);
});

test('a clean change review recommends finishing the step before task closure', t => {
  const root = fixture(t);
  task(root, { action: 'close', task_ref: 'TASK-004', decision_text: 'close legacy work' });
  const prepared = task(root, { action: 'prepare', plan: { ...plan('reviewed work'), steps: [{ id: 'S1', title: 'finish reviewed change' }] } });
  task(root, { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref, decision_text: 'confirm plan' });
  const run = task(root, { action: 'execution', result: 'implemented', source_revision: 'reviewed-version' });
  task(root, { action: 'review', stage: 'change', execution_ref: run.ref, verdict: 'clean', findings: [] });
  const pending = taskStatus(root).current_task;
  assert.equal(pending.steps[0].state, 'executed');
  assert.equal(pending.next_route, 'execute-step');
  assert.equal(pending.next_mode, 'finish');
  assert.equal(pending.next_action, 'finish-step');
  assert.equal(pending.steps[0].disposition_ref, null);
  const finished = task(root, { action: 'step', state: 'finished', review_ref: pending.steps[0].review_ref });
  assert.equal(finished.task.steps[0].state, 'finished');
  assert.equal(finished.task.next_route, 'close-task');
  assert.equal(finished.task.next_action, null);
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
  const changed = task(root, { action: 'pause', task_id: created.task_id, decision_text: 'pause' });
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
  for (const name of ['assistance.mjs', 'task-management.mjs', 'record-storage.mjs']) fs.copyFileSync(path.join(RUNTIME, name), path.join(directory, name));
  const call = input => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(directory, 'assistance.mjs'), 'task', '--root', root]);
    let out = '', err = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
    child.on('error', reject); child.on('close', code => code ? reject(new Error(err || out)) : resolve(JSON.parse(out)));
    child.stdin.end(JSON.stringify(input));
  });
  const abandonedLock = path.join(root, '.workflow-system/records/task-view.lock');
  fs.writeFileSync(abandonedLock, '');
  const oldLockTime = new Date(Date.now() - 60_000);
  fs.utimesSync(abandonedLock, oldLockTime, oldLockTime);
  const created = await Promise.all(['one', 'two'].map(k => call({ action: 'prepare', plan: plan(k), idempotency_key: k })));
  assert.notEqual(created[0].task_id, created[1].task_id);
  const view = taskStatus(root); assert.deepEqual(view.tasks.filter(t => !t.task_id.startsWith('legacy-')).map(t => t.display_id).sort(), ['TASK-005', 'TASK-006']);
  const input = { action: 'adopt', task_id: created[0].task_id, plan_ref: created[0].ref, decision_text: 'confirm', idempotency_key: 'same-adoption' };
  const copies = await Promise.all([call(input), call(input)]); assert.equal(copies[0].ref, copies[1].ref);
  const final = taskStatus(root); assert.equal(final.tasks.find(t => t.task_id === created[0].task_id).adopted_plan_ref, created[0].ref);
  assert.equal((await call({ action: 'rebuild' })).rebuild.status, 'updated');
  assert.equal(fs.readFileSync(abandonedLock, 'utf8'), '');
});

test('correcting a resolved adoption uses the new choice and retains the original decision', t => {
  const root = fixture(t);
  task(root, { action: 'close', task_ref: '004' });
  const a = task(root, { action: 'prepare', plan: plan('A') });
  const b = task(root, { action: 'prepare', task_id: a.task_id, plan: plan('B') });
  const heads = taskStatus(root).heads;
  const choiceA = task(root, { action: 'adopt', task_id: a.task_id, plan_ref: a.ref, parents: heads, decision_text: 'A' });
  const choiceB = task(root, { action: 'adopt', task_id: a.task_id, plan_ref: b.ref, parents: heads, decision_text: 'B' });
  const conflict = taskStatus(root).issues.find(i => i.code === 'RECORD_CONFLICT' && i.field.endsWith(':plan'));
  assert.ok(conflict);
  const selected = task(root, { action: 'resolve', conflict_id: conflict.id, selected_ref: choiceA.ref, decision_text: 'Choose A' });
  const original = bytes(root, selected.ref);
  const corrected = task(root, { action: 'correct', record_ref: selected.ref, event: { data: { selected_ref: choiceB.ref } }, decision_text: 'Choose B instead' });
  assert.equal(corrected.association, 'applied');
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === a.task_id).adopted_plan_ref, b.ref);
  assert.equal(task(root, { action: 'rebuild' }).rebuild.status, 'updated');
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === a.task_id).adopted_plan_ref, b.ref);
  assert.equal(bytes(root, corrected.ref).length > 0, true);
  assert.deepEqual(bytes(root, selected.ref), original);
});

test('abandoned empty view lock is reclaimed while a fresh lock remains busy', t => {
  const root = fixture(t);
  const created = task(root, { action: 'prepare', plan: plan('lock') });
  const lock = path.join(root, '.workflow-system/records/task-view.lock');
  fs.writeFileSync(lock, '');
  const fresh = task(root, { action: 'close', task_id: created.task_id, decision_text: 'done' });
  assert.equal(fresh.recorded, true);
  assert.equal(fresh.projection.code, 'VIEW_BUSY');
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === created.task_id).lifecycle, 'closed');
  const old = new Date(Date.now() - 60_000); fs.utimesSync(lock, old, old);
  assert.equal(task(root, { action: 'rebuild' }).rebuild.status, 'updated');
  assert.equal(fs.readFileSync(lock, 'utf8'), '');
  assert.equal(task(root, { action: 'rebuild' }).rebuild.status, 'updated');
  fs.writeFileSync(lock, '{broken'); fs.utimesSync(lock, old, old);
  assert.equal(task(root, { action: 'rebuild', overwrite_display: true }).rebuild.status, 'updated');
  assert.equal(fs.readFileSync(lock, 'utf8'), '{broken');
  const live = JSON.stringify({ host: os.hostname(), pid: process.pid, id: 'live' });
  fs.writeFileSync(lock, live); fs.utimesSync(lock, old, old);
  assert.equal(task(root, { action: 'rebuild' }).rebuild.code, 'VIEW_BUSY');
  assert.equal(fs.readFileSync(lock, 'utf8'), live);
});

test('publication detects an edit made after validation and preserves it', t => {
  const root = fixture(t);
  const created = task(root, { action: 'prepare', plan: plan('display race') });
  const target = path.join(root, 'docs/workflow/CURRENT_TASK.md');
  const before = fs.readFileSync(target, 'utf8');
  const note = '\nUSER EDIT DURING PUBLICATION\n';
  let injected = false;
  const io = {
    local: (r, ref) => path.join(r, ref),
    workflowHome: () => ({ home: 'docs/workflow', issues: [] }),
    publish: (r, ref, data) => {
      const file = path.join(r, ref); fs.mkdirSync(path.dirname(file), { recursive: true });
      let written = true;
      try { fs.writeFileSync(file, data, { flag: 'wx' }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; written = false; }
      if (ref.startsWith('.workflow-system/records/legacy/display-') && !injected) {
        fs.appendFileSync(target, note); injected = true;
      }
      return written;
    },
  };
  const lock = path.join(root, '.workflow-system/records/task-view.lock');
  fs.writeFileSync(lock, JSON.stringify({ host: os.hostname(), pid: process.pid, id: 'held' }));
  task(root, { action: 'pause', task_id: created.task_id, decision_text: 'pause' });
  fs.unlinkSync(lock);
  const publication = synchronizeTasks(root, {}, io);
  assert.equal(injected, true);
  assert.equal(publication.status, 'partial');
  assert.equal(publication.display, 'drift');
  assert.equal(fs.readFileSync(target, 'utf8'), before + note);
  assert.equal(bytes(root, publication.preserved_display_ref).toString(), before + note);
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === created.task_id).lifecycle, 'paused');
});

test('exclusive display installation protects late path saves and retains delayed writes through open handles', t => {
  for (const mode of ['path-save', 'after-install', 'open-handle']) {
    const root = fixture(t);
    const created = task(root, { action: 'prepare', plan: plan(mode) });
    const target = path.join(root, 'docs/workflow/CURRENT_TASK.md');
    const before = fs.readFileSync(target, 'utf8'), edited = before + '\nLate user edit\n';
    const handle = mode === 'open-handle' ? fs.openSync(target, 'a') : null;
    const lock = path.join(root, '.workflow-system/records/task-view.lock');
    fs.writeFileSync(lock, JSON.stringify({ host: os.hostname(), pid: process.pid, id: 'held' }));
    task(root, { action: 'pause', task_id: created.task_id });
    fs.unlinkSync(lock);
    const originalLink = fsMutable.linkSync;
    let injected = false;
    const mocked = t.mock.method(fsMutable, 'linkSync', (source, destination) => {
      if (destination === target && source.endsWith('.tmp') && !injected) {
        injected = true;
        if (mode === 'after-install') {
          originalLink(source, destination);
          fs.writeFileSync(target, edited);
          return;
        }
        if (handle !== null) fs.writeSync(handle, '\nLate user edit\n');
        else fs.writeFileSync(target, edited);
      }
      return originalLink(source, destination);
    });
    syncBuiltinESMExports();
    try {
      const rebuilt = task(root, { action: 'rebuild', overwrite_display: true }).rebuild;
      assert.equal(injected, true);
      assert.equal(rebuilt.status, 'partial');
      assert.equal(rebuilt.display, 'drift');
      if (handle === null) assert.equal(fs.readFileSync(target, 'utf8'), edited);
      else {
        assert.equal(bytes(root, rebuilt.preserved_display_ref).toString(), edited);
        fs.writeSync(handle, 'Still editing after publication\n');
        assert.match(bytes(root, rebuilt.preserved_display_ref).toString(), /Still editing after publication/);
      }
      assert.equal(taskStatus(root).tasks.find(x => x.task_id === created.task_id).lifecycle, 'paused');
    } finally {
      mocked.mock.restore(); syncBuiltinESMExports();
      if (handle !== null) fs.closeSync(handle);
    }
  }
});

test('cyclic correction and decisions on ineffective reviews report unresolved association', t => {
  const root = fixture(t);
  task(root, { action: 'close', task_ref: '004' });
  const created = task(root, { action: 'prepare', plan: plan('associations') });
  task(root, { action: 'adopt', task_id: created.task_id, plan_ref: created.ref, decision_text: 'adopt' });
  const run = task(root, { action: 'execution', result: 'failed' });
  const cyclic = task(root, { action: 'correct', record_ref: run.ref, event: { parents: [run.ref] } });
  assert.equal(cyclic.recorded, true); assert.equal(cyclic.association, 'unresolved');
  assert.ok(cyclic.issues.some(i => i.code === 'ASSOCIATION_CYCLE'));
  assert.equal(taskStatus(root).current_task.steps[0].execution_ref, null);
  const review = task(root, { action: 'review', stage: 'change', execution_ref: 'missing', verdict: 'clean' });
  const decision = task(root, { action: 'review-decision', review_ref: review.ref, choice: 'accept' });
  assert.equal(review.association, 'unresolved'); assert.equal(decision.association, 'unresolved');
  assert.equal(taskStatus(root).current_task.review_decisions.length, 0);
});

// Synthetic immutable journals exercise causal interpretation without repeatedly publishing views.
const causalRef = id => `.workflow-system/records/events/graph-${String(id).padStart(5, '0')}.json`;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function causalFixture(t) {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), '<!-- vnext-task-view/v1 -->\n');
  fs.mkdirSync(path.join(root, '.workflow-system/records/events'), { recursive: true });
  return root;
}
function causalFact(root, id, action, parents, data = {}) {
  const payload = { kind: 'task-event', task_event: { version: 1, action, task_id: 'task-causal', parents, data } };
  const row = { schema_version: 1, kind: 'workflow-observation', recorded_at: '2000-01-01T00:00:00.000Z',
    payload_sha256: createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex'), payload };
  const ref = causalRef(id); fs.writeFileSync(path.join(root, ref), JSON.stringify(row) + '\n'); return ref;
}
const causalPlan = { create: true, display_id: 'TASK-001', plan: { title: 'Causal fixture', steps: [{ id: 'S1' }] } };
function reachable(graph, ref) {
  const found = new Set(), pending = [...(graph.get(ref) ?? [])];
  while (pending.length) {
    const parent = pending.pop();
    if (!found.has(parent)) { found.add(parent); pending.push(...(graph.get(parent) ?? [])); }
  }
  return found;
}
function maximalRefs(graph, refs) {
  const superseded = new Set();
  for (const ref of refs) for (const parent of reachable(graph, ref)) if (parent !== ref) superseded.add(parent);
  return refs.filter(ref => !superseded.has(ref));
}

test('causal heads and cycle diagnostics match explicit reachability on seeded DAGs and cyclic graphs', t => {
  let seed = 913;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let sample = 0; sample < 50; sample++) {
    const root = causalFixture(t), graph = new Map(), actions = new Map();
    causalFact(root, 0, 'prepare', [], causalPlan); graph.set(causalRef(0), []);
    for (let id = 1; id <= 12; id++) {
      const parents = Array.from({ length: random(4) }, () => random(5)
        ? causalRef(sample % 2 ? random(id) : random(13)) : 'missing-parent');
      const action = id % 2 ? 'resume' : 'pause';
      const ref = causalFact(root, id, action, parents);
      graph.set(ref, parents); actions.set(ref, action);
    }
    const cycles = [...graph.keys()].filter(ref => reachable(graph, ref).has(ref));
    const valid = new Map([...graph].filter(([ref]) => !cycles.includes(ref)));
    const view = taskStatus(root), task = view.tasks.find(item => item.task_id === 'task-causal');
    assert.deepEqual(view.issues.filter(i => i.code === 'ASSOCIATION_CYCLE').map(i => i.ref), cycles);
    assert.deepEqual(view.heads, maximalRefs(valid, [...valid.keys()]));
    const heads = maximalRefs(valid, [...valid.keys()].filter(ref => actions.has(ref)));
    const states = new Set(heads.map(ref => actions.get(ref) === 'resume' ? 'active' : 'paused'));
    assert.equal(task.lifecycle, states.size > 1 ? 'ambiguous' : states.size ? [...states][0] : 'draft');
    const conflicts = view.issues.filter(i => i.code === 'RECORD_CONFLICT' && i.field.endsWith(':lifecycle'));
    assert.equal(conflicts.length, states.size > 1 ? 1 : 0);
    if (conflicts.length) assert.deepEqual(conflicts[0].candidates, heads.slice().sort());
  }
});

test('a cyclic amendment cannot supersede itself; distinct cyclic alternatives remain mutually superseded', t => {
  const single = causalFixture(t);
  causalFact(single, 0, 'prepare', [], causalPlan);
  causalFact(single, 1, 'pause', [causalRef(2)]);
  causalFact(single, 2, 'correct', [causalRef(1)], { record_ref: causalRef(1), event: { data: { note: 'retained' } } });
  assert.deepEqual(taskStatus(single).issues.filter(i => i.code === 'ASSOCIATION_CYCLE').map(i => i.ref), [causalRef(1), causalRef(2)]);
  const multiple = causalFixture(t);
  causalFact(multiple, 0, 'prepare', [], causalPlan);
  causalFact(multiple, 1, 'pause', []);
  causalFact(multiple, 2, 'correct', [causalRef(3)], { record_ref: causalRef(1), event: { data: { note: 'A' } } });
  causalFact(multiple, 3, 'correct', [causalRef(2)], { record_ref: causalRef(1), event: { data: { note: 'B' } } });
  causalFact(multiple, 4, 'correct', [], { record_ref: causalRef(1), event: { data: { note: 'outside cycle' } } });
  const view = taskStatus(multiple), paused = view.tasks[0];
  assert.equal(paused.lifecycle, 'paused');
  assert.equal(paused.dispositions[0].note, 'outside cycle');
  assert.deepEqual(view.issues.filter(i => i.code === 'ASSOCIATION_CYCLE').map(i => i.ref), [causalRef(2), causalRef(3)]);
  assert.equal(view.issues.some(i => i.code === 'RECORD_CONFLICT'), false);
});

test('conflicting interpretations preserve the baseline lazy-observation boundary without ancestor sets', t => {
  const root = causalFixture(t);
  causalFact(root, 0, 'prepare', [], causalPlan);
  causalFact(root, 1, 'pause', [causalRef(2)]);
  causalFact(root, 2, 'resume', [causalRef(3)]);
  causalFact(root, 3, 'correct', [causalRef(1)], { record_ref: causalRef(1), event: { data: { note: 'A' } } });
  causalFact(root, 4, 'correct', [], { record_ref: causalRef(1), event: { data: { note: 'B' } } });
  const originals = Array.from({ length: 5 }, (_, i) => bytes(root, causalRef(i)));
  const view = taskStatus(root);
  assert.deepEqual(view.issues.filter(i => i.code === 'RECORD_CONFLICT').map(i => i.candidates), [[causalRef(3), causalRef(4)]]);
  // c510760's conflicting-interpretation deletion does not clear previously observed
  // roots. Preserve that diagnostic boundary; changing it is a separate semantic fix.
  assert.deepEqual(view.issues.filter(i => i.code === 'ASSOCIATION_CYCLE').map(i => i.ref), [causalRef(2)]);
  assert.equal(view.tasks[0].lifecycle, 'draft');
  for (let i = 0; i < originals.length; i++) assert.deepEqual(bytes(root, causalRef(i)), originals[i]);
});

test('a later parent correction restores a failed execution without rewriting original facts', t => {
  const root = fixture(t); task(root, { action: 'close', task_ref: '004' });
  const prepared = task(root, { action: 'prepare', plan: plan('parent replacement') });
  const adopted = task(root, { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref });
  const run = task(root, { action: 'execution', result: 'failed' });
  const original = bytes(root, run.ref);
  const cyclic = task(root, { action: 'correct', record_ref: run.ref, event: { parents: [run.ref] } });
  assert.ok(taskStatus(root).issues.some(i => i.code === 'ASSOCIATION_CYCLE' && i.ref === run.ref));
  const corrected = task(root, { action: 'correct', record_ref: run.ref, parents: [cyclic.ref], event: { parents: [adopted.ref] } });
  const view = taskStatus(root);
  assert.equal(corrected.association, 'applied');
  assert.equal(view.issues.some(i => i.code === 'ASSOCIATION_CYCLE'), false);
  assert.equal(view.current_task.steps[0].execution_ref, run.ref);
  assert.equal(view.current_task.steps[0].execution.result, 'failed');
  assert.equal(view.current_task.steps[0].execution.interpretation_ref, corrected.ref);
  assert.deepEqual(bytes(root, run.ref), original);
});

test('a long journal is rebuilt under a bounded heap without truncating historical decisions', t => {
  const root = causalFixture(t), count = 6000;
  causalFact(root, 0, 'prepare', [], causalPlan);
  for (let id = 1; id < count; id++) causalFact(root, id, id % 2 ? 'resume' : 'pause', [causalRef(id - 1)]);
  const service = new URL('../runtime/vnext/support/assistance.mjs', import.meta.url).href;
  const script = `import { taskStatus } from ${JSON.stringify(service)};
    const view = taskStatus(process.argv[1]);
    console.log(JSON.stringify({count:view.records_scanned, heads:view.heads,
      dispositions:view.tasks[0].dispositions.length, lifecycle:view.tasks[0].lifecycle, issues:view.issues}));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script, root],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 }));
  assert.equal(result.count, count);
  assert.equal(result.dispositions, count - 1);
  assert.equal(result.lifecycle, 'active');
  assert.deepEqual(result.heads, [causalRef(count - 1)]);
  assert.deepEqual(result.issues, []);
});

function derivedFixture(t, returnPolicy = 'auto') {
  const root = fixture(t);
  task(root, { action: 'close', task_ref: '004' });
  const parent = task(root, { action: 'prepare', plan: plan('Original business task') });
  task(root, { action: 'adopt', task_id: parent.task_id, plan_ref: parent.ref });
  task(root, { action: 'step', state: 'finished' });
  const run = task(root, { action: 'execution', result: 'partial', source_revision: 'parent-before-handoff' });
  task(root, { action: 'review', stage: 'change', execution_ref: run.ref, verdict: 'findings',
    findings: [{ id: 'F-parent', text: 'Integration still needs a prerequisite' }], provenance: 'self-review' });
  const before = structuredClone(taskStatus(root).current_task);
  const child = task(root, { action: 'prepare', plan: plan('Shared contract prerequisite'),
    origin: { parent_task_ref: parent.task.display_id, reason: 'S2 needs a shared contract repair',
      handoff: { child_scope: ['shared contract'], parent_remaining_scope: ['integration', 'device validation'] },
      return_policy: returnPolicy, resume_context: 'Continue S2 integration; retain the finding and device checks.' } });
  task(root, { action: 'adopt', task_id: child.task_id, plan_ref: child.ref });
  assert.equal(taskStatus(root).current_task_id, parent.task_id);
  assert.equal(child.association, 'applied');
  return { root, parent, child, before, run };
}
const satisfied = { state: 'satisfied', summary: 'Shared contract repaired and isolated saving verified', evidence_refs: ['logs/prerequisite.md'] };

test('derived task preserves its parent and returns to the exact unfinished work without finishing or recertifying it', t => {
  const { root, parent, child, before, run } = derivedFixture(t);
  const original = bytes(root, run.ref);
  assert.equal(child.task.origin.parent_task_id, parent.task_id);
  assert.equal(child.task.origin.parent_plan_ref, parent.ref);
  assert.equal(child.task.origin.parent_step_id, 'S2');
  task(root, { action: 'focus', task_id: child.task_id });
  task(root, { action: 'execution', result: 'prerequisite implemented' });
  task(root, { action: 'step', state: 'finished' });
  task(root, { action: 'step', state: 'finished' });
  const request = { action: 'close', task_id: child.task_id, dependency: satisfied, idempotency_key: 'close-derived-success' };
  const closed = task(root, request);
  assert.equal(closed.association, 'applied'); assert.equal(closed.projection.status, 'updated');
  assert.equal(closed.return_result.status, 'returned');
  assert.equal(closed.next_task_id, parent.task_id); assert.equal(closed.next_step_id, 'S2');
  assert.equal(closed.next_route, 'execute-step'); assert.equal(closed.next_action, 'continue-step');
  const resumed = taskStatus(root).current_task;
  assert.equal(resumed.task_id, parent.task_id); assert.equal(resumed.lifecycle, 'active');
  assert.deepEqual(resumed.steps, before.steps); assert.deepEqual(bytes(root, run.ref), original);
  assert.equal(resumed.continuation.status, 'ready');
  assert.equal(resumed.steps[1].review_status, 'findings'); assert.equal(resumed.steps[1].state, 'executed');
  const queryBefore = fs.readdirSync(path.join(root, '.workflow-system/records/events'));
  const summary = queryStatus(root), selectedChild = queryStatus(root, { task_ref: child.task_id });
  assert.equal(summary.next_task_id, parent.task_id); assert.equal(summary.next_step_id, 'S2');
  assert.equal(selectedChild.selection.task_id, child.task_id); assert.equal(selectedChild.next_task_id, parent.task_id);
  assert.equal(selectedChild.tasks[0].return_result.status, 'returned');
  assert.equal(queryContext(root).management.next_task_id, parent.task_id);
  assert.deepEqual(fs.readdirSync(path.join(root, '.workflow-system/records/events')), queryBefore);
  task(root, { action: 'execution', result: 'continued integration', source_revision: 'parent-after-return' });
  const continued = taskStatus(root).current_task;
  assert.equal(continued.continuation.status, 'work-changed'); assert.equal(continued.next_route, 'review-change');
  const eventCount = fs.readdirSync(path.join(root, '.workflow-system/records/events')).length;
  assert.equal(task(root, request).ref, closed.ref);
  assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, eventCount);
  fs.unlinkSync(path.join(root, '.workflow-system/records/task-view.json'));
  task(root, { action: 'rebuild' });
  assert.equal(taskStatus(root).current_task.steps[1].execution.result, 'continued integration');
  assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, eventCount);
  task(root, { action: 'dependency', task_id: child.task_id, dependency: { state: 'unresolved', summary: 'A later regression reopened the prerequisite' } });
  const reopened = taskStatus(root).current_task;
  assert.equal(reopened.task_id, parent.task_id); assert.equal(reopened.continuation.status, 'dependency-unresolved');
  assert.deepEqual(reopened.waiting_on_task_ids, [child.task_id]);
});

test('closure with gaps keeps the dependency unresolved; a later explicit outcome can return without replaying work', t => {
  const { root, parent, child, before } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  const closed = task(root, { action: 'close', task_id: child.task_id, remaining_work: ['repair not complete'] });
  assert.equal(closed.return_result.status, 'dependency-unresolved'); assert.equal(closed.current_task_id, null);
  assert.equal(closed.task.dependency.state, 'unresolved');
  const outcome = task(root, { action: 'dependency', task_id: child.task_id, dependency: satisfied });
  assert.equal(outcome.association, 'applied'); assert.equal(outcome.return_result.status, 'returned');
  assert.equal(taskStatus(root).current_task_id, parent.task_id);
  assert.deepEqual(taskStatus(root).current_task.steps, before.steps);
  assert.deepEqual(taskStatus(root).tasks.find(x => x.task_id === child.task_id).dispositions[0].remaining_work, ['repair not complete']);
});

test('an outcome before closure waits; manual policy and incomplete or cancelled outcomes never imply successful return', t => {
  const { root, parent, child } = derivedFixture(t, 'manual');
  task(root, { action: 'focus', task_id: child.task_id });
  const outcome = task(root, { action: 'dependency', task_id: child.task_id, dependency: satisfied });
  assert.equal(outcome.return_result.status, 'awaiting-close'); assert.equal(outcome.current_task_id, child.task_id);
  const closed = task(root, { action: 'close', task_id: child.task_id });
  assert.equal(closed.return_result.status, 'manual'); assert.equal(closed.current_task_id, null);
  task(root, { action: 'focus', task_id: parent.task_id, return_from: child.task_id });
  assert.equal(taskStatus(root).current_task.current_step_id, 'S2');
  assert.equal(taskStatus(root).current_task.continuation.from_task_id, child.task_id);
  assert.equal(taskStatus(root).current_task.next_action, 'continue-step');
  const invalid = task(root, { action: 'dependency', task_id: child.task_id, dependency: { state: 'satisfied' } });
  assert.equal(invalid.recorded, true); assert.equal(invalid.association, 'unresolved');
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === child.task_id).dependency.state, 'satisfied');
  const cancelled = task(root, { action: 'dependency', task_id: child.task_id, dependency: { state: 'cancelled', summary: 'Stopped this prerequisite' } });
  assert.equal(cancelled.task.dependency.state, 'cancelled'); assert.equal(cancelled.return_result.status, 'dependency-unresolved');
});

test('adopting with focus captures entry and a previously recorded satisfied outcome returns on close', t => {
  const { root, parent, child, before } = derivedFixture(t);
  task(root, { action: 'adopt', task_id: child.task_id, plan_ref: child.ref, focus: true });
  assert.equal(taskStatus(root).current_task_id, child.task_id);
  const outcome = task(root, { action: 'dependency', task_id: child.task_id, dependency: satisfied });
  assert.equal(outcome.return_result.status, 'awaiting-close');
  const closed = task(root, { action: 'close', task_id: child.task_id });
  assert.equal(closed.return_result.status, 'returned'); assert.equal(closed.next_task_id, parent.task_id);
  assert.deepEqual(taskStatus(root).current_task.steps, before.steps);
});

test('manual return retains unresolved dependency and changed-work context without forging a ready continuation', t => {
  const { root, parent, child, before } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  task(root, { action: 'close', task_id: child.task_id, remaining_work: ['prerequisite not repaired'] });
  const returned = task(root, { action: 'focus', task_id: parent.task_id, return_from: child.task.display_id });
  assert.equal(returned.association, 'applied');
  const current = taskStatus(root).current_task;
  assert.equal(current.continuation.status, 'dependency-unresolved');
  assert.deepEqual(current.waiting_on_task_ids, [child.task_id]); assert.deepEqual(current.steps, before.steps);
  const unknown = task(root, { action: 'focus', task_id: parent.task_id, return_from: 'unknown-child' });
  assert.equal(unknown.recorded, true); assert.equal(unknown.association, 'unresolved');
  assert.equal(taskStatus(root).current_task_id, parent.task_id);
});

test('linking an existing task origin preserves its identity and original bytes without inventing a past entry', t => {
  const { root, parent, child } = derivedFixture(t);
  task(root, { action: 'close', task_id: child.task_id, dependency: { state: 'cancelled' } });
  const existing = task(root, { action: 'prepare', plan: plan('Already prepared prerequisite') });
  task(root, { action: 'adopt', task_id: existing.task_id, plan_ref: existing.ref, focus: true });
  const original = bytes(root, existing.ref);
  const linked = task(root, { action: 'link', record_ref: existing.ref,
    event: { action: 'prepare', task_id: existing.task_id, data: { origin: { parent_task_id: parent.task_id,
      parent_plan_ref: parent.ref, parent_step_id: 'S2', return_policy: 'auto', resume_context: 'Continue retained integration' } } } });
  assert.equal(linked.association, 'applied'); assert.equal(linked.task.task_id, existing.task_id);
  assert.equal(linked.task.return_entry, null); assert.deepEqual(bytes(root, existing.ref), original);
  task(root, { action: 'focus', task_id: parent.task_id });
  task(root, { action: 'focus', task_id: existing.task_id });
  const closed = task(root, { action: 'close', task_id: existing.task_id, dependency: satisfied });
  assert.equal(closed.return_result.status, 'returned'); assert.equal(closed.current_task_id, parent.task_id);
});

test('automatic return respects new focus, parent lifecycle, revised plans, finished steps and new parent work', async t => {
  const scenarios = [
    ['other focus', ({ root }) => {
      const other = task(root, { action: 'prepare', plan: plan('C') });
      task(root, { action: 'adopt', task_id: other.task_id, plan_ref: other.ref, focus: true });
      return other.task_id;
    }, 'focus-changed'],
    ['paused parent', ({ root, parent }) => { task(root, { action: 'pause', task_id: parent.task_id }); }, 'parent-changed'],
    ['closed parent', ({ root, parent }) => { task(root, { action: 'close', task_id: parent.task_id }); }, 'parent-changed'],
    ['revised plan', ({ root, parent }) => {
      const revision = task(root, { action: 'prepare', task_id: parent.task_id, plan: plan('A revised') });
      task(root, { action: 'adopt', task_id: parent.task_id, plan_ref: revision.ref, focus: false });
    }, 'parent-changed'],
    ['finished parent step', ({ root, parent }) => { task(root, { action: 'step', task_id: parent.task_id, state: 'finished' }); }, 'parent-changed'],
    ['new parent execution', ({ root, parent }) => { task(root, { action: 'execution', task_id: parent.task_id, result: 'other work while B runs' }); }, 'parent-changed'],
  ];
  for (const [name, change, status] of scenarios) await t.test(name, t => {
    const setup = derivedFixture(t);
    task(setup.root, { action: 'focus', task_id: setup.child.task_id });
    const expectedFocus = change(setup) ?? null;
    const closed = task(setup.root, { action: 'close', task_id: setup.child.task_id, dependency: satisfied });
    assert.equal(closed.return_result.status, status); assert.equal(closed.current_task_id, expectedFocus);
  });
});

test('entry captures the actual parent work after preparation; entering from another task does not invent a return', t => {
  const { root, parent, child } = derivedFixture(t);
  task(root, { action: 'execution', task_id: parent.task_id, result: 'handoff report saved after preparing B' });
  const actual = structuredClone(taskStatus(root).current_task.steps);
  task(root, { action: 'focus', task_id: child.task_id });
  task(root, { action: 'focus', task_id: child.task_id });
  const closed = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied });
  assert.equal(closed.return_result.status, 'returned'); assert.deepEqual(taskStatus(root).current_task.steps, actual);
  task(root, { action: 'resume', task_id: child.task_id, focus: false });
  const other = task(root, { action: 'prepare', plan: plan('Other work') });
  task(root, { action: 'adopt', task_id: other.task_id, plan_ref: other.ref, focus: true });
  task(root, { action: 'focus', task_id: child.task_id });
  const stopped = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied });
  assert.equal(stopped.return_result.status, 'no-return-checkpoint'); assert.equal(stopped.current_task_id, null);
});

test('unsupported nested or multiple derivations retain proposals and report the missing association', t => {
  const { root, parent, child } = derivedFixture(t);
  const another = task(root, { action: 'prepare', plan: plan('Second prerequisite'), origin: { parent_task_id: parent.task_id } });
  assert.equal(another.recorded, true); assert.equal(another.association, 'unresolved'); assert.equal(another.task.origin, null);
  task(root, { action: 'focus', task_id: child.task_id });
  const nested = task(root, { action: 'prepare', plan: plan('Nested prerequisite'), origin: { parent_task_id: child.task_id } });
  assert.equal(nested.recorded, true); assert.equal(nested.association, 'unresolved'); assert.equal(nested.task.origin, null);
  const badParent = task(root, { action: 'prepare', plan: plan('Unknown origin'), origin: { parent_task_id: 'missing-task' } });
  assert.equal(badParent.association, 'unresolved');
  assert.equal(taskStatus(root).current_task_id, child.task_id);
  const saved = JSON.parse(bytes(root, nested.ref));
  assert.equal(saved.payload.request.origin.parent_task_id, child.task_id);
});

test('saved closure and return survive publication failure and idempotent recovery without a second operation', t => {
  const { root, parent, child } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  const cache = path.join(root, '.workflow-system/records/task-view.json');
  fs.unlinkSync(cache); fs.mkdirSync(cache);
  const request = { action: 'close', task_id: child.task_id, dependency: satisfied, idempotency_key: 'return-publication-failure' };
  const closed = task(root, request);
  assert.equal(closed.recorded, true); assert.equal(closed.association, 'not-evaluated'); assert.equal(closed.projection.status, 'failed');
  assert.equal(taskStatus(root).current_task_id, parent.task_id);
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === child.task_id).return_result.status, 'returned');
  const count = fs.readdirSync(path.join(root, '.workflow-system/records/events')).length;
  fs.rmdirSync(cache);
  assert.equal(task(root, request).ref, closed.ref);
  assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, count);
  assert.equal(taskStatus(root).projection.cache, 'current');
});

test('multiple linked prerequisites are visible and require manual return rather than implicit scheduling', t => {
  const { root, parent, child } = derivedFixture(t);
  const other = task(root, { action: 'prepare', plan: plan('Another independently prepared prerequisite') });
  task(root, { action: 'link', record_ref: other.ref, event: { action: 'prepare', task_id: other.task_id,
    data: { origin: { parent_task_id: parent.task_id, parent_plan_ref: parent.ref, parent_step_id: 'S2', return_policy: 'manual' } } } });
  task(root, { action: 'focus', task_id: child.task_id });
  const closed = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied });
  assert.equal(closed.return_result.status, 'multiple-dependencies'); assert.equal(closed.current_task_id, null);
  const actualParent = taskStatus(root).tasks.find(x => x.task_id === parent.task_id);
  assert.deepEqual(actualParent.waiting_on_task_ids, [other.task_id]);
  task(root, { action: 'focus', task_id: parent.task_id, return_from: child.task_id });
  const returned = taskStatus(root);
  assert.equal(returned.current_task_id, parent.task_id);
  assert.equal(returned.current_task.continuation.status, 'dependency-unresolved');
  assert.notEqual(returned.next_action, 'continue-step');
  assert.deepEqual(returned.current_task.waiting_on_task_ids, [other.task_id]);
  task(root, { action: 'close', task_id: other.task_id, dependency: satisfied });
  const prerequisitesDone = taskStatus(root);
  assert.equal(prerequisitesDone.current_task_id, parent.task_id);
  assert.equal(prerequisitesDone.current_task.continuation.status, 'ready');
  assert.deepEqual(prerequisitesDone.current_task.waiting_on_task_ids, []);
});

test('installed native CLI closes and returns across processes without kernel dependencies or duplicate facts', t => {
  const { root, parent, child } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  const installed = path.join(root, '.workflow-system/runtime/support');
  fs.mkdirSync(installed, { recursive: true });
  for (const name of ['assistance.mjs', 'task-management.mjs', 'record-storage.mjs']) fs.copyFileSync(path.join(RUNTIME, name), path.join(installed, name));
  const call = (command, input) => JSON.parse(execFileSync(process.execPath,
    [path.join(installed, 'assistance.mjs'), command, '--root', root], { input: JSON.stringify(input), encoding: 'utf8' }));
  const request = { action: 'close', task_id: child.task_id, dependency: satisfied, idempotency_key: 'installed-derived-return' };
  const closed = call('task', request), summary = call('task-status', {});
  assert.equal(closed.return_result.status, 'returned'); assert.equal(summary.current_task_id, parent.task_id);
  assert.equal(summary.next_step_id, 'S2'); assert.equal(summary.next_action, 'continue-step');
  const count = fs.readdirSync(path.join(root, '.workflow-system/records/events')).length;
  assert.equal(call('task', request).ref, closed.ref);
  assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, count);
});

test('a return to a recognized legacy step survives later plan adoption without rewriting its historical origin', t => {
  const root = fixture(t), originalParent = taskStatus(root).current_task;
  const child = task(root, { action: 'prepare', plan: plan('Legacy-step prerequisite'),
    origin: { parent_task_ref: '004', return_policy: 'auto' } });
  task(root, { action: 'adopt', task_id: child.task_id, plan_ref: child.ref, focus: true });
  task(root, { action: 'close', task_id: child.task_id, dependency: satisfied });
  assert.equal(taskStatus(root).current_task_id, originalParent.task_id);
  const next = task(root, { action: 'prepare', task_id: originalParent.task_id, plan: plan('Revised parent plan') });
  task(root, { action: 'adopt', task_id: originalParent.task_id, plan_ref: next.ref, focus: false });
  const view = taskStatus(root);
  assert.equal(view.current_task_id, originalParent.task_id); assert.equal(view.current_task.current_step_id, 'S1');
  assert.equal(view.current_task.continuation.status, 'work-changed');
  assert.equal(view.tasks.find(x => x.task_id === child.task_id).origin.parent_step_id, 'S3');
  assert.equal(view.issues.some(i => i.code === 'UNASSOCIATED_RECORD'), false);
});

test('concurrent focus or parent changes keep alternatives visible and prevent an unambiguous automatic return', async t => {
  await t.test('concurrent focus', t => {
    const { root, child } = derivedFixture(t);
    const other = task(root, { action: 'prepare', plan: plan('C') });
    task(root, { action: 'adopt', task_id: other.task_id, plan_ref: other.ref, focus: false });
    task(root, { action: 'focus', task_id: child.task_id });
    const heads = taskStatus(root).heads;
    task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
    task(root, { action: 'focus', task_id: other.task_id, parents: heads });
    const view = taskStatus(root);
    assert.equal(view.current_task_id, null);
    assert.equal(view.tasks.find(x => x.task_id === child.task_id).return_result.status, 'focus-conflict');
    assert.ok(view.issues.some(i => i.code === 'RECORD_CONFLICT' && i.field === 'project:focus'));
  });
  await t.test('concurrent parent execution', t => {
    const { root, parent, child } = derivedFixture(t);
    task(root, { action: 'focus', task_id: child.task_id });
    const heads = taskStatus(root).heads;
    const closed = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
    const original = bytes(root, closed.ref);
    task(root, { action: 'execution', task_id: parent.task_id, result: 'concurrent work', parents: heads });
    const view = taskStatus(root);
    assert.equal(view.current_task_id, null);
    assert.equal(view.tasks.find(x => x.task_id === child.task_id).return_result.status, 'concurrent-parent-change');
    assert.ok(view.issues.some(i => i.code === 'RETURN_PARENT_CONFLICT'));
    assert.deepEqual(bytes(root, closed.ref), original);
    task(root, { action: 'focus', task_id: parent.task_id, return_from: child.task_id });
    const selected = taskStatus(root);
    assert.equal(selected.current_task_id, parent.task_id); assert.equal(selected.current_task.continuation.status, 'work-changed');
    assert.equal(selected.issues.some(i => i.code === 'RETURN_PARENT_CONFLICT'), false);
  });
  await t.test('concurrent historical observation', t => {
    const { root, parent, child, run } = derivedFixture(t);
    task(root, { action: 'focus', task_id: child.task_id });
    const heads = taskStatus(root).heads;
    task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
    const historical = task(root, { action: 'execution', task_id: parent.task_id, historical: true,
      result: 'old failed attempt', parents: heads });
    const view = taskStatus(root);
    assert.equal(view.current_task_id, parent.task_id); assert.equal(view.current_task.continuation.status, 'ready');
    assert.equal(view.current_task.steps[1].execution_ref, run.ref);
    assert.ok(view.current_task.steps[1].historical_execution_refs.includes(historical.ref));
    assert.equal(view.issues.some(i => i.code === 'RETURN_PARENT_CONFLICT'), false);
  });
});

test('concurrent child lifecycle or prerequisite outcomes suppress return until an explicit choice resolves them', async t => {
  for (const action of ['resume', 'pause', 'dependency']) await t.test(action, t => {
    const { root, parent, child, before } = derivedFixture(t);
    task(root, { action: 'focus', task_id: child.task_id });
    const heads = taskStatus(root).heads;
    const closed = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
    const original = bytes(root, closed.ref);
    const alternative = task(root, { action, task_id: child.task_id, focus: false, parents: heads,
      ...(action === 'dependency' ? { dependency: { state: 'unresolved', summary: 'The prerequisite remains broken' } } : {}) });
    const view = taskStatus(root);
    assert.equal(view.current_task_id, null);
    assert.ok(view.issues.some(i => i.code === 'RETURN_CHILD_CONFLICT'));
    assert.deepEqual(view.tasks.find(x => x.task_id === parent.task_id).steps, before.steps);
    assert.deepEqual(bytes(root, closed.ref), original);
    task(root, { action: 'focus', task_id: parent.task_id, return_from: child.task_id });
    const manuallySelected = taskStatus(root);
    assert.equal(manuallySelected.current_task_id, parent.task_id);
    assert.notEqual(manuallySelected.current_task.continuation.status, 'ready');
    assert.notEqual(manuallySelected.next_action, 'continue-step');
    assert.equal(manuallySelected.issues.some(i => i.code === 'RETURN_CHILD_CONFLICT'), false);
    assert.ok(manuallySelected.issues.some(i => i.code === 'RECORD_CONFLICT'));
    assert.equal(JSON.parse(bytes(root, alternative.ref)).payload.request.action, action);
  });
});

test('ordered child changes after a completed return preserve its focus and immutable return fact', t => {
  const { root, parent, child } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  const closed = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied });
  const original = bytes(root, closed.ref);
  task(root, { action: 'resume', task_id: child.task_id, focus: false });
  const resumed = taskStatus(root);
  assert.equal(resumed.current_task_id, parent.task_id); assert.equal(resumed.current_task.continuation.status, 'ready');
  assert.equal(resumed.tasks.find(x => x.task_id === child.task_id).lifecycle, 'active');
  assert.equal(resumed.issues.some(i => i.code === 'RETURN_CHILD_CONFLICT'), false);
  task(root, { action: 'dependency', task_id: child.task_id, dependency: { state: 'unresolved', summary: 'Later regression' } });
  const reopened = taskStatus(root);
  assert.equal(reopened.current_task_id, parent.task_id); assert.equal(reopened.current_task.continuation.status, 'dependency-unresolved');
  assert.deepEqual(bytes(root, closed.ref), original);
});

test('selecting a closed fulfilled child alternative restores its return without new execution or focus facts', t => {
  const { root, parent, child, before } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  const heads = taskStatus(root).heads;
  const closed = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
  const original = bytes(root, closed.ref);
  task(root, { action: 'resume', task_id: child.task_id, focus: false, parents: heads });
  const conflicted = taskStatus(root);
  assert.equal(conflicted.current_task_id, null);
  const conflict = conflicted.issues.find(i => i.code === 'RECORD_CONFLICT' && i.field === `${child.task_id}:lifecycle`);
  assert.ok(conflict);
  const count = fs.readdirSync(path.join(root, '.workflow-system/records/events')).length;
  task(root, { action: 'resolve', conflict_id: conflict.id, selected_ref: closed.ref, decision_text: 'Select the completed close and its return' });
  const selected = taskStatus(root);
  assert.equal(selected.current_task_id, parent.task_id); assert.equal(selected.current_task.continuation.status, 'ready');
  assert.deepEqual(selected.current_task.steps, before.steps);
  assert.equal(selected.issues.some(i => i.code === 'RETURN_CHILD_CONFLICT'), false);
  assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, count + 1);
  assert.deepEqual(bytes(root, closed.ref), original);
});

test('concurrent agreeing child closures retain their common fulfilled return rather than inventing a conflict', t => {
  const { root, parent, child } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  const heads = taskStatus(root).heads;
  const first = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
  const original = bytes(root, first.ref);
  const second = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
  const view = taskStatus(root);
  assert.equal(view.current_task_id, parent.task_id); assert.equal(view.current_task.continuation.status, 'ready');
  assert.equal(view.issues.some(i => i.code === 'RETURN_CHILD_CONFLICT'), false);
  assert.equal(view.health, 'consistent'); assert.equal(second.association, 'applied');
  assert.equal(second.return_result.status, 'returned'); assert.equal(second.return_result.ref, view.focus.ref);
  assert.equal(view.current_task.dependencies[0].return_result.status, 'returned');
  assert.equal(queryStatus(root, { task_ref: child.task_id }).tasks[0].return_result.status, 'returned');
  const count = fs.readdirSync(path.join(root, '.workflow-system/records/events')).length;
  task(root, { action: 'rebuild' });
  assert.equal(taskStatus(root).health, 'consistent');
  assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, count);
  assert.deepEqual(bytes(root, first.ref), original);
});

test('concurrent agreeing outcomes after close expose the actual return without a second result conflict', t => {
  const { root, parent, child } = derivedFixture(t);
  task(root, { action: 'focus', task_id: child.task_id });
  task(root, { action: 'close', task_id: child.task_id });
  const heads = taskStatus(root).heads;
  const first = task(root, { action: 'dependency', task_id: child.task_id, dependency: satisfied, parents: heads });
  const original = bytes(root, first.ref);
  const second = task(root, { action: 'dependency', task_id: child.task_id, dependency: satisfied, parents: heads });
  const view = taskStatus(root);
  assert.equal(view.current_task_id, parent.task_id); assert.equal(view.current_task.continuation.status, 'ready');
  assert.equal(view.health, 'consistent'); assert.equal(second.association, 'applied');
  assert.equal(second.return_result.status, 'returned'); assert.equal(second.return_result.ref, view.focus.ref);
  const later = task(root, { action: 'dependency', task_id: child.task_id,
    dependency: { state: 'unresolved', summary: 'Ordered later regression' } });
  assert.equal(later.current_task_id, parent.task_id); assert.equal(later.return_result.status, 'dependency-unresolved');
  assert.equal(later.return_result.ref, later.ref);
  assert.equal(taskStatus(root).current_task.continuation.status, 'dependency-unresolved');
  assert.deepEqual(bytes(root, first.ref), original);
});

test('resolving a prerequisite alternative derives its return without a second result selection', async t => {
  for (const state of ['satisfied', 'unresolved']) await t.test(state, t => {
    const { root, parent, child, before } = derivedFixture(t);
    task(root, { action: 'focus', task_id: child.task_id });
    const heads = taskStatus(root).heads;
    const closed = task(root, { action: 'close', task_id: child.task_id, dependency: satisfied, parents: heads });
    const alternative = task(root, { action: 'dependency', task_id: child.task_id,
      dependency: { state: 'unresolved', summary: 'Prerequisite remains broken' }, parents: heads });
    const original = bytes(root, closed.ref), alternativeBytes = bytes(root, alternative.ref);
    const conflicted = taskStatus(root);
    assert.equal(conflicted.current_task_id, null);
    const conflicts = conflicted.issues.filter(i => i.code === 'RECORD_CONFLICT');
    assert.deepEqual(conflicts.map(i => i.field), [`${child.task_id}:dependency`]);
    const count = fs.readdirSync(path.join(root, '.workflow-system/records/events')).length;
    const selectedRef = state === 'satisfied' ? closed.ref : alternative.ref;
    task(root, { action: 'resolve', conflict_id: conflicts[0].id, selected_ref: selectedRef,
      decision_text: `Select the actual ${state} prerequisite result` });
    const selected = taskStatus(root), selectedChild = selected.tasks.find(x => x.task_id === child.task_id);
    assert.equal(selected.health, 'consistent'); assert.equal(selectedChild.dependency.state, state);
    assert.equal(selectedChild.return_result.ref, selectedRef);
    assert.equal(selectedChild.return_result.status, state === 'satisfied' ? 'returned' : 'dependency-unresolved');
    if (state === 'satisfied') {
      assert.equal(selected.current_task_id, parent.task_id); assert.equal(selected.current_task.continuation.status, 'ready');
      assert.deepEqual(selected.current_task.steps, before.steps);
      assert.equal(selected.current_task.dependencies[0].return_result.status, 'returned');
      assert.equal(queryContext(root).management.next_action, 'continue-step');
    } else {
      assert.equal(selected.current_task_id, null); assert.equal(selected.next_action, null);
    }
    assert.equal(queryStatus(root, { task_ref: child.task_id }).tasks[0].return_result.status, selectedChild.return_result.status);
    task(root, { action: 'rebuild' });
    assert.equal(taskStatus(root).health, 'consistent');
    assert.equal(fs.readdirSync(path.join(root, '.workflow-system/records/events')).length, count + 1);
    assert.deepEqual(bytes(root, closed.ref), original); assert.deepEqual(bytes(root, alternative.ref), alternativeBytes);
  });
});

test('old-plan dependencies do not block derivation or return at a revised plan with the same step ID', async t => {
  for (const association of ['prepare', 'link']) await t.test(association, t => {
    const { root, parent, child } = derivedFixture(t);
    const oldOrigin = structuredClone(child.task.origin), original = bytes(root, child.ref);
    const revision = task(root, { action: 'prepare', task_id: parent.task_id, plan: plan('A different adopted goal') });
    task(root, { action: 'adopt', task_id: parent.task_id, plan_ref: revision.ref, focus: true });
    task(root, { action: 'step', state: 'finished' });
    const before = taskStatus(root).current_task;
    assert.equal(before.current_step_id, oldOrigin.parent_step_id);
    assert.deepEqual(before.waiting_on_task_ids, []);
    const origin = { parent_task_id: parent.task_id, parent_plan_ref: revision.ref, parent_step_id: 'S2', return_policy: 'auto' };
    const next = task(root, { action: 'prepare', plan: plan('New plan prerequisite'),
      ...(association === 'prepare' ? { origin } : {}) });
    assert.equal(next.association, 'applied');
    if (association === 'link') {
      const linked = task(root, { action: 'link', record_ref: next.ref,
        event: { action: 'prepare', task_id: next.task_id, data: { origin } } });
      assert.equal(linked.association, 'applied');
    }
    task(root, { action: 'adopt', task_id: next.task_id, plan_ref: next.ref, focus: true });
    const closed = task(root, { action: 'close', task_id: next.task_id, dependency: satisfied });
    const view = taskStatus(root);
    assert.equal(closed.return_result.status, 'returned'); assert.equal(closed.next_task_id, parent.task_id);
    assert.equal(view.current_task.continuation.status, 'ready'); assert.deepEqual(view.current_task.steps, before.steps);
    assert.equal(view.health, 'consistent'); assert.deepEqual(view.current_task.waiting_on_task_ids, []);
    const retained = view.tasks.find(x => x.task_id === child.task_id);
    assert.deepEqual(retained.origin, oldOrigin); assert.equal(retained.dependency.state, 'unresolved');
    assert.deepEqual(bytes(root, child.ref), original);
  });
});

test('nullable retained steps support derivation and task-link recovery without making the live view unavailable', t => {
  const root = fixture(t);
  task(root, { action: 'close', task_ref: '004' });
  const parent = task(root, { action: 'prepare', plan: { title: 'Retained incomplete parent plan', steps: [null] } });
  task(root, { action: 'adopt', task_id: parent.task_id, plan_ref: parent.ref });
  const parentBytes = bytes(root, parent.ref);
  const child = task(root, { action: 'prepare', plan: plan('Known child') });
  const childBytes = bytes(root, child.ref);
  const linked = task(root, { action: 'link', record_ref: child.ref, event: { action: 'prepare', task_id: child.task_id,
    data: { origin: { parent_task_id: parent.task_id, parent_plan_ref: parent.ref, parent_step_id: 'S1', return_policy: 'auto' } } } });
  assert.equal(linked.association, 'applied'); assert.equal(linked.projection.status, 'updated');
  assert.equal(taskStatus(root).current_task_id, parent.task_id); assert.equal(context(root, {}).management.current_task.current_step_id, 'S1');
  assert.equal(queryStatus(root).status, 'available');
  const corrected = task(root, { action: 'correct', record_ref: child.ref, event: { data: { origin: null } } });
  assert.equal(corrected.association, 'applied');
  assert.equal(taskStatus(root).tasks.find(x => x.task_id === child.task_id).origin, null);
  assert.deepEqual(bytes(root, parent.ref), parentBytes); assert.deepEqual(bytes(root, child.ref), childBytes);
  const derived = task(root, { action: 'prepare', plan: plan('New child from retained step'), origin: { parent_task_id: parent.task_id } });
  assert.equal(derived.association, 'applied'); assert.equal(derived.task.origin.parent_step_id, 'S1');
});
