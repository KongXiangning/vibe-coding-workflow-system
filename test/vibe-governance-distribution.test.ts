import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import {
  buildVibeGovernanceDistribution,
  validateDistributionVersionLockstep,
} from '../scripts/build-vibe-governance-distribution';
import {
  classifyDistribution,
  installDistribution,
  migrateDistribution,
  upgradeDistribution,
  VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH,
  VIBE_GOVERNANCE_FRESH_INSTALL_NEXT_HINT,
} from '../scripts/vibe-governance-distribution';

const ROOT = path.resolve(import.meta.dir, '..');
const packageRoot = path.join(ROOT, 'packages', 'vibe-governance');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryRoots: string[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function targetPath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split('/'));
}

function makeLegacyTarget(nonIdle = false): string {
  const target = tempRoot('vibe-governance-legacy-target-');
  fs.cpSync(path.join(ROOT, '.workflow-system'), path.join(target, '.workflow-system'), { recursive: true });
  fs.rmSync(path.join(target, '.workflow-system', 'vnext'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'templates', 'skills'), path.join(target, 'templates', 'skills'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'templates', 'docs'), path.join(target, 'templates', 'docs'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'docs', 'workflow', 'generated', 'workflow-docs'), path.join(target, 'docs', 'workflow'), { recursive: true });
  const currentTaskPath = targetPath(target, 'docs/workflow/CURRENT_TASK.md');
  let currentTask = fs.readFileSync(currentTaskPath, 'utf8')
    .replace('- 当前状态：draft', '- 当前状态：archived')
    .replace('- 生命周期状态：active', '- 生命周期状态：archived')
    .replace('- 任务 ID：{{TASK_ID}}', '- 任务 ID：010')
    .replace('- 任务标题：{{TASK_TITLE}}', '- 任务标题：Migration fixture')
    .replace('- 任务 slug：{{TASK_SLUG}}', '- 任务 slug：migration-fixture')
    .replace('- 当前 handoff：{{CURRENT_HANDOFF}}', '- 当前 handoff：not-applicable');
  if (nonIdle) currentTask = currentTask.replace('当前状态：archived', '当前状态：active').replace('生命周期状态：archived', '生命周期状态：active');
  fs.writeFileSync(currentTaskPath, currentTask, 'utf8');
  fs.mkdirSync(targetPath(target, '.claude/skills'), { recursive: true });
  fs.writeFileSync(targetPath(target, '.claude/skills/workflow-system-create-current-task.SKILL.md'), '# legacy skill\n', 'utf8');
  fs.writeFileSync(targetPath(target, '.workflow-system/install-state.json'), JSON.stringify({ state_version: 1, managed_files: [{ path: '.claude/skills/workflow-system-create-current-task.SKILL.md' }] }, null, 2), 'utf8');
  return target;
}

function freshTarget(): string {
  const target = tempRoot('vibe-governance-fresh-target-');
  fs.writeFileSync(path.join(target, 'package.json'), '{"name":"native-target","private":true}\n', 'utf8');
  return target;
}

function makeReleaseVersionFixture(): string {
  const fixture = tempRoot('vibe-governance-release-version-fixture-');
  for (const relativePath of [
    'packages/vibe-governance/package.json',
    'runtime/vnext/package.json',
    'runtime/vnext/src/kernel.ts',
    'runtime/vnext/dist/cli.js',
    '.workflow-system/vnext/RUNTIME_CONTRACT.yaml',
  ]) {
    const destination = path.join(fixture, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...relativePath.split('/')), destination);
  }
  return fixture;
}

function addUnmanagedBusinessSymlink(target: string): void {
  const linkSource = tempRoot('vibe-governance-business-link-source-');
  fs.mkdirSync(linkSource, { recursive: true });
  fs.writeFileSync(path.join(linkSource, 'package.json'), '{"name":"workspace-link"}\n', 'utf8');
  const linkPath = targetPath(target, 'node_modules/workspace-link');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(linkSource, linkPath, 'junction');
  expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
}

function addManagedFixtureFile(
  target: string,
  state: Record<string, unknown>,
  relativePath: string,
  content: string,
  category = 'runtime',
): void {
  const fullPath = targetPath(target, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  const checksum = crypto.createHash('sha256').update(content).digest('hex');
  const managedFiles = state.managed_files as Array<Record<string, string>>;
  managedFiles.push({ path: relativePath, checksum, category });
}

beforeAll(() => {
  // Build the package entrypoint so CLI-level tests exercise the distributable
  // surface rather than a stale generated bundle.
  buildVibeGovernanceDistribution({ outputRoot: packageRoot });
});

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Vibe Governance Distribution / Installer', () => {
  test('CLI rejects a missing --root value and never falls back to the current directory', () => {
    for (const argv of [['install', '--root'], ['install', '--root', '--json']]) {
      const target = tempRoot('vibe-governance-cli-root-');
      const result = spawnSync(process.execPath, [path.join(packageRoot, 'dist', 'cli.js'), ...argv], {
        cwd: target,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('--root requires a project path');
      expect(fs.existsSync(targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(false);
      expect(fs.existsSync(path.join(target, '--json'))).toBe(false);
    }
  });

  test('packed npm distribution installs and executes its published bin', { timeout: 180000 }, () => {
    const packDirectory = tempRoot('vibe-governance-pack-');
    const npmEnvironment = tempRoot('vibe-governance-npm-environment-');
    const target = freshTarget();
    const packedOutput = execFileSync(
      NPM_COMMAND,
      ['pack', '--json', '--pack-destination', packDirectory],
      { cwd: packageRoot, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' } },
    );
    const packed = JSON.parse(packedOutput) as Array<{ filename?: unknown }>;
    expect(packed).toHaveLength(1);
    expect(typeof packed[0]?.filename).toBe('string');
    const tarball = path.join(packDirectory, packed[0]!.filename as string);
    expect(fs.existsSync(tarball)).toBe(true);

    fs.writeFileSync(
      path.join(npmEnvironment, 'package.json'),
      JSON.stringify({ name: 'vibe-governance-distribution-e2e', version: '1.0.0', private: true }) + '\n',
      'utf8',
    );
    execFileSync(
      NPM_COMMAND,
      ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball],
      { cwd: npmEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_update_notifier: 'false' } },
    );

    const binName = process.platform === 'win32' ? 'vibe-governance.cmd' : 'vibe-governance';
    const binPath = path.join(npmEnvironment, 'node_modules', '.bin', binName);
    expect(fs.existsSync(binPath)).toBe(true);
    const cli = spawnSync(binPath, ['install', '--root', target], {
      cwd: npmEnvironment,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(cli.error).toBeUndefined();
    if (cli.status !== 0) throw new Error(`Installed vibe-governance bin failed (status=${cli.status}): stdout=${cli.stdout}\nstderr=${cli.stderr}`);
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe('');
    expect(cli.stdout).toContain('invoke the `bootstrap-project` Agent Skill');
    expect(fs.existsSync(targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(true);
    expect(fs.existsSync(targetPath(target, '.agents/skills/bootstrap-project/SKILL.md'))).toBe(true);
    expect(fs.existsSync(targetPath(target, '.workflow-system/runtime/dist/cli.js'))).toBe(true);
  });

  test('release builder enforces Distribution and Runtime lockstep versions', () => {
    const currentPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/vibe-governance/package.json'), 'utf8')) as { version: string };
    expect(validateDistributionVersionLockstep(ROOT)).toBe(currentPackage.version);

    const fixture = makeReleaseVersionFixture();
    const distributionPackagePath = path.join(fixture, 'packages', 'vibe-governance', 'package.json');
    const distributionPackage = JSON.parse(fs.readFileSync(distributionPackagePath, 'utf8')) as Record<string, unknown>;
    distributionPackage.version = '0.99.0';
    fs.writeFileSync(distributionPackagePath, JSON.stringify(distributionPackage, null, 2) + '\n', 'utf8');
    expect(() => validateDistributionVersionLockstep(fixture)).toThrow(/lockstep/u);
  });

  test('fresh Node install promotes complete software and leaves governance unbootstrapped', { timeout: 30000 }, () => {
    const target = freshTarget();
    const result = installDistribution({ targetRoot: target, packageRoot });
    expect(result.status).toBe('installed');
    expect(result.read_back_verified).toBe(true);
    expect(result.next).toBe(VIBE_GOVERNANCE_FRESH_INSTALL_NEXT_HINT);
    expect(classifyDistribution(target, undefined).state).toBe('vnext');
    expect(fs.existsSync(targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(true);
    expect(fs.existsSync(targetPath(target, '.workflow-system/PROJECT_PROFILE.yaml'))).toBe(false);
    expect(fs.existsSync(targetPath(target, 'docs/workflow/CURRENT_TASK.md'))).toBe(false);
    const skillDirectories = fs.readdirSync(targetPath(target, '.agents/skills')).sort();
    expect(skillDirectories).toEqual([
      'bootstrap-project',
      'capture-work-item',
      'close-task',
      'debug-task',
      'execute-step',
      'prepare-task',
      'review-change',
      'task-lifecycle',
      'validate-change',
    ]);
    for (const skill of skillDirectories) {
      const skillDirectory = targetPath(target, `.agents/skills/${skill}`);
      const skillFile = path.join(skillDirectory, 'SKILL.md');
      expect(fs.statSync(skillDirectory).isDirectory()).toBe(true);
      expect(fs.existsSync(skillFile)).toBe(true);
      const match = fs.readFileSync(skillFile, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
      expect(match).not.toBeNull();
      const frontmatter = parse(match![1]) as Record<string, unknown>;
      expect(frontmatter.name).toBe(skill);
      expect(typeof frontmatter.description).toBe('string');
      expect(String(frontmatter.description).trim().length).toBeGreaterThan(0);
      expect((frontmatter.entry_contract as Record<string, unknown>).entry).toBe(skill);
    }
    const runtimeCli = targetPath(target, '.workflow-system/runtime/dist/cli.js');
    expect(() => execFileSync('node', [runtimeCli, 'validate-contract', '--root', target], { encoding: 'utf8' })).not.toThrow();
    expect(() => execFileSync('node', [runtimeCli, 'validate', '--root', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).toThrow(/BOOTSTRAP_REQUIRED/u);
  });

  test('fresh install and vNext upgrade ignore unmanaged business symlink trees in rollback preimage', { timeout: 60000 }, () => {
    const target = freshTarget();
    addUnmanagedBusinessSymlink(target);
    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('installed');

    const stateFile = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    state.distribution_version = '0.14.4';
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');

    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('upgrade-required');
    const upgrade = upgradeDistribution({ targetRoot: target, packageRoot });
    expect(upgrade.status).toBe('upgraded');
    expect(upgrade.read_back_verified).toBe(true);
    expect(fs.lstatSync(targetPath(target, 'node_modules/workspace-link')).isSymbolicLink()).toBe(true);
  });

  test('same-version install is a read-back no-op and managed drift fails closed', { timeout: 30000 }, () => {
    const target = freshTarget();
    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('installed');
    const replay = installDistribution({ targetRoot: target, packageRoot });
    expect(replay.status).toBe('no-op');
    expect(replay.next).toBeUndefined();
    fs.appendFileSync(targetPath(target, '.agents/skills/prepare-task/SKILL.md'), '\nmanaged drift\n', 'utf8');
    const drift = installDistribution({ targetRoot: target, packageRoot });
    expect(drift.status).toBe('rejected');
    expect(drift.blockers.some(issue => issue.code === 'MANAGED_TARGET_DRIFT')).toBe(true);
  });

  test('Distribution rejects prerelease and build metadata until a full SemVer comparator is adopted', { timeout: 30000 }, () => {
    const target = freshTarget();
    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('installed');
    const stateFile = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    state.distribution_version = '0.14.5-beta.1';
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
    const result = installDistribution({ targetRoot: target, packageRoot });
    expect(result.status).toBe('rejected');
    expect(result.blockers.some(issue => issue.code === 'DISTRIBUTION_STATE_INVALID')).toBe(true);
    expect(result.blockers.some(issue => issue.message.includes('must be semver'))).toBe(true);
  });

  test('fresh install rejects an unmanaged Runtime dependency directory', { timeout: 30000 }, () => {
    const target = freshTarget();
    fs.mkdirSync(targetPath(target, '.workflow-system/runtime/node_modules'), { recursive: true });
    fs.writeFileSync(targetPath(target, '.workflow-system/runtime/node_modules/unmanaged.txt'), 'target-owned\n', 'utf8');
    const result = installDistribution({ targetRoot: target, packageRoot });
    expect(result.status).toBe('rejected');
    expect(result.blockers.some(issue => issue.code === 'MANAGED_TARGET_CONFLICT')).toBe(true);
    expect(fs.existsSync(targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(false);
    expect(fs.existsSync(targetPath(target, '.workflow-system/runtime/node_modules/unmanaged.txt'))).toBe(true);
  });

  test('install reports migration-required for legacy and migrate rejects non-idle state without mutation', { timeout: 30000 }, () => {
    const legacy = makeLegacyTarget();
    const before = fs.readFileSync(targetPath(legacy, 'docs/workflow/CURRENT_TASK.md'), 'utf8');
    const install = installDistribution({ targetRoot: legacy, packageRoot });
    expect(install.status).toBe('migration-required');
    expect(install.blockers.some(issue => issue.code === 'MIGRATION_REQUIRED')).toBe(true);
    const nonIdle = makeLegacyTarget(true);
    const nonIdleBefore = fs.readFileSync(targetPath(nonIdle, 'docs/workflow/CURRENT_TASK.md'), 'utf8');
    const migration = migrateDistribution({ targetRoot: nonIdle, packageRoot });
    expect(migration.status).toBe('rejected');
    expect(migration.blockers.some(issue => issue.code === 'CURRENT_TASK_NON_IDLE')).toBe(true);
    expect(fs.readFileSync(targetPath(legacy, 'docs/workflow/CURRENT_TASK.md'), 'utf8')).toBe(before);
    expect(fs.readFileSync(targetPath(nonIdle, 'docs/workflow/CURRENT_TASK.md'), 'utf8')).toBe(nonIdleBefore);
    expect(fs.existsSync(targetPath(nonIdle, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(false);
  });

  test('valid idle legacy migrate invokes the Pack and promotes canonical .agents skills', { timeout: 45000 }, () => {
    const target = makeLegacyTarget();
    addUnmanagedBusinessSymlink(target);
    const result = migrateDistribution({ targetRoot: target, packageRoot });
    expect(result.status).toBe('installed');
    expect(result.read_back_verified).toBe(true);
    expect(result.migration?.status).toBe('installed');
    expect(result.next).toBeUndefined();
    expect(fs.existsSync(targetPath(target, '.agents/skills/prepare-task/SKILL.md'))).toBe(true);
    expect(fs.existsSync(targetPath(target, '.claude/skills/workflow-system-create-current-task.SKILL.md'))).toBe(false);
    expect(fs.existsSync(targetPath(target, 'docs/workflow/CURRENT_TASK.md'))).toBe(true);
    expect(fs.existsSync(targetPath(target, '.workflow-system/PROJECT_PROFILE.yaml'))).toBe(true);
    expect(fs.existsSync(targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(true);
  });

  test('install reports upgrade-required and explicit upgrade promotes an older vNext state', { timeout: 60000 }, () => {
    const target = freshTarget();
    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('installed');
    const stateFile = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    state.distribution_version = '0.14.4';
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
    const install = installDistribution({ targetRoot: target, packageRoot });
    expect(install.status).toBe('upgrade-required');
    const upgrade = upgradeDistribution({ targetRoot: target, packageRoot });
    expect(upgrade.status).toBe('upgraded');
    expect(upgrade.read_back_verified).toBe(true);
    expect(upgrade.next).toBeUndefined();
  });

  test('new Distribution State upgrade deletes stale managed files and rejects stale-file drift', { timeout: 90000 }, () => {
    const target = freshTarget();
    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('installed');
    const stateFile = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    const staleSkill = '.agents/skills/removed-skill/SKILL.md';
    const staleRuntime = '.workflow-system/runtime/src/old-helper.ts';
    addManagedFixtureFile(target, state, staleSkill, '# removed skill\n', 'skill');
    addManagedFixtureFile(target, state, staleRuntime, 'export const removed = true;\n');
    state.distribution_version = '0.14.4';
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');

    const upgrade = upgradeDistribution({ targetRoot: target, packageRoot });
    expect(upgrade.status).toBe('upgraded');
    expect(upgrade.planned_deletes).toEqual([staleSkill, staleRuntime].sort());
    expect(upgrade.next).toBeUndefined();
    expect(fs.existsSync(targetPath(target, staleSkill))).toBe(false);
    expect(fs.existsSync(targetPath(target, staleRuntime))).toBe(false);

    const driftTarget = freshTarget();
    expect(installDistribution({ targetRoot: driftTarget, packageRoot }).status).toBe('installed');
    const driftStateFile = targetPath(driftTarget, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    const driftState = JSON.parse(fs.readFileSync(driftStateFile, 'utf8')) as Record<string, unknown>;
    addManagedFixtureFile(driftTarget, driftState, staleRuntime, 'export const original = true;\n');
    driftState.distribution_version = '0.14.4';
    fs.writeFileSync(driftStateFile, JSON.stringify(driftState, null, 2) + '\n', 'utf8');
    fs.writeFileSync(targetPath(driftTarget, staleRuntime), 'export const drifted = true;\n', 'utf8');

    const drift = upgradeDistribution({ targetRoot: driftTarget, packageRoot });
    expect(drift.status).toBe('rejected');
    expect(drift.blockers.some(issue => issue.code === 'MANAGED_TARGET_DRIFT' && issue.path === staleRuntime)).toBe(true);
    expect(fs.readFileSync(targetPath(driftTarget, staleRuntime), 'utf8')).toBe('export const drifted = true;\n');
  });

  test('current Distribution State does not fall back to older INSTALL_STATE ownership', { timeout: 60000 }, () => {
    const target = freshTarget();
    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('installed');
    const preservedPath = '.claude/skills/old-alias.txt';
    const oldState: Record<string, unknown> = {
      schema_version: 1,
      kind: 'vnext-install-state',
      distribution_version: '0.14.4',
      managed_files: [],
    };
    addManagedFixtureFile(target, oldState, preservedPath, 'legacy alias\n', 'legacy-skill');
    const currentStatePath = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    const currentState = JSON.parse(fs.readFileSync(currentStatePath, 'utf8')) as Record<string, unknown>;
    currentState.distribution_version = '0.14.4';
    currentState.managed_files = [];
    fs.writeFileSync(currentStatePath, JSON.stringify(currentState, null, 2) + '\n', 'utf8');
    // An empty current State is the subject of this ownership test. Remove
    // the separately guarded dependency directory so its presence cannot
    // turn the scenario into an unrelated destination conflict.
    fs.rmSync(targetPath(target, '.workflow-system/runtime/node_modules'), { recursive: true, force: true });
    const oldStatePath = targetPath(target, '.workflow-system/vnext/INSTALL_STATE.json');
    fs.mkdirSync(path.dirname(oldStatePath), { recursive: true });
    fs.writeFileSync(oldStatePath, JSON.stringify(oldState, null, 2) + '\n', 'utf8');

    const upgrade = upgradeDistribution({ targetRoot: target, packageRoot });
    expect(upgrade.status).toBe('upgraded');
    expect(upgrade.planned_deletes).not.toContain(preservedPath);
    expect(fs.existsSync(targetPath(target, preservedPath))).toBe(true);
  });

  test('legacy vNext INSTALL_STATE uses compatibility deletion mapping instead of blanket cleanup', { timeout: 60000 }, () => {
    const target = freshTarget();
    const compatibilityPath = '.claude/skills/old-alias.txt';
    const preservedSkillPath = '.agents/skills/old-skill/SKILL.md';
    const preservedRuntimePath = '.workflow-system/runtime/src/old-helper.ts';
    const oldState: Record<string, unknown> = {
      schema_version: 1,
      kind: 'vnext-install-state',
      distribution_version: '0.14.4',
      managed_files: [],
    };
    addManagedFixtureFile(target, oldState, compatibilityPath, 'legacy alias\n', 'legacy-skill');
    addManagedFixtureFile(target, oldState, preservedSkillPath, '# old skill\n', 'skill');
    addManagedFixtureFile(target, oldState, preservedRuntimePath, 'export const old = true;\n');
    const oldStatePath = targetPath(target, '.workflow-system/vnext/INSTALL_STATE.json');
    fs.mkdirSync(path.dirname(oldStatePath), { recursive: true });
    fs.writeFileSync(oldStatePath, JSON.stringify(oldState, null, 2) + '\n', 'utf8');

    const upgrade = upgradeDistribution({ targetRoot: target, packageRoot });
    expect(upgrade.status).toBe('upgraded');
    expect(upgrade.planned_deletes).toEqual([compatibilityPath]);
    expect(fs.existsSync(targetPath(target, compatibilityPath))).toBe(false);
    expect(fs.existsSync(targetPath(target, preservedSkillPath))).toBe(true);
    expect(fs.existsSync(targetPath(target, preservedRuntimePath))).toBe(true);
  });

  test('tampered payload never promotes and promotion failure rolls back the scoped preimage', { timeout: 60000 }, () => {
    const tamperedPackage = buildVibeGovernanceDistribution({ outputRoot: tempRoot('vibe-governance-tampered-package-') }).packageRoot;
    const tamperedManifest = JSON.parse(fs.readFileSync(path.join(tamperedPackage, 'payload', 'distribution-manifest.json'), 'utf8')) as { artifacts: Array<{ source_path: string }> };
    const tamperedArtifact = path.join(tamperedPackage, 'payload', ...tamperedManifest.artifacts[0]!.source_path.split('/'));
    fs.appendFileSync(tamperedArtifact, 'tampered\n', 'utf8');
    const tamperedTarget = freshTarget();
    const tampered = installDistribution({ targetRoot: tamperedTarget, packageRoot: tamperedPackage });
    expect(tampered.status).toBe('rejected');
    expect(tampered.blockers.some(issue => issue.code === 'PAYLOAD_INVALID')).toBe(true);
    expect(fs.existsSync(targetPath(tamperedTarget, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(false);

    const rollbackTarget = freshTarget();
    const rollback = installDistribution({ targetRoot: rollbackTarget, packageRoot, testHooks: { afterPromotion: () => { throw new Error('injected distribution promotion failure'); } } });
    expect(rollback.status).toBe('rejected');
    expect(rollback.blockers.some(issue => issue.code === 'PROMOTION_FAILED')).toBe(true);
    expect(fs.existsSync(targetPath(rollbackTarget, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH))).toBe(false);
    expect(fs.existsSync(targetPath(rollbackTarget, '.workflow-system/vnext/DISTRIBUTION_IN_PROGRESS.json'))).toBe(false);
    expect(fs.existsSync(targetPath(rollbackTarget, '.agents/skills'))).toBe(false);
  });
});
