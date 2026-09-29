#!/usr/bin/env node
/** Non-blocking management API. Deliberately imports no task/qualification kernel. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const COMMANDS = ['context', 'record', 'snapshot', 'read', 'find'];
const STORE = '.workflow-system/records';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const clamp = (n, fallback, max) => Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
const failure = (code, message) => Object.assign(new Error(message), { code });
const issue = error => ({ code: error?.code ?? 'IO_ERROR', message: error instanceof Error ? error.message : String(error) });
const base = () => ({ runtime_role: 'assistance', development_gate: false, qualification: 'not-evaluated' });

// Protect this service's own I/O. This is not permission to edit product files.
function local(root, requested) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0'))
    throw failure('UNSAFE_PATH', 'Expected a repository-relative path or an in-repository absolute path.');
  const normalized = requested.replace(/\\/g, '/');
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(path.resolve(root), absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || relative.split(path.sep).some(p => p.includes(':') || p.toLowerCase().replace(/[. ]+$/, '') === '.git'))
    throw failure('UNSAFE_PATH', 'Expected a repository-relative path without traversal into external or Git-control files.');
  let current = path.resolve(root);
  for (const part of [null, ...relative.split(path.sep)]) {
    if (part !== null) current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw failure('UNSAFE_PATH', 'Symbolic paths are not followed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}
function ensureParent(root, target) {
  const parent = path.posix.dirname(target);
  fs.mkdirSync(local(root, parent), { recursive: true });
  local(root, parent); // Recheck after directory creation.
}
function hashFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    if (!fs.fstatSync(fd).isFile()) throw failure('NOT_A_FILE', 'Expected a regular file.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
// Publish complete bytes without overwriting an existing record, including races.
function publish(root, target, bytes) {
  ensureParent(root, target);
  const file = local(root, target), temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, file); return true; }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  } finally { fs.rmSync(temp, { force: true }); }
}
function workflowHome(root, requested) {
  if (requested) { local(root, requested); return { home: requested, issues: [] }; }
  const fallback = 'docs/workflow';
  try {
    const profile = fs.readFileSync(local(root, '.workflow-system/PROJECT_PROFILE.yaml'), 'utf8');
    const match = /^[ \t]*workflow_home:[ \t]*(.*?)[ \t]*$/m.exec(profile);
    if (!match) return { home: fallback, issues: [] };
    let value = match[1].replace(/\s+#.*$/, '');
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw failure('PROFILE_HINT_UNREADABLE', 'Unclosed workflow_home quote.');
      value = value.slice(1, -1).replace(/''/g, "'");
    } else if (!/^[^{}\[\]&*!>|%@`#\r\n]+$/u.test(value)) throw failure('PROFILE_HINT_UNREADABLE', 'Pass workflow_home explicitly for a non-scalar YAML value.');
    local(root, value);
    return { home: value, issues: [] };
  } catch (error) {
    return { home: fallback, issues: error.code === 'ENOENT' ? [] : [issue(error)] };
  }
}
function preserved(root, digest, home) {
  if (!/^[a-f0-9]{64}$/.test(digest ?? '')) throw failure('INVALID_DIGEST', 'A SHA-256 object reference must have 64 lowercase hexadecimal characters.');
  for (const candidate of [`${STORE}/evidence-objects/${digest}.blob`, `${home}/evidence-objects/${digest}.blob`]) {
    const file = local(root, candidate);
    if (fs.existsSync(file)) {
      if (hashFile(file) !== digest) throw failure('OBJECT_CORRUPT', `Preserved object differs: ${candidate}`);
      return candidate;
    }
  }
  throw failure('HISTORICAL_OBJECT_UNAVAILABLE', `No preserved object for ${digest}; a digest cannot reconstruct missing bytes.`);
}
export function snapshot(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  if (input.sha256) {
    try { const ref = preserved(root, input.sha256, home); return { ...base(), status: 'found', ref, sha256: input.sha256, issues }; }
    catch (error) { if (error.code !== 'HISTORICAL_OBJECT_UNAVAILABLE' || !input.path) throw error; }
  }
  const source = local(root, input.path);
  const directory = `${STORE}/evidence-objects`;
  ensureParent(root, `${directory}/placeholder`);
  const temp = local(root, `${directory}/${randomUUID()}.tmp`);
  const fd = fs.openSync(source, 'r');
  let out;
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw failure('NOT_A_FILE', 'Only explicitly named regular files are captured.');
    out = fs.openSync(temp, 'wx', 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let count, size = 0;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      const part = buffer.subarray(0, count); hash.update(part); size += count;
      fs.writeFileSync(out, part);
    }
    fs.fsyncSync(out); fs.closeSync(out); out = undefined;
    const after = fs.fstatSync(fd), digest = hash.digest('hex');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw failure('SOURCE_CHANGED_DURING_CAPTURE', 'Source changed while being captured; no stable-source claim was made.');
    if (input.sha256 && input.sha256 !== digest)
      throw failure('HISTORICAL_OBJECT_UNAVAILABLE', 'The live file is not the requested historical content; it was not relabelled.');
    const ref = `${directory}/${digest}.blob`, target = local(root, ref);
    try { fs.linkSync(temp, target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (hashFile(target) !== digest) throw failure('OBJECT_CORRUPT', ref); }
    return { ...base(), status: 'saved', ref, sha256: digest, size, source_path: input.path, issues };
  } finally {
    fs.closeSync(fd); if (out !== undefined) fs.closeSync(out);
    fs.rmSync(temp, { force: true });
  }
}
export function record(root, input) {
  // Keep caller fields verbatim. Missing IDs, stale revisions and unknown kinds
  // are association information, never qualifications for retaining the report.
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : { body: input };
  const payloadDigest = sha(JSON.stringify(stable(payload)));
  const key = typeof payload.idempotency_key === 'string' && payload.idempotency_key ? payload.idempotency_key : null;
  let id = key ? `key-${sha(key)}` : `${Date.now()}-${randomUUID()}`;
  let ref = `${STORE}/events/${id}.json`;
  const issues = [];
  for (;;) {
    const event = { schema_version: 1, kind: 'workflow-observation', recorded_at: new Date().toISOString(),
      payload_sha256: payloadDigest, assurance: 'caller-reported', payload, issues: [...issues] };
    if (publish(root, ref, json(event))) {
      // Raw observation is durable BEFORE optional file association/snapshotting.
      const attachments = [];
      for (const spec of Array.isArray(payload.files) ? payload.files : []) {
        try { attachments.push(snapshot(root, typeof spec === 'string' ? { path: spec, workflow_home: payload.workflow_home } : { workflow_home: payload.workflow_home, ...spec })); }
        catch (error) { attachments.push({ status: 'unavailable', request: spec, ...issue(error) }); }
      }
      let attachmentsRef = null;
      if (attachments.length) {
        attachmentsRef = `${STORE}/attachments/${id}.json`;
        try { publish(root, attachmentsRef, json({ event_ref: ref, captured_at: new Date().toISOString(), attachments })); }
        catch (error) { issues.push(issue(error)); attachmentsRef = null; }
      }
      return { ...base(), status: 'recorded', recorded: true, ref, sha256: sha(json(event)),
        attachments_ref: attachmentsRef, attachments, issues };
    }
    let previous;
    try { previous = JSON.parse(fs.readFileSync(local(root, ref), 'utf8')); }
    catch (error) { issues.push({ ...issue(error), unreadable_ref: ref }); }
    if (previous?.payload_sha256 === payloadDigest && sha(JSON.stringify(stable(previous.payload))) === payloadDigest) {
      const a = `${STORE}/attachments/${id}.json`;
      return { ...base(), status: 'already-recorded', recorded: true, ref,
        attachments_ref: fs.existsSync(local(root, a)) ? a : null, issues: previous.issues ?? [],
        note: 'Replay does not rerun commands or recapture changed files.' };
    }
    issues.push({ code: 'IDEMPOTENCY_CONFLICT_RETAINED', conflicting_ref: ref,
      message: 'Different observation retained separately; the original was not overwritten.' });
    id = issues.length === 1 ? `conflict-${sha(key ?? id)}-${payloadDigest}` : `${Date.now()}-${randomUUID()}`;
    ref = `${STORE}/events/${id}.json`;
  }
}
export function read(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  let ref = input.path ?? input.ref;
  if (input.sha256) {
    try { ref = preserved(root, input.sha256, home); }
    catch (error) {
      if (error.code !== 'HISTORICAL_OBJECT_UNAVAILABLE' || !ref || hashFile(local(root, ref)) !== input.sha256) throw error;
    }
  }
  const file = local(root, ref), fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw failure('NOT_A_FILE', ref);
    const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
    const length = Math.min(clamp(input.max_bytes, 8192, 65536), Math.max(0, stat.size - offset));
    const bytes = Buffer.alloc(length), count = fs.readSync(fd, bytes, 0, length, offset);
    const page = bytes.subarray(0, count);
    return { ...base(), status: 'read', ref, sha256: input.sha256 ?? null, size: stat.size, offset,
      next_offset: offset + count < stat.size ? offset + count : null,
      encoding: 'base64', data: page.toString('base64'), text_preview: page.toString('utf8'),
      issues, note: 'Base64 is exact; UTF-8 preview may split a character at a byte-page boundary. Historical availability does not imply current applicability.' };
  } finally { fs.closeSync(fd); }
}
export function find(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  const query = typeof input.query === 'string' ? input.query : '';
  const needle = Buffer.from(query);
  if (needle.length > 4096) throw failure('QUERY_TOO_LONG', 'Use a shorter literal search; this is a search request limit, not a workflow gate.');
  const roots = input.roots ?? [STORE, home, 'TASKS'];
  if (!Array.isArray(roots) || roots.some(p => typeof p !== 'string')) throw failure('INVALID_SEARCH_ROOTS', 'roots must be relative paths.');
  let pending = roots.slice().reverse().map(p => ({ path: p, offset: 0, named: false }));
  if (input.cursor) {
    const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
    if (cursor.query !== query || !Array.isArray(cursor.pending)) throw failure('INVALID_CURSOR', 'Use a cursor from this literal query.');
    pending = cursor.pending;
  }
  const matches = [], max = clamp(input.max_results, 20, 100);
  let remaining = clamp(input.scan_bytes, 1048576, 4194304), visited = 0;
  while (pending.length && matches.length < max && remaining > 0 && visited++ < 2000) {
    const item = pending.pop();
    try {
      const file = local(root, item.path), stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        const names = fs.readdirSync(file).filter(n => !['.git', 'node_modules'].includes(n) && !n.endsWith('.tmp')).sort().reverse();
        pending.push(...names.map(n => ({ path: `${item.path}/${n}`, offset: 0, named: false })));
        continue;
      }
      if (!stat.isFile()) continue;
      if (!item.named && (!query || item.path.includes(query))) {
        matches.push({ path: item.path, offset: null, match: 'path' }); item.named = true;
        if (!query) continue;
        if (matches.length >= max) { pending.push(item); break; }
      }
      item.named = true;
      const offset = Number.isSafeInteger(item.offset) && item.offset >= 0 ? item.offset : 0;
      const length = Math.min(65536, remaining, Math.max(0, stat.size - offset));
      if (!length) continue;
      const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(length + Math.max(0, needle.length - 1));
      let count;
      try { count = fs.readSync(fd, buffer, 0, buffer.length, offset); }
      finally { fs.closeSync(fd); }
      remaining -= length;
      const bytes = buffer.subarray(0, count); let from = 0, next = offset + length;
      while (needle.length && from < length) {
        const at = bytes.indexOf(needle, from);
        if (at < 0 || at >= length) break;
        matches.push({ path: item.path, offset: offset + at, match: 'content',
          excerpt: bytes.subarray(Math.max(0, at - 80), Math.min(count, at + needle.length + 160)).toString('utf8') });
        from = at + 1;
        if (matches.length >= max) { next = offset + from; break; }
      }
      if (next < stat.size) pending.push({ ...item, offset: next });
    } catch (error) { if (error.code !== 'ENOENT') issues.push({ path: item.path, ...issue(error) }); }
  }
  return { ...base(), status: pending.length ? 'partial' : 'complete', matches, issues,
    next_cursor: pending.length ? Buffer.from(JSON.stringify({ query, pending })).toString('base64url') : null,
    note: 'Literal search over stored bytes, without active-task validation. Pagination is not a failure. Concurrent additions may require a fresh search.' };
}
export function context(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  const candidates = [`${home}/CURRENT_TASK.md`, `${home}/task-data`, `${home}/task-history`,
    `${home}/evidence-objects`, `${STORE}/events`, 'TASKS'];
  const sources = [];
  for (const candidate of candidates) {
    try { if (fs.existsSync(local(root, candidate))) sources.push(candidate); }
    catch (error) { issues.push({ path: candidate, ...issue(error) }); }
  }
  return { ...base(), status: 'available', workflow_home: home, sources, issues,
    records: find(root, { query: input.task_ref ?? '', roots: [`${STORE}/events`], max_results: input.max_results ?? 20 }),
    note: 'Sources are navigation, not execution permission. Legacy CURRENT_TASK is a retained projection; use later plan/disposition observations without rewriting its history. Never infer verified completion from a closed disposition.' };
}
export async function runAssistance(argv = process.argv.slice(2)) {
  let command = argv[0] ?? 'context', root = process.cwd();
  try {
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
      else throw failure('INVALID_ARGUMENT', 'Usage: assistance.mjs <context|record|snapshot|read|find> --root <project>; JSON on stdin.');
    }
    if (!COMMANDS.includes(command)) throw failure('UNKNOWN_COMMAND', command);
    if (!fs.statSync(root).isDirectory()) throw failure('INVALID_ROOT', root);
    const text = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8');
    let input;
    try { input = text.trim() ? JSON.parse(text) : {}; }
    catch (error) { if (command !== 'record') throw error; input = { kind: 'raw-observation', body: text }; }
    const result = { context, record, snapshot, read, find }[command](root, input);
    console.log(json(result)); return 0;
  } catch (error) {
    console.log(json({ ...base(), status: 'unavailable', recorded: false, command, ...issue(error),
      next_action: 'Report this service failure; retain output elsewhere when authorized. Do not turn it into a development stop, rerun business commands, or claim successful persistence.' }));
    return 1; // A real service failure, not a workflow veto and not fake success.
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runAssistance();
