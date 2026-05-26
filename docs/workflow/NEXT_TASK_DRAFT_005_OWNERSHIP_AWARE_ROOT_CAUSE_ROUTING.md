# NEXT_TASK_DRAFT_005_OWNERSHIP_AWARE_ROOT_CAUSE_ROUTING.md

## 草案状态

- 用途：任务 005 候选任务包，供后续 `/create-current-task` 或 `/review-current-task` 复审。
- 当前状态：draft_for_review
- 不接管当前 `CURRENT_TASK.md`。
- 不代表任务 005 已开始实施。
- 本稿以任务 `003` 的 lifecycle contract foundation 与任务 `004` 的 lifecycle runtime skills 已完成为前提，只继续推进 **ownership-aware root-cause / regression / finding routing**。

## 任务信息

- 任务 ID：005
- 任务标题：实现 ownership-aware root-cause routing 与 blocker 归属判定（第三阶段）
- 任务 slug：ownership-aware-root-cause-routing
- 建议初始 handoff：`create-current-task`

## 任务目标

在任务 `003` 已稳定 lifecycle contract、任务 `004` 已落地 pause / interrupt / resume runtime skills 的前提下，为 workflow-system 明确以下“问题归属与路由”能力：

1. 当当前 active task 在实现、回归或只读审查中遇到 failure / blocker 时，如何判断问题属于：
   - 当前 active task
   - 某个 paused package
   - 某个 interrupted package
   - 需要 widening 吸收的当前任务范围外问题
   - 应单独登记的新 bug task
2. `investigate-root-cause`、`run-regression`、`sync-review-findings` 如何基于该归属结果稳定 handoff。
3. interrupt 后旧任务遗留问题阻断新 active task 时，workflow-system 如何在**不新增新 schema / artifact / lifecycle state** 的前提下做可审计路由。

本任务不负责新增 inbox / backlog artifact，不重开 lifecycle foundation，不修改 runtime manifest / install / health report contract。

## 范围收窄结论

根据任务 `004` 的 deferred 边界，任务 `005` 只处理以下范围：

1. 扩展 `investigate-root-cause` 的 ownership-aware routing。
2. 扩展 `run-regression` 在 fail / blocked / report-only 场景下的 ownership-aware routing 结论。
3. 扩展 `sync-review-findings`，确保非当前任务 owner 的 finding 不会被错误写入当前 `CURRENT_TASK.md` 的审查问题队列。
4. 在 `WORKFLOW_GUIDE` 中补充“旧任务遗留问题阻断新 active task”的推荐入口与路由说明。
5. 补充对应模板生成测试与 generated reference outputs 同步。

以下内容继续保持 deferred，不并入任务 `005`：

- `external-root-cause-intake`
- `capture-work-item`
- inbox artifact / backlog artifact
- 新的 lifecycle state、resume reason、artifact kind、artifact path 或 `CURRENT_TASK.md` 标准字段
- `pause-current-task` / `interrupt-current-task` / `resume-paused-task` / `resume-interrupted-task` 的事务语义重写
- runtime manifest / install / health report contract 变更
- `DOCUMENT_CATALOG` 扩面
- 自动挑选 suspended package 的模糊恢复策略

## P0 前置原则

### 1. 只消费 003 / 004 已稳定契约，不重开 protocol / schema

任务 `005` 只消费以下已稳定事实：

- `CURRENT_TASK.md` 的 `当前状态`、`生命周期状态`、`恢复需审查`、`恢复审查原因`
- `TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `resume_review_reasons` 闭合集合
- `rehydration_status` / `ownership_state` 闭合集合
- `review-current-task` 是 resumed task 首个强制消费者
- 现有 `CURRENT_TASK.md > 回滚点` 三字段

因此本任务默认：

- 不新增 protocol-level named error
- 不新增 schema 字段
- 不新增 lifecycle state
- 不新增 artifact path
- 不新增 dedicated ownership ledger 文档

若实现证据证明现有 contract 无法表达 routing 所需事实，必须停止并回 `/lock-scope`，而不是在任务 `005` 中顺手改 `.workflow-system/WORKFLOW_PROTOCOL.md` 或 `.workflow-system/FILE_SCHEMAS.md`。

### 2. “归属判断”与“修复授权”必须分离

任务 `005` 的核心是 **routing**，不是自动替当前用户决定修哪里。

因此：

- 能明确归属到当前 active task 时，才允许继续现有实现 / 修复链。
- 能明确归属到 paused / interrupted package 时，只能在当前 live active ownership 已安全释放后 handoff 到对应 resume skill。
- 若当前 `CURRENT_TASK.md` 仍持有另一个 active task ownership，必须先 handoff `ask-user`，由用户决定是暂停 / 中断当前 active task、调整优先级，还是另建 bug task；不得直接 resume 并覆盖 live `CURRENT_TASK.md`。
- 需要 widening、产品 / 契约确认、或多个 owner 都可能成立时，不得伪装成当前任务 mechanical fix。
- “旧任务遗留问题现在阻断了我” 不等于 “当前任务自动吸收旧任务问题”。

### 3. ownership-aware routing 必须 fail-closed，而不是猜测式吸收

当失败或 finding 无法明确归属时，默认行为应是上浮而不是强行归队：

- 不得静默把 paused / interrupted owner 的问题写进当前 `CURRENT_TASK.md > 审查问题队列`
- 不得因为当前任务手上正 active，就默认它拥有所有 blocker
- 不得在没有唯一 suspended package 目标时自动 resume
- 不得在另一个 active task 仍持有 live ownership 时直接执行 resume，导致 suspended package payload 覆盖当前 `CURRENT_TASK.md`
- 不得把“可能是旧任务遗留问题”包装成当前任务 scope widening 已被批准

### 4. report-only 仍然是 terminal report

任务 `005` 不改变 `review-current-diff -> run-regression(report-only)` 的 terminal report 规则。

即：

- `run-regression` 在 `qa_mode=report-only` 时可以输出 ownership assessment
- 但 report-only pass / fail 都不能自动进入实现、resume 或 create-current-task
- report-only 结论只作为人工审核或后续 skill 的输入证据

### 5. finding 队列只承载“当前任务可修问题”

`sync-review-findings` 在任务 `005` 中必须更严格地区分：

- **当前任务可修**：允许入队并 handoff `implement-current-step`
- **需要 widening**：不入当前队列，回 `lock-scope`
- **属于 paused / interrupted owner**：不入当前队列；若当前 live active ownership 已释放，可 handoff 到对应 resume skill；否则先 handoff `ask-user`
- **独立新 bug**：不入当前队列，handoff `create-current-task`
- **产品 / 契约 / 架构确认**：不入当前队列，handoff `ask-user`

### 6. guide 只显式化路由，不引入新全局流程层

任务 `005` 若更新 `WORKFLOW_GUIDE`，只补充以下说明：

- interrupt 后旧任务遗留问题阻断当前 active task 时的推荐入口
- `investigate-root-cause` / `run-regression` / `sync-review-findings` 的 owner-sensitive route
- 什么时候回 `resume-paused-task` / `resume-interrupted-task`
- 什么时候改为 `create-current-task` 或 `lock-scope`

不新增新的 registry stage，不新增新的编排入口 skill。

## ownership-aware routing 模型（v1）

### 1. 路由输入证据

任务 `005` 的归属判断只允许依赖以下证据组合：

- 当前 active `CURRENT_TASK.md` 的目标、Allowed / Forbidden / Conditional Files、实施步骤、回滚点
- 当前 diff review target
- 当前失败 / blocker / finding 的位置、失败场景、调用链、日志、测试输出
- paused / interrupted package 的 artifact kind、`rehydration_status`、`ownership_state`、checkpoint / dirty / recovery evidence
- 是否存在唯一、可恢复、且与当前失败高度相关的 suspended package

不得依赖：

- “最近看起来最像”的 package
- 未记录在任务包 / suspended package 中的 AI 记忆
- 生成器或 runtime 外的隐式缓存状态

### 2. v1 路由结果集合

任务 `005` 建议把 ownership-aware routing 收敛为以下闭集：

- `current_task_owned`
  - 问题与当前 active task 的目标、范围或本轮 diff 直接相关
- `scope_widening_candidate`
  - 问题和当前任务相关，但需要扩大 Allowed Files 或稳定边界
- `resume_paused_required`
  - 问题明确属于某个 paused package，且目标唯一、可恢复
- `resume_interrupted_required`
  - 问题明确属于某个 interrupted package，且目标唯一、可恢复
- `new_bug_task_required`
  - 问题不应由当前任务或既有 suspended package 吸收，应登记为独立 bug task
- `user_decision_required`
  - 多 owner 并存、产品 / 契约 / 优先级冲突或证据不足，必须人工决定

这些 route 是 skill 内部 routing contract，不是新的 protocol / schema 字段。

### 2.1 canonical route 与 skill-local alias

任务 `005` 必须区分两类名称：

- **canonical ownership route**：上节定义的 6 个闭集 route，作为跨 skill 一致的归属判断结果。
- **skill-local conditional_handoff alias**：某个 skill 为了表达本地动作或输入状态使用的分支名，不得扩展 canonical route 闭集。

要求：

- `Ownership assessment` / `Recommended route` 必须只使用 canonical route 闭集。
- `conditional_handoff` 可以保留本地 alias，但必须显式映射到 canonical route 或 pre-routing state。
- `product_contract_architecture`、`scope_widening`、`queued_fixable_findings`、`current_task_failure` 这类名称不得被写成新的 ownership route。
- `unknown_root_cause` 不是 ownership route；它表示证据不足以完成归属判定时的 pre-routing state，应先 handoff 到 `investigate-root-cause`，再重新产出 canonical route。

| skill-local alias | canonical route / state | handoff |
| --- | --- | --- |
| `queued_fixable_findings` | `current_task_owned` | `implement-current-step` |
| `current_task_failure` | `current_task_owned` | `investigate-root-cause` |
| `scope_widening` | `scope_widening_candidate` | `lock-scope` |
| `product_contract_architecture` | `user_decision_required` | `ask-user` |
| `unknown_root_cause` | pre-routing state | `investigate-root-cause` |
| `invalid_finding_input` | pre-routing / invalid input state | `ask-user` |

测试必须覆盖：

- 三个受影响 skill 的正文或 frontmatter 均声明 canonical route 闭集。
- 任一 skill-local alias 都有映射表，不会被当作新增 route key。
- `Recommended route` 输出模板只允许 6 个 canonical route 值。

### 3. 基本判定矩阵

| 证据 | 推荐 route | 默认 handoff |
| --- | --- | --- |
| 失败位置、目标、diff 与当前 active task 一致，且修复仍在当前范围内 | `current_task_owned` | `plan-implementation` 或 `implement-current-step` |
| 失败属于当前任务目标，但修复需要扩大 Allowed Files、触碰稳定契约或改变边界 | `scope_widening_candidate` | `lock-scope` |
| 失败与某个 paused package 的 blocker / closure / remaining acceptance 明确同源，且 package 唯一且 `ready_for_resume + recovery_only`，并且当前 live active ownership 已释放 | `resume_paused_required` | `resume-paused-task` |
| 失败与某个 paused package 的 blocker / closure / remaining acceptance 明确同源，但当前 `CURRENT_TASK.md` 仍持有另一个 active task ownership | `resume_paused_required` + active-owner guard | `ask-user`（先决定是否 pause / interrupt 当前 active task，再显式 resume） |
| 失败与某个 interrupted package 的 checkpoint / dirty attribution / recovery strategy 明确同源，且 package 唯一且 `ready_for_resume + recovery_only`，并且当前 live active ownership 已释放 | `resume_interrupted_required` | `resume-interrupted-task` |
| 失败与某个 interrupted package 的 checkpoint / dirty attribution / recovery strategy 明确同源，但当前 `CURRENT_TASK.md` 仍持有另一个 active task ownership | `resume_interrupted_required` + active-owner guard | `ask-user`（先决定是否 pause / interrupt 当前 active task，再显式 resume） |
| 失败与当前 active task 无直接 owner 关系，也无唯一 suspended owner，但足以形成独立 bug | `new_bug_task_required` | `create-current-task` |
| 多个 suspended owner 都可能成立，或产品 / 契约 / 优先级需人工拍板 | `user_decision_required` | `ask-user` |

### 4. interrupt 遗留 blocker 的默认规则

任务 `004` 已明确：

- interrupt 后旧任务遗留 bug / validation failure / dirty diff 反向阻断新 active task 时，004 只把它暴露为 blocker，不自动归属。

任务 `005` 应把这条规则补成 v1 路由：

1. 先判断 blocker 是否由当前 active task 新引入。
2. 若不是，再判断是否能唯一定位到 paused / interrupted package。
3. 若能唯一定位，先检查当前 live active ownership 是否已释放。
4. 若当前 `CURRENT_TASK.md` 仍持有另一个 active task ownership，不得直接 resume；handoff `ask-user`，由用户决定是否先 `/pause-current-task` 或 `/interrupt-current-task` 当前任务，再显式恢复目标 package。
5. 若当前 live active ownership 已安全释放，才路由到对应 resume skill。
6. 若与当前任务目标紧耦合但修复明显超出已锁范围，则路由到 `lock-scope`。
7. 若与当前任务、既有 suspended package 都无法稳定建立 owner 关系，则路由到 `create-current-task` 或 `ask-user`。

## 技能与路由建议

### 1. `investigate-root-cause`

任务 `005` 中应扩展为：

- 除“是否属于当前 CURRENT_TASK”外，还要判断是否属于某个 suspended owner
- frontmatter `reads` 建议至少扩展为：`CURRENT_TASK.md`、`TASKS/paused/**`、`TASKS/interrupted/**`
- `## Required Reads` 必须明确：当 root-cause hypothesis 命中 paused / interrupted owner 候选时，先读取匹配的 suspended package evidence，再产出 `Ownership assessment` / `Recommended route`；若没有唯一 package 可读，不得根据记忆猜测归属
- output 增加：
  - `Ownership assessment`
  - `Ownership evidence`
  - `Recommended route`
  - `Recommended handoff`
- `conditional_handoff` 建议新增：
  - `current_task_owned: plan-implementation`
  - `scope_widening_candidate: lock-scope`
  - `resume_paused_required: resume-paused-task`
  - `resume_interrupted_required: resume-interrupted-task`
  - `new_bug_task_required: create-current-task`
  - `user_decision_required: ask-user`

注意：

- 不得因为发现 paused / interrupted owner 就顺手修改 package 内容
- 不得在另一个 active task 仍占用 `CURRENT_TASK.md` 时直接 handoff 到 resume skill；必须先输出 active-owner guard 结论并 handoff `ask-user`
- 只做调查、归属、建议路由
- root cause 仍然必须有 symptom / reproduction / evidence 支撑
- 不得在未读取目标 suspended package evidence 时产出 `resume_paused_required` / `resume_interrupted_required`

### 2. `run-regression`

任务 `005` 中应扩展为：

- frontmatter `reads` 建议至少扩展为：`CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`TASKS/paused/**`、`TASKS/interrupted/**`
- `## Required Reads` 必须明确：当 fail / blocked / report-only 结果出现 suspended owner 候选时，先读取匹配的 suspended package evidence，并与当前 live task / diff review target 对照后，才能输出 owner route
- 在 fail / blocked 结果里显式输出：
  - `Ownership assessment`
  - `Ownership evidence`
  - `Recommended route`
- 在 `qa_mode=diff-aware` 时，若 failure 明显来自非当前 owner，不应默认 `failure -> investigate-root-cause` 后再把责任留在当前任务
- `conditional_handoff` 建议新增：
  - `current_task_owned: investigate-root-cause`
  - `scope_widening_candidate: lock-scope`
  - `resume_paused_required: resume-paused-task`
  - `resume_interrupted_required: resume-interrupted-task`
  - `new_bug_task_required: create-current-task`
  - `user_decision_required: ask-user`

对 `report-only` 的附加要求：

- 可以报告 route
- 不能自动执行 route
- 仍然必须停在 terminal report
- 若 route 指向 resume，必须同时报告 active-owner guard 结论；report-only 不得触发 pause / interrupt / resume
- 若未读取匹配的 suspended package evidence，只能输出 evidence gap / blocked reason，不得直接报告 resume route

### 3. `sync-review-findings`

任务 `005` 中应扩展为：

- frontmatter `reads` 建议至少扩展为：`CURRENT_TASK.md`、`TASKS/paused/**`、`TASKS/interrupted/**`
- `## Required Reads` 必须明确：当 finding 可能属于 paused / interrupted owner 时，先读取匹配的 suspended package evidence，再决定是入当前队列、resume 旧任务，还是上浮 `ask-user`
- 在把 findings 写入 `CURRENT_TASK.md` 前，先判断 finding owner
- 只有 `current_task_owned` 且在当前 Allowed Files 内的 mechanical implementation finding 才允许入队
- 如果 finding 属于唯一 suspended owner，则不写当前任务队列；只有当前 live active ownership 已释放时才 handoff 对应 resume skill，否则 handoff `ask-user`
- 如果 finding 属于 scope widening / product / contract / architecture / ambiguous owner，则沿对应 route 停止

建议新增 `conditional_handoff`：

- `queued_fixable_findings: implement-current-step`
- `scope_widening: lock-scope`
- `resume_paused_required: resume-paused-task`
- `resume_interrupted_required: resume-interrupted-task`
- `new_bug_task_required: create-current-task`
- `product_contract_architecture: ask-user`
- `unknown_root_cause: investigate-root-cause`
- `user_decision_required: ask-user`

其中：

- `queued_fixable_findings` 必须映射到 canonical route `current_task_owned`。
- `scope_widening` 必须映射到 canonical route `scope_widening_candidate`。
- `product_contract_architecture` 必须映射到 canonical route `user_decision_required`。
- `unknown_root_cause` 必须被声明为 pre-routing state，不得写入 `Recommended route`。

## 已确认决策

- 任务 `005` 只消费任务 `003/004` 已稳定的 lifecycle / resume gate / artifact path / routing contract，不重开 protocol / schema foundation。
- interrupt 后旧任务遗留问题阻断新 active task 时，必须走 ownership-aware routing；不允许默认把问题吸收为当前任务实现缺陷，也不得在当前 active task 未先暂停 / 中断或释放 ownership 时直接 resume 旧任务。
- `run-regression` 在 `qa_mode=report-only` 下仍是 terminal report，可输出 route 但不得自动执行 handoff。
- `sync-review-findings` 只允许把 `current_task_owned` 且当前范围内可修的 finding 写入当前 `CURRENT_TASK.md > 审查问题队列`。
- 任务 `005` 的 canonical route 闭集固定为 `current_task_owned`、`scope_widening_candidate`、`resume_paused_required`、`resume_interrupted_required`、`new_bug_task_required`、`user_decision_required`；skill-local alias 必须有显式映射，不能扩展闭集。
- 不新增 dedicated ownership state、不新增 inbox/backlog artifact、不修改 runtime manifest / install / health report contract。

## 待确认问题

- 无阻断项。
- 若后续实现证据表明现有 contract 无法表达 ownership routing，必须回到 `/lock-scope` 评估是否需要新任务扩展协议层。

## 传播治理记录

### change_start_set

- `templates/skills/investigate-root-cause.SKILL.md.tmpl`：引入 ownership-aware root-cause route 判定与 conditional handoff 收敛。
- `templates/skills/run-regression.SKILL.md.tmpl`：在 fail / blocked / report-only 结果中补充 ownership assessment 与 route 输出约束。
- `templates/skills/sync-review-findings.SKILL.md.tmpl`：把 finding queue 写入前置到 owner 判定，避免跨 owner 错写。
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`：补充 interrupt 遗留 blocker 的 owner-sensitive routing 入口。

### impacted_consumers

- `docs/workflow/generated/workflow-skills/{investigate-root-cause,run-regression,sync-review-findings}.SKILL.md`
- `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
- `docs/workflow/SKILL_REGISTRY.md`
- `test/gen-workflow-skills.test.ts`
- `test/gen-workflow-docs.test.ts`
- `test/gen-workflow-skills.test.ts` 中针对三个 generated skill 的 reads / required-reads 断言
- `test/gen-workflow-docs.test.ts` 中针对 guide ownership-aware routing 文案的断言
- 三个受影响 skill 的 frontmatter `reads` 与正文 `Required Reads`

### compatibility_strategy

- `backward-compatible`：仅扩展 skill routing 语义与 guide 说明，不改 protocol/schema/runtime contract。

## 验收标准

- `templates/skills/investigate-root-cause.SKILL.md.tmpl` 已能把 blocker / failure 区分为当前任务、widening、paused owner、interrupted owner、独立 bug 或需人工决定。
- `templates/skills/run-regression.SKILL.md.tmpl` 已能在 fail / blocked / report-only 报告中输出 ownership-aware routing，且 report-only 仍为 terminal report。
- `templates/skills/sync-review-findings.SKILL.md.tmpl` 不会把 paused / interrupted / 独立 bug owner 的 finding 错写进当前 `CURRENT_TASK.md > 审查问题队列`。
- 三个受影响 skill 的 frontmatter `reads` 已显式覆盖 `TASKS/paused/**` 与 `TASKS/interrupted/**`，不会只依赖 `CURRENT_TASK.md` 或运行时记忆做 owner 判定。
- 三个受影响 skill 的正文 `Required Reads` 已明确：命中 paused / interrupted owner 候选时，必须先读取匹配的 suspended package evidence，才能输出 `Ownership assessment` / `Recommended route` 或决定 finding queue 去向。
- `test/gen-workflow-skills.test.ts` 已对三个 generated skill 逐项断言：frontmatter `reads` 包含 `TASKS/paused/**` 与 `TASKS/interrupted/**`，且正文 `Required Reads` 包含“先读取 matching suspended package evidence，再产出 route / queue decision”的规则。
- `test/gen-workflow-skills.test.ts` 已对 fail-closed 行为做文本断言：当 suspended package evidence 未读取、缺失或无法唯一解析时，生成文本只能导向 `blocked` / `ask-user` / `evidence gap`，不得直接导向 `resume_paused_required` / `resume_interrupted_required`。
- 三个受影响 skill 的 canonical ownership route 与 skill-local conditional handoff alias 映射稳定，`Recommended route` 不使用闭集外 route key。
- guide 已明确说明“旧任务遗留问题阻断新 active task”时，应根据 owner route 与 active-owner guard 进入 `resume-*`、`lock-scope`、`create-current-task` 或 `ask-user`；当前 live task 仍 active 时必须先让用户决定是否 pause / interrupt 当前任务。
- 不新增新的 lifecycle state、resume reason、artifact kind、artifact path、protocol-level named error。
- 不引入 inbox / backlog artifact。
- 不修改 runtime manifest / install / health report contract。
- generated outputs 只由生成器同步。
- 回归通过：
  - `bun run gen:all`
  - `bun run test:workflow-skills`
  - `bun run test:registry`
  - `bun run test:workflow-docs`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
  - `bun run workflow:health --root .`

测试应额外覆盖：

- `test/gen-workflow-skills.test.ts` 对 generated `investigate-root-cause` / `run-regression` / `sync-review-findings` 的 frontmatter `reads` 逐项断言包含 `TASKS/paused/**` 与 `TASKS/interrupted/**`
- `test/gen-workflow-skills.test.ts` 对三个 generated skill 的正文 `Required Reads` 逐项断言：paused / interrupted owner 候选必须先读取 matching suspended package evidence
- `test/gen-workflow-skills.test.ts` 对 fail-closed 文本逐项断言：若 suspended package evidence 未读取、缺失或无法唯一解析，生成文本只能输出 blocked / ask-user / evidence gap，不得直接生成 resume route
- `test/gen-workflow-docs.test.ts` 断言 guide 在 ownership-aware routing 场景下保留 active-owner guard，并把 suspended owner 路由到 `resume-*` / `ask-user` / `create-current-task` / `lock-scope`

## 允许修改范围

Allowed Files:

- `templates/skills/investigate-root-cause.SKILL.md.tmpl`
- `templates/skills/run-regression.SKILL.md.tmpl`
- `templates/skills/sync-review-findings.SKILL.md.tmpl`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `test/gen-workflow-skills.test.ts`
- `test/gen-workflow-docs.test.ts`
- `docs/workflow/CURRENT_TASK.md`

Conditional Files:

- `docs/workflow/generated/workflow-skills/investigate-root-cause.SKILL.md`
  - condition：仅当 `templates/skills/investigate-root-cause.SKILL.md.tmpl` 发生 ownership-aware routing 相关变更时允许同步。
  - required evidence：diff 只反映 route / handoff / output contract 的本任务改动；不得混入无关模板改动。
  - validation：`bun run test:workflow-skills`、`bun run validate:freshness`
- `docs/workflow/generated/workflow-skills/run-regression.SKILL.md`
  - condition：仅当 `templates/skills/run-regression.SKILL.md.tmpl` 发生 ownership-aware routing 相关变更时允许同步。
  - required evidence：diff 只反映 fail / blocked / report-only routing 语义变化；不得破坏 report-only terminal report 规则。
  - validation：`bun run test:workflow-skills`、`bun run validate:freshness`
- `docs/workflow/generated/workflow-skills/sync-review-findings.SKILL.md`
  - condition：仅当 `templates/skills/sync-review-findings.SKILL.md.tmpl` 发生 owner-sensitive queue routing 变更时允许同步。
  - required evidence：diff 只反映 finding owner 判定与 queue/handoff 规则变化，不得扩大为实现逻辑改造。
  - validation：`bun run test:workflow-skills`、`bun run validate:freshness`
- `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - condition：仅当 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 增加 ownership-aware routing 入口说明时允许同步。
  - required evidence：diff 只反映 route 指引更新，不新增全局 stage 或编排入口。
  - validation：`bun run test:workflow-docs`、`bun run validate:freshness`
- `docs/workflow/SKILL_REGISTRY.md`
  - condition：仅当前述 skill 模板变更导致 registry 元数据变化时允许同步。
  - required evidence：diff 只反映对应 skill 的注册信息变化，不引入范围外 skill 调整。
  - validation：`bun run test:registry`、`bun run validate:freshness`
- `docs/workflow/STATUS.md`
  - condition：仅当任务 `005` 稳定完成后由 `/sync-status` 回写状态事实时允许同步。
  - required evidence：仅记录任务 `005` 的稳定事实、验证证据与下一检查点，不引入范围外项目状态变更。
  - validation：`bun run validate:protocol`
- `docs/workflow/CONTRACTS.md`
  - condition：仅当任务 `005` 形成新的稳定 routing contract 且由 `/sync-contracts` 固化时允许同步。
  - required evidence：仅记录 ownership-aware routing 的稳定边界，不重写 003/004 的 foundation/runtime contract。
  - validation：`bun run validate:protocol`
- `docs/workflow/DECISIONS.md`
  - condition：仅当任务 `005` 产生长期保留决策并由 `/sync-decisions` 写入时允许同步。
  - required evidence：仅记录 route 选择与拒绝项，不写实现过程流水。
  - validation：`bun run validate:protocol`
- `docs/workflow/LESSONS.md`
  - condition：仅当任务 `005` 形成跨任务可复用经验并由 `/capture-lessons` 写入时允许同步。
  - required evidence：只记录可复用 lesson，不记录一次性执行细节。
  - validation：`bun run validate:protocol`

## 禁止修改范围

Forbidden Files:

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `scripts/workflow-runtime.ts`
- `scripts/task-identity.ts`
- `scripts/workflow-doc-contracts.ts`
- `scripts/run-validation.ts`
- `templates/skills/pause-current-task.SKILL.md.tmpl`
- `templates/skills/interrupt-current-task.SKILL.md.tmpl`
- `templates/skills/resume-paused-task.SKILL.md.tmpl`
- `templates/skills/resume-interrupted-task.SKILL.md.tmpl`
- `templates/docs/DOCUMENT_CATALOG.md.tmpl`
- `docs/workflow/DOCUMENT_CATALOG.md`

## 主要风险与回滚

- 风险 1：把 paused / interrupted owner 的问题错误吸收到当前 active task，导致 task scope drift 被掩盖。
- 风险 2：把 ownership-aware routing 做成“自动修复授权”，绕过 `lock-scope`、`create-current-task` 或人工确认。
- 风险 3：`report-only` 被意外改成可继续 handoff，破坏 `review-current-diff` 的 terminal report 约束。
- 风险 4：`sync-review-findings` 把非当前任务 owner 的 finding 写进当前任务队列，导致后续错误修复。
- 风险 5：direct resume 覆盖仍持有 active ownership 的 `CURRENT_TASK.md`，导致当前任务丢失或 active owner 被隐式替换。
- 风险 6：为了表达 routing，引入新的 schema / artifact / protocol 字段，重新打开 `003` 与 `004` 已锁定边界。

回滚原则：

- 若实现中发现必须修改 protocol / schema / runtime contract，立即停止并拆新任务，不在 `005` 中 widening。
- 若只改到模板 / guide / tests，可回退到任务开始基线，仅撤销本任务 diff。

## 回滚点

本草案 materialize 成正式 `docs/workflow/CURRENT_TASK.md` 前，必须补齐以下三字段；缺失时不得进入 `/implement-current-step`：

- Task start base：`unknown`
- Last reviewed checkpoint：`not-yet-created`
- Current diff review target：`to-be-established`

要求：

- `/review-current-task` 必须复核这三字段是否足以支撑 ownership-aware routing 审查。
- 若任务执行过程中创建 checkpoint commit，`Current diff review target` 不得继续停留在 `working-tree`。
- ownership 判断必须基于可审计 diff target，而不是基于模糊“最近改过什么”的记忆。

## 当前草案结论

任务 005 应定义为：

```text
在 003 已稳定 lifecycle contract、004 已落地 lifecycle runtime skills 之后，
为 investigate-root-cause、run-regression、sync-review-findings
补齐 ownership-aware blocker / root-cause / finding routing，
让 interrupt 后旧任务遗留问题可以被稳定路由到当前任务、guarded resume、widening 或独立 bug。
```

它不是：

```text
重做 protocol / schema
+ 新增 inbox / backlog artifact
+ 改写 pause / resume / interrupt transaction
+ 变更 runtime manifest / install / health report
+ 自动挑选 suspended package 或自动吸收所有 blocker
```
