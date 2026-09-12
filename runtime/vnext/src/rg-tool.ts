import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const RG_TOOLS_PATH = '.workflow-system/runtime/tools/rg';
export const RG_INSTALL_ENTRY = '.workflow-system/runtime/dist/install-tools.js';
export const RG_VERSION = '15.2.0';
export const RG_BINARY = process.platform === 'win32' ? 'rg.exe' : 'rg';
export type RgIdentity = { command: string; version: string; source: 'project' | 'path' };

export function assertRgDirectory(root: string): string {
  let directory = path.resolve(root);
  for (const part of RG_TOOLS_PATH.split('/')) {
    directory = path.join(directory, part);
    try {
      if (!fs.lstatSync(directory).isDirectory()) throw new Error('RG_DEPENDENCY_PATH_INVALID: tool directory must not be a symlink or file.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return directory;
}

export function probeRg(command: string): string | null {
  try {
    const version = execFileSync(command, ['--no-config', '--version'], { encoding: 'utf8', windowsHide: true, timeout: 3000, maxBuffer: 4096 });
    const match = /^ripgrep (\d+\.\d+\.\d+)/u.exec(version);
    if (!match) return null;
    // These releases implement the JSON, fixed-string and ignore contract used here.
    const [major, minor] = match[1]!.split('.').map(Number);
    return ((major === 14 && minor! >= 1) || major === 15) ? match[1]! : null;
  } catch { return null; }
}

export function resolveRg(root: string): RgIdentity {
  const directory = assertRgDirectory(root);
  const command = path.join(directory, RG_BINARY);
  try {
    const identity = JSON.parse(fs.readFileSync(path.join(directory, 'identity.json'), 'utf8'));
    if (!fs.lstatSync(command).isSymbolicLink() && identity.sha256 === createHash('sha256').update(fs.readFileSync(command)).digest('hex')) {
      const version = probeRg(command);
      if (version && identity.version === version) return { command, version, source: 'project' };
    }
  } catch { /* Missing or incompatible local dependency can use a compatible PATH tool. */ }
  for (const entry of (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    const command = path.resolve(entry.replace(/^"|"$/gu, ''), RG_BINARY);
    if (!fs.existsSync(command)) continue;
    const version = probeRg(command);
    if (version) return { command, version, source: 'path' };
  }
  throw new Error('RG_DEPENDENCY_MISSING: install or upgrade the Runtime distribution to prepare ripgrep; read-only commands do not download tools.');
}
