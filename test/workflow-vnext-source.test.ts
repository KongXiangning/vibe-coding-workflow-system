import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateVNextSource } from '../scripts/vnext-source-contract';

const ROOT = path.resolve(import.meta.dir, '..');
const temporaryRoots: string[] = [];

function copyFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-source-test-'));
  temporaryRoots.push(root);
  fs.cpSync(
    path.join(ROOT, '.workflow-system', 'vnext'),
    path.join(root, '.workflow-system', 'vnext'),
    { recursive: true },
  );
  fs.cpSync(
    path.join(ROOT, 'templates', 'vnext'),
    path.join(root, 'templates', 'vnext'),
    { recursive: true },
  );
  fs.cpSync(
    path.join(ROOT, 'templates', 'skills'),
    path.join(root, 'templates', 'skills'),
    { recursive: true },
  );
  return root;
}

function fixtureFile(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split('/'));
}

function replaceIn(root: string, relativePath: string, search: string, replacement: string): void {
  const file = fixtureFile(root, relativePath);
  const content = fs.readFileSync(file, 'utf8');
  expect(content).toContain(search);
  fs.writeFileSync(file, content.replace(search, replacement));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('vNext Phase 2 source contract', () => {
  test('accepts exactly the seven daily entries and closed catalogs', () => {
    const result = validateVNextSource(ROOT);

    expect(result.phase).toBe('Phase 2');
    expect(result.entries).toEqual([
      'prepare-task',
      'review-change',
      'execute-step',
      'debug-task',
      'task-lifecycle',
      'capture-work-item',
      'close-task',
    ]);
    expect(result.capabilities).toHaveLength(23);
    expect(result.runtimeOperations).toEqual([
      'archive-transaction',
      'finding-queue-transaction',
      'inbox-record-transaction',
      'lesson-record-transaction',
      'lifecycle-transaction',
      'project-status-transaction',
      'task-state-transaction',
    ]);
    expect(result.legacySkillNames).toHaveLength(37);
  });

  test('rejects a review template with direct writes', () => {
    const root = copyFixture();
    replaceIn(
      root,
      'templates/vnext/skills/review-change.SKILL.md.tmpl',
      '    product_files: []',
      '    product_files:\n      - admitted_scope',
    );

    expect(() => validateVNextSource(root)).toThrow(/review-change.*direct product write boundary|review-change.*product files/i);
  });

  test('rejects prepare-task product writes and execute-step governance writes', () => {
    const prepareRoot = copyFixture();
    replaceIn(
      prepareRoot,
      'templates/vnext/skills/prepare-task.SKILL.md.tmpl',
      '    product_files: []',
      '    product_files:\n      - admitted_scope',
    );
    expect(() => validateVNextSource(prepareRoot)).toThrow(/prepare-task.*product files/i);

    const executeRoot = copyFixture();
    replaceIn(
      executeRoot,
      'templates/vnext/skills/execute-step.SKILL.md.tmpl',
      '    governance_sources: []',
      '    governance_sources:\n      - CURRENT_TASK.md',
    );
    expect(() => validateVNextSource(executeRoot)).toThrow(/execute-step.*governance sources/i);
  });

  test('keeps non-admitted review findings reportable instead of making them entry blockers', () => {
    const file = fixtureFile(ROOT, 'templates/vnext/skills/review-change.SKILL.md.tmpl');
    const content = fs.readFileSync(file, 'utf8');

    expect(content).not.toContain('a finding lacks sufficient evidence or an authorized owner route');
    expect(content).toContain('findings, evidence gaps, and finding-admission dispositions');
  });

  test('requires source authority, task identity, and adaptive depth for execute-step', () => {
    const root = copyFixture();
    replaceIn(
      root,
      'templates/vnext/skills/execute-step.SKILL.md.tmpl',
      '    - source-authority-policy\n',
      '',
    );

    expect(() => validateVNextSource(root)).toThrow(/execute-step.*mandatory capability "source-authority-policy"/i);
  });

  test('keeps debug ownership conditional and lesson admission non-blocking for closure', () => {
    const debug = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/debug-task.SKILL.md.tmpl'),
      'utf8',
    );
    expect(debug).toContain('task ownership is required for a task-state proposal or resolve route');
    expect(debug).toContain('For a current-task proposal or `resolve`');
    expect(debug).not.toContain('symptom, target, or task ownership is missing or conflicted');

    const close = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/close-task.SKILL.md.tmpl'),
      'utf8',
    );
    expect(close).toContain('Lesson admission may return `admit`, `defer`, or `no-op`');
    expect(close).toContain('never blocks an otherwise eligible closure');
    expect(close).not.toContain('or lesson admission cannot be verified');
  });

  test('scopes lifecycle evidence requirements to the selected transition', () => {
    const lifecycle = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/task-lifecycle.SKILL.md.tmpl'),
      'utf8',
    );
    expect(lifecycle).toContain('required evidence for the selected lifecycle transition is incomplete');
    expect(lifecycle).not.toContain('snapshot, checkpoint, dirty attribution, or recovery evidence is incomplete');
  });

  test('rejects cycle phases promoted into a mode', () => {
    const root = copyFixture();
    replaceIn(
      root,
      'templates/vnext/skills/review-change.SKILL.md.tmpl',
      '    - report-only',
      '    - discovery',
    );

    expect(() => validateVNextSource(root)).toThrow(/review-change.*mode/i);
  });

  test('rejects a lifecycle mode outside its closed set', () => {
    const root = copyFixture();
    replaceIn(
      root,
      'templates/vnext/skills/task-lifecycle.SKILL.md.tmpl',
      '    - supersede',
      '    - replan',
    );

    expect(() => validateVNextSource(root)).toThrow(/task-lifecycle.*mode/i);
  });

  test('accepts capture-work-item as a vNext entry while keeping its record-only boundary', () => {
    const result = validateVNextSource(ROOT);

    expect(result.entries).toContain('capture-work-item');
  });

  test('rejects capture-work-item when its legacy-name collision is used as an executable target', () => {
    const root = copyFixture();
    const file = fixtureFile(root, 'templates/vnext/skills/capture-work-item.SKILL.md.tmpl');
    fs.appendFileSync(file, '\nRoute this work to capture-work-item.\n');

    expect(() => validateVNextSource(root)).toThrow(/legacy Skill ID "capture-work-item"/i);
  });

  test('rejects missing capability references and public capability exposure', () => {
    const missingCapabilityRoot = copyFixture();
    replaceIn(
      missingCapabilityRoot,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '  - id: scope-guard',
      '  - id: missing-scope-guard',
    );
    expect(() => validateVNextSource(missingCapabilityRoot)).toThrow(/missing required "scope-guard"/i);

    const publicCapabilityRoot = copyFixture();
    replaceIn(
      publicCapabilityRoot,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '  - id: scope-guard\n    exposure: internal',
      '  - id: scope-guard\n    exposure: daily',
    );
    expect(() => validateVNextSource(publicCapabilityRoot)).toThrow(/capability "scope-guard" must be internal/i);
  });

  test('rejects Runtime binding before Phase 2', () => {
    const root = copyFixture();
    replaceIn(
      root,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '    status: contract-only',
      '    status: bound',
    );

    expect(() => validateVNextSource(root)).toThrow(/must be contract-only/i);
  });

  test('rejects legacy frontmatter fields and old Skill executable targets', () => {
    const legacyFieldRoot = copyFixture();
    replaceIn(
      legacyFieldRoot,
      'templates/vnext/skills/prepare-task.SKILL.md.tmpl',
      '---\nentry_contract:',
      '---\nstage: legacy\nentry_contract:',
    );
    expect(() => validateVNextSource(legacyFieldRoot)).toThrow(/legacy field "stage"|frontmatter keys mismatch/i);

    const legacyTargetRoot = copyFixture();
    const file = fixtureFile(legacyTargetRoot, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl');
    fs.appendFileSync(file, '\nDo not route to create-current-task.\n');
    expect(() => validateVNextSource(legacyTargetRoot)).toThrow(/legacy Skill ID "create-current-task"/i);
  });

  test('rejects extra public vNext templates', () => {
    const root = copyFixture();
    fs.copyFileSync(
      fixtureFile(root, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl'),
      fixtureFile(root, 'templates/vnext/skills/internal-capability.SKILL.md.tmpl'),
    );

    expect(() => validateVNextSource(root)).toThrow(/vNext skill template files.*extra|must equal/i);
  });
});
