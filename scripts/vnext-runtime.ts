#!/usr/bin/env bun

/**
 * Pure-vNext state-changing Runtime slice.
 *
 * Phase 2 intentionally binds only the two operations needed by
 * `execute-step`: task-state and finding-queue.  The Runtime accepts typed
 * proposals, validates the canonical source tuple and exact write target,
 * renders one canonical CURRENT_TASK document in memory, commits atomically,
 * and reads the result back before reporting success.
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
} from './workflow-core';
import {
  extractCurrentTaskStateFromCurrentTask,
  extractTaskIdentityFromCurrentTask,
  validateTaskId,
  validateTaskSlug,
} from './task-identity';

export const VNEXT_RUNTIME_SCHEMA_VERSION = 1 as const;
export const VNEXT_RUNTIME_PROPOSAL_KIND = 'vnext-runtime-proposal' as const;
export const VNEXT_CURRENT_TASK_KIND = 'vnext-current-task' as const;
export const VNEXT_RUNTIME_STATE_KIND = 'vnext-current-task-runtime-state' as const;
export const VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH = '.workflow-system/vnext/RUNTIME_CONTRACT.yaml';

export const RUNTIME_OPERATION_KINDS = [
  'task-state-transaction',
  'finding-queue-transaction',
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
  'active_step_id',
  'active_step_status',
  'finding_queue_revision',
  'repair_round',
  'findings',
  'execution_log',
  'applied_proposals',
] as const;

export const RUNTIME_RESULT_STATES = ['success', 'no-op', 'conflict', 'blocked'] as const;
export type RuntimeResultState = (typeof RUNTIME_RESULT_STATES)[number];

export const VNEXT_EXECUTE_STEP_MODES = ['default', 'repair'] as const;
export type VNextExecuteStepMode = (typeof VNEXT_EXECUTE_STEP_MODES)[number];

export const STEP_STATUSES = ['ready', 'in-progress', 'completed', 'blocked'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const FINDING_STATUSES = ['admitted', 'in-progress', 'resolved', 'deferred', 'rejected'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

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
const CURRENT_TASK_RELATIVE_FALLBACK = 'docs/workflow/CURRENT_TASK.md';

type AnyRecord = Record<string, unknown>;

export type AuthorityEvidence = {
  kind: 'active-task-owner' | 'scope-admission' | 'finding-admission' | 'evidence-admission' | 'dangerous-operation';
  source: string;
  subject: string;
};

export type RuntimeSourceTuple = {
  path: string;
  revision: string;
  document_id: string;
  task_id: string;
  task_slug: string;
  workflow_status: string;
  lifecycle_state: string;
  active_step_id: string;
  active_step_status: StepStatus;
  finding_queue_revision: number;
};

export type TaskStateDelta = {
  kind: 'task-state';
  action: 'step-progress';
  step_id: string;
  status: StepStatus;
  evidence_refs: string[];
  note?: string;
  repair_fingerprint?: string;
};

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
  admitted_at: string;
  updated_at: string;
};

export type FindingQueueDelta =
  | {
      kind: 'finding-queue';
      action: 'admit';
      finding: Omit<FindingRecord, 'status' | 'repair_attempts' | 'admitted_at' | 'updated_at'> & {
        status?: 'admitted';
        repair_attempts?: 0;
      };
    }
  | {
      kind: 'finding-queue';
      action: 'record-repair-attempt' | 'resolve' | 'defer' | 'reject';
      fingerprint: string;
      evidence_refs: string[];
      note?: string;
    };

export type RuntimeSemanticDelta = TaskStateDelta | FindingQueueDelta;

export type RuntimeProposal = {
  schema_version: typeof VNEXT_RUNTIME_SCHEMA_VERSION;
  kind: typeof VNEXT_RUNTIME_PROPOSAL_KIND;
  operation_kind: RuntimeOperationKind;
  caller: 'execute-step';
  mode: VNextExecuteStepMode;
  source_tuple: RuntimeSourceTuple;
  authority_evidence: AuthorityEvidence[];
  semantic_delta: RuntimeSemanticDelta;
  preconditions: string[];
  evidence_refs: string[];
  idempotency_key: string;
  requested_write_targets: string[];
};

export type RuntimeState = {
  schema_version: typeof VNEXT_RUNTIME_SCHEMA_VERSION;
  kind: typeof VNEXT_RUNTIME_STATE_KIND;
  task_id: string;
  task_slug: string;
  workflow_status: 'active';
  lifecycle_state: 'active';
  active_step_id: string;
  active_step_status: StepStatus;
  finding_queue_revision: number;
  repair_round: number;
  findings: FindingRecord[];
  execution_log: Array<{
    idempotency_key: string;
    mode: VNextExecuteStepMode;
    step_id: string;
    status: StepStatus;
    evidence_refs: string[];
    note?: string;
    recorded_at: string;
  }>;
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
    active_step_id: string;
    active_step_status: StepStatus;
    finding_queue_revision: number;
    repair_round: number;
    finding_status?: FindingStatus;
  };
};

export type RuntimeApplyOptions = {
  dryRun?: boolean;
  now?: () => string;
};

export type VNextRuntimeContractValidationResult = {
  phase: 'Phase 2';
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
  if (!match) fail('RUNTIME_SCHEMA_INVALID', `${location} is missing a YAML frontmatter block.`);
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    fail('RUNTIME_SCHEMA_INVALID', `${location} has invalid frontmatter YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  }
  return { frontmatter: expectRecord(document.toJS(), `${location} frontmatter`), body: match[2] };
}

function parseYamlMappingFile(filePath: string): AnyRecord {
  if (!fs.existsSync(filePath)) fail('RUNTIME_CONTRACT_MISSING', `Runtime contract is missing: ${filePath}`);
  const document = parseDocument(fs.readFileSync(filePath, 'utf8'), { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) fail('RUNTIME_CONTRACT_INVALID', `${filePath} has invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  return expectRecord(document.toJS(), filePath);
}

export function validateVNextRuntimeContract(root: string): VNextRuntimeContractValidationResult {
  const filePath = path.join(path.resolve(root), ...VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH.split('/'));
  const contract = parseYamlMappingFile(filePath);
  expectExactKeys(contract, ['schema_version', 'kind', 'phase', 'proposal', 'canonical_current_task', 'operations', 'unbound_operations'], 'vNext Runtime contract');
  if (contract.schema_version !== 1 || contract.kind !== 'vnext-runtime-contract' || contract.phase !== 'Phase 2') {
    fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must declare schema_version=1, kind=vnext-runtime-contract, phase=Phase 2.');
  }
  const proposal = expectRecord(contract.proposal, 'Runtime contract.proposal');
  expectExactKeys(proposal, ['schema_version', 'kind', 'caller', 'operation_kinds', 'source_tuple', 'required_envelope'], 'Runtime contract.proposal');
  if (proposal.schema_version !== 1 || proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND || proposal.caller !== 'execute-step') fail('RUNTIME_CONTRACT_INVALID', 'Runtime proposal contract has an invalid envelope marker.');
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
  expectExactKeys(runtimeState, ['schema_version', 'kind', 'fields'], 'Runtime contract.canonical_current_task.runtime_state');
  if (runtimeState.schema_version !== 1 || runtimeState.kind !== VNEXT_RUNTIME_STATE_KIND) fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract runtime-state marker is invalid.');
  expectSetEqual(
    expectStringArray(runtimeState.fields, 'Runtime contract.canonical_current_task.runtime_state.fields'),
    [...RUNTIME_STATE_FIELDS],
    'Runtime contract runtime-state fields',
  );
  if (canonical.source_of_truth !== 'same-canonical-CURRENT_TASK-document' || canonical.legacy_schema_behavior !== 'migration-required') fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must keep CURRENT_TASK as the only state source and stop on legacy schema.');
  const operations = contract.operations;
  if (!Array.isArray(operations) || operations.length !== RUNTIME_OPERATION_KINDS.length) fail('RUNTIME_CONTRACT_INVALID', 'Runtime contract must declare exactly the two Phase 2 bound operations.');
  const bound: RuntimeOperationKind[] = [];
  for (const [index, rawOperation] of operations.entries()) {
    const operation = expectRecord(rawOperation, `Runtime contract.operations[${index}]`);
    expectExactKeys(operation, ['id', 'status', 'binding', 'handler', 'source_targets', 'write_targets', 'allowed_callers', 'result_states', 'atomic', 'idempotence', 'conflict_policy'], `Runtime contract.operations[${index}]`);
    const id = expectEnum(operation.id, RUNTIME_OPERATION_KINDS, `Runtime contract.operations[${index}].id`);
    if (bound.includes(id)) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} is duplicated.`);
    bound.push(id);
    if (operation.status !== 'bound' || operation.binding !== 'vnext-runtime') fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must be bound to vnext-runtime.`);
    const handler = normalizeRepoPath(expectString(operation.handler, `Runtime contract.operations[${index}].handler`), `Runtime contract.operations[${index}].handler`);
    if (handler !== 'scripts/vnext-runtime.ts') fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must use scripts/vnext-runtime.ts.`);
    if (!fs.existsSync(path.join(path.resolve(root), ...handler.split('/')))) fail('RUNTIME_CONTRACT_INVALID', `Runtime contract handler is missing: ${handler}`);
    expectSetEqual(
      expectStringArray(operation.source_targets, `Runtime contract.operations[${index}].source_targets`),
      ['CURRENT_TASK.md'],
      `Runtime contract operation ${id}.source_targets`,
    );
    expectSetEqual(
      expectStringArray(operation.write_targets, `Runtime contract.operations[${index}].write_targets`),
      ['CURRENT_TASK.md'],
      `Runtime contract operation ${id}.write_targets`,
    );
    expectSetEqual(expectStringArray(operation.allowed_callers, `Runtime contract.operations[${index}].allowed_callers`), ['execute-step'], `Runtime contract operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray(operation.result_states, `Runtime contract.operations[${index}].result_states`), [...RUNTIME_RESULT_STATES], `Runtime contract operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== 'fail-closed' || operation.conflict_policy !== 'fail-closed') fail('RUNTIME_CONTRACT_INVALID', `Runtime contract operation ${id} must be atomic, fail-closed, and conflict-safe.`);
  }
  expectSetEqual(bound, [...RUNTIME_OPERATION_KINDS], 'Runtime contract bound operations');
  const unbound = expectStringArray(contract.unbound_operations, 'Runtime contract.unbound_operations');
  expectSetEqual(unbound, ['lifecycle-transaction', 'inbox-record-transaction', 'project-status-transaction', 'archive-transaction', 'lesson-record-transaction'], 'Runtime contract unbound operations');
  return { phase: 'Phase 2', bound_operations: bound, unbound_operations: unbound };
}

function validateAuthorityEvidence(value: unknown): AuthorityEvidence[] {
  if (!Array.isArray(value) || value.length === 0) fail('RUNTIME_AUTHORITY_MISSING', 'authority_evidence must be non-empty.');
  const result: AuthorityEvidence[] = [];
  for (const [index, raw] of value.entries()) {
    const record = expectRecord(raw, `authority_evidence[${index}]`);
    expectExactKeys(record, ['kind', 'source', 'subject'], `authority_evidence[${index}]`);
    result.push({
      kind: expectEnum(record.kind, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission', 'dangerous-operation'], `authority_evidence[${index}].kind`),
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
    ['path', 'revision', 'document_id', 'task_id', 'task_slug', 'workflow_status', 'lifecycle_state', 'active_step_id', 'active_step_status', 'finding_queue_revision'],
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
  return {
    path: normalizeRepoPath(expectString(record.path, 'source_tuple.path'), 'source_tuple.path'),
    revision,
    document_id: documentId,
    task_id: taskId,
    task_slug: taskSlug,
    workflow_status: expectString(record.workflow_status, 'source_tuple.workflow_status'),
    lifecycle_state: expectString(record.lifecycle_state, 'source_tuple.lifecycle_state'),
    active_step_id: expectString(record.active_step_id, 'source_tuple.active_step_id', STEP_ID_PATTERN),
    active_step_status: expectEnum(record.active_step_status, STEP_STATUSES, 'source_tuple.active_step_status'),
    finding_queue_revision: expectInteger(record.finding_queue_revision, 'source_tuple.finding_queue_revision'),
  };
}

function validateEvidenceRefs(value: unknown, location: string): string[] {
  return expectStringArray(value, location, false, MAX_EVIDENCE_REFS);
}

function validateTaskStateDelta(value: unknown): TaskStateDelta {
  const record = expectRecord(value, 'semantic_delta');
  const keys = Object.keys(record);
  if (keys.some(key => !['kind', 'action', 'step_id', 'status', 'evidence_refs', 'note', 'repair_fingerprint'].includes(key))) {
    fail('RUNTIME_SCHEMA_INVALID', 'task-state semantic_delta contains unsupported fields.');
  }
  const kind = expectEnum(record.kind, ['task-state'], 'semantic_delta.kind');
  const action = expectEnum(record.action, ['step-progress'], 'semantic_delta.action');
  const result: TaskStateDelta = {
    kind,
    action,
    step_id: expectString(record.step_id, 'semantic_delta.step_id', STEP_ID_PATTERN),
    status: expectEnum(record.status, STEP_STATUSES, 'semantic_delta.status'),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, 'semantic_delta.evidence_refs'),
  };
  if (record.note !== undefined) result.note = expectText(record.note, 'semantic_delta.note');
  if (record.repair_fingerprint !== undefined) result.repair_fingerprint = expectString(record.repair_fingerprint, 'semantic_delta.repair_fingerprint', FINGERPRINT_PATTERN);
  return result;
}

function validateFindingRecord(value: unknown, location: string): FindingQueueDelta & { action: 'admit' } {
  const record = expectRecord(value, location);
  expectExactKeys(
    record,
    ['kind', 'action', 'finding'],
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
      max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.finding.max_repair_attempts`, 1, 2),
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
  const allowedKeys = ['kind', 'action', 'fingerprint', 'evidence_refs', 'note'];
  if (Object.keys(record).some(key => !allowedKeys.includes(key))) fail('RUNTIME_SCHEMA_INVALID', 'finding-queue semantic_delta contains unsupported fields.');
  const action = expectEnum(record.action, ['record-repair-attempt', 'resolve', 'defer', 'reject'], 'semantic_delta.action');
  const result: FindingQueueDelta & { action: Exclude<FindingAction, 'admit'> } = {
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
  if (kind !== 'finding-queue') fail('RUNTIME_SCHEMA_INVALID', 'finding-queue-transaction requires finding-queue semantic_delta.');
  return record.action === 'admit' ? validateFindingRecord(value) : validateFindingAction(value);
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
  if (proposal.caller !== 'execute-step') fail('RUNTIME_CALLER_NOT_BOUND', 'Phase 2 Runtime is bound only to execute-step.');
  const mode = expectEnum(proposal.mode, VNEXT_EXECUTE_STEP_MODES, 'proposal.mode');
  const sourceTuple = validateSourceTuple(proposal.source_tuple);
  const authorityEvidence = validateAuthorityEvidence(proposal.authority_evidence);
  const preconditions = expectStringArray(proposal.preconditions, 'proposal.preconditions', false, 32);
  const evidenceRefs = validateEvidenceRefs(proposal.evidence_refs, 'proposal.evidence_refs');
  const idempotencyKey = expectString(proposal.idempotency_key, 'proposal.idempotency_key', SAFE_KEY_PATTERN);
  const requestedTargets = expectStringArray(proposal.requested_write_targets, 'proposal.requested_write_targets', false, 4)
    .map((target, index) => normalizeRepoPath(target, `proposal.requested_write_targets[${index}]`));
  if (requestedTargets.length !== 1) fail('RUNTIME_PATH_INVALID', 'Phase 2 proposals must name exactly one CURRENT_TASK write target.');
  const semanticDelta = validateSemanticDelta(proposal.semantic_delta, operationKind);
  if (mode === 'repair' && operationKind === 'finding-queue-transaction' && semanticDelta.kind !== 'finding-queue') {
    fail('RUNTIME_MODE_INVALID', 'repair mode requires a finding-queue proposal or a task repair delta.');
  }
  const result: RuntimeProposal = {
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: operationKind,
    caller: 'execute-step',
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
    ['fingerprint', 'category', 'owner_task_id', 'scope', 'decision', 'file', 'failure_condition', 'violated_invariant', 'root_cause_status', 'status', 'repair_attempts', 'max_repair_attempts', 'evidence_refs', 'review_cycle_id', 'admitted_at', 'updated_at'],
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
    repair_attempts: expectInteger(finding.repair_attempts, `${location}.repair_attempts`, 0, 2),
    max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.max_repair_attempts`, 1, 2),
    evidence_refs: validateEvidenceRefs(finding.evidence_refs, `${location}.evidence_refs`),
    review_cycle_id: expectString(finding.review_cycle_id, `${location}.review_cycle_id`, SAFE_KEY_PATTERN),
    admitted_at: expectString(finding.admitted_at, `${location}.admitted_at`),
    updated_at: expectString(finding.updated_at, `${location}.updated_at`),
  };
}

export function validateVNextRuntimeState(value: unknown): RuntimeState {
  const runtime = expectRecord(value, 'runtime_state');
  expectExactKeys(
    runtime,
    ['schema_version', 'kind', 'task_id', 'task_slug', 'workflow_status', 'lifecycle_state', 'active_step_id', 'active_step_status', 'finding_queue_revision', 'repair_round', 'findings', 'execution_log', 'applied_proposals'],
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
  if (runtime.workflow_status !== 'active' || runtime.lifecycle_state !== 'active') {
    fail('RUNTIME_STATE_NOT_ACTIVE', 'Phase 2 execute-step requires workflow_status=active and lifecycle_state=active.');
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
  const executionLog = executionLogValue.map((entry, index) => {
    const record = expectRecord(entry, `runtime_state.execution_log[${index}]`);
    const executionLogKeys = ['idempotency_key', 'mode', 'step_id', 'status', 'evidence_refs', 'note', 'recorded_at'];
    const missingExecutionLogKeys = executionLogKeys.filter(key => key !== 'note' && !(key in record));
    const extraExecutionLogKeys = Object.keys(record).filter(key => !executionLogKeys.includes(key));
    if (missingExecutionLogKeys.length > 0 || extraExecutionLogKeys.length > 0) fail('RUNTIME_SCHEMA_INVALID', `runtime_state.execution_log[${index}] keys mismatch; missing=[${missingExecutionLogKeys.join(', ')}], unexpected=[${extraExecutionLogKeys.join(', ')}].`);
    const result: RuntimeState['execution_log'][number] = {
      idempotency_key: expectString(record.idempotency_key, `runtime_state.execution_log[${index}].idempotency_key`, SAFE_KEY_PATTERN),
      mode: expectEnum(record.mode, VNEXT_EXECUTE_STEP_MODES, `runtime_state.execution_log[${index}].mode`),
      step_id: expectString(record.step_id, `runtime_state.execution_log[${index}].step_id`, STEP_ID_PATTERN),
      status: expectEnum(record.status, STEP_STATUSES, `runtime_state.execution_log[${index}].status`),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, `runtime_state.execution_log[${index}].evidence_refs`),
      recorded_at: expectString(record.recorded_at, `runtime_state.execution_log[${index}].recorded_at`),
    };
    if (record.note !== undefined && record.note !== null) result.note = expectText(record.note, `runtime_state.execution_log[${index}].note`);
    return result;
  });
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
  const recordedRepairAttempts = findings.reduce((sum, finding) => sum + finding.repair_attempts, 0);
  const repairRound = expectInteger(runtime.repair_round, 'runtime_state.repair_round', 0, 3);
  if (recordedRepairAttempts > repairRound) fail('RUNTIME_STATE_CONFLICT', 'runtime_state.repair_round is lower than recorded finding repair attempts.');
  return {
    schema_version: 1,
    kind: VNEXT_RUNTIME_STATE_KIND,
    task_id: taskId,
    task_slug: taskSlug,
    workflow_status: 'active',
    lifecycle_state: 'active',
    active_step_id: activeStepId,
    active_step_status: activeStepStatus,
    finding_queue_revision: expectInteger(runtime.finding_queue_revision, 'runtime_state.finding_queue_revision'),
    repair_round: repairRound,
    findings,
    execution_log: executionLog,
    applied_proposals: appliedProposals,
  };
}

function renderCanonicalCurrentTask(frontmatter: AnyRecord, body: string, runtimeState: RuntimeState): string {
  const nextFrontmatter: AnyRecord = { ...frontmatter, runtime_state: runtimeState };
  return `---\n${stringify(nextFrontmatter).trimEnd()}\n---\n${body}`;
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

export function readCanonicalCurrentTask(root: string): CanonicalCurrentTask {
  const { filePath, relativePath } = currentTaskPathForRoot(root);
  if (!fs.existsSync(filePath)) fail('RUNTIME_SOURCE_MISSING', `CURRENT_TASK.md is missing: ${relativePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = parseYamlFrontmatter(raw, relativePath);
  expectExactKeys(frontmatter, ['schema_version', 'kind', 'document_id', 'runtime_state'], `${relativePath} frontmatter`);
  if (frontmatter.schema_version !== 1 || frontmatter.kind !== VNEXT_CURRENT_TASK_KIND) {
    fail('MIGRATION_REQUIRED', `${relativePath} is not a pure vNext CURRENT_TASK document.`);
  }
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
  };
  return { filePath, relativePath, raw, frontmatter, body, runtimeState, sourceTuple };
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
  ];
  for (const field of fields) {
    if (expected[field] !== actual[field]) return field;
  }
  return null;
}

function applyTaskStateDelta(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  now: string,
): { next: RuntimeState; findingStatus?: FindingStatus } {
  if (proposal.semantic_delta.kind !== 'task-state') fail('RUNTIME_SCHEMA_INVALID', 'Expected task-state delta.');
  ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'evidence-admission']);
  const delta = proposal.semantic_delta;
  if (delta.step_id !== current.runtimeState.active_step_id) fail('ACTIVE_STEP_CONFLICT', 'Proposal step_id does not match the admitted current step.');
  if (proposal.mode === 'repair') {
    if (!delta.repair_fingerprint) fail('FINDING_ADMISSION_REQUIRED', 'repair mode requires repair_fingerprint.');
    const finding = current.runtimeState.findings.find(item => item.fingerprint === delta.repair_fingerprint);
    if (!finding || !['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_ADMISSION_REQUIRED', 'repair fingerprint is not an admitted current-task finding.');
  }
  const oldStatus = current.runtimeState.active_step_status;
  const newStatus = delta.status;
  const legal = oldStatus === newStatus
    || (oldStatus === 'ready' && ['in-progress', 'completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'in-progress' && ['completed', 'blocked'].includes(newStatus))
    || (oldStatus === 'blocked' && proposal.mode === 'repair' && ['in-progress', 'completed'].includes(newStatus));
  if (!legal) fail('TASK_STATE_TRANSITION_INVALID', `Cannot transition active step from ${oldStatus} to ${newStatus}.`);
  const executionLog = [
    ...current.runtimeState.execution_log,
    {
      idempotency_key: proposal.idempotency_key,
      mode: proposal.mode,
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
    applied_proposals: [
      ...current.runtimeState.applied_proposals,
      {
        idempotency_key: proposal.idempotency_key,
        operation_kind: proposal.operation_kind,
        proposal_digest: digest(proposal),
        source_revision: current.sourceTuple.revision,
      },
    ].slice(-MAX_APPLIED_PROPOSALS),
  };
  return { next, findingStatus: delta.repair_fingerprint ? current.runtimeState.findings.find(item => item.fingerprint === delta.repair_fingerprint)?.status : undefined };
}

function applyFindingQueueDelta(
  current: CanonicalCurrentTask,
  proposal: RuntimeProposal,
  now: string,
): { next: RuntimeState; findingStatus?: FindingStatus } {
  if (proposal.semantic_delta.kind !== 'finding-queue') fail('RUNTIME_SCHEMA_INVALID', 'Expected finding-queue delta.');
  ensureAuthorityKinds(proposal, ['active-task-owner', 'scope-admission', 'finding-admission', 'evidence-admission']);
  const delta = proposal.semantic_delta;
  let findings = current.runtimeState.findings.map(item => ({ ...item, evidence_refs: [...item.evidence_refs] }));
  let findingStatus: FindingStatus | undefined;
  let repairRound = current.runtimeState.repair_round;
  if (delta.action === 'admit') {
    const candidate = delta.finding;
    if (candidate.owner_task_id !== current.runtimeState.task_id) fail('FINDING_OWNER_CONFLICT', 'finding owner_task_id must match the active task.');
    if (findings.some(item => item.fingerprint === candidate.fingerprint)) {
      const existing = findings.find(item => item.fingerprint === candidate.fingerprint)!;
      const equivalent = existing.owner_task_id === candidate.owner_task_id
        && existing.file === candidate.file
        && existing.failure_condition === candidate.failure_condition
        && existing.violated_invariant === candidate.violated_invariant;
      if (equivalent) return { next: current.runtimeState, findingStatus: existing.status };
      fail('FINDING_DUPLICATE_CONFLICT', `finding fingerprint ${candidate.fingerprint} already exists with different semantics.`);
    }
    const finding: FindingRecord = {
      ...candidate,
      status: 'admitted',
      repair_attempts: 0,
      admitted_at: now,
      updated_at: now,
      evidence_refs: [...candidate.evidence_refs],
    };
    findings.push(finding);
    findingStatus = finding.status;
  } else {
    const index = findings.findIndex(item => item.fingerprint === delta.fingerprint);
    if (index < 0) fail('FINDING_NOT_FOUND', `finding ${delta.fingerprint} is not present in the current queue.`);
    const finding = findings[index];
    if (delta.action === 'record-repair-attempt') {
      if (proposal.mode !== 'repair') fail('RUNTIME_MODE_INVALID', 'record-repair-attempt requires execute-step:repair.');
      if (!['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_STATE_INVALID', `finding ${finding.fingerprint} is not repairable from ${finding.status}.`);
      if (finding.repair_attempts >= finding.max_repair_attempts) fail('REPAIR_BUDGET_EXHAUSTED', `finding ${finding.fingerprint} has exhausted its repair budget.`);
      if (repairRound >= 3) fail('REPAIR_BUDGET_EXHAUSTED', 'review-cycle repair round budget is exhausted.');
      finding.repair_attempts += 1;
      finding.status = 'in-progress';
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
      repairRound += 1;
    } else if (delta.action === 'resolve') {
      if (proposal.mode !== 'repair') fail('RUNTIME_MODE_INVALID', 'resolve requires execute-step:repair.');
      if (!['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_STATE_INVALID', `finding ${finding.fingerprint} is not resolvable from ${finding.status}.`);
      finding.status = 'resolved';
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    } else {
      if (proposal.mode !== 'repair') fail('RUNTIME_MODE_INVALID', `${delta.action} requires execute-step:repair.`);
      if (!['admitted', 'in-progress'].includes(finding.status)) fail('FINDING_STATE_INVALID', `finding ${finding.fingerprint} cannot be ${delta.action} from ${finding.status}.`);
      finding.status = delta.action;
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    }
    findingStatus = finding.status;
  }
  const next: RuntimeState = {
    ...current.runtimeState,
    finding_queue_revision: current.runtimeState.finding_queue_revision + 1,
    repair_round: repairRound,
    findings,
    applied_proposals: [
      ...current.runtimeState.applied_proposals,
      {
        idempotency_key: proposal.idempotency_key,
        operation_kind: proposal.operation_kind,
        proposal_digest: digest(proposal),
        source_revision: current.sourceTuple.revision,
      },
    ].slice(-MAX_APPLIED_PROPOSALS),
  };
  return { next, findingStatus };
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
    planned_writes: [current.relativePath],
    governed_mutation_count: 0,
    read_back_verified: false,
    ...extras,
  };
}

export class GovernanceTransactionKernel {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
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
      current = readCanonicalCurrentTask(this.root);
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

    if (proposal.requested_write_targets[0] !== current.relativePath || proposal.source_tuple.path !== current.relativePath) {
      return buildResult('blocked', proposal, current, options, 'proposal write target is not the exact canonical CURRENT_TASK path.', { code: 'RUNTIME_PATH_INVALID' });
    }
    const proposalDigest = digest(proposal);
    const prior = current.runtimeState.applied_proposals.find(item => item.idempotency_key === proposal.idempotency_key);
    if (prior) {
      if (prior.proposal_digest !== proposalDigest) {
        return buildResult('conflict', proposal, current, options, 'idempotency key was already used by a different proposal.', { code: 'IDEMPOTENCY_CONFLICT', previous_revision: current.sourceTuple.revision });
      }
      return buildResult('no-op', proposal, current, options, 'proposal replay is an idempotent no-op.', {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true,
        state: {
          task_id: current.runtimeState.task_id,
          active_step_id: current.runtimeState.active_step_id,
          active_step_status: current.runtimeState.active_step_status,
          finding_queue_revision: current.runtimeState.finding_queue_revision,
          repair_round: current.runtimeState.repair_round,
        },
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
    let transition: { next: RuntimeState; findingStatus?: FindingStatus };
    try {
      transition = proposal.operation_kind === 'task-state-transaction'
        ? applyTaskStateDelta(current, proposal, now)
        : applyFindingQueueDelta(current, proposal, now);
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : 'RUNTIME_HANDLER_BLOCKED' });
    }

    const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, transition.next);
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
        state: {
          task_id: transition.next.task_id,
          active_step_id: transition.next.active_step_id,
          active_step_status: transition.next.active_step_status,
          finding_queue_revision: transition.next.finding_queue_revision,
          repair_round: transition.next.repair_round,
          finding_status: transition.findingStatus,
        },
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
      const readBack = readCanonicalCurrentTask(this.root);
      if (readBack.raw !== nextContent || readBack.sourceTuple.revision !== nextRevision) {
        try {
          executeWrites([{ path: current.filePath, content: current.raw }], false, 'vNext Runtime rollback after read-back mismatch');
        } catch {
          // The original marker/source remains the operator-visible blocker.
        }
        return buildResult('blocked', proposal, current, options, 'Runtime read-back did not match the staged canonical document.', { code: 'READ_BACK_MISMATCH' });
      }
      return buildResult('success', proposal, current, options, 'typed proposal committed and canonical source read-back verified.', {
        committed: true,
        governed_mutation_count: 1,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        read_back_verified: true,
        state: {
          task_id: readBack.runtimeState.task_id,
          active_step_id: readBack.runtimeState.active_step_id,
          active_step_status: readBack.runtimeState.active_step_status,
          finding_queue_revision: readBack.runtimeState.finding_queue_revision,
          repair_round: readBack.runtimeState.repair_round,
          finding_status: transition.findingStatus,
        },
      });
    } catch (error) {
      return buildResult('blocked', proposal, current, options, error instanceof Error ? error.message : String(error), { code: 'READ_BACK_FAILED' });
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

function parseCli(argv: string[]): { command: 'validate' | 'validate-contract' | 'apply'; root: string; proposal?: string; dryRun: boolean } {
  const [command = 'validate', ...rest] = argv;
  if (command !== 'validate' && command !== 'validate-contract' && command !== 'apply') throw new Error('Usage: vnext-runtime.ts <validate-contract|validate|apply> --root <path> [--proposal <json>] [--dry-run]');
  let root = process.cwd();
  let proposal: string | undefined;
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--proposal') proposal = rest[++index];
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, root, proposal, dryRun };
}

if (import.meta.main) {
  try {
    const args = parseCli(process.argv.slice(2));
    if (args.command === 'validate-contract') {
      console.log(JSON.stringify(validateVNextRuntimeContract(args.root), null, 2));
    } else if (args.command === 'validate') {
      const current = readCanonicalCurrentTask(args.root);
      console.log(JSON.stringify({ status: 'success', source_tuple: current.sourceTuple, runtime_state: current.runtimeState }, null, 2));
    } else {
      if (!args.proposal) throw new Error('apply requires --proposal <json-file>.');
      const proposalPath = path.resolve(args.proposal);
      const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8')) as unknown;
      const result = applyVNextRuntimeProposal(args.root, proposal, { dryRun: args.dryRun });
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked' || result.status === 'conflict') process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
