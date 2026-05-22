# NEXT_TASK_DRAFT_003_CURRENT_TASK_LIFECYCLE.md

## 草案状态

- 用途：任务 003 候选任务包，供后续 `/create-current-task` 或 `/review-current-task` 复审。
- 当前状态：draft_for_review
- 不接管当前 `CURRENT_TASK.md`。
- 不代表任务 003 已开始实施。
- 本稿已按 P0 / P1 审核意见修订：先定义生命周期状态机和持久化身份契约，再实现 lifecycle skills。

## 任务信息

- 任务 ID：003
- 任务标题：补齐 CURRENT_TASK 生命周期状态机与异常流转治理
- 任务 slug：current-task-lifecycle-transitions
- 建议初始 handoff：`create-current-task`

## 任务目标

建立 `CURRENT_TASK lifecycle transition protocol`，把真实开发中 `CURRENT_TASK.md` 的暂停、中断、恢复、范围内修订、替代、外部 blocker、旁路发现等场景制度化。

本任务不是单纯新增几个 skill。第一目标是补齐协议级事实：

- 定义正式任务生命周期状态机。
- 对齐现有 task identity / archive contract。
- 定义 paused / interrupted / inbox 的持久化模型。
- 再基于协议更新 workflow skill、模板、`WORKFLOW_GUIDE`、方法论文档、测试和 generated outputs。

## P0 前置原则

### 1. 先定义状态机，再实现 skill

不能先让各 skill 自行定义生命周期规则。状态机必须先进入规范源：

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`

模板只能承载已在规范源登记的结构，不能偷偷扩展新状态、新字段或新目录语义。

### 2. 生命周期状态集合

建议第一版定义以下状态：

- `active`
  - 当前唯一活跃任务，身份来源为 `CURRENT_TASK.md`。
- `paused_pending_closure`
  - 实现基本完成，但测试、人工复核、小尾巴未收口。
- `paused_blocked`
  - 当前任务本身没错，但被外部 blocker 卡住。
- `interrupted`
  - 被更高优先级任务插队，中断前必须有 checkpoint evidence。
- `active_review_required`
  - 从 paused / interrupted 恢复后，发现 base drift、checkpoint drift、diff target 过期或假设变化，不能直接继续实现，必须先 review / lock / plan。
- `superseded`
  - 原任务包失效，被后继任务替代。
- `archived`
  - 完成后的终态归档。
- `backlog_item`
  - 与当前任务无关的新需求、新灵感、新 bug、技术债，只记录，不改变 `CURRENT_TASK.md`。

### 3. 合法迁移矩阵

第一版允许：

```text
active -> paused_pending_closure
active -> paused_blocked
paused_pending_closure -> active
paused_blocked -> active
paused_pending_closure -> active_review_required
paused_blocked -> active_review_required
active -> interrupted
interrupted -> active
interrupted -> active_review_required
active -> superseded
paused_pending_closure -> superseded
paused_blocked -> superseded
active -> archived
capture -> backlog_item
```

默认禁止：

```text
paused_* -> archived
interrupted -> archived
backlog_item -> active
superseded -> active
archived -> active
```

如果 backlog / inbox 项要变成 active task，必须通过 `create-current-task` 或明确恢复流程生成正式 `CURRENT_TASK.md`，不能直接把 backlog item 当任务包执行。

### 4. TASK_ID 与归档规则

必须对齐现有 contract：

- `CURRENT_TASK.md` 是 active task identity 来源。
- `TASK_ID` / `TASK_SLUG` 一旦 materialized，不可变。
- 最终完成归档路径仍为 `TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md`。

新增规则建议：

- pause / interrupt / resume 不改变 `TASK_ID`。
- supersede 默认创建新的 `TASK_ID`，并在 predecessor / successor 中记录关系。
- paused / interrupted 文件是 suspended task package，不是最终 archive。
- archived 与 paused / interrupted 不应为同一 `TASK_ID` 同时存在；archive 是终态。
- 恢复时采用 rehydrate：从 suspended package 生成新的 `CURRENT_TASK.md`，但必须保留恢复来源和迁移记录。

### 5. 持久化模型

建议默认采用：

- `docs/workflow/CURRENT_TASK.md`
  - 只保留唯一 active task。
- `TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
  - 保存 paused task package。
- `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`
  - 保存 interrupted task package。
- `TASKS/inbox/ITEM-<date>-<slug>.md`
  - 保存旁路发现。

暂不默认新增 `docs/workflow/BACKLOG.md`，因为它会触碰 `WORKFLOW_DOC_NAMES`、文档目录 contract、生成校验和 catalog。`BACKLOG.md` 可作为替代方案，但必须在 `review-current-task` / `lock-scope` 中明确选择并扩大范围。

恢复策略：

- `resume-paused-task` / `resume-interrupted-task` 读取 suspended package。
- 恢复后写入新的 `CURRENT_TASK.md`。
- 原 suspended 文件必须保留恢复记录或标记为 resolved / rehydrated；具体字段由 `FILE_SCHEMAS` 定义。
- 恢复后不得直接进入 `implement-current-step`，至少进入 `review-current-task`。

## 能力集合

### pause-current-task

负责：

```text
active -> paused_pending_closure
active -> paused_blocked
```

必须记录：

- pause reason
- pause state
- resume step
- remaining acceptance
- failed checks
- blocker status
- Task start base
- Last reviewed checkpoint
- Current diff review target
- environment state, if relevant

### resume-paused-task

只处理 `TASKS/paused/**`。

必须检查：

- task start base
- last checkpoint
- diff review target
- base drift
- checkpoint drift
- failed checks
- remaining acceptance
- blocker resolution status

如果发现 drift：

```text
paused_* -> active_review_required
handoff: review-current-task
```

如果无 drift：

```text
paused_* -> active
handoff: review-current-task
```

仍不得直接进入 `implement-current-step`。

### interrupt-current-task

负责：

```text
active -> interrupted
```

不能默认自动 commit。必须建立 checkpoint evidence，允许形式包括：

- checkpoint commit
- staged patch
- branch
- worktree
- manual diff attribution

如果无法安全 checkpoint，必须停止并上浮，不得继续切换任务。

数据库 / 外部环境必须选择 recovery strategy：

- `rollback`
- `forward-safe recovery`
- `isolate new worktree / new database`
- `blocked until manual recovery`

没有 evidence 时，不得把环境状态标记为 clean。

### resume-interrupted-task

只处理 `TASKS/interrupted/**`。

必须读取：

- checkpoint commit or patch
- branch / worktree
- dirty attribution
- database / environment state
- merge / rebase plan
- current base drift

恢复后：

```text
interrupted -> active_review_required
handoff: review-current-task
```

不直接实现。

### amend-current-task-scope

只允许目标不变的小范围扩展。

硬 stop condition：

- 改变任务目标：走 `supersede-current-task`。
- 触碰 `Forbidden Files`：回 `lock-scope` 或 `supersede-current-task`。
- 改变公共契约 / schema / 架构边界：先 `plan-implementation` / `review-current-task`，不能直接 amend。

成功后至少回到：

```text
review-current-task -> lock-scope
```

### supersede-current-task / supersede-paused-task

- `supersede-current-task` 处理 active task。
- `supersede-paused-task` 处理 suspended paused task，避免让 `supersede-current-task` 跨 source 猜测。

默认规则：

- supersede 创建新 `TASK_ID`。
- 旧任务记录 predecessor status = `superseded`。
- 新任务记录 predecessor / successor relation。
- 旧 partial diff 必须分类：`keep` / `quarantine` / `revert` / `extract`。

### external-root-cause-intake

只做 ownership 分流，不调查 root cause。

ownership matrix：

- `current`
- `paused`
- `interrupted`
- `external`
- `unknown`

行为：

- `current` -> `investigate-root-cause`
- `paused` / `interrupted` / `external` / `unknown` -> 记录当前 blocker，必要时 pause 当前任务，创建 root-cause task 草案

### capture-work-item

处理旁路发现：

- 新需求
- 新灵感
- 新 bug
- 技术债

写入：

- `TASKS/inbox/**`

不修改 `CURRENT_TASK.md`，不进入实现。

## 既有规则调整

### investigate-root-cause

不是从零收紧，而是 ownership-aware 增量收紧。

现有 current-task-only 语义保留，新增 ownership matrix：

- 只有 `ownership=current` 时，`investigate-root-cause` 才调查并写入当前 `CURRENT_TASK.md`。
- `ownership=paused/interrupted/external/unknown` 时，先走 `external-root-cause-intake`。

需要同步：

- `run-regression` failure handoff
- `sync-review-findings` unknown_root_cause handoff
- `debug-and-fix-current-task` 编排说明
- `WORKFLOW_GUIDE` bug 流程
- `WORKFLOW_PROTOCOL` failure detour

### create-current-task

不要把 rollback point baseline 当新能力重做。

应表述为：

- lifecycle transition 必须复用现有 `Task start base` / `Last reviewed checkpoint` / `Current diff review target`。
- 新增的是 dirty attribution 和 environment state 如何接入 lifecycle transition。

写入 `CURRENT_TASK.md` 前：

- 记录 `Task start base`。
- 工作区必须 clean，或 dirty diff 必须显式归属。
- `CURRENT_TASK.md` 自身变更属于新任务治理文件变更。

## 修改范围修订

Allowed / Conditional 需要扩大，至少纳入：

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `scripts/workflow-doc-contracts.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/task-identity.ts`
- `test/task-identity.test.ts`
- `test/bootstrap-governance*.ts`
- `templates/docs/DOCUMENT_CATALOG.md.tmpl`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `templates/skills/**`
- `scripts/gen-registry.ts`
- `test/gen-*.test.ts`
- `vibe-coding/**`
- `docs/workflow/CURRENT_TASK.md`

Conditional:

- `docs/workflow/generated/**`
- `docs/workflow/SKILL_REGISTRY.md`
- `TASKS/paused/**`
- `TASKS/interrupted/**`
- `TASKS/inbox/**`

`docs/workflow/BACKLOG.md` 不作为默认方案；只有明确选择 workflow doc 级 backlog 时才允许，并同步 `workflow-doc-contracts`、catalog、schema、tests。

## 建议验收标准

- `WORKFLOW_PROTOCOL` 定义 lifecycle states、合法迁移、非法迁移、终态、幂等和失败恢复规则。
- `FILE_SCHEMAS` 定义 lifecycle 状态字段和 suspended / inbox 工件最小结构。
- task identity contract 明确 pause / interrupt / resume 不改变 `TASK_ID`，supersede 默认创建新 `TASK_ID`。
- paused / interrupted / inbox 的持久化位置与 archive contract 不冲突。
- `resume-paused-task` 检查 base drift、checkpoint drift、diff review target，而不是直接继续收口。
- `resume-interrupted-task` 独立处理 branch / worktree / checkpoint / merge plan。
- `investigate-root-cause` 增加 ownership matrix，并同步所有旧路由。
- lifecycle skills 进入 registry / generated outputs。
- `WORKFLOW_GUIDE` 和 `vibe-coding/**` 同步说明状态流转原则和反例。
- 测试覆盖状态机、持久化路径、identity 规则、skill handoff、guide routing。
- 回归通过：
  - `bun run gen:all`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`

## 建议实施顺序

1. 协议层：定义状态机、identity 延续、持久化路径。
2. schema 层：定义 paused / interrupted / inbox 工件最小字段。
3. contract / bootstrap / task identity：同步路径、清单、测试。
4. skill 层：新增和调整 lifecycle skills。
5. routing 层：调整 investigate / regression / review finding / debug 编排。
6. guide / methodology：同步用户流程和方法论原则。
7. registry / generated：运行生成器。
8. tests / validation：跑全量回归。

## 待确认问题

- `TASKS/inbox/**` 是否作为旁路发现默认持久化位置；当前建议采用，避免新增 `docs/workflow/BACKLOG.md` 带来的 workflow doc contract 扩张。
- `supersede-paused-task` 是否必须独立 skill；当前建议独立，降低 AI source 混淆。
- 是否允许本任务修改 `scripts/workflow-runtime.ts` 或 `.workflow-system/PROJECT_PROFILE.yaml`；当前建议不允许，除非协议 / schema 证明 runtime 或 profile path contract 必须参与。
- 恢复后 suspended 文件是保留 `rehydrated` 标记，还是迁移到 resolved 子目录；当前建议先在原文件记录 `rehydrated` 状态，避免引入更多目录。

## 当前草案结论

任务 003 的第一步不应是“新增 lifecycle skill”，而应是：

```text
定义 CURRENT_TASK lifecycle state machine + persistence identity contract。
```

只有这两个协议事实稳定后，才能实现各个 skill。
