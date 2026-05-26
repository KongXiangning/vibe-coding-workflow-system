# NEXT_TASK_DRAFT_004_LIFECYCLE_RUNTIME_SKILLS.md

## 草案状态

- 用途：任务 004 候选任务包，供后续 `/create-current-task` 或 `/review-current-task` 复审。
- 当前状态：draft_for_review
- 不接管当前 `CURRENT_TASK.md`。
- 不代表任务 004 已开始实施。
- 本稿以前置任务 003 的 contract foundation 为前提，只继续推进 **lifecycle runtime skills + resume review handoff**，不重开协议基础范围。

## 任务信息

- 任务 ID：004
- 任务标题：实现 CURRENT_TASK lifecycle runtime skills 与 resume review handoff（第二阶段）
- 任务 slug：current-task-lifecycle-runtime-skills
- 建议初始 handoff：`create-current-task`

## 任务目标

在任务 003 已稳定 lifecycle contract foundation 的前提下，为 workflow-system 正式补齐以下 runtime skill 面：

- `pause-current-task`
- `resume-paused-task`
- `interrupt-current-task`
- `resume-interrupted-task`

同时把 resume review gate 正式接入 runtime handoff：

- 恢复 skill 只负责把合法 suspended package 重新写回 live `CURRENT_TASK.md`
- 恢复成功后**不得直接进入实现**
- 恢复后的下一跳固定回到 `review-current-task`
- `review-current-task` 必须把 `恢复需审查` / `恢复审查原因` 当作强制审查输入消费

## 范围收窄结论

根据任务 003 的 defer 结论，任务 004 只处理以下范围：

1. 新增 4 个 lifecycle runtime skill 模板。
2. 扩展 `review-current-task`，使其能消费 resume review gate。
3. 更新 `WORKFLOW_GUIDE`、`SKILL_REGISTRY`、registry order / high-risk audit list 和对应生成测试。
4. 保证 generated outputs 只由生成器同步，不手工编辑。

以下内容继续保持 deferred，不并入任务 004：

- `external-root-cause-intake`
- `investigate-root-cause` / `run-regression` / `sync-review-findings` 的 ownership-aware routing
- `capture-work-item` / inbox artifact / backlog artifact
- 新的 lifecycle state、resume reason、artifact kind、artifact path 或 schema 字段
- runtime manifest / install / health report contract 变更
- `DOCUMENT_CATALOG` 扩面

## P0 前置原则

### 1. 先消费 003 契约，不重写 003 契约

任务 004 只消费以下已稳定 contract：

- `CURRENT_TASK.md > ## 任务信息` 中的 `当前状态`、`生命周期状态`、`恢复需审查`、`恢复审查原因`
- `TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `resume_review_reasons` 闭合集合
- `rehydration_status` / `ownership_state` 闭合集合

因此本任务默认：

- 不新增 lifecycle state
- 不新增 resume reason
- 不新增 artifact path
- 不新增 protocol-level named error

若实现证据证明现有协议 / schema 无法支撑 runtime consumer，必须停止并回到 `/lock-scope`，而不是在任务 004 中顺手扩面。

### 2. 恢复后的首个消费者固定为 `review-current-task`

任务 004 明确拒绝新增专用 `resume-review-*` skill。  
恢复 skill 的职责只到：

- 选定 suspended package
- 校验其满足恢复前置条件
- 重写 live `CURRENT_TASK.md`
- 回写来源 package 的 rehydrated marker

恢复成功后的首个消费者固定为：

- `review-current-task`

理由：

- 复用现有“进入可执行任务包前先审查”的稳定链路
- 避免再新增一层 review skill 和 guide / registry 复杂度
- 保持 resumed task 与 newly created task 在进入实现前都先经过 task review

### 3. resume review gate 是审查输入，不是一次性脏字段

任务 004 默认：

- 恢复 skill 不得把 `恢复需审查` 写回为 `false`
- `review-current-task` 必须消费 `恢复需审查` / `恢复审查原因`
- `review-current-task` 不得为了“收口好看”静默清空 resume gate 字段

即：

- gate 是恢复来源和审计信号
- review 结论写入既有任务包章节和执行记录
- 不通过新增 `CURRENT_TASK.md` 标准章节来承载 runtime review 结果

### 4. lifecycle skills 归入“状态同步”面，不新增全局 stage

任务 004 不新增新的 registry stage section。  
4 个 lifecycle runtime skills 统一归入：

- `阶段 7：状态同步`

原因：

- 它们的核心职责是同步 / 切换 task artifact 与 live task 状态
- 不属于新需求创建，也不属于业务实现
- 避免为了 stage 编排重排整个 registry section 编号

`scripts/gen-registry.ts` 可以为 `阶段 7：状态同步` 自定义 branch-style summary，但不新增新的全局 stage heading。

### 5. resume 输入必须显式，不做模糊自动挑选

任务 004 默认：

- `resume-paused-task` / `resume-interrupted-task` 必须接收明确的 suspended package 目标
- 可以是明确路径，或能无歧义解析到唯一路径的 `TASK_ID + TASK_SLUG + artifact kind`
- 不允许“自动挑最新一个 paused package”这类模糊策略

理由：

- 避免多 package 并存时误恢复
- 避免把 artifact discovery 逻辑偷偷扩大成 inbox / backlog / routing 任务

## 技能与路由建议

### 1. `pause-current-task`

职责：

- 把 active task 变成 `paused_pending_closure` 或 `paused_blocked`
- 写出对应 `TASKS/paused/**` package
- 把 live `CURRENT_TASK.md` 改写为合法 suspended tuple

最小要求：

- 只允许在 live task 持有 active ownership 时执行
- `paused_pending_closure` 必须至少携带一个 closure-oriented reason
- `paused_blocked` 必须携带 `blocker_recheck_required`
- `paused_blocked` 必须要求 `blocker_status`、`blocking_evidence`、`remaining_acceptance`
- 仅当 blocker 来自 validation failure 时才要求 `failed_checks`

推荐 handoff：

- `handoff.failure = ask-user`
- `conditional_handoff.pause_only = ask-user`
- `conditional_handoff.pause_and_switch = create-current-task`

### 2. `interrupt-current-task`

职责：

- 把 active task 变成 `interrupted`
- 写出对应 `TASKS/interrupted/**` package
- 记录 checkpoint / dirty attribution / environment / recovery strategy
- 释放 live active ownership

最小要求：

- 只允许在 live task 持有 active ownership 时执行
- 必须显式记录：
  - `checkpoint_evidence`
  - `dirty_attribution`
  - `environment_state`
  - `recovery_strategy`
- `resume_review_reasons` 必须满足 interrupted 场景映射

推荐 handoff：

- `handoff.success = create-current-task`
- `handoff.failure = ask-user`
- 可选 `conditional_handoff.interrupt_only = ask-user`

### 3. `resume-paused-task`

职责：

- 从合法 `artifact_kind = paused` 的 package 恢复 live task
- 重写 `CURRENT_TASK.md` 为：
  - `当前状态：active`
  - `生命周期状态：active`
  - `恢复需审查：true`
  - `恢复审查原因：<规范化 reasons>`
- 把来源 package 标记为 `rehydrated`

最小要求：

- 只接受 `rehydration_status = ready_for_resume`
- 只接受 `ownership_state = recovery_only`
- `resume_review_reasons` 必须为非空闭合集合
- `CURRENT_TASK.md` 写回结果必须与来源 package gate 语义一致
- 发现 gate drift、marker drift、active owner conflict 或 target package 不自洽时必须 `fail-closed`

固定 handoff：

- `handoff.success = review-current-task`
- `handoff.failure = ask-user`

### 4. `resume-interrupted-task`

职责：

- 从合法 `artifact_kind = interrupted` 的 package 恢复 live task
- 复用 `resume-paused-task` 的写回与 gate 对齐规则
- 保持 interrupted evidence 可追溯

最小要求：

- 只接受 `artifact_kind = interrupted`
- interrupted package 必须完整保留 checkpoint / dirty attribution / environment / recovery strategy
- 写回前必须确认当前 live `CURRENT_TASK.md` 不再是同一 `TASK_ID` 的 active owner

固定 handoff：

- `handoff.success = review-current-task`
- `handoff.failure = ask-user`

### 5. `review-current-task` 扩展消费 resume gate

任务 004 必须扩展 `review-current-task`，使其在 resumed task 上额外检查：

- `恢复需审查` / `恢复审查原因` 是否存在且自洽
- Task start base、Last reviewed checkpoint、Current diff review target 是否能支撑恢复后 review
- `base_drift` / `checkpoint_drift` / `diff_review_target_changed` / `environment_recovery_pending` 等 reason 是否已被显式处理
- blocker、remaining acceptance、manual review、validation pending 是否已在任务包中重新落位

明确不做：

- 不新增新的 `CURRENT_TASK.md` 标准章节
- 不新增专用 resume review skill
- 不在 `review-current-task` 中静默清空 resume gate

## 本任务必须覆盖的代码面

### Skill templates

- `templates/skills/pause-current-task.SKILL.md.tmpl`
- `templates/skills/resume-paused-task.SKILL.md.tmpl`
- `templates/skills/interrupt-current-task.SKILL.md.tmpl`
- `templates/skills/resume-interrupted-task.SKILL.md.tmpl`
- `templates/skills/review-current-task.SKILL.md.tmpl`

### Guide / registry

- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `scripts/gen-registry.ts`

### Registry order / summary

`scripts/gen-registry.ts` 在任务 004 中至少应明确：

- `HIGH_RISK_SKILLS` 新增：
  - `pause-current-task`
  - `resume-paused-task`
  - `interrupt-current-task`
  - `resume-interrupted-task`
- `WORKFLOW_ORDER` 在 `阶段 7：状态同步` 中显式插入：
  - `pause-current-task`
  - `interrupt-current-task`
  - `resume-paused-task`
  - `resume-interrupted-task`
  - `sync-current-task`

推荐顺序：

```text
... -> run-regression
-> pause-current-task
-> interrupt-current-task
-> resume-paused-task
-> resume-interrupted-task
-> sync-current-task
-> sync-status -> ...
```

但 `阶段 7：状态同步` 的 summary 不应渲染成单一路径直线链；应改为 branch-style summary，至少能表达：

```text
lifecycle branch: pause-current-task / interrupt-current-task / resume-paused-task / resume-interrupted-task
steady-state branch: sync-current-task -> sync-status -> sync-contracts -> sync-decisions -> sync-host-guidance
```

### Tests

- `test/gen-workflow-skills.test.ts`
- `test/gen-registry.test.ts`
- `test/gen-workflow-docs.test.ts`

### 关键测试断言建议

- `test/gen-workflow-skills.test.ts`
  - 4 个新增 template 都能生成对应 `.SKILL.md`
  - 4 个 lifecycle skill 的 `stage` 都是 `阶段 7：状态同步`
  - `resume-paused-task` / `resume-interrupted-task` 的 `handoff.success` 固定为 `review-current-task`
  - `pause-current-task` 至少声明 `conditional_handoff.pause_only` 与 `conditional_handoff.pause_and_switch`
  - `interrupt-current-task` 的 `handoff.success` 为 `create-current-task`
  - `review-current-task` 新增对 `恢复需审查` / `恢复审查原因` / rollback point 三字段的审查要求
- `test/gen-registry.test.ts`
  - registry 中能找到 4 个 lifecycle skill
  - 4 个 skill 都位于 `阶段 7：状态同步`
  - 4 个 skill 在 `sync-current-task` 前具有稳定顺序
  - `阶段 7：状态同步` summary 使用 branch-style 文案，而不是默认直线链
  - high-risk audit list 已包含 4 个 lifecycle skill
- `test/gen-workflow-docs.test.ts`
  - generated `WORKFLOW_GUIDE.md` 明确写出 pause / interrupt / resume 的使用入口
  - generated `WORKFLOW_GUIDE.md` 明确写出“resume 成功后回到 `review-current-task`，不得直接进入实现”
  - generated `WORKFLOW_GUIDE.md` 不新增新的全局 stage heading

## 修改范围修订

### Allowed Files

- `templates/skills/pause-current-task.SKILL.md.tmpl`
- `templates/skills/resume-paused-task.SKILL.md.tmpl`
- `templates/skills/interrupt-current-task.SKILL.md.tmpl`
- `templates/skills/resume-interrupted-task.SKILL.md.tmpl`
- `templates/skills/review-current-task.SKILL.md.tmpl`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `scripts/gen-registry.ts`
- `test/gen-workflow-skills.test.ts`
- `test/gen-registry.test.ts`
- `test/gen-workflow-docs.test.ts`
- `docs/workflow/CURRENT_TASK.md`

### Conditional Files

- `docs/workflow/generated/workflow-skills/pause-current-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/resume-paused-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/interrupt-current-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/resume-interrupted-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/review-current-task.SKILL.md`
  - condition：仅当对应 skill template 经 `bun run gen:workflow-skills` 或 `bun run gen:all` 成功生成时允许同步。
  - required evidence：diff 只来自新增 4 个 lifecycle skill 与 `review-current-task` 的 template 变更；不得手工编辑。
  - validation：`bun run test:workflow-skills`、`bun run validate:freshness` 通过。
- `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - condition：仅当 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 为纳入 004 范围的 lifecycle routing 更新而变化时允许同步。
  - required evidence：diff 只反映 lifecycle skill 入口、resume handoff 规则和 stage 7 branch summary 的对应 render。
  - validation：`bun run test:workflow-docs`、`bun run validate:freshness` 通过。
- `docs/workflow/SKILL_REGISTRY.md`
  - condition：仅当 `scripts/gen-registry.ts` 与新增 skill templates 导致 registry order / stage / high-risk list 更新时允许同步。
  - required evidence：diff 只反映 004 范围内 skill 的注册、stage、handoff、顺序与高风险审计列表变化。
  - validation：`bun run test:registry`、`bun run validate:freshness` 通过。

### Safety mode

- `frozen-scope`
- 选择理由：任务 004 只应落在 skill template、guide、registry 和生成测试面；风险主要来自 handoff 漂移、generated churn 与 resume gate 语义误消费，不应顺手扩到 protocol/schema/runtime。

### Dangerous surfaces

- `task-state mutation semantics`：pause / interrupt / resume 只能消费既有 contract，不能在 skill 文本里偷偷改写状态机。
- `generated artifact discipline`：generated skills、generated guide、registry 只能由生成器同步。
- `registry order / stage drift`：新增 skill 必须显式进入 `WORKFLOW_ORDER` 和 high-risk audit list，不能依赖字母排序碰运气。

### Unlock / widening conditions

- 默认不允许扩大范围；未列入 Allowed Files 的文件一律禁止修改。
- 如果实现证据证明现有 003 contract 无法被 runtime skills 明确消费，必须回到 `/lock-scope`，而不是直接改协议或 runtime。
- 预先识别但当前仍禁止的 widening 候选：
  - `.workflow-system/WORKFLOW_PROTOCOL.md`
  - `.workflow-system/FILE_SCHEMAS.md`
  - `scripts/workflow-runtime.ts`
  - `test/workflow-runtime.test.ts`
  - `scripts/task-identity.ts`
  - `scripts/workflow-doc-contracts.ts`
  - `scripts/run-validation.ts`
  - `docs/workflow/DOCUMENT_CATALOG.md`
  - `templates/docs/DOCUMENT_CATALOG.md.tmpl`

## 禁止修改范围

### Forbidden Files

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `scripts/workflow-runtime.ts`
- `test/workflow-runtime.test.ts`
- `scripts/task-identity.ts`
- `scripts/workflow-doc-contracts.ts`
- `scripts/run-validation.ts`
- `templates/docs/DOCUMENT_CATALOG.md.tmpl`
- `docs/workflow/DOCUMENT_CATALOG.md`
- `vibe-coding/**`
- `dist/**`
- `.git/**`
- `node_modules/**`

## 建议验收标准

- 已新增 `pause-current-task`、`resume-paused-task`、`interrupt-current-task`、`resume-interrupted-task` 四个 workflow skill template。
- 四个 lifecycle skill 的 generated reference outputs 已由生成器同步，且不包含手工编辑痕迹。
- `pause-current-task` 能区分 `paused_pending_closure` 与 `paused_blocked`，并明确要求对应的 `resume_review_reasons` / blocker evidence。
- `interrupt-current-task` 明确要求 checkpoint evidence、dirty attribution、environment state、recovery strategy，不允许无证据中断。
- `resume-paused-task` 与 `resume-interrupted-task` 只接受显式、无歧义、`ready_for_resume` 的 suspended package 输入；模糊自动挑选方案不被接受。
- 两个 resume skill 在恢复成功后必须把 `CURRENT_TASK.md` 写成 `active + active + 恢复需审查=true + 规范化 reasons`，并把来源 package 更新为 `rehydrated`。
- resume skill 的成功 handoff 固定为 `review-current-task`，不得直接 handoff 到 `implement-current-step`。
- `review-current-task` 已扩展为 resume gate consumer：能审查 drift / checkpoint / diff target / blocker / remaining acceptance / validation pending 等恢复前提，但不静默清空 gate 字段。
- `WORKFLOW_GUIDE` 与 `SKILL_REGISTRY` 已收录四个 lifecycle skill，并对 stage / order / handoff / branch summary 给出稳定说明。
- `scripts/gen-registry.ts` 已把四个 lifecycle skill 加入显式顺序控制与 high-risk audit list。
- 不新增 lifecycle state、resume reason、artifact kind、artifact path、protocol-level named error。
- 不实现 ownership-aware root cause routing、不实现 inbox / backlog artifact、不改 runtime manifest / install / health report contract。
- 回归通过：
  - `bun run gen:all`
  - `bun run test:workflow-skills`
  - `bun run test:registry`
  - `bun run test:workflow-docs`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
  - `bun run workflow:health --root .`

## 建议实施顺序

1. 先新增 4 个 lifecycle skill template，锁定各自 trigger / reads / writes / handoff / conditional_handoff。
2. 再扩展 `review-current-task`，让 resumed task 的 review gate 能被稳定消费。
3. 再更新 `WORKFLOW_GUIDE.md.tmpl`，明确何时 pause、interrupt、resume，以及 resume 后必须回到 review-current-task。
4. 再更新 `scripts/gen-registry.ts`，补齐显式顺序、stage 7 summary 和 high-risk audit list。
5. 最后补 `test/gen-workflow-skills.test.ts`、`test/gen-registry.test.ts`、`test/gen-workflow-docs.test.ts`，并运行生成 / 回归。

## 已确认决策

- **任务 004 不重开 003 的 protocol / schema foundation**
  - runtime skill 只消费既有 lifecycle state、resume gate、artifact path、ownership marker 和 fail-closed contract。
- **resume 后统一回到 `review-current-task`**
  - 不新增 dedicated resume review skill。
  - 不允许 resume 后直接进入实现。
- **resume gate 保留为可审计信号**
  - 恢复 skill 不负责清 gate。
  - `review-current-task` 负责消费 gate，而不是抹掉 gate。
- **resume 输入必须显式**
  - 不做“自动挑最近 package”之类模糊恢复。
- **lifecycle runtime skills 统一归入阶段 7**
  - 通过 registry branch summary 表达其与常规 sync 链的关系，不新增新的全局 stage。

## 待确认问题

- 暂无必须阻断草案成立的未决项。
- 若后续实现证据表明 `review-current-task` 不能充分消费 resume gate，再单独评估是否需要新增专用 resume review skill；默认不在任务 004 中提前引入。

## 当前草案结论

任务 004 应定义为：

```text
在 003 已稳定的 lifecycle contract foundation 之上，
新增 pause / resume / interrupt runtime skills，
并把 resume review gate 正式接回 review-current-task。
```

它不是：

```text
重做 protocol / schema
+ 改 ownership-aware root-cause routing
+ 引入 inbox / backlog artifact
+ 变更 runtime manifest / install / health report
```
