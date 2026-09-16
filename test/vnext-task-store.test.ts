import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { readCanonicalCurrentTask } from '../runtime/vnext/src/kernel';
import { taskRead } from '../runtime/vnext/src/task-context';
import { TaskStore, commitTaskStorageMigration, digest, sha256, stableJson } from '../runtime/vnext/src/task-store';

const ROOT = path.resolve(import.meta.dir, '..');

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-task-store-'));
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'workflow'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.workflow-system', 'PROJECT_PROFILE.yaml'), path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml'));
  fs.copyFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), path.join(root, 'docs', 'workflow', 'CURRENT_TASK.md'));
  return root;
}

describe('vNext task aggregate store', () => {
  test('deduplicates unchanged objects while retaining every event and old idempotency key', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const store = TaskStore.forCurrent(root, current as any);
      const initial = store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const definitionSha = initial.object_refs.definition.sha256;
      const stateSha = initial.object_refs.state.sha256;
      for (let index = 0; index < 260; index += 1) {
        const key = `store-event-${index}`;
        store.recordCommit({
          before: current as any,
          after: current as any,
          proposal: { schema_version: 1, kind: 'test-proposal', idempotency_key: key, operation_kind: 'task-state-transaction', semantic_delta: { kind: 'test', index } },
          result: { status: 'success', committed: true, operation_kind: 'task-state-transaction', idempotency_key: key, message: 'retained fact' },
          recorded_at: '2026-01-01T00:00:00.000Z',
        });
      }
      const manifest = store.manifest!;
      expect(manifest.head.event_sequence).toBe(261);
      expect(manifest.counts.events).toBe(261);
      expect(manifest.object_refs.definition.sha256).toBe(definitionSha);
      expect(manifest.object_refs.state.sha256).toBe(stateSha);
      expect(store.listEvents()).toHaveLength(261);
      expect(store.lookupIdempotency('store-event-0')?.event.sequence).toBe(2);
      expect(store.lookupIdempotency('store-event-259')?.event.sequence).toBe(261);
      expect(store.deepValidate().status).toBe('valid');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60000);

  test('keeps exact current/history reads bounded and fails clearly for missing history', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const store = TaskStore.forCurrent(root, current as any);
      store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const page = taskRead(root, { kind: 'events', max_bytes: 4096 });
      expect(page.status).toBe('success');
      expect(page.complete_for_operation).toBe(true);
      expect(page.continuation).toBeNull();
      expect(() => taskRead(root, { kind: 'history-material', source_revision: 'a'.repeat(64) })).toThrow('TASK_READ_HISTORY_MISSING');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('references an unchanged evidence report only from its original event', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const report = { schema_version: 1, kind: 'evidence-report/v1', result_id: 'result-1', outcome: 'passed', subject_revision: current.sourceTuple.revision };
      const withEvidence = {
        ...current,
        runtimeState: {
          ...current.runtimeState,
          claim_evidence: [{
            claim_id: 'claim-1',
            claim_kind: 'acceptance',
            requirement: 'retained evidence',
            slots: [{ slot_id: 'slot-1', check_id: 'check-1', minimum_type: 'test', disposition: 'newly-executed', report }],
          }],
        },
      };
      const store = TaskStore.forCurrent(root, withEvidence as any);
      store.ensureInitialized(withEvidence as any, '2026-01-01T00:00:00.000Z');
      store.recordCommit({
        before: withEvidence as any,
        after: withEvidence as any,
        proposal: { schema_version: 1, kind: 'test-proposal', idempotency_key: 'unchanged-report', operation_kind: 'task-state-transaction' },
        result: { status: 'success', committed: true, operation_kind: 'task-state-transaction', idempotency_key: 'unchanged-report' },
        recorded_at: '2026-01-01T00:00:00.000Z',
      });
      const repeated = store.listEvents()[1]!;
      expect(Object.keys(repeated.object_refs).some(key => key.startsWith('evidence-report:'))).toBe(false);
      expect(store.deepValidate().status).toBe('valid');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('stores one authoritative proposal/result payload and restores it through precise reads', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const store = TaskStore.forCurrent(root, current as any);
      store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const proposal = {
        schema_version: 1,
        kind: 'test-large-proposal',
        idempotency_key: 'normalized-proposal',
        operation_kind: 'task-state-transaction',
        semantic_delta: {
          kind: 'task-state',
          action: 'step-progress',
          claim_evidence: [{ claim_id: 'large-claim', requirement: 'x'.repeat(12000) }],
          execution_result: { outcome: 'passed', report: 'y'.repeat(12000) },
        },
      };
      const result = { status: 'success', committed: true, operation_kind: 'task-state-transaction', idempotency_key: 'normalized-proposal', message: 'stored once' };
      store.recordCommit({ before: current as any, after: current as any, proposal, result, recorded_at: '2026-01-01T00:00:00.000Z' });
      const event = store.listEvents()[1]!;
      const proposalReference = event.transaction?.proposal as any;
      const resultReference = event.transaction?.result as any;
      expect(proposalReference.object_type).toBe('proposal');
      expect(resultReference.object_type).toBe('result');
      expect(JSON.stringify(event)).not.toContain('large-claim');
      expect(JSON.stringify(event)).not.toContain('x'.repeat(256));
      expect(store.readTransactionPayload(proposalReference, 'proposal')).toEqual(proposal);
      expect(store.readTransactionPayload(resultReference, 'result')).toEqual(result);
      const eventPath = store.lookupIdempotency('normalized-proposal')!.event_path;
      const read = taskRead(root, { kind: 'semantic-delta', event_path: eventPath, max_bytes: 65536 });
      expect(read.complete_for_operation).toBe(true);
      expect((read.value as any).claim_evidence[0].claim_id).toBe('large-claim');
      expect((read.value as any).execution_result.report.length).toBe(12000);
      expect(store.deepValidate().status).toBe('valid');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('keeps an exact old line locator when migration compacts CURRENT_TASK', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const sourceRevision = current.sourceTuple.revision;
      commitTaskStorageMigration(root, current as any, sourceRevision);
      const compact = readCanonicalCurrentTask(root);
      const legacy = TaskStore.forCurrent(root, compact as any).readObject(TaskStore.forCurrent(root, compact as any).manifest!.object_refs.legacy_source);
      expect((legacy.payload as any).line_map.kind).toBe('vnext-current-task-line-map/v1');
      expect((legacy.payload as any).line_map.old_line_count).toBeGreaterThan(0);
      const locator = taskRead(root, { kind: 'history-material', source_revision: sourceRevision, old_line: 1, max_bytes: 4096 });
      expect(locator.complete_for_operation).toBe(true);
      expect((locator.value as any).source_revision).toBe(sourceRevision);
      expect((locator.value as any).old_line).toBe(1);
      expect((locator.value as any).locator).toBe('exact-preimage');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a task-data path that traverses a symbolic link when the host permits creating one', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const taskData = path.join(root, 'docs', 'workflow', 'task-data');
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-task-store-outside-'));
      try {
        try {
          fs.symlinkSync(outside, taskData, 'junction');
        } catch {
          return;
        }
        expect(() => TaskStore.forCurrent(root, current as any)).toThrow('TASK_STORE_PATH_INVALID');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('replays an in-flight marker and reads legacy JSON idempotency indexes', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const store = TaskStore.forCurrent(root, current as any);
      const initial = store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const proposal = { schema_version: 1, kind: 'test-pending-proposal', idempotency_key: 'pending-recovery', operation_kind: 'task-state-transaction' };
      const result = { status: 'success', committed: true, operation_kind: 'task-state-transaction', idempotency_key: 'pending-recovery' };
      fs.writeFileSync(store.paths.pending, JSON.stringify({
        schema_version: 1,
        kind: 'vnext-task-store-pending-commit',
        document_id: current.sourceTuple.document_id,
        sequence: initial.head.event_sequence + 1,
        source_revision: current.sourceTuple.revision,
        resulting_source_revision: current.sourceTuple.revision,
        idempotency_key: 'pending-recovery',
        proposal_digest: digest(proposal),
      }));
      store.recordCommit({ before: current as any, after: current as any, proposal, result, recorded_at: '2026-01-01T00:00:00.000Z' });
      expect(store.lookupIdempotency('pending-recovery')?.event.sequence).toBe(2);

      const legacyIndex = fs.readFileSync(store.paths.idempotencyIndex, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
      fs.writeFileSync(store.paths.legacyIdempotencyIndex, JSON.stringify(legacyIndex, null, 2));
      fs.rmSync(store.paths.idempotencyIndex, { force: true });
      const reopened = TaskStore.forCurrent(root, current as any);
      expect(reopened.lookupIdempotency('pending-recovery')?.event.sequence).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports ambiguous duplicate keys and missing committed objects instead of guessing', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const store = TaskStore.forCurrent(root, current as any);
      const manifest = store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const proposal = { schema_version: 1, kind: 'test-ambiguous-proposal', idempotency_key: 'ambiguous-key', operation_kind: 'task-state-transaction' };
      store.recordCommit({ before: current as any, after: current as any, proposal, result: { status: 'success', committed: true, operation_kind: 'task-state-transaction', idempotency_key: 'ambiguous-key' }, recorded_at: '2026-01-01T00:00:00.000Z' });
      const lines = fs.readFileSync(store.paths.idempotencyIndex, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
      const entry = lines.find(item => item.idempotency_key === 'ambiguous-key');
      if (!entry) throw new Error('test setup did not create an idempotency entry');
      fs.writeFileSync(store.paths.legacyIdempotencyIndex, JSON.stringify([{ ...entry, proposal_digest: 'b'.repeat(64) }]));
      expect(() => TaskStore.forCurrent(root, current as any).lookupIdempotency('ambiguous-key')).toThrow('TASK_STORE_EVENT_CONFLICT');

      const stateFile = path.join(store.paths.objects, `${manifest.object_refs.state.sha256}.json`);
      fs.rmSync(stateFile);
      expect(store.validateCurrentAggregate(current as any).status).toBe('invalid');
      expect(() => taskRead(root, { kind: 'state' })).toThrow('TASK_STORE_OBJECT_MISSING');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not expose valid orphan objects or events as committed facts', () => {
    const root = fixtureRoot();
    try {
      const current = readCanonicalCurrentTask(root);
      const store = TaskStore.forCurrent(root, current as any);
      const manifest = store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const definition = store.readObject(manifest.object_refs.definition);
      const orphanObject = { ...definition, payload: { ...(definition.payload as Record<string, unknown>), orphan_marker: true } };
      const orphanObjectSha = digest(orphanObject);
      fs.writeFileSync(path.join(store.paths.objects, `${orphanObjectSha}.json`), `${stableJson(orphanObject)}\n`);
      expect(() => store.readObject(orphanObjectSha)).toThrow('TASK_STORE_OBJECT_NOT_COMMITTED');

      const committedEvent = store.listEvents()[0]!;
      const orphanUnsigned: Record<string, unknown> = { ...committedEvent, previous_event_hash: 'a'.repeat(64) };
      delete orphanUnsigned.event_hash;
      const orphanEvent = { ...orphanUnsigned, event_hash: sha256(stableJson(orphanUnsigned)) };
      const orphanEventSha = String(orphanEvent.event_hash);
      const orphanEventFile = `${String(committedEvent.sequence).padStart(12, '0')}-${orphanEventSha}.json`;
      fs.writeFileSync(path.join(store.paths.events, orphanEventFile), `${stableJson(orphanEvent)}\n`);
      expect(() => store.readEvent(path.posix.join(store.paths.relativeRoot, 'events', orphanEventFile))).toThrow('TASK_STORE_EVENT_NOT_COMMITTED');
      expect(store.listEvents()).toHaveLength(1);
      expect(store.deepValidate().status).toBe('valid');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
