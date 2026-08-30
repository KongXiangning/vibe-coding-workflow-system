#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';
import { STAGE_ALIASES, STAGE_MAP, resolveRoot } from './workflow-core';

export const WORKFLOW_CAPABILITIES_RELATIVE_PATH = '.workflow-system/WORKFLOW_CAPABILITIES.yaml';
export const WORKFLOW_CAPABILITY_FIXTURES_RELATIVE_PATH = 'test/fixtures/workflow-capability-cases.yaml';
export const WORKFLOW_SKILL_TEMPLATE_RELATIVE_PATH = 'templates/skills';

export const CAPABILITY_SCHEMA_INVALID = 'CAPABILITY_SCHEMA_INVALID' as const;
export const CAPABILITY_DUPLICATE_ID = 'CAPABILITY_DUPLICATE_ID' as const;
export const CAPABILITY_DANGLING_REFERENCE = 'CAPABILITY_DANGLING_REFERENCE' as const;
export const CAPABILITY_STAGE_COVERAGE_MISSING = 'CAPABILITY_STAGE_COVERAGE_MISSING' as const;
export const CAPABILITY_COMPAT_COVERAGE_MISMATCH = 'CAPABILITY_COMPAT_COVERAGE_MISMATCH' as const;
export const CAPABILITY_TERMINAL_HANDOFF_INVALID = 'CAPABILITY_TERMINAL_HANDOFF_INVALID' as const;
export const FIXTURE_SCHEMA_INVALID = 'FIXTURE_SCHEMA_INVALID' as const;
export const FIXTURE_DUPLICATE_ID = 'FIXTURE_DUPLICATE_ID' as const;
export const FIXTURE_COVERAGE_MISMATCH = 'FIXTURE_COVERAGE_MISMATCH' as const;
export const FIXTURE_CAPABILITY_UNRESOLVED = 'FIXTURE_CAPABILITY_UNRESOLVED' as const;

export type WorkflowCapabilityContractErrorCode =
  | typeof CAPABILITY_SCHEMA_INVALID
  | typeof CAPABILITY_DUPLICATE_ID
  | typeof CAPABILITY_DANGLING_REFERENCE
  | typeof CAPABILITY_STAGE_COVERAGE_MISSING
  | typeof CAPABILITY_COMPAT_COVERAGE_MISMATCH
  | typeof CAPABILITY_TERMINAL_HANDOFF_INVALID
  | typeof FIXTURE_SCHEMA_INVALID
  | typeof FIXTURE_DUPLICATE_ID
  | typeof FIXTURE_COVERAGE_MISMATCH
  | typeof FIXTURE_CAPABILITY_UNRESOLVED;

export class WorkflowCapabilityContractError extends Error {
  readonly code: WorkflowCapabilityContractErrorCode;

  constructor(code: WorkflowCapabilityContractErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'WorkflowCapabilityContractError';
    this.code = code;
  }
}

type AnyRecord = Record<string, unknown>;

type ManifestIndex = {
  publicEntries: Map<string, AnyRecord>;
  publicModes: Map<string, AnyRecord>;
  internalCapabilities: Map<string, AnyRecord>;
  runtimeOperations: Map<string, AnyRecord>;
  compatibilityAliases: Map<string, AnyRecord>;
};

export type WorkflowCapabilityValidationSummary = {
  publicEntries: number;
  publicModes: number;
  internalCapabilities: number;
  runtimeOperations: number;
  compatibilityAliases: number;
  fixtures: number;
  rowFixtures: number;
  globalFixtures: number;
  classifications: Record<'keep' | 'merge' | 'runtime' | 'delete', number>;
};

export type LegacySkillTemplateContract = {
  name: string;
  stage: string;
  writes: string[];
  handoffSuccess: string;
  handoffFailure: string;
  conditionalHandoffs: string[];
};

const PUBLIC_ENTRY_IDS = [
  'bootstrap-project',
  'prepare-task',
  'execute-step',
  'review-change',
  'validate-change',
  'debug-task',
  'task-lifecycle',
  'capture-work-item',
  'sync-state',
  'close-task',
] as const;

const INTERNAL_KINDS = new Set(['policy', 'resolver', 'validator', 'gate', 'router']);
const AUTHORITY_OWNERS = new Set(['protocol', 'model', 'user', 'runtime']);
const MUTATIONS = new Set(['none', 'code', 'task-artifact', 'semantic-proposal']);
const TERMINAL_BEHAVIORS = new Set(['continue', 'report-only', 'manual-decision', 'complete']);
const PROTOCOL_AUTHORITIES = new Set(['define', 'validate', 'none']);
const MODEL_AUTHORITIES = new Set(['propose', 'classify', 'none']);
const USER_AUTHORITIES = new Set(['confirm', 'approve', 'none']);
const RUNTIME_AUTHORITIES = new Set(['validate-and-commit', 'none']);
const CLASSIFICATIONS = new Set(['keep', 'merge', 'runtime', 'delete']);
const RESULT_STATES = ['success', 'no-op', 'conflict', 'blocked'] as const;
const RUNTIME_STATE_SOURCES = new Set([
  'docs/workflow/CURRENT_TASK.md',
  'docs/workflow/STATUS.md',
  'docs/workflow/CONTRACTS.md',
  'docs/workflow/DECISIONS.md',
  'docs/workflow/LESSONS.md',
  'AGENTS.md',
  'CLAUDE.md',
  'TASKS/paused',
  'TASKS/interrupted',
  'TASKS/inbox',
  'TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md',
]);
const RUNTIME_WRITE_TARGETS = new Set([
  'docs/workflow/CURRENT_TASK.md',
  'docs/workflow/STATUS.md',
  'docs/workflow/CONTRACTS.md',
  'docs/workflow/DECISIONS.md',
  'docs/workflow/LESSONS.md',
  'AGENTS.md',
  'CLAUDE.md',
  'TASKS/paused/**',
  'TASKS/interrupted/**',
  'TASKS/inbox/**',
  'TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md',
]);
const FIXTURE_KINDS = new Set(['row', 'global']);
const FIXTURE_GUARDS = new Set(['allow', 'block', 'ask-user', 'no-op']);
const FIXTURE_DIFF_TARGETS = new Set(['preserve', 'required', 'forbidden', 'not-applicable']);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CAPABILITY_TOP_LEVEL_FIELDS = [
  'schema_version',
  'status',
  'public_entries',
  'internal_capabilities',
  'runtime_operations',
  'compatibility_aliases',
] as const;
const PUBLIC_ENTRY_FIELDS = ['id', 'exposure', 'status', 'installable', 'modes'] as const;
const PUBLIC_MODE_FIELDS = [
  'id',
  'covers_stages',
  'capabilities',
  'runtime_operations',
  'mutation',
  'terminal_behavior',
  'authority_boundary',
  'automatic_handoff',
] as const;
const AUTHORITY_BOUNDARY_FIELDS = ['protocol', 'model', 'user', 'runtime'] as const;
const INTERNAL_CAPABILITY_FIELDS = [
  'id',
  'exposure',
  'installable',
  'kind',
  'authority_owner',
  'description',
] as const;
const RUNTIME_OPERATION_FIELDS = [
  'id',
  'exposure',
  'installable',
  'proposal_kind',
  'proposal_schema_ref',
  'canonical_state_sources',
  'write_targets',
  'write_policy',
  'source_tuple_required',
  'authority_evidence_required',
  'conflict_key',
  'atomic',
  'idempotence',
  'conflict_policy',
  'result_states',
] as const;
const COMPATIBILITY_ALIAS_FIELDS = [
  'legacy_name',
  'exposure',
  'classification',
  'status',
  'installable',
  'target_entry',
  'target_mode',
  'required_capabilities',
  'runtime_operations',
  'migration_case',
  'preserve_handoff',
  'preserve_writes',
] as const;
const FIXTURE_TOP_LEVEL_FIELDS = ['schema_version', 'cases'] as const;
const FIXTURE_CASE_FIELDS = [
  'id',
  'kind',
  'invariant',
  'capability_refs',
  'initial_state',
  'invocation',
  'expected',
] as const;
const FIXTURE_INITIAL_STATE_FIELDS = [
  'task_status',
  'lifecycle_state',
  'diff_target',
  'evidence',
] as const;
const FIXTURE_INVOCATION_FIELDS = ['entry', 'mode', 'legacy_alias'] as const;
const FIXTURE_EXPECTED_FIELDS = [
  'guard',
  'verdict',
  'writes',
  'handoff',
  'terminal_behavior',
  'diff_target',
  'evidence',
] as const;

function fail(code: WorkflowCapabilityContractErrorCode, message: string): never {
  throw new WorkflowCapabilityContractError(code, message);
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(
  value: unknown,
  location: string,
  code: WorkflowCapabilityContractErrorCode,
): AnyRecord {
  if (!isRecord(value)) {
    fail(code, `${location} must be a mapping.`);
  }
  return value;
}

function expectExactFields(
  value: AnyRecord,
  fields: readonly string[],
  location: string,
  code: WorkflowCapabilityContractErrorCode,
): void {
  const expected = new Set(fields);
  const missing = fields.filter(field => !(field in value));
  const extra = Object.keys(value).filter(field => !expected.has(field));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      code,
      `${location} fields differ from schema; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}].`,
    );
  }
}

function expectArray(
  value: unknown,
  location: string,
  code: WorkflowCapabilityContractErrorCode,
  allowEmpty = false,
): unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(code, `${location} must be ${allowEmpty ? 'an array' : 'a non-empty array'}.`);
  }
  return value;
}

function expectString(
  value: unknown,
  location: string,
  code: WorkflowCapabilityContractErrorCode,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, `${location} must be a non-empty string.`);
  }
  return value;
}

function expectId(
  value: unknown,
  location: string,
  code: WorkflowCapabilityContractErrorCode,
): string {
  const id = expectString(value, location, code);
  if (!ID_PATTERN.test(id)) {
    fail(code, `${location} must use lowercase kebab-case. Got "${id}".`);
  }
  return id;
}

function expectLiteral<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  location: string,
  code: WorkflowCapabilityContractErrorCode,
): T {
  if (value !== expected) {
    fail(code, `${location} must be ${JSON.stringify(expected)}. Got ${JSON.stringify(value)}.`);
  }
  return expected;
}

function expectEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  location: string,
  code: WorkflowCapabilityContractErrorCode,
): string {
  const normalized = expectString(value, location, code);
  if (!allowed.has(normalized)) {
    fail(code, `${location} must be one of [${[...allowed].join(', ')}]. Got "${normalized}".`);
  }
  return normalized;
}

function expectStringArray(
  value: unknown,
  location: string,
  code: WorkflowCapabilityContractErrorCode,
  allowEmpty = false,
): string[] {
  const items = expectArray(value, location, code, allowEmpty).map((item, index) =>
    expectString(item, `${location}[${index}]`, code),
  );
  const unique = new Set(items);
  if (unique.size !== items.length) {
    fail(code, `${location} contains duplicate values.`);
  }
  return items;
}

function expectUniqueId(
  map: Map<string, AnyRecord>,
  id: string,
  value: AnyRecord,
  location: string,
): void {
  if (map.has(id)) {
    fail(CAPABILITY_DUPLICATE_ID, `${location} duplicates id "${id}".`);
  }
  map.set(id, value);
}

function sameStringSet(left: Iterable<string>, right: Iterable<string>): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every(value => rightSet.has(value));
}

function formatSetDifference(expected: Iterable<string>, actual: Iterable<string>): string {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter(value => !actualSet.has(value));
  const extra = [...actualSet].filter(value => !expectedSet.has(value));
  return `missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`;
}

function parseYamlMapping(
  content: string,
  file: string,
  code: typeof CAPABILITY_SCHEMA_INVALID | typeof FIXTURE_SCHEMA_INVALID,
): AnyRecord {
  const document = parseDocument(content, { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    fail(code, `${file} is invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  }
  return expectRecord(document.toJS(), file, code);
}

export function parseWorkflowCapabilityManifest(content: string): AnyRecord {
  return parseYamlMapping(content, WORKFLOW_CAPABILITIES_RELATIVE_PATH, CAPABILITY_SCHEMA_INVALID);
}

export function parseWorkflowCapabilityFixtures(content: string): AnyRecord {
  return parseYamlMapping(content, WORKFLOW_CAPABILITY_FIXTURES_RELATIVE_PATH, FIXTURE_SCHEMA_INVALID);
}

function expectedRowFixtureIds(): string[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => `MR-K${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 20 }, (_, index) => `MR-M${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 7 }, (_, index) => `MR-R${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 5 }, (_, index) => `MR-D${String(index + 1).padStart(2, '0')}`),
  ];
}

function expectedGlobalFixtureIds(): string[] {
  return Array.from({ length: 18 }, (_, index) => `GR-${String(index + 1).padStart(2, '0')}`);
}

function classificationPrefix(classification: string): string {
  const prefixes: Record<string, string> = {
    keep: 'MR-K',
    merge: 'MR-M',
    runtime: 'MR-R',
    delete: 'MR-D',
  };
  return prefixes[classification] ?? '';
}

function validateCapabilityManifest(manifestValue: unknown, templateNames: readonly string[]): ManifestIndex {
  const manifest = expectRecord(manifestValue, 'capability manifest', CAPABILITY_SCHEMA_INVALID);
  expectExactFields(manifest, CAPABILITY_TOP_LEVEL_FIELDS, 'capability manifest', CAPABILITY_SCHEMA_INVALID);
  expectLiteral(manifest.schema_version, 1, 'capability manifest.schema_version', CAPABILITY_SCHEMA_INVALID);
  expectLiteral(manifest.status, 'shadow', 'capability manifest.status', CAPABILITY_SCHEMA_INVALID);

  const publicEntries = new Map<string, AnyRecord>();
  const publicModes = new Map<string, AnyRecord>();
  const internalCapabilities = new Map<string, AnyRecord>();
  const runtimeOperations = new Map<string, AnyRecord>();
  const compatibilityAliases = new Map<string, AnyRecord>();
  const stageCoverage = new Set<string>();

  const publicEntryValues = expectArray(
    manifest.public_entries,
    'capability manifest.public_entries',
    CAPABILITY_SCHEMA_INVALID,
  );
  for (const [entryIndex, entryValue] of publicEntryValues.entries()) {
    const location = `capability manifest.public_entries[${entryIndex}]`;
    const entry = expectRecord(entryValue, location, CAPABILITY_SCHEMA_INVALID);
    expectExactFields(entry, PUBLIC_ENTRY_FIELDS, location, CAPABILITY_SCHEMA_INVALID);
    const entryId = expectId(entry.id, `${location}.id`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(entry.exposure, 'public', `${location}.exposure`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(entry.status, 'shadow', `${location}.status`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(entry.installable, false, `${location}.installable`, CAPABILITY_SCHEMA_INVALID);
    expectUniqueId(publicEntries, entryId, entry, location);

    const modeValues = expectArray(entry.modes, `${location}.modes`, CAPABILITY_SCHEMA_INVALID);
    const entryModeIds = new Set<string>();
    for (const [modeIndex, modeValue] of modeValues.entries()) {
      const modeLocation = `${location}.modes[${modeIndex}]`;
      const mode = expectRecord(modeValue, modeLocation, CAPABILITY_SCHEMA_INVALID);
      expectExactFields(mode, PUBLIC_MODE_FIELDS, modeLocation, CAPABILITY_SCHEMA_INVALID);
      const modeId = expectId(mode.id, `${modeLocation}.id`, CAPABILITY_SCHEMA_INVALID);
      if (entryModeIds.has(modeId)) {
        fail(CAPABILITY_DUPLICATE_ID, `${modeLocation} duplicates mode id "${modeId}" within "${entryId}".`);
      }
      entryModeIds.add(modeId);
      const modeKey = `${entryId}:${modeId}`;
      expectUniqueId(publicModes, modeKey, mode, modeLocation);

      for (const stage of expectStringArray(
        mode.covers_stages,
        `${modeLocation}.covers_stages`,
        CAPABILITY_SCHEMA_INVALID,
      )) {
        stageCoverage.add(stage);
      }
      expectStringArray(mode.capabilities, `${modeLocation}.capabilities`, CAPABILITY_SCHEMA_INVALID, true);
      const runtimeReferences = expectStringArray(
        mode.runtime_operations,
        `${modeLocation}.runtime_operations`,
        CAPABILITY_SCHEMA_INVALID,
        true,
      );
      expectEnum(mode.mutation, MUTATIONS, `${modeLocation}.mutation`, CAPABILITY_SCHEMA_INVALID);
      expectEnum(
        mode.terminal_behavior,
        TERMINAL_BEHAVIORS,
        `${modeLocation}.terminal_behavior`,
        CAPABILITY_SCHEMA_INVALID,
      );
      const authority = expectRecord(
        mode.authority_boundary,
        `${modeLocation}.authority_boundary`,
        CAPABILITY_SCHEMA_INVALID,
      );
      expectExactFields(
        authority,
        AUTHORITY_BOUNDARY_FIELDS,
        `${modeLocation}.authority_boundary`,
        CAPABILITY_SCHEMA_INVALID,
      );
      expectEnum(
        authority.protocol,
        PROTOCOL_AUTHORITIES,
        `${modeLocation}.authority_boundary.protocol`,
        CAPABILITY_SCHEMA_INVALID,
      );
      expectEnum(
        authority.model,
        MODEL_AUTHORITIES,
        `${modeLocation}.authority_boundary.model`,
        CAPABILITY_SCHEMA_INVALID,
      );
      expectEnum(
        authority.user,
        USER_AUTHORITIES,
        `${modeLocation}.authority_boundary.user`,
        CAPABILITY_SCHEMA_INVALID,
      );
      const runtimeAuthority = expectEnum(
        authority.runtime,
        RUNTIME_AUTHORITIES,
        `${modeLocation}.authority_boundary.runtime`,
        CAPABILITY_SCHEMA_INVALID,
      );
      if (runtimeReferences.length > 0 && runtimeAuthority !== 'validate-and-commit') {
        fail(CAPABILITY_SCHEMA_INVALID, `${modeLocation} references Runtime operations without Runtime commit authority.`);
      }
      if (runtimeReferences.length === 0 && runtimeAuthority !== 'none') {
        fail(CAPABILITY_SCHEMA_INVALID, `${modeLocation} declares Runtime commit authority without a Runtime operation.`);
      }
      expectString(mode.automatic_handoff, `${modeLocation}.automatic_handoff`, CAPABILITY_SCHEMA_INVALID);
    }
  }

  if (!sameStringSet(publicEntries.keys(), PUBLIC_ENTRY_IDS)) {
    fail(
      CAPABILITY_SCHEMA_INVALID,
      `public entry set differs from protocol: ${formatSetDifference(PUBLIC_ENTRY_IDS, publicEntries.keys())}.`,
    );
  }

  const canonicalStages = new Set(STAGE_MAP.keys());
  if (!sameStringSet(stageCoverage, canonicalStages)) {
    fail(
      CAPABILITY_STAGE_COVERAGE_MISSING,
      `public mode stage union differs from the canonical stage set: ${formatSetDifference(canonicalStages, stageCoverage)}.`,
    );
  }

  const internalValues = expectArray(
    manifest.internal_capabilities,
    'capability manifest.internal_capabilities',
    CAPABILITY_SCHEMA_INVALID,
  );
  for (const [index, internalValue] of internalValues.entries()) {
    const location = `capability manifest.internal_capabilities[${index}]`;
    const capability = expectRecord(internalValue, location, CAPABILITY_SCHEMA_INVALID);
    expectExactFields(capability, INTERNAL_CAPABILITY_FIELDS, location, CAPABILITY_SCHEMA_INVALID);
    const id = expectId(capability.id, `${location}.id`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(capability.exposure, 'internal', `${location}.exposure`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(capability.installable, false, `${location}.installable`, CAPABILITY_SCHEMA_INVALID);
    expectEnum(capability.kind, INTERNAL_KINDS, `${location}.kind`, CAPABILITY_SCHEMA_INVALID);
    expectEnum(
      capability.authority_owner,
      AUTHORITY_OWNERS,
      `${location}.authority_owner`,
      CAPABILITY_SCHEMA_INVALID,
    );
    expectString(capability.description, `${location}.description`, CAPABILITY_SCHEMA_INVALID);
    expectUniqueId(internalCapabilities, id, capability, location);
  }

  const runtimeValues = expectArray(
    manifest.runtime_operations,
    'capability manifest.runtime_operations',
    CAPABILITY_SCHEMA_INVALID,
  );
  for (const [index, runtimeValue] of runtimeValues.entries()) {
    const location = `capability manifest.runtime_operations[${index}]`;
    const operation = expectRecord(runtimeValue, location, CAPABILITY_SCHEMA_INVALID);
    expectExactFields(operation, RUNTIME_OPERATION_FIELDS, location, CAPABILITY_SCHEMA_INVALID);
    const id = expectId(operation.id, `${location}.id`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(operation.exposure, 'runtime', `${location}.exposure`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(operation.installable, false, `${location}.installable`, CAPABILITY_SCHEMA_INVALID);
    expectId(operation.proposal_kind, `${location}.proposal_kind`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(
      operation.proposal_schema_ref,
      'runtime-proposal-envelope',
      `${location}.proposal_schema_ref`,
      CAPABILITY_SCHEMA_INVALID,
    );
    const sources = expectStringArray(
      operation.canonical_state_sources,
      `${location}.canonical_state_sources`,
      CAPABILITY_SCHEMA_INVALID,
    );
    for (const source of sources) {
      const normalized = source.replace(/\\/g, '/');
      if (!RUNTIME_STATE_SOURCES.has(normalized)) {
        fail(
          CAPABILITY_SCHEMA_INVALID,
          `${location} declares state source "${source}" outside the Phase 0 canonical source allowlist.`,
        );
      }
    }
    const writeTargets = expectStringArray(
      operation.write_targets,
      `${location}.write_targets`,
      CAPABILITY_SCHEMA_INVALID,
    );
    for (const target of writeTargets) {
      const normalized = target.replace(/\\/g, '/');
      if (!RUNTIME_WRITE_TARGETS.has(normalized)) {
        fail(
          CAPABILITY_SCHEMA_INVALID,
          `${location} declares write target "${target}" outside the Phase 0 exact allowlist.`,
        );
      }
    }
    expectLiteral(operation.write_policy, 'exact-allowlist', `${location}.write_policy`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(
      operation.source_tuple_required,
      true,
      `${location}.source_tuple_required`,
      CAPABILITY_SCHEMA_INVALID,
    );
    expectLiteral(
      operation.authority_evidence_required,
      true,
      `${location}.authority_evidence_required`,
      CAPABILITY_SCHEMA_INVALID,
    );
    expectString(operation.conflict_key, `${location}.conflict_key`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(operation.atomic, true, `${location}.atomic`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(operation.idempotence, 'fail-closed', `${location}.idempotence`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(operation.conflict_policy, 'fail-closed', `${location}.conflict_policy`, CAPABILITY_SCHEMA_INVALID);
    const resultStates = expectStringArray(
      operation.result_states,
      `${location}.result_states`,
      CAPABILITY_SCHEMA_INVALID,
    );
    if (!sameStringSet(resultStates, RESULT_STATES)) {
      fail(
        CAPABILITY_SCHEMA_INVALID,
        `${location}.result_states differs from the required result set: ${formatSetDifference(RESULT_STATES, resultStates)}.`,
      );
    }
    expectUniqueId(runtimeOperations, id, operation, location);
  }

  const canonicalLayerIds = new Set<string>();
  for (const [layer, ids] of [
    ['public', publicEntries.keys()],
    ['internal', internalCapabilities.keys()],
    ['runtime', runtimeOperations.keys()],
  ] as const) {
    for (const id of ids) {
      if (canonicalLayerIds.has(id)) {
        fail(CAPABILITY_DUPLICATE_ID, `canonical capability id "${id}" is declared in more than one layer; latest=${layer}.`);
      }
      canonicalLayerIds.add(id);
    }
  }

  const aliasValues = expectArray(
    manifest.compatibility_aliases,
    'capability manifest.compatibility_aliases',
    CAPABILITY_SCHEMA_INVALID,
  );
  const migrationCases = new Set<string>();
  for (const [index, aliasValue] of aliasValues.entries()) {
    const location = `capability manifest.compatibility_aliases[${index}]`;
    const alias = expectRecord(aliasValue, location, CAPABILITY_SCHEMA_INVALID);
    expectExactFields(alias, COMPATIBILITY_ALIAS_FIELDS, location, CAPABILITY_SCHEMA_INVALID);
    const legacyName = expectId(alias.legacy_name, `${location}.legacy_name`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(alias.exposure, 'compat', `${location}.exposure`, CAPABILITY_SCHEMA_INVALID);
    const classification = expectEnum(
      alias.classification,
      CLASSIFICATIONS,
      `${location}.classification`,
      CAPABILITY_SCHEMA_INVALID,
    );
    expectLiteral(alias.status, 'active', `${location}.status`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(alias.installable, true, `${location}.installable`, CAPABILITY_SCHEMA_INVALID);
    const targetEntry = expectId(alias.target_entry, `${location}.target_entry`, CAPABILITY_SCHEMA_INVALID);
    const targetMode = expectId(alias.target_mode, `${location}.target_mode`, CAPABILITY_SCHEMA_INVALID);
    const requiredCapabilities = expectStringArray(
      alias.required_capabilities,
      `${location}.required_capabilities`,
      CAPABILITY_SCHEMA_INVALID,
    );
    const aliasRuntimeOperations = expectStringArray(
      alias.runtime_operations,
      `${location}.runtime_operations`,
      CAPABILITY_SCHEMA_INVALID,
      true,
    );
    const migrationCase = expectString(alias.migration_case, `${location}.migration_case`, CAPABILITY_SCHEMA_INVALID);
    if (!migrationCase.startsWith(classificationPrefix(classification))) {
      fail(
        CAPABILITY_SCHEMA_INVALID,
        `${location}.migration_case "${migrationCase}" does not match classification "${classification}".`,
      );
    }
    if (migrationCases.has(migrationCase)) {
      fail(CAPABILITY_DUPLICATE_ID, `${location}.migration_case duplicates "${migrationCase}".`);
    }
    migrationCases.add(migrationCase);
    expectLiteral(alias.preserve_handoff, true, `${location}.preserve_handoff`, CAPABILITY_SCHEMA_INVALID);
    expectLiteral(alias.preserve_writes, true, `${location}.preserve_writes`, CAPABILITY_SCHEMA_INVALID);
    const targetModeContract = publicModes.get(`${targetEntry}:${targetMode}`);
    if (!targetModeContract) {
      fail(
        CAPABILITY_DANGLING_REFERENCE,
        `${location} targets missing public mode "${targetEntry}:${targetMode}".`,
      );
    }
    if (!sameStringSet(requiredCapabilities, targetModeContract.capabilities as string[])) {
      fail(
        CAPABILITY_COMPAT_COVERAGE_MISMATCH,
        `${location}.required_capabilities differs from target mode: ${formatSetDifference(targetModeContract.capabilities as string[], requiredCapabilities)}.`,
      );
    }
    if (!sameStringSet(aliasRuntimeOperations, targetModeContract.runtime_operations as string[])) {
      fail(
        CAPABILITY_COMPAT_COVERAGE_MISMATCH,
        `${location}.runtime_operations differs from target mode: ${formatSetDifference(targetModeContract.runtime_operations as string[], aliasRuntimeOperations)}.`,
      );
    }
    expectUniqueId(compatibilityAliases, legacyName, alias, location);
  }

  const expectedMigrationCases = expectedRowFixtureIds();
  if (!sameStringSet(migrationCases, expectedMigrationCases)) {
    fail(
      CAPABILITY_COMPAT_COVERAGE_MISMATCH,
      `compat migration-case set differs from the audited row set: ${formatSetDifference(expectedMigrationCases, migrationCases)}.`,
    );
  }

  if (new Set(templateNames).size !== templateNames.length) {
    fail(CAPABILITY_COMPAT_COVERAGE_MISMATCH, 'template Skill names contain duplicates.');
  }
  if (!sameStringSet(compatibilityAliases.keys(), templateNames)) {
    fail(
      CAPABILITY_COMPAT_COVERAGE_MISMATCH,
      `compat alias set differs from template Skill names: ${formatSetDifference(templateNames, compatibilityAliases.keys())}.`,
    );
  }

  for (const [modeKey, mode] of publicModes) {
    for (const capabilityId of mode.capabilities as string[]) {
      if (!internalCapabilities.has(capabilityId)) {
        fail(CAPABILITY_DANGLING_REFERENCE, `${modeKey} references missing internal capability "${capabilityId}".`);
      }
    }
    for (const operationId of mode.runtime_operations as string[]) {
      if (!runtimeOperations.has(operationId)) {
        fail(CAPABILITY_DANGLING_REFERENCE, `${modeKey} references missing Runtime operation "${operationId}".`);
      }
    }
    const userAuthorityCapabilities = (mode.capabilities as string[]).filter(
      capabilityId => internalCapabilities.get(capabilityId)?.authority_owner === 'user',
    );
    const authority = mode.authority_boundary as AnyRecord;
    if (userAuthorityCapabilities.length > 0 && authority.user === 'none') {
      fail(
        CAPABILITY_SCHEMA_INVALID,
        `${modeKey} references user-owned gates [${userAuthorityCapabilities.join(', ')}] but declares user authority as none.`,
      );
    }
    const handoff = mode.automatic_handoff as string;
    const terminal = mode.terminal_behavior as string;
    if (handoff !== 'not-applicable' && !publicModes.has(handoff)) {
      fail(CAPABILITY_DANGLING_REFERENCE, `${modeKey} has dangling automatic handoff "${handoff}".`);
    }
    if ((terminal === 'report-only' || terminal === 'manual-decision') && handoff !== 'not-applicable') {
      fail(
        CAPABILITY_TERMINAL_HANDOFF_INVALID,
        `${modeKey} is ${terminal} but declares executable automatic handoff "${handoff}".`,
      );
    }
  }

  for (const [legacyName, alias] of compatibilityAliases) {
    for (const capabilityId of alias.required_capabilities as string[]) {
      if (!internalCapabilities.has(capabilityId)) {
        fail(
          CAPABILITY_DANGLING_REFERENCE,
          `compat alias "${legacyName}" references missing internal capability "${capabilityId}".`,
        );
      }
    }
    for (const operationId of alias.runtime_operations as string[]) {
      if (!runtimeOperations.has(operationId)) {
        fail(
          CAPABILITY_DANGLING_REFERENCE,
          `compat alias "${legacyName}" references missing Runtime operation "${operationId}".`,
        );
      }
    }
  }

  return {
    publicEntries,
    publicModes,
    internalCapabilities,
    runtimeOperations,
    compatibilityAliases,
  };
}

function validateLegacyTemplateContracts(
  index: ManifestIndex,
  templateContracts: readonly LegacySkillTemplateContract[],
): void {
  const contracts = new Map<string, LegacySkillTemplateContract>();
  for (const contract of templateContracts) {
    if (contracts.has(contract.name)) {
      fail(CAPABILITY_COMPAT_COVERAGE_MISMATCH, `legacy template contract duplicates "${contract.name}".`);
    }
    contracts.set(contract.name, contract);
  }
  if (!sameStringSet(contracts.keys(), index.compatibilityAliases.keys())) {
    fail(
      CAPABILITY_COMPAT_COVERAGE_MISMATCH,
      `legacy template contracts differ from compatibility aliases: ${formatSetDifference(index.compatibilityAliases.keys(), contracts.keys())}.`,
    );
  }

  for (const [legacyName, alias] of index.compatibilityAliases) {
    const contract = contracts.get(legacyName)!;
    const modeKey = `${String(alias.target_entry)}:${String(alias.target_mode)}`;
    const targetMode = index.publicModes.get(modeKey)!;
    const coveredStages = targetMode.covers_stages as string[];
    if (!coveredStages.includes(contract.stage)) {
      fail(
        CAPABILITY_COMPAT_COVERAGE_MISMATCH,
        `${legacyName} legacy stage "${contract.stage}" is not covered by target mode ${modeKey}.`,
      );
    }
    const legacyIsReadOnly = contract.writes.length === 0;
    const targetIsReadOnly = targetMode.mutation === 'none';
    if (legacyIsReadOnly !== targetIsReadOnly) {
      fail(
        CAPABILITY_COMPAT_COVERAGE_MISMATCH,
        `${legacyName} legacy write class (${legacyIsReadOnly ? 'read-only' : 'writer'}) differs from target mode ${modeKey} mutation "${String(targetMode.mutation)}".`,
      );
    }
  }
}

function resolveFixtureCapabilityRef(ref: string, index: ManifestIndex, caseId: string): void {
  const publicMatch = /^public:([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(ref);
  if (publicMatch) {
    if (!index.publicModes.has(`${publicMatch[1]}:${publicMatch[2]}`)) {
      fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} references missing public mode "${ref}".`);
    }
    return;
  }
  const internalMatch = /^internal:([a-z0-9-]+)$/.exec(ref);
  if (internalMatch) {
    if (!index.internalCapabilities.has(internalMatch[1])) {
      fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} references missing internal capability "${ref}".`);
    }
    return;
  }
  const runtimeMatch = /^runtime:([a-z0-9-]+)$/.exec(ref);
  if (runtimeMatch) {
    if (!index.runtimeOperations.has(runtimeMatch[1])) {
      fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} references missing Runtime operation "${ref}".`);
    }
    return;
  }
  fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} has invalid capability reference syntax "${ref}".`);
}

function validateFixtureManifest(fixturesValue: unknown, index: ManifestIndex): {
  cases: AnyRecord[];
  rowCases: number;
  globalCases: number;
} {
  const fixtures = expectRecord(fixturesValue, 'fixture manifest', FIXTURE_SCHEMA_INVALID);
  expectExactFields(fixtures, FIXTURE_TOP_LEVEL_FIELDS, 'fixture manifest', FIXTURE_SCHEMA_INVALID);
  expectLiteral(fixtures.schema_version, 1, 'fixture manifest.schema_version', FIXTURE_SCHEMA_INVALID);
  const cases = expectArray(fixtures.cases, 'fixture manifest.cases', FIXTURE_SCHEMA_INVALID).map((value, caseIndex) => {
    const location = `fixture manifest.cases[${caseIndex}]`;
    const fixtureCase = expectRecord(value, location, FIXTURE_SCHEMA_INVALID);
    expectExactFields(fixtureCase, FIXTURE_CASE_FIELDS, location, FIXTURE_SCHEMA_INVALID);
    return fixtureCase;
  });

  const caseIds = new Set<string>();
  let rowCases = 0;
  let globalCases = 0;
  for (const [caseIndex, fixtureCase] of cases.entries()) {
    const location = `fixture manifest.cases[${caseIndex}]`;
    const caseId = expectString(fixtureCase.id, `${location}.id`, FIXTURE_SCHEMA_INVALID);
    if (caseIds.has(caseId)) {
      fail(FIXTURE_DUPLICATE_ID, `${location}.id duplicates "${caseId}".`);
    }
    caseIds.add(caseId);
    const kind = expectEnum(fixtureCase.kind, FIXTURE_KINDS, `${location}.kind`, FIXTURE_SCHEMA_INVALID);
    if (caseId.startsWith('MR-') && kind !== 'row') {
      fail(FIXTURE_SCHEMA_INVALID, `${caseId} must use kind=row.`);
    }
    if (caseId.startsWith('GR-') && kind !== 'global') {
      fail(FIXTURE_SCHEMA_INVALID, `${caseId} must use kind=global.`);
    }
    rowCases += kind === 'row' ? 1 : 0;
    globalCases += kind === 'global' ? 1 : 0;
    expectString(fixtureCase.invariant, `${location}.invariant`, FIXTURE_SCHEMA_INVALID);
    const capabilityRefs = expectStringArray(
      fixtureCase.capability_refs,
      `${location}.capability_refs`,
      FIXTURE_SCHEMA_INVALID,
    );
    for (const ref of capabilityRefs) {
      resolveFixtureCapabilityRef(ref, index, caseId);
    }

    const initialState = expectRecord(fixtureCase.initial_state, `${location}.initial_state`, FIXTURE_SCHEMA_INVALID);
    expectExactFields(
      initialState,
      FIXTURE_INITIAL_STATE_FIELDS,
      `${location}.initial_state`,
      FIXTURE_SCHEMA_INVALID,
    );
    expectString(initialState.task_status, `${location}.initial_state.task_status`, FIXTURE_SCHEMA_INVALID);
    expectString(initialState.lifecycle_state, `${location}.initial_state.lifecycle_state`, FIXTURE_SCHEMA_INVALID);
    expectString(initialState.diff_target, `${location}.initial_state.diff_target`, FIXTURE_SCHEMA_INVALID);
    expectStringArray(initialState.evidence, `${location}.initial_state.evidence`, FIXTURE_SCHEMA_INVALID);

    const invocation = expectRecord(fixtureCase.invocation, `${location}.invocation`, FIXTURE_SCHEMA_INVALID);
    expectExactFields(
      invocation,
      FIXTURE_INVOCATION_FIELDS,
      `${location}.invocation`,
      FIXTURE_SCHEMA_INVALID,
    );
    const entryId = expectId(invocation.entry, `${location}.invocation.entry`, FIXTURE_SCHEMA_INVALID);
    const modeId = expectId(invocation.mode, `${location}.invocation.mode`, FIXTURE_SCHEMA_INVALID);
    const publicModeKey = `${entryId}:${modeId}`;
    const publicMode = index.publicModes.get(publicModeKey);
    if (!publicMode) {
      fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} invokes missing public mode "${publicModeKey}".`);
    }
    const legacyAlias = expectString(
      invocation.legacy_alias,
      `${location}.invocation.legacy_alias`,
      FIXTURE_SCHEMA_INVALID,
    );

    if (kind === 'row') {
      if (legacyAlias === 'not-applicable') {
        fail(FIXTURE_COVERAGE_MISMATCH, `${caseId} row fixture must identify its legacy alias.`);
      }
      const alias = index.compatibilityAliases.get(legacyAlias);
      if (!alias) {
        fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} references missing legacy alias "${legacyAlias}".`);
      }
      if (alias.migration_case !== caseId) {
        fail(
          FIXTURE_COVERAGE_MISMATCH,
          `${caseId} does not match ${legacyAlias}.migration_case "${String(alias.migration_case)}".`,
        );
      }
      if (alias.target_entry !== entryId || alias.target_mode !== modeId) {
        fail(
          FIXTURE_COVERAGE_MISMATCH,
          `${caseId} invocation "${publicModeKey}" differs from alias target "${String(alias.target_entry)}:${String(alias.target_mode)}".`,
        );
      }
      const requiredRefs = [
        `public:${entryId}/${modeId}`,
        ...(alias.required_capabilities as string[]).map(id => `internal:${id}`),
        ...(alias.runtime_operations as string[]).map(id => `runtime:${id}`),
      ];
      if (!sameStringSet(capabilityRefs, requiredRefs)) {
        fail(
          FIXTURE_CAPABILITY_UNRESOLVED,
          `${caseId} capability refs differ from its alias mapping: ${formatSetDifference(requiredRefs, capabilityRefs)}.`,
        );
      }
    } else if (legacyAlias !== 'not-applicable' && !index.compatibilityAliases.has(legacyAlias)) {
      fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} references missing optional legacy alias "${legacyAlias}".`);
    }

    const expected = expectRecord(fixtureCase.expected, `${location}.expected`, FIXTURE_SCHEMA_INVALID);
    expectExactFields(expected, FIXTURE_EXPECTED_FIELDS, `${location}.expected`, FIXTURE_SCHEMA_INVALID);
    const guard = expectEnum(expected.guard, FIXTURE_GUARDS, `${location}.expected.guard`, FIXTURE_SCHEMA_INVALID);
    expectString(expected.verdict, `${location}.expected.verdict`, FIXTURE_SCHEMA_INVALID);
    const writes = expectStringArray(expected.writes, `${location}.expected.writes`, FIXTURE_SCHEMA_INVALID, true);
    for (const write of writes) {
      const normalized = write.replace(/\\/g, '/');
      if (
        (!normalized.includes('/') && !normalized.endsWith('.md')) ||
        normalized.startsWith('/') ||
        /^[A-Za-z]:\//.test(normalized) ||
        normalized.split('/').includes('..')
      ) {
        fail(FIXTURE_SCHEMA_INVALID, `${caseId} expected write "${write}" is not a bounded repo-relative path.`);
      }
    }
    const handoff = expectString(expected.handoff, `${location}.expected.handoff`, FIXTURE_SCHEMA_INVALID);
    if (handoff !== 'not-applicable' && handoff !== 'ask-user' && !index.publicModes.has(handoff)) {
      fail(FIXTURE_CAPABILITY_UNRESOLVED, `${caseId} expects missing handoff "${handoff}".`);
    }
    const terminal = expectEnum(
      expected.terminal_behavior,
      TERMINAL_BEHAVIORS,
      `${location}.expected.terminal_behavior`,
      FIXTURE_SCHEMA_INVALID,
    );
    expectEnum(
      expected.diff_target,
      FIXTURE_DIFF_TARGETS,
      `${location}.expected.diff_target`,
      FIXTURE_SCHEMA_INVALID,
    );
    expectStringArray(expected.evidence, `${location}.expected.evidence`, FIXTURE_SCHEMA_INVALID);

    if ((terminal === 'report-only' || terminal === 'manual-decision') && handoff !== 'not-applicable' && handoff !== 'ask-user') {
      fail(
        FIXTURE_SCHEMA_INVALID,
        `${caseId} is ${terminal} but expects executable handoff "${handoff}".`,
      );
    }
    if (guard === 'no-op' && terminal !== 'complete') {
      fail(FIXTURE_SCHEMA_INVALID, `${caseId} no-op outcome must terminate as complete.`);
    }
    if (guard === 'allow' && terminal !== publicMode.terminal_behavior) {
      fail(
        FIXTURE_SCHEMA_INVALID,
        `${caseId} allowed outcome terminal "${terminal}" differs from mode terminal "${String(publicMode.terminal_behavior)}".`,
      );
    }
    if ((publicMode.mutation === 'none' || guard === 'block' || guard === 'ask-user' || guard === 'no-op') && writes.length > 0) {
      fail(
        FIXTURE_SCHEMA_INVALID,
        `${caseId} expects writes although mode mutation or guard outcome forbids them.`,
      );
    }
  }

  const expectedFixtureIds = [...expectedRowFixtureIds(), ...expectedGlobalFixtureIds()];
  if (!sameStringSet(caseIds, expectedFixtureIds)) {
    fail(
      FIXTURE_COVERAGE_MISMATCH,
      `fixture ID set differs from the required 55 cases: ${formatSetDifference(expectedFixtureIds, caseIds)}.`,
    );
  }

  const rowAliases = cases
    .filter(fixtureCase => fixtureCase.kind === 'row')
    .map(fixtureCase => (fixtureCase.invocation as AnyRecord).legacy_alias as string);
  if (!sameStringSet(rowAliases, index.compatibilityAliases.keys())) {
    fail(
      FIXTURE_COVERAGE_MISMATCH,
      `row fixture aliases differ from compatibility aliases: ${formatSetDifference(index.compatibilityAliases.keys(), rowAliases)}.`,
    );
  }

  return { cases, rowCases, globalCases };
}

export function readLegacySkillTemplateContracts(root: string): LegacySkillTemplateContract[] {
  const templateDir = path.join(root, ...WORKFLOW_SKILL_TEMPLATE_RELATIVE_PATH.split('/'));
  if (!fs.existsSync(templateDir)) {
    fail(CAPABILITY_COMPAT_COVERAGE_MISMATCH, `template directory not found: ${templateDir}`);
  }
  const templateFiles = fs
    .readdirSync(templateDir)
    .filter(file => file.endsWith('.SKILL.md.tmpl'))
    .sort();
  if (templateFiles.length === 0) {
    fail(CAPABILITY_COMPAT_COVERAGE_MISMATCH, `no Skill templates found in ${templateDir}.`);
  }

  const contracts: LegacySkillTemplateContract[] = [];
  for (const file of templateFiles) {
    const content = fs.readFileSync(path.join(templateDir, file), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
    if (!frontmatter) {
      fail(CAPABILITY_COMPAT_COVERAGE_MISMATCH, `${file} is missing YAML frontmatter.`);
    }
    const parsed = parseYamlMapping(frontmatter[1], file, CAPABILITY_SCHEMA_INVALID);
    const name = expectId(parsed.name, `${file}.name`, CAPABILITY_SCHEMA_INVALID);
    const filenameName = file.replace(/\.SKILL\.md\.tmpl$/, '');
    if (name !== filenameName) {
      fail(
        CAPABILITY_COMPAT_COVERAGE_MISMATCH,
        `${file} declares name "${name}" instead of filename-derived "${filenameName}".`,
      );
    }
    const rawStage = expectString(parsed.stage, `${file}.stage`, CAPABILITY_SCHEMA_INVALID);
    const stage = STAGE_MAP.has(rawStage) ? rawStage : STAGE_ALIASES.get(rawStage);
    if (!stage) {
      fail(CAPABILITY_COMPAT_COVERAGE_MISMATCH, `${file} declares unknown stage "${rawStage}".`);
    }
    const writes = parsed.writes == null
      ? []
      : expectStringArray(parsed.writes, `${file}.writes`, CAPABILITY_SCHEMA_INVALID, true);
    const handoff = expectRecord(parsed.handoff, `${file}.handoff`, CAPABILITY_SCHEMA_INVALID);
    const handoffSuccess = expectString(handoff.success, `${file}.handoff.success`, CAPABILITY_SCHEMA_INVALID);
    const handoffFailure = expectString(handoff.failure, `${file}.handoff.failure`, CAPABILITY_SCHEMA_INVALID);
    const conditionalHandoffs = parsed.conditional_handoff == null
      ? []
      : Object.values(
        expectRecord(parsed.conditional_handoff, `${file}.conditional_handoff`, CAPABILITY_SCHEMA_INVALID),
      ).map((value, index) =>
        expectString(value, `${file}.conditional_handoff[${index}]`, CAPABILITY_SCHEMA_INVALID),
      );
    contracts.push({
      name,
      stage,
      writes,
      handoffSuccess,
      handoffFailure,
      conditionalHandoffs,
    });
  }
  const names = new Set(contracts.map(contract => contract.name));
  for (const contract of contracts) {
    for (const target of [contract.handoffSuccess, contract.handoffFailure, ...contract.conditionalHandoffs]) {
      if (target !== 'ask-user' && !names.has(target)) {
        fail(
          CAPABILITY_COMPAT_COVERAGE_MISMATCH,
          `${contract.name} legacy handoff references missing template Skill "${target}".`,
        );
      }
    }
  }
  return contracts;
}

export function readLegacySkillTemplateNames(root: string): string[] {
  return readLegacySkillTemplateContracts(root).map(contract => contract.name);
}

export function validateWorkflowCapabilityData(
  manifest: unknown,
  fixtures: unknown,
  templateContracts: readonly LegacySkillTemplateContract[],
): WorkflowCapabilityValidationSummary {
  const templateNames = templateContracts.map(contract => contract.name);
  const index = validateCapabilityManifest(manifest, templateNames);
  validateLegacyTemplateContracts(index, templateContracts);
  const fixtureResult = validateFixtureManifest(fixtures, index);
  const classifications: WorkflowCapabilityValidationSummary['classifications'] = {
    keep: 0,
    merge: 0,
    runtime: 0,
    delete: 0,
  };
  for (const alias of index.compatibilityAliases.values()) {
    classifications[alias.classification as keyof typeof classifications]++;
  }

  return {
    publicEntries: index.publicEntries.size,
    publicModes: index.publicModes.size,
    internalCapabilities: index.internalCapabilities.size,
    runtimeOperations: index.runtimeOperations.size,
    compatibilityAliases: index.compatibilityAliases.size,
    fixtures: fixtureResult.cases.length,
    rowFixtures: fixtureResult.rowCases,
    globalFixtures: fixtureResult.globalCases,
    classifications,
  };
}

export function validateWorkflowCapabilityFiles(root = resolveRoot()): WorkflowCapabilityValidationSummary {
  const manifestPath = path.join(root, ...WORKFLOW_CAPABILITIES_RELATIVE_PATH.split('/'));
  const fixturesPath = path.join(root, ...WORKFLOW_CAPABILITY_FIXTURES_RELATIVE_PATH.split('/'));
  if (!fs.existsSync(manifestPath)) {
    fail(CAPABILITY_SCHEMA_INVALID, `required capability manifest not found: ${manifestPath}`);
  }
  if (!fs.existsSync(fixturesPath)) {
    fail(FIXTURE_SCHEMA_INVALID, `required fixture manifest not found: ${fixturesPath}`);
  }
  const manifest = parseWorkflowCapabilityManifest(fs.readFileSync(manifestPath, 'utf8'));
  const fixtures = parseWorkflowCapabilityFixtures(fs.readFileSync(fixturesPath, 'utf8'));
  const templateContracts = readLegacySkillTemplateContracts(root);
  return validateWorkflowCapabilityData(manifest, fixtures, templateContracts);
}

if (import.meta.main) {
  try {
    const summary = validateWorkflowCapabilityFiles();
    console.log(
      `Workflow capability contract valid: ${summary.publicEntries} public entries, ${summary.compatibilityAliases} aliases, ${summary.fixtures} fixtures.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
