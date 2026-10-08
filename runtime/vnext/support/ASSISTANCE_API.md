# vNext management API — assistance, not admission

```sh
node .workflow-system/runtime/support/assistance.mjs <command> --root <project>
```

Source-repository equivalent: `node runtime/vnext/support/assistance.mjs`.
Input is JSON on stdin. Commands: context, task-status, task, record, snapshot, read, find, git-checkpoint.
Native modules assistance.mjs and task-management.mjs use Node built-ins, not the old
transaction/qualification kernel. The service never executes product commands or tests.
`task git` reads local commit objects but writes the requested association and management
views. It is optional, for explicitly requested persistent associations; ordinary commits
are verified and reported directly from Git without calling it. It does not commit or push.

## Two responsibilities, separate results

User instructions and Skills determine work and informed workflow-deviation choices.
`record` preserves arbitrary observations; `task` maintains identity, adopted plans,
steps, execution, reviews/dispositions, Git observations and closure in the same journal.
Do not substitute a generic note for a task operation. Full action shapes, examples and
existing-record recovery: **TASK_MANAGEMENT_API.md** beside this file.

Every response retains development_gate=false and qualification=not-evaluated. These are
not permission grants or PASS. Task operations report fact persistence, association and
view publication independently. A projection/association failure never discards the saved
fact or revokes a still-visible user decision; it also is not complete management success.

State queries use `task-status` or `context.management`, computed from all task facts.
CURRENT_TASK is a generated presentation, not a second current authority. A stale display,
one literal-search page or a raw legacy tuple must not decide the current task. Read-only
queries rebuild in memory and report projection freshness; they do not write files.

One-time confirmation for material workflow deviations is in WORKFLOW_PROTOCOL. Read,
search, save and deterministic view maintenance need no new approval. Ask only about an
unresolved choice with real consequences. After the choice, perform the actual operation
and update its view, without legacy gate/waiver/preflight recovery. Never fabricate consent,
PASS or independent review. A user's review disposition does not edit the review verdict.

## Task queries: full computation, on-demand presentation

Derived prerequisite tasks use explicit origin, entry checkpoint, dependency outcome and
return policy; full action shapes are in TASK_MANAGEMENT_API.md. Reads and task operations
expose actual `next_task_id`/`next_step_id` alongside route/mode/action. These describe the
current focus, which can differ from the affected or explicitly selected task. Summaries
retain origin, dependency/return state and continuation; closure never implies fulfillment
or automatic parent-step finish. Focus restoration performs no business commands.

The CLI defaults for `task-status`, `context` and `task {"action":"status"}` are
now compact. All still rebuild from the entire journal before selecting output;
this is not an incremental cache, truncated search or change to state semantics.
The compiled CLI's ordinary `task-context` delegates to the same native entry.

| stdin field `detail` | Returned task content |
| --- | --- |
| `summary` (default) | One page of task summaries: identity, lifecycle/plan refs, current step result/review/decision refs and counts, remaining work and advisory routes |
| `task` | One complete selected task, including its plans, steps and histories; other tasks are not expanded |
| `step` | One step from the selected task's adopted/legacy plan, including its effective execution, tests, findings, decisions and effective review; not all historical executions |
| `full` | The original complete response shape, for existing CLI consumers and explicit diagnostic/export use |

Use `task_ref` with a stable ID or unambiguous display number to select a task.
Without it, task/step detail uses only the reducer's unique current focus. A missing
or ambiguous selection stays null with `selection.status=unresolved`; it never falls
back to another task. Step detail requires an exact `step_id`, and reports
`selection.step_status`. Read historical plan/event refs using `read`, or obtain the
selected task's complete history with `detail=task`. Query selectors are not task
mutation fields: use `task_ref`, not `task_id`; `plan_ref` is not a query selector.

Each line below is a separate stdin request, not one combined JSON document.

```jsonl
{"detail":"summary"}
{"detail":"task","task_ref":"<returned stable task ID>"}
{"detail":"step","task_ref":"<returned stable task ID>","step_id":"<actual step ID>"}
{"detail":"full"}
```

Compact `task-status` returns `kind:task-query/v1`; `context` puts the same response
once under `management`, without duplicate top-level tasks/current_task or a raw
first search page. Use `current_task_id`, `selection`, `tasks` and their
`detail_request` values for navigation; compact results do not contain the old
full `current_task` object. Read needed plan/step details before reasoning about
implementation or review; an omitted body or a ref does not mean it has been read.
All generated detail and pagination requests retain the effective workflow_home,
including an explicit override or a profile-resolved home. Following a request keeps
that directory context without changing task focus or creating management writes.

Summary tasks use `offset` (default 0) and `limit` (default 20, maximum 100).
`task_count` and `lifecycle_counts` always cover all reconstructed tasks;
`pagination.total` covers the selected output list. Follow
`pagination.next_request` until null. Continuation includes
`expected_view_revision`; a changed live view returns `QUERY_VIEW_CHANGED` and
requires restarting this read, not workflow repair or user approval. This is a
cross-read consistency check, not a transactional snapshot of concurrent writers.
`state_completeness` describes associations, not whether all output pages were read.

Global `issues`, `unassociated_records`, health, source/view revisions and projection
freshness remain visible on every compact page, even when selecting another task.
Diagnostics are not filtered, paged or silently clipped. `coverage` explicitly
states which history is not expanded. Summary/detail are not fixed-token-budget
interfaces: unusual diagnostics or requested full task bodies may still be large.

Existing JS exports `taskStatus`, `context` and `task` retain their full result
contracts. New exports `queryStatus` and `queryContext` implement the compact read
presentation used by the CLI. Mutation results, immutable event/evidence bytes,
CURRENT_TASK publication, the reducer, `read` byte paging and `find` cursors are
unchanged. `detail` never changes how a mutation is recorded or authorized.

## Raw facts: save first

`record` accepts arbitrary JSON. kind, task_ref, source_revision, body, links,
idempotency_key and files are conventional fields. Missing IDs or unknown kinds do not
prevent retention. Malformed JSON passed to record is retained as a raw observation.
The raw payload is saved before optional attachments; missing/changed attachments are
reported separately, not used to reject the report. Do not capture secrets/unrelated files.

```json
{"kind":"test-run","task_ref":"TASK-016","source_revision":"actually-tested-version","idempotency_key":"actual-run-1","body":{"command":"authorized selector","result":"failed","observation":"actual output"},"files":["reports/test.txt"]}
```

The result includes recorded, ref, payload hash, attachment references/issues and management
publication status. Exact replay returns the original record and does not recapture changed
files. Conflicting input with the same key is retained separately, linked to the original,
never overwrites it. Task-command retries compare the original semantic request, so changed
derived defaults/heads do not turn a retry into another adoption or task.

Raw records live in `.workflow-system/records/events`, attachment indexes in records/attachments,
immutable bytes in records/evidence-objects. Task events use this same store. task-labels stores
stable display allocation; task-view.json/task-views are rebuildable presentations. Original
legacy displays are retained under records/legacy. None are software distribution assets.

## Fixed evidence

`snapshot {"path":"reports/test.txt"}` captures an explicit regular file using buffered I/O.
An optional sha256 requests exact historical bytes. A saved digest is resolved first in the
journal, then in the existing workflow-home evidence-objects directory. Changed live content
is never relabelled with the old digest. Missing/corrupt original bytes are reported, not guessed.
This does not prevent new reports or other evidence from being saved.

`read` accepts a path/ref or sha256, workflow_home when needed, offset and max_bytes.
In-repository absolute paths and common separators are normalized. External and symbolic
paths are not followed. Historical reads do not require a live plan, current task or review.

```json
{"sha256":"<actual 64-character digest>","workflow_home":"docs/workflow","offset":0,"max_bytes":8192}
```

Read responses contain exact base64 data, text_preview, size and next_offset. Follow
next_offset until null. Decode base64 for exact reconstruction: the UTF-8 preview may split
a character at a byte boundary. Page limits are not evidence failures. There is no old
one-MiB qualification limit. Availability, historical truth and current applicability are
separate; an old PASS only reports that old run until current applicability is established.

## Navigation and literal search

`context {"task_ref":"TASK-016"}` returns unified task management plus legacy and journal
source navigation. workflow_home is optional; a simple profile hint is read best-effort.
For unusual/ambiguous YAML provide the actual home explicitly. No report save requires it.

`find` searches literal stored bytes, not decoded semantics of arbitrary historical payloads.
Use query and optional roots to narrow evidence searches. It returns paths/byte offsets for read.
Encoded legacy reports may need reading and decoding; do not claim decoded full-text coverage.

```json
{"query":"TASK-016","max_results":20}
```

Follow next_cursor with the same query. partial is pagination, not failure or permission denial.
A cursor is not an immutable snapshot; concurrent additions may need a fresh search. Unreadable
objects appear in issues without excluding other files. Do not interpret no hit on one page as
proof no plan, review or user decision exists; current state is a task-status query.

## Failures, recovery and compatibility

A real raw I/O failure returns unavailable, recorded=false and exit 1; do not claim it saved.
Preserve output through another authorized means and report unsaved state. A task request with
incomplete meaning can still be recorded with association=unresolved. Offer the relevant
rebuild/link/correct/resolve/defer operation, not hand editing or repeating user approval.
Rebuild never reruns tests, execution, git commit or deployment.

Unsupported legacy/free-text associations are reported with source refs. Supplement the real
meaning by linking records; do not replay preparation or confirmation. Unknown or conflicting
facts are not silently selected by latest timestamp. Corrections append, original bytes remain.

Existing file-context, historical task-read/export, knowledge and evidence APIs remain optional
specialized tools in CONTEXT_API.md. The compiled CLI's default task-context delegates to the
unified view after the software is rebuilt; --legacy explicitly opts into the old historical
reader, which may not parse the new CURRENT_TASK display. Do not use it for current status or
send accepted user choices back through old complete/replan/close gates.

## Git checkpoint: one git-commit invocation

The **Git checkpoint policy** in WORKFLOW_PROTOCOL makes an ordinary authorized task/stage
commit include project-wide persistent records, not just business filenames. It never grants
push or includes other tasks' business work. Narrow user instructions and an existing local-only
policy override it. This section is the internal recipe for git-commit, not another public Skill.

`git-checkpoint` performs read-only Git/filesystem inspection. It never stages, commits, writes
configuration, updates task state or deletes anything. All actions retain development_gate=false.
The Skill performs the authorized writes with normal tools. No separate user invocation or
per-record approval is required. API shapes are deliberately not permission/qualification tokens.

### Plan

```json
{"action":"plan","mode":"checkpoint","business_paths":["src/example.ts"],"exclude_paths":[],"untrack_derived":true}
```

Send this to `assistance.mjs git-checkpoint --root <exact Git worktree root>`.
`business_paths` are exact file or Gitlink paths whose intended diffs the Skill has identified,
not globs or an entire directory collection. `exclude_paths` are exact files or directory prefixes (never glob rules).
`mode=paths` restricts candidates to business_paths and proposes no configuration or untracking;
use it for an explicit files-only/staged-only instruction or an existing records opt-out.
`workflow_home` is supported as in other assistance commands. No task identity or clean state
is required. All tasks' records are considered because parents/attachments cross task boundaries.

`source=worktree` (default) plans the authorized working copies. `source=index` plans the
already prepared index content for business_paths: blob OIDs, Git modes and HEAD/index deletions.
For a staged-only request use `{"mode":"paths","source":"index","business_paths":["<selected staged path>"]}`.
These business entries are never placed in add_paths, and their working copies need not exist
or equal the index. The helper still detects later index content/mode changes and staged paths
outside scope. With checkpoint mode, source=index can preserve selected business hunks while
automatically selected management records and policy files continue to come from the worktree.

Index blob hashing uses fixed-size file reads after Git writes its raw output directly to a
private OS temporary file. Blob payloads do not pass through the 64 MiB command-output buffer.
Temporary files are removed after inspection, including errors; project files and the index
are unchanged. The synchronous API remains available, and temporary-storage/I/O failures are
reported as inspection issues rather than silently dropping selected content.

Business symlinks use mode 120000 and their link value, never their target's file bytes. Ancestor
symlinks remain unsafe for worktree I/O; index inspection does not traverse working copies.
Windows placeholders for tracked links are supported when core.symlinks=false. A Gitlink is
supported with source=index by its mode 160000 and selected commit pointer, without entering
or staging the submodule. Worktree planning reports GITLINK_INDEX_SOURCE_REQUIRED: review/stage
the intended pointer with native Git and re-plan using the index. Pointer verification does
not verify nested content, submodule availability, clean state or deployment. Evidence/record
I/O retains its regular-file and no-symlink boundary. Independent authorized native Git work
remains available when a requested operation is outside the helper's supported inspection.

The result is `kind=git-checkpoint-plan/v1` with `base_head`, a file manifest (path, role,
source, Git mode when selected from the index or a link, sha256, raw_git_oid, size, byte_exact), `add_paths`, `delete_paths`, `untrack_paths`,
configuration proposals, omitted paths, issues, reference_issues and counts. Keep the full JSON
in an **OS temporary file**, not under records or a distribution-owned path; show the user
counts, scope and actionable exceptions, not every hash. A plan is a snapshot of inspected
files, not a transaction over ongoing writers. Configuration proposals are not yet applied.
Gitlinks have no blob bytes: sha256/size are null and raw_git_oid is the commit pointer.

| Existing path | Default treatment |
| --- | --- |
| records/events/*.json, attachments/*.json, task-labels/*.json | Preserve, even if a saved report is malformed/unassociated |
| records/evidence-objects/<sha256>.blob, legacy/baseline.json, legacy/current-<sha256>.md | Preserve original bytes; retain and report known digest/reference gaps |
| Historical workflow_home/evidence-objects/<sha256>.blob referenced by structured attachment manifests | Preserve the actual referenced object with the same byte checks, including already tracked objects |
| legacy/display-<sha256>.md, legacy/display-capture-*.md | Conservatively preserve as **recovery material**, not as new task facts |
| task-view.json, task-views/, task-view*.lock, *.tmp | Local derived/temporary data; omit from default staging, do not delete |
| Other paths in records | Report classification-required, never silently collect or discard |

Historical object discovery follows typed content-addressed refs in attachment manifests,
including a different workflow_home used when capturing the attachment. It does not scan the
old workflow directory or follow arbitrary strings in reports. Explicitly selected evidence
object paths also retain their fact role and byte requirements in paths mode. User exclusions,
missing or unsupported refs and corrupt originals remain explicit reference gaps. Objects are
not copied into a new location or rewritten to repair their historical meaning.

Recovery snapshots intentionally remain in Git at this stage. The captured original file is
not moved, deduplicated, truncated or deleted; later writes through an existing descriptor can
still arrive and will be reported at the next inspection. This fixes checkpoint omission, not
physical file growth. A saved snapshot is not a backup of future writes or an audit certification.

### Scoped configuration and staging

For checkpoint mode, `configuration` proposes appended managed blocks in records/.gitignore
and records/.gitattributes. The attribute block disables text, filter, ident and working-tree-encoding
transformations for record bytes. Existing content/newlines are retained. A recognizable generated
CURRENT_TASK, byte-equal to its saved task-view, also permits a workflow-home/.gitignore proposal.
An edited/unrecognized display is retained and reported, not automatically hidden.
For selected historical objects outside records, the same policy proposes a .gitattributes
block scoped to *.blob in each referenced evidence-objects directory. These policy files use
the same preservation, exclusion, freeze and customization checks; unrelated legacy files
and unreferenced objects are not automatically selected.

Check each proposal's `before_sha256` immediately before applying it. Review existing project
rules, freeze governance and any custom filters/encoding; do not silently override an explicit
storage choice. A changed managed block or frozen target requires reconciliation, not replacement.
These are target-owned policy files created on the first authorized checkpoint, not software
assets overwritten by install/upgrade. Default setup can be completed in this invocation; only
an actually conflicting user-owned choice needs one combined question.

After applying authorized proposals, **re-plan** to include their exact files in the same commit.
Honor `SELECTED_PATH_IGNORED`, `TRACKED_FACT_CHANGED`, partial staging and scope conflicts. Do not
use force-add, blanket add, automatic renormalization or reset to make a plan pass. Existing corrupt
history may be saved unchanged with its known gaps; changing a previously committed immutable
fact is a different operation and must not slip in as checkpoint cleanup.

Stage only the listed authorized paths. For large lists or unusual names, pass NUL-separated
paths on stdin to `git --literal-pathspecs add --pathspec-from-file=- --pathspec-file-nul`.
When `untrack_derived=true` was authorized, remove only `untrack_paths` **from the index** using
`git --literal-pathspecs rm --cached --pathspec-from-file=- --pathspec-file-nul`, without `-f`.
This retains working files. No automatic untracking of staged derived changes is proposed.
Missing persistent files are reported, not turned into cleanup deletions. Explicit business
file deletions can be listed in business_paths; records are never implicitly deleted.

Review `git diff --cached` and the actual existing index. A list is not authority. For a staged-only
or partial-hunk request, retain the approved business index content rather than replaying a
whole-file add from add_paths. Include only explicitly authorized paths in the plan. The helper
verifies management bytes and path scope, not the intent or correctness of business hunks.

### Verify the index and actual commit

```json
{"action":"verify-index","plan":"<the parsed plan object, not its filename>"}
```

The example's plan placeholder must be replaced programmatically with the saved JSON object.
This checks the same HEAD, planned file presence, byte-exact records against Git index OIDs,
byte-preserving index attributes, requested index removals, source drift and unapproved staged
paths. `status=mismatch` is a real failed snapshot/scope check, not success. Do not pretend it
passed, force a commit or repair task state to work around it. Independent authorized business
commits remain possible when their own scope can be established; disclose unsaved records.
A known historical reference gap alone does not prohibit saving the available original bytes.

On a verified and reviewed index with actual staged changes, perform the user's normal Git commit
(no `-a`, bypassed hooks, implicit push or empty recursive checkpoint). Save the index verification
in OS temporary storage. Then pass the **actual full SHA** and that result back:

```json
{"action":"verify-commit","plan":"<parsed plan object>","commit_sha":"<actual full SHA>","index_verification":"<parsed verify-index result>"}
```

The actual commit's tree must contain the byte-exact record snapshot and only the authorized
changes relative to base_head; its tree fingerprint is also compared with the reviewed index.
This is for ordinary single-parent/root commits, not merge/cherry-pick/rebase automation.
No Git operation is replayed. Hooks or concurrent writers may change what is committed; report
any mismatch with the real SHA, without automatic amend/reset or claiming a verified checkpoint.
The plan is not an authorization object. Do not alter its scope merely to hide an unexpected diff.

`remaining_records` lists new/changed/unclassified local records that differ from the saved
snapshot, including ignored entries. `planning_issues` and `reference_issues` remain visible.
Missing objects, transformed object bytes and unsafe index attributes found during verification
also remain reference gaps; an earlier clean plan cannot make them report no-known-gaps.
Verification reads planned attachment manifests from the actual index/commit and checks their
typed object dependencies there, including legacy objects omitted by an older v1 plan. It does
not substitute the current working copies, scan arbitrary strings or enlarge the planned scope.
An omitted dependency reports a reference gap; a previously saved dependency is checked by its
actual Git mode, digest and attachment metadata even if it was absent from the plan. Available
planned bytes can still be snapshot_verified with gaps-retained; use a fresh authorized plan
to save a missing dependency. New records outside the plan remain pending for a later checkpoint.
`reviewed_index_compared` states whether the index comparison was supplied; omitting it does not
prove business hunks were preserved. `snapshot_verified` concerns only the inspected planned
snapshot; it is not task PASS, absence of secrets, future-write coverage or remote backup.
Use Git status for all remaining business/index changes as well. Commit success does not imply
push, deployment, task closure or that all records in the worktree were selected.

Inspection leaves project files, the Git index/history and task state unchanged; raw Git blob
inspection uses automatically cleaned OS temporary files. Verification mismatch exits 1 with
its structured result. Service failure also exits 1, with status=unavailable. A completed plan
exits 0 even with reported choices
or reference gaps. No state/record is written for these commands. Do not write task git/record,
refresh CURRENT_TASK, or recursively commit a new event merely to report the commit's own SHA.

## Indexed lossless record archives

`archive` changes physical representation only. It does not change task states, event
bytes, IDs, parents, payload digests or CAS identities. It has no development gate and
never runs automatically during installation, upgrade, task closure or Git checkpoint.
The installed module uses native Node built-ins. Existing old Runtime versions and
external direct-filesystem readers must retain loose files, or restore them first.

Send JSON on stdin to `node .workflow-system/runtime/support/assistance.mjs archive
--root <project>` (source checkout: `node runtime/vnext/support/assistance.mjs`).

| action | behavior |
| --- | --- |
| `plan` | Read-only eligible paths, exact sizes/digests and format limits |
| `create` | Copy stable eligible loose facts into verified immutable indexed packs; retain all originals |
| `verify` | Verify every selected archive/index/pack/chunk and reconstructed object, including loose collisions |
| `quarantine` | After complete verification, move matching loose originals into recoverable quarantine |
| `reclaim` | Separate explicit operation: verify again and remove only duplicate quarantined bytes; archive-backed restore remains available |
| `restore` | Recreate original paths and exact bytes from verified archives without overwriting conflicts |
| `recover-lock` | Explicitly recover only a demonstrably dead lock owner on this host; never steal by age |

`create`/`plan` accept optional `refs: [exact logical paths]`; no refs means all eligible
loose facts. `quarantine`/`restore` accept optional `archive_ids` and `refs`.
`reclaim` accepts `archive_ids` only and requires the complete archive to have been
explicitly quarantined. Omitted archive selection means all existing archives.
Read the preview and retain an independent project backup before actual project cleanup.
A request to implement or install this feature is not consent to clean a business project.

Only events, attachments, CAS evidence objects, task-label reservations, and preserved
legacy baseline/current files qualify. All display recovery files (including mutable
old-editor capture inodes), task-view revisions and CURRENT_TASK are excluded. Late
observations and attachments remain new loose facts; task closure is not a storage seal.

The immutable `records/archives/<manifest-sha256>/` directory contains a versioned
manifest plus numbered indices and packs. Blocks expand to at most 64 KiB. A segment
holds at most 64 MiB raw data, 2,048 record entries and a 4 MiB index; a large object can
span segments. Cold lookups route through manifests to matching indices, under explicit
16 MiB total catalog metadata / 4,096 archive limits. Creation checks the complete
post-activation catalog before publishing and refuses growth beyond these v1 limits
while retaining the original loose facts. Lookups fail with `ARCHIVE_CATALOG_LIMIT` rather than
silently omitting history. Enumeration and full task replay still scale with history.

`read` reports `storage`, `verification` and `read_metrics`. `indexed-selected-chunks`
means the returned archive page is bound to the verified index and block hashes; it does
not mean this page read recomputed the whole object's SHA-256. `archive verify` performs
that complete check. A loose/archive collision, missing index/pack, invalid path, hash,
length or unsupported format is an error. Never rename arbitrary bytes to a historical
SHA or fall back to an unverified duplicate.

The ordinary `read`, `find`, task replay, idempotent recording, snapshots and label
reservation operate on logical original paths. Product SourceRef reads and file-context
exact reads do too. SourceRef locator-free reads support byte paging; structured locators
retain their existing file-size budget. File-context whole-file reads over 64 MiB report
`READ_TOO_LARGE`; use assistance paging. Literal `find` uses range-only discovery: when both representations exist it compares
the selected loose range to the indexed archive page, and does not claim whole-object
duplicate verification for unread pages. A conflicting page is reported while independent
files continue to be searched; gaps are partial results. Native ripgrep file-context search cannot see
packed bodies and reports its archive coverage gap explicitly; use assistance `find`.
Product document writers cannot write into the managed records store, even when a custom
product manifest registers it as a capture target; use the record/snapshot APIs instead.

Checkpoint plans include all necessary manifest/index/pack bytes, validate typed logical
references, and account for explicit verified archive migrations in `delete_paths`.
Actual index/commit verification checks the stored packs, not the worktree's cached
claims. Review the exact plan before staging; the command itself never stages or commits.
Keep the archives and their indices in the same backup/commit. A fresh offline clone can
read and restore old logical refs without local quarantine receipts. A missing index must
be restored from the paired backup/commit; this version does not expose automatic index
reconstruction, although pack frames retain the reconstruction metadata. An explicit restore
materializes loose compatibility copies; keep/reclaim them deliberately before planning
the next checkpoint. No receipt recording the checkpoint's own SHA is needed.

Quarantine alone reduces files in the active record directories but does not save total
project bytes. Report archive bytes, quarantine bytes and final retained bytes separately.
Reclaim saves physical duplicate files while preserving every logical fact in the archive;
it does not erase old Git blobs or promise an equal reduction of `.git` history.

## Generation-side evidence and display reduction

### Fixed material versus this run's capture

`record` and `task` accept `evidence_refs`, an array of immutable `{ref, sha256}`
identities, or `{sha256}` for an existing content-addressed object. Optional fields are
`size`, `label`, `purpose`, `role`, and `workflow_home`. `ref` may identify an existing
record event/attachment, preserved legacy current baseline, or a content-addressed
`evidence-objects/<sha256>.blob`; a mutable business document path is rejected.
Obtain the actual identity from a record/snapshot/attachment result, the raw read's
`actual_sha256`, or a logical task-event read's `wire_sha256`.

The original observation is saved first. Each reference is fully byte-verified and
associated with this event in its attachment manifest as `status: referenced`,
`kind: fixed-evidence-reference/v1`, with `live_source_read: false`. No live source
is recaptured and no new evidence blob is created for that reference. Missing/corrupt,
wrong-size or invalid references produce explicit unavailable attachment entries;
they are never silently replaced with live files. A same-request retry reuses the old
event and manifest rather than creating another run.

`files` retains its existing meaning: capture the complete, explicitly requested current
bytes. The Runtime never crops a cumulative report, infers that similar runs are redundant,
or discards different failures, decisions, uncommitted states or database before/after
results. Use fixed old identities plus this run's necessary `files`; choosing those
materials is explicit caller/Skill policy, not automatic content inference.

Example record input:

```json
{"kind":"test-run","idempotency_key":"actual-run-2","body":{"run":"2","result":"failed"},"evidence_refs":[{"ref":".workflow-system/records/evidence-objects/<actual-sha256>.blob","sha256":"<actual-sha256>","role":"fixed-baseline"}],"files":["reports/run-2.txt"]}
```

### One full report, unchanged logical request

New task-generated events may use `task_event.version: 2` with
`data_encoding.kind: request-json-pointers`. The complete original request remains
inside this same event; repeated long data subtrees refer to that request through
validated event-local JSON pointers and its canonical request SHA256. No extra body
file or mutable external lookup is introduced. Encoding is used only if the complete
stored event becomes smaller and self-decoding exactly recovers the logical v1 payload;
otherwise it retains v1. Arbitrary raw `record` inputs are not rewritten.

The stored `payload_sha256` describes wire bytes' payload, not the hydrated logical
payload. Readers verify that digest first, then resolve only supported own-property
pointers. Bad/unknown versions, invalid paths, request mismatch or expansion limits
are explicit diagnostics; original bytes remain available. Old v1 bytes and IDs are
not rewritten. Replays compare the complete original request identity, so changed
heads or focus do not rewrite the first observation.

Default `read` remains original byte paging. For an explicit complete semantic view:

```json
{"ref":".workflow-system/records/events/<actual-event>.json","format":"logical-task-event"}
```

It returns the logical v1 `payload`, `wire_size`, `wire_sha256`, `wire_payload_sha256`,
`logical_payload_sha256`, `request_sha256`, and `encoded`. Default/maximum expansion is
64MiB and at most 4,096 pointer references; `max_bytes` can further limit the returned
logical payload. This format accepts no byte offset or evidence-object SHA selector.
Raw paged reading remains available when a complete logical read is too large.
The entire report remains searchable in events-only `find`, because it remains in request.
Older Runtime versions are not consumers of the new task v2 encoding: upgrade readers
or explicitly export the verified logical view, rather than interpreting the wire template.

### CURRENT_TASK semantic identity

New derived displays use `schema_version: 2`, `kind: vnext-task-view`, a `display_revision`,
and the v2 marker. Their canonical text contains no volatile fact source/view revisions.
`task-status`, `context` and the mutable `task-view.json` still carry current fact revisions;
`display_revision` identifies only the displayed semantic content.

An ordinary fact append that changes source/view revision but not displayed meaning updates
the cache without creating another task-view snapshot, renaming CURRENT_TASK or producing
recovery copies. `projection.display: unchanged` describes that write result. Read-only
status may report display `current` with `display_comparison: semantic-content`; it does
not claim a retained v1 header contains the newest fact revision. Known v1 baselines remain
byte-exact until a real displayed change warrants v2 publication.

Current bytes must match an actual readable published baseline before overwrite. Missing
baselines are not generated to legitimize user content; unknown formats and edits remain
drift. Real publications keep old-inode capture and late-editor-write protection. Existing
view snapshots and recovery originals are not deleted, and no per-revision pointer files
are created. Querying status remains read-only; this is not a new task state or admission.

### Short store-lock contention

A live record-store writer may be awaited for up to two seconds, measured with a monotonic
clock, before acquiring the original exclusive lock. Only the unacquired lock is retried;
no business operation or write callback is replayed. Timeout remains `STORE_BUSY`, and dead
owners still require explicit recovery. This bounded contention improvement does not steal
locks or change archive reclamation permission.
