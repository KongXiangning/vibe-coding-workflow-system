/** Task-state proposal factory exposed by the project-local Runtime. */

export {
  createPrepareTaskConfirmProposal,
  createPrepareTaskCreateDraftProposal,
  createPrepareTaskDraftProposal,
  createPrepareTaskReplanProposal,
  createPrepareTaskUpdateDraftProposal,
  createTaskStateProposal,
} from './kernel';
export type {
  AuthorityEvidence,
  DraftTaskDefinition,
  DraftTaskIdentity,
  ReplanTaskStateAction,
  ReplanDelta,
  ReplanReplacementDefinition,
  RuntimeProposal,
  TaskStateDelta,
  VNextExecuteStepMode,
  StepStatus,
} from './kernel';
