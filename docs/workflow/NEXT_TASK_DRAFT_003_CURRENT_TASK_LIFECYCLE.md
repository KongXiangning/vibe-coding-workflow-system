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

如果要引入：

- `TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`

则必须先把 `scripts/task-identity.ts` 从单一 `archive path` 解析器提升为统一的 `task artifact path resolver`，并同步 bootstrap / validator / tests。

### 4. 先定义幂等与失败恢复，再定义 interrupt / resume 行为

本任务必须先定义：

- partial write 时如何恢复
- 如何避免同一 `TASK_ID` 同时出现 live active 与 suspended 双活
- 重复 pause / interrupt / resume 时是 no-op 还是 fail-closed
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
- 后续 runtime task 再决定由 `review-current-task` 扩展消费，还是新增专用 review skill

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
paused_* -> active                 (without explicit resume metadata)
interrupted -> active              (without explicit checkpoint / recovery metadata)
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

如果本任务决定正式引入 suspended package，则必须同时落地统一路径解析契约，至少支持：

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

### 4. suspended package 最小要求

如果本任务引入 suspended package schema，最少应登记：

- task identity
- artifact kind：`paused` / `interrupted`
- lifecycle state
- suspension reason
- `Task start base`
- `Last reviewed checkpoint`
- `Current diff review target`
- `resume_requires_review`
- `resume_review_reasons`
- `rehydration_status`

`interrupted` 额外最少要求：

- checkpoint evidence
- dirty attribution
- environment state
- recovery strategy

`paused_blocked` 额外最少要求：

- blocker status
- remaining acceptance
- failed checks

## 幂等与失败恢复要求（第一阶段）

本任务必须先把以下协议规则写清楚：

### 1. partial write 防护

不能允许以下未定义中间态长期存在：

- `CURRENT_TASK.md` 仍声明 active，但同一 `TASK_ID` 的 suspended package 已写出
- suspended package 已写出，但没有 `rehydration_status` / recovery marker
- 恢复后重新生成了 `CURRENT_TASK.md`，但旧 suspended package 没有 resolved / rehydrated 记录

### 2. 幂等规则

至少要定义：

- 对已 `paused_*` 的任务再次执行 pause：no-op 或 fail-closed，必须固定
- 对已 `interrupted` 的任务再次执行 interrupt：no-op 或 fail-closed，必须固定
- 对无 suspended package 的任务执行 resume：fail-closed
- 对已 `archived` 的任务执行 resume：fail-closed

### 3. 双活防护

协议必须回答：

- 如何判定某 `TASK_ID` 仍由 live `CURRENT_TASK.md` 持有 active ownership
- 如何判定 suspended package 只是恢复来源，而不是第二个 active task
- 出现 live + suspended 并存时，哪个文件是 source of truth，哪个只是 recovery evidence

## 本任务必须覆盖的代码面

### 协议 / schema

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`

### 路径与 bootstrap / validator

- `scripts/task-identity.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/workflow-doc-contracts.ts`

### 对应测试

- `test/task-identity.test.ts`
- `test/bootstrap-project-governance.test.ts`
- 必要的 validator / generator tests

## 明确不在本任务范围

以下内容全部排除：

- `templates/skills/**`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `scripts/gen-registry.ts`
- `docs/workflow/SKILL_REGISTRY.md`
- `docs/workflow/generated/**`
- `vibe-coding/**`
- `capture-work-item`
- `external-root-cause-intake`
- `investigate-root-cause` ownership routing
- `docs/workflow/BACKLOG.md`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `scripts/workflow-runtime.ts`

如协议 / schema 证明 `scripts/workflow-runtime.ts` 必须参与，必须单独起后续任务，不在本任务中顺手扩面。

## 修改范围修订

### Allowed Files

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `scripts/task-identity.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/workflow-doc-contracts.ts`
- `test/task-identity.test.ts`
- `test/bootstrap-project-governance.test.ts`
- 与上述脚本直接相关的少量校验测试

### Conditional Files

- `test/run-validation.test.ts`
  - 仅当新增 suspended package 校验语义时允许修改
- `templates/docs/DOCUMENT_CATALOG.md.tmpl`
  - 仅当 `workflow-doc-contracts` 明确要求 catalog 出现 suspended package reference 时允许修改
- `docs/workflow/DOCUMENT_CATALOG.md`
  - 仅在模板变更并重新生成时允许修改

### Forbidden Files

- `templates/skills/**`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `docs/workflow/SKILL_REGISTRY.md`
- `docs/workflow/generated/**`
- `vibe-coding/**`
- `scripts/workflow-runtime.ts`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `docs/workflow/BACKLOG.md`

## 建议验收标准

- `WORKFLOW_PROTOCOL` 明确定义 v1 生命周期状态集合，并明确 `backlog_item`、`capture`、`active_review_required` 不属于该集合
- `WORKFLOW_PROTOCOL` 定义合法迁移、禁止迁移、幂等规则、partial failure 与双活防护规则
- `FILE_SCHEMAS` 明确 lifecycle state、resume review gate、suspended package 的承载位置和最小字段
- `task-identity.ts` 不再只暴露单一 archive path 解析语义；若引入 suspended package，必须有统一 artifact path resolver
- `bootstrap-project-governance.ts` 不再把 task artifact path contract 仅表达为单一 archive pattern
- `workflow-doc-contracts.ts` 和相关校验 / 测试能识别新引入的 suspended package 结构；若本任务最终不引入 suspended path，则必须显式写成 deferred，而不是半定义
- 不新增 lifecycle runtime skill 模板
- 不新增 inbox / backlog artifact
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

## 待确认问题

- suspended package 的统一路径解析接口命名是什么；当前建议使用 task artifact kind，而不是继续沿用 archive-only 命名
- `resume review gate` 的字段是只写在 suspended package，还是恢复后的 `CURRENT_TASK.md` 也要回写；当前建议两边都可审计
- `workflow-doc-contracts.ts` 是否把 suspended package 视为 workflow governance artifact；当前建议视为 task artifact，并提供单独校验入口
- `templates/docs/DOCUMENT_CATALOG.md.tmpl` 是否必须列出 suspended package 路径；当前建议只有在 contract 层正式纳入 catalog 时才扩面

## 当前草案结论

任务 003 不再定义为“新增一组 lifecycle skills”，而应定义为：

```text
先补齐 CURRENT_TASK suspend / interrupt / resume protocol
+ schema carrying locations
+ task artifact path contract
+ idempotency / failure recovery rules
```

只有这层契约站稳后，后续 runtime skill 与 routing 才值得实现。
