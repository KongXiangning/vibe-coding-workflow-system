import { describe, expect, test } from 'bun:test';
import {
  CURRENT_TASK_PATH,
  assertBootstrapBaselineCurrentTask,
  expectedFixflowDogfoodBranch,
  isOnlyCurrentTaskWorktreeModification,
  parseFixflowDogfoodCleanupArgs,
  specimenBranchName,
  splitPorcelainStatusOutput,
} from '../scripts/fixflow-dogfood-cleanup';

const BOOTSTRAP_CURRENT_TASK = `---
runtime_state:
  task_id: '000'
  task_slug: bootstrap-baseline
  workflow_status: closed
  lifecycle_state: archived
  execution_log: []
  applied_proposals: []
---
`;

describe('fixflow-dogfood-cleanup', () => {
  test('accepts only an exact version plus explicit apply', () => {
    expect(parseFixflowDogfoodCleanupArgs(['--version', '0.14.7'])).toEqual({ version: '0.14.7', apply: false });
    expect(parseFixflowDogfoodCleanupArgs(['--apply', '--version', '1.2.3'])).toEqual({ version: '1.2.3', apply: true });
    expect(() => parseFixflowDogfoodCleanupArgs(['--version', '0.14'])).toThrow('exact x.y.z');
    expect(() => parseFixflowDogfoodCleanupArgs(['--target', 'C:\\elsewhere'])).toThrow('Unknown argument');
  });

  test('derives the version-scoped dogfood and specimen branch names', () => {
    expect(expectedFixflowDogfoodBranch('0.14.7').test('dogfood/round3-v0147')).toBe(true);
    expect(expectedFixflowDogfoodBranch('0.14.7').test('dogfood/round3-v0146')).toBe(false);
    expect(expectedFixflowDogfoodBranch('0.14.7').test('main')).toBe(false);
    expect(specimenBranchName('0.14.7', new Date(2026, 8, 8))).toBe('dogfood/prepare-task-v0147-failure-specimen-20260908');
  });

  test('admits only one unstaged CURRENT_TASK modification', () => {
    expect(isOnlyCurrentTaskWorktreeModification([` M ${CURRENT_TASK_PATH}`])).toBe(true);
    // Git porcelain uses the first column for the index and the second for
    // the worktree; the leading space is semantically significant.
    expect(isOnlyCurrentTaskWorktreeModification([`M  ${CURRENT_TASK_PATH}`])).toBe(false);
    expect(isOnlyCurrentTaskWorktreeModification([` M ${CURRENT_TASK_PATH}`, '?? notes.txt'])).toBe(false);
    expect(splitPorcelainStatusOutput(` M ${CURRENT_TASK_PATH}\r\n`)).toEqual([` M ${CURRENT_TASK_PATH}`]);
  });

  test('requires the committed task to be the closed bootstrap baseline', () => {
    expect(() => assertBootstrapBaselineCurrentTask(BOOTSTRAP_CURRENT_TASK)).not.toThrow();
    expect(() => assertBootstrapBaselineCurrentTask(BOOTSTRAP_CURRENT_TASK.replace('workflow_status: closed', 'workflow_status: draft'))).toThrow('workflow_status = closed');
    expect(() => assertBootstrapBaselineCurrentTask(BOOTSTRAP_CURRENT_TASK.replace('execution_log: []', 'execution_log:\n    - action: create-draft'))).toThrow('execution_log = []');
  });
});
