import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import {
  getWorkflowGeneratedDir,
  getWorkflowProfilePath,
  getWorkflowRegistryPath,
  loadProfile,
  validateProfilePathSemantics,
} from '../scripts/workflow-core';

const ROOT = path.resolve(import.meta.dir, '..');
const PROFILE = loadProfile(getWorkflowProfilePath(ROOT));
const REGISTRY_PATH = getWorkflowRegistryPath(ROOT, PROFILE);
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'skills');
const GENERATED_SKILLS_DIR = getWorkflowGeneratedDir(ROOT, PROFILE, 'workflow-skills');

const EXPECTED_SECTIONS = [
  { heading: '### 3.1 初始化', stage: '初始化' },
  { heading: '### 3.2 阶段 1：需求进入', stage: '阶段 1：需求进入' },
  { heading: '### 3.3 阶段 2：范围锁定', stage: '阶段 2：范围锁定' },
  { heading: '### 3.4 阶段 3：方案拆解', stage: '阶段 3：方案拆解' },
  { heading: '### 3.5 阶段 4：小步实现', stage: '阶段 4：小步实现' },
  { heading: '### 3.6 阶段 4/6：异常处理', stage: '阶段 4/6：实现或验证异常' },
  { heading: '### 3.7 阶段 5：范围复核', stage: '阶段 5：范围复核' },
  { heading: '### 3.8 阶段 6：回归验证', stage: '阶段 6：回归验证' },
  { heading: '### 3.9 阶段 7：状态同步', stage: '阶段 7：状态同步' },
  { heading: '### 3.10 阶段 8：交付沉淀', stage: '阶段 8：交付沉淀' },
] as const;

const ALLOWED_UNRESOLVED = new Set(['{{TASK_ID}}', '{{TASK_SLUG}}']);

type RegistryRow = {
  columns: string[];
  name: string;
  stage: string;
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
  const rows: RegistryRow[] = [];
  let currentStage = '';

  for (const line of content.split(/\r?\n/)) {
    const section = EXPECTED_SECTIONS.find(entry => line === entry.heading);
    if (section) {
      currentStage = section.stage;
      continue;
    }

    if (!/^\| `[^`]+` \|/.test(line)) {
      continue;
    }

    const columns = line.split('|').slice(1, -1).map(cell => cell.trim());
    const nameMatch = columns[0]?.match(/^`([^`]+)`$/);
    const successMatch = columns[5]?.match(/^`([^`]+)`$/);
    const failureMatch = columns[6]?.match(/^`([^`]+)`$/);

    expect(currentStage).not.toBe('');
    expect(nameMatch).not.toBeNull();
    expect(successMatch).not.toBeNull();
    expect(failureMatch).not.toBeNull();

    rows.push({
      columns,
      name: nameMatch![1],
      stage: currentStage,
      handoffSuccess: successMatch![1],
      handoffFailure: failureMatch![1],
    });
  }

  return rows;
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

function generatedSkillMetadata(): Map<string, { stage: string; handoffSuccess: string; handoffFailure: string }> {
  if (!fs.existsSync(GENERATED_SKILLS_DIR)) {
    throw new Error(
      `Missing generated workflow skills directory: ${GENERATED_SKILLS_DIR}. ` +
        'test:registry expects committed generated skills and must not generate them during the test run.',
    );
  }

  const files = fs.readdirSync(GENERATED_SKILLS_DIR).filter(file => file.endsWith('.SKILL.md'));
  if (files.length === 0) {
    throw new Error(
      `No generated workflow skills found in ${GENERATED_SKILLS_DIR}. ` +
        'test:registry expects committed generated skills and must not generate them during the test run.',
    );
  }

  return new Map(
    files
      .map(file => {
        const frontmatter = parseFrontmatter(path.join(GENERATED_SKILLS_DIR, file));
        const handoff = frontmatter.handoff as Record<string, unknown>;
        return [
          String(frontmatter.name),
          {
            stage: String(frontmatter.stage),
            handoffSuccess: String(handoff.success),
            handoffFailure: String(handoff.failure),
          },
        ] as const;
      }),
  );
}

describe('gen-registry', () => {
  test('generates one registry row for every workflow skill template', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const rows = parseRegistryRows(content);
    expect(rows.map(row => row.name).sort()).toEqual(expectedSkillNames());
  });

  test('supersede-current-task is registered with the expected stage and handoff', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const rows = parseRegistryRows(content);
    const row = rows.find(entry => entry.name === 'supersede-current-task');

    expect(row).toBeDefined();
    expect(row?.stage).toBe('阶段 1：需求进入');
    expect(row?.handoffSuccess).toBe('review-current-task');
    expect(row?.handoffFailure).toBe('ask-user');
  });

  test('supersede-current-task stays between create-current-task and review-current-task', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const stageOneNames = parseRegistryRows(content)
      .filter(row => row.stage === '阶段 1：需求进入')
      .map(row => row.name);

    expect(stageOneNames.indexOf('create-current-task')).toBeLessThan(
      stageOneNames.indexOf('supersede-current-task'),
    );
    expect(stageOneNames.indexOf('supersede-current-task')).toBeLessThan(
      stageOneNames.indexOf('review-current-task'),
    );
    expect(content).toContain(
      '| 阶段 1：需求进入 | `execute-current-task` → `create-current-task` → `supersede-current-task` → `review-current-task` |',
    );
  });

  test('initialization stage preserves the two-step bootstrap ordering', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const rows = parseRegistryRows(content);
    const initSkills = rows
      .filter(row => row.stage === '初始化')
      .map(row => row.name);

    expect(initSkills).toEqual([
      'design-baseline-init',
      'realign-workflow-assets',
      'greenfield-init',
      'legacy-inventory',
      'adopt-existing-project',
    ]);
    expect(content).toContain('| 初始化 | `design-baseline-init` → `realign-workflow-assets` → `greenfield-init` / `legacy-inventory` → `adopt-existing-project` |');
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
    for (const section of EXPECTED_SECTIONS) {
      expect(content.includes(section.heading)).toBe(true);
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

  test('registry stage and handoff metadata matches generated workflow skills exactly', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const rows = parseRegistryRows(content);
    const generated = generatedSkillMetadata();

    expect(rows.length).toBe(generated.size);
    for (const row of rows) {
      const skill = generated.get(row.name);
      expect(skill).toBeDefined();
      expect(row.stage).toBe(skill!.stage);
      expect(row.handoffSuccess).toBe(skill!.handoffSuccess);
      expect(row.handoffFailure).toBe(skill!.handoffFailure);
    }
  });

  test('supersede-current-task is listed as a high-risk registry skill', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const highRiskSection = content.slice(content.indexOf('## 4. 高风险 / 重点审计 skill'));

    expect(highRiskSection).toContain('- `supersede-current-task`');
  });

  test('only task placeholders remain unresolved', () => {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const matches = content.match(/{{[^}]+}}/g) ?? [];
    const unresolved = matches.filter(token => !ALLOWED_UNRESOLVED.has(token));
    expect(unresolved).toEqual([]);
  });

  test('registry generation accepts repo-level profile patterns via shared validation', () => {
    const profile = loadProfile(getWorkflowProfilePath(ROOT));
    expect(() => validateProfilePathSemantics(profile)).not.toThrow();
  });
});
