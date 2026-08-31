import { runCli } from './kernel';

export { runCli };

runCli().then((exitCode) => {
  process.exitCode = exitCode;
});
