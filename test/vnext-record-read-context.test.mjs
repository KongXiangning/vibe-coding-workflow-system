import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { archiveCommand, archiveInventory, storeAppend, storeExists, storeList, storePublishFile,
  storeRead, storeReadFile, storeReserve, storeStat, withStoreReadContext } from '../runtime/vnext/support/record-storage.mjs';

const STORE = '.workflow-system/records', ARCHIVES = `${STORE}/archives`;
const ref = name => `${STORE}/events/${name}.json`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-read-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/workflow'), { recursive: true });
  return root;
}
function put(root, target, bytes) {
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, target), bytes);
}
function compact(root) {
  for (const action of ['create', 'quarantine', 'reclaim']) archiveCommand(root, { action });
}
async function instrument(t) {
  const root = fixture(t), source = new URL('../runtime/vnext/support/', import.meta.url);
  for (const name of ['record-storage.mjs', 'assistance.mjs', 'task-management.mjs', 'task-event-codec.mjs'])
    fs.copyFileSync(new URL(name, source), path.join(root, name));
  const file = path.join(root, 'record-storage.mjs');
  let text = fs.readFileSync(file, 'utf8');
  // Only this disposable copy has counters. Count the actual structural loops,
  // rather than elapsed time or JSON cache hits, to expose quadratic regressions.
  for (const [before, counter] of [
    ['for (const entry of index.records) {', 'entries'],
    ['for (const chunk of entry.chunks) {', 'chunks'],
    ['function catalog(root, target = null, signatures = null) {', 'catalogs']
  ]) {
    assert.equal(text.split(before).length, 2, `instrumentation target: ${before}`);
    text = text.replace(before, `${before} __counts.${counter}++;`);
  }
  fs.writeFileSync(file, `export const __counts = { entries: 0, chunks: 0, catalogs: 0 };\n${text}`);
  const storage = await import(pathToFileURL(file));
  const assistance = await import(pathToFileURL(path.join(root, 'assistance.mjs')));
  return { storage, assistance, counts: storage.__counts, reset: () => Object.assign(storage.__counts, { entries: 0, chunks: 0, catalogs: 0 }) };
}

test('find, full status, task status and context validate each shard entry once per query with exact output', async t => {
  const root = fixture(t), { assistance, counts, reset } = await instrument(t), n = 500;
  for (let i = 0; i < n; i++) {
    const id = String(i).padStart(4, '0'), payload = { body: `sample-${id}`, kind: 'note' };
    let row = { schema_version: 1, payload, payload_sha256: sha(JSON.stringify(payload)) };
    payload.body += 'x'.repeat(166 - Buffer.byteLength(JSON.stringify(row) + '\n'));
    row.payload_sha256 = sha(JSON.stringify(payload));
    const bytes = JSON.stringify(row) + '\n'; assert.equal(Buffer.byteLength(bytes), 166);
    put(root, ref(id), bytes);
  }
  const queries = [
    () => assistance.find(root, { query: 'needle-that-is-absent', roots: [`${STORE}/events`], scan_bytes: 4194304, max_results: 100 }),
    () => assistance.taskStatus(root),
    () => assistance.task(root, { action: 'status' }),
    () => assistance.context(root, {})
  ];
  const before = queries.map(run => JSON.stringify(run()));
  compact(root);
  for (const [i, run] of queries.entries()) {
    reset(); assert.equal(JSON.stringify(run()), before[i]);
    assert.equal(counts.entries, n); assert.equal(counts.chunks, n);
    assert.ok(counts.catalogs <= 2, JSON.stringify(counts));
    // A second invocation must validate its own structure, even with warm JSON.
    run(); assert.equal(counts.entries, 2 * n); assert.equal(counts.chunks, 2 * n);
  }
});

test('low-level list, stat, exists, whole-file and range reads share only the active query graph', async t => {
  const root = fixture(t), { storage: s, counts } = await instrument(t);
  for (let i = 0; i < 12; i++) put(root, ref(i), `original-${i}`);
  compact(root);
  s.withStoreReadContext(root, readContext => {
    const options = { readContext }, refs = s.storeList(root, STORE, options);
    assert.equal(refs.length, 12);
    for (const target of refs) {
      assert.equal(s.storeStat(root, target, options).storage, 'archive');
      assert.equal(s.storeExists(root, target, options), true);
      const bytes = s.storeReadFile(root, target, options);
      assert.deepEqual(s.storeRead(root, target, { ...options, offset: 1, length: 3 }).bytes, bytes.subarray(1, 4));
    }
    assert.equal(counts.entries, 12); assert.equal(counts.catalogs, 1);
  });
  s.withStoreReadContext(root, readContext => s.storeList(root, STORE, { readContext }));
  assert.equal(counts.entries, 24);
});

test('single-ref query routing stays cold and bounded; replacing the only target cannot accumulate graphs', async t => {
  const root = fixture(t), { storage: s, counts } = await instrument(t);
  for (let i = 0; i < 2050; i++) put(root, ref(String(i).padStart(5, '0')), `record-${i}`);
  compact(root);
  s.withStoreReadContext(root, readContext => {
    const target = ref('02049'), options = { readContext, length: 32 };
    const first = s.storeRead(root, target, options);
    assert.equal(first.metrics.indices_read, 1);
    assert.ok(first.metrics.metadata_bytes_examined < 8192);
    assert.equal(counts.entries, 2);
    s.storeRead(root, target, options); assert.equal(counts.entries, 2);
    s.storeRead(root, ref('00000'), options); assert.equal(counts.entries, 2050);
    // Only the latest routed graph remains, so going back validates two entries.
    s.storeRead(root, target, options); assert.equal(counts.entries, 2052);
  });
});

for (const kind of ['manifest', 'index', 'pack']) {
  for (const change of ['missing', 'replacement', 'in-place']) {
    test(`warm contexts fail closed for ${kind} ${change}`, t => {
      const root = fixture(t), target = ref('old'); put(root, target, 'original bytes');
      archiveCommand(root, { action: 'create' });
      const file = path.join(root, archiveInventory(root).archives[0].physical_files.find(f => f.kind === kind).ref);
      withStoreReadContext(root, readContext => {
        const options = { readContext }; assert.equal(storeReadFile(root, target, options).toString(), 'original bytes');
        const bytes = fs.readFileSync(file), stat = fs.statSync(file); bytes[bytes.length - 2] ^= 1;
        if (change === 'missing') fs.unlinkSync(file);
        else if (change === 'replacement') {
          fs.writeFileSync(`${file}.replacement`, bytes); fs.renameSync(`${file}.replacement`, file);
        } else { fs.writeFileSync(file, bytes); fs.utimesSync(file, stat.atime, stat.mtime); }
        assert.throws(() => storeReadFile(root, target, options));
      });
      assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'original bytes');
    });
  }
}

test('identical index replacement revalidates structure', async t => {
  const root = fixture(t), target = ref('old'), { storage: s, counts } = await instrument(t);
  put(root, target, 'original'); compact(root);
  const index = path.join(root, archiveInventory(root).archives[0].physical_files.find(f => f.kind === 'index').ref);
  s.withStoreReadContext(root, readContext => {
    const options = { readContext };
    s.storeReadFile(root, target, options); assert.equal(counts.entries, 1);
    fs.copyFileSync(index, `${index}.replacement`); fs.renameSync(`${index}.replacement`, index);
    assert.equal(s.storeReadFile(root, target, options).toString(), 'original'); assert.equal(counts.entries, 2);
  });
});

test('warm read contexts reject an index replaced with a symlink', t => {
  const root = fixture(t), outside = fixture(t), target = ref('old');
  put(root, target, 'original'); compact(root);
  const index = path.join(root, archiveInventory(root).archives[0].physical_files.find(f => f.kind === 'index').ref);
  const copy = path.join(outside, 'index.json'), link = path.join(outside, 'index.link');
  fs.copyFileSync(index, copy);
  // Probe the actual capability before changing the index or opening a context.
  try { fs.symlinkSync(copy, link); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip(`Windows file symlink creation unavailable (${error.code}); requires Developer Mode or symlink privilege`);
    return;
  }
  withStoreReadContext(root, readContext => {
    const options = { readContext };
    assert.equal(storeReadFile(root, target, options).toString(), 'original');
    fs.unlinkSync(index); fs.renameSync(link, index);
    assert.throws(() => storeReadFile(root, target, options), { code: 'UNSAFE_PATH' });
  });
});

test('archive directory changes, additions and removal cannot reuse an old catalog', t => {
  const root = fixture(t), other = fixture(t), first = ref('first'), second = ref('second');
  put(root, first, 'first'); put(other, second, 'second'); compact(root); compact(other);
  const incoming = fs.readdirSync(path.join(other, ARCHIVES))[0];
  withStoreReadContext(root, readContext => {
    const options = { readContext }; assert.deepEqual(storeList(root, STORE, options), [first]);
    fs.cpSync(path.join(other, ARCHIVES, incoming), path.join(root, ARCHIVES, incoming), { recursive: true });
    assert.deepEqual(storeList(root, STORE, options), [first, second]);
    assert.equal(storeReadFile(root, second, options).toString(), 'second');
    fs.rmSync(path.join(root, ARCHIVES, incoming), { recursive: true });
    assert.equal(storeExists(root, second, options), false);
    const existing = fs.readdirSync(path.join(root, ARCHIVES))[0];
    put(root, `${ARCHIVES}/${existing}/unexpected`, 'changed membership');
    assert.throws(() => storeReadFile(root, first, options), { code: 'ARCHIVE_CORRUPT' });
  });
});

test('a query rejects changed backing at exit even when there is no subsequent lookup', t => {
  const root = fixture(t), target = ref('old'); put(root, target, 'original'); compact(root);
  const pack = path.join(root, archiveInventory(root).archives[0].physical_files.find(f => f.kind === 'pack').ref);
  assert.throws(() => withStoreReadContext(root, readContext => {
    assert.equal(storeReadFile(root, target, { readContext }).toString(), 'original');
    fs.truncateSync(pack, 9);
    return 'must not return stale success';
  }), { code: 'SOURCE_CHANGED' });
});

test('loose duplicates and mutable files are checked afresh within a reused catalog', t => {
  const root = fixture(t), target = ref('old'), mutable = `${STORE}/task-view.json`;
  put(root, target, 'original'); archiveCommand(root, { action: 'create' }); put(root, mutable, 'before');
  withStoreReadContext(root, readContext => {
    const options = { readContext }; storeList(root, STORE, options);
    assert.equal(storeReadFile(root, mutable, options).toString(), 'before');
    put(root, mutable, 'after'); assert.equal(storeReadFile(root, mutable, options).toString(), 'after');
    put(root, target, 'tampered');
    assert.throws(() => storeReadFile(root, target, options), { code: 'ARCHIVE_COLLISION' });
    assert.throws(() => storeRead(root, target, { ...options, hashLoose: false, length: 8 }), { code: 'ARCHIVE_COLLISION' });
    put(root, target, 'wrong-length');
    assert.throws(() => storeStat(root, target, { ...options, hashLoose: false }), { code: 'ARCHIVE_COLLISION' });
  });
});

test('storage mutations invalidate active queries and never use a cached graph for authorization', async t => {
  const root = fixture(t), target = ref('old'), next = ref('next'), { storage: s, counts } = await instrument(t);
  put(root, target, 'original'); compact(root);
  s.withStoreReadContext(root, readContext => {
    const options = { readContext }; s.storeList(root, STORE, options); assert.equal(counts.entries, 1);
    assert.equal(s.storeReserve(root, next, 'new'), true);
    const afterMutation = counts.entries;
    assert.deepEqual(s.storeList(root, STORE, options), [next, target]);
    assert.equal(counts.entries, afterMutation + 1, 'even an unrelated loose publication invalidates the graph');
    s.archiveCommand(root, { action: 'create' });
    for (const action of ['quarantine', 'reclaim', 'restore']) {
      s.archiveCommand(root, { action });
      assert.equal(s.storeReadFile(root, target, options).toString(), 'original');
      assert.equal(s.storeReadFile(root, next, options).toString(), 'new');
    }
  });
  const index = path.join(root, archiveInventory(root).archives[0].physical_files.find(f => f.kind === 'index').ref);
  withStoreReadContext(root, readContext => {
    storeList(root, STORE, { readContext }); fs.writeFileSync(index, 'corrupt'); put(root, `${STORE}/capture.tmp`, 'original');
    for (const mutate of [() => storeReserve(root, target, 'new'), () => storeAppend(root, target, 'original'),
      () => storePublishFile(root, target, `${STORE}/capture.tmp`, sha('original'), 8),
      () => archiveCommand(root, { action: 'quarantine' }), () => archiveCommand(root, { action: 'reclaim' })]) assert.throws(mutate);
  });
});

test('contexts are root-bound, released on success or failure, and reject asynchronous retention', t => {
  const root = fixture(t), other = fixture(t), target = ref('old'); put(root, target, 'first'); put(other, target, 'second');
  let escaped;
  withStoreReadContext(root, readContext => {
    escaped = readContext; assert.equal(storeReadFile(root, target, { readContext }).toString(), 'first');
    assert.throws(() => storeReadFile(other, target, { readContext }), { code: 'INVALID_READ_CONTEXT' });
    assert.throws(() => storeReadFile(other, 'ordinary.txt', { readContext }), { code: 'INVALID_READ_CONTEXT' });
    withStoreReadContext(other, nested => assert.equal(storeReadFile(other, target, { readContext: nested }).toString(), 'second'));
  });
  assert.throws(() => storeList(root, STORE, { readContext: escaped }), { code: 'INVALID_READ_CONTEXT' });
  const sentinel = new Error('callback failed');
  assert.throws(() => withStoreReadContext(root, readContext => { escaped = readContext; throw sentinel; }), sentinel);
  assert.throws(() => storeReadFile(root, target, { readContext: escaped }), { code: 'INVALID_READ_CONTEXT' });
  assert.throws(() => withStoreReadContext(root, () => Promise.resolve()), { code: 'INVALID_READ_CONTEXT' });
});
