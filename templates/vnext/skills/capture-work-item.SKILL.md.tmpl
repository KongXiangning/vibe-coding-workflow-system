---
name: capture-work-item
description: Record a work item without activating it or requiring workflow admission.
entry_contract:
  entry: capture-work-item
  mode: []
  intent: Retain the requested work item without authorizing implementation.
  input_contract:
    required:
      - user_request
    optional:
      - existing_plan
      - historical_evidence
      - evidence
      - duplicate_check
      - proposed_owner
      - caller_context
  authority_owner: none
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - unrequested external effects
      - unrelated user files
      - silent overwrites of immutable history
  internal_capabilities:
    - record-only-intake-guard
    - owner-route-resolver
    - scope-guard
    - project-context-resolver
  runtime_operations:
    - inbox-record-transaction
  stop_conditions:
    - a genuinely unresolved user-owned choice prevents the requested work
    - a real business prerequisite is unavailable; management failures do not prohibit independent work
  output_kind: capture-result
---

# vNext Skill: capture-work-item

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

Capture the requested item with its original source, desired result, context and
relationship to existing work. Use `record` with kind `work-item`; task identity and
priority can remain unknown. Do not require an active task, an inbox schema migration
or a clean current task. Capturing is not authorization to implement the item.
Return the saved reference and any genuinely missing information.

Record-only intake stays record-only even if the old inbox or active task is invalid.
Do not ask to implement merely because intake succeeded. If the user requests activation
or another stage beyond the intake agreement, resolve any actual scope choice once;
the chosen stage can then proceed without requiring this item to pass a legacy gate.

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
