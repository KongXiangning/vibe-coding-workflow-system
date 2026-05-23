# NEXT_TASK_DRAFT_003_CURRENT_TASK_LIFECYCLE.md

## 草案状态

- 用途：任务 003 候选任务包，供后续 `/create-current-task` 或 `/review-current-task` 复审。
- 当前状态：draft_for_review
- 不接管当前 `CURRENT_TASK.md`。
- 不代表任务 003 已开始实施。
- 本稿已按审核问题清单重构：把原“大一统 lifecycle 改造任务”收窄为**第一阶段协议契约任务**。

## 任务信息

- 任务 ID：003
- 任务标题：补齐 CURRENT_TASK 暂停 / 中断 / 恢复协议与工件契约（第一阶段）
- 任务 slug：current-task-suspend-resume-contract-foundation
- 建议初始 handoff：`create-current-task`

## 任务目标

建立 `CURRENT_TASK suspend / interrupt / resume protocol` 的第一阶段规范基础，使 workflow-system 先稳定回答以下问题：

- 哪些是生命周期状态，哪些只是动作或工件类型。
- `CURRENT_TASK.md` 作为唯一 live task identity 来源时，暂停 / 中断工件如何与既有 archive contract 共存。
- pause / interrupt / resume 的路径、最小字段、幂等、失败恢复与双活防护如何定义。

**本任务不直接实现 lifecycle runtime skills。**  
本任务先补齐协议、schema、路径解析与校验基础，后续再做 skill、routing、guide 和 generated outputs。

## 范围收窄结论

根据审核结论，原草案有 4 个问题必须先收窄：

1. `TASKS/paused/**`、`TASKS/interrupted/**`、`TASKS/inbox/**` 与现有 `TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md` 归档契约冲突。
2. 原草案把 `backlog_item` 混入生命周期状态集合，并把 `capture` 写成状态迁移源，混淆了状态、动作与工件。
3. 原草案试图同时引入 protocol、schema、skill、routing、guide、generated、tests，范围过大，`lock-scope` 会失去意义。
4. 原草案中的 `active_review_required` 在 handoff 上与普通恢复路径无差异，AI 无法稳定消费。

因此本任务只处理：

- 协议层状态定义
- schema 承载位置
- task artifact path contract
- bootstrap / validator / tests 对新契约的识别

以下内容全部移到后续任务：

- `pause-current-task` / `resume-paused-task` / `interrupt-current-task` / `resume-interrupted-task` 模板实现
- `capture-work-item`
- `external-root-cause-intake`
- `investigate-root-cause` ownership routing
- `WORKFLOW_GUIDE`、`vibe-coding/**`、generated outputs、registry 扩面同步

## P0 前置原则

### 1. 先协议 / schema，再 runtime skill

生命周期规则必须先进入规范源：

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`

在规范源未声明前，`templates/**`、`scripts/**`、tests、generated outputs 都不得自行扩展新状态、新字段或新目录语义。

### 2. 区分状态、动作与工件类型

本任务明确三类概念不能混写：

- **生命周期状态**：任务当前所处的协议状态
- **动作 / transition**：pause / interrupt / resume 这类触发迁移的行为
- **工件类型**：active live package、suspended package、archive package

因此：

- `capture` 不是状态。
- `backlog_item` 不是 `CURRENT_TASK` 生命周期状态。
- inbox / backlog 工件不在本任务范围内。

### 3. 先统一路径解析契约，再落 suspended 目录

现有 contract 只正式定义了：

- `CURRENT_TASK.md`：唯一 live task identity 来源
- `TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md`：最终 archive 路径

本任务第一阶段**正式引入**以下 suspended package path：

- `TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`

则必须先把 `scripts/task-identity.ts` 从单一 `archive path` 解析器提升为统一的 `task artifact path resolver`，并同步 bootstrap / validator / tests。

这里要显式处理一个 **P0 类型层变更**：

- `scripts/bootstrap-project-governance.ts` 中的 `BootstrapTaskIdentityPlan.archive_path_pattern` 当前是 **TypeScript 字面量类型 + 单一路径值**，不是可平滑扩展的普通字符串字段。
- 由于本任务正式引入 suspended package path，就不能只在运行时多加几个路径值，而必须同步升级 `BootstrapTaskIdentityPlan` 的导出类型形状。
- 本任务必须把它从“单一 archive pattern”提升为**`artifact_paths` 映射型 schema-backed 结构**，统一表达多种 artifact path。
- 这属于破坏性类型变更，必须在 `.workflow-system/FILE_SCHEMAS.md` 先定义结构，再同步 `bootstrap-project-governance.ts`、相关 tests 和所有消费方。

### 4. 先定义幂等与失败恢复，再定义 interrupt / resume 行为

本任务必须先定义：

- partial write 时如何恢复
- 如何避免同一 `TASK_ID` 同时出现 live active 与 suspended 双活
- 重复 pause / interrupt / resume 时的幂等语义（**v1 已固定为 fail-closed**，见§幂等规则）
- 哪些 recovery marker 必须写入工件

在这些规则未稳定前，不得落地 runtime skill。

### 5. 先决定 review gate 的表达方式，再决定 skill handoff

原草案的 `active_review_required` 没有独立消费面。  
本任务改为：

- **不把 `active_review_required` 作为 v1 生命周期状态**
- 改为定义一个显式的 **resume review gate**

即：

- 恢复后的任务重新回到 `active`
- 但必须携带 `resume_requires_review` / `resume_review_reasons`
- 后续 runtime task（任务 004）再决定由 `review-current-task` 扩展消费，还是新增专用 review skill（**已延迟至任务 004，不在本任务范围**）

## 生命周期模型（第一阶段）

### 1. 生命周期状态集合 v1

第一阶段只定义以下状态：

- `active`
  - 当前唯一活跃任务，身份来源为 `CURRENT_TASK.md`
- `paused_pending_closure`
  - 实现基本完成，但仍有验证、人工复核或小尾巴未收口
- `paused_blocked`
  - 任务方向本身未失效，但被外部 blocker 卡住
- `interrupted`
  - 被更高优先级任务插入；中断前必须记录 checkpoint evidence 和环境恢复策略
- `archived`
  - 完成后的终态 archive package

### 2. 明确不纳入 v1 生命周期状态的概念

以下概念在本任务中**不**进入状态集合：

- `backlog_item`
- `capture`
- `active_review_required`

对应处理方式：

- backlog / inbox：作为后续独立工件类型处理，不属于 `CURRENT_TASK` 生命周期状态
- review-required：作为恢复后的 gate 字段，而不是状态

### 3. 合法迁移矩阵 v1

允许：

```text
active -> paused_pending_closure
active -> paused_blocked
paused_pending_closure -> active   (resume + mandatory review gate)
paused_blocked -> active           (resume + mandatory review gate)
active -> interrupted
interrupted -> active              (resume + mandatory review gate)
active -> archived
```

默认禁止：

```text
paused_* -> archived
interrupted -> archived
paused_* -> active                 (without explicit resume metadata, i.e. rehydration_status != ready_for_resume OR ownership_state != recovery_only)
interrupted -> active              (without explicit checkpoint / recovery metadata, i.e. rehydration_status != ready_for_resume OR ownership_state != recovery_only)
archived -> active
```

### 4. review gate v1

恢复不是直接续做。  
本任务要求规范源定义恢复后的强制 gate，而不是单独引入新状态：

- `resume_requires_review: true`
- `resume_review_reasons: [...]`

最少覆盖：

- `base_drift`
- `checkpoint_drift`
- `diff_review_target_changed`
- `environment_recovery_pending`
- `assumption_changed`

v1 要求：

- `resume_review_reasons` 使用上述**闭合集合**，不得在实现阶段临时发明新 reason。
- 同一 package 内的 `resume_review_reasons` 必须去重并保持稳定顺序，便于 AI 做确定性比较和测试断言。
- `resume_requires_review: false` 时，`resume_review_reasons` 必须为空数组；不得出现语义冲突状态。

## 工件与路径契约（第一阶段）

### 1. 工件类型

第一阶段只定义三类 task artifact：

- **active live package**
  - `docs/workflow/CURRENT_TASK.md`
- **suspended package**
  - `paused` 或 `interrupted`
- **archive package**
  - `TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md`

本任务**不定义** inbox / backlog artifact。

### 2. 路径契约

既有 archive contract 继续保留：

- `TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md`

本任务正式引入 suspended package path，并要求同时落地统一路径解析契约，至少支持：

- `archive -> TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `paused -> TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `interrupted -> TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`

要求：

- 不允许只在文档里声明 `TASKS/paused/**`、`TASKS/interrupted/**`，却继续让脚本层只认 archive path
- `bootstrap-project-governance.ts` 不得继续只暴露单一 `archive_path_pattern`
- 相关 tests 必须同步验证 path kind 与文件名规则

### 3. TASK_ID / TASK_SLUG 规则

必须对齐现有 contract：

- `CURRENT_TASK.md` 仍是 active task identity 唯一 live 来源
- `TASK_ID` / `TASK_SLUG` 一旦 materialized，不可变
- pause / interrupt / resume 不改变 `TASK_ID`
- archive filename 仍从 materialized live identity 推导

### 3.1 identity completeness 与 lifecycle state 必须拆分

本任务必须显式区分两个不同维度，禁止混用：

- **Task identity completeness**
  - 对应 `scripts/task-identity.ts` 中现有 `TaskIdentityStatus`
  - 只表示 `TASK_ID` / `TASK_TITLE` / `TASK_SLUG` 是否 `materialized`、`placeholder-preserved` 或 `incomplete`
- **Task lifecycle state**
  - 表示任务当前处于 `active`、`paused_pending_closure`、`paused_blocked`、`interrupted`、`archived`

因此本任务必须落地以下规则：

- `TaskIdentityStatus` 保持现有职责，只做 identity 完整性 / 物化状态判断
- 不得把 `active`、`paused_*`、`interrupted`、`archived` 叠加到 `TaskIdentityStatus`
- `scripts/task-identity.ts` 必须新增独立的 `TaskLifecycleState = 'active' | 'paused_pending_closure' | 'paused_blocked' | 'interrupted' | 'archived'`
- `scripts/task-identity.ts` 必须新增独立的 `TaskArtifactKind = 'archive' | 'paused' | 'interrupted'`
- 路径解析必须新增独立函数 `getTaskArtifactPath(taskId, taskSlug, kind)`
- 现有 `getTaskArchivePath()` 可以保留为 archive-only wrapper，但不得继续承担全部 artifact path contract

### 4. suspended package 最小要求

本任务将 suspended package schema 纳入第一阶段范围，最少应登记：

- task identity（必须包含：`TASK_ID`、`TASK_TITLE`、`TASK_SLUG`）
- artifact kind：`paused` / `interrupted`
  - `paused` 对应 `paused_pending_closure` 和 `paused_blocked` 两个 lifecycle state
  - artifact kind 只决定存储路径（`TASKS/paused/**`），lifecycle state 区分存储在 package 内部的 `lifecycle_state` 字段
- lifecycle state（使用 `TaskLifecycleState` 闭合集合）
- `suspension_reason`（自由文本；v1 不强制闭合集合，但必须非空）
- `task_start_base`
- `last_reviewed_checkpoint`
- `current_diff_review_target`
- `resume_requires_review`
- `resume_review_reasons`
- `rehydration_status`
- `ownership_state`

其中 v1 最少约束为：

- `rehydration_status` 只能使用：
  - `write_incomplete`
  - `ready_for_resume`
  - `rehydrated`
- `ownership_state` 只能使用：
  - `recovery_only`
  - `rehydrated`
- 只有同时满足以下条件的 suspended package 才是可恢复输入：
  - `rehydration_status = ready_for_resume`
  - `ownership_state = recovery_only`
  - `resume_requires_review` 与 `resume_review_reasons` 自洽

`paused_pending_closure` 无额外必填字段（公共字段已足够）。

`paused_blocked` 额外最少要求：

- blocker status
- remaining acceptance
- failed checks

`interrupted` 额外最少要求：

- checkpoint evidence
- dirty attribution
- environment state
- recovery strategy

## 幂等与失败恢复要求（第一阶段）

本任务必须先把以下协议规则写清楚：

### 1. partial write 防护

不能允许以下未定义中间态长期存在：

- `CURRENT_TASK.md` 仍声明 active，但同一 `TASK_ID` 的 suspended package 已写出且被误判为可恢复
- suspended package 已写出，但没有 `rehydration_status` / `ownership_state`
- 恢复后重新生成了 `CURRENT_TASK.md`，但旧 suspended package 没有 `rehydrated` 记录

v1 必须显式定义以下恢复规则：

1. 写 suspended package 但尚未完成 active ownership 切换时，package 必须落为：
   - `rehydration_status = write_incomplete`
   - `ownership_state = recovery_only`
2. 只有当 suspend / interrupt 事务完成，且 `CURRENT_TASK.md` 不再把该 `TASK_ID` 视为 active owner 后，suspended package 才能升级为：
   - `rehydration_status = ready_for_resume`
3. 对 `write_incomplete` package 不允许直接 resume；必须先修复或人工复核后再进入可恢复状态。
4. resume 成功后，来源 suspended package 必须更新为：
   - `rehydration_status = rehydrated`
   - `ownership_state = rehydrated`

### 2. 幂等规则

v1 固定为：

- 对已 `paused_*` 的任务再次执行 pause：`fail-closed`
- 对已 `interrupted` 的任务再次执行 interrupt：`fail-closed`
- 对无 suspended package 的任务执行 resume：`fail-closed`
- 对 `rehydration_status != ready_for_resume` 的 suspended package 执行 resume：`fail-closed`
- 对已 `archived` 的任务执行 resume：`fail-closed`

### 3. 双活防护

v1 固定规则：

- `docs/workflow/CURRENT_TASK.md` 始终是 live active ownership 的唯一 source of truth。
- suspended package 无论位于 `TASKS/paused/**` 还是 `TASKS/interrupted/**`，都只能作为 recovery evidence / resume source，不能单独取得 active ownership。
- 当同一 `TASK_ID` 同时存在 live `CURRENT_TASK.md` 与 suspended package 时：
  - `CURRENT_TASK.md` 决定当前是否 active
  - suspended package 只用于恢复和审计
- 只有当 suspended package 标记为 `ready_for_resume`，且 `CURRENT_TASK.md` 已不再声明该 `TASK_ID` 为 active owner 时，才允许把它作为恢复来源。
  - **active ownership 判定机制**：`CURRENT_TASK.md` 文件存在且其 `TASK_ID` 头部字段与候选恢复 package 的 `TASK_ID` 相同，即视为 active owner。`CURRENT_TASK.md` 不存在、或其 `TASK_ID` 不匹配，则视为不再声明 active。`CURRENT_TASK.md` v1 无需单独添加 `lifecycle_state` 字段；文件存在 + TASK_ID 匹配即代表 active。

## 本任务必须覆盖的代码面

### 协议 / schema

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`

### 路径与 bootstrap / validator

- `scripts/task-identity.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/workflow-doc-contracts.ts`

必须覆盖的具体变更：

- `BootstrapTaskIdentityPlan` 的导出类型形状升级，不再只允许单一 `archive_path_pattern`
- `task-identity.ts` 中 identity completeness 与 lifecycle state 分离建模
- 新增独立的 artifact kind / path resolver，而不是复用 `TaskIdentityStatus`
- `FILE_SCHEMAS.md` 必须把 `resume_review_reasons`、`rehydration_status`、`ownership_state` 定义为可校验的闭合集合，而不是开放字符串

### 对应测试

- `test/task-identity.test.ts`
- `test/bootstrap-project-governance.test.ts`
- 必要的 validator / generator tests
- 至少补齐以下断言：
  - artifact path resolver 能稳定区分 `archive` / `paused` / `interrupted`
  - `resume_review_reasons` 非闭合集合值时校验失败
  - `write_incomplete` package 不能被当作可恢复输入
  - live `CURRENT_TASK.md` 与 suspended package 并存时，active ownership 以 `CURRENT_TASK.md` 为准

## 修改范围修订

### Allowed Files

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `scripts/task-identity.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/workflow-doc-contracts.ts`
- `test/task-identity.test.ts`
- `test/bootstrap-project-governance.test.ts`
- `test/run-validation.test.ts`（本任务正式引入 suspended package schema，需补校验断言）

### Conditional Files

（v1 无剩余条件文件）

### Forbidden Files

- `templates/skills/**`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `templates/docs/DOCUMENT_CATALOG.md.tmpl`
- `docs/workflow/SKILL_REGISTRY.md`
- `docs/workflow/DOCUMENT_CATALOG.md`
- `docs/workflow/generated/**`
- `vibe-coding/**`
- `scripts/workflow-runtime.ts`（若协议 / schema 证明必须参与，须单独起后续任务，不在本任务中顺手扩面）
- `.workflow-system/PROJECT_PROFILE.yaml`
- `docs/workflow/BACKLOG.md`

## 建议验收标准

- `WORKFLOW_PROTOCOL` 明确定义 v1 生命周期状态集合，并明确 `backlog_item`、`capture`、`active_review_required` 不属于该集合
- `WORKFLOW_PROTOCOL` 定义合法迁移、禁止迁移、固定 `fail-closed` 幂等规则、partial failure 恢复标记与双活防护规则
- `FILE_SCHEMAS` 明确 lifecycle state、resume review gate、suspended package 的承载位置和最小字段，并把 `resume_review_reasons`、`rehydration_status`、`ownership_state` 定义为闭合集合
- `task-identity.ts` 中 `TaskIdentityStatus` 继续只表达 identity completeness，不承担 lifecycle 语义
- `task-identity.ts` 不再只暴露单一 archive path 解析语义；必须新增独立的 `TaskArtifactKind` 与统一 artifact path resolver，以支持 archive / paused / interrupted 三类 artifact path
- `bootstrap-project-governance.ts` 不再把 task artifact path contract 仅表达为单一 archive pattern；`BootstrapTaskIdentityPlan` 必须升级为可表达多 artifact path 的导出类型
- `workflow-doc-contracts.ts` 和相关校验 / 测试能识别新引入的 suspended package 结构，并把它作为 task artifact 校验入口，而不是 workflow governance artifact catalog 条目
- suspended package 只有在 `rehydration_status = ready_for_resume` 且 `ownership_state = recovery_only` 时才可作为恢复输入
- live / suspended 并存时，`docs/workflow/CURRENT_TASK.md` 始终是 active ownership 的唯一 source of truth
- 不新增 lifecycle runtime skill 模板
- 不新增 inbox / backlog artifact
- 不扩面修改 `templates/docs/DOCUMENT_CATALOG.md.tmpl` 或 `docs/workflow/DOCUMENT_CATALOG.md`
- 回归通过：
  - `bun run gen:all`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`

## 建议实施顺序

1. 协议层：定义生命周期状态、review gate、禁止迁移、幂等与失败恢复。
2. schema 层：定义 `CURRENT_TASK.md` 与 suspended package 的承载位置与最小字段。
3. 路径层：把单一 archive path 提升为 task artifact path contract。
4. bootstrap / validator：同步 path contract 与结构校验。
5. tests / validation：补测试并跑回归。
6. 记录 follow-up task，显式把 runtime skill 与 routing 改造延后。

## 后续任务建议

本任务完成后，再拆出后续任务：

1. **任务 004：lifecycle runtime skills**
   - 新增 `pause-current-task` / `resume-paused-task` / `interrupt-current-task` / `resume-interrupted-task`
   - 把 resume review gate 正式接入 handoff
2. **任务 005：ownership-aware root cause routing**
   - `external-root-cause-intake`
   - `investigate-root-cause`、`run-regression`、`sync-review-findings` 路由更新
3. **任务 006：capture-work-item / inbox artifact**
   - 独立定义 inbox identity、path contract、schema 与文档目录影响

## 已确认决策

- **本任务第一阶段正式引入 suspended package path**
  - `TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
  - `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`
  - 因此 `task-identity.ts`、`bootstrap-project-governance.ts`、`workflow-doc-contracts.ts` 与对应测试都必须按多 artifact path contract 落地，不能保留 deferred 分支。
- **resume review gate 采用双写可审计策略**
  - suspended package 必须记录 `resume_requires_review` / `resume_review_reasons`，作为恢复来源和历史证据。
  - 恢复后的 `docs/workflow/CURRENT_TASK.md` 也必须回写同名字段，作为 active task 的当前 gate 信号。
  - 两侧字段语义必须一致；若不一致，以恢复后 `CURRENT_TASK.md` 为 live execution source of truth，suspended package 作为 historical evidence。
- **双活与恢复输入采用固定 source-of-truth / marker 规则**
  - `docs/workflow/CURRENT_TASK.md` 始终是 active ownership 的唯一 source of truth。
  - suspended package 只有在 `rehydration_status = ready_for_resume` 且 `ownership_state = recovery_only` 时才可作为恢复输入。
  - 对 `write_incomplete` 或任何 marker 不自洽的 package，一律 `fail-closed`，不得自动 resume。
- **`workflow-doc-contracts.ts` 将 suspended package 视为 task artifact，而不是 workflow governance artifact**
  - 它需要提供对 suspended package 结构和路径契约的识别 / 校验入口。
  - 它不应因此把每个 suspended package 提升为 governance catalog 中的常驻文档对象。
- **v1 不扩面 `DOCUMENT_CATALOG`**
  - `templates/docs/DOCUMENT_CATALOG.md.tmpl` 与 `docs/workflow/DOCUMENT_CATALOG.md` 在本任务中保持不变。
  - 若后续任务要把 suspended package 纳入 catalog，必须单独起任务处理 catalog contract、生成链和 freshness 影响。

## 当前草案结论

任务 003 不再定义为“新增一组 lifecycle skills”，而应定义为：

```text
先补齐 CURRENT_TASK suspend / interrupt / resume protocol
+ schema carrying locations
+ task artifact path contract
+ idempotency / failure recovery rules
```

只有这层契约站稳后，后续 runtime skill 与 routing 才值得实现。
