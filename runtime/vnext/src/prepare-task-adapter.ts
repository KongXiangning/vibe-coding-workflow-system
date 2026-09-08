/**
 * Human-semantic adapter for prepare-task.
 *
 * The public entry accepts task design content only. Runtime-owned proposal
 * fields, source coordinates, identity allocation, evidence-plan scaffolding,
 * write targets, commit, and read-back remain inside this module and the
 * transaction kernel. Caller authority enters only through exact receipts.
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
  readCanonicalTaskBasis,
  readDraftDefinitionFromBody,
  validateRuntimeEnvironment,
  validateVNextRuntimeContract,
  type AuthorityEvidence,
  type CanonicalCurrentTask,
  type ClaimEvidenceRecord,
  type DraftTaskDefinition,
  type RuntimeApplyOptions,
  type RuntimeResult,
  type TaskBasis,
} from './kernel';
import {
  evaluateCommandWriteFootprint,
  evaluateMutationScope,
  isLikelyPersistentTestPath,
  mutationScopePatternMatchesPath,
  parseMutationScope,
  type MutationTransformationKind,
} from './mutation-scope';
import { extractTaskIdentityFromCurrentTask } from './task-identity';

export const PREPARE_TASK_ADAPTER_COMMANDS = [
  'prepare-draft',
  'confirm-draft',
  'clear-resume-review',
  'replan',
] as const;

export type PrepareTaskAdapterCommand = (typeof PREPARE_TASK_ADAPTER_COMMANDS)[number];

export type PrepareTaskStepCommand = {
  command: string;
  expected_repo_writes: 'none' | string[];
};

export type PrepareTaskSemanticDraft = {
  task_basis: TaskBasis;
  goal: string;
  acceptance: string[];
  out_of_scope: string[];
  design_decisions: {
    decided: string[];
    unresolved: string[];
  };
  mutation_scope: {
    allowed: string[];
    conditional: Array<{ path: string; condition: string }>;
    forbidden: string[];
  };
  implementation_steps: Array<{
    id: string;
    description: string;
    mutation_scope: string[];
    commands: PrepareTaskStepCommand[];
    validation: string[];
  }>;
  validation_plan: string[];
  persistent_tests: 'none' | Array<{
    path: string;
    proves: string[];
  }>;
};

export type PrepareTaskResumeReviewInput = {
  readiness_receipt: ResumeReadinessReceipt;
};

export type DraftConfirmationReceipt = {
  kind: 'prepare-draft-confirmation/v1';
  task_id: string;
  document_id: string;
  draft_revision: string;
};

export type ConfirmDraftInput = {
  confirmation_receipt: DraftConfirmationReceipt;
};

export type ResumeReadinessReceipt = {
  kind: 'resume-readiness/v1';
  task_id: string;
  document_id: string;
  source_revision: string;
  reviewed_reasons: string[];
  evidence_refs: string[];
};

export type PrepareDraftResult = RuntimeResult & {
  confirmation_receipt?: DraftConfirmationReceipt;
};

type JsonRecord = Record<string, unknown>;

const SEMANTIC_DRAFT_FIELDS = [
  'task_basis',
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

function verbatim(value: unknown, location: string, maximumLength = 32768): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /\0/u.test(value)) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be non-empty verbatim text of at most ${maximumLength} characters.`);
  }
  return value;
}

function normalizeTaskBasisSource(value: unknown, location: string): TaskBasis['original_request'] {
  const source = record(value, location);
  exactKeys(source, ['source', 'verbatim'], location);
  return {
    source: text(source.source, `${location}.source`, 1024),
    verbatim: verbatim(source.verbatim, `${location}.verbatim`),
  };
}

function normalizeTaskBasis(value: unknown): TaskBasis {
  const basis = record(value, 'task_basis');
  exactKeys(basis, ['original_request', 'user_decisions'], 'task_basis');
  if (!Array.isArray(basis.user_decisions) || basis.user_decisions.length > 64) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'task_basis.user_decisions must be a bounded array.');
  }
  const userDecisions = basis.user_decisions.map((item, index) =>
    normalizeTaskBasisSource(item, `task_basis.user_decisions[${index}]`));
  const keys = userDecisions.map(item => `${item.source}\0${item.verbatim}`);
  if (new Set(keys).size !== keys.length) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'task_basis.user_decisions must not contain duplicate source excerpts.');
  }
  return {
    original_request: normalizeTaskBasisSource(basis.original_request, 'task_basis.original_request'),
    user_decisions: userDecisions,
  };
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

function sha256Revision(value: unknown, location: string): string {
  const normalized = text(value, location, 64);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be a SHA-256 revision.`);
  }
  return normalized;
}

function normalizeConfirmationReceipt(input: unknown): DraftConfirmationReceipt {
  const source = record(input, 'confirmation_receipt');
  exactKeys(source, ['kind', 'task_id', 'document_id', 'draft_revision'], 'confirmation_receipt');
  if (source.kind !== 'prepare-draft-confirmation/v1') {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'confirmation_receipt.kind must be prepare-draft-confirmation/v1.');
  }
  return {
    kind: source.kind,
    task_id: text(source.task_id, 'confirmation_receipt.task_id', 128),
    document_id: text(source.document_id, 'confirmation_receipt.document_id', 128),
    draft_revision: sha256Revision(source.draft_revision, 'confirmation_receipt.draft_revision'),
  };
}

function normalizeResumeReadinessReceipt(input: unknown): ResumeReadinessReceipt {
  const source = record(input, 'readiness_receipt');
  exactKeys(
    source,
    ['kind', 'task_id', 'document_id', 'source_revision', 'reviewed_reasons', 'evidence_refs'],
    'readiness_receipt',
  );
  if (source.kind !== 'resume-readiness/v1') {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'readiness_receipt.kind must be resume-readiness/v1.');
  }
  return {
    kind: source.kind,
    task_id: text(source.task_id, 'readiness_receipt.task_id', 128),
    document_id: text(source.document_id, 'readiness_receipt.document_id', 128),
    source_revision: sha256Revision(source.source_revision, 'readiness_receipt.source_revision'),
    reviewed_reasons: textList(source.reviewed_reasons, 'readiness_receipt.reviewed_reasons', false),
    evidence_refs: textList(source.evidence_refs, 'readiness_receipt.evidence_refs', false),
  };
}

function normalizeStepCommands(value: unknown, location: string): PrepareTaskStepCommand[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', `${location} must be a bounded array.`);
  }
  return value.map((item, index) => {
    const itemLocation = `${location}[${index}]`;
    const candidate = record(item, itemLocation);
    exactKeys(candidate, ['command', 'expected_repo_writes'], itemLocation);
    if (candidate.expected_repo_writes === 'none') {
      return {
        command: text(candidate.command, `${itemLocation}.command`),
        expected_repo_writes: 'none',
      };
    }
    const expectedRepoWrites = normalizeScopePathList(candidate.expected_repo_writes, `${itemLocation}.expected_repo_writes`);
    if (expectedRepoWrites.length === 0) {
      fail('PREPARE_ADAPTER_INPUT_INVALID', `${itemLocation}.expected_repo_writes must be none or a non-empty bounded array.`);
    }
    return {
      command: text(candidate.command, `${itemLocation}.command`),
      expected_repo_writes: expectedRepoWrites,
    };
  });
}

function commandTransformationKind(command: PrepareTaskStepCommand): MutationTransformationKind {
  return command.expected_repo_writes !== 'none' && command.expected_repo_writes.some(item => item.includes('*'))
    ? 'inherently-broad'
    : 'localized';
}

function stepScopeAdmitsCommandTarget(target: string, stepScope: readonly string[]): boolean {
  return target.includes('*')
    ? stepScope.includes(target)
    : stepScope.some(pattern => mutationScopePatternMatchesPath(target, pattern));
}

function normalizeSemanticDraft(input: unknown): PrepareTaskSemanticDraft {
  const source = record(input, 'prepare-task semantic draft');
  exactKeys(source, SEMANTIC_DRAFT_FIELDS, 'prepare-task semantic draft');

  const designDecisions = record(source.design_decisions, 'design_decisions');
  exactKeys(designDecisions, ['decided', 'unresolved'], 'design_decisions');
  const decided = textList(designDecisions.decided, 'design_decisions.decided', true);
  const unresolved = textList(designDecisions.unresolved, 'design_decisions.unresolved', true);
  const duplicatedDecisions = decided.filter(item => unresolved.includes(item));
  if (duplicatedDecisions.length > 0) {
    fail('PREPARE_ADAPTER_INPUT_INVALID', 'a design decision cannot be both decided and unresolved.');
  }

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
    exactKeys(step, ['id', 'description', 'mutation_scope', 'commands', 'validation'], `implementation_steps[${index}]`);
    const id = text(step.id, `implementation_steps[${index}].id`, 128);
    if (!STEP_ID_PATTERN.test(id)) fail('PREPARE_ADAPTER_INPUT_INVALID', `implementation_steps[${index}].id is invalid.`);
    return {
      id,
      description: text(step.description, `implementation_steps[${index}].description`),
      mutation_scope: normalizeScopePathList(step.mutation_scope, `implementation_steps[${index}].mutation_scope`),
      commands: normalizeStepCommands(step.commands, `implementation_steps[${index}].commands`),
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
    task_basis: normalizeTaskBasis(source.task_basis),
    goal: text(source.goal, 'goal', 512),
    acceptance: textList(source.acceptance, 'acceptance', false),
    out_of_scope: textList(source.out_of_scope, 'out_of_scope', true),
    design_decisions: { decided, unresolved },
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
  const persistentTests = input.persistent_tests === 'none'
    ? ['- none']
    : input.persistent_tests.map(test => `- \`${test.path}\``);
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
    '## 回归检查项',
    '',
    '### Persistent Tests',
    '',
    ...persistentTests,
    '',
  ].join('\n');
}

function assertSemanticScopeIsExecutable(input: PrepareTaskSemanticDraft): void {
  const scope = parseMutationScope(scopeBody(input));
  const persistentTests = input.persistent_tests === 'none' ? [] : input.persistent_tests;
  const persistentTestPaths = new Set(persistentTests.map(test => test.path));
  const allowedExact = new Set(input.mutation_scope.allowed.filter(item => !item.includes('*')));
  for (const test of persistentTests) {
    if (!allowedExact.has(test.path)) {
      fail('PERSISTENT_TEST_SCOPE_INVALID', `persistent test ${test.path} must also appear as an exact mutation_scope.allowed entry.`);
    }
  }
  const testLikeScopeEntries = [
    ...input.mutation_scope.allowed,
    ...input.mutation_scope.conditional.map(item => item.path),
  ].filter(isLikelyPersistentTestPath);
  for (const entry of testLikeScopeEntries) {
    if (entry.includes('*') || !persistentTestPaths.has(entry)) {
      fail('PERSISTENT_TEST_SCOPE_INVALID', `test-like mutation scope entry ${entry} is not an exact path in persistent_tests.`);
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
    for (const [commandIndex, command] of step.commands.entries()) {
      if (command.expected_repo_writes === 'none') continue;
      const outsideStepScope = command.expected_repo_writes.filter(target => !stepScopeAdmitsCommandTarget(target, step.mutation_scope));
      if (outsideStepScope.length > 0) {
        fail(
          'COMMAND_FOOTPRINT_BLOCKED',
          `step ${step.id} command "${command.command}" writes outside the step mutation scope: ${outsideStepScope.join(', ')}.`,
        );
      }
      const result = evaluateCommandWriteFootprint(scope, {
        command: command.command,
        expected_write_footprint: {
          kind: 'bounded',
          targets: command.expected_repo_writes,
          evidence_refs: [`adapter:prepare-draft:command:${step.id}:${commandIndex + 1}`],
        },
        transformation_kind: commandTransformationKind(command),
      });
      if (result.status !== 'pass') {
        fail(
          'COMMAND_FOOTPRINT_BLOCKED',
          `step ${step.id} command "${command.command}" has no executable repository-write plan: ${result.blockers.join(' ')}`,
        );
      }
    }
  }
}

function semanticDigest(input: PrepareTaskSemanticDraft): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function adapterIdempotencyKey(prefix: string, value: unknown): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return `${prefix}-${digest.slice(0, 48)}`;
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
    confirmed_decisions: markdownBullets(input.design_decisions.decided),
    open_questions: markdownBullets(input.design_decisions.unresolved),
    implementation_plan: input.implementation_steps.map(step => `- ${step.id}: ${step.description}`).join('\n'),
    implementation_steps: input.implementation_steps.flatMap(step => [
      `- ${step.id}: ${step.description}`,
      `  - purpose: ${step.description}`,
      `  - mutation_scope: ${step.mutation_scope.join(', ')}`,
      `  - required_evidence: ${step.validation.join('; ')}`,
      `  - review_checkpoint: required: review ${step.id} diff against the confirmed CURRENT_TASK`,
      ...step.commands.flatMap(item => [
        `  - planned_command: ${item.command}`,
        `    - expected_repo_writes: ${item.expected_repo_writes === 'none' ? 'none' : item.expected_repo_writes.join(', ')}`,
        `    - transformation_kind: ${commandTransformationKind(item)}`,
      ]),
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

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function currentMatchesSemanticDraft(root: string, current: CanonicalCurrentTask, semantic: PrepareTaskSemanticDraft): boolean {
  let basisMatches = false;
  try {
    basisMatches = sameValue(readCanonicalTaskBasis(root, current).basis, semantic.task_basis);
  } catch {
    basisMatches = false;
  }
  return current.runtimeState.active_step_id === semantic.implementation_steps[0]!.id
    && basisMatches
    && sameValue(readDraftDefinitionFromBody(current.body), semanticDraftDefinition(semantic))
    && sameValue(current.runtimeState.claim_evidence, claimEvidence(semantic));
}

function semanticNoOp(
  current: CanonicalCurrentTask,
  idempotencyKey: string,
  message: string,
  options: RuntimeApplyOptions = {},
): RuntimeResult {
  const state = current.runtimeState;
  return {
    status: 'no-op',
    operation_kind: 'task-state-transaction',
    idempotency_key: idempotencyKey,
    target_path: current.relativePath,
    dry_run: options.dryRun === true,
    committed: false,
    message,
    previous_revision: current.sourceTuple.revision,
    resulting_revision: current.sourceTuple.revision,
    planned_writes: [],
    governed_mutation_count: 0,
    read_back_verified: true,
    state: {
      task_id: state.task_id,
      workflow_status: state.workflow_status,
      lifecycle_state: state.lifecycle_state,
      resume_requires_review: state.resume_requires_review,
      resume_review_reasons: [...state.resume_review_reasons],
      active_step_id: state.active_step_id,
      active_step_status: state.active_step_status,
      finding_queue_revision: state.finding_queue_revision,
      review_cycle_id: state.review_cycle.id,
      repair_round: state.review_cycle.repair_round,
    },
  };
}

function confirmationReceipt(current: CanonicalCurrentTask): DraftConfirmationReceipt {
  return {
    kind: 'prepare-draft-confirmation/v1',
    task_id: current.runtimeState.task_id,
    document_id: current.sourceTuple.document_id,
    draft_revision: current.sourceTuple.revision,
  };
}

function withConfirmationReceipt(
  root: string,
  result: RuntimeResult,
  options: RuntimeApplyOptions,
): PrepareDraftResult {
  if (options.dryRun || (result.status !== 'success' && result.status !== 'no-op')) return result;
  const current = readCanonicalCurrentTask(root);
  if (current.runtimeState.workflow_status !== 'draft' || current.runtimeState.lifecycle_state !== 'active') return result;
  return { ...result, confirmation_receipt: confirmationReceipt(current) };
}

function hasAppliedProposal(current: CanonicalCurrentTask, idempotencyKey: string): boolean {
  return current.runtimeState.applied_proposals.some(item => item.idempotency_key === idempotencyKey);
}

function isCurrentConfirmationReplay(
  current: CanonicalCurrentTask,
  idempotencyKey: string,
  receipt: DraftConfirmationReceipt,
): boolean {
  const confirmationIndex = current.runtimeState.execution_log.findIndex(item =>
    'action' in item
    && item.action === 'confirm-draft'
    && item.idempotency_key === idempotencyKey
    && item.task_id === receipt.task_id
    && item.document_id === receipt.document_id
    && item.draft_revision === receipt.draft_revision,
  );
  if (confirmationIndex < 0) return false;
  return !current.runtimeState.execution_log.slice(confirmationIndex + 1).some(item =>
    'action' in item && (item.action === 'supersede' || item.action === 'commit-replan'),
  );
}

export function prepareDraft(root: string, input: unknown, options: RuntimeApplyOptions = {}): PrepareDraftResult {
  const semantic = normalizeSemanticDraft(input);
  const current = readCanonicalCurrentTask(root);
  const creating = current.runtimeState.workflow_status === 'closed' && current.runtimeState.lifecycle_state === 'archived';
  const updating = current.runtimeState.workflow_status === 'draft' && current.runtimeState.lifecycle_state === 'active';
  if (!creating && !updating) {
    fail('PREPARE_DRAFT_STATE_INVALID', 'prepare-draft requires closed + archived to create, or draft + active to update. A confirmed task must first be invalidated through the authorized task-lifecycle supersede route, then replaced with replan.');
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
  const retryKey = adapterIdempotencyKey('prepare-draft', { task_id: identity.task_id, semantic });
  if (updating && currentMatchesSemanticDraft(root, current, semantic)) {
    return withConfirmationReceipt(root, semanticNoOp(current, retryKey, 'The requested semantic draft already matches canonical CURRENT_TASK.', options), options);
  }
  const evidenceRefs = [`adapter:prepare-draft:${digest.slice(0, 16)}`];
  const proposal = createPrepareTaskDraftProposal(current, {
    action: creating ? 'create-draft' : 'update-draft',
    ...identity,
    task_basis: semantic.task_basis,
    draft_definition: semanticDraftDefinition(semantic),
    active_step_id: semantic.implementation_steps[0]!.id,
    evidence_refs: evidenceRefs,
    claim_evidence: claimEvidence(semantic),
    idempotency_key: adapterIdempotencyKey('prepare-draft-commit', {
      task_id: identity.task_id,
      source_revision: current.sourceTuple.revision,
      semantic,
    }),
    authority_evidence: authority(current, identity.task_id, creating
      ? ['authorized-caller', 'scope-admission', 'evidence-admission']
      : ['active-task-owner', 'scope-admission', 'evidence-admission']),
  });
  const result = verifyAdapterReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
  return withConfirmationReceipt(root, result, options);
}

export function confirmDraft(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'confirm-draft input');
  exactKeys(source, ['confirmation_receipt'], 'confirm-draft input');
  const receipt = normalizeConfirmationReceipt(source.confirmation_receipt);
  const current = readCanonicalCurrentTask(root);
  const idempotencyKey = adapterIdempotencyKey('confirm-draft', receipt);
  if (receipt.task_id !== current.runtimeState.task_id || receipt.document_id !== current.sourceTuple.document_id) {
    fail('DRAFT_IDENTITY_CONFLICT', 'confirmation_receipt does not identify the current draft.');
  }
  if (hasAppliedProposal(current, idempotencyKey)) {
    if (
      current.runtimeState.workflow_status !== 'active'
      || current.runtimeState.lifecycle_state !== 'active'
      || !isCurrentConfirmationReplay(current, idempotencyKey, receipt)
    ) {
      fail('DRAFT_REVISION_CONFLICT', 'confirmation_receipt belongs to an earlier task-definition generation.');
    }
    return semanticNoOp(current, idempotencyKey, 'This exact draft confirmation was already committed.', options);
  }
  if (current.runtimeState.workflow_status !== 'draft' || current.runtimeState.lifecycle_state !== 'active') {
    fail('DRAFT_CONFIRMATION_BLOCKED', 'confirm-draft requires the current task to be draft + active.');
  }
  if (receipt.draft_revision !== current.sourceTuple.revision) {
    fail('DRAFT_REVISION_CONFLICT', `confirmation_receipt draft_revision ${receipt.draft_revision} does not match current draft revision ${current.sourceTuple.revision}.`);
  }
  const evidenceRefs = [`adapter:confirm-draft:${receipt.draft_revision.slice(0, 16)}`];
  const proposal = createPrepareTaskConfirmProposal(current, {
    task_id: receipt.task_id,
    task_slug: current.runtimeState.task_slug,
    document_id: receipt.document_id,
    draft_revision: receipt.draft_revision,
    evidence_refs: evidenceRefs,
    idempotency_key: idempotencyKey,
    authority_evidence: [
      {
        kind: 'authorized-caller',
        source: current.relativePath,
        subject: receipt.task_id,
        task_id: receipt.task_id,
        document_id: receipt.document_id,
        draft_revision: receipt.draft_revision,
      },
      ...authority(current, receipt.task_id, ['evidence-admission']),
    ],
  });
  return verifyAdapterReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

export function clearResumeReview(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const source = record(input, 'clear-resume-review input');
  exactKeys(source, ['readiness_receipt'], 'clear-resume-review input');
  const receipt = normalizeResumeReadinessReceipt(source.readiness_receipt);
  const current = readCanonicalCurrentTask(root);
  const idempotencyKey = adapterIdempotencyKey('clear-resume-review', receipt);
  if (!current.runtimeState.resume_requires_review) {
    if (hasAppliedProposal(current, idempotencyKey)) {
      return semanticNoOp(current, idempotencyKey, 'This exact resume-readiness receipt was already committed.', options);
    }
    fail('RESUME_REVIEW_NOT_REQUIRED', 'clear-resume-review requires an active resume-review gate.');
  }
  if (receipt.task_id !== current.runtimeState.task_id || receipt.document_id !== current.sourceTuple.document_id) {
    fail('RESUME_READINESS_IDENTITY_CONFLICT', 'readiness_receipt does not identify the current task document.');
  }
  if (receipt.source_revision !== current.sourceTuple.revision) {
    fail('RESUME_READINESS_REVISION_CONFLICT', `readiness_receipt source_revision ${receipt.source_revision} does not match current revision ${current.sourceTuple.revision}.`);
  }
  if (!sameValue(receipt.reviewed_reasons, current.runtimeState.resume_review_reasons)) {
    fail('RESUME_READINESS_REASON_CONFLICT', 'readiness_receipt must cover the exact current resume-review reasons.');
  }
  if (hasAppliedProposal(current, idempotencyKey)) {
    fail('RESUME_READINESS_REVISION_CONFLICT', 'readiness_receipt was committed for an earlier resume-review gate generation.');
  }
  const proposal = createPrepareTaskResumeReviewProposal(current, {
    mode: 'default',
    evidence_refs: receipt.evidence_refs,
    idempotency_key: idempotencyKey,
    authority_evidence: [
      {
        kind: 'authorized-caller',
        source: current.relativePath,
        subject: receipt.task_id,
        task_id: receipt.task_id,
        document_id: receipt.document_id,
        source_revision: receipt.source_revision,
      },
      ...authority(current, receipt.task_id, ['active-task-owner', 'resume-review', 'evidence-admission']),
    ],
  });
  return verifyAdapterReadBack(root, applyVNextRuntimeProposal(root, proposal, options), options);
}

export function replan(root: string, input: unknown, options: RuntimeApplyOptions = {}): RuntimeResult {
  const semantic = normalizeSemanticDraft(input);
  const current = readCanonicalCurrentTask(root);
  const digest = semanticDigest(semantic);
  const retryKey = adapterIdempotencyKey('replan', { task_id: current.runtimeState.task_id, semantic });
  if (
    current.runtimeState.workflow_status === 'active'
    && current.runtimeState.lifecycle_state === 'active'
    && currentMatchesSemanticDraft(root, current, semantic)
  ) {
    return semanticNoOp(current, retryKey, 'The requested replan already matches canonical CURRENT_TASK.', options);
  }
  if (current.runtimeState.workflow_status === 'active' && current.runtimeState.lifecycle_state === 'active') {
    fail('REPLAN_INVALIDATION_REQUIRED', 'replan cannot replace a confirmed active task until an authorized task-lifecycle supersede invocation has invalidated it.');
  }
  if (current.runtimeState.workflow_status === 'blocked_by_replan' && current.runtimeState.lifecycle_state === 'active') {
    fail('REPLAN_BLOCKED', 'replan is blocked by unresolved authoritative evidence; the Runtime convergence owner must clear the existing replan block first.');
  }
  if (current.runtimeState.workflow_status !== 'superseded' || current.runtimeState.lifecycle_state !== 'active') {
    fail('REPLAN_STATE_INVALID', 'replan requires an authorized superseded + active task.');
  }
  const evidenceRefs = [`adapter:replan:${digest.slice(0, 16)}`];
  const proposal = createPrepareTaskReplanProposal(current, {
    delta: {
      kind: 'task-state',
      action: 'commit-replan',
      task_basis: semantic.task_basis,
      replacement_definition: semanticDraftDefinition(semantic),
      active_step_id: semantic.implementation_steps[0]!.id,
      evidence_refs: evidenceRefs,
      claim_evidence: claimEvidence(semantic),
    },
    idempotency_key: adapterIdempotencyKey('replan-commit', {
      task_id: current.runtimeState.task_id,
      source_revision: current.sourceTuple.revision,
      semantic,
    }),
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
