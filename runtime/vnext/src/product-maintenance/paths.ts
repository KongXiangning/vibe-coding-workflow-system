import * as fs from 'node:fs';
import * as path from 'node:path';
import { diagnostic, type Diagnostic, type ObjectValue } from './model';

export function relativePath(value: string, glob = false): string {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\\:]/.test(value) || value.startsWith('/') || value.split('/').some(p => p === '..' || p === '.' || !p || /[. ]$/.test(p))) throw new Error('UNSAFE_PATH: expected a relative /-separated path without traversal, alternate streams or ambiguous Windows segments');
  if (glob && /[\[\]{}]/.test(value)) throw new Error('UNSUPPORTED_GLOB: use *, ** or ?');
  if (!glob && /[*?\[\]]/.test(value)) throw new Error('UNSAFE_PATH: a concrete file path is required');
  return value;
}
export function matchPattern(value: string, pattern: string): boolean {
  relativePath(pattern, true);
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { expression += '(?:[^/]+/)*'; i++; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${expression}$`).test(value);
}
export const matches = (value: string, patterns: string[] = []): boolean => patterns.some(p => matchPattern(value, p));
export function safePath(root: string, relative: string): string {
  relativePath(relative);
  const absolute = path.resolve(root, ...relative.split('/'));
  if (path.relative(root, absolute).startsWith('..') || path.isAbsolute(path.relative(root, absolute))) throw new Error('UNSAFE_PATH: outside project root');
  let prefix = root;
  for (const piece of relative.split('/')) {
    prefix = path.join(prefix, piece);
    try { if (fs.lstatSync(prefix).isSymbolicLink()) throw new Error('SYMLINK_SKIPPED: symbolic links and junctions are not followed'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
export function allowed(manifest: ObjectValue, relative: string, kind: 'managed' | 'source' | 'capture'): boolean {
  relativePath(relative);
  if (relative === '.git' || relative.startsWith('.git/') || matches(relative, manifest.exclude_paths)) return false;
  if (kind === 'managed') return matches(relative, manifest.managed_paths);
  if (kind === 'source') return matches(relative, [...manifest.managed_paths, ...manifest.source_paths]);
  return matches(relative, manifest.capture_paths) && matches(relative, manifest.source_paths) && !matches(relative, manifest.managed_paths);
}
export function enumerate(root: string, patterns: string[], excludes: string[], maxFiles: number, diagnostics: Diagnostic[]): { paths: string[]; incomplete: boolean } {
  const paths: string[] = [];
  let incomplete = false;
  // Start at each pattern's static prefix, never recursively enumerate source_paths.
  const prefixes = patterns.map(p => {
    relativePath(p, true);
    const wildcard = p.search(/[*?\[\]]/);
    return wildcard < 0 ? p : p.slice(0, p.lastIndexOf('/', wildcard) + 1).replace(/\/$/, '');
  });
  const visited = new Set<string>();
  const skip = (p: string) => p.split('/').some(s => ['.git', 'node_modules', '.next', 'dist', 'build'].includes(s)) || p.startsWith('.workflow-system/runtime/') || p.startsWith('.workflow-system/records/');
  let visitedCount = 0;
  function visit(relative: string): void {
    if (visited.has(relative) || incomplete || (relative && (skip(relative) || matches(relative, excludes)))) return;
    visited.add(relative);
    if (++visitedCount > Math.max(10000, maxFiles * 100)) { incomplete = true; diagnostics.push(diagnostic('ENUMERATION_LIMIT', relative, 'Directory entry limit reached; remaining paths were not scanned')); return; }
    let stat: fs.Stats;
    const absolute = relative ? path.join(root, ...relative.split('/')) : root;
    try { if (relative) safePath(root, relative); stat = fs.lstatSync(absolute); }
    catch (error: any) {
      if (error.code !== 'ENOENT') diagnostics.push(diagnostic(error.message.startsWith('SYMLINK_SKIPPED') ? 'SYMLINK_SKIPPED' : 'PATH_UNAVAILABLE', relative, error.message));
      return;
    }
    if (stat.isSymbolicLink()) { diagnostics.push(diagnostic('SYMLINK_SKIPPED', relative, 'Symbolic link/junction not scanned')); return; }
    if (stat.isDirectory()) {
      try { for (const name of fs.readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name); }
      catch (error: any) { diagnostics.push(diagnostic('DIRECTORY_UNAVAILABLE', relative, error.message)); }
    } else if (stat.isFile() && matches(relative, patterns)) {
      if (paths.length >= maxFiles) { incomplete = true; diagnostics.push(diagnostic('FILE_LIMIT', relative, 'File limit reached; remaining files were not read')); return; }
      paths.push(relative);
    }
  }
  for (const prefix of prefixes) visit(prefix);
  return { paths: paths.sort(), incomplete };
}
