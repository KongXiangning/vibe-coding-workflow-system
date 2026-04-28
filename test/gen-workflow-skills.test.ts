import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { loadProfile, pathEntriesOverlap, validatePathEntry, validateProfilePathSemantics } from '../scripts/workflow-core';
import { WORKFLOW_DOC_REQUIRED_HEADINGS } from '../scripts/workflow-doc-contracts';

const ROOT = path.resolve(import.meta.dir, '..');
const OUTPUT_DIR = path.join(ROOT, 'generated', 'workflow-skills');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'skills');

const REQUIRED_FIELDS = [
  'name',
  'purpose',
  'stage',
  'trigger',
  'inputs',
  'reads',
  'writes',
  'forbidden_writes',
  'must_check',
  'stop_conditions',
  'output',
  'handoff',
  'decision_policy',
  'verification',
] as const;

const REQUIRED_STAGES = new Set([
  '初始化',
  '阶段 1：需求进入',
  '阶段 2：范围锁定',
  '阶段 3：方案拆解',
  '阶段 4：小步实现',
  '阶段 4/6：实现或验证异常',
  '阶段 5：范围复核',
  '阶段 6：回归验证',
  '阶段 7：状态同步',
  '阶段 8：交付沉淀',
]);

function parseFrontmatter(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  expect(match).not.toBeNull();
  return parse(match![1]) as Record<string, unknown>;
}

function normalizeList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(item => String(item));
  return [String(value)];
}

describe('gen-workflow-skills', () => {
  beforeAll(() => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'gen:workflow-skills'],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `gen:workflow-skills failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
      );
    }
  });

  test('generates one workflow skill per template', () => {
    const generatedFiles = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md')).sort();
    const templateFiles = fs
      .readdirSync(TEMPLATE_DIR)
      .filter(file => file.endsWith('.SKILL.md.tmpl'))
      .map(file => file.replace(/\.tmpl$/, ''))
      .sort();

    expect(generatedFiles).toEqual(templateFiles);
  });

  test('every generated workflow skill has required schema fields', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md'));
    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      for (const field of REQUIRED_FIELDS) {
        expect(field in frontmatter).toBe(true);
      }
    }
  });

  test('every handoff target is valid', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md'));
    const names = new Set<string>();

    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      names.add(String(frontmatter.name));
    }

    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      const handoff = frontmatter.handoff as Record<string, unknown>;
      expect(typeof handoff.success).toBe('string');
      expect(names.has(String(handoff.success))).toBe(true);

      const failure = String(handoff.failure);
      expect(failure === 'ask-user' || names.has(failure)).toBe(true);
    }
  });

  test('no generated skill has writes/forbidden_writes conflicts', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md'));
    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      const writes = normalizeList(frontmatter.writes);
      const forbidden = normalizeList(frontmatter.forbidden_writes);
      for (const entry of writes) {
        for (const forbiddenEntry of forbidden) {
          expect(pathEntriesOverlap(entry, forbiddenEntry)).toBe(false);
        }
      }
    }
  });

  test('all rendered path fields use the restricted pattern grammar', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md'));
    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      for (const field of ['reads', 'writes', 'forbidden_writes'] as const) {
        for (const entry of normalizeList(frontmatter[field])) {
          expect(() => validatePathEntry(entry, field, file)).not.toThrow();
        }
      }
    }
  });

  test('profile forbidden paths remain restricted while repo-level patterns stay valid', () => {
    const profile = loadProfile(path.join(ROOT, 'PROJECT_PROFILE.yaml'));
    expect(() => validateProfilePathSemantics(profile)).not.toThrow();

    const forbidden = normalizeList((profile.boundaries as Record<string, unknown>).forbidden_paths);
    for (const entry of forbidden) {
      expect(() => validatePathEntry(entry, 'forbidden_writes', 'PROJECT_PROFILE.yaml')).not.toThrow();
    }
  });

  test('all workflow stages are covered', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md'));
    const stages = new Set<string>();
    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      stages.add(String(frontmatter.stage));
    }

    for (const stage of REQUIRED_STAGES) {
      expect(stages.has(stage)).toBe(true);
    }
  });

  test('only task placeholders remain unresolved', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8');
      const matches = content.match(/{{[^}]+}}/g) ?? [];
      const unresolved = matches.filter(token => token !== '{{TASK_ID}}' && token !== '{{TASK_SLUG}}');
      expect(unresolved).toEqual([]);
    }
  });

  test('archive-task preserves the task archive naming contract', () => {
    const archiveTaskPath = path.join(OUTPUT_DIR, 'archive-task.SKILL.md');
    const frontmatter = parseFrontmatter(archiveTaskPath);
    expect(normalizeList(frontmatter.writes)).toContain('TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md');
    expect(normalizeList(frontmatter.stop_conditions)).toContain(
      'CURRENT_TASK.md 中的任务 ID 或任务 slug 仍为占位符或缺失',
    );

    const content = fs.readFileSync(archiveTaskPath, 'utf8');
    expect(content).toContain('TASK-{{TASK_ID}}-{{TASK_SLUG}}.md');
    expect(content).toContain('任务标识必须从 CURRENT_TASK.md 的任务信息读取');
  });

  test('create-current-task aligns its required sections with the CURRENT_TASK schema contract', () => {
    const currentTaskPath = path.join(OUTPUT_DIR, 'create-current-task.SKILL.md');
    const frontmatter = parseFrontmatter(currentTaskPath);
    const requiredSections = normalizeList(frontmatter.required_sections);
    const content = fs.readFileSync(currentTaskPath, 'utf8');
    const schemaSections = WORKFLOW_DOC_REQUIRED_HEADINGS['CURRENT_TASK.md']
      .map(heading => heading.replace(/^##\s+/, ''));

    expect(requiredSections).toEqual(schemaSections);
    expect(content).toContain('- 背景与上下文');
    expect(content).toContain('- 实施步骤');
    expect(requiredSections).not.toContain('决策分类');
    expect(content).toContain('- 已确认决策');
    expect(content).toContain('- 待确认问题');
    expect(content).not.toContain('- 决策分类');
  });

  test('bootstrap init skills read schema sources before writing governance docs', () => {
    for (const skill of ['greenfield-init', 'adopt-existing-project']) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, `${skill}.SKILL.md`));
      const reads = normalizeList(frontmatter.reads);
      const content = fs.readFileSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`), 'utf8');
      expect(reads).toContain('WORKFLOW_PROTOCOL.md');
      expect(reads).toContain('FILE_SCHEMAS.md');
      expect(reads).toContain('templates/docs/');
      expect(content).toContain('FILE_SCHEMAS.md');
      expect(content).toContain('templates/docs/');
    }
  });

  test('task intake and review skills enforce mutation scope and precedence gates', () => {
    const createFrontmatter = parseFrontmatter(path.join(OUTPUT_DIR, 'create-current-task.SKILL.md'));
    const createForbidden = normalizeList(createFrontmatter.forbidden_writes);
    expect(createForbidden).toContain('PROJECT_PROFILE.yaml');
    expect(createForbidden).toContain('CONTRACTS.md');

    for (const skill of ['create-current-task', 'review-current-task', 'lock-scope', 'review-diff']) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`), 'utf8');
      expect(content).toContain('Allowed Files');
      expect(content).toContain('Forbidden Files');
      expect(content).toContain('Conditional Files');
      expect(content).toContain('CONTRACTS.md');
      expect(content).toContain('CURRENT_TASK.md');
    }

    const reviewTask = fs.readFileSync(path.join(OUTPUT_DIR, 'review-current-task.SKILL.md'), 'utf8');
    expect(reviewTask).toContain('source-of-truth precedence');
    expect(reviewTask).toContain('CONTRACTS.md 是项目层最高约束，CURRENT_TASK.md 不得覆盖');

    const lockScope = fs.readFileSync(path.join(OUTPUT_DIR, 'lock-scope.SKILL.md'), 'utf8');
    expect(lockScope).toContain('未明确允许的文件默认禁止修改');

    const reviewDiff = fs.readFileSync(path.join(OUTPUT_DIR, 'review-diff.SKILL.md'), 'utf8');
    expect(reviewDiff).toContain('发现未授权文件出现在 diff 中');
    expect(reviewDiff).toContain('Change Propagation Check');
  });

  test('safety boundary skills are integrated without adding native safety skill names', () => {
    for (const skill of ['careful', 'freeze', 'guard', 'unfreeze']) {
      expect(fs.existsSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`))).toBe(false);
      expect(fs.existsSync(path.join(TEMPLATE_DIR, `${skill}.SKILL.md.tmpl`))).toBe(false);
    }

    const lockScope = fs.readFileSync(path.join(OUTPUT_DIR, 'lock-scope.SKILL.md'), 'utf8');
    for (const expected of [
      'Safety mode',
      'normal',
      'careful',
      'frozen-scope',
      'guarded',
      'Unlock / widening conditions',
    ]) {
      expect(lockScope).toContain(expected);
    }

    const implementStep = fs.readFileSync(path.join(OUTPUT_DIR, 'implement-current-step.SKILL.md'), 'utf8');
    for (const expected of [
      'dangerous command gate',
      'force push',
      'hard reset',
      'recursive delete',
      'database destructive operation',
    ]) {
      expect(implementStep).toContain(expected);
    }

    const reviewDiff = fs.readFileSync(path.join(OUTPUT_DIR, 'review-diff.SKILL.md'), 'utf8');
    for (const expected of [
      'safety boundary review',
      'unauthorized scope widening',
      'dangerous command',
      'deployment',
      'database',
    ]) {
      expect(reviewDiff).toContain(expected);
    }
  });

  test('design production chain is integrated without adding native design skill names', () => {
    for (const skill of ['design-consultation', 'design-shotgun', 'design-html', 'design-review']) {
      expect(fs.existsSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`))).toBe(false);
      expect(fs.existsSync(path.join(TEMPLATE_DIR, `${skill}.SKILL.md.tmpl`))).toBe(false);
    }

    for (const skill of [
      'create-current-task',
      'review-current-task',
      'decompose-task',
      'implement-current-step',
      'run-regression',
      'review-diff',
    ]) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`), 'utf8');
      expect(content).toContain('Design mode');
      expect(content).toContain('Design source');
      expect(content).toContain('Design acceptance');
      expect(content).toContain('Design evidence');
    }

    const reviewTask = fs.readFileSync(path.join(OUTPUT_DIR, 'review-current-task.SKILL.md'), 'utf8');
    expect(reviewTask).toContain('未确认口味决策不得进入实现');

    const decomposeTask = fs.readFileSync(path.join(OUTPUT_DIR, 'decompose-task.SKILL.md'), 'utf8');
    expect(decomposeTask).toContain('design exploration');
    expect(decomposeTask).toContain('design implementation');
    expect(decomposeTask).toContain('visual QA');

    const implementStep = fs.readFileSync(path.join(OUTPUT_DIR, 'implement-current-step.SKILL.md'), 'utf8');
    expect(implementStep).toContain('不得静默更换字体');
    expect(implementStep).toContain('不得静默更换颜色');
    expect(implementStep).toContain('不得静默更换布局');
    expect(implementStep).toContain('不得静默更换动效');
    expect(implementStep).toContain('不得静默更换品牌语气');

    const runRegression = fs.readFileSync(path.join(OUTPUT_DIR, 'run-regression.SKILL.md'), 'utf8');
    expect(runRegression).toContain('visual QA');
    expect(runRegression).toContain('browser-backed smoke');
    expect(runRegression).toContain('visual evidence');

    const reviewDiff = fs.readFileSync(path.join(OUTPUT_DIR, 'review-diff.SKILL.md'), 'utf8');
    expect(reviewDiff).toContain('design drift review');
    expect(reviewDiff).toContain('AI slop');
    expect(reviewDiff).toContain('响应式缺口');
  });

  test('investigate-root-cause enforces root-cause-first debugging loop', () => {
    const content = fs.readFileSync(path.join(OUTPUT_DIR, 'investigate-root-cause.SKILL.md'), 'utf8');
    expect(content).toContain('Root cause hypothesis');
    expect(content).toContain('Reproduction');
    expect(content).toContain('Evidence');
    expect(content).toContain('Minimal fix path');
    expect(content).toContain('Regression check');
    expect(content).toContain('未验证 root cause hypothesis 前不得修复');
    expect(content).toContain('若三个 root cause hypothesis 仍不收敛');
    expect(content).toContain('修复后必须复验原始失败场景');
  });

  test('run-regression enforces QA mode selection and report-only behavior', () => {
    const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, 'run-regression.SKILL.md'));
    const content = fs.readFileSync(path.join(OUTPUT_DIR, 'run-regression.SKILL.md'), 'utf8');
    expect(String((frontmatter.handoff as Record<string, unknown>).failure)).toBe('investigate-root-cause');
    for (const expected of [
      'QA mode',
      'diff-aware',
      'quick-smoke',
      'full-qa',
      'report-only',
      'authenticated-browser',
      'regression-baseline',
      'Browser/session requirement',
    ]) {
      expect(content).toContain(expected);
    }
    expect(content).toContain('report-only 模式只报告问题和证据，不进入实现或修复');
    expect(content).toContain('需要登录但 session/cookie 不可用时输出 blocked');
    expect(content).toContain('不得把未验证页面记为通过');
  });
});
