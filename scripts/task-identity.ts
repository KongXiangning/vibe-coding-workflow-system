import * as path from 'path';

export type TaskIdentity = {
  id: string;
  title: string;
  slug: string;
};

export type ExtractedTaskIdentity = {
  id: string | null;
  title: string | null;
  slug: string | null;
};

export type TaskIdentityStatus = 'materialized' | 'placeholder-preserved' | 'incomplete';
export type CurrentTaskWorkflowStatus =
  | 'draft'
  | 'active'
  | 'suspended'
  | 'archived'
  | 'superseded'
  | 'replaced'
  | 'blocked_by_replan';
export type TaskLifecycleState = 'active' | 'paused_pending_closure' | 'paused_blocked' | 'interrupted' | 'archived';
export type CurrentTaskOwnershipStatus = 'active_owner' | 'non_active_owner' | 'invalid_unknown';
export type TaskArtifactKind = 'archive' | 'paused' | 'interrupted';
export type ResumeReviewReason =
  | 'base_drift'
  | 'checkpoint_drift'
  | 'diff_review_target_changed'
  | 'environment_recovery_pending'
  | 'assumption_changed'
  | 'validation_pending'
  | 'manual_review_pending'
  | 'remaining_acceptance_pending'
  | 'blocker_recheck_required'
  | 'dirty_attribution_pending'
  | 'recovery_strategy_review_required';

export const CURRENT_TASK_WORKFLOW_STATUS_INVALID = 'CURRENT_TASK_WORKFLOW_STATUS_INVALID' as const;
export const CURRENT_TASK_STATUS_TUPLE_INVALID = 'CURRENT_TASK_STATUS_TUPLE_INVALID' as const;
export const RESUME_GATE_DRIFT = 'RESUME_GATE_DRIFT' as const;

export type TaskIdentityContractErrorCode =
  | typeof CURRENT_TASK_WORKFLOW_STATUS_INVALID
  | typeof CURRENT_TASK_STATUS_TUPLE_INVALID
  | typeof RESUME_GATE_DRIFT;

export class TaskIdentityContractError extends Error {
  readonly code: TaskIdentityContractErrorCode;

  constructor(code: TaskIdentityContractErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'TaskIdentityContractError';
    this.code = code;
  }
}

export const TASK_ID_PATTERN = /^[0-9]{3,}$/;
export const TASK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CURRENT_TASK_WORKFLOW_STATUSES: CurrentTaskWorkflowStatus[] = [
  'draft',
  'active',
  'suspended',
  'archived',
  'superseded',
  'replaced',
  'blocked_by_replan',
];
export const TASK_LIFECYCLE_STATES: TaskLifecycleState[] = [
  'active',
  'paused_pending_closure',
  'paused_blocked',
  'interrupted',
  'archived',
];
export const TASK_ARTIFACT_KINDS: TaskArtifactKind[] = ['archive', 'paused', 'interrupted'];
export const RESUME_REVIEW_REASON_ORDER: ResumeReviewReason[] = [
  'base_drift',
  'checkpoint_drift',
  'diff_review_target_changed',
  'environment_recovery_pending',
  'assumption_changed',
  'validation_pending',
  'manual_review_pending',
  'remaining_acceptance_pending',
  'blocker_recheck_required',
  'dirty_attribution_pending',
  'recovery_strategy_review_required',
];

const PLACEHOLDER_PATTERN = /^\{\{[A-Z0-9_]+\}\}$/;
const CURRENT_TASK_WORKFLOW_STATUS_SET = new Set<string>(CURRENT_TASK_WORKFLOW_STATUSES);
const TASK_LIFECYCLE_STATE_SET = new Set<string>(TASK_LIFECYCLE_STATES);
const TASK_ARTIFACT_KIND_SET = new Set<string>(TASK_ARTIFACT_KINDS);
const RESUME_REVIEW_REASON_SET = new Set<string>(RESUME_REVIEW_REASON_ORDER);
const CURRENT_TASK_STATUS_TUPLES = new Map<string, Exclude<CurrentTaskOwnershipStatus, 'invalid_unknown'>>([
  ['draft|active', 'active_owner'],
  ['active|active', 'active_owner'],
  ['suspended|paused_pending_closure', 'non_active_owner'],
  ['suspended|paused_blocked', 'non_active_owner'],
  ['suspended|interrupted', 'non_active_owner'],
  ['archived|archived', 'non_active_owner'],
  ['superseded|active', 'non_active_owner'],
  ['replaced|active', 'non_active_owner'],
  ['blocked_by_replan|active', 'non_active_owner'],
]);
const PAUSED_PENDING_CLOSURE_REASONS: ResumeReviewReason[] = [
  'validation_pending',
  'manual_review_pending',
  'remaining_acceptance_pending',
];
const INTERRUPTED_REQUIRED_REASONS: ResumeReviewReason[] = [
  'checkpoint_drift',
  'diff_review_target_changed',
  'dirty_attribution_pending',
  'environment_recovery_pending',
  'recovery_strategy_review_required',
];

function normalizeValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createTaskIdentityContractError(code: TaskIdentityContractErrorCode, message: string): TaskIdentityContractError {
  return new TaskIdentityContractError(code, message);
}

function extractTaskInfoSection(currentTaskContent: string): string {
  const headingMatch = /^## 任务信息\s*$/m.exec(currentTaskContent);
  if (!headingMatch || headingMatch.index === undefined) {
    return '';
  }

  const afterHeading = currentTaskContent.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = /\r?\n##\s/.exec(afterHeading);
  const sectionEnd = nextHeadingMatch && nextHeadingMatch.index !== undefined ? nextHeadingMatch.index : afterHeading.length;
  return afterHeading.slice(0, sectionEnd).trim();
}

function extractTaskInfoField(section: string, label: string): string | null {
  const match = new RegExp(`^-\\s*${escapeRegExp(label)}：\\s*(.+?)\\s*$`, 'm').exec(section);
  return normalizeValue(match?.[1]);
}

function normalizeDelimitedValues(values: string | string[] | null | undefined): string[] {
  const sourceValues = Array.isArray(values) ? values : [values];
  const normalizedValues: string[] = [];

  for (const value of sourceValues) {
    const normalized = normalizeValue(value);
    if (!normalized) {
      continue;
    }

    for (const token of normalized.split(',')) {
      const normalizedToken = normalizeValue(token);
      if (normalizedToken) {
        normalizedValues.push(normalizedToken);
      }
    }
  }

  return normalizedValues;
}

function sameOrderedValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertLifecycleSpecificResumeReasons(
  lifecycleState: TaskLifecycleState,
  resumeReviewReasons: ResumeReviewReason[],
): void {
  if (lifecycleState === 'paused_pending_closure') {
    if (!PAUSED_PENDING_CLOSURE_REASONS.some(reason => resumeReviewReasons.includes(reason))) {
      throw new Error(
        'paused_pending_closure requires at least one closure-oriented resume_review_reason: validation_pending, manual_review_pending, or remaining_acceptance_pending.',
      );
    }
    return;
  }

  if (lifecycleState === 'paused_blocked') {
    if (!resumeReviewReasons.includes('blocker_recheck_required')) {
      throw new Error('paused_blocked requires blocker_recheck_required in resume_review_reasons.');
    }
    return;
  }

  if (lifecycleState === 'interrupted') {
    if (!INTERRUPTED_REQUIRED_REASONS.some(reason => resumeReviewReasons.includes(reason))) {
      throw new Error(
        'interrupted requires at least one interrupt recovery reason: checkpoint_drift, diff_review_target_changed, dirty_attribution_pending, environment_recovery_pending, or recovery_strategy_review_required.',
      );
    }
  }
}

export function isTaskIdentityPlaceholder(value: string | null | undefined): boolean {
  return PLACEHOLDER_PATTERN.test(String(value ?? '').trim());
}

export function validateTaskId(taskId: string): void {
  const normalized = normalizeValue(taskId);
  if (!normalized || !TASK_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid TASK_ID "${taskId}". Expected a zero-padded decimal string with at least 3 digits.`);
  }
}

export function validateTaskSlug(taskSlug: string): void {
  const normalized = normalizeValue(taskSlug);
  if (!normalized || !TASK_SLUG_PATTERN.test(normalized)) {
    throw new Error(`Invalid TASK_SLUG "${taskSlug}". Expected lowercase ASCII kebab-case.`);
  }
}

export function validateTaskTitle(taskTitle: string): void {
  const normalized = normalizeValue(taskTitle);
  if (!normalized || isTaskIdentityPlaceholder(normalized)) {
    throw new Error('TASK_TITLE must be concrete, non-empty text before task identity is treated as materialized.');
  }
}

export function deriveTaskSlug(taskTitle: string): string {
  validateTaskTitle(taskTitle);
  const slug = taskTitle
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!slug) {
    throw new Error('Cannot derive TASK_SLUG from TASK_TITLE; provide an explicit ASCII kebab-case slug.');
  }

  validateTaskSlug(slug);
  return slug;
}

export function extractTaskIdentityFromCurrentTask(currentTaskContent: string): ExtractedTaskIdentity {
  const taskInfoSection = extractTaskInfoSection(currentTaskContent);
  return {
    id: extractTaskInfoField(taskInfoSection, '任务 ID'),
    title: extractTaskInfoField(taskInfoSection, '任务标题'),
    slug: extractTaskInfoField(taskInfoSection, '任务 slug'),
  };
}

export function classifyTaskIdentityFromCurrentTask(currentTaskContent: string): {
  status: TaskIdentityStatus;
  identity: ExtractedTaskIdentity;
  reasons: string[];
} {
  const identity = extractTaskIdentityFromCurrentTask(currentTaskContent);
  const reasons: string[] = [];

  if (!identity.id) {
    reasons.push('CURRENT_TASK.md is missing "任务 ID" in ## 任务信息.');
  }
  if (!identity.title) {
    reasons.push('CURRENT_TASK.md is missing "任务标题" in ## 任务信息.');
  }
  if (!identity.slug) {
    reasons.push('CURRENT_TASK.md is missing "任务 slug" in ## 任务信息.');
  }

  if (reasons.length > 0) {
    return { status: 'incomplete', identity, reasons };
  }

  const placeholderFields = [
    isTaskIdentityPlaceholder(identity.id) ? 'TASK_ID' : null,
    isTaskIdentityPlaceholder(identity.title) ? 'TASK_TITLE' : null,
    isTaskIdentityPlaceholder(identity.slug) ? 'TASK_SLUG' : null,
  ].filter(Boolean) as string[];

  if (placeholderFields.length === 3) {
    return {
      status: 'placeholder-preserved',
      identity,
      reasons: ['Task identity placeholders are preserved and must be materialized only during Adoption A3 or approved runtime execution.'],
    };
  }

  if (placeholderFields.length > 0) {
    return {
      status: 'incomplete',
      identity,
      reasons: [`Task identity is partially materialized: ${placeholderFields.join(', ')} remain unresolved.`],
    };
  }

  try {
    validateTaskId(identity.id!);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }

  try {
    validateTaskTitle(identity.title!);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }

  try {
    validateTaskSlug(identity.slug!);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }

  if (reasons.length > 0) {
    return { status: 'incomplete', identity, reasons };
  }

  return {
    status: 'materialized',
    identity,
    reasons: ['Task identity is concrete and ready to drive archive naming during Adoption A3 or approved runtime execution.'],
  };
}

export function parseBooleanField(value: string | null | undefined, label: string): boolean {
  const normalized = normalizeValue(value);
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(`${label} must be "true" or "false".`);
}

export function parseCurrentTaskWorkflowStatus(value: string | null | undefined): CurrentTaskWorkflowStatus {
  const normalized = normalizeValue(value);
  if (!normalized || !CURRENT_TASK_WORKFLOW_STATUS_SET.has(normalized)) {
    throw createTaskIdentityContractError(
      CURRENT_TASK_WORKFLOW_STATUS_INVALID,
      `当前状态 must use one of: ${CURRENT_TASK_WORKFLOW_STATUSES.join(', ')}.`,
    );
  }
  return normalized as CurrentTaskWorkflowStatus;
}

export function parseTaskLifecycleState(value: string | null | undefined): TaskLifecycleState {
  const normalized = normalizeValue(value);
  if (!normalized || !TASK_LIFECYCLE_STATE_SET.has(normalized)) {
    throw createTaskIdentityContractError(
      CURRENT_TASK_STATUS_TUPLE_INVALID,
      `生命周期状态 must use one of: ${TASK_LIFECYCLE_STATES.join(', ')}.`,
    );
  }
  return normalized as TaskLifecycleState;
}

export function extractCurrentTaskStateFromCurrentTask(currentTaskContent: string): {
  workflowStatus: string | null;
  lifecycleState: string | null;
  resumeRequiresReview: boolean | null;
  resumeReviewReasons: string | null;
} {
  const taskInfoSection = extractTaskInfoSection(currentTaskContent);
  const resumeRequiresReviewValue = extractTaskInfoField(taskInfoSection, '恢复需审查');

  return {
    workflowStatus: extractTaskInfoField(taskInfoSection, '当前状态'),
    lifecycleState: extractTaskInfoField(taskInfoSection, '生命周期状态'),
    resumeRequiresReview:
      resumeRequiresReviewValue === null ? null : parseBooleanField(resumeRequiresReviewValue, '恢复需审查'),
    resumeReviewReasons: extractTaskInfoField(taskInfoSection, '恢复审查原因'),
  };
}

export function classifyCurrentTaskOwnershipStatus(
  workflowStatus: string | null | undefined,
  lifecycleState: string | null | undefined,
): CurrentTaskOwnershipStatus {
  const normalizedWorkflowStatus = normalizeValue(workflowStatus);
  const normalizedLifecycleState = normalizeValue(lifecycleState);
  if (!normalizedWorkflowStatus || !normalizedLifecycleState) {
    return 'invalid_unknown';
  }

  return CURRENT_TASK_STATUS_TUPLES.get(`${normalizedWorkflowStatus}|${normalizedLifecycleState}`) ?? 'invalid_unknown';
}

export function validateCurrentTaskStatusTuple(
  workflowStatus: string | null | undefined,
  lifecycleState: string | null | undefined,
): {
  workflowStatus: CurrentTaskWorkflowStatus;
  lifecycleState: TaskLifecycleState;
  ownershipStatus: Exclude<CurrentTaskOwnershipStatus, 'invalid_unknown'>;
} {
  const parsedWorkflowStatus = parseCurrentTaskWorkflowStatus(workflowStatus);
  const parsedLifecycleState = parseTaskLifecycleState(lifecycleState);
  const ownershipStatus = classifyCurrentTaskOwnershipStatus(parsedWorkflowStatus, parsedLifecycleState);

  if (ownershipStatus === 'invalid_unknown') {
    throw createTaskIdentityContractError(
      CURRENT_TASK_STATUS_TUPLE_INVALID,
      `当前状态 × 生命周期状态 tuple "${parsedWorkflowStatus} + ${parsedLifecycleState}" is not allowed by the v1 lifecycle matrix.`,
    );
  }

  return {
    workflowStatus: parsedWorkflowStatus,
    lifecycleState: parsedLifecycleState,
    ownershipStatus,
  };
}

export function normalizeResumeReviewReasons(
  resumeReviewReasons: string | string[] | null | undefined,
): ResumeReviewReason[] {
  const providedReasons = normalizeDelimitedValues(resumeReviewReasons);
  if (providedReasons.length === 0) {
    return [];
  }

  const invalidReasons = [...new Set(providedReasons)].filter(reason => !RESUME_REVIEW_REASON_SET.has(reason));
  if (invalidReasons.length > 0) {
    throw new Error(
      `resume_review_reasons must use the closed v1 set. Invalid values: ${invalidReasons.join(', ')}.`,
    );
  }

  const providedReasonSet = new Set(providedReasons as ResumeReviewReason[]);
  return RESUME_REVIEW_REASON_ORDER.filter(reason => providedReasonSet.has(reason));
}

export function validateCurrentTaskResumeGate(
  lifecycleState: TaskLifecycleState,
  resumeRequiresReview: boolean,
  resumeReviewReasons: string | string[] | null | undefined,
): {
  resumeRequiresReview: boolean;
  resumeReviewReasons: ResumeReviewReason[];
} {
  const normalizedReasons = normalizeResumeReviewReasons(resumeReviewReasons);

  if (!resumeRequiresReview) {
    if (normalizedReasons.length > 0) {
      throw new Error('恢复需审查 = false 时，恢复审查原因必须为空。');
    }
    return { resumeRequiresReview: false, resumeReviewReasons: [] };
  }

  if (normalizedReasons.length === 0) {
    throw new Error('恢复需审查 = true 时，恢复审查原因必须为非空闭合集合。');
  }

  assertLifecycleSpecificResumeReasons(lifecycleState, normalizedReasons);
  return { resumeRequiresReview: true, resumeReviewReasons: normalizedReasons };
}

export function assertNoResumeGateDrift(
  sourceGate: {
    resumeRequiresReview: boolean;
    resumeReviewReasons: string | string[] | null | undefined;
  },
  candidateGate: {
    resumeRequiresReview: boolean;
    resumeReviewReasons: string | string[] | null | undefined;
  },
): {
  resumeRequiresReview: boolean;
  resumeReviewReasons: ResumeReviewReason[];
} {
  try {
    const normalizedSourceReasons = normalizeResumeReviewReasons(sourceGate.resumeReviewReasons);
    const normalizedCandidateReasons = normalizeResumeReviewReasons(candidateGate.resumeReviewReasons);

    if (
      sourceGate.resumeRequiresReview !== candidateGate.resumeRequiresReview ||
      !sameOrderedValues(normalizedSourceReasons, normalizedCandidateReasons)
    ) {
      throw createTaskIdentityContractError(
        RESUME_GATE_DRIFT,
        'resume gate semantics drifted between the suspended package source and CURRENT_TASK.md.',
      );
    }

    return {
      resumeRequiresReview: candidateGate.resumeRequiresReview,
      resumeReviewReasons: normalizedCandidateReasons,
    };
  } catch (error) {
    if (error instanceof TaskIdentityContractError && error.code === RESUME_GATE_DRIFT) {
      throw error;
    }
    throw createTaskIdentityContractError(
      RESUME_GATE_DRIFT,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function materializeTaskIdentityPlaceholders(
  content: string,
  identity: TaskIdentity,
): string {
  validateTaskId(identity.id);
  validateTaskTitle(identity.title);
  validateTaskSlug(identity.slug);

  return content
    .split('{{TASK_ID}}')
    .join(identity.id)
    .split('{{TASK_TITLE}}')
    .join(identity.title)
    .split('{{TASK_SLUG}}')
    .join(identity.slug);
}

export function getTaskArtifactPath(taskId: string, taskSlug: string, kind: TaskArtifactKind): string {
  validateTaskId(taskId);
  validateTaskSlug(taskSlug);

  if (!TASK_ARTIFACT_KIND_SET.has(kind)) {
    throw new Error(`Invalid TaskArtifactKind "${kind}". Expected one of: ${TASK_ARTIFACT_KINDS.join(', ')}.`);
  }

  const fileName = `TASK-${taskId}-${taskSlug}.md`;
  switch (kind) {
    case 'archive':
      return path.posix.join('TASKS', fileName);
    case 'paused':
      return path.posix.join('TASKS', 'paused', fileName);
    case 'interrupted':
      return path.posix.join('TASKS', 'interrupted', fileName);
  }
}

export function getTaskArchivePath(taskId: string, taskSlug: string): string {
  return getTaskArtifactPath(taskId, taskSlug, 'archive');
}
