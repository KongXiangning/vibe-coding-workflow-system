# .workflow-system/FILE_SCHEMAS.md

本文档定义 workflow 治理体系里各文档工件的最小字段、更新时机和校验原则。

它是结构化 schema 与校验规则的规范源，主要服务于生成器、模板、校验器和自动化流程；不要求人工直接按字段结构逐项编写文档。

目标不是把文档写成形式主义，而是让每个阶段都产出可被下一阶段稳定消费的工件。

---

## 1. 通用规则

适用于所有治理文档的共同约束：

- 标题必须稳定，不要频繁改名
- 一级、二级章节应保持固定结构，避免 AI 每轮重排
- 每次更新必须优先追加信息，尽量不要删除历史依据
- 不明确的内容应显式标记为待确认，而不是静默省略
- 如果某文档被 skill 持续读写，该文档必须能被独立理解
- `.workflow-system/WORKFLOW_PROTOCOL.md` 与 `.workflow-system/FILE_SCHEMAS.md` 是规范源；模板只能承载这里已经定义的结构
- `templates/**` 负责定义生成骨架，不能偷偷扩展未在规范源登记的新章节或新字段
- `dist/workflow-system/**` 由规范源、`templates/docs/**`、`templates/skills/**`、`scripts/gen-workflow-docs.ts`、`scripts/gen-workflow-skills.ts`、`scripts/workflow-doc-contracts.ts` 与 `scripts/workflow-runtime.ts` 共同决定；其中 `generated/**` 产物是参考证据，不是独立规范源
- `.workflow-system/WORKFLOW_CAPABILITIES.yaml` 是 workflow-system 产品 capability / compatibility 的 machine-readable declaration；它不得承载 target-project live task / status / contract / decision facts
- `test/fixtures/workflow-capability-cases.yaml` 是 conformance fixture，不是规范源或项目事实源
- v26 是在 v25 基线上的增量修复版；规范更新默认按 additive extend 处理，除非显式声明替代旧规则
- 传播治理公开结构的字段、默认规则和 conformance 测试要求由 `.workflow-system/WORKFLOW_PROTOCOL.md` 定义；`.workflow-system/FILE_SCHEMAS.md` 只登记这些结构在治理文档中的承载位置和最小文档可审计要求

## 1.1 传播治理公开结构承载位置

本节只登记传播治理公开结构在治理文档中的承载位置。字段级 schema、枚举、gate、错误码、默认 blocker 规则和 conformance 测试要求均以 `.workflow-system/WORKFLOW_PROTOCOL.md §18.6` 为唯一来源；本文不重复维护字段或规则。

下表的承载位置是概念性审计区域，不要求生成同名字段或子章节；字段级 schema、对象结构、枚举、gate 和错误码均以 `.workflow-system/WORKFLOW_PROTOCOL.md §18.6` 为唯一来源。

| 结构 | 文档承载位置 |
|---|---|
| `EvidenceRecord` | `CURRENT_TASK.md > 传播治理记录 > discovery evidence` |
| `UIAnchorReplacement` | `CONTRACTS.md > frozen zone / UI anchor migration` |
| `ContractCompatibilityResult` | `CURRENT_TASK.md > blockers / gate status` |
| `EvidenceAggregation` | `CURRENT_TASK.md > aggregation / complexity` |
| `ComplexityAssessment` | `CURRENT_TASK.md > aggregation / complexity` |
| `over_limit_policy` | `CURRENT_TASK.md > aggregation / complexity` |
| `evidence_diff_threshold` | `CURRENT_TASK.md > aggregation / complexity` |
| `MutationEligibilityAssessment` | `CURRENT_TASK.md > eligibility / candidate / registry` |
| `EntityMutationChecklist` | `CURRENT_TASK.md > eligibility / candidate / registry` |
| `LayoutContract` | `CURRENT_TASK.md > layout / behavior / migration / regression` 与 `CONTRACTS.md > LayoutContract` |
| `RegistryFreshnessReport` | `CURRENT_TASK.md > eligibility / candidate / registry` |
| `LinkedRegressionRecord` | `CURRENT_TASK.md > layout / behavior / migration / regression` |
| `BehaviorContract` | `CURRENT_TASK.md > layout / behavior / migration / regression` 与 `CONTRACTS.md > BehaviorContract` |
| `StagedMigrationPlan` | `CURRENT_TASK.md > layout / behavior / migration / regression` |
| `migration_plan_requirement` | `CURRENT_TASK.md > layout / behavior / migration / regression` |
| `implicit_shared_object_detection` | `CURRENT_TASK.md > eligibility / candidate / registry` 与 `CONTRACTS.md > candidate 回写记录` |

占位符语法、类别、来源和保留规则不在本文维护；治理文档模板使用的占位符必须引用 `.workflow-system/WORKFLOW_PROTOCOL.md §3`。

---

## 2. CURRENT_TASK.md

### 作用

把本轮需求变成一个可执行、可审计、可回滚的标准任务包。

### 必填章节

- `## 任务信息`
- `## 背景与上下文`
- `## 验收标准`
- `## 允许修改范围`
- `## 禁止修改范围`
- `## 受影响的契约`
- `## 已确认决策`
- `## 待确认问题`
- `## 实现方案`
- `## 传播治理记录`
- `## 实施步骤`
- `## 回归检查项`
- `## 回滚点`
- `## 执行记录`

Successful vNext close-task writes the terminal tuple `workflow_status: closed`
and `lifecycle_state: archived`; `completed` remains an `active_step_status`
value only. The live `CURRENT_TASK.md` is preserved as the complete terminal
task record after archive. It is updated with the terminal tuple and closure /
archive audit, but must not be cleared, deleted, or reset to a template.
`close-task` does not create the next task; a later independent `prepare-task`
may replace the live pointer through the typed draft schema below only after
the archive is verified. `TASK_SUMMARY.md` is retained as a legacy/source-
repository schema and is not a vNext close-task durable output.

### Ordinary draft / confirmation schema

An independent request is persisted in the single canonical
`CURRENT_TASK.md` before execution. The existing terminal task is
`closed + archived`; `prepare-task` emits a typed `create-draft` action with
`task_id`, `task_slug`, `document_id`, `task_title`, `draft_definition`,
`active_step_id`, and claim-bound `evidence_refs`. A new draft requires the
previous closed task's archive and all required post-archive reconciliation
(STATUS reconciliation, and admitted Lesson persistence if `lesson_admission: admit`)
to be complete, otherwise creation fails closed with `PREVIOUS_TASK_RECONCILIATION_INCOMPLETE`.
Draft steps require strict step admission: every step must declare purpose,
mutation scope, required evidence, and review checkpoint (with boundary when required),
and `active_step_id` must match the first admitted step (`implementation_steps[0].id`).
The new document is `draft + active`, owns the current-task slot, and has no
executable authority.

`draft_definition` is a closed object whose fields map one-to-one to the
existing task-definition sections: `background_context`, `acceptance`,
`allowed_scope`, `conditional_scope`, `forbidden_scope`, `affected_contracts`,
`confirmed_decisions`, `open_questions`, `implementation_plan`,
`implementation_steps`, `regression_checks`, `rollback_points`,
`design_constraints`, `post_release_validation`, and
`propagation_governance`. Scope buckets remain explicit list sections; optional
design/release/propagation sections may be empty/null according to their
condition rules.

Repeated ordinary preparation against `draft + active` emits only
`update-draft` with the same `TASK_ID`, `TASK_SLUG`, `document_id`, and title.
Runtime replaces only the closed definition section set, resets the admitted
step to `ready` at the first admitted step, and preserves execution/audit/applied-proposal
history and canonical provenance. It does not accept arbitrary Markdown or auto-confirm.

The only draft-to-active schema is `prepare-task:confirm` / `confirm-draft`.
It repeats `task_id`, `task_slug`, and `document_id`, carries the exact current
draft `source_tuple.revision` as `draft_revision`, and includes explicit
`user-confirmation` or `authorized-caller` authority that strictly binds current
`task_id`, `document_id`, and `draft_revision`. Runtime rejects stale identity/revision,
authority coordinate drift, malformed definitions, unresolved open questions,
or authority conflicts. A successful confirmation changes the tuple to
`active + active`; `execute-step` must reject every `draft + active` tuple.

### 允许修改范围的 vNext 承载语义

`## 允许修改范围` 中的 `Allowed Files`、`Conditional Files` 与
`## 禁止修改范围` 中的 `Forbidden Files` 只表达当前任务的
**mutation / write boundary**。任务可以在同一章节另列 `Read / discovery
context`，用于记录为理解问题、追踪调用链、确认 root cause 而读取的更宽
范围；该列表不授予任何写权限。普通局部任务的 `Allowed Files` 应优先精确到
文件，必要时精确到 symbol / responsibility；只有天然是 broad mutation 的
rename、跨模块迁移或框架级转换才使用目录递归范围。

`Conditional Files` 的每一项必须记录触发条件以及所需的 evidence / authority。
条件满足前，该目标按禁止修改处理；满足既有条件或由 evidence 证明了有界的
机械传播后，才允许扩大 mutation boundary。若变化的是 goal、scope 或
acceptance，应走 supersede / replan，而不是把它当作普通 scope expansion。

### 任务证据与 persistent-test 最小承载

`## 验收标准` 与 `## 回归检查项` 复用现有章节承载 claim 与 evidence，不新增
Test registry、Test state machine 或 public Test Skill。每个需要证明的业务
claim 至少应有稳定的 `Claim ID`、claim 描述和 minimum-sufficient evidence；
回归检查项应引用 Claim ID，并记录复用、执行、暂缓或阻塞的 evidence。

新增长期维护的 automated test 默认不准入。只有在现有章节中明确记录
`persistent_test_admission` 时才允许写入；该记录的最小内容为：

- `basis`：`acceptance` / `regression` / `critical-invariant` / `critical-risk` 之一
- `owner`：负责该 admission 的 acceptance、regression、invariant 或 risk owner
- `proves`：测试证明的具体 claim
- `existing_evidence_insufficiency`：现有 evidence 不足的具体原因

`persistent_test` 未被明确准入时按 `false` 处理。用户明确要求“不新增测试”
时，可在现有 `## 已确认决策` 或 `## 回归检查项` 记录
`test_write_policy: deny`；该策略禁止新增 persistent test，但不禁止运行已有
validation、build、smoke、static check 或其他 claim-appropriate evidence。若
更高优先级的 authoritative Contract 明确要求新增测试，按 authority conflict
停下并报告，不静默覆盖任一方。docs-only / governance-only wording change 的
默认新增 persistent test 数为 `0`。

### 实施步骤与 Review Checkpoint 最小承载

`## 实施步骤` 中的每个 implementation step 应是同一 TASK 内可独立执行和
验证的单元，并至少记录以下最小内容：

- `Step ID`：稳定且唯一的步骤标识
- `Purpose`：该步骤要完成的业务目的
- `Mutation scope`：引用 `Allowed Files` 或满足条件时的 `Conditional Files`
- `Required evidence`：该步骤完成前必须取得的 minimum-sufficient evidence
- `Review checkpoint`：`required` 或 `not-required`；若为 `required`，同时记录触发的 risk / logical boundary

Step 只有在其 required evidence 满足后才能标记完成。`Review checkpoint` 是
task definition / execution policy 内的事实，不是 lifecycle state、public mode
或新的文档类型；低风险机械 step 可以标记 `not-required`，但 repair 完成后
始终需要 `review-change` verification。`active_step_id` 与 durable advancement
仍由现有 vNext runtime state / typed Runtime transaction 承载；本节不增加新的
Runtime state 字段，也不授权 Skill 直接编辑 `CURRENT_TASK.md`。

### 条件必填章节

- `## 设计约束`：UI / 视觉 / 交互任务必须填写；非 UI 任务可保留默认 `Design mode: none`
- `## 发布后验证`：发布、部署、生产验证、canary、性能基线或上线后观察任务必须填写；其他任务可保留默认 `Release mode: none`

### 实现方案最小内容

`## 实现方案` 承载当前任务内的实现分析和计划基线，由 `/plan-implementation` 写入，供 `/decompose-task` 拆解步骤使用。该章节只描述本轮任务的可执行方案，不替代长期 `CONTRACTS.md`、`DECISIONS.md` 或 `LESSONS.md`。

最小字段：

- `Goal:`
- `Architecture impact:`
- `Technical approach:`
- `Alternatives considered:`
- `Data / state flow:`
- `Compatibility:`
- `Risks and rollback:`
- `Validation strategy:`
- `Open decisions:`

长期有效的产品、架构、接口、兼容或治理决策必须通过 `/sync-decisions`、`/sync-contracts` 或 `/capture-lessons` 沉淀；`CURRENT_TASK.md > 实现方案` 不能单独定义长期事实源。

### 传播治理记录最小内容

命中传播治理时，`CURRENT_TASK.md` 必须承载或引用 `.workflow-system/WORKFLOW_PROTOCOL.md §18.6` 定义的传播治理对象与 conformance evidence。本文只要求存在可审计记录，不重复定义对象字段、默认规则、错误码、gate 或测试断言。

### 设计约束最小内容

当任务涉及 UI、页面、组件、交互、品牌、视觉、设计系统或实现后视觉 QA 时，`CURRENT_TASK.md` 必须填写 `## 设计约束`。该章节只代表当前任务级设计约束，不替代长期 `DESIGN.md`、`.workflow-system/PROJECT_PROFILE.yaml` 或项目基线。

- `Design mode`：`none` / `design-system` / `exploration` / `design-to-code` / `visual-qa`
- `Design source`：`existing DESIGN.md` / `approved mockup` / `user-provided reference` / `current UI` / `none`
- `Design acceptance`：视觉层级、状态覆盖、响应式、可访问性、anti-slop、browser smoke
- `Design evidence`：截图、mockup 链接、人工验收记录或 blocked reason
- `Design open decisions`：未确认口味决策

`DESIGN.md` 只能作为 optional source；缺失时不得阻断非 UI 任务，也不得被加入 required reads。若需要让设计系统长期生效，应另开 `DESIGN.md` / 项目基线同步计划。

### 发布后验证最小内容

当任务涉及发布、部署、生产验证、canary、性能基线或上线后观察时，`CURRENT_TASK.md` 必须填写 `## 发布后验证`。该章节只代表当前任务级发布验证计划和证据，不替代长期 `BASELINES.md`。

- `Release mode`：`none` / `release-readiness` / `deploy-verification` / `canary` / `benchmark`
- `Deploy source`：`BASELINES.md` / host config / CI output / manual / none
- `Target environment`：staging / production / preview / local / unknown
- `Health checks`：health endpoint、关键页面、关键 API、console errors、job status
- `Canary window`：观察周期、采样次数、失败阈值、默认动作
- `Performance baseline`：指标、baseline source、允许回退阈值、证据
- `Rollback / recovery`：回滚入口、负责人、触发条件、不可自动处理项
- `Release evidence`：CI、deploy log、health check、截图、监控链接、manual note 或 blocked reason

`BASELINES.md` 是长期发布 / 部署 / 性能可靠性基线；`CURRENT_TASK.md > 发布后验证` 只承载本轮验证计划和结果。没有 deploy baseline、health endpoint、production URL、deploy log 或性能 baseline 时，必须输出 blocked risk，不能把任务标记为已稳定。

### 生命周期 / 恢复 gate 字段

当任务启用 `CURRENT_TASK` suspend / interrupt / resume contract 时，`CURRENT_TASK.md > ## 任务信息` 必须把 workflow status、lifecycle state 和 resume gate 分开承载，不得混写。

- `当前状态`
  - 继续承载 workflow / ownership status
  - 语义和值域以 `.workflow-system/WORKFLOW_PROTOCOL.md §3.4` 为准
  - 不得承载 `paused_pending_closure`、`paused_blocked`、`interrupted`
- `生命周期状态` -> schema key `lifecycle_state`
  - 承载 live task lifecycle state
  - 语义和值域以 `.workflow-system/WORKFLOW_PROTOCOL.md §3.4` 为准
- `恢复需审查` -> schema key `resume_requires_review`
  - 布尔值
  - 普通新建任务可为 `false`
  - suspended -> active 恢复写回时，v1 固定为 `true`
- `恢复审查原因` -> schema key `resume_review_reasons`
  - 承载按稳定顺序输出的非空 reason 集合
  - 显示层可使用逗号分隔字符串，但 parser / validator 必须映射为数组语义

`resume_review_reasons` 是闭合集合，v1 顺序固定如下：

1. `base_drift`
2. `checkpoint_drift`
3. `diff_review_target_changed`
4. `environment_recovery_pending`
5. `assumption_changed`
6. `validation_pending`
7. `manual_review_pending`
8. `remaining_acceptance_pending`
9. `blocker_recheck_required`
10. `dirty_attribution_pending`
11. `recovery_strategy_review_required`

最小校验要求：

- `恢复需审查 = false` 时，`恢复审查原因` 必须为空
- `恢复需审查 = true` 时，`恢复审查原因` 必须为非空闭合集合
- `恢复审查原因` 必须按上述顺序规范化并去重；若实现路径不执行规范化，则必须 `fail-closed`
- `paused_pending_closure` 至少包含 `validation_pending`、`manual_review_pending`、`remaining_acceptance_pending` 之一
- `paused_blocked` 至少包含 `blocker_recheck_required`
- `interrupted` 至少包含与 checkpoint / diff / dirty attribution / environment / recovery strategy 对应的 interrupt reason

### Same-task supersede / replan 承载约束

Slice B 复用同一份 canonical `CURRENT_TASK.md`。`TASK_ID`、`TASK_SLUG` 和
`document_id` 在 supersede / replan 中必须保持不变；新 identity 只能由独立
新任务的 default path 生成。`blocked_by_replan + active` 与
`superseded + active` 都是 durable non-active owner 状态，不是 public mode。
两者均禁止 `execute-step`、pause、interrupt；前者可由权威证据清除回到
`active + active`，或在 invalidation 确认后进入 `superseded + active`；后者
只能由成功的 `prepare-task:replan` replacement 回到 `active + active`。

未来 task-state transaction action 的闭集为：

- `mark-replan-blocked`: `active + active` → `blocked_by_replan + active`
- `clear-replan-block`: `blocked_by_replan + active` → `active + active`，仅当新权威证据证明旧 definition 仍成立
- `commit-replan`: `superseded + active` → `active + active`，仅提交同一 identity 的合法 replacement

ReplanDelta 只能替换以下既有 task-definition sections：

- background/context；acceptance；Allowed / Conditional / Forbidden scope
- affected contracts；confirmed decisions；open questions
- implementation plan；implementation steps
- regression / validation checks；rollback points
- conditional design constraints；conditional post-release validation
- 被触发的 propagation governance 内容

以下 preservation fields 不得被 ReplanDelta 覆盖：`TASK_ID`、`TASK_SLUG`、
`document_id`、历史 `## 执行记录`、既有 supersede/invalidation evidence、
partial-diff provenance/disposition、historical findings、applied proposal/
audit history 及其他 canonical provenance。旧 finding 不自动获得新 definition
下的 repair authority；若仍适用，必须重新经过现有 finding admission。不得创建
第二份 CURRENT_TASK snapshot、replan history object、新的 artifact family，或
使用 arbitrary Markdown heading/path patch。

`## 执行记录` 中的最小 audit record 必须能识别 action（`supersede`、
`mark-replan-blocked`、`clear-replan-block` 或 `commit-replan`）、旧/新状态、
同一 task identity、proposal/idempotency identity、source revision、authority /
evidence refs，以及 partial-diff disposition（若 action 产生该字段）。
supersede 成功后即使 replan blocked 也保留 superseded 状态，不得用回滚恢复旧
definition 的执行权。

`commit-replan` 的 Runtime normalization 必须是 deterministic：ReplanDelta
提供新的 `active_step_id`，并将 `active_step_status` 设为 `ready`；旧的
admitted / in-progress findings 改为 `deferred` 且 non-actionable，若仍适用
必须重新经过 finding admission；`resolved`、`rejected`、已 `deferred` 的
findings 保留为 history；`review_cycle` 重置为初始 no-active-cycle baseline；
`resume_requires_review` 设为 `false`，`resume_review_reasons` 设为 `[]`；
`execution_log` 与 `applied_proposals` 保留。该 normalization 与 closed
section replacement 同属一次 atomic commit。

### Suspended package 承载约束

suspended package 是 task artifact，不是新增治理文档类型，也不是 governance catalog 常驻对象。其 path contract 固定如下：

| kind | path contract | 说明 |
|---|---|---|
| live package | `docs/workflow/CURRENT_TASK.md` | canonical live task package；不是 suspended artifact kind |
| `archive` | `TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md` | terminal archive package |
| `paused` | `TASKS/paused/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md` | suspended package |
| `interrupted` | `TASKS/interrupted/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md` | interrupted package |

`artifact_kind` 是闭合集合：

- `archive`
- `paused`
- `interrupted`

suspended package 的最小字段为：

- `task_id`
- `task_title`
- `task_slug`
- `artifact_kind`
- `lifecycle_state`
- `suspension_reason`
- `task_start_base`
- `last_reviewed_checkpoint`
- `current_diff_review_target`
- `resume_requires_review`
- `resume_review_reasons`
- `rehydration_status`
- `ownership_state`
- `document_id`
- `snapshot_sha256`

其中 `document_id` 必须与 live `CURRENT_TASK.md` 及 embedded snapshot 一致，
`snapshot_sha256` 必须精确匹配 embedded snapshot 的字节内容；这两个字段是
Runtime 用于防止 package 与 canonical task 串线的完整性标记，不是第二状态源。
resume proposal 还必须携带 `recovery_package_revision`，其值是 Skill 读取
package 后观察到的完整 package 原始字节 SHA-256；Runtime apply 时必须将它
与实际重新读取的 package revision 精确比较。
Slice A Runtime 另外要求 package 恰好包含一对
`BEGIN vNext CURRENT_TASK snapshot` / `END vNext CURRENT_TASK snapshot`
marker，并嵌入完整、可独立校验的 vNext `CURRENT_TASK.md` snapshot；marker
缺失、重复、顺序错误或 hash 不匹配时必须 fail-closed。

其中闭合集合为：

- `rehydration_status`
  - `write_incomplete`
  - `ready_for_resume`
  - `rehydrated`
- `ownership_state`
  - `recovery_only`
  - `rehydrated`

恢复输入最小条件：

- `artifact_kind` 必须为 `paused` 或 `interrupted`
- `rehydration_status = ready_for_resume`
- `ownership_state = recovery_only`
- `resume_requires_review = true`
- `resume_review_reasons` 为满足 lifecycle-state 场景映射的非空闭合集合

额外字段约束：

- `paused_blocked` 还必须记录：
  - `blocker_status`
  - `blocking_evidence`
  - `remaining_acceptance`
  - `failed_checks` 仅在 blocker 直接来自 validation failure 时必填
- `artifact_kind = interrupted` 还必须记录：
  - `checkpoint_evidence`
  - `dirty_attribution`
  - `environment_state`
  - `recovery_strategy`

`write_incomplete` package、marker 不自洽 package、或不满足上述最小字段的 package 都不得作为恢复输入。
同 kind package 已存在时，`ready_for_resume + recovery_only` 必须返回
conflict，`write_incomplete` 必须进入 recovery-required / blocked，只有
`rehydrated + rehydrated` package 可以被下一轮同 kind suspend 覆盖；覆盖时
原始内容必须进入同一 transaction 的 rollback 原像。另一个 kind 的 sibling
package 只有在 `ready_for_resume` 或 `write_incomplete` 时构成 ambiguity；
`rehydrated + rehydrated` sibling 不阻断新的 suspend/resume cycle。

### Inbox / record-only artifact 承载约束

inbox artifact 是 record-only work item，不是 task identity artifact、lifecycle state、suspended package 或 governance catalog 常驻对象。其 path contract 固定如下：

```text
TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md
```

最小字段为：

- `artifact_kind`
- `item_id`
- `title`
- `type`
- `source`
- `captured_at`
- `relation_to_current_task`
- `current_task_id`
- `description`
- `evidence`
- `suggested_next_action`
- `status`

其中闭合集合为：

- `artifact_kind`
  - `inbox_item`
- `type`
  - `requirement`
  - `idea`
  - `bug`
  - `chore`
  - `question`
- `source`
  - `user`
  - `implementation`
  - `review`
  - `regression`
  - `root_cause`
  - `other`
- `relation_to_current_task`
  - `unrelated`
- `suggested_next_action`
  - `triage_later`
  - `ask_user`
- `status`
  - `captured`

最小校验要求：

- inbox artifact path 必须匹配 `TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md`
- `relation_to_current_task` 对已写入 inbox 的 artifact 固定为 `unrelated`
- inbox artifact 不得落入 `TASKS/paused/**`、`TASKS/interrupted/**`、`TASKS/TASK-*.md` 或 `docs/workflow/CURRENT_TASK.md`
- inbox artifact 不得把 `capture`、`backlog_item` 或 `inbox_item` 写成 live `CURRENT_TASK.md` 的 lifecycle state
- duplicate 检测可依赖 title / slug / evidence 的轻量 read-back，但命中疑似重复时必须 fail-closed，不能静默覆盖
- `promoted`、`rejected`、`duplicate` 等后续状态不属于本轮最小闭集；需要时必须先扩展协议 / schema

### 更新时机

- 新需求进入时创建
- 范围锁定后补齐边界
- 每完成一个实现步骤后更新执行记录
- 验证完成后更新最终状态

### 校验要求

- 验收标准必须可验证
- UI / 视觉 / 交互任务必须显式填写 `## 设计约束`
- `## 设计约束` 中的 `Design mode`、`Design source`、`Design acceptance`、`Design evidence`、`Design open decisions` 必须可审计
- 没有 `DESIGN.md`、mockup、截图或参考链接时，UI 任务必须进入 `design-system` 或 `exploration`，不能直接实现
- 发布、部署、生产验证、canary、性能基线或上线后观察任务必须显式填写 `## 发布后验证`
- `## 发布后验证` 中的 `Release mode`、`Deploy source`、`Target environment`、`Health checks`、`Canary window`、`Performance baseline`、`Rollback / recovery`、`Release evidence` 必须可审计
- 生产发布缺少回滚方案、health check 或发布证据时，不得写成 stable
- 允许/禁止修改范围必须明确到目录、文件或契约层
- `## 允许修改范围` 必须显式包含 `Allowed Files` 与 `Conditional Files`
- `## 禁止修改范围` 必须显式包含 `Forbidden Files`
- `Conditional Files` 中的每一项都必须写明触发条件、审批或证据要求；条件未满足时按禁止修改处理
- 未列入 `Allowed Files`，且不满足 `Conditional Files` 条件的文件或契约面，默认禁止修改
- `## 任务信息` 在进入 A3 执行后必须包含任务 ID、任务标题和任务 slug；生成骨架阶段允许保留对应占位符
- 命中传播治理时，`## 传播治理记录` 必须显式承载或引用 `.workflow-system/WORKFLOW_PROTOCOL.md §18.6` 定义的对象、evidence、compatibility result 和 conformance case，而不是只在对话里口头说明
- `## 传播治理记录` 不得新增、改名、降级或重新解释 `.workflow-system/WORKFLOW_PROTOCOL.md §18.6` 已定义的协议对象字段、错误码、gate 或 blocker 语义；需要扩展时先修改协议源。
- 至少包含一个当前可执行步骤
- 回滚点必须可操作，不能只有笼统描述
- 长任务允许创建 checkpoint commit 作为回滚和审计点；如果存在 checkpoint，`## 回滚点` 必须能看出任务起始基线、最近已审查 checkpoint 或当前 diff review target，避免 `/review-diff` 误用空的工作区 diff
- 启用生命周期 contract 时，`CURRENT_TASK.md > ## 任务信息` 必须能稳定映射 `lifecycle_state`、`resume_requires_review`、`resume_review_reasons`
- suspended package 的路径、最小字段、闭合集合和恢复输入约束必须能被 parser / validator 稳定消费；不允许把开放字符串伪装成闭合集合

---

## 3. CONTRACTS.md

### 作用

定义稳定边界，防止 AI 在实现过程中悄悄破坏接口和结构。

### 必填章节

- `## 使用规则`
- `## 一、接口契约`
- `## 二、架构契约`
- `## 三、变更规则`
- `## 四、传播治理补充`

### 接口契约最小内容

- 已锁定接口
- 已锁定核心函数或导出符号
- 已锁定数据结构、DTO、事件或表结构
- 可扩展不可破坏项
- 自由修改项

### 架构契约最小内容

- 依赖方向
- 分层规则
- 状态流或数据流
- 目录职责
- 事件或 DTO 语义

### 传播治理补充最小内容

传播治理补充应能引用或呈现 `.workflow-system/WORKFLOW_PROTOCOL.md §18.6` 中相关对象的审计结论。以下是审计维度提示，不是字段清单：

- candidate 回写记录
- `LayoutContract`
- `BehaviorContract`
- frozen zone / `UIAnchorReplacement`
- cascade source 记录
- insertion guard
- breakpoint contract
- compat path / wrapper rules
- API change downstream validation

### 更新时机

- 新项目初始化时建立初版
- 出现稳定 API、稳定模块边界或关键数据结构时补充
- 发生经确认的结构调整时同步更新

### 校验要求

- 每条锁定项都要能落到具体对象
- `🔒`、`🟡`、`🟢` 的含义必须清晰
- 架构契约不能只写抽象原则，必须可用于 diff 审查
- 传播治理补充必须能回答“哪些对象已进入 candidate / frozen / contract 保护面”
- layout / behavior 约束必须显式记录 cascade source、breakpoint、reflow 或 anchor 迁移信息，不能只写笼统风险
- 同文件复用场景中，必须能从契约里看出是否采用 `A -> AA` wrapper / compat path
- 后端 API 变更时，契约补充必须能直接列出需要跟进验证的前端 consumer 面

---

## 4. STATUS.md

### 作用

记录项目当前真实状态，避免稳定功能、在建功能和延后需求混在一起。

### 必填章节

- `## 项目概览`
- `## ✅ 已完成且稳定`
- `## 🔨 正在开发`
- `## 📋 待开发`
- `## ⚠️ 已知风险 / 观察点`
- `## ❌ 已移除 / 推迟`
- `## 🔜 下一检查点`
- `## 最近更新记录`

### 更新时机

- 新任务启动前阅读
- 每次任务完成后同步
- 需求取消、推迟或风险升级时同步

### 校验要求

- “已完成且稳定”里的事项默认不能被顺手重构
- “正在开发”要明确当前阶段，而不是只写大标题
- 状态变化应有最近更新记录

---

## 5. DECISIONS.md

### 作用

记录“为什么这么做”和“明确不做什么”，防止 AI 用自己的默认偏好覆盖用户决策。

### 必填章节

- `## 使用规则`
- `## 🏗️ 架构决策`
- `## 🎨 口味决策`
- `## ⏸️ 暂缓决策`
- `## 🔁 已演进 / 已替代`
- `## ❌ 已否决`

### 单条决策的最小字段

- 编号
- 标题
- 状态
- 背景
- 决策或结论
- 原因
- 约束
- 影响范围
- 替代方案
- 验证方式或复议条件

### 更新时机

- 需求评审时形成初版
- 关键技术分歧、产品口味选择或明确拒绝方案时更新
- 原决策失效时补充“变更说明”或“已演进 / 已替代”记录，不要直接覆盖原记录

### 校验要求

- 架构决策与口味决策不能混写
- `DECISIONS.md` 只记录原因、历史、替代方案和复议条件；不能单独定义当前有效规则
- 任何会改变当前行为、架构、接口或治理规则的决策，必须同步反映到 `CONTRACTS.md` 或 `.workflow-system/PROJECT_PROFILE.yaml` 后才算生效
- 暂缓项必须明确“不做”的边界
- 否决项必须可用于阻止未来重复提议
- 已演进 / 已替代项必须指向原决策编号，并记录后继决策或接管该决策的基线 / 里程碑
- 决策演进必须保留原记录，不能通过覆盖旧条目来伪造历史一致性

---

## 6. LESSONS.md

### 作用

沉淀跨任务、跨会话可复用的经验，减少重复踩坑。

### 必填章节

- `## 使用规则`
- `## 通用`
- `## 数据与存储`
- `## 前端与交互`
- `## 后端与服务`
- `## 测试与回归`
- `## 部署与运行时`

### 单条经验的最小字段

- 场景
- 结论
- 触发信号
- 应对动作

### 更新时机

- 同类问题出现第二次时必须沉淀
- 根因调查完成后补充
- 发布或部署踩坑后补充

### 校验要求

- 只记录能复用的经验，不记录单次聊天过程
- 经验必须带触发信号和行动建议
- 经验要足够具体，能直接用于下一次检查

---

## 7. TASK_SUMMARY.md

### 作用

总结单个任务的交付结果，供验收、回顾和归档使用。

在 vNext 中，本 schema 仅用于 legacy/source-repository 兼容和历史材料说明；
`close-task` 不生成独立持久化的 `TASK_SUMMARY.md`。交付摘要由
`closure_result` 提供，canonical task archive 负责持久保存。

### 必填章节

- `## 任务信息`
- `## 目标与结果`
- `## 改动范围`
- `## 契约与决策变化`
- `## 验证结果`
- `## 风险与后续`
- `## 交付清单`

### 更新时机

- 任务完成、准备交付时生成

### 校验要求

- 必须明确“目标是否达成”
- 必须列出验证证据
- 必须说明剩余风险与后续动作

---

## 8. TASK_ARCHIVE.md

### 作用

把已完成任务的关键上下文、结果和证据打包归档，便于后续检索。

### 必填章节

- `## 任务元数据`
- `## 原始任务包快照`
- `## 实际改动摘要`
- `## 契约与决策记录`
- `## 验证与交付证据`
- `## Lessons 回写`
- `## 后续关联`

`## Lessons 回写` 必须在 `archive-transaction` 成功时持久保存本次
closure preparation 的 admission verdict/provenance：

```yaml
lesson_admission:
  decision: admit | defer | no-op
  candidate_refs: []
  evidence_refs: []
```

该记录只证明 admission 决策，不表示 `LESSONS.md` 已经写入。`admit` 允许
后续 reconciliation 执行 `lesson-record-transaction`；`defer` / `no-op` 证明
本次 closure 不需要 Lesson write。不得为此新增 `lesson_pending`、closure
state、artifact 或 runtime object。

### 更新时机

- 任务收尾、归档进入 `TASKS/` 时生成

### 校验要求

- 必须能独立回答“做了什么、为什么、怎么验证的”
- 必须保留任务 ID、任务标题、任务 slug 和最终状态
- 必须包含可追溯到任务包和验证结果的引用

---

## 9. ROADMAP.md

### 作用

把版本窗口、里程碑和跨阶段依赖收敛到一个稳定文档里，避免长期规划散落在 `STATUS.md`、issue 或临时任务包中。

### 必填章节

- `## 使用规则`
- `## 生命周期阶段`
- `## 版本里程碑`
- `## 当前窗口`
- `## 候选事项池`
- `## 风险与依赖`
- `## 变更记录`

### 里程碑条目的最小字段

- 里程碑编号
- 目标版本或时间窗
- 目标结果
- 进入条件
- 完成定义
- 依赖
- 风险

### 更新时机

- 进入新的版本窗口或治理阶段时更新
- 有事项从候选池进入当前窗口时更新
- 里程碑被合并、拆分、推迟或取消时更新

### 校验要求

- 当前窗口必须能回答“现在优先做什么、明确不做什么”
- 里程碑必须有进入条件和完成定义，不能只有标题
- 风险与依赖必须能指向真实约束，而不是抽象愿景

---

## 10. BASELINES.md

### 作用

给发布、兼容性、安全、部署以及性能 / 可靠性建立正式基线，作为长期治理和非功能检查的统一落点。

### 必填章节

- `## 使用规则`
- `## 版本治理概览`
- `## 发布基线`
- `## 兼容性基线`
- `## 安全基线`
- `## 部署基线`
- `## 性能与可靠性基线`
- `## Gate 与错误码基线`
- `## 基线变更记录`

### 基线条目的最小字段

- 基线编号
- 状态
- 生效版本、环境或适用范围
- 必须满足的要求或阈值
- 验证入口、证据或观察指标
- 例外处理或审批方式

### Gate 与错误码基线最小字段

`BASELINES.md` 只能镜像或引用 `.workflow-system/WORKFLOW_PROTOCOL.md` 中已定义的 error code、blocker level、gate mapping、兼容窗口和 removal precondition。它不得新增、改名、降级或重新解释任何错误码、blocker level、merge gate、ship gate 或 `strategy_origin` 语义。

### 更新时机

- 新版本发布策略形成或调整时更新
- 兼容性、安全、部署要求变化时更新
- 性能 / 可靠性指标被重新设定时更新
- 例外策略被批准、撤销或收紧时更新

### 校验要求

- 每条基线都必须有生效范围，不能是无边界口号
- 发布、兼容性、安全、部署至少各有一个可落地条目
- 性能与可靠性基线必须包含可观察指标或明确验证入口
- Gate 与错误码基线必须能追溯到 `.workflow-system/WORKFLOW_PROTOCOL.md` 的正式定义，并保持 blocker level、merge gate、ship gate 与错误码集合对齐
- 基线变更必须追加记录，不能直接抹去旧版本要求

---

## 11. WORKFLOW_GUIDE.md

### 作用

给目标项目中的使用者和 AI agent 提供 workflow-system 操作手册，说明什么时候读哪些治理文档、什么时候调用哪些 skill、不同场景应该走哪条流程。

### 必填章节

- `## 使用规则`
- `## 文档速查`
- `## Skill 速查`
- `## 标准任务流程`
- `## 按场景选择`
- `## 越界处理`
- `## 交付检查`

### 更新时机

- 新增、删除或重命名 workflow skill 时更新
- 调整标准任务流程、handoff 或主要治理文档职责时更新
- 新增治理文档产出物时更新

### 校验要求

- 必须覆盖所有核心治理文档的用途和主要使用时机
- 必须覆盖标准任务链上的主要 skill
- 不得重新定义字段结构、错误码、gate 或 blocker 语义
- 与 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 或 skill frontmatter 冲突时，以规范源和 skill frontmatter 为准
- 当 `阶段 1：需求进入` 存在 record-only intake skill（如 `capture-work-item`）时，`WORKFLOW_GUIDE.md` 必须把它表达成独立的 record-only branch，并明确它不是 `create-current-task` 主链

---

## 11a. Workflow capability 与 golden fixture manifests

### 作用

`.workflow-system/WORKFLOW_CAPABILITIES.yaml` 把 `.workflow-system/WORKFLOW_PROTOCOL.md §4c` 的 public / internal / runtime / compat capability surface 物化为可机器校验的 shadow declaration。

`test/fixtures/workflow-capability-cases.yaml` 承载迁移 non-loss conformance cases。它只描述输入和预期，不定义新的治理规则。

### Capability manifest 顶层结构

```yaml
schema_version: 1
status: shadow
public_entries: []
internal_capabilities: []
runtime_operations: []
compatibility_aliases: []
```

顶层约束：

- `schema_version` 当前固定为 `1`
- `status` 当前固定为 `shadow`
- 四个列表都必须存在且非空
- 所有 canonical `id` 和所有 `legacy_name` 必须在各自命名空间内唯一
- manifest 不得包含 target-project task、status、contract、decision 或 release facts

### Public entry 最小结构

```yaml
public_entries:
  - id: <public-entry-id>
    exposure: public
    status: shadow
    installable: false
    modes:
      - id: <mode-id>
        covers_stages:
          - <canonical stage id>
        capabilities:
          - <internal capability id>
        runtime_operations:
          - <runtime operation id>
        mutation: <none|code|task-artifact|semantic-proposal>
        terminal_behavior: <continue|report-only|manual-decision|complete>
        authority_boundary:
          protocol: <define|validate|none>
          model: <propose|classify|none>
          user: <confirm|approve|none>
          runtime: <validate-and-commit|none>
        automatic_handoff: <entry-id:mode-id|not-applicable>
```

校验要求：

- public entry `id` 必须来自 `.workflow-system/WORKFLOW_PROTOCOL.md §4c.2` 的闭集
- `status` 固定为 `shadow`，`installable` 固定为 `false`
- `modes` 必须非空；同一 entry 下 mode `id` 唯一
- 每个 mode 的 `covers_stages` 必须非空，只能使用 §4a canonical ID；全部 modes 的 union 必须覆盖 10 个 stage group
- `capabilities` 和 `runtime_operations` 必须存在；允许空数组，但非空引用必须闭合
- `authority_boundary` 必须包含 `protocol / model / user / runtime` 四个 key，并分别使用对应闭集；不得省略未参与 owner，未参与时显式写 `none`
- mode 引用任一 `authority_owner: user` 的 internal capability 时，`authority_boundary.user` 不得为 `none`
- `automatic_handoff` 若非 `not-applicable`，必须解析到已声明的 `<entry-id>:<mode-id>`
- `terminal_behavior = report-only | manual-decision` 时，`automatic_handoff` 固定为 `not-applicable`
- `mutation = none` 的 fixture 预期写集合必须为空

### Internal capability 最小结构

```yaml
internal_capabilities:
  - id: <internal-capability-id>
    exposure: internal
    installable: false
    kind: <policy|resolver|validator|gate|router>
    authority_owner: <protocol|model|user|runtime>
    description: <non-empty string>
```

校验要求：

- `id` 唯一且非空
- `exposure` 固定为 `internal`
- `installable` 固定为 `false`
- `kind` 与 `authority_owner` 使用闭集
- `description` 非空

### Runtime operation 最小结构

```yaml
runtime_operations:
  - id: <runtime-operation-id>
    exposure: runtime
    installable: false
    proposal_kind: <non-empty string>
    proposal_schema_ref: runtime-proposal-envelope
    canonical_state_sources:
      - <repo-relative canonical source or explicit not-applicable>
    write_targets:
      - <exact repo-relative file or bounded pattern>
    write_policy: exact-allowlist
    source_tuple_required: true
    authority_evidence_required: true
    conflict_key: <non-empty deterministic key description>
    atomic: true
    idempotence: fail-closed
    conflict_policy: fail-closed
    result_states:
      - success
      - no-op
      - conflict
      - blocked
```

校验要求：

- `id` 唯一且非空
- `exposure` 固定为 `runtime`
- `installable` 固定为 `false`
- `proposal_kind` 非空
- `proposal_schema_ref` 固定为 `runtime-proposal-envelope`
- `canonical_state_sources` 非空，Phase 0 闭集为五个 live governance docs、`AGENTS.md`、`CLAUDE.md`、`TASKS/{paused,interrupted,inbox}` 和 materialized canonical archive path；不得指向 derived cache、新状态数据库或宽泛 `TASKS`
- `write_targets` 非空，Phase 0 闭集为：`docs/workflow/{CURRENT_TASK,STATUS,CONTRACTS,DECISIONS,LESSONS}.md`、`AGENTS.md`、`CLAUDE.md`、`TASKS/{paused,interrupted,inbox}/**`、`TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md`；新增目标必须先修改 protocol/schema，不得用 `**`、`docs/**`、`TASKS/**` 等宽泛 pattern 绕过
- `write_policy` 固定为 `exact-allowlist`
- `source_tuple_required` 与 `authority_evidence_required` 固定为 `true`
- `conflict_key` 非空
- `atomic` 固定为 `true`
- `idempotence` 固定为 `fail-closed`
- `conflict_policy` 固定为 `fail-closed`
- `result_states` 去重后的集合必须严格等于 `success / no-op / conflict / blocked`

`runtime-proposal-envelope` 是 Phase 0 的声明性通用 envelope，至少携带：

- 与 `proposal_kind` 一致的 typed proposal kind
- canonical source revision / lifecycle tuple
- model / user / protocol authority evidence
- 与 `write_targets` 一致的 exact intended writes
- 与 operation 声明一致的 conflict key
- idempotency identity

Phase 0 只校验 declaration，不执行 commit。

### Phase 2 vNext Runtime state-changing slice

Phase 2 的 `execute-step` 绑定 `task-state-transaction` 与
`finding-queue-transaction`；Slice A 另外绑定 `task-state-transaction` 给
`prepare-task`，但仅允许 `clear-resume-review-gate`，以及绑定
`lifecycle-transaction` 给 `task-lifecycle` 的 `pause`、`interrupt`、
`resume-paused`、`resume-interrupted`。具体 proposal、runtime state 和
handler contract 见 `.workflow-system/vnext/RUNTIME_CONTRACT.yaml`。

`CURRENT_TASK.md` 的 frontmatter 在保持原有 `schema_version`、`kind`、
`document_id` 的基础上，必须包含 `runtime_state`：

```yaml
runtime_state:
  schema_version: 1
  kind: vnext-current-task-runtime-state
  task_id: <materialized-task-id>
  task_slug: <materialized-task-slug>
  workflow_status: active
  lifecycle_state: active
  resume_requires_review: false
  resume_review_reasons: []
  active_step_id: <stable-step-id>
  active_step_status: ready | in-progress | completed | blocked
  finding_queue_revision: <non-negative integer>
  review_cycle:
    id: <review-cycle-id>
    repair_round: <0..3>
    counted_repair_wave_ids: []
  findings: []
  execution_log: []
  applied_proposals: []
```

Runtime state 与正文中的任务 identity / lifecycle tuple 必须一致；不一致
即为 source conflict。`findings` 以稳定 fingerprint 唯一标识，只有
`current-owner + admitted scope + mechanical decision + evidence + bounded
root cause` 的记录才能进入 repair。`review_cycle` 记录当前 review cycle、
已计数的 repair wave 与其 round；每个 fingerprint 最多两次 repair attempt，
review cycle 最多三轮，同一 repair wave 可包含多个 finding 但只计一轮；
`applied_proposals` 只用于同一 canonical 文档内的幂等回放，不构成第二状态源。

`task-state-transaction` 的写目标必须精确解析为当前 Project Profile 指定的
`CURRENT_TASK.md`，禁止 broad glob、跨 operation 写入或直接编辑其他治理
文档。`lifecycle-transaction` 的每次写入必须精确解析为同一
`CURRENT_TASK.md` 与一个由 task identity 推导的
`TASKS/paused/TASK-<id>-<slug>.md` 或
`TASKS/interrupted/TASK-<id>-<slug>.md`；resume 不得从 latest 或模糊候选
猜测 package。Runtime 结果闭集为 `success / no-op / conflict / blocked`；
只有 `success` 且 read-back 校验通过时才计为治理写入。dry-run 不写文件，
stale source、重复 idempotency key、旧 schema、缺失 authority/evidence、
非法状态转换、重复 finding 或超出 repair budget 均 fail-closed。

Lifecycle replay 在返回 `no-op` 前必须重新验证对应 secondary package 的存在、
task identity、artifact kind 与 action marker；package 缺失、marker 损坏、
rehydration 状态不匹配或 gate 漂移时必须返回 `conflict` / `blocked`，不能返回
success-shaped no-op。resume 还必须在 snapshot normalization 前比较
`CURRENT_TASK.md` 当前的 `resume_requires_review` / `resume_review_reasons`
与 package header 的对应字段。

Lifecycle Slice A 的恢复规则为：pause 与 interrupt 使用不同的 lifecycle
state 和证据集；resume 必须恢复到 `active + active` 并保留
`resume_requires_review=true` 及非空规范化 reasons；在
`prepare-task` 完成 readiness/resume review 前，`execute-step` 与 finding
admission 不得提交。`prepare-task` 的 Runtime action 只能清除 gate 与
reasons，不能借此修改 identity、scope、plan、step 或其他 task facts。
生命周期 transaction 对 live task 与 suspended package 使用同一 atomic
commit，提交后 read-back；任一校验失败时 rollback 两个路径并再次 read-back
验证。`supersede` 与 durable `replan` 不属于本 Slice 的 Runtime mutation。

### Compatibility alias 最小结构

```yaml
compatibility_aliases:
  - legacy_name: <current skill template name>
    exposure: compat
    classification: <keep|merge|runtime|delete>
    status: active
    installable: true
    target_entry: <public-entry-id>
    target_mode: <mode-id>
    required_capabilities:
      - <internal capability id>
    runtime_operations:
      - <runtime operation id>
    migration_case: <MR-K01|MR-M01|MR-R01|MR-D01 style id>
    preserve_handoff: true
    preserve_writes: true
```

校验要求：

- `legacy_name` 必须与 `templates/skills/*.SKILL.md.tmpl` 的实际 name set 严格一一对应
- `exposure` 固定为 `compat`，`status` 固定为 `active`，`installable` 固定为 `true`
- `target_entry` 与 `target_mode` 必须解析到 public entry / mode
- capability / Runtime 引用必须闭合
- `required_capabilities` 与 `runtime_operations` 必须分别严格等于 target mode 的同名依赖集合；不得隐式缺少或增加 gate
- target mode 的 `covers_stages` 必须包含 legacy template 的 canonical stage
- legacy template `writes: []` 当且仅当 target mode `mutation: none`；read-only wrapper 不得映射到 code / task-artifact / semantic-proposal，legacy writer 也不得映射到 `none`
- 每个 alias 必须有唯一 row-level `migration_case`
- classification 与 migration-case prefix 必须一致：`keep -> MR-K`、`merge -> MR-M`、`runtime -> MR-R`、`delete -> MR-D`
- Phase 0 的 `preserve_handoff` 与 `preserve_writes` 固定为 `true`；不得用处置分类推导旧行为可以提前变化
- shadow 阶段的 target 只表达 semantic ownership，不执行 alias redirect；legacy template handoff / conditional handoff 继续是当前行为事实，未来 route equivalence 必须由 MR / GR evidence 单独证明

### Golden fixture manifest 顶层结构

```yaml
schema_version: 1
cases: []
```

每个 case 的最小结构：

```yaml
cases:
  - id: <MR-*|GR-*>
    kind: <row|global>
    invariant: <non-empty string>
    capability_refs:
      - <public:entry/mode|internal:id|runtime:id>
    initial_state:
      task_status: <string|not-applicable>
      lifecycle_state: <string|not-applicable>
      diff_target: <string|not-applicable>
      evidence:
        - <string|not-applicable>
    invocation:
      entry: <public-entry-id>
      mode: <mode-id>
      legacy_alias: <legacy-name|not-applicable>
    expected:
      guard: <allow|block|ask-user|no-op>
      verdict: <non-empty string>
      writes: []
      handoff: <entry-id:mode-id|ask-user|not-applicable>
      terminal_behavior: <continue|report-only|manual-decision|complete>
      diff_target: <preserve|required|forbidden|not-applicable>
      evidence:
        - <string|not-applicable>
```

校验要求：

- `schema_version` 固定为 `1`
- ID 集合严格等于 `MR-K01..K05`、`MR-M01..M20`、`MR-R01..R07`、`MR-D01..D05`、`GR-01..GR-18`
- `MR-*` case 的 `kind` 固定为 `row`，必须带非 `not-applicable` legacy alias，并与 alias 的 `migration_case` 双向一致
- `MR-*` case 的 `capability_refs` 必须严格等于 alias target public mode、`required_capabilities` 与 `runtime_operations` 的组合，不得遗漏或混入无关 capability
- `GR-*` case 的 `kind` 固定为 `global`，可使用 `legacy_alias: not-applicable`
- `capability_refs` 非空且全部可解析；引用语法固定为 `public:<entry>/<mode>`、`internal:<id>` 或 `runtime:<id>`
- `initial_state`、`invocation`、`expected` 的列出字段不得省略
- `initial_state.evidence` 与 `expected.evidence` 非空；不适用时必须显式写 `not-applicable`
- `expected.writes` 必须存在，允许为空数组
- `expected.writes` 的非空项必须是 bounded repo-relative path / symbolic path，不得使用 `design-artifacts` 一类不可解析标签
- `expected.handoff` 若指向 public entry，必须使用 `<entry-id>:<mode-id>` 并可解析
- `report-only` / `manual-decision` case 不得声明可执行 automatic handoff
- `guard: no-op` 的 case 必须以 `terminal_behavior: complete` 结束，避免把 mode 默认 `continue` 与本次 no-op outcome 混为一谈
- `guard: allow` 的 case 必须与 invocation mode 声明的 `terminal_behavior` 一致；block / ask-user 分支可声明其实际停止或重路由行为

### 更新方向与失败行为

- 更新方向固定为 `protocol/schema -> capability manifest / fixtures -> validator/tests`
- 当前 Skill template set 只提供 legacy-name coverage evidence；Phase 0 validator 不得为修复 manifest drift 而修改模板
- capability / fixture validator 必须先完整解析和验证，再返回结果；不得部分接受或静默丢弃未知 / 重复记录
- 最小错误类别为 `CAPABILITY_SCHEMA_INVALID`、`CAPABILITY_DUPLICATE_ID`、`CAPABILITY_DANGLING_REFERENCE`、`CAPABILITY_STAGE_COVERAGE_MISSING`、`CAPABILITY_COMPAT_COVERAGE_MISMATCH`、`CAPABILITY_TERMINAL_HANDOFF_INVALID`、`FIXTURE_SCHEMA_INVALID`、`FIXTURE_DUPLICATE_ID`、`FIXTURE_COVERAGE_MISMATCH`、`FIXTURE_CAPABILITY_UNRESOLVED`
- capability / fixture conformance 由现有 protocol-level `workflow-skills-tests` entrypoint 执行；不得绑定或复用 target-project validation slot

---

## 12. 推荐落地顺序

如果要逐步启用这些文档，建议按下面顺序启用：

1. `WORKFLOW_GUIDE.md`
2. `CONTRACTS.md`
3. `STATUS.md`
4. `ROADMAP.md`
5. `BASELINES.md`
6. `DECISIONS.md`
7. `CURRENT_TASK.md`
8. `LESSONS.md`
9. `TASK_SUMMARY.md`
10. `TASK_ARCHIVE.md`

这样可以先建立稳定边界和长期演进框架，再补齐任务治理和经验沉淀。
