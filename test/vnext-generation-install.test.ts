import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { task, record } from '../runtime/vnext/support/assistance.mjs';
import { archiveCommand, storeReadFile } from '../runtime/vnext/support/record-storage.mjs';
import { installDistribution, upgradeDistribution } from '../scripts/vibe-governance-distribution';

const ROOT = path.resolve(import.meta.dir, '..'), packageRoot = path.join(ROOT, 'packages/vibe-governance');
const STORE = '.workflow-system/records', roots: string[] = [];
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function put(root: string, ref: string, content: string | Buffer) {
  const file = path.join(root, ref); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
}
function records(root: string) {
  const files: Record<string, string> = {};
  const walk = (ref: string) => {
    for (const entry of fs.readdirSync(path.join(root, ref), { withFileTypes: true })) {
      const child = `${ref}/${entry.name}`;
      if (entry.isDirectory()) walk(child); else files[child] = sha(fs.readFileSync(path.join(root, child)));
    }
  };
  walk(STORE); return files;
}

test('distribution installs codec and native readers preserve old/new records through install and upgrade', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-generation-install-')); roots.push(root);
  put(root, 'package.json', '{"name":"generation-install-fixture","private":true}\n');
  const prepare = task(root, { action: 'prepare', plan: { title: 'Installed complete report', steps: [{ id: 'S1' }] } });
  task(root, { action: 'adopt', task_id: prepare.task_id, plan_ref: prepare.ref });
  const prior = record(root, { kind: 'old-v1-report', body: 'Earlier independent failure must remain exact\r\n' });
  const report = '完整正文 installed native report🙂\r\n'.repeat(1500);
  const execution = task(root, { action: 'execution', result: 'failed', report,
    evidence_refs: [{ ref: prior.ref, sha256: prior.sha256, purpose: 'Previous report, fixed identity' }] });
  const oldBytes = storeReadFile(root, prepare.ref), newBytes = storeReadFile(root, execution.ref);
  expect(JSON.parse(oldBytes.toString()).payload.task_event.version).toBe(1);
  expect(JSON.parse(newBytes.toString()).payload.task_event.version).toBe(2);
  archiveCommand(root, { action: 'create' }); archiveCommand(root, { action: 'quarantine' });
  const later = record(root, { kind: 'new-loose-report', body: 'Late evidence remains separate' });
  const before = records(root), display = fs.readFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'));
  expect(Object.keys(before).some(ref => ref.includes('/archives/'))).toBe(true);
  expect(Object.keys(before).some(ref => ref.includes('/archive-quarantine/'))).toBe(true);
  const installed = installDistribution({ targetRoot: root, packageRoot });
  expect(installed.status, JSON.stringify(installed.blockers)).toBe('installed');
  expect(records(root)).toEqual(before);
  expect(fs.readFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'))).toEqual(display);
  for (const name of ['assistance.mjs', 'task-management.mjs', 'task-event-codec.mjs', 'record-storage.mjs']) {
    const source = fs.readFileSync(path.join(ROOT, 'runtime/vnext/support', name));
    expect(sha(fs.readFileSync(path.join(root, '.workflow-system/runtime/support', name))), `Rebuild distribution for ${name}`).toBe(sha(source));
    expect(sha(fs.readFileSync(path.join(packageRoot, 'payload/migration-source/runtime/vnext/support', name)))).toBe(sha(source));
  }
  expect(sha(fs.readFileSync(path.join(root, '.agents/skills/execute-step/SKILL.md')))).toBe(sha(fs.readFileSync(path.join(ROOT, 'templates/vnext/skills/execute-step.SKILL.md.tmpl'))));
  expect(sha(fs.readFileSync(path.join(root, '.workflow-system/WORKFLOW_PROTOCOL.md')))).toBe(sha(fs.readFileSync(path.join(ROOT, 'templates/vnext/bootstrap/WORKFLOW_PROTOCOL.md'))));
  const cli = path.join(root, '.workflow-system/runtime/support/assistance.mjs');
  const call = (command: string, input: unknown) => JSON.parse(execFileSync('node', [cli, command, '--root', root], { encoding: 'utf8', input: JSON.stringify(input), env: { ...process.env, NODE_PATH: undefined, BUN_INSTALL: undefined } }));
  const nativeStatus = call('task-status', { detail: 'step', task_ref: prepare.task_id, step_id: 'S1' });
  expect(nativeStatus.step.execution_ref).toBe(execution.ref);
  const hydrated = call('read', { ref: execution.ref, format: 'logical-task-event' });
  expect(hydrated.payload.task_event.data.report).toBe(report);
  expect(hydrated.payload.task_event.data.result).toBe('failed');
  expect(call('read', { ref: prepare.ref, format: 'logical-task-event' }).payload.task_event.version).toBe(1);
  expect(Buffer.from(call('read', { ref: prepare.ref, max_bytes: 65536 }).data, 'base64')).toEqual(oldBytes);
  expect(Buffer.from(call('read', { ref: later.ref, max_bytes: 65536 }).data, 'base64')).toEqual(storeReadFile(root, later.ref));
  const contextCli = path.join(root, '.workflow-system/runtime/dist/cli.js');
  let contextOffset = 0, contextText = '';
  for (;;) {
    const exact = JSON.parse(execFileSync('node', [contextCli, 'file-context', '--root', root], { encoding: 'utf8',
      input: JSON.stringify({ operation: 'read', path: execution.ref, offset: contextOffset, sha256: sha(newBytes) }) }));
    expect(exact.status).toBe('pass'); expect(exact.sha256).toBe(sha(newBytes));
    contextText += exact.text;
    if (exact.next_offset === null) break;
    expect(exact.next_offset).toBeGreaterThan(contextOffset); contextOffset = exact.next_offset;
  }
  expect(contextText).toBe(newBytes.toString());
  const stateRef = '.workflow-system/vnext/DISTRIBUTION_STATE.json';
  const state = JSON.parse(fs.readFileSync(path.join(root, stateRef), 'utf8'));
  expect(state.managed_files.some((file: any) => file.path.endsWith('/task-event-codec.mjs'))).toBe(true);
  expect(state.managed_files.some((file: any) => file.path.startsWith(`${STORE}/`))).toBe(false);
  state.distribution_version = '0.0.1'; put(root, stateRef, JSON.stringify(state));
  const upgraded = upgradeDistribution({ targetRoot: root, packageRoot });
  expect(upgraded.status, JSON.stringify(upgraded.blockers)).toBe('upgraded');
  expect(records(root)).toEqual(before);
  expect(call('read', { ref: execution.ref, format: 'logical-task-event' }).payload).toEqual(hydrated.payload);
  expect(call('task-status', { detail: 'step', task_ref: prepare.task_id, step_id: 'S1' }).step.execution_ref).toBe(execution.ref);
  call('archive', { action: 'restore' });
  expect(fs.readFileSync(path.join(root, prepare.ref))).toEqual(oldBytes);
  expect(fs.readFileSync(path.join(root, execution.ref))).toEqual(newBytes);
});
