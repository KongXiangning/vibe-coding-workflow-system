import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { parseProduct, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { assessmentCopyDiagnostics } from '../runtime/vnext/src/product-maintenance/plans';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('product-reconcile-')) throw new Error('Unexpected fixture root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function put(root: string, file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}
function assistance(root: string, command: 'task' | 'task-status', input: Record<string, unknown>): any {
  return JSON.parse(execFileSync('node', [path.resolve(import.meta.dir, '../runtime/vnext/support/assistance.mjs'), command, '--root', root],
    { input: JSON.stringify(input), encoding: 'utf8' }));
}
function fixture(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'product-reconcile-'));
  roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'reconciliation',
    entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/product/*.md', 'docs/evidence/**'],
    capture_paths: ['docs/evidence/history/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([{ metadata: { id: 'PROJECT', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [] } },
    body: '## [PROJECT] 合成项目\n### 项目定位\n局部对账。\n### 盘点范围与未核对项\n仅夹具。\n' }]));
  return root;
}
function requirement(id: string, extras: Record<string, any> = {}) {
  return { metadata: { id, type: 'requirement', scope: 'current', ...extras },
    body: `## [${id}] ${id}\n### 需求内容\n批量导入保存每项终态，保留失败。\n### 范围边界\nMD目录。\n### 验收要求\n单项失败不丢报告。\n` };
}
function binding(id: string, taskId: string | null, state = 'active') {
  return { id, task: { task_id: taskId, source: { kind: 'text', text: '实际历史工作', label: '历史' } },
    role: 'implementation', coverage: '目录导入', origin: 'declared', state, reason: '实际覆盖' };
}
function assessment(id: string, target = 'REQ-JUDICIAL', text = '逐项证据及验收：空MD目录反例尚未修复。') {
  return { metadata: { id, type: 'assessment', target, target_basis: { kind: 'file', path: 'docs/product/REQUIREMENTS.md', item_id: target },
    target_definition_sha256: null, checked_at: '2026-10-15T00:00:00Z', subject: { kind: 'unknown', value: null }, implementation: 'unknown', verification: 'unknown' },
    body: `## [${id}] 详细评估\n### 覆盖范围\nMD逐项终态。\n### 交付与验证依据\n${text}\n### 剩余与待核对\n保留真实失败和历史范围。\n` };
}

for (const declared of [false, true]) {
  test(`closed task and legacy progress append cannot supply a ${declared ? 'missing assessment' : 'missing goal scope'}`, () => {
    const root = fixture();
    put(root, 'docs/product/REQUIREMENTS.md', newDocument([requirement('REQ-INGEST')], '需求', 3));
    put(root, 'docs/product/GOALS.md', newDocument([{ metadata: { id: 'GOAL', type: 'goal', scope: 'current',
      assessment_scopes: declared ? [{ target: 'REQ-INGEST', scope_id: 'BATCH', coverage: 'MD逐项终态。' }] : [] },
      body: '## [GOAL] 可恢复导入\n### 目标说明\n批量恢复。\n### 范围边界\nMD目录。\n' }], '目标', 3));
    const legacy = assessment('AS-LEGACY', 'REQ-INGEST', '原版本的局部验证。');
    legacy.metadata.implementation = 'partial-reported';
    legacy.metadata.verification = 'pass-reported';
    const original = newDocument([legacy]);
    put(root, 'docs/product/PROGRESS.md', original);

    const prepared = assistance(root, 'task', { action: 'prepare', plan: { title: '批量导入切片', steps: [{ id: 'S1', title: '逐项终态' }] } });
    assistance(root, 'task', { action: 'adopt', task_id: prepared.task_id, plan_ref: prepared.ref, decision_text: '采用切片计划' });
    assistance(root, 'task', { action: 'execution', result: '已实施；本夹具不执行业务命令', source_revision: 'fixture-source' });
    assistance(root, 'task', { action: 'step', state: 'finished' });
    const closed = assistance(root, 'task', { action: 'close', task_id: prepared.task_id, decision_text: '关闭切片，保留产品范围与证据限制' });
    expect(closed.recorded).toBe(true);
    expect(closed.task.lifecycle).toBe('closed');
    const closeBytes = fs.readFileSync(path.join(root, closed.ref));
    const events = fs.readdirSync(path.join(root, '.workflow-system/records/events')).sort();
    const query = { target: 'REQ-INGEST', goal_id: 'GOAL', ...(declared ? { scope_id: 'BATCH' } : {}),
      subject: { kind: 'working-copy', value: root, revision: 'fixture-source' } };
    const reason = declared ? 'no-applicable-report' : 'scope-unavailable';
    expect(run('read', root, { assessment_query: query }).assessment_selection.reasons).toContain(reason);

    const saved = run('apply', root, { files: [{ path: 'docs/product/PROGRESS.md', expected_sha256: sha256(original),
      updates: [{ id: 'AS-LEGACY', body: `${legacy.body}\n本次切片已关闭；当前范围交付对账见收口记录。\n` }] }] });
    expect(saved.status).toBe('saved');
    const pending = { task_id: prepared.task_id, close_ref: closed.ref,
      requirement: 'docs/product/REQUIREMENTS.md#REQ-INGEST', functional_points: ['单项失败终态验收'],
      goal: 'docs/product/GOALS.md#GOAL', scope_id: declared ? 'BATCH' : null,
      subject: query.subject, evidence_refs: [closed.ref], reason,
      next_action: declared ? '按当前声明和可用依据保存独立范围评价并回读' : '明确目标范围后保存独立评价并回读' };
    const closureReport = `# 收口\n任务已关闭；该范围交付对账待处理。\n\n${JSON.stringify(pending, null, 2)}\n`;
    put(root, 'docs/evidence/closure.md', closureReport);
    expect(fs.readFileSync(path.join(root, 'docs/evidence/closure.md'), 'utf8')).toBe(closureReport);

    const selection = run('read', root, { assessment_query: query }).assessment_selection;
    expect(selection.conclusion).toBe('undetermined');
    expect(selection.reasons).toContain(reason);
    const stored = parseProduct(fs.readFileSync(path.join(root, 'docs/product/PROGRESS.md'), 'utf8'), 'docs/product/PROGRESS.md').items[0]!;
    expect(stored.metadata).toEqual(legacy.metadata);
    const status = assistance(root, 'task-status', { detail: 'task', task_ref: prepared.task_id });
    expect(status.current_task_id).toBeNull();
    expect(status.task.lifecycle).toBe('closed');
    expect(status.task.tests).toHaveLength(0);
    expect(fs.readFileSync(path.join(root, closed.ref))).toEqual(closeBytes);
    expect(fs.readdirSync(path.join(root, '.workflow-system/records/events')).sort()).toEqual(events);
  });
}

test('local reads discover an unlinked batch obligation by actual active Task, without expanding shared goals or unknown identities', () => {
  const root = fixture();
  const sharedGoal = [{ id: 'SUPPORT', relation: 'supports', target: 'GOAL', origin: 'declared', state: 'active' }];
  put(root, 'docs/product/REQUIREMENTS.md', newDocument([
    requirement('REQ-JUDICIAL', { links: sharedGoal, task_bindings: [binding('J', 'actual-import')] }),
    requirement('REQ-INGEST', { task_bindings: [binding('I', 'actual-import')] }),
    requirement('REQ-OTHER', { links: sharedGoal }),
    requirement('REQ-DISMISSED', { task_bindings: [binding('D', 'actual-import', 'dismissed')] }),
    requirement('REQ-UNKNOWN', { task_bindings: [binding('U', null)] }),
  ]));
  const before = fs.readFileSync(path.join(root, 'docs/product/REQUIREMENTS.md'));
  const read = run('read', root, { item_ids: ['REQ-JUDICIAL'] });
  expect(read.impact.candidates.map((i: any) => i.id)).toContain('REQ-INGEST');
  expect(read.impact.candidates.map((i: any) => i.id)).not.toContain('REQ-OTHER');
  expect(read.impact.candidates.map((i: any) => i.id)).not.toContain('REQ-DISMISSED');
  expect(read.impact.candidates.map((i: any) => i.id)).not.toContain('REQ-UNKNOWN');
  const candidate = read.impact.candidates.find((i: any) => i.id === 'REQ-INGEST');
  expect(candidate.reasons).toContainEqual({ kind: 'shared-task', seed_id: 'REQ-JUDICIAL', task_id: 'actual-import', seed_binding_id: 'J', binding_id: 'I' });
  expect(candidate.locator.item_id).toBe('REQ-INGEST');
  expect(fs.readFileSync(path.join(root, 'docs/product/REQUIREMENTS.md'))).toEqual(before);
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('assessment seeds discover shared code/scoped references across hashes and retain restricted-read coverage', () => {
  const root = fixture();
  const source = { kind: 'file', path: 'docs/evidence/import.ts', sha256: 'a'.repeat(64) };
  const overview = { kind: 'file', path: 'docs/evidence/overview.md' };
  const scoped = { kind: 'file', path: 'docs/evidence/implementation.md', lines: { start: 1, end: 2 } };
  put(root, 'docs/product/REQUIREMENTS.md', newDocument([
    requirement('REQ-JUDICIAL', { sources: [source, overview, scoped] }),
    requirement('REQ-INGEST', { sources: [{ ...source, sha256: 'b'.repeat(64) }, { ...scoped, lines: { end: 2, start: 1 } }] }),
    requirement('REQ-OTHER', { sources: [overview] }),
  ]));
  put(root, 'docs/product/REPORT.md', newDocument([assessment('AS-JUDICIAL')]));
  const impact = run('read', root, { item_ids: ['AS-JUDICIAL'] }).impact;
  expect(impact.candidates.find((i: any) => i.id === 'REQ-INGEST').reasons[0].kind).toBe('shared-source');
  expect(impact.candidates.find((i: any) => i.id === 'REQ-INGEST').reasons.filter((r: any) => r.kind === 'shared-source')).toHaveLength(2);
  expect(impact.candidates.some((i: any) => i.id === 'REQ-OTHER')).toBe(false);
  expect(run('read', root, { item_ids: ['AS-JUDICIAL'], impact_ids: [] }).impact.candidates).toEqual([]);
  const restricted = run('read', root, { paths: ['docs/product/REPORT.md'], impact_ids: ['REQ-JUDICIAL'] }).impact;
  expect(restricted.unresolved_seeds).toEqual(['REQ-JUDICIAL']);
  expect(restricted.coverage.paths).toEqual(['docs/product/REPORT.md']);
  expect(run('read', root, { paths: ['docs/product/REPORT.md'], item_ids: ['REQ-JUDICIAL'] }).impact.unresolved_seeds).toEqual(['REQ-JUDICIAL']);
});

test('new exact counterevidence is persisted as pending on the related scope without rewriting its earlier PASS or rerunning work', () => {
  const root = fixture();
  put(root, 'docs/product/REQUIREMENTS.md', newDocument([requirement('REQ-INGEST')], '定义', 3));
  put(root, 'docs/product/GOALS.md', newDocument([{ metadata: { id: 'GOAL', type: 'goal', scope: 'current',
    assessment_scopes: [{ target: 'REQ-INGEST', scope_id: 'BATCH', coverage: 'MD逐项终态。' }] },
    body: '## [GOAL] 可恢复导入\n### 目标说明\n批量恢复。\n### 范围边界\nMD目录。\n' }], '目标', 3));
  put(root, 'docs/evidence/old-run.txt', '原版本隔离输入PASS');
  put(root, 'docs/evidence/empty-md.json', '{"status":"rejected-before-summary","error_report_exists":false}');
  const definitions = run('read', root).usable_items;
  const metadata = { ...assessment('AS-BATCH', 'REQ-INGEST').metadata, subject: { kind: 'commit', value: 'fixture-commit' },
    implementation: 'delivered-reported', verification: 'pass-reported', conclusion: 'satisfied', target_definition_algorithm: 'vnext-product-definition/v1',
    target_definition_sha256: definitions.find((i: any) => i.id === 'REQ-INGEST').definition_sha256,
    goal_basis: { kind: 'file', path: 'docs/product/GOALS.md', item_id: 'GOAL' }, goal_definition_algorithm: 'vnext-product-definition/v1',
    goal_definition_sha256: definitions.find((i: any) => i.id === 'GOAL').definition_sha256,
    applicability: { goal_id: 'GOAL', scope_id: 'BATCH', coverage: 'MD逐项终态。' }, sources: [{ kind: 'file', path: 'docs/evidence/old-run.txt' }] };
  const original = newDocument([{ metadata, body: assessment('AS-BATCH', 'REQ-INGEST', '原版本PASS；新输入适用性待核对。').body }], '原报告', 3);
  put(root, 'docs/product/BATCH.md', original);
  const query = { target: 'REQ-INGEST', goal_id: 'GOAL', scope_id: 'BATCH', subject: metadata.subject };
  expect(run('read', root, { assessment_query: query }).assessment_selection.conclusion).toBe('satisfied');
  const source = { kind: 'file', path: 'docs/evidence/empty-md.json', sha256: sha256(fs.readFileSync(path.join(root, 'docs/evidence/empty-md.json'))) };
  const saved = run('apply', root, { files: [{ path: 'docs/product/BATCH.md', expected_sha256: sha256(original), updates: [{ id: 'AS-BATCH', metadata: { pending_sources: [source] } }] }] });
  expect(saved.status).toBe('saved');
  const stored = parseProduct(fs.readFileSync(path.join(root, 'docs/product/BATCH.md'), 'utf8'), 'docs/product/BATCH.md').items[0]!;
  expect(stored.metadata.verification).toBe('pass-reported');
  expect(stored.metadata.conclusion).toBe('satisfied');
  expect(stored.metadata.checked_at).toBe(metadata.checked_at);
  expect(stored.body).toBe(parseProduct(original, 'docs/product/BATCH.md').items[0]!.body);
  expect(stored.metadata.pending_sources).toEqual([source]);
  const current = run('read', root, { assessment_query: query }).assessment_selection;
  expect(current.conclusion).toBe('undetermined');
  expect(current.reasons).toContain('pending-evidence');
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('copy warnings surface before/after save while linked summaries and distinct report bodies remain usable', () => {
  const root = fixture();
  put(root, 'docs/product/REQUIREMENTS.md', newDocument([requirement('REQ-JUDICIAL')]));
  put(root, 'docs/product/DETAIL.md', newDocument([assessment('AS-DETAIL')]));
  const copy = newDocument([assessment('AS-MIRROR')]).replace(/\n/g, '\r\n');
  const check = run('check', root, { path: 'docs/product/IMPLEMENTATION.md', content: copy });
  expect(check.status).toBe('valid');
  expect(check.diagnostics.some((d: any) => d.code === 'ASSESSMENT_BODY_COPY')).toBe(true);
  const saved = run('apply', root, { files: [{ path: 'docs/product/IMPLEMENTATION.md', expected_sha256: null, content: copy }] });
  expect(saved.status).toBe('saved');
  expect(saved.files[0].diagnostics.some((d: any) => d.code === 'ASSESSMENT_BODY_COPY')).toBe(true);
  const before = run('read', root);
  expect(before.unusable_items).toHaveLength(0);
  expect(before.diagnostics.filter((d: any) => d.code === 'ASSESSMENT_BODY_COPY')).toHaveLength(2);
  const summary = assessment('AS-MIRROR', 'REQ-JUDICIAL', '部分满足；详细依据见[原报告](DETAIL.md#as-detail)。');
  const operation = { path: 'docs/product/IMPLEMENTATION.md', expected_sha256: sha256(copy), preimage_path: 'docs/evidence/history/old-implementation.md', updates: [{ id: 'AS-MIRROR', body: summary.body }] };
  const linked = run('apply', root, { files: [operation] });
  expect(linked.status).toBe('saved');
  expect(fs.readFileSync(path.join(root, 'docs/evidence/history/old-implementation.md'), 'utf8')).toBe(copy);
  expect(run('read', root).diagnostics.some((d: any) => d.code === 'ASSESSMENT_BODY_COPY')).toBe(false);
  put(root, 'docs/product/INDEPENDENT.md', newDocument([assessment('AS-OTHER', 'REQ-JUDICIAL', '另一次不同输入的独立失败，保留原始事实。')]));
  expect(run('read', root).diagnostics.some((d: any) => d.code === 'ASSESSMENT_BODY_COPY')).toBe(false);
});

test('identical v3 prose for explicitly different objects/scopes is retained without a copy warning', () => {
  function report(id: string, value: string) {
    const original = assessment(id);
    return { ...original, metadata: { ...original.metadata, target_definition_algorithm: 'vnext-product-definition/v1',
      goal_basis: { kind: 'file', path: 'docs/product/GOALS.md', item_id: 'GOAL' }, goal_definition_algorithm: 'vnext-product-definition/v1',
      goal_definition_sha256: null, applicability: { goal_id: 'GOAL', scope_id: 'FULL', coverage: 'MD逐项终态。' },
      subject: { kind: 'commit', value }, conclusion: 'undetermined' } };
  }
  const items = parseProduct(newDocument([report('AS-A', 'a'.repeat(40)), report('AS-B', 'b'.repeat(40))], '独立对象', 3), 'reports.md').items;
  expect(items.every(i => i.usable)).toBe(true);
  expect(assessmentCopyDiagnostics(items)).toEqual([]);
  items[1]!.metadata.subject.value = items[0]!.metadata.subject.value;
  items[1]!.metadata.applicability.scope_id = 'OTHER';
  expect(assessmentCopyDiagnostics(items)).toEqual([]);
  items[1]!.metadata.applicability.scope_id = 'FULL';
  expect(assessmentCopyDiagnostics(items)).toHaveLength(2);
});
