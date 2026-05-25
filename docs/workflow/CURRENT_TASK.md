# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：003
- 任务标题：补齐 CURRENT_TASK 暂停 / 中断 / 恢复协议与工件契约（第一阶段）
- 任务 slug：current-task-suspend-resume-contract-foundation
- 当前状态：draft
- 当前 handoff：plan-implementation
- 创建时间：2026-05-25

## 背景与上下文

- 任务 002 已完成并归档；当前进入任务 003 的任务包创建阶段。
- 用户提供 `docs/workflow/NEXT_TASK_DRAFT_003_CURRENT_TASK_LIFECYCLE.md` 作为任务 003 草案，草案已将原“大一统 lifecycle 改造任务”收窄为第一阶段协议契约任务。
- 本任务目标是先稳定 `CURRENT_TASK suspend / interrupt / resume protocol` 的规范基础，回答以下问题：
  - 哪些是生命周期状态，哪些只是动作或工件类型。
  - `CURRENT_TASK.md` 作为唯一 live task identity 来源时，暂停 / 中断工件如何与既有 archive contract 共存。
  - pause / interrupt / resume 的路径、最小字段、幂等、失败恢复与双活防护如何定义。
- 本任务不直接实现 lifecycle runtime skills，不新增 pause / resume / interrupt skill 模板，不新增 inbox / backlog artifact，不扩面修改 workflow guide / registry；generated outputs 仅允许按 Conditional Files 同步单一 `CURRENT_TASK.md` reference render。
- 本任务涉及协议、schema、路径解析、bootstrap / validator 和测试，属于 source repo workflow-system 内部契约变更任务。

## 验收标准

- `.workflow-system/WORKFLOW_PROTOCOL.md` 明确定义 v1 生命周期状态集合：
  - `active`
  - `paused_pending_closure`
  - `paused_blocked`
  - `interrupted`
  - `archived`
- `WORKFLOW_PROTOCOL` 明确 `backlog_item`、`capture`、`active_review_required` 不属于 v1 生命周期状态。
- `WORKFLOW_PROTOCOL` 定义合法迁移、禁止迁移、固定 `fail-closed` 幂等规则、partial failure 恢复标记与双活防护规则。
- `.workflow-system/FILE_SCHEMAS.md` 明确 `CURRENT_TASK.md > ## 任务信息` 新增字段及 schema key 映射：
  - `生命周期状态` -> `lifecycle_state`
  - `恢复需审查` -> `resume_requires_review`
  - `恢复审查原因` -> `resume_review_reasons`
- `FILE_SCHEMAS` 区分 `当前状态` 与 lifecycle state，并明确 resume review gate、suspended package 的承载位置和最小字段。
- `resume_review_reasons`、`rehydration_status`、`ownership_state` 被定义为闭合集合，不作为开放字符串处理。
- `templates/docs/CURRENT_TASK.md.tmpl` 在 `## 任务信息` 中包含 `生命周期状态`、`恢复需审查`、`恢复审查原因`。
- `templates/docs/CURRENT_TASK.md.tmpl` 默认值固定为：
  - `当前状态：draft`
  - `生命周期状态：active`
  - `恢复需审查：false`
  - 空 `恢复审查原因`
- parser / validator 能稳定读取 `CURRENT_TASK.md > ## 任务信息` 中的恢复审查字段并映射到 schema key。
- `scripts/task-identity.ts` 中 `TaskIdentityStatus` 继续只表达 identity completeness，不承担 lifecycle 或 active ownership 语义。
- `scripts/task-identity.ts` 定义并测试：
  - `CurrentTaskWorkflowStatus`
  - `TaskLifecycleState`
  - `CurrentTaskOwnershipStatus`
  - `TaskArtifactKind`
  - `getTaskArtifactPath(taskId, taskSlug, kind)`
- `scripts/task-identity.ts` 固化 `当前状态 × 生命周期状态` 合法组合矩阵，并以稳定 named errors 表达非法状态：
  - `CURRENT_TASK_WORKFLOW_STATUS_INVALID`
  - `CURRENT_TASK_STATUS_TUPLE_INVALID`
  - `RESUME_GATE_DRIFT`
- `getTaskArchivePath()` 可保留为 archive-only wrapper，但不得继续承担全部 artifact path contract。
- `scripts/bootstrap-project-governance.ts` 不再把 task artifact path contract 仅表达为单一 `archive_path_pattern`。
- `BootstrapTaskIdentityPlan` 升级为可表达多 artifact path 的导出类型，并显式记录对 source-repo governance output 的影响评估。
- 若影响评估发现必须改变 runtime manifest / install / health report contract，必须停止并拆后续任务，不得在任务 003 中修改 `scripts/workflow-runtime.ts` 或 `test/workflow-runtime.test.ts`。
- `scripts/workflow-doc-contracts.ts` 识别并校验 suspended package 路径与结构，但不得把每个 suspended package 提升为 governance catalog 常驻文档对象。
- `scripts/run-validation.ts` 通过 protocol-level synthesized check 正式接入 suspended package 校验入口：
  - entrypoint 名称固定为 `suspended-task-package-validation`
  - blocker level 固定为 `blocks-merge`
  - 目录不存在或无 package 时通过
  - stray suspended artifact 触发同名 entrypoint fail-closed
  - 非法 suspended package 触发同名 entrypoint fail-closed
- suspended package 只有满足以下条件时才可作为恢复输入：
  - `rehydration_status = ready_for_resume`
  - `ownership_state = recovery_only`
  - `resume_requires_review = true`
  - `resume_review_reasons` 为非空闭合集合
  - reasons 满足对应 lifecycle-state 场景映射
  - reasons 按闭合集合表格顺序去重稳定输出，或未规范化时 `fail-closed`
- `artifact_kind = interrupted` 时，还必须具备 checkpoint evidence、dirty attribution、environment state、recovery strategy。
- live / suspended 并存时，`docs/workflow/CURRENT_TASK.md` 的 `当前状态` 与 `生命周期状态` 共同决定 active ownership。
- `当前状态` active/live allowlist 固定为 `draft`、`active`。
- `suspended` 明确释放 active ownership，且只能与 `paused_pending_closure` / `paused_blocked` / `interrupted` 组成合法 tuple。
- 不新增 lifecycle runtime skill 模板。
- 不新增 inbox / backlog artifact。
- 不扩面修改 `templates/docs/DOCUMENT_CATALOG.md.tmpl` 或 `docs/workflow/DOCUMENT_CATALOG.md`。
- `bun run gen:all` 作为 freshness / generator consistency 验证入口；若它只产生 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 中由 `templates/docs/CURRENT_TASK.md.tmpl` 派生的字段同步 diff，则按 Conditional Files 处理；若产生其他 `docs/workflow/generated/**` 或 `docs/workflow/SKILL_REGISTRY.md` diff，本任务必须停止并重新锁范围。
- 回归通过：
  - `bun run gen:all`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`

## 允许修改范围

Allowed Files:

- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `templates/docs/CURRENT_TASK.md.tmpl`
- `scripts/task-identity.ts`
- `scripts/bootstrap-project-governance.ts`
- `scripts/workflow-doc-contracts.ts`
- `scripts/run-validation.ts`
- `test/gen-workflow-docs.test.ts`
- `test/task-identity.test.ts`
- `test/bootstrap-project-governance.test.ts`
- `test/run-validation.test.ts`
- `docs/workflow/CURRENT_TASK.md`

Conditional Files:

- `docs/workflow/generated/workflow-docs/CURRENT_TASK.md`
  - condition：仅当 `bun run gen:workflow-docs` 或 `bun run gen:all` 由 `templates/docs/CURRENT_TASK.md.tmpl` 的 `## 任务信息` 新增字段派生出 reference render freshness diff 时允许。
  - required evidence：命令输出证明生成器执行成功；diff 只包含 `生命周期状态：active`、`恢复需审查：false`、空 `恢复审查原因` 三个模板字段及其正常 reference render 结果；不得手工编辑。
  - validation：`bun run validate:freshness` 不再报告 `workflow-docs/CURRENT_TASK.md` stale；随后复跑 `bun run test:run-validation`。

Safety mode:

- `frozen-scope`
- 选择理由：本任务会修改 locked protocol / schema source 与 protocol-level validation flow，风险主要来自契约漂移与生成链干扰；但不涉及 production、deployment、database、authentication、payments 或危险命令执行，因此采用严格白名单的 `frozen-scope`，而不是 `guarded`。

Dangerous surfaces:

- `rollback`：本任务会定义 suspend / interrupt / resume 的失败恢复与回滚语义，但不得执行 history rewrite、force push 或批量删除来“模拟”恢复。
- `CI/CD`：`scripts/run-validation.ts` 影响 protocol-level merge gate；只能在 Allowed Files 内修改，并以既有回归命令验证。
- `generated artifact discipline`：`docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 仅按 Conditional Files 由生成器同步；其他 `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md` 只允许检测 freshness，若出现 diff 必须停止并重新锁范围。

Unlock / widening conditions:

- 默认不允许扩大范围；未列入 Allowed Files 的文件一律禁止修改。
- 只有当实现证据证明当前 contract 无法在既有 Allowed Files 内闭合时，才允许回到 `/lock-scope` 重新生成范围清单。
- 触发 widening 时必须同时写明：
  - reason：为什么当前白名单无法完成契约闭环。
  - impacted files：新增涉及的具体文件。
  - risks：会引入哪些 contract / generated / runtime 风险。
  - validation：新增或扩大的验证方式。
- 预先识别但当前仍禁止的 widening 候选：
  - `scripts/validation-model.ts`
  - `test/validation-model.test.ts`
  - `scripts/workflow-runtime.ts`
  - `test/workflow-runtime.test.ts`
  - 除 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 条件同步以外的 `docs/workflow/generated/**`
  - `docs/workflow/SKILL_REGISTRY.md`
  - `templates/docs/DOCUMENT_CATALOG.md.tmpl`
  - `docs/workflow/DOCUMENT_CATALOG.md`

## 禁止修改范围

Forbidden Files:

- `templates/skills/**`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `templates/docs/DOCUMENT_CATALOG.md.tmpl`
- `docs/workflow/SKILL_REGISTRY.md`
- `docs/workflow/DOCUMENT_CATALOG.md`
- 除 Conditional Files 明确列出的 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 以外的 `docs/workflow/generated/**`
- `docs/workflow/CONTRACTS.md`
- `docs/workflow/DECISIONS.md`
- `docs/workflow/STATUS.md`
- `vibe-coding/**`
- `scripts/validation-model.ts`
- `scripts/workflow-runtime.ts`
- `test/validation-model.test.ts`
- `test/workflow-runtime.test.ts`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `docs/workflow/BACKLOG.md`
- `dist/**`
- `.git/**`
- `node_modules/**`

## 受影响的契约

- 触碰 locked protocol / schema source：
  - `.workflow-system/WORKFLOW_PROTOCOL.md`
  - `.workflow-system/FILE_SCHEMAS.md`
- 触碰 task identity / artifact path contract：
  - `scripts/task-identity.ts`
  - archive-only path contract 扩展为 `archive` / `paused` / `interrupted` 多 artifact path contract。
- 触碰 bootstrap source-repo governance output contract：
  - `BootstrapTaskIdentityPlan.archive_path_pattern` 从单一路径字段升级为 schema-backed artifact path 映射结构。
  - 该类型变更属于 source-repo governance output contract 的破坏性类型变更，必须先由 schema 定义并有测试覆盖。
- 触碰 protocol-level validation flow：
  - `run-validation.ts` 必须新增 `suspended-task-package-validation` synthesized check，不能只停留在 helper 单元测试。
- 不触碰 runtime manifest / install / health report contract；如发现必须触碰，停止并拆后续任务。
- 仅允许按 Conditional Files 同步 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md`；如 `bun run gen:all` 产生其他 generated diff，停止并重新锁范围。

## 已确认决策

- 本任务第一阶段正式引入 suspended package path：
  - `TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md`
  - `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md`
- `task-identity.ts`、`bootstrap-project-governance.ts`、`workflow-doc-contracts.ts` 与对应测试必须按多 artifact path contract 落地，不能保留 deferred 分支。
- resume review gate 采用双写可审计策略：
  - suspended package 记录 `resume_requires_review` / `resume_review_reasons`。
  - 恢复后的 `CURRENT_TASK.md > ## 任务信息` 写回 `恢复需审查` / `恢复审查原因`。
  - 两侧字段语义必须一致；resume 事务完成前不一致必须 `fail-closed`，完成后审计发现不一致则记录 `RESUME_GATE_DRIFT` 并进入 review gate。
- 双活与恢复输入采用固定 source-of-truth / marker 规则：
  - `CURRENT_TASK.md` 的 `当前状态` 与 `生命周期状态` 共同决定 active ownership。
  - `draft + active`、`active + active` 是仅有 active owner tuple。
  - `suspended + paused_* / interrupted` 是 non-active suspended marker。
  - `superseded | replaced | blocked_by_replan + active` 是 non-active replacement / replan marker，且不可 resume。
- `workflow-doc-contracts.ts` 将 suspended package 视为 task artifact，而不是 workflow governance artifact。
- runtime manifest / install / health report contract 不在本任务中变更。
- v1 不扩面 `DOCUMENT_CATALOG`。
- `create-current-task` 不作为 ctx7 主查询入口；当前任务不触发外部文档门。

## 决策分类

Mechanical:

- v1 生命周期状态闭集、禁止概念、合法 / 非法迁移、fail-closed 幂等与 partial failure recovery 规则，属于协议层机械收敛，不留主观口味分支。
- `CURRENT_TASK.md > ## 任务信息` 的 `生命周期状态`、`恢复需审查`、`恢复审查原因` 字段承载位置、schema key 映射和闭合集合属于 schema / parser / validator 对齐问题，按协议源统一落地。
- task artifact path contract 必须统一为 archive / paused / interrupted resolver，`getTaskArchivePath()` 仅保留 archive-only wrapper；`BootstrapTaskIdentityPlan` 必须同步升级为 schema-backed multi-artifact path structure 并补测试。
- `workflow-doc-contracts.ts` 与 `run-validation.ts` 对 suspended package 的识别、fail-closed 校验与 synthesized check 接入属于验证链闭环，不是产品方向选择。
- `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 的单一 Conditional File 同步属于 generator freshness 证据驱动的 mechanical reconciliation；它只传播 `templates/docs/CURRENT_TASK.md.tmpl` 已确认字段，不引入新的产品 / 口味方向。

Taste:

- 无。当前任务不涉及 UI、视觉、交互、命名文案风格或其他会显著影响实现路径的未确认口味决策。

User challenge:

- 不得把任务 003 扩大为 lifecycle runtime skill、routing、guide、registry、除 Conditional Files 外的 generated outputs 或 inbox / backlog artifact 改造；若实现证据证明必须扩面，必须停止并重新走 `/lock-scope`。
- 不得改写 runtime manifest / install / health report contract，不得触碰 `scripts/workflow-runtime.ts`、`test/workflow-runtime.test.ts`，除非用户显式接受拆出后续任务。
- 不得把 suspended package 提升为 governance catalog 常驻对象，不得扩面 `DOCUMENT_CATALOG`。
- 不得把 `create-current-task` 改造成 ctx7 主查询入口，也不得在当前任务未触发门禁时伪造外部文档依赖。
- 不得把单一 generated reference render 条件同步扩大为一般 generated maintenance；其他 generated outputs 与 registry 仍按 Forbidden Files 处理。

## 待确认问题

- 无。

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
- Health checks: generator / test / protocol validation only
- Canary window: not applicable
- Performance baseline: not applicable
- Rollback / recovery: revert task diff or restore `CURRENT_TASK.md` from task start base
- Release evidence: local command output

## 实现方案

- Goal: 先稳定 `CURRENT_TASK` suspend / interrupt / resume 的协议与 schema 基础，再让 template、resolver、bootstrap 和 validator 共同消费同一套 contract；本任务不进入 runtime lifecycle skill。
- Architecture impact:
  - 主影响面是 `.workflow-system/WORKFLOW_PROTOCOL.md` 与 `.workflow-system/FILE_SCHEMAS.md`：它们要成为 lifecycle state、resume review gate、suspended package 最小字段、ownership marker 与 artifact path contract 的唯一规范源。
  - `templates/docs/CURRENT_TASK.md.tmpl` 是第一层消费者：它必须把新增字段以稳定默认值落到 live task skeleton，但不能先于 protocol/schema 自行发明字段语义。
  - `scripts/task-identity.ts` 成为状态判定与路径解析的实现中心：分离 workflow status、lifecycle state、ownership status 与 artifact kind，并保留 `getTaskArchivePath()` 作为 archive-only wrapper。
  - `scripts/bootstrap-project-governance.ts` 是唯一明确的导出形状变更面：`BootstrapTaskIdentityPlan` 要从单一 `archive_path_pattern` 升级为 schema-backed artifact mapping，并附带 impact assessment。
  - `scripts/workflow-doc-contracts.ts` 与 `scripts/run-validation.ts` 负责把 schema-backed suspended package contract 接入校验链；runtime manifest / install / health report、generated outputs、registry、guide 和 skill templates 继续留在范围外。
- Technical approach:
  - 第一优先级是 protocol-first：先在 `WORKFLOW_PROTOCOL` 定义闭集状态、合法 / 非法迁移、resume gate、fail-closed 幂等、partial failure recovery 和 dual-active protection，避免后续实现各自猜语义。
  - 第二优先级是 schema-first：在 `FILE_SCHEMAS` 明确 `CURRENT_TASK.md > ## 任务信息` 的新增字段、schema key 映射、closed enums、suspended package 最小字段以及 artifact path contract，让 template / parser / validator 共享同一来源。
  - 第三优先级才是 implementation wiring：先更新 `templates/docs/CURRENT_TASK.md.tmpl`，再让 `task-identity.ts` 解析 live/suspended artifact contract，随后让 bootstrap、workflow-doc-contracts 和 run-validation 分别消费该 contract，而不是在多个文件里复制路径与状态规则。
  - `run-validation.ts` 采用 `suspended-task-package-validation` synthesized check 接入 suspended package 校验，优先保持在既有 Allowed Files 内完成；如果实施证据证明还必须修改 `scripts/validation-model.ts` 或 `test/validation-model.test.ts`，应立即停止并回到 `/lock-scope`，而不是静默扩面。
  - 最小可行路径是：protocol -> schema -> template -> task identity -> bootstrap -> workflow doc contracts -> run-validation -> focused tests -> full regression。这样能先锁定语义，再闭合实现链和验证链。
- Alternatives considered:
  - 立即实现 lifecycle runtime skills：拒绝。它会把 scope 扩到 routing、handoff、guide、generated outputs，破坏当前“先定 contract 再做 runtime”的目标。
  - 继续让 `当前状态` 承载 lifecycle 语义：拒绝。它会污染现有 workflow / ownership status，并让 active ownership 判定失去可审计边界。
  - 只在文档或 helper 中补 paused / interrupted 路径：拒绝。没有统一 resolver、bootstrap output 和 validator 支持就会形成 split-brain contract。
  - 现在就把新检查升级为 protocol entrypoint 常量：当前不选。只要 synthesized check 能在 `run-validation.ts` 中 fail-closed 并覆盖现有回归，就不应为了“看起来更统一”去扩大到 `validation-model.ts`；若实现证据否定这一点，再回 `/lock-scope`。
  - 现在把 suspended package 纳入 `DOCUMENT_CATALOG`：拒绝。它属于 task artifact，不是 governance catalog 常驻文档。
- Data / state flow:
  - 规范源流：`WORKFLOW_PROTOCOL` 定义状态 / 迁移 / gate 语义，`FILE_SCHEMAS` 定义字段承载与 path contract，`CURRENT_TASK.md.tmpl` 物化默认 skeleton。
  - 运行判定流：`docs/workflow/CURRENT_TASK.md` 继续是唯一 live task identity；`TASKS/paused/**` 与 `TASKS/interrupted/**` 只作为 suspended package；`TASKS/TASK-*.md` 保持 archive package。
  - 解析与消费流：`task-identity.ts` 读取 live/suspended artifact contract 并派生 ownership；`bootstrap-project-governance.ts` 输出 artifact mapping；`workflow-doc-contracts.ts` 校验 package 结构；`run-validation.ts` 把 suspended package 违规提升为 protocol-level validation failure。
  - active ownership 只能由 `CURRENT_TASK.md` 的 `TASK_ID + 当前状态 + 生命周期状态` 推导，不能由 suspended package 是否存在反推。
- Compatibility:
  - `package.json` 对外公开的 `gen:*`、`validate:*`、`test:*`、`workflow:*` 命令名不变；source repo / target repo 隔离语义不变。
  - `BootstrapTaskIdentityPlan` 的导出形状是本任务唯一预期的 contract shape change，但它必须被视为 source-repo governance output change，而不是 runtime manifest / install / health report change。
  - `workflow:install --root .` 禁止 self-install、`workflow:sync --root . --host <host> --write` 可 self-sync 的现有 runtime 边界保持不变。
- generated outputs 与 `docs/workflow/SKILL_REGISTRY.md` 默认不进入实现范围；已验证 `CURRENT_TASK.md.tmpl` 字段新增会导致 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` freshness drift，因此仅把该单一 generated reference render 作为 Conditional File 纳入生成器同步范围。
- Risks and rollback:
  - 主要风险 1：把 `TaskIdentityStatus`、workflow status 和 lifecycle state 混为一谈，会直接污染 active ownership 语义。
  - 主要风险 2：protocol/schema/template 与 resolver/validator 任一侧未同步，会形成 split-brain contract，导致 live package、suspended package 和 bootstrap output 相互矛盾。
  - 主要风险 3：`BootstrapTaskIdentityPlan` shape change 可能暴露出 runtime report / manifest / install contract 的隐性依赖；一旦发现，必须停止并拆后续任务。
  - 主要风险 4：`run-validation.ts` 新检查如果仍停留在 helper 级别，无法真正保护 merge gate。
  - 主要风险 5：`bun run gen:all` 若产生除 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 以外的 generated diff，说明变更已越过当前 frozen-scope；此时回滚做法是退回到 Task start base `23f52e85`，恢复当前任务包并重新锁范围，而不是把其他 generated outputs 混入本任务。
- Validation strategy:
  - 聚焦验证先覆盖四条链：`bun run test:workflow-docs`（模板 / skeleton 字段）、`bun run test:task-identity`（resolver / tuple / ownership）、`bun run test:bootstrap-governance`（artifact mapping shape）、现有 workflow 回归里能覆盖 `run-validation.ts` 的测试入口。
  - 全量回归保持任务包已声明的四条主命令：`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`。
  - 额外治理 smoke 采用现有 `bun run workflow:health --root .`，用于确认 live governance docs、profile 与 protocol-level validation 仍闭合。
  - 若任何一步提示 runtime / generated / registry surface 需要一并改动，验证策略不是“补更多测试继续做”，而是停止并回到 `/lock-scope`。
- External Documentation Gate: not triggered. This task depends only on repository-local protocol, schema, templates, scripts, tests, and governance docs; no third-party library / framework / SDK / API / CLI / cloud-service current behavior affects correctness.
- Open decisions: none.
- Handoff: `decompose-task`

## 审查问题队列

- Finding ID: RI-001
  - Severity: minor
  - Source: `review-implementation` (`diff_review_target: working-tree`)
  - Status: open-nonblocking
  - File / symbol: `.workflow-system/WORKFLOW_PROTOCOL.md` / section separator before `## 4. Project-type specialization rules`
  - Failure scenario: 后续人工阅读或 Markdown 结构检查期望 `## 4` 前是普通分隔符时，当前分隔符若出现 `- --` 这类形式会表现为无意义列表项。
  - Current evidence: 当前 working tree 已显示该位置为普通 `---` 分隔线；`git diff --check` 无错误，`bun run validate:protocol` 通过。
  - Minimal fix direction: 若后续编辑该段，保持分隔符为 `---` 或删除分隔符，避免恢复成列表项。
  - Required test: `git diff --check`；必要时 `bun run validate:protocol`

## 传播治理记录

### change_start_set

- 对象路径：`.workflow-system/WORKFLOW_PROTOCOL.md`
  - 对象类型：workflow protocol source
  - 变更起点语义：定义 lifecycle state、transition matrix、resume review gate、fail-closed 幂等、partial failure recovery 和 dual-active protection。
- 对象路径：`.workflow-system/FILE_SCHEMAS.md`
  - 对象类型：workflow schema source
  - 变更起点语义：定义 `CURRENT_TASK.md > ## 任务信息` 新字段、suspended package 最小字段、闭合集合和 artifact path contract。
- 对象路径：`templates/docs/CURRENT_TASK.md.tmpl`
  - 对象类型：workflow doc template
  - 变更起点语义：把 lifecycle / resume gate 字段稳定写入任务包骨架。
- 对象路径：`scripts/task-identity.ts`
  - 对象类型：workflow identity implementation
  - 变更起点语义：把 archive-only path handling 升级为 task artifact path resolver，并分离 workflow status、lifecycle state 和 ownership status。
- 对象路径：`scripts/bootstrap-project-governance.ts`
  - 对象类型：source-repo governance output
  - 变更起点语义：把 `BootstrapTaskIdentityPlan` 从单一 `archive_path_pattern` 升级为 schema-backed multi-artifact path structure。
- 对象路径：`scripts/workflow-doc-contracts.ts`
  - 对象类型：workflow doc contract validation
  - 变更起点语义：识别 suspended package 路径与结构，但不把其提升为 governance catalog 常驻对象。
- 对象路径：`scripts/run-validation.ts`
  - 对象类型：protocol-level validation flow
  - 变更起点语义：以 `suspended-task-package-validation` synthesized check fail-closed 接入 suspended package 校验入口。

### discovery evidence

- `EvidenceRecord`：
  - mechanism：conversation-analysis
  - query_or_entrypoint：`CURRENT_TASK.md` 初稿、`NEXT_TASK_DRAFT_003_CURRENT_TASK_LIFECYCLE.md`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md`
  - scope：任务 003 的主目标、边界、已确认决策与 source-of-truth precedence
  - result_summary：任务已收窄为单一主目标：先稳定 CURRENT_TASK suspend / interrupt / resume 的协议、schema、artifact path contract 与 validator/test 基础，不进入 runtime skill、guide、generated outputs 或 registry 扩面。
  - confidence：high
  - gaps：无
- `EvidenceRecord`：
  - mechanism：symbol-reference-search
  - query_or_entrypoint：`rg "archive_path_pattern|BootstrapTaskIdentityPlan|suspended-task-package-validation|TaskIdentityStatus|getTaskArchivePath"`
  - scope：task identity、bootstrap、validation surfaces 与既有测试落点
  - result_summary：受影响实现面收敛在 protocol、schema、template、task-identity、bootstrap、workflow-doc-contracts、run-validation 及既有测试；未发现必须把 `scripts/workflow-runtime.ts`、`test/workflow-runtime.test.ts`、generated outputs 或 registry 纳入本任务的硬依赖。
  - confidence：high
  - gaps：若实施中证实 runtime manifest / install / health report contract 必须变化，则当前任务必须停止并拆出后续任务。

### aggregation / complexity

- `evidence_diff_threshold`：
  - absolute_diff：3
  - relative_diff_ratio：0.5
- `EvidenceAggregation`：
  - aggregation_strategy：union
  - candidate_impact_set：`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/CURRENT_TASK.md.tmpl`、`scripts/task-identity.ts`、`scripts/bootstrap-project-governance.ts`、`scripts/workflow-doc-contracts.ts`、`scripts/run-validation.ts` 及对应测试
  - significant_divergence：false
  - divergence_reason：not-applicable
  - unresolved_gaps：none
  - aggregated_confidence：high
- `over_limit_policy`：
  - threshold_trigger：not-triggered
  - selected_branch：none
  - rationale：影响面仍可收敛在 source repo 内的协议、schema、template、scripts 与 tests，且只服务一个主目标。
  - direct_consumers_semantics：保留 `getTaskArchivePath()` archive-only wrapper、公开 CLI 命令语义和 source-repo / target-project 隔离边界。
  - total_candidate_consumers_semantics：generated outputs、runtime manifest / install / health report contract 一律维持冻结；一旦必须扩面，立即停止并拆后续任务。
- `ComplexityAssessment`：
  - propagation_depth：4
  - direct_consumers：7
  - total_candidate_consumers：12
  - cross_boundary_hops：1
  - exceeded_metrics：none
  - threshold_status：within-limit
  - forced_strategy：direct-change

### eligibility / candidate / registry

- `MutationEligibilityAssessment`：
  - common.object_path：`CURRENT_TASK lifecycle / artifact path contract`
  - common.object_kind：shared workflow contract
  - common.explicit_contract_state：locked source + task-scoped contract evolution
  - common.discovered_direct_consumers：7
  - common.cross_boundary：yes
  - common.critical_path_hit：yes
  - common.locked_hit_chain：yes
  - common.registry_freshness：fresh
  - common.rationale：本任务命中 locked protocol / schema source 与 bootstrap exported output，但边界已收敛为 source repo 内的兼容扩展，不覆盖 runtime install/sync contract。
  - when_pending_prerequisites.assessment_status：pending lock-scope
  - when_pending_prerequisites.blocking_gaps：none
  - when_completed.assessment_status：expected-compatible-extension-only
  - when_completed.eligibility：compatible-extension-only
- `implicit_shared_object_detection`：
  - object_path：`CURRENT_TASK lifecycle / artifact path contract`
  - object_kind：shared workflow contract
  - direct_consumers：`templates/docs/CURRENT_TASK.md.tmpl`、`scripts/task-identity.ts`、`scripts/bootstrap-project-governance.ts`、`scripts/workflow-doc-contracts.ts`、`scripts/run-validation.ts`、对应测试
  - cross_boundary：yes
  - critical_path_hit：yes
  - locked_hit_chain：yes
  - proposed_contract_state：locked-candidate
  - writeback_required：yes
- `RegistryFreshnessReport`：
  - object_path：`docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md`
  - registry_consumers：generated workflow reference outputs
  - discovered_consumers：`bun run gen:all` freshness / generator consistency check
  - effective_consumers：除 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 条件同步外，generated outputs remain frozen in task 003
  - freshness：`workflow-docs/CURRENT_TASK.md` 已验证为 stale，原因是 `templates/docs/CURRENT_TASK.md.tmpl` 的任务信息字段新增尚未同步 reference render
  - reconciliation：needs generator sync for the single conditional generated doc
  - divergence_summary：当前任务只允许通过生成器同步 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md`；若产生其他 generated diff，不纳入本任务修改范围，必须停止并重新锁范围。
- `EntityMutationChecklist`：
  - entity_name：`CURRENT_TASK lifecycle / artifact path contract`
  - covered_categories：storage、api、dto、event、projection、ui
  - unresolved_categories：none
  - gap_resolution：
    - category：storage
      - handling：resolved
      - blocker_error_code：none
    - category：api
      - handling：resolved
      - blocker_error_code：none
    - category：dto
      - handling：resolved
      - blocker_error_code：none
    - category：event
      - handling：resolved
      - blocker_error_code：none
    - category：projection
      - handling：resolved
      - blocker_error_code：none
    - category：ui
      - handling：resolved
      - blocker_error_code：none

### layout / behavior / migration / regression

- `LayoutContract`：
  - container_path：`docs/workflow/` 与 `TASKS/`
  - machine_anchor：active live package / suspended package / archive package separation
  - layout_model：`docs/workflow/CURRENT_TASK.md` 保持唯一 live task identity，`TASKS/paused/**`、`TASKS/interrupted/**`、`TASKS/TASK-*.md` 分别承载 suspended / archive artifacts
  - locked_properties：`docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md` generated-only；`docs/workflow/*.md` 仅承载 governance live docs
  - locked_relations：`CURRENT_TASK.md` 不得覆盖 `CONTRACTS.md` 或 `.workflow-system/PROJECT_PROFILE.yaml`；suspended package 不得被提升为 governance catalog 常驻对象
  - cascade_sources：`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/CURRENT_TASK.md.tmpl`
  - sibling_reflow_sensitive：yes
  - insertion_guard：
    - mode：guarded
    - protected_siblings：`docs/workflow/generated/**`、`docs/workflow/SKILL_REGISTRY.md`、`scripts/workflow-runtime.ts`、`test/workflow-runtime.test.ts`
  - breakpoint_contracts：not-applicable
  - stacking_context：not-applicable
  - side_effect_scope：task artifact resolution、bootstrap governance output、protocol validation flow
- `BehaviorContract`：
  - object_path：`CURRENT_TASK active ownership + suspended package recovery contract`
  - assertions：
    - `CURRENT_TASK.md` 继续作为唯一 live task identity source of truth
    - `getTaskArchivePath()` 可以保留为 archive-only wrapper，但不能继续承担全部 artifact path contract
    - runtime manifest / install / health report contract 不在任务 003 中变更
    - generated outputs 与 registry 不手改；仅允许按 Conditional Files 通过生成器同步单一 `CURRENT_TASK.md` reference render，如检测到其他 drift，必须停止并重新锁范围
  - verification：`lock-scope` 后以协议 / schema / template / bootstrap / validator / tests 的聚焦回归和全量回归共同验证
- API downstream validation：
  - hook：not-applicable
  - store：not-applicable
  - page：not-applicable
  - widget：not-applicable
  - form：not-applicable
  - table：not-applicable
  - detail view：not-applicable
- `migration_plan_requirement`：
  - required：false
  - trigger_reason：当前任务不允许继续扩大到 runtime manifest / install / health report contract；若实施中发现需要兼容窗口，立即拆后续任务
- `StagedMigrationPlan`：
  - migration_id：not-required
  - phases：not-applicable
  - runtime_state：not-applicable
  - dependencies：follow-up task only if lifecycle runtime skills or runtime report contracts must change
  - verification：not-applicable
  - exit_criteria：not-applicable
- `LinkedRegressionRecord`：
  - regression_chain_id：task-003-current-task-lifecycle-foundation
  - current_issue：首次把 suspend / interrupt / resume 从草案收敛为 protocol/schema/path contract 基础任务
  - prior_fix_refs：`TASK-001-ctx7-skill-gate`、`TASK-002-supersede-current-task-skill`
  - window_scope：current governance task cycle
  - window_size：1
  - count_basis：workflow governance tasks touching `CURRENT_TASK.md` semantics
  - linked_components：`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/CURRENT_TASK.md.tmpl`、`scripts/task-identity.ts`、`scripts/bootstrap-project-governance.ts`、`scripts/workflow-doc-contracts.ts`、`scripts/run-validation.ts`
  - shared_objects：`CURRENT_TASK.md` task identity、task artifact path contract、bootstrap task identity output
  - relation：contract-foundation-before-runtime-skills
  - escalation：not-triggered

### blockers / gate status

- 当前执行步骤：`plan-implementation`
- 已完成 discovery：草案来源核对、`CONTRACTS.md` / `DECISIONS.md` / `STATUS.md` / `.workflow-system/PROJECT_PROFILE.yaml` precedence 核对、关键符号影响面搜索、回滚点核对、Safety mode / Dangerous surfaces / widening 条件锁定、任务决策分类、协议 / schema 优先的实现方案收敛、步骤 6–14 的单步拆解确认，以及步骤 6-12 的协议 / schema / template / task-identity / bootstrap / workflow-doc-contracts / run-validation 实现、只读审查、契约核对与最小回归
- 剩余 blocker：
  - `bun run validate:freshness` 当前报告 `workflow-docs/CURRENT_TASK.md` stale；已由 `/investigate-root-cause` 验证根因为 `templates/docs/CURRENT_TASK.md.tmpl` 字段新增未同步 generated reference render。范围已扩大为单一 Conditional File：`docs/workflow/generated/workflow-docs/CURRENT_TASK.md`。
  - 若实现阶段发现 runtime manifest / install / health report contract、registry 或其他 generated outputs 必须变化，必须停止并拆后续任务。
- `ContractCompatibilityResult`：
  - error_code：none
  - object_path：`CURRENT_TASK lifecycle / artifact path contract`
  - severity：none
  - default_blocker_level：none
  - evidence：当前任务已收敛为 source repo 内的协议 / schema / template / bootstrap / validator / test 合同演进，且不覆盖 `CONTRACTS.md`、不重写 `.workflow-system/PROJECT_PROFILE.yaml`
  - strategy_origin.over_limit_policy_branch：none
  - strategy_origin.divergence_state：no_divergence
  - branch_gate_mapping.merge_gate：已完成 `lock-scope` 与 `classify-decisions`；若实现中触发 runtime、validation-model 或除 Conditional File 外的 generated surface 扩面则立即停下并重回 `/lock-scope`
  - branch_gate_mapping.ship_gate：`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`
  - branch_gate_mapping.rationale：当前任务仍处于单目标、单传播链收敛状态，未命中必须拆分或兼容层迁移的 blocker
  - suggested_resolution：进入 `plan-implementation` 复核本次 Conditional File 同步不改变既有技术路线；若无新增方案风险，再回到 `implement-current-step` 只执行生成器同步和复验

### conformance / verification cases

- 输入场景：任务 003 需要演进 locked protocol / schema source，并扩展 task artifact path contract，但明确禁止顺手改 runtime skill、guide、除 Conditional Files 外的 generated outputs、registry 或 runtime report contract
- discovery evidence：conversation-analysis + source-of-truth docs + impacted symbol search
- 期望 `ContractCompatibilityResult`：scope 保持在协议 / schema / template / bootstrap / validator / tests 内时无 contract blocker；一旦要求 touching runtime 或 generated surfaces，则停止并拆后续任务
- 期望 gate / severity / `strategy_origin`：保持 `frozen-scope` 前提下继续 `implement-current-step`；severity 为 none，`strategy_origin.divergence_state = no_divergence`

## 实施步骤

- [x] 步骤 1：运行 `/review-current-task`，复审任务 003 边界、验收标准、Allowed / Conditional / Forbidden Files、Change Propagation Check 和回滚点。
  - 输入：本 `CURRENT_TASK.md` 初稿、`NEXT_TASK_DRAFT_003_CURRENT_TASK_LIFECYCLE.md`、`CONTRACTS.md`、`STATUS.md`、`DECISIONS.md`。
  - 输出：可执行且边界锁定前一致的任务包。
  - 验证：无待确认问题；handoff 进入 `lock-scope`。
- [x] 步骤 2：运行 `/lock-scope`，锁定协议、schema、template、scripts、tests 的允许范围。
  - 输入：审查后的任务包和 forbidden surfaces。
  - 输出：`## 范围锁定记录`。
  - 验证：未列入 Allowed / Conditional 的文件默认禁止修改，generated outputs 仅允许按 Conditional Files 同步单一 reference render。
- [x] 步骤 3：运行 `/classify-decisions`，把当前任务中的 mechanical / taste / user_challenge 决策分类。
  - 输入：验收标准、已确认决策、传播治理记录。
  - 输出：`## 决策分类`。
  - 验证：taste 决策为空或显式记录；user_challenge 禁止项明确。
- [x] 步骤 4：运行 `/plan-implementation`，形成最终实现方案和验证策略。
  - 输入：协议 / schema / scripts / tests 现状。
  - 输出：收敛后的 `## 实现方案`。
  - 验证：External Documentation Gate 明确为 not triggered 或给出证据；若发现 runtime manifest / install / health report 必须变更，则停止并拆后续任务。
- [x] 步骤 5：运行 `/decompose-task`，把协议、schema、路径、bootstrap / validator、测试拆成小步。
  - 输入：实现方案、Allowed Files、Contract impact。
  - 输出：步骤 6–14 作为按“协议 -> schema -> 实现 -> 验证”顺序排列的细化执行清单。
  - 验证：每步都有输入、输出和验证；不把 generated outputs 纳入实现步骤。
- [x] 步骤 6：更新 `.workflow-system/WORKFLOW_PROTOCOL.md`。
  - 子目标：定义 lifecycle state、transition matrix、review gate、idempotency、partial failure recovery、dual-active protection。
  - 验证：协议文本包含 v1 状态闭集、禁止概念、合法 / 非法迁移和 fail-closed 规则；本轮已完成 `review-diff` clean、`review-implementation` 仅有 nonblocking minor、`verify-contracts` clean、`git diff --check` 通过、`bun run validate:protocol` 通过。
- [x] 步骤 7：更新 `.workflow-system/FILE_SCHEMAS.md`。
  - 子目标：定义 `CURRENT_TASK` lifecycle / resume gate 字段、suspended package 最小字段、closed enums、path contract。
  - 验证：schema 已明确 field display name 与 schema key 映射，定义了 `resume_review_reasons` / `rehydration_status` / `ownership_state` 闭合集合；本轮已完成 `review-diff` clean、`review-implementation` clean、`verify-contracts` clean、`git diff --check` 通过、`bun run validate:protocol` 通过。
- [x] 步骤 8：更新 `templates/docs/CURRENT_TASK.md.tmpl` 与 `test/gen-workflow-docs.test.ts`。
  - 子目标：新增 `生命周期状态`、`恢复需审查`、`恢复审查原因` 默认字段并测试字段存在和顺序稳定。
  - 验证：模板已新增 `生命周期状态：active`、`恢复需审查：false`、空 `恢复审查原因` 默认字段；本轮已完成 `review-diff` clean、`review-implementation` clean、`verify-contracts` clean、`git diff --check` 通过、`bun run validate:protocol` 通过、`bun run test:workflow-docs` 通过。
- [x] 步骤 9：更新 `scripts/task-identity.ts` 与 `test/task-identity.test.ts`。
  - 子目标：分离 identity completeness、workflow status、lifecycle state、ownership status、artifact kind、path resolver 和 tuple named errors。
  - 验证：已新增 `CurrentTaskWorkflowStatus`、`TaskLifecycleState`、`CurrentTaskOwnershipStatus`、`TaskArtifactKind`、统一 artifact path resolver、合法 tuple 校验与 named errors、resume gate 规范化 / drift helper；本轮已完成 `review-diff` clean、`review-implementation` clean、`verify-contracts` clean、`git diff --check` 通过、`bun run validate:protocol` 通过、`bun run test:task-identity` 通过。
- [x] 步骤 10：更新 `scripts/bootstrap-project-governance.ts` 与 `test/bootstrap-project-governance.test.ts`。
  - 子目标：把 `BootstrapTaskIdentityPlan` 从单一 `archive_path_pattern` 升级为 artifact path mapping，并记录 output impact assessment。
  - 验证：已把 bootstrap task identity output 升级为 `artifact_paths` 映射结构，新增 source-repo governance output impact assessment；本轮已完成 `review-diff` clean、`review-implementation` clean、`verify-contracts` clean、`git diff --check` 通过、`git diff --cached --check` 通过、`bun run test:bootstrap-governance` 通过、`bun run validate:protocol` 通过；当前实现未触碰 runtime report / manifest / install contract。
- [x] 步骤 11：更新 `scripts/workflow-doc-contracts.ts` 与相关测试。
  - 子目标：识别并校验 suspended package path / structure，且不把 suspended package 纳入 governance catalog 常驻文档。
  - 验证：已新增 suspended package path parser / validator、path template helper 与结构校验；`test/gen-workflow-docs.test.ts` 已覆盖合法 path、stray artifact、非法 `paused_blocked` package 和缺失恢复证据的 `interrupted` package；本轮已完成 `review-diff` clean、`review-implementation` clean、`verify-contracts` clean、`git diff --check` 通过、`git diff --cached --check` 通过、`bun run test:workflow-docs` 通过、`bun run validate:protocol` 通过。
- [x] 步骤 12：更新 `scripts/run-validation.ts` 与 `test/run-validation.test.ts`。
  - 子目标：接入 `suspended-task-package-validation` protocol-level synthesized check，blocker level 为 `blocks-merge`。
  - 验证：已在 `scripts/run-validation.ts` 接入 `suspended-task-package-validation` synthesized check，并在 `test/run-validation.test.ts` 覆盖无 package 通过、stray artifact 失败、非法 `paused_blocked` package 失败；`git diff --check` 通过，`bun test test/run-validation.test.ts --test-name-pattern "run-validation"` 通过，`bun run validate:protocol` 通过。
- [ ] 步骤 13：运行聚焦测试。
  - 子目标：先验证 task identity、bootstrap、workflow docs 和 run-validation 的关键断言。
  - 验证：先用生成器同步 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 后，运行 `bun run test:workflow-docs`、`bun run test:task-identity`、`bun run test:bootstrap-governance`、`bun run test:run-validation`；失败时只做最小修复，不扩面。
- [ ] 步骤 14：运行全量回归与最终复核。
  - 子目标：确认协议、schema、生成链和 freshness 仍稳定。
  - 验证：`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness` 通过；若 `gen:all` 产生除 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 条件同步以外的 generated diff，停止并回到范围锁定。

## 回归检查项

- [ ] `bun run gen:all`
- [ ] `bun run test:workflow-all`
- [ ] `bun run validate:protocol`
- [ ] `bun run validate:freshness`

## 回滚点

- Task start base: 23f52e85
- Last reviewed checkpoint: not-yet-created
- Current diff review target: working-tree

## 执行记录

- 2026-05-25：按 `/create-current-task` 从 `docs/workflow/NEXT_TASK_DRAFT_003_CURRENT_TASK_LIFECYCLE.md` 生成任务 003 的 `CURRENT_TASK.md` 初稿；本步只写入 `docs/workflow/CURRENT_TASK.md`，未进入实现，下一步 handoff 为 `/review-current-task`。
- 2026-05-25：执行 `/review-current-task`；已读取草案来源、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` 与 `.workflow-system/PROJECT_PROFILE.yaml`，确认任务仍为单一主目标、无待确认口味决策、回滚点三字段齐备，并补齐结构化传播治理记录；下一步 handoff 更新为 `/lock-scope`。
- 2026-05-25：执行 `/lock-scope`；维持最小 Allowed Files，不新增 Conditional Files，补充 `Safety mode = frozen-scope`、`Dangerous surfaces` 与 `Unlock / widening conditions`，并把 `docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`scripts/validation-model.ts`、`test/validation-model.test.ts` 等潜在漂移面显式列入 Forbidden Files；下一步 handoff 更新为 `/classify-decisions`。
- 2026-05-25：执行 `/classify-decisions`；已把当前任务中的协议闭集、schema / path contract 对齐和 validator 接入归为 Mechanical，把所有 runtime / generated / catalog / ctx7 入口扩面约束归为 User challenge，并确认当前任务不存在待用户确认的 Taste 决策；下一步 handoff 更新为 `/plan-implementation`。
- 2026-05-25：执行 `/plan-implementation`；已把方案收敛为 protocol-first、schema-first、implementation wiring、validation closure 的最小路径，补充 `Handoff = decompose-task`，并明确若实现中触发 `validation-model`、runtime 或 generated surface 扩面则必须回到 `/lock-scope`；下一步 handoff 更新为 `/decompose-task`。
- 2026-05-25：执行 `/decompose-task`；确认现有步骤 6–14 已按“协议 -> schema -> 实现 -> 验证”顺序形成独立、可验证的小步，不再混入 runtime、generated outputs 或其他范围外工作；下一步 handoff 更新为 `/implement-current-step`。
- 2026-05-25：执行 `/implement-current-step` 的步骤 6；已在 `.workflow-system/WORKFLOW_PROTOCOL.md` 的 `3.4 Task identity contract` 下新增 workflow status / lifecycle state、artifact homes / active ownership、allowed transitions / resume gate、fail-closed idempotence / recovery 规则，并通过 `bun run validate:protocol` 完成最小校验；当前 handoff 保持 `/implement-current-step`，下一子目标为步骤 7。
- 2026-05-25：执行步骤 6 后的 `/review-diff`；diff review target 为 `working-tree`，变更文件仅为 `.workflow-system/WORKFLOW_PROTOCOL.md` 与 `docs/workflow/CURRENT_TASK.md`，均在 Allowed Files 内；未触碰 Forbidden / Conditional Files、runtime、generated outputs、registry、catalog、CI/CD、deployment、database、monitoring 或 benchmark surfaces；结论为 clean，handoff 到 `/review-implementation`。
- 2026-05-25：执行步骤 6 后的 `/review-implementation`；沿用 `working-tree` target，确认协议变更满足步骤 6 子目标，未发现 critical / major 问题；记录 RI-001 为 nonblocking minor 文档格式风险，External Documentation Gate 未触发。
- 2026-05-25：执行步骤 6 后的 `/verify-contracts`；沿用 `working-tree` target，确认未破坏 source repo CLI contract、runtime install/sync contract、generated-only 边界、source/target 隔离或架构依赖方向，且不需要修改 `CONTRACTS.md` 解释当前改动。
- 2026-05-25：执行步骤 6 后的 `/run-regression`；QA mode 为 `diff-aware`，target 为 `working-tree`；`git diff --check` 通过，`bun run validate:protocol` 通过，未执行 UI / visual / browser / release 验证（not applicable），步骤 6 本轮验证通过；下一步继续 `/implement-current-step` 的步骤 7。
- 2026-05-25：执行 `/sync-current-task`；已将步骤 6 的审查、契约验证、回归结果与 RI-001 nonblocking minor 记录回写到本任务包；任务级全量回归清单保持未勾选，留待步骤 14。
- 2026-05-25：执行 `/implement-current-step` 的步骤 7；已在 `.workflow-system/FILE_SCHEMAS.md` 的 `CURRENT_TASK.md` 章节下新增生命周期 / 恢复 gate 字段映射、`resume_review_reasons` 闭合集合、suspended package path contract、最小字段和 `rehydration_status` / `ownership_state` 闭合集合，并通过 `bun run validate:protocol` 完成最小校验；当前 handoff 保持 `/implement-current-step`，下一子目标为步骤 8。
- 2026-05-25：执行步骤 7 后的 `/review-diff`；沿用 `working-tree` target，变更文件为 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 与 `docs/workflow/CURRENT_TASK.md`，均在 Allowed Files 内；未触碰 Forbidden / Conditional Files、runtime、generated outputs、registry、catalog、CI/CD、deployment、database、monitoring 或 benchmark surfaces；结论为 clean，handoff 到 `/review-implementation`。
- 2026-05-25：执行步骤 7 后的 `/review-implementation`；沿用 `working-tree` target，确认 schema 变更满足步骤 7 子目标，未发现 critical / major 问题；当前步 External Documentation Gate 未触发。
- 2026-05-25：执行步骤 7 后的 `/verify-contracts`；沿用 `working-tree` target，确认未破坏 source repo CLI contract、runtime install/sync contract、generated-only 边界、source/target 隔离、目录职责或架构依赖方向，且不需要修改 `CONTRACTS.md` 解释当前改动。
- 2026-05-25：执行步骤 7 后的 `/run-regression`；QA mode 为 `diff-aware`，target 为 `working-tree`；`git diff --check` 通过，`bun run validate:protocol` 通过，protocol-level validation 与相关测试闭环全部 passed，未执行 UI / visual / browser / release 验证（not applicable），步骤 7 本轮验证通过；下一步继续 `/implement-current-step` 的步骤 8。
- 2026-05-25：执行 `/sync-current-task`；已将步骤 7 的只读审查、契约验证和 diff-aware 回归结果回写到本任务包；当前 handoff 继续保持 `/implement-current-step`，下一子目标仍为步骤 8。
- 2026-05-25：执行 `/implement-current-step` 的步骤 8；已在 `templates/docs/CURRENT_TASK.md.tmpl` 的 `## 任务信息` 中新增 `生命周期状态：active`、`恢复需审查：false`、空 `恢复审查原因` 默认字段，并在 `test/gen-workflow-docs.test.ts` 中补充模板字段存在与顺序稳定断言；通过 `bun run test:workflow-docs` 完成最小校验；当前 handoff 保持 `/implement-current-step`，下一子目标为步骤 9。
- 2026-05-25：执行步骤 8 后的 `/review-diff`；沿用 `working-tree` target，变更文件为 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/CURRENT_TASK.md.tmpl`、`test/gen-workflow-docs.test.ts` 与 `docs/workflow/CURRENT_TASK.md`，均在 Allowed Files 内；未触碰 Forbidden / Conditional Files、runtime、generated outputs、registry、catalog、CI/CD、deployment、database、monitoring 或 benchmark surfaces；结论为 clean，handoff 到 `/review-implementation`。
- 2026-05-25：执行步骤 8 后的 `/review-implementation`；沿用 `working-tree` target，确认模板与测试变更满足步骤 8 子目标，未发现 critical / major 问题；当前步 External Documentation Gate 未触发。
- 2026-05-25：执行步骤 8 后的 `/verify-contracts`；沿用 `working-tree` target，确认未破坏 source repo CLI contract、runtime install/sync contract、generated-only 边界、source/target 隔离、目录职责或架构依赖方向，且不需要修改 `CONTRACTS.md` 解释当前改动。
- 2026-05-25：执行步骤 8 后的 `/run-regression`；QA mode 为 `diff-aware`，target 为 `working-tree`；`git diff --check` 通过，`bun run validate:protocol` 通过，`bun run test:workflow-docs` 通过；protocol-level validation 与 workflow docs 测试闭环均 passed，未执行 UI / visual / browser / release 验证（not applicable），步骤 8 本轮验证通过；下一步继续 `/implement-current-step` 的步骤 9。
- 2026-05-25：执行 `/sync-current-task`；已将步骤 8 的只读审查、契约验证和 diff-aware 回归结果回写到本任务包；当前 handoff 继续保持 `/implement-current-step`，下一子目标仍为步骤 9。
- 2026-05-25：执行 `/implement-current-step` 的步骤 9；已在 `scripts/task-identity.ts` 中保留 `TaskIdentityStatus` 的 identity completeness 职责，并新增 `CurrentTaskWorkflowStatus`、`TaskLifecycleState`、`CurrentTaskOwnershipStatus`、`TaskArtifactKind`、`getTaskArtifactPath()`、合法 tuple 校验、`CURRENT_TASK_WORKFLOW_STATUS_INVALID` / `CURRENT_TASK_STATUS_TUPLE_INVALID` / `RESUME_GATE_DRIFT` named errors，以及 resume gate 规范化 / drift helper；同时在 `test/task-identity.test.ts` 中补充 archive / paused / interrupted path、合法 tuple、非法 tuple、ownership derivation、resume gate normalization / fail-closed 覆盖；通过 `bun run test:task-identity` 完成最小校验；当前 handoff 保持 `/implement-current-step`，下一子目标为步骤 10。
- 2026-05-25：执行 `/implement-current-step` 的步骤 10；已在 `scripts/bootstrap-project-governance.ts` 中把 `BootstrapTaskIdentityPlan` 从单一 `archive_path_pattern` 升级为 `artifact_paths` 映射结构，materialized identity 现统一暴露 archive / paused / interrupted 三类 artifact path，并新增 source-repo governance output impact assessment，明确 `workflow:manifest`、`workflow:install`、`workflow:health` contract 在本步保持 unchanged；同时在 `test/bootstrap-project-governance.test.ts` 中补充新 shape 与 impact assessment 断言；`git diff --check` 通过，`bun run test:bootstrap-governance` 通过，`bun run validate:protocol` 通过；当前 handoff 保持 `/implement-current-step`，下一子目标为步骤 11。
- 2026-05-25：执行 `/implement-current-step` 的步骤 11；已在 `scripts/workflow-doc-contracts.ts` 中新增 suspended package path parser、path template helper 与 package structure validator，复用 `task-identity.ts` 的 lifecycle / resume gate 闭合集合校验，并确保 suspended package 仍被视为 task artifact 而不是 governance catalog 常驻文档；同时在 `test/gen-workflow-docs.test.ts` 中补充合法 path、stray artifact、非法 `paused_blocked` package 和缺失恢复证据的 `interrupted` package 断言；`git diff --check` 通过，`bun run test:workflow-docs` 通过，`bun run validate:protocol` 通过；当前 handoff 保持 `/implement-current-step`，下一子目标为步骤 12。
- 2026-05-26：执行 `/implement-current-step` 的步骤 12；已在 `scripts/run-validation.ts` 中接入 `suspended-task-package-validation` protocol-level synthesized check，扫描 `TASKS/paused/**` 与 `TASKS/interrupted/**` 并对 stray artifact 与非法 suspended package 执行 fail-closed；同时在 `test/run-validation.test.ts` 中补充无 package 通过、stray artifact 失败和非法 `paused_blocked` package 失败的 validation-flow 断言；`git diff --check` 通过，`bun test test/run-validation.test.ts --test-name-pattern "run-validation"` 通过，`bun run validate:protocol` 通过；当前 handoff 保持 `/implement-current-step`，下一子目标为步骤 13。
- 2026-05-25：执行步骤 9 后的 `/review-diff`；沿用 `working-tree` target，变更文件均在 Allowed Files 内；未触碰 Forbidden / Conditional Files、runtime、generated outputs、registry、catalog、CI/CD、deployment、database、monitoring 或 benchmark surfaces；结论为 clean，handoff 到 `/review-implementation`。
- 2026-05-25：执行步骤 9 后的 `/review-implementation`；沿用 `working-tree` target，确认 task identity helper 与测试满足步骤 9 子目标，未发现 critical / major 问题；External Documentation Gate 未触发。
- 2026-05-25：执行步骤 9 后的 `/verify-contracts`；沿用 `working-tree` target，确认 `getTaskArchivePath()` 旧签名和返回路径保持兼容，新增导出属于扩展；未破坏 source repo CLI contract、runtime install/sync contract、generated-only 边界、source/target 隔离、目录职责或架构依赖方向，且不需要修改 `CONTRACTS.md` 解释当前改动。
- 2026-05-25：执行步骤 9 后的 `/run-regression`；QA mode 为 `diff-aware`，target 为 `working-tree`；`git diff --check` 通过，`git diff --cached --check` 通过，`bun run validate:protocol` 通过，`bun run test:task-identity` 通过；未执行 UI / visual / browser / release 验证（not applicable），步骤 9 本轮验证通过；下一步继续 `/implement-current-step` 的步骤 10。
- 2026-05-25：执行 `/sync-current-task`；已将步骤 9 的只读审查、契约验证和 diff-aware 回归结果回写到本任务包；任务级全量回归清单保持未勾选，留待步骤 14；当前 handoff 继续保持 `/implement-current-step`，下一子目标为步骤 10。
- 2026-05-25：执行步骤 10 后的 `/review-diff`；沿用 `working-tree` target，变更文件均在 Allowed Files 内；未触碰 Forbidden / Conditional Files、runtime、generated outputs、registry、catalog、CI/CD、deployment、database、monitoring 或 benchmark surfaces；结论为 clean，handoff 到 `/review-implementation`。
- 2026-05-25：执行步骤 10 后的 `/review-implementation`；沿用 `working-tree` target，确认 bootstrap governance output 已按 artifact path mapping 与 source-repo governance output impact assessment 落地，未发现 critical / major 问题；External Documentation Gate 未触发，残余风险仅为 `formatBootstrapPlan` 文本输出未单独断言，不阻塞。
- 2026-05-25：执行步骤 10 后的 `/verify-contracts`；沿用 `working-tree` target，确认 `BootstrapTaskIdentityPlan.archive_path_pattern` 到 `artifact_paths` 的输出形状变更属于当前任务授权的 source-repo governance output change，`getTaskArchivePath()` 兼容 wrapper 仍保留，未破坏 runtime manifest / install / health report、generated-only 边界、source/target 隔离、目录职责或架构依赖方向，且不需要修改 `CONTRACTS.md` 解释当前改动。
- 2026-05-25：执行步骤 10 后的 `/run-regression`；QA mode 为 `diff-aware`，target 为 `working-tree`；`git diff --check` 通过，`git diff --cached --check` 通过，`bun run test:bootstrap-governance` 通过（9 pass / 0 fail / 80 expect），`bun run validate:protocol` 通过；未执行 UI / visual / browser / release 验证（not applicable），步骤 10 本轮验证通过；下一步继续 `/implement-current-step` 的步骤 11。
- 2026-05-25：执行 `/sync-current-task`；已将步骤 10 的只读审查、契约验证和 diff-aware 回归结果回写到本任务包；任务级全量回归清单保持未勾选，留待步骤 14；当前 handoff 继续保持 `/implement-current-step`，下一子目标为步骤 11。
- 2026-05-26：执行步骤 11 后的 `/review-diff`；沿用 `working-tree` target，变更文件均在 Allowed Files 内；未触碰 Forbidden / Conditional Files、runtime、generated outputs、registry、catalog、CI/CD、deployment、database、monitoring 或 benchmark surfaces；结论为 clean，handoff 到 `/review-implementation`。
- 2026-05-26：执行步骤 11 后的 `/review-implementation`；沿用 `working-tree` target，确认 suspended package path parser / validator / structure validator 满足步骤 11 子目标，未发现 critical / major 问题；External Documentation Gate 未触发，helper 级校验接入 protocol-level synthesized check 留待步骤 12。
- 2026-05-26：执行步骤 11 后的 `/verify-contracts`；沿用 `working-tree` target，确认新增 suspended package helper 导出属于授权扩展，未破坏 source repo CLI contract、runtime install/sync contract、runtime manifest / install / health report、generated-only 边界、source/target 隔离、目录职责或架构依赖方向，且不需要修改 `CONTRACTS.md` 解释当前改动。
- 2026-05-26：执行步骤 11 后的 `/run-regression`；QA mode 为 `diff-aware`，target 为 `working-tree`；`git diff --check` 通过，`git diff --cached --check` 通过，`bun run test:workflow-docs` 通过（21 pass / 0 fail / 255 expect），`bun run validate:protocol` 通过；未执行 UI / visual / browser / release 验证（not applicable），步骤 11 本轮验证通过；下一步继续 `/implement-current-step` 的步骤 12。
- 2026-05-26：执行 `/sync-current-task`；已将步骤 11 的只读审查、契约验证和 diff-aware 回归结果回写到本任务包；任务级全量回归清单保持未勾选，留待步骤 14；当前 handoff 继续保持 `/implement-current-step`，下一子目标为步骤 12。
- 2026-05-26：执行 `/lock-scope`；根据 `/run-regression` 与 `/investigate-root-cause` 证据，确认 freshness failure 根因为 `templates/docs/CURRENT_TASK.md.tmpl` 已新增 lifecycle / resume gate 字段但 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 尚未同步；已将该单一 generated reference render 改为 Conditional File，要求只能由 `bun run gen:workflow-docs` 或 `bun run gen:all` 生成，且 diff 只能同步对应三个模板字段；其他 generated outputs、registry、runtime、validation-model 和 catalog surfaces 继续禁止。当前 handoff 更新为 `/classify-decisions`。
- 2026-05-26：执行 `/classify-decisions`；确认 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 的条件同步是由模板字段已变更但 reference render 未同步导致的 mechanical freshness reconciliation，不属于 Taste 决策；同时把“不得扩展到其他 generated outputs / registry / runtime / validation-model / catalog surfaces”继续保留为 User challenge。当前 handoff 更新为 `/plan-implementation`。
