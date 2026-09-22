/** Host-facing recovery driver. Semantic choices remain with the invoking agent. */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { createEntryOutputDirectory, retainEntryOutput, type OutputReference } from './entry-output';
import { entryRecovery } from './entry-recovery';
import { safeRepositoryFile } from './evidence-lineage';
import { ordinaryAttemptAdmission, pendingReviewForOrdinaryRetry, policyTargetIdsForCurrent, readCanonicalCurrentTask, retryBudgetBinding } from './kernel';
import { recordUserDecision } from './user-decision-adapter';

type Json = Record<string, any>;
const ENTRIES = ['bootstrap-project', 'capture-work-item', 'prepare-task', 'review-draft',
  'execute-step', 'review-change', 'debug-task', 'close-task', 'task-lifecycle', 'validate-change', 'git-commit'];
type Operation = { command: string; args?: string[]; input?: unknown };
type Outcome = { exit_code: number; result: Json; stderr: string; detail_ref?: OutputReference };

function object(value: unknown, name: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Json;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be non-empty text.`);
  return value;
}
function parseOutput(stdout: string): Json | null {
  // Some existing writers print a progress line before their JSON result.
  const lines = stdout.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]!.trimStart().startsWith('{')) continue;
    try { return object(JSON.parse(lines.slice(index).join('\n')), 'result'); } catch { /* Try the final JSON object. */ }
  }
  return null;
}
function accepted(outcome: Outcome): boolean {
  return outcome.exit_code === 0 && !['blocked', 'conflict', 'error', 'failed', 'decision-required', 'recovery-required'].includes(outcome.result.status);
}

export async function runEntryRunnerCli(argv: string[], allowedCommands: readonly string[]): Promise<number> {
  const journal: Json[] = [];
  let retainedInvocation: Json | undefined;
  let directory: string | undefined;
  const outputDirectory = (): string => directory ??= createEntryOutputDirectory();
  const short = (value: unknown): string | undefined => typeof value === 'string' ? value.slice(0, 512) : undefined;
  let emission = 0;
  const emit = (value: Json): void => {
    const name = `result-${emission++}`;
    const outcomeRef = value.outcome?.detail_ref ?? (value.outcome
      ? retainEntryOutput(outputDirectory(), name + '-outcome', value.outcome) : undefined);
    const reference = retainEntryOutput(outputDirectory(), name, { ...value, outcome: outcomeRef });
    console.log(JSON.stringify({ kind: 'entry-operation-result/v1', status: value.status,
      skill_terminal: false, phase: value.phase,
      invocation: { id: short(value.invocation?.id), entry: short(value.invocation?.entry) },
      outcome: value.outcome ? { exit_code: value.outcome.exit_code, status: short(value.outcome.result?.status),
        code: short(value.outcome.result?.code), committed: value.outcome.result?.committed,
        message: short(value.outcome.result?.message) } : undefined,
      message: short(value.message), outcome_ref: outcomeRef, detail_ref: reference,
      entry_recovery: value.entry_recovery ? {
        code: short(value.entry_recovery.code), owner: short(value.entry_recovery.owner),
        operation_state: short(value.entry_recovery.operation_state), skill_terminal: false,
        next_action: short(value.entry_recovery.next_action),
      } : undefined,
      read_command: 'entry-output-read',
      next_action: value.status === 'recovery-required'
        ? 'Read the retained outcome and recovery routes; continue this invocation.'
        : 'Read the retained receipt before any dependent operation.' }, null, 2));
  };
  try {
    let root = process.cwd();
    for (let i = 1; i < argv.length; i += 1) {
      if (argv[i] !== '--root' || !argv[i + 1]) throw new Error('run-entry accepts only --root <project>.');
      root = path.resolve(argv[++i]!);
    }
    const input = object(JSON.parse(fs.readFileSync(0, 'utf8')), 'run-entry');
    const invocation = object(input.invocation, 'invocation');
    retainedInvocation = invocation;
    if (!ENTRIES.includes(invocation.entry)) throw new Error('invocation.entry must identify a public Skill.');
    const invocationId = text(invocation.id, 'invocation.id');
    text(invocation.intent, 'invocation.intent');
    text(invocation.decision_source, 'invocation.decision_source');
    text(invocation.decision_text, 'invocation.decision_text');
    const original = object(input.operation, 'operation') as Operation;
    const run = async (operation: Operation): Promise<Outcome> => {
      if (!allowedCommands.includes(operation.command) || operation.command === 'run-entry') throw new Error('Unknown internal Runtime command.');
      const args = operation.args ?? [];
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || /^--root(?:=|$)/u.test(arg))) {
        throw new Error('Operation args must be strings and cannot change the invocation root.');
      }
      const index = journal.length;
      const stdoutPath = path.join(outputDirectory(), `operation-${index}.stdout`);
      const stderrPath = path.join(outputDirectory(), `operation-${index}.stderr`);
      const stdoutFd = fs.openSync(stdoutPath, 'wx', 0o600);
      let stderrFd: number | undefined;
      let outcome: Outcome;
      try {
        stderrFd = fs.openSync(stderrPath, 'wx', 0o600);
        const completion = await new Promise<{ exitCode: number; error?: string }>(resolve => {
          const child = spawn(process.execPath, [path.resolve(process.argv[1]!), operation.command, ...args, '--root', root],
            { cwd: root, windowsHide: true, stdio: ['pipe', stdoutFd, stderrFd!] });
          let launchError: string | undefined;
          child.on('error', error => { launchError = error.message; });
          child.on('close', code => resolve({ exitCode: code ?? 1, error: launchError }));
          child.stdin?.on('error', () => {});
          child.stdin?.end(JSON.stringify(operation.input ?? {}));
        });
        const stdout = fs.readFileSync(stdoutPath, 'utf8');
        const stderr = fs.readFileSync(stderrPath, 'utf8');
        const structured = parseOutput(stdout);
        const errorEnvelope = parseOutput(stderr);
        outcome = { exit_code: completion.exitCode,
          result: structured ?? errorEnvelope?.runtime_result ?? {
            status: 'blocked', code: errorEnvelope?.entry_recovery?.code ?? 'ENTRY_OPERATION_FAILED',
            message: stderr || completion.error || stdout, entry_recovery: errorEnvelope?.entry_recovery,
          }, stderr };
      } finally {
        fs.closeSync(stdoutFd);
        if (stderrFd !== undefined) fs.closeSync(stderrFd);
      }
      outcome.detail_ref = retainEntryOutput(outputDirectory(), `operation-${index}-outcome`, outcome);
      journal.push({ command: operation.command,
        operation_ref: retainEntryOutput(outputDirectory(), `operation-${index}-input`, operation),
        outcome_ref: outcome.detail_ref });
      return outcome;
    };
    const finish = (outcome: Outcome, phase: string): number => {
      const success = accepted(outcome);
      emit({ kind: 'entry-operation-result/v1', invocation,
        status: success ? 'operation-complete' : 'recovery-required', skill_terminal: false,
        phase, original_operation: retainEntryOutput(outputDirectory(), 'original-operation', original),
        outcome, recovery_history: journal,
        ...(!success ? { entry_recovery: outcome.result.entry_recovery ?? entryRecovery(outcome.result.code ?? 'ENTRY_OPERATION_FAILED'),
          next_action: 'Inspect retained state; supply a corrected operation or evidence-backed internal recovery plan, then resume this invocation.' } : {}) });
      return success ? 0 : 2;
    };
    // A recovery plan is supplied after diagnosis. Its steps are existing typed
    // operations, never public Skill invocations or arbitrary shell commands.
    if (input.recovery !== undefined) {
      const recovery = object(input.recovery, 'recovery');
      text(recovery.reason, 'recovery.reason');
      if (!Array.isArray(recovery.operations) || recovery.operations.length === 0) throw new Error('recovery.operations must contain typed recovery actions.');
      for (const raw of recovery.operations) {
        const outcome = await run(object(raw, 'recovery operation') as Operation);
        if (!accepted(outcome)) return finish(outcome, 'internal-recovery');
      }
    }
    let outcome = await run(original);
    // A child can commit a retry before its reply is delivered. Recover its
    // already-consumed grant when replaying the same retry key, not a new grant.
    if (original.command === 'retry-step' && outcome.result.code === 'RETRY_IDEMPOTENCY_CONFLICT') {
      const request = object(original.input, 'operation.input');
      if (request.policy_decision_id === undefined) {
        const current = readCanonicalCurrentTask(root);
        const attempt = current.runtimeState.step_attempts?.[request.step_id]?.attempts
          .find(item => item.idempotency_key === request.idempotency_key);
        const decisionId = attempt?.retry_budget_decision_id ?? attempt?.consumed_review_decision_id;
        if (decisionId) outcome = await run({ ...original, input: { ...request, policy_decision_id: decisionId } });
      }
    }
    if (outcome.result.code === 'RETRY_BUDGET_EXHAUSTED'
      && invocation.entry === 'execute-step'
      && ['preflight-step', 'retry-step'].includes(original.command) && input.budget_analysis !== undefined) {
      const analysis = object(input.budget_analysis, 'budget_analysis');
      const current = readCanonicalCurrentTask(root);
      const admission = ordinaryAttemptAdmission(current, root);
      const binding = retryBudgetBinding(current, root);
      // The analysis is an AI artifact, not fabricated user speech. Its evidence
      // is retained in the existing decision audit; no parallel task store exists.
      if (analysis.attempt_id !== admission.authorized_attempt_id || analysis.plan_revision !== binding.plan_revision
        || analysis.document_id !== current.sourceTuple.document_id) return finish(outcome, 'refresh-budget-analysis');
      if (!Array.isArray(analysis.evidence_refs) || analysis.evidence_refs.length === 0) throw new Error('budget_analysis requires retained reassessment evidence.');
      for (const ref of analysis.evidence_refs) {
        const file = safeRepositoryFile(root, text(ref, 'analysis evidence reference'));
        if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) throw new Error('Reassessment evidence must be a nonempty file.');
      }
      const gates = ['RETRY_BUDGET_EXHAUSTED', ...(original.command === 'retry-step' && pendingReviewForOrdinaryRetry(current) ? ['RETRY_REVIEW_REQUIRED'] : [])];
      const pending = current.runtimeState.pending_review_result;
      const key = 'entry-budget-' + createHash('sha256').update(JSON.stringify({ invocationId, document: current.sourceTuple.document_id, binding, gates, review: pending?.review_id })).digest('hex').slice(0, 40);
      const previous = current.runtimeState.execution_log.find(item => 'action' in item
        && item.action === 'record-user-decision' && item.idempotency_key === key);
      if (!previous) {
        const decision = recordUserDecision(root, {
          decision_source: invocation.decision_source, decision_text: invocation.decision_text,
          ...(pending ? { review_id: pending.review_id, change_set_id: pending.change_set_id } : {}),
          effects: gates.map(code => ({ kind: 'continue-after-warning', gate_code: code,
            target_ids: policyTargetIdsForCurrent(current, code) })),
          evidence_refs: analysis.evidence_refs, idempotency_key: key,
        }, {}, 'execute-step');
        journal.push({ automatic_budget_continuation: decision, analysis });
        if (!['success', 'no-op'].includes(decision.status)) {
          return finish({ exit_code: 2, result: decision, stderr: '' }, 'budget-continuation');
        }
      } else {
        journal.push({ reused_budget_decision_id: key });
      }
      outcome = await run({ ...original, input: { ...object(original.input, 'operation.input'), policy_decision_id: key } });
    }
    return finish(outcome, 'original-operation');
  } catch (error) {
    const cause = error !== null && typeof error === 'object' ? error as Json : {};
    const runtimeResult = cause.runtime_result !== null && typeof cause.runtime_result === 'object'
      && !Array.isArray(cause.runtime_result) ? cause.runtime_result as Json : {};
    const code = typeof runtimeResult.code === 'string' ? runtimeResult.code
      : typeof cause.code === 'string' ? cause.code : 'ENTRY_REQUEST_OR_RECOVERY_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    const result = { status: 'blocked', ...runtimeResult, code,
      message: runtimeResult.message ?? message,
      entry_recovery: runtimeResult.entry_recovery ?? cause.entry_recovery ?? entryRecovery(code, runtimeResult),
      ...(runtimeResult.policy_route === undefined && cause.policy_route !== undefined ? { policy_route: cause.policy_route } : {}),
      ...(runtimeResult.recovery_route === undefined && cause.recovery_route !== undefined ? { recovery_route: cause.recovery_route } : {}),
    };
    emit({ kind: 'entry-operation-result/v1', invocation: retainedInvocation,
      status: 'recovery-required', skill_terminal: false, recovery_history: journal,
      outcome: { exit_code: 2, result, stderr: message },
      message, entry_recovery: result.entry_recovery });
    return 2;
  }
}
