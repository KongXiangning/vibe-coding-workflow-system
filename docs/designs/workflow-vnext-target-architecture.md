# Workflow vNext Target Architecture

- Phase: `Target Architecture`
- Status: `Accepted final design`
- Date: `2026-09-19`
- Behavior impact: `converges the implemented A–E workflow semantics; no new public entry, lifecycle state, or workflow layer`
- Design references:
  - [`workflow-skill-kmrd-audit.md`](../product/workflow-skill-kmrd-audit.md)
  - [`vibe-governance-distribution-installation.md`](vibe-governance-distribution-installation.md)
  - [`trusted-authority-channel.md`](trusted-authority-channel.md)
  - [`.workflow-system/WORKFLOW_CAPABILITIES.yaml`](../../.workflow-system/WORKFLOW_CAPABILITIES.yaml)
  - [`test/fixtures/workflow-capability-cases.yaml`](../../test/fixtures/workflow-capability-cases.yaml)

## 1. Decision objective

The target architecture consolidates the required governance semantics into a smaller intent surface. Historical Skill names and stage graphs are migration inputs only; they are not part of the vNext execution model.

The target architecture is:

```text
Execution:
user / harness
        ↓
eight daily intent entries
        ↓
adaptive internal governance capabilities
        ↓
typed semantic proposals
        ↓
deterministic Runtime transactions
        ↓
canonical Markdown/YAML knowledge

Legacy migration boundary:
old idle project
        ↓  one-time offline Migration Pack
vNext Distribution installed
        ↓
governance bootstrap remains a separate `bootstrap-project` Agent Skill
transition
```

The target is a smaller user intent surface with fewer model-visible workflow nodes and no loss of boundary, authority, state, evidence, stop, or escalation semantics. The old Skill graph is migration input, not a vNext runtime layer.

## 2. Target architecture boundaries

This target design does not:

- make vNext Skills understand, parse, or execute the old protocol;
- retain old Skills or compatibility aliases in a vNext Distribution;
- make Runtime or a vNext Skill perform legacy-document conversion;
- introduce a second project-truth store beside canonical Markdown/YAML knowledge;
- let an unsupported schema continue into task execution;
- define implementation-specific CLI/API syntax in this architecture document.

The old manifest and governance documents are inputs to the one-time Migration Pack only. A vNext manifest/schema is a new contract and must not silently reinterpret an old schema.

Distribution and governance are separate concerns. The normative installer,
manifest ownership, `uninstalled | legacy | vnext(version)` state model, and
the `Install != Bootstrap` boundary are frozen in
[`vibe-governance-distribution-installation.md`](vibe-governance-distribution-installation.md).

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

Every retained target mode must also declare an independently testable
input/output contract, authority owner, mutation/write boundary,
stop/terminal behavior, at least one regression or evidence scenario, and a
caller-visible reason for existing. A regression or evidence scenario is a
validation obligation, not an automatic admission of a new persistent
automated test; any such test remains governed by P-12. If two proposed modes cannot be distinguished by those properties, they are internal dimensions or parameters rather than modes.

### P-03 — Adaptive depth removes untriggered governance, never mandatory governance

The model or harness may avoid unnecessary planning prose and optional checks, but every mutating task still evaluates source authority, mutation authority, decision authority, evidence admission, and dangerous-operation eligibility. Conditional gates are selected from explicit triggers and their selection is reported. **A fact that was not predicted during planning is not itself a governance trigger.** In Mutation Authority v2, an in-envelope discovery that is assessed as local, private, no-consumer and no-contract-impact may be self-admitted without adding a review checkpoint; shared/public/cross-component/contract-impact or uncertain discoveries retain cumulative review. Engineering-only validation invocation changes may use their bounded replacement route without redefining the evidence obligation. Adaptive depth therefore removes work whose trigger is absent; it never converts a mandatory authority, evidence, lifecycle, review, or repair gate into an optional one.

### P-04 — Internal dimensions do not form a natural-language BPM graph

Internal capabilities may be evaluated together, lazily, or in parallel. They do not hand off to one another as public workflow nodes. Only macro changes in intent, authority, lifecycle, or mutation phase may produce an executable transition.

### P-05 — Review breadth and finding-admission breadth are different

Review may inspect the full risk surface. A discovered issue enters repair only after owner, scope, authority, evidence strength, deduplication, and convergence checks pass.

Draft review and change review have different explicit targets. `prepare-task`
atomically persists an identity-derived `TASK_BASIS-<TASK_ID>.md` containing the
verbatim original request and later explicit user decisions, while
`CURRENT_TASK` links its exact path and revision. `review-draft` compares one
prepared draft with that linked request basis and authoritative context;
`review-change` evaluates one logical implementation diff. Both are read-only,
neither writes a finding queue, and neither invokes another public entry.

### P-06 — Model/user semantic authority must have a bounded execution outlet; Runtime commits

The model and user own semantic judgment and authority. Runtime owns deterministic validation, exact write boundaries, conflict detection, idempotence, atomic commit, and read-back. Runtime cannot promote an unconfirmed proposal into project truth. Semantic authority is not useful if a legitimate decision has no legal transition: the current system therefore has bounded paths for explicit human acceptance, explicit evidence waiver, exact validation-invocation replacement, additive authority amendment, restricted correction/recovery, and an explicitly requested fresh successor after supersede. These paths preserve the original failure/report/history semantics: a waiver is not PASS, a human observation is not automated execution, an engineering replacement cannot change selection, and supersede alone never creates or approves a replacement. Public Skills return recommendations rather than invoking the next public Skill automatically.

For administrative mutations, especially `bootstrap-project:realign`, the
proposal's `authority_evidence` is not a trust root. Human authority must enter
Runtime through the separate Trusted Authority Channel defined in
[`trusted-authority-channel.md`](trusted-authority-channel.md). Runtime Core
remains harness-neutral; unsupported harnesses fail closed. Until a real
trusted provider exists, an Agent may prepare or preview a realign proposal but
may not autonomously commit a mutating realign. A true unchanged zero-write
replay may remain idempotent without a new authority.

### P-07 — Canonical truth remains singular; Task Store is part of the current-task aggregate, not a second truth

Project-level authority remains in the canonical governance sources: Task Basis, `CONTRACTS.md`, `DECISIONS.md`, `STATUS.md`, `LESSONS.md`, Profile, Protocol, Schema, and other admitted task artifacts. For the active task, canonical truth is one aggregate whose fixed head is `CURRENT_TASK.md` and whose exact immutable definition/state material is selected by that head. The task-data store is therefore not an independently editable database and does not gain semantic authority merely because an object exists.

Under compact-v3, `CURRENT_TASK.md` is the active navigation projection and canonical head. Its exact content-addressed definition/state roots select immutable task material; reports, receipts, decisions, and committed transaction history are retained under the same task-data aggregate. The manifest must acknowledge the same roots/source revision, indexes remain rebuildable and non-authoritative, and prepared/orphan/unreferenced objects are not current task truth. Summary/hot fields are checked projections, not a second editable definition. Task Basis and authoritative project documents continue to provide the source basis for requirements and decisions; storing their references or immutable copies does not transfer that source authority to Task Store.

Rendering/compaction preserves complete task semantics. Old inline/compact-v2 tasks are not silently replanned or forced to migrate, and explicit storage migration is representation-only. A normal result write references unchanged definition material rather than copying it into the active projection again. Small `CURRENT_TASK.md` size is a representation goal, not an acceptance gate and not a claim that total history, disk usage, or internal hydration cost is constant.

### P-08 — Legacy understanding belongs only to the one-time Migration Pack

The vNext runtime is not a compatibility runtime. It does not parse old protocol/schema documents, resolve old Skill names, or execute legacy modes. A separate, one-time Migration Pack is the only legacy-aware component; it converts an idle old project offline before the vNext Distribution is installed. The resulting Distribution contains no old Skills or compatibility aliases.

### P-09 — Agent-facing context is relevance-selected and bounded; durable knowledge is admitted by evidence

The system does not load all accumulated governance knowledge or the full task history into every model turn and does not persist every observation. `project-context-resolver` selects relevant canonical project context with source locators, precedence, freshness, and conflicts. `task-context` provides an operation-specific bounded projection, while `task-read`, `file-context`, and `review-read` resolve exact material through revision-bound UTF-8 pages and continuations. Required continuation pages must be completed before the caller treats the context as complete; a compact/store conflict is not permission to fall back to an unbounded `CURRENT_TASK` or history read. Definition reuse is limited to the same visible session and exact task/document/definition revision.

`knowledge-admission-policy` separately admits, merges, supersedes, defers, or rejects candidates for `CONTRACTS`, `DECISIONS`, and `LESSONS` based on authority, stability, novelty, reuse value, and evidence. Relevance selection is not deletion: exact committed task material remains retrievable through the aggregate.

This bounded-context claim is deliberately scoped to the model-facing read protocol. It does **not** claim that every internal canonical-reader integrity check, history hydration, or filesystem operation has bounded total cost. Storage diagnostics also have their own bounded scan budgets; those budgets do not prove the canonical reader itself is constant-cost. Internal hydration/performance remains an implementation/measurement concern rather than a reason to add task-size or history-count gates.

### P-10 — Legacy migration is idle-only and one-time offline

Only a legacy project in `idle` state may enter migration. Here idle means no active current task: an explicit hash-bound historical completion decision and verbatim preservation of declared paused files are supported by the one-time Migration Pack (0.18.0); this does not authorize interrupted execution or open current findings. The one-time Migration Pack converts old governance documents offline, validates the converted canonical Markdown/YAML documents, and only then permits installation of the vNext Distribution. A non-idle project is not migrated and is left on the old installation until its state is settled. The pack must preserve authoritative facts, report ambiguity, and never invent completion, ownership, recovery, or evidence.

### P-11 — Unsupported schema fails closed

If a vNext entry detects an old or otherwise unsupported protocol/schema, it returns `migration-required` and stops before task execution, state mutation, or partial installation. vNext Skills do not attempt to understand or repair the old protocol.

### P-12 — Evidence-first selection targets the minimum-sufficient **whole evidence set**, not metadata completeness or minimum granularity

Validation of a business claim, reuse or execution of an existing test/check, and creation of a new persistent automated test are separate decisions. A claim that needs validation does not automatically require a new test. The model/reviewer first derives the business failure or distinguishing observation from authoritative requirements, selects an independent expected result and the boundary where correctness is actually observable, and then chooses the minimum-sufficient **set** of evidence. Test count, coverage count, target-wide pass count, and “the whole suite is green” are not success criteria by themselves.

Minimum-sufficient applies to total execution breadth and cost, not to forcing every individual invocation to the narrowest available selector. If one broader invocation covers several required observations more cheaply while preserving their real boundaries, or if an explicit user/project/release/contract/risk obligation independently requires that breadth, the broader invocation may be the correct set member. Conversely, a target, broad regression, or E2E run is not admitted merely because it exists, shares a directory, is easy to invoke, ran historically, or adds generic confidence. The applicable breadth authority and source remain explicit; cost advantage is a selection reason, not a new authority type.

When executable tests are useful, focused unit/function-chain checks often provide low-cost evidence for localized rules, real business-flow/integration checks are required when correctness depends on component/persistence/protocol/data-flow boundaries, and E2E is used only when the actual user/system boundary is itself necessary or lower-cost evidence cannot establish the claim. These are evidence choices, not a mandatory ladder: focused is not automatically better than target, E2E is not automatically stronger, and many passing local checks cannot substitute for a missing business-flow observation. Persistent tests are not admitted by default; a new persistent test still requires an explicit owner, a claim it proves, existing-evidence insufficiency, an assertion boundary, failure disposition, and one closed admission basis.

The Runtime enforces what it can know deterministically: claim/slot/check identity, required observation/boundary/granularity/invocation binding, breadth authority, result identity/status, evidence applicability, and completion rules. It does **not** prove that an oracle expresses the correct business semantics or that the selected set is semantically minimal. `prepare-task`, `review-draft`, and `review-change` carry the failure-oriented selection/review behavior; known-defect calibration can verify that selected checks detect specific historical failures. Fresh-Agent selection effectiveness across real target projects remains a dogfood question, not a Runtime guarantee.

### P-13 — Mutation authority controls writes, not understanding

Mutation Authority v2 separates the hard task boundary from implementation
planning. A v2 task explicitly carries `mutation_authority_version: 2` and a
positive `authority_envelope` represented by authorized project domains,
`exact_exceptions`, and task-specific `forbidden` targets. Project domains are
stable mutation-ownership boundaries, not a dependency graph:

```yaml
mutation_authority:
  domains:
    - id: node-rollout
      roots:
        - packages/node-rollout/**
        - packages/node-rollout-tests/**
    - id: rust-rollout
      roots:
        - native/codex-rollout-collector/**
```

Domain IDs are unique. Roots are bounded repository-relative exact paths or
literal `/**` prefixes; cross-domain overlap, traversal, arbitrary globs,
absolute roots, and ambiguous path resolution fail closed. A path that maps
to no domain is `unclassified`; it is not ordinary self-admission material.
Read/discovery may cross any domain to inspect callers, consumers, contracts,
or root cause, but read access never becomes write authority. A write outside
the task envelope is a hard `MUTATION_AUTHORITY_EXPANSION_REQUIRED` decision,
not a generic v1 scope failure.

Each v2 implementation step carries `planned_mutation_targets`. These targets
are guidance for initial direction and planned-vs-actual review; they are not a
second hard writable-file allowlist. A target outside that planned footprint
but inside the task envelope may be admitted when the coding model first
records a blast-radius assessment containing:

```yaml
target: {path: src/internal/state.ts, symbol: normalizeState}
reason: <why the target is needed>
blast_radius:
  locality: local | elevated | high
  visibility: private | shared | public | unknown
  cross_component_consumers: none | present | unknown
  contract_impact: none | possible | known
evidence_refs: [<evidence>]
disposition: self-admit | escalate
```

The Agent owns the semantic judgment; Runtime owns path/domain resolution,
explicit Forbidden and governance boundaries, assessment structure and
binding, first-touch before-state, cumulative audit and review coverage. The
Runtime does not claim to decide whether a shared function is business-correct
and does not use caller-count thresholds. Prefer the smallest correct local
change. A broader shared implementation change needs evidence that the local
alternative would be incorrect, duplicative, or contract-breaking, plus
consumer/regression validation. Uncertain or multiply plausible directions
escalate to the user; a high-risk change can still be self-admitted when the
evidence is sufficient.

Every unplanned self-admission is retained in the execution-scoped expansion record, but review depth is selected from the recorded assessment rather than from “unplanned” alone. A local/private/no-consumer/no-contract-impact self-admission adds no checkpoint by itself; elevated, shared/public, cross-component, contract-impact, uncertain, or escalated material retains cumulative review. If discovery occurs after another path in the same attempt has been touched, `execute-step:extend-preflight` captures the new target's before-state and returns a replacement receipt regardless of review depth. It keeps task, step, attempt and plan identity; it does not consume retry budget, create a continuation, or revise the plan. The latest receipt must feed `record-step-result`. Existing test files inside the envelope follow ordinary assessed expansion and still require oracle/reuse/boundary judgment. An absent new persistent test remains separately blocked until the full P-12 admission is recorded.

Each durable dynamic expansion also records its `step_id`, `plan_revision`,
`change_set_id`, stable `execution_id`, admitting `preflight_id`, and execution
mode. The authority evaluator consumes only expansions matching the current
active step, plan revision, change set, and execution identity. A historical
expansion remains available to audit and review context but cannot authorize a
later step, continuation, or repair wave; the same path therefore receives a
new assessment when it is discovered by a new execution. The persisted
`dynamic_review_required` value is a compatibility projection of the current
execution's unconsumed expansions. A clean review marks only the expansions
bound to that reviewed execution and retains the review id on those records.

All execution entry points use one Runtime-owned exact-target admission
evaluator. `preflight-step`, `extend-preflight`, `begin-repair`, repair
extension, command-footprint preflight, and the result re-check pass the same
task authority envelope, current step, execution phase, persistent-test state,
and governance boundaries to that evaluator. Its result distinguishes planned,
dynamic self-admitted, persistent-test-admitted, authority, assessment,
test-strategy, non-executable-policy, persistent-test, and governance blocks;
an adapter may not substitute a second path policy after state mutation begins.
The evaluator checks structure only: blast-radius truth remains a bounded
coding-model judgment and is retained as evidence.

Every new v2 execution has a stable `execution_id`; an extension changes only
the current receipt token and appends new target preimages. Repair uses the
same execution identity and repair wave, so a same-envelope helper discovered
after the first repair edit can use the same extension without a continuation
or retry-budget consumption. Dynamic-expansion records bind the target to the
step, mode, execution identity, and receipt token. Admission failures are
validated before the extension transaction can change Runtime state.

Test-strategy phase restrictions apply to initial and replacement preflights
equally. Runtime derives a `test-first` Red admission constraint only from the
current step's frozen, unconsumed before-step expected-failure obligation;
candidate filenames and mixed candidate composition cannot change that phase.
Red admits only exact frozen Persistent Tests, including non-typical test
paths, while the receipt's required outcome remains `implemented` and the
expected-failure evidence carries the reproduction proof. A `not-applicable`
task remains closed under discovery: every later target must still match the
project profile's bounded `non_executable_change_paths`, not merely the
original planned targets.

#### Step 3 design closure — authority transition and persistent-test admission

Task authority expansion and persistent-test creation are separate typed
decisions. The authority amendment gate blocks only an execution that has
already been admitted by preflight but has not yet recorded the matching
execution result. A `ready` retry, a blocked result, a settled repair result,
and pending review or findings may proceed through amendment; preservation of
those obligations remains part of the existing immutable continuation
contract. Repair uses the real repair execution identity and its matching
result record, not `active_step_status` or the mere presence of pending review
as a proxy for an outstanding execution.

The existing scope-amendment candidate remains immutable after its
`commit-scope-amendment` audit. Discard checks the committed candidate digest
before creating a discard marker, so history and recovery remain usable.

An absent new persistent test inside an already authorized domain does not
expand authority, but it is not an ordinary dynamic file admission and is not
a no-op. It takes the explicit prepare-task amendment infrastructure with
`authority_diff: none` and a complete caller-provided P-12 record: path,
stable claim IDs, owner and owner source, source reference, closed basis,
existing-evidence insufficiency, assertion boundary, and failure disposition.
Runtime validates, binds, and persists these facts; it never fills defaults.
Ordinary dynamic admission stays blocked until this transition succeeds.
Existing test files continue through ordinary assessed expansion, with review
of oracle, reuse, and boundary impact.

#### Step 4 design closure — planning-time executability and domain lifecycle

Mutation Authority v2 also has a planning-time definition boundary. Before a
draft is committed as confirmed, `prepare-draft`, `update-draft`, replan or
correction, and `confirm-draft` must prove the complete declaration set:
`planned_mutation_targets`, every exact command write, every bounded command
footprint, and every persistent-test path. Each declaration must be inside an
authorized project domain or an exact exception, and must not be Forbidden,
governance-owned, ambiguous, or `unclassified`. Planned targets need no
blast-radius assessment because they are planning facts; the proof is
structural executability, not a second step ACL.

The v2 command grammar is deliberately bounded to exact paths and literal
`literal/path/**` directory-prefix patterns. Runtime proves the candidate
pattern is a subset of one granted domain root directly from the path
relationship. A narrow subdirectory glob is valid under its domain root; a
broader glob is not; an exact exception can authorize one exact path but never
proves a directory-wide glob. Synthetic probe paths are not evidence.

Project ownership is established once through the administrative lifecycle.
`bootstrap-project` inventory observes structure and proposes
`authority_domain_candidates` with basis and evidence. A project owner then
confirms the selected IDs and roots in `greenfield`, `adopt`, or `realign`, and
only that decision promotes the map into `PROJECT_PROFILE.yaml`. A simple
project may confirm one broad application domain, but neither Runtime nor
`prepare-task` may silently infer it or rebuild the map for every task. Existing
confirmed maps are preserved.

The canonical map has a stable revision/digest. A confirmed v2 task stores that
revision in Runtime state; every execution admission compares it with the
current profile. A missing or changed revision fails closed and requires
explicit task authority-domain revalidation. Ordinary correction-replan,
P-12 admission, and exact-path amendment do not rebind the task revision. The
active task never inherits a newly widened project grant. The resulting planning/lifecycle acceptance
cases are: E16–E18 for definition and command proof, E19 for candidate then
owner confirmation, and E20 for stale-map rejection.

Legacy tasks with a missing or version-1 authority marker retain the existing
`Allowed` / `Conditional` / `Forbidden` plus step-hard-scope semantics. v1 is
not silently converted into a domain map. True authority changes (for example
Node → Rust or a new cross-domain exact exception) use the existing immutable
scope-amendment candidate and continuation route; same-domain implementation
discovery does not.

P-13 still covers every repo-local write, including tracked, untracked,
ignored, generated, build, cache, temporary, and helper output. `.gitignore`
is not a scope exemption. Before a known write-capable command executes, its
bounded `expected_write_footprint` is admitted through the canonical v1/v2
evaluator; an unbounded footprint is blocked before execution. Afterward,
caller-supplied `observed_write_paths` are evaluated by the same structural
guard, and an unauthorized observation remains blocked even if cleanup removes
the file. A final Git diff is evidence only, not the write oracle. Without an
OS-level filesystem monitor, the Runtime does not claim complete proof of
transient create/delete history.

### P-14 — One task, admitted steps, and risk-based review checkpoints

A `TASK` is one coherent business intent. It is decomposed into independently verifiable implementation `STEP`s without creating independent tasks merely for complexity, context, or review convenience. Each v1 step executes only after admission of its bounded mutation scope; each v2 step executes inside the task authority envelope with its planned footprint as guidance, and both require the declared evidence. Review is placed at logical or risk boundaries rather than after every step; v2 self-admitted footprint expansion adds cumulative review when the retained assessment shows shared/public/cross-component/contract impact; private local discovery with no consumers or contract impact adds no checkpoint, while old records retain their original review obligation; repair always returns through verification of the same logical diff and admitted finding. Step advancement is a durable typed Runtime state transition after required evidence and any required checkpoint / dynamic review / repair convergence, never a Skill-side edit of `CURRENT_TASK.md` and never a new public `advance-step` or checkpoint mode.

### 3.1 A–D implementation convergence status

The principles above are normative, but implementation confidence is not uniform. The E-stage convergence review distinguishes structural implementation from real-world efficacy:

| Principle | Current implementation status | Remaining limit |
|---|---|---|
| P-01 public intent surface | `aligned-with-known-limit`: eight daily intent entries; administrative/expert entries remain separate; internal Runtime actions do not become public stages | real-user invocation/friction reduction still needs target-project dogfood |
| P-03 adaptive depth | `aligned`: low-risk same-envelope discovery and bounded engineering adjustments avoid unnecessary review/replan while mandatory triggers remain | future dogfood may reveal additional over-governance, but no size/count shortcut is used |
| P-06 semantic authority outlet | `aligned`: explicit human acceptance/waiver, bounded correction, authority amendment, validation replacement, and explicit fresh successor have legal Runtime paths | human/provider identity remains caller-reported where no trusted provider exists |
| P-07 canonical truth | `aligned`: compact-v3 head + selected immutable material form one aggregate; indexes/summary/orphans are not independent authority | total retained history still grows and is not automatically garbage-collected |
| P-09 bounded context | `aligned-with-known-limit`: model-facing context/read APIs are paged and revision-bound | internal canonical hydration/validation cost is not proven bounded |
| P-12 minimum-sufficient evidence | `implemented-dogfood-pending`: structural binding and failure-oriented Skill guidance are implemented; known defects have detection calibration | fresh-Agent selection quality and aggregate cost effectiveness require real dogfood |
| P-13 Mutation Authority v2 | `aligned`: domain envelope is hard authority; planned targets are guidance; in-envelope discovery is assessed; cross-envelope writes require amendment | v1 projects remain on their legacy exact-scope semantics until explicitly migrated/adopted |

The detailed evidence and superseded-rule ledger live in [`vnext-design-convergence.md`](vnext-design-convergence.md). A status of `implemented-dogfood-pending` must not be rewritten as a product-effect PASS merely because the schema and source guards are green.

## 4. Recommended exposure model

The recommended surface distinguishes discoverability from callability. The exact count is not a KPI.

### 4.1 Daily public entries

| Entry | User intent | Explicit target modes | Important boundary |
|---|---|---|---|
| `prepare-task` | Turn a request or existing task into an executable, bounded intent or apply one explicit bounded task decision | `confirm`, `replan`, `amend-scope`; ordinary preparation/refinement is the default entry intent | `replan` is restricted correction/recovery, not a general same-task replacement; `amend-scope` consumes an already explicit additive authority decision; explicit successor preparation remains an internal action under the same entry and creates a fresh draft identity after supersede |
| `review-draft` | Independently compare one prepared draft with its original request and authoritative project context | none | Reads the identity/revision-bound Task Basis linked by `CURRENT_TASK` (exact caller-supplied source only for legacy fallback); returns a portable `clean`, `findings`, or `needs-user` result with zero Runtime or repository writes |
| `execute-step` | Implement the admitted current step | `repair`; ordinary implementation is the default entry intent | `repair` requires an admitted finding or confirmed root cause; governance state writes use Runtime proposals |
| `review-change` | Produce one unified read-only verdict for one diff target or record bounded counterevidence | default only | Every invocation is terminal/read-only with respect to product/governance files; `discovery` and `verification` are review-cycle phases, not public modes |
| `debug-task` | Establish root cause and select an authorized recovery route | `investigate-only`, `resolve` | Debug does not write product code; `resolve` may macro-route to `execute-step:repair` after proof and authority |
| `task-lifecycle` | Perform an explicit ownership/lifecycle transition | `pause`, `interrupt`, `resume-paused`, `resume-interrupted`, `supersede` | Each mode has distinct source tuple, recovery evidence, mutation, and rollback semantics |
| `capture-work-item` | Record work proven unrelated to the active task | none (internal Runtime action: `record`) | Remains record-only; the bound Runtime writes at most one canonical inbox record and cannot promote, switch, or mutate the active task |
| `close-task` | Prove closure eligibility, admit final knowledge, and finish the task | `preview`; ordinary closure is the default entry intent | Closure preparation decides Contract/Decision/Lesson admission; archive is followed by typed reconciliation of admitted knowledge, Lesson, and STATUS; `preview` is terminal and non-mutating |

### 4.2 Administrative entry

| Entry | Intended caller | Recommended target modes | Boundary |
|---|---|---|---|
| `bootstrap-project` | Project owner or setup automation | `design`, `greenfield`, `inventory`, `adopt`, `realign` | These modes remain legitimate because they have different project preconditions, write authority, and stop conditions |

### 4.3 Expert and automation entry

| Entry | Intended caller | Target shape | Boundary |
|---|---|---|---|
| `validate-change` | CI, harness, expert user, or an internal evidence request | One read-only entry with an evidence request; QA type is selected by evidence policy rather than public stage modes | It is callable but need not be promoted as a normal daily Skill; it never owns the whole protocol/project validation model |
| `git-commit` | Expert user, harness, or caller acting on an explicit intended change set | One local commit action; no public modes | It stages only caller-authorized paths, never edits file contents, rewrites history, switches branches, or pushes; it is not a workflow progression stage |

### 4.4 Internal system service

| Entry | Intended caller | Target shape | Boundary |
|---|---|---|---|
| `sync-state` | `prepare-task`, `review-change`, `close-task`, recovery tooling, or diagnostics | Typed semantic deltas routed to Runtime operation handlers | It is not a normal daily Skill. A manual reconciliation surface may exist for recovery, but ordinary users should not sequence sync subcommands |

Implementation clarification: `sync-state` is a logical internal
reconciliation/routing role, not a required standalone Runtime, Skill,
installed service, or state writer. In the current implementation its
responsibilities are fulfilled by caller-local orchestration and the existing
typed Runtime operation handlers. A standalone internal facade is reserved
for a future case where a genuine shared reconciliation/routing requirement
is demonstrated; it must not be introduced for architecture symmetry alone.

### 4.5 Version boundary

Pure vNext has no compatibility surface for the old Skills. The old names are understood only by the one-time Migration Pack while it converts an idle old project. After vNext installation, an old Skill name or old protocol/schema is not a callable route; schema detection returns `migration-required` and stops.

## 5. Mode admission decisions

### 5.1 Modes retained by the target proposal

- `prepare-task:replan` is a restricted, revision-bound correction/recovery route. It preserves total task authority, uses immutable candidates plus explicit confirmation, and is not the general replacement path for an invalidated task.
- `prepare-task:amend-scope` consumes an already explicit additive authority decision (or a complete in-envelope persistent-test admission with no authority diff) and preserves prior obligations/review/budget.
- `prepare-successor` is an internal prepare-task action, not a public mode: after a retained supersede and explicit replacement request it creates a fresh unexecuted draft identity with complete old-obligation disposition and ordinary confirmation.
- `review-draft` has no modes; its separate public identity is justified by a different target, linked request-evidence input, zero-write authority, and terminal review result. Prior review output is never request authority.
- `execute-step:repair` requires an admitted finding or confirmed root cause and consumes a repair budget.
- `review-change` has no report-only public mode in the current source contract; the entry itself is read-only and terminal, and any next route is only a recommendation to the caller.
- `debug-task:investigate-only` and `debug-task:resolve` express different user intent and follow-up authority; neither lets the debug entry edit product code directly.
- lifecycle modes retain different source tuples and recovery contracts.
- `prepare-task:confirm` changes the authority and terminal semantics of a durable ordinary-task draft; it is not a new daily entry.
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
| `task-lifecycle:replan` | no one-call alias; map only to the supported bounded correction/recovery route when its preconditions are provable, otherwise preserve the invalidated predecessor and require an explicit fresh successor request |
| all `sync-state:*` modes | typed Runtime operation kinds |
| `close-task:close` | default `close-task` intent |
| `close-task:summary` / `archive` | internal closure capabilities and Runtime proposal handlers |

The Migration Pack may validate the old exact mode set while converting legacy documents, but vNext validation applies only the target mode-admission policy. No vNext Skill or Runtime handler interprets the old stage graph.

### 5.3 Slice B convergence — invalidation, restricted correction, and explicit successor

The current implementation no longer treats supersede as the first half of a general same-task replacement. `TASK_ID`, `TASK_SLUG`, and `document_id` remain immutable for ordinary draft refinement and restricted same-task correction, while an explicitly requested successor after a genuine supersede receives a **fresh** task/document identity. Supersede only invalidates execution authority and preserves unfinished obligations/history; it never supplies replacement task facts.

`blocked_by_replan + active` remains a non-active owner used when continuation is unsafe and the required evidence/decision is unresolved. It may clear back to `active + active` when authoritative evidence proves the original definition remains valid, or it may be superseded when invalidation is confirmed. `superseded + active` is also a non-active owner and cannot execute, pause, interrupt, or be overwritten by ordinary `prepare-draft`.

The old one-call `replan` and direct caller-provided `commit-replan` are closed. Same-task correction uses the versioned `correction-replan/v2` candidate/receipt flow: `prepare-replan` records bounded challenge/recovery targets and leaves `CURRENT_TASK` unchanged; `confirm-replan` requires the exact candidate and explicit caller-reported decision before Runtime internally commits the typed replacement. It preserves task identity, total authority, executed definitions/history, prior obligations and review/budget lineage. It cannot silently change goal, permission scope, arbitrary claims/check methods, or completed history. A superseded task may use this restricted route only for the specifically supported acceptance-result correction with explicit `reactivate_superseded` authority; goal/scope invalidation cannot be repaired by that escape hatch.

A genuine replacement after supersede uses the separate `prepare-successor` action only when the user explicitly requests replacement. The caller binds the exact predecessor source/Basis plus every old slot/open finding as carry-forward or retired with reason. Runtime retains the old task as superseded, prepares a new Task Basis and aggregate with fresh task/document identity, and publishes an unexecuted `draft + active`. The successor receives no inherited PASS, waiver, preflight, or completion; it must pass normal `confirm-draft`. Exact interrupted publication may retry/adopt identical prepared artifacts, but different bytes or identities conflict.

Authority expansion is independent of both routes. A v2 path outside the task envelope uses `prepare-task:amend-scope` after explicit additive authorization; a low-risk path already inside the envelope uses assessed `extend-preflight`; an engineering-only read-only validation launcher change uses `replace-validation`. None of these are reasons to supersede or rewrite the whole task.

The legal high-level transitions are therefore:

| From | Action | To | Required semantic condition |
|---|---|---|---|
| `active + active` | `mark-replan-blocked` | `blocked_by_replan + active` | continuation is unsafe and the bounded recovery/invalidation decision is incomplete |
| `blocked_by_replan + active` | `clear-replan-block` | `active + active` | authoritative evidence proves the original definition remains valid |
| `active + active` or `blocked_by_replan + active` | `supersede` | `superseded + active` | goal, scope, or acceptance is formally invalidated |
| eligible active/blocked task | `prepare-replan` → `confirm-replan` | `active + active` with bounded correction/recovery step(s) | exact challenge/recovery candidate, unchanged total authority, explicit confirmation |
| eligible superseded task | restricted `confirm-replan` | `active + active` | acceptance-result invalidation only, exact candidate, explicit `reactivate_superseded`; goal/scope invalidation is excluded |
| `superseded + active` | explicit `prepare-successor` | predecessor stays superseded; new identity is `draft + active` | explicit replacement request + complete old-obligation disposition; new draft still needs normal confirmation |


### 5.4 Slice C design freeze — ordinary new-task draft and explicit confirmation

Slice C adds the ordinary independent-task boundary without adding a public
entry. A request is first prepared into a durable draft, and only an explicit
confirmation may grant execution authority:

```text
closed + archived baseline
  → prepare-task (default / create-draft)
  → new TASK_ID + TASK_SLUG + document_id, draft + active
  → prepare-task (default / update-draft)*
  → prepare-task:confirm (confirm-draft)
  → active + active
  → execute-step
```

`draft + active` is an active-owner tuple for exactly one canonical
`CURRENT_TASK.md`. It is durable, identity-materialized, refinable, and
non-executable. A new draft may be created only from the single
`closed + archived` current baseline; the Runtime allocates/validates the next
unused identity from canonical task artifacts and the proposal supplies a fresh
document identity. The bootstrap `TASK-000` baseline is the one permitted
closed baseline without a prior task archive. Any non-bootstrap closed task
must have its exact identity-derived archive and all required post-archive
reconciliation (STATUS reconciliation receipt, and admitted Lesson persistence
if `lesson_admission: admit`) before a new draft can replace the live terminal record;
otherwise creation fails closed with `PREVIOUS_TASK_RECONCILIATION_INCOMPLETE`.
Ordinary drafts enforce strict step admission (purpose, mutation scope, required
evidence, and review checkpoint policy with boundary when required on all steps)
and must begin at the first admitted implementation step.

Repeated ordinary preparation against `draft + active` is an `update-draft`
typed task-state action. It preserves `TASK_ID`, `TASK_SLUG`, and `document_id`,
replaces only the closed task-definition sections, sets the admitted draft
step to `ready` at the first admitted step, and preserves execution/audit/provenance history. It cannot
create a second task, change the owner tuple, auto-confirm, or apply an
arbitrary Markdown patch.

`prepare-task:confirm` is the only draft-to-active route. Its typed
`confirm-draft` proposal repeats the identity and carries the exact current
draft `source_tuple.revision` as `draft_revision`. It requires explicit
`user-confirmation` or `authorized-caller` authority binding current `task_id`,
`document_id`, and `draft_revision` plus claim-bound evidence.
Runtime validates the complete current draft definition, rejects unresolved
user-owned questions or authority conflicts, and fails closed on stale source
revision, identity drift, malformed sections, replay mismatch, or an invalid
tuple. Confirmation changes only the workflow status to `active`; it does not
silently alter task definition, step identity, scope, or history.

The closed task-state action set for this slice is
`create-draft`, `update-draft`, and `confirm-draft`, all within the existing
`task-state-transaction`. There is no generic Runtime editor, draft registry,
catalog, queue, cancellation/discard state, or second canonical task source.

### 5.5 Successful close-task terminal semantics

The successful terminal tuple is `closed + archived`: `closed` is the workflow
status meaning the task completed and no longer owns execution, while
`archived` is the lifecycle state meaning terminal archive was entered.
`completed` remains an `active_step_status` value, not a workflow status. The
only successful route is `active + active` → closure eligibility →
`archive-transaction` → `closed + archived`; suspended/paused/interrupted,
`blocked_by_replan`, `superseded`, and `draft` cannot use it.

`archive-transaction` exclusively and atomically writes the preserved
`CURRENT_TASK.md` plus the exact identity-derived task archive. It rolls both
paths back to pre-close `active + active` on any write, integrity, or read-back
failure. Closure preparation evaluates Contract/Decision/Lesson admission before
archive. After a successful archive, admitted Contract/Decision candidates use
the typed `contract-candidate-commit` / `decision-record-transaction` handlers;
the existing optional Lesson and STATUS reconciliation use their own typed
handlers. Neither downstream knowledge, STATUS, nor Lesson failure rolls back
the archive. A `closed + archived` close-task re-entry is reconciliation-only
after matching archive receipt/provenance validation: archive is not repeated,
semantic admission is not re-run, and only incomplete durable records may be
written. Any archive or knowledge provenance mismatch fails closed. Close-task
has no close-specific task-state transaction, pending closure state, closure ID,
or independent durable `TASK_SUMMARY.md` output. The archive durably records
the complete Contract/Decision admission bundle in `## 知识晋升` and the
`lesson_admission.decision` (`admit | defer | no-op`), `candidate_refs`, and
`evidence_refs` in `## Lessons 回写`. These sections are admission provenance,
not proof that downstream governance files were written; no pending-state
artifact exists.

## 6. Adaptive capability selection

### 6.1 Mandatory evaluations

These evaluations always occur for a mutating task, though a low-risk case may resolve them with minimal evidence:

| Capability | Required output |
|---|---|
| source authority | authoritative sources read, conflicts, and unresolved facts |
| project context | relevant Contracts, Decisions, Lessons, Profile, task state, and exact source locators; excluded or conflicted knowledge remains visible in the resolution trace |
| task identity / active owner | current owner tuple and whether this request may mutate it |
| scope | separate read / discovery context, exact mutation boundary, and any evidence-based widening requirement |
| decision authority | mechanical / taste / user-owned decisions and unresolved blockers |
| evidence admission | claims being proved, their owners/certainty, minimum-sufficient evidence, and the separate persistent-test decision |
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

### 6.4 Combined daily execution semantics

The three frozen principles compose into one lightweight daily model:

```text
prepare-task
  → business goal / acceptance claims
  → sufficiently broad read context
  → precise mutation scope
  → a small set of independently verifiable steps
  → claim-bound evidence plans
  → persistent-test admission only when explicitly justified
  → review checkpoints only at risk / logical boundaries
        ↓
execute-step(current admitted step)
  → read wider context when needed, write only admitted scope
  → minimum-sufficient evidence
      ├─ no required checkpoint and no expansion whose assessment requires review → durable advancement to the next admitted step
      └─ required checkpoint / final review / risk-selected elevated-or-uncertain v2 expansion → review-change
          ├─ clean → durable advancement
          └─ admitted finding → execute-step:repair
                                → review-change verification
                                → clean / bounded stop
        ↓
close-task when the complete task is eligible
```

`execute-step` never advances by model intention alone and never performs another
step as a convenience. A step is complete only after its required evidence is
satisfied. A required checkpoint must produce the qualifying `review-change`
verdict / evidence before advancement; an admitted finding must converge through
repair and verification first. The checkpoint is an internal task-definition
policy fact, not a public mode or a new BPM stage.

## 7. Unified review architecture

`review-change` consumes one Runtime-recorded change set plus a verifiable file-manifest target and produces one verdict. It does not expose its dimensions as a handoff chain.

### 7.1 Review input

```yaml
review_request:
  change_set_id: <runtime-owned-stable-id>
  review_target:
    kind: runtime-file-manifest/v1
    revision: <sha256>
    entries: [<path-state-and-content-digest>]
  cycle_phase: discovery | verification
  acceptance_claims: [<claim-id>]
  admitted_fingerprints: [<finding-fingerprint>]
  change_risk_profile: minimal | standard | guarded
  execution_policy: normal | report-only
```

### 7.2 Review dimensions

Always evaluated:

- change-set identity and review-target validity;
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
  change_set_id: <same-runtime-owned-id>
  review_target_revision: <same-verified-manifest-revision>
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

### 7.4 Review checkpoint policy

`review-change` is invoked at a required review checkpoint, for a v2 dynamic
footprint expansion, at final review when the task policy requires it, or for
repair verification. It is not invoked merely because a step exists. Checkpoints
are favored for contract / API, data model / schema, IPC / protocol, lifecycle /
ownership / state-machine, security / permission, destructive or high-risk,
release / rollback, major UI behavior, broad propagation, and task-specific
critical-invariant boundaries. Low-risk mechanical steps may continue after
minimum evidence without a full review when no expansion whose retained assessment requires dynamic review is pending. A local/private/no-consumer/no-contract-impact self-admission does not add a checkpoint merely because it was discovered after planning.

This policy changes review timing, not the read-only boundary or the existing
`discovery` / `verification` cycle phases. In particular, repair verification
remains mandatory even when ordinary step review is skipped.

## 8. Review convergence policy

### 8.1 Review-cycle phases

- `discovery`: inspect the admitted breadth and establish the initial finding set.
- `verification`: verify admitted fingerprints and impacted gates after repair; it is not permission to restart unlimited discovery.

`verification` is required after an admitted repair and uses the same logical diff
target. It is not optional merely because the repair was small.

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
       └─ user/scope/contract decision  → ask-user / amend-scope / successor / bounded correction as applicable
```

The target default is at most **two repair attempts per fingerprint**, at most **three total repair rounds per review cycle**, and at most **one new-finding admission wave during verification**. A repair round is one authorized patch batch followed by verification; multiple already-admitted findings may share a round when their scope and evidence remain separable. Exhausting any applicable budget produces `needs-debug`, `needs-user`, or `blocked`; it never silently starts a new discovery cycle. The existing three-hypothesis root-cause stop rule remains a separate investigation budget.

Each review invocation terminates with one observable verdict from `clean`, `findings`, `needs-evidence`, `blocked`, `needs-user`, or `needs-debug`; it cannot continue merely because a reviewer can imagine another test or cleanup. `findings` means admitted findings must be routed to an authorized repair or deferral decision, while `needs-evidence` suspends the conclusion until the named claim-bound evidence is supplied. Neither verdict silently starts another discovery or repair cycle.

### 8.6 Persistence boundary

Review-cycle state may remain ephemeral only while no cross-turn or cross-session handoff occurs. Before repair, pause, interruption, delegation, or session end, the logical diff target, cycle phase, admitted fingerprints, attempt counters, remaining budget, and evidence revision must be proposed into the existing canonical task/finding records through Runtime. Conversation memory and a facade-local cache are not authority. The current Runtime persists this durable boundary in the existing canonical task/finding/review state, including `runtime_state.review_cycle`; no parallel review database or future shadow task schema is required.

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

The claim model identifies what is being proved; it does not itself admit a new
persistent test. Evidence planning must first consider existing evidence and
claim-appropriate real behavior.

### 9.2 Evidence-plan decision

The evidence planner decides:

- whether new evidence is needed;
- the minimum sufficient evidence type;
- whether an existing test/check can be reused;
- whether a new persistent test is allowed;
- whether evidence is temporary exploration rather than a product contract;
- which failure routes to repair, debug, bounded correction, authority amendment, successor preparation, or user decision.

Validation and new persistent-test creation remain separate outputs. A docs-only
or governance-only wording change defaults to zero new persistent tests.

An exploratory probe also declares a bounded duration, tool/run count, permitted temporary artifact locations, and cleanup/audit rule. Harness-level timeouts may enforce the budget, but they cannot silently turn an exhausted probe into sufficient evidence.

Evidence types include static proof, existing regression, focused test, integration smoke, browser/session check, visual evidence, real-device evidence, external documentation, release health/canary, and explicit human acceptance.

### 9.3 Persistent-test admission

A new committed test is not admitted by default. It may be written only when the
admission record supplies all of the following:

- an explicit owner;
- one closed admission basis: `acceptance`, `regression`, `critical-invariant`, or `critical-risk`;
- a named claim or failure it proves;
- a concrete reason existing evidence is insufficient;
- an assertion at the behavioral / contract boundary rather than incidental implementation detail;
- a clear expected disposition if the test fails.

Confirmed acceptance, an existing Contract, a reproduced bug, a hard invariant, or
a concrete changed-behavior risk may supply the owner and evidence, but none is an
admission basis by itself until it is classified into the closed four-value set.
`risk-analysis` is valid only when it is anchored to an identified changed
behavior, known failure model, and admitted task scope. A model-generated
hypothetical by itself is not an owner or admission.

If certainty is `provisional` or `exploratory`, the harness may run temporary probes,
but it must not silently commit them as permanent contract tests. `owner_source:
none` means no new persistent test by default. An explicit user no-test instruction
sets `test_write_policy: deny`; existing validation remains allowed, but no new
persistent test may be written. An authoritative Contract that independently
requires a test creates an authority conflict that must be reported rather than
silently overridden.

When an evidence plan must survive a turn, session, delegation, pause, or interruption, its claim identity, owner, certainty, admitted evidence types, and completion state are persisted through a typed proposal into an existing canonical task record. Harness memory alone cannot reset or widen the plan.

### 9.4 Anti-inflation rules

- Reuse existing evidence before creating a new test.
- Add the smallest evidence that closes the named gap.
- Do not generate combinatorial tests for hypothetical behavior without an owner.
- Do not treat code modification, coverage, robustness, helper branches, mock-call counts, or a speculative edge as a persistent-test admission basis.
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
  implementation_anchors:  # optional, observed navigation hints only
    coverage: observed | verified-scope
    source_revision: <workspace revision>
    anchors:
      - path: <safe repository-relative path>
        symbol: <optional stable symbol>
        role: <bounded role>
        evidence_refs: []
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

For ordinary task closure, Contract and Decision candidates are admitted during
closure preparation, persisted as archive provenance, and then committed to
`CONTRACTS.md` / `DECISIONS.md` only through the close-task-bound typed Runtime
handlers. `implementation_anchors` are optional observed navigation hints,
normally limited to zero through five high-value paths/symbols. They are not a
dependency graph, completeness claim, mutation authority, or freshness source.
Consumers first validate each anchor against the current workspace, then use it
as a search seed and expand to references, callers, imports, consumers,
implementations, types, protocol/schema relations, configuration, generated
surfaces, and tests according to risk and `adaptive-depth-policy`. A missing or
stale anchor is marked unresolved and triggers broader live search; it does not
make historical anchor text authoritative and does not require an unconditional
full-repository scan.

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

The durable Lesson marker follows the same fail-closed canonical boundary.
`vnext-lesson-marker/canonical-v1` is the first supported durable Lesson marker
contract under the current `schema_version: 1` boundary. The marker has no
independent version field: persisted markers omit `disposition`, and reused
markers carry an exact four-coordinate `reused_candidate`. Runtime validation
uses one shared Candidate Identity validator and rejects non-canonical shapes,
unknown fields, missing fields, and invalid disposition values without guessing
or silent reinterpretation. If a future released supported durable schema
changes incompatibly, an explicit schema-evolution / offline-migration boundary
must be defined before ordinary readers accept that shape.

### 11.2 Idle-only legacy-migration precondition

An old project may migrate only when its old runtime reports the canonical `idle` state and `CURRENT_TASK.md` has already completed its `close`/`archive` flow. A project with an active task, unresolved finding/repair, paused or interrupted work, pending lifecycle/recovery work, or an ambiguous/unreadable state is not eligible. Recoverable paused or interrupted work is also non-idle and must be settled through the old workflow first. The Migration Pack must reject it without changing the old installation or its governance documents.

The Migration Pack does not close/archive `CURRENT_TASK`, select an owner, invent recovery facts, reset attempts, or turn an unfinished state into `idle`. The old installation remains authoritative until the project reaches `idle` through the old workflow.

### 11.3 Fixed legacy migration flow

Legacy migration is a single offline conversion followed by a clean vNext Distribution installation:

```text
old project in `idle`
        ↓
one-time Migration Pack
        ↓
offline conversion of old governance documents
        ↓
validate the complete converted pack
        ↓
install vNext Distribution through the explicit `migrate` boundary
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

`CURRENT_TASK.md` is a migration precondition, not a hot-migration input. Active findings, finding-repair state, interrupted runtime state, and other active lifecycle state are outside the pack scope and make the source project non-idle. As of 0.18.0, an explicit identity/hash-bound completion decision may admit a historical completed CURRENT_TASK format. Explicitly listed paused packages may remain at their original paths byte-for-byte; they are not converted, completed, or made directly resumable by vNext. The receipt retains their unresolved provenance. Their later interpretation requires a separate user request and a normally confirmed vNext plan.

The converted output remains Markdown/YAML canonical knowledge and project truth; temporary mapping objects, reports, and indexes are evidence only.

Migration completion includes usable current workflow guidance and validation configuration, not only software read-back. Pack v3 keeps historical Markdown bodies verbatim and normalizes references only in indexes. Explicit current guidance/profile projections preserve their source in hash-bound backups and declare that their current body was revised. Host guidance changes are restricted to workflow-system sections; product constraints and private Skills remain target-owned. All prefixed legacy workflow-system Skill directories across `.agents`, `.codex`, and `.claude` are included in the same atomic deletion and rollback boundary. This does not introduce re-migration of an already-vNext target.

Conversion must:

- preserve original text, authoritative facts, and provenance;
- mechanically wrap legacy Markdown/YAML in the vNext canonical schema, assign stable document and heading identities, normalize structural paths/references, preserve the original body, and validate the resulting structure;
- preserve unknown target-owned content or report it as an explicit conversion issue rather than overwriting it;
- reject ambiguous identity, conflicting authority, unsupported fields, missing required structural facts, unsafe paths, and frozen/generated-boundary violations;
- produce a complete validated pack before any vNext installation is attempted.

Migration is mechanical structure conversion. It does not require AI to re-understand every historical document and must not guess Lesson-to-symbol applicability, semantic duplicates, semantic tags, or inferred rewrite/merge/supersede decisions. Later vNext retrieval uses the original text through `project-context-resolver`; `knowledge-admission-policy` governs new or explicitly proposed knowledge rather than reclassifying the legacy corpus during migration.

### 11.5 vNext Distribution installation

The accepted architecture is distributed through the separate `Vibe Governance`
Distribution Boundary. A fresh Distribution install writes only explicitly
manifest-owned software: the vNext protocol/schema, the project-local Runtime,
immutable target-local Bootstrap support, Runtime contracts, and the canonical
`.agents/skills/<skill-name>/SKILL.md` surface. It does not bootstrap project
facts or install `CURRENT_TASK.md`.

Legacy conversion continues to consume a validated Migration Pack and the
vNext bundle; that Pack may promote converted governance documents and its
canonical task baseline as part of the explicit migration transition.

Bootstrap consumes the installed Distribution and its immutable target-local
support as read-only software prerequisites. The `bootstrap-project` Agent
Skill calls the target-local support preparation entry, which forms a typed
governance proposal; the project-local Runtime validates, commits, and reads it
back. Bootstrap establishes or reconciles project governance assets only; it
does not regenerate, promote, or receipt-own the Runtime, Protocol, Schema,
Bootstrap support, or canonical Agent Skill surface. Distribution upgrades
therefore do not make Bootstrap governance provenance stale.

Source-side development/release orchestration and the installed target-local
entry share one Bootstrap preparation core for classification, mode admission,
rendering, scope preparation, receipt construction, and migration-provenance
behavior. The source facade may add source-repository and legacy-surface
validation, but it does not maintain a second planner. A completed migration is
admitted through the shared read-only provenance verifier; a later explicit
`realign` may coexist with that migration provenance and creates only a
Bootstrap-owned receipt.

The source-side Bun bootstrap facade remains a development/release
orchestrator. A fresh installed target does not need the workflow-system source
repository, Bun, `WORKFLOW_SYSTEM_ROOT`, or source-side generation/sync/pack
commands to invoke `$bootstrap-project`.

The installed vNext surface contains no old Skill files, old Skill registry entries, legacy aliases, old-state adapters, or compatibility routes. The old names are not resolvable after installation. Re-running the completed pack must not create a second conversion; the exact replay/no-op behavior is an implementation contract, not a compatibility surface.

### 11.6 Failure and recovery boundary

The pack is fail-closed and all-or-nothing with respect to vNext installation:

- non-idle or ambiguous old state stops migration before conversion is accepted;
- conversion or validation failure leaves the old installation and source documents unchanged;
- vNext installation is forbidden when the pack is incomplete, stale, conflicting, or not bound to the target root and source revision;
- a vNext process that finds an old/unsupported schema returns `migration-required` and stops; it does not fall back to an old Skill;
- no partial vNext Agent surface, registry state, schema marker, or generated output may be promoted as a successful installation;
- Distribution state is classified only as `uninstalled`, `legacy`, or `vnext(version)`; `pure vNext` is descriptive surface terminology, not a project state;
- `.agents/skills/<skill-name>/SKILL.md` is the canonical vNext Skill surface; `.codex/skills/`, `.claude/skills/`, and `.factory/skills/` remain legacy/source compatibility only.

## 12. Macro transition policy

### 12.1 Permitted macro routes

| From | To | Automatic only when |
|---|---|---|
| `prepare-task` result state `ready` | default `execute-step` intent | the original request authorizes implementation and no user-owned gate remains |
| `execute-step` result state `change-ready` | default `review-change` intent | the diff target is explicit and review is read-only |
| admitted mechanical finding | `execute-step:repair` | owner/scope/authority/root-cause and repair-budget gates pass |
| lifecycle resume success | `prepare-task` readiness review | recovery package and active-owner transaction succeeded |
| `closed + archived` baseline | default `prepare-task` | the request is genuinely independent and identity allocation plus draft definition are complete |
| `draft + active` | default `prepare-task` refinement | the same draft identity is preserved and only typed task-definition sections change |
| `draft + active` with explicit confirmation | `prepare-task:confirm` → default `execute-step` | current draft revision, identity, authority, evidence, and definition checks pass |
| review evidence request | `validate-change` expert call | the evidence plan names the claim and validation remains read-only |
| closure intent with satisfied gates | `close-task` Runtime proposals | acceptance, evidence, release, and remaining-risk rules pass |

An “automatic” route is execution permission, not merely a recommendation. If user intent did not authorize end-to-end work, or the next route changes user-owned authority, the system reports the recommended route and stops. A separate `debug-task` invocation is terminal and reports a route rather than automatically entering another public Skill: a confirmed same-plan blocked check may recommend ordinary `execute-step` recovery; admitted review findings may recommend `execute-step:repair`; a real additive authority decision may recommend `prepare-task:amend-scope`; a superseded task may recommend a fresh successor only after an explicit replacement request. `blocked_by_replan` requires the bounded readiness/correction/invalidation decision and cannot execute. Only confirmed goal, scope, or acceptance invalidation permits `task-lifecycle:supersede`; supersede itself never authorizes replacement. A failed Runtime retry or an ordinary test/code error does not establish invalidation.

### 12.2 Forbidden handoff patterns

- `create → review → scope → classify → plan → decompose` as executable public nodes;
- `scope-review → implementation-review → contract-review` as executable public nodes;
- review directly editing or repairing;
- validation failure synchronizing success-shaped task state;
- finding discovery entering repair before admission;
- resume entering implementation before readiness review;
- `draft + active` entering `execute-step` without a successful `prepare-task:confirm` Runtime commit;
- draft refinement changing identity, creating a second current task, or silently confirming;
- `superseded` or `blocked_by_replan` entering `execute-step`, pause, or interrupt;
- restoring `superseded` directly to `active` except through the explicitly supported, confirmed acceptance-result correction path;
- using general same-task replan to overwrite a genuinely invalidated superseded task;
- creating a successor without an explicit replacement request, complete predecessor-obligation disposition, fresh identity, and ordinary draft confirmation;
- silently creating replacement task facts during supersede;
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

Concrete command/API syntax is implemented by the current Runtime/Distribution contracts but is intentionally non-normative at this architecture layer.

### 13.3 Current task-evolution actions and proposal boundaries

The task-state transaction catalog still contains `mark-replan-blocked`, `clear-replan-block`, and an internal `commit-replan` action for durable compatibility and typed publication. **Direct** caller-provided `commit-replan` is rejected with `REPLAN_CONFIRMATION_REQUIRED`; the supported same-task path is the versioned `prepare-replan` candidate followed by exact `confirm-replan`. Runtime derives the internal commit from the inspected candidate/receipt and explicit decision. This preserves the existing typed transaction/audit format without reopening a generic active-task editor.

`correction-replan/v2` is intentionally permission-preserving. It binds the old source/Basis/plan, complete obligation mapping, challenge or recovery targets, any bounded pending-step replacement, evidence objects and optional artifact restore plan. It uses new identities for replacement checks/steps, retains executed definitions and history, and cannot widen total authority. Candidate preparation is non-mutating; confirmation revalidates the exact current source and candidate before atomic publication.

`prepare-task:amend-scope` uses a separate `scope-amendment-candidate/v1` path for explicit additive authority (or an in-envelope absent persistent-test admission with `authority_diff:none`). It preserves pending review/findings/obligations/review baseline and used budgets instead of reusing correction-replan as a generic scope editor.

`task-lifecycle:supersede` remains a lifecycle transaction that records invalidation and removes execution authority only. Fresh replacement is published by the dedicated `prepare-successor` path with a new task/document identity and retained predecessor snapshot/Basis/history. It is not represented as an internal `commit-replan` on the old task.

The current boundaries intentionally separate four different intents: same-plan execution recovery, same-task conclusion correction, additive authority amendment, and fresh replacement after invalidation. A generic Markdown patch, arbitrary same-task replacement, or “supersede then overwrite” transaction is forbidden.


### 13.4 Slice C task-state actions and proposal boundaries

Slice C keeps the existing `task-state-transaction` operation and adds the
closed action set `create-draft`, `update-draft`, and `confirm-draft`.
`create-draft` and `update-draft` use `prepare-task` with ordinary `default`
mode; `confirm-draft` uses the explicit `prepare-task:confirm` mode. The
proposal carries a canonical source tuple, typed draft identity/definition,
authority evidence, claim-bound evidence, an idempotency key, and exactly the
canonical `CURRENT_TASK.md` write target.

`create-draft` accepts only `closed + archived`, allocates the next unused
identity without consulting a registry, creates a fresh document identity, and
atomically renders a new `draft + active` canonical document. `update-draft`
accepts only `draft + active`, preserves identity and all non-definition
provenance, and replaces the explicit allowed task-definition sections.
`confirm-draft` accepts only `draft + active`, requires the proposal's
`draft_revision` to equal the exact current source revision, and transitions to
`active + active` only with explicit user/authorized-caller authority and no
unresolved confirmation blocker. All three use the common Runtime validation,
single-writer source-revision conflict check, idempotence/replay, atomic
commit, rollback, and read-back boundary. `execute-step` and finding admission
continue to reject `draft + active`; no action auto-confirms a draft.

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
| `TA-07` | Confirmed contract regression | a focused persistent test is admitted only with an explicit owner, claim, insufficiency reason, and one closed admission basis |
| `TA-08` | Unconfirmed product behavior guess | temporary exploration may run; no permanent test or implementation contract is created |
| `TA-09` | Runtime proposal uses a valid path assigned to the wrong operation | operation-specific handler rejects it before mutation |
| `TA-10` | Interrupted task resumes | atomic restore succeeds, then macro-routes to readiness review rather than implementation |
| `TA-11` | CI requests regression evidence | `validate-change` is callable without appearing as a required daily user step |
| `TA-12` | A legacy Skill name is encountered during migration or installation | only the offline Migration Pack may read it; the vNext Distribution contains no old Skill, alias, or callable compatibility route |
| `TA-13` | Verification repeatedly exposes distinct strong blockers | one bounded new-finding wave is admitted; the cycle-level budget then terminates in `needs-debug`, `needs-user`, or `blocked` instead of restarting discovery |
| `TA-14` | Review or evidence work crosses a session boundary | canonical task/finding records preserve diff target, fingerprints, budgets, claims, and evidence state; a new session cannot reset attempts or widen the test plan from memory |
| `TA-15` | Small bug matches one Contract, one Decision, and one prior Lesson | resolver returns exact relevant locators and excludes unrelated knowledge without weakening precedence |
| `TA-16` | CURRENT_TASK conflicts with a Contract and a newer-looking Lesson | conflict is explicit; Contract wins and the Lesson cannot authorize implementation |
| `TA-17` | A previously recorded pitfall matches the current failure trigger | relevant Lesson is consumed as advisory prevention evidence and the same failed approach is not repeated silently |
| `TA-18` | One-off workaround is proposed as a Lesson | knowledge admission rejects/defer it; no durable knowledge is appended |
| `TA-19` | Equivalent Decision/Lesson candidate already exists | disposition is `merge` or `no-op`; provenance is preserved and no duplicate entry is created |
| `TA-20` | Required context exceeds the configured budget | resolver returns `required-context-exceeds-budget`; it chunks/escalates rather than dropping authoritative context |
| `TA-21` | Idle legacy project enters migration | a one-time Migration Pack converts old governance documents offline, validates the complete pack, and then permits vNext Distribution installation |
| `TA-22` | Legacy project is active, paused, interrupted, unresolved, or ambiguous | migration stops as non-idle; old installation/documents remain unchanged and no vNext surface is installed |
| `TA-23` | Offline conversion encounters old task/finding/lifecycle records that are not idle | the pack does not select, resume, close, or guess; conversion is rejected until the old project is idle |
| `TA-24` | A vNext entry detects an old or unsupported schema | result is `migration-required` → stop; no legacy parsing, task execution, or mutation occurs |
| `TA-25` | Converted documents contain target-owned fields or managed drift | valid facts are preserved and drift/ambiguity is reported; conversion never overwrites target-owned content to mimic a fresh install |
| `TA-26` | Offline conversion or pack validation is interrupted | old source documents remain unchanged, the pack is incomplete, and vNext Distribution installation is forbidden |
| `TA-27` | A completed Migration Pack is presented again | the system does not perform a second conversion or create a partial installation; replay is bound to the original source and target identity |
| `TA-28` | Conversion output lacks required facts or contains conflicting authority | the pack is rejected with explicit blockers; no vNext installation or guessed canonical fact is produced |
| `TA-29` | vNext Distribution installation completes | old Skill files, registry entries, aliases, adapters, and host routes are absent and old names are not resolvable |
| `TA-30` | A claim-bound Project Profile validation command creates only declared ephemeral output | command runs with `shell: false` in a disposable clean copy; evidence is bound to claim/diff/context/command revisions, ephemeral output is audited and cleaned, and the live workspace has zero diff |
| `TA-31` | Validation changes a governed sandbox file or escapes into the live workspace | result is `blocked`, the exact unexpected paths and governed mutation count are reported, and disposable cleanup still runs |
| `TA-32` | Validation command grammar, command revision, context revision, target identity, or diff target is unsafe/stale | subprocess does not execute and the mismatch is reported as a blocker; external-documentation and approval evidence also remain outside subprocess authority |
| `TA-33` | A vNext project contains only supported canonical Markdown/YAML schemas | the resolver and entries execute against those schemas without any legacy compatibility branch |
| `TA-34` | A vNext component attempts to fall back to an old Skill or reinterpret an old document | the attempt fails closed with `migration-required` and no governed mutation |
| `TA-35` | An acceptance claim is sufficiently proved by an existing build, smoke, persisted-state, or other real evidence | the claim is validated without creating a persistent test; test creation is not inferred from code mutation |
| `TA-36` | Root-cause discovery needs callers, consumers, types, and configuration outside the proposed write set | broad read / discovery is allowed while mutation remains limited to the admitted file / symbol scope |
| `TA-37` | A multi-step task has two low-risk steps followed by a contract or lifecycle boundary | the first steps advance on minimum evidence, the boundary triggers review, and no full review is forced after every step |
| `TA-38` | A review admits a finding and repair changes the same logical diff | repair is followed by mandatory `review-change` verification before the next step advances |
| `TA-39` | Bootstrap `TASK-000` is closed and a genuinely independent request is prepared | one canonical `CURRENT_TASK` is atomically replaced by `TASK-001` in `draft + active`; identity is durable and execution is blocked |
| `TA-40` | A draft is refined repeatedly | `update-draft` preserves TASK_ID/TASK_SLUG/document_id, changes only typed definition sections, and leaves the task in `draft + active` |
| `TA-41` | A stale or unauthorized `prepare-task:confirm` is presented | Runtime returns `conflict`/`blocked`, performs no write, and does not auto-confirm the draft |
| `TA-42` | A confirmed draft is executed and later closed, then another request is prepared | the first archive remains byte-stable and immutable; the next draft receives a new identity with no dual current owner |
| `TA-43` | An active vNext Virtual Project captures a proven-unrelated work item | exactly one identity-derived inbox record is committed; exact replay is byte-identical no-op; stale, non-unrelated, unresolved, colliding, or failed transactions write nothing and leave task state unchanged |
| `TA-44` | A v2 draft declares a planned target outside its selected domain | `prepare-draft`/`update-draft`/replan/confirm definition admission fails before Runtime state mutation with a planning-authority blocker |
| `TA-45` | A planned command declares an over-broad or unprovable glob | definition admission uses deterministic pattern-subset proof and blocks before commit; an exact exception cannot authorize a directory glob |
| `TA-46` | Inventory observes ownership boundaries | `bootstrap-project` emits non-authorizing domain candidates; only explicit project-owner confirmation promotes the selected map to `PROJECT_PROFILE.yaml` |
| `TA-47` | An active v2 task encounters a changed project domain map | the bound domain-map revision mismatch fails closed and requires explicit task authority-domain revalidation; ordinary correction-replan, P-12 admission, and exact-path amendment do not rebind it |
| `TA-48` | A bounded command glob is a strict subset of its selected domain root | planning-time proof succeeds and the v2 definition can be confirmed |
| `TA-49` | A private/local/no-consumer/no-contract-impact helper is discovered inside a v2 task envelope | the target is assessed and self-admitted without a new dynamic review checkpoint; exact preflight/before-state and audit still apply |
| `TA-50` | A shared/public/cross-component/contract-impact or uncertain in-envelope target is discovered | self-admission, when otherwise allowed, retains cumulative review; low-risk behavior is not generalized to elevated expansion |
| `TA-51` | An explicitly superseded task receives a later explicit replacement request | predecessor remains superseded with unfinished history; `prepare-successor` creates a fresh `draft + active` identity with complete obligation disposition and no inherited PASS/waiver; normal confirmation is still required |
| `TA-52` | An execution check needs only an equivalent read-only launcher adjustment | `replace-validation` may change invocation mechanics while preserving observation, boundary, subjects, validation ownership, exact granularity/selector/breadth authority and budgets; selection change uses the planning route |
| `TA-53` | A user explicitly accepts a human observation or an unverified risk for one eligible obligation | human acceptance records accepted evidence for the frozen human check; waiver preserves failed/missing/not-run truth and applies only to its exact owned obligation; neither bypasses review/policy/prerequisites |
| `TA-54` | compact-v3 CURRENT_TASK is small while retained task history is large | the active projection remains a canonical head selecting immutable roots; no size gate or claim of bounded total storage/internal hydration is introduced |
| `TA-55` | a validation plan has both a focused check and an independently required release regression | minimum-sufficient is evaluated over the whole required evidence set; the authorized release obligation is preserved rather than rejected merely because a focused selector exists |

## 15. Success measures

Hard requirements:

- all G-01 through G-18 invariants remain true;
- no historical internal stage is promoted without passing the mode admission rule;
- no internal review or preparation dimension uses an executable public handoff;
- review and validation remain non-mutating;
- validation evidence is bound to exact claims, diff/context/command revisions, audited in a disposable environment, and cannot borrow user or external-documentation authority;
- every persistent test has a traceable owner, claim, and one of the four explicit admission bases;
- persistent tests are not admitted by default, and explicit user no-test policy is respected;
- read / discovery context may exceed the mutation boundary, while ordinary write scope is precise and evidence-based expansion only;
- step advancement occurs only after required evidence and any required checkpoint / repair convergence;
- ordinary new tasks persist in `draft + active` before explicit confirmation, and only `confirm-draft` may grant `active + active` execution authority;
- draft refinement preserves identity and writes only the closed task-definition section set;
- repair loops terminate by policy;
- every consumed durable knowledge item has an exact locator and relevance reason;
- knowledge candidates deduplicate, preserve provenance, and cannot bypass authority or stability gates;
- Runtime has operation-specific source/write boundaries and no second state source;
- only an old project in `idle` state may enter the one-time Migration Pack flow;
- converted canonical Markdown/YAML documents are validated before vNext Distribution installation;
- old Skills, aliases, and compatibility routes are absent from the vNext Distribution;
- old or unsupported schemas return `migration-required` and stop.

Implementation conformance and real-world effect are reported separately. Green source/contract tests establish structural behavior, not user-friction reduction, bounded internal hydration, storage-growth optimization, or fresh-Agent evidence-selection efficacy. Those effect claims require retained target-project dogfood/metrics.

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
- A persistent test is committed without an explicit owner, claim, existing-evidence insufficiency, and `acceptance` / `regression` / `critical-invariant` / `critical-risk` admission basis.
- A task treats broad read context as write permission, or treats an extra file as writable without Conditional evidence / bounded scope admission.
- Every implementation step is forced through a full review even when no risk or logical checkpoint exists.
- A step advances before required evidence or repair verification converges, or a Skill edits `CURRENT_TASK.md` to advance it directly.
- A Runtime handler writes through a broad glob or borrows another operation's valid target.
- Resume selects the “latest” package or leaves two active owners.
- Internal `sync-state` becomes a way to overwrite semantic facts without eligibility evidence.
- Distribution exposes internal capabilities as daily entries or installs any old Skill/alias in the vNext Distribution.
- A task loads all Contracts/Decisions/Lessons without relevance tracing, or silently drops required context to fit a token budget.
- A model observation or one-off workaround becomes a Contract, Decision, or Lesson without authority/evidence/deduplication.
- A legacy migration accepts a non-idle old project, guesses unfinished-state facts, or converts old documents inside a vNext Skill.
- A vNext entry continues after detecting an old/unsupported schema instead of returning `migration-required` and stopping.
- Different models or harnesses change authority, stop, owner, or mutation verdicts rather than only cost, wording, or turn count.
- Validation runs through a shell, accepts a stale/unregistered command, writes a governed path, or reports success after an unexpected live/sandbox diff.

## 16. Confirmed design decisions

### 16.1 Confirmed decisions

1. Public entries express intent rather than historical stages, with eight daily intents.
2. Internal preparation/review dimensions do not form an executable handoff chain; `review-draft` is a separate caller-invoked intent and capabilities remain adaptive inside each entry.
3. Exposure is split into daily, administrative, expert/automation, internal, and Runtime surfaces; old Skills are not a vNext compatibility tier.
4. `review-convergence-policy` and `evidence-admission-policy` become first-class internal capabilities.
5. Draft review and change review are distinct read-only targets; finding admission remains separate.
6. Runtime uses a common transaction kernel plus exact typed handlers and canonical sources only.
7. The old protocol is read only by a one-time Migration Pack; vNext has an explicit schema boundary and does not interpret legacy documents.
8. `project-context-resolver` performs relevance/precedence/conflict-aware retrieval; `knowledge-admission-policy` governs durable Contract/Decision/Lesson growth.
9. Only an `idle` old project may migrate: offline document conversion happens once, then the vNext Distribution is installed and old Skills no longer exist.
10. Ordinary independent requests first create a durable `draft + active` task through `prepare-task` and may be refined in place; only explicit `prepare-task:confirm` grants `active + active` execution authority.
11. The existing `task-state-transaction` owns the closed `create-draft`, `update-draft`, and `confirm-draft` actions with exact source revision, identity, authority, atomicity, replay, rollback, and read-back checks.

### 16.2 Confirmed parameter choices

1. The recommended exposure matrix and entry names are accepted.
2. The proposed explicit target modes and mode-admission rule are accepted.
3. The convergence budget is accepted: two attempts per fingerprint, three total repair rounds, and one verification new-finding wave.
4. The evidence-first rule, closed persistent-test admission bases, explicit no-test behavior, and temporary exploratory-evidence treatment are accepted.
5. Mutation scope is write-oriented: broad read / discovery is allowed when relevant, ordinary writes are narrow, and expansion requires evidence or authority.
6. A coherent task owns a small set of admitted steps; review checkpoints are risk-based, while repair verification remains mandatory.
7. The guarded macro transitions in §12.1 may execute automatically only under an authorized end-to-end request and must stop at user-owned authority changes.
8. Draft creation/refinement remain in the existing `task-state-transaction`; draft confirmation is the only explicit status promotion and adds no public daily entry.
9. The common Runtime transaction kernel plus exact typed handlers direction is accepted; concrete CLI/API syntax is implementation-specific and governed by the current Runtime/Distribution contracts rather than frozen by this architecture.

### 16.3 Implementation details intentionally non-normative at this architecture layer

The current product already has concrete implementations for several items below. They are deliberately not frozen as Target Architecture invariants and may evolve through their owning Runtime/Distribution/protocol contracts without changing the architectural principles above:

- Runtime command/API syntax and implementation language details;
- concrete Runtime/Distribution manifest schema and file layout;
- project-context index/cache implementation and canonical knowledge-document schema details;
- Migration Pack command/package syntax, conversion report layout, and version-number allocation;
- registry and host discoverability mechanics;

## 17. Decision outcome

The accepted target is a vNext architecture with eight daily intents, adaptive internal capabilities, independent read-only draft and change review, Review Convergence, Evidence Admission, `project-context-resolver`, `knowledge-admission-policy`, a shared Runtime transaction kernel, and Markdown/YAML canonical knowledge. Migration is idle-only and one-time: the Migration Pack performs offline conversion of old governance documents, after which the vNext Distribution is installed and old Skills are absent. vNext Skills do not understand the old protocol; an old or unsupported schema returns `migration-required` and stops.

## Task-level process-control refinement (2026-09-18)

A valid explicit user decision needs a legal task-level route, but never becomes a
fabricated test result or retrospective task completion. Runtime records ordinary
manual acceptance and narrowly scoped user-owned evidence waivers as caller-reported
source/subject-bound facts. This is not the trusted administrative realign channel.
Unverified accepted risk remains visible in context, results and archive.

Routine implementation discovery and equivalent validation invocation changes
preserve the current task's intent and obligations. Neither a local bug nor a
review finding nor a launcher correction authorizes whole-task redesign.
Supersede only records genuine invalidation; an explicitly requested successor
gets a new identity and ordinary confirmation, with all predecessor obligations
carried or explicitly retired and the old unfinished outcome preserved.
