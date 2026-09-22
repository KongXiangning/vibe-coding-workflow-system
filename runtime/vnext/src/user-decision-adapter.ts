/**
 * Internal user-decision adapter.
 *
 * A caller supplies the user's decision and its exact target.  The adapter
 * adds only Runtime-derived identity and authority evidence; the kernel is
 * still the single atomic writer of the decision, finding projection, review
 * consumption, step disposition, and Task Basis.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  applyVNextRuntimeProposal,
  createUserDecisionProposal,
  readCanonicalCurrentTask,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  VNextRuntimeError,
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  type AuthorityEvidence,
  type RuntimeApplyOptions,
  type RuntimeResult,
  type UserDecision,
  type UserDecisionEffect,
  type UserDecisionAuditLogEntry,
} from './kernel';

export const USER_DECISION_ADAPTER_COMMANDS = ['record-user-decision'] as const;
export type UserDecisionAdapterCommand = (typeof USER_DECISION_ADAPTER_COMMANDS)[number];

type JsonRecord = Record<string, unknown>;

function fail(code: string, message: string): never {
  throw new VNextRuntimeError(code, message);
}

function record(value: unknown, location: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('USER_DECISION_ADAPTER_INPUT_INVALID', `${location} must be an object.`);
  return value as JsonRecord;
}

function requiredText(value: unknown, location: string, maxLength = 32768): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    fail('USER_DECISION_ADAPTER_INPUT_INVALID', `${location} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function optionalText(value: unknown, location: string, maxLength = 4096): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, location, maxLength);
}

function readInput(command: UserDecisionAdapterCommand): unknown {
  const raw = !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '';
  if (!raw.trim()) fail('USER_DECISION_ADAPTER_INPUT_INVALID', `${command} requires semantic JSON on stdin.`);
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    fail('USER_DECISION_ADAPTER_INPUT_INVALID', `${command} stdin must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function authority(current: ReturnType<typeof readCanonicalCurrentTask>, source: string, needsFindingAuthority: boolean): AuthorityEvidence[] {
  const required: AuthorityEvidence[] = [
    { kind: 'active-task-owner', source, subject: 'current-task', task_id: current.runtimeState.task_id, document_id: current.sourceTuple.document_id },
    { kind: 'user-confirmation', source, subject: 'record-user-decision', task_id: current.runtimeState.task_id, document_id: current.sourceTuple.document_id },
    { kind: 'evidence-admission', source, subject: 'user-decision-audit', task_id: current.runtimeState.task_id, document_id: current.sourceTuple.document_id },
  ];
  if (needsFindingAuthority) required.push({ kind: 'finding-admission', source, subject: 'finding-disposition', task_id: current.runtimeState.task_id, document_id: current.sourceTuple.document_id });
  return required;
}

function parseCli(argv: string[]): { root: string; dryRun: boolean; caller: UserDecisionAuditLogEntry['caller'] } {
  const [, ...rest] = argv;
  let root = process.cwd();
  let dryRun = false;
  let caller: UserDecisionAuditLogEntry['caller'] = 'prepare-task';
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--caller') {
      const value = rest[++index];
      if (!['prepare-task', 'review-change', 'execute-step', 'close-task'].includes(value ?? '')) fail('USER_DECISION_ADAPTER_INPUT_INVALID', '--caller must identify an active task adapter.');
      caller = value as UserDecisionAuditLogEntry['caller'];
    } else fail('USER_DECISION_ADAPTER_INPUT_INVALID', `Unknown user-decision adapter argument: ${arg}`);
  }
  if (!root) fail('USER_DECISION_ADAPTER_INPUT_INVALID', '--root requires a path.');
  return { root, dryRun, caller };
}

function normalizeDecision(current: ReturnType<typeof readCanonicalCurrentTask>, input: unknown): { decision: UserDecision; evidenceRefs: string[]; needsFindingAuthority: boolean } {
  const source = record(input, 'record-user-decision input');
  const allowed = new Set(['decision_source', 'decision_text', 'task_id', 'source_revision', 'review_id', 'change_set_id', 'effects', 'idempotency_key', 'evidence_refs']);
  const extra = Object.keys(source).filter(key => !allowed.has(key));
  if (extra.length > 0) fail('USER_DECISION_ADAPTER_INPUT_INVALID', `record-user-decision input has unexpected keys: ${extra.join(', ')}`);
  if (!Array.isArray(source.effects) || source.effects.length === 0) fail('USER_DECISION_ADAPTER_INPUT_INVALID', 'effects must be a non-empty array.');
  const effects = source.effects as UserDecisionEffect[];
  const evidenceRefs = source.evidence_refs === undefined
    ? [current.relativePath]
    : (() => {
      if (!Array.isArray(source.evidence_refs) || source.evidence_refs.length === 0) fail('USER_DECISION_ADAPTER_INPUT_INVALID', 'evidence_refs must be a non-empty array.');
      return source.evidence_refs.map((value, index) => requiredText(value, `evidence_refs[${index}]`, 512));
    })();
  const decisionText = requiredText(source.decision_text, 'decision_text');
  const decisionSource = requiredText(source.decision_source, 'decision_source', 512);
  const idempotencyKey = requiredText(source.idempotency_key, 'idempotency_key', 128);
  const decision: UserDecision = {
    decision_source: decisionSource,
    decision_text: decisionText,
    task_id: source.task_id === undefined ? current.runtimeState.task_id : requiredText(source.task_id, 'task_id', 128),
    source_revision: source.source_revision === undefined ? current.sourceTuple.revision : requiredText(source.source_revision, 'source_revision', 64),
    ...(source.review_id === undefined ? {} : { review_id: requiredText(source.review_id, 'review_id', 128) }),
    ...(source.change_set_id === undefined ? {} : { change_set_id: requiredText(source.change_set_id, 'change_set_id', 128) }),
    effects,
    idempotency_key: idempotencyKey,
    evidence_refs: evidenceRefs,
  };
  return {
    decision,
    evidenceRefs,
    needsFindingAuthority: effects.some(effect => effect && (effect.kind === 'repair-finding' || effect.kind === 'reopen-finding')),
  };
}

export function recordUserDecision(root: string, input: unknown, options: RuntimeApplyOptions = {}, caller: UserDecisionAuditLogEntry['caller'] = 'prepare-task'): RuntimeResult {
  const current = readCanonicalCurrentTask(root);
  const normalized = normalizeDecision(current, input);
  const proposal = createUserDecisionProposal(current, {
    caller,
    decision: normalized.decision,
    authority_evidence: authority(current, normalized.decision.decision_source, normalized.needsFindingAuthority),
    evidence_refs: normalized.evidenceRefs,
  });
  return applyVNextRuntimeProposal(root, proposal, options);
}

function validateInstalledRuntime(root: string): void {
  const runtimeManifest = path.join(path.resolve(root), ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'), 'package.json');
  if (fs.existsSync(runtimeManifest)) validateVNextRuntimeContract(root, true);
}

export async function runUserDecisionAdapterCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    validateRuntimeEnvironment();
    const args = parseCli(argv);
    validateInstalledRuntime(args.root);
    const result = recordUserDecision(args.root, readInput('record-user-decision'), { dryRun: args.dryRun }, args.caller);
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'blocked' || result.status === 'conflict' ? 2 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

