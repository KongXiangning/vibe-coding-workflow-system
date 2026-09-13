/** Bounded, caller-reported document references; never document contents or authority. */
export type ProjectDocument = { path: string; section: string; revision: string; purpose: string };
const heading = '### Project documents';
function invalid(message: string): never { throw new Error(`PROJECT_DOCUMENTS_INVALID: ${message}`); }
export function normalizeProjectDocuments(value: unknown): ProjectDocument[] {
  if (!Array.isArray(value) || value.length > 64) invalid('expected at most 64 document references');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'path,purpose,revision,section') invalid(`reference ${index} fields mismatch`);
    const result = {} as ProjectDocument;
    for (const key of ['path', 'section', 'revision', 'purpose'] as const) {
      const text = entry[key];
      if (typeof text !== 'string' || !text.trim() || text.length > 1024 || /[\r\n\x00-\x1f]/u.test(text)) invalid(`reference ${index}.${key} must be bounded single-line text`);
      result[key] = text.trim();
    }
    if (result.path.includes('\\') || result.path.includes(':') || result.path.startsWith('/')
      || result.path.split('/').some(part => !part || part === '.' || part === '..')) invalid('path must be repository-relative with forward slashes');
    const identity = JSON.stringify([result.path, result.section]);
    if (seen.has(identity)) invalid('duplicate path and section');
    seen.add(identity);
    return result;
  });
}
export function renderProjectDocuments(value: ProjectDocument[] | undefined): string {
  return value === undefined ? '' : `\n\n${heading}\n\n\`\`\`json\n${JSON.stringify({ version: 1, sources: normalizeProjectDocuments(value) })}\n\`\`\``;
}
export function readProjectDocuments(background: string): ProjectDocument[] | null {
  const normalized = background.replace(/\r\n?/gu, '\n');
  const sections = normalized.split(/^### Project documents\s*$/mu);
  if (sections.length === 1) return null; // Historical task: unrecorded, not a claim of no applicable sources.
  if (sections.length !== 2) invalid('duplicate section');
  const content = sections[1]!.split(/^#{1,3} /mu)[0]!.trim();
  const match = /^```json\n([^]*?)\n```$/u.exec(content);
  if (!match) invalid('expected versioned JSON block');
  let value: any;
  try { value = JSON.parse(match[1]!); } catch { invalid('malformed JSON'); }
  if (!value || Object.keys(value).sort().join(',') !== 'sources,version' || value.version !== 1) invalid('unsupported record version or fields');
  return normalizeProjectDocuments(value.sources);
}
