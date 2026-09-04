import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'node:child_process';
import {
  buildVibeGovernanceDistribution,
} from '../scripts/build-vibe-governance-distribution';
import {
  classifyDistribution,
  installDistribution,
  migrateDistribution,
  upgradeDistribution,
  VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH,
} from '../scripts/vibe-governance-distribution';

const ROOT = path.resolve(import.meta.dir, '..');
const packageRoot = path.join(ROOT, 'packages', 'vibe-governance');
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

beforeAll(() => {
  // The package build is normally performed by the package script. Keeping
  // this assertion here makes the focused test useful on its own as well.
  if (!fs.existsSync(path.join(packageRoot, 'dist', 'cli.js')) || !fs.existsSync(path.join(packageRoot, 'payload', 'distribution-manifest.json'))) {
    buildVibeGovernanceDistribution({ outputRoot: packageRoot });
  }
});

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Vibe Governance Distribution / Installer', () => {
  test('fresh Node install promotes complete software and leaves governance unbootstrapped', { timeout: 30000 }, () => {
    const target = freshTarget();
    const result = installDistribution({ targetRoot: target, packageRoot });
    expect(result.status).toBe('installed');
    expect(result.read_back_verified).toBe(true);
    expect(result.next).toBe('/bootstrap-project');
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
      expect(fs.statSync(targetPath(target, `.agents/skills/${skill}`)).isDirectory()).toBe(true);
      expect(fs.existsSync(targetPath(target, `.agents/skills/${skill}/SKILL.md`))).toBe(true);
    }
    const runtimeCli = targetPath(target, '.workflow-system/runtime/dist/cli.js');
    expect(() => execFileSync('node', [runtimeCli, 'validate-contract', '--root', target], { encoding: 'utf8' })).not.toThrow();
    expect(() => execFileSync('node', [runtimeCli, 'validate', '--root', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).toThrow(/BOOTSTRAP_REQUIRED/u);
  });

  test('same-version install is a read-back no-op and managed drift fails closed', { timeout: 30000 }, () => {
    const target = freshTarget();
    expect(installDistribution({ targetRoot: target, packageRoot }).status).toBe('installed');
    const replay = installDistribution({ targetRoot: target, packageRoot });
    expect(replay.status).toBe('no-op');
    fs.appendFileSync(targetPath(target, '.agents/skills/prepare-task/SKILL.md'), '\nmanaged drift\n', 'utf8');
    const drift = installDistribution({ targetRoot: target, packageRoot });
    expect(drift.status).toBe('rejected');
    expect(drift.blockers.some(issue => issue.code === 'MANAGED_TARGET_DRIFT')).toBe(true);
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
    const result = migrateDistribution({ targetRoot: target, packageRoot });
    expect(result.status).toBe('installed');
    expect(result.read_back_verified).toBe(true);
    expect(result.migration?.status).toBe('installed');
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
  });

  test('tampered payload never promotes and promotion failure rolls back the full preimage', { timeout: 60000 }, () => {
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
