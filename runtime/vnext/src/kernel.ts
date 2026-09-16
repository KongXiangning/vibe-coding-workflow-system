
/**
 * Pure-vNext state-changing Runtime slice.
 *
 * Phase 2 binds the execute-step task/finding slice plus lifecycle, replan,
 * and close-task transactions. The Runtime accepts typed proposals,
 * validates the canonical source tuple and exact write targets, renders
 * canonical Markdown/YAML in memory, commits an atomic file set, and reads
 * the result back before reporting success.
 */

import { readProjectDocuments } from './project-documents';
import { TASK_RECOVERY_PROTOCOL } from './task-recovery';
import { describeEvidenceObjects, preserveEvidenceObjects, verifyEvidenceObject, safeRepositoryFile, type EvidenceObject } from './evidence-lineage';
import { captureArtifactImages, saveArtifactCheckpoint, prepareArtifactRestore, applyArtifactRestore, assertNoArtifactPublication, type ArtifactRestorePlan } from './artifact-checkpoints';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseDocument, stringify } from 'yaml';
import {
  executeWrites,
  assertGovernanceReadable,
  withGovernanceWriteLock,
  getWorkflowDocPath,
  getWorkflowProfilePath,
  loadProfile,
  governanceWriteLockIsHeld,
} from './runtime-io';
import { assertTaskHistoryForRevision, commitSupersedeWithHistory, commitTaskEvolutionWithHistory, recoverTaskEvolution, taskHistoryLocation } from './task-evolution-io';
import { TaskStore, TaskStoreError, taskStorePaths, type TaskStoreManifest, type TaskStorePendingWrite } from './task-store';
import {
  CURRENT_TASK_WORKFLOW_STATUSES,
  RESUME_REVIEW_REASON_ORDER,
  TASK_LIFECYCLE_STATES,
  getTaskArtifactPath,
  extractCurrentTaskStateFromCurrentTask,
  extractTaskIdentityFromCurrentTask,
  normalizeResumeReviewReasons,
  parseBooleanField,
  validateTaskId,
  validateTaskSlug,
  validateCurrentTaskResumeGate,
  validateCurrentTaskStatusTuple,
  type CurrentTaskWorkflowStatus,
  type ResumeReviewReason,
  type TaskArtifactKind,
  type TaskLifecycleState,
} from './task-identity';
import {
  auditCommandMutation,
  evaluateMutationScope,
  MutationScopeError,
  mutationScopePatternIsSubset,
  mutationScopePatternMatchesPath,
  nonExecutableChangePatternIsBounded,
  parseMutationScope,
  type CommandMutationAuditInput,
  type ConditionalScopeAuthorization,
  type MutationScopeEvaluationInput,
  type MutationTransformationKind,
} from './mutation-scope';
import {
  parseImplementationSteps,
  resolveTaskStep,
  TaskStepDefinitionError,
  type TaskStepCheckpointPolicy,
  type TaskStepDefinition,
  type TaskStepResolution,
} from './task-steps';
import {
  BOOTSTRAP_MODES,
  BOOTSTRAP_OPERATION_KINDS,
  type BootstrapMode,
} from './bootstrap';
import {
  STATUS_SECTION_KEYS,
  STATUS_SECTIONS,
  type StatusSectionKey,
} from './status-schema';
import type {
  ImplementationAnchors,
  KnowledgeCandidate,
  KnowledgeAdmissionDisposition,
} from '../../../scripts/project-context-resolver';

export * from './mutation-scope';
export * from './status-schema';

export const VNEXT_RUNTIME_SCHEMA_VERSION = 1 as const;
export const VNEXT_RUNTIME_PROPOSAL_KIND = 'vnext-runtime-proposal' as const;
export const VNEXT_CURRENT_TASK_KIND = 'vnext-current-task' as const;
export const VNEXT_RUNTIME_STATE_KIND = 'vnext-current-task-runtime-state' as const;
export const VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH = '.workflow-system/vnext/RUNTIME_CONTRACT.yaml';
export const VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH = '.workflow-system/runtime';
export const VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH = '.workflow-system/runtime/dist/cli.js';
export const VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH = '.workflow-system/runtime/package.json';
export const VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH = '.workflow-system/runtime/package-lock.json';
export const VNEXT_RUNTIME_PACKAGE_NAME = 'vibe-coding-vnext-runtime';
export const VNEXT_RUNTIME_NODE_MIN_VERSION = '>=20.0.0';
export const VNEXT_RUNTIME_PACKAGE_VERSION = '0.19.5';

export const RUNTIME_OPERATION_KINDS = [
  'task-state-transaction',
  'finding-queue-transaction',
  'lifecycle-transaction',
  'inbox-record-transaction',
  'project-status-transaction',
  'archive-transaction',
  'lesson-record-transaction',
  'contract-candidate-commit',
  'decision-record-transaction',
] as const;
export type RuntimeOperationKind = (typeof RUNTIME_OPERATION_KINDS)[number];

const RUNTIME_SOURCE_TUPLE_FIELDS = [
  'path',
  'revision',
  'document_id',
  'task_id',
  'task_slug',
  'workflow_status',
  'lifecycle_state',
  'active_step_id',
  'active_step_status',
  'finding_queue_revision',
  'resume_requires_review',
  'resume_review_reasons',
] as const;
const RUNTIME_REQUIRED_ENVELOPE_FIELDS = [
  'authority_evidence',
  'semantic_delta',
  'preconditions',
  'evidence_refs',
  'idempotency_key',
  'requested_write_targets',
] as const;
const RUNTIME_STATE_FIELDS = [
  'business_evidence_version',
  'evidence_plan_revision',
  'task_evolution_version',
  'preservation_source_revision',
  'task_id',
  'task_slug',
  'workflow_status',
  'lifecycle_state',
  'resume_requires_review',
  'resume_review_reasons',
  'active_step_id',
  'active_step_status',
  'finding_queue_revision',
  'review_cycle',
  'findings',
  'execution_log',
  'applied_proposals',
  'claim_evidence_required',
  'claim_evidence',
  'pending_review_result',
  'review_coverage',
  'step_attempts',
  'evidence_challenges',
  'evidence_carry_forward',
  'artifact_checkpoint_ids',
] as const;
const REVIEW_CYCLE_FIELDS = [
  'id',
  'cycle_phase',
  'repair_round',
  'counted_repair_wave_ids',
  'active_repair_wave_id',
  'verification_new_finding_wave_used',
  'verification_new_finding_wave_id',
] as const;

export const RUNTIME_RESULT_STATES = ['success', 'no-op', 'conflict', 'blocked'] as const;
export type RuntimeResultState = (typeof RUNTIME_RESULT_STATES)[number];

export const VNEXT_EXECUTE_STEP_MODES = ['default', 'repair'] as const;
export type VNextExecuteStepMode = (typeof VNEXT_EXECUTE_STEP_MODES)[number];
export const PREPARE_TASK_MODES = ['default', 'confirm', 'replan'] as const;
export type PrepareTaskMode = (typeof PREPARE_TASK_MODES)[number];

export const LIFECYCLE_MODES = ['pause', 'interrupt', 'resume-paused', 'resume-interrupted', 'supersede'] as const;
export type LifecycleMode = (typeof LIFECYCLE_MODES)[number];
export const CLOSE_TASK_MODES = ['default'] as const;
export type CloseTaskMode = (typeof CLOSE_TASK_MODES)[number];

export const INBOX_ITEM_TYPES = ['requirement', 'idea', 'bug', 'chore', 'question'] as const;
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];
export const INBOX_ITEM_SOURCES = ['user', 'implementation', 'review', 'regression', 'root_cause', 'other'] as const;
export type InboxItemSource = (typeof INBOX_ITEM_SOURCES)[number];
export const INBOX_SUGGESTED_NEXT_ACTIONS = ['triage_later', 'ask_user'] as const;
export type InboxSuggestedNextAction = (typeof INBOX_SUGGESTED_NEXT_ACTIONS)[number];

export const REVIEW_CYCLE_PHASES = ['discovery', 'verification'] as const;
export type ReviewCyclePhase = (typeof REVIEW_CYCLE_PHASES)[number];

export const STEP_STATUSES = ['ready', 'in-progress', 'completed', 'blocked'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const STEP_EXECUTION_RESULT_STATUSES = ['passed', 'expected-failure', 'failed', 'blocked', 'not-run'] as const;
export type StepExecutionResultStatus = (typeof STEP_EXECUTION_RESULT_STATUSES)[number];

export const FINDING_STATUSES = ['admitted', 'in-progress', 'resolved', 'deferred', 'rejected'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const REPLAN_TASK_STATE_ACTIONS = ['mark-replan-blocked', 'clear-replan-block', 'commit-replan'] as const;
export type ReplanTaskStateAction = (typeof REPLAN_TASK_STATE_ACTIONS)[number];

export const DRAFT_TASK_STATE_ACTIONS = ['create-draft', 'update-draft', 'confirm-draft'] as const;
export type DraftTaskStateAction = (typeof DRAFT_TASK_STATE_ACTIONS)[number];

export const CLAIM_EVIDENCE_MIGRATION_ACTIONS = ['migrate-claim-evidence'] as const;
export type ClaimEvidenceMigrationAction = (typeof CLAIM_EVIDENCE_MIGRATION_ACTIONS)[number];

export const REVIEW_TASK_STATE_ACTIONS = ['record-review-result'] as const;
export type ReviewTaskStateAction = (typeof REVIEW_TASK_STATE_ACTIONS)[number];

export const DRAFT_AUDIT_ACTIONS = ['create-draft', 'update-draft', 'confirm-draft'] as const;
export type DraftAuditAction = (typeof DRAFT_AUDIT_ACTIONS)[number];

export const REPLAN_AUDIT_ACTIONS = [
  'supersede',
  'mark-replan-blocked',
  'clear-replan-block',
  'commit-replan',
] as const;
export type ReplanAuditAction = (typeof REPLAN_AUDIT_ACTIONS)[number];

export const FINDING_ACTIONS = ['admit', 'record-repair-attempt', 'resolve', 'defer', 'reject'] as const;
export type FindingAction = (typeof FINDING_ACTIONS)[number];

export const STEP_ADVANCEMENT_OUTCOMES = [
  'not-applicable',
  'repair-awaiting-verification',
  'advanced',
  'task-complete',
] as const;
export type StepAdvancementOutcome = (typeof STEP_ADVANCEMENT_OUTCOMES)[number];

const DOCUMENT_ID_PATTERN = /^doc-[a-f0-9]{24}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const FINGERPRINT_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TEXT_LENGTH = 4000;
const MAX_EVIDENCE_REFS = 32;
const MAX_FINDINGS = 256;
const MAX_APPLIED_PROPOSALS = 256;
const MAX_EXECUTION_LOG = 256;
const MAX_EXECUTION_RESULT_ITEMS = 256;
const MAX_CLAIM_EVIDENCE_RECORDS = 256;
const MAX_CLAIM_EVIDENCE_SLOTS = 32;
const MAX_REPLAN_SECTION_CONTENT_LENGTH = 32768;
export const MAX_REPAIR_ROUNDS = 3;
const CLAIM_EVIDENCE_COMPLETION_RULE = 'non-empty acceptance-bearing frozen plan; due slots require bound successful reports and applicable subject revisions; close checks all slots and consumed prerequisites';
const DRAFT_CLAIM_EVIDENCE_REQUIREMENT = 'required-and-non-empty-for-new-or-refined-drafts; must-include-an-acceptance-claim; legacy-documents-remain-readable-but-require-migration-before-terminal-completion';
const CLOSE_TASK_CLAIM_EVIDENCE_RULE = 'derive acceptance_satisfied and validation_complete from the non-empty frozen CURRENT_TASK claim_evidence plan; require an acceptance claim; aggregate command success is insufficient';
export const MAX_REPAIR_ATTEMPTS = 2;
const CURRENT_TASK_RELATIVE_FALLBACK = 'docs/workflow/CURRENT_TASK.md';
const INBOX_RECORD_ITEM_ID_PATTERN = /^(\d{8})-([a-z0-9]{4,})$/;
const INBOX_RECORD_PATH_PATTERN = /^TASKS\/inbox\/INBOX-(\d{8})-([a-z0-9]{4,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const INBOX_RECORD_PROVENANCE_MARKER = '<!-- vNext inbox record:';
const MAX_INBOX_TEXT_LENGTH = 32768;
const INBOX_CAPTURE_PRECONDITIONS = [
  'current-task-is-active',
  'relation-proven-unrelated',
  'duplicate-check-clear',
  'owner-route-resolved',
] as const;

type AnyRecord = Record<string, unknown>;

export type AuthorityEvidence = {
  kind: 'active-task-owner' | 'scope-admission' | 'finding-admission' | 'evidence-admission' | 'dangerous-operation' | 'resume-review' | 'user-confirmation' | 'authorized-caller';
  source: string;
  subject: string;
  task_id?: string;
  document_id?: string;
  draft_revision?: string;
  source_revision?: string;
};

export type RuntimeSourceTuple = {
  path: string;
  revision: string;
  document_id: string;
  task_id: string;
  task_slug: string;
  workflow_status: CurrentTaskWorkflowStatus;
  lifecycle_state: TaskLifecycleState;
  active_step_id: string;
  active_step_status: StepStatus;
  finding_queue_revision: number;
  resume_requires_review: boolean;
  resume_review_reasons: ResumeReviewReason[];
};

export type PartialDiffDisposition = {
  reusable: string[];
  rollback_required: string[];
  stop_propagation: string[];
};

export type ReplanReplacementDefinition = {
  background_context: string;
  acceptance: string;
  allowed_scope: string;
  conditional_scope: string;
  forbidden_scope: string;
  affected_contracts: string;
  confirmed_decisions: string;
  open_questions: string;
  implementation_plan: string;
  implementation_steps: string;
  regression_checks: string;
  rollback_points: string;
  design_constraints: string | null;
  post_release_validation: string | null;
  propagation_governance: string | null;
};

export type DraftTaskDefinition = ReplanReplacementDefinition;

export const TEST_STRATEGY_MODES = [
  'flexible',
  'test-first',
  'implementation-first',
  'not-applicable',
] as const;
export type TestStrategyMode = (typeof TEST_STRATEGY_MODES)[number];

export const TEST_STRATEGY_SOURCES = [
  'explicit-user',
  'project-policy',
  'inferred-default',
] as const;
export type TestStrategySource = (typeof TEST_STRATEGY_SOURCES)[number];

export const TEST_STRATEGY_CLASSIFICATIONS = [
  'contract-clear-behavior',
  'exploratory-or-infrastructure',
  'non-executable-change',
] as const;
export type TestStrategyClassification = (typeof TEST_STRATEGY_CLASSIFICATIONS)[number];

export type TestStrategyDefinition = {
  mode: TestStrategyMode;
  source: TestStrategySource;
  source_ref: string;
  task_classification: TestStrategyClassification;
  rationale: string;
};

export type TestStrategyExecutionPhase = 'flexible' | 'test-first' | 'red' | 'green' | 'implementation-first' | 'not-applicable' | 'legacy';

export type TestStrategyExecutionContext = {
  mode: TestStrategyMode | 'legacy';
  phase: TestStrategyExecutionPhase;
  required_outcome: 'test-red' | 'implemented';
  persistent_tests: string[];
  step_index: number;
  first_step_id: string;
};

export type TaskBasisSource = {
  source: string;
  verbatim: string;
};

export type TaskBasis = {
  original_request: TaskBasisSource;
  user_decisions: TaskBasisSource[];
};

export type TaskBasisReference = {
  path: string;
  revision: string;
};

export const CLAIM_KINDS = [
  'acceptance',
  'regression',
  'invariant',
  'bug-reproduction',
  'compatibility',
  'release',
  'exploration',
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_EVIDENCE_DISPOSITIONS = [
  'existing',
  'reused',
  'newly-executed',
  'missing',
  'deferred',
  'blocked',
] as const;
export type ClaimEvidenceDisposition = (typeof CLAIM_EVIDENCE_DISPOSITIONS)[number];

export type ClaimEvidenceSlot = {
  slot_id: string;
  minimum_type: string;
  disposition: ClaimEvidenceDisposition;
  evidence_refs: string[];
  due_step_id?: string;
  applicability?: 'current' | 'before-step';
  before_step_id?: string;
  check?: EvidenceCheck;
  report?: EvidenceReport | null;
  prerequisite_receipt?: { step_id: string; preflight_id: string; result_id: string; subject_snapshot: ReviewTarget } | null;
};

export type EvidenceCheck = {
  check_id: string;
  method: 'execution' | 'static' | 'human';
  entry: string;
  expected_observation: string;
  required_boundaries: string[];
  allowed_substitutes: string[];
  subject_paths: string[];
  expected_result: 'passed' | 'accepted' | 'expected-failure';
};

export type EvidenceReport = {
  result_id: string;
  status: 'passed' | 'failed' | 'blocked' | 'not-run' | 'skipped' | 'accepted' | 'expected-failure';
  evidence_plan_revision: string;
  subject_revision: string;
  actual_method: EvidenceCheck['method'];
  environment: string;
  assurance: 'caller-reported';
};

export type EvidenceChallenge = {
  challenge_id: string;
  claim_id: string;
  slot_id: string;
  result_id: string;
  evidence_ref: string;
  evidence_sha256: string;
  reason: string;
  status: 'contested' | 'invalidated' | 'resolved';
  source_revision: string;
  correction_step_id: string | null;
  resolution?: {
    kind: 'not-substantiated';
    evidence_ref: string;
    evidence_sha256: string;
    reason: string;
    source_revision: string;
  };
};

export type EvidenceCarryForward = {
  kind: 'evidence-carry-forward/v1' | 'evidence-carry-forward/v2';
  receiving_source_revision?: string;
  evidence_objects?: EvidenceObject[];
  context_revision?: string;
  old_source_revision: string;
  old_plan_revision: string;
  new_plan_revision: string;
  claim_id: string;
  slot_id: string;
  check_id: string;
  result_id: string;
  report_sha256: string;
  subject_revision: string;
};

export type ClaimEvidenceRecord = {
  claim_id: string;
  claim_kind: ClaimKind;
  requirement?: string;
  source_ref?: string;
  slots: ClaimEvidenceSlot[];
};

export type DraftTaskIdentity = {
  task_id: string;
  task_slug: string;
  document_id: string;
  task_title: string;
};

export type StepReviewReceipt = {
  cycle_id: string;
  cycle_phase: ReviewCyclePhase;
  change_set_id: string;
  review_target_revision: string;
  verdict: 'clean';
  admitted_fingerprints: string[];
  evidence_refs: string[];
};

export const REVIEW_RESULT_VERDICTS = ['clean', 'findings', 'blocked'] as const;
export type ReviewResultVerdict = (typeof REVIEW_RESULT_VERDICTS)[number];

export const REVIEW_BLOCKER_ROUTES = ['review-change', 'debug-task', 'prepare-task:replan', 'user'] as const;
export type ReviewBlockerRoute = (typeof REVIEW_BLOCKER_ROUTES)[number];

export type ReviewFindingCandidate = {
  fingerprint: string;
  category: string;
  file: string;
  failure_condition: string;
  required_behavior: string;
  root_cause_status: 'confirmed' | 'bounded';
  evidence_refs: string[];
};

export type ReviewBlocker = {
  code: string;
  summary: string;
  next_route: ReviewBlockerRoute;
};

export type TestAssessment = {
  applicable: boolean; reason: string; evidence_refs: string[];
  necessity: string; oracle: string; boundary: string; reuse: string; applicability: string;
};
export type ReviewCoverage = {
  change_set_id: string; base: ReviewTarget; target: ReviewTarget;
  preimages: Array<ReviewTargetEntry & { content_base64: string | null }>;
  pending_paths: string[]; last_clean_revision: string | null;
};

export type PendingReviewResult = {
  test_assessment?: TestAssessment;
  kind: 'review-result/v1';
  review_id: string;
  execution_id: string;
  step_id: string;
  cycle_id: string;
  cycle_phase: ReviewCyclePhase;
  change_set_id: string;
  review_target_revision: string;
  verdict: ReviewResultVerdict;
  findings: ReviewFindingCandidate[];
  unresolved_fingerprints: string[];
  evidence_refs: string[];
  blocker: ReviewBlocker | null;
  recorded_at: string;
};

export type ReviewTargetEntry = {
  path: string;
  state: 'file' | 'absent' | 'symlink';
  sha256: string | null;
};

export type ReviewTarget = {
  kind: 'runtime-file-manifest/v1';
  revision: string;
  entries: ReviewTargetEntry[];
};

export type ReviewChangeDeltaEntry = {
  path: string;
  before_state: ReviewTargetEntry['state'];
  before_sha256: string | null;
  after_state: ReviewTargetEntry['state'];
  after_sha256: string | null;
};

export type ReviewChangeDelta = {
  kind: 'runtime-file-delta/v1';
  base_revision: string;
  target_revision: string;
  entries: ReviewChangeDeltaEntry[];
};

export type StepCommandResult = {
  command: string;
  status: StepExecutionResultStatus;
  observed_repo_writes: string[];
  evidence_refs: string[];
  expected_failure?: StepExpectedFailureEvidence;
};

export type StepValidationResult = {
  validation: string;
  status: StepExecutionResultStatus;
  evidence_refs: string[];
  expected_failure?: StepExpectedFailureEvidence;
};

export type StepExpectedFailureEvidence = {
  kind: 'behavior-not-implemented';
  expected_behavior: string;
  observed_failure_signature: string;
};

export type StepAcceptanceEvidence = {
  claim_id: string;
  slot_id: string;
  check_id: string;
  minimum_type: string;
  disposition: ClaimEvidenceDisposition;
  evidence_refs: string[];
  report: EvidenceReport;
};

export type StepExecutionResult = {
  attempt_id?: string;
  blocker_kind?: 'environment' | 'unknown';
  outcome: 'implemented' | 'test-red' | 'blocked';
  change_set_id: string;
  review_base: ReviewTarget;
  review_target: ReviewTarget;
  change_delta: ReviewChangeDelta;
  actual_changed_paths: string[];
  command_results: StepCommandResult[];
  validation_results: StepValidationResult[];
  acceptance_evidence: Array<StepAcceptanceEvidence | { acceptance: string; evidence_refs: string[] }>;
  blocker: string | null;
};

export type TaskStepProgressDelta = {
  kind: 'task-state';
  action: 'step-progress';
  step_id: string;
  status: StepStatus;
  evidence_refs: string[];
  note?: string;
  repair_fingerprint?: string;
  repair_fingerprints?: string[];
  repair_wave_id?: string;
  change_set_id?: string;
  review_receipt?: StepReviewReceipt;
  claim_evidence?: ClaimEvidenceRecord[];
  execution_result?: StepExecutionResult;
};

export type TaskStateDelta =
  | TaskStepProgressDelta
  | { kind: 'task-state'; action: 'retry-step'; step_id: string; blocked_attempt_id: string; blocker_resolution_refs: string[]; repair_diagnosis?: StepRepairDiagnosis; evidence_refs: string[] }
  | { kind: 'task-state'; action: 'record-step-preflight'; step_id: string; candidate_paths: string[]; evidence_refs: string[] }
  | {
      kind: 'task-state';
      action: 'create-draft' | 'update-draft';
      task_id: string;
      task_slug: string;
      document_id: string;
      task_title: string;
      task_basis: TaskBasis;
      draft_definition: DraftTaskDefinition;
      active_step_id: string;
      evidence_refs: string[];
      claim_evidence?: ClaimEvidenceRecord[];
    }
  | {
      kind: 'task-state';
      action: 'confirm-draft';
      task_id: string;
      task_slug: string;
      document_id: string;
      draft_revision: string;
      evidence_refs: string[];
    }
  | {
      kind: 'task-state';
      action: 'migrate-claim-evidence';
      claim_evidence: ClaimEvidenceRecord[];
      evidence_refs: string[];
    }
  | {
      kind: 'task-state';
      action: 'clear-resume-review-gate';
      evidence_refs: string[];
    }
  | {
      kind: 'task-state';
      action: 'mark-replan-blocked' | 'clear-replan-block';
      evidence_refs: string[];
    }
  | {
      kind: 'task-state';
      action: 'commit-replan';
      task_basis: TaskBasis;
      replacement_definition: ReplanReplacementDefinition;
      active_step_id: string;
      evidence_refs: string[];
      claim_evidence?: ClaimEvidenceRecord[];
    }
  | {
      kind: 'task-state';
      action: 'record-evidence-challenge';
      claim_id: string;
      slot_id: string;
      result_id: string;
      evidence_ref: string;
      evidence_sha256: string;
      reason: string;
      evidence_refs: string[];
    }
  | {
      kind: 'task-state';
      action: 'dismiss-evidence-challenge';
      challenge_id: string;
      evidence_ref: string;
      evidence_sha256: string;
      reason: string;
      evidence_refs: string[];
    }
  | {
      kind: 'task-state';
      action: 'record-review-result';
      review_result: Omit<PendingReviewResult, 'recorded_at'>;
      evidence_refs: string[];
    };

export type ReplanDelta = Extract<TaskStateDelta, { action: 'commit-replan' }>;

type LifecycleSnapshotEvidence = {
  kind: 'lifecycle';
  task_start_base: string;
  last_reviewed_checkpoint: string;
  current_diff_review_target: string;
  rollback_conditions: string;
  resume_review_reasons: ResumeReviewReason[];
  evidence_refs: string[];
};

export type LifecycleDelta =
  | (LifecycleSnapshotEvidence & {
      action: 'pause';
      lifecycle_state: Extract<TaskLifecycleState, 'paused_pending_closure' | 'paused_blocked'>;
      suspension_reason: string;
      blocker_status?: string;
      blocking_evidence?: string;
      remaining_acceptance?: string;
      failed_checks?: string[];
    })
  | (LifecycleSnapshotEvidence & {
      action: 'interrupt';
      lifecycle_state: 'interrupted';
      suspension_reason: string;
      checkpoint_evidence: string;
      dirty_attribution: string;
      environment_state: string;
      recovery_strategy: string;
    })
  | {
      kind: 'lifecycle';
      action: 'resume-paused' | 'resume-interrupted';
      artifact_kind: Extract<TaskArtifactKind, 'paused' | 'interrupted'>;
      recovery_package_path: string;
      recovery_package_revision: string;
      resume_review_reasons: ResumeReviewReason[];
      evidence_refs: string[];
    }
  | {
      kind: 'lifecycle';
      action: 'supersede';
      invalidation_kind: 'goal' | 'scope' | 'acceptance';
      invalidation_reason: string;
      evidence_refs: string[];
      partial_diff_disposition: PartialDiffDisposition;
    };

export type SupersedeDelta = Extract<LifecycleDelta, { action: 'supersede' }>;

export type FindingRecord = {
  fingerprint: string;
  category: string;
  owner_task_id: string;
  scope: 'admitted';
  decision: 'mechanical';
  file: string;
  failure_condition: string;
  violated_invariant: string;
  root_cause_status: 'confirmed' | 'bounded';
  status: FindingStatus;
  repair_attempts: number;
  max_repair_attempts: number;
  evidence_refs: string[];
  review_cycle_id: string;
  last_repair_wave_id: string | null;
  admitted_at: string;
  updated_at: string;
};

export type FindingQueueDelta =
  | {
      kind: 'finding-queue';
      action: 'admit';
      cycle_phase: ReviewCyclePhase;
      finding_admission_wave_id: string;
      finding: Omit<FindingRecord, 'status' | 'repair_attempts' | 'last_repair_wave_id' | 'admitted_at' | 'updated_at'> & {
        status?: 'admitted';
        repair_attempts?: 0;
      };
    }
  | {
      kind: 'finding-queue';
      action: 'record-repair-attempt';
      fingerprint: string;
      review_cycle_id: string;
      repair_wave_id: string;
      evidence_refs: string[];
      note?: string;
    }
  | {
      kind: 'finding-queue';
      action: 'resolve' | 'defer' | 'reject';
      fingerprint: string;
      evidence_refs: string[];
      note?: string;
    };

export type ReleaseClosureEvidence = {
  triggered: boolean;
  complete: boolean;
  evidence_refs: string[];
};

export type ClosureEvidence = {
  acceptance_satisfied: boolean;
  validation_complete: boolean;
  no_admitted_or_in_progress_findings: boolean;
  no_unresolved_closure_blocker: boolean;
  release_evidence: ReleaseClosureEvidence;
  rollback_evidence: ReleaseClosureEvidence;
  observation_evidence: ReleaseClosureEvidence;
  remaining_risks_non_blocking: boolean;
  archive_path_verified: boolean;
};

export type DeliverySummary = {
  goal: string;
  actual_changes: string[];
  verification: string[];
  release_evidence: string[];
  rollback_evidence: string[];
  observation_evidence: string[];
  next_action: string;
};

export type LessonAdmission = {
  decision: 'admit' | 'defer' | 'no-op';
  candidate_refs: string[];
  evidence_refs: string[];
};

export type ArchiveDelta = {
  kind: 'archive';
  action: 'archive';
  closure_evidence: ClosureEvidence;
  delivery_summary: DeliverySummary;
  remaining_risks: string[];
  lesson_admission: LessonAdmission;
  knowledge_admissions?: KnowledgeAdmissionBundle;
  evidence_refs: string[];
};

export type KnowledgeAdmissionRecord = {
  candidate: KnowledgeCandidate;
  disposition: KnowledgeAdmissionDisposition;
  matched_knowledge_id: string | null;
  reasons: string[];
};

export type KnowledgeAdmissionBundle = {
  contracts: KnowledgeAdmissionRecord[];
  decisions: KnowledgeAdmissionRecord[];
};

export type KnowledgeProvenance = {
  task_id: string;
  task_slug: string;
  document_id: string;
  archive_path: string;
  archive_revision: string;
  source_revision: string;
  evidence_refs: string[];
};

export type KnowledgeDelta = {
  kind: 'knowledge';
  action: 'promote';
  knowledge_kind: 'contract' | 'decision';
  admission: KnowledgeAdmissionRecord;
  provenance: KnowledgeProvenance;
  evidence_refs: string[];
};

export type ProjectStatusDelta = {
  kind: 'project-status';
  action: 'sync';
  status: 'completed' | 'observing';
  summary: string;
  completed_items: string[];
  remaining_risks: string[];
  next_checkpoint: string;
  evidence_refs: string[];
};

export type LessonCandidate = {
  candidate_ref: string;
  category: '通用' | '数据与存储' | '前端与交互' | '后端与服务' | '测试与回归' | '部署与运行时';
  scene: string;
  conclusion: string;
  trigger: string;
  cause: string;
  action: string;
  consumer: string;
  evidence_refs: string[];
};

export type LessonRecordDelta = {
  kind: 'lesson-record';
  action: 'record';
  candidates: LessonCandidate[];
  evidence_refs: string[];
};

export type InboxRecord = {
  artifact_kind: 'inbox_item';
  item_id: string;
  title: string;
  type: InboxItemType;
  source: InboxItemSource;
  captured_at: string;
  relation_to_current_task: 'unrelated';
  current_task_id: string;
  description: string;
  evidence: string;
  suggested_next_action: InboxSuggestedNextAction;
  status: 'captured';
};

export type InboxRecordDelta = {
  kind: 'inbox-record';
  action: 'record';
  item_slug: string;
  record: InboxRecord;
  relation_evidence_refs: string[];
  duplicate_check: 'clear';
  proposed_owner: InboxSuggestedNextAction;
  target_path: string;
  evidence_refs: string[];
};

export type RuntimeSemanticDelta = TaskStateDelta | FindingQueueDelta | LifecycleDelta | ArchiveDelta | ProjectStatusDelta | LessonRecordDelta | InboxRecordDelta | KnowledgeDelta;

export type ReviewCycleState = {
  id: string;
  cycle_phase: ReviewCyclePhase;
  repair_round: number;
  counted_repair_wave_ids: string[];
  active_repair_wave_id: string | null;
  verification_new_finding_wave_used: boolean;
  verification_new_finding_wave_id: string | null;
};

export function createReviewCycleZero(): ReviewCycleState {
  return {
    id: 'review-cycle-0',
    cycle_phase: 'discovery',
    repair_round: 0,
    counted_repair_wave_ids: [],
    active_repair_wave_id: null,
    verification_new_finding_wave_used: false,
    verification_new_finding_wave_id: null,
  };
}

export type StepExecutionLogEntry = {
  idempotency_key: string;
  mode: VNextExecuteStepMode;
  step_id: string;
  status: StepStatus;
  evidence_refs: string[];
  note?: string;
  repair_fingerprint?: string;
  repair_fingerprints?: string[];
  repair_wave_id?: string;
  change_set_id?: string;
  checkpoint?: TaskStepCheckpointPolicy;
  advancement?: StepAdvancementOutcome;
  next_step_id?: string | null;
  review_receipt?: StepReviewReceipt;
  claim_evidence?: ClaimEvidenceRecord[];
  execution_result?: StepExecutionResult;
  recorded_at: string;
};

export type StepAdvancementResult = {
  outcome: StepAdvancementOutcome;
  from_step_id: string;
  to_step_id: string | null;
  checkpoint: TaskStepCheckpointPolicy;
  review_phase?: ReviewCyclePhase;
};

export type ReplanAuditLogEntry = {
  action: ReplanAuditAction;
  idempotency_key: string;
  operation_kind: Extract<RuntimeOperationKind, 'task-state-transaction' | 'lifecycle-transaction'>;
  caller: Extract<RuntimeProposal['caller'], 'prepare-task' | 'task-lifecycle'>;
  mode: PrepareTaskMode | 'supersede';
  task_id: string;
  task_slug: string;
  document_id: string;
  from_workflow_status: CurrentTaskWorkflowStatus;
  from_lifecycle_state: TaskLifecycleState;
  to_workflow_status: CurrentTaskWorkflowStatus;
  to_lifecycle_state: TaskLifecycleState;
  source_revision: string;
  authority_evidence: AuthorityEvidence[];
  evidence_refs: string[];
  partial_diff_disposition?: PartialDiffDisposition;
  invalidation_kind?: 'goal' | 'scope' | 'acceptance';
  invalidation_reason?: string;
  candidate_digest?: string;
  correction_reason?: string;
  recorded_at: string;
};

export type ArchiveAuditLogEntry = {
  action: 'archive';
  idempotency_key: string;
  operation_kind: 'archive-transaction';
  caller: 'close-task';
  mode: CloseTaskMode;
  task_id: string;
  task_slug: string;
  document_id: string;
  from_workflow_status: 'active';
  from_lifecycle_state: 'active';
  to_workflow_status: 'closed';
  to_lifecycle_state: 'archived';
  source_revision: string;
  archive_path: string;
  archive_revision: string;
  closure_delta_digest: string;
  authority_evidence: AuthorityEvidence[];
  evidence_refs: string[];
  lesson_admission: LessonAdmission;
  knowledge_admissions: KnowledgeAdmissionBundle;
  recorded_at: string;
};

export type DraftAuditLogEntry = {
  action: DraftAuditAction;
  idempotency_key: string;
  operation_kind: 'task-state-transaction';
  caller: 'prepare-task';
  mode: 'default' | 'confirm';
  from_task_id: string;
  from_task_slug: string;
  from_document_id: string;
  task_id: string;
  task_slug: string;
  document_id: string;
  from_workflow_status: CurrentTaskWorkflowStatus;
  from_lifecycle_state: TaskLifecycleState;
  to_workflow_status: CurrentTaskWorkflowStatus;
  to_lifecycle_state: TaskLifecycleState;
  source_revision: string;
  authority_evidence: AuthorityEvidence[];
  evidence_refs: string[];
  definition_digest?: string;
  claim_evidence_digest?: string;
  draft_revision?: string;
  recorded_at: string;
};

export type ClaimEvidenceMigrationAuditLogEntry = {
  action: 'migrate-claim-evidence';
  idempotency_key: string;
  operation_kind: 'task-state-transaction';
  caller: 'prepare-task';
  mode: 'default';
  from_task_id: string;
  from_task_slug: string;
  from_document_id: string;
  task_id: string;
  task_slug: string;
  document_id: string;
  from_workflow_status: 'active';
  from_lifecycle_state: 'active';
  to_workflow_status: 'active';
  to_lifecycle_state: 'active';
  source_revision: string;
  authority_evidence: AuthorityEvidence[];
  evidence_refs: string[];
  claim_evidence_digest: string;
  recorded_at: string;
};

export type ExecutionLogEntry = StepExecutionLogEntry | DraftAuditLogEntry | ClaimEvidenceMigrationAuditLogEntry | ReplanAuditLogEntry | ArchiveAuditLogEntry;
type RuntimeAuditLogEntry = DraftAuditLogEntry | ClaimEvidenceMigrationAuditLogEntry | ReplanAuditLogEntry | ArchiveAuditLogEntry;

export type RuntimeProposal = {
  schema_version: typeof VNEXT_RUNTIME_SCHEMA_VERSION;
  kind: typeof VNEXT_RUNTIME_PROPOSAL_KIND;
  operation_kind: RuntimeOperationKind;
  caller: 'execute-step' | 'review-change' | 'prepare-task' | 'task-lifecycle' | 'capture-work-item' | 'close-task';
  mode: VNextExecuteStepMode | PrepareTaskMode | LifecycleMode | CloseTaskMode;
  source_tuple: RuntimeSourceTuple;
  authority_evidence: AuthorityEvidence[];
  semantic_delta: RuntimeSemanticDelta;
  preconditions: string[];
  evidence_refs: string[];
  idempotency_key: string;
  requested_write_targets: string[];
};

export type LifecycleProposal = RuntimeProposal & {
  operation_kind: 'lifecycle-transaction';
  caller: 'task-lifecycle';
  mode: LifecycleMode;
  semantic_delta: LifecycleDelta;
};

export type ArchiveProposal = RuntimeProposal & {
  operation_kind: 'archive-transaction';
  caller: 'close-task';
  mode: CloseTaskMode;
  semantic_delta: ArchiveDelta;
};

export type ProjectStatusProposal = RuntimeProposal & {
  operation_kind: 'project-status-transaction';
  caller: 'close-task';
  mode: CloseTaskMode;
  semantic_delta: ProjectStatusDelta;
};

export type LessonRecordProposal = RuntimeProposal & {
  operation_kind: 'lesson-record-transaction';
  caller: 'close-task';
  mode: CloseTaskMode;
  semantic_delta: LessonRecordDelta;
};

export type KnowledgeProposal = RuntimeProposal & {
  operation_kind: 'contract-candidate-commit' | 'decision-record-transaction';
  caller: 'close-task';
  mode: CloseTaskMode;
  semantic_delta: KnowledgeDelta;
};

export type ContractCandidateProposal = KnowledgeProposal & {
  operation_kind: 'contract-candidate-commit';
  semantic_delta: KnowledgeDelta & { knowledge_kind: 'contract' };
};

export type DecisionRecordProposal = KnowledgeProposal & {
  operation_kind: 'decision-record-transaction';
  semantic_delta: KnowledgeDelta & { knowledge_kind: 'decision' };
};

export type InboxRecordProposal = RuntimeProposal & {
  operation_kind: 'inbox-record-transaction';
  caller: 'capture-work-item';
  mode: 'default';
  semantic_delta: InboxRecordDelta;
};

export type StepRepairDiagnosis = { kind: 'same-plan-repair/v1'; status: 'confirmed'; owner: 'current-step'; failed_check: string; cause: string; repair_paths: string[] };

export type StepAttempt = {
  attempt_id: string; idempotency_key: string; request_digest: string | null;
  status: 'ready' | 'preflighted' | 'blocked' | 'implemented';
  blocker: { kind: 'environment' | 'unknown'; execution_result: StepExecutionResult; subject_snapshot: ReviewTarget } | null;
  recovery?: StepRepairDiagnosis;
  evidence_refs: string[];
};
export type StepAttemptLedger = { evidence_plan_revision: string; max_attempts: 3; attempts: StepAttempt[] };

export type RuntimeState = {
  business_evidence_version?: 1;
  evidence_plan_revision?: string;
  task_evolution_version?: 1 | 2;
  preservation_source_revision?: string;
  schema_version: typeof VNEXT_RUNTIME_SCHEMA_VERSION;
  kind: typeof VNEXT_RUNTIME_STATE_KIND;
  task_id: string;
  task_slug: string;
  workflow_status: CurrentTaskWorkflowStatus;
  lifecycle_state: TaskLifecycleState;
  resume_requires_review: boolean;
  resume_review_reasons: ResumeReviewReason[];
  active_step_id: string;
  active_step_status: StepStatus;
  finding_queue_revision: number;
  review_cycle: ReviewCycleState;
  findings: FindingRecord[];
  execution_log: ExecutionLogEntry[];
  applied_proposals: Array<{
    idempotency_key: string;
    operation_kind: RuntimeOperationKind;
    proposal_digest: string;
    source_revision: string;
  }>;
  /**
   * Legacy CURRENT_TASK documents may omit these fields and remain readable,
   * but terminal completion requires prepare-task migration. New/refined
   * drafts set claim_evidence_required=true with a non-empty acceptance-bearing
   * plan; execution may only fulfill its existing slots.
   */
  claim_evidence_required?: boolean;
  claim_evidence?: ClaimEvidenceRecord[];
  pending_review_result: PendingReviewResult | null;
  review_coverage?: ReviewCoverage;
  step_attempts?: Record<string, StepAttemptLedger>;
  evidence_challenges?: EvidenceChallenge[];
  evidence_carry_forward?: EvidenceCarryForward[];
  artifact_checkpoint_ids?: string[];
};

export type CurrentTaskStoreBinding = {
  schema_version: 1;
  kind: 'vnext-current-task-store-binding';
  format: 'compact-v2';
  manifest_path: string;
  history: {
    execution_log: 'task-store';
    applied_proposals: 'task-store';
  };
};

export type CanonicalCurrentTask = {
  filePath: string;
  relativePath: string;
  raw: string;
  frontmatter: AnyRecord;
  body: string;
  runtimeState: RuntimeState;
  sourceTuple: RuntimeSourceTuple;
};

export type RuntimeResult = {
  evidence_assurance?: 'caller-reported';
  status: RuntimeResultState;
  operation_kind: RuntimeOperationKind;
  idempotency_key: string;
  target_path: string;
  dry_run: boolean;
  committed: boolean;
  message: string;
  code?: string;
  previous_revision?: string;
  resulting_revision?: string;
  archive_path?: string;
  archive_revision?: string;
  planned_writes: string[];
  governed_mutation_count: number;
  read_back_verified: boolean;
  task_store?: {
    manifest_path: string;
    source_revision: string;
    definition_revision: string;
    state_revision: string;
    event_sequence: number;
  };
  advancement?: StepAdvancementResult;
  state?: {
    task_id: string;
    workflow_status: CurrentTaskWorkflowStatus;
    lifecycle_state: TaskLifecycleState;
    resume_requires_review: boolean;
    resume_review_reasons: ResumeReviewReason[];
    active_step_id: string;
    active_step_status: StepStatus;
    finding_queue_revision: number;
    review_cycle_id: string;
    repair_round: number;
    finding_status?: FindingStatus;
    recovery_package_path?: string;
  };
};

export type RuntimeApplyOptions = {
  dryRun?: boolean;
  now?: () => string;
};

export type VNextRuntimeContractValidationResult = {
  phase: 'Phase 2';
  runtime_distribution: {
    kind: 'project-local-node';
    package_path: string;
    entrypoint: string;
    package_version: string;
    node_min_version: string;
    package_lock_sha256: string;
    entrypoint_sha256: string;
  };
  mutation_scope: {
    status: 'bound';
    binding: 'vnext-runtime-read-only';
    check_command: 'scope-check';
  };
  bound_operations: RuntimeOperationKind[];
  unbound_operations: string[];
  bootstrap_operations: string[];
};

export class VNextRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'VNextRuntimeError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(code: string, message: string): never {
  throw new VNextRuntimeError(code, message);
}

function expectRecord(value: unknown, location: string): AnyRecord {
  if (!isRecord(value)) fail('RUNTIME_SCHEMA_INVALID', `${location} must be a mapping.`);
  return value;
}

function expectExactKeys(value: AnyRecord, expected: readonly string[], location: string): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const extra = Object.keys(value).filter(key => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      'RUNTIME_SCHEMA_INVALID',
      `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`,
    );
  }
}

function expectString(value: unknown, location: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} has an invalid value.`);
  }
  return normalized;
}

function expectNullableString(value: unknown, location: string, pattern?: RegExp): string | null {
  if (value === null) return null;
  return expectString(value, location, pattern);
}

function expectText(value: unknown, location: string, maxLength = MAX_TEXT_LENGTH): string {
  const text = expectString(value, location);
  if (text.length > maxLength) fail('RUNTIME_SCHEMA_INVALID', `${location} exceeds ${maxLength} characters.`);
  return text;
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], location: string): T {
  const normalized = expectString(value, location);
  if (!allowed.includes(normalized as T)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must be one of [${allowed.join(', ')}].`);
  }
  return normalized as T;
}

function expectBoolean(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') fail('RUNTIME_SCHEMA_INVALID', `${location} must be a boolean.`);
  return value;
}

function expectInteger(value: unknown, location: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must be an integer in [${min}, ${max}].`);
  }
  return value;
}

function expectStringArray(value: unknown, location: string, allowEmpty = false, maxLength = 128): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must be ${allowEmpty ? 'an array' : 'a non-empty array'}.`);
  }
  if (value.length > maxLength) fail('RUNTIME_SCHEMA_INVALID', `${location} has too many entries.`);
  const items = value.map((item, index) => expectText(item, `${location}[${index}]`, 512));
  if (new Set(items).size !== items.length) fail('RUNTIME_SCHEMA_INVALID', `${location} contains duplicates.`);
  return items;
}

function expectSetEqual(actual: readonly string[], expected: readonly string[], location: string): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter(item => !actualSet.has(item));
  const extra = actual.filter(item => !expectedSet.has(item));
  if (missing.length > 0 || extra.length > 0 || actualSet.size !== actual.length) {
    fail('RUNTIME_CONTRACT_INVALID', `${location} differs from the closed set; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}].`);
  }
}

function normalizeRepoPath(value: string, location: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    fail('RUNTIME_PATH_INVALID', `${location} must be a repository-relative path.`);
  }
  return normalized;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

export function captureReviewTarget(root: string, paths: readonly string[]): ReviewTarget {
  const resolvedRoot = path.resolve(root);
  const normalizedPaths = [...new Set(paths.map((item, index) => normalizeRepoPath(item, `review_target.paths[${index}]`)))].sort();
  const entries = normalizedPaths.map((relativePath): ReviewTargetEntry => {
    const filePath = path.resolve(resolvedRoot, ...relativePath.split('/'));
    if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      fail('RUNTIME_PATH_INVALID', `review target escapes the target root: ${relativePath}`);
    }
    if (!fs.existsSync(filePath)) return { path: relativePath, state: 'absent', sha256: null };
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      return { path: relativePath, state: 'symlink', sha256: sha256(fs.readlinkSync(filePath)) };
    }
    if (!stat.isFile()) {
      fail('REVIEW_TARGET_INVALID', `review target must be a file, symlink, or absent path: ${relativePath}`);
    }
    return { path: relativePath, state: 'file', sha256: sha256(fs.readFileSync(filePath)) };
  });
  return {
    kind: 'runtime-file-manifest/v1',
    revision: digest({ kind: 'runtime-file-manifest/v1', entries }),
    entries,
  };
}

function manifest(entries: ReviewTargetEntry[]): ReviewTarget {
  const sorted = [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { kind: 'runtime-file-manifest/v1', entries: sorted, revision: digest({ kind: 'runtime-file-manifest/v1', entries: sorted }) };
}

export function nextStepAttemptId(current: CanonicalCurrentTask): string {
  const attempts = current.runtimeState.step_attempts?.[current.runtimeState.active_step_id]?.attempts;
  return attempts?.at(-1)?.attempt_id ?? `attempt-${digest({document:current.sourceTuple.document_id,plan:current.runtimeState.evidence_plan_revision,step:current.runtimeState.active_step_id,n:1}).slice(0,40)}`;
}

function validateStepAttempts(value: unknown): Record<string, StepAttemptLedger> {
  const source = expectRecord(value, 'step_attempts');
  const result: Record<string, StepAttemptLedger> = {};
  for (const [step, raw] of Object.entries(source)) {
    expectString(step,'attempt step',STEP_ID_PATTERN);
    const ledger = expectRecord(raw,'step attempt ledger');
    expectExactKeys(ledger,['evidence_plan_revision','max_attempts','attempts'],'step attempt ledger');
    if (ledger.max_attempts !== 3 || !Array.isArray(ledger.attempts) || !ledger.attempts.length || ledger.attempts.length > 3) fail('RETRY_LEDGER_INVALID','Attempt budget must be three including the initial execution.');
    const attempts = ledger.attempts.map(raw => {
      const item = expectRecord(raw,'attempt');
      expectExactKeys(item,['attempt_id','idempotency_key','request_digest','status','blocker',...(item.recovery === undefined ? [] : ['recovery']),'evidence_refs'],'attempt');
      let blocker: StepAttempt['blocker'] = null;
      if (item.blocker !== null) {
        const rawBlocker = expectRecord(item.blocker,'attempt blocker');
        expectExactKeys(rawBlocker,['kind','execution_result','subject_snapshot'],'attempt blocker');
        blocker = {kind:expectEnum(rawBlocker.kind,['environment','unknown'],'blocker.kind'),execution_result:validateStepExecutionResult(rawBlocker.execution_result,'blocker.execution_result'),subject_snapshot:validateReviewTarget(rawBlocker.subject_snapshot,'blocker.subject_snapshot')};
        if (blocker.execution_result.outcome !== 'blocked') fail('RETRY_LEDGER_INVALID','Retained failure must be blocked.');
      }
      const status = expectEnum(item.status,['ready','preflighted','blocked','implemented'],'attempt.status');
      if ((status === 'blocked') !== (blocker !== null)) fail('RETRY_LEDGER_INVALID','Blocked attempts retain their original failure.');
      return {attempt_id:expectString(item.attempt_id,'attempt_id',SAFE_KEY_PATTERN),idempotency_key:expectString(item.idempotency_key,'attempt.idempotency_key',SAFE_KEY_PATTERN),request_digest:item.request_digest === null ? null : expectString(item.request_digest,'request_digest',/^[a-f0-9]{64}$/u),status,blocker,...(item.recovery === undefined ? {} : {recovery:validateStepRepairDiagnosis(item.recovery)}),evidence_refs:validateEvidenceRefs(item.evidence_refs,'attempt.evidence_refs')};
    });
    if (new Set(attempts.map(a=>a.attempt_id)).size !== attempts.length || new Set(attempts.map(a=>a.idempotency_key)).size !== attempts.length) fail('RETRY_LEDGER_INVALID','Attempt identities must be unique.');
    result[step] = {evidence_plan_revision:expectString(ledger.evidence_plan_revision,'attempt plan',/^[a-f0-9]{64}$/u),max_attempts:3,attempts};
  }
  return result;
}

function retryRequestDigest(current: CanonicalCurrentTask, delta: Extract<TaskStateDelta,{action:'retry-step'}>): string {
  return digest({document:current.sourceTuple.document_id,plan:current.runtimeState.evidence_plan_revision,step:delta.step_id,blocked_attempt_id:delta.blocked_attempt_id,refs:delta.blocker_resolution_refs,...(delta.repair_diagnosis ? {repair_diagnosis:delta.repair_diagnosis} : {})});
}

export function reviewCycleForNextStep(previousCycleId: string, nextStepId: string, completionKey: string): ReviewCycleState {
  return {
    ...createReviewCycleZero(),
    id: `review-cycle-${digest({ previous_cycle_id: previousCycleId, next_step_id: nextStepId, completion_key: completionKey }).slice(0, 32)}`,
  };
}

function validateStepRepairDiagnosis(value: unknown): StepRepairDiagnosis {
  const report = expectRecord(value,'repair diagnosis');
  expectExactKeys(report,['kind','status','owner','failed_check','cause','repair_paths'],'repair diagnosis');
  if (report.kind !== 'same-plan-repair/v1' || report.status !== 'confirmed' || report.owner !== 'current-step') fail('RETRY_DIAGNOSIS_REQUIRED','Same-plan repair requires a confirmed current-step diagnosis.');
  return {kind:'same-plan-repair/v1',status:'confirmed',owner:'current-step',failed_check:expectText(report.failed_check,'repair failed_check'),cause:expectText(report.cause,'repair cause'),repair_paths:expectStringArray(report.repair_paths,'repair repair_paths',false,256).map(p=>normalizeRepoPath(p,'repair path'))};
}

function validateRetryResolution(root: string, current: CanonicalCurrentTask, delta: Extract<TaskStateDelta,{action:'retry-step'}>, failure: NonNullable<StepAttempt['blocker']>): void {
  if (captureReviewTarget(root,failure.subject_snapshot.entries.map(e=>e.path)).revision !== failure.subject_snapshot.revision) fail('RETRY_SUBJECT_STALE','Declared code, fixture or check objects changed after failure; use authorized repair or replan.');
  if (delta.repair_diagnosis) {
    if (failure.kind !== 'unknown') fail('RETRY_DIAGNOSIS_REQUIRED','Same-plan repair requires the retained non-environment failure.');
    const failed = [...failure.execution_result.command_results.filter(item=>item.status==='failed'),...failure.execution_result.validation_results.filter(item=>item.status==='failed')];
    const checkNames = failed.map(item=>'command' in item ? item.command : item.validation);
    if (!checkNames.includes(delta.repair_diagnosis.failed_check)) fail('RETRY_DIAGNOSIS_REQUIRED','The diagnosis must identify a check that actually failed in the retained attempt.');
    const failedEvidence = new Set(failed.flatMap(item=>item.evidence_refs));
    if (!delta.blocker_resolution_refs.every(ref=>failedEvidence.has(ref))) fail('RETRY_DIAGNOSIS_REQUIRED','Recovery evidence must cite the retained failed check.');
    const admittedPaths = new Set(failure.execution_result.review_base.entries.map(entry=>entry.path));
    if (delta.repair_diagnosis.repair_paths.some(p=>!admittedPaths.has(p))) fail('RETRY_SCOPE_BLOCKED','Same-plan repair paths must be a subset of the failed preflight candidate paths.');
    return;
  }
  if (failure.kind !== 'environment' || [...failure.execution_result.command_results,...failure.execution_result.validation_results].some(item=>item.status==='failed')) fail('RETRY_DIAGNOSIS_REQUIRED','Environment retry requires a recorded environment blocker without failed checks.');
  for (const ref of delta.blocker_resolution_refs) {
    const relative = normalizeRepoPath(ref,'blocker_resolution_ref');
    const absolute = path.resolve(root,relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.statSync(absolute).size > 65536) fail('RETRY_RESOLUTION_REQUIRED','Resolution must be a retained bounded JSON report.');
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(absolute,'utf8')); } catch { fail('RETRY_RESOLUTION_REQUIRED','Resolution must be structured JSON, not a free-form unlock note.'); }
    const report = expectRecord(parsed,'retry resolution');
    expectExactKeys(report,['kind','task_id','document_id','step_id','blocked_attempt_id','evidence_plan_revision','subject_revision','status','diagnosis','resolution'],'retry resolution');
    if (report.kind !== 'environment-restored/v1' || report.status !== 'passed' || report.task_id !== current.runtimeState.task_id || report.document_id !== current.sourceTuple.document_id || report.step_id !== delta.step_id || report.blocked_attempt_id !== delta.blocked_attempt_id || report.evidence_plan_revision !== current.runtimeState.evidence_plan_revision || report.subject_revision !== failure.subject_snapshot.revision) fail('RETRY_RESOLUTION_REQUIRED','Resolution report must bind this exact environment failure, plan and subjects.');
    expectText(report.diagnosis,'retry diagnosis'); expectText(report.resolution,'retry resolution');
  }
}

function emptyReviewCoverage(planRevision: string): ReviewCoverage {
  return {
    change_set_id: `change-set-${planRevision.slice(0, 32)}`,
    base: manifest([]), target: manifest([]), preimages: [],
    pending_paths: [], last_clean_revision: null,
  };
}

function validateReviewCoverage(value: unknown): ReviewCoverage {
  const source = expectRecord(value, 'review_coverage');
  expectExactKeys(source, ['change_set_id', 'base', 'target', 'preimages', 'pending_paths', 'last_clean_revision'], 'review_coverage');
  const base = validateReviewTarget(source.base, 'review_coverage.base');
  const target = validateReviewTarget(source.target, 'review_coverage.target');
  createReviewChangeDelta(base, target);
  if (!Array.isArray(source.preimages) || source.preimages.length !== base.entries.length) fail('REVIEW_COVERAGE_INVALID', 'preimages must cover the initial manifest.');
  const preimages = source.preimages.map((value, index) => {
    const item = expectRecord(value, 'preimage');
    expectExactKeys(item, ['path', 'state', 'sha256', 'content_base64'], 'preimage');
    const entry = base.entries[index];
    if (digest({path:item.path,state:item.state,sha256:item.sha256}) !== digest(entry)) fail('REVIEW_COVERAGE_INVALID', 'preimage identity differs from base.');
    const content = item.content_base64;
    if (entry.state === 'absent') {
      if (content !== null) fail('REVIEW_COVERAGE_INVALID', 'absent preimage has content.');
    } else {
      if (typeof content !== 'string') fail('REVIEW_COVERAGE_INVALID', 'preimage content is required.');
      const buffer = Buffer.from(content, 'base64');
      if (buffer.toString('base64') !== content || sha256(buffer) !== entry.sha256) fail('REVIEW_COVERAGE_INVALID', 'preimage content hash is invalid.');
    }
    return {...entry, content_base64: content as string | null};
  });
  const pending = expectStringArray(source.pending_paths, 'review_coverage.pending_paths', true);
  if (new Set(pending).size !== pending.length || pending.some(p => !base.entries.some(e => e.path === p))) fail('REVIEW_COVERAGE_INVALID', 'pending paths must be covered.');
  return {change_set_id:expectString(source.change_set_id, 'review_coverage.change_set_id', SAFE_KEY_PATTERN),base,target,preimages,pending_paths:pending,last_clean_revision:source.last_clean_revision === null ? null : expectString(source.last_clean_revision, 'last_clean_revision', /^[a-f0-9]{64}$/u)};
}

function registerReviewCoverage(root: string, current: CanonicalCurrentTask, paths: string[]): ReviewCoverage {
  const old = current.runtimeState.review_coverage;
  if (old && captureReviewTarget(root, old.target.entries.map(e => e.path)).revision !== old.target.revision) fail('REVIEW_TARGET_STALE', 'Unrecorded changes cannot refresh the cumulative review target.');
  const added = captureReviewTarget(root, paths.filter(p => !old?.base.entries.some(e => e.path === p)));
  const preimages = [...(old?.preimages ?? []), ...added.entries.map(entry => {
    const absolute = path.resolve(root, entry.path);
    const content = entry.state === 'absent' ? null : entry.state === 'symlink' ? Buffer.from(fs.readlinkSync(absolute)) : fs.readFileSync(absolute);
    return {...entry,content_base64:content?.toString('base64') ?? null};
  })].sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return validateReviewCoverage({change_set_id:old?.change_set_id ?? `change-set-${digest({document:current.sourceTuple.document_id,plan:current.runtimeState.evidence_plan_revision}).slice(0,32)}`,base:manifest(preimages.map(({content_base64,...entry}) => entry)),target:manifest([...(old?.target.entries ?? []),...added.entries]),preimages,pending_paths:old?.pending_paths ?? [],last_clean_revision:old?.last_clean_revision ?? null});
}

export function cumulativeReviewExecution(current: CanonicalCurrentTask, execution: StepExecutionLogEntry): StepExecutionLogEntry {
  const coverage = current.runtimeState.review_coverage;
  if (!coverage || !execution.execution_result) return execution;
  return {
    ...execution,
    change_set_id: coverage.change_set_id,
    execution_result: {
      ...execution.execution_result,
      change_set_id: coverage.change_set_id,
      review_base: coverage.base,
      review_target: coverage.target,
      change_delta: createReviewChangeDelta(coverage.base, coverage.target),
    },
  };
}

export function validateTestAssessment(value: unknown): TestAssessment {
  const source = expectRecord(value, 'test_assessment');
  expectExactKeys(source, ['applicable','reason','evidence_refs','necessity','oracle','boundary','reuse','applicability'], 'test_assessment');
  if (typeof source.applicable !== 'boolean') fail('REVIEW_ASSESSMENT_REQUIRED', 'applicable must be boolean.');
  return {applicable:source.applicable,reason:expectText(source.reason,'test_assessment.reason'),evidence_refs:validateEvidenceRefs(source.evidence_refs,'test_assessment.evidence_refs'),necessity:expectText(source.necessity,'test_assessment.necessity'),oracle:expectText(source.oracle,'test_assessment.oracle'),boundary:expectText(source.boundary,'test_assessment.boundary'),reuse:expectText(source.reuse,'test_assessment.reuse'),applicability:expectText(source.applicability,'test_assessment.applicability')};
}

export function createReviewChangeDelta(base: ReviewTarget, target: ReviewTarget): ReviewChangeDelta {
  const basePaths = base.entries.map(item => item.path);
  const targetPaths = target.entries.map(item => item.path);
  if (digest(basePaths) !== digest(targetPaths)) {
    fail('REVIEW_TARGET_PATH_CONFLICT', 'review base and target must contain the same canonical path set.');
  }
  const entries = base.entries.flatMap((before, index): ReviewChangeDeltaEntry[] => {
    const after = target.entries[index];
    if (before.state === after.state && before.sha256 === after.sha256) return [];
    return [{
      path: before.path,
      before_state: before.state,
      before_sha256: before.sha256,
      after_state: after.state,
      after_sha256: after.sha256,
    }];
  });
  return {
    kind: 'runtime-file-delta/v1',
    base_revision: base.revision,
    target_revision: target.revision,
    entries,
  };
}

function parseYamlFrontmatter(content: string, location: string): { frontmatter: AnyRecord; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) {
    fail('MIGRATION_REQUIRED', `${location} is not a vNext CURRENT_TASK document; run the Migration Pack.`);
  }
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} has invalid frontmatter YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  }
  const frontmatter = document.toJS();
  if (!isRecord(frontmatter)) {
    fail('MIGRATION_REQUIRED', `${location} does not declare a supported vNext CURRENT_TASK schema; run the Migration Pack.`);
  }
  return { frontmatter, body: match[2] };
}

function parseYamlMappingFile(filePath: string): AnyRecord {
  if (!fs.existsSync(filePath)) fail('RUNTIME_CONTRACT_MISSING', `Runtime contract is missing: ${filePath}`);
  const document = parseDocument(fs.readFileSync(filePath, 'utf8'), { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) fail('RUNTIME_CONTRACT_INVALID', `${filePath} has invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  return expectRecord(document.toJS(), filePath);
}


type RuntimeDistributionContract = {
  kind: 'project-local-node';
  package_path: string;
  entrypoint: string;
  package_manifest: string;
  lockfile: string;
  package_name: string;
  package_version: string;
  node_min_version: string;
};

function validateNodeMinimum(nodeMinVersion: string): void {
  const match = /^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(nodeMinVersion);
  if (!match) fail('RUNTIME_CONTRACT_INVALID', 'runtime_distribution.node_min_version must use >=MAJOR.MINOR.PATCH.');
  const major = Number(match[1]);
  if (!Number.isSafeInteger(major) || major < 20) fail('RUNTIME_CONTRACT_INVALID', 'runtime_distribution.node_min_version must require Node 20 or newer.');
}

export function validateRuntimeEnvironment(nodeVersion = process.versions.node, nodeMinVersion = VNEXT_RUNTIME_NODE_MIN_VERSION): void {
  const minimumMatch = /^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(nodeMinVersion);
  const currentMatch = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(nodeVersion ?? '');
  if (!minimumMatch || !currentMatch) throw new VNextRuntimeError('RUNTIME_ENV_UNSUPPORTED', 'Unable to determine a supported Node.js version.');
  const minimum = minimumMatch.slice(1).map(Number);
  const current = currentMatch.slice(1).map(Number);
  const belowMinimum = current[0] < minimum[0] ||
    (current[0] === minimum[0] && current[1] < minimum[1]) ||
    (current[0] === minimum[0] && current[1] === minimum[1] && current[2] < minimum[2]);
  if (belowMinimum) {
    throw new VNextRuntimeError('RUNTIME_ENV_UNSUPPORTED', 'Node.js ' + nodeVersion + ' is below the required minimum ' + nodeMinVersion + '.');
  }
}

function readJsonObject(filePath: string, code: string): AnyRecord {
  if (!fs.existsSync(filePath)) fail(code, 'Required Runtime distribution file is missing: ' + filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(code, filePath + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
  return expectRecord(parsed, filePath);
}

function resolveRuntimeDistributionDirectory(root: string): { directory: string; installed: boolean } {
  const resolvedRoot = path.resolve(root);
  const installedDirectory = path.join(resolvedRoot, ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'));
  if (fs.existsSync(path.join(installedDirectory, 'package.json'))) {
    return { directory: installedDirectory, installed: true };
  }
  return { directory: path.join(resolvedRoot, 'runtime', 'vnext'), installed: false };
}

export function validateVNextRuntimeDistribution(root: string, contract: RuntimeDistributionContract, requireDependencies = false): VNextRuntimeContractValidationResult['runtime_distribution'] {
  const { directory } = resolveRuntimeDistributionDirectory(root);
  const packagePath = path.join(directory, 'package.json');
  const lockfilePath = path.join(directory, 'package-lock.json');
  const entrypointPath = path.join(directory, 'dist', 'cli.js');
  const packageManifest = readJsonObject(packagePath, 'RUNTIME_PACKAGE_INVALID');
  if (packageManifest.name !== contract.package_name || packageManifest.version !== contract.package_version || packageManifest.private !== true || packageManifest.type !== 'module') {
    fail('RUNTIME_PACKAGE_INVALID', 'Runtime package.json must declare the contract name, version, private=true, and type=module.');
  }
  const engines = expectRecord(packageManifest.engines, 'Runtime package.json.engines');
  if (engines.node !== contract.node_min_version) fail('RUNTIME_PACKAGE_INVALID', 'Runtime package.json.engines.node does not match runtime_distribution.node_min_version.');
  const dependencies = expectRecord(packageManifest.dependencies, 'Runtime package.json.dependencies');
  if (dependencies.yaml !== '2.8.3') fail('RUNTIME_PACKAGE_INVALID', 'Runtime package.json must pin yaml to 2.8.3.');
  const lockfile = readJsonObject(lockfilePath, 'RUNTIME_PACKAGE_INVALID');
  if (lockfile.name !== contract.package_name || lockfile.version !== contract.package_version || lockfile.lockfileVersion !== 3) {
    fail('RUNTIME_PACKAGE_INVALID', 'Runtime package-lock.json identity or lockfileVersion is invalid.');
  }
  const lockPackages = expectRecord(lockfile.packages, 'Runtime package-lock.json.packages');
  const rootLock = expectRecord(lockPackages[''], 'Runtime package-lock.json.packages[""]');
  if (rootLock.version !== contract.package_version) fail('RUNTIME_PACKAGE_INVALID', 'Runtime package-lock.json root version does not match the Runtime contract.');
  const yamlLock = expectRecord(lockPackages['node_modules/yaml'], 'Runtime package-lock.json.packages[node_modules/yaml]');
  if (yamlLock.version !== '2.8.3') fail('RUNTIME_PACKAGE_INVALID', 'Runtime package-lock.json must lock yaml to 2.8.3.');
  if (!fs.existsSync(entrypointPath) || !fs.statSync(entrypointPath).isFile()) fail('RUNTIME_PACKAGE_INVALID', 'Runtime entrypoint is missing: ' + entrypointPath);
  const entrypoint = fs.readFileSync(entrypointPath, 'utf8');
  if (!entrypoint.includes('vnext-runtime-proposal') || !entrypoint.includes('runCli')) fail('RUNTIME_PACKAGE_INVALID', 'Runtime dist/cli.js is not the generated vNext Runtime entrypoint.');
  if (requireDependencies) {
    const localYaml = path.join(directory, 'node_modules', 'yaml', 'package.json');
    const localYamlManifest = readJsonObject(localYaml, 'RUNTIME_DEPENDENCY_MISSING');
    if (localYamlManifest.version !== '2.8.3') fail('RUNTIME_DEPENDENCY_INVALID', 'Runtime-local yaml dependency does not match package-lock.json.');
  }
  return {
    kind: contract.kind,
    package_path: contract.package_path,
    entrypoint: contract.entrypoint,
    package_version: contract.package_version,
    node_min_version: contract.node_min_version,
    package_lock_sha256: sha256(fs.readFileSync(lockfilePath)),
    entrypoint_sha256: sha256(fs.readFileSync(entrypointPath)),
  };
}

function validateRuntimeDistributionContract(value: unknown): RuntimeDistributionContract {
  const distribution = expectRecord(value, 'Runtime contract.runtime_distribution');
  expectExactKeys(distribution, ['kind', 'package_path', 'entrypoint', 'package_manifest', 'lockfile', 'package_name', 'package_version', 'node_min_version'], 'Runtime contract.runtime_distribution');
  const result: RuntimeDistributionContract = {
    kind: expectEnum(distribution.kind, ['project-local-node'], 'Runtime contract.runtime_distribution.kind'),
    package_path: normalizeRepoPath(expectString(distribution.package_path, 'Runtime contract.runtime_distribution.package_path'), 'Runtime contract.runtime_distribution.package_path'),
    entrypoint: normalizeRepoPath(expectString(distribution.entrypoint, 'Runtime contract.runtime_distribution.entrypoint'), 'Runtime contract.runtime_distribution.entrypoint'),
    package_manifest: normalizeRepoPath(expectString(distribution.package_manifest, 'Runtime contract.runtime_distribution.package_manifest'), 'Runtime contract.runtime_distribution.package_manifest'),
    lockfile: normalizeRepoPath(expectString(distribution.lockfile, 'Runtime contract.runtime_distribution.lockfile'), 'Runtime contract.runtime_distribution.lockfile'),
    package_name: expectString(distribution.package_name, 'Runtime contract.runtime_distribution.package_name'),
    package_version: expectString(distribution.package_version, 'Runtime contract.runtime_distribution.package_version'),
    node_min_version: expectString(distribution.node_min_version, 'Runtime contract.runtime_distribution.node_min_version'),
  };
  if (result.package_path !== VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH || result.entrypoint !== VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH || result.package_manifest !== VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH || result.lockfile !== VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH || result.package_name !== VNEXT_RUNTIME_PACKAGE_NAME || result.package_version !== VNEXT_RUNTIME_PACKAGE_VERSION || result.node_min_version !== VNEXT_RUNTIME_NODE_MIN_VERSION) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime distribution must use the canonical project-local Node package identity.');
  }
  validateNodeMinimum(result.node_min_version);
  return result;
}

function validateTaskContextContract(value: unknown): void {
  const context = expectRecord(value, 'Runtime contract.task_context');
  expectExactKeys(context, ['schema_version', 'kind', 'commands', 'entry_points', 'views', 'projection', 'paging', 'receipts', 'read_only'], 'Runtime contract.task_context');
  if (context.schema_version !== 1 || context.kind !== 'vnext-task-context-contract' || context.read_only !== true) fail('RUNTIME_CONTRACT_INVALID', 'task_context must be the read-only vNext projection contract.');
  expectSetEqual(expectStringArray(context.commands, 'Runtime contract.task_context.commands'), ['task-context', 'task-read', 'task-storage-migration', 'task-export'], 'task context commands');
  expectSetEqual(expectStringArray(context.entry_points, 'Runtime contract.task_context.entry_points'), ['validate --summary', 'task-context', 'task-read', 'review-context', 'review-read', 'preflight-step', 'evidence-context'], 'task context entry points');
  expectSetEqual(expectStringArray(context.views, 'Runtime contract.task_context.views'), ['overview', 'operation-context', 'history-on-demand'], 'task context views');
  const projection = expectRecord(context.projection, 'Runtime contract.task_context.projection');
  expectExactKeys(projection, ['default', 'required_blocks', 'review_requires_cumulative_target', 'forbidden_expansions'], 'Runtime contract.task_context.projection');
  if (projection.default !== 'task-context' || projection.review_requires_cumulative_target !== true) fail('RUNTIME_CONTRACT_INVALID', 'task_context projection must use the shared bounded projector and cumulative review target.');
  expectSetEqual(expectStringArray(projection.required_blocks, 'Runtime contract.task_context.projection.required_blocks'), ['current-definition-or-visible-definition-revision', 'current-step', 'unfinished-obligations', 'required-dependencies', 'unknown-dependencies', 'global-gates', 'latest-execution'], 'task context required blocks');
  expectSetEqual(expectStringArray(projection.forbidden_expansions, 'Runtime contract.task_context.projection.forbidden_expansions'), ['raw-runtime-state', 'unbounded-execution-log', 'unbounded-applied-proposals'], 'task context forbidden expansions');
  const paging = expectRecord(context.paging, 'Runtime contract.task_context.paging');
  expectExactKeys(paging, ['unit', 'default_bytes', 'min_bytes', 'max_bytes', 'required_fields', 'stale_binding'], 'Runtime contract.task_context.paging');
  if (paging.unit !== 'utf8-bytes' || paging.default_bytes !== 16384 || paging.min_bytes !== 256 || paging.max_bytes !== 65536) fail('RUNTIME_CONTRACT_INVALID', 'task_context paging must retain the bounded UTF-8 byte budget.');
  expectSetEqual(expectStringArray(paging.required_fields, 'Runtime contract.task_context.paging.required_fields'), ['returned', 'total_bytes', 'continuation', 'complete_for_operation'], 'task context paging fields');
  expectSetEqual(expectStringArray(paging.stale_binding, 'Runtime contract.task_context.paging.stale_binding'), ['source_revision', 'definition_revision', 'state_revision', 'exact_reference'], 'task context stale binding');
  const receipts = expectRecord(context.receipts, 'Runtime contract.task_context.receipts');
  expectExactKeys(receipts, ['context', 'read', 'proves', 'not_authority'], 'Runtime contract.task_context.receipts');
  if (receipts.context !== 'task-context-receipt/v1' || receipts.read !== 'task-read-receipt/v1' || receipts.proves !== 'version-and-return-range-only' || receipts.not_authority !== true) fail('RUNTIME_CONTRACT_INVALID', 'task context receipts must not be treated as execution authority.');
}

function validateTaskStoreContract(value: unknown): void {
  const store = expectRecord(value, 'Runtime contract.task_store');
  expectExactKeys(store, ['schema_version', 'kind', 'root', 'objects', 'events', 'indexes', 'commit_head', 'hot_window', 'full_history', 'dedup_key', 'event_identity', 'migration', 'garbage_collection', 'target_owned_data'], 'Runtime contract.task_store');
  if (store.schema_version !== 1 || store.kind !== 'vnext-task-store-contract' || store.root !== '<workflow_home>/task-data/<document_id>' || store.objects !== 'objects/<sha256>.json' || store.events !== 'events/<sequence>-<sha256>.json' || store.indexes !== 'rebuildable-and-non-authoritative' || store.commit_head !== 'CURRENT_TASK-single-submission-head' || store.hot_window !== 'cache-only' || store.full_history !== 'persistent-and-queryable' || store.dedup_key !== 'schema-object-type-document-id-complete-content' || store.event_identity !== 'sequence-time-cause-and-idempotency-preserved' || store.migration !== 'preview-confirm-commit-with-source-revision' || store.garbage_collection !== 'disabled-in-v1' || store.target_owned_data !== 'task-data-is-never-removed-by-distribution-upgrade') {
    fail('RUNTIME_CONTRACT_INVALID', 'task_store must retain the content-addressed, append-only aggregate contract.');
  }
}

function validateBootstrapRuntimeContract(value: unknown): string[] {
  const bootstrap = expectRecord(value, 'vNext Runtime contract.bootstrap_project');
  expectExactKeys(
    bootstrap,
    ['schema_version', 'kind', 'caller', 'modes', 'required_envelope', 'mutation_scope', 'asset_boundary', 'operations', 'recovery', 'read_back'],
    'vNext Runtime contract.bootstrap_project',
  );
  if (bootstrap.schema_version !== 1 || bootstrap.kind !== 'vnext-bootstrap-runtime-contract') {
    fail('RUNTIME_CONTRACT_INVALID', 'bootstrap_project must declare the vNext bootstrap Runtime contract marker.');
  }
  expectSetEqual(expectStringArray(bootstrap.caller, 'Runtime contract.bootstrap_project.caller'), ['bootstrap-project'], 'bootstrap Runtime callers');
  expectSetEqual(expectStringArray(bootstrap.modes, 'Runtime contract.bootstrap_project.modes'), [...BOOTSTRAP_MODES], 'bootstrap Runtime modes');
  expectSetEqual(
    expectStringArray(bootstrap.required_envelope, 'Runtime contract.bootstrap_project.required_envelope'),
    ['authority_evidence', 'semantic_operations', 'preconditions', 'evidence_refs', 'idempotency_key', 'requested_write_targets', 'requested_directory_targets', 'changed_paths', 'scope_document', 'conditional_authorizations', 'transformation_kind', 'assets'],
    'bootstrap Runtime proposal envelope',
  );

  const scope = expectRecord(bootstrap.mutation_scope, 'Runtime contract.bootstrap_project.mutation_scope');
  expectExactKeys(scope, ['status', 'binding', 'source', 'default_write_policy', 'conditional_expansion_requires', 'read_discovery_is_not_write_authority', 'check_command', 'input', 'output'], 'Runtime contract.bootstrap_project.mutation_scope');
  if (scope.status !== 'bound' || scope.binding !== 'vnext-runtime-read-only' || scope.source !== 'bootstrap proposal.scope_document' || scope.default_write_policy !== 'deny' || scope.conditional_expansion_requires !== 'evidence-and-authority' || scope.read_discovery_is_not_write_authority !== true || scope.check_command !== 'shared-mutation-scope-evaluator') {
    fail('RUNTIME_CONTRACT_INVALID', 'bootstrap mutation scope must keep the shared default-deny evaluator boundary.');
  }
  const scopeInput = expectRecord(scope.input, 'Runtime contract.bootstrap_project.mutation_scope.input');
  expectExactKeys(scopeInput, ['required'], 'Runtime contract.bootstrap_project.mutation_scope.input');
  expectSetEqual(expectStringArray(scopeInput.required, 'Runtime contract.bootstrap_project.mutation_scope.input.required'), ['explicit_changed_paths', 'conditional_authorizations_with_evidence_and_authority', 'transformation_kind'], 'bootstrap mutation scope input');
  const scopeOutput = expectRecord(scope.output, 'Runtime contract.bootstrap_project.mutation_scope.output');
  expectExactKeys(scopeOutput, ['required'], 'Runtime contract.bootstrap_project.mutation_scope.output');
  expectSetEqual(expectStringArray(scopeOutput.required, 'Runtime contract.bootstrap_project.mutation_scope.output.required'), ['per-path-admission-and-blocker', 'source-revision'], 'bootstrap mutation scope output');

  const assetBoundary = expectRecord(bootstrap.asset_boundary, 'Runtime contract.bootstrap_project.asset_boundary');
  expectExactKeys(assetBoundary, ['allowed_roots', 'forbidden_targets', 'generated_categories'], 'Runtime contract.bootstrap_project.asset_boundary');
  expectSetEqual(
    expectStringArray(assetBoundary.allowed_roots, 'Runtime contract.bootstrap_project.asset_boundary.allowed_roots'),
    ['.workflow-system/PROJECT_PROFILE.yaml', '.workflow-system/vnext/BOOTSTRAP_RECEIPT.json', 'docs/workflow/', 'docs/designs/', 'docs/adoption/', 'AGENTS.md', 'CLAUDE.md'],
    'bootstrap allowed asset roots',
  );
  const forbiddenTargets = expectStringArray(assetBoundary.forbidden_targets, 'Runtime contract.bootstrap_project.asset_boundary.forbidden_targets');
  for (const required of ['.workflow-system/WORKFLOW_PROTOCOL.md', '.workflow-system/FILE_SCHEMAS.md', '.workflow-system/vnext/SOURCE_CONTRACT.yaml', '.workflow-system/vnext/RUNTIME_CONTRACT.yaml', '.workflow-system/runtime/**', '.agents/skills/**']) {
    if (!forbiddenTargets.includes(required)) fail('RUNTIME_CONTRACT_INVALID', `bootstrap forbidden target must include ${required}.`);
  }
  expectSetEqual(
    expectStringArray(assetBoundary.generated_categories, 'Runtime contract.bootstrap_project.asset_boundary.generated_categories'),
    ['config', 'generated', 'governance'],
    'bootstrap generated asset categories',
  );

  const operations = bootstrap.operations;
  if (!Array.isArray(operations) || operations.length !== BOOTSTRAP_OPERATION_KINDS.length) fail('RUNTIME_CONTRACT_INVALID', `bootstrap_project must declare exactly ${BOOTSTRAP_OPERATION_KINDS.length} typed operations.`);
  const bound: string[] = [];
  const expectedOperations: Record<string, { source: string[]; writes: string[] }> = {
    'contract-candidate-commit': { source: ['source-authority evidence', 'existing CONTRACTS.md when present'], writes: ['CONTRACTS.md'] },
    'decision-record-transaction': { source: ['source-authority evidence', 'existing DECISIONS.md when present'], writes: ['DECISIONS.md'] },
    'project-status-transaction': { source: ['STATUS.md'], writes: ['STATUS.md'] },
    'paired-host-guidance-transaction': { source: ['target host guidance'], writes: ['paired host guidance'] },
  };
  for (const [index, rawOperation] of operations.entries()) {
    const operation = expectRecord(rawOperation, `Runtime contract.bootstrap_project.operations[${index}]`);
    expectExactKeys(operation, ['id', 'status', 'binding', 'operation', 'source_targets', 'write_targets', 'allowed_callers', 'result_states', 'atomic', 'idempotence', 'conflict_policy'], `Runtime contract.bootstrap_project.operations[${index}]`);
    const id = expectString(operation.id, `Runtime contract.bootstrap_project.operations[${index}].id`);
    if (!(BOOTSTRAP_OPERATION_KINDS as readonly string[]).includes(id) || bound.includes(id)) fail('RUNTIME_CONTRACT_INVALID', `bootstrap operation ${id} is not in the closed operation set.`);
    if (operation.status !== 'bound' || operation.binding !== 'vnext-runtime' || operation.operation !== id) fail('RUNTIME_CONTRACT_INVALID', `bootstrap operation ${id} must be bound to vnext-runtime.`);
    const expected = expectedOperations[id];
    expectSetEqual(expectStringArray(operation.source_targets, `bootstrap operation ${id}.source_targets`), expected.source, `bootstrap operation ${id}.source_targets`);
    expectSetEqual(expectStringArray(operation.write_targets, `bootstrap operation ${id}.write_targets`), expected.writes, `bootstrap operation ${id}.write_targets`);
    expectSetEqual(expectStringArray(operation.allowed_callers, `bootstrap operation ${id}.allowed_callers`), ['bootstrap-project'], `bootstrap operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray(operation.result_states, `bootstrap operation ${id}.result_states`), [...RUNTIME_RESULT_STATES], `bootstrap operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== 'fail-closed' || operation.conflict_policy !== 'fail-closed') fail('RUNTIME_CONTRACT_INVALID', `bootstrap operation ${id} must be atomic, fail-closed, and conflict-safe.`);
    bound.push(id);
  }
  expectSetEqual(bound, [...BOOTSTRAP_OPERATION_KINDS], 'bootstrap Runtime bound operations');

  const recovery = expectRecord(bootstrap.recovery, 'Runtime contract.bootstrap_project.recovery');
  expectExactKeys(recovery, ['marker', 'interrupted', 'rollback'], 'Runtime contract.bootstrap_project.recovery');
  if (recovery.marker !== '.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json' || recovery.interrupted !== 'fail-closed-explicit-recovery' || recovery.rollback !== 'verify-scoped-pre-bootstrap-preimage-before-marker-clear') fail('RUNTIME_CONTRACT_INVALID', 'bootstrap recovery must use the explicit interruption marker and verified scoped rollback boundary.');
  const readBack = expectRecord(bootstrap.read_back, 'Runtime contract.bootstrap_project.read_back');
  expectExactKeys(readBack, ['required'], 'Runtime contract.bootstrap_project.read_back');
  expectSetEqual(expectStringArray(readBack.required, 'Runtime contract.bootstrap_project.read_back.required'), ['asset-checksums', 'project-identity', 'runtime-contract', 'distribution-prerequisite', 'canonical-CURRENT_TASK', 'host-isolation'], 'bootstrap read-back evidence');
  return bound;
}

export function validateVNextRuntimeContract(root: string, requireDependencies = false): VNextRuntimeContractValidationResult {
  const filePath = path.join(path.resolve(root), ...VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH.split('/'));
  const contract = parseYamlMappingFile(filePath);
  expectExactKeys(contract, ['schema_version', 'kind', 'phase', 'runtime_distribution', 'task_context', 'task_store', 'proposal', 'mutation_scope', 'canonical_current_task', 'concurrency', 'operations', 'unbound_operations', 'bootstrap_project'], 'vNext Runtime contract');
  if (contract.schema_version !== 1 || contract.kind !== 'vnext-runtime-contract' || contract.phase !== 'Phase 2') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must declare schema_version=1, kind=vnext-runtime-contract, phase=Phase 2.');
  }
  const runtimeDistribution = validateRuntimeDistributionContract(contract.runtime_distribution);
  const distributionIdentity = validateVNextRuntimeDistribution(root, runtimeDistribution, requireDependencies);
  validateTaskContextContract(contract.task_context);
  validateTaskStoreContract(contract.task_store);
  const proposal = expectRecord(contract.proposal, 'Runtime contract.proposal');
  expectExactKeys(proposal, ['schema_version', 'kind', 'caller', 'operation_kinds', 'source_tuple', 'required_envelope', 'finding_queue_admission', 'finding_queue_repair', 'task_state', 'execute_step', 'review_change', 'prepare_task', 'inbox_record', 'lifecycle', 'close_task', 'lesson_marker'], 'Runtime contract.proposal');
  if (proposal.schema_version !== 1 || proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND) fail('RUNTIME_CONTRACT_INVALID', 'Runtime proposal contract has an invalid envelope marker.');
  expectSetEqual(expectStringArray(proposal.caller, 'Runtime contract.proposal.caller'), ['execute-step', 'review-change', 'prepare-task', 'task-lifecycle', 'capture-work-item', 'close-task'], 'Runtime contract proposal callers');
  expectSetEqual(expectStringArray(proposal.operation_kinds, 'Runtime contract.proposal.operation_kinds'), [...RUNTIME_OPERATION_KINDS], 'Runtime contract operation kinds');
  expectSetEqual(
    expectStringArray(proposal.source_tuple, 'Runtime contract.proposal.source_tuple'),
    [...RUNTIME_SOURCE_TUPLE_FIELDS],
    'Runtime contract source tuple',
  );
  expectSetEqual(
    expectStringArray(proposal.required_envelope, 'Runtime contract.proposal.required_envelope'),
    [...RUNTIME_REQUIRED_ENVELOPE_FIELDS],
    'Runtime contract proposal envelope',
  );
  const findingQueueRepair = expectRecord(proposal.finding_queue_repair, 'Runtime contract.proposal.finding_queue_repair');
  expectExactKeys(findingQueueRepair, ['required'], 'Runtime contract.proposal.finding_queue_repair');
  expectSetEqual(
    expectStringArray(findingQueueRepair.required, 'Runtime contract.proposal.finding_queue_repair.required'),
    ['review_cycle_id', 'repair_wave_id'],
    'Runtime contract finding-queue repair fields',
  );
  const findingQueueAdmission = expectRecord(proposal.finding_queue_admission, 'Runtime contract.proposal.finding_queue_admission');
  expectExactKeys(findingQueueAdmission, ['required'], 'Runtime contract.proposal.finding_queue_admission');
  expectSetEqual(
    expectStringArray(findingQueueAdmission.required, 'Runtime contract.proposal.finding_queue_admission.required'),
    ['cycle_phase', 'finding_admission_wave_id'],
    'Runtime contract finding-queue admission fields',
  );
  const taskStateContract = expectRecord(proposal.task_state, 'Runtime contract.proposal.task_state');
  expectExactKeys(taskStateContract, ['actions', 'retry_step', 'step_progress', 'claim_evidence', 'claim_evidence_migration', 'advancement_outcomes', 'review_receipt', 'review_result', 'draft', 'confirm'], 'Runtime contract.proposal.task_state');
  expectSetEqual(
    expectStringArray(taskStateContract.actions, 'Runtime contract.proposal.task_state.actions'),
    ['retry-step', 'record-step-preflight', 'step-progress', 'clear-resume-review-gate', 'record-evidence-challenge', 'dismiss-evidence-challenge', ...DRAFT_TASK_STATE_ACTIONS, ...CLAIM_EVIDENCE_MIGRATION_ACTIONS, ...REVIEW_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS],
    'Runtime contract task-state actions',
  );
  const retryContract = expectRecord(taskStateContract.retry_step, 'Runtime contract.proposal.task_state.retry_step');
  expectExactKeys(retryContract, ['max_attempts','environment_report','same_plan_repair_diagnosis','repair_paths','failure_preservation','result_required'], 'Runtime contract.proposal.task_state.retry_step');
  if (retryContract.max_attempts !== 3 || retryContract.environment_report !== 'environment-restored/v1' || retryContract.same_plan_repair_diagnosis !== 'same-plan-repair/v1' || retryContract.repair_paths !== 'failed-preflight-subset' || retryContract.failure_preservation !== 'durable-step-attempts' || retryContract.result_required !== 'fresh-preflight-and-execution') fail('RUNTIME_CONTRACT_INVALID','Runtime retry contract must retain bounded same-plan recovery and fresh execution.');
  const stepProgressContract = expectRecord(taskStateContract.step_progress, 'Runtime contract.proposal.task_state.step_progress');
  expectExactKeys(stepProgressContract, ['required', 'optional'], 'Runtime contract.proposal.task_state.step_progress');
  expectSetEqual(
    expectStringArray(stepProgressContract.required, 'Runtime contract.proposal.task_state.step_progress.required'),
    ['step_id', 'status', 'evidence_refs'],
    'Runtime contract task-state required fields',
  );
  expectSetEqual(
    expectStringArray(stepProgressContract.optional, 'Runtime contract.proposal.task_state.step_progress.optional', true),
    ['note', 'repair_fingerprint', 'repair_fingerprints', 'repair_wave_id', 'change_set_id', 'review_receipt', 'claim_evidence', 'execution_result'],
    'Runtime contract task-state optional fields',
  );
  const claimEvidenceContract = expectRecord(taskStateContract.claim_evidence, 'Runtime contract.proposal.task_state.claim_evidence');
  expectExactKeys(claimEvidenceContract, ['stored_in', 'record_fields', 'slot_fields', 'complete_dispositions', 'incomplete_dispositions', 'completion_rule'], 'Runtime contract.proposal.task_state.claim_evidence');
  if (claimEvidenceContract.stored_in !== 'canonical CURRENT_TASK.runtime_state') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime claim evidence must be stored in the canonical CURRENT_TASK runtime state.');
  }
  expectSetEqual(
    expectStringArray(claimEvidenceContract.record_fields, 'Runtime contract claim evidence record_fields'),
    ['claim_id', 'claim_kind', 'requirement', 'source_ref', 'slots'],
    'Runtime claim evidence record fields',
  );
  expectSetEqual(
    expectStringArray(claimEvidenceContract.slot_fields, 'Runtime contract claim evidence slot_fields'),
    ['slot_id', 'minimum_type', 'disposition', 'evidence_refs', 'due_step_id', 'applicability', 'before_step_id', 'check', 'report', 'prerequisite_receipt'],
    'Runtime claim evidence slot fields',
  );
  expectSetEqual(
    expectStringArray(claimEvidenceContract.complete_dispositions, 'Runtime contract claim evidence complete_dispositions'),
    ['existing', 'reused', 'newly-executed'],
    'Runtime claim evidence complete dispositions',
  );
  expectSetEqual(
    expectStringArray(claimEvidenceContract.incomplete_dispositions, 'Runtime contract claim evidence incomplete_dispositions'),
    ['missing', 'deferred', 'blocked'],
    'Runtime claim evidence incomplete dispositions',
  );
  if (claimEvidenceContract.completion_rule !== CLAIM_EVIDENCE_COMPLETION_RULE) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime claim evidence completion must require a non-empty frozen plan with an acceptance claim and every planned slot with its evidence_refs.');
  }
  const claimEvidenceMigrationContract = expectRecord(taskStateContract.claim_evidence_migration, 'Runtime contract.proposal.task_state.claim_evidence_migration');
  expectExactKeys(
    claimEvidenceMigrationContract,
    ['mode', 'action', 'required', 'from', 'to', 'mutation', 'preserves'],
    'Runtime contract.proposal.task_state.claim_evidence_migration',
  );
  if (claimEvidenceMigrationContract.mode !== 'default' || claimEvidenceMigrationContract.action !== 'migrate-claim-evidence') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime claim evidence migration must use default/migrate-claim-evidence.');
  }
  expectSetEqual(
    expectStringArray(claimEvidenceMigrationContract.required, 'Runtime contract claim evidence migration required'),
    ['claim_evidence', 'evidence_refs'],
    'Runtime contract claim evidence migration required fields',
  );
  if (claimEvidenceMigrationContract.from !== 'active + active legacy-or-empty-plan' || claimEvidenceMigrationContract.to !== 'active + active') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime claim evidence migration transition is invalid.');
  }
  if (claimEvidenceMigrationContract.mutation !== 'install one non-empty acceptance-bearing frozen claim_evidence plan; do not change task semantics') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime claim evidence migration mutation boundary is invalid.');
  }
  expectSetEqual(
    expectStringArray(claimEvidenceMigrationContract.preserves, 'Runtime contract claim evidence migration preserves'),
    ['TASK_ID', 'TASK_SLUG', 'document_id', 'goal', 'scope', 'acceptance', 'implementation steps', 'active step/status', 'execution history', 'findings', 'review state', 'lifecycle tuple'],
    'Runtime claim evidence migration preserved fields',
  );
  expectSetEqual(
    expectStringArray(taskStateContract.advancement_outcomes, 'Runtime contract.proposal.task_state.advancement_outcomes'),
    [...STEP_ADVANCEMENT_OUTCOMES],
    'Runtime contract task-state advancement outcomes',
  );
  const reviewReceiptContract = expectRecord(taskStateContract.review_receipt, 'Runtime contract.proposal.task_state.review_receipt');
  expectExactKeys(reviewReceiptContract, ['required', 'verdict', 'cycle_phase', 'target_verification'], 'Runtime contract.proposal.task_state.review_receipt');
  expectSetEqual(
    expectStringArray(reviewReceiptContract.required, 'Runtime contract.proposal.task_state.review_receipt.required'),
    ['cycle_id', 'cycle_phase', 'change_set_id', 'review_target_revision', 'verdict', 'admitted_fingerprints', 'evidence_refs'],
    'Runtime contract review receipt required fields',
  );
  if (reviewReceiptContract.verdict !== 'clean') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract review receipt verdict must remain clean.');
  expectSetEqual(
    expectStringArray(reviewReceiptContract.cycle_phase, 'Runtime contract.proposal.task_state.review_receipt.cycle_phase'),
    [...REVIEW_CYCLE_PHASES],
    'Runtime contract review receipt cycle phases',
  );
  if (reviewReceiptContract.target_verification !== 'runtime-file-manifest') fail('RUNTIME_CONTRACT_INVALID', 'review receipt target verification must be runtime-file-manifest.');
  const reviewResultContract = expectRecord(taskStateContract.review_result, 'Runtime contract.proposal.task_state.review_result');
  expectExactKeys(reviewResultContract, ['stored_in', 'verdicts', 'binds', 'consumed_by', 'test_assessment'], 'Runtime contract.proposal.task_state.review_result');
  expectSetEqual(expectStringArray(reviewResultContract.test_assessment, 'review_result.test_assessment'), ['applicable','reason','evidence_refs','necessity','oracle','boundary','reuse','applicability'], 'test assessment fields');
  if (reviewResultContract.stored_in !== 'canonical CURRENT_TASK.runtime_state.pending_review_result') fail('RUNTIME_CONTRACT_INVALID', 'review result must use canonical pending review storage.');
  expectSetEqual(expectStringArray(reviewResultContract.verdicts, 'Runtime contract review-result verdicts'), [...REVIEW_RESULT_VERDICTS], 'Runtime contract review-result verdicts');
  expectSetEqual(expectStringArray(reviewResultContract.binds, 'Runtime contract review-result bindings'), ['active_step_id', 'review_cycle_id', 'latest_execution_id', 'change_set_id', 'review_target_revision'], 'Runtime contract review-result bindings');
  const reviewResultConsumers = expectRecord(reviewResultContract.consumed_by, 'Runtime contract review-result consumers');
  expectExactKeys(reviewResultConsumers, ['clean', 'findings', 'blocked'], 'Runtime contract review-result consumers');
  if (reviewResultConsumers.clean !== 'execute-step:complete-reviewed-step' || reviewResultConsumers.findings !== 'execute-step:begin-repair' || reviewResultConsumers.blocked !== 'caller-route') fail('RUNTIME_CONTRACT_INVALID', 'Runtime review-result consumers are invalid.');
  const draftContract = expectRecord(taskStateContract.draft, 'Runtime contract.proposal.task_state.draft');
  expectExactKeys(draftContract, ['mode', 'actions', 'identity_required', 'definition_required', 'claim_evidence', 'task_basis', 'create_from', 'update_from', 'target', 'previous_close_reconciliation', 'step_admission', 'preserves'], 'Runtime contract.proposal.task_state.draft');
  if (draftContract.mode !== 'default') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state draft mode must remain default.');
  expectSetEqual(expectStringArray(draftContract.actions, 'Runtime contract.proposal.task_state.draft.actions'), ['create-draft', 'update-draft'], 'Runtime contract task-state draft actions');
  expectSetEqual(expectStringArray(draftContract.identity_required, 'Runtime contract.proposal.task_state.draft.identity_required'), ['task_id', 'task_slug', 'document_id', 'task_title'], 'Runtime contract task-state draft identity fields');
  expectSetEqual(expectStringArray(draftContract.definition_required, 'Runtime contract.proposal.task_state.draft.definition_required'), [...REPLAN_REPLACEMENT_FIELDS], 'Runtime contract task-state draft definition fields');
  if (draftContract.claim_evidence !== DRAFT_CLAIM_EVIDENCE_REQUIREMENT) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime draft claim evidence requirement is invalid.');
  }
  const draftTaskBasis = expectRecord(draftContract.task_basis, 'Runtime contract.proposal.task_state.draft.task_basis');
  expectExactKeys(draftTaskBasis, ['required', 'source_fields', 'storage', 'write_binding', 'review_results_forbidden'], 'Runtime contract.proposal.task_state.draft.task_basis');
  expectSetEqual(expectStringArray(draftTaskBasis.required, 'Runtime contract draft task basis required fields'), ['original_request', 'user_decisions'], 'Runtime contract draft task basis required fields');
  expectSetEqual(expectStringArray(draftTaskBasis.source_fields, 'Runtime contract draft task basis source fields'), ['source', 'verbatim'], 'Runtime contract draft task basis source fields');
  if (draftTaskBasis.storage !== 'identity-derived-linked-document' || draftTaskBasis.write_binding !== 'same-atomic-draft-transaction' || draftTaskBasis.review_results_forbidden !== true) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime draft task basis storage boundary is invalid.');
  }
  for (const [field, expected] of [['create_from', 'closed + archived'], ['update_from', 'draft + active'], ['target', 'draft + active']] as const) {
    if (draftContract[field] !== expected) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract task-state draft ${field} must be ${expected}.`);
  }
  const draftReconciliation = expectRecord(draftContract.previous_close_reconciliation, 'Runtime contract.proposal.task_state.draft.previous_close_reconciliation');
  expectExactKeys(draftReconciliation, ['archive', 'status', 'admitted_lesson'], 'Runtime contract.proposal.task_state.draft.previous_close_reconciliation');
  if (draftReconciliation.archive !== 'required' || draftReconciliation.status !== 'required' || draftReconciliation.admitted_lesson !== 'required-or-durable-reuse-proof') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state draft previous_close_reconciliation requirements are invalid.');
  }
  const draftStepAdmission = expectRecord(draftContract.step_admission, 'Runtime contract.proposal.task_state.draft.step_admission');
  expectExactKeys(draftStepAdmission, ['all_steps_metadata_complete', 'active_step'], 'Runtime contract.proposal.task_state.draft.step_admission');
  if (draftStepAdmission.all_steps_metadata_complete !== true || draftStepAdmission.active_step !== 'first-admitted-step') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state draft step_admission requirements are invalid.');
  }
  expectSetEqual(
    expectStringArray(draftContract.preserves, 'Runtime contract.proposal.task_state.draft.preserves'),
    ['TASK_ID', 'TASK_SLUG', 'document_id on update', 'execution_log', 'applied_proposals', 'canonical provenance'],
    'Runtime contract task-state draft preserved fields',
  );
  const confirmContract = expectRecord(taskStateContract.confirm, 'Runtime contract.proposal.task_state.confirm');
  expectExactKeys(confirmContract, ['mode', 'action', 'required', 'authority', 'authority_coordinates', 'from', 'to'], 'Runtime contract.proposal.task_state.confirm');
  if (confirmContract.mode !== 'confirm' || confirmContract.action !== 'confirm-draft') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state confirm must use confirm/confirm-draft.');
  expectSetEqual(expectStringArray(confirmContract.required, 'Runtime contract.proposal.task_state.confirm.required'), ['task_id', 'task_slug', 'document_id', 'draft_revision', 'evidence_refs'], 'Runtime contract task-state confirm required fields');
  expectSetEqual(expectStringArray(confirmContract.authority, 'Runtime contract.proposal.task_state.confirm.authority'), ['user-confirmation', 'authorized-caller'], 'Runtime contract task-state confirm authority');
  const confirmCoords = expectRecord(confirmContract.authority_coordinates, 'Runtime contract.proposal.task_state.confirm.authority_coordinates');
  expectExactKeys(confirmCoords, ['required', 'exact_draft_revision'], 'Runtime contract.proposal.task_state.confirm.authority_coordinates');
  expectSetEqual(expectStringArray(confirmCoords.required, 'Runtime contract.proposal.task_state.confirm.authority_coordinates.required'), ['task_id', 'document_id', 'draft_revision'], 'Runtime contract task-state confirm authority coordinates');
  if (confirmCoords.exact_draft_revision !== true) fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state confirm authority_coordinates exact_draft_revision must be true.');
  if (confirmContract.from !== 'draft + active' || confirmContract.to !== 'active + active') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state confirm transition is invalid.');
  const executeStepContract = expectRecord(proposal.execute_step, 'Runtime contract.proposal.execute_step');
  expectExactKeys(executeStepContract, ['semantic_adapter', 'bound_actions'], 'Runtime contract.proposal.execute_step');
  const executeStepAdapter = expectRecord(executeStepContract.semantic_adapter, 'Runtime contract.proposal.execute_step.semantic_adapter');
  expectExactKeys(
    executeStepAdapter,
    [
      'input',
      'commands',
      'step_source',
      'scope_enforcement',
      'command_plan_source',
      'persistent_tests_enforcement',
      'test_strategy_execution',
      'completion_evidence_source',
      'change_detection',
      'proposal_file_policy',
      'advancement_owner',
      'post_completion_commit_owner',
      'post_completion_route',
    ],
    'Runtime contract.proposal.execute_step.semantic_adapter',
  );
  if (executeStepAdapter.input !== 'stdin-json') fail('RUNTIME_CONTRACT_INVALID', 'Runtime execute-step adapter input must remain stdin-json.');
  expectSetEqual(
    expectStringArray(executeStepAdapter.commands, 'Runtime contract.proposal.execute_step.semantic_adapter.commands'),
    ['preflight-step', 'evidence-context', 'retry-step', 'begin-repair', 'record-step-result', 'complete-reviewed-step'],
    'Runtime contract execute-step adapter commands',
  );
  const testStrategyExecution = expectRecord(
    executeStepAdapter.test_strategy_execution,
    'Runtime contract.proposal.execute_step.semantic_adapter.test_strategy_execution',
  );
  expectExactKeys(
    testStrategyExecution,
    ['phase_source', 'legacy_behavior', 'test_first', 'red_evidence', 'non_red_outcome'],
    'Runtime contract execute-step test-strategy execution',
  );
  const testFirstExecution = expectRecord(testStrategyExecution.test_first, 'Runtime contract execute-step test-first execution');
  expectExactKeys(
    testFirstExecution,
    ['first_step_phase', 'later_step_phase', 'first_step_outcome', 'later_step_outcome', 'advancement_gate'],
    'Runtime contract execute-step test-first execution',
  );
  const redEvidence = expectRecord(testStrategyExecution.red_evidence, 'Runtime contract execute-step red evidence');
  expectExactKeys(
    redEvidence,
    ['result_status', 'kind', 'companion_statuses', 'forbidden_statuses', 'acceptance_evidence', 'unexpected_failure_outcome', 'review_checkpoint'],
    'Runtime contract execute-step red evidence',
  );
  expectSetEqual(expectStringArray(redEvidence.companion_statuses, 'Runtime contract execute-step red companion statuses'), ['passed'], 'Runtime contract execute-step red companion statuses');
  expectSetEqual(expectStringArray(redEvidence.forbidden_statuses, 'Runtime contract execute-step red forbidden statuses'), ['failed', 'blocked', 'not-run'], 'Runtime contract execute-step red forbidden statuses');
  if (
    executeStepAdapter.step_source !== 'confirmed-current-task'
    || executeStepAdapter.scope_enforcement !== 'task-and-current-step'
    || executeStepAdapter.command_plan_source !== 'confirmed-current-step'
    || executeStepAdapter.persistent_tests_enforcement !== 'frozen-section-plus-scope-evaluator'
    || executeStepAdapter.completion_evidence_source !== 'recorded-step-result-only'
    || executeStepAdapter.change_detection !== 'runtime-preflight-candidate-before-after-delta'
    || executeStepAdapter.proposal_file_policy !== 'project-external-only'
    || executeStepAdapter.advancement_owner !== 'runtime'
    || executeStepAdapter.post_completion_commit_owner !== 'user-or-explicit-outer-orchestrator'
    || executeStepAdapter.post_completion_route !== 'git-commit'
    || testStrategyExecution.phase_source !== 'versioned-frozen-test-strategy'
    || testStrategyExecution.legacy_behavior !== 'read-history-block-unversioned-execution'
    || testStrategyExecution.non_red_outcome !== 'implemented-with-passed-results-or-bound-reproduction'
    || testFirstExecution.first_step_phase !== 'test-first'
    || testFirstExecution.later_step_phase !== 'test-first'
    || testFirstExecution.first_step_outcome !== 'implemented'
    || testFirstExecution.later_step_outcome !== 'implemented'
    || testFirstExecution.advancement_gate !== 'runtime-consumed-bound-prerequisite-evidence'
    || redEvidence.result_status !== 'expected-failure'
    || redEvidence.kind !== 'behavior-not-implemented'
    || redEvidence.acceptance_evidence !== 'forbidden'
    || redEvidence.unexpected_failure_outcome !== 'blocked'
    || redEvidence.review_checkpoint !== 'required'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime execute-step adapter semantic boundary is invalid.');
  }
  expectSetEqual(
    expectStringArray(executeStepContract.bound_actions, 'Runtime contract.proposal.execute_step.bound_actions'),
    ['admit', 'retry-step', 'record-step-preflight', 'step-progress', 'record-repair-attempt', 'resolve'],
    'Runtime contract execute-step adapter bound actions',
  );
  const reviewChangeContract = expectRecord(proposal.review_change, 'Runtime contract.proposal.review_change');
  expectExactKeys(reviewChangeContract, ['semantic_adapter', 'bound_actions'], 'Runtime contract.proposal.review_change');
  const reviewChangeAdapter = expectRecord(reviewChangeContract.semantic_adapter, 'Runtime contract.proposal.review_change.semantic_adapter');
  expectExactKeys(reviewChangeAdapter, ['input', 'commands', 'context_source', 'reviewable_execution', 'change_set', 'review_target', 'result_storage', 'direct_product_writes', 'advancement_owner'], 'Runtime contract.proposal.review_change.semantic_adapter');
  if (
    reviewChangeAdapter.input !== 'stdin-json'
    || reviewChangeAdapter.context_source !== 'latest-recorded-execution'
    || reviewChangeAdapter.reviewable_execution !== 'implemented-or-test-red-awaiting-required-checkpoint-or-repair-verification'
    || reviewChangeAdapter.change_set !== 'runtime-owned-stable-id'
    || reviewChangeAdapter.review_target !== 'runtime-cumulative-before-after-file-delta'
    || reviewChangeAdapter.result_storage !== 'canonical-pending-review-result'
    || reviewChangeAdapter.direct_product_writes !== 'deny'
    || reviewChangeAdapter.advancement_owner !== 'execute-step'
  ) fail('RUNTIME_CONTRACT_INVALID', 'Runtime review-change adapter semantic boundary is invalid.');
  expectSetEqual(expectStringArray(reviewChangeAdapter.commands, 'Runtime contract review-change commands'), ['review-context', 'review-read', 'record-review-result', 'record-evidence-challenge', 'dismiss-evidence-challenge'], 'Runtime contract review-change commands');
  expectSetEqual(expectStringArray(reviewChangeContract.bound_actions, 'Runtime contract review-change actions'), ['record-review-result', 'record-evidence-challenge', 'dismiss-evidence-challenge'], 'Runtime contract review-change actions');
  const prepareTaskContract = expectRecord(proposal.prepare_task, 'Runtime contract.proposal.prepare_task');
  expectExactKeys(prepareTaskContract, ['semantic_adapter', 'bound_actions', 'draft_mode', 'draft_actions', 'confirm_mode', 'confirm_actions', 'migration_mode', 'migration_actions', 'replan_mode', 'replan_actions', 'direct_replan_result', 'task_history'], 'Runtime contract.proposal.prepare_task');
  const prepareTaskAdapter = expectRecord(prepareTaskContract.semantic_adapter, 'Runtime contract.proposal.prepare_task.semantic_adapter');
  expectExactKeys(
    prepareTaskAdapter,
    [
      'input',
      'commands',
      'draft_fields',
      'optional_draft_fields',
      'task_basis_storage',
      'decision_partition',
      'command_footprint_preflight',
      'confirmation_binding',
      'resume_review_binding',
      'replan_entry',
      'test_strategy',
      'persistent_tests_storage',
      'persistent_tests_enforcement',
      'proposal_file_policy',
      'internal_action_owners',
    ],
    'Runtime contract.proposal.prepare_task.semantic_adapter',
  );
  if (prepareTaskAdapter.input !== 'stdin-json') fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task adapter input must remain stdin-json.');
  expectSetEqual(
    expectStringArray(prepareTaskAdapter.commands, 'Runtime contract.proposal.prepare_task.semantic_adapter.commands'),
    ['prepare-draft', 'confirm-draft', 'clear-resume-review', 'replan', 'prepare-replan', 'confirm-replan', 'discard-replan', 'initialize-preservation'],
    'Runtime contract prepare-task adapter commands',
  );
  expectSetEqual(
    expectStringArray(prepareTaskAdapter.draft_fields, 'Runtime contract.proposal.prepare_task.semantic_adapter.draft_fields'),
    ['task_basis', 'goal', 'acceptance', 'out_of_scope', 'design_decisions', 'mutation_scope', 'test_strategy', 'implementation_steps', 'validation_plan', 'persistent_tests'],
    'Runtime contract prepare-task adapter semantic fields',
  );
  expectSetEqual(expectStringArray(prepareTaskAdapter.optional_draft_fields, 'prepare-task optional fields'), ['project_documents', 'affected_contracts'], 'prepare-task optional fields');
  if (prepareTaskAdapter.task_basis_storage !== 'linked-TASK_BASIS-with-path-and-revision') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task adapter must persist the linked task basis reference.');
  }
  const decisionPartition = expectRecord(prepareTaskAdapter.decision_partition, 'Runtime contract.proposal.prepare_task.semantic_adapter.decision_partition');
  expectExactKeys(decisionPartition, ['decided', 'unresolved'], 'Runtime contract.proposal.prepare_task.semantic_adapter.decision_partition');
  if (decisionPartition.decided !== 'confirmed_decisions' || decisionPartition.unresolved !== 'open_questions') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task adapter must preserve decided and unresolved design choices separately.');
  }
  const commandFootprintPreflight = expectRecord(prepareTaskAdapter.command_footprint_preflight, 'Runtime contract.proposal.prepare_task.semantic_adapter.command_footprint_preflight');
  expectExactKeys(commandFootprintPreflight, ['source', 'fields', 'evaluator', 'timing'], 'Runtime contract.proposal.prepare_task.semantic_adapter.command_footprint_preflight');
  if (
    commandFootprintPreflight.source !== 'implementation_steps[].commands'
    || commandFootprintPreflight.evaluator !== 'shared-mutation-scope-evaluator'
    || commandFootprintPreflight.timing !== 'before-draft-commit'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task adapter command-footprint preflight is not bound to declared step commands before draft commit.');
  }
  expectSetEqual(
    expectStringArray(commandFootprintPreflight.fields, 'Runtime contract.proposal.prepare_task.semantic_adapter.command_footprint_preflight.fields'),
    ['command', 'expected_repo_writes'],
    'Runtime prepare-task adapter command-footprint fields',
  );
  if (prepareTaskAdapter.persistent_tests_storage !== 'existing-scope-and-regression-sections') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task adapter must map persistent tests into existing canonical sections.');
  }
  if (prepareTaskAdapter.confirmation_binding !== 'runtime-issued-draft-receipt-plus-authorized-caller') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task confirmation must bind a Runtime-issued draft receipt to the authorized caller.');
  }
  if (prepareTaskAdapter.resume_review_binding !== 'caller-provided-exact-readiness-receipt') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task resume review must consume a caller-provided exact readiness receipt.');
  }
  if (prepareTaskAdapter.replan_entry !== 'blocked-pending-confirmed-candidate') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task replan must remain blocked pending a confirmed candidate.');
  }
  const testStrategy = expectRecord(prepareTaskAdapter.test_strategy, 'Runtime contract.proposal.prepare_task.semantic_adapter.test_strategy');
  expectExactKeys(
    testStrategy,
    ['storage', 'fields', 'modes', 'sources', 'classifications', 'source_binding', 'precedence', 'ambiguity', 'frozen_by', 'change_after_confirm', 'enforcement', 'ordering_enforcement', 'non_executable_scope'],
    'Runtime contract.proposal.prepare_task.semantic_adapter.test_strategy',
  );
  expectSetEqual(
    expectStringArray(testStrategy.fields, 'Runtime contract prepare-task test-strategy fields'),
    ['mode', 'source', 'source_ref', 'task_classification', 'rationale'],
    'Runtime contract prepare-task test-strategy fields',
  );
  expectSetEqual(
    expectStringArray(testStrategy.modes, 'Runtime contract prepare-task test-strategy modes'),
    ['flexible', 'test-first', 'implementation-first', 'not-applicable'],
    'Runtime contract prepare-task test-strategy modes',
  );
  expectSetEqual(
    expectStringArray(testStrategy.sources, 'Runtime contract prepare-task test-strategy sources'),
    ['explicit-user', 'project-policy', 'inferred-default'],
    'Runtime contract prepare-task test-strategy sources',
  );
  expectSetEqual(
    expectStringArray(testStrategy.classifications, 'Runtime contract prepare-task test-strategy classifications'),
    ['contract-clear-behavior', 'exploratory-or-infrastructure', 'non-executable-change'],
    'Runtime contract prepare-task test-strategy classifications',
  );
  const strategySourceBinding = expectRecord(testStrategy.source_binding, 'Runtime contract prepare-task test-strategy source_binding');
  expectExactKeys(strategySourceBinding, ['explicit-user', 'project-policy', 'inferred-default'], 'Runtime contract prepare-task test-strategy source_binding');
  const strategyPrecedence = expectStringArray(testStrategy.precedence, 'Runtime contract prepare-task test-strategy precedence');
  const nonExecutableScope = expectRecord(testStrategy.non_executable_scope, 'Runtime contract prepare-task test-strategy non_executable_scope');
  expectExactKeys(
    nonExecutableScope,
    ['policy_source', 'required_for', 'evaluated_surfaces', 'policy_pattern_grammar', 'relation', 'missing_or_ambiguous', 'historical_active_tasks', 'error_codes'],
    'Runtime contract prepare-task test-strategy non_executable_scope',
  );
  expectSetEqual(
    expectStringArray(nonExecutableScope.evaluated_surfaces, 'Runtime contract prepare-task test-strategy non-executable evaluated surfaces'),
    ['task-allowed-scope', 'task-conditional-scope', 'implementation-step-mutation-scope'],
    'Runtime contract prepare-task test-strategy non-executable evaluated surfaces',
  );
  expectSetEqual(
    expectStringArray(nonExecutableScope.error_codes, 'Runtime contract prepare-task test-strategy non-executable error codes'),
    ['TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN', 'TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION'],
    'Runtime contract prepare-task test-strategy non-executable error codes',
  );
  if (
    testStrategy.storage !== 'current-task-regression-checks/test-strategy'
    || strategySourceBinding['explicit-user'] !== 'exact-task-basis-source-coordinate'
    || strategySourceBinding['project-policy'] !== 'existing-project-policy-file'
    || strategySourceBinding['inferred-default'] !== 'prepare-task-default'
    || strategyPrecedence.join('\0') !== ['explicit-user', 'project-policy', 'inferred-default'].join('\0')
    || testStrategy.ambiguity !== 'resolve-as-open-question-before-draft-commit'
    || testStrategy.frozen_by !== 'confirm-draft'
    || testStrategy.change_after_confirm !== 'replan-only'
    || testStrategy.enforcement !== 'create-update-confirm-and-replan'
    || testStrategy.ordering_enforcement !== 'runtime-consumed-before-step-slots'
    || nonExecutableScope.policy_source !== '.workflow-system/PROJECT_PROFILE.yaml#boundaries.non_executable_change_paths'
    || nonExecutableScope.required_for !== 'not-applicable'
    || nonExecutableScope.policy_pattern_grammar !== 'exact-path-or-literal-directory-prefix-globstar'
    || nonExecutableScope.relation !== 'exact-or-proven-subset'
    || nonExecutableScope.missing_or_ambiguous !== 'block-not-applicable-only'
    || nonExecutableScope.historical_active_tasks !== 'not-revalidated'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task test-strategy classification, precedence, or freeze boundary is invalid.');
  }
  if (prepareTaskAdapter.persistent_tests_enforcement !== 'frozen-section-plus-scope-evaluator') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task persistent tests must be enforced by the frozen section and scope evaluator.');
  }
  if (prepareTaskAdapter.proposal_file_policy !== 'project-external-only') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task adapter proposal files must remain project-external-only.');
  }
  const internalActionOwners = expectRecord(prepareTaskAdapter.internal_action_owners, 'Runtime contract.proposal.prepare_task.semantic_adapter.internal_action_owners');
  expectExactKeys(internalActionOwners, ['migrate-claim-evidence', 'mark-replan-blocked', 'clear-replan-block'], 'Runtime contract.proposal.prepare_task.semantic_adapter.internal_action_owners');
  if (
    internalActionOwners['migrate-claim-evidence'] !== 'runtime-compatibility'
    || internalActionOwners['mark-replan-blocked'] !== 'runtime-convergence'
    || internalActionOwners['clear-replan-block'] !== 'runtime-convergence'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime prepare-task internal action ownership is invalid.');
  }
  expectSetEqual(
    expectStringArray(prepareTaskContract.bound_actions, 'Runtime contract.proposal.prepare_task.bound_actions'),
    ['clear-resume-review-gate', ...DRAFT_TASK_STATE_ACTIONS, ...CLAIM_EVIDENCE_MIGRATION_ACTIONS, 'mark-replan-blocked', 'clear-replan-block'],
    'Runtime contract prepare-task bound actions',
  );
  if (prepareTaskContract.draft_mode !== 'default' || prepareTaskContract.confirm_mode !== 'confirm') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract prepare-task draft/confirm modes are invalid.');
  expectSetEqual(expectStringArray(prepareTaskContract.draft_actions, 'Runtime contract.proposal.prepare_task.draft_actions'), ['create-draft', 'update-draft'], 'Runtime contract prepare-task draft actions');
  expectSetEqual(expectStringArray(prepareTaskContract.confirm_actions, 'Runtime contract.proposal.prepare_task.confirm_actions'), ['confirm-draft'], 'Runtime contract prepare-task confirm actions');
  if (prepareTaskContract.migration_mode !== 'default') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract prepare-task migration_mode must be default.');
  expectSetEqual(expectStringArray(prepareTaskContract.migration_actions, 'Runtime contract prepare-task migration_actions'), [...CLAIM_EVIDENCE_MIGRATION_ACTIONS], 'Runtime contract prepare-task migration actions');
  if (prepareTaskContract.replan_mode !== 'replan') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract prepare-task replan_mode must be replan.');
  expectSetEqual(
    expectStringArray(prepareTaskContract.replan_actions, 'Runtime contract.proposal.prepare_task.replan_actions'),
    [...REPLAN_TASK_STATE_ACTIONS],
    'Runtime contract prepare-task replan actions',
  );
  if (prepareTaskContract.direct_replan_result !== 'REPLAN_CONFIRMATION_REQUIRED') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must describe the disabled direct replan result.');
  }
  const taskHistory = expectRecord(prepareTaskContract.task_history, 'Runtime contract.proposal.prepare_task.task_history');
  expectExactKeys(taskHistory, ['initialization_preimage', 'supersede_preimage', 'confirmed_replan_preimage', 'correction_candidate', 'evidence_carry_forward', 'external_evidence', 'interrupted_commit', 'recovery_protocol'], 'Runtime contract.proposal.prepare_task.task_history');
  if (digest(taskHistory.recovery_protocol) !== digest(TASK_RECOVERY_PROTOCOL)) fail('RUNTIME_CONTRACT_INVALID', 'Recovery protocol must match the versioned Kernel semantics.');
  if (taskHistory.initialization_preimage !== 'exact-current-task-and-linked-task-basis-before-version-marker'
    || taskHistory.supersede_preimage !== 'exact-current-task-and-linked-task-basis'
    || taskHistory.confirmed_replan_preimage !== 'exact-current-task-and-linked-task-basis-before-publish'
    || taskHistory.correction_candidate !== 'independent-revision-bound-candidate-with-full-old-obligations'
    || taskHistory.evidence_carry_forward !== 'runtime-derived-old-report-and-subject-verified'
    || taskHistory.external_evidence !== 'references-remain-references-explicit-bounded-content-ingestion'
    || taskHistory.interrupted_commit !== 'fail-closed-lock-and-hash-recovery') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime task history contract is invalid.');
  }
  const inboxRecordContract = expectRecord(proposal.inbox_record, 'Runtime contract.proposal.inbox_record');
  expectExactKeys(
    inboxRecordContract,
    ['mode', 'action', 'required', 'record_fields', 'relation', 'duplicate_check', 'proposed_owner', 'target_pattern', 'provenance_fields'],
    'Runtime contract.proposal.inbox_record',
  );
  if (inboxRecordContract.mode !== 'default' || inboxRecordContract.action !== 'record') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract inbox_record must use mode=default and action=record.');
  }
  expectSetEqual(
    expectStringArray(inboxRecordContract.required, 'Runtime contract.proposal.inbox_record.required'),
    ['item_slug', 'record', 'relation_evidence_refs', 'duplicate_check', 'proposed_owner', 'target_path', 'evidence_refs'],
    'Runtime contract inbox record required fields',
  );
  expectSetEqual(
    expectStringArray(inboxRecordContract.record_fields, 'Runtime contract.proposal.inbox_record.record_fields'),
    ['artifact_kind', 'item_id', 'title', 'type', 'source', 'captured_at', 'relation_to_current_task', 'current_task_id', 'description', 'evidence', 'suggested_next_action', 'status'],
    'Runtime contract inbox record durable fields',
  );
  if (inboxRecordContract.relation !== 'unrelated' || inboxRecordContract.duplicate_check !== 'clear') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract inbox records must be proven unrelated and have duplicate_check=clear.');
  }
  expectSetEqual(
    expectStringArray(inboxRecordContract.proposed_owner, 'Runtime contract.proposal.inbox_record.proposed_owner'),
    [...INBOX_SUGGESTED_NEXT_ACTIONS],
    'Runtime contract inbox record owner routes',
  );
  if (inboxRecordContract.target_pattern !== 'TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract inbox record target pattern is invalid.');
  }
  expectSetEqual(
    expectStringArray(inboxRecordContract.provenance_fields, 'Runtime contract.proposal.inbox_record.provenance_fields'),
    ['idempotency_key', 'proposal_digest', 'source_revision', 'source_task_id', 'source_task_slug', 'source_document_id', 'relation_evidence_refs', 'duplicate_check', 'proposed_owner'],
    'Runtime contract inbox record provenance fields',
  );
  const lifecycleContract = expectRecord(proposal.lifecycle, 'Runtime contract.proposal.lifecycle');
  expectExactKeys(lifecycleContract, ['modes', 'bound_modes', 'proposal_only_modes', 'pause_required', 'interrupt_required', 'resume_required', 'supersede_required'], 'Runtime contract.proposal.lifecycle');
  expectSetEqual(expectStringArray(lifecycleContract.modes, 'Runtime contract.proposal.lifecycle.modes'), [...LIFECYCLE_MODES], 'Runtime contract lifecycle modes');
  expectSetEqual(
    expectStringArray(lifecycleContract.bound_modes, 'Runtime contract.proposal.lifecycle.bound_modes'),
    [...LIFECYCLE_MODES],
    'Runtime contract bound lifecycle modes',
  );
  expectSetEqual(
    expectStringArray(lifecycleContract.proposal_only_modes, 'Runtime contract.proposal.lifecycle.proposal_only_modes', true),
    [],
    'Runtime contract proposal-only lifecycle modes',
  );
  const lifecycleRequiredFields: Record<string, string[]> = {
    pause_required: ['lifecycle_state', 'suspension_reason', 'task_start_base', 'last_reviewed_checkpoint', 'current_diff_review_target', 'rollback_conditions', 'resume_review_reasons', 'evidence_refs'],
    interrupt_required: ['lifecycle_state', 'suspension_reason', 'task_start_base', 'last_reviewed_checkpoint', 'current_diff_review_target', 'rollback_conditions', 'resume_review_reasons', 'checkpoint_evidence', 'dirty_attribution', 'environment_state', 'recovery_strategy', 'evidence_refs'],
    resume_required: ['artifact_kind', 'recovery_package_path', 'recovery_package_revision', 'resume_review_reasons', 'evidence_refs'],
    supersede_required: ['invalidation_kind', 'invalidation_reason', 'evidence_refs', 'partial_diff_disposition'],
  };
  for (const [field, expected] of Object.entries(lifecycleRequiredFields)) {
    const required = expectRecord(lifecycleContract[field], `Runtime contract.proposal.lifecycle.${field}`);
    expectExactKeys(required, ['required'], `Runtime contract.proposal.lifecycle.${field}`);
    expectSetEqual(expectStringArray(required.required, `Runtime contract.proposal.lifecycle.${field}.required`), expected, `Runtime contract lifecycle ${field}`);
  }
  const closeTaskContract = expectRecord(proposal.close_task, 'Runtime contract.proposal.close_task');
  expectExactKeys(closeTaskContract, ['default_mode', 'preview_mode', 'terminal_from', 'terminal_to', 'claim_evidence', 'lesson_admission', 'knowledge_admission'], 'Runtime contract.proposal.close_task');
  if (closeTaskContract.default_mode !== 'default' || closeTaskContract.preview_mode !== 'preview') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract close-task must reserve default closure and preview read-only semantics.');
  }
  expectSetEqual(expectStringArray(closeTaskContract.terminal_from, 'Runtime contract close-task terminal_from'), ['active + active'], 'Runtime contract close-task terminal_from');
  expectSetEqual(expectStringArray(closeTaskContract.terminal_to, 'Runtime contract close-task terminal_to'), ['closed + archived'], 'Runtime contract close-task terminal_to');
  expectSetEqual(expectStringArray(closeTaskContract.lesson_admission, 'Runtime contract close-task lesson_admission'), ['admit', 'defer', 'no-op'], 'Runtime contract close-task lesson admission');
  if (closeTaskContract.claim_evidence !== CLOSE_TASK_CLAIM_EVIDENCE_RULE) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime close-task claim evidence derivation rule is invalid.');
  }
  const knowledgeAdmissionContract = expectRecord(closeTaskContract.knowledge_admission, 'Runtime contract.proposal.close_task.knowledge_admission');
  expectExactKeys(knowledgeAdmissionContract, ['dispositions', 'durable_dispositions', 'candidate_fields', 'implementation_anchors', 'reentry_source'], 'Runtime contract close-task knowledge_admission');
  expectSetEqual(expectStringArray(knowledgeAdmissionContract.dispositions, 'Runtime contract close-task knowledge dispositions'), ['admit', 'defer', 'merge', 'no-op', 'reject', 'supersede'], 'Runtime contract close-task knowledge dispositions');
  expectSetEqual(expectStringArray(knowledgeAdmissionContract.durable_dispositions, 'Runtime contract close-task durable knowledge dispositions'), ['admit', 'merge', 'supersede'], 'Runtime contract close-task durable knowledge dispositions');
  expectSetEqual(expectStringArray(knowledgeAdmissionContract.candidate_fields, 'Runtime contract close-task knowledge candidate fields'), [...KNOWLEDGE_CANDIDATE_KEYS], 'Runtime contract close-task knowledge candidate fields');
  const anchorContract = expectRecord(knowledgeAdmissionContract.implementation_anchors, 'Runtime contract close-task implementation_anchors');
  expectExactKeys(anchorContract, ['coverage', 'max_anchors', 'line_number_locators', 'missing_symbol_behavior'], 'Runtime contract close-task implementation_anchors');
  expectSetEqual(expectStringArray(anchorContract.coverage, 'Runtime contract close-task implementation_anchors.coverage'), ['observed', 'verified-scope'], 'Runtime contract implementation anchor coverage');
  if (expectInteger(anchorContract.max_anchors, 'Runtime contract close-task implementation_anchors.max_anchors', 0, 5) !== 5 || anchorContract.line_number_locators !== 'forbidden' || anchorContract.missing_symbol_behavior !== 'live-search-fallback') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime implementation anchors must remain bounded hints with live-search fallback.');
  }
  if (knowledgeAdmissionContract.reentry_source !== 'canonical-task-archive-admission') fail('RUNTIME_CONTRACT_INVALID', 'Runtime knowledge re-entry must use canonical task archive admission provenance.');
  const lessonMarkerContract = expectRecord(proposal.lesson_marker, 'Runtime contract.proposal.lesson_marker');
  expectExactKeys(
    lessonMarkerContract,
    ['contract', 'marker_version_field', 'noncanonical_behavior', 'persisted', 'reused'],
    'Runtime contract.proposal.lesson_marker',
  );
  if (
    lessonMarkerContract.contract !== 'vnext-lesson-marker/canonical-v1'
    || lessonMarkerContract.marker_version_field !== 'absent'
    || lessonMarkerContract.noncanonical_behavior !== 'fail-closed'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract lesson marker must expose the canonical closed schema.');
  }
  const persistedLessonMarker = expectRecord(lessonMarkerContract.persisted, 'Runtime contract.proposal.lesson_marker.persisted');
  expectExactKeys(persistedLessonMarker, ['fields', 'disposition'], 'Runtime contract.proposal.lesson_marker.persisted');
  expectSetEqual(
    expectStringArray(persistedLessonMarker.fields, 'Runtime contract.proposal.lesson_marker.persisted.fields'),
    ['task_id', 'task_slug', 'document_id', 'archive_path', 'archive_revision', 'source_revision', 'candidate_ref', 'candidate_digest', 'evidence_refs'],
    'Runtime contract persisted Lesson marker fields',
  );
  if (persistedLessonMarker.disposition !== 'omitted') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract persisted Lesson markers must omit disposition.');
  const reusedLessonMarker = expectRecord(lessonMarkerContract.reused, 'Runtime contract.proposal.lesson_marker.reused');
  expectExactKeys(reusedLessonMarker, ['fields', 'disposition', 'reused_candidate_fields'], 'Runtime contract.proposal.lesson_marker.reused');
  expectSetEqual(
    expectStringArray(reusedLessonMarker.fields, 'Runtime contract.proposal.lesson_marker.reused.fields'),
    ['task_id', 'task_slug', 'document_id', 'archive_path', 'archive_revision', 'source_revision', 'candidate_ref', 'candidate_digest', 'evidence_refs', 'disposition', 'reused_candidate'],
    'Runtime contract reused Lesson marker fields',
  );
  if (reusedLessonMarker.disposition !== 'reused') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract reused Lesson markers must use disposition=reused.');
  expectSetEqual(
    expectStringArray(reusedLessonMarker.reused_candidate_fields, 'Runtime contract.proposal.lesson_marker.reused.reused_candidate_fields'),
    ['task_id', 'document_id', 'archive_revision', 'candidate_ref'],
    'Runtime contract reused Lesson candidate identity fields',
  );
  const mutationScopeContract = expectRecord(contract.mutation_scope, 'Runtime contract.mutation_scope');
  expectExactKeys(
    mutationScopeContract,
    ['status', 'binding', 'source', 'buckets', 'default_write_policy', 'read_discovery_is_not_write_authority', 'ordinary_write_scope', 'broad_glob_requires', 'conditional_expansion_requires', 'persistent_test_policy', 'changed_goal_scope_acceptance', 'check_command', 'input', 'output', 'command_write_footprint'],
    'Runtime contract.mutation_scope',
  );
  if (
    mutationScopeContract.status !== 'bound'
    || mutationScopeContract.binding !== 'vnext-runtime-read-only'
    || mutationScopeContract.source !== 'CURRENT_TASK.md'
    || mutationScopeContract.default_write_policy !== 'deny'
    || mutationScopeContract.read_discovery_is_not_write_authority !== true
    || mutationScopeContract.ordinary_write_scope !== 'exact-file-or-file-plus-symbol'
    || mutationScopeContract.broad_glob_requires !== 'inherently-broad-transformation'
    || mutationScopeContract.conditional_expansion_requires !== 'evidence-and-authority'
    || mutationScopeContract.changed_goal_scope_acceptance !== 'supersede-or-replan'
    || mutationScopeContract.check_command !== 'scope-check'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime mutation scope contract must keep the frozen default-deny and read/write separation semantics.');
  }
  expectSetEqual(
    expectStringArray(mutationScopeContract.buckets, 'Runtime contract.mutation_scope.buckets'),
    ['Allowed Files', 'Conditional Files', 'Forbidden Files'],
    'Runtime mutation scope buckets',
  );
  const persistentTestPolicy = expectRecord(mutationScopeContract.persistent_test_policy, 'Runtime contract.mutation_scope.persistent_test_policy');
  expectExactKeys(persistentTestPolicy, ['source', 'when_present', 'conventional_paths', 'nonconventional_paths', 'legacy_missing_section'], 'Runtime contract.mutation_scope.persistent_test_policy');
  if (
    persistentTestPolicy.source !== 'CURRENT_TASK Persistent Tests section'
    || persistentTestPolicy.when_present !== 'exact-allowlist-default-deny'
    || persistentTestPolicy.conventional_paths !== 'runtime-classified'
    || persistentTestPolicy.nonconventional_paths !== 'caller-declared'
    || persistentTestPolicy.legacy_missing_section !== 'compatibility-unenforced'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime persistent-test mutation policy is invalid.');
  }
  const mutationScopeInput = expectRecord(mutationScopeContract.input, 'Runtime contract.mutation_scope.input');
  expectExactKeys(mutationScopeInput, ['required'], 'Runtime contract.mutation_scope.input');
  expectSetEqual(
    expectStringArray(mutationScopeInput.required, 'Runtime contract.mutation_scope.input.required'),
    ['explicit_changed_paths', 'conditional_authorizations_with_evidence_and_authority', 'transformation_kind'],
    'Runtime mutation scope input',
  );
  const mutationScopeOutput = expectRecord(mutationScopeContract.output, 'Runtime contract.mutation_scope.output');
  expectExactKeys(mutationScopeOutput, ['required'], 'Runtime contract.mutation_scope.output');
  expectSetEqual(
    expectStringArray(mutationScopeOutput.required, 'Runtime contract.mutation_scope.output.required'),
    ['per-path-admission-and-blocker', 'separate-read-discovery-match', 'source-revision'],
    'Runtime mutation scope output',
  );
  const commandWriteFootprint = expectRecord(mutationScopeContract.command_write_footprint, 'Runtime contract.mutation_scope.command_write_footprint');
  expectExactKeys(commandWriteFootprint, ['pre_command', 'expected', 'post_command', 'observation_limitations'], 'Runtime contract.mutation_scope.command_write_footprint');
  if (commandWriteFootprint.pre_command !== 'required') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime command write footprints must be required before a repo-writing command executes.');
  }
  const expectedFootprint = expectRecord(commandWriteFootprint.expected, 'Runtime contract.mutation_scope.command_write_footprint.expected');
  expectExactKeys(expectedFootprint, ['required', 'bounded_kind', 'unbounded_behavior', 'admission'], 'Runtime contract.mutation_scope.command_write_footprint.expected');
  expectSetEqual(
    expectStringArray(expectedFootprint.required, 'Runtime contract.mutation_scope.command_write_footprint.expected.required'),
    ['command', 'kind', 'repository_relative_targets', 'evidence_refs'],
    'Runtime command expected write footprint fields',
  );
  if (expectedFootprint.bounded_kind !== 'bounded' || expectedFootprint.unbounded_behavior !== 'blocked-before-execution' || expectedFootprint.admission !== 'shared-mutation-scope-evaluator') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime command expected write footprint admission is not fail-closed or canonical.');
  }
  const postCommandFootprint = expectRecord(commandWriteFootprint.post_command, 'Runtime contract.mutation_scope.command_write_footprint.post_command');
  expectExactKeys(postCommandFootprint, ['observed_field', 'admission', 'cleanup_behavior'], 'Runtime contract.mutation_scope.command_write_footprint.post_command');
  if (postCommandFootprint.observed_field !== 'observed_write_paths' || postCommandFootprint.admission !== 'shared-mutation-scope-evaluator' || postCommandFootprint.cleanup_behavior !== 'sticky-blocked-after-unauthorized-observation') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime command observed-write audit must reuse canonical scope judgment and retain unauthorized observations after cleanup.');
  }
  expectSetEqual(
    expectStringArray(commandWriteFootprint.observation_limitations, 'Runtime contract.mutation_scope.command_write_footprint.observation_limitations'),
    ['no-os-level-transient-write-history-proof'],
    'Runtime command write observation limitations',
  );
  const canonical = expectRecord(contract.canonical_current_task, 'Runtime contract.canonical_current_task');
  expectExactKeys(canonical, ['frontmatter', 'runtime_state', 'source_of_truth', 'legacy_schema_behavior'], 'Runtime contract.canonical_current_task');
  const frontmatter = expectRecord(canonical.frontmatter, 'Runtime contract.canonical_current_task.frontmatter');
  expectExactKeys(frontmatter, ['schema_version', 'kind', 'required'], 'Runtime contract.canonical_current_task.frontmatter');
  if (frontmatter.schema_version !== 1 || frontmatter.kind !== VNEXT_CURRENT_TASK_KIND) fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract current-task frontmatter marker is invalid.');
  expectSetEqual(
    expectStringArray(frontmatter.required, 'Runtime contract.canonical_current_task.frontmatter.required'),
    ['document_id', 'runtime_state'],
    'Runtime contract current-task frontmatter',
  );
  const runtimeState = expectRecord(canonical.runtime_state, 'Runtime contract.canonical_current_task.runtime_state');
  expectExactKeys(runtimeState, ['schema_version', 'kind', 'fields', 'review_cycle'], 'Runtime contract.canonical_current_task.runtime_state');
  if (runtimeState.schema_version !== 1 || runtimeState.kind !== VNEXT_RUNTIME_STATE_KIND) fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract runtime-state marker is invalid.');
  expectSetEqual(
    expectStringArray(runtimeState.fields, 'Runtime contract.canonical_current_task.runtime_state.fields'),
    [...RUNTIME_STATE_FIELDS],
    'Runtime contract runtime-state fields',
  );
  const reviewCycleContract = expectRecord(runtimeState.review_cycle, 'Runtime contract.canonical_current_task.runtime_state.review_cycle');
  expectExactKeys(reviewCycleContract, ['fields', 'repair_round_max', 'same_repair_wave_counts_once', 'verification_new_finding_wave_max'], 'Runtime contract.canonical_current_task.runtime_state.review_cycle');
  expectSetEqual(
    expectStringArray(reviewCycleContract.fields, 'Runtime contract.canonical_current_task.runtime_state.review_cycle.fields'),
    [...REVIEW_CYCLE_FIELDS],
    'Runtime contract review-cycle fields',
  );
  if (expectInteger(reviewCycleContract.repair_round_max, 'Runtime contract review-cycle repair_round_max', 0, MAX_REPAIR_ROUNDS) !== MAX_REPAIR_ROUNDS) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract review-cycle repair_round_max must be 3.');
  }
  if (expectBoolean(reviewCycleContract.same_repair_wave_counts_once, 'Runtime contract review-cycle same_repair_wave_counts_once') !== true) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must count each repair wave once per review cycle.');
  }
  if (expectInteger(reviewCycleContract.verification_new_finding_wave_max, 'Runtime contract review-cycle verification_new_finding_wave_max', 0, 1) !== 1) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must allow at most one verification new-finding admission wave per review cycle.');
  }
  if (canonical.source_of_truth !== 'same-canonical-CURRENT_TASK-document' || canonical.legacy_schema_behavior !== 'migration-required') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must keep CURRENT_TASK as the only state source and stop on legacy schema.');
  const concurrency = expectRecord(contract.concurrency, 'Runtime contract.concurrency');
  expectExactKeys(concurrency, ['model', 'concurrent_state_changing_writers', 'stale_detection'], 'Runtime contract.concurrency');
  if (
    concurrency.model !== 'single-authorized-writer'
    || concurrency.concurrent_state_changing_writers !== 'forbidden'
    || concurrency.stale_detection !== 'source-revision-and-explicit-recovery-package-revision'
  ) {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must require a single authorized state-changing writer plus explicit recovery package revision stale detection.');
  }
  const operations = contract.operations;
  if (!Array.isArray(operations) || operations.length !== RUNTIME_OPERATION_KINDS.length) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract must declare exactly the ${RUNTIME_OPERATION_KINDS.length} Phase 2 bound operations.`);
  const bound: RuntimeOperationKind[] = [];
  for (const [index, rawOperation] of operations.entries()) {
    const operation = expectRecord(rawOperation, `Runtime contract.operations[${index}]`);
    expectExactKeys(operation, ['id', 'status', 'binding', 'operation', 'source_targets', 'write_targets', 'allowed_callers', 'result_states', 'atomic', 'idempotence', 'conflict_policy'], `Runtime contract.operations[${index}]`);
    const id = expectEnum(operation.id, RUNTIME_OPERATION_KINDS, `Runtime contract.operations[${index}].id`);
    if (bound.includes(id)) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} is duplicated.`);
    bound.push(id);
    if (operation.status !== 'bound' || operation.binding !== 'vnext-runtime') fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must be bound to vnext-runtime.`);
    if (operation.operation !== id) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must identify its logical operation.`);
    const operationContract: Record<RuntimeOperationKind, { source: string[]; writes: string[]; callers: string[] }> = {
      'task-state-transaction': {
        source: ['CURRENT_TASK.md', 'task-basis/TASK_BASIS-<TASK_ID>.md'],
        writes: ['CURRENT_TASK.md', 'task-basis/TASK_BASIS-<TASK_ID>.md'],
        callers: ['execute-step', 'review-change', 'prepare-task'],
      },
      'finding-queue-transaction': {
        source: ['CURRENT_TASK.md'],
        writes: ['CURRENT_TASK.md'],
        callers: ['execute-step'],
      },
      'lifecycle-transaction': {
        source: ['CURRENT_TASK.md', 'TASKS/paused/**', 'TASKS/interrupted/**'],
        writes: ['CURRENT_TASK.md', 'TASKS/paused/**', 'TASKS/interrupted/**'],
        callers: ['task-lifecycle'],
      },
      'inbox-record-transaction': {
        source: ['CURRENT_TASK.md', 'TASKS/inbox/**'],
        writes: ['TASKS/inbox/**'],
        callers: ['capture-work-item'],
      },
      'project-status-transaction': {
        source: ['CURRENT_TASK.md', 'STATUS.md', 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md'],
        writes: ['STATUS.md'],
        callers: ['close-task'],
      },
      'archive-transaction': {
        source: ['CURRENT_TASK.md', 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md'],
        writes: ['CURRENT_TASK.md', 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md'],
        callers: ['close-task'],
      },
      'lesson-record-transaction': {
        source: ['CURRENT_TASK.md', 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md', 'LESSONS.md'],
        writes: ['LESSONS.md'],
        callers: ['close-task'],
      },
      'contract-candidate-commit': {
        source: ['CURRENT_TASK.md', 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md', 'CONTRACTS.md'],
        writes: ['CONTRACTS.md'],
        callers: ['close-task'],
      },
      'decision-record-transaction': {
        source: ['CURRENT_TASK.md', 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md', 'DECISIONS.md'],
        writes: ['DECISIONS.md'],
        callers: ['close-task'],
      },
    };
    const expectedTargets = operationContract[id];
    expectSetEqual(
      expectStringArray(operation.source_targets, `Runtime contract.operations[${index}].source_targets`),
      expectedTargets.source,
      `Runtime contract operation ${id}.source_targets`,
    );
    expectSetEqual(
      expectStringArray(operation.write_targets, `Runtime contract.operations[${index}].write_targets`),
      expectedTargets.writes,
      `Runtime contract operation ${id}.write_targets`,
    );
    expectSetEqual(expectStringArray(operation.allowed_callers, `Runtime contract.operations[${index}].allowed_callers`), expectedTargets.callers, `Runtime contract operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray(operation.result_states, `Runtime contract.operations[${index}].result_states`), [...RUNTIME_RESULT_STATES], `Runtime contract operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== 'fail-closed' || operation.conflict_policy !== 'fail-closed') fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must be atomic, fail-closed, and conflict-safe.`);
  }
  expectSetEqual(bound, [...RUNTIME_OPERATION_KINDS], 'Runtime contract bound operations');
  const unbound = expectStringArray(contract.unbound_operations, 'Runtime contract.unbound_operations', true);
  expectSetEqual(unbound, [], 'Runtime contract unbound operations');
  const bootstrapOperations = validateBootstrapRuntimeContract(contract.bootstrap_project);
  return {
    phase: 'Phase 2',
    runtime_distribution: distributionIdentity,
    mutation_scope: { status: 'bound', binding: 'vnext-runtime-read-only', check_command: 'scope-check' },
    bound_operations: bound,
    unbound_operations: unbound,
    bootstrap_operations: bootstrapOperations,
  };
}

function validateAuthorityEvidence(value: unknown): AuthorityEvidence[] {
  if (!Array.isArray(value) || value.length === 0) fail('RUNTIME_AUTHORITY_MISSING', 'authority_evidence must be non-empty.');
  const result: AuthorityEvidence[] = [];
  for (const [index, raw] of value.entries()) {
    const record = expectRecord(raw, `authority_evidence[${index}]`);
    const kind = expectEnum(record.kind, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission', 'dangerous-operation', 'resume-review', 'user-confirmation', 'authorized-caller'], `authority_evidence[${index}].kind`);
    const source = normalizeRepoPath(expectString(record.source, `authority_evidence[${index}].source`), `authority_evidence[${index}].source`);
    const hasDraftBinding = 'draft_revision' in record;
    const hasSourceBinding = 'source_revision' in record;
    const hasCoordinateBinding = 'task_id' in record || 'document_id' in record || hasDraftBinding || hasSourceBinding;
    if (hasDraftBinding && hasSourceBinding) {
      fail('RUNTIME_SCHEMA_INVALID', `authority_evidence[${index}] cannot bind both draft_revision and source_revision.`);
    }
    if (hasCoordinateBinding) {
      const revisionField = hasSourceBinding ? 'source_revision' : 'draft_revision';
      const expectedKeys = 'subject' in record
        ? ['kind', 'source', 'subject', 'task_id', 'document_id', revisionField]
        : ['kind', 'source', 'task_id', 'document_id', revisionField];
      expectExactKeys(record, expectedKeys, `authority_evidence[${index}]`);
      const taskId = expectString(record.task_id, `authority_evidence[${index}].task_id`);
      try {
        validateTaskId(taskId);
      } catch (error) {
        fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
      }
      const documentId = expectString(record.document_id, `authority_evidence[${index}].document_id`);
      if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', `authority_evidence[${index}].document_id is invalid.`);
      const authorityRevision = expectString(record[revisionField], `authority_evidence[${index}].${revisionField}`);
      if (!/^[a-f0-9]{64}$/.test(authorityRevision)) fail('RUNTIME_SCHEMA_INVALID', `authority_evidence[${index}].${revisionField} must be SHA-256.`);
      result.push({
        kind,
        source,
        subject: 'subject' in record ? expectText(record.subject, `authority_evidence[${index}].subject`, 256) : taskId,
        task_id: taskId,
        document_id: documentId,
        [revisionField]: authorityRevision,
      });
    } else {
      expectExactKeys(record, ['kind', 'source', 'subject'], `authority_evidence[${index}]`);
      result.push({
        kind,
        source,
        subject: expectText(record.subject, `authority_evidence[${index}].subject`, 256),
      });
    }
  }
  return result;
}

function validateSourceTuple(value: unknown): RuntimeSourceTuple {
  const record = expectRecord(value, 'source_tuple');
  expectExactKeys(
    record,
    ['path', 'revision', 'document_id', 'task_id', 'task_slug', 'workflow_status', 'lifecycle_state', 'active_step_id', 'active_step_status', 'finding_queue_revision', 'resume_requires_review', 'resume_review_reasons'],
    'source_tuple',
  );
  const taskId = expectString(record.task_id, 'source_tuple.task_id');
  const taskSlug = expectString(record.task_slug, 'source_tuple.task_slug');
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
  }
  const documentId = expectString(record.document_id, 'source_tuple.document_id');
  if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', 'source_tuple.document_id is invalid.');
  const revision = expectString(record.revision, 'source_tuple.revision');
  if (!/^[a-f0-9]{64}$/.test(revision)) fail('RUNTIME_SCHEMA_INVALID', 'source_tuple.revision must be SHA-256.');
  const workflowStatus = expectEnum(record.workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, 'source_tuple.workflow_status');
  const lifecycleState = expectEnum(record.lifecycle_state, TASK_LIFECYCLE_STATES, 'source_tuple.lifecycle_state');
  try {
    validateCurrentTaskStatusTuple(workflowStatus, lifecycleState);
  } catch (error) {
    fail('RUNTIME_STATE_CONFLICT', error instanceof Error ? error.message : String(error));
  }
  const resumeRequiresReview = expectBoolean(record.resume_requires_review, 'source_tuple.resume_requires_review');
  const rawResumeReasons = expectStringArray(record.resume_review_reasons, 'source_tuple.resume_review_reasons', true, RESUME_REVIEW_REASON_ORDER.length);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReasons);
  if (rawResumeReasons.join('|') !== resumeReviewReasons.join('|')) {
    fail('RUNTIME_SCHEMA_INVALID', 'source_tuple.resume_review_reasons must use the canonical closed-set order.');
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail('RUNTIME_STATE_CONFLICT', error instanceof Error ? error.message : String(error));
  }
  if (workflowStatus === 'suspended' && !resumeRequiresReview) {
    fail('RUNTIME_STATE_CONFLICT', 'suspended CURRENT_TASK state must remain behind a non-empty resume review gate.');
  }
  return {
    path: normalizeRepoPath(expectString(record.path, 'source_tuple.path'), 'source_tuple.path'),
    revision,
    document_id: documentId,
    task_id: taskId,
    task_slug: taskSlug,
    workflow_status: workflowStatus,
    lifecycle_state: lifecycleState,
    active_step_id: expectString(record.active_step_id, 'source_tuple.active_step_id', STEP_ID_PATTERN),
    active_step_status: expectEnum(record.active_step_status, STEP_STATUSES, 'source_tuple.active_step_status'),
    finding_queue_revision: expectInteger(record.finding_queue_revision, 'source_tuple.finding_queue_revision'),
    resume_requires_review: resumeRequiresReview,
    resume_review_reasons: resumeReviewReasons,
  };
}

function validateEvidenceRefs(value: unknown, location: string): string[] {
  return expectStringArray(value, location, false, MAX_EVIDENCE_REFS);
}

function validateExecutionResultPaths(value: unknown, location: string): string[] {
  const values = expectStringArray(value, location, true, MAX_EXECUTION_RESULT_ITEMS)
    .map((item, index) => normalizeRepoPath(item, `${location}[${index}]`));
  if (new Set(values).size !== values.length) fail('RUNTIME_SCHEMA_INVALID', `${location} must not contain duplicates.`);
  return values;
}

function validateReviewTarget(value: unknown, location: string): ReviewTarget {
  const target = expectRecord(value, location);
  expectExactKeys(target, ['kind', 'revision', 'entries'], location);
  if (target.kind !== 'runtime-file-manifest/v1') {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.kind must be runtime-file-manifest/v1.`);
  }
  if (!Array.isArray(target.entries) || target.entries.length > MAX_EXECUTION_RESULT_ITEMS) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.entries must be a bounded array.`);
  }
  const entries = target.entries.map((value, index): ReviewTargetEntry => {
    const entryLocation = `${location}.entries[${index}]`;
    const entry = expectRecord(value, entryLocation);
    expectExactKeys(entry, ['path', 'state', 'sha256'], entryLocation);
    const state = expectEnum(entry.state, ['file', 'absent', 'symlink'], `${entryLocation}.state`);
    const entryDigest = entry.sha256 === null ? null : expectString(entry.sha256, `${entryLocation}.sha256`);
    if ((state === 'absent') !== (entryDigest === null)) {
      fail('RUNTIME_SCHEMA_INVALID', `${entryLocation}.sha256 must be null exactly when state is absent.`);
    }
    if (entryDigest !== null && !/^[a-f0-9]{64}$/u.test(entryDigest)) {
      fail('RUNTIME_SCHEMA_INVALID', `${entryLocation}.sha256 must be SHA-256.`);
    }
    return {
      path: normalizeRepoPath(expectString(entry.path, `${entryLocation}.path`), `${entryLocation}.path`),
      state,
      sha256: entryDigest,
    };
  });
  const sortedPaths = entries.map(item => item.path).sort();
  if (new Set(sortedPaths).size !== sortedPaths.length || entries.some((item, index) => item.path !== sortedPaths[index])) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.entries must use unique paths in canonical sort order.`);
  }
  const revision = expectString(target.revision, `${location}.revision`);
  if (!/^[a-f0-9]{64}$/u.test(revision) || revision !== digest({ kind: 'runtime-file-manifest/v1', entries })) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.revision does not match its canonical file manifest.`);
  }
  return { kind: 'runtime-file-manifest/v1', revision, entries };
}

export function validateRuntimeReviewTarget(value: unknown, location = 'review_target'): ReviewTarget {
  return validateReviewTarget(value, location);
}

function validateReviewChangeDelta(
  value: unknown,
  location: string,
  base: ReviewTarget,
  target: ReviewTarget,
): ReviewChangeDelta {
  const delta = expectRecord(value, location);
  expectExactKeys(delta, ['kind', 'base_revision', 'target_revision', 'entries'], location);
  if (delta.kind !== 'runtime-file-delta/v1') {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.kind must be runtime-file-delta/v1.`);
  }
  if (!Array.isArray(delta.entries) || delta.entries.length > MAX_EXECUTION_RESULT_ITEMS) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.entries must be a bounded array.`);
  }
  const entries = delta.entries.map((value, index): ReviewChangeDeltaEntry => {
    const entryLocation = `${location}.entries[${index}]`;
    const entry = expectRecord(value, entryLocation);
    expectExactKeys(entry, ['path', 'before_state', 'before_sha256', 'after_state', 'after_sha256'], entryLocation);
    const beforeState = expectEnum(entry.before_state, ['file', 'absent', 'symlink'], `${entryLocation}.before_state`);
    const afterState = expectEnum(entry.after_state, ['file', 'absent', 'symlink'], `${entryLocation}.after_state`);
    const beforeDigest = entry.before_sha256 === null ? null : expectString(entry.before_sha256, `${entryLocation}.before_sha256`);
    const afterDigest = entry.after_sha256 === null ? null : expectString(entry.after_sha256, `${entryLocation}.after_sha256`);
    if ((beforeState === 'absent') !== (beforeDigest === null) || (afterState === 'absent') !== (afterDigest === null)) {
      fail('RUNTIME_SCHEMA_INVALID', `${entryLocation} digests must be null exactly for absent states.`);
    }
    if ((beforeDigest !== null && !/^[a-f0-9]{64}$/u.test(beforeDigest))
      || (afterDigest !== null && !/^[a-f0-9]{64}$/u.test(afterDigest))) {
      fail('RUNTIME_SCHEMA_INVALID', `${entryLocation} digests must be SHA-256.`);
    }
    return {
      path: normalizeRepoPath(expectString(entry.path, `${entryLocation}.path`), `${entryLocation}.path`),
      before_state: beforeState,
      before_sha256: beforeDigest,
      after_state: afterState,
      after_sha256: afterDigest,
    };
  });
  const baseRevision = expectString(delta.base_revision, `${location}.base_revision`, /^[a-f0-9]{64}$/u);
  const targetRevision = expectString(delta.target_revision, `${location}.target_revision`, /^[a-f0-9]{64}$/u);
  const expected = createReviewChangeDelta(base, target);
  const normalized: ReviewChangeDelta = {
    kind: 'runtime-file-delta/v1',
    base_revision: baseRevision,
    target_revision: targetRevision,
    entries,
  };
  if (digest(normalized) !== digest(expected)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} does not match the canonical before/after manifests.`);
  }
  return normalized;
}

function validateStepExpectedFailureEvidence(value: unknown, location: string): StepExpectedFailureEvidence {
  const evidence = expectRecord(value, location);
  expectExactKeys(evidence, ['kind', 'expected_behavior', 'observed_failure_signature'], location);
  if (evidence.kind !== 'behavior-not-implemented') {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.kind must be behavior-not-implemented.`);
  }
  return {
    kind: 'behavior-not-implemented',
    expected_behavior: expectText(evidence.expected_behavior, `${location}.expected_behavior`),
    observed_failure_signature: expectText(evidence.observed_failure_signature, `${location}.observed_failure_signature`),
  };
}

function validateStepExecutionResult(value: unknown, location: string): StepExecutionResult {
  const result = expectRecord(value, location);
  expectExactKeys(result, [
    'outcome',
    'change_set_id',
    'review_base',
    'review_target',
    'change_delta',
    'actual_changed_paths',
    'command_results',
    'validation_results',
    'acceptance_evidence',
    'blocker',
    ...(result.attempt_id === undefined ? [] : ['attempt_id']),
    ...(result.blocker_kind === undefined ? [] : ['blocker_kind']),
  ], location);
  const outcome = expectEnum(result.outcome, ['implemented', 'test-red', 'blocked'], `${location}.outcome`);
  const changeSetId = expectString(result.change_set_id, `${location}.change_set_id`, SAFE_KEY_PATTERN);
  const reviewBase = validateReviewTarget(result.review_base, `${location}.review_base`);
  const reviewTarget = validateReviewTarget(result.review_target, `${location}.review_target`);
  const changeDelta = validateReviewChangeDelta(result.change_delta, `${location}.change_delta`, reviewBase, reviewTarget);
  const actualChangedPaths = validateExecutionResultPaths(result.actual_changed_paths, `${location}.actual_changed_paths`);
  if (digest([...actualChangedPaths].sort()) !== digest(changeDelta.entries.map(item => item.path))) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.actual_changed_paths must exactly match the Runtime before/after delta.`);
  }
  const commandValues = result.command_results;
  if (!Array.isArray(commandValues) || commandValues.length > MAX_EXECUTION_RESULT_ITEMS) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.command_results must be a bounded array.`);
  }
  const commandResults = commandValues.map((item, index): StepCommandResult => {
    const itemLocation = `${location}.command_results[${index}]`;
    const command = expectRecord(item, itemLocation);
    const status = expectEnum(command.status, STEP_EXECUTION_RESULT_STATUSES, `${itemLocation}.status`);
    expectExactKeys(
      command,
      status === 'expected-failure'
        ? ['command', 'status', 'observed_repo_writes', 'evidence_refs', 'expected_failure']
        : ['command', 'status', 'observed_repo_writes', 'evidence_refs'],
      itemLocation,
    );
    const evidenceRefs = expectStringArray(command.evidence_refs, `${itemLocation}.evidence_refs`, status === 'not-run', MAX_EVIDENCE_REFS);
    const observedRepoWrites = validateExecutionResultPaths(command.observed_repo_writes, `${itemLocation}.observed_repo_writes`);
    if (status === 'not-run' && observedRepoWrites.length > 0) {
      fail('RUNTIME_STATE_CONFLICT', `${itemLocation}.not-run command must not report repository writes.`);
    }
    const expectedFailure = status === 'expected-failure'
      ? validateStepExpectedFailureEvidence(command.expected_failure, `${itemLocation}.expected_failure`)
      : undefined;
    return {
      command: expectText(command.command, `${itemLocation}.command`),
      status,
      observed_repo_writes: observedRepoWrites,
      evidence_refs: evidenceRefs,
      ...(expectedFailure ? { expected_failure: expectedFailure } : {}),
    };
  });
  if (new Set(commandResults.map(item => item.command)).size !== commandResults.length) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.command_results must not contain duplicate commands.`);
  }
  const validationValues = result.validation_results;
  if (!Array.isArray(validationValues) || validationValues.length > MAX_EXECUTION_RESULT_ITEMS) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.validation_results must be a bounded array.`);
  }
  const validationResults = validationValues.map((item, index): StepValidationResult => {
    const itemLocation = `${location}.validation_results[${index}]`;
    const validation = expectRecord(item, itemLocation);
    const status = expectEnum(validation.status, STEP_EXECUTION_RESULT_STATUSES, `${itemLocation}.status`);
    expectExactKeys(
      validation,
      status === 'expected-failure'
        ? ['validation', 'status', 'evidence_refs', 'expected_failure']
        : ['validation', 'status', 'evidence_refs'],
      itemLocation,
    );
    const expectedFailure = status === 'expected-failure'
      ? validateStepExpectedFailureEvidence(validation.expected_failure, `${itemLocation}.expected_failure`)
      : undefined;
    return {
      validation: expectText(validation.validation, `${itemLocation}.validation`),
      status,
      evidence_refs: expectStringArray(validation.evidence_refs, `${itemLocation}.evidence_refs`, status === 'not-run', MAX_EVIDENCE_REFS),
      ...(expectedFailure ? { expected_failure: expectedFailure } : {}),
    };
  });
  if (new Set(validationResults.map(item => item.validation)).size !== validationResults.length) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.validation_results must not contain duplicate validations.`);
  }
  const acceptanceEvidence = Array.isArray(result.acceptance_evidence) && result.acceptance_evidence.every(item => isRecord(item) && 'acceptance' in item)
    ? result.acceptance_evidence.map(item => {
      expectExactKeys(item, ['acceptance', 'evidence_refs'], 'historical acceptance evidence');
      return { acceptance: expectText(item.acceptance, 'acceptance'), evidence_refs: validateEvidenceRefs(item.evidence_refs, 'evidence_refs') };
    })
    : validateStepAcceptanceEvidence(result.acceptance_evidence, `${location}.acceptance_evidence`);
  const blocker = result.blocker === null ? null : expectText(result.blocker, `${location}.blocker`);
  const statuses = [...commandResults, ...validationResults].map(item => item.status);
  if (outcome === 'implemented' && (blocker !== null || statuses.some(status => status !== 'passed' && status !== 'expected-failure'))) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.implemented requires every planned result to pass and no blocker.`);
  }
  if (outcome === 'blocked' && (blocker === null || !statuses.some(status => status === 'failed' || status === 'blocked'))) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.blocked requires a blocker and at least one failed or blocked result.`);
  }
  if (outcome === 'test-red') {
    if (blocker !== null
      || acceptanceEvidence.length > 0
      || !statuses.some(status => status === 'expected-failure')
      || statuses.some(status => status !== 'passed' && status !== 'expected-failure')) {
      fail('RUNTIME_STATE_CONFLICT', `${location}.test-red requires expected-failure evidence, permits only passed companion results, forbids acceptance evidence, and has no blocker.`);
    }
  }
  return {
    ...(result.attempt_id === undefined ? {} : {attempt_id:expectString(result.attempt_id, 'execution_result.attempt_id', SAFE_KEY_PATTERN)}),
    ...(result.blocker_kind === undefined ? {} : {blocker_kind:expectEnum(result.blocker_kind, ['environment','unknown'], 'execution_result.blocker_kind')}),
    outcome,
    change_set_id: changeSetId,
    review_base: reviewBase,
    review_target: reviewTarget,
    change_delta: changeDelta,
    actual_changed_paths: changeDelta.entries.map(item => item.path),
    command_results: commandResults,
    validation_results: validationResults,
    acceptance_evidence: acceptanceEvidence,
    blocker,
  };
}

const CLAIM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CLAIM_EVIDENCE_SLOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CLAIM_EVIDENCE_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const COMPLETE_CLAIM_EVIDENCE_DISPOSITIONS: readonly ClaimEvidenceDisposition[] = ['existing', 'reused', 'newly-executed'];

export function validateStepAcceptanceEvidence(value: unknown, location: string): StepAcceptanceEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_EXECUTION_RESULT_ITEMS) fail('RUNTIME_SCHEMA_INVALID', `${location} must be a bounded array.`);
  const results = value.map(raw => {
    const item = expectRecord(raw, location);
    expectExactKeys(item, ['claim_id', 'slot_id', 'check_id', 'minimum_type', 'disposition', 'evidence_refs', 'report'], location);
    return {
      claim_id: expectString(item.claim_id, 'claim_id', CLAIM_ID_PATTERN),
      slot_id: expectString(item.slot_id, 'slot_id', CLAIM_ID_PATTERN),
      check_id: expectString(item.check_id, 'check_id', CLAIM_ID_PATTERN),
      minimum_type: expectString(item.minimum_type, 'minimum_type', CLAIM_EVIDENCE_TYPE_PATTERN),
      disposition: expectEnum(item.disposition, CLAIM_EVIDENCE_DISPOSITIONS, 'disposition'),
      evidence_refs: validateEvidenceRefs(item.evidence_refs, 'evidence_refs'),
      report: validateEvidenceReport(item.report),
    };
  });
  if (new Set(results.map(item => `${item.claim_id}/${item.slot_id}`)).size !== results.length) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'duplicate slot results.');
  return results;
}

export function validateEvidenceReport(value: unknown): EvidenceReport {
  const report = expectRecord(value, 'report');
  expectExactKeys(report, ['result_id', 'status', 'evidence_plan_revision', 'subject_revision', 'actual_method', 'environment', 'assurance'], 'report');
  return {
    result_id: expectString(report.result_id, 'report.result_id', CLAIM_ID_PATTERN),
    status: expectEnum(report.status, ['passed', 'failed', 'blocked', 'not-run', 'skipped', 'accepted', 'expected-failure'], 'report.status'),
    evidence_plan_revision: expectString(report.evidence_plan_revision, 'report.evidence_plan_revision', /^[a-f0-9]{64}$/),
    subject_revision: expectString(report.subject_revision, 'report.subject_revision', /^[a-f0-9]{64}$/),
    actual_method: expectEnum(report.actual_method, ['execution', 'static', 'human'], 'report.actual_method'),
    environment: expectText(report.environment, 'report.environment'),
    assurance: 'caller-reported',
  };
}

function evidenceSlotDefinition(slot: ClaimEvidenceSlot) {
  const { disposition, evidence_refs, report, prerequisite_receipt, ...definition } = slot;
  return definition;
}

function evidencePlanRevision(definition: DraftTaskDefinition, records: readonly ClaimEvidenceRecord[]): string {
  return digest({ definition, claims: records.map(record => ({ ...record, slots: record.slots.map(evidenceSlotDefinition).sort((a, b) => a.slot_id.localeCompare(b.slot_id)) })).sort((a, b) => a.claim_id.localeCompare(b.claim_id)) });
}

export function assertEvidencePlan(definition: DraftTaskDefinition, records: readonly ClaimEvidenceRecord[], fresh = false): string {
  requireClaimEvidencePlan(records, 'evidence plan');
  requireAcceptanceClaim(records, 'evidence plan');
  const steps = parseImplementationSteps(definition.implementation_steps).map(step => step.id);
  const ids = new Set<string>();
  const acceptance = records.filter(record => record.claim_kind === 'acceptance').map(record => record.requirement);
  const projected = definition.acceptance.split(/\r?\n/).map(line => line.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?/, '').trim()).filter(Boolean);
  if (digest(acceptance) !== digest(projected)) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'acceptance must be the exact projection of acceptance claim requirements.');
  for (const record of records) {
    if (!record.requirement || !record.source_ref) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'claims require requirement and source_ref.');
    for (const slot of record.slots) {
      const check = slot.check;
      if (!check || !slot.applicability || !steps.includes(slot.due_step_id!) || slot.minimum_type === 'planned-validation') fail('CLAIM_EVIDENCE_PLAN_INVALID', 'slots require a concrete check, applicability and valid due step.');
      if (ids.has(check.check_id)) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'check_id must be unique across the task.');
      ids.add(check.check_id);
      if (check.subject_paths.some(p => p.includes('*') || /(?:^|\/)CURRENT_TASK\.md$/.test(p) || p.startsWith('.git/')) || new Set(check.subject_paths).size !== check.subject_paths.length) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'subject_paths must be exact unique product paths, excluding Runtime audit state.');
      if (record.claim_kind === 'acceptance' && (slot.applicability !== 'current' || check.expected_result === 'expected-failure')) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'positive acceptance requires current successful evidence.');
      if ((check.method === 'execution') !== (check.expected_result !== 'accepted')) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'execution requires passed/expected-failure; static/human requires accepted.');
      if (slot.applicability === 'before-step') {
        if (!steps.includes(slot.before_step_id!) || steps.indexOf(slot.due_step_id!) > steps.indexOf(slot.before_step_id!)) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'prerequisite must be due no later than its constrained step.');
        if (slot.before_step_id === steps[0]) fail('TEST_STRATEGY_PREREQUISITE_UNSUPPORTED', 'A first-step prerequisite has no earlier authorized result submission step.');
      } else if (slot.before_step_id !== undefined || slot.prerequisite_receipt !== undefined) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'current slots cannot carry prerequisite fields.');
      if (fresh && (slot.report || slot.prerequisite_receipt || slot.disposition !== 'missing' || slot.evidence_refs.length)) fail('CLAIM_EVIDENCE_PLAN_INVALID', 'new plans cannot import results or prerequisite receipts.');
    }
  }
  const parsedSteps = parseImplementationSteps(definition.implementation_steps);
  if (fresh && parsedSteps.some(step => step.review_checkpoint === 'not-required')) {
    if (parsedSteps.some(step => !step.checkpoint_boundary)) fail('REVIEW_CHECKPOINT_REQUIRED', 'Sparse checkpoints require explicit reasons on every step.');
    const final = parsedSteps.at(-1)!;
    if (final.review_checkpoint !== 'required' && !(final.checkpoint_boundary?.startsWith('final-exemption:') && final.checkpoint_boundary.slice('final-exemption:'.length).trim())) fail('REVIEW_CHECKPOINT_REQUIRED', 'A final waiver must explicitly cover cumulative changes with final-exemption: and a reason.');
    const earlier = new Set<string>();
    for (const step of parsedSteps) {
      const scope = (step.mutation_scope ?? '').split(',').map(p => p.trim().replace(/^`|`$/g, ''));
      if (step.review_checkpoint === 'required' && [...earlier].some(p => !scope.includes(p))) fail('REVIEW_REPAIR_SCOPE_REQUIRED', 'Required checkpoints must reserve exact earlier paths for repair.');
      scope.forEach(p => earlier.add(p));
    }
  }
  const strategy = readTestStrategyDefinition(definition);
  if (['test-first', 'implementation-first'].includes(strategy.mode) && !records.some(record => record.slots.some(slot => slot.applicability === 'before-step'))) fail('TEST_STRATEGY_PREREQUISITE_UNSUPPORTED', 'explicit ordering requires an approved before-step check.');
  assertPersistentTestAdmission(definition, records);
  return evidencePlanRevision(definition, records);
}

function assertPersistentTestAdmission(definition: DraftTaskDefinition, records: readonly ClaimEvidenceRecord[]): void {
  const content = testStrategySection(definition.regression_checks, ['Persistent Tests', '持久测试'], 'persistent_tests');
  const fields = ['owner', 'owner_source', 'source_ref', 'basis', 'existing_evidence_insufficiency', 'assertion_boundary', 'failure_disposition'];
  for (const testPath of readPersistentTestPaths(definition)) {
    const block = content.split(/(?=^-\s+`)/m).find(item => item.startsWith(`- \`${testPath}\``)) ?? '';
    const values = new Map([...block.matchAll(/^\s+- ([a-z_]+): (.+)$/gm)].map(match => [match[1], match[2].trim()]));
    if (fields.some(field => !values.get(field)) || !['acceptance', 'regression', 'critical-invariant', 'critical-risk'].includes(values.get('basis')!)) fail('PERSISTENT_TEST_ADMISSION_INVALID', `${testPath} requires P-12 source, necessity and assertion boundaries.`);
    const proves = [...block.matchAll(/^\s+- proves: (.+)$/gm)].map(match => match[1].trim());
    if (!proves.length || proves.some(id => !records.some(record => record.claim_id === id))) fail('PERSISTENT_TEST_ADMISSION_INVALID', `${testPath}.proves must bind stable claim IDs.`);
  }
}

function recoveryEvidenceContextRevision(root: string): string {
  return digest(['.workflow-system/PROJECT_PROFILE.yaml', '.workflow-system/vnext/RUNTIME_CONTRACT.yaml', '.workflow-system/runtime/package.json'].map(relative => {
    const file = path.resolve(root, relative);
    return { path: relative, sha256: fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null };
  }));
}

function assertEvidenceReportApplicable(root: string, current: CanonicalCurrentTask, slot: ClaimEvidenceSlot): void {
  const report = slot.report;
  if (!report || !slot.check || report.actual_method !== slot.check.method) fail('CLAIM_EVIDENCE_INCOMPLETE', 'report must bind its frozen check and method.');
  if ((current.runtimeState.evidence_challenges ?? []).some(item => item.result_id === report.result_id && item.status !== 'resolved')) {
    fail('CLAIM_EVIDENCE_INCOMPLETE', 'An unresolved counterexample blocks this report even when its subject hash is unchanged.');
  }
  if (report.evidence_plan_revision !== current.runtimeState.evidence_plan_revision) {
    const owner = (current.runtimeState.claim_evidence ?? []).find(record => record.slots.some(item => item.slot_id === slot.slot_id && item.report?.result_id === report.result_id));
    const proof = (current.runtimeState.evidence_carry_forward ?? []).find(item =>
      item.claim_id === owner?.claim_id && item.slot_id === slot.slot_id && item.check_id === slot.check!.check_id
      && item.result_id === report.result_id && item.old_plan_revision === report.evidence_plan_revision
      && item.new_plan_revision === current.runtimeState.evidence_plan_revision
      && item.report_sha256 === digest(report) && item.subject_revision === report.subject_revision);
    if (!proof || (current.runtimeState.evidence_challenges ?? []).some(item => item.claim_id === proof.claim_id && item.slot_id === proof.slot_id && item.status !== 'resolved')) {
      fail('CLAIM_EVIDENCE_INCOMPLETE', 'old-plan report has no applicable unchallenged Runtime carry-forward proof.');
    }
    assertTaskHistoryForRevision(current.filePath, current.sourceTuple.document_id, current.runtimeState.task_id, proof.old_source_revision, 'confirm-replan');
    const historyFile = path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id, `${proof.old_source_revision}.json`);
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8')) as { current_task_base64: string };
    const previous = parseCanonicalCurrentTaskContent(Buffer.from(history.current_task_base64, 'base64').toString('utf8'), current.filePath, current.relativePath);
    const oldSlot = previous.runtimeState.claim_evidence?.find(record => record.claim_id === proof.claim_id)?.slots.find(item => item.slot_id === proof.slot_id);
    if (previous.runtimeState.evidence_plan_revision !== proof.old_plan_revision || digest(oldSlot?.report) !== proof.report_sha256 || digest(oldSlot?.check) !== digest(slot.check)) {
      fail('EVIDENCE_CARRY_FORWARD_STALE', 'immutable source does not contain the exact unchanged report and check.');
    }
    if (proof.kind === 'evidence-carry-forward/v2') {
      if (proof.context_revision !== recoveryEvidenceContextRevision(root)) fail('EVIDENCE_CARRY_FORWARD_STALE', 'Project configuration or installed Runtime context changed; reassess affected evidence.');
      if (digest(describeEvidenceObjects(root, slot.evidence_refs)) !== digest(proof.evidence_objects)) fail('EVIDENCE_CARRY_FORWARD_STALE', 'Evidence body changed; affected evidence needs reassessment.');
      for (const object of proof.evidence_objects!) verifyEvidenceObject(root, current.filePath, object);
    }
  }
  if (report.actual_method === 'human') fail('EVIDENCE_AUTHORITY_UNSUPPORTED', 'No authenticated human acceptance channel is bound; caller-reported human approval is insufficient.');
  if (!slot.evidence_refs.length || slot.evidence_refs.some(ref => {
    try { const p = normalizeRepoPath(ref.split('#')[0], 'evidence_ref'); return !fs.statSync(path.resolve(root, p)).isFile(); } catch { return true; }
  })) fail('EVIDENCE_ARTIFACT_UNAVAILABLE', 'Each report needs retained repository-relative artifact files.');
  const snapshot = slot.prerequisite_receipt?.subject_snapshot ?? captureReviewTarget(root, slot.check.subject_paths);
  if (snapshot.revision !== report.subject_revision || digest(snapshot.entries.map(entry => entry.path).sort()) !== digest([...slot.check.subject_paths].sort())) fail('CLAIM_EVIDENCE_STALE', 'evidence subject changed or does not match the frozen object set.');
  if (slot.prerequisite_receipt && (slot.prerequisite_receipt.result_id !== report.result_id || slot.prerequisite_receipt.step_id !== slot.before_step_id)) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'prerequisite receipt does not bind its original report.');
}

function assertEvidenceSlotSatisfied(root: string, current: CanonicalCurrentTask, record: ClaimEvidenceRecord, slot: ClaimEvidenceSlot, closing: boolean): void {
  assertEvidenceReportApplicable(root, current, slot);
  if (!isClaimEvidenceSlotComplete(slot) || slot.report!.status !== slot.check!.expected_result) fail('CLAIM_EVIDENCE_INCOMPLETE', `unsatisfied slot ${record.claim_id}/${slot.slot_id}`);
  if (closing && slot.applicability === 'before-step' && !slot.prerequisite_receipt) fail('PREREQUISITE_REQUIRED', 'prerequisite has not been consumed before execution.');
}

/**
 * Read-only per-slot evaluation for the bounded context projector.
 *
 * The projector must not grow a second evidence-admission implementation:
 * this adapter deliberately calls the same applicability, carry-forward,
 * subject, challenge and completion checks used by execution and close-task.
 */
export function evaluateEvidenceSlotForContext(
  root: string,
  current: CanonicalCurrentTask,
  claim: ClaimEvidenceRecord,
  slot: ClaimEvidenceSlot,
): { satisfied: boolean; reason: string | null } {
  try {
    assertEvidenceSlotSatisfied(root, current, claim, slot, false);
    return { satisfied: true, reason: null };
  } catch (error) {
    return { satisfied: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function validateClaimEvidence(value: unknown, location: string): ClaimEvidenceRecord[] {
  if (!Array.isArray(value) || value.length > MAX_CLAIM_EVIDENCE_RECORDS) {
    fail('CLAIM_EVIDENCE_INVALID', `${location} must be a bounded array of claim evidence records.`);
  }
  const records = value.map((raw, index) => {
    const record = expectRecord(raw, `${location}[${index}]`);
    expectExactKeys(record, ['claim_id', 'claim_kind', 'slots', ...['requirement', 'source_ref'].filter(key => key in record)], `${location}[${index}]`);
    const claimId = expectString(record.claim_id, `${location}[${index}].claim_id`, CLAIM_ID_PATTERN);
    const claimKind = expectEnum(record.claim_kind, CLAIM_KINDS, `${location}[${index}].claim_kind`);
    if (!Array.isArray(record.slots) || record.slots.length === 0 || record.slots.length > MAX_CLAIM_EVIDENCE_SLOTS) {
      fail('CLAIM_EVIDENCE_INVALID', `${location}[${index}].slots must be a non-empty bounded array.`);
    }
    const slots = record.slots.map((rawSlot, slotIndex) => {
      const slot = expectRecord(rawSlot, `${location}[${index}].slots[${slotIndex}]`);
      expectExactKeys(slot, ['slot_id', 'minimum_type', 'disposition', 'evidence_refs', ...['due_step_id', 'applicability', 'before_step_id', 'check', 'report', 'prerequisite_receipt'].filter(key => key in slot)], `${location}[${index}].slots[${slotIndex}]`);
      const slotId = expectString(slot.slot_id, `${location}[${index}].slots[${slotIndex}].slot_id`, CLAIM_EVIDENCE_SLOT_ID_PATTERN);
      const minimumType = expectString(slot.minimum_type, `${location}[${index}].slots[${slotIndex}].minimum_type`, CLAIM_EVIDENCE_TYPE_PATTERN);
      const disposition = expectEnum(slot.disposition, CLAIM_EVIDENCE_DISPOSITIONS, `${location}[${index}].slots[${slotIndex}].disposition`);
      const evidenceRefs = expectStringArray(slot.evidence_refs, `${location}[${index}].slots[${slotIndex}].evidence_refs`, true, MAX_EVIDENCE_REFS);
      if (COMPLETE_CLAIM_EVIDENCE_DISPOSITIONS.includes(disposition) && evidenceRefs.length === 0) {
        fail('CLAIM_EVIDENCE_INVALID', `${location}[${index}].slots[${slotIndex}] requires evidence_refs for disposition=${disposition}.`);
      }
      const result: ClaimEvidenceSlot = { slot_id: slotId, minimum_type: minimumType, disposition, evidence_refs: evidenceRefs };
      if (slot.check !== undefined) {
        const check = expectRecord(slot.check, 'slot.check');
        expectExactKeys(check, ['check_id', 'method', 'entry', 'expected_observation', 'required_boundaries', 'allowed_substitutes', 'subject_paths', 'expected_result'], 'slot.check');
        result.check = {
          check_id: expectString(check.check_id, 'check.check_id', CLAIM_ID_PATTERN),
          method: expectEnum(check.method, ['execution', 'static', 'human'], 'check.method'),
          entry: expectText(check.entry, 'check.entry'),
          expected_observation: expectText(check.expected_observation, 'check.expected_observation'),
          required_boundaries: expectStringArray(check.required_boundaries, 'check.required_boundaries', false, 256),
          allowed_substitutes: expectStringArray(check.allowed_substitutes, 'check.allowed_substitutes', true, 256),
          subject_paths: expectStringArray(check.subject_paths, 'check.subject_paths', false, 256).map(p => normalizeRepoPath(p, 'check.subject_paths')),
          expected_result: expectEnum(check.expected_result, ['passed', 'accepted', 'expected-failure'], 'check.expected_result'),
        };
      }
      if (slot.due_step_id !== undefined) result.due_step_id = expectString(slot.due_step_id, 'slot.due_step_id', STEP_ID_PATTERN);
      if (slot.applicability !== undefined) result.applicability = expectEnum(slot.applicability, ['current', 'before-step'], 'slot.applicability');
      if (slot.before_step_id !== undefined) result.before_step_id = expectString(slot.before_step_id, 'slot.before_step_id', STEP_ID_PATTERN);
      if (slot.report !== undefined) result.report = slot.report === null ? null : validateEvidenceReport(slot.report);
      if (slot.prerequisite_receipt !== undefined) {
        if (slot.prerequisite_receipt === null) result.prerequisite_receipt = null;
        else {
          const receipt = expectRecord(slot.prerequisite_receipt, 'prerequisite_receipt');
          expectExactKeys(receipt, ['step_id', 'preflight_id', 'result_id', 'subject_snapshot'], 'prerequisite_receipt');
          result.prerequisite_receipt = {
            step_id: expectString(receipt.step_id, 'receipt.step_id', STEP_ID_PATTERN),
            preflight_id: expectText(receipt.preflight_id, 'receipt.preflight_id'),
            result_id: expectText(receipt.result_id, 'receipt.result_id'),
            subject_snapshot: validateReviewTarget(receipt.subject_snapshot, 'receipt.subject_snapshot'),
          };
        }
      }
      return result;
    });
    if (new Set(slots.map(slot => slot.slot_id)).size !== slots.length) {
      fail('CLAIM_EVIDENCE_INVALID', `${location}[${index}].slots must have unique slot_id values.`);
    }
    return { claim_id: claimId, claim_kind: claimKind, slots,
      ...(record.requirement === undefined ? {} : { requirement: expectText(record.requirement, 'claim.requirement') }),
      ...(record.source_ref === undefined ? {} : { source_ref: expectText(record.source_ref, 'claim.source_ref') }),
    };
  });
  if (new Set(records.map(record => record.claim_id)).size !== records.length) {
    fail('CLAIM_EVIDENCE_INVALID', `${location} must have unique claim_id values.`);
  }
  return records;
}

function claimEvidenceRefs(records: readonly ClaimEvidenceRecord[]): string[] {
  return [...new Set(records.flatMap(record => record.slots.flatMap(slot => slot.evidence_refs)))];
}

function isClaimEvidenceSlotComplete(slot: ClaimEvidenceSlot): boolean {
  return COMPLETE_CLAIM_EVIDENCE_DISPOSITIONS.includes(slot.disposition) && slot.evidence_refs.length > 0;
}

type ClaimEvidenceCompletion = {
  acceptance_satisfied: boolean;
  validation_complete: boolean;
};

export function hasRemainingCorrectionTargets(current: CanonicalCurrentTask, stepId: string): boolean {
  const challenges = current.runtimeState.evidence_challenges ?? [];
  return challenges.some(item => item.status === 'invalidated' && item.correction_step_id === stepId)
    && challenges.some(item => item.status === 'contested' && item.correction_step_id === null);
}

export function evaluateClaimEvidence(records: readonly ClaimEvidenceRecord[], context: { root: string; current: CanonicalCurrentTask; due_step_id?: string }): ClaimEvidenceCompletion {
  const { root, current, due_step_id } = context;
  const incomplete = { validation_complete: false, acceptance_satisfied: false };
  try {
    assertBusinessEvidenceVersion(current);
    const revision = assertEvidencePlan(readDraftDefinitionFromBody(current.body), records);
    if (revision !== current.runtimeState.evidence_plan_revision) return incomplete;
  } catch {
    return incomplete;
  }
  const steps = resolveCanonicalTaskStep(current).steps.map(step => step.id);
  const dueIndex = due_step_id === undefined ? steps.length : steps.indexOf(due_step_id);
  if (dueIndex < 0) return incomplete;
  const completion = { validation_complete: true, acceptance_satisfied: true };
  const completingCorrection = due_step_id === current.runtimeState.active_step_id
    && current.runtimeState.evidence_challenges?.some(challenge => challenge.status === 'invalidated' && challenge.correction_step_id === due_step_id);
  for (const record of records) {
    const dueSlots = record.slots.filter(slot => steps.indexOf(slot.due_step_id!) <= dueIndex);
    for (const slot of dueSlots) {
      // A reviewed partial batch may complete its own work while the other
      // contested obligations still block ordinary execution and final closure.
      if (completingCorrection && slot.due_step_id !== due_step_id && slot.before_step_id !== due_step_id
        && current.runtimeState.evidence_challenges?.some(challenge => challenge.status === 'contested'
          && challenge.correction_step_id === null && challenge.claim_id === record.claim_id && challenge.slot_id === slot.slot_id)) continue;
      try {
        assertEvidenceSlotSatisfied(root, current, record, slot, due_step_id === undefined);
      } catch {
        completion.validation_complete = false;
        if (record.claim_kind === 'acceptance') completion.acceptance_satisfied = false;
      }
    }
  }
  return completion;
}

function copyClaimEvidence(records: readonly ClaimEvidenceRecord[]): ClaimEvidenceRecord[] {
  return structuredClone([...records]);
}

function claimEvidenceStateEnabled(runtimeState: Pick<RuntimeState, 'claim_evidence_required' | 'claim_evidence'>): boolean {
  return runtimeState.claim_evidence_required === true || (runtimeState.claim_evidence?.length ?? 0) > 0;
}

function requireClaimEvidencePlan(
  records: readonly ClaimEvidenceRecord[] | undefined,
  location: string,
  missingCode = 'CLAIM_EVIDENCE_REQUIRED',
): ClaimEvidenceRecord[] {
  if (records === undefined || records.length === 0) {
    fail(missingCode, `${location} must persist a non-empty claim_evidence plan before the task can proceed.`);
  }
  return [...records];
}

function requireAcceptanceClaim(records: readonly ClaimEvidenceRecord[], location: string): void {
  if (!records.some(record => record.claim_kind === 'acceptance')) {
    fail('CLAIM_EVIDENCE_ACCEPTANCE_REQUIRED', `${location} must include at least one acceptance claim; invariant evidence cannot substitute for acceptance evidence.`);
  }
}

function assertClaimEvidencePlanPreserved(
  planned: readonly ClaimEvidenceRecord[],
  proposed: readonly ClaimEvidenceRecord[],
  location: string,
): void {
  if (planned.length === 0) {
    fail('CLAIM_EVIDENCE_REQUIRED', `${location} cannot initialize a claim_evidence plan during execution; prepare-task must persist it first.`);
  }
  if (planned.length !== proposed.length) {
    fail('CLAIM_EVIDENCE_PLAN_CONFLICT', `${location} cannot add or remove planned claims during step progress.`);
  }
  const proposedByClaim = new Map(proposed.map(record => [record.claim_id, record]));
  for (const plannedRecord of planned) {
    const proposedRecord = proposedByClaim.get(plannedRecord.claim_id);
    if (!proposedRecord || proposedRecord.claim_kind !== plannedRecord.claim_kind || proposedRecord.requirement !== plannedRecord.requirement || proposedRecord.source_ref !== plannedRecord.source_ref) {
      fail('CLAIM_EVIDENCE_PLAN_CONFLICT', `${location} must preserve every planned claim identity and kind.`);
    }
    if (proposedRecord.slots.length !== plannedRecord.slots.length) {
      fail('CLAIM_EVIDENCE_PLAN_CONFLICT', `${location} cannot add or remove evidence slots for claim ${plannedRecord.claim_id}.`);
    }
    const proposedBySlot = new Map(proposedRecord.slots.map(slot => [slot.slot_id, slot]));
    for (const plannedSlot of plannedRecord.slots) {
      const proposedSlot = proposedBySlot.get(plannedSlot.slot_id);
      if (!proposedSlot || digest(evidenceSlotDefinition(proposedSlot)) !== digest(evidenceSlotDefinition(plannedSlot))) {
        fail('CLAIM_EVIDENCE_PLAN_CONFLICT', `${location} must preserve evidence slot ${plannedRecord.claim_id}/${plannedSlot.slot_id} and its minimum type.`);
      }
      if (digest(proposedSlot.prerequisite_receipt ?? null) !== digest(plannedSlot.prerequisite_receipt ?? null)
        || ('prerequisite_receipt' in proposedSlot) !== ('prerequisite_receipt' in plannedSlot)
        || (plannedSlot.prerequisite_receipt && digest(proposedSlot) !== digest(plannedSlot))) {
        fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'Runtime prerequisite receipts and consumed evidence are immutable.');
      }
    }
  }
}

function validateStepReviewReceipt(value: unknown, location: string): StepReviewReceipt {
  const record = expectRecord(value, location);
  expectExactKeys(record, [
    'cycle_id',
    'cycle_phase',
    'change_set_id',
    'review_target_revision',
    'verdict',
    'admitted_fingerprints',
    'evidence_refs',
  ], location);
  const cyclePhase = expectEnum(record.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`);
  const admittedFingerprints = expectStringArray(record.admitted_fingerprints, `${location}.admitted_fingerprints`, true, MAX_FINDINGS)
    .map((fingerprint, index) => {
      if (!FINGERPRINT_PATTERN.test(fingerprint)) fail('RUNTIME_SCHEMA_INVALID', `${location}.admitted_fingerprints[${index}] has an invalid fingerprint.`);
      return fingerprint;
    });
  if (cyclePhase === 'discovery' && admittedFingerprints.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.discovery receipts must not carry admitted fingerprints.`);
  }
  return {
    cycle_id: expectString(record.cycle_id, `${location}.cycle_id`, SAFE_KEY_PATTERN),
    cycle_phase: cyclePhase,
    change_set_id: expectString(record.change_set_id, `${location}.change_set_id`, SAFE_KEY_PATTERN),
    review_target_revision: expectString(record.review_target_revision, `${location}.review_target_revision`, /^[a-f0-9]{64}$/u),
    verdict: expectEnum(record.verdict, ['clean'], `${location}.verdict`),
    admitted_fingerprints: admittedFingerprints,
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
  };
}

function validateReviewFindingCandidate(value: unknown, location: string): ReviewFindingCandidate {
  const record = expectRecord(value, location);
  expectExactKeys(
    record,
    ['fingerprint', 'category', 'file', 'failure_condition', 'required_behavior', 'root_cause_status', 'evidence_refs'],
    location,
  );
  return {
    fingerprint: expectString(record.fingerprint, `${location}.fingerprint`, FINGERPRINT_PATTERN),
    category: expectText(record.category, `${location}.category`, 256),
    file: normalizeRepoPath(expectString(record.file, `${location}.file`), `${location}.file`),
    failure_condition: expectText(record.failure_condition, `${location}.failure_condition`),
    required_behavior: expectText(record.required_behavior, `${location}.required_behavior`, 512),
    root_cause_status: expectEnum(record.root_cause_status, ['confirmed', 'bounded'], `${location}.root_cause_status`),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
  };
}

function validateReviewBlocker(value: unknown, location: string): ReviewBlocker {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['code', 'summary', 'next_route'], location);
  return {
    code: expectString(record.code, `${location}.code`, SAFE_KEY_PATTERN),
    summary: expectText(record.summary, `${location}.summary`),
    next_route: expectEnum(record.next_route, REVIEW_BLOCKER_ROUTES, `${location}.next_route`),
  };
}

function validatePendingReviewResult(
  value: unknown,
  location: string,
  includeRecordedAt: boolean,
): PendingReviewResult | Omit<PendingReviewResult, 'recorded_at'> {
  const record = expectRecord(value, location);
  const keys = [
    'kind',
    'review_id',
    'execution_id',
    'step_id',
    'cycle_id',
    'cycle_phase',
    'change_set_id',
    'review_target_revision',
    'verdict',
    'findings',
    'unresolved_fingerprints',
    'evidence_refs',
    'blocker',
    ...(record.test_assessment === undefined ? [] : ['test_assessment']),
    ...(includeRecordedAt ? ['recorded_at'] : []),
  ];
  expectExactKeys(record, keys, location);
  if (record.kind !== 'review-result/v1') fail('RUNTIME_SCHEMA_INVALID', `${location}.kind must be review-result/v1.`);
  if (!Array.isArray(record.findings) || record.findings.length > MAX_FINDINGS) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.findings must be a bounded array.`);
  }
  const findings = record.findings.map((item, index) => validateReviewFindingCandidate(item, `${location}.findings[${index}]`));
  if (new Set(findings.map(item => item.fingerprint)).size !== findings.length) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.findings fingerprints must be unique.`);
  }
  const unresolvedFingerprints = expectStringArray(record.unresolved_fingerprints, `${location}.unresolved_fingerprints`, true, MAX_FINDINGS)
    .map((fingerprint, index) => expectString(fingerprint, `${location}.unresolved_fingerprints[${index}]`, FINGERPRINT_PATTERN));
  if (new Set(unresolvedFingerprints).size !== unresolvedFingerprints.length) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.unresolved_fingerprints must be unique.`);
  }
  const verdict = expectEnum(record.verdict, REVIEW_RESULT_VERDICTS, `${location}.verdict`);
  const blocker = record.blocker === null ? null : validateReviewBlocker(record.blocker, `${location}.blocker`);
  if (verdict === 'clean' && (findings.length > 0 || unresolvedFingerprints.length > 0 || blocker !== null)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} clean result must not contain findings or a blocker.`);
  }
  if (verdict === 'findings' && (findings.length === 0 && unresolvedFingerprints.length === 0 || blocker !== null)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} findings result requires a finding and must not contain a blocker.`);
  }
  if (verdict === 'blocked' && (findings.length > 0 || unresolvedFingerprints.length > 0 || blocker === null)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} blocked result requires only a blocker.`);
  }
  const result = {
    ...(record.test_assessment === undefined ? {} : {test_assessment:validateTestAssessment(record.test_assessment)}),
    kind: 'review-result/v1' as const,
    review_id: expectString(record.review_id, `${location}.review_id`, SAFE_KEY_PATTERN),
    execution_id: expectString(record.execution_id, `${location}.execution_id`, SAFE_KEY_PATTERN),
    step_id: expectString(record.step_id, `${location}.step_id`, STEP_ID_PATTERN),
    cycle_id: expectString(record.cycle_id, `${location}.cycle_id`, SAFE_KEY_PATTERN),
    cycle_phase: expectEnum(record.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`),
    change_set_id: expectString(record.change_set_id, `${location}.change_set_id`, SAFE_KEY_PATTERN),
    review_target_revision: expectString(record.review_target_revision, `${location}.review_target_revision`, /^[a-f0-9]{64}$/u),
    verdict,
    findings,
    unresolved_fingerprints: unresolvedFingerprints,
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
    blocker,
  };
  return includeRecordedAt
    ? { ...result, recorded_at: expectString(record.recorded_at, `${location}.recorded_at`) }
    : result;
}

const REPLAN_REPLACEMENT_FIELDS = [
  'background_context',
  'acceptance',
  'allowed_scope',
  'conditional_scope',
  'forbidden_scope',
  'affected_contracts',
  'confirmed_decisions',
  'open_questions',
  'implementation_plan',
  'implementation_steps',
  'regression_checks',
  'rollback_points',
  'design_constraints',
  'post_release_validation',
  'propagation_governance',
] as const;

function expectVerbatim(value: unknown, location: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must be a non-empty string.`);
  }
  if (value.length > maxLength || /\0/u.test(value)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must be at most ${maxLength} characters and contain no NUL byte.`);
  }
  return value;
}

function validateTaskBasisSource(value: unknown, location: string): TaskBasisSource {
  const source = expectRecord(value, location);
  expectExactKeys(source, ['source', 'verbatim'], location);
  const locator = expectText(source.source, `${location}.source`, 1024);
  if (/[\r\n]/u.test(locator)) fail('RUNTIME_SCHEMA_INVALID', `${location}.source must be one line.`);
  return {
    source: locator,
    verbatim: expectVerbatim(source.verbatim, `${location}.verbatim`, MAX_REPLAN_SECTION_CONTENT_LENGTH),
  };
}

function validateTaskBasis(value: unknown, location: string): TaskBasis {
  const basis = expectRecord(value, location);
  expectExactKeys(basis, ['original_request', 'user_decisions'], location);
  if (!Array.isArray(basis.user_decisions) || basis.user_decisions.length > 64) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.user_decisions must be a bounded array.`);
  }
  const userDecisions = basis.user_decisions.map((item, index) =>
    validateTaskBasisSource(item, `${location}.user_decisions[${index}]`));
  const decisionKeys = userDecisions.map(item => `${item.source}\0${item.verbatim}`);
  if (new Set(decisionKeys).size !== decisionKeys.length) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.user_decisions must not contain duplicate source excerpts.`);
  }
  return {
    original_request: validateTaskBasisSource(basis.original_request, `${location}.original_request`),
    user_decisions: userDecisions,
  };
}

function normalizeReplacementSectionContent(value: string, location: string): string {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (/^#{1,2}\s+\S/m.test(normalized)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must contain section content, not an arbitrary top-level Markdown heading.`);
  }
  return normalized;
}

function validatePartialDiffDisposition(value: unknown, location: string): PartialDiffDisposition {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['reusable', 'rollback_required', 'stop_propagation'], location);
  return {
    reusable: expectStringArray(record.reusable, `${location}.reusable`, true, MAX_EVIDENCE_REFS),
    rollback_required: expectStringArray(record.rollback_required, `${location}.rollback_required`, true, MAX_EVIDENCE_REFS),
    stop_propagation: expectStringArray(record.stop_propagation, `${location}.stop_propagation`, true, MAX_EVIDENCE_REFS),
  };
}

function validateReplanReplacementDefinition(value: unknown, location: string): ReplanReplacementDefinition {
  const record = expectRecord(value, location);
  expectExactKeys(record, REPLAN_REPLACEMENT_FIELDS, location);
  const result = {} as ReplanReplacementDefinition;
  for (const field of REPLAN_REPLACEMENT_FIELDS) {
    const raw = record[field];
    if (raw === null && ['design_constraints', 'post_release_validation', 'propagation_governance'].includes(field)) {
      result[field] = null;
      continue;
    }
    if (raw === null) fail('RUNTIME_SCHEMA_INVALID', `${location}.${field} may be null only for optional sections.`);
    result[field] = normalizeReplacementSectionContent(
      expectText(raw, `${location}.${field}`, MAX_REPLAN_SECTION_CONTENT_LENGTH),
      `${location}.${field}`,
    );
  }
  readProjectDocuments(result.background_context);
  return result;
}

function testStrategySection(markdown: string, aliases: readonly string[], location: string): string {
  const section = findUniqueMarkdownSection(scanMarkdownSections(markdown), aliases, 3);
  if (!section) fail('TEST_STRATEGY_INVALID', `${location} is missing the required ### ${aliases[0]} section.`);
  return markdown.slice(section.contentStart, section.contentEnd).replace(/\r\n?/gu, '\n').trim();
}

export function readTestStrategyDefinition(definition: Pick<DraftTaskDefinition, 'regression_checks'>): TestStrategyDefinition {
  const location = 'draft_definition.regression_checks.Test Strategy';
  const content = testStrategySection(definition.regression_checks, ['Test Strategy', '测试策略'], 'draft_definition.regression_checks');
  const fields = new Map<string, string>();
  for (const [index, rawLine] of content.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^-\s+(mode|source|source_ref|task_classification|rationale):\s+(.+)$/u.exec(line);
    if (!match) fail('TEST_STRATEGY_INVALID', `${location}:${index + 1} is not a canonical test-strategy field.`);
    if (fields.has(match[1]!)) fail('TEST_STRATEGY_INVALID', `${location} contains duplicate field ${match[1]}.`);
    fields.set(match[1]!, match[2]!.trim());
  }
  const expected = ['mode', 'source', 'source_ref', 'task_classification', 'rationale'] as const;
  const missing = expected.filter(field => !fields.has(field));
  const extra = [...fields.keys()].filter(field => !(expected as readonly string[]).includes(field));
  if (missing.length > 0 || extra.length > 0 || fields.size !== expected.length) {
    fail('TEST_STRATEGY_INVALID', `${location} fields mismatch; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}].`);
  }
  const mode = fields.get('mode')!;
  const source = fields.get('source')!;
  const taskClassification = fields.get('task_classification')!;
  if (!(TEST_STRATEGY_MODES as readonly string[]).includes(mode)) {
    fail('TEST_STRATEGY_INVALID', `${location}.mode must be one of ${TEST_STRATEGY_MODES.join(', ')}.`);
  }
  if (!(TEST_STRATEGY_SOURCES as readonly string[]).includes(source)) {
    fail('TEST_STRATEGY_INVALID', `${location}.source must be one of ${TEST_STRATEGY_SOURCES.join(', ')}.`);
  }
  if (!(TEST_STRATEGY_CLASSIFICATIONS as readonly string[]).includes(taskClassification)) {
    fail('TEST_STRATEGY_INVALID', `${location}.task_classification must be one of ${TEST_STRATEGY_CLASSIFICATIONS.join(', ')}.`);
  }
  const strategy: TestStrategyDefinition = {
    mode: mode as TestStrategyMode,
    source: source as TestStrategySource,
    source_ref: expectText(fields.get('source_ref'), `${location}.source_ref`, 1024),
    task_classification: taskClassification as TestStrategyClassification,
    rationale: expectText(fields.get('rationale'), `${location}.rationale`, 4096),
  };
  const nonExecutable = strategy.task_classification === 'non-executable-change';
  if ((strategy.mode === 'not-applicable') !== nonExecutable) {
    fail('TEST_STRATEGY_INVALID', 'not-applicable is valid only for task_classification=non-executable-change, and that classification requires not-applicable.');
  }
  if (strategy.source === 'inferred-default') {
    const inferredMode: TestStrategyMode = nonExecutable ? 'not-applicable' : 'flexible';
    if (strategy.mode !== inferredMode) {
      fail('TEST_STRATEGY_INVALID', `inferred-default requires mode=${inferredMode} for task_classification=${strategy.task_classification}.`);
    }
  }
  return strategy;
}

export function readPersistentTestPaths(definition: Pick<DraftTaskDefinition, 'regression_checks'>): string[] {
  const location = 'draft_definition.regression_checks.Persistent Tests';
  const content = testStrategySection(definition.regression_checks, ['Persistent Tests', '持久测试'], 'draft_definition.regression_checks');
  const paths: string[] = [];
  let none = false;
  for (const [index, rawLine] of content.split('\n').entries()) {
    if (!rawLine.trim() || /^\s{2,}/u.test(rawLine)) continue;
    const line = rawLine.trim();
    if (line === '- none') {
      none = true;
      continue;
    }
    const match = /^-\s+`([^`]+)`$/u.exec(line);
    if (!match) fail('TEST_STRATEGY_INVALID', `${location}:${index + 1} is not an exact canonical persistent-test path.`);
    const normalized = normalizeRepoPath(match[1]!, `${location}:${index + 1}`);
    if (normalized !== match[1] || normalized.includes('*') || /^[A-Za-z]:[\\/]/u.test(normalized)) {
      fail('TEST_STRATEGY_INVALID', `${location}:${index + 1} must be one canonical repository-relative exact path.`);
    }
    paths.push(normalized);
  }
  if (none && paths.length > 0) fail('TEST_STRATEGY_INVALID', `${location} cannot combine none with exact paths.`);
  if (!none && paths.length === 0) fail('TEST_STRATEGY_INVALID', `${location} must contain none or at least one exact path.`);
  if (new Set(paths).size !== paths.length) fail('TEST_STRATEGY_INVALID', `${location} contains duplicate paths.`);
  return paths;
}

function strategyStepScopes(definition: DraftTaskDefinition): string[][] {
  let steps: TaskStepDefinition[];
  try {
    steps = parseImplementationSteps(definition.implementation_steps);
  } catch (error) {
    if (error instanceof TaskStepDefinitionError) fail(error.code, error.message);
    throw error;
  }
  return steps.map((step, index) => {
    if (!step.mutation_scope) fail('TEST_STRATEGY_INVALID', `implementation_steps[${index}] is missing mutation_scope.`);
    const values = step.mutation_scope.split(',').map(value => value.trim().replace(/^`|`$/gu, '')).filter(Boolean);
    if (values.length === 0 || new Set(values).size !== values.length) {
      fail('TEST_STRATEGY_INVALID', `implementation_steps[${index}].mutation_scope must contain unique paths.`);
    }
    return values;
  });
}

function definitionMutationScope(definition: DraftTaskDefinition): ReturnType<typeof parseMutationScope> {
  const body = [
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    definition.allowed_scope,
    '',
    '### Conditional Files',
    '',
    definition.conditional_scope,
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    definition.forbidden_scope,
    '',
    '## 回归检查项',
    '',
    definition.regression_checks,
    '',
  ].join('\n');
  try {
    return parseMutationScope(body);
  } catch (error) {
    if (error instanceof MutationScopeError) fail('TEST_STRATEGY_INVALID', error.message);
    throw error;
  }
}

function nonExecutableChangePatterns(root: string): string[] {
  let profile: ReturnType<typeof loadProfile>;
  try {
    profile = loadProfile(getWorkflowProfilePath(root));
  } catch (error) {
    fail(
      'TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN',
      `not-applicable requires a readable PROJECT_PROFILE.yaml non-executable boundary: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const boundaries = profile.boundaries;
  if (!isRecord(boundaries) || !Array.isArray(boundaries.non_executable_change_paths)) {
    fail(
      'TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN',
      'not-applicable requires PROJECT_PROFILE.yaml boundaries.non_executable_change_paths.',
    );
  }
  if (boundaries.non_executable_change_paths.length === 0) {
    fail(
      'TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN',
      'not-applicable requires at least one project-owned non-executable path classification.',
    );
  }
  const patterns = boundaries.non_executable_change_paths.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) {
      fail('TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN', `boundaries.non_executable_change_paths[${index}] must be a non-empty string.`);
    }
    const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
    let bounded: boolean;
    try {
      bounded = nonExecutableChangePatternIsBounded(normalized);
    } catch (error) {
      fail('TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN', `invalid non-executable path classification ${normalized}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!bounded) {
      fail(
        'TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN',
        `non-executable path classification must be an exact path or a literal directory prefix ending in /**: ${normalized}.`,
      );
    }
    return normalized;
  });
  if (new Set(patterns).size !== patterns.length) {
    fail('TEST_STRATEGY_NON_EXECUTABLE_UNPROVEN', 'boundaries.non_executable_change_paths contains duplicate patterns.');
  }
  return patterns;
}

function assertNonExecutableChangeScope(root: string, definition: DraftTaskDefinition, stepScopes: readonly string[][]): void {
  const policyPatterns = nonExecutableChangePatterns(root);
  const taskScope = definitionMutationScope(definition);
  const declaredTargets = [...new Set([
    ...taskScope.allowed.map(entry => entry.pattern),
    ...taskScope.conditional.map(entry => entry.pattern),
    ...stepScopes.flat(),
  ])];
  const uncovered = declaredTargets.filter(target =>
    !policyPatterns.some(boundary => {
      try {
        return mutationScopePatternIsSubset(target, boundary);
      } catch {
        return false;
      }
    }));
  if (uncovered.length > 0) {
    fail(
      'TEST_STRATEGY_NON_EXECUTABLE_SCOPE_VIOLATION',
      `not-applicable contains mutation targets outside PROJECT_PROFILE.yaml boundaries.non_executable_change_paths: ${uncovered.join(', ')}.`,
    );
  }
}

function assertTestStrategySource(root: string, strategy: TestStrategyDefinition, taskBasis: TaskBasis): void {
  if (strategy.source === 'inferred-default') {
    if (strategy.source_ref !== 'prepare-task-default') {
      fail('TEST_STRATEGY_INVALID', 'inferred-default requires source_ref=prepare-task-default.');
    }
    return;
  }
  if (strategy.source === 'explicit-user') {
    const userSources = new Set([
      taskBasis.original_request.source,
      ...taskBasis.user_decisions.map(item => item.source),
    ]);
    if (!userSources.has(strategy.source_ref)) {
      fail('TEST_STRATEGY_INVALID', 'explicit-user source_ref must equal an exact Task Basis source coordinate.');
    }
    return;
  }
  const normalized = normalizeRepoPath(strategy.source_ref, 'test_strategy.source_ref');
  if (normalized !== strategy.source_ref || normalized.includes('*') || /^[A-Za-z]:[\\/]/u.test(normalized)) {
    fail('TEST_STRATEGY_INVALID', 'project-policy source_ref must be one canonical repository-relative exact file path.');
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    fail('TEST_STRATEGY_INVALID', `project-policy source_ref does not identify an existing project file: ${strategy.source_ref}.`);
  }
}

export function assertPreparedTestStrategy(root: string, definition: DraftTaskDefinition, taskBasis: TaskBasis): TestStrategyDefinition {
  const strategy = readTestStrategyDefinition(definition);
  const persistentTests = readPersistentTestPaths(definition);
  const scopes = strategyStepScopes(definition);
  assertTestStrategySource(root, strategy, taskBasis);
  if (strategy.mode === 'not-applicable') {
    if (persistentTests.length > 0) fail('TEST_STRATEGY_INVALID', 'not-applicable requires Persistent Tests to be none.');
    assertNonExecutableChangeScope(root, definition, scopes);
  }

  return strategy;
}

export function assertBusinessEvidenceVersion(current: CanonicalCurrentTask): void {
  if (current.runtimeState.business_evidence_version !== 1) {
    fail('TASK_SEMANTICS_UPGRADE_REQUIRED', 'This task predates business_evidence_version=1; use its previous installation or an explicitly authorized replan.');
  }
}

function executionPhaseForStrategy(strategy: TestStrategyDefinition): TestStrategyExecutionPhase {
  return strategy.mode;
}

export function resolveTestStrategyExecutionContext(current: CanonicalCurrentTask): TestStrategyExecutionContext {
  assertBusinessEvidenceVersion(current);
  const resolution = resolveCanonicalTaskStep(current);
  const strategySection = findUniqueMarkdownSection(
    scanMarkdownSections(current.body),
    ['Test Strategy', '测试策略'],
    3,
  );
  if (!strategySection) fail('TEST_STRATEGY_INVALID', 'Version 1 tasks require a frozen Test Strategy.');

  const definition = { regression_checks: current.body };
  const strategy = readTestStrategyDefinition(definition);
  const phase = executionPhaseForStrategy(strategy);
  return {
    mode: strategy.mode,
    phase,
    required_outcome: phase === 'red' ? 'test-red' : 'implemented',
    persistent_tests: readPersistentTestPaths(definition),
    step_index: resolution.index,
    first_step_id: resolution.steps[0]!.id,
  };
}

export function assertTestStrategySequenceReady(
  current: CanonicalCurrentTask,
  context = resolveTestStrategyExecutionContext(current),
): void {
  assertBusinessEvidenceVersion(current);
  assertEvidencePlan(readDraftDefinitionFromBody(current.body), current.runtimeState.claim_evidence ?? []);
  if (current.runtimeState.evidence_plan_revision !== evidencePlanRevision(readDraftDefinitionFromBody(current.body), current.runtimeState.claim_evidence ?? [])) fail('CLAIM_EVIDENCE_STALE', 'canonical evidence plan revision does not match its definitions.');
}

function assertTestStrategyExecutionTransition(
  current: CanonicalCurrentTask,
  delta: TaskStepProgressDelta,
): void {
  assertTestStrategySequenceReady(current);
  if (delta.execution_result?.outcome === 'test-red') {
    fail('TEST_STRATEGY_SEQUENCE_INVALID', 'test-red requires admitted reproduction evidence (S2) and cannot complete positive acceptance.');
  }
}

function validateDraftTaskIdentityFields(record: AnyRecord, location: string, requireTitle: true): DraftTaskIdentity;
function validateDraftTaskIdentityFields(record: AnyRecord, location: string, requireTitle: false): Omit<DraftTaskIdentity, 'task_title'>;
function validateDraftTaskIdentityFields(record: AnyRecord, location: string, requireTitle = true): DraftTaskIdentity | Omit<DraftTaskIdentity, 'task_title'> {
  const taskId = expectString(record.task_id, `${location}.task_id`);
  const taskSlug = expectString(record.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
  }
  const documentId = expectString(record.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', `${location}.document_id is invalid.`);
  if (!requireTitle) return { task_id: taskId, task_slug: taskSlug, document_id: documentId };
  const taskTitle = expectText(record.task_title, `${location}.task_title`, 512);
  if (/[\r\n]/u.test(taskTitle)) fail('RUNTIME_IDENTITY_INVALID', `${location}.task_title must be a single line.`);
  if (/^\{\{[^{}]+\}\}$/.test(taskTitle)) fail('RUNTIME_IDENTITY_INVALID', `${location}.task_title must be concrete, not a placeholder.`);
  return { task_id: taskId, task_slug: taskSlug, document_id: documentId, task_title: taskTitle };
}

function replacementStepIds(implementationSteps: string): string[] {
  try {
    return parseImplementationSteps(implementationSteps).map(step => step.id);
  } catch (error) {
    if (error instanceof TaskStepDefinitionError) fail('RUNTIME_SECTION_INVALID', error.message);
    throw error;
  }
}

function assertReplacementActiveStep(activeStepId: string, implementationSteps: string): void {
  const stepIds = replacementStepIds(implementationSteps);
  if (stepIds.length === 0) {
    fail('RUNTIME_SECTION_INVALID', 'replacement implementation_steps must contain at least one labelled step ID.');
  }
  if (new Set(stepIds).size !== stepIds.length) {
    fail('RUNTIME_SECTION_INVALID', 'replacement implementation_steps contains duplicate step IDs.');
  }
  if (!stepIds.includes(activeStepId)) {
    fail('RUNTIME_SECTION_INVALID', `active_step_id ${activeStepId} does not identify a step in replacement implementation_steps.`);
  }
}

function assertStrictDraftImplementationSteps(activeStepId: string, implementationSteps: string): TaskStepDefinition[] {
  let steps: TaskStepDefinition[];
  try {
    steps = parseImplementationSteps(implementationSteps);
  } catch (error) {
    if (error instanceof TaskStepDefinitionError) fail(error.code, error.message);
    throw error;
  }
  if (steps.length === 0) {
    fail('TASK_STEPS_INVALID', 'draft implementation_steps must contain at least one step.');
  }
  for (const step of steps) {
    if (!step.metadata_complete) {
      fail(
        'TASK_STEPS_INVALID',
        `step ${step.id} has incomplete step metadata; every step in a draft must declare purpose, mutation scope, required evidence, and review checkpoint (with boundary when required).`,
      );
    }
  }
  const firstStep = steps[0]!;
  if (activeStepId !== firstStep.id) {
    fail(
      'TASK_STEPS_INVALID',
      `draft active_step_id must be the first admitted implementation step ${firstStep.id}, got ${activeStepId}.`,
    );
  }
  return steps;
}

function resolveTaskStepForState(body: string, activeStepId: string): TaskStepResolution {
  try {
    const resolution = resolveTaskStep(body, activeStepId);
    if (resolution.steps.length > 1 && resolution.steps.some(step => !step.metadata_complete)) {
      fail('TASK_STEPS_INVALID', 'every multi-step task step must declare purpose, mutation scope, required evidence, and review checkpoint metadata.');
    }
    return resolution;
  } catch (error) {
    if (error instanceof TaskStepDefinitionError) fail(error.code, error.message);
    throw error;
  }
}

function resolveCanonicalTaskStep(current: CanonicalCurrentTask): TaskStepResolution {
  return resolveTaskStepForState(current.body, current.runtimeState.active_step_id);
}

function effectiveCheckpointPolicy(resolution: TaskStepResolution): TaskStepCheckpointPolicy {
  // Existing single-step fixtures predate the frozen metadata grammar. Keep
  // them terminal-compatible, while requiring complete metadata for every
  // genuinely multi-step task.
  if (resolution.steps.length === 1 && !resolution.current.metadata_complete) return 'not-required';
  if (!resolution.current.metadata_complete || resolution.current.review_checkpoint === null) {
    fail('TASK_STEPS_INVALID', `step ${resolution.current.id} has incomplete checkpoint metadata.`);
  }
  return resolution.current.review_checkpoint;
}

export function assertReviewExecutionEligible(
  current: CanonicalCurrentTask,
  execution: StepExecutionLogEntry,
): void {
  if (execution.step_id !== current.runtimeState.active_step_id) {
    fail('REVIEW_EXECUTION_STALE', 'review-change requires an execution for the active step.');
  }
  if (!execution.execution_result) {
    fail('REVIEW_TARGET_REQUIRED', 'review-change requires a structured Runtime-recorded execution result.');
  }
  if (execution.execution_result.outcome === 'blocked') {
    fail('REVIEW_EXECUTION_NOT_IMPLEMENTED', 'a blocked execution is not reviewable.');
  }
  if (execution.execution_result.outcome === 'test-red') {
    const context = resolveTestStrategyExecutionContext(current);
    if (context.phase !== 'red') {
      fail('TEST_STRATEGY_SEQUENCE_INVALID', 'a test-red execution is reviewable only on the first test-first step.');
    }
  }

  const executionIndex = current.runtimeState.execution_log.findIndex(item =>
    !('action' in item) && item.idempotency_key === execution.idempotency_key,
  );
  const laterCompletion = executionIndex >= 0 && current.runtimeState.execution_log.slice(executionIndex + 1).some(item =>
    !('action' in item) && item.step_id === execution.step_id && item.review_receipt !== undefined,
  );
  if (laterCompletion) {
    fail('REVIEW_EXECUTION_ALREADY_COMPLETED', 'the recorded execution has already passed review and completed its step.');
  }

  const checkpoint = effectiveCheckpointPolicy(resolveCanonicalTaskStep(current));
  if (execution.mode === 'default') {
    if (checkpoint !== 'required') {
      fail('REVIEW_CHECKPOINT_NOT_REQUIRED', 'the current step does not admit a review checkpoint.');
    }
    if (execution.status !== 'in-progress'
      || execution.advancement !== 'not-applicable'
      || current.runtimeState.active_step_status !== 'in-progress') {
      fail('REVIEW_EXECUTION_NOT_REVIEWABLE', 'the default execution is not awaiting its required review checkpoint.');
    }
    return;
  }

  if (execution.status !== 'completed'
    || execution.advancement !== 'repair-awaiting-verification'
    || current.runtimeState.active_step_status !== 'completed') {
    fail('REVIEW_EXECUTION_NOT_REVIEWABLE', 'the repair execution is not awaiting verification review.');
  }
}

function validateTaskStateDelta(value: unknown): TaskStateDelta {
  const record = expectRecord(value, 'semantic_delta');
  const kind = expectEnum(record.kind, ['task-state'], 'semantic_delta.kind');
  const action = expectEnum(record.action, ['retry-step', 'record-step-preflight', 'step-progress', 'clear-resume-review-gate', 'record-evidence-challenge', 'dismiss-evidence-challenge', ...DRAFT_TASK_STATE_ACTIONS, ...CLAIM_EVIDENCE_MIGRATION_ACTIONS, ...REVIEW_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS], 'semantic_delta.action');
  if (action === 'retry-step') {
    expectExactKeys(record, ['kind','action','step_id','blocked_attempt_id','blocker_resolution_refs',...(record.repair_diagnosis === undefined ? [] : ['repair_diagnosis']),'evidence_refs'], 'retry-step');
    return {kind,action,step_id:expectString(record.step_id,'step_id',STEP_ID_PATTERN),blocked_attempt_id:expectString(record.blocked_attempt_id,'blocked_attempt_id',SAFE_KEY_PATTERN),blocker_resolution_refs:validateEvidenceRefs(record.blocker_resolution_refs,'blocker_resolution_refs'),...(record.repair_diagnosis === undefined ? {} : {repair_diagnosis:validateStepRepairDiagnosis(record.repair_diagnosis)}),evidence_refs:validateEvidenceRefs(record.evidence_refs,'evidence_refs')};
  }
  if (action === 'record-step-preflight') {
    expectExactKeys(record, ['kind', 'action', 'step_id', 'candidate_paths', 'evidence_refs'], 'semantic_delta');
    return { kind, action, step_id: expectString(record.step_id, 'step_id', STEP_ID_PATTERN), candidate_paths: expectStringArray(record.candidate_paths, 'candidate_paths', true, 256).map(p => normalizeRepoPath(p, 'candidate_paths')), evidence_refs: validateEvidenceRefs(record.evidence_refs, 'evidence_refs') };
  }
  if (action === 'create-draft' || action === 'update-draft') {
    const allowedKeys = ['kind', 'action', 'task_id', 'task_slug', 'document_id', 'task_title', 'task_basis', 'draft_definition', 'active_step_id', 'evidence_refs', 'claim_evidence'];
    if (Object.keys(record).some(key => !allowedKeys.includes(key))) fail('RUNTIME_SCHEMA_INVALID', 'draft task-state semantic_delta contains unsupported fields.');
    const identity = validateDraftTaskIdentityFields(record, 'semantic_delta', true);
    const result: Extract<TaskStateDelta, { action: 'create-draft' | 'update-draft' }> = {
      kind,
      action,
      ...identity,
      task_basis: validateTaskBasis(record.task_basis, 'semantic_delta.task_basis'),
      draft_definition: validateReplanReplacementDefinition(record.draft_definition, 'semantic_delta.draft_definition'),
      active_step_id: expectString(record.active_step_id, 'semantic_delta.active_step_id', STEP_ID_PATTERN),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
    if (record.claim_evidence !== undefined) result.claim_evidence = validateClaimEvidence(record.claim_evidence, 'semantic_delta.claim_evidence');
    return result;
  }
  if (action === 'confirm-draft') {
    expectExactKeys(record, ['kind', 'action', 'task_id', 'task_slug', 'document_id', 'draft_revision', 'evidence_refs'], 'semantic_delta');
    const identity = validateDraftTaskIdentityFields(record, 'semantic_delta', false);
    const draftRevision = expectString(record.draft_revision, 'semantic_delta.draft_revision');
    if (!/^[a-f0-9]{64}$/.test(draftRevision)) fail('RUNTIME_SCHEMA_INVALID', 'semantic_delta.draft_revision must be SHA-256.');
    return {
      kind,
      action,
      ...identity,
      draft_revision: draftRevision,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  if (action === 'migrate-claim-evidence') {
    expectExactKeys(record, ['kind', 'action', 'claim_evidence', 'evidence_refs'], 'semantic_delta');
    return {
      kind,
      action,
      claim_evidence: validateClaimEvidence(record.claim_evidence, 'semantic_delta.claim_evidence'),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  if (action === 'clear-resume-review-gate') {
    expectExactKeys(record, ['kind', 'action', 'evidence_refs'], 'semantic_delta');
    return {
      kind,
      action: 'clear-resume-review-gate',
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  if (action === 'record-evidence-challenge') {
    expectExactKeys(record, ['kind', 'action', 'claim_id', 'slot_id', 'result_id', 'evidence_ref', 'evidence_sha256', 'reason', 'evidence_refs'], 'semantic_delta');
    return {
      kind, action,
      claim_id: expectString(record.claim_id, 'claim_id', CLAIM_ID_PATTERN),
      slot_id: expectString(record.slot_id, 'slot_id', CLAIM_EVIDENCE_SLOT_ID_PATTERN),
      result_id: expectString(record.result_id, 'result_id', CLAIM_ID_PATTERN),
      evidence_ref: normalizeRepoPath(expectString(record.evidence_ref, 'evidence_ref'), 'evidence_ref'),
      evidence_sha256: expectString(record.evidence_sha256, 'evidence_sha256', /^[a-f0-9]{64}$/),
      reason: expectString(record.reason, 'reason'),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  if (action === 'dismiss-evidence-challenge') {
    expectExactKeys(record, ['kind', 'action', 'challenge_id', 'evidence_ref', 'evidence_sha256', 'reason', 'evidence_refs'], 'semantic_delta');
    return {
      kind, action,
      challenge_id: expectString(record.challenge_id, 'challenge_id', SAFE_KEY_PATTERN),
      evidence_ref: normalizeRepoPath(expectString(record.evidence_ref, 'evidence_ref'), 'evidence_ref'),
      evidence_sha256: expectString(record.evidence_sha256, 'evidence_sha256', /^[a-f0-9]{64}$/),
      reason: expectString(record.reason, 'reason'),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  if (action === 'record-review-result') {
    expectExactKeys(record, ['kind', 'action', 'review_result', 'evidence_refs'], 'semantic_delta');
    return {
      kind,
      action,
      review_result: validatePendingReviewResult(record.review_result, 'semantic_delta.review_result', false) as Omit<PendingReviewResult, 'recorded_at'>,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  if (action === 'mark-replan-blocked' || action === 'clear-replan-block') {
    expectExactKeys(record, ['kind', 'action', 'evidence_refs'], 'semantic_delta');
    return {
      kind,
      action,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  if (action === 'commit-replan') {
    const allowedKeys = ['kind', 'action', 'task_basis', 'replacement_definition', 'active_step_id', 'evidence_refs', 'claim_evidence'];
    if (Object.keys(record).some(key => !allowedKeys.includes(key))) fail('RUNTIME_SCHEMA_INVALID', 'replan task-state semantic_delta contains unsupported fields.');
    const result: Extract<TaskStateDelta, { action: 'commit-replan' }> = {
      kind,
      action,
      task_basis: validateTaskBasis(record.task_basis, 'semantic_delta.task_basis'),
      replacement_definition: validateReplanReplacementDefinition(record.replacement_definition, 'semantic_delta.replacement_definition'),
      active_step_id: expectString(record.active_step_id, 'semantic_delta.active_step_id', STEP_ID_PATTERN),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
    if (record.claim_evidence !== undefined) result.claim_evidence = validateClaimEvidence(record.claim_evidence, 'semantic_delta.claim_evidence');
    return result;
  }
  const keys = Object.keys(record);
  if (keys.some(key => !['kind', 'action', 'step_id', 'status', 'evidence_refs', 'note', 'repair_fingerprint', 'repair_fingerprints', 'repair_wave_id', 'change_set_id', 'review_receipt', 'claim_evidence', 'execution_result'].includes(key))) {
    fail('RUNTIME_SCHEMA_INVALID', 'task-state semantic_delta contains unsupported fields.');
  }
  const result: Extract<TaskStateDelta, { action: 'step-progress' }> = {
    kind,
    action: 'step-progress',
    step_id: expectString(record.step_id, 'semantic_delta.step_id', STEP_ID_PATTERN),
    status: expectEnum(record.status, STEP_STATUSES, 'semantic_delta.status'),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
  };
  if (record.note !== undefined) result.note = expectText(record.note, 'semantic_delta.note');
  if (record.repair_fingerprint !== undefined) result.repair_fingerprint = expectString(record.repair_fingerprint, 'semantic_delta.repair_fingerprint', FINGERPRINT_PATTERN);
  if (record.repair_fingerprints !== undefined) {
    result.repair_fingerprints = expectStringArray(record.repair_fingerprints, 'semantic_delta.repair_fingerprints', false, MAX_FINDINGS)
      .map((fingerprint, index) => expectString(fingerprint, `semantic_delta.repair_fingerprints[${index}]`, FINGERPRINT_PATTERN));
    if (new Set(result.repair_fingerprints).size !== result.repair_fingerprints.length) {
      fail('RUNTIME_SCHEMA_INVALID', 'semantic_delta.repair_fingerprints must be unique.');
    }
  }
  if (record.repair_wave_id !== undefined) result.repair_wave_id = expectString(record.repair_wave_id, 'semantic_delta.repair_wave_id', SAFE_KEY_PATTERN);
  if (result.repair_fingerprint !== undefined && result.repair_fingerprints !== undefined) {
    fail('RUNTIME_SCHEMA_INVALID', 'step-progress must not mix repair_fingerprint with repair_fingerprints.');
  }
  if ((result.repair_fingerprints !== undefined) !== (result.repair_wave_id !== undefined)) {
    fail('RUNTIME_SCHEMA_INVALID', 'repair_fingerprints and repair_wave_id must be supplied together.');
  }
  if (record.change_set_id !== undefined) result.change_set_id = expectString(record.change_set_id, 'semantic_delta.change_set_id', SAFE_KEY_PATTERN);
  if (record.review_receipt !== undefined) result.review_receipt = validateStepReviewReceipt(record.review_receipt, 'semantic_delta.review_receipt');
  if (record.claim_evidence !== undefined) result.claim_evidence = validateClaimEvidence(record.claim_evidence, 'semantic_delta.claim_evidence');
  if (record.execution_result !== undefined) result.execution_result = validateStepExecutionResult(record.execution_result, 'semantic_delta.execution_result');
  return result;
}

function validateLifecycleReasons(value: unknown, location: string): ResumeReviewReason[] {
  const raw = expectStringArray(value, location, false, RESUME_REVIEW_REASON_ORDER.length);
  const normalized = normalizeResumeReviewReasons(raw);
  if (normalized.length !== raw.length || !normalized.every((reason: ResumeReviewReason, index: number) => reason === raw[index])) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} must use the canonical closed-set order without duplicates.`);
  }
  return normalized;
}

function validateLifecycleDelta(value: unknown): LifecycleDelta {
  const record = expectRecord(value, 'semantic_delta');
  const kind = expectEnum(record.kind, ['lifecycle'], 'semantic_delta.kind');
  const action = expectEnum(record.action, LIFECYCLE_MODES, 'semantic_delta.action');
  if (action === 'pause') {
    const allowedKeys = [
      'kind', 'action', 'lifecycle_state', 'suspension_reason', 'task_start_base',
      'last_reviewed_checkpoint', 'current_diff_review_target', 'rollback_conditions',
      'resume_review_reasons', 'evidence_refs', 'blocker_status', 'blocking_evidence',
      'remaining_acceptance', 'failed_checks',
    ];
    if (Object.keys(record).some(key => !allowedKeys.includes(key))) fail('RUNTIME_SCHEMA_INVALID', 'pause lifecycle semantic_delta contains unsupported fields.');
    const lifecycleState = expectEnum(record.lifecycle_state, ['paused_pending_closure', 'paused_blocked'], 'semantic_delta.lifecycle_state');
    const common = {
      kind,
      action,
      lifecycle_state: lifecycleState,
      suspension_reason: expectText(record.suspension_reason, 'semantic_delta.suspension_reason'),
      task_start_base: expectText(record.task_start_base, 'semantic_delta.task_start_base'),
      last_reviewed_checkpoint: expectText(record.last_reviewed_checkpoint, 'semantic_delta.last_reviewed_checkpoint'),
      current_diff_review_target: expectText(record.current_diff_review_target, 'semantic_delta.current_diff_review_target'),
      rollback_conditions: expectText(record.rollback_conditions, 'semantic_delta.rollback_conditions'),
      resume_review_reasons: validateLifecycleReasons(record.resume_review_reasons, 'semantic_delta.resume_review_reasons'),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    } as const;
    try {
      validateCurrentTaskResumeGate(lifecycleState, true, common.resume_review_reasons);
    } catch (error) {
      fail('RUNTIME_LIFECYCLE_EVIDENCE_INVALID', error instanceof Error ? error.message : String(error));
    }
    if (lifecycleState === 'paused_blocked') {
      return {
        ...common,
        lifecycle_state: lifecycleState,
        blocker_status: expectText(record.blocker_status, 'semantic_delta.blocker_status'),
        blocking_evidence: expectText(record.blocking_evidence, 'semantic_delta.blocking_evidence'),
        remaining_acceptance: expectText(record.remaining_acceptance, 'semantic_delta.remaining_acceptance'),
        ...(record.failed_checks === undefined
          ? {}
          : { failed_checks: expectStringArray(record.failed_checks, 'semantic_delta.failed_checks', false, 32) }),
      };
    }
    const forbiddenFields = ['blocker_status', 'blocking_evidence', 'remaining_acceptance', 'failed_checks'];
    if (forbiddenFields.some(field => record[field] !== undefined)) fail('RUNTIME_SCHEMA_INVALID', 'paused_pending_closure must not carry paused_blocked-only evidence.');
    return common;
  }

  if (action === 'interrupt') {
    const allowedKeys = [
      'kind', 'action', 'lifecycle_state', 'suspension_reason', 'task_start_base',
      'last_reviewed_checkpoint', 'current_diff_review_target', 'rollback_conditions',
      'resume_review_reasons', 'evidence_refs', 'checkpoint_evidence', 'dirty_attribution',
      'environment_state', 'recovery_strategy',
    ];
    if (Object.keys(record).some(key => !allowedKeys.includes(key))) fail('RUNTIME_SCHEMA_INVALID', 'interrupt lifecycle semantic_delta contains unsupported fields.');
    const lifecycleState = expectEnum(record.lifecycle_state, ['interrupted'], 'semantic_delta.lifecycle_state');
    const resumeReviewReasons = validateLifecycleReasons(record.resume_review_reasons, 'semantic_delta.resume_review_reasons');
    try {
      validateCurrentTaskResumeGate(lifecycleState, true, resumeReviewReasons);
    } catch (error) {
      fail('RUNTIME_LIFECYCLE_EVIDENCE_INVALID', error instanceof Error ? error.message : String(error));
    }
    return {
      kind,
      action,
      lifecycle_state: lifecycleState,
      suspension_reason: expectText(record.suspension_reason, 'semantic_delta.suspension_reason'),
      task_start_base: expectText(record.task_start_base, 'semantic_delta.task_start_base'),
      last_reviewed_checkpoint: expectText(record.last_reviewed_checkpoint, 'semantic_delta.last_reviewed_checkpoint'),
      current_diff_review_target: expectText(record.current_diff_review_target, 'semantic_delta.current_diff_review_target'),
      rollback_conditions: expectText(record.rollback_conditions, 'semantic_delta.rollback_conditions'),
      resume_review_reasons: resumeReviewReasons,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
      checkpoint_evidence: expectText(record.checkpoint_evidence, 'semantic_delta.checkpoint_evidence'),
      dirty_attribution: expectText(record.dirty_attribution, 'semantic_delta.dirty_attribution'),
      environment_state: expectText(record.environment_state, 'semantic_delta.environment_state'),
      recovery_strategy: expectText(record.recovery_strategy, 'semantic_delta.recovery_strategy'),
    };
  }

  if (action === 'resume-paused' || action === 'resume-interrupted') {
    expectExactKeys(record, ['kind', 'action', 'artifact_kind', 'recovery_package_path', 'recovery_package_revision', 'resume_review_reasons', 'evidence_refs'], 'semantic_delta');
    const artifactKind = expectEnum(record.artifact_kind, ['paused', 'interrupted'], 'semantic_delta.artifact_kind');
    if ((action === 'resume-paused' && artifactKind !== 'paused') || (action === 'resume-interrupted' && artifactKind !== 'interrupted')) {
      fail('RUNTIME_LIFECYCLE_EVIDENCE_INVALID', `${action} must target the matching ${action === 'resume-paused' ? 'paused' : 'interrupted'} artifact kind.`);
    }
    const recoveryPackageRevision = expectString(record.recovery_package_revision, 'semantic_delta.recovery_package_revision');
    if (!/^[a-f0-9]{64}$/.test(recoveryPackageRevision)) fail('RUNTIME_SCHEMA_INVALID', 'semantic_delta.recovery_package_revision must be SHA-256.');
    return {
      kind,
      action,
      artifact_kind: artifactKind,
      recovery_package_path: normalizeRepoPath(expectString(record.recovery_package_path, 'semantic_delta.recovery_package_path'), 'semantic_delta.recovery_package_path'),
      recovery_package_revision: recoveryPackageRevision,
      resume_review_reasons: validateLifecycleReasons(record.resume_review_reasons, 'semantic_delta.resume_review_reasons'),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }

  expectExactKeys(record, ['kind', 'action', 'invalidation_kind', 'invalidation_reason', 'evidence_refs', 'partial_diff_disposition'], 'semantic_delta');
  return {
    kind,
    action: 'supersede',
    invalidation_kind: expectEnum(record.invalidation_kind, ['goal', 'scope', 'acceptance'], 'semantic_delta.invalidation_kind'),
    invalidation_reason: expectText(record.invalidation_reason, 'semantic_delta.invalidation_reason'),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    partial_diff_disposition: validatePartialDiffDisposition(record.partial_diff_disposition, 'semantic_delta.partial_diff_disposition'),
  };
}

function validateFindingRecord(value: unknown, location: string): FindingQueueDelta & { action: 'admit' } {
  const record = expectRecord(value, location);
  expectExactKeys(
    record,
    ['kind', 'action', 'cycle_phase', 'finding_admission_wave_id', 'finding'],
    location,
  );
  expectEnum(record.kind, ['finding-queue'], `${location}.kind`);
  expectEnum(record.action, ['admit'], `${location}.action`);
  const finding = expectRecord(record.finding, `${location}.finding`);
  const findingKeys = [
    'fingerprint',
    'category',
    'owner_task_id',
    'scope',
    'decision',
    'file',
    'failure_condition',
    'violated_invariant',
    'root_cause_status',
    'status',
    'repair_attempts',
    'max_repair_attempts',
    'evidence_refs',
    'review_cycle_id',
  ];
  const findingExtra = Object.keys(finding).filter(key => !findingKeys.includes(key));
  if (findingExtra.length > 0) fail('RUNTIME_SCHEMA_INVALID', `${location}.finding contains unsupported fields.`);
  const result: FindingQueueDelta & { action: 'admit' } = {
    kind: 'finding-queue',
    action: 'admit',
    cycle_phase: expectEnum(record.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`),
    finding_admission_wave_id: expectString(record.finding_admission_wave_id, `${location}.finding_admission_wave_id`, SAFE_KEY_PATTERN),
    finding: {
      fingerprint: expectString(finding.fingerprint, `${location}.finding.fingerprint`, FINGERPRINT_PATTERN),
      category: expectText(finding.category, `${location}.finding.category`, 256),
      owner_task_id: expectString(finding.owner_task_id, `${location}.finding.owner_task_id`),
      scope: expectEnum(finding.scope, ['admitted'], `${location}.finding.scope`),
      decision: expectEnum(finding.decision, ['mechanical'], `${location}.finding.decision`),
      file: normalizeRepoPath(expectString(finding.file, `${location}.finding.file`), `${location}.finding.file`),
      failure_condition: expectText(finding.failure_condition, `${location}.finding.failure_condition`),
      violated_invariant: expectText(finding.violated_invariant, `${location}.finding.violated_invariant`, 512),
      root_cause_status: expectEnum(finding.root_cause_status, ['confirmed', 'bounded'], `${location}.finding.root_cause_status`),
      max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.finding.max_repair_attempts`, 1, MAX_REPAIR_ATTEMPTS),
      evidence_refs: validateEvidenceRefs(finding.evidence_refs, `${location}.finding.evidence_refs`),
      review_cycle_id: expectString(finding.review_cycle_id, `${location}.finding.review_cycle_id`, SAFE_KEY_PATTERN),
    },
  };
  if (finding.status !== undefined && finding.status !== 'admitted') fail('RUNTIME_SCHEMA_INVALID', `${location}.finding.status must be admitted.`);
  if (finding.repair_attempts !== undefined && finding.repair_attempts !== 0) fail('RUNTIME_SCHEMA_INVALID', `${location}.finding.repair_attempts must be 0.`);
  return result;
}

function validateFindingAction(value: unknown): FindingQueueDelta & { action: Exclude<FindingAction, 'admit'> } {
  const record = expectRecord(value, 'semantic_delta');
  const action = expectEnum(record.action, ['record-repair-attempt', 'resolve', 'defer', 'reject'], 'semantic_delta.action');
  const allowedKeys = action === 'record-repair-attempt'
    ? ['kind', 'action', 'fingerprint', 'review_cycle_id', 'repair_wave_id', 'evidence_refs', 'note']
    : ['kind', 'action', 'fingerprint', 'evidence_refs', 'note'];
  if (Object.keys(record).some(key => !allowedKeys.includes(key))) fail('RUNTIME_SCHEMA_INVALID', 'finding-queue semantic_delta contains unsupported fields.');
  const result: FindingQueueDelta & { action: Exclude<FindingAction, 'admit'> } = action === 'record-repair-attempt'
    ? {
      kind: 'finding-queue',
      action,
      fingerprint: expectString(record.fingerprint, 'semantic_delta.fingerprint', FINGERPRINT_PATTERN),
      review_cycle_id: expectString(record.review_cycle_id, 'semantic_delta.review_cycle_id', SAFE_KEY_PATTERN),
      repair_wave_id: expectString(record.repair_wave_id, 'semantic_delta.repair_wave_id', SAFE_KEY_PATTERN),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    }
    : {
      kind: 'finding-queue',
      action,
      fingerprint: expectString(record.fingerprint, 'semantic_delta.fingerprint', FINGERPRINT_PATTERN),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  if (record.note !== undefined) result.note = expectText(record.note, 'semantic_delta.note');
  return result;
}

const CLOSURE_EVIDENCE_FIELDS = [
  'acceptance_satisfied',
  'validation_complete',
  'no_admitted_or_in_progress_findings',
  'no_unresolved_closure_blocker',
  'release_evidence',
  'rollback_evidence',
  'observation_evidence',
  'remaining_risks_non_blocking',
  'archive_path_verified',
] as const;

function validateClosureEvidence(value: unknown, location: string): ClosureEvidence {
  const record = expectRecord(value, location);
  expectExactKeys(record, CLOSURE_EVIDENCE_FIELDS, location);
  const validateEvidenceGate = (raw: unknown, field: string): ReleaseClosureEvidence => {
    const gate = expectRecord(raw, `${location}.${field}`);
    expectExactKeys(gate, ['triggered', 'complete', 'evidence_refs'], `${location}.${field}`);
    const triggered = expectBoolean(gate.triggered, `${location}.${field}.triggered`);
    const complete = expectBoolean(gate.complete, `${location}.${field}.complete`);
    const evidenceRefs = expectStringArray(gate.evidence_refs, `${location}.${field}.evidence_refs`, true, MAX_EVIDENCE_REFS);
    if (triggered && !complete) {
      fail('CLOSURE_EVIDENCE_INVALID', `${location}.${field} is triggered but incomplete.`);
    }
    return { triggered, complete, evidence_refs: evidenceRefs };
  };
  return {
    acceptance_satisfied: expectBoolean(record.acceptance_satisfied, `${location}.acceptance_satisfied`),
    validation_complete: expectBoolean(record.validation_complete, `${location}.validation_complete`),
    no_admitted_or_in_progress_findings: expectBoolean(record.no_admitted_or_in_progress_findings, `${location}.no_admitted_or_in_progress_findings`),
    no_unresolved_closure_blocker: expectBoolean(record.no_unresolved_closure_blocker, `${location}.no_unresolved_closure_blocker`),
    release_evidence: validateEvidenceGate(record.release_evidence, 'release_evidence'),
    rollback_evidence: validateEvidenceGate(record.rollback_evidence, 'rollback_evidence'),
    observation_evidence: validateEvidenceGate(record.observation_evidence, 'observation_evidence'),
    remaining_risks_non_blocking: expectBoolean(record.remaining_risks_non_blocking, `${location}.remaining_risks_non_blocking`),
    archive_path_verified: expectBoolean(record.archive_path_verified, `${location}.archive_path_verified`),
  };
}

function validateDeliverySummary(value: unknown, location: string): DeliverySummary {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['goal', 'actual_changes', 'verification', 'release_evidence', 'rollback_evidence', 'observation_evidence', 'next_action'], location);
  return {
    goal: expectText(record.goal, `${location}.goal`, MAX_TEXT_LENGTH),
    actual_changes: expectStringArray(record.actual_changes, `${location}.actual_changes`, false, 64),
    verification: expectStringArray(record.verification, `${location}.verification`, false, 64),
    release_evidence: expectStringArray(record.release_evidence, `${location}.release_evidence`, true, 64),
    rollback_evidence: expectStringArray(record.rollback_evidence, `${location}.rollback_evidence`, true, 64),
    observation_evidence: expectStringArray(record.observation_evidence, `${location}.observation_evidence`, true, 64),
    next_action: expectText(record.next_action, `${location}.next_action`, MAX_TEXT_LENGTH),
  };
}

function validateLessonAdmission(value: unknown, location: string): LessonAdmission {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['decision', 'candidate_refs', 'evidence_refs'], location);
  const decision = expectEnum(record.decision, ['admit', 'defer', 'no-op'], `${location}.decision`);
  const candidateRefs = expectStringArray(record.candidate_refs, `${location}.candidate_refs`, true, MAX_EVIDENCE_REFS);
  const evidenceRefs = expectStringArray(record.evidence_refs, `${location}.evidence_refs`, true, MAX_EVIDENCE_REFS);
  if (decision === 'admit' && candidateRefs.length === 0) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.candidate_refs must be non-empty when decision is admit.`);
  if (decision === 'admit' && evidenceRefs.length === 0) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.evidence_refs must be non-empty when decision is admit.`);
  return { decision, candidate_refs: candidateRefs, evidence_refs: evidenceRefs };
}

const KNOWLEDGE_ADMISSION_DISPOSITIONS: readonly KnowledgeAdmissionDisposition[] = [
  'admit',
  'merge',
  'supersede',
  'defer',
  'reject',
  'no-op',
];

const KNOWLEDGE_CANDIDATE_KEYS = [
  'candidateId',
  'kind',
  'fingerprint',
  'statement',
  'sourceRefs',
  'applicability',
  'authoritySource',
  'stability',
  'evidenceRefs',
  'noveltyAgainst',
  'conflictSet',
  'supersedes',
  'reviewOrExpiryTrigger',
  'expectedConsumers',
  'decisionContext',
  'systemicSeverity',
  'implementation_anchors',
] as const;

function validateImplementationAnchors(value: unknown, location: string): ImplementationAnchors {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['coverage', 'source_revision', 'anchors'], location);
  const sourceRevision = expectString(record.source_revision, `${location}.source_revision`);
  if (sourceRevision.length > 256) fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.source_revision exceeds 256 characters.`);
  if (!Array.isArray(record.anchors) || record.anchors.length > 5) {
    fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.anchors must contain at most five anchors.`);
  }
  const anchors = record.anchors.map((raw, index) => {
    const anchor = expectRecord(raw, `${location}.anchors[${index}]`);
    const extra = Object.keys(anchor).filter(key => !['path', 'symbol', 'role', 'evidence_refs'].includes(key));
    const missing = ['path', 'role', 'evidence_refs'].filter(key => !(key in anchor));
    if (missing.length > 0 || extra.length > 0) {
      fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.anchors[${index}] keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
    }
    const rawAnchorPath = expectString(anchor.path, `${location}.anchors[${index}].path`);
    const anchorPath = normalizeRepoPath(rawAnchorPath, `${location}.anchors[${index}].path`);
    if (/^[A-Za-z]:\//u.test(anchorPath) || anchorPath.includes(':') || anchorPath !== path.posix.normalize(anchorPath)) {
      fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.anchors[${index}].path must be a canonical repository-relative path.`);
    }
    if (anchorPath.includes('*') || /:\d+(?:-\d+)?$/u.test(anchorPath)) {
      fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.anchors[${index}].path must not be a wildcard or line-number locator.`);
    }
    const symbol = anchor.symbol === undefined || anchor.symbol === null
      ? null
      : expectText(anchor.symbol, `${location}.anchors[${index}].symbol`, 256);
    if (symbol !== null && /\r|\n/u.test(symbol)) fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.anchors[${index}].symbol must be single-line.`);
    if (symbol !== null && /^.+:\d+(?:-\d+)?$/u.test(symbol)) fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.anchors[${index}].symbol must not be a line-number locator.`);
    const role = expectText(anchor.role, `${location}.anchors[${index}].role`, 256);
    const evidenceRefs = validateEvidenceRefs(anchor.evidence_refs, `${location}.anchors[${index}].evidence_refs`);
    return { path: anchorPath, symbol, role, evidence_refs: evidenceRefs };
  });
  const anchorKeys = anchors.map(anchor => `${anchor.path}#${anchor.symbol ?? ''}`);
  if (new Set(anchorKeys).size !== anchorKeys.length) fail('IMPLEMENTATION_ANCHOR_INVALID', `${location}.anchors must not contain duplicate path/symbol locators.`);
  return {
    coverage: expectEnum(record.coverage, ['observed', 'verified-scope'], `${location}.coverage`),
    source_revision: sourceRevision,
    anchors,
  };
}

function validateKnowledgeCandidate(value: unknown, location: string, expectedKind?: 'contract' | 'decision'): KnowledgeCandidate {
  const record = expectRecord(value, location);
  const allowedKeys = new Set<string>(KNOWLEDGE_CANDIDATE_KEYS);
  const requiredKeys = KNOWLEDGE_CANDIDATE_KEYS.filter(key => !['decisionContext', 'systemicSeverity', 'implementation_anchors'].includes(key));
  const missing = requiredKeys.filter(key => !(key in record));
  const extra = Object.keys(record).filter(key => !allowedKeys.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail('KNOWLEDGE_ADMISSION_INVALID', `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
  }
  const kind = expectEnum(record.kind, ['contract', 'decision'], `${location}.kind`);
  if (expectedKind !== undefined && kind !== expectedKind) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.kind must be ${expectedKind}.`);
  const sourceRefsRaw = record.sourceRefs;
  if (!Array.isArray(sourceRefsRaw) || sourceRefsRaw.length === 0 || sourceRefsRaw.length > 32) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.sourceRefs must contain between one and 32 entries.`);
  const sourceRefs = sourceRefsRaw.map((raw, index) => {
    const sourceRef = expectRecord(raw, `${location}.sourceRefs[${index}]`);
    expectExactKeys(sourceRef, ['locator', 'revision'], `${location}.sourceRefs[${index}]`);
    return { locator: expectText(sourceRef.locator, `${location}.sourceRefs[${index}].locator`, 512), revision: expectText(sourceRef.revision, `${location}.sourceRefs[${index}].revision`, 256) };
  });
  const applicabilityRecord = expectRecord(record.applicability, `${location}.applicability`);
  expectExactKeys(applicabilityRecord, ['projectTypes', 'pathsSymbolsOrSurfaces', 'triggerConditions'], `${location}.applicability`);
  const applicability = {
    projectTypes: expectStringArray(applicabilityRecord.projectTypes, `${location}.applicability.projectTypes`, true, 32),
    pathsSymbolsOrSurfaces: expectStringArray(applicabilityRecord.pathsSymbolsOrSurfaces, `${location}.applicability.pathsSymbolsOrSurfaces`, true, 32),
    triggerConditions: expectStringArray(applicabilityRecord.triggerConditions, `${location}.applicability.triggerConditions`, true, 32),
  };
  if (applicability.projectTypes.length === 0 && applicability.pathsSymbolsOrSurfaces.length === 0 && applicability.triggerConditions.length === 0) {
    fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.applicability must identify at least one project, surface, or trigger.`);
  }
  const decisionContext = record.decisionContext === undefined
    ? undefined
    : (() => {
      const context = expectRecord(record.decisionContext, `${location}.decisionContext`);
      expectExactKeys(context, ['alternatives', 'constraints'], `${location}.decisionContext`);
      return {
        alternatives: expectStringArray(context.alternatives, `${location}.decisionContext.alternatives`, false, 32),
        constraints: expectStringArray(context.constraints, `${location}.decisionContext.constraints`, false, 32),
      };
    })();
  if (kind === 'decision' && decisionContext === undefined) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.decisionContext is required for a Decision.`);
  const implementationAnchors = record.implementation_anchors === undefined
    ? undefined
    : validateImplementationAnchors(record.implementation_anchors, `${location}.implementation_anchors`);
  const candidate: KnowledgeCandidate = {
    candidateId: expectString(record.candidateId, `${location}.candidateId`, SAFE_KEY_PATTERN),
    kind,
    fingerprint: expectString(record.fingerprint, `${location}.fingerprint`, FINGERPRINT_PATTERN),
    statement: expectText(record.statement, `${location}.statement`, MAX_TEXT_LENGTH),
    sourceRefs,
    applicability,
    authoritySource: expectEnum(record.authoritySource, ['user', 'existing-contract', 'accepted-decision', 'verified-evidence', 'none'], `${location}.authoritySource`),
    stability: expectEnum(record.stability, ['stable', 'provisional', 'exploratory'], `${location}.stability`),
    evidenceRefs: validateEvidenceRefs(record.evidenceRefs, `${location}.evidenceRefs`),
    noveltyAgainst: expectStringArray(record.noveltyAgainst, `${location}.noveltyAgainst`, true, 32),
    conflictSet: expectStringArray(record.conflictSet, `${location}.conflictSet`, true, 32),
    supersedes: expectNullableString(record.supersedes, `${location}.supersedes`, SAFE_KEY_PATTERN),
    reviewOrExpiryTrigger: expectNullableString(record.reviewOrExpiryTrigger, `${location}.reviewOrExpiryTrigger`),
    expectedConsumers: expectStringArray(record.expectedConsumers, `${location}.expectedConsumers`, false, 32),
    ...(decisionContext ? { decisionContext } : {}),
    ...(record.systemicSeverity === undefined ? {} : { systemicSeverity: expectEnum(record.systemicSeverity, ['ordinary', 'high'], `${location}.systemicSeverity`) }),
    ...(implementationAnchors ? { implementation_anchors: implementationAnchors } : {}),
  };
  return candidate;
}

function validateKnowledgeAdmissionRecord(value: unknown, location: string, expectedKind: 'contract' | 'decision'): KnowledgeAdmissionRecord {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['candidate', 'disposition', 'matched_knowledge_id', 'reasons'], location);
  const candidate = validateKnowledgeCandidate(record.candidate, `${location}.candidate`, expectedKind);
  const disposition = expectEnum(record.disposition, KNOWLEDGE_ADMISSION_DISPOSITIONS, `${location}.disposition`);
  const matchedKnowledgeId = expectNullableString(record.matched_knowledge_id, `${location}.matched_knowledge_id`, SAFE_KEY_PATTERN);
  const reasons = expectStringArray(record.reasons, `${location}.reasons`, true, 32);
  const durableDisposition = ['admit', 'merge', 'supersede'].includes(disposition);
  if (durableDisposition && reasons.length === 0) {
    fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.reasons must be non-empty for a durable admission.`);
  }
  if (durableDisposition && candidate.authoritySource === 'none') {
    fail('KNOWLEDGE_ADMISSION_INVALID', `${location} cannot admit knowledge without an authority source.`);
  }
  if (durableDisposition && expectedKind === 'decision' && !['user', 'accepted-decision'].includes(candidate.authoritySource)) {
    fail('KNOWLEDGE_ADMISSION_INVALID', `${location} Decision admission requires user or accepted-decision authority.`);
  }
  if (disposition === 'merge' && matchedKnowledgeId === null) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.matched_knowledge_id is required for merge.`);
  if (disposition === 'supersede' && (matchedKnowledgeId === null || candidate.supersedes !== matchedKnowledgeId)) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.supersede must identify the same predecessor in matched_knowledge_id and candidate.supersedes.`);
  if (durableDisposition) {
    if (candidate.stability !== 'stable' || candidate.conflictSet.length > 0 || candidate.evidenceRefs.length === 0) {
      fail('KNOWLEDGE_ADMISSION_INVALID', `${location} durable admission requires stable, conflict-free candidate evidence.`);
    }
  }
  return { candidate, disposition, matched_knowledge_id: matchedKnowledgeId, reasons };
}

function validateKnowledgeAdmissionBundle(value: unknown, location: string): KnowledgeAdmissionBundle {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['contracts', 'decisions'], location);
  if (!Array.isArray(record.contracts) || record.contracts.length > 32) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.contracts must contain at most 32 records.`);
  if (!Array.isArray(record.decisions) || record.decisions.length > 32) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.decisions must contain at most 32 records.`);
  const contracts = record.contracts.map((item, index) => validateKnowledgeAdmissionRecord(item, `${location}.contracts[${index}]`, 'contract'));
  const decisions = record.decisions.map((item, index) => validateKnowledgeAdmissionRecord(item, `${location}.decisions[${index}]`, 'decision'));
  if (new Set(contracts.map(item => item.candidate.candidateId)).size !== contracts.length) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.contracts candidate identity must be unique.`);
  if (new Set(decisions.map(item => item.candidate.candidateId)).size !== decisions.length) fail('KNOWLEDGE_ADMISSION_INVALID', `${location}.decisions candidate identity must be unique.`);
  return { contracts, decisions };
}

function emptyKnowledgeAdmissionBundle(): KnowledgeAdmissionBundle {
  return { contracts: [], decisions: [] };
}

function validateKnowledgeProvenance(value: unknown, location: string): KnowledgeProvenance {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['task_id', 'task_slug', 'document_id', 'archive_path', 'archive_revision', 'source_revision', 'evidence_refs'], location);
  const taskId = expectString(record.task_id, `${location}.task_id`);
  const taskSlug = expectString(record.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail('KNOWLEDGE_PROVENANCE_MISMATCH', error instanceof Error ? error.message : String(error));
  }
  const documentId = expectString(record.document_id, `${location}.document_id`);
  const archiveRevision = expectString(record.archive_revision, `${location}.archive_revision`);
  const sourceRevision = expectString(record.source_revision, `${location}.source_revision`);
  if (!DOCUMENT_ID_PATTERN.test(documentId) || !SHA256_PATTERN.test(archiveRevision) || !SHA256_PATTERN.test(sourceRevision)) {
    fail('KNOWLEDGE_PROVENANCE_MISMATCH', `${location} contains an invalid document or revision.`);
  }
  const archivePath = normalizeRepoPath(expectString(record.archive_path, `${location}.archive_path`), `${location}.archive_path`);
  if (!/^TASKS\/TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(archivePath)) fail('KNOWLEDGE_PROVENANCE_MISMATCH', `${location}.archive_path is not a canonical task archive path.`);
  return {
    task_id: taskId,
    task_slug: taskSlug,
    document_id: documentId,
    archive_path: archivePath,
    archive_revision: archiveRevision,
    source_revision: sourceRevision,
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
  };
}

function validateKnowledgeDelta(value: unknown, expectedKind?: 'contract' | 'decision'): KnowledgeDelta {
  const record = expectRecord(value, 'semantic_delta');
  expectExactKeys(record, ['kind', 'action', 'knowledge_kind', 'admission', 'provenance', 'evidence_refs'], 'semantic_delta');
  const knowledgeKind = expectEnum(record.knowledge_kind, ['contract', 'decision'], 'semantic_delta.knowledge_kind');
  if (expectedKind !== undefined && knowledgeKind !== expectedKind) fail('RUNTIME_SCHEMA_INVALID', `semantic_delta.knowledge_kind must be ${expectedKind}.`);
  const admission = validateKnowledgeAdmissionRecord(record.admission, 'semantic_delta.admission', knowledgeKind);
  if (!['admit', 'merge', 'supersede'].includes(admission.disposition)) {
    fail('KNOWLEDGE_ADMISSION_INVALID', 'Only admitted, merged, or superseded knowledge may be submitted to a Runtime promotion operation.');
  }
  const provenance = validateKnowledgeProvenance(record.provenance, 'semantic_delta.provenance');
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs');
  const candidateEvidenceRefs = [
    ...admission.candidate.evidenceRefs,
    ...(admission.candidate.implementation_anchors?.anchors.flatMap(anchor => anchor.evidence_refs) ?? []),
    ...provenance.evidence_refs,
  ];
  if (!candidateEvidenceRefs.every(ref => evidenceRefs.includes(ref))) fail('RUNTIME_EVIDENCE_INVALID', 'knowledge proposal evidence_refs must cover candidate, anchor, and provenance evidence_refs.');
  return {
    kind: 'knowledge',
    action: 'promote',
    knowledge_kind: knowledgeKind,
    admission,
    provenance,
    evidence_refs: evidenceRefs,
  };
}

function validateArchiveDelta(value: unknown): ArchiveDelta {
  const record = expectRecord(value, 'semantic_delta');
  const allowedKeys = ['kind', 'action', 'closure_evidence', 'delivery_summary', 'remaining_risks', 'lesson_admission', 'knowledge_admissions', 'evidence_refs'];
  const extra = Object.keys(record).filter(key => !allowedKeys.includes(key));
  const required = allowedKeys.filter(key => !['knowledge_admissions'].includes(key) && !(key in record));
  if (required.length > 0 || extra.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `semantic_delta keys mismatch; missing=[${required.join(', ')}], unexpected=[${extra.join(', ')}].`);
  }
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs');
  const closureEvidence = validateClosureEvidence(record.closure_evidence, 'semantic_delta.closure_evidence');
  const lessonAdmission = validateLessonAdmission(record.lesson_admission, 'semantic_delta.lesson_admission');
  const knowledgeAdmissions = record.knowledge_admissions === undefined
    ? emptyKnowledgeAdmissionBundle()
    : validateKnowledgeAdmissionBundle(record.knowledge_admissions, 'semantic_delta.knowledge_admissions');
  const referencedEvidence = [
    ...closureEvidence.release_evidence.evidence_refs,
    ...closureEvidence.rollback_evidence.evidence_refs,
    ...closureEvidence.observation_evidence.evidence_refs,
    ...lessonAdmission.evidence_refs,
    ...knowledgeAdmissions.contracts.flatMap(item => [...item.candidate.evidenceRefs, ...(item.candidate.implementation_anchors?.anchors.flatMap(anchor => anchor.evidence_refs) ?? [])]),
    ...knowledgeAdmissions.decisions.flatMap(item => [...item.candidate.evidenceRefs, ...(item.candidate.implementation_anchors?.anchors.flatMap(anchor => anchor.evidence_refs) ?? [])]),
  ];
  if (!referencedEvidence.every(ref => evidenceRefs.includes(ref))) {
    fail('RUNTIME_EVIDENCE_INVALID', 'archive proposal evidence_refs must cover closure and lesson-admission evidence_refs.');
  }
  return {
    kind: expectEnum(record.kind, ['archive'], 'semantic_delta.kind'),
    action: expectEnum(record.action, ['archive'], 'semantic_delta.action'),
    closure_evidence: closureEvidence,
    delivery_summary: validateDeliverySummary(record.delivery_summary, 'semantic_delta.delivery_summary'),
    remaining_risks: expectStringArray(record.remaining_risks, 'semantic_delta.remaining_risks', true, 64),
    lesson_admission: lessonAdmission,
    knowledge_admissions: knowledgeAdmissions,
    evidence_refs: evidenceRefs,
  };
}

const LESSON_CATEGORIES = ['通用', '数据与存储', '前端与交互', '后端与服务', '测试与回归', '部署与运行时'] as const satisfies readonly LessonCandidate['category'][];
const LESSON_REQUIRED_SECTION_HEADINGS = ['使用规则', ...LESSON_CATEGORIES] as const;

function validateLessonCandidate(value: unknown, location: string): LessonCandidate {
  const record = expectRecord(value, location);
  expectExactKeys(record, ['candidate_ref', 'category', 'scene', 'conclusion', 'trigger', 'cause', 'action', 'consumer', 'evidence_refs'], location);
  return {
    candidate_ref: expectString(record.candidate_ref, `${location}.candidate_ref`, SAFE_KEY_PATTERN),
    category: expectEnum(record.category, LESSON_CATEGORIES, `${location}.category`),
    scene: expectText(record.scene, `${location}.scene`),
    conclusion: expectText(record.conclusion, `${location}.conclusion`),
    trigger: expectText(record.trigger, `${location}.trigger`),
    cause: expectText(record.cause, `${location}.cause`),
    action: expectText(record.action, `${location}.action`),
    consumer: expectText(record.consumer, `${location}.consumer`),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
  };
}

function validateProjectStatusDelta(value: unknown): ProjectStatusDelta {
  const record = expectRecord(value, 'semantic_delta');
  expectExactKeys(record, ['kind', 'action', 'status', 'summary', 'completed_items', 'remaining_risks', 'next_checkpoint', 'evidence_refs'], 'semantic_delta');
  return {
    kind: expectEnum(record.kind, ['project-status'], 'semantic_delta.kind'),
    action: expectEnum(record.action, ['sync'], 'semantic_delta.action'),
    status: expectEnum(record.status, ['completed', 'observing'], 'semantic_delta.status'),
    summary: expectText(record.summary, 'semantic_delta.summary'),
    completed_items: expectStringArray(record.completed_items, 'semantic_delta.completed_items', false, 64),
    remaining_risks: expectStringArray(record.remaining_risks, 'semantic_delta.remaining_risks', true, 64),
    next_checkpoint: expectText(record.next_checkpoint, 'semantic_delta.next_checkpoint'),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
  };
}

function validateLessonRecordDelta(value: unknown): LessonRecordDelta {
  const record = expectRecord(value, 'semantic_delta');
  expectExactKeys(record, ['kind', 'action', 'candidates', 'evidence_refs'], 'semantic_delta');
  if (!Array.isArray(record.candidates) || record.candidates.length === 0 || record.candidates.length > 32) {
    fail('RUNTIME_SCHEMA_INVALID', 'semantic_delta.candidates must contain between 1 and 32 candidates.');
  }
  const candidates = record.candidates.map((candidate, index) => validateLessonCandidate(candidate, `semantic_delta.candidates[${index}]`));
  if (new Set(candidates.map(candidate => candidate.candidate_ref)).size !== candidates.length) {
    fail('RUNTIME_SCHEMA_INVALID', 'semantic_delta.candidates must have unique candidate_ref values.');
  }
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs');
  if (!candidates.every(candidate => candidate.evidence_refs.every(ref => evidenceRefs.includes(ref)))) {
    fail('RUNTIME_EVIDENCE_INVALID', 'lesson-record proposal evidence_refs must cover every candidate evidence reference.');
  }
  return {
    kind: expectEnum(record.kind, ['lesson-record'], 'semantic_delta.kind'),
    action: expectEnum(record.action, ['record'], 'semantic_delta.action'),
    candidates,
    evidence_refs: evidenceRefs,
  };
}

function validateInboxItemId(value: unknown, location: string): string {
  const itemId = expectString(value, location);
  const match = INBOX_RECORD_ITEM_ID_PATTERN.exec(itemId);
  if (!match) {
    fail('RUNTIME_IDENTITY_INVALID', `${location} must use YYYYMMDD-short-id with a lowercase alphanumeric short-id.`);
  }
  const year = Number(match[1]!.slice(0, 4));
  const month = Number(match[1]!.slice(4, 6));
  const day = Number(match[1]!.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail('RUNTIME_IDENTITY_INVALID', `${location} must begin with a valid YYYYMMDD date.`);
  }
  return itemId;
}

function validateInboxRecord(value: unknown, location: string): InboxRecord {
  const record = expectRecord(value, location);
  expectExactKeys(
    record,
    ['artifact_kind', 'item_id', 'title', 'type', 'source', 'captured_at', 'relation_to_current_task', 'current_task_id', 'description', 'evidence', 'suggested_next_action', 'status'],
    location,
  );
  const title = expectText(record.title, `${location}.title`, 512);
  if (/[\r\n]/u.test(title) || /^\{\{[^{}]+\}\}$/.test(title)) {
    fail('RUNTIME_IDENTITY_INVALID', `${location}.title must be a concrete single-line value.`);
  }
  const capturedAt = expectString(record.captured_at, `${location}.captured_at`);
  if (/[\r\n]/u.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.captured_at must be a parseable timestamp.`);
  }
  const currentTaskId = expectString(record.current_task_id, `${location}.current_task_id`);
  try {
    validateTaskId(currentTaskId);
  } catch (error) {
    fail('RUNTIME_IDENTITY_INVALID', error instanceof Error ? error.message : String(error));
  }
  return {
    artifact_kind: expectEnum(record.artifact_kind, ['inbox_item'], `${location}.artifact_kind`),
    item_id: validateInboxItemId(record.item_id, `${location}.item_id`),
    title,
    type: expectEnum(record.type, INBOX_ITEM_TYPES, `${location}.type`),
    source: expectEnum(record.source, INBOX_ITEM_SOURCES, `${location}.source`),
    captured_at: capturedAt,
    relation_to_current_task: expectEnum(record.relation_to_current_task, ['unrelated'], `${location}.relation_to_current_task`),
    current_task_id: currentTaskId,
    description: expectText(record.description, `${location}.description`, MAX_INBOX_TEXT_LENGTH),
    evidence: expectText(record.evidence, `${location}.evidence`, MAX_INBOX_TEXT_LENGTH),
    suggested_next_action: expectEnum(record.suggested_next_action, INBOX_SUGGESTED_NEXT_ACTIONS, `${location}.suggested_next_action`),
    status: expectEnum(record.status, ['captured'], `${location}.status`),
  };
}

function validateInboxRecordDelta(value: unknown): InboxRecordDelta {
  const record = expectRecord(value, 'semantic_delta');
  expectExactKeys(
    record,
    ['kind', 'action', 'item_slug', 'record', 'relation_evidence_refs', 'duplicate_check', 'proposed_owner', 'target_path', 'evidence_refs'],
    'semantic_delta',
  );
  const itemSlug = expectString(record.item_slug, 'semantic_delta.item_slug');
  try {
    validateTaskSlug(itemSlug);
  } catch (error) {
    fail('RUNTIME_IDENTITY_INVALID', error instanceof Error ? error.message : String(error));
  }
  const inboxRecord = validateInboxRecord(record.record, 'semantic_delta.record');
  const relationEvidenceRefs = validateEvidenceRefs(record.relation_evidence_refs, 'semantic_delta.relation_evidence_refs');
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs');
  if (!relationEvidenceRefs.every(ref => evidenceRefs.includes(ref))) {
    fail('RUNTIME_EVIDENCE_INVALID', 'semantic_delta.evidence_refs must cover every relation_evidence_refs entry.');
  }
  const duplicateCheck = expectEnum(record.duplicate_check, ['clear'], 'semantic_delta.duplicate_check');
  const proposedOwner = expectEnum(record.proposed_owner, INBOX_SUGGESTED_NEXT_ACTIONS, 'semantic_delta.proposed_owner');
  if (inboxRecord.suggested_next_action !== proposedOwner) {
    fail('RUNTIME_RELATION_INVALID', 'semantic_delta.proposed_owner must match record.suggested_next_action.');
  }
  const targetPath = normalizeRepoPath(expectString(record.target_path, 'semantic_delta.target_path'), 'semantic_delta.target_path');
  const targetMatch = INBOX_RECORD_PATH_PATTERN.exec(targetPath);
  if (!targetMatch || `${targetMatch[1]}-${targetMatch[2]}` !== inboxRecord.item_id || targetMatch[3] !== itemSlug) {
    fail('RUNTIME_PATH_INVALID', 'semantic_delta.target_path must be the canonical path derived from item_id and item_slug.');
  }
  return {
    kind: expectEnum(record.kind, ['inbox-record'], 'semantic_delta.kind'),
    action: expectEnum(record.action, ['record'], 'semantic_delta.action'),
    item_slug: itemSlug,
    record: inboxRecord,
    relation_evidence_refs: relationEvidenceRefs,
    duplicate_check: duplicateCheck,
    proposed_owner: proposedOwner,
    target_path: targetPath,
    evidence_refs: evidenceRefs,
  };
}

function validateSemanticDelta(value: unknown, operationKind: RuntimeOperationKind): RuntimeSemanticDelta {
  const record = expectRecord(value, 'semantic_delta');
  const kind = expectString(record.kind, 'semantic_delta.kind');
  if (operationKind === 'task-state-transaction') {
    if (kind !== 'task-state') fail('RUNTIME_SCHEMA_INVALID', 'task-state-transaction requires task-state semantic_delta.');
    return validateTaskStateDelta(value);
  }
  if (operationKind === 'lifecycle-transaction') {
    if (kind !== 'lifecycle') fail('RUNTIME_SCHEMA_INVALID', 'lifecycle-transaction requires lifecycle semantic_delta.');
    return validateLifecycleDelta(value);
  }
  if (operationKind === 'archive-transaction') {
    if (kind !== 'archive') fail('RUNTIME_SCHEMA_INVALID', 'archive-transaction requires archive semantic_delta.');
    return validateArchiveDelta(value);
  }
  if (operationKind === 'project-status-transaction') {
    if (kind !== 'project-status') fail('RUNTIME_SCHEMA_INVALID', 'project-status-transaction requires project-status semantic_delta.');
    return validateProjectStatusDelta(value);
  }
  if (operationKind === 'lesson-record-transaction') {
    if (kind !== 'lesson-record') fail('RUNTIME_SCHEMA_INVALID', 'lesson-record-transaction requires lesson-record semantic_delta.');
    return validateLessonRecordDelta(value);
  }
  if (operationKind === 'inbox-record-transaction') {
    if (kind !== 'inbox-record') fail('RUNTIME_SCHEMA_INVALID', 'inbox-record-transaction requires inbox-record semantic_delta.');
    return validateInboxRecordDelta(value);
  }
  if (operationKind === 'contract-candidate-commit') {
    if (kind !== 'knowledge') fail('RUNTIME_SCHEMA_INVALID', 'contract-candidate-commit requires a knowledge semantic_delta.');
    return validateKnowledgeDelta(value, 'contract');
  }
  if (operationKind === 'decision-record-transaction') {
    if (kind !== 'knowledge') fail('RUNTIME_SCHEMA_INVALID', 'decision-record-transaction requires a knowledge semantic_delta.');
    return validateKnowledgeDelta(value, 'decision');
  }
  if (kind !== 'finding-queue') fail('RUNTIME_SCHEMA_INVALID', 'finding-queue-transaction requires finding-queue semantic_delta.');
  return record.action === 'admit' ? validateFindingRecord(value, 'semantic_delta') : validateFindingAction(value);
}

export function validateRuntimeProposal(value: unknown): RuntimeProposal {
  const proposal = expectRecord(value, 'proposal');
  expectExactKeys(
    proposal,
    ['schema_version', 'kind', 'operation_kind', 'caller', 'mode', 'source_tuple', 'authority_evidence', 'semantic_delta', 'preconditions', 'evidence_refs', 'idempotency_key', 'requested_write_targets'],
    'proposal',
  );
  if (proposal.schema_version !== VNEXT_RUNTIME_SCHEMA_VERSION) fail('RUNTIME_SCHEMA_INVALID', 'proposal.schema_version must be 1.');
  if (proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND) fail('RUNTIME_SCHEMA_INVALID', `proposal.kind must be ${VNEXT_RUNTIME_PROPOSAL_KIND}.`);
  const operationKind = expectEnum(proposal.operation_kind, RUNTIME_OPERATION_KINDS, 'proposal.operation_kind');
  const caller = expectEnum(proposal.caller, ['execute-step', 'review-change', 'prepare-task', 'task-lifecycle', 'capture-work-item', 'close-task'], 'proposal.caller');
  const mode = expectEnum(proposal.mode, [...VNEXT_EXECUTE_STEP_MODES, ...PREPARE_TASK_MODES, ...LIFECYCLE_MODES, ...CLOSE_TASK_MODES], 'proposal.mode');
  const sourceTuple = validateSourceTuple(proposal.source_tuple);
  const authorityEvidence = validateAuthorityEvidence(proposal.authority_evidence);
  const preconditions = expectStringArray(proposal.preconditions, 'proposal.preconditions', false, 32);
  const evidenceRefs = validateEvidenceRefs(proposal.evidence_refs, 'proposal.evidence_refs');
  const idempotencyKey = expectString(proposal.idempotency_key, 'proposal.idempotency_key', SAFE_KEY_PATTERN);
  const requestedTargets = expectStringArray(proposal.requested_write_targets, 'proposal.requested_write_targets', false, 4)
    .map((target, index) => normalizeRepoPath(target, `proposal.requested_write_targets[${index}]`));
  const semanticDelta = validateSemanticDelta(proposal.semantic_delta, operationKind);
  const writesTaskBasis = semanticDelta.kind === 'task-state'
    && ['create-draft', 'update-draft', 'commit-replan'].includes(semanticDelta.action);
  const targetCount = writesTaskBasis
    || (operationKind === 'lifecycle-transaction' && mode !== 'supersede')
    || operationKind === 'archive-transaction'
    ? 2
    : 1;
  if (requestedTargets.length !== targetCount) fail('RUNTIME_PATH_INVALID', `This Runtime proposal must name exactly ${targetCount} exact write target${targetCount === 1 ? '' : 's'}.`);
  if (writesTaskBasis) {
    const taskId = semanticDelta.kind === 'task-state'
      && (semanticDelta.action === 'create-draft' || semanticDelta.action === 'update-draft')
      ? semanticDelta.task_id
      : sourceTuple.task_id;
    const expectedBasisPath = taskBasisRelativePath(sourceTuple.path, taskId);
    if (requestedTargets[1] !== expectedBasisPath) {
      fail('RUNTIME_PATH_INVALID', `draft proposal second write target must be the identity-derived task basis ${expectedBasisPath}.`);
    }
  }
  if (operationKind === 'task-state-transaction') {
    if (caller === 'prepare-task') {
      if (mode === 'default') {
        if (semanticDelta.kind !== 'task-state' || !['clear-resume-review-gate', 'create-draft', 'update-draft', ...CLAIM_EVIDENCE_MIGRATION_ACTIONS].includes(semanticDelta.action)) {
          fail('RUNTIME_CALLER_NOT_BOUND', 'prepare-task default mode is bound only to clear-resume-review-gate, create-draft, update-draft, or migrate-claim-evidence.');
        }
        if (semanticDelta.kind === 'task-state' && semanticDelta.action === 'migrate-claim-evidence') {
          const requiredPreconditions = ['current-task-is-active', 'legacy-claim-evidence-state', 'acceptance-bearing-plan'];
          const missingPreconditions = requiredPreconditions.filter(precondition => !preconditions.includes(precondition));
          if (missingPreconditions.length > 0) fail('RUNTIME_PRECONDITION_MISSING', `migrate-claim-evidence is missing required preconditions: ${missingPreconditions.join(', ')}.`);
        }
      } else if (mode === 'confirm') {
        if (semanticDelta.kind !== 'task-state' || semanticDelta.action !== 'confirm-draft') {
          fail('RUNTIME_CALLER_NOT_BOUND', 'prepare-task confirm mode is bound only to confirm-draft.');
        }
      } else if (mode === 'replan') {
        if (semanticDelta.kind !== 'task-state' || !REPLAN_TASK_STATE_ACTIONS.includes(semanticDelta.action as ReplanTaskStateAction)) {
          fail('RUNTIME_CALLER_NOT_BOUND', 'prepare-task replan mode is bound only to the closed replan task-state action set.');
        }
      } else {
        fail('RUNTIME_MODE_INVALID', 'prepare-task task-state proposals must use default, confirm, or replan mode.');
      }
    } else if (caller === 'review-change') {
      if (mode !== 'default') fail('RUNTIME_MODE_INVALID', 'review-change task-state proposals must use default mode.');
      if (semanticDelta.kind !== 'task-state' || !['record-review-result', 'record-evidence-challenge', 'dismiss-evidence-challenge'].includes(semanticDelta.action)) {
        fail('RUNTIME_CALLER_NOT_BOUND', 'review-change is bound only to review results and evidence challenge assessment.');
      }
    } else if (caller === 'execute-step') {
      if (!VNEXT_EXECUTE_STEP_MODES.includes(mode as VNextExecuteStepMode)) fail('RUNTIME_MODE_INVALID', 'execute-step task-state proposals must use default or repair mode.');
      if (semanticDelta.kind !== 'task-state' || !['step-progress', 'record-step-preflight', 'retry-step'].includes(semanticDelta.action)) fail('RUNTIME_MODE_INVALID', 'execute-step requires an execution task-state delta.');
    } else {
      fail('RUNTIME_CALLER_NOT_BOUND', 'task-state-transaction is not bound to task-lifecycle.');
    }
  } else if (operationKind === 'finding-queue-transaction') {
    if (caller !== 'execute-step' || mode !== 'repair') fail('RUNTIME_CALLER_NOT_BOUND', 'finding-queue-transaction is bound only to execute-step:repair.');
    if (semanticDelta.kind !== 'finding-queue') fail('RUNTIME_MODE_INVALID', 'repair mode requires a finding-queue proposal.');
  } else if (operationKind === 'lifecycle-transaction') {
    if (caller !== 'task-lifecycle' || !LIFECYCLE_MODES.includes(mode as LifecycleMode)) fail('RUNTIME_CALLER_NOT_BOUND', 'lifecycle-transaction is bound only to task-lifecycle lifecycle modes.');
    if (semanticDelta.kind !== 'lifecycle' || semanticDelta.action !== mode) fail('RUNTIME_MODE_INVALID', 'lifecycle mode and semantic transition must match.');
  } else if (operationKind === 'inbox-record-transaction') {
    if (caller !== 'capture-work-item' || mode !== 'default') fail('RUNTIME_CALLER_NOT_BOUND', 'inbox-record-transaction is bound only to capture-work-item:record with default mode.');
    if (semanticDelta.kind !== 'inbox-record' || semanticDelta.action !== 'record') fail('RUNTIME_MODE_INVALID', 'inbox-record-transaction requires a record inbox semantic_delta.');
    const missingPreconditions = INBOX_CAPTURE_PRECONDITIONS.filter(precondition => !preconditions.includes(precondition));
    if (missingPreconditions.length > 0) fail('RUNTIME_PRECONDITION_MISSING', `capture-work-item is missing required preconditions: ${missingPreconditions.join(', ')}.`);
  } else if (operationKind === 'contract-candidate-commit' || operationKind === 'decision-record-transaction') {
    if (caller !== 'close-task' || mode !== 'default') fail('RUNTIME_CALLER_NOT_BOUND', `${operationKind} is bound only to close-task default closure.`);
    if (semanticDelta.kind !== 'knowledge' || semanticDelta.knowledge_kind !== (operationKind === 'contract-candidate-commit' ? 'contract' : 'decision')) {
      fail('RUNTIME_MODE_INVALID', `${operationKind} requires a matching knowledge semantic_delta.`);
    }
    const requiredPreconditions = ['archive-committed', 'knowledge-admission-complete', 'canonical-knowledge-target'];
    const missingPreconditions = requiredPreconditions.filter(precondition => !preconditions.includes(precondition));
    if (missingPreconditions.length > 0) fail('RUNTIME_PRECONDITION_MISSING', `${operationKind} is missing required preconditions: ${missingPreconditions.join(', ')}.`);
  } else {
    if (caller !== 'close-task' || !CLOSE_TASK_MODES.includes(mode as CloseTaskMode)) {
      fail('RUNTIME_CALLER_NOT_BOUND', `${operationKind} is bound only to close-task default closure.`);
    }
    const expectedKind = operationKind === 'archive-transaction'
      ? 'archive'
      : operationKind === 'project-status-transaction'
        ? 'project-status'
        : 'lesson-record';
    if (semanticDelta.kind !== expectedKind) fail('RUNTIME_MODE_INVALID', `${operationKind} requires a ${expectedKind} semantic_delta.`);
  }
  const result: RuntimeProposal = {
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: operationKind,
    caller,
    mode,
    source_tuple: sourceTuple,
    authority_evidence: authorityEvidence,
    semantic_delta: semanticDelta,
    preconditions,
    evidence_refs: evidenceRefs,
    idempotency_key: idempotencyKey,
    requested_write_targets: requestedTargets,
  };
  const deltaRefs = semanticDelta.kind === 'task-state'
    ? semanticDelta.evidence_refs
    : semanticDelta.kind === 'finding-queue'
      ? semanticDelta.action === 'admit' ? semanticDelta.finding.evidence_refs : semanticDelta.evidence_refs
      : semanticDelta.evidence_refs;
  const claimRefs = semanticDelta.kind === 'task-state' && 'claim_evidence' in semanticDelta && semanticDelta.claim_evidence !== undefined
    ? claimEvidenceRefs(semanticDelta.claim_evidence)
    : [];
  const reviewReceiptRefs = semanticDelta.kind === 'task-state'
    && semanticDelta.action === 'step-progress'
    && semanticDelta.review_receipt
    ? semanticDelta.review_receipt.evidence_refs
    : [];
  if (![...deltaRefs, ...reviewReceiptRefs, ...claimRefs].every(ref => evidenceRefs.includes(ref))) {
    fail('RUNTIME_EVIDENCE_INVALID', 'proposal.evidence_refs must cover semantic_delta evidence_refs.');
  }
  return result;
}

function validateFinding(value: unknown, location: string): FindingRecord {
  const finding = expectRecord(value, location);
  expectExactKeys(
    finding,
    ['fingerprint', 'category', 'owner_task_id', 'scope', 'decision', 'file', 'failure_condition', 'violated_invariant', 'root_cause_status', 'status', 'repair_attempts', 'max_repair_attempts', 'evidence_refs', 'review_cycle_id', 'last_repair_wave_id', 'admitted_at', 'updated_at'],
    location,
  );
  return {
    fingerprint: expectString(finding.fingerprint, `${location}.fingerprint`, FINGERPRINT_PATTERN),
    category: expectText(finding.category, `${location}.category`, 256),
    owner_task_id: expectString(finding.owner_task_id, `${location}.owner_task_id`),
    scope: expectEnum(finding.scope, ['admitted'], `${location}.scope`),
    decision: expectEnum(finding.decision, ['mechanical'], `${location}.decision`),
    file: normalizeRepoPath(expectString(finding.file, `${location}.file`), `${location}.file`),
    failure_condition: expectText(finding.failure_condition, `${location}.failure_condition`),
    violated_invariant: expectText(finding.violated_invariant, `${location}.violated_invariant`, 512),
    root_cause_status: expectEnum(finding.root_cause_status, ['confirmed', 'bounded'], `${location}.root_cause_status`),
    status: expectEnum(finding.status, FINDING_STATUSES, `${location}.status`),
    repair_attempts: expectInteger(finding.repair_attempts, `${location}.repair_attempts`, 0, MAX_REPAIR_ATTEMPTS),
    max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.max_repair_attempts`, 1, MAX_REPAIR_ATTEMPTS),
    evidence_refs: validateEvidenceRefs(finding.evidence_refs, `${location}.evidence_refs`),
    review_cycle_id: expectString(finding.review_cycle_id, `${location}.review_cycle_id`, SAFE_KEY_PATTERN),
    last_repair_wave_id: expectNullableString(finding.last_repair_wave_id, `${location}.last_repair_wave_id`, SAFE_KEY_PATTERN),
    admitted_at: expectString(finding.admitted_at, `${location}.admitted_at`),
    updated_at: expectString(finding.updated_at, `${location}.updated_at`),
  };
}

function validateReviewCycle(value: unknown, location = 'runtime_state.review_cycle'): ReviewCycleState {
  const reviewCycle = expectRecord(value, location);
  expectExactKeys(reviewCycle, [...REVIEW_CYCLE_FIELDS], location);
  const id = expectString(reviewCycle.id, `${location}.id`, SAFE_KEY_PATTERN);
  const cyclePhase = expectEnum(reviewCycle.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`);
  const repairRound = expectInteger(reviewCycle.repair_round, `${location}.repair_round`, 0, MAX_REPAIR_ROUNDS);
  const countedRepairWaveIds = expectStringArray(reviewCycle.counted_repair_wave_ids, `${location}.counted_repair_wave_ids`, true, MAX_REPAIR_ROUNDS);
  if (new Set(countedRepairWaveIds).size !== countedRepairWaveIds.length) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.counted_repair_wave_ids must be unique.`);
  }
  if (repairRound !== countedRepairWaveIds.length) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.repair_round must equal the number of counted repair waves.`);
  }
  const activeRepairWaveId = expectNullableString(reviewCycle.active_repair_wave_id, `${location}.active_repair_wave_id`, SAFE_KEY_PATTERN);
  if (activeRepairWaveId !== null && !countedRepairWaveIds.includes(activeRepairWaveId)) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.active_repair_wave_id must be one of counted_repair_wave_ids.`);
  }
  if (activeRepairWaveId !== null && countedRepairWaveIds[countedRepairWaveIds.length - 1] !== activeRepairWaveId) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.active_repair_wave_id must be the latest counted repair wave.`);
  }
  const verificationNewFindingWaveUsed = expectBoolean(reviewCycle.verification_new_finding_wave_used, `${location}.verification_new_finding_wave_used`);
  const verificationNewFindingWaveId = expectNullableString(reviewCycle.verification_new_finding_wave_id, `${location}.verification_new_finding_wave_id`, SAFE_KEY_PATTERN);
  if (!verificationNewFindingWaveUsed && verificationNewFindingWaveId !== null) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.verification_new_finding_wave_id must be null before the verification admission wave is used.`);
  }
  if (verificationNewFindingWaveId !== null && activeRepairWaveId !== null) {
    fail('RUNTIME_STATE_CONFLICT', `${location}.verification_new_finding_wave_id cannot remain open while a repair wave is active.`);
  }
  if (verificationNewFindingWaveUsed && cyclePhase !== 'verification') {
    fail('RUNTIME_STATE_CONFLICT', `${location}.cycle_phase must be verification after the verification admission wave is used.`);
  }
  return {
    id,
    cycle_phase: cyclePhase,
    repair_round: repairRound,
    counted_repair_wave_ids: countedRepairWaveIds,
    active_repair_wave_id: activeRepairWaveId,
    verification_new_finding_wave_used: verificationNewFindingWaveUsed,
    verification_new_finding_wave_id: verificationNewFindingWaveId,
  };
}

function validateArchiveAuditLogEntry(value: AnyRecord, location: string, taskId: string, taskSlug: string): ArchiveAuditLogEntry {
  const archiveAuditKeys = [
    'action', 'idempotency_key', 'operation_kind', 'caller', 'mode', 'task_id', 'task_slug',
    'document_id', 'from_workflow_status', 'from_lifecycle_state', 'to_workflow_status',
    'to_lifecycle_state', 'source_revision', 'archive_path', 'archive_revision',
    'closure_delta_digest', 'authority_evidence', 'evidence_refs', 'lesson_admission', 'knowledge_admissions', 'recorded_at',
  ] as const;
  const missingArchiveAuditKeys = archiveAuditKeys.filter(key => key !== 'knowledge_admissions' && !(key in value));
  const extraArchiveAuditKeys = Object.keys(value).filter(key => !archiveAuditKeys.includes(key as typeof archiveAuditKeys[number]));
  if (missingArchiveAuditKeys.length > 0 || extraArchiveAuditKeys.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} keys mismatch; missing=[${missingArchiveAuditKeys.join(', ')}], unexpected=[${extraArchiveAuditKeys.join(', ')}].`);
  }
  const entryTaskId = expectString(value.task_id, `${location}.task_id`);
  const entryTaskSlug = expectString(value.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(entryTaskId);
    validateTaskSlug(entryTaskSlug);
  } catch (error) {
    fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
  }
  if (entryTaskId !== taskId || entryTaskSlug !== taskSlug) fail('RUNTIME_STATE_CONFLICT', `${location} identity does not match runtime_state.`);
  const documentId = expectString(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', `${location}.document_id is invalid.`);
  const sourceRevision = expectString(value.source_revision, `${location}.source_revision`);
  const archiveRevision = expectString(value.archive_revision, `${location}.archive_revision`);
  const closureDeltaDigest = expectString(value.closure_delta_digest, `${location}.closure_delta_digest`);
  if (!/^[a-f0-9]{64}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(archiveRevision) || !/^[a-f0-9]{64}$/.test(closureDeltaDigest)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} revisions and digest must be SHA-256.`);
  }
  const archivePath = normalizeRepoPath(expectString(value.archive_path, `${location}.archive_path`), `${location}.archive_path`);
  if (!/^TASKS\/TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(archivePath)) {
    fail('RUNTIME_PATH_INVALID', `${location}.archive_path must be a canonical task archive path.`);
  }
  if (value.action !== 'archive' || value.operation_kind !== 'archive-transaction' || value.caller !== 'close-task' || value.mode !== 'default') {
    fail('RUNTIME_STATE_CONFLICT', `${location} archive audit has an invalid operation binding.`);
  }
  if (value.from_workflow_status !== 'active' || value.from_lifecycle_state !== 'active' || value.to_workflow_status !== 'closed' || value.to_lifecycle_state !== 'archived') {
    fail('RUNTIME_STATE_CONFLICT', `${location} archive audit has an invalid terminal transition.`);
  }
  return {
    action: 'archive',
    idempotency_key: expectString(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
    operation_kind: 'archive-transaction',
    caller: 'close-task',
    mode: 'default',
    task_id: entryTaskId,
    task_slug: entryTaskSlug,
    document_id: documentId,
    from_workflow_status: 'active',
    from_lifecycle_state: 'active',
    to_workflow_status: 'closed',
    to_lifecycle_state: 'archived',
    source_revision: sourceRevision,
    archive_path: archivePath,
    archive_revision: archiveRevision,
    closure_delta_digest: closureDeltaDigest,
    authority_evidence: validateAuthorityEvidence(value.authority_evidence),
    evidence_refs: validateEvidenceRefs(value.evidence_refs, `${location}.evidence_refs`),
    lesson_admission: validateLessonAdmission(value.lesson_admission, `${location}.lesson_admission`),
    // vNext schema_version 1 archives predating knowledge promotion do not
    // have this field. They cannot contain Contract/Decision admissions, so
    // normalize the historical shape to the empty bundle at read time.
    knowledge_admissions: value.knowledge_admissions === undefined
      ? emptyKnowledgeAdmissionBundle()
      : validateKnowledgeAdmissionBundle(value.knowledge_admissions, `${location}.knowledge_admissions`),
    recorded_at: expectString(value.recorded_at, `${location}.recorded_at`),
  };
}

function validateDraftAuditLogEntry(value: AnyRecord, location: string, taskId: string, taskSlug: string): DraftAuditLogEntry {
  const action = expectEnum(value.action, DRAFT_AUDIT_ACTIONS, `${location}.action`);
  const requiredKeys = [
    'action', 'idempotency_key', 'operation_kind', 'caller', 'mode', 'from_task_id', 'from_task_slug',
    'from_document_id', 'task_id', 'task_slug', 'document_id', 'from_workflow_status',
    'from_lifecycle_state', 'to_workflow_status', 'to_lifecycle_state', 'source_revision',
    'authority_evidence', 'evidence_refs', 'recorded_at',
  ];
  const conditionalKeys = action === 'confirm-draft' ? ['draft_revision'] : ['definition_digest', 'claim_evidence_digest'];
  const requiredConditionalKeys = action === 'confirm-draft' ? ['draft_revision'] : ['definition_digest'];
  const extra = Object.keys(value).filter(key => !requiredKeys.includes(key) && !conditionalKeys.includes(key));
  const missing = [...requiredKeys, ...requiredConditionalKeys].filter(key => !(key in value));
  if (missing.length > 0 || extra.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} audit keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
  }
  const fromTaskId = expectString(value.from_task_id, `${location}.from_task_id`);
  const fromTaskSlug = expectString(value.from_task_slug, `${location}.from_task_slug`);
  const entryTaskId = expectString(value.task_id, `${location}.task_id`);
  const entryTaskSlug = expectString(value.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(fromTaskId);
    validateTaskSlug(fromTaskSlug);
    validateTaskId(entryTaskId);
    validateTaskSlug(entryTaskSlug);
  } catch (error) {
    fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
  }
  if (entryTaskId !== taskId || entryTaskSlug !== taskSlug) fail('RUNTIME_STATE_CONFLICT', `${location} target identity does not match runtime_state.`);
  const fromDocumentId = expectString(value.from_document_id, `${location}.from_document_id`);
  const documentId = expectString(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(fromDocumentId) || !DOCUMENT_ID_PATTERN.test(documentId)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.document_id fields are invalid.`);
  }
  const fromWorkflowStatus = expectEnum(value.from_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.from_workflow_status`);
  const fromLifecycleState = expectEnum(value.from_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.from_lifecycle_state`);
  const toWorkflowStatus = expectEnum(value.to_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.to_workflow_status`);
  const toLifecycleState = expectEnum(value.to_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.to_lifecycle_state`);
  try {
    validateCurrentTaskStatusTuple(fromWorkflowStatus, fromLifecycleState);
    validateCurrentTaskStatusTuple(toWorkflowStatus, toLifecycleState);
  } catch (error) {
    fail('RUNTIME_STATE_CONFLICT', error instanceof Error ? error.message : String(error));
  }
  const sourceRevision = expectString(value.source_revision, `${location}.source_revision`);
  if (!/^[a-f0-9]{64}$/.test(sourceRevision)) fail('RUNTIME_SCHEMA_INVALID', `${location}.source_revision must be SHA-256.`);
  const authorityEvidence = validateAuthorityEvidence(value.authority_evidence);
  const evidenceRefs = validateEvidenceRefs(value.evidence_refs, `${location}.evidence_refs`);
  const recordedAt = expectString(value.recorded_at, `${location}.recorded_at`);
  if (action === 'create-draft' || action === 'update-draft') {
    if (value.operation_kind !== 'task-state-transaction' || value.caller !== 'prepare-task' || value.mode !== 'default') {
      fail('RUNTIME_STATE_CONFLICT', `${location} ${action} audit has an invalid operation binding.`);
    }
    const expectedFromIdentity = action === 'create-draft'
      ? ['closed', 'archived']
      : ['draft', 'active'];
    if (fromWorkflowStatus !== expectedFromIdentity[0] || fromLifecycleState !== expectedFromIdentity[1] || toWorkflowStatus !== 'draft' || toLifecycleState !== 'active') {
      fail('RUNTIME_STATE_CONFLICT', `${location} ${action} audit has an invalid transition.`);
    }
    const definitionDigest = expectString(value.definition_digest, `${location}.definition_digest`);
    if (!/^[a-f0-9]{64}$/.test(definitionDigest)) fail('RUNTIME_SCHEMA_INVALID', `${location}.definition_digest must be SHA-256.`);
    const claimEvidenceDigest = value.claim_evidence_digest === undefined
      ? undefined
      : expectString(value.claim_evidence_digest, `${location}.claim_evidence_digest`);
    if (claimEvidenceDigest !== undefined && !/^[a-f0-9]{64}$/.test(claimEvidenceDigest)) fail('RUNTIME_SCHEMA_INVALID', `${location}.claim_evidence_digest must be SHA-256.`);
    return {
      action,
      idempotency_key: expectString(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
      operation_kind: 'task-state-transaction',
      caller: 'prepare-task',
      mode: 'default',
      from_task_id: fromTaskId,
      from_task_slug: fromTaskSlug,
      from_document_id: fromDocumentId,
      task_id: entryTaskId,
      task_slug: entryTaskSlug,
      document_id: documentId,
      from_workflow_status: fromWorkflowStatus,
      from_lifecycle_state: fromLifecycleState,
      to_workflow_status: 'draft',
      to_lifecycle_state: 'active',
      source_revision: sourceRevision,
      authority_evidence: authorityEvidence,
      evidence_refs: evidenceRefs,
      definition_digest: definitionDigest,
      ...(claimEvidenceDigest === undefined ? {} : { claim_evidence_digest: claimEvidenceDigest }),
      recorded_at: recordedAt,
    };
  }
  if (value.operation_kind !== 'task-state-transaction' || value.caller !== 'prepare-task' || value.mode !== 'confirm') {
    fail('RUNTIME_STATE_CONFLICT', `${location} confirm-draft audit has an invalid operation binding.`);
  }
  if (fromWorkflowStatus !== 'draft' || fromLifecycleState !== 'active' || toWorkflowStatus !== 'active' || toLifecycleState !== 'active') {
    fail('RUNTIME_STATE_CONFLICT', `${location} confirm-draft audit has an invalid transition.`);
  }
  const draftRevision = expectString(value.draft_revision, `${location}.draft_revision`);
  if (!/^[a-f0-9]{64}$/.test(draftRevision)) fail('RUNTIME_SCHEMA_INVALID', `${location}.draft_revision must be SHA-256.`);
  return {
    action: 'confirm-draft',
    idempotency_key: expectString(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: 'confirm',
    from_task_id: fromTaskId,
    from_task_slug: fromTaskSlug,
    from_document_id: fromDocumentId,
    task_id: entryTaskId,
    task_slug: entryTaskSlug,
    document_id: documentId,
    from_workflow_status: 'draft',
    from_lifecycle_state: 'active',
    to_workflow_status: 'active',
    to_lifecycle_state: 'active',
    source_revision: sourceRevision,
    authority_evidence: authorityEvidence,
    evidence_refs: evidenceRefs,
    draft_revision: draftRevision,
    recorded_at: recordedAt,
  };
}

function validateClaimEvidenceMigrationAuditLogEntry(value: AnyRecord, location: string, taskId: string, taskSlug: string): ClaimEvidenceMigrationAuditLogEntry {
  expectExactKeys(
    value,
    [
      'action', 'idempotency_key', 'operation_kind', 'caller', 'mode', 'from_task_id', 'from_task_slug',
      'from_document_id', 'task_id', 'task_slug', 'document_id', 'from_workflow_status',
      'from_lifecycle_state', 'to_workflow_status', 'to_lifecycle_state', 'source_revision',
      'authority_evidence', 'evidence_refs', 'claim_evidence_digest', 'recorded_at',
    ],
    location,
  );
  if (value.action !== 'migrate-claim-evidence' || value.operation_kind !== 'task-state-transaction' || value.caller !== 'prepare-task' || value.mode !== 'default') {
    fail('RUNTIME_STATE_CONFLICT', `${location} claim evidence migration audit has an invalid operation binding.`);
  }
  const fromTaskId = expectString(value.from_task_id, `${location}.from_task_id`);
  const fromTaskSlug = expectString(value.from_task_slug, `${location}.from_task_slug`);
  const entryTaskId = expectString(value.task_id, `${location}.task_id`);
  const entryTaskSlug = expectString(value.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(fromTaskId);
    validateTaskSlug(fromTaskSlug);
    validateTaskId(entryTaskId);
    validateTaskSlug(entryTaskSlug);
  } catch (error) {
    fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
  }
  if (entryTaskId !== taskId || entryTaskSlug !== taskSlug) fail('RUNTIME_STATE_CONFLICT', `${location} target identity does not match runtime_state.`);
  if (fromTaskId !== entryTaskId || fromTaskSlug !== entryTaskSlug) fail('RUNTIME_STATE_CONFLICT', `${location} migration must preserve task identity.`);
  const fromDocumentId = expectString(value.from_document_id, `${location}.from_document_id`);
  const documentId = expectString(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(fromDocumentId) || !DOCUMENT_ID_PATTERN.test(documentId)) {
    fail('RUNTIME_SCHEMA_INVALID', `${location}.document_id fields are invalid.`);
  }
  if (fromDocumentId !== documentId) fail('RUNTIME_STATE_CONFLICT', `${location} migration must preserve document_id.`);
  if (value.from_workflow_status !== 'active' || value.from_lifecycle_state !== 'active' || value.to_workflow_status !== 'active' || value.to_lifecycle_state !== 'active') {
    fail('RUNTIME_STATE_CONFLICT', `${location} migration must preserve the active + active lifecycle tuple.`);
  }
  const sourceRevision = expectString(value.source_revision, `${location}.source_revision`);
  if (!SHA256_PATTERN.test(sourceRevision)) fail('RUNTIME_SCHEMA_INVALID', `${location}.source_revision must be SHA-256.`);
  const authorityEvidence = validateAuthorityEvidence(value.authority_evidence);
  const evidenceRefs = validateEvidenceRefs(value.evidence_refs, `${location}.evidence_refs`);
  const claimEvidenceDigest = expectString(value.claim_evidence_digest, `${location}.claim_evidence_digest`);
  if (!SHA256_PATTERN.test(claimEvidenceDigest)) fail('RUNTIME_SCHEMA_INVALID', `${location}.claim_evidence_digest must be SHA-256.`);
  return {
    action: 'migrate-claim-evidence',
    idempotency_key: expectString(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: 'default',
    from_task_id: fromTaskId,
    from_task_slug: fromTaskSlug,
    from_document_id: fromDocumentId,
    task_id: entryTaskId,
    task_slug: entryTaskSlug,
    document_id: documentId,
    from_workflow_status: 'active',
    from_lifecycle_state: 'active',
    to_workflow_status: 'active',
    to_lifecycle_state: 'active',
    source_revision: sourceRevision,
    authority_evidence: authorityEvidence,
    evidence_refs: evidenceRefs,
    claim_evidence_digest: claimEvidenceDigest,
    recorded_at: expectString(value.recorded_at, `${location}.recorded_at`),
  };
}

function validateExecutionLogEntry(value: unknown, location: string, taskId: string, taskSlug: string): ExecutionLogEntry {
  const record = expectRecord(value, location);
  if (record.action === 'migrate-claim-evidence') return validateClaimEvidenceMigrationAuditLogEntry(record, location, taskId, taskSlug);
  if (DRAFT_AUDIT_ACTIONS.includes(record.action as DraftAuditAction)) return validateDraftAuditLogEntry(record, location, taskId, taskSlug);
  if (record.action === 'archive') return validateArchiveAuditLogEntry(record, location, taskId, taskSlug);
  if ('action' in record) {
    const requiredKeys = [
      'action', 'idempotency_key', 'operation_kind', 'caller', 'mode', 'task_id', 'task_slug',
      'document_id', 'from_workflow_status', 'from_lifecycle_state', 'to_workflow_status',
      'to_lifecycle_state', 'source_revision', 'authority_evidence', 'evidence_refs', 'recorded_at',
    ];
    const optionalKeys = ['partial_diff_disposition', 'invalidation_kind', 'invalidation_reason', 'candidate_digest', 'correction_reason'];
    const missing = requiredKeys.filter(key => !(key in record));
    const extra = Object.keys(record).filter(key => !requiredKeys.includes(key) && !optionalKeys.includes(key));
    if (missing.length > 0 || extra.length > 0) {
      fail('RUNTIME_SCHEMA_INVALID', `${location} audit keys mismatch; missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}].`);
    }
    const action = expectEnum(record.action, REPLAN_AUDIT_ACTIONS, `${location}.action`);
    const operationKind = expectEnum(record.operation_kind, ['task-state-transaction', 'lifecycle-transaction'], `${location}.operation_kind`);
    const caller = expectEnum(record.caller, ['prepare-task', 'task-lifecycle'], `${location}.caller`);
    const mode = expectString(record.mode, `${location}.mode`);
    const entryTaskId = expectString(record.task_id, `${location}.task_id`);
    const entryTaskSlug = expectString(record.task_slug, `${location}.task_slug`);
    const documentId = expectString(record.document_id, `${location}.document_id`);
    if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', `${location}.document_id is invalid.`);
    try {
      validateTaskId(entryTaskId);
      validateTaskSlug(entryTaskSlug);
    } catch (error) {
      fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
    }
    if (entryTaskId !== taskId || entryTaskSlug !== taskSlug) fail('RUNTIME_STATE_CONFLICT', `${location} identity does not match runtime_state.`);
    const fromWorkflowStatus = expectEnum(record.from_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.from_workflow_status`);
    const fromLifecycleState = expectEnum(record.from_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.from_lifecycle_state`);
    const toWorkflowStatus = expectEnum(record.to_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.to_workflow_status`);
    const toLifecycleState = expectEnum(record.to_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.to_lifecycle_state`);
    try {
      validateCurrentTaskStatusTuple(fromWorkflowStatus, fromLifecycleState);
      validateCurrentTaskStatusTuple(toWorkflowStatus, toLifecycleState);
    } catch (error) {
      fail('RUNTIME_STATE_CONFLICT', error instanceof Error ? error.message : String(error));
    }
    const sourceRevision = expectString(record.source_revision, `${location}.source_revision`);
    if (!/^[a-f0-9]{64}$/.test(sourceRevision)) fail('RUNTIME_SCHEMA_INVALID', `${location}.source_revision must be SHA-256.`);
    const authorityEvidence = validateAuthorityEvidence(record.authority_evidence);
    const evidenceRefs = validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`);
    const recordedAt = expectString(record.recorded_at, `${location}.recorded_at`);

    if (action === 'supersede') {
      if (record.candidate_digest !== undefined || record.correction_reason !== undefined) fail('RUNTIME_SCHEMA_INVALID', `${location} supersede audit cannot bind a correction candidate.`);
      if (operationKind !== 'lifecycle-transaction' || caller !== 'task-lifecycle' || mode !== 'supersede') {
        fail('RUNTIME_STATE_CONFLICT', `${location} supersede audit has an invalid operation binding.`);
      }
      if (!['active', 'blocked_by_replan'].includes(fromWorkflowStatus) || fromLifecycleState !== 'active' || toWorkflowStatus !== 'superseded' || toLifecycleState !== 'active') {
        fail('RUNTIME_STATE_CONFLICT', `${location} supersede audit has an invalid transition.`);
      }
      if (record.partial_diff_disposition === undefined || record.invalidation_kind === undefined || record.invalidation_reason === undefined) {
        fail('RUNTIME_SCHEMA_INVALID', `${location} supersede audit must preserve invalidation and partial-diff evidence.`);
      }
      const partialDiffDisposition = validatePartialDiffDisposition(record.partial_diff_disposition, `${location}.partial_diff_disposition`);
      const invalidationKind = expectEnum(record.invalidation_kind, ['goal', 'scope', 'acceptance'], `${location}.invalidation_kind`);
      const invalidationReason = expectText(record.invalidation_reason, `${location}.invalidation_reason`);
      return {
        action,
        idempotency_key: expectString(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
        operation_kind: operationKind,
        caller,
        mode: 'supersede',
        task_id: entryTaskId,
        task_slug: entryTaskSlug,
        document_id: documentId,
        from_workflow_status: fromWorkflowStatus,
        from_lifecycle_state: fromLifecycleState,
        to_workflow_status: toWorkflowStatus,
        to_lifecycle_state: toLifecycleState,
        source_revision: sourceRevision,
        authority_evidence: authorityEvidence,
        evidence_refs: evidenceRefs,
        partial_diff_disposition: partialDiffDisposition,
        invalidation_kind: invalidationKind,
        invalidation_reason: invalidationReason,
        recorded_at: recordedAt,
      };
    }

    if (operationKind !== 'task-state-transaction' || caller !== 'prepare-task' || mode !== 'replan') {
      fail('RUNTIME_STATE_CONFLICT', `${location} replan audit has an invalid operation binding.`);
    }
    if (record.partial_diff_disposition !== undefined || record.invalidation_kind !== undefined || record.invalidation_reason !== undefined) {
      fail('RUNTIME_SCHEMA_INVALID', `${location} non-supersede audit must not carry supersede-only evidence.`);
    }
    const candidateDigest = record.candidate_digest === undefined ? undefined : expectString(record.candidate_digest, `${location}.candidate_digest`, /^[a-f0-9]{64}$/);
    if (action !== 'commit-replan' && candidateDigest !== undefined) fail('RUNTIME_SCHEMA_INVALID', `${location} candidate digest belongs only to confirmed replans.`);
    const correctionReason = record.correction_reason === undefined ? undefined : expectText(record.correction_reason, `${location}.correction_reason`, 1024);
    if ((candidateDigest === undefined) !== (correctionReason === undefined)) fail('RUNTIME_SCHEMA_INVALID', `${location} correction reason must bind an exact candidate digest.`);
    const expectedTransition = action === 'mark-replan-blocked'
      ? ['active', 'active', 'blocked_by_replan', 'active']
      : action === 'clear-replan-block'
        ? ['blocked_by_replan', 'active', 'active', 'active']
        : ['superseded', 'active', 'active', 'active'];
    const activeCorrection = action === 'commit-replan' && candidateDigest !== undefined
      && ['active', 'blocked_by_replan'].includes(fromWorkflowStatus) && fromLifecycleState === 'active' && toWorkflowStatus === 'active' && toLifecycleState === 'active';
    if (!activeCorrection && (fromWorkflowStatus !== expectedTransition[0] || fromLifecycleState !== expectedTransition[1] || toWorkflowStatus !== expectedTransition[2] || toLifecycleState !== expectedTransition[3])) {
      fail('RUNTIME_STATE_CONFLICT', `${location} replan audit has an invalid transition.`);
    }
    return {
      action,
      idempotency_key: expectString(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
      operation_kind: operationKind,
      caller,
      mode: 'replan',
      task_id: entryTaskId,
      task_slug: entryTaskSlug,
      document_id: documentId,
      from_workflow_status: fromWorkflowStatus,
      from_lifecycle_state: fromLifecycleState,
      to_workflow_status: toWorkflowStatus,
      to_lifecycle_state: toLifecycleState,
      source_revision: sourceRevision,
      authority_evidence: authorityEvidence,
      evidence_refs: evidenceRefs,
      ...(candidateDigest === undefined ? {} : { candidate_digest: candidateDigest }),
      ...(correctionReason === undefined ? {} : { correction_reason: correctionReason }),
      recorded_at: recordedAt,
    };
  }

  const executionLogKeys = [
    'idempotency_key',
    'mode',
    'step_id',
    'status',
    'evidence_refs',
    'note',
    'repair_fingerprint',
    'repair_fingerprints',
    'repair_wave_id',
    'change_set_id',
    'checkpoint',
    'advancement',
    'next_step_id',
    'review_receipt',
    'claim_evidence',
    'execution_result',
    'recorded_at',
  ];
  const optionalExecutionLogKeys = ['note', 'repair_fingerprint', 'repair_fingerprints', 'repair_wave_id', 'change_set_id', 'checkpoint', 'advancement', 'next_step_id', 'review_receipt', 'claim_evidence', 'execution_result'];
  const missingExecutionLogKeys = executionLogKeys.filter(key => !optionalExecutionLogKeys.includes(key) && !(key in record));
  const extraExecutionLogKeys = Object.keys(record).filter(key => !executionLogKeys.includes(key));
  if (missingExecutionLogKeys.length > 0 || extraExecutionLogKeys.length > 0) fail('RUNTIME_SCHEMA_INVALID', `${location} keys mismatch; missing=[${missingExecutionLogKeys.join(', ')}], unexpected=[${extraExecutionLogKeys.join(', ')}].`);
  const result: StepExecutionLogEntry = {
    idempotency_key: expectString(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
    mode: expectEnum(record.mode, VNEXT_EXECUTE_STEP_MODES, `${location}.mode`),
    step_id: expectString(record.step_id, `${location}.step_id`, STEP_ID_PATTERN),
    status: expectEnum(record.status, STEP_STATUSES, `${location}.status`),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
    recorded_at: expectString(record.recorded_at, `${location}.recorded_at`),
  };
  if (record.note !== undefined && record.note !== null) result.note = expectText(record.note, `${location}.note`);
  if (record.repair_fingerprint !== undefined) {
    result.repair_fingerprint = expectString(record.repair_fingerprint, `${location}.repair_fingerprint`, FINGERPRINT_PATTERN);
    if (result.mode !== 'repair') fail('RUNTIME_STATE_CONFLICT', `${location}.repair_fingerprint is only valid for repair execution records.`);
  }
  if (record.repair_fingerprints !== undefined) {
    result.repair_fingerprints = expectStringArray(record.repair_fingerprints, `${location}.repair_fingerprints`, false, MAX_FINDINGS)
      .map((fingerprint, index) => expectString(fingerprint, `${location}.repair_fingerprints[${index}]`, FINGERPRINT_PATTERN));
    if (new Set(result.repair_fingerprints).size !== result.repair_fingerprints.length) fail('RUNTIME_SCHEMA_INVALID', `${location}.repair_fingerprints must be unique.`);
    if (result.mode !== 'repair') fail('RUNTIME_STATE_CONFLICT', `${location}.repair_fingerprints is only valid for repair execution records.`);
  }
  if (record.repair_wave_id !== undefined) result.repair_wave_id = expectString(record.repair_wave_id, `${location}.repair_wave_id`, SAFE_KEY_PATTERN);
  if (result.repair_fingerprint !== undefined && result.repair_fingerprints !== undefined) fail('RUNTIME_STATE_CONFLICT', `${location} must not mix legacy and grouped repair fingerprints.`);
  if ((result.repair_fingerprints !== undefined) !== (result.repair_wave_id !== undefined)) fail('RUNTIME_STATE_CONFLICT', `${location}.repair_fingerprints and repair_wave_id must appear together.`);
  if (record.change_set_id !== undefined) result.change_set_id = expectString(record.change_set_id, `${location}.change_set_id`, SAFE_KEY_PATTERN);
  if (record.checkpoint !== undefined) result.checkpoint = expectEnum(record.checkpoint, ['required', 'not-required'], `${location}.checkpoint`);
  if (record.advancement !== undefined) result.advancement = expectEnum(record.advancement, STEP_ADVANCEMENT_OUTCOMES, `${location}.advancement`);
  if (record.next_step_id !== undefined) result.next_step_id = expectNullableString(record.next_step_id, `${location}.next_step_id`, STEP_ID_PATTERN);
  if (record.review_receipt !== undefined) result.review_receipt = validateStepReviewReceipt(record.review_receipt, `${location}.review_receipt`);
  if (record.claim_evidence !== undefined) result.claim_evidence = validateClaimEvidence(record.claim_evidence, `${location}.claim_evidence`);
  if (record.execution_result !== undefined) result.execution_result = validateStepExecutionResult(record.execution_result, `${location}.execution_result`);
  if (result.review_receipt && result.status !== 'completed') fail('RUNTIME_STATE_CONFLICT', `${location}.review_receipt requires a completed execution record.`);
  if (result.advancement !== undefined) {
    if (result.checkpoint === undefined || result.next_step_id === undefined) {
      fail('RUNTIME_STATE_CONFLICT', `${location}.advancement requires checkpoint and next_step_id.`);
    }
    if (result.advancement === 'advanced' && result.next_step_id === null) {
      fail('RUNTIME_STATE_CONFLICT', `${location}.advanced execution record must name the next step.`);
    }
    if (result.advancement !== 'advanced' && result.next_step_id !== null) {
      fail('RUNTIME_STATE_CONFLICT', `${location}.${result.advancement} execution record must not name a next step.`);
    }
  }
  return result;
}

function validateEvidenceChallenge(value: unknown, location: string): EvidenceChallenge {
  const item = expectRecord(value, location);
  expectExactKeys(item, ['challenge_id', 'claim_id', 'slot_id', 'result_id', 'evidence_ref', 'evidence_sha256', 'reason', 'status', 'source_revision', 'correction_step_id', ...('resolution' in item ? ['resolution'] : [])], location);
  const resolution = item.resolution === undefined ? undefined : (() => {
    const value = expectRecord(item.resolution, `${location}.resolution`);
    expectExactKeys(value, ['kind', 'evidence_ref', 'evidence_sha256', 'reason', 'source_revision'], `${location}.resolution`);
    if (value.kind !== 'not-substantiated') fail('RUNTIME_SCHEMA_INVALID', `${location}.resolution.kind is invalid.`);
    return {
      kind: 'not-substantiated' as const,
      evidence_ref: normalizeRepoPath(expectString(value.evidence_ref, `${location}.resolution.evidence_ref`), `${location}.resolution.evidence_ref`),
      evidence_sha256: expectString(value.evidence_sha256, `${location}.resolution.evidence_sha256`, /^[a-f0-9]{64}$/),
      reason: expectString(value.reason, `${location}.resolution.reason`),
      source_revision: expectString(value.source_revision, `${location}.resolution.source_revision`, /^[a-f0-9]{64}$/),
    };
  })();
  if (resolution && (item.status !== 'resolved' || item.correction_step_id !== null)) fail('RUNTIME_SCHEMA_INVALID', `${location}.resolution requires a dismissed challenge.`);
  if (item.status === 'resolved' && item.correction_step_id === null && !resolution) fail('RUNTIME_SCHEMA_INVALID', `${location} needs a correction step or an assessment resolution.`);
  return {
    challenge_id: expectString(item.challenge_id, `${location}.challenge_id`, SAFE_KEY_PATTERN),
    claim_id: expectString(item.claim_id, `${location}.claim_id`, CLAIM_ID_PATTERN),
    slot_id: expectString(item.slot_id, `${location}.slot_id`, CLAIM_EVIDENCE_SLOT_ID_PATTERN),
    result_id: expectString(item.result_id, `${location}.result_id`, CLAIM_ID_PATTERN),
    evidence_ref: normalizeRepoPath(expectString(item.evidence_ref, `${location}.evidence_ref`), `${location}.evidence_ref`),
    evidence_sha256: expectString(item.evidence_sha256, `${location}.evidence_sha256`, /^[a-f0-9]{64}$/),
    reason: expectString(item.reason, `${location}.reason`),
    status: expectEnum(item.status, ['contested', 'invalidated', 'resolved'], `${location}.status`),
    source_revision: expectString(item.source_revision, `${location}.source_revision`, /^[a-f0-9]{64}$/),
    correction_step_id: item.correction_step_id === null ? null : expectString(item.correction_step_id, `${location}.correction_step_id`, STEP_ID_PATTERN),
    ...(resolution ? { resolution } : {}),
  };
}

function validateEvidenceCarryForward(value: unknown, location: string): EvidenceCarryForward {
  const item = expectRecord(value, location);
  const v2 = item.kind === 'evidence-carry-forward/v2';
  expectExactKeys(item, ['kind', 'old_source_revision', 'old_plan_revision', 'new_plan_revision', 'claim_id', 'slot_id', 'check_id', 'result_id', 'report_sha256', 'subject_revision', ...(v2 ? ['receiving_source_revision', 'evidence_objects', 'context_revision'] : [])], location);
  if (!v2 && item.kind !== 'evidence-carry-forward/v1') fail('RUNTIME_SCHEMA_INVALID', `${location}.kind is invalid.`);
  const hash = (key: string) => expectString(item[key], `${location}.${key}`, /^[a-f0-9]{64}$/);
  if (v2 && (!Array.isArray(item.evidence_objects) || item.evidence_objects.length > 128)) fail('RUNTIME_SCHEMA_INVALID', 'Evidence objects must be bounded.');
  const objects = v2 ? (item.evidence_objects as unknown[]).map(raw => {
    const object = expectRecord(raw, 'evidence object');
    expectExactKeys(object, ['path', 'sha256', 'size'], 'evidence object');
    if (!Number.isInteger(object.size) || (object.size as number) < 0 || (object.size as number) > 1048576) fail('RUNTIME_SCHEMA_INVALID', 'Evidence object size is invalid.');
    return { path: normalizeRepoPath(expectString(object.path, 'evidence object.path'), 'evidence object.path'),
      sha256: expectString(object.sha256, 'evidence object.sha256', /^[a-f0-9]{64}$/), size: object.size as number };
  }) : undefined;
  return {
    kind: v2 ? 'evidence-carry-forward/v2' : 'evidence-carry-forward/v1',
    ...(v2 ? { receiving_source_revision: hash('receiving_source_revision'), evidence_objects: objects, context_revision: hash('context_revision') } : {}),
    old_source_revision: hash('old_source_revision'), old_plan_revision: hash('old_plan_revision'), new_plan_revision: hash('new_plan_revision'),
    claim_id: expectString(item.claim_id, `${location}.claim_id`, CLAIM_ID_PATTERN),
    slot_id: expectString(item.slot_id, `${location}.slot_id`, CLAIM_EVIDENCE_SLOT_ID_PATTERN),
    check_id: expectString(item.check_id, `${location}.check_id`, CLAIM_ID_PATTERN),
    result_id: expectString(item.result_id, `${location}.result_id`, CLAIM_ID_PATTERN),
    report_sha256: hash('report_sha256'), subject_revision: hash('subject_revision'),
  };
}

export function validateVNextRuntimeState(value: unknown, options: { storeBackedHistory?: boolean } = {}): RuntimeState {
  const runtime = expectRecord(value, 'runtime_state');
  const requiredRuntimeStateFields = [
    'schema_version', 'kind', 'task_id', 'task_slug', 'workflow_status', 'lifecycle_state',
    'resume_requires_review', 'resume_review_reasons', 'active_step_id', 'active_step_status',
    'finding_queue_revision', 'review_cycle', 'findings',
  ];
  if (!options.storeBackedHistory) requiredRuntimeStateFields.push('execution_log', 'applied_proposals');
  const optionalRuntimeStateFields = ['business_evidence_version', 'evidence_plan_revision', 'task_evolution_version', 'preservation_source_revision', 'claim_evidence_required', 'claim_evidence', 'pending_review_result', 'review_coverage', 'step_attempts', 'evidence_challenges', 'evidence_carry_forward', 'artifact_checkpoint_ids'];
  if (options.storeBackedHistory) optionalRuntimeStateFields.push('execution_log', 'applied_proposals');
  const missingRuntimeStateFields = requiredRuntimeStateFields.filter(field => !(field in runtime));
  const extraRuntimeStateFields = Object.keys(runtime).filter(field => !requiredRuntimeStateFields.includes(field) && !optionalRuntimeStateFields.includes(field));
  if (missingRuntimeStateFields.length > 0 || extraRuntimeStateFields.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `runtime_state keys mismatch; missing=[${missingRuntimeStateFields.join(', ')}], unexpected=[${extraRuntimeStateFields.join(', ')}].`);
  }
  if (runtime.business_evidence_version !== undefined && runtime.business_evidence_version !== 1) {
    fail('TASK_SEMANTICS_VERSION_UNSUPPORTED', 'runtime_state.business_evidence_version must be 1 when present.');
  }
  if (runtime.task_evolution_version !== undefined && ![1, 2].includes(runtime.task_evolution_version as number)) {
    fail('TASK_EVOLUTION_VERSION_UNSUPPORTED', 'runtime_state.task_evolution_version must be 1 or 2 when present.');
  }
  if (runtime.preservation_source_revision !== undefined && ![1, 2].includes(runtime.task_evolution_version as number)) {
    fail('RUNTIME_SCHEMA_INVALID', 'preservation_source_revision requires a supported task_evolution_version.');
  }
  if (runtime.schema_version !== VNEXT_RUNTIME_SCHEMA_VERSION) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.schema_version must be 1.');
  if (runtime.kind !== VNEXT_RUNTIME_STATE_KIND) fail('RUNTIME_SCHEMA_INVALID', `runtime_state.kind must be ${VNEXT_RUNTIME_STATE_KIND}.`);
  const taskId = expectString(runtime.task_id, 'runtime_state.task_id');
  const taskSlug = expectString(runtime.task_slug, 'runtime_state.task_slug');
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
  }
  const workflowStatus = expectEnum(runtime.workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, 'runtime_state.workflow_status');
  const lifecycleState = expectEnum(runtime.lifecycle_state, TASK_LIFECYCLE_STATES, 'runtime_state.lifecycle_state');
  try {
    validateCurrentTaskStatusTuple(workflowStatus, lifecycleState);
  } catch (error) {
    fail('RUNTIME_STATE_CONFLICT', error instanceof Error ? error.message : String(error));
  }
  const resumeRequiresReview = expectBoolean(runtime.resume_requires_review, 'runtime_state.resume_requires_review');
  const rawResumeReasons = expectStringArray(runtime.resume_review_reasons, 'runtime_state.resume_review_reasons', true, RESUME_REVIEW_REASON_ORDER.length);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReasons);
  if (rawResumeReasons.join('|') !== resumeReviewReasons.join('|')) {
    fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.resume_review_reasons must use the canonical closed-set order.');
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail('RUNTIME_STATE_CONFLICT', error instanceof Error ? error.message : String(error));
  }
  const activeStepId = expectString(runtime.active_step_id, 'runtime_state.active_step_id', STEP_ID_PATTERN);
  const activeStepStatus = expectEnum(runtime.active_step_status, STEP_STATUSES, 'runtime_state.active_step_status');
  const claimEvidenceRequired = runtime.claim_evidence_required === undefined
    ? runtime.claim_evidence !== undefined
    : expectBoolean(runtime.claim_evidence_required, 'runtime_state.claim_evidence_required');
  const claimEvidence = runtime.claim_evidence === undefined
    ? []
    : validateClaimEvidence(runtime.claim_evidence, 'runtime_state.claim_evidence');
  const evidenceChallenges = runtime.evidence_challenges === undefined ? [] : (() => {
    if (!Array.isArray(runtime.evidence_challenges) || runtime.evidence_challenges.length > 128) fail('RUNTIME_SCHEMA_INVALID', 'evidence_challenges must be a bounded array.');
    return runtime.evidence_challenges.map((item, index) => validateEvidenceChallenge(item, `runtime_state.evidence_challenges[${index}]`));
  })();
  const evidenceCarryForward = runtime.evidence_carry_forward === undefined ? [] : (() => {
    if (!Array.isArray(runtime.evidence_carry_forward) || runtime.evidence_carry_forward.length > 256) fail('RUNTIME_SCHEMA_INVALID', 'evidence_carry_forward must be a bounded array.');
    return runtime.evidence_carry_forward.map((item, index) => validateEvidenceCarryForward(item, `runtime_state.evidence_carry_forward[${index}]`));
  })();
  if (new Set(evidenceChallenges.map(item => item.challenge_id)).size !== evidenceChallenges.length) fail('RUNTIME_SCHEMA_INVALID', 'evidence_challenges IDs must be unique.');
  const findingsValue = runtime.findings;
  if (!Array.isArray(findingsValue) || findingsValue.length > MAX_FINDINGS) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.findings must be an array within the bounded size.');
  const findings = findingsValue.map((finding, index) => validateFinding(finding, `runtime_state.findings[${index}]`));
  if (new Set(findings.map(finding => finding.fingerprint)).size !== findings.length) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.findings fingerprints must be unique.');
  for (const finding of findings) {
    if (finding.owner_task_id !== taskId) fail('RUNTIME_STATE_CONFLICT', `finding ${finding.fingerprint} is owned by a different task.`);
    if (finding.repair_attempts > finding.max_repair_attempts) fail('RUNTIME_SCHEMA_INVALID', `finding ${finding.fingerprint} exceeds its declared repair budget.`);
  }
  const executionLogValue = runtime.execution_log;
  if (options.storeBackedHistory && executionLogValue !== undefined) {
    fail('RUNTIME_STORAGE_COMPACT_INVALID', 'compact CURRENT_TASK must not inline execution_log; use task-read against the committed store.');
  }
  if (!options.storeBackedHistory && (!Array.isArray(executionLogValue) || executionLogValue.length > MAX_EXECUTION_LOG)) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.execution_log must be a bounded array.');
  const executionLog = options.storeBackedHistory ? [] : (executionLogValue as unknown[]).map((entry, index) => validateExecutionLogEntry(entry, `runtime_state.execution_log[${index}]`, taskId, taskSlug));
  const appliedValue = runtime.applied_proposals;
  if (options.storeBackedHistory && appliedValue !== undefined) {
    fail('RUNTIME_STORAGE_COMPACT_INVALID', 'compact CURRENT_TASK must not inline applied_proposals; use task-read against the committed store.');
  }
  if (!options.storeBackedHistory && (!Array.isArray(appliedValue) || appliedValue.length > MAX_APPLIED_PROPOSALS)) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.applied_proposals must be a bounded array.');
  const appliedProposals = options.storeBackedHistory ? [] : (appliedValue as unknown[]).map((entry, index) => {
    const record = expectRecord(entry, `runtime_state.applied_proposals[${index}]`);
    expectExactKeys(record, ['idempotency_key', 'operation_kind', 'proposal_digest', 'source_revision'], `runtime_state.applied_proposals[${index}]`);
    const proposalDigest = expectString(record.proposal_digest, `runtime_state.applied_proposals[${index}].proposal_digest`);
    if (!/^[a-f0-9]{64}$/.test(proposalDigest)) fail('RUNTIME_SCHEMA_INVALID', `runtime_state.applied_proposals[${index}].proposal_digest must be SHA-256.`);
    const sourceRevision = expectString(record.source_revision, `runtime_state.applied_proposals[${index}].source_revision`);
    if (!/^[a-f0-9]{64}$/.test(sourceRevision)) fail('RUNTIME_SCHEMA_INVALID', `runtime_state.applied_proposals[${index}].source_revision must be SHA-256.`);
    return {
      idempotency_key: expectString(record.idempotency_key, `runtime_state.applied_proposals[${index}].idempotency_key`, SAFE_KEY_PATTERN),
      operation_kind: expectEnum(record.operation_kind, RUNTIME_OPERATION_KINDS, `runtime_state.applied_proposals[${index}].operation_kind`),
      proposal_digest: proposalDigest,
      source_revision: sourceRevision,
    };
  });
  if (new Set(appliedProposals.map(item => item.idempotency_key)).size !== appliedProposals.length) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.applied_proposals keys must be unique.');
  const reviewCycle = validateReviewCycle(runtime.review_cycle);
  const pendingReviewResult = runtime.pending_review_result === undefined || runtime.pending_review_result === null
    ? null
    : validatePendingReviewResult(runtime.pending_review_result, 'runtime_state.pending_review_result', true) as PendingReviewResult;
  if (pendingReviewResult !== null) {
    if (pendingReviewResult.step_id !== activeStepId) {
      fail('RUNTIME_STATE_CONFLICT', 'runtime_state.pending_review_result must belong to the active step.');
    }
    if (pendingReviewResult.cycle_id !== reviewCycle.id) {
      fail('RUNTIME_STATE_CONFLICT', 'runtime_state.pending_review_result must belong to the current review cycle.');
    }
  }
  return {
    schema_version: 1,
    kind: VNEXT_RUNTIME_STATE_KIND,
    ...(runtime.evidence_plan_revision === undefined ? {} : { evidence_plan_revision: expectString(runtime.evidence_plan_revision, 'evidence_plan_revision', /^[a-f0-9]{64}$/) }),
    ...(runtime.business_evidence_version === 1 ? { business_evidence_version: 1 as const } : {}),
    ...(runtime.task_evolution_version === undefined ? {} : { task_evolution_version: runtime.task_evolution_version as 1 | 2 }),
    ...(runtime.preservation_source_revision === undefined ? {} : { preservation_source_revision: expectString(runtime.preservation_source_revision, 'preservation_source_revision', /^[a-f0-9]{64}$/) }),
    task_id: taskId,
    task_slug: taskSlug,
    workflow_status: workflowStatus,
    lifecycle_state: lifecycleState,
    resume_requires_review: resumeRequiresReview,
    resume_review_reasons: resumeReviewReasons,
    active_step_id: activeStepId,
    active_step_status: activeStepStatus,
    finding_queue_revision: expectInteger(runtime.finding_queue_revision, 'runtime_state.finding_queue_revision'),
    review_cycle: reviewCycle,
    findings,
    execution_log: executionLog,
    applied_proposals: appliedProposals,
    claim_evidence_required: claimEvidenceRequired,
    claim_evidence: claimEvidence,
    ...(runtime.evidence_challenges === undefined ? {} : { evidence_challenges: evidenceChallenges }),
    ...(runtime.evidence_carry_forward === undefined ? {} : { evidence_carry_forward: evidenceCarryForward }),
    ...(runtime.artifact_checkpoint_ids === undefined ? {} : { artifact_checkpoint_ids: expectStringArray(runtime.artifact_checkpoint_ids, 'artifact_checkpoint_ids', true, 256).map(id => expectString(id, 'checkpoint ID', /^[a-f0-9]{64}$/)) }),
    pending_review_result: pendingReviewResult,
    ...(runtime.step_attempts === undefined ? {} : {step_attempts:validateStepAttempts(runtime.step_attempts)}),
    ...(runtime.review_coverage === undefined ? {} : { review_coverage: validateReviewCoverage(runtime.review_coverage) }),
  };
}

function replaceTaskInfoField(body: string, label: string, value: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^-\\s*${escapedLabel}：[^\\r\\n]*$`, 'gm');
  const matches = body.match(pattern) ?? [];
  if (matches.length !== 1) fail('RUNTIME_SCHEMA_INVALID', `CURRENT_TASK must contain exactly one task-info field "${label}".`);
  return body.replace(pattern, `- ${label}：${value}`);
}

function renderCurrentTaskLifecycleFields(body: string, runtimeState: RuntimeState): string {
  const headingMatch = /^## 任务信息\s*$/m.exec(body);
  if (!headingMatch || headingMatch.index === undefined) fail('RUNTIME_SCHEMA_INVALID', 'CURRENT_TASK is missing ## 任务信息.');
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const sectionRemainder = body.slice(sectionStart);
  const nextHeading = /\r?\n##\s/.exec(sectionRemainder);
  const sectionEnd = nextHeading?.index ?? sectionRemainder.length;
  const section = sectionRemainder.slice(0, sectionEnd);
  const nextSection = [
    ['当前状态', runtimeState.workflow_status],
    ['生命周期状态', runtimeState.lifecycle_state],
    ['恢复需审查', runtimeState.resume_requires_review ? 'true' : 'false'],
    ['恢复审查原因', runtimeState.resume_review_reasons.join(', ')],
  ] as const;
  const renderedSection = nextSection.reduce((current, [label, value]) => replaceTaskInfoField(current, label, value), section);
  return body.slice(0, sectionStart) + renderedSection + body.slice(sectionStart + sectionEnd);
}

type MarkdownSectionRange = {
  title: string;
  level: number;
  headingStart: number;
  contentStart: number;
  contentEnd: number;
};

type ReplanSectionKey = keyof ReplanReplacementDefinition;

const REPLAN_SECTION_HEADINGS: Record<ReplanSectionKey, readonly string[]> = {
  background_context: ['背景与上下文', 'Background and Context'],
  acceptance: ['验收标准', 'Acceptance Criteria'],
  allowed_scope: ['允许修改范围', 'Allowed Files'],
  conditional_scope: ['条件修改范围', '条件允许修改范围', 'Conditional Files'],
  forbidden_scope: ['禁止修改范围', 'Forbidden Files'],
  affected_contracts: ['受影响的契约', 'Affected Contracts'],
  confirmed_decisions: ['已确认决策', 'Confirmed Decisions'],
  open_questions: ['待确认问题', 'Open Questions'],
  implementation_plan: ['实现方案', 'Implementation Plan'],
  implementation_steps: ['实施步骤', 'Implementation Steps'],
  regression_checks: ['回归检查项', 'Regression Checks', 'Validation Checks'],
  rollback_points: ['回滚点', 'Rollback Points'],
  design_constraints: ['设计约束', 'Design Constraints'],
  post_release_validation: ['发布后验证', 'Post-release Validation', 'Post-Release Validation'],
  propagation_governance: ['传播治理记录', 'Propagation Governance'],
};

function scanMarkdownSections(body: string): MarkdownSectionRange[] {
  const headings: Array<{ title: string; level: number; headingStart: number; headingEnd: number }> = [];
  const headingPattern = /^(#{2,6})[ \t]+(.+?)[ \t]*$/gm;
  for (const match of body.matchAll(headingPattern)) {
    const headingStart = match.index ?? 0;
    const headingEnd = headingStart + match[0].length;
    headings.push({ title: match[2].trim(), level: match[1].length, headingStart, headingEnd });
  }
  return headings.map((heading, index) => {
    const afterHeading = heading.headingEnd;
    const contentStart = body.startsWith('\r\n', afterHeading)
      ? afterHeading + 2
      : body.startsWith('\n', afterHeading)
        ? afterHeading + 1
        : afterHeading;
    const next = headings.slice(index + 1).find(candidate => candidate.level <= heading.level);
    return {
      title: heading.title,
      level: heading.level,
      headingStart: heading.headingStart,
      contentStart,
      contentEnd: next?.headingStart ?? body.length,
    };
  });
}

function findUniqueMarkdownSection(
  sections: readonly MarkdownSectionRange[],
  aliases: readonly string[],
  level: number,
  rangeStart = 0,
  rangeEnd = Number.MAX_SAFE_INTEGER,
): MarkdownSectionRange | null {
  const matches = sections.filter(section =>
    section.level === level
    && aliases.includes(section.title)
    && section.headingStart >= rangeStart
    && section.headingStart < rangeEnd,
  );
  if (matches.length > 1) fail('RUNTIME_SECTION_INVALID', `CURRENT_TASK contains duplicate replacement sections: ${aliases.join(' / ')}.`);
  return matches[0] ?? null;
}

/**
 * Read a canonical Markdown section through the Runtime's section grammar.
 * Bootstrap uses this instead of maintaining a second heading/section parser.
 */
export function readCanonicalMarkdownSection(
  content: string,
  aliases: readonly string[],
  level = 2,
): string | null {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), aliases, level);
  return section ? content.slice(section.contentStart, section.contentEnd) : null;
}

export type CanonicalGovernanceFact = {
  key: string;
  value: string;
  source: string;
  certainty: 'confirmed' | 'inferred' | 'unknown';
};

const CANONICAL_GOVERNANCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

function canonicalGovernanceFail(code: string, location: string, message: string): never {
  fail(code, `${location} ${message}`);
}

export function normalizeCanonicalGovernanceInlineText(value: string, location: string, code = 'GOVERNANCE_INPUT_INVALID'): string {
  const normalized = value.trim();
  if (
    normalized.length === 0
    || /[\r\n\0\x01-\x1f\x7f]/u.test(normalized)
    || /```/u.test(normalized)
    || /<!--|-->/u.test(normalized)
    || /^(?:#{1,6}\s|[-*+]\s|>\s)/u.test(normalized)
    || /^[-*_]{3,}$/u.test(normalized)
  ) {
    canonicalGovernanceFail(code, location, 'must be a non-empty single-line Markdown-safe value.');
  }
  return normalized;
}

export function normalizeCanonicalGovernanceKey(value: string, location: string, code = 'GOVERNANCE_INPUT_INVALID'): string {
  const normalized = value.trim();
  if (!CANONICAL_GOVERNANCE_KEY_PATTERN.test(normalized)) {
    canonicalGovernanceFail(code, location, 'must match the canonical key grammar [A-Za-z0-9][A-Za-z0-9._/-]*.');
  }
  return normalized;
}

export function normalizeCanonicalGovernanceFacts(
  value: readonly unknown[] | undefined,
  location: string,
  code = 'GOVERNANCE_INPUT_INVALID',
): CanonicalGovernanceFact[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) canonicalGovernanceFail(code, location, 'must be an array.');
  const result = new Map<string, CanonicalGovernanceFact>();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) canonicalGovernanceFail(code, `${location}[${index}]`, 'must be a fact mapping.');
    const fact = raw as Record<string, unknown>;
    if (typeof fact.key !== 'string' || typeof fact.value !== 'string' || typeof fact.source !== 'string' || !['confirmed', 'inferred', 'unknown'].includes(fact.certainty as string)) {
      canonicalGovernanceFail(code, `${location}[${index}]`, 'has an invalid key, value, source, or certainty.');
    }
    const normalized: CanonicalGovernanceFact = {
      key: normalizeCanonicalGovernanceKey(fact.key as string, `${location}[${index}].key`, code),
      value: normalizeCanonicalGovernanceInlineText(fact.value as string, `${location}[${index}].value`, code),
      source: normalizeCanonicalGovernanceInlineText(fact.source as string, `${location}[${index}].source`, code),
      certainty: fact.certainty as CanonicalGovernanceFact['certainty'],
    };
    if (/\s+\(source:\s|\s+\[(?:confirmed|inferred|unknown);\s+source:\s/u.test(normalized.value)) {
      canonicalGovernanceFail(code, `${location}[${index}].value`, 'contains a reserved fact rendering delimiter.');
    }
    const previous = result.get(normalized.key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) {
      canonicalGovernanceFail(code, `${location}[${index}].key`, `conflicts with another fact for key ${normalized.key}.`);
    }
    if (!previous) result.set(normalized.key, normalized);
  }
  return [...result.values()];
}

export function parseCanonicalGovernanceFactLines(lines: readonly string[], location: string): CanonicalGovernanceFact[] {
  const parsed: CanonicalGovernanceFact[] = [];
  for (const [index, line] of lines.entries()) {
    const normalized = line.trim();
    if (!normalized.startsWith('- ') || normalized === '- none') continue;
    const confirmed = /^-\s+([^:\r\n]+):\s+(.+?)\s+\(source:\s+(.+)\)$/u.exec(normalized);
    if (confirmed) {
      parsed.push({ key: confirmed[1]!, value: confirmed[2]!, source: confirmed[3]!, certainty: 'confirmed' });
      continue;
    }
    const unresolved = /^-\s+([^:\r\n]+):\s+(.+?)\s+\[(confirmed|inferred|unknown);\s+source:\s+(.+)\]$/u.exec(normalized);
    if (unresolved) {
      parsed.push({ key: unresolved[1]!, value: unresolved[2]!, source: unresolved[4]!, certainty: unresolved[3] as CanonicalGovernanceFact['certainty'] });
      continue;
    }
    if (normalized.includes(':')) canonicalGovernanceFail('GOVERNANCE_FACT_INVALID', `${location}:${index + 1}`, 'contains an unreadable canonical fact.');
  }
  return normalizeCanonicalGovernanceFacts(parsed, location, 'GOVERNANCE_FACT_INVALID');
}

export function normalizeCanonicalBaselineEntries(
  value: Record<string, string> | undefined,
  location: string,
  code = 'GOVERNANCE_INPUT_INVALID',
): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) canonicalGovernanceFail(code, location, 'must be a mapping.');
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeCanonicalGovernanceKey(rawKey, `${location}.${rawKey}`, code);
    if (key === 'none') canonicalGovernanceFail(code, `${location}.${rawKey}`, 'cannot use the reserved empty-baseline placeholder key "none".');
    if (typeof rawValue !== 'string') canonicalGovernanceFail(code, `${location}.${rawKey}`, 'must have a string value.');
    const normalizedValue = normalizeCanonicalGovernanceInlineText(rawValue, `${location}.${rawKey}`, code);
    if (key in result && result[key] !== normalizedValue) canonicalGovernanceFail(code, `${location}.${rawKey}`, `conflicts with another baseline entry for key ${key}.`);
    result[key] = normalizedValue;
  }
  return result;
}

export function parseCanonicalBaselineKeys(lines: readonly string[], location: string): string[] {
  const result = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const normalized = line.trim();
    if (!normalized.startsWith('- ')) continue;
    const rawKey = normalized.slice(2).trim();
    if (!rawKey || rawKey === 'none') continue;
    const key = normalizeCanonicalGovernanceKey(rawKey, `${location}:${index + 1}`, 'GOVERNANCE_BASELINE_INVALID');
    result.add(key);
  }
  return [...result].sort((left, right) => left.localeCompare(right));
}

function resolveReplanSectionRanges(body: string): Partial<Record<ReplanSectionKey, MarkdownSectionRange>> {
  const sections = scanMarkdownSections(body);
  const resolved: Partial<Record<ReplanSectionKey, MarkdownSectionRange>> = {};
  const topAllowed = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.allowed_scope, 2);
  const topConditional = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 2);
  const topForbidden = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.forbidden_scope, 2);
  const nestedAllowed = topAllowed
    ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.allowed_scope, 3, topAllowed.contentStart, topAllowed.contentEnd)
    : null;
  const nestedConditional = topAllowed
    ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 3, topAllowed.contentStart, topAllowed.contentEnd)
    : null;
  const nestedConditionalUnderTopSection = topConditional
    ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 3, topConditional.contentStart, topConditional.contentEnd)
    : null;
  const nestedForbidden = topForbidden
    ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.forbidden_scope, 3, topForbidden.contentStart, topForbidden.contentEnd)
    : null;

  if (nestedConditional && !nestedAllowed) {
    fail('RUNTIME_SECTION_INVALID', 'Conditional scope must have a distinct existing Allowed Files section when both are nested under the scope heading.');
  }
  if (nestedAllowed) {
    resolved.allowed_scope = nestedAllowed;
    if (nestedConditional) resolved.conditional_scope = nestedConditional;
    else if (nestedConditionalUnderTopSection) resolved.conditional_scope = nestedConditionalUnderTopSection;
    else if (topConditional) resolved.conditional_scope = topConditional;
  } else {
    if (topAllowed) resolved.allowed_scope = topAllowed;
    if (nestedConditionalUnderTopSection) resolved.conditional_scope = nestedConditionalUnderTopSection;
    else if (topConditional) resolved.conditional_scope = topConditional;
  }
  if (nestedForbidden) resolved.forbidden_scope = nestedForbidden;
  else if (topForbidden) resolved.forbidden_scope = topForbidden;

  const nonScopeKeys: ReplanSectionKey[] = [
    'background_context',
    'acceptance',
    'affected_contracts',
    'confirmed_decisions',
    'open_questions',
    'implementation_plan',
    'implementation_steps',
    'regression_checks',
    'rollback_points',
    'design_constraints',
    'post_release_validation',
    'propagation_governance',
  ];
  for (const key of nonScopeKeys) {
    const section = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS[key], 2);
    if (section) resolved[key] = section;
  }
  return resolved;
}

function replacementSectionValue(replacement: ReplanReplacementDefinition, key: ReplanSectionKey): string | null {
  return replacement[key];
}

function replaceReplanDefinitionSections(body: string, replacement: ReplanReplacementDefinition): string {
  const ranges = resolveReplanSectionRanges(body);
  const replacements: Array<{ range: MarkdownSectionRange; content: string }> = [];
  for (const key of REPLAN_REPLACEMENT_FIELDS) {
    const value = replacementSectionValue(replacement, key);
    const range = ranges[key];
    const optional = key === 'design_constraints' || key === 'post_release_validation' || key === 'propagation_governance';
    if (!range) {
      if (!optional || value !== null) fail('RUNTIME_SECTION_INVALID', `CURRENT_TASK is missing the existing replacement section for ${key}.`);
      continue;
    }
    replacements.push({ range, content: value ?? '' });
  }
  replacements.sort((left, right) => right.range.contentStart - left.range.contentStart);
  for (let index = 1; index < replacements.length; index += 1) {
    const previous = replacements[index - 1].range;
    const current = replacements[index].range;
    if (current.contentEnd > previous.contentStart) {
      fail('RUNTIME_SECTION_INVALID', 'Replan replacement sections overlap and cannot be replaced atomically.');
    }
  }
  let nextBody = body;
  for (const { range, content } of replacements) {
    const normalized = normalizeReplacementSectionContent(content, `CURRENT_TASK.${range.title}`);
    const rendered = normalized.length === 0 ? '\n\n' : `\n${normalized}\n\n`;
    nextBody = nextBody.slice(0, range.contentStart) + rendered + nextBody.slice(range.contentEnd);
  }
  return nextBody;
}

function assertReplanDefinitionSections(body: string, replacement: ReplanReplacementDefinition): void {
  const ranges = resolveReplanSectionRanges(body);
  for (const key of REPLAN_REPLACEMENT_FIELDS) {
    const value = replacementSectionValue(replacement, key);
    const range = ranges[key];
    const optional = key === 'design_constraints' || key === 'post_release_validation' || key === 'propagation_governance';
    if (!range) {
      if (!optional || value !== null) fail('RUNTIME_REPLAY_INCOMPLETE', `replan replay is missing the replacement section for ${key}.`);
      continue;
    }
    const actual = normalizeReplacementSectionContent(body.slice(range.contentStart, range.contentEnd), `CURRENT_TASK.${range.title}`);
    const expected = value ?? '';
    if (actual !== expected) fail('RUNTIME_REPLAY_INCOMPLETE', `replan replay section ${key} no longer matches the committed replacement.`);
  }
}

function auditList(values: readonly string[]): string {
  return `[${values.map(value => JSON.stringify(value)).join(', ')}]`;
}

function renderExecutionAuditRecord(audit: RuntimeAuditLogEntry, includeEmptyKnowledge = true): string {
  const authorityRefs = audit.authority_evidence.map(item => `${item.kind}:${item.source}:${item.subject}`);
  const lines = [
    `- action: ${audit.action}`,
    `  old_status: ${audit.from_workflow_status}+${audit.from_lifecycle_state}`,
    `  new_status: ${audit.to_workflow_status}+${audit.to_lifecycle_state}`,
    `  task_id: ${audit.task_id}`,
    `  task_slug: ${audit.task_slug}`,
    `  document_id: ${audit.document_id}`,
    `  proposal_idempotency_key: ${audit.idempotency_key}`,
    `  source_revision: ${audit.source_revision}`,
    `  authority_refs: ${auditList(authorityRefs)}`,
    `  evidence_refs: ${auditList(audit.evidence_refs)}`,
  ];
  if (audit.action === 'archive') {
    lines.push(`  archive_path: ${audit.archive_path}`);
    lines.push(`  archive_revision: ${audit.archive_revision}`);
    lines.push(`  closure_delta_digest: ${audit.closure_delta_digest}`);
    lines.push('  lesson_admission:');
    lines.push(`    decision: ${audit.lesson_admission.decision}`);
    lines.push(`    candidate_refs: ${auditList(audit.lesson_admission.candidate_refs)}`);
    lines.push(`    evidence_refs: ${auditList(audit.lesson_admission.evidence_refs)}`);
    if (includeEmptyKnowledge || audit.knowledge_admissions.contracts.length > 0 || audit.knowledge_admissions.decisions.length > 0) {
      lines.push(`  knowledge_admissions: ${JSON.stringify(audit.knowledge_admissions)}`);
    }
  } else if (audit.action === 'migrate-claim-evidence') {
    const migrationAudit = audit as ClaimEvidenceMigrationAuditLogEntry;
    lines.push(`  from_task_id: ${migrationAudit.from_task_id}`);
    lines.push(`  from_task_slug: ${migrationAudit.from_task_slug}`);
    lines.push(`  from_document_id: ${migrationAudit.from_document_id}`);
    lines.push(`  claim_evidence_digest: ${migrationAudit.claim_evidence_digest}`);
  } else if (DRAFT_AUDIT_ACTIONS.includes(audit.action as DraftAuditAction)) {
    const draftAudit = audit as DraftAuditLogEntry;
    lines.push(`  from_task_id: ${draftAudit.from_task_id}`);
    lines.push(`  from_task_slug: ${draftAudit.from_task_slug}`);
    lines.push(`  from_document_id: ${draftAudit.from_document_id}`);
    if (draftAudit.definition_digest !== undefined) lines.push(`  definition_digest: ${draftAudit.definition_digest}`);
    if (draftAudit.draft_revision !== undefined) lines.push(`  draft_revision: ${draftAudit.draft_revision}`);
  } else {
    const replanAudit = audit as ReplanAuditLogEntry;
    if (replanAudit.candidate_digest !== undefined) lines.push(`  candidate_digest: ${replanAudit.candidate_digest}`);
    if (replanAudit.correction_reason !== undefined) lines.push(`  correction_reason: ${replanAudit.correction_reason}`);
    if (replanAudit.invalidation_kind !== undefined) lines.push(`  invalidation_kind: ${replanAudit.invalidation_kind}`);
    if (replanAudit.invalidation_reason !== undefined) lines.push(`  invalidation_reason: ${replanAudit.invalidation_reason}`);
    if (replanAudit.partial_diff_disposition !== undefined) {
      lines.push('  partial_diff_disposition:');
      lines.push(`    reusable: ${auditList(replanAudit.partial_diff_disposition.reusable)}`);
      lines.push(`    rollback_required: ${auditList(replanAudit.partial_diff_disposition.rollback_required)}`);
      lines.push(`    stop_propagation: ${auditList(replanAudit.partial_diff_disposition.stop_propagation)}`);
    }
  }
  lines.push(`  recorded_at: ${audit.recorded_at}`);
  return lines.join('\n');
}

function appendExecutionAuditToBody(body: string, audit: RuntimeAuditLogEntry): string {
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), ['执行记录', 'Execution Log'], 2);
  if (!section) fail('RUNTIME_SECTION_INVALID', 'CURRENT_TASK is missing the required ## 执行记录 audit section.');
  const existing = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trimEnd();
  const auditText = renderExecutionAuditRecord(audit);
  const rendered = `${existing.trim().length > 0 ? `${existing}\n\n` : ''}${auditText}\n\n`;
  return body.slice(0, section.contentStart) + `\n${rendered}` + body.slice(section.contentEnd);
}

function compactHistoryPreview(body: string, runtimeState: RuntimeState, audit?: RuntimeAuditLogEntry): string {
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), ['执行记录', 'Execution Log'], 2);
  if (!section) fail('RUNTIME_SECTION_INVALID', 'CURRENT_TASK is missing the required ## 执行记录 audit section.');
  const entries: unknown[] = [...runtimeState.execution_log];
  if (audit && !entries.some(item => isRecord(item) && item.idempotency_key === audit.idempotency_key)) entries.push(audit);
  const preview = entries.filter(isRecord).slice(-8).map(item => {
    const action = typeof item.action === 'string' ? item.action : 'step-execution';
    const idempotencyKey = typeof item.idempotency_key === 'string' ? item.idempotency_key : 'unknown';
    const stepId = typeof item.step_id === 'string' ? item.step_id : null;
    const status = typeof item.status === 'string' ? item.status : null;
    const recordedAt = typeof item.recorded_at === 'string' ? item.recorded_at : null;
    return `- ${action} | key=${idempotencyKey}${stepId ? ` | step=${stepId}` : ''}${status ? ` | status=${status}` : ''}${recordedAt ? ` | at=${recordedAt}` : ''}`;
  });
  const lines = [
    '- Store-backed history is retained under task-data; use task-read for exact event, proposal, result, and report reads.',
    '- This section is a bounded navigation preview only; it is not the Runtime fact source.',
    ...(preview.length > 0 ? ['', ...preview] : []),
  ];
  let rendered = lines.join('\n');
  if (Buffer.byteLength(rendered, 'utf8') > 8192) {
    rendered = Buffer.from(rendered, 'utf8').subarray(0, 8192).toString('utf8');
  }
  return body.slice(0, section.contentStart) + `\n${rendered}\n\n` + body.slice(section.contentEnd);
}

function assertExecutionAudit(root: string, current: CanonicalCurrentTask, audit: RuntimeAuditLogEntry): void {
  if (current.frontmatter.task_store !== undefined) {
    const history = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent).readExecutionLog();
    if (!history.some(entry => digest(entry) === digest(audit))) {
      fail('RUNTIME_REPLAY_INCOMPLETE', `replay is missing the durable task-store audit for ${audit.action}.`);
    }
    return;
  }
  const body = current.body;
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), ['执行记录', 'Execution Log'], 2);
  if (!section) fail('RUNTIME_REPLAY_INCOMPLETE', 'replay is missing the required ## 执行记录 audit section.');
  const content = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n');
  const currentAudit = renderExecutionAuditRecord(audit);
  const historicalAudit = audit.action === 'archive'
    && audit.knowledge_admissions.contracts.length === 0
    && audit.knowledge_admissions.decisions.length === 0
    ? renderExecutionAuditRecord(audit, false)
    : null;
  if (!content.includes(currentAudit) && (historicalAudit === null || !content.includes(historicalAudit))) {
    fail('RUNTIME_REPLAY_INCOMPLETE', `replay is missing the durable body audit for ${audit.action}.`);
  }
}

const VNEXT_TASK_BASIS_KIND = 'vnext-task-basis' as const;
const TASK_BASIS_HEADING_ALIASES = ['任务输入依据', 'Task Basis'] as const;

type TaskBasisArtifact = TaskBasisReference & {
  filePath: string;
  content: string;
  basis: TaskBasis;
};

function taskBasisRelativePath(currentTaskPath: string, taskId: string): string {
  try {
    validateTaskId(taskId);
  } catch (error) {
    fail('RUNTIME_IDENTITY_INVALID', error instanceof Error ? error.message : String(error));
  }
  const directory = path.posix.dirname(normalizeRepoPath(currentTaskPath, 'CURRENT_TASK source path'));
  return path.posix.join(directory, 'task-basis', `TASK_BASIS-${taskId}.md`);
}

function taskBasisFilePath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, ...normalizeRepoPath(relativePath, 'task basis path').split('/'));
  const relative = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    fail('RUNTIME_PATH_INVALID', `task basis path escapes the target root: ${relativePath}`);
  }
  return filePath;
}

function renderTaskBasisContent(identity: DraftTaskIdentity, basis: TaskBasis): string {
  const frontmatter = {
    schema_version: 1,
    kind: VNEXT_TASK_BASIS_KIND,
    task_id: identity.task_id,
    document_id: identity.document_id,
    original_request: basis.original_request,
    user_decisions: basis.user_decisions,
  };
  return [
    '---',
    stringify(frontmatter).trimEnd(),
    '---',
    '# vNext TASK_BASIS',
    '',
    'This file preserves request evidence for independent draft review.',
    'It is not a review result and does not replace source-authority or decision-authority policy.',
    '',
  ].join('\n');
}

function materializeTaskBasis(
  root: string,
  current: CanonicalCurrentTask,
  identity: DraftTaskIdentity,
  basis: TaskBasis,
): TaskBasisArtifact {
  const relativePath = taskBasisRelativePath(current.relativePath, identity.task_id);
  const content = renderTaskBasisContent(identity, basis);
  return {
    path: relativePath,
    filePath: taskBasisFilePath(root, relativePath),
    revision: sha256(content),
    content,
    basis,
  };
}

export function readTaskBasisReferenceFromBody(body: string): TaskBasisReference | null {
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), TASK_BASIS_HEADING_ALIASES, 2);
  if (!section) return null;
  const content = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trim();
  const match = /^- path: `([^`]+)`\n- revision: `([a-f0-9]{64})`$/u.exec(content);
  if (!match) fail('TASK_BASIS_REFERENCE_INVALID', 'CURRENT_TASK task basis reference must contain one exact path and SHA-256 revision.');
  return {
    path: normalizeRepoPath(match[1]!, 'CURRENT_TASK task basis path'),
    revision: match[2]!,
  };
}

function renderTaskBasisReference(reference: TaskBasisReference): string {
  return [`- path: \`${reference.path}\``, `- revision: \`${reference.revision}\``].join('\n');
}

function replaceTaskBasisReference(body: string, reference: TaskBasisReference): string {
  const sections = scanMarkdownSections(body);
  const existing = findUniqueMarkdownSection(sections, TASK_BASIS_HEADING_ALIASES, 2);
  const rendered = renderTaskBasisReference(reference);
  if (existing) {
    return body.slice(0, existing.contentStart) + `\n${rendered}\n\n` + body.slice(existing.contentEnd);
  }
  const background = findUniqueMarkdownSection(sections, ['背景与上下文', 'Background and Context'], 2);
  if (!background) fail('RUNTIME_SECTION_INVALID', 'CURRENT_TASK is missing the background section required to insert its task basis reference.');
  return body.slice(0, background.headingStart)
    + `## 任务输入依据\n\n${rendered}\n\n`
    + body.slice(background.headingStart);
}

function renderNewDraftBody(
  identity: DraftTaskIdentity,
  definition: DraftTaskDefinition,
  runtimeState: RuntimeState,
  taskBasisReference: TaskBasisReference,
): string {
  const optionalSection = (value: string | null): string => value ?? '';
  return [
    '# vNext CURRENT_TASK',
    '',
    '## 任务信息',
    '',
    `- 任务 ID：${identity.task_id}`,
    `- 任务标题：${identity.task_title}`,
    `- 任务 slug：${identity.task_slug}`,
    `- 当前状态：${runtimeState.workflow_status}`,
    `- 生命周期状态：${runtimeState.lifecycle_state}`,
    `- 恢复需审查：${runtimeState.resume_requires_review ? 'true' : 'false'}`,
    `- 恢复审查原因：${runtimeState.resume_review_reasons.join(', ')}`,
    '',
    '## 任务输入依据',
    '',
    renderTaskBasisReference(taskBasisReference),
    '',
    '## 背景与上下文',
    '',
    definition.background_context,
    '',
    '## 验收标准',
    '',
    definition.acceptance,
    '',
    '## 允许修改范围',
    '',
    '### Read / discovery context',
    '',
    '- none',
    '',
    '### Allowed Files',
    '',
    definition.allowed_scope,
    '',
    '### Conditional Files',
    '',
    definition.conditional_scope,
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    definition.forbidden_scope,
    '',
    '## 受影响的契约',
    '',
    definition.affected_contracts,
    '',
    '## 已确认决策',
    '',
    definition.confirmed_decisions,
    '',
    '## 待确认问题',
    '',
    definition.open_questions,
    '',
    '## 实现方案',
    '',
    definition.implementation_plan,
    '',
    '## 传播治理记录',
    '',
    optionalSection(definition.propagation_governance),
    '',
    '## 实施步骤',
    '',
    definition.implementation_steps,
    '',
    '## 回归检查项',
    '',
    definition.regression_checks,
    '',
    '## 回滚点',
    '',
    definition.rollback_points,
    '',
    '## 设计约束',
    '',
    optionalSection(definition.design_constraints),
    '',
    '## 发布后验证',
    '',
    optionalSection(definition.post_release_validation),
    '',
    '## 执行记录',
    '',
    '- Draft created by prepare-task; execution is blocked until explicit confirm-draft.',
    '',
  ].join('\n');
}

function renderCanonicalCurrentTask(
  frontmatter: AnyRecord,
  body: string,
  runtimeState: RuntimeState,
  options: {
    replacementDefinition?: ReplanReplacementDefinition;
    draftDefinition?: DraftTaskDefinition;
    draftIdentity?: DraftTaskIdentity;
    draftDocumentId?: string;
    taskBasisReference?: TaskBasisReference;
    audit?: RuntimeAuditLogEntry;
    compactTaskStore?: boolean;
    taskStoreManifestPath?: string;
  } = {},
): string {
  const existingBinding = frontmatter.task_store;
  const compact = options.compactTaskStore === true || existingBinding !== undefined;
  const compactBinding = compact
    ? options.draftDocumentId !== undefined
      ? {
        schema_version: 1,
        kind: 'vnext-current-task-store-binding',
        format: 'compact-v2',
        manifest_path: options.taskStoreManifestPath ?? fail('RUNTIME_STORAGE_COMPACT_INVALID', 'compact rendering needs a task-store manifest path.'),
        history: { execution_log: 'task-store', applied_proposals: 'task-store' },
      }
      : existingBinding ?? {
      schema_version: 1,
      kind: 'vnext-current-task-store-binding',
      format: 'compact-v2',
      manifest_path: options.taskStoreManifestPath ?? fail('RUNTIME_STORAGE_COMPACT_INVALID', 'compact rendering needs a task-store manifest path.'),
      history: { execution_log: 'task-store', applied_proposals: 'task-store' },
      }
    : undefined;
  const { execution_log: _executionLog, applied_proposals: _appliedProposals, ...compactRuntimeState } = runtimeState;
  const nextFrontmatter: AnyRecord = {
    ...frontmatter,
    ...(options.draftDocumentId === undefined ? {} : { document_id: options.draftDocumentId }),
    ...(compactBinding === undefined ? {} : { task_store: compactBinding }),
    runtime_state: compact ? compactRuntimeState : runtimeState,
  };
  if (options.draftDefinition && options.draftIdentity && !options.taskBasisReference) {
    fail('TASK_BASIS_MISSING', 'A new or refined draft must link its exact task basis.');
  }
  let nextBody = options.draftDefinition && options.draftIdentity && options.taskBasisReference
    ? renderNewDraftBody(options.draftIdentity, options.draftDefinition, runtimeState, options.taskBasisReference)
    : options.replacementDefinition
      ? replaceReplanDefinitionSections(body, options.replacementDefinition)
      : body;
  if (options.taskBasisReference && !(options.draftDefinition && options.draftIdentity)) {
    nextBody = replaceTaskBasisReference(nextBody, options.taskBasisReference);
  }
  if (options.draftIdentity && !(options.draftDefinition && options.draftIdentity)) {
    nextBody = replaceTaskInfoField(nextBody, '任务 ID', options.draftIdentity.task_id);
    nextBody = replaceTaskInfoField(nextBody, '任务标题', options.draftIdentity.task_title);
    nextBody = replaceTaskInfoField(nextBody, '任务 slug', options.draftIdentity.task_slug);
  }
  nextBody = renderCurrentTaskLifecycleFields(nextBody, runtimeState);
  if (compact) nextBody = compactHistoryPreview(nextBody, runtimeState, options.audit);
  else if (options.audit) nextBody = appendExecutionAuditToBody(nextBody, options.audit);
  return `---\n${stringify(nextFrontmatter).trimEnd()}\n---\n${nextBody}`;
}

function currentTaskPathForRoot(root: string): { filePath: string; relativePath: string } {
  const resolvedRoot = path.resolve(root);
  const profilePath = getWorkflowProfilePath(resolvedRoot);
  if (!fs.existsSync(profilePath)) fail('RUNTIME_SOURCE_MISSING', `PROJECT_PROFILE.yaml is missing: ${profilePath}`);
  const profile = loadProfile(profilePath);
  const filePath = getWorkflowDocPath(resolvedRoot, profile, 'CURRENT_TASK.md');
  const relativePath = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) fail('RUNTIME_PATH_INVALID', 'CURRENT_TASK path escapes the target root.');
  return { filePath, relativePath: relativePath || CURRENT_TASK_RELATIVE_FALLBACK };
}

function walkMarkdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  const visit = (currentDirectory: string): void => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath);
    }
  };
  visit(directory);
  return files;
}

export function allocateNextTaskId(root: string, currentTaskId: string): string {
  try {
    validateTaskId(currentTaskId);
  } catch (error) {
    fail('RUNTIME_IDENTITY_INVALID', error instanceof Error ? error.message : String(error));
  }
  const current = BigInt(currentTaskId);
  const taskDirectory = path.join(path.resolve(root), 'TASKS');
  const usedIds = new Set<bigint>([current]);
  const taskFilePattern = /^TASK-([0-9]{3,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
  for (const taskFile of walkMarkdownFiles(taskDirectory)) {
    const match = taskFilePattern.exec(path.basename(taskFile));
    if (match) {
      usedIds.add(BigInt(match[1]!));
    }
  }
  let next = current + 1n;
  while (usedIds.has(next)) {
    next += 1n;
  }
  return next.toString().padStart(Math.max(3, currentTaskId.length), '0');
}

function collectTaskDocumentIds(root: string): Set<string> {
  const { filePath } = currentTaskPathForRoot(root);
  const documentIds = new Set<string>();
  const allFiles = [filePath, ...walkMarkdownFiles(path.join(path.resolve(root), 'TASKS'))];
  for (const file of allFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/^\s*(?:-\s*)?document_id:\s*['"]?(doc-[a-f0-9]{24})['"]?\s*$/gim)) {
      documentIds.add(match[1]!);
    }
  }
  return documentIds;
}

function generatedDraftDocumentId(identity: Pick<DraftTaskIdentity, 'task_id' | 'task_slug'>, sourceRevision: string): string {
  return `doc-${sha256(`${identity.task_id}:${identity.task_slug}:${sourceRevision}`).slice(0, 24)}`;
}

function validateCurrentTaskStoreBinding(value: unknown, documentId: string, location: string): CurrentTaskStoreBinding {
  const binding = expectRecord(value, location);
  expectExactKeys(binding, ['schema_version', 'kind', 'format', 'manifest_path', 'history'], location);
  if (binding.schema_version !== 1 || binding.kind !== 'vnext-current-task-store-binding' || binding.format !== 'compact-v2') {
    fail('RUNTIME_STORAGE_COMPACT_INVALID', `${location} is not a supported compact task-store binding.`);
  }
  const manifestPath = expectString(binding.manifest_path, `${location}.manifest_path`);
  if (manifestPath.startsWith('/') || /^[A-Za-z]:/u.test(manifestPath) || manifestPath.split('/').includes('..')
    || !manifestPath.endsWith(`/task-data/${documentId}/manifest.json`)) {
    fail('RUNTIME_STORAGE_COMPACT_INVALID', `${location}.manifest_path must point to this document's repository-relative task-data manifest.`);
  }
  const history = expectRecord(binding.history, `${location}.history`);
  expectExactKeys(history, ['execution_log', 'applied_proposals'], `${location}.history`);
  if (history.execution_log !== 'task-store' || history.applied_proposals !== 'task-store') {
    fail('RUNTIME_STORAGE_COMPACT_INVALID', `${location}.history must bind both histories to task-store.`);
  }
  return {
    schema_version: 1,
    kind: 'vnext-current-task-store-binding',
    format: 'compact-v2',
    manifest_path: manifestPath,
    history: { execution_log: 'task-store', applied_proposals: 'task-store' },
  };
}

function parseCanonicalCurrentTaskContent(raw: string, filePath: string, relativePath: string): CanonicalCurrentTask {
  const { frontmatter, body } = parseYamlFrontmatter(raw, relativePath);
  if (frontmatter.kind !== VNEXT_CURRENT_TASK_KIND) {
    fail('MIGRATION_REQUIRED', `${relativePath} is not a pure vNext CURRENT_TASK document; run the Migration Pack.`);
  }
  expectExactKeys(frontmatter, ['schema_version', 'kind', 'document_id', 'runtime_state', ...(frontmatter.task_store === undefined ? [] : ['task_store'])], `${relativePath} frontmatter`);
  if (frontmatter.schema_version !== 1) fail('RUNTIME_SCHEMA_INVALID', `${relativePath}.schema_version must be 1 for a vNext CURRENT_TASK document.`);
  const documentId = expectString(frontmatter.document_id, `${relativePath}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', `${relativePath}.document_id is invalid.`);
  const storeBinding = frontmatter.task_store === undefined ? null : validateCurrentTaskStoreBinding(frontmatter.task_store, documentId, `${relativePath}.task_store`);
  const runtimeState = validateVNextRuntimeState(frontmatter.runtime_state, { storeBackedHistory: storeBinding !== null });
  try {
    parseMutationScope(body, sha256(raw));
  } catch (error) {
    if (error instanceof MutationScopeError) fail(error.code, error.message);
    fail('MUTATION_SCOPE_INVALID', error instanceof Error ? error.message : String(error));
  }
  const identity = extractTaskIdentityFromCurrentTask(body);
  const bodyState = extractCurrentTaskStateFromCurrentTask(body);
  if (identity.id !== runtimeState.task_id || identity.slug !== runtimeState.task_slug) {
    fail('RUNTIME_SOURCE_CONFLICT', 'CURRENT_TASK body identity conflicts with runtime_state.');
  }
  if (bodyState.workflowStatus !== runtimeState.workflow_status || bodyState.lifecycleState !== runtimeState.lifecycle_state) {
    fail('RUNTIME_SOURCE_CONFLICT', 'CURRENT_TASK body lifecycle tuple conflicts with runtime_state.');
  }
  if (bodyState.resumeRequiresReview !== runtimeState.resume_requires_review) {
    fail('RUNTIME_SOURCE_CONFLICT', 'CURRENT_TASK body resume gate conflicts with runtime_state.');
  }
  let bodyResumeReasons: ResumeReviewReason[];
  try {
    bodyResumeReasons = normalizeResumeReviewReasons(bodyState.resumeReviewReasons);
  } catch (error) {
    fail('RUNTIME_SOURCE_CONFLICT', error instanceof Error ? error.message : String(error));
  }
  if (bodyResumeReasons.join('|') !== runtimeState.resume_review_reasons.join('|')) {
    fail('RUNTIME_SOURCE_CONFLICT', 'CURRENT_TASK body resume review reasons conflict with runtime_state.');
  }
  // Validate the active step against the same canonical implementation-step
  // order used by task-state advancement. This keeps a forged or stale active
  // step from becoming a second executable state source.
  resolveTaskStepForState(body, runtimeState.active_step_id);
  const sourceTuple: RuntimeSourceTuple = {
    path: relativePath,
    revision: sha256(raw),
    document_id: documentId,
    task_id: runtimeState.task_id,
    task_slug: runtimeState.task_slug,
    workflow_status: runtimeState.workflow_status,
    lifecycle_state: runtimeState.lifecycle_state,
    active_step_id: runtimeState.active_step_id,
    active_step_status: runtimeState.active_step_status,
    finding_queue_revision: runtimeState.finding_queue_revision,
    resume_requires_review: runtimeState.resume_requires_review,
    resume_review_reasons: [...runtimeState.resume_review_reasons],
  };
  return { filePath, relativePath, raw, frontmatter, body, runtimeState, sourceTuple };
}

function hydrateCompactRuntimeHistory(root: string, current: CanonicalCurrentTask): void {
  const binding = current.frontmatter.task_store as CurrentTaskStoreBinding;
  const store = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent);
  let manifest;
  try { manifest = store.manifest; } catch (error) {
    fail('RUNTIME_STORAGE_RECOVERY_REQUIRED', error instanceof Error ? error.message : String(error));
  }
  if (!manifest) fail('RUNTIME_STORAGE_RECOVERY_REQUIRED', 'compact CURRENT_TASK has no committed task-store manifest; explicit storage recovery is required.');
  if (store.hasPendingCommit) fail('RUNTIME_STORAGE_RECOVERY_REQUIRED', 'task-store has a pending commit; recover it before reading or executing the task.');
  if (binding.manifest_path !== `${manifest.storage_root}/manifest.json`) {
    fail('RUNTIME_STORAGE_COMPACT_INVALID', 'CURRENT_TASK task-store manifest path does not match the committed aggregate.');
  }
  if (manifest.current_representation !== 'compact-v2' || manifest.storage_format !== 'vnext-task-store/v2') {
    fail('RUNTIME_STORAGE_COMPACT_INVALID', 'compact CURRENT_TASK is bound to a non-compact task-store manifest.');
  }
  if (manifest.head.source_revision !== current.sourceTuple.revision) {
    fail('RUNTIME_STORAGE_RECOVERY_REQUIRED', 'CURRENT_TASK and task-store manifest do not name the same committed source revision.');
  }
  const history = store.hydrateHistory(current as unknown as import('./task-store').TaskStoreCurrent);
  const executionLog = history.execution_log.map((entry, index) => validateExecutionLogEntry(entry, `task-store.execution_log[${index}]`, current.runtimeState.task_id, current.runtimeState.task_slug));
  const appliedProposals = history.applied_proposals.map((entry, index) => {
    const item = expectRecord(entry, `task-store.applied_proposals[${index}]`);
    expectExactKeys(item, ['idempotency_key', 'operation_kind', 'proposal_digest', 'source_revision'], `task-store.applied_proposals[${index}]`);
    return {
      idempotency_key: expectString(item.idempotency_key, `task-store.applied_proposals[${index}].idempotency_key`, SAFE_KEY_PATTERN),
      operation_kind: expectEnum(item.operation_kind, RUNTIME_OPERATION_KINDS, `task-store.applied_proposals[${index}].operation_kind`),
      proposal_digest: expectString(item.proposal_digest, `task-store.applied_proposals[${index}].proposal_digest`, SHA256_PATTERN),
      source_revision: expectString(item.source_revision, `task-store.applied_proposals[${index}].source_revision`, SHA256_PATTERN),
    };
  });
  current.runtimeState = { ...current.runtimeState, execution_log: executionLog, applied_proposals: appliedProposals };
  Object.defineProperty(current.runtimeState, '__vnext_compact_history', { value: true, enumerable: false, configurable: true });
  const validation = store.validateCurrentAggregate(current as unknown as import('./task-store').TaskStoreCurrent);
  if (validation.status !== 'valid') fail('RUNTIME_STORAGE_RECOVERY_REQUIRED', `compact task-store validation failed: ${validation.errors.join(' | ')}`);
}

export function readCanonicalCurrentTask(root: string): CanonicalCurrentTask {
  const { filePath, relativePath } = currentTaskPathForRoot(root);
  assertGovernanceReadable(filePath);
  assertNoArtifactPublication(filePath);
  recoverTaskEvolution(filePath);
  if (!fs.existsSync(filePath)) fail('RUNTIME_SOURCE_MISSING', `CURRENT_TASK.md is missing: ${relativePath}`);
  const current = parseCanonicalCurrentTaskContent(fs.readFileSync(filePath, 'utf8'), filePath, relativePath);
  if (current.frontmatter.task_store !== undefined) hydrateCompactRuntimeHistory(root, current);
  else {
    const legacyStore = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent);
    if (legacyStore.hasPendingCommit && !governanceWriteLockIsHeld(root)) {
      fail('RUNTIME_STORAGE_RECOVERY_REQUIRED', 'CURRENT_TASK has a pending task-store commit; recover it before reading or executing the task.');
    }
  }
  assertRecoveryHistory(root, current);
  if (current.runtimeState.preservation_source_revision) {
    assertTaskHistoryForRevision(filePath, current.sourceTuple.document_id, current.runtimeState.task_id,
      current.runtimeState.preservation_source_revision, 'initialize-preservation');
  }
  return current;
}

function recoveryCurrentFromRaw(
  raw: string,
  filePath: string,
  relativePath: string,
  runtimeState: unknown,
): CanonicalCurrentTask {
  const parsed = parseCanonicalCurrentTaskContent(raw, filePath, relativePath);
  if (!isRecord(runtimeState)) throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'pending commit is missing its exact runtime after-image.');
  parsed.runtimeState = runtimeState as RuntimeState;
  if (parsed.frontmatter.task_store !== undefined) {
    Object.defineProperty(parsed.runtimeState, '__vnext_compact_history', { value: true, enumerable: false, configurable: true });
  }
  return parsed;
}

/**
 * Finish one exact task-store transaction after a process interruption.
 * This function is intentionally called only by a governed write while the
 * normal governance lock is held.  Read-only callers continue to fail closed
 * on a pending marker and report recovery-required.
 */
function recoverPendingTaskStoreCommit(root: string): void {
  const { filePath, relativePath } = currentTaskPathForRoot(root);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseCanonicalCurrentTaskContent(raw, filePath, relativePath);
  const store = TaskStore.forCurrent(root, parsed as unknown as import('./task-store').TaskStoreCurrent);
  const pending = store.pendingCommit;
  if (!isRecord(pending)) return;
  const manifest = store.manifest;
  if (!manifest) throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', 'pending task-store commit has no manifest to recover against.');
  const sequence = pending.sequence;
  const sourceRevision = pending.source_revision;
  const resultingRevision = pending.resulting_source_revision;
  if (typeof sequence !== 'number' || typeof sourceRevision !== 'string' || typeof resultingRevision !== 'string') {
    throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', 'pending task-store commit has incomplete recovery coordinates.');
  }
  if (manifest.head.event_sequence > sequence || manifest.head.event_sequence === sequence) {
    // A manifest that already advanced must prove the same resulting source
    // before the marker can be discarded.  Never choose the newest file by
    // timestamp or silently discard an ambiguous marker.
    if (manifest.head.event_sequence !== sequence || manifest.head.source_revision !== resultingRevision) {
      throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'pending task-store commit conflicts with the already-published aggregate head.');
    }
    if (parsed.sourceTuple.revision !== resultingRevision) {
      throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'CURRENT_TASK does not match the already-published pending task-store head.');
    }
    reconcilePendingWriteSet(root, parsed.sourceTuple.revision, pending);
    store.clearPendingForNoCommit();
    return;
  }
  if (manifest.head.event_sequence !== sequence - 1 || manifest.head.source_revision !== sourceRevision) {
    throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'pending task-store commit is not directly after the committed aggregate head.');
  }
  if (parsed.sourceTuple.revision === sourceRevision) {
    // The canonical file was not published.  The exact pending intent is not
    // a business fact, so it can be discarded without changing task state.
    reconcilePendingWriteSet(root, parsed.sourceTuple.revision, pending);
    store.clearPendingForNoCommit();
    return;
  }
  if (parsed.sourceTuple.revision !== resultingRevision
    || typeof pending.before_raw !== 'string'
    || typeof pending.after_raw !== 'string'
    || pending.before_raw === undefined
    || pending.after_raw === undefined
    || !isRecord(pending.before_runtime_state)
    || !isRecord(pending.after_runtime_state)
    || !isRecord(pending.proposal)
    || !isRecord(pending.result)) {
    throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'CURRENT_TASK advanced during a pending commit but exact recovery material is unavailable.');
  }
  if (sha256(pending.before_raw) !== sourceRevision || sha256(pending.after_raw) !== resultingRevision) {
    throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'pending task-store after-image bytes do not match their recorded revisions.');
  }
  let beforeRuntimeState = pending.before_runtime_state as Record<string, unknown>;
  let afterRuntimeState = pending.after_runtime_state as Record<string, unknown>;
  if (parsed.frontmatter.task_store !== undefined) {
    const persistedExecutionLog = store.readExecutionLog();
    const persistedAppliedProposals = store.readAppliedProposals();
    if (!Array.isArray(beforeRuntimeState.execution_log)) beforeRuntimeState = { ...beforeRuntimeState, execution_log: persistedExecutionLog };
    if (!Array.isArray(beforeRuntimeState.applied_proposals)) beforeRuntimeState = { ...beforeRuntimeState, applied_proposals: persistedAppliedProposals };
    if (!Array.isArray(afterRuntimeState.execution_log)) {
      const delta = Array.isArray(pending.execution_log_entries) ? pending.execution_log_entries : [];
      afterRuntimeState = { ...afterRuntimeState, execution_log: [...persistedExecutionLog, ...delta] };
    }
    if (!Array.isArray(afterRuntimeState.applied_proposals)) {
      const delta = Array.isArray(pending.applied_proposals) ? pending.applied_proposals : [];
      afterRuntimeState = { ...afterRuntimeState, applied_proposals: [...persistedAppliedProposals, ...delta] };
    }
  }
  const before = recoveryCurrentFromRaw(pending.before_raw, filePath, relativePath, beforeRuntimeState);
  const after = recoveryCurrentFromRaw(pending.after_raw, filePath, relativePath, afterRuntimeState);
  if (before.sourceTuple.revision !== sourceRevision || after.sourceTuple.revision !== resultingRevision
    || before.sourceTuple.document_id !== parsed.sourceTuple.document_id
    || after.sourceTuple.document_id !== parsed.sourceTuple.document_id) {
    throw new TaskStoreError('TASK_STORE_IDENTITY_CONFLICT', 'pending task-store recovery images do not describe one task aggregate.');
  }
  reconcilePendingWriteSet(root, parsed.sourceTuple.revision, pending);
  store.markCurrentPublished(resultingRevision);
  const recovered = store.recordCommit({
    before: before as unknown as import('./task-store').TaskStoreCurrent,
    after: after as unknown as import('./task-store').TaskStoreCurrent,
    proposal: pending.proposal,
    result: pending.result as {
      status: string;
      committed: boolean;
      operation_kind?: string;
      idempotency_key?: string;
      message?: string;
      code?: string;
    },
  });
  if (!recovered || recovered.head.source_revision !== resultingRevision || recovered.head.event_sequence !== sequence) {
    throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'pending task-store recovery did not publish the expected aggregate head.');
  }
}

export type CanonicalTaskBasis = TaskBasisArtifact & {
  task_id: string;
  document_id: string;
};

export function readCanonicalTaskBasis(root: string, current = readCanonicalCurrentTask(root)): CanonicalTaskBasis {
  const reference = readTaskBasisReferenceFromBody(current.body);
  if (!reference) fail('TASK_BASIS_MISSING', 'CURRENT_TASK does not link an exact task basis.');
  const expectedPath = taskBasisRelativePath(current.relativePath, current.runtimeState.task_id);
  if (reference.path !== expectedPath) {
    fail('TASK_BASIS_REFERENCE_INVALID', `CURRENT_TASK task basis path must be ${expectedPath}.`);
  }
  const filePath = taskBasisFilePath(root, reference.path);
  if (!fs.existsSync(filePath)) fail('TASK_BASIS_MISSING', `Linked task basis is missing: ${reference.path}`);
  const content = fs.readFileSync(filePath, 'utf8');
  const revision = sha256(content);
  if (revision !== reference.revision) fail('TASK_BASIS_REVISION_CONFLICT', 'Linked task basis revision does not match its file content.');
  const { frontmatter, body } = parseYamlFrontmatter(content, reference.path);
  expectExactKeys(frontmatter, ['schema_version', 'kind', 'task_id', 'document_id', 'original_request', 'user_decisions'], `${reference.path} frontmatter`);
  if (frontmatter.schema_version !== 1 || frontmatter.kind !== VNEXT_TASK_BASIS_KIND) {
    fail('TASK_BASIS_INVALID', `${reference.path} is not a supported vNext task basis.`);
  }
  const taskId = expectString(frontmatter.task_id, `${reference.path}.task_id`);
  const documentId = expectString(frontmatter.document_id, `${reference.path}.document_id`);
  if (taskId !== current.runtimeState.task_id || documentId !== current.sourceTuple.document_id) {
    fail('TASK_BASIS_IDENTITY_CONFLICT', 'Linked task basis identity does not match CURRENT_TASK.');
  }
  if (!/^# vNext TASK_BASIS\s*$/mu.test(body)) fail('TASK_BASIS_INVALID', `${reference.path} is missing its canonical heading.`);
  const basis = validateTaskBasis({
    original_request: frontmatter.original_request,
    user_decisions: frontmatter.user_decisions,
  }, reference.path);
  return {
    ...reference,
    filePath,
    content,
    basis,
    task_id: taskId,
    document_id: documentId,
  };
}

type ArchiveReceipt = {
  filePath: string;
  relativePath: string;
  raw: string;
  revision: string;
  taskId: string;
  taskSlug: string;
  taskTitle: string;
  documentId: string;
  sourceRevision: string;
  archivePath: string;
  idempotencyKey: string;
  closureDeltaDigest: string;
  lessonAdmission: LessonAdmission;
  knowledgeAdmissions: KnowledgeAdmissionBundle;
};

type ArchiveTransactionPlan = {
  next: RuntimeState;
  nextContent: string;
  archiveFilePath: string;
  archiveRelativePath: string;
  nextArchiveContent: string;
  originalArchiveContent?: string;
  audit: ArchiveAuditLogEntry;
  archiveRevision: string;
};

type ProjectStatusTransactionPlan = {
  statusFilePath: string;
  statusRelativePath: string;
  nextStatusContent: string;
  originalStatusContent: string;
  statusRevision: string;
  archive: ArchiveReceipt;
};

type LessonRecordTransactionPlan = {
  lessonsFilePath: string;
  lessonsRelativePath: string;
  nextLessonsContent: string;
  originalLessonsContent: string;
  lessonsRevision: string;
  archive: ArchiveReceipt;
  candidateCount: number;
};

export type CloseTaskPreview = {
  status: 'eligible' | 'blocked' | 'reconciliation';
  task_identity: { task_id: string | null; task_slug: string | null; document_id: string };
  source_tuple: RuntimeSourceTuple;
  archive_path: string;
  closure_eligibility: {
    eligible: boolean;
    blockers: string[];
  };
  delivery_summary: DeliverySummary | null;
  lesson_admission: LessonAdmission | null;
  knowledge_admissions: KnowledgeAdmissionBundle;
  planned_operations: RuntimeOperationKind[];
  governed_mutation_count: 0;
};

function workflowDocPathForRoot(root: string, file: string, missingCode = 'RUNTIME_SOURCE_MISSING'): { filePath: string; relativePath: string } {
  const resolvedRoot = path.resolve(root);
  const profilePath = getWorkflowProfilePath(resolvedRoot);
  if (!fs.existsSync(profilePath)) fail(missingCode, `PROJECT_PROFILE.yaml is missing: ${profilePath}`);
  const profile = loadProfile(profilePath);
  const filePath = getWorkflowDocPath(resolvedRoot, profile, file);
  const relativePath = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    fail('RUNTIME_PATH_INVALID', `${file} path escapes the target root.`);
  }
  return { filePath, relativePath };
}

function archivePathForTask(root: string, current: CanonicalCurrentTask): { filePath: string; relativePath: string } {
  let relativePath: string;
  try {
    relativePath = getTaskArtifactPath(current.runtimeState.task_id, current.runtimeState.task_slug, 'archive');
  } catch (error) {
    fail('RUNTIME_PATH_INVALID', error instanceof Error ? error.message : String(error));
  }
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, ...relativePath.split('/'));
  const relativeCheck = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
  if (relativeCheck !== relativePath || relativeCheck.startsWith('../') || path.isAbsolute(relativeCheck)) {
    fail('RUNTIME_PATH_INVALID', `archive path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}

type InboxRecordProvenance = {
  idempotency_key: string;
  proposal_digest: string;
  source_revision: string;
  source_task_id: string;
  source_task_slug: string;
  source_document_id: string;
  relation_evidence_refs: string[];
  duplicate_check: 'clear';
  proposed_owner: InboxSuggestedNextAction;
};

type InboxRecordFile = {
  filePath: string;
  relativePath: string;
  itemId: string | null;
  provenance: InboxRecordProvenance[];
};

type InboxRecordTransactionPlan = {
  filePath: string;
  relativePath: string;
  nextContent: string;
  existing: boolean;
};

function canonicalInboxRecordTarget(root: string, delta: InboxRecordDelta): { filePath: string; relativePath: string } {
  const itemId = validateInboxItemId(delta.record.item_id, 'semantic_delta.record.item_id');
  const itemSlug = expectString(delta.item_slug, 'semantic_delta.item_slug');
  try {
    validateTaskSlug(itemSlug);
  } catch (error) {
    fail('RUNTIME_IDENTITY_INVALID', error instanceof Error ? error.message : String(error));
  }
  const relativePath = `TASKS/inbox/INBOX-${itemId}-${itemSlug}.md`;
  if (delta.target_path !== relativePath) {
    fail('RUNTIME_PATH_INVALID', 'inbox target_path is not the canonical identity-derived path.');
  }
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, ...relativePath.split('/'));
  const relativeCheck = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
  if (relativeCheck !== relativePath || relativeCheck.startsWith('../') || path.isAbsolute(relativeCheck)) {
    fail('RUNTIME_PATH_INVALID', `inbox path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}

function renderInboxTextBlock(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => `    ${line}`).join('\n');
}

function inboxRecordProvenance(proposal: InboxRecordProposal): InboxRecordProvenance {
  const delta = proposal.semantic_delta;
  return {
    idempotency_key: proposal.idempotency_key,
    proposal_digest: digest(proposal),
    source_revision: proposal.source_tuple.revision,
    source_task_id: proposal.source_tuple.task_id,
    source_task_slug: proposal.source_tuple.task_slug,
    source_document_id: proposal.source_tuple.document_id,
    relation_evidence_refs: [...delta.relation_evidence_refs],
    duplicate_check: delta.duplicate_check,
    proposed_owner: delta.proposed_owner,
  };
}

function renderInboxRecord(proposal: InboxRecordProposal): string {
  const delta = proposal.semantic_delta;
  const record = delta.record;
  const marker = `<!-- vNext inbox record: ${JSON.stringify(inboxRecordProvenance(proposal))} -->`;
  return [
    `# INBOX-${record.item_id}-${delta.item_slug}`,
    '',
    marker,
    '',
    `- artifact_kind: ${record.artifact_kind}`,
    `- item_id: ${record.item_id}`,
    `- title: ${record.title}`,
    `- type: ${record.type}`,
    `- source: ${record.source}`,
    `- captured_at: ${record.captured_at}`,
    `- relation_to_current_task: ${record.relation_to_current_task}`,
    `- current_task_id: ${record.current_task_id}`,
    '- description: |',
    renderInboxTextBlock(record.description),
    '- evidence: |',
    renderInboxTextBlock(record.evidence),
    `- suggested_next_action: ${record.suggested_next_action}`,
    `- status: ${record.status}`,
    '',
  ].join('\n');
}

function validateInboxProvenance(value: unknown, location: string): InboxRecordProvenance {
  const record = expectRecord(value, location);
  expectExactKeys(
    record,
    ['idempotency_key', 'proposal_digest', 'source_revision', 'source_task_id', 'source_task_slug', 'source_document_id', 'relation_evidence_refs', 'duplicate_check', 'proposed_owner'],
    location,
  );
  const proposalDigest = expectString(record.proposal_digest, `${location}.proposal_digest`);
  const sourceRevision = expectString(record.source_revision, `${location}.source_revision`);
  if (!SHA256_PATTERN.test(proposalDigest) || !SHA256_PATTERN.test(sourceRevision)) {
    fail('INBOX_PROVENANCE_INVALID', `${location} contains an invalid proposal or source revision.`);
  }
  const sourceTaskId = expectString(record.source_task_id, `${location}.source_task_id`);
  const sourceTaskSlug = expectString(record.source_task_slug, `${location}.source_task_slug`);
  try {
    validateTaskId(sourceTaskId);
    validateTaskSlug(sourceTaskSlug);
  } catch (error) {
    fail('INBOX_PROVENANCE_INVALID', error instanceof Error ? error.message : String(error));
  }
  const sourceDocumentId = expectString(record.source_document_id, `${location}.source_document_id`);
  if (!DOCUMENT_ID_PATTERN.test(sourceDocumentId)) fail('INBOX_PROVENANCE_INVALID', `${location}.source_document_id is invalid.`);
  return {
    idempotency_key: expectString(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
    proposal_digest: proposalDigest,
    source_revision: sourceRevision,
    source_task_id: sourceTaskId,
    source_task_slug: sourceTaskSlug,
    source_document_id: sourceDocumentId,
    relation_evidence_refs: validateEvidenceRefs(record.relation_evidence_refs, `${location}.relation_evidence_refs`),
    duplicate_check: expectEnum(record.duplicate_check, ['clear'], `${location}.duplicate_check`),
    proposed_owner: expectEnum(record.proposed_owner, INBOX_SUGGESTED_NEXT_ACTIONS, `${location}.proposed_owner`),
  };
}

function readInboxProvenanceMarkers(content: string, location: string): InboxRecordProvenance[] {
  if (!content.includes(INBOX_RECORD_PROVENANCE_MARKER)) return [];
  const pattern = /<!-- vNext inbox record: (\{[^\r\n]+\}) -->/g;
  const markers: InboxRecordProvenance[] = [];
  for (const match of content.matchAll(pattern)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      fail('INBOX_PROVENANCE_INVALID', `${location} contains an invalid vNext inbox provenance marker.`);
    }
    markers.push(validateInboxProvenance(parsed, `${location}.inbox_marker`));
  }
  if (countExactOccurrences(content, INBOX_RECORD_PROVENANCE_MARKER) !== markers.length) {
    fail('INBOX_PROVENANCE_INVALID', `${location} contains a malformed vNext inbox provenance marker.`);
  }
  return markers;
}

function scanInboxRecordFiles(root: string): InboxRecordFile[] {
  const resolvedRoot = path.resolve(root);
  const inboxRoot = path.join(resolvedRoot, 'TASKS', 'inbox');
  return walkMarkdownFiles(inboxRoot).map(filePath => {
    const relativePath = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
    const pathMatch = INBOX_RECORD_PATH_PATTERN.exec(relativePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const provenance = readInboxProvenanceMarkers(content, relativePath);
    if (provenance.length > 0 && !pathMatch) {
      fail('INBOX_PATH_INVALID', `${relativePath} contains vNext inbox provenance but is not a canonical inbox path.`);
    }
    if (!pathMatch) {
      fail('INBOX_PATH_INVALID', `${relativePath} is not a canonical vNext inbox record path.`);
    }
    return {
      filePath,
      relativePath,
      itemId: pathMatch ? `${pathMatch[1]}-${pathMatch[2]}` : null,
      provenance,
    };
  });
}

function assertCanonicalInboxRecordContent(content: string, proposal: InboxRecordProposal, location: string): void {
  const expected = renderInboxRecord(proposal);
  if (content !== expected) {
    fail('INBOX_PROVENANCE_MISMATCH', `${location} does not match the exact typed inbox record bytes.`);
  }
  const markers = readInboxProvenanceMarkers(content, location);
  if (markers.length !== 1) fail('INBOX_PROVENANCE_INVALID', `${location} must contain exactly one vNext inbox provenance marker.`);
  const expectedMarker = inboxRecordProvenance(proposal);
  if (JSON.stringify(markers[0]) !== JSON.stringify(expectedMarker)) {
    fail('INBOX_PROVENANCE_MISMATCH', `${location} provenance does not match the typed proposal.`);
  }
  validateInboxRecord(proposal.semantic_delta.record, `${location}.record`);
}

function inspectInboxRecordTransaction(root: string, proposal: InboxRecordProposal): InboxRecordTransactionPlan {
  const delta = proposal.semantic_delta;
  const target = canonicalInboxRecordTarget(root, delta);
  if (fs.existsSync(target.filePath)) {
    if (!fs.statSync(target.filePath).isFile()) {
      fail('INBOX_IDENTITY_CONFLICT', `${target.relativePath} exists but is not a regular inbox record file.`);
    }
    const existingContent = fs.readFileSync(target.filePath, 'utf8');
    try {
      assertCanonicalInboxRecordContent(existingContent, proposal, target.relativePath);
    } catch (error) {
      if (error instanceof VNextRuntimeError) fail('INBOX_IDENTITY_CONFLICT', `${target.relativePath} already exists with different semantic or provenance content.`);
      fail('INBOX_IDENTITY_CONFLICT', `${target.relativePath} could not be validated as the exact replay record.`);
    }
    return { ...target, nextContent: existingContent, existing: true };
  }

  const files = scanInboxRecordFiles(root);
  for (const file of files) {
    if (file.itemId === delta.record.item_id && file.relativePath !== target.relativePath) {
      fail('INBOX_IDENTITY_CONFLICT', `inbox item identity ${delta.record.item_id} is already claimed by ${file.relativePath}.`);
    }
    if (file.provenance.some(marker => marker.idempotency_key === proposal.idempotency_key && file.relativePath !== target.relativePath)) {
      fail('IDEMPOTENCY_CONFLICT', 'inbox idempotency key is already durably bound to another target.');
    }
  }
  return { ...target, nextContent: renderInboxRecord(proposal), existing: false };
}

function prepareInboxRecordTransaction(root: string, current: CanonicalCurrentTask, proposal: InboxRecordProposal): InboxRecordTransactionPlan {
  ensureAuthorityKinds(proposal, ['evidence-admission']);
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('INBOX_CAPTURE_BLOCKED', 'inbox record capture requires an active + active current task.');
  }
  const delta = proposal.semantic_delta;
  if (delta.record.current_task_id !== current.runtimeState.task_id) {
    fail('INBOX_RELATION_INVALID', 'inbox record current_task_id does not match the canonical active task.');
  }
  return inspectInboxRecordTransaction(root, proposal);
}

function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._:/+@ -]*$/.test(value) && !value.endsWith(' ') && !value.includes('  ')) return value;
  return JSON.stringify(value);
}

function yamlStringArray(values: readonly string[]): string {
  return JSON.stringify(values);
}

function readArchiveScalar(section: string, field: string, location: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const match = new RegExp(`^-\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, 'm').exec(section);
  if (!match) fail('ARCHIVE_INVALID', `${location} is missing ${field}.`);
  const raw = match[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) {
    try {
      return JSON.parse(raw);
    } catch {
      fail('ARCHIVE_INVALID', `${location}.${field} is not a valid scalar.`);
    }
  }
  return expectString(raw, `${location}.${field}`);
}

function readArchiveArray(raw: string, location: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('ARCHIVE_INVALID', `${location} must be a JSON/YAML inline string array.`);
  }
  return expectStringArray(parsed, location, true, MAX_EVIDENCE_REFS);
}

function readArchiveLessonAdmission(section: string, location: string): LessonAdmission {
  const match = /(?:^|\n)lesson_admission:\s*\n\s+decision:\s*(admit|defer|no-op)\s*\n\s+candidate_refs:\s*(\[[^\r\n]*\])\s*\n\s+evidence_refs:\s*(\[[^\r\n]*\])/m.exec(section);
  if (!match) fail('ARCHIVE_INVALID', `${location} is missing the durable lesson_admission record.`);
  return validateLessonAdmission({
    decision: match[1],
    candidate_refs: readArchiveArray(match[2], `${location}.candidate_refs`),
    evidence_refs: readArchiveArray(match[3], `${location}.evidence_refs`),
  }, location);
}

function readArchiveKnowledgeAdmissions(section: string, location: string): KnowledgeAdmissionBundle {
  const match = /(?:^|\n)knowledge_admissions:\s*\n\s+contracts:\s*(\[[^\r\n]*\])\s*\n\s+decisions:\s*(\[[^\r\n]*\])/m.exec(section);
  if (!match) fail('ARCHIVE_INVALID', `${location} is missing the durable knowledge_admissions record.`);
  let contracts: unknown;
  let decisions: unknown;
  try {
    contracts = JSON.parse(match[1]!);
    decisions = JSON.parse(match[2]!);
  } catch {
    fail('ARCHIVE_INVALID', `${location}.knowledge_admissions must contain valid JSON arrays.`);
  }
  return validateKnowledgeAdmissionBundle({ contracts, decisions }, location);
}

function requiredArchiveSections(raw: string): Record<string, MarkdownSectionRange> {
  const sections = scanMarkdownSections(raw);
  const requiredHeadings = [
    '任务元数据',
    '原始任务包快照',
    '实际改动摘要',
    '契约与决策记录',
    '验证与交付证据',
    'Lessons 回写',
    '后续关联',
  ];
  const result: Record<string, MarkdownSectionRange> = {};
  for (const heading of requiredHeadings) {
    const section = findUniqueMarkdownSection(sections, [heading], 2);
    if (!section) fail('ARCHIVE_INVALID', `canonical task archive is missing ## ${heading}.`);
    result[heading] = section;
  }
  return result;
}

function readCanonicalArchive(root: string, current: CanonicalCurrentTask, expectedPath?: string): ArchiveReceipt {
  const expected = archivePathForTask(root, current);
  if (expectedPath !== undefined && expectedPath !== expected.relativePath) {
    fail('RUNTIME_PATH_INVALID', 'archive path is not the exact identity-derived path.');
  }
  if (!fs.existsSync(expected.filePath)) fail('ARCHIVE_MISSING', `canonical task archive is missing: ${expected.relativePath}`);
  const raw = fs.readFileSync(expected.filePath, 'utf8');
  const sections = requiredArchiveSections(raw);
  const metadata = raw.slice(sections['任务元数据'].contentStart, sections['任务元数据'].contentEnd);
  const lessonSection = raw.slice(sections['Lessons 回写'].contentStart, sections['Lessons 回写'].contentEnd);
  const knowledgeSection = findUniqueMarkdownSection(scanMarkdownSections(raw), ['知识晋升', 'Knowledge Promotion'], 2);
  const workflowStatus = readArchiveScalar(metadata, 'workflow_status', 'archive.任务元数据');
  const lifecycleState = readArchiveScalar(metadata, 'lifecycle_state', 'archive.任务元数据');
  const archiveOperation = readArchiveScalar(metadata, 'archive_operation', 'archive.任务元数据');
  const archiveCaller = readArchiveScalar(metadata, 'archive_caller', 'archive.任务元数据');
  const receipt: ArchiveReceipt = {
    filePath: expected.filePath,
    relativePath: expected.relativePath,
    raw,
    revision: sha256(raw),
    taskId: readArchiveScalar(metadata, 'task_id', 'archive.任务元数据'),
    taskSlug: readArchiveScalar(metadata, 'task_slug', 'archive.任务元数据'),
    taskTitle: readArchiveScalar(metadata, 'task_title', 'archive.任务元数据'),
    documentId: readArchiveScalar(metadata, 'document_id', 'archive.任务元数据'),
    sourceRevision: readArchiveScalar(metadata, 'source_revision', 'archive.任务元数据'),
    archivePath: readArchiveScalar(metadata, 'archive_path', 'archive.任务元数据'),
    idempotencyKey: readArchiveScalar(metadata, 'proposal_idempotency_key', 'archive.任务元数据'),
    closureDeltaDigest: readArchiveScalar(metadata, 'closure_delta_digest', 'archive.任务元数据'),
    lessonAdmission: readArchiveLessonAdmission(lessonSection, 'archive.Lessons 回写.lesson_admission'),
    knowledgeAdmissions: knowledgeSection
      ? readArchiveKnowledgeAdmissions(raw.slice(knowledgeSection.contentStart, knowledgeSection.contentEnd), 'archive.知识晋升.knowledge_admissions')
      : emptyKnowledgeAdmissionBundle(),
  };
  if (!/^[a-f0-9]{64}$/.test(receipt.revision) || !/^[a-f0-9]{64}$/.test(receipt.sourceRevision) || !/^[a-f0-9]{64}$/.test(receipt.closureDeltaDigest)) {
    fail('ARCHIVE_INVALID', 'canonical task archive contains an invalid revision or digest.');
  }
  if (!SAFE_KEY_PATTERN.test(receipt.idempotencyKey) || !DOCUMENT_ID_PATTERN.test(receipt.documentId)) {
    fail('ARCHIVE_INVALID', 'canonical task archive contains an invalid idempotency key or document_id.');
  }
  if (workflowStatus !== 'closed' || lifecycleState !== 'archived' || archiveOperation !== 'archive-transaction' || archiveCaller !== 'close-task') {
    fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive metadata does not declare the frozen close-task terminal provenance.');
  }
  if (receipt.taskId !== current.runtimeState.task_id || receipt.taskSlug !== current.runtimeState.task_slug) {
    fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive identity does not match CURRENT_TASK.');
  }
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.title === null || receipt.taskTitle !== identity.title) fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive task_title does not match CURRENT_TASK.');
  if (receipt.documentId !== String(current.frontmatter.document_id)) fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive document_id does not match CURRENT_TASK.');
  if (receipt.archivePath !== expected.relativePath) fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive metadata path does not match its canonical path.');
  return receipt;
}

function archiveAudits(current: CanonicalCurrentTask): ArchiveAuditLogEntry[] {
  return current.runtimeState.execution_log.filter((item): item is ArchiveAuditLogEntry => 'action' in item && item.action === 'archive');
}

function assertArchiveReceiptMatches(current: CanonicalCurrentTask, receipt: ArchiveReceipt, audit: ArchiveAuditLogEntry): void {
  if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived') {
    fail('LIFECYCLE_REPLAY_INCOMPLETE', 'archive receipt requires the closed + archived CURRENT_TASK tuple.');
  }
  if (audit.task_id !== current.runtimeState.task_id || audit.task_slug !== current.runtimeState.task_slug || audit.document_id !== String(current.frontmatter.document_id)) {
    fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive audit identity does not match CURRENT_TASK.');
  }
  if (audit.archive_path !== receipt.relativePath || audit.archive_revision !== receipt.revision || audit.source_revision !== receipt.sourceRevision || audit.idempotency_key !== receipt.idempotencyKey || audit.closure_delta_digest !== receipt.closureDeltaDigest) {
    fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive receipt does not match the durable CURRENT_TASK archive audit.');
  }
  if (audit.lesson_admission.decision !== receipt.lessonAdmission.decision
    || audit.lesson_admission.candidate_refs.join('|') !== receipt.lessonAdmission.candidate_refs.join('|')
    || audit.lesson_admission.evidence_refs.join('|') !== receipt.lessonAdmission.evidence_refs.join('|')) {
    fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive lesson admission does not match the durable CURRENT_TASK archive audit.');
  }
  if (digest(audit.knowledge_admissions) !== digest(receipt.knowledgeAdmissions)) {
    fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive knowledge admission does not match the durable CURRENT_TASK archive audit.');
  }
}

function matchingArchiveReceipt(root: string, current: CanonicalCurrentTask): { audit: ArchiveAuditLogEntry; receipt: ArchiveReceipt } {
  const audits = archiveAudits(current);
  if (audits.length !== 1) fail('LIFECYCLE_REPLAY_INCOMPLETE', 'CURRENT_TASK must contain exactly one durable archive audit for reconciliation.');
  const audit = audits[0]!;
  assertExecutionAudit(root, current, audit);
  if (audit.from_workflow_status !== 'active' || audit.from_lifecycle_state !== 'active' || audit.to_workflow_status !== 'closed' || audit.to_lifecycle_state !== 'archived') {
    fail('LIFECYCLE_REPLAY_INCOMPLETE', 'archive audit does not describe the frozen active + active to closed + archived transition.');
  }
  const receipt = readCanonicalArchive(root, current, audit.archive_path);
  assertArchiveReceiptMatches(current, receipt, audit);
  return { audit, receipt };
}

function closureEligibilityBlockers(root: string, current: CanonicalCurrentTask, delta: ArchiveDelta, archiveAlreadyExists: boolean): string[] {
  const blockers: string[] = [];
  try {
    assertTestStrategySequenceReady(current);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  const coverage = current.runtimeState.review_coverage;
  if (coverage && (coverage.pending_paths.length || coverage.last_clean_revision !== coverage.target.revision || captureReviewTarget(root, coverage.target.entries.map(e => e.path)).revision !== coverage.target.revision)) blockers.push('cumulative review coverage is pending or stale.');
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.id === null || identity.slug === null || identity.title === null) blockers.push('task identity is not fully materialized in CURRENT_TASK.');
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') blockers.push('first successful close requires active + active.');
  if (current.runtimeState.resume_requires_review || current.runtimeState.resume_review_reasons.length > 0) blockers.push('resume review gate is not cleared.');
  if (current.runtimeState.active_step_status !== 'completed') blockers.push('the admitted current step is not completed.');
  if ((current.runtimeState.evidence_challenges ?? []).some(item => item.status !== 'resolved')) blockers.push('challenged evidence remains unresolved.');
  try {
    const stepResolution = resolveCanonicalTaskStep(current);
    const checkpoint = effectiveCheckpointPolicy(stepResolution);
    if (stepResolution.next !== null) {
      blockers.push('remaining implementation steps have not been durably advanced to completion.');
    }
    if (stepResolution.steps.length > 1) {
      const completedRecord = currentDefinitionExecutionLog(current).find((item): item is StepExecutionLogEntry =>
        !('action' in item)
        && item.step_id === stepResolution.current.id
        && item.status === 'completed'
        && item.advancement === 'task-complete',
      );
      if (!completedRecord) blockers.push('the final multi-step completion lacks a durable task-complete advancement record.');
      if (checkpoint === 'required' && !completedRecord?.review_receipt) {
        blockers.push('the final required review checkpoint has no durable clean receipt.');
      }
    }
    const repairRecords = currentDefinitionExecutionLog(current).filter((item): item is StepExecutionLogEntry =>
      !('action' in item) && item.step_id === stepResolution.current.id && item.mode === 'repair',
    );
    if (repairRecords.length > 0) {
      const repairFingerprints = [...new Set(repairRecords.flatMap(item => [
        ...(item.repair_fingerprints ?? []),
        ...(item.repair_fingerprint ? [item.repair_fingerprint] : []),
      ]))];
      const repairTargets = [...new Set(repairRecords.map(item => item.change_set_id).filter((value): value is string => Boolean(value)))];
      const verified = currentDefinitionExecutionLog(current).some((item): item is StepExecutionLogEntry => {
        if ('action' in item || item.step_id !== stepResolution.current.id || item.review_receipt?.cycle_phase !== 'verification') return false;
        const receipt = item.review_receipt;
        return receipt !== undefined
          && receipt.admitted_fingerprints.length === repairFingerprints.length
          && repairFingerprints.every(fingerprint => receipt.admitted_fingerprints.includes(fingerprint))
          && (repairTargets.length === 0 || receipt.change_set_id === repairTargets[0]);
      });
      if (!verified) blockers.push('every repair route must have a durable same-diff verification receipt before closure.');
      if (repairRecords.some(item => (!(item.repair_fingerprint || item.repair_fingerprints?.length)) || !item.change_set_id)) blockers.push('a repair execution record is missing its finding fingerprints or logical change-set identity.');
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (current.runtimeState.findings.some(item => item.status === 'admitted' || item.status === 'in-progress')) blockers.push('an admitted or in-progress finding remains unresolved.');
  if (!claimEvidenceStateEnabled(current.runtimeState)) {
    blockers.push('structured claim-bound evidence migration is required before terminal closure; legacy CURRENT_TASK completion evidence is not sufficient.');
  } else {
    const durableClaimEvidence = evaluateClaimEvidence(current.runtimeState.claim_evidence ?? [], { root, current });
    if (delta.closure_evidence.acceptance_satisfied !== durableClaimEvidence.acceptance_satisfied) {
      blockers.push('closure acceptance_satisfied does not match durable claim-bound evidence state.');
    }
    if (delta.closure_evidence.validation_complete !== durableClaimEvidence.validation_complete) {
      blockers.push('closure validation_complete does not match durable claim-bound evidence state.');
    }
    if (!durableClaimEvidence.acceptance_satisfied) blockers.push('durable claim-bound acceptance evidence is incomplete.');
    if (!durableClaimEvidence.validation_complete) blockers.push('durable claim-bound validation evidence is incomplete.');
  }
  if (!delta.closure_evidence.acceptance_satisfied) blockers.push('acceptance evidence is not satisfied.');
  if (!delta.closure_evidence.validation_complete) blockers.push('required validation evidence is incomplete.');
  if (!delta.closure_evidence.no_admitted_or_in_progress_findings) blockers.push('closure evidence does not prove the finding queue is clear.');
  if (!delta.closure_evidence.no_unresolved_closure_blocker) blockers.push('an unresolved closure blocker remains.');
  for (const [label, gate] of [
    ['release', delta.closure_evidence.release_evidence],
    ['rollback', delta.closure_evidence.rollback_evidence],
    ['observation', delta.closure_evidence.observation_evidence],
  ] as const) {
    if (gate.triggered && !gate.complete) blockers.push(`${label} evidence is triggered but incomplete.`);
  }
  if (!delta.closure_evidence.remaining_risks_non_blocking) blockers.push('remaining risks are not explicitly non-blocking.');
  if (!delta.closure_evidence.archive_path_verified) blockers.push('the archive path has not been uniquely verified.');
  if (archiveAlreadyExists) blockers.push('the canonical archive path is already occupied before the first close.');
  return blockers;
}

function assertArchiveReplay(root: string, current: CanonicalCurrentTask, proposal: ArchiveProposal): void {
  const { audit, receipt } = matchingArchiveReceipt(root, current);
  if (audit.idempotency_key !== proposal.idempotency_key
    || audit.source_revision !== proposal.source_tuple.revision
    || audit.task_id !== proposal.source_tuple.task_id
    || audit.task_slug !== proposal.source_tuple.task_slug
    || audit.document_id !== proposal.source_tuple.document_id
    || audit.closure_delta_digest !== digest(proposal.semantic_delta)
    || audit.evidence_refs.join('|') !== proposal.semantic_delta.evidence_refs.join('|')
    || digest(audit.authority_evidence) !== digest(proposal.authority_evidence)
    || digest(audit.knowledge_admissions) !== digest(proposal.semantic_delta.knowledge_admissions ?? emptyKnowledgeAdmissionBundle())
    || receipt.revision !== audit.archive_revision) {
    fail('LIFECYCLE_REPLAY_INCOMPLETE', 'archive replay identity, source revision, closure evidence, or archive revision does not match the committed receipt.');
  }
}

function quotedSnapshot(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').split('\n').map(line => `> ${line}`).join('\n');
}

function renderArchiveList(label: string, values: readonly string[]): string[] {
  return [
    `- ${label}:`,
    ...(values.length === 0 ? ['  - none'] : values.map(value => `  - ${yamlScalar(value)}`)),
  ];
}

function renderArchiveDocument(
  current: CanonicalCurrentTask,
  proposal: ArchiveProposal,
  delta: ArchiveDelta,
  archiveRelativePath: string,
  closureDeltaDigest: string,
): string {
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.id === null || identity.slug === null || identity.title === null) {
    fail('RUNTIME_IDENTITY_INVALID', 'CURRENT_TASK task identity is incomplete for archive rendering.');
  }
  const closure = delta.closure_evidence;
  const lines: string[] = [
    '# TASK_ARCHIVE.md',
    '',
    '## 任务元数据',
    '',
    `- task_id: ${yamlScalar(identity.id)}`,
    `- task_title: ${yamlScalar(identity.title)}`,
    `- task_slug: ${yamlScalar(identity.slug)}`,
    `- document_id: ${yamlScalar(current.sourceTuple.document_id)}`,
    `- workflow_status: closed`,
    `- lifecycle_state: archived`,
    `- source_revision: ${current.sourceTuple.revision}`,
    `- archive_path: ${archiveRelativePath}`,
    `- archive_operation: archive-transaction`,
    `- archive_caller: close-task`,
    `- proposal_idempotency_key: ${yamlScalar(proposal.idempotency_key)}`,
    `- closure_delta_digest: ${closureDeltaDigest}`,
    '',
    '## 原始任务包快照',
    '',
    `- source_document_revision: ${current.sourceTuple.revision}`,
    '- CURRENT_TASK snapshot:',
    quotedSnapshot(current.raw),
    '',
    '## 实际改动摘要',
    '',
    `- goal: ${yamlScalar(delta.delivery_summary.goal)}`,
    ...renderArchiveList('actual_changes', delta.delivery_summary.actual_changes),
    '',
    '## 契约与决策记录',
    '',
    '- affected_contracts: preserved in the CURRENT_TASK snapshot; admitted Contract candidates are reconciled after archive through the typed Runtime operation.',
    '- confirmed_decisions: preserved in the CURRENT_TASK snapshot; admitted Decision candidates are reconciled after archive through the typed Runtime operation.',
    '',
    '## 验证与交付证据',
    '',
    '- closure_evidence:',
    `  - acceptance_satisfied: ${String(closure.acceptance_satisfied)}`,
    `  - validation_complete: ${String(closure.validation_complete)}`,
    `  - no_admitted_or_in_progress_findings: ${String(closure.no_admitted_or_in_progress_findings)}`,
    `  - no_unresolved_closure_blocker: ${String(closure.no_unresolved_closure_blocker)}`,
    '  - release_evidence:',
    `    - triggered: ${String(closure.release_evidence.triggered)}`,
    `    - complete: ${String(closure.release_evidence.complete)}`,
    `    - evidence_refs: ${yamlStringArray(closure.release_evidence.evidence_refs)}`,
    '  - rollback_evidence:',
    `    - triggered: ${String(closure.rollback_evidence.triggered)}`,
    `    - complete: ${String(closure.rollback_evidence.complete)}`,
    `    - evidence_refs: ${yamlStringArray(closure.rollback_evidence.evidence_refs)}`,
    '  - observation_evidence:',
    `    - triggered: ${String(closure.observation_evidence.triggered)}`,
    `    - complete: ${String(closure.observation_evidence.complete)}`,
    `    - evidence_refs: ${yamlStringArray(closure.observation_evidence.evidence_refs)}`,
    `  - remaining_risks_non_blocking: ${String(closure.remaining_risks_non_blocking)}`,
    `  - archive_path_verified: ${String(closure.archive_path_verified)}`,
    '',
    `- acceptance_satisfied: ${String(closure.acceptance_satisfied)}`,
    `- validation_complete: ${String(closure.validation_complete)}`,
    ...renderArchiveList('verification', delta.delivery_summary.verification),
    ...renderArchiveList('release_evidence', delta.delivery_summary.release_evidence),
    ...renderArchiveList('rollback_evidence', delta.delivery_summary.rollback_evidence),
    ...renderArchiveList('observation_evidence', delta.delivery_summary.observation_evidence),
    `- next_action: ${yamlScalar(delta.delivery_summary.next_action)}`,
    '',
    '## 知识晋升',
    '',
    'knowledge_admissions:',
    `  contracts: ${JSON.stringify(delta.knowledge_admissions?.contracts ?? [])}`,
    `  decisions: ${JSON.stringify(delta.knowledge_admissions?.decisions ?? [])}`,
    '',
    '## Lessons 回写',
    '',
    'lesson_admission:',
    `  decision: ${delta.lesson_admission.decision}`,
    `  candidate_refs: ${yamlStringArray(delta.lesson_admission.candidate_refs)}`,
    `  evidence_refs: ${yamlStringArray(delta.lesson_admission.evidence_refs)}`,
    '',
    '## 后续关联',
    '',
    ...renderArchiveList('remaining_risks', delta.remaining_risks),
    `- remaining_risks_non_blocking: ${String(closure.remaining_risks_non_blocking)}`,
    '- next_task: none created by close-task.',
    '',
  ];
  return lines.join('\n');
}

function makeArchiveAudit(
  current: CanonicalCurrentTask,
  proposal: ArchiveProposal,
  delta: ArchiveDelta,
  archiveRelativePath: string,
  archiveRevision: string,
  closureDeltaDigest: string,
  next: RuntimeState,
  now: string,
): ArchiveAuditLogEntry {
  return {
    action: 'archive',
    idempotency_key: proposal.idempotency_key,
    operation_kind: 'archive-transaction',
    caller: 'close-task',
    mode: 'default',
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    document_id: current.sourceTuple.document_id,
    from_workflow_status: 'active',
    from_lifecycle_state: 'active',
    to_workflow_status: next.workflow_status as 'closed',
    to_lifecycle_state: next.lifecycle_state as 'archived',
    source_revision: current.sourceTuple.revision,
    archive_path: archiveRelativePath,
    archive_revision: archiveRevision,
    closure_delta_digest: closureDeltaDigest,
    authority_evidence: proposal.authority_evidence.map(item => ({ ...item })),
    evidence_refs: [...delta.evidence_refs],
    lesson_admission: {
      decision: delta.lesson_admission.decision,
      candidate_refs: [...delta.lesson_admission.candidate_refs],
      evidence_refs: [...delta.lesson_admission.evidence_refs],
    },
    knowledge_admissions: {
      contracts: (delta.knowledge_admissions?.contracts ?? []).map(item => ({
        candidate: item.candidate,
        disposition: item.disposition,
        matched_knowledge_id: item.matched_knowledge_id,
        reasons: [...item.reasons],
      })),
      decisions: (delta.knowledge_admissions?.decisions ?? []).map(item => ({
        candidate: item.candidate,
        disposition: item.disposition,
        matched_knowledge_id: item.matched_knowledge_id,
        reasons: [...item.reasons],
      })),
    },
    recorded_at: now,
  };
}

function prepareArchiveTransaction(root: string, current: CanonicalCurrentTask, proposal: ArchiveProposal, now: string): ArchiveTransactionPlan | null {
  const delta = proposal.semantic_delta;
  ensureAuthorityKinds(proposal, ['active-task-owner', 'evidence-admission']);
  if (current.runtimeState.workflow_status === 'closed' && current.runtimeState.lifecycle_state === 'archived') {
    const { audit, receipt } = matchingArchiveReceipt(root, current);
    if (digest(delta) !== audit.closure_delta_digest) {
      fail('ARCHIVE_PROVENANCE_MISMATCH', 'reconciliation closure evidence does not match the committed archive receipt.');
    }
    if (delta.lesson_admission.decision !== audit.lesson_admission.decision
      || delta.lesson_admission.candidate_refs.join('|') !== audit.lesson_admission.candidate_refs.join('|')
      || delta.lesson_admission.evidence_refs.join('|') !== audit.lesson_admission.evidence_refs.join('|')) {
      fail('ARCHIVE_PROVENANCE_MISMATCH', 'reconciliation lesson admission does not match the committed archive receipt.');
    }
    if (digest(delta.knowledge_admissions ?? emptyKnowledgeAdmissionBundle()) !== digest(audit.knowledge_admissions)) {
      fail('ARCHIVE_PROVENANCE_MISMATCH', 'reconciliation knowledge admission does not match the committed archive receipt.');
    }
    if (receipt.sourceRevision !== audit.source_revision) fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive source revision does not match the committed archive audit.');
    return null;
  }
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('CLOSURE_TUPLE_INVALID', 'first successful close requires active + active.');
  }
  const archiveTarget = archivePathForTask(root, current);
  const blockers = closureEligibilityBlockers(root, current, delta, fs.existsSync(archiveTarget.filePath));
  if (blockers.length > 0) fail('CLOSURE_NOT_ELIGIBLE', blockers.join(' '));
  const closureDeltaDigest = digest(delta);
  const nextWithoutAudit: RuntimeState = {
    ...current.runtimeState,
    workflow_status: 'closed',
    lifecycle_state: 'archived',
    resume_requires_review: false,
    resume_review_reasons: [],
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
  };
  const nextArchiveContent = renderArchiveDocument(current, proposal, delta, archiveTarget.relativePath, closureDeltaDigest);
  const archiveRevision = sha256(nextArchiveContent);
  const audit = makeArchiveAudit(current, proposal, delta, archiveTarget.relativePath, archiveRevision, closureDeltaDigest, nextWithoutAudit, now);
  const next: RuntimeState = {
    ...nextWithoutAudit,
    execution_log: appendExecutionLogEntry(current.runtimeState, audit),
  };
  const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, next, { audit });
  return {
    next,
    nextContent,
    archiveFilePath: archiveTarget.filePath,
    archiveRelativePath: archiveTarget.relativePath,
    nextArchiveContent,
    audit,
    archiveRevision,
  };
}

const STATUS_RECONCILIATION_BEGIN = '<!-- BEGIN vNext close-task STATUS reconciliation -->';
const STATUS_RECONCILIATION_END = '<!-- END vNext close-task STATUS reconciliation -->';

type StatusReceipt = {
  taskId: string;
  taskSlug: string;
  documentId: string;
  archivePath: string;
  archiveRevision: string;
  sourceRevision: string;
  idempotencyKey: string;
  deltaDigest: string;
  status: ProjectStatusDelta['status'];
  summary: string;
  completedItems: string[];
  remainingRisks: string[];
  nextCheckpoint: string;
  evidenceRefs: string[];
};

export type StatusReconciliationReceipt = StatusReceipt;

function renderStatusReconciliation(proposal: ProjectStatusProposal, delta: ProjectStatusDelta, archive: ArchiveReceipt): string {
  return [
    STATUS_RECONCILIATION_BEGIN,
    `- task_id: ${yamlScalar(archive.taskId)}`,
    `- task_slug: ${yamlScalar(archive.taskSlug)}`,
    `- document_id: ${yamlScalar(archive.documentId)}`,
    `- archive_path: ${archive.relativePath}`,
    `- archive_revision: ${archive.revision}`,
    `- source_revision: ${archive.sourceRevision}`,
    `- proposal_idempotency_key: ${yamlScalar(proposal.idempotency_key)}`,
    `- delta_digest: ${digest(delta)}`,
    `- status: ${delta.status}`,
    `- summary: ${yamlScalar(delta.summary)}`,
    `- completed_items: ${yamlStringArray(delta.completed_items)}`,
    `- remaining_risks: ${yamlStringArray(delta.remaining_risks)}`,
    `- next_checkpoint: ${yamlScalar(delta.next_checkpoint)}`,
    `- evidence_refs: ${yamlStringArray(delta.evidence_refs)}`,
    STATUS_RECONCILIATION_END,
  ].join('\n');
}

function readStatusScalar(body: string, field: string, location: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const match = new RegExp(`^-\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, 'm').exec(body);
  if (!match) fail('STATUS_INVALID', `${location} reconciliation receipt is missing ${field}.`);
  const raw = match[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) {
    try {
      return JSON.parse(raw);
    } catch {
      fail('STATUS_INVALID', `${location}.${field} is not a valid scalar.`);
    }
  }
  return expectString(raw, `${location}.${field}`);
}

function readStatusArray(body: string, field: string, location: string): string[] {
  const raw = readStatusScalar(body, field, location);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('STATUS_INVALID', `${location}.${field} must be a JSON/YAML inline string array.`);
  }
  return expectStringArray(parsed, `${location}.${field}`, true, 64);
}

function statusDeltaFromReceipt(receipt: StatusReceipt): ProjectStatusDelta {
  return {
    kind: 'project-status',
    action: 'sync',
    status: receipt.status,
    summary: receipt.summary,
    completed_items: [...receipt.completedItems],
    remaining_risks: [...receipt.remainingRisks],
    next_checkpoint: receipt.nextCheckpoint,
    evidence_refs: [...receipt.evidenceRefs],
  };
}

function readStatusReceipts(content: string, location: string): StatusReceipt[] {
  const pattern = new RegExp(`${STATUS_RECONCILIATION_BEGIN.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\r?\\n([\\s\\S]*?)\\r?\\n${STATUS_RECONCILIATION_END.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`, 'g');
  const receipts: StatusReceipt[] = [];
  for (const match of content.matchAll(pattern)) {
    const body = match[1] ?? '';
    const archiveRevision = readStatusScalar(body, 'archive_revision', location);
    const sourceRevision = readStatusScalar(body, 'source_revision', location);
    const deltaDigest = readStatusScalar(body, 'delta_digest', location);
    if (!/^[a-f0-9]{64}$/.test(archiveRevision) || !/^[a-f0-9]{64}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(deltaDigest)) {
      fail('STATUS_INVALID', `${location} reconciliation receipt has an invalid revision or digest.`);
    }
    const receipt: StatusReceipt = {
      taskId: readStatusScalar(body, 'task_id', location),
      taskSlug: readStatusScalar(body, 'task_slug', location),
      documentId: readStatusScalar(body, 'document_id', location),
      archivePath: normalizeRepoPath(readStatusScalar(body, 'archive_path', location), `${location}.archive_path`),
      archiveRevision,
      sourceRevision,
      idempotencyKey: readStatusScalar(body, 'proposal_idempotency_key', location),
      deltaDigest,
      status: expectEnum(readStatusScalar(body, 'status', location), ['completed', 'observing'], `${location}.status`),
      summary: readStatusScalar(body, 'summary', location),
      completedItems: readStatusArray(body, 'completed_items', location),
      remainingRisks: readStatusArray(body, 'remaining_risks', location),
      nextCheckpoint: readStatusScalar(body, 'next_checkpoint', location),
      evidenceRefs: readStatusArray(body, 'evidence_refs', location),
    };
    if (!SAFE_KEY_PATTERN.test(receipt.idempotencyKey)) fail('STATUS_INVALID', `${location}.proposal_idempotency_key is invalid.`);
    if (!DOCUMENT_ID_PATTERN.test(receipt.documentId)) fail('STATUS_INVALID', `${location}.document_id is invalid.`);
    try {
      validateTaskId(receipt.taskId);
      validateTaskSlug(receipt.taskSlug);
    } catch (error) {
      fail('STATUS_INVALID', error instanceof Error ? error.message : String(error));
    }
    if (digest(statusDeltaFromReceipt(receipt)) !== receipt.deltaDigest) {
      fail('STATUS_INVALID', `${location} reconciliation receipt delta digest does not match its typed fields.`);
    }
    if (receipts.some(existing => existing.archivePath === receipt.archivePath)) {
      fail('STATUS_INVALID', `${location} contains duplicate reconciliation receipts for ${receipt.archivePath}.`);
    }
    receipts.push(receipt);
  }
  return receipts;
}

function matchingStatusReceipt(content: string, location: string, archive: ArchiveReceipt): StatusReceipt | null {
  const receipts = readStatusReceipts(content, location);
  const matches = receipts.filter(receipt =>
    receipt.archivePath === archive.relativePath
    || (receipt.taskId === archive.taskId && receipt.taskSlug === archive.taskSlug && receipt.documentId === archive.documentId),
  );
  if (matches.length > 1) fail('STATUS_INVALID', `${location} contains multiple receipts for the same archived task.`);
  return matches[0] ?? null;
}

const STATUS_PLACEHOLDER_VALUES = new Set(['none', 'n/a', '无', '暂无']);

function statusItemText(line: string): string | null {
  const match = /^-\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(line);
  if (!match) return null;
  const value = match[1]!.trim();
  if (value.length === 0 || STATUS_PLACEHOLDER_VALUES.has(value.toLowerCase())) return null;
  return value;
}

function isStatusPlaceholderLine(line: string): boolean {
  const match = /^-\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(line);
  return match !== null && STATUS_PLACEHOLDER_VALUES.has(match[1]!.trim().toLowerCase());
}

function validateStatusProjectionText(value: string, location: string): string {
  if (value.includes('\n') || value.includes('\r')) {
    fail('STATUS_RECONCILIATION_CONFLICT', `${location} cannot contain a line break.`);
  }
  return value.trim();
}

function requiredStatusSection(content: string, sectionKey: StatusSectionKey, location: string): MarkdownSectionRange {
  const definition = STATUS_SECTIONS[sectionKey];
  const title = definition.title;
  const aliases = 'aliases' in definition ? definition.aliases : [title];
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), aliases, 2);
  if (!section) fail('STATUS_INVALID', `${location} is missing the required ## ${title} section.`);
  return section;
}

export function validateStatusDocument(content: string, location = 'STATUS.md'): void {
  const sections = scanMarkdownSections(content);
  for (const key of STATUS_SECTION_KEYS) {
    const definition = STATUS_SECTIONS[key];
    const title = definition.title;
    const aliases = 'aliases' in definition ? definition.aliases : [title];
    if (!findUniqueMarkdownSection(sections, aliases, 2)) fail('STATUS_INVALID', `${location} is missing the required ## ${title} section.`);
  }
}

export function readStatusReconciliationReceipts(content: string, location = 'STATUS.md'): StatusReconciliationReceipt[] {
  validateStatusDocument(content, location);
  const beginCount = countExactOccurrences(content, STATUS_RECONCILIATION_BEGIN);
  const endCount = countExactOccurrences(content, STATUS_RECONCILIATION_END);
  if (beginCount !== endCount) fail('STATUS_INVALID', `${location} contains an incomplete reconciliation marker.`);
  return readStatusReceipts(content, location).map(receipt => ({
    ...receipt,
    completedItems: [...receipt.completedItems],
    remainingRisks: [...receipt.remainingRisks],
    evidenceRefs: [...receipt.evidenceRefs],
  }));
}

function assertStatusReceiptProjection(content: string, receipts: readonly StatusReceipt[], location: string): void {
  if (receipts.length === 0) return;

  const completedLines = readStatusSectionLines(content, 'completed', location);
  const developmentLines = readStatusSectionLines(content, 'inProgress', location);
  const riskLines = readStatusSectionLines(content, 'risks', location);
  for (const receipt of receipts) {
    for (const rawItem of receipt.completedItems) {
      const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
      if (statusItemMatchCount(completedLines, item) !== 1 || statusItemMatchCount(developmentLines, item) !== 0) {
        fail('STATUS_PROVENANCE_MISMATCH', `${location} completed item projection no longer matches "${item}".`);
      }
    }
    for (const rawItem of receipt.remainingRisks) {
      const item = validateStatusProjectionText(rawItem, `${location}.remaining_risks`);
      if (statusItemMatchCount(riskLines, item) !== 1) {
        fail('STATUS_PROVENANCE_MISMATCH', `${location} remaining risk projection no longer matches "${item}".`);
      }
    }
  }

  // STATUS is cumulative: historical completed/risk projections remain, while
  // the latest transaction owns the current overview and checkpoint projection.
  assertStatusProjection(content, statusDeltaFromReceipt(receipts[receipts.length - 1]!), location);
}

/**
 * Read STATUS for Bootstrap realignment through the Runtime-owned semantic
 * boundary. In addition to structure and receipt provenance, this validates
 * the cumulative visible projection against the receipt history.
 */
export function readCanonicalStatusDocumentForBootstrap(content: string, location = 'STATUS.md'): StatusReconciliationReceipt[] {
  const receipts = readStatusReconciliationReceipts(content, location);
  assertStatusReceiptProjection(content, receipts, location);
  return receipts;
}

function canonicalizeStatusOverviewLines(
  lines: readonly string[],
  project: { name: string; slug: string },
  mode: BootstrapMode,
  location: string,
): string[] {
  const fields = [
    { pattern: /^-\s*(?:项目|project)\s*[:：]\s*.*$/i, line: `- 项目：${project.name}` },
    { pattern: /^-\s*(?:slug|project[_ ]slug)\s*[:：]\s*.*$/i, line: `- slug：${project.slug}` },
    { pattern: /^-\s*(?:bootstrap[_ ]mode|bootstrap mode)\s*[:：]\s*.*$/i, line: `- bootstrap mode：${mode}` },
  ] as const;
  const next = [...lines];
  for (const field of fields) {
    const matches = next
      .map((line, index) => ({ line, index }))
      .filter(item => field.pattern.test(item.line));
    if (matches.length > 1) fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains multiple Bootstrap overview fields.`);
    if (matches.length === 1) next[matches[0]!.index] = field.line;
    else next.push(field.line);
  }
  return next;
}

/**
 * Canonicalize the Bootstrap-owned STATUS structure without re-projecting any
 * Runtime-owned status section or reconciliation receipt. This is shared with
 * Bootstrap so the Runtime remains the only STATUS semantic parser.
 */
export function canonicalizeStatusDocumentForBootstrap(
  content: string,
  project: { name: string; slug: string },
  mode: BootstrapMode,
  location = 'STATUS.md',
): string {
  readCanonicalStatusDocumentForBootstrap(content, location);
  const sections = scanMarkdownSections(content);
  const canonicalSections = new Set<number>();
  const output: string[] = [];
  const firstTopLevel = sections
    .filter(section => section.level === 2)
    .sort((left, right) => left.headingStart - right.headingStart)[0];
  const prefix = firstTopLevel
    ? content.slice(0, firstTopLevel.headingStart).replace(/\r\n?/g, '\n').trimEnd()
    : '';
  output.push(prefix || '# STATUS.md', '');

  for (const key of STATUS_SECTION_KEYS) {
    const definition = STATUS_SECTIONS[key];
    const aliases = 'aliases' in definition ? definition.aliases : [definition.title];
    const section = findUniqueMarkdownSection(sections, aliases, 2);
    if (!section) fail('STATUS_INVALID', `${location} is missing the required ## ${definition.title} section.`);
    canonicalSections.add(section.headingStart);
    const body = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trim();
    const bodyLines = body.length > 0 ? body.split('\n') : [];
    output.push(
      `## ${definition.title}`,
      '',
      ...(key === 'overview' ? canonicalizeStatusOverviewLines(bodyLines, project, mode, location) : bodyLines),
      '',
    );
  }

  for (const section of sections.filter(item => item.level === 2).sort((left, right) => left.headingStart - right.headingStart)) {
    if (canonicalSections.has(section.headingStart)) continue;
    const preserved = content.slice(section.headingStart, section.contentEnd).replace(/\r\n?/g, '\n').trimEnd();
    if (preserved.trim().length > 0) output.push(preserved, '');
  }

  const next = output.join('\n');
  readCanonicalStatusDocumentForBootstrap(next, location);
  return next;
}

function readStatusSectionLines(content: string, sectionKey: StatusSectionKey, location: string): string[] {
  const section = requiredStatusSection(content, sectionKey, location);
  const body = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trim();
  return body.length > 0 ? body.split('\n') : [];
}

function replaceStatusSectionBody(content: string, sectionKey: StatusSectionKey, lines: readonly string[], location: string): string {
  const section = requiredStatusSection(content, sectionKey, location);
  const body = lines.join('\n').trim();
  return content.slice(0, section.contentStart) + `${body.length > 0 ? `\n${body}\n\n` : '\n'}` + content.slice(section.contentEnd);
}

function statusItemMatchCount(lines: readonly string[], item: string): number {
  return lines.filter(line => statusItemText(line) === item).length;
}

function projectStatusOverview(content: string, delta: ProjectStatusDelta, location: string): string {
  const lines = readStatusSectionLines(content, 'overview', location);
  const statusFieldPattern = /^-\s*(?:当前状态|status)\s*[:：]\s*.*$/i;
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(item => statusFieldPattern.test(item.line));
  if (matches.length > 1) fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains multiple project status fields.`);
  const statusLine = `- 当前状态：${delta.status}`;
  if (matches.length === 1) {
    const next = [...lines];
    next[matches[0]!.index] = statusLine;
    return replaceStatusSectionBody(content, 'overview', next, location);
  }
  return replaceStatusSectionBody(content, 'overview', [...lines, statusLine], location);
}

function projectStatusCompletedItems(content: string, delta: ProjectStatusDelta, location: string): string {
  const completedLines = readStatusSectionLines(content, 'completed', location);
  const developmentLines = readStatusSectionLines(content, 'inProgress', location);
  const unsupportedDevelopmentLines = developmentLines.filter(line =>
    line.trim().length > 0
    && statusItemText(line) === null
    && !isStatusPlaceholderLine(line),
  );
  if (unsupportedDevelopmentLines.length > 0) {
    fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains unsupported content in the in-progress section; the old record cannot be identified deterministically.`);
  }
  const meaningfulDevelopment = developmentLines
    .map(statusItemText)
    .filter((item): item is string => item !== null);
  const removeDevelopmentIndexes = new Set<number>();
  const appendCompleted: string[] = [];

  for (const rawItem of delta.completed_items) {
    const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
    const completedMatches = statusItemMatchCount(completedLines, item);
    if (completedMatches > 1) fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains duplicate completed item "${item}".`);
    const developmentMatches = developmentLines
      .map((line, index) => ({ line, index }))
      .filter(entry => statusItemText(entry.line) === item);
    if (developmentMatches.length > 1) {
      fail('STATUS_RECONCILIATION_CONFLICT', `${location} cannot determine which in-progress record to remove for "${item}".`);
    }
    if (developmentMatches.length === 0 && completedMatches === 0 && meaningfulDevelopment.length > 0) {
      fail('STATUS_RECONCILIATION_CONFLICT', `${location} cannot deterministically map completed item "${item}" to the existing in-progress records.`);
    }
    if (developmentMatches.length === 1) removeDevelopmentIndexes.add(developmentMatches[0]!.index);
    if (completedMatches === 0) appendCompleted.push(item);
  }

  const nextDevelopmentLines = developmentLines.filter((_, index) => !removeDevelopmentIndexes.has(index));
  let nextCompletedLines = [...completedLines];
  if (appendCompleted.length > 0) {
    nextCompletedLines = nextCompletedLines.filter(line => !isStatusPlaceholderLine(line));
    while (nextCompletedLines.length > 0 && nextCompletedLines[nextCompletedLines.length - 1]!.trim() === '') nextCompletedLines.pop();
    nextCompletedLines.push(...appendCompleted.map(item => `- ${item}`));
  }
  let next = replaceStatusSectionBody(content, 'inProgress', nextDevelopmentLines, location);
  return replaceStatusSectionBody(next, 'completed', nextCompletedLines, location);
}

function projectStatusRemainingRisks(content: string, delta: ProjectStatusDelta, location: string): string {
  const riskItems = delta.remaining_risks.map(item => validateStatusProjectionText(item, `${location}.remaining_risks`));
  if (riskItems.length === 0) return content;
  const lines = readStatusSectionLines(content, 'risks', location);
  const appendItems = riskItems.filter(item => {
    const matches = statusItemMatchCount(lines, item);
    if (matches > 1) fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains duplicate remaining risk "${item}".`);
    return matches === 0;
  });
  if (appendItems.length === 0) return content;
  const nextLines = lines.filter(line => !isStatusPlaceholderLine(line));
  while (nextLines.length > 0 && nextLines[nextLines.length - 1]!.trim() === '') nextLines.pop();
  nextLines.push(...appendItems.map(item => `- ${item}`));
  return replaceStatusSectionBody(content, 'risks', nextLines, location);
}

function projectStatusCheckpoint(content: string, delta: ProjectStatusDelta, location: string): string {
  const checkpoint = validateStatusProjectionText(delta.next_checkpoint, `${location}.next_checkpoint`);
  const lines = readStatusSectionLines(content, 'nextCheckpoint', location);
  const nonEmpty = lines.filter(line => line.trim().length > 0);
  if (nonEmpty.some(line => statusItemText(line) === null && !isStatusPlaceholderLine(line))) {
    fail('STATUS_RECONCILIATION_CONFLICT', `${location} next checkpoint section contains unsupported non-list content.`);
  }
  if (nonEmpty.filter(line => statusItemText(line) !== null).length > 1) {
    fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains multiple next checkpoint records.`);
  }
  return replaceStatusSectionBody(content, 'nextCheckpoint', [`- ${checkpoint}`], location);
}

function projectStatusDelta(content: string, delta: ProjectStatusDelta, location: string): string {
  let next = projectStatusOverview(content, delta, location);
  next = projectStatusCompletedItems(next, delta, location);
  next = projectStatusRemainingRisks(next, delta, location);
  return projectStatusCheckpoint(next, delta, location);
}

function assertStatusProjection(content: string, delta: ProjectStatusDelta, location: string): void {
  const overviewLines = readStatusSectionLines(content, 'overview', location);
  const statusLines = overviewLines.filter(line => /^-\s*(?:当前状态|status)\s*[:：]\s*.*$/i.test(line));
  if (statusLines.length !== 1 || statusLines[0] !== `- 当前状态：${delta.status}`) {
    fail('STATUS_PROVENANCE_MISMATCH', `${location} project status projection no longer matches the typed status delta.`);
  }
  const completedLines = readStatusSectionLines(content, 'completed', location);
  const developmentLines = readStatusSectionLines(content, 'inProgress', location);
  for (const rawItem of delta.completed_items) {
    const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
    if (statusItemMatchCount(completedLines, item) !== 1 || statusItemMatchCount(developmentLines, item) !== 0) {
      fail('STATUS_PROVENANCE_MISMATCH', `${location} completed item projection no longer matches "${item}".`);
    }
  }
  const riskLines = readStatusSectionLines(content, 'risks', location);
  for (const rawItem of delta.remaining_risks) {
    const item = validateStatusProjectionText(rawItem, `${location}.remaining_risks`);
    if (statusItemMatchCount(riskLines, item) !== 1) {
      fail('STATUS_PROVENANCE_MISMATCH', `${location} remaining risk projection no longer matches "${item}".`);
    }
  }
  const checkpointLines = readStatusSectionLines(content, 'nextCheckpoint', location);
  if (checkpointLines.filter(line => statusItemText(line) !== null).length !== 1 || statusItemText(checkpointLines.find(line => statusItemText(line) !== null) ?? '') !== delta.next_checkpoint) {
    fail('STATUS_PROVENANCE_MISMATCH', `${location} next checkpoint projection no longer matches the typed status delta.`);
  }
}

function appendStatusReconciliation(content: string, marker: string, location: string): string {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), STATUS_SECTIONS.recentUpdates.aliases, 2);
  if (!section) fail('STATUS_INVALID', `${location} is missing the required ## ${STATUS_SECTIONS.recentUpdates.title} section.`);
  const existing = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trimEnd();
  return content.slice(0, section.contentStart) + `\n${existing.trim().length > 0 ? `${existing}\n\n` : ''}${marker}\n` + content.slice(section.contentEnd);
}

function prepareProjectStatusTransaction(root: string, current: CanonicalCurrentTask, proposal: ProjectStatusProposal): ProjectStatusTransactionPlan | null {
  ensureAuthorityKinds(proposal, ['evidence-admission']);
  const { receipt } = matchingArchiveReceipt(root, current);
  const target = workflowDocPathForRoot(root, 'STATUS.md');
  if (!fs.existsSync(target.filePath)) fail('RUNTIME_SOURCE_MISSING', `STATUS.md is missing: ${target.relativePath}`);
  const originalStatusContent = fs.readFileSync(target.filePath, 'utf8');
  validateStatusDocument(originalStatusContent, target.relativePath);
  const existingReceipt = matchingStatusReceipt(originalStatusContent, target.relativePath, receipt);
  const deltaDigest = digest(proposal.semantic_delta);
  if (existingReceipt) {
    if (existingReceipt.taskId !== receipt.taskId || existingReceipt.taskSlug !== receipt.taskSlug || existingReceipt.documentId !== receipt.documentId || existingReceipt.archivePath !== receipt.relativePath || existingReceipt.archiveRevision !== receipt.revision || existingReceipt.sourceRevision !== receipt.sourceRevision) {
      fail('STATUS_PROVENANCE_MISMATCH', 'STATUS reconciliation receipt does not match the canonical archive.');
    }
    if (existingReceipt.deltaDigest !== deltaDigest || existingReceipt.status !== proposal.semantic_delta.status) {
      fail('STATUS_RECONCILIATION_CONFLICT', 'STATUS already contains a different reconciliation for this archived task.');
    }
    if (digest(statusDeltaFromReceipt(existingReceipt)) !== deltaDigest) {
      fail('STATUS_RECONCILIATION_CONFLICT', 'STATUS reconciliation receipt no longer matches its typed status delta.');
    }
    assertStatusProjection(originalStatusContent, proposal.semantic_delta, target.relativePath);
    return null;
  }
  const marker = renderStatusReconciliation(proposal, proposal.semantic_delta, receipt);
  const projectedStatusContent = projectStatusDelta(originalStatusContent, proposal.semantic_delta, target.relativePath);
  const nextStatusContent = appendStatusReconciliation(projectedStatusContent, marker, target.relativePath);
  return {
    statusFilePath: target.filePath,
    statusRelativePath: target.relativePath,
    nextStatusContent,
    originalStatusContent,
    statusRevision: sha256(nextStatusContent),
    archive: receipt,
  };
}

export type ReusedCandidateTarget = {
  task_id: string;
  document_id: string;
  archive_revision: string;
  candidate_ref: string;
};

type LessonMarker = {
  task_id: string;
  task_slug: string;
  document_id: string;
  archive_path: string;
  archive_revision: string;
  source_revision: string;
  candidate_ref: string;
  candidate_digest: string;
  evidence_refs: string[];
  disposition?: 'reused';
  reused_candidate?: ReusedCandidateTarget;
};

function lessonCandidateDigest(candidate: LessonCandidate): string {
  return digest({
    category: candidate.category,
    scene: candidate.scene,
    conclusion: candidate.conclusion,
    trigger: candidate.trigger,
    cause: candidate.cause,
    action: candidate.action,
    consumer: candidate.consumer,
  });
}

function renderLessonMarker(candidate: LessonCandidate, archive: ArchiveReceipt): string {
  return `<!-- vNext lesson record: ${JSON.stringify({
    task_id: archive.taskId,
    task_slug: archive.taskSlug,
    document_id: archive.documentId,
    archive_path: archive.relativePath,
    archive_revision: archive.revision,
    source_revision: archive.sourceRevision,
    candidate_ref: candidate.candidate_ref,
    candidate_digest: lessonCandidateDigest(candidate),
    evidence_refs: candidate.evidence_refs,
  })} -->`;
}

function expectLessonRecord(value: unknown, location: string): AnyRecord {
  if (!isRecord(value)) fail('LESSON_INVALID', `${location} is not a canonical Lesson marker mapping.`);
  return value;
}

function expectLessonExactKeys(value: AnyRecord, expected: readonly string[], location: string): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const extra = Object.keys(value).filter(key => !expectedSet.has(key));
  if (missing.length === 0 && extra.length === 0) return;
  const details: string[] = [];
  if (missing.length > 0) details.push(`missing=[${missing.join(', ')}]`);
  if (extra.length > 0) details.push(`unsupported Lesson marker field(s)=[${extra.join(', ')}]`);
  fail('LESSON_INVALID', `${location} is a non-canonical Lesson marker (${details.join('; ')}).`);
}

function expectLessonString(value: unknown, location: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('LESSON_INVALID', `${location} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    fail('LESSON_INVALID', `${location} has an invalid value.`);
  }
  return normalized;
}

function validateLessonTaskSlug(value: unknown, location: string): string {
  const taskSlug = expectLessonString(value, location);
  try {
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail('LESSON_INVALID', error instanceof Error ? error.message : String(error));
  }
  return taskSlug;
}

function validateLessonCandidateKey(value: unknown, location: string): ReusedCandidateTarget {
  if (!isRecord(value)) fail('LESSON_INVALID', `${location} must be a mapping.`);
  const taskId = expectLessonString(value.task_id, `${location}.task_id`);
  try {
    validateTaskId(taskId);
  } catch (error) {
    fail('LESSON_INVALID', error instanceof Error ? error.message : String(error));
  }
  const documentId = expectLessonString(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    fail('LESSON_INVALID', `${location}.document_id is invalid.`);
  }
  const archiveRevision = expectLessonString(value.archive_revision, `${location}.archive_revision`);
  if (!SHA256_PATTERN.test(archiveRevision)) {
    fail('LESSON_INVALID', `${location}.archive_revision must be an exact SHA-256.`);
  }
  const candidateRef = expectLessonString(value.candidate_ref, `${location}.candidate_ref`, SAFE_KEY_PATTERN);
  return {
    task_id: taskId,
    document_id: documentId,
    archive_revision: archiveRevision,
    candidate_ref: candidateRef,
  };
}

export function readLessonMarkers(content: string, location: string): LessonMarker[] {
  const pattern = /<!-- vNext lesson record: (\{[^\r\n]+\}) -->/g;
  const result: LessonMarker[] = [];
  for (const match of content.matchAll(pattern)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      fail('LESSON_INVALID', `${location} contains an invalid vNext lesson provenance marker.`);
    }
    const record = expectLessonRecord(parsed, `${location}.lesson_marker`);
    const hasDisposition = 'disposition' in record;
    if (hasDisposition) {
      if (record.disposition !== 'reused') {
        fail('LESSON_INVALID', `${location}.lesson_marker has an invalid Lesson marker disposition: ${String(record.disposition)}.`);
      }
      expectLessonExactKeys(
        record,
        ['task_id', 'task_slug', 'document_id', 'archive_path', 'archive_revision', 'source_revision', 'candidate_ref', 'candidate_digest', 'evidence_refs', 'disposition', 'reused_candidate'],
        `${location}.lesson_marker`,
      );
    } else {
      expectLessonExactKeys(
        record,
        ['task_id', 'task_slug', 'document_id', 'archive_path', 'archive_revision', 'source_revision', 'candidate_ref', 'candidate_digest', 'evidence_refs'],
        `${location}.lesson_marker`,
      );
    }
    const archiveRevision = expectLessonString(record.archive_revision, `${location}.lesson_marker.archive_revision`);
    const sourceRevision = expectLessonString(record.source_revision, `${location}.lesson_marker.source_revision`);
    const candidateDigest = expectLessonString(record.candidate_digest, `${location}.lesson_marker.candidate_digest`);
    if (!SHA256_PATTERN.test(archiveRevision) || !SHA256_PATTERN.test(sourceRevision) || !SHA256_PATTERN.test(candidateDigest)) {
      fail('LESSON_INVALID', `${location} contains a non-canonical Lesson marker revision or digest.`);
    }
    const candidateIdentity = validateLessonCandidateKey(record, `${location}.lesson_marker`);
    const taskSlug = validateLessonTaskSlug(record.task_slug, `${location}.lesson_marker.task_slug`);
    const marker: LessonMarker = {
      task_id: candidateIdentity.task_id,
      task_slug: taskSlug,
      document_id: candidateIdentity.document_id,
      archive_path: normalizeRepoPath(expectLessonString(record.archive_path, `${location}.lesson_marker.archive_path`), `${location}.lesson_marker.archive_path`),
      archive_revision: candidateIdentity.archive_revision,
      source_revision: sourceRevision,
      candidate_ref: candidateIdentity.candidate_ref,
      candidate_digest: candidateDigest,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.lesson_marker.evidence_refs`),
    };
    if (hasDisposition) {
      if (!isRecord(record.reused_candidate)) {
        fail('LESSON_INVALID', `${location}.lesson_marker.reused_candidate must be a mapping.`);
      }
      const reusedRecord = record.reused_candidate;
      expectLessonExactKeys(
        reusedRecord,
        ['task_id', 'document_id', 'archive_revision', 'candidate_ref'],
        `${location}.lesson_marker.reused_candidate`,
      );
      marker.disposition = 'reused';
      marker.reused_candidate = validateLessonCandidateKey(reusedRecord, `${location}.lesson_marker.reused_candidate`);
    }
    result.push(marker);
  }
  return result;
}

function renderLessonCandidate(candidate: LessonCandidate, archive: ArchiveReceipt): string {
  return [
    renderLessonMarker(candidate, archive),
    `- 场景：${yamlScalar(candidate.scene)}`,
    `  - 结论：${yamlScalar(candidate.conclusion)}`,
    `  - 触发信号：${yamlScalar(candidate.trigger)}`,
    `  - 原因：${yamlScalar(candidate.cause)}`,
    `  - 应对动作：${yamlScalar(candidate.action)}`,
    `  - 消费者：${yamlScalar(candidate.consumer)}`,
    `  - 证据引用：${yamlStringArray(candidate.evidence_refs)}`,
  ].join('\n');
}

export type DurableLessonRecord = {
  marker: LessonMarker;
  candidate: LessonCandidate;
};

function countExactOccurrences(content: string, value: string): number {
  if (value.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(value, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + value.length;
  }
}

function renderLessonMarkerFromData(marker: LessonMarker): string {
  const data: Record<string, unknown> = {
    task_id: marker.task_id,
    task_slug: marker.task_slug,
    document_id: marker.document_id,
    archive_path: marker.archive_path,
    archive_revision: marker.archive_revision,
    source_revision: marker.source_revision,
    candidate_ref: marker.candidate_ref,
    candidate_digest: marker.candidate_digest,
    evidence_refs: marker.evidence_refs,
  };
  if (marker.disposition === 'reused' && marker.reused_candidate) {
    data.disposition = 'reused';
    data.reused_candidate = {
      task_id: marker.reused_candidate.task_id,
      document_id: marker.reused_candidate.document_id,
      archive_revision: marker.reused_candidate.archive_revision,
      candidate_ref: marker.reused_candidate.candidate_ref,
    };
  }
  return `<!-- vNext lesson record: ${JSON.stringify(data)} -->`;
}

function archiveReceiptFromLessonMarker(marker: LessonMarker): ArchiveReceipt {
  return {
    filePath: '',
    relativePath: marker.archive_path,
    raw: '',
    revision: marker.archive_revision,
    taskId: marker.task_id,
    taskSlug: marker.task_slug,
    taskTitle: '',
    documentId: marker.document_id,
    sourceRevision: marker.source_revision,
    archivePath: marker.archive_path,
    idempotencyKey: 'lesson-marker-replay',
    closureDeltaDigest: '0'.repeat(64),
    lessonAdmission: { decision: 'defer', candidate_refs: [], evidence_refs: [] },
    knowledgeAdmissions: emptyKnowledgeAdmissionBundle(),
  };
}

function parseLessonRenderedScalar(raw: string, location: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return expectText(JSON.parse(value), location);
    } catch (error) {
      if (error instanceof VNextRuntimeError) throw error;
      fail('LESSON_INVALID', `${location} is not a valid rendered scalar.`);
    }
  }
  return expectText(value, location);
}

function readLessonRenderedField(block: string, label: string, indent: string, location: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${indent}-\\s*${escaped}：(.+?)\\s*$`, 'm').exec(block);
  if (!match) fail('LESSON_INVALID', `${location} is missing the visible ${label} field.`);
  return parseLessonRenderedScalar(match[1]!, `${location}.${label}`);
}

function readLessonRenderedEvidenceRefs(block: string, location: string): string[] {
  const match = /^\s{2}-\s*证据引用：(.+?)\s*$/m.exec(block);
  if (!match) fail('LESSON_INVALID', `${location} is missing the visible 证据引用 field.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!.trim());
  } catch {
    fail('LESSON_INVALID', `${location}.evidence_refs is not a JSON array.`);
  }
  return validateEvidenceRefs(parsed, `${location}.evidence_refs`);
}

function readDurableLessonRecord(content: string, marker: LessonMarker, location: string): DurableLessonRecord {
  const markerText = renderLessonMarkerFromData(marker);
  if (countExactOccurrences(content, markerText) !== 1) {
    fail('LESSON_INVALID', `${location} contains a non-canonical or duplicate lesson provenance marker.`);
  }
  const markerStart = content.indexOf(markerText);
  const sections = scanMarkdownSections(content);
  const categorySection = sections.find(section =>
    section.level === 2
    && LESSON_CATEGORIES.includes(section.title as LessonCandidate['category'])
    && markerStart >= section.contentStart
    && markerStart < section.contentEnd,
  );
  if (!categorySection) fail('LESSON_INVALID', `${location} lesson marker is not inside a canonical lesson category section.`);

  const nextMarker = content.indexOf('<!-- vNext lesson record:', markerStart + markerText.length);
  const nextSection = sections
    .filter(section => section.level <= 2 && section.headingStart > markerStart)
    .map(section => section.headingStart)
    .sort((left, right) => left - right)[0];
  const candidateEnd = Math.min(
    nextMarker < 0 ? content.length : nextMarker,
    nextSection === undefined ? content.length : nextSection,
  );
  const block = content.slice(markerStart, candidateEnd).replace(/\r\n?/g, '\n');
  const candidate: LessonCandidate = {
    candidate_ref: marker.candidate_ref,
    category: categorySection.title as LessonCandidate['category'],
    scene: readLessonRenderedField(block, '场景', '', `${location}.${marker.candidate_ref}`),
    conclusion: readLessonRenderedField(block, '结论', '  ', `${location}.${marker.candidate_ref}`),
    trigger: readLessonRenderedField(block, '触发信号', '  ', `${location}.${marker.candidate_ref}`),
    cause: readLessonRenderedField(block, '原因', '  ', `${location}.${marker.candidate_ref}`),
    action: readLessonRenderedField(block, '应对动作', '  ', `${location}.${marker.candidate_ref}`),
    consumer: readLessonRenderedField(block, '消费者', '  ', `${location}.${marker.candidate_ref}`),
    evidence_refs: readLessonRenderedEvidenceRefs(block, `${location}.${marker.candidate_ref}`),
  };
  if (marker.evidence_refs.join('|') !== candidate.evidence_refs.join('|')) {
    fail('LESSON_PROVENANCE_MISMATCH', `${location}.${marker.candidate_ref} marker evidence_refs do not match the visible Lesson record.`);
  }
  if (lessonCandidateDigest(candidate) !== marker.candidate_digest) {
    fail('LESSON_PROVENANCE_MISMATCH', `${location}.${marker.candidate_ref} marker digest does not match the visible Lesson record.`);
  }
  const archive = archiveReceiptFromLessonMarker(marker);
  if (countExactOccurrences(content, renderLessonCandidate(candidate, archive)) !== 1) {
    fail('LESSON_PROVENANCE_MISMATCH', `${location}.${marker.candidate_ref} visible Lesson record drifted from its deterministic rendering.`);
  }
  return { marker, candidate };
}

export function readDurableLessonRecords(content: string, location: string): DurableLessonRecord[] {
  const markers = readLessonMarkers(content, location);
  const persistedRecords: DurableLessonRecord[] = [];
  const reusedMarkers: { marker: LessonMarker; index: number }[] = [];

  for (const [index, marker] of markers.entries()) {
    if (marker.disposition === 'reused') {
      reusedMarkers.push({ marker, index });
    } else {
      persistedRecords.push(readDurableLessonRecord(content, marker, `${location}.lesson[${index}]`));
    }
  }

  const allRecords: DurableLessonRecord[] = [...persistedRecords];

  for (const { marker, index } of reusedMarkers) {
    const markerText = renderLessonMarkerFromData(marker);
    if (countExactOccurrences(content, markerText) !== 1) {
      fail('LESSON_INVALID', `${location}.lesson[${index}] contains a non-canonical or duplicate lesson reuse marker.`);
    }
    if (!marker.reused_candidate) {
      fail('LESSON_INVALID', `${location}.lesson[${index}] reuse marker is missing reused_candidate target.`);
    }
    const matchingTargets = persistedRecords.filter(record =>
      record.marker.task_id === marker.reused_candidate!.task_id
      && record.marker.document_id === marker.reused_candidate!.document_id
      && record.marker.archive_revision === marker.reused_candidate!.archive_revision
      && record.marker.candidate_ref === marker.reused_candidate!.candidate_ref
    );
    if (matchingTargets.length !== 1) {
      fail(
        'LESSON_PROVENANCE_MISMATCH',
        `${location}.lesson[${index}] references ${matchingTargets.length === 0 ? 'missing' : 'ambiguous'} persisted candidate target ${marker.reused_candidate.task_id}/${marker.reused_candidate.candidate_ref}.`,
      );
    }
    const target = matchingTargets[0];
    if (target.marker.candidate_digest !== marker.candidate_digest) {
      fail(
        'LESSON_PROVENANCE_MISMATCH',
        `${location}.lesson[${index}] digest does not match referenced candidate target ${marker.reused_candidate.task_id}/${marker.reused_candidate.candidate_ref}.`,
      );
    }
    allRecords.push({
      marker,
      candidate: {
        ...target.candidate,
        candidate_ref: marker.candidate_ref,
        evidence_refs: [...marker.evidence_refs],
      },
    });
  }

  return allRecords;
}

/**
 * Validate and preserve the canonical Lessons document for Bootstrap
 * realignment. Lessons have no Bootstrap-owned projection; their structure is
 * therefore retained only after the Runtime's category and provenance checks.
 */
export function readCanonicalLessonsDocument(content: string, location: string): string {
  const sections = scanMarkdownSections(content);
  for (const heading of LESSON_REQUIRED_SECTION_HEADINGS) {
    if (!findUniqueMarkdownSection(sections, [heading], 2)) fail('LESSON_INVALID', `${location} is missing the required ## ${heading} section.`);
  }
  readDurableLessonRecords(content, location);
  return content;
}

function isLegacyBootstrapLessonsDocument(content: string, location: string): boolean {
  const sections = scanMarkdownSections(content);
  const topLevelTitles = sections
    .filter(section => section.level === 2)
    .map(section => section.title);
  const isLegacySingleSection = topLevelTitles.length === 1 && topLevelTitles[0] === 'Reusable lessons';
  const isLegacyPairedSections = topLevelTitles.length === 2 && topLevelTitles.includes('使用规则') && topLevelTitles.includes('Reusable lessons');
  if (!isLegacySingleSection && !isLegacyPairedSections) return false;
  readDurableLessonRecords(content, location);
  return true;
}

/**
 * Read a Bootstrap-managed Lessons document while recognizing the minimal
 * baseline emitted by older realign receipts. Runtime lesson transactions
 * still call readCanonicalLessonsDocument and therefore retain the full contract.
 */
export function readBootstrapLessonsDocument(content: string, location = 'LESSONS.md'): string {
  if (isLegacyBootstrapLessonsDocument(content, location)) return content;
  return readCanonicalLessonsDocument(content, location);
}

/**
 * Rebuild only the canonical Lessons section structure while retaining each
 * validated section body, including Runtime durable records and provenance.
 */
export function canonicalizeLessonsDocumentForBootstrap(content: string, location = 'LESSONS.md'): string {
  const sections = scanMarkdownSections(content);
  const legacy = isLegacyBootstrapLessonsDocument(content, location);
  if (!legacy) readCanonicalLessonsDocument(content, location);
  const canonicalSections = new Set<number>();
  const firstTopLevel = sections
    .filter(section => section.level === 2)
    .sort((left, right) => left.headingStart - right.headingStart)[0];
  const prefix = firstTopLevel
    ? content.slice(0, firstTopLevel.headingStart).replace(/\r\n?/g, '\n').trimEnd()
    : '';
  const output: string[] = [prefix || '# LESSONS.md', ''];
  if (legacy) {
    const rules = findUniqueMarkdownSection(sections, ['使用规则'], 2);
    const reusable = findUniqueMarkdownSection(sections, ['Reusable lessons'], 2);
    if (!reusable) fail('LESSON_INVALID', `${location} is missing the legacy Bootstrap Lessons section.`);
    if (rules) canonicalSections.add(rules.headingStart);
    canonicalSections.add(reusable.headingStart);
    const rulesBody = rules ? content.slice(rules.contentStart, rules.contentEnd).replace(/\r\n?/g, '\n').trim() : '';
    output.push('## 使用规则', '', ...(rulesBody.length > 0 ? rulesBody.split('\n') : []), '');
    for (const heading of LESSON_CATEGORIES) output.push(`## ${heading}`, '', '- none', '');
    const reusableBody = content.slice(reusable.contentStart, reusable.contentEnd).replace(/\r\n?/g, '\n').trim();
    output.push('## Reusable lessons', '', ...(reusableBody.length > 0 ? reusableBody.split('\n') : []), '');
  } else {
    for (const heading of LESSON_REQUIRED_SECTION_HEADINGS) {
      const section = findUniqueMarkdownSection(sections, [heading], 2);
      if (!section) fail('LESSON_INVALID', `${location} is missing the required ## ${heading} section.`);
      canonicalSections.add(section.headingStart);
      const body = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trim();
      output.push(`## ${heading}`, '', ...(body.length > 0 ? body.split('\n') : []), '');
    }
  }
  for (const section of sections.filter(item => item.level === 2).sort((left, right) => left.headingStart - right.headingStart)) {
    if (canonicalSections.has(section.headingStart)) continue;
    const preserved = content.slice(section.headingStart, section.contentEnd).replace(/\r\n?/g, '\n').trimEnd();
    if (preserved.trim().length > 0) output.push(preserved, '');
  }
  const next = output.join('\n');
  readCanonicalLessonsDocument(next, location);
  return next;
}

function appendLessonCandidates(content: string, candidates: readonly LessonCandidate[], archive: ArchiveReceipt, location: string): { content: string; candidateCount: number } {
  const additions = new Map<LessonCandidate['category'], LessonCandidate[]>();
  for (const candidate of candidates) {
    const list = additions.get(candidate.category) ?? [];
    list.push(candidate);
    additions.set(candidate.category, list);
  }
  let nextContent = content;
  let candidateCount = 0;
  const ordered = [...additions.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  for (const [category, categoryCandidates] of ordered) {
    const sections = scanMarkdownSections(nextContent);
    const section = findUniqueMarkdownSection(sections, [category], 2);
    if (!section) fail('LESSON_INVALID', `${location} is missing the required ## ${category} section.`);
    const rendered = categoryCandidates.map(candidate => renderLessonCandidate(candidate, archive)).join('\n\n');
    const existing = nextContent.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trimEnd();
    nextContent = nextContent.slice(0, section.contentStart) + `\n${existing.trim().length > 0 ? `${existing}\n\n` : ''}${rendered}\n` + nextContent.slice(section.contentEnd);
    candidateCount += categoryCandidates.length;
  }
  return { content: nextContent, candidateCount };
}

function appendLessonReuseMarkers(
  content: string,
  reuseMarkers: readonly LessonMarker[],
  availableRecords: readonly DurableLessonRecord[],
  location: string,
): string {
  let nextContent = content;
  for (const reuseMarker of reuseMarkers) {
    if (!reuseMarker.reused_candidate) {
      fail('LESSON_INVALID', `${location} reuse marker missing reused_candidate coordinates.`);
    }
    const matchingTargets = availableRecords.filter(record =>
      record.marker.task_id === reuseMarker.reused_candidate!.task_id
      && record.marker.document_id === reuseMarker.reused_candidate!.document_id
      && record.marker.archive_revision === reuseMarker.reused_candidate!.archive_revision
      && record.marker.candidate_ref === reuseMarker.reused_candidate!.candidate_ref
    );
    if (matchingTargets.length !== 1) {
      fail(
        'LESSON_INVALID',
        `${location} target candidate for reuse ${reuseMarker.reused_candidate.task_id}/${reuseMarker.reused_candidate.candidate_ref} was not uniquely resolved (matches=${matchingTargets.length}).`,
      );
    }
    const targetRecord = matchingTargets[0];
    if (targetRecord.marker.candidate_digest !== reuseMarker.candidate_digest) {
      fail(
        'LESSON_INVALID',
        `${location} target candidate for reuse ${reuseMarker.reused_candidate.task_id}/${reuseMarker.reused_candidate.candidate_ref} digest mismatched.`,
      );
    }
    const targetArchive = archiveReceiptFromLessonMarker(targetRecord.marker);
    const targetRendered = renderLessonCandidate(targetRecord.candidate, targetArchive);
    const targetIndex = nextContent.indexOf(targetRendered);
    if (targetIndex < 0) {
      fail('LESSON_INVALID', `${location} could not locate rendered block for candidate ${reuseMarker.reused_candidate.task_id}/${reuseMarker.reused_candidate.candidate_ref}.`);
    }
    let insertionIndex = targetIndex + targetRendered.length;
    while (true) {
      const rest = nextContent.slice(insertionIndex);
      const match = /^\r?\n<!-- vNext lesson record: (\{[^\r\n]+\}) -->/.exec(rest);
      if (!match) break;
      insertionIndex += match[0].length;
    }
    const markerText = renderLessonMarkerFromData(reuseMarker);
    nextContent = nextContent.slice(0, insertionIndex) + `\n${markerText}` + nextContent.slice(insertionIndex);
  }
  return nextContent;
}

function prepareLessonRecordTransaction(root: string, current: CanonicalCurrentTask, proposal: LessonRecordProposal): LessonRecordTransactionPlan | null {
  ensureAuthorityKinds(proposal, ['evidence-admission']);
  const { receipt } = matchingArchiveReceipt(root, current);
  if (receipt.lessonAdmission.decision !== 'admit') {
    fail('KNOWLEDGE_ADMISSION_INVALID', 'lesson-record-transaction is allowed only when the durable archive lesson admission is admit.');
  }
  const delta = proposal.semantic_delta;
  const admissionRefs = new Set(receipt.lessonAdmission.candidate_refs);
  const candidateRefs = new Set(delta.candidates.map(candidate => candidate.candidate_ref));
  if (admissionRefs.size !== candidateRefs.size || [...admissionRefs].some(ref => !candidateRefs.has(ref))) {
    fail('KNOWLEDGE_ADMISSION_INVALID', 'lesson-record candidates must exactly match the durable archive lesson admission candidate_refs.');
  }
  if (delta.candidates.length !== candidateRefs.size) {
    fail('KNOWLEDGE_ADMISSION_INVALID', 'lesson-record candidates must not contain duplicate candidate_refs.');
  }
  if (!receipt.lessonAdmission.evidence_refs.every(ref => delta.evidence_refs.includes(ref))) {
    fail('KNOWLEDGE_ADMISSION_INVALID', 'lesson-record evidence_refs must cover the durable archive lesson admission evidence_refs.');
  }
  const target = workflowDocPathForRoot(root, 'LESSONS.md');
  if (!fs.existsSync(target.filePath)) fail('RUNTIME_SOURCE_MISSING', `LESSONS.md is missing: ${target.relativePath}`);
  const originalLessonsContent = fs.readFileSync(target.filePath, 'utf8');
  const sections = scanMarkdownSections(originalLessonsContent);
  for (const heading of LESSON_REQUIRED_SECTION_HEADINGS) {
    if (!findUniqueMarkdownSection(sections, [heading], 2)) fail('LESSON_INVALID', `LESSONS.md is missing the required ## ${heading} section.`);
  }
  const existingRecords = readDurableLessonRecords(originalLessonsContent, target.relativePath);

  const stagedSemanticTargets = new Map<string, ReusedCandidateTarget>();
  for (const record of existingRecords) {
    if (record.marker.disposition !== 'reused') {
      if (!stagedSemanticTargets.has(record.marker.candidate_digest)) {
        stagedSemanticTargets.set(record.marker.candidate_digest, {
          task_id: record.marker.task_id,
          document_id: record.marker.document_id,
          archive_revision: record.marker.archive_revision,
          candidate_ref: record.marker.candidate_ref,
        });
      }
    }
  }

  const newCandidates: LessonCandidate[] = [];
  const newReuseMarkers: LessonMarker[] = [];
  for (const candidate of delta.candidates) {
    const matchingRefs = existingRecords.filter(record => record.marker.candidate_ref === candidate.candidate_ref && record.marker.task_id === receipt.taskId);
    if (matchingRefs.length > 1) {
      fail('LESSON_INVALID', `LESSONS contains duplicate durable records for candidate ${candidate.candidate_ref}.`);
    }
    if (matchingRefs.length > 0) {
      for (const existing of matchingRefs) {
        const marker = existing.marker;
        if (
          marker.task_id !== receipt.taskId
          || marker.task_slug !== receipt.taskSlug
          || marker.document_id !== receipt.documentId
          || marker.archive_path !== receipt.relativePath
          || marker.archive_revision !== receipt.revision
          || marker.source_revision !== receipt.sourceRevision
          || marker.candidate_digest !== lessonCandidateDigest(candidate)
          || marker.evidence_refs.join('|') !== candidate.evidence_refs.join('|')
          || lessonCandidateDigest(existing.candidate) !== lessonCandidateDigest(candidate)
        ) {
          fail('LESSON_PROVENANCE_MISMATCH', `lesson candidate ${candidate.candidate_ref} has conflicting durable provenance.`);
        }
      }
      continue;
    }

    const candidateDigest = lessonCandidateDigest(candidate);
    const existingTarget = stagedSemanticTargets.get(candidateDigest);
    if (existingTarget) {
      const reuseMarker: LessonMarker = {
        task_id: receipt.taskId,
        task_slug: receipt.taskSlug,
        document_id: receipt.documentId,
        archive_path: receipt.relativePath,
        archive_revision: receipt.revision,
        source_revision: receipt.sourceRevision,
        candidate_ref: candidate.candidate_ref,
        candidate_digest: candidateDigest,
        evidence_refs: [...candidate.evidence_refs],
        disposition: 'reused',
        reused_candidate: {
          task_id: existingTarget.task_id,
          document_id: existingTarget.document_id,
          archive_revision: existingTarget.archive_revision,
          candidate_ref: existingTarget.candidate_ref,
        },
      };
      newReuseMarkers.push(reuseMarker);
      continue;
    }

    newCandidates.push(candidate);
    stagedSemanticTargets.set(candidateDigest, {
      task_id: receipt.taskId,
      document_id: receipt.documentId,
      archive_revision: receipt.revision,
      candidate_ref: candidate.candidate_ref,
    });
  }

  if (newCandidates.length === 0 && newReuseMarkers.length === 0) return null;
  let nextLessonsContent = originalLessonsContent;
  let candidateCount = 0;
  if (newCandidates.length > 0) {
    const appended = appendLessonCandidates(nextLessonsContent, newCandidates, receipt, target.relativePath);
    nextLessonsContent = appended.content;
    candidateCount += appended.candidateCount;
  }
  if (newReuseMarkers.length > 0) {
    const availableRecords: DurableLessonRecord[] = [...existingRecords];
    for (const candidate of newCandidates) {
      availableRecords.push({
        marker: {
          task_id: receipt.taskId,
          task_slug: receipt.taskSlug,
          document_id: receipt.documentId,
          archive_path: receipt.relativePath,
          archive_revision: receipt.revision,
          source_revision: receipt.sourceRevision,
          candidate_ref: candidate.candidate_ref,
          candidate_digest: lessonCandidateDigest(candidate),
          evidence_refs: [...candidate.evidence_refs],
        },
        candidate,
      });
    }
    nextLessonsContent = appendLessonReuseMarkers(nextLessonsContent, newReuseMarkers, availableRecords, target.relativePath);
    candidateCount += newReuseMarkers.length;
  }
  return {
    lessonsFilePath: target.filePath,
    lessonsRelativePath: target.relativePath,
    nextLessonsContent,
    originalLessonsContent,
    lessonsRevision: sha256(nextLessonsContent),
    archive: receipt,
    candidateCount,
  };
}

export type DurableKnowledgeRecord = {
  schema_version: 1;
  knowledge_kind: 'contract' | 'decision';
  candidate_id: string;
  candidate_fingerprint: string;
  disposition: Extract<KnowledgeAdmissionDisposition, 'admit' | 'merge' | 'supersede'>;
  matched_knowledge_id: string | null;
  candidate: KnowledgeCandidate;
  provenance: KnowledgeProvenance;
  proposal_idempotency_key: string;
  proposal_digest: string;
  semantic_digest: string;
};

type KnowledgeRecordTransactionPlan = {
  filePath: string;
  relativePath: string;
  nextContent: string;
  originalContent: string;
  record: DurableKnowledgeRecord;
  existing: boolean;
};

function knowledgeTarget(root: string, knowledgeKind: 'contract' | 'decision'): { filePath: string; relativePath: string } {
  return workflowDocPathForRoot(root, knowledgeKind === 'contract' ? 'CONTRACTS.md' : 'DECISIONS.md');
}

function knowledgeSectionTitle(knowledgeKind: 'contract' | 'decision'): string {
  return knowledgeKind === 'contract' ? 'vNext Contract Records' : 'vNext Decision Records';
}

function knowledgeMarkerPrefix(knowledgeKind: 'contract' | 'decision'): string {
  return `<!-- vNext ${knowledgeKind} record:`;
}

function knowledgeCandidateSemanticDigest(candidate: KnowledgeCandidate): string {
  return digest({
    kind: candidate.kind,
    fingerprint: candidate.fingerprint,
    statement: candidate.statement,
    applicability: candidate.applicability,
    authoritySource: candidate.authoritySource,
    stability: candidate.stability,
    supersedes: candidate.supersedes,
    decisionContext: candidate.decisionContext ?? null,
  });
}

function validateDurableKnowledgeRecord(value: unknown, location: string, expectedKind: 'contract' | 'decision'): DurableKnowledgeRecord {
  const record = expectRecord(value, location);
  expectExactKeys(
    record,
    ['schema_version', 'knowledge_kind', 'candidate_id', 'candidate_fingerprint', 'disposition', 'matched_knowledge_id', 'candidate', 'provenance', 'proposal_idempotency_key', 'proposal_digest', 'semantic_digest'],
    location,
  );
  if (record.schema_version !== 1) fail('KNOWLEDGE_RECORD_INVALID', `${location}.schema_version must be 1.`);
  const knowledgeKind = expectEnum(record.knowledge_kind, ['contract', 'decision'], `${location}.knowledge_kind`);
  if (knowledgeKind !== expectedKind) fail('KNOWLEDGE_RECORD_INVALID', `${location}.knowledge_kind must be ${expectedKind}.`);
  const candidate = validateKnowledgeCandidate(record.candidate, `${location}.candidate`, expectedKind);
  const candidateId = expectString(record.candidate_id, `${location}.candidate_id`, SAFE_KEY_PATTERN);
  const candidateFingerprint = expectString(record.candidate_fingerprint, `${location}.candidate_fingerprint`, FINGERPRINT_PATTERN);
  if (candidateId !== candidate.candidateId || candidateFingerprint !== candidate.fingerprint) fail('KNOWLEDGE_PROVENANCE_MISMATCH', `${location} candidate identity does not match the embedded candidate.`);
  const disposition = expectEnum(record.disposition, ['admit', 'merge', 'supersede'], `${location}.disposition`);
  const matchedKnowledgeId = expectNullableString(record.matched_knowledge_id, `${location}.matched_knowledge_id`, SAFE_KEY_PATTERN);
  if (disposition === 'merge' && matchedKnowledgeId === null) fail('KNOWLEDGE_RECORD_INVALID', `${location}.matched_knowledge_id is required for merge.`);
  if (disposition === 'supersede' && (matchedKnowledgeId === null || candidate.supersedes !== matchedKnowledgeId)) fail('KNOWLEDGE_RECORD_INVALID', `${location}.supersede predecessor identity is inconsistent.`);
  if (candidate.authoritySource === 'none') fail('KNOWLEDGE_RECORD_INVALID', `${location} cannot be a durable record without an authority source.`);
  if (knowledgeKind === 'decision' && !['user', 'accepted-decision'].includes(candidate.authoritySource)) {
    fail('KNOWLEDGE_RECORD_INVALID', `${location} Decision record requires user or accepted-decision authority.`);
  }
  if (candidate.stability !== 'stable' || candidate.conflictSet.length > 0 || candidate.evidenceRefs.length === 0) {
    fail('KNOWLEDGE_RECORD_INVALID', `${location} durable record must contain stable, conflict-free candidate evidence.`);
  }
  const provenance = validateKnowledgeProvenance(record.provenance, `${location}.provenance`);
  const proposalIdempotencyKey = expectString(record.proposal_idempotency_key, `${location}.proposal_idempotency_key`, SAFE_KEY_PATTERN);
  const proposalDigest = expectString(record.proposal_digest, `${location}.proposal_digest`);
  const semanticDigest = expectString(record.semantic_digest, `${location}.semantic_digest`);
  if (!SHA256_PATTERN.test(proposalDigest) || !SHA256_PATTERN.test(semanticDigest)) fail('KNOWLEDGE_RECORD_INVALID', `${location} proposal and semantic digests must be SHA-256.`);
  if (semanticDigest !== knowledgeCandidateSemanticDigest(candidate)) fail('KNOWLEDGE_PROVENANCE_MISMATCH', `${location}.semantic_digest does not match the canonical candidate.`);
  return {
    schema_version: 1,
    knowledge_kind: knowledgeKind,
    candidate_id: candidateId,
    candidate_fingerprint: candidateFingerprint,
    disposition,
    matched_knowledge_id: matchedKnowledgeId,
    candidate,
    provenance,
    proposal_idempotency_key: proposalIdempotencyKey,
    proposal_digest: proposalDigest,
    semantic_digest: semanticDigest,
  };
}

function renderDurableKnowledgeRecord(record: DurableKnowledgeRecord): string {
  const label = record.knowledge_kind === 'contract' ? 'Contract' : 'Decision';
  const candidate = record.candidate;
  const anchors = candidate.implementation_anchors;
  return [
    `### ${label}: ${candidate.candidateId}`,
    '',
    `<!-- vNext ${record.knowledge_kind} record: ${JSON.stringify(record)} -->`,
    '',
    `- candidate_id: ${yamlScalar(candidate.candidateId)}`,
    `- fingerprint: ${yamlScalar(candidate.fingerprint)}`,
    `- disposition: ${record.disposition}`,
    `- statement: ${yamlScalar(candidate.statement)}`,
    `- authority_source: ${yamlScalar(candidate.authoritySource)}`,
    `- applicability: ${JSON.stringify(candidate.applicability)}`,
    `- evidence_refs: ${JSON.stringify(candidate.evidenceRefs)}`,
    `- implementation_anchors: ${anchors ? JSON.stringify(anchors) : 'none'}`,
    `- provenance: ${JSON.stringify(record.provenance)}`,
    `- proposal_idempotency_key: ${yamlScalar(record.proposal_idempotency_key)}`,
    '',
  ].join('\n');
}

export function readDurableKnowledgeRecords(content: string, location: string, expectedKind: 'contract' | 'decision'): DurableKnowledgeRecord[] {
  const markers: DurableKnowledgeRecord[] = [];
  const markerPattern = /<!-- vNext (contract|decision) record: (\{[^\r\n]+\}) -->/g;
  for (const match of content.matchAll(markerPattern)) {
    const markerKind = match[1] as 'contract' | 'decision';
    if (markerKind !== expectedKind) fail('KNOWLEDGE_RECORD_INVALID', `${location} contains a ${markerKind} record in the ${expectedKind} document.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[2]!);
    } catch {
      fail('KNOWLEDGE_RECORD_INVALID', `${location} contains an invalid vNext knowledge marker.`);
    }
    const record = validateDurableKnowledgeRecord(parsed, `${location}.${expectedKind}[${markers.length}]`, expectedKind);
    const markerText = `<!-- vNext ${expectedKind} record: ${JSON.stringify(record)} -->`;
    if (countExactOccurrences(content, markerText) !== 1 || countExactOccurrences(content, renderDurableKnowledgeRecord(record)) !== 1) {
      fail('KNOWLEDGE_PROVENANCE_MISMATCH', `${location}.${expectedKind}[${markers.length}] visible bytes do not match the canonical durable record.`);
    }
    const markerStart = content.indexOf(markerText);
    const section = findUniqueMarkdownSection(scanMarkdownSections(content), [knowledgeSectionTitle(expectedKind)], 2);
    if (!section || markerStart < section.contentStart || markerStart >= section.contentEnd) {
      fail('KNOWLEDGE_RECORD_INVALID', `${location}.${expectedKind}[${markers.length}] is outside the canonical knowledge section.`);
    }
    markers.push(record);
  }
  for (const markerKind of ['contract', 'decision'] as const) {
    const prefix = knowledgeMarkerPrefix(markerKind);
    const markerCount = countExactOccurrences(content, prefix);
    const parsedCount = markers.filter(record => record.knowledge_kind === markerKind).length;
    if (markerCount !== parsedCount) {
      fail('KNOWLEDGE_RECORD_INVALID', `${location} contains a malformed or partially unreadable ${markerKind} record marker.`);
    }
  }
  if (content.includes('<!-- vNext contract record:') && expectedKind !== 'contract') fail('KNOWLEDGE_RECORD_INVALID', `${location} contains a Contract record in the wrong target.`);
  if (content.includes('<!-- vNext decision record:') && expectedKind !== 'decision') fail('KNOWLEDGE_RECORD_INVALID', `${location} contains a Decision record in the wrong target.`);
  return markers;
}

/**
 * Read the complete canonical Runtime knowledge section after validating all
 * durable records through the Runtime parser. Bootstrap preserves this body
 * while rebuilding the surrounding workflow-owned document structure.
 */
export function readCanonicalDurableKnowledgeSection(
  content: string,
  location: string,
  expectedKind: 'contract' | 'decision',
): string | null {
  const records = readDurableKnowledgeRecords(content, location, expectedKind);
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), [knowledgeSectionTitle(expectedKind)], 2);
  if (!section) {
    if (records.length > 0) fail('KNOWLEDGE_RECORD_INVALID', `${location} durable records are missing their canonical knowledge section.`);
    return null;
  }
  return content.slice(section.contentStart, section.contentEnd);
}

function appendKnowledgeSectionIfMissing(content: string, knowledgeKind: 'contract' | 'decision'): string {
  const title = knowledgeSectionTitle(knowledgeKind);
  const sections = scanMarkdownSections(content);
  const existing = findUniqueMarkdownSection(sections, [title], 2);
  if (existing) return content;
  return `${content.trimEnd()}\n\n## ${title}\n\n`;
}

function replaceDurableKnowledgeRecord(
  content: string,
  knowledgeKind: 'contract' | 'decision',
  previous: DurableKnowledgeRecord,
  next: DurableKnowledgeRecord,
): string {
  const previousText = renderDurableKnowledgeRecord(previous);
  if (countExactOccurrences(content, previousText) !== 1) {
    fail('KNOWLEDGE_PROVENANCE_MISMATCH', `canonical ${knowledgeKind} document does not contain exactly one predecessor record for merge.`);
  }
  const start = content.indexOf(previousText);
  if (start < 0) fail('KNOWLEDGE_PROVENANCE_MISMATCH', `canonical ${knowledgeKind} predecessor record cannot be located for merge.`);
  return `${content.slice(0, start)}${renderDurableKnowledgeRecord(next)}${content.slice(start + previousText.length)}`;
}

function knowledgeAdmissionMatches(left: KnowledgeAdmissionRecord, right: KnowledgeAdmissionRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function knowledgeProvenanceMatchesArchive(provenance: KnowledgeProvenance, archive: ArchiveReceipt, proposal: KnowledgeProposal): void {
  const admission = knowledgeAdmissionFromArchive(archive, proposal.semantic_delta.knowledge_kind, proposal.semantic_delta.admission.candidate.candidateId);
  const admissionEvidenceRefs = [
    ...admission.candidate.evidenceRefs,
    ...(admission.candidate.implementation_anchors?.anchors.flatMap(anchor => anchor.evidence_refs) ?? []),
  ];
  if (provenance.task_id !== archive.taskId
    || provenance.task_slug !== archive.taskSlug
    || provenance.document_id !== archive.documentId
    || provenance.archive_path !== archive.relativePath
    || provenance.archive_revision !== archive.revision
    || provenance.source_revision !== archive.sourceRevision
    || !admissionEvidenceRefs.every(ref => provenance.evidence_refs.includes(ref))
    || !provenance.evidence_refs.every(ref => archiveEvidenceRefsForKnowledge(archive).includes(ref))) {
    fail('KNOWLEDGE_PROVENANCE_MISMATCH', 'knowledge proposal provenance does not match the canonical archive receipt.');
  }
  if (!provenance.evidence_refs.every(ref => proposal.evidence_refs.includes(ref))) {
    fail('RUNTIME_EVIDENCE_INVALID', 'knowledge proposal evidence_refs must cover provenance evidence_refs.');
  }
}

function archiveEvidenceRefsForKnowledge(archive: ArchiveReceipt): string[] {
  return [...new Set([
    ...archive.lessonAdmission.evidence_refs,
    ...archive.knowledgeAdmissions.contracts.flatMap(item => [...item.candidate.evidenceRefs, ...(item.candidate.implementation_anchors?.anchors.flatMap(anchor => anchor.evidence_refs) ?? [])]),
    ...archive.knowledgeAdmissions.decisions.flatMap(item => [...item.candidate.evidenceRefs, ...(item.candidate.implementation_anchors?.anchors.flatMap(anchor => anchor.evidence_refs) ?? [])]),
  ])];
}

function durableKnowledgeRecordFromProposal(proposal: KnowledgeProposal, archive: ArchiveReceipt): DurableKnowledgeRecord {
  const delta = proposal.semantic_delta;
  knowledgeProvenanceMatchesArchive(delta.provenance, archive, proposal);
  const admission = delta.admission;
  return {
    schema_version: 1,
    knowledge_kind: delta.knowledge_kind,
    candidate_id: admission.candidate.candidateId,
    candidate_fingerprint: admission.candidate.fingerprint,
    disposition: admission.disposition,
    matched_knowledge_id: admission.matched_knowledge_id,
    candidate: admission.candidate,
    provenance: delta.provenance,
    proposal_idempotency_key: proposal.idempotency_key,
    proposal_digest: digest(proposal),
    semantic_digest: knowledgeCandidateSemanticDigest(admission.candidate),
  };
}

function knowledgeAdmissionFromArchive(archive: ArchiveReceipt, knowledgeKind: 'contract' | 'decision', candidateId: string): KnowledgeAdmissionRecord {
  const admissions = knowledgeKind === 'contract' ? archive.knowledgeAdmissions.contracts : archive.knowledgeAdmissions.decisions;
  const matches = admissions.filter(item => item.candidate.candidateId === candidateId);
  if (matches.length !== 1) fail('KNOWLEDGE_PROVENANCE_MISMATCH', `archive does not contain exactly one ${knowledgeKind} admission for ${candidateId}.`);
  return matches[0]!;
}

function scanKnowledgeRecords(root: string): DurableKnowledgeRecord[] {
  const result: DurableKnowledgeRecord[] = [];
  for (const knowledgeKind of ['contract', 'decision'] as const) {
    const target = knowledgeTarget(root, knowledgeKind);
    if (!fs.existsSync(target.filePath)) continue;
    if (!fs.statSync(target.filePath).isFile()) fail('KNOWLEDGE_RECORD_INVALID', `${target.relativePath} is not a regular file.`);
    result.push(...readDurableKnowledgeRecords(fs.readFileSync(target.filePath, 'utf8'), target.relativePath, knowledgeKind));
  }
  return result;
}

function inspectKnowledgeRecordTransaction(root: string, current: CanonicalCurrentTask, proposal: KnowledgeProposal): KnowledgeRecordTransactionPlan {
  const { receipt } = matchingArchiveReceipt(root, current);
  const delta = proposal.semantic_delta;
  const archiveAdmission = knowledgeAdmissionFromArchive(receipt, delta.knowledge_kind, delta.admission.candidate.candidateId);
  if (!knowledgeAdmissionMatches(archiveAdmission, delta.admission)) fail('KNOWLEDGE_PROVENANCE_MISMATCH', 'knowledge proposal admission does not match the archived close-task admission decision.');
  const expectedRecord = durableKnowledgeRecordFromProposal(proposal, receipt);
  const target = knowledgeTarget(root, delta.knowledge_kind);
  if (!fs.existsSync(target.filePath)) fail('RUNTIME_SOURCE_MISSING', `knowledge target is missing: ${target.relativePath}`);
  const originalContent = fs.readFileSync(target.filePath, 'utf8');
  const records = readDurableKnowledgeRecords(originalContent, target.relativePath, delta.knowledge_kind);
  const allRecords = scanKnowledgeRecords(root);
  const sameIdempotency = allRecords.filter(record => record.proposal_idempotency_key === proposal.idempotency_key);
  if (sameIdempotency.some(record => JSON.stringify(record) !== JSON.stringify(expectedRecord))) {
    fail('IDEMPOTENCY_CONFLICT', 'knowledge idempotency key is already durably bound to a different candidate or target.');
  }
  const sameIdentity = records.filter(record => record.candidate_id === expectedRecord.candidate_id);
  if (sameIdentity.length > 1) fail('KNOWLEDGE_RECORD_INVALID', `knowledge target contains duplicate candidate identity ${expectedRecord.candidate_id}.`);
  if (sameIdentity.length === 1) {
    const existingRecord = sameIdentity[0]!;
    if (JSON.stringify(existingRecord) === JSON.stringify(expectedRecord)) {
      return { filePath: target.filePath, relativePath: target.relativePath, nextContent: originalContent, originalContent, record: expectedRecord, existing: true };
    }
    if (expectedRecord.disposition === 'merge' && expectedRecord.matched_knowledge_id === existingRecord.candidate_id) {
      return {
        filePath: target.filePath,
        relativePath: target.relativePath,
        nextContent: replaceDurableKnowledgeRecord(originalContent, delta.knowledge_kind, existingRecord, expectedRecord),
        originalContent,
        record: expectedRecord,
        existing: false,
      };
    }
    fail('KNOWLEDGE_IDENTITY_CONFLICT', `${target.relativePath} contains different semantic or provenance content for ${expectedRecord.candidate_id}.`);
  }

  if (expectedRecord.disposition === 'merge') {
    const predecessor = records.find(record => record.candidate_id === expectedRecord.matched_knowledge_id);
    if (!predecessor) fail('KNOWLEDGE_ADMISSION_INVALID', `knowledge merge target ${expectedRecord.matched_knowledge_id} is not durably present.`);
    const semanticMatches = records.filter(record => record.semantic_digest === expectedRecord.semantic_digest);
    if (semanticMatches.some(record => record.candidate_id !== predecessor.candidate_id)) {
      fail('KNOWLEDGE_IDENTITY_CONFLICT', 'knowledge merge semantic content already belongs to a different durable item.');
    }
    return {
      filePath: target.filePath,
      relativePath: target.relativePath,
      nextContent: replaceDurableKnowledgeRecord(originalContent, delta.knowledge_kind, predecessor, expectedRecord),
      originalContent,
      record: expectedRecord,
      existing: false,
    };
  }

  const semanticMatches = records.filter(record => record.semantic_digest === expectedRecord.semantic_digest);
  if (semanticMatches.length > 0) {
    return { filePath: target.filePath, relativePath: target.relativePath, nextContent: originalContent, originalContent, record: expectedRecord, existing: true };
  }
  if (expectedRecord.disposition === 'supersede') {
    const predecessor = records.find(record => record.candidate_id === expectedRecord.matched_knowledge_id);
    if (!predecessor) fail('KNOWLEDGE_ADMISSION_INVALID', `knowledge supersede target ${expectedRecord.matched_knowledge_id} is not durably present.`);
  }
  const withSection = appendKnowledgeSectionIfMissing(originalContent, delta.knowledge_kind);
  return {
    filePath: target.filePath,
    relativePath: target.relativePath,
    nextContent: `${withSection}${renderDurableKnowledgeRecord(expectedRecord)}`,
    originalContent,
    record: expectedRecord,
    existing: false,
  };
}

function prepareKnowledgeRecordTransaction(root: string, current: CanonicalCurrentTask, proposal: KnowledgeProposal): KnowledgeRecordTransactionPlan {
  ensureAuthorityKinds(proposal, ['evidence-admission']);
  if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived') {
    fail('KNOWLEDGE_ADMISSION_INVALID', 'knowledge promotion requires a closed + archived task.');
  }
  return inspectKnowledgeRecordTransaction(root, current, proposal);
}

function assertRequestedInboxTargets(root: string, current: CanonicalCurrentTask, proposal: InboxRecordProposal): void {
  if (proposal.source_tuple.path !== current.relativePath) fail('RUNTIME_PATH_INVALID', 'capture proposal source path is not the exact canonical CURRENT_TASK path.');
  const target = canonicalInboxRecordTarget(root, proposal.semantic_delta);
  if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== target.relativePath) {
    fail('RUNTIME_PATH_INVALID', 'capture proposal must name only its exact identity-derived inbox path.');
  }
}

function assertRequestedCloseTargets(root: string, current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.source_tuple.path !== current.relativePath) fail('RUNTIME_PATH_INVALID', 'close-task proposal source path is not the exact canonical CURRENT_TASK path.');
  if (proposal.operation_kind === 'archive-transaction') {
    const archive = archivePathForTask(root, current);
    if (proposal.requested_write_targets.length !== 2 || proposal.requested_write_targets[0] !== current.relativePath || proposal.requested_write_targets[1] !== archive.relativePath) {
      fail('RUNTIME_PATH_INVALID', 'archive proposal must name CURRENT_TASK and its exact identity-derived archive path.');
    }
    return;
  }
  const file = proposal.operation_kind === 'project-status-transaction'
    ? 'STATUS.md'
    : proposal.operation_kind === 'lesson-record-transaction'
      ? 'LESSONS.md'
      : proposal.operation_kind === 'contract-candidate-commit'
        ? 'CONTRACTS.md'
        : proposal.operation_kind === 'decision-record-transaction'
          ? 'DECISIONS.md'
          : null;
  if (file === null) fail('RUNTIME_PATH_INVALID', `${proposal.operation_kind} is not a close-task document operation.`);
  const target = workflowDocPathForRoot(root, file);
  if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== target.relativePath) {
    fail('RUNTIME_PATH_INVALID', `${file} proposal must name only its exact canonical path.`);
  }
}

function assertPreviousTaskReconciliationComplete(root: string, current: CanonicalCurrentTask, receipt: ArchiveReceipt): void {
  const knowledgeAdmissions = [
    ...receipt.knowledgeAdmissions.contracts,
    ...receipt.knowledgeAdmissions.decisions,
  ].filter(admission => ['admit', 'merge', 'supersede'].includes(admission.disposition));
  if (knowledgeAdmissions.length > 0) {
    for (const admission of knowledgeAdmissions) {
      const knowledgeKind = admission.candidate.kind;
      const target = knowledgeTarget(root, knowledgeKind);
      if (!fs.existsSync(target.filePath)) {
        fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} ${knowledgeKind} reconciliation is incomplete: ${target.relativePath} does not exist.`);
      }
      const records = readDurableKnowledgeRecords(fs.readFileSync(target.filePath, 'utf8'), target.relativePath, knowledgeKind);
      const exactIdentity = records.find(record => record.candidate_id === admission.candidate.candidateId);
      const equivalent = records.some(record => record.semantic_digest === knowledgeCandidateSemanticDigest(admission.candidate));
      if (exactIdentity) {
        if (JSON.stringify(exactIdentity.candidate) !== JSON.stringify(admission.candidate)
          || exactIdentity.candidate_fingerprint !== admission.candidate.fingerprint
          || exactIdentity.semantic_digest !== knowledgeCandidateSemanticDigest(admission.candidate)
          || exactIdentity.disposition !== admission.disposition
          || exactIdentity.matched_knowledge_id !== admission.matched_knowledge_id
          || exactIdentity.provenance.task_id !== receipt.taskId
          || exactIdentity.provenance.task_slug !== receipt.taskSlug
          || exactIdentity.provenance.document_id !== receipt.documentId
          || exactIdentity.provenance.archive_path !== receipt.relativePath
          || exactIdentity.provenance.archive_revision !== receipt.revision
          || exactIdentity.provenance.source_revision !== receipt.sourceRevision
          || !exactIdentity.provenance.evidence_refs.every(ref => archiveEvidenceRefsForKnowledge(receipt).includes(ref))) {
          fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} ${knowledgeKind} reconciliation provenance conflicts with the canonical archive.`);
        }
      } else if (!equivalent) {
        fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} ${knowledgeKind} candidate ${admission.candidate.candidateId} has not been reconciled.`);
      }
    }
  }

  const statusTarget = workflowDocPathForRoot(root, 'STATUS.md');
  if (!fs.existsSync(statusTarget.filePath)) {
    fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} STATUS reconciliation is incomplete: STATUS.md does not exist.`);
  }
  const statusContent = fs.readFileSync(statusTarget.filePath, 'utf8');
  const statusReceipt = matchingStatusReceipt(statusContent, statusTarget.relativePath, receipt);
  if (!statusReceipt) {
    fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} STATUS reconciliation is incomplete.`);
  }
  if (
    statusReceipt.taskId !== receipt.taskId
    || statusReceipt.taskSlug !== receipt.taskSlug
    || statusReceipt.documentId !== receipt.documentId
    || statusReceipt.archivePath !== receipt.relativePath
    || statusReceipt.archiveRevision !== receipt.revision
    || statusReceipt.sourceRevision !== receipt.sourceRevision
  ) {
    fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} STATUS reconciliation provenance does not match the canonical archive.`);
  }
  assertStatusProjection(statusContent, statusDeltaFromReceipt(statusReceipt), statusTarget.relativePath);

  if (receipt.lessonAdmission.decision === 'admit') {
    const lessonsTarget = workflowDocPathForRoot(root, 'LESSONS.md');
    if (!fs.existsSync(lessonsTarget.filePath)) {
      fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} lesson reconciliation is incomplete: LESSONS.md does not exist.`);
    }
    const lessonsContent = fs.readFileSync(lessonsTarget.filePath, 'utf8');
    const existingRecords = readDurableLessonRecords(lessonsContent, lessonsTarget.relativePath);
    for (const candidateRef of receipt.lessonAdmission.candidate_refs) {
      const matching = existingRecords.find(record =>
        record.marker.candidate_ref === candidateRef
        && record.marker.task_id === receipt.taskId
        && record.marker.task_slug === receipt.taskSlug
        && record.marker.document_id === receipt.documentId
        && record.marker.archive_path === receipt.relativePath
        && record.marker.archive_revision === receipt.revision
        && record.marker.source_revision === receipt.sourceRevision
      );
      if (!matching) {
        fail('PREVIOUS_TASK_RECONCILIATION_INCOMPLETE', `previous task ${current.runtimeState.task_id} lesson candidate ${candidateRef} has not been reconciled.`);
      }
    }
  }
}

function ensureAuthorityKinds(proposal: RuntimeProposal, required: readonly AuthorityEvidence['kind'][]): void {
  const kinds = new Set(proposal.authority_evidence.map(item => item.kind));
  const missing = required.filter(kind => !kinds.has(kind));
  if (missing.length > 0) fail('RUNTIME_AUTHORITY_MISSING', `proposal is missing authority evidence: ${missing.join(', ')}`);
}

function compareSourceTuple(expected: RuntimeSourceTuple, actual: RuntimeSourceTuple): string | null {
  const fields: Array<keyof RuntimeSourceTuple> = [
    'path',
    'revision',
    'document_id',
    'task_id',
    'task_slug',
    'workflow_status',
    'lifecycle_state',
    'active_step_id',
    'active_step_status',
    'finding_queue_revision',
    'resume_requires_review',
    'resume_review_reasons',
  ];
  for (const field of fields) {
    if (field === 'resume_review_reasons') {
      if (expected[field].join('|') !== actual[field].join('|')) return field;
    } else if (expected[field] !== actual[field]) {
      return field;
    }
  }
  return null;
}

function appendAppliedProposal(
  current: RuntimeState,
  proposal: RuntimeProposal,
  sourceRevision: string,
): RuntimeState['applied_proposals'] {
  const next = [
    ...current.applied_proposals,
    {
      idempotency_key: proposal.idempotency_key,
      operation_kind: proposal.operation_kind,
      proposal_digest: digest(proposal),
      source_revision: sourceRevision,
    },
  ];
  return (current as unknown as AnyRecord).__vnext_compact_history === true ? next : next.slice(-MAX_APPLIED_PROPOSALS);
}

function appendExecutionLogEntry(current: RuntimeState, entry: ExecutionLogEntry): ExecutionLogEntry[] {
  const next = [...current.execution_log, entry];
  return (current as unknown as AnyRecord).__vnext_compact_history === true ? next : next.slice(-MAX_EXECUTION_LOG);
}

export function initializeTaskPreservation(root: string, rawInput: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  return withGovernanceWriteLock(root, () => initializeTaskPreservationLocked(root, rawInput, options));
}

function initializeTaskPreservationLocked(root: string, rawInput: unknown, options: RuntimeApplyOptions): RuntimeResult {
  const input = expectRecord(rawInput, 'initialize-preservation input');
  expectExactKeys(input, ['source_revision', 'basis_revision'], 'initialize-preservation input');
  const sourceRevision = expectString(input.source_revision, 'source_revision', /^[a-f0-9]{64}$/);
  const basisRevision = expectString(input.basis_revision, 'basis_revision', /^[a-f0-9]{64}$/);
  if (!options.dryRun) recoverPendingTaskStoreCommit(root);
  const current = readCanonicalCurrentTask(root);
  const idempotencyKey = `initialize-preservation-${current.sourceTuple.document_id}`;
  if (current.runtimeState.task_evolution_version === 2) {
    if (sourceRevision !== (current.runtimeState.preservation_source_revision ?? current.sourceTuple.revision)) {
      fail('TASK_EVOLUTION_SOURCE_STALE', 'Preservation replay does not name the initialized source revision.');
    }
    const boundBasisRevision = current.runtimeState.preservation_source_revision
      ? (JSON.parse(fs.readFileSync(path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id,
        `${current.runtimeState.preservation_source_revision}.json`), 'utf8')) as { task_basis_revision: string }).task_basis_revision
      : readCanonicalTaskBasis(root, current).revision;
    if (basisRevision !== boundBasisRevision) fail('TASK_EVOLUTION_BASIS_STALE', 'Preservation replay does not name the initialized Task Basis revision.');
    return { status: 'no-op', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey,
      target_path: current.relativePath, dry_run: options.dryRun === true, committed: false,
      message: 'This task already uses task-evolution preservation.', planned_writes: [], governed_mutation_count: 0,
      read_back_verified: true, resulting_revision: current.sourceTuple.revision, evidence_assurance: 'caller-reported' };
  }
  if (current.sourceTuple.revision !== sourceRevision) fail('TASK_EVOLUTION_SOURCE_STALE', 'CURRENT_TASK changed after preservation admission.');
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('TASK_EVOLUTION_STATE_INVALID', 'Preservation initialization requires a confirmed active task.');
  }
  const basis = readCanonicalTaskBasis(root, current);
  if (basis.revision !== basisRevision) fail('TASK_EVOLUTION_BASIS_STALE', 'Task Basis changed after preservation admission.');
  assertTestStrategySequenceReady(current);
  const idempotencyProposal = {
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'task-lifecycle',
    mode: 'default',
    source_tuple: current.sourceTuple,
    semantic_delta: { kind: 'task-state', action: 'initialize-preservation', source_revision: sourceRevision, basis_revision: basisRevision },
    evidence_refs: [],
    idempotency_key: idempotencyKey,
    requested_write_targets: [current.relativePath],
  } as unknown as RuntimeProposal;
  const nextState: RuntimeState = { ...current.runtimeState, task_evolution_version: 2,
    preservation_source_revision: current.sourceTuple.revision,
  };
  const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, nextState);
  const preview = parseCanonicalCurrentTaskContent(nextContent, current.filePath, current.relativePath);
  if (preview.body !== current.body || digest({ ...preview.runtimeState, task_evolution_version: undefined, preservation_source_revision: undefined })
    !== digest({ ...current.runtimeState, task_evolution_version: undefined, preservation_source_revision: undefined })) {
    fail('TASK_EVOLUTION_INIT_INVALID', 'Initialization must preserve the complete definition and runtime state.');
  }
  const history = taskHistoryLocation({ currentPath: current.filePath, previousContent: current.raw, nextContent,
    documentId: current.sourceTuple.document_id, taskId: current.runtimeState.task_id,
    basisPath: basis.filePath, basisContent: basis.content, operation: 'initialize-preservation',
    evidencePlanRevision: current.runtimeState.evidence_plan_revision });
  const plannedWrites = [path.posix.join(path.posix.dirname(current.relativePath), history.relativePath), current.relativePath];
  if (options.dryRun) return { status: 'success', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey,
    target_path: current.relativePath, dry_run: true, committed: false, message: 'Preservation initialization is ready without changing the task definition.',
    planned_writes: plannedWrites, governed_mutation_count: 0, read_back_verified: false, evidence_assurance: 'caller-reported' };
  let stagedAfter: CanonicalCurrentTask;
  try {
    stagedAfter = stageTaskEvolutionStoreCommit(root, current, nextContent, nextState, idempotencyProposal, [
      { path: history.path, content: history.content },
      { path: current.filePath, content: nextContent },
    ]);
  } catch (error) {
    return buildResult('blocked', idempotencyProposal, current, options, `task-store precommit staging failed: ${error instanceof Error ? error.message : String(error)}`, {
      code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
    });
  }
  try {
    commitTaskEvolutionWithHistory({ currentPath: current.filePath, previousContent: current.raw, nextContent,
      documentId: current.sourceTuple.document_id, taskId: current.runtimeState.task_id,
      basisPath: basis.filePath, basisContent: basis.content, operation: 'initialize-preservation',
      evidencePlanRevision: current.runtimeState.evidence_plan_revision }, content => {
      const parsed = parseCanonicalCurrentTaskContent(content, current.filePath, current.relativePath);
      if (parsed.body !== current.body || parsed.runtimeState.preservation_source_revision !== sourceRevision
        || parsed.runtimeState.task_evolution_version !== 2) fail('TASK_EVOLUTION_INIT_INVALID', 'Preservation initialization read-back differs.');
    });
  } catch (error) {
    if (fs.existsSync(current.filePath) && sha256(fs.readFileSync(current.filePath, 'utf8')) === current.sourceTuple.revision) {
      clearPendingTaskStoreAfterRollback(root, current);
    }
    throw error;
  }
  const storeResult = {
    status: 'success',
    committed: true,
    operation_kind: 'task-state-transaction',
    idempotency_key: idempotencyKey,
    message: 'Original task and Task Basis were preserved; versioned task protection is active.',
  };
  try {
    const manifest = completeTaskEvolutionStoreCommit(root, current, stagedAfter, idempotencyProposal, storeResult);
    const readBack = readCanonicalCurrentTask(root);
    return { status: 'success', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey,
      target_path: current.relativePath, dry_run: false, committed: true, previous_revision: sourceRevision,
      resulting_revision: readBack.sourceTuple.revision, message: storeResult.message,
      planned_writes: plannedWrites, governed_mutation_count: plannedWrites.length, read_back_verified: true,
      evidence_assurance: 'caller-reported', task_store: {
        manifest_path: `${manifest.storage_root}/manifest.json`, source_revision: manifest.head.source_revision,
        definition_revision: manifest.head.definition_revision, state_revision: manifest.head.state_revision,
        event_sequence: manifest.head.event_sequence,
      } };
  } catch (error) {
    return { status: 'blocked', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey,
      target_path: current.relativePath, dry_run: false, committed: true, previous_revision: sourceRevision,
      resulting_revision: stagedAfter.sourceTuple.revision, message: `Preservation committed but task-store publication needs recovery: ${error instanceof Error ? error.message : String(error)}`,
      planned_writes: plannedWrites, governed_mutation_count: plannedWrites.length, read_back_verified: false,
      evidence_assurance: 'caller-reported', code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED' };
  }
}

type CorrectionStepInput = {
  id: string;
  description: string;
  mutation_scope: string[];
  required_evidence: string[];
  commands: Array<{ command: string; expected_repo_writes: 'none' | string[] }>;
};

type RecoveryExecutionTarget = { execution_id: string; reason: string; evidence_ref: string; evidence_sha256: string };
type RecoveryObligation = { claim_id: string; slot_id: string; due_step_id: string; before_step_id?: string; replaces_check_id?: string; check?: EvidenceCheck };
type PendingStepRevision = { steps: CorrectionStepInput[]; step_map: Array<{ old_step_id: string; new_step_ids: string[] }> };
type CorrectionCandidateInput = {
  challenge_ids: string[];
  correction_step: CorrectionStepInput;
  mode: 'conclusion-correction' | 'execution-recovery';
  strategy: 'forward-fix' | 'artifact-restore' | 'mixed';
  restore_plan: { checkpoint_id: string; paths: string[] } | null;
  execution_targets: RecoveryExecutionTarget[];
  recovery_steps: CorrectionStepInput[];
  pending_step_changes: PendingStepRevision | null;
  obligation_map: RecoveryObligation[];
};

type CorrectionCandidate = {
  kind: 'correction-replan-candidate/v2';
  restore_plan: ArtifactRestorePlan | null;
  source_tuple: RuntimeSourceTuple;
  evidence_admission: Array<{ claim_id: string; slot_id: string; status: 'reuse' | 'revalidate' | 'contested'; original_result_id: string | null }>;
  evidence_objects: EvidenceObject[];
  problem_keys: string[];
  retained_budget: { review_cycle: ReviewCycleState; step_attempts: RuntimeState['step_attempts'] };
  result_validity: Array<{ execution_id: string; status: 'affected'; recovery_step_id: string }>;
  historical_completion_refs: Array<{ execution_id: string; step_id: string; definition_revision: string }>;
  obligation_map: RecoveryObligation[];
  task_id: string;
  document_id: string;
  source_revision: string;
  basis_revision: string;
  old_plan_revision: string;
  old_obligations: unknown;
  old_obligations_digest: string;
  scope_diff: { added_paths: string[]; removed_paths: string[] };
  step_diff: { inserted_step_id: string; inserted_before: string; retained_step_ids: string[] };
  challenge_digest: string;
  input: CorrectionCandidateInput;
  definition: DraftTaskDefinition;
  claim_evidence: ClaimEvidenceRecord[];
  carry_forward: EvidenceCarryForward[];
  new_plan_revision: string;
  permission_change: 'none';
};

export type CorrectionCandidateReceipt = {
  kind: 'correction-replan-candidate-receipt/v2';
  candidate_digest: string;
  source_revision: string;
  basis_revision: string;
  obligations_digest: string;
  new_plan_revision: string;
  permission_change: 'none';
};

function normalizeCorrectionInput(input: unknown): CorrectionCandidateInput {
  const value = expectRecord(input, 'prepare-replan input');
  const extensionKeys = ['mode', 'strategy', 'execution_targets', 'recovery_steps', 'pending_step_changes', 'obligation_map', 'restore_plan'];
  expectExactKeys(value, [value.challenge_ids === undefined ? 'challenge_id' : 'challenge_ids', 'correction_step', ...extensionKeys.filter(key => key in value)], 'prepare-replan input');
  const mode = value.mode === undefined ? 'conclusion-correction' : expectEnum(value.mode, ['conclusion-correction', 'execution-recovery'], 'recovery mode');
  const strategy = value.strategy === undefined ? 'forward-fix' : expectEnum(value.strategy, ['forward-fix', 'artifact-restore', 'mixed'], 'strategy');
  let restore: CorrectionCandidateInput['restore_plan'] = null;
  if (value.restore_plan != null) {
    const item = expectRecord(value.restore_plan, 'restore_plan');
    expectExactKeys(item, ['checkpoint_id', 'paths'], 'restore_plan');
    restore = { checkpoint_id: expectString(item.checkpoint_id, 'checkpoint_id', /^[a-f0-9]{64}$/), paths: expectStringArray(item.paths, 'restore paths', false, 128).map(p => normalizeRepoPath(p, 'restore path')) };
  }
  if ((strategy === 'forward-fix') !== (restore === null) || (mode === 'conclusion-correction' && strategy !== 'forward-fix')) fail('RECOVERY_STRATEGY_UNSUPPORTED', 'Restore strategies require execution-recovery mode and a verified restore plan.');
  const challengeIds = value.challenge_ids === undefined
    ? [expectString(value.challenge_id, 'challenge_id', SAFE_KEY_PATTERN)]
    : expectStringArray(value.challenge_ids, 'challenge_ids', mode === 'execution-recovery', 16).map(id => expectString(id, 'challenge_id', SAFE_KEY_PATTERN));
  if (new Set(challengeIds).size !== challengeIds.length) fail('REPLAN_CHALLENGE_REQUIRED', 'Challenge targets must be unique.');
  const executions = value.execution_targets ?? [];
  if (!Array.isArray(executions) || executions.length > 16) fail('RECOVERY_TARGET_INVALID', 'Execution targets must be bounded.');
  const executionTargets = executions.map(raw => {
    const target = expectRecord(raw, 'execution target');
    expectExactKeys(target, ['execution_id', 'reason', 'evidence_ref', 'evidence_sha256'], 'execution target');
    return { execution_id: expectString(target.execution_id, 'execution_id', SAFE_KEY_PATTERN), reason: expectText(target.reason, 'reason', 2048),
      evidence_ref: normalizeRepoPath(expectString(target.evidence_ref, 'evidence_ref'), 'evidence_ref'),
      evidence_sha256: expectString(target.evidence_sha256, 'evidence_sha256', /^[a-f0-9]{64}$/) };
  });
  if (new Set(executionTargets.map(item => item.execution_id)).size !== executionTargets.length
    || (mode === 'conclusion-correction' && executionTargets.length) || (!challengeIds.length && !executionTargets.length)) fail('RECOVERY_TARGET_INVALID', 'Recovery needs unique, correctly typed targets.');
  const recoverySteps = value.recovery_steps ?? [];
  if (!Array.isArray(recoverySteps) || recoverySteps.length > 15) fail('RECOVERY_STEPS_INVALID', 'At most 16 recovery steps are supported.');
  const obligations = value.obligation_map ?? [];
  if (!Array.isArray(obligations) || obligations.length > 128) fail('RECOVERY_OBLIGATION_INVALID', 'Obligation mapping must be bounded.');
  const obligationMap = obligations.map(raw => {
    const item = expectRecord(raw, 'obligation');
    expectExactKeys(item, ['claim_id', 'slot_id', 'due_step_id', ...(item.before_step_id === undefined ? [] : ['before_step_id']), ...(item.check === undefined ? [] : ['check', 'replaces_check_id'])], 'obligation');
    return { claim_id: expectString(item.claim_id, 'claim_id', CLAIM_ID_PATTERN), slot_id: expectString(item.slot_id, 'slot_id', CLAIM_EVIDENCE_SLOT_ID_PATTERN),
      due_step_id: expectString(item.due_step_id, 'due_step_id', STEP_ID_PATTERN),
      ...(item.before_step_id === undefined ? {} : { before_step_id: expectString(item.before_step_id, 'before_step_id', STEP_ID_PATTERN) }),
      ...(item.check === undefined ? {} : { check: validateEvidenceCheck(item.check, 'replacement check'), replaces_check_id: expectString(item.replaces_check_id, 'replaces_check_id', CLAIM_ID_PATTERN) }) };
  });
  let pending: PendingStepRevision | null = null;
  if (value.pending_step_changes != null) {
    const item = expectRecord(value.pending_step_changes, 'pending_step_changes');
    expectExactKeys(item, ['steps', 'step_map'], 'pending_step_changes');
    if (!Array.isArray(item.steps) || item.steps.length > 32 || !Array.isArray(item.step_map) || item.step_map.length > 32) fail('RECOVERY_PENDING_INVALID', 'Pending plan and mapping must be bounded.');
    pending = { steps: item.steps.map(normalizeCorrectionStep), step_map: item.step_map.map(raw => {
      const map = expectRecord(raw, 'step_map entry');
      expectExactKeys(map, ['old_step_id', 'new_step_ids'], 'step_map entry');
      return { old_step_id: expectString(map.old_step_id, 'old_step_id', STEP_ID_PATTERN), new_step_ids: expectStringArray(map.new_step_ids, 'new_step_ids', false, 32) };
    }) };
  }
  return { challenge_ids: [...challengeIds].sort(), correction_step: normalizeCorrectionStep(value.correction_step), mode,
    strategy, restore_plan: restore, execution_targets: executionTargets, recovery_steps: recoverySteps.map(normalizeCorrectionStep),
    pending_step_changes: pending, obligation_map: obligationMap };
}

function normalizeCorrectionStep(raw: unknown): CorrectionStepInput {
  const step = expectRecord(raw, 'correction_step');
  expectExactKeys(step, ['id', 'description', 'mutation_scope', 'required_evidence', 'commands'], 'correction_step');
  const id = expectString(step.id, 'correction_step.id', STEP_ID_PATTERN);
  const description = expectText(step.description, 'correction_step.description', 512);
  if (/[\r\n]/u.test(description)) fail('REPLAN_CORRECTION_INVALID', 'Correction description must be one line.');
  const mutationScope = expectStringArray(step.mutation_scope, 'correction_step.mutation_scope', false, 32).map(item => normalizeRepoPath(item, 'correction_step.mutation_scope'));
  if (mutationScope.some(item => item.includes('*'))) fail('REPLAN_SCOPE_EXPANSION', 'Correction writes require exact authorized non-executable paths.');
  const requiredEvidence = expectStringArray(step.required_evidence, 'correction_step.required_evidence', false, 32);
  if (requiredEvidence.some(item => /[\r\n]/u.test(item))) fail('REPLAN_CORRECTION_INVALID', 'Required evidence must use one line per item.');
  if (!Array.isArray(step.commands) || step.commands.length > 32) fail('REPLAN_CORRECTION_INVALID', 'Correction commands must be a bounded array.');
  const commands = step.commands.map((raw, index) => {
    const command = expectRecord(raw, `correction_step.commands[${index}]`);
    expectExactKeys(command, ['command', 'expected_repo_writes'], `correction_step.commands[${index}]`);
    const text = expectText(command.command, `correction_step.commands[${index}].command`, 2048);
    if (/[\r\n]/u.test(text)) fail('REPLAN_CORRECTION_INVALID', 'Command must be one line.');
    const writes = command.expected_repo_writes === 'none' ? 'none' as const
      : expectStringArray(command.expected_repo_writes, `correction_step.commands[${index}].expected_repo_writes`, false, 32).map(item => normalizeRepoPath(item, 'expected_repo_writes'));
    if (writes !== 'none' && writes.some(item => !mutationScope.includes(item))) fail('REPLAN_SCOPE_EXPANSION', 'Command writes must be exact members of the correction step scope.');
    return { command: text, expected_repo_writes: writes };
  });
  return { id, description, mutation_scope: mutationScope, required_evidence: requiredEvidence, commands };
}

function validateEvidenceCheck(value: unknown, location: string): EvidenceCheck {
  const check = expectRecord(value, location);
  expectExactKeys(check, ['check_id', 'method', 'entry', 'expected_observation', 'required_boundaries', 'allowed_substitutes', 'subject_paths', 'expected_result'], location);
  return { check_id: expectString(check.check_id, 'check_id', CLAIM_ID_PATTERN),
    method: expectEnum(check.method, ['execution', 'static', 'human'], 'check.method'), entry: expectText(check.entry, 'check.entry'),
    expected_observation: expectText(check.expected_observation, 'check.expected_observation'),
    required_boundaries: expectStringArray(check.required_boundaries, 'required_boundaries', false, 256),
    allowed_substitutes: expectStringArray(check.allowed_substitutes, 'allowed_substitutes', true, 256),
    subject_paths: expectStringArray(check.subject_paths, 'subject_paths', false, 256).map(p => normalizeRepoPath(p, 'subject_paths')),
    expected_result: expectEnum(check.expected_result, ['passed', 'accepted', 'expected-failure'], 'expected_result') };
}

function executedStepIds(current: CanonicalCurrentTask): Set<string> {
  return new Set([
    ...current.runtimeState.execution_log.flatMap(item => 'step_id' in item ? [item.step_id] : []),
    ...Object.entries(current.runtimeState.step_attempts ?? {}).filter(([, ledger]) => ledger.attempts.length).map(([id]) => id),
  ]);
}

function revisePendingSteps(current: CanonicalCurrentTask, definition: DraftTaskDefinition, revision: PendingStepRevision, recoverySteps: CorrectionStepInput[]): DraftTaskDefinition {
  const executed = executedStepIds(current);
  const oldSteps = parseImplementationSteps(definition.implementation_steps);
  const pendingIds = oldSteps.filter(step => !executed.has(step.id)).map(step => step.id);
  const obligations = [...pendingIds];
  if (current.runtimeState.workflow_status === 'blocked_by_replan' && current.runtimeState.active_step_status !== 'completed' && !obligations.includes(current.runtimeState.active_step_id)) obligations.push(current.runtimeState.active_step_id);
  if (digest(obligations.sort()) !== digest(revision.step_map.map(item => item.old_step_id).sort())) fail('RECOVERY_OBLIGATION_INVALID', 'Every never-executed step and suspended unfinished attempt requires exactly one replacement mapping.');
  const nextIds = new Set([...recoverySteps, ...revision.steps].map(step => step.id));
  if (revision.step_map.some(item => item.new_step_ids.some(id => !nextIds.has(id)))) fail('RECOVERY_OBLIGATION_INVALID', 'Step obligation maps to a missing execution step.');
  if (revision.steps.some(step => oldSteps.some(old => old.id === step.id))) fail('RECOVERY_STEP_ID_REUSED', 'Changed definitions require new step IDs; executed definitions cannot be overwritten.');
  const blocks = definition.implementation_steps.split(/(?=^-\s*[A-Za-z0-9][A-Za-z0-9._:-]*\s*[:：])/m);
  const keepBlocks = blocks.filter(block => !pendingIds.some(id => block.startsWith(`- ${id}:`) || block.startsWith(`- ${id}：`)));
  const keptPlan = definition.implementation_plan.split('\n').filter(line => !pendingIds.some(id => line.startsWith(`- ${id}:`)));
  // Recovery insertion below needs one existing executed anchor. Its bytes stay intact.
  if (!oldSteps.some(step => executed.has(step.id))) fail('RECOVERY_HISTORY_REQUIRED', 'Pending-plan recovery requires retained execution history.');
  let next = { ...definition, implementation_steps: keepBlocks.join(''), implementation_plan: keptPlan.join('\n') };
  for (const step of revision.steps) next = insertCorrectionStep(next, parseImplementationSteps(next.implementation_steps).at(-1)!.id, step, true);
  return next;
}

function correctionCandidateLocation(current: CanonicalCurrentTask, candidateDigest: string): { filePath: string; relativePath: string } {
  if (!/^[a-f0-9]{64}$/u.test(candidateDigest)) fail('REPLAN_CANDIDATE_INVALID', 'Candidate digest must be SHA-256.');
  const directory = path.join(path.dirname(current.filePath), 'task-candidates', current.sourceTuple.document_id);
  const filePath = path.join(directory, `${candidateDigest}.json`);
  return { filePath, relativePath: path.posix.join(path.posix.dirname(current.relativePath), 'task-candidates', current.sourceTuple.document_id, `${candidateDigest}.json`) };
}

function pendingCorrectionCandidates(current: CanonicalCurrentTask): Array<{ candidate_digest: string; candidate_path: string; valid: boolean }> {
  const directory = path.join(path.dirname(current.filePath), 'task-candidates', current.sourceTuple.document_id);
  if (!fs.existsSync(directory)) return [];
  const names = fs.readdirSync(directory).filter(item => /^[a-f0-9]{64}\.json$/u.test(item));
  if (names.length > 128) fail('REPLAN_CANDIDATE_BUDGET_EXHAUSTED', 'Task has too many retained candidates to summarize safely.');
  return names.flatMap(name => {
    const candidateDigest = name.slice(0, -5);
    const location = correctionCandidateLocation(current, candidateDigest);
    if (fs.existsSync(`${location.filePath}.discarded`)) return [];
    try {
      const value = JSON.parse(fs.readFileSync(location.filePath, 'utf8')) as CorrectionCandidate & { candidate_digest: string };
      if (value.source_revision !== current.sourceTuple.revision || value.document_id !== current.sourceTuple.document_id) return [];
      const { candidate_digest: _marker, ...payload } = value;
      return [{ candidate_digest: candidateDigest, candidate_path: location.relativePath,
        valid: value.candidate_digest === candidateDigest && digest(payload) === candidateDigest }];
    } catch {
      return [{ candidate_digest: candidateDigest, candidate_path: location.relativePath, valid: false }];
    }
  });
}

function correctionObligations(current: CanonicalCurrentTask): unknown {
  const definition = readDraftDefinitionFromBody(current.body);
  const steps = parseImplementationSteps(definition.implementation_steps);
  return {
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    goal: definition.background_context,
    acceptance: definition.acceptance,
    scope: [definition.allowed_scope, definition.conditional_scope, definition.forbidden_scope],
    steps: steps.map(step => ({ id: step.id, description: step.description, purpose: step.purpose, mutation_scope: step.mutation_scope, required_evidence: step.required_evidence, review_checkpoint: step.review_checkpoint, checkpoint_boundary: step.checkpoint_boundary })),
    claims: (current.runtimeState.claim_evidence ?? []).map(record => ({ claim_id: record.claim_id, claim_kind: record.claim_kind, requirement: record.requirement, source_ref: record.source_ref, slots: record.slots.map(slot => ({
      slot_id: slot.slot_id, minimum_type: slot.minimum_type, due_step_id: slot.due_step_id, applicability: slot.applicability,
      before_step_id: slot.before_step_id, check: slot.check, disposition: slot.disposition,
      evidence_refs: slot.evidence_refs, report_result_id: slot.report?.result_id ?? null,
      report_status: slot.report?.status ?? null, report_sha256: slot.report ? digest(slot.report) : null,
    })) })),
    findings: current.runtimeState.findings.map(item => ({ fingerprint: item.fingerprint, status: item.status })),
  };
}

function insertCorrectionStep(definition: DraftTaskDefinition, activeStepId: string, step: CorrectionStepInput, append = false): DraftTaskDefinition {
  const oldSteps = parseImplementationSteps(definition.implementation_steps);
  if (oldSteps.some(item => item.id === step.id)) fail('REPLAN_CORRECTION_INVALID', 'Correction step ID already exists.');
  const activeIndex = oldSteps.findIndex(item => item.id === activeStepId);
  if (activeIndex < 0) fail('REPLAN_CORRECTION_INVALID', 'A correction requires an existing active step.');
  const rendered = [
    `- ${step.id}: ${step.description}`,
    `  - purpose: Correct the challenged result ${step.description}`,
    `  - mutation_scope: ${step.mutation_scope.join(', ')}`,
    `  - required_evidence: ${step.required_evidence.join('; ')}`,
    '  - review_checkpoint: required: fresh correction review of the affected audit documents',
    ...step.commands.flatMap(item => [
      `  - planned_command: ${item.command}`,
      `    - expected_repo_writes: ${item.expected_repo_writes === 'none' ? 'none' : item.expected_repo_writes.join(', ')}`,
      '    - transformation_kind: localized',
    ]),
  ].join('\n');
  const lines = definition.implementation_steps.split('\n');
  const insertion = lines.findIndex(line => new RegExp(`^-\\s*${activeStepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]`).test(line));
  if (insertion < 0) fail('REPLAN_CORRECTION_INVALID', 'The current step must have one explicit top-level definition line.');
  lines.splice(append ? lines.length : insertion, 0, rendered);
  const planLines = definition.implementation_plan.split('\n');
  const planIndex = planLines.findIndex(line => line.startsWith(`- ${activeStepId}:`));
  if (planIndex < 0) fail('REPLAN_CORRECTION_INVALID', 'The current step must be present in the implementation plan.');
  planLines.splice(append ? planLines.length : planIndex, 0, `- ${step.id}: ${step.description}`);
  const next = { ...definition, implementation_steps: lines.join('\n'), implementation_plan: planLines.join('\n') };
  assertReplacementActiveStep(step.id, next.implementation_steps);
  return next;
}

function buildCorrectionCandidate(root: string, current: CanonicalCurrentTask, input: CorrectionCandidateInput): CorrectionCandidate {
  const suspended = current.runtimeState.workflow_status === 'blocked_by_replan';
  if (!['active', 'superseded', 'blocked_by_replan'].includes(current.runtimeState.workflow_status) || current.runtimeState.lifecycle_state !== 'active'
    || current.runtimeState.resume_requires_review || (!suspended && !['ready', 'completed'].includes(current.runtimeState.active_step_status))
    || (!suspended && current.runtimeState.pending_review_result) || current.runtimeState.findings.some(item => ['admitted', 'in-progress'].includes(item.status))) {
    fail('REPLAN_CANDIDATE_STATE_INVALID', 'Restricted correction requires a ready active/superseded task without a competing review, finding, or resume gate.');
  }
  assertBusinessEvidenceVersion(current);
  assertTestStrategySequenceReady(current);
  const unresolved = (current.runtimeState.evidence_challenges ?? []).filter(item => item.status !== 'resolved');
  if (unresolved.some(item => item.correction_step_id !== null)) fail('REPLAN_CANDIDATE_CONFLICT', 'Finish the active recovery batch before preparing another.');
  const challenges = input.challenge_ids.map(id => unresolved.find(item => item.challenge_id === id));
  if (challenges.some(item => !item)) {
    fail('REPLAN_CHALLENGE_REQUIRED', 'Every target must bind an unresolved, unassigned challenge.');
  }
  for (const challenge of challenges) {
    const evidencePath = path.resolve(root, challenge!.evidence_ref);
    if (!fs.existsSync(evidencePath) || sha256(fs.readFileSync(evidencePath)) !== challenge!.evidence_sha256) fail('EVIDENCE_CHALLENGE_SOURCE_STALE', 'Challenge evidence changed.');
  }
  const step = input.correction_step;
  const recoverySteps = [step, ...input.recovery_steps];
  if (suspended && !input.pending_step_changes) fail('RECOVERY_OBLIGATION_INVALID', 'A suspended attempt requires an explicit future plan; its old step cannot be executed again under the old ID.');
  const allNewSteps = [...recoverySteps, ...(input.pending_step_changes?.steps ?? [])];
  if (new Set(allNewSteps.map(item => item.id)).size !== allNewSteps.length) fail('RECOVERY_STEP_ID_REUSED', 'Recovery and pending step IDs must be unique.');
  const writes = [...new Set(allNewSteps.flatMap(item => item.mutation_scope))];
  if (evaluateMutationScope(parseMutationScope(current.body), { changed_paths: writes }).status !== 'pass') fail('REPLAN_SCOPE_EXPANSION', 'Recovery paths exceed the old task scope.');
  if (input.mode === 'conclusion-correction') {
    const boundaries = nonExecutableChangePatterns(root);
    if (writes.some(p => !boundaries.some(boundary => mutationScopePatternIsSubset(p, boundary)))) fail('REPLAN_SCOPE_EXPANSION', 'Conclusion correction requires project-declared non-executable paths within original task authority.');
  }
  const executionTargets = input.execution_targets.map(target => {
    const execution = current.runtimeState.execution_log.find(item => !('action' in item) && item.idempotency_key === target.execution_id);
    if (!execution || 'action' in execution || !execution.execution_result) fail('RECOVERY_TARGET_INVALID', 'Execution target must name a real retained result in this task.');
    if (describeEvidenceObjects(root, [target.evidence_ref])[0]?.sha256 !== target.evidence_sha256) fail('RECOVERY_TARGET_STALE', 'Execution diagnosis evidence changed.');
    return execution;
  });
  const restorePlan = input.restore_plan ? prepareArtifactRestore(root, current.filePath, current.runtimeState.task_id,
    current.sourceTuple.document_id, input.restore_plan.checkpoint_id, input.restore_plan.paths) : null;
  if (restorePlan) {
    if (!current.runtimeState.artifact_checkpoint_ids?.includes(restorePlan.checkpoint_id)) fail('ARTIFACT_CHECKPOINT_UNCOMMITTED', 'Checkpoint digest does not bind a committed task execution or preflight.');
    if (restorePlan.targets.some(item => !step.mutation_scope.includes(item.path)) || !step.commands.some(command => command.command === 'runtime:artifact-restore'
      && command.expected_repo_writes !== 'none' && digest([...command.expected_repo_writes].sort()) === digest(restorePlan.targets.map(item => item.path)))) fail('ARTIFACT_RESTORE_FOOTPRINT_REQUIRED', 'First recovery step must declare runtime:artifact-restore with the exact restore paths.');
  }
  const basis = readCanonicalTaskBasis(root, current);
  const oldObligations = correctionObligations(current);
  const retainedStepIds = parseImplementationSteps(readDraftDefinitionFromBody(current.body).implementation_steps).map(item => item.id);
  const append = current.runtimeState.active_step_status === 'completed';
  if (append && retainedStepIds.at(-1) !== current.runtimeState.active_step_id) fail('REPLAN_CANDIDATE_STATE_INVALID', 'Only a completed final step supports append.');
  let definition = readDraftDefinitionFromBody(current.body);
  if (input.pending_step_changes) definition = revisePendingSteps(current, definition, input.pending_step_changes, recoverySteps);
  const pendingAnchor = input.pending_step_changes?.steps[0]?.id;
  const anchor = pendingAnchor ?? (input.pending_step_changes ? parseImplementationSteps(definition.implementation_steps).at(-1)!.id : current.runtimeState.active_step_id);
  const appendRecovery = input.pending_step_changes ? !pendingAnchor : append;
  for (const recoveryStep of recoverySteps) definition = insertCorrectionStep(definition, anchor, recoveryStep, appendRecovery);
  assertPreparedTestStrategy(root, definition, basis.basis);
  const records = copyClaimEvidence(current.runtimeState.claim_evidence ?? []);
  const correctedSlots = new Set<ClaimEvidenceSlot>();
  for (const challenge of challenges) {
    const corrected = records.find(item => item.claim_id === challenge!.claim_id)?.slots.find(item => item.slot_id === challenge!.slot_id);
    const sourceSlot = current.runtimeState.claim_evidence?.find(item => item.claim_id === challenge!.claim_id)?.slots.find(item => item.slot_id === challenge!.slot_id);
    if (!sourceSlot?.report || !corrected?.check || !challengeReportIsRetained(root, current, challenge!, sourceSlot.report.result_id)) fail('REPLAN_CHALLENGE_STALE', 'The challenged report has no verified correction relationship to the current report.');
    if (corrected && correctedSlots.has(corrected)) continue;
    correctedSlots.add(corrected);
    corrected.due_step_id = step.id;
    corrected.disposition = 'missing';
    corrected.evidence_refs = [];
    corrected.report = null;
    delete corrected.prerequisite_receipt;
  }
  const slots = records.flatMap(record => record.slots.map(slot => ({ record, slot })));
  const explicitMap = input.obligation_map;
  if ((input.mode === 'execution-recovery' || input.pending_step_changes) && !explicitMap.length) fail('RECOVERY_OBLIGATION_INVALID', 'Execution or pending-plan recovery requires the complete old claim/slot obligation map.');
  if (explicitMap.length && (explicitMap.length !== slots.length || new Set(explicitMap.map(item => `${item.claim_id}/${item.slot_id}`)).size !== slots.length)) fail('RECOVERY_OBLIGATION_INVALID', 'Each old claim/slot must occur exactly once.');
  const newIds = new Set(allNewSteps.map(item => item.id));
  for (const { record, slot } of slots) {
    const mapping = explicitMap.find(item => item.claim_id === record.claim_id && item.slot_id === slot.slot_id);
    if (explicitMap.length && !mapping) fail('RECOVERY_OBLIGATION_INVALID', 'Old obligation is missing.');
    const targeted = executionTargets.some(execution => execution.execution_result!.acceptance_evidence.some(evidence => !('acceptance' in evidence)
      && evidence.claim_id === record.claim_id && evidence.slot_id === slot.slot_id));
    if (targeted && (!mapping || !newIds.has(mapping.due_step_id))) fail('RECOVERY_OBLIGATION_INVALID', 'Affected evidence must be assigned to a new execution or verification step.');
    if (!mapping) continue;
    if (mapping.before_step_id && mapping.before_step_id !== slot.before_step_id) {
      if (slot.applicability !== 'before-step' || !newIds.has(mapping.before_step_id) || !newIds.has(mapping.due_step_id)) fail('RECOVERY_PREREQUISITE_INVALID', 'A new consumer requires a new preceding verification step.');
      slot.before_step_id = mapping.before_step_id;
      delete slot.prerequisite_receipt;
    }
    if (!parseImplementationSteps(definition.implementation_steps).some(item => item.id === mapping.due_step_id)) fail('RECOVERY_OBLIGATION_INVALID', 'Obligation destination does not exist.');
    if (mapping.check) {
      if (mapping.replaces_check_id !== slot.check?.check_id || (current.runtimeState.claim_evidence ?? []).some(claim => claim.slots.some(old => old.check?.check_id === mapping.check!.check_id))) fail('RECOVERY_CHECK_ID_REUSED', 'Replacement check needs a new identity and the exact superseded check reference.');
      if (slot.check!.required_boundaries.some(boundary => !mapping.check!.required_boundaries.includes(boundary))
        || slot.check!.subject_paths.some(p => !mapping.check!.subject_paths.includes(p))) fail('RECOVERY_CHECK_WEAKENED', 'Existing required boundaries and subjects cannot be removed by recovery.');
      slot.check = mapping.check;
    }
    if (targeted || mapping.check || mapping.due_step_id !== slot.due_step_id) {
      if (!newIds.has(mapping.due_step_id)) fail('RECOVERY_OBLIGATION_INVALID', 'Changed evidence must bind a new verification step.');
      slot.due_step_id = mapping.due_step_id;
      slot.report = null; slot.evidence_refs = []; slot.disposition = 'missing'; delete slot.prerequisite_receipt;
      correctedSlots.add(slot);
    }
  }
  const newPlan = assertEvidencePlan(definition, records);
  const carry: EvidenceCarryForward[] = [];
  for (const record of records) for (const slot of record.slots) {
    if (correctedSlots.has(slot) || !slot.report) continue;
    if (unresolved.some(item => item.claim_id === record.claim_id && item.slot_id === slot.slot_id)) continue;
    const oldSlot = current.runtimeState.claim_evidence?.find(item => item.claim_id === record.claim_id)?.slots.find(item => item.slot_id === slot.slot_id);
    if (!oldSlot?.report || !slot.check) fail('REPLAN_CARRY_FORWARD_INVALID', 'Candidate evidence source changed.');
    if (!COMPLETE_CLAIM_EVIDENCE_DISPOSITIONS.includes(slot.disposition)) { slot.report = null; slot.evidence_refs = []; slot.disposition = 'missing'; continue; }
    assertEvidenceReportApplicable(root, current, oldSlot);
    const origin = (current.runtimeState.evidence_carry_forward ?? []).find(item => item.claim_id === record.claim_id
      && item.slot_id === slot.slot_id && item.result_id === slot.report!.result_id && item.new_plan_revision === current.runtimeState.evidence_plan_revision);
    if (origin?.kind === 'evidence-carry-forward/v1') fail('EVIDENCE_CARRY_FORWARD_UPGRADE_REQUIRED', 'The v1 source lacks preserved evidence bodies; revalidate this affected slot before carrying it again.');
    carry.push({ kind: 'evidence-carry-forward/v2', old_source_revision: origin?.old_source_revision ?? current.sourceTuple.revision,
      old_plan_revision: slot.report.evidence_plan_revision, new_plan_revision: newPlan,
      receiving_source_revision: current.sourceTuple.revision, evidence_objects: describeEvidenceObjects(root, slot.evidence_refs),
      context_revision: recoveryEvidenceContextRevision(root),
      claim_id: record.claim_id, slot_id: slot.slot_id, check_id: slot.check.check_id,
      result_id: slot.report.result_id, report_sha256: digest(slot.report), subject_revision: slot.report.subject_revision });
    slot.disposition = 'reused';
  }
  return {
    kind: 'correction-replan-candidate/v2', task_id: current.runtimeState.task_id, document_id: current.sourceTuple.document_id,
    problem_keys: [...new Set([
      ...challenges.map(item => `claim:${item!.claim_id}/${item!.slot_id}`),
      ...executionTargets.flatMap(item => {
        const refs = item.execution_result!.acceptance_evidence.flatMap(evidence => 'acceptance' in evidence ? [] : [`claim:${evidence.claim_id}/${evidence.slot_id}`]);
        const inherited = inheritedRecoveryProblemKeys(current, item.step_id);
        return [...inherited, ...(refs.length ? refs : [`execution-step:${item.step_id}`])];
      }),
    ])].sort(),
    retained_budget: { review_cycle: current.runtimeState.review_cycle, step_attempts: current.runtimeState.step_attempts ?? {} },
    source_tuple: current.sourceTuple,
    evidence_admission: slots.map(({ record, slot }) => ({ claim_id: record.claim_id, slot_id: slot.slot_id,
      status: carry.some(item => item.claim_id === record.claim_id && item.slot_id === slot.slot_id) ? 'reuse' : slot.report ? 'contested' : 'revalidate',
      original_result_id: current.runtimeState.claim_evidence?.find(item => item.claim_id === record.claim_id)?.slots.find(item => item.slot_id === slot.slot_id)?.report?.result_id ?? null })),
    restore_plan: restorePlan,
    result_validity: executionTargets.map(item => ({ execution_id: item.idempotency_key, status: 'affected', recovery_step_id: step.id })),
    historical_completion_refs: current.runtimeState.execution_log.flatMap(item => !('action' in item) && item.status === 'completed'
      ? [{ execution_id: item.idempotency_key, step_id: item.step_id, definition_revision: digest(parseImplementationSteps(readDraftDefinitionFromBody(current.body).implementation_steps).find(old => old.id === item.step_id)) }] : []),
    obligation_map: slots.map(({ record, slot }) => ({ claim_id: record.claim_id, slot_id: slot.slot_id, due_step_id: slot.due_step_id!,
      ...explicitMap.find(item => item.claim_id === record.claim_id && item.slot_id === slot.slot_id) })),
    evidence_objects: describeEvidenceObjects(root, [...writes.filter(p => fs.existsSync(path.resolve(root, p))),
      ...(current.runtimeState.claim_evidence ?? []).flatMap(record => record.slots.flatMap(slot => slot.evidence_refs))]),
    source_revision: current.sourceTuple.revision, basis_revision: basis.revision,
    old_plan_revision: current.runtimeState.evidence_plan_revision!, old_obligations: oldObligations,
    old_obligations_digest: digest(oldObligations), scope_diff: { added_paths: [], removed_paths: [] },
    step_diff: { inserted_step_id: step.id, inserted_before: append ? 'task-end' : current.runtimeState.active_step_id, retained_step_ids: retainedStepIds },
    challenge_digest: digest(challenges), input, definition, claim_evidence: records, carry_forward: carry,
    new_plan_revision: newPlan, permission_change: 'none',
  };
}

export function prepareCorrectionReplan(root: string, rawInput: unknown, options: RuntimeApplyOptions = {}): RuntimeResult & { candidate_receipt: CorrectionCandidateReceipt; candidate_path: string } {
  return withGovernanceWriteLock(root, () => prepareCorrectionReplanLocked(root, rawInput, options));
}

function prepareCorrectionReplanLocked(root: string, rawInput: unknown, options: RuntimeApplyOptions): RuntimeResult & { candidate_receipt: CorrectionCandidateReceipt; candidate_path: string } {
  if (!options.dryRun) recoverPendingTaskStoreCommit(root);
  const current = readCanonicalCurrentTask(root);
  const input = normalizeCorrectionInput(rawInput);
  const candidate = buildCorrectionCandidate(root, current, input);
  const candidateDigest = digest(candidate);
  const location = correctionCandidateLocation(current, candidateDigest);
  const content = JSON.stringify({ ...candidate, candidate_digest: candidateDigest }, null, 2) + '\n';
  const existed = fs.existsSync(location.filePath);
  const candidateDirectory = path.dirname(location.filePath);
  if (fs.existsSync(candidateDirectory)) {
    const prior = fs.readdirSync(candidateDirectory).filter(item => item.endsWith('.json'));
    if (prior.length > 128) fail('REPLAN_CANDIDATE_BUDGET_EXHAUSTED', 'Task candidate inventory exceeds the bounded limit.');
    let sameChallengeCount = 0;
    let sameProblemCount = 0;
    const committed = new Set(current.runtimeState.execution_log.flatMap(entry => 'action' in entry && entry.action === 'commit-replan' && entry.candidate_digest ? [`${entry.candidate_digest}.json`] : []));
    for (const name of prior) {
      const discarded = fs.existsSync(path.join(candidateDirectory, `${name}.discarded`));
      if (name !== path.basename(location.filePath) && !discarded && !committed.has(name)) fail('REPLAN_CANDIDATE_CONFLICT', 'Discard the existing unconfirmed recovery candidate before preparing another batch.');
      let previous: { problem_keys?: string[]; input?: { challenge_id?: string; challenge_ids?: string[] } };
      try { previous = JSON.parse(fs.readFileSync(path.join(candidateDirectory, name), 'utf8')) as typeof previous; }
      catch {
        if (!discarded) fail('REPLAN_CANDIDATE_INVALID', `Unreadable candidate ${name} must be discarded before preparing another.`);
        continue;
      }
      if (previous.problem_keys?.some(key => candidate.problem_keys.includes(key))) sameProblemCount += 1;
      if (!(previous.input?.challenge_ids ?? [previous.input?.challenge_id]).some(id => id && input.challenge_ids.includes(id))) continue;
      sameChallengeCount += 1;
      if (name !== path.basename(location.filePath) && !discarded) {
        fail('REPLAN_CANDIDATE_CONFLICT', 'Discard the earlier unconfirmed correction candidate before preparing a different one for this challenge.');
      }
    }
    if (sameChallengeCount >= 3 && !existed) fail('REPLAN_CANDIDATE_BUDGET_EXHAUSTED', 'Three candidates have already been retained for this challenged result.');
    if (sameProblemCount >= 8 && !existed) fail('REPLAN_CANDIDATE_BUDGET_EXHAUSTED', 'Eight candidates already address these task claim/slot or historical-step identities; renaming evidence or recovery IDs cannot reset this budget.');
  }
  if (!options.dryRun) {
    preserveEvidenceObjects(root, current.filePath, candidate.evidence_objects);
    fs.mkdirSync(path.dirname(location.filePath), { recursive: true });
    if (existed) {
      if (fs.readFileSync(location.filePath, 'utf8') !== content) fail('REPLAN_CANDIDATE_CONFLICT', 'Existing candidate bytes differ.');
    } else {
      const fd = fs.openSync(location.filePath, 'wx');
      try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    if (fs.readFileSync(location.filePath, 'utf8') !== content) fail('REPLAN_CANDIDATE_READ_BACK_FAILED', 'Candidate read-back failed.');
  }
  return {
    status: existed ? 'no-op' : 'success', operation_kind: 'task-state-transaction',
    idempotency_key: `prepare-replan-${candidateDigest.slice(0, 40)}`, target_path: location.relativePath,
    dry_run: options.dryRun === true, committed: !options.dryRun && !existed, message: 'Restricted correction candidate prepared; CURRENT_TASK is unchanged.',
    planned_writes: [location.relativePath], governed_mutation_count: options.dryRun || existed ? 0 : 1,
    read_back_verified: options.dryRun !== true, evidence_assurance: 'caller-reported',
    candidate_path: location.relativePath,
    candidate_receipt: { kind: 'correction-replan-candidate-receipt/v2', candidate_digest: candidateDigest,
      source_revision: candidate.source_revision, basis_revision: candidate.basis_revision,
      obligations_digest: candidate.old_obligations_digest, new_plan_revision: candidate.new_plan_revision,
      permission_change: 'none' },
  };
}

export function confirmCorrectionReplan(root: string, rawInput: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  return withGovernanceWriteLock(root, () => confirmCorrectionReplanLocked(root, rawInput, options));
}

function confirmCorrectionReplanLocked(root: string, rawInput: unknown, options: RuntimeApplyOptions): RuntimeResult {
  const source = expectRecord(rawInput, 'confirm-replan input');
  expectExactKeys(source, ['candidate_receipt', 'authorization'], 'confirm-replan input');
  const receipt = expectRecord(source.candidate_receipt, 'candidate_receipt');
  expectExactKeys(receipt, ['kind', 'candidate_digest', 'source_revision', 'basis_revision', 'obligations_digest', 'new_plan_revision', 'permission_change'], 'candidate_receipt');
  if (receipt.kind !== 'correction-replan-candidate-receipt/v2' || receipt.permission_change !== 'none') fail('REPLAN_CONFIRMATION_INVALID', 'Receipt kind or permission change is invalid; prepare a new versioned candidate.');
  for (const field of ['candidate_digest', 'source_revision', 'basis_revision', 'obligations_digest', 'new_plan_revision']) expectString(receipt[field], `candidate_receipt.${field}`, /^[a-f0-9]{64}$/);
  const approval = expectRecord(source.authorization, 'authorization');
  expectExactKeys(approval, ['approved_candidate_digest', 'decision_source', 'decision_text', 'invalidation_reason', ...(approval.reactivate_superseded === undefined ? [] : ['reactivate_superseded'])], 'authorization');
  if (approval.approved_candidate_digest !== receipt.candidate_digest) fail('REPLAN_CONFIRMATION_INVALID', 'Authorization does not name the exact candidate digest.');
  const decisionSource = expectText(approval.decision_source, 'authorization.decision_source', 512);
  const decisionText = expectText(approval.decision_text, 'authorization.decision_text', 4096);
  const invalidationReason = expectText(approval.invalidation_reason, 'authorization.invalidation_reason', 1024);
  if (!options.dryRun) recoverPendingTaskStoreCommit(root);
  const current = readCanonicalCurrentTask(root);
  const candidateDigest = receipt.candidate_digest as string;
  const location = correctionCandidateLocation(current, candidateDigest);
  const idempotencyKey = `confirm-replan-${digest({ receipt, approval }).slice(0, 40)}`;
  const previousCommit = current.runtimeState.execution_log.find(item => 'action' in item && item.action === 'commit-replan' && item.evidence_refs.includes(location.relativePath));
  if (previousCommit) {
    if (previousCommit.idempotency_key !== idempotencyKey) fail('REPLAN_ALREADY_COMMITTED', 'This candidate was confirmed with different authorization semantics.');
    assertTaskHistoryForRevision(current.filePath, current.sourceTuple.document_id, current.runtimeState.task_id, previousCommit.source_revision, 'confirm-replan');
    return { status: 'no-op', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey, target_path: current.relativePath,
      dry_run: options.dryRun === true, committed: false, message: 'Exact correction confirmation was already committed.', planned_writes: [],
      governed_mutation_count: 0, read_back_verified: true, resulting_revision: current.sourceTuple.revision, evidence_assurance: 'caller-reported', state: resultState(current.runtimeState) };
  }
  if (current.runtimeState.task_evolution_version !== 2) fail('TASK_EVOLUTION_INITIALIZATION_REQUIRED', 'Initialize v2 task preservation before confirming recovery for an older task.');
  if (current.runtimeState.workflow_status === 'superseded') {
    const lastSupersede = current.runtimeState.execution_log.findLast(item => 'action' in item && item.action === 'supersede');
    if (!lastSupersede || !('invalidation_kind' in lastSupersede) || lastSupersede.invalidation_kind !== 'acceptance'
      || approval.reactivate_superseded !== true) {
      fail('REPLAN_SUPERSEDED_AUTHORITY_REQUIRED', 'A superseded task can use restricted correction only for an acceptance-result invalidation with explicit reactivation approval.');
    }
  } else if (approval.reactivate_superseded !== undefined) {
    fail('REPLAN_CONFIRMATION_INVALID', 'An active task cannot carry superseded-reactivation approval.');
  }
  if (current.sourceTuple.revision !== receipt.source_revision) fail('REPLAN_SOURCE_STALE', 'CURRENT_TASK changed after candidate preparation.');
  const basis = readCanonicalTaskBasis(root, current);
  if (basis.revision !== receipt.basis_revision || digest(correctionObligations(current)) !== receipt.obligations_digest) fail('REPLAN_OBLIGATIONS_STALE', 'Task Basis or old obligations changed after candidate preparation.');
  if (!fs.existsSync(location.filePath) || fs.existsSync(`${location.filePath}.discarded`)) fail('REPLAN_CANDIDATE_MISSING', 'Candidate is absent or discarded.');
  const saved = JSON.parse(fs.readFileSync(location.filePath, 'utf8')) as CorrectionCandidate & { candidate_digest: string };
  if (saved.candidate_digest !== candidateDigest) fail('REPLAN_CANDIDATE_INVALID', 'Candidate digest marker differs.');
  const { candidate_digest: _marker, ...storedCandidate } = saved;
  if (digest(storedCandidate) !== candidateDigest) fail('REPLAN_CANDIDATE_INVALID', 'Candidate content changed after preparation.');
  const rebuilt = buildCorrectionCandidate(root, current, normalizeCorrectionInput(saved.input));
  if (digest(rebuilt) !== candidateDigest || rebuilt.new_plan_revision !== receipt.new_plan_revision
    || rebuilt.old_obligations_digest !== receipt.obligations_digest || rebuilt.basis_revision !== receipt.basis_revision) {
    fail('REPLAN_CANDIDATE_STALE', 'Candidate no longer matches the Runtime-computed source, obligations, and evidence.');
  }
  if (current.runtimeState.workflow_status !== 'blocked_by_replan' && current.runtimeState.active_step_status !== 'completed' && current.runtimeState.step_attempts?.[current.runtimeState.active_step_id]?.attempts.length) fail('REPLAN_ACTIVE_ATTEMPT_PRESENT', 'Suspend the retained current attempt before preparing its recovery.');
  const challenges = (current.runtimeState.evidence_challenges ?? []).filter(item => rebuilt.input.challenge_ids.includes(item.challenge_id));
  const challengeRefs = challenges.map(item => item.evidence_ref);
  const nextBasis: TaskBasis = { original_request: basis.basis.original_request, user_decisions: [...basis.basis.user_decisions, { source: decisionSource, verbatim: decisionText }] };
  const nextBasisArtifact = materializeTaskBasis(root, current,
    { task_id: current.runtimeState.task_id, task_slug: current.runtimeState.task_slug,
      task_title: extractTaskIdentityFromCurrentTask(current.body).title, document_id: current.sourceTuple.document_id }, nextBasis);
  const authorityEvidence: AuthorityEvidence[] = (['active-task-owner', 'scope-admission', 'evidence-admission', 'authorized-caller'] as const).map(kind => ({
    kind, source: decisionSource, subject: candidateDigest, task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id, source_revision: current.sourceTuple.revision,
  }));
  const proposal = createPrepareTaskReplanProposal(current, {
    delta: { kind: 'task-state', action: 'commit-replan', task_basis: nextBasis,
      replacement_definition: rebuilt.definition, active_step_id: rebuilt.input.correction_step.id,
      claim_evidence: rebuilt.claim_evidence, evidence_refs: [location.relativePath, ...challengeRefs] },
    idempotency_key: idempotencyKey, authority_evidence: authorityEvidence, evidence_refs: [location.relativePath, ...challengeRefs],
  });
  const oldState = current.runtimeState;
  const nextWithoutAudit: RuntimeState = {
    ...oldState, workflow_status: 'active', lifecycle_state: 'active', active_step_id: rebuilt.input.correction_step.id,
    ...(oldState.review_coverage ? { review_coverage: { ...oldState.review_coverage, last_clean_revision: null } } : {}),
    active_step_status: 'ready', evidence_plan_revision: rebuilt.new_plan_revision,
    claim_evidence: rebuilt.claim_evidence, evidence_carry_forward: rebuilt.carry_forward,
    evidence_challenges: (current.runtimeState.evidence_challenges ?? []).map(item => rebuilt.input.challenge_ids.includes(item.challenge_id)
      ? { ...item, status: 'invalidated' as const, correction_step_id: rebuilt.input.correction_step.id } : item),
    pending_review_result: null,
    review_cycle: reviewCycleForNextStep(current.runtimeState.review_cycle.id, rebuilt.input.correction_step.id, idempotencyKey),
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
  };
  const audit: ReplanAuditLogEntry = { ...makeReplanAudit(current, proposal, nextWithoutAudit, options.now?.() ?? new Date().toISOString()), candidate_digest: candidateDigest, correction_reason: invalidationReason };
  const nextState = { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) };
  const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, nextState,
    { replacementDefinition: rebuilt.definition, taskBasisReference: { path: basis.path, revision: nextBasisArtifact.revision }, audit });
  const preview = parseCanonicalCurrentTaskContent(nextContent, current.filePath, current.relativePath);
  if (preview.runtimeState.evidence_plan_revision !== rebuilt.new_plan_revision || preview.runtimeState.active_step_id !== rebuilt.input.correction_step.id) {
    fail('REPLAN_CANDIDATE_INVALID', 'Rendered correction does not match the admitted plan and step.');
  }
  const history = taskHistoryLocation({ currentPath: current.filePath, previousContent: current.raw, nextContent,
    documentId: current.sourceTuple.document_id, taskId: current.runtimeState.task_id,
    basisPath: basis.filePath, basisContent: basis.content, nextBasisContent: nextBasisArtifact.content,
    operation: 'confirm-replan', evidencePlanRevision: current.runtimeState.evidence_plan_revision,
    referencedEvidence: [...challengeRefs, ...rebuilt.carry_forward.flatMap(item => {
      const slot = rebuilt.claim_evidence.find(record => record.claim_id === item.claim_id)?.slots.find(entry => entry.slot_id === item.slot_id);
      return slot?.evidence_refs ?? [];
    })] });
  const plannedWrites = [path.posix.join(path.posix.dirname(current.relativePath), history.relativePath), basis.path, current.relativePath];
  if (options.dryRun) return {
    status: 'success', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey, target_path: current.relativePath,
    dry_run: true, committed: false, message: 'Correction confirmation dry run passed; no live task was changed.',
    planned_writes: plannedWrites, governed_mutation_count: 0, read_back_verified: false, evidence_assurance: 'caller-reported',
  };
  let stagedAfter: CanonicalCurrentTask;
  try {
    stagedAfter = stageTaskEvolutionStoreCommit(root, current, nextContent, nextState, proposal, [
      { path: history.path, content: history.content },
      { path: nextBasisArtifact.filePath, content: nextBasisArtifact.content },
      { path: current.filePath, content: nextContent },
    ]);
  } catch (error) {
    return buildResult('blocked', proposal, current, options, `task-store precommit staging failed: ${error instanceof Error ? error.message : String(error)}`, {
      code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
    });
  }
  try {
    commitTaskEvolutionWithHistory({ currentPath: current.filePath, previousContent: current.raw, nextContent,
      documentId: current.sourceTuple.document_id, taskId: current.runtimeState.task_id,
      basisPath: basis.filePath, basisContent: basis.content, nextBasisContent: nextBasisArtifact.content,
      operation: 'confirm-replan', evidencePlanRevision: current.runtimeState.evidence_plan_revision,
      referencedEvidence: challengeRefs }, content => {
      const parsed = parseCanonicalCurrentTaskContent(content, current.filePath, current.relativePath);
      if (parsed.runtimeState.evidence_plan_revision !== rebuilt.new_plan_revision || parsed.runtimeState.active_step_id !== rebuilt.input.correction_step.id
        || readCanonicalTaskBasis(root, parsed).revision !== nextBasisArtifact.revision) fail('REPLAN_READ_BACK_FAILED', 'Correction task/Basis read-back is inconsistent.');
    });
  } catch (error) {
    if (fs.existsSync(current.filePath) && sha256(fs.readFileSync(current.filePath, 'utf8')) === current.sourceTuple.revision) {
      clearPendingTaskStoreAfterRollback(root, current);
    }
    throw error;
  }
  const storeResult = {
    status: 'success',
    committed: true,
    operation_kind: 'task-state-transaction',
    idempotency_key: idempotencyKey,
    message: 'Restricted correction confirmed; old obligations, original next step, and immutable preimage retained.',
  };
  try {
    const manifest = completeTaskEvolutionStoreCommit(root, current, stagedAfter, proposal, storeResult);
    const readBack = readCanonicalCurrentTask(root);
    return { status: 'success', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey, target_path: current.relativePath,
      dry_run: false, committed: true, message: storeResult.message,
      planned_writes: plannedWrites, governed_mutation_count: 3, read_back_verified: readBack.raw === nextContent,
      previous_revision: current.sourceTuple.revision, resulting_revision: readBack.sourceTuple.revision,
      evidence_assurance: 'caller-reported', state: resultState(readBack.runtimeState), task_store: {
        manifest_path: `${manifest.storage_root}/manifest.json`, source_revision: manifest.head.source_revision,
        definition_revision: manifest.head.definition_revision, state_revision: manifest.head.state_revision,
        event_sequence: manifest.head.event_sequence,
      } };
  } catch (error) {
    return { status: 'blocked', operation_kind: 'task-state-transaction', idempotency_key: idempotencyKey, target_path: current.relativePath,
      dry_run: false, committed: true, message: `Correction committed but task-store publication needs recovery: ${error instanceof Error ? error.message : String(error)}`,
      planned_writes: plannedWrites, governed_mutation_count: 3, read_back_verified: false,
      previous_revision: current.sourceTuple.revision, resulting_revision: stagedAfter.sourceTuple.revision,
      evidence_assurance: 'caller-reported', code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
      state: resultState(stagedAfter.runtimeState) };
  }
}

export function discardCorrectionReplan(root: string, rawInput: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  return withGovernanceWriteLock(root, () => discardCorrectionReplanLocked(root, rawInput, options));
}

function discardCorrectionReplanLocked(root: string, rawInput: unknown, options: RuntimeApplyOptions): RuntimeResult {
  if (!options.dryRun) recoverPendingTaskStoreCommit(root);
  const input = expectRecord(rawInput, 'discard-replan input');
  expectExactKeys(input, ['candidate_digest'], 'discard-replan input');
  const current = readCanonicalCurrentTask(root);
  const candidateDigest = expectString(input.candidate_digest, 'candidate_digest', /^[a-f0-9]{64}$/);
  const location = correctionCandidateLocation(current, candidateDigest);
  if (!fs.existsSync(location.filePath)) fail('REPLAN_CANDIDATE_MISSING', 'Candidate does not exist.');
  const marker = `${location.filePath}.discarded`;
  const existed = fs.existsSync(marker);
  if (!options.dryRun && !existed) fs.writeFileSync(marker, `${candidateDigest}\n`, { flag: 'wx' });
  return { status: existed ? 'no-op' : 'success', operation_kind: 'task-state-transaction',
    idempotency_key: `discard-replan-${candidateDigest.slice(0, 40)}`, target_path: location.relativePath,
    dry_run: options.dryRun === true, committed: !options.dryRun && !existed, message: 'Candidate discarded; CURRENT_TASK lifecycle was not changed.',
    planned_writes: [`${location.relativePath}.discarded`],
    governed_mutation_count: options.dryRun || existed ? 0 : 1, read_back_verified: options.dryRun !== true,
    evidence_assurance: 'caller-reported' };
}

function artifactRestoreCompletion(root: string, current: CanonicalCurrentTask, candidate: CorrectionCandidate,
  attempt = current.runtimeState.step_attempts?.[candidate.input.correction_step.id]?.attempts.at(-1), originCompletion?: string) {
  if (!attempt) fail('ARTIFACT_RESTORE_PREFLIGHT_REQUIRED', 'Restore requires a durable attempt.');
  const receipt = { kind: originCompletion ? 'artifact-restore-completion/v2' : 'artifact-restore-completion/v1', task_id: current.runtimeState.task_id, document_id: current.sourceTuple.document_id,
    candidate_digest: digest(candidate), plan_revision: candidate.new_plan_revision, step_id: candidate.input.correction_step.id,
    attempt_id: attempt.attempt_id, preflight_id: attempt.idempotency_key, restore_plan_digest: digest(candidate.restore_plan),
    ...(originCompletion ? { origin_completion: originCompletion } : {}) };
  const id = digest(receipt);
  const location = path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id, 'artifact-restores', `${id}.json`);
  const file = safeRepositoryFile(root, path.relative(root, location).replace(/\\/g, '/'));
  return { id, file, bytes: JSON.stringify(receipt) + '\n' };
}

function restoreCompletionMatches(completion: ReturnType<typeof artifactRestoreCompletion>): boolean {
  return fs.existsSync(completion.file) && fs.statSync(completion.file).size === Buffer.byteLength(completion.bytes)
    && fs.readFileSync(completion.file, 'utf8') === completion.bytes;
}

function restoreCompletionOrigin(root: string, current: CanonicalCurrentTask, candidate: CorrectionCandidate) {
  // Only direct v1 executions are origins. Retries never grow a receipt chain.
  for (const attempt of current.runtimeState.step_attempts?.[candidate.input.correction_step.id]?.attempts ?? []) {
    const origin = artifactRestoreCompletion(root, current, candidate, attempt);
    if (restoreCompletionMatches(origin)) return origin;
  }
  return null;
}

function currentRestoreCompletion(root: string, current: CanonicalCurrentTask, candidate: CorrectionCandidate) {
  const direct = artifactRestoreCompletion(root, current, candidate);
  if (fs.existsSync(direct.file)) return restoreCompletionMatches(direct) ? direct : null;
  const origin = restoreCompletionOrigin(root, current, candidate);
  if (!origin) return null;
  const revalidated = artifactRestoreCompletion(root, current, candidate, undefined, origin.id);
  return restoreCompletionMatches(revalidated) ? revalidated : null;
}

function persistRestoreCompletion(completion: ReturnType<typeof artifactRestoreCompletion>): void {
  fs.mkdirSync(path.dirname(completion.file), { recursive: true });
  if (!fs.existsSync(completion.file)) {
    const fd = fs.openSync(completion.file, 'wx');
    try { fs.writeFileSync(fd, completion.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  if (!restoreCompletionMatches(completion)) fail('ARTIFACT_RESTORE_COMPLETION_INVALID', 'Immutable restore completion differs.');
}

function assertArtifactRestoreCompleted(root: string, current: CanonicalCurrentTask): void {
  const candidate = confirmedRecoveryCandidates(current).find(item => item.input.correction_step.id === current.runtimeState.active_step_id && item.restore_plan);
  if (!candidate) return;
  if (!currentRestoreCompletion(root, current, candidate)) fail('ARTIFACT_RESTORE_COMPLETION_REQUIRED', 'Run or revalidate the confirmed Runtime restore for this exact attempt before reporting success.');
  if (digest(captureArtifactImages(root, current.filePath, candidate.restore_plan!.targets.map(image => image.path))) !== digest(candidate.restore_plan!.targets)) fail('ARTIFACT_RESTORE_TARGET_STALE', 'Restored paths changed; the confirmed target images are required at result and completion. Put forward edits in a subsequent recovery step.');
}

export function executeConfirmedArtifactRestore(root: string, sourceRevision: string, stepId: string, candidatePaths: string[], dryRun = false) {
  return withGovernanceWriteLock(root, () => {
    if (!dryRun) recoverPendingTaskStoreCommit(root);
    const current = readCanonicalCurrentTask(root);
    if (current.sourceTuple.revision !== sourceRevision || current.runtimeState.active_step_id !== stepId) fail('ARTIFACT_RESTORE_STALE', 'Preflight task source changed.');
    assertOrdinaryPreflight(current, root);
    const audit = current.runtimeState.execution_log.findLast(item => 'action' in item && item.action === 'commit-replan');
    if (!audit || !('candidate_digest' in audit) || !audit.candidate_digest) fail('ARTIFACT_RESTORE_UNAUTHORIZED', 'No confirmed recovery candidate.');
    const location = correctionCandidateLocation(current, audit.candidate_digest);
    const { candidate_digest: marker, ...candidate } = JSON.parse(fs.readFileSync(location.filePath, 'utf8')) as CorrectionCandidate & { candidate_digest: string };
    if (marker !== audit.candidate_digest || digest(candidate) !== marker || candidate.kind !== 'correction-replan-candidate/v2'
      || candidate.input.correction_step.id !== stepId || !candidate.restore_plan || candidate.new_plan_revision !== current.runtimeState.evidence_plan_revision) fail('ARTIFACT_RESTORE_UNAUTHORIZED', 'Restore must bind the exact confirmed candidate and first recovery step.');
    const paths = candidate.restore_plan.targets.map(item => item.path);
    if (paths.some(p => !candidatePaths.includes(p)) || evaluateMutationScope(parseMutationScope(current.body), { changed_paths: paths }).status !== 'pass') fail('ARTIFACT_RESTORE_SCOPE', 'Restore writes exceed current preflight or task scope.');
    if (current.runtimeState.step_attempts?.[stepId]?.attempts.at(-1)?.status !== 'preflighted') fail('ARTIFACT_RESTORE_PREFLIGHT_REQUIRED', 'Restore needs the current recorded preflight.');
    const checked = prepareArtifactRestore(root, current.filePath, current.runtimeState.task_id, current.sourceTuple.document_id, candidate.restore_plan.checkpoint_id, paths);
    if (digest(checked.checkpoint) !== digest(candidate.restore_plan.checkpoint) || digest(checked.targets) !== digest(candidate.restore_plan.targets)) fail('ARTIFACT_RESTORE_STALE', 'The confirmed checkpoint changed.');
    if (digest(checked.expected) === digest(candidate.restore_plan.targets)) {
      const existing = currentRestoreCompletion(root, current, candidate);
      if (existing) return { status: 'no-op', committed: false, evidence_assurance: 'caller-reported', execution_kind: 'revalidated', restored_paths: paths };
      const origin = restoreCompletionOrigin(root, current, candidate);
      if (origin) {
        const completion = artifactRestoreCompletion(root, current, candidate, undefined, origin.id);
        if (!dryRun) persistRestoreCompletion(completion);
        return { status: 'success', committed: !dryRun, evidence_assurance: 'caller-reported', execution_kind: 'revalidated', restored_paths: paths,
          origin_completion: origin.id, next: 'Run fresh post-restore checks and complete required review for this attempt.' };
      }
      if (digest(checked.expected) !== digest(candidate.restore_plan.expected)) fail('ARTIFACT_RESTORE_COMPLETION_REQUIRED', 'Matching target files alone cannot prove an earlier Runtime restore.');
    }
    if (digest(checked.expected) !== digest(candidate.restore_plan.expected)) fail('ARTIFACT_RESTORE_STALE', 'Current files changed after confirmation.');
    const completion = artifactRestoreCompletion(root, current, candidate);
    if (!dryRun) applyArtifactRestore(root, current.filePath, candidate.restore_plan, undefined, () => persistRestoreCompletion(completion));
    return { status: 'success', committed: !dryRun, evidence_assurance: 'caller-reported', execution_kind: 'restored', restored_paths: paths,
      next: 'Run the declared post-restore checks, record-step-result, and complete the required review.' };
  });
}

export function listArtifactCheckpoints(root: string) {
  const current = readCanonicalCurrentTask(root);
  const directory = path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id, 'artifact-checkpoints');
  const names = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)) : [];
  if (names.length > 256) fail('ARTIFACT_BUDGET_EXHAUSTED', 'Checkpoint inventory exceeds the bounded summary limit.');
  return { status: 'success', checkpoints: names.map(name => {
    const checkpoint = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (digest(checkpoint) !== name.slice(0, -5)) fail('ARTIFACT_CHECKPOINT_CORRUPT', 'Checkpoint digest differs.');
    return { checkpoint_id: name.slice(0, -5), step_id: checkpoint.step_id, execution_id: checkpoint.execution_id, phase: checkpoint.phase,
      committed: current.runtimeState.artifact_checkpoint_ids?.includes(name.slice(0, -5)) === true, paths: checkpoint.images.map((image: { path: string }) => image.path) };
  }) };
}

export function currentDefinitionExecutionLog(current: CanonicalCurrentTask): ExecutionLogEntry[] {
  const log = current.runtimeState.execution_log;
  const lastReplan = log.findLastIndex(item => 'action' in item && item.action === 'commit-replan');
  return log.slice(lastReplan + 1);
}

function implementationStepBlock(definition: DraftTaskDefinition, stepId: string): string | undefined {
  return definition.implementation_steps.split(/(?=^-\s*[A-Za-z0-9][A-Za-z0-9._:-]*\s*[:：])/m)
    .find(block => block.startsWith(`- ${stepId}:`) || block.startsWith(`- ${stepId}：`))?.trimEnd();
}

function confirmedRecoveryCandidates(current: CanonicalCurrentTask): CorrectionCandidate[] {
  // Canonical reads have already verified these immutable, confirmed candidates.
  return current.runtimeState.execution_log.flatMap(entry => {
    if (!('action' in entry) || entry.action !== 'commit-replan' || !entry.candidate_digest) return [];
    const { candidate_digest: marker, ...candidate } = JSON.parse(fs.readFileSync(correctionCandidateLocation(current, entry.candidate_digest).filePath, 'utf8')) as CorrectionCandidate & { candidate_digest: string };
    if (marker !== entry.candidate_digest || digest(candidate) !== marker) fail('RECOVERY_HISTORY_CORRUPT', 'Confirmed recovery candidate changed.');
    return candidate.kind === 'correction-replan-candidate/v2' ? [candidate] : [];
  });
}

function recoveryOwnedStepIds(candidate: CorrectionCandidate): string[] {
  return [candidate.input.correction_step.id, ...candidate.input.recovery_steps.map(step => step.id), ...(candidate.input.pending_step_changes?.steps ?? []).map(step => step.id)];
}

function inheritedRecoveryProblemKeys(current: CanonicalCurrentTask, stepId: string): string[] {
  const candidates = confirmedRecoveryCandidates(current);
  const pending = [stepId], visited = new Set<string>(), keys = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const candidate of candidates) if (recoveryOwnedStepIds(candidate).includes(id)) {
      for (const key of candidate.problem_keys) keys.add(key);
      // Follow retained execution identities, including old v2 candidates whose
      // stored problem keys preceded the inheritance fix. Never rewrite them.
      for (const target of candidate.input.execution_targets) {
        const execution = current.runtimeState.execution_log.find(entry => !('action' in entry) && entry.idempotency_key === target.execution_id);
        if (execution && !('action' in execution)) pending.push(execution.step_id);
      }
      for (const mapping of candidate.input.pending_step_changes?.step_map ?? []) pending.push(mapping.old_step_id);
    }
  }
  return [...keys];
}

function challengeReportIsRetained(root: string, current: CanonicalCurrentTask, challenge: EvidenceChallenge, currentResultId: string): boolean {
  if (challenge.result_id === currentResultId) return true;
  // Edges come only from confirmed batches with real results and clean reviewed
  // completion snapshots. The bounded execution log also bounds this traversal.
  const edges = new Map<string, Set<string>>();
  for (const candidate of confirmedRecoveryCandidates(current)) {
    const stepId = candidate.input.correction_step.id;
    const parents = (current.runtimeState.evidence_challenges ?? []).filter(item => candidate.input.challenge_ids.includes(item.challenge_id)
      && item.claim_id === challenge.claim_id && item.slot_id === challenge.slot_id && item.correction_step_id === stepId && item.status === 'resolved');
    if (!parents.length) continue;
    const completion = current.runtimeState.execution_log.find(entry => !('action' in entry) && entry.step_id === stepId
      && entry.status === 'completed' && entry.review_receipt?.verdict === 'clean');
    if (!completion || 'action' in completion) continue;
    const slot = completion.claim_evidence?.find(item => item.claim_id === challenge.claim_id)?.slots.find(item => item.slot_id === challenge.slot_id);
    if (!slot?.report || !slot.check || slot.report.status !== slot.check.expected_result) continue;
    const executed = current.runtimeState.execution_log.some(entry => !('action' in entry) && entry.step_id === stepId
      && entry.execution_result?.acceptance_evidence.some(evidence => !('acceptance' in evidence) && evidence.claim_id === challenge.claim_id
        && evidence.slot_id === challenge.slot_id && evidence.check_id === slot.check!.check_id && digest(evidence.report) === digest(slot.report)));
    if (!executed) continue;
    // The selected challenges can refer to older reports than the one this
    // batch actually replaced. Preserve both relationships, using the verified
    // source preimage rather than caller-supplied lineage or current state.
    assertTaskHistoryForRevision(current.filePath, current.sourceTuple.document_id, current.runtimeState.task_id, candidate.source_revision, 'confirm-replan');
    const historyPath = path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id, `${candidate.source_revision}.json`);
    const history = JSON.parse(fs.readFileSync(safeRepositoryFile(root, path.relative(root, historyPath).replace(/\\/g, '/')), 'utf8'));
    const source = parseCanonicalCurrentTaskContent(Buffer.from(history.current_task_base64, 'base64').toString('utf8'), current.filePath, current.relativePath);
    const replaced = source.runtimeState.claim_evidence?.find(item => item.claim_id === challenge.claim_id)?.slots.find(item => item.slot_id === challenge.slot_id)?.report;
    if (!replaced) continue;
    for (const resultId of new Set([replaced.result_id, ...parents.map(parent => parent.result_id)])) {
      const outputs = edges.get(resultId) ?? new Set<string>();
      outputs.add(slot.report.result_id);
      edges.set(resultId, outputs);
    }
  }
  const pending = [challenge.result_id], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === currentResultId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(edges.get(id) ?? []));
  }
  return false;
}

function recoveryProblemBudget(current: CanonicalCurrentTask): { failedAttempts: number; repairWaves: Set<string> } | null {
  const candidates = confirmedRecoveryCandidates(current);
  const recoveryIds = recoveryOwnedStepIds;
  const active = candidates.find(candidate => recoveryIds(candidate).includes(current.runtimeState.active_step_id));
  if (!active) return null;
  const keys = new Set([...active.problem_keys, ...inheritedRecoveryProblemKeys(current, current.runtimeState.active_step_id)]);
  // A batch connects its problem identities; later splitting it cannot reset budgets.
  for (let pass = 0; pass < candidates.length; pass++) {
    for (const candidate of candidates) if (candidate.problem_keys.some(key => keys.has(key))) {
      for (const key of candidate.problem_keys) keys.add(key);
    }
  }
  const steps = new Set<string>();
  const repairWaves = new Set<string>();
  for (const candidate of candidates) if (candidate.problem_keys.some(key => keys.has(key))) {
    for (const id of recoveryIds(candidate)) steps.add(id);
    for (const mapping of candidate.input.pending_step_changes?.step_map ?? []) steps.add(mapping.old_step_id);
    for (const wave of candidate.retained_budget.review_cycle.counted_repair_wave_ids) repairWaves.add(wave);
  }
  for (const entry of current.runtimeState.execution_log) if (!('action' in entry)) {
    if (keys.has(`execution-step:${entry.step_id}`) || entry.execution_result?.acceptance_evidence.some(evidence => !('acceptance' in evidence) && keys.has(`claim:${evidence.claim_id}/${evidence.slot_id}`))) steps.add(entry.step_id);
  }
  for (const entry of current.runtimeState.execution_log) if (!('action' in entry) && steps.has(entry.step_id) && entry.repair_wave_id) repairWaves.add(entry.repair_wave_id);
  for (const wave of current.runtimeState.review_cycle.counted_repair_wave_ids) repairWaves.add(wave);
  const failedAttempts = [...steps].reduce((count, id) => count + (current.runtimeState.step_attempts?.[id]?.attempts.filter(attempt => attempt.blocker !== null).length ?? 0), 0);
  return { failedAttempts, repairWaves };
}

function assertRecoveryHistory(root: string, current: CanonicalCurrentTask): void {
  for (const entry of current.runtimeState.execution_log) {
    if (!('action' in entry) || entry.action !== 'commit-replan' || !('candidate_digest' in entry) || !entry.candidate_digest) continue;
    const location = correctionCandidateLocation(current, entry.candidate_digest);
    const { candidate_digest: marker, ...candidate } = JSON.parse(fs.readFileSync(location.filePath, 'utf8')) as CorrectionCandidate & { candidate_digest: string };
    if (digest(candidate) !== marker || marker !== entry.candidate_digest || candidate.task_id !== current.runtimeState.task_id
      || candidate.document_id !== current.sourceTuple.document_id) fail('RECOVERY_HISTORY_CORRUPT', 'Confirmed recovery candidate changed or belongs to another task.');
    if ((candidate.kind as string) === 'correction-replan-candidate/v1') continue;
    if (candidate.kind !== 'correction-replan-candidate/v2') fail('RECOVERY_HISTORY_VERSION_UNSUPPORTED', 'Unknown confirmed recovery protocol version.');
    const definition = readDraftDefinitionFromBody(current.body);
    assertTaskHistoryForRevision(current.filePath, current.sourceTuple.document_id, current.runtimeState.task_id, entry.source_revision, 'confirm-replan');
    const historyFile = path.join(path.dirname(current.filePath), 'task-history', current.sourceTuple.document_id, `${entry.source_revision}.json`);
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    const old = parseCanonicalCurrentTaskContent(Buffer.from(history.current_task_base64, 'base64').toString('utf8'), current.filePath, current.relativePath);
    if (old.frontmatter.task_store !== undefined) {
      const store = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent);
      old.runtimeState = {
        ...old.runtimeState,
        execution_log: store.readExecutionLogAtSourceRevision(entry.source_revision),
      };
    }
    const oldDefinition = readDraftDefinitionFromBody(old.body);
    for (const stepId of executedStepIds(old)) {
      if (implementationStepBlock(oldDefinition, stepId) !== implementationStepBlock(definition, stepId)) fail('RECOVERY_EXECUTED_DEFINITION_CHANGED', 'An executed/preflighted historical step definition was rewritten.');
    }
    for (const reference of candidate.historical_completion_refs) {
      const completed = old.runtimeState.execution_log.find(item => !('action' in item) && item.idempotency_key === reference.execution_id && item.step_id === reference.step_id && item.status === 'completed');
      if (!completed || digest(parseImplementationSteps(oldDefinition.implementation_steps).find(item => item.id === reference.step_id)) !== reference.definition_revision) fail('RECOVERY_COMPLETION_REFERENCE_INVALID', 'Historical completion reference lacks its exact completed execution and definition.');
    }
  }
}

function makeReplanAudit(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  next: RuntimeState,
  now: string,
): ReplanAuditLogEntry {
  const delta = proposal.semantic_delta;
  let action: ReplanAuditAction;
  if (delta.kind === 'lifecycle' && delta.action === 'supersede') action = 'supersede';
  else if (delta.kind === 'task-state' && REPLAN_TASK_STATE_ACTIONS.includes(delta.action as ReplanTaskStateAction)) action = delta.action as ReplanTaskStateAction;
  else fail('RUNTIME_SCHEMA_INVALID', 'Only Slice B transitions may create a replan audit record.');
  if (delta.kind !== 'task-state' && delta.kind !== 'lifecycle') {
    fail('RUNTIME_SCHEMA_INVALID', 'Only task-state and lifecycle deltas may create a replan audit record.');
  }
  const deltaEvidenceRefs = delta.evidence_refs;

  const base = {
    action,
    idempotency_key: proposal.idempotency_key,
    operation_kind: proposal.operation_kind as Extract<RuntimeOperationKind, 'task-state-transaction' | 'lifecycle-transaction'>,
    caller: proposal.caller as Extract<RuntimeProposal['caller'], 'prepare-task' | 'task-lifecycle'>,
    mode: action === 'supersede' ? 'supersede' as const : 'replan' as const,
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    document_id: current.sourceTuple.document_id,
    from_workflow_status: current.runtimeState.workflow_status,
    from_lifecycle_state: current.runtimeState.lifecycle_state,
    to_workflow_status: next.workflow_status,
    to_lifecycle_state: next.lifecycle_state,
    source_revision: current.sourceTuple.revision,
    authority_evidence: proposal.authority_evidence.map(item => ({ ...item })),
    evidence_refs: [...deltaEvidenceRefs],
    recorded_at: now,
  } satisfies Omit<ReplanAuditLogEntry, 'partial_diff_disposition' | 'invalidation_kind' | 'invalidation_reason'>;

  if (action === 'supersede' && delta.kind === 'lifecycle' && delta.action === 'supersede') {
    return {
      ...base,
      invalidation_kind: delta.invalidation_kind,
      invalidation_reason: delta.invalidation_reason,
      partial_diff_disposition: {
        reusable: [...delta.partial_diff_disposition.reusable],
        rollback_required: [...delta.partial_diff_disposition.rollback_required],
        stop_propagation: [...delta.partial_diff_disposition.stop_propagation],
      },
    };
  }
  return base;
}

function ensureAnyAuthorityKind(proposal: RuntimeProposal, allowed: readonly AuthorityEvidence['kind'][]): void {
  if (!proposal.authority_evidence.some(item => allowed.includes(item.kind))) {
    fail('RUNTIME_AUTHORITY_MISSING', `proposal is missing one of the required authority evidence kinds: ${allowed.join(', ')}`);
  }
}

function makeDraftAudit(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  next: RuntimeState,
  now: string,
): DraftAuditLogEntry {
  if (proposal.semantic_delta.kind !== 'task-state' || !DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as DraftTaskStateAction)) {
    fail('RUNTIME_SCHEMA_INVALID', 'Only draft task-state transitions may create a draft audit record.');
  }
  const delta = proposal.semantic_delta as Extract<TaskStateDelta, { action: 'create-draft' | 'update-draft' | 'confirm-draft' }>;
  const targetIdentity = { task_id: delta.task_id, task_slug: delta.task_slug, document_id: delta.document_id };
  const base = {
    action: delta.action,
    idempotency_key: proposal.idempotency_key,
    operation_kind: 'task-state-transaction' as const,
    caller: 'prepare-task' as const,
    mode: proposal.mode as 'default' | 'confirm',
    from_task_id: current.runtimeState.task_id,
    from_task_slug: current.runtimeState.task_slug,
    from_document_id: current.sourceTuple.document_id,
    task_id: targetIdentity.task_id,
    task_slug: targetIdentity.task_slug,
    document_id: targetIdentity.document_id,
    from_workflow_status: current.runtimeState.workflow_status,
    from_lifecycle_state: current.runtimeState.lifecycle_state,
    to_workflow_status: next.workflow_status,
    to_lifecycle_state: next.lifecycle_state,
    source_revision: current.sourceTuple.revision,
    authority_evidence: proposal.authority_evidence.map(item => ({ ...item })),
    evidence_refs: [...delta.evidence_refs],
    recorded_at: now,
  } satisfies Omit<DraftAuditLogEntry, 'definition_digest' | 'draft_revision'>;
  if (delta.action === 'create-draft' || delta.action === 'update-draft') {
    const draftDelta = delta as Extract<TaskStateDelta, { action: 'create-draft' | 'update-draft' }>;
    return {
      ...base,
      definition_digest: digest(draftDelta.draft_definition),
      ...(draftDelta.claim_evidence === undefined ? {} : { claim_evidence_digest: digest(draftDelta.claim_evidence) }),
    };
  }
  const confirmDelta = delta as Extract<TaskStateDelta, { action: 'confirm-draft' }>;
  return { ...base, draft_revision: confirmDelta.draft_revision };
}

function makeClaimEvidenceMigrationAudit(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  next: RuntimeState,
  now: string,
): ClaimEvidenceMigrationAuditLogEntry {
  if (proposal.semantic_delta.kind !== 'task-state' || proposal.semantic_delta.action !== 'migrate-claim-evidence') {
    fail('RUNTIME_SCHEMA_INVALID', 'Only claim evidence migration transitions may create a claim evidence migration audit record.');
  }
  if (next.workflow_status !== 'active' || next.lifecycle_state !== 'active') {
    fail('RUNTIME_STATE_CONFLICT', 'Claim evidence migration must preserve the active + active lifecycle tuple.');
  }
  const delta = proposal.semantic_delta;
  return {
    action: 'migrate-claim-evidence',
    idempotency_key: proposal.idempotency_key,
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: 'default',
    from_task_id: current.runtimeState.task_id,
    from_task_slug: current.runtimeState.task_slug,
    from_document_id: current.sourceTuple.document_id,
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    document_id: current.sourceTuple.document_id,
    from_workflow_status: 'active',
    from_lifecycle_state: 'active',
    to_workflow_status: 'active',
    to_lifecycle_state: 'active',
    source_revision: current.sourceTuple.revision,
    authority_evidence: proposal.authority_evidence.map(item => ({ ...item })),
    evidence_refs: [...delta.evidence_refs],
    claim_evidence_digest: digest(delta.claim_evidence),
    recorded_at: now,
  };
}

export function readDraftDefinitionFromBody(body: string): DraftTaskDefinition {
  const ranges = resolveReplanSectionRanges(body);
  const values: Partial<Record<ReplanSectionKey, string | null>> = {};
  for (const key of REPLAN_REPLACEMENT_FIELDS) {
    const range = ranges[key];
    const optional = key === 'design_constraints' || key === 'post_release_validation' || key === 'propagation_governance';
    if (!range) {
      if (!optional) fail('DRAFT_DEFINITION_INVALID', `CURRENT_TASK is missing the draft definition section for ${key}.`);
      values[key] = null;
      continue;
    }
    const content = normalizeReplacementSectionContent(body.slice(range.contentStart, range.contentEnd), `CURRENT_TASK.${range.title}`);
    if (!content && optional) values[key] = null;
    else if (!content) fail('DRAFT_DEFINITION_INVALID', `CURRENT_TASK draft definition section ${key} is empty.`);
    else values[key] = content;
  }
  return validateReplanReplacementDefinition(values, 'CURRENT_TASK.draft_definition');
}

function assertNoUnresolvedDraftQuestions(body: string): void {
  const range = resolveReplanSectionRanges(body).open_questions;
  if (!range) fail('DRAFT_DEFINITION_INVALID', 'CURRENT_TASK is missing the draft confirmation open-questions section.');
  const content = body.slice(range.contentStart, range.contentEnd).replace(/\r\n?/g, '\n').trim();
  if (!content) return;
  const emptyMarkers = /^(?:none|n\/a|na|nil|empty|no\s+open\s+questions|no\s+questions|无|暂无|不适用)[.!。]?$/iu;
  const meaningfulLines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !/^<!--.*-->$/u.test(line))
    .map(line => line.replace(/^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/u, '').trim())
    .filter(line => line.length > 0);
  if (meaningfulLines.length === 0 || meaningfulLines.every(line => emptyMarkers.test(line))) return;
  fail('DRAFT_DECISION_UNRESOLVED', 'draft confirmation is blocked by unresolved user-owned questions.');
}

function assertDraftDefinitionReady(root: string, current: CanonicalCurrentTask): DraftTaskDefinition {
  assertBusinessEvidenceVersion(current);
  const activeStepId = current.runtimeState.active_step_id;
  const body = current.body;
  const definition = readDraftDefinitionFromBody(body);
  assertStrictDraftImplementationSteps(activeStepId, definition.implementation_steps);
  assertPreparedTestStrategy(root, definition, readCanonicalTaskBasis(root, current).basis);
  assertEvidencePlan(definition, current.runtimeState.claim_evidence ?? [], true);
  assertNoUnresolvedDraftQuestions(body);
  return definition;
}

function expectedDraftReplayAudit(current: CanonicalCurrentTask, proposal: RuntimeProposal): DraftAuditLogEntry {
  const entry = current.runtimeState.execution_log.find((item): item is DraftAuditLogEntry =>
    'action' in item && DRAFT_AUDIT_ACTIONS.includes(item.action as DraftAuditAction) && item.idempotency_key === proposal.idempotency_key,
  );
  if (!entry) fail('RUNTIME_REPLAY_INCOMPLETE', 'draft replay is missing its durable execution audit record.');
  return entry;
}

function assertDraftTaskReplay(root: string, current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind !== 'task-state' || !DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as DraftTaskStateAction)) return;
  const delta = proposal.semantic_delta as Extract<TaskStateDelta, { action: 'create-draft' | 'update-draft' | 'confirm-draft' }>;
  const audit = expectedDraftReplayAudit(current, proposal);
  assertExecutionAudit(root, current, audit);
  const targetIdentity = extractTaskIdentityFromCurrentTask(current.body);
  if (targetIdentity.id !== delta.task_id || targetIdentity.slug !== delta.task_slug) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'draft replay no longer has the proposal identity in the canonical task document.');
  }
  if (current.runtimeState.task_id !== delta.task_id || current.runtimeState.task_slug !== delta.task_slug || current.sourceTuple.document_id !== delta.document_id) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'draft replay no longer has the proposal identity tuple.');
  }
  if (audit.idempotency_key !== proposal.idempotency_key
    || audit.action !== delta.action
    || audit.source_revision !== proposal.source_tuple.revision
    || audit.evidence_refs.join('|') !== delta.evidence_refs.join('|')
    || audit.task_id !== delta.task_id
    || audit.task_slug !== delta.task_slug
    || audit.document_id !== delta.document_id) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'draft replay audit does not match the proposal identity or evidence.');
  }
  if (delta.action === 'create-draft' || delta.action === 'update-draft') {
    const draftDelta = delta as Extract<TaskStateDelta, { action: 'create-draft' | 'update-draft' }>;
    if (targetIdentity.title !== draftDelta.task_title) fail('RUNTIME_REPLAY_INCOMPLETE', 'draft replay no longer has the proposal task title in the canonical task document.');
    if (current.runtimeState.workflow_status !== 'draft' || current.runtimeState.lifecycle_state !== 'active') {
      fail('RUNTIME_REPLAY_INCOMPLETE', `${delta.action} replay no longer has the draft + active tuple.`);
    }
    const definitionDigest = digest(draftDelta.draft_definition);
    if (audit.definition_digest !== definitionDigest) fail('RUNTIME_REPLAY_INCOMPLETE', `${delta.action} replay definition digest does not match the proposal.`);
    if (draftDelta.claim_evidence !== undefined) {
      if (audit.claim_evidence_digest !== digest(draftDelta.claim_evidence)) {
        fail('RUNTIME_REPLAY_INCOMPLETE', `${delta.action} replay claim evidence digest does not match the proposal.`);
      }
      if (digest(current.runtimeState.claim_evidence ?? []) !== digest(draftDelta.claim_evidence)) {
        fail('RUNTIME_REPLAY_INCOMPLETE', `${delta.action} replay no longer has the proposal claim evidence in canonical CURRENT_TASK.`);
      }
    }
    const basis = readCanonicalTaskBasis(root, current);
    if (digest(basis.basis) !== digest(draftDelta.task_basis)) {
      fail('RUNTIME_REPLAY_INCOMPLETE', `${delta.action} replay no longer has the proposal task basis.`);
    }
    assertReplanDefinitionSections(current.body, draftDelta.draft_definition);
    if (current.runtimeState.active_step_id !== draftDelta.active_step_id || current.runtimeState.active_step_status !== 'ready') {
      fail('RUNTIME_REPLAY_INCOMPLETE', `${delta.action} replay no longer has the admitted draft step ready.`);
    }
  } else {
    const confirmDelta = delta as Extract<TaskStateDelta, { action: 'confirm-draft' }>;
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
      fail('RUNTIME_REPLAY_INCOMPLETE', 'confirm-draft replay no longer has the active + active tuple.');
    }
    if (confirmDelta.draft_revision !== proposal.source_tuple.revision || audit.draft_revision !== confirmDelta.draft_revision) {
      fail('RUNTIME_REPLAY_INCOMPLETE', 'confirm-draft replay no longer matches the exact draft revision.');
    }
  }
}

function expectedClaimEvidenceMigrationReplayAudit(current: CanonicalCurrentTask, proposal: RuntimeProposal): ClaimEvidenceMigrationAuditLogEntry {
  const entry = current.runtimeState.execution_log.find((item): item is ClaimEvidenceMigrationAuditLogEntry =>
    'action' in item && item.action === 'migrate-claim-evidence' && item.idempotency_key === proposal.idempotency_key,
  );
  if (!entry) fail('RUNTIME_REPLAY_INCOMPLETE', 'claim evidence migration replay is missing its durable execution audit record.');
  return entry;
}

function assertClaimEvidenceMigrationReplay(root: string, current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind !== 'task-state' || proposal.semantic_delta.action !== 'migrate-claim-evidence') return;
  const delta = proposal.semantic_delta;
  const audit = expectedClaimEvidenceMigrationReplayAudit(current, proposal);
       assertExecutionAudit(root, current, audit);
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'claim evidence migration replay no longer has the active + active tuple.');
  }
  if (current.runtimeState.claim_evidence_required !== true || current.runtimeState.claim_evidence.length === 0) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'claim evidence migration replay no longer has a strict non-empty plan.');
  }
  requireAcceptanceClaim(current.runtimeState.claim_evidence, 'claim evidence migration replay claim_evidence');
  if (digest(current.runtimeState.claim_evidence) !== digest(delta.claim_evidence)) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'claim evidence migration replay no longer has the proposal plan in canonical CURRENT_TASK.');
  }
  if (
    audit.idempotency_key !== proposal.idempotency_key
    || audit.source_revision !== proposal.source_tuple.revision
    || audit.evidence_refs.join('|') !== delta.evidence_refs.join('|')
    || audit.claim_evidence_digest !== digest(delta.claim_evidence)
    || audit.task_id !== current.runtimeState.task_id
    || audit.task_slug !== current.runtimeState.task_slug
    || audit.document_id !== current.sourceTuple.document_id
  ) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'claim evidence migration replay audit does not match the proposal identity, plan, or evidence.');
  }
}

function expectedReplanReplayAudit(current: CanonicalCurrentTask, proposal: RuntimeProposal): ReplanAuditLogEntry {
  const entry = current.runtimeState.execution_log.find((item): item is ReplanAuditLogEntry =>
    'action' in item && REPLAN_AUDIT_ACTIONS.includes(item.action as ReplanAuditAction) && item.idempotency_key === proposal.idempotency_key,
  );
  if (!entry) fail('RUNTIME_REPLAY_INCOMPLETE', 'replan replay is missing its durable execution audit record.');
  return entry;
}

function assertNoLaterReplanAudit(current: CanonicalCurrentTask, audit: ReplanAuditLogEntry, failureCode = 'RUNTIME_REPLAY_INCOMPLETE'): void {
  const index = current.runtimeState.execution_log.findIndex(item => item === audit);
  if (index < 0) fail(failureCode, 'replay audit record is not part of the current execution log.');
  if (current.runtimeState.execution_log.slice(index + 1).some(item => 'action' in item && REPLAN_AUDIT_ACTIONS.includes(item.action as ReplanAuditAction))) {
    fail(failureCode, 'a later same-task lifecycle or replan transition has changed the replay boundary.');
  }
}

function expectedStepExecutionLog(current: CanonicalCurrentTask, proposal: RuntimeProposal): StepExecutionLogEntry {
  const entry = current.runtimeState.execution_log.find((item): item is StepExecutionLogEntry =>
    !('action' in item) && item.idempotency_key === proposal.idempotency_key,
  );
  if (!entry) fail('RUNTIME_REPLAY_INCOMPLETE', 'step-progress replay is missing its durable execution log record.');
  return entry;
}

function assertStepProgressReplay(current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind !== 'task-state' || proposal.semantic_delta.action !== 'step-progress') return;
  const delta = proposal.semantic_delta;
  const entry = expectedStepExecutionLog(current, proposal);
  const sameOptionalValue = (left: unknown, right: unknown): boolean => digest(left ?? null) === digest(right ?? null);
  if (
    entry.mode !== proposal.mode
    || entry.step_id !== delta.step_id
    || entry.status !== delta.status
    || entry.evidence_refs.join('|') !== delta.evidence_refs.join('|')
    || !sameOptionalValue(entry.note, delta.note)
    || !sameOptionalValue(entry.repair_fingerprint, delta.repair_fingerprint)
    || !sameOptionalValue(entry.repair_fingerprints, delta.repair_fingerprints)
    || !sameOptionalValue(entry.repair_wave_id, delta.repair_wave_id)
    || !sameOptionalValue(entry.change_set_id, delta.change_set_id ?? delta.review_receipt?.change_set_id)
    || !sameOptionalValue(entry.review_receipt, delta.review_receipt)
    || !sameOptionalValue(entry.claim_evidence, delta.claim_evidence)
    || !sameOptionalValue(entry.execution_result, delta.execution_result)
  ) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'step-progress replay does not match the durable execution record.');
  }
  if (entry.mode === 'repair' && entry.repair_fingerprint === undefined && entry.repair_fingerprints === undefined) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'repair replay is missing its durable finding fingerprints.');
  }
  if (entry.status === 'completed' && entry.mode === 'default' && entry.advancement === undefined) {
    // Accept pre-freeze single-step records so existing canonical tasks remain
    // readable; all newly committed multi-step records carry the outcome.
    return;
  }
  if (entry.advancement === undefined || entry.checkpoint === undefined || entry.next_step_id === undefined) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'step-progress replay is missing its durable advancement outcome.');
  }
}

function assertReviewResultReplay(current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind !== 'task-state' || proposal.semantic_delta.action !== 'record-review-result') return;
  const pending = current.runtimeState.pending_review_result;
  if (!pending || pending.review_id !== proposal.semantic_delta.review_result.review_id) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'review-result replay is no longer the pending result for the current execution generation.');
  }
  const { recorded_at: _recordedAt, ...stored } = pending;
  if (digest(stored) !== digest(proposal.semantic_delta.review_result)) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'review-result replay does not match the durable pending result.');
  }
}

function assertTaskStateReplay(root: string, current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind === 'task-state' && DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as DraftTaskStateAction)) {
    assertDraftTaskReplay(root, current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'step-progress') {
    assertStepProgressReplay(current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'migrate-claim-evidence') {
    assertClaimEvidenceMigrationReplay(root, current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'record-review-result') {
    assertReviewResultReplay(current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind !== 'task-state' || !REPLAN_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as ReplanTaskStateAction)) return;
  const delta = proposal.semantic_delta as Extract<TaskStateDelta, { action: ReplanTaskStateAction }>;
  const audit = expectedReplanReplayAudit(current, proposal);
  assertExecutionAudit(root, current, audit);
  assertNoLaterReplanAudit(current, audit);
  if (delta.action === 'mark-replan-blocked') {
    if (current.runtimeState.workflow_status !== 'blocked_by_replan' || current.runtimeState.lifecycle_state !== 'active') fail('RUNTIME_REPLAY_INCOMPLETE', 'mark-replan-blocked replay no longer has the blocked_by_replan + active tuple.');
  } else if (delta.action === 'clear-replan-block') {
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') fail('RUNTIME_REPLAY_INCOMPLETE', 'clear-replan-block replay no longer has the active + active tuple.');
  } else {
    const commitDelta = delta as Extract<TaskStateDelta, { action: 'commit-replan' }>;
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has the active + active tuple.');
    assertReplacementActiveStep(commitDelta.active_step_id, commitDelta.replacement_definition.implementation_steps);
    if (current.runtimeState.active_step_id !== commitDelta.active_step_id || current.runtimeState.active_step_status !== 'ready') fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has the replacement active step ready.');
    if (current.runtimeState.resume_requires_review || current.runtimeState.resume_review_reasons.length > 0) fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has a cleared resume gate.');
    assertReplanDefinitionSections(current.body, commitDelta.replacement_definition);
    const basis = readCanonicalTaskBasis(root, current);
    if (digest(basis.basis) !== digest(commitDelta.task_basis)) {
      fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has the proposal task basis.');
    }
    if (commitDelta.claim_evidence !== undefined && digest(current.runtimeState.claim_evidence ?? []) !== digest(commitDelta.claim_evidence)) {
      fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has the proposal claim evidence in canonical CURRENT_TASK.');
    }
  }
  const expectedEvidenceRefs = delta.evidence_refs;
  if (
    audit.idempotency_key !== proposal.idempotency_key
    || audit.action !== delta.action
    || audit.source_revision !== proposal.source_tuple.revision
    || audit.evidence_refs.join('|') !== expectedEvidenceRefs.join('|')
    || audit.task_id !== current.runtimeState.task_id
    || audit.task_slug !== current.runtimeState.task_slug
    || audit.document_id !== current.sourceTuple.document_id
  ) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'replan replay audit does not match the proposal identity or evidence.');
  }
}

type StateTransition = {
  next: RuntimeState;
  findingStatus?: FindingStatus;
  replacementDefinition?: ReplanReplacementDefinition;
  draftDefinition?: DraftTaskDefinition;
  draftIdentity?: DraftTaskIdentity;
  draftDocumentId?: string;
  taskBasis?: TaskBasis;
  audit?: RuntimeAuditLogEntry;
  advancement?: StepAdvancementResult;
};

function applyTaskStateDelta(
  root: string,
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  now: string,
): StateTransition {
  if (proposal.semantic_delta.kind !== 'task-state') fail('RUNTIME_SCHEMA_INVALID', 'Expected task-state delta.');
  const delta = proposal.semantic_delta;
  if (delta.action === 'migrate-claim-evidence') {
    ensureAuthorityKinds(proposal, ['scope-admission', 'evidence-admission']);
    ensureAnyAuthorityKind(proposal, ['active-task-owner', 'user-confirmation', 'authorized-caller']);
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
      fail('CLAIM_EVIDENCE_MIGRATION_NOT_APPLICABLE', 'claim evidence migration requires a legacy active + active task.');
    }
    if (current.runtimeState.claim_evidence.length > 0) {
      fail('CLAIM_EVIDENCE_MIGRATION_NOT_APPLICABLE', 'claim evidence migration cannot replace an existing structured claim_evidence plan.');
    }
    const claimEvidence = requireClaimEvidencePlan(delta.claim_evidence, 'migrate-claim-evidence claim_evidence');
    requireAcceptanceClaim(claimEvidence, 'migrate-claim-evidence claim_evidence');
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'active',
      lifecycle_state: 'active',
      claim_evidence_required: true,
      claim_evidence: copyClaimEvidence(claimEvidence),
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const audit = makeClaimEvidenceMigrationAudit(current, proposal, nextWithoutAudit, now);
    return {
      next: { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) },
      audit,
    };
  }
  if (delta.action === 'create-draft') {
    ensureAuthorityKinds(proposal, ['scope-admission', 'evidence-admission']);
    ensureAnyAuthorityKind(proposal, ['user-confirmation', 'authorized-caller']);
    if (current.runtimeState.workflow_status !== 'closed' || current.runtimeState.lifecycle_state !== 'archived') {
      fail('DRAFT_CREATION_BLOCKED', 'create-draft requires the current task to be closed + archived.');
    }
    const expectedTaskId = allocateNextTaskId(root, current.runtimeState.task_id);
    if (delta.task_id !== expectedTaskId) {
      fail('TASK_ID_ALLOCATION_CONFLICT', `create-draft must allocate the next unused task identity ${expectedTaskId}.`);
    }
    if (delta.document_id === current.sourceTuple.document_id || collectTaskDocumentIds(root).has(delta.document_id)) {
      fail('DOCUMENT_ID_COLLISION', 'create-draft document_id must be fresh across canonical task artifacts.');
    }
    if (current.runtimeState.task_id === '000') {
      const bootstrapArchive = archivePathForTask(root, current);
      if (fs.existsSync(bootstrapArchive.filePath)) fail('TASK_ARCHIVE_CONFLICT', 'bootstrap TASK-000 must not already have a canonical archive before the first ordinary draft.');
    } else {
      const { receipt } = matchingArchiveReceipt(root, current);
      assertPreviousTaskReconciliationComplete(root, current, receipt);
    }
    assertStrictDraftImplementationSteps(delta.active_step_id, delta.draft_definition.implementation_steps);
    assertPreparedTestStrategy(root, delta.draft_definition, delta.task_basis);
    const claimEvidence = requireClaimEvidencePlan(delta.claim_evidence, 'create-draft claim_evidence');
    requireAcceptanceClaim(claimEvidence, 'create-draft claim_evidence');
    const planRevision = assertEvidencePlan(delta.draft_definition, claimEvidence, true);
    const draftIdentity: DraftTaskIdentity = {
      task_id: delta.task_id,
      task_slug: delta.task_slug,
      document_id: delta.document_id,
      task_title: delta.task_title,
    };
    const emptyDraftState: RuntimeState = {
      business_evidence_version: 1,
      task_evolution_version: 2,
      schema_version: 1,
      kind: VNEXT_RUNTIME_STATE_KIND,
      task_id: delta.task_id,
      task_slug: delta.task_slug,
      workflow_status: 'draft',
      lifecycle_state: 'active',
      resume_requires_review: false,
      resume_review_reasons: [],
      active_step_id: delta.active_step_id,
      active_step_status: 'ready',
      finding_queue_revision: 0,
      review_cycle: createReviewCycleZero(),
      findings: [],
      execution_log: [],
      applied_proposals: [],
      claim_evidence_required: true,
      claim_evidence: copyClaimEvidence(claimEvidence),
      evidence_plan_revision: planRevision,
      review_coverage: emptyReviewCoverage(planRevision),
      pending_review_result: null,
    };
    const draftStateWithProposal = {
      ...emptyDraftState,
      applied_proposals: appendAppliedProposal(emptyDraftState, proposal, current.sourceTuple.revision),
    };
    const audit = makeDraftAudit(current, proposal, draftStateWithProposal, now);
    const next = { ...draftStateWithProposal, execution_log: appendExecutionLogEntry(draftStateWithProposal, audit) };
    return {
      next,
      draftDefinition: delta.draft_definition,
      draftIdentity,
      draftDocumentId: delta.document_id,
      taskBasis: delta.task_basis,
      audit,
    };
  }
  if (delta.action === 'update-draft') {
    assertBusinessEvidenceVersion(current);
    ensureAuthorityKinds(proposal, ['scope-admission', 'evidence-admission']);
    ensureAnyAuthorityKind(proposal, ['active-task-owner', 'user-confirmation', 'authorized-caller']);
    if (current.runtimeState.workflow_status !== 'draft' || current.runtimeState.lifecycle_state !== 'active') {
      fail('DRAFT_REFINEMENT_BLOCKED', 'update-draft requires the current task to be draft + active.');
    }
    if (delta.task_id !== current.runtimeState.task_id || delta.task_slug !== current.runtimeState.task_slug || delta.document_id !== current.sourceTuple.document_id) {
      fail('DRAFT_IDENTITY_IMMUTABLE', 'update-draft must preserve TASK_ID, TASK_SLUG, and document_id.');
    }
    const currentIdentity = extractTaskIdentityFromCurrentTask(current.body);
    if (currentIdentity.title !== delta.task_title) fail('DRAFT_IDENTITY_IMMUTABLE', 'update-draft must preserve the task title identity.');
    assertStrictDraftImplementationSteps(delta.active_step_id, delta.draft_definition.implementation_steps);
    assertPreparedTestStrategy(root, delta.draft_definition, delta.task_basis);
    const claimEvidence = requireClaimEvidencePlan(delta.claim_evidence, 'update-draft claim_evidence');
    requireAcceptanceClaim(claimEvidence, 'update-draft claim_evidence');
    const planRevision = assertEvidencePlan(delta.draft_definition, claimEvidence, true);
    for (const claim of claimEvidence) {
      const previous = current.runtimeState.claim_evidence?.find(item => item.claim_id === claim.claim_id);
      if (previous && (previous.requirement !== claim.requirement || previous.source_ref !== claim.source_ref || previous.claim_kind !== claim.claim_kind)) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'Changing a draft obligation requires a new claim identity.');
      for (const slot of claim.slots) {
        const old = previous?.slots.find(item => item.slot_id === slot.slot_id);
        if (old && digest(evidenceSlotDefinition(old)) !== digest(evidenceSlotDefinition(slot))) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'Changing a draft check requires a new slot/check identity.');
        const previousCheck = current.runtimeState.claim_evidence?.flatMap(item => item.slots).find(item => item.check?.check_id === slot.check?.check_id)?.check;
        if (previousCheck && digest(previousCheck) !== digest(slot.check)) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'A check_id cannot be reassigned to a different check during draft refinement.');
      }
    }
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'draft',
      lifecycle_state: 'active',
      active_step_id: delta.active_step_id,
      active_step_status: 'ready',
      claim_evidence_required: true,
      claim_evidence: copyClaimEvidence(claimEvidence),
      evidence_plan_revision: planRevision,
      review_coverage: emptyReviewCoverage(planRevision),
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const audit = makeDraftAudit(current, proposal, nextWithoutAudit, now);
    const next = { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) };
    return {
      next,
      replacementDefinition: delta.draft_definition,
      draftIdentity: {
        task_id: current.runtimeState.task_id,
        task_slug: current.runtimeState.task_slug,
        document_id: current.sourceTuple.document_id,
        task_title: currentIdentity.title,
      },
      draftDocumentId: current.sourceTuple.document_id,
      taskBasis: delta.task_basis,
      audit,
    };
  }
  if (delta.action === 'confirm-draft') {
    ensureAnyAuthorityKind(proposal, ['user-confirmation', 'authorized-caller']);
    ensureAuthorityKinds(proposal, ['evidence-admission']);
    const confirmationAuthorities = proposal.authority_evidence.filter(item => item.kind === 'user-confirmation' || item.kind === 'authorized-caller');
    for (const auth of confirmationAuthorities) {
      if (!auth.task_id || !auth.document_id || !auth.draft_revision) {
        fail('RUNTIME_AUTHORITY_INVALID', 'confirm-draft authority evidence must bind task_id, document_id, and draft_revision.');
      }
      if (auth.task_id !== current.runtimeState.task_id) {
        fail('DRAFT_IDENTITY_CONFLICT', `confirm-draft authority task_id ${auth.task_id} does not match current task ${current.runtimeState.task_id}.`);
      }
      if (auth.document_id !== current.sourceTuple.document_id) {
        fail('DRAFT_IDENTITY_CONFLICT', `confirm-draft authority document_id ${auth.document_id} does not match current document ${current.sourceTuple.document_id}.`);
      }
      if (auth.draft_revision !== current.sourceTuple.revision) {
        fail('DRAFT_REVISION_CONFLICT', `confirm-draft authority draft_revision ${auth.draft_revision} does not match current draft revision ${current.sourceTuple.revision}.`);
      }
    }
    if (current.runtimeState.workflow_status !== 'draft' || current.runtimeState.lifecycle_state !== 'active') {
      fail('DRAFT_CONFIRMATION_BLOCKED', 'confirm-draft requires the current task to be draft + active.');
    }
    if (delta.task_id !== current.runtimeState.task_id || delta.task_slug !== current.runtimeState.task_slug || delta.document_id !== current.sourceTuple.document_id) {
      fail('DRAFT_IDENTITY_CONFLICT', 'confirm-draft identity does not match the current draft.');
    }
    if (delta.draft_revision !== current.sourceTuple.revision) {
      fail('DRAFT_REVISION_CONFLICT', 'confirm-draft must bind the exact current draft source revision.');
    }
    if (current.runtimeState.active_step_status !== 'ready') {
      fail('DRAFT_CONFIRMATION_BLOCKED', 'confirm-draft requires the admitted draft step to remain ready.');
    }
    readCanonicalTaskBasis(root, current);
    assertDraftDefinitionReady(root, current);
    if (current.runtimeState.claim_evidence_required !== true) {
      fail('CLAIM_EVIDENCE_MIGRATION_REQUIRED', 'prepare-task refinement must persist a strict claim_evidence plan before confirm-draft; legacy tasks are readable but not terminal-completion compatible.');
    }
    const claimEvidence = requireClaimEvidencePlan(
      current.runtimeState.claim_evidence,
      'confirm-draft claim_evidence',
      'CLAIM_EVIDENCE_MIGRATION_REQUIRED',
    );
    requireAcceptanceClaim(claimEvidence, 'confirm-draft claim_evidence');
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'active',
      lifecycle_state: 'active',
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const audit = makeDraftAudit(current, proposal, nextWithoutAudit, now);
    const next = { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) };
    return { next, audit };
  }
  if (delta.action === 'clear-resume-review-gate') {
    ensureAuthorityKinds(proposal, ['authorized-caller', 'active-task-owner', 'resume-review', 'evidence-admission']);
    const callerAuthorities = proposal.authority_evidence.filter(item => item.kind === 'authorized-caller');
    for (const auth of callerAuthorities) {
      if (!auth.task_id || !auth.document_id || !auth.source_revision) {
        fail('RUNTIME_AUTHORITY_INVALID', 'clear-resume-review-gate caller authority must bind task_id, document_id, and source revision.');
      }
      if (auth.task_id !== current.runtimeState.task_id || auth.document_id !== current.sourceTuple.document_id) {
        fail('RESUME_READINESS_IDENTITY_CONFLICT', 'clear-resume-review-gate caller authority does not identify the current task document.');
      }
      if (auth.source_revision !== current.sourceTuple.revision) {
        fail('RESUME_READINESS_REVISION_CONFLICT', 'clear-resume-review-gate caller authority does not bind the exact current source revision.');
      }
    }
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
      fail('TASK_STATE_NOT_ACTIVE', 'resume review can be cleared only after the task has resumed to active + active.');
    }
    if (!current.runtimeState.resume_requires_review) return { next: current.runtimeState };
    return {
      next: {
        ...current.runtimeState,
        resume_requires_review: false,
        resume_review_reasons: [],
        applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
      },
    };
  }
  if (delta.action === 'record-review-result') {
    ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
      fail('TASK_STATE_NOT_ACTIVE', 'review results may be recorded only for an active + active task.');
    }
    if (current.runtimeState.resume_requires_review) {
      fail('RESUME_REVIEW_REQUIRED', 'review-change cannot record a step review while the resume review gate is active.');
    }
    const review = delta.review_result;
    const isCorrectionReview = (current.runtimeState.evidence_challenges ?? []).some(item => item.status === 'invalidated' && item.correction_step_id === review.step_id);
    if (review.verdict === 'clean' && !isCorrectionReview && (current.runtimeState.evidence_challenges ?? []).some(item => item.status !== 'resolved' && item.correction_step_id !== review.step_id)) {
      fail('EVIDENCE_CHALLENGE_UNRESOLVED', 'A clean review cannot consume an unresolved challenge outside its admitted correction step.');
    }
    if (review.step_id !== current.runtimeState.active_step_id) fail('ACTIVE_STEP_CONFLICT', 'review result does not belong to the active step.');
    if (review.cycle_id !== current.runtimeState.review_cycle.id) fail('REVIEW_CYCLE_CONFLICT', 'review result does not belong to the current review cycle.');
    const stepExecutions = currentDefinitionExecutionLog(current).filter((item): item is StepExecutionLogEntry =>
      !('action' in item) && item.step_id === review.step_id && item.idempotency_key.startsWith('execute-step-result-') && item.review_receipt === undefined,
    );
    const execution = stepExecutions[stepExecutions.length - 1];
    if (!execution || execution.idempotency_key !== review.execution_id) {
      fail('REVIEW_EXECUTION_STALE', 'review result does not bind the latest recorded execution for the active step.');
    }
    assertReviewExecutionEligible(current, execution);
    if (current.runtimeState.review_coverage && !review.test_assessment) fail('REVIEW_ASSESSMENT_REQUIRED', 'Cumulative reviews require test necessity, oracle, boundary, reuse and applicability assessment.');
    if (current.runtimeState.review_coverage && review.test_assessment && !review.test_assessment.applicable && (parseMutationScope(current.body).persistent_tests?.length || current.runtimeState.claim_evidence?.some(claim => claim.slots.some(slot => slot.check?.method === 'execution')))) fail('REVIEW_ASSESSMENT_REQUIRED', 'Declared execution checks or persistent tests require an applicable assessment even when test files are unchanged.');
    const executionResult = cumulativeReviewExecution(current, execution).execution_result;
    if (!executionResult
      || execution.change_set_id !== review.change_set_id
      || executionResult.change_set_id !== review.change_set_id
      || executionResult.review_target.revision !== review.review_target_revision) {
      fail('REVIEW_TARGET_CONFLICT', 'review result does not bind the Runtime-recorded execution change set and review target.');
    }
    const currentTarget = captureReviewTarget(root, executionResult.review_target.entries.map(item => item.path));
    if (currentTarget.revision !== review.review_target_revision) {
      fail('REVIEW_TARGET_STALE', 'product files changed after the reviewed execution target was recorded.');
    }
    const expectedPhase: ReviewCyclePhase = execution.mode === 'repair' ? 'verification' : 'discovery';
    if (review.cycle_phase !== expectedPhase) fail('REVIEW_PHASE_INVALID', `review result must use ${expectedPhase} for the latest execution.`);
    if (review.cycle_phase === 'discovery' && review.unresolved_fingerprints.length > 0) {
      fail('REVIEW_PHASE_INVALID', 'discovery review cannot reference unresolved admitted findings.');
    }
    const openFingerprints = new Set(current.runtimeState.findings
      .filter(item => item.review_cycle_id === review.cycle_id && ['admitted', 'in-progress'].includes(item.status))
      .map(item => item.fingerprint));
    for (const fingerprint of review.unresolved_fingerprints) {
      if (!openFingerprints.has(fingerprint)) fail('FINDING_NOT_FOUND', `review result references non-open finding ${fingerprint}.`);
    }
    const nestedEvidence = [...review.findings.flatMap(item => item.evidence_refs), ...(review.test_assessment?.evidence_refs ?? [])];
    if (![...nestedEvidence, ...review.evidence_refs].every(ref => delta.evidence_refs.includes(ref))) {
      fail('RUNTIME_EVIDENCE_INVALID', 'record-review-result evidence_refs must cover the review result and every finding.');
    }
    return {
      next: {
        ...current.runtimeState,
        pending_review_result: { ...review, recorded_at: now },
        applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
      },
    };
  }
  if (delta.action === 'mark-replan-blocked') {
    ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
      fail('REPLAN_TRANSITION_INVALID', 'mark-replan-blocked requires active + active.');
    }
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'blocked_by_replan',
      lifecycle_state: 'active',
      ...(current.runtimeState.review_coverage ? { review_coverage: {
        ...current.runtimeState.review_coverage,
        target: captureReviewTarget(root, current.runtimeState.review_coverage.target.entries.map(item => item.path)),
        pending_paths: [...new Set([...current.runtimeState.review_coverage.pending_paths,
          ...current.runtimeState.review_coverage.target.entries.map(item => item.path)])],
        last_clean_revision: null,
      } } : {}),
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    return {
      next: { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) },
      audit,
    };
  }
  if (delta.action === 'clear-replan-block') {
    ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
    if (current.runtimeState.workflow_status !== 'blocked_by_replan' || current.runtimeState.lifecycle_state !== 'active') {
      fail('REPLAN_TRANSITION_INVALID', 'clear-replan-block requires blocked_by_replan + active.');
    }
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'active',
      lifecycle_state: 'active',
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    return {
      next: { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) },
      audit,
    };
  }
  if (delta.action === 'commit-replan') {
    fail('REPLAN_CONFIRMATION_REQUIRED', 'Direct commit-replan is disabled until a revision-bound candidate, complete prior-obligation disposition, and explicit confirmation are available. CURRENT_TASK was not changed.');
  }
  if (delta.action === 'record-evidence-challenge') {
    ensureAuthorityKinds(proposal, ['active-task-owner', 'evidence-admission']);
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') fail('EVIDENCE_CHALLENGE_STATE_INVALID', 'Evidence challenges require the active task.');
    const claim = current.runtimeState.claim_evidence?.find(item => item.claim_id === delta.claim_id);
    const slot = claim?.slots.find(item => item.slot_id === delta.slot_id);
    if (!slot?.report || slot.report.result_id !== delta.result_id) fail('EVIDENCE_CHALLENGE_TARGET_INVALID', 'Challenge must bind an existing claim, slot, and report result.');
    if (!delta.evidence_refs.includes(delta.evidence_ref) || !proposal.evidence_refs.includes(delta.evidence_ref)) fail('EVIDENCE_CHALLENGE_ADMISSION_REQUIRED', 'Challenge evidence must be admitted by both proposal and delta.');
    const evidencePath = path.resolve(root, delta.evidence_ref);
    if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile() || crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex') !== delta.evidence_sha256) fail('EVIDENCE_CHALLENGE_SOURCE_STALE', 'Challenge artifact is missing or changed.');
    const challengeId = `challenge-${digest({ task: current.runtimeState.task_id, claim: delta.claim_id, slot: delta.slot_id, result: delta.result_id, evidence_sha256: delta.evidence_sha256 }).slice(0, 32)}`;
    if ((current.runtimeState.evidence_challenges ?? []).some(item => item.challenge_id === challengeId)) fail('EVIDENCE_CHALLENGE_DUPLICATE', 'The same challenge is already recorded.');
    if ((current.runtimeState.evidence_challenges ?? []).filter(item => item.claim_id === delta.claim_id && item.slot_id === delta.slot_id && item.result_id === delta.result_id).length >= 3) fail('EVIDENCE_CHALLENGE_BUDGET_EXHAUSTED', 'Three distinct counterevidence submissions for this result are already retained.');
    const challenge: EvidenceChallenge = {
      challenge_id: challengeId, claim_id: delta.claim_id, slot_id: delta.slot_id,
      result_id: delta.result_id, evidence_ref: delta.evidence_ref,
      evidence_sha256: delta.evidence_sha256, reason: delta.reason,
      status: 'contested', source_revision: current.sourceTuple.revision,
      correction_step_id: null,
    };
    return { next: { ...current.runtimeState, evidence_challenges: [...(current.runtimeState.evidence_challenges ?? []), challenge], applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision) } };
  }
  if (delta.action === 'dismiss-evidence-challenge') {
    ensureAuthorityKinds(proposal, ['active-task-owner', 'evidence-admission']);
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') fail('EVIDENCE_CHALLENGE_STATE_INVALID', 'Challenge assessment requires the active task.');
    const challenge = current.runtimeState.evidence_challenges?.find(item => item.challenge_id === delta.challenge_id);
    if (!challenge || challenge.status !== 'contested' || challenge.correction_step_id !== null) fail('EVIDENCE_CHALLENGE_STATE_INVALID', 'Only an unresolved contested challenge may be dismissed.');
    if (!delta.evidence_refs.includes(delta.evidence_ref) || !proposal.evidence_refs.includes(delta.evidence_ref)) fail('EVIDENCE_CHALLENGE_ADMISSION_REQUIRED', 'Challenge assessment evidence must be admitted by both proposal and delta.');
    const evidencePath = path.resolve(root, delta.evidence_ref);
    if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile() || crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex') !== delta.evidence_sha256) fail('EVIDENCE_CHALLENGE_SOURCE_STALE', 'Challenge assessment artifact is missing or changed.');
    const resolution: NonNullable<EvidenceChallenge['resolution']> = { kind: 'not-substantiated', evidence_ref: delta.evidence_ref,
      evidence_sha256: delta.evidence_sha256, reason: delta.reason, source_revision: current.sourceTuple.revision };
    return { next: { ...current.runtimeState,
      evidence_challenges: current.runtimeState.evidence_challenges!.map(item => item.challenge_id === challenge.challenge_id
        ? { ...item, status: 'resolved' as const, resolution } : item),
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision) } };
  }
  if (delta.action === 'retry-step') {
    if ((recoveryProblemBudget(current)?.failedAttempts ?? 0) >= 3) fail('RETRY_BUDGET_EXHAUSTED', 'The same recovery problem has exhausted three retained failed attempts across plans.');
    ensureAuthorityKinds(proposal,['active-task-owner','scope-admission','evidence-admission']);
    assertTestStrategySequenceReady(current);
    if (proposal.mode !== 'default' || current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active' || current.runtimeState.resume_requires_review || delta.step_id !== current.runtimeState.active_step_id || current.runtimeState.active_step_status !== 'blocked') fail('RETRY_STATE_INVALID','Retry requires the active blocked ordinary step.');
    if (current.runtimeState.pending_review_result || current.runtimeState.findings.some(f=>['admitted','in-progress'].includes(f.status))) fail('RETRY_FINDINGS_BLOCKED','Retry cannot consume pending review or findings.');
    const ledger = current.runtimeState.step_attempts?.[delta.step_id];
    const failed = ledger?.attempts.at(-1);
    if (!ledger || ledger.evidence_plan_revision !== current.runtimeState.evidence_plan_revision || !failed || failed.attempt_id !== delta.blocked_attempt_id || failed.status !== 'blocked' || !failed.blocker) fail('RETRY_ATTEMPT_CONFLICT','Retry must bind the durable latest failure in the same plan.');
    if (ledger.attempts.length >= ledger.max_attempts) fail('RETRY_BUDGET_EXHAUSTED','Three attempts exhausted; route to debug-task or the user.');
    if (!delta.blocker_resolution_refs.every(ref=>delta.evidence_refs.includes(ref) && proposal.evidence_refs.includes(ref))) fail('RETRY_RESOLUTION_REQUIRED','Retry evidence must cover resolution artifacts.');
    validateRetryResolution(root,current,delta,failed.blocker);
    const attempt: StepAttempt = {attempt_id:`attempt-${digest({document:current.sourceTuple.document_id,plan:ledger.evidence_plan_revision,step:delta.step_id,n:ledger.attempts.length+1}).slice(0,40)}`,idempotency_key:proposal.idempotency_key,request_digest:retryRequestDigest(current,delta),status:'ready',blocker:null,...(delta.repair_diagnosis ? {recovery:delta.repair_diagnosis} : {}),evidence_refs:[...delta.blocker_resolution_refs]};
    return {next:{...current.runtimeState,active_step_status:'ready',step_attempts:{...current.runtimeState.step_attempts,[delta.step_id]:{...ledger,attempts:[...ledger.attempts,attempt]}},...(current.runtimeState.review_coverage ? {review_coverage:{...current.runtimeState.review_coverage,last_clean_revision:null}} : {}),applied_proposals:appendAppliedProposal(current.runtimeState,proposal,current.sourceTuple.revision)}};
  }
  if (delta.action === 'record-step-preflight') {
    if ((recoveryProblemBudget(current)?.failedAttempts ?? 0) >= 3) fail('RETRY_BUDGET_EXHAUSTED', 'The same recovery problem has exhausted three retained failed attempts across plans.');
    assertOrdinaryPreflight(current, root);
    assertTestStrategySequenceReady(current);
    ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
    if (proposal.mode !== 'default' || delta.step_id !== current.runtimeState.active_step_id) fail('ACTIVE_STEP_CONFLICT', 'preflight must bind the current ordinary step.');
    const step = resolveCanonicalTaskStep(current).steps.find(step => step.id === delta.step_id)!;
    const patterns = (step.mutation_scope ?? '').split(',').map(value => value.trim().replace(/^`|`$/g, ''));
    if (delta.candidate_paths.length && (evaluateMutationScope(parseMutationScope(current.body), { changed_paths: delta.candidate_paths }).status !== 'pass' || delta.candidate_paths.some(p => !patterns.some(pattern => mutationScopePatternMatchesPath(p, pattern))))) fail('PREFLIGHT_SCOPE_BLOCKED', 'preflight candidates must be admitted by the task and current step.');
    const claims = copyClaimEvidence(current.runtimeState.claim_evidence ?? []);
    for (const record of claims) for (const slot of record.slots) {
      if (slot.before_step_id !== delta.step_id || slot.prerequisite_receipt) continue;
      assertEvidenceSlotSatisfied(root, current, record, slot, false);
      slot.prerequisite_receipt = { step_id: delta.step_id, preflight_id: proposal.idempotency_key, result_id: slot.report!.result_id, subject_snapshot: captureReviewTarget(root, slot.check!.subject_paths) };
    }
    const coverage = registerReviewCoverage(root, current, delta.candidate_paths);
    const ledger = current.runtimeState.step_attempts?.[delta.step_id];
    const recovery = ledger?.attempts.at(-1)?.recovery;
    if (recovery && delta.candidate_paths.some(p=>!recovery.repair_paths.includes(p))) fail('RETRY_SCOPE_BLOCKED','Recovered preflight candidates must stay within the admitted diagnosis paths.');
    const initialLedger: StepAttemptLedger = { evidence_plan_revision: current.runtimeState.evidence_plan_revision!, max_attempts: 3,
      attempts: [{ attempt_id: nextStepAttemptId(current), idempotency_key: proposal.idempotency_key, request_digest: null,
        status: 'preflighted', blocker: null, evidence_refs: [...delta.evidence_refs] }] };
    let stepAttempts = current.runtimeState.step_attempts;
    if (!ledger) {
      stepAttempts = { ...stepAttempts, [delta.step_id]: initialLedger };
    } else if (ledger.attempts.at(-1)?.status === 'ready') {
      stepAttempts = { ...stepAttempts, [delta.step_id]: { ...ledger, attempts: ledger.attempts.map((attempt, index) =>
        index === ledger.attempts.length - 1 ? { ...attempt, status: 'preflighted' as const } : attempt) } };
    }
    return { next: { ...current.runtimeState, review_coverage: coverage, ...(stepAttempts ? {step_attempts:stepAttempts} : {}), claim_evidence: claims, applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision) } };
  }
  if (delta.action !== 'step-progress') fail('RUNTIME_SCHEMA_INVALID', 'Only step-progress reaches the execute-step state handler.');
  ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
  if (current.runtimeState.workflow_status === 'draft' && current.runtimeState.lifecycle_state === 'active') {
    fail('DRAFT_NOT_EXECUTABLE', 'execute-step is blocked for draft + active until prepare-task:confirm commits confirm-draft.');
  }
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('TASK_STATE_NOT_ACTIVE', 'execute-step requires the current task to be active + active.');
  }
  if (current.runtimeState.resume_requires_review) {
    fail('RESUME_REVIEW_REQUIRED', 'execute-step cannot proceed until prepare-task clears the resume review gate.');
  }
  if (delta.step_id !== current.runtimeState.active_step_id) fail('ACTIVE_STEP_CONFLICT', 'Proposal step_id does not match the admitted current step.');
  if (proposal.mode === 'default' && !delta.review_receipt) {
    const budget = recoveryProblemBudget(current);
    if (budget) {
      const ledger = current.runtimeState.step_attempts?.[delta.step_id], attempt = ledger?.attempts.at(-1);
      // Admission consumes the budget at preflight. Still record real outcomes
      // of admitted attempts, but raw progress cannot manufacture a new attempt.
      if (!attempt && budget.failedAttempts >= 3) fail('RETRY_BUDGET_EXHAUSTED', 'The recovery problem has exhausted its retained failed attempts.');
      if (!attempt || ledger!.evidence_plan_revision !== current.runtimeState.evidence_plan_revision
        || !['preflighted', 'implemented'].includes(attempt.status)
        || (delta.execution_result && delta.execution_result.attempt_id !== attempt.attempt_id)) fail('RETRY_PREFLIGHT_REQUIRED', 'Recovery progress requires the durable current preflighted attempt, including through raw apply.');
    }
  }
  // Failed observations remain recordable; a successful result or completion
  // cannot substitute caller-reported command status for an actual restore.
  if (delta.status === 'completed' || (delta.execution_result && delta.execution_result.outcome !== 'blocked')) assertArtifactRestoreCompleted(root, current);
  const currentClaimEvidenceEnabled = claimEvidenceStateEnabled(current.runtimeState);
  if (!currentClaimEvidenceEnabled && delta.claim_evidence !== undefined) {
    fail('CLAIM_EVIDENCE_MIGRATION_REQUIRED', 'execute-step cannot create a claim_evidence plan for a legacy task; prepare-task refinement/migration must persist the plan first.');
  }
  if (currentClaimEvidenceEnabled) {
    const plannedClaimEvidence = current.runtimeState.claim_evidence ?? [];
    if (plannedClaimEvidence.length === 0) {
      fail('CLAIM_EVIDENCE_REQUIRED', 'the strict task has an empty claim_evidence plan; prepare-task must repair it before execution.');
    }
    requireAcceptanceClaim(plannedClaimEvidence, 'current task claim_evidence');
  }
  if (proposal.mode !== 'repair' && !delta.review_receipt) assertOrdinaryPreflight(current, root);
  const executionMode = proposal.mode as VNextExecuteStepMode;
  const stepResolution = resolveCanonicalTaskStep(current);
  const checkpoint = effectiveCheckpointPolicy(stepResolution);
  assertTestStrategyExecutionTransition(current, delta);
  const currentStepRepairLogs = currentDefinitionExecutionLog(current).filter((item): item is StepExecutionLogEntry =>
    !('action' in item) && item.step_id === delta.step_id && item.mode === 'repair',
  );
  const openFindings = current.runtimeState.findings.filter(item => item.status === 'admitted' || item.status === 'in-progress');
  const deltaRepairFingerprints = delta.repair_fingerprints ?? (delta.repair_fingerprint ? [delta.repair_fingerprint] : []);
  if (executionMode === 'repair') {
    if (deltaRepairFingerprints.length === 0) fail('FINDING_ADMISSION_REQUIRED', 'repair mode requires one or more admitted finding fingerprints.');
    for (const fingerprint of deltaRepairFingerprints) {
      const finding = current.runtimeState.findings.find(item => item.fingerprint === fingerprint);
      if (!finding || !['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_ADMISSION_REQUIRED', `repair fingerprint ${fingerprint} is not an admitted current-task finding.`);
      if (delta.repair_wave_id && finding.last_repair_wave_id !== delta.repair_wave_id) {
        fail('REPAIR_WAVE_CONFLICT', `repair fingerprint ${fingerprint} was not recorded in repair wave ${delta.repair_wave_id}.`);
      }
    }
    if (!delta.change_set_id) fail('REPAIR_CHANGE_SET_REQUIRED', 'repair mode requires one Runtime-owned logical change_set_id.');
    if (delta.review_receipt !== undefined) fail('REVIEW_READ_ONLY_VIOLATION', 'repair execution cannot attach a review receipt; verification remains a separate review result.');
  } else {
    if (deltaRepairFingerprints.length > 0 || delta.repair_wave_id !== undefined) fail('RUNTIME_MODE_INVALID', 'default execution cannot carry repair bookkeeping.');
    if (delta.review_receipt !== undefined && delta.status !== 'completed') fail('REVIEW_RECEIPT_REQUIRED', 'review receipt is only valid when completing the current step.');
    if (delta.change_set_id !== undefined && delta.review_receipt !== undefined && delta.change_set_id !== delta.review_receipt.change_set_id) {
      fail('REVIEW_TARGET_CONFLICT', 'step-progress change_set_id must match the review receipt change_set_id.');
    }
  }
  const executionChangeSetId = delta.change_set_id ?? delta.review_receipt?.change_set_id;
  const oldStatus = current.runtimeState.active_step_status;
  const newStatus = delta.status;
  if (delta.review_receipt !== undefined && delta.execution_result !== undefined) {
    fail('REVIEWED_COMPLETION_EXECUTION_RESULT_FORBIDDEN', 'reviewed step completion cannot record a new execution result or acceptance evidence.');
  }
  if (delta.execution_result !== undefined) {
    if (!executionChangeSetId || delta.execution_result.change_set_id !== executionChangeSetId) {
      fail('REVIEW_TARGET_CONFLICT', 'execution_result must bind the step-progress Runtime change_set_id.');
    }
    const targetPaths = delta.execution_result.review_target.entries.map(item => item.path);
    const currentTarget = captureReviewTarget(root, targetPaths);
    if (currentTarget.revision !== delta.execution_result.review_target.revision) {
      fail('REVIEW_TARGET_STALE', 'product files changed while the execution result was being recorded.');
    }
    if ((delta.execution_result.outcome === 'blocked') !== (newStatus === 'blocked')) {
      fail('RUNTIME_STATE_CONFLICT', 'execution_result outcome must match the step-progress status.');
    }
    const structuredEvidenceRefs = [...new Set([
      ...delta.execution_result.command_results.flatMap(item => item.evidence_refs),
      ...delta.execution_result.validation_results.flatMap(item => item.evidence_refs),
      ...delta.execution_result.acceptance_evidence.flatMap(item => item.evidence_refs),
    ])];
    if (structuredEvidenceRefs.length !== delta.evidence_refs.length
      || structuredEvidenceRefs.some(item => !delta.evidence_refs.includes(item))) {
      fail('RUNTIME_STATE_CONFLICT', 'step-progress evidence_refs must exactly match the structured execution_result evidence.');
    }
  }
  const legal = oldStatus === newStatus
    || (oldStatus === 'ready' && ['in-progress', 'completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'in-progress' && ['completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'blocked' && executionMode === 'repair' && ['in-progress', 'completed'].includes(newStatus));
  if (!legal) fail('TASK_STATE_TRANSITION_INVALID', `Cannot transition active step from ${oldStatus} to ${newStatus}.`);
  const claimEvidenceRequired = currentClaimEvidenceEnabled;
  const transitionClaimEvidence = delta.claim_evidence ?? current.runtimeState.claim_evidence ?? [];
  if (currentClaimEvidenceEnabled && delta.claim_evidence !== undefined) {
    assertClaimEvidencePlanPreserved(
      current.runtimeState.claim_evidence ?? [],
      delta.claim_evidence,
      'semantic_delta.claim_evidence',
    );
    if (delta.review_receipt !== undefined
      && digest(current.runtimeState.claim_evidence ?? []) !== digest(delta.claim_evidence)) {
      fail('CLAIM_EVIDENCE_AFTER_REVIEW', 'reviewed step completion must preserve the claim evidence recorded before review.');
    }
  }
  for (const record of transitionClaimEvidence) for (const slot of record.slots) {
    const old = current.runtimeState.claim_evidence?.find(item => item.claim_id === record.claim_id)?.slots.find(item => item.slot_id === slot.slot_id);
    if (slot.report && digest(old) !== digest(slot)) assertEvidenceReportApplicable(root, current, slot);
    if (old?.report && slot.report?.result_id === old.report.result_id && (digest(old.report) !== digest(slot.report) || digest(old.evidence_refs) !== digest(slot.evidence_refs))) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'A changed report or artifact mapping requires a new result_id.');
    if (slot.before_step_id === delta.step_id && !slot.prerequisite_receipt) fail('PREREQUISITE_REQUIRED', 'record-step-preflight must consume prerequisites before any execution result or progress.');
  }
  const unresolvedChallenges = (current.runtimeState.evidence_challenges ?? []).filter(item => item.status !== 'resolved' && item.correction_step_id === delta.step_id);
  for (const challenge of unresolvedChallenges) {
    const slot = transitionClaimEvidence.find(item => item.claim_id === challenge.claim_id)?.slots.find(item => item.slot_id === challenge.slot_id);
    if (slot?.report?.result_id === challenge.result_id) fail('EVIDENCE_CHALLENGE_UNRESOLVED', 'The challenged result ID cannot be resubmitted as a correction.');
  }
  if (newStatus === 'completed' && unresolvedChallenges.length > 0) {
    if (!delta.review_receipt || unresolvedChallenges.some(item => item.status !== 'invalidated' || item.correction_step_id !== delta.step_id)) {
      fail('EVIDENCE_CHALLENGE_UNRESOLVED', 'Challenge resolution requires the admitted correction step and its fresh clean review.');
    }
    for (const challenge of unresolvedChallenges) {
      const slot = transitionClaimEvidence.find(item => item.claim_id === challenge.claim_id)?.slots.find(item => item.slot_id === challenge.slot_id);
      if (!slot?.report || !slot.check || slot.report.result_id === challenge.result_id
        || slot.report.status !== slot.check.expected_result || !COMPLETE_CLAIM_EVIDENCE_DISPOSITIONS.includes(slot.disposition)) {
        fail('EVIDENCE_CHALLENGE_UNRESOLVED', 'Correction must provide a new successful report for the exact challenged slot.');
      }
      assertEvidenceReportApplicable(root, current, slot);
    }
  }
  for (const result of [...(delta.execution_result?.command_results ?? []), ...(delta.execution_result?.validation_results ?? [])]) {
    if (result.status !== 'expected-failure') continue;
    const entry = 'command' in result ? result.command : result.validation;
    const hasCurrentReproduction = transitionClaimEvidence.some(record => record.claim_kind !== 'acceptance' && record.slots.some(slot => {
      if (slot.applicability !== 'before-step' || slot.prerequisite_receipt || slot.check?.entry !== entry || slot.check.expected_result !== 'expected-failure' || slot.report?.status !== 'expected-failure') return false;
      const steps = resolveCanonicalTaskStep(current).steps.map(step => step.id);
      if (steps.indexOf(delta.step_id) >= steps.indexOf(slot.before_step_id!)) return false;
      const previous = current.runtimeState.claim_evidence?.find(claim => claim.claim_id === record.claim_id)?.slots.find(item => item.slot_id === slot.slot_id);
      if (previous?.report?.result_id === slot.report.result_id) return false;
      return (delta.execution_result?.acceptance_evidence ?? []).some(evidence => !('acceptance' in evidence) && evidence.claim_id === record.claim_id && evidence.slot_id === slot.slot_id && evidence.check_id === slot.check!.check_id && evidence.report?.result_id === slot.report!.result_id);
    }));
    if (!hasCurrentReproduction) fail('EXECUTE_EXPECTED_FAILURE_INVALID', 'expected failure requires a new report for an unconsumed prerequisite check submitted by this execution before its constrained step.');
  }
  for (const result of delta.execution_result?.acceptance_evidence ?? []) {
    if ('acceptance' in result) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'Legacy text-based evidence is readable history only; new results require claim/slot/check IDs.');
    const slot = transitionClaimEvidence.find(claim => claim.claim_id === result.claim_id)?.slots.find(slot => slot.slot_id === result.slot_id);
    if (!slot || slot.check?.check_id !== result.check_id || slot.minimum_type !== result.minimum_type || slot.disposition !== result.disposition || digest(slot.report) !== digest(result.report) || digest(slot.evidence_refs) !== digest(result.evidence_refs)) fail('CLAIM_EVIDENCE_PLAN_CONFLICT', 'Execution reports must exactly match the persisted slot results.');
  }
  if (newStatus === 'completed' && !evaluateClaimEvidence(transitionClaimEvidence, { root, current, due_step_id: delta.step_id }).validation_complete) fail('CLAIM_EVIDENCE_INCOMPLETE', 'Every due slot must have applicable successful evidence before step completion.');
  let advancement: StepAdvancementResult = {
    outcome: 'not-applicable',
    from_step_id: delta.step_id,
    to_step_id: null,
    checkpoint,
  };
  if (executionMode === 'repair' && newStatus === 'completed') {
    advancement = {
      outcome: 'repair-awaiting-verification',
      from_step_id: delta.step_id,
      to_step_id: null,
      checkpoint,
    };
  } else if (executionMode === 'default' && newStatus === 'completed') {
    if (openFindings.length > 0) {
      fail('REVIEW_CONVERGENCE_REQUIRED', 'step advancement is blocked while an admitted or in-progress finding remains open.');
    }
    if (current.runtimeState.review_coverage && checkpoint === 'not-required' && stepResolution.next && !delta.execution_result) fail('REVIEW_EXECUTION_REQUIRED', 'An exempt intermediate step must record its actual execution before advancement.');
    if (checkpoint === 'required' && delta.review_receipt === undefined) {
      fail('REVIEW_CHECKPOINT_REQUIRED', `step ${delta.step_id} requires a clean review checkpoint before advancement.`);
    }
    if (delta.review_receipt !== undefined) {
      const pendingReview = current.runtimeState.pending_review_result;
      if (!pendingReview || pendingReview.verdict !== 'clean') {
        fail('CLEAN_REVIEW_REQUIRED', 'step completion requires the canonical pending clean review result.');
      }
      if (pendingReview.step_id !== delta.step_id
        || pendingReview.cycle_id !== delta.review_receipt.cycle_id
        || pendingReview.cycle_phase !== delta.review_receipt.cycle_phase
        || pendingReview.change_set_id !== delta.review_receipt.change_set_id
        || pendingReview.review_target_revision !== delta.review_receipt.review_target_revision
        || digest(pendingReview.evidence_refs) !== digest(delta.review_receipt.evidence_refs)) {
        fail('REVIEW_RECEIPT_CONFLICT', 'step completion review receipt must match the canonical pending clean review.');
      }
      const reviewedExecution = current.runtimeState.execution_log.map(item => 'action' in item ? item : cumulativeReviewExecution(current, item)).find((item): item is StepExecutionLogEntry =>
        !('action' in item) && item.idempotency_key === pendingReview.execution_id,
      );
      if (!reviewedExecution?.execution_result
        || reviewedExecution.change_set_id !== pendingReview.change_set_id
        || reviewedExecution.execution_result.review_target.revision !== pendingReview.review_target_revision) {
        fail('REVIEW_TARGET_CONFLICT', 'canonical clean review no longer binds its recorded execution target.');
      }
      const currentTarget = captureReviewTarget(root, reviewedExecution.execution_result.review_target.entries.map(item => item.path));
      if (currentTarget.revision !== pendingReview.review_target_revision) {
        fail('REVIEW_TARGET_STALE', 'product files changed after the clean review was recorded.');
      }
      if (delta.review_receipt.cycle_id !== current.runtimeState.review_cycle.id) {
        fail('REVIEW_CYCLE_CONFLICT', 'review receipt cycle_id does not match the current Runtime review cycle.');
      }
      if (currentStepRepairLogs.length > 0 && delta.review_receipt.cycle_phase !== 'verification') {
        fail('REVIEW_VERIFICATION_REQUIRED', 'an admitted repair must re-enter review through verification on the same logical diff.');
      }
      if (currentStepRepairLogs.length === 0 && delta.review_receipt.cycle_phase !== 'discovery') {
        fail('REVIEW_PHASE_INVALID', 'a checkpoint without an admitted repair must use discovery review.');
      }
    }
    if (currentStepRepairLogs.length > 0) {
      const repairFingerprints = [...new Set(currentStepRepairLogs.flatMap(item => {
        if (!item.change_set_id) fail('REPAIR_CHANGE_SET_REQUIRED', 'a repair execution record is missing its logical change-set identity.');
        const fingerprints = item.repair_fingerprints ?? (item.repair_fingerprint ? [item.repair_fingerprint] : []);
        if (fingerprints.length === 0) fail('REPAIR_VERIFICATION_REQUIRED', 'a repair execution record is missing its finding fingerprints.');
        return fingerprints;
      }))];
      const repairTargets = [...new Set(currentStepRepairLogs.map(item => item.change_set_id!))];
      if (repairTargets.length !== 1) fail('REPAIR_CHANGE_SET_CONFLICT', 'all repair attempts for one step must use the same logical change set.');
      const receipt = delta.review_receipt;
      if (!receipt) fail('REVIEW_VERIFICATION_REQUIRED', 'repair completion requires a clean verification receipt before advancement.');
      if (receipt.change_set_id !== repairTargets[0]) fail('REPAIR_CHANGE_SET_CONFLICT', 'verification must cover the exact logical change set repaired by the current step.');
      if (receipt.admitted_fingerprints.length !== repairFingerprints.length
        || receipt.admitted_fingerprints.some(fingerprint => !repairFingerprints.includes(fingerprint))) {
        fail('REVIEW_VERIFICATION_REQUIRED', 'verification must cover exactly the admitted repair fingerprints for the current step.');
      }
      for (const fingerprint of repairFingerprints) {
        const finding = current.runtimeState.findings.find(item => item.fingerprint === fingerprint);
        if (!finding || finding.status !== 'resolved') {
          fail('REVIEW_CONVERGENCE_REQUIRED', `repair finding ${fingerprint} must be resolved only after verification before step advancement.`);
        }
      }
      advancement.review_phase = receipt.cycle_phase;
    } else if (delta.review_receipt) {
      advancement.review_phase = delta.review_receipt.cycle_phase;
    }
    if (stepResolution.next) {
      advancement = {
        ...advancement,
        outcome: 'advanced',
        to_step_id: stepResolution.next.id,
      };
    } else if (hasRemainingCorrectionTargets(current, delta.step_id)) {
      // End-of-plan partial correction completes only this reviewed batch.
      // No task-complete fact is emitted; remaining targets still block closure.
      advancement = { ...advancement, outcome: 'not-applicable', to_step_id: null };
    } else {
      if (!claimEvidenceRequired) {
        fail('CLAIM_EVIDENCE_MIGRATION_REQUIRED', 'legacy CURRENT_TASK requires prepare-task refinement/migration before task-complete; aggregate evidence cannot provide terminal completion.');
      }
      if (delta.claim_evidence === undefined) {
        fail('CLAIM_EVIDENCE_REQUIRED', 'the final task-complete step-progress must carry the durable claim_evidence snapshot.');
      }
      const completion = evaluateClaimEvidence(transitionClaimEvidence, { root, current });
      if (!completion.validation_complete) {
        fail('CLAIM_EVIDENCE_INCOMPLETE', 'task-complete requires every planned claim evidence slot to be existing, reused, or newly-executed with evidence_refs.');
      }
      if (!completion.acceptance_satisfied) {
        fail('CLAIM_EVIDENCE_ACCEPTANCE_REQUIRED', 'task-complete requires at least one complete acceptance claim; invariant evidence cannot substitute for acceptance evidence.');
      }
      advancement = {
        ...advancement,
        outcome: 'task-complete',
        to_step_id: null,
      };
    }
  }
  let stepAttempts = current.runtimeState.step_attempts;
  if (executionMode === 'default' && delta.execution_result) {
    const result = delta.execution_result;
    const ledger = stepAttempts?.[delta.step_id];
    const activeAttempt = ledger?.attempts.at(-1);
    if (!ledger && result.attempt_id && result.attempt_id !== nextStepAttemptId(current)) fail('RETRY_ATTEMPT_CONFLICT','Initial attempt identity is Runtime-derived.');
    if (ledger && (ledger.evidence_plan_revision !== current.runtimeState.evidence_plan_revision || result.attempt_id !== activeAttempt?.attempt_id || activeAttempt.status === 'ready' || activeAttempt.status === 'blocked')) fail('RETRY_PREFLIGHT_REQUIRED','Results must bind the current preflighted attempt; old receipts cannot run or complete a retry.');
    const observations = [...result.command_results, ...result.validation_results];
    if (result.blocker_kind === 'environment' && (result.outcome !== 'blocked' || observations.some(r => r.status === 'failed') || !observations.some(r => r.status === 'blocked'))) {
      fail('RETRY_DIAGNOSIS_REQUIRED', 'Environment classification requires a blocked execution without business failures.');
    }
    if (current.runtimeState.evidence_plan_revision && result.attempt_id) {
      const paths = [...new Set([...(current.runtimeState.review_coverage?.target.entries.map(e=>e.path) ?? []),...result.review_target.entries.map(e=>e.path),...(current.runtimeState.claim_evidence ?? []).flatMap(c=>c.slots.flatMap(s=>s.check?.subject_paths ?? []))])];
      const attempt: StepAttempt = {attempt_id:result.attempt_id,idempotency_key:activeAttempt?.idempotency_key ?? proposal.idempotency_key,request_digest:activeAttempt?.request_digest ?? null,status:result.outcome==='blocked'?'blocked':'implemented',blocker:result.outcome==='blocked'?{kind:result.blocker_kind ?? 'unknown',execution_result:result,subject_snapshot:captureReviewTarget(root,paths)}:null,...(activeAttempt?.recovery ? {recovery:activeAttempt.recovery} : {}),evidence_refs:[...new Set([...(activeAttempt?.evidence_refs ?? []),...delta.evidence_refs])]};
      stepAttempts = {...stepAttempts,[delta.step_id]:{evidence_plan_revision:current.runtimeState.evidence_plan_revision,max_attempts:3,attempts:ledger ? [...ledger.attempts.slice(0,-1),attempt] : [attempt]}};
    }
  }
  if (executionMode === 'default' && newStatus === 'completed' && !delta.execution_result && stepAttempts?.[delta.step_id]?.attempts.at(-1)?.status !== undefined && stepAttempts[delta.step_id].attempts.at(-1)!.status !== 'implemented') fail('RETRY_EXECUTION_REQUIRED','A recovered attempt must run and report before completion.');
  let coverage = current.runtimeState.review_coverage;
  if (delta.execution_result && coverage) {
    const result = delta.execution_result;
    if (result.change_set_id !== coverage.change_set_id) fail('REVIEW_TARGET_CONFLICT', 'Execution must retain the cumulative change set.');
    for (const entry of result.review_base.entries) {
      if (digest(entry) !== digest(coverage.target.entries.find(e => e.path === entry.path))) fail('REVIEW_PREFLIGHT_REQUIRED', 'Execution base must match the registered before-state.');
    }
    const target = captureReviewTarget(root, coverage.base.entries.map(e => e.path));
    const changed = createReviewChangeDelta(coverage.target, target).entries.map(e => e.path);
    if (digest([...changed].sort()) !== digest([...result.actual_changed_paths].sort())) fail('REVIEW_TARGET_CONFLICT', 'Execution must account for all changes in the cumulative target.');
    coverage = {...coverage,target,pending_paths:[...new Set([...coverage.pending_paths,...changed])].sort()};
  }
  if (coverage && advancement.outcome === 'task-complete' && checkpoint === 'not-required') {
    if (!(stepResolution.current.checkpoint_boundary?.startsWith('final-exemption:') && stepResolution.current.checkpoint_boundary.slice('final-exemption:'.length).trim())) fail('REVIEW_CHECKPOINT_REQUIRED', 'Final exemption must explicitly cover the cumulative task.');
    coverage = {...coverage,pending_paths:[],last_clean_revision:coverage.target.revision};
  }
  if (delta.review_receipt && coverage) coverage = {...coverage,pending_paths:[],last_clean_revision:coverage.target.revision};
  const executionLog = appendExecutionLogEntry(current.runtimeState, {
      idempotency_key: proposal.idempotency_key,
      mode: executionMode,
      step_id: delta.step_id,
      status: newStatus,
      evidence_refs: [...delta.evidence_refs],
      ...(delta.note ? { note: delta.note } : {}),
      ...(delta.repair_fingerprint ? { repair_fingerprint: delta.repair_fingerprint } : {}),
      ...(delta.repair_fingerprints ? { repair_fingerprints: [...delta.repair_fingerprints] } : {}),
      ...(delta.repair_wave_id ? { repair_wave_id: delta.repair_wave_id } : {}),
      ...(executionChangeSetId ? { change_set_id: executionChangeSetId } : {}),
      checkpoint,
      advancement: advancement.outcome,
      next_step_id: advancement.to_step_id,
      ...(delta.review_receipt ? { review_receipt: delta.review_receipt } : {}),
      ...(delta.claim_evidence === undefined ? {} : { claim_evidence: copyClaimEvidence(delta.claim_evidence) }),
      ...(delta.execution_result === undefined ? {} : { execution_result: delta.execution_result }),
      recorded_at: now,
    });
  const next: RuntimeState = {
    ...current.runtimeState,
    active_step_id: advancement.outcome === 'advanced' ? advancement.to_step_id! : current.runtimeState.active_step_id,
    active_step_status: advancement.outcome === 'advanced' ? 'ready' : newStatus,
    ...(advancement.outcome === 'advanced'
      ? { review_cycle: reviewCycleForNextStep(current.runtimeState.review_cycle.id, advancement.to_step_id!, proposal.idempotency_key) }
      : {}),
    claim_evidence_required: claimEvidenceRequired,
    claim_evidence: copyClaimEvidence(transitionClaimEvidence),
    ...(newStatus === 'completed' && unresolvedChallenges.length > 0
      ? { evidence_challenges: (current.runtimeState.evidence_challenges ?? []).map(item => unresolvedChallenges.some(challenge => challenge.challenge_id === item.challenge_id) ? { ...item, status: 'resolved' as const } : item) }
      : {}),
    pending_review_result: null,
    ...(coverage ? {review_coverage:coverage} : {}),
    ...(stepAttempts ? {step_attempts:stepAttempts} : {}),
    execution_log: executionLog,
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
  };
  return {
    next,
    findingStatus: deltaRepairFingerprints.length > 0 ? current.runtimeState.findings.find(item => item.fingerprint === deltaRepairFingerprints[0])?.status : undefined,
    advancement,
  };
}

function applyFindingQueueDelta(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  now: string,
): StateTransition {
  if (proposal.semantic_delta.kind !== 'finding-queue') fail('RUNTIME_SCHEMA_INVALID', 'Expected finding-queue delta.');
  ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission']);
  if (current.runtimeState.workflow_status === 'draft' && current.runtimeState.lifecycle_state === 'active') {
    fail('DRAFT_NOT_EXECUTABLE', 'finding queue changes are blocked for draft + active until prepare-task:confirm commits confirm-draft.');
  }
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('TASK_STATE_NOT_ACTIVE', 'finding queue changes require the current task to be active + active.');
  }
  if (current.runtimeState.resume_requires_review) {
    fail('RESUME_REVIEW_REQUIRED', 'finding queue changes are blocked until prepare-task clears the resume review gate.');
  }
  const delta = proposal.semantic_delta;
  let findings = current.runtimeState.findings.map(item => ({ ...item, evidence_refs: [...item.evidence_refs] }));
  let findingStatus: FindingStatus | undefined;
  let reviewCycle = {
    ...current.runtimeState.review_cycle,
    counted_repair_wave_ids: [...current.runtimeState.review_cycle.counted_repair_wave_ids],
  };
  let pendingReview = current.runtimeState.pending_review_result;
  if (delta.action === 'admit') {
    const candidate = delta.finding;
    let reAdmitIndex: number | undefined;
    if (candidate.owner_task_id !== current.runtimeState.task_id) fail('FINDING_OWNER_CONFLICT', 'finding owner_task_id must match the active task.');
    if (findings.some(item => item.fingerprint === candidate.fingerprint)) {
      const reAdmitCandidate = findings.find(item => item.fingerprint === candidate.fingerprint)!;
      const equivalent = reAdmitCandidate.owner_task_id === candidate.owner_task_id
        && reAdmitCandidate.file === candidate.file
        && reAdmitCandidate.failure_condition === candidate.failure_condition
        && reAdmitCandidate.violated_invariant === candidate.violated_invariant;
      if (equivalent && ['admitted', 'in-progress'].includes(reAdmitCandidate.status)) return { next: current.runtimeState, findingStatus: reAdmitCandidate.status };
      if (!equivalent) fail('FINDING_DUPLICATE_CONFLICT', `finding fingerprint ${candidate.fingerprint} already exists with different semantics.`);
      reAdmitIndex = findings.findIndex(item => item.fingerprint === candidate.fingerprint);
    }
    if (reviewCycle.id !== candidate.review_cycle_id) {
      const hasOpenFindings = findings.some(item => item.status === 'admitted' || item.status === 'in-progress');
      if (hasOpenFindings) {
        fail('REVIEW_CYCLE_NOT_CONVERGED', 'A new review cycle may start only after all admitted and in-progress findings in the current cycle are terminal.');
      }
      if (pendingReview) {
        const priorCompletion = currentDefinitionExecutionLog(current).findLast(item =>
          !('action' in item)
          && item.advancement === 'advanced'
          && item.next_step_id === current.runtimeState.active_step_id
          && item.review_receipt?.cycle_id === reviewCycle.id,
        );
        const inheritedCycle = pendingReview.verdict === 'findings'
          && pendingReview.step_id === current.runtimeState.active_step_id
          && pendingReview.cycle_id === reviewCycle.id
          && pendingReview.cycle_phase === 'discovery'
          && priorCompletion && !('action' in priorCompletion)
          && reviewCycleForNextStep(reviewCycle.id, pendingReview.step_id, priorCompletion.idempotency_key).id === candidate.review_cycle_id;
        if (!inheritedCycle) fail('REVIEW_CYCLE_PENDING', 'A pending review cannot be moved into an unrelated review cycle.');
        pendingReview = { ...pendingReview, cycle_id: candidate.review_cycle_id };
      }
      reviewCycle = {
        id: candidate.review_cycle_id,
        cycle_phase: 'discovery',
        repair_round: 0,
        counted_repair_wave_ids: [],
        active_repair_wave_id: null,
        verification_new_finding_wave_used: false,
        verification_new_finding_wave_id: null,
      };
    }
    if (delta.cycle_phase === 'discovery') {
      if (reviewCycle.cycle_phase !== 'discovery' || reviewCycle.repair_round > 0) {
        fail('REVIEW_CYCLE_PHASE_CONFLICT', 'Discovery admission is closed after repair or verification; use the bounded verification admission wave.');
      }
    } else {
      if (reviewCycle.repair_round === 0) {
        fail('REVIEW_CYCLE_PHASE_CONFLICT', 'Verification admission requires at least one completed repair round.');
      }
      if (reviewCycle.verification_new_finding_wave_used) {
        if (reviewCycle.verification_new_finding_wave_id !== delta.finding_admission_wave_id) {
          fail('NEW_FINDING_WAVE_BUDGET_EXHAUSTED', 'This review cycle has already used its one verification new-finding admission wave.');
        }
      } else {
        reviewCycle = {
          ...reviewCycle,
          cycle_phase: 'verification',
          active_repair_wave_id: null,
          verification_new_finding_wave_used: true,
          verification_new_finding_wave_id: delta.finding_admission_wave_id,
        };
      }
    }
    const finding: FindingRecord = {
      ...candidate,
      status: 'admitted',
      repair_attempts: 0,
      last_repair_wave_id: null,
      admitted_at: now,
      updated_at: now,
      evidence_refs: [...candidate.evidence_refs],
    };
    if (reAdmitIndex === undefined) {
      findings.push(finding);
    } else {
      const historical = findings[reAdmitIndex];
      findings[reAdmitIndex] = {
        ...historical,
        review_cycle_id: finding.review_cycle_id,
        status: 'admitted',
        repair_attempts: current.runtimeState.execution_log.some(item => 'action' in item && item.action === 'commit-replan') ? historical.repair_attempts : 0,
        last_repair_wave_id: null,
        admitted_at: now,
        updated_at: now,
        evidence_refs: [...new Set([...historical.evidence_refs, ...candidate.evidence_refs])],
      };
    }
    findingStatus = finding.status;
  } else {
    const index = findings.findIndex(item => item.fingerprint === delta.fingerprint);
    if (index < 0) fail('FINDING_NOT_FOUND', `finding ${delta.fingerprint} is not present in the current queue.`);
    const finding = findings[index];
    if (delta.action === 'record-repair-attempt') {
      const recoveryBudget = recoveryProblemBudget(current);
      if (recoveryBudget && !recoveryBudget.repairWaves.has(delta.repair_wave_id) && recoveryBudget.repairWaves.size >= MAX_REPAIR_ROUNDS) fail('REPAIR_BUDGET_EXHAUSTED', 'The same recovery problem has exhausted its retained repair waves across plans.');
      if (proposal.mode !== 'repair') fail('RUNTIME_MODE_INVALID', 'record-repair-attempt requires execute-step:repair.');
      if (!['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_STATE_INVALID', `finding ${finding.fingerprint} is not repairable from ${finding.status}.`);
      if (finding.repair_attempts >= finding.max_repair_attempts) fail('REPAIR_BUDGET_EXHAUSTED', `finding ${finding.fingerprint} has exhausted its repair budget.`);
      if (delta.review_cycle_id !== reviewCycle.id) {
        fail('REVIEW_CYCLE_CONFLICT', 'record-repair-attempt must target the current review cycle; only finding admission may start a new cycle.');
      }
      if (finding.review_cycle_id !== reviewCycle.id) {
        fail('REVIEW_CYCLE_CONFLICT', `finding ${finding.fingerprint} does not belong to the current review cycle.`);
      }
      if (
        reviewCycle.counted_repair_wave_ids.includes(delta.repair_wave_id)
        && reviewCycle.active_repair_wave_id !== delta.repair_wave_id
      ) {
        fail('REPAIR_WAVE_CLOSED', `repair wave ${delta.repair_wave_id} has already ended and cannot be reused.`);
      }
      if (finding.last_repair_wave_id === delta.repair_wave_id) {
        fail('REPAIR_WAVE_FINDING_DUPLICATE', `finding ${finding.fingerprint} already has an attempt in repair wave ${delta.repair_wave_id}.`);
      }
      if (reviewCycle.active_repair_wave_id !== delta.repair_wave_id) {
        if (reviewCycle.repair_round >= MAX_REPAIR_ROUNDS) fail('REPAIR_BUDGET_EXHAUSTED', 'review-cycle repair round budget is exhausted.');
        reviewCycle = {
          ...reviewCycle,
          repair_round: reviewCycle.repair_round + 1,
          counted_repair_wave_ids: [...reviewCycle.counted_repair_wave_ids, delta.repair_wave_id],
          active_repair_wave_id: delta.repair_wave_id,
        };
      }
      if (reviewCycle.verification_new_finding_wave_id !== null) {
        reviewCycle = { ...reviewCycle, verification_new_finding_wave_id: null };
      }
      finding.repair_attempts += 1;
      finding.last_repair_wave_id = delta.repair_wave_id;
      finding.status = 'in-progress';
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    } else if (delta.action === 'resolve') {
      if (proposal.mode !== 'repair') fail('RUNTIME_MODE_INVALID', 'resolve requires execute-step:repair.');
      if (!['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_STATE_INVALID', `finding ${finding.fingerprint} is not resolvable from ${finding.status}.`);
      finding.status = 'resolved';
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    } else {
      if (proposal.mode !== 'repair') fail('RUNTIME_MODE_INVALID', `${delta.action} requires execute-step:repair.`);
      if (!['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_STATE_INVALID', `finding ${finding.fingerprint} cannot be ${delta.action} from ${finding.status}.`);
      finding.status = delta.action === 'defer' ? 'deferred' : 'rejected';
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    }
    findingStatus = finding.status;
  }
  const next: RuntimeState = {
    ...current.runtimeState,
    finding_queue_revision: current.runtimeState.finding_queue_revision + 1,
    review_cycle: reviewCycle,
    pending_review_result: pendingReview,
    findings,
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
  };
  return { next, findingStatus };
}

const SUSPENDED_PACKAGE_BEGIN = '<!-- BEGIN vNext CURRENT_TASK snapshot -->';
const SUSPENDED_PACKAGE_END = '<!-- END vNext CURRENT_TASK snapshot -->';

type ParsedSuspendedPackage = {
  filePath: string;
  relativePath: string;
  raw: string;
  revision: string;
  taskId: string;
  taskTitle: string;
  taskSlug: string;
  artifactKind: Extract<TaskArtifactKind, 'paused' | 'interrupted'>;
  lifecycleState: Extract<TaskLifecycleState, 'paused_pending_closure' | 'paused_blocked' | 'interrupted'>;
  suspensionReason: string;
  taskStartBase: string;
  lastReviewedCheckpoint: string;
  currentDiffReviewTarget: string;
  rollbackConditions: string;
  resumeRequiresReview: boolean;
  resumeReviewReasons: ResumeReviewReason[];
  rehydrationStatus: 'write_incomplete' | 'ready_for_resume' | 'rehydrated';
  ownershipState: 'recovery_only' | 'rehydrated';
  documentId: string;
  snapshotSha256: string;
  snapshot: CanonicalCurrentTask;
};

type LifecycleTransactionPlan = {
  next: RuntimeState;
  nextContent: string;
  packageFilePath?: string;
  packageRelativePath?: string;
  nextPackageContent?: string;
  originalPackageContent?: string;
  audit?: ReplanAuditLogEntry;
};

function packageText(value: unknown, location: string): string {
  const result = expectText(value, location);
  if (/[\r\n]/.test(result)) fail('RUNTIME_SCHEMA_INVALID', `${location} must be a single-line value in a suspended package.`);
  return result;
}

function extractSuspendedPackageFields(header: string, location: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const match = /^\s*-\s*([a-z][a-z0-9_]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    if (match[1] in fields) fail('RUNTIME_SCHEMA_INVALID', `${location} contains duplicate field ${match[1]}.`);
    fields[match[1]] = match[2].trim();
  }
  return fields;
}

function requiredPackageField(fields: Record<string, string>, field: string, location: string): string {
  const value = fields[field];
  if (value === undefined || value.trim().length === 0) fail('RUNTIME_SCHEMA_INVALID', `${location} is missing required field ${field}.`);
  return value.trim();
}

function packagePathForTask(root: string, taskId: string, taskSlug: string, artifactKind: Extract<TaskArtifactKind, 'paused' | 'interrupted'>): { filePath: string; relativePath: string } {
  let relativePath: string;
  try {
    relativePath = getTaskArtifactPath(taskId, taskSlug, artifactKind);
  } catch (error) {
    fail('RUNTIME_PATH_INVALID', error instanceof Error ? error.message : String(error));
  }
  const filePath = path.resolve(path.resolve(root), ...relativePath.split('/'));
  const resolvedRoot = path.resolve(root);
  const relativeCheck = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
  if (relativeCheck !== relativePath || relativeCheck.startsWith('../') || path.isAbsolute(relativeCheck)) {
    fail('RUNTIME_PATH_INVALID', `suspended package path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}

function replacePackageField(content: string, field: string, value: string): string {
  const pattern = new RegExp(`^-\\s*${field.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*:\\s*[^\\r\\n]*$`, 'gm');
  const matches = content.match(pattern) ?? [];
  if (matches.length !== 1) fail('RUNTIME_SCHEMA_INVALID', `suspended package must contain exactly one ${field} field.`);
  return content.replace(pattern, `- ${field}: ${value}`);
}

function parseSuspendedPackage(
  root: string,
  current: CanonicalCurrentTask,
  relativePath: string,
  expectedKind?: Extract<TaskArtifactKind, 'paused' | 'interrupted'>,
): ParsedSuspendedPackage {
  const normalizedPath = normalizeRepoPath(relativePath, 'suspended package path');
  const pathMatch = /^TASKS\/(paused|interrupted)\/TASK-([0-9]{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(normalizedPath);
  if (!pathMatch) fail('RUNTIME_PATH_INVALID', `suspended package path is outside the paused/interrupted contract: ${normalizedPath}`);
  const pathKind = pathMatch[1] as Extract<TaskArtifactKind, 'paused' | 'interrupted'>;
  const pathTaskId = pathMatch[2];
  const pathTaskSlug = pathMatch[3];
  if (expectedKind && pathKind !== expectedKind) fail('RUNTIME_PATH_INVALID', `suspended package path kind ${pathKind} does not match ${expectedKind}.`);
  if (pathTaskId !== current.runtimeState.task_id || pathTaskSlug !== current.runtimeState.task_slug) {
    fail('RUNTIME_IDENTITY_CONFLICT', 'suspended package path identity does not match the canonical current task.');
  }
  const canonicalExpectedPath = packagePathForTask(root, pathTaskId, pathTaskSlug, pathKind);
  if (normalizedPath !== canonicalExpectedPath.relativePath) fail('RUNTIME_PATH_INVALID', 'suspended package path is not the canonical identity-derived path.');
  const filePath = canonicalExpectedPath.filePath;
  if (!fs.existsSync(filePath)) fail('SUSPENDED_PACKAGE_MISSING', `suspended package is missing: ${normalizedPath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw.split(SUSPENDED_PACKAGE_BEGIN).length !== 2 || raw.split(SUSPENDED_PACKAGE_END).length !== 2) {
    fail('SUSPENDED_PACKAGE_INVALID', `${normalizedPath} must contain exactly one complete CURRENT_TASK snapshot.`);
  }
  const beginIndex = raw.indexOf(SUSPENDED_PACKAGE_BEGIN);
  const endIndex = raw.indexOf(SUSPENDED_PACKAGE_END);
  if (beginIndex < 0 || endIndex <= beginIndex) fail('SUSPENDED_PACKAGE_INVALID', `${normalizedPath} has an invalid snapshot marker order.`);
  const header = raw.slice(0, beginIndex);
  const fields = extractSuspendedPackageFields(header, normalizedPath);
  const taskId = requiredPackageField(fields, 'task_id', normalizedPath);
  const taskTitle = packageText(requiredPackageField(fields, 'task_title', normalizedPath), `${normalizedPath}.task_title`);
  const taskSlug = requiredPackageField(fields, 'task_slug', normalizedPath);
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail('RUNTIME_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
  }
  if (taskId !== pathTaskId || taskSlug !== pathTaskSlug) fail('RUNTIME_IDENTITY_CONFLICT', 'suspended package fields do not match its canonical path.');
  const artifactKind = expectEnum(requiredPackageField(fields, 'artifact_kind', normalizedPath), ['paused', 'interrupted'], `${normalizedPath}.artifact_kind`);
  if (artifactKind !== pathKind) fail('SUSPENDED_PACKAGE_INVALID', 'suspended package artifact_kind does not match its path.');
  const lifecycleState = expectEnum(requiredPackageField(fields, 'lifecycle_state', normalizedPath), ['paused_pending_closure', 'paused_blocked', 'interrupted'], `${normalizedPath}.lifecycle_state`);
  if ((artifactKind === 'paused' && !['paused_pending_closure', 'paused_blocked'].includes(lifecycleState)) || (artifactKind === 'interrupted' && lifecycleState !== 'interrupted')) {
    fail('SUSPENDED_PACKAGE_INVALID', 'suspended package lifecycle_state does not match artifact_kind.');
  }
  const resumeRequiresReview = parseBooleanField(requiredPackageField(fields, 'resume_requires_review', normalizedPath), `${normalizedPath}.resume_requires_review`);
  const rawResumeReviewReasons = requiredPackageField(fields, 'resume_review_reasons', normalizedPath)
    .split(',')
    .map(reason => reason.trim())
    .filter(Boolean);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReviewReasons);
  if (rawResumeReviewReasons.join('|') !== resumeReviewReasons.join('|')) {
    fail('SUSPENDED_PACKAGE_INVALID', `${normalizedPath}.resume_review_reasons must use the canonical closed-set order without duplicates.`);
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail('SUSPENDED_PACKAGE_INVALID', error instanceof Error ? error.message : String(error));
  }
  const rehydrationStatus = expectEnum(requiredPackageField(fields, 'rehydration_status', normalizedPath), ['write_incomplete', 'ready_for_resume', 'rehydrated'], `${normalizedPath}.rehydration_status`);
  const ownershipState = expectEnum(requiredPackageField(fields, 'ownership_state', normalizedPath), ['recovery_only', 'rehydrated'], `${normalizedPath}.ownership_state`);
  if (rehydrationStatus === 'write_incomplete' && ownershipState !== 'recovery_only') fail('SUSPENDED_PACKAGE_INVALID', 'write_incomplete package must remain recovery_only.');
  if (rehydrationStatus === 'ready_for_resume' && (ownershipState !== 'recovery_only' || !resumeRequiresReview)) fail('SUSPENDED_PACKAGE_INVALID', 'ready_for_resume package must be recovery_only and review-gated.');
  if (rehydrationStatus === 'rehydrated' && ownershipState !== 'rehydrated') fail('SUSPENDED_PACKAGE_INVALID', 'rehydrated package must use ownership_state=rehydrated.');
  const documentId = requiredPackageField(fields, 'document_id', normalizedPath);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', `${normalizedPath}.document_id is invalid.`);
  const snapshotSha256 = requiredPackageField(fields, 'snapshot_sha256', normalizedPath);
  if (!/^[a-f0-9]{64}$/.test(snapshotSha256)) fail('RUNTIME_SCHEMA_INVALID', `${normalizedPath}.snapshot_sha256 must be SHA-256.`);
  let snapshotStart = beginIndex + SUSPENDED_PACKAGE_BEGIN.length;
  if (raw.startsWith('\r\n', snapshotStart)) snapshotStart += 2;
  else if (raw.startsWith('\n', snapshotStart)) snapshotStart += 1;
  const snapshotRegion = raw.slice(snapshotStart, endIndex);
  const snapshotCandidates = [snapshotRegion, snapshotRegion.endsWith('\n') ? snapshotRegion.slice(0, -1) : snapshotRegion];
  const snapshotRaw = snapshotCandidates.find(candidate => sha256(candidate) === snapshotSha256);
  if (snapshotRaw === undefined) fail('SUSPENDED_PACKAGE_INVALID', `${normalizedPath} snapshot_sha256 does not match the embedded CURRENT_TASK snapshot.`);
  const snapshot = parseCanonicalCurrentTaskContent(snapshotRaw, current.filePath, current.relativePath);
  if (snapshot.frontmatter.document_id !== documentId || snapshot.frontmatter.document_id !== current.frontmatter.document_id) {
    fail('RUNTIME_SOURCE_CONFLICT', 'suspended package document_id conflicts with CURRENT_TASK or its snapshot.');
  }
  if (snapshot.runtimeState.task_id !== taskId || snapshot.runtimeState.task_slug !== taskSlug || snapshot.runtimeState.workflow_status !== 'active' || snapshot.runtimeState.lifecycle_state !== 'active') {
    fail('SUSPENDED_PACKAGE_INVALID', 'suspended package snapshot must preserve the same active task before suspension.');
  }
  const snapshotIdentity = extractTaskIdentityFromCurrentTask(snapshot.body);
  if (snapshotIdentity.title !== taskTitle) fail('RUNTIME_SOURCE_CONFLICT', 'suspended package task_title conflicts with its snapshot.');
  const taskStartBase = packageText(requiredPackageField(fields, 'task_start_base', normalizedPath), `${normalizedPath}.task_start_base`);
  const lastReviewedCheckpoint = packageText(requiredPackageField(fields, 'last_reviewed_checkpoint', normalizedPath), `${normalizedPath}.last_reviewed_checkpoint`);
  const currentDiffReviewTarget = packageText(requiredPackageField(fields, 'current_diff_review_target', normalizedPath), `${normalizedPath}.current_diff_review_target`);
  const rollbackConditions = packageText(requiredPackageField(fields, 'rollback_conditions', normalizedPath), `${normalizedPath}.rollback_conditions`);
  const suspensionReason = packageText(requiredPackageField(fields, 'suspension_reason', normalizedPath), `${normalizedPath}.suspension_reason`);
  if (lifecycleState === 'paused_blocked') {
    packageText(requiredPackageField(fields, 'blocker_status', normalizedPath), `${normalizedPath}.blocker_status`);
    packageText(requiredPackageField(fields, 'blocking_evidence', normalizedPath), `${normalizedPath}.blocking_evidence`);
    packageText(requiredPackageField(fields, 'remaining_acceptance', normalizedPath), `${normalizedPath}.remaining_acceptance`);
  }
  if (artifactKind === 'interrupted') {
    packageText(requiredPackageField(fields, 'checkpoint_evidence', normalizedPath), `${normalizedPath}.checkpoint_evidence`);
    packageText(requiredPackageField(fields, 'dirty_attribution', normalizedPath), `${normalizedPath}.dirty_attribution`);
    packageText(requiredPackageField(fields, 'environment_state', normalizedPath), `${normalizedPath}.environment_state`);
    packageText(requiredPackageField(fields, 'recovery_strategy', normalizedPath), `${normalizedPath}.recovery_strategy`);
  }
  return {
    filePath,
    relativePath: normalizedPath,
    raw,
    revision: sha256(raw),
    taskId,
    taskTitle,
    taskSlug,
    artifactKind,
    lifecycleState,
    suspensionReason,
    taskStartBase,
    lastReviewedCheckpoint,
    currentDiffReviewTarget,
    rollbackConditions,
    resumeRequiresReview,
    resumeReviewReasons,
    rehydrationStatus,
    ownershipState,
    documentId,
    snapshotSha256,
    snapshot,
  };
}

function renderSuspendedPackage(current: CanonicalCurrentTask, delta: Extract<LifecycleDelta, { action: 'pause' | 'interrupt' }>, artifactKind: Extract<TaskArtifactKind, 'paused' | 'interrupted'>): string {
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  const taskTitle = packageText(identity.title, 'CURRENT_TASK task title');
  const fields: string[] = [
    '# vNext suspended task package',
    '',
    `- task_id: ${current.runtimeState.task_id}`,
    `- task_title: ${taskTitle}`,
    `- task_slug: ${current.runtimeState.task_slug}`,
    `- artifact_kind: ${artifactKind}`,
    `- lifecycle_state: ${delta.lifecycle_state}`,
    `- suspension_reason: ${packageText(delta.suspension_reason, 'semantic_delta.suspension_reason')}`,
    `- task_start_base: ${packageText(delta.task_start_base, 'semantic_delta.task_start_base')}`,
    `- last_reviewed_checkpoint: ${packageText(delta.last_reviewed_checkpoint, 'semantic_delta.last_reviewed_checkpoint')}`,
    `- current_diff_review_target: ${packageText(delta.current_diff_review_target, 'semantic_delta.current_diff_review_target')}`,
    `- rollback_conditions: ${packageText(delta.rollback_conditions, 'semantic_delta.rollback_conditions')}`,
    '- resume_requires_review: true',
    `- resume_review_reasons: ${delta.resume_review_reasons.join(', ')}`,
    '- rehydration_status: ready_for_resume',
    '- ownership_state: recovery_only',
    `- document_id: ${String(current.frontmatter.document_id)}`,
    `- snapshot_sha256: ${sha256(current.raw)}`,
  ];
  if (delta.action === 'pause' && delta.lifecycle_state === 'paused_blocked') {
    fields.push(`- blocker_status: ${packageText(delta.blocker_status, 'semantic_delta.blocker_status')}`);
    fields.push(`- blocking_evidence: ${packageText(delta.blocking_evidence, 'semantic_delta.blocking_evidence')}`);
    fields.push(`- remaining_acceptance: ${packageText(delta.remaining_acceptance, 'semantic_delta.remaining_acceptance')}`);
    if (delta.failed_checks && delta.failed_checks.length > 0) fields.push(`- failed_checks: ${delta.failed_checks.join(', ')}`);
  }
  if (delta.action === 'interrupt') {
    fields.push(`- checkpoint_evidence: ${packageText(delta.checkpoint_evidence, 'semantic_delta.checkpoint_evidence')}`);
    fields.push(`- dirty_attribution: ${packageText(delta.dirty_attribution, 'semantic_delta.dirty_attribution')}`);
    fields.push(`- environment_state: ${packageText(delta.environment_state, 'semantic_delta.environment_state')}`);
    fields.push(`- recovery_strategy: ${packageText(delta.recovery_strategy, 'semantic_delta.recovery_strategy')}`);
  }
  const snapshot = current.raw;
  return `${fields.join('\n')}\n\n${SUSPENDED_PACKAGE_BEGIN}\n${snapshot}${snapshot.endsWith('\n') ? '' : '\n'}${SUSPENDED_PACKAGE_END}\n`;
}

function renderRehydratedPackage(packageArtifact: ParsedSuspendedPackage): string {
  let content = packageArtifact.raw;
  content = replacePackageField(content, 'rehydration_status', 'rehydrated');
  content = replacePackageField(content, 'ownership_state', 'rehydrated');
  return content;
}

function assertSuspendedSourceMatchesSnapshot(current: CanonicalCurrentTask, snapshot: CanonicalCurrentTask): void {
  const currentRuntimeState = {
    ...current.runtimeState,
    workflow_status: snapshot.runtimeState.workflow_status,
    lifecycle_state: snapshot.runtimeState.lifecycle_state,
    resume_requires_review: snapshot.runtimeState.resume_requires_review,
    resume_review_reasons: [...snapshot.runtimeState.resume_review_reasons],
    applied_proposals: [...snapshot.runtimeState.applied_proposals],
  };
  if (digest(currentRuntimeState) !== digest(snapshot.runtimeState)) {
    fail('LIFECYCLE_SOURCE_CONFLICT', 'suspended CURRENT_TASK runtime_state differs from the recovery snapshot.');
  }
  const currentFrontmatter = { ...current.frontmatter };
  const snapshotFrontmatter = { ...snapshot.frontmatter };
  delete currentFrontmatter.runtime_state;
  delete snapshotFrontmatter.runtime_state;
  if (digest(currentFrontmatter) !== digest(snapshotFrontmatter)) {
    fail('LIFECYCLE_SOURCE_CONFLICT', 'suspended CURRENT_TASK frontmatter differs from the recovery snapshot.');
  }
  const normalizedCurrentBody = renderCurrentTaskLifecycleFields(current.body, snapshot.runtimeState);
  const normalizedSnapshotBody = renderCurrentTaskLifecycleFields(snapshot.body, snapshot.runtimeState);
  if (normalizedCurrentBody !== normalizedSnapshotBody) {
    fail('LIFECYCLE_SOURCE_CONFLICT', 'suspended CURRENT_TASK body differs from the recovery snapshot.');
  }
}

function assertSuspendedGateMatchesPackage(current: CanonicalCurrentTask, packageArtifact: ParsedSuspendedPackage): void {
  if (current.runtimeState.resume_requires_review !== packageArtifact.resumeRequiresReview
    || current.runtimeState.resume_review_reasons.join('|') !== packageArtifact.resumeReviewReasons.join('|')) {
    fail('RESUME_GATE_DRIFT', 'CURRENT_TASK resume gate differs from the suspended package gate.');
  }
}

function lifecycleArtifactKind(delta: LifecycleDelta): Extract<TaskArtifactKind, 'paused' | 'interrupted'> | null {
  if (delta.action === 'pause') return 'paused';
  if (delta.action === 'interrupt') return 'interrupted';
  if (delta.action === 'resume-paused' || delta.action === 'resume-interrupted') return delta.artifact_kind;
  return null;
}

function assertLifecycleReplayArtifacts(root: string, current: CanonicalCurrentTask, proposal: LifecycleProposal): void {
  const delta = proposal.semantic_delta;
  const artifactKind = lifecycleArtifactKind(delta);
  if (artifactKind === null) {
    if (delta.action === 'supersede') {
      if (current.runtimeState.workflow_status !== 'superseded' || current.runtimeState.lifecycle_state !== 'active') {
        fail('LIFECYCLE_REPLAY_INCOMPLETE', 'supersede replay no longer has the original superseded + active CURRENT_TASK tuple.');
      }
      const audit = current.runtimeState.execution_log.find((item): item is ReplanAuditLogEntry =>
        'action' in item && item.action === 'supersede' && item.idempotency_key === proposal.idempotency_key,
      );
      if (!audit || audit.invalidation_kind !== delta.invalidation_kind || audit.invalidation_reason !== delta.invalidation_reason || audit.source_revision !== proposal.source_tuple.revision || audit.evidence_refs.join('|') !== delta.evidence_refs.join('|') || digest(audit.partial_diff_disposition) !== digest(delta.partial_diff_disposition)) {
        fail('LIFECYCLE_REPLAY_INCOMPLETE', 'supersede replay is missing its durable invalidation audit record.');
      }
      assertExecutionAudit(root, current, audit);
      assertTaskHistoryForRevision(current.filePath, current.sourceTuple.document_id, current.runtimeState.task_id, proposal.source_tuple.revision);
      assertNoLaterReplanAudit(current, audit, 'LIFECYCLE_REPLAY_INCOMPLETE');
    }
    return;
  }

  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  const packageArtifact = parseSuspendedPackage(root, current, expected.relativePath, artifactKind);

  if (delta.action === 'pause' || delta.action === 'interrupt') {
    if (packageArtifact.rehydrationStatus !== 'ready_for_resume' || packageArtifact.ownershipState !== 'recovery_only') {
      fail('LIFECYCLE_REPLAY_INCOMPLETE', 'lifecycle replay requires the original suspended package to remain ready_for_resume + recovery_only.');
    }
    if (current.runtimeState.workflow_status !== 'suspended' || current.runtimeState.lifecycle_state !== delta.lifecycle_state) {
      fail('LIFECYCLE_REPLAY_INCOMPLETE', 'lifecycle replay no longer has the original suspended CURRENT_TASK tuple.');
    }
    if (packageArtifact.lifecycleState !== delta.lifecycle_state) {
      fail('LIFECYCLE_REPLAY_INCOMPLETE', 'lifecycle replay package marker does not match the original transition.');
    }
    assertSuspendedGateMatchesPackage(current, packageArtifact);
    return;
  }

  if (packageArtifact.rehydrationStatus !== 'rehydrated' || packageArtifact.ownershipState !== 'rehydrated') {
    fail('LIFECYCLE_REPLAY_INCOMPLETE', 'resume replay requires the suspended package to remain rehydrated + rehydrated.');
  }
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('LIFECYCLE_REPLAY_INCOMPLETE', 'resume replay no longer has an active + active CURRENT_TASK tuple.');
  }
}

function assertSiblingRecoveryIsReconciled(
  root: string,
  current: CanonicalCurrentTask,
  artifactKind: Extract<TaskArtifactKind, 'paused' | 'interrupted'>,
): void {
  const siblingKind = artifactKind === 'paused' ? 'interrupted' : 'paused';
  const sibling = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, siblingKind);
  if (!fs.existsSync(sibling.filePath)) return;

  const siblingArtifact = parseSuspendedPackage(root, current, sibling.relativePath, siblingKind);
  if (siblingArtifact.rehydrationStatus === 'rehydrated' && siblingArtifact.ownershipState === 'rehydrated') return;
  fail('SUSPENDED_PACKAGE_AMBIGUOUS', 'another ready or incomplete suspended package for the same task is present; reconcile the sibling before continuing.');
}

function prepareExistingPackageForReplacement(
  root: string,
  current: CanonicalCurrentTask,
  packageRelativePath: string,
  artifactKind: Extract<TaskArtifactKind, 'paused' | 'interrupted'>,
): string | undefined {
  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  if (!fs.existsSync(expected.filePath)) return undefined;

  const existing = parseSuspendedPackage(root, current, packageRelativePath, artifactKind);
  if (existing.rehydrationStatus === 'rehydrated' && existing.ownershipState === 'rehydrated') return existing.raw;
  if (existing.rehydrationStatus === 'write_incomplete') {
    fail('SUSPENDED_PACKAGE_RECOVERY_REQUIRED', 'the existing suspended package is write_incomplete and requires explicit recovery before replacement.');
  }
  fail('SUSPENDED_PACKAGE_CONFLICT', `suspended package is already ready_for_resume: ${packageRelativePath}`);
}

function assertRequestedLifecycleTargets(root: string, current: CanonicalCurrentTask, proposal: LifecycleProposal): { packageFilePath?: string; packageRelativePath?: string } {
  if (proposal.requested_write_targets[0] !== current.relativePath) fail('RUNTIME_PATH_INVALID', 'lifecycle proposal must target the exact canonical CURRENT_TASK path first.');
  const delta = proposal.semantic_delta;
  if (delta.action === 'supersede') {
    if (proposal.requested_write_targets.length !== 1) fail('RUNTIME_PATH_INVALID', 'supersede may write only the exact canonical CURRENT_TASK path.');
    return {};
  }
  const artifactKind = delta.action === 'pause' ? 'paused' : delta.action === 'interrupt' ? 'interrupted' : delta.artifact_kind;
  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  if (delta.action === 'resume-paused' || delta.action === 'resume-interrupted') {
    if (delta.recovery_package_path !== expected.relativePath) fail('RUNTIME_PATH_INVALID', 'resume must use the exact identity-derived suspended package path.');
  }
  if (proposal.requested_write_targets.length !== 2 || proposal.requested_write_targets[1] !== expected.relativePath) {
    fail('RUNTIME_PATH_INVALID', 'lifecycle proposal must name exactly CURRENT_TASK.md and its identity-derived suspended package path.');
  }
  return { packageFilePath: expected.filePath, packageRelativePath: expected.relativePath };
}

function prepareLifecycleTransaction(root: string, current: CanonicalCurrentTask, proposal: LifecycleProposal, now: string): LifecycleTransactionPlan {
  const delta = proposal.semantic_delta;
  if (delta.action === 'supersede') {
    if (![1, 2].includes(current.runtimeState.task_evolution_version ?? 0)) fail('TASK_EVOLUTION_INITIALIZATION_REQUIRED', 'Initialize task preservation before superseding an older task.');
    ensureAuthorityKinds(proposal, ['active-task-owner', 'evidence-admission']);
    if (!['active', 'blocked_by_replan'].includes(current.runtimeState.workflow_status) || current.runtimeState.lifecycle_state !== 'active') {
      fail('LIFECYCLE_TRANSITION_INVALID', 'supersede requires active + active or blocked_by_replan + active.');
    }
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'superseded',
      lifecycle_state: 'active',
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    const next: RuntimeState = {
      ...nextWithoutAudit,
      execution_log: appendExecutionLogEntry(current.runtimeState, audit),
    };
    const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, next, { audit });
    return { next, nextContent, audit };
  }
  const target = assertRequestedLifecycleTargets(root, current, proposal);
  const packageFilePath = target.packageFilePath!;
  const packageRelativePath = target.packageRelativePath!;
  const activeTuple = current.runtimeState.workflow_status === 'active' && current.runtimeState.lifecycle_state === 'active';
  if (delta.action === 'pause' || delta.action === 'interrupt') {
    ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
    if (!activeTuple) fail('LIFECYCLE_TRANSITION_INVALID', `${delta.action} requires the current task to be active + active.`);
    assertSiblingRecoveryIsReconciled(root, current, delta.action === 'pause' ? 'paused' : 'interrupted');
    const originalPackageContent = prepareExistingPackageForReplacement(
      root,
      current,
      packageRelativePath,
      delta.action === 'pause' ? 'paused' : 'interrupted',
    );
    const next: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'suspended',
      lifecycle_state: delta.lifecycle_state,
      resume_requires_review: true,
      resume_review_reasons: [...delta.resume_review_reasons],
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, next);
    const nextPackageContent = renderSuspendedPackage(current, delta, delta.action === 'pause' ? 'paused' : 'interrupted');
    return { next, nextContent, packageFilePath, packageRelativePath, nextPackageContent, ...(originalPackageContent === undefined ? {} : { originalPackageContent }) };
  }

  ensureAuthorityKinds(proposal, ['resume-review', 'evidence-admission']);
  if (current.runtimeState.workflow_status !== 'suspended') fail('LIFECYCLE_TRANSITION_INVALID', 'resume requires a suspended CURRENT_TASK source.');
  const expectedLifecycle = delta.action === 'resume-paused' ? ['paused_pending_closure', 'paused_blocked'] : ['interrupted'];
  if (!expectedLifecycle.includes(current.runtimeState.lifecycle_state)) fail('LIFECYCLE_TRANSITION_INVALID', 'resume mode does not match the current suspended lifecycle state.');
  if (!fs.existsSync(packageFilePath)) fail('SUSPENDED_PACKAGE_MISSING', `suspended package is missing: ${packageRelativePath}`);
  const packageArtifact = parseSuspendedPackage(root, current, packageRelativePath, delta.artifact_kind);
  if (packageArtifact.rehydrationStatus !== 'ready_for_resume' || packageArtifact.ownershipState !== 'recovery_only') {
    fail('SUSPENDED_PACKAGE_NOT_READY', 'resume accepts only ready_for_resume + recovery_only packages.');
  }
  if (packageArtifact.revision !== delta.recovery_package_revision) {
    fail('RECOVERY_PACKAGE_STALE', 'the suspended package changed after the resume proposal was created.');
  }
  assertSuspendedGateMatchesPackage(current, packageArtifact);
  assertSuspendedSourceMatchesSnapshot(current, packageArtifact.snapshot);
  if (packageArtifact.lifecycleState !== current.runtimeState.lifecycle_state) fail('LIFECYCLE_SOURCE_CONFLICT', 'package lifecycle state conflicts with CURRENT_TASK.');
  if (packageArtifact.resumeReviewReasons.join('|') !== delta.resume_review_reasons.join('|')) fail('RESUME_GATE_DRIFT', 'resume review reasons drifted between proposal and suspended package.');
  assertSiblingRecoveryIsReconciled(root, current, delta.artifact_kind);
  if (packageArtifact.documentId !== String(current.frontmatter.document_id)) fail('RUNTIME_SOURCE_CONFLICT', 'resume package document_id conflicts with CURRENT_TASK.');
  const next: RuntimeState = {
    ...packageArtifact.snapshot.runtimeState,
    workflow_status: 'active',
    lifecycle_state: 'active',
    resume_requires_review: true,
    resume_review_reasons: [...packageArtifact.resumeReviewReasons],
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
  };
  const nextContent = renderCanonicalCurrentTask(packageArtifact.snapshot.frontmatter, packageArtifact.snapshot.body, next);
  const nextPackageContent = renderRehydratedPackage(packageArtifact);
  return {
    next,
    nextContent,
    packageFilePath,
    packageRelativePath,
    nextPackageContent,
    originalPackageContent: packageArtifact.raw,
  };
}

function buildResult(
  status: RuntimeResultState,
  proposal: RuntimeProposal,
  current: CanonicalCurrentTask,
  options: RuntimeApplyOptions,
  message: string,
  extras: Partial<RuntimeResult> = {},
): RuntimeResult {
  return {
    status,
    operation_kind: proposal.operation_kind,
    idempotency_key: proposal.idempotency_key,
    target_path: current.relativePath,
    dry_run: options.dryRun === true,
    committed: false,
    message,
    planned_writes: [...proposal.requested_write_targets],
    governed_mutation_count: 0,
    read_back_verified: false,
    ...extras,
    evidence_assurance: 'caller-reported',
  };
}

function resultState(
  state: RuntimeState,
  findingStatus?: FindingStatus,
  recoveryPackagePath?: string,
): NonNullable<RuntimeResult['state']> {
  return {
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
    ...(findingStatus === undefined ? {} : { finding_status: findingStatus }),
    ...(recoveryPackagePath === undefined ? {} : { recovery_package_path: recoveryPackagePath }),
  };
}

type CurrentTaskReader = (root: string) => CanonicalCurrentTask;
type TextFileReader = (filePath: string) => string;
type RuntimeWriter = (operations: Array<{ path: string; content: string }>, dryRun: boolean, summary: string) => void;

function exactPendingFileContent(root: string, relativePath: string): string | null {
  const normalized = normalizeRepoPath(relativePath, 'task-store pending write path');
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, ...normalized.split('/'));
  const check = path.relative(resolvedRoot, filePath).replace(/\\/g, '/');
  if (check !== normalized || check.startsWith('../') || path.isAbsolute(check)) {
    throw new TaskStoreError('TASK_STORE_PATH_INVALID', `pending write path escapes the project root: ${relativePath}`);
  }
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `pending write path traverses a symbolic link: ${normalized}`);
  if (!stat.isFile()) throw new TaskStoreError('TASK_STORE_PATH_INVALID', `pending write target is not a regular file: ${normalized}`);
  return fs.readFileSync(filePath, 'utf8');
}

function pendingWriteSetForOperations(root: string, operations: Array<{ path: string; content: string }>): TaskStorePendingWrite[] {
  const resolvedRoot = path.resolve(root);
  const seen = new Set<string>();
  return operations.map(operation => {
    const relativePath = path.relative(resolvedRoot, path.resolve(operation.path)).replace(/\\/g, '/');
    const normalized = normalizeRepoPath(relativePath, 'task-store pending write path');
    if (seen.has(normalized)) throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', `pending write set contains duplicate path ${normalized}.`);
    seen.add(normalized);
    return { path: normalized, before_content: exactPendingFileContent(resolvedRoot, normalized), after_content: operation.content };
  });
}

function stageTaskEvolutionStoreCommit(
  root: string,
  current: CanonicalCurrentTask,
  nextContent: string,
  nextState: RuntimeState,
  proposal: unknown,
  writeOperations: Array<{ path: string; content: string }>,
): CanonicalCurrentTask {
  const after = parseCanonicalCurrentTaskContent(nextContent, current.filePath, current.relativePath);
  after.runtimeState = nextState;
  if (after.frontmatter.task_store !== undefined) {
    Object.defineProperty(after.runtimeState, '__vnext_compact_history', { value: true, enumerable: false, configurable: true });
  }
  const store = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent);
  store.stageCommit({
    before: current as unknown as import('./task-store').TaskStoreCurrent,
    after: after as unknown as import('./task-store').TaskStoreCurrent,
    after_source_revision: after.sourceTuple.revision,
    proposal,
    result: {
      status: 'success',
      committed: true,
      operation_kind: 'task-state-transaction',
      idempotency_key: isRecord(proposal) && typeof proposal.idempotency_key === 'string' ? proposal.idempotency_key : undefined,
    },
    write_targets: writeOperations.map(operation => path.relative(path.resolve(root), path.resolve(operation.path)).replace(/\\/g, '/')),
    write_set: pendingWriteSetForOperations(root, writeOperations),
  });
  return after;
}

function completeTaskEvolutionStoreCommit(
  root: string,
  current: CanonicalCurrentTask,
  after: CanonicalCurrentTask,
  proposal: unknown,
  result: { status: string; committed: boolean; operation_kind?: string; idempotency_key?: string; message?: string; code?: string },
): TaskStoreManifest {
  const store = TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent);
  store.markCurrentPublished(after.sourceTuple.revision);
  const manifest = store.recordCommit({
    before: current as unknown as import('./task-store').TaskStoreCurrent,
    after: after as unknown as import('./task-store').TaskStoreCurrent,
    proposal,
    result,
  });
  if (!manifest || manifest.head.source_revision !== after.sourceTuple.revision) {
    throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'task-evolution store publication did not advance to the exact after-image.');
  }
  const readBack = readCanonicalCurrentTask(root);
  if (readBack.raw !== after.raw || readBack.sourceTuple.revision !== after.sourceTuple.revision) {
    throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', 'task-evolution store publication read-back differs from the exact after-image.');
  }
  return manifest;
}

function reconcilePendingWriteSet(root: string, canonicalRevision: string, pending: Record<string, unknown>): void {
  if (pending.write_set === undefined) return;
  if (!Array.isArray(pending.write_set)) throw new TaskStoreError('TASK_STORE_MANIFEST_INVALID', 'pending task-store write_set is not an array.');
  const writes = pending.write_set as TaskStorePendingWrite[];
  const sourceRevision = typeof pending.source_revision === 'string' ? pending.source_revision : null;
  const resultingRevision = typeof pending.resulting_source_revision === 'string' ? pending.resulting_source_revision : null;
  if (!sourceRevision || !resultingRevision || (canonicalRevision !== sourceRevision && canonicalRevision !== resultingRevision)) {
    throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', 'pending task-store write set is not bound to the current canonical revision.');
  }
  const restoreBefore = canonicalRevision === sourceRevision;
  for (const write of writes) {
    const actual = exactPendingFileContent(root, write.path);
    const expected = restoreBefore ? write.before_content : write.after_content;
    const alternate = restoreBefore ? write.after_content : write.before_content;
    if (actual === expected) continue;
    if (actual !== alternate) {
      throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', `pending write target ${write.path} contains neither its exact before nor after bytes.`);
    }
    const target = path.resolve(root, ...normalizeRepoPath(write.path, 'task-store pending write path').split('/'));
    if (restoreBefore && expected === null) {
      fs.rmSync(target, { force: true });
    } else if (!restoreBefore && expected !== null) {
      executeWrites([{ path: target, content: expected }], false, 'vNext Runtime task-store pending write recovery');
    } else {
      throw new TaskStoreError('TASK_STORE_EVENT_CONFLICT', `pending write target ${write.path} has an unsupported recovery transition.`);
    }
  }
}

type RollbackVerification = {
  verified: boolean;
  detail: string;
};

function clearPendingTaskStoreAfterRollback(root: string, current: CanonicalCurrentTask): void {
  try {
    TaskStore.forCurrent(root, current as unknown as import('./task-store').TaskStoreCurrent).clearPendingForNoCommit();
  } catch {
    // The canonical rollback remains the source of the diagnostic below. If
    // the pending marker cannot be cleared, read-back will fail closed and
    // require explicit recovery rather than guessing at a half-commit.
  }
}

function fileRevisionForPath(filePath: string): string {
  if (!fs.existsSync(filePath)) fail('RUNTIME_SOURCE_MISSING', `Required file is missing: ${filePath}`);
  return sha256(fs.readFileSync(filePath, 'utf8'));
}

function rollbackCurrentTaskAndVerify(
  root: string,
  current: CanonicalCurrentTask,
  readCurrentTask: CurrentTaskReader,
): RollbackVerification {
  try {
    executeWrites([{ path: current.filePath, content: current.raw }], false, 'vNext Runtime rollback after read-back failure');
    clearPendingTaskStoreAfterRollback(root, current);
  } catch (error) {
    return {
      verified: false,
      detail: `rollback failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    const rollbackReadBack = readCurrentTask(root);
    if (
      rollbackReadBack.raw !== current.raw
      || rollbackReadBack.sourceTuple.revision !== current.sourceTuple.revision
    ) {
      return {
        verified: false,
        detail: 'rollback read-back did not restore the original canonical document.',
      };
    }
    return { verified: true, detail: 'rollback read-back verified.' };
  } catch (error) {
    return {
      verified: false,
      detail: `rollback read-back failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function rollbackDraftTransactionAndVerify(
  root: string,
  current: CanonicalCurrentTask,
  artifact: TaskBasisArtifact,
  originalTaskBasisContent: string | undefined,
  readCurrentTask: CurrentTaskReader,
): RollbackVerification {
  try {
    const writes = [{ path: current.filePath, content: current.raw }];
    if (originalTaskBasisContent !== undefined) {
      writes.push({ path: artifact.filePath, content: originalTaskBasisContent });
    }
    executeWrites(writes, false, 'vNext Runtime draft rollback after read-back failure');
    if (originalTaskBasisContent === undefined && fs.existsSync(artifact.filePath)) {
      fs.rmSync(artifact.filePath, { force: true });
    }
    clearPendingTaskStoreAfterRollback(root, current);
  } catch (error) {
    return { verified: false, detail: `rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    const rollbackReadBack = readCurrentTask(root);
    if (rollbackReadBack.raw !== current.raw || rollbackReadBack.sourceTuple.revision !== current.sourceTuple.revision) {
      return { verified: false, detail: 'rollback read-back did not restore the original canonical CURRENT_TASK document.' };
    }
    if (originalTaskBasisContent === undefined) {
      if (fs.existsSync(artifact.filePath)) return { verified: false, detail: 'rollback left a newly-created task basis behind.' };
    } else if (!fs.existsSync(artifact.filePath) || fs.readFileSync(artifact.filePath, 'utf8') !== originalTaskBasisContent) {
      return { verified: false, detail: 'rollback read-back did not restore the original task basis.' };
    }
    return { verified: true, detail: 'rollback read-back verified for CURRENT_TASK and task basis.' };
  } catch (error) {
    return { verified: false, detail: `rollback read-back failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function rollbackLifecycleTransactionAndVerify(
  root: string,
  current: CanonicalCurrentTask,
  plan: LifecycleTransactionPlan,
  readCurrentTask: CurrentTaskReader,
): RollbackVerification {
  if (!plan.packageFilePath) {
    return rollbackCurrentTaskAndVerify(root, current, readCurrentTask);
  }
  try {
    const rollbackOperations = [{ path: current.filePath, content: current.raw }];
    if (plan.originalPackageContent !== undefined) {
      rollbackOperations.push({ path: plan.packageFilePath, content: plan.originalPackageContent });
    }
    executeWrites(rollbackOperations, false, 'vNext Runtime lifecycle rollback after read-back failure');
    if (plan.originalPackageContent === undefined && fs.existsSync(plan.packageFilePath)) {
      fs.rmSync(plan.packageFilePath, { force: true });
    }
    clearPendingTaskStoreAfterRollback(root, current);
  } catch (error) {
    return {
      verified: false,
      detail: `rollback failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    const rollbackReadBack = readCurrentTask(root);
    if (rollbackReadBack.raw !== current.raw || rollbackReadBack.sourceTuple.revision !== current.sourceTuple.revision) {
      return { verified: false, detail: 'rollback read-back did not restore the original canonical CURRENT_TASK document.' };
    }
    const packageExists = fs.existsSync(plan.packageFilePath);
    if (plan.originalPackageContent === undefined) {
      if (packageExists) return { verified: false, detail: 'rollback read-back left a newly-created suspended package behind.' };
    } else if (!packageExists || fs.readFileSync(plan.packageFilePath, 'utf8') !== plan.originalPackageContent) {
      return { verified: false, detail: 'rollback read-back did not restore the original suspended package.' };
    }
    return { verified: true, detail: 'rollback read-back verified.' };
  } catch (error) {
    return { verified: false, detail: `rollback read-back failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function rollbackArchiveTransactionAndVerify(
  root: string,
  current: CanonicalCurrentTask,
  plan: ArchiveTransactionPlan,
  readCurrentTask: CurrentTaskReader,
): RollbackVerification {
  try {
    executeWrites([{ path: current.filePath, content: current.raw }], false, 'vNext Runtime archive rollback CURRENT_TASK');
    if (plan.originalArchiveContent === undefined) {
      if (fs.existsSync(plan.archiveFilePath)) fs.rmSync(plan.archiveFilePath, { force: true });
    } else {
      executeWrites([{ path: plan.archiveFilePath, content: plan.originalArchiveContent }], false, 'vNext Runtime archive rollback archive');
    }
    clearPendingTaskStoreAfterRollback(root, current);
  } catch (error) {
    return { verified: false, detail: `rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const rollbackReadBack = readCurrentTask(root);
    if (rollbackReadBack.raw !== current.raw || rollbackReadBack.sourceTuple.revision !== current.sourceTuple.revision) {
      return { verified: false, detail: 'archive rollback read-back did not restore the original CURRENT_TASK document.' };
    }
    if (plan.originalArchiveContent === undefined) {
      if (fs.existsSync(plan.archiveFilePath)) return { verified: false, detail: 'archive rollback left a newly-created archive behind.' };
    } else if (!fs.existsSync(plan.archiveFilePath) || fs.readFileSync(plan.archiveFilePath, 'utf8') !== plan.originalArchiveContent) {
      return { verified: false, detail: 'archive rollback did not restore the original archive.' };
    }
    return { verified: true, detail: 'archive rollback read-back verified for CURRENT_TASK and archive.' };
  } catch (error) {
    return { verified: false, detail: `rollback read-back failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function rollbackSingleFileAndVerify(filePath: string, originalContent: string, label: string): RollbackVerification {
  try {
    executeWrites([{ path: filePath, content: originalContent }], false, `vNext Runtime ${label} rollback`);
    if (fs.readFileSync(filePath, 'utf8') !== originalContent) return { verified: false, detail: `${label} rollback read-back did not restore the original document.` };
    return { verified: true, detail: `${label} rollback read-back verified.` };
  } catch (error) {
    return { verified: false, detail: `${label} rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function rollbackCreatedInboxRecordAndVerify(filePath: string): RollbackVerification {
  try {
    if (fs.existsSync(filePath)) {
      if (!fs.lstatSync(filePath).isFile()) {
        return { verified: false, detail: 'inbox rollback refused to remove a non-file target.' };
      }
      fs.rmSync(filePath, { force: true });
    }
    if (fs.existsSync(filePath)) return { verified: false, detail: 'inbox rollback left the newly-created record behind.' };
    return { verified: true, detail: 'inbox rollback read-back verified.' };
  } catch (error) {
    return { verified: false, detail: `inbox rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export class GovernanceTransactionKernel {
  readonly root: string;
  private readonly readCurrentTask: CurrentTaskReader;
  private readonly readFile: TextFileReader;
  private readonly writeFiles: RuntimeWriter;
  private lastApplyCurrent: CanonicalCurrentTask | undefined;
  private lastApplyAfter: CanonicalCurrentTask | undefined;
  private lastApplyProposal: RuntimeProposal | undefined;

  constructor(
    root: string,
    readCurrentTask: CurrentTaskReader = readCanonicalCurrentTask,
    readFile: TextFileReader = filePath => fs.readFileSync(filePath, 'utf8'),
    writeFiles: RuntimeWriter = (operations, dryRun, summary) => executeWrites(operations, dryRun, summary),
  ) {
    this.root = path.resolve(root);
    this.readCurrentTask = readCurrentTask;
    this.readFile = readFile;
    this.writeFiles = writeFiles;
  }

  /**
   * Stage the exact CURRENT_TASK after-image before publishing it.  The
   * parsed after-image deliberately keeps the full in-memory history so the
   * task-store event can record the new facts, while the rendered compact
   * bytes contain only the governed current projection.
   */
  private stageCurrentTaskCommit(
    current: CanonicalCurrentTask,
    nextContent: string,
    nextState: RuntimeState,
    proposal: RuntimeProposal,
    writeTargets: string[],
    writeOperations: Array<{ path: string; content: string }> = [{ path: current.filePath, content: nextContent }],
  ): CanonicalCurrentTask {
    const after = parseCanonicalCurrentTaskContent(nextContent, current.filePath, current.relativePath);
    after.runtimeState = nextState;
    if (after.frontmatter.task_store !== undefined) {
      Object.defineProperty(after.runtimeState, '__vnext_compact_history', { value: true, enumerable: false, configurable: true });
    }
    // A draft transaction allocates a new document identity.  Its new store
    // is initialized by the outer commit after the new CURRENT_TASK is
    // published; the previous task's store must not receive a cross-task
    // pending record.
    if (after.sourceTuple.document_id === current.sourceTuple.document_id) {
      TaskStore.forCurrent(this.root, current as unknown as import('./task-store').TaskStoreCurrent).stageCommit({
        before: current as unknown as import('./task-store').TaskStoreCurrent,
        after: after as unknown as import('./task-store').TaskStoreCurrent,
        after_source_revision: after.sourceTuple.revision,
        proposal,
        result: {
          status: 'success',
          committed: true,
          operation_kind: proposal.operation_kind,
          idempotency_key: proposal.idempotency_key,
        },
        write_targets: writeTargets,
        write_set: pendingWriteSetForOperations(this.root, writeOperations),
      });
    }
    this.lastApplyAfter = after;
    return after;
  }

  private commitInboxRecordTransaction(
    current: CanonicalCurrentTask,
    proposal: InboxRecordProposal,
    plan: InboxRecordTransactionPlan,
    options: RuntimeApplyOptions,
  ): RuntimeResult {
    const targetPath = plan.relativePath;
    const recordRevision = sha256(plan.nextContent);
    if (plan.existing) {
      return buildResult('no-op', proposal, current, options, 'matching canonical inbox record already exists; exact replay is a deterministic no-op.', {
        target_path: targetPath,
        planned_writes: [],
        previous_revision: recordRevision,
        resulting_revision: recordRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    }
    if (options.dryRun) {
      return buildResult('success', proposal, current, options, 'typed inbox record proposal validated; one canonical inbox write planned (dry-run).', {
        target_path: targetPath,
        planned_writes: [targetPath],
        resulting_revision: recordRevision,
        state: resultState(current.runtimeState),
      });
    }
    try {
      this.writeFiles([{ path: plan.filePath, content: plan.nextContent }], false, 'vNext Runtime inbox record transaction committed');
    } catch (error) {
      const rollback = rollbackCreatedInboxRecordAndVerify(plan.filePath);
      return buildResult('blocked', proposal, current, options, `inbox atomic commit failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? 'ATOMIC_COMMIT_FAILED' : 'ROLLBACK_FAILED',
      });
    }
    try {
      const readBack = this.readFile(plan.filePath);
      if (readBack !== plan.nextContent) throw new Error('canonical inbox record read-back did not match the staged record.');
      assertCanonicalInboxRecordContent(readBack, proposal, targetPath);
      return buildResult('success', proposal, current, options, 'inbox record transaction committed; canonical record read-back verified.', {
        target_path: targetPath,
        planned_writes: [targetPath],
        committed: true,
        governed_mutation_count: 1,
        resulting_revision: recordRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    } catch (error) {
      const rollback = rollbackCreatedInboxRecordAndVerify(plan.filePath);
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `inbox record read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.`
        : `inbox record read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED',
      });
    }
  }

  private commitArchiveTransaction(
    current: CanonicalCurrentTask,
    proposal: ArchiveProposal,
    plan: ArchiveTransactionPlan | null,
    options: RuntimeApplyOptions,
  ): RuntimeResult {
    if (plan === null) {
      return buildResult('no-op', proposal, current, options, 'matching closed + archived archive receipt already exists; archive was not repeated.', {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true,
        archive_path: archivePathForTask(this.root, current).relativePath,
        archive_revision: archiveAudits(current)[0]?.archive_revision,
        state: resultState(current.runtimeState),
      } as Partial<RuntimeResult>);
    }
    const nextRevision = sha256(plan.nextContent);
    if (options.dryRun) {
      return buildResult('success', proposal, current, options, 'typed archive proposal validated; atomic CURRENT_TASK + canonical archive write planned (dry-run).', {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        archive_path: plan.archiveRelativePath,
        archive_revision: plan.archiveRevision,
        state: resultState(plan.next),
      } as Partial<RuntimeResult>);
    }

    let stagedAfter: CanonicalCurrentTask;
    try {
      stagedAfter = this.stageCurrentTaskCommit(current, plan.nextContent, plan.next, proposal, proposal.requested_write_targets, [
        { path: current.filePath, content: plan.nextContent },
        { path: plan.archiveFilePath, content: plan.nextArchiveContent },
      ]);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, `task-store precommit staging failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
      });
    }
    try {
      executeWrites(
        [
          { path: current.filePath, content: plan.nextContent },
          { path: plan.archiveFilePath, content: plan.nextArchiveContent },
        ],
        false,
        'vNext Runtime archive transaction committed',
      );
    } catch (error) {
      const rollback = rollbackArchiveTransactionAndVerify(this.root, current, plan, this.readCurrentTask);
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `archive atomic write failed: ${error instanceof Error ? error.message : String(error)}; exact two-file rollback verified.`
        : `archive atomic write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        code: rollback.verified ? 'ATOMIC_COMMIT_FAILED' : 'ROLLBACK_FAILED',
      });
    }

    try {
      if (stagedAfter.sourceTuple.document_id === current.sourceTuple.document_id) {
        TaskStore.forCurrent(this.root, current as unknown as import('./task-store').TaskStoreCurrent).markCurrentPublished(nextRevision);
      }
      const readBack = stagedAfter.frontmatter.task_store === undefined ? this.readCurrentTask(this.root) : stagedAfter;
      if (readBack.raw !== plan.nextContent || readBack.sourceTuple.revision !== nextRevision) {
        throw new Error('canonical CURRENT_TASK read-back did not match the staged terminal document.');
      }
      if (!fs.existsSync(plan.archiveFilePath) || fs.readFileSync(plan.archiveFilePath, 'utf8') !== plan.nextArchiveContent) {
        throw new Error('canonical task archive read-back did not match the staged archive.');
      }
      const receipt = readCanonicalArchive(this.root, readBack, plan.archiveRelativePath);
      if (receipt.revision !== plan.archiveRevision) throw new Error('canonical task archive revision changed during read-back.');
      const audits = archiveAudits(readBack);
      if (audits.length !== 1) throw new Error('terminal CURRENT_TASK read-back does not contain exactly one archive audit.');
      assertArchiveReceiptMatches(readBack, receipt, audits[0]!);
      return buildResult('success', proposal, current, options, 'archive transaction committed; CURRENT_TASK and canonical archive read-back verified.', {
        committed: true,
        governed_mutation_count: 2,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        archive_path: plan.archiveRelativePath,
        archive_revision: plan.archiveRevision,
        read_back_verified: true,
        state: resultState(readBack.runtimeState),
      } as Partial<RuntimeResult>);
    } catch (error) {
      const rollback = rollbackArchiveTransactionAndVerify(this.root, current, plan, this.readCurrentTask);
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `archive read-back failed: ${error instanceof Error ? error.message : String(error)}; exact two-file rollback verified.`
        : `archive read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED',
      });
    }
  }

  private commitProjectStatusTransaction(
    current: CanonicalCurrentTask,
    proposal: ProjectStatusProposal,
    plan: ProjectStatusTransactionPlan | null,
    options: RuntimeApplyOptions,
  ): RuntimeResult {
    const targetPath = workflowDocPathForRoot(this.root, 'STATUS.md').relativePath;
    if (plan === null) {
      return buildResult('no-op', proposal, current, options, 'matching STATUS reconciliation already exists; STATUS was not rewritten.', {
        target_path: targetPath,
        planned_writes: [],
        previous_revision: fileRevisionForPath(workflowDocPathForRoot(this.root, 'STATUS.md').filePath),
        resulting_revision: fileRevisionForPath(workflowDocPathForRoot(this.root, 'STATUS.md').filePath),
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    }
    if (options.dryRun) {
      return buildResult('success', proposal, current, options, 'typed project-status proposal validated; STATUS-only write planned (dry-run).', {
        target_path: plan.statusRelativePath,
        previous_revision: sha256(plan.originalStatusContent),
        resulting_revision: plan.statusRevision,
        state: resultState(current.runtimeState),
      });
    }
    try {
      executeWrites([{ path: plan.statusFilePath, content: plan.nextStatusContent }], false, 'vNext Runtime project status transaction committed');
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.statusFilePath, plan.originalStatusContent, 'STATUS');
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `STATUS write failed: ${error instanceof Error ? error.message : String(error)}; STATUS rollback verified (archive remains committed).`
        : `STATUS write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.statusRelativePath,
        code: rollback.verified ? 'ATOMIC_COMMIT_FAILED' : 'ROLLBACK_FAILED',
      });
    }
    try {
      const readBack = fs.readFileSync(plan.statusFilePath, 'utf8');
      if (readBack !== plan.nextStatusContent) throw new Error('STATUS read-back did not match the staged typed reconciliation.');
      const receipt = matchingStatusReceipt(readBack, plan.statusRelativePath, plan.archive);
      if (receipt === null || receipt.archivePath !== plan.archive.relativePath || receipt.archiveRevision !== plan.archive.revision || receipt.sourceRevision !== plan.archive.sourceRevision || receipt.deltaDigest !== digest(proposal.semantic_delta)) {
        throw new Error('STATUS read-back receipt did not match the canonical archive.');
      }
      assertStatusProjection(readBack, proposal.semantic_delta, plan.statusRelativePath);
      return buildResult('success', proposal, current, options, 'project-status transaction committed; STATUS-only read-back verified.', {
        target_path: plan.statusRelativePath,
        committed: true,
        governed_mutation_count: 1,
        previous_revision: sha256(plan.originalStatusContent),
        resulting_revision: plan.statusRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.statusFilePath, plan.originalStatusContent, 'STATUS');
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `STATUS read-back failed: ${error instanceof Error ? error.message : String(error)}; STATUS rollback verified (archive remains committed).`
        : `STATUS read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.statusRelativePath,
        code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED',
      });
    }
  }

  private commitLessonRecordTransaction(
    current: CanonicalCurrentTask,
    proposal: LessonRecordProposal,
    plan: LessonRecordTransactionPlan | null,
    options: RuntimeApplyOptions,
  ): RuntimeResult {
    const targetPath = workflowDocPathForRoot(this.root, 'LESSONS.md').relativePath;
    if (plan === null) {
      return buildResult('no-op', proposal, current, options, 'lesson admission is defer/no-op or all admitted candidates are already durably recorded; LESSONS was not rewritten.', {
        target_path: targetPath,
        planned_writes: [],
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    }
    if (options.dryRun) {
      return buildResult('success', proposal, current, options, 'typed lesson-record proposal validated; LESSONS-only write planned (dry-run).', {
        target_path: plan.lessonsRelativePath,
        previous_revision: sha256(plan.originalLessonsContent),
        resulting_revision: plan.lessonsRevision,
        state: resultState(current.runtimeState),
      });
    }
    try {
      executeWrites([{ path: plan.lessonsFilePath, content: plan.nextLessonsContent }], false, 'vNext Runtime lesson record transaction committed');
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.lessonsFilePath, plan.originalLessonsContent, 'LESSONS');
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `LESSONS write failed: ${error instanceof Error ? error.message : String(error)}; LESSONS rollback verified (archive and STATUS remain committed).`
        : `LESSONS write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.lessonsRelativePath,
        code: rollback.verified ? 'ATOMIC_COMMIT_FAILED' : 'ROLLBACK_FAILED',
      });
    }
    try {
      const readBack = fs.readFileSync(plan.lessonsFilePath, 'utf8');
      if (readBack !== plan.nextLessonsContent) throw new Error('LESSONS read-back did not match the staged typed lesson record.');
      readDurableLessonRecords(readBack, plan.lessonsRelativePath);
      return buildResult('success', proposal, current, options, 'lesson-record transaction committed; LESSONS-only read-back verified.', {
        target_path: plan.lessonsRelativePath,
        committed: true,
        governed_mutation_count: 1,
        previous_revision: sha256(plan.originalLessonsContent),
        resulting_revision: plan.lessonsRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.lessonsFilePath, plan.originalLessonsContent, 'LESSONS');
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `LESSONS read-back failed: ${error instanceof Error ? error.message : String(error)}; LESSONS rollback verified (archive and STATUS remain committed).`
        : `LESSONS read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.lessonsRelativePath,
        code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED',
      });
    }
  }

  private commitKnowledgeRecordTransaction(
    current: CanonicalCurrentTask,
    proposal: KnowledgeProposal,
    plan: KnowledgeRecordTransactionPlan,
    options: RuntimeApplyOptions,
  ): RuntimeResult {
    const targetPath = plan.relativePath;
    if (plan.existing) {
      return buildResult('no-op', proposal, current, options, 'matching durable Contract/Decision record already exists; knowledge promotion is a deterministic no-op.', {
        target_path: targetPath,
        planned_writes: [],
        previous_revision: sha256(plan.originalContent),
        resulting_revision: sha256(plan.originalContent),
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    }
    if (options.dryRun) {
      return buildResult('success', proposal, current, options, 'typed knowledge admission validated; one canonical knowledge document write planned (dry-run).', {
        target_path: targetPath,
        previous_revision: sha256(plan.originalContent),
        resulting_revision: sha256(plan.nextContent),
        state: resultState(current.runtimeState),
      });
    }
    try {
      this.writeFiles([{ path: plan.filePath, content: plan.nextContent }], false, `vNext Runtime ${proposal.operation_kind} committed`);
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.filePath, plan.originalContent, 'knowledge');
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `knowledge write failed: ${error instanceof Error ? error.message : String(error)}; knowledge rollback verified.`
        : `knowledge write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? 'ATOMIC_COMMIT_FAILED' : 'ROLLBACK_FAILED',
      });
    }
    try {
      const readBack = this.readFile(plan.filePath);
      if (readBack !== plan.nextContent) throw new Error('canonical knowledge document read-back did not match the staged record.');
      const records = readDurableKnowledgeRecords(readBack, targetPath, proposal.semantic_delta.knowledge_kind);
      if (!records.some(record => JSON.stringify(record) === JSON.stringify(plan.record))) {
        throw new Error('canonical knowledge read-back did not contain the admitted record.');
      }
      return buildResult('success', proposal, current, options, 'knowledge promotion committed; canonical Contract/Decision read-back verified.', {
        target_path: targetPath,
        committed: true,
        governed_mutation_count: 1,
        previous_revision: sha256(plan.originalContent),
        resulting_revision: sha256(plan.nextContent),
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.filePath, plan.originalContent, 'knowledge');
      return buildResult('blocked', proposal, current, options, rollback.verified
        ? `knowledge read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.`
        : `knowledge read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED',
      });
    }
  }

  private commitLifecycleTransaction(
    current: CanonicalCurrentTask,
    proposal: LifecycleProposal,
    plan: LifecycleTransactionPlan,
    options: RuntimeApplyOptions,
  ): RuntimeResult {
    const nextRevision = sha256(plan.nextContent);
    if (proposal.mode === 'supersede') {
      let basis: CanonicalTaskBasis | undefined;
      let historyPath: string;
      let historyContent: string;
      const historyInput = {
        currentPath: current.filePath,
        previousContent: current.raw,
        nextContent: plan.nextContent,
        documentId: current.sourceTuple.document_id,
        taskId: current.runtimeState.task_id,
        evidencePlanRevision: current.runtimeState.evidence_plan_revision,
        referencedEvidence: [
          ...current.runtimeState.execution_log.flatMap(item => item.evidence_refs),
          ...current.runtimeState.findings.flatMap(item => item.evidence_refs),
          ...(current.runtimeState.claim_evidence ?? []).flatMap(claim => claim.slots.flatMap(slot => slot.evidence_refs)),
        ],
      };
      try {
        basis = readTaskBasisReferenceFromBody(current.body)
          ? readCanonicalTaskBasis(this.root, current)
          : undefined;
        const location = taskHistoryLocation({ ...historyInput, ...(basis ? { basisPath: basis.filePath, basisContent: basis.content } : {}) });
        historyPath = path.relative(this.root, location.path).replace(/\\/gu, '/');
        historyContent = location.content;
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          code: error instanceof VNextRuntimeError ? error.code : 'TASK_HISTORY_INVALID',
        });
      }
      const plannedWrites = [current.relativePath, historyPath];
      if (options.dryRun) {
        return buildResult('success', proposal, current, options, 'typed supersede proposal validated; immutable history and canonical CURRENT_TASK writes planned (dry-run).', {
          planned_writes: plannedWrites,
          previous_revision: current.sourceTuple.revision,
          resulting_revision: nextRevision,
          state: resultState(plan.next),
        });
      }
      let stagedAfter: CanonicalCurrentTask;
      try {
        stagedAfter = this.stageCurrentTaskCommit(current, plan.nextContent, plan.next, proposal, proposal.requested_write_targets, [
          { path: current.filePath, content: plan.nextContent },
          { path: path.join(this.root, ...historyPath.split('/')), content: historyContent },
        ]);
      } catch (error) {
        return buildResult('blocked', proposal, current, options, `task-store precommit staging failed: ${error instanceof Error ? error.message : String(error)}`, {
          code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
        });
      }
      let readBack: CanonicalCurrentTask | undefined;
      try {
        commitSupersedeWithHistory({ ...historyInput, ...(basis ? { basisPath: basis.filePath, basisContent: basis.content } : {}) }, content => {
          const parsed = parseCanonicalCurrentTaskContent(content, current.filePath, current.relativePath);
          readBack = stagedAfter.frontmatter.task_store === undefined ? parsed : stagedAfter;
          if (readBack.sourceTuple.revision !== nextRevision
            || readBack.runtimeState.workflow_status !== 'superseded'
            || readBack.runtimeState.lifecycle_state !== 'active') {
            throw new Error('supersede CURRENT_TASK read-back did not preserve the exact superseded + active state.');
          }
          });
        if (stagedAfter.sourceTuple.document_id === current.sourceTuple.document_id) {
          TaskStore.forCurrent(this.root, current as unknown as import('./task-store').TaskStoreCurrent).markCurrentPublished(nextRevision);
        }
      } catch (error) {
        if (fs.existsSync(current.filePath) && sha256(fs.readFileSync(current.filePath, 'utf8')) === current.sourceTuple.revision) {
          clearPendingTaskStoreAfterRollback(this.root, current);
        }
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          planned_writes: plannedWrites,
          code: 'TASK_EVOLUTION_COMMIT_FAILED',
        });
      }
      return buildResult('success', proposal, current, options, 'typed supersede proposal committed; immutable history and canonical CURRENT_TASK read-back verified.', {
        planned_writes: plannedWrites,
        committed: true,
        governed_mutation_count: 2,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        read_back_verified: true,
        state: resultState(readBack!.runtimeState),
      });
    }
    if (!plan.packageFilePath || !plan.packageRelativePath || plan.nextPackageContent === undefined) {
      return buildResult('blocked', proposal, current, options, 'lifecycle transaction is missing its suspended package plan.', { code: 'RUNTIME_HANDLER_BLOCKED' });
    }
    if (options.dryRun) {
      return buildResult('success', proposal, current, options, 'typed lifecycle proposal validated; atomic CURRENT_TASK + suspended package write planned (dry-run).', {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        state: resultState(plan.next, undefined, plan.packageRelativePath),
      });
    }

    let stagedAfter: CanonicalCurrentTask;
    try {
      stagedAfter = this.stageCurrentTaskCommit(current, plan.nextContent, plan.next, proposal, proposal.requested_write_targets, [
        { path: current.filePath, content: plan.nextContent },
        { path: plan.packageFilePath, content: plan.nextPackageContent },
      ]);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, `task-store precommit staging failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
      });
    }

    try {
      executeWrites(
        [
          { path: current.filePath, content: plan.nextContent },
          { path: plan.packageFilePath, content: plan.nextPackageContent },
        ],
        false,
        `vNext Runtime ${proposal.mode} lifecycle transaction committed`,
      );
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: 'ATOMIC_COMMIT_FAILED' });
    }

    try {
      if (stagedAfter.sourceTuple.document_id === current.sourceTuple.document_id) {
        TaskStore.forCurrent(this.root, current as unknown as import('./task-store').TaskStoreCurrent).markCurrentPublished(nextRevision);
      }
      const readBack = stagedAfter.frontmatter.task_store === undefined ? this.readCurrentTask(this.root) : stagedAfter;
      if (readBack.raw !== plan.nextContent || readBack.sourceTuple.revision !== nextRevision) {
        throw new Error('canonical CURRENT_TASK read-back did not match the staged lifecycle document.');
      }
      if (!fs.existsSync(plan.packageFilePath) || fs.readFileSync(plan.packageFilePath, 'utf8') !== plan.nextPackageContent) {
        throw new Error('suspended package read-back did not match the staged lifecycle artifact.');
      }
      const lifecycleDelta = proposal.semantic_delta;
      const artifactKind = lifecycleDelta.action === 'pause'
        ? 'paused'
        : lifecycleDelta.action === 'interrupt'
          ? 'interrupted'
          : lifecycleDelta.action === 'resume-paused' || lifecycleDelta.action === 'resume-interrupted'
            ? lifecycleDelta.artifact_kind
            : 'paused';
      const parsedPackage = parseSuspendedPackage(this.root, readBack, plan.packageRelativePath, artifactKind);
      const expectedStatus = proposal.mode === 'resume-paused' || proposal.mode === 'resume-interrupted' ? 'rehydrated' : 'ready_for_resume';
      if (parsedPackage.rehydrationStatus !== expectedStatus || parsedPackage.ownershipState !== (expectedStatus === 'rehydrated' ? 'rehydrated' : 'recovery_only')) {
        throw new Error('suspended package marker read-back did not match the lifecycle transaction.');
      }
      return buildResult('success', proposal, current, options, 'typed lifecycle proposal committed; CURRENT_TASK and suspended package read-back verified.', {
        committed: true,
        governed_mutation_count: 2,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        read_back_verified: true,
        state: resultState(readBack.runtimeState, undefined, plan.packageRelativePath),
      });
    } catch (error) {
      const rollback = rollbackLifecycleTransactionAndVerify(this.root, current, plan, this.readCurrentTask);
      return buildResult(
        'blocked',
        proposal,
        current,
        options,
        rollback.verified
          ? `Runtime lifecycle read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.`
          : `Runtime lifecycle read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`,
        { code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED' },
      );
    }
  }

  apply(rawProposal: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
    return withGovernanceWriteLock(this.root, () => {
      this.lastApplyCurrent = undefined;
      this.lastApplyAfter = undefined;
      this.lastApplyProposal = undefined;
      const result = this.applyLocked(rawProposal, options);
      const before = this.lastApplyCurrent;
      if (!options.dryRun && result.committed && before) {
        try {
          const after = this.lastApplyAfter ?? this.readCurrentTask(this.root);
          const afterStore = TaskStore.forCurrent(this.root, after);
          // Draft creation allocates a new document identity.  The new
          // aggregate is initialized from the fully rendered read-back; it
          // must not be forced through the previous task's document store.
          const manifest = before.sourceTuple.document_id === after.sourceTuple.document_id
            ? afterStore.recordCommit({ before, after, proposal: this.lastApplyProposal ?? rawProposal, result })
            : afterStore.ensureInitialized(after);
          if (manifest) {
            const verifiedAfter = this.readCurrentTask(this.root);
            if (verifiedAfter.raw !== after.raw || verifiedAfter.sourceTuple.revision !== after.sourceTuple.revision) {
              throw new Error('task-store publication read-back did not match the committed CURRENT_TASK after-image.');
            }
            return {
              ...result,
              task_store: {
                manifest_path: `${manifest.storage_root}/manifest.json`,
                source_revision: manifest.head.source_revision,
                definition_revision: manifest.head.definition_revision,
                state_revision: manifest.head.state_revision,
                event_sequence: manifest.head.event_sequence,
              },
            };
          }
        } catch (error) {
          // The canonical write has already passed its own read-back, but the
          // aggregate is not executable until its task-store publication is
          // complete. Report the exact partial-commit boundary and block later
          // business work until the pending journal is recovered.
          return {
            ...result,
            status: 'blocked',
            code: 'TASK_STORE_COMMIT_FAILED',
            message: `${result.message} Task-store publication needs reconciliation: ${error instanceof Error ? error.message : String(error)}`,
            read_back_verified: false,
          };
        }
      }
      return result;
    });
  }

  private applyLocked(rawProposal: unknown, options: RuntimeApplyOptions): RuntimeResult {
    let proposal: RuntimeProposal;
    try {
      proposal = validateRuntimeProposal(rawProposal);
    } catch (error) {
      const code = error instanceof VNextRuntimeError ? error.code : 'RUNTIME_SCHEMA_INVALID';
      const fallbackOperation = isRecord(rawProposal) && typeof rawProposal.operation_kind === 'string' && RUNTIME_OPERATION_KINDS.includes(rawProposal.operation_kind as RuntimeOperationKind)
        ? rawProposal.operation_kind as RuntimeOperationKind
        : 'task-state-transaction';
      const fallbackKey = isRecord(rawProposal) && typeof rawProposal.idempotency_key === 'string' ? rawProposal.idempotency_key : 'invalid-proposal';
      return {
        status: 'blocked',
        operation_kind: fallbackOperation,
        idempotency_key: fallbackKey,
        target_path: CURRENT_TASK_RELATIVE_FALLBACK,
        dry_run: options.dryRun === true,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
        code,
        planned_writes: [],
        governed_mutation_count: 0,
        read_back_verified: false,
      };
    }
    this.lastApplyProposal = proposal;

    let current: CanonicalCurrentTask;
    if (!options.dryRun) {
      try {
        recoverPendingTaskStoreCommit(this.root);
      } catch (error) {
        return {
          status: 'blocked',
          operation_kind: proposal.operation_kind,
          idempotency_key: proposal.idempotency_key,
          target_path: proposal.source_tuple.path,
          dry_run: false,
          committed: false,
          message: error instanceof Error ? error.message : String(error),
          code: error instanceof VNextRuntimeError || error instanceof TaskStoreError ? error.code : 'TASK_STORE_RECOVERY_REQUIRED',
          planned_writes: [],
          governed_mutation_count: 0,
          read_back_verified: false,
        };
      }
    }
    try {
      current = this.readCurrentTask(this.root);
    } catch (error) {
      return {
        status: 'blocked',
        operation_kind: proposal.operation_kind,
        idempotency_key: proposal.idempotency_key,
        target_path: proposal.source_tuple.path,
        dry_run: options.dryRun === true,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_SOURCE_INVALID',
        planned_writes: [],
        governed_mutation_count: 0,
        read_back_verified: false,
      };
    }
    this.lastApplyCurrent = current;

    let taskStore: TaskStore;
    try {
      taskStore = TaskStore.forCurrent(this.root, current);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
        code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_INIT_FAILED',
      });
    }

    try {
      if (proposal.source_tuple.path !== current.relativePath) fail('RUNTIME_PATH_INVALID', 'proposal source path is not the exact canonical CURRENT_TASK path.');
      if (proposal.operation_kind === 'lifecycle-transaction') {
        assertRequestedLifecycleTargets(this.root, current, proposal as LifecycleProposal);
      } else if (proposal.operation_kind === 'inbox-record-transaction') {
        assertRequestedInboxTargets(this.root, current, proposal as InboxRecordProposal);
      } else if (proposal.operation_kind === 'archive-transaction' || proposal.operation_kind === 'project-status-transaction' || proposal.operation_kind === 'lesson-record-transaction' || proposal.operation_kind === 'contract-candidate-commit' || proposal.operation_kind === 'decision-record-transaction') {
        assertRequestedCloseTargets(this.root, current, proposal);
      } else if (
        proposal.operation_kind === 'task-state-transaction'
        && proposal.semantic_delta.kind === 'task-state'
        && ['create-draft', 'update-draft', 'commit-replan'].includes(proposal.semantic_delta.action)
      ) {
        const taskId = proposal.semantic_delta.action === 'create-draft' || proposal.semantic_delta.action === 'update-draft'
          ? proposal.semantic_delta.task_id
          : current.runtimeState.task_id;
        const expectedBasisPath = taskBasisRelativePath(current.relativePath, taskId);
        if (
          proposal.requested_write_targets.length !== 2
          || proposal.requested_write_targets[0] !== current.relativePath
          || proposal.requested_write_targets[1] !== expectedBasisPath
        ) {
          fail('RUNTIME_PATH_INVALID', 'draft proposal must target the exact canonical CURRENT_TASK and identity-derived task basis paths.');
        }
      } else if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== current.relativePath) {
        fail('RUNTIME_PATH_INVALID', 'proposal write target is not the exact canonical CURRENT_TASK path.');
      }
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_PATH_INVALID' });
    }

    if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'commit-replan') {
      return buildResult('blocked', proposal, current, options,
        'Direct commit-replan is disabled until a revision-bound candidate, complete prior-obligation disposition, and explicit confirmation are available. CURRENT_TASK was not changed.',
        { code: 'REPLAN_CONFIRMATION_REQUIRED' });
    }

    if (proposal.operation_kind === 'inbox-record-transaction') {
      const inboxProposal = proposal as InboxRecordProposal;
      let inspectedPlan: InboxRecordTransactionPlan;
      try {
        // A durable canonical record is the only evidence that can authorize a replay
        // after CURRENT_TASK has advanced. Inspect it before applying the source gate.
        ensureAuthorityKinds(inboxProposal, ['evidence-admission']);
        inspectedPlan = inspectInboxRecordTransaction(this.root, inboxProposal);
      } catch (error) {
        const code = error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED';
        return buildResult(code === 'IDEMPOTENCY_CONFLICT' ? 'conflict' : 'blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: inboxProposal.semantic_delta.target_path,
          code,
        });
      }
      if (inspectedPlan.existing) {
        return this.commitInboxRecordTransaction(current, inboxProposal, inspectedPlan, options);
      }
      const conflictField = compareSourceTuple(proposal.source_tuple, current.sourceTuple);
      if (conflictField) {
        return buildResult('conflict', proposal, current, options, `canonical source tuple is stale at ${conflictField}.`, {
          target_path: inboxProposal.semantic_delta.target_path,
          code: 'SOURCE_TUPLE_MISMATCH',
          previous_revision: current.sourceTuple.revision,
        });
      }
      try {
        const plan = prepareInboxRecordTransaction(this.root, current, inboxProposal);
        return this.commitInboxRecordTransaction(current, inboxProposal, plan, options);
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: inboxProposal.semantic_delta.target_path,
          code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED',
        });
      }
    }

    if (proposal.operation_kind === 'contract-candidate-commit' || proposal.operation_kind === 'decision-record-transaction') {
      const knowledgeProposal = proposal as KnowledgeProposal;
      let inspectedPlan: KnowledgeRecordTransactionPlan;
      try {
        inspectedPlan = inspectKnowledgeRecordTransaction(this.root, current, knowledgeProposal);
      } catch (error) {
        const code = error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED';
        const conflictCodes = new Set(['IDEMPOTENCY_CONFLICT', 'KNOWLEDGE_IDENTITY_CONFLICT']);
        return buildResult(conflictCodes.has(code) ? 'conflict' : 'blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: proposal.operation_kind === 'contract-candidate-commit'
            ? workflowDocPathForRoot(this.root, 'CONTRACTS.md').relativePath
            : workflowDocPathForRoot(this.root, 'DECISIONS.md').relativePath,
          code,
        });
      }
      if (inspectedPlan.existing) {
        return this.commitKnowledgeRecordTransaction(current, knowledgeProposal, inspectedPlan, options);
      }
      const conflictField = compareSourceTuple(proposal.source_tuple, current.sourceTuple);
      if (conflictField) {
        return buildResult('conflict', proposal, current, options, `canonical source tuple is stale at ${conflictField}.`, {
          target_path: inspectedPlan.relativePath,
          code: 'SOURCE_TUPLE_MISMATCH',
          previous_revision: current.sourceTuple.revision,
        });
      }
      try {
        const plan = prepareKnowledgeRecordTransaction(this.root, current, knowledgeProposal);
        return this.commitKnowledgeRecordTransaction(current, knowledgeProposal, plan, options);
      } catch (error) {
        const code = error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED';
        const conflictCodes = new Set(['IDEMPOTENCY_CONFLICT', 'KNOWLEDGE_IDENTITY_CONFLICT']);
        return buildResult(conflictCodes.has(code) ? 'conflict' : 'blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: proposal.operation_kind === 'contract-candidate-commit'
            ? workflowDocPathForRoot(this.root, 'CONTRACTS.md').relativePath
            : workflowDocPathForRoot(this.root, 'DECISIONS.md').relativePath,
          code,
        });
      }
    }

    if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'record-step-preflight') {
      try {
        assertOrdinaryPreflight(current, this.root);
      } catch (error) {
        const code = error instanceof VNextRuntimeError ? error.code : 'PREFLIGHT_BLOCKED';
        return buildResult(code === 'REVIEW_TARGET_STALE' ? 'conflict' : 'blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code });
      }
    }
    if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'retry-step') {
      const delta = proposal.semantic_delta;
      const ledger = current.runtimeState.step_attempts?.[delta.step_id];
      const priorRetry = ledger?.attempts.find(a=>a.idempotency_key===proposal.idempotency_key);
      if (priorRetry) {
        if (proposal.source_tuple.document_id !== current.sourceTuple.document_id || ledger!.evidence_plan_revision !== current.runtimeState.evidence_plan_revision || priorRetry.request_digest !== retryRequestDigest(current,delta)) return buildResult('conflict',proposal,current,options,'Retry key is already bound to different task/plan/request semantics.',{code:'RETRY_IDEMPOTENCY_CONFLICT'});
        return buildResult('no-op',proposal,current,options,'This retry was already admitted; no budget or state changed.',{read_back_verified:true,resulting_revision:current.sourceTuple.revision});
      }
    }
    try {
      // Do not create or reconcile task-data for a proposal rejected by the
      // path, authority, preflight, or retry gates above. A valid proposal
      // gets the sidecar before the persistent idempotency lookup so an old
      // entry can still authorize a replay after the hot window moved on.
      if (!options.dryRun) taskStore.ensureInitialized(current);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
        code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_INIT_FAILED',
      });
    }
    const proposalDigest = digest(proposal);
    const prior = current.runtimeState.applied_proposals.find(item => item.idempotency_key === proposal.idempotency_key);
    let persistentPrior: ReturnType<TaskStore['lookupIdempotency']> = null;
    try {
      persistentPrior = taskStore.lookupIdempotency(proposal.idempotency_key);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
        code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_INDEX_INVALID',
      });
    }
    // Every proposal that reaches this shared admission path has already
    // passed its specialized target inspection above (inbox/knowledge
    // transactions return earlier). The sidecar therefore closes the old
    // bounded-cache hole for every remaining operation kind. Close-task
    // documents still need a read-only provenance check before a persistent
    // replay is accepted: their idempotency entry proves that the operation
    // was committed, not that a later manual edit left the visible target
    // intact.
    const persistentReplayEligible = true;
    if (!prior && persistentPrior && persistentReplayEligible) {
      if (persistentPrior.proposal_digest !== proposalDigest) {
        return buildResult('conflict', proposal, current, options, 'persistent idempotency index binds this key to different proposal bytes.', {
          code: 'IDEMPOTENCY_CONFLICT',
          previous_revision: current.sourceTuple.revision,
        });
      }
      try {
        if (proposal.operation_kind === 'archive-transaction') {
          const plan = prepareArchiveTransaction(this.root, current, proposal as ArchiveProposal, options.now?.() ?? new Date().toISOString());
          if (plan !== null) {
            return buildResult('blocked', proposal, current, options, 'persistent archive replay found a visible archive target that is not the committed replay state.', {
              code: 'LIFECYCLE_REPLAY_INCOMPLETE',
            });
          }
        } else if (proposal.operation_kind === 'project-status-transaction') {
          const plan = prepareProjectStatusTransaction(this.root, current, proposal as ProjectStatusProposal);
          if (plan !== null) {
            return buildResult('blocked', proposal, current, options, 'persistent STATUS replay found a visible target that is not the committed reconciliation.', {
              target_path: workflowDocPathForRoot(this.root, 'STATUS.md').relativePath,
              code: 'RUNTIME_REPLAY_INCOMPLETE',
            });
          }
        } else if (proposal.operation_kind === 'lesson-record-transaction') {
          const plan = prepareLessonRecordTransaction(this.root, current, proposal as LessonRecordProposal);
          if (plan !== null) {
            return buildResult('blocked', proposal, current, options, 'persistent LESSONS replay found visible records that are not the committed lesson admission.', {
              target_path: workflowDocPathForRoot(this.root, 'LESSONS.md').relativePath,
              code: 'RUNTIME_REPLAY_INCOMPLETE',
            });
          }
        }
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: proposal.operation_kind === 'project-status-transaction'
            ? workflowDocPathForRoot(this.root, 'STATUS.md').relativePath
            : proposal.operation_kind === 'lesson-record-transaction'
              ? workflowDocPathForRoot(this.root, 'LESSONS.md').relativePath
              : undefined,
          code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_REPLAY_INCOMPLETE',
        });
      }
      return buildResult('no-op', proposal, current, options, 'proposal replay was found in the persistent task store; no execution or state change was repeated.', {
        planned_writes: [],
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true,
      });
    }
    if (prior) {
      if (prior.proposal_digest !== proposalDigest) {
        return buildResult('conflict', proposal, current, options, 'idempotency key was already used by a different proposal.', { code: 'IDEMPOTENCY_CONFLICT', previous_revision: current.sourceTuple.revision });
      }
      if (proposal.operation_kind === 'lifecycle-transaction') {
        try {
          assertLifecycleReplayArtifacts(this.root, current, proposal as LifecycleProposal);
        } catch (error) {
          return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
            code: error instanceof VNextRuntimeError ? error.code : 'LIFECYCLE_REPLAY_INCOMPLETE',
          });
        }
      } else if (proposal.operation_kind === 'task-state-transaction') {
        try {
          assertTaskStateReplay(this.root, current, proposal);
        } catch (error) {
          return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
            code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_REPLAY_INCOMPLETE',
          });
        }
      } else if (proposal.operation_kind === 'archive-transaction') {
        try {
          assertArchiveReplay(this.root, current, proposal as ArchiveProposal);
        } catch (error) {
          return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
            code: error instanceof VNextRuntimeError ? error.code : 'LIFECYCLE_REPLAY_INCOMPLETE',
          });
        }
      }
      return buildResult('no-op', proposal, current, options, 'proposal replay is an idempotent no-op.', {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true,
        state: resultState(current.runtimeState),
      });
    }
    const conflictField = compareSourceTuple(proposal.source_tuple, current.sourceTuple);
    if (conflictField) {
      return buildResult('conflict', proposal, current, options, `canonical source tuple is stale at ${conflictField}.`, { code: 'SOURCE_TUPLE_MISMATCH', previous_revision: current.sourceTuple.revision });
    }

    const now = options.now?.() ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(now))) {
      return buildResult('blocked', proposal, current, options, 'Runtime clock returned an invalid timestamp.', { code: 'RUNTIME_CLOCK_INVALID' });
    }
    if (proposal.operation_kind === 'lifecycle-transaction') {
      try {
        const plan = prepareLifecycleTransaction(this.root, current, proposal as LifecycleProposal, now);
        return this.commitLifecycleTransaction(current, proposal as LifecycleProposal, plan, options);
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED' });
      }
    }
    if (proposal.operation_kind === 'archive-transaction') {
      try {
        const plan = prepareArchiveTransaction(this.root, current, proposal as ArchiveProposal, now);
        return this.commitArchiveTransaction(current, proposal as ArchiveProposal, plan, options);
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED' });
      }
    }
    if (proposal.operation_kind === 'project-status-transaction') {
      try {
        const plan = prepareProjectStatusTransaction(this.root, current, proposal as ProjectStatusProposal);
        return this.commitProjectStatusTransaction(current, proposal as ProjectStatusProposal, plan, options);
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: workflowDocPathForRoot(this.root, 'STATUS.md').relativePath,
          code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED',
        });
      }
    }
    if (proposal.operation_kind === 'lesson-record-transaction') {
      try {
        const plan = prepareLessonRecordTransaction(this.root, current, proposal as LessonRecordProposal);
        return this.commitLessonRecordTransaction(current, proposal as LessonRecordProposal, plan, options);
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: workflowDocPathForRoot(this.root, 'LESSONS.md').relativePath,
          code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED',
        });
      }
    }
    let transition: StateTransition;
    try {
      transition = proposal.operation_kind === 'task-state-transaction'
        ? applyTaskStateDelta(this.root, current, proposal, now)
        : applyFindingQueueDelta(current, proposal, now);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED' });
    }

    let taskBasisArtifact: TaskBasisArtifact | undefined;
    let originalTaskBasisContent: string | undefined;
    try {
      if (transition.taskBasis) {
        const currentIdentity = extractTaskIdentityFromCurrentTask(current.body);
        const identity = transition.draftIdentity ?? {
          task_id: current.runtimeState.task_id,
          task_slug: current.runtimeState.task_slug,
          document_id: current.sourceTuple.document_id,
          task_title: currentIdentity.title,
        };
        taskBasisArtifact = materializeTaskBasis(this.root, current, identity, transition.taskBasis);
        const existingReference = readTaskBasisReferenceFromBody(current.body);
        const basisExists = fs.existsSync(taskBasisArtifact.filePath);
        if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'create-draft') {
          if (basisExists) fail('TASK_BASIS_CONFLICT', `create-draft refuses to overwrite existing task basis ${taskBasisArtifact.path}.`);
        } else if (existingReference) {
          if (existingReference.path !== taskBasisArtifact.path) {
            fail('TASK_BASIS_REFERENCE_INVALID', 'CURRENT_TASK links a different task basis path than the draft transaction target.');
          }
          if (!basisExists) fail('TASK_BASIS_MISSING', `Linked task basis is missing: ${taskBasisArtifact.path}`);
          originalTaskBasisContent = fs.readFileSync(taskBasisArtifact.filePath, 'utf8');
          if (sha256(originalTaskBasisContent) !== existingReference.revision) {
            fail('TASK_BASIS_REVISION_CONFLICT', 'Linked task basis changed outside the Runtime transaction.');
          }
          const priorBasis = readCanonicalTaskBasis(this.root, current).basis;
          if (digest(priorBasis.original_request) !== digest(taskBasisArtifact.basis.original_request)
            || priorBasis.user_decisions.length > taskBasisArtifact.basis.user_decisions.length
            || priorBasis.user_decisions.some((decision, index) => digest(decision) !== digest(taskBasisArtifact.basis.user_decisions[index]))) {
            fail('TASK_BASIS_IMMUTABLE', 'Task Basis original_request and existing user_decisions must remain unchanged; append a new user decision instead.');
          }
        } else if (basisExists) {
          fail('TASK_BASIS_CONFLICT', `Unlinked task basis already exists at ${taskBasisArtifact.path}.`);
        }
      }
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
        code: error instanceof VNextRuntimeError ? error.code : 'TASK_BASIS_INVALID',
      });
    }

    let nextContent: string;
    try {
      if (current.runtimeState.task_evolution_version === 2 && proposal.semantic_delta.kind === 'task-state') {
        const delta = proposal.semantic_delta;
        if (delta.action === 'record-step-preflight' || (delta.action === 'step-progress' && delta.execution_result)) {
          if ((current.runtimeState.artifact_checkpoint_ids?.length ?? 0) >= 256) fail('ARTIFACT_BUDGET_EXHAUSTED', 'Task checkpoint budget is exhausted.');
          const paths = delta.action === 'record-step-preflight' ? delta.candidate_paths : delta.execution_result!.review_target.entries.map(item => item.path);
          const checkpointId = saveArtifactCheckpoint(this.root, current.filePath, { task_id: current.runtimeState.task_id,
            document_id: current.sourceTuple.document_id, step_id: delta.step_id,
            definition_revision: digest(resolveCanonicalTaskStep(current).current), execution_id: proposal.idempotency_key,
            phase: delta.action === 'record-step-preflight' ? 'before' : 'after' }, paths, options.dryRun === true);
          transition.next = { ...transition.next, artifact_checkpoint_ids: [...(current.runtimeState.artifact_checkpoint_ids ?? []), checkpointId] };
        }
      }
      nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, transition.next, {
        ...(transition.replacementDefinition ? { replacementDefinition: transition.replacementDefinition } : {}),
        ...(transition.draftDefinition ? { draftDefinition: transition.draftDefinition } : {}),
        ...(transition.draftIdentity ? { draftIdentity: transition.draftIdentity } : {}),
        ...(transition.draftDocumentId ? { draftDocumentId: transition.draftDocumentId } : {}),
        ...(transition.draftDocumentId ? {
          compactTaskStore: true,
          taskStoreManifestPath: `${taskStorePaths(this.root, transition.draftDocumentId).relativeRoot}/manifest.json`,
        } : {}),
        ...(taskBasisArtifact ? { taskBasisReference: { path: taskBasisArtifact.path, revision: taskBasisArtifact.revision } } : {}),
        ...(transition.audit ? { audit: transition.audit } : {}),
      });
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), {
        code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_RENDER_BLOCKED',
      });
    }
    const nextRevision = sha256(nextContent);
    if (nextContent === current.raw) {
      return buildResult('no-op', proposal, current, options, 'proposal produced no canonical state change.', {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true,
      });
    }
    if (options.dryRun) {
      return buildResult('success', proposal, current, options, 'typed proposal validated; atomic write planned (dry-run).', {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        state: resultState(transition.next, transition.findingStatus),
        ...(transition.advancement ? { advancement: transition.advancement } : {}),
      });
    }

    let stagedAfter: CanonicalCurrentTask;
    try {
      // The pending intent is durable before the canonical file changes.  A
      // crash after this point is therefore recoverable without rerunning the
      // business operation or creating a second attempt.
      stagedAfter = this.stageCurrentTaskCommit(current, nextContent, transition.next, proposal, proposal.requested_write_targets, [
        { path: current.filePath, content: nextContent },
        ...(taskBasisArtifact ? [{ path: taskBasisArtifact.filePath, content: taskBasisArtifact.content }] : []),
      ]);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, `task-store precommit staging failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
      });
    }

    try {
      executeWrites(
        [
          { path: current.filePath, content: nextContent },
          ...(taskBasisArtifact ? [{ path: taskBasisArtifact.filePath, content: taskBasisArtifact.content }] : []),
        ],
        false,
        `vNext Runtime ${proposal.operation_kind} committed`,
      );
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: 'ATOMIC_COMMIT_FAILED' });
    }

    try {
      if (stagedAfter.sourceTuple.document_id === current.sourceTuple.document_id) {
        TaskStore.forCurrent(this.root, current as unknown as import('./task-store').TaskStoreCurrent).markCurrentPublished(nextRevision);
      }
    } catch (error) {
      return buildResult('blocked', proposal, current, options, `task-store precommit publication failed after CURRENT_TASK write: ${error instanceof Error ? error.message : String(error)}`, {
        code: error instanceof TaskStoreError ? error.code : 'TASK_STORE_COMMIT_FAILED',
      });
    }

    try {
      const readBack = stagedAfter.frontmatter.task_store === undefined
        ? this.readCurrentTask(this.root)
        : stagedAfter;
      if (readBack.raw !== nextContent || readBack.sourceTuple.revision !== nextRevision) {
        const rollback = taskBasisArtifact
          ? rollbackDraftTransactionAndVerify(this.root, current, taskBasisArtifact, originalTaskBasisContent, this.readCurrentTask)
          : rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
        return buildResult(
          'blocked',
          proposal,
          current,
          options,
          rollback.verified
            ? 'Runtime read-back did not match the staged canonical document; rollback read-back verified.'
            : `Runtime read-back did not match the staged canonical document; ${rollback.detail}`,
          { code: rollback.verified ? 'READ_BACK_MISMATCH' : 'ROLLBACK_FAILED' },
        );
      }
      if (taskBasisArtifact) {
        const basisReadBack = readCanonicalTaskBasis(this.root, readBack);
        if (basisReadBack.content !== taskBasisArtifact.content || basisReadBack.revision !== taskBasisArtifact.revision) {
          const rollback = rollbackDraftTransactionAndVerify(this.root, current, taskBasisArtifact, originalTaskBasisContent, this.readCurrentTask);
          return buildResult(
            'blocked',
            proposal,
            current,
            options,
            rollback.verified
              ? 'Runtime task basis read-back did not match the staged artifact; rollback read-back verified.'
              : `Runtime task basis read-back did not match the staged artifact; ${rollback.detail}`,
            { code: rollback.verified ? 'READ_BACK_MISMATCH' : 'ROLLBACK_FAILED' },
          );
        }
      }
      return buildResult('success', proposal, current, options, 'typed proposal committed and canonical source read-back verified.', {
        committed: true,
        governed_mutation_count: taskBasisArtifact ? 2 : 1,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        read_back_verified: true,
        state: resultState(readBack.runtimeState, transition.findingStatus),
        ...(transition.advancement ? { advancement: transition.advancement } : {}),
      });
    } catch (error) {
      const rollback = taskBasisArtifact
        ? rollbackDraftTransactionAndVerify(this.root, current, taskBasisArtifact, originalTaskBasisContent, this.readCurrentTask)
        : rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
      return buildResult(
        'blocked',
        proposal,
        current,
        options,
        rollback.verified
          ? `Runtime read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.`
          : `Runtime read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`,
        { code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED' },
      );
    }
  }
}

export function applyVNextRuntimeProposal(root: string, proposal: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  return new GovernanceTransactionKernel(root).apply(proposal, options);
}

export function createTaskStateProposal(
  current: CanonicalCurrentTask,
  input: {
    mode: VNextExecuteStepMode;
    status: StepStatus;
    evidence_refs: string[];
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    note?: string;
    repair_fingerprint?: string;
    repair_fingerprints?: string[];
    repair_wave_id?: string;
    change_set_id?: string;
    review_receipt?: StepReviewReceipt;
    claim_evidence?: ClaimEvidenceRecord[];
    execution_result?: StepExecutionResult;
  },
): RuntimeProposal {
  const proposalEvidenceRefs = [...new Set([
    ...input.evidence_refs,
    ...claimEvidenceRefs(input.claim_evidence ?? []),
  ])];
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'execute-step',
    mode: input.mode,
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state',
      action: 'step-progress',
      step_id: current.runtimeState.active_step_id,
      status: input.status,
      evidence_refs: input.evidence_refs,
      ...(input.note ? { note: input.note } : {}),
      ...(input.repair_fingerprint ? { repair_fingerprint: input.repair_fingerprint } : {}),
      ...(input.repair_fingerprints ? { repair_fingerprints: input.repair_fingerprints } : {}),
      ...(input.repair_wave_id ? { repair_wave_id: input.repair_wave_id } : {}),
      ...(input.change_set_id ? { change_set_id: input.change_set_id } : {}),
      ...(input.review_receipt ? { review_receipt: input.review_receipt } : {}),
      ...(input.claim_evidence === undefined ? {} : { claim_evidence: input.claim_evidence }),
      ...(input.execution_result === undefined ? {} : { execution_result: input.execution_result }),
    },
    preconditions: ['current-task-is-active', 'active-step-matches', 'scope-admitted'],
    evidence_refs: proposalEvidenceRefs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function assertOrdinaryPreflight(current: CanonicalCurrentTask, root: string): void {
  const unresolvedChallenges = (current.runtimeState.evidence_challenges ?? []).filter(item => item.status !== 'resolved');
  const correctionBatch = unresolvedChallenges.some(item => item.status === 'invalidated' && item.correction_step_id === current.runtimeState.active_step_id);
  if (!correctionBatch && unresolvedChallenges.some(item => item.correction_step_id !== current.runtimeState.active_step_id)) {
    fail('EVIDENCE_CHALLENGE_UNRESOLVED', 'A challenged result may affect the next step; only its admitted correction step can run.');
  }
  for (const carry of current.runtimeState.evidence_carry_forward ?? []) {
    const slot = current.runtimeState.claim_evidence?.find(item => item.claim_id === carry.claim_id)?.slots.find(item => item.slot_id === carry.slot_id);
    if (!slot?.report) fail('EVIDENCE_CARRY_FORWARD_STALE', 'A carried slot no longer has its old report.');
    assertEvidenceReportApplicable(root, current, slot);
  }
  const pending = current.runtimeState.pending_review_result;
  if (pending) {
    const execution = current.runtimeState.execution_log.map(item => 'action' in item ? item : cumulativeReviewExecution(current, item)).find(item => !('action' in item) && item.idempotency_key === pending.execution_id);
    if (!execution || 'action' in execution || !execution.execution_result || captureReviewTarget(root, execution.execution_result.review_target.entries.map(entry => entry.path)).revision !== pending.review_target_revision) fail('REVIEW_TARGET_STALE', 'Pending review target changed; preserve the review and resolve its conflict.');
    let route = pending.blocker?.next_route ?? 'its recorded blocker route';
    if (pending.verdict === 'clean') route = 'complete-reviewed-step';
    if (pending.verdict === 'findings') route = 'begin-repair';
    fail('PENDING_REVIEW_REQUIRED', `Pending review must be consumed by ${route ?? 'its recorded blocker route'}; no ordinary execution is admitted.`);
  }
  if (current.runtimeState.findings.some(item => ['admitted', 'in-progress'].includes(item.status))) {
    fail('REVIEW_CONVERGENCE_REQUIRED', 'Open findings require admitted repair; ordinary execution cannot consume them.');
  }
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active' || current.runtimeState.resume_requires_review || current.runtimeState.active_step_status === 'blocked') {
    fail('PREFLIGHT_BLOCKED', 'ordinary execution requires an active unblocked task without a resume gate.');
  }
}

export function createStepRetryProposal(current: CanonicalCurrentTask, input: {step_id:string;blocked_attempt_id:string;blocker_resolution_refs:string[];repair_diagnosis?:StepRepairDiagnosis;idempotency_key:string}): RuntimeProposal {
  return validateRuntimeProposal({
    schema_version:1,kind:VNEXT_RUNTIME_PROPOSAL_KIND,operation_kind:'task-state-transaction',caller:'execute-step',mode:'default',source_tuple:current.sourceTuple,
    authority_evidence:['active-task-owner','scope-admission','evidence-admission'].map(kind=>({kind,source:current.relativePath,subject:current.runtimeState.active_step_id})),
    semantic_delta:{kind:'task-state',action:'retry-step',step_id:input.step_id,blocked_attempt_id:input.blocked_attempt_id,blocker_resolution_refs:input.blocker_resolution_refs,...(input.repair_diagnosis ? {repair_diagnosis:input.repair_diagnosis} : {}),evidence_refs:input.blocker_resolution_refs},
    preconditions:['current-task-is-active','active-step-matches','scope-admitted'],evidence_refs:input.blocker_resolution_refs,idempotency_key:input.idempotency_key,requested_write_targets:[current.relativePath],
  });
}

export function createStepPreflightProposal(current: CanonicalCurrentTask, candidatePaths: string[]): RuntimeProposal {
  return validateRuntimeProposal({
    schema_version: 1, kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction', caller: 'execute-step', mode: 'default', source_tuple: current.sourceTuple,
    authority_evidence: ['active-task-owner', 'scope-admission', 'evidence-admission'].map(kind => ({ kind, source: current.relativePath, subject: current.runtimeState.active_step_id })),
    semantic_delta: { kind: 'task-state', action: 'record-step-preflight', step_id: current.runtimeState.active_step_id, candidate_paths: candidatePaths, evidence_refs: [current.relativePath] },
    preconditions: ['current-task-is-active', 'active-step-matches', 'scope-admitted'], evidence_refs: [current.relativePath],
    idempotency_key: `preflight-${digest({ task: current.sourceTuple.document_id, plan: current.runtimeState.evidence_plan_revision, step: current.runtimeState.active_step_id, attempt:nextStepAttemptId(current), paths: candidatePaths })}`,
    requested_write_targets: [current.relativePath],
  });
}

export function createReviewResultProposal(
  current: CanonicalCurrentTask,
  input: {
    review_result: Omit<PendingReviewResult, 'recorded_at'>;
    evidence_refs: string[];
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  const evidenceRefs = [...new Set([
    ...input.evidence_refs,
    ...input.review_result.evidence_refs,
    ...input.review_result.findings.flatMap(item => item.evidence_refs),
  ])];
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'review-change',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state',
      action: 'record-review-result',
      review_result: input.review_result,
      evidence_refs: evidenceRefs,
    },
    preconditions: ['current-task-is-active', 'latest-execution-matches', 'review-context-current'],
    evidence_refs: evidenceRefs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function createEvidenceChallengeProposal(
  current: CanonicalCurrentTask,
  input: {
    claim_id: string;
    slot_id: string;
    result_id: string;
    evidence_ref: string;
    evidence_sha256: string;
    reason: string;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'review-change',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state',
      action: 'record-evidence-challenge',
      claim_id: input.claim_id,
      slot_id: input.slot_id,
      result_id: input.result_id,
      evidence_ref: input.evidence_ref,
      evidence_sha256: input.evidence_sha256,
      reason: input.reason,
      evidence_refs: [input.evidence_ref],
    },
    preconditions: ['current-task-is-active', 'evidence-admitted'],
    evidence_refs: [input.evidence_ref],
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function createEvidenceChallengeDismissalProposal(
  current: CanonicalCurrentTask,
  input: {
    challenge_id: string;
    evidence_ref: string;
    evidence_sha256: string;
    reason: string;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'review-change',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state', action: 'dismiss-evidence-challenge', challenge_id: input.challenge_id,
      evidence_ref: input.evidence_ref, evidence_sha256: input.evidence_sha256,
      reason: input.reason, evidence_refs: [input.evidence_ref],
    },
    preconditions: ['current-task-is-active', 'evidence-admitted'],
    evidence_refs: [input.evidence_ref],
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function createPrepareTaskResumeReviewProposal(
  current: CanonicalCurrentTask,
  input: {
    mode: 'default';
    evidence_refs: string[];
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: input.mode,
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state',
      action: 'clear-resume-review-gate',
      evidence_refs: input.evidence_refs,
    },
    preconditions: ['current-task-is-active', 'resume-review-complete'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function createPrepareTaskClaimEvidenceMigrationProposal(
  current: CanonicalCurrentTask,
  input: {
    claim_evidence: ClaimEvidenceRecord[];
    evidence_refs: string[];
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  const proposalEvidenceRefs = [...new Set([
    ...input.evidence_refs,
    ...claimEvidenceRefs(input.claim_evidence),
  ])];
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state',
      action: 'migrate-claim-evidence',
      claim_evidence: input.claim_evidence,
      evidence_refs: input.evidence_refs,
    },
    preconditions: ['current-task-is-active', 'legacy-claim-evidence-state', 'acceptance-bearing-plan'],
    evidence_refs: proposalEvidenceRefs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function createPrepareTaskDraftProposal(
  current: CanonicalCurrentTask,
  input: {
    action: 'create-draft' | 'update-draft';
    task_id: string;
    task_slug: string;
    document_id?: string;
    task_title: string;
    task_basis: TaskBasis;
    draft_definition: DraftTaskDefinition;
    active_step_id: string;
    evidence_refs: string[];
    claim_evidence?: ClaimEvidenceRecord[];
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  const documentId = input.document_id ?? generatedDraftDocumentId(input, current.sourceTuple.revision);
  const proposalEvidenceRefs = [...new Set([
    ...input.evidence_refs,
    ...claimEvidenceRefs(input.claim_evidence ?? []),
  ])];
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state',
      action: input.action,
      task_id: input.task_id,
      task_slug: input.task_slug,
      document_id: documentId,
      task_title: input.task_title,
      task_basis: input.task_basis,
      draft_definition: input.draft_definition,
      active_step_id: input.active_step_id,
      evidence_refs: input.evidence_refs,
      ...(input.claim_evidence === undefined ? {} : { claim_evidence: input.claim_evidence }),
    },
    preconditions: input.action === 'create-draft'
      ? ['current-task-is-closed-and-archived', 'next-unused-task-identity', 'closed-draft-definition']
      : ['current-task-is-draft-and-active', 'same-task-identity', 'closed-draft-definition'],
    evidence_refs: proposalEvidenceRefs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath, taskBasisRelativePath(current.relativePath, input.task_id)],
  });
}

export const createPrepareTaskCreateDraftProposal = createPrepareTaskDraftProposal;

export function createPrepareTaskUpdateDraftProposal(
  current: CanonicalCurrentTask,
  input: Omit<Parameters<typeof createPrepareTaskDraftProposal>[1], 'action'>,
): RuntimeProposal {
  return createPrepareTaskDraftProposal(current, { ...input, action: 'update-draft' });
}

export function createPrepareTaskConfirmProposal(
  current: CanonicalCurrentTask,
  input: {
    task_id: string;
    task_slug: string;
    document_id: string;
    draft_revision: string;
    evidence_refs: string[];
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: 'confirm',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'task-state',
      action: 'confirm-draft',
      task_id: input.task_id,
      task_slug: input.task_slug,
      document_id: input.document_id,
      draft_revision: input.draft_revision,
      evidence_refs: input.evidence_refs,
    },
    preconditions: ['current-task-is-draft-and-active', 'exact-draft-revision', 'explicit-confirmation-authority', 'no-unresolved-decisions'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function createPrepareTaskReplanProposal(
  current: CanonicalCurrentTask,
  input: {
    delta: Extract<TaskStateDelta, { action: ReplanTaskStateAction }>;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): RuntimeProposal {
  const proposalEvidenceRefs = [...new Set([
    ...input.evidence_refs,
    ...('claim_evidence' in input.delta && input.delta.claim_evidence !== undefined
      ? claimEvidenceRefs(input.delta.claim_evidence)
      : []),
  ])];
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'task-state-transaction',
    caller: 'prepare-task',
    mode: 'replan',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: input.delta,
    preconditions: input.delta.action === 'mark-replan-blocked'
      ? ['current-task-is-active', 'replan-blocker-evidence-complete']
      : input.delta.action === 'clear-replan-block'
        ? ['blocked-by-replan', 'new-authoritative-evidence']
        : ['superseded-task', 'closed-replacement-definition', 'same-task-identity'],
    evidence_refs: proposalEvidenceRefs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: input.delta.action === 'commit-replan'
      ? [current.relativePath, taskBasisRelativePath(current.relativePath, current.runtimeState.task_id)]
      : [current.relativePath],
  });
}

export function createLifecycleProposal(
  current: CanonicalCurrentTask,
  input: {
    mode: LifecycleMode;
    delta: LifecycleDelta;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): LifecycleProposal {
  let artifactKind: Extract<TaskArtifactKind, 'paused' | 'interrupted'> | null = null;
  if (input.mode === 'pause') artifactKind = 'paused';
  else if (input.mode === 'interrupt') artifactKind = 'interrupted';
  else if (input.mode === 'resume-paused' || input.mode === 'resume-interrupted') {
    if (!('artifact_kind' in input.delta)) throw new VNextRuntimeError('RUNTIME_SCHEMA_INVALID', 'resume lifecycle proposal is missing artifact_kind.');
    artifactKind = input.delta.artifact_kind;
  }
  const requestedWriteTargets = artifactKind === null
    ? [current.relativePath]
    : [current.relativePath, input.mode === 'resume-paused' || input.mode === 'resume-interrupted'
      ? 'recovery_package_path' in input.delta ? input.delta.recovery_package_path : ''
      : getTaskArtifactPath(current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind)];
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'lifecycle-transaction',
    caller: 'task-lifecycle',
    mode: input.mode,
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: input.delta,
    preconditions: input.mode === 'supersede'
      ? ['current-task-is-active', 'supersede-evidence-present']
      : input.mode === 'pause' || input.mode === 'interrupt'
        ? ['current-task-is-active', 'lifecycle-transition-legal', 'recovery-evidence-complete']
        : ['explicit-recovery-package', 'resume-review-complete', 'lifecycle-transition-legal'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: requestedWriteTargets,
  }) as LifecycleProposal;
}

export function createFindingQueueProposal(
  current: CanonicalCurrentTask,
  input: {
    mode: 'repair';
    delta: FindingQueueDelta;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): RuntimeProposal {
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'finding-queue-transaction',
    caller: 'execute-step',
    mode: input.mode,
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: input.delta,
    preconditions: ['current-task-is-active', 'finding-admitted', 'repair-budget-available'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
  });
}

export function createArchiveProposal(
  current: CanonicalCurrentTask,
  input: {
    delta: ArchiveDelta;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): ArchiveProposal {
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'archive-transaction',
    caller: 'close-task',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: input.delta,
    preconditions: ['current-task-is-active', 'closure-eligibility-complete', 'archive-path-verified'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath, getTaskArtifactPath(current.runtimeState.task_id, current.runtimeState.task_slug, 'archive')],
  }) as ArchiveProposal;
}

export const createArchiveTransactionProposal = createArchiveProposal;

export function createProjectStatusProposal(
  current: CanonicalCurrentTask,
  input: {
    delta: ProjectStatusDelta;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): ProjectStatusProposal {
  const statusPath = path.posix.join(path.posix.dirname(current.relativePath), 'STATUS.md');
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'project-status-transaction',
    caller: 'close-task',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: input.delta,
    preconditions: ['archive-committed', 'status-baseline-present'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [statusPath],
  }) as ProjectStatusProposal;
}

export const createProjectStatusTransactionProposal = createProjectStatusProposal;

export function createLessonRecordProposal(
  current: CanonicalCurrentTask,
  input: {
    delta: LessonRecordDelta;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): LessonRecordProposal {
  const lessonsPath = path.posix.join(path.posix.dirname(current.relativePath), 'LESSONS.md');
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'lesson-record-transaction',
    caller: 'close-task',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: input.delta,
    preconditions: ['archive-committed', 'lesson-admission-is-admit', 'lesson-deduplication-complete'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [lessonsPath],
  }) as LessonRecordProposal;
}

export const createLessonRecordTransactionProposal = createLessonRecordProposal;

export function knowledgeProvenanceFromArchive(root: string, current: CanonicalCurrentTask, evidence_refs: string[]): KnowledgeProvenance {
  const { receipt } = matchingArchiveReceipt(root, current);
  return {
    task_id: receipt.taskId,
    task_slug: receipt.taskSlug,
    document_id: receipt.documentId,
    archive_path: receipt.relativePath,
    archive_revision: receipt.revision,
    source_revision: receipt.sourceRevision,
    evidence_refs: [...evidence_refs],
  };
}

function createKnowledgeProposal(
  current: CanonicalCurrentTask,
  input: {
    admission: KnowledgeAdmissionRecord;
    provenance: KnowledgeProvenance;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
  knowledgeKind: 'contract' | 'decision',
): KnowledgeProposal {
  const targetPath = path.posix.join(path.posix.dirname(current.relativePath), knowledgeKind === 'contract' ? 'CONTRACTS.md' : 'DECISIONS.md');
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: knowledgeKind === 'contract' ? 'contract-candidate-commit' : 'decision-record-transaction',
    caller: 'close-task',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: {
      kind: 'knowledge',
      action: 'promote',
      knowledge_kind: knowledgeKind,
      admission: input.admission,
      provenance: input.provenance,
      evidence_refs: input.evidence_refs,
    },
    preconditions: ['archive-committed', 'knowledge-admission-complete', 'canonical-knowledge-target'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [targetPath],
  }) as KnowledgeProposal;
}

export function createContractCandidateProposal(
  current: CanonicalCurrentTask,
  input: {
    admission: KnowledgeAdmissionRecord;
    provenance: KnowledgeProvenance;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): ContractCandidateProposal {
  return createKnowledgeProposal(current, input, 'contract') as ContractCandidateProposal;
}

export const createContractCandidateCommitProposal = createContractCandidateProposal;

export function createDecisionRecordProposal(
  current: CanonicalCurrentTask,
  input: {
    admission: KnowledgeAdmissionRecord;
    provenance: KnowledgeProvenance;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): DecisionRecordProposal {
  return createKnowledgeProposal(current, input, 'decision') as DecisionRecordProposal;
}

export const createDecisionRecordTransactionProposal = createDecisionRecordProposal;

export function createInboxRecordProposal(
  current: CanonicalCurrentTask,
  input: {
    delta: InboxRecordDelta;
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
    evidence_refs: string[];
  },
): InboxRecordProposal {
  return validateRuntimeProposal({
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: 'inbox-record-transaction',
    caller: 'capture-work-item',
    mode: 'default',
    source_tuple: current.sourceTuple,
    authority_evidence: input.authority_evidence,
    semantic_delta: input.delta,
    preconditions: ['current-task-is-active', 'relation-proven-unrelated', 'duplicate-check-clear', 'owner-route-resolved'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [input.delta.target_path],
  }) as InboxRecordProposal;
}

export const createInboxRecordTransactionProposal = createInboxRecordProposal;

function rootForCurrentTask(current: CanonicalCurrentTask): string {
  const segments = current.relativePath.split('/').filter(Boolean);
  return path.resolve(current.filePath, ...segments.map(() => '..'));
}

function previewDeltaInput(input: unknown): { delta: ArchiveDelta | null; error?: string } {
  try {
    const record = expectRecord(input, 'close-task preview input');
    const candidate = isRecord(record.delta) ? record.delta : record;
    const delta = validateArchiveDelta(candidate);
    return { delta };
  } catch (error) {
    return { delta: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function previewCloseTaskForCurrent(current: CanonicalCurrentTask, input: unknown, root?: string): CloseTaskPreview {
  const parsed = previewDeltaInput(input);
  let archivePath = 'TASKS/TASK-unknown-unknown.md';
  try {
    archivePath = getTaskArtifactPath(current.runtimeState.task_id, current.runtimeState.task_slug, 'archive');
  } catch {
    // The canonical current-task reader normally prevents this; keep preview read-only if it is malformed.
  }
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  const base: CloseTaskPreview = {
    status: 'blocked',
    task_identity: { task_id: identity.id, task_slug: identity.slug, document_id: String(current.frontmatter.document_id) },
    source_tuple: current.sourceTuple,
    archive_path: archivePath,
    closure_eligibility: { eligible: false, blockers: parsed.error ? [parsed.error] : [] },
    delivery_summary: null,
    lesson_admission: null,
    knowledge_admissions: emptyKnowledgeAdmissionBundle(),
    planned_operations: [],
    governed_mutation_count: 0,
  };
  if (!parsed.delta) return base;
  base.delivery_summary = parsed.delta.delivery_summary;
  base.lesson_admission = parsed.delta.lesson_admission;
  base.knowledge_admissions = parsed.delta.knowledge_admissions ?? emptyKnowledgeAdmissionBundle();
  const resolvedRoot = root ?? rootForCurrentTask(current);
  if (current.runtimeState.workflow_status === 'closed' && current.runtimeState.lifecycle_state === 'archived') {
    try {
      const { audit } = matchingArchiveReceipt(resolvedRoot, current);
      if (digest(parsed.delta) !== audit.closure_delta_digest) fail('ARCHIVE_PROVENANCE_MISMATCH', 'preview closure evidence does not match the committed archive receipt.');
      if (parsed.delta.lesson_admission.decision !== audit.lesson_admission.decision || parsed.delta.lesson_admission.candidate_refs.join('|') !== audit.lesson_admission.candidate_refs.join('|') || parsed.delta.lesson_admission.evidence_refs.join('|') !== audit.lesson_admission.evidence_refs.join('|')) {
        fail('ARCHIVE_PROVENANCE_MISMATCH', 'preview lesson admission does not match the committed archive receipt.');
      }
      if (digest(parsed.delta.knowledge_admissions ?? emptyKnowledgeAdmissionBundle()) !== digest(audit.knowledge_admissions)) {
        fail('ARCHIVE_PROVENANCE_MISMATCH', 'preview knowledge admission does not match the committed archive receipt.');
      }
      base.status = 'reconciliation';
      base.closure_eligibility = { eligible: true, blockers: [] };
      base.planned_operations = [
        ...(parsed.delta.knowledge_admissions?.contracts.some(item => ['admit', 'merge', 'supersede'].includes(item.disposition)) ? ['contract-candidate-commit' as const] : []),
        ...(parsed.delta.knowledge_admissions?.decisions.some(item => ['admit', 'merge', 'supersede'].includes(item.disposition)) ? ['decision-record-transaction' as const] : []),
        ...(parsed.delta.lesson_admission.decision === 'admit' ? ['lesson-record-transaction' as const] : []),
        'project-status-transaction',
      ];
      return base;
    } catch (error) {
      base.closure_eligibility.blockers.push(error instanceof Error ? error.message : String(error));
      return base;
    }
  }
  const archiveExists = fs.existsSync(archivePathForTask(resolvedRoot, current).filePath);
  const blockers = closureEligibilityBlockers(root, current, parsed.delta, archiveExists);
  base.closure_eligibility = { eligible: blockers.length === 0, blockers };
  if (blockers.length === 0) {
    base.status = 'eligible';
    base.planned_operations = [
      'archive-transaction',
      ...(parsed.delta.knowledge_admissions?.contracts.some(item => ['admit', 'merge', 'supersede'].includes(item.disposition)) ? ['contract-candidate-commit' as const] : []),
      ...(parsed.delta.knowledge_admissions?.decisions.some(item => ['admit', 'merge', 'supersede'].includes(item.disposition)) ? ['decision-record-transaction' as const] : []),
      ...(parsed.delta.lesson_admission.decision === 'admit' ? ['lesson-record-transaction' as const] : []),
      'project-status-transaction',
    ];
  }
  return base;
}

export function previewCloseTask(current: CanonicalCurrentTask, input: unknown): CloseTaskPreview;
export function previewCloseTask(root: string, input: unknown): CloseTaskPreview;
export function previewCloseTask(currentOrRoot: CanonicalCurrentTask | string, input: unknown): CloseTaskPreview {
  if (typeof currentOrRoot === 'string') return previewCloseTaskForCurrent(readCanonicalCurrentTask(currentOrRoot), input, path.resolve(currentOrRoot));
  return previewCloseTaskForCurrent(currentOrRoot, input);
}

export const createCloseTaskPreview = previewCloseTask;

export type VNextRuntimeCliArguments = {
  command: 'validate' | 'validate-contract' | 'apply' | 'scope-check';
  root: string;
  proposalFile?: string;
  dryRun: boolean;
  changedPaths: string[];
  pathsFile?: string;
  pathsStdin: boolean;
  persistentTestPaths: string[];
  persistentTestPathsFile?: string;
  conditionalAuthorizationsFile?: string;
  transformationKind: MutationTransformationKind;
  commandAuditFile?: string;
  commandAuditStdin: boolean;
  summary: boolean;
  deep: boolean;
};

export function parseCli(argv: string[]): VNextRuntimeCliArguments {
  const [command = 'validate', ...rest] = argv;
  if (command !== 'validate' && command !== 'validate-contract' && command !== 'apply' && command !== 'scope-check') throw new Error('Usage: vnext-runtime <validate-contract|validate|apply|scope-check> --root <path> [--proposal-file <json>] [--path <repo-relative>] [--paths-file <path>] [--paths-stdin] [--persistent-test-path <repo-relative>] [--persistent-test-paths-file <path>] [--command-audit-file <json>] [--command-audit-stdin] [--conditional-authorizations-file <json>] [--transformation-kind <localized|inherently-broad>] [--summary] [--deep] [--dry-run]');
  let root = process.cwd();
  let proposalFile: string | undefined;
  let dryRun = false;
  const changedPaths: string[] = [];
  let pathsFile: string | undefined;
  let pathsStdin = false;
  const persistentTestPaths: string[] = [];
  let persistentTestPathsFile: string | undefined;
  let conditionalAuthorizationsFile: string | undefined;
  let transformationKind: MutationTransformationKind = 'localized';
  let commandAuditFile: string | undefined;
  let commandAuditStdin = false;
  let summary = false;
  let deep = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--proposal' || arg === '--proposal-file') proposalFile = rest[++index];
    else if (arg === '--path') changedPaths.push(rest[++index] ?? '');
    else if (arg === '--paths-file') pathsFile = rest[++index];
    else if (arg === '--paths-stdin') pathsStdin = true;
    else if (arg === '--persistent-test-path') persistentTestPaths.push(rest[++index] ?? '');
    else if (arg === '--persistent-test-paths-file') persistentTestPathsFile = rest[++index];
    else if (arg === '--command-audit-file') commandAuditFile = rest[++index];
    else if (arg === '--command-audit-stdin') commandAuditStdin = true;
    else if (arg === '--summary' && command === 'validate') summary = true;
    else if (arg === '--deep' && command === 'validate') deep = true;
    else if (arg === '--conditional-authorizations-file') conditionalAuthorizationsFile = rest[++index];
    else if (arg === '--transformation-kind') {
      const value = rest[++index];
      if (value !== 'localized' && value !== 'inherently-broad') throw new Error('--transformation-kind must be localized or inherently-broad.');
      transformationKind = value;
    }
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, root, proposalFile, dryRun, changedPaths, pathsFile, pathsStdin, persistentTestPaths, persistentTestPathsFile, conditionalAuthorizationsFile, transformationKind, commandAuditFile, commandAuditStdin, summary, deep };
}

export function resolveExternalProposalFile(root: string, proposalFile: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedProposal = path.resolve(proposalFile);
  const relative = path.relative(resolvedRoot, resolvedProposal);
  const insideProject = relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  if (insideProject) {
    fail('PROPOSAL_FILE_INSIDE_PROJECT', 'proposal/helper files must not be created inside the target project; send the proposal on stdin or use an OS-temporary path outside the project.');
  }
  return resolvedProposal;
}

function readCliStringList(filePath: string, label: string): string[] {
  const content = fs.readFileSync(path.resolve(filePath), 'utf8');
  if (content.trimStart().startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`${label} must be valid JSON or newline-delimited text: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error(`${label} JSON form must be an array of strings.`);
    return parsed as string[];
  }
  return content.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
}

function readCliConditionalAuthorizations(filePath: string): ConditionalScopeAuthorization[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch (error) {
    throw new Error(`conditional authorizations file must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsed as ConditionalScopeAuthorization[];
}

function readCliCommandAudit(args: VNextRuntimeCliArguments): CommandMutationAuditInput {
  if (args.commandAuditFile && args.commandAuditStdin) throw new Error('--command-audit-file and --command-audit-stdin are mutually exclusive.');
  if (args.changedPaths.length > 0 || args.pathsFile || args.pathsStdin || args.persistentTestPaths.length > 0 || args.persistentTestPathsFile) {
    throw new Error('command audit input cannot be combined with ordinary path or persistent-test scope input.');
  }
  const content = args.commandAuditFile
    ? fs.readFileSync(path.resolve(args.commandAuditFile), 'utf8')
    : (() => {
      if (process.stdin.isTTY) throw new Error('--command-audit-stdin requires a JSON command audit on stdin.');
      const input = process.stdin.read();
      if (typeof input !== 'string' && !Buffer.isBuffer(input)) throw new Error('--command-audit-stdin did not receive JSON.');
      return typeof input === 'string' ? input : input.toString('utf8');
    })();
  try {
    return JSON.parse(content) as CommandMutationAuditInput;
  } catch (error) {
    throw new Error(`command audit input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readScopeCheckInput(args: VNextRuntimeCliArguments): MutationScopeEvaluationInput {
  const changedPaths = [...args.changedPaths];
  if (args.pathsFile) changedPaths.push(...readCliStringList(args.pathsFile, '--paths-file'));
  if (args.pathsStdin) {
    if (process.stdin.isTTY) throw new Error('--paths-stdin requires newline-delimited paths on stdin.');
    const stdinContent = process.stdin.read();
    if (typeof stdinContent !== 'string' && !Buffer.isBuffer(stdinContent)) throw new Error('--paths-stdin did not receive newline-delimited paths on stdin.');
    const text = typeof stdinContent === 'string' ? stdinContent : stdinContent.toString('utf8');
    changedPaths.push(...text.split(/\r?\n/u).map((line: string) => line.trim()).filter(Boolean));
  }
  const persistentTestPaths = [...args.persistentTestPaths];
  if (args.persistentTestPathsFile) {
    persistentTestPaths.push(...readCliStringList(args.persistentTestPathsFile, '--persistent-test-paths-file'));
  }
  return {
    changed_paths: changedPaths,
    ...(args.conditionalAuthorizationsFile
      ? { conditional_authorizations: readCliConditionalAuthorizations(args.conditionalAuthorizationsFile) }
      : {}),
    ...(persistentTestPaths.length > 0 ? { persistent_test_paths: persistentTestPaths } : {}),
    transformation_kind: args.transformationKind,
  };
}

function validateInstalledRuntimeForCli(root: string): void {
  const runtimePackagePath = path.join(path.resolve(root), ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'), 'package.json');
  if (fs.existsSync(runtimePackagePath)) {
    validateVNextRuntimeContract(root, true);
  }
}

function requireBootstrappedProject(root: string): void {
  const profilePath = getWorkflowProfilePath(root);
  if (!fs.existsSync(profilePath)) {
    fail('BOOTSTRAP_REQUIRED', 'Project governance is not bootstrapped. Invoke the `bootstrap-project` Agent Skill before using daily Runtime entries.');
  }
  let profile: AnyRecord;
  try {
    profile = loadProfile(profilePath);
  } catch (error) {
    fail('BOOTSTRAP_REQUIRED', 'Project governance profile is unavailable or invalid; invoke the `bootstrap-project` Agent Skill before using daily Runtime entries.');
  }
  const currentTaskPath = getWorkflowDocPath(root, profile, 'CURRENT_TASK.md');
  if (!fs.existsSync(currentTaskPath)) {
    fail('BOOTSTRAP_REQUIRED', 'Project governance is not bootstrapped. Invoke the `bootstrap-project` Agent Skill before using daily Runtime entries.');
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    validateRuntimeEnvironment();
    const args = parseCli(argv);
    if (args.command === 'validate-contract') {
      validateInstalledRuntimeForCli(args.root);
      console.log(JSON.stringify(validateVNextRuntimeContract(args.root), null, 2));
    } else if (args.command === 'validate') {
      validateInstalledRuntimeForCli(args.root);
      requireBootstrappedProject(args.root);
      const current = readCanonicalCurrentTask(args.root);
      const state = current.runtimeState;
      if (state.business_evidence_version === 1) {
        const actualPlanRevision = assertEvidencePlan(readDraftDefinitionFromBody(current.body), state.claim_evidence ?? []);
        if (state.evidence_plan_revision !== actualPlanRevision) {
          fail('CLAIM_EVIDENCE_STALE', 'canonical evidence plan revision does not match its definitions.');
        }
      }
      const sections = resolveReplanSectionRanges(current.body);
      const sectionText = (key: 'background_context' | 'affected_contracts') => {
        const section = sections[key];
        return section ? current.body.slice(section.contentStart, section.contentEnd).trim() : null;
      };
      const documentContext = { project_documents: readProjectDocuments(sectionText('background_context') ?? ''), affected_contracts: sectionText('affected_contracts') };
      const taskStore = TaskStore.forCurrent(args.root, current);
      const storageValidation = args.deep
        ? taskStore.deepValidate()
        : taskStore.validateCurrentAggregate(current as unknown as import('./task-store').TaskStoreCurrent);
      const storageInvalid = storageValidation.status === 'invalid';
      const output = args.summary ? {
        status: storageInvalid ? 'blocked' : 'success', source_tuple: current.sourceTuple, package_version: VNEXT_RUNTIME_PACKAGE_VERSION,
        validation_scope: args.deep ? 'aggregate-and-full-history' : 'current-aggregate',
        storage_validation: storageValidation,
        summary: { ...documentContext, task_id: state.task_id, workflow_status: state.workflow_status, lifecycle_state: state.lifecycle_state,
          active_step_id: state.active_step_id, active_step_status: state.active_step_status,
          pending_review_verdict: state.pending_review_result?.verdict ?? null,
          review_target_revision: state.review_coverage?.target.revision ?? null,
          pending_review_paths: state.review_coverage?.pending_paths ?? [],
          evidence_plan_revision: state.evidence_plan_revision ?? null,
          task_evolution_version: state.task_evolution_version ?? null,
          preservation_initialization_required: state.task_evolution_version !== 2,
          pending_replan_candidates: pendingCorrectionCandidates(current),
          carried_evidence_slots: (state.evidence_carry_forward ?? []).map(item => ({ claim_id: item.claim_id, slot_id: item.slot_id, old_result_id: item.result_id })),
          unresolved_evidence_challenges: (state.evidence_challenges ?? []).filter(item => item.status !== 'resolved').map(item => ({ challenge_id: item.challenge_id, claim_id: item.claim_id, slot_id: item.slot_id, result_id: item.result_id, correction_step_id: item.correction_step_id })) },
      } : { status: 'success', source_tuple: current.sourceTuple, runtime_state: state, ...documentContext, ...(args.deep ? { validation_scope: 'aggregate-and-full-history', storage_validation: storageValidation } : {}) };
      console.log(JSON.stringify(output, null, 2));
      if (storageInvalid) return 2;
    } else if (args.command === 'scope-check') {
      validateInstalledRuntimeForCli(args.root);
      requireBootstrappedProject(args.root);
      const current = readCanonicalCurrentTask(args.root);
      const scope = parseMutationScope(current.body, current.sourceTuple.revision);
      const result = args.commandAuditFile || args.commandAuditStdin
        ? auditCommandMutation(scope, readCliCommandAudit(args))
        : evaluateMutationScope(scope, readScopeCheckInput(args));
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked') return 2;
    } else {
      validateInstalledRuntimeForCli(args.root);
      requireBootstrappedProject(args.root);
      const proposalText = args.proposalFile
        ? fs.readFileSync(resolveExternalProposalFile(args.root, args.proposalFile), 'utf8')
        : (!process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '');
      if (!proposalText.trim()) throw new Error('apply requires a JSON proposal on stdin or via --proposal-file <json-file>.');
      const proposal = JSON.parse(proposalText) as unknown;
      const result = applyVNextRuntimeProposal(args.root, proposal, { dryRun: args.dryRun });
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked' || result.status === 'conflict') return 2;
    }
    return 0;
  } catch (error) {
    if (error instanceof MutationScopeError) {
      console.error(`${error.code}: ${error.message}`);
      return error.code === 'MUTATION_SCOPE_BLOCKED' ? 2 : 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
