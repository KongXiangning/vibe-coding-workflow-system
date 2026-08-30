# Workflow Skill Keep / Merge / Runtime / Delete Audit

- Status: proposed migration baseline
- Audit date: 2026-08-30
- Source baseline: 37 files under `templates/skills/*.SKILL.md.tmpl`
- Scope: responsibility placement, governance preservation, and migration regression design
- Non-goal: this document does not change the current protocol, Skill set, handoff graph, runtime, host sync, or generated references

## 1. Audit basis

This audit uses the following authority order:

1. [WORKFLOW_PROTOCOL.md](../../.workflow-system/WORKFLOW_PROTOCOL.md)
2. [FILE_SCHEMAS.md](../../.workflow-system/FILE_SCHEMAS.md)
3. [CONTRACTS.md](../workflow/CONTRACTS.md)
4. [DECISIONS.md](../workflow/DECISIONS.md)
5. The actual 37 Skill templates and the generated [SKILL_REGISTRY.md](../workflow/SKILL_REGISTRY.md)

The current source contains 37 Skill templates with 8,205 lines. The source-repo generated reference contains 37 Skills with 8,864 lines. An exact-line scan also found 41 distinct long lines repeated in at least five templates; the generic read/write/output boilerplate appears in up to 26 templates. These counts do not prove that a governance capability is unnecessary, but they do prove that responsibility and repeated prompt text must be audited separately.

## 2. Classification rules

Each current Skill receives exactly one primary classification:

- `Keep`: retain an independently invocable governance capability. It may be renamed or exposed as one explicit mode of a thin public entry.
- `Merge`: remove the independent entry and absorb its model-judgment responsibilities into a higher-level public entry.
- `Runtime`: remove the standalone reasoning Skill. A model or user produces a structured proposal; deterministic code validates schema, path, authority, marker, conflict, and atomic write behavior.
- `Delete`: remove the independent Skill and its generic orchestration prompt. Every governance rule listed in the row must first move to a target entry, protocol rule, or runtime check.

Secondary extraction is allowed. For example, a `Merge` lifecycle Skill can still have its file transaction extracted into Runtime. The primary classification answers where responsibility is owned after migration.

## 3. Audit result

| Classification | Count |
|---|---:|
| `Keep` | 5 |
| `Merge` | 20 |
| `Runtime` | 7 |
| `Delete` | 5 |
| **Total** | **37** |

The five `Delete` results are not deleted governance. They are standalone wrappers whose remaining rules are preserved in `prepare-task`, `execute-step`, `debug-task`, protocol-level constraints, or runtime transition checks.

## 4. Proposed public entry surface

The target is ten public entries, not ten monolithic prompts. Each entry must stay thin, accept an explicit mode where applicable, load only relevant references, and delegate deterministic work to Runtime.

| Public entry | Responsibility | Current capabilities absorbed |
|---|---|---|
| `bootstrap-project` | Select and run an explicit `design`, `greenfield`, `inventory`, `adopt`, or `realign` mode | `design-baseline-init`, `greenfield-init`, `legacy-inventory`, `adopt-existing-project`, `realign-workflow-assets` |
| `prepare-task` | Create or review the task, lock scope, classify unresolved decisions, plan, and produce executable steps | `create-current-task`, `review-current-task`, `lock-scope`, `classify-decisions`, `plan-implementation`, `decompose-task` |
| `execute-step` | Implement only the current admitted step or finding repair | `implement-current-step`, the useful guards from `continue-current-step` |
| `review-change` | Produce a read-only scope, implementation-quality, and contract verdict against one explicit diff target | `review-current-diff`, `review-diff`, `review-implementation`, `verify-contracts` |
| `validate-change` | Select QA mode and produce regression, smoke, browser, visual, release, canary, or benchmark evidence | `run-regression` |
| `debug-task` | Investigate root cause and, only when authorized, orchestrate the minimal repair path | `investigate-root-cause`, the useful guards from `debug-and-fix-current-task` |
| `task-lifecycle` | Execute an explicit `pause`, `interrupt`, `resume-paused`, `resume-interrupted`, `supersede`, or `replan` mode | lifecycle and replacement Skills |
| `capture-work-item` | Preserve the independent record-only intake branch | `capture-work-item` |
| `sync-state` | Propose and atomically commit task, status, contract, decision, host-guidance, lesson, and finding deltas | the current sync Skills and Runtime transactions |
| `close-task` | Verify closure eligibility, produce delivery evidence, and archive | `close-current-task`, `prepare-delivery-summary`, `archive-task` |

`capture-work-item` remains separate because record-only intake must not be flattened into task creation or lifecycle mutation. `validate-change` remains separate from `review-change` because task-level QA does not own the full protocol/project validation model. `bootstrap-project` and `task-lifecycle` are explicit-mode facades; their internal modes retain separate permission, input, and stop-condition contracts.

## 5. Keep audit — 5 Skills

| ID | Current Skill | Target | Governance semantics that must survive | Delete or compress | Migration regression case |
|---|---|---|---|---|---|
| K-01 | `capture-work-item` | `capture-work-item` | Write only when `relation_to_current_task=unrelated`; use `TASKS/inbox/INBOX-...md`; scope widening, uncertainty, and duplicate suspicion fail closed; never mutate `CURRENT_TASK`, lifecycle, task identity, or document catalog | Generic read, restatement, and output boilerplate | `MR-K01`: unrelated input creates exactly one inbox artifact and leaves `CURRENT_TASK` unchanged; scope widening and duplicate suspicion create no artifact and route to review/user decision |
| K-02 | `implement-current-step` | `execute-step` | Only primary code-writing entry; current step and admitted findings only; enforce Allowed/Conditional/Forbidden Files; dangerous-command authorization fields; design gate; External Documentation Gate when current third-party behavior affects correctness | Generic code-reading, style, minimal-change, and test-running advice | `MR-K02`: a Forbidden path, an unconfirmed dangerous command, or required external behavior without current-doc evidence blocks before mutation; a valid step changes only admitted paths |
| K-03 | `investigate-root-cause` | `debug-task` investigation mode | Separate new-bug registration, report-only investigation, and current-task debugging; reproduce before hypothesis; ownership assessment; matching suspended evidence and active-owner guard; stop after three non-converging attempts; External Documentation Gate where needed | Generic logging and call-chain investigation tutorials | `MR-K03`: a new-bug request does not authorize repair; report-only is terminal; three failed hypotheses stop; missing suspended evidence never enters resume success |
| K-04 | `realign-workflow-assets` | `bootstrap-project --mode=realign` | Classify assets before mutation; preserve target-owned facts and user docs; propose conflict diff; prune only isolated `workflow-system-*`; never delete native gstack or unrelated host assets | Repeated commands and generic read/write protocol | `MR-K04`: mixed legacy, user-owned, and native assets produce a dry-run plan; write mode affects only confirmed workflow-owned assets and stops on frozen/conflicting targets |
| K-05 | `run-regression` | `validate-change` | QA-mode closed set; reuse the same diff target; `report-only` terminal semantics; owner-aware routing; browser/session and visual evidence; release/canary/benchmark blocked semantics; failure routes to root-cause work without silently fixing | Ordinary test-running suggestions | `MR-K05`: report-only pass or fail triggers no sync/debug handoff; missing session/visual/release evidence yields blocked; an actual normal-mode test failure recommends `debug-task` |

## 6. Merge audit — 20 Skills

| ID | Current Skill | Merge target | Governance semantics that must survive | Delete or compress | Migration regression case |
|---|---|---|---|---|---|
| M-01 | `adopt-existing-project` | `bootstrap-project --mode=adopt` | Only confirmed facts become governance baseline; inferred/unknown retain source and risk; preserve historical decision provenance; no feature implementation | Repeated document reads and generic “do not guess” text | `MR-M01`: an unknown consumer does not become a locked contract; conflicting evidence stops for confirmation; code directories remain unchanged |
| M-02 | `capture-lessons` | `sync-state` / `close-task` lesson phase | No reusable lesson means no-op; persisted lesson needs evidence, reusable trigger, cause, and action; reject one-off chat and empty slogans | Generic write and handoff protocol | `MR-M02`: a one-off observation is no-op; a recurring evidenced failure produces one non-duplicate structured lesson |
| M-03 | `close-current-task` | `close-task` | Closure order remains auditable: sync task/status, conditional semantic deltas, summary, archive; blockers stop before archive; remaining risks survive | Pure wrapper sequencing and child handoff text | `MR-M03`: any blocker stops before archive; optional sync phases can no-op; a successful closure records the exact sequence and remaining risks |
| M-04 | `create-current-task` | `prepare-task --mode=create` | Complete task schema; Allowed/Conditional/Forbidden buckets; propagation record; three rollback fields; UI and release conditional fields; never overwrite Profile or Contracts | General requirement-analysis and formatting instruction | `MR-M04`: UI without a source enters design-system/exploration; release work without rollback/evidence cannot execute; an existing active owner is not overwritten |
| M-05 | `design-baseline-init` | `bootstrap-project --mode=design` | Design precedes implementation; produce design baseline only; do not create feature code, active task, or locked runtime contract from unconfirmed design | Per-document tutorial text that schema can own | `MR-M05`: an empty project receives design artifacts only; API remains a draft; a repo with meaningful implementation cannot silently enter design-baseline mode |
| M-06 | `greenfield-init` | `bootstrap-project --mode=greenfield` | Consume confirmed design to create governance baseline; complex project without baseline returns to design; no feature implementation | Repeated baseline-generation prose | `MR-M06`: missing architecture/database/API baseline routes to design; only confirmed choices enter Contracts/Decisions; business code remains untouched |
| M-07 | `interrupt-current-task` | `task-lifecycle --mode=interrupt` | Interrupted differs from paused; preserve full snapshot plus checkpoint, dirty attribution, environment state, and recovery strategy; marker transaction must fail closed | Marker mechanics shared with lifecycle Runtime | `MR-M07`: missing dirty attribution or recovery evidence cannot create a resumable package; marker drift and active-owner conflict fail without success-shaped output |
| M-08 | `legacy-inventory` | `bootstrap-project --mode=inventory` | Discover actual paths rather than assuming `src/test`; classify confirmed/inferred/unknown with evidence; record APIs, consumers, migration and risk; no active task or code mutation | Generic scanning/output boilerplate | `MR-M08`: a nonstandard repository records actual paths; unknown consumers remain unknown; no business code or live task is created |
| M-09 | `lock-scope` | `prepare-task --mode=scope-lock` plus scope validator | Three mutation buckets; default deny; safety mode and dangerous surfaces; widening requires reason, impact, risk, validation, and regenerated buckets; propagation check | Repeated dangerous-surface lists and generic read/write text | `MR-M09`: an unlisted diff path blocks; guarded work without evidence blocks; widening without a regenerated scope contract cannot proceed |
| M-10 | `pause-current-task` | `task-lifecycle --mode=pause` | Distinguish `paused_pending_closure` and `paused_blocked`; reasons match state; preserve full snapshot; `pause_only` never starts a new task; `pause_and_switch` may enter preparation | Shared marker transaction prose | `MR-M10`: `pause_only` creates no next task; `paused_blocked` without blocker evidence fails; read-back marker drift cannot report success |
| M-11 | `plan-implementation` | `prepare-task --mode=plan` | Architecture impact, approach, alternatives, state flow, compatibility, risk/rollback, validation, open decisions; conditional External Documentation Gate; no code or long-term contract mutation | Generic plan-writing tutorial | `MR-M11`: a new SDK behavior without current-doc evidence blocks; a stable project wrapper may justify no lookup; unconfirmed behavior/architecture change routes to user decision |
| M-12 | `prepare-delivery-summary` | `close-task --mode=summary` | Summary covers goal, actual changes, verification, risks, next action; release work preserves health/canary/performance/rollback/observation; blocked cannot be relabeled complete | Generic summary wording | `MR-M12`: missing health or release evidence yields blocked/remaining-risk language; a valid summary cites files and verification without modifying code |
| M-13 | `resume-interrupted-task` | `task-lifecycle --mode=resume-interrupted` | Explicit unique package; require `interrupted + ready_for_resume + recovery_only`; complete payload; checkpoint/dirty/environment/recovery evidence; rehydrate to active with nonempty review gate; source becomes rehydrated; first consumer is task review | Restore mechanics shared with lifecycle Runtime | `MR-M13`: multiple candidates are never auto-selected; any missing interrupt evidence blocks; valid resume preserves evidence and forces review before execution |
| M-14 | `resume-paused-task` | `task-lifecycle --mode=resume-paused` | Explicit unique paused package; complete payload; ready/recovery-only markers; active tuple plus normalized review reasons; no “latest package” guessing | Restore mechanics shared with interrupted resume | `MR-M14`: wrong artifact kind or incomplete marker blocks; valid resume produces `active + active`, `resume_requires_review=true`, and a review handoff |
| M-15 | `review-current-diff` | `review-change --mode=report-only` | Strictly read-only; combine scope, implementation, contract verdicts with QA report; force terminal report-only behavior; do not sync, debug, resume, or repair | Child-skill orchestration and handoff prose | `MR-M15`: committed checkpoint with clean working tree still reviews the task range; any report-only finding leaves `CURRENT_TASK` and code unchanged |
| M-16 | `review-current-task` | `prepare-task --mode=review` | One primary goal; source-of-truth conflicts; design/release fields; rollback fields; resumed-task gate and reasons; never silently clear recovery metadata | Format checks shared with task creation/planning | `MR-M16`: resumed task missing reason/checkpoint/diff target blocks; a task overriding Contracts blocks; UI without design evidence cannot become executable |
| M-17 | `review-diff` | `review-change --mode=scope` | Establish explicit diff target first; check scope, safety, design drift, and propagation; route mechanical/scope/product/root-cause findings; remain read-only | Generic diff-reading and output boilerplate | `MR-M17`: a checkpoint forbids fallback to plain working-tree diff; Forbidden path blocks; mechanical finding enters admission rather than direct repair |
| M-18 | `review-implementation` | `review-change --mode=implementation` | Goal fit, correctness, edge cases, robustness, minimality, compatibility, test adequacy; complete evidence for major/critical findings; External Documentation Gate; report-only override | Reads/output duplicated with other review Skills | `MR-M18`: happy-path-only tests produce a finding; mismatched diff target blocks; unverifiable third-party behavior cannot receive clean verdict |
| M-19 | `supersede-current-task` | `task-lifecycle --mode=supersede` or `prepare-task --mode=replan` | Use only when goal/scope/acceptance is invalid; preserve findings, unfinished steps, partial diff ownership, and history; use superseded/replaced/replan markers; new task returns to review/scope/plan | Generic task-rewrite prose | `MR-M19`: a mere new step or open finding does not supersede; true invalidation preserves the old record and restarts preparation; archived task cannot be replaced as active |
| M-20 | `verify-contracts` | `review-change --mode=contract` | Check interface and architecture contracts against the same diff target; never loosen Contracts silently; cover signature, result shape, DTO/event, schema, dependency direction, state flow, directory duty | Independent entry and repeated output protocol | `MR-M20`: DTO semantics or dependency direction change produces blocker; missing shared diff target cannot produce clean; contract repair is not performed during review |

## 7. Runtime audit — 7 Skills

Runtime classification does not remove semantic judgment. The caller proposes a typed delta and its evidence; Runtime performs deterministic validation and atomic commit. Runtime must parse or project from the existing canonical governance documents and must not introduce a parallel state database.

| ID | Current Skill | Runtime target | Governance semantics that must survive | Delete or compress | Migration regression case |
|---|---|---|---|---|---|
| R-01 | `archive-task` | `archiveTransaction` | Read materialized identity from live task; canonical archive path; carry task/validation/release/rollback/remaining-observation evidence; wrong tuple, incomplete acceptance, or placeholder identity fails closed | Natural-language archive mechanics | `MR-R01`: placeholder identity and unmet acceptance fail; valid input creates the exact archive path; wrong-state repeat does not succeed idempotently |
| R-02 | `sync-contracts` | `contractCandidateCommit` | Only verified, sufficiently stable interface/architecture boundaries; do not lock temporary implementation; loosening locked contract requires authority; preserve layers and provenance | Repeated no-op and document-writing directions | `MR-R02`: temporary helper is rejected; stable API lands in correct layer; locked-contract relaxation blocks; replay is idempotent |
| R-03 | `sync-current-task` | `taskStateTransaction` | Record actual progress, evidence, deviations, risks, acceptance, and next handoff; never beautify failure into completion; retain execution history | Generic execution/output protocol | `MR-R03`: failed validation keeps acceptance open and risk visible; no evidence means no completion; replay does not duplicate or erase history |
| R-04 | `sync-decisions` | `decisionRecordTransaction` | Only explicitly confirmed architecture/taste/deferred/rejected decisions; append-only evolution; superseded link rather than history overwrite; retain why, constraints, and authority | Format and handoff prose | `MR-R04`: unconfirmed suggestion is rejected; confirmed taste choice records user authority; replacement appends an auditable successor link |
| R-05 | `sync-host-guidance` | `pairedHostGuidanceTransaction` | AGENTS and CLAUDE remain semantically aligned; only project-wide durable rules; preserve necessary host differences and target-owned content; temporary workaround is not global guidance | Host-category lists and ordinary sync explanation | `MR-R05`: a one-sided update either becomes a validated pair or blocks; temporary task notes are rejected; conflict with Contracts stops commit |
| R-06 | `sync-review-findings` | `findingAdmission` plus `queueTransaction` | Structured source/severity/location/scenario/minimal fix/test/status/handoff; only current-owner, in-scope mechanical findings enter queue; owner evidence and guard first; queue isolation and deduplication | Repeated field/handoff text | `MR-R06`: product/contract/scope/other-owner findings never become fixable queue items; valid finding is written once with provenance; owner ambiguity blocks |
| R-07 | `sync-status` | `statusTransaction` | STATUS is descriptive only; stable requires acceptance and key evidence; canary/benchmark pending means observing/blocked; rollback means rolled-back; never mutate code or Contracts | Repeated release-field lists | `MR-R07`: unfinished benchmark cannot be stable; rollback records rolled-back; missing evidence records blocked; replay is idempotent |

## 8. Delete audit — 5 Skills

| ID | Current Skill | Semantic destination | Governance semantics that must survive | Delete | Migration regression case |
|---|---|---|---|---|---|
| D-01 | `classify-decisions` | `prepare-task` structured decision intake and protocol | Mechanical/Taste/User challenge classification; Taste is visible; User challenge never silently decided | Standalone read/write/handoff and formatting workflow | `MR-D01`: UI wording becomes Taste, contract direction becomes User challenge, mechanical formatting may proceed; unresolved non-mechanical choice blocks execution |
| D-02 | `continue-current-step` | `execute-step`, workflow state transition, and shared diff-target contract | Task must already be prepared; implementation/review/validation share one target; failure routes to debug; widening returns to scope | Pure orchestration wrapper and repeated chain | `MR-D02`: checkpoint task uses task-base/checkpoint target; missing target blocks before execution; QA failure never enters state sync as success |
| D-03 | `debug-and-fix-current-task` | `debug-task` public entry | No repair before root-cause evidence; absent task first enters preparation; repair replays original failure and full review/validation | Outer wrapper that only chains investigation and implementation | `MR-D03`: unverified hypothesis cannot mutate code; new bug request is not repair authorization; successful repair reuses the same failure and diff evidence |
| D-04 | `decompose-task` | `prepare-task` step constraints and model-native planning | One independently verifiable subgoal per step; no unresolved decision inside execution; UI exploration/implementation/visual-QA separation where applicable | Generic decomposition tutorial and fixed ordering advice | `MR-D04`: UI work produces separable design/implementation/visual evidence; cross-module untestable step is split or blocked; unresolved decision never becomes executable step |
| D-05 | `execute-current-task` | `prepare-task`, `execute-step`, and workflow transition Runtime | Never bypass task review, scope, authority, dangerous-command gate, or stop-on-user-decision behavior; already-prepared task may enter execution | Full natural-language workflow engine and mechanical handoff list | `MR-D05`: unprepared task enters preparation; ready task may execute; any child gate requiring user input stops without a success-shaped completion |

## 9. Global governance invariants

These invariants are the non-loss contract for every future migration task.

### G-01 — Authority and single truth

- Protocol and Schema own structural rules.
- Generated references are evidence, never reverse inputs.
- Live governance docs own project facts.
- Project precedence remains `CONTRACTS > PROJECT_PROFILE > DECISIONS > CURRENT_TASK > STATUS`.
- `CURRENT_TASK` may narrow but never override Contracts.
- Runtime may produce typed projections, but no parallel state source is introduced.

### G-02 — Scope and authorization

- Every active task has Allowed, Conditional, and Forbidden buckets.
- Unlisted mutation is forbidden.
- Widening records reason, impacted files/contracts, risk, and validation, then regenerates the buckets.
- Dangerous operations retain explicit target, risk, rollback/recovery, scope check, and confirmation.

### G-03 — Decision authority

- Mechanical choices may be resolved automatically.
- Taste choices remain explicit.
- Product behavior, contract, architecture, or user-challenge changes stop for authority.
- Tests may not silently turn an unconfirmed behavior guess into a contract.

### G-04 — Propagation evidence

Protected/shared/API/schema/DTO/event/generated/UI-anchor mutations retain discovery evidence, union impact set, compatibility strategy, eligibility assessment, migration/adapter/rollback plan, linked regression, and gate verdict. Multiple blockers remain visible rather than being collapsed to the first error.

### G-05 — One diff target

Implementation review, contract review, diff-aware validation, and finding evidence use one explicit target. A checkpoint forbids silent fallback to an empty working-tree diff. No target means no clean verdict.

### G-06 — Read-only review and report-only terminal behavior

Review never fixes or writes governance state. Report-only pass and fail both terminate after reporting and never auto-enter sync, debug, resume, or repair.

### G-07 — Finding admission before repair

The flow remains `read-only review -> finding admission -> execute-step`. Only current-owner, in-scope mechanical findings enter the fix queue. Scope, product, contract, architecture, unknown-root-cause, and other-owner findings use distinct routes.

### G-08 — Ownership and handoff are separate

Canonical owner route answers who owns the problem; a guard-aware route answers whether the next action is authorized. Suspended-package presence, fuzzy similarity, and conversational memory do not prove ownership.

### G-09 — Lifecycle and active ownership

Workflow status and lifecycle state remain separate. Active ownership derives only from the live tuple. Pause, interrupt, resume, archive, supersede, and replan preserve legal transitions and fail-closed idempotence. Incomplete or contradictory packages are recovery evidence, not resume inputs.

### G-10 — Resume review gate

Resume requires an explicit unique package, complete payload, normalized nonempty reasons, and the correct ownership markers. The restored task is reviewed before any execution, and the gate is not silently cleared.

### G-11 — Record-only intake

Inbox accepts only unrelated work, never mutates the current task, never becomes a lifecycle/task/archive/catalog object, and never overwrites a suspected duplicate.

### G-12 — Semantic proposal plus deterministic commit

Model judgment decides whether a contract, decision, lesson, or finding is semantically eligible. Runtime validates the typed proposal and commits atomically. A failed commit cannot leave a success marker or partial authority change.

### G-13 — Validation layers

Protocol validation remains separate from target-project validation and runs first where authority depends on protocol validity. Task-level `validate-change` does not become the owner of the complete validation model. Blocker levels stay explicit.

### G-14 — Generated/live and atomic generation

The direction stays `protocol/schema/templates -> generator -> generated reference -> freshness`. Render/validate precedes write, invalid generation produces zero partial output, existing live facts are proposed rather than silently overwritten, and orphan cleanup is bounded.

### G-15 — Source/target and host isolation

Source repo self-install stays forbidden, isolated target install stays allowed, and source self-sync stays allowed. Host sync manages only isolated `workflow-system-*` assets and preserves native gstack and unrelated host content.

### G-16 — Design, release, and current external behavior

UI work retains design mode/source/acceptance/evidence/open decisions. Release work retains environment/health/canary/performance/rollback/evidence and cannot claim stable while evidence is pending. Current third-party behavior that affects plan, implementation, investigation, or review retains the External Documentation Gate.

### G-17 — Task identity and archive traceability

Task ID/title/slug materialize once, remain immutable through lifecycle artifacts, and determine the archive path. Placeholder or conflicting identity fails closed. Closure and archive preserve validation, rollback, and remaining-risk evidence.

### G-18 — Adaptive depth without semantic bypass

Small work may skip unnecessary planning prose, but it cannot bypass source authority, scope, decision, dangerous-operation, evidence, or closure gates. Larger work may use checkpoints and multiple steps without changing the same invariants.

## 10. Global migration regression suite

The 37 `MR-*` row cases are mandatory capability tests. The following cross-cutting cases verify composition rather than one Skill at a time.

| ID | Fixture | Expected invariant |
|---|---|---|
| `GR-01` | Small documentation-only change | Minimal route, explicit scope, no unnecessary design/release/QA modes, no governance bypass |
| `GR-02` | Single-file bug with confirmed root cause | `prepare-task -> execute-step -> review-change -> validate-change -> sync-state`; no unrelated planning expansion |
| `GR-03` | Multi-module API/DTO change | Propagation evidence, compatibility strategy, contract review, linked regression, and user authority where breaking |
| `GR-04` | UI task without mockup or design system | Enters design-system/exploration and cannot implement until design acceptance is auditable |
| `GR-05` | Task with third-party SDK behavior newer than project evidence | External Documentation Gate triggers; unavailable evidence produces blocked rather than guessed clean/implementation |
| `GR-06` | Long task with task-base and reviewed checkpoint | Every review and validation stage uses the recorded range rather than empty working-tree diff |
| `GR-07` | Review produces in-scope mechanical finding | Read-only verdict persists through finding admission exactly once, then execute-step repairs and reruns impacted gates |
| `GR-08` | Review produces product/contract or scope-widening finding | Never enters mechanical queue; routes to user decision or scope preparation |
| `GR-09` | `report-only` review with failing tests | Reports failure and recommended route, mutates nothing, and executes no handoff |
| `GR-10` | Current task paused mid-write | Partial transaction remains fail-closed and non-resumable; no dual active owner |
| `GR-11` | Interrupted task with two possible packages | No automatic selection; complete checkpoint/dirty/environment/recovery evidence required |
| `GR-12` | Unrelated issue discovered during active work | Capture writes only inbox record; active task and lifecycle tuple remain unchanged |
| `GR-13` | Close task with unresolved acceptance or release observation | Closure blocks or records observing/blocked state; archive never claims stable completion |
| `GR-14` | Runtime transaction replay | Valid replay is idempotent; wrong source tuple or conflicting marker fails rather than succeeding as no-op |
| `GR-15` | Generated template drift | Freshness detects drift; generated references are changed only through the generator |
| `GR-16` | Host sync with native gstack and custom Skill directories | Only orphaned `workflow-system-*` assets are planned/pruned; unrelated content survives |
| `GR-17` | Source repo passed to install and sync separately | Install fails before planned writes; source self-sync read/write semantics remain allowed |
| `GR-18` | Same representative tasks on Sol/Terra/Luna and at least one non-OpenAI harness | Governance verdict and stop/escalation behavior remain equivalent; cost/turn differences are measured separately |

Evaluation must compare the current 37-Skill baseline, the new public facade in shadow mode, and the final Runtime-backed route. Required measures are task success, scope violations, wrong authority decisions, state drift, review convergence rounds, evidence completeness, tokens, latency, and user interruptions.

## 11. Prompt content marked for deletion or shared reference extraction

The following content should not survive as repeated prose in every target entry:

- “read all required files”, “restate the goal”, and generic execution-protocol sequences;
- repeated Project Variables already available through Profile or host context;
- repeated output boilerplate such as “surface assumptions” and “keep auditable”;
- ordinary code reading, style matching, minimal-change, edge-case, and test-running advice;
- natural-language implementations of atomic writes, marker transitions, deduplication, path authorization, or idempotence;
- duplicated source-precedence, scope-bucket, and finding-field lists when a shared policy reference or Runtime validator is authoritative;
- mechanical handoff chains whose next action is determined by validated workflow state.

Shared references remain appropriate for current external documentation lookup, dangerous-operation policy, design/release evidence, and governance invariants. Extracting a shared reference must not make an important gate invisible to the public entry that triggers it.

## 12. Audit conclusion

The target is not “37 prompts compressed into ten larger prompts.” The target is:

```text
10 thin public entries
  -> explicit modes and typed proposals
  -> shared governance references
  -> deterministic Runtime transactions and validators
  -> existing canonical live governance documents
```

This audit is a migration baseline, not an authorization to implement it. The next task must first change the protocol-level representation of public/internal/runtime/compat capabilities and add golden regression fixtures before any old Skill is removed.
