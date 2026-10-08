import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { task, taskStatus, queryStatus, record, read, archive } from '../runtime/vnext/support/assistance.mjs';
import { storeReadFile, storeList } from '../runtime/vnext/support/record-storage.mjs';
import { encodeTaskPayload, decodeObservation } from '../runtime/vnext/support/task-event-codec.mjs';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const prefix = '.workflow-system/records';
const envelope = payload => ({ schema_version: 1, kind: 'workflow-observation', recorded_at: '2025-01-01T00:00:00.000Z',
  assurance: 'caller-reported', payload_sha256: hash(payload), payload, issues: [] });
const row = (root, ref) => JSON.parse(storeReadFile(root, ref));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-task-codec-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/workflow'), { recursive: true });
  return root;
}
function active(root, title = 'Report preservation') {
  const plan = task(root, { action: 'prepare', title, steps: [{ id: 'S1', title: 'Run checks' }] });
  task(root, { action: 'adopt', task_id: plan.task_id, plan_ref: plan.ref, focus: true });
  return plan;
}
function payload(report = 'long unique report 漢字 🧪 '.repeat(1200)) {
  const request = { action: 'execution', idempotency_key: 'report', result: 'failed', report };
  return { kind: 'task-event', idempotency_key: 'task:report', request,
    task_event: { version: 1, action: 'execution', task_id: 'task-one', parents: ['original-parent'],
      data: { result: 'failed', report, plan_ref: 'original-plan', step_id: 'S1' } } };
}

test('only complete equal request subtrees are replaced, including nested, moved and escaped JSON keys', () => {
  const report = `unique-unicode-body-末尾 ${'漢字 🧪\r\n'.repeat(12000)}`;
  const unique = randomBytes(180000).toString('base64');
  const input = payload({ nested: [{ text: report, unique }], 'a/b~c': { text: 'literal-path-key'.repeat(1200) } });
  input.request.dependency = { state: 'unresolved', summary: 'dependency-summary'.repeat(1000), ref: 'caller-ref' };
  input.task_event.data.dependency = { state: 'unresolved', summary: input.request.dependency.summary, derived: true };
  input.task_event.data.derived_extra = 'unique-generated-body'.repeat(1000);
  const encoded = encodeTaskPayload(input), wire = envelope(encoded), bytes = Buffer.from(json(wire));
  assert.equal(encoded.task_event.version, 2);
  assert.equal(encoded.task_event.data.result, 'failed', 'small scalar fields remain directly readable');
  assert.deepEqual(encoded.request, input.request);
  assert.equal(bytes.toString().split('unique-unicode-body-末尾').length - 1, 1);
  assert.equal(bytes.toString().split(unique).length - 1, 1);
  assert.ok(bytes.length < Buffer.byteLength(json(envelope(input))) * 0.65);
  const decoded = decodeObservation(wire);
  assert.deepEqual(decoded.payload, input);
  assert.equal(decoded.wire_payload_sha256, hash(encoded));
  assert.equal(decoded.logical_payload_sha256, hash(input));
  assert.notEqual(decoded.wire_payload_sha256, decoded.logical_payload_sha256);
  assert.equal(decoded.request_sha256, hash(input.request));
  assert.equal(encoded.task_event.data.report, null, 'decoding never mutates stored-wire input');
  assert.equal(decodeObservation(envelope(input)).encoded, false);
});

test('small reports retain v1 when reference metadata would not reduce complete wire bytes', () => {
  const input = payload('small failure retained');
  assert.equal(encodeTaskPayload(input), input);
  const marginal = payload('x'.repeat(256));
  assert.equal(encodeTaskPayload(marginal).task_event.version, 1);
});

test('generated tasks store Unicode report once and expose full logical query/read data without changing raw bytes', t => {
  const root = fixture(t), prepared = active(root);
  const report = { log: `run-1-marker ${'异常 🧪\r\n'.repeat(8000)}`, metadata: { state: 'before', failures: [1, 2] } };
  const request = { action: 'execution', idempotency_key: 'generated-run', result: 'failed', report };
  const saved = task(root, request), stored = storeReadFile(root, saved.ref), wire = row(root, saved.ref);
  assert.equal(saved.association, 'applied');
  assert.equal(wire.payload.task_event.version, 2);
  assert.equal(stored.toString().split('run-1-marker').length - 1, 1);
  assert.deepEqual(wire.payload.request, request);
  assert.deepEqual(taskStatus(root).current_task.steps[0].execution.report, report);
  assert.deepEqual(queryStatus(root, { detail: 'task', task_ref: prepared.task_id }).task.steps[0].execution.report, report);
  const logical = read(root, { ref: saved.ref, format: 'logical-task-event' });
  assert.equal(logical.payload.task_event.version, 1);
  assert.equal(logical.payload.task_event.data.plan_ref, prepared.ref);
  assert.deepEqual(logical.payload.task_event.data.report, report);
  assert.equal(logical.wire_sha256, hash(stored));
  const pages = []; let offset = 0;
  do { const page = read(root, { ref: saved.ref, offset, max_bytes: 997 }); pages.push(Buffer.from(page.data, 'base64')); offset = page.next_offset; } while (offset !== null);
  assert.deepEqual(Buffer.concat(pages), stored);
  assert.throws(() => read(root, { ref: saved.ref, format: 'logical-task-event', max_bytes: 500 }), { code: 'TASK_EVENT_EXPANSION_LIMIT' });
  assert.throws(() => read(root, { ref: saved.ref, format: 'logical-task-event', offset: 1 }), { code: 'TASK_EVENT_READ_OPTIONS' });
  const changedHeads = active(root, 'Another focus');
  const before = storeList(root, `${prefix}/events`);
  const replay = task(root, request);
  assert.equal(replay.ref, saved.ref);
  assert.equal(replay.task_id, prepared.task_id);
  assert.equal(replay.current_task_id, changedHeads.task_id);
  assert.deepEqual(storeList(root, `${prefix}/events`), before);
  assert.deepEqual(storeReadFile(root, saved.ref), stored);
  const conflict = task(root, { ...request, report: { ...report, metadata: { state: 'after', failures: [3] } } });
  assert.notEqual(conflict.ref, saved.ref);
  assert.ok(conflict.issues.some(issue => issue.code === 'IDEMPOTENCY_CONFLICT_RETAINED'));
  assert.deepEqual(row(root, conflict.ref).payload.request.report.metadata, { state: 'after', failures: [3] });
  assert.deepEqual(storeReadFile(root, saved.ref), stored);
});

test('old v1 event bytes, request identity and first association survive focus changes and archive reclamation', t => {
  const root = fixture(t), prepared = active(root), report = 'old-v1-unique-report '.repeat(1500);
  const request = { action: 'execution', idempotency_key: 'old-execution', result: 'failed', report };
  const oldPayload = { kind: 'task-event', idempotency_key: 'task:old-execution', request,
    task_event: { version: 1, action: 'execution', task_id: prepared.task_id, parents: taskStatus(root).heads,
      data: { result: 'failed', report, plan_ref: prepared.ref, step_id: 'S1' } } };
  const ref = `${prefix}/events/key-${hash(oldPayload.idempotency_key)}.json`, bytes = Buffer.from(json(envelope(oldPayload)));
  fs.writeFileSync(path.join(root, ref), bytes);
  const other = active(root, 'Changed focus');
  for (const action of ['create', 'verify', 'quarantine', 'reclaim']) archive(root, { action });
  assert.equal(fs.existsSync(path.join(root, ref)), false);
  const count = storeList(root, `${prefix}/events`).length, replay = task(root, request);
  assert.equal(replay.ref, ref);
  assert.equal(replay.task_id, prepared.task_id);
  assert.equal(replay.current_task_id, other.task_id);
  assert.equal(storeList(root, `${prefix}/events`).length, count);
  assert.deepEqual(storeReadFile(root, ref), bytes);
  assert.equal(row(root, ref).payload.task_event.version, 1);
  assert.equal(read(root, { ref, format: 'logical-task-event' }).payload.task_event.data.report, report);
});

test('archive create/reclaim/restore preserves encoded report bodies and full task state without an external body dependency', t => {
  const root = fixture(t); active(root);
  const request = { action: 'test', idempotency_key: 'archive-run', result: 'failed', report: { unique: randomBytes(220000).toString('base64') } };
  const saved = task(root, request), bytes = storeReadFile(root, saved.ref), state = taskStatus(root);
  assert.equal(row(root, saved.ref).payload.task_event.version, 2);
  for (const action of ['create', 'verify', 'quarantine', 'reclaim']) archive(root, { action });
  assert.equal(fs.existsSync(path.join(root, saved.ref)), false);
  assert.deepEqual(storeReadFile(root, saved.ref), bytes);
  assert.deepEqual(taskStatus(root), state);
  assert.deepEqual(read(root, { ref: saved.ref, format: 'logical-task-event' }).payload.task_event.data.report, request.report);
  assert.equal(task(root, request).ref, saved.ref);
  archive(root, { action: 'restore' });
  assert.deepEqual(fs.readFileSync(path.join(root, saved.ref)), bytes);
  assert.deepEqual(taskStatus(root), state);
});

test('raw record never opts arbitrary payloads into task encoding, and distinct runs/decisions/states retain full originals', t => {
  const root = fixture(t), input = payload();
  const saved = record(root, input), bytes = storeReadFile(root, saved.ref);
  assert.deepEqual(row(root, saved.ref).payload, input);
  assert.equal(row(root, saved.ref).payload.task_event.version, 1);
  assert.equal(record(root, input).ref, saved.ref);
  assert.deepEqual(storeReadFile(root, saved.ref), bytes);
  const facts = [
    { action: 'test', run: 1, result: 'failed', body: 'same report '.repeat(1000) },
    { action: 'test', run: 2, result: 'passed', body: 'same report '.repeat(1000) },
    { action: 'close', decision_text: 'keep actual choice '.repeat(1000), state: { before: 1, after: 2 } },
  ];
  const refs = facts.map(fact => task(root, fact).ref);
  assert.equal(new Set(refs).size, facts.length);
  refs.forEach((ref, i) => assert.deepEqual(row(root, ref).payload.request, facts[i]));
});

test('non-task raw records keep arbitrary task_event fields and their existing permissive interpretation', t => {
  const root = fixture(t), arbitrary = { kind: 'test-run', body: { result: 'failed', report: 'complete raw report' },
    task_event: { version: 99, report: 'caller field, not a codec marker' } };
  const saved = record(root, arbitrary);
  assert.deepEqual(decodeObservation(row(root, saved.ref)).payload, arbitrary);
  assert.ok(!taskStatus(root).issues.some(issue => issue.ref === saved.ref && /TASK_EVENT_|RECORD_UNREADABLE/.test(issue.code)));
  assert.deepEqual(row(root, saved.ref).payload, arbitrary);
});

test('newly derived plan fields reference original request steps instead of repeating a full nested report', t => {
  const root = fixture(t), marker = 'nested-plan-full-body-marker';
  const steps = [{ id: 'S1', title: 'Actual work', evidence: { body: marker + ' nested report 漢字 '.repeat(3000) } }];
  const saved = task(root, { action: 'prepare', title: 'Plan', steps }), wire = storeReadFile(root, saved.ref);
  assert.equal(wire.toString().split(marker).length - 1, 1);
  const logical = read(root, { ref: saved.ref, format: 'logical-task-event' }).payload;
  assert.deepEqual(logical.request.steps, steps);
  assert.deepEqual(logical.task_event.data.steps, steps);
  assert.deepEqual(logical.task_event.data.plan.steps, steps);
});

test('a corrupt encoded prior request cannot masquerade as a valid task replay', t => {
  const root = fixture(t), prepared = active(root), input = payload();
  input.task_event.task_id = prepared.task_id;
  const bad = encodeTaskPayload(input);
  bad.task_event.data_encoding.references[0].request_pointer = '/does-not-exist';
  const old = record(root, bad), oldBytes = storeReadFile(root, old.ref);
  const saved = task(root, input.request);
  assert.notEqual(saved.ref, old.ref);
  assert.equal(saved.recorded, true);
  assert.equal(read(root, { ref: saved.ref, format: 'logical-task-event' }).payload.task_event.data.report, input.request.report);
  assert.ok(saved.issues.some(issue => issue.code === 'TASK_EVENT_ENCODING_INVALID'));
  assert.deepEqual(storeReadFile(root, old.ref), oldBytes);
  assert.equal(task(root, input.request).ref, saved.ref);
});

test('unknown versions and malformed internal pointers fail closed while original raw reports remain readable', async t => {
  const valid = encodeTaskPayload(payload());
  const cases = [
    ['future task version', p => { p.task_event.version = 33; }, 'TASK_EVENT_VERSION_UNSUPPORTED'],
    ['future encoding version', p => { p.task_event.data_encoding.version = 33; }, 'TASK_EVENT_ENCODING_UNSUPPORTED'],
    ['unknown encoding', p => { p.task_event.data_encoding.kind = 'external-body'; }, 'TASK_EVENT_ENCODING_UNSUPPORTED'],
    ['missing request', p => { delete p.request; }, 'TASK_EVENT_ENCODING_INVALID'],
    ['request fingerprint', p => { p.request.report += 'changed'; }, 'TASK_EVENT_ENCODING_INVALID'],
    ['missing source', p => { p.task_event.data_encoding.references[0].request_pointer = '/missing'; }, 'TASK_EVENT_ENCODING_INVALID'],
    ['external source', p => { p.task_event.data_encoding.references[0].request_pointer = '../some-file'; }, 'TASK_EVENT_ENCODING_INVALID'],
    ['inherited source', p => { p.task_event.data_encoding.references[0].request_pointer = '/__proto__'; }, 'TASK_EVENT_ENCODING_INVALID'],
    ['bad pointer escape', p => { p.task_event.data_encoding.references[0].request_pointer = '/~2'; }, 'TASK_EVENT_ENCODING_INVALID'],
    ['non-placeholder target', p => { p.task_event.data.report = 'original body'; }, 'TASK_EVENT_ENCODING_INVALID'],
    ['duplicate target', p => { p.task_event.data_encoding.references.push(p.task_event.data_encoding.references[0]); }, 'TASK_EVENT_ENCODING_INVALID'],
    ['unknown reference field', p => { p.task_event.data_encoding.references[0].external = true; }, 'TASK_EVENT_ENCODING_INVALID'],
  ];
  for (const [name, mutate, code] of cases) await t.test(name, child => {
    const root = fixture(child), bad = structuredClone(valid); mutate(bad);
    assert.throws(() => decodeObservation(envelope(bad)), { code });
    const saved = record(root, bad);
    assert.equal(saved.recorded, true);
    assert.equal(saved.management.association, 'unresolved');
    assert.ok(saved.management.issues.some(issue => issue.code === code && issue.ref === saved.ref));
    assert.deepEqual(row(root, saved.ref).payload, bad);
    assert.ok(taskStatus(root).issues.some(issue => issue.code === code && issue.ref === saved.ref));
    assert.throws(() => read(root, { ref: saved.ref, format: 'logical-task-event' }), { code });
    assert.equal(read(root, { ref: saved.ref }).status, 'read');
    assert.equal(record(root, bad).ref, saved.ref, 'identical raw malformed observations retain ordinary wire-byte idempotency');
  });
});

test('wire integrity is checked before request hydration and repeated reference expansion is bounded', () => {
  const encoded = encodeTaskPayload(payload()), wire = envelope(encoded);
  wire.payload.request.report += 'corruption';
  assert.throws(() => decodeObservation(wire), { code: 'EVENT_DIGEST_MISMATCH' });
  const big = encodeTaskPayload(payload('b'.repeat(1024 * 1024)));
  big.task_event.data = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`copy${i}`, null]));
  big.task_event.data_encoding.references = Object.keys(big.task_event.data).map(key => ({ data_pointer: `/${key}`, request_pointer: '/report' }));
  assert.throws(() => decodeObservation(envelope(big)), { code: 'TASK_EVENT_EXPANSION_LIMIT' });
  const many = encodeTaskPayload(payload());
  many.task_event.data_encoding.references = Array(4097).fill(many.task_event.data_encoding.references[0]);
  assert.throws(() => decodeObservation(envelope(many)), { code: 'TASK_EVENT_EXPANSION_LIMIT' });
});

test('an explicitly unsupported observation schema fails closed without changing historical raw bytes', t => {
  const root = fixture(t), event = envelope(payload());
  event.schema_version = 999;
  const ref = `${prefix}/events/future-envelope.json`, bytes = Buffer.from(json(event));
  fs.mkdirSync(path.join(root, `${prefix}/events`), { recursive: true });
  fs.writeFileSync(path.join(root, ref), bytes);
  assert.throws(() => decodeObservation(event), { code: 'EVENT_VERSION_UNSUPPORTED' });
  assert.ok(taskStatus(root).issues.some(issue => issue.ref === ref && issue.code === 'EVENT_VERSION_UNSUPPORTED'));
  assert.equal(read(root, { ref }).status, 'read');
  assert.deepEqual(storeReadFile(root, ref), bytes);
  delete event.schema_version;
  assert.deepEqual(decodeObservation(event).payload, event.payload, 'legacy omission remains compatible');
});

test('an unsupported optional optimization falls back to the complete v1 payload', () => {
  const input = payload('one shared report '.repeat(100));
  input.task_event.data = Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`part${i}`, input.request.report]));
  assert.equal(encodeTaskPayload(input), input);
  assert.equal(input.task_event.version, 1);
  assert.equal(Object.keys(input.task_event.data).length, 4097);
  assert.equal(input.task_event.data.part4096, input.request.report);
});

test('intrinsic pointers preserve own prototype-like keys and literal slash/tilde keys without prototype mutation', () => {
  const special = JSON.parse('{"__proto__":{"long":""},"constructor":{"long":""},"a/b~c":""}');
  for (const key of ['__proto__', 'constructor']) special[key].long = `own-${key}-`.repeat(200);
  special['a/b~c'] = 'escaped-key-value'.repeat(300);
  const input = payload(special);
  input.task_event.data = { ...special, derived: true };
  const encoded = encodeTaskPayload(input), decoded = decodeObservation(envelope(encoded));
  assert.deepEqual(decoded.payload, input);
  assert.equal(Object.getPrototypeOf(decoded.payload.task_event.data), Object.prototype);
  assert.equal(Object.prototype.long, undefined);
});
