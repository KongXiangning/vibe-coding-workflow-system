import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const SRC_DIR = path.join(ROOT, 'browse', 'src');
const DIST_DIR = path.join(ROOT, 'browse', 'dist');
const SERVER_ENTRY = path.join(SRC_DIR, 'server.ts');
const SERVER_OUTFILE = path.join(DIST_DIR, 'server-node.mjs');
const POLYFILL_SOURCE = path.join(SRC_DIR, 'bun-polyfill.cjs');
const POLYFILL_TARGET = path.join(DIST_DIR, 'bun-polyfill.cjs');

function runBunBuild(): void {
  const result = spawnSync(
    process.execPath,
    [
      'build',
      SERVER_ENTRY,
      '--target=node',
      '--outfile',
      SERVER_OUTFILE,
      '--external',
      'playwright',
      '--external',
      'playwright-core',
      '--external',
      'diff',
      '--external',
      'bun:sqlite',
    ],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    throw new Error(`bun build failed for server.ts with exit code ${result.status ?? 'unknown'}`);
  }
}

function injectWindowsCompatibility(): void {
  let content = fs.readFileSync(SERVER_OUTFILE, 'utf8');
  content = content.replaceAll('import.meta.dir', '__browseNodeSrcDir');
  content = content.replace(
    'import { Database } from "bun:sqlite";',
    'const Database = null; // bun:sqlite stubbed on Node',
  );

  const lines = content.split(/\r?\n/);
  const [firstLine = '', ...rest] = lines;
  const header = [
    '// ── Windows Node.js compatibility (auto-generated) ──',
    'import { fileURLToPath as _ftp } from "node:url";',
    'import { dirname as _dn } from "node:path";',
    'import { createRequire as _cr } from "node:module";',
    'const __browseNodeSrcDir = _dn(_dn(_ftp(import.meta.url))) + "/src";',
    '{ const _r = _cr(import.meta.url); _r("./bun-polyfill.cjs"); }',
    '// ── end compatibility ──',
  ];
  const finalContent = [firstLine, ...header, ...rest].join('\n');
  fs.writeFileSync(SERVER_OUTFILE, `${finalContent}\n`, 'utf8');
}

function main(): void {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  console.log('Building Node-compatible server bundle...');
  runBunBuild();
  injectWindowsCompatibility();
  fs.copyFileSync(POLYFILL_SOURCE, POLYFILL_TARGET);
  console.log(`Node server bundle ready: ${SERVER_OUTFILE}`);
}

main();
