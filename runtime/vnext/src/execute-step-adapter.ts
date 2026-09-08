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
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  VNextRuntimeError,
  applyVNextRuntimeProposal,
  createFindingQueueProposal,
  createTaskStateProposal,
  readCanonicalCurrentTask,
  readDraftDefinitionFromBody,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type CanonicalCurrentTask,
  type ClaimEvidenceRecord,
  type RuntimeApplyOptions,
  type RuntimeResult,
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
  diff_target: string | null;
};

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

export type ExecuteStepAdapterResult = RuntimeResult | ExecuteStepPreflightResult;

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

function stepPlanRevision(stepPlan: StepPlan): string {
  return digest({
    step: stepPlan.step,
    mutation_scope: stepPlan.mutation_scope,
    validation: stepPlan.validation,
    commands: stepPlan.commands,
  });
}

function normalizePreflightReceipt(value: unknown): ExecuteStepPreflightReceipt {
  const source = record(value, 'preflight_receipt');
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
    'diff_target',
  ], 'preflight_receipt');
  if (source.kind !== 'execute-step-preflight/v1') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'preflight_receipt.kind must be execute-step-preflight/v1.');
  }
  const mode = source.mode;
  if (mode !== 'default' && mode !== 'repair') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'preflight_receipt.mode must be default or repair.');
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
    diff_target: nullableText(source.diff_target, 'preflight_receipt.diff_target', 512),
  };
}

function assertCurrentReceipt(current: CanonicalCurrentTask, stepPlan: StepPlan, receipt: ExecuteStepPreflightReceipt): void {
  if (receipt.task_id !== current.runtimeState.task_id || receipt.document_id !== current.sourceTuple.document_id) {
    fail('EXECUTE_PREFLIGHT_IDENTITY_CONFLICT', 'preflight receipt does not identify the current task document.');
  }
  if (receipt.source_revision !== current.sourceTuple.revision) {
    fail('EXECUTE_PREFLIGHT_STALE', 'CURRENT_TASK changed after preflight; run preflight-step again before editing or committing.');
  }
  if (receipt.step_id !== current.runtimeState.active_step_id || receipt.plan_revision !== stepPlanRevision(stepPlan)) {
    fail('EXECUTE_PREFLIGHT_STALE', 'the active step or its executable plan changed after preflight.');
  }
}

export function preflightStep(root: string, input: unknown): ExecuteStepPreflightResult {
  const source = record(input, 'preflight-step input');
  exactKeys(source, ['mode', 'candidate_paths', 'repair_fingerprint', 'diff_target'], 'preflight-step input');
  if (source.mode !== 'default' && source.mode !== 'repair') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'mode must be default or repair.');
  }
  const mode = source.mode;
  const candidatePaths = pathList(source.candidate_paths, 'candidate_paths', true);
  const repairFingerprint = nullableText(source.repair_fingerprint, 'repair_fingerprint', 128);
  const diffTarget = nullableText(source.diff_target, 'diff_target', 512);
  if (mode === 'default' && (repairFingerprint !== null || diffTarget !== null)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'default preflight must use null repair_fingerprint and diff_target.');
  }
  if (mode === 'repair' && (repairFingerprint === null || diffTarget === null)) {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'repair preflight requires repair_fingerprint and diff_target.');
  }

  const current = readCanonicalCurrentTask(root);
  assertExecutableTask(current);
  const stepPlan = currentStepPlan(current);
  assertPathsAdmitted(current, stepPlan, candidatePaths, 'candidate_paths');
  assertCommandPlansAdmitted(current, stepPlan);
  if (repairFingerprint !== null) {
    const finding = current.runtimeState.findings.find(item => item.fingerprint === repairFingerprint);
    if (!finding || !['admitted', 'in-progress'].includes(finding.status)) {
      fail('FINDING_ADMISSION_REQUIRED', 'repair_fingerprint is not an admitted current-task finding.');
    }
    if (finding.repair_attempts >= finding.max_repair_attempts) {
      fail('REPAIR_BUDGET_EXHAUSTED', `finding ${repairFingerprint} has exhausted its repair budget.`);
    }
  }

  const receipt: ExecuteStepPreflightReceipt = {
    kind: 'execute-step-preflight/v1',
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: stepPlan.step.id,
    plan_revision: stepPlanRevision(stepPlan),
    mode,
    candidate_paths: candidatePaths,
    repair_fingerprint: repairFingerprint,
    diff_target: diffTarget,
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
  status: 'passed' | 'failed';
  observed_repo_writes: string[];
  evidence_refs: string[];
};
type ValidationResult = {
  validation: string;
  status: 'passed' | 'failed';
  evidence_refs: string[];
};
type AcceptanceEvidence = {
  acceptance: string;
  evidence_refs: string[];
};

function resultStatus(value: unknown, location: string): 'passed' | 'failed' {
  if (value !== 'passed' && value !== 'failed') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', `${location} must be passed or failed.`);
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
    return {
      command: text(source.command, `${location}.command`),
      status: resultStatus(source.status, `${location}.status`),
      observed_repo_writes: pathList(source.observed_repo_writes, `${location}.observed_repo_writes`, true),
      evidence_refs: textList(source.evidence_refs, `${location}.evidence_refs`, false),
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
    return {
      validation: text(source.validation, `${location}.validation`),
      status: resultStatus(source.status, `${location}.status`),
      evidence_refs: textList(source.evidence_refs, `${location}.evidence_refs`, false),
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
  const outside = observed.filter(file => !command.expected_repo_writes.some(pattern => mutationScopePatternMatchesPath(file, pattern)));
  if (outside.length > 0) {
    fail('COMMAND_OBSERVED_WRITE_BLOCKED', `command "${command.command}" wrote outside its prepared footprint: ${outside.join(', ')}.`);
  }
}

function assertCommandResults(current: CanonicalCurrentTask, stepPlan: StepPlan, results: CommandResult[]): void {
  assertExactResultSet(results.map(item => item.command), stepPlan.commands.map(item => item.command), 'command_results');
  const scope = parseMutationScope(current.body, current.sourceTuple.revision);
  for (const result of results) {
    const planned = stepPlan.commands.find(item => item.command === result.command)!;
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

function applyRepairAttempt(
  root: string,
  current: CanonicalCurrentTask,
  receipt: ExecuteStepPreflightReceipt,
  evidenceRefs: string[],
  keySeed: unknown,
  options: RuntimeApplyOptions,
): CanonicalCurrentTask | RuntimeResult {
  const fingerprint = receipt.repair_fingerprint!;
  const finding = current.runtimeState.findings.find(item => item.fingerprint === fingerprint);
  if (!finding || !['admitted', 'in-progress'].includes(finding.status)) {
    fail('FINDING_ADMISSION_REQUIRED', 'repair_fingerprint is no longer an admitted current-task finding.');
  }
  const repairWaveId = `repair-wave-${digest(keySeed).slice(0, 24)}`;
  const key = idempotencyKey('execute-repair-attempt', keySeed);
  if (!hasAppliedProposal(current, key)) {
    const proposal = createFindingQueueProposal(current, {
      mode: 'repair',
      delta: {
        kind: 'finding-queue',
        action: 'record-repair-attempt',
        fingerprint,
        review_cycle_id: current.runtimeState.review_cycle.id,
        repair_wave_id: repairWaveId,
        evidence_refs: evidenceRefs,
        note: `execute-step repair for ${receipt.step_id}`,
      },
      idempotency_key: key,
      authority_evidence: authority(current, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission']),
      evidence_refs: evidenceRefs,
    });
    const result = verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
    if (result.status !== 'success' && result.status !== 'no-op') return result;
    if (options.dryRun) return current;
  }
  return readCanonicalCurrentTask(root);
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
  const resultKeySeed = {
    receipt,
    actual_changed_paths: actualChangedPaths,
    command_results: commandResults,
    validation_results: validationResults,
    acceptance_evidence: acceptanceEvidence,
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
  const unplannedActual = actualChangedPaths.filter(file => !receipt.candidate_paths.includes(file));
  if (unplannedActual.length > 0) {
    fail('EXECUTE_PREFLIGHT_SCOPE_CONFLICT', `actual_changed_paths were not admitted by preflight: ${unplannedActual.join(', ')}.`);
  }
  assertPathsAdmitted(current, stepPlan, actualChangedPaths, 'actual_changed_paths');
  assertCommandResults(current, stepPlan, commandResults);
  assertValidationResults(stepPlan, validationResults);
  if (outcome === 'implemented' && commandResults.some(item => item.status !== 'passed')) {
    fail('EXECUTE_RESULT_BLOCKED', 'implemented requires every planned command to pass.');
  }
  if (outcome === 'implemented' && validationResults.some(item => item.status !== 'passed')) {
    fail('EXECUTE_RESULT_BLOCKED', 'implemented requires every planned validation to pass.');
  }

  const evidenceRefs = allEvidenceRefs(commandResults, validationResults, acceptanceEvidence);
  const claimEvidence = updateClaimEvidence(current, acceptanceEvidence);
  if (receipt.mode === 'repair') {
    const repairState = applyRepairAttempt(root, current, receipt, evidenceRefs, resultKeySeed, options);
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
    ...(receipt.repair_fingerprint ? { repair_fingerprint: receipt.repair_fingerprint } : {}),
    ...(receipt.diff_target ? { diff_target: receipt.diff_target } : {}),
    ...(claimEvidence === undefined ? {} : { claim_evidence: claimEvidence }),
  });
  return verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

function normalizeReviewReceipt(value: unknown): StepReviewReceipt {
  const source = record(value, 'review_receipt');
  exactKeys(source, [
    'cycle_id',
    'cycle_phase',
    'diff_target',
    'diff_target_verification',
    'verdict',
    'admitted_fingerprints',
    'evidence_refs',
  ], 'review_receipt');
  if (source.cycle_phase !== 'discovery' && source.cycle_phase !== 'verification') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'review_receipt.cycle_phase must be discovery or verification.');
  }
  if (source.diff_target_verification !== 'verified' && source.diff_target_verification !== 'harness-supplied') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'review_receipt.diff_target_verification is invalid.');
  }
  if (source.verdict !== 'clean') {
    fail('EXECUTE_ADAPTER_INPUT_INVALID', 'complete-reviewed-step requires a clean review receipt.');
  }
  return {
    cycle_id: text(source.cycle_id, 'review_receipt.cycle_id', 128),
    cycle_phase: source.cycle_phase,
    diff_target: text(source.diff_target, 'review_receipt.diff_target', 512),
    diff_target_verification: source.diff_target_verification,
    verdict: source.verdict,
    admitted_fingerprints: textList(source.admitted_fingerprints, 'review_receipt.admitted_fingerprints', true),
    evidence_refs: textList(source.evidence_refs, 'review_receipt.evidence_refs', false),
  };
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
  exactKeys(source, ['step_id', 'review_receipt', 'acceptance_evidence', 'note'], 'complete-reviewed-step input');
  const stepId = text(source.step_id, 'step_id', 128);
  if (!SAFE_KEY_PATTERN.test(stepId)) fail('EXECUTE_ADAPTER_INPUT_INVALID', 'step_id is invalid.');
  const reviewReceipt = normalizeReviewReceipt(source.review_receipt);
  const acceptanceEvidence = normalizeAcceptanceEvidence(source.acceptance_evidence);
  const note = nullableText(source.note, 'note');
  const resultKey = idempotencyKey('execute-reviewed-step', { step_id: stepId, review_receipt: reviewReceipt, acceptance_evidence: acceptanceEvidence, note });

  let current = readCanonicalCurrentTask(root);
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

  const repairLogs = current.runtimeState.execution_log.filter(item =>
    !('action' in item) && item.step_id === stepId && item.mode === 'repair',
  );
  const repairedFingerprints = [...new Set(repairLogs.flatMap(item => item.repair_fingerprint ? [item.repair_fingerprint] : []))];
  assertExactResultSet(reviewReceipt.admitted_fingerprints, repairedFingerprints, 'review_receipt.admitted_fingerprints');
  if (repairLogs.length > 0) {
    if (reviewReceipt.cycle_phase !== 'verification') {
      fail('REVIEW_VERIFICATION_REQUIRED', 'a repaired step requires a verification review receipt.');
    }
    const repairTargets = [...new Set(repairLogs.flatMap(item => item.diff_target ? [item.diff_target] : []))];
    if (repairTargets.length !== 1 || repairTargets[0] !== reviewReceipt.diff_target) {
      fail('REPAIR_DIFF_TARGET_CONFLICT', 'verification must cover the exact repaired logical diff target.');
    }
  } else if (reviewReceipt.cycle_phase !== 'discovery') {
    fail('REVIEW_PHASE_INVALID', 'an unrepaired step requires a discovery review receipt.');
  }

  const openFindings = current.runtimeState.findings.filter(item => ['admitted', 'in-progress'].includes(item.status));
  const unverifiedOpen = openFindings.filter(item => !reviewReceipt.admitted_fingerprints.includes(item.fingerprint));
  if (unverifiedOpen.length > 0) {
    fail('REVIEW_CONVERGENCE_REQUIRED', `open findings are not covered by the clean review receipt: ${unverifiedOpen.map(item => item.fingerprint).join(', ')}.`);
  }
  const claimEvidence = updateClaimEvidence(current, acceptanceEvidence);
  const resolution = resolveTaskStep(current.body, stepId);
  if (resolution.next === null && (!claimEvidence || !claimEvidenceComplete(claimEvidence))) {
    fail('CLAIM_EVIDENCE_INCOMPLETE', 'the final step cannot complete until every frozen acceptance-evidence slot has evidence.');
  }

  if (reviewReceipt.admitted_fingerprints.length > 0) {
    const resolved = resolveVerifiedFindings(root, current, reviewReceipt, options);
    if ('status' in resolved) return resolved;
    current = resolved;
  }
  const evidenceRefs = [...new Set([...reviewReceipt.evidence_refs, ...acceptanceEvidence.flatMap(item => item.evidence_refs)])];
  const proposal = createTaskStateProposal(current, {
    mode: 'default',
    status: 'completed',
    evidence_refs: evidenceRefs,
    idempotency_key: resultKey,
    authority_evidence: authority(current, ['active-task-owner', 'scope-admission', 'evidence-admission']),
    review_receipt: reviewReceipt,
    diff_target: reviewReceipt.diff_target,
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
