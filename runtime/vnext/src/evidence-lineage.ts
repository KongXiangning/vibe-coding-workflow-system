import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type EvidenceObject = { path: string; sha256: string; size: number };
const MAX_OBJECT_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * MAX_OBJECT_BYTES;

function hash(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function safeRepositoryFile(root: string, relative: string): string {
  if (!relative || relative.includes('\\') || relative.startsWith('/') || relative.includes(':')
    || relative.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part))) {
    throw new Error('EVIDENCE_OBJECT_PATH_INVALID: expected a bounded repository-relative file.');
  }
  let cursor = path.resolve(root);
  if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('EVIDENCE_OBJECT_PATH_INVALID: symbolic root.');
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('EVIDENCE_OBJECT_PATH_INVALID: symbolic paths are unsupported.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return cursor;
}

function readBounded(file: string): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_OBJECT_BYTES) throw new Error('EVIDENCE_OBJECT_UNSUPPORTED: requires a regular file of at most 1 MiB.');
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_OBJECT_BYTES) throw new Error('EVIDENCE_OBJECT_UNSUPPORTED: file exceeded the limit while reading.');
  return bytes;
}

export function describeEvidenceObjects(root: string, paths: string[]): EvidenceObject[] {
  const unique = [...new Set(paths.map(item => item.split('#')[0]!))].sort();
  if (unique.length > 128) throw new Error('EVIDENCE_OBJECT_BUDGET_EXHAUSTED: too many snapshot files.');
  let total = 0;
  return unique.map(relative => {
    const bytes = readBounded(safeRepositoryFile(root, relative));
    total += bytes.length;
    if (total > MAX_SNAPSHOT_BYTES) throw new Error('EVIDENCE_OBJECT_BUDGET_EXHAUSTED: snapshot exceeds 8 MiB.');
    return { path: relative, sha256: hash(bytes), size: bytes.length };
  });
}

function objectFile(root: string, currentPath: string, sha: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('EVIDENCE_OBJECT_INVALID: invalid digest.');
  const relative = path.relative(root, path.join(path.dirname(currentPath), 'evidence-objects', `${sha}.blob`)).replace(/\\/g, '/');
  return safeRepositoryFile(root, relative);
}

export function readEvidenceObject(root: string, currentPath: string, object: EvidenceObject): Buffer {
  verifyEvidenceObject(root, currentPath, object);
  return readBounded(objectFile(root, currentPath, object.sha256));
}

export function preserveEvidenceObjects(root: string, currentPath: string, objects: EvidenceObject[]): void {
  for (const object of objects) {
    const bytes = readBounded(safeRepositoryFile(root, object.path));
    if (hash(bytes) !== object.sha256 || bytes.length !== object.size) throw new Error('EVIDENCE_OBJECT_STALE: source changed before preservation.');
    const file = objectFile(root, currentPath, object.sha256);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    verifyEvidenceObject(root, currentPath, object);
  }
}

export function verifyEvidenceObject(root: string, currentPath: string, object: EvidenceObject): void {
  const bytes = readBounded(objectFile(root, currentPath, object.sha256));
  if (hash(bytes) !== object.sha256 || bytes.length !== object.size) throw new Error('EVIDENCE_OBJECT_CORRUPT: immutable evidence object changed.');
}

export function ingestEvidenceText(root: string, currentPath: string, input: { body: string; source_locator: string; source_revision: string; task_id: string; document_id: string }, dryRun: boolean): { evidence_ref: string; evidence_sha256: string; provenance_ref: string } {
  const bytes = Buffer.from(input.body, 'utf8');
  if (!bytes.length || bytes.length > MAX_OBJECT_BYTES || input.source_locator.length > 2048) throw new Error('EVIDENCE_OBJECT_UNSUPPORTED: bounded evidence body and source locator required.');
  const sha = hash(bytes);
  const file = objectFile(root, currentPath, sha);
  const provenance = JSON.stringify({ kind: 'ingested-evidence/v1', ...input, body: undefined, evidence_sha256: sha, assurance: 'caller-reported' }) + '\n';
  const metadata = objectFile(root, currentPath, hash(Buffer.from(provenance)));
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const [target, content] of [[file, bytes], [metadata, Buffer.from(provenance)]] as const) {
      if (!fs.existsSync(target)) {
        const fd = fs.openSync(target, 'wx');
        try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      if (!fs.readFileSync(target).equals(content)) throw new Error('EVIDENCE_OBJECT_CORRUPT: stored evidence differs.');
    }
  }
  return { evidence_ref: path.relative(root, file).replace(/\\/g, '/'), evidence_sha256: sha, provenance_ref: path.relative(root, metadata).replace(/\\/g, '/') };
}
