import { reviewRead } from '../runtime/vnext/src/review-change-adapter';
import { installDistribution, upgradeDistribution } from '../scripts/vibe-governance-distribution';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';
import { semanticDraftDefinition } from '../runtime/vnext/src/prepare-task-adapter';
import { afterEach, describe, expect, test } from 'bun:test';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse, stringify } from 'yaml';
import {
  applyVNextRuntimeProposal,
  createArchiveProposal,
  createFindingQueueProposal,
  createInboxRecordProposal,
  createLessonRecordProposal,
  createLifecycleProposal,
  createProjectStatusProposal,
  createReviewResultProposal,
  createPrepareTaskClaimEvidenceMigrationProposal,
  createPrepareTaskReplanProposal,
  createPrepareTaskConfirmProposal,
  createPrepareTaskDraftProposal as createRawPrepareTaskDraftProposal,
  createPrepareTaskUpdateDraftProposal as createRawPrepareTaskUpdateDraftProposal,
  createPrepareTaskResumeReviewProposal,
  clearResumeReview,
  captureReviewTarget,
  assertEvidencePlan,
  readDraftDefinitionFromBody,
  createReviewChangeDelta,
  confirmDraft,
  completeReviewedStep,
  beginRepair,
  prepareDraft,
  preflightStep,
  retryStep,
  createStepRetryProposal,
  reviewContext,
  recordReviewResult as submitReviewResult,
  recordStepResult,
  replan,
  resolveExternalProposalFile,
  evaluateMutationScope,
  parseMutationScope,
  createTaskStateProposal,
  createStepPreflightProposal,
  createReviewCycleZero,
  GovernanceTransactionKernel,
  previewCloseTask,
  readCanonicalCurrentTask,
  readCanonicalTaskBasis,
  readDurableLessonRecords,
  readLessonMarkers,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type ArchiveDelta,
  type ClosureEvidence,
  type ClaimEvidenceDisposition,
  type ClaimEvidenceRecord,
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
  type TaskBasis,
  type ProjectStatusDelta,
  type PrepareTaskSemanticDraft,
} from '../scripts/vnext-runtime';
import { validateCurrentTaskStatusTuple as validatePureVNextStatusTuple } from '../runtime/vnext/src/task-identity';

// Existing adapter lifecycle fixtures provide explicit caller assessment; S3
// negative cases invoke submitReviewResult directly to test missing dimensions.
function recordReviewResult(root: string, input: any, options = {}) {
  return submitReviewResult(root, {
    ...input,
    test_assessment: input.test_assessment ?? {
      applicable: true, reason: 'Runtime contract regression fixture', evidence_refs: input.evidence_refs,
      necessity: 'Protect the admitted transaction and evidence contract',
      oracle: 'Expected states are explicit contract outcomes, not production-derived expectations',
      boundary: 'Isolated filesystem exercises Runtime; it does not certify external business execution',
      reuse: 'Reuse the existing lifecycle fixture and claim mappings',
      applicability: 'Review the current recorded manifest and declared evidence versions',
    },
  }, options);
}

const ROOT = path.resolve(import.meta.dir, '..');
const temporaryRoots: string[] = [];

function makeRuntimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    business_evidence_version: 1,
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
    pending_review_result: null,
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
    ...(state.claim_evidence?.filter(claim => claim.claim_kind === 'acceptance').map(claim => `- [ ] ${claim.requirement ?? 'original acceptance'}`) ?? ['- [ ] original acceptance']),
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
    '### Test Strategy',
    '- mode: flexible',
    '- source: inferred-default',
    '- source_ref: prepare-task-default',
    '- task_classification: contract-clear-behavior',
    '- rationale: No explicit ordering requirement in this fixture.',
    '',
    '### Persistent Tests',
    '- none',
    '',
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
    [
      'schema_version: 1',
      '',
      'project:',
      '  name: runtime-fixture',
      '  type: test',
      '',
      'paths:',
      '  workflow_home: docs/workflow',
      '',
      'boundaries:',
      '  non_executable_change_paths:',
      '    - README.md',
      '    - docs/product/**',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'evidence-report.txt'), 'Caller-reported Runtime fixture.');
  if (state.claim_evidence?.length && state.claim_evidence.every(claim => claim.requirement)) state.evidence_plan_revision = assertEvidencePlan(readDraftDefinitionFromBody(makeBody(state)), state.claim_evidence);
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

function completeClaimEvidence(): ClaimEvidenceRecord[] {
  const plan = evidencePlanFixture('original acceptance');
  plan[0]!.slots[0]!.disposition = 'newly-executed';
  return completeFixtureClaims(plan);
}

function completeFixtureClaims(records: ClaimEvidenceRecord[]): ClaimEvidenceRecord[] {
  const result = records.map(record => ({ ...record, requirement: record.requirement ?? 'original acceptance', source_ref: 'test:original-request', slots: record.slots.map(slot => ({ ...evidencePlanFixture('original acceptance')[0]!.slots[0]!, ...slot, check: { ...evidencePlanFixture('original acceptance')[0]!.slots[0]!.check!, check_id: `${record.claim_id}-${slot.slot_id}`, subject_paths: ['fixture-subject.txt'] }, evidence_refs: ['evidence-report.txt'] })) }));
  const definition = readDraftDefinitionFromBody(makeBody(makeRuntimeState({ claim_evidence: result })));
  const revision = assertEvidencePlan(definition, result);
  for (const record of result) for (const slot of record.slots) slot.report = { result_id: `result-${slot.check.check_id}`, status: 'passed', evidence_plan_revision: revision, subject_revision: captureReviewTarget(ROOT, ['fixture-subject.txt']).revision, actual_method: 'execution', environment: 'isolated Runtime fixture', assurance: 'caller-reported' };
  return result;
}

function claimEvidenceFixture(overrides: {
  location?: ClaimEvidenceDisposition;
  staticInspection?: ClaimEvidenceDisposition;
} = {}): ClaimEvidenceRecord[] {
  const locationDisposition = overrides.location ?? 'newly-executed';
  const staticDisposition = overrides.staticInspection ?? 'reused';
  return completeFixtureClaims([
    {
      claim_id: 'A4',
      claim_kind: 'acceptance',
      slots: [
        {
          slot_id: 'missing-title',
          minimum_type: 'focused-test',
          disposition: 'newly-executed',
          evidence_refs: ['test:evidence:a4-missing-title'],
        },
        {
          slot_id: 'missing-location',
          minimum_type: 'focused-test',
          disposition: locationDisposition,
          evidence_refs: locationDisposition === 'missing' || locationDisposition === 'deferred' || locationDisposition === 'blocked'
            ? []
            : ['test:evidence:a4-missing-location'],
        },
      ],
    },
    {
      claim_id: 'I1',
      claim_kind: 'invariant',
      slots: [
        {
          slot_id: 'focused-db-test',
          minimum_type: 'focused-test',
          disposition: 'newly-executed',
          evidence_refs: ['test:evidence:i1-focused-db'],
        },
        {
          slot_id: 'static-sqlite-check',
          minimum_type: 'static-inspection',
          disposition: staticDisposition,
          evidence_refs: staticDisposition === 'missing' || staticDisposition === 'deferred' || staticDisposition === 'blocked'
            ? []
            : ['test:evidence:i1-static-sqlite-check'],
        },
      ],
    },
  ]);
}

function completedCurrentClaims(root: string): ClaimEvidenceRecord[] {
  const current = readCanonicalCurrentTask(root);
  return structuredClone(current.runtimeState.claim_evidence ?? []).map(claim => ({ ...claim, slots: claim.slots.map(slot => ({ ...slot, disposition: 'newly-executed', evidence_refs: ['evidence-report.txt'], report: { result_id: `result-${slot.check!.check_id}`, status: slot.check!.expected_result, evidence_plan_revision: current.runtimeState.evidence_plan_revision!, subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision, actual_method: slot.check!.method, environment: 'isolated Runtime fixture', assurance: 'caller-reported' } })) }));
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

function claimEvidenceMigrationProposal(root: string, claimEvidence = completeClaimEvidence(), idempotencyKey = 'legacy-claim-evidence-migration'): RuntimeProposal {
  return createPrepareTaskClaimEvidenceMigrationProposal(readCanonicalCurrentTask(root), {
    claim_evidence: claimEvidence,
    evidence_refs: ['test:evidence:claim-evidence-migration'],
    idempotency_key: idempotencyKey,
    authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
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
    implementation_steps: [
      '- step-2: implement the replacement',
      '  - purpose: implement the replacement',
      '  - mutation_scope: runtime/**',
      '  - required_evidence: test:evidence:replacement',
      '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
    ].join('\n'),
    regression_checks: [
      '### Test Strategy',
      '',
      '- mode: flexible',
      '- source: inferred-default',
      '- source_ref: prepare-task-default',
      '- task_classification: exploratory-or-infrastructure',
      '- rationale: The replacement fixture exercises Runtime infrastructure.',
      '',
      '### Validation Plan',
      '',
      '- [ ] run the replacement regression suite',
      '',
      '### Persistent Tests',
      '',
      '- none',
    ].join('\n'),
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
      '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
    ].join('\n'),
    regression_checks: [
      '### Test Strategy',
      '',
      '- mode: flexible',
      '- source: inferred-default',
      '- source_ref: prepare-task-default',
      '- task_classification: exploratory-or-infrastructure',
      '- rationale: The draft fixture exercises Runtime infrastructure.',
      '',
      '### Validation Plan',
      '',
      '- [ ] run the focused regression suite',
      '',
      '### Persistent Tests',
      '',
      '- none',
    ].join('\n'),
    rollback_points: '- restore the prior canonical task document if validation fails',
    design_constraints: null,
    post_release_validation: null,
    propagation_governance: null,
    ...overrides,
  };
}

function taskBasisFixture(label = 'the requested task behavior'): TaskBasis {
  return {
    original_request: {
      source: 'test:original-request',
      verbatim: label,
    },
    user_decisions: [],
  };
}

function freshDraftFixtureClaims(definition: ReplanReplacementDefinition, claims: ClaimEvidenceRecord[] | undefined) {
  if (!claims) return undefined;
  const acceptance = definition.acceptance.replace(/^- \[ \] /gm, '').trim();
  const first = /- ([^:]+):/.exec(definition.implementation_steps)?.[1] ?? 'step-1';
  return claims.map(claim => ({ ...claim, requirement: acceptance, slots: claim.slots.map(slot => ({ ...slot, due_step_id: first, disposition: 'missing' as const, evidence_refs: [], report: null })) }));
}

function createPrepareTaskDraftProposal(
  current: Parameters<typeof createRawPrepareTaskDraftProposal>[0],
  input: Omit<Parameters<typeof createRawPrepareTaskDraftProposal>[1], 'task_basis'> & { task_basis?: TaskBasis },
): RuntimeProposal {
  return createRawPrepareTaskDraftProposal(current, {
    task_basis: input.task_basis ?? taskBasisFixture(),
    ...input,
    ...(input.claim_evidence?.some(claim => claim.slots.some(slot => slot.report)) ? { claim_evidence: freshDraftFixtureClaims(input.draft_definition, input.claim_evidence) } : {}),
  });
}

function createPrepareTaskUpdateDraftProposal(
  current: Parameters<typeof createRawPrepareTaskUpdateDraftProposal>[0],
  input: Omit<Parameters<typeof createRawPrepareTaskUpdateDraftProposal>[1], 'task_basis'> & { task_basis?: TaskBasis },
): RuntimeProposal {
  return createRawPrepareTaskUpdateDraftProposal(current, {
    task_basis: input.task_basis ?? taskBasisFixture(),
    ...input,
    ...(input.claim_evidence?.some(claim => claim.slots.some(slot => slot.report)) ? { claim_evidence: freshDraftFixtureClaims(input.draft_definition, input.claim_evidence) } : {}),
  });
}

function evidencePlanFixture(requirement: string, step = 'step-1'): ClaimEvidenceRecord[] {
  return [{ claim_id: 'A1', claim_kind: 'acceptance', requirement, source_ref: 'test:original-request', slots: [{ slot_id: 'a1', minimum_type: 'focused-test', disposition: 'missing', evidence_refs: [], due_step_id: step, applicability: 'current', check: { check_id: 'K1', method: 'execution', entry: 'bun test test/vnext-runtime.test.ts', expected_observation: requirement, required_boundaries: ['Runtime transaction'], allowed_substitutes: ['isolated filesystem fixture'], subject_paths: ['src/login.ts'], expected_result: 'passed' }, report: null }] }];
}

function reportFixture(root: string, claimId = 'A1', slotId = 'a1', status = 'passed') {
  const current = readCanonicalCurrentTask(root);
  const slot = current.runtimeState.claim_evidence!.find(claim => claim.claim_id === claimId)!.slots.find(slot => slot.slot_id === slotId)!;
  fs.writeFileSync(path.join(root, 'evidence-report.txt'), 'Caller-reported isolated fixture result.');
  return { claim_id: claimId, slot_id: slotId, check_id: slot.check!.check_id, minimum_type: slot.minimum_type, disposition: 'newly-executed', evidence_refs: ['evidence-report.txt'], report: { result_id: `result-${slot.check!.check_id}`, status, evidence_plan_revision: current.runtimeState.evidence_plan_revision!, subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision, actual_method: slot.check!.method, environment: 'isolated test fixture', assurance: 'caller-reported' } };
}

function semanticDraft(overrides: Partial<PrepareTaskSemanticDraft> = {}): PrepareTaskSemanticDraft {
  return {
    task_basis: taskBasisFixture('Add the prepare-task Runtime adapter'),
    goal: 'Add the prepare-task Runtime adapter',
    claim_evidence: evidencePlanFixture('The semantic adapter persists and reads back a canonical draft', overrides.implementation_steps?.at(-1)?.id ?? 'step-2'),
    out_of_scope: ['Do not refactor unrelated Runtime handlers'],
    design_decisions: {
      decided: ['Keep persistent tests in existing scope and regression sections'],
      unresolved: [],
    },
    mutation_scope: {
      allowed: [
        'runtime/vnext/src/prepare-task-adapter.ts',
        'test/vnext-runtime.test.ts',
      ],
      conditional: [],
      forbidden: ['.git/**'],
    },
    test_strategy: {
      mode: 'flexible',
      source: 'inferred-default',
      source_ref: 'prepare-task-default',
      task_classification: 'contract-clear-behavior',
      rationale: 'The adapter contract is explicit, so its persistent regression is planned before implementation.',
    },
    implementation_steps: [{
      id: 'step-1',
      description: 'Author the persistent adapter regression before implementation',
      mutation_scope: ['test/vnext-runtime.test.ts'],
      commands: [],
      validation: ['The test assertions encode the adapter contract before product implementation'],
    }, {
      id: 'step-2',
      description: 'Implement and verify the semantic adapter',
      mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts'],
      commands: [{
        command: 'bun test test/vnext-runtime.test.ts',
        expected_repo_writes: 'none',
      }],
      validation: ['bun test test/vnext-runtime.test.ts passes'],
    }],
    validation_plan: ['Run the focused vNext Runtime test suite'],
    persistent_tests: [{
      path: 'test/vnext-runtime.test.ts',
      proves: ['A1'], owner: 'workflow-system', owner_source: 'task-basis', source_ref: 'test:original-request', basis: 'regression', existing_evidence_insufficiency: 'Existing checks do not protect the adapter', assertion_boundary: 'Runtime confirmation and execution contracts', failure_disposition: 'block',
    }],
    ...overrides,
  };
}

function singleStepSemanticDraft(overrides: Partial<PrepareTaskSemanticDraft> = {}): PrepareTaskSemanticDraft {
  return semanticDraft({
    mutation_scope: {
      allowed: ['runtime/vnext/src/prepare-task-adapter.ts'],
      conditional: [],
      forbidden: ['.git/**'],
    },
    test_strategy: {
      mode: 'flexible',
      source: 'inferred-default',
      source_ref: 'prepare-task-default',
      task_classification: 'exploratory-or-infrastructure',
      rationale: 'The fixture exercises Runtime infrastructure before stable persistent assertions are introduced.',
    },
    implementation_steps: [{
      id: 'step-1',
      description: 'Implement and verify the semantic adapter fixture',
      mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts'],
      commands: [{
        command: 'bun test test/vnext-runtime.test.ts',
        expected_repo_writes: 'none',
      }],
      validation: ['bun test test/vnext-runtime.test.ts passes'],
    }],
    persistent_tests: 'none',
    ...overrides,
  });
}

function notApplicableSemanticDraft(overrides: Partial<PrepareTaskSemanticDraft> = {}): PrepareTaskSemanticDraft {
  return semanticDraft({
    mutation_scope: {
      allowed: ['README.md'],
      conditional: [],
      forbidden: ['.git/**'],
    },
    test_strategy: {
      mode: 'not-applicable',
      source: 'project-policy',
      source_ref: '.workflow-system/PROJECT_PROFILE.yaml',
      task_classification: 'non-executable-change',
      rationale: 'The project-owned path classification proves that this task cannot change executable behavior.',
    },
    implementation_steps: [{
      id: 'update-docs',
      description: 'Update the non-executable documentation',
      mutation_scope: ['README.md'],
      commands: [],
      validation: ['Review the rendered documentation content'],
    }],
    persistent_tests: 'none',
    ...overrides,
  });
}

function archivedBaselineRoot(): string {
  return makeRoot(makeRuntimeState({
    task_id: '000',
    task_slug: 'bootstrap-baseline',
    workflow_status: 'closed',
    lifecycle_state: 'archived',
    active_step_status: 'completed',
  }));
}

function confirmedSemanticRoot(input: PrepareTaskSemanticDraft = singleStepSemanticDraft()): string {
  const root = archivedBaselineRoot();
  const prepared = prepareDraft(root, input);
  if (!prepared.confirmation_receipt) throw new Error('test setup did not receive a draft confirmation receipt');
  const confirmed = confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt });
  if (confirmed.status !== 'success') throw new Error(`test setup could not confirm draft: ${confirmed.message}`);
  return root;
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
  overrides: { definition?: ReplanReplacementDefinition; active_step_id?: string; authority?: AuthorityEvidence[]; evidence_refs?: string[]; claim_evidence?: ClaimEvidenceRecord[] } = {},
): RuntimeProposal {
  const current = readCanonicalCurrentTask(root);
  const delta = action === 'commit-replan'
    ? {
      kind: 'task-state' as const,
      action,
      task_basis: taskBasisFixture('Replace the superseded task definition'),
      replacement_definition: overrides.definition ?? replacementDefinition(),
      active_step_id: overrides.active_step_id ?? 'step-2',
      evidence_refs: overrides.evidence_refs ?? ['test:evidence:replan'],
      ...(overrides.claim_evidence === undefined ? {} : { claim_evidence: freshDraftFixtureClaims(overrides.definition ?? replacementDefinition(), overrides.claim_evidence) }),
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
      'contract-candidate-commit',
      'decision-record-transaction',
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
    const root = makeRoot(makeRuntimeState({ claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const proposal = taskProposal(root, { claim_evidence: completedCurrentClaims(root) });
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

  test('requires every planned claim-evidence slot for task-complete and rejects aggregate success as a substitute', () => {
    const cases: Array<{ name: string; claimEvidence: ClaimEvidenceRecord[]; expected: 'success' | 'blocked' }> = [
      { name: 'all planned evidence complete', claimEvidence: claimEvidenceFixture(), expected: 'success' },
      { name: 'missing acceptance slot', claimEvidence: claimEvidenceFixture({ location: 'missing' }), expected: 'blocked' },
      { name: 'focused test without static inspection', claimEvidence: claimEvidenceFixture({ staticInspection: 'missing' }), expected: 'blocked' },
      { name: 'deferred evidence', claimEvidence: claimEvidenceFixture({ location: 'deferred' }), expected: 'blocked' },
      { name: 'blocked evidence', claimEvidence: claimEvidenceFixture({ staticInspection: 'blocked' }), expected: 'blocked' },
    ];

    for (const [index, testCase] of cases.entries()) {
      const root = makeRoot(makeRuntimeState({
        claim_evidence_required: true,
        claim_evidence: claimEvidenceFixture(),
      }));
      const result = applyVNextRuntimeProposal(root, taskProposal(root, {
        idempotency_key: `claim-evidence-completion-${index}`,
        note: 'npm test passed',
        evidence_refs: ['npm:test:aggregate'],
        claim_evidence: testCase.claimEvidence,
      }));
      expect(result.status, testCase.name).toBe(testCase.expected);
      if (testCase.expected === 'blocked') {
        expect(result.code, testCase.name).toBe('CLAIM_EVIDENCE_INCOMPLETE');
        expect(readCanonicalCurrentTask(root).runtimeState.active_step_status, testCase.name).toBe('ready');
      } else {
        expect(result.advancement, testCase.name).toMatchObject({ outcome: 'task-complete' });
        expect(readCanonicalCurrentTask(root).runtimeState.claim_evidence, testCase.name).toEqual(testCase.claimEvidence);
      }
    }
  });

  test('does not let step-progress replace or omit the durable claim-evidence plan', () => {
    const planned = claimEvidenceFixture();
    const root = makeRoot(makeRuntimeState({
      claim_evidence_required: true,
      claim_evidence: planned,
    }));
    const current = readCanonicalCurrentTask(root);
    const omitted = createTaskStateProposal(current, {
      mode: 'default',
      status: 'completed',
      evidence_refs: ['test:evidence:aggregate-only'],
      note: 'npm test passed',
      idempotency_key: 'claim-evidence-plan-omitted',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    const omittedResult = applyVNextRuntimeProposal(root, omitted);
    expect(omittedResult.status).toBe('blocked');
    expect(omittedResult.code).toBe('CLAIM_EVIDENCE_REQUIRED');

    const narrowed = createTaskStateProposal(current, {
      mode: 'default',
      status: 'completed',
      evidence_refs: ['test:evidence:aggregate-only'],
      note: 'npm test passed',
      idempotency_key: 'claim-evidence-plan-narrowed',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      claim_evidence: [planned[0]!],
    });
    const narrowedResult = applyVNextRuntimeProposal(root, narrowed);
    expect(narrowedResult.status).toBe('blocked');
    expect(narrowedResult.code).toBe('CLAIM_EVIDENCE_PLAN_CONFLICT');
    expect(readCanonicalCurrentTask(root).runtimeState.claim_evidence).toEqual(planned);
  });

  test('freezes a non-empty acceptance-bearing plan before confirmation and blocks completion-time plan invention', () => {
    const bootstrapRoot = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const bootstrap = readCanonicalCurrentTask(bootstrapRoot);
    const draftInput = {
      action: 'create-draft' as const,
      task_id: '001',
      task_slug: 'plan-freeze-task',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Plan freeze task',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:plan-freeze'],
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    };
    const missingPlan = createPrepareTaskDraftProposal(bootstrap, {
      ...draftInput,
      idempotency_key: 'plan-freeze-missing',
    });
    const missingResult = applyVNextRuntimeProposal(bootstrapRoot, missingPlan);
    expect(missingResult.status).toBe('blocked');
    expect(missingResult.code).toBe('CLAIM_EVIDENCE_REQUIRED');

    const emptyPlan = createPrepareTaskDraftProposal(bootstrap, {
      ...draftInput,
      claim_evidence: [],
      idempotency_key: 'plan-freeze-empty',
    });
    const emptyResult = applyVNextRuntimeProposal(bootstrapRoot, emptyPlan);
    expect(emptyResult.status).toBe('blocked');
    expect(emptyResult.code).toBe('CLAIM_EVIDENCE_REQUIRED');
    expect(readCanonicalCurrentTask(bootstrapRoot).runtimeState.task_id).toBe('000');

    const updateRoot = makeRoot(makeRuntimeState({
      task_id: '001',
      task_slug: 'plan-freeze-task',
      workflow_status: 'draft',
      lifecycle_state: 'active',
      claim_evidence_required: true,
      claim_evidence: completeClaimEvidence(),
    }));
    const draft = readCanonicalCurrentTask(updateRoot);
    const missingUpdatePlan = createPrepareTaskUpdateDraftProposal(draft, {
      task_id: '001',
      task_slug: 'plan-freeze-task',
      document_id: draft.sourceTuple.document_id,
      task_title: 'Runtime fixture',
      draft_definition: draftDefinition(),
      active_step_id: 'step-1',
      evidence_refs: ['test:evidence:plan-freeze-update'],
      idempotency_key: 'plan-freeze-update-missing',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    const updateResult = applyVNextRuntimeProposal(updateRoot, missingUpdatePlan);
    expect(updateResult.status).toBe('blocked');
    expect(updateResult.code).toBe('CLAIM_EVIDENCE_REQUIRED');

    const emptyConfirmRoot = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const emptyConfirmBootstrap = readCanonicalCurrentTask(emptyConfirmRoot);
    const emptyConfirmCreated = createPrepareTaskDraftProposal(emptyConfirmBootstrap, {
      ...draftInput,
      idempotency_key: 'plan-freeze-confirm-seed',
      claim_evidence: completeClaimEvidence(),
    });
    expect(applyVNextRuntimeProposal(emptyConfirmRoot, emptyConfirmCreated).status).toBe('success');
    const persistedConfirmDraft = readCanonicalCurrentTask(emptyConfirmRoot);
    fs.writeFileSync(persistedConfirmDraft.filePath, `---\n${stringify({
      ...persistedConfirmDraft.frontmatter,
      runtime_state: {
        ...persistedConfirmDraft.runtimeState,
        claim_evidence: [],
      },
    }).trimEnd()}\n---\n${persistedConfirmDraft.body}`, 'utf8');
    const emptyConfirmDraft = readCanonicalCurrentTask(emptyConfirmRoot);
    const emptyConfirm = createPrepareTaskConfirmProposal(emptyConfirmDraft, {
      task_id: '001',
      task_slug: 'plan-freeze-task',
      document_id: emptyConfirmDraft.sourceTuple.document_id,
      draft_revision: emptyConfirmDraft.sourceTuple.revision,
      evidence_refs: ['test:evidence:plan-freeze-confirm'],
      idempotency_key: 'plan-freeze-confirm-empty',
      authority_evidence: confirmationAuthority(emptyConfirmDraft),
    });
    const emptyConfirmResult = applyVNextRuntimeProposal(emptyConfirmRoot, emptyConfirm);
    expect(emptyConfirmResult.status).toBe('blocked');
    expect(emptyConfirmResult.code).toBe('CLAIM_EVIDENCE_REQUIRED');

    const replanRoot = makeRoot();
    const replanCurrent = readCanonicalCurrentTask(replanRoot);
    const supersede = createLifecycleProposal(replanCurrent, {
      mode: 'supersede',
      delta: supersedeDelta(),
      idempotency_key: 'plan-freeze-supersede',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(replanRoot, supersede).status).toBe('success');
    const missingReplanPlan = applyVNextRuntimeProposal(
      replanRoot,
      replanProposal(replanRoot, 'commit-replan', 'plan-freeze-replan-missing'),
    );
    expect(missingReplanPlan.status).toBe('blocked');
    expect(missingReplanPlan.code).toBe('CLAIM_EVIDENCE_REQUIRED');

    const strictEmptyRoot = makeRoot(makeRuntimeState({
      claim_evidence_required: true,
      claim_evidence: [],
    }));
    const inventedPlanResult = applyVNextRuntimeProposal(strictEmptyRoot, taskProposal(strictEmptyRoot, {
      idempotency_key: 'plan-freeze-invented-at-completion',
      note: 'npm test passed',
      evidence_refs: ['npm:test:aggregate'],
      claim_evidence: completeClaimEvidence(),
    }));
    expect(inventedPlanResult.status).toBe('blocked');
    expect(inventedPlanResult.code).toBe('CLAIM_EVIDENCE_REQUIRED');
    expect(readCanonicalCurrentTask(strictEmptyRoot).runtimeState.active_step_status).toBe('ready');
  });

  test('blocks strict completion without acceptance evidence and keeps legacy completion read-only', () => {
    const invariantOnly: ClaimEvidenceRecord[] = [{
      claim_id: 'I1',
      claim_kind: 'invariant',
      slots: [{
        slot_id: 'i1',
        minimum_type: 'static-inspection',
        disposition: 'reused',
        evidence_refs: ['test:evidence:invariant-only'],
      }],
    }];
    const noAcceptanceRoot = makeRoot(makeRuntimeState({
      claim_evidence_required: true,
      claim_evidence: invariantOnly,
    }));
    const noAcceptanceResult = applyVNextRuntimeProposal(noAcceptanceRoot, taskProposal(noAcceptanceRoot, {
      idempotency_key: 'claim-evidence-no-acceptance',
      claim_evidence: invariantOnly,
    }));
    expect(noAcceptanceResult.status).toBe('blocked');
    expect(noAcceptanceResult.code).toBe('CLAIM_EVIDENCE_ACCEPTANCE_REQUIRED');

    const legacyRoot = makeRoot();
    const legacyCompletion = applyVNextRuntimeProposal(legacyRoot, taskProposal(legacyRoot, {
      idempotency_key: 'legacy-task-complete',
      note: 'npm test passed',
      evidence_refs: ['npm:test:aggregate'],
    }));
    expect(legacyCompletion.status).toBe('blocked');
    expect(legacyCompletion.code).toBe('CLAIM_EVIDENCE_REQUIRED');

    const legacyCloseRoot = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));
    const legacyPreview = previewCloseTask(legacyCloseRoot, archiveDelta());
    expect(legacyPreview.status).toBe('blocked');
    expect(legacyPreview.closure_eligibility.blockers.join(' ')).toContain('structured claim-bound evidence migration');
    const legacyClose = applyVNextRuntimeProposal(legacyCloseRoot, archiveProposal(legacyCloseRoot, archiveDelta(), 'legacy-close-task'));
    expect(legacyClose.status).toBe('blocked');
    expect(legacyClose.code).toBe('CLOSURE_NOT_ELIGIBLE');
    expect(fs.existsSync(path.join(legacyCloseRoot, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);

    const legacyReadable = readCanonicalCurrentTask(makeRoot());
    expect(legacyReadable.runtimeState.claim_evidence_required).toBe(false);
    expect(legacyReadable.runtimeState.claim_evidence).toEqual([]);
  });

  test('provides a canonical claim-evidence migration for legacy active tasks without changing task semantics', () => {
    const root = makeRoot();
    const before = readCanonicalCurrentTask(root);
    const plan = completeClaimEvidence();
    const migration = claimEvidenceMigrationProposal(root, plan, 'legacy-claim-evidence-migration-active');

    const result = applyVNextRuntimeProposal(root, migration);

    expect(result.status).toBe('success');
    expect(result.committed).toBe(true);
    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.workflow_status).toBe('active');
    expect(after.runtimeState.lifecycle_state).toBe('active');
    expect(after.runtimeState.task_id).toBe(before.runtimeState.task_id);
    expect(after.runtimeState.task_slug).toBe(before.runtimeState.task_slug);
    expect(after.sourceTuple.document_id).toBe(before.sourceTuple.document_id);
    expect(after.runtimeState.active_step_id).toBe(before.runtimeState.active_step_id);
    expect(after.runtimeState.active_step_status).toBe(before.runtimeState.active_step_status);
    expect(after.runtimeState.claim_evidence_required).toBe(true);
    expect(after.runtimeState.claim_evidence).toEqual(plan);
    expect(after.body).toContain('original acceptance');
    expect(after.body).toContain('original implementation plan');
    expect(after.body).toContain('action: migrate-claim-evidence');
    expect(after.runtimeState.execution_log).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'migrate-claim-evidence',
        from_workflow_status: 'active',
        from_lifecycle_state: 'active',
        to_workflow_status: 'active',
        to_lifecycle_state: 'active',
        claim_evidence_digest: expect.any(String),
      }),
    ]));

    const migratedBytes = fs.readFileSync(after.filePath, 'utf8');
    const replay = applyVNextRuntimeProposal(root, migration);
    expect(replay.status).toBe('no-op');
    expect(replay.read_back_verified).toBe(true);
    expect(fs.readFileSync(after.filePath, 'utf8')).toBe(migratedBytes);

    const shapeMutation = applyVNextRuntimeProposal(root, taskProposal(root, {
      idempotency_key: 'legacy-migration-plan-shape-mutation',
      claim_evidence: [
        ...plan,
        {
          claim_id: 'I1',
          claim_kind: 'invariant',
          slots: [{
            slot_id: 'i1',
            minimum_type: 'static-inspection',
            disposition: 'reused',
            evidence_refs: ['test:evidence:shape-mutation'],
          }],
        },
      ],
    }));
    expect(shapeMutation.status).toBe('blocked');
    expect(shapeMutation.code).toBe('CLAIM_EVIDENCE_STALE');
  });

  test('claim-only migration cannot silently upgrade legacy completion semantics', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed' }));

    expect(applyVNextRuntimeProposal(root, claimEvidenceMigrationProposal(root, completeClaimEvidence(), 'legacy-claim-evidence-migration-completed')).status).toBe('success');
    const preview = previewCloseTask(root, archiveDelta());
    expect(preview.closure_eligibility.eligible).toBe(false);

    const close = applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'legacy-migrated-close'));
    expect(close.status).toBe('blocked');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('active');
    expect(readCanonicalCurrentTask(root).runtimeState.lifecycle_state).toBe('active');
  });

  test('preserves a frozen plan identity while allowing only slot fulfillment updates', () => {
    const planned = claimEvidenceFixture();
    const root = makeRoot(makeRuntimeState({
      claim_evidence_required: true,
      claim_evidence: planned,
    }));
    const changedDisposition = planned.map(record => ({
      ...record,
      slots: record.slots.map(slot => ({
        ...slot,
        disposition: 'existing' as const,
        evidence_refs: [...slot.evidence_refs],
      })),
    }));
    const result = applyVNextRuntimeProposal(root, taskProposal(root, {
      idempotency_key: 'claim-evidence-slot-fulfillment',
      claim_evidence: changedDisposition,
    }));
    expect(result.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.claim_evidence).toEqual(changedDisposition);
  });

  test('close-task derives validation truth from durable claim evidence and blocks incomplete state', () => {
    const root = makeRoot(makeRuntimeState({
      active_step_status: 'completed',
      claim_evidence_required: true,
      claim_evidence: claimEvidenceFixture({ staticInspection: 'missing' }),
    }));
    const preview = previewCloseTask(root, archiveDelta());
    expect(preview.closure_eligibility.eligible).toBe(false);
    expect(preview.closure_eligibility.blockers.join(' ')).toContain('durable claim-bound validation evidence is incomplete');

    const result = applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'claim-evidence-incomplete-close'));
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('CLOSURE_NOT_ELIGIBLE');
    expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
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
    const root = makeRoot(makeRuntimeState({ task_id: '939', task_slug: 'fixture-capture-replay-advance', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const proposal = captureProposal(root);
    const firstResult = applyVNextRuntimeProposal(root, proposal);
    expect(firstResult.status).toBe('success');
    expect(firstResult.committed).toBe(true);

    const recordPath = path.join(root, ...proposal.semantic_delta.target_path.split('/'));
    const recordBeforeAdvance = fs.readFileSync(recordPath, 'utf8');
    const inboxBeforeAdvance = inboxFiles(root);
    const taskMutation = applyVNextRuntimeProposal(root, taskProposal(root, {
      idempotency_key: 'fixture-capture-replay-advance-task',
      claim_evidence: completedCurrentClaims(root),
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
    const collisionRoot = makeRoot(makeRuntimeState({ task_id: '936', task_slug: 'fixture-collision', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
      claim_evidence: completeClaimEvidence(),
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
    const root = makeRoot(makeRuntimeState({ task_id: '940', task_slug: 'fixture-idempotency-collision', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
      claim_evidence: completedCurrentClaims(root),
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
    const staleRoot = makeRoot(makeRuntimeState({ task_id: '937', task_slug: 'fixture-stale-capture', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const staleProposal = captureProposal(staleRoot);
    const taskMutation = applyVNextRuntimeProposal(staleRoot, taskProposal(staleRoot, {
      idempotency_key: 'fixture-stale-source-mutation',
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completedCurrentClaims(root),
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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
    const root = makeRoot(makeRuntimeState({ claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const current = readCanonicalCurrentTask(root);
    const proposal = taskProposal(root, { claim_evidence: completedCurrentClaims(root) });
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
    const root = makeRoot(makeRuntimeState({ claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const proposal = taskProposal(root, { claim_evidence: completedCurrentClaims(root) });
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
    const root = makeRoot(makeRuntimeState({ claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
      authority_evidence: [
        {
          kind: 'authorized-caller',
          source: resumedCurrent.relativePath,
          subject: resumedCurrent.runtimeState.task_id,
          task_id: resumedCurrent.runtimeState.task_id,
          document_id: resumedCurrent.sourceTuple.document_id,
          source_revision: resumedCurrent.sourceTuple.revision,
        },
        ...evidence('active-task-owner', 'resume-review', 'evidence-admission'),
      ],
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
      authority_evidence: [
        {
          kind: 'authorized-caller',
          source: resumed.relativePath,
          subject: resumed.runtimeState.task_id,
          task_id: resumed.runtimeState.task_id,
          document_id: resumed.sourceTuple.document_id,
          source_revision: resumed.sourceTuple.revision,
        },
        ...evidence('active-task-owner', 'resume-review', 'evidence-admission'),
      ],
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
      claim_evidence: completeClaimEvidence(),
    }), { now: () => '2026-08-31T01:00:00.000Z' });
    expect(committed.status).toBe('success');
    expect(committed.governed_mutation_count).toBe(2);

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
    expect(applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'commit-generation-replan', {
      claim_evidence: completeClaimEvidence(),
    })).status).toBe('success');

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
    const proposal = replanProposal(root, 'commit-replan', 'replan-read-back-failure', {
      claim_evidence: completeClaimEvidence(),
    });
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
    expect(fs.existsSync(path.join(root, 'docs', 'workflow', 'task-basis', 'TASK_BASIS-010.md'))).toBe(false);
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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

    const ambiguousRoot = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
      const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence(), ...tuple }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
      const result = applyVNextRuntimeProposal(root, archiveProposal(root, delta, `archive-illegal-gate-${index}`));
      expect(result.status).toBe('blocked');
      expect(result.code).toBe('CLOSURE_NOT_ELIGIBLE');
      expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
    }
    expect(() => archiveProposal(makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() })), archiveDelta({
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const proposal = archiveProposal(root, archiveDelta(), 'archive-stale-source');
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { status: 'completed', idempotency_key: 'step-drifts-close-source', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');
    const currentBefore = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
    const stale = applyVNextRuntimeProposal(root, proposal);
    expect(stale.status).toBe('conflict');
    expect(stale.code).toBe('SOURCE_TUPLE_MISMATCH');
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(currentBefore);
    expect(fs.existsSync(path.join(root, 'TASKS', 'TASK-010-runtime-fixture.md'))).toBe(false);
  });

  test('archive replay is a no-op only for the exact receipt and fails closed on missing, drifted, or mismatched provenance', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
          '- step-2: second step without metadata',
        ].join('\n'),
      }),
      active_step_id: 'step-1',
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
          '- step-2: second step',
          '  - purpose: second step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:2',
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
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
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
          '- step-2: second step',
          '  - purpose: second step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:2',
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
        ].join('\n'),
      }),
      active_step_id: 'step-1',
      claim_evidence: completeClaimEvidence(),
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
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
          '- step-2: second step',
          '  - purpose: second step purpose',
          '  - mutation_scope: scripts/**',
          '  - required_evidence: test:evidence:2',
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-2', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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
      claim_evidence: completeClaimEvidence(),
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-2', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-3', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-2', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');
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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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
      claim_evidence: completeClaimEvidence(),
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
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { idempotency_key: 'exec-1', claim_evidence: completedCurrentClaims(root) })).status).toBe('success');

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

  test('adapts semantic prepare content into a canonical draft and confirms its exact revision', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));

    const prepared = prepareDraft(root, semanticDraft());
    expect(prepared.status).toBe('success');
    expect(prepared.committed).toBe(true);
    expect(prepared.read_back_verified).toBe(true);
    expect(prepared.governed_mutation_count).toBe(2);
    expect(prepared.planned_writes).toEqual([
      'docs/workflow/CURRENT_TASK.md',
      'docs/workflow/task-basis/TASK_BASIS-001.md',
    ]);
    expect(prepared.confirmation_receipt).toMatchObject({
      kind: 'prepare-draft-confirmation/v1',
      task_id: '001',
    });

    let draft = readCanonicalCurrentTask(root);
    expect(draft.runtimeState).toMatchObject({
      task_id: '001',
      workflow_status: 'draft',
      lifecycle_state: 'active',
      active_step_id: 'step-1',
      active_step_status: 'ready',
      claim_evidence_required: true,
    });
    expect(draft.runtimeState.claim_evidence).toEqual(semanticDraft().claim_evidence);
    expect(draft.body).toContain('### Goal');
    expect(draft.body).toContain('### Out of scope');
    expect(draft.body).toContain('### Test Strategy');
    expect(draft.body).toContain('- mode: flexible');
    expect(draft.body).toContain('- source: inferred-default');
    expect(draft.body).toContain('- source_ref: prepare-task-default');
    expect(draft.body).toContain('- task_classification: contract-clear-behavior');
    expect(draft.body).toContain('### Persistent Tests');
    expect(draft.body).toContain('`test/vnext-runtime.test.ts`');
    expect(draft.body).toContain('- `test/vnext-runtime.test.ts`');
    expect(draft.body).toContain('planned_command: bun test test/vnext-runtime.test.ts');
    const initialBasis = readCanonicalTaskBasis(root, draft);
    expect(initialBasis.path).toBe('docs/workflow/task-basis/TASK_BASIS-001.md');
    expect(initialBasis.basis).toEqual(taskBasisFixture('Add the prepare-task Runtime adapter'));
    expect(draft.body).toContain(`- revision: \`${initialBasis.revision}\``);
    expect(initialBasis.content).not.toContain('draft_review_result');
    expect(prepared.confirmation_receipt?.draft_revision).toBe(draft.sourceTuple.revision);

    const firstReceipt = prepared.confirmation_receipt!;
    const firstDraftBytes = fs.readFileSync(draft.filePath, 'utf8');
    const repeatedPrepare = prepareDraft(root, semanticDraft());
    expect(repeatedPrepare.status).toBe('no-op');
    expect(repeatedPrepare.confirmation_receipt).toEqual(firstReceipt);
    expect(fs.readFileSync(draft.filePath, 'utf8')).toBe(firstDraftBytes);

    const scope = parseMutationScope(draft.body, draft.sourceTuple.revision);
    const scopeResult = evaluateMutationScope(scope, {
      changed_paths: ['test/vnext-runtime.test.ts', 'test/unlisted.test.ts'],
    });
    expect(scopeResult.status).toBe('blocked');
    expect(scopeResult.admitted_paths).toEqual(['test/vnext-runtime.test.ts']);
    expect(scopeResult.blocked_paths).toEqual(['test/unlisted.test.ts']);

    const firstDocumentId = draft.sourceTuple.document_id;
    const refinedInput = semanticDraft({
      task_basis: {
        ...taskBasisFixture('Add the prepare-task Runtime adapter'),
        user_decisions: [{
          source: 'test:user-decision-1',
          verbatim: 'Use the refined acceptance wording.',
        }],
      },
      claim_evidence: evidencePlanFixture('The refined semantic adapter persists and reads back a canonical draft', 'step-2').map(claim => ({ ...claim, claim_id: 'A2', slots: claim.slots.map(slot => ({ ...slot, check: { ...slot.check!, check_id: 'K2' } })) })),
      persistent_tests: semanticDraft().persistent_tests === 'none' ? 'none' : (semanticDraft().persistent_tests as any[]).map(test => ({ ...test, proves: ['A2'] })),
    });
    const refined = prepareDraft(root, refinedInput);
    expect(refined.status).toBe('success');
    draft = readCanonicalCurrentTask(root);
    expect(draft.runtimeState.task_id).toBe('001');
    expect(draft.sourceTuple.document_id).toBe(firstDocumentId);
    expect(draft.body).toContain('The refined semantic adapter persists');
    expect(readCanonicalTaskBasis(root, draft).basis).toEqual(refinedInput.task_basis);

    const refinedReceipt = refined.confirmation_receipt!;
    expect(refinedReceipt.draft_revision).toBe(draft.sourceTuple.revision);
    const refinedBytes = fs.readFileSync(draft.filePath, 'utf8');
    expect(() => confirmDraft(root, { confirmation_receipt: firstReceipt })).toThrow('DRAFT_REVISION_CONFLICT');
    expect(fs.readFileSync(draft.filePath, 'utf8')).toBe(refinedBytes);

    const repeatedRefinement = prepareDraft(root, refinedInput);
    expect(repeatedRefinement.status).toBe('no-op');
    expect(repeatedRefinement.confirmation_receipt).toEqual(refinedReceipt);
    expect(fs.readFileSync(draft.filePath, 'utf8')).toBe(refinedBytes);

    const draftRevision = draft.sourceTuple.revision;
    const confirmed = confirmDraft(root, { confirmation_receipt: refinedReceipt });
    expect(confirmed.status).toBe('success');
    expect(confirmed.previous_revision).toBe(draftRevision);
    const confirmedCurrent = readCanonicalCurrentTask(root);
    expect(confirmedCurrent.runtimeState.workflow_status).toBe('active');
    const confirmationAudit = confirmedCurrent.runtimeState.execution_log.find(item => 'action' in item && item.action === 'confirm-draft');
    expect(confirmationAudit && 'authority_evidence' in confirmationAudit ? confirmationAudit.authority_evidence : []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'authorized-caller',
        task_id: refinedReceipt.task_id,
        document_id: refinedReceipt.document_id,
        draft_revision: refinedReceipt.draft_revision,
      }),
    ]));
    expect(confirmationAudit && 'authority_evidence' in confirmationAudit
      ? confirmationAudit.authority_evidence.some(item => item.kind === 'user-confirmation')
      : true).toBe(false);

    const confirmedBytes = fs.readFileSync(draft.filePath, 'utf8');
    const repeatedConfirm = confirmDraft(root, { confirmation_receipt: refinedReceipt });
    expect(repeatedConfirm.status).toBe('no-op');
    expect(fs.readFileSync(draft.filePath, 'utf8')).toBe(confirmedBytes);
  });

  test('requires exact task-basis input and blocks confirmation when the linked basis drifts', () => {
    const missingRoot = archivedBaselineRoot();
    const { task_basis: _omitted, ...withoutBasis } = semanticDraft();
    const missingBefore = fs.readFileSync(readCanonicalCurrentTask(missingRoot).filePath, 'utf8');
    expect(() => prepareDraft(missingRoot, withoutBasis)).toThrow('PREPARE_ADAPTER_INPUT_INVALID');
    expect(fs.readFileSync(readCanonicalCurrentTask(missingRoot).filePath, 'utf8')).toBe(missingBefore);

    const root = archivedBaselineRoot();
    const exactBasis: TaskBasis = {
      original_request: {
        source: 'test:multiline-request',
        verbatim: 'First requirement.\n\n  Second requirement keeps indentation.',
      },
      user_decisions: [{ source: 'test:decision', verbatim: 'Keep this wording exactly.' }],
    };
    const prepared = prepareDraft(root, semanticDraft({ task_basis: exactBasis }));
    const draft = readCanonicalCurrentTask(root);
    const basis = readCanonicalTaskBasis(root, draft);
    expect(basis.basis).toEqual(exactBasis);
    fs.appendFileSync(basis.filePath, '\nexternal drift\n', 'utf8');
    expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt })).toMatchObject({
      status: 'blocked',
      code: 'TASK_BASIS_REVISION_CONFLICT',
      governed_mutation_count: 0,
    });
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('draft');
  });

  test('preflights the confirmed current step and blocks unlisted persistent tests', () => {
    const root = confirmedSemanticRoot(semanticDraft());
    const admitted = preflightStep(root, {
      candidate_paths: ['test/vnext-runtime.test.ts'],
    });
    expect(admitted.current_step).toMatchObject({
      id: 'step-1',
      commands: [],
      validation: ['The test assertions encode the adapter contract before product implementation'],
      test_strategy_mode: 'flexible',
      execution_phase: 'flexible',
      required_outcome: 'implemented',
      persistent_tests: ['test/vnext-runtime.test.ts'],
    });

    expect(() => preflightStep(root, {
      candidate_paths: ['test/unlisted.test.ts'],
    })).toThrow('EXECUTE_SCOPE_BLOCKED');

    const commandWriteRoot = confirmedSemanticRoot(singleStepSemanticDraft({
      mutation_scope: {
        allowed: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement and verify the semantic adapter',
        mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
        commands: [{
          command: 'bun test test/vnext-runtime.test.ts',
          expected_repo_writes: ['runtime/vnext/src/prepare-task-adapter.ts'],
        }],
        validation: ['bun test test/vnext-runtime.test.ts passes'],
      }],
    }));
    expect(() => preflightStep(commandWriteRoot, {
      candidate_paths: ['runtime/vnext/src/kernel.ts'],
    })).toThrow('COMMAND_FOOTPRINT_BLOCKED');
  });

  // S2 admission: protects distinct business obligations, current applicability,
  // and Runtime-owned prerequisite consumption through production adapters.
  test('S2 rule success cannot complete or close missing/failed flow; exact reports survive audit but not fixture changes', () => {
    const semantic = singleStepSemanticDraft();
    const requirement = 'A valid ticket can be saved and read by a fresh process';
    semantic.task_basis.original_request.verbatim = requirement;
    semantic.claim_evidence[0]!.requirement = requirement;
    semantic.mutation_scope.allowed.push('stored.json');
    semantic.implementation_steps[0]!.mutation_scope.push('stored.json');
    const ruleScript = 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync("fixture.json")); if(x.ticket!=="persisted") process.exit(1); fs.writeFileSync("stored.json",JSON.stringify(x));';
    const flowScript = 'const x=require("./stored.json"); if(x.ticket!=="persisted") process.exit(1);';
    const ruleCommand = `node -e ${JSON.stringify(ruleScript)}`;
    semantic.implementation_steps[0]!.commands = [{ command: ruleCommand, expected_repo_writes: ['stored.json'] }];
    semantic.implementation_steps[0]!.validation = ['Stored ticket satisfies the admitted schema'];
    const rule = semantic.claim_evidence[0]!.slots[0]!;
    rule.check!.entry = ruleCommand;
    rule.check!.expected_observation = requirement;
    rule.check!.subject_paths = ['fixture.json'];
    const flow = structuredClone(rule);
    flow.slot_id = 'flow'; flow.minimum_type = 'integration-smoke'; flow.check!.check_id = 'flow-check';
    flow.check!.required_boundaries = ['write storage', 'new process reads storage'];
    flow.check!.subject_paths = ['fixture.json', 'stored.json'];
    flow.check!.entry = `node -e ${JSON.stringify(flowScript)}`;
    semantic.claim_evidence[0]!.slots.push(flow);
    const root = confirmedSemanticRoot(semantic);
    fs.writeFileSync(path.join(root, 'fixture.json'), '{"ticket":"persisted"}');
    const preflight = preflightStep(root, { candidate_paths: ['stored.json'] });
    expect(Bun.spawnSync([process.execPath, '-e', ruleScript], { cwd: root }).exitCode).toBe(0);
    expect(Bun.spawnSync([process.execPath, '-e', flowScript], { cwd: root }).exitCode).toBe(0);
    const ruleReport = reportFixture(root);
    const wrong = { ...ruleReport, slot_id: 'flow' };
    const input = { preflight_receipt: preflight.receipt, actual_changed_paths: ['stored.json'], command_results: [{ command: ruleCommand, status: 'passed', observed_repo_writes: ['stored.json'], evidence_refs: ['evidence-report.txt'] }], validation_results: [{ validation: 'Stored ticket satisfies the admitted schema', status: 'passed', evidence_refs: ['evidence-report.txt'] }], acceptance_evidence: [wrong], outcome: 'implemented', note: 'isolated evidence checks' };
    expect(() => recordStepResult(root, input)).toThrow('CLAIM_EVIDENCE_PLAN_CONFLICT');
    expect(recordStepResult(root, { ...input, acceptance_evidence: [{ ...ruleReport, report: { ...ruleReport.report, assurance: 'trusted' } }] })).toMatchObject({ status: 'success', evidence_assurance: 'caller-reported' });
    let current = readCanonicalCurrentTask(root);
    expect(current.runtimeState.claim_evidence![0]!.slots[0]!.report!.assurance).toBe('caller-reported');
    expect(current.runtimeState.claim_evidence![0]!.slots[1]!.report).toBeNull();
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { claim_evidence: current.runtimeState.claim_evidence, idempotency_key: 'missing-flow' }))).toMatchObject({ status: 'blocked', code: 'CLAIM_EVIDENCE_INCOMPLETE' });
    expect(JSON.stringify(previewCloseTask(root, archiveDelta()))).toContain('incomplete');
    const context = reviewContext(root, {});
    expect(recordReviewResult(root, { context_receipt: context.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
    expect(() => completeReviewedStep(root, { step_id: 'step-1', note: 'verified' })).toThrow('CLAIM_EVIDENCE_INCOMPLETE');
    const snapshot = fs.readFileSync(current.filePath, 'utf8');
    expect(() => preflightStep(root, { candidate_paths: [] })).toThrow('PENDING_REVIEW_REQUIRED');
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(snapshot);

    // Independent admitted task: failed/blocked/not-run/skipped are real stored
    // observations, but never satisfy a required positive slot.
    for (const status of ['failed', 'blocked', 'not-run', 'skipped', 'passed']) {
      const other = confirmedSemanticRoot(semantic);
      fs.writeFileSync(path.join(other, 'fixture.json'), '{"ticket":"persisted"}');
      const before = preflightStep(other, { candidate_paths: ['stored.json'] });
      expect(Bun.spawnSync([process.execPath, '-e', ruleScript], { cwd: other }).exitCode).toBe(0);
      if (status === 'passed') expect(Bun.spawnSync([process.execPath, '-e', flowScript], { cwd: other }).exitCode).toBe(0);
      const flowReport = reportFixture(other, 'A1', 'flow', status);
      expect(recordStepResult(other, { ...input, preflight_receipt: before.receipt, acceptance_evidence: [reportFixture(other), flowReport] }).status).toBe('success');
      const review = reviewContext(other, {});
      expect(recordReviewResult(other, { context_receipt: review.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
      if (status !== 'passed') {
        expect(() => completeReviewedStep(other, { step_id: 'step-1', note: 'verified' })).toThrow('CLAIM_EVIDENCE_INCOMPLETE');
        expect(JSON.stringify(previewCloseTask(other, archiveDelta()))).toContain('incomplete');
      } else {
        // Review audit writes changed CURRENT_TASK but did not invalidate reports.
        expect(completeReviewedStep(other, { step_id: 'step-1', note: 'verified' }).status).toBe('success');
        fs.writeFileSync(path.join(other, 'fixture.json'), '{"changed":true}');
        expect(JSON.stringify(previewCloseTask(other, archiveDelta()))).toContain('incomplete');
      }
    }
  });

  // Review repair/P-12: bundled Node callers can bind independent slot reports
  // without a source helper; obtaining a fresh hash never writes Runtime state.
  test('evidence-context CLI returns current per-check revisions and rejects stale reports', () => {
    const semantic = singleStepSemanticDraft();
    const editedPath = 'runtime/vnext/src/prepare-task-adapter.ts';
    const extra = structuredClone(semantic.claim_evidence[0]!.slots[0]!);
    extra.slot_id = 'other';
    extra.check!.check_id = 'other-check';
    extra.check!.subject_paths = [editedPath];
    semantic.claim_evidence[0]!.slots.push(extra);
    const root = confirmedSemanticRoot(semantic);
    const preflight = preflightStep(root, {candidate_paths: [editedPath]});
    fs.mkdirSync(path.dirname(path.join(root, editedPath)), {recursive: true});
    fs.writeFileSync(path.join(root, editedPath), '// observed fixture v1');
    const canonical = readCanonicalCurrentTask(root);
    const before = fs.readFileSync(canonical.filePath, 'utf8');
    function context() {
      const result = spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'evidence-context', '--root', root], {input: '{}', encoding: 'utf8'});
      expect(result.status, result.stderr).toBe(0);
      const value = JSON.parse(result.stdout);
      expect(value).toMatchObject({status: 'pass', committed: false, evidence_assurance: 'caller-reported'});
      expect(fs.readFileSync(canonical.filePath, 'utf8')).toBe(before);
      return value;
    }
    function reports(value: ReturnType<typeof context>) {
      return value.checks.map((check: any) => {
        const slot = semantic.claim_evidence[0]!.slots.find(s => s.slot_id === check.slot_id)!;
        return {
          claim_id: check.claim_id, slot_id: check.slot_id, check_id: check.check_id,
          minimum_type: slot.minimum_type, disposition: 'newly-executed', evidence_refs: ['evidence-report.txt'],
          report: {result_id: `result-${check.slot_id}`, status: 'passed', evidence_plan_revision: value.evidence_plan_revision,
            subject_revision: check.subject_revision, actual_method: 'execution', environment: 'isolated Runtime fixture', assurance: 'caller-reported'},
        };
      });
    }
    const initial = context();
    expect(initial.checks).toHaveLength(2);
    expect(initial.checks[0].subject_revision).not.toBe(initial.checks[1].subject_revision);
    fs.appendFileSync(path.join(root, editedPath), '\n// fixture v2');
    const input = {
      preflight_receipt: preflight.receipt, actual_changed_paths: [editedPath],
      command_results: [{command: semantic.implementation_steps[0]!.commands![0]!.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt']}],
      validation_results: [{validation: semantic.implementation_steps[0]!.validation[0]!, status: 'passed', evidence_refs: ['evidence-report.txt']}],
      outcome: 'implemented', note: 'isolated result binding',
    };
    expect(recordStepResult(root, {...input, acceptance_evidence: reports(initial)})).toMatchObject({status: 'blocked', code: 'CLAIM_EVIDENCE_STALE'});
    const fresh = context();
    expect(fresh.checks[0].subject_revision).toBe(initial.checks[0].subject_revision);
    expect(fresh.checks[1].subject_revision).not.toBe(initial.checks[1].subject_revision);
    expect(recordStepResult(root, {...input, acceptance_evidence: reports(fresh)}).status).toBe('success');
  });

  // S3/P-12: cumulative review must expose an early test's circular oracle,
  // preserve the user's dirty base, and repair that path at the later checkpoint.
  // S4/P-12: a real environment-dependent process fails then succeeds;
  // durable retry neither grants evidence nor erases the original failure.
  test('S4 retries an environment blocker through fresh preflight and execution without bypassing evidence', () => {
    const semantic=singleStepSemanticDraft();
    const code='process.exit(process.env.S4_READY === "yes" ? 0 : 9)';
    const command='bun -e '+JSON.stringify(code);
    semantic.implementation_steps[0]!.commands=[{command,expected_repo_writes:'none'}];
    semantic.implementation_steps[0]!.validation=[command];
    semantic.claim_evidence[0]!.slots[0]!.check!.entry=command;
    const root=confirmedSemanticRoot(semantic);
    const editedPath='runtime/vnext/src/prepare-task-adapter.ts';
    fs.mkdirSync(path.dirname(path.join(root,editedPath)),{recursive:true});
    fs.writeFileSync(path.join(root,editedPath),'// original admitted file\n');
    const first=preflightStep(root,{candidate_paths:[editedPath]});
    fs.appendFileSync(path.join(root,editedPath),'// implementation before environment failure\n');
    const failed=spawnSync('bun',['-e',code],{env:{...process.env,S4_READY:'no'},encoding:'utf8'});
    expect(failed.status).toBe(9);
    fs.writeFileSync(path.join(root,'retry-failure.txt'),'S4_READY=no; exit='+failed.status);
    const blockedInput={preflight_receipt:first.receipt,actual_changed_paths:[editedPath],command_results:[{command,status:'blocked',observed_repo_writes:[],evidence_refs:['retry-failure.txt']}],validation_results:[{validation:command,status:'not-run',evidence_refs:[]}],acceptance_evidence:[],outcome:'blocked',blocker_kind:'environment',note:'S4_READY environment prerequisite is unavailable'};
    expect(recordStepResult(root,blockedInput).status).toBe('success');
    const blocked=readCanonicalCurrentTask(root);
    const failure=blocked.runtimeState.step_attempts!['step-1']!.attempts[0]!;
    expect(failure.status).toBe('blocked');
    expect(failure.blocker!.execution_result.actual_changed_paths).toEqual([editedPath]);
    expect(blocked.runtimeState.review_coverage!.pending_paths).toEqual([editedPath]);
    expect(() => preflightStep(root,{candidate_paths:[]})).toThrow('PREFLIGHT_BLOCKED');
    expect(() => reviewContext(root,{})).toThrow();
    const resolutionPath='retry-resolution.json';
    const retryInput={step_id:'step-1',blocked_attempt_id:failure.attempt_id,blocker_resolution_refs:[resolutionPath],idempotency_key:'retry-environment-1'};
    fs.writeFileSync(path.join(root,resolutionPath),'environment fixed');
    expect(retryStep(root,retryInput)).toMatchObject({status:'blocked',code:'RETRY_RESOLUTION_REQUIRED'});
    const success=spawnSync('bun',['-e',code],{env:{...process.env,S4_READY:'yes'},encoding:'utf8'});
    expect(success.status).toBe(0);
    fs.writeFileSync(path.join(root,resolutionPath),JSON.stringify({kind:'environment-restored/v1',task_id:blocked.runtimeState.task_id,document_id:blocked.sourceTuple.document_id,step_id:'step-1',blocked_attempt_id:failure.attempt_id,evidence_plan_revision:blocked.runtimeState.evidence_plan_revision,subject_revision:failure.blocker!.subject_snapshot.revision,status:'passed',diagnosis:'Required environment variable was absent',resolution:'Probe with S4_READY=yes exited 0'}));
    const raw=createStepRetryProposal(blocked,retryInput);
    expect(retryStep(root,retryInput)).toMatchObject({status:'success',state:{active_step_status:'ready'}});
    const recovered=readCanonicalCurrentTask(root);
    expect(recovered.runtimeState.claim_evidence).toEqual(blocked.runtimeState.claim_evidence);
    expect(recovered.runtimeState.review_coverage!.pending_paths).toEqual(blocked.runtimeState.review_coverage!.pending_paths);
    expect(recovered.runtimeState.step_attempts!['step-1']!.attempts[0]).toEqual(failure);
    expect(retryStep(root,retryInput).status).toBe('no-op');
    expect(applyVNextRuntimeProposal(root,raw).status).toBe('no-op');
    const cliReplay=spawnSync('bun',['run',path.join(ROOT,'scripts/vnext-runtime.ts'),'retry-step','--root',root],{cwd:ROOT,input:JSON.stringify(retryInput),encoding:'utf8'});
    expect(cliReplay.status).toBe(0);
    expect(JSON.parse(cliReplay.stdout).status).toBe('no-op');
    expect(retryStep(root,{...retryInput,blocked_attempt_id:'wrong-attempt'})).toMatchObject({status:'conflict',code:'RETRY_IDEMPOTENCY_CONFLICT'});
    expect(() => recordStepResult(root,{...blockedInput,note:'old receipt cannot authorize a new attempt'})).toThrow('EXECUTE_PREFLIGHT_STALE');
    expect(() => completeReviewedStep(root,{step_id:'step-1',note:'retry is not completion'})).toThrow('CLEAN_REVIEW_REQUIRED');
    const second=preflightStep(root,{candidate_paths:[]});
    expect(second.receipt.attempt_id).not.toBe(first.receipt.attempt_id);
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts[1]!.status).toBe('preflighted');
    const rerun=spawnSync('bun',['-e',code],{env:{...process.env,S4_READY:'yes'},encoding:'utf8'});
    expect(rerun.status).toBe(0);
    const passed={preflight_receipt:second.receipt,actual_changed_paths:[],command_results:[{command,status:'passed',observed_repo_writes:[],evidence_refs:[resolutionPath]}],validation_results:[{validation:command,status:'passed',evidence_refs:[resolutionPath]}],outcome:'implemented',note:'fresh run after recovery'};
    expect(recordStepResult(root,{...passed,acceptance_evidence:[]}).status).toBe('success');
    const pendingEvidence=readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root,taskProposal(root,{idempotency_key:'retry-missing-evidence',claim_evidence:pendingEvidence.runtimeState.claim_evidence}))).toMatchObject({status:'blocked',code:'CLAIM_EVIDENCE_INCOMPLETE'});
    // Bind the actual successful run to its still-required business check.
    const refreshed=preflightStep(root,{candidate_paths:[]});
    expect(recordStepResult(root,{...passed,preflight_receipt:refreshed.receipt,acceptance_evidence:[reportFixture(root)]}).status).toBe('success');
    // Exercise real Runtime pruning through bounded state-only audit entries;
    // no canonical editing and no invented additional process executions.
    for (let i=0;i<257;i++) {
      expect(applyVNextRuntimeProposal(root,taskProposal(root,{status:'in-progress',idempotency_key:`retry-audit-${i}`,note:`retained evidence audit ${i}`})).status).toBe('success');
    }
    const pruned=readCanonicalCurrentTask(root);
    expect(pruned.runtimeState.applied_proposals.some(p=>p.idempotency_key===retryInput.idempotency_key)).toBe(false);
    expect(pruned.runtimeState.execution_log.some(e=>e.idempotency_key===failure.idempotency_key)).toBe(false);
    const prunedBytes=fs.readFileSync(pruned.filePath,'utf8');
    expect(applyVNextRuntimeProposal(root,raw).status).toBe('no-op');
    expect(retryStep(root,retryInput).status).toBe('no-op');
    expect(fs.readFileSync(pruned.filePath,'utf8')).toBe(prunedBytes);
    const postPrune=preflightStep(root,{candidate_paths:[]});
    expect(spawnSync('bun',['-e',code],{env:{...process.env,S4_READY:'yes'},encoding:'utf8'}).status).toBe(0);
    expect(recordStepResult(root,{...passed,preflight_receipt:postPrune.receipt,acceptance_evidence:[],note:'fresh execution after audit pruning'}).status).toBe('success');
    const context=reviewContext(root,{});
    expect(context.recorded_execution.execution_result!.change_delta.entries.map(e=>e.path)).toEqual([editedPath]);
    expect(recordReviewResult(root,{context_receipt:context.receipt,verdict:'clean',findings:[],unresolved_fingerprints:[],evidence_refs:[resolutionPath],blocker:null}).status).toBe('success');
    expect(completeReviewedStep(root,{step_id:'step-1',note:'fresh evidence reviewed'}).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts).toHaveLength(2);
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts[0]).toEqual(failure);
  }, 90000);

  // S4/V11: retries are bounded and cannot change frozen authority or objects.
  test('S4 rejects changed subjects and unknown causes and exhausts exactly two retries', () => {
    for (const kind of ['environment','unknown'] as const) {
      const root=confirmedSemanticRoot(singleStepSemanticDraft());
      const failAttempt=(receipt: ReturnType<typeof preflightStep>['receipt']) => recordStepResult(root,{preflight_receipt:receipt,actual_changed_paths:[],command_results:[{command:'bun test test/vnext-runtime.test.ts',status:'blocked',observed_repo_writes:[],evidence_refs:['evidence-report.txt']}],validation_results:[{validation:'bun test test/vnext-runtime.test.ts passes',status:'not-run',evidence_refs:[]}],acceptance_evidence:[],outcome:'blocked',blocker_kind:kind,note:'fixture environment unavailable'});
      const resolution=() => {
        const current=readCanonicalCurrentTask(root);
        const last=current.runtimeState.step_attempts!['step-1']!.attempts.at(-1)!;
        fs.writeFileSync(path.join(root,'resolution.json'),JSON.stringify({kind:'environment-restored/v1',task_id:current.runtimeState.task_id,document_id:current.sourceTuple.document_id,step_id:'step-1',blocked_attempt_id:last.attempt_id,evidence_plan_revision:current.runtimeState.evidence_plan_revision,subject_revision:last.blocker!.subject_snapshot.revision,status:'passed',diagnosis:'isolated test environment unavailable',resolution:'fixture-only restored observation'}));
        return {step_id:'step-1',blocked_attempt_id:last.attempt_id,blocker_resolution_refs:['resolution.json'],idempotency_key:'retry-'+current.runtimeState.step_attempts!['step-1']!.attempts.length};
      };
      expect(failAttempt(preflightStep(root,{candidate_paths:[]}).receipt).status).toBe('success');
      const first=resolution();
      if (kind==='unknown') {
        expect(retryStep(root,first)).toMatchObject({status:'blocked',code:'RETRY_DIAGNOSIS_REQUIRED'});
        continue;
      }
      const current=readCanonicalCurrentTask(root);
      const currentBytes=fs.readFileSync(current.filePath,'utf8');
      expect(retryStep(root,first,{dryRun:true}).committed).toBe(false);
      const original=fs.readFileSync(path.join(root,'src/login.ts'),'utf8');
      fs.writeFileSync(path.join(root,'src/login.ts'),'out-of-band subject change');
      expect(retryStep(root,first)).toMatchObject({status:'blocked',code:'RETRY_SUBJECT_STALE'});
      fs.writeFileSync(path.join(root,'src/login.ts'),original);
      for (const extra of [{scope:['**']},{test_strategy:{mode:'flexible'}},{claim_evidence:[]}]) expect(() => retryStep(root,{...first,...extra})).toThrow('EXECUTE_ADAPTER_INPUT_INVALID');
      expect(fs.readFileSync(current.filePath,'utf8')).toBe(currentBytes);
      const draft=readDraftDefinitionFromBody(current.body);
      const replayBeforeBudget=createStepRetryProposal(current,first);
      expect(retryStep(root,first).status).toBe('success');
      const second=preflightStep(root,{candidate_paths:[]});
      expect(failAttempt(second.receipt).status).toBe('success');
      expect(retryStep(root,resolution()).status).toBe('success');
      expect(failAttempt(preflightStep(root,{candidate_paths:[]}).receipt).status).toBe('success');
      const exhausted=readCanonicalCurrentTask(root);
      const exhaustedBytes=fs.readFileSync(exhausted.filePath,'utf8');
      expect(exhausted.runtimeState.step_attempts!['step-1']!.attempts).toHaveLength(3);
      expect(retryStep(root,resolution())).toMatchObject({status:'blocked',code:'RETRY_BUDGET_EXHAUSTED'});
      expect(applyVNextRuntimeProposal(root,replayBeforeBudget).status).toBe('no-op');
      expect(fs.readFileSync(exhausted.filePath,'utf8')).toBe(exhaustedBytes);
      expect(readDraftDefinitionFromBody(exhausted.body)).toEqual(draft);
      expect(exhausted.runtimeState.findings).toEqual(current.runtimeState.findings);
    }
  });

  test('same-version rg recovery preserves an active task with a large Runtime baseline', { timeout: 30000 }, () => {
    const root = confirmedSemanticRoot();
    const file = 'runtime/vnext/src/prepare-task-adapter.ts';
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '// large existing file\n'.repeat(40000));
    preflightStep(root, { candidate_paths: [file] });

    const software = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-recovery-software-'));
    temporaryRoots.push(software);
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-recovery-package-'));
    temporaryRoots.push(packageRoot);
    buildVibeGovernanceDistribution({ outputRoot: packageRoot });
    expect(installDistribution({ targetRoot: software, packageRoot }).status).toBe('installed');
    // Attach installed software to the existing normal Runtime lifecycle fixture;
    // preserve its project facts, confirmed task and captured first-touch bytes.
    const statePath = '.workflow-system/vnext/DISTRIBUTION_STATE.json';
    const state = JSON.parse(fs.readFileSync(path.join(software, statePath), 'utf8'));
    for (const item of state.managed_files) {
      const destination = path.join(root, item.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(software, item.path), destination);
    }
    fs.copyFileSync(path.join(software, statePath), path.join(root, statePath));
    for (const directory of ['node_modules', 'tools']) {
      fs.cpSync(path.join(software, '.workflow-system/runtime', directory), path.join(root, '.workflow-system/runtime', directory), { recursive: true });
    }
    const canonicalPath = readCanonicalCurrentTask(root).filePath;
    const before = fs.readFileSync(canonicalPath);
    const raw = spawnSync('node', [path.join(root, '.workflow-system/runtime/dist/cli.js'), 'validate', '--root', root], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    expect(raw.status).toBe(0);
    expect(Buffer.byteLength(raw.stdout)).toBeGreaterThan(1024 * 1024);
    const identityPath = path.join(root, '.workflow-system/runtime/tools/rg/identity.json');
    fs.unlinkSync(identityPath);
    expect(upgradeDistribution({ targetRoot: root, packageRoot, dryRun: true }).status).toBe('ready');
    expect(fs.existsSync(identityPath)).toBe(false);
    const recovered = upgradeDistribution({ targetRoot: root, packageRoot });
    expect(recovered.status).toBe('upgraded');
    expect(recovered.read_back_verified).toBe(true);
    expect(fs.existsSync(identityPath)).toBe(true);
    expect(fs.readFileSync(canonicalPath)).toEqual(before);
  });

  test('S3 sparse checkpoint reviews dirty A plus B and verifies repair of the early oracle', { timeout: 30000 }, () => {
    const semantic = semanticDraft();
    const a = 'test/vnext-runtime.test.ts';
    const b = 'runtime/vnext/src/prepare-task-adapter.ts';
    semantic.implementation_steps[0]!.review_checkpoint = {policy:'not-required',reason:'Review the rule together with its integration at step-2'};
    semantic.implementation_steps[1]!.review_checkpoint = {policy:'required',reason:'Final cumulative rule and integration review'};
    const missingRepairScope = structuredClone(semantic);
    const admissionRoot = archivedBaselineRoot();
    expect(() => prepareDraft(admissionRoot, missingRepairScope)).toThrow('REVIEW_REPAIR_SCOPE_REQUIRED');
    semantic.implementation_steps[1]!.mutation_scope.push(a);
    const root = confirmedSemanticRoot(semantic);
    fs.mkdirSync(path.dirname(path.join(root,a)),{recursive:true});
    const dirtyBase = '// existing user work\n' + '// large existing file\n'.repeat(34000);
    fs.writeFileSync(path.join(root,a),dirtyBase);
    expect(applyVNextRuntimeProposal(root,taskProposal(root,{idempotency_key:'sparse-raw-skip'}))).toMatchObject({status:'blocked',code:'REVIEW_EXECUTION_REQUIRED'});
    const first = preflightStep(root,{candidate_paths:[a]});
    fs.writeFileSync(path.join(root,a),dirtyBase+'expect(limit()).toBe(PRODUCTION_LIMIT);\n');
    expect(recordStepResult(root,{preflight_receipt:first.receipt,actual_changed_paths:[a],command_results:[],validation_results:[{validation:semantic.implementation_steps[0]!.validation[0]!,status:'passed',evidence_refs:['evidence-report.txt']}],acceptance_evidence:[],outcome:'implemented',note:'defer review to integration'})).toMatchObject({status:'success',advancement:{to_step_id:'step-2'}});
    const aState = readCanonicalCurrentTask(root).runtimeState.review_coverage!;
    expect(aState.pending_paths).toEqual([a]);
    expect(Buffer.from(aState.preimages.find(p => p.path===a)!.content_base64!,'base64').toString()).toBe(dirtyBase);
    const second = preflightStep(root,{candidate_paths:[b]});
    fs.mkdirSync(path.dirname(path.join(root,b)),{recursive:true});
    fs.writeFileSync(path.join(root,b),'export const PRODUCTION_LIMIT = 99;\n');
    const positive = reportFixture(root);
    const results = {command_results:[{command:'bun test test/vnext-runtime.test.ts',status:'passed',observed_repo_writes:[],evidence_refs:['evidence-report.txt']}],validation_results:[{validation:'bun test test/vnext-runtime.test.ts passes',status:'passed',evidence_refs:['evidence-report.txt']}],acceptance_evidence:[positive],outcome:'implemented',note:'integration result'};
    expect(recordStepResult(root,{...results,preflight_receipt:second.receipt,actual_changed_paths:[b]}).status).toBe('success');
    const context = reviewContext(root,{});
    expect(context.recorded_execution.execution_result!.change_delta.entries.map(e=>e.path).sort()).toEqual([a,b].sort());
    expect(context.recorded_execution.execution_result!.actual_changed_paths).toEqual([b]);
    expect(JSON.stringify(context)).not.toContain('content_base64');
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(64 * 1024);
    const diff = reviewRead(root, { context_receipt: context.receipt, path: a });
    expect(diff.text).toContain('+expect(limit()).toBe(PRODUCTION_LIMIT);');
    expect(Buffer.byteLength(diff.text!)).toBeLessThan(1024);
    const originalPage = reviewRead(root, { context_receipt: context.receipt, path: a, view: 'before', max_bytes: 64 });
    expect(originalPage.text).toBe(dirtyBase.slice(0, 64));
    expect(originalPage.next_offset).toBe(64);
    expect(reviewRead(root, { context_receipt: context.receipt, path: a, view: 'before', offset: 64, max_bytes: 64 }).text).toBe(dirtyBase.slice(64, 128));
    const summaryCli = spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'validate', '--summary', '--root', root], { encoding: 'utf8' });
    expect(summaryCli.status).toBe(0);
    expect(summaryCli.stdout).not.toContain('content_base64');
    const rawCli = spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'validate', '--root', root], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    expect(rawCli.status).toBe(0);
    expect(JSON.parse(rawCli.stdout).runtime_state.review_coverage.preimages.find((item: any) => item.path === a).content_base64).toBe(Buffer.from(dirtyBase).toString('base64'));
    const beforeReview = fs.readFileSync(readCanonicalCurrentTask(root).filePath,'utf8');
    const contextCli = spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'review-context', '--root', root], { encoding: 'utf8', input: '{}' });
    expect(contextCli.status).toBe(0);
    const fromCli = JSON.parse(contextCli.stdout);
    expect(contextCli.stdout).not.toContain('content_base64');
    const readCli = spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'review-read', '--root', root], {
      encoding: 'utf8', input: JSON.stringify({ context_receipt: fromCli.receipt, path: a, view: 'before', start_line: 1, end_line: 1 }),
    });
    expect(readCli.status).toBe(0);
    expect(JSON.parse(readCli.stdout).text).toBe('// existing user work\n');
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath,'utf8')).toBe(beforeReview);
    expect(submitReviewResult(root,{context_receipt:context.receipt,verdict:'clean',findings:[],unresolved_fingerprints:[],evidence_refs:['evidence-report.txt'],blocker:null})).toMatchObject({status:'blocked',code:'REVIEW_ASSESSMENT_REQUIRED'});
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath,'utf8')).toBe(beforeReview);
    fs.appendFileSync(path.join(root,a),'// late edit');
    expect(() => reviewRead(root, { context_receipt: context.receipt, path: a, view: 'before', offset: 64 })).toThrow('REVIEW_TARGET_STALE');
    expect(() => recordReviewResult(root,{context_receipt:context.receipt,verdict:'clean',findings:[],unresolved_fingerprints:[],evidence_refs:['evidence-report.txt'],blocker:null})).toThrow('REVIEW_TARGET_STALE');
    fs.writeFileSync(path.join(root,a),dirtyBase+'expect(limit()).toBe(PRODUCTION_LIMIT);\n');
    const assessment = {applicable:true,reason:'Mixed implementation and reused test review',evidence_refs:['evidence-report.txt'],necessity:'The original request fixes limit at 10; preserve that regression',oracle:'The actual early diff derives expected value from PRODUCTION_LIMIT, so the 99 defect passes',boundary:'Direct Runtime fixture; no external process persistence is claimed',reuse:'Reuse the existing test with an independent expected value',applicability:'Current a+b manifest and current claim report inspected'};
    expect(recordReviewResult(root,{context_receipt:context.receipt,verdict:'findings',findings:[{category:'test-oracle',file:a,failure_condition:'PRODUCTION_LIMIT changes expected and actual together',required_behavior:'Assert the requested limit 10 independently',root_cause_status:'confirmed',evidence_refs:['evidence-report.txt']}],unresolved_fingerprints:[],evidence_refs:['evidence-report.txt'],blocker:null,test_assessment:assessment}).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_coverage!.pending_paths.sort()).toEqual([a,b].sort());
    const repair = beginRepair(root,{candidate_paths:[a]});
    fs.writeFileSync(path.join(root,a),dirtyBase+'expect(limit()).toBe(10);\n');
    expect(recordStepResult(root,{...results,acceptance_evidence:[],preflight_receipt:repair.receipt,actual_changed_paths:[a]}).status).toBe('success');
    expect(() => completeReviewedStep(root,{step_id:'step-2',note:'repair alone is insufficient'})).toThrow('CLEAN_REVIEW_REQUIRED');
    const verification = reviewContext(root,{});
    expect(verification.receipt.cycle_phase).toBe('verification');
    expect(verification.recorded_execution.execution_result!.change_delta.entries.map(e=>e.path).sort()).toEqual([a,b].sort());
    expect(recordReviewResult(root,{context_receipt:verification.receipt,verdict:'clean',findings:[],unresolved_fingerprints:[],evidence_refs:['evidence-report.txt'],blocker:null,test_assessment:{...assessment,oracle:'The repaired expectation is the independently specified 10'}}).status).toBe('success');
    expect(completeReviewedStep(root,{step_id:'step-2',note:'cumulative repair verified'}).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.review_coverage!.pending_paths).toEqual([]);
    fs.appendFileSync(path.join(root,a),'// after clean');
    expect(previewCloseTask(root,archiveDelta()).closure_eligibility.eligible).toBe(false);
  });

  // S3/V9/V10: add/delete/repeated writes retain first-touch state; an
  // exempt step still needs its due evidence and raw reports cannot replace base.
  test('S3 preserves added deleted and repeatedly changed paths and rejects exempt-step missing evidence', () => {
    const semantic = semanticDraft();
    const a = 'test/vnext-runtime.test.ts';
    const b = 'runtime/vnext/src/prepare-task-adapter.ts';
    const c = 'src/login.ts';
    semantic.mutation_scope.allowed.push(c);
    semantic.implementation_steps[0]!.mutation_scope.push(c);
    semantic.implementation_steps[0]!.review_checkpoint = {policy:'not-required',reason:'Review all paths at integration'};
    semantic.implementation_steps[1]!.mutation_scope.push(a,c);
    semantic.implementation_steps[1]!.review_checkpoint = {policy:'required',reason:'Final cumulative review'};
    const due = structuredClone(semantic.claim_evidence[0]!);
    due.claim_id='early-rule'; due.claim_kind='invariant';
    due.slots[0]!.slot_id='early-rule'; due.slots[0]!.check!.check_id='early-rule'; due.slots[0]!.due_step_id='step-1';
    semantic.claim_evidence.push(due);
    const root=confirmedSemanticRoot(semantic);
    // Fixture paths are within this isolated root; preserve the declared original.
    const cOriginal=fs.readFileSync(path.join(root,c),'utf8');
    fs.mkdirSync(path.dirname(path.join(root,a)),{recursive:true});
    const first=preflightStep(root,{candidate_paths:[a,c]});
    fs.mkdirSync(path.dirname(path.join(root,a)),{recursive:true});
    fs.writeFileSync(path.join(root,a),'new test file v1');
    fs.unlinkSync(path.join(root,c));
    const input={preflight_receipt:first.receipt,actual_changed_paths:[a,c],command_results:[],validation_results:[{validation:semantic.implementation_steps[0]!.validation[0]!,status:'passed',evidence_refs:['evidence-report.txt']}],outcome:'implemented',note:'early exempt step'};
    const before=fs.readFileSync(readCanonicalCurrentTask(root).filePath,'utf8');
    expect(recordStepResult(root,{...input,acceptance_evidence:[]})).toMatchObject({status:'blocked',code:'CLAIM_EVIDENCE_INCOMPLETE'});
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath,'utf8')).toBe(before);
    expect(recordStepResult(root,{...input,acceptance_evidence:[reportFixture(root,'early-rule','early-rule')]}).status).toBe('success');
    const second=preflightStep(root,{candidate_paths:[a,b]});
    const repeated=preflightStep(root,{candidate_paths:[a,b]});
    expect(repeated.receipt.review_base).toEqual(second.receipt.review_base);
    fs.writeFileSync(path.join(root,a),'new test file v2');
    fs.mkdirSync(path.dirname(path.join(root,b)),{recursive:true});
    fs.writeFileSync(path.join(root,b),'new integration');
    expect(recordStepResult(root,{preflight_receipt:repeated.receipt,actual_changed_paths:[a,b],command_results:[{command:'bun test test/vnext-runtime.test.ts',status:'passed',observed_repo_writes:[],evidence_refs:['evidence-report.txt']}],validation_results:[{validation:'bun test test/vnext-runtime.test.ts passes',status:'passed',evidence_refs:['evidence-report.txt']}],acceptance_evidence:[reportFixture(root)],outcome:'implemented',note:'repeat a, add b'}).status).toBe('success');
    const context=reviewContext(root,{});
    expect(context.recorded_execution.execution_result!.change_delta.entries.map(e=>e.path).sort()).toEqual([a,b,c].sort());
    expect(context.recorded_execution.execution_result!.review_base.entries.find(e=>e.path===a)!.state).toBe('absent');
    expect(context.recorded_execution.execution_result!.review_target.entries.find(e=>e.path===c)!.state).toBe('absent');
    expect(reviewRead(root,{context_receipt:context.receipt,path:c,view:'before'}).text).toBe(cOriginal);
    expect(JSON.stringify(context)).not.toContain('content_base64');
    const review={context_receipt:context.receipt,verdict:'blocked',findings:[],unresolved_fingerprints:[],evidence_refs:['evidence-report.txt'],blocker:{code:'ORACLE_REVIEW_PENDING',summary:'Need original-request oracle comparison',next_route:'review-change'}};
    expect(recordReviewResult(root,review).status).toBe('success');
    const pending=fs.readFileSync(readCanonicalCurrentTask(root).filePath,'utf8');
    expect(() => preflightStep(root,{candidate_paths:[a]})).toThrow();
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath,'utf8')).toBe(pending);
    expect(readCanonicalCurrentTask(root).runtimeState.review_coverage!.pending_paths.sort()).toEqual([a,b,c].sort());
  });

  test('S2 consumes reproduction before editing, preserves H0 after H1 repair, and rejects forged/stale consumption', () => {
    const semantic = semanticDraft();
    semantic.test_strategy = { mode: 'test-first', source: 'explicit-user', source_ref: 'test:original-request', task_classification: 'contract-clear-behavior', rationale: 'Reproduce the defect before fixing it' };
    semantic.mutation_scope.allowed.push('src/login.ts');
    semantic.implementation_steps[1]!.mutation_scope.push('src/login.ts');
    const prerequisite = structuredClone(semantic.claim_evidence[0]!);
    prerequisite.claim_id = 'reproduction'; prerequisite.claim_kind = 'invariant'; prerequisite.requirement = 'Observe the admitted defect before editing';
    const slot = prerequisite.slots[0]!;
    slot.slot_id = 'reproduce'; slot.due_step_id = 'step-1'; slot.applicability = 'before-step'; slot.before_step_id = 'step-2'; slot.prerequisite_receipt = null;
    slot.check!.check_id = 'reproduce-check'; slot.check!.expected_result = 'expected-failure'; slot.check!.entry = semantic.implementation_steps[1]!.commands[0]!.command;
    semantic.implementation_steps[0]!.validation = [slot.check!.entry];
    semantic.claim_evidence.push(prerequisite);
    const root = confirmedSemanticRoot(semantic);
    const first = preflightStep(root, { candidate_paths: ['test/vnext-runtime.test.ts'] });
    const report = reportFixture(root, 'reproduction', 'reproduce', 'expected-failure');
    expect(recordStepResult(root, { preflight_receipt: first.receipt, actual_changed_paths: [], command_results: [], validation_results: [{ validation: slot.check!.entry, status: 'expected-failure', evidence_refs: ['evidence-report.txt'], expected_failure: { kind: 'behavior-not-implemented', expected_behavior: 'defect fixed', observed_failure_signature: 'defect reproduced' } }], acceptance_evidence: [report], outcome: 'implemented', note: 'reproduction completed; positive acceptance remains missing' }).status).toBe('success');
    const reviewed = reviewContext(root, {});
    expect(recordReviewResult(root, { context_receipt: reviewed.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
    expect(completeReviewedStep(root, { step_id: 'step-1', note: 'reproduction reviewed' }).status).toBe('success');
    let current = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { status: 'in-progress', idempotency_key: 'skip-prerequisite-consumption' }))).toMatchObject({ status: 'blocked', code: 'PREREQUISITE_REQUIRED' });
    const original = fs.readFileSync(path.join(root, 'src/login.ts'), 'utf8');
    fs.writeFileSync(path.join(root, 'src/login.ts'), 'changed before preflight');
    expect(() => preflightStep(root, { candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'src/login.ts'] })).toThrow('CLAIM_EVIDENCE_STALE');
    expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(current.sourceTuple.revision);
    fs.writeFileSync(path.join(root, 'src/login.ts'), original);
    const replayablePreflight = createStepPreflightProposal(readCanonicalCurrentTask(root), ['runtime/vnext/src/prepare-task-adapter.ts', 'src/login.ts']);
    const second = preflightStep(root, { candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'src/login.ts'] });
    expect(second.committed).toBe(true);
    expect(applyVNextRuntimeProposal(root, replayablePreflight).status).toBe('no-op');
    current = readCanonicalCurrentTask(root);
    const consumed = current.runtimeState.claim_evidence![1]!.slots[0]!;
    expect(consumed.prerequisite_receipt!.subject_snapshot.revision).toBe(report.report.subject_revision);
    fs.writeFileSync(path.join(root, 'src/login.ts'), 'fixed H1 subject');
    const positive = reportFixture(root);
    // P-12 defect regression: historical H0 authorizes reproduction only, even
    // when the repair runs the same command and submits positive slot reports.
    const beforeRejectedFailure = fs.readFileSync(current.filePath, 'utf8');
    expect(recordStepResult(root, { preflight_receipt: second.receipt, actual_changed_paths: ['src/login.ts'], command_results: [{ command: slot.check!.entry, status: 'expected-failure', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'], expected_failure: { kind: 'behavior-not-implemented', expected_behavior: 'fix now passes', observed_failure_signature: 'still fails after fix' } }], validation_results: [{ validation: 'bun test test/vnext-runtime.test.ts passes', status: 'passed', evidence_refs: ['evidence-report.txt'] }], acceptance_evidence: [positive], outcome: 'implemented', note: 'old reproduction cannot authorize repair failure' })).toMatchObject({ status: 'blocked', code: 'EXECUTE_EXPECTED_FAILURE_INVALID', committed: false });
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(beforeRejectedFailure);
    expect(previewCloseTask(root, archiveDelta()).closure_eligibility.eligible).toBe(false);
    expect(() => completeReviewedStep(root, { step_id: 'step-2', note: 'failure cannot complete' })).toThrow('CLEAN_REVIEW_REQUIRED');
    expect(recordStepResult(root, { preflight_receipt: second.receipt, actual_changed_paths: ['src/login.ts'], command_results: [{ command: 'bun test test/vnext-runtime.test.ts', status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }], validation_results: [{ validation: 'bun test test/vnext-runtime.test.ts passes', status: 'passed', evidence_refs: ['evidence-report.txt'] }], acceptance_evidence: [positive], outcome: 'implemented', note: 'current fix evidence' }).status).toBe('success');
    const finalReview = reviewContext(root, {});
    recordReviewResult(root, { context_receipt: finalReview.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null });
    const pendingBytes = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
    expect(applyVNextRuntimeProposal(root, replayablePreflight)).toMatchObject({ status: 'blocked', code: 'PENDING_REVIEW_REQUIRED' });
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(pendingBytes);
    fs.writeFileSync(path.join(root, 'src/login.ts'), 'changed after review');
    expect(applyVNextRuntimeProposal(root, replayablePreflight)).toMatchObject({ status: 'conflict', code: 'REVIEW_TARGET_STALE' });
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(pendingBytes);
    fs.writeFileSync(path.join(root, 'src/login.ts'), 'fixed H1 subject');
    expect(completeReviewedStep(root, { step_id: 'step-2', note: 'fix reviewed' }).status).toBe('success');
    expect(previewCloseTask(root, archiveDelta()).closure_eligibility.eligible).toBe(true);
    expect(applyVNextRuntimeProposal(root, archiveProposal(root))).toMatchObject({status:'success'});
  });

  test('S2 admission rejects vague checks, missing P-12 authority and forged receipts without writes', () => {
    for (const mutate of [
      (draft: PrepareTaskSemanticDraft) => { draft.claim_evidence[0]!.slots[0]!.minimum_type = 'planned-validation'; },
      (draft: PrepareTaskSemanticDraft) => { (draft.persistent_tests as any[])[0].basis = 'coverage'; },
      (draft: PrepareTaskSemanticDraft) => { delete (draft.persistent_tests as any[])[0].owner_source; },
      (draft: PrepareTaskSemanticDraft) => { (draft.persistent_tests as any[])[0].proves = ['unknown-claim']; },
      (draft: PrepareTaskSemanticDraft) => { draft.claim_evidence[0]!.slots.push(structuredClone(draft.claim_evidence[0]!.slots[0]!)); },
    ]) {
      const root = archivedBaselineRoot();
      const before = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
      const draft = semanticDraft(); mutate(draft);
      expect(() => prepareDraft(root, draft)).toThrow();
      expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(before);
    }
    const draftRoot = archivedBaselineRoot();
    const draft = semanticDraft();
    expect(prepareDraft(draftRoot, draft).status).toBe('success');
    const altered = structuredClone(draft);
    altered.claim_evidence[0]!.slots[0]!.slot_id = 'replacement-slot';
    altered.claim_evidence[0]!.slots[0]!.check!.expected_observation = 'a different rule';
    expect(prepareDraft(draftRoot, altered)).toMatchObject({ status: 'blocked', code: 'CLAIM_EVIDENCE_PLAN_CONFLICT' });
    const root = confirmedSemanticRoot();
    const current = readCanonicalCurrentTask(root);
    const forged = structuredClone(current.runtimeState.claim_evidence!);
    forged[0]!.slots[0]!.prerequisite_receipt = { step_id: 'step-1', preflight_id: 'forged', result_id: 'forged', subject_snapshot: captureReviewTarget(root, ['src/login.ts']) };
    expect(applyVNextRuntimeProposal(root, taskProposal(root, { status: 'in-progress', claim_evidence: forged, idempotency_key: 'forged-receipt' }))).toMatchObject({ status: 'blocked', code: 'CLAIM_EVIDENCE_PLAN_CONFLICT' });
    expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(current.sourceTuple.revision);
  });

  // P-12 defect regression: reject an unsupported explicit prerequisite before
  // confirmation, through both semantic admission and the raw Runtime boundary.
  test('S2 rejects first-step prerequisites at admission without writes', () => {
    const semantic = singleStepSemanticDraft();
    const prerequisite = structuredClone(semantic.claim_evidence[0]!);
    prerequisite.claim_id = 'first-prerequisite'; prerequisite.claim_kind = 'invariant';
    const slot = prerequisite.slots[0]!;
    slot.slot_id = 'first-prerequisite'; slot.check!.check_id = 'first-prerequisite';
    slot.applicability = 'before-step'; slot.before_step_id = 'step-1';
    semantic.claim_evidence.push(prerequisite);
    const root = archivedBaselineRoot();
    const current = readCanonicalCurrentTask(root);
    const before = fs.readFileSync(current.filePath, 'utf8');
    expect(() => prepareDraft(root, semantic)).toThrow('TEST_STRATEGY_PREREQUISITE_UNSUPPORTED');
    const proposal = createPrepareTaskDraftProposal(current, {
      action: 'create-draft', task_id: '001', task_slug: 'first-prerequisite',
      document_id: 'doc-111111111111111111111111', task_title: 'First prerequisite',
      draft_definition: semanticDraftDefinition(semantic), active_step_id: 'step-1',
      task_basis: semantic.task_basis, claim_evidence: semantic.claim_evidence,
      evidence_refs: ['test:first-prerequisite'], idempotency_key: 'first-prerequisite',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, proposal)).toMatchObject({ status: 'blocked', code: 'TEST_STRATEGY_PREREQUISITE_UNSUPPORTED', committed: false });
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before);
  });

  test('S2 static evidence and future slots retain independent identities without adding persistent tests', () => {
    const semantic = notApplicableSemanticDraft();
    const slot = semantic.claim_evidence[0]!.slots[0]!;
    slot.minimum_type = 'static-proof'; slot.check!.method = 'static'; slot.check!.expected_result = 'accepted'; slot.check!.entry = 'README.md'; slot.check!.subject_paths = ['README.md'];
    const root = confirmedSemanticRoot(semantic);
    const preflight = preflightStep(root, { candidate_paths: ['README.md'] });
    fs.writeFileSync(path.join(root, 'README.md'), '# Reviewed documentation');
    const evidence = reportFixture(root, 'A1', 'a1', 'accepted');
    expect(recordStepResult(root, { preflight_receipt: preflight.receipt, actual_changed_paths: ['README.md'], command_results: [], validation_results: [{ validation: 'Review the rendered documentation content', status: 'passed', evidence_refs: ['evidence-report.txt'] }], acceptance_evidence: [evidence], outcome: 'implemented', note: 'static observation' }).status).toBe('success');
    const context = reviewContext(root, {});
    recordReviewResult(root, { context_receipt: context.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null });
    expect(completeReviewedStep(root, { step_id: 'update-docs', note: 'verified' }).status).toBe('success');
  });

  // S1 admission: V1/V2 protect first-pass tests and V3 protects explicit
  // ordering; raw/version counterexamples protect the shared Runtime boundary.
  test('completes a single flexible test step on its first passed result without product edits or Red', () => {
    const semantic = semanticDraft();
    semantic.implementation_steps = [semantic.implementation_steps[0]!];
    semantic.claim_evidence[0]!.slots[0]!.due_step_id = 'step-1';
    semantic.implementation_steps[0]!.commands = [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }];
    const root = confirmedSemanticRoot(semantic);
    const preflight = preflightStep(root, { candidate_paths: ['test/vnext-runtime.test.ts'] });
    expect(preflight.current_step).toMatchObject({ execution_phase: 'flexible', required_outcome: 'implemented' });
    const testPath = path.join(root, 'test/vnext-runtime.test.ts');
    fs.mkdirSync(path.dirname(testPath), { recursive: true });
    fs.writeFileSync(testPath, 'import { test, expect } from "bun:test"; test("existing behavior", () => expect([1, 2].length).toBe(2));\n');
    const run = spawnSync('bun', ['test', 'test/vnext-runtime.test.ts'], { cwd: root, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('1 pass');
    const input = {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: ['test/vnext-runtime.test.ts'],
      command_results: [{ command: 'bun test test/vnext-runtime.test.ts', status: 'passed', observed_repo_writes: [], evidence_refs: ['test:first-pass'] }],
      validation_results: [{ validation: semantic.implementation_steps[0]!.validation[0]!, status: 'passed', evidence_refs: ['test:first-pass'] }],
      acceptance_evidence: [reportFixture(root)],
      outcome: 'implemented',
      note: 'The isolated first-run test passed.',
    };
    const beforeResult = readCanonicalCurrentTask(root);
    const target = captureReviewTarget(root, input.actual_changed_paths);
    const expectedFailure = {
      ...input.command_results[0]!, status: 'expected-failure' as const,
      expected_failure: { kind: 'behavior-not-implemented' as const, expected_behavior: 'behavior is present', observed_failure_signature: 'behavior is absent' },
    };
    expect(recordStepResult(root, { ...input, command_results: [expectedFailure] })).toMatchObject({ status: 'blocked', code: 'EXECUTE_EXPECTED_FAILURE_INVALID' });
    const raw = createTaskStateProposal(beforeResult, {
      mode: 'default', status: 'in-progress', evidence_refs: ['test:raw-negative'],
      idempotency_key: 'raw-negative', authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      execution_result: {
        outcome: 'test-red', change_set_id: preflight.receipt.change_set_id,
        review_base: preflight.receipt.review_base, review_target: target,
        change_delta: createReviewChangeDelta(preflight.receipt.review_base, target),
        actual_changed_paths: input.actual_changed_paths,
        command_results: [expectedFailure], validation_results: [], acceptance_evidence: [], blocker: null,
      },
    });
    expect(applyVNextRuntimeProposal(root, raw)).toMatchObject({ status: 'blocked', code: 'TEST_STRATEGY_SEQUENCE_INVALID', committed: false });
    expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(beforeResult.sourceTuple.revision);
    recordStepResult(root, input);
    const context = reviewContext(root, {});
    expect(recordReviewResult(root, { context_receipt: context.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['test:review-first-pass'], blocker: null }).status).toBe('success');
    expect(completeReviewedStep(root, { step_id: 'step-1', note: 'first passed test reviewed' })).toMatchObject({ status: 'success', advancement: { outcome: 'task-complete' } });
    const current = readCanonicalCurrentTask(root);
    expect(current.runtimeState.business_evidence_version).toBe(1);
    expect(current.runtimeState.execution_log.some(entry => !('action' in entry) && entry.execution_result?.outcome === 'test-red')).toBe(false);
  });

  test('blocks explicit ordering at semantic and raw admission without replacing the requested strategy', () => {
    for (const mode of ['test-first', 'implementation-first'] as const) {
      const semantic = semanticDraft();
      semantic.test_strategy = { ...semantic.test_strategy, mode, source: 'explicit-user', source_ref: 'test:original-request' };
      const root = archivedBaselineRoot();
      const before = readCanonicalCurrentTask(root).sourceTuple.revision;
      expect(() => prepareDraft(root, semantic)).toThrow('TEST_STRATEGY_PREREQUISITE_UNSUPPORTED');
      const current = readCanonicalCurrentTask(root);
      const proposal = createPrepareTaskDraftProposal(current, {
        action: 'create-draft', task_id: '001', task_slug: 'explicit-order',
        document_id: 'doc-111111111111111111111111', task_title: 'Explicit order',
        draft_definition: semanticDraftDefinition(semantic), active_step_id: 'step-1',
        task_basis: semantic.task_basis, claim_evidence: semantic.claim_evidence,
        evidence_refs: ['test:explicit-order'], idempotency_key: 'explicit-order',
        authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
      });
      expect(applyVNextRuntimeProposal(root, proposal)).toMatchObject({ status: 'blocked', code: 'TEST_STRATEGY_PREREQUISITE_UNSUPPORTED', committed: false });
      expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(before);
    }
  });

  test('reads unversioned task history but blocks preflight, raw progress and closure without rewriting it', () => {
    const root = confirmedSemanticRoot();
    const file = readCanonicalCurrentTask(root).filePath;
    const historical = fs.readFileSync(file, 'utf8').replace(/^  business_evidence_version: 1\r?\n/m, '');
    fs.writeFileSync(file, historical);
    expect(readCanonicalCurrentTask(root).runtimeState.business_evidence_version).toBeUndefined();
    expect(() => replan(root, singleStepSemanticDraft())).toThrow('REPLAN_INVALIDATION_REQUIRED');
    expect(() => preflightStep(root, { candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'] })).toThrow('TASK_SEMANTICS_UPGRADE_REQUIRED');
    expect(applyVNextRuntimeProposal(root, taskProposal(root))).toMatchObject({ status: 'blocked', code: 'TASK_SEMANTICS_UPGRADE_REQUIRED', committed: false });
    expect(JSON.stringify(previewCloseTask(root, archiveDelta()))).toContain('TASK_SEMANTICS_UPGRADE_REQUIRED');
    expect(fs.readFileSync(file, 'utf8')).toBe(historical);
    fs.writeFileSync(file, historical.replace('runtime_state:\n', 'runtime_state:\n  business_evidence_version: 2\n'));
    expect(() => readCanonicalCurrentTask(root)).toThrow('TASK_SEMANTICS_VERSION_UNSUPPORTED');
  });

  test('does not let raw progress bypass an explicit ordering strategy on an existing versioned task', () => {
    const root = confirmedSemanticRoot();
    const file = readCanonicalCurrentTask(root).filePath;
    // A fixture of a future/forged ordered task must still fail at execution,
    // even when the caller bypasses prepare and semantic execution adapters.
    const ordered = fs.readFileSync(file, 'utf8').replace('- mode: flexible', '- mode: test-first').replace('- source: inferred-default', '- source: explicit-user');
    fs.writeFileSync(file, ordered);
    expect(() => preflightStep(root, { candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'] })).toThrow('TEST_STRATEGY_PREREQUISITE_UNSUPPORTED');
    expect(applyVNextRuntimeProposal(root, taskProposal(root))).toMatchObject({ status: 'blocked', code: 'TEST_STRATEGY_PREREQUISITE_UNSUPPORTED', committed: false });
    expect(fs.readFileSync(file, 'utf8')).toBe(ordered);
  });

  test('rejects unplanned or self-reported paths that disagree with the Runtime before/after delta', () => {
    const root = confirmedSemanticRoot();
    const preflight = preflightStep(root, {
      candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
    });

    expect(() => recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: ['test/vnext-runtime.test.ts'],
      command_results: [{
        command: 'bun test test/vnext-runtime.test.ts',
        status: 'passed',
        observed_repo_writes: [],
        evidence_refs: ['test:evidence:command'],
      }],
      validation_results: [{
        validation: 'bun test test/vnext-runtime.test.ts passes',
        status: 'passed',
        evidence_refs: ['test:evidence:validation'],
      }],
      acceptance_evidence: [],
      outcome: 'implemented',
      note: null,
    })).toThrow('EXECUTE_PREFLIGHT_SCOPE_CONFLICT');

    const changedPath = path.join(root, 'runtime', 'vnext', 'src', 'prepare-task-adapter.ts');
    fs.mkdirSync(path.dirname(changedPath), { recursive: true });
    fs.writeFileSync(changedPath, 'changed after preflight\n', 'utf8');
    expect(() => recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: [],
      command_results: [{
        command: 'bun test test/vnext-runtime.test.ts',
        status: 'passed',
        observed_repo_writes: [],
        evidence_refs: ['test:evidence:command'],
      }],
      validation_results: [{
        validation: 'bun test test/vnext-runtime.test.ts passes',
        status: 'passed',
        evidence_refs: ['test:evidence:validation'],
      }],
      acceptance_evidence: [],
      outcome: 'implemented',
      note: null,
    })).toThrow('EXECUTE_RESULT_CHANGE_DELTA_CONFLICT');
  });

  test('records a truthful blocked execution with failed and not-run planned results', () => {
    const root = confirmedSemanticRoot();
    const preflight = preflightStep(root, {
      candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
    });
    const blocked = recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: [],
      command_results: [{
        command: 'bun test test/vnext-runtime.test.ts',
        status: 'failed',
        observed_repo_writes: [],
        evidence_refs: ['test:evidence:command-failure'],
      }],
      validation_results: [{
        validation: 'bun test test/vnext-runtime.test.ts passes',
        status: 'not-run',
        evidence_refs: [],
      }],
      acceptance_evidence: [],
      outcome: 'blocked',
      note: 'planned command failed before validation could run',
    });
    expect(blocked).toMatchObject({
      status: 'success',
      state: { active_step_id: 'step-1', active_step_status: 'blocked' },
    });
    expect(readCanonicalCurrentTask(root).runtimeState.execution_log).toContainEqual(expect.objectContaining({
      step_id: 'step-1',
      status: 'blocked',
      execution_result: expect.objectContaining({
        outcome: 'blocked',
        change_set_id: expect.stringMatching(/^change-set-/),
        review_base: expect.objectContaining({ kind: 'runtime-file-manifest/v1' }),
        review_target: expect.objectContaining({ kind: 'runtime-file-manifest/v1' }),
        change_delta: expect.objectContaining({ kind: 'runtime-file-delta/v1', entries: [] }),
        actual_changed_paths: [],
        command_results: [expect.objectContaining({ status: 'failed' })],
        validation_results: [expect.objectContaining({ status: 'not-run', evidence_refs: [] })],
        acceptance_evidence: [],
        blocker: 'planned command failed before validation could run',
      }),
    }));
    expect(() => reviewContext(root, {})).toThrow('REVIEW_EXECUTION_NOT_IMPLEMENTED');

    const invalidRoot = confirmedSemanticRoot();
    const invalidPreflight = preflightStep(invalidRoot, {
      candidate_paths: [],
    });
    expect(() => recordStepResult(invalidRoot, {
      preflight_receipt: invalidPreflight.receipt,
      actual_changed_paths: [],
      command_results: [{
        command: 'bun test test/vnext-runtime.test.ts',
        status: 'passed',
        observed_repo_writes: [],
        evidence_refs: ['test:evidence:command'],
      }],
      validation_results: [{
        validation: 'bun test test/vnext-runtime.test.ts passes',
        status: 'not-run',
        evidence_refs: [],
      }],
      acceptance_evidence: [],
      outcome: 'implemented',
      note: null,
    })).toThrow('EXECUTE_RESULT_BLOCKED');
    expect(readCanonicalCurrentTask(invalidRoot).runtimeState.active_step_status).toBe('ready');
  });

  test('records a semantic step result and lets Runtime advance only after clean review', () => {
    const root = confirmedSemanticRoot();
    const preflight = preflightStep(root, {
      candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
    });
    for (const [relativePath, content] of [[
      'runtime/vnext/src/prepare-task-adapter.ts',
      'implemented adapter\n',
    ]] as const) {
      const filePath = path.join(root, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    }
    const recorded = recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
      command_results: [{
        command: 'bun test test/vnext-runtime.test.ts',
        status: 'passed',
        observed_repo_writes: [],
        evidence_refs: ['test:evidence:command'],
      }],
      validation_results: [{
        validation: 'bun test test/vnext-runtime.test.ts passes',
        status: 'passed',
        evidence_refs: ['test:evidence:validation'],
      }],
      acceptance_evidence: [reportFixture(root)],
      outcome: 'implemented',
      note: 'current step implemented',
    });
    expect(recorded).toMatchObject({
      status: 'success',
      advancement: { outcome: 'not-applicable' },
      state: { active_step_id: 'step-1', active_step_status: 'in-progress' },
    });
    expect(readCanonicalCurrentTask(root).runtimeState.execution_log).toContainEqual(expect.objectContaining({
      step_id: 'step-1',
      execution_result: expect.objectContaining({
        outcome: 'implemented',
        change_set_id: expect.stringMatching(/^change-set-/),
        review_base: expect.objectContaining({ kind: 'runtime-file-manifest/v1' }),
        review_target: expect.objectContaining({ kind: 'runtime-file-manifest/v1' }),
        change_delta: expect.objectContaining({
          kind: 'runtime-file-delta/v1',
          entries: [
            expect.objectContaining({ path: 'runtime/vnext/src/prepare-task-adapter.ts', before_state: 'absent', after_state: 'file' }),
          ],
        }),
        actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
        command_results: [expect.objectContaining({ command: 'bun test test/vnext-runtime.test.ts', status: 'passed' })],
        validation_results: [expect.objectContaining({ validation: 'bun test test/vnext-runtime.test.ts passes', status: 'passed' })],
        acceptance_evidence: [expect.objectContaining({ claim_id: 'A1', slot_id: 'a1' })],
        blocker: null,
      }),
    }));

    const context = reviewContext(root, {});
    expect(context.receipt).toMatchObject({ cycle_phase: 'discovery' });
    expect(context.recorded_execution).toMatchObject({
      change_set_id: expect.stringMatching(/^change-set-/),
      review_target_revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(context.recorded_execution.evidence_refs).toEqual(expect.arrayContaining([
      'test:evidence:command',
      'test:evidence:validation',
    ]));
    expect(context.recorded_execution.execution_result).toMatchObject({
      outcome: 'implemented',
      actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
      command_results: [{ command: 'bun test test/vnext-runtime.test.ts', status: 'passed' }],
      validation_results: [{ validation: 'bun test test/vnext-runtime.test.ts passes', status: 'passed' }],
      acceptance_evidence: [{ claim_id: 'A1', slot_id: 'a1' }],
      blocker: null,
    });
    const cleanReviewInput = {
      context_receipt: { ...context.receipt },
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['test:evidence:review'],
      blocker: null,
    } as const;
    expect(recordReviewResult(root, cleanReviewInput).status).toBe('success');
    const reviewedBytes = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
    expect(recordReviewResult(root, cleanReviewInput).status).toBe('no-op');
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(reviewedBytes);
    expect(readCanonicalCurrentTask(root).runtimeState.pending_review_result).toMatchObject({ verdict: 'clean' });
    expect(() => completeReviewedStep(root, {
      step_id: 'step-1',
      acceptance_evidence: [reportFixture(root)],
      note: 'attempt to add evidence after review',
    })).toThrow('EXECUTE_ADAPTER_INPUT_INVALID');
    const completionInput = {
      step_id: 'step-1',
      note: 'clean review committed',
    };
    const completed = completeReviewedStep(root, completionInput);
    expect(completed).toMatchObject({
      status: 'success',
      advancement: { outcome: 'task-complete', from_step_id: 'step-1' },
      state: { active_step_id: 'step-1', active_step_status: 'completed' },
    });
    expect(completeReviewedStep(root, completionInput).status).toBe('no-op');
    expect(() => reviewContext(root, {})).toThrow('REVIEW_EXECUTION_ALREADY_COMPLETED');
  });

  test('does not admit review for a successful step without a review checkpoint', () => {
    const claimEvidence = completeClaimEvidence();
    const root = makeRoot(makeRuntimeState({
      claim_evidence_required: true,
      claim_evidence: claimEvidence,
    }));
    const before = readCanonicalCurrentTask(root);
    const changeSetId = 'change-set-no-checkpoint';
    const reviewTarget = captureReviewTarget(root, []);
    const changeDelta = createReviewChangeDelta(reviewTarget, reviewTarget);
    const executionEvidence = ['test:evidence:no-checkpoint-execution'];
    const execution = createTaskStateProposal(before, {
      mode: 'default',
      status: 'completed',
      evidence_refs: executionEvidence,
      idempotency_key: 'execute-step-result-no-checkpoint',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      change_set_id: changeSetId,
      claim_evidence: claimEvidence,
      execution_result: {
        outcome: 'implemented',
        change_set_id: changeSetId,
        review_base: reviewTarget,
        review_target: reviewTarget,
        change_delta: changeDelta,
        actual_changed_paths: [],
        command_results: [],
        validation_results: [{
          validation: 'validate the no-checkpoint step',
          status: 'passed',
          evidence_refs: executionEvidence,
        }],
        acceptance_evidence: [],
        blocker: null,
      },
    });
    expect(applyVNextRuntimeProposal(root, execution)).toMatchObject({
      status: 'success',
      advancement: { outcome: 'task-complete', checkpoint: 'not-required' },
    });
    expect(() => reviewContext(root, {})).toThrow('REVIEW_CHECKPOINT_NOT_REQUIRED');

    const current = readCanonicalCurrentTask(root);
    const recorded = current.runtimeState.execution_log.find(item =>
      !('action' in item) && item.idempotency_key === 'execute-step-result-no-checkpoint',
    );
    if (!recorded || 'action' in recorded || !recorded.execution_result || !recorded.change_set_id) {
      throw new Error('test setup requires the recorded no-checkpoint execution');
    }
    const reviewEvidence = ['test:evidence:no-checkpoint-review'];
    const rawReview = createReviewResultProposal(current, {
      review_result: {
        kind: 'review-result/v1',
        review_id: 'review-no-checkpoint',
        execution_id: recorded.idempotency_key,
        step_id: recorded.step_id,
        cycle_id: current.runtimeState.review_cycle.id,
        cycle_phase: 'discovery',
        change_set_id: recorded.change_set_id,
        review_target_revision: recorded.execution_result.review_target.revision,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: reviewEvidence,
        blocker: null,
      },
      evidence_refs: reviewEvidence,
      idempotency_key: 'record-review-no-checkpoint',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(root, rawReview)).toMatchObject({
      status: 'blocked',
      code: 'REVIEW_CHECKPOINT_NOT_REQUIRED',
    });
  });

  test('rejects caller-supplied clean receipts and stale Runtime file-manifest targets', () => {
    const makeRecordedRoot = () => {
      const root = confirmedSemanticRoot();
      const productPath = path.join(root, 'runtime', 'vnext', 'src', 'prepare-task-adapter.ts');
      fs.mkdirSync(path.dirname(productPath), { recursive: true });
      fs.writeFileSync(productPath, 'before\n', 'utf8');
      const preflight = preflightStep(root, { candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'] });
      fs.writeFileSync(productPath, 'implemented\n', 'utf8');
      expect(recordStepResult(root, {
        preflight_receipt: preflight.receipt,
        actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
        command_results: [{
          command: 'bun test test/vnext-runtime.test.ts',
          status: 'passed',
          observed_repo_writes: [],
          evidence_refs: ['test:evidence:command'],
        }],
        validation_results: [{
          validation: 'bun test test/vnext-runtime.test.ts passes',
          status: 'passed',
          evidence_refs: ['test:evidence:validation'],
        }],
        acceptance_evidence: [],
        outcome: 'implemented',
        note: null,
      }).status).toBe('success');
      return { root, productPath };
    };

    const fabricated = makeRecordedRoot();
    expect(() => completeReviewedStep(fabricated.root, {
      step_id: 'step-1',
      note: null,
      review_receipt: {
        cycle_id: 'review-cycle-0',
        cycle_phase: 'discovery',
        change_set_id: 'caller-minted',
        review_target_revision: '0'.repeat(64),
        verdict: 'clean',
        admitted_fingerprints: [],
        evidence_refs: ['test:evidence:review'],
      },
    })).toThrow('EXECUTE_ADAPTER_INPUT_INVALID');

    const staleBeforeReview = makeRecordedRoot();
    const staleContext = reviewContext(staleBeforeReview.root, {});
    fs.writeFileSync(staleBeforeReview.productPath, 'changed-after-context\n', 'utf8');
    expect(() => recordReviewResult(staleBeforeReview.root, {
      context_receipt: staleContext.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['test:evidence:review'],
      blocker: null,
    })).toThrow('REVIEW_TARGET_STALE');

    const staleAfterReview = makeRecordedRoot();
    const cleanContext = reviewContext(staleAfterReview.root, {});
    expect(recordReviewResult(staleAfterReview.root, {
      context_receipt: cleanContext.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['test:evidence:review'],
      blocker: null,
    }).status).toBe('success');
    const evidenceBeforeCompletion = readCanonicalCurrentTask(staleAfterReview.root).runtimeState.claim_evidence;
    const reviewed = readCanonicalCurrentTask(staleAfterReview.root);
    const pending = reviewed.runtimeState.pending_review_result;
    if (!pending || pending.verdict !== 'clean' || !reviewed.runtimeState.claim_evidence) {
      throw new Error('test setup requires a canonical clean review and frozen claim evidence');
    }
    const reviewedExecution = reviewed.runtimeState.execution_log.find(item =>
      !('action' in item) && item.idempotency_key === pending.execution_id,
    );
    if (!reviewedExecution || 'action' in reviewedExecution || !reviewedExecution.execution_result) {
      throw new Error('test setup requires the execution bound to the clean review');
    }
    const lateExecutionEvidence = [...pending.evidence_refs, 'test:evidence:late-execution-acceptance'];
    const rawCompletionWithExecutionResult = createTaskStateProposal(reviewed, {
      mode: 'default',
      status: 'completed',
      evidence_refs: lateExecutionEvidence,
      idempotency_key: 'raw-reviewed-completion-with-execution-result',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      review_receipt: {
        cycle_id: pending.cycle_id,
        cycle_phase: pending.cycle_phase,
        change_set_id: pending.change_set_id,
        review_target_revision: pending.review_target_revision,
        verdict: 'clean',
        admitted_fingerprints: [],
        evidence_refs: [...pending.evidence_refs],
      },
      change_set_id: pending.change_set_id,
      claim_evidence: reviewed.runtimeState.claim_evidence,
      execution_result: {
        ...reviewedExecution.execution_result,
        acceptance_evidence: [{
          acceptance: 'The semantic adapter persists and reads back a canonical draft',
          evidence_refs: lateExecutionEvidence,
        }],
        blocker: null,
      },
    });
    expect(applyVNextRuntimeProposal(staleAfterReview.root, rawCompletionWithExecutionResult)).toMatchObject({
      status: 'blocked',
      code: 'REVIEWED_COMPLETION_EXECUTION_RESULT_FORBIDDEN',
    });
    expect(readCanonicalCurrentTask(staleAfterReview.root).runtimeState.claim_evidence).toEqual(evidenceBeforeCompletion);
    const injectedClaimEvidence = reviewed.runtimeState.claim_evidence.map(claim => ({
      ...claim,
      slots: claim.slots.map(slot => ({
        ...slot,
        disposition: 'newly-executed' as const,
        evidence_refs: ['test:evidence:late-acceptance'],
      })),
    }));
    const rawCompletion = createTaskStateProposal(reviewed, {
      mode: 'default',
      status: 'completed',
      evidence_refs: pending.evidence_refs,
      idempotency_key: 'raw-reviewed-completion-with-late-evidence',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'evidence-admission'),
      review_receipt: {
        cycle_id: pending.cycle_id,
        cycle_phase: pending.cycle_phase,
        change_set_id: pending.change_set_id,
        review_target_revision: pending.review_target_revision,
        verdict: 'clean',
        admitted_fingerprints: [],
        evidence_refs: [...pending.evidence_refs],
      },
      change_set_id: pending.change_set_id,
      claim_evidence: injectedClaimEvidence,
    });
    expect(applyVNextRuntimeProposal(staleAfterReview.root, rawCompletion)).toMatchObject({
      status: 'blocked',
      code: 'CLAIM_EVIDENCE_AFTER_REVIEW',
    });
    expect(readCanonicalCurrentTask(staleAfterReview.root).runtimeState.claim_evidence).toEqual(evidenceBeforeCompletion);
    fs.writeFileSync(staleAfterReview.productPath, 'changed-after-clean-review\n', 'utf8');
    expect(() => completeReviewedStep(staleAfterReview.root, {
      step_id: 'step-1',
      note: null,
    })).toThrow('REVIEW_TARGET_STALE');
  });

  test('hands multiple review findings across sessions through one bounded repair wave and verification', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft({
      mutation_scope: {
        allowed: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement and verify two Runtime files',
        mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
        commands: [{
          command: 'bun test test/vnext-runtime.test.ts',
          expected_repo_writes: 'none',
        }],
        validation: ['bun test test/vnext-runtime.test.ts passes'],
      }],
    }));
    const preflight = preflightStep(root, {
      candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
    });
    for (const [relativePath, content] of [
      ['runtime/vnext/src/prepare-task-adapter.ts', 'initial adapter\n'],
      ['runtime/vnext/src/kernel.ts', 'initial kernel\n'],
    ] as const) {
      const filePath = path.join(root, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    }
    expect(recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
      command_results: [{
        command: 'bun test test/vnext-runtime.test.ts',
        status: 'passed',
        observed_repo_writes: [],
        evidence_refs: ['test:evidence:first-command'],
      }],
      validation_results: [{
        validation: 'bun test test/vnext-runtime.test.ts passes',
        status: 'passed',
        evidence_refs: ['test:evidence:first-validation'],
      }],
      acceptance_evidence: [reportFixture(root)],
      outcome: 'implemented',
      note: null,
    }).status).toBe('success');

    const discovery = reviewContext(root, {});
    expect(recordReviewResult(root, {
      context_receipt: { ...discovery.receipt },
      verdict: 'findings',
      findings: [
        {
          category: 'correctness',
          file: 'runtime/vnext/src/prepare-task-adapter.ts',
          failure_condition: 'the semantic adapter loses the exact task identity',
          required_behavior: 'preserve the exact task identity',
          root_cause_status: 'confirmed',
          evidence_refs: ['test:evidence:finding-one'],
        },
        {
          category: 'validation',
          file: 'runtime/vnext/src/kernel.ts',
          failure_condition: 'the handoff has no durable witness',
          required_behavior: 'retain the cross-session handoff witness',
          root_cause_status: 'bounded',
          evidence_refs: ['test:evidence:finding-two'],
        },
      ],
      unresolved_fingerprints: [],
      evidence_refs: ['test:evidence:review-findings'],
      blocker: null,
    }).status).toBe('success');

    // A later execute invocation reads only canonical state; it does not need reviewer chat context.
    const repair = beginRepair(root, {
      candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
    });
    fs.writeFileSync(path.join(root, 'runtime', 'vnext', 'src', 'prepare-task-adapter.ts'), 'repaired adapter\n', 'utf8');
    fs.writeFileSync(path.join(root, 'runtime', 'vnext', 'src', 'kernel.ts'), 'repaired kernel\n', 'utf8');
    expect(repair.receipt.repair_fingerprints).toHaveLength(2);
    expect(recordStepResult(root, {
      preflight_receipt: repair.receipt,
      actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'runtime/vnext/src/kernel.ts'],
      command_results: [{
        command: 'bun test test/vnext-runtime.test.ts',
        status: 'passed',
        observed_repo_writes: [],
        evidence_refs: ['test:evidence:repair-command'],
      }],
      validation_results: [{
        validation: 'bun test test/vnext-runtime.test.ts passes',
        status: 'passed',
        evidence_refs: ['test:evidence:repair-validation'],
      }],
      acceptance_evidence: [],
      outcome: 'implemented',
      note: 'repair both admitted findings',
    }).status).toBe('success');
    const repaired = readCanonicalCurrentTask(root);
    expect(repaired.runtimeState.review_cycle.repair_round).toBe(1);
    expect(repaired.runtimeState.findings.every(item => item.last_repair_wave_id === repair.receipt.repair_wave_id)).toBe(true);

    const verification = reviewContext(root, {});
    expect(verification.receipt).toMatchObject({ cycle_phase: 'verification' });
    expect(verification.recorded_execution).toMatchObject({
      change_set_id: discovery.recorded_execution.change_set_id,
      review_target_revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(verification.receipt.admitted_fingerprints).toEqual(expect.arrayContaining(repair.receipt.repair_fingerprints));
    expect(recordReviewResult(root, {
      context_receipt: { ...verification.receipt },
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['test:evidence:clean-verification'],
      blocker: null,
    }).status).toBe('success');
    expect(completeReviewedStep(root, {
      step_id: 'step-1',
      note: 'verified repair',
    })).toMatchObject({
      status: 'success',
      advancement: { outcome: 'task-complete' },
    });
    const complete = readCanonicalCurrentTask(root);
    expect(complete.runtimeState.findings.every(item => item.status === 'resolved')).toBe(true);
    expect(complete.runtimeState.pending_review_result).toBeNull();
  });

  test('keeps repair behind the durable review handoff instead of caller-supplied preflight coordinates', () => {
    const root = confirmedSemanticRoot();
    const current = readCanonicalCurrentTask(root);
    const finding = admittedFinding('adapter-repair', current.runtimeState.review_cycle.id);
    if (finding.action !== 'admit') throw new Error('test setup requires an admitted finding');
    finding.finding.owner_task_id = current.runtimeState.task_id;
    const admitted = applyVNextRuntimeProposal(root, createFindingQueueProposal(current, {
      mode: 'repair',
      delta: finding,
      idempotency_key: 'adapter-repair-admit',
      authority_evidence: evidence('active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission'),
      evidence_refs: finding.finding.evidence_refs,
    }));
    expect(admitted.status).toBe('success');

    expect(() => preflightStep(root, {
      mode: 'repair',
      candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
      repair_fingerprint: 'adapter-repair',
      diff_target: 'adapter-repair-diff',
    })).toThrow('EXECUTE_ADAPTER_INPUT_INVALID');
  });

  test('rejects a persistent test that is absent from exact Allowed mutation scope', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const input = semanticDraft({
      mutation_scope: {
        allowed: ['runtime/vnext/src/prepare-task-adapter.ts'],
        conditional: [],
        forbidden: ['.git/**'],
      },
    });

    expect(() => prepareDraft(root, input)).toThrow('PERSISTENT_TEST_SCOPE_INVALID');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('closed');
  });

  test('rejects test-like mutation scope that is broader than Persistent Tests', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const input = semanticDraft({
      mutation_scope: {
        allowed: [
          'runtime/vnext/src/prepare-task-adapter.ts',
          'test/vnext-runtime.test.ts',
          'test/**',
        ],
        conditional: [],
        forbidden: ['.git/**'],
      },
    });

    expect(() => prepareDraft(root, input)).toThrow('PERSISTENT_TEST_SCOPE_INVALID');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('closed');
  });

  test('validates the prepared test strategy and its minimum planning invariants', () => {
    const missingRoot = archivedBaselineRoot();
    const { test_strategy: _omitted, ...withoutStrategy } = semanticDraft();
    expect(() => prepareDraft(missingRoot, withoutStrategy)).toThrow('PREPARE_ADAPTER_INPUT_INVALID');
    expect(readCanonicalCurrentTask(missingRoot).runtimeState.workflow_status).toBe('closed');

    const noTestsRoot = archivedBaselineRoot();
    expect(() => prepareDraft(noTestsRoot, semanticDraft({
      mutation_scope: {
        allowed: ['runtime/vnext/src/prepare-task-adapter.ts'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'implementation-only',
        description: 'Implement without the test required by the selected strategy',
        mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts'],
        commands: [],
        validation: ['inspect the implementation'],
      }],
      persistent_tests: 'none',
    }))).not.toThrow();

    const notApplicableRoot = archivedBaselineRoot();
    expect(() => prepareDraft(notApplicableRoot, semanticDraft({
      test_strategy: {
        mode: 'not-applicable',
        source: 'explicit-user',
        source_ref: 'test:original-request',
        task_classification: 'non-executable-change',
        rationale: 'The task changes no executable behavior.',
      },
    }))).toThrow('TEST_STRATEGY_INVALID');

    const orderingRoot = archivedBaselineRoot();
    expect(() => prepareDraft(orderingRoot, semanticDraft({
      implementation_steps: [{
        id: 'implementation-first-by-mistake',
        description: 'Modify product code before admitting the planned regression',
        mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts'],
        commands: [],
        validation: ['the focused Runtime tests will be run later'],
      }],
    }))).not.toThrow();

    const mixedFirstStepRoot = archivedBaselineRoot();
    expect(() => prepareDraft(mixedFirstStepRoot, semanticDraft({
      implementation_steps: [{
        id: 'mixed-test-and-product',
        description: 'Combine test authoring and product implementation',
        mutation_scope: ['test/vnext-runtime.test.ts', 'runtime/vnext/src/prepare-task-adapter.ts'],
        commands: [],
        validation: ['the mixed step is inspectable'],
      }],
    }))).not.toThrow();

    const forgedUserSourceRoot = archivedBaselineRoot();
    expect(() => prepareDraft(forgedUserSourceRoot, semanticDraft({
      test_strategy: {
        mode: 'flexible',
        source: 'explicit-user',
        source_ref: 'conversation:missing-user-decision',
        task_classification: 'contract-clear-behavior',
        rationale: 'This source coordinate is not present in Task Basis.',
      },
    }))).toThrow('TEST_STRATEGY_INVALID');

    const missingPolicyRoot = archivedBaselineRoot();
    expect(() => prepareDraft(missingPolicyRoot, semanticDraft({
      test_strategy: {
        mode: 'flexible',
        source: 'project-policy',
        source_ref: 'docs/missing-test-policy.md',
        task_classification: 'contract-clear-behavior',
        rationale: 'This policy file does not exist.',
      },
    }))).toThrow('TEST_STRATEGY_INVALID');

    const rawBypassRoot = archivedBaselineRoot();
    const rawCurrent = readCanonicalCurrentTask(rawBypassRoot);
    const rawBypass = createPrepareTaskDraftProposal(rawCurrent, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'strategy-bypass',
      document_id: 'doc-111111111111111111111111',
      task_title: 'Strategy bypass',
      draft_definition: draftDefinition({
        regression_checks: '- [ ] no canonical Test Strategy is present',
      }),
      active_step_id: 'step-1',
      claim_evidence: completeClaimEvidence(),
      evidence_refs: ['test:evidence:strategy-bypass'],
      idempotency_key: 'strategy-bypass-create',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(rawBypassRoot, rawBypass)).toMatchObject({
      status: 'blocked',
      code: 'TEST_STRATEGY_INVALID',
      committed: false,
    });
    expect(readCanonicalCurrentTask(rawBypassRoot).runtimeState.workflow_status).toBe('closed');

    const executableRoot = archivedBaselineRoot();
    expect(() => prepareDraft(executableRoot, notApplicableSemanticDraft({
      mutation_scope: {
        allowed: ['runtime/vnext/src/prepare-task-adapter.ts'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'change-runtime',
        description: 'Change executable Runtime behavior',
        mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts'],
        commands: [],
        validation: ['Inspect the Runtime behavior'],
      }],
    }))).toThrow('TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION');

    const mixedScopeRoot = archivedBaselineRoot();
    expect(() => prepareDraft(mixedScopeRoot, notApplicableSemanticDraft({
      mutation_scope: {
        allowed: ['README.md', 'runtime/vnext/src/kernel.ts'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'mixed-change',
        description: 'Change documentation and executable Runtime behavior together',
        mutation_scope: ['README.md', 'runtime/vnext/src/kernel.ts'],
        commands: [],
        validation: ['Inspect both changes'],
      }],
    }))).toThrow('TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION');

    const behaviorMarkdownRoot = archivedBaselineRoot();
    expect(() => prepareDraft(behaviorMarkdownRoot, notApplicableSemanticDraft({
      mutation_scope: {
        allowed: ['templates/vnext/skills/prepare-task.SKILL.md.tmpl'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'change-skill',
        description: 'Change generated Agent behavior through its skill template',
        mutation_scope: ['templates/vnext/skills/prepare-task.SKILL.md.tmpl'],
        commands: [],
        validation: ['Inspect the generated skill behavior'],
      }],
    }))).toThrow('TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION');

    const unclassifiedDocsRoot = archivedBaselineRoot();
    expect(() => prepareDraft(unclassifiedDocsRoot, notApplicableSemanticDraft({
      mutation_scope: {
        allowed: ['docs/other/notes.md'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'change-unclassified-docs',
        description: 'Change documentation outside the project-owned non-executable boundary',
        mutation_scope: ['docs/other/notes.md'],
        commands: [],
        validation: ['Inspect the documentation'],
      }],
    }))).toThrow('TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION');

    const missingClassificationRoot = archivedBaselineRoot();
    fs.writeFileSync(
      path.join(missingClassificationRoot, '.workflow-system', 'PROJECT_PROFILE.yaml'),
      'schema_version: 1\nproject:\n  name: runtime-fixture\n  type: test\npaths:\n  workflow_home: docs/workflow\n',
      'utf8',
    );
    expect(() => prepareDraft(missingClassificationRoot, notApplicableSemanticDraft()))
      .toThrow('TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN');

    const unsafePolicyPatterns = [
      '**',
      '*/**',
      '*/*/**',
      'docs*/**',
      'docs/*.md',
      'docs/**/guide.md',
    ];
    for (const [index, unsafePattern] of unsafePolicyPatterns.entries()) {
      const unsafePolicyRoot = archivedBaselineRoot();
      fs.writeFileSync(
        path.join(unsafePolicyRoot, '.workflow-system', 'PROJECT_PROFILE.yaml'),
        [
          'schema_version: 1',
          'project:',
          '  name: runtime-fixture',
          '  type: test',
          'paths:',
          '  workflow_home: docs/workflow',
          'boundaries:',
          '  non_executable_change_paths:',
          `    - ${JSON.stringify(unsafePattern)}`,
          '',
        ].join('\n'),
        'utf8',
      );
      expect(() => prepareDraft(unsafePolicyRoot, notApplicableSemanticDraft({
        mutation_scope: {
          allowed: ['runtime/vnext/src/kernel.ts'],
          conditional: [],
          forbidden: ['.git/**'],
        },
        implementation_steps: [{
          id: `unsafe-policy-${index + 1}`,
          description: 'Attempt to classify executable Runtime behavior as non-executable',
          mutation_scope: ['runtime/vnext/src/kernel.ts'],
          commands: [],
          validation: ['Inspect the Runtime behavior'],
        }],
      }))).toThrow('TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN');
    }

    const executableStrategyRoot = archivedBaselineRoot();
    fs.writeFileSync(
      path.join(executableStrategyRoot, '.workflow-system', 'PROJECT_PROFILE.yaml'),
      [
        'schema_version: 1',
        'project:',
        '  name: runtime-fixture',
        '  type: test',
        'paths:',
        '  workflow_home: docs/workflow',
        'boundaries:',
        '  non_executable_change_paths:',
        '    - "*/**"',
        '',
      ].join('\n'),
      'utf8',
    );
    expect(prepareDraft(executableStrategyRoot, singleStepSemanticDraft()))
      .toMatchObject({ status: 'success' });

    const rawExecutableRoot = archivedBaselineRoot();
    const rawExecutableCurrent = readCanonicalCurrentTask(rawExecutableRoot);
    const rawExecutableBypass = createPrepareTaskDraftProposal(rawExecutableCurrent, {
      action: 'create-draft',
      task_id: '001',
      task_slug: 'non-executable-bypass',
      document_id: 'doc-222222222222222222222222',
      task_title: 'Non-executable bypass',
      draft_definition: draftDefinition({
        allowed_scope: '- `runtime/vnext/src/kernel.ts`',
        conditional_scope: '- none',
        implementation_steps: [
          '- step-1: change executable Runtime behavior',
          '  - purpose: change executable Runtime behavior',
          '  - mutation_scope: runtime/vnext/src/kernel.ts',
          '  - required_evidence: test:evidence:step-1',
          '  - review_checkpoint: not-required: final-exemption: isolated state-only fixture has no product diff',
        ].join('\n'),
        regression_checks: [
          '### Test Strategy',
          '',
          '- mode: not-applicable',
          '- source: project-policy',
          '- source_ref: .workflow-system/PROJECT_PROFILE.yaml',
          '- task_classification: non-executable-change',
          '- rationale: This raw proposal attempts to bypass the semantic adapter.',
          '',
          '### Validation Plan',
          '',
          '- [ ] inspect the Runtime behavior',
          '',
          '### Persistent Tests',
          '',
          '- none',
        ].join('\n'),
      }),
      active_step_id: 'step-1',
      claim_evidence: completeClaimEvidence(),
      evidence_refs: ['test:evidence:non-executable-bypass'],
      idempotency_key: 'non-executable-bypass-create',
      authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
    });
    expect(applyVNextRuntimeProposal(rawExecutableRoot, rawExecutableBypass)).toMatchObject({
      status: 'blocked',
      code: 'TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION',
      committed: false,
    });

    const documentationRoot = archivedBaselineRoot();
    const documentationDraft = notApplicableSemanticDraft();
    expect(prepareDraft(documentationRoot, documentationDraft).status).toBe('success');
    expect(readCanonicalCurrentTask(documentationRoot).body).toContain('- mode: not-applicable');

    const documentationGlobRoot = archivedBaselineRoot();
    expect(prepareDraft(documentationGlobRoot, notApplicableSemanticDraft({
      mutation_scope: {
        allowed: ['docs/product/**'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'update-product-docs',
        description: 'Update product documentation',
        mutation_scope: ['docs/product/**'],
        commands: [],
        validation: ['Review the product documentation'],
      }],
    }))).toMatchObject({ status: 'success' });

    const confirmationRoot = archivedBaselineRoot();
    const preparedDocumentation = prepareDraft(confirmationRoot, notApplicableSemanticDraft());
    fs.writeFileSync(
      path.join(confirmationRoot, '.workflow-system', 'PROJECT_PROFILE.yaml'),
      [
        'schema_version: 1',
        'project:',
        '  name: runtime-fixture',
        '  type: test',
        'paths:',
        '  workflow_home: docs/workflow',
        'boundaries:',
        '  non_executable_change_paths:',
        '    - docs/product/**',
        '',
      ].join('\n'),
      'utf8',
    );
    expect(confirmDraft(confirmationRoot, {
      confirmation_receipt: preparedDocumentation.confirmation_receipt!,
    })).toMatchObject({
      status: 'blocked',
      code: 'TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION',
      committed: false,
    });
  });

  test('preserves unresolved design choices and blocks confirmation until they are decided', () => {
    const root = archivedBaselineRoot();
    const prepared = prepareDraft(root, semanticDraft({
      design_decisions: {
        decided: ['Use the existing Runtime adapter boundary'],
        unresolved: ['Choose the externally observable default when the request does not specify one'],
      },
    }));
    const current = readCanonicalCurrentTask(root);
    expect(current.body).toContain('Use the existing Runtime adapter boundary');
    expect(current.body).toContain('Choose the externally observable default');
    const beforeConfirm = fs.readFileSync(current.filePath, 'utf8');
    expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt! })).toMatchObject({
      status: 'blocked',
      code: 'DRAFT_DECISION_UNRESOLVED',
      committed: false,
    });
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(beforeConfirm);

    const refined = prepareDraft(root, semanticDraft({
      design_decisions: {
        decided: [
          'Use the existing Runtime adapter boundary',
          'The user selected the externally observable default',
        ],
        unresolved: [],
      },
    }));
    expect(confirmDraft(root, { confirmation_receipt: refined.confirmation_receipt! }).status).toBe('success');
  });

  test('preflights declared step command write footprints before committing a draft', () => {
    const root = archivedBaselineRoot();
    const toolchainStep = {
      id: 'toolchain',
      description: 'Install the declared toolchain',
      mutation_scope: ['package.json', 'package-lock.json', 'node_modules/**'],
      commands: [{
        command: 'npm install',
        expected_repo_writes: ['package-lock.json', 'node_modules/**'],
      }],
      validation: ['npm install completes with the declared lockfile'],
    };
    const blocked = semanticDraft({
      test_strategy: {
        mode: 'flexible',
        source: 'inferred-default',
        source_ref: 'prepare-task-default',
        task_classification: 'exploratory-or-infrastructure',
        rationale: 'The install footprint must be established before its stable validation is authored.',
      },
      mutation_scope: {
        allowed: ['package.json', 'package-lock.json'],
        conditional: [{ path: 'node_modules/**', condition: 'when npm install is required' }],
        forbidden: ['.git/**'],
      },
      implementation_steps: [toolchainStep],
      persistent_tests: 'none',
    });
    expect(() => prepareDraft(root, blocked)).toThrow('COMMAND_FOOTPRINT_BLOCKED');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('closed');

    const forbiddenRoot = archivedBaselineRoot();
    const forbiddenWrite = semanticDraft({
      test_strategy: {
        mode: 'flexible',
        source: 'inferred-default',
        source_ref: 'prepare-task-default',
        task_classification: 'exploratory-or-infrastructure',
        rationale: 'The runtime write footprint is discovered before persistent validation.',
      },
      mutation_scope: {
        allowed: ['src/app.ts'],
        conditional: [],
        forbidden: ['.git/**', 'data/**'],
      },
      implementation_steps: [{
        id: 'smoke',
        description: 'Run the application smoke check',
        mutation_scope: ['src/app.ts'],
        commands: [{
          command: 'node src/app.ts',
          expected_repo_writes: ['data/fixflow.sqlite'],
        }],
        validation: ['the application smoke check starts successfully'],
      }],
      persistent_tests: 'none',
    });
    expect(() => prepareDraft(forbiddenRoot, forbiddenWrite)).toThrow('COMMAND_FOOTPRINT_BLOCKED');
    expect(readCanonicalCurrentTask(forbiddenRoot).runtimeState.workflow_status).toBe('closed');

    const stepScopeRoot = archivedBaselineRoot();
    const outsideStepScope = semanticDraft({
      test_strategy: {
        mode: 'flexible',
        source: 'inferred-default',
        source_ref: 'prepare-task-default',
        task_classification: 'exploratory-or-infrastructure',
        rationale: 'The runtime write footprint is discovered before persistent validation.',
      },
      mutation_scope: {
        allowed: ['src/app.ts', 'data/fixflow.sqlite'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [{
        id: 'smoke',
        description: 'Run the application smoke check',
        mutation_scope: ['src/app.ts'],
        commands: [{
          command: 'node src/app.ts',
          expected_repo_writes: ['data/fixflow.sqlite'],
        }],
        validation: ['the application smoke check starts successfully'],
      }],
      persistent_tests: 'none',
    });
    expect(() => prepareDraft(stepScopeRoot, outsideStepScope)).toThrow('COMMAND_FOOTPRINT_BLOCKED');
    expect(readCanonicalCurrentTask(stepScopeRoot).runtimeState.workflow_status).toBe('closed');

    const admitted = semanticDraft({
      test_strategy: {
        mode: 'flexible',
        source: 'inferred-default',
        source_ref: 'prepare-task-default',
        task_classification: 'exploratory-or-infrastructure',
        rationale: 'The install footprint must be established before its stable validation is authored.',
      },
      mutation_scope: {
        allowed: ['package.json', 'package-lock.json', 'node_modules/**'],
        conditional: [],
        forbidden: ['.git/**'],
      },
      implementation_steps: [toolchainStep],
      persistent_tests: 'none',
    });
    expect(prepareDraft(root, admitted).status).toBe('success');
  });

  test('wraps resume review and replan without public proposal fields', () => {
    const resumeRoot = makeRoot(makeRuntimeState({
      resume_requires_review: true,
      resume_review_reasons: ['manual_review_pending'],
    }));
    const resumeCurrent = readCanonicalCurrentTask(resumeRoot);
    const readinessReceipt = {
      kind: 'resume-readiness/v1' as const,
      task_id: resumeCurrent.runtimeState.task_id,
      document_id: resumeCurrent.sourceTuple.document_id,
      source_revision: resumeCurrent.sourceTuple.revision,
      reviewed_reasons: [...resumeCurrent.runtimeState.resume_review_reasons],
      evidence_refs: ['review:resume-readiness:001'],
    };
    const resumeBytes = fs.readFileSync(resumeCurrent.filePath, 'utf8');
    const missingCallerAuthority = applyVNextRuntimeProposal(resumeRoot, createPrepareTaskResumeReviewProposal(resumeCurrent, {
      mode: 'default',
      evidence_refs: readinessReceipt.evidence_refs,
      idempotency_key: 'resume-review-missing-caller-authority',
      authority_evidence: evidence('active-task-owner', 'resume-review', 'evidence-admission'),
    }));
    expect(missingCallerAuthority).toMatchObject({ status: 'blocked', code: 'RUNTIME_AUTHORITY_MISSING' });
    expect(fs.readFileSync(resumeCurrent.filePath, 'utf8')).toBe(resumeBytes);
    expect(() => clearResumeReview(resumeRoot, {
      readiness_receipt: { ...readinessReceipt, source_revision: 'f'.repeat(64) },
    })).toThrow('RESUME_READINESS_REVISION_CONFLICT');
    expect(fs.readFileSync(resumeCurrent.filePath, 'utf8')).toBe(resumeBytes);

    const cleared = clearResumeReview(resumeRoot, { readiness_receipt: readinessReceipt });
    expect(cleared.status).toBe('success');
    expect(readCanonicalCurrentTask(resumeRoot).runtimeState.resume_requires_review).toBe(false);
    const clearedBytes = fs.readFileSync(resumeCurrent.filePath, 'utf8');
    expect(clearResumeReview(resumeRoot, { readiness_receipt: readinessReceipt }).status).toBe('no-op');
    expect(fs.readFileSync(resumeCurrent.filePath, 'utf8')).toBe(clearedBytes);

    const activeReplanRoot = makeRoot();
    const activeBytes = fs.readFileSync(readCanonicalCurrentTask(activeReplanRoot).filePath, 'utf8');
    expect(() => replan(activeReplanRoot, semanticDraft())).toThrow('REPLAN_INVALIDATION_REQUIRED');
    expect(fs.readFileSync(readCanonicalCurrentTask(activeReplanRoot).filePath, 'utf8')).toBe(activeBytes);

    const replanRoot = makeRoot(makeRuntimeState({
      workflow_status: 'superseded',
      lifecycle_state: 'active',
    }));
    const replanned = replan(replanRoot, semanticDraft());
    expect(replanned).toMatchObject({ status: 'success' });
    const current = readCanonicalCurrentTask(replanRoot);
    expect(current.runtimeState.workflow_status).toBe('active');
    expect(current.runtimeState.active_step_id).toBe('step-1');
    expect(current.body).toContain('Add the prepare-task Runtime adapter');
    const replannedBytes = fs.readFileSync(current.filePath, 'utf8');
    expect(replan(replanRoot, semanticDraft()).status).toBe('no-op');
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(replannedBytes);
  });

  test('keeps migration and replan convergence actions internal to Runtime owners', () => {
    const contract = parse(fs.readFileSync(path.join(ROOT, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml'), 'utf8')) as {
      proposal: {
        execute_step: { semantic_adapter: {
          commands: string[];
          scope_enforcement: string;
          completion_evidence_source: string;
          change_detection: string;
          advancement_owner: string;
          post_completion_commit_owner: string;
          post_completion_route: string;
          test_strategy_execution: {
            phase_source: string;
            legacy_behavior: string;
            test_first: Record<string, string>;
            red_evidence: {
              result_status: string;
              kind: string;
              companion_statuses: string[];
              forbidden_statuses: string[];
              acceptance_evidence: string;
              unexpected_failure_outcome: string;
              review_checkpoint: string;
            };
            non_red_outcome: string;
          };
        } };
        review_change: { semantic_adapter: { reviewable_execution: string; review_target: string } };
         prepare_task: { semantic_adapter: {
           decision_partition: { decided: string; unresolved: string };
           command_footprint_preflight: { source: string; fields: string[]; evaluator: string; timing: string };
           test_strategy: {
             storage: string;
             fields: string[];
             modes: string[];
             sources: string[];
             classifications: string[];
             source_binding: Record<string, string>;
             precedence: string[];
             ambiguity: string;
             frozen_by: string;
             change_after_confirm: string;
             enforcement: string;
             ordering_enforcement: string;
             non_executable_scope: {
               policy_source: string;
               required_for: string;
               evaluated_surfaces: string[];
               policy_pattern_grammar: string;
               relation: string;
               missing_or_ambiguous: string;
               historical_active_tasks: string;
               error_codes: string[];
             };
           };
           internal_action_owners: Record<string, string>;
         } };
      };
    };
    expect(contract.proposal.execute_step.semantic_adapter.commands).toEqual([
      'preflight-step',
      'evidence-context',
      'retry-step',
      'begin-repair',
      'record-step-result',
      'complete-reviewed-step',
    ]);
    expect(contract.proposal.execute_step.semantic_adapter.scope_enforcement).toBe('task-and-current-step');
    expect(contract.proposal.execute_step.semantic_adapter.completion_evidence_source).toBe('recorded-step-result-only');
    expect(contract.proposal.execute_step.semantic_adapter.change_detection).toBe('runtime-preflight-candidate-before-after-delta');
    expect(contract.proposal.execute_step.semantic_adapter.advancement_owner).toBe('runtime');
    expect(contract.proposal.execute_step.semantic_adapter.post_completion_commit_owner).toBe('user-or-explicit-outer-orchestrator');
    expect(contract.proposal.execute_step.semantic_adapter.post_completion_route).toBe('git-commit');
    expect(contract.proposal.execute_step.semantic_adapter.test_strategy_execution).toEqual({
      phase_source: 'versioned-frozen-test-strategy',
      legacy_behavior: 'read-history-block-unversioned-execution',
      test_first: {
        first_step_phase: 'test-first',
        later_step_phase: 'test-first',
        first_step_outcome: 'implemented',
        later_step_outcome: 'implemented',
        advancement_gate: 'runtime-consumed-bound-prerequisite-evidence',
      },
      red_evidence: {
        result_status: 'expected-failure',
        kind: 'behavior-not-implemented',
        companion_statuses: ['passed'],
        forbidden_statuses: ['failed', 'blocked', 'not-run'],
        acceptance_evidence: 'forbidden',
        unexpected_failure_outcome: 'blocked',
        review_checkpoint: 'required',
      },
      non_red_outcome: 'implemented-with-passed-results-or-bound-reproduction',
    });
    expect(contract.proposal.review_change.semantic_adapter.reviewable_execution).toBe('implemented-or-test-red-awaiting-required-checkpoint-or-repair-verification');
    expect(contract.proposal.review_change.semantic_adapter.review_target).toBe('runtime-cumulative-before-after-file-delta');
    expect(contract.proposal.prepare_task.semantic_adapter.decision_partition).toEqual({
      decided: 'confirmed_decisions',
      unresolved: 'open_questions',
    });
    expect(contract.proposal.prepare_task.semantic_adapter.command_footprint_preflight).toEqual({
      source: 'implementation_steps[].commands',
      fields: ['command', 'expected_repo_writes'],
      evaluator: 'shared-mutation-scope-evaluator',
      timing: 'before-draft-commit',
    });
    expect(contract.proposal.prepare_task.semantic_adapter.test_strategy).toEqual({
      storage: 'current-task-regression-checks/test-strategy',
      fields: ['mode', 'source', 'source_ref', 'task_classification', 'rationale'],
      modes: ['flexible', 'test-first', 'implementation-first', 'not-applicable'],
      sources: ['explicit-user', 'project-policy', 'inferred-default'],
      classifications: [
        'contract-clear-behavior',
        'exploratory-or-infrastructure',
        'non-executable-change',
      ],
      source_binding: {
        'explicit-user': 'exact-task-basis-source-coordinate',
        'project-policy': 'existing-project-policy-file',
        'inferred-default': 'prepare-task-default',
      },
      precedence: ['explicit-user', 'project-policy', 'inferred-default'],
      ambiguity: 'resolve-as-open-question-before-draft-commit',
      frozen_by: 'confirm-draft',
      change_after_confirm: 'replan-only',
      enforcement: 'create-update-confirm-and-replan',
      ordering_enforcement: 'runtime-consumed-before-step-slots',
      non_executable_scope: {
        policy_source: '.workflow-system/PROJECT_PROFILE.yaml#boundaries.non_executable_change_paths',
        required_for: 'not-applicable',
        evaluated_surfaces: [
          'task-allowed-scope',
          'task-conditional-scope',
          'implementation-step-mutation-scope',
        ],
        policy_pattern_grammar: 'exact-path-or-literal-directory-prefix-globstar',
        relation: 'exact-or-proven-subset',
        missing_or_ambiguous: 'block-not-applicable-only',
        historical_active_tasks: 'not-revalidated',
        error_codes: [
          'TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN',
          'TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION',
        ],
      },
    });
    expect(contract.proposal.prepare_task.semantic_adapter.internal_action_owners).toEqual({
      'migrate-claim-evidence': 'runtime-compatibility',
      'mark-replan-blocked': 'runtime-convergence',
      'clear-replan-block': 'runtime-convergence',
    });
  });

  test('accepts semantic prepare input on stdin and rejects project-local proposal files', () => {
    const root = makeRoot(makeRuntimeState({
      task_id: '000',
      task_slug: 'bootstrap-baseline',
      workflow_status: 'closed',
      lifecycle_state: 'archived',
      active_step_status: 'completed',
    }));
    const cli = path.join(ROOT, 'runtime', 'vnext', 'dist', 'cli.js');
    const result = spawnSync('node', [cli, 'prepare-draft', '--root', root], {
      cwd: ROOT,
      input: JSON.stringify(semanticDraft()),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'success',
      committed: true,
      read_back_verified: true,
    });
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('draft');

    const insideProposal = path.join(root, 'prepare-task-proposal.json');
    fs.writeFileSync(insideProposal, '{}', 'utf8');
    expect(() => resolveExternalProposalFile(root, insideProposal)).toThrow('PROPOSAL_FILE_INSIDE_PROJECT');
    const outsideProposal = path.join(os.tmpdir(), 'prepare-task-proposal.json');
    expect(resolveExternalProposalFile(root, outsideProposal)).toBe(path.resolve(outsideProposal));
  });
});
