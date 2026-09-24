type RecoveryResult = {
  committed?: boolean;
  recovery_route?: { command: string; action?: string };
  policy_route?: { command: string; effect?: string };
};

function executableRoute(route: { command: string; action?: string }) {
  // Kernel routes may name a public capability. The driver exposes only its
  // corresponding internal CLI operation, never another public Skill call.
  if (route.command === 'prepare-task:amend-scope') return { ...route, command: 'prepare-scope-amendment' };
  if (route.command === 'review-change') return { ...route, command: 'review-context' };
  return route;
}

/** An executable first step, followed by agent judgement from the refreshed facts. */
function recoveryRoute(code: string, result?: RecoveryResult) {
  if (result?.committed === true) return { command: 'task-context', action: 'read-back-committed-operation' };
  if (result?.recovery_route) return executableRoute(result.recovery_route);
  if (result?.policy_route) return executableRoute({ command: result.policy_route.command, action: result.policy_route.effect ?? 'bind-existing-decision' });
  if (code === 'RETRY_SCOPE_BLOCKED') return { command: 'preflight-step', action: 'cover-diagnosed-repair-paths' };
  if (code === 'RETRY_DIAGNOSIS_REQUIRED') return { command: 'retry-step', action: 'correct-evidence-backed-diagnosis' };
  if (code === 'PREFLIGHT_BLOCKED') return { command: 'task-context', action: 'inspect-blocked-step-and-retry' };
  if (code === 'MUTATION_AUTHORITY_VERSION_REQUIRED') return { command: 'task-context', action: 'select-current-task-version-recovery' };
  if (code === 'MUTATION_AUTHORITY_PROJECT_REQUIRED' || code === 'MUTATION_AUTHORITY_DOMAIN_REVISION_STALE'
    || code === 'MUTATION_AUTHORITY_DOMAIN_REVISION_REQUIRED'
    || code === 'MUTATION_AUTHORITY_EXPANSION_REQUIRED' || code.startsWith('AUTHORITY_DOMAIN_')) {
    return { command: 'authority-domain-context', action: 'inspect-project-map-and-task-binding-before-owner-confirmed-recovery' };
  }
  if (code === 'RETRY_REVIEW_REQUIRED') return { command: 'record-user-decision', action: 'bind-current-review-retry' };
  if (code === 'REPAIR_BUDGET_EXHAUSTED' || code === 'NEW_FINDING_WAVE_BUDGET_EXHAUSTED') {
    return { command: 'extend-repair-budget', action: 'reassess-failures-and-extend-current-review' };
  }
  if (code === 'EXECUTE_SCOPE_BLOCKED') return { command: 'task-context', action: 'compare-requested-path-with-current-authority' };
  if (/BUDGET|LIMIT|QUOTA/u.test(code)) return { command: 'task-context', action: 'reassess-budget-and-continue-in-scope' };
  return { command: 'task-context', action: 'classify-current-state-and-supported-recovery' };
}

/** Shared host guidance: rejection of an operation does not terminate its Skill. */
export function entryRecovery(code: string, result?: RecoveryResult) {
  const route = recoveryRoute(code, result);
  return {
    kind: 'entry-recovery/v1' as const,
    code,
    owner: 'invoking-skill' as const,
    operation_state: result?.committed === true ? 'committed-recovery-required' : 'inspect-retained-transaction',
    skill_terminal: false as const,
    recovery_route: { kind: 'entry-recovery-operation/v1' as const, ...route },
    next_action: route.action,
    resume: 'original-invocation-intent',
    ask_user_when: 'a-required-choice-or-authority-is-not-determined-by-existing-instructions',
    preserve: ['failed-evidence', 'findings', 'attempt-history', 'atomic-commit-state'],
  };
}

export function formatEntryRecoveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
  if (!code) return message;
  // Keep the original first line for existing CLI consumers.
  const result = error !== null && typeof error === 'object' && 'runtime_result' in error
    ? error.runtime_result as { committed?: boolean } : undefined;
  return `${message}\n${JSON.stringify({ ...(result ? { runtime_result: result } : {}), entry_recovery: entryRecovery(code, result) })}`;
}

/** Preserve the kernel's code, routes and commit facts across adapter boundaries. */
export function throwRuntimeResult(result: { code?: string; message: string; committed?: boolean }, fallbackCode: string): never {
  const error = Object.assign(new Error(result.message), {
    code: result.code ?? fallbackCode, runtime_result: result,
  });
  throw error;
}
