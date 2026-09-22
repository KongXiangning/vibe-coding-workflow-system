import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createEntryOutputDirectory, retainEntryOutput } from '../runtime/vnext/src/entry-output';

const ROOT = path.resolve(import.meta.dir, '..');
const CLI = path.join(ROOT, 'runtime/vnext/dist/cli.js');
const directories = new Set<string>();
function trackArtifact(reference: any): void {
  const directory = path.dirname(reference.path);
  const relative = path.relative(path.join(os.tmpdir(), 'vnext-entry-results'), directory);
  if (!/^run-[^/\\]+$/u.test(relative)) throw new Error('Unexpected test output directory.');
  directories.add(directory);
}
function readArtifact(reference: any): any {
  trackArtifact(reference);
  const bytes = fs.readFileSync(reference.path);
  expect(bytes.length).toBe(reference.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sha256);
  return JSON.parse(bytes.toString('utf8'));
}
afterEach(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

// A real child process emits deterministic large output to reproduce the old
// transport limit. This is not a substitute for a business-task scenario.
function largeOutput() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-entry-output-test-'));
  directories.add(root);
  const script = path.join(root, 'child.ts');
  fs.writeFileSync(script, `
import { runEntryRunnerCli } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'runtime/vnext/src/entry-runner.ts')).href)};
if (process.argv[2] === 'run-entry') {
  process.exitCode = await runEntryRunnerCli(process.argv.slice(2), ['large-output']);
} else {
  console.log(JSON.stringify({status: 'success', payload: '界'.repeat(6 * 1024 * 1024)}));
}
`);
  const result = spawnSync(process.execPath, [script, 'run-entry', '--root', root], {
    encoding: 'utf8', maxBuffer: 128 * 1024,
    input: JSON.stringify({ invocation: { id: 'large-output', entry: 'execute-step',
      intent: 'Retain the full operation result', decision_source: 'test:user', decision_text: 'Execute the current step.' },
      operation: { command: 'large-output', input: {} } }),
  });
  if (result.error) throw result.error;
  const summary = JSON.parse(result.stdout);
  trackArtifact(summary.detail_ref);
  return { ...result, summary };
}
function page(reference: any, offset = 0, max_bytes = 256) {
  return spawnSync('node', [CLI, 'entry-output-read'], {
    encoding: 'utf8', input: JSON.stringify({ reference, offset, max_bytes }), maxBuffer: 512 * 1024,
  });
}

describe('entry output transport', () => {
  test('retains output larger than the former 16 MiB limit while keeping the response compact', () => {
    const result = largeOutput();
    expect(result.status).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(16 * 1024);
    const full = readArtifact(result.summary.outcome_ref);
    expect(Buffer.byteLength(full.result.payload)).toBe(18 * 1024 * 1024);
    expect(full.result.payload).toBe('界'.repeat(6 * 1024 * 1024));
    expect(result.summary.recovery_history).toBeUndefined();
  }, 60_000);
});

describe('entry output paging', () => {
  test('reassembles Unicode receipt pages without gaps, overlap, or replacement characters', () => {
    const directory = createEntryOutputDirectory();
    directories.add(directory);
    const value = { receipt: '中😀文'.repeat(240), policy_route: { command: 'retry-step' } };
    const reference = retainEntryOutput(directory, 'unicode', value);
    let offset = 0;
    let result = '';
    while (true) {
      const response = page(reference, offset);
      expect(response.status).toBe(0);
      const chunk = JSON.parse(response.stdout);
      expect(chunk.offset).toBe(offset);
      expect(chunk.content).not.toContain('�');
      expect(Buffer.byteLength(chunk.content)).toBeLessThanOrEqual(256);
      result += chunk.content;
      if (chunk.next_offset === null) break;
      expect(chunk.next_offset).toBeGreaterThan(offset);
      offset = chunk.next_offset;
    }
    expect(JSON.parse(result)).toEqual(value);
    expect(Buffer.byteLength(result)).toBe(reference.bytes);
    const bytes = fs.readFileSync(reference.path);
    expect(page(reference, bytes.indexOf(Buffer.from('😀')) + 1).status).toBe(1);
    const end = page(reference, reference.bytes);
    expect(end.status).toBe(0);
    expect(JSON.parse(end.stdout)).toMatchObject({ content: '', next_offset: null });
    expect(fs.readFileSync(reference.path)).toEqual(bytes);
  }, 60_000);

  test('rejects changed receipt content and arbitrary file references', () => {
    const directory = createEntryOutputDirectory();
    directories.add(directory);
    const reference = retainEntryOutput(directory, 'receipt', { value: 'before' });
    fs.writeFileSync(reference.path, JSON.stringify({ value: 'after!' }));
    expect(page(reference).status).toBe(1);
    const outside = { ...reference, path: path.join(ROOT, 'package.json') };
    expect(page(outside).status).toBe(1);
  }, 20_000);
});
