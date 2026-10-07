---
name: task-lifecycle
description: 'task-lifecycle: carry out the requested work with non-blocking management assistance.'
entry_contract:
  entry: task-lifecycle
  mode:
    - pause
    - interrupt
    - resume-paused
    - resume-interrupted
    - supersede
  intent: Assist the user's task-lifecycle request without workflow admission.
  input_contract:
    required:
      - user_request
    optional:
      - existing_plan
      - historical_evidence
      - current_lifecycle_tuple
      - checkpoint
      - dirty_attribution
      - recovery_package
      - recovery_package_path
      - recovery_package_revision
      - rollback_conditions
      - evidence_plan
      - authority_evidence
      - caller_context
  authority_owner: task
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - unrequested external effects
      - unrelated user files
      - silent overwrites of immutable history
  internal_capabilities:
    - project-context-resolver
    - lifecycle-transition-guard
    - task-identity-guard
    - owner-route-resolver
    - resume-review-gate
    - source-authority-policy
    - decision-authority-gate
    - scope-guard
  runtime_operations:
    - lifecycle-transaction
  stop_conditions:
    - a genuinely unresolved user-owned choice prevents the requested work
    - a real business prerequisite is unavailable; management failures do not prohibit independent work
  output_kind: lifecycle-result
---

# vNext Skill: task-lifecycle

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

Read the requested pause, interruption, resumption or replacement and relevant work.
Retain the current plan, actual workspace facts, outstanding work and references.
A lifecycle choice does not require a Runtime-approved transition tuple or a complete
recovery package. Missing context is stated, not invented.

Use `task` action `pause`, `resume`, `focus` or `close` with the real user decision and
links to the previous plan/disposition; read back lifecycle and focus in task-status. Resume
from actual preserved work; do not rerun completed commands because a receipt was lost.
Supersede links the replacement to the retained original without resetting history. Changes
to external resources, deletion or rollback need their own actual authorization. Lifecycle
recording is not a verified-result claim.

For a derived-task switch or manual return, inspect explicit origin, checkpoint, dependency
outcome and return_result. focus/resume never completes the parent step or resolves a
prerequisite. Report actual focus with exact next_task_id/next_step_id; a next_route is only
advice. For an explicitly selected manual return, use focus with return_from set to the
actual child so the view retains continuation context and unresolved dependency limits.
If auto return was suppressed by changed work/focus, retain the reason and current
facts rather than restoring an old plan or overriding a newer choice. Recovery does not
invent past entry checkpoints; a new explicit entry from the parent can capture one.

A requested resume, replacement, reordered step or termination can differ from the
previous workflow. Apply the shared rule to the real changed commitment and unresolved
choice, not the old state tuple. After consent perform the requested lifecycle
management action with retained gaps; do not require restoring active/clean first.

For management recovery, use `task rebuild` for deterministic view repair, `link` for
missing record/task/plan associations, `correct` for an appended correction, `resolve`
for a displayed causal conflict, or `defer` for a user's postponed management issue.
Show the affected records and actual consequences; users need not hand-edit JSON or
assemble IDs. Reuse existing confirmation. Never replay execution, tests, Git commits
or deployments while rebuilding. Preserve modified display content before a specifically
authorized overwrite; defaults must not erase unrecognized user notes.

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

terminal_boundary: public-entry-terminal/v1
