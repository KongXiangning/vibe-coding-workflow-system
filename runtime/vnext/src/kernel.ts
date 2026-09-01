
/**
 * Pure-vNext state-changing Runtime slice.
 *
 * Phase 2 binds the execute-step task/finding slice plus the lifecycle and
 * same-task replan transactions. The Runtime accepts typed proposals,
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
export const PREPARE_TASK_MODES = ['default', 'replan'] as const;
export type PrepareTaskMode = (typeof PREPARE_TASK_MODES)[number];

export const LIFECYCLE_MODES = ['pause', 'interrupt', 'resume-paused', 'resume-interrupted', 'supersede'] as const;
export type LifecycleMode = (typeof LIFECYCLE_MODES)[number];

export const REVIEW_CYCLE_PHASES = ['discovery', 'verification'] as const;
export type ReviewCyclePhase = (typeof REVIEW_CYCLE_PHASES)[number];

export const STEP_STATUSES = ['ready', 'in-progress', 'completed', 'blocked'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const FINDING_STATUSES = ['admitted', 'in-progress', 'resolved', 'deferred', 'rejected'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const REPLAN_TASK_STATE_ACTIONS = ['mark-replan-blocked', 'clear-replan-block', 'commit-replan'] as const;
export type ReplanTaskStateAction = (typeof REPLAN_TASK_STATE_ACTIONS)[number];

export const REPLAN_AUDIT_ACTIONS = [
  'supersede',
  'mark-replan-blocked',
  'clear-replan-block',
  'commit-replan',
] as const;
export type ReplanAuditAction = (typeof REPLAN_AUDIT_ACTIONS)[number];

export const FINDING_ACTIONS = ['admit', 'record-repair-attempt', 'resolve', 'defer', 'reject'] as const;
export type FindingAction = (typeof FINDING_ACTIONS)[number];

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
  kind: 'active-task-owner' | 'scope-admission' | 'finding-admission' | 'evidence-admission' | 'dangerous-operation' | 'resume-review';
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

export type TaskStateDelta =
  | {
      kind: 'task-state';
      action: 'step-progress';
      step_id: string;
      status: StepStatus;
      evidence_refs: string[];
      note?: string;
      repair_fingerprint?: string;
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

export type RuntimeSemanticDelta = TaskStateDelta | FindingQueueDelta | LifecycleDelta;

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
  recorded_at: string;
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

export type ExecutionLogEntry = StepExecutionLogEntry | ReplanAuditLogEntry;

export type RuntimeProposal = {
  schema_version: typeof VNEXT_RUNTIME_SCHEMA_VERSION;
  kind: typeof VNEXT_RUNTIME_PROPOSAL_KIND;
  operation_kind: RuntimeOperationKind;
  caller: 'execute-step' | 'prepare-task' | 'task-lifecycle';
  mode: VNextExecuteStepMode | PrepareTaskMode | LifecycleMode;
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
  planned_writes: string[];
  governed_mutation_count: number;
  read_back_verified: boolean;
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
  bound_operations: RuntimeOperationKind[];
  unbound_operations: string[];
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

export function validateVNextRuntimeContract(root: string, requireDependencies = false): VNextRuntimeContractValidationResult {
  const filePath = path.join(path.resolve(root), ...VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH.split('/'));
  const contract = parseYamlMappingFile(filePath);
  expectExactKeys(contract, ['schema_version', 'kind', 'phase', 'runtime_distribution', 'proposal', 'canonical_current_task', 'concurrency', 'operations', 'unbound_operations'], 'vNext Runtime contract');
  if (contract.schema_version !== 1 || contract.kind !== 'vnext-runtime-contract' || contract.phase !== 'Phase 2') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must declare schema_version=1, kind=vnext-runtime-contract, phase=Phase 2.');
  }
  const runtimeDistribution = validateRuntimeDistributionContract(contract.runtime_distribution);
  const distributionIdentity = validateVNextRuntimeDistribution(root, runtimeDistribution, requireDependencies);
  const proposal = expectRecord(contract.proposal, 'Runtime contract.proposal');
  expectExactKeys(proposal, ['schema_version', 'kind', 'caller', 'operation_kinds', 'source_tuple', 'required_envelope', 'finding_queue_admission', 'finding_queue_repair', 'prepare_task', 'lifecycle'], 'Runtime contract.proposal');
  if (proposal.schema_version !== 1 || proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND) fail('RUNTIME_CONTRACT_INVALID', 'Runtime proposal contract has an invalid envelope marker.');
  expectSetEqual(expectStringArray(proposal.caller, 'Runtime contract.proposal.caller'), ['execute-step', 'prepare-task', 'task-lifecycle'], 'Runtime contract proposal callers');
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
  const prepareTaskContract = expectRecord(proposal.prepare_task, 'Runtime contract.proposal.prepare_task');
  expectExactKeys(prepareTaskContract, ['bound_actions', 'replan_mode', 'replan_actions'], 'Runtime contract.proposal.prepare_task');
  expectSetEqual(
    expectStringArray(prepareTaskContract.bound_actions, 'Runtime contract.proposal.prepare_task.bound_actions'),
    ['clear-resume-review-gate', ...REPLAN_TASK_STATE_ACTIONS],
    'Runtime contract prepare-task bound actions',
  );
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
  if (!Array.isArray(operations) || operations.length !== RUNTIME_OPERATION_KINDS.length) fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must declare exactly the three Phase 2 bound operations.');
  const bound: RuntimeOperationKind[] = [];
  for (const [index, rawOperation] of operations.entries()) {
    const operation = expectRecord(rawOperation, `Runtime contract.operations[${index}]`);
    expectExactKeys(operation, ['id', 'status', 'binding', 'operation', 'source_targets', 'write_targets', 'allowed_callers', 'result_states', 'atomic', 'idempotence', 'conflict_policy'], `Runtime contract.operations[${index}]`);
    const id = expectEnum(operation.id, RUNTIME_OPERATION_KINDS, `Runtime contract.operations[${index}].id`);
    if (bound.includes(id)) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} is duplicated.`);
    bound.push(id);
    if (operation.status !== 'bound' || operation.binding !== 'vnext-runtime') fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must be bound to vnext-runtime.`);
    if (operation.operation !== id) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must identify its logical operation.`);
    const expectedTargets = id === 'lifecycle-transaction'
      ? ['CURRENT_TASK.md', 'TASKS/paused/**', 'TASKS/interrupted/**']
      : ['CURRENT_TASK.md'];
    const expectedCallers = id === 'task-state-transaction'
      ? ['execute-step', 'prepare-task']
      : id === 'finding-queue-transaction'
        ? ['execute-step']
        : ['task-lifecycle'];
    expectSetEqual(
      expectStringArray(operation.source_targets, `Runtime contract.operations[${index}].source_targets`),
      expectedTargets,
      `Runtime contract operation ${id}.source_targets`,
    );
    expectSetEqual(
      expectStringArray(operation.write_targets, `Runtime contract.operations[${index}].write_targets`),
      expectedTargets,
      `Runtime contract operation ${id}.write_targets`,
    );
    expectSetEqual(expectStringArray(operation.allowed_callers, `Runtime contract.operations[${index}].allowed_callers`), expectedCallers, `Runtime contract operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray(operation.result_states, `Runtime contract.operations[${index}].result_states`), [...RUNTIME_RESULT_STATES], `Runtime contract operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== 'fail-closed' || operation.conflict_policy !== 'fail-closed') fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must be atomic, fail-closed, and conflict-safe.`);
  }
  expectSetEqual(bound, [...RUNTIME_OPERATION_KINDS], 'Runtime contract bound operations');
  const unbound = expectStringArray(contract.unbound_operations, 'Runtime contract.unbound_operations');
  expectSetEqual(unbound, ['inbox-record-transaction', 'project-status-transaction', 'archive-transaction', 'lesson-record-transaction'], 'Runtime contract unbound operations');
  return { phase: 'Phase 2', runtime_distribution: distributionIdentity, bound_operations: bound, unbound_operations: unbound };
}

function validateAuthorityEvidence(value: unknown): AuthorityEvidence[] {
  if (!Array.isArray(value) || value.length === 0) fail('RUNTIME_AUTHORITY_MISSING', 'authority_evidence must be non-empty.');
  const result: AuthorityEvidence[] = [];
  for (const [index, raw] of value.entries()) {
    const record = expectRecord(raw, `authority_evidence[${index}]`);
    expectExactKeys(record, ['kind', 'source', 'subject'], `authority_evidence[${index}]`);
    result.push({
      kind: expectEnum(record.kind, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission', 'dangerous-operation', 'resume-review'], `authority_evidence[${index}].kind`),
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
  if (/^##\s+\S/m.test(normalized)) {
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

function validateTaskStateDelta(value: unknown): TaskStateDelta {
  const record = expectRecord(value, 'semantic_delta');
  const kind = expectEnum(record.kind, ['task-state'], 'semantic_delta.kind');
  const action = expectEnum(record.action, ['step-progress', 'clear-resume-review-gate', ...REPLAN_TASK_STATE_ACTIONS], 'semantic_delta.action');
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
  if (keys.some(key => !['kind', 'action', 'step_id', 'status', 'evidence_refs', 'note', 'repair_fingerprint'].includes(key))) {
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
  const caller = expectEnum(proposal.caller, ['execute-step', 'prepare-task', 'task-lifecycle'], 'proposal.caller');
  const mode = expectEnum(proposal.mode, [...VNEXT_EXECUTE_STEP_MODES, ...PREPARE_TASK_MODES, ...LIFECYCLE_MODES], 'proposal.mode');
  const sourceTuple = validateSourceTuple(proposal.source_tuple);
  const authorityEvidence = validateAuthorityEvidence(proposal.authority_evidence);
  const preconditions = expectStringArray(proposal.preconditions, 'proposal.preconditions', false, 32);
  const evidenceRefs = validateEvidenceRefs(proposal.evidence_refs, 'proposal.evidence_refs');
  const idempotencyKey = expectString(proposal.idempotency_key, 'proposal.idempotency_key', SAFE_KEY_PATTERN);
  const requestedTargets = expectStringArray(proposal.requested_write_targets, 'proposal.requested_write_targets', false, 4)
    .map((target, index) => normalizeRepoPath(target, `proposal.requested_write_targets[${index}]`));
  const targetCount = operationKind === 'lifecycle-transaction' && mode !== 'supersede' ? 2 : 1;
  if (requestedTargets.length !== targetCount) fail('RUNTIME_PATH_INVALID', `This Runtime proposal must name exactly ${targetCount} exact write target${targetCount === 1 ? '' : 's'}.`);
  const semanticDelta = validateSemanticDelta(proposal.semantic_delta, operationKind);
  if (operationKind === 'task-state-transaction') {
    if (caller === 'prepare-task') {
      if (mode === 'default') {
        if (semanticDelta.kind !== 'task-state' || semanticDelta.action !== 'clear-resume-review-gate') fail('RUNTIME_CALLER_NOT_BOUND', 'prepare-task default mode is bound only to clear-resume-review-gate.');
      } else if (mode === 'replan') {
        if (semanticDelta.kind !== 'task-state' || !REPLAN_TASK_STATE_ACTIONS.includes(semanticDelta.action as ReplanTaskStateAction)) {
          fail('RUNTIME_CALLER_NOT_BOUND', 'prepare-task replan mode is bound only to the closed replan task-state action set.');
        }
      } else {
        fail('RUNTIME_MODE_INVALID', 'prepare-task task-state proposals must use default or replan mode.');
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
  } else {
    if (caller !== 'task-lifecycle' || !LIFECYCLE_MODES.includes(mode as LifecycleMode)) fail('RUNTIME_CALLER_NOT_BOUND', 'lifecycle-transaction is bound only to task-lifecycle lifecycle modes.');
    if (semanticDelta.kind !== 'lifecycle' || semanticDelta.action !== mode) fail('RUNTIME_MODE_INVALID', 'lifecycle mode and semantic transition must match.');
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
  const deltaRefs = semanticDelta.kind === 'task-state' ? semanticDelta.evidence_refs : semanticDelta.action === 'admit' ? semanticDelta.finding.evidence_refs : semanticDelta.evidence_refs;
  if (!deltaRefs.every(ref => evidenceRefs.includes(ref))) {
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

function validateExecutionLogEntry(value: unknown, location: string, taskId: string, taskSlug: string): ExecutionLogEntry {
  const record = expectRecord(value, location);
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

  const executionLogKeys = ['idempotency_key', 'mode', 'step_id', 'status', 'evidence_refs', 'note', 'recorded_at'];
  const missingExecutionLogKeys = executionLogKeys.filter(key => key !== 'note' && !(key in record));
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

function renderExecutionAuditRecord(audit: ReplanAuditLogEntry): string {
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
  if (audit.invalidation_kind !== undefined) lines.push(`  invalidation_kind: ${audit.invalidation_kind}`);
  if (audit.invalidation_reason !== undefined) lines.push(`  invalidation_reason: ${audit.invalidation_reason}`);
  if (audit.partial_diff_disposition !== undefined) {
    lines.push('  partial_diff_disposition:');
    lines.push(`    reusable: ${auditList(audit.partial_diff_disposition.reusable)}`);
    lines.push(`    rollback_required: ${auditList(audit.partial_diff_disposition.rollback_required)}`);
    lines.push(`    stop_propagation: ${auditList(audit.partial_diff_disposition.stop_propagation)}`);
  }
  lines.push(`  recorded_at: ${audit.recorded_at}`);
  return lines.join('\n');
}

function appendExecutionAuditToBody(body: string, audit: ReplanAuditLogEntry): string {
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), ['执行记录', 'Execution Log'], 2);
  if (!section) return body;
  const existing = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, '\n').trimEnd();
  const auditText = renderExecutionAuditRecord(audit);
  const rendered = `${existing.trim().length > 0 ? `${existing}\n\n` : ''}${auditText}\n\n`;
  return body.slice(0, section.contentStart) + `\n${rendered}` + body.slice(section.contentEnd);
}

function renderCanonicalCurrentTask(
  frontmatter: AnyRecord,
  body: string,
  runtimeState: RuntimeState,
  options: { replacementDefinition?: ReplanReplacementDefinition; audit?: ReplanAuditLogEntry } = {},
): string {
  const nextFrontmatter: AnyRecord = { ...frontmatter, runtime_state: runtimeState };
  let nextBody = options.replacementDefinition
    ? replaceReplanDefinitionSections(body, options.replacementDefinition)
    : body;
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
  const deltaEvidenceRefs = delta.kind === 'finding-queue'
    ? delta.action === 'admit' ? delta.finding.evidence_refs : delta.evidence_refs
    : delta.evidence_refs;

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

function expectedReplanReplayAudit(current: CanonicalCurrentTask, proposal: RuntimeProposal): ReplanAuditLogEntry {
  const entry = current.runtimeState.execution_log.find(item =>
    'action' in item && item.idempotency_key === proposal.idempotency_key,
  );
  if (!entry || !('action' in entry)) fail('RUNTIME_REPLAY_INCOMPLETE', 'replan replay is missing its durable execution audit record.');
  return entry;
}

function assertNoLaterReplanAudit(current: CanonicalCurrentTask, audit: ReplanAuditLogEntry): void {
  const index = current.runtimeState.execution_log.findIndex(item => item === audit);
  if (index < 0) fail('RUNTIME_REPLAY_INCOMPLETE', 'replan replay audit record is not part of the current execution log.');
  if (current.runtimeState.execution_log.slice(index + 1).some(item => 'action' in item)) {
    fail('RUNTIME_REPLAY_INCOMPLETE', 'a later same-task lifecycle or replan transition has changed the replay boundary.');
  }
}

function assertTaskStateReplay(current: CanonicalCurrentTask, proposal: RuntimeProposal): void {
  if (proposal.semantic_delta.kind !== 'task-state' || !REPLAN_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action as ReplanTaskStateAction)) return;
  const delta = proposal.semantic_delta as Extract<TaskStateDelta, { action: ReplanTaskStateAction }>;
  const audit = expectedReplanReplayAudit(current, proposal);
  assertNoLaterReplanAudit(current, audit);
  if (delta.action === 'mark-replan-blocked') {
    if (current.runtimeState.workflow_status !== 'blocked_by_replan' || current.runtimeState.lifecycle_state !== 'active') fail('RUNTIME_REPLAY_INCOMPLETE', 'mark-replan-blocked replay no longer has the blocked_by_replan + active tuple.');
  } else if (delta.action === 'clear-replan-block') {
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') fail('RUNTIME_REPLAY_INCOMPLETE', 'clear-replan-block replay no longer has the active + active tuple.');
  } else {
    if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has the active + active tuple.');
    if (current.runtimeState.active_step_id !== delta.active_step_id || current.runtimeState.active_step_status !== 'ready') fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has the replacement active step ready.');
    if (current.runtimeState.resume_requires_review || current.runtimeState.resume_review_reasons.length > 0) fail('RUNTIME_REPLAY_INCOMPLETE', 'commit-replan replay no longer has a cleared resume gate.');
    assertReplanDefinitionSections(current.body, delta.replacement_definition);
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
  audit?: ReplanAuditLogEntry;
};

function applyTaskStateDelta(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  now: string,
): StateTransition {
  if (proposal.semantic_delta.kind !== 'task-state') fail('RUNTIME_SCHEMA_INVALID', 'Expected task-state delta.');
  const delta = proposal.semantic_delta;
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
  ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
  if (current.runtimeState.workflow_status !== 'active' || current.runtimeState.lifecycle_state !== 'active') {
    fail('TASK_STATE_NOT_ACTIVE', 'execute-step requires the current task to be active + active.');
  }
  if (current.runtimeState.resume_requires_review) {
    fail('RESUME_REVIEW_REQUIRED', 'execute-step cannot proceed until prepare-task clears the resume review gate.');
  }
  if (delta.step_id !== current.runtimeState.active_step_id) fail('ACTIVE_STEP_CONFLICT', 'Proposal step_id does not match the admitted current step.');
  const executionMode = proposal.mode as VNextExecuteStepMode;
  if (executionMode === 'repair') {
    if (!delta.repair_fingerprint) fail('FINDING_ADMISSION_REQUIRED', 'repair mode requires repair_fingerprint.');
    const finding = current.runtimeState.findings.find(item => item.fingerprint === delta.repair_fingerprint);
    if (!finding || !['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_ADMISSION_REQUIRED', 'repair fingerprint is not an admitted current-task finding.');
  }
  const oldStatus = current.runtimeState.active_step_status;
  const newStatus = delta.status;
  const legal = oldStatus === newStatus
    || (oldStatus === 'ready' && ['in-progress', 'completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'in-progress' && ['completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'blocked' && executionMode === 'repair' && ['in-progress', 'completed'].includes(newStatus));
  if (!legal) fail('TASK_STATE_TRANSITION_INVALID', `Cannot transition active step from ${oldStatus} to ${newStatus}.`);
  const executionLog = [
    ...current.runtimeState.execution_log,
    {
      idempotency_key: proposal.idempotency_key,
      mode: executionMode,
      step_id: delta.step_id,
      status: newStatus,
      evidence_refs: [...delta.evidence_refs],
      ...(delta.note ? { note: delta.note } : {}),
      recorded_at: now,
    },
  ].slice(-MAX_EXECUTION_LOG);
  const next: RuntimeState = {
    ...current.runtimeState,
    active_step_status: newStatus,
    execution_log: executionLog,
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision),
  };
  return { next, findingStatus: delta.repair_fingerprint ? current.runtimeState.findings.find(item => item.fingerprint === delta.repair_fingerprint)?.status : undefined };
}

function applyFindingQueueDelta(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  now: string,
): StateTransition {
  if (proposal.semantic_delta.kind !== 'finding-queue') fail('RUNTIME_SCHEMA_INVALID', 'Expected finding-queue delta.');
  ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission']);
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
      const audit = current.runtimeState.execution_log.find(item =>
        'action' in item && item.action === 'supersede' && item.idempotency_key === proposal.idempotency_key,
      );
      if (!audit || !('action' in audit) || audit.invalidation_kind !== delta.invalidation_kind || audit.invalidation_reason !== delta.invalidation_reason || audit.source_revision !== proposal.source_tuple.revision || audit.evidence_refs.join('|') !== delta.evidence_refs.join('|') || digest(audit.partial_diff_disposition) !== digest(delta.partial_diff_disposition)) {
        fail('LIFECYCLE_REPLAY_INCOMPLETE', 'supersede replay is missing its durable invalidation audit record.');
      }
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

export class GovernanceTransactionKernel {
  readonly root: string;
  private readonly readCurrentTask: CurrentTaskReader;

  constructor(root: string, readCurrentTask: CurrentTaskReader = readCanonicalCurrentTask) {
    this.root = path.resolve(root);
    this.readCurrentTask = readCurrentTask;
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
    let transition: { next: RuntimeState; findingStatus?: FindingStatus };
    try {
      transition = proposal.operation_kind === 'task-state-transaction'
        ? applyTaskStateDelta(current, proposal, now)
        : applyFindingQueueDelta(current, proposal, now);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED' });
    }

    let nextContent: string;
    try {
      nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, transition.next, {
        ...(transition.replacementDefinition ? { replacementDefinition: transition.replacementDefinition } : {}),
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

export function parseCli(argv: string[]): { command: 'validate' | 'validate-contract' | 'apply'; root: string; proposalFile?: string; dryRun: boolean } {
  const [command = 'validate', ...rest] = argv;
  if (command !== 'validate' && command !== 'validate-contract' && command !== 'apply') throw new Error('Usage: vnext-runtime <validate-contract|validate|apply> --root <path> [--proposal-file <json>] [--dry-run]');
  let root = process.cwd();
  let proposalFile: string | undefined;
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--proposal' || arg === '--proposal-file') proposalFile = rest[++index];
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, root, proposalFile, dryRun };
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
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
