# Runtime source context (0.18.7)

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
Confirmed task changes require a confirmed replan route; the legacy one-call
route is currently disabled as described below.

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

The legacy one-call `prepare-task:replan` and raw `commit-replan` paths remain
blocked with `REPLAN_CONFIRMATION_REQUIRED`.
An upgraded older task first needs explicit `prepare-task:initialize-preservation`
with `{source_revision,basis_revision}` from a fresh summary and linked Task
Basis. `upgrade` itself leaves both files unchanged. Initialization verifies
the existing plan, saves exact CURRENT_TASK and Task Basis bytes in task history,
then sets `task_evolution_version: 2` (including an explicit upgrade from version 1) without changing the definition, evidence,
or active step. A missing marker blocks supersede and correction confirmation;
an unknown marker version is rejected. New drafts receive the marker at creation.
Do not edit the marker or history manually. For a challenged prior result,
`review-change:record-evidence-challenge` accepts its `claim_id`, `slot_id`,
`result_id`, repository-relative `evidence_ref`, SHA-256 of that file, and
reason. It records `contested`; it does not assert that the previous result is
wrong. `validate --summary` exposes unresolved challenge IDs. Unresolved
challenges block ordinary preflight, advancement and successful closure.
If review establishes that the challenge is not substantiated, use
`review-change:dismiss-evidence-challenge` with
`{challenge_id,evidence_ref,evidence_sha256,reason}`. The assessment file must
state the inspected counterevidence and why it does not invalidate the bound
result. Runtime retains both records and the original report, marks only that
challenge resolved, and does not alter task scope or plan. This assessment is
caller-reported; do not dismiss a confirmed error to bypass correction.

For a confirmed incorrect old result, `prepare-task:prepare-replan` accepts
`{challenge_id, correction_step:{id,description,mutation_scope,required_evidence,commands}}`.
The conclusion step can write only exact documents admitted by both the original
mutation scope and `boundaries.non_executable_change_paths`; directory names
grant no permission. Runtime copies the old goal, acceptance and total authority,
retains executed definitions, inserts recovery before pending work or at task end, and
writes an independently inspectable candidate. The receipt binds its digest,
old CURRENT_TASK/Task Basis revisions, full old-obligations digest, new plan
revision and `permission_change:none`. Preparing does not change CURRENT_TASK.
Read the candidate file before obtaining an exact authorization decision.
`confirm-replan` takes `{candidate_receipt,authorization:{approved_candidate_digest,decision_source,decision_text,invalidation_reason}}`.
This caller-reported decision must bind that exact candidate. Runtime rechecks
the source, old obligations and live evidence, then atomically publishes a new
Task Basis and CURRENT_TASK with an exact-byte history preimage. It marks the
challenged result invalidated, activates the correction step, and retains the
original later step. `discard-replan` takes `{candidate_digest}` and only
marks the candidate discarded. It does not reactivate a superseded task.
For a superseded source, confirmation additionally requires
`authorization.reactivate_superseded:true` and a prior acceptance invalidation;
a prior goal or scope invalidation cannot be repaired by this restricted route.
Changing the goal, permission scope, claim/check method or an original step is
outside this restricted route and remains blocked.
The current Runtime has no non-completion successor transition. A superseded
task cannot create a new draft (`REPLACEMENT_OUTCOME_UNSUPPORTED`); keep its
unfinished obligations visible instead of closing it as completed.

Unchanged old reports remain unmodified and may satisfy a new plan only through
Runtime-generated `evidence-carry-forward/v2` records. The old_source_revision and
old_plan_revision identify the immutable original report; receiving_source_revision
and new_plan_revision describe this generation's reception. Runtime checks the
immutable old report/check, current subject files, method, plan revisions and
open challenges at each consumption. The challenged slot needs a new result ID
and a fresh clean correction review. Old consumed before-step receipts remain
historical. A replacement consumer uses an explicit new before_step_id and a
new preceding verification step; it cannot copy an old consumption receipt.
Old clean reviews do not cover new correction changes. Exact
CURRENT_TASK and linked Task Basis bytes are saved under
`<workflow_home>/task-history/<document_id>/<source_revision>.json`; external
evidence locators are references only. Do not read the base64 package into
model context by default; use normal bounded CURRENT_TASK reading.

### Versioned recovery input

`prepare-replan` normalizes the legacy single challenge into `challenge_ids`
(1–16 for conclusion correction). It also accepts:

- `mode`: conclusion-correction or execution-recovery.
- `strategy`: forward-fix, artifact-restore or mixed. Conclusion correction uses forward-fix.
- `execution_targets`: up to 16 exact `{execution_id,reason,evidence_ref,evidence_sha256}` records from this task, without fabricated reports.
- `correction_step`: first recovery step `{id,description,mutation_scope,required_evidence,commands}`; `recovery_steps` lists up to 15 subsequent recovery steps of the same shape. Every recovery checkpoint is required.
- `pending_step_changes`: `{steps,step_map:[{old_step_id,new_step_ids}]}` replaces never-executed future definitions using new IDs. Every removed future obligation and suspended unfinished attempt requires a destination. Executed definition bytes and logs remain historical facts.
- `obligation_map`: all old `{claim_id,slot_id,due_step_id}` records for execution recovery or pending-plan changes. A check replacement adds `replaces_check_id` and a new `check`; old required boundaries and subjects remain. A new prerequisite consumer adds `before_step_id` and a new preceding verification step.
- `restore_plan`: `{checkpoint_id,paths}` from `artifact-checkpoints`. The first recovery step declares `runtime:artifact-restore` and its exact expected_repo_writes. Preparation and confirmation only bind the plan.

Candidate v2 contains source_tuple, Basis/source/plan revisions, full old obligations,
obligation_map, historical_completion_refs, result_validity, evidence_admission,
evidence_objects and the exact derived restore_plan. Read these before confirmation.
Old v1 candidate receipts never authorize v2 writes. V1 evidence without preserved
bodies requires affected-slot revalidation. Unresolved challenges outside a batch
remain recorded and block ordinary progression and closure.

If a preflight, dirty attempt or pending review already exists, `suspend-recovery`
takes `{source_revision,reason,evidence_refs}`. It retains the real attempt and
first-touch baseline, records the dirty target, and blocks ordinary execution.
Existing admitted repair owners must converge first; suspension does not invent
failed checks or environment errors.

`ingest-evidence` takes `{source_revision,source_locator,body}` on stdin and returns
an immutable evidence_ref, evidence_sha256 and provenance_ref. Limits: 1 MiB per
object, 8 MiB per snapshot, 128 files; repository paths cannot traverse links.
Old document bodies are saved before correction and can be read via bounded
`file-context` reads of the corresponding evidence-objects SHA `.blob` file.
Material reuse, report reuse and historical completion are separate facts.

`route-input` takes `{source_revision,input_ref,input_sha256,relation,operation,reason}`.
Relation is `unrelated` or `current-task`; operation is `review-conclusion`,
`recover-execution`, `change-goal`, `change-acceptance`, `expand-authority` or `other`.
It returns a task-bound, caller-reported route, never extra write permission.

After confirmation, run normal `preflight-step`, then `apply-artifact-restore`
with `{preflight_receipt}`. Run the declared post-restore checks and record the
real result before required review. Added/deleted UTF-8 regular files are supported;
symlinks, submodules, unverified binary baselines, oversized content and remote
side effects are unsupported. Governance, .git and Runtime installation files
cannot be restored. Drift blocks without overwriting user edits. A durable
multi-file journal preserves preimages; an interrupted publication fails closed
until its exact write set is recovered. No reset, clean or whole-repository checkout.

Restoration writes a bounded `artifact-restore-completion/v1` object under the
task's immutable `task-history/<document_id>/artifact-restores/` directory before
removing its publication journal. It binds task, document, candidate, plan, step,
attempt, preflight identity and exact restore plan. Successful result recording
and reviewed completion require both this fact and the target file images.
Caller-reported command status cannot replace the fact. Put forward mutations of
restored paths in a later recovery step. Missing facts on older active restores
fail closed; software upgrade does not invent proof of earlier restoration.

After an environment blocker following a successful restore, retry-step and fresh
preflight must be followed by apply-artifact-restore again. If exact targets and
the immutable original v1 fact still verify, Runtime writes a new attempt-bound
artifact-restore-completion/v2 referencing that original fact, without rewriting
products or extending a recursive receipt chain. Old receipts alone cannot admit
new attempt results. Missing origin facts or changed files block revalidation;
fresh post-restore checks and review remain required.

Multiple challenges of one original report may be corrected in separate batches.
Runtime traverses bounded confirmed correction relationships backed by real
results and clean completion snapshots. Verified candidate source preimages bind
the actually replaced report as well as selected challenge origins, so either
interleaved processing order retains the
original challenge result IDs; each remaining batch needs fresh evidence and review.
Failure budgets follow confirmed execution and pending-step replacement identities,
including old v2 candidates with separate stored keys; changing IDs cannot reset them.
Raw step-progress shares the durable current preflight admission gate for recovery
steps. Real outcomes of admitted attempts remain recordable.

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
