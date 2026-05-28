# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：008
- 任务标题：补齐方法论文档对 003-007 新增 workflow 分支的高层叙事
- 任务 slug：methodology-docs-cover-003-007-skill-branches
- 当前状态：active
- 生命周期状态：active
- 恢复需审查：false
- 恢复审查原因：
- 创建时间：2026-05-28

## 背景与上下文

- 用户要求先按 `/create-current-task`、`/investigate-root-cause` 的顺序处理此前文档审查发现的 major finding，再补完文档并审查。
- 已确认问题：`vibe-coding/vibe-coding-methodology.md` 与 `vibe-coding/vibe-coding-workflow.md` 仍停留在旧的抽象层，没有把任务 `003-007` 新增的高层 workflow 分支补成完整叙事。
- 已确认缺口：
  - `capture-work-item` 的 record-only intake branch 未进入方法论 / 工作流说明层。
  - `pause-current-task` / `interrupt-current-task` / `resume-*` 的 suspend-resume lifecycle 未进入方法论 / 工作流说明层。
  - `review-current-task` 作为 resume 后首个强制消费者未形成明确叙事。
  - ownership-aware routing、active-owner guard 与 `report-only` terminal rule 没有被提升成完整高层映射。
- 已确认现状：目标项目生成文档 / 指引已覆盖上述能力，差距集中在人类阅读的高层方法论文档。

## 验收标准

- [x] `vibe-coding/vibe-coding-methodology.md` 在高层方法论叙事中明确补入 `阶段 1` 的 main chain 与 `capture-work-item` record-only branch，并说明其与 `CURRENT_TASK.md` / `TASKS/inbox/**` 的关系。
- [x] `vibe-coding/vibe-coding-methodology.md` 明确补入 ownership-aware routing、active-owner guard、`pause-current-task` / `interrupt-current-task` / `resume-*` lifecycle，以及 resume 后必须先回到 `review-current-task` 的高层逻辑。
- [x] `vibe-coding/vibe-coding-methodology.md` 明确补入 `run-regression(report-only)` 的 terminal 语义，不把只读审查自动接到修复链。
- [x] `vibe-coding/vibe-coding-workflow.md` 的阶段说明同步补齐上述高层逻辑映射，至少覆盖 `阶段 1`、`阶段 6`、`阶段 7`。
- [x] 文档仍保持“方法论 / 工作流说明层”的职责，不复制 protocol/schema 字段、枚举、错误码或 generated surface 细节；正式规则仍以下沉规范源为准。
- [x] `docs/workflow/generated/**`、`docs/workflow/SKILL_REGISTRY.md`、`templates/**`、`scripts/**`、`test/**`、`.workflow-system/{WORKFLOW_PROTOCOL.md,FILE_SCHEMAS.md,PROJECT_PROFILE.yaml}` 不发生修改。
- [x] 通过文档检索证据证明新增 skill 名称、`TASKS/inbox/**`、ownership-aware routing、active-owner guard、resume gate / `review-current-task`、`report-only` terminal 已在高层文档中可检索。

## 设计约束

- Design mode: none
- Design source: none
- Design acceptance: not applicable
- Design evidence: not applicable
- Design open decisions: none

## 发布后验证

- Release mode: none
- Deploy source: none
- Target environment: local
- Health checks: not applicable
- Canary window: not applicable
- Performance baseline: not applicable
- Rollback / recovery: 回退到 task start base `be98f4387265a81e2e1e67a16cf6bd80070291b6`，撤销本任务对方法论文档与当前任务包的修改。
- Release evidence: not applicable

## 允许修改范围

- `docs/workflow/CURRENT_TASK.md`
- `vibe-coding/vibe-coding-methodology.md`
- `vibe-coding/vibe-coding-workflow.md`

## 条件修改范围

- `vibe-coding/vibe-coding-quality-system.md`
  - 触发条件：只有当补齐 `methodology / workflow` 后仍存在明显的高层叙事断裂，且不改该文件就会让三份人类文档之间出现新的事实冲突。
  - 证据要求：必须先给出具体断裂点、为何不能仅靠前两份文档修复，以及保持职责边界后的最小改动理由。

## 禁止修改范围

- `.git/**`
- `node_modules/**`
- `dist/**`
- `docs/workflow/generated/**`
- `docs/workflow/SKILL_REGISTRY.md`
- `templates/docs/**`
- `templates/skills/**`
- `scripts/**`
- `test/**`
- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `docs/workflow/CONTRACTS.md`
- `docs/workflow/DECISIONS.md`
- `docs/workflow/STATUS.md`

## 受影响的契约

- 文档职责边界：方法论文档负责“为什么 / 何时用 / 高层逻辑”，不得复制 protocol / schema / generated surface 的实现细节。
- `CURRENT_TASK lifecycle runtime skills / resume review routing`
- `ownership-aware root-cause / regression / review-finding routing`
- `capture-work-item / TASKS/inbox/** record-only intake`

## 已确认决策

- 本任务只补高层叙事，不重开 protocol、schema、template、generated output、runtime 或测试范围。
- `capture-work-item` 继续保持 record-only branch，不自动 promote 成新任务。
- `pause-current-task` / `interrupt-current-task` / `resume-*` 的 lifecycle 继续由 `review-current-task` 消费恢复审查 gate。
- ownership-aware routing 继续保持 canonical route + guard-aware handoff 分离。

## 待确认问题

- 无阻断项；默认按最小文档补全执行。

## 实现方案

- Goal: 补齐方法论文档与工作流说明文档，使 003-007 新增 workflow 分支在高层叙事层可被直接理解。
- Architecture impact: 仅影响人类阅读文档，不改变 protocol、schema、template、generated output 或 runtime 行为。
- Technical approach:
  - 在 `vibe-coding-methodology.md` 补“日常任务链路 / 阶段 1 / QA 分流 / 阶段 7”中的新增分支叙事。
  - 在 `vibe-coding-workflow.md` 补“阶段 1 / 阶段 6 / 阶段 7”的高层逻辑映射。
  - 保持所有细节规则继续下沉到 `WORKFLOW_PROTOCOL.md`、`FILE_SCHEMAS.md`、`WORKFLOW_GUIDE.md` 与 generated skill docs。
- Alternatives considered:
  - 只改 generated docs：不能修复高层方法论阅读路径，拒绝。
  - 直接复制 protocol/schema 细节到方法论文档：会破坏职责边界，拒绝。
- Data / state flow: 人类文档阅读链从“通用 8 阶段”补齐到“含 record-only intake、ownership-aware routing、suspend/resume、report-only terminal”的完整高层链路。
- Compatibility: backward-compatible
- Risks and rollback: 风险主要是高层文档与规范源叙事重复或越权；通过显式声明“正式规则以下沉规范源为准”控制。
- Validation strategy: 使用文档 diff 审查 + 关键词检索验证高层叙事覆盖，不修改 generated surface。
- Open decisions: none

## 审查问题队列

- 当前来源：文档审查 / root-cause evidence
- Finding ID：DOC-008
  - Severity：major
  - Source：documentation audit
  - Status：resolved
  - File / symbol：`vibe-coding/vibe-coding-methodology.md`, `vibe-coding/vibe-coding-workflow.md`
  - Failure scenario：只阅读高层方法论文档时，无法发现 record-only intake、ownership-aware routing、suspend/resume 与 resume-review 链已经是正式 workflow 能力。
  - Minimal fix direction：只补高层逻辑映射，不复制 protocol/schema 细节。
  - Required test：文档检索证据显示新增 skill 名称、`TASKS/inbox/**`、ownership-aware routing、active-owner guard、`review-current-task`、`report-only` terminal 在高层文档中可检索。
  - Handoff：implement-current-step

## 传播治理记录

### change_start_set

- 对象路径：`vibe-coding/vibe-coding-methodology.md`, `vibe-coding/vibe-coding-workflow.md`
- 对象类型：human-facing methodology / workflow guidance narrative
- 变更起点语义：补齐 003-007 新增 workflow 分支在高层文档层的逻辑映射。

### discovery evidence

- `EvidenceRecord`：
  - mechanism：manual documentation audit
  - query_or_entrypoint：针对 `pause-current-task|interrupt-current-task|resume-paused-task|resume-interrupted-task|capture-work-item` 的全文检索与阶段章节对照
  - scope：methodology / workflow explanation coverage for tasks 003-007
  - result_summary：generated docs / guide / registry 已覆盖新增能力，但 `vibe-coding-methodology.md` 与 `vibe-coding-workflow.md` 缺少对应高层叙事。
  - confidence：high
  - gaps：待补完后复核检索结果

### aggregation / complexity

- `evidence_diff_threshold`：
  - absolute_diff：2
  - relative_diff_ratio：0.5
- `EvidenceAggregation`：
  - aggregation_strategy：union
  - candidate_impact_set：methodology docs, workflow overview docs
  - significant_divergence：true
  - divergence_reason：generated surface 完整，但高层叙事层遗漏新增分支
  - unresolved_gaps：补丁后待复核
  - aggregated_confidence：high
- `over_limit_policy`：
  - threshold_trigger：not triggered
  - selected_branch：direct-doc-fix
  - rationale：问题局限于高层人类文档，不需要扩大到 protocol / template / generated 层
  - direct_consumers_semantics：human readers, future task authors
  - total_candidate_consumers_semantics：documentation onboarding path

## 实施步骤

- [x] 步骤 1：更新 `docs/workflow/CURRENT_TASK.md`，固化任务范围、根因和验收标准。
- [x] 步骤 2：在 `vibe-coding/vibe-coding-methodology.md` 补齐阶段 1、阶段 6/7 与日常链路中的新增分支叙事。
- [x] 步骤 3：在 `vibe-coding/vibe-coding-workflow.md` 补齐阶段 1、阶段 6、阶段 7 的高层逻辑映射。
- [x] 步骤 4：用检索与差异复核确认高层文档已覆盖新增 skill 及相关配置，并确认未触碰 generated / protocol / template 面。

## 回归检查项

- [x] 检索 `capture-work-item`、`TASKS/inbox/**` 在 `vibe-coding/vibe-coding-methodology.md` 与 `vibe-coding/vibe-coding-workflow.md` 中可命中。
- [x] 检索 `pause-current-task`、`interrupt-current-task`、`resume-paused-task`、`resume-interrupted-task` 在两份高层文档中可命中。
- [x] 检索 `ownership-aware routing`、`active-owner guard`、`review-current-task`、`report-only` 在两份高层文档中可命中。
- [x] 确认 `docs/workflow/generated/**`、`docs/workflow/SKILL_REGISTRY.md`、`templates/**`、`scripts/**`、`test/**`、`.workflow-system/**` 无改动。

## 回滚点

- Task start base：`be98f4387265a81e2e1e67a16cf6bd80070291b6`
- Last reviewed checkpoint：not-yet-created
- Current diff review target：working-tree

## 执行记录

- 2026-05-28：按用户要求先加载 `/create-current-task` 与 `/investigate-root-cause` skill context，并基于既有文档审查 evidence 建立任务包。
- 2026-05-28：已确认问题属于当前仓库人类文档层，不涉及 protocol/schema/runtime 行为修复；最小修复面锁定为 `vibe-coding-methodology.md` 与 `vibe-coding-workflow.md`。
- 2026-05-28：已在两份高层文档补入 `capture-work-item` record-only branch、ownership-aware routing、active-owner guard、`pause/interrupt/resume` lifecycle、resume 后先 `review-current-task`、以及 `report-only` terminal 语义，并完成差异与检索复核。
- 2026-05-28：差异审查曾发现方法论文档误引 route 枚举名；已改回高层语义表达，终审结论为 clean。
