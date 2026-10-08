import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gitCheckpoint, record, task, taskStatus, read } from '../runtime/vnext/support/assistance.mjs';
import { archiveCommand, archiveInventory, storeReadFile } from '../runtime/vnext/support/record-storage.mjs';

const STORE = '.workflow-system/records';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function write(root, ref, data) { const file = path.join(root, ref); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
const bytes = (root, ref) => fs.readFileSync(path.join(root, ref));
function git(root, args, input) {
  const result = spawnSync('git', ['--literal-pathspecs', ...args], { cwd: root, encoding: 'utf8', input, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-archive-checkpoint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']); git(root, ['config', 'user.name', 'archive checkpoint test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  write(root, 'app.txt', 'initial business bytes\n'); git(root, ['add', '--', 'app.txt']); git(root, ['commit', '-qm', 'base']);
  return root;
}
function prepared(root, request = {}) {
  const proposed = gitCheckpoint(root, request);
  for (const edit of proposed.configuration) {
    assert.equal(fs.existsSync(path.join(root, edit.path)) ? hash(bytes(root, edit.path)) : null, edit.before_sha256);
    write(root, edit.path, edit.content);
  }
  return gitCheckpoint(root, request);
}
function stage(root, plan) {
  if (plan.add_paths.length) git(root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], plan.add_paths.join('\0') + '\0');
  if (plan.untrack_paths.length) git(root, ['rm', '--cached', '--pathspec-from-file=-', '--pathspec-file-nul'], plan.untrack_paths.join('\0') + '\0');
}
const verify = (root, plan) => gitCheckpoint(root, { action: 'verify-index', plan });
function finish(root, plan) {
  stage(root, plan); const index = verify(root, plan); assert.equal(index.status, 'verified', JSON.stringify(index.issues));
  git(root, ['commit', '-qm', 'authorized fixture checkpoint']);
  return gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: git(root, ['rev-parse', 'HEAD']), index_verification: index });
}
function pack(root, quarantine = true) {
  archiveCommand(root, { action: 'create' });
  const inventory = archiveInventory(root, { verify: true });
  assert.equal(inventory.archives.length, 1);
  const archive = inventory.archives[0];
  if (quarantine) archiveCommand(root, { action: 'quarantine', archive_ids: [archive.id] });
  return { archive, records: inventory.records };
}
function sample(root) {
  const prepared = task(root, { action: 'prepare', plan: { title: 'Archived task', steps: [{ id: 'S1' }] } });
  task(root, { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref });
  write(root, 'evidence.txt', Buffer.from('exact evidence\r\n\0\xff', 'latin1'));
  const execution = task(root, { action: 'execution', result: 'failed', files: ['evidence.txt'] });
  const followup = record(root, { body: 'Parent reference remains historical', parents: [execution.ref] });
  const recovery = `${STORE}/legacy/display-capture-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.md`;
  write(root, recovery, 'User display recovery bytes\r\n');
  return { prepared, execution, followup, recovery };
}

test('archive checkpoint removes only explicitly quarantined exact originals; offline clone reconstructs task and attachments', t => {
  const root = fixture(t), history = sample(root);
  assert.equal(finish(root, prepared(root)).status, 'verified');
  const original = new Map(archiveCommand(root, { action: 'plan' }).candidates.map(record => [record.ref, storeReadFile(root, record.ref)]));
  const before = taskStatus(root), packed = pack(root);
  for (const record of packed.records) if (!original.has(record.ref)) original.set(record.ref, storeReadFile(root, record.ref));
  const plan = prepared(root);
  assert.deepEqual(plan.issues, []); assert.deepEqual(plan.reference_issues, []);
  assert.ok(plan.files.filter(file => file.role === 'archive').length >= 3);
  assert.deepEqual([...plan.delete_paths].sort(), packed.records.map(record => record.ref).sort());
  assert.ok(plan.files.some(file => file.path === history.recovery && file.role === 'recovery'));
  assert.ok(!plan.delete_paths.includes(history.recovery));
  assert.ok(plan.omitted.some(file => file.path.includes('/archive-quarantine/') && file.role === 'temporary'));
  assert.ok(!plan.files.some(file => file.path.includes('/archive-quarantine/') || file.path.includes('/.record-store-locks/')));
  const saved = finish(root, plan);
  assert.equal(saved.reference_health, 'no-known-gaps'); assert.deepEqual(saved.remaining_records, []);
  for (const migration of plan.archive_migrations) assert.equal(git(root, ['ls-tree', 'HEAD', '--', migration.path]), '');
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-archive-offline-clone-'));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  git(root, ['clone', '-q', '--no-local', root, clone]); git(clone, ['remote', 'remove', 'origin']);
  assert.equal(fs.existsSync(path.join(clone, STORE, 'archive-quarantine')), false);
  assert.equal(fs.existsSync(path.join(clone, '.git/objects/info/alternates')), false);
  assert.equal(taskStatus(clone).source_revision, before.source_revision);
  assert.equal(taskStatus(clone).view_revision, before.view_revision);
  assert.equal(read(clone, { ref: history.followup.ref }).storage, 'archive');
  for (const [ref, content] of original) assert.deepEqual(storeReadFile(clone, ref), content, ref);
  archiveCommand(clone, { action: 'restore', archive_ids: [packed.archive.id] });
  for (const [ref, content] of original) assert.deepEqual(bytes(clone, ref), content, ref);
  assert.deepEqual(bytes(clone, history.recovery), bytes(root, history.recovery));
});

test('actual index and commit archive bytes are validated instead of trusting intact worktree copies', t => {
  for (const kind of ['pack', 'index']) {
    const root = fixture(t); sample(root); const packed = pack(root), plan = prepared(root); stage(root, plan);
    const target = packed.archive.physical_files.find(file => file.kind === kind).ref;
    const content = Buffer.from(bytes(root, target)); content[content.length - 2] ^= 1;
    const oid = git(root, ['hash-object', '-w', '--stdin'], content);
    git(root, ['update-index', '--cacheinfo', `100644,${oid},${target}`]);
    assert.equal(archiveInventory(root, { verify: true }).verified, true);
    const checked = verify(root, plan);
    assert.equal(checked.status, 'mismatch'); assert.equal(checked.reference_health, 'gaps-retained');
    assert.ok(checked.issues.some(issue => issue.code === 'STORED_BYTES_DIFFER' && issue.path === target));
    git(root, ['commit', '-qm', 'synthetic corrupt archive index']);
    const committed = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: git(root, ['rev-parse', 'HEAD']) });
    assert.equal(committed.status, 'mismatch'); assert.equal(committed.reference_health, 'gaps-retained');
    assert.equal(archiveInventory(root, { verify: true }).verified, true);
  }
});

test('excluded physical backing and paths-only archive fragments remain explicit reference gaps', t => {
  const root = fixture(t), history = sample(root), packed = pack(root);
  const packRef = packed.archive.physical_files.find(file => file.kind === 'pack').ref;
  const plan = prepared(root, { exclude_paths: [packRef] });
  assert.ok(!plan.files.some(file => file.path === packRef));
  assert.ok(plan.reference_issues.some(issue => issue.code === 'REFERENCE_NOT_SELECTED' && issue.path === packRef));
  assert.ok(plan.reference_issues.some(issue => issue.code === 'REFERENCE_NOT_SELECTED' && issue.path === history.execution.ref));
  assert.equal(finish(root, plan).reference_health, 'gaps-retained');
  const narrow = gitCheckpoint(root, { mode: 'paths', business_paths: [packRef] });
  assert.deepEqual(narrow.files.map(file => file.path), [packRef]); assert.deepEqual(narrow.configuration, []);
  assert.ok(narrow.reference_issues.some(issue => issue.path === packed.archive.manifestRef));
});

test('excluding a logical archived record never silently includes it through an indivisible pack', t => {
  const root = fixture(t), history = sample(root), packed = pack(root);
  const plan = prepared(root, { exclude_paths: [history.followup.ref] });
  assert.ok(plan.issues.some(issue => issue.code === 'ARCHIVE_SCOPE_EXCLUSION'));
  for (const file of packed.archive.physical_files) assert.ok(!plan.files.some(selected => selected.path === file.ref));
  assert.ok(plan.reference_issues.some(issue => issue.code === 'REFERENCE_NOT_SELECTED'));
  const narrow = gitCheckpoint(root, { mode: 'paths', business_paths: ['app.txt'] });
  assert.deepEqual(narrow.files.map(file => file.path), ['app.txt']); assert.deepEqual(narrow.delete_paths, []);
});

test('mere archived copies do not authorize missing tracked facts or recovery cleanup', t => {
  const root = fixture(t), history = sample(root); finish(root, prepared(root)); pack(root, false);
  fs.unlinkSync(path.join(root, history.followup.ref)); fs.unlinkSync(path.join(root, history.recovery));
  const plan = prepared(root, { untrack_derived: true });
  assert.deepEqual(plan.delete_paths, []);
  for (const ref of [history.followup.ref, history.recovery]) {
    assert.ok(plan.issues.some(issue => issue.code === 'PERSISTENT_FILE_MISSING' && issue.path === ref));
    assert.ok(!plan.untrack_paths.includes(ref));
  }
});

test('pre-staged original conflicts prohibit migration and preserve the existing index', t => {
  const root = fixture(t), history = sample(root); finish(root, prepared(root));
  const conflicting = git(root, ['hash-object', '-w', '--stdin'], 'different staged historical bytes');
  git(root, ['update-index', '--cacheinfo', `100644,${conflicting},${history.followup.ref}`]);
  pack(root);
  const index = bytes(root, '.git/index'), plan = prepared(root);
  assert.ok(plan.issues.some(issue => issue.code === 'ARCHIVE_MIGRATION_BYTES_DIFFER' && issue.path === history.followup.ref));
  assert.ok(!plan.delete_paths.includes(history.followup.ref)); assert.deepEqual(bytes(root, '.git/index'), index);
});

test('conflicting loose and archived bytes stay visible rather than choosing a silent winner', t => {
  const root = fixture(t), history = sample(root); pack(root, false);
  const changed = JSON.parse(bytes(root, history.followup.ref)); changed.payload.body = 'conflicting loose bytes';
  write(root, history.followup.ref, JSON.stringify(changed));
  const plan = prepared(root);
  assert.ok(plan.issues.length || plan.reference_issues.length); assert.deepEqual(plan.delete_paths, []);
  stage(root, plan); const checked = verify(root, plan);
  assert.equal(checked.reference_health, 'gaps-retained');
  assert.ok(checked.reference_issues.some(issue => issue.code === 'LOGICAL_RECORD_CONFLICT' && issue.path === history.followup.ref));
});

test('saved archive proof is required for every planned migration, including omitted old-v1 physical files', t => {
  const root = fixture(t); sample(root); finish(root, prepared(root)); const packed = pack(root), current = prepared(root);
  const omitted = packed.archive.physical_files.find(file => file.kind === 'pack').ref;
  const plan = { ...current, files: current.files.filter(file => file.path !== omitted), add_paths: current.add_paths.filter(ref => ref !== omitted) };
  stage(root, plan); const checked = verify(root, plan);
  assert.equal(checked.status, 'mismatch'); assert.equal(checked.reference_health, 'gaps-retained');
  assert.ok(checked.issues.some(issue => issue.code === 'ARCHIVE_MIGRATION_NOT_SAVED'));
});

test('explicit reclaimed originals and already staged removals retain exact archive migration proof', t => {
  const root = fixture(t); sample(root); finish(root, prepared(root)); const packed = pack(root);
  const reclaimed = archiveCommand(root, { action: 'reclaim', archive_ids: [packed.archive.id] });
  assert.equal(reclaimed.status, 'reclaimed');
  const proofs = archiveInventory(root, { verify: true }).quarantined;
  assert.equal(proofs.length, packed.records.length); assert.ok(proofs.every(proof => proof.reclaimed));
  git(root, ['rm', '--cached', '--pathspec-from-file=-', '--pathspec-file-nul'], packed.records.map(record => record.ref).join('\0') + '\0');
  const plan = prepared(root);
  assert.deepEqual(plan.issues, []); assert.equal(plan.archive_migrations.length, packed.records.length);
  assert.ok(plan.delete_paths.every(ref => !plan.add_paths.includes(ref)));
  const saved = finish(root, plan); assert.equal(saved.reference_health, 'no-known-gaps');
  fs.rmSync(path.join(root, STORE, 'archive-quarantine'), { recursive: true });
  const checked = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: saved.commit_sha });
  assert.equal(checked.status, 'verified'); assert.equal(checked.reference_health, 'no-known-gaps');
});

test('archive checkpoint leaves late writes to open user recovery captures visible', t => {
  const root = fixture(t), history = sample(root), handle = fs.openSync(path.join(root, history.recovery), 'a');
  try {
    pack(root); const plan = prepared(root); stage(root, plan);
    const checked = verify(root, plan); assert.equal(checked.status, 'verified');
    git(root, ['commit', '-qm', 'archive with retained recovery snapshot']);
    fs.writeSync(handle, 'Late editor bytes\n');
    const saved = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: git(root, ['rev-parse', 'HEAD']), index_verification: checked });
    assert.equal(saved.status, 'verified');
    assert.ok(saved.remaining_records.some(record => record.path === history.recovery && record.reason === 'changed-after-planning'));
    assert.match(bytes(root, history.recovery).toString(), /Late editor bytes/);
  } finally { fs.closeSync(handle); }
});
