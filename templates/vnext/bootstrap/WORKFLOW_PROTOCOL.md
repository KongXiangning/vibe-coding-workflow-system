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

## Lifecycle and review

Preparation, execution, review and disposition are distinct observations. New
plans and corrections link previous plans and preserve their history. Lifecycle
changes record user intent without forcing unfinished work to be completed first.
Before irreversible or incomplete termination, show concrete consequences and
obtain the appropriate user confirmation; do not ask again for unchanged internal
receipts. Closure neither rolls back code nor grants Git/deployment permission.

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
