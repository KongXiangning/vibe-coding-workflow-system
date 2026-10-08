import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { record, read, find, context, snapshot, task, taskStatus, queryStatus, archive } from '../runtime/vnext/support/assistance.mjs';
import { storeReadFile, storeList, archiveInventory } from '../runtime/vnext/support/record-storage.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const prefix = '.workflow-system/records';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-assistance-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/workflow'), { recursive: true });
  return root;
}
function compact(root) {
  const created = archive(root, { action: 'create' });
  archive(root, { action: 'verify' });
  archive(root, { action: 'quarantine' });
  archive(root, { action: 'reclaim' });
  return created;
}
function exact(root, ref) { return Buffer.from(read(root, { ref, max_bytes: 65536 }).data, 'base64'); }

test('archived events and attachments preserve old references, replay and distinct conflicting observations', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'report.txt'), 'failed before fix\r\n');
  const payload = { kind: 'test-run', idempotency_key: 'retained-run', body: { result: 'failed', details: 'a unique failure phrase' }, files: ['report.txt'] };
  const first = record(root, payload), bytes = exact(root, first.ref), attachment = exact(root, first.attachments_ref);
  const before = taskStatus(root), sourcesBefore = context(root, {}).sources;
  compact(root);
  assert.equal(fs.existsSync(path.join(root, first.ref)), false);
  assert.deepEqual(exact(root, first.ref), bytes);
  assert.deepEqual(exact(root, first.attachments_ref), attachment);
  assert.deepEqual(taskStatus(root), before);
  assert.deepEqual(context(root, {}).sources, sourcesBefore);
  fs.writeFileSync(path.join(root, 'report.txt'), 'changed later');
  const replay = record(root, payload);
  assert.equal(replay.status, 'already-recorded');
  assert.equal(replay.ref, first.ref);
  assert.equal(replay.attachments_ref, first.attachments_ref);
  assert.equal(fs.existsSync(path.join(root, first.ref)), false);
  const conflict = record(root, { ...payload, body: { result: 'passed' } });
  assert.notEqual(conflict.ref, first.ref);
  assert.ok(conflict.issues.some(x => x.code === 'IDEMPOTENCY_CONFLICT_RETAINED'));
  assert.deepEqual(exact(root, first.ref), bytes);
  const matches = find(root, { query: 'a unique failure phrase', roots: [`${prefix}/events`] });
  assert.ok(matches.matches.some(m => m.path === first.ref && m.match === 'content'));
  assert.ok(matches.matches.every(m => !m.path.includes('/archives/') && !m.path.includes('/quarantine/')));
});

test('task reducer, raw source revision and label allocation remain unchanged through reclamation', t => {
  const root = fixture(t);
  const prepared = task(root, { action: 'prepare', idempotency_key: 'plan1', title: 'archived plan', steps: [{ id: 'S1', title: 'work' }] });
  task(root, { action: 'adopt', task_ref: prepared.task_id, plan_ref: prepared.ref, decision: 'Implement this bounded task' });
  task(root, { action: 'execution', task_ref: prepared.task_id, idempotency_key: 'failed-execution', result: 'failed', report: 'Keep the actual failure' });
  const before = taskStatus(root), queryBefore = queryStatus(root, { detail: 'full' });
  const all = new Map(storeList(root, `${prefix}/events`).map(ref => [ref, storeReadFile(root, ref)]));
  compact(root);
  assert.deepEqual(taskStatus(root), before);
  assert.deepEqual(queryStatus(root, { detail: 'full' }), queryBefore);
  for (const [ref, bytes] of all) assert.deepEqual(storeReadFile(root, ref), bytes);
  const replay = task(root, { action: 'prepare', idempotency_key: 'plan1', title: 'archived plan', steps: [{ id: 'S1', title: 'work' }] });
  assert.equal(replay.ref, prepared.ref);
  assert.equal(replay.task_id, prepared.task_id);
  const next = task(root, { action: 'prepare', idempotency_key: 'plan2', title: 'another', steps: [] });
  assert.notEqual(next.task.display_id, prepared.task.display_id);
  assert.equal(next.task.display_id, 'TASK-002');
  assert.deepEqual(storeReadFile(root, prepared.ref), all.get(prepared.ref));
});

test('archived CAS range reads remain bounded and archived file sources can be captured again', t => {
  const root = fixture(t), bytes = Buffer.alloc(5 * 1024 * 1024, 97);
  Buffer.from('cross-boundary marker').copy(bytes, 65531);
  fs.writeFileSync(path.join(root, 'large.txt'), bytes);
  const captured = snapshot(root, { path: 'large.txt' });
  const event = record(root, { idempotency_key: 'capture-record', body: 'snapshot an archived event as a new object' });
  const raw = storeReadFile(root, event.ref);
  compact(root);
  const page = read(root, { sha256: captured.sha256, offset: 65530, max_bytes: 30 });
  assert.deepEqual(Buffer.from(page.data, 'base64'), bytes.subarray(65530, 65560));
  assert.ok(page.read_metrics, 'range I/O metrics are part of the measured contract');
  assert.equal(snapshot(root, { sha256: captured.sha256 }).ref, captured.ref);
  assert.equal(snapshot(root, { path: 'large.txt' }).ref, captured.ref);
  assert.equal(fs.existsSync(path.join(root, captured.ref)), false, 'same-byte capture must not recreate reclaimed CAS loose file');
  const recaptured = snapshot(root, { path: event.ref });
  assert.equal(recaptured.sha256, digest(raw));
  const found = find(root, { roots: [captured.ref], query: 'cross-boundary marker', scan_bytes: 32768 });
  let matches = found.matches, cursor = found.next_cursor;
  while (cursor) { const p = find(root, { roots: [captured.ref], query: 'cross-boundary marker', scan_bytes: 32768, cursor }); matches.push(...p.matches); cursor = p.next_cursor; }
  assert.deepEqual(matches.map(x => x.offset), [65531]);
});

test('current view baselines and open old display handles remain protected', t => {
  const root = fixture(t);
  const first = task(root, { action: 'prepare', title: 'retain display', steps: [] });
  task(root, { action: 'adopt', task_ref: first.task_id, plan_ref: first.ref });
  const current = path.join(root, 'docs/workflow/CURRENT_TASK.md');
  const fd = fs.openSync(current, 'r+'); t.after(() => fs.closeSync(fd));
  task(root, { action: 'prepare', title: 'another fact changes view', steps: [] });
  const protectedBefore = storeList(root, prefix).filter(ref => ref.includes('/task-views/') || /\/legacy\/display-/.test(ref));
  compact(root);
  for (const ref of protectedBefore) assert.ok(fs.existsSync(path.join(root, ref)), ref);
  const late = Buffer.from('late editor write remains recoverable\n');
  fs.writeSync(fd, late, 0, late.length, 0);
  assert.ok(protectedBefore.filter(ref => ref.includes('display-capture-')).some(ref => fs.readFileSync(path.join(root, ref)).subarray(0, late.length).equals(late)));
  assert.ok(archiveInventory(root).records.every(row => !/task-view|display-/.test(row.ref)));
});


test('snapshot reuse verifies the full archived object before publishing a successful attachment', t => {
  const root = fixture(t), bytes = Buffer.alloc(180000, 65);
  fs.writeFileSync(path.join(root, 'source.txt'), bytes);
  const captured = snapshot(root, { path: 'source.txt' });
  compact(root);
  const backing = archiveInventory(root).archives[0].physical_files.find(f => f.kind === 'pack');
  const full = fs.readFileSync(path.join(root, backing.ref)); full[full.length - 1] ^= 1;
  fs.writeFileSync(path.join(root, backing.ref), full);
  assert.throws(() => snapshot(root, { sha256: captured.sha256, path: 'source.txt' }), /digest|compressed|chunk|archive/i);
  const result = record(root, { kind: 'test-run', files: [{ sha256: captured.sha256, path: 'source.txt' }] });
  assert.equal(result.recorded, true);
  assert.equal(result.attachments[0].status, 'unavailable');
  assert.ok(result.attachments[0].code);
});

test('create-only preserves logical find results and a conflicting loose page does not hide independent records', t => {
  const root = fixture(t), query = 'find-through-create';
  const first = record(root, { idempotency_key: 'find1', body: `${query} one` });
  const second = record(root, { idempotency_key: 'find2', body: `${query} two` });
  const input = { roots: [`${prefix}/events`], query }, before = find(root, input);
  archive(root, { action: 'create' });
  const after = find(root, input);
  assert.equal(after.status, 'complete'); assert.deepEqual(after.issues, []);
  assert.deepEqual(after.matches, before.matches);
  const bytes = fs.readFileSync(path.join(root, first.ref)); bytes[bytes.indexOf(query)] ^= 1;
  fs.writeFileSync(path.join(root, first.ref), bytes);
  const conflict = find(root, input);
  assert.equal(conflict.status, 'partial');
  assert.ok(conflict.issues.some(issue => issue.code === 'ARCHIVE_COLLISION'));
  assert.ok(conflict.matches.some(match => match.path === second.ref));
  for (const changed of [Buffer.concat([bytes, Buffer.from('\n')]), bytes.subarray(0, bytes.length - 3)]) {
    fs.writeFileSync(path.join(root, first.ref), changed);
    const lengthConflict = find(root, input);
    assert.equal(lengthConflict.status, 'partial');
    assert.ok(lengthConflict.issues.some(issue => issue.code === 'ARCHIVE_COLLISION'));
    assert.ok(lengthConflict.matches.some(match => match.path === second.ref));
  }
});
