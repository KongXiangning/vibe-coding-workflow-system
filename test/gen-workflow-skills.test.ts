import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import {
  getWorkflowDocRelativePath,
  getWorkflowGeneratedDir,
  getWorkflowProfilePath,
  loadProfile,
  pathEntriesOverlap,
  validatePathEntry,
  validateProfilePathSemantics,
  WORKFLOW_PROFILE_RELATIVE_PATH,
} from '../scripts/workflow-core';
import { WORKFLOW_DOC_REQUIRED_HEADINGS } from '../scripts/workflow-doc-contracts';

const ROOT = path.resolve(import.meta.dir, '..');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'skills');
const PROFILE = loadProfile(getWorkflowProfilePath(ROOT));
const OUTPUT_DIR = getWorkflowGeneratedDir(ROOT, PROFILE, 'workflow-skills');
const CURRENT_TASK_DOC = getWorkflowDocRelativePath(PROFILE, 'CURRENT_TASK.md');
const CONTRACTS_DOC = getWorkflowDocRelativePath(PROFILE, 'CONTRACTS.md');
const DECISIONS_DOC = getWorkflowDocRelativePath(PROFILE, 'DECISIONS.md');
const STATUS_DOC = getWorkflowDocRelativePath(PROFILE, 'STATUS.md');
const BASELINES_DOC = getWorkflowDocRelativePath(PROFILE, 'BASELINES.md');

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

  test('every conditional handoff target is valid when declared', () => {
    const files = fs.readdirSync(OUTPUT_DIR).filter(file => file.endsWith('.SKILL.md'));
    const names = new Set<string>();

    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      names.add(String(frontmatter.name));
    }

    for (const file of files) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, file));
      const conditional = frontmatter.conditional_handoff as Record<string, unknown> | undefined;
      if (!conditional) {
        continue;
      }

      for (const target of Object.values(conditional)) {
        const normalized = String(target);
        expect(normalized === 'ask-user' || names.has(normalized)).toBe(true);
      }
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
    const profile = loadProfile(getWorkflowProfilePath(ROOT));
    expect(() => validateProfilePathSemantics(profile)).not.toThrow();

    const forbidden = normalizeList((profile.boundaries as Record<string, unknown>).forbidden_paths);
    for (const entry of forbidden) {
      expect(() => validatePathEntry(entry, 'forbidden_writes', WORKFLOW_PROFILE_RELATIVE_PATH)).not.toThrow();
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
      `${CURRENT_TASK_DOC} 中的任务 ID 或任务 slug 仍为占位符或缺失`,
    );

    const content = fs.readFileSync(archiveTaskPath, 'utf8');
    expect(content).toContain('TASK-{{TASK_ID}}-{{TASK_SLUG}}.md');
    expect(content).toContain(`任务标识必须从 ${CURRENT_TASK_DOC} 的任务信息读取`);
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
    for (const skill of [
      'design-baseline-init',
      'realign-workflow-assets',
      'greenfield-init',
      'legacy-inventory',
      'adopt-existing-project',
    ]) {
      const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, `${skill}.SKILL.md`));
      const reads = normalizeList(frontmatter.reads);
      const content = fs.readFileSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`), 'utf8');
      expect(reads).toContain('.workflow-system/WORKFLOW_PROTOCOL.md');
      expect(reads).toContain('.workflow-system/FILE_SCHEMAS.md');
      expect(reads).toContain('templates/docs/');
      expect(content).toContain('.workflow-system/FILE_SCHEMAS.md');
      expect(content).toContain('templates/docs/');
    }

    const designBaseline = parseFrontmatter(path.join(OUTPUT_DIR, 'design-baseline-init.SKILL.md'));
    const designHandoff = designBaseline.handoff as Record<string, unknown>;
    expect(designHandoff.success).toBe('greenfield-init');

    const realign = parseFrontmatter(path.join(OUTPUT_DIR, 'realign-workflow-assets.SKILL.md'));
    const realignReads = normalizeList(realign.reads);
    const realignWrites = normalizeList(realign.writes);
    const realignHandoff = realign.handoff as Record<string, unknown>;
    const realignContent = fs.readFileSync(path.join(OUTPUT_DIR, 'realign-workflow-assets.SKILL.md'), 'utf8');
    expect(realignHandoff.success).toBe('greenfield-init');
    expect(realignReads).toContain('.workflow-system/PROJECT_PROFILE.yaml');
    expect(realignReads).toContain('docs/workflow/DOCUMENT_CATALOG.md');
    expect(realignReads).toContain('generated/workflow-docs/**');
    expect(realignWrites).toContain('.claude/skills/**');
    expect(realignWrites).toContain('.codex/skills/**');
    expect(realignContent).toContain('`workflow-system-` 前缀');
    expect(realignContent).toContain('不静默删除 live docs 或 live runtime skills');

    const legacyInventory = parseFrontmatter(path.join(OUTPUT_DIR, 'legacy-inventory.SKILL.md'));
    const legacyHandoff = legacyInventory.handoff as Record<string, unknown>;
    expect(legacyHandoff.success).toBe('adopt-existing-project');
  });

  test('task intake and review skills enforce mutation scope and precedence gates', () => {
    const createFrontmatter = parseFrontmatter(path.join(OUTPUT_DIR, 'create-current-task.SKILL.md'));
    const createForbidden = normalizeList(createFrontmatter.forbidden_writes);
    expect(createForbidden).toContain('.workflow-system/PROJECT_PROFILE.yaml');
    expect(createForbidden).toContain(CONTRACTS_DOC);

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
    expect(reviewTask).toContain(`${CONTRACTS_DOC} 是项目层最高约束，${CURRENT_TASK_DOC} 不得覆盖`);

    const lockScope = fs.readFileSync(path.join(OUTPUT_DIR, 'lock-scope.SKILL.md'), 'utf8');
    expect(lockScope).toContain('未明确允许的文件默认禁止修改');

    const reviewDiff = fs.readFileSync(path.join(OUTPUT_DIR, 'review-diff.SKILL.md'), 'utf8');
    expect(reviewDiff).toContain('发现未授权文件出现在 diff 中');
    expect(reviewDiff).toContain('Change Propagation Check');
    expect(reviewDiff).toContain('sync-review-findings');
  });

  test('review findings are persisted through a dedicated sync skill before fix implementation', () => {
    const syncFindingsPath = path.join(OUTPUT_DIR, 'sync-review-findings.SKILL.md');
    expect(fs.existsSync(syncFindingsPath)).toBe(true);

    const frontmatter = parseFrontmatter(syncFindingsPath);
    const handoff = frontmatter.handoff as Record<string, unknown>;
    const conditionalHandoff = frontmatter.conditional_handoff as Record<string, unknown>;
    expect(normalizeList(frontmatter.reads)).toContain(CURRENT_TASK_DOC);
    expect(normalizeList(frontmatter.writes)).toEqual([CURRENT_TASK_DOC]);
    expect(normalizeList(frontmatter.forbidden_writes)).toContain(CONTRACTS_DOC);
    expect(handoff.success).toBe('implement-current-step');
    expect(conditionalHandoff.queued_fixable_findings).toBe('implement-current-step');
    expect(conditionalHandoff.scope_widening).toBe('lock-scope');
    expect(conditionalHandoff.product_contract_architecture).toBe('ask-user');
    expect(conditionalHandoff.unknown_root_cause).toBe('investigate-root-cause');
    expect(conditionalHandoff.invalid_finding_input).toBe('ask-user');

    const syncFindings = fs.readFileSync(syncFindingsPath, 'utf8');
    expect(syncFindings).toContain('conditional_handoff');
    expect(syncFindings).toContain('审查问题队列');
    expect(syncFindings).toContain('Failure scenario');
    expect(syncFindings).toContain('Minimal fix direction');
    expect(syncFindings).toContain('Required test');
    expect(syncFindings).toContain('review-implementation');

    const implementStep = fs.readFileSync(path.join(OUTPUT_DIR, 'implement-current-step.SKILL.md'), 'utf8');
    expect(implementStep).toContain('Review Finding Intake');
    expect(implementStep).toContain('Status: open');
    expect(implementStep).toContain('resolved');
  });

  test('review routing stays machine-readable for clean and finding detours', () => {
    const reviewDiffPath = path.join(OUTPUT_DIR, 'review-diff.SKILL.md');
    const frontmatter = parseFrontmatter(reviewDiffPath);
    const handoff = frontmatter.handoff as Record<string, unknown>;
    const conditionalHandoff = frontmatter.conditional_handoff as Record<string, unknown>;

    expect(handoff.success).toBe('review-implementation');
    expect(handoff.failure).toBe('ask-user');
    expect(conditionalHandoff.clean).toBe('review-implementation');
    expect(conditionalHandoff.mechanical_implementation).toBe('sync-review-findings');
    expect(conditionalHandoff.scope_widening).toBe('lock-scope');
    expect(conditionalHandoff.product_contract_architecture).toBe('ask-user');
    expect(conditionalHandoff.unknown_root_cause).toBe('investigate-root-cause');

    const reviewDiff = fs.readFileSync(reviewDiffPath, 'utf8');
    expect(reviewDiff).toContain('conditional_handoff');
    expect(reviewDiff).toContain('handoff.success` 只适用于 clean review');
    expect(reviewDiff).toContain('Classify the result using `conditional_handoff` before choosing the next skill.');
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

  test('post-release verification is integrated without adding native deploy skill names', () => {
    for (const skill of ['land-and-deploy', 'canary', 'benchmark', 'setup-deploy']) {
      expect(fs.existsSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`))).toBe(false);
      expect(fs.existsSync(path.join(TEMPLATE_DIR, `${skill}.SKILL.md.tmpl`))).toBe(false);
    }

    for (const skill of [
      'create-current-task',
      'review-current-task',
      'run-regression',
      'sync-status',
      'prepare-delivery-summary',
      'archive-task',
    ]) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, `${skill}.SKILL.md`), 'utf8');
      expect(content).toContain('Release mode');
      expect(content).toContain('Deploy source');
      expect(content).toContain('Target environment');
      expect(content).toContain('Health checks');
      expect(content).toContain('Canary window');
      expect(content).toContain('Performance baseline');
      expect(content).toContain('Rollback / recovery');
      expect(content).toContain('Release evidence');
    }

    const reviewTask = fs.readFileSync(path.join(OUTPUT_DIR, 'review-current-task.SKILL.md'), 'utf8');
    expect(reviewTask).toContain('生产发布缺少回滚方案');

    const lockScope = fs.readFileSync(path.join(OUTPUT_DIR, 'lock-scope.SKILL.md'), 'utf8');
    expect(lockScope).toContain('生产、部署、回滚、CI/CD、监控配置、性能基线变更是否选择 guarded');

    const runRegression = fs.readFileSync(path.join(OUTPUT_DIR, 'run-regression.SKILL.md'), 'utf8');
    expect(runRegression).toContain('deploy-verification');
    expect(runRegression).toContain('canary');
    expect(runRegression).toContain('benchmark');
    expect(runRegression).toContain('缺少生产 session、deploy log、health endpoint 或 baseline 时输出 blocked');

    const syncStatus = fs.readFileSync(path.join(OUTPUT_DIR, 'sync-status.SKILL.md'), 'utf8');
    expect(syncStatus).toContain('stable');
    expect(syncStatus).toContain('observing');
    expect(syncStatus).toContain('blocked');
    expect(syncStatus).toContain('rolled-back');

    const deliverySummary = fs.readFileSync(path.join(OUTPUT_DIR, 'prepare-delivery-summary.SKILL.md'), 'utf8');
    const archiveTask = fs.readFileSync(path.join(OUTPUT_DIR, 'archive-task.SKILL.md'), 'utf8');
    expect(deliverySummary).toContain('remaining observation');
    expect(archiveTask).toContain('remaining observation');
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

  test('sync-host-guidance keeps AGENTS.md and CLAUDE.md aligned as project-wide host guidance', () => {
    const frontmatter = parseFrontmatter(path.join(OUTPUT_DIR, 'sync-host-guidance.SKILL.md'));
    const content = fs.readFileSync(path.join(OUTPUT_DIR, 'sync-host-guidance.SKILL.md'), 'utf8');
    expect(frontmatter.writes).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(frontmatter.reads).toEqual([
      '.workflow-system/PROJECT_PROFILE.yaml',
      'AGENTS.md',
      'CLAUDE.md',
      CURRENT_TASK_DOC,
      CONTRACTS_DOC,
      DECISIONS_DOC,
      STATUS_DOC,
      BASELINES_DOC,
    ]);
    expect(String((frontmatter.handoff as Record<string, unknown>).success)).toBe('capture-lessons');
    expect(content).toContain('宿主指引必须成对更新');
    expect(content).toContain('不能只改当前宿主');
    expect(content).toContain('不要出现一边已经更新、另一边继续停在旧规则');
    expect(content).toContain('# Skill: sync-host-guidance');
    expect(content).toContain('AGENTS.md 与 CLAUDE.md');
    expect(content).toContain('项目级长期规则');
  });

  test('bootstrap design and adoption skills use docs-only classified paths', () => {
    const designBaseline = parseFrontmatter(path.join(OUTPUT_DIR, 'design-baseline-init.SKILL.md'));
    const legacyInventory = parseFrontmatter(path.join(OUTPUT_DIR, 'legacy-inventory.SKILL.md'));

    expect(normalizeList(designBaseline.writes)).toContain('docs/designs/architecture.md');
    expect(normalizeList(designBaseline.writes)).toContain('docs/designs/database.md');
    expect(normalizeList(legacyInventory.writes)).toContain('docs/adoption/architecture-inventory.md');
    expect(normalizeList(legacyInventory.writes)).toContain('docs/adoption/database-inventory.md');
  });
});
