import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';

/**
 * P-12 acceptance for the Mutation Authority v2 route on a fixed tgz install.
 *
 * The source-level matrix lives in test/vnext-runtime.test.ts. Component tests
 * cannot prove that the installed Node CLI, the rendered CURRENT_TASK, and the
 * committed task store agree about the authority envelope, so both scenarios
 * below run only the installed artifacts through `node`.
 *
 * Fixtures contain no real target-project data.
 */
const sourceRoot = path.resolve(import.meta.dir, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const roots: string[] = [];
let tgz = '';

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function installedCli(target: string): string {
  return path.join(target, '.workflow-system', 'runtime', 'dist', 'cli.js');
}

function invoke(target: string, args: string[], input?: unknown) {
  const result = spawnSync('node', [installedCli(target), ...args, '--root', target], {
    cwd: target,
    encoding: 'utf8',
    input: input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function rejected(target: string, command: string, input: unknown, code: string) {
  const before = fs.readFileSync(path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md'));
  const result = spawnSync('node', [installedCli(target), command, '--root', target], {
    cwd: target,
    encoding: 'utf8',
    input: JSON.stringify(input),
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain(code);
  expect(fs.readFileSync(path.join(target, 'docs', 'workflow', 'CURRENT_TASK.md'))).toEqual(before);
}

function assessment(target: string, overrides: Record<string, unknown> = {}) {
  return {
    path: target,
    symbol: null,
    reason: 'The reported failure requires this target.',
    locality: 'local',
    visibility: 'private',
    cross_component_consumers: 'none',
    contract_impact: 'none',
    evidence_refs: ['fixture:grep-callers'],
    disposition: 'self-admit',
    ...overrides,
  };
}

/** Bootstrap one isolated target with a declared authority domain map. */
function bootstrappedTarget(prefix: string): string {
  const workspace = tempRoot(prefix);
  const target = path.join(workspace, 'target');
  fs.mkdirSync(target, { recursive: true });
  const design = path.join(workspace, 'design.json');
  fs.writeFileSync(design, JSON.stringify({ architecture: 'Bounded Node fixture with two implementation steps' }));
  const consumer = path.join(workspace, 'consumer');
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"name":"mutation-authority-e2e","private":true}\n');
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tgz], { cwd: consumer, encoding: 'utf8' });
  const install = spawnSync('node', [path.join(consumer, 'node_modules', 'vibe-governance', 'dist', 'cli.js'), 'install', '--root', target, '--json'], { cwd: consumer, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (install.status !== 0) throw new Error(`install: ${install.stdout}\n${install.stderr}`);
  const bootstrap = ['bootstrap-support', 'prepare', '--mode', 'greenfield', '--design-baseline-file', design, '--confirm-design', '--project-name', 'Mutation Authority Fixture', '--project-slug', 'mutation-authority-fixture', '--json'];
  const preview = invoke(target, bootstrap);
  const pathsFile = path.join(workspace, 'bootstrap-paths.json');
  fs.writeFileSync(pathsFile, JSON.stringify(preview.planned_writes));
  expect(invoke(target, [...bootstrap, '--changed-paths-file', pathsFile, '--write']).status).toBe('installed');
  // Project owner confirms the mutation-ownership map; v2 drafts need it.
  // Bootstrap already writes a default `application` domain, so the fixture
  // only rewrites it when the project has not declared one yet.
  const profilePath = path.join(target, '.workflow-system', 'PROJECT_PROFILE.yaml');
  const profile = fs.readFileSync(profilePath, 'utf8');
  if (!/^mutation_authority:/mu.test(profile)) {
    fs.writeFileSync(profilePath, `${profile}\nmutation_authority:\n  domains:\n    - id: application\n      roots:\n        - src/**\n        - test/**\n`);
  }
  return target;
}

function confirmTwoStepDraft(target: string): void {
  const claim = (id: string, file: string) => ({
    claim_id: id,
    claim_kind: 'acceptance',
    requirement: `Verify ${file} through the installed Runtime`,
    source_ref: 'fixture:original-request',
    slots: [{
      slot_id: id.toLowerCase(),
      minimum_type: 'static-check',
      disposition: 'missing',
      evidence_refs: [],
      due_step_id: 'S1',
      applicability: 'current',
      report: null,
      check: {
        check_id: `K-${id}`,
        method: 'static',
        entry: `Read ${file}`,
        expected_observation: `${file} carries the requested behavior`,
        required_boundaries: ['complete file'],
        allowed_substitutes: [],
        subject_paths: [file],
        expected_result: 'accepted',
      },
    }],
  });
  const draft = invoke(target, ['prepare-draft'], {
    task_basis: { original_request: { source: 'fixture:original-request', verbatim: 'Implement two authorized Node targets.' }, user_decisions: [] },
    goal: 'Implement two authorized Node targets.',
    claim_evidence: [claim('A', 'src/a.ts'), claim('B', 'src/b.ts')],
    out_of_scope: ['No other component is touched'],
    design_decisions: { decided: ['Keep both steps inside the application authority domain'], unresolved: [] },
    mutation_scope: { allowed: ['src/a.ts', 'src/b.ts'], conditional: [], forbidden: ['.git/**'] },
    test_strategy: { mode: 'flexible', source: 'inferred-default', source_ref: 'prepare-task-default', task_classification: 'exploratory-or-infrastructure', rationale: 'The fixture exercises Runtime authority plumbing.' },
    implementation_steps: [
      { id: 'S1', description: 'Implement src/a.ts', mutation_scope: ['src/a.ts'], commands: [{ command: 'node --check src/a.ts', expected_repo_writes: 'none' }], validation: ['src/a.ts declares the behavior'], review_checkpoint: { policy: 'required', reason: 'Review src/a.ts against the confirmed task' } },
      { id: 'S2', description: 'Implement src/b.ts', mutation_scope: ['src/b.ts'], commands: [{ command: 'node --check src/b.ts', expected_repo_writes: 'none' }], validation: ['src/b.ts declares the behavior'], review_checkpoint: { policy: 'required', reason: 'Review src/b.ts against the confirmed task' } },
    ],
    validation_plan: ['node --check src/a.ts', 'node --check src/b.ts'],
    persistent_tests: 'none',
    mutation_authority: { domains: ['application'], exact_exceptions: [] },
  });
  invoke(target, ['confirm-draft'], { confirmation_receipt: draft.confirmation_receipt });
}

function preflightPlannedStep(target: string) {
  return invoke(target, ['preflight-step'], { candidate_paths: ['src/a.ts'] });
}

function recordBlockedStep(target: string) {
  // Re-preflight so the receipt binds the current task revision; the ledger
  // keeps the same attempt identity.
  const preflight = invoke(target, ['preflight-step'], { candidate_paths: ['src/a.ts'] });
  const step = preflight.current_step;
  const recorded = invoke(target, ['record-step-result'], {
    preflight_receipt: preflight.receipt,
    actual_changed_paths: [],
    command_results: step.commands.map((command: { command: string }) => ({ command: command.command, status: 'blocked', observed_repo_writes: [], evidence_refs: ['fixture:blocked.json'] })),
    validation_results: step.validation.map((validation: string) => ({ validation, status: 'not-run', evidence_refs: [] })),
    acceptance_evidence: [],
    outcome: 'blocked',
    blocker_kind: 'environment',
    note: 'Settle the first attempt so an authority change is allowed',
  });
  expect(recorded.status).toBe('success');
  return preflight;
}

beforeAll(() => {
  const packageRoot = tempRoot('vnext-mutation-authority-package-');
  const packDirectory = tempRoot('vnext-mutation-authority-tgz-');
  buildVibeGovernanceDistribution({ outputRoot: packageRoot });
  const packed = spawnSync(npm, ['pack', '--ignore-scripts', '--no-audit', '--no-fund', '--pack-destination', packDirectory], { cwd: packageRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
  const name = fs.readdirSync(packDirectory).find(item => item.endsWith('.tgz'));
  if (!name) throw new Error('npm pack produced no tarball');
  tgz = path.join(packDirectory, name);
}, 300000);

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe('Mutation Authority v2 on a fixed tgz install', () => {
  test('E2E A: same-envelope discovery self-admits without a user scope amendment, continuation, or retry reset', { timeout: 300000 }, () => {
    const target = bootstrappedTarget('vnext-mutation-authority-same-envelope-');
    confirmTwoStepDraft(target);
    const firstPreflight = preflightPlannedStep(target);
    const discovered = 'src/internal/state.ts';
    // The discovery sits inside the granted authority domain but was not planned.
    fs.mkdirSync(path.join(target, 'src', 'internal'), { recursive: true });
    fs.writeFileSync(path.join(target, discovered), 'export const normalizeState = (value) => value;\n');
    const extended = invoke(target, ['extend-preflight'], {
      preflight_receipt: firstPreflight.receipt,
      additional_targets: [{ path: discovered, assessment: assessment(discovered, { locality: 'elevated', evidence_refs: ['fixture:grep-callers', 'fixture:read-module'] }) }],
    });
    const before = invoke(target, ['validate']);
    const beforeAttempt = before.runtime_state.step_attempts.S1;

    expect(extended.status).toBe('pass');
    expect(extended.dynamic_review_required).toBe(true);
    expect(extended.extended_targets).toHaveLength(1);
    expect(extended.receipt.candidate_paths).toContain(discovered);
    expect(extended.receipt.plan_revision).toBe(firstPreflight.receipt.plan_revision);

    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'a.ts'), 'export const plannedStep = true;\n');
    fs.writeFileSync(path.join(target, discovered), 'export const normalizeState = (value) => value;\nexport const normalized = true;\n');
    const beforeRecord = invoke(target, ['validate']);
    expect(beforeRecord.source_tuple.revision).toBe(extended.receipt.source_revision);
    const recorded = invoke(target, ['record-step-result'], {
      preflight_receipt: extended.receipt,
      actual_changed_paths: ['src/a.ts', discovered],
      command_results: extended.current_step.commands.map((command: { command: string }) => ({ command: command.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['fixture:expanded.json'] })),
      validation_results: extended.current_step.validation.map((validation: string) => ({ validation, status: 'passed', evidence_refs: ['fixture:expanded.json'] })),
      acceptance_evidence: [],
      outcome: 'implemented',
      note: 'Record the self-admitted expansion',
    });
    expect(recorded.status).toBe('success');

    const after = invoke(target, ['validate']);
    // Same attempt, same plan, same step, and no user-facing amendment.
    expect(after.runtime_state.active_step_id).toBe('S1');
    expect(after.runtime_state.evidence_plan_revision).toBe(before.runtime_state.evidence_plan_revision);
    expect(after.runtime_state.step_attempts.S1.evidence_plan_revision).toBe(beforeAttempt.evidence_plan_revision);
    expect(after.runtime_state.step_attempts.S1.max_attempts).toBe(beforeAttempt.max_attempts);
    expect(after.runtime_state.step_attempts.S1.attempts).toHaveLength(beforeAttempt.attempts.length);
    expect(after.runtime_state.mutation_dynamic_review.required).toBe(true);
    expect(after.runtime_state.review_coverage.expanded_paths).toContain(discovered);
    expect(after.runtime_state.review_coverage.pending_paths).toContain(discovered);
    expect(after.runtime_state.mutation_authority).toEqual({ domains: ['application'], exact_exceptions: [] });
    // No amendment candidate and no continuation step were created.
    const candidates = path.join(target, 'docs', 'workflow', 'task-candidates', before.source_tuple.document_id);
    expect(fs.existsSync(candidates) ? fs.readdirSync(candidates).filter(name => name.endsWith('.scope.json')) : []).toEqual([]);
    expect(after.runtime_state.active_step_id).toBe('S1');
    expect(invoke(target, ['validate', '--summary']).summary.active_step_id).toBe('S1');
  });

  test('E2E B: cross-envelope authority change blocks, then amends with explicit user authorization and continues', { timeout: 300000 }, () => {
    const target = bootstrappedTarget('vnext-mutation-authority-cross-envelope-');
    confirmTwoStepDraft(target);
    const firstPreflight = preflightPlannedStep(target);
    const outside = 'native/collector/protocol.rs';
    fs.mkdirSync(path.join(target, 'native', 'collector'), { recursive: true });
    fs.writeFileSync(path.join(target, outside), 'fn protocol() {}\n');

    // The write is outside every granted domain, so Runtime reports the real
    // authority boundary instead of a generic scope failure.
    rejected(target, 'preflight-step', { candidate_paths: [outside] }, 'EXECUTE_SCOPE_BLOCKED');
    rejected(target, 'extend-preflight', {
      preflight_receipt: firstPreflight.receipt,
      additional_targets: [{ path: outside, assessment: assessment(outside, { locality: 'high' }) }],
    }, 'MUTATION_AUTHORITY_EXPANSION_REQUIRED');
    // The same attempt is still open, so a real authority change must settle it
    // before the amendment can be prepared.
    rejected(target, 'prepare-scope-amendment', {
      added_paths: [outside],
      authorization: { decision_source: 'user:mutation-authority-e2e', decision_text: `Authorize exactly ${outside}.`, authorized_paths: [outside] },
      amendment_step: { id: 'scope-native-1', description: 'Apply the authorized native exception', mutation_scope: [outside], required_evidence: ['fresh native review'], commands: [] },
    }, 'SCOPE_AMENDMENT_EXECUTION_UNSETTLED');
    recordBlockedStep(target);
    expect(invoke(target, ['validate']).runtime_state.active_step_status).toBe('blocked');

    // The user authorizes exactly one path.
    const amendment = invoke(target, ['prepare-scope-amendment'], {
      added_paths: [outside],
      authorization: {
        decision_source: 'user:mutation-authority-e2e',
        decision_text: `Authorize exactly ${outside} for this task.`,
        authorized_paths: [outside],
      },
      amendment_step: { id: 'scope-native-1', description: 'Apply the authorized native exception', mutation_scope: [outside], required_evidence: ['fresh native review'], commands: [] },
    });
    expect(amendment.committed).toBe(true);

    const amended = invoke(target, ['validate']);
    expect(amended.runtime_state.mutation_authority).toEqual({ domains: ['application'], exact_exceptions: [outside] });
    expect(amended.runtime_state.active_step_id).toBe('scope-native-1');
    // The continuation keeps the prior attempt and its inherited budget.
    expect(amended.runtime_state.step_attempts.S1.attempts).toHaveLength(1);
    // Only the exact exception is writable.
    rejected(target, 'preflight-step', { candidate_paths: ['native/collector/other.rs'] }, 'EXECUTE_SCOPE_BLOCKED');
    const continued = invoke(target, ['preflight-step'], { candidate_paths: [outside] });
    expect(continued.receipt.step_id).toBe('scope-native-1');
    expect(invoke(target, ['validate', '--summary']).summary.active_step_id).toBe('scope-native-1');
  });
});
