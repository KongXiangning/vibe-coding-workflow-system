import * as path from 'path';

export type ExtractedTaskIdentity = { id: string | null; title: string | null; slug: string | null };

export type CurrentTaskWorkflowStatus =
  | 'draft'
  | 'active'
  | 'closed'
  | 'suspended'
  | 'archived'
  | 'superseded'
  | 'replaced'
  | 'blocked_by_replan';
export type TaskLifecycleState = 'active' | 'paused_pending_closure' | 'paused_blocked' | 'interrupted' | 'archived';
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

export const CURRENT_TASK_WORKFLOW_STATUSES: CurrentTaskWorkflowStatus[] = [
  'draft',
  'active',
  'closed',
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

const CURRENT_TASK_WORKFLOW_STATUS_SET = new Set<string>(CURRENT_TASK_WORKFLOW_STATUSES);
const TASK_LIFECYCLE_STATE_SET = new Set<string>(TASK_LIFECYCLE_STATES);
const TASK_ARTIFACT_KIND_SET = new Set<string>(['archive', 'paused', 'interrupted']);
const RESUME_REVIEW_REASON_SET = new Set<string>(RESUME_REVIEW_REASON_ORDER);
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
const CURRENT_TASK_STATUS_TUPLES = new Map<string, 'active_owner' | 'non_active_owner'>([
  ['draft|active', 'active_owner'],
  ['active|active', 'active_owner'],
  ['suspended|paused_pending_closure', 'non_active_owner'],
  ['suspended|paused_blocked', 'non_active_owner'],
  ['suspended|interrupted', 'non_active_owner'],
  ['archived|archived', 'non_active_owner'],
  ['superseded|active', 'non_active_owner'],
  ['replaced|active', 'non_active_owner'],
  ['blocked_by_replan|active', 'non_active_owner'],
  ['closed|archived', 'non_active_owner'],
]);

const TASK_ID_PATTERN = /^[0-9]{3,}$/;
const TASK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_PATTERN = /^\{\{[^{}]+\}\}$/;

function normalizeValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^()|[\]\\]/g, '\\$&').replace(/\$/g, '\\$&');
}

function extractTaskInfoSection(currentTaskContent: string): string {
  const headingMatch = /^## 任务信息\s*$/m.exec(currentTaskContent);
  if (!headingMatch || headingMatch.index === undefined) return '';
  const afterHeading = currentTaskContent.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = /\r?\n##\s/.exec(afterHeading);
  const sectionEnd = nextHeadingMatch?.index ?? afterHeading.length;
  return afterHeading.slice(0, sectionEnd).trim();
}

function extractTaskInfoField(section: string, label: string): string | null {
  const match = new RegExp('^-\\s*' + escapeRegExp(label) + '：\\s*(.+?)\\s*$', 'm').exec(section);
  return normalizeValue(match?.[1]);
}

function normalizeDelimitedValues(values: string | string[] | null | undefined): string[] {
  const sourceValues = Array.isArray(values) ? values : [values];
  return sourceValues.flatMap(value => String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean));
}

export function extractTaskIdentityFromCurrentTask(currentTaskContent: string): ExtractedTaskIdentity {
  const section = extractTaskInfoSection(currentTaskContent);
  return {
    id: extractTaskInfoField(section, '任务 ID'),
    title: extractTaskInfoField(section, '任务标题'),
    slug: extractTaskInfoField(section, '任务 slug'),
  };
}

export function extractCurrentTaskStateFromCurrentTask(currentTaskContent: string): {
  workflowStatus: string | null;
  lifecycleState: string | null;
  resumeRequiresReview: boolean | null;
  resumeReviewReasons: string | null;
} {
  const section = extractTaskInfoSection(currentTaskContent);
  const rawResume = extractTaskInfoField(section, '恢复需审查');
  let resumeRequiresReview: boolean | null = null;
  if (rawResume !== null) {
    if (rawResume === 'true') resumeRequiresReview = true;
    else if (rawResume === 'false') resumeRequiresReview = false;
    else throw new Error('恢复需审查 must be "true" or "false".');
  }
  return {
    workflowStatus: extractTaskInfoField(section, '当前状态'),
    lifecycleState: extractTaskInfoField(section, '生命周期状态'),
    resumeRequiresReview,
    resumeReviewReasons: extractTaskInfoField(section, '恢复审查原因'),
  };
}

export function parseBooleanField(value: string | null | undefined, label: string): boolean {
  const normalized = normalizeValue(value);
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${label} must be "true" or "false".`);
}

export function parseCurrentTaskWorkflowStatus(value: string | null | undefined): CurrentTaskWorkflowStatus {
  const normalized = normalizeValue(value);
  if (!normalized || !CURRENT_TASK_WORKFLOW_STATUS_SET.has(normalized)) {
    throw new Error(`当前状态 must use one of: ${CURRENT_TASK_WORKFLOW_STATUSES.join(', ')}.`);
  }
  return normalized as CurrentTaskWorkflowStatus;
}

export function parseTaskLifecycleState(value: string | null | undefined): TaskLifecycleState {
  const normalized = normalizeValue(value);
  if (!normalized || !TASK_LIFECYCLE_STATE_SET.has(normalized)) {
    throw new Error(`生命周期状态 must use one of: ${TASK_LIFECYCLE_STATES.join(', ')}.`);
  }
  return normalized as TaskLifecycleState;
}

export function classifyCurrentTaskOwnershipStatus(
  workflowStatus: string | null | undefined,
  lifecycleState: string | null | undefined,
): 'active_owner' | 'non_active_owner' | 'invalid_unknown' {
  const normalizedWorkflowStatus = normalizeValue(workflowStatus);
  const normalizedLifecycleState = normalizeValue(lifecycleState);
  if (!normalizedWorkflowStatus || !normalizedLifecycleState) return 'invalid_unknown';
  return CURRENT_TASK_STATUS_TUPLES.get(`${normalizedWorkflowStatus}|${normalizedLifecycleState}`) ?? 'invalid_unknown';
}

export function validateCurrentTaskStatusTuple(
  workflowStatus: string | null | undefined,
  lifecycleState: string | null | undefined,
): {
  workflowStatus: CurrentTaskWorkflowStatus;
  lifecycleState: TaskLifecycleState;
  ownershipStatus: 'active_owner' | 'non_active_owner';
} {
  const parsedWorkflowStatus = parseCurrentTaskWorkflowStatus(workflowStatus);
  const parsedLifecycleState = parseTaskLifecycleState(lifecycleState);
  const ownershipStatus = classifyCurrentTaskOwnershipStatus(parsedWorkflowStatus, parsedLifecycleState);
  if (ownershipStatus === 'invalid_unknown') {
    throw new Error(`当前状态 × 生命周期状态 tuple "${parsedWorkflowStatus} + ${parsedLifecycleState}" is not allowed by the v1 lifecycle matrix.`);
  }
  return { workflowStatus: parsedWorkflowStatus, lifecycleState: parsedLifecycleState, ownershipStatus };
}

export function normalizeResumeReviewReasons(
  resumeReviewReasons: string | string[] | null | undefined,
): ResumeReviewReason[] {
  const providedReasons = normalizeDelimitedValues(resumeReviewReasons);
  const invalidReasons = [...new Set(providedReasons)].filter(reason => !RESUME_REVIEW_REASON_SET.has(reason));
  if (invalidReasons.length > 0) {
    throw new Error(`resume_review_reasons must use the closed v1 set. Invalid values: ${invalidReasons.join(', ')}.`);
  }
  const provided = new Set(providedReasons as ResumeReviewReason[]);
  return RESUME_REVIEW_REASON_ORDER.filter(reason => provided.has(reason));
}

export function validateCurrentTaskResumeGate(
  lifecycleState: TaskLifecycleState,
  resumeRequiresReview: boolean,
  resumeReviewReasons: string | string[] | null | undefined,
): { resumeRequiresReview: boolean; resumeReviewReasons: ResumeReviewReason[] } {
  const normalizedReasons = normalizeResumeReviewReasons(resumeReviewReasons);
  if (!resumeRequiresReview) {
    if (normalizedReasons.length > 0) throw new Error('恢复需审查 = false 时，恢复审查原因必须为空。');
    return { resumeRequiresReview: false, resumeReviewReasons: [] };
  }
  if (normalizedReasons.length === 0) throw new Error('恢复需审查 = true 时，恢复审查原因必须为非空闭合集合。');
  if (lifecycleState === 'paused_pending_closure' && !PAUSED_PENDING_CLOSURE_REASONS.some(reason => normalizedReasons.includes(reason))) {
    throw new Error('paused_pending_closure requires validation_pending, manual_review_pending, or remaining_acceptance_pending.');
  }
  if (lifecycleState === 'paused_blocked' && !normalizedReasons.includes('blocker_recheck_required')) {
    throw new Error('paused_blocked requires blocker_recheck_required in resume_review_reasons.');
  }
  if (lifecycleState === 'interrupted' && !INTERRUPTED_REQUIRED_REASONS.some(reason => normalizedReasons.includes(reason))) {
    throw new Error('interrupted requires an interrupt recovery reason in resume_review_reasons.');
  }
  return { resumeRequiresReview: true, resumeReviewReasons: normalizedReasons };
}

export function getTaskArtifactPath(taskId: string, taskSlug: string, kind: TaskArtifactKind): string {
  validateTaskId(taskId);
  validateTaskSlug(taskSlug);
  if (!TASK_ARTIFACT_KIND_SET.has(kind)) throw new Error(`Invalid TaskArtifactKind "${kind}".`);
  const fileName = `TASK-${taskId}-${taskSlug}.md`;
  if (kind === 'archive') return path.posix.join('TASKS', fileName);
  return path.posix.join('TASKS', kind, fileName);
}

export function validateTaskId(taskId: string): void {
  const normalized = normalizeValue(taskId);
  if (!normalized || !TASK_ID_PATTERN.test(normalized)) {
    throw new Error('Invalid TASK_ID "' + taskId + '". Expected a zero-padded decimal string with at least 3 digits.');
  }
}

export function validateTaskSlug(taskSlug: string): void {
  const normalized = normalizeValue(taskSlug);
  if (!normalized || !TASK_SLUG_PATTERN.test(normalized)) {
    throw new Error('Invalid TASK_SLUG "' + taskSlug + '". Expected lowercase ASCII kebab-case.');
  }
}

export function isTaskIdentityPlaceholder(value: string | null | undefined): boolean {
  return PLACEHOLDER_PATTERN.test(String(value ?? '').trim());
}
