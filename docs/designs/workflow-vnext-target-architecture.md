# Workflow vNext Target Architecture

- Phase: `0C — Target Architecture Decision`
- Status: Phase 0C accepted; Phase 1 review/validation shadow and contract sample harness implemented as non-default/advisory and not promoted
- Date: `2026-08-30`
- Behavior impact: `none`
- Phase 1 prototype disposition: exploratory artifacts retained but paused; see [Phase 1 prototype assessment](../product/workflow-vnext-phase1-prototype-assessment.md)
- Evidence baseline:
  - [`workflow-skill-kmrd-audit.md`](../product/workflow-skill-kmrd-audit.md)
  - [`workflow-vnext-migration-plan.md`](../product/workflow-vnext-migration-plan.md)
  - [`.workflow-system/WORKFLOW_CAPABILITIES.yaml`](../../.workflow-system/WORKFLOW_CAPABILITIES.yaml)
  - [`test/fixtures/workflow-capability-cases.yaml`](../../test/fixtures/workflow-capability-cases.yaml)

## 1. Decision objective

Phase 0A and Phase 0B answered two questions:

1. What governance semantics do the current 37 Skills actually carry?
2. Can those semantics be registered and validated without changing current behavior?

They did not settle the final execution architecture. The current capability manifest is therefore a **v1 migration projection**: its detailed modes and handoffs preserve the old Skill graph so that migration loss can be detected. It is not a requirement that vNext execute those modes as a new state machine.

Phase 0C decides the target before any facade implementation begins:

```text
legacy stage-driven Skills
        ↓  Phase 0A / 0B evidence
intent-driven entries
        ↓
adaptive internal governance capabilities
        ↓
typed semantic proposals
        ↓
deterministic Runtime transactions
        ↓
existing canonical Markdown / YAML facts
```

The target is not “37 Skills renamed to 10 Skills”. It is a smaller user intent surface with fewer model-visible workflow nodes and no loss of boundary, authority, state, evidence, stop, or escalation semantics.

## 2. Phase 0C boundaries

This design phase does not:

- change, redirect, merge, or delete any existing Skill;
- change `.workflow-system/WORKFLOW_CAPABILITIES.yaml` schema version 1;
- change templates, generated references, registry, install, pack, health, or host sync;
- implement a facade, Runtime transaction, or new project-state store;
- claim behavioral equivalence between a future facade and the legacy route;
- decide an alias retirement date.

The Phase 0B manifest and 55 fixtures remain frozen migration evidence until a separately reviewed target model is implemented. A future target manifest may use schema version 2 or a separate explicitly related artifact; it must not reinterpret v1 silently.

## 3. Normative architecture principles

### P-01 — Public entry represents intent, not an internal stage

A public entry answers what the user or harness wants to accomplish. `scope-lock`, `classify`, `plan`, `decompose`, `scope-review`, `implementation-review`, and `contract-review` are internal governance dimensions, not target public stages.

### P-02 — A mode requires a semantic boundary

A target mode is admitted only when at least one of these changes:

- user intent;
- decision or mutation authority;
- terminal semantics;
- required input or recovery contract;
- safety or rollback contract.

Historical Skill identity, implementation ordering, output wording, or a desire to preserve an old handoff is not sufficient reason to create a target mode.

Every retained target mode must also declare an independently testable input/output contract, authority owner, mutation/write boundary, stop/terminal behavior, at least one regression case, and a caller-visible reason for existing. If two proposed modes cannot be distinguished by those properties, they are internal dimensions or parameters rather than modes.

### P-03 — Adaptive depth never bypasses mandatory governance

The model or harness may avoid unnecessary planning prose and optional checks, but every mutating task still evaluates source authority, scope, decision authority, evidence admission, and dangerous-operation eligibility. Conditional gates are selected from explicit triggers and their selection is reported.

### P-04 — Internal dimensions do not form a natural-language BPM graph

Internal capabilities may be evaluated together, lazily, or in parallel. They do not hand off to one another as public workflow nodes. Only macro changes in intent, authority, lifecycle, or mutation phase may produce an executable transition.

### P-05 — Review breadth and finding-admission breadth are different

Review may inspect the full risk surface. A discovered issue enters repair only after owner, scope, authority, evidence strength, deduplication, and convergence checks pass.

### P-06 — Model proposes; Runtime commits

The model and user own semantic judgment and authority. Runtime owns deterministic validation, exact write boundaries, conflict detection, idempotence, atomic commit, and read-back. Runtime cannot promote an unconfirmed proposal into project truth.

### P-07 — Canonical governance documents remain the only project truth

`CURRENT_TASK.md`, `CONTRACTS.md`, `DECISIONS.md`, `STATUS.md`, `LESSONS.md`, task artifacts, Profile, Protocol, and Schema retain their existing authority. Machine-readable objects are ephemeral projections or typed proposals unless a future protocol change explicitly places a field inside an existing canonical source.

### P-08 — Compatibility is a separate projection

The 37 legacy names remain resolvable during migration. Compatibility modes may stay detailed enough to describe the old graph, but those modes do not determine the final public surface.

### P-09 — Project knowledge is selected by relevance and admitted by evidence

The system does not load all accumulated governance knowledge into every task and does not persist every observation. `project-context-resolver` selects relevant canonical context with source locators, precedence, freshness, and conflicts. `knowledge-admission-policy` admits, merges, supersedes, defers, or rejects candidates for `CONTRACTS`, `DECISIONS`, and `LESSONS` based on authority, stability, novelty, reuse value, and evidence.

### P-10 — Existing installations migrate in place

A project that already uses workflow-system upgrades through an explicit installation/state-schema migration contract. Active tasks, findings, paused packages, and interrupted packages retain identity, ownership, evidence, attempts, and recovery semantics. Migration does not require bootstrap/adopt, does not overwrite target-owned facts, and cannot treat missing legacy data as a fresh or completed state.

## 4. Recommended exposure model

The recommended surface distinguishes discoverability from callability. The exact count is not a KPI.

### 4.1 Daily public entries

| Entry | User intent | Explicit target modes | Important boundary |
|---|---|---|---|
| `prepare-task` | Turn a request or existing task into an executable, bounded intent | `replan`; ordinary preparation is the default entry intent | Review, scope, classification, planning, and decomposition are adaptive internal dimensions |
| `execute-step` | Implement the admitted current step | `repair`; ordinary implementation is the default entry intent | `repair` requires an admitted finding or confirmed root cause; governance state writes use Runtime proposals |
| `review-change` | Produce one unified read-only verdict for one diff target | `report-only`; ordinary review is the default entry intent | `discovery` and `verification` are review-cycle phases, not public modes |
| `debug-task` | Establish root cause and select an authorized recovery route | `investigate-only`, `resolve` | Debug does not write product code; `resolve` may macro-route to `execute-step:repair` after proof and authority |
| `task-lifecycle` | Perform an explicit ownership/lifecycle transition | `pause`, `interrupt`, `resume-paused`, `resume-interrupted`, `supersede` | Each mode has distinct source tuple, recovery evidence, mutation, and rollback semantics |
| `capture-work-item` | Record work proven unrelated to the active task | none | Remains record-only and cannot promote, switch, or mutate the active task |
| `close-task` | Prove closure eligibility and finish the task | `preview`; ordinary closure is the default entry intent | Summary, state deltas, and archive are one closure intent; `preview` is terminal and non-mutating |

### 4.2 Administrative entry

| Entry | Intended caller | Recommended target modes | Boundary |
|---|---|---|---|
| `bootstrap-project` | Project owner or setup automation | `design`, `greenfield`, `inventory`, `adopt`, `realign` | These modes remain legitimate because they have different project preconditions, write authority, and stop conditions |

### 4.3 Expert and automation entry

| Entry | Intended caller | Target shape | Boundary |
|---|---|---|---|
| `validate-change` | CI, harness, expert user, or an internal evidence request | One read-only entry with an evidence request; QA type is selected by evidence policy rather than public stage modes | It is callable but need not be promoted as a normal daily Skill; it never owns the whole protocol/project validation model |

### 4.4 Internal system service

| Entry | Intended caller | Target shape | Boundary |
|---|---|---|---|
| `sync-state` | `prepare-task`, `review-change`, `close-task`, recovery tooling, or diagnostics | Typed semantic deltas routed to Runtime operation handlers | It is not a normal daily Skill. A manual reconciliation surface may exist for recovery, but ordinary users should not sequence sync subcommands |

### 4.5 Compatibility surface

All 37 current names remain compatibility entries until evidence-based retirement. They may be installed and callable during migration even when their target successor is daily, administrative, expert, or internal.

## 5. Mode admission decisions

### 5.1 Modes retained by the target proposal

- `prepare-task:replan` changes the authority and history contract of an already prepared task.
- `execute-step:repair` requires an admitted finding or confirmed root cause and consumes a repair budget.
- `review-change:report-only` changes terminal semantics and forbids executable follow-up.
- `debug-task:investigate-only` and `debug-task:resolve` express different user intent and follow-up authority; neither lets the debug entry edit product code directly.
- lifecycle modes retain different source tuples and recovery contracts.
- `close-task:preview` changes mutation and terminal semantics.
- bootstrap modes retain distinct project preconditions and mutation boundaries.

Ordinary preparation, implementation, review, capture, validation, and closure are default entry intents, not named modes. Result labels such as `ready`, `change-ready`, and `root-cause-confirmed` are states, not modes.

### 5.2 Historical modes moved to internal capabilities

| Phase 0B compatibility mode | Target destination |
|---|---|
| `prepare-task:create` | `prepare-task` intent plus active-owner/task-identity evaluation |
| `prepare-task:review` | task-readiness and resume-review capabilities |
| `prepare-task:scope-lock` | `scope-guard` |
| `prepare-task:classify` | `decision-authority-gate` |
| `prepare-task:plan` | adaptive planning dimension |
| `prepare-task:decompose` | step-shape constraint selected by adaptive depth |
| `prepare-task:orchestrate` | removed from target execution model; compatibility-only route |
| `execute-step:orchestrate` | removed from target execution model; macro route policy owns readiness |
| `execute-step:implement` | default `execute-step` intent |
| `review-change:scope` | mandatory review dimension |
| `review-change:implementation` | mandatory or risk-scaled correctness dimension |
| `review-change:contract` | conditional contract-impact dimension |
| `validate-change:regression` | expert evidence request selected by evidence policy |
| `debug-task:orchestrate` | removed from target execution model |
| `debug-task:repair` | `execute-step:repair` after confirmed root cause |
| `task-lifecycle:replan` | `prepare-task:replan` |
| all `sync-state:*` modes | typed Runtime operation kinds |
| `close-task:close` | default `close-task` intent |
| `close-task:summary` / `archive` | internal closure capabilities and Runtime proposal handlers |

The v1 validator may continue requiring the old exact mode set because it validates migration coverage. A future v2 validator must validate this target mode admission policy instead of preserving the old stage graph.

## 6. Adaptive capability selection

### 6.1 Mandatory evaluations

These evaluations always occur for a mutating task, though a low-risk case may resolve them with minimal evidence:

| Capability | Required output |
|---|---|
| source authority | authoritative sources read, conflicts, and unresolved facts |
| project context | relevant Contracts, Decisions, Lessons, Profile, task state, and exact source locators; excluded or conflicted knowledge remains visible in the resolution trace |
| task identity / active owner | current owner tuple and whether this request may mutate it |
| scope | allowed change surface and any widening requirement |
| decision authority | mechanical / taste / user-owned decisions and unresolved blockers |
| evidence admission | claims being proved, their owners/certainty, and sufficient evidence |
| dangerous-operation eligibility | detected dangerous surface, authorization, rollback/recovery, or not-applicable reason |
| adaptive depth | selected risk profile, triggered conditional capabilities, and skipped-capability reasons |

### 6.2 Conditional capabilities

| Trigger | Capability set |
|---|---|
| shared/API/DTO/event/schema/generated surface | propagation evidence and compatibility strategy |
| UI or visual acceptance | design evidence and visual validation |
| deployment, migration, release, benchmark, or canary | release evidence and rollback/observation gates |
| current third-party behavior affects correctness | External Documentation Gate |
| lifecycle or suspended recovery | lifecycle transition and resume review gates |
| protected source/target or host assets | generation atomicity and host isolation |
| failing or unexplained behavior | root-cause policy |
| review after a repair | review-convergence verification policy |
| closure request | closure eligibility and remaining-risk preservation |
| candidate durable contract / decision / lesson | knowledge admission, deduplication, merge/supersede, applicability, and provenance |
| installed-version or state-schema mismatch | installation/state inventory and migration preflight; no task execution through an unknown schema |

### 6.3 Risk profiles are evidence budgets, not workflow stages

The target may use profiles such as `minimal`, `standard`, and `guarded` to select evidence depth. They must not become fixed step chains.

- `minimal`: localized documentation or mechanical change with no shared contract, lifecycle, UI, release, external behavior, or dangerous surface.
- `standard`: bounded implementation with ordinary regression risk and a confirmed acceptance owner.
- `guarded`: cross-module, contract, lifecycle, UI, release, security, destructive, external-current-behavior, or high-uncertainty work.

The selected profile and trigger evidence are part of the structured result. A model may increase depth when evidence warrants it; it may not downgrade a mechanically triggered guard.

## 7. Unified review architecture

`review-change` consumes one explicit diff target and produces one verdict. It does not expose its dimensions as a handoff chain.

### 7.1 Review input

```yaml
review_request:
  diff_target: <task-base-or-reviewed-checkpoint-to-current-head>
  cycle_phase: discovery | verification
  acceptance_claims: [<claim-id>]
  admitted_fingerprints: [<finding-fingerprint>]
  change_risk_profile: minimal | standard | guarded
  execution_policy: normal | report-only
```

### 7.2 Review dimensions

Always evaluated:

- diff-target validity;
- scope and mutation boundary;
- goal/acceptance fit;
- correctness and regression risk;
- evidence sufficiency.

Conditionally evaluated:

- contract and propagation;
- lifecycle and asynchronous state;
- design and visual evidence;
- release, rollback, canary, and performance;
- current external documentation;
- source/target, host, generated, or destructive-operation boundaries.

### 7.3 Unified result

```yaml
review_result:
  cycle_id: <stable-id>
  cycle_phase: discovery | verification
  diff_target: <same-logical-target>
  diff_target_verification: verified | harness-supplied | mismatch | unavailable
  dimensions:
    evaluated: []
    not_triggered: []
  findings: []
  evidence_gaps: []
  verdict: clean | findings | needs-evidence | blocked | needs-user | needs-debug
  recommended_route: <macro-route-or-none>
  shadow_only: true
  route_is_advisory: true
  governed_mutation_count: 0
  ephemeral_effects: []
```

Review never writes code or governance state. `governed_mutation_count` covers product source, governance records, queues, aliases, registry/install/host surfaces, and other task-owned durable files. Validation may create declared ephemeral cache/build/temp artifacts only under the Phase 1 side-effect policy. Persisting a finding is a separate admission plus Runtime transaction.

## 8. Review convergence policy

### 8.1 Review-cycle phases

- `discovery`: inspect the admitted breadth and establish the initial finding set.
- `verification`: verify admitted fingerprints and impacted gates after repair; it is not permission to restart unlimited discovery.

### 8.2 Finding fingerprint

A stable fingerprint is derived from semantic identity rather than wording:

```text
category
+ owner route
+ canonical file/symbol or governance object
+ failure condition
+ violated acceptance/contract/invariant identifier
```

Location movement caused by an admitted repair does not automatically create a new finding when the failure condition and violated invariant are unchanged.

### 8.3 Admission during discovery

A finding is repair-admissible only when all are true:

- evidence demonstrates a reproducible or statically provable failure;
- owner is the active task;
- repair is inside the admitted scope;
- the decision is mechanical rather than taste/user-owned;
- the root cause is known enough for a bounded repair, or the route is `debug-task` instead;
- the fingerprint is not already open or resolved without materially new evidence.

### 8.4 Admission during verification

Verification may examine broadly, but a newly observed issue becomes a new blocker only when it has strong evidence and at least one is true:

- the repair caused or exposed it;
- it violates a hard invariant or confirmed acceptance claim;
- it is a major/critical current-owner defect that would make the completion verdict false.

Speculative edges, other-owner defects, scope widening, product choices, and unrelated quality opportunities are reported or captured through their correct route; they do not silently enter the repair loop.

### 8.5 Bounded repair loop

```text
discovery
  → finding admission
  → execute-step:repair
  → verification
       ├─ resolved                     → continue toward completion
       ├─ same fingerprint persists    → increment repair attempt
       ├─ strong new blocker           → finding admission
       ├─ unknown root cause            → debug-task
       └─ user/scope/contract decision  → ask-user / replan
```

The recommended default is at most **two repair attempts per fingerprint**, at most **three total repair rounds per review cycle**, and at most **one new-finding admission wave during verification**. A repair round is one authorized patch batch followed by verification; multiple already-admitted findings may share a round when their scope and evidence remain separable. Exhausting any applicable budget produces `needs-debug`, `needs-user`, or `blocked`; it never silently starts a new discovery cycle. These values are Phase 0C user decisions, not yet locked protocol values. The existing three-hypothesis root-cause stop rule remains a separate investigation budget.

Each review invocation terminates with one observable verdict from `clean`, `findings`, `needs-evidence`, `blocked`, `needs-user`, or `needs-debug`; it cannot continue merely because a reviewer can imagine another test or cleanup. `findings` means admitted findings must be routed to an authorized repair or deferral decision, while `needs-evidence` suspends the conclusion until the named claim-bound evidence is supplied. Neither verdict silently starts another discovery or repair cycle.

### 8.6 Persistence boundary

Review-cycle state may remain ephemeral only while no cross-turn or cross-session handoff occurs. Before repair, pause, interruption, delegation, or session end, the logical diff target, cycle phase, admitted fingerprints, attempt counters, remaining budget, and evidence revision must be proposed into the existing canonical task/finding records through Runtime. Conversation memory and a facade-local cache are not authority. The exact `CURRENT_TASK` schema extension is deferred to a later protocol task; no parallel review database is allowed.

## 9. Evidence admission policy

### 9.1 Claim model

Every requested evidence item traces to a claim:

```yaml
claim:
  id: <stable-id>
  kind: acceptance | regression | invariant | bug-reproduction | compatibility | release | exploration
  owner_source: contract | accepted-task | confirmed-bug | risk-analysis | user | none
  certainty: confirmed | provisional | exploratory
  impact: local | shared | critical
  existing_evidence: []
```

### 9.2 Evidence-plan decision

The evidence planner decides:

- whether new evidence is needed;
- the minimum sufficient evidence type;
- whether an existing test/check can be reused;
- whether a new persistent test is allowed;
- whether evidence is temporary exploration rather than a product contract;
- which failure routes to repair, debug, replan, or user decision.

An exploratory probe also declares a bounded duration, tool/run count, permitted temporary artifact locations, and cleanup/audit rule. Harness-level timeouts may enforce the budget, but they cannot silently turn an exhausted probe into sufficient evidence.

Evidence types include static proof, existing regression, focused test, integration smoke, browser/session check, visual evidence, real-device evidence, external documentation, release health/canary, and explicit human acceptance.

### 9.3 Persistent-test admission

A new committed test normally requires all of:

- a confirmed owner source;
- a named claim or failure it proves;
- a reason existing evidence is insufficient;
- an assertion at the behavioral/contract boundary rather than incidental implementation detail;
- a clear expected disposition if the test fails.

Valid owner sources include confirmed acceptance, an existing contract, a reproduced bug, a hard invariant, or a concrete regression risk introduced by the diff. A user does not need to approve every mechanical regression test when the owner is already confirmed.

`risk-analysis` is a valid owner source only when it is anchored to an identified changed behavior, known failure model, and admitted task scope. A model-generated hypothetical by itself is not an owner.

If certainty is `provisional` or `exploratory`, the harness may run temporary probes, but it must not silently commit them as permanent contract tests. `owner_source: none` means no new persistent test by default.

When an evidence plan must survive a turn, session, delegation, pause, or interruption, its claim identity, owner, certainty, admitted evidence types, and completion state are persisted through a typed proposal into an existing canonical task record. Harness memory alone cannot reset or widen the plan.

### 9.4 Anti-inflation rules

- Reuse existing evidence before creating a new test.
- Add the smallest evidence that closes the named gap.
- Do not generate combinatorial tests for hypothetical behavior without an owner.
- Do not make a guessed product behavior pass by writing both implementation and test.
- Do not keep tests whose only purpose is to exercise the workflow-system itself unless that workflow behavior is the task's confirmed subject.
- Review may question test adequacy but cannot continuously expand the test plan after the admitted claims are proved.
- The evidence plan is baselined before implementation. Review may add a claim only through the same strong-evidence admission rule used for new blockers; each claim receives one minimum-sufficient evidence plan rather than an open-ended test budget.

## 10. Project context and knowledge admission

### 10.1 `project-context-resolver`

The resolver supplies the smallest authoritative context bundle that can govern the current intent. It is read-only. It does not summarize away conflicts, invent missing facts, or copy all historical knowledge into every prompt.

```yaml
context_request:
  request_id: <stable-id>
  target_root_identity:
    absolute_root: <path>
    git_anchor: <path-or-none>
    relationship: source | isolated-target | shared-git-conflict | unknown
  intent: <prepare|execute|review|debug|lifecycle|capture|close|validate|bootstrap>
  task_identity: <id-or-not-applicable>
  lifecycle_tuple: <status-and-lifecycle-or-not-applicable>
  diff_target: <one-explicit-logical-target-or-not-applicable>
  goal_and_claims: []
  scope_paths_and_symbols: []
  changed_surfaces: []
  risk_triggers: []
  context_budget:
    max_items: <positive-integer>
    max_summary_bytes: <positive-integer>
```

Candidate authority is resolved in layers:

1. Protocol and Schema own workflow structure.
2. Project facts retain `CONTRACTS > PROJECT_PROFILE > DECISIONS > CURRENT_TASK > STATUS` precedence.
3. Code, tests, external documentation, design/release evidence, and task artifacts provide scoped evidence rather than silently overriding higher authority.
4. `LESSONS` is advisory operational knowledge. It may trigger a check or warn about a pitfall, but it cannot override Contracts, confirmed Decisions, task scope, or current evidence.

The resolver returns exact locators and a selection trace:

```yaml
context_bundle:
  context_id: <stable-fingerprint>
  source_revision: <comparable-workspace-revision>
  required:
    - source: <canonical-file>
      locator: <heading/id/path/symbol>
      authority: <structural|contract|profile|decision|task|status|lesson|evidence>
      relevance_reason: <matched-goal/scope/surface/risk/claim>
      freshness: <current|stale|unknown>
  optional: []
  conflicts: []
  missing_required_context: []
  excluded_summary:
    count: <integer>
    reasons: []
  budget_result: within-budget | required-context-exceeds-budget
```

Resolution rules:

- Required context is selected by task identity, exact scope/path/symbol matches, public API/DTO/event/schema relations, lifecycle state, accepted claims, and mechanically triggered risk gates.
- Relevant higher-authority context is never dropped merely to fit a token budget. `required-context-exceeds-budget` stops for chunking or a larger context allocation.
- Conflicting canonical sources remain explicit. The resolver cannot choose a lower-precedence or newer-looking statement for convenience.
- Unknown/shared target-root identity, illegal ownership tuple, stale or missing required diff target, unsupported schema, unsafe locator, or unresolved mandatory-authority conflict is fail-closed.
- Superseded/rejected Decisions and obsolete Lessons are excluded from operative guidance but retain locators in the trace when they explain a conflict or migration.
- A consumer records which context items influenced its result so later review can detect stale or missing knowledge.
- Search/index/cache artifacts may accelerate lookup, but they are disposable projections and never become a source of project truth.

### 10.2 `knowledge-admission-policy`

Durable knowledge enters `CONTRACTS`, `DECISIONS`, or `LESSONS` only through a typed candidate and semantic admission decision.

```yaml
knowledge_candidate:
  candidate_id: <stable-id>
  kind: contract | decision | lesson
  fingerprint: <semantic-deduplication-key>
  statement: <candidate-knowledge>
  source_refs:
    - locator: <path-and-heading/symbol>
      revision: <comparable-revision>
  applicability:
    project_types: []
    paths_symbols_or_surfaces: []
    trigger_conditions: []
  authority_source: <user|existing-contract|accepted-decision|verified-evidence|none>
  stability: stable | provisional | exploratory
  evidence_refs: []
  novelty_against: []
  conflict_set: []
  supersedes: <id-or-none>
  review_or_expiry_trigger: <condition-or-none>
  expected_consumers: []
```

Admission results are a closed set:

- `admit`: add a new durable item with provenance and retrieval tags;
- `merge`: update the existing semantic item without duplicating it;
- `supersede`: append an explicit successor link while preserving history;
- `defer`: retain the candidate outside durable knowledge until evidence/authority is sufficient;
- `reject`: the candidate is wrong, unauthorized, overly local, or contradicted;
- `no-op`: the knowledge already exists with equivalent scope and evidence.

Every result also declares `permitted_uses`, blockers/reason, and the admitted or compared revision. A deferred/exploratory candidate may inform further investigation but cannot authorize mutation, completion, persistent tests, or durable knowledge writes.

Kind-specific gates:

- `contract`: requires a verified stable interface, architectural boundary, invariant, or dependency rule. Temporary implementation detail and speculative future behavior are rejected.
- `decision`: requires explicit authority, context, alternatives or rejected path, constraints, and provenance. A model recommendation alone cannot become an accepted Decision.
- `lesson`: requires a reusable trigger, failure pattern, cause, prevention/action, evidence, and expected consumers. Normally it is supported by repeated evidence; one high-severity systemic failure may qualify when recurrence would be materially unsafe. One-off task narration, generic slogans, and transient tool problems are rejected.

Anti-bloat and anti-forgetting rules:

- Fingerprint and semantic overlap checks occur before append.
- Knowledge is tagged by applicability and consumer triggers so the resolver can retrieve it selectively.
- Newer does not automatically supersede higher-authority or still-applicable knowledge.
- A narrower lesson or decision cannot weaken a wider Contract.
- Superseded knowledge remains auditable but is not loaded as operative guidance by default.
- Repeatedly unused entries are candidates for review, not silent deletion; provenance must survive compaction.
- A task summary, review finding, or exploratory note is not automatically a knowledge candidate.

Runtime commits an admitted candidate through the existing exact contract/decision/lesson handlers. `knowledge-admission-policy` performs semantic eligibility; Runtime performs deduplication preconditions, exact writes, conflict detection, atomic commit, and read-back.

### 10.3 Phase 1 boundary

Phase 1 `review-change` may use `project-context-resolver` to build its read-only context bundle and may classify a possible knowledge candidate in its report. It cannot commit, merge, supersede, or delete knowledge. Missing or conflicting required knowledge contributes to `blocked` or `needs-user`, not a guessed clean verdict.

## 11. Existing-installation and state-schema migration contract

### 11.1 Version axes

The upgrade contract distinguishes versions that must not be conflated:

- installed workflow-system product version;
- `.workflow-system/install-state.json` infrastructure `state_version`;
- capability/migration-manifest schema version;
- canonical project-state schema version for live task/finding/lifecycle records;
- Protocol and File Schema versions.

Product upgrade does not imply that every state artifact already uses the newest schema. Install state records version metadata and checksums; it does not become the source of task facts.

A future install-state schema should retain at least: a stable install ID; product/bundle version and source provenance; target root/git identity; installed/upgraded timestamps; exact managed-file ownership and old/new checksums; package/profile managed fragments; host namespace/entry checksums; supported state-schema capabilities; current migration ID/from/to/status/source tuple/pre/post checksums/rollback reference; and append-only migration history. Field names and version number remain a later schema decision.

### 11.2 Supported starting states

An in-place migration must handle:

- a bundle-installed target with `install-state.json`;
- a previously installed target with managed-file drift;
- a self-adopted or older manually installed target without complete install metadata;
- an active task with or without findings;
- valid or invalid paused/interrupted packages;
- a target with no current task but retained archives/inbox artifacts.

Missing install metadata triggers explicit inventory/import planning. It does not trigger bootstrap, adopt, recreation of project facts, or automatic ownership selection.

### 11.3 Migration lifecycle

```text
inspect
  → identify installed and state-schema versions
  → inventory canonical live/suspended artifacts and managed drift
plan
  → select an explicit ordered migration path
  → classify preserved, transformed, blocked, and target-owned fields
checkpoint
  → write checksummed recovery material outside live governance paths
render
  → transform copies and validate every resulting tuple/reference
commit
  → atomically replace the complete admitted write set
  → update install/state version marker last as the commit record
verify
  → read back, run protocol/state checks, and compare identities/evidence
complete | rollback-required | blocked | conflict
```

Skipping an intermediate state migration is forbidden unless a tested composite migration explicitly declares the same preconditions and postconditions. Dry-run is mandatory before write mode.

### 11.4 Canonical state preservation

Active task migration must preserve:

- task ID/title/slug and active-owner tuple;
- goal, acceptance, Allowed/Conditional/Forbidden scope, decisions, evidence, rollback points, diff target, and remaining risks;
- lifecycle and resume-review fields;
- execution history and current handoff without converting failure/unknown into completion.

Finding migration must preserve:

- source, severity, location/symbol, failure scenario, owner evidence, scope, status, fix/test evidence, and history;
- deterministic candidate fingerprint without silently merging collisions;
- known repair attempts and convergence state.

If legacy repair-attempt evidence is absent, migration records `legacy-attempts-unknown`. It must not grant a fresh automatic repair budget; the finding requires verification, debug, or user disposition before another automatic repair.

Paused/interrupted migration must preserve:

- artifact kind, immutable task identity, complete task snapshot, lifecycle marker, recovery-only/ready marker, and review reasons;
- blocker recheck evidence for `paused_blocked`;
- checkpoint, dirty attribution, environment, and recovery strategy for `interrupted`;
- explicit package selection and active-owner conflict protection.

Invalid or incomplete packages remain non-resumable recovery evidence. Migration cannot fill missing recovery facts by guessing, select the latest package, or create a second active owner.

Archives remain historical evidence and are not rewritten by default. Inbox records remain record-only. If a later schema requires their migration, it needs an explicit artifact-specific contract rather than inclusion through a broad directory glob.

### 11.5 Target-owned facts and managed drift

- Known workflow-managed structural fields may be transformed only by the selected migration.
- Unknown headings, fields, target-specific rules, user documents, native host assets, and project facts are preserved or cause a reviewable conflict; they are never overwritten to resemble a fresh install.
- Existing managed drift follows the current replace/repair ownership contract. State migration does not silently authorize managed-file replacement.
- Source/target root guards, frozen paths, generated-only boundaries, and host namespace isolation remain active during migration.

### 11.6 Atomicity, recovery, and idempotence

Migration recovery artifacts may live under a bounded `.workflow-system/migrations/<migration-id>/` infrastructure directory with checksums, source versions, exact targets, and rollback instructions only after Protocol/Schema explicitly add that bounded path to the migration write contract. The current Phase 0B Runtime allowlist does not authorize it. Until that later decision, implementation must use a controlled temporary location or another explicitly authorized recovery mechanism. Recovery artifacts are evidence, not project truth.

- All live files for one migration transaction are rendered and validated before the first commit.
- A failed or interrupted multi-file migration leaves either the pre-migration state or a detectable rollback-required journal; it cannot report success with a partial schema.
- Replay against the same source tuple and migration ID is an idempotent no-op only after read-back proves the target postconditions.
- A different source tuple, local edit, ambiguous identity, missing artifact, or stale authority returns `conflict`/`blocked`.
- Rollback restores the checksummed pre-migration set without deleting unrelated target content.
- Install/state version markers update only after canonical state and managed artifacts validate successfully.

### 11.7 Compatibility and rollout

- Existing legacy Skill names and their old-state adapters remain callable throughout the migration window.
- Read-only vNext consumers should support version-aware parsing before any state schema is rewritten.
- State-changing vNext slices cannot become authoritative until migration fixtures pass for active, finding, paused, interrupted, drifted, interrupted-commit, and replay cases.
- Migration is a dedicated in-place upgrade operation. It is not `bootstrap-project`, `adopt-existing-project`, or a destructive reinstall.
- A target may remain on the legacy runtime when migration blocks; the old route remains authoritative and no partially promoted host surface is installed.

### 11.8 Phase 1 boundary

Phase 1 is migration-aware but non-migrating. The read-only shadow detects installed/state schema versions, uses version-aware readers, reports migration eligibility or blockers, and never rewrites live or suspended state. Implementation of the migration transaction belongs before the first state-changing vNext slice.

## 12. Macro transition policy

### 12.1 Permitted macro routes

| From | To | Automatic only when |
|---|---|---|
| `prepare-task` result state `ready` | default `execute-step` intent | the original request authorizes implementation and no user-owned gate remains |
| `execute-step` result state `change-ready` | default `review-change` intent | the diff target is explicit and review is read-only |
| admitted mechanical finding | `execute-step:repair` | owner/scope/authority/root-cause and repair-budget gates pass |
| `debug-task` result state `root-cause-confirmed` | `execute-step:repair` | caller selected resolve intent and repair is authorized |
| lifecycle resume success | `prepare-task` readiness review | recovery package and active-owner transaction succeeded |
| review evidence request | `validate-change` expert call | the evidence plan names the claim and validation remains read-only |
| closure intent with satisfied gates | `close-task` Runtime proposals | acceptance, evidence, release, and remaining-risk rules pass |

An “automatic” route is execution permission, not merely a recommendation. If user intent did not authorize end-to-end work, or the next route changes user-owned authority, the system reports the recommended route and stops.

### 12.2 Forbidden handoff patterns

- `create → review → scope → classify → plan → decompose` as executable public nodes;
- `scope-review → implementation-review → contract-review` as executable public nodes;
- review directly editing or repairing;
- validation failure synchronizing success-shaped task state;
- finding discovery entering repair before admission;
- resume entering implementation before readiness review;
- optional sync categories being invoked as a user-visible checklist.

## 13. Runtime transaction architecture

Runtime should use a shared kernel with typed operation handlers rather than ten unrelated transaction frameworks or one unrestricted document editor.

```text
GovernanceTransactionKernel
  ├─ parse canonical source tuple
  ├─ validate common proposal envelope
  ├─ validate authority evidence
  ├─ dispatch exact operation handler
  ├─ render proposed canonical documents
  ├─ validate operation-specific source/write allowlist
  ├─ detect no-op, replay, conflict, or blocked state
  ├─ stage and atomically commit
  └─ read back and return structured result

Typed handlers
  ├─ task-state
  ├─ lifecycle
  ├─ inbox-record
  ├─ finding-queue
  ├─ project-status
  ├─ contract-candidate
  ├─ decision-record
  ├─ paired-host-guidance
  ├─ lesson-record
  └─ archive
```

### 13.1 Common proposal envelope

```yaml
proposal:
  operation_kind: <closed-set>
  source_tuple: <canonical-revision-and-state>
  authority_evidence: []
  semantic_delta: {}
  preconditions: []
  evidence_refs: []
  idempotency_key: <stable-key>
  requested_write_targets: []
```

### 13.2 Kernel boundaries

- The kernel never decides product behavior, taste, architecture, or whether evidence is persuasive.
- Each handler owns an exact source set, exact write set, schema, preconditions, conflict rules, and postconditions.
- A path permitted to one handler is not automatically permitted to another handler.
- A declaration pattern such as `TASKS/paused/**` must resolve to one exact materialized target and verified task identity before commit; the kernel never writes through a broad glob.
- The kernel stores no durable shadow state; idempotency and conflicts derive from canonical sources and proposal identity.
- Partial writes and success-shaped failure are forbidden.

The exact command/API syntax remains deferred until this architecture is confirmed.

## 14. v1 migration model and vNext execution model

| Concern | Phase 0B v1 migration projection | vNext target execution model |
|---|---|---|
| Purpose | Prove every old semantic has a destination | Minimize user and model-visible orchestration |
| Public IDs | Exact ten-ID baseline | Exposure-tiered candidate surface; names/count remain a decision |
| Modes | Detailed enough to mirror legacy Skills | Only intent/authority/terminal/recovery modes |
| Handoffs | Preserve legacy stage graph for comparison | Macro transitions only |
| Stages | All ten historical stages must be covered | Historical stages remain compatibility metadata, not runtime nodes |
| Internal capabilities | Reference old governance rules | Selected adaptively from explicit triggers |
| Runtime | Declarations and allowlists | Shared kernel plus exact typed handlers |
| Fixtures | Static structural/self-consistency oracle | Executed legacy-vs-shadow semantic comparison plus structural gates |
| Exposure | public/internal/runtime/compat declaration | daily/admin/expert/internal/compat discoverability and callability |

Phase 1 must compare the new read-only facade against the v1 baseline. It must not overwrite v1 evidence to make a mismatch disappear.

## 15. Phase 1 boundary after Phase 0C

The first behavioral slice should implement only a non-default, read-only `review-change` shadow:

1. accept one explicit diff target and review-cycle phase;
2. build a risk/evidence profile;
3. evaluate mandatory and triggered review dimensions without internal handoffs;
4. request validation evidence through the expert surface when needed;
5. produce one structured verdict;
6. run finding admission and convergence classification without writing the queue;
7. compare the result with the legacy review/contract/regression chain;
8. record hard mismatches separately from token, latency, turn, and tool-call metrics.

Phase 1 cannot mutate product source, governance state, finding queues, aliases, registry, install, or host exposure. Validation subprocesses may write only declared ephemeral cache/build/temp artifacts in sandboxed or project-approved locations. Phase 1 records pre/post workspace state, treats any unexpected durable diff as a blocker, and cleans disposable artifacts when the project contract permits. “Read-only” therefore means zero governed mutation and zero unexpected workspace diff, not literally zero operating-system writes. Zero hard-invariant mismatch is required before any default promotion or state-changing slice.

### 15.1 Implemented Phase 1 source slice

The initial additive source slice is now present in:

- `scripts/project-context-resolver.ts` — relevance/authority/conflict/budget-aware context resolution plus read-only knowledge-admission classification;
- `scripts/workflow-review-shadow.ts` — one unified review result, canonical task authority checks, Git-backed diff verification when available, finding/convergence classification, workspace mutation detection, and version-aware install/task/suspended-state diagnosis;
- `scripts/workflow-validate-shadow.ts` — claim-bound `validate-change` evidence execution resolved from the exact Project Profile validation-matrix command ID, bound to command/context/diff revisions, executed with `shell: false` in a disposable clean copy, and guarded by strict live/sandbox pre/post audits plus mandatory cleanup;
- `scripts/workflow-shadow-samples.ts` and `test/fixtures/workflow-vnext-shadow-sample-matrix.yaml` — disposable-copy legacy-versus-shadow comparison across the required 12 representative semantic scenarios, with hard/soft result separation and explicit model/harness coverage accounting;
- `test/project-context-resolver.test.ts`, `test/workflow-review-shadow.test.ts`, `test/workflow-validate-shadow.test.ts`, and `test/workflow-shadow-samples.test.ts` — executable target-shape and fail-closed cases;
- `package.json > test:workflow-vnext-shadow` — the focused suite, also included in `test:workflow-all`.

This implementation remains `shadow_only: true`; its route is advisory and no registry, host, alias, install, Runtime write, or current Skill surface calls it by default. When a live `CURRENT_TASK.md` is named, its acceptance, scope, lifecycle tuple, and recorded diff-target kind constrain caller input. When Git is available, working-tree/staged/range/commit path sets and fingerprints are verified against Git. Taskless or patch review relies on harness-supplied authority/evidence and is labeled accordingly.

Each typed `validationRequest` now carries the review request/cycle, exact claim IDs, dimension and evidence kind, diff fingerprint, context source revision, and replayable context input. `validate-change` fails closed when any binding drifts; it rejects unsafe shell grammar and broad/non-ephemeral cleanup declarations, never converts external-documentation or approval authority into subprocess evidence, and treats any governed sandbox mutation or live-workspace escape as a blocker. Only declared ephemeral roots may be created in the disposable copy, and the entire copy is removed after every outcome.

The 12-case matrix is currently a structural `contract-fixture` baseline. It proves the comparison/reporting contract and all local hard assertions, but it is deliberately ineligible for promotion. Phase 1 exit still requires traceable `observed` legacy executions for every declared scenario/model/harness cell, with zero hard mismatch, zero governed mutation, zero unexpected diff, and the legacy route remaining authoritative until that evidence is complete. `TA-25` currently proves read-only preservation during diagnosis; the transactional commit/rollback/replay semantics in `TA-26` and `TA-27`, and the complete blocked-upgrade fallback in `TA-29`, remain Phase 1.5 gates before any state-changing vNext slice.

## 16. Target architecture acceptance cases

The existing 55 fixtures remain mandatory. Phase 0C adds these target-shape cases for the future v2 model:

| ID | Scenario | Required result |
|---|---|---|
| `TA-01` | README command typo | `prepare-task` selects minimal depth without materializing plan/decompose stages; exact scope, focused evidence, unified review |
| `TA-02` | Multi-module API/DTO change | guarded profile triggers propagation, contract, compatibility, and linked regression evidence |
| `TA-03` | Ordinary review | one `review-change` invocation returns a unified verdict; no internal review-dimension handoffs |
| `TA-04` | Report-only failure | terminal report, zero governed mutations and no unexpected workspace diff, zero repair/sync execution |
| `TA-05` | Same fingerprint survives the repair budget | deterministic `needs-debug`; no third unbounded repair pass |
| `TA-06` | Verification notices a speculative edge | issue is reported but not admitted into the current repair queue |
| `TA-07` | Confirmed contract regression | a focused persistent test is admitted with contract owner and expected failure route |
| `TA-08` | Unconfirmed product behavior guess | temporary exploration may run; no permanent test or implementation contract is created |
| `TA-09` | Runtime proposal uses a valid path assigned to the wrong operation | operation-specific handler rejects it before mutation |
| `TA-10` | Interrupted task resumes | atomic restore succeeds, then macro-routes to readiness review rather than implementation |
| `TA-11` | CI requests regression evidence | `validate-change` is callable without appearing as a required daily user step |
| `TA-12` | Legacy alias and shadow entry run on the same case | hard governance verdicts match while wording/cost may differ |
| `TA-13` | Verification repeatedly exposes distinct strong blockers | one bounded new-finding wave is admitted; the cycle-level budget then terminates in `needs-debug`, `needs-user`, or `blocked` instead of restarting discovery |
| `TA-14` | Review or evidence work crosses a session boundary | canonical task/finding records preserve diff target, fingerprints, budgets, claims, and evidence state; a new session cannot reset attempts or widen the test plan from memory |
| `TA-15` | Small bug matches one Contract, one Decision, and one prior Lesson | resolver returns exact relevant locators and excludes unrelated knowledge without weakening precedence |
| `TA-16` | CURRENT_TASK conflicts with a Contract and a newer-looking Lesson | conflict is explicit; Contract wins and the Lesson cannot authorize implementation |
| `TA-17` | A previously recorded pitfall matches the current failure trigger | relevant Lesson is consumed as advisory prevention evidence and the same failed approach is not repeated silently |
| `TA-18` | One-off workaround is proposed as a Lesson | knowledge admission rejects/defer it; no durable knowledge is appended |
| `TA-19` | Equivalent Decision/Lesson candidate already exists | disposition is `merge` or `no-op`; provenance is preserved and no duplicate entry is created |
| `TA-20` | Required context exceeds the configured budget | resolver returns `required-context-exceeds-budget`; it chunks/escalates rather than dropping authoritative context |
| `TA-21` | Installed v1 target has an active task | dry-run produces an in-place ordered migration preserving identity, scope, lifecycle, diff target, evidence, and unfinished status; bootstrap/adopt is absent |
| `TA-22` | Legacy active finding has no repair-attempt evidence | migration records `legacy-attempts-unknown` and grants no fresh automatic repair budget |
| `TA-23` | Valid paused and interrupted packages coexist | each artifact is transformed independently with identity/recovery evidence preserved; neither is auto-selected or made active |
| `TA-24` | Suspended package conflicts with a live active owner or lacks required recovery fields | migration blocks that state set and leaves it recoverable/non-resumable; it does not guess or create a second owner |
| `TA-25` | Existing installation has target-owned fields and managed drift | dry-run preserves unknown target facts, reports drift separately, and does not authorize replacement through state migration |
| `TA-26` | Multi-file state migration is interrupted after staging | live state remains pre-migration or reports rollback-required from a checksummed journal; no partial success/version marker exists |
| `TA-27` | Completed migration is replayed with the same ID/source tuple | read-back proves postconditions and replay is an idempotent no-op; a changed tuple returns conflict |
| `TA-28` | Older adopted project has no complete install-state metadata | explicit inventory/import plan is produced; project facts are not recreated and bootstrap/adopt is not invoked |
| `TA-29` | Target cannot safely migrate yet | legacy runtime/aliases remain authoritative and no partial vNext host surface is promoted |
| `TA-30` | A claim-bound Project Profile validation command creates only declared ephemeral output | command runs with `shell: false` in a disposable clean copy; evidence is bound to claim/diff/context/command revisions, ephemeral output is audited and cleaned, and the live workspace has zero diff |
| `TA-31` | Validation changes a governed sandbox file or escapes into the live workspace | result is `blocked`, the exact unexpected paths and governed mutation count are reported, and disposable cleanup still runs |
| `TA-32` | Validation command grammar, command revision, context revision, target identity, or diff target is unsafe/stale | subprocess does not execute and the mismatch is reported as a blocker; external-documentation and approval evidence also remain outside subprocess authority |
| `TA-33` | The required 12-scenario contract matrix is executed on disposable copies | every hard semantic comparison passes and the source fixture remains unchanged, but promotion evidence is `not-assessed` because fixture baselines are not observed legacy executions |
| `TA-34` | A required scenario/provenance/declared scenario-model-harness cell is missing, or any hard semantic/mutation invariant differs | comparison fails closed, promotion is ineligible, and the legacy route remains authoritative |

## 17. Success measures

Hard requirements:

- all G-01 through G-18 invariants remain true;
- no historical internal stage is promoted without passing the mode admission rule;
- no internal review or preparation dimension uses an executable public handoff;
- review and validation remain non-mutating;
- validation evidence is bound to exact claims, diff/context/command revisions, audited in a disposable environment, and cannot borrow user or external-documentation authority;
- every declared representative scenario/model/harness cell has traceable observed legacy-versus-shadow evidence before promotion;
- every persistent test has a traceable owner and claim;
- repair loops terminate by policy;
- every consumed durable knowledge item has an exact locator and relevance reason;
- knowledge candidates deduplicate, preserve provenance, and cannot bypass authority or stability gates;
- Runtime has operation-specific source/write boundaries and no second state source;
- existing installations have an in-place, dry-run-first, atomic and rollback-capable state migration path that preserves active/finding/paused/interrupted semantics without bootstrap/adopt;
- all compatibility names remain resolvable until their own retirement gate passes.

Soft improvement measures:

- fewer daily visible entries and manual invocations;
- fewer model-visible workflow nodes and handoffs;
- reduced duplicated prompt/policy lines;
- fewer review/repair cycles;
- fewer newly committed tests without acceptance value;
- lower tokens, turns, latency, and maintenance surface;
- equivalent behavior across representative models and harnesses.

No numeric public-entry target or prompt-reduction percentage may weaken a hard requirement.

### 17.1 Architectural counterexamples that must fail

- A README typo still materializes create/review/scope/classify/plan/decompose nodes.
- Unified review automatically admits every issue it notices into the current repair queue.
- A `report-only` pass or failure executes debug, repair, synchronization, or closure.
- Runtime accepts an outdated source revision or model-authored text as user approval.
- The same fingerprint causes an unbounded repair/review loop.
- Tests with no acceptance, contract, bug, invariant, or risk owner are committed until something fails.
- A Runtime handler writes through a broad glob or borrows another operation's valid target.
- Resume selects the “latest” package or leaves two active owners.
- Internal `sync-state` becomes a way to overwrite semantic facts without eligibility evidence.
- Host sync exposes internal capabilities as daily entries or removes compatibility names before their evidence gate.
- A task loads all Contracts/Decisions/Lessons without relevance tracing, or silently drops required context to fit a token budget.
- A model observation or one-off workaround becomes a Contract, Decision, or Lesson without authority/evidence/deduplication.
- An upgrade resets finding attempts, guesses paused/interrupted recovery fields, selects a latest package, or requires existing projects to bootstrap/adopt again.
- A migration version marker advances while live state is partial, drifted, or rollback-required.
- Different models or harnesses change authority, stop, owner, or mutation verdicts rather than only cost, wording, or turn count.
- A contract fixture, caller-asserted legacy object, partial model/harness sample, or soft metric improvement is treated as promotion evidence.
- Validation runs through a shell, accepts a stale/unregistered command, writes a governed path, or reports success after an unexpected live/sandbox diff.

## 18. Phase 0C decision register

### 18.1 Confirmed decisions

1. Public entries express intent rather than historical stages.
2. Internal preparation/review dimensions do not form an executable handoff chain.
3. Exposure is split into daily, administrative, expert/automation, internal, and compatibility tiers.
4. `review-convergence-policy` and `evidence-admission-policy` become first-class internal capabilities.
5. Review is unified and read-only; finding admission remains separate.
6. Runtime uses a common transaction kernel plus exact typed handlers and canonical sources only.
7. Phase 0B v1 remains migration evidence; vNext target evolution is explicitly versioned.
8. `project-context-resolver` performs relevance/precedence/conflict-aware retrieval; `knowledge-admission-policy` governs durable Contract/Decision/Lesson growth.
9. Existing installations and canonical active/finding/paused/interrupted state migrate in place without bootstrap/adopt or loss of ownership/evidence.

### 18.2 Confirmed parameter choices

1. The recommended exposure matrix and entry names are accepted.
2. The proposed explicit target modes and mode-admission rule are accepted.
3. The convergence budget is accepted: two attempts per fingerprint, three total repair rounds, and one verification new-finding wave.
4. The persistent-test admission rule and temporary exploratory-evidence treatment are accepted.
5. The guarded macro transitions in §12.1 may execute automatically only under an authorized end-to-end request and must stop at user-owned authority changes.
6. The common Runtime transaction kernel plus exact typed handlers direction is accepted; exact CLI/API syntax remains deferred.

### 18.3 Deferred beyond Phase 0C

- Runtime command/API syntax and implementation language details;
- target manifest schema/file layout;
- project-context index/cache implementation and canonical knowledge-document schema details;
- migration command syntax, journal layout, and version-number allocation;
- registry and host discoverability mechanics;
- alias retirement window and telemetry source;
- state-changing facade implementation;
- default promotion of any facade.

## 19. Decision outcome

The user accepted all six recommended decisions and required the two additional contracts in §§10–11. Phase 0C is accepted as the Phase 1 design basis. The read-only review/validation shadow and 12-scenario contract sample harness now implement the local comparison boundary, but Phase 1 has not exited: observed legacy evidence across every declared scenario/model/harness cell is still required. Keep the current 37-Skill system authoritative and the Phase 0B manifest unchanged until that semantic-equivalence gate passes. Migration implementation must land before the first state-changing vNext slice.
