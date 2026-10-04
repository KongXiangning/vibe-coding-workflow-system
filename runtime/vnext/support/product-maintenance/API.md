# Product maintenance helper

Installed: `node .workflow-system/runtime/support/product-maintenance.js <read|check|apply|capture> --root <project>`.
Source: `node runtime/vnext/dist/product-maintenance.js`. Node only, all YAML/Markdown dependencies bundled.
JSON stdin; JSON stdout. Exit 1 means a real failed/partial service result, never a development veto.
`kind=product-maintenance-result/v1`, `development_gate=false`, `qualification=not-evaluated`.
Requests are described in `schemas/request-v1.json`, result envelope in `schemas/result-v1.json`; documents/manifest in v1/v2 Schema plus `contract.md`.

## Read and check

```json
{"detail":"summary"}
```

Read returns the manifest version, worktree root, byte digests, usable items, raw
locators for degraded files, reverse relations, plan work items' computed bindings,
diagnostics and explicit coverage. `detail=items`, `item_ids=[...]` expands selected
bodies. `discussion_targets=[...]` recalls related active discussion summaries and
source positions. `impact_ids=[...]` finds direct candidates for host-model judgment,
not transitive invalidation. Scope selection never claims unenumerated files checked.
`paths=[...]` limits managed enumeration; cross-object completeness is then unknown.

`resolve_sources=true` checks selected references' bytes/availability without
returning all bodies. Fetch a specific actual source as follows:

```json
{"source":{"kind":"file","path":"docs/evidence/run.txt","sha256":"<actual 64 lower-case hex digest>"},"offset":0,"max_bytes":65536}
```

`data_base64` is exact; `text_preview` can split a UTF-8 character. Follow
`next_offset` until null. File source supports item_id, section and 1-based lines;
item scope is resolved before section and line scope. SHA means actual file bytes;
same-bytes/changed/unavailable/unknown does not judge current applicability. Changed
current bytes are never labelled as historical bytes. URI is retained without
network access; link-only material is not an archived discussion.

Default managed limits: 1,000 files, 4 MiB/file, 32 MiB total, 100,000 directory
entries (the exact entry bound is max(10,000, max_files × 100)). Explicit bounded overrides: max_files (1–10,000), max_file_bytes (1–64 MiB),
max_total_bytes (1–256 MiB). Omitted coverage is reported. Source paging defaults
to 64 KiB, max 1 MiB/page. Source hashes use streaming I/O. Source body locators
require a bounded UTF-8 document; raw byte paging does not. Input limit is 64 MiB.
Glob paths support `*`, `**`, `?`; paths use `/`. Symlinks/junctions are skipped.

`check {}` checks existing managed files and semantic references, without writing.
`check {"path":"docs/product/REQUIREMENTS.md","content":"<candidate text>"}`
checks candidate structure. Neither certifies user intent, source truth or delivery.
Cross-object diagnostics are from existing catalog; read back after saving changes.

## Apply

```json
{"expected_manifest_sha256":"<read digest>","files":[{"path":"docs/product/REQUIREMENTS.md","expected_sha256":"<read file digest>","updates":[{"id":"REQ-IMPORT","metadata":{"scope":"planned"},"body":"## [REQ-IMPORT] 导入\n### 需求内容\n完整更新后的要求。\n### 范围边界\n保留排除项。\n### 验收要求\n实际要求。\n"}]}]}
```

metadata is a top-level patch; omitted fields and unchanged body remain intact.
remove_fields removes explicit optional fields. Array fields are full replacements:
read existing links/bindings/work_items first, retain dismissed/historical entries
unless an actual correction/deletion instruction applies. Body contains the
selected item's complete root `## [ID]` and its required `###` sections. It must
end with a line break before a subsequent heading. Append with
`append:[{"metadata":{...},"body":"..."}]`; split/merge keep old IDs and refer
to replacement destinations. `content` is for new files or explicitly authorized
whole-file candidates, never combined with item edits. It is still version checked.

Every file requires expected_sha256; null means must not exist. The optional
expected_manifest_sha256 detects changed write scope. A manifest is itself applied
at its explicit manifest path with content; absent entry is not automatically
created by read/install. Initialize manifest first, then authorized documents.
New writes use v2. Old v1 files are read-only until this operation explicitly says
`migrate:"v2"`; unrelated files/history are not migrated. Do not repurpose IDs/types.
Unrelated malformed items retain exact original body and YAML bytes; only changed
items must be valid. Conflicts preserve actual user bytes. Results are per file:
saved/unchanged/failed, digest, affected IDs and diagnostics; cross-file writes
are not transactions. Re-read and retry only unsaved changes.

Temporary files + atomic single-file publication and short per-path helper locks
coordinate helper writers. Absent paths publish without replacing a racing creator.
Digest recheck + rename is not strict CAS against arbitrary external editors. Locks
never affect reads/development/other files. Interrupted locks are reported busy;
inspect a confirmed abandoned lock before removing that specific temporary lock.
Existing-file results retain exact preimage bytes as base64 in the operation result.
For persistent recoverable history, use an explicit `preimage_path` under authorized
capture_paths; it is saved before publication. No automatic hidden history tree.

## Capture

```json
{"path":"docs/product/discussions/raw/selected.txt","text":"用户选中的文本"}
```

Exactly one of text (received UTF-8 text), base64 (actual selected file bytes), or
source_path (registered selected local source) is accepted. Destination must be
in capture_paths and source_paths, outside managed_paths/excludes. Same bytes at
same path are reused; different bytes do not overwrite. Keep the returned file
SourceRef with the actual sha256. Capture does not create a discussion/observation
task, summary, relationship or user adoption. It may succeed independently of a
later metadata failure. It does not fetch URLs, enforce Git ignore or erase history.

All input paths/content are values, never shell command text. Use the host's
structured APIs or a JSON file/standard-input API; do not interpolate source text
into shell commands. Scope configuration is not unlimited writing permission.
