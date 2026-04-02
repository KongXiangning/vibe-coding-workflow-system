import { beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const ROOT = path.resolve(import.meta.dir, '..');
const REGISTRY_PATH = path.join(ROOT, 'SKILL_REGISTRY.md');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'skills');

const EXPECTED_SECTION_HEADINGS = [
  '### 3.1 初始化',
  '### 3.2 阶段 1：需求进入',
  '### 3.3 阶段 2：范围锁定',
  '### 3.4 阶段 3：方案拆解',
  '### 3.5 阶段 4：小步实现',
  '### 3.6 阶段 4/6：异常处理',
  '### 3.7 阶段 5：范围复核',
  '### 3.8 阶段 6：回归验证',
  '### 3.9 阶段 7：状态同步',
  '### 3.10 阶段 8：交付沉淀',
] as const;

const ALLOWED_UNRESOLVED = new Set(['{{TASK_ID}}', '{{TASK_SLUG}}']);

type RegistryRow = {
  columns: string[];
  name: string;
  handoffSuccess: string;
  handoffFailure: string;
};

function parseFrontmatter(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  expect(match).not.toBeNull();
  return parse(match![1]) as Record<string, unknown>;
}

function parseRegistryRows(content: string): RegistryRow[] {
  return content
    .split(/\r?\n/)
    .filter(line => /^\| `[^`]+` \|/.test(line))
    .map(line => {
      const columns = line.split('|').slice(1, -1).map(cell => cell.trim());
      const nameMatch = columns[0]?.match(/^`([^`]+)`$/);
      const successMatch = columns[5]?.match(/^`([^`]+)`$/);
      const failureMatch = columns[6]?.match(/^`([^`]+)`$/);

      expect(nameMatch).not.toBeNull();
      expect(successMatch).not.toBeNull();
      expect(failureMatch).not.toBeNull();

      return {
        columns,
        name: nameMatch![1],
        handoffSuccess: successMatch![1],
        handoffFailure: failureMatch![1],
      };
    });
}

function expectedSkillNames(): string[] {
  return fs
    .readdirSync(TEMPLATE_DIR)
    .filter(file => file.endsWith('.SKILL.md.tmpl'))
    .map(file => {
      const frontmatter = parseFrontmatter(path.join(TEMPLATE_DIR, file));
      return String(frontmatter.name);
    })
    .sort();
}

describe('gen-registry', () => {
  beforeAll(() => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'gen:registry'],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      throw new Error(`gen:registry failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`);
    }
  });

  test('generates one registry row for every workflow skill template', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const rows = parseRegistryRows(content);
    expect(rows.map(row => row.name).sort()).toEqual(expectedSkillNames());
  });

  test('every skill row has the expected 7 registry columns', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const rows = parseRegistryRows(content);

    expect(rows.length).toBe(expectedSkillNames().length);
    for (const row of rows) {
      expect(row.columns.length).toBe(7);
    }
  });

  test('all workflow stages are represented in the registry sections', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    for (const heading of EXPECTED_SECTION_HEADINGS) {
      expect(content.includes(heading)).toBe(true);
    }
  });

  test('every handoff target is valid', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const rows = parseRegistryRows(content);
    const names = new Set(rows.map(row => row.name));

    for (const row of rows) {
      expect(names.has(row.handoffSuccess)).toBe(true);
      expect(row.handoffFailure === 'ask-user' || names.has(row.handoffFailure)).toBe(true);
    }
  });

  test('only task placeholders remain unresolved', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const matches = content.match(/{{[^}]+}}/g) ?? [];
    const unresolved = matches.filter(token => !ALLOWED_UNRESOLVED.has(token));
    expect(unresolved).toEqual([]);
  });
});
