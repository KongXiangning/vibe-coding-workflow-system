# Runtime source context (0.18.6)

Use the installed Node CLI at `.workflow-system/runtime/dist/cli.js`. Pass `--root <project>` and JSON on stdin. These context commands do not write task state, admit tests, run checks, or certify evidence. For normal task inspection, use `validate --summary`; plain `validate` retains its full diagnostic output, including stored baselines.

## Bounded CURRENT_TASK reading

For `execute-step` and `review-change`, start each invocation with a fresh
`validate --summary`. Its `source_tuple` identifies the current file and task;
its `summary` supplies current lifecycle and step status, document references,
and `evidence_plan_revision`. Never infer current status from an earlier body
read. Versioned tasks are checked against their stored plan revision by both
forms of `validate`; a failed validation supplies no reusable definition.

To read the confirmed definition, use `file-context` search with
`roots:[source_tuple.path]` for the literal headings
`## 任务输入依据` and `## 执行记录`. Require one exact heading line for each, in
that order. Read from the first heading through the line before the second,
using `file-context` `operation:"read"`, `path:source_tuple.path`,
`start_line`, `end_line`, and
`sha256` set to the fresh `source_tuple.revision`. The first read and every
continuation must match that hash. Follow `next_offset` with the same range
and hash until `truncated:false`; only then treat the definition as complete.
The returned range must include all intervening sections. If a heading is
missing, duplicated, out of order, or search is partial, use bounded pages to
inspect the task and report the navigation gap; do not silently assume a
partial range is the complete definition. If a read is stale, rerun the
summary and restart at offset zero.

Within the same visible conversation, an already complete definition can be
reused only when the fresh summary has the same task ID, document ID, and
non-null `evidence_plan_revision`. If any identity is different, the previous text is
not fully visible, or the conversation was compacted, read the range again.
Read linked Task Basis, execution history, and relevant project documents
separately when the current work requires them. Continue to obtain fresh
`preflight-step` or `review-context` results and inspect current evidence and
cumulative diff; a prior definition read cannot certify those results. This is
in-conversation reuse, not persistent or cross-conversation memory.

## Project document navigation

For task preparation/refinement/replanning, implementation, and review, start
with `.workflow-system/PROJECT_PROFILE.yaml`: use `paths.documentation_files`
as navigation seeds and `paths.workflow_home` for governance sources. Read the
project's listed documentation center or index (commonly `docs/README.md`) before
selecting topic documents. The list is not a requirement to load every file and
does not grant write permission. Honor explicit user-supplied sources and
applicable host-required reading as well.

If the profile has no usable documentation index, inspect the repository README
and its documentation links, then use `file-context` search in the observed
documentation directories. Use actual project paths; do not assume REQ/PLAN
names or a `docs/designs/` layout. A missing index alone does not block a task or
authorize creating one. Search results with truncation or errors do not establish
that relevant documentation is absent.

Select the REQ and its linked PLAN, architecture/technical/design documents, and
relevant Contracts/Decisions by the task's goal, affected paths, APIs, and domain
terms. Follow `related_docs`, `related_code`, and heading/ID links only where they
help resolve that scope; an index is not a substitute for the selected body.
Read the relevant sections with `file-context` ranges and continuations. Read a
whole document when explicitly required or when its relevant constraints cannot
be separated. Do not recursively load every link or all historical documents.

Check each selected source's status, scope, and supersession notes. A draft,
archive, template, example, or search hit is not automatically an operative
requirement. Apply the existing source-authority rules; report material conflicts
or unavailable required sources through the entry's existing unresolved/blocker
result. In execution and review, use the confirmed task to bound selection;
reading a different design does not authorize changing the task.

Identify the sources that influenced the result by path and heading/ID in the
entry's existing explanation or source references. If no relevant project
document was found, state the searched scope instead of inventing a baseline.
This is caller-performed navigation using read-only tools, not automatic semantic
conflict detection or evidence that every source was read. Do not copy document content into the verbatim user Task Basis.

## Saved task document references

`prepare-draft` and `replan` accept optional `project_documents` and
`affected_contracts` together alongside the existing semantic fields:

```json
{
  "project_documents": [{
    "path": "docs/requirements/REQ-example.md",
    "section": "REQ-3 / Acceptance",
    "revision": "sha256:<hash returned by file-context>",
    "purpose": "Defines the required retry limit"
  }],
  "affected_contracts": ["docs/contracts/API.md#retry — update the retry limit"]
}
```

Use repository-relative forward-slash paths, exact heading/ID (or `whole document`),
the observed revision (hash, commit, or declared version; `unknown` when unavailable),
and the reason the source constrains this task. References are caller-reported:
Runtime validates structure and saves them, but does not certify that a document
exists, was read, remains current, or has authority. Check those facts using the
navigation and read tools. `affected_contracts` lists changes this task intends to
make, not every consulted contract; it does not grant write scope.

Runtime stores version 1 references in the task's background section and contract
impact in its affected-contracts section. Both are bound by draft confirmation and
survive the normal task lifecycle. They do not enter verbatim Task Basis.
`validate --summary` and `review-context` return `project_documents` and
`affected_contracts`; execution should read the summary before selecting sources.
A historical task returns `project_documents: null` (unrecorded); `[]` explicitly
records no selected documents. New callers should always send both fields. When
refining or replanning a task with saved references, resubmit those references or
explicitly use `[]` to remove them; omission cannot silently erase recorded context.
Confirmed task changes still require the existing authorized replan route.

## Project document conflicts

During prepare/refinement/replan, compare the request and recorded user decisions
with the selected source sections before deciding acceptance, design, or contract
changes. During execution and review, first read the task's `project_documents`
and `affected_contracts` through `validate --summary` (or `review-context`), then
read the relevant referenced body sections. Also check material omissions through
the navigation above; saved references are a starting point, not an exhaustive
or authoritative allowlist. For legacy null references, use that navigation and
report the absence of a recorded baseline; do not invent prior reading.

Compare the statements that govern this task, including applicability and known
supersession. A changed hash is a reason to inspect relevant changes, not proof of
a contradiction; an unavailable required source is missing context, not a clean
comparison. Do not silently replace the confirmed task's recorded version.

For each material contradiction, explain both exact locations (path and heading/ID
or Task Basis locator), their incompatible requirements, the affected behavior,
acceptance or step, and the decision needed. State which authority applies and
why. A newer timestamp alone does not settle authority. If an existing explicit
user decision already resolves that exact conflict, cite it, state the resolution,
and proceed within the authorized scope without asking for the same decision again.
A general request to implement is not an invented choice between incompatible
requirements. Apply existing instruction precedence and task permission boundaries.

Use the current entry's existing result and Runtime input, not a new conflict file:

- **Prepare/refine/replan:** put unresolved conflict locations, impact, and the
  needed choice in `design_decisions.unresolved`. Put source-determined or explicitly
  authorized resolutions, including their locators, in `design_decisions.decided`;
  submit the selected `project_documents` and intended `affected_contracts` together.
  Record only actual explicit user statements in Task Basis. Runtime prevents
  confirmation while unresolved choices remain. Replan still needs its existing
  lifecycle prerequisite; authorization does not bypass a frozen task revision.
- **Execute:** resolve the comparison before preflight/writes where possible. If
  it remains unresolved, return it in `change-result.blocker` with the user/replan
  recommendation and stop the affected execution. If already executing, preserve
  actual writes and results; `record-step-result` may record `outcome: blocked` with
  the conflict in `note` only when an actual planned command/validation is failed
  or blocked. Never invent a check result or classify a requirement conflict as
  an environment failure to unlock retry. Otherwise return the blocker without
  claiming a Runtime state transition. An authorized correction outside the frozen
  plan must go through replan before implementation.
- **Review draft:** include saved references and independently selected sources.
  Use the existing `authority-conflict` finding with `source_refs`, `request_refs`,
  `draft_refs`, `impact`, and `correction_basis`. Use `needs-user` only for a remaining
  user-owned choice; use `findings` for a determined correction. An already-authorized
  resolution is not itself an unresolved finding.
- **Review change:** if required behavior cannot be determined, persist `blocked`
  through `record-review-result`, with `blocker.code: PROJECT_DOCUMENT_CONFLICT`,
  both locations, impact and needed decision in `blocker.summary`, and
  `blocker.next_route: user` or `prepare-task:replan`. Keep source locators in
  `evidence_refs`, and submit the ordinary test assessment. Do not fabricate a
  repairable code finding to resolve a user-owned choice. If authority already
  determines required behavior, review against it; report a real in-scope defect
  as a normal finding, or a needed plan change as a replan blocker. `clean` requires
  the review itself to be complete, not merely a resolved source conflict.

These are model-performed comparisons with caller-reported conclusions. Runtime
persists the existing decisions/review results and enforces their existing gates;
it does not automatically detect semantic contradictions or certify authorization.

## Cumulative review

`review-context` accepts `{}`. Its execution delta contains the complete file index; `text_diff` expands the first changed file and `unexpanded_paths` lists the others. Full first-touch content stays in Runtime. Use `review-read` for the remaining relevant content:

```json
{"context_receipt":"<the entire receipt object from review-context>","path":"src/example.ts","view":"diff","offset":0,"max_bytes":16384}
```

`context_receipt` must be the object, not a string. `view` is `diff` (default), `before`, or `after`. `before` uses the exact first-touch baseline, including a dirty starting tree; it is never reconstructed from Git HEAD. A changed task or cumulative target rejects the old receipt. Added/deleted files expose their states. Binary/non-UTF-8 content, symlinks, missing historical baselines, and a diff computation limit are explicit `content_status` values, not an empty clean diff. If diff computation is unavailable, read `before`/`after` ranges.

## Same-plan blocked execution recovery

When a planned check fails from a confirmed current-step code, test or fixture
error, `execute-step` may diagnose and recover within the same execution intent.
First commit the truthful blocked result. Send `retry-step` the retained
`blocked_attempt_id`, failure evidence references, and inline
`repair_diagnosis: {kind:"same-plan-repair/v1",status:"confirmed",owner:"current-step",failed_check,cause,repair_paths}`.
`failed_check` must be the exact failed command or validation; every repair path
must already be in that failed attempt's preflight candidates. The diagnosis is
caller-reported and persists in the attempt ledger. Runtime preserves the failed
attempt and allows at most two retries. A successful recovery returns `ready`
only: obtain a fresh preflight before editing, rerun the failed check and due
evidence, and keep any required review. If subjects drifted, scope changed, or
the cause is unconfirmed, report the blocker; do not supersede a task solely
because a check failed. Environment failures continue to use the bound
`environment-restored/v1` report.

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
