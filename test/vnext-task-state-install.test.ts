import { afterAll, beforeAll, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';
import { installDistribution, upgradeDistribution } from '../scripts/vibe-governance-distribution';
import { task, queryStatus, snapshot } from '../runtime/vnext/support/assistance.mjs';

const ROOT = path.resolve(import.meta.dir, '..');
const roots: string[] = [];
let packageRoot: string;
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
function temp() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-state-install-')); roots.push(root); return root; }
function put(root: string, ref: string, data: string | Buffer) { fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), data); }
function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(ref: string) {
    for (const entry of fs.readdirSync(path.join(root, ref), { withFileTypes: true })) {
      const child = ref ? `${ref}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child); else result[child] = sha(fs.readFileSync(path.join(root, child)));
    }
  }
  walk(''); return result;
}
function project(home = 'notes/工作流') {
  const root = temp();
  put(root, 'package.json', '{"name":"task-state-policy-fixture","private":true}\n');
  put(root, '.workflow-system/PROJECT_PROFILE.yaml', `paths:\n  workflow_home: ${home}\n`);
  return root;
}
beforeAll(() => {
  packageRoot = path.join(temp(), 'candidate');
  buildVibeGovernanceDistribution({ sourceRoot: ROOT, outputRoot: packageRoot });
  // A local package consumer has its declared yaml dependency, without network setup.
  fs.cpSync(fs.realpathSync(path.join(ROOT, 'node_modules/yaml')), path.join(packageRoot, 'node_modules/yaml'), { recursive: true });
}, 45000);
afterAll(() => {
  for (const root of roots) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root).startsWith('vnext-state-install-')).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native candidate install merges scoped rules, preserves v2 facts and respects custom workflow_home', () => {
  const root = project(), home = 'notes/工作流';
  const created = task(root, { action: 'prepare', workflow_home: home, idempotency_key: randomUUID(), plan: {
    title: 'Existing current Task', steps: [{ id: 'S1', title: 'Reconnect' }] } });
  expect(created.recorded).toBe(true);
  put(root, '.workflow-system/.gitignore', '# local ignore\r\n/my-local-tool/\r\n');
  put(root, '.workflow-system/.gitattributes', '# local attributes\r\nlocal-data/** -diff\r\n');
  put(root, `${home}/.gitignore`, '# local view rules\r\n/private-note.md\r\n');
  put(root, 'business.txt', 'must remain\n');
  const before = tree(root);
  const dry = installDistribution({ targetRoot: root, packageRoot, dryRun: true });
  expect(dry.status, JSON.stringify(dry.blockers)).toBe('ready');
  expect(dry.planned_writes).toContain(`${home}/.gitignore`);
  expect(tree(root)).toEqual(before);
  const result = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath,
    [path.join(packageRoot, 'dist/cli.js'), 'install', '--root', root, '--json'], { encoding: 'utf8', windowsHide: true, timeout: 45000 });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(JSON.parse(result.stdout).status).toBe('installed');
  for (const [ref, digest] of Object.entries(before)) {
    if (ref.endsWith('/.gitignore') || ref.endsWith('/.gitattributes')) continue;
    expect(sha(fs.readFileSync(path.join(root, ref))), ref).toBe(digest);
  }
  expect(fs.readFileSync(path.join(root, '.workflow-system/.gitignore'), 'utf8')).toStartWith('# local ignore\r\n/my-local-tool/\r\n');
  expect(fs.readFileSync(path.join(root, '.workflow-system/.gitattributes'), 'utf8')).toStartWith('# local attributes\r\nlocal-data/** -diff\r\n');
  expect(fs.readFileSync(path.join(root, `${home}/.gitignore`), 'utf8')).toStartWith('# local view rules\r\n/private-note.md\r\n');
  const state = JSON.parse(fs.readFileSync(path.join(root, '.workflow-system/vnext/DISTRIBUTION_STATE.json'), 'utf8'));
  expect(state.managed_files.some((entry: { path: string }) => entry.path.startsWith('.workflow-system/tasks/') || entry.path.startsWith('.workflow-system/records/')
    || entry.path === '.workflow-system/.gitignore' || entry.path === '.workflow-system/.gitattributes')).toBe(false);
  const cli = path.join(root, '.workflow-system/runtime/support/assistance.mjs');
  const query = spawnSync('node', [cli, 'task-status', '--root', root], { input: '{}', encoding: 'utf8', windowsHide: true });
  expect(query.status, query.stderr).toBe(0);
  expect(JSON.parse(query.stdout).kind).toBe('task-query/v2');
  expect(JSON.parse(query.stdout).tasks[0].task_id).toBe(created.task_id);
  expect(fs.existsSync(path.join(root, '.workflow-system/runtime/support/task-state-migration.js'))).toBe(true);
  expect(fs.readFileSync(path.join(root, '.workflow-system/runtime/support/TASK_STATE_MIGRATION.md'), 'utf8')).toContain('不会执行它');
  const migration = spawnSync('node', [path.join(root, '.workflow-system/runtime/support/task-state-migration.js'),
    'plan', '--root', root, '--out', path.join(temp(), 'should-not-be-written.json')], { encoding: 'utf8', windowsHide: true });
  expect(migration.status).toBe(1);
  expect(JSON.parse(migration.stderr).code).toBe('TASK_STATE_ALREADY_PRESENT');
  const installed = tree(root);
  expect(upgradeDistribution({ targetRoot: root, packageRoot }).status).toBe('no-op');
  expect(tree(root)).toEqual(installed);
}, 45000);

test('same-version upgrade restores missing policy without owning custom bytes or changing Task/tmp/history', () => {
  const root = project();
  expect(installDistribution({ targetRoot: root, packageRoot }).status).toBe('installed');
  const created = task(root, { action: 'prepare', idempotency_key: randomUUID(), title: 'Existing data' });
  put(root, 'run.log', 'output'); snapshot(root, { task_ref: created.task_id, path: 'run.log' });
  put(root, '.workflow-system/records/events/legacy.json', 'historical bytes');
  put(root, '.workflow-system/.gitignore', '# custom-only\r\n/local/\r\n');
  const before = tree(root);
  const dry = upgradeDistribution({ targetRoot: root, packageRoot, dryRun: true });
  expect(dry.status, JSON.stringify(dry.blockers)).toBe('ready'); expect(tree(root)).toEqual(before);
  const result = upgradeDistribution({ targetRoot: root, packageRoot });
  expect(result.status, JSON.stringify(result.blockers)).toBe('upgraded');
  for (const [ref, digest] of Object.entries(before).filter(([ref]) => ref.startsWith('.workflow-system/tasks/') || ref.startsWith('.workflow-system/tmp/') || ref.startsWith('.workflow-system/records/')))
    expect(sha(fs.readFileSync(path.join(root, ref))), ref).toBe(digest);
  expect(fs.readFileSync(path.join(root, '.workflow-system/.gitignore'), 'utf8')).toStartWith('# custom-only\r\n/local/\r\n');
}, 45000);

test('unmanaged current documents are preserved and are not newly ignored by installation', () => {
  const root = project();
  put(root, 'notes/工作流/CURRENT_TASK.md', '# Project-owned working note\n');
  const before = fs.readFileSync(path.join(root, 'notes/工作流/CURRENT_TASK.md'));
  const result = installDistribution({ targetRoot: root, packageRoot });
  expect(result.status, JSON.stringify(result.blockers)).toBe('installed');
  expect(fs.readFileSync(path.join(root, 'notes/工作流/CURRENT_TASK.md'))).toEqual(before);
  expect(fs.existsSync(path.join(root, 'notes/工作流/.gitignore'))).toBe(false);
  expect(queryStatus(root).kind).toBe('task-query/v1');
}, 45000);

test('frozen or modified managed policy blocks stop configuration without touching project data', () => {
  for (const content of ['# DO NOT MODIFY\n', '# BEGIN vNext checkpoint Git policy\n/customized/\n# END vNext checkpoint Git policy\n']) {
    const root = project(); put(root, '.workflow-system/.gitignore', content);
    const before = tree(root), result = installDistribution({ targetRoot: root, packageRoot });
    expect(result.status).not.toBe('installed'); expect(result.blockers.some(issue => /POLICY_FILE_FROZEN|POLICY_BLOCK_EDITED/.test(issue.message))).toBe(true);
    expect(tree(root)).toEqual(before);
  }
}, 45000);

test('unreadable current data does not gate software installation or get newly hidden', () => {
  const root = project();
  fs.mkdirSync(path.join(root, 'notes/工作流/CURRENT_TASK.md'), { recursive: true });
  put(root, 'notes/工作流/CURRENT_TASK.md/user-note.txt', 'preserve unreadable display content');
  const result = installDistribution({ targetRoot: root, packageRoot });
  expect(result.status, JSON.stringify(result.blockers)).toBe('installed');
  expect(result.warnings.some(issue => issue.code === 'GIT_DISPLAY_POLICY_DEFERRED')).toBe(true);
  expect(fs.readFileSync(path.join(root, 'notes/工作流/CURRENT_TASK.md/user-note.txt'), 'utf8')).toBe('preserve unreadable display content');
  expect(fs.existsSync(path.join(root, 'notes/工作流/.gitignore'))).toBe(false);
}, 45000);

test('policy, host guidance and software all roll back on failed promotion', () => {
  const root = project();
  put(root, 'AGENTS.md', '# Application instructions\n');
  put(root, '.workflow-system/.gitignore', '# original custom policy\r\n');
  const before = tree(root);
  const result = installDistribution({ targetRoot: root, packageRoot, testHooks: { afterPromotion: () => { throw new Error('injected promotion failure'); } } });
  expect(result.status).not.toBe('installed'); expect(result.blockers.some(issue => issue.code === 'PROMOTION_FAILED')).toBe(true);
  expect(tree(root)).toEqual(before);
}, 45000);

test('installed close-task rules finish retention/accounting before task-owned cleanup', () => {
  const close = fs.readFileSync(path.join(packageRoot, 'payload/migration-source/templates/vnext/skills/close-task.SKILL.md.tmpl'), 'utf8');
  expect(close).toContain('closed task_ref');
  expect(close).toContain('latest expected_revision');
  expect(close.indexOf('### v2 final materials and local cleanup')).toBeGreaterThan(close.indexOf('Local assessment after task closure'));
  expect(close).toContain('do not ask a model to classify every temporary file');
  expect(close).toContain('Do not select the returned parent focus for cleanup');
});

test('build help and unknown arguments never start a default build', () => {
  const output = path.join(temp(), 'not-created');
  const script = path.join(ROOT, 'scripts/build-vibe-governance-distribution.ts');
  const help = spawnSync('bun', ['run', script, '--help', '--out', output], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  expect(help.status, help.stderr).toBe(0); expect(help.stdout).toContain('Usage:');
  expect(fs.existsSync(output)).toBe(false);
  const invalid = spawnSync('bun', ['run', script, '--unexpected', '--out', output], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  expect(invalid.status).toBe(1); expect(fs.existsSync(output)).toBe(false);
});
