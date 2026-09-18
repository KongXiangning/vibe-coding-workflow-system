import { readProjectDocuments } from '../runtime/vnext/src/project-documents';
import { reviewRead } from '../runtime/vnext/src/review-change-adapter';
import { installDistribution, upgradeDistribution } from '../scripts/vibe-governance-distribution';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';
import { prepareSuccessor, semanticDraftDefinition } from '../runtime/vnext/src/prepare-task-adapter';
import { commitSupersedeWithHistory, commitTaskEvolutionWithHistory, recoverTaskEvolution, taskHistoryLocation } from '../runtime/vnext/src/task-evolution-io';
import { commitTaskStorageMigration } from '../runtime/vnext/src/task-store';
import { reviewPreimageBlobPath } from '../runtime/vnext/src/review-preimage-store';
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
  recordUserEvidenceDecision,
  replaceValidation,
  predecessorObligationKeys,
  successorSnapshotPath,
  evaluateClaimEvidence,
  evaluateEvidenceSlotForContext,
  assertEvidencePlan,
  applicableResultWaiver,
  evidenceContext,
  readDraftDefinitionFromBody,
  createReviewChangeDelta,
  confirmDraft,
  prepareCorrectionReplan,
  confirmCorrectionReplan,
  discardCorrectionReplan,
  discardScopeAmendment,
  prepareScopeAmendment,
  initializeTaskPreservation,
  recordEvidenceChallenge,
  dismissEvidenceChallenge,
  assertOrdinaryPreflight,
  completeReviewedStep,
  beginRepair,
  prepareDraft,
  preflightStep,
  extendPreflight,
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
  type KnowledgeAdmissionBundle,
  type KnowledgeAdmissionRecord,
  type KnowledgeCandidate,
  type ReplanReplacementDefinition,
  type ReplanTaskStateAction,
  type RuntimeProposal,
  type RuntimeState,
  type TaskBasis,
  type ProjectStatusDelta,
  type PrepareTaskSemanticDraft,
} from '../scripts/vnext-runtime';
import { fingerprintKnowledgeStatement } from '../scripts/project-context-resolver';
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
const STATUS_RECONCILIATION_BEGIN = '<!-- BEGIN vNext close-task STATUS reconciliation -->';
const temporaryRoots: string[] = [];

function makeRuntimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    business_evidence_version: 1,
    task_evolution_version: 2,
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
  // These represent already confirmed historical reports, not newly admitted checks.
  for (const record of result) for (const slot of record.slots) delete slot.check.selection;
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

function legacyMigrationRoot(state: RuntimeState = makeRuntimeState()): string {
  const root = makeRoot(state);
  const current = readCanonicalCurrentTask(root);
  fs.writeFileSync(current.filePath, fs.readFileSync(current.filePath, 'utf8').replace(
    `- ${state.active_step_id}: implement runtime`,
    [`- ${state.active_step_id}: implement runtime`, '  - purpose: preserve original validation',
      '  - mutation_scope: runtime/**', '  - required_evidence: original validation result', '  - review_checkpoint: required: original step evidence',
      '  - planned_command: bun test test/vnext-runtime.test.ts',
      '- legacy-other: existing other step', '  - purpose: preserve other validation',
      '  - mutation_scope: runtime/**', '  - required_evidence: other validation result', '  - review_checkpoint: required: other step evidence',
      '  - planned_command: bun test test/other.test.ts'].join('\n'),
  ));
  return root;
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
      '  - planned_command: bun test test/vnext-runtime.test.ts',
      '    - expected_repo_writes: none',
      '    - transformation_kind: localized',
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
      '  - planned_command: bun test test/vnext-runtime.test.ts',
      '    - expected_repo_writes: none',
      '    - transformation_kind: localized',
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
  return claims.map(claim => ({ ...claim, requirement: acceptance, slots: claim.slots.map(slot => ({ ...slot, check: { ...slot.check!, boundary: 'local' as const, selection: evidencePlanFixture(acceptance)[0]!.slots[0]!.check!.selection }, due_step_id: first, disposition: 'missing' as const, evidence_refs: [], report: null })) }));
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
  return [{ claim_id: 'A1', claim_kind: 'acceptance', requirement, source_ref: 'test:original-request', slots: [{ slot_id: 'a1', minimum_type: 'focused-test', disposition: 'missing', evidence_refs: [], due_step_id: step, applicability: 'current', check: { check_id: 'K1', method: 'execution', boundary: 'local', entry: 'bun test test/vnext-runtime.test.ts', expected_observation: requirement, required_boundaries: ['Runtime transaction'], allowed_substitutes: ['isolated filesystem fixture'], subject_paths: ['src/login.ts'], expected_result: 'passed', selection: { granularity: 'focused', selector: 'test/vnext-runtime.test.ts', invocation: { argv: ['bun', 'test', 'test/vnext-runtime.test.ts'], selector_arg_index: 2 }, selection_reason: 'The isolated Runtime fixture directly observes this local adapter claim.', breadth_reason: null, breadth_basis: null, breadth_source_ref: null } }, report: null }] }];
}

function reportFixture(root: string, claimId = 'A1', slotId = 'a1', status?: string) {
  const current = readCanonicalCurrentTask(root);
  const slot = current.runtimeState.claim_evidence!.find(claim => claim.claim_id === claimId)!.slots.find(slot => slot.slot_id === slotId)!;
  status ??= slot.check!.method === 'static' ? 'accepted' : 'passed';
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

function enableV2MutationAuthority(root: string): void {
  const profilePath = path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml');
  const profile = parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
  profile.mutation_authority = {
    domains: [
      { id: 'node-rollout', roots: ['packages/node-rollout/**'] },
      { id: 'node-rollout-tests', roots: ['packages/node-rollout-tests/**'] },
      { id: 'rust-rollout', roots: ['native/codex-rollout-collector/**'] },
    ],
  };
  fs.writeFileSync(profilePath, stringify(profile), 'utf8');
}

function rewriteV2MutationAuthorityProfile(root: string, domains: Array<{ id: string; roots: string[] }>): void {
  const profilePath = path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml');
  const profile = parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
  profile.mutation_authority = { domains };
  fs.writeFileSync(profilePath, stringify(profile), 'utf8');
}

function v2MutationAuthoritySemanticDraft(overrides: Partial<PrepareTaskSemanticDraft> = {}): PrepareTaskSemanticDraft {
  const base = singleStepSemanticDraft({
    implementation_steps: [{
      id: 'step-1',
      description: 'Implement the Node rollout behavior',
      planned_mutation_targets: [
        'packages/node-rollout/src/session.ts',
        'packages/node-rollout/src/reconnect.ts',
      ],
      commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }],
      validation: ['bun test test/vnext-runtime.test.ts passes'],
      review_checkpoint: { policy: 'required', reason: 'Review the cumulative implementation diff' },
    }],
    ...overrides,
    mutation_authority_version: 2,
    mutation_authority: {
      domains: ['node-rollout', 'node-rollout-tests'],
      exact_exceptions: [],
      forbidden: [],
    },
  });
  delete base.mutation_scope;
  // Authority-only fixtures with no planned test command use static evidence;
  // they must not silently retain K1's unrelated default execution command.
  for (const claim of base.claim_evidence) for (const slot of claim.slots) {
    const step = base.implementation_steps.find(item => item.id === slot.due_step_id);
    if (slot.check?.method === 'execution' && step && !step.commands.some(item => item.command === slot.check!.entry)) {
      slot.minimum_type = 'static-inspection';
      slot.check.method = 'static'; slot.check.expected_result = 'accepted';
      slot.check.entry = 'Inspect the bound authority fixture'; delete slot.check.selection;
    }
  }
  return base;
}

function v2ConfirmedRoot(input: Partial<PrepareTaskSemanticDraft> = {}): string {
  const root = archivedBaselineRoot();
  enableV2MutationAuthority(root);
  const prepared = prepareDraft(root, v2MutationAuthoritySemanticDraft(input));
  if (!prepared.confirmation_receipt) throw new Error('v2 test setup did not receive a draft confirmation receipt');
  const confirmed = confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt });
  if (confirmed.status !== 'success') throw new Error(`v2 test setup could not confirm draft: ${confirmed.message}`);
  return root;
}

function v2TwoStepConfirmedRoot(firstCheckpoint: 'required' | 'not-required' = 'required'): string {
  const stepTwoTargets = firstCheckpoint === 'not-required'
    ? ['packages/node-rollout/src/session.ts', 'packages/node-rollout/src/reconnect.ts']
    : ['packages/node-rollout/src/reconnect.ts'];
  return v2ConfirmedRoot({
    claim_evidence: evidencePlanFixture('Complete the first Node rollout step', 'step-1'),
    implementation_steps: [{
      id: 'step-1',
      description: 'Implement the first Node rollout step',
      planned_mutation_targets: ['packages/node-rollout/src/session.ts'],
      commands: [],
      validation: ['The first Node rollout step is recorded'],
      review_checkpoint: { policy: firstCheckpoint, reason: firstCheckpoint === 'required' ? 'Review the first step' : 'The first step is low risk and needs no ordinary checkpoint' },
    }, {
      id: 'step-2',
      description: 'Implement the second Node rollout step',
      planned_mutation_targets: stepTwoTargets,
      commands: [],
      validation: ['The second Node rollout step is recorded'],
      review_checkpoint: { policy: 'required', reason: 'Review the second step' },
    }],
  });
}

function installFixedTgzRuntime(target: string, label: string): string {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vnext-${label}-package-`));
  const packDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `vnext-${label}-tgz-`));
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), `vnext-${label}-consumer-`));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  temporaryRoots.push(packageRoot, packDirectory, consumer);
  buildVibeGovernanceDistribution({ outputRoot: packageRoot });
  const packed = spawnSync(npm, ['pack', '--ignore-scripts', '--no-audit', '--no-fund', '--pack-destination', packDirectory], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (packed.status !== 0) throw new Error(`fixed tgz pack failed: ${packed.stderr}`);
  const tgz = fs.readdirSync(packDirectory).find(name => name.endsWith('.tgz'));
  if (!tgz) throw new Error('fixed tgz pack did not produce an archive.');
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: `${label}-consumer`, private: true }) + '\n', 'utf8');
  const installed = spawnSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(packDirectory, tgz)], {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (installed.status !== 0) throw new Error(`fixed tgz install failed: ${installed.stderr}`);
  const distributionCli = path.join(consumer, 'node_modules', 'vibe-governance', 'dist', 'cli.js');
  const install = spawnSync('node', [distributionCli, 'install', '--root', target, '--json'], {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (install.status !== 0) throw new Error(`fixed tgz Runtime install failed: ${install.stderr}`);
  return path.join(target, '.workflow-system', 'runtime', 'dist', 'cli.js');
}

function runInstalledRuntimeCli(runtimeCli: string, root: string, command: string, input?: unknown) {
  const result = spawnSync('node', [runtimeCli, command, '--root', root], {
    cwd: root,
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ...result,
    json: result.stdout.trim() ? JSON.parse(result.stdout) as Record<string, any> : null,
  };
}

function installedAcceptanceEvidence(context: Record<string, any>): Record<string, any>[] {
  const check = context.checks[0];
  return [{
    claim_id: check.claim_id,
    slot_id: check.slot_id,
    check_id: check.check_id,
    minimum_type: check.minimum_type,
    disposition: 'newly-executed',
    evidence_refs: ['evidence-report.txt'],
    report: {
      result_id: `result-${check.check_id}`,
      status: 'passed',
      evidence_plan_revision: context.evidence_plan_revision,
      subject_revision: check.subject_revision,
      actual_method: 'execution',
      environment: 'installed fixed tgz Node CLI fixture',
      assurance: 'caller-reported',
    },
  }];
}

function installedReviewAssessment(): Record<string, any> {
  return {
    applicable: true,
    reason: 'The installed CLI review covers the cumulative Runtime file manifest.',
    evidence_refs: ['evidence-report.txt'],
    necessity: 'Dynamic footprint expansion requires a fresh cumulative review.',
    oracle: 'The review oracle is the Runtime-recorded before/after file delta and the frozen acceptance check.',
    boundary: 'The fixed tgz CLI is exercised in an isolated target project.',
    reuse: 'Reuse the same installed CLI review context and claim evidence.',
    applicability: 'The current task has an implementation result and an explicit review checkpoint.',
  };
}

function notApplicableSemanticDraft(overrides: Partial<PrepareTaskSemanticDraft> = {}): PrepareTaskSemanticDraft {
  const draft = semanticDraft({
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
  if (overrides.claim_evidence === undefined) for (const claim of draft.claim_evidence) for (const slot of claim.slots) {
    slot.check!.method = 'static'; slot.check!.expected_result = 'accepted'; slot.check!.entry = 'Review the documentation';
    delete slot.check!.selection;
  }
  return draft;
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

function useLegacyInlineCurrent(root: string): void {
  const current = readCanonicalCurrentTask(root);
  const frontmatter = structuredClone(current.frontmatter);
  delete frontmatter.task_store;
  frontmatter.runtime_state = {
    ...frontmatter.runtime_state,
    execution_log: current.runtimeState.execution_log,
    applied_proposals: current.runtimeState.applied_proposals,
  };
  fs.writeFileSync(current.filePath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${current.body}`, 'utf8');
  fs.rmSync(path.join(root, 'docs', 'workflow', 'task-data', current.sourceTuple.document_id), { recursive: true, force: true });
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

function taskStoreSnapshot(root: string): string {
  const storeRoot = path.join(root, 'docs', 'workflow', 'task-data');
  if (!fs.existsSync(storeRoot)) return 'absent';
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(storeRoot, absolute));
    }
  };
  visit(storeRoot);
  return files.sort().map(relative => `${relative}:${fileRevision(path.join(storeRoot, relative))}`).join('\n');
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

function pendingKnowledgeAdmission(kind: 'contract' | 'decision'): KnowledgeAdmissionRecord {
  const candidateId = `pending-${kind}-predecessor`;
  const statement = `pending ${kind} predecessor admission`;
  const applicability = {
    projectTypes: ['test'],
    pathsSymbolsOrSurfaces: ['runtime fixture'],
    triggerConditions: ['the predecessor task closes'],
  };
  const candidate: KnowledgeCandidate = {
    candidateId,
    kind,
    fingerprint: fingerprintKnowledgeStatement(kind, statement, applicability),
    statement,
    sourceRefs: [{ locator: 'runtime/vnext/src/kernel.ts#project-status', revision: 'fixture-source-r1' }],
    applicability,
    authoritySource: kind === 'decision' ? 'user' : 'verified-evidence',
    stability: 'stable',
    evidenceRefs: [`test:evidence:pending-${kind}`],
    noveltyAgainst: [],
    conflictSet: [],
    supersedes: null,
    reviewOrExpiryTrigger: null,
    expectedConsumers: ['close-task successor gate'],
    ...(kind === 'decision' ? {
      decisionContext: {
        alternatives: ['leave the predecessor admission unresolved'],
        constraints: ['preserve the predecessor hard gate'],
      },
    } : {}),
  };
  return {
    candidate,
    disposition: 'admit',
    matched_knowledge_id: null,
    reasons: [`${kind} admission remains pending in this predecessor fixture`],
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
    const legacyConfirmFrontmatter = structuredClone(persistedConfirmDraft.frontmatter);
    delete legacyConfirmFrontmatter.task_store;
    legacyConfirmFrontmatter.runtime_state = {
      ...legacyConfirmFrontmatter.runtime_state,
      execution_log: persistedConfirmDraft.runtimeState.execution_log,
      applied_proposals: persistedConfirmDraft.runtimeState.applied_proposals,
      claim_evidence: [],
    };
    fs.writeFileSync(persistedConfirmDraft.filePath, `---\n${stringify({
      ...legacyConfirmFrontmatter,
    }).trimEnd()}\n---\n${persistedConfirmDraft.body}`, 'utf8');
    fs.rmSync(path.join(emptyConfirmRoot, 'docs', 'workflow', 'task-data', persistedConfirmDraft.sourceTuple.document_id), { recursive: true, force: true });
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
    expect(missingReplanPlan.code).toBe('REPLAN_CONFIRMATION_REQUIRED');

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
    const root = legacyMigrationRoot();
    const before = readCanonicalCurrentTask(root);
    const plan = completeClaimEvidence();
    delete plan[0]!.slots[0]!.check!.boundary;
    // Shared legacy fixture: reconstruction is allowed without selection metadata,
    // but missing/wrong due steps and new or widened commands are not migration.
    for (const [step, command, code] of [
      ['missing-step', 'bun test test/vnext-runtime.test.ts', 'CLAIM_EVIDENCE_PLAN_INVALID'],
      ['legacy-other', 'bun test test/vnext-runtime.test.ts', 'CLAIM_EVIDENCE_COMMAND_UNBOUND'],
      ['step-1', 'bun test', 'CLAIM_EVIDENCE_COMMAND_UNBOUND'],
      ['step-1', 'bun run test:e2e', 'CLAIM_EVIDENCE_COMMAND_UNBOUND'],
    ]) {
      const invalid = structuredClone(plan);
      invalid[0]!.slots[0]!.due_step_id = step!;
      invalid[0]!.slots[0]!.check!.entry = command!;
      const bytes = fs.readFileSync(before.filePath, 'utf8');
      expect(applyVNextRuntimeProposal(root, claimEvidenceMigrationProposal(root, invalid, 'reject-migration-expansion')))
        .toMatchObject({ status: 'blocked', code });
      expect(fs.readFileSync(before.filePath, 'utf8')).toBe(bytes);
    }
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
    const root = legacyMigrationRoot(makeRuntimeState({ active_step_status: 'completed' }));

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
    expect(executed).toMatchObject({ status: 'blocked', code: 'CLAIM_EVIDENCE_RESULT_UNBOUND' });
    const preflight = preflightStep(root, { candidate_paths: [] });
    const currentClaims = readCanonicalCurrentTask(root).runtimeState.claim_evidence!;
    expect(recordStepResult(root, {
      preflight_receipt: preflight.receipt, actual_changed_paths: [],
      command_results: preflight.current_step.commands.map(item => ({ command: item.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] })),
      validation_results: preflight.current_step.validation.map(validation => ({ validation, status: 'passed', evidence_refs: ['evidence-report.txt'] })),
      acceptance_evidence: currentClaims.flatMap(claim => claim.slots.map(slot => reportFixture(root, claim.claim_id, slot.slot_id))),
      outcome: 'implemented', note: 'Record the frozen invocation result',
    }).status).toBe('success');
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
    expect(prematureResult.status).toBe('success');
    expect(prematureResult.committed).toBe(true);
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
    expect(result.governed_mutation_count).toBe(2);
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
    expect(() => prepareDraft(root, singleStepSemanticDraft())).toThrow('REPLACEMENT_OUTCOME_UNSUPPORTED');
    expect(readCanonicalCurrentTask(root).body).toContain(beforeDefinition.slice(beforeDefinition.indexOf('## 背景与上下文'), beforeDefinition.indexOf('## 执行记录')));
  });

  test('supersede preserves the exact confirmed task and Task Basis bytes before invalidation', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft({
      task_basis: taskBasisFixture('Verify the Rust issue ledger and its nine acceptance obligations; external code is review evidence only.'),
    }));
    const before = readCanonicalCurrentTask(root);
    const basis = readCanonicalTaskBasis(root, before);
    const basisBytes = fs.readFileSync(basis.filePath);
    const currentBytes = fs.readFileSync(before.filePath);
    const proposal = createLifecycleProposal(before, {
      mode: 'supersede', delta: supersedeDelta({ invalidation_kind: 'acceptance' }),
      idempotency_key: 'incident-preserve-original',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    const dryRun = applyVNextRuntimeProposal(root, proposal, { dryRun: true });
    expect(dryRun.status).toBe('success');
    expect(dryRun.committed).toBe(false);
    expect(fs.readFileSync(before.filePath)).toEqual(currentBytes);
    const historyPath = path.join(root, dryRun.planned_writes![1]!);
    expect(fs.existsSync(historyPath)).toBe(false);
    expect(applyVNextRuntimeProposal(root, proposal).status).toBe('success');
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    expect(Buffer.from(history.current_task_base64, 'base64')).toEqual(currentBytes);
    expect(Buffer.from(history.task_basis_base64, 'base64')).toEqual(basisBytes);
    expect(history.source_path).toBe('CURRENT_TASK.md');
    expect(history.task_basis_path).toBe(path.relative(path.dirname(before.filePath), basis.filePath).replace(/\\/g, '/'));
    expect(history.source_revision).toBe(crypto.createHash('sha256').update(currentBytes).digest('hex'));
    expect(history.task_basis_revision).toBe(crypto.createHash('sha256').update(basisBytes).digest('hex'));
    expect(Array.isArray(history.referenced_evidence)).toBe(true);
    expect(history.referenced_evidence.every((item: { preservation: string }) => item.preservation.includes('not snapshotted'))).toBe(true);
    expect(fs.readFileSync(basis.filePath)).toEqual(basisBytes);
    const canonical = fs.readFileSync(before.filePath);
    expect(applyVNextRuntimeProposal(root, proposal).status).toBe('no-op');
    expect(fs.readFileSync(historyPath, 'utf8')).toBe(JSON.stringify(history, null, 2) + '\n');
    expect(fs.readFileSync(before.filePath)).toEqual(canonical);
    fs.rmSync(historyPath);
    expect(applyVNextRuntimeProposal(root, proposal).status).toBe('blocked');
  });

  test('task evolution recovers after a real process exit at the post-publication boundary', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-evolution-crash-'));
    temporaryRoots.push(root);
    const workflow = path.join(root, 'docs', 'workflow');
    fs.mkdirSync(workflow, { recursive: true });
    const currentPath = path.join(workflow, 'CURRENT_TASK.md');
    const previousContent = 'original task bytes\r\nacceptance survives\r\n';
    const nextContent = 'superseded task bytes\n';
    fs.writeFileSync(currentPath, previousContent, 'utf8');
    const input = { currentPath, previousContent, nextContent, documentId: 'doc-aaaaaaaaaaaaaaaaaaaaaaaa', taskId: '001' };
    const source = path.join(ROOT, 'runtime', 'vnext', 'src', 'task-evolution-io.ts').replace(/\\/g, '/');
    const childScript = `import { commitSupersedeWithHistory } from ${JSON.stringify(source)}; commitSupersedeWithHistory(${JSON.stringify(input)}, () => process.exit(19));`;
    const child = spawnSync(process.execPath, ['-e', childScript], { encoding: 'utf8' });
    expect(child.status).toBe(19);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(nextContent);
    const history = taskHistoryLocation(input);
    expect(JSON.parse(fs.readFileSync(history.path, 'utf8')).current_task_base64).toBe(Buffer.from(previousContent).toString('base64'));
    const lockPath = path.join(workflow, '.vnext-task-evolution.lock');
    expect(fs.existsSync(lockPath)).toBe(true);
    const interruptedLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(interruptedLock.phase).toBe('current-published');
    recoverTaskEvolution(currentPath);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(nextContent);

    fs.writeFileSync(currentPath, previousContent, 'utf8');
    fs.writeFileSync(lockPath, JSON.stringify({ ...interruptedLock, phase: 'history-written' }) + '\n');
    recoverTaskEvolution(currentPath);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(previousContent);
    expect(fs.existsSync(lockPath)).toBe(false);

    fs.writeFileSync(currentPath, nextContent, 'utf8');
    fs.rmSync(history.path);
    fs.writeFileSync(lockPath, JSON.stringify(interruptedLock) + '\n');
    expect(() => recoverTaskEvolution(currentPath)).toThrow('TASK_EVOLUTION_RECOVERY_REQUIRED');
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test('confirmed correction recovers a crash between Task Basis and CURRENT_TASK publication', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-correction-crash-'));
    temporaryRoots.push(root);
    const workflow = path.join(root, 'docs', 'workflow');
    const basisDirectory = path.join(workflow, 'task-basis');
    fs.mkdirSync(basisDirectory, { recursive: true });
    const currentPath = path.join(workflow, 'CURRENT_TASK.md');
    const basisPath = path.join(basisDirectory, 'TASK_BASIS-001.md');
    const input = { currentPath, previousContent: 'old exact task\r\n', nextContent: 'confirmed correction\n',
      documentId: 'doc-cccccccccccccccccccccccc', taskId: '001', basisPath,
      basisContent: 'old exact basis\r\n', nextBasisContent: 'basis with decision\n', operation: 'confirm-replan' as const };
    fs.writeFileSync(currentPath, input.previousContent);
    fs.writeFileSync(basisPath, input.basisContent);
    const source = path.join(ROOT, 'runtime', 'vnext', 'src', 'task-evolution-io.ts').replace(/\\/g, '/');
    const childScript = `import { commitTaskEvolutionWithHistory } from ${JSON.stringify(source)}; commitTaskEvolutionWithHistory(${JSON.stringify(input)}, () => {}, () => process.exit(17));`;
    const child = spawnSync(process.execPath, ['-e', childScript], { encoding: 'utf8' });
    expect(child.status).toBe(17);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(input.previousContent);
    expect(fs.readFileSync(basisPath, 'utf8')).toBe(input.nextBasisContent);
    recoverTaskEvolution(currentPath);
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(input.previousContent);
    expect(fs.readFileSync(basisPath, 'utf8')).toBe(input.basisContent);
    expect(fs.existsSync(path.join(workflow, '.vnext-task-evolution.lock'))).toBe(false);
    expect(() => commitTaskEvolutionWithHistory(input, () => { throw new Error('injected read-back failure'); })).toThrow('injected read-back failure');
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(input.previousContent);
    expect(fs.readFileSync(basisPath, 'utf8')).toBe(input.basisContent);
    commitTaskEvolutionWithHistory(input, () => {});
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(input.nextContent);
    expect(fs.readFileSync(basisPath, 'utf8')).toBe(input.nextBasisContent);
  });

  test('explicitly initializes a valid older task without changing its definition or existing evidence', () => {
    const root = confirmedSemanticRoot();
    const original = readCanonicalCurrentTask(root);
    const frontmatter = structuredClone(original.frontmatter);
    delete frontmatter.task_store;
    frontmatter.runtime_state = {
      ...frontmatter.runtime_state,
      execution_log: original.runtimeState.execution_log,
      applied_proposals: original.runtimeState.applied_proposals,
    };
    delete frontmatter.runtime_state.task_evolution_version;
    fs.writeFileSync(original.filePath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${original.body}`, 'utf8');
    fs.rmSync(path.join(root, 'docs', 'workflow', 'task-data', original.sourceTuple.document_id), { recursive: true, force: true });
    const old = readCanonicalCurrentTask(root);
    const basis = readCanonicalTaskBasis(root, old);
    const input = { source_revision: old.sourceTuple.revision, basis_revision: basis.revision };
    const oldBytes = fs.readFileSync(old.filePath);
    const basisBytes = fs.readFileSync(basis.filePath);
    const supersede = createLifecycleProposal(old, { mode: 'supersede', delta: supersedeDelta(),
      idempotency_key: 'older-task-supersede', authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'] });
    expect(applyVNextRuntimeProposal(root, supersede)).toMatchObject({ status: 'blocked', code: 'TASK_EVOLUTION_INITIALIZATION_REQUIRED' });
    expect(fs.readFileSync(old.filePath)).toEqual(oldBytes);
    expect(initializeTaskPreservation(root, input, { dryRun: true })).toMatchObject({ status: 'success', committed: false });
    expect(fs.readFileSync(old.filePath)).toEqual(oldBytes);
    expect(() => initializeTaskPreservation(root, { ...input, basis_revision: '0'.repeat(64) })).toThrow('TASK_EVOLUTION_BASIS_STALE');
    const result = initializeTaskPreservation(root, input);
    expect(result).toMatchObject({ status: 'success', committed: true, read_back_verified: true });
    const current = readCanonicalCurrentTask(root);
    expect(current.runtimeState.task_evolution_version).toBe(2);
    expect(current.runtimeState.preservation_source_revision).toBe(old.sourceTuple.revision);
    expect(current.body).toBe(old.body);
    expect(current.runtimeState.claim_evidence).toEqual(old.runtimeState.claim_evidence);
    expect(current.runtimeState.active_step_id).toBe(old.runtimeState.active_step_id);
    expect(fs.readFileSync(basis.filePath)).toEqual(basisBytes);
    const historyPath = path.join(root, 'docs', 'workflow', 'task-history', old.sourceTuple.document_id, `${old.sourceTuple.revision}.json`);
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    expect(history.operation).toBe('initialize-preservation');
    expect(Buffer.from(history.current_task_base64, 'base64')).toEqual(oldBytes);
    expect(Buffer.from(history.task_basis_base64, 'base64')).toEqual(basisBytes);
    expect(initializeTaskPreservation(root, input).status).toBe('no-op');
    const initializedBytes = fs.readFileSync(current.filePath, 'utf8');
    fs.writeFileSync(current.filePath, initializedBytes.replace('task_evolution_version: 2', 'task_evolution_version: 3'));
    expect(() => readCanonicalCurrentTask(root)).toThrow('TASK_EVOLUTION_VERSION_UNSUPPORTED');
    fs.writeFileSync(current.filePath, initializedBytes);
    fs.rmSync(historyPath);
    expect(() => readCanonicalCurrentTask(root)).toThrow('TASK_HISTORY_MISSING');
  });

  test('installed Runtime initializes an upgraded older task through the public CLI', { timeout: 60000 }, () => {
    const source = confirmedSemanticRoot();
    const sourceCurrent = readCanonicalCurrentTask(source);
    const frontmatter = structuredClone(sourceCurrent.frontmatter);
    delete frontmatter.task_store;
    frontmatter.runtime_state = {
      ...frontmatter.runtime_state,
      execution_log: sourceCurrent.runtimeState.execution_log,
      applied_proposals: sourceCurrent.runtimeState.applied_proposals,
    };
    delete frontmatter.runtime_state.task_evolution_version;
    fs.writeFileSync(sourceCurrent.filePath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${sourceCurrent.body}`, 'utf8');
    fs.rmSync(path.join(source, 'docs', 'workflow', 'task-data', sourceCurrent.sourceTuple.document_id), { recursive: true, force: true });
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-preservation-installed-'));
    temporaryRoots.push(target);
    fs.writeFileSync(path.join(target, 'package.json'), '{"name":"preservation-fixture","private":true}\n');
    buildVibeGovernanceDistribution({ outputRoot: path.join(ROOT, 'packages', 'vibe-governance') });
    expect(installDistribution({ targetRoot: target, packageRoot: path.join(ROOT, 'packages', 'vibe-governance') }).status).toBe('installed');
    fs.copyFileSync(path.join(source, '.workflow-system', 'PROJECT_PROFILE.yaml'), path.join(target, '.workflow-system', 'PROJECT_PROFILE.yaml'));
    fs.cpSync(path.join(source, 'docs', 'workflow'), path.join(target, 'docs', 'workflow'), { recursive: true });
    const targetCurrent = path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md');
    const before = fs.readFileSync(targetCurrent);
    const statePath = path.join(target, '.workflow-system', 'vnext', 'DISTRIBUTION_STATE.json');
    const distributionState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    distributionState.distribution_version = '0.18.6';
    fs.writeFileSync(statePath, JSON.stringify(distributionState, null, 2) + '\n');
    const upgradeResult = upgradeDistribution({ targetRoot: target, packageRoot: path.join(ROOT, 'packages', 'vibe-governance') });
    expect(upgradeResult.status).toBe('upgraded');
    expect(fs.readFileSync(targetCurrent)).toEqual(before);
    const installedCli = path.join(target, '.workflow-system', 'runtime', 'dist', 'cli.js');
    const summaryProcess = spawnSync('node', [installedCli, 'validate', '--root', target, '--summary'], { cwd: target, encoding: 'utf8' });
    expect(summaryProcess.status).toBe(0);
    expect(JSON.parse(summaryProcess.stdout).summary.preservation_initialization_required).toBe(true);
    const current = readCanonicalCurrentTask(target);
    const basis = readCanonicalTaskBasis(target, current);
    const input = { source_revision: current.sourceTuple.revision, basis_revision: basis.revision };
    const initialized = spawnSync('node', [installedCli, 'initialize-preservation', '--root', target],
      { cwd: target, input: JSON.stringify(input), encoding: 'utf8' });
    expect(initialized.status).toBe(0);
    expect(JSON.parse(initialized.stdout)).toMatchObject({ status: 'success', committed: true, read_back_verified: true });
    expect(readCanonicalCurrentTask(target).body).toBe(current.body);
    const historyPath = path.join(target, 'docs', 'workflow', 'task-history', current.sourceTuple.document_id, `${current.sourceTuple.revision}.json`);
    expect(Buffer.from(JSON.parse(fs.readFileSync(historyPath, 'utf8')).current_task_base64, 'base64')).toEqual(before);
    const protectedBytes = fs.readFileSync(targetCurrent);
    const laterUpgradeState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    laterUpgradeState.distribution_version = '0.18.6';
    fs.writeFileSync(statePath, JSON.stringify(laterUpgradeState, null, 2) + '\n');
    expect(upgradeDistribution({ targetRoot: target, packageRoot: path.join(ROOT, 'packages', 'vibe-governance') }).status).toBe('upgraded');
    expect(fs.readFileSync(targetCurrent)).toEqual(protectedBytes);
  });

  test('task evolution rejects conflicting history and rolls back a failed read-back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-evolution-rollback-'));
    temporaryRoots.push(root);
    const workflow = path.join(root, 'docs', 'workflow');
    fs.mkdirSync(workflow, { recursive: true });
    const currentPath = path.join(workflow, 'CURRENT_TASK.md');
    const input = {
      currentPath, previousContent: 'before\n', nextContent: 'after\n',
      documentId: 'doc-bbbbbbbbbbbbbbbbbbbbbbbb', taskId: '001',
    };
    fs.writeFileSync(currentPath, input.previousContent, 'utf8');
    const history = taskHistoryLocation(input);
    fs.mkdirSync(path.dirname(history.path), { recursive: true });
    fs.writeFileSync(history.path, 'conflicting history', 'utf8');
    expect(() => commitSupersedeWithHistory(input, () => {})).toThrow('TASK_HISTORY_CONFLICT');
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(input.previousContent);
    expect(fs.existsSync(path.join(workflow, '.vnext-task-evolution.lock'))).toBe(false);
    fs.rmSync(history.path);
    expect(() => commitSupersedeWithHistory(input, () => { throw new Error('injected read-back failure'); })).toThrow('injected read-back failure');
    expect(fs.readFileSync(currentPath, 'utf8')).toBe(input.previousContent);
    expect(fs.readFileSync(history.path, 'utf8')).toBe(history.content);
    expect(fs.existsSync(path.join(workflow, '.vnext-task-evolution.lock'))).toBe(false);
    const lockPath = path.join(workflow, '.vnext-task-evolution.lock');
    const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
    const foreignLock = JSON.stringify({
      schema_version: 1, phase: 'prepared', pid: process.pid, current_path: currentPath,
      previous_revision: hash(input.previousContent), next_revision: hash(input.nextContent),
      history_path: history.path, history_revision: hash(history.content),
    }) + '\n';
    fs.writeFileSync(lockPath, foreignLock);
    expect(() => commitSupersedeWithHistory(input, () => {})).toThrow('TASK_EVOLUTION_IN_PROGRESS');
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(foreignLock);
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
    expect(superseded.planned_writes?.[0]).toBe('docs/workflow/CURRENT_TASK.md');
    expect(superseded.planned_writes?.[1]).toMatch(/^docs\/workflow\/task-history\/doc-[a-f0-9]+\/[a-f0-9]{64}\.json$/);
    expect(superseded.governed_mutation_count).toBe(2);
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

  test('blocks an incident-shaped direct replan and preserves the original review obligations', () => {
    const nineIssues = Array.from({ length: 9 }, (_, index): ClaimEvidenceRecord => {
      const claim = evidencePlanFixture(`Rust issue ${index + 1} verified`)[0]!;
      const slot = claim.slots[0]!;
      // This incident predates structured invocation planning; preserve a real legacy fixture.
      delete slot.check!.selection; delete slot.check!.boundary;
      return { ...claim, claim_id: `A${index + 1}`, slots: [{ ...slot, slot_id: `a${index + 1}`, check: { ...slot.check!, check_id: `K${index + 1}` } }] };
    });
    const root = makeRoot(makeRuntimeState({
      claim_evidence_required: true,
      claim_evidence: nineIssues,
      findings: [
        runtimeFinding('external-review-issue-1', 'admitted'),
        runtimeFinding('external-review-issue-2', 'in-progress'),
      ],
    }));
    const initial = readCanonicalCurrentTask(root);
    const supersede = createLifecycleProposal(initial, {
      mode: 'supersede',
      delta: supersedeDelta({ invalidation_kind: 'acceptance' }),
      idempotency_key: 'incident-supersede',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(root, supersede).status).toBe('success');
    const before = readCanonicalCurrentTask(root);
    const bytes = fs.readFileSync(before.filePath, 'utf8');
    const attempt = applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'incident-replace-audit-with-code', {
      active_step_id: 'step-2',
      definition: replacementDefinition(),
      claim_evidence: completeClaimEvidence(),
    }));
    expect(attempt).toMatchObject({
      status: 'blocked',
      code: 'REPLAN_CONFIRMATION_REQUIRED',
      committed: false,
      governed_mutation_count: 0,
    });
    expect(fs.readFileSync(before.filePath, 'utf8')).toBe(bytes);
    expect(readCanonicalCurrentTask(root).runtimeState.findings.map(item => item.status)).toEqual(['admitted', 'in-progress']);
    expect(readCanonicalCurrentTask(root).runtimeState.claim_evidence?.map(claim => claim.claim_id)).toEqual(nineIssues.map(claim => claim.claim_id));
    expect(readCanonicalCurrentTask(root).body).toContain('original background');
    expect(applyVNextRuntimeProposal(root, supersede).status).toBe('no-op');
  });

  test('rejects raw replacement proposals before validating a new active step', () => {
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
    expect(missingStep.code).toBe('REPLAN_CONFIRMATION_REQUIRED');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('superseded');

    const duplicateStep = applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'replan-duplicate-step', {
      active_step_id: 'step-2',
      definition: replacementDefinition({ implementation_steps: '- step-2: first\n- step-2: duplicate' }),
    }));
    expect(duplicateStep.status).toBe('blocked');
    expect(duplicateStep.code).toBe('REPLAN_CONFIRMATION_REQUIRED');
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

  test('cannot replay supersede to authorize a direct definition generation', () => {
    const root = makeRoot();
    const initial = readCanonicalCurrentTask(root);
    const supersede = createLifecycleProposal(initial, {
      mode: 'supersede', delta: supersedeDelta(), idempotency_key: 'supersede-generation-a',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(root, supersede).status).toBe('success');
    const before = fs.readFileSync(initial.filePath, 'utf8');
    expect(applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'commit-generation-replan', {
      claim_evidence: completeClaimEvidence(),
    }))).toMatchObject({ status: 'blocked', code: 'REPLAN_CONFIRMATION_REQUIRED' });
    expect(fs.readFileSync(initial.filePath, 'utf8')).toBe(before);
    expect(applyVNextRuntimeProposal(root, supersede).status).toBe('no-op');
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

  test('does not reach write or read-back for a direct commit-replan', () => {
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
    expect(result.code).toBe('REPLAN_CONFIRMATION_REQUIRED');
    expect(result.governed_mutation_count).toBe(0);
    expect(readCount).toBe(1);
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

  test('projects completed status items while preserving unrelated STATUS content and repairs projection drift', () => {
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
    expect(statusReplay.status).toBe('success');
    expect(statusReplay.committed).toBe(true);
    const repaired = fs.readFileSync(statusPath, 'utf8');
    expect(repaired).toContain('- drifted completed item');
    expect(repaired).toContain('- runtime fixture task');
    expect(repaired.split(STATUS_RECONCILIATION_BEGIN).length - 1).toBe(1);
    const statusReplayAgain = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta(), 'status-projection'));
    expect(statusReplayAgain.status).toBe('no-op');

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

  test('reconciles the TermLink Bootstrap STATUS baseline with unrelated records', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    let status = fs.readFileSync(statusPath, 'utf8').replace(
      '## 🔨 正在开发\n\n- [ ] none',
      '## 🔨 正在开发\n\n- 旧 Bootstrap 说明',
    );
    status = status.replace(
      '## 🔜 下一检查点\n\n- baseline',
      '## 🔜 下一检查点\n\n- checkpoint A\n- checkpoint B',
    );
    fs.writeFileSync(statusPath, status, 'utf8');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'archive-status-termlink-baseline')).status).toBe('success');

    const result = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta(), 'status-termlink-baseline'));
    expect(result.status).toBe('success');
    const reconciled = fs.readFileSync(statusPath, 'utf8');
    expect(reconciled).toContain('- 旧 Bootstrap 说明');
    expect(reconciled).toContain('- checkpoint A');
    expect(reconciled).toContain('- checkpoint B');
    expect(reconciled).toContain('- runtime fixture task');
    expect(reconciled).toContain('- observe the next project checkpoint');
  });

  test('adds a completed item without an exact in-progress mapping', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').replace(
      '## 🔨 正在开发\n\n- [ ] none',
      '## 🔨 正在开发\n\n- unrelated item',
    ), 'utf8');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'archive-status-unrelated-development')).status).toBe('success');

    const result = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta(), 'status-unrelated-development'));
    expect(result.status).toBe('success');
    const reconciled = fs.readFileSync(statusPath, 'utf8');
    expect(reconciled).toContain('## 🔨 正在开发\n\n- unrelated item');
    expect(reconciled).toContain('- runtime fixture task');
  });

  test('preserves ordinary in-progress text during STATUS reconciliation', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    const ordinaryText = '当前处于 Bootstrap 迁移后的观察阶段。';
    fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').replace(
      '## 🔨 正在开发\n\n- [ ] none',
      `## 🔨 正在开发\n\n${ordinaryText}\n\n- unrelated item`,
    ), 'utf8');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'archive-status-ordinary-text')).status).toBe('success');

    const result = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta(), 'status-ordinary-text'));
    expect(result.status).toBe('success');
    const reconciled = fs.readFileSync(statusPath, 'utf8');
    expect(reconciled).toContain(ordinaryText);
    expect(reconciled).toContain('- unrelated item');
    expect(reconciled).toContain('- runtime fixture task');
  });

  test('appends the new checkpoint while preserving multiple existing checkpoints and text', () => {
    const root = makeRoot(makeRuntimeState({ active_step_status: 'completed', claim_evidence_required: true, claim_evidence: completeClaimEvidence() }));
    const statusPath = path.join(root, 'docs', 'workflow', 'STATUS.md');
    fs.writeFileSync(statusPath, fs.readFileSync(statusPath, 'utf8').replace(
      '## 🔜 下一检查点\n\n- baseline',
      '## 🔜 下一检查点\n\n- checkpoint A\n保留的迁移说明\n- checkpoint B',
    ), 'utf8');
    expect(applyVNextRuntimeProposal(root, archiveProposal(root, archiveDelta(), 'archive-status-multiple-checkpoints')).status).toBe('success');

    const result = applyVNextRuntimeProposal(root, statusProposal(root, statusDelta(), 'status-multiple-checkpoints'));
    expect(result.status).toBe('success');
    const reconciled = fs.readFileSync(statusPath, 'utf8');
    expect(reconciled).toContain('- checkpoint A');
    expect(reconciled).toContain('保留的迁移说明');
    expect(reconciled).toContain('- checkpoint B');
    expect(reconciled).toContain('- observe the next project checkpoint');
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

  test('allows new draft creation when previous STATUS reconciliation is incomplete', () => {
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

    const create002Success = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(create002Success.status).toBe('success');
    expect(create002Success.committed).toBe(true);
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBytesBefore);
    expect(readCanonicalCurrentTask(root).runtimeState.task_id).toBe('002');
  });

  test('keeps Contract and Decision predecessor gates hard while ignoring STATUS reconciliation', () => {
    for (const kind of ['contract', 'decision'] as const) {
      const root = makeRoot(makeRuntimeState({
        task_id: '001',
        task_slug: 'first-task',
        active_step_status: 'completed',
        claim_evidence_required: true,
        claim_evidence: completeClaimEvidence(),
      }));
      const admission = pendingKnowledgeAdmission(kind);
      const knowledgeAdmissions: KnowledgeAdmissionBundle = {
        contracts: kind === 'contract' ? [admission] : [],
        decisions: kind === 'decision' ? [admission] : [],
      };
      const closeDelta = archiveDelta({
        knowledge_admissions: knowledgeAdmissions,
        evidence_refs: ['test:evidence:closure', `test:evidence:pending-${kind}`],
      });
      expect(applyVNextRuntimeProposal(root, archiveProposal(root, closeDelta, `archive-pending-${kind}`)).status).toBe('success');

      const successor = createPrepareTaskDraftProposal(readCanonicalCurrentTask(root), {
        action: 'create-draft',
        task_id: '002',
        task_slug: 'second-task',
        document_id: kind === 'contract' ? 'doc-222222222222222222222222' : 'doc-333333333333333333333333',
        task_title: 'Second task',
        draft_definition: draftDefinition(),
        active_step_id: 'step-1',
        claim_evidence: completeClaimEvidence(),
        evidence_refs: [`test:evidence:create-after-${kind}`],
        idempotency_key: `draft-create-after-${kind}`,
        authority_evidence: evidence('user-confirmation', 'scope-admission', 'evidence-admission'),
      });
      const result = applyVNextRuntimeProposal(root, successor);
      expect(result.status).toBe('blocked');
      expect(result.code).toBe('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE');
    }
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
          '  - planned_command: bun test test/vnext-runtime.test.ts',
          '    - expected_repo_writes: none',
          '    - transformation_kind: localized',
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
          '  - planned_command: bun test test/vnext-runtime.test.ts',
          '    - expected_repo_writes: none',
          '    - transformation_kind: localized',
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

  test('allows new draft creation when previous STATUS receipt visible projection has drifted', () => {
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

    const createSuccess = applyVNextRuntimeProposal(root, draft002Proposal);
    expect(createSuccess.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.task_id).toBe('002');
    expect(fs.readFileSync(statusPath, 'utf8')).toContain('tampered visible item');
  });

  test('validateVNextRuntimeContract machine-readably enforces reconciliation, step admission, and authority coordinates', () => {
    // Current live repository contract passes machine validation
    const valid = validateVNextRuntimeContract(ROOT);
    expect(valid.phase).toBe('Phase 2');

    // Contract missing previous_close_reconciliation fails closed
    const contractPath = path.join(ROOT, '.workflow-system', 'vnext', 'RUNTIME_CONTRACT.yaml');
    const originalContract = fs.readFileSync(contractPath, 'utf8');
    const parsedContract = parse(originalContract) as {
      proposal: {
        task_state: {
          draft: {
            previous_close_reconciliation: {
              archive: string;
              status: string;
              admitted_lesson: string;
            };
          };
        };
      };
    };
    expect(parsedContract.proposal.task_state.draft.previous_close_reconciliation).toEqual({
      archive: 'required',
      status: 'non-blocking',
      admitted_lesson: 'required-or-durable-reuse-proof',
    });
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

      const unsafeReplan = originalContract.replace('direct_replan_result: REPLAN_CONFIRMATION_REQUIRED', 'direct_replan_result: success');
      fs.writeFileSync(contractPath, unsafeReplan, 'utf8');
      expect(() => validateVNextRuntimeContract(ROOT)).toThrow('RUNTIME_CONTRACT_INVALID');

      const blockingStatus = originalContract.replace('status: non-blocking', 'status: required');
      fs.writeFileSync(contractPath, blockingStatus, 'utf8');
      expect(() => validateVNextRuntimeContract(ROOT)).toThrow('RUNTIME_CONTRACT_INVALID');
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

  test('persists project document references through the public CLI, refinement and confirmation', () => {
    const root = archivedBaselineRoot();
    const sources = [
      { path: 'docs/REQ.md', section: 'REQ-1', revision: 'v2', purpose: 'Required behavior' },
      { path: 'docs/PLAN.md', section: 'S1', revision: 'unknown', purpose: 'Implementation boundary' },
    ];
    const input = semanticDraft({ project_documents: sources, affected_contracts: ['docs/API.md#retry — change retry limit'] });
    const cli = (command: string, payload?: unknown) => spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), command, '--root', root, ...(command === 'validate' ? ['--summary'] : [])], { encoding: 'utf8', input: payload === undefined ? undefined : JSON.stringify(payload) });
    const prepared = cli('prepare-draft', input);
    expect(prepared.status).toBe(0);
    const receipt = JSON.parse(prepared.stdout).confirmation_receipt;
    const summary = cli('validate');
    expect(summary.status).toBe(0);
    expect(JSON.parse(summary.stdout).summary.project_documents).toEqual(sources);
    expect(JSON.parse(summary.stdout).summary.affected_contracts).toContain('docs/API.md#retry');
    expect(readCanonicalTaskBasis(root, readCanonicalCurrentTask(root)).basis).toEqual(input.task_basis);
    expect(prepareDraft(root, input).status).toBe('no-op');
    expect(() => prepareDraft(root, semanticDraft())).toThrow('PROJECT_DOCUMENTS_REQUIRED');
    const changed = { ...input, project_documents: sources.map(source => ({ ...source, revision: 'v3' })) };
    const refined = prepareDraft(root, changed);
    expect(refined.status).toBe('success');
    expect(() => confirmDraft(root, { confirmation_receipt: receipt })).toThrow('DRAFT_REVISION_CONFLICT');
    expect(confirmDraft(root, { confirmation_receipt: refined.confirmation_receipt }).status).toBe('success');
    expect(readProjectDocuments(readDraftDefinitionFromBody(readCanonicalCurrentTask(root).body).background_context)).toEqual(changed.project_documents);
    expect(() => replan(root, semanticDraft())).toThrow('REPLAN_CONFIRMATION_REQUIRED');
    expect(() => replan(root, { ...changed, project_documents: [] })).toThrow('REPLAN_CONFIRMATION_REQUIRED');
  });

  test('rejects malformed document references without writes and distinguishes legacy absence from explicit empty', () => {
    const root = archivedBaselineRoot();
    const before = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
    const source = { path: '../REQ.md', section: 'REQ-1', revision: 'v1', purpose: 'constraint' };
    expect(() => prepareDraft(root, semanticDraft({ project_documents: [source], affected_contracts: [] }))).toThrow('PROJECT_DOCUMENTS_INVALID');
    source.path = 'docs/REQ.md';
    expect(() => prepareDraft(root, semanticDraft({ project_documents: [source, source], affected_contracts: [] }))).toThrow('PROJECT_DOCUMENTS_INVALID');
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(before);
    expect(prepareDraft(root, semanticDraft()).status).toBe('success');
    expect(readProjectDocuments(readDraftDefinitionFromBody(readCanonicalCurrentTask(root).body).background_context)).toBeNull();
    expect(prepareDraft(root, semanticDraft({ project_documents: [], affected_contracts: [] })).status).toBe('success');
    expect(readProjectDocuments(readDraftDefinitionFromBody(readCanonicalCurrentTask(root).body).background_context)).toEqual([]);
    expect(() => readProjectDocuments('### Project documents\n\n```json\n{"version":2,"sources":[]}\n```')).toThrow('PROJECT_DOCUMENTS_INVALID');
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

  test('Task Basis retains the original request and earlier decisions across draft refinement', () => {
    const root = archivedBaselineRoot();
    const originalBasis: TaskBasis = {
      original_request: { source: 'test:incident-request', verbatim: 'Verify the nine Rust issues without changing product code.' },
      user_decisions: [{ source: 'test:owner-decision', verbatim: 'Treat external code as review evidence.' }],
    };
    expect(prepareDraft(root, singleStepSemanticDraft({ task_basis: originalBasis })).status).toBe('success');
    const draft = readCanonicalCurrentTask(root);
    const basis = readCanonicalTaskBasis(root, draft);
    const beforeTask = fs.readFileSync(draft.filePath, 'utf8');
    const beforeBasis = fs.readFileSync(basis.filePath, 'utf8');
    const alteredRequest = prepareDraft(root, singleStepSemanticDraft({
      task_basis: { ...originalBasis, original_request: { ...originalBasis.original_request, verbatim: 'Implement the Rust fixes.' } },
    }));
    expect(alteredRequest).toMatchObject({ status: 'blocked', code: 'TASK_BASIS_IMMUTABLE' });
    const deletedDecision = prepareDraft(root, singleStepSemanticDraft({
      task_basis: { ...originalBasis, user_decisions: [] },
    }));
    expect(deletedDecision).toMatchObject({ status: 'blocked', code: 'TASK_BASIS_IMMUTABLE' });
    expect(fs.readFileSync(draft.filePath, 'utf8')).toBe(beforeTask);
    expect(fs.readFileSync(basis.filePath, 'utf8')).toBe(beforeBasis);
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

  test('freezes minimum-sufficient test selection instead of promoting a related target or suite', () => {
    const focused = singleStepSemanticDraft();
    const focusedCommand = 'bun test test/dogfood-target.test.ts --test-name-pattern "reconnect preserves the owner"';
    focused.implementation_steps[0]!.commands = [{ command: focusedCommand, expected_repo_writes: 'none' }];
    focused.implementation_steps[0]!.validation = ['Focused reconnect owner check passes'];
    focused.claim_evidence[0]!.slots[0]!.check!.entry = focusedCommand;
    focused.claim_evidence[0]!.slots[0]!.check!.selection = {
      granularity: 'focused', selector: 'reconnect preserves the owner',
      invocation: { argv: ['bun', 'test', 'test/dogfood-target.test.ts', '--test-name-pattern', 'reconnect preserves the owner'], selector_arg_index: 4 },
      selection_reason: 'The local owner branch is the only changed function chain.',
      breadth_reason: null, breadth_basis: null, breadth_source_ref: null,
    };
    const focusedRoot = archivedBaselineRoot();
    expect(prepareDraft(focusedRoot, focused).status).toBe('success');
    const focusedCheck = readCanonicalCurrentTask(focusedRoot).runtimeState.claim_evidence![0]!.slots[0]!.check!;
    expect(focusedCheck.selection).toMatchObject({ granularity: 'focused', selector: 'reconnect preserves the owner' });
    expect(focusedCheck.entry).toBe(focusedCommand);

    const targetWithoutNeed = singleStepSemanticDraft();
    const wholeTarget = 'bun test test/dogfood-target.test.ts';
    targetWithoutNeed.implementation_steps[0]!.commands = [{ command: wholeTarget, expected_repo_writes: 'none' }];
    targetWithoutNeed.implementation_steps[0]!.validation = ['Dogfood target passes'];
    targetWithoutNeed.claim_evidence[0]!.slots[0]!.check!.entry = wholeTarget;
    targetWithoutNeed.claim_evidence[0]!.slots[0]!.check!.selection = {
      granularity: 'target', selector: null,
      invocation: { argv: ['bun', 'test', 'test/dogfood-target.test.ts'], selector_arg_index: null },
      selection_reason: 'A related target exists.',
      breadth_reason: null, breadth_basis: null, breadth_source_ref: null,
    };
    expect(() => prepareDraft(archivedBaselineRoot(), targetWithoutNeed)).toThrow('CLAIM_EVIDENCE_BREADTH_REQUIRED');

    const flowReplacedByUnits = singleStepSemanticDraft();
    const broadCommand = 'bun test test/business-flow.test.ts';
    flowReplacedByUnits.implementation_steps[0]!.commands = [{ command: broadCommand, expected_repo_writes: 'none' }];
    flowReplacedByUnits.implementation_steps[0]!.validation = ['Business-flow target passes'];
    flowReplacedByUnits.claim_evidence[0]!.slots[0]!.check!.entry = broadCommand;
    flowReplacedByUnits.claim_evidence[0]!.slots[0]!.check!.boundary = 'business-flow';
    flowReplacedByUnits.claim_evidence[0]!.slots[0]!.check!.selection = {
      granularity: 'broad-regression', selector: null,
      invocation: { argv: ['bun', 'test', 'test/business-flow.test.ts'], selector_arg_index: null },
      selection_reason: 'Several unit checks are already green.',
      breadth_reason: null, breadth_basis: null, breadth_source_ref: null,
    };
    expect(() => prepareDraft(archivedBaselineRoot(), flowReplacedByUnits)).toThrow('CLAIM_EVIDENCE_BREADTH_REQUIRED');

    const e2eByDefault = singleStepSemanticDraft();
    e2eByDefault.implementation_steps[0]!.commands = [{ command: broadCommand, expected_repo_writes: 'none' }];
    e2eByDefault.implementation_steps[0]!.validation = ['E2E target passes'];
    e2eByDefault.claim_evidence[0]!.slots[0]!.check!.entry = broadCommand;
    e2eByDefault.claim_evidence[0]!.slots[0]!.check!.boundary = 'e2e';
    e2eByDefault.claim_evidence[0]!.slots[0]!.check!.selection = {
      granularity: 'target', selector: null,
      invocation: { argv: ['bun', 'test', 'test/business-flow.test.ts'], selector_arg_index: null },
      selection_reason: 'Run E2E just in case.',
      breadth_reason: null, breadth_basis: null, breadth_source_ref: null,
    };
    expect(() => prepareDraft(archivedBaselineRoot(), e2eByDefault)).toThrow('CLAIM_EVIDENCE_BREADTH_REQUIRED');

    const userRequestedBroad = singleStepSemanticDraft();
    userRequestedBroad.task_basis.user_decisions = [{ source: 'test:user-request#broad-regression', verbatim: 'Run the broad regression suite before accepting this change.' }];
    userRequestedBroad.implementation_steps[0]!.commands = [{ command: broadCommand, expected_repo_writes: 'none' }];
    userRequestedBroad.implementation_steps[0]!.validation = ['User-requested broad regression passes'];
    userRequestedBroad.claim_evidence[0]!.slots[0]!.check!.entry = broadCommand;
    userRequestedBroad.claim_evidence[0]!.slots[0]!.check!.selection = {
      granularity: 'broad-regression', selector: null,
      invocation: { argv: ['bun', 'test', 'test/business-flow.test.ts'], selector_arg_index: null },
      selection_reason: 'The user explicitly requested broad regression evidence.',
      breadth_reason: 'User requested the whole regression target.', breadth_basis: 'explicit-user', breadth_source_ref: 'test:user-request#broad-regression',
    };
    expect(prepareDraft(archivedBaselineRoot(), userRequestedBroad).status).toBe('success');
  });

  test('validation contract binds boundary invocation and real breadth authority in prepare update and confirm', () => {
    const local = singleStepSemanticDraft();
    const check = local.claim_evidence[0]!.slots[0]!.check!;
    check.selection = { ...check.selection!, scope: 'integration', selector: null,
      claim_scope: 'local',
      invocation: { argv: ['bun', 'test', 'test/vnext-runtime.test.ts'], selector_arg_index: null } };
    delete check.selection.granularity;
    expect(() => prepareDraft(archivedBaselineRoot(), local)).toThrow('CLAIM_EVIDENCE_SELECTION_INVALID');
    const flow = singleStepSemanticDraft();
    flow.claim_evidence[0]!.slots[0]!.check!.boundary = 'business-flow';
    flow.claim_evidence[0]!.slots[0]!.check!.required_boundaries = ['writer persists ticket', 'fresh process reads ticket'];
    expect(prepareDraft(archivedBaselineRoot(), flow).status).toBe('success');

    const focused = singleStepSemanticDraft();
    const selected = focused.claim_evidence[0]!.slots[0]!.check!;
    selected.selection!.selector = 'owner survives reconnect';
    selected.selection!.invocation = { kind: 'structured', argv: ['bun', 'test', 'test/vnext-runtime.test.ts', '--test-name-pattern', 'owner survives reconnect'], selector_arg_index: 4 };
    // The declared focused argv must not accompany the old whole-target entry.
    expect(() => prepareDraft(archivedBaselineRoot(), focused)).toThrow('CLAIM_EVIDENCE_INVOCATION_UNBOUND');
    selected.entry = 'bun test test/vnext-runtime.test.ts --test-name-pattern "owner survives reconnect"';
    focused.implementation_steps[0]!.commands[0]!.command = selected.entry;
    selected.selection!.invocation.selector_arg_index = 2;
    expect(() => prepareDraft(archivedBaselineRoot(), focused)).toThrow('CLAIM_EVIDENCE_SELECTOR_UNBOUND');
    selected.selection!.invocation.selector_arg_index = 4;
    const root = archivedBaselineRoot();
    expect(prepareDraft(root, focused).status).toBe('success');
    const updated = structuredClone(focused);
    updated.claim_evidence[0]!.slots[0]!.slot_id = 'replacement';
    updated.claim_evidence[0]!.slots[0]!.check!.check_id = 'replacement';
    delete updated.claim_evidence[0]!.slots[0]!.check!.selection;
    expect(() => prepareDraft(root, updated)).toThrow('CLAIM_EVIDENCE_SELECTION_REQUIRED');
    updated.claim_evidence[0]!.slots[0]!.check!.selection = structuredClone(selected.selection);
    const refined = prepareDraft(root, updated);
    expect(refined.status).toBe('success');
    expect(confirmDraft(root, { confirmation_receipt: refined.confirmation_receipt }).status).toBe('success');

    for (const [argv, selectorIndex, entry] of [
      [['cargo', 'test', '--test', 'test', 'reconnect_case'], 4, 'cargo test --test test reconnect_case'],
      [['python', '-m', 'unittest', 'ticket.Owner.test_reconnect'], 3, 'python -m unittest ticket.Owner.test_reconnect'],
    ] as const) {
      const otherRunner = singleStepSemanticDraft();
      const otherCheck = otherRunner.claim_evidence[0]!.slots[0]!.check!;
      otherCheck.entry = entry;
      otherCheck.selection!.selector = argv[selectorIndex]!;
      otherCheck.selection!.invocation = { argv: [...argv], selector_arg_index: selectorIndex };
      otherRunner.implementation_steps[0]!.commands[0]!.command = entry;
      expect(prepareDraft(archivedBaselineRoot(), otherRunner).status).toBe('success');
    }

    const broad = singleStepSemanticDraft();
    const selection = broad.claim_evidence[0]!.slots[0]!.check!.selection!;
    Object.assign(selection, { granularity: 'target', selector: null, invocation: { argv: ['bun', 'test', 'test/vnext-runtime.test.ts'], selector_arg_index: null },
      breadth_reason: 'This runner cannot select a case; this target is its smallest invocation.', breadth_basis: 'explicit-user', breadth_source_ref: 'missing:user' });
    expect(() => prepareDraft(archivedBaselineRoot(), broad)).toThrow('TEST_STRATEGY_INVALID');
    broad.task_basis.user_decisions.push({ source: 'test:granularity', verbatim: 'Allow the target because this runner has no finer selector.' });
    selection.breadth_source_ref = 'test:granularity';
    expect(prepareDraft(archivedBaselineRoot(), broad).status).toBe('success');
    selection.breadth_basis = 'project-policy'; selection.breadth_source_ref = 'missing-policy.md';
    expect(() => prepareDraft(archivedBaselineRoot(), broad)).toThrow('TEST_STRATEGY_INVALID');
    const policyRoot = archivedBaselineRoot();
    fs.writeFileSync(path.join(policyRoot, 'release-policy.md'), 'Release gate: run the real end-to-end ticket boundary before release.');
    selection.breadth_source_ref = 'release-policy.md';
    expect(prepareDraft(policyRoot, broad).status).toBe('success');
    selection.breadth_source_ref = '../release-policy.md';
    expect(() => prepareDraft(archivedBaselineRoot(), broad)).toThrow();
    selection.breadth_basis = 'claim-risk-contract'; selection.breadth_source_ref = 'invented-claim';
    expect(() => prepareDraft(archivedBaselineRoot(), broad)).toThrow('CLAIM_EVIDENCE_AUTHORITY_INVALID');
    selection.breadth_source_ref = 'A1';
    expect(prepareDraft(archivedBaselineRoot(), broad).status).toBe('success');

    const release = structuredClone(broad);
    release.claim_evidence[0]!.slots[0]!.check!.boundary = 'e2e';
    const e2e = release.claim_evidence[0]!.slots[0]!.check!.selection!;
    Object.assign(e2e, { breadth_basis: 'release-gate', breadth_source_ref: 'release-policy.md' });
    const releaseRoot = archivedBaselineRoot();
    expect(() => prepareDraft(releaseRoot, release)).toThrow('TEST_STRATEGY_INVALID');
    fs.writeFileSync(path.join(releaseRoot, 'release-policy.md'), 'Release gate requires real end-to-end ticket validation.');
    const prepared = prepareDraft(releaseRoot, release);
    expect(prepared.status).toBe('success');
    expect(confirmDraft(releaseRoot, { confirmation_receipt: prepared.confirmation_receipt }).status).toBe('success');
    Object.assign(e2e, { breadth_basis: null, breadth_source_ref: null, breadth_reason: null });
    expect(() => prepareDraft(archivedBaselineRoot(), { ...release, test_strategy: singleStepSemanticDraft().test_strategy })).toThrow('CLAIM_EVIDENCE_BREADTH_REQUIRED');
  });

  test('process-control review rejects validation selection changes through engineering replacement', () => {
    for (const scenario of ['target-to-focused', 'broad-to-target', 'broad-to-focused', 'selector-change', 'e2e-authority-change']) {
      const draft = singleStepSemanticDraft();
      const check = draft.claim_evidence[0]!.slots[0]!.check!;
      const selection = check.selection!;
      draft.task_basis.user_decisions.push({ source: 'test:other-authority', verbatim: 'A separate verification decision, not an engineering invocation change.' });
      if (scenario.startsWith('target-') || scenario.startsWith('broad-')) {
        selection.granularity = scenario.startsWith('target-') ? 'target' : 'broad-regression';
        selection.selector = null;
        selection.invocation = { argv: ['bun', 'test', 'test/vnext-runtime.test.ts'], selector_arg_index: null };
      }
      if (scenario === 'e2e-authority-change') check.boundary = 'e2e';
      if (selection.granularity !== 'focused' || check.boundary === 'e2e') {
        selection.breadth_reason = 'The exact original verification set was explicitly requested.';
        selection.breadth_basis = 'explicit-user'; selection.breadth_source_ref = draft.task_basis.original_request.source;
      }
      const root = confirmedSemanticRoot(draft);
      const before = readCanonicalCurrentTask(root);
      const replacement = structuredClone(check); replacement.check_id = 'engineering-replacement';
      if (scenario.endsWith('-focused')) {
        replacement.selection!.granularity = 'focused'; replacement.selection!.selector = 'ticket_rule';
        replacement.selection!.breadth_reason = null; replacement.selection!.breadth_basis = null; replacement.selection!.breadth_source_ref = null;
        replacement.entry = 'bun test test/vnext-runtime.test.ts --test-name-pattern ticket_rule';
        replacement.selection!.invocation = { argv: ['bun', 'test', 'test/vnext-runtime.test.ts', '--test-name-pattern', 'ticket_rule'], selector_arg_index: 4 };
      } else if (scenario === 'broad-to-target') replacement.selection!.granularity = 'target';
      else if (scenario === 'selector-change') {
        replacement.entry = 'bun test test/other.test.ts'; replacement.selection!.selector = 'test/other.test.ts';
        replacement.selection!.invocation = { argv: ['bun', 'test', 'test/other.test.ts'], selector_arg_index: 2 };
      } else replacement.selection!.breadth_source_ref = 'test:other-authority';
      expect(() => replaceValidation(root, { source_revision: before.sourceTuple.revision,
        claim_id: draft.claim_evidence[0]!.claim_id, slot_id: draft.claim_evidence[0]!.slots[0]!.slot_id,
        replaces_check_id: check.check_id, replacement_check: replacement, reason: 'Only the launcher should change.' }), scenario)
        .toThrow('VALIDATION_REPLACEMENT_WEAKENED');
      expect(readCanonicalCurrentTask(root).raw, scenario).toBe(before.raw);
    }
  });

  test('process-control review waiver cannot claim an independent planned validation', () => {
    const semantic = singleStepSemanticDraft();
    const own = semantic.implementation_steps[0]!.validation[0]!;
    const independent = 'Independent project policy verification';
    const userClaim = semantic.claim_evidence[0]!;
    userClaim.slots[0]!.check!.validation_items = [own];
    const policy = structuredClone(userClaim);
    policy.claim_id = 'Policy'; policy.claim_kind = 'invariant';
    policy.slots[0]!.slot_id = 'policy'; policy.slots[0]!.check!.check_id = 'policy-check';
    policy.slots[0]!.check!.method = 'static'; policy.slots[0]!.check!.expected_result = 'accepted';
    policy.slots[0]!.check!.entry = 'Inspect independent policy'; delete policy.slots[0]!.check!.selection;
    policy.slots[0]!.check!.validation_items = [independent];
    semantic.claim_evidence.push(policy);
    semantic.implementation_steps[0]!.validation.push(independent);
    const duplicate = structuredClone(semantic); duplicate.claim_evidence[0]!.slots[0]!.check!.validation_items!.push(independent);
    expect(() => prepareDraft(archivedBaselineRoot(), duplicate)).toThrow('CLAIM_EVIDENCE_VALIDATION_UNBOUND');
    const invented = structuredClone(semantic); invented.claim_evidence[0]!.slots[0]!.check!.validation_items = ['Not planned'];
    expect(() => prepareDraft(archivedBaselineRoot(), invented)).toThrow('CLAIM_EVIDENCE_VALIDATION_UNBOUND');
    const root = confirmedSemanticRoot(semantic);
    const before = readCanonicalCurrentTask(root);
    const claim = before.runtimeState.claim_evidence![0]!; const slot = claim.slots[0]!;
    const request = { claim_id: claim.claim_id, slot_id: slot.slot_id, check_id: slot.check!.check_id,
      evidence_plan_revision: before.runtimeState.evidence_plan_revision!, subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision,
      decision_source: 'conversation:waive-one-obligation', decision_text: 'Waive only my requested obligation; do not waive project policy.',
      validation_items: [independent] };
    for (const labels of [[independent], [own, independent]]) {
      expect(recordUserEvidenceDecision(root, 'waiver', { ...request, validation_items: labels }))
        .toMatchObject({ status: 'blocked', code: 'EVIDENCE_WAIVER_TARGET_INVALID' });
      expect(readCanonicalCurrentTask(root).raw).toBe(before.raw);
    }
    const cli = path.join(ROOT, 'runtime/vnext/dist/cli.js');
    const recorded = runInstalledRuntimeCli(cli, root, 'record-evidence-waiver', { ...request, validation_items: [own] });
    expect(recorded.status, recorded.stderr + recorded.stdout).toBe(0);
    expect(recorded.json.status).toBe('success');
    expect(runInstalledRuntimeCli(cli, root, 'evidence-context', {}).json.checks[0].validation_items).toEqual([own]);
    const current = readCanonicalCurrentTask(root);
    const decision = current.runtimeState.claim_evidence![0]!.slots[0]!.user_decision!;
    expect(applicableResultWaiver(root, current, 'step-1', { validation: own }, decision.decision_id)).toEqual(decision);
    expect(applicableResultWaiver(root, current, 'step-1', { validation: independent }, decision.decision_id)).toBeNull();
    // Recheck ownership at consumption too, even for pre-fix stored decisions.
    decision.validation_items!.push(independent);
    expect(applicableResultWaiver(root, current, 'step-1', { validation: independent }, decision.decision_id)).toBeNull();
    const preflight = preflightStep(root, { candidate_paths: [] });
    fs.writeFileSync(path.join(root, 'evidence-report.txt'), 'Independent policy validation failed; user risk decision must not hide it.');
    expect(() => recordStepResult(root, { preflight_receipt: preflight.receipt, actual_changed_paths: [], acceptance_evidence: [],
      command_results: [{ command: slot.check!.entry, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
      validation_results: [{ validation: own, status: 'not-run', evidence_refs: ['evidence-report.txt'], waiver_decision_id: decision.decision_id },
        { validation: independent, status: 'failed', evidence_refs: ['evidence-report.txt'], waiver_decision_id: decision.decision_id }],
      outcome: 'implemented', note: 'An exact user waiver cannot cover the independent policy failure.' }))
      .toThrow('EVIDENCE_WAIVER_RESULT_UNBOUND');
    // No mandatory migration: an old check whose validation is its exact entry
    // has a unique owner without the optional descriptive-label binding.
    const legacy = singleStepSemanticDraft(); const entry = legacy.claim_evidence[0]!.slots[0]!.check!.entry;
    legacy.implementation_steps[0]!.validation = [entry];
    const legacyRoot = confirmedSemanticRoot(legacy); const legacyCurrent = readCanonicalCurrentTask(legacyRoot);
    expect(recordUserEvidenceDecision(legacyRoot, 'waiver', { ...request, validation_items: [entry],
      evidence_plan_revision: legacyCurrent.runtimeState.evidence_plan_revision!,
      subject_revision: captureReviewTarget(legacyRoot, legacy.claim_evidence[0]!.slots[0]!.check!.subject_paths).revision }).status).toBe('success');
  });

  test('process-control review prepareSuccessor retries after real publication interruption', () => {
    for (const interruption of ['before-aggregate', 'after-aggregate']) {
      const root = confirmedSemanticRoot(singleStepSemanticDraft());
      const original = readCanonicalCurrentTask(root); const originalBasis = readCanonicalTaskBasis(root, original);
      expect(applyVNextRuntimeProposal(root, createLifecycleProposal(original, {
        mode: 'supersede', delta: supersedeDelta(), idempotency_key: 'review-successor-supersede',
        authority_evidence: evidence('active-task-owner', 'evidence-admission'), evidence_refs: ['test:evidence:supersede'],
      })).status).toBe('success');
      const before = readCanonicalCurrentTask(root);
      const draft = singleStepSemanticDraft({ goal: 'Explicit replacement surviving a publication crash' });
      const source = 'conversation:successor-crash'; const text = 'Retire the old obligations and prepare this new task; preserve unfinished history.';
      draft.task_basis.user_decisions.push({ source, verbatim: text });
      const predecessor = { task_id: before.runtimeState.task_id, document_id: before.sourceTuple.document_id,
        source_revision: before.sourceTuple.revision, basis_revision: originalBasis.revision,
        decision_source: source, decision_text: text, obligations: predecessorObligationKeys(before).map(prior_key => ({
          prior_key, disposition: 'retired' as const, successor_claim_id: null, reason: 'Explicit retirement, not a PASS.' })) };
      const request = { predecessor, draft };
      const launcherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-successor-crash-')); temporaryRoots.push(launcherRoot);
      const launcher = path.join(launcherRoot, 'crash.ts');
      fs.writeFileSync(launcher, `import { TaskStore } from ${JSON.stringify(path.join(ROOT, 'runtime/vnext/src/task-store.ts'))};
  import { prepareSuccessor } from ${JSON.stringify(path.join(ROOT, 'runtime/vnext/src/prepare-task-adapter.ts'))};
  const original = TaskStore.prototype.ensureInitialized;
  TaskStore.prototype.ensureInitialized = function(current, ...args) {
    if (current.sourceTuple.document_id !== ${JSON.stringify(before.sourceTuple.document_id)}) {
      if (${JSON.stringify(interruption)} === 'after-aggregate') original.call(this, current, ...args);
      throw new Error('injected aggregate publication interruption');
    }
    return original.call(this, current, ...args);
  };
  console.log(JSON.stringify(prepareSuccessor(${JSON.stringify(root)}, ${JSON.stringify(request)})));`);
      const interrupted = spawnSync(process.execPath, [launcher], { encoding: 'utf8' });
      expect(interrupted.status, interrupted.stderr + interrupted.stdout).toBe(0);
      expect(JSON.parse(interrupted.stdout)).toMatchObject({ status: 'blocked', code: 'ATOMIC_COMMIT_FAILED' });
      expect(readCanonicalCurrentTask(root).raw).toBe(before.raw);
      const nextBasis = path.join(path.dirname(originalBasis.filePath), `TASK_BASIS-${String(Number(before.runtimeState.task_id) + 1).padStart(3, '0')}.md`);
      expect(fs.existsSync(nextBasis)).toBe(true);
      const basisBytes = fs.readFileSync(nextBasis, 'utf8');
      fs.writeFileSync(nextBasis, basisBytes + '\nConflicting request.');
      expect(prepareSuccessor(root, request).code).toBe('TASK_BASIS_CONFLICT');
      expect(readCanonicalCurrentTask(root).raw).toBe(before.raw);
      fs.writeFileSync(nextBasis, basisBytes);
      if (interruption === 'after-aggregate') {
        const changed = structuredClone(request); changed.draft.validation_plan.push('A different proposed verification plan');
        expect(prepareSuccessor(root, changed).code).toBe('SUCCESSOR_HISTORY_CONFLICT');
        expect(readCanonicalCurrentTask(root).raw).toBe(before.raw);
      }
      const retried = runInstalledRuntimeCli(path.join(ROOT, 'runtime/vnext/dist/cli.js'), root, 'prepare-successor', request);
      expect(retried.status, interruption + ': ' + retried.stderr + retried.stdout).toBe(0);
      const prepared = retried.json;
      expect(prepared.status, interruption + ': ' + JSON.stringify(prepared)).toBe('success');
      const next = readCanonicalCurrentTask(root);
      expect(next.runtimeState.workflow_status).toBe('draft');
      expect(fs.readFileSync(nextBasis, 'utf8')).toBe(basisBytes);
      expect(fs.readFileSync(originalBasis.filePath, 'utf8')).toBe(originalBasis.content);
      expect(fs.readFileSync(path.join(root, successorSnapshotPath(before.relativePath, before.sourceTuple.document_id, before.sourceTuple.revision)), 'utf8')).toBe(before.raw);
      expect(prepareSuccessor(root, request).status).toBe('no-op');
      expect(() => preflightStep(root, { candidate_paths: [] })).toThrow();
      expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt! }).status).toBe('success');
    }
  });

  test('process-control equivalent validation replacement retains task intent, prior decisions and retry accounting', () => {
    const semantic = singleStepSemanticDraft();
    semantic.claim_evidence[0]!.slots[0]!.check!.validation_items = [...semantic.implementation_steps[0]!.validation];
    const claim = semantic.claim_evidence[0]!;
    const human = structuredClone(claim.slots[0]!);
    human.slot_id = 'manual'; human.check!.check_id = 'manual-check';
    human.check!.method = 'human'; human.check!.expected_result = 'accepted';
    human.check!.entry = 'Inspect the user-visible result'; delete human.check!.selection; delete human.check!.validation_items;
    claim.slots.push(human);
    const root = confirmedSemanticRoot(semantic);
    let current = readCanonicalCurrentTask(root);
    expect(recordUserEvidenceDecision(root, 'human-acceptance', {
      claim_id: claim.claim_id, slot_id: human.slot_id, check_id: human.check!.check_id,
      evidence_plan_revision: current.runtimeState.evidence_plan_revision,
      subject_revision: captureReviewTarget(root, human.check!.subject_paths).revision,
      decision_source: 'conversation:prior-observation', decision_text: 'I checked the visible result; this manual observation is accepted.',
    }).status).toBe('success');
    const original = readCanonicalCurrentTask(root);
    const preflight = preflightStep(root, { candidate_paths: [] });
    const old = original.runtimeState.claim_evidence![0]!.slots[0]!.check!;
    const replacement = structuredClone(old); replacement.check_id = 'check-cwd-replacement';
    replacement.entry = 'bun test --cwd . test/vnext-runtime.test.ts';
    replacement.selection!.invocation = { kind: 'structured', argv: ['bun', 'test', '--cwd', '.', 'test/vnext-runtime.test.ts'], selector_arg_index: 4 };
    const request = () => ({ source_revision: readCanonicalCurrentTask(root).sourceTuple.revision, claim_id: claim.claim_id,
      slot_id: claim.slots[0]!.slot_id, replaces_check_id: old.check_id, replacement_check: replacement,
      reason: 'Specify the same runner working directory without changing the selected test or observation.' });
    expect(() => replaceValidation(root, request())).toThrow('EXECUTE_ATTEMPT_OUTSTANDING');
    fs.writeFileSync(path.join(root, 'evidence-report.txt'), 'Launcher failed before running the selected check.');
    expect(recordStepResult(root, { preflight_receipt: preflight.receipt, actual_changed_paths: [], acceptance_evidence: [],
      command_results: [{ command: old.entry, status: 'failed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
      validation_results: [{ validation: preflight.current_step.validation[0], status: 'failed', evidence_refs: ['evidence-report.txt'] }],
      outcome: 'blocked', note: 'The launcher used a wrong working directory; no successful result is claimed.' }).status).toBe('success');
    current = readCanonicalCurrentTask(root);
    const before = readDraftDefinitionFromBody(current.body);
    const beforeBasis = readCanonicalTaskBasis(root, current);
    const retainedAttempts = structuredClone(current.runtimeState.step_attempts!['step-1']!);
    expect(() => replaceValidation(root, { ...request(), replacement_check: { ...replacement, validation_items: [] } })).toThrow('VALIDATION_REPLACEMENT_WEAKENED');
    const changedMeaning = { ...replacement, expected_observation: 'Weaken the acceptance condition' };
    expect(() => replaceValidation(root, { ...request(), replacement_check: changedMeaning })).toThrow('VALIDATION_REPLACEMENT_WEAKENED');
    const exact = request();
    expect(replaceValidation(root, exact, { dryRun: true }).status).toBe('success');
    expect(readCanonicalCurrentTask(root).raw).toBe(current.raw);
    expect(replaceValidation(root, exact).status).toBe('success');
    const after = readCanonicalCurrentTask(root);
    const afterDefinition = readDraftDefinitionFromBody(after.body);
    expect({ ...afterDefinition, implementation_steps: '' }).toEqual({ ...before, implementation_steps: '' });
    expect(after.runtimeState.task_id).toBe(current.runtimeState.task_id);
    expect(after.sourceTuple.document_id).toBe(current.sourceTuple.document_id);
    expect(after.runtimeState.active_step_id).toBe('step-1');
    expect(after.runtimeState.claim_evidence![0]!.slots[0]!.check!.entry).toBe(replacement.entry);
    expect(after.runtimeState.claim_evidence![0]!.slots[0]!.check!.validation_items).toEqual(old.validation_items);
    expect(after.runtimeState.claim_evidence![0]!.slots[0]!.report).toBeNull();
    expect(after.runtimeState.claim_evidence![0]!.slots[1]!.user_decision).toEqual(original.runtimeState.claim_evidence![0]!.slots[1]!.user_decision);
    expect(evaluateEvidenceSlotForContext(root, after, after.runtimeState.claim_evidence![0]!, after.runtimeState.claim_evidence![0]!.slots[1]!)).toEqual({ satisfied: true, reason: null });
    expect(readCanonicalTaskBasis(root, after).content).toBe(beforeBasis.content);
    const ledger = after.runtimeState.step_attempts!['step-1']!;
    expect(ledger.max_attempts).toBe(retainedAttempts.max_attempts);
    expect(ledger.attempts.slice(0, -1)).toEqual(retainedAttempts.attempts);
    expect(ledger.attempts.at(-1)!.status).toBe('ready');
    expect(replaceValidation(root, exact).status).toBe('no-op');
    const next = preflightStep(root, { candidate_paths: [] });
    expect(next.current_step.commands[0]!.command).toBe(replacement.entry);
    expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toEqual(current.runtimeState.review_cycle);
    expect(recordStepResult(root, { preflight_receipt: next.receipt, actual_changed_paths: [],
      command_results: [{ command: replacement.entry, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
      validation_results: [{ validation: next.current_step.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: [reportFixture(root, claim.claim_id, claim.slots[0]!.slot_id)],
      outcome: 'implemented', note: 'Replacement check has fresh evidence; the independent manual observation is retained.' }).status).toBe('success');
    const review = reviewContext(root, {});
    expect(recordReviewResult(root, { context_receipt: review.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
    expect(completeReviewedStep(root, { step_id: 'step-1', note: 'Same-task verification repaired without redefining the goal.' }).status).toBe('success');
  });

  test('process-control bundled Node CLI exposes task decisions and bounded validation replacement', () => {
    const cli = path.join(ROOT, 'runtime/vnext/dist/cli.js');
    for (const kind of ['human-acceptance', 'waiver'] as const) {
      const semantic = singleStepSemanticDraft(); const planned = semantic.claim_evidence[0]!.slots[0]!;
      if (kind === 'human-acceptance') {
        planned.check!.method = 'human'; planned.check!.expected_result = 'accepted'; delete planned.check!.selection;
      }
      const root = confirmedSemanticRoot(semantic);
      const before = readCanonicalCurrentTask(root); const claim = before.runtimeState.claim_evidence![0]!; const slot = claim.slots[0]!;
      const request = { claim_id: claim.claim_id, slot_id: slot.slot_id, check_id: slot.check!.check_id,
        evidence_plan_revision: before.runtimeState.evidence_plan_revision,
        subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision,
        decision_source: 'conversation:node-cli-user', decision_text: kind === 'waiver' ? 'Accept the unverified risk, not PASS.' : 'I observed and accept this human check.' };
      const command = kind === 'waiver' ? 'record-evidence-waiver' : 'record-human-acceptance';
      const recorded = runInstalledRuntimeCli(cli, root, command, request);
      expect(recorded.status, recorded.stderr + recorded.stdout).toBe(0);
      expect(recorded.json).toMatchObject({ status: 'success', evidence_assurance: 'caller-reported' });
      const after = readCanonicalCurrentTask(root);
      expect(after.runtimeState.claim_evidence![0]!.slots[0]!.user_decision?.kind).toBe(kind);
      const projection = runInstalledRuntimeCli(cli, root, 'evidence-context', {});
      expect(projection.status, projection.stderr).toBe(0);
      expect(projection.json.checks[0].user_decision.kind).toBe(kind);
      expect(runInstalledRuntimeCli(cli, root, command, request).json.status).toBe('no-op');
      expect(after.runtimeState.active_step_status).toBe(before.runtimeState.active_step_status);
    }
    const root = confirmedSemanticRoot(singleStepSemanticDraft());
    const before = readCanonicalCurrentTask(root); const claim = before.runtimeState.claim_evidence![0]!; const slot = claim.slots[0]!;
    const check = structuredClone(slot.check!); check.check_id = 'node-cli-check';
    check.entry = 'bun test --cwd . test/vnext-runtime.test.ts';
    check.selection!.invocation = { kind: 'structured', argv: ['bun', 'test', '--cwd', '.', 'test/vnext-runtime.test.ts'], selector_arg_index: 4 };
    const replaced = runInstalledRuntimeCli(cli, root, 'replace-validation', { source_revision: before.sourceTuple.revision,
      claim_id: claim.claim_id, slot_id: slot.slot_id, replaces_check_id: slot.check!.check_id, replacement_check: check,
      reason: 'Preserve the exact observation and selected test with an explicit working directory.' });
    expect(replaced.status, replaced.stderr + replaced.stdout).toBe(0);
    expect(replaced.json.status).toBe('success');
    expect(readCanonicalCurrentTask(root).sourceTuple.document_id).toBe(before.sourceTuple.document_id);
  });

  test('process-control successor publication retains the predecessor if preparation exits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-successor-publication-')); temporaryRoots.push(root);
    const current = path.join(root, 'CURRENT_TASK.md'); const artifact = path.join(root, 'TASK_BASIS-new.md');
    fs.writeFileSync(current, 'old unfinished task');
    const launcher = path.join(root, 'publish.ts');
    const modulePath = path.resolve(import.meta.dir, '../runtime/vnext/src/task-evolution-io.ts');
    const source = `import { publishPreparedSuccessor } from ${JSON.stringify(modulePath)};
` +
      `publishPreparedSuccessor(${JSON.stringify(current)}, 'old unfinished task', 'new unconfirmed draft',
` +
      `[{path:${JSON.stringify(artifact)},content:'exact new request'}],()=>{process.exit(87)});`;
    fs.writeFileSync(launcher, source);
    const exited = spawnSync(process.execPath, [launcher], { encoding: 'utf8' });
    expect(exited.status, exited.stderr).toBe(87);
    expect(fs.readFileSync(current, 'utf8')).toBe('old unfinished task');
    expect(fs.readFileSync(artifact, 'utf8')).toBe('exact new request');
    fs.writeFileSync(launcher, source.replace('process.exit(87)', ''));
    expect(spawnSync(process.execPath, [launcher], { encoding: 'utf8' }).status).toBe(0);
    expect(fs.readFileSync(current, 'utf8')).toBe('new unconfirmed draft');
  });

  test('process-control successor preserves unfinished history and requires an explicit new draft confirmation', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft());
    const original = readCanonicalCurrentTask(root);
    const oldBasis = readCanonicalTaskBasis(root, original);
    fs.writeFileSync(path.join(root, 'README.md'), 'Retain this partially implemented behavior; do not reset it.');
    const draft = singleStepSemanticDraft({ goal: 'Replace the old task with the explicitly requested direction' });
    const source = 'conversation:explicit-successor';
    const decision = 'Stop the prior direction, retain its unfinished facts and changes, and prepare this replacement for confirmation.';
    draft.task_basis.user_decisions.push({ source, verbatim: decision });
    const beforeRequest = {
      task_id: original.runtimeState.task_id, document_id: original.sourceTuple.document_id,
      source_revision: original.sourceTuple.revision, basis_revision: oldBasis.revision,
      decision_source: source, decision_text: decision, obligations: [],
    };
    expect(() => prepareSuccessor(root, { predecessor: beforeRequest, draft })).toThrow('SUCCESSOR_STATE_INVALID');
    expect(applyVNextRuntimeProposal(root, createLifecycleProposal(original, {
      mode: 'supersede', delta: supersedeDelta(), idempotency_key: 'process-control-supersede',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'), evidence_refs: ['test:evidence:supersede'],
    })).status).toBe('success');
    const superseded = readCanonicalCurrentTask(root);
    const predecessor = { ...beforeRequest, source_revision: superseded.sourceTuple.revision,
      obligations: predecessorObligationKeys(superseded).map(prior_key => ({ prior_key, disposition: 'retired' as const, successor_claim_id: null, reason: 'Explicitly replaced requirement, not a completed result.' })) };
    expect(() => prepareDraft(root, draft)).toThrow('REPLACEMENT_OUTCOME_UNSUPPORTED');
    expect(prepareSuccessor(root, { predecessor: { ...predecessor, source_revision: original.sourceTuple.revision }, draft }).code).toBe('SUCCESSOR_SOURCE_STALE');
    expect(prepareSuccessor(root, { predecessor: { ...predecessor, obligations: [] }, draft }).code).toBe('SUCCESSOR_OBLIGATIONS_INVALID');
    const invented = structuredClone(draft); invented.task_basis.user_decisions = [];
    expect(prepareSuccessor(root, { predecessor, draft: invented }).code).toBe('SUCCESSOR_AUTHORITY_INVALID');
    expect(readCanonicalCurrentTask(root).raw).toBe(superseded.raw);
    const preview = prepareSuccessor(root, { predecessor, draft }, { dryRun: true });
    expect(preview.status).toBe('success');
    expect(readCanonicalCurrentTask(root).raw).toBe(superseded.raw);
    const cliPrepared = runInstalledRuntimeCli(path.join(ROOT, 'runtime/vnext/dist/cli.js'), root, 'prepare-successor', { predecessor, draft });
    expect(cliPrepared.status, cliPrepared.stderr + cliPrepared.stdout).toBe(0);
    const prepared = cliPrepared.json;
    expect(prepared.status).toBe('success');
    const next = readCanonicalCurrentTask(root);
    expect(next.runtimeState.workflow_status).toBe('draft');
    expect(next.runtimeState.task_id).not.toBe(original.runtimeState.task_id);
    expect(next.sourceTuple.document_id).not.toBe(original.sourceTuple.document_id);
    expect(next.runtimeState.claim_evidence![0]!.slots[0]!.report).toBeNull();
    expect(fs.readFileSync(oldBasis.filePath, 'utf8')).toBe(oldBasis.content);
    const snapshot = path.join(root, successorSnapshotPath(superseded.relativePath, superseded.sourceTuple.document_id, superseded.sourceTuple.revision));
    expect(fs.readFileSync(snapshot, 'utf8')).toBe(superseded.raw);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toContain('Retain this partially implemented');
    expect(() => preflightStep(root, { candidate_paths: [] })).toThrow();
    expect(prepareSuccessor(root, { predecessor, draft }).status).toBe('no-op');
    expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt }).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.workflow_status).toBe('active');
    expect(fs.readFileSync(snapshot, 'utf8')).toContain('workflow_status: superseded');
    expect(fs.readFileSync(oldBasis.filePath, 'utf8')).toBe(oldBasis.content);
  });

  test('process-control risk decision skips only its bound verification and preserves real failures through retry', () => {
    const semantic = singleStepSemanticDraft();
    semantic.claim_evidence[0]!.slots[0]!.check!.validation_items = [...semantic.implementation_steps[0]!.validation];
    const root = confirmedSemanticRoot(semantic);
    const preflight = preflightStep(root, { candidate_paths: [] });
    const command = preflight.current_step.commands[0]!.command;
    const validation = preflight.current_step.validation[0]!;
    fs.writeFileSync(path.join(root, 'evidence-report.txt'), 'Actual observed validation failure, retained after the risk decision.');
    const failed = { preflight_receipt: preflight.receipt, actual_changed_paths: [], acceptance_evidence: [],
      command_results: [{ command, status: 'failed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
      validation_results: [{ validation, status: 'failed', evidence_refs: ['evidence-report.txt'] }],
      outcome: 'blocked', note: 'The check failed; do not turn this into PASS.' };
    expect(recordStepResult(root, failed).status).toBe('success');
    const before = readCanonicalCurrentTask(root);
    const claim = before.runtimeState.claim_evidence![0]!; const slot = claim.slots[0]!;
    const request = { claim_id: claim.claim_id, slot_id: slot.slot_id, check_id: slot.check!.check_id,
      evidence_plan_revision: before.runtimeState.evidence_plan_revision!, subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision,
      decision_source: 'conversation:accept-risk', decision_text: 'I accept the unverified risk of this check and its associated validation; retain the actual failure.', validation_items: [validation] };
    expect(recordUserEvidenceDecision(root, 'waiver', { ...request, validation_items: ['Unrelated verification'] }).code).toBe('EVIDENCE_WAIVER_TARGET_INVALID');
    const recorded = recordUserEvidenceDecision(root, 'waiver', request);
    expect(recorded.status, JSON.stringify(recorded)).toBe('success');
    const decided = readCanonicalCurrentTask(root);
    const decision = decided.runtimeState.claim_evidence![0]!.slots[0]!.user_decision!;
    const budget = decided.runtimeState.step_attempts!['step-1']!;
    expect(retryStep(root, { step_id: 'step-1', blocked_attempt_id: budget.attempts.at(-1)!.attempt_id,
      blocker_resolution_refs: [readCanonicalTaskBasis(root).path], idempotency_key: 'risk-accepted-retry' }).status).toBe('success');
    const next = preflightStep(root, { candidate_paths: [] });
    const accepted = { ...failed, preflight_receipt: next.receipt, outcome: 'implemented', note: 'Implemented; required check not run by explicit risk decision, not PASS.',
      command_results: [{ command, status: 'not-run', observed_repo_writes: [], evidence_refs: [readCanonicalTaskBasis(root).path], waiver_decision_id: decision.decision_id }],
      validation_results: [{ validation, status: 'not-run', evidence_refs: [readCanonicalTaskBasis(root).path], waiver_decision_id: decision.decision_id }] };
    expect(() => recordStepResult(root, { ...accepted, command_results: [{ ...accepted.command_results[0], waiver_decision_id: 'fabricated' }] })).toThrow('EVIDENCE_WAIVER_RESULT_UNBOUND');
    expect(recordStepResult(root, accepted).status).toBe('success');
    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.step_attempts!['step-1']!.max_attempts).toBe(budget.max_attempts);
    expect(after.runtimeState.step_attempts!['step-1']!.attempts[0]!.blocker!.execution_result.command_results[0]!.status).toBe('failed');
    expect(after.runtimeState.claim_evidence![0]!.slots[0]!.report).toEqual(slot.report);
    expect(evaluateClaimEvidence(after.runtimeState.claim_evidence!, { root, current: after }).acceptance_satisfied).toBe(true);
    expect(after.runtimeState.pending_review_result).toBeNull();
    const context = reviewContext(root, {});
    expect(recordReviewResult(root, { context_receipt: context.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
    expect(completeReviewedStep(root, { step_id: 'step-1', note: 'Review completed; retained explicit risk is not tested success.' }).status).toBe('success');
    const close = archiveProposal(root, archiveDelta({
      delivery_summary: deliverySummary({ verification: ['Check not run by explicit user risk decision; the original failure remains retained.'] }),
      remaining_risks: ['The waived observation remains unverified.'],
    }));
    const archived = applyVNextRuntimeProposal(root, close);
    expect(archived.status, JSON.stringify(archived)).toBe('success');
    const archivePath = archived.planned_writes.find(item => /TASK-.*\.md$/.test(item));
    expect(archivePath).toBeDefined();
    expect(fs.readFileSync(path.join(root, archivePath!), 'utf8')).toContain('conversation:accept-risk');
  });

  test('process-control user evidence preserves observation, risk and gate semantics', () => {
    for (const kind of ['human-acceptance', 'waiver'] as const) {
      const semantic = singleStepSemanticDraft();
      const plannedSlot = semantic.claim_evidence[0]!.slots[0]!;
      if (kind === 'human-acceptance') {
        plannedSlot.check!.method = 'human'; plannedSlot.check!.expected_result = 'accepted';
        delete plannedSlot.check!.selection;
      }
      const root = confirmedSemanticRoot(semantic);
      const before = readCanonicalCurrentTask(root);
      const claim = before.runtimeState.claim_evidence![0]!;
      const slot = claim.slots[0]!;
      if (kind === 'human-acceptance') {
        const raw = structuredClone(slot);
        raw.disposition = 'newly-executed'; raw.evidence_refs = ['evidence-report.txt'];
        raw.report = reportFixture(root, claim.claim_id, slot.slot_id, 'accepted').report;
        expect(evaluateEvidenceSlotForContext(root, before, claim, raw).satisfied).toBe(false);
      }
      const request = { claim_id: claim.claim_id, slot_id: slot.slot_id, check_id: slot.check!.check_id,
        evidence_plan_revision: before.runtimeState.evidence_plan_revision!,
        subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision,
        decision_source: 'conversation:user-acceptance-1',
        decision_text: kind === 'human-acceptance' ? 'I personally checked the requested behavior and accept this observation.' : 'I waive this exact verification obligation and accept its unverified risk, not a test PASS.' };
      const preview = recordUserEvidenceDecision(root, kind, request, { dryRun: true });
      expect(preview.status, JSON.stringify(preview)).toBe('success');
      expect(readCanonicalCurrentTask(root).raw).toBe(before.raw);
      const result = recordUserEvidenceDecision(root, kind, request);
      expect(result.status, JSON.stringify(result)).toBe('success');
      const after = readCanonicalCurrentTask(root);
      const observed = after.runtimeState.claim_evidence![0]!.slots[0]!;
      expect(readDraftDefinitionFromBody(after.body)).toEqual(readDraftDefinitionFromBody(before.body));
      expect(after.runtimeState.evidence_plan_revision).toBe(before.runtimeState.evidence_plan_revision);
      expect(after.runtimeState.active_step_status).toBe(before.runtimeState.active_step_status);
      expect(after.runtimeState.findings).toEqual(before.runtimeState.findings);
      expect(after.runtimeState.pending_review_result).toEqual(before.runtimeState.pending_review_result);
      expect(readCanonicalTaskBasis(root).basis.user_decisions.at(-1)).toEqual({ source: request.decision_source, verbatim: request.decision_text });
      expect(observed.user_decision).toMatchObject({ kind, assurance: 'caller-reported', check_id: request.check_id });
      if (kind === 'waiver') {
        expect(observed.report).toEqual(slot.report);
        expect(observed.disposition).toEqual(slot.disposition);
        expect(result.state!.recorded_evidence_waivers).toHaveLength(1);
      } else expect(observed.report).toMatchObject({ status: 'accepted', actual_method: 'human', assurance: 'caller-reported' });
      expect(evaluateClaimEvidence(after.runtimeState.claim_evidence!, { root, current: after }).acceptance_satisfied).toBe(true);
      expect(recordUserEvidenceDecision(root, kind, request).status).toBe('no-op');
      fs.appendFileSync(path.join(root, slot.check!.subject_paths[0]!), '\nchanged after user observation');
      expect(evaluateClaimEvidence(after.runtimeState.claim_evidence!, { root, current: after }).acceptance_satisfied).toBe(false);
      expect(recordUserEvidenceDecision(root, kind, { ...request, decision_source: 'conversation:user-acceptance-2' }).status).toBe('blocked');
    }
  });

  test('process-control rejects an incompatible human method and conflicting user source', () => {
    const semantic = singleStepSemanticDraft();
    const root = confirmedSemanticRoot(semantic);
    const current = readCanonicalCurrentTask(root);
    const claim = current.runtimeState.claim_evidence![0]!; const slot = claim.slots[0]!;
    const request = { claim_id: claim.claim_id, slot_id: slot.slot_id, check_id: slot.check!.check_id,
      evidence_plan_revision: current.runtimeState.evidence_plan_revision!, subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision,
      decision_source: 'conversation:user-decision-2', decision_text: 'I have manually checked it.' };
    expect(recordUserEvidenceDecision(root, 'human-acceptance', request)).toMatchObject({ status: 'blocked', code: 'USER_EVIDENCE_METHOD_INVALID' });
    const basis = readCanonicalTaskBasis(root).basis;
    expect(recordUserEvidenceDecision(root, 'waiver', { ...request, decision_source: basis.original_request.source, decision_text: 'Invented replacement of original user statement' }))
      .toMatchObject({ status: 'blocked', code: 'USER_EVIDENCE_SOURCE_INVALID' });
    expect(readCanonicalCurrentTask(root).raw).toBe(current.raw);
  });

  test('shared minimum-sufficient validation matrix', () => {
    // One claim/fixture; each row changes only the dimension under examination.
    // The target contains unrelated cases; selecting it is never the default.
    const cases = [
      { name: 'C1 local rule + business-flow focused slots', mixed: true },
      { name: 'local focused selector' },
      { name: 'local target without reason', target: true, error: 'CLAIM_EVIDENCE_BREADTH_REQUIRED' },
      { name: 'local runner limited to target', target: true, authority: 'user' },
      { name: 'business-flow focused integration case', flow: true },
      { name: 'business-flow target runner limitation', flow: true, target: true, authority: 'user' },
      { name: 'unit PASS cannot replace flow', mixed: true, reportSubstitution: true },
      { name: 'E2E without reason', e2e: true, error: 'CLAIM_EVIDENCE_BREADTH_REQUIRED' },
      { name: 'real release policy requires E2E', e2e: true, authority: 'release' },
      { name: 'forged explicit-user', target: true, authority: 'forged', error: 'TEST_STRATEGY_INVALID' },
      { name: 'Contract authorizes broad without user decision', broad: true, authority: 'contract' },
      { name: 'missing Contract identity', broad: true, authority: 'missing-contract', error: 'CLAIM_EVIDENCE_AUTHORITY_INVALID' },
      { name: 'Contract is not explicit-user', target: true, authority: 'contract-as-user', error: 'TEST_STRATEGY_INVALID' },
      { name: 'focused metadata disagrees with whole-target invocation', mismatch: true, error: 'CLAIM_EVIDENCE_INVOCATION_UNBOUND' },
      { name: 'opaque wrapper preserves command format', target: true, opaque: true, authority: 'user' },
      { name: 'opaque cannot claim Runtime-proven focused', opaque: true, error: 'CLAIM_EVIDENCE_SELECTOR_UNBOUND' },
      { name: 'opaque target still needs reason', target: true, opaque: true, error: 'CLAIM_EVIDENCE_BREADTH_REQUIRED' },
      { name: 'recovery replacement without selection', legacy: true, replacement: true, error: 'CLAIM_EVIDENCE_SELECTION_REQUIRED' },
      { name: 'recovery replacement with new contract', legacy: true, replacement: true, restore: true },
      { name: 'unchanged legacy check', legacy: true },
    ];
    for (const row of cases) {
      const root = archivedBaselineRoot();
      const draft = singleStepSemanticDraft();
      draft.mutation_scope.allowed = ['README.md'];
      draft.implementation_steps[0]!.mutation_scope = ['README.md'];
      const claim = draft.claim_evidence[0]!;
      claim.claim_id = 'C1';
      const rule = claim.slots[0]!;
      rule.slot_id = 'C1-rule'; rule.check!.check_id = 'C1-rule-check';
      rule.check!.subject_paths = ['README.md'];
      const check = rule.check!;
      const selection = check.selection!;
      const focusedCommand = 'bun test test/ticket.test.ts --test-name-pattern ticket_rule';
      check.entry = focusedCommand;
      selection.selector = 'ticket_rule';
      selection.invocation = { kind: 'structured', argv: ['bun', 'test', 'test/ticket.test.ts', '--test-name-pattern', 'ticket_rule'], selector_arg_index: 4 };
      if (row.flow || row.e2e) {
        check.boundary = row.e2e ? 'e2e' : 'business-flow';
        check.required_boundaries = ['writer persists ticket', 'fresh process reads ticket'];
      }
      if (row.target || row.broad) {
        selection.granularity = row.broad ? 'broad-regression' : 'target';
        selection.selector = null;
        selection.invocation = { argv: ['bun', 'test', 'test/ticket.test.ts'], selector_arg_index: null };
        check.entry = 'bun test test/ticket.test.ts';
      }
      if (row.opaque) {
        check.entry = 'pwsh -File scripts/test-ticket.ps1 -Environment test';
        selection.invocation = { kind: 'opaque', command: check.entry };
      }
      if (row.authority) {
        selection.breadth_reason = 'This launcher has no finer selector for the required ticket observation.';
        selection.breadth_basis = 'explicit-user';
        selection.breadth_source_ref = 'test:runner-decision';
        if (row.authority === 'user') draft.task_basis.user_decisions.push({
          source: 'test:runner-decision', verbatim: 'Allow the target: the ticket launcher cannot select individual cases.',
        });
        if (row.authority === 'release') {
          fs.writeFileSync(path.join(root, 'release-policy.md'), '# Release\nReal end-to-end ticket validation is required before release.\n');
          selection.breadth_basis = 'release-gate'; selection.breadth_source_ref = 'release-policy.md#Release';
        }
        if (row.authority.includes('contract')) {
          fs.writeFileSync(path.join(root, 'CONTRACTS.md'), '# C-1: Ticket compatibility\nBroad compatibility validation is required across ticket consumers.\n');
          claim.source_ref = row.authority === 'missing-contract' ? 'CONTRACTS.md#missing' : 'CONTRACTS.md#C-1';
          selection.breadth_basis = 'claim-risk-contract'; selection.breadth_source_ref = 'C1';
          if (row.authority === 'contract-as-user') {
            selection.breadth_basis = 'explicit-user'; selection.breadth_source_ref = claim.source_ref;
          }
        }
      }
      if (row.mismatch) check.entry = 'bun test test/ticket.test.ts';
      if (row.mixed) {
        const flow = structuredClone(rule);
        flow.slot_id = 'C1-flow'; flow.check!.check_id = 'C1-flow-check';
        flow.minimum_type = 'integration-smoke'; flow.check!.boundary = 'business-flow';
        flow.check!.expected_observation = 'A ticket persists across writer and fresh reader processes';
        flow.check!.required_boundaries = ['writer persists ticket', 'fresh process reads ticket'];
        flow.check!.entry = 'bun test test/ticket.test.ts --test-name-pattern ticket_flow';
        flow.check!.selection!.selector = 'ticket_flow';
        flow.check!.selection!.invocation = { kind: 'structured', argv: ['bun', 'test', 'test/ticket.test.ts', '--test-name-pattern', 'ticket_flow'], selector_arg_index: 4 };
        claim.slots.push(flow);
      }
      draft.implementation_steps[0]!.commands = claim.slots.map(slot => ({ command: slot.check!.entry, expected_repo_writes: 'none' }));
      let previous: ClaimEvidenceRecord[] = [];
      if (row.legacy) {
        delete check.selection; delete check.boundary;
        previous = structuredClone(draft.claim_evidence);
        if (row.replacement) {
          check.check_id = 'replacement';
          if (row.restore) { check.selection = selection; check.boundary = 'local'; }
        }
      }
      const admission = () => assertEvidencePlan(semanticDraftDefinition(draft), draft.claim_evidence, !row.legacy,
        { root, taskBasis: draft.task_basis, previous });
      if (row.error) {
        expect(admission, row.name).toThrow(row.error);
        continue;
      }
      expect(admission, row.name).not.toThrow();
      if (row.legacy) {
        expect(readCanonicalCurrentTask(makeRoot(makeRuntimeState({ claim_evidence: previous }))).runtimeState.claim_evidence, row.name).toEqual(previous);
        continue;
      }
      const prepared = prepareDraft(root, draft);
      expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt }).status, row.name).toBe('success');
      const frozen = readCanonicalCurrentTask(root).runtimeState.claim_evidence![0]!;
      expect(frozen, row.name).not.toHaveProperty('boundary');
      expect(frozen.slots, row.name).toEqual(claim.slots);
      if (row.mixed) expect(frozen.slots.map(slot => [slot.slot_id, slot.check!.boundary, slot.check!.selection!.granularity]), row.name)
        .toEqual([['C1-rule', 'local', 'focused'], ['C1-flow', 'business-flow', 'focused']]);
      if (row.opaque) expect(evidenceContext(root, {}).checks[0], row.name).toMatchObject({
        frozen_invocation: check.entry, execution_selection: { invocation: selection.invocation },
      });
      if (row.reportSubstitution) {
        const preflight = preflightStep(root, { candidate_paths: [] });
        const ruleReport = reportFixture(root, 'C1', 'C1-rule');
        const result = { preflight_receipt: preflight.receipt, actual_changed_paths: [],
          command_results: draft.implementation_steps[0]!.commands.map(item => ({
            command: item.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'],
          })),
          validation_results: [{ validation: draft.implementation_steps[0]!.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
          acceptance_evidence: [{ ...ruleReport, slot_id: 'C1-flow' }], outcome: 'implemented', note: 'Matrix caller-reported result fixture' };
        expect(() => recordStepResult(root, result), row.name).toThrow('CLAIM_EVIDENCE_PLAN_CONFLICT');
        expect(recordStepResult(root, { ...result, acceptance_evidence: [ruleReport] }).status, row.name).toBe('success');
        const current = readCanonicalCurrentTask(root);
        expect(current.runtimeState.claim_evidence![0]!.slots[1]!.report, row.name).toBeNull();
        expect(applyVNextRuntimeProposal(root, taskProposal(root, { claim_evidence: current.runtimeState.claim_evidence, idempotency_key: 'matrix-missing-flow' })), row.name)
          .toMatchObject({ status: 'blocked', code: 'CLAIM_EVIDENCE_INCOMPLETE' });
      }
    }
  });

  test('validation contract enforces replacement selection through correction and execution recovery adapters', () => {
    const semantic = singleStepSemanticDraft();
    semantic.mutation_scope.allowed = ['README.md'];
    semantic.implementation_steps[0]!.mutation_scope = ['README.md'];
    semantic.claim_evidence[0]!.slots[0]!.check!.subject_paths = ['README.md'];
    const root = confirmedSemanticRoot(semantic);
    const preflight = preflightStep(root, { candidate_paths: [] });
    const report = reportFixture(root);
    const command = semantic.implementation_steps[0]!.commands[0]!.command;
    const result = { preflight_receipt: preflight.receipt, actual_changed_paths: [],
      command_results: [{ command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
      validation_results: [{ validation: semantic.implementation_steps[0]!.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: [report], outcome: 'implemented', note: 'Observe the original check' };
    expect(recordStepResult(root, { ...result, outcome: 'blocked', command_results: [{ ...result.command_results[0], status: 'blocked' }] })).toMatchObject({ status: 'blocked', code: 'CLAIM_EVIDENCE_RESULT_UNBOUND' });
    expect(recordStepResult(root, result).status).toBe('success');
    const review = reviewContext(root, {});
    expect(review.claim_evidence[0]).toMatchObject({ slots: [{ boundary: 'local', frozen_invocation: command }] });
    expect(review.claim_evidence[0]).not.toHaveProperty('boundary');
    expect(recordReviewResult(root, { context_receipt: review.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
    expect(completeReviewedStep(root, { step_id: 'step-1', note: 'Reviewed the original observation' }).status).toBe('success');
    fs.writeFileSync(path.join(root, 'counterexample.txt'), 'The selected case missed the reconnect failure.');
    expect(recordEvidenceChallenge(root, { claim_id: 'A1', slot_id: 'a1', result_id: report.report.result_id,
      evidence_ref: 'counterexample.txt', evidence_sha256: fileRevision(path.join(root, 'counterexample.txt')), reason: 'A replacement selector is required' }).status).toBe('success');
    const current = readCanonicalCurrentTask(root);
    const replacement = structuredClone(current.runtimeState.claim_evidence![0]!.slots[0]!.check!);
    replacement.check_id = 'replacement';
    const selected = replacement.selection;
    delete replacement.selection;
    const recovery = { challenge_ids: [current.runtimeState.evidence_challenges![0]!.challenge_id],
      correction_step: { id: 'R1', description: 'Verify the replacement case', mutation_scope: semantic.implementation_steps[0]!.mutation_scope,
        commands: [{ command, expected_repo_writes: 'none' }], required_evidence: ['Replacement observation'] },
      obligation_map: [{ claim_id: 'A1', slot_id: 'a1', due_step_id: 'R1', replaces_check_id: 'K1', check: replacement }] };
    expect(() => prepareCorrectionReplan(root, { ...recovery, mode: 'execution-recovery', obligation_map: [
      { ...recovery.obligation_map[0], check: { ...replacement, boundary: 'business-flow', selection: selected } },
    ] })).toThrow('RECOVERY_CHECK_WEAKENED');
    for (const mode of ['conclusion-correction', 'execution-recovery']) {
      expect(() => prepareCorrectionReplan(root, { ...recovery, mode })).toThrow('CLAIM_EVIDENCE_SELECTION_REQUIRED');
    }
    replacement.selection = selected;
    const prepared = prepareCorrectionReplan(root, { ...recovery, mode: 'execution-recovery' });
    expect(confirmCorrectionReplan(root, { candidate_receipt: prepared.candidate_receipt, authorization: {
      approved_candidate_digest: prepared.candidate_receipt.candidate_digest, decision_source: 'test:replacement',
      decision_text: 'Approve the bounded replacement check.', invalidation_reason: 'The old check missed reconnect.' } }).status).toBe('success');
    expect(evidenceContext(root, {}).checks[0]).toMatchObject({ check_id: 'replacement', boundary: 'local', frozen_invocation: command });
  });

  // S2 admission: protects distinct business obligations, current applicability,
  // and Runtime-owned prerequisite consumption through production adapters.
  test('S2 rule success cannot complete or close missing/failed flow; exact reports survive audit but not fixture changes', { timeout: 30000 }, () => {
    const semantic = singleStepSemanticDraft();
    const requirement = 'A valid ticket can be saved and read by a fresh process';
    semantic.task_basis.original_request.verbatim = requirement;
    semantic.claim_evidence[0]!.requirement = requirement;
    semantic.mutation_scope.allowed.push('stored.json');
    semantic.implementation_steps[0]!.mutation_scope.push('stored.json');
    const ruleScript = 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync("fixture.json")); if(x.ticket!=="persisted") process.exit(1); fs.writeFileSync("stored.json",JSON.stringify(x));';
    const flowScript = 'const x=require("./stored.json"); if(x.ticket!=="persisted") process.exit(1);';
    const ruleCommand = `node -e ${JSON.stringify(ruleScript)}`;
    semantic.implementation_steps[0]!.commands = [{ command: ruleCommand, expected_repo_writes: ['stored.json'] }, { command: `node -e ${JSON.stringify(flowScript)}`, expected_repo_writes: 'none' }];
    semantic.implementation_steps[0]!.validation = ['Stored ticket satisfies the admitted schema'];
    const rule = semantic.claim_evidence[0]!.slots[0]!;
    rule.check!.entry = ruleCommand;
    rule.check!.selection = { granularity: 'focused', selector: ruleScript,
      invocation: { argv: ['node', '-e', ruleScript], selector_arg_index: 2 },
      selection_reason: 'Observe the ticket schema rule in this isolated function chain.', breadth_reason: null, breadth_basis: null, breadth_source_ref: null };
    rule.check!.expected_observation = 'The ticket satisfies the persisted schema rule';
    rule.check!.subject_paths = ['fixture.json'];
    const flow = structuredClone(rule);
    flow.slot_id = 'flow'; flow.minimum_type = 'integration-smoke'; flow.check!.check_id = 'flow-check';
    flow.check!.required_boundaries = ['write storage', 'new process reads storage'];
    flow.check!.subject_paths = ['fixture.json', 'stored.json'];
    flow.check!.entry = `node -e ${JSON.stringify(flowScript)}`;
    flow.check!.boundary = 'business-flow';
    flow.check!.expected_observation = requirement;
    flow.check!.selection = {
      granularity: 'focused', selector: flowScript,
      invocation: { argv: ['node', '-e', flowScript], selector_arg_index: 2 },
      selection_reason: 'The claim requires a write followed by a fresh-process read.',
      breadth_reason: null, breadth_basis: null, breadth_source_ref: null,
    };
    semantic.claim_evidence[0]!.slots.push(flow);
    const root = archivedBaselineRoot();
    const ruleOnly = structuredClone(semantic);
    ruleOnly.claim_evidence[0]!.slots.pop();
    ruleOnly.implementation_steps[0]!.commands = [ruleOnly.implementation_steps[0]!.commands[0]!];
    expect(prepareDraft(root, ruleOnly).status).toBe('success');
    const mixedDraft = prepareDraft(root, semantic);
    expect(mixedDraft.status).toBe('success');
    expect(confirmDraft(root, { confirmation_receipt: mixedDraft.confirmation_receipt }).status).toBe('success');
    const frozen = readCanonicalCurrentTask(root).runtimeState.claim_evidence![0]!;
    expect(frozen).not.toHaveProperty('boundary');
    expect(frozen.slots.map(slot => [slot.check!.boundary, slot.check!.selection!.granularity])).toEqual([
      ['local', 'focused'], ['business-flow', 'focused'],
    ]);
    fs.writeFileSync(path.join(root, 'fixture.json'), '{"ticket":"persisted"}');
    const preflight = preflightStep(root, { candidate_paths: ['stored.json'] });
    expect(Bun.spawnSync([process.execPath, '-e', ruleScript], { cwd: root }).exitCode).toBe(0);
    expect(Bun.spawnSync([process.execPath, '-e', flowScript], { cwd: root }).exitCode).toBe(0);
    const ruleReport = reportFixture(root);
    const wrong = { ...ruleReport, slot_id: 'flow' };
    const input = { preflight_receipt: preflight.receipt, actual_changed_paths: ['stored.json'], command_results: [{ command: ruleCommand, status: 'passed', observed_repo_writes: ['stored.json'], evidence_refs: ['evidence-report.txt'] }, { command: flow.check!.entry, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }], validation_results: [{ validation: 'Stored ticket satisfies the admitted schema', status: 'passed', evidence_refs: ['evidence-report.txt'] }], acceptance_evidence: [wrong], outcome: 'implemented', note: 'isolated evidence checks' };
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
      expect(result.status).toBe(0);
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
    expect(initial.checks[0]).toMatchObject({ boundary: 'local', execution_selection: { granularity: 'focused' } });
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
    semantic.claim_evidence[0]!.slots[0]!.check!.selection!.selector = code;
    semantic.claim_evidence[0]!.slots[0]!.check!.selection!.invocation = { argv: ['bun', '-e', code], selector_arg_index: 2 };
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
    const legacyEnvironmentDigest=crypto.createHash('sha256').update(JSON.stringify({blocked_attempt_id:failure.attempt_id,document:blocked.sourceTuple.document_id,plan:blocked.runtimeState.evidence_plan_revision,refs:[resolutionPath],step:'step-1'})).digest('hex');
    expect(recovered.runtimeState.step_attempts!['step-1']!.attempts[1]!.request_digest).toBe(legacyEnvironmentDigest);
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
    // Exercise durable Runtime history past the legacy 256-entry hot window;
    // no canonical editing and no invented additional process executions.
    for (let i=0;i<257;i++) {
      expect(applyVNextRuntimeProposal(root,taskProposal(root,{status:'in-progress',idempotency_key:`retry-audit-${i}`,note:`retained evidence audit ${i}`})).status).toBe('success');
    }
    const durable=readCanonicalCurrentTask(root);
    expect(durable.runtimeState.applied_proposals.some(p=>p.idempotency_key===retryInput.idempotency_key)).toBe(true);
    expect(durable.runtimeState.execution_log.some(e=>!('action' in e) && e.step_id==='step-1' && e.status==='blocked')).toBe(true);
    const durableBytes=fs.readFileSync(durable.filePath,'utf8');
    expect(applyVNextRuntimeProposal(root,raw).status).toBe('no-op');
    expect(retryStep(root,retryInput).status).toBe('no-op');
    expect(fs.readFileSync(durable.filePath,'utf8')).toBe(durableBytes);
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

  test('a confirmed same-plan test error can recover, edit, rerun and retain its failed attempt', () => {
    const file = 'runtime/vnext/src/prepare-task-adapter.ts';
    const command = `bun ${file}`;
    const semantic = singleStepSemanticDraft();
    semantic.implementation_steps[0]!.commands = [{ command, expected_repo_writes: 'none' }];
    semantic.implementation_steps[0]!.validation = [command];
    semantic.claim_evidence[0]!.slots[0]!.check!.entry = command;
    semantic.claim_evidence[0]!.slots[0]!.check!.selection!.selector = file;
    semantic.claim_evidence[0]!.slots[0]!.check!.selection!.invocation = { argv: ['bun', file], selector_arg_index: 1 };
    const root = confirmedSemanticRoot(semantic);
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    const preflight = preflightStep(root, { candidate_paths: [file] });
    fs.writeFileSync(path.join(root, file), 'throw new Error("test asset has a type error")\n');
    const failed = spawnSync('bun', [file], { cwd: root, encoding: 'utf8' });
    expect(failed.status).not.toBe(0);
    fs.writeFileSync(path.join(root, 'failed-check.txt'), failed.stderr);
    expect(recordStepResult(root, {
      preflight_receipt: preflight.receipt, actual_changed_paths: [file],
      command_results: [{ command, status: 'failed', observed_repo_writes: [], evidence_refs: ['failed-check.txt'] }],
      validation_results: [{ validation: command, status: 'not-run', evidence_refs: [] }],
      acceptance_evidence: [], outcome: 'blocked', blocker_kind: 'unknown', note: 'test asset failed before validation',
    }).status).toBe('success');
    const blocked = readCanonicalCurrentTask(root);
    const prior = blocked.runtimeState.step_attempts!['step-1']!.attempts[0]!;
    expect(() => preflightStep(root, { candidate_paths: [file] })).toThrow('PREFLIGHT_BLOCKED');
    const diagnosis = {
      kind: 'same-plan-repair/v1' as const, status: 'confirmed' as const, owner: 'current-step' as const,
      failed_check: command, cause: 'The current step test asset throws before validation.', repair_paths: [file],
    };
    const retry = { step_id: 'step-1', blocked_attempt_id: prior.attempt_id, blocker_resolution_refs: ['failed-check.txt'], repair_diagnosis: diagnosis, idempotency_key: 'same-plan-test-repair-1' };
    expect(retryStep(root, retry)).toMatchObject({ status: 'success', state: { active_step_status: 'ready' } });
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts[0]).toEqual(prior);
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts[1]!.recovery).toEqual(diagnosis);
    expect(retryStep(root, retry).status).toBe('no-op');
    const fresh = preflightStep(root, { candidate_paths: [file] });
    expect(fresh.receipt.attempt_id).not.toBe(preflight.receipt.attempt_id);
    fs.writeFileSync(path.join(root, file), 'process.exit(0)\n');
    const rerun = spawnSync('bun', [file], { cwd: root, encoding: 'utf8' });
    expect(rerun.status).toBe(0);
    fs.writeFileSync(path.join(root, 'rerun-check.txt'), `exit=${rerun.status}`);
    expect(recordStepResult(root, {
      preflight_receipt: fresh.receipt, actual_changed_paths: [file],
      command_results: [{ command, status: 'passed', observed_repo_writes: [], evidence_refs: ['rerun-check.txt'] }],
      validation_results: [{ validation: command, status: 'passed', evidence_refs: ['rerun-check.txt'] }],
      acceptance_evidence: [reportFixture(root)], outcome: 'implemented', note: 'same-plan repair reran the failed check',
    }).status).toBe('success');
    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.step_attempts!['step-1']!.attempts).toHaveLength(2);
    expect(after.runtimeState.step_attempts!['step-1']!.attempts[0]).toEqual(prior);
    expect(after.runtimeState.step_attempts!['step-1']!.attempts[1]!.recovery).toEqual(diagnosis);
  });

  test('same-plan recovery rejects a fabricated failure, extra repair path and changed diagnosis replay', () => {
    const file = 'runtime/vnext/src/prepare-task-adapter.ts';
    const other = 'runtime/vnext/src/other.ts';
    const semantic = singleStepSemanticDraft();
    semantic.mutation_scope.allowed.push(other);
    semantic.implementation_steps[0]!.mutation_scope.push(other);
    const root = confirmedSemanticRoot(semantic);
    const first = preflightStep(root, { candidate_paths: [file, other] });
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '// failed test asset\n');
    expect(recordStepResult(root, {
      preflight_receipt: first.receipt, actual_changed_paths: [file],
      command_results: [{ command: 'bun test test/vnext-runtime.test.ts', status: 'failed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
      validation_results: [{ validation: 'bun test test/vnext-runtime.test.ts passes', status: 'not-run', evidence_refs: [] }],
      acceptance_evidence: [], outcome: 'blocked', blocker_kind: 'unknown', note: 'known local test error',
    }).status).toBe('success');
    const current = readCanonicalCurrentTask(root);
    const failed = current.runtimeState.step_attempts!['step-1']!.attempts[0]!;
    const diagnosis = {
      kind: 'same-plan-repair/v1' as const, status: 'confirmed' as const, owner: 'current-step' as const,
      failed_check: 'bun test test/vnext-runtime.test.ts', cause: 'The local test asset has an invalid expression.', repair_paths: [file],
    };
    const input = { step_id: 'step-1', blocked_attempt_id: failed.attempt_id, blocker_resolution_refs: ['evidence-report.txt'], repair_diagnosis: diagnosis, idempotency_key: 'same-plan-error-1' };
    expect(retryStep(root, { ...input, repair_diagnosis: { ...diagnosis, failed_check: 'never ran' } })).toMatchObject({ status: 'blocked', code: 'RETRY_DIAGNOSIS_REQUIRED' });
    expect(retryStep(root, { ...input, repair_diagnosis: { ...diagnosis, repair_paths: ['src/login.ts'] } })).toMatchObject({ status: 'blocked', code: 'RETRY_SCOPE_BLOCKED' });
    expect(retryStep(root, input).status).toBe('success');
    expect(applyVNextRuntimeProposal(root, createStepPreflightProposal(readCanonicalCurrentTask(root), [file, other]))).toMatchObject({ status: 'blocked', code: 'RETRY_SCOPE_BLOCKED' });
    expect(retryStep(root, { ...input, repair_diagnosis: { ...diagnosis, cause: 'changed after admission' } })).toMatchObject({ status: 'conflict', code: 'RETRY_IDEMPOTENCY_CONFLICT' });
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
    expect(Buffer.byteLength(raw.stdout)).toBeLessThan(512 * 1024);
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
    const semantic = semanticDraft({ project_documents: [{ path: 'docs/REQ.md', section: 'Oracle', revision: 'v1', purpose: 'Required rule behavior' }], affected_contracts: ['docs/REQ.md#Oracle'] });
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
    const preimage = aState.preimages.find(p => p.path === a)!;
    expect(Object.keys(preimage).sort()).toEqual(['path', 'sha256', 'state']);
    expect(preimage.sha256).toBe(crypto.createHash('sha256').update(dirtyBase).digest('hex'));
    expect(fs.readFileSync(reviewPreimageBlobPath(root, preimage.sha256!)).toString()).toBe(dirtyBase);
    const second = preflightStep(root,{candidate_paths:[b]});
    fs.mkdirSync(path.dirname(path.join(root,b)),{recursive:true});
    fs.writeFileSync(path.join(root,b),'export const PRODUCTION_LIMIT = 99;\n');
    const positive = reportFixture(root);
    const results = {command_results:[{command:'bun test test/vnext-runtime.test.ts',status:'passed',observed_repo_writes:[],evidence_refs:['evidence-report.txt']}],validation_results:[{validation:'bun test test/vnext-runtime.test.ts passes',status:'passed',evidence_refs:['evidence-report.txt']}],acceptance_evidence:[positive],outcome:'implemented',note:'integration result'};
    expect(recordStepResult(root,{...results,preflight_receipt:second.receipt,actual_changed_paths:[b]}).status).toBe('success');
    const context = reviewContext(root,{});
    expect(context.project_documents).toEqual(semantic.project_documents!);
    expect(context.affected_contracts).toContain('docs/REQ.md#Oracle');
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
    expect(JSON.parse(rawCli.stdout).runtime_state.review_coverage.preimages.find((item: any) => item.path === a).content_base64).toBeUndefined();
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
    const review={context_receipt:context.receipt,verdict:'blocked',findings:[],unresolved_fingerprints:[],evidence_refs:['evidence-report.txt'],blocker:{code:'PROJECT_DOCUMENT_CONFLICT',summary:'docs/REQ.md#Oracle requires 10; docs/API.md#Oracle requires 99; impact: rule acceptance cannot be determined; decision needed: select governing limit',next_route:'user'}};
    expect(recordReviewResult(root,review).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.pending_review_result?.blocker).toEqual(review.blocker);
    expect(() => completeReviewedStep(root, { step_id: 'step-2', note: null })).toThrow();
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
    semantic.implementation_steps[0]!.commands = [{ command: slot.check!.entry, expected_repo_writes: 'none' }];
    semantic.implementation_steps[0]!.validation = [slot.check!.entry];
    semantic.claim_evidence.push(prerequisite);
    const root = confirmedSemanticRoot(semantic);
    const unconsumed = readCanonicalCurrentTask(root);
    expect(recordUserEvidenceDecision(root, 'waiver', {
      claim_id: prerequisite.claim_id, slot_id: slot.slot_id, check_id: slot.check!.check_id,
      evidence_plan_revision: unconsumed.runtimeState.evidence_plan_revision,
      subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision,
      decision_source: 'conversation:cannot-waive-prerequisite', decision_text: 'Skip this prerequisite.',
    }).code).toBe('EVIDENCE_WAIVER_AUTHORITY_INVALID');
    expect(readCanonicalCurrentTask(root).raw).toBe(unconsumed.raw);
    const first = preflightStep(root, { candidate_paths: ['test/vnext-runtime.test.ts'] });
    const report = reportFixture(root, 'reproduction', 'reproduce', 'expected-failure');
    expect(recordStepResult(root, { preflight_receipt: first.receipt, actual_changed_paths: [], command_results: [{ command: slot.check!.entry, status: 'expected-failure', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'], expected_failure: { kind: 'behavior-not-implemented', expected_behavior: 'defect fixed', observed_failure_signature: 'defect reproduced' } }], validation_results: [{ validation: slot.check!.entry, status: 'expected-failure', evidence_refs: ['evidence-report.txt'], expected_failure: { kind: 'behavior-not-implemented', expected_behavior: 'defect fixed', observed_failure_signature: 'defect reproduced' } }], acceptance_evidence: [report], outcome: 'implemented', note: 'reproduction completed; positive acceptance remains missing' }).status).toBe('success');
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
    const before = readCanonicalCurrentTask(root);
    const preflight = preflightStep(root, { candidate_paths: ['README.md'] });
    fs.writeFileSync(path.join(root, 'README.md'), '# Reviewed documentation');
    const evidence = reportFixture(root, 'A1', 'a1', 'accepted');
    expect(recordStepResult(root, { preflight_receipt: preflight.receipt, actual_changed_paths: ['README.md'], command_results: [], validation_results: [{ validation: 'Review the rendered documentation content', status: 'passed', evidence_refs: ['evidence-report.txt'] }], acceptance_evidence: [evidence], outcome: 'implemented', note: 'static observation' }).status).toBe('success');
    const after = readCanonicalCurrentTask(root);
    expect(after.sourceTuple.revision).not.toBe(before.sourceTuple.revision);
    expect(after.runtimeState.evidence_plan_revision).toBe(before.runtimeState.evidence_plan_revision);
    const summary = spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'validate', '--summary', '--root', root], { encoding: 'utf8' });
    expect(summary.status).toBe(0);
    expect(JSON.parse(summary.stdout).summary.evidence_plan_revision).toBe(before.runtimeState.evidence_plan_revision);
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
    useLegacyInlineCurrent(root);
    const file = readCanonicalCurrentTask(root).filePath;
    const historical = fs.readFileSync(file, 'utf8').replace(/^  business_evidence_version: 1\r?\n/m, '');
    fs.writeFileSync(file, historical);
    expect(readCanonicalCurrentTask(root).runtimeState.business_evidence_version).toBeUndefined();
    expect(() => replan(root, singleStepSemanticDraft())).toThrow('REPLAN_CONFIRMATION_REQUIRED');
    expect(() => preflightStep(root, { candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'] })).toThrow('TASK_SEMANTICS_UPGRADE_REQUIRED');
    expect(applyVNextRuntimeProposal(root, taskProposal(root))).toMatchObject({ status: 'blocked', code: 'TASK_SEMANTICS_UPGRADE_REQUIRED', committed: false });
    expect(JSON.stringify(previewCloseTask(root, archiveDelta()))).toContain('TASK_SEMANTICS_UPGRADE_REQUIRED');
    expect(fs.readFileSync(file, 'utf8')).toBe(historical);
    fs.writeFileSync(file, historical.replace('runtime_state:\n', 'runtime_state:\n  business_evidence_version: 2\n'));
    expect(() => readCanonicalCurrentTask(root)).toThrow('TASK_SEMANTICS_VERSION_UNSUPPORTED');
  });

  test('does not let raw progress bypass an explicit ordering strategy on an existing versioned task', () => {
    const root = confirmedSemanticRoot();
    useLegacyInlineCurrent(root);
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

  test('starts a fresh repair cycle after step advancement and admits a finding from an older installed cycle', { timeout: 30000 }, () => {
    const file = 'runtime/vnext/src/prepare-task-adapter.ts';
    const draft = singleStepSemanticDraft({
      implementation_steps: ['step-1', 'step-2'].map(id => ({
        id, description: `Implement ${id}`, mutation_scope: [file],
        commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' as const }],
        validation: ['bun test test/vnext-runtime.test.ts passes'],
      })),
    });
    for (const legacyCycle of [false, true]) {
      const root = confirmedSemanticRoot(draft);
      const product = path.join(root, file);
      fs.mkdirSync(path.dirname(product), { recursive: true });
      const execute = (step: string, content: string, receipt: ReturnType<typeof preflightStep>['receipt'] | ReturnType<typeof beginRepair>['receipt']) => {
        fs.writeFileSync(product, content, 'utf8');
        return recordStepResult(root, {
          preflight_receipt: receipt, actual_changed_paths: [file],
          command_results: [{ command: 'bun test test/vnext-runtime.test.ts', status: 'passed', observed_repo_writes: [], evidence_refs: ['test:command'] }],
          validation_results: [{ validation: 'bun test test/vnext-runtime.test.ts passes', status: 'passed', evidence_refs: ['test:validation'] }],
          acceptance_evidence: step === 'step-2' && receipt.mode === 'default' ? [reportFixture(root)] : [],
          outcome: 'implemented', note: `execute ${step}`,
        });
      };
      const review = (verdict: 'findings' | 'clean', label: string) => {
        const context = reviewContext(root, {});
        const result = recordReviewResult(root, {
          context_receipt: context.receipt, verdict,
          findings: verdict === 'findings' ? [{
            category: 'traceability', file, failure_condition: `missing ${label}`,
            required_behavior: `record ${label}`, root_cause_status: 'confirmed',
            evidence_refs: ['test:finding'],
          }] : [],
          unresolved_fingerprints: [], evidence_refs: ['test:review', 'test:finding'], blocker: null,
        });
        expect(result.status).toBe('success');
      };

      const first = preflightStep(root, { candidate_paths: [file] });
      expect(execute('step-1', 'initial\n', first.receipt).status).toBe('success');
      review('findings', 'first-step-marker');
      const firstRepair = beginRepair(root, { candidate_paths: [file] });
      expect(execute('step-1', 'first-step-marker\n', firstRepair.receipt).status).toBe('success');
      review('clean', 'first-step-marker');
      const priorCycle = readCanonicalCurrentTask(root).runtimeState.review_cycle;
      expect(completeReviewedStep(root, { step_id: 'step-1', note: null })).toMatchObject({
        status: 'success', advancement: { outcome: 'advanced', to_step_id: 'step-2' },
      });
      const advanced = readCanonicalCurrentTask(root);
      expect(advanced.runtimeState.review_cycle).toMatchObject({
        cycle_phase: 'discovery', repair_round: 0, counted_repair_wave_ids: [], active_repair_wave_id: null,
        verification_new_finding_wave_used: false,
      });
      expect(advanced.runtimeState.review_cycle.id).not.toBe(priorCycle.id);
      expect(advanced.runtimeState.findings.find(item => item.fingerprint === firstRepair.receipt.repair_fingerprints[0])?.status).toBe('resolved');

      if (legacyCycle) {
        useLegacyInlineCurrent(root);
        const raw = fs.readFileSync(advanced.filePath, 'utf8');
        const boundary = raw.indexOf('\n---\n', 4);
        const frontmatter = parse(raw.slice(4, boundary)) as Record<string, any>;
        frontmatter.runtime_state.review_cycle = priorCycle;
        fs.writeFileSync(advanced.filePath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${raw.slice(boundary + 5)}`, 'utf8');
      }
      const second = preflightStep(root, { candidate_paths: [file] });
      expect(execute('step-2', 'second step\n', second.receipt).status).toBe('success');
      review('findings', 'second-step-marker');
      const secondRepair = beginRepair(root, { candidate_paths: [file] });
      expect(secondRepair.status).toBe('pass');
      expect(readCanonicalCurrentTask(root).runtimeState.review_cycle).toMatchObject({
        id: advanced.runtimeState.review_cycle.id, repair_round: 0, cycle_phase: 'discovery',
      });
      expect(execute('step-2', 'second-step-marker\n', secondRepair.receipt).status).toBe('success');
      review('clean', 'second-step-marker');
      expect(completeReviewedStep(root, { step_id: 'step-2', note: null })).toMatchObject({
        status: 'success', advancement: { outcome: 'task-complete' },
      });
    }
  });

  test('does not defer an old repair finding when direct replan is rejected', () => {
    const root = makeRoot(makeRuntimeState({
      findings: [runtimeFinding('finding-historical-repair', 'in-progress')],
    }));
    const initial = readCanonicalCurrentTask(root);
    expect(applyVNextRuntimeProposal(root, createLifecycleProposal(initial, {
      mode: 'supersede', delta: supersedeDelta(), idempotency_key: 'supersede-history',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    })).status).toBe('success');
    const before = readCanonicalCurrentTask(root);
    const bytes = fs.readFileSync(before.filePath, 'utf8');
    expect(applyVNextRuntimeProposal(root, replanProposal(root, 'commit-replan', 'replan-history', {
      claim_evidence: completeClaimEvidence(),
    }))).toMatchObject({ status: 'blocked', code: 'REPLAN_CONFIRMATION_REQUIRED' });
    expect(fs.readFileSync(before.filePath, 'utf8')).toBe(bytes);
    expect(readCanonicalCurrentTask(root).runtimeState.findings[0]?.status).toBe('in-progress');
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
    function inspection(step: string): ClaimEvidenceRecord[] {
      const claims = evidencePlanFixture('The semantic adapter persists and reads back a canonical draft', step);
      const check = claims[0]!.slots[0]!.check!;
      check.method = 'static'; check.expected_result = 'accepted'; check.entry = 'inspect the implementation';
      delete check.selection;
      return claims;
    }
    const missingRoot = archivedBaselineRoot();
    const { test_strategy: _omitted, ...withoutStrategy } = semanticDraft();
    expect(() => prepareDraft(missingRoot, withoutStrategy)).toThrow('PREPARE_ADAPTER_INPUT_INVALID');
    expect(readCanonicalCurrentTask(missingRoot).runtimeState.workflow_status).toBe('closed');

    const noTestsRoot = archivedBaselineRoot();
    expect(() => prepareDraft(noTestsRoot, semanticDraft({
      claim_evidence: inspection('implementation-only'),
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
      claim_evidence: inspection('implementation-first-by-mistake'),
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
      claim_evidence: inspection('mixed-test-and-product'),
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

  test('document conflict remains unconfirmable until a cited user decision is saved with its sources', () => {
    const root = archivedBaselineRoot();
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/REQ.md'), '# Retry\nAt most two retries.\n');
    fs.writeFileSync(path.join(root, 'docs/API.md'), '# Retry\nAt most five retries.\n');
    const sources = ['REQ', 'API'].map(name => ({
      path: `docs/${name}.md`, section: 'Retry',
      revision: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, `docs/${name}.md`))).digest('hex'),
      purpose: 'Defines the retry limit',
    }));
    const conflict = 'docs/REQ.md#Retry requires 2; docs/API.md#Retry requires 5; impact: retry acceptance and implementation; decision needed: which limit governs?';
    const input = semanticDraft({ project_documents: sources, affected_contracts: ['docs/API.md#Retry'], design_decisions: { decided: [], unresolved: [conflict] } });
    const prepared = prepareDraft(root, input);
    expect(prepared.status).toBe('success');
    expect(readCanonicalCurrentTask(root).body).toContain(conflict);
    expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt })).toMatchObject({ status: 'blocked', code: 'DRAFT_DECISION_UNRESOLVED', committed: false });
    const decision = { source: 'test:user-retry-decision', verbatim: 'Use two retries; the five-retry API text is superseded for this change.' };
    const resolved = { ...input,
      task_basis: { ...input.task_basis, user_decisions: [...input.task_basis.user_decisions, decision] },
      design_decisions: { decided: [conflict + ' Resolution: use 2 per test:user-retry-decision; update the affected contract in the authorized plan.'], unresolved: [] },
    };
    const refined = prepareDraft(root, resolved);
    expect(refined.status).toBe('success');
    expect(confirmDraft(root, { confirmation_receipt: refined.confirmation_receipt }).status).toBe('success');
    const current = readCanonicalCurrentTask(root);
    expect(readCanonicalTaskBasis(root, current).basis.user_decisions).toContainEqual(decision);
    expect(readProjectDocuments(readDraftDefinitionFromBody(current.body).background_context)).toEqual(sources);
    expect(() => prepareDraft(root, resolved)).toThrow('PREPARE_DRAFT_STATE_INVALID');
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

  test('wraps resume review and rejects the disabled public replan path', () => {
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
    expect(() => replan(activeReplanRoot, semanticDraft())).toThrow('REPLAN_CONFIRMATION_REQUIRED');
    expect(fs.readFileSync(readCanonicalCurrentTask(activeReplanRoot).filePath, 'utf8')).toBe(activeBytes);

    const replanRoot = makeRoot(makeRuntimeState({
      workflow_status: 'superseded',
      lifecycle_state: 'active',
    }));
    const replanInput = semanticDraft({ project_documents: [{ path: 'docs/PLAN.md', section: 'S2', revision: 'v2', purpose: 'Replacement plan' }], affected_contracts: [] });
    const current = readCanonicalCurrentTask(replanRoot);
    const before = fs.readFileSync(current.filePath, 'utf8');
    expect(() => replan(replanRoot, replanInput)).toThrow('REPLAN_CONFIRMATION_REQUIRED');
    expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before);
  });

  test('validate refuses a directly drifted plan and rejected replan cannot legitimize it', () => {
    const root = confirmedSemanticRoot();
    useLegacyInlineCurrent(root);
    const initial = readCanonicalCurrentTask(root);
    const validate = (summary: boolean) => spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'validate', ...(summary ? ['--summary'] : []), '--root', root], { encoding: 'utf8' });
    expect(validate(true).status).toBe(0);
    const original = fs.readFileSync(initial.filePath, 'utf8');
    fs.writeFileSync(initial.filePath, original.replace('Do not refactor unrelated Runtime handlers', 'Do not refactor unrelated Runtime handlers or fixtures'));
    for (const summary of [true, false]) {
      const result = validate(summary);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('CLAIM_EVIDENCE_STALE');
    }
    fs.writeFileSync(initial.filePath, original);
    const supersede = createLifecycleProposal(readCanonicalCurrentTask(root), {
      mode: 'supersede', delta: supersedeDelta(), idempotency_key: 'bounded-read-supersede',
      authority_evidence: evidence('active-task-owner', 'evidence-admission'),
      evidence_refs: ['test:evidence:supersede'],
    });
    expect(applyVNextRuntimeProposal(root, supersede).status).toBe('success');
    const superseded = readCanonicalCurrentTask(root);
    const bytes = fs.readFileSync(superseded.filePath, 'utf8');
    expect(() => replan(root, singleStepSemanticDraft({
      goal: 'Add the prepare-task Runtime adapter with revised scope',
      project_documents: [], affected_contracts: [],
    }))).toThrow('REPLAN_CONFIRMATION_REQUIRED');
    expect(fs.readFileSync(superseded.filePath, 'utf8')).toBe(bytes);
    expect(superseded.runtimeState.evidence_plan_revision).toBe(initial.runtimeState.evidence_plan_revision);
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
        'extend-preflight',
        'evidence-context',
      'retry-step',
      'begin-repair',
      'record-step-result',
      'complete-reviewed-step',
    ]);
    expect(contract.proposal.execute_step.semantic_adapter.scope_enforcement).toBe('task-authority-envelope-with-v1-step-compatibility');
    expect(contract.proposal.execute_step.semantic_adapter.completion_evidence_source).toBe('recorded-step-result-only');
    expect(contract.proposal.execute_step.semantic_adapter.change_detection).toBe('runtime-preflight-candidate-before-after-delta');
    expect(contract.proposal.execute_step.semantic_adapter.advancement_owner).toBe('runtime');
    expect(contract.proposal.execute_step.semantic_adapter.post_completion_commit_owner).toBe('user-or-explicit-outer-orchestrator');
    expect(contract.proposal.execute_step.semantic_adapter.post_completion_route).toBe('git-commit');
    expect(contract.proposal.execute_step.semantic_adapter.test_strategy_execution).toEqual({
      phase_source: 'versioned-frozen-test-strategy-and-current-step-evidence-obligation',
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
    expect(contract.proposal.review_change.semantic_adapter.reviewable_execution).toBe('implemented-or-test-red-awaiting-required-checkpoint-or-dynamic-review-or-repair-verification');
    expect(contract.proposal.review_change.semantic_adapter.review_target).toBe('runtime-cumulative-before-after-file-delta');
    expect(contract.proposal.prepare_task.semantic_adapter.decision_partition).toEqual({
      decided: 'confirmed_decisions',
      unresolved: 'open_questions',
    });
    expect(contract.proposal.prepare_task.semantic_adapter.command_footprint_preflight).toEqual({
      source: 'implementation_steps[].commands',
      fields: ['command', 'expected_repo_writes'],
      evaluator: 'shared-mutation-scope-evaluator-and-v2-authority-evaluator',
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
    expect(result.status, result.stderr).toBe(0);
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

  test('G09 G20 recovery replaces a check identity and binds a new prerequisite consumer without copying old consumption', { timeout: 30000 }, () => {
    const claims = evidencePlanFixture('The document observation stays verified', 'S1');
    claims[0]!.slots[0]!.check!.subject_paths = ['README.md'];
    const prerequisite = structuredClone(claims[0]!);
    prerequisite.claim_id = 'I1'; prerequisite.claim_kind = 'invariant';
    prerequisite.slots[0]!.slot_id = 'i1'; prerequisite.slots[0]!.check!.check_id = 'K-I1';
    prerequisite.slots[0]!.applicability = 'before-step'; prerequisite.slots[0]!.before_step_id = 'S2';
    const input = semanticDraft({ claim_evidence: [...claims, prerequisite], persistent_tests: 'none',
      mutation_scope: { allowed: ['README.md'], conditional: [], forbidden: ['.git/**'] },
      implementation_steps: ['S1', 'S2', 'S3'].map(id => ({ id, description: `Verify ${id}`, mutation_scope: ['README.md'], commands: [], validation: [`Validate ${id}`], review_checkpoint: { policy: 'required', reason: 'Review the document observation' } })) });
    const root = confirmedSemanticRoot(input);
    fs.writeFileSync(path.join(root, 'README.md'), 'Observation\n');
    function execute(id: string, withReports: boolean) {
      const preflight = preflightStep(root, { candidate_paths: ['README.md'] });
      const acceptance = withReports ? [reportFixture(root), reportFixture(root, 'I1', 'i1')] : [];
      for (const report of acceptance) { report.report.result_id += `-${id}`; report.report.status = readCanonicalCurrentTask(root).runtimeState.claim_evidence!.find(claim => claim.claim_id === report.claim_id)!.slots[0]!.check!.expected_result; }
      expect(recordStepResult(root, { preflight_receipt: preflight.receipt, actual_changed_paths: [], command_results: [], validation_results: [{ validation: `Validate ${id}`, status: 'passed', evidence_refs: ['evidence-report.txt'] }], acceptance_evidence: acceptance, outcome: 'implemented', note: `Observed ${id}` }).status).toBe('success');
      const review = reviewContext(root, {});
      expect(recordReviewResult(root, { context_receipt: review.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: id, note: `Reviewed ${id}` }).status).toBe('success');
    }
    execute('S1', true); execute('S2', false);
    const old = readCanonicalCurrentTask(root);
    const oldReceipt = structuredClone(old.runtimeState.claim_evidence![1]!.slots[0]!.prerequisite_receipt);
    expect(oldReceipt?.step_id).toBe('S2');
    fs.writeFileSync(path.join(root, 'counterexample.txt'), 'The observation requires a revised check.\n');
    recordEvidenceChallenge(root, { claim_id: 'A1', slot_id: 'a1', result_id: old.runtimeState.claim_evidence![0]!.slots[0]!.report!.result_id,
      evidence_ref: 'counterexample.txt', evidence_sha256: fileRevision(path.join(root, 'counterexample.txt')), reason: 'Reassess the observation boundary' });
    const recovery = { id: 'R1', description: 'Revalidate observation', mutation_scope: ['README.md'], commands: [], required_evidence: ['Validate R1'] };
    const replacementCheck = { ...prerequisite.slots[0]!.check!, check_id: 'K-I2', method: 'static', expected_result: 'accepted' };
    const candidateInput = { challenge_ids: [readCanonicalCurrentTask(root).runtimeState.evidence_challenges![0]!.challenge_id], correction_step: recovery,
      pending_step_changes: { steps: [{ ...recovery, id: 'S3-new', required_evidence: ['Validate S3-new'] }], step_map: [{ old_step_id: 'S3', new_step_ids: ['S3-new'] }] },
      obligation_map: [{ claim_id: 'A1', slot_id: 'a1', due_step_id: 'R1' }, { claim_id: 'I1', slot_id: 'i1', due_step_id: 'R1', before_step_id: 'S3-new', replaces_check_id: 'K-I1', check: replacementCheck }] };
    expect(() => prepareCorrectionReplan(root, { ...candidateInput, obligation_map: [candidateInput.obligation_map[0], { ...candidateInput.obligation_map[1], check: { ...replacementCheck, check_id: 'K-I1' } }] })).toThrow('RECOVERY_CHECK_ID_REUSED');
    const prepared = prepareCorrectionReplan(root, candidateInput);
    confirmCorrectionReplan(root, { candidate_receipt: prepared.candidate_receipt, authorization: { approved_candidate_digest: prepared.candidate_receipt.candidate_digest,
      decision_source: 'fixture:recovery', decision_text: 'Approve the new check and consumer while preserving all requirements.', invalidation_reason: 'A bounded check replacement is required.' } });
    expect(readCanonicalCurrentTask(root).runtimeState.claim_evidence![1]!.slots[0]!.prerequisite_receipt).toBeUndefined();
    execute('R1', true); execute('S3-new', false);
    const nextReceipt = readCanonicalCurrentTask(root).runtimeState.claim_evidence![1]!.slots[0]!.prerequisite_receipt;
    expect(nextReceipt?.step_id).toBe('S3-new');
    expect(nextReceipt?.preflight_id).not.toBe(oldReceipt?.preflight_id);
  });

  test('keeps original audit obligations while confirming a bounded correction before the original next step', { timeout: 30000 }, () => {
    const audited = evidencePlanFixture('Nine issue conclusions remain verified', 'S3');
    audited[0]!.slots[0]!.check!.subject_paths = ['docs/audit.md'];
    const unaffected = structuredClone(audited[0]!);
    unaffected.claim_id = 'I1';
    unaffected.claim_kind = 'invariant';
    unaffected.requirement = 'The independent issue observation remains valid';
    unaffected.slots[0]!.slot_id = 'i1';
    unaffected.slots[0]!.check!.check_id = 'K2';
    unaffected.slots[0]!.check!.subject_paths = ['docs/other.md'];
    const input = semanticDraft({
      task_basis: taskBasisFixture('Audit the Rust issue ledger, preserve all claims, then run S4'),
      goal: 'Audit the Rust issue ledger and then run S4',
      claim_evidence: [audited[0]!, unaffected],
      mutation_scope: { allowed: ['docs/audit.md', 'docs/other.md'], conditional: [], forbidden: ['.git/**'] },
      implementation_steps: [
        { id: 'S3', description: 'Audit the issue ledger', mutation_scope: ['docs/audit.md'], commands: [], validation: ['Issue audit report is recorded'], review_checkpoint: { policy: 'not-required', reason: 'S4 reviews cumulative audit changes' } },
        { id: 'S4', description: 'Evaluate static reuse after the audit', mutation_scope: ['docs/audit.md', 'docs/other.md'], commands: [], validation: ['Original S4 evaluation remains required'], review_checkpoint: { policy: 'required', reason: 'Review cumulative audit and reuse decision' } },
      ],
      persistent_tests: 'none',
    });
    const root = confirmedSemanticRoot(input);
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.appendFileSync(path.join(root, '.workflow-system/PROJECT_PROFILE.yaml'), '    - docs/audit.md\n    - docs/other.md\n');
    fs.writeFileSync(path.join(root, 'docs', 'audit.md'), 'old audit result\n');
    fs.writeFileSync(path.join(root, 'docs', 'other.md'), 'independent observation\n');
    fs.writeFileSync(path.join(root, 'independent-evidence.txt'), 'Independent observation evidence.\n');
    fs.writeFileSync(path.join(root, 'docs', 'challenge.md'), 'External review: public cursor result is unsupported.\n');
    const confirmed = readCanonicalCurrentTask(root);
    const legacyFrontmatter = structuredClone(confirmed.frontmatter);
    delete legacyFrontmatter.task_store;
    legacyFrontmatter.runtime_state = {
      ...legacyFrontmatter.runtime_state,
      execution_log: confirmed.runtimeState.execution_log,
      applied_proposals: confirmed.runtimeState.applied_proposals,
    };
    fs.writeFileSync(confirmed.filePath, `---\n${stringify(legacyFrontmatter).trimEnd()}\n---\n${confirmed.body}`, 'utf8');
    fs.rmSync(path.join(root, 'docs', 'workflow', 'task-data', confirmed.sourceTuple.document_id), { recursive: true, force: true });
    const legacy = readCanonicalCurrentTask(root);
    const claims = structuredClone(legacy.runtimeState.claim_evidence!);
    for (const claim of claims) for (const slot of claim.slots) {
      slot.disposition = 'newly-executed';
      slot.evidence_refs = ['independent-evidence.txt'];
      slot.report = { result_id: `result-${slot.check!.check_id}`, status: 'passed', evidence_plan_revision: confirmed.runtimeState.evidence_plan_revision!,
        subject_revision: captureReviewTarget(root, slot.check!.subject_paths).revision, actual_method: slot.check!.method,
        environment: 'isolated audit fixture', assurance: 'caller-reported' };
    }
    const state = { ...confirmed.runtimeState, active_step_id: 'S4', active_step_status: 'ready' as const, claim_evidence: claims };
    const frontmatter = { ...legacy.frontmatter, runtime_state: state };
    fs.writeFileSync(legacy.filePath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${legacy.body}`, 'utf8');
    const beforeLegacy = readCanonicalCurrentTask(root);
    commitTaskStorageMigration(root, beforeLegacy, beforeLegacy.sourceTuple.revision);
    const before = readCanonicalCurrentTask(root);
    const challenged = recordEvidenceChallenge(root, { claim_id: 'A1', slot_id: 'a1', result_id: 'result-K1', evidence_ref: 'docs/challenge.md',
      evidence_sha256: fileRevision(path.join(root, 'docs', 'challenge.md')), reason: 'The public cursor boundary was not observed' });
    expect(challenged.status).toBe('success');
    expect(recordEvidenceChallenge(root, { claim_id: 'A1', slot_id: 'a1', result_id: 'result-K1', evidence_ref: 'docs/challenge.md',
      evidence_sha256: fileRevision(path.join(root, 'docs', 'challenge.md')), reason: 'The public cursor boundary was not observed' }).status).toBe('no-op');
    const firstChallengedCurrent = readCanonicalCurrentTask(root);
    expect(() => assertOrdinaryPreflight(firstChallengedCurrent, root)).toThrow('EVIDENCE_CHALLENGE_UNRESOLVED');
    const challengeId = firstChallengedCurrent.runtimeState.evidence_challenges![0]!.challenge_id;
    fs.writeFileSync(path.join(root, 'docs', 'assessment.md'), 'The independent observation covers the disputed result and the counterexample does not apply.\n');
    const independent = recordEvidenceChallenge(root, { claim_id: 'I1', slot_id: 'i1', result_id: 'result-K2', evidence_ref: 'docs/challenge.md',
      evidence_sha256: fileRevision(path.join(root, 'docs', 'challenge.md')), reason: 'Check whether the independent observation also fails' });
    expect(independent.status).toBe('success');
    const independentId = readCanonicalCurrentTask(root).runtimeState.evidence_challenges![1]!.challenge_id;
    const assessment = { challenge_id: independentId, evidence_ref: 'docs/assessment.md',
      evidence_sha256: fileRevision(path.join(root, 'docs', 'assessment.md')), reason: 'The cited counterexample does not affect independent K2' };
    expect(dismissEvidenceChallenge(root, { ...assessment, evidence_sha256: '0'.repeat(64) })).toMatchObject({ status: 'blocked', code: 'EVIDENCE_CHALLENGE_SOURCE_STALE' });
    expect(dismissEvidenceChallenge(root, assessment).status).toBe('success');
    expect(dismissEvidenceChallenge(root, assessment).status).toBe('no-op');
    expect(readCanonicalCurrentTask(root).runtimeState.evidence_challenges?.[1]?.resolution?.kind).toBe('not-substantiated');
    expect(readCanonicalCurrentTask(root).runtimeState.claim_evidence?.[1]?.slots[0]?.report?.result_id).toBe('result-K2');
    const challengedCurrent = readCanonicalCurrentTask(root);
    const challengedBytes = fs.readFileSync(challengedCurrent.filePath);
    const candidateInput = { challenge_id: challengeId, correction_step: { id: 'S3-C1', description: 'Recheck challenged public cursor conclusion',
      mutation_scope: ['docs/audit.md'], required_evidence: ['Targeted public cursor observation'], commands: [] } };
    const candidate = prepareCorrectionReplan(root, candidateInput);
    expect(candidate.status).toBe('success');
    expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(challengedCurrent.sourceTuple.revision);
    expect(() => prepareCorrectionReplan(root, { ...candidateInput, correction_step: { ...candidateInput.correction_step, mutation_scope: ['src/login.ts'] } })).toThrow('REPLAN_SCOPE_EXPANSION');
    const receipt = candidate.candidate_receipt;
    const authorization = { approved_candidate_digest: receipt.candidate_digest, decision_source: 'user:explicit-correction',
      decision_text: 'Approve only S3-C1 correction of the challenged result before original S4; preserve all original audit obligations.',
      invalidation_reason: 'Independent counterevidence invalidates the old public cursor conclusion.' };
    expect(() => confirmCorrectionReplan(root, { candidate_receipt: { ...receipt, obligations_digest: '0'.repeat(64) }, authorization })).toThrow('REPLAN_OBLIGATIONS_STALE');
    fs.writeFileSync(path.join(root, 'docs', 'other.md'), 'changed independent observation\n');
    expect(() => confirmCorrectionReplan(root, { candidate_receipt: receipt, authorization })).toThrow('CLAIM_EVIDENCE_STALE');
    fs.writeFileSync(path.join(root, 'docs', 'other.md'), 'independent observation\n');
    const candidatePath = path.join(root, ...candidate.candidate_path.split('/'));
    const candidateBytes = fs.readFileSync(candidatePath, 'utf8');
    fs.writeFileSync(candidatePath, candidateBytes.replace('Nine issue conclusions remain verified', 'Drop old acceptance'));
    expect(() => confirmCorrectionReplan(root, { candidate_receipt: receipt, authorization })).toThrow('REPLAN_CANDIDATE_INVALID');
    fs.writeFileSync(candidatePath, candidateBytes);
    const committed = confirmCorrectionReplan(root, { candidate_receipt: receipt, authorization });
    expect(committed.status).toBe('success');
    expect(committed.read_back_verified).toBe(true);
    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.task_id).toBe(before.runtimeState.task_id);
    expect(after.runtimeState.active_step_id).toBe('S3-C1');
    expect(after.body).toContain('- S4: Evaluate static reuse after the audit');
    expect(after.runtimeState.claim_evidence?.map(item => item.claim_id)).toEqual(['A1', 'I1']);
    expect(after.runtimeState.claim_evidence?.[0]?.slots[0]?.report).toBeNull();
    expect(after.runtimeState.claim_evidence?.[1]?.slots[0]?.report?.result_id).toBe('result-K2');
    expect(after.runtimeState.evidence_carry_forward).toHaveLength(1);
    expect(after.runtimeState.evidence_challenges?.[0]?.status).toBe('invalidated');
    expect(readCanonicalTaskBasis(root, after).basis.user_decisions.at(-1)?.verbatim).toBe(authorization.decision_text);
    const historyPath = path.join(root, 'docs', 'workflow', 'task-history', after.sourceTuple.document_id, `${challengedCurrent.sourceTuple.revision}.json`);
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    expect(history.operation).toBe('confirm-replan');
    expect(Buffer.from(history.current_task_base64, 'base64')).toEqual(challengedBytes);
    expect(confirmCorrectionReplan(root, { candidate_receipt: receipt, authorization }).status).toBe('no-op');
    expect(() => assertOrdinaryPreflight(after, root)).not.toThrow();
    const correctionPreflight = preflightStep(root, { candidate_paths: ['docs/audit.md'] });
    fs.writeFileSync(path.join(root, 'docs', 'audit.md'), 'corrected public cursor conclusion\n');
    const correctionReport = reportFixture(root);
    correctionReport.report.result_id = 'result-K1-correction';
    expect(recordStepResult(root, {
      preflight_receipt: correctionPreflight.receipt,
      actual_changed_paths: ['docs/audit.md'],
      command_results: [],
      validation_results: [{ validation: 'Targeted public cursor observation', status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: [correctionReport],
      outcome: 'implemented', note: 'Correct only challenged audit conclusion',
    }).status).toBe('success');
    const review = reviewContext(root, {});
    expect(review.receipt.step_id).toBe('S3-C1');
    expect(recordReviewResult(root, { context_receipt: review.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
    expect(completeReviewedStep(root, { step_id: 'S3-C1', note: 'Corrected report reviewed' })).toMatchObject({
      status: 'success', advancement: { outcome: 'advanced', to_step_id: 'S4' },
    });
    const resumed = readCanonicalCurrentTask(root);
    expect(resumed.runtimeState.active_step_id).toBe('S4');
    expect(resumed.runtimeState.evidence_challenges?.[0]?.status).toBe('resolved');
    expect(resumed.runtimeState.claim_evidence?.[1]?.slots[0]?.report?.result_id).toBe('result-K2');
    // A -> B -> C must retain A's original report, rather than relabel it as B.
    const originalReport = structuredClone(resumed.runtimeState.claim_evidence![1]!.slots[0]!.report);
    fs.writeFileSync(path.join(root, 'docs', 'challenge-2.md'), 'A second bounded counterexample.\n');
    recordEvidenceChallenge(root, { claim_id: 'A1', slot_id: 'a1', result_id: 'result-K1-correction',
      evidence_ref: 'docs/challenge-2.md', evidence_sha256: fileRevision(path.join(root, 'docs', 'challenge-2.md')),
      reason: 'A second counterexample requires a new observation' });
    const secondChallenge = readCanonicalCurrentTask(root).runtimeState.evidence_challenges!.at(-1)!;
    const second = prepareCorrectionReplan(root, { challenge_id: secondChallenge.challenge_id,
      correction_step: { ...candidateInput.correction_step, id: 'S3-C2' } });
    const secondPayload = JSON.parse(fs.readFileSync(path.join(root, second.candidate_path), 'utf8'));
    expect(secondPayload.carry_forward[0].old_plan_revision).toBe(originalReport!.evidence_plan_revision);
    expect(secondPayload.claim_evidence[1].slots[0].report).toEqual(originalReport);
    expect(confirmCorrectionReplan(root, { candidate_receipt: second.candidate_receipt,
      authorization: { ...authorization, decision_text: 'Approve the second bounded correction while retaining all original obligations.', approved_candidate_digest: second.candidate_receipt.candidate_digest } }).status).toBe('success');
    // Preparing yet another generation consumes C's carry-forward proof.
    const secondPreflight = preflightStep(root, { candidate_paths: ['docs/audit.md'] });
    const secondReport = reportFixture(root);
    secondReport.report.result_id = 'result-K1-second-correction';
    expect(recordStepResult(root, { preflight_receipt: secondPreflight.receipt, actual_changed_paths: [],
      command_results: [], validation_results: [{ validation: 'Targeted public cursor observation', status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: [secondReport], outcome: 'implemented', note: 'Second correction' }).status).toBe('success');
    const secondReview = reviewContext(root, {});
    recordReviewResult(root, { context_receipt: secondReview.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'], blocker: null });
    completeReviewedStep(root, { step_id: 'S3-C2', note: 'Second correction reviewed' });
    fs.writeFileSync(path.join(root, 'docs', 'challenge-3.md'), 'Third bounded observation.\n');
    recordEvidenceChallenge(root, { claim_id: 'A1', slot_id: 'a1', result_id: 'result-K1-second-correction',
      evidence_ref: 'docs/challenge-3.md', evidence_sha256: fileRevision(path.join(root, 'docs', 'challenge-3.md')), reason: 'Third observation' });
    const thirdInput = { challenge_id: readCanonicalCurrentTask(root).runtimeState.evidence_challenges!.at(-1)!.challenge_id,
      correction_step: { ...candidateInput.correction_step, id: 'S3-C3' } };
    const third = prepareCorrectionReplan(root, thirdInput);
    // G18: discarding and changing recovery IDs cannot renew the candidate budget.
    discardCorrectionReplan(root, { candidate_digest: third.candidate_receipt.candidate_digest });
    for (const id of ['S3-C3-alternative', 'S3-C3-final']) {
      const alternative = prepareCorrectionReplan(root, { ...thirdInput, correction_step: { ...thirdInput.correction_step, id } });
      discardCorrectionReplan(root, { candidate_digest: alternative.candidate_receipt.candidate_digest });
    }
    const preserved = fs.readFileSync(resumed.filePath);
    expect(() => prepareCorrectionReplan(root, { ...thirdInput, correction_step: { ...thirdInput.correction_step, id: 'S3-C3-again' } })).toThrow('REPLAN_CANDIDATE_BUDGET_EXHAUSTED');
    expect(fs.readFileSync(resumed.filePath)).toEqual(preserved);
  });

  test('scope amendment consumes prior authorization across blocked pending review and findings while legacy replan stays closed', () => {
    const input = singleStepSemanticDraft({
      claim_evidence: evidencePlanFixture('The authorized continuation preserves the acceptance check', 'step-1'),
      mutation_scope: { allowed: ['runtime/vnext/src/prepare-task-adapter.ts'], conditional: [], forbidden: ['.git/**'] },
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement the bounded Runtime fixture',
        mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts'],
        commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }],
        validation: ['The bounded Runtime fixture is verified'],
        review_checkpoint: { policy: 'required', reason: 'Retain a pending review while testing the scope amendment route' },
      }],
    });
    const root = confirmedSemanticRoot(input);

    let current = readCanonicalCurrentTask(root);
    const preflight = preflightStep(root, { candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts'] });
    const changed = path.join(root, 'runtime', 'vnext', 'src', 'prepare-task-adapter.ts');
    fs.mkdirSync(path.dirname(changed), { recursive: true });
    fs.writeFileSync(changed, 'caller-reported existing implementation change\n', 'utf8');
    const validation = preflight.current_step.validation[0]!;
    const result = recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts'],
      command_results: preflight.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: command.expected_repo_writes === 'none' ? [] : command.expected_repo_writes, evidence_refs: ['evidence-report.txt'] })),
      validation_results: [{ validation, status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: [reportFixture(root)],
      outcome: 'implemented',
      note: 'Retain the existing implementation change for later review',
    });
    expect(result.status).toBe('success');
    current = readCanonicalCurrentTask(root);
    const review = reviewContext(root, {});
    expect(recordReviewResult(root, {
      context_receipt: review.receipt,
      verdict: 'findings',
      findings: [{
        category: 'correctness',
        file: 'runtime/vnext/src/prepare-task-adapter.ts',
        failure_condition: 'the retained implementation still violates the bounded contract',
        required_behavior: 'repair and revalidate the bounded contract',
        root_cause_status: 'confirmed',
        evidence_refs: ['evidence-report.txt'],
      }],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
    }).status).toBe('success');
    current = readCanonicalCurrentTask(root);
    expect(current.runtimeState.pending_review_result?.verdict).toBe('findings');
    const findingPath = 'runtime/vnext/src/prepare-task-adapter.ts';
    expect(beginRepair(root, { candidate_paths: [findingPath] }).receipt.kind).toBe('execute-step-repair-preflight/v1');
    current = readCanonicalCurrentTask(root);
    expect(current.runtimeState.findings[0]?.status).toBe('admitted');

    const oldReplanInput = {
      challenge_id: 'challenge-not-present',
      correction_step: { id: 'legacy-correction', description: 'Legacy route must remain closed', mutation_scope: ['runtime/vnext/src/prepare-task-adapter.ts'], required_evidence: ['fresh review'], commands: [] },
    };
    expect(() => prepareCorrectionReplan(root, oldReplanInput)).toThrow('REPLAN_CANDIDATE_STATE_INVALID');

    expect(applyVNextRuntimeProposal(root, replanProposal(root, 'mark-replan-blocked', 'scope-amendment-mark-blocked')).status).toBe('success');
    current = readCanonicalCurrentTask(root);
    const pendingReviewId = current.runtimeState.pending_review_result?.review_id;
    const reviewCycle = structuredClone(current.runtimeState.review_cycle);
    const amendmentInput = {
      added_paths: ['src/authorized-continuation.ts', 'test/scope-amendment-regression.test.ts'],
      persistent_test_paths: ['test/scope-amendment-regression.test.ts'],
      authorization: {
        decision_source: 'user:scope-amendment-request',
        decision_text: 'Add the two exact paths so the blocked repair can continue; keep the original task and review obligations.',
        authorized_paths: ['src/authorized-continuation.ts', 'test/scope-amendment-regression.test.ts'],
      },
      amendment_step: {
        id: 'scope-amend-1',
        description: 'Apply the explicitly authorized continuation and revalidate it',
        mutation_scope: ['src/authorized-continuation.ts', 'test/scope-amendment-regression.test.ts'],
        required_evidence: ['fresh execution result', 'fresh review of the amended scope'],
        commands: [],
      },
    };
    const beforeAmendment = readCanonicalCurrentTask(root);
    const beforePendingReview = beforeAmendment.runtimeState.pending_review_result;
    const prepared = prepareScopeAmendment(root, amendmentInput);
    expect(prepared.candidate_receipt.kind).toBe('scope-amendment-candidate-receipt/v1');
    expect(prepared.candidate_receipt.permission_change).toBe('additive-scope');
    expect(prepared.evidence_assurance).toBe('caller-reported');
    expect(prepared.status).toBe('success');
    expect(prepared.committed).toBe(true);
    const after = readCanonicalCurrentTask(root);
    expect(after.runtimeState.workflow_status).toBe('active');
    expect(after.runtimeState.active_step_id).toBe('scope-amend-1');
    expect(after.runtimeState.active_step_status).toBe('ready');
    expect(after.runtimeState.pending_review_result?.review_id).toBe(pendingReviewId);
    expect(after.runtimeState.review_cycle).toEqual(reviewCycle);
    expect(after.runtimeState.review_coverage?.last_clean_revision).toBe(beforeAmendment.runtimeState.review_coverage?.last_clean_revision ?? null);
    expect(after.runtimeState.findings[0]?.status).toBe('admitted');
    expect(after.body).toContain('src/authorized-continuation.ts');
    expect(after.body).toContain('test/scope-amendment-regression.test.ts');
    expect(after.body).toContain('- step-1: Implement the bounded Runtime fixture');
    expect(after.body).toContain('- scope-amend-1: Apply the explicitly authorized continuation and revalidate it');
    expect(readCanonicalTaskBasis(root, after).basis.user_decisions.at(-1)).toEqual({ source: amendmentInput.authorization.decision_source, verbatim: amendmentInput.authorization.decision_text });
    const audit = after.runtimeState.execution_log.find(item => 'action' in item && item.action === 'commit-scope-amendment');
    expect(audit && 'candidate_digest' in audit ? audit.candidate_digest : null).toBe(prepared.candidate_receipt.candidate_digest);
    expect(audit && 'correction_reason' in audit ? audit.correction_reason : '').toContain('caller-reported scope amendment');
    const committedBytes = fs.readFileSync(after.filePath, 'utf8');
    const repeated = prepareScopeAmendment(root, amendmentInput);
    expect(repeated.status).toBe('no-op');
    expect(repeated.committed).toBe(false);
    expect(repeated.candidate_receipt).toEqual(prepared.candidate_receipt);
    expect(fs.readFileSync(after.filePath, 'utf8')).toBe(committedBytes);
    expect(beforePendingReview).not.toBeNull();
    const continuation = beginRepair(root, {
      candidate_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'src/authorized-continuation.ts', 'test/scope-amendment-regression.test.ts'],
    });
    expect(continuation.receipt).toMatchObject({ kind: 'execute-step-repair-preflight/v1', step_id: 'scope-amend-1' });
    for (const file of ['runtime/vnext/src/prepare-task-adapter.ts', 'src/authorized-continuation.ts', 'test/scope-amendment-regression.test.ts']) {
      const target = path.join(root, ...file.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `scope amendment repair: ${file}\n`, 'utf8');
    }
    const repairCommand = continuation.current_step.commands[0]!;
    expect(recordStepResult(root, {
      preflight_receipt: continuation.receipt,
      actual_changed_paths: ['runtime/vnext/src/prepare-task-adapter.ts', 'src/authorized-continuation.ts', 'test/scope-amendment-regression.test.ts'],
      command_results: [{ command: repairCommand.command, status: 'passed', observed_repo_writes: repairCommand.expected_repo_writes === 'none' ? [] : repairCommand.expected_repo_writes, evidence_refs: ['evidence-report.txt'] }],
      validation_results: continuation.current_step.validation.map(validation => ({ validation, status: 'passed', evidence_refs: ['evidence-report.txt'] })),
      acceptance_evidence: [reportFixture(root)],
      outcome: 'implemented',
      note: 'Repaired the authorized scope and ran a fresh validation',
    }).status).toBe('success');
    const repaired = readCanonicalCurrentTask(root);
    expect(repaired.runtimeState.scope_amendment_pending_review_step_id).toBeUndefined();
    expect(repaired.runtimeState.pending_review_result).toBeNull();
    expect(repaired.runtimeState.findings[0]?.status).toBe('in-progress');
    const verification = reviewContext(root, {});
    expect(recordReviewResult(root, { context_receipt: verification.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null }).status).toBe('success');
    expect(completeReviewedStep(root, { step_id: 'scope-amend-1', note: 'Fresh amended-scope review passed' }).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    expect(after.runtimeState.execution_log.some(item => 'action' in item && item.action === 'commit-scope-amendment')).toBe(true);
  });

  test('scope amendment requires an existing explicit exact-path authorization and never creates a candidate without it', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft());
    const before = fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8');
    expect(() => prepareScopeAmendment(root, {
      added_paths: ['src/not-explicitly-authorized.ts'],
      authorization: { decision_source: 'user:missing-path', decision_text: 'Authorize a different exact path.', authorized_paths: ['src/different-path.ts'] },
      step: { id: 'scope-amend-missing-auth', description: 'This must not be admitted', mutation_scope: ['src/not-explicitly-authorized.ts'], required_evidence: ['fresh review'], commands: [] },
    })).toThrow('SCOPE_AMENDMENT_AUTHORIZATION_REQUIRED');
    expect(fs.readFileSync(readCanonicalCurrentTask(root).filePath, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(root, 'docs', 'workflow', 'task-candidates'))).toBe(false);
  });

  test('scope amendment retains and then consumes a clean pending review before the continuation runs', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft());
    const oldPath = 'runtime/vnext/src/prepare-task-adapter.ts';
    const preflight = preflightStep(root, { candidate_paths: [oldPath] });
    fs.mkdirSync(path.dirname(path.join(root, oldPath)), { recursive: true });
    fs.writeFileSync(path.join(root, oldPath), 'existing implementation change\n', 'utf8');
    expect(recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: [oldPath],
      command_results: preflight.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: command.expected_repo_writes === 'none' ? [] : command.expected_repo_writes, evidence_refs: ['evidence-report.txt'] })),
      validation_results: [{ validation: preflight.current_step.validation[0]!, status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: [reportFixture(root)],
      outcome: 'implemented',
      note: 'Retain the old step for its pending clean review',
    }).status).toBe('success');
    const review = reviewContext(root, {});
    expect(recordReviewResult(root, {
      context_receipt: review.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
    }).status).toBe('success');
    const pending = readCanonicalCurrentTask(root).runtimeState.pending_review_result!;
    const authorization = {
      decision_source: 'user:clean-review-amendment',
      decision_text: 'Authorize the exact continuation path while retaining the clean review for the existing change.',
      authorized_paths: ['src/clean-review-continuation.ts'],
    };
    const prepared = prepareScopeAmendment(root, {
      added_paths: authorization.authorized_paths,
      authorization,
      amendment_step: {
        id: 'scope-amend-clean-review',
        description: 'Run the newly authorized continuation after the retained review',
        mutation_scope: authorization.authorized_paths,
        required_evidence: ['fresh continuation review'],
        commands: [],
      },
    });
    expect(prepared.status).toBe('success');
    expect(prepared.committed).toBe(true);
    const amended = readCanonicalCurrentTask(root);
    expect(amended.runtimeState.active_step_id).toBe('scope-amend-clean-review');
    expect(amended.runtimeState.pending_review_result?.review_id).toBe(pending.review_id);
    expect(amended.runtimeState.scope_amendment_pending_review_step_id).toBe('step-1');
    expect(completeReviewedStep(root, { step_id: 'step-1', note: 'Consume the retained clean review before continuation' }).status).toBe('success');
    const continued = readCanonicalCurrentTask(root);
    expect(continued.runtimeState.active_step_id).toBe('scope-amend-clean-review');
    expect(continued.runtimeState.active_step_status).toBe('ready');
    expect(continued.runtimeState.pending_review_result).toBeNull();
    expect(continued.runtimeState.scope_amendment_pending_review_step_id).toBeUndefined();
  });

  test('scope amendment records a step-only increment without treating it as a new task-scope addition', () => {
    const stepOnlyPath = 'src/already-authorized.ts';
    const root = confirmedSemanticRoot(singleStepSemanticDraft({
      mutation_scope: {
        allowed: ['runtime/vnext/src/prepare-task-adapter.ts', stepOnlyPath],
        conditional: [],
        forbidden: ['.git/**'],
      },
    }));
    const authorization = {
      decision_source: 'user:step-only-amendment',
      decision_text: 'Authorize the exact step-only path that is already in the task boundary.',
      authorized_paths: [stepOnlyPath],
    };
    const prepared = prepareScopeAmendment(root, {
      added_paths: [stepOnlyPath],
      authorization,
      amendment_step: {
        id: 'scope-amend-step-only',
        description: 'Use the already-authorized path in the continuation step',
        mutation_scope: [stepOnlyPath],
        required_evidence: ['fresh step-only review'],
        commands: [],
      },
    });
    const candidatePath = path.join(root, ...prepared.candidate_path.split('/'));
    const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as { scope_diff: { added_paths: string[] }; step_diff: { scope_paths: string[] }; input: { added_paths: string[] } };
    expect(candidate.scope_diff.added_paths).toEqual([]);
    expect(candidate.step_diff.scope_paths).toEqual([stepOnlyPath]);
    expect(candidate.input.added_paths).toEqual([stepOnlyPath]);
    expect(prepared.status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.active_step_id).toBe('scope-amend-step-only');
  });

  test('scope amendment carries attempt accounting through direct and unpreflighted continuations', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft());
    const firstPreflight = preflightStep(root, { candidate_paths: [] });
    const firstStep = firstPreflight.current_step;
    expect(recordStepResult(root, {
      preflight_receipt: firstPreflight.receipt,
      actual_changed_paths: [],
      command_results: [{ command: firstStep.commands[0]!.command, status: 'blocked', observed_repo_writes: [], evidence_refs: ['lineage-failure.json'] }],
      validation_results: [{ validation: firstStep.validation[0]!, status: 'not-run', evidence_refs: [] }],
      acceptance_evidence: [], outcome: 'blocked', blocker_kind: 'environment', note: 'The first attempt is retained for the amendment lineage fixture',
    }).status).toBe('success');
    const blocked = readCanonicalCurrentTask(root);
    const failure = blocked.runtimeState.step_attempts!['step-1']!.attempts[0]!;
    const resolutionPath = 'lineage-resolution.json';
    fs.writeFileSync(path.join(root, resolutionPath), JSON.stringify({
      kind: 'environment-restored/v1', task_id: blocked.runtimeState.task_id, document_id: blocked.sourceTuple.document_id,
      step_id: 'step-1', blocked_attempt_id: failure.attempt_id, evidence_plan_revision: blocked.runtimeState.evidence_plan_revision,
      subject_revision: failure.blocker!.subject_snapshot.revision, status: 'passed', diagnosis: 'fixture environment restored', resolution: 'The bounded retry fixture is available',
    }));
    expect(retryStep(root, { step_id: 'step-1', blocked_attempt_id: failure.attempt_id, blocker_resolution_refs: [resolutionPath], idempotency_key: 'scope-lineage-retry-1' }).status).toBe('success');
    const usedBeforeAmendment = readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts;
    expect(usedBeforeAmendment).toHaveLength(2);

    const amendment = (file: string, id: string) => ({
      added_paths: [file],
      authorization: { decision_source: `user:lineage-${id}`, decision_text: `Authorize the exact lineage path ${file}.`, authorized_paths: [file] },
      amendment_step: { id, description: `Continue through ${file}`, mutation_scope: [file], required_evidence: ['fresh lineage review'], commands: [] },
    });
    expect(prepareScopeAmendment(root, amendment('runtime/vnext/src/lineage-a.ts', 'scope-lineage-a')).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts).toEqual(usedBeforeAmendment);
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['scope-lineage-a']).toBeUndefined();
    expect(prepareScopeAmendment(root, amendment('runtime/vnext/src/lineage-b.ts', 'scope-lineage-b')).status).toBe('success');
    const beforeFinalPreflight = readCanonicalCurrentTask(root);
    expect(beforeFinalPreflight.runtimeState.active_step_id).toBe('scope-lineage-b');
    expect(beforeFinalPreflight.runtimeState.step_attempts!['scope-lineage-b']).toBeUndefined();

    const finalPreflight = preflightStep(root, { candidate_paths: ['runtime/vnext/src/lineage-b.ts'] });
    expect(finalPreflight.receipt.step_id).toBe('scope-lineage-b');
    const finalLedger = readCanonicalCurrentTask(root).runtimeState.step_attempts!['scope-lineage-b']!;
    expect(finalLedger.max_attempts).toBe(3);
    expect(finalLedger.attempts[0]).toEqual(usedBeforeAmendment[0]);
    expect(finalLedger.attempts).toHaveLength(2);
    expect(finalLedger.attempts[1]).toMatchObject({ attempt_id: usedBeforeAmendment[1]!.attempt_id, status: 'preflighted' });
  });

  test('scope amendment walks three continuation layers without resetting the inherited budget', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft());
    const preflight = preflightStep(root, { candidate_paths: [] });
    const step = preflight.current_step;
    expect(recordStepResult(root, {
      preflight_receipt: preflight.receipt,
      actual_changed_paths: [],
      command_results: [{ command: step.commands[0]!.command, status: 'blocked', observed_repo_writes: [], evidence_refs: ['three-layer-failure.json'] }],
      validation_results: [{ validation: step.validation[0]!, status: 'not-run', evidence_refs: [] }],
      acceptance_evidence: [], outcome: 'blocked', blocker_kind: 'environment', note: 'Retain one failed attempt before three amendments',
    }).status).toBe('success');
    const amendment = (file: string, id: string) => ({
      added_paths: [file],
      authorization: { decision_source: `user:three-layer-${id}`, decision_text: `Authorize the exact three-layer path ${file}.`, authorized_paths: [file] },
      amendment_step: { id, description: `Continue through ${file}`, mutation_scope: [file], required_evidence: ['fresh three-layer review'], commands: [] },
    });
    expect(prepareScopeAmendment(root, amendment('runtime/vnext/src/ancestry-a.ts', 'scope-ancestry-a')).status).toBe('success');
    expect(prepareScopeAmendment(root, amendment('runtime/vnext/src/ancestry-b.ts', 'scope-ancestry-b')).status).toBe('success');
    expect(prepareScopeAmendment(root, amendment('runtime/vnext/src/ancestry-c.ts', 'scope-ancestry-c')).status).toBe('success');
    expect(readCanonicalCurrentTask(root).runtimeState.step_attempts!['scope-ancestry-c']).toBeUndefined();
    preflightStep(root, { candidate_paths: ['runtime/vnext/src/ancestry-c.ts'] });
    const inherited = readCanonicalCurrentTask(root).runtimeState.step_attempts!['scope-ancestry-c']!;
    expect(inherited.max_attempts).toBe(3);
    expect(inherited.attempts[0]!.status).toBe('blocked');
    expect(inherited.attempts).toHaveLength(2);
  });

  test('scope amendment directly reuses the latest ready attempt without consuming another budget slot', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft());
    const firstPreflight = preflightStep(root, { candidate_paths: [] });
    const firstStep = firstPreflight.current_step;
    expect(recordStepResult(root, {
      preflight_receipt: firstPreflight.receipt,
      actual_changed_paths: [],
      command_results: [{ command: firstStep.commands[0]!.command, status: 'blocked', observed_repo_writes: [], evidence_refs: ['direct-lineage-failure.json'] }],
      validation_results: [{ validation: firstStep.validation[0]!, status: 'not-run', evidence_refs: [] }],
      acceptance_evidence: [], outcome: 'blocked', blocker_kind: 'environment', note: 'Create the retained failure before the direct amendment fixture',
    }).status).toBe('success');
    const blocked = readCanonicalCurrentTask(root);
    const failure = blocked.runtimeState.step_attempts!['step-1']!.attempts[0]!;
    const resolutionPath = 'direct-lineage-resolution.json';
    fs.writeFileSync(path.join(root, resolutionPath), JSON.stringify({
      kind: 'environment-restored/v1', task_id: blocked.runtimeState.task_id, document_id: blocked.sourceTuple.document_id,
      step_id: 'step-1', blocked_attempt_id: failure.attempt_id, evidence_plan_revision: blocked.runtimeState.evidence_plan_revision,
      subject_revision: failure.blocker!.subject_snapshot.revision, status: 'passed', diagnosis: 'fixture environment restored', resolution: 'The direct lineage fixture is available',
    }));
    expect(retryStep(root, { step_id: 'step-1', blocked_attempt_id: failure.attempt_id, blocker_resolution_refs: [resolutionPath], idempotency_key: 'scope-direct-lineage-retry' }).status).toBe('success');
    const prior = readCanonicalCurrentTask(root).runtimeState.step_attempts!['step-1']!.attempts;
    expect(prior).toHaveLength(2);
    const continuationPath = 'runtime/vnext/src/direct-lineage.ts';
    expect(prepareScopeAmendment(root, {
      added_paths: [continuationPath],
      authorization: { decision_source: 'user:direct-lineage', decision_text: 'Authorize the exact direct lineage path.', authorized_paths: [continuationPath] },
      amendment_step: { id: 'scope-direct-lineage', description: 'Continue through the directly inherited budget', mutation_scope: [continuationPath], required_evidence: ['fresh direct lineage review'], commands: [] },
    }).status).toBe('success');
    preflightStep(root, { candidate_paths: [continuationPath] });
    const inherited = readCanonicalCurrentTask(root).runtimeState.step_attempts!['scope-direct-lineage']!;
    expect(inherited.max_attempts).toBe(3);
    expect(inherited.attempts).toHaveLength(2);
    expect(inherited.attempts[0]).toEqual(prior[0]);
    expect(inherited.attempts[1]).toMatchObject({ attempt_id: prior[1]!.attempt_id, status: 'preflighted' });
  });

  test('scope amendment preserves existing wildcard authority and adds only exact increments', () => {
    const root = confirmedSemanticRoot(singleStepSemanticDraft({
      mutation_scope: { allowed: ['src/**', 'packages/foo/**'], conditional: [], forbidden: ['.git/**'] },
      implementation_steps: [{
        id: 'step-1', description: 'Implement the wildcard-scoped fixture', mutation_scope: ['src/**', 'packages/foo/**'],
        commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }], validation: ['The wildcard-scoped fixture passes'],
      }],
    }));
    const added = 'tests/wildcard-amendment.test.ts';
    const alreadyCovered = 'src/already-covered.ts';
    const prepared = prepareScopeAmendment(root, {
      added_paths: [added, alreadyCovered],
      authorization: { decision_source: 'user:wildcard-amendment', decision_text: 'Authorize these two exact paths while retaining all existing wildcard authority.', authorized_paths: [added, alreadyCovered] },
      amendment_step: { id: 'scope-wildcard-amend', description: 'Retain wildcard authority and add the exact regression path', mutation_scope: [added, alreadyCovered], required_evidence: ['fresh wildcard review'], commands: [] },
    });
    expect(prepared.status).toBe('success');
    const current = readCanonicalCurrentTask(root);
    const definition = readDraftDefinitionFromBody(current.body);
    const continuation = definition.implementation_steps.match(/- scope-wildcard-amend:[\s\S]*?(?=\n- |$)/)?.[0] ?? '';
    const continuationScope = continuation.split('\n').find(line => line.includes('mutation_scope:')) ?? '';
    expect(continuationScope).toBe('  - mutation_scope: src/**, packages/foo/**, tests/wildcard-amendment.test.ts');
    expect(continuationScope).not.toContain('src/already-covered.ts');
    expect(current.body).toContain('- `src/**`');
    expect(current.body).toContain('- `packages/foo/**`');
    expect(current.body).toContain('- `tests/wildcard-amendment.test.ts`');
    const candidatePath = path.join(root, ...prepared.candidate_path.split('/'));
    const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as { step_diff: { scope_paths: string[] } };
    expect(candidate.step_diff.scope_paths).toEqual([added]);
  });

  test('process-control dynamic review follows assessed risk without erasing the ordinary checkpoint', () => {
    for (const elevated of [false, true]) {
    const target = 'packages/node-rollout/src/session.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    const root = v2ConfirmedRoot({
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement a low-risk Node rollout change',
        planned_mutation_targets: [target],
        commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }],
        validation: ['bun test test/vnext-runtime.test.ts passes'],
        review_checkpoint: { policy: 'not-required', reason: 'final-exemption: isolated fixture defers only the ordinary checkpoint; dynamic expansions remain reviewable' },
      }],
    });
    try {
      fs.mkdirSync(path.dirname(path.join(root, ...target.split('/'))), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(root, ...discovered.split('/'))), { recursive: true });
      fs.writeFileSync(path.join(root, ...target.split('/')), 'export const session = "before";\n', 'utf8');
      fs.writeFileSync(path.join(root, ...discovered.split('/')), 'export const normalizeState = (value) => value;\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [target] });
      fs.writeFileSync(path.join(root, ...target.split('/')), 'export const session = "after";\n', 'utf8');
      fs.writeFileSync(path.join(root, 'evidence-report.txt'), 'Dynamic review evidence.\n', 'utf8');
      const extended = extendPreflight(root, {
        current_preflight_receipt: initial.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [{
          target: { path: discovered, symbol: 'normalizeState' },
          reason: 'The local helper is the smallest correct fix and does not require a shared change.',
          blast_radius: { locality: elevated ? 'elevated' : 'local', visibility: elevated ? 'shared' : 'private', cross_component_consumers: elevated ? 'present' : 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      });
      expect(() => recordStepResult(root, {
        preflight_receipt: initial.receipt,
        actual_changed_paths: [target],
        command_results: [{ command: initial.current_step.commands[0].command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
        validation_results: [{ validation: initial.current_step.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
        acceptance_evidence: [reportFixture(root)],
        outcome: 'implemented',
        note: 'The old receipt must be stale after extension.',
      })).toThrow('EXECUTE_PREFLIGHT_STALE');

      const result = recordStepResult(root, {
        preflight_receipt: extended.receipt,
        actual_changed_paths: [target],
        command_results: [{ command: extended.current_step.commands[0].command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
        validation_results: [{ validation: extended.current_step.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
        acceptance_evidence: [reportFixture(root)],
        outcome: 'implemented',
        note: 'The same-envelope expansion needs cumulative review even for a not-required ordinary checkpoint.',
      });
      expect(result.status).toBe('success');
      const after = readCanonicalCurrentTask(root);
      expect(after.runtimeState.dynamic_expansions!.at(-1)!.review_required).toBe(elevated);
      if (!elevated) {
        expect(after.runtimeState.active_step_status).toBe('completed');
        expect(after.runtimeState.task_id).toBe(initial.receipt.task_id);
        // The already-confirmed final cumulative exemption is preserved.
        expect(after.runtimeState.review_coverage!.pending_paths).toEqual([]);
        continue;
      }
      expect(after.runtimeState.active_step_status).toBe('in-progress');
      const context = reviewContext(root, {});
      expect(context.status).toBe('pass');
      expect(context.dynamic_review_required).toBe(true);
      const review = recordReviewResult(root, {
        context_receipt: context.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      });
      expect(review.status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'step-1', note: 'The dynamic cumulative review is clean.' }).status).toBe('success');
      expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    }
  });

  test('same-domain discovery without assessment has a distinct admission error', () => {
    const planned = 'packages/node-rollout/src/session.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    const root = v2ConfirmedRoot({
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement the Node rollout behavior',
        planned_mutation_targets: [planned],
        commands: [],
        validation: ['The Node rollout behavior is verified'],
        review_checkpoint: { policy: 'required', reason: 'Review the implementation diff' },
      }],
    });
    try {
      const plannedPath = path.join(root, ...planned.split('/'));
      fs.mkdirSync(path.dirname(plannedPath), { recursive: true });
      fs.writeFileSync(plannedPath, 'export const session = "before";\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [planned] });
      const before = readCanonicalCurrentTask(root);
      const beforeBytes = fs.readFileSync(before.filePath, 'utf8');
      const beforeStore = taskStoreSnapshot(root);
      const beforeAttempts = JSON.stringify(before.runtimeState.step_attempts);
      const beforeReviewCoverage = JSON.stringify(before.runtimeState.review_coverage);
      const beforeDynamicExpansions = JSON.stringify(before.runtimeState.dynamic_expansions);
      expect(() => extendPreflight(root, {
        current_preflight_receipt: initial.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('MUTATION_BLAST_RADIUS_ASSESSMENT_REQUIRED');
      const after = readCanonicalCurrentTask(root);
      expect(fs.readFileSync(after.filePath, 'utf8')).toBe(beforeBytes);
      expect(after.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(JSON.stringify(after.runtimeState)).toBe(JSON.stringify(before.runtimeState));
      expect(taskStoreSnapshot(root)).toBe(beforeStore);
      expect(JSON.stringify(after.runtimeState.step_attempts)).toBe(beforeAttempts);
      expect(JSON.stringify(after.runtimeState.review_coverage)).toBe(beforeReviewCoverage);
      expect(JSON.stringify(after.runtimeState.dynamic_expansions)).toBe(beforeDynamicExpansions);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('Step 5 Flow A records same-envelope discovery as an actual reviewed mutation', () => {
    const plannedA = 'packages/node-rollout/src/session.ts';
    const plannedB = 'packages/node-rollout/src/reconnect.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    const root = v2ConfirmedRoot({
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement the Node rollout behavior and discover local state normalization',
        planned_mutation_targets: [plannedA, plannedB],
        commands: [],
        validation: ['The Node rollout behavior is verified'],
        review_checkpoint: { policy: 'required', reason: 'Review the planned and discovered implementation diff' },
      }],
    });
    try {
      const absolute = (relative: string) => path.join(root, ...relative.split('/'));
      for (const file of [plannedA, plannedB, discovered]) {
        fs.mkdirSync(path.dirname(absolute(file)), { recursive: true });
      }
      fs.writeFileSync(absolute(plannedA), 'export const session = "before";\n', 'utf8');
      fs.writeFileSync(absolute(plannedB), 'export const reconnect = "before";\n', 'utf8');
      fs.writeFileSync(absolute(discovered), 'export const normalizeState = (value) => value;\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [plannedA, plannedB] });

      fs.writeFileSync(absolute(plannedA), 'export const session = "after";\n', 'utf8');
      const beforeExtension = fs.readFileSync(absolute(discovered), 'utf8');
      const extension = extendPreflight(root, {
        current_preflight_receipt: initial.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [{
          target: { path: discovered, symbol: 'normalizeState' },
          reason: 'The private helper is the smallest correct local change; propagating into the shared protocol would broaden the fix without evidence.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      });
      expect(fs.readFileSync(absolute(discovered), 'utf8')).toBe(beforeExtension);
      expect(extension.receipt.candidate_paths).toEqual([plannedA, plannedB, discovered]);
      expect(extension.receipt.execution_id).toBe(initial.receipt.execution_id);

      fs.writeFileSync(absolute(discovered), 'export const normalizeState = (value) => value.trim();\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: extension.receipt,
        actual_changed_paths: [plannedA, discovered],
        command_results: [],
        validation_results: [{ validation: extension.current_step.validation[0]!, status: 'passed', evidence_refs: evidence.evidence_refs }],
        acceptance_evidence: [evidence],
        outcome: 'implemented',
        note: 'Record both the planned implementation and the discovered helper mutation.',
      }).status).toBe('success');
      expect(fs.readFileSync(absolute(discovered), 'utf8')).toContain('value.trim()');

      const context = reviewContext(root, {});
      expect(context.planned_mutation_targets).toEqual([plannedA, plannedB]);
      expect(context.expanded_mutation_targets).toEqual([
        expect.objectContaining({
          path: discovered,
          assessment: expect.objectContaining({ disposition: 'self-admit' }),
        }),
      ]);
      expect(context.recorded_execution.execution_result?.actual_changed_paths).toEqual([discovered, plannedA].sort());
      expect(context.recorded_execution.execution_result?.change_delta.entries.map(entry => entry.path)).toEqual(
        expect.arrayContaining([plannedA, discovered]),
      );
      const diff = reviewRead(root, { context_receipt: context.receipt, path: discovered, view: 'diff' });
      expect(diff.content_status).toBe('text');
      expect(diff.text).toContain('value.trim()');
      expect(recordReviewResult(root, {
        context_receipt: context.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'step-1', note: 'The planned and discovered mutations are reviewed.' }).status).toBe('success');
      expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('Step 5 Flow B repair discovery stays in one repair wave and execution identity', () => {
    const target = 'packages/node-rollout/src/session.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    const root = v2ConfirmedRoot({
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement and repair the Node rollout behavior',
        planned_mutation_targets: [target],
        commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }],
        validation: ['bun test test/vnext-runtime.test.ts passes'],
        review_checkpoint: { policy: 'required', reason: 'Review the cumulative implementation and repair diff' },
      }],
    });
    try {
      const targetPath = path.join(root, ...target.split('/'));
      const discoveredPath = path.join(root, ...discovered.split('/'));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.mkdirSync(path.dirname(discoveredPath), { recursive: true });
      fs.writeFileSync(targetPath, 'export const session = "before";\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [target] });
      fs.writeFileSync(targetPath, 'export const session = "implemented";\n', 'utf8');
      const acceptance = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: initial.receipt,
        actual_changed_paths: [target],
        command_results: [{ command: initial.current_step.commands[0]!.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
        validation_results: [{ validation: initial.current_step.validation[0]!, status: 'passed', evidence_refs: ['evidence-report.txt'] }],
        acceptance_evidence: [acceptance],
        outcome: 'implemented',
        note: 'Record the initial Node implementation before review repair.',
      }).status).toBe('success');

      const discovery = reviewContext(root, {});
      expect(recordReviewResult(root, {
        context_receipt: discovery.receipt,
        verdict: 'findings',
        findings: [{
          category: 'correctness',
          file: target,
          failure_condition: 'the session state is not normalized before reconnect',
          required_behavior: 'normalize session state before reconnect',
          root_cause_status: 'confirmed',
          evidence_refs: ['evidence-report.txt'],
        }],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      }).status).toBe('success');

      const repair = beginRepair(root, { candidate_paths: [target] });
      const beforeExtension = readCanonicalCurrentTask(root);
      const attemptsBefore = structuredClone(beforeExtension.runtimeState.step_attempts);
      fs.writeFileSync(targetPath, 'export const session = "repaired";\n', 'utf8');

      const extension = extendPreflight(root, {
        current_preflight_receipt: repair.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [{
          target: { path: discovered, symbol: 'normalizeState' },
          reason: 'The private helper is the smallest correct repair; changing the shared protocol would broaden the fix without evidence.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      });
      expect(extension.receipt).toMatchObject({
        mode: 'repair',
        execution_id: repair.receipt.execution_id,
        repair_wave_id: repair.receipt.repair_wave_id,
        repair_fingerprints: repair.receipt.repair_fingerprints,
      });
      const afterExtension = readCanonicalCurrentTask(root);
      expect(afterExtension.runtimeState.step_attempts).toEqual(attemptsBefore);
      expect(afterExtension.runtimeState.evidence_plan_revision).toBe(beforeExtension.runtimeState.evidence_plan_revision);
      expect(afterExtension.runtimeState.active_step_id).toBe('step-1');
      expect(afterExtension.runtimeState.dynamic_expansions).toEqual([
        expect.objectContaining({
          path: discovered,
          mode: 'repair',
          execution_id: repair.receipt.execution_id,
          step_id: 'step-1',
          first_touch_state: 'absent',
        }),
      ]);
      expect(afterExtension.runtimeState.execution_log.some(item => 'action' in item && item.action === 'commit-scope-amendment')).toBe(false);

      fs.writeFileSync(targetPath, 'export const session = "fixed";\n', 'utf8');
      fs.writeFileSync(discoveredPath, 'export const normalizeState = (value) => value.trim();\n', 'utf8');
      expect(fs.readFileSync(discoveredPath, 'utf8')).toContain('value.trim()');
      expect(recordStepResult(root, {
        preflight_receipt: extension.receipt,
        actual_changed_paths: [target, discovered],
        command_results: [{ command: extension.current_step.commands[0]!.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
        validation_results: [{ validation: extension.current_step.validation[0]!, status: 'passed', evidence_refs: ['evidence-report.txt'] }],
        acceptance_evidence: [],
        outcome: 'implemented',
        note: 'Repair the finding and its locally discovered helper in one wave.',
      }).status).toBe('success');
      const verification = reviewContext(root, {});
      expect(verification.receipt.cycle_phase).toBe('verification');
      expect(verification.recorded_execution.execution_result?.execution_id).toBe(repair.receipt.execution_id);
      expect(verification.recorded_execution.execution_result?.actual_changed_paths).toEqual([discovered, target].sort());
      expect(verification.recorded_execution.execution_result?.change_delta.entries.map(entry => entry.path)).toEqual(
        expect.arrayContaining([target, discovered]),
      );
      expect(recordReviewResult(root, {
        context_receipt: verification.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'step-1', note: 'The repair wave and local expansion are verified.' }).status).toBe('success');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E3 rejects a test-first Red product expansion before changing Runtime state', () => {
    const testPath = 'packages/node-rollout-tests/qa/check.ts';
    const productPath = 'packages/node-rollout/src/foo.ts';
    const semantic = v2MutationAuthoritySemanticDraft({
      test_strategy: {
        mode: 'test-first',
        source: 'explicit-user',
        source_ref: 'test:original-request',
        task_classification: 'contract-clear-behavior',
        rationale: 'The regression must be reproduced before product implementation.',
      },
      implementation_steps: [{
        id: 'step-1',
        description: 'Record the existing regression in Red',
        planned_mutation_targets: [testPath],
        commands: [],
        validation: ['The regression test reproduces the defect'],
        review_checkpoint: { policy: 'required', reason: 'Review the Red reproduction' },
      }, {
        id: 'step-2',
        description: 'Implement the product fix after Red',
        planned_mutation_targets: [productPath],
        commands: [],
        validation: ['The product fix passes the regression'],
        review_checkpoint: { policy: 'required', reason: 'Review the product fix' },
      }],
      persistent_tests: [{
        path: testPath,
        proves: ['A1'],
        owner: 'workflow-system',
        owner_source: 'task-basis',
        source_ref: 'test:original-request',
        basis: 'regression',
        existing_evidence_insufficiency: 'The existing checks do not reproduce this regression.',
        assertion_boundary: 'The test asserts the requested Node rollout behavior only.',
        failure_disposition: 'block',
      }],
    });
    const prerequisite = structuredClone(semantic.claim_evidence[0]!);
    prerequisite.claim_id = 'red-reproduction';
    prerequisite.claim_kind = 'invariant';
    prerequisite.requirement = 'Observe the regression before product implementation';
    const slot = prerequisite.slots[0]!;
    slot.slot_id = 'red-reproduction';
    slot.due_step_id = 'step-1';
    slot.applicability = 'before-step';
    slot.before_step_id = 'step-2';
    slot.prerequisite_receipt = null;
    slot.check!.check_id = 'red-reproduction';
    slot.check!.entry = 'bun test packages/node-rollout-tests/existing-regression.test.ts';
    slot.check!.expected_result = 'expected-failure';
    slot.check!.method = 'execution'; slot.minimum_type = 'focused-test';
    slot.check!.selection = { ...evidencePlanFixture('reproduction')[0]!.slots[0]!.check!.selection!,
      selector: 'packages/node-rollout-tests/existing-regression.test.ts',
      invocation: { argv: ['bun', 'test', 'packages/node-rollout-tests/existing-regression.test.ts'], selector_arg_index: 2 } };
    semantic.implementation_steps[0]!.commands = [{ command: slot.check!.entry, expected_repo_writes: 'none' }];
    semantic.claim_evidence.push(prerequisite);

    const root = archivedBaselineRoot();
    enableV2MutationAuthority(root);
    const prepared = prepareDraft(root, semantic);
    if (!prepared.confirmation_receipt) throw new Error('E3 setup did not receive a confirmation receipt');
    expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt }).status).toBe('success');
    try {
      const testFile = path.join(root, ...testPath.split('/'));
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, 'test("existing regression", () => {});\n', 'utf8');
      const mixedBefore = readCanonicalCurrentTask(root);
      const mixedBeforeBytes = fs.readFileSync(mixedBefore.filePath, 'utf8');
      const mixedBeforeStore = taskStoreSnapshot(root);
      const mixedBeforeRuntime = JSON.stringify(mixedBefore.runtimeState);
      expect(() => preflightStep(root, {
        candidate_paths: [testPath, productPath],
        blast_radius_assessments: [{
          target: { path: productPath, symbol: 'foo' },
          reason: 'The product implementation is the likely local fix after the Red reproduction.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
      })).toThrow('TEST_STRATEGY_SEQUENCE_INVALID');
      expect(fs.readFileSync(mixedBefore.filePath, 'utf8')).toBe(mixedBeforeBytes);
      expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(mixedBefore.sourceTuple.revision);
      expect(taskStoreSnapshot(root)).toBe(mixedBeforeStore);
      expect(JSON.stringify(readCanonicalCurrentTask(root).runtimeState)).toBe(mixedBeforeRuntime);
      const initial = preflightStep(root, { candidate_paths: [testPath] });
      expect(initial.receipt.execution_phase).toBe('red');
      expect(initial.current_step.required_outcome).toBe('implemented');
      const before = readCanonicalCurrentTask(root);
      const beforeBytes = fs.readFileSync(before.filePath, 'utf8');
      const beforeRuntime = JSON.stringify(before.runtimeState);
      const beforeStore = taskStoreSnapshot(root);
      const beforeAttempts = JSON.stringify(before.runtimeState.step_attempts);
      const beforeReviewCoverage = JSON.stringify(before.runtimeState.review_coverage);
      const beforeDynamicExpansions = JSON.stringify(before.runtimeState.dynamic_expansions);
      expect(() => extendPreflight(root, {
        current_preflight_receipt: initial.receipt,
        additional_targets: [productPath],
        blast_radius_assessments: [{
          target: { path: productPath, symbol: 'foo' },
          reason: 'The product implementation is the likely local fix after the Red reproduction.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('TEST_STRATEGY_SEQUENCE_INVALID');
      const after = readCanonicalCurrentTask(root);
      expect(fs.readFileSync(after.filePath, 'utf8')).toBe(beforeBytes);
      expect(after.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(JSON.stringify(after.runtimeState)).toBe(beforeRuntime);
      expect(taskStoreSnapshot(root)).toBe(beforeStore);
      expect(JSON.stringify(after.runtimeState.step_attempts)).toBe(beforeAttempts);
      expect(JSON.stringify(after.runtimeState.review_coverage)).toBe(beforeReviewCoverage);
      expect(JSON.stringify(after.runtimeState.dynamic_expansions)).toBe(beforeDynamicExpansions);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E4 keeps not-applicable execution closed under dynamic executable discovery', () => {
    const planned = 'packages/node-rollout/README.md';
    const discovered = 'packages/node-rollout/src/app.ts';
    const root = archivedBaselineRoot();
    enableV2MutationAuthority(root);
    const profilePath = path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml');
    const profile = parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, any>;
    profile.boundaries.non_executable_change_paths.push(planned);
    fs.writeFileSync(profilePath, stringify(profile), 'utf8');
    const prepared = prepareDraft(root, v2MutationAuthoritySemanticDraft({
      test_strategy: notApplicableSemanticDraft().test_strategy,
      implementation_steps: [{
        id: 'step-1',
        description: 'Update the non-executable Node rollout documentation',
        planned_mutation_targets: [planned],
        commands: [],
        validation: ['Review the rendered documentation content'],
        review_checkpoint: { policy: 'required', reason: 'Review the documentation change' },
      }],
    }));
    if (!prepared.confirmation_receipt) throw new Error('E4 setup did not receive a confirmation receipt');
    expect(confirmDraft(root, { confirmation_receipt: prepared.confirmation_receipt }).status).toBe('success');
    try {
      const plannedFile = path.join(root, ...planned.split('/'));
      fs.mkdirSync(path.dirname(plannedFile), { recursive: true });
      fs.writeFileSync(plannedFile, '# Node rollout notes\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [planned] });
      const before = readCanonicalCurrentTask(root);
      const beforeBytes = fs.readFileSync(before.filePath, 'utf8');
      const beforeStore = taskStoreSnapshot(root);
      const beforeAttempts = JSON.stringify(before.runtimeState.step_attempts);
      const beforeReviewCoverage = JSON.stringify(before.runtimeState.review_coverage);
      const beforeDynamicExpansions = JSON.stringify(before.runtimeState.dynamic_expansions);
      expect(() => extendPreflight(root, {
        current_preflight_receipt: initial.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [{
          target: { path: discovered, symbol: 'app' },
          reason: 'The discovered executable target would be a broader implementation change.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION');
      const after = readCanonicalCurrentTask(root);
      expect(fs.readFileSync(after.filePath, 'utf8')).toBe(beforeBytes);
      expect(after.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(JSON.stringify(after.runtimeState)).toBe(JSON.stringify(before.runtimeState));
      expect(taskStoreSnapshot(root)).toBe(beforeStore);
      expect(JSON.stringify(after.runtimeState.step_attempts)).toBe(beforeAttempts);
      expect(JSON.stringify(after.runtimeState.review_coverage)).toBe(beforeReviewCoverage);
      expect(JSON.stringify(after.runtimeState.dynamic_expansions)).toBe(beforeDynamicExpansions);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E5 admits an existing same-envelope regression test as ordinary dynamic expansion', () => {
    const product = 'packages/node-rollout/src/session.ts';
    const existingTest = 'packages/node-rollout-tests/existing-regression.test.ts';
    const root = v2ConfirmedRoot({
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement the Node rollout behavior and its existing regression test',
        planned_mutation_targets: [product],
        commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }],
        validation: ['bun test test/vnext-runtime.test.ts passes'],
        review_checkpoint: { policy: 'required', reason: 'Review the cumulative implementation and regression oracle' },
      }],
    });
    try {
      const productPath = path.join(root, ...product.split('/'));
      const testPath = path.join(root, ...existingTest.split('/'));
      fs.mkdirSync(path.dirname(productPath), { recursive: true });
      fs.mkdirSync(path.dirname(testPath), { recursive: true });
      fs.writeFileSync(productPath, 'export const session = "before";\n', 'utf8');
      fs.writeFileSync(testPath, 'test("existing regression", () => expect(true).toBe(true));\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [product] });
      fs.writeFileSync(productPath, 'export const session = "after";\n', 'utf8');
      const extended = extendPreflight(root, {
        current_preflight_receipt: initial.receipt,
        additional_targets: [existingTest],
        blast_radius_assessments: [{
          target: { path: existingTest, symbol: 'existing regression oracle' },
          reason: 'The existing regression test is the smallest correct local oracle; reuse its boundary instead of creating a new persistent test.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      });
      expect(extended.receipt.candidate_paths).toEqual([product, existingTest]);
      expect(readCanonicalCurrentTask(root).runtimeState.dynamic_review_required).toBe(false);
      fs.writeFileSync(testPath, 'test("existing regression", () => expect(session()).toBe("after"));\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: extended.receipt,
        actual_changed_paths: [product, existingTest],
        command_results: [{ command: extended.current_step.commands[0]!.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
        validation_results: [{ validation: extended.current_step.validation[0]!, status: 'passed', evidence_refs: ['evidence-report.txt'] }],
        acceptance_evidence: [evidence],
        outcome: 'implemented',
        note: 'Update the existing regression oracle inside the authorized test domain.',
      }).status).toBe('success');
      const context = reviewContext(root, {});
      expect(context.dynamic_review_required).toBe(false);
      expect(context.recorded_execution.execution_result?.actual_changed_paths).toEqual([existingTest, product].sort());
      expect(context.expanded_mutation_targets).toEqual([
        expect.objectContaining({ path: existingTest, assessment: expect.objectContaining({ disposition: 'self-admit' }) }),
      ]);
      expect(recordReviewResult(root, {
        context_receipt: context.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
        test_assessment: {
          applicable: true,
          reason: 'The existing regression oracle remains applicable to the same Node behavior.',
          evidence_refs: ['evidence-report.txt'],
          necessity: 'The existing regression test protects the discovered behavior.',
          oracle: 'The existing assertion remains the oracle for the requested Node behavior.',
          boundary: 'The regression test remains inside the authorized Node test domain.',
          reuse: 'The existing regression test is updated rather than replaced by a new persistent test.',
          applicability: 'The recorded cumulative diff includes the product and existing test changes.',
        },
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'step-1', note: 'The existing regression oracle and cumulative diff are reviewed.' }).status).toBe('success');
      expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E6/E7/E9 binds dynamic authority and review consumption to the current execution identity', () => {
    const plannedA = 'packages/node-rollout/src/session.ts';
    const plannedB = 'packages/node-rollout/src/reconnect.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    const root = v2TwoStepConfirmedRoot();
    const assessment = (reason: string) => ({
      target: { path: discovered, symbol: 'normalizeState' },
      reason,
      blast_radius: { locality: 'local' as const, visibility: 'private' as const, cross_component_consumers: 'none' as const, contract_impact: 'none' as const },
      evidence_refs: ['evidence-report.txt'],
      disposition: 'self-admit' as const,
    });
    try {
      for (const file of [plannedA, plannedB, discovered]) {
        const absolute = path.join(root, ...file.split('/'));
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
      }
      fs.writeFileSync(path.join(root, ...plannedA.split('/')), 'export const session = "before";\n', 'utf8');
      fs.writeFileSync(path.join(root, ...plannedB.split('/')), 'export const reconnect = "before";\n', 'utf8');
      const discoveredBefore = 'export const normalizeState = (value) => value;\n';
      fs.writeFileSync(path.join(root, ...discovered.split('/')), discoveredBefore, 'utf8');

      const first = preflightStep(root, { candidate_paths: [plannedA] });
      fs.writeFileSync(path.join(root, ...plannedA.split('/')), 'export const session = "first";\n', 'utf8');
      const firstExtension = extendPreflight(root, {
        current_preflight_receipt: first.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [assessment('S1 needs the private helper as the smallest correct local implementation.')],
        evidence_refs: ['evidence-report.txt'],
      });
      expect(firstExtension.receipt.execution_id).toBe(first.receipt.execution_id);
      expect(firstExtension.receipt.plan_revision).toBe(first.receipt.plan_revision);
      expect(firstExtension.receipt.candidate_paths).toEqual([plannedA, discovered]);
      const discoveredPreimage = readCanonicalCurrentTask(root).runtimeState.review_coverage!.preimages.find(item => item.path === discovered)!;
      expect(Object.keys(discoveredPreimage).sort()).toEqual(['path', 'sha256', 'state']);
      expect(fs.readFileSync(reviewPreimageBlobPath(root, discoveredPreimage.sha256!)).toString()).toBe(discoveredBefore);
      fs.writeFileSync(path.join(root, ...discovered.split('/')), 'export const normalizeState = (value) => value.trim();\n', 'utf8');
      const firstEvidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: firstExtension.receipt,
        actual_changed_paths: [plannedA, discovered],
        command_results: [],
        validation_results: [{ validation: firstExtension.current_step.validation[0]!, status: 'passed', evidence_refs: firstEvidence.evidence_refs }],
        acceptance_evidence: [firstEvidence],
        outcome: 'implemented',
        note: 'Record S1 with its same-envelope discovery.',
      }).status).toBe('success');
      const firstReviewContext = reviewContext(root, {});
      expect(firstReviewContext.expanded_mutation_targets).toEqual([
        expect.objectContaining({ path: discovered, step_id: 'step-1', execution_id: first.receipt.execution_id }),
      ]);
      expect(recordReviewResult(root, {
        context_receipt: firstReviewContext.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      }).status).toBe('success');
      const afterFirstReview = readCanonicalCurrentTask(root);
      const firstReviewId = afterFirstReview.runtimeState.dynamic_expansions!.find(item => item.path === discovered && item.step_id === 'step-1')!.reviewed_by_review_id;
      expect(firstReviewId).toBeDefined();
      expect(completeReviewedStep(root, { step_id: 'step-1', note: 'S1 dynamic expansion is reviewed.' }).status).toBe('success');
      expect(readCanonicalCurrentTask(root).runtimeState.active_step_id).toBe('step-2');

      const second = preflightStep(root, { candidate_paths: [plannedB] });
      const beforeRejectedExtension = readCanonicalCurrentTask(root);
      expect(() => extendPreflight(root, {
        current_preflight_receipt: second.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('MUTATION_BLAST_RADIUS_ASSESSMENT_REQUIRED');
      const afterRejectedExtension = readCanonicalCurrentTask(root);
      expect(afterRejectedExtension.sourceTuple.revision).toBe(beforeRejectedExtension.sourceTuple.revision);
      expect(JSON.stringify(afterRejectedExtension.runtimeState)).toBe(JSON.stringify(beforeRejectedExtension.runtimeState));

      const secondExtension = extendPreflight(root, {
        current_preflight_receipt: second.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [assessment('S2 has a different local reason to revisit the helper after reconnect changes.')],
        evidence_refs: ['evidence-report.txt'],
      });
      expect(secondExtension.receipt.execution_id).not.toBe(first.receipt.execution_id);
      expect(secondExtension.receipt.step_id).toBe('step-2');
      expect(secondExtension.receipt.plan_revision).not.toBe(first.receipt.plan_revision);
      expect(secondExtension.receipt.candidate_paths).toEqual([plannedB, discovered]);
      const afterSecondAdmission = readCanonicalCurrentTask(root);
      const discoveredExpansions = afterSecondAdmission.runtimeState.dynamic_expansions!.filter(item => item.path === discovered);
      expect(discoveredExpansions).toHaveLength(2);
      expect(discoveredExpansions[0]).toMatchObject({ step_id: 'step-1', execution_id: first.receipt.execution_id, reviewed_by_review_id: firstReviewId });
      expect(discoveredExpansions[1]).toMatchObject({ step_id: 'step-2', execution_id: second.receipt.execution_id });
      expect(discoveredExpansions[1]!.reviewed_by_review_id).toBeUndefined();
      expect(discoveredExpansions[0]!.assessment.reason).not.toBe(discoveredExpansions[1]!.assessment.reason);

      fs.writeFileSync(path.join(root, ...plannedB.split('/')), 'export const reconnect = "second";\n', 'utf8');
      fs.writeFileSync(path.join(root, ...discovered.split('/')), 'export const normalizeState = (value) => value.trim().toLowerCase();\n', 'utf8');
      const secondResult = recordStepResult(root, {
        preflight_receipt: secondExtension.receipt,
        actual_changed_paths: [plannedB, discovered],
        command_results: [],
        validation_results: [{ validation: secondExtension.current_step.validation[0]!, status: 'passed', evidence_refs: ['evidence-report.txt'] }],
        acceptance_evidence: [],
        outcome: 'implemented',
        note: 'Record S2 with a new assessment for the same path.',
      });
      expect(secondResult.status, JSON.stringify(secondResult)).toBe('success');
      const secondReviewContext = reviewContext(root, {});
      expect(secondReviewContext.expanded_mutation_targets).toEqual([
        expect.objectContaining({ path: discovered, step_id: 'step-2', execution_id: second.receipt.execution_id }),
      ]);
      expect(recordReviewResult(root, {
        context_receipt: secondReviewContext.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      }).status).toBe('success');
      const afterSecondReview = readCanonicalCurrentTask(root);
      const secondReviewId = afterSecondReview.runtimeState.dynamic_expansions!.find(item => item.path === discovered && item.step_id === 'step-2')!.reviewed_by_review_id;
      expect(secondReviewId).toBeDefined();
      expect(secondReviewId).not.toBe(firstReviewId);
      expect(afterSecondReview.runtimeState.dynamic_expansions!.find(item => item.path === discovered && item.step_id === 'step-1')!.reviewed_by_review_id).toBe(firstReviewId);
      expect(afterSecondReview.runtimeState.dynamic_review_required).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E8 keeps cumulative review coverage separate from current-step dynamic authority', () => {
    const plannedA = 'packages/node-rollout/src/session.ts';
    const plannedB = 'packages/node-rollout/src/reconnect.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    const root = v2TwoStepConfirmedRoot('not-required');
    try {
      for (const file of [plannedA, plannedB, discovered]) {
        const absolute = path.join(root, ...file.split('/'));
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, `export const ${path.basename(file, path.extname(file))} = "before";\n`, 'utf8');
      }
      const first = preflightStep(root, { candidate_paths: [plannedA] });
      fs.writeFileSync(path.join(root, ...plannedA.split('/')), 'export const session = "after";\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: first.receipt,
        actual_changed_paths: [plannedA],
        command_results: [],
        validation_results: [{ validation: first.current_step.validation[0]!, status: 'passed', evidence_refs: evidence.evidence_refs }],
        acceptance_evidence: [evidence],
        outcome: 'implemented',
        note: 'Complete the exempt first step and retain its cumulative review target.',
      }).status).toBe('success');
      const afterFirst = readCanonicalCurrentTask(root);
      expect(afterFirst.runtimeState.active_step_id).toBe('step-2');
      expect(afterFirst.runtimeState.review_coverage?.target.entries.map(entry => entry.path)).toContain(plannedA);

      const second = preflightStep(root, { candidate_paths: [plannedB] });
      const extension = extendPreflight(root, {
        current_preflight_receipt: second.receipt,
        additional_targets: [discovered],
        blast_radius_assessments: [{
          target: { path: discovered, symbol: 'normalizeState' },
          reason: 'The S2 helper is a private same-domain implementation detail.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'],
          disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      });
      expect(extension.receipt.candidate_paths).toEqual([plannedB, discovered]);
      expect(readCanonicalCurrentTask(root).runtimeState.dynamic_expansions).toEqual([
        expect.objectContaining({ path: discovered, step_id: 'step-2', execution_id: second.receipt.execution_id }),
      ]);
      fs.writeFileSync(path.join(root, ...plannedB.split('/')), 'export const reconnect = "after";\n', 'utf8');
      fs.writeFileSync(path.join(root, ...discovered.split('/')), 'export const normalizeState = (value) => value.trim();\n', 'utf8');
      expect(recordStepResult(root, {
        preflight_receipt: extension.receipt,
        actual_changed_paths: [plannedB, discovered],
        command_results: [],
        validation_results: [{ validation: extension.current_step.validation[0]!, status: 'passed', evidence_refs: ['evidence-report.txt'] }],
        acceptance_evidence: [],
        outcome: 'implemented',
        note: 'Record S2 while preserving the cumulative S1 review target.',
      }).status).toBe('success');
      const secondReview = reviewContext(root, {});
      expect(secondReview.expanded_mutation_targets).toEqual([
        expect.objectContaining({ path: discovered, step_id: 'step-2', execution_id: second.receipt.execution_id }),
      ]);
      expect(secondReview.recorded_execution.execution_result?.actual_changed_paths).toEqual([discovered, plannedB].sort());
      expect(secondReview.recorded_execution.execution_result?.change_delta.entries.map(entry => entry.path)).toEqual(
        expect.arrayContaining([plannedA, plannedB, discovered]),
      );
      expect(readCanonicalCurrentTask(root).runtimeState.review_coverage?.target.entries.map(entry => entry.path)).toEqual(
        expect.arrayContaining([plannedA, plannedB, discovered]),
      );
      expect(recordReviewResult(root, {
        context_receipt: secondReview.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'step-2', note: 'The cumulative S1 and S2 implementation diff is reviewed.' }).status).toBe('success');
      expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('v2 authority amendment waits for the current execution to settle', () => {
    const root = v2ConfirmedRoot();
    const planned = 'packages/node-rollout/src/session.ts';
    const crossDomain = 'native/codex-rollout-collector/src/protocol.rs';
    try {
      fs.mkdirSync(path.dirname(path.join(root, ...planned.split('/'))), { recursive: true });
      fs.writeFileSync(path.join(root, ...planned.split('/')), 'export const session = "stable";\n', 'utf8');
      const preflight = preflightStep(root, { candidate_paths: [planned] });
      expect(() => prepareScopeAmendment(root, {
        added_paths: [crossDomain],
        authorization: { decision_source: 'user:gate', decision_text: 'Authorize the exact Rust protocol path after the Node execution settles.', authorized_paths: [crossDomain] },
        amendment_step: { id: 'cross-domain-after-settlement', description: 'Continue through the authorized Rust protocol path', mutation_scope: [crossDomain], required_evidence: ['fresh cross-domain review'], commands: [] },
      })).toThrow('SCOPE_AMENDMENT_EXECUTION_GATE');

      const evidence = reportFixture(root);
      const step = preflight.current_step;
      expect(recordStepResult(root, {
        preflight_receipt: preflight.receipt,
        actual_changed_paths: [],
        command_results: [{ command: step.commands[0].command, status: 'passed', observed_repo_writes: [], evidence_refs: evidence.evidence_refs }],
        validation_results: [{ validation: step.validation[0], status: 'passed', evidence_refs: evidence.evidence_refs }],
        acceptance_evidence: [evidence],
        outcome: 'implemented',
        note: 'Settle the current Node execution before changing authority.',
      }).status).toBe('success');
      const context = reviewContext(root, {});
      expect(recordReviewResult(root, {
        context_receipt: context.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: evidence.evidence_refs,
        blocker: null,
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'step-1', note: 'The original Node execution is settled.' }).status).toBe('success');

      const amended = prepareScopeAmendment(root, {
        added_paths: [crossDomain],
        authorization: { decision_source: 'user:gate', decision_text: 'Authorize the exact Rust protocol path after the Node execution settles.', authorized_paths: [crossDomain] },
        amendment_step: { id: 'cross-domain-after-settlement', description: 'Continue through the authorized Rust protocol path', mutation_scope: [crossDomain], required_evidence: ['fresh cross-domain review'], commands: [] },
      });
      expect(amended.status).toBe('success');
      expect(readCanonicalCurrentTask(root).mutationAuthority?.exact_exceptions).toContain(crossDomain);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E10/E11 authority amendment gates only an unsettled preflight and preserves ready retry lineage', () => {
    const crossDomain = 'native/codex-rollout-collector/src/protocol.rs';
    const amendment = (pathToAdd: string, id: string) => ({
      added_paths: [pathToAdd],
      authorization: {
        decision_source: `user:step-3-${id}`,
        decision_text: `Authorize the exact cross-domain path ${pathToAdd} after the current execution is settled.`,
        authorized_paths: [pathToAdd],
      },
      amendment_step: {
        id,
        description: `Continue through the authorized path ${pathToAdd}`,
        mutation_scope: [pathToAdd],
        required_evidence: ['fresh authority-amendment execution and review'],
        commands: [],
      },
    });

    const blockedRoot = v2ConfirmedRoot();
    try {
      const planned = 'packages/node-rollout/src/session.ts';
      const preflight = preflightStep(blockedRoot, { candidate_paths: [planned] });
      const before = readCanonicalCurrentTask(blockedRoot);
      expect(() => prepareScopeAmendment(blockedRoot, amendment(crossDomain, 'after-blocked'))).toThrow('SCOPE_AMENDMENT_EXECUTION_GATE');
      const afterRejected = readCanonicalCurrentTask(blockedRoot);
      expect(afterRejected.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(JSON.stringify(afterRejected.runtimeState)).toBe(JSON.stringify(before.runtimeState));

      fs.writeFileSync(path.join(blockedRoot, 'blocked-result.txt'), 'the current execution was blocked before implementation\n', 'utf8');
      expect(recordStepResult(blockedRoot, {
        preflight_receipt: preflight.receipt,
        actual_changed_paths: [],
        command_results: preflight.current_step.commands.map(command => ({ command: command.command, status: 'blocked' as const, observed_repo_writes: [], evidence_refs: ['blocked-result.txt'] })),
        validation_results: preflight.current_step.validation.map(validation => ({ validation, status: 'not-run' as const, evidence_refs: [] })),
        acceptance_evidence: [],
        outcome: 'blocked',
        blocker_kind: 'environment',
        note: 'The current execution is settled as an environment blocker.',
      }).status).toBe('success');
      expect(prepareScopeAmendment(blockedRoot, amendment(crossDomain, 'after-blocked')).status).toBe('success');
      expect(readCanonicalCurrentTask(blockedRoot).mutationAuthority?.exact_exceptions).toContain(crossDomain);
    } finally {
      fs.rmSync(blockedRoot, { recursive: true, force: true });
    }

    const readyRoot = v2ConfirmedRoot();
    try {
      const preflight = preflightStep(readyRoot, { candidate_paths: ['packages/node-rollout/src/session.ts'] });
      fs.writeFileSync(path.join(readyRoot, 'retry-blocked.txt'), 'retry blocker\n', 'utf8');
      expect(recordStepResult(readyRoot, {
        preflight_receipt: preflight.receipt,
        actual_changed_paths: [],
        command_results: [{ command: preflight.current_step.commands[0]!.command, status: 'blocked', observed_repo_writes: [], evidence_refs: ['retry-blocked.txt'] }],
        validation_results: [{ validation: preflight.current_step.validation[0]!, status: 'not-run', evidence_refs: [] }],
        acceptance_evidence: [],
        outcome: 'blocked',
        blocker_kind: 'environment',
        note: 'Create a settled failed attempt before retrying.',
      }).status).toBe('success');
      const blocked = readCanonicalCurrentTask(readyRoot);
      const failedAttempt = blocked.runtimeState.step_attempts!['step-1']!.attempts[0]!;
      fs.writeFileSync(path.join(readyRoot, 'retry-resolution.json'), JSON.stringify({
        kind: 'environment-restored/v1', task_id: blocked.runtimeState.task_id, document_id: blocked.sourceTuple.document_id,
        step_id: 'step-1', blocked_attempt_id: failedAttempt.attempt_id, evidence_plan_revision: blocked.runtimeState.evidence_plan_revision,
        subject_revision: failedAttempt.blocker!.subject_snapshot.revision, status: 'passed',
        diagnosis: 'The fixture environment was unavailable.', resolution: 'The fixture environment is available for the next attempt.',
      }), 'utf8');
      expect(retryStep(readyRoot, {
        step_id: 'step-1', blocked_attempt_id: failedAttempt.attempt_id,
        blocker_resolution_refs: ['retry-resolution.json'], idempotency_key: 'step-3-ready-retry',
      }).status).toBe('success');
      const ready = readCanonicalCurrentTask(readyRoot);
      expect(ready.runtimeState.step_attempts!['step-1']!.attempts.at(-1)?.status).toBe('ready');
      expect(prepareScopeAmendment(readyRoot, amendment(crossDomain, 'after-ready-retry')).status).toBe('success');
      const amended = readCanonicalCurrentTask(readyRoot);
      expect(amended.runtimeState.step_attempts!['step-1']!.attempts).toHaveLength(2);
      expect(amended.runtimeState.step_attempts!['step-1']!.attempts[0]?.status).toBe('blocked');
      expect(amended.runtimeState.step_attempts!['step-1']!.attempts[1]?.status).toBe('ready');
    } finally {
      fs.rmSync(readyRoot, { recursive: true, force: true });
    }
  });

  test('E12 settled repair permits authority amendment while retaining findings and review state', () => {
    const product = 'packages/node-rollout/src/session.ts';
    const crossDomain = 'native/codex-rollout-collector/src/repair-protocol.rs';
    const root = v2ConfirmedRoot();
    try {
      const productPath = path.join(root, ...product.split('/'));
      fs.mkdirSync(path.dirname(productPath), { recursive: true });
      fs.writeFileSync(productPath, 'export const session = "before";\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [product] });
      fs.writeFileSync(productPath, 'export const session = "initial";\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: initial.receipt,
        actual_changed_paths: [product],
        command_results: initial.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: [], evidence_refs: evidence.evidence_refs })),
        validation_results: [{ validation: initial.current_step.validation[0]!, status: 'passed', evidence_refs: evidence.evidence_refs }],
        acceptance_evidence: [evidence], outcome: 'implemented', note: 'Record the implementation before the repair wave.',
      }).status).toBe('success');
      const discovery = reviewContext(root, {});
      expect(recordReviewResult(root, {
        context_receipt: discovery.receipt,
        verdict: 'findings',
        findings: [{
          category: 'correctness', file: product,
          failure_condition: 'the Node session behavior still violates the requested contract',
          required_behavior: 'repair the Node session behavior', root_cause_status: 'confirmed',
          evidence_refs: ['evidence-report.txt'],
        }],
        unresolved_fingerprints: [], evidence_refs: ['evidence-report.txt'], blocker: null,
      }).status).toBe('success');
      const repair = beginRepair(root, { candidate_paths: [product] });
      fs.writeFileSync(productPath, 'export const session = "repaired";\n', 'utf8');
      expect(recordStepResult(root, {
        preflight_receipt: repair.receipt,
        actual_changed_paths: [product],
        command_results: repair.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] })),
        validation_results: repair.current_step.validation.map(validation => ({ validation, status: 'passed' as const, evidence_refs: ['evidence-report.txt'] })),
        acceptance_evidence: [], outcome: 'implemented', note: 'Settle the repair execution before changing authority.',
      }).status).toBe('success');
      const settled = readCanonicalCurrentTask(root);
      const cycle = structuredClone(settled.runtimeState.review_cycle);
      expect(settled.runtimeState.findings[0]?.status).toBe('in-progress');
      expect(settled.runtimeState.execution_preflight?.mode).toBe('repair');
      expect(prepareScopeAmendment(root, {
        added_paths: [crossDomain],
        authorization: {
          decision_source: 'user:settled-repair-authority',
          decision_text: 'Authorize the exact Rust repair protocol path after the repair result is recorded.',
          authorized_paths: [crossDomain],
        },
        amendment_step: {
          id: 'settled-repair-authority-amendment',
          description: 'Continue the settled repair through the authorized Rust path',
          mutation_scope: [crossDomain],
          required_evidence: ['fresh cross-domain repair review'],
          commands: [],
        },
      }).status).toBe('success');
      const amended = readCanonicalCurrentTask(root);
      expect(amended.runtimeState.findings[0]?.status).toBe('in-progress');
      expect(amended.runtimeState.review_cycle).toEqual(cycle);
      expect(amended.runtimeState.review_coverage?.pending_paths).toEqual(expect.arrayContaining([product, crossDomain]));
      expect(amended.mutationAuthority?.exact_exceptions).toContain(crossDomain);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('Step 5 Flow C recovers from an actual blocked execution through authority amendment', () => {
    const nodeTarget = 'packages/node-rollout/src/session.ts';
    const rustTarget = 'native/codex-rollout-collector/src/protocol.rs';
    const root = v2ConfirmedRoot({
      implementation_steps: [{
        id: 'step-1',
        description: 'Implement the Node rollout behavior before any cross-domain recovery',
        planned_mutation_targets: [nodeTarget],
        commands: [{ command: 'bun test test/vnext-runtime.test.ts', expected_repo_writes: 'none' }],
        validation: ['The Node rollout behavior is verified'],
        review_checkpoint: { policy: 'required', reason: 'Review the Node implementation and any authorized continuation' },
      }],
    });
    try {
      const nodePath = path.join(root, ...nodeTarget.split('/'));
      const rustPath = path.join(root, ...rustTarget.split('/'));
      fs.mkdirSync(path.dirname(nodePath), { recursive: true });
      fs.writeFileSync(nodePath, 'export const session = "before";\n', 'utf8');
      const initial = preflightStep(root, { candidate_paths: [nodeTarget] });
      fs.writeFileSync(nodePath, 'export const session = "partially-implemented";\n', 'utf8');

      expect(recordStepResult(root, {
        preflight_receipt: initial.receipt,
        actual_changed_paths: [nodeTarget],
        command_results: [{ command: initial.current_step.commands[0]!.command, status: 'blocked', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
        validation_results: [{ validation: initial.current_step.validation[0]!, status: 'not-run', evidence_refs: [] }],
        acceptance_evidence: [],
        outcome: 'blocked',
        blocker_kind: 'unknown',
        note: 'The Node implementation was changed before the cross-domain dependency blocked the execution.',
      }).status).toBe('success');
      const blockedState = readCanonicalCurrentTask(root);
      expect(blockedState.runtimeState.execution_log).toContainEqual(expect.objectContaining({
        step_id: 'step-1',
        status: 'blocked',
        execution_result: expect.objectContaining({
          outcome: 'blocked',
          actual_changed_paths: [nodeTarget],
        }),
      }));

      const amended = prepareScopeAmendment(root, {
        added_paths: [rustTarget],
        authorization: {
          decision_source: 'user:step-5-cross-domain-recovery',
          decision_text: 'Authorize this exact Rust protocol target after the actual Node execution blocker is recorded.',
          authorized_paths: [rustTarget],
        },
        amendment_step: {
          id: 'cross-domain-recovery-continuation',
          description: 'Continue through the explicitly authorized Rust protocol target',
          mutation_scope: [rustTarget],
          required_evidence: ['Fresh Rust continuation execution and review'],
          commands: [],
        },
      });
      expect(amended.status).toBe('success');
      expect(readCanonicalCurrentTask(root).mutationAuthority?.exact_exceptions).toContain(rustTarget);

      const fresh = preflightStep(root, { candidate_paths: [rustTarget] });
      expect(fresh.receipt.step_id).toBe('cross-domain-recovery-continuation');
      fs.mkdirSync(path.dirname(rustPath), { recursive: true });
      fs.writeFileSync(rustPath, 'pub fn protocol() {\n    // authorized continuation\n}\n', 'utf8');
      expect(fs.readFileSync(rustPath, 'utf8')).toContain('authorized continuation');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: fresh.receipt,
        actual_changed_paths: [rustTarget],
        command_results: fresh.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: [], evidence_refs: evidence.evidence_refs })),
        validation_results: [{ validation: fresh.current_step.validation[0]!, status: 'passed', evidence_refs: evidence.evidence_refs }],
        acceptance_evidence: [evidence],
        outcome: 'implemented',
        note: 'Execute the fresh cross-domain continuation after explicit authority amendment.',
      }).status).toBe('success');
      const review = reviewContext(root, {});
      expect(review.recorded_execution.execution_result?.actual_changed_paths).toEqual([rustTarget]);
      expect(review.recorded_execution.execution_result?.change_delta.entries.map(entry => entry.path)).toEqual(
        expect.arrayContaining([nodeTarget, rustTarget]),
      );
      expect(recordReviewResult(root, {
        context_receipt: review.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: evidence.evidence_refs,
        blocker: null,
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'cross-domain-recovery-continuation', note: 'The explicitly authorized continuation is reviewed.' }).status).toBe('success');
      expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E13 committed scope-amendment candidates are immutable and do not corrupt later history', () => {
    const firstPath = 'native/codex-rollout-collector/src/first-protocol.rs';
    const secondPath = 'native/codex-rollout-collector/src/second-protocol.rs';
    const root = v2ConfirmedRoot();
    try {
      const amendment = (pathToAdd: string, id: string) => ({
        added_paths: [pathToAdd],
        authorization: {
          decision_source: `user:immutable-${id}`,
          decision_text: `Authorize the exact immutable-history path ${pathToAdd}.`,
          authorized_paths: [pathToAdd],
        },
        amendment_step: { id, description: `Continue through ${pathToAdd}`, mutation_scope: [pathToAdd], required_evidence: ['fresh review'], commands: [] },
      });
      const first = prepareScopeAmendment(root, amendment(firstPath, 'immutable-first'));
      const candidatePath = path.join(root, ...first.candidate_path.split('/'));
      expect(fs.existsSync(candidatePath)).toBe(true);
      expect(() => discardScopeAmendment(root, { candidate_digest: first.candidate_receipt.candidate_digest })).toThrow('SCOPE_AMENDMENT_ALREADY_COMMITTED');
      expect(fs.existsSync(`${candidatePath}.discarded`)).toBe(false);
      expect(prepareScopeAmendment(root, amendment(secondPath, 'immutable-second')).status).toBe('success');
      expect(readCanonicalCurrentTask(root).mutationAuthority?.exact_exceptions).toEqual(expect.arrayContaining([firstPath, secondPath]));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E14 same-domain absent persistent tests use an explicit P-12 admission route', () => {
    const newTest = 'packages/node-rollout-tests/new-regression.test.ts';
    const admission = {
      path: newTest,
      proves: ['A1'],
      owner: 'node-rollout-tests',
      owner_source: 'test:step-3-owner',
      source_ref: 'test:step-3-p12',
      basis: 'regression',
      existing_evidence_insufficiency: 'The existing implementation check does not exercise the newly discovered regression boundary.',
      assertion_boundary: 'The new regression assertion covers the Node rollout behavior within the node-rollout-tests domain.',
      failure_disposition: 'block',
    };
    const root = v2ConfirmedRoot();
    try {
      const initial = preflightStep(root, { candidate_paths: ['packages/node-rollout/src/session.ts'] });
      const before = readCanonicalCurrentTask(root);
      expect(() => extendPreflight(root, {
        current_preflight_receipt: initial.receipt,
        additional_targets: [newTest],
        blast_radius_assessments: [{
          target: { path: newTest, symbol: 'new regression oracle' },
          reason: 'The new test is a local test-domain oracle for the discovered behavior.',
          blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
          evidence_refs: ['evidence-report.txt'], disposition: 'self-admit',
        }],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('PERSISTENT_TEST_UNADMITTED');
      const afterRejected = readCanonicalCurrentTask(root);
      expect(afterRejected.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(JSON.stringify(afterRejected.runtimeState)).toBe(JSON.stringify(before.runtimeState));

      expect(() => prepareScopeAmendment(root, {
        added_paths: [newTest],
        authorization: null,
        amendment_step: {
          id: 'persistent-test-admission-missing',
          description: 'A new persistent test must not fall through to a no-op amendment',
          mutation_scope: [newTest],
          required_evidence: ['fresh regression execution and review'],
          commands: [],
        },
      })).toThrow('PERSISTENT_TEST_ADMISSION_REQUIRED');

      const amended = prepareScopeAmendment(root, {
        added_paths: [newTest],
        authorization: null,
        persistent_test_admissions: [admission],
        amendment_step: {
          id: 'persistent-test-admission-amendment',
          description: 'Add and verify the explicitly admitted regression test',
          mutation_scope: [newTest],
          required_evidence: ['fresh regression execution and review'],
          commands: [],
        },
      });
      expect(amended.status).toBe('success');
      expect(amended.committed).toBe(true);
      const afterAmendment = readCanonicalCurrentTask(root);
      expect(afterAmendment.mutationAuthority?.exact_exceptions).toEqual([]);
      expect(afterAmendment.body).toContain('owner: node-rollout-tests');
      expect(afterAmendment.body).toContain('existing_evidence_insufficiency: The existing implementation check does not exercise the newly discovered regression boundary.');
      expect(afterAmendment.body).not.toContain('owner: workflow-system');

      const fresh = preflightStep(root, { candidate_paths: [newTest] });
      const testPath = path.join(root, ...newTest.split('/'));
      fs.mkdirSync(path.dirname(testPath), { recursive: true });
      fs.writeFileSync(testPath, 'test("new regression", () => expect(true).toBe(true));\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: fresh.receipt,
        actual_changed_paths: [newTest],
        command_results: fresh.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: command.expected_repo_writes === 'none' ? [] : command.expected_repo_writes, evidence_refs: evidence.evidence_refs })),
        validation_results: fresh.current_step.validation.map(validation => ({ validation, status: 'passed' as const, evidence_refs: evidence.evidence_refs })),
        acceptance_evidence: [evidence], outcome: 'implemented', note: 'Execute the newly admitted persistent regression test.',
      }).status).toBe('success');
      const review = reviewContext(root, {});
      expect(recordReviewResult(root, {
        context_receipt: review.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'], blocker: null,
        test_assessment: {
          applicable: true,
          reason: 'The newly admitted persistent test is reviewed as the current regression oracle.',
          evidence_refs: ['evidence-report.txt'],
          necessity: 'The discovered regression boundary was not covered by existing evidence.',
          oracle: 'The new assertion is the explicit regression oracle for the Node behavior.',
          boundary: 'The test remains inside the node-rollout-tests authority domain.',
          reuse: 'No existing test covered this boundary, so the admitted test is newly created.',
          applicability: 'The current execution and cumulative diff cover the admitted test.',
        },
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'persistent-test-admission-amendment', note: 'The explicit P-12 regression admission and test are reviewed.' }).status).toBe('success');
      expect(readCanonicalCurrentTask(root).runtimeState.active_step_status).toBe('completed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E15 persistent-test admission rejects every missing P-12 field without Runtime defaults', () => {
    const fields = ['owner', 'proves', 'basis', 'existing_evidence_insufficiency', 'assertion_boundary'] as const;
    for (const field of fields) {
      const newTest = `packages/node-rollout-tests/missing-${field}.test.ts`;
      const root = v2ConfirmedRoot();
      try {
        const admission: Record<string, unknown> = {
          path: newTest, proves: ['A1'], owner: 'node-rollout-tests', owner_source: 'test:step-3-owner',
          source_ref: 'test:step-3-p12', basis: 'regression',
          existing_evidence_insufficiency: 'Existing evidence does not cover this new regression boundary.',
          assertion_boundary: 'The new test asserts the bounded Node behavior.', failure_disposition: 'block',
        };
        delete admission[field];
        const current = readCanonicalCurrentTask(root);
        const before = fs.readFileSync(current.filePath, 'utf8');
        expect(() => prepareScopeAmendment(root, {
          added_paths: [newTest], authorization: null, persistent_test_admissions: [admission],
          amendment_step: { id: `missing-p12-${field}`, description: 'This admission is incomplete', mutation_scope: [newTest], required_evidence: ['fresh review'], commands: [] },
        })).toThrow('PERSISTENT_TEST_ADMISSION_INVALID');
        expect(fs.readFileSync(current.filePath, 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(root, 'docs', 'workflow', 'task-candidates'))).toBe(false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('explicit typed P-12 admission accepts an unconventional same-domain test path', () => {
    const unconventional = 'packages/node-rollout-tests/qa/check.ts';
    const root = v2ConfirmedRoot();
    try {
      const prepared = prepareScopeAmendment(root, {
        added_paths: [unconventional],
        authorization: null,
        persistent_test_admissions: [{
          path: unconventional,
          proves: ['A1'],
          owner: 'node-rollout-tests',
          owner_source: 'test:step-3-unconventional-owner',
          source_ref: 'test:step-3-unconventional-p12',
          basis: 'regression',
          existing_evidence_insufficiency: 'Existing evidence does not exercise the unconventional regression boundary.',
          assertion_boundary: 'The explicit QA test covers only the Node rollout behavior in its authorized domain.',
          failure_disposition: 'block',
        }],
        amendment_step: {
          id: 'unconventional-persistent-test-admission',
          description: 'Add the explicitly admitted QA regression test',
          mutation_scope: [unconventional],
          required_evidence: ['fresh unconventional regression execution and review'],
          commands: [],
        },
      });
      expect(prepared.status).toBe('success');
      expect(prepared.candidate_receipt.authority_diff).toEqual({ added_exact_exceptions: [], added_domains: [] });
      expect(prepared.candidate_receipt.persistent_test_admission).toEqual({ added_paths: [unconventional] });
      expect(readCanonicalCurrentTask(root).mutationAuthority?.exact_exceptions).toEqual([]);

      const fresh = preflightStep(root, { candidate_paths: [unconventional] });
      const testPath = path.join(root, ...unconventional.split('/'));
      fs.mkdirSync(path.dirname(testPath), { recursive: true });
      fs.writeFileSync(testPath, 'test("unconventional regression", () => expect(true).toBe(true));\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: fresh.receipt,
        actual_changed_paths: [unconventional],
        command_results: fresh.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: [unconventional], evidence_refs: evidence.evidence_refs })),
        validation_results: fresh.current_step.validation.map(validation => ({ validation, status: 'passed' as const, evidence_refs: evidence.evidence_refs })),
        acceptance_evidence: [evidence], outcome: 'implemented', note: 'Create the explicitly admitted unconventional regression test.',
      }).status).toBe('success');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('review-read resolves new raw preimage blobs and fails closed when storage is missing or corrupt', () => {
    const target = 'packages/node-rollout/src/session.ts';
    const root = v2ConfirmedRoot();
    try {
      const targetPath = path.join(root, ...target.split('/'));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const baseline = 'export const session = "baseline";\n';
      fs.writeFileSync(targetPath, baseline, 'utf8');
      const preflight = preflightStep(root, { candidate_paths: [target] });
      const currentAfterPreflight = readCanonicalCurrentTask(root);
      const preimage = currentAfterPreflight.runtimeState.review_coverage!.preimages.find(item => item.path === target)!;
      expect(Object.keys(preimage).sort()).toEqual(['path', 'sha256', 'state']);
      const blob = reviewPreimageBlobPath(root, preimage.sha256!);
      expect(fs.readFileSync(blob)).toEqual(Buffer.from(baseline));
      fs.writeFileSync(targetPath, 'export const session = "changed";\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: preflight.receipt,
        actual_changed_paths: [target],
        command_results: preflight.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: [], evidence_refs: evidence.evidence_refs })),
        validation_results: preflight.current_step.validation.map(validation => ({ validation, status: 'passed' as const, evidence_refs: evidence.evidence_refs })),
        acceptance_evidence: [evidence], outcome: 'implemented', note: 'Review the raw first-touch baseline.',
      }).status).toBe('success');
      const context = reviewContext(root, {});
      expect(reviewRead(root, { context_receipt: context.receipt, path: target, view: 'before' }).text).toBe(baseline);
      expect(reviewRead(root, { context_receipt: context.receipt, path: target, view: 'after' }).text).toContain('changed');
      expect(reviewRead(root, { context_receipt: context.receipt, path: target, view: 'diff' }).text).toContain('+export const session = "changed";');

      fs.unlinkSync(blob);
      expect(() => reviewRead(root, { context_receipt: context.receipt, path: target, view: 'before' })).toThrow('REVIEW_BASELINE_MISSING');
      fs.writeFileSync(blob, 'corrupt baseline', 'utf8');
      expect(() => reviewRead(root, { context_receipt: context.receipt, path: target, view: 'diff' })).toThrow('REVIEW_BASELINE_HASH_MISMATCH');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('large review first-touch bytes stay outside canonical CURRENT_TASK', () => {
    const target = 'packages/node-rollout/src/session.ts';
    const root = v2ConfirmedRoot();
    try {
      const targetPath = path.join(root, ...target.split('/'));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const baseline = 'x'.repeat(500 * 1024) + '\n';
      fs.writeFileSync(targetPath, baseline, 'utf8');
      const currentPath = readCanonicalCurrentTask(root).filePath;
      const beforeBytes = fs.statSync(currentPath).size;
      preflightStep(root, { candidate_paths: [target] });
      const after = readCanonicalCurrentTask(root);
      const preimage = after.runtimeState.review_coverage!.preimages.find(item => item.path === target)!;
      const blob = reviewPreimageBlobPath(root, preimage.sha256!);
      expect(fs.statSync(blob).size).toBe(Buffer.byteLength(baseline));
      expect(fs.statSync(currentPath).size - beforeBytes).toBeLessThan(64 * 1024);
      expect(fs.readFileSync(currentPath, 'utf8')).not.toContain('content_base64');
      expect(Object.keys(preimage).sort()).toEqual(['path', 'sha256', 'state']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('legacy inline review preimages remain readable and migrate to verified raw blobs', () => {
    const target = 'packages/node-rollout/src/session.ts';
    const root = v2ConfirmedRoot();
    try {
      const targetPath = path.join(root, ...target.split('/'));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const baseline = 'export const session = "legacy baseline";\n';
      fs.writeFileSync(targetPath, baseline, 'utf8');
      const preflight = preflightStep(root, { candidate_paths: [target] });
      fs.writeFileSync(targetPath, 'export const session = "legacy after";\n', 'utf8');
      const evidence = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: preflight.receipt,
        actual_changed_paths: [target],
        command_results: preflight.current_step.commands.map(command => ({ command: command.command, status: 'passed' as const, observed_repo_writes: [], evidence_refs: evidence.evidence_refs })),
        validation_results: preflight.current_step.validation.map(validation => ({ validation, status: 'passed' as const, evidence_refs: evidence.evidence_refs })),
        acceptance_evidence: [evidence], outcome: 'implemented', note: 'Create a legacy inline review fixture.',
      }).status).toBe('success');

      useLegacyInlineCurrent(root);
      const current = readCanonicalCurrentTask(root);
      const frontmatter = structuredClone(current.frontmatter);
      const runtimeState = frontmatter.runtime_state as Record<string, any>;
      const coverage = runtimeState.review_coverage as Record<string, any>;
      coverage.preimages = coverage.preimages.map((item: Record<string, any>) => item.path === target
        ? { ...item, content_base64: Buffer.from(baseline).toString('base64') }
        : item);
      fs.writeFileSync(current.filePath, `---\n${stringify(frontmatter).trimEnd()}\n---\n${current.body}`, 'utf8');
      const legacy = readCanonicalCurrentTask(root);
      const legacyContext = reviewContext(root, {});
      fs.unlinkSync(reviewPreimageBlobPath(root, legacy.runtimeState.review_coverage!.preimages.find(item => item.path === target)!.sha256!));
      expect(reviewRead(root, { context_receipt: legacyContext.receipt, path: target, view: 'before' }).text).toBe(baseline);

      const migrated = commitTaskStorageMigration(root, legacy, legacy.sourceTuple.revision);
      expect(migrated.status).toBe('committed');
      const after = readCanonicalCurrentTask(root);
      const migratedPreimage = after.runtimeState.review_coverage!.preimages.find(item => item.path === target)!;
      expect(Object.keys(migratedPreimage).sort()).toEqual(['path', 'sha256', 'state']);
      expect(fs.readFileSync(reviewPreimageBlobPath(root, migratedPreimage.sha256!))).toEqual(Buffer.from(baseline));
      expect(fs.readFileSync(after.filePath, 'utf8')).not.toContain('content_base64');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('Step 5 Flow F failed dynamic expansion admission is atomic for forbidden, outside-domain and stale receipts', () => {
    const planned = 'packages/node-rollout/src/session.ts';
    const assessment = (target: string) => ({
      target: { path: target, symbol: 'discoveredTarget' },
      reason: 'The discovered target is the smallest bounded implementation change for this focused fixture.',
      blast_radius: { locality: 'local' as const, visibility: 'private' as const, cross_component_consumers: 'none' as const, contract_impact: 'none' as const },
      evidence_refs: ['evidence-report.txt'],
      disposition: 'self-admit' as const,
    });
    const assertUnchanged = (root: string, before: ReturnType<typeof readCanonicalCurrentTask>, beforeBytes: string, beforeStore: string) => {
      const after = readCanonicalCurrentTask(root);
      expect(fs.readFileSync(after.filePath, 'utf8')).toBe(beforeBytes);
      expect(after.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(after.runtimeState).toEqual(before.runtimeState);
      expect(taskStoreSnapshot(root)).toBe(beforeStore);
    };

    const forbiddenRoot = archivedBaselineRoot();
    enableV2MutationAuthority(forbiddenRoot);
    const forbiddenSemantic = v2MutationAuthoritySemanticDraft({
      implementation_steps: [{
        id: 'step-1',
        description: 'Exercise explicit forbidden expansion atomicity',
        planned_mutation_targets: [planned],
        commands: [],
        validation: ['The atomicity fixture is checked'],
        review_checkpoint: { policy: 'required', reason: 'Review the atomicity fixture' },
      }],
    });
    forbiddenSemantic.mutation_authority = {
      ...forbiddenSemantic.mutation_authority!,
      forbidden: ['packages/node-rollout/forbidden/**'],
    };
    const forbiddenPrepared = prepareDraft(forbiddenRoot, forbiddenSemantic);
    if (!forbiddenPrepared.confirmation_receipt) throw new Error('Flow F forbidden setup did not receive a confirmation receipt');
    expect(confirmDraft(forbiddenRoot, { confirmation_receipt: forbiddenPrepared.confirmation_receipt }).status).toBe('success');
    try {
      const plannedPath = path.join(forbiddenRoot, ...planned.split('/'));
      fs.mkdirSync(path.dirname(plannedPath), { recursive: true });
      fs.writeFileSync(plannedPath, 'export const session = "before";\n', 'utf8');
      const initial = preflightStep(forbiddenRoot, { candidate_paths: [planned] });
      const before = readCanonicalCurrentTask(forbiddenRoot);
      const beforeBytes = fs.readFileSync(before.filePath, 'utf8');
      const beforeStore = taskStoreSnapshot(forbiddenRoot);
      expect(() => extendPreflight(forbiddenRoot, {
        current_preflight_receipt: initial.receipt,
        additional_targets: ['packages/node-rollout/forbidden/file.ts'],
        blast_radius_assessments: [assessment('packages/node-rollout/forbidden/file.ts')],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('MUTATION_AUTHORITY_GOVERNANCE_BOUNDARY');
      assertUnchanged(forbiddenRoot, before, beforeBytes, beforeStore);
    } finally {
      fs.rmSync(forbiddenRoot, { recursive: true, force: true });
    }

    const outsideRoot = v2ConfirmedRoot();
    try {
      const plannedPath = path.join(outsideRoot, ...planned.split('/'));
      fs.mkdirSync(path.dirname(plannedPath), { recursive: true });
      fs.writeFileSync(plannedPath, 'export const session = "before";\n', 'utf8');
      const initial = preflightStep(outsideRoot, { candidate_paths: [planned] });
      const before = readCanonicalCurrentTask(outsideRoot);
      const beforeBytes = fs.readFileSync(before.filePath, 'utf8');
      const beforeStore = taskStoreSnapshot(outsideRoot);
      expect(() => extendPreflight(outsideRoot, {
        current_preflight_receipt: initial.receipt,
        additional_targets: ['native/codex-rollout-collector/src/outside.rs'],
        blast_radius_assessments: [assessment('native/codex-rollout-collector/src/outside.rs')],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('MUTATION_AUTHORITY_EXPANSION_REQUIRED');
      assertUnchanged(outsideRoot, before, beforeBytes, beforeStore);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }

    const staleRoot = v2ConfirmedRoot();
    try {
      const plannedPath = path.join(staleRoot, ...planned.split('/'));
      fs.mkdirSync(path.dirname(plannedPath), { recursive: true });
      fs.writeFileSync(plannedPath, 'export const session = "before";\n', 'utf8');
      const initial = preflightStep(staleRoot, { candidate_paths: [planned] });
      const firstExtension = extendPreflight(staleRoot, {
        current_preflight_receipt: initial.receipt,
        additional_targets: ['packages/node-rollout/internal/first.ts'],
        blast_radius_assessments: [assessment('packages/node-rollout/internal/first.ts')],
        evidence_refs: ['evidence-report.txt'],
      });
      const before = readCanonicalCurrentTask(staleRoot);
      const beforeBytes = fs.readFileSync(before.filePath, 'utf8');
      const beforeStore = taskStoreSnapshot(staleRoot);
      expect(() => extendPreflight(staleRoot, {
        current_preflight_receipt: initial.receipt,
        additional_targets: ['packages/node-rollout/internal/stale.ts'],
        blast_radius_assessments: [assessment('packages/node-rollout/internal/stale.ts')],
        evidence_refs: ['evidence-report.txt'],
      })).toThrow('EXECUTE_PREFLIGHT_STALE');
      assertUnchanged(staleRoot, before, beforeBytes, beforeStore);
      expect(firstExtension.receipt.candidate_paths).toEqual([planned, 'packages/node-rollout/internal/first.ts']);
    } finally {
      fs.rmSync(staleRoot, { recursive: true, force: true });
    }
  });

  test('E16 blocks v2 planned targets outside the selected authority domain during prepare', () => {
    const root = archivedBaselineRoot();
    enableV2MutationAuthority(root);
    try {
      const before = readCanonicalCurrentTask(root);
      expect(() => prepareDraft(root, v2MutationAuthoritySemanticDraft({
        implementation_steps: [{
          id: 'step-1',
          description: 'Attempt to plan a Rust target from a Node task',
          planned_mutation_targets: ['native/codex-rollout-collector/src/protocol.rs'],
          commands: [],
          validation: ['The planned target is checked'],
          review_checkpoint: { policy: 'required', reason: 'Review the planned target' },
        }],
      }))).toThrow('MUTATION_AUTHORITY_PLANNING_BLOCKED');
      expect(readCanonicalCurrentTask(root).sourceTuple.revision).toBe(before.sourceTuple.revision);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E17 blocks a planned command glob that is broader than the granted domain', () => {
    const root = archivedBaselineRoot();
    enableV2MutationAuthority(root);
    try {
      expect(() => prepareDraft(root, v2MutationAuthoritySemanticDraft({
        implementation_steps: [{
          id: 'step-1',
          description: 'Plan a command with an over-broad write footprint',
          planned_mutation_targets: ['packages/node-rollout/src/session.ts'],
          commands: [{ command: 'generator', expected_repo_writes: ['native/**'] }],
          validation: ['The command footprint is checked'],
          review_checkpoint: { policy: 'required', reason: 'Review the command footprint' },
        }],
      }))).toThrow('COMMAND_FOOTPRINT_AUTHORITY_BLOCKED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E18 accepts a planned command glob that is a strict subset of the granted domain', () => {
    const root = archivedBaselineRoot();
    enableV2MutationAuthority(root);
    try {
      const prepared = prepareDraft(root, v2MutationAuthoritySemanticDraft({
        implementation_steps: [{
          id: 'step-1',
          description: 'Plan a bounded generated-file command',
          planned_mutation_targets: ['packages/node-rollout/src/session.ts'],
          commands: [{ command: 'generator', expected_repo_writes: ['packages/node-rollout/generated/**'] }],
          validation: ['The bounded command footprint is checked'],
          review_checkpoint: { policy: 'required', reason: 'Review the bounded command footprint' },
        }],
      }));
      expect(prepared.confirmation_receipt).toBeDefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('E20 fails closed when the project authority domain-map revision changes after confirmation', () => {
    const root = v2ConfirmedRoot();
    try {
      const before = readCanonicalCurrentTask(root);
      expect(before.runtimeState.authority_domain_revision).toMatch(/^[a-f0-9]{64}$/);
      const profilePath = path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml');
      const profile = parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
      profile.mutation_authority = {
        domains: [
          { id: 'node-rollout', roots: ['packages/node-rollout-v2/**'] },
          { id: 'node-rollout-tests', roots: ['packages/node-rollout-tests/**'] },
          { id: 'rust-rollout', roots: ['native/codex-rollout-collector/**'] },
        ],
      };
      fs.writeFileSync(profilePath, stringify(profile), 'utf8');
      expect(() => preflightStep(root, { candidate_paths: ['packages/node-rollout/src/session.ts'] })).toThrow('MUTATION_AUTHORITY_DOMAIN_REVISION_STALE');
      const after = readCanonicalCurrentTask(root);
      expect(after.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(after.runtimeState).toEqual(before.runtimeState);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('stale domain-map revision blocks correction-replan without rebinding the task', () => {
    const root = v2TwoStepConfirmedRoot();
    const planned = 'packages/node-rollout/src/session.ts';
    try {
      const plannedPath = path.join(root, ...planned.split('/'));
      fs.mkdirSync(path.dirname(plannedPath), { recursive: true });
      fs.writeFileSync(plannedPath, 'export const session = "before";\n', 'utf8');
      const preflight = preflightStep(root, { candidate_paths: [planned] });
      const acceptance = reportFixture(root);
      expect(recordStepResult(root, {
        preflight_receipt: preflight.receipt,
        actual_changed_paths: [],
        command_results: [],
        validation_results: preflight.current_step.validation.map(validation => ({ validation, status: 'passed' as const, evidence_refs: ['evidence-report.txt'] })),
        acceptance_evidence: [acceptance],
        outcome: 'implemented',
        note: 'Settle the first step before challenging its evidence.',
      }).status).toBe('success');
      const review = reviewContext(root, {});
      expect(recordReviewResult(root, {
        context_receipt: review.receipt,
        verdict: 'clean',
        findings: [],
        unresolved_fingerprints: [],
        evidence_refs: ['evidence-report.txt'],
        blocker: null,
      }).status).toBe('success');
      expect(completeReviewedStep(root, { step_id: 'step-1', note: 'The first step is settled.' }).status).toBe('success');

      const current = readCanonicalCurrentTask(root);
      const result = current.runtimeState.claim_evidence![0]!.slots[0]!.report!;
      fs.writeFileSync(path.join(root, 'correction-counterexample.txt'), 'The first observation needs a bounded correction.\n', 'utf8');
      expect(recordEvidenceChallenge(root, {
        claim_id: 'A1',
        slot_id: 'a1',
        result_id: result.result_id,
        evidence_ref: 'correction-counterexample.txt',
        evidence_sha256: fileRevision(path.join(root, 'correction-counterexample.txt')),
        reason: 'The original observation requires a bounded correction.',
      }).status).toBe('success');
      const challenge = readCanonicalCurrentTask(root).runtimeState.evidence_challenges![0]!;
      const correction = prepareCorrectionReplan(root, {
        challenge_id: challenge.challenge_id,
        correction_step: {
          id: 'stale-domain-correction',
          description: 'Apply the bounded correction inside the existing Node domain',
          mutation_scope: ['packages/node-rollout/src/foo.ts'],
          commands: [],
          required_evidence: ['Verify the bounded correction'],
        },
        mode: 'execution-recovery',
        obligation_map: [{ claim_id: 'A1', slot_id: 'a1', due_step_id: 'stale-domain-correction' }],
      });
      const beforeDrift = readCanonicalCurrentTask(root);
      rewriteV2MutationAuthorityProfile(root, [
        { id: 'node-rollout', roots: ['packages/**'] },
        { id: 'node-rollout-tests', roots: ['node-test-surface/**'] },
        { id: 'rust-rollout', roots: ['native/codex-rollout-collector/**'] },
      ]);
      expect(() => confirmCorrectionReplan(root, {
        candidate_receipt: correction.candidate_receipt,
        authorization: {
          approved_candidate_digest: correction.candidate_receipt.candidate_digest,
          decision_source: 'test:stale-domain-replan',
          decision_text: 'Approve the bounded correction without changing task authority.',
          invalidation_reason: 'The challenged observation requires a bounded correction.',
        },
      })).toThrow('MUTATION_AUTHORITY_DOMAIN_REVISION_STALE');
      const afterRejected = readCanonicalCurrentTask(root);
      expect(afterRejected.runtimeState.authority_domain_revision).toBe(beforeDrift.runtimeState.authority_domain_revision);
      expect(afterRejected.sourceTuple.revision).toBe(beforeDrift.sourceTuple.revision);
      expect(fs.existsSync(path.join(root, ...correction.candidate_path.split('/')))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('stale domain-map revision blocks exact-path authority amendment without rebinding other domains', () => {
    const root = v2ConfirmedRoot();
    const crossDomain = 'native/codex-rollout-collector/src/protocol.rs';
    try {
      const before = readCanonicalCurrentTask(root);
      rewriteV2MutationAuthorityProfile(root, [
        { id: 'node-rollout', roots: ['packages/**'] },
        { id: 'node-rollout-tests', roots: ['node-test-surface/**'] },
        { id: 'rust-rollout', roots: ['native/codex-rollout-collector/**'] },
      ]);
      expect(() => prepareScopeAmendment(root, {
        added_paths: [crossDomain],
        authorization: {
          decision_source: 'test:stale-domain-amendment',
          decision_text: 'Authorize only this exact Rust protocol path.',
          authorized_paths: [crossDomain],
        },
        amendment_step: {
          id: 'stale-domain-exact-amendment',
          description: 'Continue through the explicitly authorized Rust protocol path',
          mutation_scope: [crossDomain],
          required_evidence: ['Verify the exact authorized path'],
          commands: [],
        },
      })).toThrow('MUTATION_AUTHORITY_DOMAIN_REVISION_STALE');
      const afterRejected = readCanonicalCurrentTask(root);
      expect(afterRejected.runtimeState.authority_domain_revision).toBe(before.runtimeState.authority_domain_revision);
      expect(afterRejected.sourceTuple.revision).toBe(before.sourceTuple.revision);
      expect(afterRejected.mutationAuthority?.exact_exceptions).toEqual(before.mutationAuthority?.exact_exceptions);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fixed tgz installed Node CLI supports same-envelope discovery without amendment or retry reset', { timeout: 120000 }, () => {
    const target = v2ConfirmedRoot();
    const plannedA = 'packages/node-rollout/src/session.ts';
    const plannedB = 'packages/node-rollout/src/reconnect.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    fs.mkdirSync(path.join(target, 'packages', 'node-rollout', 'src'), { recursive: true });
    fs.mkdirSync(path.join(target, 'packages', 'node-rollout', 'internal'), { recursive: true });
    fs.writeFileSync(path.join(target, ...plannedA.split('/')), 'export const session = "before";\n', 'utf8');
    fs.writeFileSync(path.join(target, ...plannedB.split('/')), 'export const reconnect = "before";\n', 'utf8');
    fs.writeFileSync(path.join(target, ...discovered.split('/')), 'export const normalizeState = (value) => value;\n', 'utf8');
    const runtimeCli = installFixedTgzRuntime(target, 'same-envelope');
    const before = readCanonicalCurrentTask(target);
    const initial = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [plannedA, plannedB] });
    expect(initial.status, initial.stderr).toBe(0);
    expect(initial.json).toMatchObject({ status: 'pass', receipt: { mutation_authority_version: 2, candidate_paths: [plannedA, plannedB] } });
    const initialAttempt = readCanonicalCurrentTask(target).runtimeState.step_attempts!['step-1']!.attempts[0]!;
    fs.writeFileSync(path.join(target, ...plannedA.split('/')), 'export const session = "after";\n', 'utf8');

    const extension = runInstalledRuntimeCli(runtimeCli, target, 'extend-preflight', {
      current_preflight_receipt: initial.json.receipt,
      additional_targets: [discovered],
      blast_radius_assessments: [{
        target: { path: discovered, symbol: 'normalizeState' },
        reason: 'The local helper owns the normalization bug; changing the shared protocol would be broader and is not needed.',
        blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
        evidence_refs: ['packages/node-rollout/src/session.ts', 'evidence-report.txt'],
        disposition: 'self-admit',
      }],
      evidence_refs: ['evidence-report.txt'],
    });
    expect(extension.status).toBe(0);
    expect(extension.json).toMatchObject({ status: 'pass', operation_kind: 'execute-step-preflight-extension', receipt: { mutation_authority_version: 2, candidate_paths: [plannedA, plannedB, discovered] } });
    const afterExtension = readCanonicalCurrentTask(target);
    const extendedAttempt = afterExtension.runtimeState.step_attempts!['step-1']!.attempts[0]!;
    expect(extendedAttempt.attempt_id).toBe(initialAttempt.attempt_id);
    expect(afterExtension.runtimeState.step_attempts!['step-1']!.attempts).toHaveLength(1);
    expect(afterExtension.runtimeState.evidence_plan_revision).toBe(before.runtimeState.evidence_plan_revision);
    expect(afterExtension.runtimeState.dynamic_review_required).toBe(false);
    expect(afterExtension.runtimeState.dynamic_expansions).toEqual([expect.objectContaining({ path: discovered, domain: 'node-rollout', first_touch_state: 'file' })]);
    expect(afterExtension.runtimeState.execution_log.some(item => 'action' in item && item.action === 'commit-scope-amendment')).toBe(false);

    fs.writeFileSync(path.join(target, ...discovered.split('/')), 'export const normalizeState = (value) => value.trim();\n', 'utf8');
    expect(fs.readFileSync(path.join(target, ...discovered.split('/')), 'utf8')).toContain('value.trim()');
    const evidenceContext = runInstalledRuntimeCli(runtimeCli, target, 'evidence-context', {});
    expect(evidenceContext.status).toBe(0);
    const currentStep = extension.json.current_step;
    const result = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: extension.json.receipt,
      actual_changed_paths: [plannedA, discovered],
      command_results: [{ command: currentStep.commands[0].command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] }],
      validation_results: [{ validation: currentStep.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: installedAcceptanceEvidence(evidenceContext.json),
      outcome: 'implemented',
      note: 'The installed CLI recorded the implementation after same-envelope discovery.',
    });
    if (result.status !== 0) throw new Error(`same-envelope result failed: ${result.stderr}\n${result.stdout}`);
    const afterResult = readCanonicalCurrentTask(target);
    expect(afterResult.runtimeState.dynamic_review_required).toBe(false);
    expect(afterResult.runtimeState.active_step_status).toBe('in-progress');
    expect(afterResult.runtimeState.execution_log).toContainEqual(expect.objectContaining({
      execution_result: expect.objectContaining({
        actual_changed_paths: [discovered, plannedA].sort(),
        change_delta: expect.objectContaining({ entries: expect.arrayContaining([expect.objectContaining({ path: discovered })]) }),
      }),
    }));
    const reviewContextResult = runInstalledRuntimeCli(runtimeCli, target, 'review-context', {});
    expect(reviewContextResult.status).toBe(0);
    expect(reviewContextResult.json).toMatchObject({
      planned_mutation_targets: [plannedA, plannedB],
      expanded_mutation_targets: [expect.objectContaining({ path: discovered, assessment: expect.objectContaining({ disposition: 'self-admit' }) })],
    });
    expect(reviewContextResult.json.recorded_execution.execution_result.actual_changed_paths).toEqual([discovered, plannedA].sort());
    const discoveredDiff = runInstalledRuntimeCli(runtimeCli, target, 'review-read', {
      context_receipt: reviewContextResult.json.receipt,
      path: discovered,
      view: 'diff',
    });
    expect(discoveredDiff.status).toBe(0);
    expect(discoveredDiff.json.text).toContain('value.trim()');
    const prematureCompletion = runInstalledRuntimeCli(runtimeCli, target, 'complete-reviewed-step', { step_id: 'step-1', note: 'review is still required' });
    expect(prematureCompletion.status).not.toBe(0);
    expect(prematureCompletion.stderr).toContain('CLEAN_REVIEW_REQUIRED');
    const review = runInstalledRuntimeCli(runtimeCli, target, 'record-review-result', {
      context_receipt: reviewContextResult.json.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
      test_assessment: installedReviewAssessment(),
    });
    expect(review.status).toBe(0);
    expect(readCanonicalCurrentTask(target).runtimeState.dynamic_review_required).toBe(false);
    const completed = runInstalledRuntimeCli(runtimeCli, target, 'complete-reviewed-step', { step_id: 'step-1', note: 'The cumulative dynamic review is clean.' });
    expect(completed.status).toBe(0);
    const final = readCanonicalCurrentTask(target);
    expect(final.runtimeState.active_step_status).toBe('completed');
    expect(final.runtimeState.step_attempts!['step-1']!.attempts).toHaveLength(1);
  });

  test('Step 5 fixed tgz Flow B repairs a same-envelope discovered helper without amendment', { timeout: 120000 }, () => {
    const target = v2ConfirmedRoot();
    const planned = 'packages/node-rollout/src/session.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    fs.mkdirSync(path.dirname(path.join(target, ...planned.split('/'))), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(target, ...discovered.split('/'))), { recursive: true });
    fs.writeFileSync(path.join(target, ...planned.split('/')), 'export const session = "before";\n', 'utf8');
    fs.writeFileSync(path.join(target, ...discovered.split('/')), 'export const normalizeState = (value) => value;\n', 'utf8');
    const runtimeCli = installFixedTgzRuntime(target, 'repair-discovery');
    const initial = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [planned] });
    if (initial.status !== 0) throw new Error(`repair initial preflight failed: ${initial.stderr}\n${initial.stdout}`);
    fs.writeFileSync(path.join(target, ...planned.split('/')), 'export const session = "implemented";\n', 'utf8');
    const initialStep = initial.json.current_step;
    const evidenceContext = runInstalledRuntimeCli(runtimeCli, target, 'evidence-context', {});
    expect(evidenceContext.status).toBe(0);
    const result = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: initial.json.receipt,
      actual_changed_paths: [planned],
      command_results: initialStep.commands.map(command => ({ command: command.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] })),
      validation_results: initialStep.validation.map(validation => ({ validation, status: 'passed', evidence_refs: ['evidence-report.txt'] })),
      acceptance_evidence: installedAcceptanceEvidence(evidenceContext.json),
      outcome: 'implemented',
      note: 'Record the initial installed implementation before repair discovery.',
    });
    if (result.status !== 0) throw new Error(`repair initial result failed: ${result.stderr}\n${result.stdout}`);
    const discovery = runInstalledRuntimeCli(runtimeCli, target, 'review-context', {});
    expect(discovery.status).toBe(0);
    const finding = runInstalledRuntimeCli(runtimeCli, target, 'record-review-result', {
      context_receipt: discovery.json.receipt,
      verdict: 'findings',
      findings: [{
        category: 'correctness',
        file: planned,
        failure_condition: 'session state is not normalized before reconnect',
        required_behavior: 'normalize session state before reconnect',
        root_cause_status: 'confirmed',
        evidence_refs: ['evidence-report.txt'],
      }],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
      test_assessment: installedReviewAssessment(),
    });
    if (finding.status !== 0) throw new Error(`repair finding result failed: ${finding.stderr}\n${finding.stdout}`);
    const repair = runInstalledRuntimeCli(runtimeCli, target, 'begin-repair', { candidate_paths: [planned] });
    if (repair.status !== 0) throw new Error(`repair preflight failed: ${repair.stderr}\n${repair.stdout}`);
    fs.writeFileSync(path.join(target, ...planned.split('/')), 'export const session = "repaired";\n', 'utf8');
    const extension = runInstalledRuntimeCli(runtimeCli, target, 'extend-preflight', {
      current_preflight_receipt: repair.json.receipt,
      additional_targets: [discovered],
      blast_radius_assessments: [{
        target: { path: discovered, symbol: 'normalizeState' },
        reason: 'The private helper is the smallest correct repair; changing a shared protocol would broaden the change without evidence.',
        blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
        evidence_refs: ['evidence-report.txt'],
        disposition: 'self-admit',
      }],
      evidence_refs: ['evidence-report.txt'],
    });
    if (extension.status !== 0) throw new Error(`repair extension failed: ${extension.stderr}\n${extension.stdout}`);
    expect(extension.json.receipt.mode).toBe('repair');
    expect(extension.json.receipt.execution_id).toBe(repair.json.receipt.execution_id);
    fs.writeFileSync(path.join(target, ...planned.split('/')), 'export const session = "fixed";\n', 'utf8');
    fs.writeFileSync(path.join(target, ...discovered.split('/')), 'export const normalizeState = (value) => value.trim();\n', 'utf8');
    expect(fs.readFileSync(path.join(target, ...discovered.split('/')), 'utf8')).toContain('value.trim()');
    const repairedStep = extension.json.current_step;
    const repaired = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: extension.json.receipt,
      actual_changed_paths: [planned, discovered],
      command_results: repairedStep.commands.map(command => ({ command: command.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] })),
      validation_results: repairedStep.validation.map(validation => ({ validation: validation, status: 'passed', evidence_refs: ['evidence-report.txt'] })),
      acceptance_evidence: [],
      outcome: 'implemented',
      note: 'Repair the finding and the discovered private helper in one installed repair wave.',
    });
    if (repaired.status !== 0) throw new Error(`repair result failed: ${repaired.stderr}\n${repaired.stdout}`);
    const verification = runInstalledRuntimeCli(runtimeCli, target, 'review-context', {});
    expect(verification.status).toBe(0);
    expect(verification.json.receipt.cycle_phase).toBe('verification');
    expect(verification.json.recorded_execution.execution_result.actual_changed_paths).toEqual([discovered, planned].sort());
    expect(readCanonicalCurrentTask(target).runtimeState.execution_log.some((item: { action?: string }) => item.action === 'commit-scope-amendment')).toBe(false);
    const clean = runInstalledRuntimeCli(runtimeCli, target, 'record-review-result', {
      context_receipt: verification.json.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
      test_assessment: installedReviewAssessment(),
    });
    expect(clean.status).toBe(0);
    expect(runInstalledRuntimeCli(runtimeCli, target, 'complete-reviewed-step', { step_id: 'step-1', note: 'The repair discovery and local helper change are verified.' }).status).toBe(0);
    const final = readCanonicalCurrentTask(target);
    expect(final.runtimeState.active_step_status).toBe('completed');
    expect(final.runtimeState.step_attempts!['step-1']!.attempts).toHaveLength(1);
  });

  test('Step 5 fixed tgz Flow C recovers after an actual blocked Node execution', { timeout: 120000 }, () => {
    const target = v2ConfirmedRoot();
    const nodeTarget = 'packages/node-rollout/src/session.ts';
    const rustTarget = 'native/codex-rollout-collector/src/protocol.rs';
    fs.mkdirSync(path.dirname(path.join(target, ...nodeTarget.split('/'))), { recursive: true });
    fs.writeFileSync(path.join(target, ...nodeTarget.split('/')), 'export const session = "before";\n', 'utf8');
    const runtimeCli = installFixedTgzRuntime(target, 'cross-envelope-recovery');
    const before = readCanonicalCurrentTask(target);
    const initial = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [nodeTarget] });
    if (initial.status !== 0) throw new Error(`cross-envelope initial preflight failed: ${initial.stderr}\n${initial.stdout}`);
    fs.writeFileSync(path.join(target, ...nodeTarget.split('/')), 'export const session = "partially-implemented";\n', 'utf8');
    const initialStep = initial.json.current_step;
    const blocked = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: initial.json.receipt,
      actual_changed_paths: [nodeTarget],
      command_results: initialStep.commands.map(command => ({ command: command.command, status: 'blocked', observed_repo_writes: [], evidence_refs: ['evidence-report.txt'] })),
      validation_results: initialStep.validation.map(validation => ({ validation, status: 'not-run', evidence_refs: [] })),
      acceptance_evidence: [],
      outcome: 'blocked',
      blocker_kind: 'unknown',
      note: 'The installed Node execution changed its target before a cross-domain dependency blocked the work.',
    });
    if (blocked.status !== 0) throw new Error(`cross-envelope blocked result failed: ${blocked.stderr}\n${blocked.stdout}`);
    expect(readCanonicalCurrentTask(target).runtimeState.execution_log).toContainEqual(expect.objectContaining({
      execution_result: expect.objectContaining({ outcome: 'blocked', actual_changed_paths: [nodeTarget] }),
    }));

    const amended = runInstalledRuntimeCli(runtimeCli, target, 'prepare-scope-amendment', {
      added_paths: [rustTarget],
      authorization: {
        decision_source: 'user:fixed-tgz-cross-envelope-recovery',
        decision_text: 'Authorize this exact Rust protocol path after the actual Node execution blocker is recorded.',
        authorized_paths: [rustTarget],
      },
      amendment_step: {
        id: 'cross-envelope-recovery-continuation',
        description: 'Apply and verify the explicitly authorized Rust protocol continuation',
        mutation_scope: [rustTarget],
        required_evidence: ['fresh installed cross-domain execution and review'],
        commands: [],
      },
    });
    expect(amended.status).toBe(0);
    expect(amended.json).toMatchObject({ status: 'success', committed: true });
    const afterAmendment = readCanonicalCurrentTask(target);
    expect(afterAmendment.runtimeState.active_step_id).toBe('cross-envelope-recovery-continuation');
    expect(afterAmendment.mutationAuthority?.exact_exceptions).toContain(rustTarget);
    expect(afterAmendment.sourceTuple.revision).not.toBe(before.sourceTuple.revision);
    expect(afterAmendment.runtimeState.execution_log.some(item => 'action' in item && item.action === 'commit-scope-amendment')).toBe(true);

    const preflight = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [rustTarget] });
    if (preflight.status !== 0) throw new Error(`cross-envelope fresh preflight failed: ${preflight.stderr}\n${preflight.stdout}`);
    expect(preflight.json.receipt.candidate_paths).toEqual([rustTarget]);
    fs.mkdirSync(path.dirname(path.join(target, ...rustTarget.split('/'))), { recursive: true });
    fs.writeFileSync(path.join(target, ...rustTarget.split('/')), 'pub fn protocol() {\n    // authorized continuation\n}\n', 'utf8');
    expect(fs.readFileSync(path.join(target, ...rustTarget.split('/')), 'utf8')).toContain('authorized continuation');
    const evidenceContext = runInstalledRuntimeCli(runtimeCli, target, 'evidence-context', {});
    expect(evidenceContext.status).toBe(0);
    const currentStep = preflight.json.current_step;
    const result = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: preflight.json.receipt,
      actual_changed_paths: [rustTarget],
      command_results: currentStep.commands.map(command => ({ command: command.command, status: 'passed', observed_repo_writes: [rustTarget], evidence_refs: ['evidence-report.txt'] })),
      validation_results: currentStep.validation.map(validation => ({ validation, status: 'passed', evidence_refs: ['evidence-report.txt'] })),
      acceptance_evidence: installedAcceptanceEvidence(evidenceContext.json),
      outcome: 'implemented',
      note: 'The amended task executed the exact cross-domain exception after fresh preflight.',
    });
    if (result.status !== 0) throw new Error(`cross-envelope result failed: ${result.stderr}\n${result.stdout}`);
    const reviewContextResult = runInstalledRuntimeCli(runtimeCli, target, 'review-context', {});
    expect(reviewContextResult.status).toBe(0);
    expect(reviewContextResult.json.recorded_execution.execution_result.actual_changed_paths).toEqual([rustTarget]);
    expect(reviewContextResult.json.recorded_execution.execution_result.change_delta.entries.map((entry: { path: string }) => entry.path)).toEqual(
      expect.arrayContaining([nodeTarget, rustTarget]),
    );
    const review = runInstalledRuntimeCli(runtimeCli, target, 'record-review-result', {
      context_receipt: reviewContextResult.json.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
      test_assessment: installedReviewAssessment(),
    });
    expect(review.status).toBe(0);
    expect(runInstalledRuntimeCli(runtimeCli, target, 'complete-reviewed-step', { step_id: 'cross-envelope-recovery-continuation', note: 'The amended cross-domain change is reviewed.' }).status).toBe(0);
    expect(readCanonicalCurrentTask(target).runtimeState.active_step_status).toBe('completed');
  });

  test('Step 5 fixed tgz Flow D preserves cumulative review across steps and extensions', { timeout: 120000 }, () => {
    const target = v2TwoStepConfirmedRoot('not-required');
    const plannedA = 'packages/node-rollout/src/session.ts';
    const plannedB = 'packages/node-rollout/src/reconnect.ts';
    const discovered = 'packages/node-rollout/internal/state.ts';
    for (const file of [plannedA, plannedB, discovered]) {
      fs.mkdirSync(path.dirname(path.join(target, ...file.split('/'))), { recursive: true });
      fs.writeFileSync(path.join(target, ...file.split('/')), `export const ${path.basename(file, path.extname(file))} = "before";\n`, 'utf8');
    }
    const runtimeCli = installFixedTgzRuntime(target, 'cumulative-review');
    const first = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [plannedA] });
    if (first.status !== 0) throw new Error(`cumulative S1 preflight failed: ${first.stderr}\n${first.stdout}`);
    fs.writeFileSync(path.join(target, ...plannedA.split('/')), 'export const session = "after";\n', 'utf8');
    const firstEvidenceContext = runInstalledRuntimeCli(runtimeCli, target, 'evidence-context', {});
    expect(firstEvidenceContext.status).toBe(0);
    const firstResult = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: first.json.receipt,
      actual_changed_paths: [plannedA],
      command_results: [],
      validation_results: [{ validation: first.json.current_step.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: installedAcceptanceEvidence(firstEvidenceContext.json),
      outcome: 'implemented',
      note: 'Complete the exempt first step and retain its cumulative review target.',
    });
    if (firstResult.status !== 0) throw new Error(`cumulative S1 result failed: ${firstResult.stderr}\n${firstResult.stdout}`);
    expect(readCanonicalCurrentTask(target).runtimeState.active_step_id).toBe('step-2');
    expect(readCanonicalCurrentTask(target).runtimeState.review_coverage.target.entries.map((entry: { path: string }) => entry.path)).toContain(plannedA);

    const second = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [plannedB] });
    if (second.status !== 0) throw new Error(`cumulative S2 preflight failed: ${second.stderr}\n${second.stdout}`);
    const extension = runInstalledRuntimeCli(runtimeCli, target, 'extend-preflight', {
      current_preflight_receipt: second.json.receipt,
      additional_targets: [discovered],
      blast_radius_assessments: [{
        target: { path: discovered, symbol: 'normalizeState' },
        reason: 'The private helper is the smallest correct S2 implementation and does not require propagation.',
        blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
        evidence_refs: ['evidence-report.txt'],
        disposition: 'self-admit',
      }],
      evidence_refs: ['evidence-report.txt'],
    });
    if (extension.status !== 0) throw new Error(`cumulative S2 extension failed: ${extension.stderr}\n${extension.stdout}`);
    fs.writeFileSync(path.join(target, ...plannedB.split('/')), 'export const reconnect = "after";\n', 'utf8');
    fs.writeFileSync(path.join(target, ...discovered.split('/')), 'export const normalizeState = (value) => value.trim();\n', 'utf8');
    const secondResult = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: extension.json.receipt,
      actual_changed_paths: [plannedB, discovered],
      command_results: [],
      validation_results: [{ validation: extension.json.current_step.validation[0], status: 'passed', evidence_refs: ['evidence-report.txt'] }],
      acceptance_evidence: [],
      outcome: 'implemented',
      note: 'Record S2 with its local same-envelope discovery.',
    });
    if (secondResult.status !== 0) throw new Error(`cumulative S2 result failed: ${secondResult.stderr}\n${secondResult.stdout}`);
    const reviewContextResult = runInstalledRuntimeCli(runtimeCli, target, 'review-context', {});
    expect(reviewContextResult.status).toBe(0);
    expect(reviewContextResult.json.expanded_mutation_targets).toEqual([
      expect.objectContaining({ path: discovered, step_id: 'step-2' }),
    ]);
    expect(reviewContextResult.json.recorded_execution.execution_result.actual_changed_paths).toEqual([discovered, plannedB].sort());
    expect(reviewContextResult.json.recorded_execution.execution_result.change_delta.entries.map((entry: { path: string }) => entry.path)).toEqual(
      expect.arrayContaining([plannedA, plannedB, discovered]),
    );
    const review = runInstalledRuntimeCli(runtimeCli, target, 'record-review-result', {
      context_receipt: reviewContextResult.json.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
      test_assessment: installedReviewAssessment(),
    });
    expect(review.status).toBe(0);
    expect(runInstalledRuntimeCli(runtimeCli, target, 'complete-reviewed-step', { step_id: 'step-2', note: 'The cumulative S1 and S2 diff is reviewed.' }).status).toBe(0);
    expect(readCanonicalCurrentTask(target).runtimeState.active_step_status).toBe('completed');
  });

  test('Step 5 fixed tgz Flow E admits an absent persistent test explicitly', { timeout: 120000 }, () => {
    const target = v2ConfirmedRoot();
    const planned = 'packages/node-rollout/src/session.ts';
    const newTest = 'packages/node-rollout-tests/new-regression.test.ts';
    fs.mkdirSync(path.dirname(path.join(target, ...planned.split('/'))), { recursive: true });
    fs.writeFileSync(path.join(target, ...planned.split('/')), 'export const session = "before";\n', 'utf8');
    const runtimeCli = installFixedTgzRuntime(target, 'persistent-test-admission');
    const initial = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [planned] });
    if (initial.status !== 0) throw new Error(`persistent-test initial preflight failed: ${initial.stderr}\n${initial.stdout}`);
    const before = readCanonicalCurrentTask(target);
    const beforeBytes = fs.readFileSync(before.filePath, 'utf8');
    const ordinary = runInstalledRuntimeCli(runtimeCli, target, 'extend-preflight', {
      current_preflight_receipt: initial.json.receipt,
      additional_targets: [newTest],
      blast_radius_assessments: [{
        target: { path: newTest, symbol: 'regressionOracle' },
        reason: 'The absent test is a local oracle for the discovered behavior.',
        blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
        evidence_refs: ['evidence-report.txt'],
        disposition: 'self-admit',
      }],
      evidence_refs: ['evidence-report.txt'],
    });
    expect(ordinary.status).not.toBe(0);
    expect(ordinary.stderr).toContain('PERSISTENT_TEST_UNADMITTED');
    expect(fs.readFileSync(before.filePath, 'utf8')).toBe(beforeBytes);
    expect(readCanonicalCurrentTask(target).sourceTuple.revision).toBe(before.sourceTuple.revision);
    const admission = {
      path: newTest,
      proves: ['A1'],
      owner: 'node-rollout-tests',
      owner_source: 'test:step-5-p12-owner',
      source_ref: 'test:step-5-p12',
      basis: 'regression',
      existing_evidence_insufficiency: 'Existing implementation checks do not exercise the newly discovered regression boundary.',
      assertion_boundary: 'The explicit QA regression test covers only the authorized Node rollout behavior.',
      failure_disposition: 'block',
    };
    const amended = runInstalledRuntimeCli(runtimeCli, target, 'prepare-scope-amendment', {
      added_paths: [newTest],
      authorization: null,
      persistent_test_admissions: [admission],
      amendment_step: {
        id: 'persistent-test-admission-continuation',
        description: 'Add and verify the explicitly admitted persistent regression test',
        mutation_scope: [newTest],
        required_evidence: ['fresh persistent-test execution and review'],
        commands: [],
      },
    });
    if (amended.status !== 0) throw new Error(`persistent-test amendment failed: ${amended.stderr}\n${amended.stdout}`);
    expect(amended.json.candidate_receipt.authority_diff).toEqual({ added_exact_exceptions: [], added_domains: [] });
    expect(amended.json.candidate_receipt.persistent_test_admission).toEqual({ added_paths: [newTest] });

    const fresh = runInstalledRuntimeCli(runtimeCli, target, 'preflight-step', { candidate_paths: [newTest] });
    if (fresh.status !== 0) throw new Error(`persistent-test fresh preflight failed: ${fresh.stderr}\n${fresh.stdout}`);
    const testPath = path.join(target, ...newTest.split('/'));
    fs.mkdirSync(path.dirname(testPath), { recursive: true });
    fs.writeFileSync(testPath, 'test("new regression", () => expect(true).toBe(true));\n', 'utf8');
    const evidenceContext = runInstalledRuntimeCli(runtimeCli, target, 'evidence-context', {});
    expect(evidenceContext.status).toBe(0);
    const currentStep = fresh.json.current_step;
    const result = runInstalledRuntimeCli(runtimeCli, target, 'record-step-result', {
      preflight_receipt: fresh.json.receipt,
      actual_changed_paths: [newTest],
      command_results: currentStep.commands.map((command: { command: string; expected_repo_writes: string | string[] }) => ({
        command: command.command,
        status: 'passed',
        observed_repo_writes: command.expected_repo_writes === 'none' ? [] : command.expected_repo_writes,
        evidence_refs: ['evidence-report.txt'],
      })),
      validation_results: currentStep.validation.map((validation: string) => ({ validation, status: 'passed', evidence_refs: ['evidence-report.txt'] })),
      acceptance_evidence: installedAcceptanceEvidence(evidenceContext.json),
      outcome: 'implemented',
      note: 'Create the explicitly admitted unconventional persistent regression test.',
    });
    if (result.status !== 0) throw new Error(`persistent-test result failed: ${result.stderr}\n${result.stdout}`);
    const reviewContextResult = runInstalledRuntimeCli(runtimeCli, target, 'review-context', {});
    expect(reviewContextResult.status).toBe(0);
    expect(reviewContextResult.json.persistent_tests).toContain(newTest);
    const review = runInstalledRuntimeCli(runtimeCli, target, 'record-review-result', {
      context_receipt: reviewContextResult.json.receipt,
      verdict: 'clean',
      findings: [],
      unresolved_fingerprints: [],
      evidence_refs: ['evidence-report.txt'],
      blocker: null,
      test_assessment: {
        ...installedReviewAssessment(),
        necessity: 'The explicit P-12 admission records why existing evidence was insufficient.',
        oracle: 'The QA assertion is the newly admitted regression oracle.',
        reuse: 'No existing test covered the unconventional path, so the test is newly created.',
      },
    });
    expect(review.status).toBe(0);
    expect(runInstalledRuntimeCli(runtimeCli, target, 'complete-reviewed-step', { step_id: 'persistent-test-admission-continuation', note: 'The explicit P-12 test admission and change are reviewed.' }).status).toBe(0);
    expect(fs.readFileSync(testPath, 'utf8')).toContain('new regression');
    expect(readCanonicalCurrentTask(target).runtimeState.active_step_status).toBe('completed');
  });
});
