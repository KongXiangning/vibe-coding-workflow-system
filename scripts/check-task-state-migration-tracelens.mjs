/** Optional cross-consumer acceptance: only synthetic projects and isolated registries are written. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { planMigration, applyMigration, verifyMigration } from '../runtime/vnext/dist/task-state-migration.js';
import { task, archive } from '../runtime/vnext/support/assistance.mjs';
import { storeReadFile } from '../runtime/vnext/support/record-storage.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--tracelens-root')
  throw new Error('Usage: node scripts/check-task-state-migration-tracelens.mjs --tracelens-root <built TraceLens checkout>');
const consumer = fs.realpathSync(args[1]);
const { createApp } = await import(pathToFileURL(path.join(consumer, 'dist/server/app.js')).href);
const support = fileURLToPath(new URL('../runtime/vnext/support/', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-tracelens-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (root, ref, text) => { fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), text); };

function fixture(name, registered) {
  const root = path.join(base, name, 'project');
  fs.mkdirSync(path.join(root, '.workflow-system/records/events'), { recursive: true });
  for (const module of ['assistance', 'task-management', 'task-state', 'task-event-codec', 'record-storage'])
    put(root, `.workflow-system/runtime/support/${module}.mjs`, fs.readFileSync(path.join(support, `${module}.mjs`)));
  const prepared = task(root, { action: 'prepare', idempotency_key: 'fixture', plan: { title: '原文迁移验收', goal: '保留关系及原始依据', steps: [{ id: 'S1', title: '验证当前交付' }] } });
  task(root, { action: 'adopt', task_ref: prepared.task_id, plan_ref: prepared.ref, decision_text: '采用', focus: true });
  const closed = task(root, { action: 'close', task_ref: prepared.task_id, decision_text: '原始现场记录。'.repeat(12_000), remaining_work: ['原有未验证范围'] });
  const source = storeReadFile(root, closed.ref);
  assert(source.length > 65_536, 'the source must exercise multi-page UTF-8 reads');
  const manifest = { schema: 'vnext-product-manifest/v2', project_id: name, maintenance: 'enabled', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/PROJECT.md'],
    source_paths: registered ? ['.workflow-system/records/events/*.json'] : ['docs/product/sources/**'], capture_paths: ['docs/product/sources/**'], exclude_paths: [] };
  put(root, '.workflow-system/PRODUCT.yaml', JSON.stringify(manifest, null, 2) + '\n');
  const metadata = { schema: 'vnext-product-doc/v2', items: [{ type: 'goal', id: 'GOAL-A', scope: 'current', sources: [{ kind: 'file', path: closed.ref, sha256: sha(source) }],
    task_bindings: [{ id: 'B1', task: { task_id: prepared.task_id, plan_ref: prepared.ref, source: { kind: 'file', path: closed.ref, sha256: sha(source) } }, role: 'repair', coverage: '本次明确范围', origin: 'declared', state: 'active' }] }] };
  put(root, 'docs/product/PROJECT.md', `---\n${JSON.stringify(metadata)}\n---\n## [GOAL-A] 明确交付范围\n### 目标说明\n保留原文和关联\n### 范围边界\n本次范围\n`);
  return { root, taskId: prepared.task_id, ref: closed.ref, source, manifest, manifestBytes: fs.readFileSync(path.join(root, '.workflow-system/PRODUCT.yaml')), productBytes: fs.readFileSync(path.join(root, 'docs/product/PROJECT.md')) };
}

async function reader(root, directory, trusted) {
  const { app } = await createApp({ dataDir: directory, port: 4317 });
  const sessionResponse = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:4317' } });
  assert.equal(sessionResponse.statusCode, 200, sessionResponse.body);
  const session = sessionResponse.json();
  async function request(url, body, expectedStatus = 200) {
    const headers = { host: '127.0.0.1:4317' };
    if (body !== undefined) Object.assign(headers, { 'content-type': 'application/json', 'x-tracelens-token': session.token });
    const response = await app.inject({ method: body === undefined ? 'GET' : 'POST', url, headers, ...(body === undefined ? {} : { payload: body }) });
    assert.equal(response.statusCode, expectedStatus, `${url}: ${response.body}`);
    return response.json();
  }
  try {
    const project = await request('/api/projects', { name: '迁移原文验收', root, config: { readingMode: 'vnext', product: { enabled: true, manifestPath: '.workflow-system/PRODUCT.yaml' }, autoDiscover: true,
      rules: { management: [], requirements: [], design: [], planning: [] }, excludes: [] } }, 201);
    const prefix = `/api/projects/${project.id}`;
    if (trusted) {
      const preview = await request('/api/runtime-source-preview', { sourceDirectory: path.join(root, '.workflow-system/runtime/support') });
      await request(`${prefix}/runtime-trust`, { ...preview, workflowHome: 'docs/workflow', accept: true });
    }
    async function refresh() {
      let view = await request(`${prefix}/refresh`, {});
      const deadline = Date.now() + 60_000;
      while (view.snapshot?.phase !== 'complete' || view.attempt?.state === 'scanning') {
        assert(Date.now() < deadline, 'TraceLens did not finish the synthetic snapshot');
        await new Promise(resolve => setTimeout(resolve, 20));
        view = await request(`${prefix}/snapshot`);
      }
      assert.equal(view.snapshot.runtime.source, trusted ? 'runtime-query' : 'file-snapshot');
      return view.snapshot;
    }
    return { app, request, prefix, refresh };
  } catch (error) { await app.close(); throw error; }
}

function checkSnapshot(snapshot, original) {
  assert.equal(snapshot.runtime.queryKind, 'task-query/v2');
  assert.equal(snapshot.runtime.recordsComplete, true);
  assert.equal(snapshot.runtime.tasks.length, 1);
  assert.equal(snapshot.runtime.tasks[0].task_id, original.taskId);
  assert.equal(snapshot.runtime.tasks[0].lifecycle, 'closed');
  assert.equal(snapshot.product.bindings.length, 1);
  assert.equal(snapshot.product.bindings[0].match.state, 'matched');
  assert.equal(snapshot.product.bindings[0].binding.coverage, '本次明确范围');
  const source = snapshot.product.sources.find(source => source.reference.kind === 'file' && source.reference.path === original.ref);
  assert(source && !['outside', 'excluded', 'not-read'].includes(source.readState), JSON.stringify(source));
}

async function openOriginal(client, snapshot, original) {
  const opened = await client.request(`${client.prefix}/task-source`, { snapshotId: snapshot.id, ref: original.ref });
  assert.equal(opened.digest, sha(original.source));
  assert.deepEqual(Buffer.from(opened.raw, 'utf8'), original.source);
  return { mode: snapshot.runtime.source, status: 200, bytes: opened.bytes, sha256: opened.digest };
}

const results = [];
try {
  for (const [name, registered, archived] of [['outside-scope', false, false], ['archived-outside-scope', false, true], ['already-registered', true, false]]) {
    const original = fixture(name, registered);
    if (archived) for (const action of ['create', 'verify', 'quarantine', 'reclaim']) archive(original.root, { action });
    const live = await reader(original.root, path.join(base, name, 'trusted-registry'), true);
    let fallback;
    try {
      const before = await live.refresh();
      assert.equal(before.runtime.queryKind, 'task-query/v1');
      await openOriginal(live, before, original);
      const plan = planMigration(original.root);
      assert.equal(plan.summary.source_registrations, registered ? 0 : 1);
      const migration = await applyMigration(original.root, plan, path.join(base, name, 'legacy.tar.gz'));
      assert.equal(migration.status, 'migrated');
      assert.equal(verifyMigration(original.root, plan).source_readability, 'verified');
      assert.deepEqual(fs.readFileSync(path.join(original.root, 'docs/product/PROJECT.md')), original.productBytes);
      const manifest = parse(fs.readFileSync(path.join(original.root, '.workflow-system/PRODUCT.yaml'), 'utf8'));
      assert.deepEqual(manifest, { ...original.manifest, source_paths: [...original.manifest.source_paths, ...(registered ? [] : [original.ref])] });
      if (registered) assert.deepEqual(fs.readFileSync(path.join(original.root, '.workflow-system/PRODUCT.yaml')), original.manifestBytes);
      const after = await live.refresh(); checkSnapshot(after, original);
      const liveResult = await openOriginal(live, after, original);
      fallback = await reader(original.root, path.join(base, name, 'snapshot-registry'), false);
      const snapshot = await fallback.refresh(); checkSnapshot(snapshot, original);
      const fallbackResult = await openOriginal(fallback, snapshot, original);
      results.push({ name, registrations: plan.summary.source_registrations, readers: [liveResult, fallbackResult] });
    } finally { await live.app.close(); if (fallback) await fallback.app.close(); }
  }
  console.log(JSON.stringify({ status: 'passed', consumer, synthetic_projects: results.length, results, targets_modified: false }, null, 2));
} finally {
  assert(base.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(base, { recursive: true, force: true });
}
