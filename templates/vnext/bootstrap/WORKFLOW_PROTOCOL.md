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
native Node module runs without the transaction kernel or dependencies.

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
A public next_route is advice, never an exclusive permitted next action.

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
facts; it does not certify or rewrite the old active state. Its files are project
data, never distribution-owned artifacts.

The capability and runtime_operations lists in existing entry metadata and
SOURCE_CONTRACT/RUNTIME_CONTRACT enumerate compatible tools. They are not a list
of admission checks each invocation must pass. Their specialized transactional
requirements describe those optional calls only, not the default development path.
Historical transactional instructions are in support/CONTEXT_API.md.
