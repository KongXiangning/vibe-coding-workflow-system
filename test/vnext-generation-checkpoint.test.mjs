import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gitCheckpoint, record, task, taskStatus, snapshot, read } from '../runtime/vnext/support/assistance.mjs';
import { archiveCommand, archiveInventory, storeReadFile } from '../runtime/vnext/support/record-storage.mjs';
import { decodeObservation } from '../runtime/vnext/support/task-event-codec.mjs';

const STORE = '.workflow-system/records', DISPLAY = 'docs/workflow/CURRENT_TASK.md';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const payloadHash = value => hash(JSON.stringify(stable(value)));
const bytes = (root, ref) => fs.readFileSync(path.join(root, ref));
function write(root, ref, content) { const file = path.join(root, ref); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function git(root, args, input) {
  const result = spawnSync('git', ['--literal-pathspecs', ...args], { cwd: root, encoding: 'utf8', input });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-generation-checkpoint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']); git(root, ['config', 'user.name', 'fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  write(root, 'app.txt', 'unchanged business\n'); git(root, ['add', '--', 'app.txt']); git(root, ['commit', '-qm', 'fixture base']);
  return root;
}
function prepared(root, input = {}) {
  for (const edit of gitCheckpoint(root, input).configuration) write(root, edit.path, edit.content);
  return gitCheckpoint(root, input);
}
function stage(root, plan) {
  if (plan.add_paths.length) git(root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], plan.add_paths.join('\0') + '\0');
  if (plan.untrack_paths.length) git(root, ['rm', '--cached', '--pathspec-from-file=-', '--pathspec-file-nul'], plan.untrack_paths.join('\0') + '\0');
}
function finish(root, plan) {
  stage(root, plan);
  const checked = gitCheckpoint(root, { action: 'verify-index', plan });
  assert.equal(checked.status, 'verified', JSON.stringify(checked.issues));
  git(root, ['commit', '-qm', 'fixture checkpoint']);
  return gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: git(root, ['rev-parse', 'HEAD']), index_verification: checked });
}
function sample(root) {
  const preparedTask = task(root, { action: 'prepare', plan: { title: '完整保存报告', steps: [{ id: 'S1' }] } });
  task(root, { action: 'adopt', task_id: preparedTask.task_id, plan_ref: preparedTask.ref });
  const externalBytes = Buffer.from('old cumulative failure report\r\n中文🙂\r\n');
  const external = `legacy/workflow/evidence-objects/${hash(externalBytes)}.blob`;
  write(root, external, externalBytes);
  write(root, 'evidence.txt', 'current run failed distinctly\r\n');
  const captured = snapshot(root, { path: 'evidence.txt' });
  const prior = record(root, { kind: 'earlier-test-run', body: 'Different failed run and complete prior report\r\n'.repeat(100) });
  const report = { body: 'Current run complete report 中文🙂\r\n'.repeat(1000), baseline: { ref: external, sha256: hash(externalBytes), size: externalBytes.length } };
  const execution = task(root, { action: 'execution', result: 'failed', report, evidence_refs: [
    { ref: prior.ref, sha256: prior.sha256, purpose: 'Exact earlier run' },
    { ref: external, sha256: hash(externalBytes), size: externalBytes.length, purpose: 'Historical report' },
    { sha256: captured.sha256, purpose: 'Exact current captured evidence' },
  ] });
  const attachments = JSON.parse(storeReadFile(root, `${STORE}/attachments/${path.posix.basename(execution.ref)}`)).attachments;
  assert.equal(attachments.length, 3);
  assert.ok(attachments.every(attachment => attachment.status === 'referenced'));
  const observation = JSON.parse(storeReadFile(root, execution.ref));
  assert.equal(observation.payload.task_event.version, 2);
  assert.equal(observation.payload.task_event.data.report, null);
  assert.deepEqual(decodeObservation(observation).payload.task_event.data.report, report);
  return { preparedTask, execution, report, external, externalBytes, captured, prior };
}

test('encoded report closure survives reclaim, actual Git checkpoint, offline hydration and exact restore', t => {
  const root = fixture(t), sampleData = sample(root);
  const legacy = record(root, { kind: 'old-observation', body: 'Existing v1 wire bytes remain exact' });
  assert.equal(JSON.parse(storeReadFile(root, legacy.ref)).schema_version, 1);
  const logical = read(root, { ref: sampleData.execution.ref, format: 'logical-task-event' });
  const original = new Map(archiveCommand(root, { action: 'plan' }).candidates.map(item => [item.ref, storeReadFile(root, item.ref)]));
  archiveCommand(root, { action: 'create' });
  const archive = archiveInventory(root, { verify: true }).archives[0];
  archiveCommand(root, { action: 'quarantine', archive_ids: [archive.id] });
  archiveCommand(root, { action: 'reclaim', archive_ids: [archive.id] });
  assert.ok(original.has(sampleData.execution.ref));
  const plan = prepared(root);
  assert.deepEqual(plan.reference_issues, []);
  assert.ok(plan.files.some(file => file.path === sampleData.external && file.role === 'fact'));
  assert.ok(plan.files.some(file => file.path === 'legacy/workflow/evidence-objects/.gitattributes'));
  const committed = finish(root, plan); assert.equal(committed.reference_health, 'no-known-gaps');
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-generation-offline-'));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  git(root, ['clone', '-q', '--no-local', root, clone]); git(clone, ['remote', 'remove', 'origin']);
  assert.equal(fs.existsSync(path.join(clone, '.git/objects/info/alternates')), false);
  assert.equal(fs.existsSync(path.join(clone, STORE, 'archive-quarantine')), false);
  assert.equal(taskStatus(clone).current_task.steps[0].execution.result, 'failed');
  assert.deepEqual(read(clone, { ref: sampleData.execution.ref, format: 'logical-task-event' }).payload, logical.payload);
  assert.deepEqual(bytes(clone, sampleData.external), sampleData.externalBytes);
  for (const [ref, content] of original) assert.deepEqual(storeReadFile(clone, ref), content);
  archiveCommand(clone, { action: 'restore', archive_ids: [archive.id] });
  for (const [ref, content] of original) assert.deepEqual(bytes(clone, ref), content);
});

test('only verified typed task data expands external CAS closure and missing or excluded reports stay explicit', t => {
  for (const scenario of ['excluded', 'missing', 'metadata']) {
    const root = fixture(t), history = sample(root);
    let request = {};
    if (scenario === 'excluded') request = { exclude_paths: [history.external] };
    if (scenario === 'missing') fs.unlinkSync(path.join(root, history.external));
    if (scenario === 'metadata') {
      const event = JSON.parse(bytes(root, history.execution.ref));
      event.payload.request.report.baseline.size++;
      event.payload.task_event.data_encoding.request_sha256 = payloadHash(event.payload.request);
      event.payload_sha256 = payloadHash(event.payload);
      write(root, history.execution.ref, JSON.stringify(event));
    }
    const plan = prepared(root, request);
    const expected = { excluded: 'REFERENCE_NOT_SELECTED', missing: 'REFERENCE_MISSING', metadata: 'REFERENCE_METADATA_MISMATCH' }[scenario];
    assert.ok(plan.reference_issues.some(issue => issue.code === expected && issue.path === history.external), JSON.stringify(plan.reference_issues));
    assert.equal(finish(root, plan).reference_health, 'gaps-retained');
  }
});

test('unknown or corrupt codecs retain original evidence and prevent a false healthy checkpoint', t => {
  for (const scenario of ['envelope', 'version', 'encoding', 'pointer', 'digest']) {
    const root = fixture(t), history = sample(root), event = JSON.parse(bytes(root, history.execution.ref));
    if (scenario === 'envelope') event.schema_version = 999;
    if (scenario === 'version') event.payload.task_event.version = 999;
    if (scenario === 'encoding') event.payload.task_event.data_encoding.version = 999;
    if (scenario === 'pointer') event.payload.task_event.data_encoding.references[0].request_pointer = '/missing';
    if (scenario !== 'digest') event.payload_sha256 = payloadHash(event.payload);
    else event.payload_sha256 = '0'.repeat(64);
    const content = Buffer.from(JSON.stringify(event)); write(root, history.execution.ref, content);
    archiveCommand(root, { action: 'create' }); archiveCommand(root, { action: 'quarantine' });
    const plan = prepared(root), expected = { envelope: 'EVENT_VERSION_UNSUPPORTED', version: 'TASK_EVENT_VERSION_UNSUPPORTED', encoding: 'TASK_EVENT_ENCODING_UNSUPPORTED', pointer: 'TASK_EVENT_ENCODING_INVALID', digest: 'EVENT_DIGEST_MISMATCH' }[scenario];
    assert.ok(plan.reference_issues.some(issue => issue.code === expected && issue.path === history.execution.ref));
    assert.throws(() => read(root, { ref: history.execution.ref, format: 'logical-task-event' }), error => error.code === expected);
    assert.deepEqual(storeReadFile(root, history.execution.ref), content);
    assert.equal(finish(root, plan).reference_health, 'gaps-retained');
  }
});

test('actual index and commit codec validation cannot borrow valid worktree interpretation or plan claims', t => {
  const root = fixture(t), history = sample(root), plan = prepared(root); stage(root, plan);
  const event = JSON.parse(bytes(root, history.execution.ref)); event.payload.task_event.data_encoding.version = 999;
  event.payload_sha256 = payloadHash(event.payload);
  const content = Buffer.from(JSON.stringify(event)), oid = git(root, ['hash-object', '-w', '--stdin'], content);
  git(root, ['update-index', '--cacheinfo', `100644,${oid},${history.execution.ref}`]);
  const alteredPlan = { ...plan, reference_issues: [], files: plan.files.map(file => file.path === history.execution.ref
    ? { ...file, source: 'index', mode: '100644', size: content.length, sha256: hash(content), raw_git_oid: oid } : file) };
  assert.equal(decodeObservation(JSON.parse(bytes(root, history.execution.ref))).encoded, true);
  const checked = gitCheckpoint(root, { action: 'verify-index', plan: alteredPlan });
  assert.equal(checked.status, 'verified'); assert.equal(checked.reference_health, 'gaps-retained');
  assert.ok(checked.reference_issues.some(issue => issue.code === 'TASK_EVENT_ENCODING_UNSUPPORTED'));
  git(root, ['commit', '-qm', 'invalid codec fixture']);
  const committed = gitCheckpoint(root, { action: 'verify-commit', plan: alteredPlan, commit_sha: git(root, ['rev-parse', 'HEAD']), index_verification: checked });
  assert.equal(committed.status, 'verified'); assert.equal(committed.reference_health, 'gaps-retained');
  assert.ok(committed.reference_issues.some(issue => issue.code === 'TASK_EVENT_ENCODING_UNSUPPORTED'));
});

test('stable semantic display remains checkpoint-generated after unrelated facts change', t => {
  const root = fixture(t); sample(root);
  const before = bytes(root, DISPLAY), status = taskStatus(root);
  git(root, ['add', '--', DISPLAY]); git(root, ['commit', '-qm', 'historical tracked display']);
  record(root, { kind: 'test-output', body: 'independent report does not change task presentation' });
  assert.notEqual(taskStatus(root).source_revision, status.source_revision);
  assert.deepEqual(bytes(root, DISPLAY), before);
  const plan = gitCheckpoint(root, { untrack_derived: true });
  assert.ok(plan.untrack_paths.includes(DISPLAY));
  assert.ok(!plan.issues.some(issue => issue.code === 'DISPLAY_DRIFT_RETAINED'));
  assert.ok(plan.configuration.some(edit => edit.path === 'docs/workflow/.gitignore'));
});

test('v1 generated baselines remain recognized and edited, unknown or absent baselines are never ignored', t => {
  for (const scenario of ['v1', 'edited', 'unknown', 'missing']) {
    const root = fixture(t); sample(root);
    if (scenario === 'v1') {
      const revision = 'a'.repeat(64), old = `---\nschema_version: 1\nkind: vnext-task-view\nsource_revision: ${'b'.repeat(64)}\nview_revision: ${revision}\n---\n<!-- vnext-task-view/v1 -->\n# Historical view\n`;
      write(root, DISPLAY, old); write(root, `${STORE}/task-views/${revision}.md`, old);
    }
    git(root, ['add', '--', DISPLAY]); git(root, ['commit', '-qm', 'tracked display fixture']);
    if (scenario === 'edited') fs.appendFileSync(path.join(root, DISPLAY), '\nUser edits remain visible\n');
    if (scenario === 'unknown') write(root, DISPLAY, bytes(root, DISPLAY).toString().replace('vnext-task-view/v2', 'vnext-task-view/v999'));
    if (scenario === 'missing') {
      const revision = /^display_revision: ([a-f0-9]{64})$/m.exec(bytes(root, DISPLAY).toString())[1];
      fs.unlinkSync(path.join(root, `${STORE}/task-views/${revision}.md`));
    }
    const before = bytes(root, DISPLAY), plan = gitCheckpoint(root, { untrack_derived: true });
    assert.equal(plan.untrack_paths.includes(DISPLAY), scenario === 'v1');
    assert.equal(plan.configuration.some(edit => edit.path === 'docs/workflow/.gitignore'), scenario === 'v1');
    assert.equal(plan.issues.some(issue => issue.code === 'DISPLAY_DRIFT_RETAINED'), scenario !== 'v1');
    assert.deepEqual(bytes(root, DISPLAY), before);
  }
});

test('fixed evidence requests require their retained attachment manifest even without new file captures', t => {
  for (const evidence_refs of ['malformed', null, [{ sha256: '0'.repeat(64) }]]) {
    const root = fixture(t), saved = record(root, { body: 'Original request remains', evidence_refs });
    assert.ok(saved.attachments_ref);
    fs.unlinkSync(path.join(root, saved.attachments_ref));
    const plan = prepared(root);
    assert.ok(plan.reference_issues.some(issue => issue.code === 'REFERENCE_MISSING' && issue.path === saved.attachments_ref));
    assert.equal(finish(root, plan).reference_health, 'gaps-retained');
  }
});

test('removing a display baseline after planning invalidates untracking even if display bytes are unchanged', t => {
  const root = fixture(t); sample(root);
  git(root, ['add', '--', DISPLAY]); git(root, ['commit', '-qm', 'tracked display']);
  const plan = prepared(root, { untrack_derived: true });
  assert.ok(plan.untrack_paths.includes(DISPLAY)); stage(root, plan);
  const revision = /^display_revision: ([a-f0-9]{64})$/m.exec(bytes(root, DISPLAY).toString())[1];
  fs.unlinkSync(path.join(root, `${STORE}/task-views/${revision}.md`));
  const checked = gitCheckpoint(root, { action: 'verify-index', plan });
  assert.equal(checked.status, 'mismatch');
  assert.ok(checked.issues.some(issue => issue.code === 'UNTRACKED_SOURCE_CHANGED' && issue.path === DISPLAY));
});
