import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { parse } from 'yaml';
import { readText } from '../scripts/workflow-core';
import {
  type BlockerLevel,
  type ValidationEntrypoint,
  type ValidationResult,
  DEFAULT_PROJECT_SLOTS,
  PROTOCOL_ENTRYPOINTS,
  VALID_BLOCKER_LEVELS,
  VALID_LAYERS,
  VALID_OWNERS,
  blockerLevelExceeds,
  blockerSeverity,
  buildValidationReport,
  getBoundEntrypoints,
  getBlockedGates,
  isEntrypointBound,
  isValidBlockerLevel,
  isValidLayer,
  isValidOwner,
  parseValidationMatrix,
  partitionByLayer,
} from '../scripts/validation-model';

const ROOT = path.resolve(import.meta.dir, '..');

describe('validation-model', () => {
  test('validation layer enum contains exactly two values', () => {
    expect(VALID_LAYERS).toEqual(['protocol', 'project']);
  });

  test('blocker level enum has correct severity order', () => {
    expect(VALID_BLOCKER_LEVELS).toEqual([
      'blocks-generator',
      'blocks-merge',
      'blocks-ship',
      'warning-only',
    ]);
    expect(blockerSeverity('blocks-generator')).toBeGreaterThan(blockerSeverity('blocks-merge'));
    expect(blockerSeverity('blocks-merge')).toBeGreaterThan(blockerSeverity('blocks-ship'));
    expect(blockerSeverity('blocks-ship')).toBeGreaterThan(blockerSeverity('warning-only'));
    expect(blockerSeverity('warning-only')).toBe(0);
  });

  test('blocker level comparison works correctly', () => {
    expect(blockerLevelExceeds('blocks-generator', 'blocks-merge')).toBe(true);
    expect(blockerLevelExceeds('blocks-merge', 'blocks-generator')).toBe(false);
    expect(blockerLevelExceeds('blocks-merge', 'blocks-merge')).toBe(false);
    expect(blockerLevelExceeds('blocks-ship', 'warning-only')).toBe(true);
    expect(blockerLevelExceeds('warning-only', 'blocks-ship')).toBe(false);
  });

  test('isValid* type guards accept valid values and reject invalid ones', () => {
    expect(isValidLayer('protocol')).toBe(true);
    expect(isValidLayer('project')).toBe(true);
    expect(isValidLayer('unknown')).toBe(false);

    expect(isValidBlockerLevel('blocks-generator')).toBe(true);
    expect(isValidBlockerLevel('blocks-merge')).toBe(true);
    expect(isValidBlockerLevel('blocks-ship')).toBe(true);
    expect(isValidBlockerLevel('warning-only')).toBe(true);
    expect(isValidBlockerLevel('blocks-all')).toBe(false);

    expect(isValidOwner('workflow-system')).toBe(true);
    expect(isValidOwner('target-project')).toBe(true);
    expect(isValidOwner('other')).toBe(false);
  });

  test('protocol entrypoints have all required fields and valid values', () => {
    expect(PROTOCOL_ENTRYPOINTS.length).toBe(8);
    for (const entry of PROTOCOL_ENTRYPOINTS) {
      expect(isValidLayer(entry.layer)).toBe(true);
      expect(entry.layer).toBe('protocol');
      expect(isValidBlockerLevel(entry.blocker_level)).toBe(true);
      expect(isValidOwner(entry.owner)).toBe(true);
      expect(entry.owner).toBe('workflow-system');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(isEntrypointBound(entry)).toBe(true);
    }
  });

  test('protocol entrypoints include the minimum set defined by §16.4', () => {
    const names = PROTOCOL_ENTRYPOINTS.map(e => e.name);
    expect(names).toContain('workflow-skills-validation');
    expect(names).toContain('workflow-docs-validation');
    expect(names).toContain('registry-validation');
    expect(names).toContain('workflow-skills-tests');
    expect(names).toContain('workflow-docs-tests');
    expect(names).toContain('registry-tests');
    expect(names).toContain('bootstrap-tests');
    expect(names).toContain('task-identity-tests');
  });

  test('default project slots are all unbound and seed blocks-merge defaults', () => {
    expect(DEFAULT_PROJECT_SLOTS.length).toBe(4);
    for (const slot of DEFAULT_PROJECT_SLOTS) {
      expect(slot.layer).toBe('project');
      expect(slot.owner).toBe('target-project');
      expect(slot.blocker_level).toBe('blocks-merge');
      expect(isEntrypointBound(slot)).toBe(false);
    }
  });

  test('isEntrypointBound distinguishes bound from unbound', () => {
    expect(isEntrypointBound({ ...DEFAULT_PROJECT_SLOTS[0], command: 'bun test' })).toBe(true);
    expect(isEntrypointBound({ ...DEFAULT_PROJECT_SLOTS[0], command: '' })).toBe(false);
    expect(isEntrypointBound({ ...DEFAULT_PROJECT_SLOTS[0], command: '  ' })).toBe(false);
    expect(isEntrypointBound({ ...DEFAULT_PROJECT_SLOTS[0], command: '{{UNIT_TEST_CMD}}' })).toBe(false);
  });

  test('parseValidationMatrix accepts valid entries', () => {
    const entries = [
      {
        name: 'test-entry',
        layer: 'protocol',
        command: 'bun test',
        blocker_level: 'blocks-merge',
        description: 'A test entry',
        phase: 'P9',
        owner: 'workflow-system',
      },
      {
        name: 'project-entry',
        layer: 'project',
        command: '',
        blocker_level: 'blocks-merge',
        description: 'A project slot',
        phase: 'A4',
        owner: 'target-project',
      },
    ];

    const matrix = parseValidationMatrix(entries);
    expect(matrix.entrypoints).toHaveLength(2);
    expect(matrix.entrypoints[0].name).toBe('test-entry');
    expect(matrix.entrypoints[1].name).toBe('project-entry');
  });

  test('parseValidationMatrix rejects missing fields', () => {
    expect(() => parseValidationMatrix([{ name: 'bad' }])).toThrow('missing required field');
    expect(() =>
      parseValidationMatrix([{ name: 'bad', layer: 'protocol', command: '', description: 'x', phase: 'P9', owner: 'workflow-system' }]),
    ).toThrow('missing required field "blocker_level"');
  });

  test('parseValidationMatrix rejects invalid layer', () => {
    expect(() =>
      parseValidationMatrix([
        {
          name: 'bad',
          layer: 'invalid-layer',
          command: '',
          blocker_level: 'blocks-merge',
          description: 'x',
          phase: 'P9',
          owner: 'workflow-system',
        },
      ]),
    ).toThrow('invalid layer');
  });

  test('parseValidationMatrix rejects invalid blocker_level', () => {
    expect(() =>
      parseValidationMatrix([
        {
          name: 'bad',
          layer: 'protocol',
          command: '',
          blocker_level: 'blocks-everything',
          description: 'x',
          phase: 'P9',
          owner: 'workflow-system',
        },
      ]),
    ).toThrow('invalid blocker_level');
  });

  test('parseValidationMatrix rejects invalid owner', () => {
    expect(() =>
      parseValidationMatrix([
        {
          name: 'bad',
          layer: 'protocol',
          command: '',
          blocker_level: 'blocks-merge',
          description: 'x',
          phase: 'P9',
          owner: 'nobody',
        },
      ]),
    ).toThrow('invalid owner');
  });

  test('parseValidationMatrix rejects duplicate names', () => {
    const dup = {
      name: 'same-name',
      layer: 'protocol',
      command: 'bun test',
      blocker_level: 'blocks-merge',
      description: 'x',
      phase: 'P9',
      owner: 'workflow-system',
    };
    expect(() => parseValidationMatrix([dup, dup])).toThrow('Duplicate');
  });

  test('parseValidationMatrix rejects protocol workflow-system demotion below blocks-merge', () => {
    expect(() =>
      parseValidationMatrix([
        {
          name: 'bad-demotion',
          layer: 'protocol',
          command: 'bun test',
          blocker_level: 'warning-only',
          description: 'x',
          phase: 'P9',
          owner: 'workflow-system',
        },
      ]),
    ).toThrow('cannot be demoted below blocks-merge');

    expect(() =>
      parseValidationMatrix([
        {
          name: 'bad-ship-demotion',
          layer: 'protocol',
          command: 'bun test',
          blocker_level: 'blocks-ship',
          description: 'x',
          phase: 'P9',
          owner: 'workflow-system',
        },
      ]),
    ).toThrow('cannot be demoted below blocks-merge');
  });

  test('parseValidationMatrix rejects project-layer blocks-generator entrypoints', () => {
    expect(() =>
      parseValidationMatrix([
        {
          name: 'bad-project-generator-blocker',
          layer: 'project',
          command: 'bun test',
          blocker_level: 'blocks-generator',
          description: 'x',
          phase: 'A4',
          owner: 'target-project',
        },
      ]),
    ).toThrow('project-layer entrypoints cannot use blocker_level "blocks-generator"');
  });

  test('partitionByLayer separates protocol and project entrypoints', () => {
    const combined = [...PROTOCOL_ENTRYPOINTS, ...DEFAULT_PROJECT_SLOTS] as ValidationEntrypoint[];
    const partitioned = partitionByLayer(combined);
    expect(partitioned.protocol).toHaveLength(PROTOCOL_ENTRYPOINTS.length);
    expect(partitioned.project).toHaveLength(DEFAULT_PROJECT_SLOTS.length);
    expect(partitioned.protocol.every(e => e.layer === 'protocol')).toBe(true);
    expect(partitioned.project.every(e => e.layer === 'project')).toBe(true);
  });

  test('getBoundEntrypoints filters out unbound slots', () => {
    const combined = [...PROTOCOL_ENTRYPOINTS, ...DEFAULT_PROJECT_SLOTS] as ValidationEntrypoint[];
    const bound = getBoundEntrypoints(combined);
    expect(bound.length).toBe(PROTOCOL_ENTRYPOINTS.length);
    expect(bound.every(e => isEntrypointBound(e))).toBe(true);
  });

  test('getBlockedGates returns failed blocker levels sorted by severity', () => {
    const results: ValidationResult[] = [
      { entrypoint: 'a', layer: 'protocol', blocker_level: 'blocks-merge', status: 'failed' },
      { entrypoint: 'b', layer: 'protocol', blocker_level: 'blocks-generator', status: 'failed' },
      { entrypoint: 'c', layer: 'project', blocker_level: 'warning-only', status: 'failed' },
      { entrypoint: 'd', layer: 'project', blocker_level: 'blocks-ship', status: 'passed' },
    ];

    const gates = getBlockedGates(results);
    expect(gates).toEqual(['blocks-generator', 'blocks-merge']);
  });

  test('buildValidationReport computes protocol/project authority correctly', () => {
    const protocolPass: ValidationResult[] = [
      { entrypoint: 'a', layer: 'protocol', blocker_level: 'blocks-generator', status: 'passed' },
    ];
    const projectFail: ValidationResult[] = [
      { entrypoint: 'b', layer: 'project', blocker_level: 'blocks-merge', status: 'failed' },
    ];

    const report = buildValidationReport(protocolPass, projectFail);
    expect(report.protocol_passed).toBe(true);
    expect(report.project_passed).toBe(false);
    expect(report.project_authoritative).toBe(true);
    expect(report.blocked_gates).toEqual(['blocks-merge']);
  });

  test('buildValidationReport marks project as non-authoritative when protocol fails', () => {
    const protocolFail: ValidationResult[] = [
      { entrypoint: 'a', layer: 'protocol', blocker_level: 'blocks-generator', status: 'failed' },
    ];
    const projectPass: ValidationResult[] = [
      { entrypoint: 'b', layer: 'project', blocker_level: 'blocks-merge', status: 'passed' },
    ];

    const report = buildValidationReport(protocolFail, projectPass);
    expect(report.protocol_passed).toBe(false);
    expect(report.project_passed).toBe(true);
    expect(report.project_authoritative).toBe(false);
  });

  test('warning-only failures do not make protocol or project fail', () => {
    const protocolWarn: ValidationResult[] = [
      { entrypoint: 'a', layer: 'protocol', blocker_level: 'warning-only', status: 'failed' },
    ];
    const projectWarn: ValidationResult[] = [
      { entrypoint: 'b', layer: 'project', blocker_level: 'warning-only', status: 'failed' },
    ];

    const report = buildValidationReport(protocolWarn, projectWarn);
    expect(report.protocol_passed).toBe(true);
    expect(report.project_passed).toBe(true);
    expect(report.blocked_gates).toEqual([]);
  });

  test('PROJECT_PROFILE.yaml validation matrix parses successfully', () => {
    const profileContent = readText(path.join(ROOT, 'PROJECT_PROFILE.yaml'));
    const profile = parse(profileContent) as Record<string, unknown>;
    const matrixRaw = (profile.validation as Record<string, unknown>)?.matrix;
    expect(Array.isArray(matrixRaw)).toBe(true);

    const matrix = parseValidationMatrix(matrixRaw as unknown[]);
    expect(matrix.entrypoints.length).toBeGreaterThanOrEqual(12);

    const partitioned = partitionByLayer(matrix.entrypoints);
    expect(partitioned.protocol.length).toBe(8);
    expect(partitioned.project.length).toBeGreaterThanOrEqual(4);

    for (const entry of partitioned.protocol) {
      expect(entry.owner).toBe('workflow-system');
      expect(isEntrypointBound(entry)).toBe(true);
    }

    for (const entry of partitioned.project) {
      expect(entry.owner).toBe('target-project');
      expect(entry.blocker_level).toBe('blocks-merge');
      expect(isEntrypointBound(entry)).toBe(false);
    }
  });

  test('protocol-level and project-level failures cannot be conflated', () => {
    const results: ValidationResult[] = [
      { entrypoint: 'proto', layer: 'protocol', blocker_level: 'blocks-generator', status: 'failed' },
      { entrypoint: 'proj', layer: 'project', blocker_level: 'blocks-merge', status: 'passed' },
    ];

    const protocolResults = results.filter(r => r.layer === 'protocol');
    const projectResults = results.filter(r => r.layer === 'project');
    const report = buildValidationReport(protocolResults, projectResults);

    expect(report.protocol_passed).toBe(false);
    expect(report.project_passed).toBe(true);
    expect(report.project_authoritative).toBe(false);
    expect(report.protocol_results).toHaveLength(1);
    expect(report.project_results).toHaveLength(1);
  });

  test('docs and registry freshness are protocol-level gates per §16.5', () => {
    const freshness = PROTOCOL_ENTRYPOINTS.filter(
      e => e.name.includes('validation') && e.blocker_level === 'blocks-generator',
    );
    expect(freshness.length).toBe(3);
    expect(freshness.map(e => e.name).sort()).toEqual([
      'registry-validation',
      'workflow-docs-validation',
      'workflow-skills-validation',
    ]);
  });
});
