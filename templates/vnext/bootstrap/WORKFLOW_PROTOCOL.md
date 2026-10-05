---
schema_version: 1
kind: vnext-protocol
---

# vNext: assistance-first workflow

## Governing purpose

Runtime is a management service, not a development admission authority. User
instructions and the selected Skill determine scope and actions. Management
failures, stale evidence, incomplete reviews, legacy states and unfilled slots
must not prevent reading history, retaining new facts or continuing otherwise
authorized work. This protocol supersedes older mandatory workflow gate and
internal-recovery instructions for daily development.

The default API is `.workflow-system/runtime/support/assistance.mjs`. See
`.workflow-system/runtime/support/ASSISTANCE_API.md` for inputs and outputs. Its
native Node modules run without the transaction kernel or npm dependencies.

## Keep facts separate from qualifications

Retain the observation first. Associate it with a task, plan, test and source
revision using the actual available information. Missing associations are gaps,
not fabricated IDs and not a reason to lose a report. Old evidence remains the
record of its original subject. Current applicability can be unknown or stale
without making historical contents unreadable or prohibiting new work.

PASS, clean, resolved and verified are claims supported by evidence, not automatic
consequences of a successful record write or a user decision to continue/close.
Record whose observation it is. Self-review is not independent review.

## Work and tools

No mandatory run-entry, preflight, Runtime-owned active tuple, evidence-plan
migration, waiver, retry budget or review receipt is needed for ordinary work.
An optional snapshot can capture before/after bytes. Existing specialized tools
remain available; their own refusal is a failed service operation, not a workflow
veto. Do not loop through repairs of the control plane before returning to work.

Keep the user's actual authorization, explicit exclusions and external effects
clear. Discovery is not write permission. Ask only when a genuinely unresolved
user-owned choice changes the requested work. Do not invent a new user quote,
permission, risk acceptance or test result.

## One-time confirmation for workflow deviations

This applies to every entry and mode, not only review, approval or closure. When an
old gate would have stopped work, identify its real consequence rather than restoring
the gate. Use the latest applicable user instructions, plan, execution, review and
disposition records; an unsynchronized CURRENT_TASK alone does not prove a missing
review or a new conflict. Superseded workflow rules do not regain authority.

**Continue without confirmation** for record/read/search operations, stale receipts,
missing metadata, index repair and equivalent implementation details already covered
by the request. Preserve gaps and use available authorized tools; neither those
conditions nor an old error code creates a user decision. Never rerun work just to
make a record fit. A real business/I/O failure must still be reported truthfully.

**Ask once before the affected action** when it materially departs from an applicable
workflow commitment and the user has not already made that informed choice. Examples
include finishing without the expected review or checks, proceeding with unresolved
findings, changing planned scope/acceptance/validation, changing execution order or
retry policy, replacing or stopping unfinished work, and replacing independent review
with self-review. These are examples, not a closed list. Do not solicit an unrelated
exception or expand the task merely because one is possible.

State the intended action, expected workflow, actual gap and concrete consequences.
Bundle all currently known deviations for that action into one understandable question;
include the proposed action and a meaningful alternative, not internal gate IDs.
Wait only for that choice: silence is not consent and the proposed action has not
happened. Independent authorized reading/recording remains available. If the user's
current request or still-effective earlier instruction already explicitly covers the
same action and disclosed consequences, use it without asking the same question again.
A bare "complete the task", test PASS or next_route is not informed deviation consent.

After confirmation, carry out exactly the chosen action, including any authorized
remaining stages, without requiring another Skill invocation, a waiver receipt,
clean review, legacy state repair or another approval for the same disclosed gap.
Record the actual outcome, not just the decision. For step/task disposition use the
assistance journal; do not send the choice back through an incompatible legacy
complete/advance/close gate. Completion of work and verification remain separate.
Confirmation never turns failed/not-run/unknown into PASS or self-review into independent
review. It authorizes only the chosen work; file changes, deletion, commit or deployment
outside its disclosed scope remain unauthorized.

Reuse a decision for the same target, action and disclosed consequences, including
across sessions. Check actual relevant changes, not a global revision or time-to-live.
Audit additions, reindexing, equivalent receipt refresh or switching sessions alone do
not invalidate it. Ask again only about material new consequences, a changed target or
action, or a revised/revoked instruction; show what changed. A prior one-step decision
is not blanket permission for later work. Do not invent earlier consent if unavailable.

Keep the user's actual source/text separate from the agent's summary. Use existing
`record` with kind `decision`, plus links from the later outcome; include the target,
choice, disclosed gaps and scope as available. These are recording conventions, not
required token fields or Runtime authorization. A recording failure does not revoke
a choice still available in the conversation: report it and use another authorized
recording method. Never claim the journal or legacy projection was updated when not.

## Derived prerequisite tasks

When an interrupted step needs a separately scoped prerequisite, retain the parent task,
its unfinished step and all work/review facts. Use prepare with explicit origin (parent
task/plan/step, reason, scope handoff, return policy and resume context); an ordinary repair
or same-task revision does not need another identity. Coordinate the adopted parent scope
with the handoff so both plans do not claim the same implementation. Apply the shared
one-time rule only to a still-unresolved material scope/order choice.

Read TASK_MANAGEMENT_API.md for the derived-task fields. A candidate or next_route does
not switch focus. Explicitly focus/adopt the child with focus=true when that is the actual
choice; report actual current task and step after read-back. Entry from the parent captures
the real work checkpoint. Do not finish the interrupted step merely to enable a switch.

Assess the child delivery against the actual prerequisite and record dependency outcome
(satisfied/unresolved/cancelled) separately from close. Closure alone is not fulfillment.
Auto policy restores only focus, under unchanged parent work and child-owned focus; it does
not start work or certify review/tests. Honor an already selected return policy without
asking again. Report suppression reasons, retained gaps and the exact returned position.
Nested/multiple outstanding prerequisites require explicit manual handling in this version.

Always distinguish affected task from actual next_task_id/next_step_id/next_route. On return,
read continuation and original step facts, continue the remaining work within authorization,
and reassess evidence affected by the prerequisite. No automatic finish, old-code restoration,
finding deletion, repeated business execution or assumed PASS.

## Unified task management

Non-blocking does not mean unmanaged. Use assistance `task` actions for task
preparation, adoption, execution, tests, reviews, review disposition, explicit Git associations
and lifecycle. Read `TASK_MANAGEMENT_API.md` for their association fields and recovery.
At every explicit workflow Skill invocation, reread the selected project-local
`SKILL.md` from disk and query the current `task-status` or `context.management`,
even when the same conversation invoked it earlier. Earlier Skill text and route
suggestions are historical context. Report a failed state query truthfully and
continue independent authorized work rather than treating it as a development gate.
A new prepare allocates stable identity and a display number; a revision keeps identity.
Adoption chooses the exact plan, initializes work position and maintains focus.
Review is not adoption; execution is not review; user disposition is not PASS.
A close updates the task view and removes that task from active focus, keeping gaps.

Git's own history is the source for commit facts. An ordinary commit ends with read-only
Git verification and reporting its SHA; it does not require a journal entry or view update.
`task git` is an optional write for an explicitly requested task/commit association, not
an automatic post-commit step. Missing journal commit entries alone justify neither
another commit nor recovery work. Never create a chain of commits recording their own SHA.

Every state question uses `task-status` / `context.management`. They recompute from
the complete retained journal. A generic find page or old CURRENT_TASK is not current
state. Report partial associations instead of concluding an unlinked plan never existed.
CURRENT_TASK is the generated human-readable view; its previous bytes and old task
store remain historical sources. The old task kernel is not a writer of this display.

Normal view maintenance belongs to each task operation. Check fact persistence,
association and projection separately; a saved note is not full task-management
completion. On a deterministic view failure try bounded rebuild, never business replay.
For missing meaning/conflict offer link, correct, resolve or defer; user-facing Skills
explain the actual choices and fill references. Keep the original records/decisions.
Defer preserves known uncertainty; it does not mark it resolved. An existing valid
choice does not need another approval merely because the cache or view changed.
If display content was edited, preserve it and ask only about an actual overwrite.
Read-only status computes in memory and never writes a cache.

This section supersedes older guidance that left current task maintenance optional.
Legacy archive mirrors may remain historical; the current task view must not remain
silently stale. Compiled task-context defaults to this view; --legacy is historical.

## Lifecycle and review

Preparation, execution, review and disposition are distinct observations. New
plans and corrections link previous plans and preserve their history. Lifecycle
changes record user intent without forcing unfinished work to be completed first.
Use One-time confirmation for workflow deviations for unresolved choices before
irreversible or incomplete termination; an already sufficient decision is reused.
Closure neither rolls back code nor grants Git/deployment permission.

By default execute includes implementation self-check, not a fresh formal review.
Creating a review requires an instruction that actually covers it; an explicit
combined request may be completed in one interaction. Report self-review honestly.
A public result always reports one `next_route`: a public Skill ID or `null`,
with a brief reason based on the actual outcome and remaining work. Use `null`
when no public Skill is justified. Complete stages already authorized by the
user before choosing the route. The route is advice, never an exclusive permitted
next action or authorization to perform it.

## Evidence and tests

Keep actual command output, selectors, source version and failed/not-run outcomes.
Reuse useful existing evidence. Select minimum-sufficient validation from the real
changed behavior and the user's limits. No automatic E2E, new permanent test,
full-suite rerun or expanded validation merely to satisfy management metadata.
The project's test-admission-policy remains methodological guidance, not a gate
that must be repaired before facts can be retained.

## Persistence failures

Never claim a failed write succeeded, overwrite unknown history, or silently
restore user files. Return precise I/O errors for the specific service operation.
Preserve output elsewhere when authorized; report unpersisted/unreconciled work.
Continue independent authorized work. A damaged index/projection is not proof
that historical objects or unrelated records are unavailable.

## Existing data and compatibility tools

Existing Task Store, task-data, task-history, evidence blobs, test reports,
knowledge records and document lookup remain available; no task reset or forced
rebootstrap is required. The new append-only journal extends retained management
facts. A preserved old baseline and generated current view replace the obsolete active
display without rewriting old evidence. The journal, labels and views are project data,
never distribution-owned artifacts.

The capability and runtime_operations lists in existing entry metadata and
SOURCE_CONTRACT/RUNTIME_CONTRACT enumerate compatible tools. They are not a list
of admission checks each invocation must pass. Their specialized transactional
requirements describe those optional calls only, not the default development path.
Historical transactional instructions are in support/CONTEXT_API.md.

## Git checkpoint policy

In projects adopting this policy, an ordinary task/stage `git-commit` request
includes the authorized business changes and a project-wide snapshot of existing
persistent management facts. This is not authorization for other tasks' business
code, push, deletion or task closure. Explicit paths-only/staged-only instructions,
exclusions and an already chosen local-only policy take precedence.

The same Skill invocation plans, stages, commits and verifies the checkpoint.
Use assistance `git-checkpoint` for the deterministic inventory and Git checks;
its plan/verification output is temporary data, not new journal facts or approval.
The Skill owns actual Git writes and the scoped policy setup described in
ASSISTANCE_API. Preserve custom policy, frozen files and unrelated staged changes;
combine only genuinely unresolved choices, never ask per generated filename.

Events, evidence objects, attachment manifests, labels and old baselines are saved.
Until a separate safe recovery lifecycle is implemented, also preserve legacy
display/capture bytes as recovery material at each checkpoint; never delete their
original files or infer that a Git commit protects future writes through old handles.
Exclude rebuildable projections, locks and temporary files from default staging.
Untracking a verified generated view retains its local file and must be explicit
in the plan. An edited/unrecognized CURRENT_TASK is not silently hidden.

A failed test, unassociated record or missing historical attachment is a retained
gap, not a reason to demand clean task state before saving available facts.
Verify actual staged/committed record bytes and exact path scope. A mismatch is
not successful persistence; independent authorized business work remains possible.
After the commit, only read Git and report residual/new/excluded records. Do not
write or recursively commit an event recording the checkpoint's own SHA.
