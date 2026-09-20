# vNext Design Convergence — A–E implementation reconciliation

- **Status:** `E convergence / source implementation aligned; target-project dogfood pending where stated`
- **Date:** `2026-09-19`
- **Baseline reviewed:** `c21c8c8702ea69e7f81dfa35021bf390c8837e2f`
- **Scope:** reconcile the normative Target Architecture with the implemented A–D workflow without adding a new workflow layer

## 1. Purpose and evidence rule

This document records the E-stage convergence review. It does not make the implementation correct by declaration and it does not replace Runtime/Source Contract, the installed Skill sources, Task Basis, or project governance documents.

For each principle the review starts from the current Runtime, contracts, Skills and focused regression evidence, then classifies the remaining gap. The allowed status vocabulary is:

- `aligned`: the intended architecture has a concrete implementation route and focused structural/behavioral evidence for that boundary;
- `aligned-with-known-limit`: the intended boundary is implemented, but an explicitly narrower claim remains than the broad architectural aspiration;
- `implemented-dogfood-pending`: the mechanism and guidance exist, but real-agent/product efficacy has not yet been established;
- `implementation-gap`: an effective design requirement lacks a supported product route and must not be papered over by documentation.

A green source/contract test is structural evidence only. It is not evidence that users experience less friction, that all internal reads have bounded cost, that storage growth is optimized, or that a fresh Agent reliably selects the best evidence set.

## 2. Convergence matrix

| Principle | Original intent | Current implementation and direct evidence | Remaining limitation | Final status | E action |
|---|---|---|---|---|---|
| **P-01 — public entry represents intent** | Users should invoke intents, not internal planning/review stages. | `SOURCE_CONTRACT.yaml` exposes 8 daily entries (`prepare-task`, `review-draft`, `review-change`, `execute-step`, `debug-task`, `task-lifecycle`, `capture-work-item`, `close-task`), one admin entry and two expert entries. Internal Runtime actions such as preflight, correction candidates, successor preparation and storage migration do not become separate public Skills. Public Skills terminate and recommend a later route rather than chaining another public Skill. | The number of entries is not itself proof that manual invocations or user cognitive load are lower in a real target project. | `aligned-with-known-limit` | Align the exposure/mode tables with the actual source surface; keep real-user friction as dogfood evidence rather than a source-test claim. |
| **P-03 — adaptive depth** | Remove governance when its trigger is absent without bypassing mandatory authority/evidence/safety. | Mutation Authority v2 evaluates an in-envelope discovery by blast radius. Local/private/no-consumer/no-contract-impact self-admission does not add review merely because it was unplanned; elevated/shared/public/cross-component/contract-impact or uncertain material retains cumulative review. Same-plan recovery, invocation-only validation replacement and explicit user evidence decisions have bounded routes instead of whole-task escalation. | Real dogfood may expose other over-governance seams; no count/size shortcut can prove proportionality. | `aligned` | Remove stale “every dynamic expansion requires review” design/schema/protocol wording. |
| **P-06 — semantic authority has an execution outlet** | User/model semantic decisions must be able to reach a legal Runtime transition, while Runtime still owns deterministic commit. | Explicit human acceptance, evidence waiver, validation invocation replacement, additive authority amendment, restricted correction/recovery and explicit successor preparation all have concrete Runtime paths. Successor keeps the predecessor superseded, uses a fresh identity and still requires normal confirmation. Waiver does not convert failure to PASS; human evidence does not impersonate an automated run. | Human/provider identity remains caller-reported outside the separately supported trusted administrative channel. | `aligned` | Replace the old “supersede → general same-task replan” model and stale debug routing with the current bounded routes. |
| **P-07 — one canonical truth** | Storage optimization must not create an independently editable second task truth. | Under compact-v3, `CURRENT_TASK.md` is the canonical task head/navigation projection and selects exact immutable definition/state roots in the same committed aggregate. Manifest/indexes are integrity/navigation material rather than independent business authority; uncommitted/orphan objects are not current truth. Task Basis/project documents remain the source authority for requirements/decisions. Storage-only migration preserves semantics and, when exact lineage proves equivalence, in-flight business receipts. | Retained history still grows; no garbage collection or bounded-total-storage claim exists. | `aligned` | Describe the head + selected immutable roots as one canonical aggregate; explicitly deny “Task Store is a second editable database/source of truth.” |
| **P-09 — bounded context** | The model should read task/project material by relevance rather than loading all governance/history into each turn. | `task-context`, `task-read`, `file-context`, and `review-read` use operation-specific projections, bounded UTF-8 pages/continuations and revision-bound receipts. Compact-v3 prevents the active task file from duplicating all frozen material. Required continuation pages must be consumed; compact/store failure is not permission for an unbounded fallback. | This proves a bounded **model-facing read protocol**, not bounded total cost for every internal canonical-reader integrity/history hydration operation. C-stage diagnostic budgets are not a proof of canonical-reader complexity. | `aligned-with-known-limit` | Scope P-09 precisely to model-facing context and record internal hydration/performance as a measurement concern, not a size gate. |
| **P-12 — minimum-sufficient evidence** | Validate the actual business claim with the smallest sufficient evidence, without turning test count/full-suite green into a goal. | Runtime already binds claim → slot/check → expected observation/boundary → selection granularity → invocation → result, including breadth authority and completion applicability. D-stage Skills now select by concrete failure + independent oracle + real boundary and review whether the check would fail for the relevant defect. Minimum-sufficient is evaluated over the **whole required evidence set** and total cost: focused is not automatically superior to a justified target, independent user/project/release/contract/risk breadth is preserved, and local PASS cannot replace required business-flow evidence. Known-defect calibration demonstrates that selected checks can detect specific historical failures. | Runtime cannot prove the natural-language oracle is business-correct or that the model selected the semantically optimal set. Fresh-Agent selection quality and cost reduction still require real target-project dogfood. | `implemented-dogfood-pending` | Align Target Architecture and Source Contract with whole-set semantics; preserve the distinction between structural enforcement and semantic efficacy. |
| **P-13 / Mutation Authority v2 — authority is an envelope** | Hard write authority should describe owned responsibility domains, not a prediction of every file implementation will touch. | The v2 task authority envelope (`domains` + exact exceptions + forbidden) is the hard mutation boundary. `planned_mutation_targets` are planning/review guidance. Same-envelope discovery can be assessed and self-admitted; a write outside the envelope requires explicit amendment. Read/discovery can cross domains without gaining write authority. Existing v1 tasks retain v1 exact scope semantics instead of being silently upgraded. | Domain quality still depends on project-owner-confirmed maps and semantic blast-radius judgment; v1 projects remain intentionally different. | `aligned` | Remove any stale “planned files = hard authority” or unconditional dynamic-review wording and retain the v1 compatibility boundary. |

No reviewed principle is classified `implementation-gap` after the E corrections below. This does **not** convert the dogfood-pending rows into effect claims.

## 3. Authority and truth model after convergence

The current architecture is intentionally layered:

```text
User / Agent
  semantic intent, business judgment, explicit user decisions,
  evidence-selection judgment
        ↓
Skills
  bounded context navigation, source/authority interpretation,
  failure-oriented preparation and review behavior
        ↓
Runtime
  deterministic identity, authority, structural evidence binding,
  invocation/result binding, lifecycle transactions, receipt lineage,
  storage integrity and canonical consistency
        ↓
CURRENT_TASK canonical head
  active compact navigation projection + exact immutable-root selection
        ↓
Task Store aggregate
  immutable selected task material + committed reports/receipts/decisions/history

Task Basis / Project documents
  remain the authoritative requirement/design/business sources referenced by the task.
```

The Task Store does not gain authority from physical existence alone. A proposal, orphan/prepared object, rebuildable index, summary field, or unselected object cannot independently redefine the active task.

## 4. Superseded design rules and replacements

| Stale rule / wording | Why it is stale | Current replacement |
|---|---|---|
| Any unplanned/dynamic v2 expansion requires a new cumulative review. | A–D implemented assessment-based adaptive depth; low-risk in-envelope discovery was over-governed by the old rule. | Retain every expansion in audit, but add dynamic review only when blast-radius assessment is elevated/shared/public/cross-component/contract-impact/uncertain/escalated or another checkpoint independently requires it. |
| `superseded + active` has one normal exit: same-task `prepare-task:replan` / `commit-replan`. | A-stage process-control work separated conclusion correction, authority amendment and genuine replacement. Generic direct `commit-replan` is closed. | Bounded same-task correction is `prepare-replan` → `confirm-replan`; authority widening is `amend-scope`; genuine replacement after supersede requires explicit `prepare-successor` and a fresh identity/confirmation. |
| A changed goal/scope/acceptance can be summarized as “supersede-or-replan”. | This collapses different authority meanings and can either over-replan or silently widen a correction path. | Route by semantics: bounded correction when total authority is unchanged; explicit amendment for additive authority; supersede for genuine invalidation; explicit fresh successor for later replacement. |
| Every check should be narrowed to the most focused available selector. | D review showed this confuses minimum granularity with the minimum-sufficient **set** and can invalidate legitimate release/user/policy breadth or increase total cost. | Compare feasible evidence sets by detection, real boundary, independent obligations and total cost. Broader execution still requires its existing breadth basis/source. |
| Final/full regression is the safe default. | It recreates the original “many green tests but wrong business behavior” failure mode and conflicts with P-12. | Broad/full/E2E evidence is selected only for an actual claim/risk/contract/policy/release/user basis; “final step”, historical green, convenience and generic confidence are insufficient. |
| `CURRENT_TASK.md` must inline the whole task to remain canonical. | compact-v3 removed repeated immutable material without changing task authority. | `CURRENT_TASK.md` is the canonical head/active projection; its exact immutable roots and committed aggregate material are part of the same canonical task. |
| Task Store can be described as the source of truth because it contains full material. | Physical storage is not semantic authority and would create a second editable truth model. | Task Store retains the canonical aggregate selected by the head; Task Basis/project docs retain source authority; manifest/index/orphans are not independent task truth. |
| A small active file proves bounded context or bounded storage. | B reduced representation size; C explicitly showed total retained material/history is a separate dimension. | Claim only bounded model-facing navigation/pages. Measure total storage/hydration separately; do not add a size gate. |
| A validation failure or launcher mismatch requires whole-task replan. | A introduced same-plan recovery and exact engineering-only validation replacement. | Use retry/recovery or selection-identical `replace-validation`; only semantic obligation/authority changes use their planning routes. |
| Supersede automatically implies or creates a replacement. | This bypasses explicit user replacement intent and can erase unfinished obligations. | Supersede only invalidates; successor requires an explicit later request, complete predecessor-obligation disposition, fresh identity, and ordinary confirmation. |
| A waiver can be treated as successful evidence. | It falsifies execution truth and can hide risk. | Preserve failed/missing/not-run result; bind the exact waiver decision only to its owned eligible obligation; review/findings/prerequisites remain. |
| One public Skill can continue by invoking the next public Skill. | It re-creates a hidden BPM chain and weakens user/harness agency. | Each public entry terminates; `next_route` is informational for the caller or explicitly configured outer orchestrator. |

Historical discussion/HANDOFF material may retain old terminology as provenance when clearly marked superseded. It must not be used to reintroduce these rules into current contracts or installed Skills.

The earlier rule that a normal vNext entry must recognize an old workflow-system
schema and return `migration-required` is also superseded. Legacy detection,
compatibility behavior, and migration reminders are not vNext Runtime product
goals or acceptance requirements; the architecture neither requires nor forbids
an implementation from recognizing such input for internal safety. The separate
Migration Pack remains available through an explicit operator invocation. An
input that declares itself as vNext but carries an invalid or unsupported vNext
schema still fails closed through the existing schema-validation boundary; this
decision introduces no new error category.

## 5. What E changed

### Architecture and design

- Reconciled P-03/P-06/P-07/P-09/P-12/P-13 with the implemented A–D boundaries.
- Updated the actual public exposure/mode table, including `amend-scope`, fresh successor behavior and the current no-`report-only` `review-change` mode surface.
- Replaced the old general same-task supersede/replan design freeze with restricted correction + independent amendment + fresh successor semantics.
- Updated the implementation blueprint and the historical business-evidence/test-strategy documents so stale prose cannot be interpreted as current instructions.

### Current source/contract guidance

- Align bootstrap protocol/schema wording with risk-selected dynamic review.
- Align bounded context support with the existing successor route.
- Align `debug-task` route recommendations with bounded correction/amendment/fresh-successor semantics.
- Align the Source Contract P-12 selection wording with whole-set minimum-sufficient semantics.
- Replace the stale Runtime Contract label `supersede-or-replan` with a descriptive bounded route label; this changes contract description/validation, not the underlying task-evolution behavior.

### Explicit non-changes

E adds no public Skill, lifecycle status, Test Registry, AST/test-discovery platform, generic runner, task-size/history gate, garbage collection, mandatory E2E, mandatory mutation testing, or mandatory Red/TDD flow. It does not reinstall a target project or publish a package/version.

## 6. Remaining real-effect validation

The following are deliberately **not** closed by source convergence:

1. **Fresh-Agent minimum-sufficient selection.** D has guidance and known-defect detection calibration, but a fresh model in a real source context has not yet demonstrated stable selection quality or lower aggregate test cost.
2. **A/B/C/D combined workflow friction.** The source repository has targeted regressions, but the complete updated workflow has not yet been used for a representative real target-project task after a single unified install.
3. **Longitudinal task storage growth.** C can measure current/transaction growth; there is not yet enough real longitudinal data to choose a second storage-thinning target.
4. **Internal hydration/performance.** Model-facing reads are bounded, but the total internal cost of canonical integrity/history hydration is not proven bounded.

These are dogfood/measurement obligations, not reasons to add new lifecycle gates before the real run.

## 7. Next phase

After this E convergence is verified, stop expanding the source architecture. Install the unified A/B/C/D/E version into one real target project, run representative business work, retain C diagnostics and D selection evidence, and evaluate:

- A: whether legitimate user decisions and local engineering continuations avoid needless escalation;
- B: whether active task context remains small and usable without losing exact recovery/audit material;
- C: which transactions actually drive durable growth;
- D: whether fresh Agent selection detects the relevant business failures without default broad/full/E2E execution.

Only real evidence from that run should drive the next narrow correction.
