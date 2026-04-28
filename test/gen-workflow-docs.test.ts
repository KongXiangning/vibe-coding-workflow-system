import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { loadProfile, validateProfilePathSemantics } from '../scripts/workflow-core';
import {
  WORKFLOW_DOC_NAMES,
  WORKFLOW_DOC_RUNTIME_PLACEHOLDERS,
  validateWorkflowDocContract,
} from '../scripts/workflow-doc-contracts';

const ROOT = path.resolve(import.meta.dir, '..');
const OUTPUT_DIR = path.join(ROOT, 'generated', 'workflow-docs');

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

  test('project placeholders are fully resolved', () => {
    for (const file of WORKFLOW_DOC_NAMES) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8');
      expect(content.includes('{{PROJECT_NAME}}')).toBe(false);
      expect(content.includes('{{PROJECT_TYPE}}')).toBe(false);
      expect(content.includes('{{TECH_STACK}}')).toBe(false);
      expect(content.includes('{{TEST_COMMANDS}}')).toBe(false);
      expect(content.includes('{{CODE_DIRECTORIES}}')).toBe(false);
      expect(content.includes('{{FORBIDDEN_PATHS}}')).toBe(false);
      expect(content.includes('{{ARCHITECTURE_RULES}}')).toBe(false);
      expect(content.includes('{{VERSION}}')).toBe(false);
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

  test('lifecycle governance docs provide roadmap and baseline homes', () => {
    const roadmap = fs.readFileSync(path.join(OUTPUT_DIR, 'ROADMAP.md'), 'utf8');
    expect(roadmap).toContain('## 版本里程碑');
    expect(roadmap).toContain('## 当前窗口');

    const baselines = fs.readFileSync(path.join(OUTPUT_DIR, 'BASELINES.md'), 'utf8');
    expect(baselines).toContain('## 发布基线');
    expect(baselines).toContain('## 兼容性基线');
    expect(baselines).toContain('## 安全基线');
    expect(baselines).toContain('## 部署基线');
    expect(baselines).toContain('## 性能与可靠性基线');
    expect(baselines).toContain('## Gate 与错误码基线');
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
    expect(baselines).toContain('- merge gate：');
    expect(baselines).toContain('- ship gate：');
    expect(baselines).toContain('- 相关 strategy_origin / branch 语义：');

    const decisions = fs.readFileSync(path.join(OUTPUT_DIR, 'DECISIONS.md'), 'utf8');
    expect(decisions).toContain('### SUPERSEDED-001:');
    expect(decisions).toContain('- 生效版本 / 里程碑：');
    expect(decisions).toContain('- 兼容 / 迁移要求：');
  });

  test('contracts doc includes propagation governance supplements', () => {
    const contracts = fs.readFileSync(path.join(OUTPUT_DIR, 'CONTRACTS.md'), 'utf8');
    expect(contracts).toContain('## 四、传播治理补充');
    expect(contracts).toContain('### LayoutContract');
    expect(contracts).toContain('### BehaviorContract');
    expect(contracts).toContain('### compat path / wrapper rules');
    expect(contracts).toContain('### API change downstream validation');
    expect(contracts).toContain('### frozen zone / UI anchor migration');
    expect(contracts).toContain('- cascade_sources：');
    expect(contracts).toContain('- breakpoint_contracts：');
    expect(contracts).toContain('- removal_precondition：');
  });

  test('workflow guide documents the design production chain', () => {
    const guide = fs.readFileSync(path.join(OUTPUT_DIR, 'WORKFLOW_GUIDE.md'), 'utf8');
    expect(guide).toContain('Design mode');
    expect(guide).toContain('Design source');
    expect(guide).toContain('Design acceptance');
    expect(guide).toContain('Design evidence');
    expect(guide).toContain('design drift review');
    expect(guide).toContain('DESIGN.md` 只能作为 optional source');
    expect(guide).toContain('workflow-system 不绑定具体设计生成工具');
  });

  test('baseline gate skeleton covers v26 blocker families', () => {
    const baselines = fs.readFileSync(path.join(OUTPUT_DIR, 'BASELINES.md'), 'utf8');
    expect(baselines).toContain('### GATE-002: P0 前置 gap 错误码');
    expect(baselines).toContain('### GATE-003: P1 直接变更不允许错误码');
    expect(baselines).toContain('### GATE-004: P2 迁移缺失错误码');
    expect(baselines).toContain('### GATE-005: P3 contract 破坏错误码');
    expect(baselines).toContain('### GATE-006: P4 链式风险升级错误码');
    expect(baselines).toContain('### GATE-007: 兼容窗口与移除前提错误码');
    expect(baselines).toContain('`IMPACT_LOCKED_HIT_GAP_UNRESOLVED`');
    expect(baselines).toContain('`REGISTRY_FRESHNESS_STALE_LOCKED_HIT`');
    expect(baselines).toContain('`COMPAT_REMOVAL_PRECONDITION_UNMET`');
  });

  test('docs generation accepts repo-level profile patterns via shared validation', () => {
    const profile = loadProfile(path.join(ROOT, 'PROJECT_PROFILE.yaml'));
    expect(() => validateProfilePathSemantics(profile)).not.toThrow();
  });
});
