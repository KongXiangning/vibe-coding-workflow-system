---
name: bootstrap-project
description: Establish or reconcile a governed vNext project surface after Distribution installation without creating feature implementation or an active task.
entry_contract:
  entry: bootstrap-project
  mode:
    - design
    - greenfield
    - inventory
    - adopt
    - realign
    - maintain-domains
  intent: Establish or reconcile a vNext governed project surface after Distribution installation without creating feature implementation or an active task.
  input_contract:
    required:
      - target project root and project identity
      - one bootstrap mode or a project-domain maintenance request
      - explicit changed_paths for every promoted target
      - mutation scope and any exact conditional authorization
      - evidence references for the selected mode
    optional:
      - confirmed design baseline
      - confirmed adoption facts and provenance
      - inventory-derived authority domain candidates
      - explicit project-owner authority-domain confirmation
      - inventory source and host selection
      - caller recovery context
  authority_owner: user
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets:
      - feature implementation and business source files
      - an active task, task identity, or task execution state
      - unconfirmed Contracts, Decisions, or project facts
      - native or user-owned host guidance
      - Distribution-owned Runtime, Protocol, Schema, or Agent Skill assets
      - paths outside the admitted bootstrap asset set
  internal_capabilities:
    - project-context-resolver
    - source-authority-policy
    - design-evidence-gate
    - decision-authority-gate
    - scope-guard
    - propagation-evidence-validator
    - host-isolation-guard
    - generation-atomicity-policy
    - dangerous-operation-gate
  runtime_operations:
    - contract-candidate-commit
    - decision-record-transaction
    - project-status-transaction
    - host-guidance-transaction
  # Candidate interruptions: apply run-entry internal recovery before any terminal result.
  stop_conditions:
    - target identity, mode precondition, or source authority is missing or conflicted
    - the target contains an unsupported legacy schema or an interrupted bootstrap marker
    - a frozen, native, user-owned, or conflicting asset would be replaced
    - changed_paths is missing, duplicated, broader than the planned diff, or not admitted by scope
    - a Conditional target lacks exact evidence references and explicit authority
    - design or adoption facts are inferred but presented as confirmed
    - generation, validation, promotion, or read-back cannot complete atomically
    - the operation would create feature code, an active task, or a second state source
    - a persistent test is proposed without a complete P-12 admission record
  output_kind: bootstrap-result
---

# vNext Skill: bootstrap-project

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

Establish the target project's governed vNext workflow surface through one typed,
auditable bootstrap transaction. This administrative entry preserves distinct
mode preconditions and stop conditions; it is not a daily execution entry and
does not create feature implementation or an active task.

The Node Distribution installer has already installed the project-local
Runtime, Protocol, Schema, and canonical `.agents/skills/<skill-name>/SKILL.md`
Agent Skills. This entry is the separate governance transition: it may
establish project identity and canonical governance facts only after its mode
preconditions and authority evidence pass. Those Distribution assets are
read-only prerequisites here; Bootstrap never generates, promotes, or
receipt-owns them.

The production execution path is target-local. After collecting the user's
mode-specific evidence, use the immutable support surface and Runtime already
installed at `.workflow-system/runtime/`:

```text
node .workflow-system/runtime/dist/cli.js bootstrap-support prepare \\
  --root <project> --mode <mode> [evidence/input flags] --json
```

Review the returned typed plan and its exact `planned_writes`, then provide
that exact list through the existing Bootstrap changed-path protocol and rerun
with `--write`. The support command prepares the typed proposal and the
project-local Runtime commits it; the Skill never edits governance Markdown
directly. This path does not require Bun, the workflow-system source
repository, `WORKFLOW_SYSTEM_ROOT`, or source-side `gen`/`pack`/`sync` commands.

## Operating rules

1. Resolve the target root, project identity, existing workflow assets, host
   surfaces, freeze markers, and source revision before proposing a write. A
   project-local vNext receipt is evidence of a prior transaction, not a second
   authoritative state machine.
2. Admit exactly one mode: `design`, `greenfield`, `inventory`, `adopt`, or
   `realign`. Keep the mode's precondition and terminal result explicit. A
   missing design baseline routes to a design result; an incomplete inventory
   routes to inventory or user confirmation; an unsupported old schema routes
   to the offline migration boundary. Completed migration admission comes from
   the installed read-only Migration Pack provenance verifier, not from the
   presence of either migration marker alone. A migrated governed target does
   not require ordinary Bootstrap, but an explicit `realign` remains allowed.
   The only chained mode transitions are `design` → `greenfield` and
   `inventory` → `adopt`; these are internal mode transitions within this
   single public entry, not invocation of another public Skill. Other valid
   receipts require replay or explicit `realign`.
3. Record confirmed facts with their authority and provenance. Keep inferred or
   unknown facts visible as such. Adoption may not turn an unresolved consumer,
   interface, or ownership conflict into a locked Contract or Decision.
4. Establish mutation authority domains through the project lifecycle: inventory
   proposes bounded `authority_domain_candidates` with evidence; only an
   explicit project-owner confirmation may promote selected IDs/roots into
   `PROJECT_PROFILE.yaml`. A simple project may confirm one broad application
   domain, but do not silently grant it. Preserve an existing confirmed map and
   do not rebuild ownership for each task; `prepare-task` selects the canonical
   map and binds its revision when a v2 task is confirmed.
   New task identities require v2, so finish this project-owned map before
   the first `prepare-task` creation. Existing v1 tasks keep their recorded
   authority model; Bootstrap must not rewrite them.
   `maintain-domains` is the narrow project-owned route for an installed project:
   read `authority-domain-context`, inspect actual directories and ownership,
   obtain the project owner's decision for the exact proposed IDs/roots, then
   use `authority-domain-update` with the observed profile hash and domain-map
   revision. This command initializes a missing map or adds domains/roots to an
   existing map and saves an immutable decision receipt. It does not run
   `realign`, regenerate other governance assets, or grant a task new paths.
   If an active v2 task is affected, use the separate
   `authority-domain-rebind` transaction after inspecting the changed domains;
   newly widened selected domains require a task-specific decision. Continue
   the original maintenance request after exact read-back.
5. Design mode produces design evidence and draft decisions only. Greenfield
   mode consumes a confirmed design baseline. Inventory mode records actual
   paths, consumers, evidence, migration risks, and unknowns without changing
   product files. Adopt mode promotes only confirmed facts. Realign mode may
   touch workflow-owned vNext assets only and must preserve the canonical
   `CURRENT_TASK.md` (including a completed task identity), target facts, user
   documentation, native host assets, and frozen paths. Migration
   `INSTALL_STATE.json` and `MIGRATION_RECEIPT.json` are read-only historical
   provenance; they may coexist with a later Bootstrap Receipt, and realign
   must not update or receipt-own them. An active or invalid task state blocks
   realign.
6. Keep the caller's `changed_paths` as the authoritative proposed diff target.
   Feed the exact paths through the existing mutation scope evaluator. Read or
   discovery context may be broader; it never grants write authority. Forbidden
   paths always block, and every Conditional path requires exact authorization,
   evidence references, and explicit authority.
7. Validate the already-installed Distribution through its existing payload,
   state, checksum, Skill-layout, immutable Bootstrap support, and project-local
   Runtime read-back. Generate governance assets only through the target-local
   Bootstrap support surface. Do not build or promote Runtime, Protocol, Schema,
   or Agent Skills; do not hand-copy files, invoke the legacy generator, or
   write a generic Markdown editor.
8. Before promotion, validate the Distribution prerequisite, governance asset
   checksums, host isolation, canonical `CURRENT_TASK.md`, and the selected
   mode's evidence. Promote the governance asset set atomically, read every
   promoted target back, and record only Bootstrap-owned governance assets in
   the completion receipt. The project-local Runtime owns the typed governance
   transaction and atomic file boundary; the target-local support layer owns
   only immutable preparation support.
9. The bootstrap baseline is a closed, archived administrative baseline. It is
   not an active task and it does not authorize `execute-step`. A later task
   preparation must establish its own confirmed identity and owner through the
   existing daily Runtime path.
10. Replay only when the target identity, mode inputs, receipt, and every
   Bootstrap-managed governance checksum match. Distribution software drift is
   owned by the Distribution lifecycle and must not make Bootstrap provenance
   stale; missing, stale, incomplete, conflicting, or interrupted governance
   state still fails closed.
 11. Validation is evidence, not an automatic request for a persistent test.
    Reuse contract, freshness, runtime, read-back, and health checks first. A
    new persistent test needs a separate P-12 admission with owner, claim,
    insufficiency reason, one closed basis, boundary assertion, and failure
    disposition.

## Required result

Return one structured `bootstrap-result` containing the selected mode, target
classification, project identity, authority/provenance decisions, exact
planned writes, exact changed-path scope verdict, Bootstrap governance
provenance, mode evidence, Distribution and governance read-back evidence,
replay or recovery disposition, and any remaining caller obligation. Do not
report initialization as complete until the governance transaction and all
post-promotion reads succeed;
- at most one `next_route` recommendation, if applicable; it is informational only and must not invoke another public Skill;
- `terminal_boundary: public-entry-terminal/v1`; after this result, return to the caller and stop. The permitted internal Bootstrap mode transitions above are not public Skill chaining.
