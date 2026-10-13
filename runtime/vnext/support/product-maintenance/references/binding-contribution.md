# Shared TaskBinding contribution judgment

Use this one method for prepare/actual adoption, existing-project inventory and
rejudgment, local updates, closure, debugging and validation. Read contract.md
section 12 and API.md for versioned fields and persistence. The host reads and
judges business meaning; the helper validates structure, identity, references and
saved bytes. Valid JSON, an existing Task ID or recoverable source does not prove
the judgment. There is no extra model service, per-edge approval or Runtime mode.

## Scope, authorization and separate questions

Locate the actual working copy, stable owner and Task identities, current focus
and any parent continuation. Preserve unrelated edits and frozen boundaries.
Reuse the user's specified requirements, current nearby work or known disputed
relations. If the user requests all existing requirements, inventory and process
recoverable batches until that requested scope is covered; report read, judged,
unread and unsaved scope. A completed first batch is not a whole-project result.
Search by stable IDs, existing bindings, real Task references and WorkItems first.
Titles, directories and keyword search only locate material, never prove a relation.

Separate four questions: current/historical obligations, Task contribution,
scoped delivery, and remaining arrangements. Analysis-only writes no business
documents, reports or Task records. Authorization to correct bindings does not
permit shrinking acceptance, rewriting requirements to match code, changing
Task lifecycle, publishing an Assessment or reordering a Roadmap. Use existing
clear authority without asking again; keep unapproved changes as suggestions.
Explicit deferral or implement-first instructions preserve ordinary work paths.

## Read, then judge each owner-specific relationship

1. Identify the question's owner, obligation and current or historical definition.
   Read its full body, acceptance, exclusions and relevant changes. Read the Task's
   actual adopted goal/scope/exclusions and relevant steps; for historical results
   read actual execution, reports and necessary code. Distinguish an unavailable
   old definition from evidence that it never existed.
2. Choose `direct` only if the Task's adopted work or established activity directly
   addresses a specific owner obligation. Partial direct coverage is valid. State
   that exact part and what remains outside it. An early foundational Task can
   directly cover a later requirement's genuine sub-obligation; age alone is not
   a reason to downgrade it.
3. Otherwise choose `supporting` only for an explicit support mechanism: what the
   work enables, why that owner needs it, and which obligations it does not perform.
   Save an independent binding only if it adds value beyond already declared
   dependencies. Do not materialize supporting bindings along every depends_on edge.
4. If neither is established, do not create a new formal binding. Topic similarity,
   probable usefulness, order or a closed Task is insufficient. Keep an old unknown
   relation unchanged and name missing/conflicting material. Put an unresolved
   question in the existing project/Roadmap only when it affects a current decision;
   do not create an undetermined category or a permanent candidate-edge database.
5. Set `role` for the actual activity in this relationship: implementation, repair,
   verification, exploration or reference. It is independent of contribution.
   Direct verification is verification, not coding; direct exploration may answer
   an explicit research obligation, not certify product capability. New
   reference+direct is unclear: clarify the actual activity or use an ordinary
   SourceRef instead. Existing reference+direct remains readable with a diagnostic;
   do not silently repair it or stop unrelated writes.
6. Explain each new or reclassified binding with concrete coverage, reason and
   nonempty sources actually read. A concise reviewable account is enough:
   obligation → adopted work/result → direct or supporting reason → exclusions and
   unknowns. Do not expose internal reasoning or replace sources with an assertion
   that a model approved the relation.
7. Determine origin separately. declared means explicitly recorded with sufficient
   traceable basis under maintenance authority, not guaranteed correctness or that
   the user dictated the ID. Model authorship alone does not require inferred.
   Existing inferred stays inferred unless actually adopted; adding contribution
   does not adopt it. Genuinely unestablished new relations are not saved as inferred
   active bindings just to avoid a gap. Label user reports and Agent findings honestly.

`direct` during preparation describes proposed coverage and, after actual adoption,
that adopted mapping; it never proves execution. Even adopted/active Tasks need
actual scope-specific execution or step evidence before saying a requirement has
started. If a Task covers A/B but only A's step ran, do not attribute activity to B.
When activity cannot be allocated, say there is an associated active Task and show
its coverage. Failed execution can show an attempt, never delivery. Supporting
work, Task closure and Task counts do not establish downstream implementation or
satisfaction. Assessments use their own current goal/scope/subject and evidence.

## Rejudge existing relationships without rewriting history

Build one scoped comparison from current obligations, relevant historical intent,
real Tasks/results, existing bindings, reports and differences. It can stay in
working context or one aggregate review report; it is not a second live relation
store. Apply the same judgment above, rather than filling every missing enum:

- Established direct/supporting: update the original binding ID and precise coverage,
  reason and sources. Unreviewed neighbors may keep contribution absent.
- Wrong classification: correct the same ID, retain recoverable prior bytes/basis
  and the reason for correction. Do not create a second active row for the same
  owner/Task/role/equivalent coverage merely because contribution differs.
- Demonstrably unrelated: within correction authority use state=dismissed with
  reason and evidence, preserving the actual Task and rejection history.
- Insufficient/conflicting evidence: retain the old values and show pending review;
  absence of classification is neither dismissal nor direct contribution.
- Missed real relationship: add a source-backed binding using the real TaskRef.
  task_id=null remains valid when the historical relationship has evidence but
  stable Task identity is unknown; never manufacture an ID from a display number.
- Valid old obligation, changed current requirement: preserve the historical
  attribution and coverage, then assess current applicability separately. Do not
  claim the old Task had always promised today's larger requirement.
- Previously dismissed relation: read its rejection first. Without genuinely new
  evidence or an explicit current reversal, do not reactivate it under another ID,
  changed contribution or rewritten reason. Preserve each old dismissed row.

Different genuine activities/coverage can have separate bindings, but contribution
is not an identity component. Equivalent-range conflicting classifications remain
conflicts; do not prefer direct or whichever was saved last. Requirement dependencies,
TaskBinding origin/state, Task identity and contribution are separate dimensions.
Do not reopen, prepare, adopt, close, resume, focus or supersede a historical Task
for this maintenance. Do not rerun code/tests, erase failures, or copy old PASS to
new scope. Current review time is not an invented historical execution date.

## Save locally, preserve evidence and read back

Use v5 for contribution, with explicit migrate=v5 for the affected old document;
v1–v4 schemas stay unchanged. Manifest stays v2. v5 inherits v4 planning_baseline,
but unrelated v4 Roadmaps need no migration. Keep mixed versions, IDs and old
unclassified bindings; a file-format migration is not a full-file semantic review.
If the installed writer cannot save v5, report the unsaved change rather than
putting contribution in v4. Follow recovery.md and the existing read-digest guards.

Read the whole old task_bindings array before replacing it. Retain unaffected and
dismissed rows. Preserve necessary old material via existing recoverable sources
or authorized preimage_path/capture_paths and Change/source references; reuse one
snapshot per needed file/batch, not a new file per edge. Reuse actual Task.plan_ref
and step_id plus recoverable definition material with owner item_id where available.
Do not embed the current binding-bearing file's full hash into itself as a permanent
classification certificate. A mutable path alone cannot verify historical meaning.

Requirement/Goal definition algorithms remain unchanged across v3/v4/v5 and exclude
task_bindings. Pure contribution corrections do not change obligation digests,
Task facts or Roadmap arrangements. Precise whole-file source hashes may genuinely
change when binding bytes change: retain changed/unavailable source diagnostics.
Distinguish file bytes, obligation meaning, relation applicability and arrangements.
No exact source/version check certifies the semantic classification. New contrary
execution evidence can require pending_sources or scoped reassessment even when
all requirement hashes are unchanged.

Save and reread each affected file, including its owner, binding ID, contribution,
role, coverage, origin/state, sources and original locators. Inspect plan_tasks when
plan_items was used; reverse output must preserve the actual owner and classification.
Report saved, unchanged, conflicted and not saved separately. If task adoption or
another file already succeeded, retain it and retry only the failed management
write after rereading actual bytes. Never repeat prepare/adopt or business execution
for a binding receipt. Same conclusion with no new evidence produces no timestamp,
new report or snapshot on ordinary read/check/retry. No cross-file transaction is
promised, and no metadata result gates development, commit, close or stopping.

## Delivery, arrangements and review results

Only when requested/already authorized, use reconcile.md for independent
Assessment against current goal-declared scope, subject and evidence. Existing
code or an applicable report can establish scoped achievements without any known
historical Task; do not invent or demand a binding first. Known achievements with
an unchecked remainder are undetermined, not automatically partially-satisfied.
Keep original reports, failed results and new pending counterevidence visible.

Use plan.md only if actual remaining obligations affect an authorized arrangement.
Binding-only correction does not force a Roadmap update, baseline advancement or
new successor Task. A current Roadmap means reviewed materials align, not that
WorkItems are delivered, prerequisites ready or a next Task chosen. Close first,
then do authorized local reconciliation; retain parent continuation and real focus.
Ordinary execution does not trigger a whole-project relation/Roadmap review.

Return the requested/read scope, relation dispositions with sources, independently
known delivery, unknowns, exclusions and unsaved/deferred items. In read-only
review, give exact pending owner/binding/file locators and proposed reasons, with
no business writes or lifecycle changes. Grouped reporting is enough; users do not
need a new rejudgment mode, approval for every edge or two models on every relation.
Schema/fixture success and source-backed finite host trials are distinct evidence;
never claim universal model accuracy or a real-project rollout from synthetic data.
