import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

function run(label: string, args: string[], options: { cwd?: string; capture?: boolean } = {}): string | void {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? ROOT,
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return options.capture ? result.stdout.toString().trim() : undefined;
}

function resolveCompiledPath(basePath: string): string {
  return process.platform === 'win32' ? `${basePath}.exe` : basePath;
}

function writeVersionFile(targetPath: string, version: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${version}\n`, 'utf8');
}

function chmodIfNeeded(targetPath: string): void {
  if (process.platform === 'win32' || !fs.existsSync(targetPath)) {
    return;
  }
  fs.chmodSync(targetPath, 0o755);
}

function cleanupBunBuildArtifacts(): void {
  for (const entry of fs.readdirSync(ROOT)) {
    if (entry.startsWith('.') && entry.endsWith('.bun-build')) {
      fs.rmSync(path.join(ROOT, entry), { force: true, recursive: true });
    }
  }
}

function main(): void {
  run('gen:skill-docs', ['run', 'gen:skill-docs', '--host', 'all']);
  run('build browse', ['build', '--compile', 'browse/src/cli.ts', '--outfile', 'browse/dist/browse']);
  run('build find-browse', ['build', '--compile', 'browse/src/find-browse.ts', '--outfile', 'browse/dist/find-browse']);
  run('build design', ['build', '--compile', 'design/src/cli.ts', '--outfile', 'design/dist/design']);
  run('build global discover', ['build', '--compile', 'bin/gstack-global-discover.ts', '--outfile', 'bin/gstack-global-discover']);
  run('build node server', ['run', 'browse/scripts/build-node-server.ts']);

  const version = run('git rev-parse HEAD', ['x', 'git', 'rev-parse', 'HEAD'], { capture: true }) as string;
  writeVersionFile(path.join(ROOT, 'browse', 'dist', '.version'), version);
  writeVersionFile(path.join(ROOT, 'design', 'dist', '.version'), version);

  chmodIfNeeded(resolveCompiledPath(path.join(ROOT, 'browse', 'dist', 'browse')));
  chmodIfNeeded(resolveCompiledPath(path.join(ROOT, 'browse', 'dist', 'find-browse')));
  chmodIfNeeded(resolveCompiledPath(path.join(ROOT, 'design', 'dist', 'design')));
  chmodIfNeeded(resolveCompiledPath(path.join(ROOT, 'bin', 'gstack-global-discover')));
  cleanupBunBuildArtifacts();
}

main();
