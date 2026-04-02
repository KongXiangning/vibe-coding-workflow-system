import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { loadProfile, pathEntriesOverlap, validatePathEntry, validateProfilePathSemantics } from '../scripts/workflow-core';

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
});
