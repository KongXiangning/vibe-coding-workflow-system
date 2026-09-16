import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { readCanonicalCurrentTask } from '../runtime/vnext/src/kernel';
import {
  taskContext,
  taskContextMigrationCommit,
  taskContextMigrationPreview,
  taskRead,
  taskStoreExportPage,
  taskStoreCurrentValidation,
  taskStoreValidation,
} from '../runtime/vnext/src/task-context';
import { TaskStore } from '../runtime/vnext/src/task-store';
import { taskHistoryLocation } from '../runtime/vnext/src/task-evolution-io';

const ROOT = path.resolve(import.meta.dir, '..');

function fixtureRoot(body?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-task-context-'));
  fs.mkdirSync(path.join(root, '.workflow-system'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'workflow'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.workflow-system', 'PROJECT_PROFILE.yaml'), path.join(root, '.workflow-system', 'PROJECT_PROFILE.yaml'));
  fs.writeFileSync(path.join(root, 'docs', 'workflow', 'CURRENT_TASK.md'), body ?? fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8'));
  return root;
}

function currentOf(root: string) {
  return readCanonicalCurrentTask(root);
}

function withoutHistoryNavigation(value: ReturnType<typeof taskContext>): unknown {
  const copy = structuredClone(value) as any;
  delete copy.overview.storage;
  copy.blocks = copy.blocks.filter((block: any) => block.id !== 'history-navigation');
  delete copy.returned;
  delete copy.receipt;
  return copy;
}

describe('vNext task context projection', () => {
  test('keeps the default projection stable when unrelated persistent history grows', () => {
    const root = fixtureRoot();
    try {
      const before = taskContext(root, { entry: 'preflight-step' });
      const current = currentOf(root);
      const store = TaskStore.forCurrent(root, current as any);
      store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      for (let index = 0; index < 260; index += 1) {
        const key = `unrelated-history-${index}`;
        store.recordCommit({
          before: current as any,
          after: current as any,
          proposal: { schema_version: 1, kind: 'test-history-proposal', idempotency_key: key, operation_kind: 'task-state-transaction', semantic_delta: { kind: 'test-history', index } },
          result: { status: 'success', committed: true, operation_kind: 'task-state-transaction', idempotency_key: key, message: 'synthetic unrelated history' },
          recorded_at: '2026-01-01T00:00:00.000Z',
        });
      }
      const after = taskContext(root, { entry: 'preflight-step' });
      expect(after.complete_for_operation).toBe(true);
      expect(withoutHistoryNavigation(after)).toEqual(withoutHistoryNavigation(before));
      expect((after.overview.storage as any).event_count).toBe(261);
      expect((after.overview.storage as any).last_event_sequence).toBe(261);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60000);

  test('reuses a visible definition only for the exact definition revision', () => {
    const root = fixtureRoot();
    try {
      const first = taskContext(root, { entry: 'review-change' });
      const reused = taskContext(root, {
        entry: 'review-change',
        definition_visible: true,
        visible_definition_revision: first.aggregate.definition_revision,
      });
      expect(first.blocks.some(block => block.id === 'current-definition')).toBe(true);
      expect(reused.blocks.some(block => block.id === 'current-definition')).toBe(false);
      expect(reused.selection.definition_reused).toBe(true);
      expect(reused.receipt.definition_revision).toBe(first.aggregate.definition_revision);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('paginates required Unicode context without overlap or silent omission', () => {
    const body = `${fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8')}\n## Long Constraint\n\n${'中文约束内容。'.repeat(1000)}\n`;
    const root = fixtureRoot(body);
    try {
      let continuation: unknown;
      let pages = 0;
      const offsets = new Set<string>();
      const chunks = new Map<string, number>();
      let final: ReturnType<typeof taskContext> | undefined;
      let totalBytes: number | undefined;
      do {
        const page = taskContext(root, { max_bytes: 16 * 1024, ...(continuation === undefined ? {} : { continuation }) });
        pages += 1;
        for (const block of page.blocks) {
          if (block.text === undefined) continue;
          const key = `${block.id}:${block.byte_offset}`;
          expect(offsets.has(key)).toBe(false);
          offsets.add(key);
          chunks.set(block.id, (chunks.get(block.id) ?? 0) + Buffer.byteLength(block.text, 'utf8'));
          totalBytes ??= block.total_bytes;
          expect(block.total_bytes).toBeGreaterThanOrEqual(Buffer.byteLength(block.text, 'utf8'));
        }
        final = page;
        continuation = page.continuation;
      } while (continuation !== null);
      expect(pages).toBeGreaterThan(1);
      expect(final?.complete_for_operation).toBe(true);
      expect(chunks.get('current-definition')).toBe(totalBytes);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('migration preview is read-only and commit exposes current/full-history validation scopes', () => {
    const root = fixtureRoot();
    try {
      const current = currentOf(root);
      const currentBytes = fs.readFileSync(current.filePath, 'utf8');
      const preview = taskContextMigrationPreview(root);
      expect(preview.status).toBe('preview');
      expect(fs.existsSync(path.join(root, 'docs', 'workflow', 'task-data'))).toBe(false);
      const committed = taskContextMigrationCommit(root, current.sourceTuple.revision);
      expect(committed.status).toBe('committed');
      const compactBytes = fs.readFileSync(current.filePath, 'utf8');
      expect(compactBytes).not.toBe(currentBytes);
      expect(compactBytes).not.toMatch(/^  execution_log:/m);
      expect(compactBytes).not.toMatch(/^  applied_proposals:/m);
      expect(committed.manifest.current_representation).toBe('compact-v2');
      expect(readCanonicalCurrentTask(root).runtimeState).toEqual(current.runtimeState);
      expect(taskStoreCurrentValidation(root).status).toBe('valid');
      expect(taskStoreValidation(root).status).toBe('valid');
      const material = taskRead(root, { kind: 'history-material', source_revision: current.sourceTuple.revision });
      expect(material.complete_for_operation).toBe(true);
      expect(material.text).toBe(currentBytes);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('imports exact historical packages into the task store and pages explicit exports', () => {
    const root = fixtureRoot();
    try {
      const current = currentOf(root);
      const oldRaw = `${current.raw}\nlegacy preimage\n`;
      const history = taskHistoryLocation({
        currentPath: current.filePath,
        previousContent: oldRaw,
        nextContent: current.raw,
        documentId: current.sourceTuple.document_id,
        taskId: current.runtimeState.task_id,
        operation: 'supersede',
      });
      fs.mkdirSync(path.dirname(history.path), { recursive: true });
      fs.writeFileSync(history.path, history.content);
      const store = TaskStore.forCurrent(root, current as any);
      store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      fs.rmSync(history.path);
      const restored = taskRead(root, { kind: 'history-material', source_revision: history.relativePath.split('/').at(-1)!.slice(0, -5), max_bytes: 4096 });
      expect(restored.complete_for_operation).toBe(true);
      expect(restored.text).toBe(oldRaw);

      let cursor: unknown;
      let combined = '';
      let pageCount = 0;
      let measureBefore = store.measure();
      do {
        const page = taskStoreExportPage(root, { max_bytes: 4096, ...(cursor === undefined ? {} : { continuation: cursor }) });
        combined += page.text;
        cursor = page.continuation;
        pageCount += 1;
        expect(page.returned_bytes).toBe(Buffer.byteLength(page.text, 'utf8'));
      } while (cursor !== null);
      expect(pageCount).toBeGreaterThan(1);
      const parsed = JSON.parse(combined) as any;
      expect(parsed.manifest.document_id).toBe(current.sourceTuple.document_id);
      expect(parsed.events.length).toBe(1);
      expect(store.measure()).toEqual(measureBefore);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a stale context continuation after the current source changes', () => {
    const root = fixtureRoot();
    try {
      const first = taskContext(root, { max_bytes: 4096 });
      expect(first.continuation).not.toBeNull();
      const current = currentOf(root);
      fs.appendFileSync(current.filePath, '\n');
      expect(() => taskContext(root, { continuation: first.continuation })).toThrow('TASK_CONTEXT_STALE');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('binds task-read and task-export continuations to source, definition, and state revisions', () => {
    const body = `${fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8')}\n## Long Constraint\n\n${'中文约束内容。'.repeat(1000)}\n`;
    const root = fixtureRoot(body);
    try {
      const current = currentOf(root);
      const store = TaskStore.forCurrent(root, current as any);
      store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const read = taskRead(root, { kind: 'definition', max_bytes: 4096 });
      expect(read.continuation).not.toBeNull();
      expect(read.continuation).toMatchObject({
        kind: 'task-read-page/v1',
        source_revision: read.aggregate.source_revision,
        definition_revision: read.aggregate.definition_revision,
        state_revision: read.aggregate.state_revision,
      });
      fs.appendFileSync(current.filePath, '\n');
      expect(() => taskRead(root, { kind: 'definition', continuation: read.continuation })).toThrow('TASK_READ_STALE');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    const exportRoot = fixtureRoot(body);
    try {
      const current = currentOf(exportRoot);
      const store = TaskStore.forCurrent(exportRoot, current as any);
      store.ensureInitialized(current as any, '2026-01-01T00:00:00.000Z');
      const page = taskStoreExportPage(exportRoot, { max_bytes: 4096 });
      expect(page.continuation).not.toBeNull();
      expect(page.continuation).toMatchObject({
        kind: 'task-export-page/v1',
        source_revision: page.aggregate.source_revision,
        definition_revision: page.aggregate.definition_revision,
        state_revision: page.aggregate.state_revision,
      });
      fs.appendFileSync(current.filePath, '\n');
      expect(() => taskStoreExportPage(exportRoot, { continuation: page.continuation })).toThrow('TASK_EXPORT_STALE');
    } finally {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }
  });
});
