import { type ObjectValue } from './model';

// The same closed structural definitions produce installed JSON Schema and local diagnostics.
type Schema = ObjectValue;
const string: Schema = { type: 'string', minLength: 1, pattern: '\\S' };
const id: Schema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$' };
const digest: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] });
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
const array = (items: Schema, minItems = 0): Schema => ({ type: 'array', items, minItems });
const object = (properties: ObjectValue, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const source = ref('SourceRef');
const sources = array(source);
const origin = choice('declared', 'inferred');
const state = choice('active', 'dismissed');
const scope = choice('current', 'planned', 'candidate', 'retired');
const intent = choice('proposed', 'adopted', 'retired');
const extensions = { type: 'object' };
const provenanceRules = [
  { if: { properties: { origin: { const: 'inferred' } }, required: ['origin'] }, then: { required: ['reason', 'sources'], properties: { sources: array(source, 1) } } },
  { if: { properties: { state: { const: 'dismissed' } }, required: ['state'] }, then: { required: ['reason'] } },
];
const taskRef = object({ task_id: nullable(string), source, label: string, plan_ref: string, step_id: string }, ['task_id', 'source']);
const targetCoverage = object({ target: id, coverage: string });
const definitions: ObjectValue = {
  SourceRef: { oneOf: [
    object({ kind: { const: 'file' }, path: string, item_id: id, section: string, lines: object({ start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } }), sha256: digest, note: string }, ['kind', 'path']),
    object({ kind: { const: 'uri' }, uri: string, note: string }, ['kind', 'uri']),
    object({ kind: { const: 'text' }, text: string, label: string }, ['kind', 'text', 'label']),
  ] },
  TaskRef: taskRef,
  Link: { ...object({ id, relation: choice('part_of', 'supports', 'addresses', 'depends_on', 'replaces', 'derived_from', 'discusses', 'references'), target: id, origin, state, reason: string, sources }, ['id', 'relation', 'target', 'origin', 'state']), allOf: provenanceRules },
  TaskBinding: { ...object({ id, task: ref('TaskRef'), role: choice('implementation', 'repair', 'verification', 'exploration', 'reference'), coverage: string, origin, state, reason: string, sources,
    plan_items: array(object({ plan_id: id, work_item_id: id })), repairs: array(object({ task: ref('TaskRef'), coverage: string, sources })) }, ['id', 'task', 'role', 'coverage', 'origin', 'state']), allOf: provenanceRules },
  WorkItem: object({ id, title: string, outcome: string, scope: string, targets: array(targetCoverage), state: choice('included', 'deferred', 'withdrawn'), origin: choice('initial', 'added', 'unknown'), stage: string,
    depends_on: array(object({ item_id: id, kind: choice('order', 'prerequisite'), reason: string })), replaces: array(id), sources }, ['id', 'title', 'outcome', 'scope', 'targets', 'state', 'origin']),
};

export function itemSchema(version: 1 | 2): Schema {
  const common = { id, links: array(ref('Link')), sources, extensions };
  const types: Record<string, { fields: ObjectValue; required: string[] }> = {
    project: { fields: { inventory: object({ state: choice('partial', 'reconciled'), checked_sources: sources, unreviewed_sources: sources, note: string }, ['state', 'checked_sources', 'unreviewed_sources']) }, required: ['inventory'] },
    goal: { fields: { scope, ...(version === 2 ? { task_bindings: array(ref('TaskBinding')) } : {}) }, required: ['scope'] },
    module: { fields: { scope }, required: ['scope'] },
    requirement: { fields: { scope, assessment_id: nullable(id), ...(version === 2 ? { task_bindings: array(ref('TaskBinding')) } : {}) }, required: ['scope'] },
    design: { fields: { intent_state: intent }, required: ['intent_state'] },
    change: { fields: { recorded_at: string, basis: object({ kind: choice('user', 'delegated', 'document-edit'), text: string, sources }, ['kind', 'text']), deltas: array(object({ target: id, before: nullable(string), after: nullable(string), note: string }, ['target', 'before', 'after']), 1) }, required: ['recorded_at', 'basis', 'deltas'] },
    assessment: { fields: { target: id, target_basis: { ...ref('SourceRef'), /* file-only constraint is checked below */ }, target_definition_sha256: nullable(digest), checked_at: string,
      subject: object({ kind: choice('working-copy', 'commit', 'release', 'unknown'), value: nullable(string) }), implementation: choice('unknown', 'none-reported', 'partial-reported', 'delivered-reported'), verification: choice('unknown', 'not-run-reported', 'failure-reported', 'pass-reported', 'mixed-reported'), ...(version === 2 ? { pending_sources: sources } : {}) },
      required: ['target', 'target_basis', 'target_definition_sha256', 'checked_at', 'subject', 'implementation', 'verification'] },
    discussion: { fields: { raw_ref: source, submitted_at: string, origin: object({ channel: choice('chat', 'codex', 'other', 'unknown'), locator: string, occurred_at: nullable(string) }, ['channel']), record_state: choice('active', 'archived') }, required: ['raw_ref', 'submitted_at', 'origin', 'record_state'] },
  };
  if (version === 2) types.plan = { fields: { intent_state: intent, targets: array(targetCoverage, 1), work_items: array(ref('WorkItem')) }, required: ['intent_state', 'targets', 'work_items'] };
  return { oneOf: Object.entries(types).map(([type, spec]) => {
    const extra: ObjectValue[] = [];
    if (type === 'assessment') extra.push({ properties: { target_basis: { properties: { kind: { const: 'file' } }, required: ['kind'] } } });
    if (type === 'discussion') extra.push({ properties: { raw_ref: { properties: { kind: { const: 'file' }, sha256: digest }, required: ['kind', 'sha256'] } } });
    if (type === 'project') extra.push({ if: { properties: { inventory: { properties: { state: { const: 'reconciled' } } } } }, then: { properties: { inventory: { properties: { checked_sources: array(source, 1), unreviewed_sources: { type: 'array', maxItems: 0 } } } } } });
    return { ...object({ ...common, type: { const: type }, ...spec.fields }, ['id', 'type', ...spec.required]), ...(extra.length ? { allOf: extra } : {}) };
  }) };
}
export function documentSchema(version: 1 | 2): Schema {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `https://vnext.local/schemas/product-doc-v${version}.json`, $defs: definitions,
    ...object({ schema: { const: `vnext-product-doc/v${version}` }, items: array(itemSchema(version)) }) };
}
export function manifestSchema(version: 1 | 2): Schema {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `https://vnext.local/schemas/product-manifest-v${version}.json`,
    ...object({ schema: { const: `vnext-product-manifest/v${version}` }, project_id: string, entry: string, managed_paths: array(string, 1), source_paths: array(string), ...(version === 2 ? { capture_paths: array(string) } : {}), exclude_paths: array(string), maintenance: choice('enabled', 'paused'), extensions }, ['schema', 'project_id', 'entry', 'managed_paths', 'source_paths', 'exclude_paths', 'maintenance']) };
}
const fileOperation = object({ path: string, expected_sha256: nullable(digest), content: { type: 'string' }, updates: array(object({ id, metadata: { type: 'object' }, body: { type: 'string' }, remove_fields: array(string) }, ['id'])), append: array(object({ metadata: { type: 'object' }, body: string })), migrate: { const: 'v2' }, preimage_path: string }, ['path', 'expected_sha256']);
export const requestSchema: Schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: definitions,
  ...object({ manifest: string, detail: choice('summary', 'items'), item_ids: array(id), paths: array(string), max_files: { type: 'integer', minimum: 1, maximum: 10000 }, max_file_bytes: { type: 'integer', minimum: 1, maximum: 67108864 }, max_total_bytes: { type: 'integer', minimum: 1, maximum: 268435456 }, resolve_sources: { type: 'boolean' }, source: source, offset: { type: 'integer', minimum: 0 }, max_bytes: { type: 'integer', minimum: 1, maximum: 1048576 }, impact_ids: array(id), discussion_targets: array(id),
    files: array(fileOperation, 1), path: string, text: { type: 'string' }, base64: { type: 'string' }, source_path: string, expected_manifest_sha256: nullable(digest), expected_sha256: nullable(digest), content: { type: 'string' } }, []) };

export const resultSchema: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://vnext.local/schemas/product-maintenance-result-v1.json',
  type: 'object',
  required: ['kind', 'action', 'status', 'development_gate', 'qualification'],
  properties: {
    kind: { const: 'product-maintenance-result/v1' },
    action: choice('read', 'check', 'apply', 'capture'),
    status: choice('available', 'not-enabled', 'unavailable', 'unsupported', 'valid', 'invalid', 'checked', 'saved', 'unchanged', 'partial', 'failed', 'reference-only'),
    development_gate: { const: false },
    qualification: { const: 'not-evaluated' },
    files: { type: 'array', items: { type: 'object', required: ['path', 'status', 'saved'], properties: { path: string, status: choice('saved', 'unchanged', 'failed'), saved: { type: 'boolean' } } } },
    diagnostics: { type: 'array', items: { type: 'object', required: ['code', 'path', 'message', 'severity'] } },
    coverage: { type: 'object' },
  },
  // Action-specific results are described in API.md and may gain additive fields.
  additionalProperties: true,
};

// A deliberately small evaluator for exactly the generated schema vocabulary.
// JSON Schema assets remain usable by independent, standards-compliant consumers.
export function validate(value: any, schema: Schema, defs: ObjectValue = schema.$defs ?? {}, pointer = ''): { pointer: string; message: string }[] {
  if (schema.$ref) return validate(value, defs[schema.$ref.slice('#/$defs/'.length)], defs, pointer);
  const errors: { pointer: string; message: string }[] = [];
  const error = (message: string, at = pointer) => errors.push({ pointer: at || '/', message });
  if (schema.oneOf || schema.anyOf) {
    let variants: Schema[] = schema.oneOf ?? schema.anyOf;
    const discriminator = ['type', 'kind'].find(key => value && typeof value === 'object' && variants.some(v => v.properties?.[key]?.const !== undefined));
    if (discriminator) {
      const exact = variants.filter(v => v.properties?.[discriminator]?.const === value[discriminator]);
      if (exact.length) variants = exact;
    }
    const results = variants.map(s => validate(value, s, defs, pointer));
    const validCount = results.filter(r => !r.length).length;
    if ((schema.oneOf && validCount !== 1) || (schema.anyOf && !validCount)) errors.push(...(results.sort((a,b) => a.length - b.length)[0] ?? [{ pointer, message: 'No schema variant matched' }]));
  }
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !(schema.type === 'integer' ? Number.isInteger(value) : schema.type === actualType)) { error(`Expected ${schema.type}, received ${actualType}`); return errors; }
  if ('const' in schema && value !== schema.const) error(`Expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) error(`Expected one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) error('Text must not be empty');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) error(`Text does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) error('Number must be finite');
    if (schema.minimum !== undefined && value < schema.minimum) error(`Must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) error(`Must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) error(`Requires at least ${schema.minItems} member(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) error(`Allows at most ${schema.maxItems} member(s)`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, defs, `${pointer}/${i}`)));
  }
  if (actualType === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) error('Required field is missing', `${pointer}/${key}`);
    for (const [key, v] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) errors.push(...validate(v, schema.properties[key], defs, `${pointer}/${key}`));
      else if (schema.additionalProperties === false) error('Unknown core field; use extensions', `${pointer}/${key}`);
    }
  }
  for (const child of schema.allOf ?? []) errors.push(...validate(value, child, defs, pointer));
  if (schema.if && !validate(value, schema.if, defs, pointer).length && schema.then) errors.push(...validate(value, schema.then, defs, pointer));
  return errors;
}
