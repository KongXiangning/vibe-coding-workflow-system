import { expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { buildVibeGovernanceDistribution } from '../scripts/build-vibe-governance-distribution';

// P-12: user implementation plan G03/G08/G10/G13/G15/D01/D03. Component tests
// cannot prove that a fixed tgz and the installed Node CLI preserve real history.
// Failure blocks release. Fixtures contain no real target-project data.
const sourceRoot = path.resolve(import.meta.dir, '..');
const sha = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

for (const scenario of ['full-chain', 'first-restore', 'same-report', 'failure-budget']) test(`fixed tgz recovery: ${scenario}`, { timeout: 180000 }, () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-recovery-distribution-'));
  const target = path.join(workspace, 'target');
  const npmHome = path.join(workspace, 'package-user');
  fs.mkdirSync(target); fs.mkdirSync(npmHome);
  const packageRoot = path.join(sourceRoot, 'packages/vibe-governance');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let tgz = process.env.VNEXT_RECOVERY_TGZ;
  if (!tgz) {
    buildVibeGovernanceDistribution({ outputRoot: packageRoot });
    const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', workspace], { cwd: packageRoot, encoding: 'utf8' }));
    tgz = path.join(workspace, packed[0].filename);
  }
  expect(path.basename(tgz)).toBe('vibe-governance-0.19.1.tgz');
  fs.writeFileSync(path.join(npmHome, 'package.json'), '{"name":"isolated-recovery-installer","private":true}\n');
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tgz], { cwd: npmHome, encoding: 'utf8' });
  const bin = path.join(npmHome, 'node_modules/.bin', process.platform === 'win32' ? 'vibe-governance.cmd' : 'vibe-governance');
  const install = spawnSync(bin, ['install', '--root', target, '--json'], { cwd: npmHome, encoding: 'utf8', shell: process.platform === 'win32' });
  if (install.status !== 0) throw new Error(`install: ${install.stdout}\n${install.stderr}`);
  const cli = path.join(target, '.workflow-system/runtime/dist/cli.js');
  function invoke(args: string[], input?: unknown) {
    const result = spawnSync('node', [cli, ...args, '--root', target], { cwd: target, encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout);
  }
  function rejected(command: string, input: unknown, code: string) {
    const before = fs.readFileSync(path.join(target, 'docs/workflow/CURRENT_TASK.md'));
    const result = spawnSync('node', [cli, command, '--root', target], { cwd: target, encoding: 'utf8', input: JSON.stringify(input), maxBuffer: 8 * 1024 * 1024 });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(code);
    expect(fs.readFileSync(path.join(target, 'docs/workflow/CURRENT_TASK.md'))).toEqual(before);
  }
  const design = path.join(workspace, 'design.json');
  fs.writeFileSync(design, JSON.stringify({ architecture: 'Bounded document observations in an isolated fixture' }));
  const bootstrap = ['bootstrap-support', 'prepare', '--mode', 'greenfield', '--design-baseline-file', design, '--confirm-design', '--project-name', 'Recovery Fixture', '--project-slug', 'recovery-fixture', '--json'];
  const preview = invoke(bootstrap);
  const pathsFile = path.join(workspace, 'bootstrap-paths.json');
  fs.writeFileSync(pathsFile, JSON.stringify(preview.planned_writes));
  expect(invoke([...bootstrap, '--changed-paths-file', pathsFile, '--write']).status).toBe('installed');
  const profilePath = path.join(target, '.workflow-system/PROJECT_PROFILE.yaml');
  const profile = parse(fs.readFileSync(profilePath, 'utf8'));
  profile.boundaries = { ...profile.boundaries, non_executable_change_paths: ['notes/**'] };
  fs.writeFileSync(profilePath, stringify(profile));
  fs.mkdirSync(path.join(target, 'notes'));
  fs.writeFileSync(path.join(target, 'notes/a.md'), 'initial A\n');
  fs.writeFileSync(path.join(target, 'notes/b.md'), 'initial B\n');
  const allPaths = ['notes/a.md', 'notes/b.md'];
  const claim = (id: string, p: string) => ({ claim_id: id, claim_kind: 'acceptance', requirement: `Retain and verify observation ${id}`, source_ref: 'fixture:original-request',
    slots: [{ slot_id: id.toLowerCase(), minimum_type: 'static-check', disposition: 'missing', evidence_refs: [], due_step_id: 'S1', applicability: 'current', report: null,
      check: { check_id: `K-${id}`, method: 'static', entry: `Read ${p}`, expected_observation: `Observation ${id} exists`, required_boundaries: ['complete document'], allowed_substitutes: [], subject_paths: [p], expected_result: 'accepted' } }] });
  const step = (id: string) => ({ id, description: `Verify ${id}`, mutation_scope: allPaths, commands: [], validation: [`Validate ${id}`], review_checkpoint: { policy: 'required', reason: 'Review complete observations' } });
  const draft = invoke(['prepare-draft'], { task_basis: { original_request: { source: 'fixture:original-request', verbatim: 'Maintain two verified document observations and preserve their history.' }, user_decisions: [] },
    goal: 'Maintain two verified document observations and preserve their history.', claim_evidence: [claim('A', allPaths[0]), claim('B', allPaths[1])], out_of_scope: ['No external systems'],
    design_decisions: { decided: ['Use local documents'], unresolved: [] }, mutation_scope: { allowed: allPaths, conditional: [], forbidden: ['.git/**'] },
    test_strategy: { mode: 'not-applicable', source: 'inferred-default', source_ref: 'prepare-task-default', task_classification: 'non-executable-change', rationale: 'Only explicitly classified document files are written.' },
    implementation_steps: [step('S1'), step('S2')], validation_plan: ['Read and compare both document observations'], persistent_tests: 'none' });
  invoke(['confirm-draft'], { confirmation_receipt: draft.confirmation_receipt });
  const state = () => invoke(['validate']);
  const initial = state();
  const unrelated = invoke(['ingest-evidence'], { source_revision: initial.source_tuple.revision, source_locator: 'fixture:unrelated', body: 'A separate feature request' });
  const routed = invoke(['route-input'], { source_revision: initial.source_tuple.revision, input_ref: unrelated.evidence_ref, input_sha256: unrelated.evidence_sha256, relation: 'unrelated', operation: 'other', reason: 'Separate goal' });
  expect(routed.next_route).toBe('capture-work-item');
  expect(state().source_tuple.revision).toBe(initial.source_tuple.revision);
  expect(invoke(['route-input'], { source_revision: initial.source_tuple.revision, input_ref: unrelated.evidence_ref, input_sha256: unrelated.evidence_sha256, relation: 'current-task', operation: 'expand-authority', reason: 'New write authority requested' }).status).toBe('user-decision-required');
  let serial = 0;
  function complete(id: string, reports: string[], changes: Record<string, string> = {}, restore = false) {
    const preflight = invoke(['preflight-step'], { candidate_paths: allPaths });
    const before = Object.fromEntries(allPaths.map(p => [p, fs.readFileSync(path.join(target, p), 'utf8')]));
    let completionFile: string | undefined;
    if (restore) {
      const claimedSuccess = { preflight_receipt: preflight.receipt, actual_changed_paths: [],
        command_results: preflight.current_step.commands.map((command: any) => ({ command: command.command, status: 'passed', observed_repo_writes: [], evidence_refs: ['fixture:claimed'] })),
        validation_results: preflight.current_step.validation.map((validation: string) => ({ validation, status: 'passed', evidence_refs: ['fixture:claimed'] })),
        acceptance_evidence: [], outcome: 'implemented', note: 'Caller-reported success without Runtime restoration' };
      rejected('record-step-result', claimedSuccess, 'ARTIFACT_RESTORE_COMPLETION_REQUIRED');
      invoke(['apply-artifact-restore'], { preflight_receipt: preflight.receipt });
      const restored = fs.readFileSync(path.join(target, 'notes/a.md'), 'utf8');
      fs.writeFileSync(path.join(target, 'notes/a.md'), before['notes/a.md']);
      rejected('record-step-result', claimedSuccess, 'ARTIFACT_RESTORE_TARGET_STALE');
      fs.writeFileSync(path.join(target, 'notes/a.md'), restored);
      const directory = path.join(target, 'docs/workflow/task-history', state().source_tuple.document_id, 'artifact-restores');
      completionFile = path.join(directory, fs.readdirSync(directory)[0]);
    }
    for (const [p, value] of Object.entries(changes)) fs.writeFileSync(path.join(target, p), value);
    const context = invoke(['evidence-context'], {});
    const refs = reports.map(id => {
      const p = `notes/${id === 'A' ? 'a' : 'b'}.md`;
      expect(fs.readFileSync(path.join(target, p), 'utf8').trim().length).toBeGreaterThan(0);
      const evidence = invoke(['ingest-evidence'], { source_revision: state().source_tuple.revision, source_locator: `fixture:observation-${++serial}`, body: fs.readFileSync(path.join(target, p), 'utf8') });
      const check = context.checks.find((item: any) => item.claim_id === id);
      return { claim_id: id, slot_id: id.toLowerCase(), check_id: check.check_id, minimum_type: 'static-check', disposition: 'newly-executed', evidence_refs: [evidence.evidence_ref],
        report: { result_id: `result-${id}-${serial}`, status: 'accepted', evidence_plan_revision: context.evidence_plan_revision, subject_revision: check.subject_revision, actual_method: 'static', environment: 'isolated local UTF-8 documents', assurance: 'caller-reported' } };
    });
    const evidenceRefs = refs.map(item => item.evidence_refs[0]);
    const recorded = invoke(['record-step-result'], { preflight_receipt: preflight.receipt,
      actual_changed_paths: allPaths.filter(p => before[p] !== fs.readFileSync(path.join(target, p), 'utf8')),
      command_results: preflight.current_step.commands.map((command: any) => ({ command: command.command, status: 'passed', observed_repo_writes: allPaths.filter(p => before[p] !== fs.readFileSync(path.join(target, p), 'utf8')), evidence_refs: evidenceRefs.length ? evidenceRefs : ['fixture:restored'] })),
      validation_results: preflight.current_step.validation.map((validation: string) => ({ validation, status: 'passed', evidence_refs: evidenceRefs.length ? evidenceRefs : ['fixture:observed'] })),
      acceptance_evidence: refs, outcome: 'implemented', note: `Observed ${id} through installed Runtime` });
    expect(recorded.status).toBe('success');
    const review = invoke(['review-context'], {});
    invoke(['record-review-result'], { context_receipt: review.receipt, verdict: 'clean', findings: [], unresolved_fingerprints: [], evidence_refs: evidenceRefs.length ? evidenceRefs : ['fixture:reviewed'], blocker: null,
      test_assessment: { applicable: false, reason: 'Only declared non-executable documents changed', evidence_refs: evidenceRefs.length ? evidenceRefs : ['fixture:reviewed'], necessity: 'Bounded document read is sufficient', oracle: 'Observed complete UTF-8 document bodies', boundary: 'Local fixture only', reuse: 'Retain unaffected document observations', applicability: 'Current review manifest and reports inspected' } });
    if (completionFile) {
      const bytes = fs.readFileSync(completionFile);
      fs.writeFileSync(completionFile, '{}\n');
      rejected('complete-reviewed-step', { step_id: id, note: `Reviewed ${id}` }, 'ARTIFACT_RESTORE_COMPLETION_REQUIRED');
      fs.writeFileSync(completionFile, bytes);
    }
    invoke(['complete-reviewed-step'], { step_id: id, note: `Reviewed ${id}` });
  }
  function challenge(ids: string[]) {
    for (const id of ids) {
      const current = state();
      const evidence = invoke(['ingest-evidence'], { source_revision: current.source_tuple.revision, source_locator: `fixture:counterexample-${++serial}`, body: `New bounded counterexample for ${id}, assessment ${serial}` });
      const slot = current.runtime_state.claim_evidence.find((item: any) => item.claim_id === id).slots[0];
      invoke(['record-evidence-challenge'], { claim_id: id, slot_id: slot.slot_id, result_id: slot.report.result_id, evidence_ref: evidence.evidence_ref, evidence_sha256: evidence.evidence_sha256, reason: 'Reassess the bounded observation' });
    }
    return state().runtime_state.evidence_challenges.filter((item: any) => item.status !== 'resolved').map((item: any) => item.challenge_id);
  }
  const recovery = (id: string) => ({ id, description: `Recover ${id}`, mutation_scope: allPaths, commands: [], required_evidence: [`Validate ${id}`] });
  function confirm(input: unknown) {
    const before = state();
    const candidate = invoke(['prepare-replan'], input);
    expect(state().source_tuple.revision).toBe(before.source_tuple.revision);
    const receipt = candidate.candidate_receipt;
    const authorization = { approved_candidate_digest: receipt.candidate_digest, decision_source: `fixture:decision-${++serial}`, decision_text: `Approve the exact bounded recovery ${serial}; retain every old obligation.`, invalidation_reason: 'Bounded evidence requires a recovery' };
    rejected('confirm-replan', { candidate_receipt: { ...receipt, kind: 'correction-replan-candidate-receipt/v1' }, authorization }, 'REPLAN_CONFIRMATION_INVALID');
    expect(invoke(['confirm-replan'], { candidate_receipt: receipt, authorization }).status).toBe('success');
    return JSON.parse(fs.readFileSync(path.join(target, candidate.candidate_path), 'utf8'));
  }
  complete('S1', ['A', 'B'], { 'notes/a.md': 'analysis A\n', 'notes/b.md': 'analysis B\n' });
  if (scenario === 'same-report') {
    const ids = challenge(['A', 'A', 'A']);
    const original = state().runtime_state.evidence_challenges.map((item: any) => item.result_id);
    for (let index = 0; index < ids.length; index++) {
      const id = `PARTIAL${index}`;
      confirm({ challenge_ids: [ids[index]], correction_step: recovery(id) });
      complete(id, ['A'], { 'notes/a.md': `bounded correction ${index}\n` });
      const challenges = state().runtime_state.evidence_challenges;
      expect(challenges.map((item: any) => item.result_id)).toEqual(original);
      expect(challenges.filter((item: any) => item.status !== 'resolved')).toHaveLength(ids.length - index - 1);
      if (index < ids.length - 1) rejected('preflight-step', { candidate_paths: allPaths }, 'EVIDENCE_CHALLENGE_UNRESOLVED');
    }
    complete('S2', []);
    fs.rmSync(workspace, { recursive: true, force: true });
    return;
  }
  if (scenario === 'first-restore' || scenario === 'failure-budget') {
    if (scenario === 'failure-budget') {
      // Isolate budget inheritance from the independent optional-challenge fix.
      confirm({ challenge_ids: challenge(['A']), correction_step: recovery('BOOT') });
      complete('BOOT', ['A']);
    }
    const prior = state();
    if (scenario === 'first-restore') expect(prior.runtime_state.evidence_challenges).toBeUndefined();
    const result = prior.runtime_state.execution_log.find((item: any) => item.step_id === 'S1' && item.execution_result);
    const diagnosis = invoke(['ingest-evidence'], { source_revision: prior.source_tuple.revision, source_locator: 'fixture:execution-diagnosis', body: 'Recover the real completed S1 observation.' });
    let targets = [{ execution_id: result.idempotency_key, reason: 'Recover S1', evidence_ref: diagnosis.evidence_ref, evidence_sha256: diagnosis.evidence_sha256 }];
    const obligations = (id: string) => [{ claim_id: 'A', slot_id: 'a', due_step_id: id }, { claim_id: 'B', slot_id: 'b', due_step_id: id }];
    if (scenario === 'first-restore') {
      const checkpoint = invoke(['artifact-checkpoints'], {}).checkpoints.find((item: any) => item.step_id === 'S1' && item.phase === 'before' && item.committed);
      confirm({ mode: 'execution-recovery', strategy: 'mixed', challenge_ids: [], execution_targets: targets,
        correction_step: { ...recovery('RESTORE'), commands: [{ command: 'runtime:artifact-restore', expected_repo_writes: ['notes/a.md'] }] },
        recovery_steps: [recovery('VERIFY')], restore_plan: { checkpoint_id: checkpoint.checkpoint_id, paths: ['notes/a.md'] }, obligation_map: obligations('VERIFY') });
      complete('RESTORE', [], {}, true);
      expect(fs.readFileSync(path.join(target, 'notes/a.md'), 'utf8')).toBe('initial A\n');
      complete('VERIFY', ['A', 'B']);
      complete('S2', []);
    } else {
      let pendingId = 'S2';
      let failedStep: string | null = null;
      for (let i = 1; i <= 4; i++) {
        const id = `FAILURE${i}`, follow = `FOLLOW${i}`;
        const pending_step_changes = failedStep ? { steps: [recovery(follow)], step_map: [{ old_step_id: pendingId, new_step_ids: [follow] }, { old_step_id: failedStep, new_step_ids: [id] }] } : undefined;
        const candidate = confirm({ mode: 'execution-recovery', challenge_ids: [], execution_targets: targets, correction_step: recovery(id), obligation_map: obligations(id), ...(pending_step_changes ? { pending_step_changes } : {}) });
        expect(candidate.problem_keys).toContain('claim:A/a');
        if (i === 4) {
          rejected('preflight-step', { candidate_paths: allPaths }, 'RETRY_BUDGET_EXHAUSTED');
          break;
        }
        const preflight = invoke(['preflight-step'], { candidate_paths: allPaths });
        const failure = invoke(['ingest-evidence'], { source_revision: state().source_tuple.revision, source_locator: `fixture:failure-${i}`, body: 'Same mismatch: expected initial A, observed analysis A.' });
        invoke(['record-step-result'], { preflight_receipt: preflight.receipt, actual_changed_paths: [], command_results: [],
          validation_results: preflight.current_step.validation.map((validation: string) => ({ validation, status: 'failed', evidence_refs: [failure.evidence_ref] })),
          acceptance_evidence: [], outcome: 'blocked', blocker_kind: 'unknown', note: 'Same unchanged document mismatch' });
        const failed = state();
        const observed = failed.runtime_state.execution_log.findLast((item: any) => item.step_id === id && item.execution_result);
        invoke(['suspend-recovery'], { source_revision: failed.source_tuple.revision, reason: 'Diagnose the same failed recovery', evidence_refs: [failure.evidence_ref] });
        targets = [{ execution_id: observed.idempotency_key, reason: 'Same original failure', evidence_ref: failure.evidence_ref, evidence_sha256: failure.evidence_sha256 }];
        if (failedStep) pendingId = follow;
        failedStep = id;
      }
      expect(Object.values(state().runtime_state.step_attempts).flatMap((ledger: any) => ledger.attempts).filter((attempt: any) => attempt.blocker)).toHaveLength(3);
    }
    fs.rmSync(workspace, { recursive: true, force: true });
    return;
  }
  const history = state().runtime_state.execution_log;
  const batch = challenge(['A', 'B']);
  const subset = invoke(['prepare-replan'], { challenge_ids: [batch[0]], correction_step: recovery('SUBSET') });
  expect(state().runtime_state.evidence_challenges.filter((item: any) => item.status === 'contested')).toHaveLength(2);
  rejected('preflight-step', { candidate_paths: allPaths }, 'EVIDENCE_CHALLENGE_UNRESOLVED');
  invoke(['discard-replan'], { candidate_digest: subset.candidate_receipt.candidate_digest });
  confirm({ challenge_ids: batch, correction_step: recovery('R1') });
  complete('R1', ['A', 'B'], { 'notes/a.md': 'corrected A\n', 'notes/b.md': 'corrected B\n' });
  let originalB = state().runtime_state.claim_evidence[1].slots[0].report;
  const partialBatch = challenge(['A', 'B']);
  confirm({ challenge_ids: [partialBatch[0]], correction_step: recovery('R2') });
  complete('R2', ['A'], { 'notes/a.md': 'second A\n' });
  expect(state().runtime_state.claim_evidence[1].slots[0].report).toEqual(originalB);
  expect(state().runtime_state.evidence_challenges.find((item: any) => item.challenge_id === partialBatch[1]).status).toBe('contested');
  rejected('preflight-step', { candidate_paths: allPaths }, 'EVIDENCE_CHALLENGE_UNRESOLVED');
  confirm({ challenge_ids: [partialBatch[1]], correction_step: recovery('R2-B') });
  complete('R2-B', ['B']);
  originalB = state().runtime_state.claim_evidence[1].slots[0].report;
  // G07: retain a genuine preflight and partial write, not a fabricated failure.
  invoke(['preflight-step'], { candidate_paths: allPaths });
  fs.writeFileSync(path.join(target, 'notes/a.md'), 'partial S2 change\n');
  const beforeSuspension = state();
  const retainedAttempts = beforeSuspension.runtime_state.step_attempts.S2;
  const suspensionEvidence = invoke(['ingest-evidence'], { source_revision: beforeSuspension.source_tuple.revision, source_locator: 'fixture:unfinished-S2', body: 'S2 has a recorded preflight and a partial A edit; restore the prior A observation before continuing its obligations.' });
  invoke(['suspend-recovery'], { source_revision: beforeSuspension.source_tuple.revision, reason: 'Historical result invalidates the unfinished follow-up assumption', evidence_refs: [suspensionEvidence.evidence_ref] });
  expect(state().runtime_state.step_attempts.S2).toEqual(retainedAttempts);
  expect(state().runtime_state.workflow_status).toBe('blocked_by_replan');
  const current = state();
  const execution = current.runtime_state.execution_log.findLast((item: any) => item.step_id === 'R2' && item.execution_result);
  const diagnosis = invoke(['ingest-evidence'], { source_revision: current.source_tuple.revision, source_locator: 'fixture:execution-diagnosis', body: 'Restore only A to its R2 preflight image, retain B, then verify A again.' });
  const checkpoint = invoke(['artifact-checkpoints'], {}).checkpoints.find((item: any) => item.step_id === 'R2' && item.phase === 'before' && item.committed);
  expect(checkpoint).toBeDefined();
  confirm({ mode: 'execution-recovery', strategy: 'mixed', challenge_ids: [], execution_targets: [{ execution_id: execution.idempotency_key, reason: 'Bounded result recovery', evidence_ref: diagnosis.evidence_ref, evidence_sha256: diagnosis.evidence_sha256 }],
    correction_step: { ...recovery('R3'), commands: [{ command: 'runtime:artifact-restore', expected_repo_writes: ['notes/a.md'] }] }, recovery_steps: [recovery('R4')],
    restore_plan: { checkpoint_id: checkpoint.checkpoint_id, paths: ['notes/a.md'] },
    pending_step_changes: { steps: [recovery('S2-new')], step_map: [{ old_step_id: 'S2', new_step_ids: ['S2-new'] }] },
    obligation_map: [{ claim_id: 'A', slot_id: 'a', due_step_id: 'R4' }, { claim_id: 'B', slot_id: 'b', due_step_id: 'R2-B' }] });
  complete('R3', [], {}, true);
  expect(fs.readFileSync(path.join(target, 'notes/a.md'), 'utf8')).toBe('corrected A\n');
  expect(fs.readFileSync(path.join(target, 'notes/b.md'), 'utf8')).toBe('corrected B\n');
  complete('R4', ['A'], { 'notes/a.md': 'forward repaired A\n' });
  complete('S2-new', []);
  expect(state().runtime_state.active_step_status).toBe('completed');
  expect(state().runtime_state.claim_evidence[1].slots[0].report).toEqual(originalB);
  const tailBatch = challenge(['A', 'B']);
  confirm({ challenge_ids: [tailBatch[0]], correction_step: recovery('TAIL') });
  complete('TAIL', ['A'], { 'notes/a.md': 'final verified A\n' });
  expect(state().runtime_state.active_step_status).toBe('completed');
  expect(state().runtime_state.execution_log.findLast((item: any) => item.step_id === 'TAIL').advancement).toBe('not-applicable');
  expect(state().runtime_state.evidence_challenges.find((item: any) => item.challenge_id === tailBatch[1]).status).toBe('contested');
  confirm({ challenge_ids: [tailBatch[1]], correction_step: recovery('TAIL-B') });
  complete('TAIL-B', ['B']);
  const final = state();
  expect(final.source_tuple.task_id).toBe(initial.source_tuple.task_id);
  expect(final.source_tuple.document_id).toBe(initial.source_tuple.document_id);
  for (const entry of history) expect(final.runtime_state.execution_log).toContainEqual(entry);
  expect(final.runtime_state.evidence_challenges.every((item: any) => item.status === 'resolved')).toBe(true);
  expect(final.runtime_state.claim_evidence[1].slots[0].report.result_id).not.toBe(originalB.result_id);
  const notTriggered = { triggered: false, complete: false, evidence_refs: [] };
  const delta = { kind: 'archive', action: 'archive', closure_evidence: { acceptance_satisfied: true, validation_complete: true,
    no_admitted_or_in_progress_findings: true, no_unresolved_closure_blocker: true, release_evidence: notTriggered, rollback_evidence: notTriggered,
    observation_evidence: notTriggered, remaining_risks_non_blocking: true, archive_path_verified: true },
    delivery_summary: { goal: 'Maintain verified local observations', actual_changes: ['Two observations recovered with retained history'], verification: ['Installed CLI recovery and review completed'], release_evidence: [], rollback_evidence: [], observation_evidence: [], next_action: 'No further fixture work' },
    remaining_risks: [], lesson_admission: { decision: 'no-op', candidate_refs: [], evidence_refs: [] }, evidence_refs: [unrelated.evidence_ref] };
  const closed = invoke(['apply'], { schema_version: 1, kind: 'vnext-runtime-proposal', operation_kind: 'archive-transaction', caller: 'close-task', mode: 'default', source_tuple: final.source_tuple,
    authority_evidence: ['active-task-owner', 'evidence-admission'].map(kind => ({ kind, source: final.source_tuple.path, subject: final.source_tuple.task_id })),
    semantic_delta: delta, preconditions: ['current-task-is-active', 'closure-eligibility-complete', 'archive-path-verified'], evidence_refs: delta.evidence_refs,
    idempotency_key: 'fixture-close-recovered-task', requested_write_targets: [final.source_tuple.path, `TASKS/TASK-${final.source_tuple.task_id}-${final.source_tuple.task_slug}.md`] });
  expect(closed.status).toBe('success');
  expect(state().runtime_state.workflow_status).toBe('closed');
  // Keep artifact coordinates in test output only on failure; no real project is touched.
  expect(sha(fs.readFileSync(tgz))).toHaveLength(64);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('D02 original 0.18.7 CLI creates active data; fixed tgz upgrade preserves bytes before explicit v2 initialization', { timeout: 180000 }, () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-recovery-upgrade-'));
  const baseline = path.join(workspace, 'baseline');
  const target = path.join(workspace, 'target');
  const npmHome = path.join(workspace, 'installer');
  for (const dir of [baseline, target, npmHome]) fs.mkdirSync(dir);
  const archive = path.join(workspace, 'baseline.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', archive, '070b91ed179b9b7e310d7c48e4fd96be679d69f2'], { cwd: sourceRoot });
  execFileSync('tar', ['-xf', archive, '-C', baseline]);
  execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: baseline });
  execFileSync('bun', ['run', 'build:vnext-runtime'], { cwd: baseline });
  execFileSync('bun', ['run', 'build:vibe-governance-distribution'], { cwd: baseline });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  function pack(packageRoot: string) {
    const result = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', workspace], { cwd: packageRoot, encoding: 'utf8' }));
    return path.join(workspace, result[0].filename);
  }
  const oldTgz = pack(path.join(baseline, 'packages/vibe-governance'));
  expect(path.basename(oldTgz)).toBe('vibe-governance-0.18.7.tgz');
  fs.writeFileSync(path.join(npmHome, 'package.json'), '{"name":"isolated-upgrade","private":true}\n');
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', oldTgz], { cwd: npmHome });
  const bin = path.join(npmHome, 'node_modules/.bin', process.platform === 'win32' ? 'vibe-governance.cmd' : 'vibe-governance');
  function distribution(command: string) {
    const result = spawnSync(bin, [command, '--root', target, '--json'], { cwd: npmHome, encoding: 'utf8', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`${command}: ${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout);
  }
  distribution('install');
  const cli = path.join(target, '.workflow-system/runtime/dist/cli.js');
  function runtime(args: string[], input?: unknown) {
    const result = spawnSync('node', [cli, ...args, '--root', target], { cwd: target, encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`${args}: ${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout);
  }
  const design = path.join(workspace, 'design.json');
  fs.writeFileSync(design, '{"architecture":"isolated upgrade fixture"}');
  const args = ['bootstrap-support', 'prepare', '--mode', 'greenfield', '--design-baseline-file', design, '--confirm-design', '--project-name', 'Upgrade Fixture', '--project-slug', 'upgrade-fixture', '--json'];
  const preview = runtime(args);
  const changed = path.join(workspace, 'paths.json'); fs.writeFileSync(changed, JSON.stringify(preview.planned_writes));
  runtime([...args, '--changed-paths-file', changed, '--write']);
  const prepared = runtime(['prepare-draft'], { task_basis: { original_request: { source: 'fixture:request', verbatim: 'Verify the local observation.' }, user_decisions: [] },
    goal: 'Verify the local observation.', claim_evidence: [{ claim_id: 'A', claim_kind: 'acceptance', requirement: 'The observation is verified', source_ref: 'fixture:request',
      slots: [{ slot_id: 'a', minimum_type: 'static-check', disposition: 'missing', evidence_refs: [], due_step_id: 'S1', applicability: 'current', report: null,
        check: { check_id: 'K', method: 'static', entry: 'Read README.md', expected_observation: 'Observation exists', required_boundaries: ['local document'], allowed_substitutes: [], subject_paths: ['README.md'], expected_result: 'accepted' } }] }],
    out_of_scope: ['External systems'], design_decisions: { decided: ['Local observation'], unresolved: [] }, mutation_scope: { allowed: ['README.md'], conditional: [], forbidden: ['.git/**'] },
    test_strategy: { mode: 'flexible', source: 'inferred-default', source_ref: 'prepare-task-default', task_classification: 'exploratory-or-infrastructure', rationale: 'Bounded local observation' },
    implementation_steps: [{ id: 'S1', description: 'Verify observation', mutation_scope: ['README.md'], commands: [], validation: ['Read observation'], review_checkpoint: { policy: 'required', reason: 'Review observation' } }], validation_plan: ['Read observation'], persistent_tests: 'none' });
  runtime(['confirm-draft'], { confirmation_receipt: prepared.confirmation_receipt });
  const old = runtime(['validate']);
  expect(old.runtime_state.task_evolution_version).toBe(1);
  const currentPath = path.join(target, old.source_tuple.path);
  const basisPath = path.join(target, 'docs/workflow/task-basis', `TASK_BASIS-${old.source_tuple.task_id}.md`);
  const oldBytes = fs.readFileSync(currentPath);
  const basisBytes = fs.readFileSync(basisPath);
  let fixed = process.env.VNEXT_RECOVERY_TGZ;
  if (!fixed) {
    buildVibeGovernanceDistribution({ outputRoot: path.join(sourceRoot, 'packages/vibe-governance') });
    fixed = pack(path.join(sourceRoot, 'packages/vibe-governance'));
  }
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', fixed], { cwd: npmHome });
  expect(distribution('upgrade').status).toBe('upgraded');
  expect(fs.readFileSync(currentPath)).toEqual(oldBytes);
  expect(fs.readFileSync(basisPath)).toEqual(basisBytes);
  expect(runtime(['validate']).runtime_state).toEqual(old.runtime_state);
  expect(runtime(['initialize-preservation'], { source_revision: old.source_tuple.revision, basis_revision: sha(basisBytes) }).status).toBe('success');
  const initialized = runtime(['validate']);
  expect(initialized.runtime_state.task_evolution_version).toBe(2);
  const history = JSON.parse(fs.readFileSync(path.join(target, 'docs/workflow/task-history', old.source_tuple.document_id, `${old.source_tuple.revision}.json`), 'utf8'));
  expect(Buffer.from(history.current_task_base64, 'base64')).toEqual(oldBytes);
  expect(Buffer.from(history.task_basis_base64, 'base64')).toEqual(basisBytes);
  expect(initialized.runtime_state.claim_evidence).toEqual(old.runtime_state.claim_evidence);
  expect(initialized.runtime_state.active_step_id).toBe(old.runtime_state.active_step_id);
  fs.rmSync(workspace, { recursive: true, force: true });
});
