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
      'inbox-record-transaction',
      'lesson-record-transaction',
      'lifecycle-transaction',
      'paired-host-guidance-transaction',
      'project-status-transaction',
      'task-state-transaction',
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

  test('keeps execute-step focused on one Runtime-admitted step', () => {
    const execute = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/execute-step.SKILL.md.tmpl'),
      'utf8',
    );
    expect(execute).toContain('Runtime `preflight-step`');
    expect(execute).toContain('Runtime `record-step-result`');
    expect(execute).toContain('Runtime `complete-reviewed-step`');
    expect(execute).toContain('Do not redesign the task');
    expect(execute).toContain("confirmed task's `Persistent Tests`");
    expect(execute).toContain('frozen test-strategy mode, execution phase, required outcome');
    expect(execute).toContain('`outcome: test-red`');
    expect(execute).toContain('`status: expected-failure`');
    expect(execute).toContain('Expected failure cannot satisfy positive acceptance');

    const root = copyFixture();
    const executeFixture = fixtureFile(root, 'templates/vnext/skills/execute-step.SKILL.md.tmpl');
    fs.writeFileSync(
      executeFixture,
      fs.readFileSync(executeFixture, 'utf8').replaceAll('Runtime `preflight-step`', 'unbound preflight'),
      'utf8',
    );
    expect(() => validateVNextSource(root)).toThrow(/semantic boundary term "Runtime `preflight-step`"/i);
  });

  test('keeps review-change focused on clear findings or an explicit blocker', () => {
    const file = fixtureFile(ROOT, 'templates/vnext/skills/review-change.SKILL.md.tmpl');
    const content = fs.readFileSync(file, 'utf8');

    expect(content).toContain('report all clear repairable findings together');
    expect(content).toContain('`blocked`: include the blocker and recommended route');
    expect(content).toContain('record-evidence-challenge');
    expect(content).toContain('This records `contested`, not an automatic invalidation');
    expect(content).toContain('For historical `test-red`, verify that only frozen test assets were admitted');
  });

  test('preserves P-12 evidence-first and persistent-test admission boundaries', () => {
    const sourceContract = fs.readFileSync(
      fixtureFile(ROOT, '.workflow-system/vnext/SOURCE_CONTRACT.yaml'),
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
    expect(sourceContract).toContain('invariant-admission/v1');
    expect(sourceContract).toContain('implementation convenience alone is not authority');
    expect(sourceContract).toContain('confirmed current acceptance may control bounded task behavior but does not rewrite future design/baseline semantics');
    expect(sourceContract).toContain('global/domain/permanent/schema invariants require confirmed owner_source contract or user authority');
    expect(sourceContract).toContain('default non-admission or user no-test deny');
    expect(sourceContract).toContain('acceptance, regression, critical-invariant, or critical-risk');
    expect(sourceContract).toContain('existing-evidence insufficiency');
    expect(sourceContract).toContain('static proof, existing regression, focused test, integration smoke');
    expect(sourceContract).toContain('assertion boundary, and failure disposition');
    expect(sourceContract).toContain('risk-analysis admission is anchored to an identified changed behavior, known failure model, and admitted task scope');
    expect(sourceContract).toContain('provisional or exploratory certainty is used to silently admit a persistent test');
    expect(sourceContract).toContain('exploratory probe budget');
    expect(sourceContract).toContain('typed proposal to an existing canonical task record');
    expect(execute).toContain("A persistent test may be created or changed only when it is already frozen in the confirmed task's `Persistent Tests`");
    expect(execute).toContain('do not admit another test during execution');
    expect(review).toContain('unauthorized persistent-test changes');
    expect(review).toContain('Persistent Tests');
    expect(debug).toContain('A validation obligation or temporary probe does not automatically justify a persistent automated test');
    expect(debug).toContain('Persistent-test disposition defaults to `persistent_test: false`');
    expect(debug).toContain('permitted temporary artifact locations, and cleanup/audit rule');
    expect(close).toContain('persistent-test disposition defaults to `persistent_test: false`');
    expect(lifecycle).toContain('preserve each claim\'s identity, owner, certainty, admitted evidence types, and completion state');
    expect(close).toContain('closure does not infer a new test from missing evidence');
    // Guidance distribution guard only: these assertions do not evaluate an Agent.
    const prepare = fs.readFileSync(fixtureFile(ROOT, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl'), 'utf8');
    const draftReview = fs.readFileSync(fixtureFile(ROOT, 'templates/vnext/skills/review-draft.SKILL.md.tmpl'), 'utf8');
    const support = fs.readFileSync(fixtureFile(ROOT, 'runtime/vnext/support/CONTEXT_API.md'), 'utf8');
    for (const template of [prepare, draftReview, review]) expect(template).toContain('Failure-oriented validation selection');
    expect(prepare.indexOf('Identify the business failure')).toBeLessThan(prepare.indexOf('use Runtime `file-context` to find/read'));
    expect(prepare).toContain('would this check fail for that wrong behavior, for the right reason?');
    expect(draftReview).toContain('would the wrong behavior still PASS?');
    expect(draftReview).toContain('absent code or execution reports alone is not a draft finding');
    expect(execute).toContain('not permission to copy actual output into the oracle');
    expect(review).toContain('cancellation before entry does not');
    expect(support).toContain('## Failure-oriented validation selection');
    expect(support).toContain('not mandatory Red/TDD');
    expect(support).toContain('not a fresh Agent');
    // Whole-set guidance is a source contract, not proof of Agent selection quality.
    expect(prepare).toContain('Optimize the whole validation set, not minimum granularity per check');
    expect(prepare).toContain('preserve all\nobligations at no greater total cost');
    expect(draftReview).toContain('Treat unjustified validation breadth');
    expect(draftReview).toContain('Do not narrow away an explicit obligation');
    expect(draftReview).toContain('including\nbatched selectors when supported');
    expect(draftReview).toContain('convenience or one startup alone is not a');
    expect(draftReview).toContain('not a new cost-advantage authority');
    expect(draftReview).not.toContain('Treat validation wider than the claim');
    expect(draftReview).not.toContain('Require narrowing before clean confirmation when an equally effective smaller');
    expect(draftReview).not.toContain('reject a whole target or suite when an equally effective focused check is');
    expect(support).toContain('A focused check does not cancel a separately required package regression');
    expect(support).toContain('cost advantage is not a new authority enum');
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

  test('keeps E convergence aligned with implemented A-D boundaries', () => {
    const target = fs.readFileSync(
      fixtureFile(ROOT, 'docs/designs/workflow-vnext-target-architecture.md'),
      'utf8',
    );
    const convergence = fs.readFileSync(
      fixtureFile(ROOT, 'docs/designs/vnext-design-convergence.md'),
      'utf8',
    );
    const protocol = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/bootstrap/WORKFLOW_PROTOCOL.md'),
      'utf8',
    );
    const schemas = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/bootstrap/FILE_SCHEMAS.md'),
      'utf8',
    );
    const support = fs.readFileSync(
      fixtureFile(ROOT, 'runtime/vnext/support/CONTEXT_API.md'),
      'utf8',
    );
    const debug = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/debug-task.SKILL.md.tmpl'),
      'utf8',
    );
    const runtimeContract = fs.readFileSync(
      fixtureFile(ROOT, '.workflow-system/vnext/RUNTIME_CONTRACT.yaml'),
      'utf8',
    );
    const sourceContract = fs.readFileSync(
      fixtureFile(ROOT, '.workflow-system/vnext/SOURCE_CONTRACT.yaml'),
      'utf8',
    );

    expect(target).toContain('### 3.1 A–D implementation convergence status');
    expect(target).toContain('minimum-sufficient **whole evidence set**');
    expect(target).toContain('explicit `prepare-successor`');
    expect(target).toContain('local/private/no-consumer/no-contract-impact self-admission adds no checkpoint');
    expect(target).toContain('`implemented-dogfood-pending`');
    expect(target).not.toContain('Every unplanned self-admission sets `dynamic_review_required`');
    expect(target).not.toContain('its only normal exit is a successful same-task `prepare-task:replan`');
    expect(target).not.toContain('`review-change:report-only` changes terminal semantics');

    expect(protocol).toContain('`dynamic_review_required` is selected from the assessment');
    expect(schemas).toContain('local/private/no-consumer/no-contract-impact discovery');
    expect(support).toContain('An explicit later replacement request uses');
    expect(debug).toContain('may recommend a fresh successor only when the caller has an explicit replacement request');
    expect(debug).not.toContain('A task already `superseded` may recommend `prepare-task:replan`');
    expect(runtimeContract).toContain('changed_goal_scope_acceptance: bounded-correction-amendment-or-supersede-successor');
    expect(runtimeContract).toContain('source_of_truth: CURRENT_TASK-head-plus-selected-immutable-roots-one-canonical-aggregate');
    expect(runtimeContract).not.toContain('source_of_truth: same-canonical-CURRENT_TASK-document');
    expect(sourceContract).toContain('minimum-sufficient whole evidence set by detection, real boundary, and total cost');

    expect(target).toContain('- Date: `2026-09-19`');
    expect(target).toContain('Concrete command/API syntax is implemented by the current Runtime/Distribution contracts but is intentionally non-normative');
    expect(target).toContain('Implementation details intentionally non-normative at this architecture layer');
    expect(target).toContain('including `runtime_state.review_cycle`');
    expect(target).not.toContain('The exact `CURRENT_TASK` schema extension is deferred to a later protocol task');
    expect(target).not.toContain('exact CLI/API syntax remains deferred');
    expect(target).not.toContain('### 16.3 Deferred implementation details');

    expect(convergence).toContain('P-01 — public entry represents intent');
    expect(convergence).toContain('P-12 — minimum-sufficient evidence');
    expect(convergence).toContain('Fresh-Agent minimum-sufficient selection');
    expect(convergence).toContain('Longitudinal task storage growth');
    expect(fs.existsSync(fixtureFile(ROOT, 'docs/ops/validation-selection/rollout-incident.json'))).toBe(false);
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

  test('requires prepare-task to map material draft gaps and preserve cross-step repairability', () => {
    const prepare = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/prepare-task.SKILL.md.tmpl'),
      'utf8',
    );
    expect(prepare).toContain('revision-bound **Task Basis**');
    expect(prepare).toContain('record the original request verbatim');
    expect(prepare).toContain('same atomic draft transaction');
    expect(prepare).toContain('semantic delta map');
    expect(prepare).toContain('path-by-step interaction map');
    expect(prepare).toContain('Step scopes are permissions');
    expect(prepare).toContain('author self-check');
    expect(prepare).toContain('Classify `test_strategy.mode`');
    expect(prepare).toContain('`explicit-user`, `project-policy`, or `inferred-default`');
    expect(prepare).toContain('Set `source_ref` to the exact');
    expect(prepare).toContain('`contract-clear-behavior`, `exploratory-or-infrastructure`, or');
    expect(prepare).toContain('user-owned open question and resolve it before submitting `prepare-draft`');
    expect(prepare).toContain('Do not infer Red from step order');
    expect(prepare).toContain('TEST_STRATEGY_PREREQUISITE_UNSUPPORTED');
    expect(prepare).toContain('Persistent Tests may remain `none`');
    expect(prepare).toContain('PROJECT_PROFILE.yaml#boundaries.non_executable_change_paths');
    expect(prepare).toContain('Each policy entry must itself be an exact path or a literal directory prefix');
    expect(prepare).toContain('reject wildcard-bearing prefixes such as `*/**`');
    expect(prepare).toContain('Every Allowed, Conditional, and implementation-step mutation pattern');
    expect(prepare).toContain('documentation inventory as proof');
    expect(prepare).toContain('does not block `flexible`');
    expect(prepare).toContain('Explicit confirmation freezes the strategy');
    expect(prepare).toContain('`next_route: review-draft`');

    const capabilityRoot = copyFixture();
    replaceIn(
      capabilityRoot,
      'templates/vnext/skills/prepare-task.SKILL.md.tmpl',
      '    - adaptive-depth-policy\n',
      '',
    );
    expect(() => validateVNextSource(capabilityRoot)).toThrow(/prepare-task.*mandatory capability "adaptive-depth-policy"/i);

    const boundaryRoot = copyFixture();
    replaceIn(
      boundaryRoot,
      'templates/vnext/skills/prepare-task.SKILL.md.tmpl',
      'path-by-step interaction map',
      'step list',
    );
    expect(() => validateVNextSource(boundaryRoot)).toThrow(/draft-consistency boundary term "path-by-step interaction map"/i);
  });

  test('keeps review-draft independent, read-only, and portable across agent contexts', () => {
    const reviewDraft = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/review-draft.SKILL.md.tmpl'),
      'utf8',
    );
    expect(reviewDraft).toContain('Task Basis path and revision linked by `CURRENT_TASK`');
    expect(reviewDraft).toContain('valid without hidden history');
    expect(reviewDraft).toContain('or a previous review');
    expect(reviewDraft).toContain('not request authority');
    expect(reviewDraft).toContain('Never reconstruct the request');
    expect(reviewDraft).toContain('from the candidate draft');
    expect(reviewDraft).toContain('self-contained `draft_review_result`');
    expect(reviewDraft).toContain('governed_mutation_count: 0');
    expect(reviewDraft).toContain('verdict: clean | findings | needs-user');

    const capabilityRoot = copyFixture();
    replaceIn(
      capabilityRoot,
      'templates/vnext/skills/review-draft.SKILL.md.tmpl',
      '    - decision-authority-gate\n',
      '',
    );
    expect(() => validateVNextSource(capabilityRoot)).toThrow(/review-draft.*mandatory capability "decision-authority-gate"/i);

    const boundaryRoot = copyFixture();
    replaceIn(
      boundaryRoot,
      'templates/vnext/skills/review-draft.SKILL.md.tmpl',
      'Never reconstruct the request',
      'Infer the request from acceptance criteria',
    );
    expect(() => validateVNextSource(boundaryRoot)).toThrow(/review-draft.*boundary term "Never reconstruct the request"/i);
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

  test('keeps execute-step behind the resume-review gate', () => {
    const execute = fs.readFileSync(
      fixtureFile(ROOT, 'templates/vnext/skills/execute-step.SKILL.md.tmpl'),
      'utf8',
    );
    expect(execute).toContain('resume-review-gate');
    expect(execute).toContain('a resume gate is active');
    expect(execute).toContain('report that result and stop');
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
