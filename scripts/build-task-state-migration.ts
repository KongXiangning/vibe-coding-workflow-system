import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dir, '..');
const modules = ['assistance.mjs', 'task-management.mjs', 'task-state.mjs', 'task-event-codec.mjs', 'record-storage.mjs'];
const hashes = Object.fromEntries(modules.map(name => [name,
  createHash('sha256').update(fs.readFileSync(path.join(root, 'runtime/vnext/support', name))).digest('hex')]));
execFileSync('bun', ['build', 'runtime/vnext/src/task-state-migration.ts', '--target=node',
  '--outfile', 'runtime/vnext/dist/task-state-migration.js', '--define',
  `__TASK_MIGRATION_READER_HASHES__=${JSON.stringify(hashes)}`], { cwd: root, stdio: 'inherit' });
