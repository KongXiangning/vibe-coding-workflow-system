# Project plan and actual task bindings

Read actual goal/requirements, adopted/proposed design constraints and an existing
relevant plan before deciding decomposition. Reuse a suitable plan. Small explicit
work can use prepare-task directly with a binding and no persisted project plan.
Material unknowns may justify a bounded exploration/verification task first.

For complex work produce plan.targets and stable work_items: expected outcome,
coverage/exclusions, optional stage, declared order or engineering prerequisite
with reasons, and unknowns. Leave distant tasks uncreated. Plan intent_state
proposed is not adopted; user's actual instruction can adopt a concrete arrangement.
It never adopts Runtime task plans or becomes Runtime plan_ref. No execution
status/done field or duplicated task list belongs in plan/work item metadata.

Refine nearby work, retaining old IDs and order history. Insert added repairs or
verification with sources. Defer/withdraw/reorder as requested. Split/merge preserves
old withdrawn work and replaces destinations; do not renumber unrelated items.
Cycles, unresolved references and withdrawn predecessors remain diagnostics and
original arrangements, not Runtime gates. Close of a predecessor task is not proof
that a declared engineering prerequisite is satisfied. An old/retired plan need not
reopen for historical repair; bind directly or add work to a current maintenance plan.

To prepare selected nearby work, use the existing assistance task API and original
prepare-task method. Carry relevant goal, acceptance, exclusions, work coverage
and sources into task scope. Retain returned real task_id/display_id/event ref;
only actual prepare allocates identity. Read task-status detail=task for existing
task/plan/step selection; preserve actual historical refs. Source-only history uses
task_id=null with identity-unconfirmed text, never fake task or new UUID rules.

After successful prepare write a TaskBinding in each affected goal/requirement:
stable binding ID, actual TaskRef, implementation/repair/verification/exploration/
reference role and precise coverage, declared/inferred basis, optional plan_items
and repairs referencing original historical work. One task can serve multiple
requirements; one work item may have multiple tasks. A historical label for a
step uses original task_id + step_id, not an invented independent task. Repair
association does not prove who introduced the defect, nor restore a retired goal.

Before retry read existing bindings; deduplicate by actual identity, role and
equivalent coverage with Agent judgment. Retain dismissed relations/reasons.
If task creation succeeded but binding conflicted/failed, preserve its returned
identity and only supplement binding; do not prepare again. Binding never focus,
adopt, close, resume or supersede any task. Revise an existing task only when its
own scope truly changes, using existing prepare(task_id, base_plan_ref)/adopt.
Check persistence, association and view separately, and read back both requested
task state and business binding. No maintenance receipt is a preparation prerequisite.

An exploration result that rules out a design may satisfy the exploration objective
while leaving product requirements undelivered. Retain the actual observations,
update proposed/adopted design differences and refine only the affected work.
Do not create future task identities or impose an exploration stage on clear work.
One permission task may implement endpoint checks and supply actor fields for audit;
bind those two exact coverages, leaving audit query/export unresolved. Task count,
close and adopted plan do not compute completion percentages.

For urgent added export ahead of report optimization, preserve stable IDs, origin,
prior order and deferred scope. Customer urgency is an order reason; reliable event
records are an engineering prerequisite requiring real evidence. Array order alone
creates neither dependency nor execution. Existing in-progress task plans are revised
only if their own scope actually changes and the current instruction covers it.
Retiring historical CSV work does not reopen it when repairing current Excel parsing.
