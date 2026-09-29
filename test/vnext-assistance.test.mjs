import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { record, read, find, context, snapshot } from '../runtime/vnext/support/assistance.mjs';

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
