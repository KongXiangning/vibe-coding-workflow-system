import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { sha256 } from './parser';
import type { ObjectValue } from './model';

const markdown = unified().use(remarkParse);
const contract = 'product-context/v1';
const envelopeKeys = ['kind', 'action', 'status', 'development_gate', 'qualification', 'task_operations', 'error'];
const resultFields = new Set(['manifest', 'documents', 'usable_items', 'unusable_items', 'project_context', 'product_view', 'assessment_selection', 'roadmap_reconciliation', 'reverse_relations', 'plan_tasks', 'discussions', 'impact', 'sources', 'diagnostics', 'coverage']);

/** Validate presentation selectors before invoking any business operation. */
export function computationInput(action: string, input: ObjectValue): ObjectValue {
  const { presentation, query, page, expected_revision, encoding, ...original } = input;
  if (presentation !== 'compact') {
    if (query || page || expected_revision || encoding) throw new Error('COMPACT_REQUIRED: query, page, revision and encoding require compact presentation');
    return original;
  }
  if (action !== 'read') {
    if (query || page || expected_revision || encoding) throw new Error('READ_QUERY_ONLY: mutation/check cannot carry read selectors');
    return original;
  }
  if (input.source && query) throw new Error('QUERY_AMBIGUOUS: source and query cannot be combined');
  if (input.source && page) throw new Error('QUERY_AMBIGUOUS: source uses offset/max_bytes, not collection page');
  if (encoding && !input.source) throw new Error('QUERY_AMBIGUOUS: encoding applies only to explicit source reads');
  if (query) {
    const allowed: Record<string, string[]> = {
      catalog: ['kind'], item: ['kind', 'item_id'], collection: ['kind', 'name', 'owner_id', 'path'],
      search: ['kind', 'text', 'scope'], assessment: ['kind'], roadmap: ['kind'],
    };
    if (Object.keys(query).some(key => !allowed[query.kind]?.includes(key))) throw new Error('QUERY_AMBIGUOUS: fields do not belong to this query kind');
    if ((query.kind === 'item' && !query.item_id) || (query.kind === 'collection' && !query.name) || (query.kind === 'search' && !query.text)) throw new Error('QUERY_INPUT: query requires its selector');
    const owner = query.item_id ?? query.owner_id;
    if (owner) {
      if (input.item_ids && (input.item_ids.length !== 1 || input.item_ids[0] !== owner)) throw new Error('QUERY_AMBIGUOUS: item_ids and query owner differ');
      original.item_ids = [owner];
    }
    if ((query.kind === 'assessment' && !input.assessment_query) || (query.kind === 'roadmap' && !input.roadmap_query)) throw new Error('QUERY_INPUT: explicit assessment_query/roadmap_query is required');
    if (query.kind === 'collection' && query.name !== 'result' && query.path) throw new Error('QUERY_AMBIGUOUS: path only addresses result collections');
    if (query.name === 'result' && query.owner_id) throw new Error('QUERY_AMBIGUOUS: result paths retain item_ids, not a new owner');
    if (query.name === 'result' && (!query.path?.length || !resultFields.has(query.path[0]))) throw new Error('QUERY_PATH: select an exposed result field');
    if (['metadata', 'body', 'links', 'task_bindings', 'work_items'].includes(query.name) && !query.owner_id) throw new Error('QUERY_OWNER: this original field requires owner_id');
  }
  if (!input.source) original.detail = 'items';
  // Read a few extra bytes to finish a UTF-8 character, without altering legacy reads.
  if (input.source && encoding !== 'base64') original.max_bytes = Math.min(input.max_bytes ?? 65536, 1048573) + 3;
  return original;
}

function at(value: any, keys: string[]): { present: boolean; value: any } {
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return { present: false, value: undefined };
    value = value[key];
  }
  return { present: true, value };
}
function utf8Page(text: string, offset: number, max: number): { text: string; end: number; total: number } {
  const bytes = Buffer.from(text);
  if (offset > bytes.length || offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) throw new Error('PAGE_OFFSET: offset must be a UTF-8 boundary within the value');
  let end = Math.min(bytes.length, offset + max);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, end)), end, total: bytes.length };
}
function sections(body: string): ObjectValue[] {
  return markdown.parse(body).children.filter((node: any) => node.type === 'heading').map((node: any) => ({
    depth: node.depth, title: body.slice(node.position.start.offset, node.position.end.offset),
    byte_offset: Buffer.byteLength(body.slice(0, node.position.start.offset)),
  }));
}

/** Only operates on an already computed result. Never reads or writes a file. */
export function present(result: ObjectValue, input: ObjectValue, computed: ObjectValue): ObjectValue {
  if (result.action !== 'read' || !result.documents && !input.source) return { ...result, presentation_contract: contract };
  if (input.source) return presentSource(result, input);
  const { read_at, ...versioned } = result;
  const revision = sha256(JSON.stringify(versioned));
  const base = { ...computed, presentation: 'compact' };
  const request = (keys: string[], page: ObjectValue = {}): ObjectValue => ({ ...base, query: { kind: 'collection', name: 'result', path: keys }, expected_revision: revision, page });
  const restart = { ...input }; delete restart.expected_revision; delete restart.page;
  const header = Object.fromEntries(envelopeKeys.filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]]));
  const common = { ...header, presentation_contract: contract, working_copy: result.working_copy, project_id: result.project_id,
    revision, read_at, projection: true, coverage: result.coverage,
    completeness: { computation: 'original algorithms and requested bounds', delivery: 'see each page/deferred field', semantic_review: 'not-certified' } };
  if (input.expected_revision && input.expected_revision !== revision) return { ...common, query_error: 'QUERY_VERSION_CHANGED', selection: 'unresolved', restart_request: restart };
  // Leave room for the envelope, independent impact page and formatted CLI JSON.
  const max = input.page?.max_bytes ?? 12288;
  const limit = input.page?.limit ?? 20;
  const offset = input.page?.offset ?? 0;
  function deferred(value: any, keys: string[]): ObjectValue {
    const descriptor: ObjectValue = { delivery: 'deferred', value_type: Array.isArray(value) ? 'array' : typeof value, detail_request: request(keys) };
    if (Array.isArray(value)) descriptor.total = value.length;
    else if (typeof value === 'string') descriptor.bytes = Buffer.byteLength(value);
    else {
      descriptor.fields = Object.keys(value).length;
      const visible = ['id', 'type', 'status', 'state', 'conclusion', 'reason', 'reasons', 'scope', 'target', 'goal_id', 'scope_id'];
      descriptor.summary = Object.fromEntries(visible.filter(key => Object.hasOwn(value, key) && Buffer.byteLength(JSON.stringify(value[key])) < 4096).map(key => [key, value[key]]));
    }
    return descriptor;
  }
  function project(value: any, keys: string[], budget = 4096): any {
    if (value === null || typeof value !== 'object' && typeof value !== 'string') return value;
    if (typeof value === 'string') return Buffer.byteLength(value) <= budget ? value : { ...deferred(value, keys), preview: utf8Page(value, 0, Math.min(256, budget)).text };
    if (Array.isArray(value)) return value.every(child => child === null || typeof child !== 'object') && Buffer.byteLength(JSON.stringify(value)) <= budget ? value : deferred(value, keys);
    if (Buffer.byteLength(JSON.stringify(value)) > budget * 4) return deferred(value, keys);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, project(child, [...keys, key], budget)]));
  }
  function pageValue(value: any, keys: string[], mapper = project): ObjectValue {
    if (typeof value === 'string') {
      if (Buffer.from(value).toString('utf8') !== value) return { value, value_type: 'string', pagination: null,
        presentation_note: 'Unpaired Unicode code units retained as an exact JSON string; UTF-8 byte paging is not lossless for this value.' };
      const chunk = utf8Page(value, offset, max);
      return { value: chunk.text, value_type: 'string', pagination: { unit: 'utf8-bytes', offset, end: chunk.end, total: chunk.total,
        next_request: chunk.end < chunk.total ? request(keys, { ...input.page, offset: chunk.end }) : null } };
    }
    if (!Array.isArray(value) && (value === null || typeof value !== 'object')) return { value, pagination: null };
    const members = Array.isArray(value) ? value.map((child, i) => [String(i), child] as const) : Object.entries(value);
    if (offset > members.length) throw new Error('PAGE_OFFSET: offset exceeds collection');
    const entries: [string, any][] = []; let used = 0;
    function renderedSize(shown: any): number {
      const text = JSON.stringify(shown, null, 2);
      return Buffer.byteLength(text) + text.split('\n').length * 8;
    }
    for (let i = offset; i < members.length && entries.length < limit; i++) {
      const [key, child] = members[i]!;
      let shown = mapper(child, [...keys, key]);
      let size = renderedSize(shown);
      if (mapper === project && size > max && child !== null && typeof child === 'object') { shown = deferred(child, [...keys, key]); size = renderedSize(shown); }
      if (entries.length && used + size > max) break;
      entries.push([key, shown]); used += size;
    }
    const end = offset + entries.length;
    return { value: Array.isArray(value) ? entries.map(entry => entry[1]) : Object.fromEntries(entries), value_type: Array.isArray(value) ? 'array' : 'object',
      pagination: { unit: Array.isArray(value) ? 'members' : 'fields', offset, end, total: members.length,
        next_request: end < members.length ? request(keys, { ...input.page, offset: end }) : null } };
  }
  function itemSummary(item: ObjectValue, keys: string[]): ObjectValue {
    const metadata = item.metadata ?? {};
    const value: ObjectValue = { id: item.id, type: item.type, title: project(item.title, [...keys, 'title']), path: item.path, line: item.line,
      definition_sha256: item.definition_sha256, locator: item.locator, detail_request: request(keys), metadata: deferred(metadata, [...keys, 'metadata']) };
    for (const key of ['scope', 'inventory', 'target', 'goal_id', 'scope_id', 'applicability', 'subject', 'conclusion', 'implementation', 'verification', 'reason', 'checked_at', 'intent_state']) {
      if (Object.hasOwn(metadata, key)) value[key] = project(metadata[key], [...keys, 'metadata', key]);
    }
    const parents = (metadata.links ?? []).filter((link: ObjectValue) => link.origin === 'declared' && ['part_of', 'supports'].includes(link.relation));
    value.declared_parents = parents.map((link: ObjectValue) => ({ id: link.id, target: link.target, relation: link.relation, state: link.state }));
    if (input.item_ids || computed.item_ids) {
      value.sections = sections(item.body ?? '');
      value.body = project(item.body ?? '', [...keys, 'body'], 4096);
      for (const [key, child] of Object.entries(item)) if (!['metadata', 'body', 'title'].includes(key) && !(key in value)) value[key] = project(child, [...keys, key]);
    }
    return value;
  }
  function impactSummary(impact: ObjectValue): ObjectValue {
    const candidates = impact.candidates ?? [];
    const directory = pageValue(candidates, ['impact', 'candidates'], (candidate, keys) => ({ id: candidate.id, type: candidate.type, title: project(candidate.title, [...keys, 'title']),
      path: candidate.path, reason_kinds: [...new Set(candidate.reasons.map((r: ObjectValue) => r.kind))], reasons: project(candidate.reasons, [...keys, 'reasons']), detail_request: request(keys) }));
    if (directory.pagination.next_request) directory.pagination.next_request = { ...base, query: { kind: 'collection', name: 'impact' }, expected_revision: revision, page: { ...input.page, offset: directory.pagination.end } };
    return { ...impact, candidates: directory, directory_complete: directory.pagination.next_request === null && offset === 0 };
  }
  const diagnostics = result.diagnostics ?? [];
  const groups: Record<string, number> = {};
  for (const d of diagnostics) { const key = `${d.severity}:${d.code}`; groups[key] = (groups[key] ?? 0) + 1; }
  const notices = { project_context: (result.project_context ?? []).map((item: ObjectValue, index: number) => ({ id: item.id, path: item.path, usable: item.usable,
    inventory: item.metadata.inventory ? Object.fromEntries(Object.entries(item.metadata.inventory).map(([key, value]) => [key, project(value, ['project_context', String(index), 'metadata', 'inventory', key])])) : null,
    detail_request: request(['project_context', String(index)]) })),
    diagnostics: { total: diagnostics.length, categories: groups, detail_request: request(['diagnostics']),
    selected: diagnostics.filter((d: ObjectValue) => computed.item_ids?.includes(d.item_id)).map((d: ObjectValue) => ({ ...d })) },
    assessment_selection: project(result.assessment_selection, ['assessment_selection'], 65536),
    roadmap_reconciliation: project(result.roadmap_reconciliation, ['roadmap_reconciliation'], 65536) };
  const query = input.query ?? { kind: computed.item_ids ? 'item' : 'catalog' };
  if (query.kind === 'search') {
    const matches: ObjectValue[] = [];
    for (const [index, item] of result.usable_items.entries()) {
      const text = item.body ?? ''; let start = 0;
      while ((start = text.indexOf(query.text, start)) !== -1) {
        matches.push({ id: item.id, path: item.path, byte_offset: Buffer.byteLength(text.slice(0, start)),
          excerpt: text.slice(Math.max(0, start - 60), start + query.text.length + 100), detail_request: request(['usable_items', String(index), 'body']) });
        start += Math.max(1, query.text.length);
      }
    }
    const selected = matches.slice(offset, offset + limit);
    return { ...common, ...notices, search: { text: query.text, scope: 'selected managed usable item bodies, including headings', total: matches.length, matches: selected,
      next_request: offset + selected.length < matches.length ? { ...input, expected_revision: revision, page: { ...input.page, offset: offset + selected.length } } : null,
      limitation: 'No match does not prove no impact; unregistered sources and invalid items are not searched.' } };
  }
  if (query.kind === 'collection' || query.kind === 'assessment' || query.kind === 'roadmap') {
    let keys: string[];
    if (query.kind === 'assessment') keys = ['assessment_selection'];
    else if (query.kind === 'roadmap') keys = ['roadmap_reconciliation'];
    else if (query.name === 'result') {
      keys = query.path ?? [];
      if (!keys.length || !resultFields.has(keys[0]!)) throw new Error('QUERY_PATH: select an exposed result field');
    } else if (['metadata', 'body', 'links', 'task_bindings', 'sources', 'work_items'].includes(query.name) && query.owner_id) {
      const index = result.usable_items.findIndex((item: ObjectValue) => item.id === query.owner_id);
      if (index < 0) return { ...common, ...notices, selection: 'unresolved', value_present: false };
      keys = ['usable_items', String(index), ...(query.name === 'body' || query.name === 'metadata' ? [query.name] : ['metadata', query.name])];
    } else {
      const names: Record<string, string> = { impact: 'impact', relations: 'reverse_relations', diagnostics: 'diagnostics', product_view: 'product_view', plan_tasks: 'plan_tasks', discussions: 'discussions', sources: 'sources' };
      if (!names[query.name]) throw new Error('QUERY_OWNER: this original field requires owner_id');
      keys = [names[query.name]!];
    }
    const selected = at(result, keys);
    if (!selected.present) return { ...common, ...notices, selection: 'missing-field', value_present: false, path: keys };
    if (query.name === 'impact' && selected.value) return { ...common, ...notices, value_present: true, value: impactSummary(selected.value) };
    return { ...common, ...notices, value_present: true, path: keys, ...pageValue(selected.value, keys) };
  }
  const items = pageValue(result.usable_items, ['usable_items'], itemSummary);
  if (items.pagination.next_request) items.pagination.next_request = { ...base, query: { kind: 'catalog' }, expected_revision: revision, page: { ...input.page, offset: items.pagination.end } };
  return { ...common, ...notices, manifest: deferred(result.manifest ?? {}, ['manifest']), documents: deferred(result.documents, ['documents']),
    items, unusable_items: deferred(result.unusable_items, ['unusable_items']),
    impact: result.impact ? impactSummary(result.impact) : null,
    product_view: Object.fromEntries(Object.entries(result.product_view).map(([key, value]) => [key, project(value, ['product_view', key])])),
    collections: Object.fromEntries(['reverse_relations', 'plan_tasks', 'discussions', 'sources'].map(key => [key, deferred(result[key], [key])])) };
}

function presentSource(result: ObjectValue, input: ObjectValue): ObjectValue {
  const revision = sha256(JSON.stringify([result.root, result.project_id, result.manifest_sha256, input.source, result.actual_sha256 ?? null, result.size ?? null]));
  if (input.expected_revision && input.expected_revision !== revision) {
    const restart = { ...input, offset: 0 }; delete restart.expected_revision;
    const { data_base64, text_preview, text, ...facts } = result;
    return { ...facts, presentation_contract: contract, revision, query_error: 'QUERY_VERSION_CHANGED', restart_request: restart };
  }
  const { data_base64, text_preview, ...facts } = result;
  if (data_base64 === undefined) {
    if (typeof result.text !== 'string') return { ...facts, presentation_contract: contract, revision };
    const chunk = utf8Page(result.text, input.offset ?? 0, input.max_bytes ?? 65536);
    return { ...facts, text: chunk.text, presentation_contract: contract, revision, size: chunk.total, offset: input.offset ?? 0,
      next_request: chunk.end < chunk.total ? { ...input, offset: chunk.end, expected_revision: revision } : null };
  }
  const bytes = Buffer.from(data_base64, 'base64');
  let length = Math.min(bytes.length, input.encoding === 'base64' ? input.max_bytes ?? 65536 : Math.min(input.max_bytes ?? 65536, 1048573));
  if (input.encoding !== 'base64') {
    while (length < bytes.length && (bytes[length]! & 0xc0) === 0x80) length++;
  }
  let data: ObjectValue;
  try { data = input.encoding === 'base64' ? { data_base64 } : { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)) }; }
  catch { return { ...facts, presentation_contract: contract, revision, query_error: 'SOURCE_ENCODING: use explicit base64 for non-UTF8 or a split starting offset', detail_request: { ...input, encoding: 'base64' } }; }
  const end = (result.offset ?? 0) + length;
  return { ...facts, ...data, presentation_contract: contract, revision, next_offset: end < result.size ? end : null,
    next_request: end < result.size ? { ...input, offset: end, expected_revision: revision } : null };
}

/** A rendering failure cannot turn a completed write into a failed write. */
export function deliver(result: ObjectValue, render: () => ObjectValue): ObjectValue {
  try { const shown = render(); JSON.stringify(shown, null, 2); return shown; }
  catch (error: any) { return { ...result, presentation_contract: contract, presentation_error: String(error.message ?? error), presentation_fallback: 'original-receipt; operation was not repeated' }; }
}
