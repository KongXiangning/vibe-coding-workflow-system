import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import fsMutable from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { planMigration, applyMigration, restoreMigration, verifyMigration, verifyMigrationBackup, convertLegacyTask } from '../runtime/vnext/dist/task-state-migration.js';
import { parse, stringify } from 'yaml';
import { task, queryStatus, archive, gitCheckpoint, record } from '../runtime/vnext/support/assistance.mjs';
import { storeReadFile } from '../runtime/vnext/support/record-storage.mjs';

const support = fileURLToPath(new URL('../runtime/vnext/support/', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (root, ref, data) => { fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), data); };
function files(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix)).sort().flatMap(name => {
    const ref = prefix ? `${prefix}/${name}` : name;
    return fs.statSync(path.join(root, ref)).isDirectory() ? files(root, ref) : [[ref, sha(fs.readFileSync(path.join(root, ref)))]];
  });
}
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-migration-')), root = path.join(base, '项目');
  t.after(() => { assert(base.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(base, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, '.workflow-system/records/events'), { recursive: true });
  for (const name of ['assistance.mjs', 'task-management.mjs', 'task-state.mjs', 'task-event-codec.mjs', 'record-storage.mjs']) put(root, `.workflow-system/runtime/support/${name}`, fs.readFileSync(path.join(support, name)));
  const prepared = task(root, { action: 'prepare', idempotency_key: 'migration-fixture', plan: { title: '连接修复', goal: '同一会话继续', constraints: ['不可改会话身份'], steps: [{ id: 'S1', title: '修复并验证' }] } });
  assert.equal(prepared.association, 'applied');
  task(root, { action: 'adopt', task_ref: prepared.task_id, plan_ref: prepared.ref, decision_text: '采用此范围', focus: true });
  const execution = task(root, { action: 'execution', summary: '本地实现', result: 'partial', remaining_work: ['真机连接仍失败'], source_revision: 'current-code' });
  task(root, { action: 'test', check_id: 'connection', environment_id: 'unit', command: 'node test.mjs', execution_ref: execution.ref, result: 'passed' });
  task(root, { action: 'test', check_id: 'connection', environment_id: 'device', command: 'device connection', execution_ref: execution.ref, result: 'failed' });
  task(root, { action: 'review', stage: 'change', execution_ref: execution.ref, verdict: 'findings', findings: [{ id: 'F1', text: '真机重连失败' }] });
  const source = storeReadFile(root, prepared.ref);
  put(root, '.workflow-system/PRODUCT.yaml', JSON.stringify({ schema: 'vnext-product-manifest/v1', project_id: 'test-project', maintenance: 'enabled', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/PROJECT.md'], source_paths: ['.workflow-system/records/**'], exclude_paths: [] }));
  const meta = { schema: 'vnext-product-doc/v2', items: [{ id: 'GOAL-A', type: 'goal', scope: 'current', task_bindings: [{ id: 'B1', task: { task_id: prepared.task_id, plan_ref: prepared.ref, source: { kind: 'file', path: prepared.ref, sha256: sha(source) } }, role: 'repair', coverage: '同一会话连接', origin: 'declared', state: 'active' }] }] };
  put(root, 'docs/product/PROJECT.md', `---\n${JSON.stringify(meta)}\n---\n## [GOAL-A] 连接\n### 目标说明\n同一会话继续\n### 范围边界\n本次连接\n`);
  return { base, root, prepared, source };
}

test('migration registers only cited original paths and verifies their reader scope as well as bytes', async t => {
  const { base, root, prepared, source } = fixture(t);
  const manifestPath = path.join(root, '.workflow-system/PRODUCT.yaml');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.source_paths = ['docs/product/sources/**'];
  const originalManifest = '# 项目自有读取范围\n' + stringify(manifest);
  fs.writeFileSync(manifestPath, originalManifest);
  const before = files(root), plan = planMigration(root);
  assert.deepEqual(files(root), before, 'planning must not register or delete anything');
  assert.deepEqual(plan.readable_sources.map(source => source.path), [prepared.ref]);
  const edit = plan.policy_edits.find(edit => edit.path === '.workflow-system/PRODUCT.yaml');
  assert(edit, 'a retained citation outside the old reader scope needs an explicit planned edit');
  assert.equal(edit.before_sha256, sha(originalManifest));
  assert.deepEqual(parse(edit.content), { ...manifest, source_paths: [...manifest.source_paths, prepared.ref] });
  assert(edit.content.includes('# 项目自有读取范围'));
  const backup = path.join(base, 'scope.tar.gz');
  await applyMigration(root, plan, backup);
  assert.deepEqual(fs.readFileSync(path.join(root, prepared.ref)), source);
  assert.equal(verifyMigration(root, plan).readable_sources, 1);
  const final = files(root);
  assert.equal((await applyMigration(root, plan, backup)).status, 'already-migrated');
  assert.deepEqual(files(root), final, 'retries must not duplicate source registrations');
  const editedPlan = { ...plan, readable_sources: [] };
  assert.throws(() => verifyMigration(root, editedPlan), { code: 'MIGRATION_PLAN_INVALID' });
  const restored = path.join(base, 'scope-restored');
  await restoreMigration(backup, restored);
  assert.equal(fs.readFileSync(path.join(restored, '.workflow-system/PRODUCT.yaml'), 'utf8'), originalManifest);
  fs.writeFileSync(manifestPath, originalManifest);
  assert.throws(() => verifyMigration(root, plan), { code: 'MIGRATION_SOURCE_SCOPE_UNREADABLE' },
    'unchanged file bytes do not prove that a reader is allowed to open the source');
});

test('migration respects existing reader scopes, exclusions and frozen manifests', async t => {
  const { base, root, prepared } = fixture(t);
  const manifestPath = path.join(root, '.workflow-system/PRODUCT.yaml');
  const original = fs.readFileSync(manifestPath, 'utf8'), manifest = JSON.parse(original);
  assert(!planMigration(root).policy_edits.some(edit => edit.path === '.workflow-system/PRODUCT.yaml'));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, exclude_paths: [prepared.ref] }));
  const excluded = files(root);
  assert.throws(() => planMigration(root), { code: 'MIGRATION_SOURCE_EXCLUDED' });
  assert.deepEqual(files(root), excluded);
  fs.writeFileSync(manifestPath, '# @frozen\n' + stringify({ ...manifest, source_paths: [] }));
  assert.throws(() => planMigration(root), { code: 'FILE_FROZEN' });
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, source_paths: [] }));
  const plan = planMigration(root);
  fs.writeFileSync(manifestPath, original);
  await assert.rejects(applyMigration(root, plan, path.join(base, 'changed-scope.tar.gz')), { code: 'MIGRATION_SOURCE_CHANGED' });
  assert(!fs.existsSync(path.join(root, '.workflow-system/tasks')));
});

test('a reader-policy write failure keeps old sources and resumes the same migration safely', async t => {
  const { base, root, prepared } = fixture(t);
  const manifestPath = path.join(root, '.workflow-system/PRODUCT.yaml');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(manifestPath, stringify({ ...manifest, source_paths: [] }));
  const plan = planMigration(root), backup = path.join(base, 'policy-retry.tar.gz');
  const write = fsMutable.writeFileSync;
  fsMutable.writeFileSync = (file, ...args) => {
    if (file === manifestPath) throw Object.assign(Error('simulated policy write failure'), { code: 'EACCES' });
    return write(file, ...args);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(applyMigration(root, plan, backup), error => error.code === 'EACCES' && error.migration_published); }
  finally { fsMutable.writeFileSync = write; syncBuiltinESMExports(); }
  assert(fs.existsSync(path.join(root, prepared.ref)));
  for (const ref of plan.remove) assert(fs.existsSync(path.join(root, ref)), 'scope failure must precede reclamation');
  put(root, 'FREEZE_REGISTRY.md', '`' + '.workflow-system/PRODUCT.yaml' + '`\n');
  await assert.rejects(applyMigration(root, plan, backup), { code: 'FREEZE_REVIEW_REQUIRED' });
  fs.unlinkSync(path.join(root, 'FREEZE_REGISTRY.md'));
  assert.equal((await applyMigration(root, plan, backup)).status, 'migrated');
  assert.equal(verifyMigration(root, plan).readable_sources, 1);
});

test('archived journal migrates exact identities, scope, separate failures and fixed citations; backup restores old bytes', async t => {
  const { base, root, prepared, source } = fixture(t);
  for (const action of ['create', 'verify', 'quarantine', 'reclaim']) archive(root, { action });
  assert.equal(fs.existsSync(path.join(root, prepared.ref)), false);
  const before = files(root), plan = planMigration(root);
  assert.deepEqual(files(root), before, 'planning must be read-only');
  assert.equal(plan.summary.tasks, 1);
  assert.equal(plan.preserved_sources.length, 1);
  const converted = plan.tasks[0];
  assert.equal(converted.task_id, prepared.task_id);
  assert.deepEqual(converted.plans[0].constraints, ['不可改会话身份']);
  assert.deepEqual(converted.remaining_work, ['真机连接仍失败']);
  assert.deepEqual(converted.plans[0].steps[0].checks.map(c => c.result).sort(), ['failed', 'passed']);
  assert.equal(converted.plans[0].steps[0].findings[0].text, '真机重连失败');
  const backup = path.join(base, 'old.tar.gz'), result = await applyMigration(root, plan, backup);
  assert.equal(result.status, 'migrated', JSON.stringify(result));
  assert.deepEqual(storeReadFile(root, prepared.ref), source);
  assert.equal(queryStatus(root).kind, 'task-query/v2');
  assert.equal(queryStatus(root).current_task_id, prepared.task_id);
  const originalDocs = new Map(before).get('docs/product/PROJECT.md');
  assert.equal(sha(fs.readFileSync(path.join(root, 'docs/product/PROJECT.md'))), originalDocs);
  assert.equal(fs.existsSync(path.join(root, '.workflow-system/records/archives/catalog.json')), false);
  const final = files(root);
  assert.equal((await applyMigration(root, plan, backup)).status, 'already-migrated');
  assert.deepEqual(files(root), final);
  assert.equal((await verifyMigrationBackup(backup, plan.inputs)).files, plan.inputs.length);
  const restored = path.join(base, 'history-inspection');
  await restoreMigration(backup, restored);
  assert.deepEqual(files(restored), before);
  assert.deepEqual(storeReadFile(restored, prepared.ref), source);
  await assert.rejects(restoreMigration(backup, root), { code: 'RESTORE_TARGET_EXISTS' });
  execFileSync('git', ['init', '-q'], { cwd: root });
  const checkpoint = gitCheckpoint(root, { action: 'plan', mode: 'checkpoint', business_paths: ['docs/product/PROJECT.md'] });
  assert(!checkpoint.issues?.some(i => i.code === 'REFERENCE_MISSING' || i.code === 'REFERENCE_NOT_SELECTED'), JSON.stringify(checkpoint.issues));
});

test('changed source and an old installed reader stop before publication or cleanup', async t => {
  const { root, base } = fixture(t), plan = planMigration(root);
  put(root, 'docs/product/PROJECT.md', fs.readFileSync(path.join(root, 'docs/product/PROJECT.md'), 'utf8') + '\n用户新注释\n');
  await assert.rejects(applyMigration(root, plan, path.join(base, 'stale.tar.gz')), { code: 'MIGRATION_SOURCE_CHANGED' });
  assert.equal(fs.existsSync(path.join(root, '.workflow-system/tasks')), false);
  fs.unlinkSync(path.join(root, '.workflow-system/runtime/support/task-state.mjs'));
  const current = planMigration(root);
  await assert.rejects(applyMigration(root, current, path.join(base, 'old-runtime.tar.gz')), { code: 'RUNTIME_UPGRADE_REQUIRED' });
  assert.equal(fs.existsSync(path.join(root, '.workflow-system/tasks')), false);
  assert.equal(fs.existsSync(path.join(base, 'old-runtime.tar.gz')), false);
});

test('unrecognized structured results and concurrent reports never become passing current checks', t => {
  const { root } = fixture(t), view = queryStatus(root, { detail: 'full' }), old = view.tasks[0];
  old.steps[0].tests = [{ ref: 'a', command: 'unit', result: { status: 'passed-with-limit', stdout: 'large output' } }, { ref: 'b', command: 'unit', result: 'passed' }];
  const converted = convertLegacyTask(old, rows => rows);
  const check = converted.plans[0].steps[0].checks[0];
  assert.equal(check.result, 'unknown');
  assert.equal(check.execution_ref, null);
  assert.deepEqual(check.migration.source_refs, ['a', 'b']);
  old.steps[0].tests.pop();
  const one = convertLegacyTask(old, rows => rows).plans[0].steps[0].checks[0];
  assert.equal(one.result, 'unknown');
  assert.equal(one.original_result_label, 'passed-with-limit');
  assert(!JSON.stringify(one).includes('large output'));
});

test('an edited current display survives migration with a pending-display result', async t => {
  const { base, root } = fixture(t);
  const ref = 'docs/workflow/CURRENT_TASK.md';
  fs.appendFileSync(path.join(root, ref), '\n用户手写的遗留说明\n');
  const before = fs.readFileSync(path.join(root, ref)), plan = planMigration(root);
  assert.equal(plan.display_verified, false);
  const result = await applyMigration(root, plan, path.join(base, 'display.tar.gz'));
  assert.equal(result.status, 'migrated-pending-display');
  assert.deepEqual(fs.readFileSync(path.join(root, ref)), before);
  assert.equal(queryStatus(root).kind, 'task-query/v2');
});

test('backup corruption is detected and restore refuses an existing project', async t => {
  const { base, root } = fixture(t), plan = planMigration(root), archive = path.join(base, 'original.tar.gz');
  await applyMigration(root, plan, archive);
  const damaged = path.join(base, 'damaged.tar.gz');
  const bytes = fs.readFileSync(archive); bytes[Math.floor(bytes.length / 2)] ^= 255; fs.writeFileSync(damaged, bytes);
  await assert.rejects(verifyMigrationBackup(damaged));
  const before = files(root);
  await assert.rejects(restoreMigration(archive, root), { code: 'RESTORE_TARGET_EXISTS' });
  assert.deepEqual(files(root), before);
});

test('publication failure keeps old authority; cleanup failure keeps new authority and resumes from the verified backup', async t => {
  for (const phase of ['publish', 'cleanup']) await t.test(phase, async t => {
    const { base, root } = fixture(t), plan = planMigration(root), backup = path.join(base, 'retry.tar.gz');
    const rename = fsMutable.renameSync, unlink = fsMutable.unlinkSync;
    const broken = path.join(root, phase === 'publish' ? '.workflow-system/tasks' : plan.remove[0]);
    if (phase === 'publish') fsMutable.renameSync = (from, to) => { if (to === broken) throw Object.assign(Error('simulated publication failure'), { code: 'EACCES' }); return rename(from, to); };
    else fsMutable.unlinkSync = file => { if (file === broken) throw Object.assign(Error('simulated cleanup failure'), { code: 'EACCES' }); return unlink(file); };
    syncBuiltinESMExports();
    try { await assert.rejects(applyMigration(root, plan, backup), e => e.code === 'EACCES' && e.migration_published === (phase === 'cleanup')); }
    finally { fsMutable.renameSync = rename; fsMutable.unlinkSync = unlink; syncBuiltinESMExports(); }
    assert.equal((await verifyMigrationBackup(backup)).files, plan.inputs.length);
    if (phase === 'publish') {
      assert.equal(fs.existsSync(path.join(root, '.workflow-system/tasks')), false);
      assert.equal(queryStatus(root).kind, 'task-query/v1');
    } else {
      assert.equal(queryStatus(root).kind, 'task-query/v2');
      const retry = await applyMigration(root, plan, backup);
      assert.equal(retry.status, 'migrated');
      assert.equal((await applyMigration(root, plan, backup)).status, 'already-migrated');
    }
  });
});

test('an explicitly cited old pack keeps a complete byte-identical envelope without requiring its old causal graph', async t => {
  const { base, root } = fixture(t);
  for (const action of ['create', 'verify', 'quarantine', 'reclaim']) archive(root, { action });
  const pack = files(root).find(([ref]) => /\/archives\/[a-f0-9]+\/pack-.*\.bin$/.test(ref));
  const document = 'docs/product/PROJECT.md';
  fs.appendFileSync(path.join(root, document), `\n[归档依据](${pack[0]})\n`);
  const plan = planMigration(root);
  assert(plan.preserved_sources.some(e => e.path.endsWith('/manifest.json')));
  await applyMigration(root, plan, path.join(base, 'pinned-pack.tar.gz'));
  assert.equal(sha(fs.readFileSync(path.join(root, pack[0]))), pack[1]);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const checkpoint = gitCheckpoint(root, { mode: 'checkpoint' });
  assert(!checkpoint.issues?.some(i => /ARCHIVE|REFERENCE_MISSING|REFERENCE_NOT_SELECTED/.test(i.code)), JSON.stringify(checkpoint.issues));
});

test('final remaining-work lists supersede older statements; unknown files are not classified as disposable process data', async t => {
  const { base, root, prepared } = fixture(t);
  task(root, { action: 'close', task_ref: prepared.task_id, decision_text: '关闭，不推导测试通过', remaining_work: [], gaps: ['历史真机失败不认证当前代码'] });
  put(root, '.workflow-system/records/project-note.md', '项目自己的说明\n');
  const plan = planMigration(root), converted = plan.tasks[0];
  assert.deepEqual(converted.remaining_work, []);
  assert.deepEqual(converted.plans[0].steps[0].execution.remaining_work, ['真机连接仍失败']);
  assert.deepEqual(converted.migration.latest_lifecycle.gaps, ['历史真机失败不认证当前代码']);
  assert(!plan.remove.includes('.workflow-system/records/project-note.md'));
  await applyMigration(root, plan, path.join(base, 'closed.tar.gz'));
  assert.equal(queryStatus(root).lifecycle_counts.closed, 1);
  assert.equal(fs.readFileSync(path.join(root, '.workflow-system/records/project-note.md'), 'utf8'), '项目自己的说明\n');
});

test('installed admin CLI uses build-time reader hashes rather than comparing an installed module with itself', t => {
  const { base, root } = fixture(t), script = path.join(root, '.workflow-system/runtime/support/task-state-migration.js');
  put(root, '.workflow-system/runtime/package.json', '{"type":"module"}');
  fs.copyFileSync(fileURLToPath(new URL('../runtime/vnext/dist/task-state-migration.js', import.meta.url)), script);
  fs.appendFileSync(path.join(root, '.workflow-system/runtime/support/assistance.mjs'), '\n// Different installed reader bytes\n');
  const planFile = path.join(base, 'installed-plan.json'), backup = path.join(base, 'blocked-backup.tar.gz');
  const planned = spawnSync(process.execPath, [script, 'plan', '--root', root, '--out', planFile], { encoding: 'utf8', windowsHide: true });
  assert.equal(planned.status, 0, planned.stderr);
  const apply = spawnSync(process.execPath, [script, 'apply', '--root', root, '--plan', planFile, '--backup', backup], { encoding: 'utf8', windowsHide: true });
  assert.equal(apply.status, 1);
  assert.equal(JSON.parse(apply.stderr).code, 'RUNTIME_UPGRADE_REQUIRED');
  assert.equal(fs.existsSync(path.join(root, '.workflow-system/tasks')), false);
  assert.equal(fs.existsSync(backup), false);
});

test('historical plan and lifecycle import times do not invent Task creation or closure times', t => {
  const { root } = fixture(t), definition = { title: '历史导入计划', steps: [{ id: 'S1', title: '保留旧范围' }] };
  const raw = record(root, { kind: 'plan', body: definition });
  const imported = task(root, { action: 'link', record_ref: raw.ref, event: { action: 'prepare', data: { create: true, plan: definition } } });
  const oldClose = record(root, { kind: 'historical-task-lifecycle-source', body: { original_status: 'closed' },
    links: queryStatus(root, { detail: 'full' }).heads.map(ref => ({ relation: 'after', ref })) });
  task(root, { action: 'link', record_ref: oldClose.ref, event: { action: 'close', task_id: imported.task_id, data: { remaining_work: [] } } });
  const plan = planMigration(root);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks.find(t => t.task_id === imported.task_id).created_at, null);
  assert.equal(plan.tasks.find(t => t.task_id === imported.task_id).lifecycle, 'closed');
  assert.equal(plan.tasks.find(t => t.task_id === imported.task_id).closed_at, null);
});

test('a business-bound migrated candidate scope survives later normal candidate replacement', async t => {
  const { root, base, prepared } = fixture(t);
  const candidate = task(root, { action: 'prepare', task_ref: prepared.task_id, plan: { title: '已绑定候选', steps: [{ id: 'S2', title: '范围待采用' }] } });
  const document = path.join(root, 'docs/product/PROJECT.md'), text = fs.readFileSync(document, 'utf8');
  const match = /^---\n([\s\S]*?)\n---/.exec(text), metadata = JSON.parse(match[1]);
  metadata.items[0].task_bindings[0].task.plan_ref = candidate.ref;
  fs.writeFileSync(document, text.replace(match[1], JSON.stringify(metadata)));
  const plan = planMigration(root);
  assert.equal(plan.tasks[0].plans.find(p => p.ref === candidate.ref).retained, true);
  await applyMigration(root, plan, path.join(base, 'bound-scope.tar.gz'));
  const result = task(root, { action: 'prepare', task_ref: prepared.task_id, expected_revision: 1, idempotency_key: 'new-candidate', plan: { title: '下一候选', steps: [{ id: 'S3', title: '下一范围' }] } });
  assert.equal(result.recorded, true, JSON.stringify(result));
  const query = queryStatus(root, { detail: 'task', task_ref: prepared.task_id });
  assert(query.task.plans.some(p => p.ref === candidate.ref));
});

test('restoration writes whole chunks when a single low-level write may be partial', async t => {
  const { root, base } = fixture(t), plan = planMigration(root), archive = path.join(base, 'full-write.tar.gz');
  await applyMigration(root, plan, archive);
  const original = fsMutable.writeSync;
  fsMutable.writeSync = (fd, buffer, offset = 0, length = buffer.length - offset, position = null) =>
    original(fd, buffer, offset, Math.max(1, Math.floor(length / 2)), position);
  syncBuiltinESMExports();
  const restored = path.join(base, 'whole-chunks');
  try { await restoreMigration(archive, restored); }
  finally { fsMutable.writeSync = original; syncBuiltinESMExports(); }
  for (const entry of plan.inputs) assert.equal(sha(fs.readFileSync(path.join(restored, entry.path))), entry.sha256, entry.path);
});

test('a closed legacy focus remains historical and does not become the current Task', async t => {
  const { root, base, prepared } = fixture(t);
  task(root, { action: 'close', task_ref: prepared.task_id, decision_text: '完成并关闭', remaining_work: [] });
  const before = queryStatus(root, { detail: 'full' });
  assert.equal(before.current_task_id, null);
  assert.equal(before.focus.task_id, prepared.task_id);
  const plan = planMigration(root);
  assert.equal(plan.project.current_task_id, null);
  assert.equal(plan.project.migration.previous_focus.task_id, prepared.task_id);
  await applyMigration(root, plan, path.join(base, 'closed-focus.tar.gz'));
  const after = queryStatus(root);
  assert.equal(after.current_task_id, null);
  assert(!after.issues.some(issue => issue.code === 'FOCUS_UNRESOLVED'));
});
