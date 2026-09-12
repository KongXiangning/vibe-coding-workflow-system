/** Bounded, read-only source context. Search is discovery, never evidence admission. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createTwoFilesPatch } from 'diff';
import { resolveRg } from './rg-tool';

export const DEFAULT_CONTEXT_BYTES = 16 * 1024;
export const MAX_CONTEXT_BYTES = 64 * 1024;
export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function contextInput(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CONTEXT_INPUT_INVALID: expected an object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('CONTEXT_INPUT_INVALID: unexpected input field.');
  return value;
}

export function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`CONTEXT_INPUT_INVALID: integer must be ${min}..${max}.`);
  return Number(value);
}

export function contextPath(root: string, value: unknown): { relative: string; absolute: string } {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\0\r\n]/u.test(value)) throw new Error('CONTEXT_PATH_INVALID: expected a project-relative path.');
  const relative = value.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (path.posix.isAbsolute(relative) || /^[A-Za-z]:/u.test(relative) || relative.split('/').includes('..')) throw new Error('CONTEXT_PATH_INVALID: path escapes project.');
  const absolute = path.resolve(root, relative);
  // Check each existing component, including dangling links; never follow links.
  let parent = path.resolve(root);
  for (const part of relative.split('/').filter(part => part && part !== '.')) {
    parent = path.join(parent, part);
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('CONTEXT_SYMLINK: symbolic links are not followed.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return { relative, absolute };
}

export function decodeText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; }
}

/** Offsets are UTF-8 bytes, with code-point aligned continuations (including long lines). */
export function textPage(text: string, input: Record<string, unknown>) {
  const startLine = integer(input.start_line, 1, 1, Number.MAX_SAFE_INTEGER);
  const endLine = integer(input.end_line, Number.MAX_SAFE_INTEGER, startLine, Number.MAX_SAFE_INTEGER);
  let start = 0;
  let line = 1;
  while (line < startLine) {
    const newline = text.indexOf('\n', start);
    if (newline < 0) throw new Error('CONTEXT_RANGE_INVALID: start_line is beyond the file.');
    start = newline + 1;
    line++;
  }
  let end = start;
  while (line <= endLine && end < text.length) {
    const newline = text.indexOf('\n', end);
    end = newline < 0 ? text.length : newline + 1;
    line++;
  }
  const bytes = Buffer.from(text.slice(start, end));
  const offset = integer(input.offset, 0, 0, bytes.length);
  const budget = integer(input.max_bytes, DEFAULT_CONTEXT_BYTES, 4, MAX_CONTEXT_BYTES);
  if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) throw new Error('CONTEXT_RANGE_INVALID: offset must be a UTF-8 boundary.');
  let pageEnd = Math.min(bytes.length, offset + budget);
  while (pageEnd < bytes.length && (bytes[pageEnd]! & 0xc0) === 0x80) pageEnd--;
  return { text: bytes.subarray(offset, pageEnd).toString('utf8'), start_line: startLine, offset, next_offset: pageEnd < bytes.length ? pageEnd : null, total_bytes: bytes.length, truncated: pageEnd < bytes.length };
}

export function textDiff(file: string, before: string, after: string): string | undefined {
  return createTwoFilesPatch(`before/${file}`, `after/${file}`, before, after, '', '', { context: 3, timeout: 200, maxEditLength: 20_000 });
}

export function readFileContext(root: string, input: unknown) {
  const value = contextInput(input, ['operation', 'path', 'sha256', 'offset', 'max_bytes', 'start_line', 'end_line']);
  const file = contextPath(root, value.path);
  const bytes = fs.readFileSync(file.absolute);
  const revision = sha256(bytes);
  if (value.sha256 !== undefined && value.sha256 !== revision) throw new Error('CONTEXT_STALE: file changed; start a fresh read.');
  if (value.offset !== undefined && value.offset !== 0 && value.sha256 === undefined) throw new Error('CONTEXT_INPUT_INVALID: continuation requires sha256.');
  const text = decodeText(bytes);
  return { status: 'pass', operation_kind: 'file-context', committed: false, path: file.relative, sha256: revision,
    ...(text === null ? { content_status: 'binary-or-non-utf8', size_bytes: bytes.length } : { content_status: 'text', ...textPage(text, value) }) };
}

export async function searchFileContext(root: string, input: unknown) {
  const value = contextInput(input, ['operation', 'roots', 'globs', 'query', 'include_hidden', 'limit', 'max_bytes']);
  if (!Array.isArray(value.roots) || !value.roots.length || value.roots.length > 32) throw new Error('CONTEXT_INPUT_INVALID: provide 1..32 search roots.');
  const roots = value.roots.map(item => contextPath(root, item));
  if (value.query !== undefined && (typeof value.query !== 'string' || !value.query || value.query.length > 4096 || /[\0\r\n]/u.test(value.query))) throw new Error('CONTEXT_INPUT_INVALID: query must be a non-empty single-line literal.');
  if (value.include_hidden !== undefined && typeof value.include_hidden !== 'boolean') throw new Error('CONTEXT_INPUT_INVALID: include_hidden must be boolean.');
  const globs = value.globs ?? [];
  if (!Array.isArray(globs) || globs.length > 32 || globs.some(glob => typeof glob !== 'string' || glob.length > 1024 || /[\0\r\n]/u.test(glob))) throw new Error('CONTEXT_INPUT_INVALID: invalid globs.');
  const limit = integer(value.limit, 50, 1, 200);
  const budget = integer(value.max_bytes, DEFAULT_CONTEXT_BYTES, 4, MAX_CONTEXT_BYTES);
  const rg = resolveRg(root);
  const args = ['--no-config', '--color', 'never', ...(value.include_hidden ? ['--hidden'] : []), ...globs.flatMap(glob => ['--glob', glob]),
    ...(value.query === undefined ? ['--files', '--null'] : ['--json', '--fixed-strings', '--', value.query as string]),
    ...(value.query === undefined ? ['--'] : []), ...roots.map(item => item.absolute)];
  const hits: Array<{ path: string; line?: number; text?: string }> = [];
  let stopReason: string | null = null;
  let used = 0;
  let pending = Buffer.alloc(0);
  let stderr = '';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(rg.command, args, { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = (reason: string) => { stopReason ??= reason; child.kill(); };
    const timer = setTimeout(() => stop('timeout'), 10_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(0, 2048); });
    child.stdout.on('data', chunk => {
      if (stopReason) return;
      pending = Buffer.concat([pending, chunk]);
      const separator = value.query === undefined ? 0 : 10;
      let at: number;
      while ((at = pending.indexOf(separator)) >= 0) {
        const line = pending.subarray(0, at); pending = pending.subarray(at + 1);
        try {
          let hit: { path: string; line?: number; text?: string };
          if (value.query === undefined) hit = { path: path.relative(root, line.toString('utf8')).replace(/\\/gu, '/') };
          else {
            const event = JSON.parse(line.toString('utf8'));
            if (event.type !== 'match') continue;
            if (!event.data.path.text || event.data.lines.text === undefined) { stop('non-utf8-result'); return; }
            hit = { path: path.relative(root, event.data.path.text).replace(/\\/gu, '/'), line: event.data.line_number, text: event.data.lines.text };
          }
          contextPath(root, hit.path);
          const size = Buffer.byteLength(JSON.stringify(hit));
          if (hits.length >= limit || used + size > budget) { stop('result-limit'); return; }
          used += size; hits.push(hit);
        } catch { stop('unreadable-result'); return; }
      }
      if (pending.length > MAX_CONTEXT_BYTES) stop('oversized-result');
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && code !== 1 && !stopReason) stopReason = 'search-error';
      resolve();
    });
  });
  return { status: stopReason ? 'partial' : 'pass', operation_kind: 'file-context', committed: false, rg: rg.version,
    roots: roots.map(item => item.relative), globs, query: value.query ?? null, include_hidden: value.include_hidden === true,
    hits, complete_within_scope: stopReason === null, truncated: stopReason !== null, reason: stopReason, error: stderr || null };
}

export async function fileContext(root: string, input: unknown) {
  const value = contextInput(input, ['operation', 'path', 'sha256', 'offset', 'max_bytes', 'start_line', 'end_line', 'roots', 'globs', 'query', 'include_hidden', 'limit']);
  if (value.operation === 'read') return readFileContext(root, value);
  if (value.operation === 'search') return searchFileContext(root, value);
  throw new Error('CONTEXT_INPUT_INVALID: operation must be search or read.');
}
