/**
 * Human-semantic adapter for execute-step.
 *
 * The public entry supplies intended/actual paths and ordinary command,
 * validation, and acceptance results. Runtime-owned scope evaluation,
 * proposal construction, authority evidence, finding bookkeeping, commit,
 * advancement, and read-back stay here and in the transaction kernel.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  taskSourceRevisionMatches,
  executeConfirmedArtifactRestore,
  listArtifactCheckpoints,
  GovernanceTransactionKernel,
  MAX_REPAIR_ATTEMPTS,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  VNextRuntimeError,
  applyVNextRuntimeProposal,
  assertTestStrategySequenceReady,
  assertOrdinaryPreflight,
  assertExecutionTargetAdmissions,
  assertBusinessEvidenceVersion,
  assertExecutionResultWaivers,
  replaceValidation,
  createStepPreflightProposal,
  createStepExtendPreflightProposal,
  createStepRetryProposal,
  createPreflightReconciliationProposal,
  type StepRepairDiagnosis,
  nextStepAttemptId,
  evaluateClaimEvidence,
  hasRemainingCorrectionTargets,
  validateStepAcceptanceEvidence,
  type StepAcceptanceEvidence,
  captureReviewTarget,
  createReviewTargetManifest,
  createFindingQueueProposal,
  createReviewChangeDelta,
  currentDefinitionExecutionLog,
  repairBudgetContinuationForPendingReview,
  repairFingerprintsForPendingReview,
  outstandingRepairPreflight,
  reviewCycleForNextStep,
  cumulativeReviewExecution,
  createTaskStateProposal,
  createRetainedReviewConsumptionProposal,
  readCanonicalCurrentTask,
  readDraftDefinitionFromBody,
  resolveTestStrategyExecutionContext,
  executionPhaseForCurrentStep,
  currentExecutionDynamicExpansions,
  dynamicReviewRequiredForCurrentExecution,
  controlledRepairContinuationForPendingReview,
  repairWaveIdForRepairSet,
  validateRuntimeEnvironment,
  validateRuntimeReviewTarget,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type CanonicalCurrentTask,
  type ClaimEvidenceRecord,
  type EvidenceExecutionSelection,
  type RuntimeApplyOptions,
  type RuntimeResult,
  type ReviewTarget,
  type StepExecutionResult,
  type StepExecutionResultStatus,
  type StepExpectedFailureEvidence,
  type StepExecutionLogEntry,
  type StepReviewReceipt,
  type TestStrategyExecutionContext,
  type PreflightReconciliationDisposition,
  type PreflightReconciliationAuditLogEntry,
} from './kernel';
import {
  auditCommandMutation,
  evaluateCommandWriteFootprint,
  evaluateMutationScope,
  mutationScopePatternMatchesPath,
  parseMutationScope,
  type MutationTransformationKind,
} from './mutation-scope';
import { TaskStore, type TaskStoreObjectReference } from './task-store';
import {
  MutationAuthorityError,
  normalizeBlastRadiusAssessments,
  evaluateTaskMutationAuthorityPlan,
  mutationAuthorityPlanBlockerCode,
  readProjectMutationAuthority,
  type BlastRadiusAssessment,
} from './mutation-authority';
import { resolveTaskStep, type TaskStepDefinition } from './task-steps';
import { taskContextReferenceForCurrent, type TaskContextReference } from './task-context';
import { contextInput, integer } from './file-context';

export const EXECUTE_STEP_ADAPTER_COMMANDS = [
  'preflight-step',
  'resume-preflight',
  'reconcile-preflight',
  'extend-preflight',
  'apply-artifact-restore',
  'artifact-checkpoints',
  'evidence-context',
  'retry-step',
  'replace-validation',
  'begin-repair',
  'record-step-result',
  'complete-reviewed-step',
] as const;

export type ExecuteStepAdapterCommand = (typeof EXECUTE_STEP_ADAPTER_COMMANDS)[number];
export type ExecuteStepMode = 'default' | 'repair';

type JsonRecord = Record<string, unknown>;
type PlannedCommand = {
  command: string;
  expected_repo_writes: 'none' | string[];
  transformation_kind: MutationTransformationKind;
};
type StepPlan = {
  step: TaskStepDefinition;
  planned_mutation_targets: string[];
  mutation_scope: string[];
  validation: string[];
  commands: PlannedCommand[];
};

export type ExecuteStepPreflightReceipt = {
  kind: 'execute-step-preflight/v1';
  preflight_id?: string;
  execution_id?: string;
  attempt_id?: string;
  task_id: string;
  document_id: string;
  source_revision: string;
  step_id: string;
  plan_revision: string;
  mode: ExecuteStepMode;
  test_strategy_mode: TestStrategyExecutionContext['mode'];
  execution_phase: TestStrategyExecutionContext['phase'];
  candidate_paths: string[];
  repair_fingerprint: string | null;
  change_set_id: string;
  review_base: ReviewTarget;
  mutation_authority_version?: 2;
};

export type ExecuteStepRepairPreflightReceipt = {
  kind: 'execute-step-repair-preflight/v1';
  preflight_id?: string;
  execution_id?: string;
  task_id: string;
  document_id: string;
  source_revision: string;
  step_id: string;
  plan_revision: string;
  mode: 'repair';
  test_strategy_mode: TestStrategyExecutionContext['mode'];
  execution_phase: TestStrategyExecutionContext['phase'];
  candidate_paths: string[];
  repair_fingerprints: string[];
  repair_wave_id: string;
  change_set_id: string;
  review_target_paths: string[];
  review_id: string;
  review_base: ReviewTarget;
  controlled_recovery_grant_id?: string;
};

type AnyExecuteStepPreflightReceipt = ExecuteStepPreflightReceipt | ExecuteStepRepairPreflightReceipt;

export type ExecuteStepPreflightResult = {
  status: 'pass';
  operation_kind: 'execute-step-preflight' | 'execute-step-preflight-extension';
  committed: boolean;
  read_back_verified: true;
  current_step: {
    id: string;
    description: string;
    purpose: string;
    planned_mutation_targets: string[];
    mutation_scope: string[];
    commands: PlannedCommand[];
    validation: string[];
    review_checkpoint: 'required' | 'not-required';
    test_strategy_mode: TestStrategyExecutionContext['mode'];
    execution_phase: TestStrategyExecutionContext['phase'];
    required_outcome: TestStrategyExecutionContext['required_outcome'];
    persistent_tests: string[];
  };
  context_projection: TaskContextReference;
  receipt: ExecuteStepPreflightReceipt;
};

export type ExecuteStepRepairPreflightResult = Omit<ExecuteStepPreflightResult, 'operation_kind' | 'receipt'> & {
  operation_kind: 'execute-step-repair-preflight';
  receipt: ExecuteStepRepairPreflightReceipt;
};

export type ExecuteStepPreflightResumeResult = Omit<ExecuteStepPreflightResult, 'operation_kind' | 'receipt'> & {
  operation_kind: 'execute-step-preflight-resume';
  receipt: AnyExecuteStepPreflightReceipt;
};

export type ExecuteStepPreflightDecisionResult = Omit<ExecuteStepPreflightResult, 'status' | 'operation_kind' | 'receipt'> & {
  status: 'decision-required';
  operation_kind: 'execute-step-preflight-decision';
  blocker: {
    code: 'EXECUTE_PREFLIGHT_RECOVERY_UNAVAILABLE';
    message: string;
  };
  preflight: {
    mode: ExecuteStepMode;
    step_id: string;
    current_preflight_id: string;
    execution_id: string | null;
    attempt_id: string | null;
    candidate_paths: string[] | null;
  };
  available_decisions: Array<{
    execution_disposition: PreflightReconciliationDisposition;
    effect: string;
    command: 'reconcile-preflight';
  }>;
};

export type ExecuteStepEvidenceContext = {
  status: 'pass' | 'partial';
  operation_kind: 'execute-step-evidence-context';
  committed: false;
  task_id: string;
  document_id: string;
  evidence_plan_revision: string;
  evidence_assurance: 'caller-reported';
  checks: Array<{
    claim_id: string;
    slot_id: string;
    check_id: string;
    boundary: string | null;
    user_decision: import('./kernel').UserEvidenceDecision | null;
    frozen_invocation: string;
    validation_items: string[];
    subject_revision: string;
    execution_selection: EvidenceExecutionSelection | null;
    subject_snapshot: {
      kind: string;
      revision: string;
      entry_count: number;
      entries_omitted: true;
    };
  }>;
  returned_check_count: number;
  total_check_count: number;
  unexpanded_check_ids: string[];
  unexpanded_check_count: number;
  unexpanded_check_ids_truncated: boolean;
  complete_for_operation: boolean;
  continuation: { kind: 'execute-step-evidence-page/v1'; source_revision: string; evidence_plan_revision: string; offset: number } | null;
  subject_snapshots_read: 'Use task-context/task-read for the exact frozen subject entries.';
  context_projection: TaskContextReference;
};

export type ExecuteStepAdapterResult = RuntimeResult | ExecuteStepPreflightResult | ExecuteStepRepairPreflightResult | ExecuteStepPreflightResumeResult | ExecuteStepPreflightDecisionResult | ExecuteStepEvidenceContext;

const MAX_ITEMS = 256;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function subjectSnapshotSummary(snapshot: ReturnType<typeof captureReviewTarget>): {
  kind: string;
  revision: string;
  entry_count: number;
  entries_omitted: true;
} {
  return {
    kind: snapshot.kind,
    revision: snapshot.revision,
    entry_count: snapshot.entries.length,
    entries_omitted: true,
  };
}

function fail(code: string, message: string): never {
  throw new VNextRuntimeError(code, message);
}

function record(value: unknown, location: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], location: string): void {
  const allowed = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      'EXECUTE_ADAPTER_INPUT_INVALID',
      `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}].`,
    );
  }
}

function text(value: unknown, location: string, maximumLength = 4096): string {
  if (typeof value !== 'string') fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\r\n]/u.test(normalized)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be one non-empty line of at most ${maximumLength} characters.`);
  }
  return normalized;
}

function verbatimText(value: unknown, location: string, maximumLength = 32768): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /\0/u.test(value)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be a non-empty string of at most ${maximumLength} characters without NUL bytes.`);
  }
  return value;
}

function nullableText(value: unknown, location: string, maximumLength = 4096): string | null {
  return value === null ? null : text(value, location, maximumLength);
}

function textList(value: unknown, location: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || (!allowEmpty && value.length === 0)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be a bounded${allowEmpty ? '' : ' non-empty'} array.`);
  }
  const values = value.map((item, index) => text(item, `${location}[${index}]`));
  if (new Set(values).size !== values.length) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must not contain duplicates.`);
  }
  return values;
}

function normalizePath(value: unknown, location: string, allowGlob: boolean): string {
  const original = text(value, location, 1024);
  const normalized = original.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (
    normalized.startsWith('/')
    || WINDOWS_ABSOLUTE_PATH.test(original)
    || normalized.split('/').includes('..')
    || normalized.includes('\0')
    || (!allowGlob && normalized.includes('*'))
  ) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be a repository-relative ${allowGlob ? 'path or glob' : 'exact path'} without traversal.`);
  }
  return normalized;
}

function pathList(value: unknown, location: string, allowEmpty: boolean, allowGlob = false): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || (!allowEmpty && value.length === 0)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be a bounded${allowEmpty ? '' : ' non-empty'} array.`);
  }
  const values = value.map((item, index) => normalizePath(item, `${location}[${index}]`, allowGlob));
  if (new Set(values).size !== values.length) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must not contain duplicates.`);
  }
  return values;
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function idempotencyKey(prefix: string, value: unknown): string {
  return `${prefix}-${digest(value).slice(0, 48)}`;
}

function authority(current: CanonicalCurrentTask, kinds: AuthorityEvidence['kind'][]): AuthorityEvidence[] {
  return kinds.map(kind => ({
    kind,
    source: current.relativePath,
    subject: current.runtimeState.task_id,
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
  }));
}

function assertExecutableTask(current: CanonicalCurrentTask): void {
  if (current.runtimeState.workflow_status === 'draft' && current.runtimeState.lifecycle_state === 'active') {
    fail('DRAFT_NOT_EXECUTABLE', 'execute-step requires an explicitly confirmed task; the current task is draft + active.');
  }
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('TASK_STATE_NOT_ACTIVE', 'execute-step requires active + active.');
  }
  if (current.runtimeState.resume_requires_review) {
    fail('RESUME_REVIEW_REQUIRED', 'execute-step is blocked by the current resume-review gate.');
  }
}

function parseScopeList(value: string | null, location: string): string[] {
  if (!value) fail('TASK_STEP_METADATA_INCOMPLETE', `${location} is missing.`);
  const items = value.split(',').map(item => item.replace(/`/gu, '').trim()).filter(Boolean);
  if (items.length === 0 || new Set(items).size !== items.length) {
    fail('TASK_STEP_METADATA_INCOMPLETE', `${location} must be a non-empty list without duplicates.`);
  }
  return items.map((item, index) => normalizePath(item, `${location}[${index}]`, true));
}

function parseValidationList(value: string | null, location: string): string[] {
  if (!value) fail('TASK_STEP_METADATA_INCOMPLETE', `${location} is missing.`);
  const items = value.split(/;\s+/u).map(item => item.trim()).filter(Boolean);
  if (items.length === 0 || new Set(items).size !== items.length) {
    fail('TASK_STEP_METADATA_INCOMPLETE', `${location} must be a non-empty list without duplicates.`);
  }
  return items;
}

function parsePlannedCommands(current: CanonicalCurrentTask, stepId: string): PlannedCommand[] {
  const definition = readDraftDefinitionFromBody(current.body);
  const lines = definition.implementation_steps.replace(/\r\n?/gu, '\n').split('\n');
  const commands: PlannedCommand[] = [];
  let inCurrentStep = false;
  for (let index = 0; index < lines.length; index += 1) {
    const step = /^-\s+([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\s*[:：]/u.exec(lines[index]);
    if (step) {
      inCurrentStep = step[1] === stepId;
      continue;
    }
    if (!inCurrentStep) continue;
    const planned = /^\s{2,}-\s+planned_command:\s*(.+?)\s*$/u.exec(lines[index]);
    if (!planned) continue;
    const expected = /^\s{4,}-\s+expected_repo_writes:\s*(.+?)\s*$/u.exec(lines[index + 1] ?? '');
    const transformation = /^\s{4,}-\s+transformation_kind:\s*(localized|inherently-broad)\s*$/u.exec(lines[index + 2] ?? '');
    if (!expected || !transformation) {
      fail('TASK_STEP_COMMAND_PLAN_INVALID', `planned command "${planned[1].trim()}" is missing canonical write-footprint metadata.`);
    }
    const rawTargets = expected[1].trim();
    const expectedWrites = rawTargets === 'none'
      ? 'none' as const
      : rawTargets.split(',').map((item, targetIndex) => normalizePath(item.trim(), `planned_command.expected_repo_writes[${targetIndex}]`, true));
    if (expectedWrites !== 'none' && expectedWrites.length === 0) {
      fail('TASK_STEP_COMMAND_PLAN_INVALID', `planned command "${planned[1].trim()}" has an empty write footprint.`);
    }
    commands.push({
      command: planned[1].trim(),
      expected_repo_writes: expectedWrites,
      transformation_kind: transformation[1] as MutationTransformationKind,
    });
    index += 2;
  }
  if (new Set(commands.map(item => item.command)).size !== commands.length) {
    fail('TASK_STEP_COMMAND_PLAN_INVALID', `step ${stepId} contains duplicate planned commands.`);
  }
  return commands;
}

function currentStepPlan(current: CanonicalCurrentTask): StepPlan {
  const resolution = resolveTaskStep(current.body, current.runtimeState.active_step_id);
  if (!resolution.current.metadata_complete || !resolution.current.purpose || !resolution.current.review_checkpoint) {
    fail('TASK_STEP_METADATA_INCOMPLETE', `step ${resolution.current.id} is not executable because its canonical metadata is incomplete.`);
  }
  return {
    step: resolution.current,
    planned_mutation_targets: parseScopeList(resolution.current.planned_mutation_targets ?? resolution.current.mutation_scope, `step ${resolution.current.id} planned_mutation_targets`),
    mutation_scope: parseScopeList(resolution.current.mutation_scope, `step ${resolution.current.id} mutation_scope`),
    validation: parseValidationList(resolution.current.required_evidence, `step ${resolution.current.id} required_evidence`),
    commands: parsePlannedCommands(current, resolution.current.id),
  };
}

function stepAdmitsExactPath(file: string, stepScope: readonly string[]): boolean {
  return stepScope.some(pattern => mutationScopePatternMatchesPath(file, pattern));
}

function stepAdmitsFootprintTarget(target: string, stepScope: readonly string[]): boolean {
  return target.includes('*') ? stepScope.includes(target) : stepAdmitsExactPath(target, stepScope);
}

function authorityAssessments(current: CanonicalCurrentTask): BlastRadiusAssessment[] {
  return currentExecutionDynamicExpansions(current).map(item => item.assessment);
}

function assertPathsAdmitted(
  current: CanonicalCurrentTask,
  stepPlan: StepPlan,
  paths: readonly string[],
  location: string,
  root: string,
  assessments: readonly BlastRadiusAssessment[] = [],
  mode: 'default' | 'repair' = 'default',
  phase?: TestStrategyExecutionContext['phase'],
  plannedTargets: readonly string[] = stepPlan.planned_mutation_targets,
): void {
  if (paths.length === 0) return;
  assertExecutionTargetAdmissions(root, current, {
    target_paths: paths,
    planned_targets: plannedTargets,
    step_mutation_scope: stepPlan.mutation_scope,
    assessments,
    mode,
    phase,
    location,
  });
}

function assertCommandPlansAdmitted(
  root: string,
  current: CanonicalCurrentTask,
  stepPlan: StepPlan,
  assessments: readonly BlastRadiusAssessment[] = [],
  phase?: TestStrategyExecutionContext['phase'],
  mode: 'default' | 'repair' = 'default',
): void {
  if (current.mutationAuthority) {
    const project = (() => {
      try { return readProjectMutationAuthority(root); }
      catch (error) { fail(error instanceof MutationAuthorityError ? error.code : 'MUTATION_AUTHORITY_PROJECT_INVALID', error instanceof Error ? error.message : String(error)); }
    })();
    if (!project) fail('MUTATION_AUTHORITY_PROJECT_REQUIRED', 'v2 command footprints require PROJECT_PROFILE.yaml.mutation_authority.domains.');
    const commandWrites = stepPlan.commands.flatMap(command => command.expected_repo_writes === 'none' ? [] : command.expected_repo_writes);
    const evaluation = evaluateTaskMutationAuthorityPlan({
      project,
      task: current.mutationAuthority,
      planned_targets: [],
      command_write_targets: commandWrites,
      persistent_test_paths: [],
    });
    const blocked = evaluation.decisions.find(item => !item.admitted);
    if (blocked) {
      const command = stepPlan.commands.find(item => item.expected_repo_writes !== 'none' && item.expected_repo_writes.includes(blocked.path));
      fail(mutationAuthorityPlanBlockerCode(blocked), `planned command${command ? ` "${command.command}"` : ''} is outside the v2 authority envelope: ${evaluation.blockers.join(' ')}`);
    }
    return;
  }
  const scope = parseMutationScope(current.body, current.sourceTuple.revision);
  for (const command of stepPlan.commands) {
    if (command.expected_repo_writes === 'none') continue;
    const outsideStep = command.expected_repo_writes.filter(target => !stepAdmitsFootprintTarget(target, stepPlan.mutation_scope));
    if (outsideStep.length > 0) {
      fail('COMMAND_FOOTPRINT_BLOCKED', `planned command "${command.command}" writes outside current step scope: ${outsideStep.join(', ')}.`);
    }
    const result = evaluateCommandWriteFootprint(scope, {
      command: command.command,
      expected_write_footprint: {
        kind: 'bounded',
        targets: command.expected_repo_writes,
        evidence_refs: [`adapter:execute-preflight:${stepPlan.step.id}`],
      },
      transformation_kind: command.transformation_kind,
    });
    if (result.status !== 'pass') {
      fail('COMMAND_FOOTPRINT_BLOCKED', `planned command "${command.command}" is not executable: ${result.blockers.join(' ')}`);
    }
  }
}

function assertExactCommandWritesCovered(stepPlan: StepPlan, candidatePaths: readonly string[]): void {
  const missing = stepPlan.commands.flatMap(command => command.expected_repo_writes === 'none'
    ? []
    : command.expected_repo_writes.filter(target => !target.includes('*') && !candidatePaths.includes(target)));
  if (missing.length > 0) {
    fail('COMMAND_FOOTPRINT_BLOCKED', `candidate_paths must include every exact planned command write: ${[...new Set(missing)].join(', ')}.`);
  }
}

function stepPlanRevision(stepPlan: StepPlan): string {
  return digest({
    step: stepPlan.step,
    planned_mutation_targets: stepPlan.planned_mutation_targets,
    mutation_scope: stepPlan.mutation_scope,
    validation: stepPlan.validation,
    commands: stepPlan.commands,
  });
}

function ordinaryPreflightPlanRevision(current: CanonicalCurrentTask): string {
  return digest({
    step_id: current.runtimeState.active_step_id,
    evidence_plan_revision: current.runtimeState.evidence_plan_revision,
  });
}

function changeSetId(current: CanonicalCurrentTask, stepId: string): string {
  if (current.runtimeState.review_coverage) return current.runtimeState.review_coverage.change_set_id;
  return `change-set-${digest({
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    step_id: stepId,
    review_cycle_id: current.runtimeState.review_cycle.id,
  }).slice(0, 40)}`;
}

function testStrategyMode(value: unknown, location: string): TestStrategyExecutionContext['mode'] {
  if (!['flexible', 'test-first', 'implementation-first', 'not-applicable', 'legacy'].includes(String(value))) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} is not a supported test-strategy mode.`);
  }
  return value as TestStrategyExecutionContext['mode'];
}

function executionPhase(value: unknown, location: string): TestStrategyExecutionContext['phase'] {
  if (!['flexible', 'test-first', 'red', 'green', 'implementation-first', 'not-applicable', 'legacy'].includes(String(value))) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} is not a supported execution phase.`);
  }
  return value as TestStrategyExecutionContext['phase'];
}

function normalizePreflightReceipt(value: unknown): AnyExecuteStepPreflightReceipt {
  const source = record(value, 'preflight_receipt');
  if (source.kind === 'execute-step-repair-preflight/v1') {
    exactKeys(source, [
      'kind',
      ...(source.preflight_id === undefined ? [] : ['preflight_id']),
      ...(source.execution_id === undefined ? [] : ['execution_id']),
      'task_id',
      'document_id',
      'source_revision',
      'step_id',
      'plan_revision',
      'mode',
      'test_strategy_mode',
      'execution_phase',
      'candidate_paths',
      'repair_fingerprints',
      'repair_wave_id',
      'change_set_id',
      'review_target_paths',
      'review_id',
      'review_base',
      ...(source.controlled_recovery_grant_id === undefined ? [] : ['controlled_recovery_grant_id']),
    ], 'preflight_receipt');
    if (source.mode !== 'repair') fail('EXECUTE_ADAPTER_INPUT_INVALID', 'repair preflight receipt mode must be repair.');
    const sourceRevision = text(source.source_revision, 'preflight_receipt.source_revision', 64);
    const planRevision = text(source.plan_revision, 'preflight_receipt.plan_revision', 64);
    if (!SHA256_PATTERN.test(sourceRevision) || !SHA256_PATTERN.test(planRevision)) fail('EXECUTE_ADAPTER_INPUT_INVALID', 'preflight receipt revisions must be SHA-256 values.');
    return {
      kind: 'execute-step-repair-preflight/v1',
      ...(source.preflight_id === undefined ? {} : { preflight_id: text(source.preflight_id, 'preflight_receipt.preflight_id', 128) }),
      ...(source.execution_id === undefined ? {} : { execution_id: text(source.execution_id, 'preflight_receipt.execution_id', 128) }),
      task_id: text(source.task_id, 'preflight_receipt.task_id', 128),
      document_id: text(source.document_id, 'preflight_receipt.document_id', 128),
      source_revision: sourceRevision,
      step_id: text(source.step_id, 'preflight_receipt.step_id', 128),
      plan_revision: planRevision,
      mode: 'repair',
      test_strategy_mode: testStrategyMode(source.test_strategy_mode, 'preflight_receipt.test_strategy_mode'),
      execution_phase: executionPhase(source.execution_phase, 'preflight_receipt.execution_phase'),
      candidate_paths: pathList(source.candidate_paths, 'preflight_receipt.candidate_paths', true),
      repair_fingerprints: textList(source.repair_fingerprints, 'preflight_receipt.repair_fingerprints', false),
      repair_wave_id: text(source.repair_wave_id, 'preflight_receipt.repair_wave_id', 128),
      change_set_id: text(source.change_set_id, 'preflight_receipt.change_set_id', 128),
      review_target_paths: pathList(source.review_target_paths, 'preflight_receipt.review_target_paths', true),
      review_id: text(source.review_id, 'preflight_receipt.review_id', 128),
      review_base: validateRuntimeReviewTarget(source.review_base, 'preflight_receipt.review_base'),
      ...(source.controlled_recovery_grant_id === undefined ? {} : { controlled_recovery_grant_id: text(source.controlled_recovery_grant_id, 'preflight_receipt.controlled_recovery_grant_id', 128) }),
    };
  }
  exactKeys(source, [
    'kind',
    ...(source.preflight_id === undefined ? [] : ['preflight_id']),
    ...(source.execution_id === undefined ? [] : ['execution_id']),
    'task_id',
    'document_id',
    'source_revision',
    'step_id',
    'plan_revision',
    'mode',
    'test_strategy_mode',
    'execution_phase',
    'candidate_paths',
    'repair_fingerprint',
    'change_set_id',
    'review_base',
    ...(source.attempt_id === undefined ? [] : ['attempt_id']),
    ...(source.mutation_authority_version === undefined ? [] : ['mutation_authority_version']),
  ], 'preflight_receipt');
  if (source.kind !== 'execute-step-preflight/v1') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'preflight_receipt.kind must be execute-step-preflight/v1.');
  }
  const mode = source.mode;
  if (mode !== 'default') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'execute-step-preflight/v1 is default-only; use begin-repair for repair mode.');
  }
  const sourceRevision = text(source.source_revision, 'preflight_receipt.source_revision', 64);
  const planRevision = text(source.plan_revision, 'preflight_receipt.plan_revision', 64);
  if (!SHA256_PATTERN.test(sourceRevision) || !SHA256_PATTERN.test(planRevision)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'preflight receipt revisions must be SHA-256 values.');
  }
  return {
    kind: source.kind,
    ...(source.preflight_id === undefined ? {} : { preflight_id: text(source.preflight_id, 'preflight_receipt.preflight_id', 128) }),
    ...(source.execution_id === undefined ? {} : { execution_id: text(source.execution_id, 'preflight_receipt.execution_id', 128) }),
    ...(source.attempt_id === undefined ? {} : { attempt_id: text(source.attempt_id, 'preflight_receipt.attempt_id', 128) }),
    task_id: text(source.task_id, 'preflight_receipt.task_id', 128),
    document_id: text(source.document_id, 'preflight_receipt.document_id', 128),
    source_revision: sourceRevision,
    step_id: text(source.step_id, 'preflight_receipt.step_id', 128),
    plan_revision: planRevision,
    mode,
    test_strategy_mode: testStrategyMode(source.test_strategy_mode, 'preflight_receipt.test_strategy_mode'),
    execution_phase: executionPhase(source.execution_phase, 'preflight_receipt.execution_phase'),
    candidate_paths: pathList(source.candidate_paths, 'preflight_receipt.candidate_paths', true),
    repair_fingerprint: nullableText(source.repair_fingerprint, 'preflight_receipt.repair_fingerprint', 128),
    change_set_id: text(source.change_set_id, 'preflight_receipt.change_set_id', 128),
    review_base: validateRuntimeReviewTarget(source.review_base, 'preflight_receipt.review_base'),
    ...(source.mutation_authority_version === undefined ? {} : source.mutation_authority_version === 2 ? { mutation_authority_version: 2 as const } : fail('EXECUTE_ADAPTER_INPUT_INVALID', 'preflight_receipt.mutation_authority_version must be 2.')),
  };
}

function assertCurrentReceipt(root: string, current: CanonicalCurrentTask, stepPlan: StepPlan, receipt: AnyExecuteStepPreflightReceipt): void {
  if (receipt.task_id !== current.runtimeState.task_id || receipt.document_id !== current.sourceTuple.document_id) {
    fail('EXECUTE_PREFLIGHT_IDENTITY_CONFLICT', 'preflight receipt does not identify the current task document.');
  }
  if (!taskSourceRevisionMatches(root, current, receipt.source_revision)) {
    const expectedRepairBookkeeping = receipt.kind === 'execute-step-repair-preflight/v1'
      && current.runtimeState.pending_review_result?.review_id === receipt.review_id
      && receipt.repair_fingerprints.every(fingerprint => {
        const finding = current.runtimeState.findings.find(item => item.fingerprint === fingerprint);
        return finding?.last_repair_wave_id === receipt.repair_wave_id && finding.status === 'in-progress';
      });
    if (!expectedRepairBookkeeping) {
      fail('EXECUTE_PREFLIGHT_STALE', 'CURRENT_TASK changed after preflight; run preflight-step again before editing or committing.');
    }
  }
  const activePreflight = current.runtimeState.execution_preflight;
  const expectedPlanRevision = activePreflight?.step_id === receipt.step_id
    ? activePreflight.plan_revision
    : receipt.execution_id === undefined
      ? stepPlanRevision(stepPlan)
      : ordinaryPreflightPlanRevision(current);
  if (receipt.step_id !== current.runtimeState.active_step_id || receipt.plan_revision !== expectedPlanRevision) {
    fail('EXECUTE_PREFLIGHT_STALE', 'the active step or its executable plan changed after preflight.');
  }
  const strategy = resolveTestStrategyExecutionContext(current);
  const expectedPhase = activePreflight?.step_id === receipt.step_id
    ? activePreflight.execution_phase
    : executionPhaseForCurrentStep(current, strategy);
  if (receipt.test_strategy_mode !== strategy.mode || receipt.execution_phase !== expectedPhase) {
    fail('EXECUTE_PREFLIGHT_STALE', 'the frozen test strategy or current execution phase changed after preflight.');
  }
  if (activePreflight?.step_id === receipt.step_id) {
    if (activePreflight.mode !== receipt.mode
      || activePreflight.plan_revision !== receipt.plan_revision
      || ((current.mutationAuthority || receipt.mode === 'repair') && receipt.execution_id !== activePreflight.execution_id)
      || (receipt.execution_id !== undefined && activePreflight.execution_id !== receipt.execution_id)
      || (digest(activePreflight.candidate_paths) !== digest(receipt.candidate_paths))
      || (receipt.preflight_id !== undefined && activePreflight.preflight_id !== receipt.preflight_id)) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the preflight receipt does not bind the current Runtime execution identity.');
    }
    if (receipt.mode === 'repair'
      && activePreflight.review_target_paths !== null
      && digest(activePreflight.review_target_paths) !== digest(receipt.review_target_paths)) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the repair receipt does not bind the Runtime-recorded reviewed target paths.');
    }
    if (receipt.mode === 'repair'
      && (activePreflight.review_id !== receipt.review_id
        || activePreflight.repair_wave_id !== receipt.repair_wave_id
        || activePreflight.change_set_id !== receipt.change_set_id)) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the repair receipt does not bind the current Runtime repair identity.');
    }
    if (receipt.mode === 'repair' && activePreflight.controlled_recovery_grant_id !== receipt.controlled_recovery_grant_id) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the repair receipt does not bind the current controlled recovery grant identity.');
    }
  }
  if (receipt.kind === 'execute-step-repair-preflight/v1') {
    if (current.runtimeState.pending_review_result?.review_id !== receipt.review_id
      || current.runtimeState.pending_review_result.change_set_id !== receipt.change_set_id) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the repair review or Runtime-owned change set changed after preflight.');
    }
  } else {
    const latestAttempt = current.runtimeState.step_attempts?.[receipt.step_id]?.attempts.at(-1);
    const activePreflightForStep = current.runtimeState.execution_preflight?.step_id === receipt.step_id
      ? current.runtimeState.execution_preflight
      : undefined;
    const receiptBindsAttempt = activePreflightForStep
      ? activePreflightForStep.preflight_id === receipt.preflight_id
      : latestAttempt?.idempotency_key === receipt.preflight_id;
    // The transaction kernel still enforces whether this attempt may accept a
    // result.  The adapter only verifies the exact execution identity here:
    // an in-progress execution may legitimately submit another evidence-bound
    // result while its same preflight marker is retained, and a host call may
    // resume that same identity without spending another attempt.
    if (!receipt.preflight_id || !latestAttempt || !receiptBindsAttempt) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the ordinary preflight receipt is no longer the latest durable execution identity; use resume-preflight before an unrecorded execution or obtain a fresh admitted attempt.');
    }
    if (receipt.change_set_id !== changeSetId(current, receipt.step_id)) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the Runtime-owned change set identity changed after preflight.');
    }
  }
}

function findingAdmissionWaveId(reviewId: string): string {
  return `finding-wave-${digest(reviewId).slice(0, 32)}`;
}

function currentStepResult(stepPlan: StepPlan, strategy: TestStrategyExecutionContext): ExecuteStepPreflightResult['current_step'] {
  return {
    id: stepPlan.step.id,
    description: stepPlan.step.description,
    purpose: stepPlan.step.purpose!,
    planned_mutation_targets: stepPlan.planned_mutation_targets,
    mutation_scope: stepPlan.mutation_scope,
    commands: stepPlan.commands,
    validation: stepPlan.validation,
    review_checkpoint: stepPlan.step.review_checkpoint!,
    test_strategy_mode: strategy.mode,
    execution_phase: strategy.phase,
    required_outcome: strategy.required_outcome,
    persistent_tests: [...strategy.persistent_tests],
  };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactReviewBaseForCandidates(current: CanonicalCurrentTask, candidatePaths: readonly string[]): ReviewTarget {
  const coverageTarget = current.runtimeState.review_coverage?.target;
  if (!coverageTarget) {
    fail('EXECUTE_PREFLIGHT_RECOVERY_UNAVAILABLE', 'the durable preflight has no registered review baseline; obtain a fresh preflight before execution.');
  }
  const entries = candidatePaths.map(candidate => coverageTarget.entries.find(entry => entry.path === candidate));
  if (entries.some(entry => entry === undefined)) {
    fail('EXECUTE_PREFLIGHT_RECOVERY_UNAVAILABLE', 'the durable preflight baseline does not cover every admitted candidate path.');
  }
  return createReviewTargetManifest(entries as ReviewTarget['entries']);
}

function historicalOrdinaryPreflightCandidates(
  root: string,
  current: CanonicalCurrentTask,
  preflightId: string,
  stepId: string,
): string[] | null {
  const store = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent);
  const match = store.lookupIdempotency(preflightId);
  if (!match || match.event.resulting_source_revision !== current.sourceTuple.revision) return null;

  const reference = match.event.object_refs.proposal;
  let proposal: unknown = null;
  if (isJsonRecord(reference) && reference.object_type === 'proposal' && typeof reference.sha256 === 'string') {
    proposal = store.readTransactionPayload(reference as unknown as TaskStoreObjectReference, 'proposal');
  } else if (isJsonRecord(match.event.transaction?.proposal)) {
    const inline = match.event.transaction!.proposal;
    if (isJsonRecord(inline) && inline.object_type === 'proposal' && typeof inline.sha256 === 'string') {
      proposal = store.readTransactionPayload(inline as unknown as TaskStoreObjectReference, 'proposal');
    } else {
      proposal = inline;
    }
  }
  if (!isJsonRecord(proposal)
    || proposal.idempotency_key !== preflightId
    || proposal.caller !== 'execute-step'
    || proposal.operation_kind !== 'task-state-transaction'
    || !isJsonRecord(proposal.semantic_delta)
    || proposal.semantic_delta.action !== 'record-step-preflight'
    || proposal.semantic_delta.step_id !== stepId
    || (proposal.semantic_delta.mode !== undefined && proposal.semantic_delta.mode !== 'default')
    || !Array.isArray(proposal.semantic_delta.candidate_paths)) {
    return null;
  }
  return pathList(proposal.semantic_delta.candidate_paths, 'durable preflight candidate_paths', true);
}

function preflightResumeResult(
  root: string,
  current: CanonicalCurrentTask,
  stepPlan: StepPlan,
  strategy: TestStrategyExecutionContext,
  receipt: AnyExecuteStepPreflightReceipt,
): ExecuteStepPreflightResumeResult {
  const activeStrategy = { ...strategy, phase: receipt.execution_phase };
  return {
    status: 'pass',
    operation_kind: 'execute-step-preflight-resume',
    committed: false,
    read_back_verified: true,
    current_step: currentStepResult(stepPlan, activeStrategy),
    context_projection: taskContextReferenceForCurrent(root, current, 'preflight-step', receipt.mode),
    receipt,
  };
}

function preflightDecisionResult(
  root: string,
  current: CanonicalCurrentTask,
  stepPlan: StepPlan,
  strategy: TestStrategyExecutionContext,
  mode: ExecuteStepMode,
  currentPreflightId: string,
  message: string,
  active: CanonicalCurrentTask['runtimeState']['execution_preflight'],
  attemptId: string | null,
): ExecuteStepPreflightDecisionResult {
  const activeStrategy = active?.mode === mode ? { ...strategy, phase: active.execution_phase } : strategy;
  return {
    status: 'decision-required',
    operation_kind: 'execute-step-preflight-decision',
    committed: false,
    read_back_verified: true,
    current_step: currentStepResult(stepPlan, activeStrategy),
    context_projection: taskContextReferenceForCurrent(root, current, 'preflight-step', mode),
    blocker: {
      code: 'EXECUTE_PREFLIGHT_RECOVERY_UNAVAILABLE',
      message,
    },
    preflight: {
      mode,
      step_id: stepPlan.step.id,
      current_preflight_id: currentPreflightId,
      execution_id: active?.mode === mode ? active.execution_id : null,
      attempt_id: attemptId,
      candidate_paths: active?.mode === mode ? [...active.candidate_paths] : null,
    },
    available_decisions: [
      {
        execution_disposition: 'not-started',
        effect: '清除悬挂准入并复用同一个逻辑尝试；不增加尝试次数。',
        command: 'reconcile-preflight',
      },
      {
        execution_disposition: 'started-unknown',
        effect: '记录可能已启动且结果未知，再复用同一个逻辑尝试；不伪造结果或增加预算。',
        command: 'reconcile-preflight',
      },
    ],
  };
}

/**
 * Rehydrate the exact latest preflight after a host/session interruption.
 *
 * This is deliberately read-only.  It neither creates an attempt nor changes
 * a retry/finding budget.  The canonical execution identity is sufficient for
 * new Runtime records; a compact store also lets upgraded Runtime versions
 * recover a v1 preflight proposal committed before execution_preflight became
 * durable.  No token, time or tool-count quota is represented here.
 */
export function resumePreflight(root: string, input: unknown): ExecuteStepPreflightResumeResult | ExecuteStepPreflightDecisionResult {
  const source = record(input, 'resume-preflight input');
  exactKeys(source, [], 'resume-preflight input');
  const current = readCanonicalCurrentTask(root);
  assertExecutableTask(current);
  const stepPlan = currentStepPlan(current);
  const strategy = resolveTestStrategyExecutionContext(current);
  assertTestStrategySequenceReady(current, strategy);
  const active = current.runtimeState.execution_preflight;

  if (active?.mode === 'repair') {
    const outstanding = outstandingRepairPreflight(current);
    if (!outstanding) fail('EXECUTE_PREFLIGHT_NOT_OUTSTANDING', 'the current repair preflight already has a recorded result or is no longer current.');
    const receipt = recoverOutstandingRepairReceipt(current, stepPlan, strategy, active.candidate_paths);
    if (!receipt) {
      return preflightDecisionResult(
        root,
        current,
        stepPlan,
        strategy,
        'repair',
        active.preflight_id,
        'the retained repair preflight has no exact Runtime review baseline; choose the caller-reported execution disposition and run reconcile-preflight.',
        active,
        null,
      );
    }
    return preflightResumeResult(root, current, stepPlan, strategy, receipt);
  }

  assertOrdinaryPreflight(current, root);
  const ledger = current.runtimeState.step_attempts?.[current.runtimeState.active_step_id];
  const latestAttempt = ledger?.attempts.at(-1);
  if (!latestAttempt || latestAttempt.status !== 'preflighted') {
    fail('EXECUTE_PREFLIGHT_NOT_OUTSTANDING', 'there is no current preflighted attempt to resume.');
  }

  if (active?.mode === 'default') {
    if (active.step_id !== stepPlan.step.id) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the durable preflight does not bind the latest active ordinary attempt.');
    }
    const receipt: ExecuteStepPreflightReceipt = {
      kind: 'execute-step-preflight/v1',
      preflight_id: active.preflight_id,
      execution_id: active.execution_id,
      attempt_id: latestAttempt.attempt_id,
      task_id: current.runtimeState.task_id,
      document_id: current.sourceTuple.document_id,
      source_revision: current.sourceTuple.revision,
      step_id: stepPlan.step.id,
      plan_revision: active.plan_revision,
      mode: 'default',
      test_strategy_mode: strategy.mode,
      execution_phase: active.execution_phase,
      candidate_paths: [...active.candidate_paths],
      repair_fingerprint: null,
      change_set_id: active.change_set_id,
      review_base: exactReviewBaseForCandidates(current, active.candidate_paths),
      ...(current.mutationAuthority ? { mutation_authority_version: 2 as const } : {}),
    };
    return preflightResumeResult(root, current, stepPlan, strategy, receipt);
  }

  // 0.20.5–0.20.14 v1 tasks may have committed the preflight proposal and
  // attempt ledger before execution_preflight was persisted.  Recover only
  // from that exact committed proposal; never infer candidate paths from
  // prose, Git diff or a caller-provided replacement.
  const candidatePaths = historicalOrdinaryPreflightCandidates(root, current, latestAttempt.idempotency_key, stepPlan.step.id);
  if (!candidatePaths) {
    return preflightDecisionResult(
      root,
      current,
      stepPlan,
      strategy,
      'default',
      latestAttempt.idempotency_key,
      'the older preflight has no exact committed proposal; Runtime will not invent a receipt. Choose whether the execution was not started or started with an unknown result, then run reconcile-preflight.',
      active,
      latestAttempt.attempt_id,
    );
  }
  const receipt: ExecuteStepPreflightReceipt = {
    kind: 'execute-step-preflight/v1',
    preflight_id: latestAttempt.idempotency_key,
    attempt_id: latestAttempt.attempt_id,
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: stepPlan.step.id,
    plan_revision: stepPlanRevision(stepPlan),
    mode: 'default',
    test_strategy_mode: strategy.mode,
    execution_phase: strategy.phase,
    candidate_paths: candidatePaths,
    repair_fingerprint: null,
    change_set_id: changeSetId(current, stepPlan.step.id),
    review_base: exactReviewBaseForCandidates(current, candidatePaths),
    ...(current.mutationAuthority ? { mutation_authority_version: 2 as const } : {}),
  };
  return preflightResumeResult(root, current, stepPlan, strategy, receipt);
}

export function reconcilePreflight(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'reconcile-preflight input');
  exactKeys(source, [
    'step_id', 'current_preflight_id', 'mode', 'execution_disposition', 'decision_source', 'decision_text', 'idempotency_key',
    ...(source.evidence_refs === undefined ? [] : ['evidence_refs']),
  ], 'reconcile-preflight input');
  const current = readCanonicalCurrentTask(root);
  const mode = text(source.mode, 'mode', 32) as ExecuteStepMode;
  if (mode !== 'default' && mode !== 'repair') fail('EXECUTE_ADAPTER_INPUT_INVALID', 'mode must be default or repair.');
  const executionDisposition = text(source.execution_disposition, 'execution_disposition', 32) as PreflightReconciliationDisposition;
  if (executionDisposition !== 'not-started' && executionDisposition !== 'started-unknown') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'execution_disposition must be not-started or started-unknown.');
  }
  const evidenceRefs = source.evidence_refs === undefined ? [] : textList(source.evidence_refs, 'evidence_refs', true);
  const normalized = {
    step_id: text(source.step_id, 'step_id', 128),
    current_preflight_id: text(source.current_preflight_id, 'current_preflight_id', 128),
    mode,
    execution_disposition: executionDisposition,
    decision_source: text(source.decision_source, 'decision_source', 1024),
    decision_text: verbatimText(source.decision_text, 'decision_text'),
    evidence_refs: [...new Set([current.relativePath, ...evidenceRefs])],
    idempotency_key: text(source.idempotency_key, 'idempotency_key', 128),
  };
  const prior = current.runtimeState.execution_log.find((item): item is PreflightReconciliationAuditLogEntry =>
    'action' in item && item.action === 'reconcile-preflight' && item.idempotency_key === normalized.idempotency_key,
  );
  const replayMatches = prior !== undefined
    && prior.step_id === normalized.step_id
    && prior.current_preflight_id === normalized.current_preflight_id
    && prior.mode === normalized.mode
    && prior.execution_disposition === normalized.execution_disposition
    && prior.decision_source === normalized.decision_source
    && prior.decision_text === normalized.decision_text
    && prior.evidence_refs.join('|') === normalized.evidence_refs.join('|');
  const proposal = createPreflightReconciliationProposal(current, {
    ...normalized,
    ...(replayMatches && prior ? {
      source_tuple: prior.source_tuple,
      authority_evidence: prior.authority_evidence,
    } : {}),
  });
  return verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

function recoverOutstandingRepairReceipt(
  current: CanonicalCurrentTask,
  stepPlan: StepPlan,
  strategy: TestStrategyExecutionContext,
  candidatePaths: string[],
): ExecuteStepRepairPreflightReceipt | null {
  const active = outstandingRepairPreflight(current);
  if (!active) return null;
  if (digest(active.candidate_paths) !== digest(candidatePaths)) {
    fail('EXECUTE_PREFLIGHT_SCOPE_CONFLICT', 'the outstanding repair preflight owns a different candidate path set; reuse its exact paths.');
  }
  const pending = current.runtimeState.pending_review_result;
  const reviewTargetPaths = active.review_target_paths;
  const coverageTarget = current.runtimeState.review_coverage?.target;
  const expectedBasePaths = [...new Set([...(reviewTargetPaths ?? []), ...active.candidate_paths])].sort();
  if (!pending || !reviewTargetPaths || !coverageTarget
    || digest(coverageTarget.entries.map(item => item.path).sort()) !== digest(expectedBasePaths)) {
    return null;
  }
  const receipt: ExecuteStepRepairPreflightReceipt = {
    kind: 'execute-step-repair-preflight/v1',
    preflight_id: active.preflight_id,
    execution_id: active.execution_id,
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: stepPlan.step.id,
    plan_revision: active.plan_revision,
    mode: 'repair',
    test_strategy_mode: strategy.mode,
    execution_phase: active.execution_phase,
    candidate_paths: [...active.candidate_paths],
    repair_fingerprints: [...(active.repair_fingerprints ?? [])],
    repair_wave_id: active.repair_wave_id!,
    change_set_id: active.change_set_id,
    review_target_paths: [...reviewTargetPaths],
    review_id: active.review_id!,
    ...(active.controlled_recovery_grant_id === undefined ? {} : { controlled_recovery_grant_id: active.controlled_recovery_grant_id }),
    review_base: coverageTarget,
  };
  return receipt;
}

export function beginRepair(
  root: string,
  input: unknown,
  options: RuntimeApplyOptions = {},
): ExecuteStepRepairPreflightResult {
  const source = record(input, 'begin-repair input');
  exactKeys(source, ['candidate_paths', ...(source.blast_radius_assessments === undefined ? [] : ['blast_radius_assessments'])], 'begin-repair input');
  const candidatePaths = pathList(source.candidate_paths, 'candidate_paths', false);
  let assessments: BlastRadiusAssessment[] = [];
  if (source.blast_radius_assessments !== undefined) {
    try { assessments = normalizeBlastRadiusAssessments(source.blast_radius_assessments); }
    catch (error) { fail(error instanceof MutationAuthorityError ? error.code : 'MUTATION_AUTHORITY_ASSESSMENT_INVALID', error instanceof Error ? error.message : String(error)); }
  }
  let current = readCanonicalCurrentTask(root);
  assertExecutableTask(current);
  const pending = current.runtimeState.pending_review_result;
  const budgetContinuation = repairBudgetContinuationForPendingReview(current);
  const controlledContinuation = controlledRepairContinuationForPendingReview(current);
  const outstandingPreflight = outstandingRepairPreflight(current);
  if (!pending || (pending.verdict !== 'findings' && budgetContinuation === null && controlledContinuation === null && outstandingPreflight === null)) {
    fail('REVIEW_FINDINGS_REQUIRED', 'begin-repair requires findings or an explicitly authorized continuation of the exact budget-blocked review.');
  }
  const reviewedExecution = current.runtimeState.execution_log.map(item => 'action' in item
    ? item
    : current.runtimeState.scope_amendment_pending_review_step_id !== undefined && item.idempotency_key === pending.execution_id
      ? item
      : cumulativeReviewExecution(current, item)).find((item): item is StepExecutionLogEntry =>
    !('action' in item) && item.idempotency_key === pending.execution_id,
  );
  if (!reviewedExecution?.execution_result
    || reviewedExecution.execution_result.change_set_id !== pending.change_set_id
    || reviewedExecution.execution_result.review_target.revision !== pending.review_target_revision) {
    fail('REVIEW_TARGET_CONFLICT', 'begin-repair requires the Runtime-recorded reviewed execution target.');
  }
  const stepPlan = currentStepPlan(current);
  const strategy = resolveTestStrategyExecutionContext(current);
  assertTestStrategySequenceReady(current, strategy);
  const phase = executionPhaseForCurrentStep(current, strategy);
  assertPathsAdmitted(current, stepPlan, candidatePaths, 'candidate_paths', root, assessments, 'repair', phase);
  assertCommandPlansAdmitted(root, current, stepPlan, assessments, phase, 'repair');
  assertExactCommandWritesCovered(stepPlan, candidatePaths);

  const recoveredReceipt = recoverOutstandingRepairReceipt(current, stepPlan, strategy, candidatePaths);
  if (recoveredReceipt) {
    return {
      status: 'pass',
      operation_kind: 'execute-step-repair-preflight',
      committed: false,
      read_back_verified: true,
      current_step: currentStepResult(stepPlan, { ...strategy, phase: recoveredReceipt.execution_phase }),
      context_projection: taskContextReferenceForCurrent(root, current, 'preflight-step', 'repair'),
      receipt: recoveredReceipt,
    };
  }

  const admissionWaveId = findingAdmissionWaveId(pending.review_id);
  // Older installations kept the previous step's converged repair budget when
  // advancing. Rotate only when its completion is durably bound to this step;
  // the already-recorded discovery review remains intact.
  const previousStepCompletion = currentDefinitionExecutionLog(current).findLast(item =>
    !('action' in item)
    && item.advancement === 'advanced'
    && item.next_step_id === pending.step_id
    && item.review_receipt?.cycle_id === current.runtimeState.review_cycle.id,
  );
  const admissionCycleId = pending.cycle_phase === 'discovery'
    && pending.cycle_id === current.runtimeState.review_cycle.id
    && previousStepCompletion
    && !('action' in previousStepCompletion)
    ? reviewCycleForNextStep(current.runtimeState.review_cycle.id, pending.step_id, previousStepCompletion.idempotency_key).id
    : current.runtimeState.review_cycle.id;
  for (const candidate of pending.findings) {
    if (pending.finding_dispositions?.some(item => item.fingerprint === candidate.fingerprint && item.disposition === 'defer')) continue;
    if (!candidatePaths.includes(candidate.file)) {
      fail('EXECUTE_PREFLIGHT_SCOPE_CONFLICT', `candidate_paths must include review finding path ${candidate.file}.`);
    }
    const existingFinding = current.runtimeState.findings.find(item => item.fingerprint === candidate.fingerprint);
    if (existingFinding?.status === 'resolved') {
      fail('FINDING_ALREADY_RESOLVED', `review finding ${candidate.fingerprint} is already resolved and cannot be re-admitted.`);
    }
    const admissionKey = idempotencyKey('execute-review-admit', { review_id: pending.review_id, fingerprint: candidate.fingerprint });
    if (hasAppliedProposal(current, admissionKey)) continue;
    const proposal = createFindingQueueProposal(current, {
      mode: 'repair',
      delta: {
        kind: 'finding-queue',
        action: 'admit',
        cycle_phase: pending.cycle_phase,
        finding_admission_wave_id: admissionWaveId,
        finding: {
          fingerprint: candidate.fingerprint,
          category: candidate.category,
          owner_task_id: current.runtimeState.task_id,
          scope: 'admitted',
          decision: 'mechanical',
          file: candidate.file,
          failure_condition: candidate.failure_condition,
          violated_invariant: candidate.required_behavior,
          root_cause_status: candidate.root_cause_status,
          max_repair_attempts: MAX_REPAIR_ATTEMPTS,
          evidence_refs: candidate.evidence_refs,
          review_cycle_id: admissionCycleId,
        },
      },
      idempotency_key: admissionKey,
      authority_evidence: authority(current, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission']),
      evidence_refs: candidate.evidence_refs,
    });
    const result = verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
    if (result.status !== 'success' && result.status !== 'no-op') {
      fail('FINDING_ADMISSION_BLOCKED', result.message);
    }
    if (!options.dryRun) current = readCanonicalCurrentTask(root);
  }

  const fingerprints = repairFingerprintsForPendingReview(current);
  if (fingerprints.length === 0) {
    fail('REVIEW_FINDINGS_REQUIRED', 'the current review has no structured repair target; resubmit the exact review result before repairing.');
  }
  if (budgetContinuation && budgetContinuation.finding_fingerprints.some(fingerprint => !fingerprints.includes(fingerprint))) {
    fail('REPAIR_BUDGET_EXTENSION_TARGET_INVALID', 'the retained budget extension is not covered by the current review repair set.');
  }
  if (controlledContinuation) {
    if (controlledContinuation.recovery_fingerprints.some(fingerprint => !fingerprints.includes(fingerprint))) {
      fail('CONTROLLED_RECOVERY_TARGET_INVALID', 'the active controlled recovery grant may continue only while each unresolved authorized target remains in the latest review repair set.');
    }
  }
  for (const fingerprint of fingerprints) {
    const finding = current.runtimeState.findings.find(item => item.fingerprint === fingerprint);
    if (!options.dryRun && (!finding || !['admitted', 'in-progress'].includes(finding.status))) {
      fail('FINDING_ADMISSION_REQUIRED', `review finding ${fingerprint} is not repairable.`);
    }
    if (!options.dryRun && finding!.repair_attempts >= finding!.max_repair_attempts
      && (!controlledContinuation || !controlledContinuation.recovery_fingerprints.includes(fingerprint))) {
      fail('REPAIR_BUDGET_EXHAUSTED', `finding ${fingerprint} has exhausted its repair budget.`);
    }
  }
  const waveId = controlledContinuation?.current_repair_wave_id ?? repairWaveIdForRepairSet(pending.review_id, fingerprints);
  const reviewTargetPaths = [...new Set([
    ...reviewedExecution.execution_result.review_target.entries.map(item => item.path),
    ...candidatePaths,
  ])];
  const preflightProposal = createStepPreflightProposal(current, candidatePaths, assessments, {
    mode: 'repair',
    plan_revision: stepPlanRevision(stepPlan),
    execution_phase: phase,
    repair_fingerprints: fingerprints,
    repair_wave_id: waveId,
    review_id: pending.review_id,
    review_target_paths: reviewedExecution.execution_result.review_target.entries.map(item => item.path),
    change_set_id: pending.change_set_id,
    ...(controlledContinuation ? { controlled_recovery_grant_id: controlledContinuation.grant_id } : {}),
  });
  const preflightResult = verifyReadBack(root, applyVNextRuntimeProposal(root, preflightProposal, options), options);
  if (preflightResult.status !== 'success' && preflightResult.status !== 'no-op') fail('PREFLIGHT_BLOCKED', preflightResult.message);
  if (!options.dryRun) current = readCanonicalCurrentTask(root);
  const executionPreflight = current.runtimeState.execution_preflight;
  const receipt: ExecuteStepRepairPreflightReceipt = {
    kind: 'execute-step-repair-preflight/v1',
    ...(executionPreflight?.preflight_id ? { preflight_id: executionPreflight.preflight_id } : { preflight_id: preflightProposal.idempotency_key }),
    ...(executionPreflight?.execution_id ? { execution_id: executionPreflight.execution_id } : {}),
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: stepPlan.step.id,
    plan_revision: stepPlanRevision(stepPlan),
    mode: 'repair',
    test_strategy_mode: strategy.mode,
    execution_phase: executionPreflight?.execution_phase ?? phase,
    candidate_paths: executionPreflight?.candidate_paths ?? candidatePaths,
    repair_fingerprints: executionPreflight?.repair_fingerprints ?? fingerprints,
    repair_wave_id: executionPreflight?.repair_wave_id ?? waveId,
    change_set_id: executionPreflight?.change_set_id ?? pending.change_set_id,
    review_target_paths: executionPreflight?.review_target_paths ?? reviewedExecution.execution_result.review_target.entries.map(item => item.path),
    review_id: executionPreflight?.review_id ?? pending.review_id,
    ...(executionPreflight?.controlled_recovery_grant_id === undefined ? {} : { controlled_recovery_grant_id: executionPreflight.controlled_recovery_grant_id }),
    review_base: captureReviewTarget(root, reviewTargetPaths),
  };
  return {
    status: 'pass',
    operation_kind: 'execute-step-repair-preflight',
    committed: preflightResult.committed,
    read_back_verified: options.dryRun ? true : preflightResult.read_back_verified,
    current_step: currentStepResult(stepPlan, { ...strategy, phase: receipt.execution_phase }),
    context_projection: taskContextReferenceForCurrent(root, current, 'preflight-step', 'repair'),
    receipt,
  };
}

export function retryStep(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input,'retry-step input');
  exactKeys(source,['step_id','blocked_attempt_id','blocker_resolution_refs',...(source.repair_diagnosis === undefined ? [] : ['repair_diagnosis']),'idempotency_key'],'retry-step input');
  const current = readCanonicalCurrentTask(root);
  const proposal = createStepRetryProposal(current,{
    step_id:text(source.step_id,'step_id',128),
    blocked_attempt_id:text(source.blocked_attempt_id,'blocked_attempt_id',128),
    blocker_resolution_refs:textList(source.blocker_resolution_refs,'blocker_resolution_refs',false),
    ...(source.repair_diagnosis === undefined ? {} : {repair_diagnosis:source.repair_diagnosis as StepRepairDiagnosis}),
    idempotency_key:text(source.idempotency_key,'idempotency_key',128),
  });
  return verifyReadBack(root,applyVNextRuntimeProposal(root,proposal,options),options);
}

// Read current declared subjects after running a check, without refreshing any
// stored report, prerequisite, review baseline or execution permission.
export function evidenceContext(root: string, input: unknown): ExecuteStepEvidenceContext {
  const source = contextInput(input, ['offset', 'limit', 'continuation']);
  const current = readCanonicalCurrentTask(root);
  assertExecutableTask(current);
  assertBusinessEvidenceVersion(current);
  const allChecks = (current.runtimeState.claim_evidence ?? []).flatMap(claim => claim.slots.map(slot => {
    if (!slot.check) fail('CLAIM_EVIDENCE_PLAN_REQUIRED', 'A frozen check is required.');
    const snapshot = captureReviewTarget(root, slot.check.subject_paths);
    return {
      claim_id: claim.claim_id,
      slot_id: slot.slot_id,
      check_id: slot.check.check_id,
      boundary: slot.check.boundary ?? null,
      user_decision: slot.user_decision ? { ...slot.user_decision } : null,
      frozen_invocation: slot.check.entry,
      validation_items: [...(slot.check.validation_items ?? [])],
      minimum_type: slot.minimum_type,
      execution_selection: slot.check.selection ? { ...slot.check.selection } : null,
      subject_revision: snapshot.revision,
      subject_snapshot: subjectSnapshotSummary(snapshot),
    };
  }));
  if (!current.runtimeState.evidence_plan_revision || !allChecks.length) fail('CLAIM_EVIDENCE_PLAN_REQUIRED', 'A frozen evidence plan is required.');
  const continuationValue = source.continuation;
  let continuation: { kind: 'execute-step-evidence-page/v1'; source_revision: string; evidence_plan_revision: string; offset: number } | null = null;
  if (continuationValue !== undefined) {
    let parsed: unknown = continuationValue;
    if (typeof continuationValue === 'string') {
      try { parsed = JSON.parse(continuationValue) as unknown; } catch { fail('EVIDENCE_CONTEXT_CONTINUATION_INVALID', 'continuation is not valid JSON.'); }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('EVIDENCE_CONTEXT_CONTINUATION_INVALID', 'continuation must be an object.');
    const cursor = parsed as Record<string, unknown>;
    if (cursor.kind !== 'execute-step-evidence-page/v1' || cursor.source_revision !== current.sourceTuple.revision
      || cursor.evidence_plan_revision !== current.runtimeState.evidence_plan_revision
      || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0) {
      fail('EVIDENCE_CONTEXT_STALE', 'source or evidence-plan revision changed; start a fresh evidence-context read.');
    }
    continuation = {
      kind: 'execute-step-evidence-page/v1',
      source_revision: current.sourceTuple.revision,
      evidence_plan_revision: current.runtimeState.evidence_plan_revision,
      offset: Number(cursor.offset),
    };
  }
  const offset = continuation?.offset ?? integer(source.offset, 0, 0, allChecks.length);
  const limit = integer(source.limit, 64, 1, 64);
  if (offset > allChecks.length) fail('EVIDENCE_CONTEXT_CONTINUATION_INVALID', 'offset is outside the declared check set.');
  const checks = allChecks.slice(offset, offset + limit);
  const nextOffset = offset + checks.length;
  const complete = nextOffset >= allChecks.length;
  return {
    status: complete ? 'pass' : 'partial',
    operation_kind: 'execute-step-evidence-context',
    committed: false,
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    evidence_plan_revision: current.runtimeState.evidence_plan_revision,
    evidence_assurance: 'caller-reported',
    checks,
    returned_check_count: checks.length,
    total_check_count: allChecks.length,
    unexpanded_check_ids: complete ? [] : allChecks.slice(nextOffset, nextOffset + 64).map(item => item.check_id),
    unexpanded_check_count: Math.max(0, allChecks.length - nextOffset),
    unexpanded_check_ids_truncated: allChecks.length - nextOffset > 64,
    complete_for_operation: complete,
    continuation: complete ? null : {
      kind: 'execute-step-evidence-page/v1',
      source_revision: current.sourceTuple.revision,
      evidence_plan_revision: current.runtimeState.evidence_plan_revision,
      offset: nextOffset,
    },
    subject_snapshots_read: 'Use task-context/task-read for the exact frozen subject entries.',
    context_projection: taskContextReferenceForCurrent(root, current, 'evidence-context', 'default'),
  };
}

export function preflightStep(root: string, input: unknown): ExecuteStepPreflightResult {
  const source = record(input, 'preflight-step input');
  const currentForInput = readCanonicalCurrentTask(root);
  exactKeys(source, currentForInput.mutationAuthority
    ? ['candidate_paths', ...(source.blast_radius_assessments === undefined ? [] : ['blast_radius_assessments'])]
    : ['candidate_paths'], 'preflight-step input');
  const candidatePaths = pathList(source.candidate_paths, 'candidate_paths', true);
  let assessments: BlastRadiusAssessment[] = [];
  if (currentForInput.mutationAuthority && source.blast_radius_assessments !== undefined) {
    try { assessments = normalizeBlastRadiusAssessments(source.blast_radius_assessments); }
    catch (error) { fail(error instanceof MutationAuthorityError ? error.code : 'MUTATION_AUTHORITY_ASSESSMENT_INVALID', error instanceof Error ? error.message : String(error)); }
  }

  let current = currentForInput;
  assertOrdinaryPreflight(current, root);
  assertExecutableTask(current);
  const stepPlan = currentStepPlan(current);
  const strategy = resolveTestStrategyExecutionContext(current);
  assertTestStrategySequenceReady(current, strategy);
  const phase = executionPhaseForCurrentStep(current, strategy);
  assertPathsAdmitted(current, stepPlan, candidatePaths, 'candidate_paths', root, assessments, 'default', phase);
  assertCommandPlansAdmitted(root, current, stepPlan, assessments, phase, 'default');
  assertExactCommandWritesCovered(stepPlan, candidatePaths);

  let committed = false;
  let preflightId: string | undefined;
  const coverage = current.runtimeState.review_coverage;
  const hasPrerequisites = current.runtimeState.claim_evidence?.some(claim => claim.slots.some(slot => slot.before_step_id === stepPlan.step.id && !slot.prerequisite_receipt));
  if (coverage && !hasPrerequisites && captureReviewTarget(root, coverage.target.entries.map(entry => entry.path)).revision !== coverage.target.revision) fail('REVIEW_TARGET_STALE', 'Unrecorded changes cannot refresh the cumulative baseline.');
  const activePreflightMatchesStep = current.runtimeState.execution_preflight?.step_id === stepPlan.step.id;
  if (activePreflightMatchesStep
    && digest(current.runtimeState.execution_preflight!.candidate_paths) !== digest(candidatePaths)) {
    fail('EXECUTE_PREFLIGHT_STALE', 'the active preflight already owns a different target set; use extend-preflight for additional targets.');
  }
  if (!current.runtimeState.step_attempts?.[stepPlan.step.id] || !coverage || candidatePaths.some(p => !coverage.base.entries.some(entry => entry.path === p)) || hasPrerequisites || current.runtimeState.step_attempts?.[stepPlan.step.id]?.attempts.at(-1)?.status === 'ready' || (current.mutationAuthority && !activePreflightMatchesStep)) {
  const proposal = createStepPreflightProposal(
    current,
    candidatePaths,
    assessments,
    {
      ...(current.mutationAuthority ? { plan_revision: stepPlanRevision(stepPlan) } : {}),
      execution_phase: phase,
      change_set_id: changeSetId(current, stepPlan.step.id),
    },
  );
    preflightId = proposal.idempotency_key;
    const registration = applyVNextRuntimeProposal(root, proposal);
    if (!['success', 'no-op'].includes(registration.status)) fail('PREFLIGHT_BLOCKED', registration.message);
    committed = registration.committed;
    current = readCanonicalCurrentTask(root);
  }
  const executionPreflight = current.runtimeState.execution_preflight;
  // A retry/admission key belongs to the attempt ledger.  Once a durable
  // execution marker exists, receipts must use its own preflight identity;
  // otherwise a retry key would masquerade as the execution key when the
  // same preflight is read again after a partial result.
  if (!preflightId) preflightId = executionPreflight?.step_id === stepPlan.step.id
    ? executionPreflight.preflight_id
    : current.runtimeState.step_attempts?.[stepPlan.step.id]?.attempts.at(-1)?.idempotency_key;
  const activeStrategy = executionPreflight?.step_id === stepPlan.step.id
    ? { ...strategy, phase: executionPreflight.execution_phase }
    : { ...strategy, phase };
  const receipt: ExecuteStepPreflightReceipt = {
    kind: 'execute-step-preflight/v1',
    ...(preflightId ? { preflight_id: preflightId } : {}),
    ...(executionPreflight ? { execution_id: executionPreflight.execution_id } : {}),
    attempt_id: nextStepAttemptId(current),
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: stepPlan.step.id,
    plan_revision: executionPreflight?.plan_revision
      ?? (executionPreflight ? ordinaryPreflightPlanRevision(current) : stepPlanRevision(stepPlan)),
    mode: 'default',
    test_strategy_mode: strategy.mode,
    execution_phase: activeStrategy.phase,
    candidate_paths: executionPreflight?.candidate_paths ?? candidatePaths,
    repair_fingerprint: null,
    change_set_id: executionPreflight?.change_set_id ?? changeSetId(current, stepPlan.step.id),
    review_base: executionPreflight?.step_id === stepPlan.step.id
      ? exactReviewBaseForCandidates(current, executionPreflight.candidate_paths)
      : captureReviewTarget(root, candidatePaths),
    ...(current.mutationAuthority ? { mutation_authority_version: 2 as const } : {}),
  };
  return {
    status: 'pass',
    operation_kind: 'execute-step-preflight',
    committed,
    read_back_verified: true,
    current_step: currentStepResult(stepPlan, activeStrategy),
    context_projection: taskContextReferenceForCurrent(root, current, 'preflight-step', 'default'),
    receipt,
  };
}

/**
 * Admit newly discovered same-envelope paths without creating a continuation
 * or consuming another attempt.  The replacement receipt is the only receipt
 * accepted by the subsequent result operation.
 */
export function extendPreflight(
  root: string,
  input: unknown,
  options: RuntimeApplyOptions = {},
): ExecuteStepPreflightResult | ExecuteStepRepairPreflightResult {
  const source = record(input, 'extend-preflight input');
  exactKeys(source, ['current_preflight_receipt', 'additional_targets', 'blast_radius_assessments', 'evidence_refs'], 'extend-preflight input');
  const receipt = normalizePreflightReceipt(source.current_preflight_receipt);
  if (receipt.mode !== 'default' && receipt.mode !== 'repair') {
    fail('EXECUTE_PREFLIGHT_IDENTITY_CONFLICT', 'extend-preflight requires a current ordinary or repair preflight receipt.');
  }
  const current = readCanonicalCurrentTask(root);
  if (!current.mutationAuthority) fail('MUTATION_AUTHORITY_VERSION_REQUIRED', 'extend-preflight is available only for Mutation Authority v2 tasks.');
  if (receipt.mode === 'default') assertOrdinaryPreflight(current, root);
  else assertExecutableTask(current);
  const stepPlan = currentStepPlan(current);
  assertCurrentReceipt(root, current, stepPlan, receipt);
  const additionalTargets = pathList(source.additional_targets, 'additional_targets', false);
  if (additionalTargets.some(target => receipt.candidate_paths.includes(target))) {
    fail('EXECUTE_PREFLIGHT_SCOPE_CONFLICT', 'additional_targets must not repeat an already preflighted path.');
  }
  let assessments: BlastRadiusAssessment[];
  try { assessments = normalizeBlastRadiusAssessments(source.blast_radius_assessments); }
  catch (error) { fail(error instanceof MutationAuthorityError ? error.code : 'MUTATION_AUTHORITY_ASSESSMENT_INVALID', error instanceof Error ? error.message : String(error)); }
  const evidenceRefs = textList(source.evidence_refs, 'evidence_refs', false);
  const candidatePaths = [...receipt.candidate_paths, ...additionalTargets];
  assertTestStrategySequenceReady(current, resolveTestStrategyExecutionContext(current));
  assertPathsAdmitted(current, stepPlan, candidatePaths, 'additional_targets', root, assessments, receipt.mode, receipt.execution_phase);
  assertCommandPlansAdmitted(root, current, stepPlan, assessments, receipt.execution_phase, receipt.mode);
  const currentPreflightId = receipt.preflight_id ?? receipt.attempt_id;
  if (!currentPreflightId) fail('EXECUTE_PREFLIGHT_IDENTITY_CONFLICT', 'current_preflight_receipt must bind a preflight id.');
  const proposal = createStepExtendPreflightProposal(current, {
    step_id: stepPlan.step.id,
    current_preflight_id: currentPreflightId,
    additional_targets: additionalTargets,
    blast_radius_assessments: assessments,
    evidence_refs: evidenceRefs,
    mode: receipt.mode,
    ...(receipt.execution_id === undefined ? {} : { execution_id: receipt.execution_id }),
    execution_phase: receipt.execution_phase,
  });
  // The execution receipt carries a baseline for this execution's candidate
  // set.  Preserve the prior receipt baseline and capture only newly admitted
  // paths now; cumulative review coverage remains a separate projection.
  const extensionReviewBase = createReviewTargetManifest([
    ...receipt.review_base.entries,
    ...captureReviewTarget(root, additionalTargets).entries,
  ]);
  const result = applyVNextRuntimeProposal(root, proposal, options);
  if (!['success', 'no-op'].includes(result.status)) fail('PREFLIGHT_BLOCKED', result.message);
  const next = options.dryRun ? current : readCanonicalCurrentTask(root);
  const coverage = next.runtimeState.review_coverage;
  const nextBase = coverage?.base ?? captureReviewTarget(root, candidatePaths);
  const active = next.runtimeState.execution_preflight;
  const nextStrategy = resolveTestStrategyExecutionContext(next);
  const activeStrategy = active
    ? { ...nextStrategy, phase: active.execution_phase }
    : { ...nextStrategy, phase: receipt.execution_phase };
  if (receipt.mode === 'repair') {
    const repairReceipt: ExecuteStepRepairPreflightReceipt = {
      kind: 'execute-step-repair-preflight/v1',
      ...(active?.preflight_id ? { preflight_id: active.preflight_id } : { preflight_id: proposal.idempotency_key }),
      ...(active?.execution_id ? { execution_id: active.execution_id } : receipt.execution_id ? { execution_id: receipt.execution_id } : {}),
      task_id: next.runtimeState.task_id,
      document_id: next.sourceTuple.document_id,
      source_revision: next.sourceTuple.revision,
      step_id: stepPlan.step.id,
      plan_revision: active?.plan_revision ?? stepPlanRevision(stepPlan),
      mode: 'repair',
      test_strategy_mode: activeStrategy.mode,
      execution_phase: active?.execution_phase ?? receipt.execution_phase,
      candidate_paths: active?.candidate_paths ?? candidatePaths,
      repair_fingerprints: active?.repair_fingerprints ?? receipt.repair_fingerprints,
      repair_wave_id: active?.repair_wave_id ?? receipt.repair_wave_id,
      change_set_id: active?.change_set_id ?? receipt.change_set_id,
      review_target_paths: active?.review_target_paths ?? receipt.review_target_paths,
      review_id: active?.review_id ?? receipt.review_id,
      ...(active?.controlled_recovery_grant_id === undefined ? (receipt.controlled_recovery_grant_id === undefined ? {} : { controlled_recovery_grant_id: receipt.controlled_recovery_grant_id }) : { controlled_recovery_grant_id: active.controlled_recovery_grant_id }),
      review_base: coverage?.target ?? nextBase,
    };
    return {
      status: 'pass',
      operation_kind: 'execute-step-repair-preflight',
      committed: result.committed,
      read_back_verified: options.dryRun ? true : result.read_back_verified,
      current_step: currentStepResult(stepPlan, activeStrategy),
      context_projection: taskContextReferenceForCurrent(root, next, 'preflight-step', 'repair'),
      receipt: repairReceipt,
    };
  }
  const ordinaryResult: ExecuteStepPreflightResult = {
    status: 'pass',
    operation_kind: 'execute-step-preflight-extension',
    committed: result.committed,
    read_back_verified: options.dryRun ? true : result.read_back_verified,
    current_step: currentStepResult(stepPlan, activeStrategy),
    context_projection: taskContextReferenceForCurrent(root, next, 'preflight-step', 'default'),
    receipt: {
      kind: 'execute-step-preflight/v1',
      ...(active?.preflight_id ? { preflight_id: active.preflight_id } : { preflight_id: proposal.idempotency_key }),
      ...(active?.execution_id ? { execution_id: active.execution_id } : receipt.execution_id ? { execution_id: receipt.execution_id } : {}),
      ...(receipt.attempt_id ? { attempt_id: receipt.attempt_id } : {}),
      task_id: next.runtimeState.task_id,
      document_id: next.sourceTuple.document_id,
      source_revision: next.sourceTuple.revision,
      step_id: stepPlan.step.id,
      plan_revision: active?.plan_revision ?? stepPlanRevision(stepPlan),
      mode: 'default',
      test_strategy_mode: activeStrategy.mode,
      execution_phase: active?.execution_phase ?? receipt.execution_phase,
      candidate_paths: active?.candidate_paths ?? candidatePaths,
      repair_fingerprint: null,
      change_set_id: active?.change_set_id ?? coverage?.change_set_id ?? changeSetId(next, stepPlan.step.id),
      review_base: extensionReviewBase,
      mutation_authority_version: 2,
    },
  };
  return ordinaryResult;
}

type CommandResult = {
  command: string;
  status: StepExecutionResultStatus;
  observed_repo_writes: string[];
  evidence_refs: string[];
  expected_failure?: StepExpectedFailureEvidence;
  waiver_decision_id?: string;
};
type ValidationResult = {
  validation: string;
  status: StepExecutionResultStatus;
  evidence_refs: string[];
  expected_failure?: StepExpectedFailureEvidence;
  waiver_decision_id?: string;
};
type AcceptanceEvidence = StepAcceptanceEvidence;

function resultStatus(value: unknown, location: string): StepExecutionResultStatus {
  if (value !== 'passed' && value !== 'expected-failure' && value !== 'failed' && value !== 'blocked' && value !== 'not-run') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be passed, expected-failure, failed, blocked, or not-run.`);
  }
  return value;
}

function normalizeExpectedFailure(value: unknown, location: string): StepExpectedFailureEvidence {
  const source = record(value, location);
  exactKeys(source, ['kind', 'expected_behavior', 'observed_failure_signature'], location);
  if (source.kind !== 'behavior-not-implemented') {
    fail('EXECUTE_EXPECTED_FAILURE_INVALID', `${location}.kind must be behavior-not-implemented; syntax, import, fixture, tool, and environment failures are blocked outcomes.`);
  }
  return {
    kind: 'behavior-not-implemented',
    expected_behavior: text(source.expected_behavior, `${location}.expected_behavior`),
    observed_failure_signature: text(source.observed_failure_signature, `${location}.observed_failure_signature`),
  };
}

function normalizeCommandResults(value: unknown): CommandResult[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'command_results must be a bounded array.');
  }
  const results = value.map((item, index) => {
    const location = `command_results[${index}]`;
    const source = record(item, location);
    const status = resultStatus(source.status, `${location}.status`);
    exactKeys(
      source,
      status === 'expected-failure'
        ? ['command', 'status', 'observed_repo_writes', 'evidence_refs', 'expected_failure']
        : ['command', 'status', 'observed_repo_writes', 'evidence_refs', ...(source.waiver_decision_id === undefined ? [] : ['waiver_decision_id'])],
      location,
    );
    const observedRepoWrites = pathList(source.observed_repo_writes, `${location}.observed_repo_writes`, true);
    if (status === 'not-run' && observedRepoWrites.length > 0) {
      fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location}.not-run command must not report repository writes.`);
    }
    return {
      command: text(source.command, `${location}.command`),
      ...(source.waiver_decision_id === undefined ? {} : { waiver_decision_id: text(source.waiver_decision_id, 'waiver_decision_id') }),
      status,
      observed_repo_writes: observedRepoWrites,
      evidence_refs: textList(source.evidence_refs, `${location}.evidence_refs`, status === 'not-run'),
      ...(status === 'expected-failure'
        ? { expected_failure: normalizeExpectedFailure(source.expected_failure, `${location}.expected_failure`) }
        : {}),
    };
  });
  if (new Set(results.map(item => item.command)).size !== results.length) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'command_results must not contain duplicate commands.');
  }
  return results;
}

function normalizeValidationResults(value: unknown): ValidationResult[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'validation_results must be a bounded non-empty array.');
  }
  const results = value.map((item, index) => {
    const location = `validation_results[${index}]`;
    const source = record(item, location);
    const status = resultStatus(source.status, `${location}.status`);
    exactKeys(
      source,
      status === 'expected-failure'
        ? ['validation', 'status', 'evidence_refs', 'expected_failure']
        : ['validation', 'status', 'evidence_refs', ...(source.waiver_decision_id === undefined ? [] : ['waiver_decision_id'])],
      location,
    );
    return {
      validation: text(source.validation, `${location}.validation`),
      ...(source.waiver_decision_id === undefined ? {} : { waiver_decision_id: text(source.waiver_decision_id, 'waiver_decision_id') }),
      status,
      evidence_refs: textList(source.evidence_refs, `${location}.evidence_refs`, status === 'not-run'),
      ...(status === 'expected-failure'
        ? { expected_failure: normalizeExpectedFailure(source.expected_failure, `${location}.expected_failure`) }
        : {}),
    };
  });
  if (new Set(results.map(item => item.validation)).size !== results.length) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'validation_results must not contain duplicate validations.');
  }
  return results;
}

function normalizeAcceptanceEvidence(value: unknown): AcceptanceEvidence[] {
  return validateStepAcceptanceEvidence(value, 'acceptance_evidence');
}

function updateClaimEvidence(current: CanonicalCurrentTask, evidence: AcceptanceEvidence[]): ClaimEvidenceRecord[] {
  const plan = structuredClone(current.runtimeState.claim_evidence ?? []);
  for (const item of evidence) {
    const slot = plan.find(claim => claim.claim_id === item.claim_id)?.slots.find(slot => slot.slot_id === item.slot_id);
    if (!slot || slot.check?.check_id !== item.check_id || slot.minimum_type !== item.minimum_type) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'result must identify the exact frozen claim/slot/check and type.');
    if (slot.prerequisite_receipt) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'consumed prerequisite evidence is immutable.');
    slot.disposition = item.disposition;
    slot.evidence_refs = [...item.evidence_refs];
    slot.report = item.report;
  }
  return plan;
}

function assertExactResultSet(actual: readonly string[], expected: readonly string[], location: string): void {
  const missing = expected.filter(item => !actual.includes(item));
  const unexpected = actual.filter(item => !expected.includes(item));
  if (missing.length > 0 || unexpected.length > 0) {
    fail('EXECUTE_RESULT_PLAN_CONFLICT', `${location} must match the current step plan; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}].`);
  }
}

function assertObservedWithinExpected(command: PlannedCommand, observed: readonly string[]): void {
  if (command.expected_repo_writes === 'none') {
    if (observed.length > 0) {
      fail('COMMAND_OBSERVED_WRITE_BLOCKED', `command "${command.command}" was planned as write-free but observed repository writes: ${observed.join(', ')}.`);
    }
    return;
  }
  const expectedWrites = command.expected_repo_writes;
  const outside = observed.filter(file => !expectedWrites.some(pattern => mutationScopePatternMatchesPath(file, pattern)));
  if (outside.length > 0) {
    fail('COMMAND_OBSERVED_WRITE_BLOCKED', `command "${command.command}" wrote outside its prepared footprint: ${outside.join(', ')}.`);
  }
}

function assertCommandResults(
  root: string,
  current: CanonicalCurrentTask,
  stepPlan: StepPlan,
  results: CommandResult[],
  phase: TestStrategyExecutionContext['phase'],
  mode: 'default' | 'repair',
): void {
  assertExactResultSet(results.map(item => item.command), stepPlan.commands.map(item => item.command), 'command_results');
  if (current.mutationAuthority) {
    for (const result of results) {
      if (result.status === 'not-run') continue;
      const planned = stepPlan.commands.find(item => item.command === result.command)!;
      assertObservedWithinExpected(planned, result.observed_repo_writes);
      assertPathsAdmitted(current, stepPlan, result.observed_repo_writes, `observed writes for command "${result.command}"`, root, [], mode, phase);
    }
    return;
  }
  const scope = parseMutationScope(current.body, current.sourceTuple.revision);
  for (const result of results) {
    const planned = stepPlan.commands.find(item => item.command === result.command)!;
    if (result.status === 'not-run') continue;
    assertObservedWithinExpected(planned, result.observed_repo_writes);
    assertPathsAdmitted(current, stepPlan, result.observed_repo_writes, `observed writes for command "${result.command}"`, root, [], mode, phase);
    if (planned.expected_repo_writes === 'none') continue;
    const audit = auditCommandMutation(scope, {
      command: planned.command,
      expected_write_footprint: {
        kind: 'bounded',
        targets: planned.expected_repo_writes,
        evidence_refs: result.evidence_refs,
      },
      transformation_kind: planned.transformation_kind,
      observed_write_paths: result.observed_repo_writes,
    });
    if (audit.status !== 'pass') {
      fail('COMMAND_MUTATION_AUDIT_BLOCKED', `command "${result.command}" failed Runtime mutation audit: ${audit.blockers.join(' ')}`);
    }
  }
}

function assertValidationResults(stepPlan: StepPlan, results: ValidationResult[]): void {
  assertExactResultSet(results.map(item => item.validation), stepPlan.validation, 'validation_results');
}

function allEvidenceRefs(
  commands: readonly CommandResult[],
  validations: readonly ValidationResult[],
  acceptance: readonly AcceptanceEvidence[],
): string[] {
  return [...new Set([
    ...commands.flatMap(item => item.evidence_refs),
    ...validations.flatMap(item => item.evidence_refs),
    ...acceptance.flatMap(item => item.evidence_refs),
  ])];
}

function verifyReadBack(root: string, result: RuntimeResult, options: RuntimeApplyOptions): RuntimeResult {
  if (options.dryRun || (result.status !== 'success' && result.status !== 'no-op')) return result;
  const readBack = readCanonicalCurrentTask(root);
  if (!result.read_back_verified || result.resulting_revision !== readBack.sourceTuple.revision) {
    fail('EXECUTE_ADAPTER_READ_BACK_FAILED', 'execute-step adapter could not verify the committed canonical CURRENT_TASK revision.');
  }
  return result;
}

function semanticNoOp(current: CanonicalCurrentTask, key: string, message: string, options: RuntimeApplyOptions): RuntimeResult {
  const state = current.runtimeState;
  return {
    status: 'no-op',
    operation_kind: 'task-state-transaction',
    idempotency_key: key,
    target_path: current.relativePath,
    dry_run: options.dryRun === true,
    committed: false,
    message,
    previous_revision: current.sourceTuple.revision,
    resulting_revision: current.sourceTuple.revision,
    planned_writes: [],
    governed_mutation_count: 0,
    read_back_verified: true,
    state: {
      task_id: state.task_id,
      workflow_status: state.workflow_status,
      lifecycle_state: state.lifecycle_state,
      resume_requires_review: state.resume_requires_review,
      resume_review_reasons: [...state.resume_review_reasons],
      active_step_id: state.active_step_id,
      active_step_status: state.active_step_status,
      finding_queue_revision: state.finding_queue_revision,
      review_cycle_id: state.review_cycle.id,
      repair_round: state.review_cycle.repair_round,
    },
  };
}

function hasAppliedProposal(current: CanonicalCurrentTask, key: string): boolean {
  return current.runtimeState.applied_proposals.some(item => item.idempotency_key === key);
}

function applyRepairAttempts(
  root: string,
  current: CanonicalCurrentTask,
  receipt: AnyExecuteStepPreflightReceipt,
  evidenceRefs: string[],
  keySeed: unknown,
  options: RuntimeApplyOptions,
): CanonicalCurrentTask | RuntimeResult {
  const fingerprints = receipt.kind === 'execute-step-repair-preflight/v1'
    ? receipt.repair_fingerprints
    : [receipt.repair_fingerprint!];
  const waveId = receipt.kind === 'execute-step-repair-preflight/v1'
    ? receipt.repair_wave_id
    : `repair-wave-${digest(keySeed).slice(0, 24)}`;
  let fresh = current;
  for (const fingerprint of fingerprints) {
    const finding = fresh.runtimeState.findings.find(item => item.fingerprint === fingerprint);
    if (!finding || !['admitted', 'in-progress'].includes(finding.status)) {
      fail('FINDING_ADMISSION_REQUIRED', `repair finding ${fingerprint} is no longer admitted.`);
    }
    if (finding.last_repair_wave_id === waveId) continue;
    const key = idempotencyKey('execute-repair-attempt', { keySeed, fingerprint, wave_id: waveId });
    const proposal = createFindingQueueProposal(fresh, {
      mode: 'repair',
      delta: {
        kind: 'finding-queue',
        action: 'record-repair-attempt',
        fingerprint,
        review_cycle_id: fresh.runtimeState.review_cycle.id,
        repair_wave_id: waveId,
        evidence_refs: evidenceRefs,
        note: `execute-step repair for ${receipt.step_id}`,
      },
      idempotency_key: key,
      authority_evidence: authority(fresh, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission']),
      evidence_refs: evidenceRefs,
    });
    const result = verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
    if (result.status !== 'success' && result.status !== 'no-op') return result;
    if (options.dryRun) continue;
    fresh = readCanonicalCurrentTask(root);
  }
  return options.dryRun ? current : fresh;
}

export function recordStepResult(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'record-step-result input');
  exactKeys(source, [
    'preflight_receipt',
    ...(source.blocker_kind === undefined ? [] : ['blocker_kind']),
    'actual_changed_paths',
    'command_results',
    'validation_results',
    'acceptance_evidence',
    'outcome',
    'note',
  ], 'record-step-result input');
  if (source.blocker_kind !== undefined && !['environment','unknown'].includes(String(source.blocker_kind))) fail('EXECUTE_ADAPTER_INPUT_INVALID','blocker_kind must be environment or unknown.');
  const receipt = normalizePreflightReceipt(source.preflight_receipt);
  const actualChangedPaths = pathList(source.actual_changed_paths, 'actual_changed_paths', true);
  const commandResults = normalizeCommandResults(source.command_results);
  const validationResults = normalizeValidationResults(source.validation_results);
  const acceptanceEvidence = normalizeAcceptanceEvidence(source.acceptance_evidence);
  if (source.outcome !== 'implemented' && source.outcome !== 'test-red' && source.outcome !== 'blocked') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'outcome must be implemented, test-red, or blocked.');
  }
  const outcome = source.outcome;
  const note = nullableText(source.note, 'note');
  const unplannedActual = actualChangedPaths.filter(file => !receipt.candidate_paths.includes(file));
  if (unplannedActual.length > 0) {
    fail('EXECUTE_PREFLIGHT_SCOPE_CONFLICT', `actual_changed_paths were not admitted by preflight: ${unplannedActual.join(', ')}.`);
  }
  const reviewTargetPaths = receipt.kind === 'execute-step-repair-preflight/v1'
    ? [...new Set([...receipt.review_target_paths, ...receipt.candidate_paths])]
    : [...receipt.candidate_paths];
  const expectedBasePaths = [...new Set(reviewTargetPaths)].sort();
  if (digest(receipt.review_base.entries.map(item => item.path)) !== digest(expectedBasePaths)) {
    fail('EXECUTE_PREFLIGHT_STALE', 'preflight review base does not cover the exact review target path set.');
  }
  const reviewTarget = captureReviewTarget(root, reviewTargetPaths);
  const changeDelta = createReviewChangeDelta(receipt.review_base, reviewTarget);
  const detectedChangedPaths = changeDelta.entries.map(item => item.path);
  if (digest([...actualChangedPaths].sort()) !== digest(detectedChangedPaths)) {
    fail('EXECUTE_RESULT_CHANGE_DELTA_CONFLICT', `actual_changed_paths must match Runtime-detected changes: ${detectedChangedPaths.join(', ') || 'none'}.`);
  }
  const resultKeySeed = {
    ...(source.blocker_kind === undefined ? {} : {blocker_kind:source.blocker_kind}),
    receipt,
    actual_changed_paths: detectedChangedPaths,
    command_results: commandResults,
    validation_results: validationResults,
    acceptance_evidence: acceptanceEvidence,
    change_set_id: receipt.change_set_id,
    review_base: receipt.review_base,
    review_target: reviewTarget,
    change_delta: changeDelta,
    outcome,
    note,
  };
  const resultKey = idempotencyKey('execute-step-result', resultKeySeed);
  let current = readCanonicalCurrentTask(root);
  if (hasAppliedProposal(current, resultKey)) {
    return semanticNoOp(current, resultKey, 'This exact execute-step result was already committed.', options);
  }
  assertExecutableTask(current);
  let stepPlan = currentStepPlan(current);
  assertCurrentReceipt(root, current, stepPlan, receipt);
  if (receipt.mode === 'repair') {
    const priorResult = currentDefinitionExecutionLog(current).findLast(item =>
      !('action' in item)
      && item.mode === 'repair'
      && item.step_id === receipt.step_id
      && item.execution_result?.execution_id === receipt.execution_id
      && item.review_receipt === undefined,
    );
    if (priorResult && priorResult.idempotency_key !== resultKey) {
      fail('EXECUTE_RESULT_REPLAY_CONFLICT', 'this repair execution identity already has a different durable result; obtain a fresh repair preflight before submitting another result.');
    }
  }
  const strategy = resolveTestStrategyExecutionContext(current);
  assertTestStrategySequenceReady(current, strategy);
  assertPathsAdmitted(current, stepPlan, receipt.candidate_paths, 'preflight_receipt.candidate_paths', root, [], receipt.mode, receipt.execution_phase);
  assertPathsAdmitted(current, stepPlan, actualChangedPaths, 'actual_changed_paths', root, [], receipt.mode, receipt.execution_phase);
  assertCommandResults(root, current, stepPlan, commandResults, receipt.execution_phase, receipt.mode);
  assertValidationResults(stepPlan, validationResults);
  assertExecutionResultWaivers(root, current, stepPlan.step.id, { command_results: commandResults, validation_results: validationResults });
  if (outcome === 'implemented' && commandResults.some(item => item.status !== 'passed' && item.status !== 'expected-failure' && !item.waiver_decision_id)) {
    fail('EXECUTE_RESULT_BLOCKED', 'implemented requires passing commands or exact user-waived validation commands.');
  }
  if (outcome === 'implemented' && validationResults.some(item => item.status !== 'passed' && item.status !== 'expected-failure' && !item.waiver_decision_id)) {
    fail('EXECUTE_RESULT_BLOCKED', 'implemented requires passing validation or exact user-waived validation; never report a waiver as PASS.');
  }
  if (outcome === 'test-red') {
    const resultStatuses = [...commandResults, ...validationResults].map(item => item.status);
    if (strategy.phase !== 'red') {
      fail('TEST_STRATEGY_SEQUENCE_INVALID', `outcome=test-red is not valid during phase=${strategy.phase}.`);
    }
    if (!resultStatuses.some(status => status === 'expected-failure')
      || resultStatuses.some(status => status !== 'passed' && status !== 'expected-failure')) {
      fail('EXECUTE_EXPECTED_FAILURE_INVALID', 'test-red requires at least one expected-failure result and permits only passed companion results.');
    }
    if (acceptanceEvidence.length > 0) {
      fail('TEST_STRATEGY_RED_ACCEPTANCE_FORBIDDEN', 'test-red evidence cannot satisfy final acceptance claims before implementation reaches Green.');
    }
  }
  if (outcome === 'blocked' && note === null) {
    fail('EXECUTE_RESULT_BLOCKED', 'blocked requires a concise blocker in note.');
  }
  if (outcome === 'blocked' && ![...commandResults, ...validationResults].some(item => item.status === 'failed' || item.status === 'blocked')) {
    fail('EXECUTE_RESULT_BLOCKED', 'blocked requires at least one failed or blocked command or validation result.');
  }

  if (receipt.kind === 'execute-step-repair-preflight/v1') {
    const pending = current.runtimeState.pending_review_result;
    const priorExecution = pending && currentDefinitionExecutionLog(current).find((item): item is StepExecutionLogEntry =>
      !('action' in item) && item.idempotency_key === pending.execution_id,
    );
    const activePreflight = current.runtimeState.execution_preflight;
    const priorTargetPaths = activePreflight?.mode === 'repair'
      ? activePreflight.review_target_paths
      : priorExecution
        ? cumulativeReviewExecution(current, priorExecution).execution_result?.review_target.entries.map(item => item.path)
        : undefined;
    if (!pending || !priorExecution?.execution_result
      || pending.review_id !== receipt.review_id
      || pending.change_set_id !== receipt.change_set_id
      || priorExecution.execution_result.change_set_id !== receipt.change_set_id
      || (priorTargetPaths !== null && priorTargetPaths !== undefined && digest(priorTargetPaths) !== digest(receipt.review_target_paths))) {
      fail('REVIEW_TARGET_CONFLICT', 'repair result no longer binds the Runtime-recorded reviewed change set.');
    }
  }

  const evidenceRefs = allEvidenceRefs(commandResults, validationResults, acceptanceEvidence);
  const claimEvidence = updateClaimEvidence(current, acceptanceEvidence);
  const executionResult: StepExecutionResult = {
    ...(receipt.execution_id ? { execution_id: receipt.execution_id } : {}),
    ...(receipt.kind === 'execute-step-preflight/v1' && receipt.attempt_id ? {attempt_id:receipt.attempt_id} : {}),
    ...(source.blocker_kind === undefined ? {} : {blocker_kind:source.blocker_kind as 'environment' | 'unknown'}),
    outcome,
    change_set_id: receipt.change_set_id,
    review_base: receipt.review_base,
    review_target: reviewTarget,
    change_delta: changeDelta,
    actual_changed_paths: detectedChangedPaths,
    command_results: commandResults.map(item => ({
      ...item,
      observed_repo_writes: [...item.observed_repo_writes],
      evidence_refs: [...item.evidence_refs],
      ...(item.expected_failure ? { expected_failure: { ...item.expected_failure } } : {}),
    })),
    validation_results: validationResults.map(item => ({
      ...item,
      evidence_refs: [...item.evidence_refs],
      ...(item.expected_failure ? { expected_failure: { ...item.expected_failure } } : {}),
    })),
    acceptance_evidence: acceptanceEvidence.map(item => ({ ...item, evidence_refs: [...item.evidence_refs] })),
    blocker: outcome === 'blocked' ? note : null,
  };
  if (receipt.mode === 'repair') {
    const repairState = applyRepairAttempts(root, current, receipt, evidenceRefs, resultKeySeed, options);
    if ('status' in repairState) return repairState;
    current = repairState;
    stepPlan = currentStepPlan(current);
    if (current.runtimeState.active_step_id !== receipt.step_id || stepPlanRevision(stepPlan) !== receipt.plan_revision) {
      fail('EXECUTE_PREFLIGHT_STALE', 'repair bookkeeping changed the active step plan unexpectedly.');
    }
  }

  const blockedRepairResult = receipt.mode === 'repair' && outcome === 'blocked';
  let status: 'blocked' | 'completed' | 'in-progress';
  // Repair result status is separate from the progress status of the step.
  // The step is already completed and remains awaiting verification even when
  // this repair execution truthfully records a failed/blocked command.
  if (blockedRepairResult) status = 'completed';
  else if (outcome === 'blocked') status = 'blocked';
  else if (receipt.mode === 'repair' || (stepPlan.step.review_checkpoint === 'not-required' && !dynamicReviewRequiredForCurrentExecution(current))) status = 'completed';
  else status = 'in-progress';
  const proposal = createTaskStateProposal(current, {
    mode: receipt.mode,
    status,
    evidence_refs: evidenceRefs,
    idempotency_key: resultKey,
    authority_evidence: authority(current, ['active-task-owner', 'scope-admission', 'evidence-admission']),
    ...(note ? { note } : {}),
    ...(receipt.kind === 'execute-step-repair-preflight/v1'
      ? {
        repair_fingerprints: receipt.repair_fingerprints,
        repair_wave_id: receipt.repair_wave_id,
        ...(receipt.controlled_recovery_grant_id === undefined ? {} : { controlled_recovery_grant_id: receipt.controlled_recovery_grant_id }),
      }
      : receipt.repair_fingerprint ? { repair_fingerprint: receipt.repair_fingerprint } : {}),
    change_set_id: receipt.change_set_id,
    ...(claimEvidence === undefined ? {} : { claim_evidence: claimEvidence }),
    execution_result: executionResult,
  });
  return verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

function resolveVerifiedFindings(
  root: string,
  current: CanonicalCurrentTask,
  receipt: StepReviewReceipt,
  options: RuntimeApplyOptions,
): CanonicalCurrentTask | RuntimeResult {
  for (const fingerprint of receipt.admitted_fingerprints) {
    const fresh = readCanonicalCurrentTask(root);
    const finding = fresh.runtimeState.findings.find(item => item.fingerprint === fingerprint);
    if (!finding) fail('FINDING_NOT_FOUND', `review receipt finding ${fingerprint} is not in the current queue.`);
    if (finding.status === 'resolved') continue;
    const key = idempotencyKey('execute-review-resolve', { step_id: current.runtimeState.active_step_id, receipt, fingerprint });
    const proposal = createFindingQueueProposal(fresh, {
      mode: 'repair',
      delta: {
        kind: 'finding-queue',
        action: 'resolve',
        fingerprint,
        evidence_refs: receipt.evidence_refs,
        note: `clean verification for ${current.runtimeState.active_step_id}`,
      },
      idempotency_key: key,
      authority_evidence: authority(fresh, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission']),
      evidence_refs: receipt.evidence_refs,
    });
    const result = verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
    if (result.status !== 'success' && result.status !== 'no-op') return result;
  }
  return options.dryRun ? current : readCanonicalCurrentTask(root);
}

function previewResolvedFindings(current: CanonicalCurrentTask, fingerprints: readonly string[]): CanonicalCurrentTask {
  const pending = new Set(fingerprints.filter(fingerprint =>
    current.runtimeState.findings.some(item => item.fingerprint === fingerprint && item.status !== 'resolved')));
  const findingQueueRevision = current.runtimeState.finding_queue_revision + pending.size;
  return {
    ...current,
    sourceTuple: { ...current.sourceTuple, finding_queue_revision: findingQueueRevision },
    runtimeState: {
      ...current.runtimeState,
      finding_queue_revision: findingQueueRevision,
      findings: current.runtimeState.findings.map(item => pending.has(item.fingerprint)
        ? { ...item, status: 'resolved' as const }
        : item),
    },
  };
}

export function completeReviewedStep(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'complete-reviewed-step input');
  exactKeys(source, ['step_id', 'note'], 'complete-reviewed-step input');
  const stepId = text(source.step_id, 'step_id', 128);
  if (!SAFE_KEY_PATTERN.test(stepId)) fail('EXECUTE_ADAPTER_INPUT_INVALID', 'step_id is invalid.');
  const note = nullableText(source.note, 'note');

  let current = readCanonicalCurrentTask(root);
  const replay = currentDefinitionExecutionLog(current).find(item => {
    if ('action' in item || item.step_id !== stepId || !item.review_receipt) return false;
    const key = idempotencyKey('execute-reviewed-step', {
      step_id: stepId,
      review_receipt: item.review_receipt,
      note,
    });
    return item.idempotency_key === key && hasAppliedProposal(current, key);
  });
  if (replay && !('action' in replay)) {
    return semanticNoOp(current, replay.idempotency_key, 'This exact reviewed-step completion was already committed.', options);
  }
  const pending = current.runtimeState.pending_review_result;
  let reviewReceipt: StepReviewReceipt;
  if (pending) {
    if (pending.verdict !== 'clean') {
      fail('CLEAN_REVIEW_REQUIRED', `complete-reviewed-step requires clean; current review verdict is ${pending.verdict}.`);
    }
    const reviewedExecution = currentDefinitionExecutionLog(current).map(item => 'action' in item
      ? item
      : current.runtimeState.scope_amendment_pending_review_step_id === pending.step_id && item.idempotency_key === pending.execution_id
        ? item
        : cumulativeReviewExecution(current, item)).find((item): item is StepExecutionLogEntry =>
      !('action' in item) && item.idempotency_key === pending.execution_id,
    );
    if (!reviewedExecution?.execution_result
      || reviewedExecution.change_set_id !== pending.change_set_id
      || reviewedExecution.execution_result.review_target.revision !== pending.review_target_revision) {
      fail('REVIEW_TARGET_CONFLICT', 'canonical clean review no longer binds its Runtime-recorded execution target.');
    }
    const currentTarget = captureReviewTarget(root, reviewedExecution.execution_result.review_target.entries.map(item => item.path));
    if (currentTarget.revision !== pending.review_target_revision) {
      fail('REVIEW_TARGET_STALE', 'product files changed after the clean review was recorded.');
    }
    const repairLogs = currentDefinitionExecutionLog(current).filter((item): item is StepExecutionLogEntry =>
      !('action' in item) && item.step_id === stepId && item.mode === 'repair',
    );
    const repaired = [...new Set(repairLogs.flatMap(item => [
      ...(item.repair_fingerprints ?? []),
      ...(item.repair_fingerprint ? [item.repair_fingerprint] : []),
    ]))];
    reviewReceipt = {
      cycle_id: pending.cycle_id,
      cycle_phase: pending.cycle_phase,
      change_set_id: pending.change_set_id,
      review_target_revision: pending.review_target_revision,
      verdict: 'clean',
      admitted_fingerprints: repaired,
      evidence_refs: [...pending.evidence_refs],
    };
  } else {
    fail('CLEAN_REVIEW_REQUIRED', 'complete-reviewed-step requires a canonical pending clean review result.');
  }
  const resultKey = idempotencyKey('execute-reviewed-step', { step_id: stepId, review_receipt: reviewReceipt, note });
  if (hasAppliedProposal(current, resultKey)) {
    return semanticNoOp(current, resultKey, 'This exact reviewed-step completion was already committed.', options);
  }
  assertExecutableTask(current);
  const priorExecution = currentDefinitionExecutionLog(current).some(item =>
    !('action' in item)
    && item.step_id === stepId
    && item.idempotency_key.startsWith('execute-step-result-'),
  );
  if (!priorExecution) fail('EXECUTE_RESULT_REQUIRED', 'complete-reviewed-step requires a prior semantic record-step-result for this step.');
  const retainedReview = current.runtimeState.active_step_id !== stepId
    && current.runtimeState.scope_amendment_pending_review_step_id === stepId;
  if (current.runtimeState.active_step_id !== stepId && !retainedReview) {
    fail('ACTIVE_STEP_CONFLICT', `complete-reviewed-step targets ${stepId}, but the current active step is ${current.runtimeState.active_step_id}.`);
  }
  if (retainedReview) {
    assertExecutableTask(current);
    const proposal = createRetainedReviewConsumptionProposal(current, {
      step_id: stepId,
      review_receipt: reviewReceipt,
      evidence_refs: [...reviewReceipt.evidence_refs],
      idempotency_key: resultKey,
      authority_evidence: authority(current, ['active-task-owner', 'scope-admission', 'evidence-admission']),
    });
    return verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
  }
  const stepPlan = currentStepPlan(current);
  if (reviewReceipt.cycle_id !== current.runtimeState.review_cycle.id) {
    fail('REVIEW_CYCLE_CONFLICT', 'review receipt does not belong to the current Runtime review cycle.');
  }

  const repairLogs = currentDefinitionExecutionLog(current).filter((item): item is StepExecutionLogEntry =>
    !('action' in item) && item.step_id === stepId && item.mode === 'repair',
  );
  const repairedFingerprints = [...new Set(repairLogs.flatMap(item => [
    ...(item.repair_fingerprints ?? []),
    ...(item.repair_fingerprint ? [item.repair_fingerprint] : []),
  ]))];
  assertExactResultSet(reviewReceipt.admitted_fingerprints, repairedFingerprints, 'review_receipt.admitted_fingerprints');
  if (repairLogs.length > 0) {
    if (reviewReceipt.cycle_phase !== 'verification') {
      fail('REVIEW_VERIFICATION_REQUIRED', 'a repaired step requires a verification review receipt.');
    }
    const repairTargets = [...new Set(repairLogs.flatMap(item => item.change_set_id ? [item.change_set_id] : []))];
    if (repairTargets.length !== 1 || repairTargets[0] !== reviewReceipt.change_set_id) {
      fail('REPAIR_CHANGE_SET_CONFLICT', 'verification must cover the exact repaired logical change set.');
    }
  } else if (reviewReceipt.cycle_phase !== 'discovery') {
    fail('REVIEW_PHASE_INVALID', 'an unrepaired step requires a discovery review receipt.');
  }

  const openFindings = current.runtimeState.findings.filter(item => ['admitted', 'in-progress'].includes(item.status));
  const unverifiedOpen = openFindings.filter(item => !reviewReceipt.admitted_fingerprints.includes(item.fingerprint));
  if (unverifiedOpen.length > 0) {
    fail('REVIEW_CONVERGENCE_REQUIRED', `open findings are not covered by the clean review receipt: ${unverifiedOpen.map(item => item.fingerprint).join(', ')}.`);
  }
  const claimEvidence = current.runtimeState.claim_evidence;
  const resolution = resolveTaskStep(current.body, stepId);
  const finalEvidenceContext = hasRemainingCorrectionTargets(current, stepId)
    ? { root, current, due_step_id: stepId } : { root, current };
  if (resolution.next === null && (!claimEvidence || !evaluateClaimEvidence(claimEvidence, finalEvidenceContext).validation_complete)) {
    fail('CLAIM_EVIDENCE_INCOMPLETE', 'the final step cannot complete until every frozen acceptance-evidence slot has evidence.');
  }

  const sourceRevision = current.sourceTuple.revision;
  if (reviewReceipt.admitted_fingerprints.length > 0) {
    const resolved = resolveVerifiedFindings(root, current, reviewReceipt, options);
    if ('status' in resolved) return resolved;
    current = resolved;
  }
  const previewedFindingResolution = options.dryRun === true && reviewReceipt.admitted_fingerprints.some(fingerprint =>
    current.runtimeState.findings.some(item => item.fingerprint === fingerprint && item.status !== 'resolved'));
  if (previewedFindingResolution) current = previewResolvedFindings(current, reviewReceipt.admitted_fingerprints);
  const evidenceRefs = [...reviewReceipt.evidence_refs];
  const proposal = createTaskStateProposal(current, {
    mode: 'default',
    status: 'completed',
    evidence_refs: evidenceRefs,
    idempotency_key: resultKey,
    authority_evidence: authority(current, ['active-task-owner', 'scope-admission', 'evidence-admission']),
    review_receipt: reviewReceipt,
    change_set_id: reviewReceipt.change_set_id,
    ...(note ? { note } : {}),
    ...(claimEvidence === undefined ? {} : { claim_evidence: claimEvidence }),
  });
  if (previewedFindingResolution) {
    if (readCanonicalCurrentTask(root).sourceTuple.revision !== sourceRevision) {
      fail('SOURCE_TUPLE_MISMATCH', 'CURRENT_TASK changed during reviewed-step dry-run; obtain fresh canonical state.');
    }
    const preview = new GovernanceTransactionKernel(root, () => current).apply(proposal, options);
    return preview.status === 'success'
      ? { ...preview, resulting_revision: undefined, message: 'Finding resolutions and reviewed-step completion validated against an in-memory dry-run state; no files were written.' }
      : preview;
  }
  return verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

export type ExecuteStepAdapterCliArguments = {
  command: ExecuteStepAdapterCommand;
  root: string;
  dryRun: boolean;
};

export function parseExecuteStepAdapterCli(argv: string[]): ExecuteStepAdapterCliArguments {
  const [command, ...rest] = argv;
  if (!EXECUTE_STEP_ADAPTER_COMMANDS.includes(command as ExecuteStepAdapterCommand)) {
    throw new Error(`Usage: vnext-runtime <${EXECUTE_STEP_ADAPTER_COMMANDS.join('|')}> --root <path> [--dry-run] (semantic JSON on stdin)`);
  }
  let root = process.cwd();
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown execute-step adapter argument: ${arg}`);
  }
  if (!root) throw new Error('--root requires a path.');
  return { command: command as ExecuteStepAdapterCommand, root, dryRun };
}

function readSemanticStdin(command: ExecuteStepAdapterCommand): unknown {
  const raw = !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '';
  if (!raw.trim()) throw new Error(`${command} requires semantic JSON on stdin.`);
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${command} stdin must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateInstalledRuntime(root: string): void {
  const runtimeManifest = path.join(path.resolve(root), ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'), 'package.json');
  if (fs.existsSync(runtimeManifest)) validateVNextRuntimeContract(root, true);
}

export async function runExecuteStepAdapterCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    validateRuntimeEnvironment();
    const args = parseExecuteStepAdapterCli(argv);
    validateInstalledRuntime(args.root);
    const input = readSemanticStdin(args.command);
    let result: ExecuteStepAdapterResult;
    switch (args.command) {
      case 'preflight-step':
        result = preflightStep(args.root, input);
        break;
      case 'resume-preflight':
        result = resumePreflight(args.root, input);
        break;
      case 'reconcile-preflight':
        result = reconcilePreflight(args.root, input, { dryRun: args.dryRun });
        break;
      case 'extend-preflight':
        result = extendPreflight(args.root, input, { dryRun: args.dryRun });
        break;
      case 'artifact-checkpoints':
        exactKeys(record(input, 'artifact-checkpoints'), [], 'artifact-checkpoints');
        result = listArtifactCheckpoints(args.root);
        break;
      case 'apply-artifact-restore': {
        const source = record(input, 'apply-artifact-restore');
        exactKeys(source, ['preflight_receipt'], 'apply-artifact-restore');
        const receipt = normalizePreflightReceipt(source.preflight_receipt);
        const current = readCanonicalCurrentTask(args.root);
        assertCurrentReceipt(args.root, current, currentStepPlan(current), receipt);
        result = executeConfirmedArtifactRestore(args.root, current.sourceTuple.revision, receipt.step_id, receipt.candidate_paths, args.dryRun);
        break;
      }
      case 'evidence-context':
        result = evidenceContext(args.root, input);
        break;
      case 'replace-validation':
        result = replaceValidation(args.root, input, { dryRun: args.dryRun });
        break;
      case 'retry-step':
        result = retryStep(args.root,input,{dryRun:args.dryRun});
        break;
      case 'begin-repair':
        result = beginRepair(args.root, input, { dryRun: args.dryRun });
        break;
      case 'record-step-result':
        result = recordStepResult(args.root, input, { dryRun: args.dryRun });
        break;
      case 'complete-reviewed-step':
        result = completeReviewedStep(args.root, input, { dryRun: args.dryRun });
        break;
    }
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'blocked' || result.status === 'conflict' ? 2 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
