/**
 * Human-semantic adapter for review-change.
 *
 * The reviewer inspects product changes without editing them. Runtime supplies
 * the exact recorded execution context and is the only writer of the durable
 * review result in canonical CURRENT_TASK.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  MAX_REPAIR_ROUNDS,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  VNextRuntimeError,
  applyVNextRuntimeProposal,
  assertReviewExecutionEligible,
  captureReviewTarget,
  createReviewResultProposal,
  readCanonicalCurrentTask,
  readDraftDefinitionFromBody,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type CanonicalCurrentTask,
  type ClaimEvidenceRecord,
  type PendingReviewResult,
  type ReviewBlocker,
  type ReviewFindingCandidate,
  type ReviewResultVerdict,
  type RuntimeApplyOptions,
  type RuntimeResult,
  type StepExecutionResult,
  type StepExecutionLogEntry,
} from './kernel';
import {
  evaluateMutationScope,
  mutationScopePatternMatchesPath,
  parseMutationScope,
} from './mutation-scope';
import { resolveTaskStep } from './task-steps';

export const REVIEW_CHANGE_ADAPTER_COMMANDS = ['review-context', 'record-review-result'] as const;
export type ReviewChangeAdapterCommand = (typeof REVIEW_CHANGE_ADAPTER_COMMANDS)[number];

type JsonRecord = Record<string, unknown>;

export type ReviewContextReceipt = {
  kind: 'review-context/v1';
  task_id: string;
  document_id: string;
  source_revision: string;
  step_id: string;
  execution_id: string;
  cycle_id: string;
  cycle_phase: 'discovery' | 'verification';
  admitted_fingerprints: string[];
};

export type ReviewContextResult = {
  status: 'pass';
  operation_kind: 'review-context';
  committed: false;
  read_back_verified: true;
  recorded_execution: {
    id: string;
    mode: 'default' | 'repair';
    status: string;
    change_set_id: string;
    review_target_revision: string;
    evidence_refs: string[];
    execution_result: StepExecutionResult | null;
  };
  current_step: {
    id: string;
    description: string;
    purpose: string;
    mutation_scope: string[];
    validation: string[];
  };
  acceptance: string;
  regression_checks: string;
  mutation_scope: {
    allowed: string[];
    conditional: string[];
    forbidden: string[];
  };
  persistent_tests: string[] | null;
  claim_evidence: ClaimEvidenceRecord[];
  admitted_findings: Array<{
    fingerprint: string;
    file: string;
    failure_condition: string;
    required_behavior: string;
    repair_attempts: number;
    max_repair_attempts: number;
  }>;
  receipt: ReviewContextReceipt;
};

const MAX_ITEMS = 256;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;

function fail(code: string, message: string): never {
  throw new VNextRuntimeError(code, message);
}

function record(value: unknown, location: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('REVIEW_ADAPTER_INPUT_INVALID', `${location} must be an object.`);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], location: string): void {
  const allowed = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    fail('REVIEW_ADAPTER_INPUT_INVALID', `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}].`);
  }
}

function text(value: unknown, location: string, maximumLength = 4096): string {
  if (typeof value !== 'string') fail('REVIEW_ADAPTER_INPUT_INVALID', `${location} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\r\n]/u.test(normalized)) {
    fail('REVIEW_ADAPTER_INPUT_INVALID', `${location} must be one non-empty line of at most ${maximumLength} characters.`);
  }
  return normalized;
}

function textList(value: unknown, location: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > MAX_ITEMS) {
    fail('REVIEW_ADAPTER_INPUT_INVALID', `${location} must be a bounded ${allowEmpty ? '' : 'non-empty '}array.`);
  }
  const normalized = value.map((item, index) => text(item, `${location}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail('REVIEW_ADAPTER_INPUT_INVALID', `${location} must not contain duplicates.`);
  return normalized;
}

function repoPath(value: unknown, location: string): string {
  const normalized = text(value, location, 1024).replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (path.posix.isAbsolute(normalized) || WINDOWS_ABSOLUTE_PATH.test(normalized) || normalized.split('/').includes('..')) {
    fail('REVIEW_ADAPTER_INPUT_INVALID', `${location} must be a project-relative path.`);
  }
  return normalized;
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authority(current: CanonicalCurrentTask): AuthorityEvidence[] {
  return (['active-task-owner', 'scope-admission', 'evidence-admission'] as const).map(kind => ({
    kind,
    source: current.relativePath,
    subject: current.runtimeState.task_id,
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
  }));
}

function latestRecordedExecution(current: CanonicalCurrentTask): StepExecutionLogEntry {
  const records = current.runtimeState.execution_log.filter((item): item is StepExecutionLogEntry =>
    !('action' in item)
    && item.step_id === current.runtimeState.active_step_id
    && item.idempotency_key.startsWith('execute-step-result-')
    && item.review_receipt === undefined,
  );
  const latest = records[records.length - 1];
  if (!latest) fail('REVIEW_EXECUTION_REQUIRED', 'review-change requires a recorded execute-step result for the active step.');
  if (!latest.change_set_id || !latest.execution_result?.review_target) {
    fail('REVIEW_TARGET_REQUIRED', 'the latest execute-step result does not contain a Runtime-owned review target.');
  }
  if (latest.execution_result.change_set_id !== latest.change_set_id) {
    fail('REVIEW_TARGET_CONFLICT', 'the latest execution change-set identity is inconsistent.');
  }
  assertReviewExecutionEligible(current, latest);
  return latest;
}

function stepScope(value: string | null, location: string): string[] {
  if (!value) fail('TASK_STEP_METADATA_INCOMPLETE', `${location} is missing.`);
  const items = value.split(',').map(item => item.replace(/`/gu, '').trim()).filter(Boolean);
  if (items.length === 0 || new Set(items).size !== items.length) fail('TASK_STEP_METADATA_INCOMPLETE', `${location} is invalid.`);
  return items;
}

function validationList(value: string | null, location: string): string[] {
  if (!value) fail('TASK_STEP_METADATA_INCOMPLETE', `${location} is missing.`);
  return value.split(/;\s+/u).map(item => item.trim()).filter(Boolean);
}

function assertReviewableTask(current: CanonicalCurrentTask): void {
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('TASK_STATE_NOT_ACTIVE', 'review-change requires active + active.');
  }
  if (current.runtimeState.resume_requires_review) fail('RESUME_REVIEW_REQUIRED', 'review-change is blocked by the current resume-review gate.');
}

function copyExecutionResult(value: StepExecutionResult | undefined): StepExecutionResult | null {
  if (!value) return null;
  return {
    outcome: value.outcome,
    change_set_id: value.change_set_id,
    review_base: {
      kind: value.review_base.kind,
      revision: value.review_base.revision,
      entries: value.review_base.entries.map(item => ({ ...item })),
    },
    review_target: {
      kind: value.review_target.kind,
      revision: value.review_target.revision,
      entries: value.review_target.entries.map(item => ({ ...item })),
    },
    change_delta: {
      kind: value.change_delta.kind,
      base_revision: value.change_delta.base_revision,
      target_revision: value.change_delta.target_revision,
      entries: value.change_delta.entries.map(item => ({ ...item })),
    },
    actual_changed_paths: [...value.actual_changed_paths],
    command_results: value.command_results.map(item => ({
      ...item,
      observed_repo_writes: [...item.observed_repo_writes],
      evidence_refs: [...item.evidence_refs],
    })),
    validation_results: value.validation_results.map(item => ({ ...item, evidence_refs: [...item.evidence_refs] })),
    acceptance_evidence: value.acceptance_evidence.map(item => ({ ...item, evidence_refs: [...item.evidence_refs] })),
    blocker: value.blocker,
  };
}

export function reviewContext(root: string, input: unknown): ReviewContextResult {
  const source = record(input, 'review-context input');
  exactKeys(source, [], 'review-context input');
  const current = readCanonicalCurrentTask(root);
  assertReviewableTask(current);
  const execution = latestRecordedExecution(current);
  const currentTarget = captureReviewTarget(root, execution.execution_result!.review_target.entries.map(item => item.path));
  if (currentTarget.revision !== execution.execution_result!.review_target.revision) {
    fail('REVIEW_TARGET_STALE', 'product files changed after the latest execution result was recorded.');
  }
  if (current.runtimeState.pending_review_result?.execution_id === execution.idempotency_key
    && current.runtimeState.pending_review_result.verdict !== 'blocked') {
    fail('REVIEW_ALREADY_RECORDED', 'the latest execution already has a durable clean or findings review result.');
  }
  const phase = execution.mode === 'repair' ? 'verification' : 'discovery';
  const resolution = resolveTaskStep(current.body, current.runtimeState.active_step_id);
  if (!resolution.current.metadata_complete || !resolution.current.purpose) {
    fail('TASK_STEP_METADATA_INCOMPLETE', `step ${resolution.current.id} is not reviewable because its metadata is incomplete.`);
  }
  const scope = parseMutationScope(current.body, current.sourceTuple.revision);
  const admitted = phase === 'verification'
    ? current.runtimeState.findings.filter(item => item.review_cycle_id === current.runtimeState.review_cycle.id && ['admitted', 'in-progress'].includes(item.status))
    : [];
  const definition = readDraftDefinitionFromBody(current.body);
  const receipt: ReviewContextReceipt = {
    kind: 'review-context/v1',
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    step_id: resolution.current.id,
    execution_id: execution.idempotency_key,
    cycle_id: current.runtimeState.review_cycle.id,
    cycle_phase: phase,
    admitted_fingerprints: admitted.map(item => item.fingerprint),
  };
  return {
    status: 'pass',
    operation_kind: 'review-context',
    committed: false,
    read_back_verified: true,
    recorded_execution: {
      id: execution.idempotency_key,
      mode: execution.mode,
      status: execution.status,
      change_set_id: execution.change_set_id!,
      review_target_revision: execution.execution_result!.review_target.revision,
      evidence_refs: [...execution.evidence_refs],
      execution_result: copyExecutionResult(execution.execution_result),
    },
    current_step: {
      id: resolution.current.id,
      description: resolution.current.description,
      purpose: resolution.current.purpose,
      mutation_scope: stepScope(resolution.current.mutation_scope, `step ${resolution.current.id} mutation_scope`),
      validation: validationList(resolution.current.required_evidence, `step ${resolution.current.id} required_evidence`),
    },
    acceptance: definition.acceptance,
    regression_checks: definition.regression_checks,
    mutation_scope: {
      allowed: scope.allowed.map(item => item.pattern),
      conditional: scope.conditional.map(item => item.pattern),
      forbidden: scope.forbidden.map(item => item.pattern),
    },
    persistent_tests: scope.persistent_tests === null ? null : [...scope.persistent_tests],
    claim_evidence: (current.runtimeState.claim_evidence ?? []).map(item => ({
      ...item,
      slots: item.slots.map(slot => ({ ...slot, evidence_refs: [...slot.evidence_refs] })),
    })),
    admitted_findings: admitted.map(item => ({
      fingerprint: item.fingerprint,
      file: item.file,
      failure_condition: item.failure_condition,
      required_behavior: item.violated_invariant,
      repair_attempts: item.repair_attempts,
      max_repair_attempts: item.max_repair_attempts,
    })),
    receipt,
  };
}

function normalizeContextReceipt(value: unknown): ReviewContextReceipt {
  const source = record(value, 'context_receipt');
  exactKeys(source, ['kind', 'task_id', 'document_id', 'source_revision', 'step_id', 'execution_id', 'cycle_id', 'cycle_phase', 'admitted_fingerprints'], 'context_receipt');
  if (source.kind !== 'review-context/v1') fail('REVIEW_ADAPTER_INPUT_INVALID', 'context_receipt.kind must be review-context/v1.');
  if (source.cycle_phase !== 'discovery' && source.cycle_phase !== 'verification') fail('REVIEW_ADAPTER_INPUT_INVALID', 'context_receipt.cycle_phase is invalid.');
  const sourceRevision = text(source.source_revision, 'context_receipt.source_revision', 64);
  if (!SHA256_PATTERN.test(sourceRevision)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'context_receipt.source_revision must be SHA-256.');
  return {
    kind: 'review-context/v1',
    task_id: text(source.task_id, 'context_receipt.task_id', 128),
    document_id: text(source.document_id, 'context_receipt.document_id', 128),
    source_revision: sourceRevision,
    step_id: text(source.step_id, 'context_receipt.step_id', 128),
    execution_id: text(source.execution_id, 'context_receipt.execution_id', 128),
    cycle_id: text(source.cycle_id, 'context_receipt.cycle_id', 128),
    cycle_phase: source.cycle_phase,
    admitted_fingerprints: textList(source.admitted_fingerprints, 'context_receipt.admitted_fingerprints', true),
  };
}

function assertCurrentContext(root: string, current: CanonicalCurrentTask, receipt: ReviewContextReceipt): StepExecutionLogEntry {
  if (receipt.task_id !== current.runtimeState.task_id || receipt.document_id !== current.sourceTuple.document_id) fail('REVIEW_CONTEXT_STALE', 'review context belongs to a different task document.');
  if (receipt.source_revision !== current.sourceTuple.revision) fail('REVIEW_CONTEXT_STALE', 'CURRENT_TASK changed after review context was issued.');
  if (receipt.step_id !== current.runtimeState.active_step_id || receipt.cycle_id !== current.runtimeState.review_cycle.id) fail('REVIEW_CONTEXT_STALE', 'active step or review cycle changed after review context was issued.');
  const latest = latestRecordedExecution(current);
  if (latest.idempotency_key !== receipt.execution_id) fail('REVIEW_CONTEXT_STALE', 'recorded execution changed after review context was issued.');
  const currentTarget = captureReviewTarget(root, latest.execution_result.review_target.entries.map(item => item.path));
  if (currentTarget.revision !== latest.execution_result.review_target.revision) {
    fail('REVIEW_TARGET_STALE', 'product files changed after review context was issued.');
  }
  const expectedPhase = latest.mode === 'repair' ? 'verification' : 'discovery';
  if (receipt.cycle_phase !== expectedPhase) fail('REVIEW_CONTEXT_STALE', 'review phase changed after review context was issued.');
  const open = expectedPhase === 'verification'
    ? current.runtimeState.findings.filter(item => item.review_cycle_id === receipt.cycle_id && ['admitted', 'in-progress'].includes(item.status)).map(item => item.fingerprint)
    : [];
  if (open.length !== receipt.admitted_fingerprints.length || open.some(item => !receipt.admitted_fingerprints.includes(item))) {
    fail('REVIEW_CONTEXT_STALE', 'admitted finding set changed after review context was issued.');
  }
  return latest;
}

function assertRecordedTargetCurrent(root: string, current: CanonicalCurrentTask, receipt: ReviewContextReceipt): StepExecutionLogEntry {
  const execution = current.runtimeState.execution_log.find((item): item is StepExecutionLogEntry =>
    !('action' in item) && item.idempotency_key === receipt.execution_id,
  );
  if (!execution?.execution_result || !execution.change_set_id
    || execution.execution_result.change_set_id !== execution.change_set_id) {
    fail('REVIEW_TARGET_CONFLICT', 'review result no longer binds its Runtime-recorded execution target.');
  }
  const currentTarget = captureReviewTarget(root, execution.execution_result.review_target.entries.map(item => item.path));
  if (currentTarget.revision !== execution.execution_result.review_target.revision) {
    fail('REVIEW_TARGET_STALE', 'product files changed after the recorded execution target.');
  }
  return execution;
}

function normalizeFinding(value: unknown, index: number, current: CanonicalCurrentTask): ReviewFindingCandidate {
  const source = record(value, `findings[${index}]`);
  exactKeys(source, ['category', 'file', 'failure_condition', 'required_behavior', 'root_cause_status', 'evidence_refs'], `findings[${index}]`);
  if (source.root_cause_status !== 'confirmed' && source.root_cause_status !== 'bounded') fail('REVIEW_ADAPTER_INPUT_INVALID', `findings[${index}].root_cause_status is invalid.`);
  const candidate = {
    category: text(source.category, `findings[${index}].category`, 256),
    file: repoPath(source.file, `findings[${index}].file`),
    failure_condition: text(source.failure_condition, `findings[${index}].failure_condition`),
    required_behavior: text(source.required_behavior, `findings[${index}].required_behavior`, 512),
    root_cause_status: source.root_cause_status as ReviewFindingCandidate['root_cause_status'],
    evidence_refs: textList(source.evidence_refs, `findings[${index}].evidence_refs`, false),
  };
  const scope = parseMutationScope(current.body, current.sourceTuple.revision);
  const decision = evaluateMutationScope(scope, { changed_paths: [candidate.file] });
  const step = resolveTaskStep(current.body, current.runtimeState.active_step_id).current;
  const admittedByStep = stepScope(step.mutation_scope, `step ${step.id} mutation_scope`).some(pattern => mutationScopePatternMatchesPath(candidate.file, pattern));
  if (decision.status !== 'pass' || !admittedByStep) {
    fail('REVIEW_FINDING_SCOPE_BLOCKED', `finding path ${candidate.file} cannot be repaired within the confirmed current-step scope.`);
  }
  return {
    fingerprint: `finding-${digest({
      task_id: current.runtimeState.task_id,
      file: candidate.file,
      failure_condition: candidate.failure_condition,
      required_behavior: candidate.required_behavior,
    }).slice(0, 32)}`,
    ...candidate,
  };
}

function convergenceBlocker(current: CanonicalCurrentTask, receipt: ReviewContextReceipt, findings: ReviewFindingCandidate[], unresolved: string[]): ReviewBlocker | null {
  if (receipt.cycle_phase !== 'verification') return null;
  if (findings.length > 0 && current.runtimeState.review_cycle.verification_new_finding_wave_used) {
    return { code: 'NEW_FINDING_WAVE_BUDGET_EXHAUSTED', summary: 'Verification found another new-finding wave after the one allowed wave was already used.', next_route: 'debug-task' };
  }
  if (current.runtimeState.review_cycle.repair_round >= MAX_REPAIR_ROUNDS && (findings.length > 0 || unresolved.length > 0)) {
    return { code: 'REPAIR_BUDGET_EXHAUSTED', summary: 'The current review cycle has exhausted its repair-wave budget.', next_route: 'debug-task' };
  }
  const exhausted = unresolved.filter(fingerprint => {
    const finding = current.runtimeState.findings.find(item => item.fingerprint === fingerprint);
    return finding !== undefined && finding.repair_attempts >= finding.max_repair_attempts;
  });
  if (exhausted.length > 0) {
    return { code: 'REPAIR_BUDGET_EXHAUSTED', summary: `Findings exhausted their repair-attempt budget: ${exhausted.join(', ')}.`, next_route: 'debug-task' };
  }
  return null;
}

function verifyReadBack(root: string, result: RuntimeResult, reviewId: string, options: RuntimeApplyOptions): RuntimeResult {
  if (options.dryRun || (result.status !== 'success' && result.status !== 'no-op')) return result;
  const current = readCanonicalCurrentTask(root);
  if (!result.read_back_verified || current.runtimeState.pending_review_result?.review_id !== reviewId || result.resulting_revision !== current.sourceTuple.revision) {
    fail('REVIEW_ADAPTER_READ_BACK_FAILED', 'review-change adapter could not verify the durable pending review result.');
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

export function recordReviewResult(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'record-review-result input');
  exactKeys(source, ['context_receipt', 'verdict', 'findings', 'unresolved_fingerprints', 'evidence_refs', 'blocker'], 'record-review-result input');
  const receipt = normalizeContextReceipt(source.context_receipt);
  if (!['clean', 'findings', 'blocked'].includes(String(source.verdict))) fail('REVIEW_ADAPTER_INPUT_INVALID', 'verdict must be clean, findings, or blocked.');
  const verdict = source.verdict as ReviewResultVerdict;
  const current = readCanonicalCurrentTask(root);
  assertReviewableTask(current);
  const recordedExecution = assertRecordedTargetCurrent(root, current, receipt);
  if (!Array.isArray(source.findings) || source.findings.length > MAX_ITEMS) fail('REVIEW_ADAPTER_INPUT_INVALID', 'findings must be a bounded array.');
  const findings = source.findings.map((item, index) => normalizeFinding(item, index, current));
  if (new Set(findings.map(item => item.fingerprint)).size !== findings.length) fail('REVIEW_ADAPTER_INPUT_INVALID', 'findings must not contain duplicates.');
  const unresolved = textList(source.unresolved_fingerprints, 'unresolved_fingerprints', true);
  if (unresolved.some(item => !receipt.admitted_fingerprints.includes(item))) fail('REVIEW_ADAPTER_INPUT_INVALID', 'unresolved_fingerprints must be drawn from the Runtime review context.');
  const evidenceRefs = textList(source.evidence_refs, 'evidence_refs', false);
  let blocker: ReviewBlocker | null;
  if (source.blocker === null) blocker = null;
  else {
    const raw = record(source.blocker, 'blocker');
    exactKeys(raw, ['code', 'summary', 'next_route'], 'blocker');
    if (!['review-change', 'debug-task', 'prepare-task:replan', 'user'].includes(String(raw.next_route))) fail('REVIEW_ADAPTER_INPUT_INVALID', 'blocker.next_route is invalid.');
    blocker = { code: text(raw.code, 'blocker.code', 128), summary: text(raw.summary, 'blocker.summary'), next_route: raw.next_route as ReviewBlocker['next_route'] };
  }
  if (verdict === 'clean' && (findings.length > 0 || unresolved.length > 0 || blocker !== null)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'clean must not contain findings or a blocker.');
  if (verdict === 'findings' && (findings.length === 0 && unresolved.length === 0 || blocker !== null)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'findings verdict requires a finding and no blocker.');
  if (verdict === 'blocked' && (findings.length > 0 || unresolved.length > 0 || blocker === null)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'blocked requires only a blocker.');
  const runtimeBlocker = verdict === 'findings' ? convergenceBlocker(current, receipt, findings, unresolved) : null;
  const finalVerdict: ReviewResultVerdict = runtimeBlocker ? 'blocked' : verdict;
  const finalFindings = runtimeBlocker ? [] : findings;
  const finalUnresolved = runtimeBlocker ? [] : unresolved;
  const finalBlocker = runtimeBlocker ?? blocker;
  const reviewId = `review-${digest({ receipt, verdict: finalVerdict, findings: finalFindings, unresolved: finalUnresolved, evidenceRefs, blocker: finalBlocker }).slice(0, 40)}`;
  const reviewResult: Omit<PendingReviewResult, 'recorded_at'> = {
    kind: 'review-result/v1',
    review_id: reviewId,
    execution_id: receipt.execution_id,
    step_id: receipt.step_id,
    cycle_id: receipt.cycle_id,
    cycle_phase: receipt.cycle_phase,
    change_set_id: recordedExecution.change_set_id!,
    review_target_revision: recordedExecution.execution_result!.review_target.revision,
    verdict: finalVerdict,
    findings: finalFindings,
    unresolved_fingerprints: finalUnresolved,
    evidence_refs: evidenceRefs,
    blocker: finalBlocker,
  };
  const resultKey = `review-result-${digest(reviewResult).slice(0, 48)}`;
  if (current.runtimeState.pending_review_result?.review_id === reviewId) {
    const { recorded_at: _recordedAt, ...durable } = current.runtimeState.pending_review_result;
    if (digest(durable) !== digest(reviewResult)) fail('REVIEW_REPLAY_CONFLICT', 'the durable review id is bound to different review semantics.');
    return semanticNoOp(current, resultKey, 'This exact review result was already recorded.', options);
  }
  assertCurrentContext(root, current, receipt);
  const proposal = createReviewResultProposal(current, {
    review_result: reviewResult,
    evidence_refs: evidenceRefs,
    idempotency_key: resultKey,
    authority_evidence: authority(current),
  });
  return verifyReadBack(root, applyVNextRuntimeProposal(root, proposal, options), reviewId, options);
}

type ReviewChangeAdapterCliArguments = { command: ReviewChangeAdapterCommand; root: string; dryRun: boolean };

function parseCli(argv: string[]): ReviewChangeAdapterCliArguments {
  const [command, ...rest] = argv;
  if (!REVIEW_CHANGE_ADAPTER_COMMANDS.includes(command as ReviewChangeAdapterCommand)) throw new Error(`Usage: vnext-runtime <${REVIEW_CHANGE_ADAPTER_COMMANDS.join('|')}> --root <path> [--dry-run] (semantic JSON on stdin)`);
  let root = process.cwd();
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown review-change adapter argument: ${arg}`);
  }
  if (!root) throw new Error('--root requires a path.');
  return { command: command as ReviewChangeAdapterCommand, root, dryRun };
}

function readSemanticStdin(command: ReviewChangeAdapterCommand): unknown {
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

export async function runReviewChangeAdapterCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    validateRuntimeEnvironment();
    const args = parseCli(argv);
    validateInstalledRuntime(args.root);
    const input = readSemanticStdin(args.command);
    const result = args.command === 'review-context'
      ? reviewContext(args.root, input)
      : recordReviewResult(args.root, input, { dryRun: args.dryRun });
    console.log(JSON.stringify(result, null, 2));
    return 'status' in result && (result.status === 'blocked' || result.status === 'conflict') ? 2 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
