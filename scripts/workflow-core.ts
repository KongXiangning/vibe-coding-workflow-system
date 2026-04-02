/**
 * Shared core for workflow-system generators.
 *
 * Types, constants, parsing, rendering, and validation logic used by
 * gen-workflow-skills, gen-workflow-docs, and gen-registry.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

// --- Types ---

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type HandoffRef = { success: string; failure: string };
export type WriteOperation = { path: string; content: string };
export type PathField = 'reads' | 'writes' | 'forbidden_writes';
type WriteFs = Pick<
  typeof fs,
  'existsSync' | 'mkdirSync' | 'rmSync' | 'renameSync' | 'writeFileSync'
>;
export type ErrorReport = {
  generator: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  file?: string;
  field?: string;
  details?: string;
};

// --- Constants ---

/** Canonical stage enum: English ID → Chinese display name. See WORKFLOW_PROTOCOL.md §4a. */
export const STAGE_MAP = new Map<string, string>([
  ['init', '初始化'],
  ['phase-1-intake', '阶段 1：需求进入'],
  ['phase-2-scope-lock', '阶段 2：范围锁定'],
  ['phase-3-decomposition', '阶段 3：方案拆解'],
  ['phase-4-implementation', '阶段 4：小步实现'],
  ['phase-4-6-exception', '阶段 4/6：实现或验证异常'],
  ['phase-5-scope-review', '阶段 5：范围复核'],
  ['phase-6-regression', '阶段 6：回归验证'],
  ['phase-7-sync', '阶段 7：状态同步'],
  ['phase-8-delivery', '阶段 8：交付沉淀'],
]);

/** Reverse lookup: Chinese display name → English canonical ID. */
export const STAGE_ALIASES = new Map<string, string>(
  [...STAGE_MAP.entries()].map(([canonical, display]) => [display, canonical]),
);

/**
 * All accepted stage values (both canonical IDs and display names).
 * Kept for backward compatibility — prefer STAGE_MAP for new code.
 */
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

export function resolveRoot(): string {
  return path.resolve(import.meta.dir, '..');
}

export function ensureCleanOutputDir(
  outputDir: string,
  filePattern: string,
  keepPaths: Iterable<string> = [],
): void {
  fs.mkdirSync(outputDir, { recursive: true });
  const keep = new Set([...keepPaths].map(entry => path.resolve(entry)));
  for (const entry of fs.readdirSync(outputDir)) {
    const fullPath = path.join(outputDir, entry);
    if (entry.endsWith(filePattern) && !keep.has(path.resolve(fullPath))) {
      fs.rmSync(fullPath, { force: true });
    }
  }
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

export function validateRequiredFields(
  obj: JsonObject,
  fields: readonly string[],
  context: string,
): void {
  for (const field of fields) {
    if (!(field in obj)) {
      throw new Error(`Missing required field "${field}" in ${context}`);
    }
  }
}

export function normalizePathEntry(entry: string): string {
  return entry.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function validatePathEntry(entry: string, field: PathField, context: string): string {
  const normalized = normalizePathEntry(entry);

  if (normalized.length === 0) {
    throw new Error(`Invalid path entry in ${context}.${field}: "${entry}" (empty string)`);
  }
  if (/[\0-\x1F\x7F]/.test(normalized)) {
    throw new Error(`Invalid path entry in ${context}.${field}: "${entry}" (control character)`);
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Invalid path entry in ${context}.${field}: "${entry}" (absolute path)`);
  }
  if (normalized.includes('..')) {
    throw new Error(`Invalid path entry in ${context}.${field}: "${entry}" (parent traversal)`);
  }

  const starCount = (normalized.match(/\*/g) ?? []).length;
  if (starCount > 0) {
    const prefix = normalized.slice(0, -3);
    const isRestrictedDirectoryPattern =
      normalized.endsWith('/**') && starCount === 2 && prefix.length > 0 && !prefix.includes('*');

    if (!isRestrictedDirectoryPattern) {
      throw new Error(
        `Invalid path entry in ${context}.${field}: "${entry}" (unsupported wildcard pattern)`,
      );
    }
  }

  return normalized;
}

function canonicalizePathBoundary(entry: string): string {
  return entry.replace(/\/+$/, '').replace(/\/\*\*$/, '');
}

export function pathEntriesOverlap(left: string, right: string): boolean {
  const normalizedLeft = canonicalizePathBoundary(normalizePathEntry(left));
  const normalizedRight = canonicalizePathBoundary(normalizePathEntry(right));

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

export function validatePathEntries(
  obj: JsonObject,
  fields: readonly PathField[],
  context: string,
): void {
  for (const field of fields) {
    for (const entry of normalizeList(obj[field])) {
      validatePathEntry(entry, field, context);
    }
  }
}

export function validateWriteBoundaryConflicts(obj: JsonObject, context: string): void {
  const writes = normalizeList(obj.writes);
  const forbidden = normalizeList(obj.forbidden_writes);

  for (const entry of writes) {
    for (const forbiddenEntry of forbidden) {
      if (pathEntriesOverlap(entry, forbiddenEntry)) {
        throw new Error(
          `writes/forbidden_writes conflict "${entry}" <-> "${forbiddenEntry}" in ${context}`,
        );
      }
    }
  }
}

export function extractHandoff(frontmatter: JsonObject, filePath: string): HandoffRef {
  const handoff = frontmatter.handoff;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    throw new Error(`Invalid handoff structure in ${filePath}`);
  }

  const success = String((handoff as JsonObject).success ?? '').trim();
  const failure = String((handoff as JsonObject).failure ?? '').trim();
  if (!success || !failure) {
    throw new Error(`Incomplete handoff structure in ${filePath}`);
  }

  return { success, failure };
}

export function validateHandoff(
  handoff: HandoffRef,
  knownNames: Set<string>,
  context: string,
): void {
  if (!knownNames.has(handoff.success)) {
    throw new Error(`Invalid handoff.success "${handoff.success}" in ${context}`);
  }
  if (!knownNames.has(handoff.failure) && !RESERVED_FAILURE_TARGETS.has(handoff.failure)) {
    throw new Error(`Invalid handoff.failure "${handoff.failure}" in ${context}`);
  }
}

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
  const seen = new Set<string>();
  for (const stage of stages) {
    const canonical = STAGE_ALIASES.get(stage);
    if (canonical) {
      seen.add(canonical);
    } else if (STAGE_MAP.has(stage)) {
      seen.add(stage);
    } else {
      throw new Error(`Invalid stage value: ${stage}`);
    }
  }
  for (const [canonical, display] of STAGE_MAP) {
    if (!seen.has(canonical)) {
      throw new Error(`Missing required stage coverage: ${display}`);
    }
  }
}

// --- Error emission ---

export function emitError(report: ErrorReport): void {
  console.error(JSON.stringify(report));
}

export function emitWarning(
  generator: string,
  code: string,
  message: string,
  opts?: { file?: string; field?: string; details?: string },
): void {
  emitError({ generator, severity: 'warning', code, message, ...opts });
}

// --- Execution ---

function classifyGeneratorError(generator: string, message: string): { report: ErrorReport; exitCode: number } {
  if (message.startsWith('Missing required field "')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'SCHEMA_001',
        message: 'Missing required metadata field',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (
    message.startsWith('Invalid frontmatter block') ||
    message.startsWith('Frontmatter is not a mapping') ||
    message.startsWith('Invalid handoff structure') ||
    message.startsWith('Incomplete handoff structure')
  ) {
    const isHandoff = message.includes('handoff');
    return {
      report: {
        generator,
        severity: 'error',
        code: isHandoff ? 'HANDOFF_001' : 'SCHEMA_002',
        message: isHandoff ? 'Invalid handoff structure' : 'Invalid metadata structure',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (message.startsWith('Invalid handoff.success') || message.startsWith('Invalid handoff.failure')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'HANDOFF_001',
        message: 'Invalid handoff target',
        field: message.includes('handoff.success') ? 'handoff.success' : 'handoff.failure',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (message.startsWith('Unresolved placeholders in ')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'PLACEHOLDER_001',
        message: 'Unresolved placeholder(s)',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (message.startsWith('Missing required stage coverage')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'STAGE_001',
        message: 'Missing required stage coverage',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (message.startsWith('Invalid stage value: ')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'STAGE_002',
        message: 'Invalid stage value',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (message.startsWith('Invalid path entry in ')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'PATH_001',
        message: 'Invalid path entry',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (message.includes('writes') && message.includes('forbidden_writes')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'WRITE_001',
        message: 'Write boundary conflict',
        details: message,
      },
      exitCode: 2,
    };
  }

  if (message.startsWith('Required file not found:') || message.startsWith('PROJECT_PROFILE.yaml must parse')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'IO_001',
        message: 'Input file error',
        details: message,
      },
      exitCode: 1,
    };
  }

  if (message.includes('heading')) {
    return {
      report: {
        generator,
        severity: 'error',
        code: 'HEADING_001',
        message: 'Missing required heading',
        details: message,
      },
      exitCode: 2,
    };
  }

  return {
    report: {
      generator,
      severity: 'error',
      code: 'IO_002',
      message: 'Generator execution failed',
      details: message,
    },
    exitCode: 1,
  };
}

export function executeWrites(
  operations: WriteOperation[],
  dryRun: boolean,
  summary: string,
  prepare?: () => void,
  fileSystem: WriteFs = fs,
): void {
  if (!dryRun) {
    const stagedWrites: Array<{ tempPath: string; targetPath: string }> = [];
    const rollbackEntries: Array<{ targetPath: string; backupPath?: string }> = [];
    let counter = 0;

    try {
      prepare?.();

      for (const op of operations) {
        fileSystem.mkdirSync(path.dirname(op.path), { recursive: true });
        const tempPath = path.join(
          path.dirname(op.path),
          `.${path.basename(op.path)}.${process.pid}.${Date.now()}.${counter++}.tmp`,
        );
        fileSystem.writeFileSync(tempPath, op.content, 'utf8');
        stagedWrites.push({ tempPath, targetPath: op.path });
      }

      for (const staged of stagedWrites) {
        let backupPath: string | undefined;
        if (fileSystem.existsSync(staged.targetPath)) {
          backupPath = `${staged.targetPath}.bak.${process.pid}.${Date.now()}.${counter++}`;
          fileSystem.renameSync(staged.targetPath, backupPath);
        }

        rollbackEntries.push({ targetPath: staged.targetPath, backupPath });
        fileSystem.renameSync(staged.tempPath, staged.targetPath);
      }

      for (const entry of rollbackEntries) {
        if (entry.backupPath && fileSystem.existsSync(entry.backupPath)) {
          fileSystem.rmSync(entry.backupPath, { force: true });
        }
      }
    } catch (error) {
      for (const staged of stagedWrites) {
        if (fileSystem.existsSync(staged.tempPath)) {
          fileSystem.rmSync(staged.tempPath, { force: true });
        }
      }

      for (const entry of [...rollbackEntries].reverse()) {
        if (fileSystem.existsSync(entry.targetPath)) {
          fileSystem.rmSync(entry.targetPath, { force: true });
        }
        if (entry.backupPath && fileSystem.existsSync(entry.backupPath)) {
          fileSystem.renameSync(entry.backupPath, entry.targetPath);
        }
      }

      throw error;
    }
  }
  console.log(`${summary}${dryRun ? ' (dry-run)' : ''}`);
}

export function runGenerator(name: string, main: () => void): void {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { report, exitCode } = classifyGeneratorError(name, message);
    emitError(report);
    console.error(`${name}: generation failed - 1 errors, 0 warnings`);
    process.exit(exitCode);
  }
}
