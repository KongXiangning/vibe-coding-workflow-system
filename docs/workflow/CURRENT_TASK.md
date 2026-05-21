# CURRENT_TASK.md

## 任务信息

- 任务 ID：002
- 任务标题：新增 supersede-current-task skill
- 任务 slug：supersede-current-task-skill
- 当前状态：archived
- 当前 handoff：create-current-task

## 背景与上下文

- 当前没有实现层 diff；上一轮越过 `create-current-task` 的实现改动已先回滚。
- 用户提出需要新增 `supersede-current-task`：当 `CURRENT_TASK.md` 尚未完成，但实施中发现原任务目标、范围锁或验收标准失效，需要用新的任务包替代当前任务。
- 该 skill 的关键不是“写新计划”，而是防止旧冻结任务包被非法续命。
- 期望流程位置：`execute-current-task / implement-current-step` 发现 scope invalidation 后，进入 `supersede-current-task`，再回到 `review-current-task -> lock-scope -> plan-implementation`。

## 验收标准

- `supersede-current-task` 作为新增 workflow skill 被定义在模板源中，而不是只手工写 generated output。
- skill 触发条件覆盖：`CURRENT_TASK.md` 尚未完成，但原任务目标、范围锁或验收标准失效，需要替代当前任务包。
- skill 职责覆盖：
  - 读取旧 `CURRENT_TASK.md`、`STATUS.md`、`DECISIONS.md`、`CONTRACTS.md`。
  - 判断是否真的是 scope invalidation，而不是普通新增步骤。
  - 记录旧任务状态为 `superseded` / `blocked_by_replan`。
  - 保留旧任务发现、未完成项和 partial diff 归属。
  - 生成或重写新的 `CURRENT_TASK.md`。
  - 重新定义 Allowed / Conditional / Forbidden Files。
  - 要求后续重新进入 `lock-scope`，不得直接实现。
- registry / generated reference outputs 通过生成器更新，不手工编辑。
- `templates/docs/WORKFLOW_GUIDE.md.tmpl` 同步体现新增 skill 的使用时机和标准流程位置。
- 新增或更新测试能够证明新增 skill 被生成、注册、排序和 handoff 校验覆盖。
- 回归至少覆盖：`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`。

## 允许修改范围

Allowed Files:

- `templates/skills/supersede-current-task.SKILL.md.tmpl`
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- `scripts/gen-registry.ts`
- `test/gen-workflow-skills.test.ts`
- `test/gen-registry.test.ts`
- `docs/workflow/CURRENT_TASK.md`

Conditional Files:

- `docs/workflow/generated/workflow-skills/**`：仅当运行 `bun run gen:all` 或等价 generator 命令后产生同步输出时允许。
- `docs/workflow/SKILL_REGISTRY.md`：仅当 registry generator 因新增 skill 产生同步输出时允许。
- `docs/workflow/generated/workflow-docs/**`：仅当 `bun run gen:all` 因当前生成链路要求重渲染时允许；不得手工编辑。
- `test/gen-workflow-docs.test.ts`：仅当 `WORKFLOW_GUIDE` 断言必须随新增 skill 更新时允许。

## 禁止修改范围

Forbidden Files:

- `.workflow-system/PROJECT_PROFILE.yaml`
- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/FILE_SCHEMAS.md`
- `templates/docs/**` 中除 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 外的文件
- `scripts/workflow-runtime.ts`
- `scripts/gen-workflow-skills.ts`
- `docs/workflow/CONTRACTS.md`
- `docs/workflow/DECISIONS.md`
- `docs/workflow/STATUS.md`
- `dist/**`
- `.git/**`
- `node_modules/**`

## 受影响的契约

- 触碰 workflow skill template set：新增一个 runtime skill 模板。
- 触碰 generated reference outputs：必须通过 generator 更新，不能手改。
- 触碰 registry 顺序：`scripts/gen-registry.ts` 目前使用显式 `WORKFLOW_ORDER`，新增 skill 需要显式纳入。
- 触碰 workflow 使用指南：`.workflow-system/FILE_SCHEMAS.md` 规定新增、删除或重命名 workflow skill 时更新 `WORKFLOW_GUIDE.md`。
- 不计划改变 `.workflow-system/WORKFLOW_PROTOCOL.md` 或 `.workflow-system/FILE_SCHEMAS.md`。

## 已确认决策

- 新 skill 名称：`supersede-current-task`。
- 新 skill 是治理状态转换 skill，不是实现规划 skill。
- 成功 handoff 应回到 `review-current-task`；后续重新进入 `lock-scope`，不得直接实现替代任务。

## 决策分类

Mechanical:

- 新增 `templates/skills/supersede-current-task.SKILL.md.tmpl`，按现有 workflow skill 模板结构补齐 frontmatter、Required Reads、Must Check、Stop Conditions、Execution Protocol 和 Output Contract。
- 在 `scripts/gen-registry.ts` 的显式 `WORKFLOW_ORDER` 中加入 `supersede-current-task`，并将其列入高风险审计 skill。
- 在 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 中补充新增 skill 的使用时机、标准流程位置或异常处理路径。
- 根据生成器输出同步 `docs/workflow/generated/workflow-skills/**`、`docs/workflow/generated/workflow-docs/**` 和 `docs/workflow/SKILL_REGISTRY.md`，且只能通过 generator 写入。
- 在 `test/gen-workflow-skills.test.ts`、`test/gen-registry.test.ts` 或必要时 `test/gen-workflow-docs.test.ts` 中补充聚焦断言。
- 运行任务列出的 generator、测试、protocol 和 freshness 验证。

Taste:

- 无。当前任务不涉及视觉、交互、文案风格或产品口味选择。

User challenge:

- 不得把 `supersede-current-task` 做成实现规划 skill；它必须保持治理状态转换职责。
- 不得让替代任务直接进入实现；成功路径必须回到 `review-current-task`，后续重新进入 `lock-scope`。
- 不得修改 `.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`CONTRACTS.md`、`DECISIONS.md` 或 `STATUS.md`。
- 不得手工编辑 generated reference outputs 或 `docs/workflow/SKILL_REGISTRY.md`。
- 不得改变既有决策：`create-current-task` 不是 ctx7 主查询入口；source repo 禁止 `workflow:install --root .`；source repo quality gates 不复用 target-project validation slots。

需要用户确认的决策:

- 无。

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
- Rollback / recovery: revert task diff or regenerate outputs from previous templates
- Release evidence: local command output

## 实现方案

- Goal: create a dedicated `supersede-current-task` workflow skill that safely replaces an unfinished active task package when scope invalidation is discovered.
- Architecture impact: additive change to the runtime workflow skill set. Source inputs affected are one new skill template, registry ordering metadata, workflow guide usage text, and focused generator tests. Generated workflow skills/docs/registry are derived outputs only. No protocol/schema/profile/contract/decision updates are planned.
- Technical approach:
  - Add `templates/skills/supersede-current-task.SKILL.md.tmpl` using the existing workflow skill template conventions and required frontmatter fields.
  - Define the skill as a phase-1 task-package replacement gate: it writes only `CURRENT_TASK.md`, preserves old-task invalidation evidence, classifies partial diff ownership, and hands off to `review-current-task`.
  - Register it in `scripts/gen-registry.ts` between `create-current-task` and `review-current-task`, and mark it high-risk because it can rewrite the active task package.
  - Update `templates/docs/WORKFLOW_GUIDE.md.tmpl` in the minimal relevant places: Skill 速查, standard flow / exception routing, and flow diagram if needed.
  - Reuse the existing focused tests where they already cover the new skill; the current regression evidence shows `test:workflow-skills` and `test:workflow-docs` already pass without test edits, so the minimal repair path is to close the generated-output sync gap before widening test changes.
  - Treat the current `test:registry` failure as a generated-output closure issue: run `bun run gen:all` to regenerate `docs/workflow/SKILL_REGISTRY.md` and related generated workflow references from templates/scripts, then rerun the registry and full workflow validations.
- Alternatives considered:
  - Fold behavior into `review-current-task`: rejected because replacing an unfinished task requires explicit old-task status, invalidation evidence, and partial diff ownership semantics.
  - Add protocol/schema changes first: rejected for this task because the change is additive at the skill/template/guide level and does not require new document fields or public DTOs.
  - Only document the behavior in `WORKFLOW_GUIDE`: rejected because agents need an executable skill contract with reads/writes/handoff and stop conditions.
  - Hand-edit `docs/workflow/SKILL_REGISTRY.md` or generated workflow skills/docs: rejected because generated reference outputs are locked generated-only surfaces and must be produced by generators.
  - Relax `test:registry` so it ignores the stale checked-in registry: rejected because that would hide an incomplete propagation chain instead of closing it.
- Data / state flow:
  - Normal path: implementation/review/regression detects scope invalidation -> `supersede-current-task` reads old active task and baselines -> rewrites `CURRENT_TASK.md` as replacement package with supersede record -> `review-current-task` validates -> `lock-scope` relocks.
  - Generation path: templates/scripts -> `bun run gen:all` -> `docs/workflow/generated/**` and `docs/workflow/SKILL_REGISTRY.md` -> freshness validation.
- Compatibility: backward-compatible additive workflow skill. Existing task creation, review, lock, implementation, regression, and archive skills keep their current handoffs unless the new skill is explicitly invoked for scope invalidation.
- Risks and rollback:
  - Registry order is strict; missing `WORKFLOW_ORDER` update causes generator/test failure.
  - Until generated outputs are regenerated, `test:registry` will keep failing because the checked-in `docs/workflow/SKILL_REGISTRY.md` still reflects 31 skills while the template set now contains 32.
  - Generated outputs must not be hand-edited; rollback is to revert template/script/test changes and rerun generators.
  - Over-broad guide edits could drift into methodology/product docs; keep updates limited to usage/routing.
  - If implementation discovers a required protocol/schema change, stop and return to `lock-scope` rather than expanding in place.
- Validation strategy:
  - `bun run gen:all`
  - `bun run test:registry`
  - `bun run test:workflow-skills`
  - `bun run test:workflow-docs` if `WORKFLOW_GUIDE` assertions are changed
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
- External Documentation Gate: not triggered. This plan depends only on repository-local workflow templates, generator scripts, tests, and governance docs; no third-party library/framework/SDK/API/CLI/cloud-service current behavior affects correctness.
- Open decisions: none.

## 审查问题队列

- Finding ID: RDF-001
  - Severity: P1
  - Source: `review-diff` (`diff_review_target: working-tree`)
  - Status: resolved
  - File / symbol: `docs/workflow/generated/workflow-skills/supersede-current-task.SKILL.md`
  - Failure scenario: 当前 working tree 已出现 generated workflow skill 输出，但执行记录里尚未记录步骤 12 的 `bun run gen:all` 或等价 generator 同步证据；因此这个 Conditional File 变更目前无法证明满足“仅当运行 generator 后产生同步输出时允许”的条件。
  - Minimal fix direction: 用 generator 完成步骤 12，同步 `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md`，或在步骤 12 前移除这个 stray generated file；不得手工编辑 generated output。
  - Required test: 重新执行 `/review-diff`，并在生成后运行 `bun run gen:all`、`bun run test:registry`、`bun run validate:freshness`
  - Handoff: `implement-current-step`
  - Validation result: 已执行 `bun run gen:all`，生成并同步 `docs/workflow/generated/workflow-skills/**`、`docs/workflow/generated/workflow-docs/**` 与 `docs/workflow/SKILL_REGISTRY.md`；后续仍需重新运行 `/review-diff` 关闭审查链。

## 传播治理记录

- Change Propagation Check: triggered for workflow skill registry, workflow guide, and generated reference outputs; not triggered for public API/schema/DTO/event.
- Compatibility strategy: backward-compatible additive change.
- Required contract updates: none planned.
- Required generated outputs: workflow skills, workflow docs, and registry must be regenerated from templates/scripts only.

## 范围锁定记录

- Safety mode: frozen-scope
- Safety mode rationale: 本任务只允许修改新增 workflow skill 所需的模板、registry 顺序、使用指南、聚焦测试和 generator 派生输出；不涉及生产、部署、数据库、权限、认证、支付、迁移、批量删除、force push 或历史重写。
- Locked scope source: `docs/workflow/CURRENT_TASK.md` 的 Allowed Files / Conditional Files / Forbidden Files。
- Locked contracts:
  - `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md` 只能由生成器写入。
  - 结构变更必须从协议/schema/templates/generator 开始，不得从 generated outputs 反向维护规范。
  - `.workflow-system/PROJECT_PROFILE.yaml` 不得为本任务改写。
- Dangerous surfaces:
  - production: not touched
  - database: not touched
  - permissions/authentication/payments: not touched
  - deployment/rollback/CI/CD/monitoring/performance baseline: not touched
  - bulk delete/migration/force push/history rewrite: not touched
- Unlock / widening conditions:
  - 默认不允许扩大范围；未列入 Allowed Files 且不满足 Conditional Files 条件的文件均视为 Forbidden。
  - 若实现发现必须修改 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/**` 中除 `WORKFLOW_GUIDE.md.tmpl` 外的文件、`scripts/gen-workflow-skills.ts`、`scripts/workflow-runtime.ts`、`CONTRACTS.md`、`DECISIONS.md` 或 `STATUS.md`，必须停止并重新执行 `lock-scope`。
  - 扩大范围时必须记录原因、影响文件、风险和验证方式，并重新生成 Allowed Files / Conditional Files / Forbidden Files。
  - 触发危险命令、部署、数据库或 CI/CD 配置变更时必须升级为 guarded，并重新确认 dangerous command gate。

## 实施步骤

- [x] 步骤 1：运行 `/review-current-task`，审查本任务目标、验收标准、Allowed / Conditional / Forbidden Files 是否完整。
  - 输入：`CURRENT_TASK.md` 初稿、用户需求、source repo 治理边界。
  - 输出：收敛后的任务包边界与验收标准。
  - 验证：Allowed / Conditional / Forbidden Files 完整，待确认问题清空，handoff 保持在治理链路内。
- [x] 步骤 2：运行 `/lock-scope`，锁定新增 skill、registry、guide、测试和 generated outputs 的可修改范围。
  - 输入：审查后的任务包、危险面清单、source repo 合同边界。
  - 输出：`## 范围锁定记录`。
  - 验证：Safety mode 为 `frozen-scope`，未列入 Allowed / Conditional 的文件默认禁止修改。
- [x] 步骤 3：运行 `/classify-decisions`，明确 mechanical / taste / user_challenge 约束。
  - 输入：验收标准、方案边界、已确认决策。
  - 输出：`## 决策分类`。
  - 验证：无待确认 taste 项，user_challenge 禁止项已显式列出。
- [x] 步骤 4：运行 `/plan-implementation`，形成可执行的实现方案与验证策略。
  - 输入：`CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/DECISIONS.md`、`docs/workflow/CONTRACTS.md`。
  - 输出：`## 实现方案`、`## 传播治理记录`。
  - 验证：已明确 architecture impact、technical approach、validation strategy，且 External Documentation Gate 未触发。
- [x] 步骤 5：运行 `/decompose-task`，把实现拆成一轮一验的小步并指定建议执行顺序。
  - 输入：已确认的实现方案、范围锁定、决策分类、项目 profile。
  - 输出：本实施步骤清单。
  - 验证：每步都有明确输入、输出和验证方式；当前无 UI / 视觉步骤；未把模板、registry、guide、测试和生成回归混成同一步。
- [x] 步骤 6：运行 `/implement-current-step`，新增 `templates/skills/supersede-current-task.SKILL.md.tmpl`。
  - 子目标：落地新的治理状态转换 skill，覆盖 scope invalidation 判定、旧任务状态记录、partial diff 归属和成功 handoff 到 `review-current-task`。
  - 输入：`## 实现方案`、`## 已确认决策`、Allowed Files 边界、现有 skill 模板写法。
  - 输出：新增 `templates/skills/supersede-current-task.SKILL.md.tmpl` 与执行记录。
  - 验证：模板 frontmatter 与正文可检索到 `reads` 包含 `CURRENT_TASK.md`、`STATUS.md`、`DECISIONS.md`、`CONTRACTS.md`，`writes` 仅含 `CURRENT_TASK.md`，并声明成功 handoff 为 `review-current-task`、失败 handoff 为 `ask-user`。
- [x] 步骤 7：运行 `/implement-current-step`，更新 `scripts/gen-registry.ts` 的显式注册顺序与高风险审计集合。
  - 子目标：把 `supersede-current-task` 放到 `create-current-task` 之后、`review-current-task` 之前，并保留其高风险治理语义。
  - 输入：步骤 6 的新 skill 名称与顺序要求、当前 registry 实现。
  - 输出：`scripts/gen-registry.ts` 变更与执行记录。
  - 验证：显式 `WORKFLOW_ORDER` 与高风险 skill 列表均包含 `supersede-current-task`，且排序位置符合实现方案。
- [x] 步骤 8：运行 `/implement-current-step`，更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl`。
  - 子目标：补充新 skill 的适用时机、标准流程位置和 scope invalidation 异常路径。
  - 输入：步骤 6-7 的行为语义、现有 guide 结构。
  - 输出：`templates/docs/WORKFLOW_GUIDE.md.tmpl` 变更与执行记录。
  - 验证：guide 至少在 skill 速查或流程路由位置可检索到 `supersede-current-task`，并明确其后续回到 `review-current-task -> lock-scope -> plan-implementation`，不得直接实现。
- [x] 步骤 9：运行 `/implement-current-step`，更新 `test/gen-workflow-skills.test.ts`。
  - 子目标：证明新 skill 会被生成，且生成结果保留 reads / writes / handoff / scope invalidation 语义。
  - 输入：步骤 6 的模板内容、现有 workflow skills 测试模式。
  - 输出：`test/gen-workflow-skills.test.ts` 变更与执行记录。
  - 验证：新增断言覆盖 `supersede-current-task` 的存在性、关键 frontmatter 字段和治理职责，而不是仅断言字符串存在。
- [x] 步骤 10：运行 `/implement-current-step`，更新 `test/gen-registry.test.ts`。
  - 子目标：证明 registry 生成结果包含新 skill、排序正确、风险标记正确。
  - 输入：步骤 7 的 registry 变更、现有 registry 测试模式。
  - 输出：`test/gen-registry.test.ts` 变更与执行记录。
  - 验证：新增断言覆盖 skill 注册、排序位置和高风险分类。
- [x] 步骤 11：仅当 `WORKFLOW_GUIDE` 现有断言无法覆盖新增 skill 路由时，运行 `/implement-current-step` 更新 `test/gen-workflow-docs.test.ts`。
  - 子目标：仅在条件文件触发时补最小 guide 生成断言，避免无必要扩围。
  - 输入：步骤 8 的 guide 变更、现有 workflow docs 测试覆盖情况。
  - 输出：必要时修改 `test/gen-workflow-docs.test.ts`，否则在执行记录中记录跳过原因。
  - 验证：若执行本步，则断言覆盖新增 skill 的 guide 路由文案；若跳过，本步需记录“现有测试已充分覆盖”的依据。
- [x] 步骤 12：运行 `/implement-current-step`，执行 `bun run gen:all` 生成派生产物。
  - 子目标：只通过生成器更新 `docs/workflow/generated/**`、`docs/workflow/SKILL_REGISTRY.md` 和必要的 generated workflow docs。
  - 输入：步骤 6-11 的模板、脚本与测试变更。
  - 输出：条件允许的 generated outputs 与执行记录。
  - 验证：diff 中的 generated 文件仅来自 generator，且没有手工编辑 `docs/workflow/SKILL_REGISTRY.md`。
- [x] 步骤 13：运行聚焦验证，确认新增 skill 与 registry 变更先局部通过。
  - 子目标：在全量回归前，先验证新增模板与注册表相关测试。
  - 输入：步骤 6-12 的实现结果。
  - 输出：局部验证结果记录。
  - 验证：`bun run test:workflow-skills`、`bun run test:registry` 通过；若步骤 11 执行，则 `bun run test:workflow-docs` 也通过。
- [x] 步骤 14：运行 `/review-diff`、`/review-implementation`、`/verify-contracts`、`/run-regression` 完成最终复核。
  - 子目标：确认 diff 不越界、契约未破坏、生成链和 freshness 回归通过。
  - 输入：当前 diff、Allowed / Conditional / Forbidden Files、验证命令清单。
  - 输出：审查结论、契约验证与回归结果。
  - 验证：`review-diff` / `review-implementation` 无阻塞问题，`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness` 通过。

## 回归检查项

- [x] `bun run gen:all`
- [x] `bun run test:workflow-skills`
- [x] `bun run test:registry`
- [x] `bun run test:workflow-docs`（仅当步骤 11 触发）
- [x] `bun run test:workflow-all`
- [x] `bun run validate:protocol`
- [x] `bun run validate:freshness`

## 回滚点

- Task start base: fd780348
- Last reviewed checkpoint: not-yet-created
- Current diff review target: working-tree

## 执行记录

- 2026-05-21：已按用户要求先回滚上一轮越过 `create-current-task` 的实现 diff。
- 2026-05-21：按 `create-current-task` 仅生成本 `CURRENT_TASK.md` 初稿；未修改模板、脚本、测试或 generated outputs。
- 2026-05-21：按 `review-current-task` 审查并收敛任务包；将 `WORKFLOW_GUIDE.md.tmpl` 纳入 Allowed Files，清空待确认问题，下一步进入 `lock-scope`。
- 2026-05-21：按 `lock-scope` 锁定本任务为 `frozen-scope`；确认不触碰危险 surfaces，默认禁止任何未列入 Allowed / Conditional 的文件，下一步进入 `classify-decisions`。
- 2026-05-21：按 `classify-decisions` 完成决策分类；当前无 taste 待确认项，user_challenge 约束已显式列出，下一步进入 `plan-implementation`。
- 2026-05-21：按 `plan-implementation` 完成实现方案分析；External Documentation Gate 未触发，下一步进入 `decompose-task`。
- 2026-05-21：按 `decompose-task` 完成步骤拆分；建议执行顺序为 skill 模板 -> registry -> workflow guide -> skill tests -> registry tests -> 条件 docs tests -> gen:all -> 局部验证 -> 全量复核。当前默认从步骤 6 开始执行；若实现发现必须触碰协议/schema/runtime 或未列入 Allowed / Conditional 的文件，立即停止并回到 `lock-scope`。
- 2026-05-21：完成步骤 6 `/implement-current-step`；新增 `templates/skills/supersede-current-task.SKILL.md.tmpl`，已写入 `reads: CURRENT_TASK.md / STATUS.md / DECISIONS.md / CONTRACTS.md`、`writes: CURRENT_TASK.md`、成功 handoff `review-current-task`、失败 handoff `ask-user`，并显式约束 supersede 只用于 scope invalidation，不得直接跳过 `review-current-task -> lock-scope -> plan-implementation` 进入实现。最小验证采用模板内容检索；未触碰 registry、guide、测试或 generated outputs。
- 2026-05-21：完成步骤 7 `/implement-current-step`；在 `scripts/gen-registry.ts` 的 `WORKFLOW_ORDER` 中把 `supersede-current-task` 放到 `create-current-task` 之后、`review-current-task` 之前，并将其加入 `HIGH_RISK_SKILLS`。本步仅修改 registry generator 与执行记录；最小验证为后续执行 `bun run gen:registry --dry-run` 确认显式顺序仍可生成。
- 2026-05-21：完成步骤 8 `/implement-current-step`；更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 的 Skill 速查、标准任务流程与越界处理，补充 `supersede-current-task` 的适用时机、替代路由与“必须回到 review-current-task -> lock-scope -> plan-implementation，不得直接实现”的约束。最小验证采用文案检索；未触碰测试、generated outputs 或范围外文件。
- 2026-05-22：完成步骤 9 `/implement-current-step`；在 `test/gen-workflow-skills.test.ts` 新增 `supersede-current-task` 聚焦断言，覆盖生成结果的 reads / writes / forbidden_writes / handoff、状态标记、scope invalidation / non-trigger 语义，以及“不得直接交给 implement-current-step”的治理约束。最小验证为执行 `bun run test:workflow-skills`。
- 2026-05-22：完成步骤 10 `/implement-current-step`；在 `test/gen-registry.test.ts` 新增 `supersede-current-task` 聚焦断言，覆盖 registry 行注册、阶段与 handoff 元数据、`create-current-task -> supersede-current-task -> review-current-task` 排序，以及高风险审计列表归类。最小验证采用测试文件内容检视；`bun run test:registry` 的通过性仍依赖步骤 12 先生成最新 `docs/workflow/SKILL_REGISTRY.md`。
- 2026-05-22：完成步骤 11 `/implement-current-step`；确认现有 `test/gen-workflow-docs.test.ts` 尚未覆盖 `supersede-current-task` 路由后，新增 `WORKFLOW_GUIDE` 断言，覆盖 `/supersede-current-task`、`scope invalidation`、`/review-current-task -> /lock-scope -> /plan-implementation` 回路，以及“不得直接继续 `/implement-current-step`”约束。最小验证采用测试断言内容检视；集成通过性待步骤 12 生成最新 workflow docs 后再进入局部回归。
- 2026-05-22：完成步骤 12 `/implement-current-step`；执行 `bun run gen:all`，通过生成器同步 `docs/workflow/generated/workflow-skills/**`、`docs/workflow/generated/workflow-docs/**` 和 `docs/workflow/SKILL_REGISTRY.md`，未手工编辑 generated outputs。最小验证为 `bun run gen:all` 成功退出；RDF-001 已据此标记为 resolved，下一步进入步骤 13 做聚焦验证。
- 2026-05-22：完成步骤 13 `/implement-current-step`；依次执行 `bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`，三组聚焦验证均通过。回归检查项中对应条目已勾选，下一步进入步骤 14 的最终复核链。
- 2026-05-22：完成步骤 14 最终复核；`/review-diff`、`/review-implementation`、`/verify-contracts` 均沿用 `diff_review_target: working-tree` 且结论为 clean，`/run-regression` 以 `diff-aware` 模式执行并通过 `bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`。当前无阻塞剩余问题，任务状态已同步为 `verification_passed_pending_status_sync`，下一步 handoff 为 `sync-status`。
- 2026-05-22：完成关闭链同步补记；`/sync-status` 已把任务 `002` 写入 `STATUS.md`，`/sync-contracts`、`/sync-decisions`、`/sync-host-guidance` 结论均为 no-op，当前未发现需要新增到 `LESSONS.md` 的独立跨任务经验，因此收尾链下一步进入 `/prepare-delivery-summary`，随后执行 `/archive-task`。
- 2026-05-22：已归档到 `TASKS/TASK-002-supersede-current-task-skill.md`；归档保留了任务定义、实际改动、验证证据、release evidence 与 remaining observation。`CURRENT_TASK.md` 当前仅保留为最近一轮已归档任务记录，下一轮入口切回 `/create-current-task`。
