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
  test('every public vNext entry carries the canonical terminal boundary', () => {
    const result = validateVNextSource(ROOT);
    const publicEntries = [
      ...result.entries,
      ...result.administrativeEntries,
      ...result.expertEntries,
    ];
    const protocol = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/bootstrap/WORKFLOW_PROTOCOL.md'),
      'utf8',
    );

    expect(protocol).toContain('## Public entry invocation terminal boundary');
    expect(protocol).toContain('public-entry-terminal/v1');
    expect(protocol).toContain('must not invoke the next public Skill');
    expect(protocol).toContain('next_mode');
    expect(protocol).toContain('Do not copy `task-context.overview.next_entry`');
    expect(protocol).toContain('cannot observe conversation-level public Skill invocations');

    for (const entry of publicEntries) {
      const content = fs.readFileSync(
        fixtureFile(ROOT, `templates/vnext/skills/${entry}.SKILL.md.tmpl`),
        'utf8',
      );
      const requiredResult = content.indexOf('## Required result');
      const terminalMarker = content.indexOf('terminal_boundary: public-entry-terminal/v1');

      expect(requiredResult).toBeGreaterThanOrEqual(0);
      expect(terminalMarker).toBeGreaterThan(requiredResult);
      expect(content).toContain('next_route');
      expect(content).toContain('Public result routing:');
      expect(content).toContain('must not invoke another public Skill');
    }
  });

  test('rejects positive cross-public-entry continuations while allowing caller recommendations and prohibitions', () => {
    for (const continuation of [
      'After this result, route to execute-step.',
      'After this result, route through execute-step.',
      'After this result, route it to execute-step.',
      'Proceed to close-task.',
      'Invoke review-change.',
      'Call review-change.',
      'Start execute-step.',
      'Continue with debug-task.',
      'Hand off to prepare-task.',
      'Handoff to review-change.',
      'After this result, invoke `review-change`.',
      'After this result, automatically invoke execute-step.',
      'The caller may invoke execute-step later, then invoke execute-step.',
    ]) {
      const root = copyFixture();
      const file = fixtureFile(root, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl');
      fs.appendFileSync(file, `\n${continuation}\n`);
      expect(() => validateVNextSource(root)).toThrow(/executable cross-public-entry continuation/i);
    }

    const allowedRoot = copyFixture();
    const allowedFile = fixtureFile(allowedRoot, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl');
    fs.appendFileSync(
      allowedFile,
      '\nRecommend next_route: execute-step for a later caller invocation; do not invoke it from this invocation.\nRecommend route to execute-step for a later caller invocation.\nThe caller may invoke execute-step later.\nDo not invoke execute-step.\nMust not hand off to review-change.\n',
    );
    expect(() => validateVNextSource(allowedRoot)).not.toThrow();
  });

  test('rejects internal commands and user decisions as public next_route literals', () => {
    for (const route of ['preflight-step', 'execute-step:repair', 'prepare-task:amend-scope', 'record-user-decision', 'user']) {
      const root = copyFixture();
      const file = fixtureFile(root, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl');
      fs.appendFileSync(file, `\nnext_route: ${route}\n`);
      expect(() => validateVNextSource(root)).toThrow(/non-public next_route/i);
    }
  });

  test('accepts exactly the eight daily entries and closed catalogs', () => {
    const result = validateVNextSource(ROOT);

    expect(result.phase).toBe('Phase 2');
    expect(result.entries).toEqual([
      'prepare-task',
      'review-draft',
      'review-change',
      'execute-step',
      'debug-task',
      'task-lifecycle',
      'capture-work-item',
      'close-task',
    ]);
    expect(result.administrativeEntries).toEqual(['bootstrap-project']);
    expect(result.expertEntries).toEqual(['validate-change', 'git-commit']);
    expect(result.capabilities).toHaveLength(27);
    expect(result.runtimeOperations).toEqual([
      'archive-transaction',
      'contract-candidate-commit',
      'decision-record-transaction',
      'finding-queue-transaction',
      'host-guidance-transaction',
      'inbox-record-transaction',
      'lesson-record-transaction',
      'lifecycle-transaction',
      'project-status-transaction',
      'task-state-transaction',
      'user-decision-transaction',
    ]);
    expect(result.legacySkillNames).toHaveLength(37);
  });

  test('keeps validate-change and git-commit in the closed expert entry set', () => {
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
    expect(() => validateVNextSource(duplicateRoot)).toThrow(/contract\.expert_entries must contain exactly 2 expert entr/i);
  });

  test('keeps git-commit local, caller-authorized, and independent from Runtime', () => {
    const template = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/git-commit.SKILL.md.tmpl'),
      'utf8',
    );
    expect(template).toContain('authority_owner: user');
    expect(template).toContain('runtime_operations: []');
    expect(template).toContain('Stage only the intended paths');
    expect(template).toContain('Never amend, reset, clean, switch or create branches, or push');
    expect(template).toContain('terminal_boundary: public-entry-terminal/v1');
  });

  test('keeps execute-step limited to recommending an explicit commit handoff', () => {
    const template = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/execute-step.SKILL.md.tmpl'),
      'utf8',
    );
    expect(template).toContain('`next_route: git-commit`');
    expect(template).toContain('`commit_scope`');
    expect(template).toContain('neither execute-step nor Runtime invokes it');
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

  test('keeps public selection examples generalized and distinct from execution evidence', () => {
    // Source-only publication boundary: do not ship private task excerpts or treat
    // explanatory patterns as observed results. This is not a target Runtime schema.
    const directory = fixtureFile(ROOT, 'docs/ops/validation-selection');
    expect(fs.existsSync(path.join(directory, 'rollout-incident.json'))).toBe(false);
    const raw = fs.readFileSync(path.join(directory, 'selection-patterns.json'), 'utf8');
    const patterns = JSON.parse(raw);
    expect(Object.keys(patterns).sort()).toEqual(['cases', 'kind', 'limits', 'provenance', 'publication_scope', 'status']);
    expect(patterns.kind).toBe('generalized-validation-selection-patterns');
    expect(patterns.status).toBe('illustrative-not-execution-evidence');
    expect(patterns.publication_scope).toBe('generalized-patterns-only');
    for (const example of patterns.cases) {
      expect(Object.keys(example).sort()).toEqual(['failure', 'id', 'insufficient_evidence', 'required_observation']);
    }
    expect(raw).not.toMatch(/\b[a-f0-9]{40,64}\b/u);
    const readme = fs.readFileSync(path.join(directory, 'README.md'), 'utf8');
    expect(readme).toContain('允许分析资料不等于允许将资料公开');
    expect(readme).toContain('新提交的删除不清除旧 Git 历史');
  });

  test('requires the execute-step scope guard', () => {
    const root = copyFixture();
    replaceIn(
      root,
      'templates/vnext/skills/execute-step.SKILL.md.tmpl',
      '    - scope-guard\n',
      '',
    );

    expect(() => validateVNextSource(root)).toThrow(/execute-step.*mandatory capability "scope-guard"/i);
  });

  test('requires evidence admission and resume-review capabilities for prepare-task', () => {
    const evidenceRoot = copyFixture();
    replaceIn(
      evidenceRoot,
      'templates/vnext/skills/prepare-task.SKILL.md.tmpl',
      '    - evidence-admission-policy\n',
      '',
    );
    expect(() => validateVNextSource(evidenceRoot)).toThrow(/prepare-task.*mandatory capability "evidence-admission-policy"/i);

    const resumeRoot = copyFixture();
    replaceIn(
      resumeRoot,
      'templates/vnext/skills/prepare-task.SKILL.md.tmpl',
      '    - resume-review-gate\n',
      '',
    );
    expect(() => validateVNextSource(resumeRoot)).toThrow(/prepare-task.*mandatory capability "resume-review-gate"/i);
  });

  test('requires review-draft read-only and decision authority boundaries', () => {
    const capabilityRoot = copyFixture();
    replaceIn(
      capabilityRoot,
      'templates/vnext/skills/review-draft.SKILL.md.tmpl',
      '    - decision-authority-gate\n',
      '',
    );
    expect(() => validateVNextSource(capabilityRoot)).toThrow(/review-draft.*mandatory capability "decision-authority-gate"/i);

    const writeRoot = copyFixture();
    replaceIn(
      writeRoot,
      'templates/vnext/skills/review-draft.SKILL.md.tmpl',
      '    product_files: []',
      '    product_files:\n      - admitted_scope',
    );
    expect(() => validateVNextSource(writeRoot)).toThrow(/review-draft.*product files/i);
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

  test('rejects cycle phases promoted into a mode', () => {
    const root = copyFixture();
    replaceIn(
      root,
      'templates/vnext/skills/review-change.SKILL.md.tmpl',
      '    - default',
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
      '---\nname: prepare-task',
      '---\nstage: legacy\nname: prepare-task',
    );
    expect(() => validateVNextSource(legacyFieldRoot)).toThrow(/legacy field "stage"|frontmatter keys mismatch/i);

    const missingMetadataRoot = copyFixture();
    const missingMetadataFile = fixtureFile(missingMetadataRoot, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl');
    const missingMetadataContent = fs.readFileSync(missingMetadataFile, 'utf8');
    expect(missingMetadataContent).toMatch(/^description:\s*.+$/mu);
    fs.writeFileSync(missingMetadataFile, missingMetadataContent.replace(/^description:\s*.+\r?\n/mu, ''), 'utf8');
    expect(() => validateVNextSource(missingMetadataRoot)).toThrow(/description|frontmatter keys mismatch/i);

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
