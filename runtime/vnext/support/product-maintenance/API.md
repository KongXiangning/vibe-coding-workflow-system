# Product maintenance helper

Installed: `node .workflow-system/runtime/support/product-maintenance.js <read|check|apply|capture> --root <project>`.
Source: `node runtime/vnext/dist/product-maintenance.js`. Node only, all YAML/Markdown dependencies bundled.
JSON stdin; JSON stdout. Exit 1 means a real failed/partial service result or incomplete
requested read coverage, never a development veto. Read status=available describes
service availability, not complete coverage or usable structure.
`kind=product-maintenance-result/v1`, `development_gate=false`, `qualification=not-evaluated`.
Requests are described in `schemas/request-v1.json`, result envelope in `schemas/result-v1.json`; documents in v1/v2/v3 Schema and manifests in v1/v2 Schema plus `contract.md`. VN-03 supports v3 in the source helper and local product assets; full distribution/installation remains VN-05 work.

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

### v3 product view and scoped assessment selection (VN-03)

`read.product_view` adds `root_goal: {status,id}`, `requirement_order`,
`unordered_requirements`, `current_relations` and local diagnostics. Registered order
includes historical positions; callers filter it without reordering. Unordered IDs
are sorted only for navigation. Current relations contain uniquely resolved,
declared/active, type-valid, noncyclic part_of/supports/depends_on edges; the raw
reverse relations retain other material for diagnosis. No Task state is computed.
Usable definitions add `definition_algorithm` alongside `definition_sha256`.

To select one explicitly reported scope/object:

```json
{"assessment_query":{"target":"R-IMPORT","goal_id":"G-DEMO","scope_id":"FULL","subject":{"kind":"working-copy","value":"sample-copy-a","revision":"sample-baseline"}}}
```

Scope may be omitted only when the selected target has one current declaration.
`read.assessment_selection` returns the resolved selection, conclusion, selected
assessment_id or null, reasons, candidate reports with original conclusions and
locators, historical_reports and pending_reports. Missing localization is never
inferred from prose. A precisely located incomplete report remains a candidate;
legally superseded reports and their old anomalies stay historical. Multiple
surviving reports are not merged or sorted by time. Different goals, scopes,
subjects and roots are not combined. Basis checks read only the selected reports'
registered file references within max_file_bytes, using their actual algorithms;
unknown or changed definitions and pending evidence yield undetermined while
retaining achievements. Diagnostics do not authorize business judgments or Task
operations. This read does not write records, definitions or reports.

VN-01 fields and digest algorithms remain defined by contract.md section 10.
The source handoff fixture is `examples/scoped/`; its data is synthetic evidence.

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
Existing inline `**` patterns such as `docs/product/**.md` also match descendants;
enumeration pruning uses the same glob semantics as file matching.

`coverage.complete` covers only enumeration/byte reads of the selected managed paths.
`coverage.paths` and `excluded_paths` retain the actual request scope in CLI and offline results.
Missing explicit files (including entry when selected), inaccessible relevant directories,
skipped relevant links/junctions and budgets populate `omitted` with known paths/patterns.
When `paths` selects globs, also check all concrete `managed_paths` registrations
matching that selection, even if enumeration cannot discover their missing bytes.
Unselected registrations stay outside this read; exclusions still take priority.
Each requested glob's static directory prefix must be an accessible directory.
A regular file at that prefix is omitted rather than reported as an empty match;
ordinary nonmatching files encountered under wildcard directories are ignored.
If a prefix is also selected as a concrete document, that document can still be read
while its unavailable directory role is reported separately in the same coverage.
Independent readable paths continue after an omission; hard budgets stop enumeration.
A glob with zero matches in a successfully enumerated directory is valid; excluded
or unselected paths are outside this claim. Sources are never all recursively scanned.
An explicit file path (including selected entry) that is a directory is omitted;
directories used as glob prefixes remain normal enumeration scope.
`usable_count`/`invalid_count` and diagnostics describe structure separately. Inventory
is project.inventory's listed sources; delivery is a scoped, source-backed assessment.
Neither follows from read completeness. check reports partial for incomplete coverage;
the standalone offline reader preserves the same gaps and exits 1 for incomplete reads.

`check {}` checks existing managed files and semantic references, without writing.
`check {"path":"docs/product/REQUIREMENTS.md","content":"<candidate text>"}`
checks candidate structure. Neither certifies user intent, source truth or delivery.
Cross-object diagnostics are from existing catalog; read back after saving changes.

## Apply

```json
{"expected_manifest_sha256":"<read digest>","files":[{"path":"docs/product/REQUIREMENTS.md","expected_sha256":"<read file digest>","updates":[{"id":"REQ-IMPORT","metadata":{"scope":"planned"},"body":"## [REQ-IMPORT] 导入\n### 需求内容\n完整更新后的要求。\n### 范围边界\n保留排除项。\n### 验收要求\n实际要求。\n"}]}]}
```

metadata is a top-level patch; omitted fields and unchanged body remain intact.
remove_fields works with or without metadata: merge metadata first, then remove fields.
Removing an absent optional field is unchanged; id/type and required-field removal
cannot bypass identity/schema checks. Removing assessment_id leaves assessments/history intact.
Array fields are full replacements:
read existing links/bindings/work_items first, retain dismissed/historical entries
unless an actual correction/deletion instruction applies. Body contains the
selected item's complete root `## [ID]` and its required `###` sections. It must
have a root boundary before the subsequent item; the writer supplies separating
line breaks for local body replacements and append, without trimming original text. Append with
`append:[{"metadata":{...},"body":"..."}]`; split/merge keep old IDs and refer
to replacement destinations. `content` is for new files or explicitly authorized
whole-file candidates, never combined with item edits. Every candidate uses the same
old→next identity, migration, dismissed-history and affected-item checks. Actual
changes select whole-candidate items, including raw YAML maps and syntax diagnostics,
not only decoded values. Same-value duplicate keys and anchors cannot silently make
a usable item invalid. A valid repair of selected malformed metadata is allowed while
unchanged malformed neighbors keep exact YAML/body bytes; shifted absolute lines or
array indexes do not select those neighbors.

Append inserts new YAML members at the existing sequence's AST location, preserving
old maps, comments and block indentation. It starts new bodies after an existing
body with the minimum complete blank-line separator, including after closed HTML
blocks and whitespace-only final lines. Original bytes are never trimmed. Since
the parser includes separators in body ranges, only the deterministic separator
inserted after original EOF by this local append may extend an unchanged malformed
neighbor's range; its entire original body and YAML map must remain exact. This
does not exempt arbitrary whitespace edits, whole candidates or extra root headings.

Local body must parse entirely inside its selected item. Real additional root `##`
headings or an unclosed structure swallowing a neighbor fail before publication;
`###` sections, code/quote/list pseudo headings and whole-document appendices remain valid.
Read back the saved item to confirm the constraint's actual location.

Whole candidates retain old item IDs/types. When an actual deletion/correction is
authorized, `remove_items:["OLD-ID"]` declares only IDs actually removed in content;
new replacement IDs receive no inherited history. This declaration is not authorization.
New IDs cannot duplicate known current definitions in other registered files; unknown
unread catalog ranges remain gaps. Authorized moves may preserve exact bytes with
normal host tools and update the known manifest scope; no global source scan is added.
Dismissed relations are retained on retries, including equivalent links/bindings with
changed IDs. Actual selective deletion uses
`remove_relations:[{"item_id":"DISC-A","field":"links","id":"L-OLD"}]` at file-operation
level (field is links or task_bindings). Existing remove_fields can explicitly remove
an entire relation field. Neither removal declaration bypasses reassociation checks.
With duplicate relation IDs the candidate identifies the removed rows: the declaration
is valid when an old row is actually removed even if another row with that ID remains.
A declaration without an actual removal fails; it does not waive the current basis.
After deliberate deletion the helper does not maintain a global tombstone; retain
recoverable history where needed and let the host interpret later current decisions.

Reassociation needs reason and at least one genuinely new source basis. Evidence
sources are sets for this comparison: order, duplicate members, object key order,
display labels/notes or a rewritten reason alone do not create new evidence. Other
arrays retain order semantics. A current explicit user reversal can itself be a text
SourceRef; no external document or repeated approval is required. The host judges
whether the basis actually overturns the rejection and retains the old decision,
e.g. using the returned preimage or authorized preimage_path and a change source.

Only known SourceRef evidence fields are compared, including known lines.start/end;
removing unsupported fields does not create a new basis. The guard checks actual
activation or identity changes, including new equivalent IDs. A relation that was
already active with the same ID and identity is not reapproved during unrelated
scope/assessment selection edits or corrections to its explanation.
An unchanged relation field is not rechecked as an activation. Duplicate active IDs
retain their values and warnings; when the field changes, match each retained active
row once before checking newly active rows. A duplicate cannot hide dismissed→active
or a new equivalent association without an actual current basis.
Keeping an old active row with a duplicate ID does not account for deleting the
dismissed row. Retain that history, actually reassociate with a current basis or
use the existing explicit field/relation removal path.
Dismissed history is also matched once per row, by ID and association identity, then
count. One retained dismissed row cannot account for a different association or a
second identical historical row. For a newly active association with a known identity,
compare its own dismissed basis rather than a different association sharing its ID.
Ordinary explanation edits/reordering and unique-ID identity corrections remain legal.

Every file requires expected_sha256; null means must not exist. The optional
expected_manifest_sha256 detects changed write scope. A manifest is itself applied
at its explicit manifest path with content; absent entry is not automatically
created by read/install. Initialize manifest first, then authorized documents.
New writes use v2 or v3. Old v1 files are read-only until this operation explicitly
says `migrate:"v2"` or (for product documents) `migrate:"v3"`. Existing v2 documents
require explicit `migrate:"v3"` to change format; manifests stay v2. Unrelated
files/history are not migrated; untouched incomplete old reports remain readable
with diagnostics rather than receiving fabricated fields. Do not repurpose IDs/types
or downgrade v3 to v2. The source `newDocument(items,title,3)` creates a v3 candidate;
the default remains v2 for existing callers.

When a unique usable v3 project exists, the helper appends successfully saved new
v2 and v3 requirement IDs in batch/file-item order to its requirement_order,
preserving old entries and each requirement file's format.
If this request explicitly supplies/removes project order, that choice takes precedence,
including intentional unregistered requirements. Dependencies, bindings and report
updates do not reorder existing IDs. `requirement_order_update` separately reports
the follow-up project's saved bytes or pending/failed result. Pure v2 additions
without a usable v3 project retain the legacy save behavior without automatic
migration; new v3 additions still report pending order maintenance in that case.
Missing v3 project, freeze or conflict leaves successfully saved requirements intact and visible in the
unordered entry; retry only the failed order update. The follow-up is a separate
per-file save, so consumers reread files after the whole result, rather than assuming
the initial file result is still the last version. Reports must be stored separately
from goal/requirement definitions; changing a definition does not require its reports
to be current or evidence to pass before saving.
Unrelated malformed items retain exact original body and YAML bytes; only changed
items must be valid. Conflicts preserve actual user bytes.
Historical comparisons tolerate malformed old source/relation members; those members
do not themselves supply new evidence. Comparable old sources still protect dismissed
relations. Explicit repair/removal must produce valid selected items, and unchanged
malformed neighbors remain exact; comparison never silently cleans published content.
Results are per file:
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

Default scan exclusions remain enforced for selected files/globs in .git,
node_modules, .next, dist, build, .workflow-system/runtime/ and
.workflow-system/records/. Relevant skipped paths now produce IMPLICIT_PATH_EXCLUDED
and coverage.omitted (exit 1, complete=false), rather than an empty complete read.
Explicit exclude_paths and unselected scopes stay outside the coverage claim.
Registered individual sources may still be read by source request subject to the
existing source permissions and path safety; this is not recursive source scanning.
