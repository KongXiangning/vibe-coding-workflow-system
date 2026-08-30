# Workflow vNext Migration Plan

- Status: Phase 0A / 0B complete; Phase 0C accepted; Phase 1 review/validation shadow and contract sampling active, non-default, and not promoted
- Planning date: 2026-08-30
- Input baseline: [workflow-skill-kmrd-audit.md](workflow-skill-kmrd-audit.md)
- Target architecture proposal: [workflow-vnext-target-architecture.md](../designs/workflow-vnext-target-architecture.md)
- Phase 1 prototype assessment: [workflow-vnext-phase1-prototype-assessment.md](workflow-vnext-phase1-prototype-assessment.md)
- Current runtime/host behavior: unchanged; the source-repo regression chain now includes the additive shadow tests

## 1. Recommendation

Do not rewrite or remove the 37 current Skills yet. Phase 0A / 0B completed the reality audit, capability/compatibility declaration, and 55-case structural baseline. Phase 0C has now confirmed the target architecture, including project-context/knowledge admission and existing-installation/state-schema migration contracts.

Phase 0C must:

1. distinguish user intent entries from historical workflow stages;
2. split daily, administrative, expert/automation, internal, and compatibility exposure;
3. move preparation and review stages into adaptive internal capabilities rather than a new fixed mode chain;
4. define Review Convergence and Evidence Admission before any repair-capable slice;
5. restrict automatic handoff to guarded macro transitions;
6. confirm one Runtime transaction kernel with exact typed operation handlers and no second source of truth.

Phase 1 may now introduce a read-only `review-change` shadow. The Phase 0B manifest remains a migration mapping v1, not the final execution graph. Existing state is not migrated during Phase 1; version-aware readers report migration eligibility while leaving the legacy runtime authoritative.

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
  -> daily / administrative / expert intent entries
  -> adaptive internal governance capabilities
  -> typed semantic proposals
  -> shared transaction kernel with exact typed handlers
  -> existing canonical Markdown/YAML governance sources
```

### 3.1 Exposure-tiered entries

The recommended target surface is:

| Exposure | Candidate entries | Meaning |
|---|---|---|
| Daily public | `prepare-task`, `execute-step`, `review-change`, `debug-task`, `task-lifecycle`, `capture-work-item`, `close-task` | Ordinary user intents |
| Administrative | `bootstrap-project` | Explicit project initialization/adoption intent |
| Expert / CI callable | `validate-change` | Independent read-only evidence request; normal review may invoke it internally |
| Internal / system | `sync-state` | Typed semantic deltas and recovery/reconciliation, not a daily user checklist |
| Compatibility | all 37 legacy names | Current authoritative behavior until evidence-based retirement |

The recommended names, target modes, and exposure tiers were accepted in Phase 0C. Exact Runtime/migration APIs, default promotion, compatibility retirement, and host/registry mechanics remain later decision gates. The Phase 0B exact ten-ID set continues to validate its own migration baseline and must not be mistaken for permanent public exposure.

### 3.2 Internal capabilities

Reusable policy must be referenced once and invoked by capability, not copied into every public Skill. Initial candidates are:

- source-precedence and authority resolver;
- scope and dangerous-operation guard;
- decision-authority classifier;
- diff-target resolver;
- propagation-evidence validator;
- owner and guard-aware route resolver;
- finding admission and deduplication;
- review convergence, fingerprinting, and bounded repair attempts;
- claim ownership, certainty, and evidence/test admission;
- project-context resolution with relevance, precedence, freshness, exact locators, and conflict reporting;
- Contract/Decision/Lesson knowledge admission, deduplication, supersession, applicability, and provenance;
- lifecycle transition guard;
- validation-mode planner;
- design, release, and External Documentation gates.

These are not automatically user-visible Skills or sequential workflow nodes. A capability may remain declarative policy, generated reference material, or Runtime validation depending on whether it requires model judgment. Selection is adaptive from explicit risk/evidence triggers; mandatory authority and scope gates cannot be skipped.

### 3.3 Runtime operations

The Phase 0B operation declarations are:

- `task-state-transaction`;
- `lifecycle-transaction`;
- `inbox-record-transaction`;
- `finding-queue-transaction`;
- `project-status-transaction`;
- `contract-candidate-commit`;
- `decision-record-transaction`;
- `paired-host-guidance-transaction`;
- `lesson-record-transaction`;
- `archive-transaction`.

Runtime should implement these as exact operation handlers behind one shared governance transaction kernel, not ten unrelated frameworks and not one unrestricted document editor. It must consume a typed proposal with evidence, validate the current source tuple and authorization, render and validate before writing, commit atomically, and return an explicit success, no-op, conflict, or blocked result. Each handler keeps its own source/write allowlist, preconditions, and postconditions. Runtime must not create a database or manifest that becomes a second source of project truth.

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
| `exposure` | Distinguish `daily`, `administrative`, `expert`, `internal`, `runtime`, and `compat` | Host sync and registry must not infer visibility from filename or Phase 0B public status |
| `covers_stages` | Let one facade cover multiple existing stage groups | Existing ten-stage coverage remains mechanically provable |
| `intent` | Express what the caller wants rather than which historical stage runs next | Internal preparation/review dimensions cannot masquerade as user intent |
| `modes` | Represent different intent, authority, mutation, terminal, or recovery semantics | Historical Skill identity alone cannot create a target mode |
| `capabilities` | Reference shared governance behavior without copying prose | Mandatory and trigger-selected capabilities must be resolvable and auditable |
| `compat_aliases` | Preserve old invocations and deprecation evidence | Every alias maps to one target and retains old stop conditions |
| `terminal_behavior` | Encode report-only and other terminal routes | Terminal modes cannot emit an executable follow-up handoff |
| `authority_boundary` | State whether model, user, protocol, or Runtime owns a decision | Runtime validation cannot turn an unconfirmed proposal into authority |
| `runtime_operations` | Declare deterministic transactions required by an entry | Operations must have schema, precondition, conflict, and atomicity tests |
| `review_cycle` | Separate discovery, admission, repair, and verification | Same-fingerprint repair is bounded and review breadth does not widen the repair queue |
| `evidence_plan` | Bind claims, owner, certainty, evidence type, and test admission | Unconfirmed guesses cannot become persistent tests or completion evidence |
| `context_bundle` | Select relevant canonical project knowledge for the current intent | Required authority/conflicts cannot be dropped for budget; Lessons remain advisory |
| `knowledge_candidate` | Govern Contract/Decision/Lesson growth | Admission requires authority, stability, evidence, novelty, applicability, and deduplication |
| `installation_state_migration` | Upgrade installed assets and canonical state in place | Dry-run-first, exact ordered versions, target-owned preservation, atomic commit/rollback, no bootstrap/adopt |

The handoff model should evolve from a Skill-name-only graph to guarded macro intent transitions. Internal capabilities and review dimensions do not hand off to one another. During compatibility, legacy and target views must resolve to equivalent authority, stop, diff-target, evidence, and owner-route semantics.

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

The accepted Phase 0C target and the current Phase 1 boundary add `TA-01..TA-34` cases in [workflow-vnext-target-architecture.md](../designs/workflow-vnext-target-architecture.md). `TA-15..TA-20` cover context/knowledge selection and admission; `TA-21..TA-29` cover active/finding/paused/interrupted in-place migration, drift, rollback, replay, missing install metadata, and blocked legacy fallback; `TA-30..TA-34` cover side-effect-audited validation and fail-closed representative sampling.

## 6. Phased migration

### Phase 0A / 0B — Audit, contract, and fixture baseline (complete)

Goal: make the target architecture representable and the non-loss suite executable without changing current public behavior.

Deliverables:

- protocol/schema proposal for exposure, modes, multi-stage coverage, capabilities, Runtime declarations, and aliases;
- compatibility mapping for all 37 names;
- golden fixture manifest covering all 55 audit cases;
- validators for uniqueness, stage coverage, route validity, terminal behavior, alias resolution, and fixture coverage;
- conceptual future registry and host-sync exposure design showing public, internal, Runtime, and compatibility views separately; no host surface changed in Phase 0A / 0B;
- baseline results from the unchanged 37-Skill system.

Exit criteria:

- all current tests remain green;
- all 37 names have one unambiguous compatibility destination;
- all ten current stage groups remain covered;
- no new project-state source exists;
- generated/live freshness and source/target isolation remain unchanged;
- no existing Skill has been retired.

### Phase 0C — Target Architecture Decision (complete)

Goal: decide what the system is being simplified into before implementing a facade.

Deliverables:

- intent-driven exposure matrix;
- target-mode admission rule and compatibility-mode separation;
- mandatory and trigger-selected internal capability model;
- unified review result, Review Convergence, and Evidence Admission semantics;
- relevance-aware project context and bounded knowledge-admission semantics;
- existing-installation/state-schema migration contract covering active, finding, paused, and interrupted state without bootstrap/adopt;
- guarded macro-transition policy;
- shared Runtime transaction-kernel boundary;
- v1 migration projection versus vNext execution-model separation;
- target-shape acceptance cases and explicit user decision register.

Exit criteria:

- internal stages are not target public modes unless they pass the mode-admission rule;
- review and preparation do not recreate fixed internal handoff chains;
- review/repair and test/evidence growth have bounded admission and stop rules;
- exposure, target modes, repair budget, test policy, macro automation, Runtime direction, context/knowledge, and in-place migration requirements receive user confirmation;
- no current runtime or host behavior changes.

The user confirmed these exit decisions on 2026-08-30. Phase 0C is complete.

### Phase 1 — Read-only facade shadow

Introduce `review-change` as a non-default, read-only shadow entry. `validate-change` remains an expert/CI-callable evidence surface that the facade may request internally. The shadow uses `project-context-resolver`, version-aware read adapters, and one explicit diff target, then compares the unified structured verdict/evidence with the existing chain:

Legacy baseline chain used only for shadow comparison:

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

The facade builds one risk/evidence/context profile, selects review dimensions without internal handoffs, applies finding-admission and convergence classification without queue writes, and returns one verdict. It may report a knowledge candidate but cannot persist it. It may detect migration eligibility/blockers but cannot rewrite installed or task state. Exit criteria are zero hard-invariant mismatches, zero governed mutations, zero unexpected workspace diffs, identical terminal behavior for report-only, and equivalent owner/guard routes. Declared cache/build/temp artifacts from validation must be sandboxed or project-approved, audited, and cleaned when permitted. Soft improvements in tokens or turns are recorded but are not sufficient for promotion.

Initial implementation status on 2026-08-30:

- `project-context-resolver` and read-only knowledge-admission classification are implemented with exact locators/revisions, authority precedence, conflict tracing, required-context budget blocking, relevance caps, and lifecycle/install/host auxiliary context;
- `review-change` shadow is implemented with `shadow_only`/advisory routing, canonical task scope/claim/lifecycle/diff checks, Git-backed diff verification when available, finding/convergence classification, install/task/suspended-state readers, and pre/post workspace mutation detection;
- `validate-change` shadow is implemented as a report-only evidence executor: it resolves one exact Project Profile validation-matrix command, binds command/context/diff/claim revisions, rejects shell grammar, executes with `shell: false` in a clean disposable copy, audits both the copy and the live workspace, and always cleans the copy;
- a 12-scenario legacy-versus-shadow runner and matrix are implemented with separate disposable copies, complete hard-governance comparisons, soft cost/wording metrics, legacy-authoritative routing, and explicit scenario/model/harness coverage reporting;
- focused target cases are in `test:workflow-vnext-shadow` and are part of `test:workflow-all`;
- the first source-repo smoke produced a verified Git diff target, a `clean` terminal report-only result, zero governed mutations, zero unexpected workspace diffs, and an `inventory-required` diagnosis for this self-adopted source repo without install metadata.

The local 12-case `contract-fixture` matrix currently passes its structural and hard-semantic assertions, but this is not Phase 1 exit or promotion evidence. Contract fixtures cannot stand in for observed legacy behavior. Phase 1 still needs traceable observed legacy-versus-shadow executions for every declared scenario/model/harness cell, with zero hard mismatch, zero governed mutation, zero unexpected diff, and identical report-only/owner/guard terminal behavior. `TA-26`/`TA-27` are intentionally not simulated in the read-only facade; they remain transaction tests for Phase 1.5.

### Phase 1.5 — Existing-installation and state-migration foundation

Before the first state-changing vNext slice, implement and rehearse the accepted in-place migration contract:

- version-aware install/state inventory and dry-run plan;
- ordered state-schema migrations with target-owned preservation;
- active task and finding migration without completion/attempt reset;
- paused/interrupted package migration without guessed recovery or owner selection;
- checksummed recovery journal, atomic multi-file commit, rollback, and idempotent replay;
- legacy runtime fallback when migration is blocked;
- no bootstrap/adopt requirement for already governed projects.

Phase 1.5 must pass `TA-21..TA-29` before Phase 2 can own task/finding state writes.

### Phase 2 — Execute and finding-admission slice

Add `execute-step`, then place finding admission, review-convergence state, evidence admission, and task-state commits behind typed proposals and exact Runtime handlers. The old implementation and sync names remain aliases. Prove:

- only admitted current-owner mechanical findings can enter repair;
- scope/product/contract/root-cause findings take distinct routes;
- failed validation cannot be beautified into completion;
- replay is idempotent and partial writes are impossible;
- External Documentation and dangerous-operation gates still fail closed.

### Phase 3 — Task preparation and debugging

Introduce intent-driven `prepare-task` and `debug-task`. Task creation/review, scope, classification, planning, decomposition, and review dimensions become adaptive capabilities rather than a fixed mode chain. Preserve their governance semantics and the distinction among report-only investigation, new-bug intake, confirmed root cause, and authorized repair.

### Phase 4 — Lifecycle transactions

Introduce `task-lifecycle` only after lifecycle fixtures cover pause, interrupt, resume, supersede, replan, duplicate packages, incomplete markers, dirty attribution, active-owner conflict, and failure recovery. Runtime owns transition validation and atomic writes; the model owns semantic proposals and recovery interpretation.

### Phase 5 — State synchronization and closure

Introduce `close-task` and internal/system state synchronization. Migrate contracts, decisions, status, host guidance, lessons, findings, task progress, summary, and archive independently behind typed operation handlers. Optional no-op deltas remain auditable; ordinary users do not manually sequence sync categories; closure cannot bypass unresolved acceptance or release evidence.

### Phase 6 — Project bootstrap

Introduce explicit `bootstrap-project` modes for design, greenfield, inventory, adopt, and realign. Do this late because source/target separation, target-owned fact preservation, host pruning, and legacy adoption have a wider blast radius than read-only review.

### Phase 7 — Default promotion and compatibility retirement

Promote a facade only after shadow equivalence is proven. Then update generator, registry, host sync, install, health, documentation, and host guidance as one compatibility-aware change. Retire aliases in small groups; never delete all legacy entries in one task.

## 7. Decision gates

Resolved for Phase 0C:

1. daily / administrative / expert / internal exposure and names;
2. target-mode admission and explicit modes;
3. bounded review-convergence and Evidence Admission policy;
4. guarded macro transitions under authorized end-to-end intent;
5. shared Runtime kernel and canonical Markdown/YAML truth;
6. project-context/knowledge admission and existing-installation/state-schema migration requirements.

Future implementation still stops for user confirmation when choosing:

1. exact Runtime/migration command and API surface;
2. compatibility retirement window and telemetry/evidence source;
3. registry/install/host discoverability mechanics;
4. each facade's default promotion after shadow results are available.

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
- context resolution drops required authority/conflicts for token budget or treats Lessons as higher authority;
- Contract/Decision/Lesson growth bypasses authority, evidence, applicability, or deduplication;
- a mode gains file, decision, lifecycle, or dangerous-operation authority it did not previously have;
- review or report-only mode writes code or governance state;
- the same checkpoint produces different diff targets across review and validation;
- a finding bypasses admission or enters the wrong owner queue;
- lifecycle failure leaves dual active owners, partial markers, or success-shaped output;
- migration requires bootstrap/adopt, resets finding attempts, guesses recovery facts, advances a version marker on partial state, or overwrites target-owned facts;
- generated references become editable inputs or generation becomes non-atomic;
- source-repo install or target-owned asset isolation regresses;
- old and new routes disagree on a hard invariant for any golden fixture;
- cross-host behavior cannot be explained by an explicitly documented capability difference.

## 10. Immediate next boundary

Phase 0C is accepted, and the Phase 1 review/validation shadow plus 12-scenario contract sample harness are implemented. The immediate boundary is to define the supported model/harness/host axes, capture traceable observed legacy executions for every required scenario-axis cell on disposable copies, and resolve every hard mismatch before considering promotion. Contract fixtures and soft efficiency gains remain non-promotion evidence.

Phase 1 must not modify current Skills, the Phase 0B manifest/fixtures, canonical governance/task state, generator, registry, Runtime install/sync behavior, host surface, or aliases. The additive source scripts/tests and test-chain entry do not change those target runtime surfaces. This keeps comparison non-mutating and makes context, stage-graph, finding-admission, convergence, evidence, and legacy-schema drift visible before any state-changing responsibility moves out of the existing Skills.
