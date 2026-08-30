# Workflow vNext Migration Plan

- Status: proposed; waiting for user confirmation before implementation
- Planning date: 2026-08-30
- Input baseline: [workflow-skill-kmrd-audit.md](workflow-skill-kmrd-audit.md)
- Current behavior: unchanged

## 1. Recommendation

Do not rewrite or remove the 37 current Skills yet. The recommended next implementation task is a contract-first compatibility slice:

1. extend the protocol representation so it can distinguish public entries, internal capabilities, deterministic Runtime operations, and compatibility aliases;
2. materialize the 37 row-level `MR-*` cases and 18 global `GR-*` cases as a golden fixture manifest;
3. keep every current Skill, handoff, generated reference, and host-sync result operational;
4. only after that baseline passes, introduce `review-change` and `validate-change` in shadow mode as the first facade slice.

This order gives the migration a measurable non-loss contract before any responsibility moves. It also prevents a new facade from becoming another layer of prompt duplication.

## 2. Why direct consolidation is unsafe

The current system has assumptions that are wider than the Skill files themselves:

- each Skill has one primary stage, while the proposed public entries cover multiple current stages;
- the protocol requires coverage of all ten stage groups;
- handoffs and owner-aware routes currently resolve concrete Skill names;
- the generator, registry, freshness checks, host sync, install, health, and tests assume one generated Skill artifact per template;
- lifecycle and sync Skills contain transaction semantics that cannot safely become ordinary facade prose;
- target projects may already invoke the old names from host guidance, task records, suspended packages, or human habit.

Therefore, deleting templates first would make compatibility and governance loss hard to distinguish from ordinary migration defects.

## 3. Target layers

```text
User / harness
  -> 10 thin public entries with explicit modes
  -> shared internal governance capabilities
  -> typed semantic proposals
  -> deterministic validators and atomic transactions
  -> existing canonical Markdown/YAML governance sources
```

### 3.1 Public entries

The proposed public surface remains:

1. `bootstrap-project`
2. `prepare-task`
3. `execute-step`
4. `review-change`
5. `validate-change`
6. `debug-task`
7. `task-lifecycle`
8. `capture-work-item`
9. `sync-state`
10. `close-task`

The names and final count are a decision gate, not yet a protocol commitment.

### 3.2 Internal capabilities

Reusable policy must be referenced once and invoked by capability, not copied into every public Skill. Initial candidates are:

- source-precedence and authority resolver;
- scope and dangerous-operation guard;
- decision-authority classifier;
- diff-target resolver;
- propagation-evidence validator;
- owner and guard-aware route resolver;
- finding admission and deduplication;
- lifecycle transition guard;
- validation-mode planner;
- design, release, and External Documentation gates.

These are not automatically user-visible Skills. A capability may remain declarative policy, generated reference material, or Runtime validation depending on whether it requires model judgment.

### 3.3 Runtime operations

The first deterministic operation candidates are:

- `taskStateTransaction`
- `findingAdmission` / `queueTransaction`
- `lifecycleTransaction`
- `archiveTransaction`
- `contractCandidateCommit`
- `decisionRecordTransaction`
- `pairedHostGuidanceTransaction`
- `projectStatusTransaction`

Runtime must consume a typed proposal with evidence, validate the current source tuple and authorization, render and validate before writing, commit atomically, and return an explicit success, no-op, conflict, or blocked result. It must not create a database or manifest that becomes a second source of project truth.

### 3.4 Compatibility layer

Old names remain callable during migration. Each old Skill must resolve to exactly one of:

- a public entry plus explicit mode;
- an internal capability used by a public entry;
- a Runtime operation reached through a semantic proposal;
- a deprecated wrapper that emits a deterministic replacement route.

Compatibility retirement is evidence-based. An alias is removable only after all mapped `MR-*` cases pass, representative `GR-*` paths pass across supported hosts, registry/install/health behavior is proven, and no live route or generated artifact still depends on the old name.

## 4. Protocol representation required before migration

The next task should design and validate the following concepts. Field names below are illustrative and may change during protocol review.

| Concept | Purpose | Required constraint |
|---|---|---|
| `exposure` | Distinguish `public`, `internal`, `runtime`, and `compat` | Host sync and registry must not infer visibility from filename |
| `covers_stages` | Let one facade cover multiple existing stage groups | Existing ten-stage coverage remains mechanically provable |
| `modes` | Give facade modes distinct inputs, writes, stops, and handoffs | A mode cannot inherit broader authority from its facade |
| `capabilities` | Reference shared governance behavior without copying prose | Capability dependencies must be resolvable and acyclic where required |
| `compat_aliases` | Preserve old invocations and deprecation evidence | Every alias maps to one target and retains old stop conditions |
| `terminal_behavior` | Encode report-only and other terminal routes | Terminal modes cannot emit an executable follow-up handoff |
| `authority_boundary` | State whether model, user, protocol, or Runtime owns a decision | Runtime validation cannot turn an unconfirmed proposal into authority |
| `runtime_operations` | Declare deterministic transactions required by an entry | Operations must have schema, precondition, conflict, and atomicity tests |

The handoff model should evolve from a Skill-name-only graph to a public-entry/mode/capability transition graph. During compatibility, both views must resolve to the same canonical transition and owner route.

## 5. Golden regression contract

Create a machine-readable fixture manifest before changing behavior. It must reference every `MR-K01..K05`, `MR-M01..M20`, `MR-R01..R07`, `MR-D01..D05`, and `GR-01..GR-18` case from the audit.

Each fixture records at least:

- fixture ID and governance invariant;
- initial live task/lifecycle/marker state;
- relevant protocol, Profile, Contract, and Decision inputs;
- allowed, conditional, and forbidden mutation surfaces;
- invocation name, public entry, and mode;
- expected owner route, guard result, verdict, writes, handoff, and stop condition;
- expected diff target and evidence set;
- baseline output, shadow output, and equivalence rule;
- supported host/model matrix and any intentionally variable cost/turn metrics.

Hard invariants use exact assertions. Text phrasing, token usage, latency, and turn count are observational metrics and must not weaken semantic assertions.

## 6. Phased migration

### Phase 0 — Contract and fixture baseline (recommended next task)

Goal: make the target architecture representable and the non-loss suite executable without changing current public behavior.

Deliverables:

- protocol/schema proposal for exposure, modes, multi-stage coverage, capabilities, Runtime declarations, and aliases;
- compatibility mapping for all 37 names;
- golden fixture manifest covering all 55 audit cases;
- validators for uniqueness, stage coverage, route validity, terminal behavior, alias resolution, and fixture coverage;
- registry and host-sync design showing public, internal, Runtime, and compatibility views separately;
- baseline results from the unchanged 37-Skill system.

Exit criteria:

- all current tests remain green;
- all 37 names have one unambiguous compatibility destination;
- all ten current stage groups remain covered;
- no new project-state source exists;
- generated/live freshness and source/target isolation remain unchanged;
- no existing Skill has been retired.

### Phase 1 — Read-only facade shadow

Introduce `review-change` and `validate-change` as non-default shadow entries. They reuse one explicit diff target and compare their structured verdict/evidence with the existing chain:

```text
review-current-diff / review-diff / review-implementation / verify-contracts
  -> run-regression
```

Use at least these fixtures:

- a small code change;
- a task with a reviewed checkpoint and clean working tree;
- an in-scope mechanical finding;
- a product/contract/scope finding;
- a DTO or public API propagation change;
- UI work lacking design evidence;
- third-party behavior requiring current documentation;
- report-only pass and report-only failure.

Exit criteria are zero hard-invariant mismatches, zero writes from review, identical terminal behavior for report-only, and equivalent owner/guard routes. Soft improvements in tokens or turns are recorded but are not sufficient for promotion.

### Phase 2 — Execute and finding-admission slice

Add `execute-step`, then place `findingAdmission` and `taskStateTransaction` behind typed proposals. The old implementation and sync names remain aliases. Prove:

- only admitted current-owner mechanical findings can enter repair;
- scope/product/contract/root-cause findings take distinct routes;
- failed validation cannot be beautified into completion;
- replay is idempotent and partial writes are impossible;
- External Documentation and dangerous-operation gates still fail closed.

### Phase 3 — Task preparation and debugging

Introduce `prepare-task` and `debug-task` modes. Preserve the distinction among task creation, task review, scope lock, planning, report-only investigation, new-bug intake, and authorized repair. Adaptive depth may reduce prose but may not bypass authority, scope, design, release, or evidence gates.

### Phase 4 — Lifecycle transactions

Introduce `task-lifecycle` only after lifecycle fixtures cover pause, interrupt, resume, supersede, replan, duplicate packages, incomplete markers, dirty attribution, active-owner conflict, and failure recovery. Runtime owns transition validation and atomic writes; the model owns semantic proposals and recovery interpretation.

### Phase 5 — State synchronization and closure

Introduce `sync-state` and `close-task`. Migrate contracts, decisions, status, host guidance, lessons, findings, task progress, summary, and archive independently behind typed proposals. Optional no-op phases remain auditable; closure cannot bypass unresolved acceptance or release evidence.

### Phase 6 — Project bootstrap

Introduce explicit `bootstrap-project` modes for design, greenfield, inventory, adopt, and realign. Do this late because source/target separation, target-owned fact preservation, host pruning, and legacy adoption have a wider blast radius than read-only review.

### Phase 7 — Default promotion and compatibility retirement

Promote a facade only after shadow equivalence is proven. Then update generator, registry, host sync, install, health, documentation, and host guidance as one compatibility-aware change. Retire aliases in small groups; never delete all legacy entries in one task.

## 7. Decision gates

Implementation stops for user confirmation at these points:

1. approve or revise the proposed ten public entry names and boundaries;
2. choose the compatibility policy and retirement evidence window;
3. approve the Runtime command/API surface and confirm that canonical Markdown/YAML remains the only project truth;
4. approve how host sync exposes public entries, hides internal capabilities, and ships compatibility aliases;
5. approve each facade's default promotion after shadow results are available.

Phase 0 may design alternatives, but it must not silently settle these taste or architecture decisions through implementation convenience.

## 8. Evaluation measures

Hard measures:

- task success and acceptance correctness;
- scope and dangerous-operation violations;
- wrong decision authority or owner route;
- state, lifecycle, marker, and archive drift;
- review/report-only mutation count;
- missing or inconsistent diff targets;
- incomplete governance evidence;
- generated/live freshness and host-isolation failures.

Soft measures:

- prompt and context tokens;
- latency and tool-call count;
- review/fix convergence rounds;
- user interruptions and manual Skill invocations;
- cross-model and cross-harness variance;
- maintenance lines and duplicated policy text.

Hard measures must remain at zero regression. Soft measures determine whether consolidation is worthwhile, not whether governance loss is acceptable.

## 9. Stop conditions

Stop the current migration phase and keep the old route authoritative if any of the following occurs:

- a facade or Runtime projection becomes a second source of truth;
- a mode gains file, decision, lifecycle, or dangerous-operation authority it did not previously have;
- review or report-only mode writes code or governance state;
- the same checkpoint produces different diff targets across review and validation;
- a finding bypasses admission or enters the wrong owner queue;
- lifecycle failure leaves dual active owners, partial markers, or success-shaped output;
- generated references become editable inputs or generation becomes non-atomic;
- source-repo install or target-owned asset isolation regresses;
- old and new routes disagree on a hard invariant for any golden fixture;
- cross-host behavior cannot be explained by an explicitly documented capability difference.

## 10. Immediate next task boundary

The next task should be limited to Phase 0: protocol representation plus golden fixture baseline. It should not implement all ten facades, deterministic write transactions, alias retirement, or host-surface replacement.

Its exact Allowed Files must be locked after the four architecture choices in Section 7 are reviewed. Expected impact candidates are the protocol, schema, generator/registry model, validators, and test fixtures; that list is not authorization to modify them in the current task.

After Phase 0 passes, Phase 1 is the first behavioral vertical slice. This keeps the first comparison read-only, makes semantic drift visible, and provides evidence before any state-changing responsibility is moved out of the existing Skills.
