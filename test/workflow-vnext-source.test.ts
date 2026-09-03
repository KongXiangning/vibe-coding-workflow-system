import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateVNextSource } from '../scripts/vnext-source-contract';

const ROOT = path.resolve(import.meta.dir, '..');
const temporaryRoots: string[] = [];

// P-12 admission for this persistent source-contract guard:
// the existing validator proves catalog closure but does not prove the
// evidence/admission policy expressed in template bodies.
const P12_SOURCE_CONTRACT_TEST_ADMISSION = {
  decision: 'admitted',
  owner: 'workflow-system maintainers',
  basis: 'critical-invariant',
  proves: 'vNext source contracts keep validation separate from persistent-test admission',
  existingEvidenceInsufficiency: 'catalog validation does not inspect these prompt-body semantic boundaries',
  assertionBoundary: 'vNext source contract and daily entry template behavior',
  failureDisposition: 'block the source-contract quality gate until the P-12 boundary is restored',
} as const;

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
    expect(result.administrativeEntries).toEqual(['bootstrap-project']);
    expect(result.expertEntries).toEqual(['validate-change']);
    expect(result.capabilities).toHaveLength(25);
    expect(result.runtimeOperations).toEqual([
      'archive-transaction',
      'contract-candidate-commit',
      'decision-record-transaction',
      'finding-queue-transaction',
      'inbox-record-transaction',
      'lesson-record-transaction',
      'lifecycle-transaction',
      'paired-host-guidance-transaction',
      'project-status-transaction',
      'task-state-transaction',
    ]);
    expect(result.legacySkillNames).toHaveLength(37);
  });

  test('classifies validate-change only as the single expert entry', () => {
    const dailyRoot = copyFixture();
    replaceIn(
      dailyRoot,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '  - id: prepare-task\n',
      '  - id: validate-change\n',
    );
    expect(() => validateVNextSource(dailyRoot)).toThrow(/contract\.entries\[0\]\.id "validate-change" is not a vNext entry/i);

    const adminRoot = copyFixture();
    replaceIn(
      adminRoot,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '  - id: bootstrap-project\n',
      '  - id: validate-change\n',
    );
    expect(() => validateVNextSource(adminRoot)).toThrow(/contract\.administrative_entries\[0\]\.id "validate-change" is not an administrative vNext entry/i);

    const unknownRoot = copyFixture();
    replaceIn(
      unknownRoot,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '  - id: validate-change\n    exposure: expert\n',
      '  - id: unknown-expert\n    exposure: expert\n',
    );
    expect(() => validateVNextSource(unknownRoot)).toThrow(/contract\.expert_entries\[0\]\.id "unknown-expert" is not an expert vNext entry/i);

    const duplicateRoot = copyFixture();
    replaceIn(
      duplicateRoot,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '  - id: validate-change\n    exposure: expert\n    template: templates/vnext/skills/validate-change.SKILL.md.tmpl\n',
      '  - id: validate-change\n    exposure: expert\n    template: templates/vnext/skills/validate-change.SKILL.md.tmpl\n  - id: validate-change\n    exposure: expert\n    template: templates/vnext/skills/validate-change.SKILL.md.tmpl\n',
    );
    expect(() => validateVNextSource(duplicateRoot)).toThrow(/contract\.expert_entries must contain exactly 1 expert entry/i);
  });

  test('keeps validate-change read-only with an empty mode and Runtime surface', () => {
    const template = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/validate-change.SKILL.md.tmpl'),
      'utf8',
    );
    expect(template).toContain('  mode: []');
    expect(template).toContain('    product_files: []');
    expect(template).toContain('    governance_sources: []');
    expect(template).toContain('  runtime_operations: []');
    expect(template).toContain('  output_kind: validation-result');
    expect(template).toContain('minimum-sufficient read-only evidence');
    expect(template).toContain('never creates or');
    expect(template).toContain('does not admit a finding');
    expect(template).not.toContain('validate-change:regression');
  });

  test('rejects restoration of the historical validate-change mode', () => {
    const root = copyFixture();
    fs.appendFileSync(
      fixtureFile(root, 'templates/vnext/skills/validate-change.SKILL.md.tmpl'),
      '\nHistorical route: validate-change:regression\n',
    );

    expect(() => validateVNextSource(root)).toThrow(/must not restore the legacy validate-change:regression mode/i);
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

  test('preserves P-12 evidence-first and persistent-test admission boundaries', () => {
    const sourceContract = fs.readFileSync(
      fixtureFile(ROOT, '.workflow-system/vnext/SOURCE_CONTRACT.yaml'),
      'utf8',
    );
    const prepare = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl'),
      'utf8',
    );
    const execute = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/execute-step.SKILL.md.tmpl'),
      'utf8',
    );
    const review = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/review-change.SKILL.md.tmpl'),
      'utf8',
    );
    const debug = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/debug-task.SKILL.md.tmpl'),
      'utf8',
    );
    const lifecycle = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/task-lifecycle.SKILL.md.tmpl'),
      'utf8',
    );
    const close = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/close-task.SKILL.md.tmpl'),
      'utf8',
    );

    expect(P12_SOURCE_CONTRACT_TEST_ADMISSION).toMatchObject({
      decision: 'admitted',
      basis: 'critical-invariant',
      assertionBoundary: 'vNext source contract and daily entry template behavior',
    });
    expect(sourceContract).toContain('claim model: id, kind, owner_source, certainty, impact, and existing_evidence');
    expect(sourceContract).toContain('default non-admission or user no-test deny');
    expect(sourceContract).toContain('acceptance, regression, critical-invariant, or critical-risk');
    expect(sourceContract).toContain('existing-evidence insufficiency');
    expect(sourceContract).toContain('static proof, existing regression, focused test, integration smoke');
    expect(sourceContract).toContain('assertion boundary, and failure disposition');
    expect(sourceContract).toContain('risk-analysis admission is anchored to an identified changed behavior, known failure model, and admitted task scope');
    expect(sourceContract).toContain('provisional or exploratory certainty is used to silently admit a persistent test');
    expect(sourceContract).toContain('exploratory probe budget');
    expect(sourceContract).toContain('typed proposal to an existing canonical task record');
    expect(prepare).toContain('owner_source');
    expect(prepare).toContain('evidence-admission-policy');
    expect(prepare).toContain('validation and test creation are separate decisions');
    expect(prepare).toContain('an assertion at the behavioral or contract boundary');
    expect(prepare).toContain('clear expected disposition if it fails');
    expect(prepare).toContain('a `risk-analysis` owner is valid only when anchored to an identified changed behavior, known failure model, and admitted task scope');
    expect(prepare).toContain('Provisional or exploratory certainty permits temporary probes only');
    expect(prepare).toContain('Persistent tests are not admitted by default');
    expect(prepare).toContain('test_write_policy: deny');
    expect(prepare).toContain('bounded duration, tool/run count, permitted temporary artifact locations, and cleanup/audit rule');
    expect(prepare).toContain('typed proposal into the existing canonical task record');
    expect(execute).toContain('creating or changing a persistent automated test are separate decisions');
    expect(execute).toContain('exactly one basis from `acceptance`, `regression`, `critical-invariant`, or `critical-risk`');
    expect(execute).toContain('assertion at the behavioral or contract boundary');
    expect(execute).toContain('A `risk-analysis` owner must be anchored to an identified changed behavior, known failure model, and admitted task scope');
    expect(execute).toContain('persistent-test disposition defaults to `persistent_test: false`');
    expect(execute).toContain('existing-check reuse');
    expect(review).toContain('A regression or evidence scenario is a validation obligation; it does not automatically require a new persistent automated test.');
    expect(review).toContain('Persistent-test disposition defaults to `persistent_test: false`');
    expect(review).toContain('Missing admission means the persistent test is not admitted');
    expect(review).toContain('Provisional or exploratory certainty permits temporary probes only');
    expect(review).toContain('Review may add a claim only through the same strong-evidence admission rule');
    expect(debug).toContain('A validation obligation or temporary probe does not automatically justify a persistent automated test');
    expect(debug).toContain('Persistent-test disposition defaults to `persistent_test: false`');
    expect(debug).toContain('permitted temporary artifact locations, and cleanup/audit rule');
    expect(close).toContain('persistent-test disposition defaults to `persistent_test: false`');
    expect(lifecycle).toContain('preserve each claim\'s identity, owner, certainty, admitted evidence types, and completion state');
    expect(close).toContain('closure does not infer a new test from missing evidence');
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

  test('requires evidence admission policy for prepare-task', () => {
    const root = copyFixture();
    replaceIn(
      root,
      'templates/vnext/skills/prepare-task.SKILL.md.tmpl',
      '    - evidence-admission-policy\n',
      '',
    );

    expect(() => validateVNextSource(root)).toThrow(/prepare-task.*mandatory capability "evidence-admission-policy"/i);
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
    expect(lifecycle).toContain('one typed `LifecycleProposal`');
    expect(lifecycle).toContain('Runtime resolves canonical paths');
    expect(lifecycle).toContain('recovery_package_revision');
    expect(lifecycle).not.toContain('write_incomplete');
    expect(lifecycle).not.toContain('read-back');
    expect(lifecycle).not.toContain('atomic write');
  });

  test('keeps prepare-task resume-review handling distinct from the draft Runtime actions', () => {
    const prepare = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl'),
      'utf8',
    );
    expect(prepare).toContain('clear-resume-review-gate');
    expect(prepare).toContain('default mode to `create-draft`, `update-draft`, and the existing gate-clear action');
    expect(prepare).toContain('The default draft actions may not change the identity of an existing draft, auto-confirm it, or write arbitrary Markdown.');
  });

  test('keeps execute-step behind the resume-review gate', () => {
    const execute = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/execute-step.SKILL.md.tmpl'),
      'utf8',
    );
    expect(execute).toContain('resume_requires_review');
    expect(execute).toContain('route through `prepare-task` readiness/resume review');
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

  test('rejects removing the Phase 2 Runtime binding', () => {
    const root = copyFixture();
    replaceIn(
      root,
      '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
      '  - id: inbox-record-transaction\n    status: bound\n    binding: vnext-runtime',
      '  - id: inbox-record-transaction\n    status: contract-only\n    binding: unbound',
    );

    expect(() => validateVNextSource(root)).toThrow(/Runtime operation "inbox-record-transaction" must be bound/i);
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
