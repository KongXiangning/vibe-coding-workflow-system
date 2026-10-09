# Project planning, next-work selection and actual task bindings

Read the relevant goals, complete requirement bodies, design constraints, current
arrangements and delivery sources before choosing work. Reuse applicable decisions
and plans. Follow inventory.md for material sufficiency/prerequisite candidates and
reconcile.md for scoped delivery/remaining-work judgments; do not duplicate those
rules or replace the complete requirements with a remaining-work list.

## Three usable strategies, not Runtime modes

- Preplanning can arrange all known implementation scope into stable work items,
  order and actual dependencies, while leaving future tasks uncreated. Explain
  where each known part of this planning scope belongs, including deferred work
  and unresolved coverage. The arrangement remains editable.
- Continuous selection needs no overall plan. Read the current relevant scope,
  actual delivery, new feedback and prerequisites, then select the next item or
  nearby few with reasons. It can prepare a real task directly when authorized,
  including in a complex project; do not demand a full plan or rank all work first.
- Hybrid planning retains broad architecture, stages or milestones and details
  nearby work. Distinguish concrete near-term outcomes from coarse distant scope
  and unknowns; a stage title alone is not an implementation rationale.

Respect an existing strategy and switch it for a project phase or business scope
when requested/covered by authorization. Do not ask for a strategy every time or
create required mode/configuration/state fields. A strategy switch does not delete
plans, replace tasks, renumber identities, erase decisions or rewrite history.
Existing applicable plans keep their actual scope and adoption; do not merge them
by modification time or invent a selected plan when the user has not chosen one.

## Shared decision and persistence path

1. State the scope actually read and the relevant current intent, arrangements and
   delivery basis. Read earlier dispositions before revisiting an unresolved issue.
2. Reconcile remaining work, changed scope and unknowns locally. Complete requirements
   remain present, including delivered capability and future/deferred scope. A task
   count, close, association or missing association and old PASS cannot compute
   delivery, completeness or a percentage. Keep unverified scope open.
3. Propose a reasoned next selection or overall arrangement using business value,
   actual prerequisites, risk and user priority. For direct user selection, check
   its relevant scope instead of forcing a comparison of every candidate.
4. Carry out the already authorized decision; separate suggestion, saved arrangement,
   real task preparation and execution. A suggestion does not close a current task
   or authorize starting another. Continuous implementation authorization remains
   usable within its scope; do not demand a fresh approval each round.
5. Save only when requested or already authorized, then read back affected bodies
   and any actual task state. Discussion alone can return advice without writes.

Selection normally fits after task disposition, and may also change during execution
when new information matters. Do not close unfinished work just to select something
else. Read task-status and the existing task rules for any actual lifecycle action.
Do not unconditionally rescan the whole project at every task end or every round.

With an applicable selected plan, maintain the arrangement and unresolved conclusions
there. Without a plan, persist necessary selection, source/basis, read scope and
unresolved matters in the existing project body when no machine-readable order is
needed. When the requested display needs order (for example A, B, C), maintain
existing ordered work_items in an applicable plan, or create a small scoped plan
without requiring an overall project plan. Do not leave promised machine order only
in prose. The Agent chooses this representation without a strategy/field interview. Do not create a second authoritative backlog, copy full requirements
or add speculative task IDs. Keep each current conclusion in one place. If a later
plan takes over a conclusion, retain a historical locator in the project rather than
a second live copy. Known unread sources remain in inventory, not invented documents.

## Plans and actual work

For a plan use targets and stable work_items: expected outcome, coverage/exclusions,
optional stage, declared order or engineering prerequisite with reasons, and unknowns.
Preplanning can include all known work; hybrid can retain coarse distant work. Proposed
is not adopted; the user's actual instruction can adopt a concrete arrangement. It
never adopts Runtime task plans or becomes Runtime plan_ref. No execution status/done
field or duplicated task list belongs in plan/work item metadata.

Refine nearby work, retaining old IDs and order history. Insert added repairs or
verification with sources. Defer/withdraw/reorder as requested. Split/merge preserves
old withdrawn work and replaces destinations; do not renumber unrelated items.
Cycles, unresolved references and withdrawn predecessors remain diagnostics and
original arrangements, not Runtime gates. Task closure does not prove an engineering
prerequisite satisfied. Array order is presentation, not an implicit dependency;
absence of dependencies does not establish safe parallel work. A requirement can be
covered across stages, with no unique completion rank. An old/retired plan need not
reopen for historical repair; bind directly or add work to a relevant maintenance plan.

To prepare selected nearby work, use the existing assistance task API and original
prepare-task method, only within actual user request/authorization. Carry relevant
goal, acceptance, exclusions, work coverage and sources into task scope. Retain returned
real task_id/display_id/event ref; only actual prepare allocates identity. Read task-status
detail=task for existing task/plan/step selection; preserve actual historical refs.
Source-only history uses task_id=null with identity-unconfirmed text, never fake IDs.

After successful prepare write a TaskBinding in each affected goal/requirement:
stable binding ID, actual TaskRef, implementation/repair/verification/exploration/
reference role and precise coverage, declared/inferred basis, optional plan_items
and repairs referencing original historical work. No plan_items is valid without a
plan. One task can serve multiple requirements; one work item may have multiple tasks.
A historical step uses original task_id + step_id, not an invented independent task.
Repair association does not identify the defect's author or restore a retired goal.

Before retry read existing bindings; deduplicate by actual identity, role and
equivalent coverage with Agent judgment. Retain dismissed relations/reasons.
If task creation succeeded but binding conflicted/failed, preserve its returned
identity and only supplement binding; do not prepare again. Binding never focus,
adopt, close, resume or supersede any task. Revise an existing task only when its
own scope truly changes, using existing prepare(task_id, base_plan_ref)/adopt.
Check persistence, association and view separately, and read back both requested
task state and business binding. No maintenance receipt is a preparation prerequisite.

An exploration result ruling out a design may fulfill its exploration objective
without delivering the product requirement. Keep observations, design differences
and affected work. An execution-time independent prerequisite uses the existing
derived-task path and its original limits; those limits are not project-planning
limits. Do not impose exploration on clear work or require all future tasks now.

## Reordering delivered work and selecting what follows

A may already be delivered while B and C remain arranged. An explicit request for
B, A, C changes work_items array order; retain all stable IDs, A's original task
bindings, delivery evidence and dates. It does not reopen A, withdraw its delivery,
or alter task lifecycle. Retain the prior arrangement and decision in a material
plan change; check real prerequisites locally without turning display order into a
gate. Database preparation before regulation import is only the smallest necessary
work justified by actual missing readiness, not automatic infrastructure expansion.

At task end report the affected progress and the already arranged next business
item, or a reasoned suggestion if none was adopted. Keep this prose separate from
public Skill next_route and actual next_task_id/next_step_id. First honor any retained
parent continuation and its real remaining step; a next business suggestion never
replaces that return, creates/focuses a task or authorizes execution by itself.
