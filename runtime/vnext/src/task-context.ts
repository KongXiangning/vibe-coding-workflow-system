/**
 * The single bounded task projection used by daily Runtime callers.
 *
 * This is intentionally a read-only DTO layer.  It never returns the raw
 * RuntimeState, never appends an audit record, and never treats a cache hash as
 * proof that the model has the definition in its visible context.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  contextInput,
  contextPath,
  integer,
  readFileContext,
} from './file-context';
import {
  evaluateEvidenceSlotForContext,
  readCanonicalCurrentTask,
  type CanonicalCurrentTask,
} from './kernel';
import { withGovernanceWriteLock } from './runtime-io';
import { resolveTaskStep } from './task-steps';
import {
  TaskStore,
  TaskStoreError,
  commitTaskStorageMigration,
  previewTaskStorageMigration,
  taskStoreDefinitionPayload,
  taskStoreDefinitionRevisionForManifest,
  taskStoreHistoryPath,
  taskStorePaths,
  taskStoreStateRevision,
  type TaskStoreCurrent,
  type TaskStoreEvent,
  type TaskStoreManifest,
  type TaskStoreObject,
  type TaskStoreObjectReference,
} from './task-store';

export const TASK_CONTEXT_OPERATION = 'task-context' as const;
export const TASK_READ_OPERATION = 'task-read' as const;
export const TASK_CONTEXT_RECEIPT_KIND = 'task-context-receipt/v1' as const;
export const TASK_READ_RECEIPT_KIND = 'task-read-receipt/v1' as const;

export type TaskContextReference = {
  kind: 'task-context-reference/v1';
  command: 'task-context';
  entry: string;
  mode: string;
  document_id: string;
  source_revision: string;
  definition_revision: string;
  state_revision: string;
  manifest_path: string;
  read_only: true;
};

type AnyRecord = Record<string, unknown>;

export type TaskContextInput = {
  entry?: string;
  mode?: string;
  operation?: string;
  definition_visible?: boolean;
  visible_definition_revision?: string;
  known_definition_revision?: string;
  continuation?: TaskContextContinuation | string;
  max_bytes?: number;
};

export type TaskContextContinuation = {
  kind: 'task-context-page/v1';
  source_revision: string;
  definition_revision: string;
  state_revision: string;
  block_index: number;
  byte_offset: number;
};

export type TaskContextBlock = {
  id: string;
  required: boolean;
  value?: unknown;
  encoding?: 'json';
  text?: string;
  byte_offset?: number;
  total_bytes?: number;
  truncated?: boolean;
};

export type TaskContextResponse = {
  status: 'success' | 'partial';
  operation_kind: typeof TASK_CONTEXT_OPERATION;
  committed: false;
  aggregate: {
    document_id: string;
    task_id: string;
    task_slug: string;
    source_revision: string;
    definition_revision: string;
    state_revision: string;
    storage_manifest_path: string;
  };
  selection: {
    entry: string;
    mode: string;
    required: string[];
    optional: string[];
    definition_reused: boolean;
  };
  overview: AnyRecord;
  blocks: TaskContextBlock[];
  returned: {
    block_count: number;
    total_block_count: number;
    byte_count: number;
    required_complete: boolean;
  };
  required_unexpanded: string[];
  optional_unexpanded: string[];
  complete_for_operation: boolean;
  continuation: TaskContextContinuation | null;
  receipt: {
    kind: typeof TASK_CONTEXT_RECEIPT_KIND;
    document_id: string;
    source_revision: string;
    definition_revision: string;
    state_revision: string;
    selection: { entry: string; mode: string };
    returned_block_ids: string[];
    complete_for_operation: boolean;
  };
};

export type TaskReadInput = {
  kind?: string;
  ref?: string | AnyRecord;
  path?: string;
  sha256?: string;
  object_sha256?: string;
  event_path?: string;
  event_sequence?: number;
  event_hash?: string;
  source_revision?: string;
  old_line?: number;
  offset?: number;
  max_bytes?: number;
  continuation?: TaskReadContinuation | string;
  limit?: number;
};

export type TaskReadContinuation = {
  kind: 'task-read-page/v1';
  source_revision: string;
  definition_revision: string;
  state_revision: string;
  reference: string;
  byte_offset: number;
  content_revision?: string;
};

export type TaskReadResponse = {
  status: 'success' | 'partial';
  operation_kind: typeof TASK_READ_OPERATION;
  committed: false;
  aggregate: {
    document_id: string;
    task_id: string;
    task_slug: string;
    source_revision: string;
    definition_revision: string;
    state_revision: string;
  };
  selection: {
    kind: string;
    reference: string;
    required: boolean;
    total_bytes: number;
  };
  value?: unknown;
  text?: string;
  encoding?: 'json' | 'utf8';
  offset: number;
  returned_bytes: number;
  total_bytes: number;
  complete_for_operation: boolean;
  continuation: TaskReadContinuation | null;
  receipt: {
    kind: typeof TASK_READ_RECEIPT_KIND;
    document_id: string;
    source_revision: string;
    definition_revision: string;
    state_revision: string;
    reference: string;
    returned_offset: number;
    returned_bytes: number;
    complete_for_operation: boolean;
    content_revision?: string;
  };
};

export type TaskExportInput = {
  offset?: number;
  max_bytes?: number;
  continuation?: TaskExportContinuation | string;
};

export type TaskExportContinuation = {
  kind: 'task-export-page/v1';
  source_revision: string;
  definition_revision: string;
  state_revision: string;
  byte_offset: number;
};

export type TaskExportResponse = {
  status: 'success' | 'partial';
  operation_kind: 'task-export';
  committed: false;
  aggregate: {
    document_id: string;
    task_id: string;
    task_slug: string;
    source_revision: string;
    definition_revision: string;
    state_revision: string;
  };
  selection: {
    kind: 'aggregate-export';
    reference: string;
    total_bytes: number;
  };
  offset: number;
  returned_bytes: number;
  total_bytes: number;
  text: string;
  complete_for_operation: boolean;
  continuation: TaskExportContinuation | null;
  receipt: {
    kind: 'task-export-receipt/v1';
    document_id: string;
    source_revision: string;
    definition_revision: string;
    state_revision: string;
    returned_offset: number;
    returned_bytes: number;
    complete_for_operation: boolean;
  };
};

function record(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asStoreCurrent(current: CanonicalCurrentTask): TaskStoreCurrent {
  return current as unknown as TaskStoreCurrent;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseContinuation<T extends TaskContextContinuation | TaskReadContinuation>(value: unknown, expectedKind: T['kind']): T | null {
  if (value === undefined) return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: continuation is not valid JSON.'); }
  }
  if (!record(parsed) || parsed.kind !== expectedKind || typeof parsed.source_revision !== 'string') throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: continuation has an invalid binding.');
  if (!Number.isSafeInteger(parsed.byte_offset) || parsed.byte_offset < 0) throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: byte_offset is invalid.');
  if (parsed.content_revision !== undefined && (typeof parsed.content_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.content_revision))) throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: content_revision is invalid.');
  if (expectedKind === 'task-context-page/v1' && (!Number.isSafeInteger(parsed.block_index) || parsed.block_index < 0 || typeof parsed.definition_revision !== 'string' || typeof parsed.state_revision !== 'string')) throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: task context cursor is invalid.');
  if (expectedKind === 'task-read-page/v1' && (typeof parsed.reference !== 'string' || typeof parsed.definition_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.definition_revision) || typeof parsed.state_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.state_revision))) throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: task read cursor is invalid.');
  return parsed as T;
}

function currentStore(root: string, current: CanonicalCurrentTask): TaskStore {
  return TaskStore.forCurrent(root, asStoreCurrent(current));
}

export function taskContextReferenceForCurrent(root: string, current: CanonicalCurrentTask, entry = 'validate', mode = 'default'): TaskContextReference {
  const store = currentStore(root, current);
  const manifest = store.manifest;
  return {
    kind: 'task-context-reference/v1',
    command: TASK_CONTEXT_OPERATION,
    entry,
    mode,
    document_id: current.sourceTuple.document_id,
    source_revision: current.sourceTuple.revision,
    definition_revision: taskStoreDefinitionRevisionForManifest(asStoreCurrent(current), manifest),
    state_revision: taskStoreStateRevision(asStoreCurrent(current)),
    manifest_path: `${store.paths.relativeRoot}/manifest.json`,
    read_only: true,
  };
}

function manifestForContext(root: string, current: CanonicalCurrentTask): TaskStoreManifest | null {
  const store = currentStore(root, current);
  try {
    const manifest = store.manifest;
    if (!manifest) return null;
    const validation = store.validateCurrentAggregate(asStoreCurrent(current));
    if (validation.status !== 'valid') throw new TaskStoreError('TASK_STORE_SOURCE_CONFLICT', `current aggregate is not consistent with CURRENT_TASK: ${validation.errors.join(' | ')}`);
    return manifest;
  } catch (error) {
    if (error instanceof TaskStoreError) throw error;
    throw error;
  }
}

function sectionList(body: string): Array<{ title: string; text: string }> {
  const normalized = body.replace(/\r\n?/gu, '\n');
  const matches = [...normalized.matchAll(/^##\s+(.+?)\s*$/gmu)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1]!.index ?? normalized.length) : normalized.length;
    return { title: match[1]!.trim(), text: normalized.slice(start, end).replace(/^\n/u, '').trimEnd() };
  });
}

function sectionText(body: string, aliases: readonly string[]): string | null {
  return sectionList(body).find(section => aliases.includes(section.title))?.text ?? null;
}

function taskTitle(body: string): string | null {
  return /^-\s*任务标题：(.+)$/mu.exec(body)?.[1]?.trim() ?? /^-\s*Task Title:\s*(.+)$/mu.exec(body)?.[1]?.trim() ?? null;
}

function currentStep(current: CanonicalCurrentTask): AnyRecord {
  // Resolve by the active ID.  A projection that falls back to the first
  // Markdown step can expose S1 while Runtime is executing S3, which is a
  // dangerous context corruption rather than a harmless display issue.
  const resolved = resolveTaskStep(current.body, current.runtimeState.active_step_id).current;
  return {
    step_id: resolved.id,
    status: current.runtimeState.active_step_status,
    description: resolved.description,
    purpose: resolved.purpose,
    planned_mutation_targets: resolved.planned_mutation_targets,
    mutation_scope: resolved.mutation_scope,
    required_evidence: resolved.required_evidence,
    review_checkpoint: resolved.review_checkpoint,
    checkpoint_boundary: resolved.checkpoint_boundary,
    metadata_complete: resolved.metadata_complete,
    plan_text: resolved.plan_text,
  };
}

function slotSummary(claim: AnyRecord, slot: AnyRecord): AnyRecord {
  const check = record(slot.check) ? slot.check : null;
  const report = record(slot.report) ? slot.report : null;
  return {
    claim_id: typeof claim.claim_id === 'string' ? claim.claim_id : null,
    claim_kind: typeof claim.claim_kind === 'string' ? claim.claim_kind : null,
    requirement: typeof claim.requirement === 'string' ? claim.requirement : null,
    slot_id: typeof slot.slot_id === 'string' ? slot.slot_id : null,
    check_id: typeof check?.check_id === 'string' ? check.check_id : null,
    check_method: typeof check?.method === 'string' ? check.method : null,
    check_entry: typeof check?.entry === 'string' ? check.entry : null,
    expected_result: typeof check?.expected_result === 'string' ? check.expected_result : null,
    subject_paths: Array.isArray(check?.subject_paths) ? check.subject_paths.filter(item => typeof item === 'string') : [],
    minimum_type: typeof slot.minimum_type === 'string' ? slot.minimum_type : null,
    disposition: typeof slot.disposition === 'string' ? slot.disposition : null,
    due_step_id: typeof slot.due_step_id === 'string' ? slot.due_step_id : null,
    before_step_id: typeof slot.before_step_id === 'string' ? slot.before_step_id : null,
    applicability: typeof slot.applicability === 'string' ? slot.applicability : null,
    result_id: typeof report?.result_id === 'string' ? report.result_id : null,
    report_sha256: report ? sha256(stableJson(report)) : null,
    subject_revision: typeof report?.subject_revision === 'string' ? report.subject_revision : null,
    evidence_refs: Array.isArray(slot.evidence_refs) ? slot.evidence_refs.filter(item => typeof item === 'string') : [],
  };
}

function unfinishedObligations(root: string, current: CanonicalCurrentTask): AnyRecord[] {
  const claims = Array.isArray(current.runtimeState.claim_evidence) ? current.runtimeState.claim_evidence : [];
  const result: AnyRecord[] = [];
  for (const rawClaim of claims) {
    if (!record(rawClaim) || !Array.isArray(rawClaim.slots)) continue;
    for (const rawSlot of rawClaim.slots) {
      if (!record(rawSlot)) continue;
      const summary = slotSummary(rawClaim, rawSlot);
      const evaluation = evaluateEvidenceSlotForContext(
        root,
        current,
        rawClaim as never,
        rawSlot as never,
      );
      if (!evaluation.satisfied) {
        result.push({
          ...summary,
          satisfied: false,
          unsatisfied_reason: evaluation.reason,
        });
      }
    }
  }
  return result;
}

function dependencyResults(current: CanonicalCurrentTask): AnyRecord[] {
  const claims = Array.isArray(current.runtimeState.claim_evidence) ? current.runtimeState.claim_evidence : [];
  const result: AnyRecord[] = [];
  for (const rawClaim of claims) {
    if (!record(rawClaim) || !Array.isArray(rawClaim.slots)) continue;
    for (const rawSlot of rawClaim.slots) {
      if (!record(rawSlot) || (typeof rawSlot.before_step_id !== 'string' && rawSlot.prerequisite_receipt === undefined)) continue;
      const summary = slotSummary(rawClaim, rawSlot);
      result.push({
        ...summary,
        prerequisite_receipt_present: rawSlot.prerequisite_receipt !== undefined,
        prerequisite_receipt_revision: record(rawSlot.prerequisite_receipt) && typeof rawSlot.prerequisite_receipt.review_target_revision === 'string'
          ? rawSlot.prerequisite_receipt.review_target_revision
          : null,
      });
    }
  }
  return result;
}

function unresolvedFindings(current: CanonicalCurrentTask): AnyRecord[] {
  return (Array.isArray(current.runtimeState.findings) ? current.runtimeState.findings : [])
    .filter(record)
    .filter(finding => finding.status !== 'resolved' && finding.status !== 'rejected')
    .map(finding => ({
      fingerprint: finding.fingerprint ?? null,
      status: finding.status ?? null,
      category: finding.category ?? null,
      file: finding.file ?? null,
      failure_condition: finding.failure_condition ?? null,
      violated_invariant: finding.violated_invariant ?? null,
      required_behavior: finding.violated_invariant ?? null,
      repair_attempts: finding.repair_attempts ?? null,
      max_repair_attempts: finding.max_repair_attempts ?? null,
      evidence_refs: Array.isArray(finding.evidence_refs) ? finding.evidence_refs : [],
    }));
}

function latestExecution(current: CanonicalCurrentTask): AnyRecord | null {
  const entries = Array.isArray(current.runtimeState.execution_log) ? current.runtimeState.execution_log.filter(record) : [];
  const active = [...entries].reverse().find(entry => entry.step_id === current.runtimeState.active_step_id || entry.action === 'record-review-result');
  if (!active) return null;
  return {
    idempotency_key: active.idempotency_key ?? null,
    step_id: active.step_id ?? null,
    action: active.action ?? null,
    status: active.status ?? null,
    recorded_at: active.recorded_at ?? null,
    execution_result_status: record(active.execution_result) ? active.execution_result.outcome ?? null : null,
    evidence_refs: Array.isArray(active.evidence_refs) ? active.evidence_refs : [],
    result_id: record(active.execution_result) ? active.execution_result.result_id ?? null : null,
  };
}

function pendingReplanCandidateCount(current: CanonicalCurrentTask): number {
  const entries = Array.isArray(current.runtimeState.execution_log) ? current.runtimeState.execution_log.filter(record) : [];
  const lastReplan = entries.findLastIndex(item => item.action === 'commit-replan');
  return entries.slice(lastReplan + 1).filter(item => item.action === 'prepare-replan').length;
}

function pendingScopeAmendmentCandidateCount(current: CanonicalCurrentTask): number {
  const directory = path.join(path.dirname(current.filePath), 'task-candidates', current.sourceTuple.document_id);
  if (!fs.existsSync(directory)) return 0;
  const committed = new Set(current.runtimeState.execution_log
    .filter(item => 'action' in item && item.action === 'commit-scope-amendment' && item.candidate_digest)
    .map(item => `${item.candidate_digest}.scope.json`));
  return fs.readdirSync(directory).filter(name => name.endsWith('.scope.json')
    && !committed.has(name)
    && !fs.existsSync(path.join(directory, `${name}.discarded`))).length;
}

function reviewTarget(current: CanonicalCurrentTask): AnyRecord | null {
  const coverage = record(current.runtimeState.review_coverage) ? current.runtimeState.review_coverage : null;
  if (!coverage) return null;
  const target = record(coverage.target) ? coverage.target : null;
  return {
    revision: typeof target?.revision === 'string' ? target.revision : null,
    paths: Array.isArray(target?.entries) ? target.entries.filter(record).map(entry => ({ path: entry.path ?? null, state: entry.state ?? null, sha256: entry.sha256 ?? null })) : [],
    pending_paths: Array.isArray(coverage.pending_paths) ? coverage.pending_paths : [],
    last_clean_revision: coverage.last_clean_revision ?? null,
  };
}

function storeNavigation(root: string, current: CanonicalCurrentTask, manifest: TaskStoreManifest | null): AnyRecord {
  const paths = taskStorePaths(root, current.sourceTuple.document_id);
  return {
    manifest_path: `${paths.relativeRoot}/manifest.json`,
    available: manifest !== null,
    event_count: manifest?.counts.events ?? 0,
    object_count: manifest?.counts.objects ?? 0,
    first_event_sequence: manifest?.head.event_range.first ?? null,
    last_event_sequence: manifest?.head.event_range.last ?? null,
    last_event_id: manifest?.head.event_id ?? null,
    last_event_hash: manifest?.head.event_hash ?? null,
    history_query: { kind: 'events', reference: `${paths.relativeRoot}/events/` },
  };
}

function contextOverview(root: string, current: CanonicalCurrentTask, manifest: TaskStoreManifest | null): AnyRecord {
  const state = current.runtimeState;
  const ledger = record(state.step_attempts) && record(state.step_attempts[state.active_step_id]) ? state.step_attempts[state.active_step_id] as AnyRecord : null;
  const latest = latestExecution(current);
  const latestIndex = latest === null ? null : {
    idempotency_key: latest.idempotency_key ?? null,
    step_id: latest.step_id ?? null,
    action: latest.action ?? null,
    status: latest.status ?? null,
    recorded_at: latest.recorded_at ?? null,
    execution_result_status: latest.execution_result_status ?? null,
    result_id: latest.result_id ?? null,
    evidence_ref_count: Array.isArray(latest.evidence_refs) ? latest.evidence_refs.length : 0,
  };
  const unfinishedCount = unfinishedObligations(root, current).length;
  const dependencyCount = dependencyResults(current).length;
  const unknownDependencyCount = unfinishedObligations(root, current).filter(item => item.before_step_id === null).length;
  const unresolvedFindingCount = unresolvedFindings(current).length;
  const unresolvedChallengeCount = Array.isArray(state.evidence_challenges)
    ? state.evidence_challenges.filter(record).filter(item => item.status !== 'resolved').length
    : 0;
  const pendingReview = record(state.pending_review_result) ? state.pending_review_result : null;
  const retainedCleanReview = pendingReview?.verdict === 'clean' && state.scope_amendment_pending_review_step_id !== undefined;
  const retainedFindingReview = pendingReview?.verdict === 'findings' && state.scope_amendment_pending_review_step_id !== undefined;
  const dynamicReviewReady = state.dynamic_review_required === true
    && state.active_step_status === 'in-progress'
    && latest?.execution_result_status !== null
    && latest?.execution_result_status !== undefined;
  const nextEntry = state.resume_requires_review
    ? 'prepare-task:clear-resume-review'
    : retainedCleanReview
      ? 'execute-step:complete-reviewed-step'
      : retainedFindingReview
        ? 'execute-step:repair'
        : state.workflow_status === 'blocked_by_replan'
          ? 'prepare-task:amend-scope'
          : state.active_step_status === 'blocked'
            ? 'debug-task'
            : dynamicReviewReady
              ? 'review-change'
            : 'preflight-step';
  const nextOptions = state.workflow_status === 'blocked_by_replan'
    ? ['prepare-task:amend-scope', 'prepare-task:prepare-replan', 'debug-task']
    : state.active_step_status === 'blocked'
      ? ['debug-task', 'execute-step']
      : [nextEntry];
  return {
    identity: {
      task_id: state.task_id,
      task_slug: state.task_slug,
      document_id: current.sourceTuple.document_id,
      title: taskTitle(current.body),
    },
    status: {
      workflow_status: state.workflow_status,
      lifecycle_state: state.lifecycle_state,
      active_step_id: state.active_step_id,
      active_step_status: state.active_step_status,
      resume_requires_review: state.resume_requires_review,
      resume_review_reasons: state.resume_review_reasons,
      finding_queue_revision: state.finding_queue_revision,
      review_cycle_id: record(state.review_cycle) ? state.review_cycle.id ?? null : null,
      repair_round: record(state.review_cycle) ? state.review_cycle.repair_round ?? 0 : 0,
    },
    mutation_authority: current.mutationAuthority === null
      ? null
      : {
        version: 2,
        domains: [...current.mutationAuthority.domains],
        exact_exceptions: [...current.mutationAuthority.exact_exceptions],
        forbidden: [...current.mutationAuthority.forbidden],
      },
    dynamic_mutation: {
      review_required: state.dynamic_review_required === true,
      expansions: (state.dynamic_expansions ?? []).slice(0, 64).map(item => ({
        path: item.path,
        domain: item.domain,
        assessment: item.assessment,
        first_touch_state: item.first_touch_state,
        admitted_at: item.admitted_at,
      })),
      expansion_count: state.dynamic_expansions?.length ?? 0,
      expansions_truncated: (state.dynamic_expansions?.length ?? 0) > 64,
    },
    next_entry: nextEntry,
    next_options: nextOptions,
    obligations: {
      unfinished_count: unfinishedCount,
      unfinished_block: { kind: 'task-context-block', reference: 'unfinished-obligations' },
      dependencies_recorded_count: dependencyCount,
      dependencies_block: { kind: 'task-context-block', reference: 'required-dependencies' },
      dependencies_unknown: unknownDependencyCount,
      unknown_dependencies_block: { kind: 'task-context-block', reference: 'unknown-dependencies' },
    },
    gates: {
      pending_review_verdict: record(state.pending_review_result) ? state.pending_review_result.verdict ?? null : null,
      pending_review_step_id: record(state.pending_review_result) ? state.pending_review_result.step_id ?? null : null,
      unresolved_findings_count: unresolvedFindingCount,
      unresolved_findings_block: { kind: 'task-context-block', reference: 'global-gates' },
      unresolved_evidence_challenges_count: unresolvedChallengeCount,
      unresolved_evidence_challenges_block: { kind: 'task-context-block', reference: 'global-gates' },
      attempt_count: Array.isArray(ledger?.attempts) ? ledger!.attempts.length : 0,
      attempt_budget: ledger?.max_attempts ?? null,
      pending_replan_candidates: pendingReplanCandidateCount(current),
      pending_scope_amendment_candidates: pendingScopeAmendmentCandidateCount(current),
      dynamic_review_required: state.dynamic_review_required === true,
      dynamic_expansion_count: state.dynamic_expansions?.length ?? 0,
    },
    latest_execution: latestIndex,
    storage: storeNavigation(root, current, manifest),
  };
}

function operationBlocks(root: string, current: CanonicalCurrentTask, entry: string, mode: string, definitionReused: boolean, manifest: TaskStoreManifest | null): { blocks: TaskContextBlock[]; required: string[]; optional: string[] } {
  const definitionAlgorithm = manifest?.definition_revision_algorithm;
  const definition = taskStoreDefinitionPayload(asStoreCurrent(current), definitionAlgorithm);
  const blocks: TaskContextBlock[] = [];
  const add = (id: string, required: boolean, value: unknown) => blocks.push({ id, required, value });
  if (!definitionReused) add('current-definition', true, { revision: taskStoreDefinitionRevisionForManifest(asStoreCurrent(current), manifest), ...definition });
  add('current-step', true, currentStep(current));
  add('mutation-authority', true, current.mutationAuthority === null
    ? { version: null, domains: [], exact_exceptions: [], forbidden: [], legacy_mode: true }
    : {
      version: 2,
      domains: [...current.mutationAuthority.domains],
      exact_exceptions: [...current.mutationAuthority.exact_exceptions],
      forbidden: [...current.mutationAuthority.forbidden],
      legacy_mode: false,
    });
  add('unfinished-obligations', true, unfinishedObligations(root, current));
  add('required-dependencies', true, dependencyResults(current));
  add('unknown-dependencies', true, {
    status: 'unknown',
    obligations: unfinishedObligations(root, current).filter(item => item.before_step_id === null).map(item => ({
      claim_id: item.claim_id,
      slot_id: item.slot_id,
      due_step_id: item.due_step_id,
      result_id: item.result_id,
    })),
    required_action: 'Read the complete current definition and perform the bounded dependency check before skipping a gate.',
  });
  add('global-gates', true, {
    resume_requires_review: current.runtimeState.resume_requires_review,
    resume_review_reasons: current.runtimeState.resume_review_reasons,
    pending_review_result: record(current.runtimeState.pending_review_result) ? {
      verdict: current.runtimeState.pending_review_result.verdict ?? null,
      step_id: current.runtimeState.pending_review_result.step_id ?? null,
      review_cycle_id: current.runtimeState.pending_review_result.review_cycle_id ?? null,
      latest_execution_id: current.runtimeState.pending_review_result.latest_execution_id ?? null,
    } : null,
    unresolved_findings: unresolvedFindings(current),
    unresolved_evidence_challenges: Array.isArray(current.runtimeState.evidence_challenges) ? current.runtimeState.evidence_challenges.filter(record).filter(item => item.status !== 'resolved').map(item => ({ challenge_id: item.challenge_id ?? null, status: item.status ?? null, claim_id: item.claim_id ?? null, slot_id: item.slot_id ?? null, result_id: item.result_id ?? null })) : [],
    active_attempt: record(current.runtimeState.step_attempts) && record(current.runtimeState.step_attempts[current.runtimeState.active_step_id]) ? current.runtimeState.step_attempts[current.runtimeState.active_step_id] : null,
    dynamic_review_required: current.runtimeState.dynamic_review_required === true,
    dynamic_expansions: current.runtimeState.dynamic_expansions ?? [],
  });
  add('latest-execution', true, latestExecution(current));
  if (entry === 'review-change' || entry === 'review-context' || entry === 'review' || entry.includes('review') || mode === 'review') add('cumulative-review-target', true, reviewTarget(current));
  add('history-navigation', false, storeNavigation(root, current, manifest));
  return { blocks, required: blocks.filter(block => block.required).map(block => block.id), optional: blocks.filter(block => !block.required).map(block => block.id) };
}

function fits<T>(base: T, maxBytes: number): boolean {
  return byteLength(JSON.stringify(base)) <= maxBytes;
}

function jsonChunk(
  serialized: string,
  offset: number,
  base: AnyRecord,
  block: TaskContextBlock,
  maxBytes: number,
  fitsPage?: (candidate: TaskContextBlock, nextOffset: number) => boolean,
): { block: TaskContextBlock; nextOffset: number } {
  const bytes = Buffer.from(serialized, 'utf8');
  const prefix = Array.isArray(base.blocks) ? base.blocks : [];
  if (offset >= bytes.length) {
    return {
      block: { ...block, value: undefined, encoding: 'json', text: '', byte_offset: bytes.length, total_bytes: bytes.length, truncated: false },
      nextOffset: bytes.length,
    };
  }
  let low = 1;
  let high = Math.max(1, Math.min(bytes.length - offset, maxBytes));
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const end = utf8Boundary(bytes, offset + middle);
    const candidateBlock: TaskContextBlock = { ...block, value: undefined, encoding: 'json', text: bytes.subarray(offset, end).toString('utf8'), byte_offset: offset, total_bytes: bytes.length, truncated: end < bytes.length };
    const candidate: AnyRecord = { ...base, blocks: [...prefix, candidateBlock] };
    if (fits(candidate, maxBytes) && (fitsPage === undefined || fitsPage(candidateBlock, end))) { best = middle; low = middle + 1; } else high = middle - 1;
  }
  if (best <= 0) throw new Error('TASK_CONTEXT_BUDGET_EXHAUSTED: response metadata leaves no room for the next required content chunk.');
  const end = utf8Boundary(bytes, offset + best);
  const safeText = bytes.subarray(offset, end).toString('utf8');
  const consumed = end - offset;
  return {
    block: { ...block, value: undefined, encoding: 'json', text: safeText, byte_offset: offset, total_bytes: bytes.length, truncated: end < bytes.length },
    nextOffset: offset + consumed,
  };
}

function utf8Boundary(bytes: Buffer, requested: number): number {
  let end = Math.max(0, Math.min(requested, bytes.length));
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return end;
}

function contextPage(root: string, current: CanonicalCurrentTask, input: TaskContextInput): TaskContextResponse {
  const entry = typeof input.entry === 'string' && input.entry.trim() ? input.entry.trim() : typeof input.operation === 'string' && input.operation.trim() ? input.operation.trim() : 'validate';
  const mode = typeof input.mode === 'string' && input.mode.trim() ? input.mode.trim() : 'default';
  const maxBytes = integer(input.max_bytes, 16 * 1024, 256, 64 * 1024);
  const manifest = manifestForContext(root, current);
  const definitionRevision = taskStoreDefinitionRevisionForManifest(asStoreCurrent(current), manifest);
  const stateRevision = taskStoreStateRevision(asStoreCurrent(current));
  const visibleRevision = input.visible_definition_revision ?? input.known_definition_revision;
  const definitionReused = input.definition_visible === true && visibleRevision === definitionRevision;
  const continuation = parseContinuation<TaskContextContinuation>(input.continuation, 'task-context-page/v1');
  if (continuation && (continuation.source_revision !== current.sourceTuple.revision || continuation.definition_revision !== definitionRevision || continuation.state_revision !== stateRevision)) {
    throw new Error('TASK_CONTEXT_STALE: current definition/state changed; start a fresh task-context read.');
  }
  const aggregate = {
    document_id: current.sourceTuple.document_id,
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    source_revision: current.sourceTuple.revision,
    definition_revision: definitionRevision,
    state_revision: stateRevision,
    storage_manifest_path: `${taskStorePaths(root, current.sourceTuple.document_id).relativeRoot}/manifest.json`,
  };
  const selection = { entry, mode, required: [] as string[], optional: [] as string[], definition_reused: definitionReused };
  const built = operationBlocks(root, current, entry, mode, definitionReused, manifest);
  selection.required = built.required;
  selection.optional = built.optional;
  const overview = contextOverview(root, current, manifest);
  const base: AnyRecord = {
    status: 'success',
    operation_kind: TASK_CONTEXT_OPERATION,
    committed: false,
    aggregate,
    selection,
    overview,
    blocks: [],
    returned: { block_count: 0, total_block_count: built.blocks.length, byte_count: 0, required_complete: false },
    required_unexpanded: built.required,
    optional_unexpanded: built.optional,
    complete_for_operation: false,
    continuation: null,
  };
  let blockIndex = continuation?.block_index ?? 0;
  let byteOffset = continuation?.byte_offset ?? 0;
  if (blockIndex > built.blocks.length) throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: block_index is outside the selected operation.');
  if (blockIndex < built.blocks.length) {
    const blockBytes = Buffer.byteLength(stableJson(built.blocks[blockIndex]!.value), 'utf8');
    if (byteOffset > blockBytes) throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: byte_offset is outside the selected block.');
  } else if (byteOffset !== 0) {
    throw new Error('TASK_CONTEXT_CONTINUATION_INVALID: terminal cursor must have byte_offset 0.');
  }
  const returned: TaskContextBlock[] = [];
  let next: TaskContextContinuation | null = null;
  const makePage = (pageBlocks: TaskContextBlock[], cursor: TaskContextContinuation | null): AnyRecord => {
    const unexpandedIds = built.blocks.slice(cursor ? cursor.block_index : built.blocks.length).map(block => block.id);
    const requiredUnexpanded = unexpandedIds.filter(id => built.required.includes(id));
    const optionalUnexpanded = unexpandedIds.filter(id => built.optional.includes(id));
    const complete = cursor === null && requiredUnexpanded.length === 0 && optionalUnexpanded.length === 0;
    return {
      ...base,
      status: complete ? 'success' : 'partial',
      blocks: pageBlocks,
      returned: {
        block_count: pageBlocks.length,
        total_block_count: built.blocks.length,
        byte_count: byteLength(JSON.stringify(pageBlocks)),
        required_complete: requiredUnexpanded.length === 0,
      },
      required_unexpanded: requiredUnexpanded,
      optional_unexpanded: optionalUnexpanded,
      complete_for_operation: complete,
      continuation: cursor,
      receipt: {
        kind: TASK_CONTEXT_RECEIPT_KIND,
        document_id: current.sourceTuple.document_id,
        source_revision: current.sourceTuple.revision,
        definition_revision: definitionRevision,
        state_revision: stateRevision,
        selection: { entry, mode },
        returned_block_ids: pageBlocks.map(block => block.id),
        complete_for_operation: complete,
      },
    };
  };
  while (blockIndex < built.blocks.length) {
    const original = built.blocks[blockIndex]!;
    const serialized = stableJson(original.value);
    const full: TaskContextBlock = { id: original.id, required: original.required, value: original.value };
    const candidate = { ...base, blocks: [...returned, full] };
    if (fits(candidate, maxBytes)) {
      returned.push(full);
      blockIndex++;
      byteOffset = 0;
      continue;
    }
    const serializedBytes = Buffer.byteLength(serialized, 'utf8');
    const chunked = jsonChunk(
      serialized,
      byteOffset,
      { ...base, blocks: returned },
      original,
      maxBytes,
      (candidateBlock, candidateOffset) => {
        const candidateNext = candidateOffset < serializedBytes
          ? { kind: 'task-context-page/v1' as const, source_revision: current.sourceTuple.revision, definition_revision: definitionRevision, state_revision: stateRevision, block_index: blockIndex, byte_offset: candidateOffset }
          : blockIndex + 1 < built.blocks.length
            ? { kind: 'task-context-page/v1' as const, source_revision: current.sourceTuple.revision, definition_revision: definitionRevision, state_revision: stateRevision, block_index: blockIndex + 1, byte_offset: 0 }
            : null;
        return fits(makePage([...returned, candidateBlock], candidateNext), maxBytes);
      },
    );
    returned.push(chunked.block);
    const after = chunked.nextOffset;
    if (after < Buffer.byteLength(serialized, 'utf8')) next = { kind: 'task-context-page/v1', source_revision: current.sourceTuple.revision, definition_revision: definitionRevision, state_revision: stateRevision, block_index: blockIndex, byte_offset: after };
    else if (blockIndex + 1 < built.blocks.length) next = { kind: 'task-context-page/v1', source_revision: current.sourceTuple.revision, definition_revision: definitionRevision, state_revision: stateRevision, block_index: blockIndex + 1, byte_offset: 0 };
    blockIndex = built.blocks.length;
    break;
  }
  const response = makePage(returned, next);
  if (!fits(response, maxBytes)) {
    // The chunk calculation includes the base response.  This guard catches
    // metadata growth caused by a very large overview and fails explicitly.
    throw new Error('TASK_CONTEXT_BUDGET_EXHAUSTED: task-context metadata exceeds the requested page budget.');
  }
  return response as TaskContextResponse;
}

export function taskContext(root: string, input: unknown = {}): TaskContextResponse {
  const value = contextInput(input, ['entry', 'mode', 'operation', 'definition_visible', 'visible_definition_revision', 'known_definition_revision', 'continuation', 'max_bytes']) as TaskContextInput;
  if (value.definition_visible !== undefined && typeof value.definition_visible !== 'boolean') throw new Error('TASK_CONTEXT_INPUT_INVALID: definition_visible must be boolean.');
  if (value.visible_definition_revision !== undefined && (typeof value.visible_definition_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.visible_definition_revision))) throw new Error('TASK_CONTEXT_INPUT_INVALID: visible_definition_revision must be SHA-256.');
  if (value.known_definition_revision !== undefined && (typeof value.known_definition_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.known_definition_revision))) throw new Error('TASK_CONTEXT_INPUT_INVALID: known_definition_revision must be SHA-256.');
  const current = readCanonicalCurrentTask(root);
  return contextPage(root, current, value);
}

type TaskReadResolved = { kind: string; reference: string; required: boolean; value: unknown; encoding: 'json' | 'utf8'; content_revision?: string };

function readHistoryMaterial(root: string, current: CanonicalCurrentTask, sourceRevision: string): string {
  if (sourceRevision === current.sourceTuple.revision) return current.raw;
  const stored = currentStore(root, current).readHistoryMaterial(sourceRevision);
  if (stored !== null) return stored;
  const file = taskStoreHistoryPath(root, asStoreCurrent(current), sourceRevision);
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AnyRecord;
      if (parsed.kind === 'vnext-task-definition-history' && parsed.source_revision === sourceRevision && typeof parsed.current_task_base64 === 'string') {
        const raw = Buffer.from(parsed.current_task_base64, 'base64').toString('utf8');
        if (sha256(raw) !== sourceRevision) throw new Error('history package source digest does not match its base64 preimage.');
        return raw;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('source digest')) throw new Error(`TASK_READ_HISTORY_INVALID: ${error.message}`);
    }
  }
  // The sidecar retains the initial legacy bytes even when the older
  // task-history package was not present at migration time.
  const manifest = currentStore(root, current).manifest;
  const legacyReference = manifest?.object_refs.legacy_source;
  if (legacyReference) {
    const legacy = currentStore(root, current).readObject(legacyReference);
    if (record(legacy.payload) && legacy.payload.source_revision === sourceRevision && typeof legacy.payload.raw_base64 === 'string') {
      const raw = Buffer.from(legacy.payload.raw_base64, 'base64').toString('utf8');
      if (sha256(raw) !== sourceRevision) throw new Error(`TASK_READ_HISTORY_INVALID: retained legacy preimage digest does not match ${sourceRevision}.`);
      return raw;
    }
  }
  throw new Error(`TASK_READ_HISTORY_MISSING: no exact history preimage for ${sourceRevision}.`);
}

function taskStoreReference(value: unknown): value is TaskStoreObjectReference {
  return record(value)
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(value.sha256)
    && typeof value.object_type === 'string';
}

function transactionPayload(store: TaskStore, event: TaskStoreEvent, kind: 'proposal' | 'result' | 'semantic-delta'): unknown {
  const transaction = event.transaction;
  let raw: unknown;
  if (kind === 'semantic-delta') {
    raw = transaction?.semantic_delta;
    if (raw === undefined && transaction?.proposal !== undefined) {
      const proposal = taskStoreReference(transaction.proposal)
        ? store.readTransactionPayload(transaction.proposal, 'proposal')
        : transaction.proposal;
      raw = record(proposal) ? proposal.semantic_delta : undefined;
    }
  } else {
    raw = transaction?.[kind];
  }
  if (raw === undefined) return undefined;
  if (kind === 'proposal' && taskStoreReference(raw)) return store.readTransactionPayload(raw, 'proposal');
  if (kind === 'result' && taskStoreReference(raw)) return store.readTransactionPayload(raw, 'result');
  if (kind === 'semantic-delta' && taskStoreReference(raw)) {
    if (raw.object_type === 'proposal') {
      const proposal = store.readTransactionPayload(raw, 'proposal');
      return record(proposal) ? proposal.semantic_delta : undefined;
    }
    if (raw.object_type === 'semantic-delta') return store.readObject(raw, 'semantic-delta').payload;
  }
  return raw;
}

function resolvedRead(root: string, current: CanonicalCurrentTask, input: TaskReadInput, expectedContentRevision?: string): TaskReadResolved {
  const store = currentStore(root, current);
  const aggregateManifest = manifestForContext(root, current);
  const rawRef = input.ref;
  let ref: AnyRecord = {};
  if (typeof rawRef === 'string') ref = { reference: rawRef };
  else if (record(rawRef)) ref = rawRef;
  const kind = typeof input.kind === 'string' ? input.kind : typeof ref.kind === 'string' ? ref.kind : undefined;
  const objectSha = input.object_sha256 ?? input.sha256 ?? (typeof ref.sha256 === 'string' ? ref.sha256 : undefined);
  const eventPath = input.event_path ?? (typeof ref.path === 'string' ? ref.path : undefined);
  const reference = typeof rawRef === 'string' ? rawRef : eventPath ?? objectSha ?? kind ?? 'definition';
  if (kind === 'manifest') {
    const manifest = aggregateManifest;
    if (!manifest) throw new Error('TASK_READ_MANIFEST_MISSING: task store has not been initialized.');
    return { kind, reference: 'manifest', required: true, value: manifest, encoding: 'json' };
  }
  if (objectSha !== undefined && kind !== undefined && kind !== 'object' && !['definition', 'state', 'current-snapshot'].includes(kind)) {
    if (!/^[a-f0-9]{64}$/u.test(objectSha)) throw new Error('TASK_READ_OBJECT_INVALID: object_sha256 must be SHA-256.');
    if (kind === 'proposal') return { kind, reference: objectSha, required: true, value: store.readTransactionPayload({ sha256: objectSha, object_type: 'proposal' }, 'proposal'), encoding: 'json' };
    if (kind === 'result') return { kind, reference: objectSha, required: true, value: store.readTransactionPayload({ sha256: objectSha, object_type: 'result' }, 'result'), encoding: 'json' };
    if (kind === 'semantic-delta') {
      const proposal = store.readTransactionPayload({ sha256: objectSha, object_type: 'proposal' }, 'proposal');
      if (!record(proposal) || proposal.semantic_delta === undefined) throw new Error('TASK_READ_SEMANTIC-DELTA_MISSING: the selected proposal has no semantic_delta payload.');
      return { kind, reference: objectSha, required: true, value: proposal.semantic_delta, encoding: 'json' };
    }
    return { kind, reference: objectSha, required: true, value: store.readObject(objectSha), encoding: 'json' };
  }
  if (kind === 'definition' || (kind === undefined && objectSha === undefined && eventPath === undefined && input.path === undefined)) {
    if (objectSha !== undefined) return { kind, reference: objectSha, required: true, value: store.readObject(objectSha, 'definition'), encoding: 'json' };
    const manifest = aggregateManifest;
    if (manifest) return { kind: 'definition', reference: manifest.object_refs.definition.sha256, required: true, value: store.readObject(manifest.object_refs.definition, 'definition'), encoding: 'json' };
    return { kind: 'definition', reference: taskStoreDefinitionRevisionForManifest(asStoreCurrent(current), aggregateManifest), required: true, value: taskStoreDefinitionPayload(asStoreCurrent(current), aggregateManifest?.definition_revision_algorithm), encoding: 'json' };
  }
  if (kind === 'state' || kind === 'current-snapshot') {
    const manifest = aggregateManifest;
    if (!manifest) throw new Error('TASK_READ_MANIFEST_MISSING: task store has not been initialized.');
    const refValue = objectSha !== undefined ? { sha256: objectSha, object_type: kind } as const : kind === 'state' ? manifest.object_refs.state : manifest.object_refs.current_snapshot;
    return { kind, reference: refValue.sha256, required: true, value: store.readObject(refValue, kind), encoding: 'json' };
  }
  if (kind === 'claim-evidence') {
    // Claim reports are dynamic workset facts, not part of the frozen
    // definition object.  Expose them through the same byte-paged reader so
    // review callers do not have to receive the whole claim/report set in a
    // review-context response.
    return {
      kind,
      reference: 'claim-evidence',
      required: true,
      value: Array.isArray(current.runtimeState.claim_evidence) ? current.runtimeState.claim_evidence : [],
      encoding: 'json',
    };
  }
  if (kind === 'object' || objectSha !== undefined) {
    if (!objectSha || !/^[a-f0-9]{64}$/u.test(objectSha)) throw new Error('TASK_READ_OBJECT_INVALID: object_sha256 must be SHA-256.');
    return { kind: 'object', reference: objectSha, required: true, value: store.readObject(objectSha), encoding: 'json' };
  }
  if (kind === 'event') {
    const event = eventPath ? store.readEvent(eventPath) : store.readEvent({ sequence: input.event_sequence ?? Number(ref.sequence), event_hash: input.event_hash ?? String(ref.event_hash ?? '') });
    return { kind: 'event', reference: `${event.sequence}-${event.event_hash}`, required: true, value: event, encoding: 'json' };
  }
  if (kind === 'proposal' || kind === 'result' || kind === 'semantic-delta') {
    const event = eventPath ? store.readEvent(eventPath) : store.readEvent({ sequence: input.event_sequence ?? Number(ref.sequence), event_hash: input.event_hash ?? String(ref.event_hash ?? '') });
    const value = transactionPayload(store, event, kind);
    if (value === undefined) throw new Error(`TASK_READ_${kind.toUpperCase()}_MISSING: the selected event has no ${kind} payload.`);
    return { kind, reference: `${event.sequence}-${event.event_hash}:${kind}`, required: true, value, encoding: 'json' };
  }
  if (kind === 'events' || kind === 'history') {
    const events = store.listEvents().map(event => ({ sequence: event.sequence, event_id: event.event_id, event_hash: event.event_hash, operation_kind: event.operation_kind, idempotency_key: event.idempotency_key, source_revision: event.source_revision, resulting_source_revision: event.resulting_source_revision, object_refs: event.object_refs, recorded_at: event.metadata.recorded_at }));
    return { kind: 'events', reference: `${store.paths.relativeRoot}/events`, required: false, value: events, encoding: 'json' };
  }
  if (kind === 'legacy-current-task') {
    const manifest = aggregateManifest;
    if (!manifest?.object_refs.legacy_source) throw new Error('TASK_READ_OBJECT_MISSING: legacy source object is unavailable.');
    return { kind, reference: manifest.object_refs.legacy_source.sha256, required: true, value: store.readObject(manifest.object_refs.legacy_source, 'legacy-current-task'), encoding: 'json' };
  }
  if (kind === 'history-material') {
    const sourceRevision = input.source_revision ?? (typeof ref.source_revision === 'string' ? ref.source_revision : undefined);
    if (!sourceRevision || !/^[a-f0-9]{64}$/u.test(sourceRevision)) throw new Error('TASK_READ_HISTORY_INVALID: source_revision is required.');
    const requestedLine = input.old_line ?? (typeof ref.old_line === 'number' ? ref.old_line : undefined);
    if (requestedLine !== undefined) {
      if (!Number.isSafeInteger(requestedLine) || requestedLine < 1) throw new Error('TASK_READ_HISTORY_INVALID: old_line must be a positive integer.');
      const locator = store.readHistoryLocator(sourceRevision, requestedLine);
      if (!locator) {
        const raw = readHistoryMaterial(root, current, sourceRevision);
        const lines = raw.split(/\r\n?|\n/u);
        if (requestedLine > lines.length) throw new Error('TASK_READ_HISTORY_INVALID: old_line is outside the retained source preimage.');
        return {
          kind: 'history-locator',
          reference: `${sourceRevision}:${requestedLine}`,
          required: true,
          value: { source_revision: sourceRevision, old_line: requestedLine, old_line_count: lines.length, text: lines[requestedLine - 1] ?? '', locator: 'exact-preimage' },
          encoding: 'json',
        };
      }
      return { kind: 'history-locator', reference: `${sourceRevision}:${requestedLine}`, required: true, value: locator, encoding: 'json' };
    }
    return { kind, reference: sourceRevision, required: true, value: readHistoryMaterial(root, current, sourceRevision), encoding: 'utf8' };
  }
  if (input.path) {
    const file = contextPath(root, input.path);
    if (!fs.existsSync(file.absolute)) throw new Error(`TASK_READ_PATH_MISSING: ${file.relative}`);
    const result = readFileContext(root, { operation: 'read', path: file.relative, ...((input.sha256 ?? expectedContentRevision) ? { sha256: input.sha256 ?? expectedContentRevision } : {}) });
    const contentRevision = typeof result.sha256 === 'string' ? result.sha256 : undefined;
    if (expectedContentRevision !== undefined && contentRevision !== expectedContentRevision) throw new Error('TASK_READ_STALE: file content revision changed; start a fresh task-read.');
    return { kind: 'file', reference: file.relative, required: true, value: result, encoding: 'json', ...(contentRevision ? { content_revision: contentRevision } : {}) };
  }
  throw new Error('TASK_READ_INPUT_INVALID: provide a precise object, event, history, or file reference.');
}

function taskReadPage(root: string, current: CanonicalCurrentTask, input: TaskReadInput): TaskReadResponse {
  const maxBytes = integer(input.max_bytes, 16 * 1024, 256, 64 * 1024);
  const continuation = parseContinuation<TaskReadContinuation>(input.continuation, 'task-read-page/v1');
  // Check the receipt's source binding before validating the aggregate. This
  // gives a reader a deterministic stale-cursor result when a legacy inline
  // file changed, while compact files still fail closed in readCanonicalTask.
  const manifest = currentStore(root, current).manifest;
  if (continuation && continuation.source_revision !== current.sourceTuple.revision) {
    throw new Error('TASK_READ_STALE: source revision changed; start a fresh task-read.');
  }
  const definitionRevision = taskStoreDefinitionRevisionForManifest(asStoreCurrent(current), manifest);
  const stateRevision = taskStoreStateRevision(asStoreCurrent(current));
  if (continuation && (continuation.source_revision !== current.sourceTuple.revision
    || continuation.definition_revision !== definitionRevision
    || continuation.state_revision !== stateRevision)) throw new Error('TASK_READ_STALE: source, definition, or state revision changed; start a fresh task-read.');
  const resolved = resolvedRead(root, current, input, continuation?.content_revision);
  const serialized = resolved.encoding === 'utf8' ? String(resolved.value) : stableJson(resolved.value);
  const serializedBytes = Buffer.from(serialized, 'utf8');
  const reference = `${resolved.kind}:${resolved.reference}`;
  if (continuation && continuation.reference !== reference) throw new Error('TASK_READ_STALE: exact reference changed; start a fresh task-read.');
  const offset = continuation?.byte_offset ?? integer(input.offset, 0, 0, serializedBytes.length);
  if (offset > serializedBytes.length) throw new Error('TASK_READ_CONTINUATION_INVALID: byte_offset is outside the selected value.');
  if (offset < serializedBytes.length && (serializedBytes[offset]! & 0xc0) === 0x80) throw new Error('TASK_READ_CONTINUATION_INVALID: byte_offset is not a UTF-8 boundary.');
  const aggregate = {
    document_id: current.sourceTuple.document_id,
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    source_revision: current.sourceTuple.revision,
    definition_revision: definitionRevision,
    state_revision: stateRevision,
  };
  const base: AnyRecord = {
    status: 'success', operation_kind: TASK_READ_OPERATION, committed: false, aggregate,
    selection: { kind: resolved.kind, reference: resolved.reference, required: resolved.required, total_bytes: serializedBytes.length },
    offset, returned_bytes: 0, total_bytes: serializedBytes.length, complete_for_operation: false, continuation: null,
  };
  const makePage = (end: number): AnyRecord => {
    const safeEnd = utf8Boundary(serializedBytes, end);
    const text = serializedBytes.subarray(offset, safeEnd).toString('utf8');
    const complete = safeEnd === serializedBytes.length;
    const includeJsonValue = complete && offset === 0 && serializedBytes.length <= maxBytes;
    return {
      ...base,
      status: complete ? 'success' : 'partial',
      returned_bytes: byteLength(text),
      complete_for_operation: complete,
      continuation: complete ? null : {
        kind: 'task-read-page/v1',
        source_revision: current.sourceTuple.revision,
        definition_revision: definitionRevision,
        state_revision: stateRevision,
        reference,
        byte_offset: safeEnd,
        ...(resolved.content_revision ? { content_revision: resolved.content_revision } : {}),
      },
      ...(includeJsonValue && resolved.encoding === 'json' ? { value: resolved.value } : { text, encoding: resolved.encoding }),
      receipt: {
        kind: TASK_READ_RECEIPT_KIND,
        document_id: current.sourceTuple.document_id,
        source_revision: current.sourceTuple.revision,
        definition_revision: definitionRevision,
        state_revision: stateRevision,
        reference,
        returned_offset: offset,
        returned_bytes: byteLength(text),
        complete_for_operation: complete,
        ...(resolved.content_revision ? { content_revision: resolved.content_revision } : {}),
      },
    };
  };
  if (offset === serializedBytes.length) {
    const result = makePage(offset);
    if (!fits(result, maxBytes)) throw new Error('TASK_READ_BUDGET_EXHAUSTED: read receipt metadata exceeds the requested page budget.');
    return result as TaskReadResponse;
  }
  let low = offset + 1;
  let high = serializedBytes.length;
  let best = offset;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const boundary = utf8Boundary(serializedBytes, middle);
    if (boundary > offset && fits(makePage(boundary), maxBytes)) {
      best = boundary;
      // The requested middle can land on a UTF-8 continuation byte.  In that
      // case boundary may be below the current lower bound; advancing from
      // the middle keeps the binary search monotonic and guarantees progress.
      low = middle + 1;
    } else high = boundary - 1;
  }
  if (best === offset) throw new Error('TASK_READ_BUDGET_EXHAUSTED: response metadata leaves no room for content.');
  const result = makePage(best);
  if (!fits(result, maxBytes)) throw new Error('TASK_READ_BUDGET_EXHAUSTED: read receipt metadata exceeds the requested page budget.');
  return result as TaskReadResponse;
}

function parseExportContinuation(value: unknown): TaskExportContinuation | null {
  if (value === undefined) return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { throw new Error('TASK_EXPORT_CONTINUATION_INVALID: continuation is not valid JSON.'); }
  }
  if (!record(parsed) || parsed.kind !== 'task-export-page/v1' || typeof parsed.source_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.source_revision)
    || typeof parsed.definition_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.definition_revision)
    || typeof parsed.state_revision !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.state_revision)
    || !Number.isSafeInteger(parsed.byte_offset) || parsed.byte_offset < 0) {
    throw new Error('TASK_EXPORT_CONTINUATION_INVALID: continuation has an invalid binding.');
  }
  return parsed as unknown as TaskExportContinuation;
}

/** Page the explicit aggregate export so a large history is never one response. */
export function taskStoreExportPage(root: string, input: unknown = {}): TaskExportResponse {
  const value = contextInput(input, ['offset', 'max_bytes', 'continuation']) as TaskExportInput;
  const maxBytes = integer(value.max_bytes, 16 * 1024, 256, 64 * 1024);
  const current = readCanonicalCurrentTask(root);
  const store = currentStore(root, current);
  const definitionRevision = taskStoreDefinitionRevisionForManifest(asStoreCurrent(current), currentStore(root, current).manifest);
  const stateRevision = taskStoreStateRevision(asStoreCurrent(current));
  const exported = store.exportAggregate();
  const serialized = Buffer.from(stableJson(exported), 'utf8');
  const continuation = parseExportContinuation(value.continuation);
  if (continuation && (continuation.source_revision !== current.sourceTuple.revision
    || continuation.definition_revision !== definitionRevision
    || continuation.state_revision !== stateRevision)) throw new Error('TASK_EXPORT_STALE: source, definition, or state revision changed; start a fresh task-export.');
  const offset = continuation?.byte_offset ?? integer(value.offset, 0, 0, serialized.length);
  if (offset > serialized.length) throw new Error('TASK_EXPORT_CONTINUATION_INVALID: byte_offset is outside the aggregate export.');
  if (offset < serialized.length && (serialized[offset]! & 0xc0) === 0x80) throw new Error('TASK_EXPORT_CONTINUATION_INVALID: byte_offset is not a UTF-8 boundary.');
  const aggregate = {
    document_id: current.sourceTuple.document_id,
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    source_revision: current.sourceTuple.revision,
    definition_revision: definitionRevision,
    state_revision: stateRevision,
  };
  const reference = `${store.paths.relativeRoot}/manifest.json`;
  const base: AnyRecord = {
    status: 'success',
    operation_kind: 'task-export',
    committed: false,
    aggregate,
    selection: { kind: 'aggregate-export', reference, total_bytes: serialized.length },
    offset,
    returned_bytes: 0,
    total_bytes: serialized.length,
    text: '',
    complete_for_operation: false,
    continuation: null,
  };
  const makePage = (end: number): AnyRecord => {
    const safeEnd = utf8Boundary(serialized, end);
    const text = serialized.subarray(offset, safeEnd).toString('utf8');
    const complete = safeEnd === serialized.length;
    return {
      ...base,
      status: complete ? 'success' : 'partial',
      returned_bytes: byteLength(text),
      text,
      complete_for_operation: complete,
      continuation: complete ? null : {
        kind: 'task-export-page/v1',
        source_revision: current.sourceTuple.revision,
        definition_revision: definitionRevision,
        state_revision: stateRevision,
        byte_offset: safeEnd,
      },
      receipt: {
        kind: 'task-export-receipt/v1',
        document_id: current.sourceTuple.document_id,
        source_revision: current.sourceTuple.revision,
        definition_revision: definitionRevision,
        state_revision: stateRevision,
        returned_offset: offset,
        returned_bytes: byteLength(text),
        complete_for_operation: complete,
      },
    };
  };
  if (offset === serialized.length) {
    const result = makePage(offset);
    if (!fits(result, maxBytes)) throw new Error('TASK_EXPORT_BUDGET_EXHAUSTED: export receipt metadata exceeds the requested page budget.');
    return result as TaskExportResponse;
  }
  let low = offset + 1;
  let high = serialized.length;
  let best = offset;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const boundary = utf8Boundary(serialized, middle);
    if (boundary > offset && fits(makePage(boundary), maxBytes)) {
      best = boundary;
      // See the task-read loop above: never let a continuation-byte boundary
      // leave the lower bound unchanged.
      low = middle + 1;
    } else high = boundary - 1;
  }
  if (best === offset) throw new Error('TASK_EXPORT_BUDGET_EXHAUSTED: export receipt metadata leaves no room for content.');
  const result = makePage(best);
  if (!fits(result, maxBytes)) throw new Error('TASK_EXPORT_BUDGET_EXHAUSTED: export receipt metadata exceeds the requested page budget.');
  return result as TaskExportResponse;
}

export function taskRead(root: string, input: unknown): TaskReadResponse {
  const value = contextInput(input, ['kind', 'ref', 'path', 'sha256', 'object_sha256', 'event_path', 'event_sequence', 'event_hash', 'source_revision', 'old_line', 'offset', 'max_bytes', 'continuation', 'limit']) as TaskReadInput;
  const current = readCanonicalCurrentTask(root);
  return taskReadPage(root, current, value);
}

export function taskStoreValidation(root: string): ReturnType<TaskStore['deepValidate']> {
  const current = readCanonicalCurrentTask(root);
  return currentStore(root, current).deepValidate();
}

export function taskStoreCurrentValidation(root: string): ReturnType<TaskStore['validateCurrentAggregate']> {
  const current = readCanonicalCurrentTask(root);
  return currentStore(root, current).validateCurrentAggregate(asStoreCurrent(current));
}

export function taskStoreMeasure(root: string): ReturnType<TaskStore['measure']> | null {
  const current = readCanonicalCurrentTask(root);
  const store = currentStore(root, current);
  return store.exists ? store.measure() : null;
}

export function taskStoreExport(root: string): ReturnType<TaskStore['exportAggregate']> {
  const current = readCanonicalCurrentTask(root);
  return currentStore(root, current).exportAggregate();
}

export function taskContextMigrationPreview(root: string) {
  const current = readCanonicalCurrentTask(root);
  return previewTaskStorageMigration(root, asStoreCurrent(current));
}

export function taskContextMigrationCommit(root: string, sourceRevision: string) {
  return withGovernanceWriteLock(root, () => {
    const current = readCanonicalCurrentTask(root);
    return commitTaskStorageMigration(root, asStoreCurrent(current), sourceRevision);
  });
}

function readCliInput(): unknown {
  if (process.stdin.isTTY) return {};
  const content = fs.readFileSync(0, 'utf8');
  return content.trim() ? JSON.parse(content) as unknown : {};
}

function cliRoot(args: string[]): string {
  if (args.length !== 2 || args[0] !== '--root' || !args[1]) throw new Error('Usage: <task-context|task-read|task-storage-migration|task-export> --root <project> (JSON on stdin)');
  return path.resolve(args[1]!);
}

export async function runTaskContextCli(command: 'task-context' | 'task-read' | 'task-storage-migration' | 'task-export', args: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const root = cliRoot(args);
    if (command === 'task-context') {
      const result = taskContext(root, readCliInput());
      console.log(JSON.stringify(result, null, 2));
      return result.complete_for_operation ? 0 : 2;
    }
    if (command === 'task-read') {
      const result = taskRead(root, readCliInput());
      console.log(JSON.stringify(result, null, 2));
      return result.complete_for_operation ? 0 : 2;
    }
    if (command === 'task-export') {
      const result = taskStoreExportPage(root, readCliInput());
      console.log(JSON.stringify(result, null, 2));
      return result.complete_for_operation ? 0 : 2;
    }
    const input = readCliInput();
    if (!record(input) || (input.mode !== 'preview' && input.mode !== 'commit')) throw new Error('TASK_MIGRATION_INPUT_INVALID: mode must be preview or commit.');
    if (input.mode === 'preview') {
      console.log(JSON.stringify(taskContextMigrationPreview(root), null, 2));
      return 0;
    }
    if (typeof input.source_revision !== 'string') throw new Error('TASK_MIGRATION_INPUT_INVALID: commit requires source_revision.');
    console.log(JSON.stringify(taskContextMigrationCommit(root, input.source_revision), null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof TaskStoreError && error.code === 'TASK_STORE_SOURCE_CONFLICT' ? 2 : 1;
  }
}
