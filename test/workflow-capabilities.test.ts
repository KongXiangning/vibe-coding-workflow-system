import { beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  CAPABILITY_COMPAT_COVERAGE_MISMATCH,
  CAPABILITY_DANGLING_REFERENCE,
  CAPABILITY_DUPLICATE_ID,
  CAPABILITY_SCHEMA_INVALID,
  CAPABILITY_STAGE_COVERAGE_MISSING,
  CAPABILITY_TERMINAL_HANDOFF_INVALID,
  FIXTURE_CAPABILITY_UNRESOLVED,
  FIXTURE_COVERAGE_MISMATCH,
  FIXTURE_DUPLICATE_ID,
  FIXTURE_SCHEMA_INVALID,
  WORKFLOW_CAPABILITIES_RELATIVE_PATH,
  WORKFLOW_CAPABILITY_FIXTURES_RELATIVE_PATH,
  WorkflowCapabilityContractError,
  parseWorkflowCapabilityFixtures,
  parseWorkflowCapabilityManifest,
  readLegacySkillTemplateContracts,
  readLegacySkillTemplateNames,
  validateWorkflowCapabilityData,
  validateWorkflowCapabilityFiles,
  type WorkflowCapabilityContractErrorCode,
  type LegacySkillTemplateContract,
} from '../scripts/workflow-capabilities';

const ROOT = path.resolve(import.meta.dir, '..');
const MANIFEST_PATH = path.join(ROOT, ...WORKFLOW_CAPABILITIES_RELATIVE_PATH.split('/'));
const FIXTURES_PATH = path.join(ROOT, ...WORKFLOW_CAPABILITY_FIXTURES_RELATIVE_PATH.split('/'));

let validManifest: Record<string, any>;
let validFixtures: Record<string, any>;
let templateNames: string[];
let templateContracts: LegacySkillTemplateContract[];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectContractError(run: () => unknown, code: WorkflowCapabilityContractErrorCode): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(WorkflowCapabilityContractError);
  expect((caught as WorkflowCapabilityContractError).code).toBe(code);
}

function validateMutation(
  mutate: (manifest: Record<string, any>, fixtures: Record<string, any>) => void,
): () => unknown {
  return () => {
    const manifest = clone(validManifest);
    const fixtures = clone(validFixtures);
    mutate(manifest, fixtures);
    return validateWorkflowCapabilityData(manifest, fixtures, templateContracts);
  };
}

describe('workflow capability contract', () => {
  beforeAll(() => {
    validManifest = parseWorkflowCapabilityManifest(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    validFixtures = parseWorkflowCapabilityFixtures(fs.readFileSync(FIXTURES_PATH, 'utf8'));
    templateContracts = readLegacySkillTemplateContracts(ROOT);
    templateNames = readLegacySkillTemplateNames(ROOT);
  });

  test('validates the complete Phase 0 shadow baseline', () => {
    const summary = validateWorkflowCapabilityFiles(ROOT);

    expect(summary.publicEntries).toBe(10);
    expect(summary.publicModes).toBeGreaterThan(10);
    expect(summary.internalCapabilities).toBe(23);
    expect(summary.runtimeOperations).toBe(10);
    expect(summary.compatibilityAliases).toBe(37);
    expect(summary.fixtures).toBe(55);
    expect(summary.rowFixtures).toBe(37);
    expect(summary.globalFixtures).toBe(18);
    expect(summary.classifications).toEqual({ keep: 5, merge: 20, runtime: 7, delete: 5 });
    expect(templateNames).toHaveLength(37);
  });

  test('rejects duplicate YAML mapping keys before partial parsing', () => {
    const content = fs
      .readFileSync(MANIFEST_PATH, 'utf8')
      .replace('schema_version: 1', 'schema_version: 1\nschema_version: 1');

    expectContractError(() => parseWorkflowCapabilityManifest(content), CAPABILITY_SCHEMA_INVALID);
  });

  test('rejects duplicate capability or alias identities', () => {
    expectContractError(
      validateMutation(manifest => {
        manifest.compatibility_aliases.push(clone(manifest.compatibility_aliases[0]));
      }),
      CAPABILITY_DUPLICATE_ID,
    );
  });

  test('rejects missing or extra compatibility aliases against the actual template set', () => {
    expectContractError(
      validateMutation(manifest => {
        manifest.compatibility_aliases.pop();
      }),
      CAPABILITY_COMPAT_COVERAGE_MISMATCH,
    );
  });

  test('rejects dangling public target, internal capability, and Runtime references', () => {
    expectContractError(
      validateMutation(manifest => {
        manifest.compatibility_aliases[0].target_mode = 'missing-mode';
      }),
      CAPABILITY_DANGLING_REFERENCE,
    );

    expectContractError(
      validateMutation(manifest => {
        manifest.internal_capabilities[0].id = 'renamed-source-authority-policy';
      }),
      CAPABILITY_DANGLING_REFERENCE,
    );

    expectContractError(
      validateMutation(manifest => {
        manifest.runtime_operations[0].id = 'renamed-task-state-transaction';
      }),
      CAPABILITY_DANGLING_REFERENCE,
    );
  });

  test('rejects alias dependency drift and legacy stage or write-class broadening', () => {
    expectContractError(
      validateMutation(manifest => {
        manifest.compatibility_aliases[0].required_capabilities = ['scope-guard'];
      }),
      CAPABILITY_COMPAT_COVERAGE_MISMATCH,
    );

    expectContractError(
      validateMutation(manifest => {
        const syncEntry = manifest.public_entries.find((entry: any) => entry.id === 'sync-state');
        const lessons = syncEntry.modes.find((mode: any) => mode.id === 'lessons');
        lessons.covers_stages = ['phase-8-delivery'];
      }),
      CAPABILITY_COMPAT_COVERAGE_MISMATCH,
    );

    expectContractError(
      validateMutation(manifest => {
        const executeEntry = manifest.public_entries.find((entry: any) => entry.id === 'execute-step');
        const orchestrate = executeEntry.modes.find((mode: any) => mode.id === 'orchestrate');
        orchestrate.mutation = 'semantic-proposal';
      }),
      CAPABILITY_COMPAT_COVERAGE_MISMATCH,
    );
  });

  test('rejects missing user escalation and unsafe Runtime write boundaries', () => {
    expectContractError(
      validateMutation(manifest => {
        const prepareEntry = manifest.public_entries.find((entry: any) => entry.id === 'prepare-task');
        const decompose = prepareEntry.modes.find((mode: any) => mode.id === 'decompose');
        decompose.authority_boundary.user = 'none';
      }),
      CAPABILITY_SCHEMA_INVALID,
    );

    expectContractError(
      validateMutation(manifest => {
        manifest.runtime_operations[0].write_targets = ['**'];
      }),
      CAPABILITY_SCHEMA_INVALID,
    );

    expectContractError(
      validateMutation(manifest => {
        manifest.runtime_operations[0].canonical_state_sources = ['TASKS'];
      }),
      CAPABILITY_SCHEMA_INVALID,
    );
  });

  test('rejects a canonical stage coverage gap', () => {
    expectContractError(
      validateMutation(manifest => {
        for (const entry of manifest.public_entries) {
          for (const mode of entry.modes) {
            mode.covers_stages = mode.covers_stages.map((stage: string) =>
              stage === 'phase-8-delivery' ? 'phase-6-regression' : stage,
            );
          }
        }
      }),
      CAPABILITY_STAGE_COVERAGE_MISSING,
    );
  });

  test('rejects executable automatic handoff from terminal public modes', () => {
    expectContractError(
      validateMutation(manifest => {
        const reviewEntry = manifest.public_entries.find((entry: any) => entry.id === 'review-change');
        const reportOnly = reviewEntry.modes.find((mode: any) => mode.id === 'report-only');
        reportOnly.automatic_handoff = 'review-change:scope';
      }),
      CAPABILITY_TERMINAL_HANDOFF_INVALID,
    );
  });

  test('rejects missing and duplicate golden fixture IDs', () => {
    expectContractError(
      validateMutation((_manifest, fixtures) => {
        fixtures.cases.pop();
      }),
      FIXTURE_COVERAGE_MISMATCH,
    );

    expectContractError(
      validateMutation((_manifest, fixtures) => {
        fixtures.cases.push(clone(fixtures.cases[0]));
      }),
      FIXTURE_DUPLICATE_ID,
    );
  });

  test('rejects unresolved fixture capability references and row mappings', () => {
    expectContractError(
      validateMutation((_manifest, fixtures) => {
        fixtures.cases[0].capability_refs[0] = 'internal:missing-capability';
      }),
      FIXTURE_CAPABILITY_UNRESOLVED,
    );

    expectContractError(
      validateMutation((_manifest, fixtures) => {
        fixtures.cases[0].invocation.entry = 'execute-step';
        fixtures.cases[0].invocation.mode = 'implement';
      }),
      FIXTURE_COVERAGE_MISMATCH,
    );

    expectContractError(
      validateMutation((_manifest, fixtures) => {
        fixtures.cases[0].capability_refs.push('internal:closure-eligibility-gate');
      }),
      FIXTURE_CAPABILITY_UNRESOLVED,
    );
  });

  test('rejects incomplete fixture schema and writes forbidden by the selected mode', () => {
    expectContractError(
      validateMutation((_manifest, fixtures) => {
        delete fixtures.cases[0].expected.verdict;
      }),
      FIXTURE_SCHEMA_INVALID,
    );

    expectContractError(
      validateMutation((_manifest, fixtures) => {
        const reportOnly = fixtures.cases.find((fixtureCase: any) => fixtureCase.id === 'GR-09');
        reportOnly.expected.writes = ['docs/workflow/CURRENT_TASK.md'];
      }),
      FIXTURE_SCHEMA_INVALID,
    );

    expectContractError(
      validateMutation((_manifest, fixtures) => {
        const design = fixtures.cases.find((fixtureCase: any) => fixtureCase.id === 'MR-M05');
        design.expected.writes = ['design-baseline-artifacts'];
      }),
      FIXTURE_SCHEMA_INVALID,
    );

    expectContractError(
      validateMutation((_manifest, fixtures) => {
        const noOp = fixtures.cases.find((fixtureCase: any) => fixtureCase.id === 'MR-M19');
        noOp.expected.terminal_behavior = 'continue';
      }),
      FIXTURE_SCHEMA_INVALID,
    );

    expectContractError(
      validateMutation((_manifest, fixtures) => {
        const allowed = fixtures.cases.find((fixtureCase: any) => fixtureCase.id === 'GR-01');
        allowed.expected.terminal_behavior = 'complete';
      }),
      FIXTURE_SCHEMA_INVALID,
    );
  });
});
