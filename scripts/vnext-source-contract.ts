import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';
import { resolveRoot } from './workflow-core';

export const VNEXT_SOURCE_CONTRACT_RELATIVE_PATH = '.workflow-system/vnext/SOURCE_CONTRACT.yaml';
export const VNEXT_SKILL_TEMPLATE_RELATIVE_PATH = 'templates/vnext/skills';

export const PHASE_1A_ENTRIES = ['prepare-task', 'review-change', 'execute-step'] as const;
export type Phase1AEntry = (typeof PHASE_1A_ENTRIES)[number];

export const PHASE_1_ENTRIES = [
  ...PHASE_1A_ENTRIES,
  'debug-task',
  'task-lifecycle',
  'capture-work-item',
  'close-task',
] as const;
export type Phase1Entry = (typeof PHASE_1_ENTRIES)[number];

export const ADMIN_ENTRIES = ['bootstrap-project'] as const;
export type AdminEntry = (typeof ADMIN_ENTRIES)[number];

export const PHASE_1A_MODES: Record<Phase1AEntry, readonly string[]> = {
  'prepare-task': ['default', 'replan'],
  'review-change': ['default', 'report-only'],
  'execute-step': ['default', 'repair'],
};

export const PHASE_1_MODES: Record<Phase1Entry, readonly string[]> = {
  ...PHASE_1A_MODES,
  'debug-task': ['investigate-only', 'resolve'],
  'task-lifecycle': ['pause', 'interrupt', 'resume-paused', 'resume-interrupted', 'supersede'],
  'capture-work-item': [],
  'close-task': ['preview'],
};

export const ADMIN_MODES: Record<AdminEntry, readonly string[]> = {
  'bootstrap-project': ['design', 'greenfield', 'inventory', 'adopt', 'realign'],
};

const EXPECTED_OUTPUT_KINDS: Record<Phase1Entry, string> = {
  'prepare-task': 'prepared-task',
  'review-change': 'report',
  'execute-step': 'change-result',
  'debug-task': 'debug-result',
  'task-lifecycle': 'lifecycle-result',
  'capture-work-item': 'capture-result',
  'close-task': 'closure-result',
};

const EXPECTED_AUTHORITY_OWNERS: Record<Phase1Entry, string> = {
  'prepare-task': 'user',
  'review-change': 'none',
  'execute-step': 'task',
  'debug-task': 'task',
  'task-lifecycle': 'task',
  'capture-work-item': 'none',
  'close-task': 'task',
};

const EXPECTED_RUNTIME_OPERATIONS: Record<Phase1Entry, readonly string[]> = {
  'prepare-task': ['task-state-transaction'],
  'review-change': [],
  'execute-step': ['task-state-transaction', 'finding-queue-transaction'],
  'debug-task': ['task-state-transaction'],
  'task-lifecycle': ['lifecycle-transaction'],
  'capture-work-item': ['inbox-record-transaction'],
  'close-task': [
    'project-status-transaction',
    'archive-transaction',
    'lesson-record-transaction',
  ],
};

const EXPECTED_ADMIN_RUNTIME_OPERATIONS: Record<AdminEntry, readonly string[]> = {
  'bootstrap-project': [
    'contract-candidate-commit',
    'decision-record-transaction',
    'project-status-transaction',
    'paired-host-guidance-transaction',
  ],
};

const REQUIRED_ENTRY_CAPABILITIES: Partial<Record<Phase1Entry, readonly string[]>> = {
  'prepare-task': ['scope-guard', 'evidence-admission-policy'],
  'review-change': ['scope-guard', 'diff-target-resolver', 'read-only-review-guard', 'review-convergence-policy', 'evidence-admission-policy'],
  'execute-step': ['scope-guard', 'source-authority-policy', 'task-identity-guard', 'adaptive-depth-policy', 'finding-admission', 'review-convergence-policy', 'evidence-admission-policy'],
  'debug-task': ['scope-guard', 'review-convergence-policy', 'evidence-admission-policy'],
  'task-lifecycle': ['scope-guard'],
  'capture-work-item': ['scope-guard'],
  'close-task': ['evidence-admission-policy'],
};

const REQUIRED_ADMIN_ENTRY_CAPABILITIES: Partial<Record<AdminEntry, readonly string[]>> = {
  'bootstrap-project': [
    'project-context-resolver',
    'source-authority-policy',
    'scope-guard',
    'decision-authority-gate',
    'design-evidence-gate',
    'propagation-evidence-validator',
    'host-isolation-guard',
    'generation-atomicity-policy',
  ],
};

const FORBIDDEN_TOP_LEVEL_FIELDS = new Set([
  'stage',
  'handoff',
  'conditional_handoff',
  'benefits-from',
]);

const REQUIRED_CAPABILITIES = [
  'project-context-resolver',
  'source-authority-policy',
  'task-identity-guard',
  'scope-guard',
  'decision-authority-gate',
  'adaptive-depth-policy',
  'propagation-evidence-validator',
  'design-evidence-gate',
  'release-evidence-gate',
  'external-documentation-gate',
  'resume-review-gate',
  'read-only-review-guard',
  'diff-target-resolver',
  'evidence-admission-policy',
  'finding-admission',
  'review-convergence-policy',
  'dangerous-operation-gate',
  'knowledge-admission-policy',
  'root-cause-loop',
  'owner-route-resolver',
  'lifecycle-transition-guard',
  'record-only-intake-guard',
  'closure-eligibility-gate',
  'host-isolation-guard',
  'generation-atomicity-policy',
] as const;

const REQUIRED_RUNTIME_OPERATIONS = [
  'task-state-transaction',
  'finding-queue-transaction',
  'lifecycle-transaction',
  'inbox-record-transaction',
  'project-status-transaction',
  'archive-transaction',
  'lesson-record-transaction',
  'contract-candidate-commit',
  'decision-record-transaction',
  'paired-host-guidance-transaction',
] as const;

const PHASE_2_BOUND_CALLERS: Record<string, readonly string[]> = {
  'task-state-transaction': ['execute-step', 'prepare-task'],
  'finding-queue-transaction': ['execute-step'],
  'lifecycle-transaction': ['task-lifecycle'],
  'project-status-transaction': ['close-task', 'bootstrap-project'],
  'archive-transaction': ['close-task'],
  'lesson-record-transaction': ['close-task'],
  'contract-candidate-commit': ['bootstrap-project'],
  'decision-record-transaction': ['bootstrap-project'],
  'paired-host-guidance-transaction': ['bootstrap-project'],
};

const PHASE_2_BOUND_ACTIONS: Record<string, readonly string[]> = {
  'task-state-transaction': [
    'execute-step:step-progress',
    'prepare-task:default:clear-resume-review-gate',
    'prepare-task:replan:mark-replan-blocked',
    'prepare-task:replan:clear-replan-block',
    'prepare-task:replan:commit-replan',
  ],
  'finding-queue-transaction': [
    'execute-step:repair:admit',
    'execute-step:repair:record-repair-attempt',
    'execute-step:repair:resolve',
    'execute-step:repair:defer',
    'execute-step:repair:reject',
  ],
  'lifecycle-transaction': [
    'task-lifecycle:pause',
    'task-lifecycle:interrupt',
    'task-lifecycle:resume-paused',
    'task-lifecycle:resume-interrupted',
    'task-lifecycle:supersede',
  ],
  'project-status-transaction': [
    'close-task:default:sync',
    'bootstrap-project:design:status',
    'bootstrap-project:greenfield:status',
    'bootstrap-project:inventory:status',
    'bootstrap-project:adopt:status',
    'bootstrap-project:realign:status',
  ],
  'archive-transaction': [
    'close-task:default:archive',
  ],
  'lesson-record-transaction': [
    'close-task:default:record',
  ],
  'contract-candidate-commit': [
    'bootstrap-project:greenfield:contract',
    'bootstrap-project:adopt:contract',
    'bootstrap-project:realign:contract',
  ],
  'decision-record-transaction': [
    'bootstrap-project:design:decision',
    'bootstrap-project:greenfield:decision',
    'bootstrap-project:inventory:decision',
    'bootstrap-project:adopt:decision',
    'bootstrap-project:realign:decision',
  ],
  'paired-host-guidance-transaction': [
    'bootstrap-project:greenfield:host-guidance',
    'bootstrap-project:adopt:host-guidance',
    'bootstrap-project:realign:host-guidance',
  ],
};

type UnknownRecord = Record<string, unknown>;

export type VNextSourceValidationResult = {
  phase: 'Phase 1' | 'Phase 2';
  entries: Phase1Entry[];
  administrativeEntries: AdminEntry[];
  capabilities: string[];
  runtimeOperations: string[];
  legacySkillNames: string[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`vNext source contract: ${message}`);
}

function expectRecord(value: unknown, location: string): UnknownRecord {
  if (!isRecord(value)) fail(`${location} must be a mapping`);
  return value;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${location} must be a non-empty string`);
  }
  return value.trim();
}

function expectBoolean(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') fail(`${location} must be a boolean`);
  return value;
}

function expectStringArray(value: unknown, location: string, allowEmpty = false): string[] {
  if (!Array.isArray(value)) fail(`${location} must be a list`);
  const result = value.map((item, index) => expectString(item, `${location}[${index}]`));
  if (!allowEmpty && result.length === 0) fail(`${location} must not be empty`);
  if (new Set(result).size !== result.length) fail(`${location} must not contain duplicates`);
  return result;
}

function expectExactKeys(value: UnknownRecord, expected: readonly string[], location: string): void {
  const expectedSet = new Set(expected);
  const actualKeys = Object.keys(value);
  const unexpected = actualKeys.filter(key => !expectedSet.has(key));
  const missing = expected.filter(key => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) {
    fail(
      `${location} keys mismatch; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`,
    );
  }
}

function expectSetEqual(actual: readonly string[], expected: readonly string[], location: string): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter(item => !actualSet.has(item));
  const extra = actual.filter(item => !expectedSet.has(item));
  if (missing.length > 0 || extra.length > 0 || actualSet.size !== actual.length) {
    fail(`${location} must equal [${expected.join(', ')}]; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
  }
}

function readYamlMapping(filePath: string): UnknownRecord {
  if (!fs.existsSync(filePath)) fail(`required file not found: ${filePath}`);
  const document = parseDocument(fs.readFileSync(filePath, 'utf8'), { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    fail(`${filePath} has invalid YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  }
  return expectRecord(document.toJS(), filePath);
}

function readStrictFrontmatter(filePath: string): { frontmatter: UnknownRecord; body: string } {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) fail(`${filePath} is missing a YAML frontmatter block`);
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    fail(`${filePath} has invalid frontmatter YAML: ${diagnostics.map(item => item.message).join('; ')}`);
  }
  return { frontmatter: expectRecord(document.toJS(), filePath), body: match[2] };
}

function assertRelativePath(value: unknown, expected: string, location: string): void {
  if (expectString(value, location).replace(/\\/g, '/') !== expected) {
    fail(`${location} must be "${expected}"`);
  }
}

function validateSourceNamespace(contract: UnknownRecord): 'Phase 1' | 'Phase 2' {
  expectExactKeys(contract, ['schema_version', 'kind', 'phase', 'source_namespace', 'entries', 'administrative_entries', 'capabilities', 'runtime_operations'], 'contract');
  if (contract.schema_version !== 1) fail('contract.schema_version must be 1');
  if (contract.kind !== 'vnext-source-contract') fail('contract.kind must be vnext-source-contract');
  if (contract.phase !== 'Phase 1' && contract.phase !== 'Phase 2') fail('contract.phase must be Phase 1 or Phase 2');

  const namespace = expectRecord(contract.source_namespace, 'contract.source_namespace');
  expectExactKeys(namespace, ['root', 'skill_templates', 'contract_file', 'installable', 'generated', 'host_sync'], 'contract.source_namespace');
  assertRelativePath(namespace.root, 'templates/vnext', 'contract.source_namespace.root');
  assertRelativePath(namespace.skill_templates, VNEXT_SKILL_TEMPLATE_RELATIVE_PATH, 'contract.source_namespace.skill_templates');
  assertRelativePath(namespace.contract_file, VNEXT_SOURCE_CONTRACT_RELATIVE_PATH, 'contract.source_namespace.contract_file');
  if (expectBoolean(namespace.installable, 'contract.source_namespace.installable')) {
    fail('vNext source namespace must not be installable from the legacy workflow runtime');
  }
  if (expectBoolean(namespace.generated, 'contract.source_namespace.generated')) {
    fail('vNext source namespace must not be generated by the legacy workflow pipeline');
  }
  if (expectBoolean(namespace.host_sync, 'contract.source_namespace.host_sync')) {
    fail('vNext source namespace must not be host-synced by the legacy workflow runtime');
  }
  return contract.phase;
}

function validateCatalogEntries(root: string, contract: UnknownRecord): Map<Phase1Entry, string> {
  const rawEntries = contract.entries;
  if (!Array.isArray(rawEntries)) fail('contract.entries must be a list');
  if (rawEntries.length !== PHASE_1_ENTRIES.length) {
    fail(`contract.entries must contain exactly ${PHASE_1_ENTRIES.length} vNext entries`);
  }

  const entryTemplates = new Map<Phase1Entry, string>();
  for (const [index, rawEntry] of rawEntries.entries()) {
    const entry = expectRecord(rawEntry, `contract.entries[${index}]`);
    expectExactKeys(entry, ['id', 'exposure', 'template'], `contract.entries[${index}]`);
    const id = expectString(entry.id, `contract.entries[${index}].id`);
    if (!(PHASE_1_ENTRIES as readonly string[]).includes(id)) {
      fail(`contract.entries[${index}].id "${id}" is not a vNext entry`);
    }
    if (entryTemplates.has(id as Phase1Entry)) fail(`duplicate entry id "${id}"`);
    if (entry.exposure !== 'daily') fail(`entry "${id}" must have exposure daily`);
    const expectedTemplate = `templates/vnext/skills/${id}.SKILL.md.tmpl`;
    assertRelativePath(entry.template, expectedTemplate, `contract.entries[${index}].template`);
    entryTemplates.set(id as Phase1Entry, expectedTemplate);
  }

  for (const entry of PHASE_1_ENTRIES) {
    const templatePath = path.join(root, ...entryTemplates.get(entry)!.split('/'));
    if (!fs.existsSync(templatePath)) fail(`missing template for ${entry}: ${templatePath}`);
  }

  const skillDir = path.join(root, ...VNEXT_SKILL_TEMPLATE_RELATIVE_PATH.split('/'));
  if (!fs.existsSync(skillDir)) fail(`missing vNext skill template directory: ${skillDir}`);
  const actualFiles = fs.readdirSync(skillDir).filter(file => file.endsWith('.SKILL.md.tmpl')).sort();
  const expectedFiles = [...PHASE_1_ENTRIES, ...ADMIN_ENTRIES].map(entry => `${entry}.SKILL.md.tmpl`).sort();
  expectSetEqual(actualFiles, expectedFiles, 'vNext skill template files');
  return entryTemplates;
}

function validateAdministrativeCatalog(root: string, contract: UnknownRecord): Map<AdminEntry, string> {
  const rawEntries = contract.administrative_entries;
  if (!Array.isArray(rawEntries)) fail('contract.administrative_entries must be a list');
  if (rawEntries.length !== ADMIN_ENTRIES.length) {
    fail(`contract.administrative_entries must contain exactly ${ADMIN_ENTRIES.length} administrative entry`);
  }

  const entryTemplates = new Map<AdminEntry, string>();
  for (const [index, rawEntry] of rawEntries.entries()) {
    const entry = expectRecord(rawEntry, `contract.administrative_entries[${index}]`);
    expectExactKeys(entry, ['id', 'exposure', 'template'], `contract.administrative_entries[${index}]`);
    const id = expectString(entry.id, `contract.administrative_entries[${index}].id`);
    if (!(ADMIN_ENTRIES as readonly string[]).includes(id)) {
      fail(`contract.administrative_entries[${index}].id "${id}" is not an administrative vNext entry`);
    }
    if (entryTemplates.has(id as AdminEntry)) fail(`duplicate administrative entry id "${id}"`);
    if (entry.exposure !== 'admin') fail(`administrative entry "${id}" must have exposure admin`);
    const expectedTemplate = `templates/vnext/skills/${id}.SKILL.md.tmpl`;
    assertRelativePath(entry.template, expectedTemplate, `contract.administrative_entries[${index}].template`);
    entryTemplates.set(id as AdminEntry, expectedTemplate);
  }

  for (const entry of ADMIN_ENTRIES) {
    const templatePath = path.join(root, ...entryTemplates.get(entry)!.split('/'));
    if (!fs.existsSync(templatePath)) fail(`missing template for ${entry}: ${templatePath}`);
  }
  return entryTemplates;
}

function validateCapabilityCatalog(contract: UnknownRecord): Set<string> {
  const rawCapabilities = contract.capabilities;
  if (!Array.isArray(rawCapabilities)) fail('contract.capabilities must be a list');
  const ids = new Set<string>();
  for (const [index, rawCapability] of rawCapabilities.entries()) {
    const capability = expectRecord(rawCapability, `contract.capabilities[${index}]`);
    expectExactKeys(
      capability,
      ['id', 'exposure', 'trigger', 'input_contract', 'output_contract', 'stop_conditions'],
      `contract.capabilities[${index}]`,
    );
    const id = expectString(capability.id, `contract.capabilities[${index}].id`);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) fail(`invalid capability id "${id}"`);
    if (ids.has(id)) fail(`duplicate capability id "${id}"`);
    ids.add(id);
    if (capability.exposure !== 'internal') fail(`capability "${id}" must be internal`);
    expectStringArray(capability.trigger, `capability "${id}".trigger`);
    expectStringArray(capability.input_contract, `capability "${id}".input_contract`);
    expectStringArray(capability.output_contract, `capability "${id}".output_contract`);
    expectStringArray(capability.stop_conditions, `capability "${id}".stop_conditions`);
  }
  for (const required of REQUIRED_CAPABILITIES) {
    if (!ids.has(required)) fail(`capability catalog is missing required "${required}"`);
  }
  return ids;
}

function validateRuntimeCatalog(contract: UnknownRecord, phase: 'Phase 1' | 'Phase 2'): Map<string, UnknownRecord> {
  const rawOperations = contract.runtime_operations;
  if (!Array.isArray(rawOperations)) fail('contract.runtime_operations must be a list');
  const operations = new Map<string, UnknownRecord>();
  for (const [index, rawOperation] of rawOperations.entries()) {
    const operation = expectRecord(rawOperation, `contract.runtime_operations[${index}]`);
    expectExactKeys(
      operation,
      ['id', 'status', 'binding', 'implementation_phase', 'source_targets', 'write_targets', 'allowed_callers', 'bound_callers', 'bound_actions'],
      `contract.runtime_operations[${index}]`,
    );
    const id = expectString(operation.id, `contract.runtime_operations[${index}].id`);
    if (operations.has(id)) fail(`duplicate Runtime operation id "${id}"`);
    operations.set(id, operation);
    const expectedBoundCallers = PHASE_2_BOUND_CALLERS[id];
    const isPhase2Bound = expectedBoundCallers !== undefined;
    if (phase === 'Phase 1') {
      if (operation.status !== 'contract-only') fail(`Runtime operation "${id}" must be contract-only in Phase 1`);
      if (operation.binding !== 'unbound') fail(`Runtime operation "${id}" must be unbound in Phase 1`);
    } else if (isPhase2Bound) {
      if (operation.status !== 'bound') fail(`Runtime operation "${id}" must be bound in Phase 2`);
      if (operation.binding !== 'vnext-runtime') fail(`Runtime operation "${id}" must bind to vnext-runtime in Phase 2`);
    } else {
      if (operation.status !== 'contract-only') fail(`Runtime operation "${id}" must be contract-only in Phase 2`);
      if (operation.binding !== 'unbound') fail(`Runtime operation "${id}" must be unbound in Phase 2`);
    }
    if (operation.implementation_phase !== 'Phase 2') fail(`Runtime operation "${id}" must have implementation_phase Phase 2`);
    expectStringArray(operation.source_targets, `Runtime operation "${id}".source_targets`);
    expectStringArray(operation.write_targets, `Runtime operation "${id}".write_targets`);
    const callers = expectStringArray(operation.allowed_callers, `Runtime operation "${id}".allowed_callers`);
    for (const caller of callers) {
      if (!(PHASE_1_ENTRIES as readonly string[]).includes(caller) && !(ADMIN_ENTRIES as readonly string[]).includes(caller)) {
        fail(`Runtime operation "${id}" has a non-Phase-1 caller "${caller}"`);
      }
    }
    const boundCallers = expectStringArray(operation.bound_callers, `Runtime operation "${id}".bound_callers`, true);
    for (const caller of boundCallers) {
      if (!callers.includes(caller)) fail(`Runtime operation "${id}" bound caller "${caller}" is not listed in allowed_callers`);
    }
    if (phase === 'Phase 2' && isPhase2Bound) {
      expectSetEqual(boundCallers, expectedBoundCallers!, `Runtime operation "${id}" bound callers`);
    }
    if ((!isPhase2Bound || phase === 'Phase 1') && boundCallers.length > 0) {
      fail(`Runtime operation "${id}" has bound callers outside the active Phase 2 slice`);
    }
    const boundActions = expectStringArray(operation.bound_actions, `Runtime operation "${id}".bound_actions`, true);
    const expectedBoundActions = isPhase2Bound && phase === 'Phase 2' ? PHASE_2_BOUND_ACTIONS[id] ?? [] : [];
    expectSetEqual(boundActions, expectedBoundActions, `Runtime operation "${id}" bound actions`);
  }
  for (const required of REQUIRED_RUNTIME_OPERATIONS) {
    if (!operations.has(required)) fail(`Runtime operation catalog is missing required "${required}"`);
  }
  return operations;
}

function readLegacySkillNames(root: string): string[] {
  const legacyDir = path.join(root, 'templates', 'skills');
  if (!fs.existsSync(legacyDir)) fail(`legacy Skill template directory not found: ${legacyDir}`);
  const files = fs.readdirSync(legacyDir).filter(file => file.endsWith('.SKILL.md.tmpl')).sort();
  if (files.length === 0) fail('legacy Skill template directory contains no templates');
  return files.map(file => {
    const filePath = path.join(legacyDir, file);
    const { frontmatter } = readStrictFrontmatter(filePath);
    const name = expectString(frontmatter.name, `${file}.name`);
    const expected = file.replace(/\.SKILL\.md\.tmpl$/, '');
    if (name !== expected) fail(`legacy template ${file} declares name "${name}" instead of "${expected}"`);
    return name;
  });
}

function validateInputContract(input: UnknownRecord, entry: Phase1Entry): void {
  expectExactKeys(
    input,
    entry === 'review-change' ? ['required', 'optional', 'cycle_phase'] : ['required', 'optional'],
    `${entry}.entry_contract.input_contract`,
  );
  expectStringArray(input.required, `${entry}.entry_contract.input_contract.required`);
  expectStringArray(input.optional, `${entry}.entry_contract.input_contract.optional`, true);
  if (entry === 'review-change') {
    const phases = expectStringArray(input.cycle_phase, `${entry}.entry_contract.input_contract.cycle_phase`);
    expectSetEqual(phases, ['discovery', 'verification'], `${entry}.cycle_phase`);
  }
}

function validateLegacyExecutableTargets(content: string, entry: Phase1Entry, legacySkillNames: readonly string[]): void {
  const lines = content.split(/\r?\n/);
  for (const legacyName of legacySkillNames) {
    const escapedName = legacyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let inFrontmatter = false;
    for (const [lineIndex, line] of lines.entries()) {
      if (lineIndex === 0 && line.trim() === '---') {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter && line.trim() === '---') {
        inFrontmatter = false;
        continue;
      }
      if (!line.includes(legacyName)) continue;
      if (
        legacyName === entry &&
        ((inFrontmatter && /^\s*entry:\s*.+\s*$/.test(line) && line.trim().slice('entry:'.length).trim() === legacyName) ||
          new RegExp(`^# vNext Skill:\\s*${escapedName}\\s*$`).test(line))
      ) {
        continue;
      }
      fail(`${entry} contains legacy Skill ID "${legacyName}" as executable source`);
    }
  }
}

function validateTemplate(
  root: string,
  entry: Phase1Entry,
  templateRelativePath: string,
  capabilities: Set<string>,
  runtimeOperations: Map<string, UnknownRecord>,
  legacySkillNames: readonly string[],
): void {
  const templatePath = path.join(root, ...templateRelativePath.split('/'));
  const content = fs.readFileSync(templatePath, 'utf8');
  const { frontmatter } = readStrictFrontmatter(templatePath);
  expectExactKeys(frontmatter, ['entry_contract'], `${entry} frontmatter`);
  for (const forbidden of FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (forbidden in frontmatter) fail(`${entry} must not declare legacy field "${forbidden}"`);
  }

  validateLegacyExecutableTargets(content, entry, legacySkillNames);

  const contract = expectRecord(frontmatter.entry_contract, `${entry}.entry_contract`);
  expectExactKeys(
    contract,
    ['entry', 'mode', 'intent', 'input_contract', 'authority_owner', 'mutation_boundary', 'internal_capabilities', 'runtime_operations', 'stop_conditions', 'output_kind'],
    `${entry}.entry_contract`,
  );
  if (contract.entry !== entry) fail(`${entry}.entry_contract.entry must be "${entry}"`);
  const modes = expectStringArray(contract.mode, `${entry}.entry_contract.mode`, true);
  expectSetEqual(modes, PHASE_1_MODES[entry], `${entry}.entry_contract.mode`);
  if (modes.some(mode => mode === 'discovery' || mode === 'verification')) {
    fail(`${entry}.entry_contract.mode must not contain review cycle phases`);
  }
  expectString(contract.intent, `${entry}.entry_contract.intent`);
  validateInputContract(expectRecord(contract.input_contract, `${entry}.entry_contract.input_contract`), entry);
  if (contract.authority_owner !== EXPECTED_AUTHORITY_OWNERS[entry]) {
    fail(`${entry}.entry_contract.authority_owner must be "${EXPECTED_AUTHORITY_OWNERS[entry]}"`);
  }

  const boundary = expectRecord(contract.mutation_boundary, `${entry}.entry_contract.mutation_boundary`);
  expectExactKeys(boundary, ['product_files', 'governance_sources', 'forbidden_targets'], `${entry}.mutation_boundary`);
  const productFiles = expectStringArray(boundary.product_files, `${entry}.mutation_boundary.product_files`, true);
  const governanceSources = expectStringArray(boundary.governance_sources, `${entry}.mutation_boundary.governance_sources`, true);
  expectStringArray(boundary.forbidden_targets, `${entry}.mutation_boundary.forbidden_targets`);
  if (entry !== 'execute-step' && productFiles.length > 0) {
    fail(`${entry} must not directly write product files`);
  }
  if (governanceSources.length > 0) fail(`${entry} must not directly write governance sources`);
  if (entry === 'execute-step') {
    expectSetEqual(productFiles, ['admitted_scope'], `${entry}.mutation_boundary.product_files`);
  }
  if (entry === 'review-change' && productFiles.length !== 0) {
    fail('review-change must have an empty direct product write boundary');
  }

  const capabilityRefs = expectStringArray(contract.internal_capabilities, `${entry}.entry_contract.internal_capabilities`);
  for (const capability of capabilityRefs) {
    if (!capabilities.has(capability)) fail(`${entry} references missing capability "${capability}"`);
  }
  for (const requiredCapability of REQUIRED_ENTRY_CAPABILITIES[entry] ?? []) {
    if (!capabilityRefs.includes(requiredCapability)) {
      fail(`${entry} must declare mandatory capability "${requiredCapability}"`);
    }
  }
  const runtimeRefs = expectStringArray(contract.runtime_operations, `${entry}.entry_contract.runtime_operations`, true);
  expectSetEqual(runtimeRefs, EXPECTED_RUNTIME_OPERATIONS[entry], `${entry}.entry_contract.runtime_operations`);
  for (const operation of runtimeRefs) {
    if (!runtimeOperations.has(operation)) fail(`${entry} references missing Runtime operation "${operation}"`);
    const status = runtimeOperations.get(operation)!;
    const isBound = status.status === 'bound' && status.binding === 'vnext-runtime';
    const isContractOnly = status.status === 'contract-only' && status.binding === 'unbound';
    if ((!isBound && !isContractOnly) || status.implementation_phase !== 'Phase 2') {
      fail(`${entry} references Runtime operation "${operation}" outside the Phase 2 operation boundary`);
    }
  }
  if (entry === 'review-change' && runtimeRefs.length !== 0) {
    fail('review-change must have no Runtime operations');
  }
  expectStringArray(contract.stop_conditions, `${entry}.entry_contract.stop_conditions`);
  if (contract.output_kind !== EXPECTED_OUTPUT_KINDS[entry]) {
    fail(`${entry}.entry_contract.output_kind must be "${EXPECTED_OUTPUT_KINDS[entry]}"`);
  }
}

function validateAdministrativeTemplate(
  root: string,
  entry: AdminEntry,
  templateRelativePath: string,
  capabilities: Set<string>,
  runtimeOperations: Map<string, UnknownRecord>,
  legacySkillNames: readonly string[],
): void {
  const templatePath = path.join(root, ...templateRelativePath.split('/'));
  const content = fs.readFileSync(templatePath, 'utf8');
  const { frontmatter } = readStrictFrontmatter(templatePath);
  expectExactKeys(frontmatter, ['entry_contract'], `${entry} frontmatter`);
  for (const forbidden of FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (forbidden in frontmatter) fail(`${entry} must not declare legacy field "${forbidden}"`);
  }
  validateLegacyExecutableTargets(content, entry as Phase1Entry, legacySkillNames);

  const contract = expectRecord(frontmatter.entry_contract, `${entry}.entry_contract`);
  expectExactKeys(
    contract,
    ['entry', 'mode', 'intent', 'input_contract', 'authority_owner', 'mutation_boundary', 'internal_capabilities', 'runtime_operations', 'stop_conditions', 'output_kind'],
    `${entry}.entry_contract`,
  );
  if (contract.entry !== entry) fail(`${entry}.entry_contract.entry must be "${entry}"`);
  expectSetEqual(
    expectStringArray(contract.mode, `${entry}.entry_contract.mode`, true),
    ADMIN_MODES[entry],
    `${entry}.entry_contract.mode`,
  );
  expectString(contract.intent, `${entry}.entry_contract.intent`);
  const input = expectRecord(contract.input_contract, `${entry}.entry_contract.input_contract`);
  expectExactKeys(input, ['required', 'optional'], `${entry}.entry_contract.input_contract`);
  expectStringArray(input.required, `${entry}.entry_contract.input_contract.required`);
  expectStringArray(input.optional, `${entry}.entry_contract.input_contract.optional`, true);
  if (contract.authority_owner !== 'user') fail(`${entry}.entry_contract.authority_owner must be "user"`);

  const boundary = expectRecord(contract.mutation_boundary, `${entry}.entry_contract.mutation_boundary`);
  expectExactKeys(boundary, ['product_files', 'governance_sources', 'forbidden_targets'], `${entry}.mutation_boundary`);
  if (expectStringArray(boundary.product_files, `${entry}.mutation_boundary.product_files`, true).length > 0) {
    fail(`${entry} must not directly write product files`);
  }
  if (expectStringArray(boundary.governance_sources, `${entry}.mutation_boundary.governance_sources`, true).length > 0) {
    fail(`${entry} must not directly write governance sources`);
  }
  expectStringArray(boundary.forbidden_targets, `${entry}.mutation_boundary.forbidden_targets`);

  const capabilityRefs = expectStringArray(contract.internal_capabilities, `${entry}.entry_contract.internal_capabilities`);
  for (const capability of capabilityRefs) {
    if (!capabilities.has(capability)) fail(`${entry} references missing capability "${capability}"`);
  }
  for (const requiredCapability of REQUIRED_ADMIN_ENTRY_CAPABILITIES[entry] ?? []) {
    if (!capabilityRefs.includes(requiredCapability)) {
      fail(`${entry} must declare mandatory capability "${requiredCapability}"`);
    }
  }
  const runtimeRefs = expectStringArray(contract.runtime_operations, `${entry}.entry_contract.runtime_operations`);
  expectSetEqual(runtimeRefs, EXPECTED_ADMIN_RUNTIME_OPERATIONS[entry], `${entry}.entry_contract.runtime_operations`);
  for (const operation of runtimeRefs) {
    const metadata = runtimeOperations.get(operation);
    if (!metadata || metadata.status !== 'bound' || metadata.binding !== 'vnext-runtime' || metadata.implementation_phase !== 'Phase 2') {
      fail(`${entry} references Runtime operation "${operation}" outside the Phase 2 bootstrap boundary`);
    }
  }
  expectStringArray(contract.stop_conditions, `${entry}.entry_contract.stop_conditions`);
  if (contract.output_kind !== 'bootstrap-result') fail(`${entry}.entry_contract.output_kind must be "bootstrap-result"`);
}

export function validateVNextSource(root = resolveRoot()): VNextSourceValidationResult {
  const resolvedRoot = path.resolve(root);
  const contractPath = path.join(resolvedRoot, ...VNEXT_SOURCE_CONTRACT_RELATIVE_PATH.split('/'));
  const sourceContract = readYamlMapping(contractPath);
  const phase = validateSourceNamespace(sourceContract);
  const entryTemplates = validateCatalogEntries(resolvedRoot, sourceContract);
  const administrativeTemplates = validateAdministrativeCatalog(resolvedRoot, sourceContract);
  const capabilityIds = validateCapabilityCatalog(sourceContract);
  const runtimeOperations = validateRuntimeCatalog(sourceContract, phase);
  const legacySkillNames = readLegacySkillNames(resolvedRoot);

  for (const entry of PHASE_1_ENTRIES) {
    validateTemplate(
      resolvedRoot,
      entry,
      entryTemplates.get(entry)!,
      capabilityIds,
      runtimeOperations,
      legacySkillNames,
    );
  }
  for (const entry of ADMIN_ENTRIES) {
    validateAdministrativeTemplate(
      resolvedRoot,
      entry,
      administrativeTemplates.get(entry)!,
      capabilityIds,
      runtimeOperations,
      legacySkillNames,
    );
  }

  return {
    phase,
    entries: [...PHASE_1_ENTRIES],
    administrativeEntries: [...ADMIN_ENTRIES],
    capabilities: [...capabilityIds].sort(),
    runtimeOperations: [...runtimeOperations.keys()].sort(),
    legacySkillNames,
  };
}

if (import.meta.main) {
  try {
    const result = validateVNextSource();
    console.log(
      `vNext source contract: PASSED (${result.phase}; ${result.entries.length} entries, ${result.capabilities.length} capabilities, ${result.runtimeOperations.length} Runtime operations)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
