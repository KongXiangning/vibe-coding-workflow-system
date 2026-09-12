import * as path from 'node:path';
import { prepareRgTools } from './install-tools';

const [stageRoot, reuseRoot] = process.argv.slice(2);
if (!stageRoot || !reuseRoot) throw new Error('Usage: install-tools <staging-root> <existing-project-root>');
prepareRgTools(path.resolve(stageRoot), path.resolve(reuseRoot))
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
