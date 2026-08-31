export type ExtractedTaskIdentity = { id: string | null; title: string | null; slug: string | null };

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
