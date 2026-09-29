import { expect, test } from 'bun:test';
import { renderAssistanceGuidance, updateHostGuidance } from '../runtime/vnext/src/host-guidance';

test('bootstrap guidance replacement retains business additions and CRLF bytes', () => {
  const product = '## Product authority\r\n- Only the user may change the storage boundary.\r\n';
  const input = '<!-- vNext bootstrap managed guidance; preserve target-owned additions outside this block. -->\r\n'
    + '# Example workflow guidance\r\n\r\n- Use `execute-step` only for the admitted current step.\r\n'
    + '- Custom: run commands from this repository.\r\n## Public entry terminal boundary\r\n'
    + '- After a terminal result, return to the caller and stop.\r\nProject slug: example\r\n\r\n' + product;
  const result = updateHostGuidance(input);
  expect(result).toContain('- Custom: run commands from this repository.\r\n');
  expect(result.endsWith(product)).toBe(true);
  expect(result).not.toContain('only for the admitted current step');
  expect(result).not.toContain('return to the caller and stop');
  expect(updateHostGuidance(result)).toBe(result);
});

test('migration sections do not consume the following project title or custom instructions', () => {
  const suffix = '# Product\n用中文回答。\n## Architecture\n- Keep the source-of-truth boundary.\n';
  const input = '## workflow-system baseline\n'
    + '- 先读对应 SKILL.md；prepare/confirm、review 和完成校验按当前 Runtime 契约执行。\n'
    + '- Custom validation belongs to this project.\n' + suffix;
  const result = updateHostGuidance(input);
  expect(result.endsWith(suffix)).toBe(true);
  expect(result).toContain('- Custom validation belongs to this project.\n');
  expect(result).not.toContain('完成校验按当前 Runtime 契约执行');
  expect(updateHostGuidance(result)).toBe(result);
});

test('subsequent guidance refresh only replaces the bounded managed block', () => {
  const before = '# Project instructions\n- Do not change business contracts.\n';
  const after = '\n## Local rules\n- Only deploy on explicit request.\n';
  const result = updateHostGuidance(before + '<!-- vnext-assistance-guidance:start -->\nobsolete\n<!-- vnext-assistance-guidance:end -->' + after);
  expect(result).toBe(before + renderAssistanceGuidance() + after);
  expect(() => updateHostGuidance('<!-- vnext-assistance-guidance:start -->')).toThrow('Ambiguous');
});
