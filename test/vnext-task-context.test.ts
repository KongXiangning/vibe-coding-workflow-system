import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parse, stringify } from 'yaml';
import { spawnSync } from 'node:child_process';
import { ContextBlockCollector } from './task-context-test-utils';
import { taskStoreDefinitionPayload } from '../runtime/vnext/src/task-store';
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
  test('Node CLI delivers partial pages successfully while retaining required continuation and rejecting stale reads', () => {
    const body = fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8')
      + '\n## Large Constraint\n\n' + '不可丢失的约束。'.repeat(2000);
    const root = fixtureRoot(body);
    try {
      const cli = (input: unknown) => spawnSync('node', [path.join(ROOT, 'runtime/vnext/dist/cli.js'), 'task-context', '--root', root], {
        input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 256 * 1024,
      });
      const first = cli({ entry: 'preflight-step', max_bytes: 4096 });
      expect(first.status).toBe(0);
      const page = JSON.parse(first.stdout);
      expect(page.status).toBe('partial');
      expect(page.complete_for_operation).toBe(false);
      expect(page.required_unexpanded.length).toBeGreaterThan(0);
      expect(page.continuation.kind).toBe('task-context-page/v2');
      expect(cli({ continuation: page.continuation }).status).toBe(0);
      fs.appendFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), '\nsource changed\n');
      const stale = cli({ continuation: page.continuation });
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain('TASK_CONTEXT_STALE');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('selects distinct preparation, execution, review and archived handoff context without inheriting authority', () => {
    const template = fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8');
    const body = template.replace('## 执行记录', '- future-step: FUTURE_STEP_ONLY\n  - Purpose: unrelated later work\n  - Mutation scope: docs/workflow/**\n  - Required evidence: exact future result\n  - Review checkpoint: not-required\n\n## 执行记录')
      + '\n## Unknown Safety Constraint\n\nKEEP_THIS_CONSTRAINT\n';
    const root = fixtureRoot(body);
    try {
      const before = currentOf(root).raw;
      const prepare = taskContext(root, { purpose: 'prepare-new', max_bytes: 65536 });
      expect(prepare.selection.required).toEqual(['task-origin', 'preparation-status', 'overview-details']);
      expect(prepare.selection.definition_coverage).toBe('selected');
      const handoff = taskContext(root, { entry: 'prepare-task', max_bytes: 65536 });
      expect(handoff.selection.purpose).toBe('archive-handoff');
      expect(handoff.selection.required).toContain('unfinished-obligations');
      expect(handoff.selection.required).toContain('unresolved-findings');
      expect(handoff.selection.required).not.toContain('mutation-authority');
      expect(handoff.overview.inherits_authority).toBe(false);
      const execute = taskContext(root, { entry: 'preflight-step', max_bytes: 65536 });
      expect(execute.selection.purpose).toBe('execute');
      expect(execute.selection.required).toContain('mutation-authority');
      expect(JSON.stringify(execute)).toContain('KEEP_THIS_CONSTRAINT');
      expect(JSON.stringify(execute)).not.toContain('FUTURE_STEP_ONLY');
      const review = taskContext(root, { entry: 'review-context', mode: 'review', max_bytes: 65536 });
      expect(review.selection.purpose).toBe('review');
      expect(review.selection.required).toContain('cumulative-review-target');
      expect(review.selection.required).toContain('review-evidence');
      expect(JSON.stringify(review)).toContain('FUTURE_STEP_ONLY');
      expect(taskContext(root, { entry: 'prepare-task', mode: 'prepare-replan' }).selection.purpose).toBe('full');
      expect(taskContext(root, { purpose: 'full' }).selection.definition_coverage).toBe('full');
      expect(currentOf(root).raw).toBe(before);
      expect(fs.existsSync(path.join(root, 'docs/workflow/task-data'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('successor preparation retains full predecessor context on a superseded task', () => {
    const template = fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8');
    const parts = template.split(/^---\s*$/m);
    const frontmatter = parse(parts[1]!);
    frontmatter.runtime_state.workflow_status = 'superseded';
    frontmatter.runtime_state.lifecycle_state = 'active';
    const body = parts.slice(2).join('---')
      .replace('- 当前状态：closed', '- 当前状态：superseded')
      .replace('- 生命周期状态：archived', '- 生命周期状态：active');
    const root = fixtureRoot(`---\n${stringify(frontmatter)}---\n${body}`);
    try {
      const before = currentOf(root).raw;
      const expected = taskContext(root, { purpose: 'full', max_bytes: 65536 });
      for (const mode of ['default', 'draft', 'prepare-draft']) {
        const page = taskContext(root, { entry: 'prepare-successor', mode, max_bytes: 65536 });
        expect(page.selection.purpose).toBe('full');
        expect(page.selection.definition_coverage).toBe('full');
        expect(page.selection.required).toContain('current-definition');
        expect(page.selection.required).toContain('unfinished-obligations');
        expect(page.selection.required).toContain('required-dependencies');
        expect(page.selection.required).toContain('global-gates');
        expect(page.blocks).toEqual(expected.blocks);
        expect(page.complete_for_operation).toBe(true);
      }
      expect(currentOf(root).raw).toBe(before);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('carries a bound selection across pages and rejects selection swaps, v1 cursors and invalid offsets', () => {
    const body = fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8')
      + '\n## Retained Constraint\n\n' + '上下文。'.repeat(4000);
    const root = fixtureRoot(body);
    try {
      const first = taskContext(root, { entry: 'review-context', mode: 'review', max_bytes: 4096 });
      expect(first.continuation).not.toBeNull();
      const next = taskContext(root, { continuation: first.continuation, max_bytes: 65536 });
      expect(next.selection).toEqual(first.selection);
      expect(next.receipt.selection.purpose).toBe('review');
      for (const change of [{ entry: 'preflight-step' }, { mode: 'default' }, { purpose: 'full' }, { step_id: 'bootstrap-baseline' }, { definition_visible: true, visible_definition_revision: first.aggregate.definition_revision }]) {
        expect(() => taskContext(root, { continuation: first.continuation, ...change })).toThrow('TASK_CONTEXT_STALE');
      }
      expect(() => taskContext(root, { continuation: { ...first.continuation!, kind: 'task-context-page/v1' } })).toThrow('TASK_CONTEXT_CONTINUATION_INVALID');
      expect(() => taskContext(root, { continuation: { ...first.continuation!, record_index: 999999 } })).toThrow('TASK_CONTEXT_CONTINUATION_INVALID');
      expect(() => taskContext(root, { continuation: { ...first.continuation!, byte_offset: 999999 } })).toThrow('TASK_CONTEXT_CONTINUATION_INVALID');
      expect(() => taskContext(root, { purpose: 'typo' })).toThrow('TASK_CONTEXT_INPUT_INVALID');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('pages many individually readable sections as complete records with exact coverage at changing budgets', () => {
    const template = fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8');
    const body = template + Array.from({ length: 40 }, (_, i) => `\n## Constraint ${i}\n\n${'完整记录。'.repeat(22)}\n`).join('');
    const root = fixtureRoot(body);
    try {
      const collector = new ContextBlockCollector();
      let continuation: unknown;
      let pages = 0;
      let final: ReturnType<typeof taskContext>;
      do {
        const budget = pages % 2 ? 16384 : 4096;
        final = taskContext(root, { max_bytes: budget, ...(continuation ? { continuation } : {}) });
        expect(Buffer.byteLength(JSON.stringify(final))).toBeLessThanOrEqual(budget);
        expect(final.blocks.every(block => block.text === undefined)).toBe(true);
        collector.add(final.blocks);
        continuation = final.continuation;
        expect(++pages).toBeLessThan(100);
      } while (continuation);
      expect(pages).toBeGreaterThan(1);
      expect(final.complete_for_operation).toBe(true);
      expect(collector.values.get('current-definition')).toEqual({ revision: final.aggregate.definition_revision, ...taskStoreDefinitionPayload(currentOf(root) as any) });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test.each(['active', 'archived'])('keeps historical dynamic review facts without terminal execution advice (%s)', (lifecycle) => {
    const template = fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8');
    const parts = template.split(/^---\s*$/m);
    const frontmatter = parse(parts[1]!);
    const state = frontmatter.runtime_state;
    state.workflow_status = lifecycle === 'active' ? 'active' : 'closed';
    state.lifecycle_state = lifecycle;
    state.active_step_status = 'in-progress';
    state.dynamic_review_required = true;
    state.dynamic_expansions = [{
      path: 'docs/workflow/discovered.md', domain: null,
      assessment: {
        target: { path: 'docs/workflow/discovered.md' }, reason: 'Retained discovery awaiting review',
        blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
        evidence_refs: ['test:retained-discovery'], disposition: 'self-admit',
      },
      first_touch_state: 'file', admitted_at: '2026-09-28T00:00:00.000Z',
    }];
    const body = parts.slice(2).join('---')
      .replace('- 当前状态：closed', `- 当前状态：${state.workflow_status}`)
      .replace('- 生命周期状态：archived', `- 生命周期状态：${state.lifecycle_state}`);
    const root = fixtureRoot(`---\n${stringify(frontmatter)}---\n${body}`);
    try {
      const before = currentOf(root);
      const preparation = taskContext(root, { entry: 'prepare-task', max_bytes: 65536 });
      expect(preparation.selection.purpose).toBe(lifecycle === 'archived' ? 'archive-handoff' : 'prepare-new');
      if (lifecycle === 'active') expect((preparation.blocks.find(block => block.id === 'preparation-status')!.value as any).handoff_read).toBeNull();
      const collector = new ContextBlockCollector();
      const values = collector.values;
      let continuation: unknown;
      let pages = 0;
      do {
        const page = taskContext(root, { max_bytes: 4096, ...(continuation ? { continuation } : {}) });
        if (lifecycle === 'archived') {
          expect(page.overview.next_entry).toBeNull();
          expect(page.overview.next_options).toEqual([]);
        }
        collector.add(page.blocks);
        continuation = page.continuation;
        if (!continuation) expect(page.complete_for_operation).toBe(true);
        expect(++pages).toBeLessThan(100);
      } while (continuation);
      const gates = values.get('global-gates');
      const details = values.get('overview-details');
      expect(gates.dynamic_review_required).toBe(true);
      expect(gates.dynamic_expansions).toEqual(state.dynamic_expansions);
      if (lifecycle === 'archived') {
        expect(gates.policy_gates).toEqual([]);
        expect(gates.ordinary_attempt_admission).toBeNull();
        expect(details.gates.blocked_repair_continuation).toBeNull();
        expect(details.repair_execution_recovery).toBeNull();
      } else {
        expect(gates.policy_gates).toContainEqual(expect.objectContaining({
          code: 'DYNAMIC_REVIEW_REQUIRED', command: 'record-user-decision', effect: 'continue-after-warning',
        }));
        expect(gates.ordinary_attempt_admission.creates_attempt).toBe(true);
      }
      expect(currentOf(root).runtimeState).toEqual(before.runtimeState);
      expect(fs.readFileSync(before.filePath, 'utf8')).toBe(before.raw);
      expect(fs.existsSync(path.join(root, 'docs/workflow/task-data'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([4096, 16384, 65536])('bounds the overview and losslessly pages large expansion history at %i bytes', (maxBytes) => {
    const template = fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8');
    const parts = template.split(/^---\s*$/m);
    const frontmatter = parse(parts[1]!);
    const expansions = Array.from({ length: 70 }, (_, index) => ({
      path: `docs/workflow/extension-${index}.md`, domain: null,
      assessment: {
        target: { path: `docs/workflow/extension-${index}.md` },
        reason: '保留完整扩展依据。'.repeat(60),
        blast_radius: { locality: 'local', visibility: 'private', cross_component_consumers: 'none', contract_impact: 'none' },
        evidence_refs: ['test:expansion-history'], disposition: 'self-admit',
      },
      first_touch_state: 'file', admitted_at: '2026-09-28T00:00:00.000Z',
    }));
    frontmatter.runtime_state.dynamic_expansions = expansions;
    // A long title exercises summary overflow independently of expansion arrays.
    const title = '上下文标题'.repeat(1000);
    const body = parts.slice(2).join('---').replace('Bootstrap baseline (non-executable)', title);
    const root = fixtureRoot(`---\n${stringify(frontmatter)}---\n${body}`);
    try {
      const before = fs.readFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), 'utf8');
      const collector = new ContextBlockCollector();
      const values = collector.values;
      let continuation: unknown;
      let pageCount = 0;
      do {
        const page = taskContext(root, { max_bytes: maxBytes, ...(continuation ? { continuation } : {}) });
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(maxBytes);
        expect(Buffer.byteLength(JSON.stringify(page.overview))).toBeLessThanOrEqual(Math.min(4096, maxBytes / 4));
        expect(page.overview.next_entry).toBeNull();
        expect(page.overview.next_options).toEqual([]);
        collector.add(page.blocks);
        continuation = page.continuation;
        if (!continuation) expect(page.complete_for_operation).toBe(true);
        expect(++pageCount).toBeLessThan(500);
      } while (continuation);
      expect((values.get('global-gates') as any).dynamic_expansions).toEqual(expansions);
      const details = values.get('overview-details') as any;
      expect(details.identity.title).toBe(title);
      expect(details.dynamic_mutation).toMatchObject({ expansion_count: 70, expansions_block: { reference: 'global-gates' } });
      expect(details.dynamic_mutation.expansions).toBeUndefined();
      expect(fs.readFileSync(path.join(root, 'docs/workflow/CURRENT_TASK.md'), 'utf8')).toBe(before);
      expect(fs.existsSync(path.join(root, 'docs/workflow/task-data'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test('keeps the default projection stable when unrelated persistent history grows', { timeout: 20_000 }, () => {
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
      expect(first.blocks.some(block => block.id === 'task-constraints')).toBe(true);
      expect(reused.blocks.some(block => block.id === 'task-constraints')).toBe(false);
      expect(reused.selection.definition_reused).toBe(true);
      expect(reused.receipt.definition_revision).toBe(first.aggregate.definition_revision);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([false, true])('paginates Unicode context without overlap or omission (increase budget: %s)', (increaseBudget) => {
    const body = `${fs.readFileSync(path.join(ROOT, 'templates', 'vnext', 'bootstrap', 'CURRENT_TASK.md'), 'utf8')}\n## Long Constraint\n\n${'中文约束内容。'.repeat(1000)}\n`;
    const root = fixtureRoot(body);
    try {
      let continuation: unknown;
      let pages = 0;
      const collector = new ContextBlockCollector();
      let final: ReturnType<typeof taskContext> | undefined;
      do {
        const page = taskContext(root, { max_bytes: increaseBudget && pages > 0 ? 64 * 1024 : 16 * 1024, ...(continuation === undefined ? {} : { continuation }) });
        pages += 1;
        collector.add(page.blocks);
        final = page;
        continuation = page.continuation;
      } while (continuation !== null);
      expect(pages).toBeGreaterThan(1);
      expect(final?.complete_for_operation).toBe(true);
      expect(collector.values.get('current-definition')).toEqual({ revision: final!.aggregate.definition_revision, ...taskStoreDefinitionPayload(currentOf(root) as any) });
      if (!increaseBudget) expect(collector.chunks.size).toBeGreaterThan(0);
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
      expect(committed.manifest.current_representation).toBe('compact-v3');
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
