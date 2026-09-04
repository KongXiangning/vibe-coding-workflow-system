import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'node:child_process';
import {
  applyBootstrapProjectProposal,
} from '../runtime/vnext/src/bootstrap';
import {
  bootstrapProject,
  buildBootstrapPlan,
  classifyBootstrapTarget,
  type BootstrapProjectOptions,
} from '../scripts/vnext-bootstrap-project';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';
import { installDistribution, migrateDistribution, validateInstalledDistribution } from '../scripts/vibe-governance-distribution';
import { computeCompleteTreeHash } from '../scripts/vnext-migration-pack';

// P-12 admission for this persistent bootstrap guard:
// the bootstrap boundary combines installed-Distribution prerequisite
// validation, exact governance mutation admission, canonical baseline
// creation, the explicit inventory-to-adoption transition, and
// replay/read-back. Existing source/runtime unit checks do not prove that
// combination against a disposable target root.
const P12_BOOTSTRAP_TEST_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'bootstrap validates one installed Distribution read-only, promotes governance assets only, preserves the explicit inventory-to-adoption transition, leaves no active task, and replays only after authoritative read-back',
  existingEvidenceInsufficiency: 'source contract, Runtime contract, Distribution tests, and atomic helper tests do not cover the facade-to-disposable-target composition, governance-only receipt boundary, or migrated classification together',
  assertionBoundary: 'bootstrap-project source facade, installed Distribution read-back, authoritative Runtime bootstrap transaction, canonical CURRENT_TASK read-back, governance-only receipt, and mode-specific transition',
  failureDisposition: 'block the bootstrap implementation boundary until the target remains unchanged on verifier failure and a successful install is replay-safe',
} as const;

const ROOT = path.resolve(import.meta.dir, '..');
const distributionPackageRoot = path.join(ROOT, 'packages', 'vibe-governance');
const temporaryRoots: string[] = [];

function targetRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-bootstrap-test-'));
  temporaryRoots.push(root);
  return root;
}

function options(target: string): BootstrapProjectOptions {
  return {
    sourceRoot: ROOT,
    distributionPackageRoot,
    targetRoot: target,
    mode: 'greenfield',
    projectName: 'Bootstrap Test Project',
    projectSlug: 'bootstrap-test-project',
    host: 'codex',
    designBaseline: { architecture: 'confirmed disposable baseline' },
    designConfirmed: true,
  };
}

function installDistributionFixture(target: string): void {
  const result = installDistribution({ targetRoot: target, packageRoot: distributionPackageRoot });
  expect(result.status).toBe('installed');
  expect(result.read_back_verified).toBe(true);
}

function makeLegacyGovernedTarget(): string {
  const target = targetRoot();
  fs.cpSync(path.join(ROOT, '.workflow-system'), path.join(target, '.workflow-system'), { recursive: true });
  fs.rmSync(path.join(target, '.workflow-system', 'vnext'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'templates', 'skills'), path.join(target, 'templates', 'skills'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'templates', 'docs'), path.join(target, 'templates', 'docs'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'docs', 'workflow', 'generated', 'workflow-docs'), path.join(target, 'docs', 'workflow'), { recursive: true });
  const currentTaskPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
  const currentTask = fs.readFileSync(currentTaskPath, 'utf8')
    .replace('- 当前状态：draft', '- 当前状态：archived')
    .replace('- 生命周期状态：active', '- 生命周期状态：archived')
    .replace('- 任务 ID：{{TASK_ID}}', '- 任务 ID：010')
    .replace('- 任务标题：{{TASK_TITLE}}', '- 任务标题：Migration fixture')
    .replace('- 任务 slug：{{TASK_SLUG}}', '- 任务 slug：migration-fixture')
    .replace('- 当前 handoff：{{CURRENT_HANDOFF}}', '- 当前 handoff：not-applicable');
  fs.writeFileSync(currentTaskPath, currentTask, 'utf8');
  fs.mkdirSync(path.join(target, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(target, '.claude', 'skills', 'workflow-system-create-current-task.SKILL.md'), '# legacy skill\n', 'utf8');
  fs.writeFileSync(path.join(target, '.workflow-system', 'install-state.json'), JSON.stringify({ state_version: 1, managed_files: [{ path: '.claude/skills/workflow-system-create-current-task.SKILL.md' }] }, null, 2), 'utf8');
  return target;
}

beforeAll(() => {
  buildVibeGovernanceDistribution({ outputRoot: distributionPackageRoot });
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext bootstrap-project', () => {
  test('promotes a disposable project, proves the target Runtime, and replays as a no-op', { timeout: 30000 }, () => {
    expect(P12_BOOTSTRAP_TEST_ADMISSION).toMatchObject({
      decision: 'admitted',
      owner: expect.any(String),
      basis: 'critical-invariant',
    });
    const target = targetRoot();
    const common = options(target);
    fs.writeFileSync(path.join(target, 'package.json'), '{\"name\":\"native-package\",\"private\":true}\\n', 'utf8');
    const missingDistribution = buildBootstrapPlan(common);
    expect(missingDistribution.status).toBe('blocked');
    expect(missingDistribution.blockers.some(issue => issue.code === 'DISTRIBUTION_PREREQUISITE_FAILED')).toBe(true);
    installDistributionFixture(target);
    const distributionStatePath = path.join(target, '.workflow-system', 'vnext', 'DISTRIBUTION_STATE.json');
    const distributionStateBefore = fs.readFileSync(distributionStatePath, 'utf8');
    const distributionState = JSON.parse(distributionStateBefore) as { managed_files: Array<{ path: string; checksum: string }> };
    const distributionSkillPath = path.join(target, '.agents', 'skills', 'prepare-task', 'SKILL.md');
    const distributionSkillBefore = fs.readFileSync(distributionSkillPath, 'utf8');
    fs.writeFileSync(distributionSkillPath, `${distributionSkillBefore}\n`, 'utf8');
    const invalidDistribution = buildBootstrapPlan(common);
    expect(invalidDistribution.status).toBe('blocked');
    expect(invalidDistribution.blockers.some(issue => issue.code === 'DISTRIBUTION_PREREQUISITE_FAILED')).toBe(true);
    fs.writeFileSync(distributionSkillPath, distributionSkillBefore, 'utf8');
    const dry = buildBootstrapPlan(common);
    expect(dry.status).toBe('ready');
    expect(dry.planned_directories).toEqual([]);
    expect(dry.planned_writes.some(relative => relative === '.workflow-system/WORKFLOW_PROTOCOL.md' || relative === '.workflow-system/FILE_SCHEMAS.md' || relative === '.workflow-system/vnext/SOURCE_CONTRACT.yaml' || relative === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml' || relative.startsWith('.workflow-system/runtime/') || relative.startsWith('.agents/skills/'))).toBe(false);
    const changedPaths = [...dry.planned_writes];

    const unauthorized = buildBootstrapPlan({ ...common, changedPaths: [...changedPaths, 'src/main.ts'] });
    expect(unauthorized.status).toBe('blocked');
    expect(unauthorized.blockers.some(issue => issue.code === 'BOOTSTRAP_SCOPE_BLOCKED')).toBe(true);
    const duplicated = buildBootstrapPlan({ ...common, changedPaths: [changedPaths[0], ...changedPaths] });
    expect(duplicated.status).toBe('blocked');
    expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toBe('{\"name\":\"native-package\",\"private\":true}\\n');

    const installed = bootstrapProject({ ...common, write: true, changedPaths });
    expect(installed.status).toBe('installed');
    expect(installed.read_back_verified).toBe(true);
    expect(installed.proposal?.requested_directory_targets).toEqual([]);
    expect(installed.proposal?.requested_write_targets.some(relative => relative === '.workflow-system/WORKFLOW_PROTOCOL.md' || relative === '.workflow-system/FILE_SCHEMAS.md' || relative === '.workflow-system/vnext/SOURCE_CONTRACT.yaml' || relative === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml' || relative.startsWith('.workflow-system/runtime/') || relative.startsWith('.agents/skills/'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.agents', 'skills', 'validate-change', 'SKILL.md'))).toBe(true);
    expect(installed.evidence.map(item => item.id)).toEqual(expect.arrayContaining([
      'source-contract',
      'scope-admission',
      'distribution-read-back',
      'runtime-read-back',
      'canonical-task-read-back',
      'host-isolation',
      'asset-checksum-read-back',
      'receipt-read-back',
    ]));

    const cli = path.join(target, '.workflow-system', 'runtime', 'dist', 'cli.js');
    const contract = JSON.parse(execFileSync('node', [cli, 'validate-contract', '--root', target], { encoding: 'utf8' })) as { phase: string };
    const state = JSON.parse(execFileSync('node', [cli, 'validate', '--root', target], { encoding: 'utf8' })) as { runtime_state: { task_id: string; workflow_status: string; lifecycle_state: string } };
    expect(contract.phase).toBe('Phase 2');
    expect(state.runtime_state).toMatchObject({ task_id: '000', workflow_status: 'closed', lifecycle_state: 'archived' });
    expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toBe('{\"name\":\"native-package\",\"private\":true}\\n');
    expect(fs.readFileSync(distributionStatePath, 'utf8')).toBe(distributionStateBefore);
    for (const managed of distributionState.managed_files) {
      const checksum = crypto.createHash('sha256').update(fs.readFileSync(path.join(target, ...managed.path.split('/')))).digest('hex');
      expect(checksum).toBe(managed.checksum);
    }
    fs.writeFileSync(distributionSkillPath, `${distributionSkillBefore}\n`, 'utf8');
    expect(classifyBootstrapTarget(target).state).toBe('valid');
    fs.writeFileSync(distributionSkillPath, distributionSkillBefore, 'utf8');

    const replay = buildBootstrapPlan(common);
    expect(replay.status).toBe('replayed');
    expect(replay.read_back_verified).toBe(true);
    expect(replay.planned_writes).toEqual([]);
    expect(fs.existsSync(path.join(target, 'src'))).toBe(false);

    const receiptPath = path.join(target, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as { managed_files: Array<{ path: string }> };
    expect(receipt.managed_files.some(file => file.path === '.workflow-system/WORKFLOW_PROTOCOL.md' || file.path === '.workflow-system/FILE_SCHEMAS.md' || file.path === '.workflow-system/vnext/SOURCE_CONTRACT.yaml' || file.path === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml' || file.path.startsWith('.workflow-system/runtime/') || file.path.startsWith('.agents/skills/'))).toBe(false);
    receipt.managed_files = receipt.managed_files.slice(1);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    const tamperedReplay = buildBootstrapPlan(common);
    expect(tamperedReplay.status).toBe('blocked');
    expect(tamperedReplay.blockers.some(issue => issue.code === 'BOOTSTRAP_RECEIPT_READ_BACK_FAILED')).toBe(true);

    const migratedTarget = makeLegacyGovernedTarget();
    const migrated = migrateDistribution({ targetRoot: migratedTarget, packageRoot: distributionPackageRoot });
    expect(migrated.status).toBe('installed');
    expect(validateInstalledDistribution(migratedTarget, distributionPackageRoot).state.distribution_state).toBe('vnext');
    expect(classifyBootstrapTarget(migratedTarget).state).toBe('governed');
    const migrationReceiptPath = path.join(migratedTarget, '.workflow-system', 'vnext', 'MIGRATION_RECEIPT.json');
    const migrationReceipt = JSON.parse(fs.readFileSync(migrationReceiptPath, 'utf8')) as { runtime_distribution?: { package_version?: string } };
    if (migrationReceipt.runtime_distribution) migrationReceipt.runtime_distribution.package_version = '0.13.0';
    fs.writeFileSync(migrationReceiptPath, JSON.stringify(migrationReceipt, null, 2) + '\n', 'utf8');
    expect(classifyBootstrapTarget(migratedTarget).state).toBe('governed');
    const migratedBootstrap = buildBootstrapPlan({ ...options(migratedTarget), mode: 'greenfield', projectName: undefined, projectSlug: undefined });
    expect(migratedBootstrap.target_state).toBe('governed');
    expect(migratedBootstrap.status).toBe('blocked');
    expect(migratedBootstrap.blockers.some(issue => issue.code === 'BOOTSTRAP_NOT_REQUIRED')).toBe(true);
    expect(migratedBootstrap.blockers.some(issue => issue.code === 'GREENFIELD_PRECONDITION')).toBe(false);
  });

  test('rolls back governance files when read-back fails without touching Distribution software', { timeout: 30000 }, () => {
    const target = targetRoot();
    const common = options(target);
    installDistributionFixture(target);
    const dry = buildBootstrapPlan(common);
    expect(dry.status).toBe('ready');
    const changedPaths = [...dry.planned_writes];
    const staged = buildBootstrapPlan({ ...common, write: true, changedPaths });
    expect(staged.status).toBe('ready');
    expect(staged.proposal).toBeDefined();
    expect(staged.proposal?.requested_directory_targets).toEqual([]);
    expect(staged.proposal?.requested_write_targets.some(relative => relative === '.workflow-system/WORKFLOW_PROTOCOL.md' || relative === '.workflow-system/FILE_SCHEMAS.md' || relative === '.workflow-system/vnext/SOURCE_CONTRACT.yaml' || relative === '.workflow-system/vnext/RUNTIME_CONTRACT.yaml' || relative.startsWith('.workflow-system/runtime/') || relative.startsWith('.agents/skills/'))).toBe(false);
    const before = computeCompleteTreeHash(target, ['.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json']);

    expect(() => applyBootstrapProjectProposal(target, { ...staged.proposal!, semantic_operations: [] }, {
    })).toThrow('BOOTSTRAP_BOUNDARY_VIOLATION');

    expect(() => applyBootstrapProjectProposal(target, staged.proposal, {
      verify: () => {
        throw new Error('injected bootstrap read-back failure');
      },
    })).toThrow('injected bootstrap read-back failure');

    expect(computeCompleteTreeHash(target, ['.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json'])).toBe(before);
    expect(fs.existsSync(path.join(target, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.workflow-system', 'runtime', 'dist', 'cli.js'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.agents', 'skills', 'prepare-task', 'SKILL.md'))).toBe(true);
  });

  test('fails closed when realign would replace a non-baseline canonical task', { timeout: 15000 }, () => {
    const target = targetRoot();
    const common = options(target);
    installDistributionFixture(target);
    const dry = buildBootstrapPlan(common);
    const changedPaths = [...dry.planned_writes, ...dry.planned_directories];
    const installed = bootstrapProject({ ...common, write: true, changedPaths });
    expect(installed.status).toBe('installed');
    const currentPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
    const activeTask = fs.readFileSync(currentPath, 'utf8')
      .replaceAll('workflow_status: closed', 'workflow_status: active')
      .replaceAll('当前状态：closed', '当前状态：active');
    fs.writeFileSync(currentPath, activeTask, 'utf8');
    const blocked = buildBootstrapPlan({ ...common, mode: 'realign' });
    expect(blocked.status).toBe('blocked');
    expect(blocked.blockers.some(issue => issue.code === 'BOOTSTRAP_TASK_STATE_INVALID')).toBe(true);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(activeTask);
  });

  test('allows the admitted inventory-to-adoption transition without touching product files', { timeout: 15000 }, () => {
    const target = targetRoot();
    const facts = [{
      key: 'architecture',
      value: 'confirmed from disposable inventory',
      source: 'P-12 bootstrap transition probe',
      certainty: 'confirmed' as const,
    }];
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'main.ts'), 'export const preserved = true;\n', 'utf8');
    installDistributionFixture(target);
    const productBefore = fs.readFileSync(path.join(target, 'src', 'main.ts'), 'utf8');
    const inventoryOptions: BootstrapProjectOptions = {
      sourceRoot: ROOT,
      targetRoot: target,
      mode: 'inventory',
      projectName: 'Bootstrap Transition Project',
      projectSlug: 'bootstrap-transition-project',
      host: 'codex',
      inventoryFacts: facts,
    };
    const inventoryDry = buildBootstrapPlan(inventoryOptions);
    expect(inventoryDry.status).toBe('ready');
    const inventory = bootstrapProject({
      ...inventoryOptions,
      write: true,
      changedPaths: [...inventoryDry.planned_writes, ...inventoryDry.planned_directories],
    });
    expect(inventory.status).toBe('installed');
    expect(fs.readFileSync(path.join(target, 'docs', 'adoption', 'architecture-inventory.md'), 'utf8')).toContain('confirmed from disposable inventory');

    const adoptOptions: BootstrapProjectOptions = {
      ...inventoryOptions,
      mode: 'adopt',
      confirmedFacts: facts,
      adoptionConfirmed: true,
      designBaseline: { architecture: 'confirmed disposable adoption baseline' },
      designConfirmed: true,
    };
    const adoptDry = buildBootstrapPlan(adoptOptions);
    expect(adoptDry.status).toBe('ready');
    const adopt = bootstrapProject({
      ...adoptOptions,
      write: true,
      changedPaths: [...adoptDry.planned_writes, ...adoptDry.planned_directories],
    });
    expect(adopt.status).toBe('installed');
    expect(adopt.read_back_verified).toBe(true);
    expect(buildBootstrapPlan(adoptOptions).status).toBe('replayed');
    expect(fs.readFileSync(path.join(target, 'src', 'main.ts'), 'utf8')).toBe(productBefore);
  });
});
