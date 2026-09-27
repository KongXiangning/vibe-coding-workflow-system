import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  getWorkflowGeneratedDir,
  getWorkflowProfilePath,
  loadProfile,
  validateProfilePathSemantics,
} from '../scripts/workflow-core';
import {
  getSuspendedTaskArtifactExpectedPath,
  parseSuspendedTaskArtifactPath,
  WORKFLOW_DOC_NAMES,
  WORKFLOW_DOC_RUNTIME_PLACEHOLDERS,
  validateSuspendedTaskArtifactPath,
  validateSuspendedTaskPackage,
  validateWorkflowDocContract,
} from '../scripts/workflow-doc-contracts';

const ROOT = path.resolve(import.meta.dir, '..');
const PROFILE = loadProfile(getWorkflowProfilePath(ROOT));
const OUTPUT_DIR = getWorkflowGeneratedDir(ROOT, PROFILE, 'workflow-docs');
const CURRENT_TASK_TEMPLATE = path.join(ROOT, 'templates', 'docs', 'CURRENT_TASK.md.tmpl');

function buildSuspendedPackageContent(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    task_id: '007',
    task_title: 'Implement task identity',
    task_slug: 'implement-task-identity',
    artifact_kind: 'paused',
    lifecycle_state: 'paused_pending_closure',
    suspension_reason: 'Waiting for validation and manual review',
    task_start_base: '23f52e85',
    last_reviewed_checkpoint: 'checkpoint-001',
    current_diff_review_target: 'working-tree',
    resume_requires_review: 'true',
    resume_review_reasons: 'manual_review_pending, validation_pending',
    rehydration_status: 'ready_for_resume',
    ownership_state: 'recovery_only',
  };

  const merged = { ...fields, ...overrides };
  return Object.entries(merged)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
}

function generatedDocsFiles(): string[] {
  if (!fs.existsSync(OUTPUT_DIR)) {
    throw new Error(
      `Missing generated workflow docs directory: ${OUTPUT_DIR}. ` +
        'test:workflow-docs expects committed generated docs and must not generate them during the test run.',
    );
  }

  const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.md')).sort();
  if (files.length === 0) {
    throw new Error(
      `No generated workflow docs found in ${OUTPUT_DIR}. ` +
        'test:workflow-docs expects committed generated docs and must not generate them during the test run.',
    );
  }

  return files;
}

describe('gen-workflow-docs', () => {
  test('generates the full workflow docs set', () => {
    const files = generatedDocsFiles();
    expect(files).toEqual([...WORKFLOW_DOC_NAMES].sort());
  });

  test('every generated workflow doc has required headings', () => {
    for (const file of WORKFLOW_DOC_NAMES) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8');
      expect(() => validateWorkflowDocContract(file, content)).not.toThrow();
    }
  });

  test('only task and runtime placeholders remain unresolved', () => {
    for (const file of WORKFLOW_DOC_NAMES) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8');
      const matches = content.match(/{{[^}]+}}/g) ?? [];
      const unresolved = matches.filter(token => !WORKFLOW_DOC_RUNTIME_PLACEHOLDERS.has(token));
      expect(unresolved).toEqual([]);
    }
  });

  test('current task and archive docs preserve task identity fields', () => {
    const currentTask = fs.readFileSync(path.join(OUTPUT_DIR, 'CURRENT_TASK.md'), 'utf8');
    expect(currentTask).toContain('- 任务 ID：{{TASK_ID}}');
    expect(currentTask).toContain('- 任务标题：{{TASK_TITLE}}');
    expect(currentTask).toContain('- 任务 slug：{{TASK_SLUG}}');
    expect(currentTask).toContain('## 设计约束');
    expect(currentTask).toContain('- Design mode:');
    expect(currentTask).toContain('- Design source:');
    expect(currentTask).toContain('- Design acceptance:');
    expect(currentTask).toContain('- Design evidence:');
    expect(currentTask).toContain('- Design open decisions:');
    expect(currentTask).toContain('## 发布后验证');
    expect(currentTask).toContain('- Release mode:');
    expect(currentTask).toContain('- Deploy source:');
    expect(currentTask).toContain('- Target environment:');
    expect(currentTask).toContain('- Health checks:');
    expect(currentTask).toContain('- Canary window:');
    expect(currentTask).toContain('- Performance baseline:');
    expect(currentTask).toContain('- Rollback / recovery:');
    expect(currentTask).toContain('- Release evidence:');
    expect(currentTask).toContain('## 审查问题队列');
    expect(currentTask).toContain('Finding ID：');
    expect(currentTask).toContain('- Failure scenario：');
    expect(currentTask).toContain('- Minimal fix direction：');
    expect(currentTask).toContain('- Required test：');
    expect(currentTask).toContain('## 传播治理记录');
    expect(currentTask).toContain('- `MutationEligibilityAssessment`：');
    expect(currentTask).toContain('- `ContractCompatibilityResult`：');
    expect(currentTask).toContain('- `over_limit_policy`：');
    expect(currentTask).toContain('- direct_consumers_semantics：保护旧入口 / wrapper / compat path');
    expect(currentTask).toContain('- effective_consumers：');
    expect(currentTask).toContain('- covered_categories：');
    expect(currentTask).toContain('- API downstream validation：');
    expect(currentTask).toContain('- runtime_state：');
    expect(currentTask).toContain('- evidence：');
    expect(currentTask).toContain('- branch_gate_mapping.rationale：');
    expect(currentTask).toContain('### conformance / verification cases');
    expect(currentTask).toContain('- 期望 gate / severity / `strategy_origin`：');

    const taskArchive = fs.readFileSync(path.join(OUTPUT_DIR, 'TASK_ARCHIVE.md'), 'utf8');
    expect(taskArchive).toContain('- 任务 ID：{{TASK_ID}}');
    expect(taskArchive).toContain('- 任务标题：{{TASK_TITLE}}');
    expect(taskArchive).toContain('- 任务 slug：{{TASK_SLUG}}');
  });

  test('current task template includes lifecycle gate defaults in stable order', () => {
    const template = fs.readFileSync(CURRENT_TASK_TEMPLATE, 'utf8');

    expect(template).toContain('- 当前状态：draft');
    expect(template).toContain('- 生命周期状态：active');
    expect(template).toContain('- 恢复需审查：false');
    expect(template).toContain('- 恢复审查原因：');

    const workflowStatusIndex = template.indexOf('- 当前状态：draft');
    const lifecycleStateIndex = template.indexOf('- 生命周期状态：active');
    const resumeRequiresReviewIndex = template.indexOf('- 恢复需审查：false');
    const resumeReviewReasonsIndex = template.indexOf('- 恢复审查原因：');
    const createdAtIndex = template.indexOf('- 创建时间：{{DATE}}');

    expect(workflowStatusIndex).toBeGreaterThan(-1);
    expect(lifecycleStateIndex).toBeGreaterThan(workflowStatusIndex);
    expect(resumeRequiresReviewIndex).toBeGreaterThan(lifecycleStateIndex);
    expect(resumeReviewReasonsIndex).toBeGreaterThan(resumeRequiresReviewIndex);
    expect(createdAtIndex).toBeGreaterThan(resumeReviewReasonsIndex);
  });

  test('suspended task artifact path helpers distinguish valid package paths from stray files', () => {
    expect(parseSuspendedTaskArtifactPath('TASKS/paused/TASK-007-implement-task-identity.md')).toEqual({
      relativePath: 'TASKS/paused/TASK-007-implement-task-identity.md',
      kind: 'paused',
      taskId: '007',
      taskSlug: 'implement-task-identity',
    });
    expect(parseSuspendedTaskArtifactPath('TASKS\\interrupted\\TASK-007-implement-task-identity.md')).toEqual({
      relativePath: 'TASKS/interrupted/TASK-007-implement-task-identity.md',
      kind: 'interrupted',
      taskId: '007',
      taskSlug: 'implement-task-identity',
    });
    expect(getSuspendedTaskArtifactExpectedPath('007', 'implement-task-identity', 'paused')).toBe(
      'TASKS/paused/TASK-007-implement-task-identity.md',
    );
    expect(getSuspendedTaskArtifactExpectedPath('007', 'implement-task-identity', 'interrupted')).toBe(
      'TASKS/interrupted/TASK-007-implement-task-identity.md',
    );
    expect(parseSuspendedTaskArtifactPath('TASKS/TASK-007-implement-task-identity.md')).toBeNull();
    expect(() => validateSuspendedTaskArtifactPath('TASKS/paused/README.md')).toThrow(
      'Suspended task artifact path must match',
    );
  });

  test('validates a paused suspended package without treating it as a governance doc', () => {
    expect(
      validateSuspendedTaskPackage(
        'TASKS/paused/TASK-007-implement-task-identity.md',
        buildSuspendedPackageContent(),
      ),
    ).toMatchObject({
      kind: 'paused',
      artifactKind: 'paused',
      lifecycleState: 'paused_pending_closure',
      rehydrationStatus: 'ready_for_resume',
      ownershipState: 'recovery_only',
      resumeRequiresReview: true,
      resumeReviewReasons: ['validation_pending', 'manual_review_pending'],
    });
  });

  test('fails closed on paused_blocked packages that miss required blocker evidence', () => {
    expect(() =>
      validateSuspendedTaskPackage(
        'TASKS/paused/TASK-007-implement-task-identity.md',
        buildSuspendedPackageContent({
          lifecycle_state: 'paused_blocked',
          blocker_status: 'blocked',
          resume_review_reasons: 'blocker_recheck_required, manual_review_pending',
        }),
      ),
    ).toThrow('blocking_evidence');

    expect(() =>
      validateSuspendedTaskPackage(
        'TASKS/paused/TASK-007-implement-task-identity.md',
        buildSuspendedPackageContent({
          lifecycle_state: 'paused_blocked',
          blocker_status: 'blocked',
          blocking_evidence: 'Waiting on external blocker owner',
          remaining_acceptance: 'Confirm blocker removal',
          resume_review_reasons: 'manual_review_pending',
        }),
      ),
    ).toThrow('paused_blocked requires blocker_recheck_required');
  });

  test('fails closed on interrupted packages that miss recovery evidence', () => {
    expect(() =>
      validateSuspendedTaskPackage(
        'TASKS/interrupted/TASK-007-implement-task-identity.md',
        buildSuspendedPackageContent({
          artifact_kind: 'interrupted',
          lifecycle_state: 'interrupted',
          resume_review_reasons:
            'checkpoint_drift, diff_review_target_changed, dirty_attribution_pending, recovery_strategy_review_required',
        }),
      ),
    ).toThrow('checkpoint_evidence');
  });

  test('decisions doc includes superseded-decision handling', () => {
    const decisions = fs.readFileSync(path.join(OUTPUT_DIR, 'DECISIONS.md'), 'utf8');
    expect(decisions).toContain('## 🔁 已演进 / 已替代');
    expect(decisions).toContain('- 原决策编号：');
    expect(decisions).toContain('- 后继决策编号 / 基线：');
  });

  test('lifecycle governance docs preserve minimum field skeletons', () => {
    const roadmap = fs.readFileSync(path.join(OUTPUT_DIR, 'ROADMAP.md'), 'utf8');
    expect(roadmap).toContain('- 目标版本 / 时间窗：');
    expect(roadmap).toContain('- 进入条件：');
    expect(roadmap).toContain('- 完成定义：');
    expect(roadmap).toContain('- 明确不做：');

    const baselines = fs.readFileSync(path.join(OUTPUT_DIR, 'BASELINES.md'), 'utf8');
    expect(baselines).toContain('### REL-001:');
    expect(baselines).toContain('### COMP-001:');
    expect(baselines).toContain('### SEC-001:');
    expect(baselines).toContain('### DEP-001:');
    expect(baselines).toContain('### NFR-001:');
    expect(baselines).toContain('### GATE-001:');
    expect(baselines).toContain('- 证据 / 验证入口：');
    expect(baselines).toContain('- 例外处理：');
    expect(baselines).toContain('- health endpoint：');
    expect(baselines).toContain('- production URL：');
    expect(baselines).toContain('- deploy status source：');
    expect(baselines).toContain('- canary window：');
    expect(baselines).toContain('- performance regression threshold：');
    expect(baselines).toContain('- merge gate：');
    expect(baselines).toContain('- ship gate：');
    expect(baselines).toContain('- 相关 strategy_origin / branch 语义：');

    const decisions = fs.readFileSync(path.join(OUTPUT_DIR, 'DECISIONS.md'), 'utf8');
    expect(decisions).toContain('### SUPERSEDED-001:');
    expect(decisions).toContain('- 生效版本 / 里程碑：');
    expect(decisions).toContain('- 兼容 / 迁移要求：');
  });

  test('docs generation accepts repo-level profile patterns via shared validation', () => {
    const profile = loadProfile(getWorkflowProfilePath(ROOT));
    expect(() => validateProfilePathSemantics(profile)).not.toThrow();
  });
});
