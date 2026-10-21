import { afterAll, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { parseProduct, sha256 } from '../runtime/vnext/src/product-maintenance/parser';
import { installDistribution, upgradeDistribution } from '../scripts/vibe-governance-distribution';
const roots: string[] = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
const packageRoot = path.resolve(import.meta.dir, '../packages/vibe-governance');

test('installed functional-point contract reads real legacy tables without dependencies or business rewrites', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'points-installed-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"points-install-fixture","private":true,"type":"module"}\n');
  expect(installDistribution({ targetRoot: root, packageRoot }).status).toBe('installed');
  const support = path.join(root, '.workflow-system/runtime/support/product-maintenance');
  for (const asset of ['functional-points.js', 'functional-points.md', 'templates/ASSESSMENT.md']) {
    expect(fs.readFileSync(path.join(support, asset))).toEqual(fs.readFileSync(path.resolve(import.meta.dir, '../runtime/vnext/support/product-maintenance', asset)));
  }
  expect(fs.readFileSync(path.join(root, '.agents/skills/maintain-project/SKILL.md'), 'utf8')).toContain('product-maintenance/functional-points.md');
  expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
  const sample = JSON.parse(fs.readFileSync(path.join(import.meta.dir, 'fixtures/product-points/task825-original.json'), 'utf8')).reports[0];
  const consumer = path.join(support, 'functional-points.js');
  const reportPath = path.join(root, 'legacy-table.md'); fs.writeFileSync(reportPath, sample.body);
  const before = fs.readFileSync(reportPath);
  const script = `import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
    const {readAssessmentPoints}=await import(pathToFileURL(process.argv[1]).href);
    let input='';for await(const chunk of process.stdin)input+=chunk;const value=JSON.parse(input);
    console.log(JSON.stringify(readAssessmentPoints(readFileSync(process.argv[2],'utf8'),value.target,value.expected_points.map(id=>({id,title:id,line:1})))));`;
  const parsed = JSON.parse(execFileSync('node', ['--input-type=module', '-e', script, consumer, reportPath], { input: JSON.stringify(sample), encoding: 'utf8', cwd: root }));
  expect(parsed.status).toBe('parsed'); expect(parsed.coverage).toBe('complete'); expect(parsed.rows).toHaveLength(6);
  expect(fs.readFileSync(reportPath)).toEqual(before);
});

test('installed v4 Roadmap initializes and detects manual changes without writing on reads', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-installed-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"roadmap-install-fixture","private":true,"type":"module"}\n');
  expect(installDistribution({ targetRoot: root, packageRoot }).status).toBe('installed');
  const support = path.join(root, '.workflow-system/runtime/support/product-maintenance');
  const helper = path.join(root, '.workflow-system/runtime/support/product-maintenance.js');
  expect(fs.existsSync(path.join(support, 'schemas/product-doc-v4.json'))).toBe(true);
  expect(fs.existsSync(path.join(support, 'templates/IMPLEMENTATION_ROADMAP.md'))).toBe(true);
  const example = path.join(support, 'examples/roadmap');
  fs.cpSync(path.join(example, 'docs'), path.join(root, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(example, '.workflow-system/PRODUCT.yaml'), path.join(root, '.workflow-system/PRODUCT.yaml'));
  const invoke = (action: string, input: any) => JSON.parse(execFileSync('node', [helper, action, '--root', root], { encoding: 'utf8', input: JSON.stringify(input) }));
  const query = { plan_id: 'PLAN-PERMISSIONS', selector: { kind: 'explicit-requirements', requirement_ids: ['REQ-20'] } };
  const first = invoke('read', { roadmap_query: query });
  expect(first.roadmap_reconciliation.status).toBe('unknown');
  const relative = 'docs/product/IMPLEMENTATION_ROADMAP.md', file = path.join(root, relative);
  const baseline = { ...first.roadmap_reconciliation.snapshot_proposal, checked_at: '2026-10-14T00:00:00Z', working_copy: first.working_copy.identity,
    sources: [{ kind: 'text', label: '安装夹具核对', text: '合成定义和范围已核对，不是实际业务验收。' }], unread_sources: [], exceptions: [] };
  const saved = invoke('apply', { files: [{ path: relative, expected_sha256: sha256(fs.readFileSync(file)), updates: [{ id: query.plan_id, metadata: { planning_baseline: baseline } }] }] });
  expect(saved.files[0].baseline_readback).toEqual([{ plan_id: query.plan_id, status: 'matched' }]);
  const before = fs.readFileSync(file);
  expect(invoke('read', { roadmap_query: { plan_id: query.plan_id } }).roadmap_reconciliation.status).toBe('current');
  const offline = JSON.parse(execFileSync('node', [path.join(support, 'offline-reader.js'), root, query.plan_id], { encoding: 'utf8' }));
  expect(offline.supported_formats).toContain('vnext-product-doc/v4');
  expect(offline.roadmap_reconciliation.status).toBe('current');
  const requirements = path.join(root, 'docs/product/PROJECT.md');
  fs.writeFileSync(requirements, fs.readFileSync(requirements, 'utf8').replace('角色权限。', '角色权限及新的隔离范围。'));
  const changed = invoke('check', { roadmap_query: { plan_id: query.plan_id } });
  expect(changed.roadmap_reconciliation.status).toBe('changes-pending');
  expect(changed.roadmap_reconciliation.affected_work_items).toEqual(['W20-A', 'W20-B']);
  expect(changed.development_gate).toBe(false);
  expect(fs.readFileSync(file)).toEqual(before);
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
  // Regression evidence must also hold in the installed Node program.
  const requirement = parseProduct(fs.readFileSync(requirements, 'utf8'), 'docs/product/PROJECT.md').items.find(i => i.id === 'REQ-20')!;
  const duplicate = path.join(root, 'docs/product/DUPLICATE.md');
  fs.writeFileSync(duplicate, newDocument([{ metadata: requirement.metadata, body: requirement.body }], '重复身份', 3));
  const restricted = invoke('read', { paths: ['docs/product/PROJECT.md', relative], roadmap_query: { plan_id: query.plan_id } }).roadmap_reconciliation;
  expect(restricted.status).toBe('unknown'); expect(restricted.reasons).toContain('enumeration-incomplete');
  fs.unlinkSync(duplicate);
  expect(invoke('apply', { files: [{ path: 'docs/product/PROJECT.md', expected_sha256: sha256(fs.readFileSync(requirements)), append: [{
    metadata: { id: 'REQ-21', type: 'requirement', scope: 'current' }, body: requirement.body.replaceAll('REQ-20', 'REQ-21'),
  }] }] }).status).toBe('saved');
  const selection = { ...query, selector: { kind: 'explicit-requirements', requirement_ids: ['REQ-20','REQ-21'] } };
  const fullBaseline = { ...baseline, ...invoke('read', { roadmap_query: selection }).roadmap_reconciliation.snapshot_proposal };
  const saveBaseline = (value: any) => invoke('apply', { files: [{ path: relative, expected_sha256: sha256(fs.readFileSync(file)), updates: [{ id: query.plan_id, metadata: { planning_baseline: value } }] }] });
  expect(saveBaseline(fullBaseline).status).toBe('saved');
  fs.writeFileSync(requirements, fs.readFileSync(requirements, 'utf8').replaceAll('角色权限及新的隔离范围。', '再次变化的权限要求。'));
  const advanced = invoke('read', { roadmap_query: { plan_id: query.plan_id } }).roadmap_reconciliation.snapshot_proposal;
  const partialBaseline = { ...fullBaseline, definitions: fullBaseline.definitions.map((d: any) => d.id === 'REQ-20' ? advanced.definitions.find((now: any) => now.id === d.id) : d) };
  const partialSaved = saveBaseline(partialBaseline);
  expect(partialSaved.status).toBe('saved');
  expect(partialSaved.files[0].baseline_readback[0].retained_snapshots).toEqual([{ field: 'definitions', id: 'REQ-21' }]);
  const pending = invoke('read', { roadmap_query: { plan_id: query.plan_id } }).roadmap_reconciliation;
  expect(pending.status).toBe('changes-pending');
  expect(pending.changes.filter((c: any) => c.kind === 'definition-changed').map((c: any) => c.id)).toEqual(['REQ-21']);
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
  const statePath = path.join(root, '.workflow-system/vnext/DISTRIBUTION_STATE.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')); state.distribution_version = '0.0.1'; fs.writeFileSync(statePath, JSON.stringify(state));
  const owned = [file, requirements, path.join(root, '.workflow-system/PRODUCT.yaml')].map(p => [p, fs.readFileSync(p)] as const);
  expect(upgradeDistribution({ targetRoot: root, packageRoot }).status).toBe('upgraded');
  for (const [p, bytes] of owned) expect(fs.readFileSync(p)).toEqual(bytes);
});

test('installed record-storage maintenance route survives upgrade without enabling product documents', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-maintenance-installed-')); roots.push(root);
  const business = 'docs/product/UNMANAGED.md', original = Buffer.from('\uFEFF# Existing business notes\r\nKeep this unrelated text exactly.\r\n');
  const record = '.workflow-system/records/events/retained.json', recordBytes = Buffer.from('{"original":"failed observation"}\r\n');
  for (const [relative, bytes] of [[business, original], [record, recordBytes]] as const) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), bytes);
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"record-maintenance-fixture","private":true,"type":"module"}\n');
  const reference = '.workflow-system/runtime/support/product-maintenance/references/record-storage.md';
  const source = fs.readFileSync(path.resolve(import.meta.dir, '../runtime/vnext/support/product-maintenance/references/record-storage.md'));
  const check = () => {
    const skill = fs.readFileSync(path.join(root, '.agents/skills/maintain-project/SKILL.md'), 'utf8');
    expect(skill).toContain('product-maintenance/references/record-storage.md');
    expect(fs.readFileSync(path.join(root, reference))).toEqual(source);
    const state = JSON.parse(fs.readFileSync(path.join(root, '.workflow-system/vnext/DISTRIBUTION_STATE.json'), 'utf8'));
    expect(state.managed_files.some((file: any) => file.path === reference)).toBe(true);
    const helper = path.join(root, '.workflow-system/runtime/support/assistance.mjs');
    const invoke = (action: string) => JSON.parse(execFileSync('node', [helper, 'archive', '--root', root], { encoding: 'utf8', input: JSON.stringify({ action }) }));
    expect(invoke('plan')).toMatchObject({ status: 'planned', count: 1, originals_retained: true, development_gate: false });
    expect(invoke('verify')).toMatchObject({ status: 'verified', verified: true, development_gate: false });
    expect(fs.existsSync(path.join(root, '.workflow-system/PRODUCT.yaml'))).toBe(false);
    expect(fs.readFileSync(path.join(root, business))).toEqual(original);
    expect(fs.readFileSync(path.join(root, record))).toEqual(recordBytes);
  };
  expect(installDistribution({ targetRoot: root, packageRoot }).status).toBe('installed'); check();
  const statePath = path.join(root, '.workflow-system/vnext/DISTRIBUTION_STATE.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')); state.distribution_version = '0.0.1'; fs.writeFileSync(statePath, JSON.stringify(state));
  expect(upgradeDistribution({ targetRoot: root, packageRoot }).status).toBe('upgraded'); check();
});

test('installed maintenance assets execute with Node and upgrade preserves all target-owned business bytes', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-installed-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"isolated-product","private":true,"type":"module"}\n');
  const installed = installDistribution({ targetRoot: root, packageRoot }); expect(installed.status).toBe('installed');
  const support = path.join(root, '.workflow-system/runtime/support/product-maintenance');
  const helper = path.join(root, '.workflow-system/runtime/support/product-maintenance.js');
  expect(fs.existsSync(path.join(root, '.agents/skills/maintain-project/SKILL.md'))).toBe(true);
  for (const asset of ['API.md', 'contract.md', 'references/inventory.md', 'references/update.md', 'references/plan.md', 'references/discussion.md', 'references/reconcile.md', 'references/recovery.md', 'templates/PRODUCT.yaml', 'templates/PROJECT.md', 'schemas/product-doc-v1.json', 'schemas/product-doc-v2.json', 'schemas/product-manifest-v1.json', 'schemas/product-manifest-v2.json', 'schemas/request-v1.json', 'offline-reader.js', 'examples/planning/README.md', 'examples/planning/no-plan/.workflow-system/PRODUCT.yaml', 'examples/planning/multiple-plans/.workflow-system/PRODUCT.yaml']) expect(fs.existsSync(path.join(support, asset))).toBe(true);
  const invoke = (action: string, input: any = {}) => JSON.parse(execFileSync('node', [helper, action, '--root', root], { encoding: 'utf8', input: JSON.stringify(input) }));
  expect(invoke('read').status).toBe('not-enabled'); expect(fs.existsSync(path.join(root, '.workflow-system/PRODUCT.yaml'))).toBe(false);
  const example = path.join(support, 'examples/e6');
  fs.cpSync(path.join(example, 'docs'), path.join(root, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(example, '.workflow-system/PRODUCT.yaml'), path.join(root, '.workflow-system/PRODUCT.yaml'));
  fs.mkdirSync(path.join(root, 'docs/product/history'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs/product/history/earlier.md'), '用户历史，不属于安装软件。\r\n');
  const owned = ['.workflow-system/PRODUCT.yaml', 'docs/product/PROJECT.md', 'docs/product/REQUIREMENTS.md', 'docs/product/PLAN.md', 'docs/product/ASSESSMENTS.md', 'docs/product/DISCUSSIONS.md', 'docs/product/raw/selected.txt', 'docs/product/history/earlier.md'];
  const before = owned.map(relative => fs.readFileSync(path.join(root, relative)));
  const read = invoke('read', { detail: 'items', discussion_targets: ['REQ-IMPORT'] }); expect(read.usable_items.some((i: any) => i.type === 'plan')).toBe(true); expect(read.discussions).toHaveLength(1);
  expect(fs.existsSync(path.join(support, 'references/compact-context.md'))).toBe(true);
  expect(fs.readFileSync(path.join(root, '.agents/skills/maintain-project/SKILL.md'), 'utf8')).toContain('presentation: compact');
  const compact = invoke('read', { presentation: 'compact', query: { kind: 'item', item_id: 'REQ-IMPORT' } });
  expect(compact.presentation_contract).toBe('product-context/v1');
  expect(compact.items.value[0].id).toBe('REQ-IMPORT');
  const originalBody = read.usable_items.find((i: any) => i.id === 'REQ-IMPORT').body;
  const actualBody = invoke('read', { presentation: 'compact', query: { kind: 'collection', name: 'body', owner_id: 'REQ-IMPORT' } });
  expect(actualBody.value).toBe(originalBody);
  expect(actualBody.pagination.next_request).toBeNull();
  owned.forEach((relative, i) => expect(fs.readFileSync(path.join(root, relative))).toEqual(before[i]!));

  const statePath = path.join(root, '.workflow-system/vnext/DISTRIBUTION_STATE.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')); state.distribution_version = '0.0.1'; fs.writeFileSync(statePath, JSON.stringify(state));
  const upgraded = upgradeDistribution({ targetRoot: root, packageRoot }); expect(upgraded.status).toBe('upgraded');
  owned.forEach((relative, i) => expect(fs.readFileSync(path.join(root, relative))).toEqual(before[i]!));
  expect(invoke('check').development_gate).toBe(false);
  // Exercise the repaired common chain in the actual installed Node artifact.
  const attempt = (action: string, input: any) => {
    const child = spawnSync('node', [helper, action, '--root', root], { encoding: 'utf8', input: JSON.stringify(input) });
    return { exit: child.status, result: JSON.parse(child.stdout) };
  };
  const selected = 'docs/product/HARDENING.md';
  const sections = '### 需求内容\n保留业务正文。\n### 范围边界\n保留排除项。\n### 验收要求\n按范围验证。\n';
  const sourceA = { kind: 'text', text: '合成原否定依据 A', label: '旧依据' }, sourceB = { kind: 'text', text: '合成原否定依据 B', label: '旧依据' };
  const link = { id: 'L-NEG', relation: 'references', target: 'REQ-IMPORT', origin: 'inferred', state: 'dismissed', reason: '合成用户否定', sources: [sourceA, sourceB] };
  const item = { metadata: { id: 'REQ-H', type: 'requirement', scope: 'current', assessment_id: 'AS-BASE', links: [link] }, body: '## [REQ-H] 安装后维护\n' + sections };
  expect(invoke('apply', { files: [{ path: selected, expected_sha256: null, content: newDocument([item]) }] }).status).toBe('saved');
  const bytes = () => fs.readFileSync(path.join(root, selected));
  const update = (input: any) => ({ files: [{ path: selected, expected_sha256: sha256(bytes()), ...input }] });
  expect(attempt('apply', { files: [{ path: 'docs/product/COPY.md', expected_sha256: null, content: newDocument([item]) }] }).exit).toBe(1);
  expect(fs.existsSync(path.join(root, 'docs/product/COPY.md'))).toBe(false);
  for (const input of [{ content: newDocument([{ ...item, metadata: { ...item.metadata, type: 'goal' } }]) }, { updates: [{ id: 'REQ-H', metadata: { links: [{ ...link, state: 'active', sources: [sourceB, sourceA] }] } }] }, { updates: [{ id: 'REQ-H', body: item.body + '\n## 普通标题\n越界约束\n' }] }]) {
    const before = bytes(); expect(attempt('apply', update(input)).exit).toBe(1); expect(bytes()).toEqual(before);
  }
  expect(invoke('apply', update({ updates: [{ id: 'REQ-H', remove_fields: ['assessment_id'] }] })).files[0].status).toBe('saved');
  expect(parseProduct(bytes().toString(), selected).items[0]!.metadata.assessment_id).toBeUndefined();
  expect(invoke('apply', update({ updates: [{ id: 'REQ-H', remove_fields: ['assessment_id'] }] })).files[0].status).toBe('unchanged');
  const changed = { ...item, metadata: { ...item.metadata, links: [{ ...link, state: 'active', reason: '当前明确改变原决定', sources: [sourceA, sourceB, { kind: 'text', text: '合成当前用户明确同意关联', label: '当前决定' }] }] }, body: item.body + '\n### 长约束\n诊断不得上传原始数据。\n' };
  expect(invoke('apply', update({ content: newDocument([changed]) })).status).toBe('saved');
  expect(invoke('read', { item_ids: ['REQ-H'], detail: 'items' }).usable_items[0].body).toContain('诊断不得上传');
  const malformed = bytes().toString().replace('    scope: current', '    scope: current\n    unknown: true'); fs.writeFileSync(path.join(root, selected), malformed);
  expect(invoke('apply', update({ content: malformed.replace('    unknown: true\n', '') })).status).toBe('saved');
  const legacy = bytes().toString().replace('doc/v2', 'doc/v1').replace(/    task_bindings:[\s\S]*?(?=---)/, ''); fs.writeFileSync(path.join(root, selected), legacy);
  expect(attempt('apply', update({ content: legacy.replace('doc/v1', 'doc/v2') })).exit).toBe(1);
  expect(invoke('apply', update({ content: legacy.replace('doc/v1', 'doc/v2'), migrate: 'v2' })).status).toBe('saved');
  const legacyBinding = { id: 'B-LEGACY', task: { task_id: null, source: { kind: 'file', path: 'docs/evidence/legacy.md', section: '导入', note: '原显示' } }, role: 'repair', coverage: '历史局部范围', origin: 'declared', state: 'dismissed', reason: '原否定', sources: [sourceA] };
  expect(invoke('apply', update({ updates: [{ id: 'REQ-H', metadata: { task_bindings: [legacyBinding] } }] })).status).toBe('saved');
  const legacyBytes = bytes();
  const equivalent = { ...legacyBinding, id: 'B-RETRY', state: 'active', task: { ...legacyBinding.task, source: { ...legacyBinding.task.source, note: '新显示', sha256: 'a'.repeat(64) } } };
  expect(attempt('apply', update({ updates: [{ id: 'REQ-H', metadata: { task_bindings: [legacyBinding, equivalent] } }] })).exit).toBe(1); expect(bytes()).toEqual(legacyBytes);
  const reassociated = { ...equivalent, reason: '当前明确改变原决定', sources: [sourceA, { kind: 'text', text: '当前明确同意重新关联此历史范围', label: '合成当前决定' }] };
  expect(invoke('apply', update({ updates: [{ id: 'REQ-H', metadata: { task_bindings: [legacyBinding, reassociated] } }] })).status).toBe('saved');
  // Recheck R01-R04 through installed Node rather than relying on source-only tests.
  const manifestPath = path.join(root, '.workflow-system/PRODUCT.yaml');
  expect(invoke('apply', { files: [{ path: '.workflow-system/PRODUCT.yaml', expected_sha256: sha256(fs.readFileSync(manifestPath)), content: stringify({ ...read.manifest, managed_paths: ['docs/product/**.md'] }) }] }).status).toBe('saved');
  const deepPath = 'docs/product/nested/DEEP.md';
  expect(invoke('apply', { files: [{ path: deepPath, expected_sha256: null, content: newDocument([{ metadata: { id: 'REQ-DEEP', type: 'requirement', scope: 'current' }, body: '## [REQ-DEEP] 深层要求\n' + sections }]) }] }).status).toBe('saved');
  expect(invoke('read').usable_items.map((i: any) => i.id)).toContain('REQ-DEEP');
  const repairPath = 'docs/product/P2-REPAIR.md', repairFile = path.join(root, repairPath);
  const badSources = { ...link, sources: [null, sourceA] };
  const repairItem = { metadata: { id: 'REQ-P2', type: 'requirement', scope: 'current', links: [badSources] }, body: '## [REQ-P2] 手改坏关系\n' + sections };
  fs.writeFileSync(repairFile, newDocument([repairItem]));
  const repairBytes = () => fs.readFileSync(repairFile);
  const repairUpdate = (links: any[], remove_relations?: any[]) => ({ files: [{ path: repairPath, expected_sha256: sha256(repairBytes()), updates: [{ id: 'REQ-P2', metadata: { links } }], ...(remove_relations ? { remove_relations } : {}) }] });
  const priorBadSources = repairBytes();
  expect(attempt('apply', repairUpdate([{ ...link, state: 'active', sources: [sourceA] }])).exit).toBe(1); expect(repairBytes()).toEqual(priorBadSources);
  const fixedSources = { ...link, state: 'active', reason: '当前明确改变原决定', sources: [sourceA, { kind: 'text', text: '当前用户同意重新关联，旧坏来源保留在原文', label: '当前决定' }] };
  const repairedSource = invoke('apply', repairUpdate([fixedSources]));
  expect(repairedSource.status).toBe('saved'); expect(repairedSource.files[0].preimage.data_base64).toBe(priorBadSources.toString('base64'));
  const keep = { ...link, id: 'L-KEEP', target: 'REQ-H', state: 'active' };
  fs.writeFileSync(repairFile, newDocument([{ ...repairItem, metadata: { ...repairItem.metadata, links: [null, link, keep] } }]));
  const priorBadRelations = repairBytes();
  expect(attempt('apply', repairUpdate([keep])).exit).toBe(1); expect(repairBytes()).toEqual(priorBadRelations);
  const removed = invoke('apply', repairUpdate([keep], [{ item_id: 'REQ-P2', field: 'links', id: link.id }]));
  expect(removed.status).toBe('saved'); expect(removed.files[0].preimage.data_base64).toBe(priorBadRelations.toString('base64'));
  expect(invoke('read', { item_ids: ['REQ-P2'], detail: 'items' }).usable_items[0].metadata.links).toEqual([keep]);
  // C01-C03 use the same installed common writer, without a new task state/gate.
  const closingPath = 'docs/product/C-P2.md', closingFile = path.join(root, closingPath);
  const closingBody = '## [REQ-C-P2] 明确操作维护\n' + sections;
  const closingItem = { metadata: { id: 'REQ-C-P2', type: 'requirement', scope: 'current', links: [{ ...link, sources: [{ ...sourceA, unknown: true }] }] }, body: closingBody };
  fs.writeFileSync(closingFile, newDocument([closingItem]));
  const closingBytes = () => fs.readFileSync(closingFile);
  const closingUpdate = (metadata: any) => ({ files: [{ path: closingPath, expected_sha256: sha256(closingBytes()), updates: [{ id: 'REQ-C-P2', metadata }] }] });
  const closingOriginal = closingBytes(), cleanDismissed = { ...link, sources: [sourceA] };
  expect(attempt('apply', closingUpdate({ links: [{ ...cleanDismissed, state: 'active', reason: '只清理未知字段，原否定不变' }] })).exit).toBe(1); expect(closingBytes()).toEqual(closingOriginal);
  const formatRepair = invoke('apply', closingUpdate({ links: [cleanDismissed] }));
  expect(formatRepair.status).toBe('saved'); expect(formatRepair.files[0].preimage.data_base64).toBe(closingOriginal.toString('base64'));
  const currentDecision = { kind: 'text', text: '当前用户明确改变原否定，重新关联此范围。', label: '当前操作' };
  expect(invoke('apply', closingUpdate({ links: [{ ...cleanDismissed, state: 'active', reason: currentDecision.text, sources: [sourceA, currentDecision] }] })).status).toBe('saved');
  const currentActive = { ...cleanDismissed, id: 'L-CURRENT', state: 'active', origin: 'declared', reason: '之前已经存在的当前关联' };
  fs.writeFileSync(closingFile, newDocument([{ ...closingItem, metadata: { ...closingItem.metadata, assessment_id: 'AS-BASE', links: [cleanDismissed, currentActive] } }]));
  const assessmentBytes = fs.readFileSync(path.join(root, 'docs/product/ASSESSMENTS.md'));
  expect(invoke('apply', closingUpdate({ scope: 'planned' })).status).toBe('saved');
  expect(invoke('apply', { files: [{ path: closingPath, expected_sha256: sha256(closingBytes()), updates: [{ id: 'REQ-C-P2', remove_fields: ['assessment_id'] }] }] }).status).toBe('saved');
  expect(fs.readFileSync(path.join(root, 'docs/product/ASSESSMENTS.md'))).toEqual(assessmentBytes);
  const closingRead = invoke('read', { item_ids: ['REQ-C-P2'], detail: 'items' });
  expect(closingRead.usable_items[0].metadata.scope).toBe('planned'); expect(closingRead.usable_items[0].metadata.links).toEqual([cleanDismissed, currentActive]);
  const beforeRetry = closingBytes();
  expect(attempt('apply', closingUpdate({ links: [cleanDismissed, currentActive, { ...currentActive, id: 'L-RETRY' }] })).exit).toBe(1); expect(closingBytes()).toEqual(beforeRetry);
  const appendPath = 'docs/product/C-APPEND.md', appendFile = path.join(root, appendPath);
  const appendOriginal = '\uFEFF---\r\nschema: vnext-product-doc/v2\r\nitems: [ { "id" : "REQ-KEEP", "type" : "requirement", "scope" : "current", "unknown" : true }, # trailing comma\r\n ]\r\n---\r\n# 原文资料\r\n\r\n## [REQ-KEEP] 无关坏邻项\r\n' + sections.replace(/\n/g, '\r\n');
  fs.writeFileSync(appendFile, appendOriginal);
  const appendedItem = { metadata: { id: 'REQ-ADDED', type: 'requirement', scope: 'current' }, body: '## [REQ-ADDED] 当前明确新增\n' + sections };
  const appendSaved = invoke('apply', { files: [{ path: appendPath, expected_sha256: sha256(appendOriginal), append: [appendedItem] }] });
  expect(appendSaved.status).toBe('saved'); expect(appendSaved.files[0].preimage.data_base64).toBe(Buffer.from(appendOriginal).toString('base64'));
  const oldNeighbor = parseProduct(appendOriginal, appendPath).items[0]!, nextAppend = fs.readFileSync(appendFile, 'utf8'), newNeighbor = parseProduct(nextAppend, appendPath).items.find(i => i.id === 'REQ-KEEP')!;
  expect(newNeighbor.body.slice(0, oldNeighbor.body.length)).toBe(oldNeighbor.body); expect(newNeighbor.body.slice(oldNeighbor.body.length)).toMatch(/^(?:\r\n|\n|\r)*$/);
  expect(nextAppend.slice(newNeighbor.metadata_start, newNeighbor.metadata_end)).toBe(appendOriginal.slice(oldNeighbor.metadata_start, oldNeighbor.metadata_end));
  expect(invoke('read', { item_ids: ['REQ-ADDED'], detail: 'items' }).usable_items[0].body).toContain('当前明确新增');
  const failedCandidate = attempt('apply', { files: [{ path: appendPath, expected_sha256: sha256(nextAppend), append: [{ ...appendedItem, metadata: { ...appendedItem.metadata, id: 'REQ-BOUNDARY' }, body: '## [REQ-BOUNDARY] 约束\n' + sections + '\n## 越界\n' }] }] });
  expect(failedCandidate.exit).toBe(1); expect(failedCandidate.result.development_gate).toBe(false); expect(fs.readFileSync(appendFile, 'utf8')).toBe(nextAppend);
  const htmlPath = 'docs/product/D-APPEND.md', htmlFile = path.join(root, htmlPath);
  const htmlItem = { metadata: { id: 'REQ-HTML', type: 'requirement', scope: 'current' }, body: '## [REQ-HTML] 原合法表格\n' + sections + '<table>\n<tr><td>旧限制保留。</td></tr>\n</table>\n' };
  const htmlOriginal = newDocument([htmlItem]).replace(/\n\n$/, '\n'); fs.writeFileSync(htmlFile, htmlOriginal);
  const htmlSaved = invoke('apply', { files: [{ path: htmlPath, expected_sha256: sha256(htmlOriginal), append: [{ ...appendedItem, metadata: { ...appendedItem.metadata, id: 'REQ-AFTER-HTML' }, body: appendedItem.body.replace('REQ-ADDED', 'REQ-AFTER-HTML') }] }] });
  expect(htmlSaved.status).toBe('saved'); expect(htmlSaved.files[0].preimage.data_base64).toBe(Buffer.from(htmlOriginal).toString('base64'));
  expect(invoke('read', { item_ids: ['REQ-HTML', 'REQ-AFTER-HTML'], detail: 'items' }).usable_items.map((i: any) => i.id)).toEqual(['REQ-HTML', 'REQ-AFTER-HTML']);
  const duplicates = [cleanDismissed, currentActive, { ...currentActive }];
  fs.writeFileSync(closingFile, newDocument([{ ...closingItem, metadata: { ...closingItem.metadata, links: duplicates } }]));
  expect(invoke('apply', closingUpdate({ scope: 'planned' })).status).toBe('saved');
  const duplicateRead = invoke('read', { item_ids: ['REQ-C-P2'], detail: 'items' });
  expect(duplicateRead.usable_items[0].metadata.links).toEqual(duplicates); expect(duplicateRead.diagnostics.some((d: any) => d.code === 'DUPLICATE_LINK_ID')).toBe(true);
  const duplicateBefore = closingBytes();
  const duplicateRevival = attempt('apply', closingUpdate({ links: [{ ...currentActive }, ...duplicates] }));
  expect(duplicateRevival.exit).toBe(1); expect(duplicateRevival.result.files[0].error).toContain('DISMISSED_RELATION'); expect(closingBytes()).toEqual(duplicateBefore);
  // Review R1/R2 of 00e5309: syntax-aware repairs and individual historical rows.
  const syntaxPath = 'docs/product/REVIEW-SYNTAX.md', syntaxFile = path.join(root, syntaxPath);
  const syntaxItem = { metadata: { id: 'REQ-REVIEW-SYNTAX', type: 'requirement', scope: 'current' }, body: '## [REQ-REVIEW-SYNTAX] 原可用需求\n' + sections };
  const syntaxKeep = { metadata: { id: 'REQ-REVIEW-KEEP', type: 'requirement', scope: 'current', unknown: true }, body: '## [REQ-REVIEW-KEEP] 无关坏邻项\n' + sections };
  const syntaxGood = newDocument([syntaxItem, syntaxKeep]); fs.writeFileSync(syntaxFile, syntaxGood);
  const syntaxRequest = (content: string) => ({ files: [{ path: syntaxPath, expected_sha256: sha256(fs.readFileSync(syntaxFile)), content }] });
  for (const malformed of [syntaxGood.replace('    scope: current', '    scope: current\n    scope: current'), syntaxGood.replace('    scope: current', '    scope: &flag current'), syntaxGood.replace('  - id: REQ-REVIEW-SYNTAX', '  - &entry\n    id: REQ-REVIEW-SYNTAX')]) {
    const rejected = attempt('apply', syntaxRequest(malformed));
    expect(rejected.exit).toBe(1); expect(rejected.result.files[0].error).toContain('STRUCTURE_INVALID'); expect(fs.readFileSync(syntaxFile, 'utf8')).toBe(syntaxGood);
    fs.writeFileSync(syntaxFile, malformed);
    const repaired = invoke('apply', syntaxRequest(syntaxGood));
    expect(repaired.status).toBe('saved'); expect(repaired.files[0].affected_items).toEqual(['REQ-REVIEW-SYNTAX']);
    expect(repaired.files[0].preimage.data_base64).toBe(Buffer.from(malformed).toString('base64')); expect(fs.readFileSync(syntaxFile, 'utf8')).toBe(syntaxGood);
  }
  const historyPath = 'docs/product/REVIEW-HISTORY.md', historyFile = path.join(root, historyPath);
  for (const field of ['links', 'task_bindings']) {
    const identity = field === 'links' ? { relation: 'references', target: 'REQ-H' }
      : { task: { task_id: 'review-first-task', source: sourceA }, role: 'repair', coverage: '原范围' };
    const first = { id: 'REL-REVIEW-SHARED', ...identity, origin: 'inferred', state: 'dismissed', reason: '第一份否定', sources: [sourceA] };
    const second = field === 'links' ? { ...first, target: 'REQ-IMPORT', sources: [sourceA, currentDecision] }
      : { ...first, task: { task_id: 'review-second-task', source: sourceA }, sources: [sourceA, currentDecision] };
    fs.writeFileSync(historyFile, newDocument([{ metadata: { id: 'REQ-REVIEW-HISTORY', type: 'requirement', scope: 'current', [field]: [first, second] }, body: '## [REQ-REVIEW-HISTORY] 分别保留否定历史\n' + sections }]));
    const historyRequest = (relations: any[], removal = false) => ({ files: [{ path: historyPath, expected_sha256: sha256(fs.readFileSync(historyFile)), updates: [{ id: 'REQ-REVIEW-HISTORY', metadata: { [field]: relations } }], ...(removal ? { remove_relations: [{ item_id: 'REQ-REVIEW-HISTORY', field, id: first.id }] } : {}) }] });
    const original = fs.readFileSync(historyFile);
    const implicit = attempt('apply', historyRequest([first]));
    expect(implicit.exit).toBe(1); expect(implicit.result.files[0].error).toContain('DISMISSED_REMOVAL'); expect(fs.readFileSync(historyFile)).toEqual(original);
    const restored = { ...first, state: 'active', origin: 'declared', reason: currentDecision.text, sources: [sourceA, currentDecision] };
    expect(invoke('apply', historyRequest([second, restored])).status).toBe('saved');
    const beforeRemoval = fs.readFileSync(historyFile), removed = invoke('apply', historyRequest([restored], true));
    expect(removed.status).toBe('saved'); expect(removed.files[0].preimage.data_base64).toBe(beforeRemoval.toString('base64'));
    expect(invoke('read', { item_ids: ['REQ-REVIEW-HISTORY'], detail: 'items' }).usable_items[0].metadata[field]).toEqual([restored]);
  }
  // Review R3/R4: requested coverage stays truthful in the installed artifact.
  const scopeManifestBefore = fs.readFileSync(manifestPath), registeredMissing = 'docs/product/REGISTERED-MISSING.md';
  const coverageManifest = { ...read.manifest, managed_paths: ['docs/product/**.md', registeredMissing] };
  fs.writeFileSync(manifestPath, stringify(coverageManifest));
  for (const action of ['read', 'check']) {
    const gap = attempt(action, { paths: ['docs/product/*.md'] });
    expect(gap.exit).toBe(1); expect(gap.result.coverage.complete).toBe(false); expect(gap.result.coverage.omitted).toEqual([registeredMissing]); expect(gap.result.development_gate).toBe(false);
    if (action === 'read') expect(gap.result.usable_items.map((i: any) => i.id)).toContain('REQ-H'); else expect(gap.result.status).toBe('partial');
  }
  expect(invoke('read', { paths: [selected] }).coverage.complete).toBe(true);
  expect(invoke('read', { paths: ['docs/product/NO-MATCH-*.md'] }).coverage.complete).toBe(true);
  fs.writeFileSync(manifestPath, stringify({ ...coverageManifest, exclude_paths: [registeredMissing] }));
  expect(invoke('read', { paths: ['docs/product/*.md'] }).coverage.complete).toBe(true);
  const globPrefix = 'docs/product/READ-PREFIX', globPrefixFile = path.join(root, globPrefix);
  fs.writeFileSync(globPrefixFile, '合成目录被换成普通文件，读取不得改写。');
  const prefixManifest = { ...read.manifest, managed_paths: ['docs/product/**.md', globPrefix + '/*.md'] };
  fs.writeFileSync(manifestPath, stringify(prefixManifest));
  for (const action of ['read', 'check']) {
    const gap = attempt(action, {});
    expect(gap.exit).toBe(1); expect(gap.result.coverage.complete).toBe(false); expect(gap.result.coverage.omitted).toEqual([globPrefix]);
    expect(gap.result.diagnostics.some((d: any) => d.code === 'PATH_UNAVAILABLE' && d.path === globPrefix && d.message.includes('directory'))).toBe(true);
  }
  expect(fs.readFileSync(globPrefixFile, 'utf8')).toBe('合成目录被换成普通文件，读取不得改写。');
  expect(invoke('read', { paths: [selected] }).coverage.complete).toBe(true);
  fs.writeFileSync(manifestPath, stringify({ ...prefixManifest, exclude_paths: [globPrefix] })); expect(invoke('read').coverage.complete).toBe(true);
  fs.unlinkSync(globPrefixFile); fs.mkdirSync(globPrefixFile); fs.writeFileSync(manifestPath, stringify(prefixManifest)); expect(invoke('read').coverage.complete).toBe(true);
  fs.writeFileSync(manifestPath, scopeManifestBefore);
  const manage = (command: string, input: any) => JSON.parse(execFileSync('node', [path.join(root, '.workflow-system/runtime/support/assistance.mjs'), command, '--root', root], { encoding: 'utf8', input: JSON.stringify(input) }));
  expect(manage('record', { kind: 'observation', body: { synthetic_fixture: true, maintenance_saved: false, error: failedCandidate.result.files[0].error }, idempotency_key: 'c-p2-failure-observation' }).recorded).toBe(true);
  const prepared = manage('task', { action: 'prepare', plan: { title: '合成明确任务', goal: '管理保存失败不否决明确任务', steps: [{ id: 'S1', title: '已明确工作' }] }, idempotency_key: 'c-p2-independent-prepare' });
  expect(prepared.recorded).toBe(true); expect(prepared.association).toBe('applied'); expect(manage('task-status', { task_ref: prepared.task_id, detail: 'task' }).task.task_id).toBe(prepared.task_id);
  const projectFile = path.join(root, 'docs/product/PROJECT.md');
  fs.renameSync(projectFile, path.join(root, 'docs/product/project-before.txt')); fs.mkdirSync(projectFile);
  const directoryEntry = attempt('check', {}); expect(directoryEntry.exit).toBe(1); expect(directoryEntry.result.status).toBe('partial'); expect(directoryEntry.result.coverage.omitted).toContain('docs/product/PROJECT.md');
  const missing = attempt('read', { paths: ['docs/product/MISSING.md', selected] }); expect(missing.exit).toBe(1); expect(missing.result.coverage.complete).toBe(false); expect(missing.result.usable_items.map((i: any) => i.id)).toContain('REQ-H');
  const offline = fs.mkdtempSync(path.join(os.tmpdir(), 'product-offline-')); roots.push(offline);
  fs.cpSync(example, offline, { recursive: true }); fs.copyFileSync(path.join(support, 'offline-reader.js'), path.join(offline, 'offline-reader.mjs'));
  const result = JSON.parse(execFileSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' }));
  expect(fs.existsSync(path.join(offline, '.workflow-system/runtime'))).toBe(false); expect(fs.existsSync(path.join(offline, 'node_modules'))).toBe(false);
  expect(result.items.map((i: any) => i.type)).toContain('discussion'); expect(result.plan_tasks[0].work_items).toHaveLength(4); expect(result.task_states).toContain('not-computed');
  // Reordered display retains scoped history and is identical in both Node consumers.
  const reordered = path.join(support, 'examples/planning/reordered');
  const orderedRead = JSON.parse(execFileSync('node', [helper, 'read', '--root', reordered], { encoding: 'utf8', input: '{"detail":"items"}' }));
  const orderedOffline = JSON.parse(execFileSync('node', [path.join(support, 'offline-reader.js'), reordered], { encoding: 'utf8' }));
  expect(orderedRead.usable_items).toHaveLength(10);
  expect(orderedOffline.items.map((i: any) => [i.id, i.metadata, i.body])).toEqual(orderedRead.usable_items.map((i: any) => [i.id, i.metadata, i.body]));
  expect(orderedOffline.items.find((i: any) => i.id === 'PLAN-LOCAL').metadata.work_items.map((i: any) => i.id)).toEqual(['B', 'A', 'C']);
  const orderedBindings = orderedOffline.items.find((i: any) => i.id === 'REQ-IMPORT').metadata.task_bindings;
  expect(orderedBindings).toHaveLength(3); expect(orderedBindings[1].task.task_id).toBeNull();
  expect(orderedOffline.items.find((i: any) => i.id === 'AS-BASE').metadata.verification).toBe('pass-reported');
  expect(orderedOffline.items.find((i: any) => i.id === 'CHG-ORDER').metadata.deltas[0].before).toBe('A、B、C');
  const blocked = 'docs/dist/PLAN.md';
  fs.writeFileSync(manifestPath, stringify({ ...read.manifest, managed_paths: [...read.manifest.managed_paths, blocked] }));
  const blockedInstalled = attempt('read', {});
  expect(blockedInstalled.exit).toBe(1); expect(blockedInstalled.result.coverage.complete).toBe(false);
  expect(blockedInstalled.result.coverage.omitted).toContain(blocked);
  expect(blockedInstalled.result.diagnostics.some((d: any) => d.code === 'IMPLICIT_PATH_EXCLUDED' && d.path === blocked)).toBe(true);
  fs.writeFileSync(manifestPath, stringify(read.manifest));
  const offlineEntryPath = path.join(offline, '.workflow-system/PRODUCT.yaml');
  fs.writeFileSync(offlineEntryPath, stringify({ ...read.manifest, managed_paths: [...read.manifest.managed_paths, blocked] }));
  const blockedConsumer = spawnSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' });
  expect(blockedConsumer.status).toBe(1); expect(JSON.parse(blockedConsumer.stdout).coverage.omitted).toContain(blocked);
  fs.writeFileSync(offlineEntryPath, stringify(read.manifest));
  // Consume the exact installed samples through both Node entrypoints, without a task service.
  for (const variant of ['no-plan', 'multiple-plans']) {
    const planning = fs.mkdtempSync(path.join(os.tmpdir(), 'product-planning-offline-')); roots.push(planning);
    fs.cpSync(path.join(support, 'examples/planning', variant), planning, { recursive: true });
    const reader = path.join(planning, 'offline-reader.mjs'); fs.copyFileSync(path.join(support, 'offline-reader.js'), reader);
    const requirementBytes = fs.readFileSync(path.join(planning, 'docs/product/REQUIREMENTS.md'));
    const invokePlanning = (input: any = {}) => {
      const child = spawnSync('node', [helper, 'read', '--root', planning], { encoding: 'utf8', input: JSON.stringify(input) });
      return { exit: child.status, result: JSON.parse(child.stdout) };
    };
    const installedRead = invokePlanning({ detail: 'items' }); expect(installedRead.exit).toBe(0);
    const consumer = JSON.parse(execFileSync('node', [reader, planning], { encoding: 'utf8' }));
    const content = (items: any[]) => items.map(item => ({ id: item.id, metadata: item.metadata, body: item.body }));
    expect(content(consumer.items)).toEqual(content(installedRead.result.usable_items));
    expect(consumer.plan_tasks).toEqual(installedRead.result.plan_tasks);
    expect(consumer.items.filter((item: any) => item.type === 'requirement').map((item: any) => item.metadata.scope)).toEqual(['current', 'current', 'planned', 'candidate', 'retired']);
    expect(consumer.items.find((item: any) => item.id === 'PROJECT-SELECT').metadata.inventory.state).toBe('partial');
    expect(consumer.items.find((item: any) => item.id === 'AS-BASE').metadata.pending_sources).toHaveLength(1);
    expect(consumer.diagnostics.map((d: any) => d.code).sort()).toEqual(['BINDING_CONTRIBUTION_UNCLASSIFIED', 'DEFINITION_UNKNOWN', 'PENDING_SOURCES']);
    expect(consumer.task_states).toContain('not-computed'); expect(installedRead.result.task_status).toContain('not-computed');
    if (variant === 'no-plan') {
      expect(consumer.plan_tasks).toEqual([]); expect(consumer.items.some((item: any) => item.type === 'plan')).toBe(false);
      expect(consumer.items.find((item: any) => item.id === 'PROJECT-SELECT').body).toContain('### 本轮选取与未决事项');
    } else {
      expect(consumer.items.filter((item: any) => item.type === 'plan').map((item: any) => [item.id, item.metadata.intent_state])).toEqual([['PLAN-EXPORT', 'proposed'], ['PLAN-IMPORT', 'adopted'], ['PLAN-LEGACY', 'retired']]);
      const work = consumer.items.find((item: any) => item.id === 'PLAN-IMPORT').metadata.work_items;
      expect(work.map((item: any) => item.id)).toEqual(['W-VERIFY', 'W-BASE', 'W-RELEASE']);
      expect(work.map((item: any) => item.stage)).toEqual(['近期核对', '近期实施', '后续交付']);
      expect(work.flatMap((item: any) => item.targets).map((target: any) => target.target)).toEqual(['REQ-IMPORT', 'REQ-IMPORT', 'REQ-IMPORT']);
      expect(work[0].depends_on).toBeUndefined(); expect(work[1].depends_on).toBeUndefined();
    }
    const selectedRead = invokePlanning({ paths: ['docs/product/REQUIREMENTS.md'], detail: 'items' });
    expect(selectedRead.exit).toBe(0); expect(selectedRead.result.coverage.paths).toEqual(['docs/product/REQUIREMENTS.md']);
    expect(selectedRead.result.usable_items.every((item: any) => item.type === 'requirement')).toBe(true);
    fs.writeFileSync(path.join(planning, '.workflow-system/PRODUCT.yaml'), stringify({ ...installedRead.result.manifest, managed_paths: [...installedRead.result.manifest.managed_paths, 'docs/product/UNREAD.md'] }));
    const partialNode = invokePlanning({ detail: 'items' }); expect(partialNode.exit).toBe(1); expect(partialNode.result.coverage.complete).toBe(false);
    const partialReader = spawnSync('node', [reader, planning], { encoding: 'utf8' }), partialConsumer = JSON.parse(partialReader.stdout);
    expect(partialReader.status).toBe(1); expect(partialConsumer.coverage.complete).toBe(false);
    expect(partialConsumer.coverage.omitted).toEqual(['docs/product/UNREAD.md']);
    expect(content(partialConsumer.items)).toEqual(content(consumer.items));
    expect(fs.readFileSync(path.join(planning, 'docs/product/REQUIREMENTS.md'))).toEqual(requirementBytes);
    for (const absent of ['.workflow-system/runtime', '.workflow-system/records', 'node_modules']) expect(fs.existsSync(path.join(planning, absent))).toBe(false);
  }
  fs.copyFileSync(appendFile, path.join(offline, appendPath));
  const offlineAppend = JSON.parse(execFileSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' }));
  expect(offlineAppend.items.map((i: any) => i.id)).toContain('REQ-ADDED'); expect(offlineAppend.diagnostics.some((d: any) => d.item_id === 'REQ-KEEP' && d.severity === 'error')).toBe(true);
  fs.copyFileSync(htmlFile, path.join(offline, htmlPath)); fs.copyFileSync(closingFile, path.join(offline, closingPath));
  const offlineD = JSON.parse(execFileSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' }));
  expect(offlineD.items.map((i: any) => i.id)).toContain('REQ-AFTER-HTML');
  expect(offlineD.items.find((i: any) => i.id === 'REQ-C-P2').metadata.links).toEqual(duplicates);
  expect(offlineD.diagnostics.some((d: any) => d.code === 'DUPLICATE_LINK_ID')).toBe(true);
  fs.copyFileSync(syntaxFile, path.join(offline, syntaxPath)); fs.copyFileSync(historyFile, path.join(offline, historyPath));
  const offlineReview = JSON.parse(execFileSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' }));
  expect(offlineReview.items.map((i: any) => i.id)).toContain('REQ-REVIEW-SYNTAX');
  expect(offlineReview.diagnostics.some((d: any) => d.item_id === 'REQ-REVIEW-KEEP' && d.severity === 'error')).toBe(true);
  expect(offlineReview.items.find((i: any) => i.id === 'REQ-REVIEW-HISTORY').metadata.task_bindings).toEqual(parseProduct(fs.readFileSync(historyFile, 'utf8'), historyPath).items[0]!.metadata.task_bindings);
  // The same coverage gap survives a runtime-free consumer, including a real Windows junction.
  const offlineManifest = path.join(offline, '.workflow-system/PRODUCT.yaml');
  const selectedManifest = { ...read.manifest, managed_paths: ['docs/product/**.md'] }; fs.writeFileSync(offlineManifest, stringify(selectedManifest));
  fs.mkdirSync(path.join(offline, 'docs/product/nested'), { recursive: true }); fs.copyFileSync(path.join(root, deepPath), path.join(offline, deepPath));
  const inlineGlob = JSON.parse(execFileSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' }));
  expect(inlineGlob.coverage.complete).toBe(true); expect(inlineGlob.items.map((i: any) => i.id)).toContain('REQ-DEEP');
  const offlineScope = () => { const child = spawnSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' }); return { exit: child.status, result: JSON.parse(child.stdout) }; };
  fs.writeFileSync(offlineManifest, stringify({ ...selectedManifest, managed_paths: ['docs/product/**.md', registeredMissing] }));
  const offlineMissing = offlineScope(); expect(offlineMissing.exit).toBe(1); expect(offlineMissing.result.coverage.omitted).toEqual([registeredMissing]); expect(offlineMissing.result.items.map((i: any) => i.id)).toContain('REQ-IMPORT');
  fs.writeFileSync(path.join(offline, globPrefix), '离线普通文件，不能冒充 glob 目录'); fs.writeFileSync(offlineManifest, stringify(prefixManifest));
  const offlinePrefix = offlineScope(); expect(offlinePrefix.exit).toBe(1); expect(offlinePrefix.result.coverage.complete).toBe(false); expect(offlinePrefix.result.coverage.omitted).toEqual([globPrefix]);
  expect(offlinePrefix.result.diagnostics.some((d: any) => d.code === 'PATH_UNAVAILABLE' && d.path === globPrefix)).toBe(true);
  fs.writeFileSync(offlineManifest, stringify(selectedManifest)); const ordinaryPrefix = offlineScope(); expect(ordinaryPrefix.exit).toBe(0); expect(ordinaryPrefix.result.coverage.complete).toBe(true);
  const linkTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-link-')); roots.push(linkTarget);
  fs.symlinkSync(linkTarget, path.join(offline, 'docs/product/junction'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.unlinkSync(path.join(offline, 'docs/product/PROJECT.md'));
  const omitted = spawnSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' });
  const partial = JSON.parse(omitted.stdout); expect(omitted.status).toBe(1); expect(partial.coverage.complete).toBe(false); expect(partial.coverage.omitted).toContain('docs/product/PROJECT.md'); expect(partial.coverage.omitted).toContain('docs/product/junction'); expect(partial.items.map((i: any) => i.id)).toContain('REQ-IMPORT');
  fs.mkdirSync(path.join(offline, 'docs/product/PROJECT.md'));
  const directoryRead = spawnSync('node', [path.join(offline, 'offline-reader.mjs'), offline], { encoding: 'utf8' });
  const directoryResult = JSON.parse(directoryRead.stdout); expect(directoryRead.status).toBe(1); expect(directoryResult.coverage.omitted).toContain('docs/product/PROJECT.md');
  expect(directoryResult.diagnostics.some((d: any) => d.code === 'PATH_UNAVAILABLE' && d.path === 'docs/product/PROJECT.md' && d.message.includes('directory'))).toBe(true);
});

test('installed v5 contribution helper, templates, shared guidance and offline reader survive a mixed-version round trip', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contribution-installed-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"binding-install-fixture","private":true,"type":"module"}\n');
  expect(installDistribution({ targetRoot: root, packageRoot }).status).toBe('installed');
  const support = path.join(root, '.workflow-system/runtime/support/product-maintenance');
  const helper = path.join(root, '.workflow-system/runtime/support/product-maintenance.js');
  for (const asset of ['schemas/product-doc-v4.json', 'schemas/product-doc-v5.json', 'references/binding-contribution.md']) {
    expect(fs.readFileSync(path.join(support, asset))).toEqual(fs.readFileSync(path.resolve(import.meta.dir, '../runtime/vnext/support/product-maintenance', asset)));
  }
  expect(parseProduct(fs.readFileSync(path.join(support, 'templates/REQUIREMENTS.md'), 'utf8'), 'template.md').version).toBe(5);
  expect(parseProduct(fs.readFileSync(path.join(support, 'templates/GOAL.md'), 'utf8'), 'template.md').version).toBe(5);
  for (const entry of ['prepare-task', 'maintain-project', 'close-task', 'review-change']) {
    expect(fs.readFileSync(path.join(root, `.agents/skills/${entry}/SKILL.md`), 'utf8')).toContain('binding-contribution.md');
  }
  const example = path.join(support, 'examples/planning/reordered');
  fs.cpSync(path.join(example, 'docs'), path.join(root, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(example, '.workflow-system/PRODUCT.yaml'), path.join(root, '.workflow-system/PRODUCT.yaml'));
  const invoke = (action: string, input: any = {}) => JSON.parse(execFileSync('node', [helper, action, '--root', root], { input: JSON.stringify(input), encoding: 'utf8' }));
  const file = 'docs/product/REQUIREMENTS.md', before = fs.readFileSync(path.join(root, file), 'utf8');
  const req = parseProduct(before, file).items.find(i => i.id === 'REQ-IMPORT')!;
  const rows = req.metadata.task_bindings.map((row: any, index: number) => index ? row : { ...row, contribution: 'direct', reason: '示例真实采用范围直接覆盖单设备有效输入子义务；其余不在本次范围', sources: [{ kind: 'text', label: '合成安装复核', text: '仅在虚构安装夹具中核对原Task范围及当前需求，不是实际项目验收。' }] });
  const saved = invoke('apply', { files: [{ path: file, expected_sha256: sha256(before), migrate: 'v5', updates: [{ id: req.id, metadata: { task_bindings: rows } }] }] });
  expect(saved.status).toBe('saved'); expect(saved.files[0].preimage.data_base64).toBe(Buffer.from(before).toString('base64'));
  const read = invoke('read', { detail: 'items' });
  expect(read.usable_items.find((i: any) => i.id === req.id).metadata.task_bindings[0].contribution).toBe('direct');
  expect(read.usable_items.find((i: any) => i.id === req.id).metadata.task_bindings[1].contribution).toBeUndefined();
  const binding = read.plan_tasks.find((p: any) => p.plan_id === 'PLAN-LOCAL').work_items.flatMap((w: any) => w.bindings).find((b: any) => b.binding_id === rows[0].id);
  // Historical records without plan_items remain independent; missing an explicit
  // WorkItem reference must not cause the installer/helper to invent one.
  if (rows[0].plan_items?.length) expect(binding.contribution).toBe('direct'); else expect(binding).toBeUndefined();
  const bytes = fs.readFileSync(path.join(root, file));
  expect(invoke('apply', { files: [{ path: file, expected_sha256: sha256(bytes), updates: [{ id: req.id, metadata: { task_bindings: rows } }] }] }).files[0].status).toBe('unchanged');
  const offline = JSON.parse(execFileSync('node', [path.join(support, 'offline-reader.js'), root], { encoding: 'utf8' }));
  expect(offline.contract).toBe('vnext-product-doc/v6'); expect(offline.supported_formats).toContain('vnext-product-doc/v5'); expect(offline.items.find((i: any) => i.id === req.id).metadata.task_bindings).toEqual(rows);
  expect(fs.readFileSync(path.join(root, file))).toEqual(bytes); expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('installed v6 Node helper reuses an exact local disposition without rewriting pending history', { timeout: 45000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disposition-installed-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"disposition-install-fixture","private":true,"type":"module"}\n');
  expect(installDistribution({ targetRoot: root, packageRoot }).status).toBe('installed');
  const support = path.join(root, '.workflow-system/runtime/support/product-maintenance');
  expect(fs.readFileSync(path.join(support, 'schemas/product-doc-v6.json'))).toEqual(fs.readFileSync('runtime/vnext/support/product-maintenance/schemas/product-doc-v6.json'));
  fs.cpSync(path.join(support, 'examples/scoped/docs'), path.join(root, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(support, 'examples/scoped/.workflow-system/PRODUCT.yaml'), path.join(root, '.workflow-system/PRODUCT.yaml'));
  const helper = path.join(root, '.workflow-system/runtime/support/product-maintenance.js');
  const invoke = (action: string, input: any) => JSON.parse(execFileSync('node', [helper, action, '--root', root], { encoding: 'utf8', input: JSON.stringify(input) }));
  const file = 'docs/product/ASSESSMENTS.md', filename = path.join(root, file);
  const source = { kind: 'text', text: '合成职责调整不影响本范围已报成果。', label: '安装夹具，非业务事实' };
  const update = (metadata: any, migrate?: string) => invoke('apply', { files: [{ path: file, expected_sha256: sha256(fs.readFileSync(filename)), ...(migrate ? { migrate } : {}), updates: [{ id: 'A-DEMO', metadata }] }] });
  const query = { target: 'R-IMPORT', goal_id: 'G-DEMO', scope_id: 'FULL', subject: { kind: 'working-copy', value: 'sample-copy-a', revision: 'sample-baseline' } };
  expect(update({ pending_sources: [source] }, 'v6').status).toBe('saved');
  const before = invoke('read', { detail: 'items', assessment_query: query });
  expect(before.assessment_selection.reasons).toContain('pending-evidence');
  const report = before.usable_items.find((item: any) => item.id === 'A-DEMO');
  expect(update({ evidence_dispositions: [{ change_id: 'CHANGE-INSTALL', kind: 'scope-change', source, disposition: 'no-impact', checked_at: '2026-10-15T00:00:00Z', reason: '已按本合成范围核对，原成果保持；非真实业务认证。', basis: report.disposition_basis }] }).status).toBe('saved');
  const bytes = fs.readFileSync(filename);
  for (let read = 0; read < 2; read++) {
    const result = invoke('read', { detail: 'items', assessment_query: query });
    expect(result.assessment_selection.conclusion).toBe('satisfied');
    const saved = result.usable_items.find((item: any) => item.id === 'A-DEMO');
    expect(saved.metadata.pending_sources).toEqual([source]);
    expect(saved.pending_sources).toEqual([]);
    expect(saved.evidence_dispositions[0].reuse_status).toBe('reused');
    expect(fs.readFileSync(filename)).toEqual(bytes);
    expect(result.development_gate).toBe(false);
  }
});
