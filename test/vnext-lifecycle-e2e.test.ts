import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';
import {
  VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH,
  VIBE_GOVERNANCE_FRESH_INSTALL_NEXT_HINT,
} from '../scripts/vibe-governance-distribution';

// P-12 admission for this persistent system-level lifecycle E2E:
// existing unit and component tests verify Distribution, Bootstrap,
// Migration Pack, and Runtime in isolation, but do not prove real-process
// cross-boundary lifecycle closure across fresh install, legacy migration,
// and safe distribution upgrade.
const P12_LIFECYCLE_E2E_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'Vibe Governance 的三条公开 Distribution lifecycle 能够与 Bootstrap/Migration/Runtime 跨边界闭合。',
  existingEvidenceInsufficiency: 'existing unit and component tests verify individual subsystem transitions in isolation, not cross-process lifecycle closure from Distribution bin through installed target-local Runtime execution',
  assertionBoundary: 'real Distribution CLI process, target-local installed Runtime process, real target filesystem, and durable state read-back',
  failureDisposition: 'block the system-level lifecycle quality gate until cross-boundary lifecycle closure is restored',
} as const;

const ROOT = path.resolve(import.meta.dir, '..');
const distributionPackageRoot = path.join(ROOT, 'packages', 'vibe-governance');
const distributionCli = path.join(distributionPackageRoot, 'dist', 'cli.js');

const temporaryRoots: string[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function targetPath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split('/'));
}

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeFreshTarget(): string {
  const target = tempRoot('vnext-e2e-fresh-target-');
  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ name: 'fresh-lifecycle-target', version: '1.0.0', private: true }, null, 2) + '\n',
    'utf8',
  );
  return target;
}

function makeLegacyGovernedTarget(): string {
  const target = tempRoot('vnext-e2e-legacy-target-');
  fs.cpSync(path.join(ROOT, '.workflow-system'), path.join(target, '.workflow-system'), { recursive: true });
  fs.rmSync(path.join(target, '.workflow-system', 'vnext'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'templates', 'skills'), path.join(target, 'templates', 'skills'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'templates', 'docs'), path.join(target, 'templates', 'docs'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'docs', 'workflow', 'generated', 'workflow-docs'), path.join(target, 'docs', 'workflow'), { recursive: true });
  const currentTaskPath = targetPath(target, 'docs/workflow/CURRENT_TASK.md');
  const currentTask = fs.readFileSync(currentTaskPath, 'utf8')
    .replace('- 当前状态：draft', '- 当前状态：archived')
    .replace('- 生命周期状态：active', '- 生命周期状态：archived')
    .replace('- 任务 ID：{{TASK_ID}}', '- 任务 ID：010')
    .replace('- 任务标题：{{TASK_TITLE}}', '- 任务标题：Migration fixture')
    .replace('- 任务 slug：{{TASK_SLUG}}', '- 任务 slug：migration-fixture')
    .replace('- 当前 handoff：{{CURRENT_HANDOFF}}', '- 当前 handoff：not-applicable');
  fs.writeFileSync(currentTaskPath, currentTask, 'utf8');
  fs.mkdirSync(targetPath(target, '.claude/skills'), { recursive: true });
  fs.writeFileSync(targetPath(target, '.claude/skills/workflow-system-create-current-task.SKILL.md'), '# legacy skill\n', 'utf8');
  fs.writeFileSync(
    targetPath(target, '.workflow-system/install-state.json'),
    JSON.stringify({ state_version: 1, managed_files: [{ path: '.claude/skills/workflow-system-create-current-task.SKILL.md' }] }, null, 2) + '\n',
    'utf8',
  );
  return target;
}

beforeAll(() => {
  // Suite-level single build: build the distribution release package once for all scenarios
  buildVibeGovernanceDistribution({ outputRoot: distributionPackageRoot });
});

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Vibe Governance system-level lifecycle E2E', () => {
  test('Scenario A — Fresh lifecycle: install -> target-local bootstrap -> daily Runtime ready', { timeout: 60000 }, () => {
    const target = makeFreshTarget();

    // 1. Real Distribution CLI execution: install
    const installProcess = spawnSync('node', [distributionCli, 'install', '--root', target, '--json'], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(installProcess.error).toBeUndefined();
    expect(installProcess.status).toBe(0);

    const installResult = JSON.parse(installProcess.stdout) as {
      status: string;
      read_back_verified: boolean;
      next?: string;
    };
    expect(installResult.status).toBe('installed');
    expect(installResult.read_back_verified).toBe(true);
    expect(installResult.next).toBe(VIBE_GOVERNANCE_FRESH_INSTALL_NEXT_HINT);

    // Direct filesystem & state assertions after install
    const distributionStatePath = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    expect(fs.existsSync(distributionStatePath)).toBe(true);
    const distributionState = JSON.parse(fs.readFileSync(distributionStatePath, 'utf8')) as {
      distribution_state: string;
      distribution_version: string;
      legacy_compatibility: string;
    };
    expect(distributionState.distribution_state).toBe('vnext');
    expect(distributionState.legacy_compatibility).toBe('absent');

    const runtimeCliPath = targetPath(target, '.workflow-system/runtime/dist/cli.js');
    expect(fs.existsSync(runtimeCliPath)).toBe(true);
    expect(fs.existsSync(targetPath(target, '.workflow-system/PROJECT_PROFILE.yaml'))).toBe(false);
    expect(fs.existsSync(targetPath(target, 'docs/workflow/CURRENT_TASK.md'))).toBe(false);
    expect(fs.existsSync(targetPath(target, '.workflow-system/vnext/BOOTSTRAP_RECEIPT.json'))).toBe(false);

    // 2. Pre-bootstrap daily runtime check: must fail closed with BOOTSTRAP_REQUIRED
    const preBootstrapValidate = spawnSync('node', [runtimeCliPath, 'validate', '--root', target], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(preBootstrapValidate.status).not.toBe(0);
    expect(preBootstrapValidate.stderr).toContain('BOOTSTRAP_REQUIRED');

    // 3. Target-local Bootstrap execution via installed Runtime cli
    const supportWorkspace = tempRoot('vnext-e2e-support-a-');
    const designFile = path.join(supportWorkspace, 'design-baseline.json');
    fs.writeFileSync(designFile, JSON.stringify({ architecture: 'fresh greenfield design baseline' }) + '\n', 'utf8');

    // Step 3a: bootstrap-support prepare preview
    const previewProcess = spawnSync(
      'node',
      [
        runtimeCliPath,
        'bootstrap-support',
        'prepare',
        '--root', target,
        '--mode', 'greenfield',
        '--design-baseline-file', designFile,
        '--confirm-design',
        '--project-name', 'Fresh Lifecycle Project',
        '--project-slug', 'fresh-lifecycle-project',
        '--json',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    expect(previewProcess.error).toBeUndefined();
    expect(previewProcess.status).toBe(0);

    const previewPlan = JSON.parse(previewProcess.stdout) as {
      status: string;
      target_state: string;
      planned_writes: string[];
      blockers?: Array<{ code: string }>;
    };
    expect(previewPlan.status).toBe('needs-confirmation');
    expect(previewPlan.target_state).toBe('empty');
    expect(previewPlan.planned_writes.length).toBeGreaterThan(0);

    // Step 3b: bootstrap-support prepare commit with changed-paths-file
    const changedPathsFile = path.join(supportWorkspace, 'changed-paths.json');
    fs.writeFileSync(changedPathsFile, JSON.stringify(previewPlan.planned_writes) + '\n', 'utf8');

    const commitProcess = spawnSync(
      'node',
      [
        runtimeCliPath,
        'bootstrap-support',
        'prepare',
        '--root', target,
        '--mode', 'greenfield',
        '--design-baseline-file', designFile,
        '--confirm-design',
        '--project-name', 'Fresh Lifecycle Project',
        '--project-slug', 'fresh-lifecycle-project',
        '--changed-paths-file', changedPathsFile,
        '--write',
        '--json',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    expect(commitProcess.error).toBeUndefined();
    expect(commitProcess.status).toBe(0);

    const commitPlan = JSON.parse(commitProcess.stdout) as {
      status: string;
      read_back_verified: boolean;
    };
    expect(commitPlan.status).toBe('installed');
    expect(commitPlan.read_back_verified).toBe(true);

    // 4. Directly verify durable governance state & receipt separation
    const projectProfilePath = targetPath(target, '.workflow-system/PROJECT_PROFILE.yaml');
    expect(fs.existsSync(projectProfilePath)).toBe(true);
    const projectProfileContent = fs.readFileSync(projectProfilePath, 'utf8');
    const profile = parse(projectProfileContent) as { project: { name: string; slug: string } };
    expect(profile.project.slug).toBe('fresh-lifecycle-project');

    const currentTaskPath = targetPath(target, 'docs/workflow/CURRENT_TASK.md');
    expect(fs.existsSync(currentTaskPath)).toBe(true);

    const bootstrapReceiptPath = targetPath(target, '.workflow-system/vnext/BOOTSTRAP_RECEIPT.json');
    expect(fs.existsSync(bootstrapReceiptPath)).toBe(true);
    const bootstrapReceipt = JSON.parse(fs.readFileSync(bootstrapReceiptPath, 'utf8')) as {
      kind: string;
      mode: string;
      managed_files: Array<{ path: string }>;
    };
    expect(bootstrapReceipt.kind).toBe('vnext-bootstrap-receipt');
    expect(bootstrapReceipt.mode).toBe('greenfield');

    // Invariant: BOOTSTRAP_RECEIPT is governance-only and owns zero Distribution software paths
    for (const managed of bootstrapReceipt.managed_files) {
      expect(managed.path.startsWith('.workflow-system/runtime/')).toBe(false);
      expect(managed.path.startsWith('.agents/skills/')).toBe(false);
      expect(managed.path).not.toBe('.workflow-system/WORKFLOW_PROTOCOL.md');
      expect(managed.path).not.toBe('.workflow-system/FILE_SCHEMAS.md');
      expect(managed.path).not.toBe('.workflow-system/vnext/SOURCE_CONTRACT.yaml');
      expect(managed.path).not.toBe('.workflow-system/vnext/RUNTIME_CONTRACT.yaml');
      expect(managed.path).not.toBe('.workflow-system/vnext/DISTRIBUTION_STATE.json');
    }

    // 5. Daily Runtime ready via project-local Runtime process:
    // "ready" proves the installed runtime boots, validates contract,
    // and parses canonical state/tuple; full daily workflow mutation (prepare-task,
    // execute-step, model interaction) is deferred to real-project dogfood.
    const dailyValidate = spawnSync('node', [runtimeCliPath, 'validate', '--root', target], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(dailyValidate.error).toBeUndefined();
    expect(dailyValidate.status).toBe(0);

    const dailyOutput = JSON.parse(dailyValidate.stdout) as {
      status: string;
      source_tuple: { task_id: string; task_slug: string };
      runtime_state: { task_id: string; workflow_status: string; lifecycle_state: string };
    };
    expect(dailyOutput.status).toBe('success');
    expect(dailyOutput.source_tuple.task_id).toBe('000');
    expect(dailyOutput.runtime_state.lifecycle_state).toBe('archived');
  });

  test('Scenario B — Migration lifecycle: legacy -> migrate -> governed vNext -> daily Runtime ready', { timeout: 60000 }, () => {
    const target = makeLegacyGovernedTarget();

    // 1. Real Distribution CLI execution: migrate
    const migrateProcess = spawnSync('node', [distributionCli, 'migrate', '--root', target, '--json'], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(migrateProcess.error).toBeUndefined();
    expect(migrateProcess.status).toBe(0);

    const migrateResult = JSON.parse(migrateProcess.stdout) as {
      status: string;
      read_back_verified: boolean;
      migration?: { status: string };
      next?: string;
    };
    expect(migrateResult.status).toBe('installed');
    expect(migrateResult.read_back_verified).toBe(true);
    expect(migrateResult.migration?.status).toBe('installed');
    expect(migrateResult.next).toBeUndefined();

    // 2. Direct assertions: Migration Pack conversion and Distribution state
    // Old legacy surfaces removed
    expect(fs.existsSync(targetPath(target, '.claude/skills/workflow-system-create-current-task.SKILL.md'))).toBe(false);
    expect(fs.existsSync(targetPath(target, '.workflow-system/install-state.json'))).toBe(false);

    // New canonical skills installed
    expect(fs.existsSync(targetPath(target, '.agents/skills/bootstrap-project/SKILL.md'))).toBe(true);
    expect(fs.existsSync(targetPath(target, '.agents/skills/prepare-task/SKILL.md'))).toBe(true);
    expect(fs.existsSync(targetPath(target, '.agents/skills/validate-change/SKILL.md'))).toBe(true);

    // Distribution state valid
    const distributionStatePath = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);
    expect(fs.existsSync(distributionStatePath)).toBe(true);
    const distributionState = JSON.parse(fs.readFileSync(distributionStatePath, 'utf8')) as {
      distribution_state: string;
      legacy_compatibility: string;
    };
    expect(distributionState.distribution_state).toBe('vnext');
    expect(distributionState.legacy_compatibility).toBe('absent');

    // Migration provenance valid
    const migrationReceiptPath = targetPath(target, '.workflow-system/vnext/MIGRATION_RECEIPT.json');
    const installStatePath = targetPath(target, '.workflow-system/vnext/INSTALL_STATE.json');
    expect(fs.existsSync(migrationReceiptPath)).toBe(true);
    expect(fs.existsSync(installStatePath)).toBe(true);

    const migrationReceipt = JSON.parse(fs.readFileSync(migrationReceiptPath, 'utf8')) as {
      kind: string;
      migration_pack_id: string;
      bundle_id: string;
      runtime_distribution: Record<string, unknown> | null;
    };
    expect(migrationReceipt.kind).toBe('vnext-migration-receipt');
    expect(migrationReceipt.migration_pack_id).toMatch(/^migration-/);
    expect(migrationReceipt.bundle_id).toMatch(/^bundle-/);
    expect(migrationReceipt.runtime_distribution).not.toBeNull();

    // Canonical baseline CURRENT_TASK is promoted and PROJECT_PROFILE preserved
    const currentTaskPath = targetPath(target, 'docs/workflow/CURRENT_TASK.md');
    expect(fs.existsSync(currentTaskPath)).toBe(true);
    const currentTaskContent = fs.readFileSync(currentTaskPath, 'utf8');
    expect(currentTaskContent).toContain('bootstrap-baseline');
    expect(currentTaskContent).toContain('task_id: \'000\'');
    expect(fs.existsSync(targetPath(target, '.workflow-system/PROJECT_PROFILE.yaml'))).toBe(true);

    // 3. Prove ordinary bootstrap is NOT required and target is recognized as governed
    const runtimeCliPath = targetPath(target, '.workflow-system/runtime/dist/cli.js');
    const ordinaryBootstrapProcess = spawnSync(
      'node',
      [runtimeCliPath, 'bootstrap-support', 'prepare', '--root', target, '--mode', 'greenfield', '--json'],
      { cwd: target, encoding: 'utf8' },
    );
    expect(ordinaryBootstrapProcess.status).toBe(1);

    const ordinaryPlan = JSON.parse(ordinaryBootstrapProcess.stdout) as {
      target_state: string;
      status: string;
      blockers: Array<{ code: string }>;
    };
    // Must NOT be incomplete or empty; target is already governed
    expect(ordinaryPlan.target_state).toBe('governed');
    expect(ordinaryPlan.status).toBe('blocked');
    expect(ordinaryPlan.blockers.some(b => b.code === 'BOOTSTRAP_NOT_REQUIRED')).toBe(true);

    // 4. Daily Runtime ready directly on migrated project:
    // proves installed Runtime reads the promoted canonical baseline state.
    const dailyValidate = spawnSync('node', [runtimeCliPath, 'validate', '--root', target], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(dailyValidate.error).toBeUndefined();
    expect(dailyValidate.status).toBe(0);

    const dailyOutput = JSON.parse(dailyValidate.stdout) as {
      status: string;
      source_tuple: { task_id: string; task_slug: string };
      runtime_state: { task_id: string; task_slug: string; lifecycle_state: string };
    };
    expect(dailyOutput.status).toBe('success');
    expect(dailyOutput.source_tuple.task_id).toBe('000');
    expect(dailyOutput.source_tuple.task_slug).toBe('bootstrap-baseline');
    expect(dailyOutput.runtime_state.lifecycle_state).toBe('archived');
  });

  test('Scenario C — Upgrade lifecycle: older vNext Distribution bytes -> upgrade -> governance preserved -> daily Runtime ready', { timeout: 60000 }, () => {
    // Start with a fully governed vNext target (install + bootstrap)
    const target = makeFreshTarget();

    const installProcess = spawnSync('node', [distributionCli, 'install', '--root', target, '--json'], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(installProcess.status).toBe(0);

    const runtimeCliPath = targetPath(target, '.workflow-system/runtime/dist/cli.js');
    const supportWorkspace = tempRoot('vnext-e2e-support-c-');
    const designFile = path.join(supportWorkspace, 'design-baseline.json');
    fs.writeFileSync(designFile, JSON.stringify({ architecture: 'upgrade lifecycle baseline' }) + '\n', 'utf8');

    const previewProcess = spawnSync(
      'node',
      [
        runtimeCliPath,
        'bootstrap-support',
        'prepare',
        '--root', target,
        '--mode', 'greenfield',
        '--design-baseline-file', designFile,
        '--confirm-design',
        '--project-name', 'Upgrade Target Project',
        '--project-slug', 'upgrade-target-project',
        '--json',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    expect(previewProcess.status).toBe(0);
    const preview = JSON.parse(previewProcess.stdout) as { planned_writes: string[] };

    const changedPathsFile = path.join(supportWorkspace, 'changed-paths.json');
    fs.writeFileSync(changedPathsFile, JSON.stringify(preview.planned_writes) + '\n', 'utf8');

    const commitProcess = spawnSync(
      'node',
      [
        runtimeCliPath,
        'bootstrap-support',
        'prepare',
        '--root', target,
        '--mode', 'greenfield',
        '--design-baseline-file', designFile,
        '--confirm-design',
        '--project-name', 'Upgrade Target Project',
        '--project-slug', 'upgrade-target-project',
        '--changed-paths-file', changedPathsFile,
        '--write',
        '--json',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    expect(commitProcess.status).toBe(0);

    // Target is now governed vNext. Record governance baselines.
    const projectProfilePath = targetPath(target, '.workflow-system/PROJECT_PROFILE.yaml');
    const currentTaskPath = targetPath(target, 'docs/workflow/CURRENT_TASK.md');
    const bootstrapReceiptPath = targetPath(target, '.workflow-system/vnext/BOOTSTRAP_RECEIPT.json');
    const distributionStatePath = targetPath(target, VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH);

    const profileContentBefore = fs.readFileSync(projectProfilePath, 'utf8');
    const currentTaskContentBefore = fs.readFileSync(currentTaskPath, 'utf8');
    const bootstrapReceiptBefore = fs.readFileSync(bootstrapReceiptPath, 'utf8');

    // 1. Load authoritative current release manifest and release artifact content
    const releaseManifestPath = path.join(distributionPackageRoot, 'payload', 'distribution-manifest.json');
    const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8')) as {
      distribution_version: string;
      artifacts: Array<{ source_path: string; target_path: string; checksum: string }>;
    };
    const currentReleaseVersion = releaseManifest.distribution_version;
    const prepareTaskSpec = releaseManifest.artifacts.find(
      artifact => artifact.target_path === '.agents/skills/prepare-task/SKILL.md',
    );
    if (!prepareTaskSpec) {
      throw new Error('Release manifest is missing prepare-task skill artifact spec.');
    }
    const currentReleaseArtifactPath = path.join(
      distributionPackageRoot,
      'payload',
      ...prepareTaskSpec.source_path.split('/'),
    );
    const currentReleaseArtifactContent = fs.readFileSync(currentReleaseArtifactPath, 'utf8');

    // 2. Construct self-consistent synthetic-old Distribution installation:
    // mutate target Distribution-owned bytes and update old DISTRIBUTION_STATE checksum to match
    const targetPrepareTaskPath = targetPath(target, '.agents/skills/prepare-task/SKILL.md');
    const syntheticOldSkillContent = [
      '---',
      'name: prepare-task',
      'description: Synthetic older prepare-task skill for upgrade testing.',
      'entry_contract:',
      '  entry: prepare-task',
      '---',
      '# prepare-task',
      '',
      'Synthetic older distribution byte content for upgrade lifecycle test.',
      '',
    ].join('\n');
    expect(syntheticOldSkillContent).not.toBe(currentReleaseArtifactContent);
    fs.writeFileSync(targetPrepareTaskPath, syntheticOldSkillContent, 'utf8');
    const syntheticOldChecksum = sha256(Buffer.from(syntheticOldSkillContent, 'utf8'));

    const distributionState = JSON.parse(fs.readFileSync(distributionStatePath, 'utf8')) as {
      distribution_version: string;
      managed_files: Array<{ path: string; checksum: string; category: string }>;
    };
    const managedPrepareTask = distributionState.managed_files.find(
      item => item.path === '.agents/skills/prepare-task/SKILL.md',
    );
    if (!managedPrepareTask) {
      throw new Error('Managed prepare-task entry missing in distribution state.');
    }
    managedPrepareTask.checksum = syntheticOldChecksum;
    distributionState.distribution_version = '0.14.4';
    fs.writeFileSync(distributionStatePath, JSON.stringify(distributionState, null, 2) + '\n', 'utf8');

    // Confirm that target bytes before upgrade match synthetic-old bytes and differ from current release
    expect(fs.readFileSync(targetPrepareTaskPath, 'utf8')).toBe(syntheticOldSkillContent);
    expect(fs.readFileSync(targetPrepareTaskPath, 'utf8')).not.toBe(currentReleaseArtifactContent);

    // Confirm that `install` correctly rejects the older target with upgrade-required
    const rejectedInstall = spawnSync('node', [distributionCli, 'install', '--root', target, '--json'], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(rejectedInstall.status).toBe(1);
    const rejectedResult = JSON.parse(rejectedInstall.stdout) as { status: string };
    expect(rejectedResult.status).toBe('upgrade-required');

    // 3. Real Distribution CLI execution: upgrade
    const upgradeProcess = spawnSync('node', [distributionCli, 'upgrade', '--root', target, '--json'], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(upgradeProcess.error).toBeUndefined();
    expect(upgradeProcess.status).toBe(0);

    const upgradeResult = JSON.parse(upgradeProcess.stdout) as {
      status: string;
      read_back_verified: boolean;
      distribution_version: string;
      next?: string;
    };
    expect(upgradeResult.status).toBe('upgraded');
    expect(upgradeResult.read_back_verified).toBe(true);
    expect(upgradeResult.distribution_version).toBe(currentReleaseVersion);
    expect(upgradeResult.next).toBeUndefined();

    // 4. Core invariant assertions: Distribution upgrade replaces software bytes while preserving governance
    // Distribution version updated
    const upgradedState = JSON.parse(fs.readFileSync(distributionStatePath, 'utf8')) as {
      distribution_version: string;
      distribution_state: string;
      managed_files: Array<{ path: string; checksum: string; category: string }>;
    };
    expect(upgradedState.distribution_version).toBe(currentReleaseVersion);
    expect(upgradedState.distribution_state).toBe('vnext');

    // Synthetic-old artifact bytes were replaced with current release artifact bytes
    const upgradedTargetSkillContent = fs.readFileSync(targetPrepareTaskPath, 'utf8');
    expect(upgradedTargetSkillContent).not.toBe(syntheticOldSkillContent);
    expect(upgradedTargetSkillContent).toBe(currentReleaseArtifactContent);

    // Upgraded Distribution State records current release artifact checksum matching target bytes and manifest
    const upgradedManagedPrepareTask = upgradedState.managed_files.find(
      item => item.path === '.agents/skills/prepare-task/SKILL.md',
    );
    expect(upgradedManagedPrepareTask?.checksum).toBe(prepareTaskSpec.checksum);
    expect(upgradedManagedPrepareTask?.checksum).toBe(sha256(Buffer.from(upgradedTargetSkillContent, 'utf8')));

    // Governance assets strictly preserved and byte-identical
    expect(fs.readFileSync(projectProfilePath, 'utf8')).toBe(profileContentBefore);
    expect(fs.readFileSync(currentTaskPath, 'utf8')).toBe(currentTaskContentBefore);
    expect(fs.readFileSync(bootstrapReceiptPath, 'utf8')).toBe(bootstrapReceiptBefore);

    // Prove ordinary bootstrap is NOT required after upgrade:
    // Replay with existing baseline produces zero planned writes and status 'replayed'
    const replayProcess = spawnSync(
      'node',
      [
        runtimeCliPath,
        'bootstrap-support',
        'prepare',
        '--root', target,
        '--mode', 'greenfield',
        '--design-baseline-file', designFile,
        '--confirm-design',
        '--project-name', 'Upgrade Target Project',
        '--project-slug', 'upgrade-target-project',
        '--json',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    expect(replayProcess.status).toBe(0);
    const replayPlan = JSON.parse(replayProcess.stdout) as {
      target_state: string;
      status: string;
      planned_writes: string[];
      read_back_verified: boolean;
    };
    expect(replayPlan.target_state).toBe('valid');
    expect(replayPlan.status).toBe('replayed');
    expect(replayPlan.planned_writes).toEqual([]);
    expect(replayPlan.read_back_verified).toBe(true);

    // 5. Daily Runtime remains ready
    const dailyValidate = spawnSync('node', [runtimeCliPath, 'validate', '--root', target], {
      cwd: target,
      encoding: 'utf8',
    });
    expect(dailyValidate.error).toBeUndefined();
    expect(dailyValidate.status).toBe(0);

    const dailyOutput = JSON.parse(dailyValidate.stdout) as {
      status: string;
      runtime_state: { lifecycle_state: string };
    };
    expect(dailyOutput.status).toBe('success');
    expect(dailyOutput.runtime_state.lifecycle_state).toBe('archived');
  });
});
