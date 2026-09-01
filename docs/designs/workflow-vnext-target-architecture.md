# Workflow vNext Target Architecture

- Phase: `Target Architecture`
- Status: `Accepted final design`
- Date: `2026-08-30`
- Behavior impact: `none`
- Design references:
  - [`workflow-skill-kmrd-audit.md`](../product/workflow-skill-kmrd-audit.md)
  - [`.workflow-system/WORKFLOW_CAPABILITIES.yaml`](../../.workflow-system/WORKFLOW_CAPABILITIES.yaml)
  - [`test/fixtures/workflow-capability-cases.yaml`](../../test/fixtures/workflow-capability-cases.yaml)

## 1. Decision objective

The target architecture consolidates the required governance semantics into a smaller intent surface. Historical Skill names and stage graphs are migration inputs only; they are not part of the vNext execution model.

The target architecture is:

```text
Execution:
user / harness
        ↓
seven daily intent entries
        ↓
adaptive internal governance capabilities
        ↓
typed semantic proposals
        ↓
deterministic Runtime transactions
        ↓
canonical Markdown/YAML knowledge

Upgrade boundary:
old idle project
        ↓  one-time offline Migration Pack
pure vNext installation
```

The target is a smaller user intent surface with fewer model-visible workflow nodes and no loss of boundary, authority, state, evidence, stop, or escalation semantics. The old Skill graph is migration input, not a vNext runtime layer.

## 2. Target architecture boundaries

This target design does not:

- make vNext Skills understand, parse, or execute the old protocol;
- retain old Skills or compatibility aliases in a pure vNext installation;
- make Runtime or a vNext Skill perform legacy-document conversion;
- introduce a second project-truth store beside canonical Markdown/YAML knowledge;
- let an unsupported schema continue into task execution;
- define implementation-specific CLI/API syntax in this architecture document.

The old manifest and governance documents are inputs to the one-time Migration Pack only. A vNext manifest/schema is a new contract and must not silently reinterpret an old schema.

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

### P-08 — Legacy understanding belongs only to the one-time Migration Pack

The vNext runtime is not a compatibility runtime. It does not parse old protocol/schema documents, resolve old Skill names, or execute legacy modes. A separate, one-time Migration Pack is the only legacy-aware component; it converts an idle old project offline before pure vNext installation. The resulting vNext installation contains no old Skills or compatibility aliases.

### P-09 — Project knowledge is selected by relevance and admitted by evidence

The system does not load all accumulated governance knowledge into every task and does not persist every observation. `project-context-resolver` selects relevant canonical context with source locators, precedence, freshness, and conflicts. `knowledge-admission-policy` admits, merges, supersedes, defers, or rejects candidates for `CONTRACTS`, `DECISIONS`, and `LESSONS` based on authority, stability, novelty, reuse value, and evidence.

### P-10 — Upgrade is an idle-only, one-time offline conversion

Only an old project in `idle` state may upgrade. The one-time Migration Pack converts old governance documents offline, validates the converted canonical Markdown/YAML documents, and only then permits installation of pure vNext. A non-idle project is not upgraded and is left on the old installation until its state is settled. The pack must preserve authoritative facts, report ambiguity, and never invent completion, ownership, recovery, or evidence.

### P-11 — Unsupported schema fails closed

If a vNext entry detects an old or otherwise unsupported protocol/schema, it returns `migration-required` and stops before task execution, state mutation, or partial installation. vNext Skills do not attempt to understand or repair the old protocol.

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

### 4.5 Version boundary

Pure vNext has no compatibility surface for the old Skills. The old names are understood only by the one-time Migration Pack while it converts an idle old project. After vNext installation, an old Skill name or old protocol/schema is not a callable route; schema detection returns `migration-required` and stops.

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

### 5.2 Historical modes mapped only during offline conversion

| Legacy source concept read by Migration Pack | vNext target destination |
|---|---|
| `prepare-task:create` | `prepare-task` intent plus active-owner/task-identity evaluation |
| `prepare-task:review` | task-readiness and resume-review capabilities |
| `prepare-task:scope-lock` | `scope-guard` |
| `prepare-task:classify` | `decision-authority-gate` |
| `prepare-task:plan` | adaptive planning dimension |
| `prepare-task:decompose` | step-shape constraint selected by adaptive depth |
| `prepare-task:orchestrate` | removed; macro route policy owns readiness |
| `execute-step:orchestrate` | removed; macro route policy owns readiness |
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

The Migration Pack may validate the old exact mode set while converting legacy documents, but vNext validation applies only the target mode-admission policy. No vNext Skill or Runtime handler interprets the old stage graph.

### 5.3 Slice B design freeze — task-definition invalidation and replacement

Slice B freezes a same-task identity model. `TASK_ID`, `TASK_SLUG`, and document identity are immutable across supersede/replan. Supersede applies to the current frozen task definition; it does not create a new task or silently choose a new goal, scope, or acceptance.

`blocked_by_replan + active` means execution is unsafe but the evidence, authority, or user-owned decision needed to invalidate the definition is incomplete. It is a non-active owner, so `execute-step`, pause, and interrupt are forbidden; the old definition is not yet formally invalidated. It may return to `active + active` only when authoritative evidence proves the definition remains valid, or move to `superseded + active` when invalidation is confirmed.

`superseded + active` means the old definition is formally invalidated by sufficient authority and evidence. It is a non-active owner, so `execute-step`, pause, and interrupt are forbidden, and it can never be restored as execution authority. Its only normal exit is a successful same-task `prepare-task:replan` commit.

The legal transition matrix is:

| From | Action | To | Required semantic condition |
|---|---|---|---|
| `active + active` | `mark-replan-blocked` | `blocked_by_replan + active` | continuation is unsafe and replan authority/evidence/decision is incomplete |
| `blocked_by_replan + active` | `clear-replan-block` | `active + active` | new authoritative evidence proves the original definition remains valid |
| `active + active` | `supersede` | `superseded + active` | goal, scope, or acceptance is formally invalidated |
| `blocked_by_replan + active` | `supersede` | `superseded + active` | invalidation becomes confirmed |
| `superseded + active` | `commit-replan` | `active + active` | closed replacement definition passes Runtime validation and commit |

`task-lifecycle:supersede` owns the invalidation decision and emits only a typed SupersedeDelta: invalidation kind, reason, evidence references, and partial-diff disposition. It removes execution authority from the old definition, but does not write replacement task facts. `prepare-task:replan` owns context resolution, authority handling, bounded definition formation, and typed ReplanDelta creation. These are two transactions; a blocked replan never rolls back a successful supersede.

Replan is a closed task-definition section replacement. It may replace only the existing sections for context/background, acceptance, Allowed/Conditional/Forbidden scope, affected contracts, decisions/open questions, implementation plan/steps, validation/regression, rollback/recovery, conditional design/release validation, and triggered propagation governance. It must preserve identity, execution history, prior invalidation evidence, partial-diff provenance/disposition, historical findings, applied-proposal/audit history, and other canonical provenance. Old findings retain history but do not inherit repair authority; a still-relevant finding requires fresh finding admission.

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
| installed-version or state-schema mismatch | vNext version gate; return `migration-required` and stop before task execution |

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
  governed_mutation_count: 0
  ephemeral_effects: []
```

Review never writes code or governance state. `governed_mutation_count` covers product source, governance records, queues, registry/install/host surfaces, and other task-owned durable files. Validation may create declared ephemeral cache/build/temp artifacts only under the target side-effect policy. Persisting a finding is a separate admission plus Runtime transaction.

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

The target default is at most **two repair attempts per fingerprint**, at most **three total repair rounds per review cycle**, and at most **one new-finding admission wave during verification**. A repair round is one authorized patch batch followed by verification; multiple already-admitted findings may share a round when their scope and evidence remain separable. Exhausting any applicable budget produces `needs-debug`, `needs-user`, or `blocked`; it never silently starts a new discovery cycle. The existing three-hypothesis root-cause stop rule remains a separate investigation budget.

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

### 10.3 Version gate

`project-context-resolver` may inspect only the canonical schema supported by vNext. If it encounters an old or unsupported protocol/schema, resolution returns `migration-required`; the vNext caller stops and does not convert, repair, or mutate the legacy documents. Knowledge conversion belongs to the offline Migration Pack and is complete before vNext is installed.

## 11. One-time Migration Pack and schema boundary

### 11.1 vNext version boundary

Pure vNext supports only the vNext protocol, File Schema, installation schema, and canonical project-document schema. vNext Skills do not understand the old protocol: they do not parse legacy schemas, resolve legacy Skill names, execute legacy modes, or convert old documents. The Migration Pack is the only component allowed to read the old contract.

> **vNext Skills do not understand the old protocol.**

If a vNext entry detects an old or unsupported schema, the result is:

```text
migration-required
→ stop
```

The stop occurs before task execution, governance-state mutation, or any attempt to repair or reinterpret the old document.

### 11.2 Idle-only upgrade precondition

An old project may upgrade only when its old runtime reports the canonical `idle` state and `CURRENT_TASK.md` has already completed its `close`/`archive` flow. A project with an active task, unresolved finding/repair, paused or interrupted work, pending lifecycle/recovery work, or an ambiguous/unreadable state is not eligible. Recoverable paused or interrupted work is also non-idle and must be settled through the old workflow first. The Migration Pack must reject it without changing the old installation or its governance documents.

The Migration Pack does not close/archive `CURRENT_TASK`, select an owner, invent recovery facts, reset attempts, or turn an unfinished state into `idle`. The old installation remains authoritative until the project reaches `idle` through the old workflow.

### 11.3 Fixed upgrade flow

The upgrade is a single offline conversion followed by a clean vNext installation:

```text
old project in `idle`
        ↓
one-time Migration Pack
        ↓
offline conversion of old governance documents
        ↓
validate the complete converted pack
        ↓
install pure vNext
        ↓
old Skills no longer exist
```

The Migration Pack is not a vNext Skill, not a vNext Runtime handler, and not a compatibility layer. It runs before vNext is installed and is not part of the daily execution surface.

### 11.4 Offline document conversion

The pack reads a declared old protocol/schema and an exact source revision, then mechanically transforms copies of only the following allowed surfaces into the vNext canonical form:

- `CONTRACTS`;
- `DECISIONS`;
- `LESSONS`;
- `STATUS`, `BASELINES`, and other long-term governance documents;
- `TASK` archives;
- workflow schema/version metadata;
- the Skill installation surface.

`CURRENT_TASK.md` is an upgrade precondition, not a migration input. Active findings, finding-repair state, paused packages, interrupted runtime state, and other unfinished lifecycle state are outside the pack scope and make the source project non-idle.

The converted output remains Markdown/YAML canonical knowledge and project truth; temporary mapping objects, reports, and indexes are evidence only.

Conversion must:

- preserve original text, authoritative facts, and provenance;
- mechanically wrap legacy Markdown/YAML in the vNext canonical schema, assign stable document and heading identities, normalize structural paths/references, preserve the original body, and validate the resulting structure;
- preserve unknown target-owned content or report it as an explicit conversion issue rather than overwriting it;
- reject ambiguous identity, conflicting authority, unsupported fields, missing required structural facts, unsafe paths, and frozen/generated-boundary violations;
- produce a complete validated pack before any vNext installation is attempted.

Migration is mechanical structure conversion. It does not require AI to re-understand every historical document and must not guess Lesson-to-symbol applicability, semantic duplicates, semantic tags, or inferred rewrite/merge/supersede decisions. Later vNext retrieval uses the original text through `project-context-resolver`; `knowledge-admission-policy` governs new or explicitly proposed knowledge rather than reclassifying the legacy corpus during migration.

### 11.5 Pure vNext installation

Installation consumes only a validated Migration Pack and the vNext bundle. It installs the vNext protocol/schema, generated references, host surface, and the seven daily intent entries plus their administrative, expert, internal, and Runtime surfaces defined by this architecture.

The installed vNext surface contains no old Skill files, old Skill registry entries, legacy aliases, old-state adapters, or compatibility routes. The old names are not resolvable after installation. Re-running the completed pack must not create a second conversion; the exact replay/no-op behavior is an implementation contract, not a compatibility surface.

### 11.6 Failure and recovery boundary

The pack is fail-closed and all-or-nothing with respect to vNext installation:

- non-idle or ambiguous old state stops the upgrade before conversion is accepted;
- conversion or validation failure leaves the old installation and source documents unchanged;
- vNext installation is forbidden when the pack is incomplete, stale, conflicting, or not bound to the target root and source revision;
- a vNext process that finds an old/unsupported schema returns `migration-required` and stops; it does not fall back to an old Skill because pure vNext has no old Skills;
- no partial vNext host surface, registry state, schema marker, or generated output may be promoted as a successful installation.

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
- `superseded` or `blocked_by_replan` entering `execute-step`, pause, or interrupt;
- restoring `superseded` directly to `active` without a successful `commit-replan`;
- changing task identity during replan or silently creating replacement task facts during supersede;
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

### 13.3 Slice B transaction actions and proposal boundaries

The future task-state transaction catalog contains the closed actions `mark-replan-blocked`, `clear-replan-block`, and `commit-replan`. These actions are contract-only until Slice B implementation; they do not authorize arbitrary active-task rewriting.

The minimum SupersedeDelta shape is:

```yaml
semantic_delta:
  kind: lifecycle
  action: supersede
  invalidation_kind: goal | scope | acceptance
  invalidation_reason: <text>
  evidence_refs: []
  partial_diff_disposition:
    reusable: []
    rollback_required: []
    stop_propagation: []
```

ReplanDelta names a typed replacement of the allowlisted existing task-definition sections and carries the unchanged task identity plus source revision. Arbitrary Markdown heading/path patches, a new task-definition store, a durable replan object, and a second state source are forbidden. Runtime validates the closed schema, source tuple, identity, transition, authority marker, exact section boundary, and atomic read-back; semantic goal/scope/acceptance and disposition decisions remain with the model/user authority layer.

## 14. Target architecture acceptance cases

The following cases define the target behavior:

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
| `TA-12` | A legacy Skill name is encountered during upgrade or installation | only the offline Migration Pack may read it; pure vNext contains no old Skill, alias, or callable compatibility route |
| `TA-13` | Verification repeatedly exposes distinct strong blockers | one bounded new-finding wave is admitted; the cycle-level budget then terminates in `needs-debug`, `needs-user`, or `blocked` instead of restarting discovery |
| `TA-14` | Review or evidence work crosses a session boundary | canonical task/finding records preserve diff target, fingerprints, budgets, claims, and evidence state; a new session cannot reset attempts or widen the test plan from memory |
| `TA-15` | Small bug matches one Contract, one Decision, and one prior Lesson | resolver returns exact relevant locators and excludes unrelated knowledge without weakening precedence |
| `TA-16` | CURRENT_TASK conflicts with a Contract and a newer-looking Lesson | conflict is explicit; Contract wins and the Lesson cannot authorize implementation |
| `TA-17` | A previously recorded pitfall matches the current failure trigger | relevant Lesson is consumed as advisory prevention evidence and the same failed approach is not repeated silently |
| `TA-18` | One-off workaround is proposed as a Lesson | knowledge admission rejects/defer it; no durable knowledge is appended |
| `TA-19` | Equivalent Decision/Lesson candidate already exists | disposition is `merge` or `no-op`; provenance is preserved and no duplicate entry is created |
| `TA-20` | Required context exceeds the configured budget | resolver returns `required-context-exceeds-budget`; it chunks/escalates rather than dropping authoritative context |
| `TA-21` | Idle legacy project enters upgrade | a one-time Migration Pack converts old governance documents offline, validates the complete pack, and then permits pure vNext installation |
| `TA-22` | Legacy project is active, paused, interrupted, unresolved, or ambiguous | upgrade stops as non-idle; old installation/documents remain unchanged and no vNext surface is installed |
| `TA-23` | Offline conversion encounters old task/finding/lifecycle records that are not idle | the pack does not select, resume, close, or guess; conversion is rejected until the old project is idle |
| `TA-24` | A vNext entry detects an old or unsupported schema | result is `migration-required` → stop; no legacy parsing, task execution, or mutation occurs |
| `TA-25` | Converted documents contain target-owned fields or managed drift | valid facts are preserved and drift/ambiguity is reported; conversion never overwrites target-owned content to mimic a fresh install |
| `TA-26` | Offline conversion or pack validation is interrupted | old source documents remain unchanged, the pack is incomplete, and pure vNext installation is forbidden |
| `TA-27` | A completed Migration Pack is presented again | the system does not perform a second conversion or create a partial installation; replay is bound to the original source and target identity |
| `TA-28` | Conversion output lacks required facts or contains conflicting authority | the pack is rejected with explicit blockers; no vNext installation or guessed canonical fact is produced |
| `TA-29` | Pure vNext installation completes | old Skill files, registry entries, aliases, adapters, and host routes are absent and old names are not resolvable |
| `TA-30` | A claim-bound Project Profile validation command creates only declared ephemeral output | command runs with `shell: false` in a disposable clean copy; evidence is bound to claim/diff/context/command revisions, ephemeral output is audited and cleaned, and the live workspace has zero diff |
| `TA-31` | Validation changes a governed sandbox file or escapes into the live workspace | result is `blocked`, the exact unexpected paths and governed mutation count are reported, and disposable cleanup still runs |
| `TA-32` | Validation command grammar, command revision, context revision, target identity, or diff target is unsafe/stale | subprocess does not execute and the mismatch is reported as a blocker; external-documentation and approval evidence also remain outside subprocess authority |
| `TA-33` | A vNext project contains only supported canonical Markdown/YAML schemas | the resolver and entries execute against those schemas without any legacy compatibility branch |
| `TA-34` | A vNext component attempts to fall back to an old Skill or reinterpret an old document | the attempt fails closed with `migration-required` and no governed mutation |

## 15. Success measures

Hard requirements:

- all G-01 through G-18 invariants remain true;
- no historical internal stage is promoted without passing the mode admission rule;
- no internal review or preparation dimension uses an executable public handoff;
- review and validation remain non-mutating;
- validation evidence is bound to exact claims, diff/context/command revisions, audited in a disposable environment, and cannot borrow user or external-documentation authority;
- every persistent test has a traceable owner and claim;
- repair loops terminate by policy;
- every consumed durable knowledge item has an exact locator and relevance reason;
- knowledge candidates deduplicate, preserve provenance, and cannot bypass authority or stability gates;
- Runtime has operation-specific source/write boundaries and no second state source;
- only an old project in `idle` state may enter the one-time Migration Pack flow;
- converted canonical Markdown/YAML documents are validated before pure vNext installation;
- old Skills, aliases, and compatibility routes are absent from pure vNext;
- old or unsupported schemas return `migration-required` and stop.

Soft improvement measures:

- fewer daily visible entries and manual invocations;
- fewer model-visible workflow nodes and handoffs;
- reduced duplicated prompt/policy lines;
- fewer review/repair cycles;
- fewer newly committed tests without acceptance value;
- lower tokens, turns, latency, and maintenance surface;
- equivalent behavior across representative models and harnesses.

No numeric public-entry target or prompt-reduction percentage may weaken a hard requirement.

### 15.1 Architectural counterexamples that must fail

- A README typo still materializes create/review/scope/classify/plan/decompose nodes.
- Unified review automatically admits every issue it notices into the current repair queue.
- A `report-only` pass or failure executes debug, repair, synchronization, or closure.
- Runtime accepts an outdated source revision or model-authored text as user approval.
- The same fingerprint causes an unbounded repair/review loop.
- Tests with no acceptance, contract, bug, invariant, or risk owner are committed until something fails.
- A Runtime handler writes through a broad glob or borrows another operation's valid target.
- Resume selects the “latest” package or leaves two active owners.
- Internal `sync-state` becomes a way to overwrite semantic facts without eligibility evidence.
- Host sync exposes internal capabilities as daily entries or installs any old Skill/alias in pure vNext.
- A task loads all Contracts/Decisions/Lessons without relevance tracing, or silently drops required context to fit a token budget.
- A model observation or one-off workaround becomes a Contract, Decision, or Lesson without authority/evidence/deduplication.
- An upgrade accepts a non-idle old project, guesses unfinished-state facts, or converts old documents inside a vNext Skill.
- A vNext entry continues after detecting an old/unsupported schema instead of returning `migration-required` and stopping.
- Different models or harnesses change authority, stop, owner, or mutation verdicts rather than only cost, wording, or turn count.
- Validation runs through a shell, accepts a stale/unregistered command, writes a governed path, or reports success after an unexpected live/sandbox diff.

## 16. Confirmed design decisions

### 16.1 Confirmed decisions

1. Public entries express intent rather than historical stages, with seven daily intents.
2. Internal preparation/review dimensions do not form an executable handoff chain; capabilities are selected adaptively.
3. Exposure is split into daily, administrative, expert/automation, internal, and Runtime surfaces; old Skills are not a vNext compatibility tier.
4. `review-convergence-policy` and `evidence-admission-policy` become first-class internal capabilities.
5. Review is unified and read-only; finding admission remains separate.
6. Runtime uses a common transaction kernel plus exact typed handlers and canonical sources only.
7. The old protocol is read only by a one-time Migration Pack; vNext has an explicit schema boundary and does not interpret legacy documents.
8. `project-context-resolver` performs relevance/precedence/conflict-aware retrieval; `knowledge-admission-policy` governs durable Contract/Decision/Lesson growth.
9. Only an `idle` old project may upgrade: offline document conversion happens once, then pure vNext is installed and old Skills no longer exist.

### 16.2 Confirmed parameter choices

1. The recommended exposure matrix and entry names are accepted.
2. The proposed explicit target modes and mode-admission rule are accepted.
3. The convergence budget is accepted: two attempts per fingerprint, three total repair rounds, and one verification new-finding wave.
4. The persistent-test admission rule and temporary exploratory-evidence treatment are accepted.
5. The guarded macro transitions in §12.1 may execute automatically only under an authorized end-to-end request and must stop at user-owned authority changes.
6. The common Runtime transaction kernel plus exact typed handlers direction is accepted; exact CLI/API syntax remains deferred.

### 16.3 Deferred implementation details

- Runtime command/API syntax and implementation language details;
- target manifest schema/file layout;
- project-context index/cache implementation and canonical knowledge-document schema details;
- Migration Pack command/package syntax, conversion report layout, and version-number allocation;
- registry and host discoverability mechanics;

## 17. Decision outcome

The accepted target is a pure vNext architecture with seven daily intents, adaptive internal capabilities, unified review and Review Convergence, Evidence Admission, `project-context-resolver`, `knowledge-admission-policy`, a shared Runtime transaction kernel, and Markdown/YAML canonical knowledge. Upgrade is idle-only and one-time: the Migration Pack performs offline conversion of old governance documents, after which pure vNext is installed and old Skills are absent. vNext Skills do not understand the old protocol; an old or unsupported schema returns `migration-required` and stops.
