import { describe, expect, test } from 'bun:test';
import { classifyFixflowChanges, isReleaseSurfacePath, nextFixflowDogfoodBranch, parseFixflowDogfoodUpgradeArgs } from '../scripts/fixflow-dogfood-upgrade';

describe('fixflow-dogfood-upgrade', () => {
  test('derives the next dogfood branch from the installed target version', () => {
    expect(nextFixflowDogfoodBranch('dogfood/round3-v0147', '0.14.7', '0.14.8')).toBe('dogfood/round4-v0148');
    expect(() => nextFixflowDogfoodBranch('dogfood/round3-v0147', '0.14.6', '0.14.8')).toThrow('does not identify');
  });

  test('requires one exact version and explicit apply', () => {
    expect(parseFixflowDogfoodUpgradeArgs(['--version', '0.14.8'])).toEqual({ version: '0.14.8', apply: false });
    expect(parseFixflowDogfoodUpgradeArgs(['--version', '0.14.8', '--apply'])).toEqual({ version: '0.14.8', apply: true });
    expect(() => parseFixflowDogfoodUpgradeArgs(['--version', '0.14.8-dev'])).toThrow('exact x.y.z');
  });

  test('classifies only manifest paths and runtime dependencies as committable', () => {
    const classification = classifyFixflowChanges([
      ' M .agents/skills/prepare-task/SKILL.md',
      '?? .workflow-system/runtime/node_modules/yaml/index.js',
      ' M docs/workflow/CURRENT_TASK.md',
      ' M src/server.ts',
      '?? unexpected.txt',
    ], ['.agents/skills/prepare-task/SKILL.md']);
    expect(classification.A_distribution_managed).toEqual(['.agents/skills/prepare-task/SKILL.md']);
    expect(classification.B_runtime_dependency).toEqual(['.workflow-system/runtime/node_modules/yaml/index.js']);
    expect(classification.C_governance).toEqual(['docs/workflow/CURRENT_TASK.md']);
    expect(classification.D_product).toEqual(['src/server.ts']);
    expect(classification.E_unknown).toEqual(['unexpected.txt']);
  });

  test('requires a clean release surface but permits local dogfood tooling changes', () => {
    expect(isReleaseSurfacePath('runtime/vnext/src/kernel.ts')).toBe(true);
    expect(isReleaseSurfacePath('templates/skills/prepare-task.SKILL.md.tmpl')).toBe(true);
    expect(isReleaseSurfacePath('scripts/vibe-governance-distribution.ts')).toBe(true);
    expect(isReleaseSurfacePath('scripts/fixflow-dogfood-upgrade.ts')).toBe(false);
    expect(isReleaseSurfacePath('test/fixflow-dogfood-upgrade.test.ts')).toBe(false);
    expect(isReleaseSurfacePath('README.md')).toBe(false);
  });
});
