/**
 * Human-semantic adapter for prepare-task.
 *
 * The public entry accepts task design content only. Runtime-owned proposal
 * fields, authority, source coordinates, identity allocation, evidence-plan
 * scaffolding, write targets, commit, and read-back remain inside this module
 * and the transaction kernel.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH,
  VNextRuntimeError,
  allocateNextTaskId,
  applyVNextRuntimeProposal,
  createPrepareTaskConfirmProposal,
  createPrepareTaskDraftProposal,
  createPrepareTaskReplanProposal,
  createPrepareTaskResumeReviewProposal,
  readCanonicalCurrentTask,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type CanonicalCurrentTask,
  type ClaimEvidenceRecord,
  type DraftTaskDefinition,
  type RuntimeApplyOptions,
  type RuntimeResult,
} from './kernel';
import {
  evaluateMutationScope,
  mutationScopePatternMatchesPath,
  parseMutationScope,
} from './mutation-scope';
import { extractTaskIdentityFromCurrentTask } from './task-identity';

export const PREPARE_TASK_ADAPTER_COMMANDS = [
  'prepare-draft',
  'confirm-draft',
  'clear-resume-review',
  'replan',
] as const;

export type PrepareTaskAdapterCommand = (typeof PREPARE_TASK_ADAPTER_COMMANDS)[number];

export type PrepareTaskSemanticDraft = {
  goal: string;
  acceptance: string[];
  out_of_scope: string[];
  design_decisions: string[];
  mutation_scope: {
    allowed: string[];
    conditional: Array<{ path: string; condition: string }>;
    forbidden: string[];
  };
  implementation_steps: Array<{
    id: string;
    description: string;
    mutation_scope: string[];
    validation: string[];
  }>;
  validation_plan: string[];
  persistent_tests: 'none' | Array<{
    path: string;
    proves: string[];
  }>;
};

export type PrepareTaskResumeReviewInput = {
  readiness_evidence: string[];
};

type JsonRecord = Record<string, unknown>;

const SEMANTIC_DRAFT_FIELDS = [
  'goal',
  'acceptance',
  'out_of_scope',
  'design_decisions',
  'mutation_scope',
  'implementation_steps',
  'validation_plan',
  'persistent_tests',
] as const;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const MAX_ITEMS = 256;

function fail(code: string, message: string): never {
  throw new VNextRuntimeError(code, message);
}

function record(value: unknown, location: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], location: string): void {
  const allowed = new Set(expected);
  const missing = expected.filter(key => !(key in value));
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      'PREPARE_ADAPTER_INPUT_INVALID',
      `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}].`,
    );
  }
}

function text(value: unknown, location: string, maximumLength = 4096): string {
  if (typeof value !== 'string') fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\r\n]/u.test(normalized)) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be one non-empty line of at most ${maximumLength} characters.`);
  }
  return normalized;
}

function textList(value: unknown, location: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || (!allowEmpty && value.length === 0)) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be a bounded${allowEmpty ? '' : ' non-empty'} array.`);
  }
  const values = value.map((item, index) => text(item, `${location}[${index}]`));
  if (new Set(values).size !== values.length) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must not contain duplicates.`);
  }
  return values;
}

function normalizeScopePath(value: unknown, location: string, allowGlob: boolean): string {
  const original = text(value, location, 1024);
  const normalized = original.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (
    normalized.startsWith('/')
    || WINDOWS_ABSOLUTE_PATH.test(original)
    || normalized.split('/').includes('..')
    || normalized.includes('\0')
    || (!allowGlob && normalized.includes('*'))
  ) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be a repository-relative ${allowGlob ? 'path or glob' : 'exact path'} without traversal.`);
  }
  return normalized;
}

function normalizeScopePathList(value: unknown, location: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be a bounded array.`);
  }
  const paths = value.map((item, index) => normalizeScopePath(item, `${location}[${index}]`, true));
  if (new Set(paths).size !== paths.length) fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must not contain duplicates.`);
  return paths;
}

function normalizeSemanticDraft(input: unknown): PrepareTaskSemanticDraft {
  const source = record(input, 'prepare-task semantic draft');
  exactKeys(source, SEMANTIC_DRAFT_FIELDS, 'prepare-task semantic draft');

  const mutationScope = record(source.mutation_scope, 'mutation_scope');
  exactKeys(mutationScope, ['allowed', 'conditional', 'forbidden'], 'mutation_scope');
  const allowed = normalizeScopePathList(mutationScope.allowed, 'mutation_scope.allowed');
  if (allowed.length === 0) fail('PREPARE_ADAPTER_INPUT_INVALID', 'mutation_scope.allowed must contain at least one executable target.');
  const forbidden = normalizeScopePathList(mutationScope.forbidden, 'mutation_scope.forbidden');
  if (!Array.isArray(mutationScope.conditional) || mutationScope.conditional.length > MAX_ITEMS) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'mutation_scope.conditional must be a bounded array.');
  }
  const conditional = mutationScope.conditional.map((item, index) => {
    const candidate = record(item, `mutation_scope.conditional[${index}]`);
    exactKeys(candidate, ['path', 'condition'], `mutation_scope.conditional[${index}]`);
    return {
      path: normalizeScopePath(candidate.path, `mutation_scope.conditional[${index}].path`, true),
      condition: text(candidate.condition, `mutation_scope.conditional[${index}].condition`),
    };
  });
  if (new Set(conditional.map(item => item.path)).size !== conditional.length) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'mutation_scope.conditional must not contain duplicate paths.');
  }

  if (!Array.isArray(source.implementation_steps) || source.implementation_steps.length === 0 || source.implementation_steps.length > MAX_ITEMS) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'implementation_steps must be a bounded non-empty array.');
  }
  const implementationSteps = source.implementation_steps.map((item, index) => {
    const step = record(item, `implementation_steps[${index}]`);
    exactKeys(step, ['id', 'description', 'mutation_scope', 'validation'], `implementation_steps[${index}]`);
    const id = text(step.id, `implementation_steps[${index}].id`, 128);
    if (!STEP_ID_PATTERN.test(id)) fail('PREPARE_ADAPTER_INPUT_INVALID', `implementation_steps[${index}].id is invalid.`);
    return {
      id,
      description: text(step.description, `implementation_steps[${index}].description`),
      mutation_scope: normalizeScopePathList(step.mutation_scope, `implementation_steps[${index}].mutation_scope`),
      validation: textList(step.validation, `implementation_steps[${index}].validation`, false),
    };
  });
  if (new Set(implementationSteps.map(step => step.id)).size !== implementationSteps.length) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'implementation_steps must not contain duplicate IDs.');
  }
  if (implementationSteps.some(step => step.mutation_scope.length === 0)) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'every implementation step must name at least one mutation-scope target.');
  }

  let persistentTests: PrepareTaskSemanticDraft['persistent_tests'];
  if (source.persistent_tests === 'none') {
    persistentTests = 'none';
  } else {
    if (!Array.isArray(source.persistent_tests) || source.persistent_tests.length === 0 || source.persistent_tests.length > MAX_ITEMS) {
      fail('PREPARE_ADAPTER_INPUT_INVALID', 'persistent_tests must be "none" or a bounded non-empty array.');
    }
    persistentTests = source.persistent_tests.map((item, index) => {
      const test = record(item, `persistent_tests[${index}]`);
      exactKeys(test, ['path', 'proves'], `persistent_tests[${index}]`);
      return {
        path: normalizeScopePath(test.path, `persistent_tests[${index}].path`, false),
        proves: textList(test.proves, `persistent_tests[${index}].proves`, false),
      };
    });
    if (new Set(persistentTests.map(test => test.path)).size !== persistentTests.length) {
      fail('PREPARE_ADAPTER_INPUT_INVALID', 'persistent_tests must not contain duplicate paths.');
    }
  }

  const normalized: PrepareTaskSemanticDraft = {
    goal: text(source.goal, 'goal', 512),
    acceptance: textList(source.acceptance, 'acceptance', false),
    out_of_scope: textList(source.out_of_scope, 'out_of_scope', true),
    design_decisions: textList(source.design_decisions, 'design_decisions', true),
    mutation_scope: { allowed, conditional, forbidden },
    implementation_steps: implementationSteps,
    validation_plan: textList(source.validation_plan, 'validation_plan', false),
    persistent_tests: persistentTests,
  };
  assertSemanticScopeIsExecutable(normalized);
  return normalized;
}

function markdownBullets(items: readonly string[], checklist = false): string {
  if (items.length === 0) return '- none';
  return items.map(item => checklist ? `- [ ] ${item}` : `- ${item}`).join('\n');
}

function scopeBody(input: PrepareTaskSemanticDraft): string {
  return [
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    markdownBullets(input.mutation_scope.allowed.map(item => `\`${item}\``)),
    '',
    '### Conditional Files',
    '',
    markdownBullets(input.mutation_scope.conditional.map(item => `\`${item.path}\` when ${item.condition}`)),
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    markdownBullets(input.mutation_scope.forbidden.map(item => `\`${item}\``)),
    '',
  ].join('\n');
}

function assertSemanticScopeIsExecutable(input: PrepareTaskSemanticDraft): void {
  const scope = parseMutationScope(scopeBody(input));
  const persistentTests = input.persistent_tests === 'none' ? [] : input.persistent_tests;
  const allowedExact = new Set(input.mutation_scope.allowed.filter(item => !item.includes('*')));
  for (const test of persistentTests) {
    if (!allowedExact.has(test.path)) {
      fail('PERSISTENT_TEST_SCOPE_INVALID', `persistent test ${test.path} must also appear as an exact mutation_scope.allowed entry.`);
    }
  }
  if (persistentTests.length > 0) {
    const result = evaluateMutationScope(scope, { changed_paths: persistentTests.map(test => test.path) });
    if (result.status !== 'pass') {
      fail('PERSISTENT_TEST_SCOPE_INVALID', `persistent test scope is not executable: ${result.blockers.join(' ')}`);
    }
  }

  for (const step of input.implementation_steps) {
    for (const target of step.mutation_scope) {
      const forbidden = input.mutation_scope.forbidden.some(pattern => target === pattern || (!target.includes('*') && mutationScopePatternMatchesPath(target, pattern)));
      if (forbidden) fail('STEP_SCOPE_INVALID', `step ${step.id} target ${target} is forbidden.`);
      const allowed = input.mutation_scope.allowed.includes(target);
      const conditional = input.mutation_scope.conditional.some(item => target === item.path || (!target.includes('*') && mutationScopePatternMatchesPath(target, item.path)));
      if (!allowed && !conditional) {
        fail('STEP_SCOPE_INVALID', `step ${step.id} target ${target} is outside Mutation scope.`);
      }
      if (allowed && conditional) {
        fail('STEP_SCOPE_INVALID', `step ${step.id} target ${target} is ambiguously both Allowed and Conditional.`);
      }
    }
  }
}

function semanticDigest(input: PrepareTaskSemanticDraft): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function taskSlug(goal: string): string {
  const ascii = goal.normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/gu, '');
  if (ascii) return ascii;
  return `task-${crypto.createHash('sha256').update(goal).digest('hex').slice(0, 12)}`;
}

function authority(current: CanonicalCurrentTask, subject: string, kinds: AuthorityEvidence['kind'][]): AuthorityEvidence[] {
  return kinds.map(kind => ({ kind, source: current.relativePath, subject }));
}

function claimEvidence(input: PrepareTaskSemanticDraft): ClaimEvidenceRecord[] {
  return input.acceptance.map((_, index) => ({
    claim_id: `acceptance-${index + 1}`,
    claim_kind: 'acceptance',
    slots: [{
      slot_id: 'validation',
      minimum_type: 'planned-validation',
      disposition: 'missing',
      evidence_refs: [],
    }],
  }));
}

export function semanticDraftDefinition(input: PrepareTaskSemanticDraft): DraftTaskDefinition {
  const persistentTests = input.persistent_tests === 'none'
    ? ['- none']
    : input.persistent_tests.flatMap(test => [
      `- \`${test.path}\``,
      ...test.proves.map(proof => `  - proves: ${proof}`),
    ]);
  return {
    background_context: [
      '### Goal',
      '',
      input.goal,
      '',
      '### Out of scope',
      '',
      markdownBullets(input.out_of_scope),
    ].join('\n'),
    acceptance: markdownBullets(input.acceptance, true),
    allowed_scope: markdownBullets(input.mutation_scope.allowed.map(item => `\`${item}\``)),
    conditional_scope: markdownBullets(input.mutation_scope.conditional.map(item => `\`${item.path}\` when ${item.condition}`)),
    forbidden_scope: markdownBullets(input.mutation_scope.forbidden.map(item => `\`${item}\``)),
    affected_contracts: '- none',
    confirmed_decisions: markdownBullets(input.design_decisions),
    open_questions: '- none',
    implementation_plan: input.implementation_steps.map(step => `- ${step.id}: ${step.description}`).join('\n'),
    implementation_steps: input.implementation_steps.flatMap(step => [
      `- ${step.id}: ${step.description}`,
      `  - purpose: ${step.description}`,
      `  - mutation_scope: ${step.mutation_scope.join(', ')}`,
      `  - required_evidence: ${step.validation.join('; ')}`,
      `  - review_checkpoint: required: review ${step.id} diff against the confirmed CURRENT_TASK`,
    ]).join('\n'),
    regression_checks: [
      '### Validation Plan',
      '',
      markdownBullets(input.validation_plan, true),
      '',
      '### Persistent Tests',
      '',
      ...persistentTests,
    ].join('\n'),
    rollback_points: '- Revert only the current step changes if its required validation cannot pass.',
    design_constraints: null,
    post_release_validation: null,
    propagation_governance: null,
  };
}

function verifyAdapterReadBack(root: string, result: RuntimeResult, options: RuntimeApplyOptions): RuntimeResult {
  if (options.dryRun || (result.status !== 'success' && result.status !== 'no-op')) return result;
  const readBack = readCanonicalCurrentTask(root);
  if (!result.read_back_verified || result.resulting_revision !== readBack.sourceTuple.revision) {
    fail('PREPARE_ADAPTER_READ_BACK_FAILED', 'prepare-task adapter could not verify the committed canonical CURRENT_TASK revision.');
  }
  return result;
}

export function prepareDraft(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const semantic = normalizeSemanticDraft(input);
  const current = readCanonicalCurrentTask(root);
  const creating = current.runtimeState.workflow_status === 'closed' && current.runtimeState.lifecycle_state === 'archived';
  const updating = current.runtimeState.workflow_status === 'draft' && current.runtimeState.lifecycle_state === 'active';
  if (!creating && !updating) {
    fail('PREPARE_DRAFT_STATE_INVALID', 'prepare-draft requires closed + archived to create, or draft + active to update. Use replan for an existing confirmed task.');
  }
  const identity = creating
    ? {
      task_id: allocateNextTaskId(root, current.runtimeState.task_id),
      task_slug: taskSlug(semantic.goal),
      task_title: semantic.goal,
      document_id: undefined,
    }
    : {
      task_id: current.runtimeState.task_id,
      task_slug: current.runtimeState.task_slug,
      task_title: extractTaskIdentityFromCurrentTask(current.body).title,
      document_id: current.sourceTuple.document_id,
    };
  const digest = semanticDigest(semantic);
  const evidenceRefs = [`adapter:prepare-draft:${digest.slice(0, 16)}`];
  const proposal = createPrepareTaskDraftProposal(current, {
    action: creating ? 'create-draft' : 'update-draft',
    ...identity,
    draft_definition: semanticDraftDefinition(semantic),
    active_step_id: semantic.implementation_steps[0]!.id,
    evidence_refs: evidenceRefs,
    claim_evidence: claimEvidence(semantic),
    idempotency_key: `prepare-draft-${identity.task_id}-${current.sourceTuple.revision.slice(0, 12)}-${digest.slice(0, 12)}`,
    authority_evidence: authority(current, identity.task_id, creating
      ? ['authorized-caller', 'scope-admission', 'evidence-admission']
      : ['active-task-owner', 'scope-admission', 'evidence-admission']),
  });
  return verifyAdapterReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

function emptyInput(input: unknown, location: string): void {
  const value = input === undefined ? {} : record(input, location);
  exactKeys(value, [], location);
}

export function confirmDraft(root: string, input?: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  emptyInput(input, 'confirm-draft input');
  const current = readCanonicalCurrentTask(root);
  if (current.runtimeState.workflow_status !== 'draft' || current.runtimeState.lifecycle_state !== 'active') {
    fail('DRAFT_CONFIRMATION_BLOCKED', 'confirm-draft requires the current task to be draft + active.');
  }
  const evidenceRefs = [`adapter:confirm-draft:${current.sourceTuple.revision.slice(0, 16)}`];
  const proposal = createPrepareTaskConfirmProposal(current, {
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    document_id: current.sourceTuple.document_id,
    draft_revision: current.sourceTuple.revision,
    evidence_refs: evidenceRefs,
    idempotency_key: `confirm-draft-${current.runtimeState.task_id}-${current.sourceTuple.revision.slice(0, 16)}`,
    authority_evidence: [
      {
        kind: 'user-confirmation',
        source: current.relativePath,
        subject: current.runtimeState.task_id,
        task_id: current.runtimeState.task_id,
        document_id: current.sourceTuple.document_id,
        draft_revision: current.sourceTuple.revision,
      },
      ...authority(current, current.runtimeState.task_id, ['evidence-admission']),
    ],
  });
  return verifyAdapterReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

export function clearResumeReview(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'clear-resume-review input');
  exactKeys(source, ['readiness_evidence'], 'clear-resume-review input');
  const readinessEvidence = textList(source.readiness_evidence, 'readiness_evidence', false);
  const current = readCanonicalCurrentTask(root);
  if (!current.runtimeState.resume_requires_review) {
    fail('RESUME_REVIEW_NOT_REQUIRED', 'clear-resume-review requires an active resume-review gate.');
  }
  const evidenceDigest = crypto.createHash('sha256').update(JSON.stringify(readinessEvidence)).digest('hex');
  const evidenceRefs = [`adapter:resume-readiness:${evidenceDigest.slice(0, 16)}`];
  const proposal = createPrepareTaskResumeReviewProposal(current, {
    mode: 'default',
    evidence_refs: evidenceRefs,
    idempotency_key: `clear-resume-review-${current.runtimeState.task_id}-${current.sourceTuple.revision.slice(0, 16)}-${evidenceDigest.slice(0, 12)}`,
    authority_evidence: authority(current, current.runtimeState.task_id, ['active-task-owner', 'resume-review', 'evidence-admission']),
  });
  return verifyAdapterReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

export function replan(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const semantic = normalizeSemanticDraft(input);
  const current = readCanonicalCurrentTask(root);
  const digest = semanticDigest(semantic);
  const evidenceRefs = [`adapter:replan:${digest.slice(0, 16)}`];
  const proposal = createPrepareTaskReplanProposal(current, {
    delta: {
      kind: 'task-state',
      action: 'commit-replan',
      replacement_definition: semanticDraftDefinition(semantic),
      active_step_id: semantic.implementation_steps[0]!.id,
      evidence_refs: evidenceRefs,
      claim_evidence: claimEvidence(semantic),
    },
    idempotency_key: `replan-${current.runtimeState.task_id}-${current.sourceTuple.revision.slice(0, 12)}-${digest.slice(0, 12)}`,
    authority_evidence: authority(current, current.runtimeState.task_id, ['active-task-owner', 'scope-admission', 'evidence-admission']),
    evidence_refs: evidenceRefs,
  });
  return verifyAdapterReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

export type PrepareTaskAdapterCliArguments = {
  command: PrepareTaskAdapterCommand;
  root: string;
  dryRun: boolean;
};

export function parsePrepareTaskAdapterCli(argv: string[]): PrepareTaskAdapterCliArguments {
  const [command, ...rest] = argv;
  if (!PREPARE_TASK_ADAPTER_COMMANDS.includes(command as PrepareTaskAdapterCommand)) {
    throw new Error(`Usage: vnext-runtime <${PREPARE_TASK_ADAPTER_COMMANDS.join('|')}> --root <path> [--dry-run] (semantic JSON on stdin)`);
  }
  let root = process.cwd();
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') root = rest[++index] ?? '';
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown prepare-task adapter argument: ${arg}`);
  }
  if (!root) throw new Error('--root requires a path.');
  return { command: command as PrepareTaskAdapterCommand, root, dryRun };
}

function readSemanticStdin(command: PrepareTaskAdapterCommand): unknown {
  const raw = !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '';
  if (!raw.trim()) {
    if (command === 'confirm-draft') return {};
    throw new Error(`${command} requires semantic JSON on stdin.`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${command} stdin must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateInstalledRuntime(root: string): void {
  const runtimeManifest = path.join(path.resolve(root), ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split('/'), 'package.json');
  if (fs.existsSync(runtimeManifest)) validateVNextRuntimeContract(root, true);
}

export async function runPrepareTaskAdapterCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    validateRuntimeEnvironment();
    const args = parsePrepareTaskAdapterCli(argv);
    validateInstalledRuntime(args.root);
    const input = readSemanticStdin(args.command);
    const options = { dryRun: args.dryRun };
    let result: RuntimeResult;
    switch (args.command) {
      case 'prepare-draft':
        result = prepareDraft(args.root, input, options);
        break;
      case 'confirm-draft':
        result = confirmDraft(args.root, input, options);
        break;
      case 'clear-resume-review':
        result = clearResumeReview(args.root, input, options);
        break;
      case 'replan':
        result = replan(args.root, input, options);
        break;
    }
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'blocked' || result.status === 'conflict' ? 2 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
