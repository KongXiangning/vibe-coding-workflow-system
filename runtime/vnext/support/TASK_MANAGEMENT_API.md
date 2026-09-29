# Task management API (assistance, never admission)

Use the same installed entry: `node .workflow-system/runtime/support/assistance.mjs task --root <project>`.
Pass JSON on stdin. `task-status` is read-only; `context.management` uses the same live view.
The source-repository entry is `node runtime/vnext/support/assistance.mjs`.
Both assistance.mjs and task-management.mjs must be installed together. No task kernel or npm
package is imported. The service never performs execution, tests, commits, push or deployment.
For git observations it only reads local Git commit objects.

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
| git | actual full SHA, execution_refs/plan_ref as available | local commit availability and reported associations; no replay |
| close | remaining_work, gaps, actual decision and source links | closed; removed from active focus without setting PASS |
| pause/resume | actual decision and retained context | work lifecycle changes |
| focus | task_id and actual choice | selects work focus, without closing another task |

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

## Read model and publication

`task-status {}` and `context {}` return the same current_task and task list. Use task_ref to
request selected_task. They scan the entire saved task journal, not a bounded search page.
The response includes adopted_plan_ref, plan/steps/environment, current_step_id, execution,
review status and findings, review decisions, actual commits, remaining work, and advisory
next_route. `state_completeness`, issues and unassociated_records must be reported; unknown
association is not evidence that a plan/decision never existed.

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
