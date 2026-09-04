# Workflow vNext Implementation Blueprint

- **Status:** `Implementation blueprint`
- **Date:** `2026-09-02`
- **Scope:** vNext Distribution 安装项目的 Skill 重写与 Runtime 责任划分
- **Purpose:** 把已确认的 Target Architecture 翻译成一张可直接执行的 Skill owner map

这不是新的 shadow 方案、测试平台或兼容层设计。它是后续重写 Skill 模板时的实施依据：每一个旧 Skill 的治理语义必须有唯一的 vNext 归属；每一项持久化写入必须有明确的 Runtime handler。

## 1. 使用边界

本蓝图以以下文档为输入：

- [`workflow-vnext-target-architecture.md`](workflow-vnext-target-architecture.md)
- [`workflow-vnext-migration-plan.md`](../product/workflow-vnext-migration-plan.md)
- [`workflow-skill-kmrd-audit.md`](../product/workflow-skill-kmrd-audit.md)
- [`vibe-governance-distribution-installation.md`](vibe-governance-distribution-installation.md)

实施时遵守以下边界：

- vNext 的日常入口只有七个；内部 capability 不是用户可见的串行 Skill。
- 旧 Skill 名称只作为责任迁移的输入，不作为 vNext 的 alias、fallback 或安装面。
- `review-change` 与 `validate-change` 是只读/报告型入口；它们不直接写治理状态，也不直接修复代码。
- Runtime 只提交 typed semantic proposal，不替模型或用户决定产品语义。
- Migration Pack 是安装前的独立离线工具，不是 vNext Skill，也不是 Runtime capability。
- Distribution 与 governance state 分离；正常目标项目通过 `npx vibe-governance@latest install|migrate|upgrade` 获取软件，`Install != Bootstrap`。
- vNext canonical Skill surface 是 `.agents/skills/<skill-name>/SKILL.md`；旧 `.codex/skills/`、`.claude/skills/`、`.factory/skills/` 只保留为 legacy/source compatibility，不进入新的 Distribution metadata。
- 本蓝图不把 Phase 1 原型脚本、shadow runner、12-case 对照 runner 或测试通过情况当成正式实现基础。

## 2. vNext 入口实施表

下表是后续 Skill 重写的主表。`合并旧 Skill` 指责任片段的归属，不表示保留旧文件或旧 prompt。`Runtime 写入`只列治理数据写入；`execute-step` 对产品代码的修改属于已授权的业务工作，不等同于 Runtime transaction。

| vNext entry | 合并哪些旧 Skill / 责任片段 | 必须保留的治理语义 | Internal capabilities | Runtime 写入 |
|---|---|---|---|---|
| `prepare-task` | `create-current-task`、`review-current-task`、`lock-scope`、`classify-decisions`、`plan-implementation`、`decompose-task`；`execute-current-task` 的准备/转换边界 | task identity；一个 coherent business goal 与 acceptance claims；足够宽的 read/discovery context；尽可能精确的 `Allowed / Conditional / Forbidden` mutation scope；authority 与 decision 分类；按 claim 规划 minimum-sufficient evidence；persistent test 默认不准入；少量可独立验证 steps；只在 risk/logical boundary 设置 review checkpoint；planning、替代方案、风险/rollback、validation；UI/release 条件；新任务先形成 durable `draft + active`，同草案可 refinement，只有显式 `confirm` 才能进入 `active + active`；不写产品代码、不覆盖 Profile/Contracts | `project-context-resolver`；`source-authority-policy`；`task-identity-guard`；`scope-guard`；`decision-authority-gate`；`adaptive-depth-policy`；`evidence-admission-policy`；条件性的 `propagation-evidence-validator`、`design-evidence-gate`、`release-evidence-gate`、`external-documentation-gate`；恢复/重规划时的 `resume-review-gate` | `task-state-transaction`：`create-draft`、`update-draft`、`confirm-draft`、resume gate、replan 等 typed task-state actions |
| `execute-step` | `implement-current-step`；`continue-current-step` 的有效状态转换；`debug-and-fix-current-task` 的 admitted repair 分支；`execute-current-task` 的执行分支 | 只能执行当前已准备且 admitted 的一个 step；可读取更宽的 context 追踪数据流/root cause，但只能写 admitted mutation scope；使用 claim-bound minimum-sufficient evidence；共享且明确的 diff target；scope default-deny；dangerous operation 授权；design/decision gate；External Documentation Gate；persistent test 不得自行准入；repair 必须是 current-owner、in-scope、mechanical 且已准入；普通 step 不自动触发 full review；修复后必须进入 bounded review convergence，并按证据推进下一 step | `project-context-resolver`；`source-authority-policy`；`task-identity-guard`；`scope-guard`；`adaptive-depth-policy`；`dangerous-operation-gate`；`decision-authority-gate`；`diff-target-resolver`；`evidence-admission-policy`；`finding-admission`；`review-convergence-policy`；条件性的 `design-evidence-gate`、`external-documentation-gate` | `task-state-transaction`；admitted repair 时条件性写 `finding-queue-transaction`；不直接写 Contracts/Decisions/LESSONS；ordinary step advancement 的 typed Runtime enforcement 属于本冻结之后的 implementation slice |
| `review-change` | `review-current-diff`、`review-diff`、`review-implementation`、`verify-contracts` | 只在 required risk/logical checkpoint、final review 或 repair verification 时执行；一个明确 diff target；统一的 scope、goal/acceptance、implementation、contract/propagation、evidence verdict；严格 read-only；`discovery / verification` 是 review cycle phase，不是 public handoff；finding 先 admission 再 repair；`report-only` 是终态；repair verification 必须保留，即使普通 step 跳过 full review | `project-context-resolver`；`read-only-review-guard`；`diff-target-resolver`；`scope-guard`；`source-authority-policy`；`propagation-evidence-validator`；`evidence-admission-policy`；`finding-admission`；`review-convergence-policy`；按触发条件启用 `external-documentation-gate` | **无**。可返回结构化 finding/evidence gap，但不直接写 queue、CURRENT_TASK、代码或 knowledge |
| `debug-task` | `investigate-root-cause`；`debug-and-fix-current-task` 的 investigation、root-cause 和 repair-decision 分支 | 区分新 bug、report-only investigation、current-task debugging；先 reproduce 再提出 hypothesis；current-task debugging 或需要写 task-state/resolve 时确认 owner 与 active task，新 bug 的普通 investigate-only 可无 current task；最多有限次不收敛尝试后 stop；外部行为影响正确性时查当前文档；debug 不直接写产品代码；`resolve` 只负责确认修复路线，修复交给 `execute-step:repair` | `project-context-resolver`；`root-cause-loop`；`owner-route-resolver`；`source-authority-policy`；`scope-guard`；`decision-authority-gate`；`evidence-admission-policy`；条件性的 `external-documentation-gate`、`review-convergence-policy` | current task 调试证据/风险/检查点可写 `task-state-transaction`；新 bug 或 report-only 默认无写入；不由该入口直接提交产品修复 |
| `task-lifecycle` | `pause-current-task`、`interrupt-current-task`、`resume-paused-task`、`resume-interrupted-task`、`supersede-current-task` | workflow status 与 lifecycle state 分离；pause 与 interrupt 不混淆；保存完整 snapshot、checkpoint、dirty attribution、environment、recovery strategy；各 mode 只要求其所选 transition 的必要 evidence；resume 必须指定唯一包并先过 review gate；supersede 只用于 goal/scope/acceptance 已失效且保留原历史；不从“latest package”猜恢复对象 | `project-context-resolver`；`lifecycle-transition-guard`；`task-identity-guard`；`owner-route-resolver`；`resume-review-gate`；`source-authority-policy`；`decision-authority-gate`；`scope-guard` | `lifecycle-transaction`；supersede/replan 的任务事实条件性写 `task-state-transaction`；不承担旧项目 paused/interrupted 热迁移 |
| `capture-work-item` | `capture-work-item` | 仅记录已证明与当前任务无关的工作；`TASKS/inbox/**` record-only；scope widening、uncertainty、duplicate suspicion fail closed；绝不创建/切换/修改 CURRENT_TASK、lifecycle、identity、catalog | `record-only-intake-guard`；`owner-route-resolver`；`scope-guard`；必要时使用 `project-context-resolver` 确认当前 owner | `inbox-record-transaction`：最多创建一个 inbox record，不触碰 active task |
| `close-task` | `close-current-task`、`prepare-delivery-summary`、`archive-task` | closure eligibility 先于 archive；successful terminal tuple 为 `closed + archived`；在 archive 前完成 Contract/Decision/Lesson admission，archive 后按 admission 只 reconcile 缺失的长期知识、Lesson 与 STATUS；保留 acceptance、verification、release health、rollback、observation、remaining risks；summary 不能把 blocker 美化成 complete；identity/slug/archive path 稳定；implementation anchors 仅为已观察的导航提示 | `project-context-resolver`；`closure-eligibility-gate`；`task-identity-guard`；`evidence-admission-policy`；条件性的 `release-evidence-gate`；`knowledge-admission-policy` | `archive-transaction`、`contract-candidate-commit`、`decision-record-transaction`、`project-status-transaction`；显式准入的 Lesson 才使用 `lesson-record-transaction` |
| `bootstrap-project`（admin） | `design-baseline-init`、`greenfield-init`、`legacy-inventory`、`adopt-existing-project`、`realign-workflow-assets` | `design / greenfield / inventory / adopt / realign` 保留不同 precondition、authority、write boundary 和 stop condition；只记录 confirmed facts；保留 inferred/unknown 与 provenance；realign 只处理 workflow-owned assets，保护 target facts、用户文档、native host assets；不创建 feature implementation | `project-context-resolver`；`source-authority-policy`；`design-evidence-gate`；`decision-authority-gate`；`scope-guard`；`propagation-evidence-validator`；`host-isolation-guard`；`generation-atomicity-policy`；必要时 `dangerous-operation-gate` | 按 mode 使用 `contract-candidate-commit`、`decision-record-transaction`、`project-status-transaction`、`paired-host-guidance-transaction`；不创建 active task |
| `validate-change`（expert/automation） | `run-regression` | QA evidence closed set；复用同一 diff target；unit/integration/browser/visual/release/canary/benchmark 等由 evidence policy 选择；report-only 不触发 sync/debug/repair；失败只路由到 `debug-task` 或用户，不隐式修复 | `validation-layer-gate`；`diff-target-resolver`；`read-only-review-guard`；`evidence-admission-policy`；`owner-route-resolver`；按触发条件启用 `release-evidence-gate`、`external-documentation-gate` | **无**。允许声明的临时 build/cache/test artifacts，但不写 canonical governance state |
| `sync-state`（internal） | `sync-current-task`、`sync-status`、`sync-contracts`、`sync-decisions`、`sync-host-guidance`、`sync-review-findings`、`capture-lessons`；以及对应 Runtime transaction surface | 只接受 typed semantic delta；caller 提供 authority、evidence、source tuple、scope 和 idempotency；Contract/Decision/Lesson 使用 knowledge admission；finding 只有 current-owner、in-scope、mechanical 且去重后才能进 queue；append-only/provenance、host pairing、exact source/write allowlist；不是任意 Markdown editor | `knowledge-admission-policy`；`source-authority-policy`；`decision-authority-gate`；`propagation-evidence-validator`；`finding-admission`；`owner-route-resolver`；`host-isolation-guard`；`generation-atomicity-policy`；条件性的 `closure-eligibility-gate` | 按 operation kind 精确调用：`task-state-transaction`、`project-status-transaction`、`contract-candidate-commit`、`decision-record-transaction`、`paired-host-guidance-transaction`、`finding-queue-transaction`、`lesson-record-transaction` |

`execute-current-task` 与 `debug-and-fix-current-task` 都按语义边界拆分到多个新入口；这表示拆责任，不表示保留两个旧 wrapper。其余旧 Skill 由上表唯一归属，旧文件、旧 registry entry 和旧 public route 在 vNext Distribution 安装中均不存在。

### 2.1 Slice B frozen owner map

`task-lifecycle:supersede` and `prepare-task:replan` are separate transactions under one task identity. `TASK_ID`, `TASK_SLUG`, and document identity remain unchanged. A new identity is allowed only through the ordinary new-task path for a genuinely independent user request.

| Caller | Owns | Does not own |
|---|---|---|
| `task-lifecycle:supersede` | invalidation kind (`goal | scope | acceptance`), reason, authority/evidence, partial-diff disposition, removal of old execution authority, typed SupersedeDelta | replacement goal, acceptance, scope, implementation plan, or steps |
| `prepare-task:replan` | relevant context, new goal/acceptance/scope, affected contracts, decisions/open questions, bounded approach/steps, validation, rollback/recovery, conditional design/release/propagation requirements, typed ReplanDelta | generic Markdown patching, state transition mechanics, history mutation, idempotence, rollback, or read-back |
| Runtime | schema/source/identity/transition/authority validation, closed section replacement, atomic commit, idempotence, rollback, read-back | deciding whether invalidation or partial-diff disposition is semantically correct |

The durable statuses are deliberately not public modes. `blocked_by_replan + active` is a non-active owner state for unsafe continuation without sufficient authority/evidence/decision to invalidate; `superseded + active` is a non-active owner state after formal invalidation. Both forbid `execute-step`, pause, and interrupt. The first may clear to `active + active` when authoritative evidence proves the old definition valid, or supersede when invalidation is confirmed. The second can only return to `active + active` through successful `commit-replan`. A blocked replan never rolls back a successful supersede.

The Slice B task-state action set is closed to `mark-replan-blocked`, `clear-replan-block`, and `commit-replan`. All three have `caller: prepare-task` and `mode: replan`; Slice B does not make `commit-replan` an arbitrary active-task replanning writer. `supersede` remains `caller: task-lifecycle`, `operation: lifecycle-transaction`.

### 2.2 Slice C frozen owner map — ordinary draft and confirmation

The ordinary new-task path is distinct from Slice B same-task replan:

| Caller / action | Owns | Does not own |
|---|---|---|
| `prepare-task` / `create-draft` | genuinely independent request, next unused identity allocation, concrete slug/document identity, closed draft definition, `draft + active` creation | executing code, confirming without explicit authority, changing an existing draft identity |
| `prepare-task` / `update-draft` | same draft refinement, replacement of the closed task-definition sections, admitted draft step reset | TASK_ID/TASK_SLUG/document_id, execution history, arbitrary Markdown, automatic confirmation |
| `prepare-task:confirm` / `confirm-draft` | explicit authority boundary and draft-to-active status transition | task-definition edits, identity changes, implicit user decisions, execution |
| Runtime | typed schema, exact source revision, identity/tuple/authority validation, atomic commit, replay, rollback, and read-back | deciding product semantics or treating model text as user confirmation |

The three actions remain in the existing `task-state-transaction`; no draft
registry, catalog, queue, cancel/discard state, or second CURRENT_TASK source is
introduced. `create-draft` accepts only `closed + archived` (with bootstrap
`TASK-000` as the initial baseline), `update-draft` accepts only
`draft + active`, and `confirm-draft` accepts only `draft + active`. A draft is
never executable until the confirmation transaction succeeds.

## 3. Skill 重写的统一契约

每个 vNext entry 的模板都应先声明以下信息，再写模型行为说明：

```yaml
name: <vNext-entry>
description: <loader-visible skill description>
entry_contract:
  entry: <vNext-entry>
  mode: [<closed-mode>]
  intent: <caller-visible-intent>
  input_contract:
    required: []
    optional: []
    cycle_phase: [] # review-change only
  authority_owner: <user|task|contract|runtime|none>
  mutation_boundary:
    product_files: []
    governance_sources: []
    forbidden_targets: []
  internal_capabilities: []
  runtime_operations: []
  stop_conditions: []
  output_kind: <report|prepared-task|change-result|proposal|lifecycle-result>
```

`mode` 在模板中声明该 entry 的闭集；一次调用只能选择其中一个值。它不是内部阶段列表，也不是可自由扩展的字符串。`cycle_phase` 若存在，只能作为 `review-change` 的输入字段，取 `discovery | verification`，不得出现在 `mode` 或任何 handoff 字段中。

Skill 的共同执行形状是：

```text
resolve relevant context
        ↓
admit intent/mode and mandatory gates
        ↓
select conditional capabilities by trigger
        ↓
produce result or typed semantic proposal
        ↓
if durable write is authorized: Runtime validates and commits
        ↓
read back canonical Markdown/YAML and return structured result
```

其中：

- `project-context-resolver` 只读并返回 source locator、authority、relevance、freshness、conflict 和 exclusion trace；不会把旧 schema 转成新 schema。
- adaptive depth 只决定可选规划与证据的深度，不能跳过 authority、scope、decision、dangerous、evidence 等必需 gate。
- capability 之间可以共同评估或按需加载，不能再写成 `scope-review → implementation-review → contract-review` 一类 public BPM 链。
- `review-change`、`validate-change`、`debug-task` 的 report-only 分支都必须有明确 terminal result，不得隐式发起 handoff 或写入状态。

### 3.1 Phase 1A locked source contract

本节保留 Phase 1A 的历史锁定快照；它描述当时尚未绑定 Runtime 的三入口
检查点，不覆盖当前 Phase 2 实现状态。当前 `prepare-task` 的
`create-draft`、`update-draft`、`confirm-draft` 绑定与状态以 §3.5、§5 和
`.workflow-system/vnext/RUNTIME_CONTRACT.yaml` 为准。

Phase 1A 只实现三个 vNext entry，每个 entry 只有一个模板文件，且模板位于独立的 vNext source namespace：

```text
templates/vnext/skills/prepare-task.SKILL.md.tmpl
templates/vnext/skills/review-change.SKILL.md.tmpl
templates/vnext/skills/execute-step.SKILL.md.tmpl
```

该 namespace 与 `templates/skills/`、当前 37 个旧 Skill 的 generator、registry、pack、install 和 host sync 完全分离。Phase 1A 不修改旧模板生产链，也不把 vNext source namespace 纳入现有安装面。

三个 entry 的 mode 闭集固定如下：

| Entry | Closed mode set | Input-only cycle phase | Output kind | Direct mutation boundary | Phase 1A Runtime status |
|---|---|---|---|---|---|
| `prepare-task` | `default`, `replan` | none | `prepared-task` | `product_files: []`; no direct governance writes | `task-state-transaction` may be referenced as `contract-only / unbound / Phase 2` |
| `review-change` | `default`, `report-only` | `discovery`, `verification` | `report` | `product_files: []`; `governance_sources: []` | `runtime_operations: []` |
| `execute-step` | `default`, `repair` | none | `change-result` | product files only inside the admitted scope; no direct governance writes | governance operations remain `contract-only / unbound / Phase 2` |

For `review-change`, both direct mutation lists and `runtime_operations` must be empty. `discovery` and `verification` describe the review cycle input; they are never public modes, executable handoffs, or automatic stage transitions. `execute-step:repair` consumes an admitted finding or confirmed root cause and a bounded repair budget; it does not silently acquire review, debug, or Runtime write authority.

`mutation_boundary` means only direct Skill writes. Durable governance proposals are declared separately in `runtime_operations`. The Phase 1A templates may describe those proposals so their future contract is reviewable, but no Phase 1A entry is bound to a Runtime handler and no template may imply that it can write `CURRENT_TASK`, a finding queue, Contracts, Decisions, or Lessons.

The Runtime operation catalog uses the following closed status tuple for Phase 1A:

```yaml
runtime_operation:
  status: contract-only
  binding: unbound
  implementation_phase: Phase 2
```

`contract-only` means that the operation identity and write boundary are declared; `unbound` means no Phase 1A entry may execute it; `Phase 2` is the earliest implementation/binding phase. At minimum, `task-state-transaction` and `finding-queue-transaction` must be present in the catalog with exact source/write targets and their Phase 1A non-executable status.

### 3.2 Phase 1A capability closure and exposure

Capability references in the three core entries are a closed set. The source catalog must contain every referenced ID with a lightweight contract for trigger, input, output, and stop condition. It is not sufficient to register only the six initially highlighted capabilities. The minimum union referenced by the three entries is:

```text
project-context-resolver
source-authority-policy
task-identity-guard
scope-guard
decision-authority-gate
adaptive-depth-policy
propagation-evidence-validator
design-evidence-gate
release-evidence-gate
external-documentation-gate
resume-review-gate
read-only-review-guard
diff-target-resolver
evidence-admission-policy
finding-admission
review-convergence-policy
dangerous-operation-gate
```

`knowledge-admission-policy` may be declared in the shared catalog as an internal policy contract for later entries, but none of the three Phase 1A entries may use it to write durable knowledge. Every capability record is `exposure: internal`, has no public Skill handoff, and lives under the capability/policy namespace rather than as a `.SKILL.md.tmpl` public entry. An internal capability ID must never appear in the public entry catalog.

The validator must fail closed when:

- an entry or mode falls outside the closed Phase 1A sets;
- a `review-change` contract has any direct write target or Runtime operation;
- a capability or Runtime reference is missing from its catalog;
- a capability is exposed as a public `.SKILL.md.tmpl` entry;
- `cycle_phase` is promoted into a mode or handoff;
- a Phase 1A template contains old-style `stage`, `handoff`, `conditional_handoff`, or `benefits-from` fields;
- an old 37-Skill ID is used as a vNext executable target or handoff.

The validator may scan the vNext template frontmatter and body for these forbidden executable references. Historical responsibility mappings remain in the blueprint and audit documents; they must not be copied into the executable vNext template namespace.

### 3.3 Phase 1A source-contract tests

The source contract and templates require tests. The test scope is deliberately small and structural; it does not test model prose, build a shadow runner, or create a legacy-vs-vNext behavior matrix.

Phase 1A must provide one source validator and a focused test file covering at least:

1. exactly three public vNext templates, unique entry IDs, required contract fields, and the closed mode sets;
2. `cycle_phase` as review input only, never a mode or handoff;
3. the per-entry direct mutation/runtime-operation matrix above, including `review-change` zero-write/zero-runtime behavior;
4. complete capability and Runtime reference closure, internal capability exposure, and `contract-only / unbound / Phase 2` Runtime status;
5. rejection of old frontmatter fields and all old 37-Skill executable targets;
6. rejection of missing, duplicate, or mis-exposed capability and Runtime records.

These tests should use small in-memory mutations or a few temporary contract files for negative cases. They must not reuse the historical shadow fixture matrix or the experimental shadow tests as vNext evidence. Once the validator and templates exist, a dedicated `test:workflow-vnext-source` command must join `test:workflow-all` as a real source-contract gate; `test:workflow-vnext-shadow` remains standalone and excluded from the formal gate.

### 3.4 Phase 1 follow-up source checkpoint

After the Phase 1A three-entry manual review passed, the same independent namespace was extended with the remaining four daily entries: `debug-task`, `task-lifecycle`, `capture-work-item`, and `close-task`. The Phase 1 checkpoint had seven daily templates and a closed capability union. Phase 2 now binds `task-state-transaction` and `finding-queue-transaction` for `execute-step`, the Slice A lifecycle transaction for `task-lifecycle` pause/interrupt/resume modes and the minimal `prepare-task` resume-review gate clear action, the Slice B supersede/replan actions, the Slice C ordinary draft/create/refinement/confirm actions, close-task archive/status/Lesson plus final Contract/Decision promotion and re-entry transactions, `capture-work-item:record` through `inbox-record-transaction`, and the `bootstrap-project` administrative transaction boundary. The `validate-change` expert source/install surface is now implemented as a read-only evidence-policy entry with no Runtime operation. The `sync-state` implementation gap review is resolved as an architecture assessment: its current responsibilities are fulfilled by caller-local orchestration and existing typed Runtime handlers, so no standalone service is required. This is an implementation-status note only; it does not change the target architecture, install surface, host sync, or Migration Pack boundary.

### 3.5 Phase 2 bound Runtime slice

The first state-changing slice is implemented by the project-local Node Runtime
package at `.workflow-system/runtime/` (the source repository keeps its
authoritative implementation in `runtime/vnext/src/`, while
`scripts/vnext-runtime.ts` is only a development wrapper) and described by
`.workflow-system/vnext/RUNTIME_CONTRACT.yaml`. It accepts only a
pure-vNext canonical `CURRENT_TASK.md` with an in-document `runtime_state`,
validates the exact source tuple and authority/evidence envelope, and commits
typed task-state, finding-queue, or lifecycle deltas through one shared atomic
kernel. The kernel owns deterministic schema, path, conflict, idempotency,
package-marker, package-revision, rollback, and read-back checks; the model remains responsible
for semantic admission. Slice A's lifecycle handler covers only pause,
interrupt, and the two explicit resume modes. `prepare-task` may call the
Runtime for the resume-review gate clear action, Slice C's ordinary
`create-draft` / `update-draft` actions, and the explicit `confirm-draft`
action; `create-draft` requires prior task archive and complete post-archive reconciliation;
ordinary drafts enforce strict step admission beginning at the first admitted step;
`confirm-draft` requires `mode: confirm`, the exact current draft revision, and explicit confirmation authority binding current task identity, document identity, and draft revision. It cannot use those bindings to mutate unrelated task facts. Slice B
supersede and durable replan, plus the close-task archive/status/Lesson and
ordinary Contract/Decision promotion handlers, are also implemented in the
source-repository Runtime. `debug-task`
and the remaining later operation callers remain proposal-only until their own
phase. The Runtime never parses or hot-migrates legacy paused/interrupted
artifacts.
The Runtime package, lockfile, generated Node entrypoint, and Skill artifacts
are promoted from one source-bound bundle; installation stages its own
`node_modules` with `npm ci --omit=dev` and runs the Node self-check before
atomic promotion. The target's business package and `node_modules` are outside
this boundary.

### 3.6 Core Daily Execution Semantics freeze

The following three rules are now the implementation boundary for the next
daily-execution slice:

1. **Evidence-first / Persistent Test Admission** — `prepare-task` starts from
   business goal and acceptance claims, then plans risks / invariants and the
   minimum-sufficient evidence for each claim. Validation, reuse of an existing
   test, and creation of a persistent test are separate decisions. A new
   persistent test is not admitted by default and requires an explicit owner,
   claim, why existing evidence is insufficient, and one of
   `acceptance` / `regression` / `critical-invariant` / `critical-risk`. An
   explicit user `test_write_policy: deny` forbids new persistent tests while
   leaving existing validation available.
2. **Mutation-oriented Scope** — `project-context-resolver` may read broadly
   enough to understand callers, consumers, types, configuration, tests, and
   root cause. `Allowed / Conditional / Forbidden` remains a write boundary.
   Ordinary `Allowed` scope is exact-file or file-plus-symbol/responsibility
   where known; broad globs require an inherently broad transformation.
   Conditional expansion requires its stated evidence / authority. A changed
   goal, scope, or acceptance is replan work.
3. **Task / Step / Review Checkpoint / Repair** — one coherent business goal
   remains one TASK; it is split into a small number of independently verifiable
   admitted steps. `execute-step` handles only the current step. Minimum evidence
   may advance a low-risk step without a full review. Contract, lifecycle,
   security, destructive, release, major UI, broad-propagation, or other
   critical-invariant boundaries may trigger a review checkpoint. Any admitted
   repair must be followed by `review-change` verification of the same logical
   diff before advancement.

The canonical task sections remain the only representation: acceptance /
regression sections carry claims and evidence; scope sections separate read
context from mutation targets; and implementation steps carry step identity,
purpose, bounded scope, required evidence, and checkpoint policy. No new public
Skill, review BPM stage, test registry, test state machine, or ACL subsystem is
introduced. The current Runtime makes the ordinary draft/confirm boundary
durable through typed `create-draft`, `update-draft`, and `confirm-draft`
actions; ordinary `STEP-N → STEP-N+1` advancement remains the later execution
slice described below.

## 4. 关键宏观路由

入口之间只保留改变 intent、authority、lifecycle 或 mutation phase 的宏观转换；
普通 step 的推进和 review checkpoint 选择属于同一 TASK 内部的执行政策：

```text
closed + archived
    ↓ independent request / create-draft
prepare-task:default
    ↓ durable draft + active; optional same-identity update-draft refinement
prepare-task:confirm
    ↓ exact draft revision + explicit authority / confirm-draft
active + active
    ↓
execute-step STEP-1

prepare-task
    ↓ one goal + claims + precise scope + admitted steps/evidence/checkpoints
execute-step STEP-N
    ↓ minimum-sufficient evidence
    ├─ no required checkpoint → durable advancement → execute-step STEP-N+1
    └─ required checkpoint / final review → review-change (discovery)
         ├─ clean → durable advancement → execute-step STEP-N+1
         ├─ admitted mechanical finding → execute-step:repair
         │                                  ↓
         │                             review-change (verification)
         │                                  ├─ clean → durable advancement
         │                                  └─ bounded stop / debug / user
         ├─ needs-evidence → provide claim-bound evidence
         ├─ unknown root cause → debug-task
         └─ user-owned / scope / contract decision → stop and ask or replan

task-lifecycle:resume-paused / resume-interrupted
    ↓ lifecycle transaction success + resume_requires_review=true
prepare-task (readiness/resume review → clear-resume-review-gate; ordinary draft → create/update/confirm)
    ↓ gate clear
execute-step

debug-task:resolve
    ↓ root-cause-confirmed + authorized
execute-step:repair

review / evidence / acceptance complete
    ↓ closure eligible
close-task
```

Review Convergence 的默认边界由 Target Architecture 负责：同一 fingerprint 最多两次 repair attempt，review cycle 最多三轮，verification 阶段最多一个 new-finding admission wave；每个 repair proposal 必须绑定当前 `review_cycle_id` 与 `repair_wave_id`，同一 wave 的多个 admitted finding 只计一轮，同一 fingerprint 在同一 wave 只计一次，已结束的 repair wave 不得复用。`execute-step` 不能通过修改 cycle ID 重置预算；只有当前 cycle 的 admitted/in-progress findings 全部进入终态后，新的 finding admission 才能建立一个从零开始的新 review cycle。无法收敛、需要用户决定或根因未知时 stop。`review-change` 不自己写 queue；在当前 Phase 2 中，`execute-step` 是 finding-queue 的 Runtime caller，`sync-state` 保留为逻辑 internal reconciliation/routing role，而不是额外的实际调用面。

## 5. Runtime 写入矩阵

Runtime handler 的 source set、write set、precondition、conflict rule 和 postcondition 必须是闭集。以下矩阵是 Skill 重写时的最小调用面：

| Operation | Canonical source / write target | 允许的 caller | 关键限制 |
|---|---|---|---|
| `task-state-transaction` | `CURRENT_TASK.md` 及其 vNext task state | `execute-step`；`prepare-task` 用于清除 resume-review gate、在 `default` mode 使用 Slice C 的 `create-draft` / `update-draft`，或在 `confirm` / `replan` mode 使用各自闭集 action | Slice C 的 create 只接受 `closed + archived` 并分配新 identity；update 保留同一 identity；confirm 使用 exact draft revision 与显式 authority；replan actions 只接受同一 task identity；不得任意改写其他 task facts；普通 step advancement 仍需后续补齐 evidence/checkpoint-aware durable transition |
| `lifecycle-transaction` | `CURRENT_TASK.md` 与 `TASKS/paused/...` / `TASKS/interrupted/...` vNext snapshot/recovery package | `task-lifecycle` | pause/interrupt/explicit resume only；resume proposal 必须携带 package SHA-256 revision；exact task identity、合法 tuple、显式唯一包、原子读回与双文件 rollback；rehydrated package 可被下一轮同 kind suspend 覆盖；不读取或热迁移旧 paused/interrupted runtime |
| `inbox-record-transaction` | source: `CURRENT_TASK.md`, existing `TASKS/inbox/**`; write: one derived `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` | `capture-work-item:record` | typed unrelated relation/evidence, `duplicate_check: clear`, resolved owner; stale source, unsafe/mismatched path, identity/provenance collision, and read-back failure fail closed；不升级成 task、catalog、lifecycle 或 archive |
| `finding-queue-transaction` | admitted finding queue | `execute-step` 的 admitted repair | 先过 finding admission；current-owner/in-scope/mechanical；稳定 fingerprint 与 provenance；去重 |
| `project-status-transaction` | `STATUS` / approved status baseline | `close-task`、`bootstrap-project` | status 是 descriptive；缺 evidence 时只能是 blocked/observing 等真实状态 |
| `contract-candidate-commit` | `CONTRACTS` | `bootstrap-project`、`close-task` | 先过 knowledge admission；只收 verified stable boundary；不锁定临时实现，不静默放宽已有 Contract；可保存少量 observed implementation anchors，但不声明完整性 |
| `decision-record-transaction` | `DECISIONS` | `bootstrap-project`、`close-task` | 只提交 confirmed authority；append-only；supersede 要保留 predecessor、原因与 provenance；anchors 只是当前代码导航提示 |
| `paired-host-guidance-transaction` | 成对 host guidance surfaces | `bootstrap-project` | 保持语义对齐；保护 target-owned/native 内容；临时 workaround 不得升级成全局规则 |
| `lesson-record-transaction` | `LESSONS` | `close-task` 的显式 lesson phase | 先过 reusable trigger、cause、action、evidence、consumer 和 dedup；Candidate Identity 四坐标由 persisted/reused 共用字段 validator 严格校验；当前只接受 canonical-v1 marker，旧 transitional shape fail closed；一过性观察为 no-op/defer |
| `archive-transaction` | `CURRENT_TASK.md` 与 canonical `TASK` archive | `close-task` | 独占 `active + active` → `closed + archived` terminal mutation；task identity、acceptance、validation、release/rollback、remaining risk 均满足后才 archive；两路径原子写、精确回滚且可重放 |

Runtime kernel 只负责 deterministic validation、conflict、idempotence、atomic commit 和 read-back；语义判断仍由 entry、用户和 capability policy 共同完成。不存在一个可以随意写任意治理文档的 generic editor。

本冻结后的实现必须把 `STEP-N completed`、required evidence、required review
checkpoint、repair verification 和 `STEP-N+1 ready` 闭合在 typed Runtime state
transaction 中；Skill 不直接修改 `CURRENT_TASK.md`。这项 ordinary step
advancement / checkpoint enforcement 是下一 implementation slice 的责任，
不在本次 docs-only diff 内。

Close-task 的 transaction 顺序固定为：closure preparation（包含
Contract/Decision/Lesson `knowledge-admission` decision）→
`archive-transaction`（`CURRENT_TASK.md` + exact task archive）→ admitted
`contract-candidate-commit` / `decision-record-transaction` → optional
`lesson-record-transaction` → `project-status-transaction`（`STATUS` only）。
archive 成功后任何下游失败均不回滚 terminal archive；`closed + archived` 的
再次调用不是第二次 closure，而是在验证 matching archive receipt / provenance
后只继续未完成的 Contract/Decision/Lesson/STATUS reconciliation。archive
必须把完整 knowledge admission bundle 写入 `## 知识晋升`，把 Lesson verdict
写入 `## Lessons 回写`；这些都是恢复 provenance，不等于下游文档已经写入。
不存在 close-specific task-state transaction、`closure_id` 或 pending-closure
recovery mode。

Slice B 的 ReplanDelta 使用浅层 typed shape，不携带 arbitrary Markdown patch：

```yaml
semantic_delta:
  kind: task-state
  action: commit-replan
  replacement_definition:
    background_context: <existing-section-content>
    acceptance: <existing-section-content>
    allowed_scope: <existing-section-content>
    conditional_scope: <existing-section-content>
    forbidden_scope: <existing-section-content>
    affected_contracts: <existing-section-content>
    confirmed_decisions: <existing-section-content>
    open_questions: <existing-section-content>
    implementation_plan: <existing-section-content>
    implementation_steps: <existing-section-content>
    regression_checks: <existing-section-content>
    rollback_points: <existing-section-content>
    design_constraints: <existing-section-content-or-null>
    post_release_validation: <existing-section-content-or-null>
    propagation_governance: <existing-section-content-or-null>
  active_step_id: <replacement-step-id>
  evidence_refs: []
```

Successful `commit-replan` sets `active_step_id` from the replacement and `active_step_status: ready`; moves admitted/in-progress findings to deferred/non-actionable; preserves resolved/rejected/already-deferred findings as history; resets `review_cycle` to the canonical `ReviewCycleState` baseline `review-cycle-0` defined in `.workflow-system/WORKFLOW_PROTOCOL.md`; sets `resume_requires_review: false` and `resume_review_reasons: []`; and preserves `execution_log` plus `applied_proposals`. A subsequent finding admission establishes new review authority.

## 6. Migration Pack 与 vNext 的硬边界

Migration Pack 不属于上面的 vNext entry 或 capability graph。它只在旧项目满足 idle precondition 时运行：

```text
old project is idle
CURRENT_TASK has completed close/archive
no active, unresolved, paused, or interrupted recoverable work
        ↓
one-time offline Migration Pack
        ↓
validate complete converted pack
        ↓
install vNext Distribution
        ↓
old Skills no longer exist
```

Pack 的唯一职责是对以下范围做确定性的机械转换：

```text
CONTRACTS
DECISIONS
LESSONS
STATUS / BASELINES / other long-term governance documents
TASK archives
workflow schema/version
Skill installation surface
```

允许的转换链是：

```text
old Markdown
  → new heading/schema
  → stable IDs
  → provenance
  → path/reference adjustments
  → validation
```

Pack 必须保留原始文本和权威事实，不要求 AI 重新理解历史语义；不得猜 Lesson 的 symbol 适用范围、语义重复关系、semantic tags 或 inferred merge/supersede。上述判断留给未来 vNext 的 `project-context-resolver` 和显式的 `knowledge-admission-policy`，而不是迁移时批量重写历史。

`CURRENT_TASK`、active finding repair、paused/interrupted runtime state 不在 Pack 输入范围内。检测到旧或不支持的 schema 时，vNext 只返回：

```text
migration-required
→ stop
```

vNext Skills 不负责理解旧协议；不存在长期 legacy fallback、长期 version-aware reader 或业务项目双轨安装。

## 7. 实施顺序

| 阶段 | 直接实施内容 | 不做什么 |
|---|---|---|
| Phase 1A | 固定 entry contract；建立独立 vNext source namespace；只实现 `prepare-task`、`review-change`、`execute-step` 三个单文件模板及其闭合 capability/Runtime catalog；通过 source-contract validator 与人工去流程化审查后停止 | 不扩张 shadow runner；不把旧 Skill 安装到 target；不让 vNext reader 解析旧 schema；不绑定 Runtime 写入；不实现非 idle state migration |
| Phase 1（后续） | 在 Phase 1A 检查点通过后，补齐其余 daily entry 的最小结构，并保持同一 contract/capability/runtime 边界 | 不把外围入口提前混入 Phase 1A；不以新增测试基础设施作为交付目标 |
| Migration Pack | 实现 idle preflight、离线副本转换、stable ID/provenance/path-reference、完整 validation 和 vNext Distribution atomic installation | 不关闭/归档 active task；不恢复 paused/interrupted；不做语义去重或 AI 历史重写 |
| Phase 2 existing execution/finding slice | vNext `execute-step` state-changing workflow；task-state/finding queue；evidence admission、finding admission、Review Convergence 和 read-back | 不保留 legacy fallback；不把 review/validation 变成修复入口；该 slice 已实现 |
| Phase 2 Slice A | `task-lifecycle` 的 pause、interrupt、resume-paused、resume-interrupted lifecycle transaction；resume 后经 `prepare-task` readiness/resume review 清除 gate；双文件原子提交、read-back 与 rollback | 不实现通用 lifecycle framework、recovery registry 或 legacy 多阶段事务；该 slice 已实现 |
| Phase 2 Slice B | same-task supersede / replan：保留 identity，分离 invalidation 与 replacement，closed ReplanDelta，deterministic normalization、rollback、idempotence、read-back | 不创建新 task identity、第二份 CURRENT_TASK 或 arbitrary Markdown editor；该 slice 已实现 |
| Phase 2 Slice C | ordinary independent request 的 durable `draft + active`、same-identity refinement、explicit `prepare-task:confirm` / `confirm-draft`、fresh identity allocation、draft non-execution、audit/replay/rollback/read-back | 不创建 draft Skill、registry/catalog/queue、cancel/discard state 或第二份 CURRENT_TASK；该 slice 已实现 |
| Phase 2 close-task | closure eligibility、archive 前 Contract/Decision/Lesson admission、`archive-transaction`、Contract/Decision/STATUS/Lesson reconciliation，以及可从 archive provenance 重建的 re-entry；`closed + archived` terminal contract | 不引入 pending-closure state、第二次 archive 或 `TASK_SUMMARY` vNext output；design + implementation 已完成 |
| Core Daily Execution Semantics Stabilization（已实现） | 只实现本次冻结的三项：Evidence-first / Persistent Test Admission、Mutation-oriented Scope、multi-step advancement / risk-based Review Checkpoint / repair verification integration；已通过 daily-loop E2E gate | 不混入现有 Runtime robustness backlog；不新增 Test Skill/registry/state machine、ACL subsystem、review-step/advance-step public surface；不改变 Slice A/B/close-task 语义 |
| bootstrap-project（已实现） | 在上述 daily semantics 完成并通过 E2E gate 后实现正式 admin surface；已完成 source facade、Runtime atomic boundary 与 disposable-project E2E verification | 不把未稳定的 prepare/execute/review 行为提前推广到新项目；不覆盖 `sync-state` internal surface |
| vNext implementation status | Target implementation boundaries resolved；`sync-state` 为已由 caller-local orchestration 与 typed Runtime operations 覆盖的逻辑 internal role，无 standalone implementation required | 不新增独立 `sync-state` Runtime、Skill、facade、transaction 或 durable artifact，除非未来证明存在 genuine shared reconciliation/routing requirement |
| next phase | system-level E2E validation and real-project dogfood | 不把验证阶段重新包装成 implementation boundary，不扩大 daily intent 或 Runtime surface |

后续 Skill 重写的顺序原则是“先公共契约与三条核心路径，再外围入口，再补齐剩余 state-changing Runtime handlers”。它不以增加测试基础设施为交付目标；现有验证只用于检查蓝图实现是否违反已确认边界。

Migration Pack 的独立实现现位于 `scripts/vnext-migration-pack.ts`，其
`preflight → convert → validate → install` 命令链、Pack/Bundle schema、
source/target identity 绑定、idle-only 检查、canonical Markdown/YAML
结构转换、原文 sidecar 和回滚式安装细节以
`docs/product/workflow-vnext-migration-plan.md §9` 及
`.workflow-system/vnext/MIGRATION_PACK_SCHEMA.yaml` 为实施记录。该状态
说明不改变上表的架构边界：Pack 仍不是 vNext entry、Runtime handler 或
legacy compatibility layer。

## 8. Blueprint 完成标准

本蓝图可作为 Skill 重写入口的前提是：

- 七个 daily entry、`bootstrap-project`、`validate-change` 以及逻辑 internal `sync-state` role 的 exposure 和 owner 清楚；
- 37 个旧 Skill 的治理责任片段均已在第 2 节归属，且没有旧 public route 需要在 vNext 中保留；
- 每个 entry 都能写出 input、authority、mutation boundary、capabilities、Runtime operations、stop conditions 和 output；
- `project-context-resolver`、`knowledge-admission-policy`、Review Convergence、Evidence Admission 均作为内部 policy 使用，而不是新增 public stage；
- review/validation 的零写入边界、finding admission、owner/handoff 分离、scope/dangerous gate 和 External Documentation Gate 都保留；
- Evidence-first、persistent-test 默认不准入、read/discovery 与 mutation scope 分离、精确 write scope、risk-based review checkpoint、repair verification 和 durable step advancement 语义均已冻结；
- 每一项治理持久化写入都映射到一个 exact Runtime handler，且没有 generic document editor；
- 普通任务的 Contract / Decision final knowledge admission 在 `close-task` 中完成；archive 保存 admission provenance，Implementation Anchors 仅作为可选的 observed navigation hints，由未来消费者按当前代码实时验证和扩散；
- Migration Pack 与 vNext runtime 完全分离，旧 schema 在 vNext 中只能得到 `migration-required → stop`；
- 源仓库可暂时保留旧实现与实验 vNext 供开发比较，但 target project 的安装结果是 vNext Distribution，治理事实仍须通过独立 `bootstrap-project` Agent Skill 建立。
- Phase 1A source validator 对三个模板、闭集 mode、零写入 review、引用闭合、内部 capability exposure 和旧 Skill 禁止规则有直接测试；测试不替代人工检查模板是否真正表达单一 intent。

本文件不记录运行时行为测试或模型质量评分；本次 docs-only freeze 不实现上述
daily-semantics enforcement。后续 implementation slice 必须以真实 workflow
fixture / end-to-end behavior 验证 claim、scope、checkpoint、repair 和
advancement，不因本次冻结新增大量细粒度测试。
