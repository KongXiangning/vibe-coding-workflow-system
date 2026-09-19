import * as path from 'path';

const root = path.resolve(import.meta.dir, '..');
const packageJson = await Bun.file(path.join(root, 'package.json')).json() as { packageManager?: unknown };
const packageManager = packageJson.packageManager;

if (typeof packageManager !== 'string' || !/^bun@\d+\.\d+\.\d+$/u.test(packageManager)) {
  console.error('package.json must pin the repository Bun toolchain as packageManager: "bun@x.y.z".');
  process.exit(1);
}

const expectedVersion = packageManager.slice('bun@'.length);
if (Bun.version !== expectedVersion) {
  console.error(`Bun ${expectedVersion} is required for reproducible tests and Runtime bundles; found ${Bun.version}.`);
  process.exit(1);
}

console.log(`Bun toolchain verified: ${Bun.version}`);
