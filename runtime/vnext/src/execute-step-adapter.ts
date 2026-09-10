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
  MAX_REPAIR_ATTEMPTS,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  VNextRuntimeError,
  applyVNextRuntimeProposal,
  captureReviewTarget,
  createReviewChangeDelta,
  createFindingQueueProposal,
  createTaskStateProposal,
  readCanonicalCurrentTask,
  readDraftDefinitionFromBody,
  validateRuntimeEnvironment,
  validateRuntimeReviewTarget,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type CanonicalCurrentTask,
  type ClaimEvidenceRecord,
  type RuntimeApplyOptions,
  type RuntimeResult,
  type ReviewTarget,
  type StepExecutionResult,
  type StepExecutionResultStatus,
  type StepExecutionLogEntry,
  type StepReviewReceipt,
} from './kernel';
import {
  auditCommandMutation,
  evaluateCommandWriteFootprint,
  evaluateMutationScope,
  mutationScopePatternMatchesPath,
  parseMutationScope,
  type MutationTransformationKind,
} from './mutation-scope';
import { resolveTaskStep, type TaskStepDefinition } from './task-steps';

export const EXECUTE_STEP_ADAPTER_COMMANDS = [
  'preflight-step',
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
  mutation_scope: string[];
  validation: string[];
  commands: PlannedCommand[];
};

export type ExecuteStepPreflightReceipt = {
  kind: 'execute-step-preflight/v1';
  task_id: string;
  document_id: string;
  source_revision: string;
  step_id: string;
  plan_revision: string;
  mode: ExecuteStepMode;
  candidate_paths: string[];
  repair_fingerprint: string | null;
  change_set_id: string;
  review_base: ReviewTarget;
};

export type ExecuteStepRepairPreflightReceipt = {
  kind: 'execute-step-repair-preflight/v1';
  task_id: string;
  document_id: string;
  source_revision: string;
  step_id: string;
  plan_revision: string;
  mode: 'repair';
  candidate_paths: string[];
  repair_fingerprints: string[];
  repair_wave_id: string;
  change_set_id: string;
  review_target_paths: string[];
  review_id: string;
  review_base: ReviewTarget;
};

type AnyExecuteStepPreflightReceipt = ExecuteStepPreflightReceipt | ExecuteStepRepairPreflightReceipt;

export type ExecuteStepPreflightResult = {
  status: 'pass';
  operation_kind: 'execute-step-preflight';
  committed: false;
  read_back_verified: true;
  current_step: {
    id: string;
    description: string;
    purpose: string;
    mutation_scope: string[];
    commands: PlannedCommand[];
    validation: string[];
    review_checkpoint: 'required' | 'not-required';
  };
  receipt: ExecuteStepPreflightReceipt;
};

export type ExecuteStepRepairPreflightResult = Omit<ExecuteStepPreflightResult, 'operation_kind' | 'receipt'> & {
  operation_kind: 'execute-step-repair-preflight';
  receipt: ExecuteStepRepairPreflightReceipt;
};

export type ExecuteStepAdapterResult = RuntimeResult | ExecuteStepPreflightResult | ExecuteStepRepairPreflightResult;

const MAX_ITEMS = 256;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

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

function assertPathsAdmitted(current: CanonicalCurrentTask, stepPlan: StepPlan, paths: readonly string[], location: string): void {
  if (paths.length === 0) return;
  const scopeResult = evaluateMutationScope(parseMutationScope(current.body, current.sourceTuple.revision), {
    changed_paths: [...paths],
  });
  if (scopeResult.status !== 'pass') {
    fail('EXECUTE_SCOPE_BLOCKED', `${location} is outside confirmed task scope: ${scopeResult.blockers.join(' ')}`);
  }
  const outsideStep = paths.filter(file => !stepAdmitsExactPath(file, stepPlan.mutation_scope));
  if (outsideStep.length > 0) {
    fail('EXECUTE_STEP_SCOPE_BLOCKED', `${location} is outside current step scope: ${outsideStep.join(', ')}.`);
  }
}

function assertCommandPlansAdmitted(current: CanonicalCurrentTask, stepPlan: StepPlan): void {
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
    mutation_scope: stepPlan.mutation_scope,
    validation: stepPlan.validation,
    commands: stepPlan.commands,
  });
}

function changeSetId(current: CanonicalCurrentTask, stepId: string): string {
  return `change-set-${digest({
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    step_id: stepId,
    review_cycle_id: current.runtimeState.review_cycle.id,
  }).slice(0, 40)}`;
}

function normalizePreflightReceipt(value: unknown): AnyExecuteStepPreflightReceipt {
  const source = record(value, 'preflight_receipt');
  if (source.kind === 'execute-step-repair-preflight/v1') {
    exactKeys(source, [
      'kind',
      'task_id',
      'document_id',
      'source_revision',
      'step_id',
      'plan_revision',
      'mode',
      'candidate_paths',
      'repair_fingerprints',
      'repair_wave_id',
      'change_set_id',
      'review_target_paths',
      'review_id',
      'review_base',
    ], 'preflight_receipt');
    if (source.mode !== 'repair') fail('EXECUTE_ADAPTER_INPUT_INVALID', 'repair preflight receipt mode must be repair.');
    const sourceRevision = text(source.source_revision, 'preflight_receipt.source_revision', 64);
    const planRevision = text(source.plan_revision, 'preflight_receipt.plan_revision', 64);
    if (!SHA256_PATTERN.test(sourceRevision) || !SHA256_PATTERN.test(planRevision)) fail('EXECUTE_ADAPTER_INPUT_INVALID', 'preflight receipt revisions must be SHA-256 values.');
    return {
      kind: 'execute-step-repair-preflight/v1',
      task_id: text(source.task_id, 'preflight_receipt.task_id', 128),
      document_id: text(source.document_id, 'preflight_receipt.document_id', 128),
      source_revision: sourceRevision,
      step_id: text(source.step_id, 'preflight_receipt.step_id', 128),
      plan_revision: planRevision,
      mode: 'repair',
      candidate_paths: pathList(source.candidate_paths, 'preflight_receipt.candidate_paths', true),
      repair_fingerprints: textList(source.repair_fingerprints, 'preflight_receipt.repair_fingerprints', false),
      repair_wave_id: text(source.repair_wave_id, 'preflight_receipt.repair_wave_id', 128),
      change_set_id: text(source.change_set_id, 'preflight_receipt.change_set_id', 128),
      review_target_paths: pathList(source.review_target_paths, 'preflight_receipt.review_target_paths', true),
      review_id: text(source.review_id, 'preflight_receipt.review_id', 128),
      review_base: validateRuntimeReviewTarget(source.review_base, 'preflight_receipt.review_base'),
    };
  }
  exactKeys(source, [
    'kind',
    'task_id',
    'document_id',
    'source_revision',
    'step_id',
    'plan_revision',
    'mode',
    'candidate_paths',
    'repair_fingerprint',
    'change_set_id',
    'review_base',
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
    task_id: text(source.task_id, 'preflight_receipt.task_id', 128),
    document_id: text(source.document_id, 'preflight_receipt.document_id', 128),
    source_revision: sourceRevision,
    step_id: text(source.step_id, 'preflight_receipt.step_id', 128),
    plan_revision: planRevision,
    mode,
    candidate_paths: pathList(source.candidate_paths, 'preflight_receipt.candidate_paths', true),
    repair_fingerprint: nullableText(source.repair_fingerprint, 'preflight_receipt.repair_fingerprint', 128),
    change_set_id: text(source.change_set_id, 'preflight_receipt.change_set_id', 128),
    review_base: validateRuntimeReviewTarget(source.review_base, 'preflight_receipt.review_base'),
  };
}

function assertCurrentReceipt(current: CanonicalCurrentTask, stepPlan: StepPlan, receipt: AnyExecuteStepPreflightReceipt): void {
  if (receipt.task_id !== current.runtimeState.task_id || receipt.document_id !== current.sourceTuple.document_id) {
    fail('EXECUTE_PREFLIGHT_IDENTITY_CONFLICT', 'preflight receipt does not identify the current task document.');
  }
  if (receipt.source_revision !== current.sourceTuple.revision) {
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
  if (receipt.step_id !== current.runtimeState.active_step_id || receipt.plan_revision !== stepPlanRevision(stepPlan)) {
    fail('EXECUTE_PREFLIGHT_STALE', 'the active step or its executable plan changed after preflight.');
  }
  if (receipt.kind === 'execute-step-repair-preflight/v1') {
    if (current.runtimeState.pending_review_result?.review_id !== receipt.review_id
      || current.runtimeState.pending_review_result.change_set_id !== receipt.change_set_id) {
      fail('EXECUTE_PREFLIGHT_STALE', 'the repair review or Runtime-owned change set changed after preflight.');
    }
  } else if (receipt.change_set_id !== changeSetId(current, receipt.step_id)) {
    fail('EXECUTE_PREFLIGHT_STALE', 'the Runtime-owned change set identity changed after preflight.');
  }
}

function findingAdmissionWaveId(reviewId: string): string {
  return `finding-wave-${digest(reviewId).slice(0, 32)}`;
}

function repairWaveId(reviewId: string, fingerprints: readonly string[]): string {
  return `repair-wave-${digest({ review_id: reviewId, fingerprints: [...fingerprints].sort() }).slice(0, 32)}`;
}

export function beginRepair(
  root: string,
  input: unknown,
  options: RuntimeApplyOptions = {},
): ExecuteStepRepairPreflightResult {
  const source = record(input, 'begin-repair input');
  exactKeys(source, ['candidate_paths'], 'begin-repair input');
  const candidatePaths = pathList(source.candidate_paths, 'candidate_paths', false);
  let current = readCanonicalCurrentTask(root);
  assertExecutableTask(current);
  const pending = current.runtimeState.pending_review_result;
  if (!pending || pending.verdict !== 'findings') {
    fail('REVIEW_FINDINGS_REQUIRED', 'begin-repair requires the current durable review result to contain findings.');
  }
  const reviewedExecution = current.runtimeState.execution_log.find((item): item is StepExecutionLogEntry =>
    !('action' in item) && item.idempotency_key === pending.execution_id,
  );
  if (!reviewedExecution?.execution_result
    || reviewedExecution.execution_result.change_set_id !== pending.change_set_id
    || reviewedExecution.execution_result.review_target.revision !== pending.review_target_revision) {
    fail('REVIEW_TARGET_CONFLICT', 'begin-repair requires the Runtime-recorded reviewed execution target.');
  }
  const stepPlan = currentStepPlan(current);
  assertPathsAdmitted(current, stepPlan, candidatePaths, 'candidate_paths');
  assertCommandPlansAdmitted(current, stepPlan);
  assertExactCommandWritesCovered(stepPlan, candidatePaths);

  const admissionWaveId = findingAdmissionWaveId(pending.review_id);
  for (const candidate of pending.findings) {
    if (!candidatePaths.includes(candidate.file)) {
      fail('EXECUTE_PREFLIGHT_SCOPE_CONFLICT', `candidate_paths must include review finding path ${candidate.file}.`);
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
          review_cycle_id: current.runtimeState.review_cycle.id,
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

  const fingerprints = [...new Set([
    ...pending.unresolved_fingerprints,
    ...pending.findings.map(item => item.fingerprint),
  ])].sort();
  for (const fingerprint of fingerprints) {
    const finding = current.runtimeState.findings.find(item => item.fingerprint === fingerprint);
    if (!options.dryRun && (!finding || !['admitted', 'in-progress'].includes(finding.status))) {
      fail('FINDING_ADMISSION_REQUIRED', `review finding ${fingerprint} is not repairable.`);
    }
    if (!options.dryRun && finding!.repair_attempts >= finding!.max_repair_attempts) {
      fail('REPAIR_BUDGET_EXHAUSTED', `finding ${fingerprint} has exhausted its repair budget.`);
    }
  }
  const waveId = repairWaveId(pending.review_id, fingerprints);
  const reviewTargetPaths = [...new Set([
    ...reviewedExecution.execution_result.review_target.entries.map(item => item.path),
    ...candidatePaths,
  ])];
  const receipt: ExecuteStepRepairPreflightReceipt = {
    kind: 'execute-step-repair-preflight/v1',
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: stepPlan.step.id,
    plan_revision: stepPlanRevision(stepPlan),
    mode: 'repair',
    candidate_paths: candidatePaths,
    repair_fingerprints: fingerprints,
    repair_wave_id: waveId,
    change_set_id: pending.change_set_id,
    review_target_paths: reviewedExecution.execution_result.review_target.entries.map(item => item.path),
    review_id: pending.review_id,
    review_base: captureReviewTarget(root, reviewTargetPaths),
  };
  return {
    status: 'pass',
    operation_kind: 'execute-step-repair-preflight',
    committed: false,
    read_back_verified: true,
    current_step: {
      id: stepPlan.step.id,
      description: stepPlan.step.description,
      purpose: stepPlan.step.purpose!,
      mutation_scope: stepPlan.mutation_scope,
      commands: stepPlan.commands,
      validation: stepPlan.validation,
      review_checkpoint: stepPlan.step.review_checkpoint!,
    },
    receipt,
  };
}

export function preflightStep(root: string, input: unknown): ExecuteStepPreflightResult {
  const source = record(input, 'preflight-step input');
  exactKeys(source, ['candidate_paths'], 'preflight-step input');
  const candidatePaths = pathList(source.candidate_paths, 'candidate_paths', true);

  const current = readCanonicalCurrentTask(root);
  assertExecutableTask(current);
  const stepPlan = currentStepPlan(current);
  assertPathsAdmitted(current, stepPlan, candidatePaths, 'candidate_paths');
  assertCommandPlansAdmitted(current, stepPlan);
  assertExactCommandWritesCovered(stepPlan, candidatePaths);

  const receipt: ExecuteStepPreflightReceipt = {
    kind: 'execute-step-preflight/v1',
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: stepPlan.step.id,
    plan_revision: stepPlanRevision(stepPlan),
    mode: 'default',
    candidate_paths: candidatePaths,
    repair_fingerprint: null,
    change_set_id: changeSetId(current, stepPlan.step.id),
    review_base: captureReviewTarget(root, candidatePaths),
  };
  return {
    status: 'pass',
    operation_kind: 'execute-step-preflight',
    committed: false,
    read_back_verified: true,
    current_step: {
      id: stepPlan.step.id,
      description: stepPlan.step.description,
      purpose: stepPlan.step.purpose!,
      mutation_scope: stepPlan.mutation_scope,
      commands: stepPlan.commands,
      validation: stepPlan.validation,
      review_checkpoint: stepPlan.step.review_checkpoint!,
    },
    receipt,
  };
}

type CommandResult = {
  command: string;
  status: StepExecutionResultStatus;
  observed_repo_writes: string[];
  evidence_refs: string[];
};
type ValidationResult = {
  validation: string;
  status: StepExecutionResultStatus;
  evidence_refs: string[];
};
type AcceptanceEvidence = {
  acceptance: string;
  evidence_refs: string[];
};

function resultStatus(value: unknown, location: string): StepExecutionResultStatus {
  if (value !== 'passed' && value !== 'failed' && value !== 'blocked' && value !== 'not-run') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be passed, failed, blocked, or not-run.`);
  }
  return value;
}

function normalizeCommandResults(value: unknown): CommandResult[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'command_results must be a bounded array.');
  }
  const results = value.map((item, index) => {
    const location = `command_results[${index}]`;
    const source = record(item, location);
    exactKeys(source, ['command', 'status', 'observed_repo_writes', 'evidence_refs'], location);
    const status = resultStatus(source.status, `${location}.status`);
    const observedRepoWrites = pathList(source.observed_repo_writes, `${location}.observed_repo_writes`, true);
    if (status === 'not-run' && observedRepoWrites.length > 0) {
      fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location}.not-run command must not report repository writes.`);
    }
    return {
      command: text(source.command, `${location}.command`),
      status,
      observed_repo_writes: observedRepoWrites,
      evidence_refs: textList(source.evidence_refs, `${location}.evidence_refs`, status === 'not-run'),
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
    exactKeys(source, ['validation', 'status', 'evidence_refs'], location);
    const status = resultStatus(source.status, `${location}.status`);
    return {
      validation: text(source.validation, `${location}.validation`),
      status,
      evidence_refs: textList(source.evidence_refs, `${location}.evidence_refs`, status === 'not-run'),
    };
  });
  if (new Set(results.map(item => item.validation)).size !== results.length) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'validation_results must not contain duplicate validations.');
  }
  return results;
}

function normalizeAcceptanceEvidence(value: unknown): AcceptanceEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'acceptance_evidence must be a bounded array.');
  }
  const results = value.map((item, index) => {
    const location = `acceptance_evidence[${index}]`;
    const source = record(item, location);
    exactKeys(source, ['acceptance', 'evidence_refs'], location);
    return {
      acceptance: text(source.acceptance, `${location}.acceptance`),
      evidence_refs: textList(source.evidence_refs, `${location}.evidence_refs`, false),
    };
  });
  if (new Set(results.map(item => item.acceptance)).size !== results.length) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'acceptance_evidence must not contain duplicate acceptance text.');
  }
  return results;
}

function plannedAcceptance(current: CanonicalCurrentTask): string[] {
  const value = readDraftDefinitionFromBody(current.body).acceptance;
  const items = value.replace(/\r\n?/gu, '\n').split('\n').map(line =>
    line.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?/u, '').trim(),
  ).filter(Boolean);
  if (items.length === 0 || new Set(items).size !== items.length) {
    fail('CLAIM_EVIDENCE_PLAN_INVALID', 'canonical acceptance must be a non-empty list without duplicates.');
  }
  return items;
}

function updateClaimEvidence(current: CanonicalCurrentTask, evidence: AcceptanceEvidence[]): ClaimEvidenceRecord[] | undefined {
  if (!current.runtimeState.claim_evidence_required && current.runtimeState.claim_evidence === undefined) return undefined;
  const plan = current.runtimeState.claim_evidence ?? [];
  const acceptance = plannedAcceptance(current);
  const acceptanceClaims = plan.filter(item => item.claim_kind === 'acceptance');
  if (acceptanceClaims.length !== acceptance.length || acceptanceClaims.some(item => item.slots.length !== 1)) {
    fail('CLAIM_EVIDENCE_PLAN_INVALID', 'execute-step semantic evidence requires one frozen acceptance claim slot per canonical acceptance item.');
  }
  const evidenceByAcceptance = new Map(evidence.map(item => [item.acceptance, item.evidence_refs]));
  for (const item of evidence) {
    if (!acceptance.includes(item.acceptance)) {
      fail('CLAIM_EVIDENCE_PLAN_CONFLICT', `acceptance_evidence is not in the confirmed task: ${item.acceptance}`);
    }
  }
  let acceptanceIndex = 0;
  return plan.map(item => {
    if (item.claim_kind !== 'acceptance') {
      return { ...item, slots: item.slots.map(slot => ({ ...slot, evidence_refs: [...slot.evidence_refs] })) };
    }
    const refs = evidenceByAcceptance.get(acceptance[acceptanceIndex++]);
    if (!refs) return { ...item, slots: item.slots.map(slot => ({ ...slot, evidence_refs: [...slot.evidence_refs] })) };
    return {
      ...item,
      slots: item.slots.map(slot => ({
        ...slot,
        disposition: 'newly-executed' as const,
        evidence_refs: [...new Set([...slot.evidence_refs, ...refs])],
      })),
    };
  });
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

function assertCommandResults(current: CanonicalCurrentTask, stepPlan: StepPlan, results: CommandResult[]): void {
  assertExactResultSet(results.map(item => item.command), stepPlan.commands.map(item => item.command), 'command_results');
  const scope = parseMutationScope(current.body, current.sourceTuple.revision);
  for (const result of results) {
    const planned = stepPlan.commands.find(item => item.command === result.command)!;
    if (result.status === 'not-run') continue;
    assertObservedWithinExpected(planned, result.observed_repo_writes);
    assertPathsAdmitted(current, stepPlan, result.observed_repo_writes, `observed writes for command "${result.command}"`);
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
    'actual_changed_paths',
    'command_results',
    'validation_results',
    'acceptance_evidence',
    'outcome',
    'note',
  ], 'record-step-result input');
  const receipt = normalizePreflightReceipt(source.preflight_receipt);
  const actualChangedPaths = pathList(source.actual_changed_paths, 'actual_changed_paths', true);
  const commandResults = normalizeCommandResults(source.command_results);
  const validationResults = normalizeValidationResults(source.validation_results);
  const acceptanceEvidence = normalizeAcceptanceEvidence(source.acceptance_evidence);
  if (source.outcome !== 'implemented' && source.outcome !== 'blocked') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'outcome must be implemented or blocked.');
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
  assertCurrentReceipt(current, stepPlan, receipt);
  assertPathsAdmitted(current, stepPlan, receipt.candidate_paths, 'preflight_receipt.candidate_paths');
  assertPathsAdmitted(current, stepPlan, actualChangedPaths, 'actual_changed_paths');
  assertCommandResults(current, stepPlan, commandResults);
  assertValidationResults(stepPlan, validationResults);
  if (outcome === 'implemented' && commandResults.some(item => item.status !== 'passed')) {
    fail('EXECUTE_RESULT_BLOCKED', 'implemented requires every planned command to pass.');
  }
  if (outcome === 'implemented' && validationResults.some(item => item.status !== 'passed')) {
    fail('EXECUTE_RESULT_BLOCKED', 'implemented requires every planned validation to pass.');
  }
  if (outcome === 'blocked' && note === null) {
    fail('EXECUTE_RESULT_BLOCKED', 'blocked requires a concise blocker in note.');
  }
  if (outcome === 'blocked' && ![...commandResults, ...validationResults].some(item => item.status === 'failed' || item.status === 'blocked')) {
    fail('EXECUTE_RESULT_BLOCKED', 'blocked requires at least one failed or blocked command or validation result.');
  }

  if (receipt.kind === 'execute-step-repair-preflight/v1') {
    const pending = current.runtimeState.pending_review_result;
    const priorExecution = pending && current.runtimeState.execution_log.find((item): item is StepExecutionLogEntry =>
      !('action' in item) && item.idempotency_key === pending.execution_id,
    );
    if (!pending || !priorExecution?.execution_result
      || pending.review_id !== receipt.review_id
      || pending.change_set_id !== receipt.change_set_id
      || priorExecution.execution_result.change_set_id !== receipt.change_set_id
      || digest(priorExecution.execution_result.review_target.entries.map(item => item.path)) !== digest(receipt.review_target_paths)) {
      fail('REVIEW_TARGET_CONFLICT', 'repair result no longer binds the Runtime-recorded reviewed change set.');
    }
  }

  const evidenceRefs = allEvidenceRefs(commandResults, validationResults, acceptanceEvidence);
  const claimEvidence = updateClaimEvidence(current, acceptanceEvidence);
  const executionResult: StepExecutionResult = {
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
    })),
    validation_results: validationResults.map(item => ({ ...item, evidence_refs: [...item.evidence_refs] })),
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

  let status: 'blocked' | 'completed' | 'in-progress';
  if (outcome === 'blocked') status = 'blocked';
  else if (receipt.mode === 'repair' || stepPlan.step.review_checkpoint === 'not-required') status = 'completed';
  else status = 'in-progress';
  const proposal = createTaskStateProposal(current, {
    mode: receipt.mode,
    status,
    evidence_refs: evidenceRefs,
    idempotency_key: resultKey,
    authority_evidence: authority(current, ['active-task-owner', 'scope-admission', 'evidence-admission']),
    ...(note ? { note } : {}),
    ...(receipt.kind === 'execute-step-repair-preflight/v1'
      ? { repair_fingerprints: receipt.repair_fingerprints, repair_wave_id: receipt.repair_wave_id }
      : receipt.repair_fingerprint ? { repair_fingerprint: receipt.repair_fingerprint } : {}),
    change_set_id: receipt.change_set_id,
    ...(claimEvidence === undefined ? {} : { claim_evidence: claimEvidence }),
    execution_result: executionResult,
  });
  return verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

function claimEvidenceComplete(records: readonly ClaimEvidenceRecord[]): boolean {
  return records.length > 0 && records.every(item => item.slots.length > 0 && item.slots.every(slot =>
    ['existing', 'reused', 'newly-executed'].includes(slot.disposition) && slot.evidence_refs.length > 0,
  ));
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
    if (options.dryRun) return current;
  }
  return readCanonicalCurrentTask(root);
}

export function completeReviewedStep(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'complete-reviewed-step input');
  exactKeys(source, ['step_id', 'note'], 'complete-reviewed-step input');
  const stepId = text(source.step_id, 'step_id', 128);
  if (!SAFE_KEY_PATTERN.test(stepId)) fail('EXECUTE_ADAPTER_INPUT_INVALID', 'step_id is invalid.');
  const note = nullableText(source.note, 'note');

  let current = readCanonicalCurrentTask(root);
  const replay = current.runtimeState.execution_log.find(item => {
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
    const reviewedExecution = current.runtimeState.execution_log.find((item): item is StepExecutionLogEntry =>
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
    const repairLogs = current.runtimeState.execution_log.filter((item): item is StepExecutionLogEntry =>
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
  if (current.runtimeState.active_step_id !== stepId) {
    fail('ACTIVE_STEP_CONFLICT', `complete-reviewed-step targets ${stepId}, but the current active step is ${current.runtimeState.active_step_id}.`);
  }
  const stepPlan = currentStepPlan(current);
  const priorExecution = current.runtimeState.execution_log.some(item =>
    !('action' in item)
    && item.step_id === stepId
    && item.idempotency_key.startsWith('execute-step-result-'),
  );
  if (!priorExecution) fail('EXECUTE_RESULT_REQUIRED', 'complete-reviewed-step requires a prior semantic record-step-result for this step.');
  if (reviewReceipt.cycle_id !== current.runtimeState.review_cycle.id) {
    fail('REVIEW_CYCLE_CONFLICT', 'review receipt does not belong to the current Runtime review cycle.');
  }

  const repairLogs = current.runtimeState.execution_log.filter((item): item is StepExecutionLogEntry =>
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
  if (resolution.next === null && (!claimEvidence || !claimEvidenceComplete(claimEvidence))) {
    fail('CLAIM_EVIDENCE_INCOMPLETE', 'the final step cannot complete until every frozen acceptance-evidence slot has evidence.');
  }

  if (reviewReceipt.admitted_fingerprints.length > 0) {
    const resolved = resolveVerifiedFindings(root, current, reviewReceipt, options);
    if ('status' in resolved) return resolved;
    current = resolved;
  }
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
