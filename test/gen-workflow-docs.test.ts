import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { loadProfile, validateProfilePathSemantics } from '../scripts/workflow-core';
import {
  WORKFLOW_DOC_NAMES,
  WORKFLOW_DOC_REQUIRED_HEADINGS,
  WORKFLOW_DOC_RUNTIME_PLACEHOLDERS,
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
      for (const heading of WORKFLOW_DOC_REQUIRED_HEADINGS[file]) {
        expect(content.includes(heading)).toBe(true);
      }
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

    const taskArchive = fs.readFileSync(path.join(OUTPUT_DIR, 'TASK_ARCHIVE.md'), 'utf8');
    expect(taskArchive).toContain('- 任务 ID：{{TASK_ID}}');
    expect(taskArchive).toContain('- 任务标题：{{TASK_TITLE}}');
    expect(taskArchive).toContain('- 任务 slug：{{TASK_SLUG}}');
  });

  test('docs generation accepts repo-level profile patterns via shared validation', () => {
    const profile = loadProfile(path.join(ROOT, 'PROJECT_PROFILE.yaml'));
    expect(() => validateProfilePathSemantics(profile)).not.toThrow();
  });
});
