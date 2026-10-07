# Task management API (assistance, never admission)

Use the same installed entry: `node .workflow-system/runtime/support/assistance.mjs task --root <project>`.
Pass JSON on stdin. `task-status` is read-only; `context.management` uses the same live view.
The source-repository entry is `node runtime/vnext/support/assistance.mjs`.
Both assistance.mjs and task-management.mjs must be installed together. No task kernel or npm
package is imported. The service never performs execution, tests, commits, push or deployment.
For git observations its Git-object check is read-only; the task action itself writes
the journal and management views.

## Normal task actions

General fields: `action`, `task_id` or `task_ref`, optional `idempotency_key`, actual
`decision_source`/`decision_text`, and the action fields below. Unknown/unassociated requests
are retained with a partial management result rather than discarded. User-facing Skills fill
known references; users do not need to construct JSON. These are association semantics, not
permission tokens. Raw `record` remains the permissive path for arbitrary evidence.

| action | principal fields | resulting view |
| --- | --- | --- |
| prepare (new) | `plan: {title,goal,acceptance,scope,exclusions,steps:[{id,title,environment,validation}]}` | new stable ID, display number, candidate plan; no focus switch |
| prepare (revision) | existing task_id, plan, base_plan_ref | another candidate in the same task |
| adopt | task_id, plan_ref, review_ref if available, actual decision, optional focus | adopted plan; initializes work position without executing |
| execution | task_id, plan_ref, step_id, source_revision, result, commands | actual recorded work; does not finish/review it |
| test | task/plan/step, command, selector, result, report_ref | related test observation; does not certify an execution |
| review | stage=`draft`, plan_ref OR stage=`change`, execution_ref; verdict, findings, coverage, provenance | assessment of an exact target |
| review-decision | review_ref, choice, actual decision | disposition separate from verdict/findings |
| step | plan_ref, step_id, state=`finished`/`skipped`/`closed`/`in-progress`/`not-started`, decision_ref, remaining_work | work disposition; suggests next unfinished step |
| git (optional) | actual full SHA, execution_refs/plan_ref as available | persist an explicitly requested task/commit association and refresh views; no Git replay |
| close | remaining_work, gaps, actual decision and source links | closed; removed from active focus without setting PASS |
| pause/resume | actual decision and retained context | work lifecycle changes |
| focus | task_id and actual choice | selects work focus, without closing another task |
| dependency | derived task_id, `dependency: {state,summary,evidence_refs}` | explicit prerequisite outcome; independent of lifecycle and review verdict |

Task/step defaults are resolved from the unique current view, not a guessed latest file. New
prepare without task_ref intentionally means a new task. Adopt can infer a plan only when the
selected task has one candidate. It activates a draft; it does not reopen a closed task unless
explicitly requested with resume. Adopting while another task is active retains that task and
does not implicitly switch focus; use focus=true when that switch is actually intended.

Plan and execution references are returned event refs. A later candidate is not adoption;
late execution on a closed task is historical by default. Explicit `historical:true` keeps an
old observation out of current-step execution selection. Work history and review history are
retained across plan revisions; neither is silently recertified for the new plan.

```json
{"action":"prepare","idempotency_key":"new-app-plan-1","plan":{"title":"App integration","goal":"Display retained events","steps":[{"id":"S1","title":"Wire types","environment":["local tests"]},{"id":"S2","title":"First page smoke","environment":["Android device","external host"]}]}}
```

After actual review and user adoption (replace all example refs with real returned values):

```json
{"action":"adopt","task_id":"<returned stable ID>","plan_ref":"<saved plan ref>","review_ref":"<actual draft review ref>","decision_source":"<actual conversation source>","decision_text":"<actual user words>","idempotency_key":"adopt-app-plan-1"}
```

A step can finish with findings or missing review after the appropriate informed choice.
Record the actual gaps; the reducer does not create clean reviews, drop findings, or require
legacy complete-reviewed-step. Confirmation of work disposition is not verification.

Ordinary Git commits require no `task git` call. Verify the actual commit with Git and
report its SHA without appending management records or rebuilding views. An empty `commits`
list means no persisted associations, not that Git has no commits. Use the optional action
only for an explicitly requested persistent association; never recursively commit the
management files it produces just to record that new commit's SHA.

## Derived prerequisite tasks and continuation

A separate prerequisite discovered inside a step retains its own stable task_id and numeric
display_id. Use `prepare` with an explicit `origin`; ordinary repairs and plan revisions stay
in the existing task. The parent remains active with its plan, execution, review, findings,
step dispositions and remaining work intact. No files, steps or reviews are rolled back.

```json
{"action":"prepare","plan":{"title":"Shared contract prerequisite","steps":[{"id":"S1","title":"Repair and verify shared contract"}]},"origin":{"parent_task_ref":"<actual parent task ID or display number>","reason":"Current step needs a shared contract change","handoff":{"child_scope":["shared contract repair"],"parent_remaining_scope":["integration","device validation"]},"return_policy":"auto","resume_context":"Continue integration at the interrupted step; retain unfinished validation."}}
```

`parent_plan_ref` and `parent_step_id` default to the parent's adopted/legacy plan and current
step at preparation; explicit values must identify that active position. The saved origin
uses the stable `parent_task_id`. `reason`, `handoff` and `resume_context` retain actual
business meaning, not invented user words. `return_policy` defaults to `manual`; use `auto`
when the actual selected workflow includes returning to the parent. It authorizes focus
restoration only, never implementation, finish, review, Git or external effects.

Preparation/adoption alone does not imply a switch. When switching from the parent, use
`focus` on the child or `adopt` with `focus:true`. That event captures the actual parent
work position at entry, including work recorded after preparation. This is a management
checkpoint; it does not copy code. Repeated child focus preserves the checkpoint. Entering
from an unrelated task does not manufacture a return address.

```json
{"action":"adopt","task_id":"<child ID>","plan_ref":"<child plan ref>","focus":true,"decision_source":"<actual source>","decision_text":"<actual selection>"}
```

After assessing the actual prerequisite delivery, record its outcome separately or with
closure. `state` is `satisfied`, `unresolved` or `cancelled`. `satisfied` requires a nonempty
actual `summary`; retain evidence refs and any limits. It is an observation, not Runtime
verification or a clean/PASS receipt. Closing with no outcome keeps the dependency unresolved.
An explicit cancellation is not fulfillment. Prior failed/not-run evidence remains visible.

```json
{"action":"close","task_id":"<child ID>","dependency":{"state":"satisfied","summary":"Shared contract repaired; isolated save scenarios verified","evidence_refs":["<actual report ref>"]},"remaining_work":[],"decision_source":"<actual source>"}
```

`dependency` can record the same outcome before or after close. Before close, automatic return
waits. After close, it can complete a pending return if focus still belongs to the retained
child entry. A satisfied outcome recorded before close is reused by a later close.

With auto policy, closure/outcome saves its return effect in the **same immutable event**.
The live view selects the parent only when the parent remains active at the same adopted
plan and step, its captured work has not changed, and focus still belongs to that child
entry. New focus, changed parent work/lifecycle or concurrent choices prevent automatic
return. Child lifecycle and prerequisite outcomes are checked at the causal return boundary:
contradictory concurrent alternatives suppress return until an explicit selection resolves
them. `return_result` follows those lifecycle/dependency choices and the validated saved
effect; it is derived metadata, not a second conflict requiring user selection. Concurrent
agreeing attempts report their effective return even when another attempt observed changed
focus. Selecting an unresolved outcome keeps the return suppressed without inventing a
remaining choice. Agreeing alternatives remain usable. Ordered child changes after a completed return
do not undo its focus; their current gaps still appear in continuation. A later parent action
does not retrospectively erase a return that already occurred.
Exact idempotent replay reuses the first recorded effect; queries/rebuild never append a
second focus action or rerun work. Publication failure is still reported independently;
read live status to verify persistence and focus before claiming completion.

Both operation responses and status/context provide `next_task_id`, `next_step_id`,
`next_route`, `next_mode`, `next_action` for the actual current focus. The affected child can
be closed while these fields point to the parent. Task summaries expose `origin`, dependency
state, `dependencies`, `waiting_on_task_ids`, `return_result` and `continuation`. Waiting is
descriptive, not a lifecycle pause or development gate. `continuation.status=ready` suggests
`execute-step` / `continue-step` at the retained step; it does **not** finish or review it.
Once new parent work changes the checkpoint, normal phase recommendations apply again.
Readiness also considers the current parent's other waiting prerequisites. Manual return
preserves the selected focus but reports `dependency-unresolved` while any of these remain;
an ambiguous originating child lifecycle reports `child-state-unresolved`. Neither gap is
a development gate, and neither creates a ready continuation or clears an existing conflict.

Return outcomes include `returned`, `dependency-unresolved`, `awaiting-close`, `manual`,
`focus-changed`, `no-return-checkpoint`, `parent-changed`, `multiple-dependencies`,
`focus-conflict`, `concurrent-parent-change`, `concurrent-child-change`, `origin-unresolved`
and `invalid-return`.
The last two report damaged/unassociated return interpretations for targeted recovery.
Inspect the parent target and actual gaps
before manually selecting focus; a suggestion is not a completed switch. Manual selection
does not alter the parent plan/step or clear unresolved dependencies. Use focus with
`return_from` (the actual child task ID or display number) to carry its retained continuation
context on a manual return. An unresolved dependency is still reported; changed work uses
the actual phase route instead of a falsely ready continuation.

```json
{"action":"focus","task_id":"<parent ID>","return_from":"<child ID>","decision_source":"<actual manual return choice>"}
```

This version supports one outstanding derived prerequisite per parent task/plan/step, at one level.
An old-plan relation remains historical and does not block derivation or return in a newly
adopted plan merely because it uses the same step ID.
Nested or multiple outstanding proposals are retained with unresolved association and a
concrete explanation; no guessed relationship or implicit scheduling. Historical relations
can be supplemented using `link/correct` on the original prepare record with explicit
`data.origin`; this does not invent a past checkpoint. Explicitly focus from the parent to
establish a new real return checkpoint. Origin is not replaced by same-task plan revision.
Origin step matching uses the same normalization as ordinary plan projection, including
retained null/incomplete step definitions; it does not make the entire view unreadable.

## Read model and publication

`task-status {}`, `context {}` and `task {"action":"status"}` now default to compact
query presentation after the same complete journal rebuild. `context` contains task
data once under `management`. Use `detail=task` with `task_ref` to expand one task,
`detail=step` with an exact `step_id` for its adopted/legacy plan step, or `detail=full`
for the original full CLI response. Existing JS `taskStatus/context/task` exports and
all mutation response shapes remain unchanged. Inputs, paging and selection semantics:
**ASSISTANCE_API.md — Task queries: full computation, on-demand presentation**.

The summary carries task/plan/lifecycle refs, the current step's result and review
state, decision refs, remaining work and advisory next_route/next_mode/next_action.
It does not include full plan or history bodies; read the returned detail_request
before using those contents. `execute-step` with `next_mode: finish` means the
reviewed step still needs a separate work disposition, not automatic finish/closure.
Global issues, unassociated_records and state_completeness remain visible regardless
of selected task or summary page. Unknown association is not evidence that a
plan/decision never existed. A complete summary page is not complete history evidence.

Reads do not write. `projection.cache` and `projection.display` describe persisted freshness;
the returned state itself was recomputed. Cache failure never makes the old cache authoritative.
Normal task writes try publication automatically. Results distinguish:

- recorded/ref: whether the immutable observation was saved;
- association: applied/unresolved/not-evaluated, checked against the effective task view after validation;
- projection: updated/partial/failed, including actual cache/display results.

Report actual partial results. `recorded-pending-view` is not complete management success.
A rebuild failure cannot revoke a decision still visible in the conversation. No business
commands are replayed. Missing or unrecognized links stay visible for targeted supplementation.

CURRENT_TASK is generated from this view with kind `vnext-task-view`; the original legacy file
is snapshotted under records/legacy before replacement. Other task-data/history/blobs remain
untouched. Do not use old raw tuple parsers on the generated display. The compiled CLI routes
ordinary task-context to this live view after rebuilding the distribution; --legacy explicitly
selects the old historical interface. No source patch alone updates an installed old CLI.

## Recover already saved work, without repeating prepare/review/confirm

`task rebuild` republishes view/cache from facts. `overwrite_display:true` is only for an
explicit choice to preserve and replace an edited/unrecognized display. Original bytes are
saved first. Publication captures the actual prior file in records/legacy and installs the new
file only at an absent path. A competing save produces display drift; `preserved_display_ref`
identifies the captured file. That file remains linked in history, so delayed writes through
already-open editor handles survive as well. Inspect both files when resolving display drift.
The capture can also be recovered from records/legacy after an interrupted publication.

A live view writer is not killed. New lock metadata is written before the lock becomes visible.
For an abandoned same-host owner or malformed legacy metadata older than 30 seconds, writers
compete for a deterministic successor lock. The abandoned file remains intact; concurrent
recovery never deletes or renames another writer's lock. Fresh malformed metadata returns
VIEW_BUSY with a timed rebuild suggestion. Other I/O problems are reported and can be deferred.

`task link` supplements the interpretation of an existing record, not its bytes. `task correct`
appends a changed interpretation. Use `record_ref` and `event` containing only the action,
task_id, data and causal parents that are actually established. Omitted fields retain known
source fields. A free-text confirmation is never guessed by keyword or newest timestamp.

Example importing an already saved unnumbered plan (use the real structured plan):

```json
{"action":"link","record_ref":"<existing plan observation>","event":{"action":"prepare","data":{"create":true,"plan":{"title":"Existing adopted plan","steps":[{"id":"S1","title":"Actual first step"}]}}}}
```

This allocates identity/display numbering without another prepare request. Link the existing
review using stage=draft/plan_ref; link the existing confirmation using action=adopt, task_id,
plan_ref, activate=true, focus=true and the real decision source/text. The old record remains
the adopted_by reference; the link record is separate provenance. If only one missing relation
is ambiguous, ask about that relation, not the entire previously completed workflow.

```json
{"action":"link","record_ref":"<existing confirmation>","event":{"action":"adopt","task_id":"<imported task ID>","data":{"plan_ref":"<existing plan observation>","activate":true,"focus":true,"decision_source":"<real source>"}}}
```

Keep causal `parents` from actual references when supplementing history. They describe observed
ordering, not current authorization. Do not use the new link timestamp to turn old work into
a later lifecycle decision. Conflicting causal heads are not silently collapsed.

`task resolve` takes the displayed conflict_id, selected_ref and actual user choice. It selects
one interpretation while retaining alternatives. `task defer` takes issue_ids and the user's
reason; deferred issues remain visible and unresolved. These options are internal tool inputs
filled by the Skill, not IDs the user must type or approval tickets.
To change a selection after it has resolved a conflict, use `task correct` on the saved resolve
record with the new `selected_ref`; the original decision remains in the journal.

```json
{"action":"resolve","conflict_id":"<displayed conflict>","selected_ref":"<one displayed candidate>","decision_text":"<actual choice>"}
```

Correcting a report never alters its original bytes. User acceptance does not turn an absent
Git object into a verified commit. Rebuilding and repeated recording never run git commit.
Source records with invalid digests are isolated as issues, not used to silently override state.

## Storage and compatibility

Task events live beside ordinary observations. task-labels is a small non-overwriting identity
assignment store; task-view.json and task-views are rebuildable views. Legacy baselines and old
displays are retained in records/legacy. These are project data, not distribution assets.
No mandatory migration of all history is required to save the next observation.

Recognized legacy hot fields and explicit simple observation shapes can be grouped automatically.
Arbitrary old YAML, compact encoded task details and natural-language decisions are not promised
automatic semantic conversion: use their exact sources and link the missing interpretation.
Unknown fields and body text remain available via record/read/find. Large-history incremental
projection is not implemented in this version; correctness does not rely on a truncated page.

## Git checkpoints versus task/commit associations

The installed Git checkpoint policy and ASSISTANCE_API's `git-checkpoint` section define
how one git-commit invocation saves existing project-wide facts and recovery material,
excludes rebuildable caches, and verifies actual index/commit bytes. This helper is read-only;
it is not a `task` action and does not append an association. Explicit files-only instructions
and existing project storage exclusions take precedence over the checkpoint default.

Saving records neither requires nor changes task closure, review, findings or unassociated
history. A persistent task/commit association is still an optional separate semantic request.
Do not generate it just because a checkpoint succeeded; never recursively commit its own SHA.
The two existing native modules still suffice; no storage format or causality change is needed.
