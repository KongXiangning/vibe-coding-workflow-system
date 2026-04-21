# FILE_SCHEMAS.md

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
- `WORKFLOW_PROTOCOL.md` 与 `FILE_SCHEMAS.md` 是规范源；模板只能承载这里已经定义的结构
- `templates/**` 负责定义生成骨架，不能偷偷扩展未在规范源登记的新章节或新字段
- `generated/**` 与 `SKILL_REGISTRY.md` 是当前仓库的参考产物；`scripts/workflow-runtime.ts` 必须把规范源、模板骨架和参考产物一起收集到 `dist/workflow-system/**`
- v26 是在 v25 基线上的增量修复版；规范更新默认按 additive extend 处理，除非显式声明替代旧规则
- 任何传播治理公开结构一旦进入规范源，必须同时具备：正式 schema、默认规则、测试要求，不能只留结构名

## 1.1 传播治理公开结构 schema 要求

### 测试样例通用要求

- 每个测试样例都必须记录：
  - 输入场景
  - discovery evidence
  - 期望 `ContractCompatibilityResult`
  - 期望 gate / severity / `strategy_origin`
- 所有错误结果都必须落成正式字段，而不是口头说明：
  - `error_code`
  - `object_path`
  - `severity`
  - `default_blocker_level`
  - `evidence`
  - `strategy_origin`
  - `branch_gate_mapping`
  - `suggested_resolution`

### EvidenceRecord

- 文档承载：`CURRENT_TASK.md > 传播治理记录 > discovery evidence`
- 正式字段：`mechanism`、`query_or_entrypoint`、`scope`、`result_summary`、`confidence`、`gaps`
- 默认规则：命中 locked / shared / API / UI frozen target 时，默认至少记录两种不同 discovery mechanism
- 测试要求：验证 discovery 输入、机制多样性、confidence 与 gap 输出

### UIAnchorReplacement

- 文档承载：`CONTRACTS.md > frozen zone / UI anchor migration`
- 正式字段：`old_anchor`、`successor_anchor`、`transition_window`、`alias_policy`、`alias_details`、`relation_migration`、`removal_precondition`、`verification`
- 默认规则：旧锚点移除前必须满足 `removal_precondition`
- 测试要求：验证 alias 策略、迁移窗口与 removal precondition

### ContractCompatibilityResult

- 文档承载：`CURRENT_TASK.md > blockers / gate status`
- 正式字段：`error_code`、`object_path`、`severity`、`default_blocker_level`、`evidence`、`strategy_origin`、`branch_gate_mapping`、`suggested_resolution`
- 默认规则：必须作为正式 schema 使用，不能退化成“推荐结构”或自由 prose
- 测试要求：验证 blocker 结果字段完整且 gate / severity / strategy_origin 一致

### EvidenceAggregation

- 文档承载：`CURRENT_TASK.md > aggregation / complexity`
- 正式字段：`aggregation_strategy`、`sources`、`candidate_impact_set`、`significant_divergence`、`divergence_reason`、`unresolved_gaps`、`aggregated_confidence`
- 默认规则：主线固定 `aggregation_strategy=union`
- 测试要求：验证 union 聚合、divergence priority 与 unresolved gap 输出

### ComplexityAssessment

- 文档承载：`CURRENT_TASK.md > aggregation / complexity`
- 正式字段：`propagation_depth`、`direct_consumers`、`total_candidate_consumers`、`cross_boundary_hops`、`exceeded_metrics`、`threshold_status`、`forced_strategy`
- 默认规则：`direct_consumers_exceeded` 与 `total_consumers_exceeded` 必须分开解释，前者保护旧入口，后者控制全传播面与迁移窗口
- 测试要求：验证 over-limit 进入正确 branch，且 direct / total 两类 exceed 语义不混写

### over_limit_policy

- 文档承载：`CURRENT_TASK.md > aggregation / complexity`
- 正式字段：`threshold_trigger`、`selected_branch`、`rationale`
- 默认规则：每个非 `none` 分支都必须能映射到 blocker 路径；`direct-change` 只允许在 `forced_strategy`
- 测试要求：验证 branch 选择、rationale、旧入口保护与迁移窗口判断

### evidence_diff_threshold

- 文档承载：`CURRENT_TASK.md > aggregation / complexity`
- 正式字段：`absolute_diff`、`relative_diff_ratio`
- 默认规则：v26 主线固定 `3` / `0.5`
- 测试要求：验证 threshold 命中时的 branch / gate 影响

### MutationEligibilityAssessment

- 文档承载：`CURRENT_TASK.md > eligibility / candidate / registry`
- 正式字段：`common`、`when_pending_prerequisites`、`when_completed`
- 默认规则：必须采用 `common / when_pending_prerequisites / when_completed` 条件分支 schema；`pending-prerequisites` 禁止最终 eligibility，`completed` 禁止残留 `blocking_gaps`
- 测试要求：验证条件分支约束、`blocking_gaps` 到 P0 映射、`MUTATION_NOT_ELIGIBLE` 与前置 gap 分流

### EntityMutationChecklist

- 文档承载：`CURRENT_TASK.md > eligibility / candidate / registry`
- 正式字段：`entity_name`、`covered_categories`、`unresolved_categories`、`gap_resolution`
- 默认规则：必须覆盖 storage / api / dto / event / projection / ui；存在 gap 时必须留在 unresolved 或 blocker 路径
- 测试要求：验证分类覆盖、gap 可见性与 blocker 输出

### LayoutContract

- 文档承载：`CURRENT_TASK.md > layout / behavior / migration / regression` 与 `CONTRACTS.md > LayoutContract`
- 正式字段：`container_path`、`machine_anchor`、`layout_model`、`locked_properties`、`locked_relations`、`cascade_sources`、`sibling_reflow_sensitive`、`insertion_guard`、`breakpoint_contracts`、`stacking_context`、`side_effect_scope`
- 默认规则：必须显式记录 cascade source、breakpoint、reflow、stacking context 与 insertion guard
- 测试要求：验证 sibling reflow、breakpoint drift、specificity override、stacking context break

### RegistryFreshnessReport

- 文档承载：`CURRENT_TASK.md > eligibility / candidate / registry`
- 正式字段：`object_path`、`registry_consumers`、`discovered_consumers`、`effective_consumers`、`freshness`、`reconciliation`、`divergence_summary`
- 默认规则：registry 与 discovery 不一致时，按 discovered union 扩展 `effective_consumers`
- 测试要求：验证 stale / locked-hit 场景、reconciliation 与 discovered-union 生效

### LinkedRegressionRecord

- 文档承载：`CURRENT_TASK.md > layout / behavior / migration / regression`
- 正式字段：`regression_chain_id`、`current_issue`、`prior_fix_refs`、`window_scope`、`window_size`、`count_basis`、`linked_components`、`shared_objects`、`relation`、`escalation`
- 默认规则：同一 `regression_chain_id` 下连续两个 fix task 命中关联回归时必须早停
- 测试要求：验证回归链计数、shared object 关联与 `LINKED_REGRESSION_EARLY_STOP`

### BehaviorContract

- 文档承载：`CURRENT_TASK.md > layout / behavior / migration / regression` 与 `CONTRACTS.md > BehaviorContract`
- 正式字段：`object_path`、`assertions`、`verification`
- 默认规则：后端 API 变更时必须扩展验证前端 `hook` / `store` / `page` / `widget` / `form` / `table` / `detail view`
- 测试要求：验证关键交互断言与下游 consumer 面

### StagedMigrationPlan

- 文档承载：`CURRENT_TASK.md > layout / behavior / migration / regression`
- 正式字段：`migration_id`、`phases[*].phase_id`、`phases[*].goal`、`phases[*].runtime_state`、`phases[*].verification`、`phases[*].exit_criteria`、`dependencies`
- 默认规则：phase 不足、`runtime_state` 缺失、缺少 `verification` / `exit_criteria` 都属于不完整
- 测试要求：验证 phase 完整性、runtime_state、verification、exit criteria 与依赖关系

### migration_plan_requirement

- 文档承载：`CURRENT_TASK.md > layout / behavior / migration / regression`
- 正式字段：`required`、`trigger_reason`
- 默认规则：`recommend_task_split` 继续推进时，若 `required=true` 则必须同步给出 `StagedMigrationPlan`
- 测试要求：验证 required 条件与缺失时 blocker

### implicit_shared_object_detection

- 文档承载：`CURRENT_TASK.md > eligibility / candidate / registry` 与 `CONTRACTS.md > candidate 回写记录`
- 正式字段：`object_path`、`object_kind`、`direct_consumers`、`cross_boundary`、`critical_path_hit`、`locked_hit_chain`、`proposed_contract_state`、`writeback_required`
- 默认规则：命中 shared threshold 后必须立即进入 candidate / protected 面；同文件 `A/B/C/Z` 复用场景要保住 `A`，走 `A -> AA` wrapper / compat path
- 测试要求：验证 shared-threshold 命中、candidate 回写、`locked_hit_chain` 传递与 `A -> AA` 路径

推荐的占位符约定：

- 项目级变量：`{{PROJECT_NAME}}`、`{{PROJECT_TYPE}}`、`{{TECH_STACK}}`
- 任务级变量：`{{TASK_ID}}`、`{{TASK_TITLE}}`、`{{TASK_SLUG}}`
- 运行时变量：`{{DATE}}`、`{{AUTHOR}}`、`{{VERSION}}`

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
- `## 传播治理记录`
- `## 实施步骤`
- `## 回归检查项`
- `## 回滚点`
- `## 执行记录`

### 传播治理记录最小内容

- `change_start_set`
- `EvidenceRecord`
- `evidence_diff_threshold`
- `EvidenceAggregation`
- `ComplexityAssessment`
- `MutationEligibilityAssessment`
- `implicit_shared_object_detection`
- `RegistryFreshnessReport`
- `EntityMutationChecklist`
- `LayoutContract`
- `BehaviorContract`
- `migration_plan_requirement`
- `StagedMigrationPlan`
- `LinkedRegressionRecord`
- `ContractCompatibilityResult`
- conformance / verification cases

### 更新时机

- 新需求进入时创建
- 范围锁定后补齐边界
- 每完成一个实现步骤后更新执行记录
- 验证完成后更新最终状态

### 校验要求

- 验收标准必须可验证
- 允许/禁止修改范围必须明确到目录、文件或契约层
- `## 任务信息` 在进入 A3 执行后必须包含任务 ID、任务标题和任务 slug；生成骨架阶段允许保留对应占位符
- 命中传播治理时，`## 传播治理记录` 必须显式记录 discovery、aggregation、eligibility、layout/behavior、migration 和 blocker 状态，而不是只在对话里口头说明
- 命中传播治理 blocker 或兼容性判断时，必须记录至少一个 conformance case，包含输入场景、discovery evidence、期望 `ContractCompatibilityResult`、期望 gate / severity / `strategy_origin`
- `MutationEligibilityAssessment` 必须区分 `pending-prerequisites` 与 `completed` 两类状态，不能把前置 gap 和最终 `not-eligible` 结果混写
- `ContractCompatibilityResult` 必须至少包含错误码、对象路径、blocker/gate 语义、证据与建议处置
- `ComplexityAssessment` 必须把 `direct_consumers_exceeded` 与 `total_consumers_exceeded` 分开记录其语义，不能用一个笼统 over-limit 结论带过
- `RegistryFreshnessReport` 命中 registry / discovery 不一致时，必须记录 `effective_consumers` 或等价的 discovered-union 扩展结果
- `EntityMutationChecklist` 必须记录 `covered_categories` 与 `gap_resolution`
- `StagedMigrationPlan` 命中 task split / 迁移窗口时必须带 `runtime_state`、`verification` 和 `exit_criteria`
- 后端 API 变更必须在任务包里显式列出前端下游验证面：`hook`、`store`、`page`、`widget`、`form`、`table`、`detail view`
- 至少包含一个当前可执行步骤
- 回滚点必须可操作，不能只有笼统描述

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

- gate 编号
- 适用错误码或封闭集合
- 默认 blocker level
- merge gate
- ship gate 或升级条件
- 兼容窗口 / removal precondition（如适用）
- 证据归档位置
- 相关 `strategy_origin` / branch 语义（如适用）

### 更新时机

- 新版本发布策略形成或调整时更新
- 兼容性、安全、部署要求变化时更新
- 性能 / 可靠性指标被重新设定时更新
- 例外策略被批准、撤销或收紧时更新

### 校验要求

- 每条基线都必须有生效范围，不能是无边界口号
- 发布、兼容性、安全、部署至少各有一个可落地条目
- 性能与可靠性基线必须包含可观察指标或明确验证入口
- Gate 与错误码基线必须能把 blocker level、merge gate、ship gate 与错误码集合对齐
- 基线变更必须追加记录，不能直接抹去旧版本要求

---

## 11. 推荐落地顺序

如果要逐步启用这些文档，建议按下面顺序启用：

1. `CONTRACTS.md`
2. `STATUS.md`
3. `ROADMAP.md`
4. `BASELINES.md`
5. `DECISIONS.md`
6. `CURRENT_TASK.md`
7. `LESSONS.md`
8. `TASK_SUMMARY.md`
9. `TASK_ARCHIVE.md`

这样可以先建立稳定边界和长期演进框架，再补齐任务治理和经验沉淀。
