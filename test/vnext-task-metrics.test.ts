import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { describe, expect, test } from 'bun:test';
import { readCanonicalCurrentTask } from '../runtime/vnext/src/kernel';
import { TaskStore, commitTaskStorageMigration, sha256 } from '../runtime/vnext/src/task-store';
import { taskStorageMetrics } from '../runtime/vnext/src/task-storage-metrics';

const ROOT = path.resolve(import.meta.dir, '..');
function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-metrics-'));
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/workflow'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.workflow-system/PROJECT_PROFILE.yaml'), path.join(root, '.workflow-system/PROJECT_PROFILE.yaml'));
  fs.copyFileSync(path.join(ROOT, 'templates/vnext/bootstrap/CURRENT_TASK.md'), path.join(root, 'docs/workflow/CURRENT_TASK.md'));
  return root;
}
function publishedEncoding(root: string, indent: number, operation = 'task-storage-migration') {
  const before = readCanonicalCurrentTask(root);
  const header = /^---\n([\s\S]*?)\n---\n/u.exec(before.raw)!;
  const raw = `---\n${JSON.stringify(parse(header[1]!), null, indent)}\n---\n${before.raw.slice(header[0].length)}`;
  const after = { ...before, raw, sourceTuple: { ...before.sourceTuple, revision: sha256(raw) } };
  const input = { before, after,
    proposal: { operation_kind: operation, idempotency_key: `spelling-${indent}` },
    result: { operation_kind: operation, idempotency_key: `spelling-${indent}`, status: 'success', committed: true } };
  const store = TaskStore.forCurrent(root, before);
  store.stageCommit({ ...input, after_source_revision: after.sourceTuple.revision, write_targets: [after.relativePath] });
  fs.writeFileSync(after.filePath, raw);
  store.markCurrentPublished(after.sourceTuple.revision);
  store.recordCommit(input);
  return readCanonicalCurrentTask(root);
}

describe('read-only task storage metrics', () => {
  test('reports UTF-8 bytes for large inline tasks without creating a store or a size gate', () => {
    const root = fixtureRoot();
    try {
      const file = path.join(root, 'docs/workflow/CURRENT_TASK.md');
      fs.appendFileSync(file, '\n## 观测材料\n' + '中文😀'.repeat(8000) + '\n');
      const current = readCanonicalCurrentTask(root);
      const before = fs.readFileSync(file);
      const m = taskStorageMetrics(root, current);
      expect(m.active_projection_bytes).toBe(before.length);
      expect(m.active_projection_bytes).toBeGreaterThan(50000);
      expect(m.active_projection_bytes).toBeGreaterThan(current.raw.length);
      expect(m.definition_bytes!).toBeGreaterThan(50000);
      expect(m.aggregate_total_bytes).toBeNull();
      expect(m.previous_transaction_delta.definition_bytes).toBeNull();
      expect(m.previous_transaction_delta.reason).toBe('NO_PREVIOUS_EVENT');
      expect(m.coverage.notes).toContain('NO_COMMITTED_AGGREGATE');
      expect(taskStorageMetrics(root, current)).toEqual(m);
      expect(fs.readFileSync(file)).toEqual(before);
      expect(fs.existsSync(path.join(root, 'docs/workflow/task-data'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('counts unique committed growth separately from physical orphans and unknown historical emitter bytes', () => {
    const root = fixtureRoot();
    try {
      const old = readCanonicalCurrentTask(root);
      commitTaskStorageMigration(root, old, old.sourceTuple.revision);
      const first = readCanonicalCurrentTask(root);
      const baseline = taskStorageMetrics(root, first);
      const alternate = publishedEncoding(root, 2);
      const one = taskStorageMetrics(root, alternate);
      expect(one.previous_transaction_delta.active_projection_bytes).toBe(one.active_projection_bytes - baseline.active_projection_bytes);
      expect(one.previous_transaction_delta.definition_bytes).toBe(0);
      expect(one.previous_transaction_delta.committed_material_bytes).toBe(one.committed_material_bytes! - baseline.committed_material_bytes!);
      // A second transaction has an old JSON-spelled YAML projection. Its exact
      // raw preimage is retained by storage migration, not guessed by a renderer.
      const second = publishedEncoding(root, 3);
      const secondMetrics = taskStorageMetrics(root, second);
      expect(secondMetrics.previous_transaction_delta.active_projection_bytes).toBe(secondMetrics.active_projection_bytes - one.active_projection_bytes);
      const last = publishedEncoding(root, 4, 'task-state-transaction');
      const two = taskStorageMetrics(root, last);
      expect(two.previous_transaction_delta.active_projection_bytes).toBeNull();
      expect(two.previous_transaction_delta.reason).toBe('HISTORICAL_PHYSICAL_BYTES_UNAVAILABLE');
      expect(two.previous_transaction_delta.definition_bytes).toBe(0);
      expect(two.previous_transaction_delta.logical_state_bytes).toBe(0);
      const store = TaskStore.forCurrent(root, last);
      const measure = store.measure();
      expect(two.aggregate_total_bytes).toBe(measure.total_bytes);
      const events = store.listEvents(); const lastEvent = events.at(-1)!;
      const priorHashes = new Set(events.slice(0, -1).flatMap(e => Object.values(e.object_refs).filter(Boolean).map(r => typeof r === 'string' ? r : r!.sha256)));
      const addedHashes = new Set(Object.values(lastEvent.object_refs).filter(Boolean).map(r => typeof r === 'string' ? r : r!.sha256).filter(r => !priorHashes.has(r)));
      const expectedAdded = [...addedHashes].reduce((n, hash) => n + fs.statSync(path.join(store.paths.objects, `${hash}.json`)).size, 0)
        + fs.statSync(path.join(store.paths.events, `${String(lastEvent.sequence).padStart(12, '0')}-${lastEvent.event_hash}.json`)).size;
      expect(two.previous_transaction_delta.committed_material_bytes).toBe(expectedAdded);
      fs.writeFileSync(path.join(store.paths.objects, 'f'.repeat(64) + '.json'), 'not a committed object');
      const orphan = taskStorageMetrics(root, last);
      expect(orphan.aggregate_total_bytes).toBe(two.aggregate_total_bytes! + Buffer.byteLength('not a committed object'));
      expect(orphan.committed_material_bytes).toBe(two.committed_material_bytes);
      expect(orphan.external_history_bytes).toBe(two.external_history_bytes);
      expect(orphan.previous_transaction_delta.committed_material_bytes).toBe(two.previous_transaction_delta.committed_material_bytes);
      expect(orphan.previous_transaction_delta.aggregate_total_bytes).toBeNull();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('optional diagnostic failures and inventory budgets do not block validate or follow outside paths', () => {
    const root = fixtureRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-metrics-outside-'));
    try {
      const old = readCanonicalCurrentTask(root);
      commitTaskStorageMigration(root, old, old.sourceTuple.revision);
      const current = readCanonicalCurrentTask(root);
      const store = TaskStore.forCurrent(root, current);
      const source = fs.readFileSync(current.filePath);
      const manifest = fs.readFileSync(store.paths.manifest);
      const extra = path.join(store.paths.directory, 'unrelated');
      fs.mkdirSync(extra);
      fs.symlinkSync(outside, path.join(extra, 'outside'), 'junction');
      const symlink = taskStorageMetrics(root, current);
      expect(symlink.coverage.notes).toContain('METRICS_SYMLINK');
      expect(symlink.aggregate_total_bytes).toBeNull();
      expect(fs.readdirSync(outside)).toEqual([]);
      const cli = () => spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'validate', '--summary', '--root', root], { encoding: 'utf8' });
      const sampled = cli();
      expect(sampled.status, sampled.stderr).toBe(0);
      expect(JSON.parse(sampled.stdout).status).toBe('success');
      expect(JSON.parse(sampled.stdout).storage_metrics.status).toBe('partial');
      fs.unlinkSync(path.join(extra, 'outside'));
      for (let i = 0; i <= symlink.coverage.limits.files; i++) fs.writeFileSync(path.join(extra, String(i)), '');
      const limited = taskStorageMetrics(root, current);
      expect(limited.coverage.notes).toContain('METRICS_INVENTORY_BUDGET');
      expect(limited.aggregate_total_bytes).toBeNull();
      expect(limited.definition_bytes).toBe(symlink.definition_bytes);
      expect(cli().status).toBe(0);
      expect(fs.readFileSync(current.filePath)).toEqual(source);
      expect(fs.readFileSync(store.paths.manifest)).toEqual(manifest);
      fs.rmSync(extra, { recursive: true, force: true });
      const proposal = store.latestEvents(1)[0]!.object_refs.proposal as any;
      const proposalFile = path.join(store.paths.objects, `${proposal.sha256}.json`);
      const validProposal = fs.readFileSync(proposalFile);
      fs.writeFileSync(proposalFile, Buffer.concat([Buffer.alloc(limited.coverage.limits.read_bytes + 1, 32), validProposal]));
      const readLimited = taskStorageMetrics(root, current);
      expect(readLimited.coverage.notes).toContain('METRICS_READ_BUDGET');
      expect(cli().status).toBe(0);

      fs.writeFileSync(proposalFile, '{}');
      const damagedHistory = taskStorageMetrics(root, current);
      expect(damagedHistory.coverage.notes).toContain('TASK_STORE_OBJECT_INVALID');
      // Diagnostics cannot weaken or strengthen current-aggregate validation.
      expect(cli().status).toBe(0);
      fs.writeFileSync(proposalFile, validProposal);
      fs.writeFileSync(path.join(store.paths.objects, `${store.manifest!.object_refs.definition.sha256}.json`), '{}');
      expect(cli().status).not.toBe(0);

    } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  });
});
