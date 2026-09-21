# Runtime source context (0.20.8)

Use the installed Node CLI at `.workflow-system/runtime/dist/cli.js`. Pass `--root <project>` and JSON on stdin. These context commands do not write task state, admit tests, run checks, or certify evidence. For normal task inspection, use `validate --summary`; plain `validate` retains its full diagnostic output, including stored baselines.

## Current view, state, and history

`CURRENT_TASK.md` is the fixed human/Agent entrypoint, not the complete event
ledger. Its frontmatter and body show the current confirmed definition, current
workset, obligations, gates, and exact references. The durable aggregate is
stored under `paths.workflow_home/task-data/<document_id>/`:

```text
objects/<sha256>.json
events/<sequence>-<sha256>.json
indexes/                  # rebuildable lookup material only
manifest.json             # aggregate head and committed object references
```

The manifest's single head selects the current source, definition, state, and
committed event range. An object or event that is not acknowledged by that head
is not an executed action. Objects are content-addressed by schema, object type,
document ID, and complete payload. Equal content may be stored once, but every
execution, review, authorization, and idempotency event remains separately
identifiable and ordered. The hot arrays retained in the legacy file are only a
compatibility cache; they do not determine whether older facts exist.

For ordinary operations use the read-only `task-context` projection. It has
three layers: a bounded overview; the operation context with the complete
current definition (unless the exact definition revision is still visible in
the same conversation), current-step requirements, unfinished obligations,
recorded dependencies, explicit unknown-dependency warnings, global gates, the
latest execution, and the cumulative review target; and on-demand history. It never returns raw
`runtime_state`, an unbounded execution log, or an unbounded idempotency list.
Unknown dependency data stays unknown: a missing dependency graph is not proof
that a gate can be skipped.

```powershell
node .workflow-system/runtime/dist/cli.js validate --summary --root <project>
'{"entry":"preflight-step","max_bytes":16384}' |
  node .workflow-system/runtime/dist/cli.js task-context --root <project>
'{"kind":"event","event_sequence":12,"event_hash":"<sha256>","max_bytes":8192}' |
  node .workflow-system/runtime/dist/cli.js task-read --root <project>
```

`task-read` accepts only an exact object, event, history material, or bounded
file reference. A response is UTF-8 byte bounded and includes its selection,
returned bytes, total bytes, continuation, and `complete_for_operation`. Follow
the exact continuation with the same source/definition/state revision and
reference. A stale revision or changed exact reference requires a fresh read;
never combine pages from different heads. Required content not fully returned
means the operation context is incomplete. Context/read receipts prove only the
version and returned range; they are read-only and do not authorize a write.
Repeated reads do not append audit events.

New transaction events keep `transaction.proposal` and `transaction.result` as
exact committed object references. Read them with `kind:proposal` or
`kind:result`; `kind:semantic-delta` restores the semantic delta from the
authoritative proposal object. Large claim evidence and execution results are
referenced objects, not a second inline copy. For a migrated old source,
`kind:history-material` with `source_revision` and optional `old_line` resolves
against the retained exact preimage and returns an `exact-preimage` locator.
It never interprets a line number against the compact CURRENT_TASK rendering;
an unavailable preimage remains an explicit missing-history error.

`validate --summary` checks the current aggregate and directly referenced
objects. In compact representation it also verifies the CURRENT_TASK binding,
manifest head, and the required current object closure; an invalid aggregate is
reported as blocked/non-zero. `validate --deep` is an explicit diagnostic that walks the full
committed event chain and object references. The two scopes must not be reported
as equivalent. `task-export` is an explicit aggregate export for backup or
verification, not the default model input. It returns canonical export JSON as
UTF-8 byte-bounded text pages with a continuation; concatenate all pages before
parsing it, and measure the entrypoint, projection, and complete store separately.

Storage migration is separate from task evolution. Run
`task-storage-migration` with `mode:preview`, inspect the exact current
`source_revision`, then commit with that revision. Migration preserves the old
CURRENT_TASK bytes, known history and old locator information; an unavailable
preimage remains an explicit missing fact. Distribution upgrade does not
remove target-owned `task-data`.

## Default bounded context protocol

The daily protocol is deliberately ordered:

1. `validate --summary` obtains the newest current status and aggregate health.
2. `task-context(entry, mode)` returns the bounded overview and operation
   blocks. Required blocks may span pages; follow `continuation` until
   `complete_for_operation: true` before using the operation context.
3. `task-read` resolves exact definition, result, finding, receipt, event, or
   retained history references. `file-context` and `review-read` remain the
   source/diff readers for their existing boundaries.
4. Only then invoke the existing preflight, execute, review, recovery, or
   lifecycle entry.

The projection is a DTO allowlist, not a serialization of `RuntimeState`.
CURRENT_TASK remains a complete, governed presentation of the current
definition and workset, but compact CURRENT_TASK does not contain the complete
execution log or idempotency ledger. Missing task-data, a damaged object,
manifest/source conflict, or a pending commit is an explicit recovery/error
state; it is never converted into an empty history or bypassed by an unbounded
Markdown fallback.

Definition reuse requires the same visible conversation/session and the exact
task ID, document ID, and `definition_revision`. A new session, compressed
context, changed revision, or changed selection requires a fresh read. A
receipt proves only the immutable version and returned range; it is not a user
authorization, write permission, execution qualification, or proof that the
model read or understood the content.

## Bounded CURRENT_TASK reading (legacy compatibility)

The following Markdown range procedure is retained only for an explicitly
requested legacy/diagnostic read. For `execute-step` and `review-change`, the
default is the protocol above. Start each invocation with a fresh
`validate --summary`; its `source_tuple` identifies the current file and task.
Never infer current status from an earlier body read. A failed validation or a
compact/store error supplies no reusable definition.

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
reused only when the fresh summary has the same task ID, document ID, and exact
`definition_revision`. If any identity is different, the previous text is not
fully visible, or the conversation was compacted, read it again through
`task-context`/`task-read`.
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

`review-context` accepts `{}`. Its execution delta contains a bounded file index;
`text_diff` expands the first changed file and `unexpanded_paths` lists a bounded
prefix of the others. `complete_for_operation` is false when the index,
Persistent Tests, admitted findings, or claim/slot summaries were truncated;
`required_unexpanded` names the exact blocks that must be read before a verdict.
Full first-touch content stays in Runtime. Use `review-read` for changed files
and `task-read` for the exact recorded event or claim-evidence block:

```json
{"context_receipt":"<the entire receipt object from review-context>","path":"src/example.ts","view":"diff","offset":0,"max_bytes":16384}
```

When `claim_evidence_truncated` or `required_unexpanded` contains
`claim-evidence`, read `task-read` with `{"kind":"claim-evidence"}` and follow
all UTF-8 continuations. This is the authoritative current claim/report
projection; the bounded summaries in `review-context` are navigation only.
The event reference in `recorded_execution.event_reference` is the exact
historical source for the recorded execution and its retained object references.

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

### Independent scope amendment

When the caller has already received an explicit user decision for an exact
additive path set, return one manual public `prepare-task` call with mode
`amend-scope`. It is
available for an active or `blocked_by_replan` task even when code is already
changed, a review result is pending, or findings are admitted/in-progress. The
caller passes the exact paths, any new persistent-test paths, and the original
decision source/text. If exact-path authorization is missing, return the missing
paths and stop without creating a candidate. Otherwise Runtime writes the
versioned `scope-amendment-candidate/v1`, computes its digest and receipt, and
commits the amendment in the same Runtime route. The source remains
`caller-reported`; the digest is only an internal drift/idempotency guard and is
never a second user authorization object. The user does not call a separate
candidate approval action or construct receipts or authority transitions by
hand.

The amendment creates a new continuation step and retains the previous step
definition/history, failed and uncompleted obligations, findings, pending
review, cumulative review baseline, review cycle and used attempt budget. It
does not clear pending review or reset the review cycle. The user must then
call a fresh `preflight-step`, execute/repair, `review-change`, and normal
advancement/closure entries separately. The amendment operation alone is never
completion, and public skills never invoke one another automatically.
If the retained review is clean and has no finding, call
`complete-reviewed-step` with the retained prior step; Runtime consumes that
review handoff and leaves the new continuation ready before the fresh
preflight.
The legacy `prepare-task:prepare-replan` / `correction-replan/v2` route keeps
`permission_change: none` and cannot consume a scope-amendment receipt.

### Exact repair-budget continuation

When `task-context.next_entry` is `prepare-task:extend-repair-budget`, the exact
pending review is blocked by `REPAIR_BUDGET_EXHAUSTED`. This state is not eligible
for correction replan because its pending review and open findings must remain the
current repair authority. After an explicit user decision, call the prepare-task
adapter command `extend-repair-budget` with:

```json
{
  "review_id": "review-...",
  "finding_fingerprints": ["finding-..."],
  "additional_repair_attempts": 1,
  "decision_source": "user:<stable-source>",
  "decision_text": "<verbatim authorization>"
}
```

The fingerprint array must contain every and only currently exhausted open
finding in that pending review cycle. Runtime adds one maximum attempt to each,
records a Task Basis decision and typed audit, and preserves prior attempts,
statuses, pending review, review baseline, task definition, and identity. If the
cycle repair-wave quota is exhausted while the findings still have attempts,
submit the same bounded decision with `finding_fingerprints: []` and
`extension_scope: "repair-round"`; this raises only the cycle quota and changes
no finding attempt maximum. The ordinary defaults remain two attempts per
finding and three repair waves per cycle; explicit extensions have absolute
caps of eight each. Navigation and the transaction use the same qualification:
the candidate next repair round must remain at or below eight, and every
selected exhausted finding must remain below eight attempts. At either absolute
limit `task-context` does not recommend `extend-repair-budget`; it returns the
structured blocker reason and the user-owned diagnostic/controlled-recovery
decision route instead. On success the next entry is `execute-step:repair`, which
consumes the retained review through a fresh execution and verification. An
exact replay is a no-op; partial, stale, reset, or second unconsumed extensions
fail closed. Without explicit authorization, stop at the user-owned blocker. A
budget-blocked review retains its structured `findings`,
`unresolved_fingerprints`, and `resolved_fingerprints`; the extension set is
only the subset authorized for extra attempts. A review-declared resolution is
applied to the finding queue in the same Runtime transaction, so the retained
review and queue cannot disagree. After extension, repair consumes the full
current review set whose findings are admitted and in scope, so findings with
remaining budget are not dropped and findings already marked resolved are not
re-scheduled.

### Controlled recovery at the absolute boundary

When ordinary extension is no longer executable because the repair-wave or
per-finding absolute limit has been reached, a latest blocked review may carry
structured `finding_dispositions`:

```json
{
  "fingerprint": "finding-...",
  "disposition": "must-fix",
  "basis": "critical-invariant",
  "evidence_refs": ["evidence/..." ]
}
```

Only `must-fix` findings are eligible for controlled recovery. The user then
calls `prepare-task:authorize-controlled-repair-recovery` with the exact
`review_id`, selected `recovery_fingerprints`, one closed-set `recovery_basis`,
the decision source/text, and evidence references. Runtime derives the complete
current repair set and binds task/document, execution, cycle, phase, change set,
and review-target revision. The grant authorizes one repair wave and at most two
separate controlled attempts per selected finding; it never raises ordinary
maxima, resets counters, clears a review, manufactures clean, or closes an
unverified finding.

The authorization set is not the repair set. Findings with remaining ordinary
budget stay in the full repair wave, verified resolutions stay out, and a new
finding must pass normal admission before it can execute. Exact replay is a
no-op; stale review identity, cross-task or cross-review targets, duplicate
grants, and controlled-quota overflow fail closed. Legacy blocked reviews that
lack dispositions may use only an explicit exact-target `legacy-explicit-user`
authorization; that target must cover every existing unresolved finding in the
full repair set with no ordinary attempt remaining. A partial legacy request
fails before the one-per-review grant is persisted, so the complete
authorization can still be submitted afterward. Runtime never infers a target
from prose.

For a legacy 0.20.5 budget-blocked state whose stored review has empty
`findings`/`unresolved_fingerprints`, the upgrade is intentionally fail-closed:
it does not infer targets from prose and does not rewrite `CURRENT_TASK.md`.
After the formal distribution `upgrade`, obtain a fresh `review-context` receipt,
re-run the review against the recorded execution and exact review target, and
submit a new structured `record-review-result` with evidence references. Only
that bound review may be used for `extend-repair-budget`; stale receipts,
changed source/task identity, mismatched execution or target paths require a
new review. This is a recovery write through the Runtime transaction boundary,
not a direct task-status edit.

Ordinary `prepare-draft` remains closed for a superseded task
(`REPLACEMENT_OUTCOME_UNSUPPORTED`), so unfinished obligations cannot be hidden by
pretending the predecessor completed. An explicit later replacement request uses
the separate `prepare-successor` route described below: it keeps the predecessor
superseded, binds every old slot/open finding to carry-forward or retirement, and
creates a fresh unexecuted draft identity that still requires normal confirmation.
Supersede by itself never authorizes that successor.

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

## Process-control operations

For explicit manual observation, use prepare-task's internal
`record-human-acceptance`; for explicit unverified risk, `record-evidence-waiver`.
Use exact claim/slot/check, plan and subject revision from `evidence-context` and
the user's original source/text. The optional `validation_items` lists only exact
labels exclusively owned by the frozen check's `validation_items` (or an
unambiguous label equal to its entry). A same-step label is not ownership. New
ownership is admitted with the plan, never invented while recording the waiver. Inputs and restrictions are defined in
FILE_SCHEMAS.md. Both are caller-reported and do not grant authenticated realign.
Inspect `user_decision` in evidence/review/task context; never interpret waiver as
execution PASS. `waiver_decision_id` on a truthful nonpassing result is verified
against that exact decision and cannot excuse an unrelated command or validation.

A local equivalent invocation adjustment uses execute-step's `replace-validation`
with source_revision, claim_id, slot_id, replaces_check_id, replacement_check and
reason. Preserve observation, boundary, subjects, validation ownership, exact
granularity, selector, breadth authority (including focused E2E), scope and
budgets. Read fresh context/preflight afterwards. It does not accept an entire
task definition. Changed business obligations still use bounded correction.

An explicitly requested replacement after supersede uses prepare-task's
`prepare-successor` with the exact predecessor identity/source/Basis, verbatim
user decision and full old-obligation dispositions plus an ordinary new draft.
Old unfinished state is retained; the new draft requires ordinary confirmation.
After a publication exception, retry the identical request: exact prepared Basis
and predecessor artifacts may be reused; an initialized aggregate retains its
original creation audit. Different artifact bytes or proposal identities are
conflicts, not permission to overwrite. Do not bypass a retained governance lock.
Do not trigger supersede or successor merely because implementation needs repair.
No public Skill invokes a following Skill on the user's behalf.

Authority-amendment continuations retain the original evidence check commands and
their exact repository-write footprints when those obligations move to the new
step. Runtime does not synthesize a shell command from an implementation note or
make the caller repeat an already frozen validation plan merely to add permission.


## Compact-v3 active task presentation

New tasks select exact immutable definition and state roots from CURRENT_TASK.
The small Markdown file is a navigation projection, not the full plan or a new
permission source. Continue using task-context and all required pages; use
`task-read` for exact definitions, state, reports and review material. Default
definition/state reads resolve the roots into a labeled logical view; explicit
SHA object reads remain raw. Do not infer acceptance or mutation scope from
summary text or edit task-data objects by hand.

Existing inline and compact-v2 tasks continue unchanged. For an explicitly
requested representation-only compaction, use the existing
`task-storage-migration` preview, then commit with that exact source revision.
Preview includes old/projected UTF-8 byte counts and writes nothing. Compaction
retains original task/Task Basis/definition, decisions, scopes, outcomes,
findings, review/repair budgets and historical source locators. It is not
replan, successor, waiver, a test rerun, or a new workflow checkpoint.
If canonical publication was interrupted before aggregate acknowledgement,
retry the identical migration commit. Under the existing governance lock it
recovers the exact pending transaction; its acknowledged result is idempotent.
A source changed by any later transaction is still stale. Retained global write
locks are not deleted or bypassed by compaction.

Backups and transfers must include CURRENT_TASK and its task-data directory
(and linked Task Basis and external evidence as before). `task-export` retains
the complete committed object/event closure. No automatic history deletion or
file-size rejection is performed. This representation reduces the active file;
it does not claim that every internal Runtime operation avoids hydrating the
full logical state/history or that total audit storage stops growing.

### Storage migration and in-flight receipts

Keep the original confirmation, execution/repair preflight, review context and
correction-candidate receipts when an explicit storage migration occurs. Runtime
accepts their old source only through an uninterrupted committed storage-migration
lineage whose retained exact preimages reconstruct the same normalized logical
state, definition, authority and task identity. An intervening business transaction,
unknown source, corrupted/uncommitted history or pending publication does not qualify.
All existing step, execution, review-target, evidence, Task Basis and budget checks
still apply. Do not reacquire first-touch baselines after editing product files just
because CURRENT_TASK was compacted; do not reconstruct or rewrite caller receipts.
Candidate confirmation preserves the approved digest and records the actual current
physical predecessor for history/carry-forward proof. Ordinary optimistic write
proposals, migration commits, physical read/page coordinates and read-back checks
remain exact; refresh read-only context when its physical revision changes.

Compact-v3's navigation and hot-field model is version-specific in
`task-projection-v3.ts`. Readers compare parsed frontmatter values and the frozen v3
navigation against selected immutable material, not today's YAML emitter output.
Quotation, key ordering and CRLF/LF spelling are not logical model changes, but
physical CURRENT_TASK bytes must still match the acknowledged manifest. A new
layout needs a new format reader; never change v3 wording/escaping/fields in place.
The checked-in `test/fixtures/compact-v3/afeec7b.json` is historical wire input,
not a fixture regenerated by the current renderer.


## Read-only task storage metrics (C stage)

`validate --summary` adds `storage_metrics` (`task-storage-metrics/v1`). No new
input, Skill, task fields, confirmation or migration is required. The response is
computed on demand from the canonical task and retained aggregate, not stored in
CURRENT_TASK, an event, or a new metrics log. Repeated reads and no-op retries do
not become transactions. Keep ordinary validation and receipt rules unchanged.
A `partial`/`unavailable` metrics result is diagnostic only, never an instruction
to stop. Existing canonical integrity failures still have their usual behavior.

All units are bytes. Physical sizes are regular-file lengths, not allocated disk
blocks or token counts. Logical sizes are stable-key UTF-8 JSON views. Current and
historical state use the same canonical Runtime defaults before comparison;
storage migration alone does not add logical bytes for omitted legacy fields.
Task Basis references use the canonical section parser, not a separate whitespace
rule; malformed references are unavailable, while an absent link alone counts as zero:

| Field | Exact accounting boundary |
| --- | --- |
| `active_projection_bytes` | Actual CURRENT_TASK bytes, including inline/v2 presentation when present. |
| `definition_bytes` | Existing normalized `task-definition/v2` view, not the tiny immutable root wrapper. |
| `claim_evidence_bytes` | Current claims/checks and evidence values, including reports/decisions. |
| `pending_review_bytes` | Pending review result value; zero when absent/null. |
| `execution_hot_state_bytes` | Normalized Runtime state excluding claims, pending review and the two external-history arrays. |
| `logical_state_bytes` | Entire normalized current Runtime state, excluding execution_log/applied_proposals and inline baseline content. |
| `task_basis_bytes` | Exact linked Task Basis bytes when its revision matches; zero for no link, null when unavailable. |
| `aggregate_total_bytes` | All regular files under this task-data/document_id, including indexes, manifest and orphan/prepared files. No symlinks are followed. |
| `committed_material_bytes` | Distinct object file lengths acknowledged by committed events plus those event file lengths. Deduplicated by SHA; no indexes/manifest/orphans. |
| `external_history_bytes` | Committed objects not selected by the current v3 definition/state roots, plus committed events; null if the legacy current-material closure cannot be established. |

Logical fields overlap: definition includes claim definitions, claim_evidence
includes definitions and evidence state, and logical_state includes claims and
pending review. **Do not add them or add logical counts to physical totals.**
`physical_breakdown` partitions aggregate_total into objects/events/indexes/
manifest/other and reports the file count. Neither total includes separate
review-baseline blobs, task-history packages outside task-data, product files,
.git, or external evidence. Task Basis and CURRENT_TASK are separate counters.

`previous_transaction_delta` identifies the head event (sequence, type, operation,
action when retained, recorded time and both source revisions). It compares that
event's exact logical before/after, not the previous summary invocation. Storage
migration is explicitly labeled; shrinking the physical file is not shrinking the
logical requirement. `committed_material_bytes` in this delta is only the latest
event and objects newly referenced by that event, not all its reused references.
An initial import has no comparable prior event. Unsupported legacy snapshots,
missing old reports or unavailable exact old wire bytes yield null, never a
fabricated zero. Re-rendered historical physical lengths are used only when the
bytes match the retained source SHA. Current filesystem inventories cannot prove
past index/manifest/orphan sizes, so historical `aggregate_total_bytes` delta is
always null; use committed-material growth or separately retained real summaries.

Additional diagnostic work has bounded inventory/event/object/material-read
budgets, exposed in `coverage.limits`; exceeding them returns partial observations
and reasons, not a task-size quota. These bounds do not claim to bound the existing
canonical reader's own integrity/history hydration cost. Observations take no write
lock; the initial manifest/source baseline is checked against the supplied canonical
revision, and rechecked even after partial diagnostic failure. A detected concurrent
head/publication change clears logical/disk counters and deltas and returns
`unavailable`; only the supplied source identity and its raw byte length remain.
This is not an atomic filesystem snapshot.
No history is deleted, no remote telemetry is sent, and no test is run to collect
metrics. Preserve the task-data with real tasks for later longitudinal analysis;
C supplies observation, not a claim that growth has already been optimized.


## Failure-oriented validation selection

This is semantic guidance for prepare-task, read-only review-draft and
review-change, not a Runtime field, new gate, test runner or mandatory test ladder.
Use only the task-relevant branch of the guidance; do not turn it into a new
checklist document or duplicate all acceptance text in CURRENT_TASK.

**Select by detection, then cost.** Start with an authoritative business claim and
one concrete violation grounded in that claim, an existing defect or an identified
changed contract/risk. State what input/state transition would distinguish correct
from wrong behavior, the independently expected result, and the cheapest boundary
where that difference is observable. Only then search/read candidates. Confirm
that the assertion and setup would distinguish them; names, non-empty output,
coverage totals and historical PASS are insufficient. Input may use production
helpers; the expected answer must not be computed by the same potentially defective
logic. Do not create speculative failure obligations simply because they are easy
to imagine.

Reuse an adequate existing check. If it lacks the necessary assertion or setup,
prefer a bounded change to that check under the existing test admission over a
second overlapping check. Create a persistent test only through P-12 when existing
evidence is insufficient. Stop adding checks when each required observation and
identified regression risk has sufficient evidence. One invocation may cover
several observations, but actual reports must still bind the exact slots; neither
merging tests nor multiplying case counts proves efficiency or sufficiency.

**Optimize the whole set, not each check's granularity.** Include independently
authorized user/project/release and contract/risk obligations, not just one claim's
assertion. A focused check does not cancel a separately required package regression
or release run. Prefer a narrower feasible set only when it preserves detection,
required boundaries and all applicable obligations at no greater total cost.
Consider batched selectors before widening a target just to share setup. A combined
invocation needs a concrete comparison that includes unrelated cases, startup/run
cost, maintenance and diagnosis; one startup or convenience alone is insufficient.
Keep exact reports for every supported slot and the existing permitted breadth
basis/source. Describe the comparison in `selection_reason` / `breadth_reason`;
cost advantage is not a new authority enum, blanket waiver, or demand to benchmark
plans during read-only review. Reject unjustified breadth, not a legitimate wider
run merely because a focused selector exists.

**Choose the observation boundary, not the most expensive test.** Local rules and
finite function chains can use focused unit checks or admitted static proof.
Producer/consumer, protocol, process or persistence behavior requires the relevant
real path (for example write → persist → read), not isolated mock PASS results.
One claim may need both a local rule and flow observation; it does not automatically
need both. A backend-only change does not imply browser/device E2E. E2E needs the
existing acceptance/risk/policy/user basis and an explanation of why cheaper
observations are insufficient. Consider setup, runtime, flakiness and diagnosis,
not a universal unit < integration < E2E ranking. Whole targets or suites need the
existing concrete breadth basis; do not run them because they are convenient.

**Match the oracle to the failure.** Apply these examples only when the corresponding
behavior belongs to the claim; they are not additional requirements for every task:

| Failure under consideration | Minimum discriminating observation | Insufficient surrogate |
| --- | --- | --- |
| Retry reads an already known range | Observe the next missing range and monotonic coverage until the expected terminal snapshot; allow contract-required overlap only | Request succeeds or returns non-empty data |
| Windowing still retains full raw history | Observe peak live raw-data residency/lifetime at fixed window size as input grows, separately from legitimate reducer/output state | Each I/O window is small; final output is correct; small fixture fits memory |
| Cancellation/deadline checked only at entry | Change control after entry into the long scan/I/O path; assert bounded further work and the correct terminal result, using deterministic hooks/clock where appropriate | Already-cancelled input or wall-clock sleep alone |
| Incorrect cross-window associations/unstable keys | Ensure the fixture actually straddles a boundary; assert exact ownership and equality across retry/overlap against independent expectations | IDs/keys exist or are non-empty |
| Producer output unusable by consumer | Feed the unmodified public output into the actual consumer and inspect the required persisted/re-read result | Mocked success, hand-rewritten cursor, private payload decoding |

These observations describe semantic sufficiency, not default instrumentation or
an instruction to add one test per row. A temporary probe, existing evidence or
static proof may suffice when admitted; do not turn diagnostics into persistent
tests by default. A memory assertion must name the resource it measures; raw-data
boundedness does not imply constant output size or RSS. A sampled value that cannot
observe the relevant lifetime is not proof of its maximum.

**Review without adding a phase.** review-draft reads/plans; it never executes the
candidate, seeds a mutation or demands final reports. For unwritten tests, require
an intelligible independent oracle and feasible setup, not a fabricated successful
run. review-change checks the actual code, fixture and evidence. A hypothetical
counterexample is reasoning, not a measured failure. Actually running a pre-fix or
fault-injection control can be useful when justified and already authorized, but
is not mandatory Red/TDD, a new prerequisite or a universal mutation-testing duty.
Report only the boundary and observations actually demonstrated. An exit code is
not a substitute for a missing business observation. Strengthening a check must
not rewrite the expected business behavior to match the defect.

Use existing check/report fields for the selected observation, reason and evidence
references. No new per-test ledger, quota, schema, receipt or approval is introduced.
Source-template guards test guidance availability, not model comprehension. A
curated reference answer or deterministic selection fixture is not a fresh Agent
run; broader selection-effectiveness claims require retained independent runs or
real target-project dogfood with the actual Skill/model/version and source context.


## User-authorized evidence-plan amendment

An explicit user decision to reselect sufficient evidence under unchanged Goal,
Acceptance, business boundaries and mutation authority is not a counterexample
and not a replacement task. Use the existing prepare-task Skill with the internal
`prepare-evidence-plan-amendment` command. A missing report/result_id, pending
findings, or a recorded repair result does not require a fabricated challenge,
new business requirement, supersede, or successor.

Preparation takes this closed JSON shape (all IDs and receipts are handled by the
Agent/Runtime, never constructed by the user):

```json
{
  "source_revision": "<exact current source SHA-256>",
  "decision_source": "<original user message coordinate>",
  "decision_text": "<verbatim user selection decision>",
  "reason": "<why the replacement set is minimum-sufficient>",
  "replacements": [{
    "claim_id": "C1", "slot_id": "C1-rule", "replaces_check_id": "old-check",
    "replacement_check": "<complete new execution EvidenceCheck with a fresh check_id>"
  }],
  "command_replacements": [{
    "step_id": "S1", "old_command": "<exact old read-only planned command>",
    "new_commands": ["<exact replacement check entry>"]
  }],
  "unbound_read_only_command_replacements": [{
    "step_id": "S1", "old_command": "<exact planned read-only command with no slot>",
    "new_commands": ["<exact scoped read-only command>"],
    "reason": "<why this unbound planned command needs a scope correction>"
  }]
}
```

`replacement_check` above denotes a JSON object, not a literal string. It retains
method, expected observation/result, subjects, business/required boundaries,
allowed substitutes and validation-label ownership. Selection granularity,
selector and literal invocation may change through normal evidence admission.
For a confirmed legacy check that predates the modern `boundary` and
`selection` fields, Runtime may supply those missing fields during this
amendment. Every obligation that the legacy check actually represented remains
an exact comparison; compatibility does not permit changing its observation,
required boundaries, subjects, result, substitutes or validation ownership.
If a planned read-only invocation was never bound to a claim-evidence slot, use
`unbound_read_only_command_replacements` instead of inventing a replacement slot
or borrowing another slot's authority. The old and new commands must be absent
from every existing slot (and from the new bound replacements), must be exact
active/future planned invocations with `expected_repo_writes: none`, and must be
covered by an explicit per-command reason. This route changes only the planned
read-only scope; it does not create evidence, a waiver, a report, or a new
permission to modify product files. The old failed execution remains immutable
history and the amended command requires fresh execution and review.
Every removed shared invocation must retain all its claim consumers; a command
may split into several bound invocations or merge into an already planned
read-only invocation. Include the affected current and future step invocations
explicitly, including a current-step invocation of a check due at a later step.
Previous step history, independent validation obligations, Persistent Tests admission,
product/test files and write-capable implementation commands are not rewritten.
Do not impose one test function per slot or a fixed test-count target: the unit of
sufficiency is the admitted observation and real boundary, not the number of PASS
results. Excluded acceptance invocations remain available as ordinary regression;
this command does not delete tests or authorize unplanned regression execution.

The result supplies `candidate_path` and `candidate_receipt`; the live task and
Task Basis are unchanged. Read the exact candidate (paged task-read supports
repository-relative paths), explain the old/new selection and any review
invalidation, then stop when the user requested candidate-only preparation.
Confirm the exact candidate through `confirm-evidence-plan-amendment` with
`{candidate_receipt, decision_source, decision_text}` retaining the confirmation
message verbatim. `discard-evidence-plan-amendment` takes `{candidate_receipt}`
and can discard only an uncommitted candidate. Replays are idempotent and genuine
source/workspace/obligation drift is stale; storage-only aliases remain valid.

Confirmation is one journaled task-history/Task Basis/CURRENT_TASK transaction.
Task/document/step identities, requirements, authority, findings, execution
history, review cycle and repair/retry budgets remain owned by the same task.
Changed checks return to missing; old reports and user decisions remain in exact
history, never become replacement-check PASS. Applicable independent evidence
and decisions carry forward through verified history. A pending findings review
is preserved exactly; begin-repair uses fresh preflight and the amended commands.
An old clean review of an affected current-step invocation is explicitly retained
in candidate/history as `historical-revalidation-required`, not silently treated
as approval of the new plan. The task requires fresh execution and review before
completion. Other pending blockers remain in force. Unrecorded in-flight product
execution must first be recorded honestly; amendment does not retroactively
change its receipt or reset a failed budget. Policy/contract/release-mandated
selections and before-step prerequisites require their existing owning authority.

Runtime checks identities, structural preservation, admission and atomicity;
sufficiency and actual execution truth remain caller-reported. Do not route an
ordinary user-authorized selection change to supersede just because there is no
slot report or evidence challenge. This route does not relax replace-validation,
which still permits equivalent invocation engineering only.


Selection-dependent step descriptions may be rebound in the same candidate with
optional `validation_replacements: [{step_id, old_validation, new_validation,
check_ids, reason}]`. `check_ids` are the old IDs included in `replacements`, and
each must have its exact invocation changed in that step. Explicitly owned labels
retain all their owners, including the corresponding replacement check's
`validation_items`; legacy unowned descriptions do not gain waiver ownership.
Only descriptions of the changed selection may be revised, not an independent
behavioral requirement. The Agent must justify that distinction and the user
confirms the exact old/new text. Runtime verifies the structural ownership and
keeps every frozen claim observation/boundary unchanged; semantic sufficiency is
caller-reported, not inferred from label text or a green aggregate command.
