import { afterEach, describe, expect, test } from 'bun:test';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  applyVNextRuntimeProposal,
  createArchiveProposal,
  createFindingQueueProposal,
  createLessonRecordProposal,
  createLifecycleProposal,
  createProjectStatusProposal,
  createPrepareTaskReplanProposal,
  createPrepareTaskResumeReviewProposal,
  createTaskStateProposal,
  createReviewCycleZero,
  GovernanceTransactionKernel,
  previewCloseTask,
  readCanonicalCurrentTask,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type ArchiveDelta,
  type ClosureEvidence,
  type DeliverySummary,
  type FindingRecord,
  type FindingQueueDelta,
  type LifecycleDelta,
  type LessonRecordDelta,
  type ReplanReplacementDefinition,
  type ReplanTaskStateAction,
  type RuntimeProposal,
  type RuntimeState,
  type ProjectStatusDelta,
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
    resume_requires_review: false,
    resume_review_reasons: [],
    active_step_id: 'step-1',
    active_step_status: 'ready',
    finding_queue_revision: 0,
    review_cycle: {
      id: 'review-cycle-0',
      cycle_phase: 'discovery',
      repair_round: 0,
      counted_repair_wave_ids: [],
      active_repair_wave_id: null,
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
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
    `- 恢复需审查：${state.resume_requires_review ? 'true' : 'false'}`,
    `- 恢复审查原因：${state.resume_review_reasons.join(', ')}`,
    '',
    '## 背景与上下文',
    '',
    '- original background',
    '',
    '## 验收标准',
    '',
    '- [ ] original acceptance',
    '',
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    '- scripts/**',
    '',
    '### Conditional Files',
    '',
    '- docs/** when evidence is present',
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    '- .git/**',
    '',
    '## 受影响的契约',
    '',
    '- original contract',
    '',
    '## 已确认决策',
    '',
    '- original decision',
    '',
    '## 待确认问题',
    '',
    '- original question',
    '',
    '## 实现方案',
    '',
    '- original implementation plan',
    '',
    '## 审查问题队列',
    '',
    '- historical review queue entry',
    '',
    '## 传播治理记录',
    '',
    '- historical propagation evidence',
    '',
    '## 实施步骤',
    '',
    `- ${state.active_step_id}: implement runtime`,
    '',
    '## 回归检查项',
    '',
    '- original regression check',
    '',
    '## 回滚点',
    '',
    '- original rollback point',
    '',
    '## 设计约束',
    '',
    '- original design constraint',
    '',
    '## 发布后验证',
    '',
    '- original release validation',
    '',
    '## 执行记录',
    '',
    '- historical execution record',
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
  fs.writeFileSync(path.join(root, 'docs', 'workflow', 'STATUS.md'), [
    '# STATUS.md',
    '',
    '## 项目概览',
    '',
    '- 项目：runtime-fixture',
    '',
    '## ✅ 已完成且稳定',
    '',
    '- [ ] baseline',
    '',
    '## 🔨 正在开发',
    '',
    '- [ ] none',
    '',
    '## 📋 待开发',
    '',
    '- [ ] none',
    '',
    '## ⚠️ 已知风险 / 观察点',
    '',
    '- none',
    '',
    '## ❌ 已移除 / 推迟',
    '',
    '- none',
    '',
    '## 🔜 下一检查点',
    '',
    '- baseline',
    '',
    '## 最近更新记录',
    '',
    '- initial',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'docs', 'workflow', 'LESSONS.md'), [
    '# LESSONS.md',
    '',
    '## 使用规则',
    '',
    '- reusable only',
    '',
    '## 通用',
    '',
    '- none',
    '',
    '## 数据与存储',
    '',
    '- none',
    '',
    '## 前端与交互',
    '',
    '- none',
    '',
    '## 后端与服务',
    '',
    '- none',
    '',
    '## 测试与回归',
    '',
    '- none',
    '',
    '## 部署与运行时',
    '',
    '- none',
    '',
  ].join('\n'), 'utf8');
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

function admittedFinding(fingerprint: string, reviewCycleId: string, cyclePhase: 'discovery' | 'verification' = 'discovery', findingAdmissionWaveId = `finding-wave-${fingerprint}`): FindingQueueDelta {
  return {
    kind: 'finding-queue',
    action: 'admit',
    cycle_phase: cyclePhase,
    finding_admission_wave_id: findingAdmissionWaveId,
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

function pauseDelta(overrides: Partial<Extract<LifecycleDelta, { action: 'pause' }>> = {}): Extract<LifecycleDelta, { action: 'pause' }> {
  return {
    kind: 'lifecycle',
    action: 'pause',
    lifecycle_state: 'paused_pending_closure',
    suspension_reason: 'validation and manual review are pending',
    task_start_base: 'main@abc123',
    last_reviewed_checkpoint: 'checkpoint-1',
    current_diff_review_target: 'HEAD~1..HEAD',
    rollback_conditions: 'restore the current task snapshot if package read-back fails',
    resume_review_reasons: ['manual_review_pending'],
    evidence_refs: ['test:evidence:pause'],
    ...overrides,
  };
}

function interruptDelta(overrides: Partial<Extract<LifecycleDelta, { action: 'interrupt' }>> = {}): Extract<LifecycleDelta, { action: 'interrupt' }> {
  return {
    kind: 'lifecycle',
    action: 'interrupt',
    lifecycle_state: 'interrupted',
    suspension_reason: 'environment stopped unexpectedly',
    task_start_base: 'main@abc123',
    last_reviewed_checkpoint: 'checkpoint-2',
    current_diff_review_target: 'HEAD~1..HEAD',
    rollback_conditions: 'restore the current task snapshot if package read-back fails',
    resume_review_reasons: ['environment_recovery_pending'],
    evidence_refs: ['test:evidence:interrupt'],
    checkpoint_evidence: 'checkpoint-2 recorded before interruption',
    dirty_attribution: 'task-owned changes are listed in the checkpoint',
    environment_state: 'runner was stopped after the checkpoint',
    recovery_strategy: 'rehydrate the checkpoint and review the diff before execution',
    ...overrides,
  };
}

function replacementDefinition(overrides: Partial<ReplanReplacementDefinition> = {}): ReplanReplacementDefinition {
  return {
    background_context: '- replanned background',
    acceptance: '- [ ] replanned acceptance',
    allowed_scope: '- runtime/**',
    conditional_scope: '- docs/** when the new evidence is admitted',
    forbidden_scope: '- .git/**\n- secrets/**',
    affected_contracts: '- Runtime contract',
    confirmed_decisions: '- keep the same task identity',
    open_questions: '- none for this replacement',
    implementation_plan: '- implement the replacement plan',
    implementation_steps: '- step-2: implement the replacement',
    regression_checks: '- [ ] run the replacement regression suite',
    rollback_points: '- restore the replacement commit if validation fails',
    design_constraints: '- no visual changes',
    post_release_validation: '- no release validation is required',
    propagation_governance: '- propagation evidence is retained',
    ...overrides,
  };
}

function runtimeFinding(fingerprint: string, status: FindingRecord['status'], overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    fingerprint,
    category: 'correctness',
    owner_task_id: '010',
    scope: 'admitted',
    decision: 'mechanical',
    file: 'scripts/example.ts',
    failure_condition: `failure condition for ${fingerprint}`,
    violated_invariant: `INV-${fingerprint}`,
    root_cause_status: 'confirmed',
    status,
    repair_attempts: status === 'in-progress' ? 1 : 0,
    max_repair_attempts: 2,
    evidence_refs: [`test:evidence:${fingerprint}`],
    review_cycle_id: 'review-cycle-9',
    last_repair_wave_id: status === 'in-progress' ? 'repair-wave-9' : null,
    admitted_at: '2026-08-31T00:00:00.000Z',
    updated_at: '2026-08-31T00:01:00.000Z',
    ...overrides,
  };
}

function supersedeDelta(overrides: Partial<Extract<LifecycleDelta, { action: 'supersede' }>> = {}): Extract<LifecycleDelta, { action: 'supersede' }> {
  return {
    kind: 'lifecycle',
    action: 'supersede',
    invalidation_kind: 'scope',
    invalidation_reason: 'the old scope is no longer valid',
    evidence_refs: ['test:evidence:supersede'],
    partial_diff_disposition: {
      reusable: ['history'],
      rollback_required: ['old implementation'],
      stop_propagation: ['old consumers'],
    },
    ...overrides,
  };
}

function replanProposal(
  root: string,
  action: ReplanTaskStateAction,
  idempotencyKey: string,
  overrides: { definition?: ReplanReplacementDefinition; active_step_id?: string; authority?: AuthorityEvidence[]; evidence_refs?: string[] } = {},
): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  const delta = action === 'commit-replan'
    ? {
      kind: 'task-state' as const,
      action,
      replacement_definition: overrides.definition ?? replacementDefinition(),
      active_step_id: overrides.active_step_id ?? 'step-2',
      evidence_refs: overrides.evidence_refs ?? ['test:evidence:replan'],
    }
    : {
      kind: 'task-state' as const,
      action,
      evidence_refs: overrides.evidence_refs ?? ['test:evidence:replan'],
    };
  return createPrepareTaskReplanProposal(current, {
    delta: delta as Parameters<typeof createPrepareTaskReplanProposal>[1]['delta'],
    idempotency_key: idempotencyKey,
    authority_evidence: overrides.authority ?? evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    evidence_refs: overrides.evidence_refs ?? ['test:evidence:replan'],
  });
}

function fileRevision(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function closureEvidence(overrides: Partial<ClosureEvidence> = {}): ClosureEvidence {
  const gate = { triggered: false, complete: false, evidence_refs: [] as string[] };
  return {
    acceptance_satisfied: true,
    validation_complete: true,
    no_admitted_or_in_progress_findings: true,
    no_unresolved_closure_blocker: true,
    release_evidence: { ...gate },
    rollback_evidence: { ...gate },
    observation_evidence: { ...gate },
    remaining_risks_non_blocking: true,
    archive_path_verified: true,
    ...overrides,
  };
}

function deliverySummary(overrides: Partial<DeliverySummary> = {}): DeliverySummary {
  return {
    goal: 'finish the runtime fixture task',
    actual_changes: ['implemented the admitted task step'],
    verification: ['focused runtime tests passed'],
    release_evidence: [],
    rollback_evidence: [],
    observation_evidence: [],
    next_action: 'observe the completed task',
    ...overrides,
  };
}

function archiveDelta(overrides: Partial<ArchiveDelta> = {}): ArchiveDelta {
  return {
    kind: 'archive',
    action: 'archive',
    closure_evidence: closureEvidence(),
    delivery_summary: deliverySummary(),
    remaining_risks: ['none beyond the completed task'],
    lesson_admission: { decision: 'defer', candidate_refs: [], evidence_refs: [] },
    evidence_refs: ['test:evidence:closure'],
    ...overrides,
  };
}

function closeAuthority(): AuthorityEvidence[] {
  return evidence('active-task-owner', 'evidence-admission');
}

function archiveProposal(root: string, delta: ArchiveDelta = archiveDelta(), idempotencyKey = 'archive-close-1'): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createArchiveProposal(current, {
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: closeAuthority(),
    evidence_refs: delta.evidence_refs,
  });
}

function statusProposal(root: string, delta: ProjectStatusDelta = statusDelta(), idempotencyKey = 'status-close-1'): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createProjectStatusProposal(current, {
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: closeAuthority(),
    evidence_refs: delta.evidence_refs,
  });
}

function lessonProposal(root: string, delta: LessonRecordDelta = lessonDelta(), idempotencyKey = 'lesson-close-1'): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createLessonRecordProposal(current, {
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: closeAuthority(),
    evidence_refs: delta.evidence_refs,
  });
}

function statusDelta(overrides: Partial<ProjectStatusDelta> = {}): ProjectStatusDelta {
  return {
    kind: 'project-status',
    action: 'sync',
    status: 'completed',
    summary: 'runtime fixture task completed',
    completed_items: ['runtime fixture task'],
    remaining_risks: ['none beyond the completed task'],
    next_checkpoint: 'observe the next project checkpoint',
    evidence_refs: ['test:evidence:status'],
    ...overrides,
  };
}

function lessonDelta(): LessonRecordDelta {
  return {
    kind: 'lesson-record',
    action: 'record',
    candidates: [{
      candidate_ref: 'lesson-runtime-close',
      category: '测试与回归',
      scene: 'A close transaction spans multiple durable governance documents.',
      conclusion: 'Keep archive, status, and lesson writes independently retryable.',
      trigger: 'Archive succeeded while a downstream reconciliation failed.',
      cause: 'The downstream documents have different ownership and rollback boundaries.',
      action: 'Retry only the failed typed transaction after validating the archive receipt.',
      consumer: 'future close-task reconciliation',
      evidence_refs: ['test:evidence:lesson'],
    }],
    evidence_refs: ['test:evidence:lesson'],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext Phase 2 Runtime contract', () => {
  test('validates the bound execute-step slice and keeps later operations unbound', () => {
    const result = validateVNextRuntimeContract(ROOT);
    expect(result.phase).toBe('Phase 2');
    expect(result.bound_operations).toEqual([
      'task-state-transaction',
      'finding-queue-transaction',
      'lifecycle-transaction',
      'project-status-transaction',
      'archive-transaction',
      'lesson-record-transaction',
    ]);
    expect(result.unbound_operations).toEqual(['inbox-record-transaction']);
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

  test('commits pause and explicit resume, then requires prepare-task to clear the review gate', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const paused = applyVNextRuntimeProposal(root, createLifecycleProposal(current, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-1',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    }));
    expect(paused.status).toBe('success');
    expect(paused.governed_mutation_count).toBe(2);
    expect(paused.planned_writes).toEqual([
      'docs/workflow/CURRENT_TASK.md',
      'TASKS/paused/TASK-010-runtime-fixture.md',
    ]);

    const suspended = readCanonicalCurrentTask(root);
    expect(suspended.runtimeState.workflow_status).toBe('suspended');
    expect(suspended.runtimeState.lifecycle_state).toBe('paused_pending_closure');
    expect(suspended.runtimeState.resume_requires_review).toBe(true);
    expect(suspended.body).toContain('- 当前状态：suspended');
    expect(suspended.body).toContain('- 生命周期状态：paused_pending_closure');
    const packagePath = path.join(root, 'TASKS', 'paused', 'TASK-010-runtime-fixture.md');
    const packageBeforeResume = fs.readFileSync(packagePath, 'utf8');
    expect(packageBeforeResume).toContain('rehydration_status: ready_for_resume');
    expect(packageBeforeResume).toContain('BEGIN vNext CURRENT_TASK snapshot');

    const resumed = applyVNextRuntimeProposal(root, createLifecycleProposal(suspended, {
      mode: 'resume-paused',
      delta: {
        kind: 'lifecycle',
        action: 'resume-paused',
        artifact_kind: 'paused',
        recovery_package_path: 'TASKS/paused/TASK-010-runtime-fixture.md',
        recovery_package_revision: crypto.createHash('sha256').update(packageBeforeResume).digest('hex'),
        resume_review_reasons: ['manual_review_pending'],
        evidence_refs: ['test:evidence:resume'],
      },
      idempotency_key: 'lifecycle-resume-1',
      authority_evidence: evidence('resume-review', 'evidence-admission'),
      evidence_refs: ['test:evidence:resume'],
    }));
    expect(resumed.status).toBe('success');
    const resumedCurrent = readCanonicalCurrentTask(root);
    expect(resumedCurrent.runtimeState.workflow_status).toBe('active');
    expect(resumedCurrent.runtimeState.lifecycle_state).toBe('active');
    expect(resumedCurrent.runtimeState.resume_requires_review).toBe(true);
    expect(resumedCurrent.runtimeState.resume_review_reasons).toEqual(['manual_review_pending']);
    expect(resumedCurrent.runtimeState.applied_proposals.map(item => item.idempotency_key)).toEqual([
      'lifecycle-pause-1',
      'lifecycle-resume-1',
    ]);
    expect(fs.readFileSync(packagePath, 'utf8')).toContain('rehydration_status: rehydrated');
    expect(fs.readFileSync(packagePath, 'utf8')).toContain('ownership_state: rehydrated');

    const blockedExecution = applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'step-before-resume-review' }));
    expect(blockedExecution.status).toBe('blocked');
    expect(blockedExecution.code).toBe('RESUME_REVIEW_REQUIRED');

    const cleared = applyVNextRuntimeProposal(root, createPrepareTaskResumeReviewProposal(resumedCurrent, {
      mode: 'default',
      evidence_refs: ['test:evidence:resume-review'],
      idempotency_key: 'resume-review-cleared-1',
      authority_evidence: evidence('active-task-owner', 'resume-review', 'evidence-admission'),
    }));
    expect(cleared.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.resume_requires_review).toBe(false);
    expect(readCanonicalCurrentTask(root).runtimeState.resume_review_reasons).toEqual([]);

    const staleGateProposal = createTaskStateProposal(resumedCurrent, {
      mode: 'default',
      status: 'completed',
      evidence_refs: ['test:evidence:stale-gate'],
      idempotency_key: 'stale-gate-source',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    const staleGate = applyVNextRuntimeProposal(root, staleGateProposal);
    expect(staleGate.status).toBe('conflict');
    expect(staleGate.code).toBe('SOURCE_TUPLE_MISMATCH');

    const repauseCurrent = readCanonicalCurrentTask(root);
    const repaused = applyVNextRuntimeProposal(root, createLifecycleProposal(repauseCurrent, {
      mode: 'pause',
      delta: pauseDelta({ task_start_base: 'main@def456', evidence_refs: ['test:evidence:pause-2'] }),
      idempotency_key: 'lifecycle-pause-2',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause-2'],
    }));
    expect(repaused.status).toBe('success');
    expect(fs.readFileSync(packagePath, 'utf8')).toContain('rehydration_status: ready_for_resume');
  });

  test('fails closed when a resume package changes after proposal creation or its CURRENT_TASK gate drifts', () => {
    const staleRoot = makeRoot();
    const staleCurrent = readCanonicalCurrentTask(staleRoot);
    expect(applyVNextRuntimeProposal(staleRoot, createLifecycleProposal(staleCurrent, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-stale-package',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    })).status).toBe('success');
    const staleSuspended = readCanonicalCurrentTask(staleRoot);
    const stalePackagePath = path.join(staleRoot, 'TASKS', 'paused', 'TASK-010-runtime-fixture.md');
    const staleResume = createLifecycleProposal(staleSuspended, {
      mode: 'resume-paused',
      delta: {
        kind: 'lifecycle',
        action: 'resume-paused',
        artifact_kind: 'paused',
        recovery_package_path: 'TASKS/paused/TASK-010-runtime-fixture.md',
        recovery_package_revision: fileRevision(stalePackagePath),
        resume_review_reasons: ['manual_review_pending'],
        evidence_refs: ['test:evidence:resume'],
      },
      idempotency_key: 'lifecycle-resume-stale-package',
      authority_evidence: evidence('resume-review', 'evidence-admission'),
      evidence_refs: ['test:evidence:resume'],
    });
    const changedPackage = fs.readFileSync(stalePackagePath, 'utf8').replace(
      '- suspension_reason: validation and manual review are pending',
      '- suspension_reason: validation and manual review remain pending',
    );
    fs.writeFileSync(stalePackagePath, changedPackage, 'utf8');
    const staleResult = applyVNextRuntimeProposal(staleRoot, staleResume);
    expect(staleResult.status).toBe('blocked');
    expect(staleResult.code).toBe('RECOVERY_PACKAGE_STALE');

    const driftRoot = makeRoot();
    const driftCurrent = readCanonicalCurrentTask(driftRoot);
    expect(applyVNextRuntimeProposal(driftRoot, createLifecycleProposal(driftCurrent, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-gate-drift',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    })).status).toBe('success');
    const driftedCurrentPath = path.join(driftRoot, 'docs', 'workflow', 'CURRENT_TASK.md');
    fs.writeFileSync(
      driftedCurrentPath,
      fs.readFileSync(driftedCurrentPath, 'utf8').replaceAll('manual_review_pending', 'validation_pending'),
      'utf8',
    );
    const driftedCurrent = readCanonicalCurrentTask(driftRoot);
    const driftPackagePath = path.join(driftRoot, 'TASKS', 'paused', 'TASK-010-runtime-fixture.md');
    const driftResult = applyVNextRuntimeProposal(driftRoot, createLifecycleProposal(driftedCurrent, {
      mode: 'resume-paused',
      delta: {
        kind: 'lifecycle',
        action: 'resume-paused',
        artifact_kind: 'paused',
        recovery_package_path: 'TASKS/paused/TASK-010-runtime-fixture.md',
        recovery_package_revision: fileRevision(driftPackagePath),
        resume_review_reasons: ['validation_pending'],
        evidence_refs: ['test:evidence:resume-gate-drift'],
      },
      idempotency_key: 'lifecycle-resume-gate-drift',
      authority_evidence: evidence('resume-review', 'evidence-admission'),
      evidence_refs: ['test:evidence:resume-gate-drift'],
    }));
    expect(driftResult.status).toBe('blocked');
    expect(driftResult.code).toBe('RESUME_GATE_DRIFT');
  });

  test('does not return a lifecycle no-op when the secondary package is missing on replay', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const proposal = createLifecycleProposal(current, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-replay-integrity',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    });
    expect(applyVNextRuntimeProposal(root, proposal).status).toBe('success');
    fs.rmSync(path.join(root, 'TASKS', 'paused', 'TASK-010-runtime-fixture.md'));

    const replay = applyVNextRuntimeProposal(root, proposal);
    expect(replay.status).toBe('blocked');
    expect(replay.code).toBe('SUSPENDED_PACKAGE_MISSING');

    const brokenRoot = makeRoot();
    const brokenCurrent = readCanonicalCurrentTask(brokenRoot);
    const brokenProposal = createLifecycleProposal(brokenCurrent, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-marker-replay-integrity',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    });
    expect(applyVNextRuntimeProposal(brokenRoot, brokenProposal).status).toBe('success');
    const brokenPackagePath = path.join(brokenRoot, 'TASKS', 'paused', 'TASK-010-runtime-fixture.md');
    fs.writeFileSync(
      brokenPackagePath,
      fs.readFileSync(brokenPackagePath, 'utf8').replace('<!-- BEGIN vNext CURRENT_TASK snapshot -->', '<!-- BEGIN malformed snapshot -->'),
      'utf8',
    );
    const brokenReplay = applyVNextRuntimeProposal(brokenRoot, brokenProposal);
    expect(brokenReplay.status).toBe('blocked');
    expect(brokenReplay.code).toBe('SUSPENDED_PACKAGE_INVALID');
  });

  test('keeps interrupt distinct and requires its recovery evidence', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const interrupted = applyVNextRuntimeProposal(root, createLifecycleProposal(current, {
      mode: 'interrupt',
      delta: interruptDelta(),
      idempotency_key: 'lifecycle-interrupt-1',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:interrupt'],
    }));
    expect(interrupted.status).toBe('success');
    const packagePath = path.join(root, 'TASKS', 'interrupted', 'TASK-010-runtime-fixture.md');
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    expect(packageContent).toContain('artifact_kind: interrupted');
    expect(packageContent).toContain('lifecycle_state: interrupted');
    expect(packageContent).toContain('checkpoint_evidence: checkpoint-2 recorded before interruption');
    expect(packageContent).toContain('dirty_attribution: task-owned changes are listed in the checkpoint');
    expect(packageContent).toContain('environment_state: runner was stopped after the checkpoint');
    expect(packageContent).toContain('recovery_strategy: rehydrate the checkpoint and review the diff before execution');
    expect(readCanonicalCurrentTask(root).runtimeState.lifecycle_state).toBe('interrupted');

    const resumed = createLifecycleProposal(readCanonicalCurrentTask(root), {
      mode: 'resume-interrupted',
      delta: {
        kind: 'lifecycle',
        action: 'resume-interrupted',
        artifact_kind: 'interrupted',
        recovery_package_path: 'TASKS/interrupted/TASK-010-runtime-fixture.md',
        recovery_package_revision: fileRevision(packagePath),
        resume_review_reasons: ['environment_recovery_pending'],
        evidence_refs: ['test:evidence:resume-interrupted'],
      },
      idempotency_key: 'lifecycle-resume-interrupted-1',
      authority_evidence: evidence('resume-review', 'evidence-admission'),
      evidence_refs: ['test:evidence:resume-interrupted'],
    });
    expect(applyVNextRuntimeProposal(root, resumed).status).toBe('success');
  });

  test('allows interrupt and interrupted resume after a paused package has been rehydrated', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createLifecycleProposal(current, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-cross-kind',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    })).status).toBe('success');

    const suspended = readCanonicalCurrentTask(root);
    const pausedPackagePath = path.join(root, 'TASKS', 'paused', 'TASK-010-runtime-fixture.md');
    expect(applyVNextRuntimeProposal(root, createLifecycleProposal(suspended, {
      mode: 'resume-paused',
      delta: {
        kind: 'lifecycle',
        action: 'resume-paused',
        artifact_kind: 'paused',
        recovery_package_path: 'TASKS/paused/TASK-010-runtime-fixture.md',
        recovery_package_revision: fileRevision(pausedPackagePath),
        resume_review_reasons: ['manual_review_pending'],
        evidence_refs: ['test:evidence:resume-paused'],
      },
      idempotency_key: 'lifecycle-resume-cross-kind',
      authority_evidence: evidence('resume-review', 'evidence-admission'),
      evidence_refs: ['test:evidence:resume-paused'],
    })).status).toBe('success');

    const resumed = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskResumeReviewProposal(resumed, {
      mode: 'default',
      evidence_refs: ['test:evidence:resume-review'],
      idempotency_key: 'resume-review-cross-kind',
      authority_evidence: evidence('active-task-owner', 'resume-review', 'evidence-admission'),
    })).status).toBe('success');

    const active = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createLifecycleProposal(active, {
      mode: 'interrupt',
      delta: interruptDelta(),
      idempotency_key: 'lifecycle-interrupt-after-pause',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:interrupt'],
    })).status).toBe('success');

    const interrupted = readCanonicalCurrentTask(root);
    const interruptedPackagePath = path.join(root, 'TASKS', 'interrupted', 'TASK-010-runtime-fixture.md');
    const resumeInterrupted = createLifecycleProposal(interrupted, {
      mode: 'resume-interrupted',
      delta: {
        kind: 'lifecycle',
        action: 'resume-interrupted',
        artifact_kind: 'interrupted',
        recovery_package_path: 'TASKS/interrupted/TASK-010-runtime-fixture.md',
        recovery_package_revision: fileRevision(interruptedPackagePath),
        resume_review_reasons: ['environment_recovery_pending'],
        evidence_refs: ['test:evidence:resume-interrupted'],
      },
      idempotency_key: 'lifecycle-resume-interrupted-after-pause',
      authority_evidence: evidence('resume-review', 'evidence-admission'),
      evidence_refs: ['test:evidence:resume-interrupted'],
    });
    const result = applyVNextRuntimeProposal(root, resumeInterrupted);
    expect(result.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.lifecycle_state).toBe('active');
  });

  test('commits active supersede with invalidation evidence and no replacement write', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const beforeDefinition = current.body;
    const proposal = createLifecycleProposal(current, {
      mode: 'supersede',
      delta: {
        kind: 'lifecycle',
        action: 'supersede',
        invalidation_kind: 'goal',
        invalidation_reason: 'the accepted goal is no longer valid',
        evidence_refs: ['test:evidence:supersede'],
        partial_diff_disposition: {
          reusable: ['existing test evidence'],
          rollback_required: ['discard the stale implementation path'],
          stop_propagation: ['do not publish the stale contract change'],
        },
      },
      idempotency_key: 'lifecycle-supersede-active',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    const result = applyVNextRuntimeProposal(root, proposal);
    expect(result.status).toBe('success');
    expect(result.governed_mutation_count).toBe(1);
    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.workflow_status).toBe('superseded');
    expect(after.runtimeState.lifecycle_state).toBe('active');
    expect(after.runtimeState.task_id).toBe(current.runtimeState.task_id);
    expect(after.runtimeState.task_slug).toBe(current.runtimeState.task_slug);
    expect(after.frontmatter.document_id).toBe(current.frontmatter.document_id);
    expect(after.body).toContain('original background');
    expect(after.body).toContain('original implementation plan');
    expect(after.body).toContain('action: supersede');
    expect(after.runtimeState.execution_log).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'supersede',
        invalidation_kind: 'goal',
        invalidation_reason: 'the accepted goal is no longer valid',
        partial_diff_disposition: expect.objectContaining({ reusable: ['existing test evidence'] }),
      }),
    ]));
    expect(after.runtimeState.applied_proposals.map(item => item.idempotency_key)).toContain('lifecycle-supersede-active');
    const replay = applyVNextRuntimeProposal(root, proposal);
    expect(replay.status).toBe('no-op');
    expect(readCanonicalCurrentTask(root).body).toContain(beforeDefinition.slice(beforeDefinition.indexOf('## 背景与上下文'), beforeDefinition.indexOf('## 执行记录')));
  });

  test('transitions active to blocked_by_replan, blocks execution and lifecycle pause/interrupt, then clears the block', () => {
    const root = makeRoot();
    const marked = applyVNextRuntimeProposal(root, replanProposal(root, 'mark-replan-blocked', 'replan-mark-blocked'));
    expect(marked.status).toBe('success');
    expect(marked.state?.workflow_status).toBe('blocked_by_replan');
    const blocked = readCanonicalCurrentTask(root);
    expect(blocked.runtimeState.lifecycle_state).toBe('active');
    expect(blocked.body).toContain('action: mark-replan-blocked');

    const blockedExecution = applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'step-while-replan-blocked' }));
    expect(blockedExecution.status).toBe('blocked');
    expect(blockedExecution.code).toBe('TASK_STATE_NOT_ACTIVE');

    const blockedPause = applyVNextRuntimeProposal(root, createLifecycleProposal(blocked, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'pause-while-replan-blocked',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    }));
    expect(blockedPause.status).toBe('blocked');
    expect(blockedPause.code).toBe('LIFECYCLE_TRANSITION_INVALID');

    const blockedInterrupt = applyVNextRuntimeProposal(root, createLifecycleProposal(blocked, {
      mode: 'interrupt',
      delta: interruptDelta(),
      idempotency_key: 'interrupt-while-replan-blocked',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:interrupt'],
    }));
    expect(blockedInterrupt.status).toBe('blocked');
    expect(blockedInterrupt.code).toBe('LIFECYCLE_TRANSITION_INVALID');

    const clearProposal = replanProposal(root, 'clear-replan-block', 'replan-clear-blocked');
    const cleared = applyVNextRuntimeProposal(root, clearProposal);
    expect(cleared.status).toBe('success');
    const active = readCanonicalCurrentTask(root);
    expect(active.runtimeState.workflow_status).toBe('active');
    expect(active.runtimeState.lifecycle_state).toBe('active');
    expect(active.body).toContain('action: clear-replan-block');
    expect(applyVNextRuntimeProposal(root, clearProposal).status).toBe('no-op');
  });

  test('allows blocked_by_replan to supersede and never writes a replacement definition', () => {
    const root = makeRoot();
    expect(applyVNextRuntimeProposal(root, replanProposal(root, 'mark-replan-blocked', 'replan-mark-before-supersede')).status).toBe('success');
    const blocked = readCanonicalCurrentTask(root);
    const beforeDefinition = blocked.body.slice(blocked.body.indexOf('## 背景与上下文'), blocked.body.indexOf('## 执行记录'));
    const superseded = applyVNextRuntimeProposal(root, createLifecycleProposal(blocked, {
      mode: 'supersede',
      delta: supersedeDelta(),
      idempotency_key: 'lifecycle-supersede-blocked',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    }));
    expect(superseded.status).toBe('success');
    expect(superseded.planned_writes).toEqual(['docs/workflow/CURRENT_TASK.md']);
    expect(superseded.governed_mutation_count).toBe(1);
    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.workflow_status).toBe('superseded');
    expect(after.runtimeState.lifecycle_state).toBe('active');
    expect(after.body).toContain(beforeDefinition);
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'step-after-supersede' })).code).toBe('TASK_STATE_NOT_ACTIVE');
    const supersededPause = applyVNextRuntimeProposal(root, createLifecycleProposal(after, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'pause-after-supersede',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    }));
    expect(supersededPause.status).toBe('blocked');
    expect(supersededPause.code).toBe('LIFECYCLE_TRANSITION_INVALID');
    const supersededInterrupt = applyVNextRuntimeProposal(root, createLifecycleProposal(after, {
      mode: 'interrupt',
      delta: interruptDelta(),
      idempotency_key: 'interrupt-after-supersede',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:interrupt'],
    }));
    expect(supersededInterrupt.status).toBe('blocked');
    expect(supersededInterrupt.code).toBe('LIFECYCLE_TRANSITION_INVALID');
  });

  test('commits same-task replan with closed sections, deterministic normalization, history and identity preservation', () => {
    const state = makeRuntimeState({
      active_step_id: 'old-step',
      active_step_status: 'in-progress',
      finding_queue_revision: 7,
      findings: [
        runtimeFinding('finding-open-admitted', 'admitted'),
        runtimeFinding('finding-open-progress', 'in-progress'),
        runtimeFinding('finding-resolved', 'resolved'),
        runtimeFinding('finding-rejected', 'rejected'),
        runtimeFinding('finding-deferred', 'deferred'),
      ],
      execution_log: [{
        idempotency_key: 'historical-step',
        mode: 'default',
        step_id: 'old-step',
        status: 'in-progress',
        evidence_refs: ['test:evidence:historical-step'],
        recorded_at: '2026-08-31T00:00:00.000Z',
      }],
    });
    const root = makeRoot(state);
    const initial = readCanonicalCurrentTask(root);
    const documentId = initial.frontmatter.document_id;
    const supersedeProposal = createLifecycleProposal(initial, {
      mode: 'supersede',
      delta: supersedeDelta({ invalidation_kind: 'acceptance' }),
      idempotency_key: 'lifecycle-supersede-before-replan',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(root, supersedeProposal).status).toBe('success');

    const superseded = readCanonicalCurrentTask(root);
    const committed = applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'replan-commit-1', {
      active_step_id: 'step-2',
      definition: replacementDefinition(),
      evidence_refs: ['test:evidence:replan-commit'],
    }), { now: () => '2026-08-31T01:00:00.000Z' });
    expect(committed.status).toBe('success');
    expect(committed.governed_mutation_count).toBe(1);

    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.task_id).toBe(initial.runtimeState.task_id);
    expect(after.runtimeState.task_slug).toBe(initial.runtimeState.task_slug);
    expect(after.frontmatter.document_id).toBe(documentId);
    expect(after.runtimeState.workflow_status).toBe('active');
    expect(after.runtimeState.lifecycle_state).toBe('active');
    expect(after.runtimeState.active_step_id).toBe('step-2');
    expect(after.runtimeState.active_step_status).toBe('ready');
    expect(after.runtimeState.resume_requires_review).toBe(false);
    expect(after.runtimeState.resume_review_reasons).toEqual([]);
    expect(after.runtimeState.review_cycle).toEqual(createReviewCycleZero());
    expect(after.runtimeState.finding_queue_revision).toBe(8);
    expect(after.runtimeState.findings.map(item => [item.fingerprint, item.status])).toEqual([
      ['finding-open-admitted', 'deferred'],
      ['finding-open-progress', 'deferred'],
      ['finding-resolved', 'resolved'],
      ['finding-rejected', 'rejected'],
      ['finding-deferred', 'deferred'],
    ]);
    expect(after.runtimeState.execution_log).toEqual(expect.arrayContaining([
      expect.objectContaining({ idempotency_key: 'historical-step' }),
      expect.objectContaining({ action: 'supersede', invalidation_kind: 'acceptance' }),
      expect.objectContaining({ action: 'commit-replan', source_revision: superseded.sourceTuple.revision }),
    ]));
    expect(after.runtimeState.applied_proposals.map(item => item.idempotency_key)).toEqual([
      'lifecycle-supersede-before-replan',
      'replan-commit-1',
    ]);
    expect(after.body).toContain('- replanned background');
    expect(after.body).toContain('- step-2: implement the replacement');
    expect(after.body).toContain('historical review queue entry');
    expect(after.body).toContain('action: commit-replan');
    expect(after.body).not.toContain('- original background');

    const oldSupersedeReplay = applyVNextRuntimeProposal(root, supersedeProposal);
    expect(oldSupersedeReplay.status).toBe('blocked');
    expect(oldSupersedeReplay.code).toBe('LIFECYCLE_REPLAY_INCOMPLETE');
    const oldDefinitionCommit = applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'replan-illegal-from-active'));
    expect(oldDefinitionCommit.status).toBe('blocked');
    expect(oldDefinitionCommit.code).toBe('REPLAN_TRANSITION_INVALID');

    const historical = after.runtimeState.findings[0];
    const readmitted = applyVNextRuntimeProposal(root, createFindingQueueProposal(after, {
      mode: 'repair',
      delta: {
        kind: 'finding-queue',
        action: 'admit',
        cycle_phase: 'discovery',
        finding_admission_wave_id: 'finding-wave-after-replan',
        finding: {
          fingerprint: historical.fingerprint,
          category: historical.category,
          owner_task_id: historical.owner_task_id,
          scope: historical.scope,
          decision: historical.decision,
          file: historical.file,
          failure_condition: historical.failure_condition,
          violated_invariant: historical.violated_invariant,
          root_cause_status: historical.root_cause_status,
          max_repair_attempts: historical.max_repair_attempts,
          evidence_refs: ['test:evidence:re-admission'],
          review_cycle_id: 'review-cycle-after-replan',
        },
      },
      idempotency_key: 'finding-readmission-after-replan',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:re-admission'],
    }));
    expect(readmitted.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.findings[0]?.status).toBe('admitted');
  });

  test('requires active_step_id to uniquely identify a replacement implementation step', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createLifecycleProposal(current, {
      mode: 'supersede',
      delta: supersedeDelta(),
      idempotency_key: 'supersede-before-step-validation',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    })).status).toBe('success');

    const missingStep = applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'replan-missing-step', {
      active_step_id: 'missing-step',
    }));
    expect(missingStep.status).toBe('blocked');
    expect(missingStep.code).toBe('RUNTIME_SECTION_INVALID');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('superseded');

    const duplicateStep = applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'replan-duplicate-step', {
      active_step_id: 'step-2',
      definition: replacementDefinition({ implementation_steps: '- step-2: first\n- step-2: duplicate' }),
    }));
    expect(duplicateStep.status).toBe('blocked');
    expect(duplicateStep.code).toBe('RUNTIME_SECTION_INVALID');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('superseded');
  });

  test('requires the execution audit section and verifies body audit on replay', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    fs.writeFileSync(current.filePath, current.raw.replace(/\r?\n## 执行记录[\s\S]*$/, '\n'), 'utf8');
    const mark = replanProposal(root, 'mark-replan-blocked', 'replan-missing-audit-section');
    const missingSection = applyVNextRuntimeProposal(root, mark);
    expect(missingSection.status).toBe('blocked');
    expect(missingSection.code).toBe('RUNTIME_SECTION_INVALID');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('active');

    fs.writeFileSync(current.filePath, current.raw, 'utf8');
    const restored = readCanonicalCurrentTask(root);
    const supersede = createLifecycleProposal(restored, {
      mode: 'supersede',
      delta: supersedeDelta(),
      idempotency_key: 'supersede-body-audit-replay',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(root, supersede).status).toBe('success');
    const superseded = readCanonicalCurrentTask(root);
    fs.writeFileSync(superseded.filePath, superseded.raw.replace(/\r?\n## 执行记录[\s\S]*$/, '\n'), 'utf8');
    const replayWithoutBodyAudit = applyVNextRuntimeProposal(root, supersede);
    expect(replayWithoutBodyAudit.status).toBe('blocked');
    expect(replayWithoutBodyAudit.code).toBe('RUNTIME_REPLAY_INCOMPLETE');
  });

  test('blocks replay of a supersede proposal from an earlier definition generation', () => {
    const root = makeRoot();
    const initial = readCanonicalCurrentTask(root);
    const supersedeA = createLifecycleProposal(initial, {
      mode: 'supersede',
      delta: supersedeDelta(),
      idempotency_key: 'supersede-generation-a',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(root, supersedeA).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'commit-generation-replan')).status).toBe('success');

    const replanned = readCanonicalCurrentTask(root);
    const supersedeB = createLifecycleProposal(replanned, {
      mode: 'supersede',
      delta: supersedeDelta({
        invalidation_kind: 'acceptance',
        invalidation_reason: 'the replacement acceptance is now invalid',
      }),
      idempotency_key: 'supersede-generation-b',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(root, supersedeB).status).toBe('success');

    const oldGenerationReplay = applyVNextRuntimeProposal(root, supersedeA);
    expect(oldGenerationReplay.status).toBe('blocked');
    expect(oldGenerationReplay.code).toBe('LIFECYCLE_REPLAY_INCOMPLETE');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('superseded');
  });

  test('rejects replan definition patches outside the closed section and identity allowlist', () => {
    const root = makeRoot();
    const valid = replanProposal(root, 'mark-replan-blocked', 'replan-schema-valid');
    const invalidReplacement = {
      kind: 'task-state',
      action: 'commit-replan',
      replacement_definition: { ...replacementDefinition(), arbitrary_heading: '## do not patch this' },
      active_step_id: 'replacement-step',
      evidence_refs: ['test:evidence:replan-schema'],
    };
    const invalid = applyVNextRuntimeProposal(root, {
      ...valid,
      idempotency_key: 'replan-schema-extra-field',
      semantic_delta: invalidReplacement,
    });
    expect(invalid.status).toBe('blocked');
    expect(invalid.code).toBe('RUNTIME_SCHEMA_INVALID');

    const identityPatch = applyVNextRuntimeProposal(root, {
      ...valid,
      idempotency_key: 'replan-schema-identity-field',
      semantic_delta: {
        kind: 'task-state',
        action: 'commit-replan',
        replacement_definition: { ...replacementDefinition(), task_id: '999' },
        active_step_id: 'replacement-step',
        evidence_refs: ['test:evidence:replan-schema'],
      },
    });
    expect(identityPatch.status).toBe('blocked');
    expect(identityPatch.code).toBe('RUNTIME_SCHEMA_INVALID');

    const headingPatch = applyVNextRuntimeProposal(root, {
      ...valid,
      idempotency_key: 'replan-schema-arbitrary-heading',
      semantic_delta: {
        kind: 'task-state',
        action: 'commit-replan',
        replacement_definition: { ...replacementDefinition(), background_context: '# arbitrary patch' },
        active_step_id: 'replacement-step',
        evidence_refs: ['test:evidence:replan-schema'],
      },
    });
    expect(headingPatch.status).toBe('blocked');
    expect(headingPatch.code).toBe('RUNTIME_SCHEMA_INVALID');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('active');
  });

  test('fails closed for stale, caller/mode/action mismatches and replan replay after a later transition', () => {
    const root = makeRoot();
    const mark = replanProposal(root, 'mark-replan-blocked', 'replan-stale-source');
    const stale = applyVNextRuntimeProposal(root, { ...mark, source_tuple: { ...mark.source_tuple, revision: 'a'.repeat(64) } });
    expect(stale.status).toBe('conflict');
    expect(stale.code).toBe('SOURCE_TUPLE_MISMATCH');

    const callerMismatch = applyVNextRuntimeProposal(root, {
      ...mark,
      idempotency_key: 'replan-wrong-caller',
      caller: 'task-lifecycle',
    });
    expect(callerMismatch.status).toBe('blocked');
    expect(callerMismatch.code).toBe('RUNTIME_CALLER_NOT_BOUND');

    const modeMismatch = applyVNextRuntimeProposal(root, {
      ...mark,
      idempotency_key: 'replan-wrong-mode',
      mode: 'default',
    });
    expect(modeMismatch.status).toBe('blocked');
    expect(modeMismatch.code).toBe('RUNTIME_CALLER_NOT_BOUND');

    const actionMismatch = applyVNextRuntimeProposal(root, {
      ...mark,
      idempotency_key: 'replan-wrong-action',
      semantic_delta: { kind: 'task-state', action: 'clear-resume-review-gate', evidence_refs: ['test:evidence:replan'] },
    });
    expect(actionMismatch.status).toBe('blocked');
    expect(actionMismatch.code).toBe('RUNTIME_CALLER_NOT_BOUND');

    expect(applyVNextRuntimeProposal(root, mark).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, mark).status).toBe('no-op');
    const clear = replanProposal(root, 'clear-replan-block', 'replan-clear-after-mark');
    expect(applyVNextRuntimeProposal(root, clear).status).toBe('success');
    const staleReplay = applyVNextRuntimeProposal(root, mark);
    expect(staleReplay.status).toBe('blocked');
    expect(staleReplay.code).toBe('RUNTIME_REPLAY_INCOMPLETE');
  });

  test('rolls back a commit-replan when canonical read-back fails', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createLifecycleProposal(current, {
      mode: 'supersede',
      delta: supersedeDelta(),
      idempotency_key: 'supersede-before-replan-rollback',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    })).status).toBe('success');
    const superseded = readCanonicalCurrentTask(root);
    const proposal = replanProposal(root, 'commit-replan', 'replan-read-back-failure');
    const before = fs.readFileSync(superseded.filePath, 'utf8');
    let readCount = 0;
    const kernel = new GovernanceTransactionKernel(root, targetRoot => {
      readCount += 1;
      if (readCount === 2) throw new Error('simulated replan post-commit read-back failure');
      return readCanonicalCurrentTask(targetRoot);
    });
    const result = kernel.apply(proposal, { now: () => '2026-08-31T02:00:00.000Z' });
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('READ_BACK_FAILED');
    expect(result.governed_mutation_count).toBe(0);
    expect(result.message).toContain('rollback read-back verified');
    expect(readCount).toBe(3);
    expect(fs.readFileSync(superseded.filePath, 'utf8')).toBe(before);
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('superseded');
  });

  test('requires the explicit identity-derived package and rolls back both lifecycle files on read-back failure', () => {
    const root = makeRoot();
    const current = readCanonicalCurrentTask(root);
    const wrongPackage = createLifecycleProposal(current, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-wrong-package',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    });
    wrongPackage.requested_write_targets = [current.relativePath, 'TASKS/paused/TASK-010-other.md'];
    const wrongTarget = applyVNextRuntimeProposal(root, wrongPackage);
    expect(wrongTarget.status).toBe('blocked');
    expect(wrongTarget.code).toBe('RUNTIME_PATH_INVALID');

    const before = fs.readFileSync(current.filePath, 'utf8');
    let readCount = 0;
    const kernel = new GovernanceTransactionKernel(root, targetRoot => {
      readCount += 1;
      if (readCount === 2) throw new Error('simulated lifecycle post-commit read-back failure');
      return readCanonicalCurrentTask(targetRoot);
    });
    const proposal = createLifecycleProposal(current, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'lifecycle-pause-read-back-failure',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    });
    const result = kernel.apply(proposal);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('READ_BACK_FAILED');
    expect(result.governed_mutation_count).toBe(0);
    expect(readCount).toBe(3);
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(root, 'TASKS', 'paused', 'TASK-010-runtime-fixture.md'))).toBe(false);
  });

  test('admits a finding, records bounded repair attempts, and resolves it', () => {
    const root = makeRoot();
    let current = readCanonicalCurrentTask(root);
    const finding: FindingQueueDelta = {
      kind: 'finding-queue',
      action: 'admit',
      cycle_phase: 'discovery',
      finding_admission_wave_id: 'finding-admission-wave-1',
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
    expect(applyFindingDelta(admittedFinding('finding-wave-3', 'review-cycle-1'), 'admit-wave-3').status).toBe('success');

    expect(applyFindingDelta(repairAttempt('finding-wave-1', 'review-cycle-1', 'repair-wave-1'), 'repair-wave-1-f1').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      cycle_phase: 'discovery',
      repair_round: 1,
      counted_repair_wave_ids: ['repair-wave-1'],
      active_repair_wave_id: 'repair-wave-1',
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
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
    expect(applyFindingDelta(repairAttempt('finding-wave-3', 'review-cycle-1', 'repair-wave-3'), 'repair-wave-3-f3').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      cycle_phase: 'discovery',
      repair_round: 3,
      counted_repair_wave_ids: ['repair-wave-1', 'repair-wave-2', 'repair-wave-3'],
      active_repair_wave_id: 'repair-wave-3',
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
    });

    const cycleResetAttempt = applyFindingDelta(repairAttempt('finding-wave-3', 'review-cycle-2', 'repair-wave-1'), 'repair-cycle-2-wave-1');
    expect(cycleResetAttempt.status).toBe('blocked');
    expect(cycleResetAttempt.code).toBe('REVIEW_CYCLE_CONFLICT');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      cycle_phase: 'discovery',
      repair_round: 3,
      counted_repair_wave_ids: ['repair-wave-1', 'repair-wave-2', 'repair-wave-3'],
      active_repair_wave_id: 'repair-wave-3',
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
    });

    expect(applyFindingDelta({ kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-wave-1', evidence_refs: ['test:evidence:resolve-wave-1'] }, 'resolve-wave-1').status).toBe('success');
    expect(applyFindingDelta({ kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-wave-2', evidence_refs: ['test:evidence:resolve-wave-2'] }, 'resolve-wave-2').status).toBe('success');
    expect(applyFindingDelta({ kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-wave-3', evidence_refs: ['test:evidence:resolve-wave-3'] }, 'resolve-wave-3').status).toBe('success');

    expect(applyFindingDelta(admittedFinding('finding-new-cycle', 'review-cycle-2'), 'admit-cycle-2').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-2',
      cycle_phase: 'discovery',
      repair_round: 0,
      counted_repair_wave_ids: [],
      active_repair_wave_id: null,
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
    });
    expect(applyFindingDelta(repairAttempt('finding-new-cycle', 'review-cycle-2', 'repair-wave-1'), 'repair-cycle-2-wave-1').status).toBe('success');

    const state = readCanonicalCurrentTask(root).runtimeState;
    expect(state.review_cycle).toEqual({
      id: 'review-cycle-2',
      cycle_phase: 'discovery',
      repair_round: 1,
      counted_repair_wave_ids: ['repair-wave-1'],
      active_repair_wave_id: 'repair-wave-1',
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
    });
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-1')?.repair_attempts).toBe(2);
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-2')?.repair_attempts).toBe(2);
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-1')?.review_cycle_id).toBe('review-cycle-1');
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-2')?.review_cycle_id).toBe('review-cycle-1');
    expect(state.findings.find(item => item.fingerprint === 'finding-wave-3')?.review_cycle_id).toBe('review-cycle-1');
    expect(state.findings.find(item => item.fingerprint === 'finding-new-cycle')?.repair_attempts).toBe(1);
  });

  test('bounds verification admission and closes repair waves without allowing reuse', () => {
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

    expect(applyFindingDelta(admittedFinding('finding-verification-a', 'review-cycle-1'), 'admit-a').status).toBe('success');
    expect(applyFindingDelta(repairAttempt('finding-verification-a', 'review-cycle-1', 'repair-wave-1'), 'repair-a-wave-1').status).toBe('success');
    expect(applyFindingDelta({ kind: 'finding-queue', action: 'resolve', fingerprint: 'finding-verification-a', evidence_refs: ['test:evidence:resolve-a'] }, 'resolve-a').status).toBe('success');

    expect(applyFindingDelta(admittedFinding('finding-verification-b', 'review-cycle-1', 'verification', 'verification-wave-1'), 'admit-b').status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      cycle_phase: 'verification',
      repair_round: 1,
      counted_repair_wave_ids: ['repair-wave-1'],
      active_repair_wave_id: null,
      verification_new_finding_wave_used: true,
      verification_new_finding_wave_id: 'verification-wave-1',
    });
    expect(applyFindingDelta(admittedFinding('finding-verification-c', 'review-cycle-1', 'verification', 'verification-wave-1'), 'admit-c').status).toBe('success');

    const closedWaveReuse = applyFindingDelta(repairAttempt('finding-verification-b', 'review-cycle-1', 'repair-wave-1'), 'repair-b-closed-wave');
    expect(closedWaveReuse.status).toBe('blocked');
    expect(closedWaveReuse.code).toBe('REPAIR_WAVE_CLOSED');

    expect(applyFindingDelta(repairAttempt('finding-verification-b', 'review-cycle-1', 'repair-wave-2'), 'repair-b-wave-2').status).toBe('success');
    expect(applyFindingDelta(repairAttempt('finding-verification-c', 'review-cycle-1', 'repair-wave-2'), 'repair-c-wave-2').status).toBe('success');
    const duplicateWaveAttempt = applyFindingDelta(repairAttempt('finding-verification-c', 'review-cycle-1', 'repair-wave-2'), 'repair-c-wave-2-repeat');
    expect(duplicateWaveAttempt.status).toBe('blocked');
    expect(duplicateWaveAttempt.code).toBe('REPAIR_WAVE_FINDING_DUPLICATE');

    const secondVerificationWave = applyFindingDelta(admittedFinding('finding-verification-d', 'review-cycle-1', 'verification', 'verification-wave-2'), 'admit-d');
    expect(secondVerificationWave.status).toBe('blocked');
    expect(secondVerificationWave.code).toBe('NEW_FINDING_WAVE_BUDGET_EXHAUSTED');
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual({
      id: 'review-cycle-1',
      cycle_phase: 'verification',
      repair_round: 2,
      counted_repair_wave_ids: ['repair-wave-1', 'repair-wave-2'],
      active_repair_wave_id: 'repair-wave-2',
      verification_new_finding_wave_used: true,
      verification_new_finding_wave_id: null,
    });
  });

  test('atomically closes active + active into the canonical archive and preserves task history', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const before = readCanonicalCurrentTask(root);
    const proposal = archiveProposal(root);
    const result = applyVNextRuntimeProposal(root, proposal, { now: () => '2026-09-01T00:00:00.000Z' });

    expect(result.status).toBe('success');
    expect(result.committed).toBe(true);
    expect(result.governed_mutation_count).toBe(2);
    expect(result.planned_writes).toEqual([
      'docs/workflow/CURRENT_TASK.md',
      'TASKS/TASK-010-runtime-fixture.md',
    ]);
    expect(result.archive_path).toBe('TASKS/TASK-010-runtime-fixture.md');
    expect(result.archive_revision).toMatch(/^[a-f0-9]{64}$/);

    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.workflow_status).toBe('closed');
    expect(after.runtimeState.lifecycle_state).toBe('archived');
    expect(after.runtimeState.active_step_status).toBe('completed');
    expect(after.runtimeState.task_id).toBe(before.runtimeState.task_id);
    expect(after.runtimeState.task_slug).toBe(before.runtimeState.task_slug);
    expect(after.frontmatter.document_id).toBe(before.frontmatter.document_id);
    expect(after.body).toContain('original background');
    expect(after.body).toContain('original implementation plan');
    expect(after.body).toContain('historical execution record');
    expect(after.body).toContain('action: archive');
    expect(after.runtimeState.execution_log).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'archive',
        from_workflow_status: 'active',
        from_lifecycle_state: 'active',
        to_workflow_status: 'closed',
        to_lifecycle_state: 'archived',
        source_revision: before.sourceTuple.revision,
        archive_path: 'TASKS/TASK-010-runtime-fixture.md',
        lesson_admission: { decision: 'defer', candidate_refs: [], evidence_refs: [] },
      }),
    ]));

    const archivePath = path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md');
    const archive = fs.readFileSync(archivePath, 'utf8');
    expect(archive).toContain('## 任务元数据');
    expect(archive).toContain('## 原始任务包快照');
    expect(archive).toContain('## 实际改动摘要');
    expect(archive).toContain('## 契约与决策记录');
    expect(archive).toContain('## 验证与交付证据');
    expect(archive).toContain('## Lessons 回写');
    expect(archive).toContain('## 后续关联');
    expect(archive).toContain('- task_id: 010');
    expect(archive).toContain('- task_slug: runtime-fixture');
    expect(archive).toContain(`- document_id: ${before.frontmatter.document_id}`);
    expect(archive).toContain(`- source_revision: ${before.sourceTuple.revision}`);
    expect(archive).toContain('- archive_path: TASKS/TASK-010-runtime-fixture.md');
    expect(archive).toContain('decision: defer');
    expect(archive).toContain('candidate_refs: []');
    expect(archive).toContain('evidence_refs: []');
    expect(archive).toContain('> # vNext CURRENT_TASK');
    expect(archive).not.toContain('TASK_SUMMARY.md');
    expect(fs.existsSync(path.join(root, 'TASKS', 'runtime-fixture'))).toBe(false);
  });

  test('runs STATUS and admitted Lesson as independent typed transactions after archive', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const delta = archiveDelta({
      lesson_admission: {
        decision: 'admit',
        candidate_refs: ['lesson-runtime-close'],
        evidence_refs: ['test:evidence:lesson'],
      },
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
    });
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, delta, 'archive-admit-1')).status).toBe('success');

    const archivePath = path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md');
    const currentPath = readCanonicalCurrentTask(root).filePath;
    const archiveBeforeStatus = fs.readFileSync(archivePath, 'utf8');
    const currentBeforeStatus = fs.readFileSync(currentPath, 'utf8');
    const status = statusProposal(root);
    const statusResult = applyVNextRuntimeProposal(root, status, { now: () => '2026-09-01T00:01:00.000Z' });
    expect(statusResult.status).toBe('success');
    expect(statusResult.governed_mutation_count).toBe(1);
    expect(statusResult.planned_writes).toEqual(['docs/workflow/STATUS.md']);
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBeforeStatus);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(currentBeforeStatus);
    expect(fs.readFileSync(path.join(root, 'docs', 'workflow', 'STATUS.md'), 'utf8')).toContain('runtime fixture task completed');

    const lessonsBefore = fs.readFileSync(path.join(root, 'docs', 'workflow', 'LESSONS.md'), 'utf8');
    const lesson = lessonProposal(root);
    const lessonResult = applyVNextRuntimeProposal(root, lesson, { now: () => '2026-09-01T00:02:00.000Z' });
    expect(lessonResult.status).toBe('success');
    expect(lessonResult.governed_mutation_count).toBe(1);
    expect(lessonResult.planned_writes).toEqual(['docs/workflow/LESSONS.md']);
    const lessonsAfter = fs.readFileSync(path.join(root, 'docs', 'workflow', 'LESSONS.md'), 'utf8');
    expect(lessonsAfter).not.toBe(lessonsBefore);
    expect(lessonsAfter).toContain('A close transaction spans multiple durable governance documents.');
    expect(lessonsAfter).toContain('Keep archive, status, and lesson writes independently retryable.');
    expect(lessonsAfter).toContain('vNext lesson record');

    expect(applyVNextRuntimeProposal(root, status).status).toBe('no-op');
    expect(applyVNextRuntimeProposal(root, lesson).status).toBe('no-op');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBeforeStatus);
  });

  test('persists defer and no-op lesson admission without allowing a Lesson write', () => {
    for (const decision of ['defer', 'no-op'] as const) {
      const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
      const delta = archiveDelta({ lesson_admission: { decision, candidate_refs: [], evidence_refs: [] } });
      expect(applyVNextRuntimeProposal(root, archiveProposal(root, delta, `archive-${decision}-1`)).status).toBe('success');
      const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
      const before = fs.readFileSync(lessonsPath, 'utf8');
      const result = applyVNextRuntimeProposal(root, lessonProposal(root, lessonDelta(), `lesson-${decision}-1`));
      expect(result.status).toBe('blocked');
      expect(result.code).toBe('KNOWLEDGE_ADMISSION_INVALID');
      expect(fs.readFileSync(lessonsPath, 'utf8')).toBe(before);
    }
  });

  test('preview returns eligibility and delivery summary without any Runtime mutation', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const currentPath = readCanonicalCurrentTask(root).filePath;
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const before = [currentPath, statusPath, lessonsPath].map(filePath => fs.readFileSync(filePath, 'utf8'));
    const preview = previewCloseTask(root, archiveDelta());

    expect(preview.status).toBe('eligible');
    expect(preview.closure_eligibility).toEqual({ eligible: true, blockers: [] });
    expect(preview.delivery_summary?.goal).toBe('finish the runtime fixture task');
    expect(preview.lesson_admission?.decision).toBe('defer');
    expect(preview.archive_path).toBe('TASKS/TASK-010-runtime-fixture.md');
    expect(preview.planned_operations).toEqual(['archive-transaction', 'project-status-transaction']);
    expect(preview.governed_mutation_count).toBe(0);
    expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
    expect([currentPath, statusPath, lessonsPath].map(filePath => fs.readFileSync(filePath, 'utf8'))).toEqual(before);
  });

  test('blocks closure for every non-success lifecycle tuple and every unresolved closure gate', () => {
    const illegalTuples: Array<Partial<RuntimeState>> = [
      { workflow_status: 'draft', lifecycle_state: 'active' },
      { workflow_status: 'blocked_by_replan', lifecycle_state: 'active' },
      { workflow_status: 'superseded', lifecycle_state: 'active' },
      { workflow_status: 'suspended', lifecycle_state: 'paused_pending_closure', resume_requires_review: true, resume_review_reasons: ['manual_review_pending'] },
      { workflow_status: 'suspended', lifecycle_state: 'interrupted', resume_requires_review: true, resume_review_reasons: ['environment_recovery_pending'] },
    ];
    for (const [index, tuple] of illegalTuples.entries()) {
      const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', ...tuple }));
      const result = applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), `archive-illegal-tuple-${index}`));
      expect(result.status).toBe('blocked');
      expect(result.code).toBe('CLOSURE_TUPLE_INVALID');
      expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
    }

    const blockedDeltas: ArchiveDelta[] = [
      archiveDelta({ closure_evidence: closureEvidence({ acceptance_satisfied: false }) }),
      archiveDelta({ closure_evidence: closureEvidence({ validation_complete: false }) }),
      archiveDelta({ closure_evidence: closureEvidence({ no_admitted_or_in_progress_findings: false }) }),
      archiveDelta({ closure_evidence: closureEvidence({ no_unresolved_closure_blocker: false }) }),
      archiveDelta({ closure_evidence: closureEvidence({ remaining_risks_non_blocking: false }) }),
      archiveDelta({ closure_evidence: closureEvidence({ archive_path_verified: false }) }),
    ];
    for (const [index, delta] of blockedDeltas.entries()) {
      const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
      const result = applyVNextRuntimeProposal(root, archiveProposal(root, delta, `archive-illegal-gate-${index}`));
      expect(result.status).toBe('blocked');
      expect(result.code).toBe('CLOSURE_NOT_ELIGIBLE');
      expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
    }
    expect(() => archiveProposal(makeRoot(makeRuntimeState({ active_step_status: 'completed' })), archiveDelta({
      closure_evidence: closureEvidence({ release_evidence: { triggered: true, complete: false, evidence_refs: ['test:evidence:release'] } }),
      evidence_refs: ['test:evidence:closure', 'test:evidence:release'],
    }), 'archive-triggered-release-incomplete')).toThrow(/CLOSURE_EVIDENCE_INVALID/);

    const findingRoot = makeRoot(makeRuntimeState({
      active_step_status: 'completed',
      findings: [runtimeFinding('finding-open-at-close', 'admitted')],
    }));
    const findingResult = applyVNextRuntimeProposal(findingRoot, archiveProposal(findingRoot, archiveDelta(), 'archive-open-finding'));
    expect(findingResult.status).toBe('blocked');
    expect(findingResult.code).toBe('CLOSURE_NOT_ELIGIBLE');
  });

  test('requires the execution audit section before close and before archive reconciliation', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const current = readCanonicalCurrentTask(root);
    const before = current.raw;
    fs.writeFileSync(current.filePath, before.replace(/\r?\n## 执行记录[\s\S]*$/, '\n'), 'utf8');
    const result = applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'archive-missing-audit'));
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('RUNTIME_SECTION_INVALID');
    expect(fs.readFileSync(current.filePath, 'utf8')).not.toContain('action: archive');
    expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);

    fs.writeFileSync(current.filePath, before, 'utf8');
    const auditReplayProposal = archiveProposal(root, archiveDelta(), 'archive-audit-replay');
    expect(applyVNextRuntimeProposal(root, auditReplayProposal).status).toBe('success');
    const closed = readCanonicalCurrentTask(root);
    fs.writeFileSync(closed.filePath, closed.raw.replace(/\r?\n## 执行记录[\s\S]*$/, '\n'), 'utf8');
    const replay = applyVNextRuntimeProposal(root, auditReplayProposal);
    expect(replay.status).toBe('blocked');
    expect(replay.code).toBe('RUNTIME_REPLAY_INCOMPLETE');
  });

  test('rolls back CURRENT_TASK and a newly created archive together when archive read-back fails', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const current = readCanonicalCurrentTask(root);
    const before = current.raw;
    const proposal = archiveProposal(root, archiveDelta(), 'archive-dual-rollback');
    let readCount = 0;
    const kernel = new GovernanceTransactionKernel(root, targetRoot => {
      readCount += 1;
      if (readCount === 2) throw new Error('simulated archive post-commit read-back failure');
      return readCanonicalCurrentTask(targetRoot);
    });

    const result = kernel.apply(proposal, { now: () => '2026-09-01T00:03:00.000Z' });
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('READ_BACK_FAILED');
    expect(result.governed_mutation_count).toBe(0);
    expect(result.message).toContain('exact two-file rollback verified');
    expect(readCount).toBe(3);
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before);
    expect(readCanonicalCurrentTask(root).raw).toBe(before);
    expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
  });

  test('fails stale archive source tuples before writing either close file', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const proposal = archiveProposal(root, archiveDelta(), 'archive-stale-source');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { status: 'completed', idempotency_key: 'step-drifts-close-source' })).status).toBe('success');
    const currentBefore = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
    const stale = applyVNextRuntimeProposal(root, proposal);
    expect(stale.status).toBe('conflict');
    expect(stale.code).toBe('SOURCE_TUPLE_MISMATCH');
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(currentBefore);
    expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
  });

  test('archive replay is a no-op only for the exact receipt and fails closed on missing, drifted, or mismatched provenance', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const proposal = archiveProposal(root, archiveDelta(), 'archive-replay-integrity');
    expect(applyVNextRuntimeProposal(root, proposal).status).toBe('success');
    const archivePath = path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md');
    const currentPath = readCanonicalCurrentTask(root).filePath;
    const archiveBefore = fs.readFileSync(archivePath, 'utf8');
    const currentBefore = fs.readFileSync(currentPath, 'utf8');
    expect(applyVNextRuntimeProposal(root, proposal).status).toBe('no-op');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBefore);

    fs.rmSync(archivePath);
    const missing = applyVNextRuntimeProposal(root, proposal);
    expect(missing.status).toBe('blocked');
    expect(missing.code).toBe('ARCHIVE_MISSING');
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(currentBefore);

    fs.writeFileSync(archivePath, archiveBefore.replace('goal: finish the runtime fixture task', 'goal: drifted archive content'), 'utf8');
    const drifted = applyVNextRuntimeProposal(root, proposal);
    expect(drifted.status).toBe('blocked');
    expect(drifted.code).toBe('ARCHIVE_PROVENANCE_MISMATCH');

    fs.writeFileSync(archivePath, archiveBefore.replace('- archive_caller: close-task', '- archive_caller: other-caller'), 'utf8');
    const provenance = applyVNextRuntimeProposal(root, proposal);
    expect(provenance.status).toBe('blocked');
    expect(provenance.code).toBe('ARCHIVE_PROVENANCE_MISMATCH');
  });

  test('a supersede/replan generation boundary does not let an old archive proposal close again', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const archiveA = archiveProposal(root, archiveDelta(), 'archive-generation-a');
    expect(applyVNextRuntimeProposal(root, archiveA).status).toBe('success');
    const current = readCanonicalCurrentTask(root);
    const reentry = archiveProposal(root, archiveDelta(), 'archive-generation-reentry');
    expect(applyVNextRuntimeProposal(root, reentry).status).toBe('no-op');
    expect(readCanonicalCurrentTask(root).runtimeState.execution_log.filter(item => 'action' in item && item.action === 'archive')).toHaveLength(1);
    expect(applyVNextRuntimeProposal(root, archiveA).status).toBe('no-op');
    expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(current.sourceTuple.revision);
  });

  test('retries STATUS reconciliation without repeating archive and keeps archive on STATUS failure', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const archive = archiveProposal(root, archiveDelta(), 'archive-status-reconcile');
    expect(applyVNextRuntimeProposal(root, archive).status).toBe('success');
    const archivePath = path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md');
    const currentPath = readCanonicalCurrentTask(root).filePath;
    const archiveBefore = fs.readFileSync(archivePath, 'utf8');
    const currentBefore = fs.readFileSync(currentPath, 'utf8');
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    const statusBefore = fs.readFileSync(statusPath, 'utf8');
    fs.rmSync(statusPath);
    const status = statusProposal(root);
    const failure = applyVNextRuntimeProposal(root, status);
    expect(failure.status).toBe('blocked');
    expect(failure.code).toBe('RUNTIME_SOURCE_MISSING');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBefore);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(currentBefore);

    fs.writeFileSync(statusPath, statusBefore, 'utf8');
    const retried = applyVNextRuntimeProposal(root, status);
    expect(retried.status).toBe('success');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBefore);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(currentBefore);
    expect(applyVNextRuntimeProposal(root, status).status).toBe('no-op');

    const conflicting = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta({ status: 'observing', summary: 'different status' }), 'status-conflict'));
    expect(conflicting.status).toBe('blocked');
    expect(conflicting.code).toBe('STATUS_RECONCILIATION_CONFLICT');
  });

  test('lesson persistence failure does not roll back archive or STATUS and later reads admission from archive', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const delta = archiveDelta({
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-runtime-close'], evidence_refs: ['test:evidence:lesson'] },
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
    });
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, delta, 'archive-lesson-retry')).status).toBe('success');
    const status = statusProposal(root);
    expect(applyVNextRuntimeProposal(root, status).status).toBe('success');
    const archivePath = path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md');
    const currentPath = readCanonicalCurrentTask(root).filePath;
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    const archiveBefore = fs.readFileSync(archivePath, 'utf8');
    const currentBefore = fs.readFileSync(currentPath, 'utf8');
    const statusBefore = fs.readFileSync(statusPath, 'utf8');
    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    fs.rmSync(lessonsPath);
    const lesson = lessonProposal(root);
    const failure = applyVNextRuntimeProposal(root, lesson);
    expect(failure.status).toBe('blocked');
    expect(failure.code).toBe('RUNTIME_SOURCE_MISSING');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBefore);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(currentBefore);
    expect(fs.readFileSync(statusPath, 'utf8')).toBe(statusBefore);

    fs.writeFileSync(lessonsPath, [
      '# LESSONS.md', '',
      '## 使用规则', '', '- reusable only', '',
      '## 通用', '', '- none', '',
      '## 数据与存储', '', '- none', '',
      '## 前端与交互', '', '- none', '',
      '## 后端与服务', '', '- none', '',
      '## 测试与回归', '', '- none', '',
      '## 部署与运行时', '', '- none', '',
    ].join('\n'), 'utf8');
    expect(applyVNextRuntimeProposal(root, lesson).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, lesson).status).toBe('no-op');
  });

  test('keeps the closed + archived task non-executable, non-resumable, and non-replanable', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'archive-terminal-boundary')).status).toBe('success');
    const closed = readCanonicalCurrentTask(root);
    const execution = applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'step-after-archive' }));
    expect(execution.status).toBe('blocked');
    expect(execution.code).toBe('TASK_STATE_NOT_ACTIVE');
    const pause = applyVNextRuntimeProposal(root, createLifecycleProposal(closed, {
      mode: 'pause',
      delta: pauseDelta(),
      idempotency_key: 'pause-after-archive',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      evidence_refs: ['test:evidence:pause'],
    }));
    expect(pause.status).toBe('blocked');
    expect(pause.code).toBe('LIFECYCLE_TRANSITION_INVALID');
    const replan = applyVNextRuntimeProposal(root, replanProposal(root, 'mark-replan-blocked', 'replan-after-archive'));
    expect(replan.status).toBe('blocked');
    expect(replan.code).toBe('REPLAN_TRANSITION_INVALID');
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
