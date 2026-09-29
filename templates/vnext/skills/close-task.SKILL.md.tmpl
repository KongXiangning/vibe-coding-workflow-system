---
name: close-task
description: 'close-task: carry out the requested work with non-blocking management assistance.'
entry_contract:
  entry: close-task
  mode:
    - preview
  intent: Assist the user's close-task request without workflow admission.
  input_contract:
    required:
      - user_request
    optional:
      - existing_plan
      - historical_evidence
      - release_evidence
      - rollback_plan
      - observation_window
      - remaining_risks
      - status_baseline
      - archive_target
      - contract_candidates
      - decision_candidates
      - lesson_candidates
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
    - closure-eligibility-gate
    - task-identity-guard
    - evidence-admission-policy
    - release-evidence-gate
    - knowledge-admission-policy
  runtime_operations:
    - project-status-transaction
    - user-decision-transaction
    - archive-transaction
    - lesson-record-transaction
    - contract-candidate-commit
    - decision-record-transaction
  stop_conditions:
    - a genuinely unresolved user-owned choice prevents the requested work
    - a real business prerequisite is unavailable; management failures do not prohibit independent work
  output_kind: closure-result
---

# vNext Skill: close-task

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

Summarize actual delivered work, tests and evidence, open findings, missing checks,
external effects and remaining risks. `preview` only shows consequences; do not
write or close anything for an explicitly read-only preview.

Read every unfinished step and the actual Git status before closure. A clean
review does not supply a step finish disposition, and a task close does not run
`execute-step` or create a Git commit. If the user chooses to close with a step
still `executed` or with uncommitted changes, retain those facts as remaining
work and report them explicitly; do not imply the skipped actions happened.

For an incomplete/irreversible termination, show concrete consequences and obtain
the user's confirmation; use an already sufficient confirmation rather than asking
for a new internal receipt. The user can stop incomplete, blocked, superseded or
paused work without first completing it, clearing findings or restoring active state.

Use `task` action `close` with the stable task_id, actual decision, remaining_work,
evidence limits and plan/review/result references. Then read task-status: the task
must show closed and must no longer be the active work focus. This is disposition,
not verified completion, and does not authorize rollback, commit, push or deployment.

The service updates the unified view and CURRENT_TASK display while preserving the
old file as a historical snapshot. Report persistence, association and view results
separately. If view publication failed, the saved close remains real; use live status
and offer rebuild/correction/defer rather than claiming every management update finished.
Retain useful lessons as observations; legacy archive mirrors are not the current view.

Apply the shared rule to all closure deviations, not only missing approval. Gather
unfinished steps, failed/not-run checks and open findings into one consequence summary.
Once the user confirms the chosen disposition, close through the task management action without
first making those gaps disappear; preserve them explicitly in the closure report.

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
