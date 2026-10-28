import { expect, test } from 'bun:test';
import { parse, stringify } from 'yaml';
import { alignLegacyText } from '../scripts/migration-alignment';

test('migration retains project validation while retiring the known old task gate', () => {
  const business = { name: 'unit', owner: 'target-project', layer: 'project', command: 'node --test', blocker_level: 'blocks-merge' };
  const custom = { name: 'vnext-current-task', owner: 'target-project', layer: 'project', command: 'node scripts/check-task-links.js', blocker_level: 'warning-only' };
  for (const command of [
    'node .workflow-system/runtime/dist/cli.js validate --summary --root .',
    'node .workflow-system/runtime/dist/cli.js validate --root . --summary',
  ]) {
    const before = {
      runtime: { package_manager: 'npm', test_commands: ['node --test'] },
      validation: { matrix: [business, custom, { name: 'vnext-current-task', owner: 'workflow-system', layer: 'protocol', command, blocker_level: 'blocks-merge' }] },
    };
    const result = parse(alignLegacyText('.workflow-system/PROJECT_PROFILE.yaml', stringify(before), { host_files: [], workflow_documents: [] }, 'history/profile.yaml'));
    expect(result.runtime).toEqual(before.runtime);
    expect(result.validation.matrix).toEqual([business, custom, expect.objectContaining({
      name: 'vnext-contract', command: 'node .workflow-system/runtime/dist/cli.js validate-contract --root .',
    })]);
  }
});

test('migration installs only the software contract check when no matrix exists', () => {
  const result = parse(alignLegacyText('.workflow-system/PROJECT_PROFILE.yaml', 'project:\n  name: fixture\n', { host_files: [], workflow_documents: [] }, 'history/profile.yaml'));
  expect(result.validation.matrix).toHaveLength(1);
  expect(result.validation.matrix[0]).toMatchObject({ name: 'vnext-contract', owner: 'workflow-system', layer: 'protocol' });
});
