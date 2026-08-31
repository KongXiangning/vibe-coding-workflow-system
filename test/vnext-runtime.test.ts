import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  applyVNextRuntimeProposal,
  createFindingQueueProposal,
  createTaskStateProposal,
  GovernanceTransactionKernel,
  readCanonicalCurrentTask,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type FindingQueueDelta,
  type RuntimeProposal,
  type RuntimeState,
} from '../scripts/vnext-runtime';

const ROOT = path.resolve(import.meta.dir, '..');
const temporaryRoots: string[] = [];

function makeRuntimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    schema_version: 1,
    kind: 'vnext-current-task-runtime-state',
    task_id: '010',
    task_slug: 'runtime-fixture',
    workflow_status: 'active',
    lifecycle_state: 'active',
    active_step_id: 'step-1',
    active_step_status: 'ready',
    finding_queue_revision: 0,
    review_cycle: {
      id: 'review-cycle-0',
      repair_round: 0,
      counted_repair_wave_ids: [],
    },
    findings: [],
    execution_log: [],
    applied_proposals: [],
    ...overrides,
  };
}

function makeBody(state: RuntimeState): string {
  return [
    '# vNext CURRENT_TASK',
    '',
    '## 任务信息',
    '',
    `- 任务 ID：${state.task_id}`,
    '- 任务标题：Runtime fixture',
    `- 任务 slug：${state.task_slug}`,
    `- 当前状态：${state.workflow_status}`,
    `- 生命周期状态：${state.lifecycle_state}`,
    '- 恢复需审查：false',
    '- 恢复审查原因：',
    '',
    '## 验收标准',
    '',
    '- [ ] Runtime state is committed atomically',
    '',
    '## 允许修改范围',
    '',
    '- scripts/**',
    '',
    '## 实施步骤',
    '',
    `- ${state.active_step_id}: implement runtime`,
    '',
  ].join('\n');
}

function makeRoot(state: RuntimeState = makeRuntimeState()): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-runtime-test-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml'),
    ['schema_version: 1', '', 'project:', '  name: runtime-fixture', '  type: test', '', 'paths:', '  workflow_home: docs/workflow', ''].join('\n'),
    'utf8',
  );
  const currentTaskPath = path.join(root, 'docs', 'workflow', 'CURRENT_TASK.md');
  fs.mkdirSync(path.dirname(currentTaskPath), { recursive: true });
  const frontmatter = {
    schema_version: 1,
    kind: 'vnext-current-task',
    document_id: 'doc-000000000000000000000000',
    runtime_state: state,
  };
  fs.writeFileSync(currentTaskPath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${makeBody(state)}`, 'utf8');
  return root;
}

function evidence(...kinds: AuthorityEvidence['kind'][]): AuthorityEvidence[] {
  return kinds.map(kind => ({ kind, source: 'docs/workflow/CURRENT_TASK.md', subject: '010' }));
}

function taskProposal(root: string, overrides: Partial<Parameters<typeof createTaskStateProposal>[1]> = {}): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createTaskStateProposal(current, {
    mode: 'default',
    status: 'completed',
    evidence_refs: ['test:evidence:step-1'],
    idempotency_key: 'proposal-step-1-complete',
    authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    ...overrides,
  });
}

function admittedFinding(fingerprint: string, reviewCycleId: string): FindingQueueDelta {
  return {
    kind: 'finding-queue',
    action: 'admit',
    finding: {
      fingerprint,
      category: 'correctness',
      owner_task_id: '010',
      scope: 'admitted',
      decision: 'mechanical',
      file: 'scripts/example.ts',
      failure_condition: `the admitted invariant fails for ${fingerprint}`,
      violated_invariant: `INV-${fingerprint}`,
      root_cause_status: 'confirmed',
      max_repair_attempts: 2,
      evidence_refs: [`test:evidence:${fingerprint}`],
      review_cycle_id: reviewCycleId,
    },
  };
}

function repairAttempt(fingerprint: string, reviewCycleId: string, repairWaveId: string): FindingQueueDelta {
  return {
    kind: 'finding-queue',
    action: 'record-repair-attempt',
    fingerprint,
    review_cycle_id: reviewCycleId,
    repair_wave_id: repairWaveId,
    evidence_refs: ['test:evidence:repair'],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext Phase 2 Runtime contract', () => {
  test('validates the bound execute-step slice and keeps later operations unbound', () => {
    const result = validateVNextRuntimeContract(ROOT);
    expect(result.phase).toBe('Phase 2');
    expect(result.bound_operations).toEqual(['task-state-transaction', 'finding-queue-transaction']);
    expect(result.unbound_operations).toEqual([
      'lifecycle-transaction',
      'inbox-record-transaction',
      'project-status-transaction',
      'archive-transaction',
      'lesson-record-transaction',
    ]);
  });

  test('binds distribution identity to the project-local package, not business node_modules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-runtime-distribution-'));
    temporaryRoots.push(root);
    const runtimeRoot = path.join(root, '.workflow-system', 'runtime');
    fs.mkdirSync(path.join(root, '.workflow-system', 'vnext'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml'), path.join(root, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml'));
    fs.mkdirSync(path.join(runtimeRoot, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'runtime', 'vnext', 'package.json'), path.join(runtimeRoot, 'package.json'));
    fs.copyFileSync(path.join(ROOT, 'runtime', 'vnext', 'package-lock.json'), path.join(runtimeRoot, 'package-lock.json'));
    fs.copyFileSync(path.join(ROOT, 'runtime', 'vnext', 'dist', 'cli.js'), path.join(runtimeRoot, 'dist', 'cli.js'));
    const localYaml = path.join(runtimeRoot, 'node_modules', 'yaml', 'package.json');
    fs.mkdirSync(path.dirname(localYaml), { recursive: true });
    fs.writeFileSync(localYaml, JSON.stringify({ name: 'yaml', version: '2.8.3' }), 'utf8');
    const businessYaml = path.join(root, 'node_modules', 'yaml', 'package.json');
    fs.mkdirSync(path.dirname(businessYaml), { recursive: true });
    fs.writeFileSync(businessYaml, JSON.stringify({ name: 'yaml', version: '99.0.0' }), 'utf8');

    const identity = validateVNextRuntimeContract(root, true).runtime_distribution;
    expect(identity.package_path).toBe('.workflow-system/runtime');
    expect(identity.entrypoint).toBe('.workflow-system/runtime/dist/cli.js');
    expect(identity.package_lock_sha256).toMatch(/^[a-f0-9]{64}$/);

    fs.rmSync(path.dirname(localYaml), { recursive: true, force: true });
    expect(() => validateVNextRuntimeContract(root, true)).toThrow(/RUNTIME_DEPENDENCY_MISSING/);
  });

  test('rejects a Node runtime below the declared minimum', () => {
    expect(() => validateRuntimeEnvironment('19.9.0')).toThrow(/RUNTIME_ENV_UNSUPPORTED/);
    expect(() => validateRuntimeEnvironment('20.0.0')).not.toThrow();
  });

  test('commits a task-state proposal atomically and replays it as a no-op', () => {
    const root = makeRoot();
    const proposal = taskProposal(root);
    const beforeBody = readCanonicalCurrentTask(root).body;

    const applied = applyVNextRuntimeProposal(root, proposal, { now: () => '2026-08-31T00:00:00.000Z' });
    expect(applied.status).toBe('success');
    expect(applied.committed).toBe(true);
    expect(applied.read_back_verified).toBe(true);
    expect(applied.governed_mutation_count).toBe(1);
    const after = readCanonicalCurrentTask(root);
    expect(after.body).toBe(beforeBody);
    expect(after.runtimeState.active_step_status).toBe('completed');
    expect(after.runtimeState.execution_log[0]?.idempotency_key).toBe('proposal-step-1-complete');

    const replay = applyVNextRuntimeProposal(root, proposal);
    expect(replay.status).toBe('no-op');
    expect(replay.committed).toBe(false);
    expect(readCanonicalCurrentTask(root).runtimeState.execution_log).toHaveLength(1);
  });

  test('rolls back and verifies the original CURRENT_TASK when post-commit read-back throws', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const proposal = taskProposal(root);
    const before = fs.readFileSync(current.filePath, 'utf8');
    let readCount = 0;
    const kernel = new GovernanceTransactionKernel(root, targetRoot => {
      readCount += 1;
      if (readCount === 2) throw new Error('simulated post-commit read-back failure');
      return readCanonicalCurrentTask(targetRoot);
    });

    const result = kernel.apply(proposal, { now: () => '2026-08-31T00:00:00.000Z' });

    expect(result.status).toBe('blocked');
    expect(result.code).toBe('READ_BACK_FAILED');
    expect(result.committed).toBe(false);
    expect(result.read_back_verified).toBe(false);
    expect(result.governed_mutation_count).toBe(0);
    expect(result.message).toContain('rollback read-back verified');
    expect(readCount).toBe(3);
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before);
    expect(readCanonicalCurrentTask(root).raw).toBe(before);
  });

  test('dry-run and stale source tuple never mutate CURRENT_TASK', () => {
    const root = makeRoot();
    const proposal = taskProposal(root);
    const before = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
    const dryRun = applyVNextRuntimeProposal(root, proposal, { dryRun: true });
    expect(dryRun.status).toBe('success');
    expect(dryRun.committed).toBe(false);
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(before);

    const stale = { ...proposal, source_tuple: { ...proposal.source_tuple, revision: 'a'.repeat(64) } };
    const conflict = applyVNextRuntimeProposal(root, stale);
    expect(conflict.status).toBe('conflict');
    expect(conflict.code).toBe('SOURCE_TUPLE_MISMATCH');
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(before);
  });

  test('rejects repair without an admitted finding and rejects a wrong write target', () => {
    const root = makeRoot();
    const repair = taskProposal(root, {
      mode: 'repair',
      repair_fingerprint: 'finding-missing',
      idempotency_key: 'repair-without-finding',
    });
    const blockedRepair = applyVNextRuntimeProposal(root, repair);
    expect(blockedRepair.status).toBe('blocked');
    expect(blockedRepair.code).toBe('FINDING_ADMISSION_REQUIRED');

    const wrongTarget = { ...taskProposal(root), idempotency_key: 'wrong-target', requested_write_targets: ['docs/workflow/STATUS.md'] };
    const blockedTarget = applyVNextRuntimeProposal(root, wrongTarget);
    expect(blockedTarget.status).toBe('blocked');
    expect(blockedTarget.code).toBe('RUNTIME_PATH_INVALID');
  });

  test('admits a finding, records bounded repair attempts, and resolves it', () => {
    const root = makeRoot();
    let current = readCanonicalCurrentTask(root);
    const finding: FindingQueueDelta = {
      kind: 'finding-queue',
      action: 'admit',
      finding: {
        fingerprint: 'finding-regression-1',
        category: 'correctness',
        owner_task_id: '010',
        scope: 'admitted',
        decision: 'mechanical',
        file: 'scripts/example.ts',
        failure_condition: 'the admitted invariant fails',
        violated_invariant: 'INV-001',
        root_cause_status: 'confirmed',
        max_repair_attempts: 2,
        evidence_refs: ['test:evidence:finding-1'],
        review_cycle_id: 'review-cycle-1',
      },
    };
    const admitted = applyVNextRuntimeProposal(root, createFindingQueueProposal(current, {
      mode: 'repair',
      delta: finding,
      idempotency_key: 'finding-admit-1',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:finding-1'],
    }), { now: () => '2026-08-31T00:00:00.000Z' });
    expect(admitted.status).toBe('success');

    current = readCanonicalCurrentTask(root);
    const attempt = (key: string) => applyVNextRuntimeProposal(root, createFindingQueueProposal(current, {
      mode: 'repair',
      delta: {
        kind: 'finding-queue',
        action: 'record-repair-attempt',
        fingerprint: 'finding-regression-1',
        review_cycle_id: 'review-cycle-1',
        repair_wave_id: 'repair-wave-1',
        evidence_refs: ['test:evidence:repair'],
      },
      idempotency_key: key,
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:repair'],
    }), { now: () => '2026-08-31T00:01:00.000Z' });
    expect(attempt('finding-attempt-1').status).toBe('success');

    current = readCanonicalCurrentTask(root);
    const resolved = applyVNextRuntimeProposal(root, createFindingQueueProposal(current, {
      mode: 'repair',
      delta: { kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-regression-1', evidence_refs: ['test:evidence:resolved'] },
      idempotency_key: 'finding-resolve-1',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:resolved'],
    }));
    expect(resolved.status).toBe('success');
    const after = readCanonicalCurrentTask(root).runtimeState;
    expect(after.findings[0]?.status).toBe('resolved');
    expect(after.findings[0]?.repair_attempts).toBe(1);
    expect(after.finding_queue_revision).toBe(3);
  });

  test('counts each repair wave once and resets the round budget for a new review cycle', () => {
    const root = makeRoot();
    const applyFindingDelta = (delta: FindingQueueDelta, idempotencyKey: string) => {
      const current = readCanonicalCurrentTask(root);
      return applyVNextRuntimeProposal(root, createFindingQueueProposal(current, {
        mode: 'repair',
        delta,
        idempotency_key: idempotencyKey,
        authority_evidence: evidence('active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission'),
        evidence_refs: delta.action === 'admit' ? delta.finding.evidence_refs : delta.evidence_refs,
      }));
    };

    expect(applyFindingDelta(admittedFinding('finding-wave-1', 'review-cycle-1'), 'admit-wave-1').status).toBe('success');
    expect(applyFindingDelta(admittedFinding('finding-wave-2', 'review-cycle-1'), 'admit-wave-2').status).toBe('success');

    expect(applyFindingDelta(repairAttempt('finding-wave-1', 'review-cycle-1', 'repair-wave-1'), 'repair-wave-1-f1').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      repair_round: 1,
      counted_repair_wave_ids: ['repair-wave-1'],
    });

    expect(applyFindingDelta(repairAttempt('finding-wave-2', 'review-cycle-1', 'repair-wave-1'), 'repair-wave-1-f2').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle.repair_round).toBe(1);

    expect(applyFindingDelta(repairAttempt('finding-wave-1', 'review-cycle-1', 'repair-wave-2'), 'repair-wave-2-f1').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle.repair_round).toBe(2);
    const overFingerprintBudget = applyFindingDelta(repairAttempt('finding-wave-1', 'review-cycle-1', 'repair-wave-2'), 'repair-wave-2-f1-repeat');
    expect(overFingerprintBudget.status).toBe('blocked');
    expect(overFingerprintBudget.code).toBe('REPAIR_BUDGET_EXHAUSTED');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle.repair_round).toBe(2);

    expect(applyFindingDelta(repairAttempt('finding-wave-2', 'review-cycle-1', 'repair-wave-2'), 'repair-wave-2-f2').status).toBe('success');
    expect(applyFindingDelta(admittedFinding('finding-wave-3', 'review-cycle-1'), 'admit-wave-3').status).toBe('success');
    expect(applyFindingDelta(repairAttempt('finding-wave-3', 'review-cycle-1', 'repair-wave-3'), 'repair-wave-3-f3').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      repair_round: 3,
      counted_repair_wave_ids: ['repair-wave-1', 'repair-wave-2', 'repair-wave-3'],
    });

    const cycleResetAttempt = applyFindingDelta(repairAttempt('finding-wave-3', 'review-cycle-2', 'repair-wave-1'), 'repair-cycle-2-wave-1');
    expect(cycleResetAttempt.status).toBe('blocked');
    expect(cycleResetAttempt.code).toBe('REVIEW_CYCLE_CONFLICT');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      repair_round: 3,
      counted_repair_wave_ids: ['repair-wave-1', 'repair-wave-2', 'repair-wave-3'],
    });

    expect(applyFindingDelta({ kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-wave-1', evidence_refs: ['test:evidence:resolve-wave-1'] }, 'resolve-wave-1').status).toBe('success');
    expect(applyFindingDelta({ kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-wave-2', evidence_refs: ['test:evidence:resolve-wave-2'] }, 'resolve-wave-2').status).toBe('success');
    expect(applyFindingDelta({ kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-wave-3', evidence_refs: ['test:evidence:resolve-wave-3'] }, 'resolve-wave-3').status).toBe('success');

    expect(applyFindingDelta(admittedFinding('finding-new-cycle', 'review-cycle-2'), 'admit-cycle-2').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-2',
      repair_round: 0,
      counted_repair_wave_ids: [],
    });
    expect(applyFindingDelta(repairAttempt('finding-new-cycle', 'review-cycle-2', 'repair-wave-1'), 'repair-cycle-2-wave-1').status).toBe('success');

    const state = readCanonicalCurrentTask(root).runtimeState;
    expect(state.review_cycle).toEqual({
      id: 'review-cycle-2',
      repair_round: 1,
      counted_repair_wave_ids: ['repair-wave-1'],
    });
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-1')?.repair_attempts).toBe(2);
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-2')?.repair_attempts).toBe(2);
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-1')?.review_cycle_id).toBe('review-cycle-1');
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-2')?.review_cycle_id).toBe('review-cycle-1');
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-3')?.review_cycle_id).toBe('review-cycle-1');
    expect(state.findings.find(item => item.fingerprint === 'finding-new-cycle')?.repair_attempts).toBe(1);
  });

  test('stops on a legacy CURRENT_TASK schema before any mutation', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const proposal = taskProposal(root);
    fs.writeFileSync(current.filePath, current.body, 'utf8');
    const result = applyVNextRuntimeProposal(root, proposal);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('MIGRATION_REQUIRED');
  });

  test('stops on an unsupported CURRENT_TASK frontmatter kind before any mutation', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const proposal = taskProposal(root);
    fs.writeFileSync(current.filePath, `---\nschema_version: 1\nkind: legacy-current-task\n---\n${current.body}`, 'utf8');
    const result = applyVNextRuntimeProposal(root, proposal);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('MIGRATION_REQUIRED');
  });

  test('keeps malformed self-declared vNext CURRENT_TASK documents as schema errors', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const proposal = taskProposal(root);
    fs.writeFileSync(current.filePath, `---\nschema_version: 1\nkind: vnext-current-task\ndocument_id: broken\n---\n${current.body}`, 'utf8');
    const result = applyVNextRuntimeProposal(root, proposal);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('RUNTIME_SCHEMA_INVALID');
  });
});
