# vNext management API — assistance, not admission

```sh
node .workflow-system/runtime/support/assistance.mjs <command> --root <project>
```

Source-repository equivalent: `node runtime/vnext/support/assistance.mjs`.
Input is JSON on stdin. Commands: context, task-status, task, record, snapshot, read, find.
Native modules assistance.mjs and task-management.mjs use Node built-ins, not the old
transaction/qualification kernel. The service never executes product commands or tests.
The task Git observer only reads actual local commit objects; it does not commit or push.

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
