import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { documentSchema, manifestSchema, requestSchema, resultSchema } from '../runtime/vnext/src/product-maintenance/schemas';
import { buildProductAssets } from './product-maintenance-assets';

const root = path.resolve(import.meta.dir, '..');
const directory = path.join(root, 'runtime/vnext/support/product-maintenance/schemas');
fs.mkdirSync(directory, { recursive: true });
buildProductAssets(root);
for (const version of [1, 2] as const) {
  fs.writeFileSync(path.join(directory, `product-doc-v${version}.json`), `${JSON.stringify(documentSchema(version), null, 2)}\n`);
  fs.writeFileSync(path.join(directory, `product-manifest-v${version}.json`), `${JSON.stringify(manifestSchema(version), null, 2)}\n`);
}
fs.writeFileSync(path.join(directory, 'request-v1.json'), `${JSON.stringify(requestSchema, null, 2)}\n`);
fs.writeFileSync(path.join(directory, 'result-v1.json'), `${JSON.stringify(resultSchema, null, 2)}\n`);
execFileSync('bun', ['build', 'runtime/vnext/src/product-maintenance/cli.ts', '--target=node', '--outfile', 'runtime/vnext/dist/product-maintenance.js'], { cwd: root, stdio: 'inherit' });
execFileSync('bun', ['build', 'runtime/vnext/src/product-maintenance/offline-reader.ts', '--target=node', '--outfile', 'runtime/vnext/support/product-maintenance/offline-reader.js'], { cwd: root, stdio: 'inherit' });
