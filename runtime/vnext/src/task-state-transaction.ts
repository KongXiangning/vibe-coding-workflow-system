/** Task-state proposal factory exposed by the project-local Runtime. */

export { createPrepareTaskReplanProposal, createTaskStateProposal } from './kernel';
export type {
  AuthorityEvidence,
  ReplanTaskStateAction,
  ReplanDelta,
  ReplanReplacementDefinition,
  RuntimeProposal,
  TaskStateDelta,
  VNextExecuteStepMode,
  StepStatus,
} from './kernel';
