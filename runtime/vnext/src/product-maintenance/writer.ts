import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify } from 'yaml';
import { readCatalog } from './catalog';
import { type Catalog, type ObjectValue } from './model';
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

// The lock only coordinates this helper's short I/O on one path. External editors
// do not participate: digest recheck + rename is not a universal filesystem CAS.
function publish(root: string, relative: string, content: Buffer, expected: string | null, preimagePath?: string, catalog?: Catalog): ObjectValue {
  const file = safePath(root, relative);
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
function candidate(original: Buffer | null, operation: ObjectValue): { text: string; affected: string[] | null } {
  if ('content' in operation) {
    if (operation.updates || operation.append) throw new Error('AMBIGUOUS_INPUT: content and item updates cannot be combined');
    return { text: operation.content, affected: null };
  }
  if (!original) throw new Error('CONTENT_REQUIRED: a new document requires content');
  const text = decode(original), parsed = parseProduct(text, operation.path);
  if (!parsed.version) throw new Error('UNSUPPORTED_VERSION: edit raw source with ordinary authorized tools; no guessed migration');
  if (parsed.version === 1 && operation.migrate !== 'v2') throw new Error('V1_READ_ONLY: explicitly migrate this file to v2 before writing');
  const patches: { start: number; end: number; text: string }[] = [];
  const affected: string[] = [];
  for (const update of operation.updates ?? []) {
    const items = parsed.items.filter(i => i.id === update.id);
    if (items.length !== 1 || items[0]!.start < 0) throw new Error(`ITEM_UNRESOLVED: cannot safely locate ${update.id}`);
    const item = items[0]!;
    if (affected.includes(item.id)) throw new Error('DUPLICATE_UPDATE: update each item once');
    affected.push(item.id);
    if (update.metadata) {
      if ((update.metadata.id !== undefined && update.metadata.id !== item.id) || (update.metadata.type !== undefined && update.metadata.type !== item.type)) throw new Error('IDENTITY_CHANGE: stable ID/type cannot be repurposed in an update; append replacements and retain old items');
      const metadata = { ...item.metadata, ...update.metadata };
      for (const field of ['links', 'task_bindings']) {
        for (const old of item.metadata[field] ?? []) {
          const replacement = metadata[field]?.find((r: any) => r.id === old.id);
          if (old.state === 'dismissed' && replacement?.state === 'active' && !(replacement.reason && replacement.sources?.length && JSON.stringify(replacement.sources) !== JSON.stringify(old.sources))) throw new Error('DISMISSED_RELATION: reassociation requires a new explicit basis; a retry must not revive a dismissed relation');
        }
      }
      for (const key of update.remove_fields ?? []) { if (['id', 'type'].includes(key)) throw new Error('IDENTITY_CHANGE: cannot remove identity'); delete metadata[key]; }
      if (JSON.stringify(metadata) !== JSON.stringify(item.metadata)) {
        const prior = text.slice(item.metadata_start, item.metadata_end);
        // A JSON flow map is valid YAML and replaces only the selected map's AST range.
        patches.push({ start: item.metadata_start, end: item.metadata_end, text: JSON.stringify(metadata) + (prior.endsWith('\r\n') ? '\r\n' : prior.endsWith('\n') ? '\n' : '') });
      }
    }
    if (update.body !== undefined && update.body !== item.body) patches.push({ start: item.start, end: item.end, text: update.body });
  }
  if (operation.migrate === 'v2' && parsed.version === 1) {
    const yaml = strictYaml(text.slice(parsed.frontmatter_start, parsed.frontmatter_end), operation.path);
    const schema: any = yaml.doc.get('schema', true);
    patches.push({ start: parsed.frontmatter_start + schema.range[0], end: parsed.frontmatter_start + schema.range[1], text: 'vnext-product-doc/v2' });
  }
  let next = applyPatches(text, patches);
  if (operation.append?.length) {
    // Appending changes items YAML only. Existing Markdown bodies remain exact.
    const current = parseProduct(next, operation.path);
    const yaml = strictYaml(next.slice(current.frontmatter_start, current.frontmatter_end), operation.path);
    const sequence: any = yaml.doc.get('items', true);
    if (!sequence || yaml.problems.length) throw new Error('APPEND_UNSAFE: items structure cannot be safely extended');
    if (sequence.flow) {
      const values = yaml.value.items.concat(operation.append.map((a: any) => a.metadata));
      next = applyPatches(next, [{ start: current.frontmatter_start + sequence.range[0], end: current.frontmatter_start + sequence.range[1], text: JSON.stringify(values) + (next[current.frontmatter_start + sequence.range[1] - 1] === '\n' ? '\n' : '') }]);
    } else {
      const insertion = current.frontmatter_start + sequence.range[1];
      const eol = next.includes('\r\n') ? '\r\n' : '\n';
      next = next.slice(0, insertion) + (next[insertion - 1] === '\n' ? '' : eol) + operation.append.map((a: any) => `  - ${JSON.stringify(a.metadata)}${eol}`).join('') + next.slice(insertion);
    }
    next += (/\r?\n\r?\n$/.test(next) ? '' : next.endsWith('\n') ? '\n' : '\n\n') + operation.append.map((a: any) => a.body).join('\n\n');
    affected.push(...operation.append.map((a: any) => a.metadata.id));
  }
  if (!operation.updates && !operation.append && !operation.migrate) throw new Error('CONTENT_REQUIRED: provide content, updates or explicit migration');
  return { text: next, affected };
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
      const next = candidate(original, operation);
      if (Buffer.byteLength(next.text) > (input.max_file_bytes ?? 4 * 1024 * 1024)) throw new Error('WRITE_BYTE_LIMIT: candidate exceeds explicit file bound; no bytes were replaced');
      let diagnostics: any[] = [];
      if (isManifest) validateManifestCandidate(next.text, operation.path);
      else {
        const parsed = parseProduct(next.text, operation.path);
        if (parsed.version !== 2) throw new Error('V2_REQUIRED: new writes must use the v2 document protocol');
        const selected = next.affected === null ? parsed.items : parsed.items.filter(i => next.affected!.includes(i.id));
        const originalDiagnostics = original ? parseProduct(decode(original), operation.path).diagnostics : [];
        const newRootErrors = parsed.diagnostics.filter(d => d.severity === 'error' && !d.item_id && !originalDiagnostics.some(old => old.code === d.code && old.message === d.message && old.pointer === d.pointer));
        const errors = next.affected === null ? parsed.diagnostics.filter(d => d.severity === 'error') : [...newRootErrors, ...selected.flatMap(i => i.diagnostics.filter(d => d.severity === 'error')), ...next.affected.filter(id => !selected.some(i => i.id === id)).map(id => ({ message: `Missing updated item ${id}` }))];
        if (errors.length) throw new Error(`STRUCTURE_INVALID: ${errors.map(e => `${e.item_id ?? ''} ${e.pointer ?? ''} ${e.message}`).join('; ')}`);
        if (original) {
          const previous = parseProduct(decode(original), operation.path);
          for (const old of previous.items.filter(i => !i.usable && !next.affected?.includes(i.id))) {
            const kept = parsed.items.find(i => i.id === old.id);
            if (!kept || kept.body !== old.body || next.text.slice(kept.metadata_start, kept.metadata_end) !== previous.text.slice(old.metadata_start, old.metadata_end)) throw new Error('INVALID_ITEM_CHANGED: unrelated malformed item must retain its original bytes');
          }
        }
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
      const file = safePath(catalog.root, input.source_path);
      if (!fs.statSync(file).isFile()) throw new Error('CAPTURE_INPUT: selected source must be a regular file');
      if (fs.statSync(file).size > (input.max_file_bytes ?? 4 * 1024 * 1024)) throw new Error('CAPTURE_BYTE_LIMIT: selected file exceeds limit; raise the explicit bound for this authorized source');
      bytes = fs.readFileSync(file);
    }
    if (bytes.length > (input.max_file_bytes ?? 4 * 1024 * 1024)) throw new Error('CAPTURE_BYTE_LIMIT: selected content exceeds explicit bound');
    return { ...captureBytes(catalog, input.path, bytes), raw_capture: true, metadata: 'not-saved-by-capture', task_operations: 'not-performed', privacy: 'ordinary project file; no Git ignore, sharing, redaction or history deletion guarantee' };
  } catch (error: any) { return { status: 'failed', saved: false, error: error.message, raw_capture: false }; }
}

export function newDocument(items: { metadata: ObjectValue; body: string }[], title = '项目业务资料'): string {
  return `---\n${stringify({ schema: 'vnext-product-doc/v2', items: items.map(i => i.metadata) }, { lineWidth: 0, aliasDuplicateObjects: false })}---\n# ${title}\n\n${items.map(i => i.body).join('\n\n')}\n`;
}
