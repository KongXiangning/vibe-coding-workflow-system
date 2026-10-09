import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { record, snapshot, task } from '../runtime/vnext/support/assistance.mjs';
import { storePublishFile } from '../runtime/vnext/support/record-storage.mjs';

const STORE = '.workflow-system/records';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-portability-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function injected(platform, target, code, action) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform'), original = fs.fsyncSync;
  let calls = 0;
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  fs.fsyncSync = fd => {
    if ((target === 'directory') === fs.fstatSync(fd).isDirectory()) {
      calls++; throw Object.assign(new Error(`Injected ${target} fsync failure`), { code });
    }
    return original(fd);
  };
  syncBuiltinESMExports();
  try { action(); assert.ok(calls > 0, 'fault reached its intended I/O'); }
  finally { fs.fsyncSync = original; Object.defineProperty(process, 'platform', descriptor); syncBuiltinESMExports(); }
}

test('Windows unsupported directory fsync EPERM preserves ordinary record and task publication', t => {
  const first = fixture(t), second = fixture(t);
  injected('win32', 'directory', 'EPERM', () => {
    const saved = record(first, { body: 'retained despite unsupported directory sync' });
    assert.equal(saved.recorded, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(first, saved.ref))).payload.body,
      'retained despite unsupported directory sync');
    const prepared = task(second, { action: 'prepare', plan: { title: 'portable', steps: [] } });
    assert.equal(prepared.recorded, true);
    assert.ok(prepared.task_id);
    assert.equal(fs.readdirSync(path.join(second, STORE, 'task-labels')).length, 1);
  });
});

for (const [platform, target, code] of [
  ['linux', 'directory', 'EPERM'], ['win32', 'directory', 'EIO'],
  ['win32', 'directory', 'EACCES'], ['win32', 'file', 'EPERM'], ['win32', 'file', 'EIO'],
]) test(`${platform} ${target} ${code} still fails without claiming a saved event`, t => {
  const root = fixture(t);
  injected(platform, target, code, () => {
    assert.throws(() => record(root, { body: 'must not claim persistence' }), { code });
    assert.equal(fs.existsSync(path.join(root, STORE, 'events')), false);
  });
});

test('Windows directory open permission errors still propagate', t => {
  const root = fixture(t), original = fs.openSync;
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  let calls = 0;
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
  fs.openSync = (file, flags, ...args) => {
    if (flags === 'r' && fs.statSync(file).isDirectory()) {
      calls++; throw Object.assign(new Error('Directory access denied'), { code: 'EPERM' });
    }
    return original(file, flags, ...args);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => record(root, { body: 'blocked' }), { code: 'EPERM' }); assert.ok(calls > 0); }
  finally { fs.openSync = original; Object.defineProperty(process, 'platform', descriptor); syncBuiltinESMExports(); }
});

// Lexical Windows paths with native filesystem I/O mapped to a temporary fixture
// on either host platform. This verifies the real snapshot -> storage boundary.
function windowsPaths(root, action) {
  const winRoot = 'C:\\project', originalPath = new Map(), originalFs = new Map();
  const nativeJoin = path.join, nativeSep = path.sep;
  function physical(value) {
    if (typeof value !== 'string') return value;
    // Node's native fs.rmSync can call the exported lstatSync with its mapped path.
    if (value === root || value.startsWith(`${root}${nativeSep}`)) return value;
    assert.ok(path.win32.isAbsolute(value), `Expected resolved Windows filesystem path: ${value}`);
    const relative = path.win32.relative(winRoot, value);
    assert.ok(relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative));
    return nativeJoin(root, ...relative.split('\\'));
  }
  for (const name of ['resolve', 'relative', 'join', 'dirname', 'isAbsolute', 'sep']) {
    originalPath.set(name, path[name]); path[name] = path.win32[name];
  }
  for (const name of ['existsSync', 'lstatSync', 'mkdirSync', 'openSync', 'unlinkSync', 'rmSync', 'readdirSync']) {
    const original = fs[name]; originalFs.set(name, original);
    fs[name] = (file, ...args) => original(physical(file), ...args);
  }
  const originalLink = fs.linkSync; originalFs.set('linkSync', originalLink);
  fs.linkSync = (source, target) => originalLink(physical(source), physical(target));
  syncBuiltinESMExports();
  try { return action(winRoot); }
  finally {
    for (const [name, original] of originalPath) path[name] = original;
    for (const [name, original] of originalFs) fs[name] = original;
    syncBuiltinESMExports();
  }
}

test('snapshot publishes relative temporary identity with Windows drive paths and exact original bytes', t => {
  const root = fixture(t), bytes = Buffer.from('report\r\n\u0000retained\n');
  fs.writeFileSync(path.join(root, 'report.txt'), bytes);
  const result = windowsPaths(root, winRoot => snapshot(winRoot,
    { path: 'C:\\project\\report.txt', workflow_home: 'docs/workflow' }));
  assert.equal(result.status, 'saved');
  assert.equal(result.sha256, digest(bytes));
  assert.deepEqual(fs.readFileSync(path.join(root, result.ref)), bytes);
  assert.deepEqual(fs.readdirSync(path.join(root, STORE, 'evidence-objects')), [`${digest(bytes)}.blob`]);
});

test('storage still rejects drive-qualified, escaping, traversal and Git temporary inputs', t => {
  const root = fixture(t), outside = fixture(t), bytes = Buffer.from('original');
  const source = `${STORE}/capture.tmp`, target = `${STORE}/evidence-objects/${digest(bytes)}.blob`;
  fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
  fs.writeFileSync(path.join(root, source), bytes);
  for (const unsafe of ['C:\\project\\capture.tmp', '../capture.tmp', `${STORE}/../capture.tmp`,
    '.git/capture.tmp', path.join(outside, 'capture.tmp')])
    assert.throws(() => storePublishFile(root, target, unsafe, digest(bytes), bytes.length), { code: 'UNSAFE_PATH' });
  assert.equal(fs.existsSync(path.join(root, target)), false);
});

test('storage still rejects symlink temporary inputs', t => {
  const root = fixture(t), bytes = Buffer.from('original');
  const source = `${STORE}/capture.tmp`, target = `${STORE}/evidence-objects/${digest(bytes)}.blob`;
  fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
  fs.writeFileSync(path.join(root, source), bytes);
  try { fs.symlinkSync(path.join(root, source), path.join(root, STORE, 'link.tmp')); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip(`Windows file symlink creation unavailable (${error.code}); requires Developer Mode or symlink privilege`);
    return;
  }
  assert.throws(() => storePublishFile(root, target, `${STORE}/link.tmp`, digest(bytes), bytes.length), { code: 'UNSAFE_PATH' });
  assert.equal(fs.existsSync(path.join(root, target)), false);
});
