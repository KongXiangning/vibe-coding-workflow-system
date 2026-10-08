---
name: debug-task
description: 'debug-task: carry out the requested work with non-blocking management assistance.'
entry_contract:
  entry: debug-task
  mode:
    - investigate-only
    - resolve
  intent: Assist the user's debug-task request without workflow admission.
  input_contract:
    required:
      - user_request
    optional:
      - existing_plan
      - historical_evidence
      - task_identity
      - admitted_scope
      - evidence_plan
      - test_write_policy
      - persistent_test_admission
      - reproduction_steps
      - investigation_budget
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
    - root-cause-loop
    - owner-route-resolver
    - source-authority-policy
    - scope-guard
    - decision-authority-gate
    - evidence-admission-policy
    - external-documentation-gate
    - review-convergence-policy
  runtime_operations:
    - task-state-transaction
  stop_conditions:
    - a genuinely unresolved user-owned choice prevents the requested work
    - a real business prerequisite is unavailable; management failures do not prohibit independent work
  output_kind: debug-result
---

# vNext Skill: debug-task

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

Investigate the symptom using relevant sources, actual errors and bounded probes.
Record hypotheses separately from confirmed causes; keep contradictory/failed
observations. Use existing tests/evidence first. No attempt quota, legacy state or
missing plan metadata requires repair of the Runtime before investigation.

Investigate-only returns diagnosis/evidence without product mutations. In resolve,
carry out only corrections already authorized by the user, using execution methods
for implementation and truthful result recording. An unresolved external dependency
is a real limitation; a management-service error is not a root cause in the product.
Do not create a permanent test or redesign a task simply to make a debug record fit.
Store a `diagnosis` observation, or return it without writes when requested read-only.

A genuine change from investigation to implementation, a broader correction, or a
material departure from an agreed probe/retry limit uses the shared confirmation rule.
After consent perform only that change. A missing old quota/receipt alone does not
require consent, and consent cannot make an unavailable dependency work.

## Result

If product maintenance is enabled and related updates are already authorized,
use maintain-project references/reconcile.md for new observations and local impact.
Preserve external report versus Agent reproduction, original requirement/history,
actual repair scope and any pending sources. Use the existing task API for actual
task operations. Investigate-only/read-only requests return maintenance locators
without writing. Documentation or association failure never blocks debugging.

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

When retaining evidence, apply WORKFLOW_PROTOCOL's **Fixed evidence references and new
captures** convention: reuse verified immutable material with `evidence_refs`, retain
this run's necessary output with `files`, and never omit distinct runs, failures, user
choices or before/after states because they look similar.
