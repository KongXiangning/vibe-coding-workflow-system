/**
 * Unified execution target admission.
 *
 * This module answers one narrow Runtime question: can this exact repository
 * path enter the current execution attempt?  It deliberately does not decide
 * whether a blast-radius assessment is semantically true; that remains the
 * bounded engineering judgement recorded by the caller.
 */

import {
  evaluateMutationAuthority,
  isMutationAuthorityGovernanceBoundary,
  normalizeAuthorityPath,
  type BlastRadiusAssessment,
  type ProjectMutationAuthority,
  type TaskMutationAuthority,
} from './mutation-authority';
import {
  evaluateMutationScope,
  isLikelyPersistentTestPath,
  mutationScopePatternMatchesPath,
  type MutationScope,
  type ConditionalScopeAuthorization,
} from './mutation-scope';

export const EXECUTION_ADMISSION_CLASSIFICATIONS = [
  'planned-admitted',
  'dynamic-self-admitted',
  'persistent-test-admitted',
  'blocked-authority',
  'blocked-assessment',
  'blocked-test-strategy',
  'blocked-persistent-test',
  'blocked-non-executable-policy',
  'blocked-governance',
] as const;
export type ExecutionAdmissionClassification = (typeof EXECUTION_ADMISSION_CLASSIFICATIONS)[number];

export type ExecutionAdmissionPhase =
  | 'flexible'
  | 'test-first'
  | 'red'
  | 'green'
  | 'implementation-first'
  | 'not-applicable'
  | 'legacy';

export type ExecutionAdmissionMode = 'default' | 'repair';

export type ExecutionTargetAdmission = {
  path: string;
  classification: ExecutionAdmissionClassification;
  admitted: boolean;
  dynamic_review_required: boolean;
  domain: string | null;
  reason: string;
  assessment?: BlastRadiusAssessment;
  first_touch_state?: 'file' | 'absent' | 'symlink';
};

export type ExecutionAdmissionEvaluation = {
  status: 'pass' | 'blocked';
  decisions: ExecutionTargetAdmission[];
  dynamic_review_required: boolean;
  blockers: string[];
};

export type ExecutionAdmissionInput = {
  version: 1 | 2;
  root?: string;
  project_authority?: ProjectMutationAuthority | null;
  task_authority?: TaskMutationAuthority | null;
  legacy_scope?: MutationScope | null;
  conditional_authorizations?: readonly ConditionalScopeAuthorization[];
  step_planned_targets: readonly string[];
  step_mutation_scope: readonly string[];
  target: string;
  assessments?: readonly BlastRadiusAssessment[];
  persistent_test_paths?: readonly string[];
  non_executable_change_paths?: readonly string[];
  phase: ExecutionAdmissionPhase;
  mode: ExecutionAdmissionMode;
  governance_paths?: readonly string[];
};

export type ExecutionAdmissionBatchInput = Omit<ExecutionAdmissionInput, 'target'> & {
  targets: readonly string[];
};

function blocked(
  path: string,
  classification: ExecutionAdmissionClassification,
  reason: string,
  domain: string | null = null,
  firstTouchState?: ExecutionTargetAdmission['first_touch_state'],
  assessment?: BlastRadiusAssessment,
): ExecutionTargetAdmission {
  return {
    path,
    classification,
    admitted: false,
    dynamic_review_required: false,
    domain,
    reason,
    ...(firstTouchState === undefined ? {} : { first_touch_state: firstTouchState }),
    ...(assessment === undefined ? {} : { assessment }),
  };
}

function admitted(
  path: string,
  classification: ExecutionAdmissionClassification,
  reason: string,
  domain: string | null,
  firstTouchState: ExecutionTargetAdmission['first_touch_state'],
  dynamicReviewRequired = false,
  assessment?: BlastRadiusAssessment,
): ExecutionTargetAdmission {
  return {
    path,
    classification,
    admitted: true,
    dynamic_review_required: dynamicReviewRequired,
    domain,
    reason,
    ...(firstTouchState === undefined ? {} : { first_touch_state: firstTouchState }),
    ...(assessment === undefined ? {} : { assessment }),
  };
}

function blockerForDecision(
  target: string,
  decision: ReturnType<typeof evaluateMutationAuthority>['decisions'][number] | undefined,
  blockers: readonly string[],
): ExecutionTargetAdmission {
  const firstTouchState = decision?.first_touch_state;
  const domain = decision?.domain ?? null;
  const assessment = decision?.assessment;
  const matchingBlocker = blockers.find(item => item.includes(`: ${target}`)) ?? blockers.find(item => item.includes(target));
  if (matchingBlocker?.startsWith('MUTATION_AUTHORITY_FORBIDDEN')
    || matchingBlocker?.startsWith('MUTATION_AUTHORITY_GOVERNANCE_BOUNDARY')) {
    return blocked(target, 'blocked-governance', decision?.reason ?? matchingBlocker, domain, firstTouchState, assessment);
  }
  if (matchingBlocker?.startsWith('PERSISTENT_TEST_UNADMITTED')) {
    return blocked(target, 'blocked-persistent-test', decision?.reason ?? matchingBlocker, domain, firstTouchState, assessment);
  }
  if (decision?.reason.includes('blast-radius assessment') || decision?.reason.includes('assessment escalates')) {
    return blocked(target, 'blocked-assessment', decision.reason, domain, firstTouchState, assessment);
  }
  return blocked(target, 'blocked-authority', decision?.reason ?? matchingBlocker ?? 'target is not admitted by the current mutation authority', domain, firstTouchState, assessment);
}

function strategyAdmission(input: ExecutionAdmissionInput, target: string): ExecutionTargetAdmission | null {
  if (input.phase === 'not-applicable') {
    const boundaries = input.non_executable_change_paths ?? [];
    if (boundaries.length === 0 || !boundaries.some(boundary => {
      try { return mutationScopePatternMatchesPath(target, boundary); } catch { return false; }
    })) {
      return blocked(target, 'blocked-non-executable-policy', 'not-applicable execution may mutate only the project non-executable boundary.');
    }
  }
  if (input.phase === 'red' && !(input.persistent_test_paths ?? []).includes(target)) {
    return blocked(target, 'blocked-test-strategy', 'test-first Red execution admits only frozen Persistent Tests; product targets require the later execution phase.');
  }
  return null;
}

function evaluateV1(input: ExecutionAdmissionInput, target: string): ExecutionTargetAdmission {
  const scope = input.legacy_scope;
  if (!scope) return blocked(target, 'blocked-authority', 'v1 execution admission requires the canonical mutation scope.');
  const result = evaluateMutationScope(scope, { changed_paths: [target], conditional_authorizations: [...(input.conditional_authorizations ?? [])] });
  const decision = result.decisions[0];
  if (result.status !== 'pass' || !decision?.mutation_admitted) {
    const classification = decision?.classification === 'persistent-test-unadmitted'
      ? 'blocked-persistent-test'
      : decision?.classification === 'forbidden'
        ? 'blocked-governance'
        : 'blocked-authority';
    return blocked(target, classification, decision?.reason ?? (result.blockers.join(' ') || 'target is outside v1 task scope.'));
  }
  if (!input.step_mutation_scope.some(pattern => mutationScopePatternMatchesPath(target, pattern))) {
    return blocked(target, 'blocked-authority', 'target is outside the current v1 step mutation scope.');
  }
  const persistent = isLikelyPersistentTestPath(target) || input.persistent_test_paths?.includes(target) === true;
  return admitted(target, persistent && input.persistent_test_paths?.includes(target) === true ? 'persistent-test-admitted' : 'planned-admitted', 'target is admitted by the v1 task and current-step scope.', null, undefined);
}

function evaluateV2(input: ExecutionAdmissionInput, target: string): ExecutionTargetAdmission {
  const project = input.project_authority;
  const task = input.task_authority;
  if (!project || !task) return blocked(target, 'blocked-authority', 'v2 execution admission requires the project domain map and task authority envelope.');
  const result = evaluateMutationAuthority({
    root: input.root,
    project,
    task,
    candidate_paths: [target],
    planned_targets: input.step_planned_targets,
    assessments: input.assessments ?? [],
    persistent_test_paths: input.persistent_test_paths ?? [],
  });
  const decision = result.decisions[0];
  if (result.status !== 'pass' || !decision || decision.status === 'blocked') {
    return blockerForDecision(target, decision, result.blockers);
  }
  const isNewPersistentTest = (input.persistent_test_paths ?? []).includes(target)
    && decision.first_touch_state === 'absent';
  const classification = decision.status === 'self-admitted'
    ? 'dynamic-self-admitted'
    : isNewPersistentTest
      ? 'persistent-test-admitted'
      : 'planned-admitted';
  return admitted(
    target,
    classification,
    decision.reason,
    decision.domain,
    decision.first_touch_state,
    result.dynamic_review_required,
    decision.assessment,
  );
}

export function evaluateExecutionTargetAdmission(input: ExecutionAdmissionInput): ExecutionTargetAdmission {
  let target: string;
  try {
    target = input.version === 2
      ? normalizeAuthorityPath(input.target, 'execution admission target')
      : input.target;
  } catch (error) {
    return blocked(input.target, 'blocked-authority', error instanceof Error ? error.message : String(error));
  }
  const explicitlyForbidden = input.task_authority?.forbidden.some(pattern => {
    try { return mutationScopePatternMatchesPath(target, pattern); } catch { return false; }
  }) ?? input.legacy_scope?.forbidden.some(pattern => {
    try { return mutationScopePatternMatchesPath(target, pattern.pattern); } catch { return false; }
  }) ?? false;
  if (explicitlyForbidden) {
    return blocked(target, 'blocked-governance', 'target is explicitly forbidden by the current task.');
  }
  if (isMutationAuthorityGovernanceBoundary(target) || input.governance_paths?.includes(target)) {
    return blocked(target, 'blocked-governance', 'target is a Runtime/governance boundary.');
  }
  const strategyBlock = strategyAdmission(input, target);
  if (strategyBlock) return strategyBlock;
  return input.version === 2 ? evaluateV2(input, target) : evaluateV1(input, target);
}

export function evaluateExecutionTargetAdmissions(input: ExecutionAdmissionBatchInput): ExecutionAdmissionEvaluation {
  const decisions = input.targets.map(target => evaluateExecutionTargetAdmission({ ...input, target }));
  const blockers = decisions.filter(decision => !decision.admitted).map(decision => `${decision.classification}: ${decision.path} — ${decision.reason}`);
  if (input.phase === 'red') {
    const persistentTests = input.persistent_test_paths ?? [];
    const missingTests = persistentTests.filter(testPath => !input.targets.includes(testPath));
    if (missingTests.length > 0) {
      blockers.push(`blocked-test-strategy: Red execution must include every frozen persistent test: ${missingTests.join(', ')}`);
    }
  }
  return {
    status: blockers.length === 0 ? 'pass' : 'blocked',
    decisions,
    dynamic_review_required: decisions.some(decision => decision.dynamic_review_required),
    blockers,
  };
}
