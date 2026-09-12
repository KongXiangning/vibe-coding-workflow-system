import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { pack } from 'tar-stream';
import { fileContext, sha256, textDiff } from '../runtime/vnext/src/file-context';
import { downloadRg, extractRg, prepareRgTools, RG_ASSETS, verifyRgFeatures } from '../runtime/vnext/src/install-tools';
import { RG_BINARY, RG_TOOLS_PATH, RG_VERSION, resolveRg } from '../runtime/vnext/src/rg-tool';

const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext context ')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

// User-authorized source regression: protect bounded reads and real rg discovery,
// not an independent business Provider or a new test-case registry.
test('existing tests are searched using real rg, ignored candidates stay out, reads do not create a baseline', async () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'tests with spaces'));
  fs.writeFileSync(path.join(root, '.ignore'), 'ignored.test.ts\n');
  fs.writeFileSync(path.join(root, 'tests with spaces', 'login.test.ts'), 'assert(login()).equals(10);\n');
  fs.writeFileSync(path.join(root, 'ignored.test.ts'), 'login ignored\n');
  fs.writeFileSync(path.join(root, '.hidden'), 'login hidden\n');
  const result = await fileContext(root, { operation: 'search', roots: ['.'], query: 'login' });
  expect(result).toMatchObject({ status: 'pass', complete_within_scope: true, hits: [{ path: 'tests with spaces/login.test.ts', line: 1, text: 'assert(login()).equals(10);\n' }] });
  const page = await fileContext(root, { operation: 'read', path: result.hits![0]!.path });
  expect(page).toMatchObject({ text: 'assert(login()).equals(10);\n', committed: false });
  expect(fs.existsSync(path.join(root, '.workflow-system'))).toBe(false);
  expect(await fileContext(root, { operation: 'search', roots: ['.'], query: 'no-such-test' })).toMatchObject({ status: 'pass', hits: [], complete_within_scope: true });
  // Explicit globs have ripgrep's native precedence over ignore rules.
  const listed = await fileContext(root, { operation: 'search', roots: ['.'], globs: ['*.test.ts'] });
  expect(listed.hits!.map(hit => hit.path).sort()).toEqual(['ignored.test.ts', 'tests with spaces/login.test.ts']);
  const partial = await fileContext(root, { operation: 'search', roots: ['.'], query: 'login', include_hidden: true, limit: 1 });
  expect(partial).toMatchObject({ status: 'partial', truncated: true, reason: 'result-limit' });
  const failed = await fileContext(root, { operation: 'search', roots: ['absent'], query: 'login' });
  expect(failed).toMatchObject({ status: 'partial', complete_within_scope: false, reason: 'search-error' });
  expect(() => resolveRg(root)).not.toThrow();
  verifyRgFeatures(resolveRg(root).command, root);
});

test('UTF-8 long-line pagination preserves exact bytes, detects stale reads and rejects path escape', async () => {
  const root = temp();
  const text = '\ufeff' + '中文🙂'.repeat(1000) + '\r\nend';
  fs.writeFileSync(path.join(root, 'case.ts'), text);
  let offset = 0;
  let actual = '';
  let revision: string | undefined;
  do {
    const page = await fileContext(root, { operation: 'read', path: 'case.ts', max_bytes: 127, offset, ...(revision ? { sha256: revision } : {}) });
    expect(Buffer.byteLength(page.text!)).toBeLessThanOrEqual(127);
    revision = page.sha256;
    actual += page.text;
    offset = page.next_offset ?? 0;
  } while (offset);
  expect(actual).toBe(text);
  expect(await fileContext(root, { operation: 'read', path: 'case.ts', start_line: 2, end_line: 2 })).toMatchObject({ text: 'end', truncated: false });
  fs.appendFileSync(path.join(root, 'case.ts'), '!');
  await expect(fileContext(root, { operation: 'read', path: 'case.ts', offset: 127, sha256: revision })).rejects.toThrow('CONTEXT_STALE');
  await expect(fileContext(root, { operation: 'read', path: '../outside' })).rejects.toThrow('CONTEXT_PATH_INVALID');
  await expect(fileContext(root, { operation: 'search', roots: ['../outside'] })).rejects.toThrow('CONTEXT_PATH_INVALID');
  fs.writeFileSync(path.join(root, 'binary'), Buffer.from([0, 255, 2]));
  expect(await fileContext(root, { operation: 'read', path: 'binary' })).toMatchObject({ content_status: 'binary-or-non-utf8' });
  expect(textDiff('case.ts', 'before\r\n', 'after\r\n')).toContain('-before\r\n+after\r\n');
  const outside = temp();
  fs.writeFileSync(path.join(outside, 'private'), 'do not follow');
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(fileContext(root, { operation: 'read', path: 'linked/private' })).rejects.toThrow('CONTEXT_SYMLINK');
});

test('Node CLI bounds oversized rg output and missing rg is explicit without installation', () => {
  const root = temp();
  fs.writeFileSync(path.join(root, 'large.ts'), 'needle ' + 'x'.repeat(200_000));
  const cli = path.resolve('runtime/vnext/dist/cli.js');
  const args = [cli, 'file-context', '--root', root];
  const input = JSON.stringify({ operation: 'search', roots: ['.'], query: 'needle' });
  const partial = spawnSync('node', args, { input, encoding: 'utf8' });
  expect(partial.status).toBe(2);
  expect(partial.stdout.length).toBeLessThan(20_000);
  expect(JSON.parse(partial.stdout).truncated).toBe(true);
  const node = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).stdout.trim();
  const missing = spawnSync(node, args, { input, encoding: 'utf8', env: { ...process.env, PATH: '', Path: '' } });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain('RG_DEPENDENCY_MISSING');
  expect(fs.existsSync(path.join(root, RG_TOOLS_PATH))).toBe(false);
});

test('pinned archive verification handles ZIP and tar.gz without system utilities and rejects unsafe entries', async () => {
  const windows = RG_ASSETS['win32-x64']!;
  const prefix = `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc`;
  const bytes = Buffer.from('fixture executable; never run');
  const zip = Buffer.from(zipSync({ [`${prefix}/rg.exe`]: bytes }));
  expect(await extractRg(zip, { ...windows, sha256: sha256(zip) })).toEqual(bytes);
  await expect(extractRg(zip, windows)).rejects.toThrow('RG_CHECKSUM_MISMATCH');
  const unsafe = Buffer.from(zipSync({ [`${prefix}/../rg.exe`]: bytes }));
  await expect(extractRg(unsafe, { ...windows, sha256: sha256(unsafe) })).rejects.toThrow('RG_ARCHIVE_INVALID');
  const archive = pack();
  const chunks: Buffer[] = [];
  archive.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<void>(resolve => archive.on('end', resolve));
  archive.entry({ name: `ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl/rg`, size: bytes.length, type: 'file' }, bytes);
  archive.finalize();
  await finished;
  const gzip = gzipSync(Buffer.concat(chunks));
  expect(await extractRg(gzip, { ...RG_ASSETS['linux-x64']!, sha256: sha256(gzip) })).toEqual(bytes);
  await expect(downloadRg('https://example.invalid/archive', (async () => new Response('offline', { status: 503 })) as typeof fetch)).rejects.toThrow('RG_DOWNLOAD_FAILED');
});

test('Installer reuses a verified project binary offline and dependency failure leaves the existing root unchanged', async () => {
  const existing = temp();
  const stage = temp();
  const rg = resolveRg(existing);
  const binary = fs.readFileSync(rg.command);
  const tools = path.join(existing, RG_TOOLS_PATH);
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(tools, RG_BINARY), binary, { mode: 0o755 });
  fs.writeFileSync(path.join(tools, 'identity.json'), JSON.stringify({ version: rg.version, sha256: sha256(binary) }));
  const originalIdentity = fs.readFileSync(path.join(tools, 'identity.json'), 'utf8');
  const previousPath = process.env.PATH;
  let requested = false;
  const unavailable = (async () => { requested = true; throw new Error('fixture network unavailable'); }) as typeof fetch;
  try {
    process.env.PATH = '';
    expect(await prepareRgTools(stage, existing, unavailable)).toMatchObject({ source: 'project', version: rg.version });
    expect(requested).toBe(false);
    expect(resolveRg(stage).source).toBe('project');
    expect(fs.readFileSync(path.join(tools, 'identity.json'), 'utf8')).toBe(originalIdentity);
    const absent = temp();
    fs.writeFileSync(path.join(absent, 'business-data'), 'unchanged');
    await expect(prepareRgTools(temp(), absent, unavailable)).rejects.toThrow('fixture network unavailable');
    expect(requested).toBe(true);
    expect(fs.readdirSync(absent)).toEqual(['business-data']);
    expect(fs.readFileSync(path.join(absent, 'business-data'), 'utf8')).toBe('unchanged');
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
  }
});
