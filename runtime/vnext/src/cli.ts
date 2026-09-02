import { runCli } from './kernel';
import { runBootstrapCli } from './bootstrap';

export { runCli, runBootstrapCli };

const args = process.argv.slice(2);
const runner = args[0] === 'bootstrap-project'
  ? runBootstrapCli(args.slice(1))
  : runCli(args);

runner.then((exitCode) => {
  process.exitCode = exitCode;
});
