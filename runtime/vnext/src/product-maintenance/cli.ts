import * as path from 'node:path';
import { readCatalog } from './catalog';
import { diagnostic, type ObjectValue } from './model';
import { decode, parseProduct, strictYaml } from './parser';
import { allowed } from './paths';
import { impactCandidates, planTasks, recallDiscussions, reverseRelations } from './plans';
import { readSource, resolveSources } from './references';
import { manifestSchema, requestSchema, validate } from './schemas';
import { apply, capture } from './writer';

export function run(action: string, root: string, input: ObjectValue = {}): ObjectValue {
  const envelope = { kind: 'product-maintenance-result/v1', action, development_gate: false, qualification: 'not-evaluated', task_operations: 'not-performed' };
  const inputErrors = validate(input, requestSchema);
  function checkJson(value: any, pointer = ''): void {
    if (typeof value === 'number' && !Number.isFinite(value)) inputErrors.push({ pointer, message: 'Only finite JSON numbers are accepted' });
    if (Array.isArray(value)) value.forEach((v, i) => checkJson(v, `${pointer}/${i}`));
    else if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) checkJson(v, `${pointer}/${key}`);
  }
  checkJson(input);
  if (inputErrors.length) return { ...envelope, status: 'failed', diagnostics: inputErrors.map(e => diagnostic('REQUEST_INVALID', '', e.message, { pointer: e.pointer, severity: 'error' })) };
  try {
    if (action === 'apply') {
      if (!input.files?.length) throw new Error('APPLY_INPUT: files must be a nonempty array');
      return { ...envelope, ...apply(root, input) };
    }
    if (action === 'capture') return { ...envelope, ...capture(root, input) };
    const catalog = readCatalog(root, input);
    if (action === 'read') {
      if (input.source) return { ...envelope, root: catalog.root, project_id: catalog.manifest?.project_id ?? null, ...readSource(catalog, input.source, input) };
      const selected = catalog.items.filter(i => !input.item_ids || input.item_ids.includes(i.id));
      return { ...envelope, status: catalog.status, project_id: catalog.manifest?.project_id ?? null, working_copy: { root: catalog.root, identity: path.resolve(catalog.root) }, read_at: new Date().toISOString(), manifest: catalog.manifest, manifest_path: catalog.manifest_path, manifest_sha256: catalog.manifest_sha256,
        documents: catalog.documents.map(d => ({ path: d.path, sha256: d.sha256, schema: d.schema, usable_count: d.items.filter(i => i.usable).length, raw_locator: { kind: 'file', path: d.path } })),
        usable_items: selected.filter(i => i.usable).map(i => ({ id: i.id, type: i.type, title: i.title, path: i.path, line: i.line, metadata: i.metadata, definition_sha256: i.definition_sha256 ?? null, ...(input.detail === 'items' ? { body: i.body } : {}), ...(i.type === 'discussion' ? { summary: i.sections['整理摘要']?.[0]?.text ?? '' } : {}), locator: { kind: 'file', path: i.path, item_id: i.id } })),
        unusable_items: selected.filter(i => !i.usable).map(i => ({ id: i.id ?? null, type: i.type ?? null, path: i.path, line: i.line, diagnostics: i.diagnostics, raw_locator: { kind: 'file', path: i.path }, ...(input.detail === 'items' ? { body: i.body } : {}) })),
        reverse_relations: reverseRelations(catalog), plan_tasks: planTasks(catalog), discussions: input.discussion_targets ? recallDiscussions(catalog, input.discussion_targets) : [], impact: input.impact_ids ? impactCandidates(catalog, input.impact_ids) : null,
        sources: input.resolve_sources ? resolveSources(catalog, input.item_ids) : [], diagnostics: catalog.diagnostics, coverage: { ...catalog.coverage, selection: input.item_ids ?? 'all-enumerated-items', source_bodies: input.resolve_sources ? 'byte status only; fetch selected source explicitly' : 'not-read' }, task_status: 'not-computed; use existing assistance only when actual task state is needed' };
    }
    if (action === 'check') {
      if (input.content !== undefined && input.path) {
        if (input.path === catalog.manifest_path) {
          const yaml = strictYaml(input.content, input.path);
          const version = yaml.value?.schema === 'vnext-product-manifest/v1' ? 1 : 2;
          const diagnostics = [...yaml.problems.map(p => p.diagnostic), ...validate(yaml.value, manifestSchema(version)).map(e => diagnostic('MANIFEST_METADATA', input.path, e.message, { severity: 'error', pointer: e.pointer }))];
          return { ...envelope, status: diagnostics.length ? 'invalid' : 'valid', diagnostics, business_validity: 'not-evaluated' };
        }
        if (!catalog.manifest || !allowed(catalog.manifest, input.path, 'managed')) throw new Error('CHECK_OUT_OF_RANGE: candidate is outside managed_paths');
        const doc = parseProduct(input.content, input.path);
        return { ...envelope, status: doc.diagnostics.some(d => d.severity === 'error') ? 'invalid' : 'valid', schema: doc.schema, usable_items: doc.items.filter(i => i.usable).map(i => i.id), diagnostics: doc.diagnostics, business_validity: 'not-evaluated' };
      }
      return { ...envelope, status: catalog.status !== 'available' ? catalog.status : !catalog.coverage.complete || catalog.diagnostics.some(d => d.severity === 'error') ? 'partial' : 'checked', diagnostics: catalog.diagnostics, coverage: catalog.coverage, sources: input.resolve_sources ? resolveSources(catalog, input.item_ids) : [], business_validity: 'not-evaluated' };
    }
    throw new Error('UNKNOWN_ACTION: use read, check, apply or capture');
  } catch (error: any) { return { ...envelope, status: 'failed', error: error.message }; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), action = args[0], rootIndex = args.indexOf('--root');
  if (!action || !['read', 'check', 'apply', 'capture'].includes(action) || rootIndex < 0 || !args[rootIndex + 1] || args.length !== 3 || rootIndex !== 1) {
    console.error('Usage: node product-maintenance.js <read|check|apply|capture> --root <project> (JSON on stdin)'); process.exitCode = 1; return;
  }
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    if (!process.stdin.isTTY) for await (const chunk of process.stdin) {
      const value = Buffer.from(chunk); bytes += value.length;
      if (bytes > 64 * 1024 * 1024) throw new Error('INPUT_BYTE_LIMIT: request exceeds 64 MiB; select bounded material');
      chunks.push(value);
    }
    const text = decode(Buffer.concat(chunks)).replace(/^\uFEFF/, '').trim();
    const result = run(action, args[rootIndex + 1]!, text ? JSON.parse(text) : {});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (['failed', 'partial', 'invalid', 'unavailable', 'unsupported'].includes(result.status) || result.status === 'available' && result.coverage?.complete === false) process.exitCode = 1;
  } catch (error: any) { process.stdout.write(`${JSON.stringify({ kind: 'product-maintenance-result/v1', action, status: 'failed', error: error.message, development_gate: false, qualification: 'not-evaluated' })}\n`); process.exitCode = 1; }
}
if (import.meta.main || process.argv[1] && /(?:^|[\\/])product-maintenance\.js$/.test(process.argv[1])) await main();
