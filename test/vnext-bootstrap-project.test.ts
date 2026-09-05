import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  applyBootstrapProjectProposal,
} from '../runtime/vnext/src/bootstrap';
import {
  bootstrapProject,
  buildBootstrapPlan,
  classifyBootstrapTarget,
  type BootstrapProjectOptions,
} from '../scripts/vnext-bootstrap-project';
import { computeBootstrapPreimageHash } from '../runtime/vnext/src/bootstrap-support';
import {
  STATUS_REQUIRED_SECTION_TITLES,
  STATUS_SCHEMA,
  STATUS_SECTION_KEYS,
  STATUS_SECTIONS,
  validateStatusDocument,
} from '../runtime/vnext/src/kernel';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';
import { installDistribution, migrateDistribution, validateInstalledDistribution } from '../scripts/vibe-governance-distribution';
import { validateCompletedMigration } from '../scripts/vnext-migration-pack';

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
  proves: 'bootstrap validates one installed Distribution read-only, promotes governance assets only, preserves the explicit inventory-to-adoption transition, leaves no active task, replays only after authoritative read-back, and closes the target-local Node support path without source-repository inputs',
  existingEvidenceInsufficiency: 'source contract, Runtime contract, Distribution tests, and atomic helper tests do not cover the facade-to-disposable-target composition, target-local support execution, governance-only receipt boundary, or migrated classification together',
  assertionBoundary: 'bootstrap-project source facade, target-local bootstrap-support entrypoint, installed Distribution read-back, authoritative Runtime bootstrap transaction, canonical CURRENT_TASK read-back, governance-only receipt, and mode-specific transition',
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

function assertStatusContract(target: string): void {
  const statusPath = path.join(target, 'docs', 'workflow', 'STATUS.md');
  const status = fs.readFileSync(statusPath, 'utf8');
  expect(() => validateStatusDocument(status, 'docs/workflow/STATUS.md')).not.toThrow();
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
  test('keeps the canonical STATUS schema and all public projections derived from one declaration', () => {
    const expectedStatusTitles = [
      '项目概览',
      '✅ 已完成且稳定',
      '🔨 正在开发',
      '📋 待开发',
      '⚠️ 已知风险 / 观察点',
      '❌ 已移除 / 推迟',
      '🔜 下一检查点',
      '最近更新记录',
    ];

    expect(STATUS_SCHEMA.map((section) => section.title)).toEqual(expectedStatusTitles);
    expect(STATUS_SECTION_KEYS).toEqual(STATUS_SCHEMA.map((section) => section.key));
    expect(Object.keys(STATUS_SECTIONS)).toEqual(STATUS_SECTION_KEYS);
    expect(STATUS_REQUIRED_SECTION_TITLES).toEqual(
      STATUS_SCHEMA.map((section) => section.title),
    );
    expect(STATUS_SECTIONS.recentUpdates.aliases).toEqual(['最近更新记录', 'Recent Updates']);
  });

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
    assertStatusContract(target);
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
    expect(validateCompletedMigration(migratedTarget)).not.toBeNull();
    const mutableCurrentTaskPath = path.join(migratedTarget, 'docs', 'workflow', 'CURRENT_TASK.md');
    const mutableCurrentTaskBefore = fs.readFileSync(mutableCurrentTaskPath, 'utf8');
    fs.appendFileSync(mutableCurrentTaskPath, '\n正常 vNext governance mutation remains admissible.\n', 'utf8');
    expect(validateCompletedMigration(migratedTarget)).not.toBeNull();
    fs.writeFileSync(mutableCurrentTaskPath, mutableCurrentTaskBefore, 'utf8');
    const migrationReceiptPath = path.join(migratedTarget, '.workflow-system', 'vnext', 'MIGRATION_RECEIPT.json');
    const migrationStatePath = path.join(migratedTarget, '.workflow-system', 'vnext', 'INSTALL_STATE.json');
    const migrationReceiptBeforeTamper = fs.readFileSync(migrationReceiptPath, 'utf8');
    const migrationStateBeforeHistoricalFixture = fs.readFileSync(migrationStatePath, 'utf8');
    const migrationReceipt = JSON.parse(migrationReceiptBeforeTamper) as { runtime_distribution?: Record<string, unknown> | null };
    const migrationState = JSON.parse(migrationStateBeforeHistoricalFixture) as { distribution_version?: string; runtime_distribution?: Record<string, unknown> | null };
    expect(migrationReceipt.runtime_distribution).not.toBeNull();
    expect(migrationState.runtime_distribution).not.toBeNull();
    const historicalRuntime = { ...migrationState.runtime_distribution!, package_version: '0.13.0' };
    // This is a paired historical-provenance fixture, not a standalone receipt
    // edit: the Migration Pack verifier admits the state/receipt pair while
    // the current Distribution remains installed at the newer Runtime version.
    migrationState.distribution_version = '0.13.0';
    migrationState.runtime_distribution = historicalRuntime;
    migrationReceipt.runtime_distribution = historicalRuntime;
    fs.writeFileSync(migrationStatePath, JSON.stringify(migrationState, null, 2) + '\n', 'utf8');
    expect(classifyBootstrapTarget(migratedTarget).state).toBe('conflicting');
    fs.writeFileSync(migrationReceiptPath, JSON.stringify(migrationReceipt, null, 2) + '\n', 'utf8');
    expect(validateCompletedMigration(migratedTarget)).toMatchObject({ runtime_distribution: { package_version: '0.13.0' } });
    expect(validateInstalledDistribution(migratedTarget, distributionPackageRoot).state.distribution_version).not.toBe('0.13.0');
    expect(classifyBootstrapTarget(migratedTarget).state).toBe('governed');
    const historicalLocal = spawnSync('node', [path.join(migratedTarget, '.workflow-system', 'runtime', 'dist', 'cli.js'), 'bootstrap-support', 'prepare', '--root', migratedTarget, '--mode', 'greenfield', '--json'], { encoding: 'utf8' });
    expect(historicalLocal.status).toBe(1);
    const historicalLocalPlan = JSON.parse(historicalLocal.stdout) as { target_state: string; blockers: Array<{ code: string }> };
    expect(historicalLocalPlan.target_state).toBe('governed');
    expect(historicalLocalPlan.blockers.some(issue => issue.code === 'BOOTSTRAP_NOT_REQUIRED')).toBe(true);
    fs.writeFileSync(migrationStatePath, migrationStateBeforeHistoricalFixture, 'utf8');
    fs.writeFileSync(migrationReceiptPath, migrationReceiptBeforeTamper, 'utf8');
    const standaloneTamperedReceipt = JSON.parse(migrationReceiptBeforeTamper) as { runtime_distribution?: { package_version?: string } | null };
    if (standaloneTamperedReceipt.runtime_distribution) standaloneTamperedReceipt.runtime_distribution.package_version = '0.13.0';
    fs.writeFileSync(migrationReceiptPath, JSON.stringify(standaloneTamperedReceipt, null, 2) + '\n', 'utf8');
    expect(classifyBootstrapTarget(migratedTarget).state).toBe('conflicting');
    fs.writeFileSync(migrationReceiptPath, migrationReceiptBeforeTamper, 'utf8');
    expect(classifyBootstrapTarget(migratedTarget).state).toBe('governed');
    const targetLocalStateOnly = spawnSync('node', [path.join(migratedTarget, '.workflow-system', 'runtime', 'dist', 'cli.js'), 'bootstrap-support', 'prepare', '--root', migratedTarget, '--mode', 'greenfield', '--json'], { encoding: 'utf8' });
    expect(targetLocalStateOnly.status).toBe(1);
    const targetLocalValidAdmission = JSON.parse(targetLocalStateOnly.stdout) as { target_state: string; status: string; blockers: Array<{ code: string }> };
    expect(targetLocalValidAdmission.target_state).toBe('governed');
    expect(targetLocalValidAdmission.status).toBe('blocked');
    expect(targetLocalValidAdmission.blockers.some(issue => issue.code === 'BOOTSTRAP_NOT_REQUIRED')).toBe(true);
    const migrationStateBeforeMarkerOnly = fs.readFileSync(migrationStatePath, 'utf8');
    fs.rmSync(migrationStatePath);
    const targetLocalStandaloneReceipt = spawnSync('node', [path.join(migratedTarget, '.workflow-system', 'runtime', 'dist', 'cli.js'), 'bootstrap-support', 'prepare', '--root', migratedTarget, '--mode', 'greenfield', '--json'], { encoding: 'utf8' });
    expect(targetLocalStandaloneReceipt.status).toBe(1);
    const targetLocalInvalidAdmission = JSON.parse(targetLocalStandaloneReceipt.stdout) as { target_state: string; blockers: Array<{ code: string }> };
    expect(targetLocalInvalidAdmission.target_state).toBe('conflicting');
    expect(targetLocalInvalidAdmission.blockers.some(issue => issue.code === 'BOOTSTRAP_CONFLICT')).toBe(true);
    fs.writeFileSync(migrationStatePath, migrationStateBeforeMarkerOnly, 'utf8');
    const migratedBootstrap = buildBootstrapPlan({ ...options(migratedTarget), mode: 'greenfield', projectName: undefined, projectSlug: undefined });
    expect(migratedBootstrap.target_state).toBe('governed');
    expect(migratedBootstrap.status).toBe('blocked');
    expect(migratedBootstrap.blockers.some(issue => issue.code === 'BOOTSTRAP_NOT_REQUIRED')).toBe(true);
    expect(migratedBootstrap.blockers.some(issue => issue.code === 'GREENFIELD_PRECONDITION')).toBe(false);

    const migrationStateBeforeRealign = fs.readFileSync(migrationStatePath, 'utf8');
    const migrationReceiptBeforeRealign = fs.readFileSync(migrationReceiptPath, 'utf8');
    const migrationRealignCli = path.join(migratedTarget, '.workflow-system', 'runtime', 'dist', 'cli.js');
    const migrationRealignPreview = JSON.parse(execFileSync('node', [migrationRealignCli, 'bootstrap-support', 'prepare', '--root', migratedTarget, '--mode', 'realign', '--json'], { encoding: 'utf8' })) as { status: string; target_state: string; planned_writes: string[]; blockers?: Array<{ code: string }> };
    expect(migrationRealignPreview.status).toBe('needs-confirmation');
    expect(migrationRealignPreview.target_state).toBe('governed');
    expect(migrationRealignPreview.blockers ?? []).toHaveLength(0);
    const migrationRealignPaths = path.join(migratedTarget, 'realign-paths.json');
    fs.writeFileSync(migrationRealignPaths, JSON.stringify(migrationRealignPreview.planned_writes) + '\n', 'utf8');
    const migrationRealign = JSON.parse(execFileSync('node', [migrationRealignCli, 'bootstrap-support', 'prepare', '--root', migratedTarget, '--mode', 'realign', '--changed-paths-file', migrationRealignPaths, '--write', '--json'], { encoding: 'utf8' })) as { status: string; read_back_verified: boolean };
    expect(migrationRealign.status).toBe('installed');
    expect(migrationRealign.read_back_verified).toBe(true);
    assertStatusContract(migratedTarget);
    expect(fs.readFileSync(migrationStatePath, 'utf8')).toBe(migrationStateBeforeRealign);
    expect(fs.readFileSync(migrationReceiptPath, 'utf8')).toBe(migrationReceiptBeforeRealign);
    expect(classifyBootstrapTarget(migratedTarget).state).toBe('valid');
    const laterBootstrapReceipt = JSON.parse(fs.readFileSync(path.join(migratedTarget, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json'), 'utf8')) as { managed_files: Array<{ path: string }> };
    expect(laterBootstrapReceipt.managed_files.some(file => file.path === '.workflow-system/vnext/INSTALL_STATE.json' || file.path === '.workflow-system/vnext/MIGRATION_RECEIPT.json' || file.path.startsWith('.workflow-system/runtime/') || file.path.startsWith('.agents/skills/'))).toBe(false);
    const ordinaryAfterRealign = buildBootstrapPlan({ ...options(migratedTarget), mode: 'greenfield', projectName: undefined, projectSlug: undefined });
    expect(ordinaryAfterRealign.status).toBe('blocked');
    expect(ordinaryAfterRealign.blockers.some(issue => issue.code === 'BOOTSTRAP_NOT_REQUIRED')).toBe(true);

    const meaningfulTarget = targetRoot();
    fs.mkdirSync(path.join(meaningfulTarget, 'src'), { recursive: true });
    fs.writeFileSync(path.join(meaningfulTarget, 'src', 'main.ts'), 'export const existing = true;\n', 'utf8');
    installDistributionFixture(meaningfulTarget);
    const meaningfulSourcePlan = buildBootstrapPlan(options(meaningfulTarget));
    expect(meaningfulSourcePlan.status).toBe('blocked');
    expect(meaningfulSourcePlan.target_state).toBe('existing');
    expect(meaningfulSourcePlan.blockers.some(issue => issue.code === 'GREENFIELD_PRECONDITION')).toBe(true);
    const meaningfulDesignFile = path.join(meaningfulTarget, 'design-baseline.json');
    fs.writeFileSync(meaningfulDesignFile, JSON.stringify({ architecture: 'existing implementation' }) + '\n', 'utf8');
    const meaningfulLocalProcess = spawnSync('node', [path.join(meaningfulTarget, '.workflow-system', 'runtime', 'dist', 'cli.js'), 'bootstrap-support', 'prepare', '--root', meaningfulTarget, '--mode', 'greenfield', '--design-baseline-file', meaningfulDesignFile, '--confirm-design', '--json'], { encoding: 'utf8' });
    expect(meaningfulLocalProcess.status).toBe(1);
    const meaningfulLocalPlan = JSON.parse(meaningfulLocalProcess.stdout) as { status: string; target_state: string; blockers: Array<{ code: string }> };
    expect(meaningfulLocalPlan.status).toBe('blocked');
    expect(meaningfulLocalPlan.target_state).toBe('existing');
    expect(meaningfulLocalPlan.blockers.some(issue => issue.code === 'GREENFIELD_PRECONDITION')).toBe(true);

    const localTarget = targetRoot();
    installDistributionFixture(localTarget);
    const localCli = path.join(localTarget, '.workflow-system', 'runtime', 'dist', 'cli.js');
    const supportInputRoot = targetRoot();
    const designFile = path.join(supportInputRoot, 'design-baseline.json');
    const changedPathsFile = path.join(supportInputRoot, 'changed-paths.json');
    fs.writeFileSync(designFile, JSON.stringify({ architecture: 'target-local production support' }) + '\n', 'utf8');
    const preview = JSON.parse(execFileSync('node', [localCli, 'bootstrap-support', 'prepare', '--root', localTarget, '--mode', 'greenfield', '--design-baseline-file', designFile, '--confirm-design', '--json'], { encoding: 'utf8' })) as { status: string; planned_writes: string[]; target_state: string };
    expect(preview.status).toBe('needs-confirmation');
    expect(preview.target_state).toBe('empty');
    fs.writeFileSync(changedPathsFile, JSON.stringify(preview.planned_writes) + '\n', 'utf8');
    const localRun = JSON.parse(execFileSync('node', [localCli, 'bootstrap-support', 'prepare', '--root', localTarget, '--mode', 'greenfield', '--design-baseline-file', designFile, '--confirm-design', '--changed-paths-file', changedPathsFile, '--write', '--json'], { encoding: 'utf8' })) as { status: string; read_back_verified: boolean };
    expect(localRun.status).toBe('installed');
    expect(localRun.read_back_verified).toBe(true);
    expect(fs.existsSync(path.join(localTarget, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json'))).toBe(true);
    expect(fs.existsSync(path.join(localTarget, '.workflow-system', 'runtime', 'support', 'bootstrap', 'CURRENT_TASK.md.tmpl'))).toBe(true);
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
    const unmanagedLinkSource = targetRoot();
    fs.writeFileSync(path.join(unmanagedLinkSource, 'package.json'), '{"name":"unmanaged-link"}\n', 'utf8');
    fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
    fs.symlinkSync(unmanagedLinkSource, path.join(target, 'node_modules', 'workspace-link'), 'junction');
    fs.mkdirSync(path.join(target, 'build'), { recursive: true });
    fs.writeFileSync(path.join(target, 'build', 'large-output.bin'), 'unmanaged build output\n', 'utf8');
    const before = computeBootstrapPreimageHash(target, staged.proposal!);

    expect(() => applyBootstrapProjectProposal(target, { ...staged.proposal!, semantic_operations: [] }, {
    })).toThrow('BOOTSTRAP_BOUNDARY_VIOLATION');

    expect(() => applyBootstrapProjectProposal(target, staged.proposal, {
      verify: () => {
        throw new Error('injected bootstrap read-back failure');
      },
    })).toThrow('injected bootstrap read-back failure');

    expect(computeBootstrapPreimageHash(target, staged.proposal!)).toBe(before);
    expect(fs.existsSync(path.join(target, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.workflow-system', 'runtime', 'dist', 'cli.js'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.agents', 'skills', 'prepare-task', 'SKILL.md'))).toBe(true);
  });

  test('keeps every Bootstrap STATUS baseline within the Runtime section contract', { timeout: 30000 }, () => {
    const target = targetRoot();
    const preservedFacts: NonNullable<BootstrapProjectOptions['confirmedFacts']> = [
      { key: 'project-name', value: 'Bootstrap Test Project', source: 'greenfield witness', certainty: 'confirmed' },
      { key: 'project-slug', value: 'bootstrap-test-project', source: 'greenfield witness', certainty: 'confirmed' },
      { key: 'project-purpose', value: 'disposable target for bootstrap invariant', source: 'greenfield witness', certainty: 'confirmed' },
      { key: 'tech-runtime', value: 'Node.js', source: 'greenfield witness', certainty: 'confirmed' },
      { key: 'tech-framework', value: 'TypeScript', source: 'greenfield witness', certainty: 'confirmed' },
      { key: 'tech-database', value: 'none', source: 'greenfield witness', certainty: 'confirmed' },
      { key: 'ui-direction', value: 'governance-first', source: 'greenfield inference', certainty: 'inferred' },
      { key: 'deployment-target', value: 'not supplied', source: 'greenfield inventory', certainty: 'unknown' },
    ];
    const preservedBaseline = {
      'api-contracts': 'confirmed API baseline',
      architecture: 'confirmed architecture baseline',
      database: 'confirmed database baseline',
      'detailed-design': 'confirmed detailed design baseline',
      'domain-model': 'confirmed domain model baseline',
    };
    const common: BootstrapProjectOptions = {
      ...options(target),
      confirmedFacts: preservedFacts,
      designBaseline: preservedBaseline,
    };
    installDistributionFixture(target);
    const preview = buildBootstrapPlan(common);
    expect(preview.status).toBe('ready');
    const installed = bootstrapProject({ ...common, write: true, changedPaths: preview.planned_writes });
    expect(installed.status).toBe('installed');
    const statusPath = path.join(target, 'docs', 'workflow', 'STATUS.md');
    const status = fs.readFileSync(statusPath, 'utf8');
    const contractsPath = path.join(target, 'docs', 'workflow', 'CONTRACTS.md');
    const decisionsPath = path.join(target, 'docs', 'workflow', 'DECISIONS.md');
    const roadmapPath = path.join(target, 'docs', 'workflow', 'ROADMAP.md');
    const currentTaskPath = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
    const currentTaskBeforeRealign = fs.readFileSync(currentTaskPath, 'utf8');
    const contractsBeforeRealign = fs.readFileSync(contractsPath, 'utf8');
    const decisionsBeforeRealign = fs.readFileSync(decisionsPath, 'utf8');
    const roadmapBeforeRealign = fs.readFileSync(roadmapPath, 'utf8');

    expect(contractsBeforeRealign).toContain('- project-purpose: disposable target for bootstrap invariant (source: greenfield witness)');
    expect(decisionsBeforeRealign).toContain('- ui-direction: governance-first [inferred; source: greenfield inference]');
    expect(decisionsBeforeRealign).toContain('- deployment-target: not supplied [unknown; source: greenfield inventory]');
    for (const fact of preservedFacts.filter((item) => item.certainty === 'confirmed')) {
      expect(contractsBeforeRealign).toContain(`- ${fact.key}: ${fact.value} (source: ${fact.source})`);
    }
    for (const key of Object.keys(preservedBaseline)) expect(roadmapBeforeRealign).toContain(`- ${key}`);

    expect(STATUS_REQUIRED_SECTION_TITLES).toEqual(
      STATUS_SCHEMA.map((section) => section.title),
    );
    expect(() => validateStatusDocument(status, 'docs/workflow/STATUS.md')).not.toThrow();
    expect(status).toContain('## 🔨 正在开发\n\n- none');
    expect(status).toContain('## 📋 待开发\n\n- none');
    expect(status).toContain('## ⚠️ 已知风险 / 观察点\n\n- none');
    expect(status).toContain('## ❌ 已移除 / 推迟\n\n- none');

    for (const title of STATUS_REQUIRED_SECTION_TITLES) {
      const withoutSection = status.replace(`## ${title}\n`, '');
      expect(withoutSection).not.toBe(status);
      expect(() => validateStatusDocument(withoutSection, 'docs/workflow/STATUS.md')).toThrow('STATUS_INVALID');
    }

    const realignOptions: BootstrapProjectOptions = {
      ...common,
      mode: 'realign',
      confirmedFacts: undefined,
      designBaseline: undefined,
      designConfirmed: undefined,
    };
    const realignPreview = buildBootstrapPlan(realignOptions);
    expect(realignPreview.status).toBe('ready');
    const realigned = bootstrapProject({
      ...realignOptions,
      write: true,
      changedPaths: realignPreview.planned_writes,
    });
    expect(realigned.status).toBe('installed');
    expect(() => validateStatusDocument(fs.readFileSync(statusPath, 'utf8'), 'docs/workflow/STATUS.md')).not.toThrow();
    const contractsAfterRealign = fs.readFileSync(contractsPath, 'utf8');
    const decisionsAfterRealign = fs.readFileSync(decisionsPath, 'utf8');
    const roadmapAfterRealign = fs.readFileSync(roadmapPath, 'utf8');
    // Mutation witness: the realign caller supplied no facts or baseline. The
    // old empty-input projection would fail these preservation assertions.
    for (const fact of preservedFacts) {
      const projection = fact.certainty === 'confirmed'
        ? `- ${fact.key}: ${fact.value} (source: ${fact.source})`
        : `- ${fact.key}: ${fact.value} [${fact.certainty}; source: ${fact.source}]`;
      expect(fact.certainty === 'confirmed' ? contractsAfterRealign : decisionsAfterRealign).toContain(projection);
    }
    for (const key of Object.keys(preservedBaseline)) expect(roadmapAfterRealign).toContain(`- ${key}`);
    expect(fs.readFileSync(currentTaskPath, 'utf8')).toBe(currentTaskBeforeRealign);
    expect(decisionsAfterRealign).toContain('- mode: realign');
    expect(roadmapAfterRealign).toContain('- realign bootstrap completed as an administrative workflow operation.');
    expect(decisionsAfterRealign).not.toBe(decisionsBeforeRealign);
    expect(roadmapAfterRealign).not.toBe(roadmapBeforeRealign);
    expect(buildBootstrapPlan(realignOptions).status).toBe('replayed');
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
    assertStatusContract(target);
    expect(buildBootstrapPlan(adoptOptions).status).toBe('replayed');
    expect(fs.readFileSync(path.join(target, 'src', 'main.ts'), 'utf8')).toBe(productBefore);
  });
});
