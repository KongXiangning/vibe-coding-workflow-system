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

export const TASK_ID_PATTERN = /^[0-9]{3,}$/;
export const TASK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PLACEHOLDER_PATTERN = /^\{\{[A-Z0-9_]+\}\}$/;

function normalizeValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

export function getTaskArchivePath(taskId: string, taskSlug: string): string {
  validateTaskId(taskId);
  validateTaskSlug(taskSlug);
  return path.posix.join('TASKS', `TASK-${taskId}-${taskSlug}.md`);
}
