import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { loadProfile, validateProfilePathSemantics } from '../scripts/workflow-core';

const ROOT = path.resolve(import.meta.dir, '..');
const OUTPUT_DIR = path.join(ROOT, 'generated', 'workflow-docs');

const EXPECTED_DOCS = [
  'CONTRACTS.md',
  'CURRENT_TASK.md',
  'DECISIONS.md',
  'LESSONS.md',
  'STATUS.md',
  'TASK_ARCHIVE.md',
  'TASK_SUMMARY.md',
] as const;

const REQUIRED_HEADINGS: Record<(typeof EXPECTED_DOCS)[number], string[]> = {
  'CONTRACTS.md': ['## 使用规则', '## 一、接口契约', '## 二、架构契约', '## 三、变更规则'],
  'CURRENT_TASK.md': [
    '## 任务信息',
    '## 背景与上下文',
    '## 验收标准',
    '## 允许修改范围',
    '## 禁止修改范围',
    '## 受影响的契约',
    '## 已确认决策',
    '## 待确认问题',
    '## 实施步骤',
    '## 回归检查项',
    '## 回滚点',
    '## 执行记录',
  ],
  'DECISIONS.md': ['## 使用规则', '## 🏗️ 架构决策', '## 🎨 口味决策', '## ⏸️ 暂缓决策', '## ❌ 已否决'],
  'LESSONS.md': [
    '## 使用规则',
    '## 通用',
    '## 数据与存储',
    '## 前端与交互',
    '## 后端与服务',
    '## 测试与回归',
    '## 部署与运行时',
  ],
  'STATUS.md': [
    '## 项目概览',
    '## ✅ 已完成且稳定',
    '## 🔨 正在开发',
    '## 📋 待开发',
    '## ⚠️ 已知风险 / 观察点',
    '## ❌ 已移除 / 推迟',
    '## 🔜 下一检查点',
    '## 最近更新记录',
  ],
  'TASK_ARCHIVE.md': [
    '## 任务元数据',
    '## 原始任务包快照',
    '## 实际改动摘要',
    '## 契约与决策记录',
    '## 验证与交付证据',
    '## Lessons 回写',
    '## 后续关联',
  ],
  'TASK_SUMMARY.md': [
    '## 任务信息',
    '## 目标与结果',
    '## 改动范围',
    '## 契约与决策变化',
    '## 验证结果',
    '## 风险与后续',
    '## 交付清单',
  ],
};

const ALLOWED_UNRESOLVED = new Set([
  '{{TASK_ID}}',
  '{{TASK_TITLE}}',
  '{{TASK_SLUG}}',
  '{{DATE}}',
  '{{AUTHOR}}',
]);

describe('gen-workflow-docs', () => {
  beforeAll(() => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'gen:workflow-docs'],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `gen:workflow-docs failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
      );
    }
  });

  test('generates the full workflow docs set', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.md')).sort();
    expect(files).toEqual([...EXPECTED_DOCS].sort());
  });

  test('every generated workflow doc has required headings', () => {
    for (const file of EXPECTED_DOCS) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8');
      for (const heading of REQUIRED_HEADINGS[file]) {
        expect(content.includes(heading)).toBe(true);
      }
    }
  });

  test('project placeholders are fully resolved', () => {
    for (const file of EXPECTED_DOCS) {
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
    for (const file of EXPECTED_DOCS) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8');
      const matches = content.match(/{{[^}]+}}/g) ?? [];
      const unresolved = matches.filter(token => !ALLOWED_UNRESOLVED.has(token));
      expect(unresolved).toEqual([]);
    }
  });

  test('docs generation accepts repo-level profile patterns via shared validation', () => {
    const profile = loadProfile(path.join(ROOT, 'PROJECT_PROFILE.yaml'));
    expect(() => validateProfilePathSemantics(profile)).not.toThrow();
  });
});
