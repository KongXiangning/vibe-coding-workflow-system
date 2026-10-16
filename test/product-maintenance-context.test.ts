import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { run } from '../runtime/vnext/src/product-maintenance/cli';
import { deliver } from '../runtime/vnext/src/product-maintenance/presentation';
import { newDocument } from '../runtime/vnext/src/product-maintenance/writer';
import { sha256 } from '../runtime/vnext/src/product-maintenance/parser';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function put(root: string, file: string, value: string | Buffer): void { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); }
const file = 'docs/product/REQUIREMENTS.md';
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-compact-')); roots.push(root);
  put(root, '.workflow-system/PRODUCT.yaml', stringify({ schema: 'vnext-product-manifest/v2', project_id: 'compact', entry: 'docs/product/PROJECT.md', managed_paths: ['docs/product/*.md'], source_paths: ['docs/evidence/**'], capture_paths: ['docs/evidence/**'], exclude_paths: [], maintenance: 'enabled' }));
  put(root, 'docs/product/PROJECT.md', newDocument([{ metadata: { id: 'PROJECT-A', type: 'project', inventory: { state: 'partial', checked_sources: [], unreviewed_sources: [{ kind: 'text', text: 'external service unavailable', label: 'gap' }] } }, body: '## [PROJECT-A] Project\n### 项目定位\nProduct\n### 盘点范围与未核对项\nExternal service unread\n' }]));
  const items = Array.from({ length: 26 }, (_, i) => ({ metadata: { id: `REQ-${i}`, type: 'requirement', scope: 'current',
    task_bindings: Array.from({ length: i === 0 ? 25 : 1 }, (_, n) => ({ id: `B-${n}`, task: { task_id: n === 0 ? 'shared-task' : `task-${i}-${n}`, source: { kind: 'text', text: 'task source', label: 'task' } }, role: 'implementation', coverage: `range-${n}`, origin: 'declared', state: n === 24 ? 'dismissed' : 'active', reason: n === 24 ? 'retain historical refusal' : 'declared' })) },
    body: `## [REQ-${i}] Requirement ${i}\n### 需求内容\nRetry operation\n### 范围边界\n${i === 25 ? 'Never retry billing. Maximum two attempts.' : 'Independent operation.'}\n### 验收要求\n${i === 0 ? '中文😀边界\r\n'.repeat(1600) : 'Verify behavior.'}\n### 自定义约束\nPreserve end constraint ${i}.\n` }));
  put(root, file, newDocument(items)); return root;
}
const compact = (root: string, input: any = {}) => run('read', root, { presentation: 'compact', ...input });
function all(root: string, request: any): any {
  let output: any, first = true;
  while (request) {
    const result = run('read', root, request);
    expect(result.presentation_error).toBeUndefined(); expect(result.query_error).toBeUndefined();
    let value = result.value;
    function expand(value: any): any {
      if (value?.delivery === 'deferred') return all(root, value.detail_request);
      if (Array.isArray(value)) return value.map(expand);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
      return value;
    }
    value = expand(value);
    if (first) { output = value; first = false; }
    else if (typeof output === 'string') output += value;
    else if (Array.isArray(output)) output.push(...value);
    else Object.assign(output, value);
    request = result.pagination?.next_request;
  }
  return output;
}

test('compact unfolds to the original selected body, metadata and every derived collection without storage changes', () => {
  const root = fixture(), bytes = fs.readFileSync(path.join(root, file));
  const legacy = run('read', root, { item_ids: ['REQ-0'], detail: 'items' });
  for (const key of ['usable_items', 'unusable_items', 'manifest', 'documents', 'product_view', 'reverse_relations', 'plan_tasks', 'impact', 'sources', 'diagnostics', 'coverage']) {
    const req = { presentation: 'compact', item_ids: ['REQ-0'], query: { kind: 'collection', name: 'result', path: [key] } };
    expect(all(root, req)).toEqual(legacy[key]);
  }
  expect(fs.readFileSync(path.join(root, file))).toEqual(bytes);
  expect(fs.existsSync(path.join(root, '.workflow-system/records'))).toBe(false);
});

test('candidate directory and catalog continuation retain IDs, short reasons, seeds and version', () => {
  const root = fixture(); const first = compact(root, { query: { kind: 'item', item_id: 'REQ-0' } });
  expect(first.items.value[0].sections.some((s: any) => s.title.includes('自定义约束'))).toBe(true);
  let impact = first.impact; const ids: string[] = [];
  while (impact) {
    expect(impact.seeds).toEqual(['REQ-0']);
    ids.push(...impact.candidates.value.map((v: any) => v.id));
    expect(impact.candidates.value.every((v: any) => v.reason_kinds.length)).toBe(true);
    const request = impact.candidates.pagination.next_request;
    impact = request ? run('read', root, request).value : null;
  }
  expect(ids.length).toBe(26); expect(ids.at(-1)).toBe('REQ-25');
  let page = compact(root); const directory: string[] = [];
  while (page) { directory.push(...page.items.value.map((v: any) => v.id)); page = page.items.pagination.next_request ? run('read', root, page.items.pagination.next_request) : null; }
  expect(directory.length).toBe(27); expect(new Set(directory).size).toBe(27);
});

test('raw arrays retain dismissed history and missing is distinct from empty', () => {
  const root = fixture();
  const bindings = all(root, { presentation: 'compact', query: { kind: 'collection', name: 'task_bindings', owner_id: 'REQ-0' } });
  expect(bindings).toHaveLength(25); expect(bindings.at(-1).state).toBe('dismissed');
  expect(compact(root, { query: { kind: 'collection', name: 'links', owner_id: 'REQ-0' } }).value_present).toBe(false);
  expect(compact(root, { query: { kind: 'collection', name: 'result', path: ['sources'] } }).value).toEqual([]);
});

test('metadata-only and Manifest changes invalidate continuation; search finds an unlinked final obligation', () => {
  const root = fixture();
  const first = compact(root); const request = first.items.pagination.next_request;
  put(root, file, fs.readFileSync(path.join(root, file), 'utf8').replace('range-0', 'range-edited'));
  expect(run('read', root, request).query_error).toBe('QUERY_VERSION_CHANGED');
  const next = compact(root).items.pagination.next_request;
  put(root, '.workflow-system/PRODUCT.yaml', fs.readFileSync(path.join(root, '.workflow-system/PRODUCT.yaml'), 'utf8') + '\n# changed\n');
  expect(run('read', root, next).query_error).toBe('QUERY_VERSION_CHANGED');
  const found = compact(root, { query: { kind: 'search', text: 'billing', scope: 'managed' } });
  expect(found.search.matches.map((m: any) => m.id)).toEqual(['REQ-25']);
  expect(all(root, found.search.matches[0].detail_request)).toContain('Maximum two attempts');
});

test('source text paging preserves multibyte characters, CRLF, original SHA and rejects changing source', () => {
  const root = fixture(), text = '中文😀\r\n'.repeat(100);
  put(root, 'docs/evidence/text.txt', text);
  let request: any = { presentation: 'compact', source: { kind: 'file', path: 'docs/evidence/text.txt' }, max_bytes: 7 };
  let actual = ''; let first: any;
  while (request) { const result = run('read', root, request); first ??= result; expect(result.query_error).toBeUndefined(); expect(result.data_base64).toBeUndefined(); actual += result.text; request = result.next_request; }
  expect(actual).toBe(text); expect(first.actual_sha256).toBe(sha256(text));
  put(root, 'docs/evidence/text.txt', text + 'changed');
  expect(run('read', root, first.next_request).query_error).toBe('QUERY_VERSION_CHANGED');
  put(root, 'docs/evidence/binary', Buffer.from([255, 0, 128]));
  const binary = { presentation: 'compact', source: { kind: 'file', path: 'docs/evidence/binary' } };
  expect(run('read', root, binary).query_error).toContain('SOURCE_ENCODING');
  expect(run('read', root, { ...binary, encoding: 'base64' }).data_base64).toBe('/wCA');
});

for (const mode of ['inline', 'capture', 'conflict', 'outside', 'io', 'frozen', 'capture-frozen', 'unchanged', 'new', 'stale', 'partial'] as const) {
  test(`same-parameter write comparison: ${mode}`, () => {
    const root = fixture(), original = fs.readFileSync(path.join(root, file));
    const history = 'docs/evidence/original.md';
    const operation: any = { path: file, expected_sha256: sha256(original), updates: [{ id: 'REQ-0', metadata: { scope: mode === 'unchanged' ? 'current' : 'planned' } }] };
    if (mode !== 'inline' && mode !== 'stale') operation.preimage_path = history;
    if (mode === 'outside' || mode === 'new' || mode === 'unchanged') operation.preimage_path = 'outside/preimage';
    if (mode === 'conflict') put(root, history, 'different bytes');
    if (mode === 'io') fs.mkdirSync(path.join(root, history), { recursive: true });
    if (mode === 'capture-frozen') put(root, 'FREEZE_REGISTRY.md', '`docs/evidence/original.md`');
    if (mode === 'frozen') put(root, file, Buffer.concat([Buffer.from('<!-- @frozen -->\n'), original]));
    if (mode === 'new') { operation.path = 'docs/product/NEW.md'; operation.expected_sha256 = null; delete operation.updates; operation.content = newDocument([{ metadata: { id: 'REQ-NEW', type: 'requirement', scope: 'current' }, body: '## [REQ-NEW] New\n### 需求内容\nN\n### 范围边界\nS\n### 验收要求\nA\n' }]); }
    if (mode === 'stale') operation.expected_sha256 = '0'.repeat(64);
    const initial = fs.readFileSync(path.join(root, file));
    if (mode === 'frozen') operation.expected_sha256 = sha256(initial);
    const files = mode === 'partial' ? [operation, { path: 'docs/product/no.md', expected_sha256: '0'.repeat(64), content: 'no' }] : [operation];
    const legacy = run('apply', root, { files });
    const after = fs.readFileSync(path.join(root, operation.path));
    if (mode === 'new') fs.unlinkSync(path.join(root, operation.path)); else put(root, file, initial);
    if (mode === 'capture' || mode === 'partial') fs.unlinkSync(path.join(root, history));
    const shown = run('apply', root, { presentation: 'compact', files });
    const { presentation_contract, ...receipt } = shown;
    expect(receipt).toEqual(legacy); expect(fs.readFileSync(path.join(root, operation.path))).toEqual(after);
    if (mode === 'inline') expect(Buffer.from(shown.files[0].preimage.data_base64, 'base64')).toEqual(original);
    if (mode === 'capture') expect(fs.readFileSync(path.join(root, history))).toEqual(original);
    if (['conflict', 'outside', 'io', 'frozen', 'capture-frozen', 'stale'].includes(mode)) expect(shown.status).toBe('failed');
    if (mode === 'partial') expect(shown.status).toBe('partial');
  });
}

test('post-save rendering/serialization failures retain raw receipt and unknown delivery is read back without replay', () => {
  const root = fixture(), original = fs.readFileSync(path.join(root, file));
  const saved = run('apply', root, { files: [{ path: file, expected_sha256: sha256(original), updates: [{ id: 'REQ-0', metadata: { scope: 'planned' } }] }] });
  const after = fs.readFileSync(path.join(root, file));
  for (const render of [() => { throw new Error('injected renderer'); }, () => ({ impossible: 1n })]) {
    const delivered = deliver(saved, render);
    expect(delivered.status).toBe('saved'); expect(delivered.files).toEqual(saved.files); expect(delivered.presentation_error).toBeDefined();
    expect(Buffer.from(delivered.files[0].preimage.data_base64, 'base64')).toEqual(original);
    expect(fs.readFileSync(path.join(root, file))).toEqual(after);
  }
  // Simulate a lost response: only a read is performed, not apply with stale inputs.
  const check = compact(root, { query: { kind: 'item', item_id: 'REQ-0' } });
  expect(check.items.value[0].scope).toBe('planned'); expect(fs.readFileSync(path.join(root, file))).toEqual(after);
});

test('ambiguous read selectors and read fields on mutations cannot execute writes', () => {
  const root = fixture();
  expect(compact(root, { item_ids: ['REQ-1'], query: { kind: 'item', item_id: 'REQ-0' } }).error).toContain('QUERY_AMBIGUOUS');
  const bytes = fs.readFileSync(path.join(root, file));
  expect(run('apply', root, { presentation: 'compact', query: { kind: 'catalog' }, files: [{ path: file, expected_sha256: sha256(bytes), content: 'bad' }] }).error).toContain('READ_QUERY_ONLY');
  expect(fs.readFileSync(path.join(root, file))).toEqual(bytes);
});


test('compact explicit assessment and roadmap selections unfold to the original judgments', () => {
  for (const [example, selection, field] of [
    ['scoped', { assessment_query: { target: 'R-IMPORT', goal_id: 'G-DEMO', scope_id: 'FULL', subject: { kind: 'working-copy', value: 'sample-copy-a', revision: 'sample-baseline' } } }, 'assessment_selection'],
    ['roadmap', { roadmap_query: { plan_id: 'PLAN-PERMISSIONS' } }, 'roadmap_reconciliation'],
  ] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-judgment-')); roots.push(root);
    fs.cpSync(path.resolve('runtime/vnext/support/product-maintenance/examples', example), root, { recursive: true });
    const original = run('read', root, selection);
    const request = { presentation: 'compact', ...selection, query: { kind: 'collection', name: 'result', path: [field] } };
    expect(all(root, request)).toEqual(original[field]);
    const shown = compact(root, selection);
    expect(shown[field].status).toBe(original[field].status);
    expect(shown[field].reasons).toEqual(original[field].reasons);
    if (example === 'scoped') {
      const report = run('read', root, {item_ids:['A-DEMO']}).usable_items[0];
      const projected = compact(root, {query:{kind:'item',item_id:'A-DEMO'}}).items.value[0];
      expect(report.metadata.applicability).toBeDefined();
      expect(projected.applicability).toEqual(report.metadata.applicability);
      expect(projected.subject).toEqual(report.metadata.subject);
    }
  }
});


test('large inventory keeps its state and unread count visible; tiny display budgets keep selected identity', () => {
  const root = fixture();
  const projectPath = path.join(root, 'docs/product/PROJECT.md');
  const project = run('read', root, { item_ids: ['PROJECT-A'], detail: 'items' }).usable_items[0];
  const inventory = { ...project.metadata.inventory, unreviewed_sources: Array.from({length:100}, (_,i) => ({kind:'text',label:String(i),text:'unread '.repeat(100)})) };
  fs.writeFileSync(projectPath, newDocument([{ metadata: {...project.metadata, inventory}, body: project.body }]));
  const shown = compact(root, { query: {kind:'item',item_id:'REQ-0'}, page:{max_bytes:256} });
  expect(shown.project_context[0].inventory.state).toBe('partial');
  expect(shown.project_context[0].inventory.unreviewed_sources.total).toBe(100);
  expect(shown.items.value[0].id).toBe('REQ-0');
  expect(shown.items.value[0].sections.some((s:any)=>s.title.includes('自定义约束'))).toBe(true);
});


test('unpaired metadata code units remain lossless and malformed selectors do not trigger full response fallback', () => {
  const root = fixture(); const legacy = run('read', root, {detail:'items',item_ids:['REQ-0']}).usable_items[0];
  const unusual = String.fromCharCode(0xd800).repeat(5000);
  fs.writeFileSync(path.join(root,file),newDocument([{metadata:{...legacy.metadata,extensions:{unusual}},body:legacy.body}]));
  expect(all(root,{presentation:'compact',item_ids:['REQ-0'],query:{kind:'collection',name:'result',path:['usable_items','0','metadata','extensions','unusual']}})).toBe(unusual);
  for(const request of [{query:{kind:'collection',name:'result',path:[]}}, {query:{kind:'collection',name:'body'}}, {encoding:'text'}]) {
    const result=compact(root,request); expect(result.status).toBe('failed'); expect(result.usable_items).toBeUndefined();
  }
});


test('capture and candidate check keep identical factual receipts for the same parameters', () => {
  const root=fixture(); const input={path:'docs/evidence/captured.txt',text:'exact original 中文'};
  const legacy=run('capture',root,input); fs.unlinkSync(path.join(root,input.path));
  const {presentation_contract,...compactCapture}=run('capture',root,{...input,presentation:'compact'});
  expect(compactCapture).toEqual(legacy);
  expect(fs.readFileSync(path.join(root,input.path),'utf8')).toBe(input.text);
  for(const attempt of [input,{...input,text:'conflicting bytes'},{...input,path:'outside/raw.txt'}]) {
    const a=run('capture',root,attempt); const {presentation_contract,...b}=run('capture',root,{...attempt,presentation:'compact'}); expect(b).toEqual(a);
  }
  const candidate={path:file,content:fs.readFileSync(path.join(root,file),'utf8')};
  const before=run('check',root,candidate);const {presentation_contract:contract,...after}=run('check',root,{...candidate,presentation:'compact'});
  expect(after).toEqual(before);
});
