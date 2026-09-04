import { runCli } from './kernel';
import { runBootstrapCli } from './bootstrap';
import { runBootstrapSupportCli } from './bootstrap-support';

export { runCli, runBootstrapCli, runBootstrapSupportCli };

const args = process.argv.slice(2);
const runner = args[0] === 'bootstrap-project'
  ? runBootstrapCli(args.slice(1))
  : args[0] === 'bootstrap-support'
    ? runBootstrapSupportCli(args.slice(1))
  : runCli(args);

runner.then((exitCode) => {
  process.exitCode = exitCode;
});
