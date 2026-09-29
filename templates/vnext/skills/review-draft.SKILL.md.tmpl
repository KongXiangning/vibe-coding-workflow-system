---
name: review-draft
description: 'review-draft: carry out the requested work with non-blocking management assistance.'
entry_contract:
  entry: review-draft
  mode: []
  intent: Assist the user's review-draft request without workflow admission.
  input_contract:
    required:
      - user_request
    optional:
      - existing_plan
      - historical_evidence
      - verbatim_request_or_exact_request_source
      - authority_sources
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
    - project-context-resolver
    - source-authority-policy
    - decision-authority-gate
    - scope-guard
    - mutation-authority-policy
    - draft-consistency-challenge
    - evidence-admission-policy
    - read-only-review-guard
  runtime_operations: []
  stop_conditions:
    - a genuinely unresolved user-owned choice prevents the requested work
    - a real business prerequisite is unavailable; management failures do not prohibit independent work
  output_kind: draft-review-result
---

# vNext Skill: review-draft

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

Read the original request, relevant design and the actual draft. Review goal,
acceptance, scope, unresolved decisions, feasibility, cross-step interactions and
validation value. A draft can be reviewed without a canonical Runtime confirmation
receipt, active tuple or current evidence plan. Read the original source when a
summary is insufficient; distinguish unavailable evidence from an invalid design.

Report specific findings and what would resolve them. Keep the user's words
separate from inferred requirements. Do not demand tests/E2E or a full suite simply
because evidence is absent in a draft. Do not implement fixes under a review-only
request. Unless writes are prohibited, use `task` action `review`, stage `draft`, with the
actual task_id and plan_ref, findings and conditions. Read back that exact plan review;
a review never adopts a plan or creates a task implicitly.

Do not turn every draft finding into a confirmation prompt. Report the assessment.
If the user asks to adopt or proceed with a draft despite known unmet commitments,
combine those consequences and apply the shared rule once. Record the decision and
carry out only the authorized stage; retain the findings and the real review verdict.

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

After reviewing a draft, recommend `prepare-task` when material plan changes are
needed. If the reviewed plan is ready but the user has not yet adopted it or
requested implementation, recommend `next_route: prepare-task` for plan
confirmation. Recommend `execute-step` only when the plan is already adopted or
the user's instruction covers implementation. Report the actual findings and
user choices; a clean review is not an admission token or user adoption.

terminal_boundary: public-entry-terminal/v1
