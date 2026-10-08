import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gitCheckpoint, task, record, taskStatus, snapshot } from '../runtime/vnext/support/assistance.mjs';
const runtime = fileURLToPath(new URL('../runtime/vnext/support/', import.meta.url));
const STORE = '.workflow-system/records';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function write(root, ref, data) { const p = path.join(root, ref); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
const bytes = (root, ref) => fs.readFileSync(path.join(root, ref));
function git(root, args, input) {
  const r = spawnSync('git', ['--literal-pathspecs', ...args], { cwd: root, encoding: 'utf8', input, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout.trim();
}
function fixture(t, objectFormat) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-checkpoint-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  git(root, ['init', '-q', ...(objectFormat ? [`--object-format=${objectFormat}`] : [])]);
  git(root, ['config', 'user.name', 'checkpoint test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  write(root, 'app.txt', 'base\n');
  write(root, 'docs/workflow/CURRENT_TASK.md', '---\nkind: vnext-current-task\ndocument_id: old\nruntime_state:\n  task_id: "004"\n  workflow_status: closed\n---\n');
  git(root, ['add', '--', 'app.txt', 'docs/workflow/CURRENT_TASK.md']); git(root, ['commit', '-qm', 'base']);
  return root;
}
function applyAuthorizedPolicy(root, plan) {
  for (const edit of plan.configuration) {
    const p = path.join(root, edit.path);
    assert.equal(fs.existsSync(p) ? hash(fs.readFileSync(p)) : null, edit.before_sha256);
    write(root, edit.path, edit.content);
  }
}
function prepared(root, request = {}) {
  applyAuthorizedPolicy(root, gitCheckpoint(root, { ...request, untrack_derived: true }));
  return gitCheckpoint(root, { ...request, untrack_derived: true });
}
function stage(root, plan) {
  if (plan.add_paths.length) git(root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], plan.add_paths.join('\0') + '\0');
  if (plan.untrack_paths.length) git(root, ['rm', '--cached', '--pathspec-from-file=-', '--pathspec-file-nul'], plan.untrack_paths.join('\0') + '\0');
}
const indexCheck = (root, plan) => gitCheckpoint(root, { action: 'verify-index', plan });
function finish(root, plan) {
  stage(root, plan);
  const index = indexCheck(root, plan); assert.equal(index.status, 'verified', JSON.stringify(index.issues));
  git(root, ['commit', '-qm', 'authorized checkpoint']);
  const commit_sha = git(root, ['rev-parse', 'HEAD']);
  return gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha, index_verification: index });
}
function treeBytes(root) {
  const out = [], pending = [''];
  while (pending.length) {
    const ref = pending.pop(), file = path.join(root, ref);
    const st = fs.lstatSync(file);
    if (st.isDirectory()) for (const n of fs.readdirSync(file)) pending.push(path.join(ref, n));
    else if (st.isFile()) out.push([ref, hash(fs.readFileSync(file)), st.mtimeMs]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

test('one checkpoint saves project-wide facts and recoveries, not unrelated code; clone recovers exact CRLF bytes', t => {
  const root = fixture(t);
  write(root, '.gitattributes', '* text=auto\n'); git(root, ['add', '--', '.gitattributes']); git(root, ['commit', '-qm', 'project attributes']);
  const a = task(root, { action: 'prepare', plan: { title: 'A', steps: [{ id: 'S1' }] } });
  task(root, { action: 'adopt', task_id: a.task_id, plan_ref: a.ref });
  write(root, 'report.txt', 'failure\r\n$Id: original$\r\n');
  const failed = task(root, { action: 'execution', result: 'failed', files: ['report.txt'] });
  task(root, { action: 'prepare', plan: { title: 'B', steps: [{ id: 'P1' }] } });
  const broken = record(root, { kind: 'decision', body: 'unassociated real choice' });
  const original = treeBytes(path.join(root, STORE));
  write(root, 'app.txt', 'change\n'); write(root, 'other.txt', 'unrelated user work');
  const plan = prepared(root, { business_paths: ['app.txt'] });
  assert.ok(plan.files.some(f => f.path === a.ref)); assert.ok(plan.files.some(f => f.path === failed.ref)); assert.ok(plan.files.some(f => f.path === broken.ref));
  assert.ok(plan.counts.recovery > 0); assert.ok(plan.untrack_paths.includes('docs/workflow/CURRENT_TASK.md'));
  assert.equal(plan.configuration.length, 0); assert.equal(plan.add_paths.includes('other.txt'), false);
  assert.equal(plan.reference_issues.length, 0, JSON.stringify(plan.reference_issues));
  const fullBefore = taskStatus(root), result = finish(root, plan);
  assert.equal(result.status, 'verified'); assert.equal(result.remaining_records.length, 0); assert.equal(result.reviewed_index_compared, true);
  assert.equal(git(root, ['rev-list', '--count', 'HEAD']), '3');
  assert.equal(git(root, ['status', '--porcelain', '--untracked-files=all']), '?? other.txt\n?? report.txt');
  for (const [ref, h, mtime] of original) { const p = path.join(root, STORE, ref); assert.equal(hash(fs.readFileSync(p)), h); assert.equal(fs.statSync(p).mtimeMs, mtime); }
  const clone = path.join(root, 'copy'); git(root, ['clone', '-q', '--no-local', root, clone]);
  git(clone, ['config', 'core.autocrlf', 'true']);
  git(clone, ['checkout-index', '--all', '--force']);
  for (const f of plan.files.filter(f => f.byte_exact)) assert.equal(hash(bytes(clone, f.path)), f.sha256, f.path);
  const fullAfter = taskStatus(clone);
  assert.equal(fullAfter.source_revision, fullBefore.source_revision); assert.equal(fullAfter.view_revision, fullBefore.view_revision);
  assert.deepEqual(fullAfter.issues, fullBefore.issues);
  assert.equal(gitCheckpoint(root).add_paths.length, 0);
});

test('planning and all verification are read-only; successful commit needs no management receipt write', t => {
  const root = fixture(t); record(root, { body: 'saved facts' });
  const plan = prepared(root); const before = treeBytes(root);
  gitCheckpoint(root); indexCheck(root, plan);
  assert.deepEqual(treeBytes(root), before);
  const result = finish(root, plan); assert.equal(result.status, 'verified');
  const end = treeBytes(root);
  gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: result.commit_sha });
  gitCheckpoint(root); assert.deepEqual(treeBytes(root), end);
});

test('paths-only requests add no implicit records or policy and literal special filenames do not expand scope', t => {
  const root = fixture(t); record(root, { body: 'not authorized for this commit' });
  write(root, 'only[1].txt', 'chosen'); write(root, 'only1.txt', 'unrelated');
  const plan = gitCheckpoint(root, { mode: 'paths', business_paths: ['only[1].txt'] });
  assert.deepEqual(plan.add_paths, ['only[1].txt']); assert.equal(plan.configuration.length, 0); assert.equal(plan.untrack_paths.length, 0);
  const result = finish(root, plan); assert.equal(result.status, 'verified'); assert.ok(result.remaining_records.length);
  assert.equal(git(root, ['ls-tree', '-r', '--name-only', 'HEAD']).includes('only1.txt'), false);
  assert.equal(fs.existsSync(path.join(root, STORE, '.gitattributes')), false);
});

test('explicit exclusions and existing ignore rules are reported, never force-added or erased', t => {
  const root = fixture(t); write(root, 'a.txt', 'private evidence'); const obj = snapshot(root, { path: 'a.txt' });
  const event = record(root, { files: ['a.txt'], body: 'fact referencing excluded object' });
  write(root, '.gitignore', `${obj.ref}\n`);
  const before = bytes(root, '.gitignore');
  let plan = prepared(root); assert.ok(plan.issues.some(i => i.code === 'SELECTED_PATH_IGNORED' && i.path === obj.ref));
  plan = gitCheckpoint(root, { exclude_paths: [obj.ref] });
  assert.equal(plan.add_paths.includes(obj.ref), false);
  assert.ok(plan.reference_issues.some(i => i.code === 'REFERENCE_NOT_SELECTED' && i.path === obj.ref));
  assert.ok(plan.files.some(f => f.path === event.ref)); assert.deepEqual(bytes(root, '.gitignore'), before);
});

test('unrelated staged changes and partially staged content survive inspection and prevent a false scope verification', t => {
  const root = fixture(t); record(root, { body: 'data' });
  write(root, 'other.txt', 'already staged'); git(root, ['add', '--', 'other.txt']);
  write(root, 'app.txt', 'staged piece'); git(root, ['add', '--', 'app.txt']); write(root, 'app.txt', 'unstaged remainder');
  const before = bytes(root, '.git/index');
  const plan = gitCheckpoint(root, { business_paths: ['app.txt'] });
  assert.ok(plan.issues.some(i => i.code === 'STAGED_OUTSIDE_SCOPE' && i.paths.includes('other.txt')));
  assert.ok(plan.issues.some(i => i.code === 'PRESTAGED_CONTENT_DIFFERS' && i.path === 'app.txt'));
  const check = indexCheck(root, plan); assert.equal(check.status, 'mismatch'); assert.ok(check.issues.some(i => i.code === 'OUTSIDE_SCOPE'));
  assert.deepEqual(bytes(root, '.git/index'), before);
});

test('existing corrupt facts and unavailable references can be backed up without changing their original meaning or bytes', t => {
  const root = fixture(t);
  write(root, `${STORE}/events/bad.json`, '{not-json');
  write(root, `${STORE}/events/wrong-hash.json`, JSON.stringify({ payload: { body: 'actual failed report' }, payload_sha256: '0'.repeat(64) }));
  const obj = snapshot(root, { path: 'app.txt' }); write(root, obj.ref, 'tampered existing byte evidence');
  record(root, { body: 'missing attachment recorded, not fabricated', files: ['absent.txt'] });
  const plan = prepared(root), check = finish(root, plan);
  assert.equal(check.status, 'verified'); assert.equal(check.reference_health, 'gaps-retained');
  for (const code of ['RETAINED_RECORD_UNREADABLE', 'EVENT_DIGEST_MISMATCH', 'PRESERVED_DIGEST_MISMATCH', 'RETAINED_ATTACHMENT_UNAVAILABLE']) assert.ok(check.reference_issues.some(i => i.code === code), code);
  assert.equal(bytes(root, `${STORE}/events/bad.json`).toString(), '{not-json');
});

test('planned record omission, normalization and unsafe attributes are found in the actual index', t => {
  const root = fixture(t); write(root, '.gitattributes', '* text=auto\n');
  write(root, 'crlf.txt', 'a\r\nb\r\n'); const obj = snapshot(root, { path: 'crlf.txt' });
  let plan = prepared(root); stage(root, plan);
  git(root, ['rm', '--cached', '--', obj.ref]);
  assert.ok(indexCheck(root, plan).issues.some(i => i.code === 'PLANNED_FILE_NOT_SAVED' && i.path === obj.ref));
  write(root, `${STORE}/.gitattributes`, '* text=auto\n');
  git(root, ['add', '--', obj.ref, `${STORE}/.gitattributes`]);
  const check = indexCheck(root, plan);
  assert.ok(check.issues.some(i => i.code === 'STORED_BYTES_DIFFER' && i.path === obj.ref));
  assert.ok(check.issues.some(i => i.code === 'INDEX_BYTE_ATTRIBUTES_UNSAFE'));
});

test('concurrent new facts stay pending; late open-handle writes are retained and never recursively committed', t => {
  const root = fixture(t); task(root, { action: 'prepare', plan: { title: 'work', steps: [] } });
  const plan = prepared(root), recovery = plan.files.find(f => /display-capture-/.test(f.path));
  assert.ok(recovery);
  const handle = fs.openSync(path.join(root, recovery.path), 'a');
  try {
    stage(root, plan); const checked = indexCheck(root, plan); assert.equal(checked.status, 'verified');
    const fresh = record(root, { body: 'a real report after planning' });
    git(root, ['commit', '-qm', 'snapshot boundary']);
    fs.writeSync(handle, '\nLate editor content\n');
    const result = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: git(root, ['rev-parse', 'HEAD']), index_verification: checked });
    assert.equal(result.status, 'verified');
    assert.ok(result.remaining_records.some(r => r.path === fresh.ref && r.reason === 'not-in-planned-snapshot'));
    assert.ok(result.remaining_records.some(r => r.path === recovery.path && r.reason === 'changed-after-planning'));
    assert.match(bytes(root, recovery.path).toString(), /Late editor content/);
    assert.equal(git(root, ['rev-list', '--count', 'HEAD']), '2');
  } finally { fs.closeSync(handle); }
});

test('index/source drift and post-verification tree changes are reported without rewriting Git', t => {
  const root = fixture(t); const event = record(root, { body: 'saved original' });
  let plan = prepared(root, { business_paths: ['app.txt'] }); stage(root, plan);
  const old = bytes(root, event.ref); write(root, event.ref, 'changed while preparing commit');
  assert.ok(indexCheck(root, plan).issues.some(i => i.code === 'SOURCE_CHANGED_SINCE_PLAN'));
  write(root, event.ref, old);
  const verified = indexCheck(root, plan); assert.equal(verified.status, 'verified');
  write(root, 'app.txt', 'hook-like later change'); git(root, ['add', '--', 'app.txt']); git(root, ['commit', '-qm', 'later tree']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const result = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: head, index_verification: verified });
  assert.ok(result.issues.some(i => i.code === 'COMMITTED_TREE_DIFFERS_FROM_REVIEWED_INDEX'));
  assert.equal(git(root, ['rev-parse', 'HEAD']), head);
});

test('edited displays, custom policy blocks, missing persistent files and unsafe paths are not silently cleaned', t => {
  const root = fixture(t); task(root, { action: 'prepare', plan: { title: 'work', steps: [] } });
  const display = 'docs/workflow/CURRENT_TASK.md'; fs.appendFileSync(path.join(root, display), '\nMy note\n');
  let plan = gitCheckpoint(root, { untrack_derived: true });
  assert.ok(plan.issues.some(i => i.code === 'DISPLAY_DRIFT_RETAINED'));
  assert.equal(plan.untrack_paths.includes(display), false);
  assert.equal(plan.configuration.some(e => e.path === 'docs/workflow/.gitignore'), false);
  assert.throws(() => gitCheckpoint(root, { business_paths: ['.git/config'] }), /Git-control/);
  assert.throws(() => gitCheckpoint(root, { business_paths: ['../escape'] }), /repository-relative/);
  write(root, `${STORE}/.gitattributes`, '# BEGIN vNext checkpoint Git policy\nCUSTOM\n# END vNext checkpoint Git policy\n');
  plan = gitCheckpoint(root); assert.ok(plan.issues.some(i => i.code === 'POLICY_BLOCK_EDITED'));
  assert.equal(plan.configuration.some(e => e.path === `${STORE}/.gitattributes`), false);
});

test('unborn SHA-256 repository and installed native CLI use the same byte and scope verification', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-checkpoint-sha256-')); t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  git(root, ['init', '-q', '--object-format=sha256']); git(root, ['config', 'user.name', 'test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  record(root, { body: 'first report' });
  const dest = path.join(root, '.workflow-system/runtime/support'); fs.mkdirSync(dest, { recursive: true });
  for (const name of ['assistance.mjs', 'task-management.mjs', 'task-event-codec.mjs', 'record-storage.mjs']) fs.copyFileSync(path.join(runtime, name), path.join(dest, name));
  const run = payload => {
    const r = spawnSync(process.execPath, [path.join(dest, 'assistance.mjs'), 'git-checkpoint', '--root', root], { input: JSON.stringify(payload), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout);
  };
  applyAuthorizedPolicy(root, run({})); const plan = run({}); assert.equal(plan.base_head, null); assert.equal(plan.object_format, 'sha256');
  stage(root, plan); const check = run({ action: 'verify-index', plan }); assert.equal(check.status, 'verified');
  git(root, ['commit', '-qm', 'first checkpoint']); const sha = git(root, ['rev-parse', 'HEAD']); assert.equal(sha.length, 64);
  assert.equal(run({ action: 'verify-commit', plan, commit_sha: sha, index_verification: check }).status, 'verified');
});

test('a removed tracked fact stays a reported gap instead of becoming an implicit deletion', t => {
  const root = fixture(t), fact = record(root, { body: 'must survive' });
  finish(root, prepared(root)); fs.unlinkSync(path.join(root, fact.ref));
  const plan = gitCheckpoint(root);
  assert.ok(plan.issues.some(i => i.code === 'PERSISTENT_FILE_MISSING' && i.path === fact.ref));
  assert.equal(plan.delete_paths.includes(fact.ref), false); assert.equal(plan.add_paths.includes(fact.ref), false);
  assert.ok(git(root, ['ls-files']).includes(fact.ref));
});

test('changed or staged display data cannot silently enter an untracking migration', t => {
  const root = fixture(t); task(root, { action: 'prepare', plan: { title: 'work', steps: [] } });
  const plan = prepared(root); stage(root, plan);
  fs.appendFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), '\nHuman note after planning\n');
  assert.ok(indexCheck(root, plan).issues.some(i => i.code === 'UNTRACKED_SOURCE_CHANGED'));
  assert.match(bytes(root, 'docs/workflow/CURRENT_TASK.md').toString(), /Human note/);
  const root2 = fixture(t); task(root2, { action: 'prepare', plan: { title: 'work', steps: [] } });
  git(root2, ['add', '--', 'docs/workflow/CURRENT_TASK.md']);
  const staged = gitCheckpoint(root2, { untrack_derived: true });
  assert.equal(staged.untrack_paths.includes('docs/workflow/CURRENT_TASK.md'), false);
  assert.ok(staged.issues.some(i => i.code === 'STAGED_DERIVED_CHANGE'));
});

test('policy proposals preserve customized CRLF bytes, respect freezes and do not run content filters', t => {
  const root = fixture(t), ref = `${STORE}/.gitattributes`;
  write(root, ref, '# project-specific comments\r\n');
  write(root, 'a.txt', 'evidence'); const object = snapshot(root, { path: 'a.txt' });
  git(root, ['config', 'filter.danger.clean', `touch "${path.join(root, 'filter-ran')}"`]);
  write(root, '.gitattributes', '*.blob filter=danger\n');
  const plan = gitCheckpoint(root), edit = plan.configuration.find(e => e.path === ref);
  assert.ok(edit.content.startsWith('# project-specific comments\r\n'));
  assert.equal(edit.project_policy_review, true); assert.ok(plan.issues.some(i => i.code === 'BYTE_ATTRIBUTE_REVIEW' && i.path === object.ref));
  assert.equal(fs.existsSync(path.join(root, 'filter-ran')), false);
  write(root, ref, '# DO NOT MODIFY\n');
  const frozen = gitCheckpoint(root); assert.ok(frozen.issues.some(i => i.code === 'POLICY_FILE_FROZEN'));
  assert.equal(frozen.configuration.some(e => e.path === ref), false);
});

test('unknown records remain visible, malformed attachment metadata remains a gap, and verification errors exit nonzero', t => {
  const root = fixture(t); write(root, 'a.txt', 'object'); const rec = record(root, { files: ['a.txt'], body: 'real source' });
  const manifest = JSON.parse(bytes(root, rec.attachments_ref)); manifest.attachments[0].size++;
  write(root, rec.attachments_ref, JSON.stringify(manifest));
  write(root, `${STORE}/mystery.txt`, 'user-owned unknown data');
  const plan = prepared(root);
  assert.ok(plan.omitted.some(p => p.path === `${STORE}/mystery.txt` && p.reason === 'classification-required'));
  assert.ok(plan.reference_issues.some(i => i.code === 'ATTACHMENT_METADATA_MISMATCH'));
  const result = spawnSync(process.execPath, [path.join(runtime, 'assistance.mjs'), 'git-checkpoint', '--root', root],
    { input: JSON.stringify({ action: 'verify-index', plan }), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'mismatch');
  assert.equal(fs.existsSync(path.join(root, STORE, 'mystery.txt')), true);
});

function historicalAttachment(root, home = 'docs/workflow') {
  const content = Buffer.from('abcdef\r\nghijkl\r\n'), digest = hash(content);
  const ref = `${home}/evidence-objects/${digest}.blob`;
  write(root, ref, content);
  const saved = record(root, { body: 'Reuse preserved historical evidence', files: [{ sha256: digest, workflow_home: home }] });
  assert.equal(saved.attachments[0].ref, ref);
  return { ref, content, digest, saved };
}

test('checkpoint preserves referenced historical objects and exact bytes without collecting the legacy directory', t => {
  for (const home of ['docs/workflow', 'custom/workflow']) {
    const root = fixture(t);
    write(root, '.gitattributes', '* text=auto\n');
    git(root, ['add', '--', '.gitattributes']); git(root, ['commit', '-qm', 'project text policy']);
    const object = historicalAttachment(root, home);
    const unrelated = `${home}/evidence-objects/${'0'.repeat(64)}.blob`;
    write(root, unrelated, 'unreferenced object'); write(root, `${home}/notes.md`, 'unrelated user notes');
    const plan = prepared(root), file = plan.files.find(f => f.path === object.ref);
    assert.ok(file); assert.equal(file.role, 'fact'); assert.equal(file.byte_exact, true);
    assert.equal(plan.files.some(f => f.path === unrelated || f.path === `${home}/notes.md`), false);
    assert.equal(fs.existsSync(path.join(root, STORE, 'evidence-objects', `${object.digest}.blob`)), false);
    const check = finish(root, plan);
    assert.equal(check.reference_health, 'no-known-gaps'); assert.deepEqual(check.remaining_records, []);
    assert.equal(Number(git(root, ['cat-file', '-s', `HEAD:${object.ref}`])), object.content.length);
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-legacy-checkpoint-clone-'));
    t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
    git(root, ['clone', '-q', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', root, clone]);
    assert.deepEqual(bytes(clone, object.ref), object.content);
    assert.deepEqual(bytes(root, object.ref), object.content);
    assert.equal(snapshot(clone, { sha256: object.digest, workflow_home: home }).ref, object.ref);
  }
});

test('explicitly selected historical evidence retains its fact role and byte checks in paths mode', t => {
  const root = fixture(t), object = historicalAttachment(root);
  write(root, '.gitattributes', '* text=auto\n');
  const plan = gitCheckpoint(root, { mode: 'paths', business_paths: [object.ref] });
  const file = plan.files.find(f => f.path === object.ref);
  assert.equal(file.role, 'fact'); assert.equal(file.byte_exact, true); assert.deepEqual(plan.configuration, []);
  git(root, ['add', '--', object.ref]);
  const check = indexCheck(root, plan);
  assert.equal(check.status, 'mismatch');
  assert.ok(check.issues.some(i => i.code === 'STORED_BYTES_DIFFER' && i.path === object.ref));
  assert.equal(check.reference_health, 'gaps-retained');
});

test('tracked historical evidence is checked against both the index and actual commit bytes', t => {
  const root = fixture(t), object = historicalAttachment(root);
  write(root, 'docs/workflow/evidence-objects/.gitattributes', '*.blob -text -filter -ident -working-tree-encoding\n');
  git(root, ['add', '--', object.ref, 'docs/workflow/evidence-objects/.gitattributes']);
  git(root, ['commit', '-qm', 'existing byte-exact historical object']);
  const plan = prepared(root); stage(root, plan);
  const normalized = git(root, ['hash-object', '-w', '--stdin'], object.content.toString().replaceAll('\r\n', '\n'));
  git(root, ['update-index', '--cacheinfo', `100644,${normalized},${object.ref}`]);
  const index = indexCheck(root, plan);
  assert.equal(index.status, 'mismatch');
  assert.ok(index.issues.some(i => i.code === 'STORED_BYTES_DIFFER' && i.path === object.ref));
  assert.equal(index.reference_health, 'gaps-retained');
  git(root, ['commit', '-qm', 'synthetic wrong object bytes']);
  const check = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha: git(root, ['rev-parse', 'HEAD']) });
  assert.equal(check.status, 'mismatch');
  assert.ok(check.issues.some(i => i.code === 'STORED_BYTES_DIFFER' && i.path === object.ref));
  assert.equal(check.reference_health, 'gaps-retained'); assert.deepEqual(bytes(root, object.ref), object.content);
});

test('excluded, missing and corrupt historical attachment objects remain explicit checkpoint gaps', t => {
  for (const scenario of ['excluded', 'missing', 'corrupt']) {
    const root = fixture(t), object = historicalAttachment(root, 'custom/workflow');
    if (scenario === 'missing') fs.unlinkSync(path.join(root, object.ref));
    if (scenario === 'corrupt') write(root, object.ref, 'corrupt original still retained');
    const request = scenario === 'excluded' ? { exclude_paths: ['custom/workflow/evidence-objects'] } : {};
    const plan = prepared(root, request);
    const code = { excluded: 'REFERENCE_NOT_SELECTED', missing: 'REFERENCE_MISSING', corrupt: 'PRESERVED_DIGEST_MISMATCH' }[scenario];
    assert.ok(plan.reference_issues.some(i => i.code === code && i.path === object.ref));
    if (scenario === 'excluded') {
      assert.equal(plan.add_paths.includes(object.ref), false);
      assert.equal(plan.configuration.some(e => e.path.startsWith('custom/workflow/evidence-objects/')), false);
    }
    const check = finish(root, plan);
    assert.equal(check.status, 'verified'); assert.equal(check.reference_health, 'gaps-retained');
    if (scenario === 'excluded') assert.ok(check.remaining_records.some(f => f.path === object.ref));
    if (scenario === 'corrupt') assert.equal(bytes(root, object.ref).toString(), 'corrupt original still retained');
  }
});

test('only typed attachment object refs extend checkpoint scope and unsafe refs remain gaps', t => {
  for (const target of ['docs/user-owned.txt', `../../evidence-objects/${'0'.repeat(64)}.blob`, `.git/evidence-objects/${'0'.repeat(64)}.blob`]) {
    const root = fixture(t), object = historicalAttachment(root);
    write(root, 'docs/user-owned.txt', 'unrelated user bytes');
    const manifest = JSON.parse(bytes(root, object.saved.attachments_ref));
    manifest.attachments[0].ref = target;
    write(root, object.saved.attachments_ref, JSON.stringify(manifest));
    record(root, { body: `arbitrary text mentioning ${object.ref}`, ref: object.ref });
    const plan = prepared(root);
    assert.equal(plan.add_paths.includes('docs/user-owned.txt'), false);
    assert.equal(plan.add_paths.includes(object.ref), false);
    assert.ok(plan.reference_issues.some(i => i.path === target));
    assert.equal(finish(root, plan).reference_health, 'gaps-retained');
  }
});

test('index source preserves a staged deletion despite a replacement in the worktree', t => {
  const root = fixture(t); git(root, ['rm', '--', 'app.txt']); write(root, 'app.txt', 'local replacement\n');
  const before = bytes(root, '.git/index');
  const plan = gitCheckpoint(root, { mode: 'paths', source: 'index', business_paths: ['app.txt'] });
  assert.deepEqual(plan.files, []); assert.deepEqual(plan.delete_paths, ['app.txt']); assert.deepEqual(plan.add_paths, []);
  assert.deepEqual(plan.issues, []); assert.equal(indexCheck(root, plan).status, 'verified');
  assert.deepEqual(bytes(root, '.git/index'), before);
  assert.equal(finish(root, plan).status, 'verified');
  assert.equal(git(root, ['ls-tree', 'HEAD', '--', 'app.txt']), '');
  assert.equal(bytes(root, 'app.txt').toString(), 'local replacement\n');
});

test('index source saves an absent working copy and binary staged bytes without re-adding files', t => {
  const root = fixture(t), content = Buffer.from([0, 255, 13, 10, 128, 65]);
  write(root, 'new.bin', content); git(root, ['add', '--', 'new.bin']); fs.unlinkSync(path.join(root, 'new.bin'));
  const before = bytes(root, '.git/index');
  const plan = gitCheckpoint(root, { mode: 'paths', source: 'index', business_paths: ['new.bin'] });
  assert.deepEqual(plan.issues, []); assert.deepEqual(plan.add_paths, []);
  assert.equal(plan.files[0].source, 'index'); assert.equal(plan.files[0].sha256, hash(content));
  assert.equal(plan.files[0].mode, '100644'); assert.equal(indexCheck(root, plan).status, 'verified');
  assert.deepEqual(bytes(root, '.git/index'), before);
  assert.equal(finish(root, plan).status, 'verified');
  assert.equal(git(root, ['rev-parse', 'HEAD:new.bin']), plan.files[0].raw_git_oid);
  assert.equal(fs.existsSync(path.join(root, 'new.bin')), false);
});

test('index source ignores worktree drift but detects changed staged content, mode and scope', t => {
  const root = fixture(t); write(root, 'app.txt', 'staged part\n'); git(root, ['add', '--', 'app.txt']);
  write(root, 'app.txt', 'unstaged remainder\n');
  const plan = gitCheckpoint(root, { mode: 'paths', source: 'index', business_paths: ['app.txt'] });
  assert.deepEqual(plan.add_paths, []); assert.deepEqual(plan.issues, []);
  fs.unlinkSync(path.join(root, 'app.txt')); assert.equal(indexCheck(root, plan).status, 'verified');
  git(root, ['update-index', '--cacheinfo', `100755,${plan.files[0].raw_git_oid},app.txt`]);
  assert.ok(indexCheck(root, plan).issues.some(i => i.code === 'STORED_MODE_DIFFERS'));
  git(root, ['update-index', '--cacheinfo', `100644,${plan.files[0].raw_git_oid},app.txt`]);
  write(root, 'app.txt', 'different staged bytes\n'); git(root, ['add', '--', 'app.txt']);
  assert.ok(indexCheck(root, plan).issues.some(i => i.code === 'STORED_BYTES_DIFFER'));
  git(root, ['update-index', '--cacheinfo', `100644,${plan.files[0].raw_git_oid},app.txt`]);
  write(root, 'other.txt', 'unrelated staged work'); git(root, ['add', '--', 'other.txt']);
  const before = bytes(root, '.git/index');
  assert.ok(indexCheck(root, plan).issues.some(i => i.code === 'OUTSIDE_SCOPE' && i.paths.includes('other.txt')));
  assert.deepEqual(bytes(root, '.git/index'), before);
});

test('index business selection and worktree management records coexist in one checkpoint', t => {
  const root = fixture(t); write(root, 'app.txt', 'selected staged part\n'); git(root, ['add', '--', 'app.txt']);
  write(root, 'app.txt', 'local unstaged remainder\n'); const event = record(root, { body: 'checkpoint facts' });
  const plan = prepared(root, { source: 'index', business_paths: ['app.txt'] });
  assert.equal(plan.files.find(f => f.path === 'app.txt').source, 'index');
  assert.equal(plan.add_paths.includes('app.txt'), false); assert.ok(plan.add_paths.includes(event.ref));
  assert.equal(finish(root, plan).status, 'verified');
  assert.equal(git(root, ['show', 'HEAD:app.txt']), 'selected staged part');
  assert.equal(bytes(root, 'app.txt').toString(), 'local unstaged remainder\n');
  assert.throws(() => gitCheckpoint(root, { source: 'unknown' }), { code: 'INVALID_CHECKPOINT_SOURCE' });
});

test('Git symlink index entries and Windows placeholders retain link mode and content', t => {
  const root = fixture(t); git(root, ['config', 'core.symlinks', 'false']);
  const value = 'nonexistent-target.txt'; write(root, 'alias.txt', value);
  const oid = git(root, ['hash-object', '-w', '--stdin'], value);
  git(root, ['update-index', '--add', '--cacheinfo', `120000,${oid},alias.txt`]);
  for (const source of ['worktree', 'index']) {
    const plan = gitCheckpoint(root, { mode: 'paths', source, business_paths: ['alias.txt'] });
    assert.equal(plan.files[0].mode, '120000'); assert.equal(indexCheck(root, plan).status, 'verified');
  }
  const plan = gitCheckpoint(root, { mode: 'paths', source: 'index', business_paths: ['alias.txt'] });
  assert.equal(finish(root, plan).status, 'verified');
  assert.ok(git(root, ['ls-tree', 'HEAD', '--', 'alias.txt']).startsWith('120000 blob'));
  assert.equal(git(root, ['show', 'HEAD:alias.txt']), value);
});

test('worktree symlinks save their link value without following targets or weakening evidence I/O', t => {
  const root = fixture(t), link = path.join(root, 'alias.txt');
  try { fs.symlinkSync('../../outside-or-missing.txt', link); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Host cannot create physical symlinks; index mode is covered separately.'); return; } throw error; }
  const plan = gitCheckpoint(root, { mode: 'paths', business_paths: ['alias.txt'] });
  assert.equal(plan.files[0].mode, '120000'); assert.equal(plan.files[0].sha256, hash(Buffer.from('../../outside-or-missing.txt')));
  assert.throws(() => snapshot(root, { path: 'alias.txt' }), { code: 'UNSAFE_PATH' });
  assert.equal(finish(root, plan).status, 'verified');
  fs.symlinkSync(root, path.join(root, 'linked-directory'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => gitCheckpoint(root, { mode: 'paths', business_paths: ['linked-directory/app.txt'] }), { code: 'UNSAFE_PATH' });
});

test('Gitlink index entries are verified by commit pointer without traversing a submodule', t => {
  const root = fixture(t), oid = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${oid},vendor/module`]);
  const plan = gitCheckpoint(root, { mode: 'paths', source: 'index', business_paths: ['vendor/module'] });
  assert.equal(plan.files[0].mode, '160000'); assert.equal(plan.files[0].raw_git_oid, oid);
  assert.deepEqual(plan.add_paths, []); assert.equal(indexCheck(root, plan).status, 'verified');
  assert.equal(finish(root, plan).status, 'verified');
  assert.ok(git(root, ['ls-tree', 'HEAD', '--', 'vendor/module']).startsWith(`160000 commit ${oid}`));
});

test('index source hashes a blob larger than 64 MiB without a working copy or index writes', t => {
  const root = fixture(t), content = Buffer.alloc(65 * 1024 * 1024, 17);
  content.set([0, 255, 13, 10, 128], content.length - 5);
  write(root, 'large.bin', content); git(root, ['add', '--', 'large.bin']);
  fs.unlinkSync(path.join(root, 'large.bin'));
  const before = bytes(root, '.git/index');
  const plan = gitCheckpoint(root, { mode: 'paths', source: 'index', business_paths: ['large.bin'] });
  assert.deepEqual(plan.issues, []); assert.deepEqual(plan.add_paths, []);
  assert.equal(plan.files.length, 1); assert.equal(plan.files[0].sha256, hash(content));
  assert.equal(plan.files[0].size, content.length); assert.equal(plan.files[0].mode, '100644');
  assert.equal(indexCheck(root, plan).status, 'verified'); assert.deepEqual(bytes(root, '.git/index'), before);
  assert.equal(finish(root, plan).status, 'verified');
  assert.equal(Number(git(root, ['cat-file', '-s', 'HEAD:large.bin'])), content.length);
  assert.equal(fs.existsSync(path.join(root, 'large.bin')), false);
});

test('old v1 plans verify attachment dependencies from Git even when legacy objects were not inventoried', t => {
  for (const scenario of ['missing', 'saved', 'corrupt']) {
    const root = fixture(t), object = historicalAttachment(root, 'custom/workflow');
    const attributes = 'custom/workflow/evidence-objects/.gitattributes';
    if (scenario !== 'missing') {
      write(root, attributes, '*.blob -text -filter -ident -working-tree-encoding\n');
      git(root, ['add', '--', object.ref, attributes]);
      if (scenario === 'corrupt') {
        const oid = git(root, ['hash-object', '-w', '--stdin'], object.content.toString().replaceAll('\r\n', '\n'));
        git(root, ['update-index', '--cacheinfo', `100644,${oid},${object.ref}`]);
      }
      git(root, ['commit', '-qm', 'preexisting historical object']);
    }
    const current = prepared(root);
    // Recreate the accepted pre-fix v1 shape: records were inventoried, old objects were not.
    const omitted = new Set([object.ref, attributes]);
    const plan = { ...current, reference_issues: [],
      files: current.files.filter(f => !omitted.has(f.path)).map(({ source, mode, ...file }) => file),
      add_paths: current.add_paths.filter(ref => !omitted.has(ref)),
      issues: current.issues.filter(i => !omitted.has(i.path)) };
    delete plan.source;
    stage(root, plan);
    const indexBefore = bytes(root, '.git/index');
    const index = indexCheck(root, plan);
    assert.equal(index.status, 'verified'); assert.deepEqual(bytes(root, '.git/index'), indexBefore);
    const health = scenario === 'saved' ? 'no-known-gaps' : 'gaps-retained';
    assert.equal(index.reference_health, health);
    if (scenario !== 'saved') assert.ok(index.reference_issues.some(i => i.path === object.ref
      && i.code === (scenario === 'missing' ? 'REFERENCE_MISSING' : 'PRESERVED_DIGEST_MISMATCH')));
    git(root, ['commit', '-qm', 'old v1 checkpoint']);
    const commit_sha = git(root, ['rev-parse', 'HEAD']);
    const committed = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha, index_verification: index });
    assert.equal(committed.reference_health, health); assert.equal(committed.reviewed_index_compared, true);
    // Worktree changes must not substitute a different manifest/object for the committed snapshot.
    fs.unlinkSync(path.join(root, object.saved.attachments_ref)); fs.unlinkSync(path.join(root, object.ref));
    const check = gitCheckpoint(root, { action: 'verify-commit', plan, commit_sha, index_verification: index });
    assert.equal(check.status, 'verified'); assert.equal(check.reference_health, health);
    if (scenario !== 'saved') assert.ok(check.reference_issues.some(i => i.path === object.ref));
    assert.equal(plan.add_paths.includes(object.ref), false); assert.equal(plan.files.some(f => f.path === object.ref), false);
  }
});
