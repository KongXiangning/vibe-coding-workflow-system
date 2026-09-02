import { afterEach, describe, expect, test } from 'bun:test';
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
  type BootstrapProjectOptions,
} from '../scripts/vnext-bootstrap-project';
import { computeCompleteTreeHash } from '../scripts/vnext-migration-pack';

// P-12 admission for this persistent bootstrap guard:
// the bootstrap boundary combines source-bundle validation, exact mutation
// admission, Runtime directory promotion, canonical baseline creation, the
// explicit inventory-to-adoption transition, and replay/read-back. Existing
// source/runtime unit checks do not prove that combination against a
// disposable target root.
const P12_BOOTSTRAP_TEST_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'bootstrap promotes one pure-vNext asset and Runtime distribution transaction, preserves the explicit inventory-to-adoption transition, leaves no active task, and replays only after authoritative read-back',
  existingEvidenceInsufficiency: 'source contract, Runtime contract, and atomic helper tests do not cover the facade-to-disposable-target composition or directory rollback together',
  assertionBoundary: 'bootstrap-project source facade, authoritative Runtime bootstrap transaction, project-local Runtime CLI, canonical CURRENT_TASK read-back, and mode-specific receipt transition',
  failureDisposition: 'block the bootstrap implementation boundary until the target remains unchanged on verifier failure and a successful install is replay-safe',
} as const;

const ROOT = path.resolve(import.meta.dir, '..');
const temporaryRoots: string[] = [];

function targetRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-bootstrap-test-'));
  temporaryRoots.push(root);
  return root;
}

function options(target: string): BootstrapProjectOptions {
  return {
    sourceRoot: ROOT,
    targetRoot: target,
    mode: 'greenfield',
    projectName: 'Bootstrap Test Project',
    projectSlug: 'bootstrap-test-project',
    host: 'codex',
    designBaseline: { architecture: 'confirmed disposable baseline' },
    designConfirmed: true,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext bootstrap-project', () => {
  test('promotes a disposable project, proves the target Runtime, and replays as a no-op', { timeout: 15000 }, () => {
    expect(P12_BOOTSTRAP_TEST_ADMISSION).toMatchObject({
      decision: 'admitted',
      owner: expect.any(String),
      basis: 'critical-invariant',
    });
    const target = targetRoot();
    const common = options(target);
    fs.writeFileSync(path.join(target, 'package.json'), '{\"name\":\"native-package\",\"private\":true}\\n', 'utf8');
    const dry = buildBootstrapPlan(common);
    expect(dry.status).toBe('ready');
    const changedPaths = [...dry.planned_writes, ...dry.planned_directories];

    const unauthorized = buildBootstrapPlan({ ...common, changedPaths: [...changedPaths, 'src/main.ts'] });
    expect(unauthorized.status).toBe('blocked');
    expect(unauthorized.blockers.some(issue => issue.code === 'BOOTSTRAP_SCOPE_BLOCKED')).toBe(true);
    const duplicated = buildBootstrapPlan({ ...common, changedPaths: [changedPaths[0], ...changedPaths] });
    expect(duplicated.status).toBe('blocked');
    expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toBe('{\"name\":\"native-package\",\"private\":true}\\n');

    const installed = bootstrapProject({ ...common, write: true, changedPaths });
    expect(installed.status).toBe('installed');
    expect(installed.read_back_verified).toBe(true);
    expect(installed.evidence.map(item => item.id)).toEqual(expect.arrayContaining([
      'source-contract',
      'scope-admission',
      'bundle-validation',
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

    const replay = buildBootstrapPlan(common);
    expect(replay.status).toBe('replayed');
    expect(replay.read_back_verified).toBe(true);
    expect(replay.planned_writes).toEqual([]);
    expect(fs.existsSync(path.join(target, 'src'))).toBe(false);

    const receiptPath = path.join(target, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as { managed_files: unknown[] };
    receipt.managed_files = receipt.managed_files.slice(1);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    const tamperedReplay = buildBootstrapPlan(common);
    expect(tamperedReplay.status).toBe('blocked');
    expect(tamperedReplay.blockers.some(issue => issue.code === 'BOOTSTRAP_RECEIPT_READ_BACK_FAILED')).toBe(true);
  });

  test('rolls back files and the staged Runtime directory when read-back fails', { timeout: 15000 }, () => {
    const target = targetRoot();
    const common = options(target);
    const dry = buildBootstrapPlan(common);
    expect(dry.status).toBe('ready');
    const changedPaths = [...dry.planned_writes, ...dry.planned_directories];
    const staged = buildBootstrapPlan({ ...common, write: true, changedPaths });
    expect(staged.status).toBe('ready');
    expect(staged.proposal).toBeDefined();
    expect(staged.prepared_runtime).toBeDefined();
    const before = computeCompleteTreeHash(target, ['.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json']);

    expect(() => applyBootstrapProjectProposal(target, { ...staged.proposal!, semantic_operations: [] }, {
      directory_sources: [{
        path: '.workflow-system/runtime/node_modules',
        sourcePath: staged.prepared_runtime!.sourceNodeModulesPath,
      }],
    })).toThrow('BOOTSTRAP_BOUNDARY_VIOLATION');

    expect(() => applyBootstrapProjectProposal(target, staged.proposal, {
      directory_sources: [{
        path: '.workflow-system/runtime/node_modules',
        sourcePath: staged.prepared_runtime!.sourceNodeModulesPath,
      }],
      verify: () => {
        throw new Error('injected bootstrap read-back failure');
      },
    })).toThrow('injected bootstrap read-back failure');

    expect(computeCompleteTreeHash(target, ['.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json'])).toBe(before);
    expect(fs.existsSync(path.join(target, '.workflow-system', 'vnext', 'BOOTSTRAP_RECEIPT.json'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.workflow-system', 'runtime', 'node_modules'))).toBe(false);
    fs.rmSync(staged.prepared_runtime!.stagingRoot, { recursive: true, force: true });
  });

  test('fails closed when realign would replace a non-baseline canonical task', { timeout: 15000 }, () => {
    const target = targetRoot();
    const common = options(target);
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
