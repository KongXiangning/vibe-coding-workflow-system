# vNext management API — assistance, not admission

```sh
node .workflow-system/runtime/support/assistance.mjs <command> --root <project>
```

Source-repository equivalent: `node runtime/vnext/support/assistance.mjs`.
Input is JSON on stdin. Commands: context, task-status, task, record, snapshot, read, find.
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
