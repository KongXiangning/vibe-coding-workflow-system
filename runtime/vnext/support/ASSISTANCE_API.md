# vNext management API — assistance, not admission

The default daily API is the native Node entry below. It has no dependency on
CURRENT_TASK parsing, task-store qualification, run-entry, preflight, review
receipts, evidence-plan revisions, or the installed transaction kernel.

```sh
node .workflow-system/runtime/support/assistance.mjs <command> --root <project>
```

In this source repository use `node runtime/vnext/support/assistance.mjs` instead.
Input is JSON on stdin. Commands are `context`, `record`, `snapshot`, `read`, `find`.
A read request may use `{}` where applicable. Do not run tests or business commands
again merely to obtain a management receipt. The service never runs them.

## Workflow contract

User instructions and Skill methods determine the work. Runtime records and finds
facts. Missing/stale evidence, an unrecognized task state or an unavailable old
projection is not permission denial. A diagnostic is neither a new instruction
nor an obligation to repair the workflow software. Do not recursively recover the
old admission kernel before returning to development.

Every response contains `development_gate: false` and `qualification: not-evaluated`.
These are NOT permission grants or proof of quality. A real I/O failure returns
`status: unavailable`, `recorded: false` and exit 1, never fabricated success.
Preserve the output through another authorized means and report unsaved state;
continue independent authorized work rather than repeatedly attempting recovery.
Real business dependencies and unresolved user choices remain real limitations.

## Save first, associate later

`record` accepts a JSON observation. `kind`, `task_ref`, `source_revision`, `body`,
`links`, `idempotency_key` and `files` are conventional fields, not an admission
schema. Missing identifiers and unrecognized kinds do not prevent retention.
Malformed JSON submitted to `record` is retained as a raw observation. Do not put
secrets into reports or capture unrelated files.

```json
{
  "kind": "test-run",
  "task_ref": "TASK-016",
  "source_revision": "the-version-actually-tested",
  "idempotency_key": "TASK-016-run-2026-09-29-1",
  "body": {"command": "the authorized selector", "result": "failed", "observation": "actual output"},
  "links": [{"relation": "references", "ref": "a prior report reference"}],
  "files": ["reports/current-test.txt"]
}
```

The raw observation is atomically retained before optional attachment capture.
The result gives `ref`, `sha256`, attachment references and issues. Missing or
changed attachments leave the observation intact. Exact idempotent replay returns
the original reference and never reexecutes or recaptures. A different observation
using the same key is retained separately with `IDEMPOTENCY_CONFLICT_RETAINED` and
an explicit link to the original, not written over it.

Records live in `.workflow-system/records/events`; optional attachment indexes in
`records/attachments`; immutable bodies in `records/evidence-objects`. These are
an append-only management journal, NOT a second task state machine or a shadow
verified-state store. Existing task-data, task-history, task IDs and reports stay
unchanged. Install/upgrade manifests must never own the journal.

Recommended kinds: `plan`, `execution`, `test-plan`, `test-run`, `review`,
`finding`, `decision`, `task-disposition`, `lesson`, `reconciliation`.
New plans/dispositions refer to the old plan/report using `links`; keep the
original requirement and authorization verbatim, separate from agent inference.
Corrections are new records. A closed disposition means the user stopped/finished
the work; it is not automatic verification of the work.

## Fixed evidence, not current-file guesses

`snapshot` captures one explicitly named regular file, using bounded-buffer I/O:

```json
{"path":"reports/test.txt"}
```

`read` accepts a `path` (or the returned `ref`) or a `sha256`.
Relative paths are preferred; in-repository absolute paths and common separators
are normalized. External paths and symbolic paths are not followed by this service. A digest resolves preserved bytes,
first in the journal and then in the existing workflow-home `evidence-objects`.
It never validates those bytes against CURRENT_TASK, a current plan or live code.
`snapshot` with both `path` and `sha256` reuses the fixed historical object when
available; otherwise it only captures the live file if the digest really matches.
It does not relabel new bytes with an old digest.

```json
{"sha256":"<64-character sha256>","workflow_home":"docs/workflow","offset":0,"max_bytes":8192}
```

Read responses contain exact `data` in base64 plus `text_preview`, `next_offset`
and size. Continue with `next_offset`; a page limit is not evidence failure.
The preview can split a UTF-8 character at a byte boundary, so decode base64 for
exact reconstruction. There is no old one-MiB evidence eligibility limit here.
A missing/corrupt old object is reported unavailable, not recreated or guessed.
It does not prevent a new observation from being saved.

Availability, historical truth and applicability to current code are distinct.
An old PASS is still the report of that old run; current applicability remains
unassessed until supported by evidence. Never rerun or waive merely to read it.

## Find plans, runs and existing history

`context` returns source locations and journal navigation without validating the
active projection. `workflow_home` is optional; the conventional scalar profile
hint is read best-effort. For unusual YAML or an ambiguous hint, provide the known
workflow home explicitly. No record write depends on the profile hint.

```json
{"task_ref":"TASK-016","workflow_home":"docs/workflow"}
```

`find` performs literal byte searches over journal records, existing workflow
files/task-data/task-history and TASKS by default. Supply `roots` for a narrower
known location, and `query` for a task ID, command, test name or report text.
It returns paths and byte offsets usable by `read`; it does not require a task
receipt. Queries operate on stored bytes: encoded legacy payloads need to be read
and decoded rather than claimed as searchable decoded content.

```json
{"query":"TASK-016","max_results":20}
```

Use the returned `next_cursor` with the same query for the next batch. `partial`
is successful pagination (exit 0), not a blocker. Cursor position is not an
immutable snapshot; after concurrent additions, a new search may be needed.
Unreadable objects are listed in `issues` without denying access to other history.

The existing file-context/task-context, evidence, test-history, knowledge and
transaction interfaces are preserved. Their detailed reference is now in
`CONTEXT_API.md`. They are optional specialized tools, not required
preconditions to use this API or perform development. If a strict view fails,
read its saved file/object with `read` or use ordinary authorized file tools.

## Default entry outcomes

Prepare records a plan; execute records actual work and selected validation;
review records a real assessment; close records the user's disposition and all
remaining findings/evidence gaps. Read the latest relevant plan/disposition
records alongside the old projection. Do not silently mutate a legacy CURRENT_TASK
or pretend its old gate state is current. Reconciliation can be requested later,
but is never required to keep working.

Read-only user requests stay read-only: return an assessment without even journal
writes when the user explicitly prohibits writes. Default review may record its
report but must not edit product files. A next-route recommendation is not new
authorization; an existing explicit instruction may already cover multiple stages.
