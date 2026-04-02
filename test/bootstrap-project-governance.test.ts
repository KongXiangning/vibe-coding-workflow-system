import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildBootstrapPlan,
  classifyExistingLiveDoc,
  runProtocolGeneratorChecks,
} from '../scripts/bootstrap-project-governance';
import { WORKFLOW_DOC_NAMES } from '../scripts/workflow-doc-contracts';

const ROOT = path.resolve(import.meta.dir, '..');
const GENERATED_DOCS_DIR = path.join(ROOT, 'generated', 'workflow-docs');
const tempRoots: string[] = [];

function createTempTargetRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-bootstrap-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function readGeneratedDoc(file: (typeof WORKFLOW_DOC_NAMES)[number]): string {
  return fs.readFileSync(path.join(GENERATED_DOCS_DIR, file), 'utf8');
}

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('bootstrap-project-governance', () => {
  test('emits a complete dry-run plan for a project without governance docs', () => {
    const targetRoot = createTempTargetRoot();
    const plan = buildBootstrapPlan({
      systemRoot: ROOT,
      targetRoot,
      runGeneratorChecks: false,
    });

    expect(plan.mode).toBe('dry-run');
    expect(plan.governed_docs).toHaveLength(WORKFLOW_DOC_NAMES.length);
    expect(plan.task_identity.status).toBe('absent');
    expect(plan.task_identity.materialization_phase).toBe('A3');
    expect(plan.task_identity.archive_path_pattern).toBe('TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md');
    expect(plan.summary.materialize).toBe(WORKFLOW_DOC_NAMES.length);
    expect(plan.summary.propose_diff_only).toBe(0);
    expect(plan.summary.blocked).toBe(0);
    expect(plan.validation_entrypoint_slots.length).toBeGreaterThanOrEqual(4);
    expect(plan.first_run_checklist.length).toBeGreaterThanOrEqual(5);
    for (const docPlan of plan.governed_docs) {
      expect(docPlan.lifecycle).toBe('absent');
      expect(docPlan.planned_action).toBe('materialize');
      expect(docPlan.execution_state).toBe('ready');
      expect(fs.existsSync(docPlan.live_path)).toBe(false);
    }
  });

  test('classifies structure-compatible live docs as diff-only with refresh follow-up', () => {
    const generated = readGeneratedDoc('CONTRACTS.md');
    const live = generated.replace('使用规则', '使用规则').replace('契约', '契约');
    const result = classifyExistingLiveDoc('CONTRACTS.md', generated, live);

    expect(result.classification).toBe('structure-compatible');
    expect(result.lifecycle).toBe('materialized');
  });

  test('classifies reorder-only drift as merge-safe after review', () => {
    const generated = readGeneratedDoc('CONTRACTS.md');
    const live = [
      '# CONTRACTS.md',
      '',
      '## 二、架构契约',
      '',
      '- drifted order',
      '',
      '## 使用规则',
      '',
      '- drifted order',
      '',
      '## 一、接口契约',
      '',
      '- drifted order',
      '',
      '## 三、变更规则',
      '',
      '- drifted order',
      '',
    ].join('\n');

    const result = classifyExistingLiveDoc('CONTRACTS.md', generated, live);
    expect(result.classification).toBe('structure-drifted but mergeable');
    expect(result.lifecycle).toBe('drifted');
  });

  test('classifies extra live-only headings as blocked incompatible drift', () => {
    const generated = readGeneratedDoc('CONTRACTS.md');
    const live = `${generated}\n\n### 额外小节\n\n- manual drift\n`;

    const result = classifyExistingLiveDoc('CONTRACTS.md', generated, live);
    expect(result.classification).toBe('incompatible and diff-only until confirmed');
    expect(result.reasons.some(reason => reason.includes('Extra live heading'))).toBe(true);
  });

  test('builds per-file sync actions and blocked states without writing live docs', () => {
    const targetRoot = createTempTargetRoot();
    fs.writeFileSync(
      path.join(targetRoot, 'CONTRACTS.md'),
      `${readGeneratedDoc('CONTRACTS.md')}\n\n### 额外小节\n\n- manual drift\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(targetRoot, 'STATUS.md'), readGeneratedDoc('STATUS.md'), 'utf8');

    const plan = buildBootstrapPlan({
      systemRoot: ROOT,
      targetRoot,
      runGeneratorChecks: false,
    });

    const contractsPlan = plan.governed_docs.find(doc => doc.file === 'CONTRACTS.md');
    const statusPlan = plan.governed_docs.find(doc => doc.file === 'STATUS.md');

    expect(contractsPlan?.planned_action).toBe('propose-diff only');
    expect(contractsPlan?.execution_state).toBe('blocked');
    expect(contractsPlan?.next_action).toBe('manual review');
    expect(contractsPlan?.diff_preview).toContain('--- live/CONTRACTS.md');

    expect(statusPlan?.planned_action).toBe('propose-diff only');
    expect(statusPlan?.execution_state).toBe('awaiting-confirmation');
    expect(statusPlan?.next_action).toBe('refresh-structure');
    expect(fs.existsSync(path.join(targetRoot, 'CURRENT_TASK.md'))).toBe(false);
  });

  test('reports materialized task identity from CURRENT_TASK.md without writing archive files', () => {
    const targetRoot = createTempTargetRoot();
    fs.writeFileSync(
      path.join(targetRoot, 'CURRENT_TASK.md'),
      [
        '# CURRENT_TASK.md',
        '',
        '## 任务信息',
        '',
        '- 项目：gstack',
        '- 项目类型：ai-engineering-workflow',
        '- 任务 ID：007',
        '- 任务标题：Implement task identity',
        '- 任务 slug：implement-task-identity',
        '- 当前状态：draft',
        '',
        '## 背景与上下文',
        '',
        '- context',
      ].join('\n'),
      'utf8',
    );

    const plan = buildBootstrapPlan({
      systemRoot: ROOT,
      targetRoot,
      runGeneratorChecks: false,
    });

    expect(plan.task_identity.status).toBe('materialized');
    expect(plan.task_identity.current_identity?.archive_path).toBe(
      'TASKS/TASK-007-implement-task-identity.md',
    );
    expect(fs.existsSync(path.join(targetRoot, 'TASKS', 'TASK-007-implement-task-identity.md'))).toBe(false);
  });

  test('runs protocol-level generator checks successfully', () => {
    const checks = runProtocolGeneratorChecks(ROOT);
    expect(checks.map(check => check.name)).toEqual([
      'gen:workflow-skills',
      'gen:workflow-docs',
      'gen:registry',
    ]);
    expect(checks.every(check => check.status === 'passed')).toBe(true);
  });
});
