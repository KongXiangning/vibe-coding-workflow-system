import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkflowDocPath, getWorkflowProfilePath, loadProfile } from './runtime-io';

const SHA256 = /^[a-f0-9]{64}$/u;
const REVIEW_PREIMAGE_DIRECTORY = 'review-preimages';

export type ReviewPreimageWrite = {
  sha256: string;
  content: Buffer;
};

export type ReviewPreimageStoreErrorCode =
  | 'REVIEW_BASELINE_PATH_INVALID'
  | 'REVIEW_BASELINE_PERSISTENCE_FAILED'
  | 'REVIEW_BASELINE_MISSING'
  | 'REVIEW_BASELINE_CORRUPT'
  | 'REVIEW_BASELINE_HASH_MISMATCH'
  | 'REVIEW_BASELINE_INLINE_INVALID';

export class ReviewPreimageStoreError extends Error {
  readonly code: ReviewPreimageStoreErrorCode;

  constructor(code: ReviewPreimageStoreErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ReviewPreimageStoreError';
    this.code = code;
  }
}

function assertDigest(value: string): string {
  if (!SHA256.test(value)) throw new ReviewPreimageStoreError('REVIEW_BASELINE_PATH_INVALID', 'review preimage identity must be a lowercase SHA-256 digest.');
  return value;
}

function relativePath(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget).replace(/\\/gu, '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new ReviewPreimageStoreError('REVIEW_BASELINE_PATH_INVALID', 'review preimage storage path escapes the project root.');
  }
  return relative;
}

function assertNoSymlink(root: string, target: string): void {
  const relative = relativePath(root, target);
  let cursor = path.resolve(root);
  for (const component of relative.split('/')) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw new ReviewPreimageStoreError('REVIEW_BASELINE_PATH_INVALID', `review preimage storage traverses a symbolic link: ${relative}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
}

export function reviewPreimageDirectory(root: string): string {
  const profile = loadProfile(getWorkflowProfilePath(root));
  const directory = getWorkflowDocPath(root, profile, REVIEW_PREIMAGE_DIRECTORY);
  assertNoSymlink(root, directory);
  return directory;
}

export function reviewPreimageBlobPath(root: string, sha256: string): string {
  const digest = assertDigest(sha256);
  const directory = reviewPreimageDirectory(root);
  const file = path.join(directory, `${digest}.blob`);
  assertNoSymlink(root, file);
  return file;
}

function verifyContent(digest: string, content: Buffer): void {
  if (sha256(content) !== digest) {
    throw new ReviewPreimageStoreError('REVIEW_BASELINE_HASH_MISMATCH', `review preimage bytes do not match ${digest}.`);
  }
}

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function verifyExistingBlob(file: string, digest: string, expected: Buffer): void {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ReviewPreimageStoreError('REVIEW_BASELINE_MISSING', `review preimage blob is missing: ${digest}.blob`);
    throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `review preimage blob cannot be inspected: ${digest}.blob`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `review preimage blob is not a regular file: ${digest}.blob`);
  let content: Buffer;
  try { content = fs.readFileSync(file); }
  catch { throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `review preimage blob cannot be read: ${digest}.blob`); }
  verifyContent(digest, content);
  if (!content.equals(expected)) throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `immutable review preimage blob conflicts with ${digest}.blob`);
}

/**
 * Persist raw immutable baseline bytes under their content address. Existing
 * blobs are never overwritten; an existing address must contain the exact
 * same verified bytes.
 */
export function persistReviewPreimage(root: string, digest: string, content: Buffer): void {
  const address = assertDigest(digest);
  verifyContent(address, content);
  const directory = reviewPreimageDirectory(root);
  fs.mkdirSync(directory, { recursive: true });
  assertNoSymlink(root, directory);
  const file = reviewPreimageBlobPath(root, address);
  if (fs.existsSync(file)) {
    verifyExistingBlob(file, address, content);
    return;
  }

  const temporary = path.join(directory, `.${address}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      fs.renameSync(temporary, file);
    } catch (error) {
      if (!fs.existsSync(file)) throw error;
      verifyExistingBlob(file, address, content);
    }
    if (!fs.existsSync(file)) throw new ReviewPreimageStoreError('REVIEW_BASELINE_PERSISTENCE_FAILED', `review preimage blob was not published: ${address}.blob`);
    verifyExistingBlob(file, address, content);
  } catch (error) {
    if (error instanceof ReviewPreimageStoreError) throw error;
    throw new ReviewPreimageStoreError('REVIEW_BASELINE_PERSISTENCE_FAILED', `review preimage blob could not be persisted: ${address}.blob`);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best-effort cleanup */ }
    }
    if (fs.existsSync(temporary)) {
      try { fs.unlinkSync(temporary); } catch { /* best-effort cleanup */ }
    }
  }
}

export function persistReviewPreimageWrites(root: string, writes: readonly ReviewPreimageWrite[]): void {
  const unique = new Map<string, Buffer>();
  for (const write of writes) {
    const digest = assertDigest(write.sha256);
    const prior = unique.get(digest);
    if (prior && !prior.equals(write.content)) {
      throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `one execution produced conflicting bytes for ${digest}.`);
    }
    unique.set(digest, Buffer.from(write.content));
  }
  for (const [digest, content] of unique) persistReviewPreimage(root, digest, content);
}

export function readReviewPreimageBlob(root: string, digest: string): Buffer {
  const address = assertDigest(digest);
  const file = reviewPreimageBlobPath(root, address);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ReviewPreimageStoreError('REVIEW_BASELINE_MISSING', `review preimage blob is missing: ${address}.blob`);
    throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `review preimage blob cannot be inspected: ${address}.blob`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `review preimage blob is not a regular file: ${address}.blob`);
  let content: Buffer;
  try { content = fs.readFileSync(file); }
  catch { throw new ReviewPreimageStoreError('REVIEW_BASELINE_CORRUPT', `review preimage blob cannot be read: ${address}.blob`); }
  if (sha256(content) !== address) throw new ReviewPreimageStoreError('REVIEW_BASELINE_HASH_MISMATCH', `review preimage blob hash does not match ${address}.blob`);
  return content;
}

function record(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function decodeBase64(value: unknown, pathLabel: string): Buffer {
  if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value) {
    throw new ReviewPreimageStoreError('REVIEW_BASELINE_INLINE_INVALID', `legacy inline review preimage is not canonical base64: ${pathLabel}.`);
  }
  return Buffer.from(value, 'base64');
}

/** Decode one readable legacy inline preimage. New preimages have no inline field. */
export function decodeLegacyReviewPreimage(value: unknown): ReviewPreimageWrite | null {
  const item = record(value);
  if (!item || (item.state !== 'file' && item.state !== 'symlink' && item.state !== 'absent') || typeof item.path !== 'string') {
    throw new ReviewPreimageStoreError('REVIEW_BASELINE_INLINE_INVALID', 'legacy inline review preimage has an invalid identity.');
  }
  if (!Object.prototype.hasOwnProperty.call(item, 'content_base64')) return null;
  const state = item.state;
  if (state === 'absent') {
    if (item.content_base64 !== null || item.sha256 !== null) throw new ReviewPreimageStoreError('REVIEW_BASELINE_INLINE_INVALID', `absent legacy review preimage is invalid: ${item.path}.`);
    return null;
  }
  if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) throw new ReviewPreimageStoreError('REVIEW_BASELINE_INLINE_INVALID', `legacy review preimage hash is invalid: ${item.path}.`);
  const content = decodeBase64(item.content_base64, item.path);
  verifyContent(item.sha256, content);
  return { sha256: item.sha256, content };
}

/** Persist all legacy inline review baselines before their canonical field is stripped. */
export function persistLegacyReviewPreimages(root: string, preimages: readonly unknown[]): void {
  const writes: ReviewPreimageWrite[] = [];
  for (const preimage of preimages) {
    const write = decodeLegacyReviewPreimage(preimage);
    if (write) writes.push(write);
  }
  persistReviewPreimageWrites(root, writes);
}
