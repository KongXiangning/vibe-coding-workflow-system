import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_LIMITS, storeRead, storeReadFile, storeStat, storeExists, storeList,
  storeAppend, storeReserve, storePublishFile, archiveCommand, archiveInventory } from '../runtime/vnext/support/record-storage.mjs';

const STORE = '.workflow-system/records';
const runtime = fileURLToPath(new URL('../runtime/vnext/support/record-storage.mjs', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const ref = name => `${STORE}/events/${name}.json`;
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-storage-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function put(root, ref, bytes) { fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), bytes); }
function create(root, refs) { return archiveCommand(root, { action: 'create', ...(refs ? { refs } : {}) }); }
function archive(root) { return archiveInventory(root).archives[0]; }
function files(root) { let count = 0, size = 0; function visit(p) { const s = fs.statSync(p); if (s.isFile()) { count++; size += s.size; } else for (const n of fs.readdirSync(p)) visit(path.join(p, n)); } visit(root); return { count, size }; }

test('loose + archive logical paths preserve exact bytes, identifiers, and excluded mutable captures', t => {
  const root = fixture(t), original = Buffer.from('{\r\n  "id": "old-observation", "result":"failed"\r\n}\r\n');
  const object = Buffer.from([0, 255, 0, 1, 128]), objectRef = `${STORE}/evidence-objects/${sha(object)}.blob`;
  const legacy = Buffer.from('---\r\nold CURRENT_TASK\r\n'), legacyRef = `${STORE}/legacy/current-${sha(legacy)}.md`;
  const eligible = [ref('old'), `${STORE}/attachments/old.json`, `${STORE}/task-labels/one.json`, objectRef, legacyRef, `${STORE}/legacy/baseline.json`];
  for (const target of eligible) put(root, target, target === objectRef ? object : target === legacyRef ? legacy : original);
  const excluded = [`${STORE}/task-view.json`, `${STORE}/task-views/view.json`, `${STORE}/legacy/display-crash.md`, `${STORE}/other/archive.json`];
  for (const target of excluded) put(root, target, 'live capture must remain untouched');
  assert.equal(archiveCommand(root, { action: 'plan' }).count, 6);
  const created = create(root); assert.equal(created.archived, 6); assert.equal(created.originals_retained, true);
  assert.ok(eligible.every(target => fs.existsSync(path.join(root, target))));
  assert.equal(archiveCommand(root, { action: 'quarantine' }).quarantined, 6);
  for (const target of excluded) assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'live capture must remain untouched');
  assert.deepEqual(storeReadFile(root, ref('old')), original); assert.deepEqual(storeReadFile(root, objectRef), object);
  assert.deepEqual(storeReadFile(root, legacyRef), legacy);
  assert.deepEqual(storeList(root, STORE), [...eligible, ...excluded].sort());
  assert.equal(storeStat(root, ref('old')).sha256, sha(original));
  assert.equal(storeExists(root, ref('old')), true); assert.equal(storeExists(root, ref('missing')), false);
  assert.equal(create(root).status, 'nothing-to-archive');
  assert.equal(archiveCommand(root, { action: 'restore' }).restored, 6);
  assert.deepEqual(fs.readFileSync(path.join(root, ref('old'))), original);
  assert.equal(archiveCommand(root, { action: 'restore' }).restored, 0);
});

test('append is strict byte-idempotent, while reservation preserves existing loose/archived ids', t => {
  const root = fixture(t), target = ref('reserved');
  assert.deepEqual(storeAppend(root, target, 'original'), { created: true });
  assert.deepEqual(storeAppend(root, target, Buffer.from('original')), { created: false });
  assert.throws(() => storeAppend(root, target, 'different'), { code: 'APPEND_CONFLICT' });
  assert.equal(storeReserve(root, target, 'different'), false);
  create(root); archiveCommand(root, { action: 'quarantine' });
  assert.equal(storeReserve(root, target, 'different'), false);
  assert.deepEqual(storeAppend(root, target, 'original'), { created: false });
  assert.throws(() => storeAppend(root, target, 'different'), { code: 'APPEND_CONFLICT' });
  assert.equal(fs.existsSync(path.join(root, target)), false);
  put(root, `${STORE}/capture.tmp`, 'original');
  assert.equal(storePublishFile(root, target, `${STORE}/capture.tmp`, sha('original'), 8), false);
  assert.equal(storePublishFile(root, ref('new'), `${STORE}/capture.tmp`, sha('original'), 8), true);
  put(root, ref('malformed'), '{broken');
  assert.equal(storeReserve(root, ref('malformed'), 'new observation'), false);
});

test('64KiB independent chunks support bounded pages across a multi-pack giant blob', t => {
  const root = fixture(t), source = `${STORE}/evidence-objects/source.tmp`, block = randomBytes(65536), h = createHash('sha256');
  put(root, source, ''); const fd = fs.openSync(path.join(root, source), 'w');
  const blocks = 1025;
  try { for (let i = 0; i < blocks; i++) { fs.writeSync(fd, block); h.update(block); } } finally { fs.closeSync(fd); }
  const digest = h.digest('hex'), target = `${STORE}/evidence-objects/${digest}.blob`;
  fs.renameSync(path.join(root, source), path.join(root, target));
  const created = create(root); assert.equal(created.inventory.archives[0].physical_files.filter(f => f.kind === 'pack').length, 2);
  archiveCommand(root, { action: 'quarantine' });
  const offset = 64 * 1024 * 1024 - 8;
  const page = storeRead(root, target, { offset, length: 19, expectedSha256: digest });
  assert.deepEqual(page.bytes, Buffer.concat([block.subarray(block.length - 8), block.subarray(0, 11)]));
  assert.equal(page.metrics.chunks_read, 2); assert.equal(page.metrics.decompressed_bytes, 131072);
  assert.ok(page.metrics.compressed_bytes_read <= 2 * (65536 + 1024));
  assert.equal(page.verification, 'indexed-selected-chunks');
  assert.equal(page.size, 65536 * blocks);
  assert.throws(() => storeReadFile(root, target), { code: 'READ_TOO_LARGE' });
  assert.throws(() => storeRead(root, target, { offset: -1 }), { code: 'INVALID_RANGE' });
  assert.throws(() => storeRead(root, target, { length: ARCHIVE_LIMITS.readBytes + 1 }), { code: 'INVALID_RANGE' });
  assert.throws(() => storeRead(root, target, { expectedSha256: '0'.repeat(64) }), { code: 'OBJECT_CORRUPT' });
});

test('cold lookup routes to the matching bounded index instead of scanning all payload indices', t => {
  const root = fixture(t);
  for (let i = 0; i < 2050; i++) put(root, ref(String(i).padStart(5, '0')), `{"id":${i}}`);
  create(root); archiveCommand(root, { action: 'quarantine' });
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {storeRead} from ${JSON.stringify(new URL(`file://${runtime}`).href)}; console.log(JSON.stringify(storeRead(${JSON.stringify(root)},${JSON.stringify(ref('02049'))},{length:32})));`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const page = JSON.parse(result.stdout);
  assert.equal(page.metrics.manifests_read, 1); assert.equal(page.metrics.indices_read, 1);
  assert.ok(page.metrics.metadata_bytes_read < 8192, JSON.stringify(page.metrics));
  assert.equal(page.metrics.chunks_read, 1);
});

for (const corruption of ['manifest-missing', 'index-missing', 'pack-missing', 'manifest-changed', 'index-changed', 'pack-truncated', 'pack-payload']) {
  test(`archives fail closed for ${corruption}, even while an original loose copy exists`, t => {
    const root = fixture(t), target = ref('old'); put(root, target, 'original bytes'); create(root);
    const a = archive(root), manifest = a.physical_files.find(f => f.kind === 'manifest'), index = a.physical_files.find(f => f.kind === 'index'), pack = a.physical_files.find(f => f.kind === 'pack');
    const file = x => path.join(root, x.ref);
    if (corruption.endsWith('-missing')) fs.unlinkSync(file(corruption.startsWith('manifest') ? manifest : corruption.startsWith('index') ? index : pack));
    else if (corruption === 'pack-truncated') fs.truncateSync(file(pack), pack.size - 1);
    else { const f = corruption.startsWith('manifest') ? manifest : corruption.startsWith('index') ? index : pack, bytes = fs.readFileSync(file(f)); bytes[bytes.length - 2] ^= 1; fs.writeFileSync(file(f), bytes); }
    assert.throws(() => storeReadFile(root, target));
    assert.throws(() => archiveCommand(root, { action: 'verify' }));
    if (corruption !== 'pack-payload') assert.throws(() => storeList(root, STORE));
    if (corruption !== 'pack-payload') assert.throws(() => storeExists(root, target));
    assert.throws(() => storeAppend(root, target, 'original bytes'));
    assert.deepEqual(fs.readFileSync(path.join(root, target)), Buffer.from('original bytes'));
  });
}

test('loose/archive collisions prevent reads, enumeration, reservations, cleanup and restore', t => {
  const root = fixture(t), target = ref('old'); put(root, target, 'original'); create(root); put(root, target, 'tampered');
  for (const action of [() => storeReadFile(root, target), () => storeList(root, STORE), () => storeReserve(root, target, 'third'),
    () => archiveCommand(root, { action: 'quarantine' }), () => archiveCommand(root, { action: 'restore' })]) assert.throws(action, { code: 'ARCHIVE_COLLISION' });
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'tampered');
});

test('traversal, symlinked paths, non-eligible records, and content-address substitutions are rejected', t => {
  const root = fixture(t), outside = fixture(t);
  for (const target of ['../outside', '.git/config', 'docs/../escape', 'C:/escape']) assert.throws(() => storeAppend(root, target, 'x'), { code: 'UNSAFE_PATH' });
  fs.symlinkSync(outside, path.join(root, 'linked'));
  assert.throws(() => storeAppend(root, 'linked/escape', 'x'), { code: 'UNSAFE_PATH' });
  put(root, 'ordinary.txt', 'ordinary'); assert.equal(storeReadFile(root, path.join(root, 'ordinary.txt')).toString(), 'ordinary');
  assert.equal(storeReadFile(root, './ordinary.txt').toString(), 'ordinary');
  assert.throws(() => create(root, ['ordinary.txt']));
  put(root, `${STORE}/evidence-objects/${'0'.repeat(64)}.blob`, 'not its digest');
  assert.throws(() => create(root), { code: 'OBJECT_CORRUPT' });
});

function hostileArchive(root, { raw, claimedSize = 1, target = ref('hostile'), manifestBytes = 0 }) {
  const compressed = deflateRawSync(raw), recordSha = sha(Buffer.from('x'));
  const header = json({ ref: target, size: claimedSize, record_sha256: recordSha, rawOffset: 0, rawLength: claimedSize,
    length: compressed.length, sha256: recordSha, compressedSha256: sha(compressed) });
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
  const pack = Buffer.concat([Buffer.from('WFRPACK1\n'), prefix, header, compressed]);
  const index = json({ version: 1, pack: { ref: 'pack-000000.bin', size: pack.length, sha256: sha(pack) }, records: [{ ref: target, size: claimedSize,
    sha256: recordSha, chunks: [{ offset: 9, length: compressed.length, headerLength: header.length, rawOffset: 0, rawLength: claimedSize,
      sha256: recordSha, compressedSha256: sha(compressed) }] }] });
  let manifest = json({ version: 1, format: 'workflow-record-archive', chunk_size: 65536,
    segments: [{ index: 'index-000000.json', size: index.length, sha256: sha(index), pack: 'pack-000000.bin', pack_size: pack.length,
      pack_sha256: sha(pack), first_ref: target, last_ref: target }] });
  if (manifestBytes) manifest = Buffer.concat([manifest, Buffer.alloc(manifestBytes - manifest.length, 32)]);
  const base = `${STORE}/archives/${sha(manifest)}`;
  for (const [name, bytes] of [['manifest.json', manifest], ['index-000000.json', index], ['pack-000000.bin', pack]]) put(root, `${base}/${name}`, bytes);
}

test('compressed bombs and hostile archive paths fail before unbounded allocation or escape', t => {
  const root = fixture(t); hostileArchive(root, { raw: Buffer.alloc(2 * 1024 * 1024, 120) });
  assert.throws(() => storeRead(root, ref('hostile'), { length: 1 }), { code: 'ARCHIVE_CORRUPT' });
  const other = fixture(t); hostileArchive(other, { raw: Buffer.from('x'), target: `${STORE}/events/../../outside.json` });
  assert.throws(() => storeRead(other, ref('hostile'), { length: 1 }), { code: 'UNSAFE_PATH' });
});

test('empty archived objects receive payload verification and whole-file digest validation', t => {
  const root = fixture(t), target = `${STORE}/evidence-objects/${sha(Buffer.alloc(0))}.blob`; put(root, target, ''); create(root);
  archiveCommand(root, { action: 'quarantine' }); assert.deepEqual(storeReadFile(root, target), Buffer.alloc(0));
  assert.equal(storeRead(root, target, { length: 0 }).metrics.chunks_read, 1);
});

test('interrupted staging and quarantine operations resume without touching current captures', t => {
  const root = fixture(t), target = ref('old'); put(root, target, 'original');
  put(root, `${STORE}/.archive-staging/interrupted/pack-000000.bin`, 'unfinished');
  put(root, `${STORE}/legacy/display-interrupted.md`, 'capture');
  const created = create(root), id = created.archive_ids[0];
  const destination = `${STORE}/archive-quarantine/${id}/events/old.json`;
  put(root, `${STORE}/archive-quarantine/${id}/quarantine.json`, json({ version: 1, archiveId: id }));
  fs.mkdirSync(path.dirname(path.join(root, destination)), { recursive: true }); fs.linkSync(path.join(root, target), path.join(root, destination));
  assert.equal(archiveCommand(root, { action: 'quarantine' }).quarantined, 1);
  assert.equal(archiveCommand(root, { action: 'quarantine' }).quarantined, 0);
  assert.equal(archiveInventory(root, { verify: true }).quarantined.length, 1);
  assert.equal(storeReadFile(root, target).toString(), 'original');
  assert.equal(fs.readFileSync(path.join(root, `${STORE}/legacy/display-interrupted.md`), 'utf8'), 'capture');
});

test('explicit reclamation reduces physical files and bytes, with receipts and exact restore', t => {
  const root = fixture(t), originals = new Map();
  for (let i = 0; i < 40; i++) { const target = ref(`record-${i}`), bytes = Buffer.from(`original-${i}\r\n${'A'.repeat(8192)}`); originals.set(target, bytes); put(root, target, bytes); }
  const before = files(root); create(root);
  assert.throws(() => archiveCommand(root, { action: 'reclaim' }), { code: 'QUARANTINE_REQUIRED' });
  archiveCommand(root, { action: 'quarantine' });
  assert.ok(files(root).count > before.count, 'quarantine alone is not net file reduction');
  const reclaimed = archiveCommand(root, { action: 'reclaim' }); assert.equal(reclaimed.reclaimed, 40);
  assert.ok(files(root).count < before.count); assert.ok(files(root).size < before.size);
  assert.equal(archiveInventory(root, { verify: true }).quarantined.filter(p => p.reclaimed).length, 40);
  assert.equal(archiveCommand(root, { action: 'reclaim' }).reclaimed, 0);
  assert.equal(archiveCommand(root, { action: 'restore' }).restored, 40);
  for (const [target, bytes] of originals) assert.deepEqual(fs.readFileSync(path.join(root, target)), bytes);
});

test('locks return honest busy, require explicit proven-dead recovery, and never steal by age', t => {
  const root = fixture(t), lock = `${STORE}/.record-store-locks/store.lock`;
  put(root, lock, json({ pid: process.pid, host: os.hostname(), id: 'live-owner' }));
  fs.utimesSync(path.join(root, lock), new Date(0), new Date(0));
  assert.throws(() => storeReserve(root, ref('new'), 'x'), { code: 'STORE_BUSY' });
  assert.throws(() => archiveCommand(root, { action: 'recover-lock' }), { code: 'STORE_BUSY' });
  assert.equal(storeExists(root, ref('new')), false);
  put(root, lock, json({ pid: 2147483647, host: os.hostname(), id: 'dead-owner' }));
  assert.throws(() => storeReserve(root, ref('new'), 'x'), { code: 'STORE_BUSY' });
  assert.equal(archiveCommand(root, { action: 'recover-lock', owner_id: 'dead-owner' }).status, 'recovered');
  assert.equal(storeReserve(root, ref('new'), 'x'), true);
  assert.equal(storeReserve(root, ref('new'), 'y'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, lock))).id, 'dead-owner');
});

test('concurrent reservations cannot overwrite or reuse the same logical id', async t => {
  const root = fixture(t), target = ref('one');
  const run = value => new Promise((resolve, reject) => {
    const code = `import {storeReserve} from ${JSON.stringify(new URL(`file://${runtime}`).href)}; try { console.log(JSON.stringify({created:storeReserve(${JSON.stringify(root)},${JSON.stringify(target)},${JSON.stringify(value)})})); } catch(e) {console.log(JSON.stringify({code:e.code}));}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code]); let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b); child.on('error', reject);
    child.on('close', status => status ? reject(new Error(stderr)) : resolve(JSON.parse(stdout)));
  });
  const results = await Promise.all([run('first'), run('second'), run('third')]);
  assert.equal(results.filter(r => r.created).length, 1);
  assert.ok(results.every(r => r.created === true || r.created === false || r.code === 'STORE_BUSY'));
  const bytes = fs.readFileSync(path.join(root, target), 'utf8'); assert.ok(['first', 'second', 'third'].includes(bytes));
  create(root); archiveCommand(root, { action: 'quarantine' });
  const later = await Promise.all([run('later-1'), run('later-2')]);
  assert.ok(later.every(r => r.created === false || r.code === 'STORE_BUSY'));
  assert.equal(storeReadFile(root, target).toString(), bytes);
});

test('bounded loose range mode reads only requested bytes and never silently hashes duplicate blobs', t => {
  const root = fixture(t), target = ref('large'); put(root, target, Buffer.alloc(8 * 1024 * 1024, 120));
  const code = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    let bytes=0; const original=fs.readSync; fs.readSync=(...args)=>{ const n=original(...args); bytes+=n; return n; }; syncBuiltinESMExports();
    const {storeStat,storeRead}=await import(${JSON.stringify(new URL(`file://${runtime}`).href)});
    bytes=0; const root=${JSON.stringify(root)}, ref=${JSON.stringify(target)};
    const stat=storeStat(root,ref,{hashLoose:false}), page=storeRead(root,ref,{hashLoose:false,offset:123,length:1});
    console.log(JSON.stringify({bytes,size:stat.size,verification:page.verification,metrics:page.metrics}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout);
  assert.equal(result.bytes, 1); assert.equal(result.size, 8 * 1024 * 1024); assert.equal(result.metrics.loose_bytes_hashed, 0);
  assert.equal(result.verification, 'file-range');
  create(root);
  assert.equal(storeStat(root, target, { hashLoose: false }).duplicate_verification, 'metadata-only');
  assert.ok(storeList(root, STORE, { hashLoose: false }).includes(target));
  const duplicatePage = storeRead(root, target, { hashLoose: false, length: 1 });
  assert.equal(duplicatePage.duplicate_verification, 'selected-range-only');
  assert.equal(duplicatePage.metrics.loose_bytes_read, 1); assert.equal(duplicatePage.metrics.loose_bytes_hashed, 0);
  assert.equal(duplicatePage.metrics.decompressed_bytes, 65536);
  assert.equal(storeRead(root, target, { hashLoose: false, length: 1, expectedSha256: sha(Buffer.alloc(8 * 1024 * 1024, 120)) }).metrics.loose_bytes_hashed, 8 * 1024 * 1024);
  const fd = fs.openSync(path.join(root, target), 'r+'); fs.writeSync(fd, Buffer.from('z'), 0, 1, 0); fs.closeSync(fd);
  assert.throws(() => storeRead(root, target, { hashLoose: false, length: 1 }), { code: 'ARCHIVE_COLLISION' });
  assert.throws(() => storeReadFile(root, target), { code: 'ARCHIVE_COLLISION' });
});

test('multiple archives use bounded manifest routing on a cold CLI', t => {
  const root = fixture(t);
  for (const name of ['a', 'b', 'c', 'd']) { put(root, ref(name), `old-${name}`); create(root, [ref(name)]); }
  archiveCommand(root, { action: 'quarantine' });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {storeRead} from ${JSON.stringify(new URL(`file://${runtime}`).href)};
    console.log(JSON.stringify(storeRead(${JSON.stringify(root)},${JSON.stringify(ref('c'))},{length:1}).metrics));`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout);
  assert.equal(result.manifests_read, 4); assert.equal(result.indices_read, 1); assert.equal(result.chunks_read, 1);
  assert.ok(result.metadata_bytes_read < 8192);
});

test('a process exiting at activation leaves no partial logical archive and requires explicit lock recovery', t => {
  const root = fixture(t), target = ref('old'); put(root, target, 'original');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    fs.renameSync=()=>process.exit(42); syncBuiltinESMExports();
    const {archiveCommand}=await import(${JSON.stringify(new URL(`file://${runtime}`).href)}); archiveCommand(${JSON.stringify(root)},{action:'create'});`], { encoding: 'utf8' });
  assert.equal(child.status, 42, child.stderr);
  assert.equal(storeReadFile(root, target).toString(), 'original'); assert.equal(archiveInventory(root).archives.length, 0);
  assert.throws(() => storeReserve(root, ref('new'), 'new'), { code: 'STORE_BUSY' });
  assert.equal(archiveCommand(root, { action: 'recover-lock' }).status, 'recovered');
  assert.equal(create(root).archived, 1); assert.equal(storeReadFile(root, target).toString(), 'original');
});

test('independent processes racing quarantine/reclaim with append never reuse archived identities', async t => {
  const root = fixture(t), target = ref('same'); put(root, target, Buffer.alloc(1024 * 1024, 120));
  for (let i = 0; i < 30; i++) put(root, ref(`other-${i}`), Buffer.alloc(32768, 120));
  create(root);
  const run = expression => new Promise((resolve, reject) => {
    const code = `import {archiveCommand,storeAppend,storeReserve} from ${JSON.stringify(new URL(`file://${runtime}`).href)};
      const root=${JSON.stringify(root)}, target=${JSON.stringify(target)};
      try { console.log(JSON.stringify({result:${expression}})); } catch(e) { console.log(JSON.stringify({code:e.code})); }`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code]); let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b); child.on('error', reject);
    child.on('close', status => status ? reject(new Error(stderr)) : resolve(JSON.parse(stdout)));
  });
  const first = await Promise.all([run("archiveCommand(root,{action:'quarantine'}).status"), run("storeAppend(root,target,'new bytes')"), run("storeReserve(root,target,'other bytes')")]);
  assert.ok(first.every(r => r.result === 'quarantined' || r.result === false || ['STORE_BUSY', 'APPEND_CONFLICT'].includes(r.code)));
  archiveCommand(root, { action: 'quarantine' });
  const second = await Promise.all([run("archiveCommand(root,{action:'reclaim'}).status"), run("storeAppend(root,target,'replacement')"), run("storeReserve(root,target,'reused')")]);
  assert.ok(second.every(r => r.result === 'reclaimed' || r.result === false || ['STORE_BUSY', 'APPEND_CONFLICT'].includes(r.code)));
  archiveCommand(root, { action: 'reclaim' });
  assert.equal(fs.existsSync(path.join(root, target)), false);
  assert.deepEqual(storeReadFile(root, target), Buffer.alloc(1024 * 1024, 120));
  assert.equal(archiveInventory(root, { verify: true }).records.length, 31);
});

test('archive-count exhaustion is refused before activation and leaves the old store readable', t => {
  const root = fixture(t);
  for (let i = 0; i < ARCHIVE_LIMITS.archiveCount; i++) hostileArchive(root, { raw: Buffer.from('x'), target: ref(`existing-${i}`) });
  const target = ref('new'); put(root, target, 'new original');
  assert.throws(() => create(root), { code: 'ARCHIVE_CATALOG_LIMIT' });
  assert.equal(fs.readdirSync(path.join(root, `${STORE}/archives`)).length, ARCHIVE_LIMITS.archiveCount);
  assert.equal(storeReadFile(root, ref('existing-0')).toString(), 'x');
  assert.equal(storeReadFile(root, target).toString(), 'new original');
});

test('aggregate metadata exhaustion is refused before activation without damaging readable archives', t => {
  const root = fixture(t);
  for (let i = 0; i < 4; i++) hostileArchive(root, { raw: Buffer.from('x'), target: ref(`existing-${i}`), manifestBytes: ARCHIVE_LIMITS.manifestBytes - 1024 });
  const target = ref('new'); put(root, target, Buffer.alloc(1024 * 1024, 120));
  assert.equal(archiveInventory(root, { verify: true }).archives.length, 4);
  assert.throws(() => create(root), { code: 'ARCHIVE_CATALOG_LIMIT' });
  assert.equal(fs.readdirSync(path.join(root, `${STORE}/archives`)).length, 4);
  assert.equal(storeReadFile(root, ref('existing-0')).toString(), 'x');
  assert.equal(storeReadFile(root, target).length, 1024 * 1024);
});

test('an uncooperative file publication race cannot turn a different-byte append into idempotent success', t => {
  const root = fixture(t), target = ref('external-race');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const target=${JSON.stringify(path.join(root, target))}, original=fs.linkSync;
    fs.linkSync=(source,destination)=>{ if(destination===target && !fs.existsSync(target)) fs.writeFileSync(target,'external bytes'); return original(source,destination); }; syncBuiltinESMExports();
    const {storeAppend}=await import(${JSON.stringify(new URL(`file://${runtime}`).href)});
    try { console.log(JSON.stringify(storeAppend(${JSON.stringify(root)},${JSON.stringify(target)},'requested bytes'))); }
    catch(e) {console.log(JSON.stringify({code:e.code}));}`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).code, 'APPEND_CONFLICT');
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'external bytes');
});
