import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkTargetRoot, normalizeAbsoluteRootPath } from '../scripts/guard-target-root';

function withTempRoot(run: (root: string) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-target-root-'));
  try {
    run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('guard-target-root', () => {
  test('denies source self-install with normalized paths', () => {
    withTempRoot(root => {
      const sourceRoot = path.join(root, 'SourceRepo');
      fs.mkdirSync(sourceRoot, { recursive: true });

      const targetRoot = process.platform === 'win32' ? `${sourceRoot.toUpperCase()}${path.sep}` : `${sourceRoot}${path.sep}`;
      const result = checkTargetRoot(sourceRoot, targetRoot);

      expect(result.allowed).toBe(false);
      if (result.allowed) {
        throw new Error('Expected deny result.');
      }
      expect(result.reason).toBe('self_install');
      expect(result.normalizedSourceRoot).toBe(normalizeAbsoluteRootPath(sourceRoot));
      expect(result.normalizedTargetRoot).toBe(normalizeAbsoluteRootPath(sourceRoot));
    });
  });

  test('denies ancestor target roots', () => {
    withTempRoot(root => {
      const ancestorRoot = path.join(root, 'workspace');
      const sourceRoot = path.join(ancestorRoot, 'repo', 'source');
      fs.mkdirSync(sourceRoot, { recursive: true });

      const result = checkTargetRoot(sourceRoot, ancestorRoot);

      expect(result.allowed).toBe(false);
      if (result.allowed) {
        throw new Error('Expected deny result.');
      }
      expect(result.reason).toBe('ancestor_root');
    });
  });

  test('allows isolated target roots without a shared git root', () => {
    withTempRoot(root => {
      const sourceRoot = path.join(root, 'source');
      const targetRoot = path.join(root, 'target');
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.mkdirSync(targetRoot, { recursive: true });

      const result = checkTargetRoot(sourceRoot, targetRoot);

      expect(result).toMatchObject({
        allowed: true,
        sourceGitRoot: null,
        targetGitRoot: null,
      });
    });
  });

  test('denies roots that share the same git directory anchor', () => {
    withTempRoot(root => {
      const repoRoot = path.join(root, 'repo');
      const sourceRoot = path.join(repoRoot, 'source');
      const targetRoot = path.join(repoRoot, 'target');
      fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.mkdirSync(targetRoot, { recursive: true });

      const result = checkTargetRoot(sourceRoot, targetRoot);

      expect(result.allowed).toBe(false);
      if (result.allowed) {
        throw new Error('Expected deny result.');
      }
      expect(result.reason).toBe('shared_git_root');
      expect(result.sourceGitRoot).toBe(normalizeAbsoluteRootPath(repoRoot));
      expect(result.targetGitRoot).toBe(normalizeAbsoluteRootPath(repoRoot));
    });
  });

  test('allows roots that belong to different git directories', () => {
    withTempRoot(root => {
      const sourceRepoRoot = path.join(root, 'source-repo');
      const targetRepoRoot = path.join(root, 'target-repo');
      const sourceRoot = path.join(sourceRepoRoot, 'source');
      const targetRoot = path.join(targetRepoRoot, 'target');
      fs.mkdirSync(path.join(sourceRepoRoot, '.git'), { recursive: true });
      fs.mkdirSync(path.join(targetRepoRoot, '.git'), { recursive: true });
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.mkdirSync(targetRoot, { recursive: true });

      const result = checkTargetRoot(sourceRoot, targetRoot);

      expect(result).toMatchObject({
        allowed: true,
        sourceGitRoot: normalizeAbsoluteRootPath(sourceRepoRoot),
        targetGitRoot: normalizeAbsoluteRootPath(targetRepoRoot),
      });
    });
  });

  test('treats .git files as git anchors for shared-root detection', () => {
    withTempRoot(root => {
      const repoRoot = path.join(root, 'repo');
      const sourceRoot = path.join(repoRoot, 'source');
      const targetRoot = path.join(repoRoot, 'target');
      fs.mkdirSync(repoRoot, { recursive: true });
      fs.writeFileSync(path.join(repoRoot, '.git'), 'gitdir: ../actual-git-dir\n', 'utf8');
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.mkdirSync(targetRoot, { recursive: true });

      const result = checkTargetRoot(sourceRoot, targetRoot);

      expect(result.allowed).toBe(false);
      if (result.allowed) {
        throw new Error('Expected deny result.');
      }
      expect(result.reason).toBe('shared_git_root');
    });
  });
});
