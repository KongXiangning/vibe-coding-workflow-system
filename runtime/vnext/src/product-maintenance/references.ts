import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { diagnostic, type Catalog, type ObjectValue } from './model';
import { allowed, safePath } from './paths';
import { decode, parseProduct, requirementDigest } from './parser';
import { collectSources } from './plans';

const markdown = unified().use(remarkParse);

export function fileDigest(file: string): string {
  const fd = fs.openSync(file, 'r'), hash = createHash('sha256'), chunk = Buffer.alloc(65536);
  try { let count: number; while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count)); return hash.digest('hex'); }
  finally { fs.closeSync(fd); }
}
export function readSource(catalog: Catalog, source: ObjectValue, input: ObjectValue = {}): ObjectValue {
  const base: ObjectValue = { source, byte_status: 'unknown', status: 'unavailable', diagnostics: [], fetched_remote: false };
  if (source.kind === 'uri') return { ...base, status: 'reference-only', navigation_allowed: /^https?:/i.test(source.uri), note: 'URI retained only; its body has not been obtained or archived' };
  if (source.kind === 'text') return { ...base, status: 'available', text: source.text, label: source.label, note: 'Text basis is not authenticated as verbatim user speech' };
  try {
    if (!catalog.manifest || !allowed(catalog.manifest, source.path, 'source')) return { ...base, diagnostics: [diagnostic('SOURCE_OUT_OF_RANGE', source.path, 'Source is not in registered reading scope')] };
    const file = safePath(catalog.root, source.path), stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('Source must be a regular file');
    const digest = fileDigest(file);
    base.actual_sha256 = digest;
    base.byte_status = source.sha256 ? source.sha256 === digest ? 'same-bytes' : 'changed' : 'unknown';
    if (base.byte_status === 'changed') base.diagnostics.push(diagnostic('SOURCE_CHANGED', source.path, 'Current bytes differ from referenced bytes; a digest cannot recover historical content'));
    let start = 0, end = stat.size;
    if (source.item_id || source.section || source.lines) {
      if (stat.size > (input.max_file_bytes ?? 4 * 1024 * 1024)) return { ...base, diagnostics: [...base.diagnostics, diagnostic('LOCATOR_BYTE_LIMIT', source.path, 'Structured locator was not resolved; raw bytes remain available via a locator-free paged read')] };
      const bytes = fs.readFileSync(file), text = decode(bytes);
      let charStart = 0, charEnd = text.length;
      if (source.item_id || source.section) {
        const document = parseProduct(text, source.path);
        if (source.item_id) {
          const matches = document.items.filter(i => i.id === source.item_id && i.start >= 0);
          if (matches.length !== 1) throw new Error('SOURCE_ITEM: source item is missing or ambiguous');
          const item = matches[0]!;
          if (item.usable && item.type === 'requirement') base.requirement_definition_sha256 = requirementDigest(item);
          charStart = item.start; charEnd = item.end;
          if (source.section) {
            const sections = item.sections[source.section] ?? [];
            if (sections.length !== 1) throw new Error('SOURCE_SECTION: section is missing or ambiguous within the item');
            charStart = sections[0]!.start; charEnd = sections[0]!.end;
          }
        } else {
          // An unstructured source may use headings; use AST even without product frontmatter.
          const tree = markdown.parse(text);
          const headings = tree.children.filter((n: any) => n.type === 'heading');
          const textOf = (n: any): string => n.value ?? (n.children ?? []).map(textOf).join('');
          const matches = headings.filter((n: any) => textOf(n) === source.section);
          if (matches.length !== 1) throw new Error('SOURCE_SECTION: root section is missing or ambiguous');
          const heading: any = matches[0], position = headings.indexOf(heading);
          charStart = heading.position.end.offset;
          const next: any = headings.slice(position + 1).find((n: any) => n.depth <= heading.depth);
          charEnd = next?.position.start.offset ?? text.length;
        }
      }
      if (source.lines) {
        const lineStarts = [0];
        for (const match of text.matchAll(/\r\n|\n|\r/g)) lineStarts.push(match.index! + match[0].length);
        if (source.lines.start > lineStarts.length || source.lines.end > lineStarts.length || source.lines.end < source.lines.start) throw new Error('SOURCE_LINES: line range is outside source');
        const ls = lineStarts[source.lines.start - 1]!, le = lineStarts[source.lines.end] ?? text.length;
        if (ls < charStart || le > charEnd) throw new Error('SOURCE_LINES: line range is outside selected item/section');
        charStart = ls; charEnd = le;
      }
      start = Buffer.byteLength(text.slice(0, charStart)); end = Buffer.byteLength(text.slice(0, charEnd));
    }
    const offset = input.offset ?? 0, size = end - start;
    if (offset > size) throw new Error('SOURCE_OFFSET: offset is past the selected source');
    const fd = fs.openSync(file, 'r'), data = Buffer.alloc(Math.min(input.max_bytes ?? 65536, size - offset));
    let count: number;
    try { count = fs.readSync(fd, data, 0, data.length, start + offset); }
    finally { fs.closeSync(fd); }
    if (fileDigest(file) !== digest) throw new Error('SOURCE_READ_CHANGED: source changed during reading; restart this read');
    return { ...base, status: 'available', size, file_size: stat.size, locator_start_byte: start, offset, data_base64: data.subarray(0, count).toString('base64'), text_preview: data.subarray(0, count).toString('utf8'), next_offset: offset + count < size ? offset + count : null, content_is_referenced_bytes: base.byte_status === 'same-bytes' };
  } catch (error: any) { return { ...base, byte_status: base.actual_sha256 ? base.byte_status : 'unavailable', diagnostics: [...base.diagnostics, diagnostic('SOURCE_UNAVAILABLE', source.path, error.message)] }; }
}
export function resolveSources(catalog: Catalog, ids?: string[]): ObjectValue[] {
  const refs = catalog.items.filter(i => i.usable && (!ids || ids.includes(i.id))).flatMap(i => collectSources(i.metadata));
  return [...new Map(refs.map(r => [JSON.stringify(r), r])).values()].map(r => {
    const result = readSource(catalog, r, { max_bytes: 1 });
    const basisChecks = catalog.items.filter(i => i.usable && i.type === 'assessment' && JSON.stringify(i.metadata.target_basis) === JSON.stringify(r)).map(i => {
      const expected = i.metadata.target_definition_sha256;
      const actual = result.requirement_definition_sha256 ?? null;
      let alignment = 'unknown';
      if (expected && actual) alignment = expected === actual ? 'same-definition' : 'different-definition';
      if (alignment === 'different-definition') result.diagnostics.push(diagnostic('BASIS_DEFINITION_MISMATCH', r.path, `Referenced material definition differs from ${i.id}'s reported definition`, { item_id: i.id }));
      return { assessment_id: i.id, expected_definition_sha256: expected, actual_definition_sha256: actual, definition_alignment: alignment, referenced_byte_availability: result.byte_status, current_code_applicability: 'not-evaluated' };
    });
    const { data_base64, text_preview, text, ...summary } = result;
    return { ...summary, ...(basisChecks.length ? { basis_checks: basisChecks } : {}) };
  });
}
