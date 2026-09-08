import { runCli } from './kernel';
import { runBootstrapCli } from './bootstrap';
import { runBootstrapSupportCli } from './bootstrap-support';
import { PREPARE_TASK_ADAPTER_COMMANDS, runPrepareTaskAdapterCli } from './prepare-task-adapter';
import { EXECUTE_STEP_ADAPTER_COMMANDS, runExecuteStepAdapterCli } from './execute-step-adapter';

export { runCli, runBootstrapCli, runBootstrapSupportCli, runPrepareTaskAdapterCli, runExecuteStepAdapterCli };

const args = process.argv.slice(2);
let runner: Promise<number>;
if (args[0] === 'bootstrap-project') runner = runBootstrapCli(args.slice(1));
else if (args[0] === 'bootstrap-support') runner = runBootstrapSupportCli(args.slice(1));
else if (PREPARE_TASK_ADAPTER_COMMANDS.includes(args[0] as (typeof PREPARE_TASK_ADAPTER_COMMANDS)[number])) {
  runner = runPrepareTaskAdapterCli(args);
} else if (EXECUTE_STEP_ADAPTER_COMMANDS.includes(args[0] as (typeof EXECUTE_STEP_ADAPTER_COMMANDS)[number])) {
  runner = runExecuteStepAdapterCli(args);
} else runner = runCli(args);

runner.then((exitCode) => {
  process.exitCode = exitCode;
});
