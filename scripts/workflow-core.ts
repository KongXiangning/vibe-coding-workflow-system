/**
 * Shared core for workflow-system generators.
 *
 * Types, constants, parsing, rendering, and validation logic used by
 * gen-workflow-skills, gen-workflow-docs, and gen-registry.
 */

import * as fs from 'fs';
import { parse } from 'yaml';

// --- Types ---

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

// --- Constants ---

export const REQUIRED_STAGES = new Set([
  '初始化',
  '阶段 1：需求进入',
  '阶段 2：范围锁定',
  '阶段 3：方案拆解',
  '阶段 4：小步实现',
  '阶段 4/6：实现或验证异常',
  '阶段 5：范围复核',
  '阶段 6：回归验证',
  '阶段 7：状态同步',
  '阶段 8：交付沉淀',
]);

export const RESERVED_FAILURE_TARGETS = new Set(['ask-user']);

// --- File I/O ---

export function readText(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// --- Profile ---

export function loadProfile(profilePath: string): JsonObject {
  const profile = parse(readText(profilePath)) as JsonObject;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('PROJECT_PROFILE.yaml must parse to a mapping');
  }
  return profile;
}

export function getRequiredPath(obj: JsonObject, dottedPath: string): JsonValue {
  const parts = dottedPath.split('.');
  let current: JsonValue = obj;

  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(part in current)) {
      throw new Error(`Missing required profile field: ${dottedPath}`);
    }
    current = current[part];
  }

  return current;
}

export function normalizeList(value: JsonValue): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(item => String(item));
  return [String(value)];
}

export function projectPlaceholders(profile: JsonObject): Record<string, JsonValue> {
  return {
    '{{PROJECT_NAME}}': getRequiredPath(profile, 'project.name'),
    '{{PROJECT_TYPE}}': getRequiredPath(profile, 'project.type'),
    '{{TECH_STACK}}': getRequiredPath(profile, 'runtime.languages'),
    '{{TEST_COMMANDS}}': getRequiredPath(profile, 'runtime.test_commands'),
    '{{DECISION_TYPES}}': getRequiredPath(profile, 'decision_types'),
    '{{CODE_DIRECTORIES}}': getRequiredPath(profile, 'paths.source_directories'),
    '{{FORBIDDEN_PATHS}}': getRequiredPath(profile, 'boundaries.forbidden_paths'),
    '{{ARCHITECTURE_RULES}}': getRequiredPath(profile, 'architecture_rules'),
  };
}

// --- Parsing ---

export function parseFrontmatter(
  content: string,
  filePath: string,
): { frontmatter: JsonObject; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid frontmatter block in ${filePath}`);
  }

  const frontmatter = parse(match[1]) as JsonObject;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Frontmatter is not a mapping in ${filePath}`);
  }

  return { frontmatter, body: match[2] };
}

// --- Rendering ---

export function stringifyInline(value: JsonValue): string {
  if (Array.isArray(value)) {
    return value.map(item => stringifyInline(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function renderValue(
  value: JsonValue,
  replacements: Record<string, JsonValue>,
): JsonValue {
  if (Array.isArray(value)) {
    const rendered: JsonValue[] = [];
    for (const item of value) {
      const next = renderValue(item, replacements);
      if (Array.isArray(next)) {
        rendered.push(...next);
      } else {
        rendered.push(next);
      }
    }
    return rendered;
  }

  if (value && typeof value === 'object') {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = renderValue(child, replacements);
    }
    return result;
  }

  if (typeof value !== 'string') {
    return value;
  }

  if (value in replacements) {
    return replacements[value];
  }

  let rendered = value;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(stringifyInline(replacement));
  }
  return rendered;
}

// --- Validation ---

export function validateUnresolvedPlaceholders(
  label: string,
  content: string,
  allowedSet: Set<string>,
): void {
  const matches = content.match(/\{\{[^}]+\}\}/g) ?? [];
  const invalid = matches.filter(token => !allowedSet.has(token));
  if (invalid.length > 0) {
    throw new Error(`Unresolved placeholders in ${label}: ${invalid.join(', ')}`);
  }
}

export function validateStages(stages: Iterable<string>): void {
  const seen = new Set(stages);
  for (const stage of REQUIRED_STAGES) {
    if (!seen.has(stage)) {
      throw new Error(`Missing required stage coverage: ${stage}`);
    }
  }
}
