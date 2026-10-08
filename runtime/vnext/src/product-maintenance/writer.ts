import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isSeq, stringify } from 'yaml';
import { storeReadFile, storeStat } from '../../support/record-storage.mjs';
import { readCatalog } from './catalog';
import { type Catalog, type Item, type ObjectValue, type ProductDocument } from './model';
import { decode, parseProduct, sha256, strictYaml } from './parser';
import { allowed, matches, relativePath, safePath } from './paths';
import { manifestSchema, validate } from './schemas';

export function frozen(root: string, relative: string, original?: Buffer): void {
  if (original) {
    const header = original.subarray(0, 8192).toString('utf8');
    if (/@frozen\b/i.test(header) || /^\s*(?:<!--\s*|[#/*;!]+\s*)?DO NOT MODIFY\b/m.test(header)) throw new Error('FROZEN: target has a freeze header');
  }
  for (const registry of ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md']) {
    const file = safePath(root, registry);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const paths = [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]!.replace(/\\/g, '/'));
      if (paths.some(p => p === relative || (p.endsWith('/') && relative.startsWith(p)) || (p.includes('*') && matches(relative, [p])))) throw new Error(`FROZEN: ${relative} is registered in ${registry}`);
    }
  }
}
function readExisting(root: string, relative: string, maxBytes = 64 * 1024 * 1024): Buffer | null {
  const file = safePath(root, relative);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('NOT_REGULAR_FILE: target must be a regular file');
    if (stat.size > maxBytes) throw new Error('WRITE_BYTE_LIMIT: existing file exceeds the explicit write bound; no bytes were replaced');
    return fs.readFileSync(file);
  }
  catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
}
function checkVersion(original: Buffer | null, expected: any): void {
  if (expected === undefined) throw new Error('READ_VERSION_REQUIRED: expected_sha256 must be the read byte digest or null for a new file');
  if ((original === null ? null : sha256(original)) !== expected) throw new Error('WRITE_CONFLICT: current bytes differ from the read version; no overwrite');
}
function assertProductWriteTarget(relative: string): void {
  const normalized = relative.toLowerCase(); // Also reserve aliases on case-insensitive filesystems.
  if (normalized === '.workflow-system/records' || normalized.startsWith('.workflow-system/records/'))
    throw new Error('RECORD_STORE_READ_ONLY: product maintenance cannot write Runtime record storage; use assistance record, snapshot or archive restore for the intended operation');
}

// The lock only coordinates this helper's short I/O on one path. External editors
// do not participate: digest recheck + rename is not a universal filesystem CAS.
function publish(root: string, relative: string, content: Buffer, expected: string | null, preimagePath?: string, catalog?: Catalog): ObjectValue {
  const file = safePath(root, relative);
  assertProductWriteTarget(relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  safePath(root, relative);
  const lock = path.join(path.dirname(file), `.${path.basename(file)}.product-write.lock`);
  let lockFd: number;
  try { lockFd = fs.openSync(lock, 'wx'); }
  catch (error: any) { throw new Error(error.code === 'EEXIST' ? 'WRITE_BUSY: another helper is writing this file; reads and other files remain available' : error.message); }
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const original = readExisting(root, relative);
    checkVersion(original, expected); frozen(root, relative, original ?? undefined);
    if (original?.equals(content)) return { status: 'unchanged', saved: true, changed: false, sha256: sha256(content) };
    let preimage: ObjectValue | null = null;
    if (original) {
      preimage = { sha256: sha256(original), data_base64: original.toString('base64') };
      if (preimagePath) {
        if (!catalog?.manifest || !allowed(catalog.manifest, preimagePath, 'capture')) throw new Error('PREIMAGE_OUT_OF_RANGE: explicit preimage destination must be in capture_paths/source_paths');
        const captured = captureBytes(catalog, preimagePath, original);
        if (!captured.saved) throw new Error(`PREIMAGE_UNSAVED: ${captured.error}`);
        preimage = { sha256: captured.source.sha256, source: captured.source };
      }
    }
    const mode = fs.existsSync(file) ? fs.statSync(file).mode : 0o666;
    const fd = fs.openSync(temp, 'wx', mode);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    checkVersion(readExisting(root, relative), expected);
    safePath(root, relative); frozen(root, relative, original ?? undefined);
    if (expected === null) {
      // link publishes a fully written file without overwriting a racing creator.
      fs.linkSync(temp, file); fs.unlinkSync(temp);
    } else fs.renameSync(temp, file);
    return { status: 'saved', saved: true, changed: true, sha256: sha256(content), preimage, io_guarantee: 'single-file atomic publication; helper-coordinated writers; external-editor race is not eliminated' };
  } finally {
    try { fs.unlinkSync(temp); } catch { /* no temporary file after successful publication */ }
    fs.closeSync(lockFd); fs.unlinkSync(lock);
  }
}
function applyPatches(text: string, patches: { start: number; end: number; text: string }[]): string {
  let prior = text.length;
  for (const patch of patches.sort((a,b) => b.start - a.start)) {
    if (patch.end > prior || patch.start < 0) throw new Error('PATCH_OVERLAP: selected changes overlap or lack a reliable location');
    text = text.slice(0, patch.start) + patch.text + text.slice(patch.end); prior = patch.start;
  }
  return text;
}
function lineEnding(text: string): string {
  return /\r\n|\n|\r/.exec(text)?.[0] ?? '\n';
}
// Document separators belong to the writer: keep every existing byte and only
// finish the current line / blank line needed before the next root heading.
function bodySeparator(text: string, eol: string): string {
  const lastLine = text.slice(Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1);
  if (lastLine) return /^[ \t]*$/.test(lastLine) ? eol : eol + eol;
  const end = text.length - (text.endsWith('\r\n') ? 2 : 1);
  const start = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf('\r', end - 1)) + 1;
  return /^[ \t]*$/.test(text.slice(start, end)) ? '' : eol;
}
function candidate(original: Buffer | null, operation: ObjectValue, parsed?: ProductDocument): { text: string; affected: string[] | null } {
  if ('content' in operation) {
    if (operation.updates || operation.append) throw new Error('AMBIGUOUS_INPUT: content and item updates cannot be combined');
    return { text: operation.content, affected: null };
  }
  if (!original) throw new Error('CONTENT_REQUIRED: a new document requires content');
  const text = decode(original);
  if (!parsed) throw new Error('CONTENT_REQUIRED: manifest updates require content');
  const patches: { start: number; end: number; text: string }[] = [];
  const affected: string[] = [];
  for (const update of operation.updates ?? []) {
    const items = parsed.items.filter(i => i.id === update.id);
    if (items.length !== 1 || items[0]!.start < 0) throw new Error(`ITEM_UNRESOLVED: cannot safely locate ${update.id}`);
    const item = items[0]!;
    if (affected.includes(item.id)) throw new Error('DUPLICATE_UPDATE: update each item once');
    affected.push(item.id);
    if (update.metadata || update.remove_fields?.length) {
      if ((update.metadata?.id !== undefined && update.metadata.id !== item.id) || (update.metadata?.type !== undefined && update.metadata.type !== item.type)) throw new Error('IDENTITY_CHANGE: stable ID/type cannot be repurposed in an update; append replacements and retain old items');
      const metadata = { ...item.metadata, ...update.metadata };
      for (const key of update.remove_fields ?? []) { if (['id', 'type'].includes(key)) throw new Error('IDENTITY_CHANGE: cannot remove identity'); delete metadata[key]; }
      if (JSON.stringify(metadata) !== JSON.stringify(item.metadata)) {
        const prior = text.slice(item.metadata_start, item.metadata_end);
        // A JSON flow map is valid YAML and replaces only the selected map's AST range.
        patches.push({ start: item.metadata_start, end: item.metadata_end, text: JSON.stringify(metadata) + (prior.endsWith('\r\n') ? '\r\n' : prior.endsWith('\n') ? '\n' : '') });
      }
    }
    if (update.body !== undefined && update.body !== item.body) {
      const separator = item.end < text.length ? bodySeparator(update.body, lineEnding(text)) : '';
      patches.push({ start: item.start, end: item.end, text: update.body + separator });
    }
  }
  if (operation.migrate === 'v2' && parsed.version === 1) {
    const yaml = strictYaml(text.slice(parsed.frontmatter_start, parsed.frontmatter_end), operation.path);
    const schema: any = yaml.doc.get('schema', true);
    patches.push({ start: parsed.frontmatter_start + schema.range[0], end: parsed.frontmatter_start + schema.range[1], text: 'vnext-product-doc/v2' });
  }
  let next = applyPatches(text, patches);
  if (operation.append?.length) {
    // Insert into items YAML and after EOF; retain existing Markdown bytes.
    const current = parseProduct(next, operation.path);
    const yaml = strictYaml(next.slice(current.frontmatter_start, current.frontmatter_end), operation.path);
    const sequence: any = yaml.doc.get('items', true);
    if (!isSeq(sequence) || !sequence.range || yaml.problems.length) throw new Error('APPEND_UNSAFE: items structure cannot be safely extended');
    if (sequence.flow) {
      const closing = current.frontmatter_start + sequence.range[1] - 1;
      if (next[closing] !== ']') throw new Error('APPEND_UNSAFE: flow sequence closing location is unavailable');
      let separator = '';
      const last: any = sequence.items.at(-1);
      if (last) {
        // The AST locates the last value; only punctuation/comments remain before ].
        const tail = next.slice(current.frontmatter_start + last.range[1], closing);
        const trailingComma = tail.replace(/#[^\r\n]*/g, '').includes(',');
        separator = trailingComma ? ' ' : ', ';
      }
      const additions = operation.append.map((a: any) => JSON.stringify(a.metadata)).join(', ');
      next = next.slice(0, closing) + separator + additions + next.slice(closing);
    } else {
      const insertion = current.frontmatter_start + sequence.range[1];
      const start = current.frontmatter_start + sequence.range[0];
      const lineStart = Math.max(next.lastIndexOf('\n', start - 1), next.lastIndexOf('\r', start - 1)) + 1;
      const indent = next.slice(lineStart, start);
      const eol = lineEnding(next);
      next = next.slice(0, insertion) + (/[\r\n]/.test(next[insertion - 1] ?? '') ? '' : eol) + operation.append.map((a: any) => `${indent}- ${JSON.stringify(a.metadata)}${eol}`).join('') + next.slice(insertion);
    }
    const eol = lineEnding(next);
    for (const addition of operation.append) next += bodySeparator(next, eol) + addition.body;
    affected.push(...operation.append.map((a: any) => a.metadata.id));
  }
  if (!operation.updates && !operation.append && !operation.migrate) throw new Error('CONTENT_REQUIRED: provide content, updates or explicit migration');
  return { text: next, affected };
}

// Sort object keys, but preserve array order everywhere except evidence source sets.
function canonical(value: any): string {
  function ordered(input: any): any {
    if (Array.isArray(input)) return input.map(ordered);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map(key => [key, ordered(input[key])]));
    return input;
  }
  return JSON.stringify(ordered(value));
}
function isRecord(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function relationList(value: unknown): ObjectValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function sourceKey(source: unknown): string | null {
  if (!isRecord(source)) return null;
  // Compare known evidence fields, without treating repairs/display fields as new material.
  if (source.kind === 'text' && typeof source.text === 'string') return canonical({ kind: 'text', text: source.text.replace(/\r\n|\r/g, '\n').trim() });
  if (source.kind === 'uri' && typeof source.uri === 'string') return canonical({ kind: 'uri', uri: source.uri });
  if (source.kind === 'file' && typeof source.path === 'string') {
    const lines = isRecord(source.lines) ? { start: source.lines.start, end: source.lines.end } : undefined;
    return canonical({ kind: 'file', path: source.path, item_id: source.item_id, section: source.section, lines, sha256: source.sha256 });
  }
  return null;
}
function hasNewBasis(old: ObjectValue, next: ObjectValue): boolean {
  const previous = new Set((Array.isArray(old.sources) ? old.sources : []).map(sourceKey).filter(key => key !== null));
  return typeof next.reason === 'string' && !!next.reason.trim() && Array.isArray(next.sources) && next.sources.some((source: unknown) => {
    const key = sourceKey(source);
    return key !== null && !previous.has(key);
  });
}
function relationIdentity(relation: ObjectValue, field: string): string {
  if (field === 'links') return canonical([relation.relation, relation.target]);
  const task = relation.task ?? {};
  const locator = { ...task.source };
  if (locator.kind === 'file') delete locator.sha256;
  const identity = task.task_id ? [task.task_id, task.step_id ?? null] : [sourceKey(locator), task.step_id ?? null];
  return canonical([identity, relation.role, relation.coverage]);
}
function unmatchedRelations(previous: ObjectValue[], next: ObjectValue[], field: string, allowUniqueCorrection = false) {
  const remaining = [...previous];
  const additions = [...next];
  // Match retained rows first, then edits of the same identity. Each old row
  // accounts for one next row; duplicate IDs neither veto edits nor hide revival.
  for (const exact of [true, false]) {
    for (let index = remaining.length - 1; index >= 0; index--) {
      const old = remaining[index]!;
      const match = additions.findIndex(relation => relation.id === old.id && (exact
        ? canonical(relation) === canonical(old)
        : relationIdentity(relation, field) === relationIdentity(old, field)));
      if (match >= 0) { remaining.splice(index, 1); additions.splice(match, 1); }
    }
  }
  // A unique ID still permits an ordinary identity correction. With duplicate
  // IDs, only an actual identity match can account for a retained history row.
  if (allowUniqueCorrection) {
    for (let index = remaining.length - 1; index >= 0; index--) {
      const old = remaining[index]!;
      if (previous.filter(relation => relation.id === old.id).length !== 1 || next.filter(relation => relation.id === old.id).length !== 1) continue;
      const match = additions.findIndex(relation => relation.id === old.id);
      if (match >= 0) { remaining.splice(index, 1); additions.splice(match, 1); }
    }
  }
  return { removed: remaining, added: additions };
}
function activatedRelations(previous: ObjectValue[], next: ObjectValue[], field: string): Set<ObjectValue> {
  return new Set(unmatchedRelations(previous.filter(relation => relation.state === 'active'), next.filter(relation => relation.state === 'active'), field).added);
}
function normalizedBody(body: string): string {
  return body.replace(/\r\n|\r/g, '\n').replace(/\n+$/, '');
}
function itemDiagnostics(item: Item): string {
  // Absolute lines and array indexes move when an earlier item is edited.
  return canonical(item.diagnostics.map(d => [d.code, d.severity, d.message, d.pointer?.replace(/^\/items\/\d+(?=\/|$)/, '')]).sort());
}
function changedItem(previous: ProductDocument | undefined, document: ProductDocument, next: Item): boolean {
  const old = previous?.items.find(item => item.id === next.id);
  if (!old || !previous) return true;
  return old.body !== next.body || canonical(old.metadata) !== canonical(next.metadata)
    || previous.text.slice(old.metadata_start, old.metadata_end) !== document.text.slice(next.metadata_start, next.metadata_end)
    || itemDiagnostics(old) !== itemDiagnostics(next);
}
function validateProductCandidate(previous: ProductDocument | undefined, next: ProductDocument, operation: ObjectValue, selectedIds: string[] | null, catalog: Catalog): string[] {
  const oldItems = previous?.items ?? [];
  const affected = selectedIds ?? next.items.filter(item => changedItem(previous, next, item)).map(item => item.id);
  for (const item of next.items) {
    if (!oldItems.some(old => old.id === item.id) && catalog.items.some(other => other.id === item.id && other.path !== operation.path)) throw new Error(`DUPLICATE_ID: ${item.id} already has a known current definition in another registered file`);
  }
  const removed = operation.remove_items ?? [];
  if (removed.length && !('content' in operation)) throw new Error('REMOVAL_INPUT: remove_items only declares removals in a whole-file candidate');
  for (const id of removed) if (!oldItems.some(item => item.id === id) || next.items.some(item => item.id === id)) throw new Error(`REMOVAL_INPUT: ${id} must be an existing item actually removed by this candidate`);
  for (const removal of operation.remove_relations ?? []) {
    const old = oldItems.find(item => item.id === removal.item_id);
    const kept = next.items.find(item => item.id === removal.item_id);
    const deleted = unmatchedRelations(relationList(old?.metadata[removal.field]), relationList(kept?.metadata[removal.field]), removal.field, true).removed;
    if (!deleted.some(relation => relation.id === removal.id)) throw new Error('REMOVAL_INPUT: remove_relations must name an existing relation actually removed');
  }
  for (const old of oldItems) {
    const kept = next.items.find(item => item.id === old.id);
    if (!kept) {
      if (!removed.includes(old.id)) throw new Error(`ITEM_REMOVAL_REQUIRED: explicitly declare removal of ${old.id}; IDs cannot be silently renamed`);
      affected.push(old.id);
      continue;
    }
    if (kept.type !== old.type) throw new Error('IDENTITY_CHANGE: stable ID/type cannot be repurposed; keep prior identity and append replacements');
    // Local patches must land in their selected AST region, including when a fence swallows a neighbor.
    if (selectedIds && !affected.includes(old.id) && normalizedBody(kept.body) !== normalizedBody(old.body)) throw new Error(`BODY_BOUNDARY: a local edit changed the body boundary of ${old.id}`);
    // The parser includes inter-item separators in the preceding body's range.
    // Only this local append's deterministic insertion after old EOF is exempt;
    // every original byte and every unrelated malformed YAML map stays exact.
    const separator = selectedIds && operation.append?.length && old.end === previous!.text.length
      ? bodySeparator(previous!.text, lineEnding(previous!.text)) : '';
    if (!old.usable && !affected.includes(old.id) && (kept.body !== old.body + separator || next.text.slice(kept.metadata_start, kept.metadata_end) !== previous!.text.slice(old.metadata_start, old.metadata_end))) throw new Error('INVALID_ITEM_CHANGED: unrelated malformed item must retain its original bytes');
    if (canonical(kept.metadata) === canonical(old.metadata)) continue;
    for (const field of ['links', 'task_bindings']) {
      if (canonical(kept.metadata[field]) === canonical(old.metadata[field])) continue;
      const oldRelations = relationList(old.metadata[field]);
      const nextRelations = relationList(kept.metadata[field]);
      const activated = activatedRelations(oldRelations, nextRelations, field);
      const dismissed = oldRelations.filter(relation => relation.state === 'dismissed');
      for (const activation of activated) {
        const identity = relationIdentity(activation, field);
        // Disambiguate shared IDs without waiving history when an ID is retargeted.
        const knownIdIdentity = dismissed.some(relation => relation.id === activation.id && relationIdentity(relation, field) === identity);
        const history = dismissed.filter(relation => relationIdentity(relation, field) === identity || (!knownIdIdentity && relation.id === activation.id));
        if (history.some(relation => !hasNewBasis(relation, activation))) throw new Error('DISMISSED_RELATION: reassociation requires a new explicit basis; reordered/repeated sources or a retry cannot revive a dismissed relation');
      }
      const unretained = unmatchedRelations(dismissed, nextRelations.filter(relation => relation.state === 'dismissed'), field, true).removed;
      const removedHistory = unmatchedRelations(unretained, [...activated], field, true).removed;
      for (const relation of removedHistory) {
        const explicitlyRemoved = operation.remove_relations?.some((r: ObjectValue) => r.item_id === old.id && r.field === field && r.id === relation.id)
          || operation.updates?.some((u: ObjectValue) => u.id === old.id && u.remove_fields?.includes(field) && kept.metadata[field] === undefined);
        if (!explicitlyRemoved) throw new Error('DISMISSED_REMOVAL: retain dismissed history unless an explicit field/relation removal is requested');
      }
    }
  }
  for (const fragment of [...(operation.updates ?? []), ...(operation.append ?? []).map((a: ObjectValue) => ({ id: a.metadata.id, body: a.body }))]) {
    if (fragment.body === undefined) continue;
    const item = next.items.find(item => item.id === fragment.id);
    if (!item || normalizedBody(item.body) !== normalizedBody(fragment.body)) throw new Error(`BODY_BOUNDARY: body must remain entirely inside ## [${fragment.id}], with no extra root heading or swallowed neighbor`);
  }
  const newRootErrors = next.diagnostics.filter(d => d.severity === 'error' && !d.item_id && !previous?.diagnostics.some(old => old.code === d.code && old.message === d.message && old.pointer === d.pointer));
  const selected = next.items.filter(item => affected.includes(item.id));
  const errors = [...newRootErrors, ...selected.flatMap(item => item.diagnostics.filter(d => d.severity === 'error'))];
  if (errors.length) throw new Error(`STRUCTURE_INVALID: ${errors.map(e => `${e.item_id ?? ''} ${e.pointer ?? ''} ${e.message}`).join('; ')}`);
  return [...new Set(affected)];
}
function validateManifestCandidate(text: string, file: string): void {
  const yaml = strictYaml(text, file);
  const errors = [...yaml.problems.map(p => p.diagnostic.message), ...validate(yaml.value, manifestSchema(2)).map(e => `${e.pointer}: ${e.message}`)];
  if (errors.length) throw new Error(`STRUCTURE_INVALID: ${errors.join('; ')}`);
  relativePath(yaml.value.entry);
  for (const p of [...yaml.value.managed_paths, ...yaml.value.source_paths, ...yaml.value.exclude_paths, ...(yaml.value.capture_paths ?? [])]) relativePath(p, true);
  if (!allowed(yaml.value, yaml.value.entry, 'managed')) throw new Error('MANIFEST_PATH: entry is outside managed_paths or excluded');
}
export function apply(root: string, input: ObjectValue): ObjectValue {
  const results: ObjectValue[] = [];
  for (const operation of input.files ?? []) {
    try {
      const catalog = readCatalog(root, { manifest: input.manifest });
      if (input.expected_manifest_sha256 !== undefined && catalog.manifest_sha256 !== input.expected_manifest_sha256 && !results.some(r => r.path === catalog.manifest_path && r.saved)) throw new Error('MANIFEST_CONFLICT: configuration differs from its read version');
      const isManifest = operation.path === catalog.manifest_path;
      if (!isManifest && (!catalog.manifest || !allowed(catalog.manifest, operation.path, 'managed'))) throw new Error('WRITE_OUT_OF_RANGE: candidate is outside managed_paths/excluded or product maintenance is not enabled');
      const original = readExisting(catalog.root, operation.path, input.max_file_bytes ?? 4 * 1024 * 1024);
      checkVersion(original, operation.expected_sha256); frozen(catalog.root, operation.path, original ?? undefined);
      let previous: ProductDocument | undefined;
      if (original) {
        const text = decode(original);
        let version: number | null;
        if (isManifest) {
          const schema = strictYaml(text, operation.path).value?.schema;
          version = schema === 'vnext-product-manifest/v1' ? 1 : schema === 'vnext-product-manifest/v2' ? 2 : null;
        } else {
          previous = parseProduct(text, operation.path);
          version = previous.version;
          if (previous.diagnostics.some(d => d.severity === 'error' && (!d.item_id || ['DUPLICATE_ID', 'ITEM_HEADING'].includes(d.code)))) throw new Error('ORIGINAL_UNRESOLVED: original identities/AST locations are ambiguous; preserve raw bytes and use an authorized raw repair');
        }
        if (!version) throw new Error('UNSUPPORTED_VERSION: edit raw source with ordinary authorized tools; no guessed migration');
        if (version === 1 && operation.migrate !== 'v2') throw new Error('V1_READ_ONLY: explicitly migrate this file to v2 before writing');
      }
      const next = candidate(original, operation, previous);
      if (Buffer.byteLength(next.text) > (input.max_file_bytes ?? 4 * 1024 * 1024)) throw new Error('WRITE_BYTE_LIMIT: candidate exceeds explicit file bound; no bytes were replaced');
      let diagnostics: any[] = [];
      if (isManifest) validateManifestCandidate(next.text, operation.path);
      else {
        const parsed = parseProduct(next.text, operation.path);
        if (parsed.version !== 2) throw new Error('V2_REQUIRED: new writes must use the v2 document protocol');
        next.affected = validateProductCandidate(previous, parsed, operation, next.affected, catalog);
        diagnostics = parsed.diagnostics;
      }
      const saved = publish(catalog.root, operation.path, Buffer.from(next.text, 'utf8'), operation.expected_sha256, operation.preimage_path, catalog);
      results.push({ path: operation.path, ...saved, affected_items: next.affected, diagnostics });
    } catch (error: any) { results.push({ path: operation.path, status: 'failed', saved: false, error: error.message }); }
  }
  const failures = results.filter(r => !r.saved).length;
  return { status: failures ? failures === results.length ? 'failed' : 'partial' : 'saved', files: results, task_operations: 'not-performed', association: 'not-evaluated', reconciliation: 'not-evaluated', transaction: 'per-file; no cross-file atomicity' };
}
function captureBytes(catalog: Catalog, relative: string, bytes: Buffer): ObjectValue {
  try {
    if (!catalog.manifest || !allowed(catalog.manifest, relative, 'capture')) throw new Error('CAPTURE_OUT_OF_RANGE: destination must be in capture_paths/source_paths and outside managed_paths/excludes');
    assertProductWriteTarget(relative);
    const existing = readExisting(catalog.root, relative), hash = sha256(bytes);
    if (existing) {
      if (!existing.equals(bytes)) throw new Error('CAPTURE_CONFLICT: destination already holds different bytes; keep both sources at explicit separate paths');
      return { status: 'unchanged', saved: true, source: { kind: 'file', path: relative, sha256: hash }, bytes: bytes.length, reused: true };
    }
    const saved = publish(catalog.root, relative, bytes, null);
    return { ...saved, source: { kind: 'file', path: relative, sha256: hash }, bytes: bytes.length, reused: false };
  } catch (error: any) { return { status: 'failed', saved: false, error: error.message }; }
}
export function capture(root: string, input: ObjectValue): ObjectValue {
  const catalog = readCatalog(root, { manifest: input.manifest });
  try {
    if (input.expected_manifest_sha256 !== undefined && catalog.manifest_sha256 !== input.expected_manifest_sha256) throw new Error('MANIFEST_CONFLICT: capture scope changed');
    if (['text', 'base64', 'source_path'].filter(k => k in input).length !== 1) throw new Error('CAPTURE_INPUT: provide exactly one obtained text, exact base64 or registered source_path');
    let bytes: Buffer;
    if ('text' in input) bytes = Buffer.from(input.text, 'utf8');
    else if ('base64' in input) {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw new Error('BASE64_INVALID: expected canonical base64');
      bytes = Buffer.from(input.base64, 'base64');
    } else {
      if (!catalog.manifest || !allowed(catalog.manifest, input.source_path, 'source')) throw new Error('SOURCE_OUT_OF_RANGE: selected file must be registered for reading');
      safePath(catalog.root, input.source_path);
      const stat = storeStat(catalog.root, input.source_path);
      if (stat.size > (input.max_file_bytes ?? 4 * 1024 * 1024)) throw new Error('CAPTURE_BYTE_LIMIT: selected file exceeds limit; raise the explicit bound for this authorized source');
      bytes = storeReadFile(catalog.root, input.source_path);
      if (sha256(bytes) !== stat.sha256) throw new Error('SOURCE_READ_CHANGED: selected source changed during capture; retry with the current source');
    }
    if (bytes.length > (input.max_file_bytes ?? 4 * 1024 * 1024)) throw new Error('CAPTURE_BYTE_LIMIT: selected content exceeds explicit bound');
    return { ...captureBytes(catalog, input.path, bytes), raw_capture: true, metadata: 'not-saved-by-capture', task_operations: 'not-performed', privacy: 'ordinary project file; no Git ignore, sharing, redaction or history deletion guarantee' };
  } catch (error: any) { return { status: 'failed', saved: false, error: error.message, raw_capture: false }; }
}

export function newDocument(items: { metadata: ObjectValue; body: string }[], title = '项目业务资料'): string {
  return `---\n${stringify({ schema: 'vnext-product-doc/v2', items: items.map(i => i.metadata) }, { lineWidth: 0, aliasDuplicateObjects: false })}---\n# ${title}\n\n${items.map(i => i.body).join('\n\n')}\n`;
}
