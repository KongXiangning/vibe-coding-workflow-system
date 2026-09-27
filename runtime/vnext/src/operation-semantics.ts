/**
 * Operation semantics, not a second task store or an override switch.
 * The requested effect determines which qualifications may be evaluated.
 * Authority, identity, scope and truthful evidence remain independently checked.
 */
export type StepProgressIntent = 'record-execution' | 'complete-step' | 'record-progress';

export function stepProgressIntent(delta: {
  status: string;
  execution_result?: unknown;
}): StepProgressIntent {
  // Old callers may still send status=completed with a result. It is a fact
  // registration, never implicit permission to complete or advance the step.
  if (delta.execution_result !== undefined) return 'record-execution';
  return delta.status === 'completed' ? 'complete-step' : 'record-progress';
}

export function isUserTerminableState(workflow: string, lifecycle: string): boolean {
  // Identity/tuple validation still runs in the canonical reader. Do not
  // reactivate a paused, blocked or superseded task merely to terminate it.
  return (lifecycle === 'active' && ['draft', 'active', 'blocked_by_replan', 'superseded', 'replaced'].includes(workflow))
    || (workflow === 'suspended' && ['paused_pending_closure', 'paused_blocked', 'interrupted'].includes(lifecycle));
}

export function isArchiveSourceAllowed(workflow: string, lifecycle: string, disposition?: string): boolean {
  return disposition === 'stopped-by-user' || disposition === 'completed-with-exceptions'
    ? isUserTerminableState(workflow, lifecycle)
    : workflow === 'active' && lifecycle === 'active';
}
