/** Transport artifacts only; canonical task state remains owned by Runtime. */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

const OUTPUT_ROOT = path.join(os.tmpdir(), 'vnext-entry-results');
export type OutputReference = { path: string; sha256: string; bytes: number };

export function createEntryOutputDirectory(): string {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(path.join(OUTPUT_ROOT, 'run-'));
}
export function retainEntryOutput(directory: string, name: string, value: unknown): OutputReference {
  const file = path.join(directory, name + '.json');
  const data = Buffer.from(JSON.stringify(value), 'utf8');
  fs.writeFileSync(file, data, { flag: 'wx', mode: 0o600 });
  return { path: file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function runEntryOutputReadCli(): Promise<number> {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const reference = input.reference as OutputReference;
    const file = path.resolve(reference.path);
    const relative = path.relative(OUTPUT_ROOT, file);
    if (!/^run-[^/\\]+[/\\][^/\\]+\.json$/u.test(relative)
      || fs.realpathSync(file) !== path.join(fs.realpathSync(OUTPUT_ROOT), relative)) {
      throw new Error('Reference must name an entry output artifact, without symlink traversal.');
    }
    const offset = input.offset ?? 0;
    const maxBytes = input.max_bytes ?? 8192;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 65536) {
      throw new Error('offset must be nonnegative; max_bytes must be between 256 and 65536.');
    }
    const descriptor = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(descriptor).size;
      if (size !== reference.bytes || offset > size || await hashFile(file) !== reference.sha256) {
        throw new Error('Output reference changed; do not merge pages from different receipts.');
      }
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, size - offset));
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (read && (buffer[0]! & 0xc0) === 0x80) throw new Error('offset must be a returned UTF-8 page boundary.');
      let end = Math.min(maxBytes, read);
      if (offset + end < size) {
        while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
      }
      console.log(JSON.stringify({ kind: 'entry-output-page/v1', reference, offset,
        content: buffer.subarray(0, end).toString('utf8'),
        next_offset: offset + end < size ? offset + end : null }, null, 2));
      return 0;
    } finally { fs.closeSync(descriptor); }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
