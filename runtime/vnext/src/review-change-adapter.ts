/**
 * Human-semantic adapter for review-change.
 *
 * The reviewer inspects product changes without editing them. Runtime supplies
 * the exact recorded execution context and is the only writer of the durable
 * review result in canonical CURRENT_TASK.
 */

import { readProjectDocuments, type ProjectDocument } from './project-documents';
import { describeEvidenceObjects, ingestEvidenceText } from './evidence-lineage';
import { withGovernanceWriteLock } from './runtime-io';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  taskSourceRevisionMatches,
  repairRoundLimit,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  VNextRuntimeError,
  applyVNextRuntimeProposal,
  assertReviewExecutionEligible,
  captureReviewTarget,
  createEvidenceChallengeDismissalProposal,
  createEvidenceChallengeProposal,
  createReviewResultProposal,
  currentDefinitionExecutionLog,
  currentExecutionDynamicExpansions,
  cumulativeReviewExecution,
  dynamicReviewRequiredForCurrentExecution,
  validateTestAssessment,
  readCanonicalCurrentTask,
  readDraftDefinitionFromBody,
  resolveTestStrategyExecutionContext,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type CanonicalCurrentTask,
  type ClaimEvidenceRecord,
  type MutationAuthorityExpansion,
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
import {
  MutationAuthorityError,
  evaluateMutationAuthority,
  readProjectMutationAuthority,
} from './mutation-authority';
import { resolveTaskStep } from './task-steps';
import { contextInput, contextPath, decodeText, sha256, textDiff, textPage } from './file-context';
import { taskContextReferenceForCurrent, type TaskContextReference } from './task-context';
import { TaskStore } from './task-store';
import { decodeLegacyReviewPreimage, readReviewPreimageBlob, ReviewPreimageStoreError } from './review-preimage-store';

export const REVIEW_CHANGE_ADAPTER_COMMANDS = ['review-context', 'review-read', 'record-review-result', 'record-evidence-challenge', 'dismiss-evidence-challenge', 'ingest-evidence', 'route-input'] as const;
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
    evidence_ref_count: number;
    evidence_refs_truncated: boolean;
    execution_result: Record<string, unknown> | null;
    event_reference: { kind: 'event'; event_path: string } | null;
  };
  current_step: {
    id: string;
    description: string;
    purpose: string;
    planned_mutation_targets: string[];
    mutation_scope: string[];
    validation: string[];
  };
  project_documents: ProjectDocument[] | null;
  affected_contracts: string;
  acceptance: string;
  regression_checks: string;
  mutation_scope: {
    allowed: string[];
    conditional: string[];
    forbidden: string[];
  };
  mutation_authority: {
    version: 2;
    domains: string[];
    exact_exceptions: string[];
    forbidden: string[];
  } | null;
  planned_mutation_targets: string[];
  expanded_mutation_targets: MutationAuthorityExpansion[];
  dynamic_review_required: boolean;
  persistent_tests: string[] | null;
  persistent_tests_count: number;
  persistent_tests_truncated: boolean;
  claim_evidence: Array<Record<string, unknown>>;
  claim_evidence_count: number;
  claim_evidence_truncated: boolean;
  claim_evidence_read_reference: { command: 'task-read'; kind: 'claim-evidence'; required: true };
  text_diff: ReturnType<typeof reviewFilePage> | null;
  unexpanded_paths: string[];
  unexpanded_path_count: number;
  unexpanded_paths_truncated: boolean;
  admitted_findings: Array<{
    fingerprint: string;
    file: string;
    failure_condition: string;
    required_behavior: string;
    repair_attempts: number;
    max_repair_attempts: number;
  }>;
  admitted_finding_count: number;
  admitted_findings_truncated: boolean;
  complete_for_operation: boolean;
  required_unexpanded: string[];
  context_projection: TaskContextReference;
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

export function recordEvidenceChallenge(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'record-evidence-challenge input');
  exactKeys(source, ['claim_id', 'slot_id', 'result_id', 'evidence_ref', 'evidence_sha256', 'reason'], 'record-evidence-challenge input');
  const current = readCanonicalCurrentTask(root);
  const challenge = {
    claim_id: text(source.claim_id, 'claim_id', 128),
    slot_id: text(source.slot_id, 'slot_id', 128),
    result_id: text(source.result_id, 'result_id', 128),
    evidence_ref: repoPath(source.evidence_ref, 'evidence_ref'),
    evidence_sha256: text(source.evidence_sha256, 'evidence_sha256', 64),
    reason: text(source.reason, 'reason'),
  };
  if (!SHA256_PATTERN.test(challenge.evidence_sha256)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'evidence_sha256 must be a lowercase SHA-256 digest.');
  const idempotencyKey = `evidence-challenge-${digest({ document_id: current.sourceTuple.document_id, ...challenge }).slice(0, 40)}`;
  const existing = (current.runtimeState.evidence_challenges ?? []).find(item => item.claim_id === challenge.claim_id
    && item.slot_id === challenge.slot_id && item.result_id === challenge.result_id && item.evidence_sha256 === challenge.evidence_sha256);
  if (existing) {
    if (existing.evidence_ref !== challenge.evidence_ref || existing.reason !== challenge.reason) fail('EVIDENCE_CHALLENGE_DUPLICATE', 'The same result and material are already bound to a different challenge description.');
    return semanticNoOp(current, idempotencyKey, 'The exact challenge is already recorded.', options);
  }
  const proposal = createEvidenceChallengeProposal(current, {
    ...challenge,
    idempotency_key: idempotencyKey,
    authority_evidence: authority(current),
  });
  return applyVNextRuntimeProposal(root, proposal, options);
}

export function ingestEvidence(root: string, input: unknown, options: RuntimeApplyOptions = {}) {
  return withGovernanceWriteLock(root, () => {
    const source = record(input, 'ingest-evidence input');
    exactKeys(source, ['source_revision', 'source_locator', 'body'], 'ingest-evidence input');
    const current = readCanonicalCurrentTask(root);
    if (source.source_revision !== current.sourceTuple.revision) fail('EVIDENCE_SOURCE_STALE', 'Evidence ingestion must bind the exact current task revision.');
    return { status: 'success', evidence_assurance: 'caller-reported', ...ingestEvidenceText(root, current.filePath, {
      source_revision: current.sourceTuple.revision, task_id: current.runtimeState.task_id, document_id: current.sourceTuple.document_id,
      source_locator: text(source.source_locator, 'source_locator', 2048), body: text(source.body, 'body', 1048576),
    }, options.dryRun === true) };
  });
}

export function routeTaskInput(root: string, input: unknown) {
  const source = record(input, 'route-input');
  exactKeys(source, ['source_revision', 'input_ref', 'input_sha256', 'relation', 'operation', 'reason'], 'route-input');
  const current = readCanonicalCurrentTask(root);
  if (source.source_revision !== current.sourceTuple.revision) fail('INPUT_SOURCE_STALE', 'Input routing must bind the current task.');
  const ref = repoPath(source.input_ref, 'input_ref');
  if (describeEvidenceObjects(root, [ref])[0]?.sha256 !== source.input_sha256) fail('INPUT_EVIDENCE_STALE', 'Input material changed.');
  if (!['unrelated', 'current-task'].includes(String(source.relation)) || !['review-conclusion', 'recover-execution', 'change-goal', 'change-acceptance', 'expand-authority', 'other'].includes(String(source.operation))) fail('INPUT_ROUTE_INVALID', 'Unknown relation or requested operation.');
  const reason = text(source.reason, 'reason');
  const authorityChange = ['change-goal', 'change-acceptance', 'expand-authority'].includes(String(source.operation));
  const route = source.relation === 'unrelated' ? 'capture-work-item' : authorityChange || source.operation === 'other' ? 'user' : source.operation === 'review-conclusion' ? 'review-change' : 'debug-task';
  return { status: authorityChange ? 'user-decision-required' : 'routed', kind: 'task-input-routing/v1', source_tuple: current.sourceTuple,
    input_ref: ref, input_sha256: source.input_sha256, relation: source.relation, operation: source.operation, reason,
    next_route: route, evidence_assurance: 'caller-reported', permission_change: 'none',
    receipt_digest: digest({ source_tuple: current.sourceTuple, input: source, route }) };
}

export function dismissEvidenceChallenge(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'dismiss-evidence-challenge input');
  exactKeys(source, ['challenge_id', 'evidence_ref', 'evidence_sha256', 'reason'], 'dismiss-evidence-challenge input');
  const current = readCanonicalCurrentTask(root);
  const assessment = {
    challenge_id: text(source.challenge_id, 'challenge_id', 128),
    evidence_ref: repoPath(source.evidence_ref, 'evidence_ref'),
    evidence_sha256: text(source.evidence_sha256, 'evidence_sha256', 64),
    reason: text(source.reason, 'reason'),
  };
  if (!SHA256_PATTERN.test(assessment.evidence_sha256)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'evidence_sha256 must be a lowercase SHA-256 digest.');
  const existing = current.runtimeState.evidence_challenges?.find(item => item.challenge_id === assessment.challenge_id);
  const idempotencyKey = `evidence-challenge-dismissal-${digest({ document_id: current.sourceTuple.document_id, ...assessment }).slice(0, 40)}`;
  if (existing?.resolution) {
    if (existing.resolution.evidence_ref !== assessment.evidence_ref || existing.resolution.evidence_sha256 !== assessment.evidence_sha256
      || existing.resolution.reason !== assessment.reason) fail('EVIDENCE_CHALLENGE_ALREADY_RESOLVED', 'Challenge was resolved by a different assessment.');
    return semanticNoOp(current, idempotencyKey, 'The exact challenge assessment is already recorded.', options);
  }
  const proposal = createEvidenceChallengeDismissalProposal(current, {
    ...assessment, idempotency_key: idempotencyKey, authority_evidence: authority(current),
  });
  return applyVNextRuntimeProposal(root, proposal, options);
}

function latestRecordedExecution(current: CanonicalCurrentTask): StepExecutionLogEntry {
  const records = currentDefinitionExecutionLog(current).filter((item): item is StepExecutionLogEntry =>
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
  return cumulativeReviewExecution(current, latest);
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

const MAX_CONTEXT_ENTRIES = 64;

function boundedList(values: readonly string[], limit = MAX_CONTEXT_ENTRIES): { values: string[]; total: number; truncated: boolean } {
  return { values: values.slice(0, limit), total: values.length, truncated: values.length > limit };
}

function boundedValues<T>(values: readonly T[], limit = MAX_CONTEXT_ENTRIES): { values: T[]; total: number; truncated: boolean } {
  return { values: values.slice(0, limit), total: values.length, truncated: values.length > limit };
}

function containsTruncation(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsTruncation);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    (key.endsWith('_truncated') && item === true) || containsTruncation(item),
  );
}

function reviewTargetSummary(value: { kind: string; revision: string; entries: Array<{ path: string; state: string; sha256: string | null }> }): Record<string, unknown> {
  const entries = value.entries.slice(0, MAX_CONTEXT_ENTRIES).map(item => ({ ...item }));
  return {
    kind: value.kind,
    revision: value.revision,
    entries,
    entry_count: value.entries.length,
    entries_truncated: value.entries.length > MAX_CONTEXT_ENTRIES,
  };
}

function evidenceReportSummary(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const report = value as Record<string, unknown>;
  return {
    result_id: report.result_id ?? null,
    status: report.status ?? null,
    evidence_plan_revision: report.evidence_plan_revision ?? null,
    subject_revision: report.subject_revision ?? null,
    actual_method: report.actual_method ?? null,
    assurance: report.assurance ?? null,
  };
}

function evidenceRefSummary(values: readonly string[]): Record<string, unknown> {
  const refs = boundedList(values);
  return { evidence_refs: refs.values, evidence_ref_count: refs.total, evidence_refs_truncated: refs.truncated };
}

function observedWritesSummary(values: readonly string[]): Record<string, unknown> {
  const writes = boundedList(values);
  return {
    observed_repo_writes: writes.values,
    observed_repo_write_count: writes.total,
    observed_repo_writes_truncated: writes.truncated,
  };
}

function claimEvidenceSummary(value: ClaimEvidenceRecord): Record<string, unknown> {
  const slots = boundedValues(value.slots).values.map(slot => ({
    slot_id: slot.slot_id,
    minimum_type: slot.minimum_type,
    disposition: slot.disposition,
    user_decision: slot.user_decision ? { ...slot.user_decision } : null,
    obligation_resolution: slot.user_decision?.kind === 'waiver' ? 'explicit-risk-decision-not-PASS' : 'evidence-required',
    applicability: slot.applicability ?? null,
    due_step_id: slot.due_step_id ?? null,
    before_step_id: slot.before_step_id ?? null,
    check_id: slot.check?.check_id ?? null,
    frozen_invocation: slot.check?.entry ?? null,
    validation_items: [...(slot.check?.validation_items ?? [])],
    boundary: slot.check?.boundary ?? null,
    required_observation: slot.check?.expected_observation ?? null,
    required_boundaries: slot.check?.required_boundaries ?? [],
    execution_selection: slot.check?.selection ? { ...slot.check.selection } : null,
    result_id: slot.report?.result_id ?? null,
    report: evidenceReportSummary(slot.report),
    ...evidenceRefSummary(slot.evidence_refs),
  }));
  return {
    claim_id: value.claim_id,
    claim_kind: value.claim_kind,
    requirement: value.requirement,
    source_ref: value.source_ref,
    slots,
    slot_count: value.slots.length,
    slots_truncated: value.slots.length > MAX_CONTEXT_ENTRIES,
  };
}

function eventReference(root: string, current: CanonicalCurrentTask, idempotencyKey: string): { kind: 'event'; event_path: string } | null {
  const store = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent);
  if (!store.manifest) return null;
  const match = store.lookupIdempotency(idempotencyKey);
  return match ? { kind: 'event', event_path: match.event_path } : null;
}

function copyExecutionResult(value: StepExecutionResult | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const actualPaths = boundedList(value.actual_changed_paths);
  const commandResults = value.command_results.slice(0, MAX_CONTEXT_ENTRIES).map(item => ({
    command: item.command,
    status: item.status,
    ...(item.waiver_decision_id ? { waiver_decision_id: item.waiver_decision_id } : {}),
    ...observedWritesSummary(item.observed_repo_writes),
    ...evidenceRefSummary(item.evidence_refs),
    ...(item.expected_failure === undefined ? {} : { expected_failure: { ...item.expected_failure } }),
  }));
  const validationResults = value.validation_results.slice(0, MAX_CONTEXT_ENTRIES).map(item => ({
    validation: item.validation,
    status: item.status,
    ...(item.waiver_decision_id ? { waiver_decision_id: item.waiver_decision_id } : {}),
    ...evidenceRefSummary(item.evidence_refs),
    ...(item.expected_failure === undefined ? {} : { expected_failure: { ...item.expected_failure } }),
  }));
  const acceptanceEvidence = value.acceptance_evidence.slice(0, MAX_CONTEXT_ENTRIES).map(item => {
    if ('acceptance' in item) return { acceptance: item.acceptance, ...evidenceRefSummary(item.evidence_refs) };
    return {
      claim_id: item.claim_id,
      slot_id: item.slot_id,
      check_id: item.check_id,
      minimum_type: item.minimum_type,
      disposition: item.disposition,
      ...evidenceRefSummary(item.evidence_refs),
      report: evidenceReportSummary(item.report),
    };
  });
  return {
    ...(value.execution_id === undefined ? {} : { execution_id: value.execution_id }),
    ...(value.attempt_id === undefined ? {} : { attempt_id: value.attempt_id }),
    ...(value.blocker_kind === undefined ? {} : { blocker_kind: value.blocker_kind }),
    outcome: value.outcome,
    change_set_id: value.change_set_id,
    review_base: reviewTargetSummary(value.review_base),
    review_target: reviewTargetSummary(value.review_target),
    change_delta: {
      kind: value.change_delta.kind,
      base_revision: value.change_delta.base_revision,
      target_revision: value.change_delta.target_revision,
      entries: value.change_delta.entries.slice(0, MAX_CONTEXT_ENTRIES).map(item => ({ ...item })),
      entry_count: value.change_delta.entries.length,
      entries_truncated: value.change_delta.entries.length > MAX_CONTEXT_ENTRIES,
    },
    actual_changed_paths: actualPaths.values,
    actual_changed_path_count: actualPaths.total,
    actual_changed_paths_truncated: actualPaths.truncated,
    command_results: commandResults,
    command_result_count: value.command_results.length,
    command_results_truncated: value.command_results.length > MAX_CONTEXT_ENTRIES,
    validation_results: validationResults,
    validation_result_count: value.validation_results.length,
    validation_results_truncated: value.validation_results.length > MAX_CONTEXT_ENTRIES,
    acceptance_evidence: acceptanceEvidence,
    acceptance_evidence_count: value.acceptance_evidence.length,
    acceptance_evidence_truncated: value.acceptance_evidence.length > MAX_CONTEXT_ENTRIES,
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
  const plannedMutationTargets = stepScope(
    resolution.current.planned_mutation_targets ?? resolution.current.mutation_scope,
    `step ${resolution.current.id} planned_mutation_targets`,
  );
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
  const executionEvidenceRefs = boundedList(execution.evidence_refs);
  const unexpandedPaths = boundedList(execution.execution_result!.change_delta.entries.slice(1).map(item => item.path));
  const persistentTests = scope.persistent_tests === null ? null : boundedList(scope.persistent_tests);
  const expandedMutationTargets = boundedValues(currentExecutionDynamicExpansions(current));
  const claimEvidence = boundedValues(current.runtimeState.claim_evidence ?? []);
  const claimSummaries = claimEvidence.values.map(claimEvidenceSummary);
  const admittedFindings = boundedValues(admitted);
  const nestedSlotsTruncated = claimEvidence.values.some(item => item.slots.length > MAX_CONTEXT_ENTRIES);
  const executionResult = copyExecutionResult(execution.execution_result);
  const executionResultTruncated = containsTruncation(executionResult);
  const requiredUnexpanded = [
    ...(unexpandedPaths.truncated ? ['cumulative-review-target'] : []),
    ...(executionResultTruncated ? ['recorded-execution'] : []),
    ...(persistentTests?.truncated ? ['persistent-tests'] : []),
    ...(claimEvidence.truncated || nestedSlotsTruncated ? ['claim-evidence'] : []),
    ...(admittedFindings.truncated ? ['admitted-findings'] : []),
    ...(expandedMutationTargets.truncated ? ['dynamic-expansions'] : []),
  ];
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
      evidence_refs: executionEvidenceRefs.values,
      evidence_ref_count: executionEvidenceRefs.total,
      evidence_refs_truncated: executionEvidenceRefs.truncated,
      execution_result: executionResult,
      event_reference: eventReference(root, current, execution.idempotency_key),
    },
    current_step: {
      id: resolution.current.id,
      description: resolution.current.description,
      purpose: resolution.current.purpose,
      planned_mutation_targets: plannedMutationTargets,
      mutation_scope: stepScope(resolution.current.mutation_scope, `step ${resolution.current.id} mutation_scope`),
      validation: validationList(resolution.current.required_evidence, `step ${resolution.current.id} required_evidence`),
    },
    project_documents: readProjectDocuments(definition.background_context),
    affected_contracts: definition.affected_contracts,
    acceptance: definition.acceptance,
    regression_checks: definition.regression_checks,
    mutation_scope: {
      allowed: scope.allowed.map(item => item.pattern),
      conditional: scope.conditional.map(item => item.pattern),
      forbidden: scope.forbidden.map(item => item.pattern),
    },
    mutation_authority: current.mutationAuthority === null ? null : {
      version: 2,
      domains: [...current.mutationAuthority.domains],
      exact_exceptions: [...current.mutationAuthority.exact_exceptions],
      forbidden: [...current.mutationAuthority.forbidden],
    },
    planned_mutation_targets: plannedMutationTargets,
    expanded_mutation_targets: expandedMutationTargets.values,
    dynamic_review_required: dynamicReviewRequiredForCurrentExecution(current),
    text_diff: execution.execution_result!.change_delta.entries.length
      ? reviewFilePage(root, current, execution, execution.execution_result!.change_delta.entries[0]!.path, 'diff', {}) : null,
    unexpanded_paths: unexpandedPaths.values,
    unexpanded_path_count: unexpandedPaths.total,
    unexpanded_paths_truncated: unexpandedPaths.truncated,
    persistent_tests: persistentTests?.values ?? null,
    persistent_tests_count: persistentTests?.total ?? 0,
    persistent_tests_truncated: persistentTests?.truncated ?? false,
    claim_evidence: claimSummaries,
    claim_evidence_count: claimEvidence.total,
    claim_evidence_truncated: claimEvidence.truncated || nestedSlotsTruncated,
    claim_evidence_read_reference: { command: 'task-read', kind: 'claim-evidence', required: true },
    admitted_findings: admittedFindings.values.map(item => ({
      fingerprint: item.fingerprint,
      file: item.file,
      failure_condition: item.failure_condition,
      required_behavior: item.violated_invariant,
      repair_attempts: item.repair_attempts,
      max_repair_attempts: item.max_repair_attempts,
    })),
    admitted_finding_count: admittedFindings.total,
    admitted_findings_truncated: admittedFindings.truncated,
    complete_for_operation: requiredUnexpanded.length === 0,
    required_unexpanded: requiredUnexpanded,
    // Discovery review also consumes the cumulative review target.  Keep the
    // entry/mode binding identical for both review phases so callers cannot
    // accidentally receive a projection that omits the accumulated target.
    context_projection: taskContextReferenceForCurrent(root, current, 'review-context', 'review'),
    receipt,
  };
}

function reviewFilePage(root: string, current: CanonicalCurrentTask, execution: StepExecutionLogEntry, file: string, view: string, input: Record<string, unknown>) {
  if (!['before', 'after', 'diff'].includes(view)) fail('CONTEXT_INPUT_INVALID', 'view must be before, after or diff.');
  const target = execution.execution_result!.review_target.entries.find(item => item.path === file);
  if (!target) fail('REVIEW_PATH_OUTSIDE_TARGET', 'path is not part of this cumulative review target.');
  const preimage = current.runtimeState.review_coverage?.preimages.find(item => item.path === file);
  const base = { path: file, view, target_revision: execution.execution_result!.review_target.revision };
  if (!preimage && view !== 'after') return { ...base, content_status: 'baseline-unavailable' as const };
  if (target.state === 'symlink' || preimage?.state === 'symlink') return { ...base, content_status: 'symlink-not-followed' as const };
  let before = Buffer.alloc(0);
  if (preimage?.state === 'file') {
    try {
      const legacy = Object.prototype.hasOwnProperty.call(preimage, 'content_base64')
        ? decodeLegacyReviewPreimage(preimage)
        : null;
      before = legacy?.content ?? readReviewPreimageBlob(root, preimage.sha256!);
    } catch (error) {
      if (error instanceof ReviewPreimageStoreError) fail(error.code, error.message);
      throw error;
    }
  }
  const after = target.state === 'file' ? fs.readFileSync(contextPath(root, file).absolute) : Buffer.alloc(0);
  if (target.state === 'file' && sha256(after) !== target.sha256) fail('REVIEW_TARGET_STALE', 'file changed while reading review context.');
  if (preimage?.state === 'file' && sha256(before) !== preimage.sha256) fail('REVIEW_BASE_INVALID', 'first-touch baseline hash mismatch.');
  const left = decodeText(before);
  const right = decodeText(after);
  if ((view !== 'after' && left === null) || (view !== 'before' && right === null)) return { ...base, content_status: 'binary-or-non-utf8' as const };
  let text: string | undefined;
  if (view === 'before') text = left!;
  else if (view === 'after') text = right!;
  else text = textDiff(file, left!, right!);
  if (text === undefined) return { ...base, content_status: 'diff-budget-exceeded' as const, next_read: ['before', 'after'] };
  return { ...base, content_status: 'text' as const, before_state: preimage?.state ?? null, after_state: target.state, ...textPage(text, input) };
}

export function reviewRead(root: string, input: unknown) {
  const value = contextInput(input, ['context_receipt', 'path', 'view', 'offset', 'max_bytes', 'start_line', 'end_line']);
  const current = readCanonicalCurrentTask(root);
  assertReviewableTask(current);
  const receipt = normalizeContextReceipt(value.context_receipt);
  const execution = assertCurrentContext(root, current, receipt);
  const file = repoPath(value.path, 'path');
  return { status: 'pass', operation_kind: 'review-read', committed: false,
    ...reviewFilePage(root, current, execution, file, String(value.view ?? 'diff'), value) };
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
  if (!taskSourceRevisionMatches(root, current, receipt.source_revision)) fail('REVIEW_CONTEXT_STALE', 'CURRENT_TASK changed after review context was issued.');
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
  return cumulativeReviewExecution(current, latest);
}

function assertRecordedTargetCurrent(root: string, current: CanonicalCurrentTask, receipt: ReviewContextReceipt): StepExecutionLogEntry {
  const execution = current.runtimeState.execution_log.map(item => 'action' in item ? item : cumulativeReviewExecution(current, item)).find((item): item is StepExecutionLogEntry =>
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

function normalizeFinding(value: unknown, index: number, current: CanonicalCurrentTask, root: string): ReviewFindingCandidate {
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
  const step = resolveTaskStep(current.body, current.runtimeState.active_step_id).current;
  if (current.mutationAuthority) {
    let project;
    try { project = readProjectMutationAuthority(root); }
    catch (error) { fail(error instanceof MutationAuthorityError ? error.code : 'MUTATION_AUTHORITY_PROJECT_INVALID', error instanceof Error ? error.message : String(error)); }
    if (!project) fail('MUTATION_AUTHORITY_PROJECT_REQUIRED', 'v2 review requires PROJECT_PROFILE.yaml.mutation_authority.domains.');
    const authorityDecision = evaluateMutationAuthority({
      root,
      project,
      task: current.mutationAuthority,
      candidate_paths: [candidate.file],
      planned_targets: stepScope(step.planned_mutation_targets ?? step.mutation_scope, `step ${step.id} planned_mutation_targets`),
      assessments: currentExecutionDynamicExpansions(current).map(item => item.assessment),
      persistent_test_paths: resolveTestStrategyExecutionContext(current).persistent_tests,
    });
    if (authorityDecision.status !== 'pass') {
      fail('REVIEW_FINDING_SCOPE_BLOCKED', `finding path ${candidate.file} cannot be repaired within the v2 task authority: ${authorityDecision.blockers.join(' ')}`);
    }
  } else {
    const scope = parseMutationScope(current.body, current.sourceTuple.revision);
    const decision = evaluateMutationScope(scope, { changed_paths: [candidate.file] });
    const admittedByStep = stepScope(step.mutation_scope, `step ${step.id} mutation_scope`).some(pattern => mutationScopePatternMatchesPath(candidate.file, pattern));
    if (decision.status !== 'pass' || !admittedByStep) {
      fail('REVIEW_FINDING_SCOPE_BLOCKED', `finding path ${candidate.file} cannot be repaired within the confirmed current-step scope.`);
    }
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
  if (current.runtimeState.review_cycle.repair_round >= repairRoundLimit(current.runtimeState.review_cycle) && (findings.length > 0 || unresolved.length > 0)) {
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
  exactKeys(source, ['context_receipt', 'verdict', 'findings', 'unresolved_fingerprints', 'evidence_refs', 'blocker', ...(source.test_assessment === undefined ? [] : ['test_assessment'])], 'record-review-result input');
  const receipt = normalizeContextReceipt(source.context_receipt);
  if (!['clean', 'findings', 'blocked'].includes(String(source.verdict))) fail('REVIEW_ADAPTER_INPUT_INVALID', 'verdict must be clean, findings, or blocked.');
  const verdict = source.verdict as ReviewResultVerdict;
  const current = readCanonicalCurrentTask(root);
  assertReviewableTask(current);
  const recordedExecution = assertRecordedTargetCurrent(root, current, receipt);
  if (!Array.isArray(source.findings) || source.findings.length > MAX_ITEMS) fail('REVIEW_ADAPTER_INPUT_INVALID', 'findings must be a bounded array.');
  const findings = source.findings.map((item, index) => normalizeFinding(item, index, current, root));
  if (new Set(findings.map(item => item.fingerprint)).size !== findings.length) fail('REVIEW_ADAPTER_INPUT_INVALID', 'findings must not contain duplicates.');
  const unresolved = textList(source.unresolved_fingerprints, 'unresolved_fingerprints', true);
  if (unresolved.some(item => !receipt.admitted_fingerprints.includes(item))) fail('REVIEW_ADAPTER_INPUT_INVALID', 'unresolved_fingerprints must be drawn from the Runtime review context.');
  const evidenceRefs = textList(source.evidence_refs, 'evidence_refs', false);
  let blocker: ReviewBlocker | null;
  if (source.blocker === null) blocker = null;
  else {
    const raw = record(source.blocker, 'blocker');
    exactKeys(raw, ['code', 'summary', 'next_route'], 'blocker');
    if (!['review-change', 'debug-task', 'prepare-task:replan', 'prepare-task:amend-scope', 'user'].includes(String(raw.next_route))) fail('REVIEW_ADAPTER_INPUT_INVALID', 'blocker.next_route is invalid.');
    blocker = { code: text(raw.code, 'blocker.code', 128), summary: text(raw.summary, 'blocker.summary'), next_route: raw.next_route as ReviewBlocker['next_route'] };
  }
  if (verdict === 'clean' && (findings.length > 0 || unresolved.length > 0 || blocker !== null)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'clean must not contain findings or a blocker.');
  if (verdict === 'findings' && (findings.length === 0 && unresolved.length === 0 || blocker !== null)) fail('REVIEW_ADAPTER_INPUT_INVALID', 'findings verdict requires a finding and no blocker.');
  if (verdict === 'blocked' && blocker === null) fail('REVIEW_ADAPTER_INPUT_INVALID', 'blocked requires a blocker.');
  const runtimeBlocker = verdict === 'findings' ? convergenceBlocker(current, receipt, findings, unresolved) : null;
  const finalVerdict: ReviewResultVerdict = runtimeBlocker ? 'blocked' : verdict;
  // A convergence blocker stops execution, but it does not invalidate the
  // reviewer's structured conclusions. Keep them attached to the blocked
  // review so a later budget decision can recompute the complete repair set.
  const finalFindings = findings;
  const finalUnresolved = unresolved;
  const finalBlocker = runtimeBlocker ?? blocker;
  const reviewId = `review-${digest({ receipt, verdict: finalVerdict, findings: finalFindings, unresolved: finalUnresolved, evidenceRefs, blocker: finalBlocker }).slice(0, 40)}`;
  const reviewResult: Omit<PendingReviewResult, 'recorded_at'> = {
    ...(source.test_assessment === undefined ? {} : {test_assessment:validateTestAssessment(source.test_assessment)}),
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
    let result;
    if (args.command === 'review-context') result = reviewContext(args.root, input);
    else if (args.command === 'review-read') result = reviewRead(args.root, input);
    else if (args.command === 'record-review-result') result = recordReviewResult(args.root, input, { dryRun: args.dryRun });
    else if (args.command === 'record-evidence-challenge') result = recordEvidenceChallenge(args.root, input, { dryRun: args.dryRun });
    else if (args.command === 'ingest-evidence') result = ingestEvidence(args.root, input, { dryRun: args.dryRun });
    else if (args.command === 'route-input') result = routeTaskInput(args.root, input);
    else result = dismissEvidenceChallenge(args.root, input, { dryRun: args.dryRun });
    console.log(JSON.stringify(result, null, 2));
    return 'status' in result && (result.status === 'blocked' || result.status === 'conflict') ? 2 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
