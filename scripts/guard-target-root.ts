import * as fs from 'fs';
import * as path from 'path';

export type TargetRootGuardDenyReason = 'self_install' | 'ancestor_root' | 'shared_git_root';

type TargetRootGuardContext = {
  normalizedSourceRoot: string;
  normalizedTargetRoot: string;
  sourceGitRoot: string | null;
  targetGitRoot: string | null;
};

export type TargetRootGuardResult =
  | ({ allowed: true } & TargetRootGuardContext)
  | ({
      allowed: false;
      reason: TargetRootGuardDenyReason;
      message: string;
    } & TargetRootGuardContext);

function normalizePathCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export function normalizeAbsoluteRootPath(input: string): string {
  const resolved = path.resolve(input);
  const normalizedRoot = normalizePathCase(path.parse(resolved).root.replace(/\\/g, '/'));
  const normalized = normalizePathCase(resolved.replace(/\\/g, '/'));
  return normalized === normalizedRoot ? normalizedRoot : normalized.replace(/\/+$/, '');
}

function findExistingPathOrAncestor(input: string): string | null {
  let current = path.resolve(input);
  while (true) {
    if (fs.existsSync(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasGitAnchor(root: string): boolean {
  const gitPath = path.join(root, '.git');
  if (!fs.existsSync(gitPath)) {
    return false;
  }
  const stat = fs.statSync(gitPath);
  return stat.isDirectory() || stat.isFile();
}

export function findGitRoot(startPath: string): string | null {
  let current = findExistingPathOrAncestor(startPath);
  while (current) {
    if (hasGitAnchor(current)) {
      return normalizeAbsoluteRootPath(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

function isAncestorPath(candidateAncestor: string, candidateDescendant: string): boolean {
  if (candidateAncestor === candidateDescendant) {
    return false;
  }
  const prefix = candidateAncestor.endsWith('/') ? candidateAncestor : `${candidateAncestor}/`;
  return candidateDescendant.startsWith(prefix);
}

function buildResult(
  sourceRoot: string,
  targetRoot: string,
  denyReason?: TargetRootGuardDenyReason,
  message?: string,
): TargetRootGuardResult {
  const normalizedSourceRoot = normalizeAbsoluteRootPath(sourceRoot);
  const normalizedTargetRoot = normalizeAbsoluteRootPath(targetRoot);
  const sourceGitRoot = findGitRoot(sourceRoot);
  const targetGitRoot = findGitRoot(targetRoot);
  if (!denyReason) {
    return {
      allowed: true,
      normalizedSourceRoot,
      normalizedTargetRoot,
      sourceGitRoot,
      targetGitRoot,
    };
  }
  return {
    allowed: false,
    reason: denyReason,
    message: message ?? 'Target root is not allowed.',
    normalizedSourceRoot,
    normalizedTargetRoot,
    sourceGitRoot,
    targetGitRoot,
  };
}

export function checkTargetRoot(sourceRoot: string, targetRoot: string): TargetRootGuardResult {
  const normalizedSourceRoot = normalizeAbsoluteRootPath(sourceRoot);
  const normalizedTargetRoot = normalizeAbsoluteRootPath(targetRoot);

  if (normalizedTargetRoot === normalizedSourceRoot) {
    return buildResult(
      sourceRoot,
      targetRoot,
      'self_install',
      'Target root cannot be the workflow-system source root itself.',
    );
  }

  if (isAncestorPath(normalizedTargetRoot, normalizedSourceRoot)) {
    return buildResult(
      sourceRoot,
      targetRoot,
      'ancestor_root',
      'Target root cannot be a parent or ancestor of the workflow-system source root.',
    );
  }

  const sourceGitRoot = findGitRoot(sourceRoot);
  const targetGitRoot = findGitRoot(targetRoot);
  if (sourceGitRoot && targetGitRoot && sourceGitRoot === targetGitRoot) {
    return buildResult(
      sourceRoot,
      targetRoot,
      'shared_git_root',
      'Target root cannot share the same Git root as the workflow-system source root.',
    );
  }

  return buildResult(sourceRoot, targetRoot);
}
