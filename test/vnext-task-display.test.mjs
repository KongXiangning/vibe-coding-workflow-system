import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import fsMutable from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { record, task, taskStatus, queryStatus, queryContext } from '../runtime/vnext/support/assistance.mjs';
import { readTaskDisplay, synchronizeTasks } from '../runtime/vnext/support/task-management.mjs';

const STORE = '.workflow-system/records';
const CURRENT = 'docs/workflow/CURRENT_TASK.md';
const local = (root, ref) => path.join(root, ref);
const bytes = (root, ref) => fs.readFileSync(local(root, ref));
const sha = value => createHash('sha256').update(value).digest('hex');
const directory = (root, ref) => fs.existsSync(local(root, ref)) ? fs.readdirSync(local(root, ref)).sort() : [];
const displayFiles = root => ({ views: directory(root, `${STORE}/task-views`), recovery: directory(root, `${STORE}/legacy`) });
function tree(root, relative = '') {
  return fs.readdirSync(local(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const ref = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return tree(root, ref);
    const stat = fs.statSync(local(root, ref));
    return [{ ref, digest: sha(bytes(root, ref)), ino: stat.ino, mtime: stat.mtimeMs }];
  });
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-task-display-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(local(root, 'docs/workflow'), { recursive: true });
  const prepared = task(root, { action: 'prepare', plan: { title: 'Display truth', steps: [{ id: 'S1', title: 'Preserve evidence' }] } });
  assert.equal(prepared.recorded, true);
  task(root, { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref, decision_text: 'Proceed' });
  assert.equal(taskStatus(root).projection.display, 'current');
  return { root, taskId: prepared.task_id, planRef: prepared.ref };
}
function io(overrides = {}) {
  return { local, workflowHome: () => ({ home: 'docs/workflow', issues: [] }),
    publish: (root, ref, data) => {
      fs.mkdirSync(path.dirname(local(root, ref)), { recursive: true });
      try { fs.writeFileSync(local(root, ref), data, { flag: 'wx' }); return true; }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    }, ...overrides };
}
function legacyV1(root) {
  const view = taskStatus(root);
  const body = bytes(root, CURRENT).toString().split('<!-- vnext-task-view/v2 -->\n')[1]
    .replace('- Display revision identifies this derived display only; query task-status/context for current source/view revisions.', `- Source: ${view.source_revision}`);
  const text = ['---', 'schema_version: 1', 'kind: vnext-task-view', `source_revision: ${view.source_revision}`,
    `view_revision: ${view.view_revision}`, '---', '<!-- vnext-task-view/v1 -->', body].join('\n');
  const ref = `${STORE}/task-views/${view.view_revision}.md`;
  fs.writeFileSync(local(root, ref), text);
  fs.writeFileSync(local(root, CURRENT), text);
  return { ref, text, view };
}
function heldView(root, run) {
  const lock = local(root, `${STORE}/task-view.lock`);
  fs.writeFileSync(lock, JSON.stringify({ host: os.hostname(), pid: process.pid, id: 'fixture-writer' }));
  try { return run(); } finally { fs.unlinkSync(lock); }
}

test('fact-only updates retain CURRENT_TASK inode and all display files while cache and queries report fresh facts', t => {
  const { root } = fixture(t), before = taskStatus(root), current = bytes(root, CURRENT);
  const files = displayFiles(root), inode = fs.statSync(local(root, CURRENT)).ino;
  const originalRename = fsMutable.renameSync;
  let currentRenames = 0;
  const mocked = t.mock.method(fsMutable, 'renameSync', (source, destination) => {
    if (source === local(root, CURRENT) || destination === local(root, CURRENT)) currentRenames++;
    return originalRename(source, destination);
  });
  syncBuiltinESMExports();
  try {
    for (const [run, body] of ['failed test log', 'user chose to continue', 'database state before', 'database state after'].entries()) {
      const saved = record(root, { kind: 'evidence', body: { run, text: body } });
      assert.equal(saved.recorded, true);
      assert.equal(saved.management.display, 'unchanged');
      assert.equal(JSON.parse(bytes(root, saved.ref)).payload.body.text, body);
    }
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  const after = taskStatus(root), cached = JSON.parse(bytes(root, `${STORE}/task-view.json`));
  assert.notEqual(after.source_revision, before.source_revision);
  assert.notEqual(after.view_revision, before.view_revision);
  assert.equal(after.display_revision, before.display_revision);
  assert.equal(after.records_scanned, before.records_scanned + 4);
  assert.equal(cached.source_revision, after.source_revision);
  assert.equal(cached.view_revision, after.view_revision);
  assert.equal(after.projection.cache, 'current');
  assert.equal(after.projection.display, 'current');
  assert.equal(currentRenames, 0);
  assert.equal(fs.statSync(local(root, CURRENT)).ino, inode);
  assert.deepEqual(bytes(root, CURRENT), current);
  assert.deepEqual(displayFiles(root), files);
  assert.doesNotMatch(current.toString(), /^source_revision:|^view_revision:|^- Source:/m);
  assert.match(current.toString(), /query task-status\/context for current source\/view revisions/);
  const beforeQueries = tree(root);
  assert.equal(queryStatus(root).source_revision, after.source_revision);
  assert.equal(queryContext(root).management.view_revision, after.view_revision);
  assert.deepEqual(tree(root), beforeQueries);
});

test('live facts remain truthful if cache publication is pending but displayed meaning stays current', t => {
  const { root } = fixture(t), before = taskStatus(root), files = displayFiles(root);
  const saved = heldView(root, () => record(root, { kind: 'evidence', body: 'new independent report' }));
  assert.equal(saved.management.code, 'VIEW_BUSY');
  const after = taskStatus(root);
  assert.notEqual(after.source_revision, before.source_revision);
  assert.equal(after.projection.cache, 'stale');
  assert.equal(after.projection.display, 'current');
  assert.equal(task(root, { action: 'rebuild' }).rebuild.display, 'unchanged');
  assert.deepEqual(displayFiles(root), files);
  assert.equal(taskStatus(root).projection.cache, 'current');
});

test('semantic changes publish and a repeated semantic revision reuses identical canonical bytes', t => {
  const { root, taskId } = fixture(t), before = taskStatus(root), current = bytes(root, CURRENT), files = displayFiles(root);
  const paused = task(root, { action: 'pause', task_id: taskId });
  assert.equal(paused.projection.display, 'updated');
  assert.notEqual(taskStatus(root).display_revision, before.display_revision);
  assert.equal(directory(root, `${STORE}/task-views`).length, files.views.length + 1);
  assert.ok(directory(root, `${STORE}/legacy`).filter(ref => ref.startsWith('display-capture-')).length > 0);
  const resumed = task(root, { action: 'resume', task_id: taskId });
  assert.equal(resumed.projection.display, 'updated');
  assert.equal(taskStatus(root).display_revision, before.display_revision);
  assert.deepEqual(bytes(root, CURRENT), current);
  assert.equal(directory(root, `${STORE}/task-views`).length, files.views.length + 1);
  assert.notEqual(taskStatus(root).source_revision, before.source_revision);
});

test('v1 byte-verified baseline stays intact across fact changes and upgrades only on a semantic change', t => {
  const { root, taskId } = fixture(t), legacy = legacyV1(root), files = displayFiles(root), inode = fs.statSync(local(root, CURRENT)).ino;
  assert.equal(readTaskDisplay(root, CURRENT, { local }).verified, true);
  const saved = record(root, { kind: 'evidence', body: 'one more run, no display change' });
  assert.equal(saved.management.display, 'unchanged');
  assert.equal(taskStatus(root).projection.display, 'current');
  assert.notEqual(taskStatus(root).source_revision, legacy.view.source_revision);
  assert.equal(bytes(root, CURRENT).toString(), legacy.text);
  assert.equal(fs.statSync(local(root, CURRENT)).ino, inode);
  assert.deepEqual(displayFiles(root), files);
  assert.equal(task(root, { action: 'pause', task_id: taskId }).projection.display, 'updated');
  assert.match(bytes(root, CURRENT).toString(), /<!-- vnext-task-view\/v2 -->/);
  assert.equal(bytes(root, legacy.ref).toString(), legacy.text);
  assert.equal(taskStatus(root).projection.display, 'current');
});

test('missing v1/v2 baseline cannot be recreated to bless an existing unverified display', t => {
  for (const format of ['v1', 'v2']) {
    const { root } = fixture(t);
    if (format === 'v1') legacyV1(root);
    const display = readTaskDisplay(root, CURRENT, { local }), current = bytes(root, CURRENT);
    fs.unlinkSync(local(root, display.snapshot_ref));
    const files = displayFiles(root), inode = fs.statSync(local(root, CURRENT)).ino;
    const saved = record(root, { kind: 'evidence', body: format });
    assert.equal(saved.management.display, 'drift');
    assert.ok(saved.management.issues.some(issue => issue.code === 'CURRENT_TASK_BASELINE_UNAVAILABLE'));
    assert.equal(taskStatus(root).projection.display, 'stale-or-edited');
    assert.equal(taskStatus(root).projection.display_issue.code, 'CURRENT_TASK_BASELINE_UNAVAILABLE');
    assert.equal(fs.statSync(local(root, CURRENT)).ino, inode);
    assert.deepEqual(bytes(root, CURRENT), current);
    assert.deepEqual(displayFiles(root), files);
  }
});

test('unknown, malformed and externally edited displays remain drift until explicit preserved replacement', t => {
  for (const change of [text => text.replace('vnext-task-view/v2', 'vnext-task-view/v99'),
    text => text.replace('schema_version: 2', 'schema_version: 99'), text => text + '\nUser-added note\n']) {
    const { root } = fixture(t), edited = change(bytes(root, CURRENT).toString());
    fs.writeFileSync(local(root, CURRENT), edited);
    const files = displayFiles(root), saved = record(root, { kind: 'evidence', body: 'unchanged display meaning' });
    assert.equal(saved.management.display, 'drift');
    assert.equal(taskStatus(root).projection.display, 'stale-or-edited');
    assert.ok(taskStatus(root).projection.display_issue);
    assert.deepEqual(displayFiles(root), files);
    assert.equal(bytes(root, CURRENT).toString(), edited);
    assert.equal(task(root, { action: 'rebuild', overwrite_display: true }).rebuild.display, 'updated');
    assert.ok(directory(root, `${STORE}/legacy`).some(ref => bytes(root, `${STORE}/legacy/${ref}`).toString() === edited));
    assert.equal(taskStatus(root).projection.display, 'current');
  }
});

test('a changed path during unchanged-display validation is reported without replacement or captures', t => {
  const { root } = fixture(t), files = displayFiles(root), original = bytes(root, CURRENT), note = '\nConcurrent unchanged-path edit\n';
  let reads = 0;
  const publication = synchronizeTasks(root, {}, io({ readFile: (r, ref) => {
    if (ref === CURRENT && ++reads === 4) fs.appendFileSync(local(root, CURRENT), note);
    return bytes(r, ref);
  } }));
  // legacySource is read once for retention and once for the computed view, then
  // baseline validation and the no-op branch each read the current path.
  assert.equal(reads, 4);
  assert.equal(publication.display, 'drift');
  assert.equal(bytes(root, CURRENT).toString(), original.toString() + note);
  assert.deepEqual(displayFiles(root), files);
});

test('interrupted real publication restores the old inode and retry preserves later open-handle writes', t => {
  const { root, taskId } = fixture(t), target = local(root, CURRENT), before = bytes(root, CURRENT), handle = fs.openSync(target, 'a');
  t.after(() => fs.closeSync(handle));
  heldView(root, () => task(root, { action: 'pause', task_id: taskId }));
  const originalLink = fsMutable.linkSync;
  let injected = false;
  const mocked = t.mock.method(fsMutable, 'linkSync', (source, destination) => {
    if (!injected && destination === target && source.endsWith('.tmp')) {
      injected = true;
      throw Object.assign(new Error('Interrupted publication fixture'), { code: 'EIO' });
    }
    return originalLink(source, destination);
  });
  syncBuiltinESMExports();
  try {
    const rebuilt = task(root, { action: 'rebuild' });
    assert.equal(rebuilt.rebuild.status, 'failed');
    assert.equal(rebuilt.rebuild.code, 'EIO');
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(injected, true);
  assert.deepEqual(bytes(root, CURRENT), before);
  const firstCaptures = directory(root, `${STORE}/legacy`).filter(ref => ref.startsWith('display-capture-'));
  assert.ok(firstCaptures.length);
  assert.equal(task(root, { action: 'rebuild' }).rebuild.display, 'updated');
  fs.writeSync(handle, '\nLate original inode write after successful retry\n');
  assert.ok(firstCaptures.some(ref => bytes(root, `${STORE}/legacy/${ref}`).toString().includes('Late original inode write')));
  assert.doesNotMatch(bytes(root, CURRENT).toString(), /Late original inode write/);
  assert.equal(taskStatus(root).projection.display, 'current');
});

test('missing CURRENT_TASK is rebuilt from the same canonical display without a new baseline or recovery copy', t => {
  const { root } = fixture(t), original = bytes(root, CURRENT), files = displayFiles(root);
  fs.unlinkSync(local(root, CURRENT));
  assert.equal(taskStatus(root).projection.display, 'missing');
  assert.equal(task(root, { action: 'rebuild' }).rebuild.display, 'updated');
  assert.deepEqual(bytes(root, CURRENT), original);
  assert.deepEqual(displayFiles(root), files);
  assert.equal(taskStatus(root).projection.display, 'current');
});

test('a corrupt canonical baseline is never overwritten or silently accepted as current', t => {
  const { root } = fixture(t), display = readTaskDisplay(root, CURRENT, { local }), original = bytes(root, CURRENT);
  fs.writeFileSync(local(root, display.snapshot_ref), 'retained unexpected baseline bytes');
  assert.equal(taskStatus(root).projection.display_issue.code, 'CURRENT_TASK_BASELINE_MISMATCH');
  const rebuilt = task(root, { action: 'rebuild', overwrite_display: true });
  assert.equal(rebuilt.rebuild.status, 'failed');
  assert.equal(rebuilt.rebuild.code, 'DISPLAY_BASELINE_CONFLICT');
  assert.deepEqual(bytes(root, CURRENT), original);
  assert.equal(bytes(root, display.snapshot_ref).toString(), 'retained unexpected baseline bytes');
  assert.equal(taskStatus(root).projection.display, 'stale-or-edited');
});

test('separate historical failed executions and tests remain complete without duplicate display publication', t => {
  const { root, taskId, planRef } = fixture(t), before = taskStatus(root), files = displayFiles(root), current = bytes(root, CURRENT);
  const refs = [];
  for (const run of ['first failed run', 'second failed run']) {
    const execution = task(root, { action: 'execution', task_id: taskId, plan_ref: planRef, step_id: 'S1', historical: true,
      result: 'failed', source_revision: run, commands: [{ command: 'node test.js', result: 'failed', output: `${run}: full error text` }] });
    assert.equal(execution.recorded, true);
    assert.equal(execution.projection.display, 'unchanged');
    refs.push(execution.ref);
    const testRun = task(root, { action: 'test', task_id: taskId, plan_ref: planRef, step_id: 'S1', historical: true,
      result: 'failed', execution_ref: execution.ref, output: `${run}: distinct failure evidence` });
    assert.equal(testRun.recorded, true);
    assert.equal(testRun.projection.display, 'unchanged');
    refs.push(testRun.ref);
  }
  const after = taskStatus(root);
  assert.equal(new Set(refs).size, 4);
  assert.ok(refs.every(ref => fs.existsSync(local(root, ref))));
  assert.equal(after.current_task.executions.length, 2);
  assert.equal(after.current_task.tests.length, 2);
  assert.deepEqual(after.current_task.executions.map(run => run.commands[0].output).sort(),
    ['first failed run: full error text', 'second failed run: full error text']);
  assert.deepEqual(after.current_task.tests.map(run => run.output).sort(),
    ['first failed run: distinct failure evidence', 'second failed run: distinct failure evidence']);
  assert.notEqual(after.source_revision, before.source_revision);
  assert.notEqual(after.view_revision, before.view_revision);
  assert.equal(after.display_revision, before.display_revision);
  assert.deepEqual(bytes(root, CURRENT), current);
  assert.deepEqual(displayFiles(root), files);
});
