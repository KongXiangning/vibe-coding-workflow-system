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
  createInboxRecordProposal,
  createLessonRecordProposal,
  createLifecycleProposal,
  createProjectStatusProposal,
  createPrepareTaskReplanProposal,
  createPrepareTaskConfirmProposal,
  createPrepareTaskDraftProposal,
  createPrepareTaskUpdateDraftProposal,
  createPrepareTaskResumeReviewProposal,
  createTaskStateProposal,
  createReviewCycleZero,
  GovernanceTransactionKernel,
  previewCloseTask,
  readCanonicalCurrentTask,
  readDurableLessonRecords,
  readLessonMarkers,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type ArchiveDelta,
  type ClosureEvidence,
  type DeliverySummary,
  type DraftTaskDefinition,
  type FindingRecord,
  type FindingQueueDelta,
  type InboxRecordDelta,
  type LifecycleDelta,
  type LessonRecordDelta,
  type ReplanReplacementDefinition,
  type ReplanTaskStateAction,
  type RuntimeProposal,
  type RuntimeState,
  type ProjectStatusDelta,
} from '../scripts/vnext-runtime';
import { validateCurrentTaskStatusTuple as validatePureVNextStatusTuple } from '../runtime/vnext/src/task-identity';

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
  fs.mkdirSync(path.join(root, 'TASKS', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'login.ts'), 'export function loginFixture() { return true; }\n', 'utf8');
  return root;
}

function evidence(...kinds: AuthorityEvidence['kind'][]): AuthorityEvidence[] {
  return kinds.map(kind => ({ kind, source: 'docs/workflow/CURRENT_TASK.md', subject: 'task-evidence' }));
}

function confirmationAuthority(
  task: CanonicalCurrentTask,
  kind: 'user-confirmation' | 'authorized-caller' = 'user-confirmation',
  overrides: Partial<AuthorityEvidence> = {},
): AuthorityEvidence[] {
  return [
    {
      kind,
      source: 'docs/workflow/CURRENT_TASK.md',
      subject: task.runtimeState.task_id,
      task_id: task.runtimeState.task_id,
      document_id: task.sourceTuple.document_id,
      draft_revision: task.sourceTuple.revision,
      ...overrides,
    },
    {
      kind: 'evidence-admission',
      source: 'docs/workflow/CURRENT_TASK.md',
      subject: task.runtimeState.task_id,
    },
  ];
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

function draftDefinition(overrides: Partial<DraftTaskDefinition> = {}): DraftTaskDefinition {
  return {
    background_context: '- draft background',
    acceptance: '- [ ] draft acceptance',
    allowed_scope: '- scripts/**',
    conditional_scope: '- docs/** when evidence is present',
    forbidden_scope: '- .git/**',
    affected_contracts: '- no contract changes',
    confirmed_decisions: '- use the current project baseline',
    open_questions: '- none',
    implementation_plan: '- implement the prepared draft step',
    implementation_steps: [
      '- step-1: implement the prepared draft step',
      '  - purpose: implement the prepared draft step',
      '  - mutation_scope: scripts/**',
      '  - required_evidence: test:evidence:step-1',
      '  - review_checkpoint: not-required',
    ].join('\n'),
    regression_checks: '- [ ] run the focused regression suite',
    rollback_points: '- restore the prior canonical task document if validation fails',
    design_constraints: null,
    post_release_validation: null,
    propagation_governance: null,
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

function archiveAuthority(): AuthorityEvidence[] {
  return evidence('active-task-owner', 'evidence-admission');
}

function reconciliationAuthority(): AuthorityEvidence[] {
  return evidence('evidence-admission');
}

function archiveProposal(root: string, delta: ArchiveDelta = archiveDelta(), idempotencyKey = 'archive-close-1'): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createArchiveProposal(current, {
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: archiveAuthority(),
    evidence_refs: delta.evidence_refs,
  });
}

function statusProposal(root: string, delta: ProjectStatusDelta = statusDelta(), idempotencyKey = 'status-close-1'): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createProjectStatusProposal(current, {
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: reconciliationAuthority(),
    evidence_refs: delta.evidence_refs,
  });
}

function lessonProposal(root: string, delta: LessonRecordDelta = lessonDelta(), idempotencyKey = 'lesson-close-1'): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  return createLessonRecordProposal(current, {
    delta,
    idempotency_key: idempotencyKey,
    authority_evidence: reconciliationAuthority(),
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

function inboxDelta(current: ReturnType<typeof readCanonicalCurrentTask>, overrides: Partial<InboxRecordDelta> = {}): InboxRecordDelta {
  return {
    kind: 'inbox-record',
    action: 'record',
    item_slug: 'windows-installation-documentation',
    record: {
      artifact_kind: 'inbox_item',
      item_id: '20260903-7c2a',
      title: 'Windows installation documentation is incomplete',
      type: 'requirement',
      source: 'user',
      captured_at: '2026-09-03T08:00:00.000Z',
      relation_to_current_task: 'unrelated',
      current_task_id: current.runtimeState.task_id,
      description: 'The Windows installation path needs a complete setup guide.',
      evidence: 'The active task implements the login endpoint; installation documentation is outside its admitted product scope.',
      suggested_next_action: 'triage_later',
      status: 'captured',
    },
    relation_evidence_refs: ['fixture:evidence:unrelated-install-docs'],
    duplicate_check: 'clear',
    proposed_owner: 'triage_later',
    target_path: 'TASKS/inbox/INBOX-20260903-7c2a-windows-installation-documentation.md',
    evidence_refs: ['fixture:evidence:unrelated-install-docs'],
    ...overrides,
  };
}

function captureProposal(root: string, overrides: Partial<InboxRecordDelta> = {}): ReturnType<typeof createInboxRecordProposal> {
  const current = readCanonicalCurrentTask(root);
  const delta = inboxDelta(current, overrides);
  return createInboxRecordProposal(current, {
    delta,
    idempotency_key: 'capture-inbox-20260903-7c2a',
    authority_evidence: evidence('evidence-admission'),
    evidence_refs: delta.evidence_refs,
  });
}

function inboxFiles(root: string): string[] {
  const directory = path.join(root, 'TASKS', 'inbox');
  return fs.readdirSync(directory).filter(file => file.endsWith('.md')).sort();
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext Phase 2 Runtime contract', () => {
  test('validates the bound Runtime slice including capture-work-item', () => {
    const result = validateVNextRuntimeContract(ROOT);
    expect(result.phase).toBe('Phase 2');
    expect(result.bound_operations).toEqual([
      'task-state-transaction',
      'finding-queue-transaction',
      'lifecycle-transaction',
      'inbox-record-transaction',
      'project-status-transaction',
      'archive-transaction',
      'lesson-record-transaction',
    ]);
    expect(result.unbound_operations).toEqual([]);
  });

  test('pure vNext rejects the legacy archived + archived workflow tuple', () => {
    expect(() => validatePureVNextStatusTuple('archived', 'archived')).toThrow(/当前状态 must use one of/);
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

  test('captures one unrelated work item in an isolated pure-vNext Virtual Project and preserves record-only state', () => {
    const root = makeRoot(makeRuntimeState({ task_id: '901', task_slug: 'fixture-login-endpoint' }));
    expect(root).not.toBe(ROOT);
    const current = readCanonicalCurrentTask(root);
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const productPath = path.join(root, 'src', 'login.ts');
    const before = {
      current: fs.readFileSync(current.filePath, 'utf8'),
      status: fs.readFileSync(statusPath, 'utf8'),
      lessons: fs.readFileSync(lessonsPath, 'utf8'),
      product: fs.readFileSync(productPath, 'utf8'),
      state: current.runtimeState,
    };
    const proposal = captureProposal(root);

    const applied = applyVNextRuntimeProposal(root, proposal);

    expect(applied.status).toBe('success');
    expect(applied.committed).toBe(true);
    expect(applied.governed_mutation_count).toBe(1);
    expect(applied.target_path).toBe(proposal.semantic_delta.target_path);
    expect(inboxFiles(root)).toEqual(['INBOX-20260903-7c2a-windows-installation-documentation.md']);
    const recordPath = path.join(root, ...proposal.semantic_delta.target_path.split('/'));
    const recordBytes = fs.readFileSync(recordPath, 'utf8');
    expect(recordBytes).toContain('- relation_to_current_task: unrelated');
    expect(recordBytes).toContain('- current_task_id: 901');
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before.current);
    expect(fs.readFileSync(statusPath, 'utf8')).toBe(before.status);
    expect(fs.readFileSync(lessonsPath, 'utf8')).toBe(before.lessons);
    expect(fs.readFileSync(productPath, 'utf8')).toBe(before.product);
    expect(readCanonicalCurrentTask(root).runtimeState).toEqual(before.state);

    const replay = applyVNextRuntimeProposal(root, proposal);

    expect(replay.status).toBe('no-op');
    expect(replay.committed).toBe(false);
    expect(replay.read_back_verified).toBe(true);
    expect(inboxFiles(root)).toHaveLength(1);
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(recordBytes);
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before.current);
  });

  test('replays a committed capture after CURRENT_TASK advances without rewriting the latest task state', () => {
    const root = makeRoot(makeRuntimeState({ task_id: '939', task_slug: 'fixture-capture-replay-advance' }));
    const proposal = captureProposal(root);
    const firstResult = applyVNextRuntimeProposal(root, proposal);
    expect(firstResult.status).toBe('success');
    expect(firstResult.committed).toBe(true);

    const recordPath = path.join(root, ...proposal.semantic_delta.target_path.split('/'));
    const recordBeforeAdvance = fs.readFileSync(recordPath, 'utf8');
    const inboxBeforeAdvance = inboxFiles(root);
    const taskMutation = applyVNextRuntimeProposal(root, taskProposal(root, {
      idempotency_key: 'fixture-capture-replay-advance-task',
    }));
    expect(taskMutation.status).toBe('success');

    const currentAfterAdvance = readCanonicalCurrentTask(root);
    const currentBytesAfterAdvance = fs.readFileSync(currentAfterAdvance.filePath, 'utf8');
    expect(currentAfterAdvance.sourceTuple.revision).not.toBe(proposal.source_tuple.revision);

    const replay = applyVNextRuntimeProposal(root, proposal);

    expect(replay.status).toBe('no-op');
    expect(replay.committed).toBe(false);
    expect(replay.read_back_verified).toBe(true);
    expect(replay.governed_mutation_count).toBe(0);
    expect(inboxFiles(root)).toEqual(inboxBeforeAdvance);
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(recordBeforeAdvance);
    expect(fs.readFileSync(currentAfterAdvance.filePath, 'utf8')).toBe(currentBytesAfterAdvance);
    expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(currentAfterAdvance.sourceTuple.revision);
  });

  test('fails closed with zero writes for non-admitted capture relations and incomplete admission fields', () => {
    const cases: Array<{ name: string; mutate: (proposal: ReturnType<typeof captureProposal>) => unknown }> = [
      {
        name: 'related',
        mutate: proposal => ({
          ...proposal,
          semantic_delta: {
            ...proposal.semantic_delta,
            record: { ...proposal.semantic_delta.record, relation_to_current_task: 'related' },
          },
        }),
      },
      {
        name: 'uncertain',
        mutate: proposal => ({
          ...proposal,
          semantic_delta: {
            ...proposal.semantic_delta,
            record: { ...proposal.semantic_delta.record, relation_to_current_task: 'uncertain' },
          },
        }),
      },
      {
        name: 'scope widening',
        mutate: proposal => ({
          ...proposal,
          semantic_delta: {
            ...proposal.semantic_delta,
            record: { ...proposal.semantic_delta.record, relation_to_current_task: 'scope_widening_candidate' },
          },
        }),
      },
      {
        name: 'duplicate unresolved',
        mutate: proposal => ({
          ...proposal,
          semantic_delta: { ...proposal.semantic_delta, duplicate_check: 'duplicate_suspected' },
        }),
      },
      {
        name: 'owner unresolved',
        mutate: proposal => ({
          ...proposal,
          semantic_delta: { ...proposal.semantic_delta, proposed_owner: 'unresolved' },
        }),
      },
      {
        name: 'missing admission precondition',
        mutate: proposal => ({
          ...proposal,
          preconditions: proposal.preconditions.filter(precondition => precondition !== 'owner-route-resolved'),
        }),
      },
      {
        name: 'malformed identity',
        mutate: proposal => ({
          ...proposal,
          semantic_delta: {
            ...proposal.semantic_delta,
            record: { ...proposal.semantic_delta.record, item_id: 'not-an-inbox-id' },
          },
        }),
      },
      {
        name: 'unsupported schema',
        mutate: proposal => ({ ...proposal, schema_version: 99 }),
      },
    ];

    for (const [index, item] of cases.entries()) {
      const root = makeRoot(makeRuntimeState({ task_id: String(910 + index), task_slug: `fixture-capture-${index}` }));
      const proposal = captureProposal(root);
      const currentBefore = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
      const result = applyVNextRuntimeProposal(root, item.mutate(proposal));
      expect(result.status, item.name).toBe('blocked');
      expect(result.committed, item.name).toBe(false);
      expect(result.governed_mutation_count, item.name).toBe(0);
      expect(inboxFiles(root), item.name).toHaveLength(0);
      expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8'), item.name).toBe(currentBefore);
    }
  });

  test('rejects caller paths outside the deterministic inbox target and identity-derived path mismatches', () => {
    const requestedTargets = [
      'C:\\outside\\record.md',
      '../TASKS/inbox/INBOX-20260903-7c2a-windows-installation-documentation.md',
      'docs/workflow/CURRENT_TASK.md',
      'TASKS/TASK-901-fixture-login-endpoint.md',
      'src/login.ts',
    ];
    for (const [index, requestedTarget] of requestedTargets.entries()) {
      const root = makeRoot(makeRuntimeState({ task_id: String(930 + index), task_slug: `fixture-path-${index}` }));
      const proposal = captureProposal(root);
      const result = applyVNextRuntimeProposal(root, {
        ...proposal,
        idempotency_key: `capture-invalid-target-${index}`,
        requested_write_targets: [requestedTarget],
      });
      expect(result.status, requestedTarget).toBe('blocked');
      expect(result.code, requestedTarget).toBe('RUNTIME_PATH_INVALID');
      expect(inboxFiles(root), requestedTarget).toHaveLength(0);
    }

    const root = makeRoot(makeRuntimeState({ task_id: '935', task_slug: 'fixture-claimed-path' }));
    const proposal = captureProposal(root);
    const mismatch = applyVNextRuntimeProposal(root, {
      ...proposal,
      semantic_delta: {
        ...proposal.semantic_delta,
        target_path: 'TASKS/inbox/INBOX-20260903-7c2a-other-slug.md',
      },
    });
    expect(mismatch.status).toBe('blocked');
    expect(mismatch.code).toBe('RUNTIME_PATH_INVALID');
    expect(inboxFiles(root)).toHaveLength(0);
  });

  test('does not overwrite an identity collision even when the conflicting proposal is stale', () => {
    const collisionRoot = makeRoot(makeRuntimeState({ task_id: '936', task_slug: 'fixture-collision' }));
    const firstProposal = captureProposal(collisionRoot);
    expect(applyVNextRuntimeProposal(collisionRoot, firstProposal).status).toBe('success');
    const recordPath = path.join(collisionRoot, ...firstProposal.semantic_delta.target_path.split('/'));
    const originalRecord = fs.readFileSync(recordPath, 'utf8');
    const collisionProposal = createInboxRecordProposal(readCanonicalCurrentTask(collisionRoot), {
      delta: {
        ...firstProposal.semantic_delta,
        record: {
          ...firstProposal.semantic_delta.record,
          title: 'Different semantic content for the same stable inbox identity',
        },
      },
      idempotency_key: 'capture-inbox-identity-collision',
      authority_evidence: evidence('evidence-admission'),
      evidence_refs: firstProposal.semantic_delta.evidence_refs,
    });
    const collisionTaskMutation = applyVNextRuntimeProposal(collisionRoot, taskProposal(collisionRoot, {
      idempotency_key: 'fixture-collision-source-advance',
    }));
    expect(collisionTaskMutation.status).toBe('success');
    const collisionCurrentAfterMutation = readCanonicalCurrentTask(collisionRoot);
    const collisionCurrentBytes = fs.readFileSync(collisionCurrentAfterMutation.filePath, 'utf8');
    const collision = applyVNextRuntimeProposal(collisionRoot, collisionProposal);
    expect(collision.status).toBe('blocked');
    expect(collision.code).toBe('INBOX_IDENTITY_CONFLICT');
    expect(inboxFiles(collisionRoot)).toHaveLength(1);
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(originalRecord);
    expect(fs.readFileSync(collisionCurrentAfterMutation.filePath, 'utf8')).toBe(collisionCurrentBytes);
  });

  test('rejects an idempotency key already bound to another durable inbox target before stale-source handling', () => {
    const root = makeRoot(makeRuntimeState({ task_id: '940', task_slug: 'fixture-idempotency-collision' }));
    const firstProposal = captureProposal(root);
    expect(applyVNextRuntimeProposal(root, firstProposal).status).toBe('success');
    const sourceBeforeAdvance = readCanonicalCurrentTask(root);
    const secondBase = inboxDelta(sourceBeforeAdvance);
    const secondDelta = inboxDelta(sourceBeforeAdvance, {
      item_slug: 'windows-installation-checklist',
      record: {
        ...secondBase.record,
        item_id: '20260903-8d4e',
        title: 'A second inbox target with the same idempotency key',
      },
      target_path: 'TASKS/inbox/INBOX-20260903-8d4e-windows-installation-checklist.md',
    });
    const secondProposal = createInboxRecordProposal(sourceBeforeAdvance, {
      delta: secondDelta,
      idempotency_key: firstProposal.idempotency_key,
      authority_evidence: evidence('evidence-admission'),
      evidence_refs: secondDelta.evidence_refs,
    });
    expect(applyVNextRuntimeProposal(root, taskProposal(root, {
      idempotency_key: 'fixture-idempotency-collision-source-advance',
    })).status).toBe('success');
    const currentAfterAdvance = readCanonicalCurrentTask(root);
    const currentBytesAfterAdvance = fs.readFileSync(currentAfterAdvance.filePath, 'utf8');
    const firstRecordPath = path.join(root, ...firstProposal.semantic_delta.target_path.split('/'));
    const firstRecordBytes = fs.readFileSync(firstRecordPath, 'utf8');

    const collision = applyVNextRuntimeProposal(root, secondProposal);

    expect(collision.status).toBe('conflict');
    expect(collision.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(inboxFiles(root)).toEqual(['INBOX-20260903-7c2a-windows-installation-documentation.md']);
    expect(fs.existsSync(path.join(root, ...secondDelta.target_path.split('/')))).toBe(false);
    expect(fs.readFileSync(firstRecordPath, 'utf8')).toBe(firstRecordBytes);
    expect(fs.readFileSync(currentAfterAdvance.filePath, 'utf8')).toBe(currentBytesAfterAdvance);
  });

  test('rejects an uncommitted stale capture proposal before writing', () => {
    const staleRoot = makeRoot(makeRuntimeState({ task_id: '937', task_slug: 'fixture-stale-capture' }));
    const staleProposal = captureProposal(staleRoot);
    const taskMutation = applyVNextRuntimeProposal(staleRoot, taskProposal(staleRoot, {
      idempotency_key: 'fixture-stale-source-mutation',
    }));
    expect(taskMutation.status).toBe('success');
    const currentAfterMutation = fs.readFileSync(readCanonicalCurrentTask(staleRoot).filePath, 'utf8');
    const staleResult = applyVNextRuntimeProposal(staleRoot, staleProposal);
    expect(staleResult.status).toBe('conflict');
    expect(staleResult.code).toBe('SOURCE_TUPLE_MISMATCH');
    expect(inboxFiles(staleRoot)).toHaveLength(0);
    expect(fs.readFileSync(readCanonicalCurrentTask(staleRoot).filePath, 'utf8')).toBe(currentAfterMutation);
  });

  test('uses atomic writer/read-back boundaries and leaves no partial inbox record after failure', () => {
    const root = makeRoot(makeRuntimeState({ task_id: '938', task_slug: 'fixture-atomic-capture' }));
    const proposal = captureProposal(root);
    const targetPath = path.join(root, ...proposal.semantic_delta.target_path.split('/'));
    const writeFailureKernel = new GovernanceTransactionKernel(root, undefined, undefined, () => {
      throw new Error('simulated staged writer failure');
    });
    const writeFailure = writeFailureKernel.apply(proposal);
    expect(writeFailure.status).toBe('blocked');
    expect(writeFailure.code).toBe('ATOMIC_COMMIT_FAILED');
    expect(fs.existsSync(targetPath)).toBe(false);

    const partialWriterKernel = new GovernanceTransactionKernel(root, undefined, undefined, operations => {
      const operation = operations[0]!;
      fs.mkdirSync(path.dirname(operation.path), { recursive: true });
      fs.writeFileSync(operation.path, 'partial inbox record\n', 'utf8');
      throw new Error('simulated staged writer failure after promotion');
    });
    const partialWriteFailure = partialWriterKernel.apply(proposal);
    expect(partialWriteFailure.status).toBe('blocked');
    expect(partialWriteFailure.code).toBe('ATOMIC_COMMIT_FAILED');
    expect(fs.existsSync(targetPath)).toBe(false);

    const readBackFailureKernel = new GovernanceTransactionKernel(root, undefined, () => {
      throw new Error('simulated inbox read-back failure');
    });
    const readBackFailure = readBackFailureKernel.apply(proposal);
    expect(readBackFailure.status).toBe('blocked');
    expect(readBackFailure.code).toBe('READ_BACK_FAILED');
    expect(readBackFailure.message).toContain('rollback read-back verified');
    expect(fs.existsSync(targetPath)).toBe(false);
    expect(inboxFiles(root)).toHaveLength(0);
  });

  test('runs the ordinary draft refinement confirmation and execution path, then allocates the next identity after archive', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);
    const firstDefinition = draftDefinition();
    const create = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: firstDefinition,
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:draft-create'],
      idempotency_key: 'draft-create-001',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    const created = applyVNextRuntimeProposal(root, create, { now: () => '2026-08-31T01:00:00.000Z' });
    expect(created.status).toBe('success');
    expect(created.read_back_verified).toBe(true);
    const draft = readCanonicalCurrentTask(root);
    expect(draft.runtimeState.task_id).toBe('001');
    expect(draft.runtimeState.workflow_status).toBe('draft');
    expect(draft.runtimeState.lifecycle_state).toBe('active');
    expect(draft.sourceTuple.document_id).toBe('doc-111111111111111111111111');
    expect(draft.runtimeState.execution_log[0]?.action).toBe('create-draft');
    const createReplay = applyVNextRuntimeProposal(root, create);
    expect(createReplay.status).toBe('no-op');
    expect(createReplay.committed).toBe(false);

    const executeBeforeConfirm = applyVNextRuntimeProposal(root, taskProposal(root, {
      idempotency_key: 'draft-execute-before-confirm',
    }));
    expect(executeBeforeConfirm.status).toBe('blocked');
    expect(executeBeforeConfirm.code).toBe('DRAFT_NOT_EXECUTABLE');

    const refine = createPrepareTaskUpdateDraftProposal(draft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: draftDefinition({
        background_context: '- refined first-task background',
      }),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:draft-update'],
      idempotency_key: 'draft-update-001',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    const refined = applyVNextRuntimeProposal(root, refine, { now: () => '2026-08-31T01:01:00.000Z' });
    expect(refined.status).toBe('success');
    const refinedTask = readCanonicalCurrentTask(root);
    expect(refinedTask.runtimeState.task_id).toBe('001');
    expect(refinedTask.runtimeState.task_slug).toBe('first-task');
    expect(refinedTask.sourceTuple.document_id).toBe('doc-111111111111111111111111');
    expect(refinedTask.runtimeState.active_step_id).toBe('step-1');
    expect(refinedTask.runtimeState.active_step_status).toBe('ready');
    expect(refinedTask.body).toContain('refined first-task background');

    const staleConfirm = createPrepareTaskConfirmProposal(draft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      draft_revision: draft.sourceTuple.revision,
      evidence_refs: ['test:evidence:draft-confirm'],
      idempotency_key: 'draft-confirm-stale',
      authority_evidence: confirmationAuthority(draft, 'user-confirmation'),
    });
    expect(applyVNextRuntimeProposal(root, staleConfirm).status).toBe('conflict');

    const unauthorizedConfirm = createPrepareTaskConfirmProposal(refinedTask, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      draft_revision: refinedTask.sourceTuple.revision,
      evidence_refs: ['test:evidence:draft-confirm'],
      idempotency_key: 'draft-confirm-unauthorized',
      authority_evidence: evidence('evidence-admission'),
    });
    const unauthorized = applyVNextRuntimeProposal(root, unauthorizedConfirm);
    expect(unauthorized.status).toBe('blocked');
    expect(unauthorized.code).toBe('RUNTIME_AUTHORITY_MISSING');

    const confirm = createPrepareTaskConfirmProposal(refinedTask, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      draft_revision: refinedTask.sourceTuple.revision,
      evidence_refs: ['test:evidence:draft-confirm'],
      idempotency_key: 'draft-confirm-001',
      authority_evidence: confirmationAuthority(refinedTask, 'user-confirmation'),
    });
    expect(confirm.mode).toBe('confirm');
    const confirmed = applyVNextRuntimeProposal(root, confirm, { now: () => '2026-08-31T01:02:00.000Z' });
    expect(confirmed.status).toBe('success');
    const active = readCanonicalCurrentTask(root);
    expect(active.runtimeState.workflow_status).toBe('active');
    expect(active.runtimeState.lifecycle_state).toBe('active');
    expect(active.runtimeState.execution_log.some(item => item.action === 'confirm-draft')).toBe(true);
    const confirmReplay = applyVNextRuntimeProposal(root, confirm);
    expect(confirmReplay.status).toBe('no-op');
    expect(confirmReplay.committed).toBe(false);

    const executed = applyVNextRuntimeProposal(root, taskProposal(root, {
      idempotency_key: 'draft-execute-after-confirm',
      evidence_refs: ['test:evidence:draft-execute'],
    }));
    expect(executed.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');

    const closed = applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({ evidence_refs: ['test:evidence:draft-close'] }), 'archive-first-task'));
    expect(closed.status).toBe('success');
    const archivePath = path.join(root, closed.archive_path ?? 'TASKS/TASK-001-first-task.md');
    const archiveBeforeNextDraft = fs.readFileSync(archivePath, 'utf8');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('closed');

    const closedTask = readCanonicalCurrentTask(root);
    const prematureSecondCreate = createPrepareTaskDraftProposal(closedTask, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'second-task',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Second task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:second-create'],
      idempotency_key: 'draft-create-002-premature',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    const prematureResult = applyVNextRuntimeProposal(root, prematureSecondCreate);
    expect(prematureResult.status).toBe('blocked');
    expect(prematureResult.code).toBe('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE');

    const statusResult = applyVNextRuntimeProposal(root, statusProposal(root));
    expect(statusResult.status).toBe('success');

    const secondCreate = createPrepareTaskDraftProposal(closedTask, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'second-task',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Second task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:second-create'],
      idempotency_key: 'draft-create-002',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, secondCreate).status).toBe('success');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBeforeNextDraft);
    const secondDraft = readCanonicalCurrentTask(root);
    expect(secondDraft.runtimeState.task_id).toBe('002');
    expect(secondDraft.runtimeState.workflow_status).toBe('draft');

    const secondConfirm = createPrepareTaskConfirmProposal(secondDraft, {
      task_id: '002',
      task_slug: 'second-task',
      document_id: 'doc-222222222222222222222222',
      draft_revision: secondDraft.sourceTuple.revision,
      evidence_refs: ['test:evidence:second-confirm'],
      idempotency_key: 'draft-confirm-002',
      authority_evidence: confirmationAuthority(secondDraft, 'authorized-caller'),
    });
    expect(applyVNextRuntimeProposal(root, secondConfirm).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState).toMatchObject({
      task_id: '002',
      task_slug: 'second-task',
      workflow_status: 'active',
      lifecycle_state: 'active',
    });
  });

  test('blocks confirmation with unresolved draft decisions without mutating the canonical draft', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);
    const created = applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'unresolved-task',
      task_title: 'Unresolved task',
      draft_definition: draftDefinition({
        open_questions: '- user must choose the release channel',
      }),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:unresolved-create'],
      idempotency_key: 'draft-create-unresolved',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    }));
    expect(created.status).toBe('success');
    const draft = readCanonicalCurrentTask(root);
    const before = fs.readFileSync(draft.filePath, 'utf8');
    const result = applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft, {
      task_id: '001',
      task_slug: 'unresolved-task',
      document_id: draft.sourceTuple.document_id,
      draft_revision: draft.sourceTuple.revision,
      evidence_refs: ['test:evidence:unresolved-confirm'],
      idempotency_key: 'draft-confirm-unresolved',
      authority_evidence: confirmationAuthority(draft, 'user-confirmation'),
    }));
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('DRAFT_DECISION_UNRESOLVED');
    expect(fs.readFileSync(draft.filePath, 'utf8')).toBe(before);
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('draft');
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
    const statusAfter = fs.readFileSync(path.join(root, 'docs', 'workflow', 'STATUS.md'), 'utf8');
    expect(statusAfter).toContain('- 当前状态：completed');
    expect(statusAfter).toContain('runtime fixture task completed');
    expect(statusAfter).toContain('- runtime fixture task');
    expect(statusAfter).toContain('- none beyond the completed task');
    expect(statusAfter).toContain('- observe the next project checkpoint');

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

  test('projects completed status items into the fixed STATUS sections and fails on ambiguous in-progress records', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    const statusBeforeArchive = fs.readFileSync(statusPath, 'utf8').replace(
      '## 🔨 正在开发\n\n- [ ] none',
      '## 🔨 正在开发\n\n- [ ] runtime fixture task',
    );
    fs.writeFileSync(statusPath, statusBeforeArchive, 'utf8');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'archive-status-projection')).status).toBe('success');

    const statusResult = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta(), 'status-projection'));
    expect(statusResult.status).toBe('success');
    const projected = fs.readFileSync(statusPath, 'utf8');
    expect(projected).toContain('## ✅ 已完成且稳定\n\n- [ ] baseline\n- runtime fixture task');
    expect(projected).toContain('## 🔨 正在开发\n\n## 📋 待开发');
    fs.writeFileSync(statusPath, projected.replace('- runtime fixture task\n\n## 🔨 正在开发', '- drifted completed item\n\n## 🔨 正在开发'), 'utf8');
    const statusReplay = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta(), 'status-projection'));
    expect(statusReplay.status).toBe('blocked');
    expect(statusReplay.code).toBe('STATUS_PROVENANCE_MISMATCH');

    const ambiguousRoot = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const ambiguousStatusPath = path.join(ambiguousRoot, 'docs', 'workflow', 'STATUS.md');
    const ambiguousStatus = fs.readFileSync(ambiguousStatusPath, 'utf8').replace(
      '## 🔨 正在开发\n\n- [ ] none',
      '## 🔨 正在开发\n\n- [ ] runtime fixture task\n- [x] runtime fixture task',
    );
    fs.writeFileSync(ambiguousStatusPath, ambiguousStatus, 'utf8');
    expect(applyVNextRuntimeProposal(ambiguousRoot, archiveProposal(ambiguousRoot, archiveDelta(), 'archive-status-ambiguous')).status).toBe('success');
    const ambiguousBefore = fs.readFileSync(ambiguousStatusPath, 'utf8');
    const ambiguousResult = applyVNextRuntimeProposal(ambiguousRoot, statusProposal(ambiguousRoot, statusDelta(), 'status-ambiguous'));
    expect(ambiguousResult.status).toBe('blocked');
    expect(ambiguousResult.code).toBe('STATUS_RECONCILIATION_CONFLICT');
    expect(fs.readFileSync(ambiguousStatusPath, 'utf8')).toBe(ambiguousBefore);
  });

  test('fails Lesson replay when the provenance marker survives but its visible record drifts', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const archiveDeltaWithLesson = archiveDelta({
      lesson_admission: {
        decision: 'admit',
        candidate_refs: ['lesson-runtime-close'],
        evidence_refs: ['test:evidence:lesson'],
      },
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
    });
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDeltaWithLesson, 'archive-lesson-integrity')).status).toBe('success');
    const lesson = lessonProposal(root);
    expect(applyVNextRuntimeProposal(root, lesson).status).toBe('success');

    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const beforeDrift = fs.readFileSync(lessonsPath, 'utf8');
    expect(beforeDrift).toContain('vNext lesson record');
    fs.writeFileSync(
      lessonsPath,
      beforeDrift.replace(
        '  - 结论："Keep archive, status, and lesson writes independently retryable."',
        '  - 结论：drifted visible conclusion',
      ),
      'utf8',
    );
    const replay = applyVNextRuntimeProposal(root, lesson);
    expect(replay.status).toBe('blocked');
    expect(replay.code).toBe('LESSON_PROVENANCE_MISMATCH');
    expect(fs.readFileSync(lessonsPath, 'utf8')).toContain('drifted visible conclusion');
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

  test('blocks new draft creation when previous task close reconciliation is incomplete', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);
    const create001 = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-1'],
      idempotency_key: 'draft-create-001',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, create001).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    const confirm001 = createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'draft-confirm-001',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    });
    expect(applyVNextRuntimeProposal(root, confirm001).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');

    const archiveResult = applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      lesson_admission: { decision: 'defer', candidate_refs: [], evidence_refs: [] },
    }), 'archive-task-1'));
    expect(archiveResult.status).toBe('success');
    const archivePath = path.join(root, archiveResult.archive_path!);
    const archiveBytesBefore = fs.readFileSync(archivePath, 'utf8');

    const closed001 = readCanonicalCurrentTask(root);
    const draft002Proposal = createPrepareTaskDraftProposal(closed001, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'second-task',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Second task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-2'],
      idempotency_key: 'draft-create-002-unreconciled',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });

    const blockedBeforeStatus = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(blockedBeforeStatus.status).toBe('blocked');
    expect(blockedBeforeStatus.code).toBe('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBytesBefore);
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('closed');

    const statusResult = applyVNextRuntimeProposal(root, statusProposal(root));
    expect(statusResult.status).toBe('success');

    const create002Success = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(create002Success.status).toBe('success');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBytesBefore);
    expect(readCanonicalCurrentTask(root).runtimeState.task_id).toBe('002');
  });

  test('blocks new draft creation when admitted Lesson reconciliation is incomplete', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);
    const create001 = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-1'],
      idempotency_key: 'draft-create-001',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, create001).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    const confirm001 = createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'draft-confirm-001',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    });
    expect(applyVNextRuntimeProposal(root, confirm001).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');

    const archiveResult = applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-runtime-close'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-task-admit'));
    expect(archiveResult.status).toBe('success');
    const archivePath = path.join(root, archiveResult.archive_path!);
    const archiveBytesBefore = fs.readFileSync(archivePath, 'utf8');

    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const closed001 = readCanonicalCurrentTask(root);
    const draft002Proposal = createPrepareTaskDraftProposal(closed001, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'second-task',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Second task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-2'],
      idempotency_key: 'draft-create-002-admit-unreconciled',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });

    const blockedBeforeLesson = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(blockedBeforeLesson.status).toBe('blocked');
    expect(blockedBeforeLesson.code).toBe('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBytesBefore);

    const lessonResult = applyVNextRuntimeProposal(root, lessonProposal(root));
    expect(lessonResult.status).toBe('success');

    const createSuccess = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(createSuccess.status).toBe('success');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBytesBefore);
    expect(readCanonicalCurrentTask(root).runtimeState.task_id).toBe('002');
  });

  test('enforces confirmation authority binding to current task, document, and exact draft revision', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);

    const createWithOwner = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create'],
      idempotency_key: 'draft-create-owner',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    const ownerResult = applyVNextRuntimeProposal(root, createWithOwner);
    expect(ownerResult.status).toBe('blocked');
    expect(ownerResult.code).toBe('RUNTIME_AUTHORITY_MISSING');

    const create = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create'],
      idempotency_key: 'draft-create-001',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, create).status).toBe('success');
    const draft = readCanonicalCurrentTask(root);

    const wrongTaskConfirm = createPrepareTaskConfirmProposal(draft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft.sourceTuple.document_id,
      draft_revision: draft.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm'],
      idempotency_key: 'draft-confirm-wrong-task',
      authority_evidence: confirmationAuthority(draft, 'user-confirmation', { task_id: '002' }),
    });
    const wrongTaskResult = applyVNextRuntimeProposal(root, wrongTaskConfirm);
    expect(wrongTaskResult.status).toBe('blocked');
    expect(wrongTaskResult.code).toBe('DRAFT_IDENTITY_CONFLICT');

    const wrongDocConfirm = createPrepareTaskConfirmProposal(draft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft.sourceTuple.document_id,
      draft_revision: draft.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm'],
      idempotency_key: 'draft-confirm-wrong-doc',
      authority_evidence: confirmationAuthority(draft, 'user-confirmation', { document_id: 'doc-999999999999999999999999' }),
    });
    const wrongDocResult = applyVNextRuntimeProposal(root, wrongDocConfirm);
    expect(wrongDocResult.status).toBe('blocked');
    expect(wrongDocResult.code).toBe('DRAFT_IDENTITY_CONFLICT');

    const unboundConfirm = createPrepareTaskConfirmProposal(draft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft.sourceTuple.document_id,
      draft_revision: draft.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm'],
      idempotency_key: 'draft-confirm-unbound',
      authority_evidence: evidence('user-confirmation', 'evidence-admission'),
    });
    const unboundResult = applyVNextRuntimeProposal(root, unboundConfirm);
    expect(unboundResult.status).toBe('blocked');
    expect(unboundResult.code).toBe('RUNTIME_AUTHORITY_INVALID');

    const oldRevisionAuthority = confirmationAuthority(draft, 'user-confirmation');
    const update = createPrepareTaskUpdateDraftProposal(draft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft.sourceTuple.document_id,
      task_title: 'First task',
      draft_definition: draftDefinition({ background_context: '- updated context' }),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:update'],
      idempotency_key: 'draft-update-1',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, update).status).toBe('success');
    const updatedDraft = readCanonicalCurrentTask(root);
    expect(updatedDraft.sourceTuple.revision).not.toBe(draft.sourceTuple.revision);

    const staleAuthConfirm = createPrepareTaskConfirmProposal(updatedDraft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: updatedDraft.sourceTuple.document_id,
      draft_revision: updatedDraft.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm'],
      idempotency_key: 'draft-confirm-stale-auth',
      authority_evidence: oldRevisionAuthority,
    });
    const staleResult = applyVNextRuntimeProposal(root, staleAuthConfirm);
    expect(staleResult.status).toBe('blocked');
    expect(staleResult.code).toBe('DRAFT_REVISION_CONFLICT');

    const validConfirm = createPrepareTaskConfirmProposal(updatedDraft, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: updatedDraft.sourceTuple.document_id,
      draft_revision: updatedDraft.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm'],
      idempotency_key: 'draft-confirm-valid',
      authority_evidence: confirmationAuthority(updatedDraft, 'user-confirmation'),
    });
    const validResult = applyVNextRuntimeProposal(root, validConfirm);
    expect(validResult.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('active');
  });

  test('enforces strict step admission and first admitted step on ordinary drafts', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);

    const incompleteSingleStep = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'step-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Step task',
      draft_definition: draftDefinition({ implementation_steps: '- step-1: single step without metadata' }),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create'],
      idempotency_key: 'draft-single-no-meta',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    const singleResult = applyVNextRuntimeProposal(root, incompleteSingleStep);
    expect(singleResult.status).toBe('blocked');
    expect(singleResult.code).toBe('TASK_STEPS_INVALID');

    const incompleteMultiStep = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'step-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Step task',
      draft_definition: draftDefinition({
        implementation_steps: [
          '- step-1: first step',
          '  - purpose: first step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:1',
          '  - review_checkpoint: not-required',
          '- step-2: second step without metadata',
        ].join('\n'),
      }),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create'],
      idempotency_key: 'draft-multi-no-meta',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    const multiResult = applyVNextRuntimeProposal(root, incompleteMultiStep);
    expect(multiResult.status).toBe('blocked');
    expect(multiResult.code).toBe('TASK_STEPS_INVALID');

    const missingBoundaryStep = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'step-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Step task',
      draft_definition: draftDefinition({
        implementation_steps: [
          '- step-1: first step',
          '  - purpose: first step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:1',
          '  - review_checkpoint: required',
        ].join('\n'),
      }),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create'],
      idempotency_key: 'draft-no-boundary',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    const boundaryResult = applyVNextRuntimeProposal(root, missingBoundaryStep);
    expect(boundaryResult.status).toBe('blocked');
    expect(boundaryResult.code).toBe('TASK_STEPS_INVALID');

    const skipStepDraft = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'step-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Step task',
      draft_definition: draftDefinition({
        implementation_steps: [
          '- step-1: first step',
          '  - purpose: first step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:1',
          '  - review_checkpoint: not-required',
          '- step-2: second step',
          '  - purpose: second step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:2',
          '  - review_checkpoint: not-required',
        ].join('\n'),
      }),
      active_step_id: 'step-2',
      evidence_refs: ['test:evidence:create'],
      idempotency_key: 'draft-skip-step',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    const skipResult = applyVNextRuntimeProposal(root, skipStepDraft);
    expect(skipResult.status).toBe('blocked');
    expect(skipResult.code).toBe('TASK_STEPS_INVALID');

    const validDraftProposal = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'step-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Step task',
      draft_definition: draftDefinition({
        implementation_steps: [
          '- step-1: first step',
          '  - purpose: first step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:1',
          '  - review_checkpoint: not-required',
          '- step-2: second step',
          '  - purpose: second step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:2',
          '  - review_checkpoint: not-required',
        ].join('\n'),
      }),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create'],
      idempotency_key: 'draft-valid-steps',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, validDraftProposal).status).toBe('success');
    const draft = readCanonicalCurrentTask(root);

    const updateSkip = createPrepareTaskUpdateDraftProposal(draft, {
      task_id: '001',
      task_slug: 'step-task',
      document_id: draft.sourceTuple.document_id,
      task_title: 'Step task',
      draft_definition: draftDefinition({
        implementation_steps: [
          '- step-1: first step',
          '  - purpose: first step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:1',
          '  - review_checkpoint: not-required',
          '- step-2: second step',
          '  - purpose: second step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:2',
          '  - review_checkpoint: not-required',
        ].join('\n'),
      }),
      active_step_id: 'step-2',
      evidence_refs: ['test:evidence:update'],
      idempotency_key: 'draft-update-skip',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    const updateSkipResult = applyVNextRuntimeProposal(root, updateSkip);
    expect(updateSkipResult.status).toBe('blocked');
    expect(updateSkipResult.code).toBe('TASK_STEPS_INVALID');
  });

  test('semantic-duplicate Lesson writes durable reuse proof without duplicate visible text and unblocks next draft', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));

    // Setup TASK-001 with lesson-a admitted and persisted
    const bootstrap = readCanonicalCurrentTask(root);
    const create001 = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-1'],
      idempotency_key: 'draft-create-001',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, create001).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    const confirm001 = createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'draft-confirm-001',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    });
    expect(applyVNextRuntimeProposal(root, confirm001).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');

    // Archive 001 with lesson admission: admit lesson-a
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-a'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-001')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const lessonA: LessonCandidate = {
      candidate_ref: 'lesson-a',
      category: '测试与回归',
      scene: 'Reconciliation spans multiple files.',
      conclusion: 'Keep archive, status, and lesson independent.',
      trigger: 'Task close execution',
      cause: 'Coupled transactions cause partial rollback',
      action: 'Execute each typed transaction sequentially',
      consumer: 'close-task',
      evidence_refs: ['test:evidence:lesson'],
    };
    const lessonProposal001 = lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [lessonA],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-record-001');
    expect(applyVNextRuntimeProposal(root, lessonProposal001).status).toBe('success');

    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const lessonsAfter001 = fs.readFileSync(lessonsPath, 'utf8');
    expect(lessonsAfter001).toContain('Keep archive, status, and lesson independent.');
    expect(lessonsAfter001.split('Keep archive, status, and lesson independent.').length - 1).toBe(1);

    // Now create, confirm, and execute TASK-002
    const closed001 = readCanonicalCurrentTask(root);
    const create002 = createPrepareTaskDraftProposal(closed001, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'second-task',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Second task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-2'],
      idempotency_key: 'draft-create-002',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, create002).status).toBe('success');
    const draft002 = readCanonicalCurrentTask(root);
    const confirm002 = createPrepareTaskConfirmProposal(draft002, {
      task_id: '002',
      task_slug: 'second-task',
      document_id: draft002.sourceTuple.document_id,
      draft_revision: draft002.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-2'],
      idempotency_key: 'draft-confirm-002',
      authority_evidence: confirmationAuthority(draft002, 'user-confirmation'),
    });
    expect(applyVNextRuntimeProposal(root, confirm002).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-2' })).status).toBe('success');

    // Archive 002 with lesson admission: admit lesson-b (identical content to lesson-a)
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-b'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-002')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    // Before lesson-record: create TASK-003 is blocked
    const closed002 = readCanonicalCurrentTask(root);
    const draft003Proposal = createPrepareTaskDraftProposal(closed002, {
      action: 'create-draft',
      task_id: '003',
      task_slug: 'third-task',
      document_id: 'doc-333333333333333333333333',
      task_title: 'Third task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-3'],
      idempotency_key: 'draft-create-003',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    const blockedBeforeLesson = applyVNextRuntimeProposal(root, draft003Proposal);
    expect(blockedBeforeLesson.status).toBe('blocked');
    expect(blockedBeforeLesson.code).toBe('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE');

    // Record semantic duplicate lesson-b
    const lessonB: LessonCandidate = {
      ...lessonA,
      candidate_ref: 'lesson-b',
    };
    const lessonProposal002 = lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [lessonB],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-record-002');
    const lessonResult002 = applyVNextRuntimeProposal(root, lessonProposal002);
    expect(lessonResult002.status).toBe('success');

    const lessonsAfter002 = fs.readFileSync(lessonsPath, 'utf8');
    // Visible text is NOT duplicated!
    expect(lessonsAfter002.split('Keep archive, status, and lesson independent.').length - 1).toBe(1);
    // Durable reuse marker for TASK-002 exists!
    expect(lessonsAfter002).toContain('"disposition":"reused"');
    expect(lessonsAfter002).toContain('"reused_candidate":{');
    expect(lessonsAfter002).toContain('"candidate_ref":"lesson-a"');
    expect(lessonsAfter002).toContain('"task_id":"002"');

    // Replay of lesson-record-002 is idempotent no-op!
    const lessonReplay = applyVNextRuntimeProposal(root, lessonProposal002);
    expect(lessonReplay.status).toBe('no-op');

    // Now create TASK-003: SUCCESS!
    const create003Success = applyVNextRuntimeProposal(root, draft003Proposal);
    expect(create003Success.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.task_id).toBe('003');
  });

  test('blocks new draft creation when previous STATUS receipt visible projection has drifted', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);
    const create001 = createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'first-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'First task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-1'],
      idempotency_key: 'draft-create-001',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, create001).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    const confirm001 = createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'first-task',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'draft-confirm-001',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    });
    expect(applyVNextRuntimeProposal(root, confirm001).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');

    // Archive 001 (defer lesson)
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      lesson_admission: { decision: 'defer', candidate_refs: [], evidence_refs: [] },
    }), 'archive-001')).status).toBe('success');

    // Reconcile STATUS
    const statusResult = applyVNextRuntimeProposal(root, statusProposal(root));
    expect(statusResult.status).toBe('success');

    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    const statusValidContent = fs.readFileSync(statusPath, 'utf8');

    // Tamper with visible completed item in STATUS.md while keeping receipt intact
    const statusDrifted = statusValidContent.replace(
      'runtime fixture task',
      'tampered visible item',
    );
    expect(statusDrifted).not.toBe(statusValidContent);
    fs.writeFileSync(statusPath, statusDrifted, 'utf8');

    const closed001 = readCanonicalCurrentTask(root);
    const draft002Proposal = createPrepareTaskDraftProposal(closed001, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'second-task',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Second task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:create-2'],
      idempotency_key: 'draft-create-002-drift',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });

    // Blocked with STATUS_PROVENANCE_MISMATCH!
    const blockedDrift = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(blockedDrift.status).toBe('blocked');
    expect(blockedDrift.code).toBe('STATUS_PROVENANCE_MISMATCH');

    // Restore STATUS.md
    fs.writeFileSync(statusPath, statusValidContent, 'utf8');

    // Now create draft succeeds!
    const createSuccess = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(createSuccess.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.task_id).toBe('002');
  });

  test('validateVNextRuntimeContract machine-readably enforces reconciliation, step admission, and authority coordinates', () => {
    // Current live repository contract passes machine validation
    const valid = validateVNextRuntimeContract(ROOT);
    expect(valid.phase).toBe('Phase 2');

    // Contract missing previous_close_reconciliation fails closed
    const contractPath = path.join(ROOT, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml');
    const originalContract = fs.readFileSync(contractPath, 'utf8');
    try {
      const missingRecon = originalContract.replace(/previous_close_reconciliation:[\s\S]*?step_admission:/, 'step_admission:');
      fs.writeFileSync(contractPath, missingRecon, 'utf8');
      expect(() => validateVNextRuntimeContract(ROOT)).toThrow('RUNTIME_SCHEMA_INVALID');

      const invalidStep = originalContract.replace('active_step: first-admitted-step', 'active_step: any-step');
      fs.writeFileSync(contractPath, invalidStep, 'utf8');
      expect(() => validateVNextRuntimeContract(ROOT)).toThrow('RUNTIME_CONTRACT_INVALID');

      const missingCoords = originalContract.replace(/authority_coordinates:[\s\S]*?from: draft \+ active/, 'from: draft + active');
      fs.writeFileSync(contractPath, missingCoords, 'utf8');
      expect(() => validateVNextRuntimeContract(ROOT)).toThrow('RUNTIME_SCHEMA_INVALID');
    } finally {
      fs.writeFileSync(contractPath, originalContract, 'utf8');
    }
    expect(validateVNextRuntimeContract(ROOT).phase).toBe('Phase 2');
  });

  test('cross-task candidate_ref collision resolves to exact target coordinates', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));

    // Setup TASK-001 with lesson-1 persisted
    const bootstrap = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'task-one',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Task 1',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:1'],
      idempotency_key: 'draft-001',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'task-one',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'confirm-001',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-1'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-001')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const lesson1: LessonCandidate = {
      candidate_ref: 'lesson-1',
      category: '通用',
      scene: 'Cross-task candidate reference collision scene',
      conclusion: 'Always resolve exact 4-coordinate target',
      trigger: 'Collision scenario',
      cause: 'Multiple tasks use same candidate_ref',
      action: 'Target by task_id and archive_revision',
      consumer: 'lesson reconciliation',
      evidence_refs: ['test:evidence:lesson'],
    };
    expect(applyVNextRuntimeProposal(root, lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [lesson1],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-001')).status).toBe('success');

    // Setup TASK-002 which also has lesson-1 (reused from TASK-001)
    const closed001 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(closed001, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'task-two',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Task 2',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:2'],
      idempotency_key: 'draft-002',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft002 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft002, {
      task_id: '002',
      task_slug: 'task-two',
      document_id: draft002.sourceTuple.document_id,
      draft_revision: draft002.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-2'],
      idempotency_key: 'confirm-002',
      authority_evidence: confirmationAuthority(draft002, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-2' })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-1'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-002')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    // TASK-002 admits lesson-1 with same content -> should be reused
    expect(applyVNextRuntimeProposal(root, lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [lesson1],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-002')).status).toBe('success');

    // Setup TASK-003 which admits lesson-new with same content -> should be reused targeting TASK-001 specifically
    const closed002 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(closed002, {
      action: 'create-draft',
      task_id: '003',
      task_slug: 'task-three',
      document_id: 'doc-333333333333333333333333',
      task_title: 'Task 3',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:3'],
      idempotency_key: 'draft-003',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft003 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft003, {
      task_id: '003',
      task_slug: 'task-three',
      document_id: draft003.sourceTuple.document_id,
      draft_revision: draft003.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-3'],
      idempotency_key: 'confirm-003',
      authority_evidence: confirmationAuthority(draft003, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-3' })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-new'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-003')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const lessonNew: LessonCandidate = {
      ...lesson1,
      candidate_ref: 'lesson-new',
    };
    expect(applyVNextRuntimeProposal(root, lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [lessonNew],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-003')).status).toBe('success');

    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const lessonsContent = fs.readFileSync(lessonsPath, 'utf8');

    // Verify TASK-003's reuse marker explicitly points to TASK-001 (not TASK-002)
    const records = readDurableLessonRecords(lessonsContent, 'docs/workflow/LESSONS.md');
    const record003 = records.find(r => r.marker.task_id === '003' && r.marker.candidate_ref === 'lesson-new');
    expect(record003).toBeDefined();
    expect(record003!.marker.disposition).toBe('reused');
    expect(record003!.marker.reused_candidate).toBeDefined();
    expect(record003!.marker.reused_candidate!.task_id).toBe('001');
    expect(record003!.marker.reused_candidate!.candidate_ref).toBe('lesson-1');
  });

  test('reuse target coordinate drift fails closed', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'drift-task-1',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Drift Task 1',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:1'],
      idempotency_key: 'draft-drift-1',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'drift-task-1',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'confirm-drift-1',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-target'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-drift-1')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const lessonA: LessonCandidate = {
      candidate_ref: 'lesson-target',
      category: '通用',
      scene: 'Drift testing scene',
      conclusion: 'Coordinate drift must fail closed',
      trigger: 'Altering target coordinates',
      cause: 'Tampered marker',
      action: 'Validate exact 4 coordinates',
      consumer: 'lesson reconciliation',
      evidence_refs: ['test:evidence:lesson'],
    };
    expect(applyVNextRuntimeProposal(root, lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [lessonA],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-drift-1')).status).toBe('success');

    // Create 002 with reused candidate
    const closed001 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(closed001, {
      action: 'create-draft',
      task_id: '002',
      task_slug: 'drift-task-2',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Drift Task 2',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:2'],
      idempotency_key: 'draft-drift-2',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft002 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft002, {
      task_id: '002',
      task_slug: 'drift-task-2',
      document_id: draft002.sourceTuple.document_id,
      draft_revision: draft002.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-2'],
      idempotency_key: 'confirm-drift-2',
      authority_evidence: confirmationAuthority(draft002, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-2' })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['lesson-reused'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-drift-2')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const lessonB: LessonCandidate = {
      ...lessonA,
      candidate_ref: 'lesson-reused',
    };
    expect(applyVNextRuntimeProposal(root, lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [lessonB],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-drift-2')).status).toBe('success');

    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const validLessonsContent = fs.readFileSync(lessonsPath, 'utf8');

    // 1. Tamper task_id in reused_candidate
    const tamperedTaskId = validLessonsContent.replace('"reused_candidate":{"task_id":"001"', '"reused_candidate":{"task_id":"999"');
    expect(tamperedTaskId).not.toBe(validLessonsContent);
    expect(() => readDurableLessonRecords(tamperedTaskId, 'docs/workflow/LESSONS.md')).toThrow('LESSON_PROVENANCE_MISMATCH');

    // 2. Tamper document_id in reused_candidate
    const tamperedDocId = validLessonsContent.replace(
      /("reused_candidate":\{.*?"document_id":")[^"]+(")/,
      '$1doc-wrong$2',
    );
    expect(tamperedDocId).not.toBe(validLessonsContent);
    expect(() => readDurableLessonRecords(tamperedDocId, 'docs/workflow/LESSONS.md')).toThrow('LESSON_INVALID');

    // 3. Tamper archive_revision in reused_candidate
    const tamperedRev = validLessonsContent.replace(
      /("reused_candidate":\{.*?"archive_revision":")[a-f0-9]{64}(")/,
      '$1' + 'f'.repeat(64) + '$2',
    );
    expect(tamperedRev).not.toBe(validLessonsContent);
    expect(() => readDurableLessonRecords(tamperedRev, 'docs/workflow/LESSONS.md')).toThrow('LESSON_PROVENANCE_MISMATCH');

    // 4. Tamper candidate_ref in reused_candidate
    const tamperedRef = validLessonsContent.replace(
      /("reused_candidate":\{.*?"candidate_ref":")[^"]+(")/,
      '$1lesson-nonexistent$2',
    );
    expect(tamperedRef).not.toBe(validLessonsContent);
    expect(() => readDurableLessonRecords(tamperedRef, 'docs/workflow/LESSONS.md')).toThrow('LESSON_PROVENANCE_MISMATCH');

    // 5. Tamper candidate_digest in reused marker
    const tamperedDigest = validLessonsContent.replace(
      /("candidate_ref":"lesson-reused","candidate_digest":")[a-f0-9]{64}(")/,
      '$1' + 'e'.repeat(64) + '$2',
    );
    expect(tamperedDigest).not.toBe(validLessonsContent);
    expect(() => readDurableLessonRecords(tamperedDigest, 'docs/workflow/LESSONS.md')).toThrow('LESSON_PROVENANCE_MISMATCH');
  });

  test('same-proposal semantic duplicates produce single visible Lesson and exact reuse proof', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));

    const bootstrap = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'same-proposal-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Same Proposal Task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:1'],
      idempotency_key: 'draft-same-prop',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'same-proposal-task',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'confirm-same-prop',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');

    // Archive 001 admitting both candidate-a and candidate-b
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['candidate-a', 'candidate-b'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-same-prop')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const candidateA: LessonCandidate = {
      candidate_ref: 'candidate-a',
      category: '后端与服务',
      scene: 'Same proposal deduplication scene',
      conclusion: 'Single visible record written',
      trigger: 'Two duplicates in same proposal',
      cause: 'Redundant knowledge admitted together',
      action: 'Staged indexing creates reuse pointer',
      consumer: 'lesson reconciliation',
      evidence_refs: ['test:evidence:lesson'],
    };
    const candidateB: LessonCandidate = {
      ...candidateA,
      candidate_ref: 'candidate-b',
    };

    const prop = lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [candidateA, candidateB],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-same-prop');

    const result = applyVNextRuntimeProposal(root, prop);
    expect(result.status).toBe('success');
    expect(result.governed_mutation_count).toBe(1);

    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const lessonsContent = fs.readFileSync(lessonsPath, 'utf8');

    // Visible text is written only ONCE!
    expect(lessonsContent.split('Single visible record written').length - 1).toBe(1);

    // Both records parsed by readDurableLessonRecords
    const durableRecords = readDurableLessonRecords(lessonsContent, 'docs/workflow/LESSONS.md');
    const recA = durableRecords.find(r => r.marker.candidate_ref === 'candidate-a');
    const recB = durableRecords.find(r => r.marker.candidate_ref === 'candidate-b');
    expect(recA).toBeDefined();
    expect(recA!.marker.disposition).toBeUndefined(); // persisted has NO disposition
    expect(recB).toBeDefined();
    expect(recB!.marker.disposition).toBe('reused');
    expect(recB!.marker.reused_candidate).toEqual({
      task_id: '001',
      document_id: draft001.sourceTuple.document_id,
      archive_revision: recA!.marker.archive_revision,
      candidate_ref: 'candidate-a',
    });

    // Replay is strict no-op with identical content
    const replayResult = applyVNextRuntimeProposal(root, prop);
    expect(replayResult.status).toBe('no-op');
    expect(fs.readFileSync(lessonsPath, 'utf8')).toBe(lessonsContent);
  });

  test('same semantic content with different evidence_refs results in reuse while preserving evidence provenance', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));

    const bootstrap = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'diff-evidence-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Diff Evidence Task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:1'],
      idempotency_key: 'draft-diff-ev',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'diff-evidence-task',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'confirm-diff-ev',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');

    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:alpha', 'test:evidence:beta'],
      lesson_admission: { decision: 'admit', candidate_refs: ['cand-alpha', 'cand-beta'], evidence_refs: ['test:evidence:alpha', 'test:evidence:beta'] },
    }), 'archive-diff-ev')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const candAlpha: LessonCandidate = {
      candidate_ref: 'cand-alpha',
      category: '测试与回归',
      scene: 'Semantic equality excludes evidence_refs',
      conclusion: 'Evidence is provenance, not knowledge content',
      trigger: 'Different evidence_refs observed',
      cause: 'Provenance varies per test run',
      action: 'Exclude evidence_refs from candidate_digest',
      consumer: 'lesson deduplication',
      evidence_refs: ['test:evidence:alpha'],
    };
    const candBeta: LessonCandidate = {
      ...candAlpha,
      candidate_ref: 'cand-beta',
      evidence_refs: ['test:evidence:beta'], // Different evidence!
    };

    const prop = lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [candAlpha, candBeta],
      evidence_refs: ['test:evidence:alpha', 'test:evidence:beta'],
    }, 'lesson-diff-ev');

    expect(applyVNextRuntimeProposal(root, prop).status).toBe('success');

    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const lessonsContent = fs.readFileSync(lessonsPath, 'utf8');

    // cand-beta was reused
    const records = readDurableLessonRecords(lessonsContent, 'docs/workflow/LESSONS.md');
    const betaRec = records.find(r => r.marker.candidate_ref === 'cand-beta');
    expect(betaRec).toBeDefined();
    expect(betaRec!.marker.disposition).toBe('reused');
    expect(betaRec!.marker.reused_candidate!.candidate_ref).toBe('cand-alpha');
    // cand-beta keeps its own evidence_refs as provenance
    expect(betaRec!.marker.evidence_refs).toEqual(['test:evidence:beta']);
  });

  test('canonical Lesson markers reject unknown fields and invalid dispositions', () => {
    const root = makeRoot();
    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const content = fs.readFileSync(lessonsPath, 'utf8');
    const validMarker = {
      task_id: '001',
      task_slug: 'test',
      document_id: 'doc-111111111111111111111111',
      archive_path: 'TASKS/TASK-001-test.md',
      archive_revision: '1'.repeat(64),
      source_revision: '2'.repeat(64),
      candidate_ref: 'lesson-1',
      candidate_digest: '3'.repeat(64),
      evidence_refs: ['test:evidence'],
    };
    const renderMarker = (marker: Record<string, unknown>): string => `<!-- vNext lesson record: ${JSON.stringify(marker)} -->`;

    const persistedUnknownField = () => readLessonMarkers(renderMarker({ ...validMarker, unexpected_field: true }), 'docs/workflow/LESSONS.md');
    expect(persistedUnknownField).toThrow('LESSON_INVALID');
    expect(persistedUnknownField).toThrow('unsupported Lesson marker field');

    const reusedUnknownField = () => readLessonMarkers(renderMarker({
      ...validMarker,
      disposition: 'reused',
      reused_candidate: {
        task_id: '001',
        document_id: validMarker.document_id,
        archive_revision: validMarker.archive_revision,
        candidate_ref: validMarker.candidate_ref,
      },
      unexpected_field: true,
    }), 'docs/workflow/LESSONS.md');
    expect(reusedUnknownField).toThrow('LESSON_INVALID');
    expect(reusedUnknownField).toThrow('unsupported Lesson marker field');

    const persistedDisposition = () => readLessonMarkers(renderMarker({ ...validMarker, disposition: 'persisted' }), 'docs/workflow/LESSONS.md');
    expect(persistedDisposition).toThrow('LESSON_INVALID');
    expect(persistedDisposition).toThrow('invalid Lesson marker disposition');
    const archivedDisposition = () => readLessonMarkers(renderMarker({ ...validMarker, disposition: 'archived' }), 'docs/workflow/LESSONS.md');
    expect(archivedDisposition).toThrow('LESSON_INVALID');
    expect(archivedDisposition).toThrow('invalid Lesson marker disposition');
  });

  test('persisted and reused Candidate Identity fields use one strict validator', () => {
    const validMarker = {
      task_id: '001',
      task_slug: 'valid-task',
      document_id: 'doc-111111111111111111111111',
      archive_path: 'TASKS/TASK-001-valid-task.md',
      archive_revision: 'a'.repeat(64),
      source_revision: 'b'.repeat(64),
      candidate_ref: 'candidate-a',
      candidate_digest: 'c'.repeat(64),
      evidence_refs: ['test:evidence:lesson'],
    };
    const renderMarker = (marker: Record<string, unknown>): string => `<!-- vNext lesson record: ${JSON.stringify(marker)} -->`;
    const validTarget = {
      task_id: validMarker.task_id,
      document_id: validMarker.document_id,
      archive_revision: validMarker.archive_revision,
      candidate_ref: validMarker.candidate_ref,
    };
    const invalidKeys: Array<[keyof typeof validTarget, unknown]> = [
      ['task_id', 'garbage'],
      ['document_id', 'invalid'],
      ['archive_revision', 'non-sha256'],
      ['candidate_ref', 'bad ref'],
    ];

    for (const [field, value] of invalidKeys) {
      expect(() => readLessonMarkers(renderMarker({ ...validMarker, [field]: value }), 'docs/workflow/LESSONS.md')).toThrow('LESSON_INVALID');
      expect(() => readLessonMarkers(renderMarker({
        ...validMarker,
        disposition: 'reused',
        reused_candidate: { ...validTarget, [field]: value },
      }), 'docs/workflow/LESSONS.md')).toThrow('LESSON_INVALID');
    }

    expect(() => readLessonMarkers(renderMarker({ ...validMarker, task_slug: 'Invalid_Slug' }), 'docs/workflow/LESSONS.md')).toThrow('LESSON_INVALID');
  });

  test('canonical Lesson marker digest must match visible semantic content', () => {
    const root = makeRoot();
    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const lessonsContent = fs.readFileSync(lessonsPath, 'utf8');
    const validMarker = {
      task_id: '001',
      task_slug: 'canonical-digest-task',
      document_id: 'doc-111111111111111111111111',
      archive_path: 'TASKS/TASK-001-canonical-digest-task.md',
      archive_revision: 'a'.repeat(64),
      source_revision: 'b'.repeat(64),
      candidate_ref: 'canonical-candidate',
      candidate_digest: 'c'.repeat(64),
      evidence_refs: ['test:evidence:lesson'],
    };

    const candidate = {
      category: '通用',
      scene: 'Canonical digest scene',
      conclusion: 'Visible semantic content determines the digest.',
      trigger: 'Reading a canonical marker',
      cause: 'Digest provenance must be reproducible.',
      action: 'Reject mismatched durable provenance.',
      consumer: 'lesson reader',
      evidence_refs: ['test:evidence:lesson'],
    };
    const mismatchedMarker = `<!-- vNext lesson record: ${JSON.stringify({
      ...validMarker,
      candidate_digest: 'd'.repeat(64),
    })} -->`;
    const mismatchedContent = lessonsContent.replace(
      '## 通用\n\n- none',
      [
        '## 通用',
        '',
        mismatchedMarker,
        `- 场景：${candidate.scene}`,
        `  - 结论：${candidate.conclusion}`,
        `  - 触发信号：${candidate.trigger}`,
        `  - 原因：${candidate.cause}`,
        `  - 应对动作：${candidate.action}`,
        `  - 消费者：${candidate.consumer}`,
        `  - 证据引用：${JSON.stringify(candidate.evidence_refs)}`,
      ].join('\n'),
    );
    expect(() => readDurableLessonRecords(mismatchedContent, 'docs/workflow/LESSONS.md')).toThrow('LESSON_PROVENANCE_MISMATCH');
  });

  test('combined proposal replay is strictly idempotent no-op with identical file bytes', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));

    const bootstrap = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskDraftProposal(bootstrap, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'replay-combo-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Replay Combo Task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:1'],
      idempotency_key: 'draft-replay-combo',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    })).status).toBe('success');
    const draft001 = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createPrepareTaskConfirmProposal(draft001, {
      task_id: '001',
      task_slug: 'replay-combo-task',
      document_id: draft001.sourceTuple.document_id,
      draft_revision: draft001.sourceTuple.revision,
      evidence_refs: ['test:evidence:confirm-1'],
      idempotency_key: 'confirm-replay-combo',
      authority_evidence: confirmationAuthority(draft001, 'user-confirmation'),
    })).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1' })).status).toBe('success');

    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta({
      evidence_refs: ['test:evidence:closure', 'test:evidence:lesson'],
      lesson_admission: { decision: 'admit', candidate_refs: ['cand-x', 'cand-y', 'cand-z'], evidence_refs: ['test:evidence:lesson'] },
    }), 'archive-replay-combo')).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, statusProposal(root)).status).toBe('success');

    const candX: LessonCandidate = {
      candidate_ref: 'cand-x',
      category: '数据与存储',
      scene: 'Replay combo scene X',
      conclusion: 'X conclusion',
      trigger: 'X trigger',
      cause: 'X cause',
      action: 'X action',
      consumer: 'consumer X',
      evidence_refs: ['test:evidence:lesson'],
    };
    const candY: LessonCandidate = {
      ...candX,
      candidate_ref: 'cand-y',
    };
    const candZ: LessonCandidate = {
      candidate_ref: 'cand-z',
      category: '前端与交互',
      scene: 'Unique scene Z',
      conclusion: 'Z conclusion',
      trigger: 'Z trigger',
      cause: 'Z cause',
      action: 'Z action',
      consumer: 'consumer Z',
      evidence_refs: ['test:evidence:lesson'],
    };

    const prop = lessonProposal(root, {
      kind: 'lesson-record',
      action: 'record',
      candidates: [candX, candY, candZ],
      evidence_refs: ['test:evidence:lesson'],
    }, 'lesson-replay-combo');

    expect(applyVNextRuntimeProposal(root, prop).status).toBe('success');

    const lessonsPath = path.join(root, 'docs', 'workflow', 'LESSONS.md');
    const bytesFirstCommit = fs.readFileSync(lessonsPath, 'utf8');

    // Replay 1
    const replay1 = applyVNextRuntimeProposal(root, prop);
    expect(replay1.status).toBe('no-op');
    expect(fs.readFileSync(lessonsPath, 'utf8')).toBe(bytesFirstCommit);

    // Replay 2
    const replay2 = applyVNextRuntimeProposal(root, prop);
    expect(replay2.status).toBe('no-op');
    expect(fs.readFileSync(lessonsPath, 'utf8')).toBe(bytesFirstCommit);
  });
});
