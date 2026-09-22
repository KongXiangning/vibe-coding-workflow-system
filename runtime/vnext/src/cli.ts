import { runEntryOutputReadCli } from './entry-output';
import { runEntryRunnerCli } from './entry-runner';
import { runCli } from './kernel';
import { runBootstrapCli } from './bootstrap';
import { runBootstrapSupportCli } from './bootstrap-support';
import { PREPARE_TASK_ADAPTER_COMMANDS, runPrepareTaskAdapterCli } from './prepare-task-adapter';
import { EXECUTE_STEP_ADAPTER_COMMANDS, runExecuteStepAdapterCli } from './execute-step-adapter';
import { REVIEW_CHANGE_ADAPTER_COMMANDS, runReviewChangeAdapterCli } from './review-change-adapter';
import { runFileContextCli } from './file-context-cli';
import { runTaskContextCli } from './task-context';
import { USER_DECISION_ADAPTER_COMMANDS, runUserDecisionAdapterCli } from './user-decision-adapter';

export { runCli, runBootstrapCli, runBootstrapSupportCli, runPrepareTaskAdapterCli, runExecuteStepAdapterCli, runReviewChangeAdapterCli, runTaskContextCli, runUserDecisionAdapterCli };

const args = process.argv.slice(2);
let runner: Promise<number>;
if (args[0] === 'entry-output-read') runner = runEntryOutputReadCli();
else if (args[0] === 'run-entry') runner = runEntryRunnerCli(args, [
  ...PREPARE_TASK_ADAPTER_COMMANDS, ...EXECUTE_STEP_ADAPTER_COMMANDS,
  ...REVIEW_CHANGE_ADAPTER_COMMANDS, ...USER_DECISION_ADAPTER_COMMANDS,
  'apply', 'validate', 'validate-contract', 'scope-check', 'task-context', 'task-read', 'file-context',
  'task-storage-migration', 'task-export', 'bootstrap-project', 'bootstrap-support',
]);
else if (args[0] === 'file-context') runner = runFileContextCli(args.slice(1));
else if (args[0] === 'task-context' || args[0] === 'task-read' || args[0] === 'task-storage-migration' || args[0] === 'task-migrate' || args[0] === 'task-export') {
  runner = runTaskContextCli(args[0] === 'task-migrate' ? 'task-storage-migration' : args[0], args.slice(1));
}
else if (args[0] === 'bootstrap-project') runner = runBootstrapCli(args.slice(1));
else if (args[0] === 'bootstrap-support') runner = runBootstrapSupportCli(args.slice(1));
else if (PREPARE_TASK_ADAPTER_COMMANDS.includes(args[0] as (typeof PREPARE_TASK_ADAPTER_COMMANDS)[number])) {
  runner = runPrepareTaskAdapterCli(args);
} else if (EXECUTE_STEP_ADAPTER_COMMANDS.includes(args[0] as (typeof EXECUTE_STEP_ADAPTER_COMMANDS)[number])) {
  runner = runExecuteStepAdapterCli(args);
} else if (REVIEW_CHANGE_ADAPTER_COMMANDS.includes(args[0] as (typeof REVIEW_CHANGE_ADAPTER_COMMANDS)[number])) {
  runner = runReviewChangeAdapterCli(args);
} else if (USER_DECISION_ADAPTER_COMMANDS.includes(args[0] as (typeof USER_DECISION_ADAPTER_COMMANDS)[number])) {
  runner = runUserDecisionAdapterCli(args);
} else runner = runCli(args);

runner.then((exitCode) => {
  process.exitCode = exitCode;
});
