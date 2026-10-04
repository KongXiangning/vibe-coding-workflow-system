import { createHash } from 'node:crypto';
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { diagnostic, sectionsByType, type Diagnostic, type Item, type ProductDocument } from './model';
import { documentSchema, itemSchema, validate } from './schemas';

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function decode(bytes: Uint8Array): string {
  // Preserve the BOM for correct source offsets and byte preimages.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
export function strictYaml(text: string, file: string) {
  const doc = parseDocument(text, { schema: 'core', uniqueKeys: true, strict: true });
  const problems: { offset: number; diagnostic: Diagnostic }[] = [];
  const problem = (code: string, message: string, offset = 0) => problems.push({ offset, diagnostic: diagnostic(code, file, message, { severity: 'error', line: text.slice(0, offset).split(/\r\n|\n|\r/).length }) });
  for (const issue of [...doc.errors, ...doc.warnings]) problem(`YAML_${issue.code}`, issue.message, issue.pos?.[0] ?? 0);
  const convert = (node: any): any => {
    if (node === null) return null;
    if (node?.anchor) problem('YAML_ANCHOR', 'Anchors are not permitted', node.range?.[0]);
    if (node?.tag && !['tag:yaml.org,2002:str', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:null', 'tag:yaml.org,2002:seq', 'tag:yaml.org,2002:map'].includes(node.tag)) problem('YAML_TAG', 'Custom/non-JSON tags are not permitted', node.range?.[0]);
    if (isAlias(node)) { problem('YAML_ALIAS', 'Aliases are not permitted', node.range?.[0]); return null; }
    if (isMap(node)) {
      const value = Object.create(null);
      for (const pair of node.items) {
        const key = convert(pair.key);
        if (typeof key !== 'string') { problem('YAML_KEY', 'JSON object keys must be strings', pair.key?.range?.[0]); continue; }
        if (key === '<<') problem('YAML_MERGE', 'Merge keys are not permitted', pair.key?.range?.[0]);
        value[key] = convert(pair.value);
      }
      return value;
    }
    if (isSeq(node)) return node.items.map(convert);
    if (isScalar(node)) {
      const value = node.value;
      if (!(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)))) { problem('YAML_JSON_VALUE', 'Only finite JSON-compatible values are permitted', node.range?.[0]); return null; }
      return value;
    }
    problem('YAML_NODE', 'Unsupported YAML node');
    return null;
  };
  const value = convert(doc.contents);
  return { doc, value, problems };
}
const processor = unified().use(remarkParse);
const nodeText = (node: any): string => typeof node.value === 'string' ? node.value : (node.children ?? []).map(nodeText).join('');

export function parseProduct(text: string, file: string): ProductDocument {
  const result: ProductDocument = { path: file, text, sha256: sha256(text), schema: null, version: null, items: [], diagnostics: [], frontmatter_start: 0, frontmatter_end: 0, body_start: 0 };
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(text);
  if (!opening) { result.diagnostics.push(diagnostic('FRONTMATTER_MISSING', file, 'Expected YAML frontmatter at the beginning', { severity: 'error' })); return result; }
  const rest = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r\n|\n|\r|$)/m.exec(rest);
  if (!closing) { result.diagnostics.push(diagnostic('FRONTMATTER_UNCLOSED', file, 'Missing frontmatter closing delimiter', { severity: 'error' })); return result; }
  result.frontmatter_start = opening[0].length;
  result.frontmatter_end = opening[0].length + closing.index;
  result.body_start = result.frontmatter_end + closing[0].length;
  const yaml = strictYaml(text.slice(result.frontmatter_start, result.frontmatter_end), file);
  result.schema = yaml.value?.schema ?? null;
  result.version = result.schema === 'vnext-product-doc/v2' ? 2 : result.schema === 'vnext-product-doc/v1' ? 1 : null;
  if (!result.version) {
    result.diagnostics.push(diagnostic('UNSUPPORTED_VERSION', file, `Unsupported schema ${JSON.stringify(result.schema)}; raw content is retained`, { severity: 'error' }), ...yaml.problems.map(p => p.diagnostic));
    return result;
  }
  const itemNodes: any[] = (yaml.doc.get('items', true) as any)?.items ?? [];
  const rootProblems = yaml.problems.filter(p => !itemNodes.some(node => node?.range && p.offset >= node.range[0] && p.offset < node.range[2]));
  result.diagnostics.push(...rootProblems.map(p => p.diagnostic));
  const rootSchema = documentSchema(result.version);
  const shapeOnly = { ...rootSchema, properties: { ...rootSchema.properties, items: { type: 'array' } } };
  result.diagnostics.push(...validate(yaml.value, shapeOnly).map(e => diagnostic('DOCUMENT_METADATA', file, e.message, { severity: 'error', pointer: e.pointer })));
  if (result.diagnostics.some(d => d.severity === 'error') || !Array.isArray(yaml.value?.items)) return result;
  const body = text.slice(result.body_start);
  const ast = processor.parse(body);
  const headings = ast.children.filter((n: any) => n.type === 'heading' && n.depth === 2);
  const identified = headings.map((node: any, index: number) => {
    const match = /^\[([A-Za-z0-9][A-Za-z0-9._-]{0,95})\]\s+(.+)$/.exec(nodeText(node));
    const start = result.body_start + node.position.start.offset;
    const end = index + 1 < headings.length ? result.body_start + headings[index + 1]!.position!.start.offset! : text.length;
    return { id: match?.[1], title: match?.[2], start, end, line: text.slice(0, start).split(/\r\n|\n|\r/).length };
  });
  for (const [index, metadata] of yaml.value.items.entries()) {
    const node = itemNodes[index];
    const matches = identified.filter(h => h.id === metadata?.id);
    const location = matches[0];
    const diagnostics = validate(metadata, itemSchema(result.version), rootSchema.$defs).map(e => diagnostic('ITEM_METADATA', file, e.message, { severity: 'error', item_id: metadata?.id, pointer: `/items/${index}${e.pointer}` }));
    diagnostics.push(...yaml.problems.filter(p => node?.range && p.offset >= node.range[0] && p.offset < node.range[2]).map(p => ({ ...p.diagnostic, item_id: metadata?.id })));
    if (matches.length !== 1) diagnostics.push(diagnostic('ITEM_HEADING', file, `Expected exactly one root level ## [${metadata?.id}] heading; found ${matches.length}`, { severity: 'error', item_id: metadata?.id }));
    if (yaml.value.items.filter((m: any) => m?.id === metadata?.id).length !== 1) diagnostics.push(diagnostic('DUPLICATE_ID', file, 'Metadata ID is not unique', { severity: 'error', item_id: metadata?.id }));
    const sections: Item['sections'] = Object.create(null);
    if (location) {
      const children = ast.children.filter((n: any) => n.position.start.offset + result.body_start > location.start && n.position.start.offset + result.body_start < location.end);
      children.forEach((child: any, childIndex: number) => {
        if (child.type !== 'heading' || child.depth !== 3) return;
        const name = nodeText(child);
        const start = result.body_start + child.position.end.offset;
        const nextHeading: any = children.slice(childIndex + 1).find((n: any) => n.type === 'heading' && n.depth <= 3);
        const end = nextHeading ? result.body_start + nextHeading.position.start.offset : location.end;
        (sections[name] ??= []).push({ start, end, text: text.slice(start, end).trim() });
      });
    }
    for (const name of sectionsByType[metadata?.type] ?? []) if (sections[name]?.length !== 1) diagnostics.push(diagnostic('REQUIRED_SECTION', file, `Expected exactly one ### ${name}`, { severity: 'error', item_id: metadata?.id, line: location?.line }));
    result.items.push({ id: metadata?.id, type: metadata?.type, metadata, path: file, title: location?.title ?? '', body: location ? text.slice(location.start, location.end) : '', sections,
      start: location?.start ?? -1, end: location?.end ?? -1, metadata_start: result.frontmatter_start + (node?.range?.[0] ?? 0), metadata_end: result.frontmatter_start + (node?.range?.[1] ?? 0), line: location?.line ?? 1, usable: !diagnostics.some(d => d.severity === 'error'), diagnostics });
  }
  for (const h of identified) if (h.id && !result.items.some(i => i.id === h.id)) result.diagnostics.push(diagnostic('UNREGISTERED_HEADING', file, `Heading ${h.id} is not registered in items`, { line: h.line, severity: 'error' }));
  result.diagnostics.push(...result.items.flatMap(i => i.diagnostics));
  return result;
}

export function requirementDigest(item: Item): string {
  const relations = [...new Map((item.metadata.links ?? []).filter((l: any) => l.origin === 'declared' && l.state === 'active' && ['part_of', 'supports', 'depends_on', 'replaces', 'derived_from'].includes(l.relation)).map((l: any) => [[l.relation, l.target].join('\u0000'), [l.relation, l.target]])).values()] as string[][];
  relations.sort((a,b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0);
  const definition = { type: item.type, id: item.id, scope: item.metadata.scope, relations, body: item.body.replace(/\r\n|\r/g, '\n').replace(/\n+$/, '') };
  return sha256(`vnext-requirement-definition/v1\n${JSON.stringify(definition)}`);
}
