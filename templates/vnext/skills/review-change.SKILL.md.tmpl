---
name: review-change
description: 'review-change: carry out the requested work with non-blocking management assistance.'
entry_contract:
  entry: review-change
  mode:
    - default
    - recheck-completed-step
  intent: Assist the user's review-change request without workflow admission.
  input_contract:
    required:
      - user_request
    optional:
      - existing_plan
      - historical_evidence
      - recorded_step_execution
      - external_counterevidence
      - step_id
  authority_owner: none
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - unrequested external effects
      - unrelated user files
      - silent overwrites of immutable history
  internal_capabilities:
    - project-context-resolver
    - read-only-review-guard
    - diff-target-resolver
    - scope-guard
    - mutation-authority-policy
  runtime_operations:
    - task-state-transaction
    - user-decision-transaction
  stop_conditions:
    - a genuinely unresolved user-owned choice prevents the requested work
    - a real business prerequisite is unavailable; management failures do not prohibit independent work
  output_kind: review-result
---

# vNext Skill: review-change

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

Identify the actual requested diff/version and review the relevant code, call chain,
requirements and available reports. Old snapshots are readable even when the current
files have changed. State which version the review covers and which claims remain
unobserved; selected test PASS is not proof of unrelated business behavior.

Report concrete correctness, security, data, compatibility and evidence problems.
Preserve existing findings and failures. `recheck-completed-step` means reassess the
requested historical/updated target, not enforce a narrow Runtime recheck window.
Store a new review linked to the original; never rewrite the old verdict.

Use `task` action `review`, stage `change`, with the actual task_id, execution_ref,
verdict, findings, coverage and self-review/independent-review provenance. Do not require
review-context or record-review-result to accept the review. A legacy transaction
may be used explicitly for reconciliation, not as a prerequisite to review/report.
Review does not itself authorize code edits or closure. A recommendation alone must
not invoke another public Skill; an explicit combined user request may cover it.

Missing/stale inputs do not require consent to inspect or record review findings.
If the user instead requests narrower coverage, self-review in place of an agreed
independent review, or progression despite findings, apply the shared rule to that
changed action. Execute the chosen disposition and retain the actual coverage,
provenance and unresolved findings; the decision is not a clean verdict.

For an actual user review disposition use `task` action `review-decision` with
review_ref, choice and original decision source/text. Repair/accept/defer/continue
are dispositions, not edits to the review verdict. A chosen finish is a separate
`task step` action; a code correction is actual authorized implementation followed
by a new execution record. Read back the view, not just the saved decision.

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
