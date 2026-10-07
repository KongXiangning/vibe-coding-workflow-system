---
name: prepare-task
description: 'prepare-task: carry out the requested work with non-blocking management assistance.'
entry_contract:
  entry: prepare-task
  mode:
    - default
    - confirm
    - replan
    - amend-scope
  intent: Assist the user's prepare-task request without workflow admission.
  input_contract:
    required:
      - user_request
    optional:
      - existing_plan
      - historical_evidence
      - existing_task
      - relevant_design
      - caller_context
      - operation_receipt
  authority_owner: user
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - unrequested external effects
      - unrelated user files
      - silent overwrites of immutable history
  internal_capabilities:
    - project-context-resolver
    - source-authority-policy
    - scope-guard
    - mutation-authority-policy
    - decision-authority-gate
    - adaptive-depth-policy
    - evidence-admission-policy
    - resume-review-gate
  runtime_operations:
    - task-state-transaction
    - user-decision-transaction
  stop_conditions:
    - a genuinely unresolved user-owned choice prevents the requested work
    - a real business prerequisite is unavailable; management failures do not prohibit independent work
  output_kind: prepared-task
---

# vNext Skill: prepare-task

## Default runtime role

runtime_role: assistance/v1

Follow `.workflow-system/WORKFLOW_PROTOCOL.md` and the management API in
`.workflow-system/runtime/support/ASSISTANCE_API.md`. Use the native service:
`node .workflow-system/runtime/support/assistance.mjs <command> --root <project>`.
Source-repository equivalent: `node runtime/vnext/support/assistance.mjs`.

Use `task-status` (or the `context.management` view) to identify the task, adopted
plan, step, review/disposition and actual commits. It reads the complete journal,
not one search page or the old CURRENT_TASK tuple. `find`/`read` remain evidence tools.
For task lifecycle changes use `task` actions documented in ASSISTANCE_API; raw
`record` is for general observations, not a substitute for task registration.
Normal management updates are part of the requested task operation, not optional
future reconciliation. Check `recorded`, `association` and `projection` separately.
If an association/view update fails, retain facts, try a bounded deterministic rebuild
when appropriate, and present concrete link/correct/resolve/defer choices. Honor the
chosen recovery without repeating business actions or asking again for existing consent.
A read-only request uses live task-status without writing a cache. Never declare
full task-management completion merely because a generic record was saved.

If a management operation fails, preserve its actual error and any output already
saved; use another authorized recording method when available and continue
independent authorized work. Do not retry unchanged calls, rerun business commands,
invent IDs/PASS or claim persistence succeeded. Ask only about a genuinely unresolved
user choice or unavailable business prerequisite, not an internal gate code.

## Workflow deviations

Apply **One-time confirmation for workflow deviations** in WORKFLOW_PROTOCOL for
all materially affected actions, not only approvals. Combine known consequences,
reuse an applicable explicit decision, then execute the user's chosen action without
legacy admission or repeated confirmation. Pure management errors need no consent;
report real gaps without making them PASS. Pause only an unresolved user choice.

## Method

Read `docs/workflow/test-admission-policy.md` when selecting tests; treat it as
methodological guidance, not a requirement to repair Runtime state or create tests.

Read the user's request, relevant requirements/design and existing plan/history.
Use context/find/read or ordinary authorized file tools; a stale or malformed
CURRENT_TASK is not a prerequisite to repair. Describe the goal, acceptance,
scope/exclusions, implementation steps and minimum-sufficient validation.

For a new task, use `task` action `prepare` without task_ref, retaining the returned
stable task_id, display_id and plan ref. Software assigns identity; this is not
inventing a historical ID. For revision/replan pass the existing task_id and a new
plan with base_plan_ref; do not allocate another task for a revision. Preserve the
full goal, acceptance, scope, step definitions, validation and per-step environment.
A candidate is not adopted and must not replace the current work focus by itself.
Unknown raw drafts are retained and linked, not discarded or permanently unnumbered.

For a separately scoped prerequisite discovered in another task's step, use prepare
with explicit origin from TASK_MANAGEMENT_API: parent task/plan/step, reason, child scope,
parent remaining scope, return policy and resume context. Preserve parent identity and
unfinished work; coordinate scope changes so implementation is not assigned twice. Reuse
the actual selected workflow decision. Do not infer a switch from candidate creation or
next_route. In confirm, use focus=true only when the actual instruction selects entry into
the child; otherwise state that focus remains on the parent. The return checkpoint is
captured at real entry, not guessed from the preparation timestamp. Single-layer, single
outstanding prerequisite limits must be reported, with proposals retained for manual handling.

In confirm mode, read the latest candidate plan and applicable draft review. Make the
adopted scope and any review conditions explicit. If the user's current or still-effective
instruction already adopts that plan, use `task` action `adopt` with the actual task_id,
exact plan_ref, review_ref and original decision source/text. Read back
adopted_plan_ref/current_step_id via task-status. Otherwise obtain the unresolved plan
choice before recording adoption. A review verdict alone is not the user's adoption;
do not require the legacy `confirm-draft` transaction or an approval token.

For replan/amend-scope, preserve old definitions/results and describe the real
delta. Evidence selection changes do not require a successor task or fabricated
challenge. Clarify only materially unresolved user choices. Preparing a plan does
not authorize implementation; carry out combined work only when already requested.

Drafting an alternative is not adopting it and needs no deviation approval by itself.
Before adopting a material goal, scope, acceptance, order or validation change, apply
the shared rule unless the instruction already makes that choice. Then use prepare/adopt actions for the
selected plan linked to its predecessor; no successor task or legacy replan receipt
is required. Adoption does not turn old execution evidence into proof of the new plan.

When recovering an already prepared/reviewed/confirmed plan, use `task link` to
interpret the saved records with explicit task/plan associations. Do not ask the user
to repeat prepare, review or confirm. Resolve only genuinely ambiguous mappings.
If another task remains active, explain focus choices and switch only as instructed;
adopting a plan does not silently close the other task.

## Related product documents

When PRODUCT maintenance is enabled and the request selects a project plan work
item, read its actual goal/requirement coverage, exclusions and unresolved matters
before task preparation. Carry that business scope into the task plan; project
plan_id is never Runtime plan_ref. Simple requests still prepare directly without
a project plan. After preparation, preserve returned task_id and original event
ref, and in an already authorized maintenance write phase supplement TaskBinding
in related goal/requirement documents using maintain-project references/plan.md.
If binding fails, retain the successful task and retry only the binding. No new
prepare/focus/adopt/resume/close operation follows from a document association.
Missing/paused PRODUCT, helper or malformed/unlinked material never blocks task
preparation. The existing direct product write boundary remains unchanged; a
read-only request returns pending maintenance locators instead of writing.

## Result

Return the actual requested result, affected scope, evidence/record references,
remaining work and any unsaved/unreconciled data. Preserve existing user decisions
and exclusions; an explicit read-only request remains read-only. A record's successful
write does not certify the product or expand authorization.

Always include `next_route` in the final result: one public Skill ID or `null`,
with a brief reason. Choose it from the actual outcome and remaining work; use
`next_route: null` when no public Skill is justified. Finish any further stages
already covered by the user's instruction before choosing the route. The route is
advice, not permission or the only allowed next action. Do not invoke it solely
because it was recommended or widen validation or external effects without authorization.

For a newly prepared or materially revised plan with no draft review yet, recommend
`next_route: review-draft` by default. Recording a plan alone does not make
`execute-step` the next recommendation. If the draft was already reviewed in the
authorized work or the user clearly chose direct implementation, select the route
from the remaining work. Draft review is advice, not an admission prerequisite.

terminal_boundary: public-entry-terminal/v1
