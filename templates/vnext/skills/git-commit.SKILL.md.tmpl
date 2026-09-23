---
name: git-commit
description: Create one local Git commit for an explicitly intended change set; do not edit files, rewrite history, or push.
entry_contract:
  entry: git-commit
  mode: []
  intent: Create one local commit containing only the caller-authorized changes.
  input_contract:
    required:
      - repository
      - intended_changes
    optional:
      - preferred_message
      - workflow_result
  authority_owner: user
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - worktree file contents
      - changes outside intended_changes
      - history rewriting
      - branch changes
      - remotes and pushes
  internal_capabilities:
    - dangerous-operation-gate
  runtime_operations: []
  # Candidate interruptions: apply run-entry internal recovery before any terminal result.
  stop_conditions:
    - the repository or intended change set is ambiguous
    - unrelated changes are already staged
    - an intended path is missing or its current diff cannot be inspected
    - the commit fails or cannot be verified
  output_kind: git-commit-result
---

# vNext Skill: git-commit

## Invocation authority and internal recovery

recovery_boundary: entry-recovery/v1

The caller's explicit invocation authorizes this entry's stated intent and its
necessary internal recovery within the existing authority. This entry owns that
recovery until its requested result is produced or a genuinely undecidable choice
requires the caller. A Runtime rejection interrupts a candidate operation; it is
not, by itself, a terminal Skill result, even when listed under stop_conditions.

Read retained state and the rejection, correct stale identity or request shape,
then use typed diagnostic, review-consumption, preflight, retry or amendment
operations as needed and resume the original intent. Calling an internal capability
does not require the user to invoke another public Skill. Do not repeat an unchanged
rejected request. Preserve failed evidence, findings and disposition history.

Attempt and repair quotas are analysis checkpoints. Inspect previous failures,
reassess the cause, necessity and next approach, and record the analysis. When the
existing explicit instruction covers continuation, use its original source/text
for the supported continuation or budget-extension transaction and proceed; do not
ask for renewed authorization merely because a counter is exhausted. Keep the
analysis distinct from the user's words and retain cumulative attempt counts.
Do not invent risk acceptance, a waiver, or permission beyond that instruction.
Ask only for a choice or authority that cannot be determined from the instruction
and available evidence; report the concrete unresolved choice, not just a gate code.

A read-only, review-only or investigate-only entry completes with its requested
facts/verdict; recovery does not authorize unrelated implementation. For actual
unavailable dependencies or damaged state, attempt the supported recovery first,
then report the precise external prerequisite if it cannot be restored internally.
Never fabricate success or bypass an incomplete atomic commit.

### Shared internal recovery driver

Use Runtime `run-entry --root <project>` for Runtime operations in this entry.
Send `invocation` (stable `id`, this public `entry`, requested `intent`, original
`decision_source` and verbatim `decision_text`) and `operation` (`command`,
optional `args`, semantic JSON `input`). Keep this invocation identity throughout
internal recovery. The driver executes existing typed Runtime commands, not public
Skills or product shell commands. Read-only context reads may still be direct.

The driver returns a compact summary and `outcome_ref` / `detail_ref`. Read needed
full receipts with Runtime `entry-output-read`, supplying the returned `reference`,
`offset: 0` and `max_bytes: 8192`; follow `next_offset` until null. A page boundary
is not an execution limit. Do not reconstruct receipts from shortened messages.

An `entry-operation-result/v1` with `recovery-required` is addressed to the agent:
inspect its original `outcome`, code, commit facts and concrete routes, perform
analysis, then submit corrected input or a `recovery` plan with `reason` and
`operations`. The driver stops at the first unresolved operation and returns
`recovery-applied` after successful recovery operations. Read canonical state and
the retained receipts, then resume only an original operation still needed for
this invocation. Never replay an operation reported as committed merely because
its reply was interrupted; reconcile that transaction first.
`operation-complete` means that operation finished, not that this Skill's intent
is complete. Continue until its actual requested result is available.

For ordinary execute-step retry budget exhaustion, supply `budget_analysis` with
`document_id`, `plan_revision`, the proposed `attempt_id` from global-gates, and
`evidence_refs` to retained analysis of failures, necessity and the next approach.
The driver records continuation using the original instruction, increases the
attempt allowance through the existing transaction, and retries the operation
with the resulting decision ID. No renewed user instruction is needed. Other
repair/wave quotas use their typed extension operations in `recovery.operations`.
Evidence and analysis are the agent's responsibility, never invented user speech.

Before returning any blocked result, classify it: an internal operation awaiting
recovery stays in this invocation; an unresolved user choice must state the actual
alternatives; an unavailable external prerequisite must name what internal
recovery could not restore. Completed reports/verdicts remain legitimate outcomes.

## Intent

Create one local Git commit for the exact change set authorized by the caller. Do not modify file contents or manage workflow state.

## Bounded task context protocol

When called for a task result, inspect a fresh `validate --summary` and the
read-only `task-context(entry:"git-commit", mode:"default")` before using the
provided commit scope. Follow required continuation pages and resolve exact
changed-file or review references with `task-read`/`review-read`. A read receipt
does not authorize staging, and a compact/store error is a blocker; do not read
or stage an unbounded CURRENT_TASK history as a workaround.

## Operating rules

1. Inspect Git status and the staged and unstaged diff. When called after `execute-step`, use its commit scope, including the Runtime-written workflow document. If the intended set is unclear or unrelated changes are already staged, stop and ask the user.
2. Stage only the intended paths. Do not edit files, stage unrelated changes, or discard existing work.
3. Derive a concise commit message from the inspected diff unless the caller supplied one, then create exactly one local commit. Never amend, reset, clean, switch or create branches, or push.
4. Verify the new commit hash and committed paths. Report any remaining worktree changes.

## Required result

Return the commit hash, message, committed paths, remaining changes, and `next_route: null`, then stop. This invocation must not invoke another public Skill.

terminal_boundary: public-entry-terminal/v1
