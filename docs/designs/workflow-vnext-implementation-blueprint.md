# Workflow vNext Implementation Blueprint

- **Status:** `Implementation blueprint`
- **Date:** `2026-08-31`
- **Scope:** 纯 vNext 安装项目的 Skill 重写与 Runtime 责任划分
- **Purpose:** 把已确认的 Target Architecture 翻译成一张可直接执行的 Skill owner map

这不是新的 shadow 方案、测试平台或兼容层设计。它是后续重写 Skill 模板时的实施依据：每一个旧 Skill 的治理语义必须有唯一的 vNext 归属；每一项持久化写入必须有明确的 Runtime handler。

## 1. 使用边界

本蓝图以以下文档为输入：

- [`workflow-vnext-target-architecture.md`](workflow-vnext-target-architecture.md)
- [`workflow-vnext-migration-plan.md`](../product/workflow-vnext-migration-plan.md)
- [`workflow-skill-kmrd-audit.md`](../product/workflow-skill-kmrd-audit.md)

实施时遵守以下边界：

- vNext 的日常入口只有七个；内部 capability 不是用户可见的串行 Skill。
- 旧 Skill 名称只作为责任迁移的输入，不作为 vNext 的 alias、fallback 或安装面。
- `review-change` 与 `validate-change` 是只读/报告型入口；它们不直接写治理状态，也不直接修复代码。
- Runtime 只提交 typed semantic proposal，不替模型或用户决定产品语义。
- Migration Pack 是安装前的独立离线工具，不是 vNext Skill，也不是 Runtime capability。
- 本蓝图不把 Phase 1 原型脚本、shadow runner、12-case 对照 runner 或测试通过情况当成正式实现基础。

## 2. vNext 入口实施表

下表是后续 Skill 重写的主表。`合并旧 Skill` 指责任片段的归属，不表示保留旧文件或旧 prompt。`Runtime 写入`只列治理数据写入；`execute-step` 对产品代码的修改属于已授权的业务工作，不等同于 Runtime transaction。

| vNext entry | 合并哪些旧 Skill / 责任片段 | 必须保留的治理语义 | Internal capabilities | Runtime 写入 |
|---|---|---|---|---|
| `prepare-task` | `create-current-task`、`review-current-task`、`lock-scope`、`classify-decisions`、`plan-implementation`、`decompose-task`；`execute-current-task` 的准备/转换边界 | task identity；单一目标与 acceptance；`Allowed / Conditional / Forbidden` scope；authority 与 decision 分类；planning、替代方案、风险/rollback、validation；UI/release 条件；每个 step 可独立验证；不写产品代码、不覆盖 Profile/Contracts | `project-context-resolver`；`source-authority-policy`；`task-identity-guard`；`scope-guard`；`decision-authority-gate`；`adaptive-depth-policy`；条件性的 `propagation-evidence-validator`、`design-evidence-gate`、`release-evidence-gate`、`external-documentation-gate`；恢复/重规划时的 `resume-review-gate` | `task-state-transaction`：只写已确认的任务准备、scope、acceptance、step、风险和 handoff 状态 |
| `execute-step` | `implement-current-step`；`continue-current-step` 的有效状态转换；`debug-and-fix-current-task` 的 admitted repair 分支；`execute-current-task` 的执行分支 | 只能执行已准备的 current step；共享且明确的 diff target；scope default-deny；dangerous operation 授权；design/decision gate；External Documentation Gate；evidence admission；repair 必须是 current-owner、in-scope、mechanical 且已准入；修复后必须进入 bounded review convergence | `project-context-resolver`；`scope-guard`；`dangerous-operation-gate`；`decision-authority-gate`；`diff-target-resolver`；条件性的 `design-evidence-gate`、`external-documentation-gate`；`evidence-admission-policy`；`finding-admission`；`review-convergence-policy` | `task-state-transaction`；admitted repair 时条件性写 `finding-queue-transaction`；不直接写 Contracts/Decisions/LESSONS |
| `review-change` | `review-current-diff`、`review-diff`、`review-implementation`、`verify-contracts` | 一个明确 diff target；统一的 scope、goal/acceptance、implementation、contract/propagation、evidence verdict；严格 read-only；`discovery / verification` 是 review cycle phase，不是 public handoff；finding 先 admission 再 repair；`report-only` 是终态 | `project-context-resolver`；`read-only-review-guard`；`diff-target-resolver`；`scope-guard`；`source-authority-policy`；`propagation-evidence-validator`；`evidence-admission-policy`；`finding-admission`；`review-convergence-policy`；按触发条件启用 `external-documentation-gate` | **无**。可返回结构化 finding/evidence gap，但不直接写 queue、CURRENT_TASK、代码或 knowledge |
| `debug-task` | `investigate-root-cause`；`debug-and-fix-current-task` 的 investigation、root-cause 和 repair-decision 分支 | 区分新 bug、report-only investigation、current-task debugging；先 reproduce 再提出 hypothesis；确认 owner 与 active task；最多有限次不收敛尝试后 stop；外部行为影响正确性时查当前文档；debug 不直接写产品代码；`resolve` 只负责确认修复路线，修复交给 `execute-step:repair` | `project-context-resolver`；`root-cause-loop`；`owner-route-resolver`；`source-authority-policy`；`scope-guard`；`decision-authority-gate`；`evidence-admission-policy`；条件性的 `external-documentation-gate`、`review-convergence-policy` | current task 调试证据/风险/检查点可写 `task-state-transaction`；新 bug 或 report-only 默认无写入；不由该入口直接提交产品修复 |
| `task-lifecycle` | `pause-current-task`、`interrupt-current-task`、`resume-paused-task`、`resume-interrupted-task`、`supersede-current-task` | workflow status 与 lifecycle state 分离；pause 与 interrupt 不混淆；保存完整 snapshot、checkpoint、dirty attribution、environment、recovery strategy；resume 必须指定唯一包并先过 review gate；supersede 只用于 goal/scope/acceptance 已失效且保留原历史；不从“latest package”猜恢复对象 | `project-context-resolver`；`lifecycle-transition-guard`；`task-identity-guard`；`owner-route-resolver`；`resume-review-gate`；`source-authority-policy`；`decision-authority-gate`；`scope-guard` | `lifecycle-transaction`；supersede/replan 的任务事实条件性写 `task-state-transaction`；不承担旧项目 paused/interrupted 热迁移 |
| `capture-work-item` | `capture-work-item` | 仅记录已证明与当前任务无关的工作；`TASKS/inbox/**` record-only；scope widening、uncertainty、duplicate suspicion fail closed；绝不创建/切换/修改 CURRENT_TASK、lifecycle、identity、catalog | `record-only-intake-guard`；`owner-route-resolver`；`scope-guard`；必要时使用 `project-context-resolver` 确认当前 owner | `inbox-record-transaction`：最多创建一个 inbox record，不触碰 active task |
| `close-task` | `close-current-task`、`prepare-delivery-summary`、`archive-task` | closure eligibility 先于 archive；同步实际 task/status；保留 acceptance、verification、release health、rollback、observation、remaining risks；summary 不能把 blocker 美化成 complete；identity/slug/archive path 稳定；lesson 只能作为显式候选进入 knowledge admission | `project-context-resolver`；`closure-eligibility-gate`；`task-identity-guard`；`evidence-admission-policy`；条件性的 `release-evidence-gate`；`knowledge-admission-policy` | `task-state-transaction`、`project-status-transaction`、`archive-transaction`；显式准入的 Lesson 才使用 `lesson-record-transaction` |
| `bootstrap-project`（admin） | `design-baseline-init`、`greenfield-init`、`legacy-inventory`、`adopt-existing-project`、`realign-workflow-assets` | `design / greenfield / inventory / adopt / realign` 保留不同 precondition、authority、write boundary 和 stop condition；只记录 confirmed facts；保留 inferred/unknown 与 provenance；realign 只处理 workflow-owned assets，保护 target facts、用户文档、native host assets；不创建 feature implementation | `project-context-resolver`；`source-authority-policy`；`design-evidence-gate`；`decision-authority-gate`；`scope-guard`；`propagation-evidence-validator`；`host-isolation-guard`；`generation-atomicity-policy`；必要时 `dangerous-operation-gate` | 按 mode 使用 `contract-candidate-commit`、`decision-record-transaction`、`project-status-transaction`、`paired-host-guidance-transaction`；不创建 active task |
| `validate-change`（expert/automation） | `run-regression` | QA evidence closed set；复用同一 diff target；unit/integration/browser/visual/release/canary/benchmark 等由 evidence policy 选择；report-only 不触发 sync/debug/repair；失败只路由到 `debug-task` 或用户，不隐式修复 | `validation-layer-gate`；`diff-target-resolver`；`read-only-review-guard`；`evidence-admission-policy`；`owner-route-resolver`；按触发条件启用 `release-evidence-gate`、`external-documentation-gate` | **无**。允许声明的临时 build/cache/test artifacts，但不写 canonical governance state |
| `sync-state`（internal） | `sync-current-task`、`sync-status`、`sync-contracts`、`sync-decisions`、`sync-host-guidance`、`sync-review-findings`、`capture-lessons`；以及对应 Runtime transaction surface | 只接受 typed semantic delta；caller 提供 authority、evidence、source tuple、scope 和 idempotency；Contract/Decision/Lesson 使用 knowledge admission；finding 只有 current-owner、in-scope、mechanical 且去重后才能进 queue；append-only/provenance、host pairing、exact source/write allowlist；不是任意 Markdown editor | `knowledge-admission-policy`；`source-authority-policy`；`decision-authority-gate`；`propagation-evidence-validator`；`finding-admission`；`owner-route-resolver`；`host-isolation-guard`；`generation-atomicity-policy`；条件性的 `closure-eligibility-gate` | 按 operation kind 精确调用：`task-state-transaction`、`project-status-transaction`、`contract-candidate-commit`、`decision-record-transaction`、`paired-host-guidance-transaction`、`finding-queue-transaction`、`lesson-record-transaction` |

`execute-current-task` 与 `debug-and-fix-current-task` 都按语义边界拆分到多个新入口；这表示拆责任，不表示保留两个旧 wrapper。其余旧 Skill 由上表唯一归属，旧文件、旧 registry entry 和旧 public route 在纯 vNext 安装中均不存在。

## 3. Skill 重写的统一契约

每个 vNext entry 的模板都应先声明以下信息，再写模型行为说明：

```yaml
entry_contract:
  entry: <vNext-entry>
  mode: <default-or-explicit-mode>
  intent: <caller-visible-intent>
  input_contract: []
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

## 4. 关键宏观路由

入口之间只保留改变 intent、authority、lifecycle 或 mutation phase 的宏观转换：

```text
prepare-task
    ↓ ready
execute-step
    ↓ change-ready
review-change (discovery)
    ├─ clean / needs-evidence → validate-change（按 evidence plan）
    ├─ admitted mechanical finding → sync-state:finding → execute-step:repair
    │                                  ↓
    │                             review-change (verification)
    ├─ unknown root cause → debug-task
    └─ user-owned / scope / contract decision → stop and ask or replan

debug-task:resolve
    ↓ root-cause-confirmed + authorized
execute-step:repair

review / evidence / acceptance complete
    ↓ closure eligible
close-task
```

Review Convergence 的默认边界由 Target Architecture 负责：同一 fingerprint 最多两次 repair attempt，repair wave 有上限；无法收敛、需要用户决定或根因未知时 stop。`review-change` 不自己写 queue；准入结果由 `sync-state` 的 typed operation 持久化。

## 5. Runtime 写入矩阵

Runtime handler 的 source set、write set、precondition、conflict rule 和 postcondition 必须是闭集。以下矩阵是 Skill 重写时的最小调用面：

| Operation | Canonical source / write target | 允许的 caller | 关键限制 |
|---|---|---|---|
| `task-state-transaction` | `CURRENT_TASK.md` 及其 vNext task state | `prepare-task`、`execute-step`、`debug-task`、`close-task`、受控 replan | 只记录实际进度、evidence、deviation、risk、acceptance、handoff；不得把失败写成完成 |
| `lifecycle-transaction` | vNext lifecycle marker、snapshot、recovery package | `task-lifecycle` | exact task identity、合法 tuple、原子读回；不读取或热迁移旧 paused/interrupted runtime |
| `inbox-record-transaction` | `TASKS/inbox/**` | `capture-work-item` | record-only；不升级成 task、catalog、lifecycle 或 archive |
| `finding-queue-transaction` | admitted finding queue | `sync-state`、`execute-step` 的 admitted repair | 先过 finding admission；current-owner/in-scope/mechanical；稳定 fingerprint 与 provenance；去重 |
| `project-status-transaction` | `STATUS` / approved status baseline | `sync-state`、`close-task`、`bootstrap-project` | status 是 descriptive；缺 evidence 时只能是 blocked/observing 等真实状态 |
| `contract-candidate-commit` | `CONTRACTS` | `sync-state`、`bootstrap-project` | 先过 knowledge admission；只收 verified stable boundary；不锁定临时实现，不静默放宽已有 Contract |
| `decision-record-transaction` | `DECISIONS` | `sync-state`、`bootstrap-project` | 只提交 confirmed authority；append-only；supersede 要保留 predecessor、原因与 provenance |
| `paired-host-guidance-transaction` | 成对 host guidance surfaces | `sync-state`、`bootstrap-project` | 保持语义对齐；保护 target-owned/native 内容；临时 workaround 不得升级成全局规则 |
| `lesson-record-transaction` | `LESSONS` | `sync-state`、`close-task` 的显式 lesson phase | 先过 reusable trigger、cause、action、evidence、consumer 和 dedup；一过性观察为 no-op/defer |
| `archive-transaction` | canonical `TASK` archive | `close-task` | task identity、acceptance、validation、release/rollback、remaining risk 均满足后才 archive；路径精确且可重放 |

Runtime kernel 只负责 deterministic validation、conflict、idempotence、atomic commit 和 read-back；语义判断仍由 entry、用户和 capability policy 共同完成。不存在一个可以随意写任意治理文档的 generic editor。

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
install pure vNext
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
| Phase 1 | 固定 entry contract；建立七个 daily entry 的最小模板/Capability 引用面；确定 Runtime operation contract；先重写 `prepare-task`、`review-change`、`execute-step` 的边界，再补齐 `debug-task`、`capture-work-item`、`close-task` 的最小结构 | 不扩张 shadow runner；不把旧 Skill 安装到 target；不让 vNext reader 解析旧 schema；不实现非 idle state migration |
| Migration Pack | 实现 idle preflight、离线副本转换、stable ID/provenance/path-reference、完整 validation 和 pure-vNext atomic installation | 不关闭/归档 active task；不恢复 paused/interrupted；不做语义去重或 AI 历史重写 |
| Phase 2 | 以纯 vNext schema 开始 `execute-step` 的 state-changing workflow；接入 task-state/finding queue；落实 evidence admission、finding admission、Review Convergence 和 read-back | 不保留 legacy fallback；不把 review/validation 变成修复入口 |
| 后续 | 逐步实现 vNext 自己创建的 `task-lifecycle`，再实现 `close-task`、`bootstrap-project` 及明确授权的新 capability | 不把 lifecycle/close/bootstrap 的缺失补成兼容旧协议的临时路径 |

后续 Skill 重写的顺序原则是“先公共契约与三条核心路径，再外围入口，再 state-changing Runtime”。它不以增加测试基础设施为交付目标；现有验证只用于检查蓝图实现是否违反已确认边界。

## 8. Blueprint 完成标准

本蓝图可作为 Skill 重写入口的前提是：

- 七个 daily entry、`bootstrap-project`、`validate-change`、`sync-state` 的 exposure 和 owner 清楚；
- 37 个旧 Skill 的治理责任片段均已在第 2 节归属，且没有旧 public route 需要在 vNext 中保留；
- 每个 entry 都能写出 input、authority、mutation boundary、capabilities、Runtime operations、stop conditions 和 output；
- `project-context-resolver`、`knowledge-admission-policy`、Review Convergence、Evidence Admission 均作为内部 policy 使用，而不是新增 public stage；
- review/validation 的零写入边界、finding admission、owner/handoff 分离、scope/dangerous gate 和 External Documentation Gate 都保留；
- 每一项治理持久化写入都映射到一个 exact Runtime handler，且没有 generic document editor；
- Migration Pack 与 vNext runtime 完全分离，旧 schema 在 vNext 中只能得到 `migration-required → stop`；
- 源仓库可暂时保留旧实现与实验 vNext 供开发比较，但 target project 的安装结果是纯 vNext。

本文件不记录脚本已实现或测试已通过；那属于实现后的验证报告，不属于 Target Architecture 或本 implementation blueprint。
