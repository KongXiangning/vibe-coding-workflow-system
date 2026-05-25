import { describe, expect, test } from 'bun:test';
import {
  assertNoResumeGateDrift,
  classifyTaskIdentityFromCurrentTask,
  classifyCurrentTaskOwnershipStatus,
  CURRENT_TASK_STATUS_TUPLE_INVALID,
  CURRENT_TASK_WORKFLOW_STATUS_INVALID,
  deriveTaskSlug,
  extractCurrentTaskStateFromCurrentTask,
  extractTaskIdentityFromCurrentTask,
  getTaskArtifactPath,
  getTaskArchivePath,
  materializeTaskIdentityPlaceholders,
  normalizeResumeReviewReasons,
  RESUME_GATE_DRIFT,
  validateCurrentTaskResumeGate,
  validateCurrentTaskStatusTuple,
  validateTaskId,
  validateTaskSlug,
} from '../scripts/task-identity';

describe('task-identity', () => {
  function expectContractError(fn: () => void, code: string): void {
    try {
      fn();
      throw new Error(`Expected ${code} to be thrown.`);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain(code);
      if (typeof error === 'object' && error !== null && 'code' in error) {
        expect((error as { code?: unknown }).code).toBe(code);
      }
    }
  }

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
      '- 项目：vibe-coding-workflow-system',
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

  test('extracts workflow status, lifecycle state, and resume gate from CURRENT_TASK.md task info section', () => {
    const content = [
      '# CURRENT_TASK.md',
      '',
      '## 任务信息',
      '',
      '- 项目：vibe-coding-workflow-system',
      '- 任务 ID：007',
      '- 任务标题：Implement task identity',
      '- 任务 slug：implement-task-identity',
      '- 当前状态：active',
      '- 生命周期状态：active',
      '- 恢复需审查：false',
      '- 恢复审查原因：',
      '',
      '## 背景与上下文',
      '',
      '- context',
    ].join('\n');

    expect(extractCurrentTaskStateFromCurrentTask(content)).toEqual({
      workflowStatus: 'active',
      lifecycleState: 'active',
      resumeRequiresReview: false,
      resumeReviewReasons: null,
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

  test('materializes placeholders and resolves task artifact paths', () => {
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
    expect(getTaskArtifactPath('007', 'implement-task-identity', 'archive')).toBe(
      'TASKS/TASK-007-implement-task-identity.md',
    );
    expect(getTaskArtifactPath('007', 'implement-task-identity', 'paused')).toBe(
      'TASKS/paused/TASK-007-implement-task-identity.md',
    );
    expect(getTaskArtifactPath('007', 'implement-task-identity', 'interrupted')).toBe(
      'TASKS/interrupted/TASK-007-implement-task-identity.md',
    );
    expect(getTaskArchivePath('007', 'implement-task-identity')).toBe(
      'TASKS/TASK-007-implement-task-identity.md',
    );
  });

  test('accepts the v1 legal CURRENT_TASK workflow/lifecycle tuples', () => {
    expect(validateCurrentTaskStatusTuple('draft', 'active')).toEqual({
      workflowStatus: 'draft',
      lifecycleState: 'active',
      ownershipStatus: 'active_owner',
    });
    expect(validateCurrentTaskStatusTuple('active', 'active')).toEqual({
      workflowStatus: 'active',
      lifecycleState: 'active',
      ownershipStatus: 'active_owner',
    });
    expect(validateCurrentTaskStatusTuple('suspended', 'paused_pending_closure')).toEqual({
      workflowStatus: 'suspended',
      lifecycleState: 'paused_pending_closure',
      ownershipStatus: 'non_active_owner',
    });
    expect(validateCurrentTaskStatusTuple('suspended', 'paused_blocked')).toEqual({
      workflowStatus: 'suspended',
      lifecycleState: 'paused_blocked',
      ownershipStatus: 'non_active_owner',
    });
    expect(validateCurrentTaskStatusTuple('suspended', 'interrupted')).toEqual({
      workflowStatus: 'suspended',
      lifecycleState: 'interrupted',
      ownershipStatus: 'non_active_owner',
    });
    expect(validateCurrentTaskStatusTuple('archived', 'archived')).toEqual({
      workflowStatus: 'archived',
      lifecycleState: 'archived',
      ownershipStatus: 'non_active_owner',
    });
    expect(validateCurrentTaskStatusTuple('superseded', 'active')).toEqual({
      workflowStatus: 'superseded',
      lifecycleState: 'active',
      ownershipStatus: 'non_active_owner',
    });
    expect(validateCurrentTaskStatusTuple('replaced', 'active')).toEqual({
      workflowStatus: 'replaced',
      lifecycleState: 'active',
      ownershipStatus: 'non_active_owner',
    });
    expect(validateCurrentTaskStatusTuple('blocked_by_replan', 'active')).toEqual({
      workflowStatus: 'blocked_by_replan',
      lifecycleState: 'active',
      ownershipStatus: 'non_active_owner',
    });
  });

  test('fail-closes workflow status values that overload lifecycle semantics', () => {
    expectContractError(
      () => validateCurrentTaskStatusTuple('paused_pending_closure', 'paused_pending_closure'),
      CURRENT_TASK_WORKFLOW_STATUS_INVALID,
    );
    expectContractError(
      () => validateCurrentTaskStatusTuple('interrupted', 'interrupted'),
      CURRENT_TASK_WORKFLOW_STATUS_INVALID,
    );
    expectContractError(() => validateCurrentTaskStatusTuple(null, 'active'), CURRENT_TASK_WORKFLOW_STATUS_INVALID);
    expectContractError(() => validateCurrentTaskStatusTuple('unknown_status', 'active'), CURRENT_TASK_WORKFLOW_STATUS_INVALID);
  });

  test('fail-closes invalid CURRENT_TASK status tuples and marks ownership unknown', () => {
    expect(classifyCurrentTaskOwnershipStatus('active', 'paused_pending_closure')).toBe('invalid_unknown');
    expect(classifyCurrentTaskOwnershipStatus('suspended', 'active')).toBe('invalid_unknown');
    expect(classifyCurrentTaskOwnershipStatus(null, 'active')).toBe('invalid_unknown');

    expectContractError(
      () => validateCurrentTaskStatusTuple('active', 'paused_pending_closure'),
      CURRENT_TASK_STATUS_TUPLE_INVALID,
    );
    expectContractError(
      () => validateCurrentTaskStatusTuple('suspended', 'active'),
      CURRENT_TASK_STATUS_TUPLE_INVALID,
    );
    expectContractError(() => validateCurrentTaskStatusTuple('draft', null), CURRENT_TASK_STATUS_TUPLE_INVALID);
  });

  test('normalizes resume review reasons into the fixed closed-set order', () => {
    expect(normalizeResumeReviewReasons('manual_review_pending, validation_pending, manual_review_pending')).toEqual([
      'validation_pending',
      'manual_review_pending',
    ]);
    expect(
      validateCurrentTaskResumeGate('paused_pending_closure', true, [
        'remaining_acceptance_pending',
        'validation_pending',
        'remaining_acceptance_pending',
      ]),
    ).toEqual({
      resumeRequiresReview: true,
      resumeReviewReasons: ['validation_pending', 'remaining_acceptance_pending'],
    });
  });

  test('fail-closes invalid resume gate combinations for paused and interrupted lifecycle states', () => {
    expect(() => normalizeResumeReviewReasons('manual_review_pending, invented_reason')).toThrow(
      'resume_review_reasons must use the closed v1 set',
    );
    expect(() => validateCurrentTaskResumeGate('active', false, 'manual_review_pending')).toThrow(
      '恢复需审查 = false 时，恢复审查原因必须为空',
    );
    expect(() => validateCurrentTaskResumeGate('paused_pending_closure', true, 'base_drift')).toThrow(
      'paused_pending_closure requires at least one closure-oriented',
    );
    expect(() => validateCurrentTaskResumeGate('paused_blocked', true, 'manual_review_pending')).toThrow(
      'paused_blocked requires blocker_recheck_required',
    );
    expect(() => validateCurrentTaskResumeGate('interrupted', true, 'manual_review_pending')).toThrow(
      'interrupted requires at least one interrupt recovery reason',
    );
  });

  test('detects RESUME_GATE_DRIFT only when normalized semantics differ', () => {
    expect(
      assertNoResumeGateDrift(
        {
          resumeRequiresReview: true,
          resumeReviewReasons: ['manual_review_pending', 'validation_pending', 'manual_review_pending'],
        },
        {
          resumeRequiresReview: true,
          resumeReviewReasons: 'validation_pending, manual_review_pending',
        },
      ),
    ).toEqual({
      resumeRequiresReview: true,
      resumeReviewReasons: ['validation_pending', 'manual_review_pending'],
    });

    expectContractError(
      () =>
        assertNoResumeGateDrift(
          {
            resumeRequiresReview: true,
            resumeReviewReasons: ['validation_pending'],
          },
          {
            resumeRequiresReview: false,
            resumeReviewReasons: [],
          },
        ),
      RESUME_GATE_DRIFT,
    );
    expectContractError(
      () =>
        assertNoResumeGateDrift(
          {
            resumeRequiresReview: true,
            resumeReviewReasons: ['validation_pending'],
          },
          {
            resumeRequiresReview: true,
            resumeReviewReasons: ['manual_review_pending'],
          },
        ),
      RESUME_GATE_DRIFT,
    );
  });
});
