import * as fs from 'node:fs';
import * as path from 'node:path';
import { diagnostic, type Catalog, type ObjectValue } from './model';
import { decode, parseProduct, requirementDigest, sha256, strictYaml } from './parser';
import { allowed, enumerate, matches, relativePath, safePath } from './paths';
import { manifestSchema, validate } from './schemas';
import { analyze } from './plans';

export function readCatalog(rootInput: string, input: ObjectValue = {}): Catalog {
  const root = fs.realpathSync(path.resolve(rootInput));
  const manifestPath = input.manifest ?? '.workflow-system/PRODUCT.yaml';
  const catalog: Catalog = { root, manifest_path: manifestPath, manifest: null, manifest_sha256: null, status: 'unavailable', documents: [], items: [], byId: new Map(), diagnostics: [], coverage: { complete: false, files_read: 0, bytes_read: 0, enumeration: 'managed_paths only; sources are read only by explicit reference', omitted: [] } };
  const maxFileBytes = input.max_file_bytes ?? 4 * 1024 * 1024;
  const maxTotalBytes = input.max_total_bytes ?? 32 * 1024 * 1024;
  const maxFiles = input.max_files ?? 1000;
  let bytes: Buffer;
  try {
    const file = safePath(root, manifestPath);
    if (!fs.existsSync(file)) { catalog.status = 'not-enabled'; catalog.diagnostics.push(diagnostic('NOT_ENABLED', manifestPath, 'No product manifest; normal task work may continue')); return catalog; }
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > maxFileBytes) throw new Error('Manifest is not a regular bounded file');
    bytes = fs.readFileSync(file);
  } catch (error: any) { catalog.diagnostics.push(diagnostic('MANIFEST_UNAVAILABLE', manifestPath, error.message, { severity: 'error' })); return catalog; }
  catalog.manifest_sha256 = sha256(bytes);
  let yaml;
  try { yaml = strictYaml(decode(bytes), manifestPath); }
  catch (error: any) { catalog.diagnostics.push(diagnostic('MANIFEST_ENCODING', manifestPath, error.message, { severity: 'error' })); return catalog; }
  catalog.diagnostics.push(...yaml.problems.map(p => p.diagnostic));
  const version = yaml.value?.schema === 'vnext-product-manifest/v2' ? 2 : yaml.value?.schema === 'vnext-product-manifest/v1' ? 1 : null;
  if (!version) { catalog.status = 'unsupported'; catalog.diagnostics.push(diagnostic('UNSUPPORTED_VERSION', manifestPath, 'Manifest version is unsupported; raw document may still be read normally')); return catalog; }
  catalog.diagnostics.push(...validate(yaml.value, manifestSchema(version)).map(e => diagnostic('MANIFEST_METADATA', manifestPath, e.message, { severity: 'error', pointer: e.pointer })));
  if (catalog.diagnostics.some(d => d.severity === 'error')) return catalog;
  const manifest = yaml.value;
  try {
    relativePath(manifest.entry);
    for (const p of [...manifest.managed_paths, ...manifest.source_paths, ...manifest.exclude_paths, ...(manifest.capture_paths ?? [])]) relativePath(p, true);
    if (!allowed(manifest, manifest.entry, 'managed')) throw new Error('Manifest entry must be within managed_paths and not excluded');
  } catch (error: any) { catalog.diagnostics.push(diagnostic('MANIFEST_PATH', manifestPath, error.message, { severity: 'error' })); return catalog; }
  catalog.manifest = manifest;
  catalog.status = 'available';
  const selected = input.paths ?? manifest.managed_paths;
  const enumeration = enumerate(root, selected, manifest.exclude_paths, maxFiles, catalog.diagnostics);
  let bytesRead = 0;
  for (const relative of enumeration.paths) {
    if (!allowed(manifest, relative, 'managed')) { catalog.diagnostics.push(diagnostic('NOT_MANAGED', relative, 'Selected file is not managed')); continue; }
    if (matches(relative, manifest.capture_paths)) {
      catalog.diagnostics.push(diagnostic('CURRENT_RAW_OVERLAP', relative, 'Raw/history cannot be current managed documents', { severity: 'error' }));
      catalog.coverage.omitted.push(relative);
      continue;
    }
    try {
      const file = safePath(root, relative), stat = fs.statSync(file);
      if (stat.size > maxFileBytes || bytesRead + stat.size > maxTotalBytes) { catalog.coverage.omitted.push(relative); catalog.diagnostics.push(diagnostic('BYTE_LIMIT', relative, 'File/total byte limit exceeded; this document was not read')); continue; }
      const docBytes = fs.readFileSync(file);
      bytesRead += docBytes.length;
      const document = parseProduct(decode(docBytes), relative);
      document.sha256 = sha256(docBytes);
      catalog.documents.push(document);
      catalog.items.push(...document.items);
      catalog.diagnostics.push(...document.diagnostics);
    } catch (error: any) { catalog.coverage.omitted.push(relative); catalog.diagnostics.push(diagnostic('DOCUMENT_UNAVAILABLE', relative, error.message, { severity: 'error' })); }
  }
  for (const item of catalog.items) {
    const sameIds = catalog.items.filter(i => i.id === item.id);
    if (sameIds.length > 1) {
      item.usable = false;
      catalog.diagnostics.push(diagnostic('AMBIGUOUS_ID', item.path, `ID ${item.id} has multiple current definitions; no newest-file selection`, { severity: 'error', item_id: item.id }));
    }
    if (item.usable) {
      if (item.type === 'requirement') item.definition_sha256 = requirementDigest(item);
      catalog.byId.set(item.id, item);
    }
  }
  const projects = catalog.items.filter(i => i.usable && i.type === 'project');
  if (projects.length !== 1 || projects[0]?.path !== manifest.entry) catalog.diagnostics.push(diagnostic('PROJECT_ENTRY', manifestPath, 'Expected a unique project entry in the manifest entry document'));
  analyze(catalog);
  catalog.coverage = { ...catalog.coverage, complete: !enumeration.incomplete && !catalog.coverage.omitted.length, files_read: catalog.documents.length, bytes_read: bytesRead, max_files: maxFiles, max_file_bytes: maxFileBytes, max_total_bytes: maxTotalBytes, usable_count: catalog.items.filter(i => i.usable).length, invalid_count: catalog.items.filter(i => !i.usable).length };
  return catalog;
}
