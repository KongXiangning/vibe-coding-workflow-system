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
function mayContainMatch(directory: string, pattern: string): boolean {
  const prefix = directory ? `${directory}/` : '';
  const memo = new Map<string, boolean>();
  // Match a prefix of the same language as matchPattern, including ** inside a segment.
  function extend(patternOffset: number, offset: number): boolean {
    if (offset === prefix.length) return true;
    if (patternOffset === pattern.length) return false;
    const key = `${patternOffset}:${offset}`;
    if (memo.has(key)) return memo.get(key)!;
    const char = pattern[patternOffset];
    let result: boolean;
    if (char === '*' && pattern[patternOffset + 1] === '*') {
      if (pattern[patternOffset + 2] === '/') {
        const slash = prefix.indexOf('/', offset);
        result = extend(patternOffset + 3, offset) || (slash > offset && extend(patternOffset, slash + 1));
      } else result = extend(patternOffset + 2, offset) || extend(patternOffset, offset + 1);
    } else if (char === '*') {
      result = extend(patternOffset + 1, offset) || (prefix[offset] !== '/' && extend(patternOffset, offset + 1));
    } else {
      result = (char === '?' ? prefix[offset] !== '/' : char === prefix[offset]) && extend(patternOffset + 1, offset + 1);
    }
    memo.set(key, result);
    return result;
  }
  return extend(0, 0);
}
export function enumerate(root: string, patterns: string[], excludes: string[], maxFiles: number, diagnostics: Diagnostic[]): { paths: string[]; incomplete: boolean; omitted: string[] } {
  const paths: string[] = [];
  const omitted = new Set<string>();
  let stopped = false;
  // Start at each pattern's static prefix, never recursively enumerate source_paths.
  const prefixes = patterns.map(p => {
    relativePath(p, true);
    const wildcard = p.search(/[*?\[\]]/);
    return wildcard < 0 ? p : p.slice(0, p.lastIndexOf('/', wildcard) + 1).replace(/\/$/, '');
  });
  const visited = new Set<string>();
  const explicitFiles = new Set(patterns.filter(p => !/[*?]/.test(p)));
  const skip = (p: string) => p.split('/').some(s => ['.git', 'node_modules', '.next', 'dist', 'build'].includes(s)) || p.startsWith('.workflow-system/runtime/') || p.startsWith('.workflow-system/records/');
  let visitedCount = 0;
  function omit(relative: string, code: string, message: string): void {
    omitted.add(relative);
    diagnostics.push(diagnostic(code, relative, message));
  }
  function visit(relative: string): void {
    if (visited.has(relative) || stopped || (relative && (skip(relative) || matches(relative, excludes)))) return;
    visited.add(relative);
    if (++visitedCount > Math.max(10000, maxFiles * 100)) { stopped = true; omit(relative, 'ENUMERATION_LIMIT', 'Directory entry limit reached; remaining paths were not scanned'); return; }
    if (relative && !patterns.some(pattern => matchPattern(relative, pattern) || mayContainMatch(relative, pattern))) return;
    let stat: fs.Stats;
    const absolute = relative ? path.join(root, ...relative.split('/')) : root;
    try { if (relative) safePath(root, relative); stat = fs.lstatSync(absolute); }
    catch (error: any) {
      omit(relative, error.message.startsWith('SYMLINK_SKIPPED') ? 'SYMLINK_SKIPPED' : 'PATH_UNAVAILABLE', error.message);
      return;
    }
    if (stat.isSymbolicLink()) { omit(relative, 'SYMLINK_SKIPPED', 'Symbolic link/junction not scanned'); return; }
    if (stat.isDirectory()) {
      if (explicitFiles.has(relative)) omit(relative, 'PATH_UNAVAILABLE', 'Selected file path is a directory, not a regular file');
      if (!patterns.some(pattern => mayContainMatch(relative, pattern))) return;
      try { for (const name of fs.readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name); }
      catch (error: any) { omit(relative, 'DIRECTORY_UNAVAILABLE', error.message); }
    } else if (stat.isFile() && matches(relative, patterns)) {
      if (paths.length >= maxFiles) { stopped = true; omit(relative, 'FILE_LIMIT', 'File limit reached; remaining files were not read'); return; }
      paths.push(relative);
    } else if (matches(relative, patterns)) omit(relative, 'PATH_UNAVAILABLE', 'Selected path is not a regular file');
  }
  for (const prefix of prefixes) visit(prefix);
  if (stopped) for (const pattern of patterns) omitted.add(pattern);
  return { paths: paths.sort(), incomplete: omitted.size > 0, omitted: [...omitted] };
}
