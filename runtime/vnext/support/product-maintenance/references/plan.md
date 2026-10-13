# Implementation Roadmap, next-work selection and actual task bindings

Implementation Roadmap (项目实施路线图) is the public name of the existing plan object;
it is independent of Agent Plan Mode and prepare-task's Task Plan. For a new file suggest
docs/product/IMPLEMENTATION_ROADMAP.md registered in PRODUCT.yaml. Keep legacy PLAN.md,
stable plan/work item IDs and TaskBinding.plan_items. Multiple entries/files retain their
independent scope; select explicitly, never by filename or timestamp.

## First Roadmap and version reconciliation

Existing adopted requirements, designs, historical Tasks and assessments without a Roadmap
are a normal initialization entry. Reuse identities and complete selected bodies; reconcile
actual scoped delivery before arranging remaining work. Do not recreate requirements or old
Tasks. Full 24-requirement and recent six-requirement Roadmaps are both valid; the other 18
remain current and visible. Choose project-current, target-subgraph or explicit-requirements
from actual authorized coverage, retaining unread and unassigned material. A direct Task
request without a Roadmap continues normally.

Save proposed or already authorized adopted work_items, stages and reasoned prerequisites,
leaving future Tasks uncreated. Read back the actual arrangement and current definitions.
v4/v5 read/check with roadmap_query={plan_id,selector} returns snapshot_proposal. This is material
for review, not certification that review occurred. Read Requirement/Goal/Design/Change bodies,
historical scoped delivery and current user decisions; only after actual impact review save
planning_baseline with actual checked_at, working_copy from read, sources, unread_sources and
exceptions. Use API.md and contract.md section 11 for fields and selected-file migrate=v4
when adding a baseline to an older file; an existing v5 plan retains the same baseline
contract and is never downgraded. Contribution does not require migrating a v4 Roadmap.
An old Plan with no baseline needs its first current-scope check, not recreation or retroactive
claims that it always matched. Partial reviewed definitions stay partial and unknown.

Consume a selected Roadmap with roadmap_query={plan_id}, using its saved selector. Report
current, changes-pending, reviewed-deferred or unknown independently from delivery. Membership
and definition comparison discovers new unreferenced requirements and manual changes without
Change. Local explicit selection excludes unrelated additions; subgraphs use only effective
declared composition/support and expose unassigned candidates. Missing reads, source failures,
unknown algorithms or unchecked members stay unknown. Read actual changed bodies before
deciding impact: a hash never decides business order or current completion.

Save localized arrangements and reread before advancing reviewed versions. For wording with
no planning impact, retain work_items and record precise-version no-adjustment reason/source.
For explicit deferral record deferred, risk and the actual decision. Reuse the same-version
choice; new relevant versions need reassessment. Never advance unread/unreviewed snapshots to
dismiss warnings. Requirement, Roadmap and baseline saves and post-save reads are separate
results. Keep successful requirements when Roadmap saves fail, and retry only failed parts.
For partial review, retain the exact old snapshots of unchecked members/context in the same
scope; update only actually reviewed versions. Do not delete old snapshots merely to make
the write pass: they preserve the concrete outstanding differences. retained_snapshots in
write readback identifies these older bases; matched does not claim current alignment.
Even explicit-requirements needs registered identity coverage for a current claim; restricted
reads may hide duplicate selected IDs. Missing identity coverage stays unknown without
expanding the business review beyond the selected requirements or gating direct Task work.

At actual next-business selection, honor current Task and parent continuation first. Consume
the already selected applicable Roadmap, scoped delivery and relevant prerequisites; revisit
future W20-B after 06 even without a Task. W20-A delivery never satisfies full REQ-20. Before
09 distinguish relevant declared prerequisite from mere order, preserve unknowns and risk,
reuse explicit skip/defer choices and prepare only actually authorized work. No missing or
stale Roadmap becomes a Runtime Gate. Do not scan all requirements on every execute-step,
close-task or Git operation.

Read the relevant goals, complete requirement bodies, design constraints, current
arrangements and delivery sources before choosing work. Reuse applicable decisions
and plans. Follow inventory.md for material sufficiency/prerequisite candidates and
reconcile.md for scoped delivery/remaining-work judgments; do not duplicate those
rules or replace the complete requirements with a remaining-work list.

## Three usable strategies, not Runtime modes

For a request to plan the complete current product, first enumerate all known
adopted current capability from the authorized materials, including work intended
for later implementation. Retain parent capabilities and meaningful acceptance;
late implementation alone does not make an agreed requirement planned/candidate.
Only genuine unadopted future ideas or unresolved decisions stay outside current
scope. State unread/conflicting/necessary-unknown material locally. Do not demand
design exploration when the requested behavior and constraints are already clear.

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
  and unknowns; a stage title alone is not an implementation rationale. Coarse
  distant work concerns implementation detail or uncommitted ideas, not omission
  of known adopted current requirement definitions and acceptance.

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

Project requirement_order is independent of plan work_items order and Runtime
steps. Retain its registered relative positions when filtering goals; show
unregistered readable requirements separately. Batch additions append and only
explicit adopted reorder changes existing positions. Dependencies or repair tasks
do not move or duplicate requirement entries. Necessary child/stage goals and
current decomposition/support stay distinct from historical replacement.

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

For every proposed or corrected relationship, use binding-contribution.md's shared
read-then-judge method. During prepare read the actual owner obligation and proposed
Task scope, recommend direct/supporting only with concrete coverage, reason and sources,
and retain locators without adopting optional suggestions. Insufficient evidence means
no new formal binding, not a new unclassified/inferred active relationship. In confirm,
after successful adoption and within authorized maintenance, reread the actually adopted
scope and write the justified v5 TaskBinding for that coverage
in each identifiable related goal/requirement. Reuse explicit user choices to
associate or leave association empty; do not ask again or invent a requirement.
Retain existing draft bindings as historical material without migration; their
presence does not prove adoption. A binding has:
stable binding ID, actual TaskRef, implementation/repair/verification/exploration/
reference role, direct/supporting contribution, precise coverage, reason and actual
sources, declared/inferred basis, optional plan_items
and repairs referencing original historical work. No plan_items is valid without a
plan. One task can serve multiple requirements; one work item may have multiple tasks.
A historical step uses original task_id + step_id, not an invented independent task.
Repair association does not identify the defect's author or restore a retired goal.

Before retry read existing bindings; deduplicate by actual identity, role and
equivalent coverage with Agent judgment. contribution is not an identity distinction.
Correct classification under the existing binding ID and preserve necessary old basis;
retain dismissed relations/reasons and unreviewed old rows. Use explicit migrate=v5 only
for affected binding documents. Old missing classification remains pending; new or
reclassified reference+direct needs clarification, as specified in the shared reference.
If task adoption succeeded but binding conflicted/failed, preserve its returned
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
