import { describe, expect, test } from 'bun:test';
import {
  classifyTaskIdentityFromCurrentTask,
  deriveTaskSlug,
  extractTaskIdentityFromCurrentTask,
  getTaskArchivePath,
  materializeTaskIdentityPlaceholders,
  validateTaskId,
  validateTaskSlug,
} from '../scripts/task-identity';

describe('task-identity', () => {
  test('validates TASK_ID format', () => {
    expect(() => validateTaskId('001')).not.toThrow();
    expect(() => validateTaskId('042')).not.toThrow();
    expect(() => validateTaskId('7')).toThrow('Invalid TASK_ID');
    expect(() => validateTaskId('task-001')).toThrow('Invalid TASK_ID');
  });

  test('validates TASK_SLUG format', () => {
    expect(() => validateTaskSlug('implement-task-identity')).not.toThrow();
    expect(() => validateTaskSlug('fix-registry-drift')).not.toThrow();
    expect(() => validateTaskSlug('Invalid-Slug')).toThrow('Invalid TASK_SLUG');
    expect(() => validateTaskSlug('bad slug')).toThrow('Invalid TASK_SLUG');
  });

  test('derives ASCII kebab-case slug from title', () => {
    expect(deriveTaskSlug('Implement Task Identity')).toBe('implement-task-identity');
    expect(deriveTaskSlug('Fix registry drift v2')).toBe('fix-registry-drift-v2');
  });

  test('extracts task identity from CURRENT_TASK.md task info section', () => {
    const content = [
      '# CURRENT_TASK.md',
      '',
      '## 任务信息',
      '',
      '- 项目：gstack',
      '- 任务 ID：007',
      '- 任务标题：Implement task identity',
      '- 任务 slug：implement-task-identity',
      '',
      '## 背景与上下文',
      '',
      '- context',
    ].join('\n');

    expect(extractTaskIdentityFromCurrentTask(content)).toEqual({
      id: '007',
      title: 'Implement task identity',
      slug: 'implement-task-identity',
    });
  });

  test('classifies placeholder-preserved identity separately from materialized identity', () => {
    const placeholderContent = [
      '# CURRENT_TASK.md',
      '',
      '## 任务信息',
      '',
      '- 任务 ID：{{TASK_ID}}',
      '- 任务标题：{{TASK_TITLE}}',
      '- 任务 slug：{{TASK_SLUG}}',
      '',
      '## 背景与上下文',
      '',
      '- context',
    ].join('\n');

    const materializedContent = [
      '# CURRENT_TASK.md',
      '',
      '## 任务信息',
      '',
      '- 任务 ID：007',
      '- 任务标题：Implement task identity',
      '- 任务 slug：implement-task-identity',
      '',
      '## 背景与上下文',
      '',
      '- context',
    ].join('\n');

    expect(classifyTaskIdentityFromCurrentTask(placeholderContent).status).toBe('placeholder-preserved');
    expect(classifyTaskIdentityFromCurrentTask(materializedContent).status).toBe('materialized');
  });

  test('materializes placeholders and produces the archive path', () => {
    const content = [
      '- 任务 ID：{{TASK_ID}}',
      '- 任务标题：{{TASK_TITLE}}',
      '- 任务 slug：{{TASK_SLUG}}',
    ].join('\n');

    const rendered = materializeTaskIdentityPlaceholders(content, {
      id: '007',
      title: 'Implement task identity',
      slug: 'implement-task-identity',
    });

    expect(rendered).toContain('任务 ID：007');
    expect(rendered).toContain('任务标题：Implement task identity');
    expect(rendered).toContain('任务 slug：implement-task-identity');
    expect(getTaskArchivePath('007', 'implement-task-identity')).toBe(
      'TASKS/TASK-007-implement-task-identity.md',
    );
  });
});
