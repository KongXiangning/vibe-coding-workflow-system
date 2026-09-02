
/**
 * Pure-vNext state-changing Runtime slice.
 *
 * Phase 2 binds the execute-step task/finding slice plus lifecycle, replan,
 * and close-task transactions. The Runtime accepts typed proposals,
 * validates the canonical source tuple and exact write targets, renders
 * canonical Markdown/YAML in memory, commits an atomic file set, and reads
 * the result back before reporting success.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseDocument, stringify } from 'yaml';
import {
  executeWrites,
  getWorkflowDocPath,
  getWorkflowProfilePath,
  loadProfile,
} from './runtime-io';
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
  evaluateMutationScope,
  MutationScopeError,
  parseMutationScope,
  type ConditionalScopeAuthorization,
  type MutationScopeEvaluationInput,
  type MutationTransformationKind,
} from './mutation-scope';
import {
  resolveTaskStep,
  TaskStepDefinitionError,
  type TaskStepCheckpointPolicy,
  type TaskStepResolution,
} from './task-steps';
import {
  BOOTSTRAP_MODES,
  BOOTSTRAP_OPERATION_KINDS,
} from './bootstrap';

export * from './mutation-scope';

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
export const VNEXT_RUNTIME_PACKAGE_VERSION = '0.14.5';

export const RUNTIME_OPERATION_KINDS = [
  'task-state-transaction',
  'finding-queue-transaction',
  'lifecycle-transaction',
  'project-status-transaction',
  'archive-transaction',
  'lesson-record-transaction',
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

export const REVIEW_CYCLE_PHASES = ['discovery', 'verification'] as const;
export type ReviewCyclePhase = (typeof REVIEW_CYCLE_PHASES)[number];

export const STEP_STATUSES = ['ready', 'in-progress', 'completed', 'blocked'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const FINDING_STATUSES = ['admitted', 'in-progress', 'resolved', 'deferred', 'rejected'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const REPLAN_TASK_STATE_ACTIONS = ['mark-replan-blocked', 'clear-replan-block', 'commit-replan'] as const;
export type ReplanTaskStateAction = (typeof REPLAN_TASK_STATE_ACTIONS)[number];

export const DRAFT_TASK_STATE_ACTIONS = ['create-draft', 'update-draft', 'confirm-draft'] as const;
export type DraftTaskStateAction = (typeof DRAFT_TASK_STATE_ACTIONS)[number];

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

export const REVIEW_TARGET_VERIFICATION_STATES = ['verified', 'harness-supplied'] as const;
export type ReviewTargetVerificationState = (typeof REVIEW_TARGET_VERIFICATION_STATES)[number];

const DOCUMENT_ID_PATTERN = /^doc-[a-f0-9]{24}$/;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const FINGERPRINT_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TEXT_LENGTH = 4000;
const MAX_EVIDENCE_REFS = 32;
const MAX_FINDINGS = 256;
const MAX_APPLIED_PROPOSALS = 256;
const MAX_EXECUTION_LOG = 256;
const MAX_REPLAN_SECTION_CONTENT_LENGTH = 32768;
const MAX_REPAIR_ROUNDS = 3;
const MAX_REPAIR_ATTEMPTS = 2;
const CURRENT_TASK_RELATIVE_FALLBACK = 'docs/workflow/CURRENT_TASK.md';

type AnyRecord = Record<string, unknown>;

export type AuthorityEvidence = {
  kind: 'active-task-owner' | 'scope-admission' | 'finding-admission' | 'evidence-admission' | 'dangerous-operation' | 'resume-review' | 'user-confirmation' | 'authorized-caller';
  source: string;
  subject: string;
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

export type DraftTaskIdentity = {
  task_id: string;
  task_slug: string;
  document_id: string;
  task_title: string;
};

export type StepReviewReceipt = {
  cycle_id: string;
  cycle_phase: ReviewCyclePhase;
  diff_target: string;
  diff_target_verification: ReviewTargetVerificationState;
  verdict: 'clean';
  admitted_fingerprints: string[];
  evidence_refs: string[];
};

export type TaskStepProgressDelta = {
  kind: 'task-state';
  action: 'step-progress';
  step_id: string;
  status: StepStatus;
  evidence_refs: string[];
  note?: string;
  repair_fingerprint?: string;
  diff_target?: string;
  review_receipt?: StepReviewReceipt;
};

export type TaskStateDelta =
  | TaskStepProgressDelta
  | {
      kind: 'task-state';
      action: 'create-draft' | 'update-draft';
      task_id: string;
      task_slug: string;
      document_id: string;
      task_title: string;
      draft_definition: DraftTaskDefinition;
      active_step_id: string;
      evidence_refs: string[];
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
      replacement_definition: ReplanReplacementDefinition;
      active_step_id: string;
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

export type RuntimeSemanticDelta = TaskStateDelta | FindingQueueDelta | LifecycleDelta | ArchiveDelta | ProjectStatusDelta | LessonRecordDelta;

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
  diff_target?: string;
  checkpoint?: TaskStepCheckpointPolicy;
  advancement?: StepAdvancementOutcome;
  next_step_id?: string | null;
  review_receipt?: StepReviewReceipt;
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
  draft_revision?: string;
  recorded_at: string;
};

export type ExecutionLogEntry = StepExecutionLogEntry | DraftAuditLogEntry | ReplanAuditLogEntry | ArchiveAuditLogEntry;
type RuntimeAuditLogEntry = DraftAuditLogEntry | ReplanAuditLogEntry | ArchiveAuditLogEntry;

export type RuntimeProposal = {
  schema_version: typeof VNEXT_RUNTIME_SCHEMA_VERSION;
  kind: typeof VNEXT_RUNTIME_PROPOSAL_KIND;
  operation_kind: RuntimeOperationKind;
  caller: 'execute-step' | 'prepare-task' | 'task-lifecycle' | 'close-task';
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

export type RuntimeState = {
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
  expectStringArray(assetBoundary.allowed_roots, 'Runtime contract.bootstrap_project.asset_boundary.allowed_roots');
  expectStringArray(assetBoundary.forbidden_targets, 'Runtime contract.bootstrap_project.asset_boundary.forbidden_targets');
  expectStringArray(assetBoundary.generated_categories, 'Runtime contract.bootstrap_project.asset_boundary.generated_categories');

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
  if (recovery.marker !== '.workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json' || recovery.interrupted !== 'fail-closed-explicit-recovery' || recovery.rollback !== 'verify-pre-bootstrap-snapshot-before-marker-clear') fail('RUNTIME_CONTRACT_INVALID', 'bootstrap recovery must use the explicit interruption marker and verified rollback boundary.');
  const readBack = expectRecord(bootstrap.read_back, 'Runtime contract.bootstrap_project.read_back');
  expectExactKeys(readBack, ['required'], 'Runtime contract.bootstrap_project.read_back');
  expectSetEqual(expectStringArray(readBack.required, 'Runtime contract.bootstrap_project.read_back.required'), ['asset-checksums', 'project-identity', 'runtime-contract', 'canonical-CURRENT_TASK', 'host-isolation'], 'bootstrap read-back evidence');
  return bound;
}

export function validateVNextRuntimeContract(root: string, requireDependencies = false): VNextRuntimeContractValidationResult {
  const filePath = path.join(path.resolve(root), ...VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH.split('/'));
  const contract = parseYamlMappingFile(filePath);
  expectExactKeys(contract, ['schema_version', 'kind', 'phase', 'runtime_distribution', 'proposal', 'mutation_scope', 'canonical_current_task', 'concurrency', 'operations', 'unbound_operations', 'bootstrap_project'], 'vNext Runtime contract');
  if (contract.schema_version !== 1 || contract.kind !== 'vnext-runtime-contract' || contract.phase !== 'Phase 2') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must declare schema_version=1, kind=vnext-runtime-contract, phase=Phase 2.');
  }
  const runtimeDistribution = validateRuntimeDistributionContract(contract.runtime_distribution);
  const distributionIdentity = validateVNextRuntimeDistribution(root, runtimeDistribution, requireDependencies);
  const proposal = expectRecord(contract.proposal, 'Runtime contract.proposal');
  expectExactKeys(proposal, ['schema_version', 'kind', 'caller', 'operation_kinds', 'source_tuple', 'required_envelope', 'finding_queue_admission', 'finding_queue_repair', 'task_state', 'prepare_task', 'lifecycle', 'close_task'], 'Runtime contract.proposal');
  if (proposal.schema_version !== 1 || proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND) fail('RUNTIME_CONTRACT_INVALID', 'Runtime proposal contract has an invalid envelope marker.');
  expectSetEqual(expectStringArray(proposal.caller, 'Runtime contract.proposal.caller'), ['execute-step', 'prepare-task', 'task-lifecycle', 'close-task'], 'Runtime contract proposal callers');
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
  expectExactKeys(taskStateContract, ['actions', 'step_progress', 'advancement_outcomes', 'review_receipt', 'draft', 'confirm'], 'Runtime contract.proposal.task_state');
  expectSetEqual(
    expectStringArray(taskStateContract.actions, 'Runtime contract.proposal.task_state.actions'),
    ['step-progress', 'clear-resume-review-gate', ...DRAFT_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS],
    'Runtime contract task-state actions',
  );
  const stepProgressContract = expectRecord(taskStateContract.step_progress, 'Runtime contract.proposal.task_state.step_progress');
  expectExactKeys(stepProgressContract, ['required', 'optional'], 'Runtime contract.proposal.task_state.step_progress');
  expectSetEqual(
    expectStringArray(stepProgressContract.required, 'Runtime contract.proposal.task_state.step_progress.required'),
    ['step_id', 'status', 'evidence_refs'],
    'Runtime contract task-state required fields',
  );
  expectSetEqual(
    expectStringArray(stepProgressContract.optional, 'Runtime contract.proposal.task_state.step_progress.optional', true),
    ['note', 'repair_fingerprint', 'diff_target', 'review_receipt'],
    'Runtime contract task-state optional fields',
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
    ['cycle_id', 'cycle_phase', 'diff_target', 'diff_target_verification', 'verdict', 'admitted_fingerprints', 'evidence_refs'],
    'Runtime contract review receipt required fields',
  );
  if (reviewReceiptContract.verdict !== 'clean') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract review receipt verdict must remain clean.');
  expectSetEqual(
    expectStringArray(reviewReceiptContract.cycle_phase, 'Runtime contract.proposal.task_state.review_receipt.cycle_phase'),
    [...REVIEW_CYCLE_PHASES],
    'Runtime contract review receipt cycle phases',
  );
  expectSetEqual(
    expectStringArray(reviewReceiptContract.target_verification, 'Runtime contract.proposal.task_state.review_receipt.target_verification'),
    [...REVIEW_TARGET_VERIFICATION_STATES],
    'Runtime contract review receipt target verification states',
  );
  const draftContract = expectRecord(taskStateContract.draft, 'Runtime contract.proposal.task_state.draft');
  expectExactKeys(draftContract, ['mode', 'actions', 'identity_required', 'definition_required', 'create_from', 'update_from', 'target', 'preserves'], 'Runtime contract.proposal.task_state.draft');
  if (draftContract.mode !== 'default') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state draft mode must remain default.');
  expectSetEqual(expectStringArray(draftContract.actions, 'Runtime contract.proposal.task_state.draft.actions'), ['create-draft', 'update-draft'], 'Runtime contract task-state draft actions');
  expectSetEqual(expectStringArray(draftContract.identity_required, 'Runtime contract.proposal.task_state.draft.identity_required'), ['task_id', 'task_slug', 'document_id', 'task_title'], 'Runtime contract task-state draft identity fields');
  expectSetEqual(expectStringArray(draftContract.definition_required, 'Runtime contract.proposal.task_state.draft.definition_required'), [...REPLAN_REPLACEMENT_FIELDS], 'Runtime contract task-state draft definition fields');
  for (const [field, expected] of [['create_from', 'closed + archived'], ['update_from', 'draft + active'], ['target', 'draft + active']] as const) {
    if (draftContract[field] !== expected) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract task-state draft ${field} must be ${expected}.`);
  }
  expectSetEqual(
    expectStringArray(draftContract.preserves, 'Runtime contract.proposal.task_state.draft.preserves'),
    ['TASK_ID', 'TASK_SLUG', 'document_id on update', 'execution_log', 'applied_proposals', 'canonical provenance'],
    'Runtime contract task-state draft preserved fields',
  );
  const confirmContract = expectRecord(taskStateContract.confirm, 'Runtime contract.proposal.task_state.confirm');
  expectExactKeys(confirmContract, ['mode', 'action', 'required', 'authority', 'from', 'to'], 'Runtime contract.proposal.task_state.confirm');
  if (confirmContract.mode !== 'confirm' || confirmContract.action !== 'confirm-draft') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state confirm must use confirm/confirm-draft.');
  expectSetEqual(expectStringArray(confirmContract.required, 'Runtime contract.proposal.task_state.confirm.required'), ['task_id', 'task_slug', 'document_id', 'draft_revision', 'evidence_refs'], 'Runtime contract task-state confirm required fields');
  expectSetEqual(expectStringArray(confirmContract.authority, 'Runtime contract.proposal.task_state.confirm.authority'), ['user-confirmation', 'authorized-caller'], 'Runtime contract task-state confirm authority');
  if (confirmContract.from !== 'draft + active' || confirmContract.to !== 'active + active') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract task-state confirm transition is invalid.');
  const prepareTaskContract = expectRecord(proposal.prepare_task, 'Runtime contract.proposal.prepare_task');
  expectExactKeys(prepareTaskContract, ['bound_actions', 'draft_mode', 'draft_actions', 'confirm_mode', 'confirm_actions', 'replan_mode', 'replan_actions'], 'Runtime contract.proposal.prepare_task');
  expectSetEqual(
    expectStringArray(prepareTaskContract.bound_actions, 'Runtime contract.proposal.prepare_task.bound_actions'),
    ['clear-resume-review-gate', ...DRAFT_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS],
    'Runtime contract prepare-task bound actions',
  );
  if (prepareTaskContract.draft_mode !== 'default' || prepareTaskContract.confirm_mode !== 'confirm') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract prepare-task draft/confirm modes are invalid.');
  expectSetEqual(expectStringArray(prepareTaskContract.draft_actions, 'Runtime contract.proposal.prepare_task.draft_actions'), ['create-draft', 'update-draft'], 'Runtime contract prepare-task draft actions');
  expectSetEqual(expectStringArray(prepareTaskContract.confirm_actions, 'Runtime contract.proposal.prepare_task.confirm_actions'), ['confirm-draft'], 'Runtime contract prepare-task confirm actions');
  if (prepareTaskContract.replan_mode !== 'replan') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract prepare-task replan_mode must be replan.');
  expectSetEqual(
    expectStringArray(prepareTaskContract.replan_actions, 'Runtime contract.proposal.prepare_task.replan_actions'),
    [...REPLAN_TASK_STATE_ACTIONS],
    'Runtime contract prepare-task replan actions',
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
  expectExactKeys(closeTaskContract, ['default_mode', 'preview_mode', 'terminal_from', 'terminal_to', 'lesson_admission'], 'Runtime contract.proposal.close_task');
  if (closeTaskContract.default_mode !== 'default' || closeTaskContract.preview_mode !== 'preview') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract close-task must reserve default closure and preview read-only semantics.');
  }
  expectSetEqual(expectStringArray(closeTaskContract.terminal_from, 'Runtime contract close-task terminal_from'), ['active + active'], 'Runtime contract close-task terminal_from');
  expectSetEqual(expectStringArray(closeTaskContract.terminal_to, 'Runtime contract close-task terminal_to'), ['closed + archived'], 'Runtime contract close-task terminal_to');
  expectSetEqual(expectStringArray(closeTaskContract.lesson_admission, 'Runtime contract close-task lesson_admission'), ['admit', 'defer', 'no-op'], 'Runtime contract close-task lesson admission');
  const mutationScopeContract = expectRecord(contract.mutation_scope, 'Runtime contract.mutation_scope');
  expectExactKeys(
    mutationScopeContract,
    ['status', 'binding', 'source', 'buckets', 'default_write_policy', 'read_discovery_is_not_write_authority', 'ordinary_write_scope', 'broad_glob_requires', 'conditional_expansion_requires', 'changed_goal_scope_acceptance', 'check_command', 'input', 'output'],
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
        source: ['CURRENT_TASK.md'],
        writes: ['CURRENT_TASK.md'],
        callers: ['execute-step', 'prepare-task'],
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
  const unbound = expectStringArray(contract.unbound_operations, 'Runtime contract.unbound_operations');
  expectSetEqual(unbound, ['inbox-record-transaction'], 'Runtime contract unbound operations');
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
    expectExactKeys(record, ['kind', 'source', 'subject'], `authority_evidence[${index}]`);
    result.push({
      kind: expectEnum(record.kind, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission', 'dangerous-operation', 'resume-review', 'user-confirmation', 'authorized-caller'], `authority_evidence[${index}].kind`),
      source: normalizeRepoPath(expectString(record.source, `authority_evidence[${index}].source`), `authority_evidence[${index}].source`),
      subject: expectText(record.subject, `authority_evidence[${index}].subject`, 256),
    });
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

function validateStepReviewReceipt(value: unknown, location: string): StepReviewReceipt {
  const record = expectRecord(value, location);
  expectExactKeys(record, [
    'cycle_id',
    'cycle_phase',
    'diff_target',
    'diff_target_verification',
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
    diff_target: expectText(record.diff_target, `${location}.diff_target`, 512),
    diff_target_verification: expectEnum(record.diff_target_verification, REVIEW_TARGET_VERIFICATION_STATES, `${location}.diff_target_verification`),
    verdict: expectEnum(record.verdict, ['clean'], `${location}.verdict`),
    admitted_fingerprints: admittedFingerprints,
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
  };
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
  return result;
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
  const ids: string[] = [];
  for (const line of implementationSteps.split('\n')) {
    const labelledStep = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\s*[:：]/.exec(line);
    if (labelledStep) {
      ids.push(labelledStep[1]);
      continue;
    }
    const numberedStep = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?步骤\s+([0-9]+)\s*[:：]/.exec(line);
    if (numberedStep) ids.push(`step-${numberedStep[1]}`);
  }
  return ids;
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

function validateTaskStateDelta(value: unknown): TaskStateDelta {
  const record = expectRecord(value, 'semantic_delta');
  const kind = expectEnum(record.kind, ['task-state'], 'semantic_delta.kind');
  const action = expectEnum(record.action, ['step-progress', 'clear-resume-review-gate', ...DRAFT_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS], 'semantic_delta.action');
  if (action === 'create-draft' || action === 'update-draft') {
    expectExactKeys(record, ['kind', 'action', 'task_id', 'task_slug', 'document_id', 'task_title', 'draft_definition', 'active_step_id', 'evidence_refs'], 'semantic_delta');
    const identity = validateDraftTaskIdentityFields(record, 'semantic_delta', true);
    return {
      kind,
      action,
      ...identity,
      draft_definition: validateReplanReplacementDefinition(record.draft_definition, 'semantic_delta.draft_definition'),
      active_step_id: expectString(record.active_step_id, 'semantic_delta.active_step_id', STEP_ID_PATTERN),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
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
  if (action === 'clear-resume-review-gate') {
    expectExactKeys(record, ['kind', 'action', 'evidence_refs'], 'semantic_delta');
    return {
      kind,
      action: 'clear-resume-review-gate',
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
    expectExactKeys(record, ['kind', 'action', 'replacement_definition', 'active_step_id', 'evidence_refs'], 'semantic_delta');
    return {
      kind,
      action,
      replacement_definition: validateReplanReplacementDefinition(record.replacement_definition, 'semantic_delta.replacement_definition'),
      active_step_id: expectString(record.active_step_id, 'semantic_delta.active_step_id', STEP_ID_PATTERN),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
    };
  }
  const keys = Object.keys(record);
  if (keys.some(key => !['kind', 'action', 'step_id', 'status', 'evidence_refs', 'note', 'repair_fingerprint', 'diff_target', 'review_receipt'].includes(key))) {
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
  if (record.diff_target !== undefined) result.diff_target = expectText(record.diff_target, 'semantic_delta.diff_target', 512);
  if (record.review_receipt !== undefined) result.review_receipt = validateStepReviewReceipt(record.review_receipt, 'semantic_delta.review_receipt');
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

function validateArchiveDelta(value: unknown): ArchiveDelta {
  const record = expectRecord(value, 'semantic_delta');
  const allowedKeys = ['kind', 'action', 'closure_evidence', 'delivery_summary', 'remaining_risks', 'lesson_admission', 'evidence_refs'];
  const extra = Object.keys(record).filter(key => !allowedKeys.includes(key));
  const required = allowedKeys.filter(key => !(key in record));
  if (required.length > 0 || extra.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `semantic_delta keys mismatch; missing=[${required.join(', ')}], unexpected=[${extra.join(', ')}].`);
  }
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs');
  const closureEvidence = validateClosureEvidence(record.closure_evidence, 'semantic_delta.closure_evidence');
  const lessonAdmission = validateLessonAdmission(record.lesson_admission, 'semantic_delta.lesson_admission');
  const referencedEvidence = [
    ...closureEvidence.release_evidence.evidence_refs,
    ...closureEvidence.rollback_evidence.evidence_refs,
    ...closureEvidence.observation_evidence.evidence_refs,
    ...lessonAdmission.evidence_refs,
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
    evidence_refs: evidenceRefs,
  };
}

const LESSON_CATEGORIES: LessonCandidate['category'][] = ['通用', '数据与存储', '前端与交互', '后端与服务', '测试与回归', '部署与运行时'];

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
  const caller = expectEnum(proposal.caller, ['execute-step', 'prepare-task', 'task-lifecycle', 'close-task'], 'proposal.caller');
  const mode = expectEnum(proposal.mode, [...VNEXT_EXECUTE_STEP_MODES, ...PREPARE_TASK_MODES, ...LIFECYCLE_MODES], 'proposal.mode');
  const sourceTuple = validateSourceTuple(proposal.source_tuple);
  const authorityEvidence = validateAuthorityEvidence(proposal.authority_evidence);
  const preconditions = expectStringArray(proposal.preconditions, 'proposal.preconditions', false, 32);
  const evidenceRefs = validateEvidenceRefs(proposal.evidence_refs, 'proposal.evidence_refs');
  const idempotencyKey = expectString(proposal.idempotency_key, 'proposal.idempotency_key', SAFE_KEY_PATTERN);
  const requestedTargets = expectStringArray(proposal.requested_write_targets, 'proposal.requested_write_targets', false, 4)
    .map((target, index) => normalizeRepoPath(target, `proposal.requested_write_targets[${index}]`));
  const targetCount = (operationKind === 'lifecycle-transaction' && mode !== 'supersede') || operationKind === 'archive-transaction' ? 2 : 1;
  if (requestedTargets.length !== targetCount) fail('RUNTIME_PATH_INVALID', `This Runtime proposal must name exactly ${targetCount} exact write target${targetCount === 1 ? '' : 's'}.`);
  const semanticDelta = validateSemanticDelta(proposal.semantic_delta, operationKind);
  if (operationKind === 'task-state-transaction') {
    if (caller === 'prepare-task') {
      if (mode === 'default') {
        if (semanticDelta.kind !== 'task-state' || !['clear-resume-review-gate', 'create-draft', 'update-draft'].includes(semanticDelta.action)) {
          fail('RUNTIME_CALLER_NOT_BOUND', 'prepare-task default mode is bound only to clear-resume-review-gate, create-draft, or update-draft.');
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
    } else if (caller === 'execute-step') {
      if (!VNEXT_EXECUTE_STEP_MODES.includes(mode as VNextExecuteStepMode)) fail('RUNTIME_MODE_INVALID', 'execute-step task-state proposals must use default or repair mode.');
      if (semanticDelta.kind !== 'task-state' || semanticDelta.action !== 'step-progress') fail('RUNTIME_MODE_INVALID', 'execute-step is bound only to step-progress task-state deltas.');
    } else {
      fail('RUNTIME_CALLER_NOT_BOUND', 'task-state-transaction is not bound to task-lifecycle.');
    }
  } else if (operationKind === 'finding-queue-transaction') {
    if (caller !== 'execute-step' || mode !== 'repair') fail('RUNTIME_CALLER_NOT_BOUND', 'finding-queue-transaction is bound only to execute-step:repair.');
    if (semanticDelta.kind !== 'finding-queue') fail('RUNTIME_MODE_INVALID', 'repair mode requires a finding-queue proposal.');
  } else if (operationKind === 'lifecycle-transaction') {
    if (caller !== 'task-lifecycle' || !LIFECYCLE_MODES.includes(mode as LifecycleMode)) fail('RUNTIME_CALLER_NOT_BOUND', 'lifecycle-transaction is bound only to task-lifecycle lifecycle modes.');
    if (semanticDelta.kind !== 'lifecycle' || semanticDelta.action !== mode) fail('RUNTIME_MODE_INVALID', 'lifecycle mode and semantic transition must match.');
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
  const reviewReceiptRefs = semanticDelta.kind === 'task-state'
    && semanticDelta.action === 'step-progress'
    && semanticDelta.review_receipt
    ? semanticDelta.review_receipt.evidence_refs
    : [];
  if (![...deltaRefs, ...reviewReceiptRefs].every(ref => evidenceRefs.includes(ref))) {
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
  expectExactKeys(
    value,
    [
      'action', 'idempotency_key', 'operation_kind', 'caller', 'mode', 'task_id', 'task_slug',
      'document_id', 'from_workflow_status', 'from_lifecycle_state', 'to_workflow_status',
      'to_lifecycle_state', 'source_revision', 'archive_path', 'archive_revision',
      'closure_delta_digest', 'authority_evidence', 'evidence_refs', 'lesson_admission', 'recorded_at',
    ],
    location,
  );
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
  const conditionalKeys = action === 'confirm-draft' ? ['draft_revision'] : ['definition_digest'];
  const extra = Object.keys(value).filter(key => !requiredKeys.includes(key) && !conditionalKeys.includes(key));
  const missing = [...requiredKeys, ...conditionalKeys].filter(key => !(key in value));
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

function validateExecutionLogEntry(value: unknown, location: string, taskId: string, taskSlug: string): ExecutionLogEntry {
  const record = expectRecord(value, location);
  if (DRAFT_AUDIT_ACTIONS.includes(record.action as DraftAuditAction)) return validateDraftAuditLogEntry(record, location, taskId, taskSlug);
  if (record.action === 'archive') return validateArchiveAuditLogEntry(record, location, taskId, taskSlug);
  if ('action' in record) {
    const requiredKeys = [
      'action', 'idempotency_key', 'operation_kind', 'caller', 'mode', 'task_id', 'task_slug',
      'document_id', 'from_workflow_status', 'from_lifecycle_state', 'to_workflow_status',
      'to_lifecycle_state', 'source_revision', 'authority_evidence', 'evidence_refs', 'recorded_at',
    ];
    const optionalKeys = ['partial_diff_disposition', 'invalidation_kind', 'invalidation_reason'];
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
    const expectedTransition = action === 'mark-replan-blocked'
      ? ['active', 'active', 'blocked_by_replan', 'active']
      : action === 'clear-replan-block'
        ? ['blocked_by_replan', 'active', 'active', 'active']
        : ['superseded', 'active', 'active', 'active'];
    if (fromWorkflowStatus !== expectedTransition[0] || fromLifecycleState !== expectedTransition[1] || toWorkflowStatus !== expectedTransition[2] || toLifecycleState !== expectedTransition[3]) {
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
    'diff_target',
    'checkpoint',
    'advancement',
    'next_step_id',
    'review_receipt',
    'recorded_at',
  ];
  const optionalExecutionLogKeys = ['note', 'repair_fingerprint', 'diff_target', 'checkpoint', 'advancement', 'next_step_id', 'review_receipt'];
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
  if (record.diff_target !== undefined) result.diff_target = expectText(record.diff_target, `${location}.diff_target`, 512);
  if (record.checkpoint !== undefined) result.checkpoint = expectEnum(record.checkpoint, ['required', 'not-required'], `${location}.checkpoint`);
  if (record.advancement !== undefined) result.advancement = expectEnum(record.advancement, STEP_ADVANCEMENT_OUTCOMES, `${location}.advancement`);
  if (record.next_step_id !== undefined) result.next_step_id = expectNullableString(record.next_step_id, `${location}.next_step_id`, STEP_ID_PATTERN);
  if (record.review_receipt !== undefined) result.review_receipt = validateStepReviewReceipt(record.review_receipt, `${location}.review_receipt`);
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

export function validateVNextRuntimeState(value: unknown): RuntimeState {
  const runtime = expectRecord(value, 'runtime_state');
  expectExactKeys(
    runtime,
    ['schema_version', 'kind', 'task_id', 'task_slug', 'workflow_status', 'lifecycle_state', 'resume_requires_review', 'resume_review_reasons', 'active_step_id', 'active_step_status', 'finding_queue_revision', 'review_cycle', 'findings', 'execution_log', 'applied_proposals'],
    'runtime_state',
  );
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
  const findingsValue = runtime.findings;
  if (!Array.isArray(findingsValue) || findingsValue.length > MAX_FINDINGS) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.findings must be an array within the bounded size.');
  const findings = findingsValue.map((finding, index) => validateFinding(finding, `runtime_state.findings[${index}]`));
  if (new Set(findings.map(finding => finding.fingerprint)).size !== findings.length) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.findings fingerprints must be unique.');
  for (const finding of findings) {
    if (finding.owner_task_id !== taskId) fail('RUNTIME_STATE_CONFLICT', `finding ${finding.fingerprint} is owned by a different task.`);
    if (finding.repair_attempts > finding.max_repair_attempts) fail('RUNTIME_SCHEMA_INVALID', `finding ${finding.fingerprint} exceeds its declared repair budget.`);
  }
  const executionLogValue = runtime.execution_log;
  if (!Array.isArray(executionLogValue) || executionLogValue.length > MAX_EXECUTION_LOG) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.execution_log must be a bounded array.');
  const executionLog = executionLogValue.map((entry, index) => validateExecutionLogEntry(entry, `runtime_state.execution_log[${index}]`, taskId, taskSlug));
  const appliedValue = runtime.applied_proposals;
  if (!Array.isArray(appliedValue) || appliedValue.length > MAX_APPLIED_PROPOSALS) fail('RUNTIME_SCHEMA_INVALID', 'runtime_state.applied_proposals must be a bounded array.');
  const appliedProposals = appliedValue.map((entry, index) => {
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
  return {
    schema_version: 1,
    kind: VNEXT_RUNTIME_STATE_KIND,
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

function renderExecutionAuditRecord(audit: RuntimeAuditLogEntry): string {
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
  } else if (DRAFT_AUDIT_ACTIONS.includes(audit.action as DraftAuditAction)) {
    const draftAudit = audit as DraftAuditLogEntry;
    lines.push(`  from_task_id: ${draftAudit.from_task_id}`);
    lines.push(`  from_task_slug: ${draftAudit.from_task_slug}`);
    lines.push(`  from_document_id: ${draftAudit.from_document_id}`);
    if (draftAudit.definition_digest !== undefined) lines.push(`  definition_digest: ${draftAudit.definition_digest}`);
    if (draftAudit.draft_revision !== undefined) lines.push(`  draft_revision: ${draftAudit.draft_revision}`);
  } else {
    const replanAudit = audit as ReplanAuditLogEntry;
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

function assertExecutionAuditInBody(body: string, audit: RuntimeAuditLogEntry): void {
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), ['执行记录', 'Execution Log'], 2);
  if (!section) fail('RUNTIME_REPLAY_INCOMPLETE', 'replay is missing the required ## 执行记录 audit section.');
  const content = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n');
  if (!content.includes(renderExecutionAuditRecord(audit))) {
    fail('RUNTIME_REPLAY_INCOMPLETE', `replay is missing the durable body audit for ${audit.action}.`);
  }
}

function renderNewDraftBody(identity: DraftTaskIdentity, definition: DraftTaskDefinition, runtimeState: RuntimeState): string {
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
    audit?: RuntimeAuditLogEntry;
  } = {},
): string {
  const nextFrontmatter: AnyRecord = {
    ...frontmatter,
    ...(options.draftDocumentId === undefined ? {} : { document_id: options.draftDocumentId }),
    runtime_state: runtimeState,
  };
  let nextBody = options.draftDefinition && options.draftIdentity
    ? renderNewDraftBody(options.draftIdentity, options.draftDefinition, runtimeState)
    : options.replacementDefinition
      ? replaceReplanDefinitionSections(body, options.replacementDefinition)
      : body;
  if (options.draftIdentity && !(options.draftDefinition && options.draftIdentity)) {
    nextBody = replaceTaskInfoField(nextBody, '任务 ID', options.draftIdentity.task_id);
    nextBody = replaceTaskInfoField(nextBody, '任务标题', options.draftIdentity.task_title);
    nextBody = replaceTaskInfoField(nextBody, '任务 slug', options.draftIdentity.task_slug);
  }
  nextBody = renderCurrentTaskLifecycleFields(nextBody, runtimeState);
  if (options.audit) nextBody = appendExecutionAuditToBody(nextBody, options.audit);
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

function parseCanonicalCurrentTaskContent(raw: string, filePath: string, relativePath: string): CanonicalCurrentTask {
  const { frontmatter, body } = parseYamlFrontmatter(raw, relativePath);
  if (frontmatter.kind !== VNEXT_CURRENT_TASK_KIND) {
    fail('MIGRATION_REQUIRED', `${relativePath} is not a pure vNext CURRENT_TASK document; run the Migration Pack.`);
  }
  expectExactKeys(frontmatter, ['schema_version', 'kind', 'document_id', 'runtime_state'], `${relativePath} frontmatter`);
  if (frontmatter.schema_version !== 1) fail('RUNTIME_SCHEMA_INVALID', `${relativePath}.schema_version must be 1 for a vNext CURRENT_TASK document.`);
  const documentId = expectString(frontmatter.document_id, `${relativePath}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) fail('RUNTIME_SCHEMA_INVALID', `${relativePath}.document_id is invalid.`);
  const runtimeState = validateVNextRuntimeState(frontmatter.runtime_state);
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

export function readCanonicalCurrentTask(root: string): CanonicalCurrentTask {
  const { filePath, relativePath } = currentTaskPathForRoot(root);
  if (!fs.existsSync(filePath)) fail('RUNTIME_SOURCE_MISSING', `CURRENT_TASK.md is missing: ${relativePath}`);
  return parseCanonicalCurrentTaskContent(fs.readFileSync(filePath, 'utf8'), filePath, relativePath);
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
}

function matchingArchiveReceipt(root: string, current: CanonicalCurrentTask): { audit: ArchiveAuditLogEntry; receipt: ArchiveReceipt } {
  const audits = archiveAudits(current);
  if (audits.length !== 1) fail('LIFECYCLE_REPLAY_INCOMPLETE', 'CURRENT_TASK must contain exactly one durable archive audit for reconciliation.');
  const audit = audits[0]!;
  assertExecutionAuditInBody(current.body, audit);
  if (audit.from_workflow_status !== 'active' || audit.from_lifecycle_state !== 'active' || audit.to_workflow_status !== 'closed' || audit.to_lifecycle_state !== 'archived') {
    fail('LIFECYCLE_REPLAY_INCOMPLETE', 'archive audit does not describe the frozen active + active to closed + archived transition.');
  }
  const receipt = readCanonicalArchive(root, current, audit.archive_path);
  assertArchiveReceiptMatches(current, receipt, audit);
  return { audit, receipt };
}

function closureEligibilityBlockers(current: CanonicalCurrentTask, delta: ArchiveDelta, archiveAlreadyExists: boolean): string[] {
  const blockers: string[] = [];
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.id === null || identity.slug === null || identity.title === null) blockers.push('task identity is not fully materialized in CURRENT_TASK.');
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') blockers.push('first successful close requires active + active.');
  if (current.runtimeState.resume_requires_review || current.runtimeState.resume_review_reasons.length > 0) blockers.push('resume review gate is not cleared.');
  if (current.runtimeState.active_step_status !== 'completed') blockers.push('the admitted current step is not completed.');
  try {
    const stepResolution = resolveCanonicalTaskStep(current);
    const checkpoint = effectiveCheckpointPolicy(stepResolution);
    if (stepResolution.next !== null) {
      blockers.push('remaining implementation steps have not been durably advanced to completion.');
    }
    if (stepResolution.steps.length > 1) {
      const completedRecord = current.runtimeState.execution_log.find((item): item is StepExecutionLogEntry =>
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
    const repairRecords = current.runtimeState.execution_log.filter((item): item is StepExecutionLogEntry =>
      !('action' in item) && item.step_id === stepResolution.current.id && item.mode === 'repair',
    );
    if (repairRecords.length > 0) {
      const repairFingerprints = [...new Set(repairRecords.map(item => item.repair_fingerprint).filter((value): value is string => Boolean(value)))];
      const repairTargets = [...new Set(repairRecords.map(item => item.diff_target).filter((value): value is string => Boolean(value)))];
      const verified = current.runtimeState.execution_log.some((item): item is StepExecutionLogEntry => {
        if ('action' in item || item.step_id !== stepResolution.current.id || item.review_receipt?.cycle_phase !== 'verification') return false;
        const receipt = item.review_receipt;
        return receipt !== undefined
          && receipt.admitted_fingerprints.length === repairFingerprints.length
          && repairFingerprints.every(fingerprint => receipt.admitted_fingerprints.includes(fingerprint))
          && (repairTargets.length === 0 || receipt.diff_target === repairTargets[0]);
      });
      if (!verified) blockers.push('every repair route must have a durable same-diff verification receipt before closure.');
      if (repairRecords.some(item => !item.repair_fingerprint || !item.diff_target)) blockers.push('a repair execution record is missing its finding fingerprint or logical diff target.');
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (current.runtimeState.findings.some(item => item.status === 'admitted' || item.status === 'in-progress')) blockers.push('an admitted or in-progress finding remains unresolved.');
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
    '- affected_contracts: preserved in the CURRENT_TASK snapshot; close-task does not mutate CONTRACTS.md.',
    '- confirmed_decisions: preserved in the CURRENT_TASK snapshot; close-task does not mutate DECISIONS.md.',
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
    if (receipt.sourceRevision !== audit.source_revision) fail('ARCHIVE_PROVENANCE_MISMATCH', 'archive source revision does not match the committed archive audit.');
    return null;
  }
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('CLOSURE_TUPLE_INVALID', 'first successful close requires active + active.');
  }
  const archiveTarget = archivePathForTask(root, current);
  const blockers = closureEligibilityBlockers(current, delta, fs.existsSync(archiveTarget.filePath));
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

function readStatusSectionLines(content: string, title: string, location: string): string[] {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), [title], 2);
  if (!section) fail('STATUS_INVALID', `${location} is missing the required ## ${title} section.`);
  const body = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trim();
  return body.length > 0 ? body.split('\n') : [];
}

function replaceStatusSectionBody(content: string, title: string, lines: readonly string[], location: string): string {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), [title], 2);
  if (!section) fail('STATUS_INVALID', `${location} is missing the required ## ${title} section.`);
  const body = lines.join('\n').trim();
  return content.slice(0, section.contentStart) + `${body.length > 0 ? `\n${body}\n\n` : '\n'}` + content.slice(section.contentEnd);
}

function statusItemMatchCount(lines: readonly string[], item: string): number {
  return lines.filter(line => statusItemText(line) === item).length;
}

function projectStatusOverview(content: string, delta: ProjectStatusDelta, location: string): string {
  const lines = readStatusSectionLines(content, '项目概览', location);
  const statusFieldPattern = /^-\s*(?:当前状态|status)\s*[:：]\s*.*$/i;
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(item => statusFieldPattern.test(item.line));
  if (matches.length > 1) fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains multiple project status fields.`);
  const statusLine = `- 当前状态：${delta.status}`;
  if (matches.length === 1) {
    const next = [...lines];
    next[matches[0]!.index] = statusLine;
    return replaceStatusSectionBody(content, '项目概览', next, location);
  }
  return replaceStatusSectionBody(content, '项目概览', [...lines, statusLine], location);
}

function projectStatusCompletedItems(content: string, delta: ProjectStatusDelta, location: string): string {
  const completedLines = readStatusSectionLines(content, '✅ 已完成且稳定', location);
  const developmentLines = readStatusSectionLines(content, '🔨 正在开发', location);
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
  let next = replaceStatusSectionBody(content, '🔨 正在开发', nextDevelopmentLines, location);
  return replaceStatusSectionBody(next, '✅ 已完成且稳定', nextCompletedLines, location);
}

function projectStatusRemainingRisks(content: string, delta: ProjectStatusDelta, location: string): string {
  const riskItems = delta.remaining_risks.map(item => validateStatusProjectionText(item, `${location}.remaining_risks`));
  if (riskItems.length === 0) return content;
  const lines = readStatusSectionLines(content, '⚠️ 已知风险 / 观察点', location);
  const appendItems = riskItems.filter(item => {
    const matches = statusItemMatchCount(lines, item);
    if (matches > 1) fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains duplicate remaining risk "${item}".`);
    return matches === 0;
  });
  if (appendItems.length === 0) return content;
  const nextLines = lines.filter(line => !isStatusPlaceholderLine(line));
  while (nextLines.length > 0 && nextLines[nextLines.length - 1]!.trim() === '') nextLines.pop();
  nextLines.push(...appendItems.map(item => `- ${item}`));
  return replaceStatusSectionBody(content, '⚠️ 已知风险 / 观察点', nextLines, location);
}

function projectStatusCheckpoint(content: string, delta: ProjectStatusDelta, location: string): string {
  const checkpoint = validateStatusProjectionText(delta.next_checkpoint, `${location}.next_checkpoint`);
  const lines = readStatusSectionLines(content, '🔜 下一检查点', location);
  const nonEmpty = lines.filter(line => line.trim().length > 0);
  if (nonEmpty.some(line => statusItemText(line) === null && !isStatusPlaceholderLine(line))) {
    fail('STATUS_RECONCILIATION_CONFLICT', `${location} next checkpoint section contains unsupported non-list content.`);
  }
  if (nonEmpty.filter(line => statusItemText(line) !== null).length > 1) {
    fail('STATUS_RECONCILIATION_CONFLICT', `${location} contains multiple next checkpoint records.`);
  }
  return replaceStatusSectionBody(content, '🔜 下一检查点', [`- ${checkpoint}`], location);
}

function projectStatusDelta(content: string, delta: ProjectStatusDelta, location: string): string {
  let next = projectStatusOverview(content, delta, location);
  next = projectStatusCompletedItems(next, delta, location);
  next = projectStatusRemainingRisks(next, delta, location);
  return projectStatusCheckpoint(next, delta, location);
}

function assertStatusProjection(content: string, delta: ProjectStatusDelta, location: string): void {
  const overviewLines = readStatusSectionLines(content, '项目概览', location);
  const statusLines = overviewLines.filter(line => /^-\s*(?:当前状态|status)\s*[:：]\s*.*$/i.test(line));
  if (statusLines.length !== 1 || statusLines[0] !== `- 当前状态：${delta.status}`) {
    fail('STATUS_PROVENANCE_MISMATCH', `${location} project status projection no longer matches the typed status delta.`);
  }
  const completedLines = readStatusSectionLines(content, '✅ 已完成且稳定', location);
  const developmentLines = readStatusSectionLines(content, '🔨 正在开发', location);
  for (const rawItem of delta.completed_items) {
    const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
    if (statusItemMatchCount(completedLines, item) !== 1 || statusItemMatchCount(developmentLines, item) !== 0) {
      fail('STATUS_PROVENANCE_MISMATCH', `${location} completed item projection no longer matches "${item}".`);
    }
  }
  const riskLines = readStatusSectionLines(content, '⚠️ 已知风险 / 观察点', location);
  for (const rawItem of delta.remaining_risks) {
    const item = validateStatusProjectionText(rawItem, `${location}.remaining_risks`);
    if (statusItemMatchCount(riskLines, item) !== 1) {
      fail('STATUS_PROVENANCE_MISMATCH', `${location} remaining risk projection no longer matches "${item}".`);
    }
  }
  const checkpointLines = readStatusSectionLines(content, '🔜 下一检查点', location);
  if (checkpointLines.filter(line => statusItemText(line) !== null).length !== 1 || statusItemText(checkpointLines.find(line => statusItemText(line) !== null) ?? '') !== delta.next_checkpoint) {
    fail('STATUS_PROVENANCE_MISMATCH', `${location} next checkpoint projection no longer matches the typed status delta.`);
  }
}

function appendStatusReconciliation(content: string, marker: string, location: string): string {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), ['最近更新记录', 'Recent Updates'], 2);
  if (!section) fail('STATUS_INVALID', `${location} is missing the required ## 最近更新记录 section.`);
  const existing = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trimEnd();
  return content.slice(0, section.contentStart) + `\n${existing.trim().length > 0 ? `${existing}\n\n` : ''}${marker}\n` + content.slice(section.contentEnd);
}

function prepareProjectStatusTransaction(root: string, current: CanonicalCurrentTask, proposal: ProjectStatusProposal): ProjectStatusTransactionPlan | null {
  ensureAuthorityKinds(proposal, ['evidence-admission']);
  const { receipt } = matchingArchiveReceipt(root, current);
  const target = workflowDocPathForRoot(root, 'STATUS.md');
  if (!fs.existsSync(target.filePath)) fail('RUNTIME_SOURCE_MISSING', `STATUS.md is missing: ${target.relativePath}`);
  const originalStatusContent = fs.readFileSync(target.filePath, 'utf8');
  const sections = scanMarkdownSections(originalStatusContent);
  for (const heading of ['项目概览', '✅ 已完成且稳定', '🔨 正在开发', '📋 待开发', '⚠️ 已知风险 / 观察点', '❌ 已移除 / 推迟', '🔜 下一检查点', '最近更新记录']) {
    if (!findUniqueMarkdownSection(sections, [heading], 2)) fail('STATUS_INVALID', `STATUS.md is missing required ## ${heading} section.`);
  }
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
};

function renderLessonMarker(candidate: LessonCandidate, archive: ArchiveReceipt): string {
  return `<!-- vNext lesson record: ${JSON.stringify({
    task_id: archive.taskId,
    task_slug: archive.taskSlug,
    document_id: archive.documentId,
    archive_path: archive.relativePath,
    archive_revision: archive.revision,
    source_revision: archive.sourceRevision,
    candidate_ref: candidate.candidate_ref,
    candidate_digest: digest(candidate),
    evidence_refs: candidate.evidence_refs,
  })} -->`;
}

function readLessonMarkers(content: string, location: string): LessonMarker[] {
  const pattern = /<!-- vNext lesson record: (\{[^\r\n]+\}) -->/g;
  const result: LessonMarker[] = [];
  for (const match of content.matchAll(pattern)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      fail('LESSON_INVALID', `${location} contains an invalid vNext lesson provenance marker.`);
    }
    const record = expectRecord(parsed, `${location}.lesson_marker`);
    expectExactKeys(record, ['task_id', 'task_slug', 'document_id', 'archive_path', 'archive_revision', 'source_revision', 'candidate_ref', 'candidate_digest', 'evidence_refs'], `${location}.lesson_marker`);
    const archiveRevision = expectString(record.archive_revision, `${location}.lesson_marker.archive_revision`);
    const sourceRevision = expectString(record.source_revision, `${location}.lesson_marker.source_revision`);
    const candidateDigest = expectString(record.candidate_digest, `${location}.lesson_marker.candidate_digest`);
    if (!/^[a-f0-9]{64}$/.test(archiveRevision) || !/^[a-f0-9]{64}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(candidateDigest)) fail('LESSON_INVALID', `${location} lesson provenance marker has an invalid revision or digest.`);
    result.push({
      task_id: expectString(record.task_id, `${location}.lesson_marker.task_id`),
      task_slug: expectString(record.task_slug, `${location}.lesson_marker.task_slug`),
      document_id: expectString(record.document_id, `${location}.lesson_marker.document_id`),
      archive_path: normalizeRepoPath(expectString(record.archive_path, `${location}.lesson_marker.archive_path`), `${location}.lesson_marker.archive_path`),
      archive_revision: archiveRevision,
      source_revision: sourceRevision,
      candidate_ref: expectString(record.candidate_ref, `${location}.lesson_marker.candidate_ref`, SAFE_KEY_PATTERN),
      candidate_digest: candidateDigest,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.lesson_marker.evidence_refs`),
    });
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

type DurableLessonRecord = {
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
  return `<!-- vNext lesson record: ${JSON.stringify({
    task_id: marker.task_id,
    task_slug: marker.task_slug,
    document_id: marker.document_id,
    archive_path: marker.archive_path,
    archive_revision: marker.archive_revision,
    source_revision: marker.source_revision,
    candidate_ref: marker.candidate_ref,
    candidate_digest: marker.candidate_digest,
    evidence_refs: marker.evidence_refs,
  })} -->`;
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
    .filter(section => section.level === 2 && section.headingStart > markerStart)
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
  if (digest(candidate) !== marker.candidate_digest) {
    fail('LESSON_PROVENANCE_MISMATCH', `${location}.${marker.candidate_ref} marker digest does not match the visible Lesson record.`);
  }
  const archive = archiveReceiptFromLessonMarker(marker);
  if (countExactOccurrences(content, renderLessonCandidate(candidate, archive)) !== 1) {
    fail('LESSON_PROVENANCE_MISMATCH', `${location}.${marker.candidate_ref} visible Lesson record drifted from its deterministic rendering.`);
  }
  return { marker, candidate };
}

function readDurableLessonRecords(content: string, location: string): DurableLessonRecord[] {
  return readLessonMarkers(content, location).map((marker, index) => readDurableLessonRecord(content, marker, `${location}.lesson[${index}]`));
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
  if (!receipt.lessonAdmission.evidence_refs.every(ref => delta.evidence_refs.includes(ref))) {
    fail('KNOWLEDGE_ADMISSION_INVALID', 'lesson-record evidence_refs must cover the durable archive lesson admission evidence_refs.');
  }
  const target = workflowDocPathForRoot(root, 'LESSONS.md');
  if (!fs.existsSync(target.filePath)) fail('RUNTIME_SOURCE_MISSING', `LESSONS.md is missing: ${target.relativePath}`);
  const originalLessonsContent = fs.readFileSync(target.filePath, 'utf8');
  const sections = scanMarkdownSections(originalLessonsContent);
  for (const heading of ['使用规则', '通用', '数据与存储', '前端与交互', '后端与服务', '测试与回归', '部署与运行时']) {
    if (!findUniqueMarkdownSection(sections, [heading], 2)) fail('LESSON_INVALID', `LESSONS.md is missing the required ## ${heading} section.`);
  }
  const existingRecords = readDurableLessonRecords(originalLessonsContent, target.relativePath);
  const newCandidates: LessonCandidate[] = [];
  for (const candidate of delta.candidates) {
    const matchingRefs = existingRecords.filter(record => record.marker.candidate_ref === candidate.candidate_ref);
    if (matchingRefs.length > 1) {
      fail('LESSON_INVALID', `LESSONS contains duplicate durable records for candidate ${candidate.candidate_ref}.`);
    }
    if (matchingRefs.length > 0) {
      for (const existing of matchingRefs) {
        const marker = existing.marker;
        if (marker.task_id !== receipt.taskId || marker.task_slug !== receipt.taskSlug || marker.document_id !== receipt.documentId || marker.archive_path !== receipt.relativePath || marker.archive_revision !== receipt.revision || marker.source_revision !== receipt.sourceRevision || marker.candidate_digest !== digest(candidate) || marker.evidence_refs.join('|') !== candidate.evidence_refs.join('|') || digest(existing.candidate) !== digest(candidate)) {
          fail('LESSON_PROVENANCE_MISMATCH', `lesson candidate ${candidate.candidate_ref} has conflicting durable provenance.`);
        }
      }
      continue;
    }
    const semanticDuplicate = existingRecords.some(record => record.marker.candidate_digest === digest(candidate));
    if (semanticDuplicate) continue;
    newCandidates.push(candidate);
  }
  if (newCandidates.length === 0) return null;
  const appended = appendLessonCandidates(originalLessonsContent, newCandidates, receipt, target.relativePath);
  return {
    lessonsFilePath: target.filePath,
    lessonsRelativePath: target.relativePath,
    nextLessonsContent: appended.content,
    originalLessonsContent,
    lessonsRevision: sha256(appended.content),
    archive: receipt,
    candidateCount: appended.candidateCount,
  };
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
  const file = proposal.operation_kind === 'project-status-transaction' ? 'STATUS.md' : 'LESSONS.md';
  const target = workflowDocPathForRoot(root, file);
  if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== target.relativePath) {
    fail('RUNTIME_PATH_INVALID', `${file} proposal must name only its exact canonical path.`);
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
  return [
    ...current.applied_proposals,
    {
      idempotency_key: proposal.idempotency_key,
      operation_kind: proposal.operation_kind,
      proposal_digest: digest(proposal),
      source_revision: sourceRevision,
    },
  ].slice(-MAX_APPLIED_PROPOSALS);
}

function appendExecutionLogEntry(current: RuntimeState, entry: ExecutionLogEntry): ExecutionLogEntry[] {
  return [...current.execution_log, entry].slice(-MAX_EXECUTION_LOG);
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
    return { ...base, definition_digest: digest(draftDelta.draft_definition) };
  }
  const confirmDelta = delta as Extract<TaskStateDelta, { action: 'confirm-draft' }>;
  return { ...base, draft_revision: confirmDelta.draft_revision };
}

function readDraftDefinitionFromBody(body: string): DraftTaskDefinition {
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

function assertDraftDefinitionReady(body: string, activeStepId: string): DraftTaskDefinition {
  const definition = readDraftDefinitionFromBody(body);
  assertReplacementActiveStep(activeStepId, definition.implementation_steps);
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

function assertDraftTaskReplay(current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind !== 'task-state' || !DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as DraftTaskStateAction)) return;
  const delta = proposal.semantic_delta as Extract<TaskStateDelta, { action: 'create-draft' | 'update-draft' | 'confirm-draft' }>;
  const audit = expectedDraftReplayAudit(current, proposal);
  assertExecutionAuditInBody(current.body, audit);
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
    || !sameOptionalValue(entry.diff_target, delta.diff_target ?? delta.review_receipt?.diff_target)
    || !sameOptionalValue(entry.review_receipt, delta.review_receipt)
  ) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'step-progress replay does not match the durable execution record.');
  }
  if (entry.mode === 'repair' && entry.repair_fingerprint === undefined) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'repair replay is missing its durable finding fingerprint.');
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

function assertTaskStateReplay(current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind === 'task-state' && DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as DraftTaskStateAction)) {
    assertDraftTaskReplay(current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind === 'task-state' && proposal.semantic_delta.action === 'step-progress') {
    assertStepProgressReplay(current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind !== 'task-state' || !REPLAN_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as ReplanTaskStateAction)) return;
  const delta = proposal.semantic_delta as Extract<TaskStateDelta, { action: ReplanTaskStateAction }>;
  const audit = expectedReplanReplayAudit(current, proposal);
  assertExecutionAuditInBody(current.body, audit);
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
  if (delta.action === 'create-draft') {
    ensureAuthorityKinds(proposal, ['scope-admission', 'evidence-admission']);
    ensureAnyAuthorityKind(proposal, ['active-task-owner', 'user-confirmation', 'authorized-caller']);
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
      matchingArchiveReceipt(root, current);
    }
    assertReplacementActiveStep(delta.active_step_id, delta.draft_definition.implementation_steps);
    const draftIdentity: DraftTaskIdentity = {
      task_id: delta.task_id,
      task_slug: delta.task_slug,
      document_id: delta.document_id,
      task_title: delta.task_title,
    };
    const emptyDraftState: RuntimeState = {
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
      audit,
    };
  }
  if (delta.action === 'update-draft') {
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
    assertReplacementActiveStep(delta.active_step_id, delta.draft_definition.implementation_steps);
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'draft',
      lifecycle_state: 'active',
      active_step_id: delta.active_step_id,
      active_step_status: 'ready',
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
      audit,
    };
  }
  if (delta.action === 'confirm-draft') {
    ensureAnyAuthorityKind(proposal, ['user-confirmation', 'authorized-caller']);
    ensureAuthorityKinds(proposal, ['evidence-admission']);
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
    assertDraftDefinitionReady(current.body, current.runtimeState.active_step_id);
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
    ensureAuthorityKinds(proposal, ['active-task-owner', 'resume-review', 'evidence-admission']);
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
  if (delta.action === 'mark-replan-blocked') {
    ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
      fail('REPLAN_TRANSITION_INVALID', 'mark-replan-blocked requires active + active.');
    }
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'blocked_by_replan',
      lifecycle_state: 'active',
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
    ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
    if (current.runtimeState.workflow_status !== 'superseded' || current.runtimeState.lifecycle_state !== 'active') {
      fail('REPLAN_TRANSITION_INVALID', 'commit-replan requires superseded + active.');
    }
    assertReplacementActiveStep(delta.active_step_id, delta.replacement_definition.implementation_steps);
    const findings = current.runtimeState.findings.map(item => {
      const preserved = { ...item, evidence_refs: [...item.evidence_refs] };
      if (preserved.status === 'admitted' || preserved.status === 'in-progress') {
        return { ...preserved, status: 'deferred' as const, updated_at: now };
      }
      return preserved;
    });
    const hadOpenFindings = current.runtimeState.findings.some(item => item.status === 'admitted' || item.status === 'in-progress');
    const nextWithoutAudit: RuntimeState = {
      ...current.runtimeState,
      workflow_status: 'active',
      lifecycle_state: 'active',
      resume_requires_review: false,
      resume_review_reasons: [],
      active_step_id: delta.active_step_id,
      active_step_status: 'ready',
      finding_queue_revision: hadOpenFindings
        ? current.runtimeState.finding_queue_revision + 1
        : current.runtimeState.finding_queue_revision,
      review_cycle: createReviewCycleZero(),
      findings,
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    return {
      next: { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) },
      replacementDefinition: delta.replacement_definition,
      audit,
    };
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
  const executionMode = proposal.mode as VNextExecuteStepMode;
  const stepResolution = resolveCanonicalTaskStep(current);
  const checkpoint = effectiveCheckpointPolicy(stepResolution);
  const currentStepRepairLogs = current.runtimeState.execution_log.filter((item): item is StepExecutionLogEntry =>
    !('action' in item) && item.step_id === delta.step_id && item.mode === 'repair',
  );
  const openFindings = current.runtimeState.findings.filter(item => item.status === 'admitted' || item.status === 'in-progress');
  if (executionMode === 'repair') {
    if (!delta.repair_fingerprint) fail('FINDING_ADMISSION_REQUIRED', 'repair mode requires repair_fingerprint.');
    const finding = current.runtimeState.findings.find(item => item.fingerprint === delta.repair_fingerprint);
    if (!finding || !['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_ADMISSION_REQUIRED', 'repair fingerprint is not an admitted current-task finding.');
    if (!delta.diff_target) fail('REPAIR_DIFF_TARGET_REQUIRED', 'repair mode requires one explicit logical diff_target.');
    if (delta.review_receipt !== undefined) fail('REVIEW_READ_ONLY_VIOLATION', 'repair execution cannot attach a review receipt; verification remains a separate review result.');
  } else {
    if (delta.repair_fingerprint !== undefined) fail('RUNTIME_MODE_INVALID', 'default execution cannot carry a repair fingerprint.');
    if (delta.diff_target !== undefined && delta.review_receipt === undefined) fail('REVIEW_RECEIPT_REQUIRED', 'diff_target on default execution must be carried by a review receipt.');
    if (delta.review_receipt !== undefined && delta.status !== 'completed') fail('REVIEW_RECEIPT_REQUIRED', 'review receipt is only valid when completing the current step.');
    if (delta.diff_target !== undefined && delta.review_receipt !== undefined && delta.diff_target !== delta.review_receipt.diff_target) {
      fail('REVIEW_TARGET_CONFLICT', 'step-progress diff_target must match the review receipt diff_target.');
    }
  }
  const executionDiffTarget = delta.diff_target ?? delta.review_receipt?.diff_target;
  const oldStatus = current.runtimeState.active_step_status;
  const newStatus = delta.status;
  const legal = oldStatus === newStatus
    || (oldStatus === 'ready' && ['in-progress', 'completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'in-progress' && ['completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'blocked' && executionMode === 'repair' && ['in-progress', 'completed'].includes(newStatus));
  if (!legal) fail('TASK_STATE_TRANSITION_INVALID', `Cannot transition active step from ${oldStatus} to ${newStatus}.`);
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
    if (checkpoint === 'required' && delta.review_receipt === undefined) {
      fail('REVIEW_CHECKPOINT_REQUIRED', `step ${delta.step_id} requires a clean review checkpoint before advancement.`);
    }
    if (delta.review_receipt !== undefined) {
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
      const repairFingerprints = [...new Set(currentStepRepairLogs.map(item => {
        if (!item.repair_fingerprint) fail('REPAIR_VERIFICATION_REQUIRED', 'a repair execution record is missing its finding fingerprint.');
        if (!item.diff_target) fail('REPAIR_DIFF_TARGET_REQUIRED', 'a repair execution record is missing its logical diff target.');
        return item.repair_fingerprint;
      }))];
      const repairTargets = [...new Set(currentStepRepairLogs.map(item => item.diff_target!))];
      if (repairTargets.length !== 1) fail('REPAIR_DIFF_TARGET_CONFLICT', 'all repair attempts for one step must use the same logical diff target.');
      const receipt = delta.review_receipt;
      if (!receipt) fail('REVIEW_VERIFICATION_REQUIRED', 'repair completion requires a clean verification receipt before advancement.');
      if (receipt.diff_target !== repairTargets[0]) fail('REPAIR_DIFF_TARGET_CONFLICT', 'verification must cover the exact logical diff target repaired by the current step.');
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
    } else {
      advancement = {
        ...advancement,
        outcome: 'task-complete',
        to_step_id: null,
      };
    }
  }
  const executionLog = [
    ...current.runtimeState.execution_log,
    {
      idempotency_key: proposal.idempotency_key,
      mode: executionMode,
      step_id: delta.step_id,
      status: newStatus,
      evidence_refs: [...delta.evidence_refs],
      ...(delta.note ? { note: delta.note } : {}),
      ...(delta.repair_fingerprint ? { repair_fingerprint: delta.repair_fingerprint } : {}),
      ...(executionDiffTarget ? { diff_target: executionDiffTarget } : {}),
      checkpoint,
      advancement: advancement.outcome,
      next_step_id: advancement.to_step_id,
      ...(delta.review_receipt ? { review_receipt: delta.review_receipt } : {}),
      recorded_at: now,
    },
  ].slice(-MAX_EXECUTION_LOG);
  const next: RuntimeState = {
    ...current.runtimeState,
    active_step_id: advancement.outcome === 'advanced' ? advancement.to_step_id! : current.runtimeState.active_step_id,
    active_step_status: advancement.outcome === 'advanced' ? 'ready' : newStatus,
    execution_log: executionLog,
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
  };
  return {
    next,
    findingStatus: delta.repair_fingerprint ? current.runtimeState.findings.find(item => item.fingerprint === delta.repair_fingerprint)?.status : undefined,
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
        repair_attempts: 0,
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
      assertExecutionAuditInBody(current.body, audit);
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

type RollbackVerification = {
  verified: boolean;
  detail: string;
};

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

export class GovernanceTransactionKernel {
  readonly root: string;
  private readonly readCurrentTask: CurrentTaskReader;

  constructor(root: string, readCurrentTask: CurrentTaskReader = readCanonicalCurrentTask) {
    this.root = path.resolve(root);
    this.readCurrentTask = readCurrentTask;
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
      const readBack = this.readCurrentTask(this.root);
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

  private commitLifecycleTransaction(
    current: CanonicalCurrentTask,
    proposal: LifecycleProposal,
    plan: LifecycleTransactionPlan,
    options: RuntimeApplyOptions,
  ): RuntimeResult {
    const nextRevision = sha256(plan.nextContent);
    if (proposal.mode === 'supersede') {
      if (options.dryRun) {
        return buildResult('success', proposal, current, options, 'typed supersede proposal validated; canonical CURRENT_TASK write planned (dry-run).', {
          previous_revision: current.sourceTuple.revision,
          resulting_revision: nextRevision,
          state: resultState(plan.next),
        });
      }
      try {
        executeWrites(
          [{ path: current.filePath, content: plan.nextContent }],
          false,
          'vNext Runtime supersede lifecycle transaction committed',
        );
      } catch (error) {
        return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: 'ATOMIC_COMMIT_FAILED' });
      }
      try {
        const readBack = this.readCurrentTask(this.root);
        if (readBack.raw !== plan.nextContent || readBack.sourceTuple.revision !== nextRevision) {
          throw new Error('canonical CURRENT_TASK read-back did not match the staged supersede document.');
        }
        if (readBack.runtimeState.workflow_status !== 'superseded' || readBack.runtimeState.lifecycle_state !== 'active') {
          throw new Error('supersede CURRENT_TASK read-back did not preserve the superseded + active tuple.');
        }
        return buildResult('success', proposal, current, options, 'typed supersede proposal committed; canonical CURRENT_TASK read-back verified.', {
          committed: true,
          governed_mutation_count: 1,
          previous_revision: current.sourceTuple.revision,
          resulting_revision: nextRevision,
          read_back_verified: true,
          state: resultState(readBack.runtimeState),
        });
      } catch (error) {
        const rollback = rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
        return buildResult(
          'blocked',
          proposal,
          current,
          options,
          rollback.verified
            ? `Runtime supersede read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.`
            : `Runtime supersede read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`,
          { code: rollback.verified ? 'READ_BACK_FAILED' : 'ROLLBACK_FAILED' },
        );
      }
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
      const readBack = this.readCurrentTask(this.root);
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

    let current: CanonicalCurrentTask;
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

    try {
      if (proposal.source_tuple.path !== current.relativePath) fail('RUNTIME_PATH_INVALID', 'proposal source path is not the exact canonical CURRENT_TASK path.');
      if (proposal.operation_kind === 'lifecycle-transaction') {
        assertRequestedLifecycleTargets(this.root, current, proposal as LifecycleProposal);
      } else if (proposal.operation_kind === 'archive-transaction' || proposal.operation_kind === 'project-status-transaction' || proposal.operation_kind === 'lesson-record-transaction') {
        assertRequestedCloseTargets(this.root, current, proposal);
      } else if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== current.relativePath) {
        fail('RUNTIME_PATH_INVALID', 'proposal write target is not the exact canonical CURRENT_TASK path.');
      }
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_PATH_INVALID' });
    }
    const proposalDigest = digest(proposal);
    const prior = current.runtimeState.applied_proposals.find(item => item.idempotency_key === proposal.idempotency_key);
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
          assertTaskStateReplay(current, proposal);
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

    let nextContent: string;
    try {
      nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, transition.next, {
        ...(transition.replacementDefinition ? { replacementDefinition: transition.replacementDefinition } : {}),
        ...(transition.draftDefinition ? { draftDefinition: transition.draftDefinition } : {}),
        ...(transition.draftIdentity ? { draftIdentity: transition.draftIdentity } : {}),
        ...(transition.draftDocumentId ? { draftDocumentId: transition.draftDocumentId } : {}),
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

    try {
      executeWrites(
        [{ path: current.filePath, content: nextContent }],
        false,
        `vNext Runtime ${proposal.operation_kind} committed`,
      );
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: 'ATOMIC_COMMIT_FAILED' });
    }

    try {
      const readBack = this.readCurrentTask(this.root);
      if (readBack.raw !== nextContent || readBack.sourceTuple.revision !== nextRevision) {
        const rollback = rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
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
      return buildResult('success', proposal, current, options, 'typed proposal committed and canonical source read-back verified.', {
        committed: true,
        governed_mutation_count: 1,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        read_back_verified: true,
        state: resultState(readBack.runtimeState, transition.findingStatus),
        ...(transition.advancement ? { advancement: transition.advancement } : {}),
      });
    } catch (error) {
      const rollback = rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
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
    diff_target?: string;
    review_receipt?: StepReviewReceipt;
  },
): RuntimeProposal {
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
      ...(input.diff_target ? { diff_target: input.diff_target } : {}),
      ...(input.review_receipt ? { review_receipt: input.review_receipt } : {}),
    },
    preconditions: ['current-task-is-active', 'active-step-matches', 'scope-admitted'],
    evidence_refs: input.evidence_refs,
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

export function createPrepareTaskDraftProposal(
  current: CanonicalCurrentTask,
  input: {
    action: 'create-draft' | 'update-draft';
    task_id: string;
    task_slug: string;
    document_id?: string;
    task_title: string;
    draft_definition: DraftTaskDefinition;
    active_step_id: string;
    evidence_refs: string[];
    idempotency_key: string;
    authority_evidence: AuthorityEvidence[];
  },
): RuntimeProposal {
  const documentId = input.document_id ?? generatedDraftDocumentId(input, current.sourceTuple.revision);
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
      draft_definition: input.draft_definition,
      active_step_id: input.active_step_id,
      evidence_refs: input.evidence_refs,
    },
    preconditions: input.action === 'create-draft'
      ? ['current-task-is-closed-and-archived', 'next-unused-task-identity', 'closed-draft-definition']
      : ['current-task-is-draft-and-active', 'same-task-identity', 'closed-draft-definition'],
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
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
    evidence_refs: input.evidence_refs,
    idempotency_key: input.idempotency_key,
    requested_write_targets: [current.relativePath],
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
    planned_operations: [],
    governed_mutation_count: 0,
  };
  if (!parsed.delta) return base;
  base.delivery_summary = parsed.delta.delivery_summary;
  base.lesson_admission = parsed.delta.lesson_admission;
  const resolvedRoot = root ?? rootForCurrentTask(current);
  if (current.runtimeState.workflow_status === 'closed' && current.runtimeState.lifecycle_state === 'archived') {
    try {
      const { audit } = matchingArchiveReceipt(resolvedRoot, current);
      if (digest(parsed.delta) !== audit.closure_delta_digest) fail('ARCHIVE_PROVENANCE_MISMATCH', 'preview closure evidence does not match the committed archive receipt.');
      if (parsed.delta.lesson_admission.decision !== audit.lesson_admission.decision || parsed.delta.lesson_admission.candidate_refs.join('|') !== audit.lesson_admission.candidate_refs.join('|') || parsed.delta.lesson_admission.evidence_refs.join('|') !== audit.lesson_admission.evidence_refs.join('|')) {
        fail('ARCHIVE_PROVENANCE_MISMATCH', 'preview lesson admission does not match the committed archive receipt.');
      }
      base.status = 'reconciliation';
      base.closure_eligibility = { eligible: true, blockers: [] };
      base.planned_operations = ['project-status-transaction', ...(parsed.delta.lesson_admission.decision === 'admit' ? ['lesson-record-transaction' as const] : [])];
      return base;
    } catch (error) {
      base.closure_eligibility.blockers.push(error instanceof Error ? error.message : String(error));
      return base;
    }
  }
  const archiveExists = fs.existsSync(archivePathForTask(resolvedRoot, current).filePath);
  const blockers = closureEligibilityBlockers(current, parsed.delta, archiveExists);
  base.closure_eligibility = { eligible: blockers.length === 0, blockers };
  if (blockers.length === 0) {
    base.status = 'eligible';
    base.planned_operations = ['archive-transaction', 'project-status-transaction', ...(parsed.delta.lesson_admission.decision === 'admit' ? ['lesson-record-transaction' as const] : [])];
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
  conditionalAuthorizationsFile?: string;
  transformationKind: MutationTransformationKind;
};

export function parseCli(argv: string[]): VNextRuntimeCliArguments {
  const [command = 'validate', ...rest] = argv;
  if (command !== 'validate' && command !== 'validate-contract' && command !== 'apply' && command !== 'scope-check') throw new Error('Usage: vnext-runtime <validate-contract|validate|apply|scope-check> --root <path> [--proposal-file <json>] [--path <repo-relative>] [--paths-file <path>] [--paths-stdin] [--conditional-authorizations-file <json>] [--transformation-kind <localized|inherently-broad>] [--dry-run]');
  let root = process.cwd();
  let proposalFile: string | undefined;
  let dryRun = false;
  const changedPaths: string[] = [];
  let pathsFile: string | undefined;
  let pathsStdin = false;
  let conditionalAuthorizationsFile: string | undefined;
  let transformationKind: MutationTransformationKind = 'localized';
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--proposal' || arg === '--proposal-file') proposalFile = rest[++index];
    else if (arg === '--path') changedPaths.push(rest[++index] ?? '');
    else if (arg === '--paths-file') pathsFile = rest[++index];
    else if (arg === '--paths-stdin') pathsStdin = true;
    else if (arg === '--conditional-authorizations-file') conditionalAuthorizationsFile = rest[++index];
    else if (arg === '--transformation-kind') {
      const value = rest[++index];
      if (value !== 'localized' && value !== 'inherently-broad') throw new Error('--transformation-kind must be localized or inherently-broad.');
      transformationKind = value;
    }
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, root, proposalFile, dryRun, changedPaths, pathsFile, pathsStdin, conditionalAuthorizationsFile, transformationKind };
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
  return {
    changed_paths: changedPaths,
    ...(args.conditionalAuthorizationsFile
      ? { conditional_authorizations: readCliConditionalAuthorizations(args.conditionalAuthorizationsFile) }
      : {}),
    transformation_kind: args.transformationKind,
  };
}

function validateInstalledRuntimeForCli(root: string): void {
  const runtimePackagePath = path.join(path.resolve(root), ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'), 'package.json');
  if (fs.existsSync(runtimePackagePath)) {
    validateVNextRuntimeContract(root, true);
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
      const current = readCanonicalCurrentTask(args.root);
      console.log(JSON.stringify({ status: 'success', source_tuple: current.sourceTuple, runtime_state: current.runtimeState }, null, 2));
    } else if (args.command === 'scope-check') {
      validateInstalledRuntimeForCli(args.root);
      const current = readCanonicalCurrentTask(args.root);
      const scope = parseMutationScope(current.body, current.sourceTuple.revision);
      const result = evaluateMutationScope(scope, readScopeCheckInput(args));
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked') return 2;
    } else {
      validateInstalledRuntimeForCli(args.root);
      const proposalText = args.proposalFile
        ? fs.readFileSync(path.resolve(args.proposalFile), 'utf8')
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
