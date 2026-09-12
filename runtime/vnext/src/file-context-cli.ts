import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileContext } from './file-context';
import { validateRuntimeEnvironment, validateVNextRuntimeContract, VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH } from './kernel';

export async function runFileContextCli(args: string[]): Promise<number> {
  try {
    validateRuntimeEnvironment();
    if (args.length !== 2 || args[0] !== '--root' || !args[1]) throw new Error('Usage: file-context --root <project> (JSON on stdin)');
    const root = path.resolve(args[1]);
    if (fs.existsSync(path.join(root, VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH, 'package.json'))) validateVNextRuntimeContract(root, true);
    const result = await fileContext(root, JSON.parse(fs.readFileSync(0, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'partial' ? 2 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
