/** Administrative entrypoint, invoked only by the Installer inside its staging root. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { extract } from 'tar-stream';
import { RG_BINARY, RG_TOOLS_PATH, RG_VERSION, resolveRg, probeRg, assertRgDirectory } from './rg-tool';

export const RG_ASSETS: Record<string, { target: string; sha256: string }> = {
  'win32-x64': { target: 'x86_64-pc-windows-msvc.zip', sha256: '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5' },
  'win32-arm64': { target: 'aarch64-pc-windows-msvc.zip', sha256: 'e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f' },
  'linux-x64': { target: 'x86_64-unknown-linux-musl.tar.gz', sha256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c' },
  'linux-arm64': { target: 'aarch64-unknown-linux-musl.tar.gz', sha256: '800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915' },
  'darwin-x64': { target: 'x86_64-apple-darwin.tar.gz', sha256: 'af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1' },
  'darwin-arm64': { target: 'aarch64-apple-darwin.tar.gz', sha256: '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4' },
};
const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_EXTRACTED = 32 * 1024 * 1024;

export async function downloadRg(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`RG_DOWNLOAD_FAILED: HTTP ${response.status}`);
  const parts: Buffer[] = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > MAX_ARCHIVE) throw new Error('RG_DOWNLOAD_FAILED: archive exceeds size limit.');
      parts.push(Buffer.from(chunk.value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}

export async function extractRg(archive: Buffer, asset: { target: string; sha256: string }): Promise<Buffer> {
  if (archive.length > MAX_ARCHIVE || createHash('sha256').update(archive).digest('hex') !== asset.sha256) throw new Error('RG_CHECKSUM_MISMATCH: downloaded archive is not the pinned release.');
  const prefix = `ripgrep-${RG_VERSION}-${asset.target.replace(/\.(zip|tar\.gz)$/u, '')}`;
  const expected = `${prefix}/${asset.target.endsWith('.zip') ? 'rg.exe' : 'rg'}`;
  let binary: Buffer | undefined;
  let expanded = 0;
  const admit = (name: string, size: number) => {
    expanded += size;
    if (!Number.isSafeInteger(size) || size < 0 || expanded > MAX_EXTRACTED || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || !name.startsWith(prefix + '/')) throw new Error('RG_ARCHIVE_INVALID: unsafe archive entry.');
    if (name === expected && binary) throw new Error('RG_ARCHIVE_INVALID: duplicate executable.');
    return name === expected;
  };
  if (asset.target.endsWith('.zip')) {
    const entries = unzipSync(archive, { filter: file => admit(file.name, file.originalSize) });
    if (entries[expected]) binary = Buffer.from(entries[expected]!);
  } else {
    const tar = extract();
    await new Promise<void>((resolve, reject) => {
      tar.on('entry', (header, stream, next) => {
        try {
          if (header.type !== 'file' && header.type !== 'directory') throw new Error('RG_ARCHIVE_INVALID: links and special entries are forbidden.');
          const selected = admit(header.name.replace(/\/$/u, '') + (header.type === 'directory' ? '/' : ''), header.size ?? 0);
          const chunks: Buffer[] = [];
          stream.on('data', chunk => { if (selected) chunks.push(Buffer.from(chunk)); });
          stream.on('error', reject);
          stream.on('end', () => { if (selected) binary = Buffer.concat(chunks); next(); });
          stream.resume();
        } catch (error) { tar.destroy(error as Error); }
      });
      tar.on('error', reject);
      tar.on('finish', resolve);
      try { tar.end(gunzipSync(archive, { maxOutputLength: MAX_EXTRACTED })); } catch (error) { tar.destroy(); reject(error); }
    });
  }
  if (!binary?.length || binary.length > MAX_EXTRACTED) throw new Error('RG_ARCHIVE_INVALID: release executable missing.');
  return binary;
}

export function verifyRgFeatures(command: string, directory: string): void {
  const fixture = path.join(directory, 'probe.txt');
  fs.writeFileSync(fixture, 'runtime-rg-probe\n');
  try {
    const options = { cwd: directory, encoding: 'utf8' as const, windowsHide: true, timeout: 3000, maxBuffer: 8192 };
    const files = execFileSync(command, ['--no-config', '--files', '--null', '--', fixture], options);
    if (!files.includes('probe.txt\0')) throw new Error('RG_PROBE_FAILED: file listing.');
    const output = execFileSync(command, ['--no-config', '--json', '--fixed-strings', '--', 'runtime-rg-probe', fixture], options);
    if (!output.split('\n').filter(Boolean).map(line => JSON.parse(line)).some(event => event.type === 'match' && event.data.line_number === 1)) throw new Error('RG_PROBE_FAILED: JSON match.');
    try {
      execFileSync(command, ['--no-config', '--json', '--fixed-strings', '--', 'missing-token', fixture], options);
      throw new Error('RG_PROBE_FAILED: no-match must exit 1.');
    } catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  } finally { fs.unlinkSync(fixture); }
}

export async function prepareRgTools(stageRoot: string, reuseRoot: string, fetcher: typeof fetch = fetch) {
  const directory = assertRgDirectory(stageRoot);
  fs.mkdirSync(directory, { recursive: true });
  try {
    const rg = resolveRg(reuseRoot);
    verifyRgFeatures(rg.command, directory);
    if (rg.source === 'project') {
      fs.copyFileSync(rg.command, path.join(directory, RG_BINARY));
      fs.copyFileSync(path.join(path.dirname(rg.command), 'identity.json'), path.join(directory, 'identity.json'));
    } else fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify({ source: 'path', version: rg.version }) + '\n');
    return { source: rg.source, version: rg.version };
  } catch { /* An incompatible PATH executable is replaced only in this project. */ }
  const asset = RG_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('RG_PLATFORM_UNSUPPORTED: provide compatible ripgrep on PATH.');
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${asset.target}`;
  const binary = await extractRg(await downloadRg(url, fetcher), asset);
  const command = path.join(directory, RG_BINARY);
  fs.writeFileSync(command, binary, { mode: 0o755 });
  if (probeRg(command) !== RG_VERSION) throw new Error('RG_PROBE_FAILED: unexpected release version.');
  verifyRgFeatures(command, directory);
  fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify({ source: 'download', version: RG_VERSION, archive_sha256: asset.sha256, sha256: createHash('sha256').update(binary).digest('hex') }) + '\n');
  return { source: 'download', version: RG_VERSION };
}
