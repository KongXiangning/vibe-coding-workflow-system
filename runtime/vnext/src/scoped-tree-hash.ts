/**
 * Scoped rollback identity for project-local transactions.
 *
 * This helper deliberately never discovers files from the project root. A
 * directory is traversed only when the caller explicitly includes it. A
 * symbolic link is recorded as a link and is never followed; a symbolic-link
 * parent is rejected because resolving a child through it would leave the
 * admitted mutation boundary.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class ScopedTreeHashError extends Error {
  readonly code = 'UNSAFE_PATH';

  constructor(message: string) {
    super(message);
    this.name = 'ScopedTreeHashError';
  }
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRepoPath(value: string, location: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.split('/').some(segment => segment === '..' || segment.length === 0)
    || /[\0-\x1F\x7F]/u.test(normalized)
    || normalized.includes('*')
  ) {
    throw new ScopedTreeHashError(`${location} must be a repository-relative concrete path: ${value}`);
  }
  return normalized;
}

function resolveRepoPath(root: string, relativePath: string, location: string): string {
  const normalized = normalizeRepoPath(relativePath, location);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new ScopedTreeHashError(`${location} escapes the target root: ${relativePath}`);
  }
  return resolved;
}

/**
 * Hash the explicit rollback scope, including missing-path markers.
 *
 * The optional ignored paths are still explicit members of the scope but are
 * omitted from the identity. This is used for transaction markers that are
 * created after the preimage and removed after a verified commit/rollback.
 */
export function computeScopedTreeHash(
  root: string,
  includedRelativePaths: readonly string[],
  ignoredRelativePaths: readonly string[] = [],
): string {
  const resolvedRoot = path.resolve(root);
  const included = [...new Set(includedRelativePaths.map(relativePath => normalizeRepoPath(relativePath, 'scoped tree hash included path')))]
    .sort((left, right) => left.localeCompare(right));
  const ignored = new Set(ignoredRelativePaths.map(relativePath => normalizeRepoPath(relativePath, 'scoped tree hash ignored path')));
  const visited = new Set<string>();
  const hash = crypto.createHash('sha256');

  const isMissingPathError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    return (error as { code?: unknown }).code === 'ENOENT';
  };

  const lstatOrMissing = (fullPath: string): fs.Stats | null => {
    try {
      return fs.lstatSync(fullPath);
    } catch (error) {
      if (isMissingPathError(error)) return null;
      throw error;
    }
  };

  const record = (relativePath: string, kind: string, value = ''): void => {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(kind);
    hash.update('\0');
    hash.update(value);
    hash.update('\n');
  };

  const assertNoSymlinkParent = (relativePath: string): void => {
    const parts = relativePath.split('/');
    let current = resolvedRoot;
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = path.join(current, parts[index]!);
      const status = lstatOrMissing(current);
      if (!status) return;
      if (status.isSymbolicLink()) {
        throw new ScopedTreeHashError(`scoped tree hash cannot traverse a symbolic-link parent: ${relativePath}`);
      }
      if (!status.isDirectory()) return;
    }
  };

  const visit = (relativePath: string, fullPath: string): void => {
    if (ignored.has(relativePath) || visited.has(relativePath)) return;
    const status = lstatOrMissing(fullPath);
    if (!status) {
      visited.add(relativePath);
      record(relativePath, 'missing');
      return;
    }
    visited.add(relativePath);
    if (status.isSymbolicLink()) {
      record(relativePath, 'symlink', fs.readlinkSync(fullPath));
      return;
    }
    if (status.isDirectory()) {
      record(relativePath, 'directory');
      for (const name of fs.readdirSync(fullPath).sort((left, right) => left.localeCompare(right))) {
        visit(`${relativePath}/${name}`, path.join(fullPath, name));
      }
      return;
    }
    if (status.isFile()) {
      const content = fs.readFileSync(fullPath);
      record(relativePath, 'file', `${content.byteLength}\0${sha256(content)}`);
      return;
    }
    record(relativePath, 'special', String(status.mode));
  };

  for (const relativePath of included) {
    assertNoSymlinkParent(relativePath);
    visit(relativePath, resolveRepoPath(resolvedRoot, relativePath, 'scoped tree hash included path'));
  }
  return hash.digest('hex');
}
