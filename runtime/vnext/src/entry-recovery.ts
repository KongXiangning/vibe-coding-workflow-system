/** Shared host guidance: rejection of an operation does not terminate its Skill. */
export function entryRecovery(code: string, result?: { committed?: boolean }) {
  return {
    kind: 'entry-recovery/v1' as const,
    code,
    owner: 'invoking-skill' as const,
    operation_state: result?.committed === true ? 'committed-recovery-required' : 'inspect-retained-transaction',
    skill_terminal: false as const,
    next_action: /BUDGET|LIMIT|QUOTA/u.test(code)
      ? 'reassess-and-record-in-scope-continuation'
      : 'inspect-current-state-and-use-supported-recovery',
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
