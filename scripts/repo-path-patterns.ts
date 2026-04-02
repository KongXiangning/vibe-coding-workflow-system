import type { JsonObject, JsonValue } from './workflow-core';

export type RepoPatternField =
  | 'paths.documentation_files'
  | 'paths.existing_skill_template_patterns'
  | 'paths.generated_artifacts'
  | 'boundaries.generated_only_paths'
  | 'boundaries.workflow_owned_paths'
  | 'governance.current_documents';

export function normalizeRepoPattern(entry: string): string {
  return entry.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function validateRepoPatternEntry(
  entry: string,
  field: RepoPatternField,
  context: string,
): string {
  const normalized = normalizeRepoPattern(entry);

  if (normalized.length === 0) {
    throw new Error(`Invalid repo pattern in ${context}.${field}: "${entry}" (empty string)`);
  }
  if (/[\0-\x1F\x7F]/.test(normalized)) {
    throw new Error(
      `Invalid repo pattern in ${context}.${field}: "${entry}" (control character)`,
    );
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Invalid repo pattern in ${context}.${field}: "${entry}" (absolute path)`);
  }
  if (normalized.includes('..')) {
    throw new Error(`Invalid repo pattern in ${context}.${field}: "${entry}" (parent traversal)`);
  }
  if (/[\[\]\{\}!]/.test(normalized)) {
    throw new Error(
      `Invalid repo pattern in ${context}.${field}: "${entry}" (unsupported glob syntax)`,
    );
  }

  return normalized;
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function repoPatternMatchesPath(file: string, pattern: string): boolean {
  const normalizedFile = normalizeRepoPattern(file);
  const normalizedPattern = normalizeRepoPattern(pattern);
  const regexStr = escapeRegex(normalizedPattern)
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}$`).test(normalizedFile);
}

export function hasDottedPath(obj: JsonObject, dottedPath: string): boolean {
  const parts = dottedPath.split('.');
  let current: JsonValue = obj;

  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(part in current)) {
      return false;
    }
    current = current[part];
  }

  return true;
}
