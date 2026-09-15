/** Versioned recovery semantics shared by the Kernel contract validator. */
export const TASK_RECOVERY_PROTOCOL = {
  candidate: 'correction-replan-candidate/v2',
  confirmation: 'correction-replan-candidate-receipt/v2',
  modes: ['conclusion-correction', 'execution-recovery'],
  strategies: ['forward-fix', 'artifact-restore', 'mixed'],
  routing: ['unrelated', 'conclusion-counterevidence', 'execution-error', 'authority-change'],
  target_limit: 16,
  recovery_step_limit: 16,
  source: 'runtime-task-document-source-tuple-basis-and-plan',
  obligations: 'all-old-claim-slots-and-replaced-step-obligations',
  history: 'immutable-definitions-executions-and-content-addressed-evidence',
  evidence: 'evidence-carry-forward/v2-original-anchor-and-current-reception',
  artifact_checkpoint: 'artifact-checkpoint/v1',
  artifact_publication: 'exact-write-set-journal-rollback-or-fail-closed',
  concurrency: 'shared-governance-write-lock-and-source-cas',
  authority: 'caller-reported-no-permission-expansion',
  legacy: 'readable-explicit-preservation-old-receipts-rejected',
} as const;
