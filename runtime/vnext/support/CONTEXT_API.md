# Runtime source context (0.17.0)

Use the installed Node CLI at `.workflow-system/runtime/dist/cli.js`. Pass `--root <project>` and JSON on stdin. These context commands do not write task state, admit tests, run checks, or certify evidence. For normal task inspection, use `validate --summary`; plain `validate` retains its full diagnostic output, including stored baselines.

## Cumulative review

`review-context` accepts `{}`. Its execution delta contains the complete file index; `text_diff` expands the first changed file and `unexpanded_paths` lists the others. Full first-touch content stays in Runtime. Use `review-read` for the remaining relevant content:

```json
{"context_receipt":"<the entire receipt object from review-context>","path":"src/example.ts","view":"diff","offset":0,"max_bytes":16384}
```

`context_receipt` must be the object, not a string. `view` is `diff` (default), `before`, or `after`. `before` uses the exact first-touch baseline, including a dirty starting tree; it is never reconstructed from Git HEAD. A changed task or cumulative target rejects the old receipt. Added/deleted files expose their states. Binary/non-UTF-8 content, symlinks, missing historical baselines, and a diff computation limit are explicit `content_status` values, not an empty clean diff. If diff computation is unavailable, read `before`/`after` ranges.

## Existing test discovery and reading

`file-context` accepts either operation, without requiring an active confirmed task:

```json
{"operation":"search","roots":["test","src"],"globs":["*.ts"],"query":"login","limit":50,"max_bytes":16384}
```

Roots are explicit project-relative paths (1–32); `.` is allowed. Omit `query` to list files. A supplied query is a case-sensitive, single-line literal. Native rg glob precedence applies: an explicit positive glob can override ignore rules. Without those overrides, default ignore rules apply and hidden files are skipped unless explicitly selected or `include_hidden:true`. Links are not followed. rg user configuration is disabled. Results are candidates in the stated live scope, not an exhaustive test inventory or proof of execution. A search does not snapshot the repository; read candidates to obtain their actual current hash.

```json
{"operation":"read","path":"test/login.test.ts","offset":0,"max_bytes":16384}
```

Read returns `sha256`. Subsequent pages must send it back; a changed file requires a fresh read. Reading an unchanged test creates no first-touch baseline and no evidence report. Bind reused tests, helpers, fixtures and runner configuration using the existing check `subject_paths` and report version rules. Deleted Git history and global test IDs are outside this API.

## Bounds and incomplete results

For a line range, pass optional 1-based inclusive `start_line` and `end_line` to either read command; for `diff`, these count rendered diff lines. Keep the same range on subsequent pages. Byte offsets and `total_bytes` are relative to the selected range. Text pages use UTF-8 byte offsets, never split a character, and return `next_offset`, `total_bytes`, and `truncated`. Send `next_offset` as the next `offset` with the same file/view and receipt or file hash. Default text budget is 16 KiB; callers may request 4 bytes–64 KiB. The complete review file index is separate from this text budget. Even a single very long line is bounded.

Search defaults to 50 hits (maximum 200), uses the same byte budget, and stops after 10 seconds. Partial results exit 2 with a reason; narrow the scope/query or read a known candidate. Exit 0 with no hits means no match in that searched scope, not that no relevant tests exist. Tool errors, unreadable output and timeouts must not be treated as clean results. Metadata and JSON escaping add overhead beyond the text budget.

## rg dependency

Install/upgrade prepares rg in the Installer staging transaction, preferring a verified project-local binary, then compatible PATH rg (14.1+ within major 14, or major 15), with a functional probe. Otherwise it downloads pinned 15.2.0 for Windows/Linux/macOS x64/arm64 and checks the built-in release SHA-256. Linux download uses musl. Managed files are under `.workflow-system/runtime/tools/rg/`; PATH reuse records no machine-specific absolute path. No system package manager, administrator privilege, or global PATH change is needed.

Download/checksum/probe failure aborts installation before promotion. Old installations lacking rg receive `RG_DEPENDENCY_MISSING` from search; use the normal distribution upgrade route to prepare dependencies. Same-version upgrade also prepares a lost rg dependency when managed software is intact, retaining all ordinary upgrade admission and rollback checks; unrelated software drift is still rejected. Read-only calls never download. Other context operations do not require rg. An available rg does not make other installation dependencies offline-capable.
