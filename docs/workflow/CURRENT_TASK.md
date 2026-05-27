# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：005
- 任务标题：实现 ownership-aware root-cause routing 与 blocker 归属判定（第三阶段）
- 任务 slug：ownership-aware-root-cause-routing
- 当前状态：archived
- 生命周期状态：archived
- 恢复需审查：false
- 恢复审查原因：
- 当前 handoff：create-current-task
- 创建时间：2026-05-27

## 背景与上下文

- 任务 `003` 已稳定 `CURRENT_TASK` suspend / interrupt / resume contract foundation；任务 `004` 已落地 lifecycle runtime skills 与 resume-review handoff。
- 用户提供 `docs/workflow/NEXT_TASK_DRAFT_005_OWNERSHIP_AWARE_ROOT_CAUSE_ROUTING.md` 作为任务 `005` 草案；本次 `/create-current-task` 仅将该草案 materialize 为新的 live `docs/workflow/CURRENT_TASK.md` 初稿，不进入实现。
- 本任务目标是在不重开 `003/004` protocol、schema、runtime foundation 的前提下，为以下 skill 建立 ownership-aware blocker / root-cause / finding routing：
  - `templates/skills/investigate-root-cause.SKILL.md.tmpl`
  - `templates/skills/run-regression.SKILL.md.tmpl`
  - `templates/skills/sync-review-findings.SKILL.md.tmpl`
  - `templates/docs/WORKFLOW_GUIDE.md.tmpl`
- 路由需要稳定区分 6 个 canonical ownership route：`current_task_owned`、`scope_widening_candidate`、`resume_paused_required`、`resume_interrupted_required`、`new_bug_task_required`、`user_decision_required`。
- 本任务要解决的核心场景是：当当前 active task 在实现、回归或只读审查中遇到 failure / blocker / finding 时，如何在当前 active task、唯一 paused package、唯一 interrupted package、scope widening、独立 bug task 与人工决策之间做可审计、fail-closed 的路由。
- 任务 `005` 同时要补齐 interrupt 后旧任务遗留问题阻断新 active task 时的 owner-sensitive routing，但不得把“归属判断”偷换成“自动修复授权”。
- 当前任务继续排除以下范围：新增 inbox / backlog artifact；新增 lifecycle state、resume reason、artifact kind、artifact path、protocol-level named error；重写 `pause-current-task` / `interrupt-current-task` / `resume-paused-task` / `resume-interrupted-task` 事务语义；修改 runtime manifest / install / health report contract；自动挑选 suspended package。

## 验收标准

- `templates/skills/investigate-root-cause.SKILL.md.tmpl` 已能把 blocker / failure 路由为当前任务、scope widening、paused owner、interrupted owner、独立 bug 或需人工决策，并显式输出 `Ownership assessment`、`Ownership evidence`、`Recommended route`、`Recommended handoff`。
- `templates/skills/investigate-root-cause.SKILL.md.tmpl` 在引入 ownership-aware routing 后仍保留显式 `External Documentation Gate`，且 gate 触发时继续遵守 ctx7 MCP -> 可确认 current docs 的 ctx7 / docs skill -> `ctx7` CLI -> blocked reason 的既有回退顺序。
- `templates/skills/run-regression.SKILL.md.tmpl` 已能在 fail / blocked / report-only 结果中输出 ownership-aware routing；`qa_mode=report-only` 仍是 terminal report，只可报告 route，不可自动执行 route。
- `templates/skills/sync-review-findings.SKILL.md.tmpl` 不会把 paused / interrupted / 独立 bug owner 的 finding 错写进当前 `CURRENT_TASK.md > 审查问题队列`；只有 `current_task_owned` 且位于当前 Allowed Files 内的 mechanical implementation finding 才允许入队。
- 三个受影响 skill 的 frontmatter `reads` 已显式覆盖 `docs/workflow/CURRENT_TASK.md`、`TASKS/paused/**`、`TASKS/interrupted/**`；其中 `run-regression` 还显式覆盖 `.workflow-system/PROJECT_PROFILE.yaml`。
- 三个受影响 skill 的正文 `Required Reads` 已明确：命中 paused / interrupted owner 候选时，必须先读取 matching suspended package evidence，再输出 `Ownership assessment` / `Recommended route` 或决定 finding queue 去向；不得仅凭运行时记忆或模糊相似性猜测 owner。
- 三个受影响 skill 的 `Recommended route` 只允许使用 6 个 canonical ownership route；skill-local alias 必须显式映射到 canonical route 或 pre-routing state，不能扩展闭集。
- 三个受影响 skill 的 `conditional_handoff` 已改为 guard-aware alias：`resume_*_guard_passed -> resume-*`、`resume_*_guard_blocked -> ask-user`；不得保留 `resume_*_required -> resume-*` 的一跳映射。
- 当 suspended package evidence 未读取、缺失、marker 不自洽、无法唯一解析或 active-owner guard 未通过时，生成文本只能导向 `blocked` / `ask-user` / `evidence gap` / `lock-scope` / `create-current-task`；不得直接导向 `resume_paused_required` 或 `resume_interrupted_required` 的成功恢复链。
- `WORKFLOW_GUIDE` 已明确说明“旧任务遗留问题阻断新 active task”时，应根据 canonical route 与 active-owner guard 进入 `resume-*`、`lock-scope`、`create-current-task` 或 `ask-user`；当前 live task 仍 active 时必须先让用户决定是否 pause / interrupt 当前任务。
- `test/gen-workflow-skills.test.ts` 已对三个 generated skill 逐项断言：
  - frontmatter `reads` 包含 `TASKS/paused/**` 与 `TASKS/interrupted/**`
  - 正文 `Required Reads` 包含“先读取 matching suspended package evidence，再产出 route / queue decision”的规则
  - fail-closed 文本不允许在 evidence gap 下直接生成 resume route
  - `conditional_handoff` 只允许 guard-aware alias，不允许 `resume_*_required: resume-*` 一跳结构
- `test/gen-workflow-docs.test.ts` 已断言 guide 在 ownership-aware routing 场景下保留 active-owner guard，并把 suspended owner 路由到 `resume-*` / `ask-user` / `create-current-task` / `lock-scope`。
- 不新增 lifecycle state、resume reason、artifact kind、artifact path、protocol-level named error。
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
  - required evidence：diff 只反映 finding owner 判定与 queue / handoff 规则变化，不得扩大为实现逻辑改造。
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
  - required evidence：仅记录 ownership-aware routing 的稳定边界，不重写 `003/004` 的 foundation / runtime contract。
  - validation：`bun run validate:protocol`
- `docs/workflow/DECISIONS.md`
  - condition：仅当任务 `005` 产生长期保留决策并由 `/sync-decisions` 写入时允许同步。
  - required evidence：仅记录 route 选择与拒绝项，不写实现过程流水。
  - validation：`bun run validate:protocol`
- `docs/workflow/LESSONS.md`
  - condition：仅当任务 `005` 形成跨任务可复用经验并由 `/capture-lessons` 写入时允许同步。
  - required evidence：只记录可复用 lesson，不记录一次性执行细节。
  - validation：`bun run validate:protocol`

Safety mode:

- `frozen-scope`
- 选择理由：任务 `005` 只应落在 skill template、guide template、generated reference sync 与生成测试面；风险主要来自 owner 误判、guard 绕过、report-only 漂移与 finding queue 错写，不应顺手扩到 protocol / schema / runtime。

Dangerous surfaces:

- `ownership routing correctness`：canonical route 与 skill-local alias 必须分离；不得把 skill-local alias 写成新的 ownership route。
- `external-doc gate preservation`：`investigate-root-cause` 在增补 routing 后仍必须保留显式 `External Documentation Gate`，不得因为本任务是内部路由改造而静默删除 gate。
- `active-owner guard`：当前 `CURRENT_TASK.md` 仍持有另一个 active ownership 时，不得直接 resume 并覆盖 live task。
- `report-only terminal rule`：`run-regression` 的 report-only 只能报告 route，不能自动 handoff 到实现或恢复。
- `finding queue isolation`：`sync-review-findings` 只能把当前任务可修问题写入当前 `CURRENT_TASK.md > 审查问题队列`。
- `generated artifact discipline`：generated skills、generated guide、registry 只能由生成器同步。

Unlock / widening conditions:

- 默认不允许扩大范围；未列入 Allowed Files 的文件一律禁止修改。
- 若实现证据表明现有 `003/004` contract 无法表达 ownership-aware routing，必须回到 `/lock-scope`，而不是直接改 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 或 runtime。
- 触发 widening 时必须同时写明：
  - reason：为什么当前白名单无法完成闭环。
  - impacted files：新增涉及的具体文件。
  - risks：新增范围会引入哪些 contract / generated / runtime 风险。
  - validation：新增或扩大的验证方式。
- 预先识别但当前仍禁止的 widening 候选：
  - `.workflow-system/WORKFLOW_PROTOCOL.md`
  - `.workflow-system/FILE_SCHEMAS.md`
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
- `vibe-coding/**`
- `dist/**`
- `.git/**`
- `node_modules/**`

## 受影响的契约

- 触碰 workflow skill public surface：
  - `templates/skills/investigate-root-cause.SKILL.md.tmpl`
  - `templates/skills/run-regression.SKILL.md.tmpl`
  - `templates/skills/sync-review-findings.SKILL.md.tmpl`
  - 兼容策略：`backward-compatible`；仅扩展 owner-sensitive route、output contract、required reads 与 guard-aware handoff，不改 protocol / schema / runtime contract。
- 触碰核心 skill External Documentation Gate contract：
  - `templates/skills/investigate-root-cause.SKILL.md.tmpl`
  - `docs/workflow/generated/workflow-skills/investigate-root-cause.SKILL.md`（Conditional File）
  - 兼容策略：`backward-compatible`；ownership-aware routing 变更不得移除、弱化或绕过 `investigate-root-cause` 已锁定的显式 `External Documentation Gate`。
- 触碰 guide routing contract：
  - `templates/docs/WORKFLOW_GUIDE.md.tmpl`
  - `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`（Conditional File）
  - 兼容策略：`backward-compatible`；只显式化 interrupt 遗留 blocker 的 owner-sensitive routing，不新增新的全局 stage 或 orchestration entrypoint。
- 触碰 generated reference discipline：
  - `docs/workflow/generated/workflow-skills/**`
  - `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - `docs/workflow/SKILL_REGISTRY.md`
  - 兼容策略：`backward-compatible`；生成结果只能由模板 / 生成器派生，不得手工修补。
- 触碰 owner-sensitive finding / regression / root-cause routing：
  - canonical route 闭集
  - active-owner guard
  - report-only terminal rule
  - finding queue isolation
  - 兼容策略：`backward-compatible`；不新增持久 schema 字段，只在 skill 内部 routing contract 和 guide 说明层落地。
- 需要在任务完成后评估是否同步：
  - `docs/workflow/CONTRACTS.md`
  - `docs/workflow/DECISIONS.md`
  - `docs/workflow/STATUS.md`
  - 回归检查项

## Change Propagation Check

- trigger：yes；本任务会触碰 workflow skill public surface、guide routing contract、generated reference discipline 与生成测试断言。
- impacted consumers：
  - `docs/workflow/generated/workflow-skills/{investigate-root-cause,run-regression,sync-review-findings}.SKILL.md`
  - `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - `docs/workflow/SKILL_REGISTRY.md`
  - `test/gen-workflow-skills.test.ts`
  - `test/gen-workflow-docs.test.ts`
  - 三个受影响 skill 的 frontmatter `reads` 与正文 `Required Reads`
- compatibility strategy：`backward-compatible`；仅扩展 skill routing 语义与 guide 说明，不改 protocol / schema / runtime contract。
- regression checks：
  - `bun run gen:all`
  - `bun run test:workflow-skills`
  - `bun run test:registry`
  - `bun run test:workflow-docs`
  - `bun run test:workflow-all`
  - `bun run validate:protocol`
  - `bun run validate:freshness`
  - `bun run workflow:health --root .`

## 已确认决策

- 任务 `005` 只消费任务 `003/004` 已稳定的 lifecycle / resume gate / artifact path / routing contract，不重开 protocol / schema foundation。
- interrupt 后旧任务遗留问题阻断新 active task 时，必须走 ownership-aware routing；不允许默认把问题吸收为当前任务实现缺陷，也不得在当前 active task 未先暂停 / 中断或释放 ownership 时直接 resume 旧任务。
- `run-regression` 在 `qa_mode=report-only` 下仍是 terminal report，可输出 route 但不得自动执行 handoff。
- `sync-review-findings` 只允许把 `current_task_owned` 且当前范围内可修的 finding 写入当前 `CURRENT_TASK.md > 审查问题队列`。
- 任务 `005` 的 canonical route 闭集固定为 `current_task_owned`、`scope_widening_candidate`、`resume_paused_required`、`resume_interrupted_required`、`new_bug_task_required`、`user_decision_required`；skill-local alias 必须有显式映射，不能扩展闭集。
- 不新增 dedicated ownership state、不新增 inbox / backlog artifact、不修改 runtime manifest / install / health report contract。
- 当前任务自身不触发外部文档门；但 `investigate-root-cause` 作为受影响核心 skill，仍必须保留已锁定的显式 `External Documentation Gate`；`create-current-task` 仍不是 ctx7 主查询入口。

## 决策分类

Mechanical:

- ownership-aware routing 只消费 `003/004` 已稳定 contract，不新增 protocol / schema 字段、枚举、artifact 或 named error。
- canonical route 与 skill-local alias 映射、active-owner guard、report-only terminal rule 与 finding queue isolation，属于既有 lifecycle / review 链路上的机械收敛。
- `investigate-root-cause` 的显式 `External Documentation Gate` 必须原样保留，属于既有锁定核心 skill contract 的机械保持。
- generated skills、guide 与 registry 只通过模板 / 生成器同步，属于生成链与审计链的一致性要求。

Taste:

- 无。当前任务不涉及 UI、视觉、交互、命名文案风格或其他未确认口味决策。

User challenge:

- 不得把任务 `005` 扩大为 protocol / schema / runtime manifest / install / health report contract 变更。
- 不得新增 inbox / backlog artifact、dedicated ownership ledger、dedicated ownership state，或把 skill-local alias 扩展成新的 canonical route。
- 不得自动挑选 suspended package、不得在 active-owner guard blocked 时直接 resume、不得把旧任务遗留问题静默吸收到当前任务。

## 待确认问题

- 无阻断项。
- 若后续实现证据表明现有 contract 无法表达 ownership-aware routing，必须回到 `/lock-scope` 评估是否需要新任务扩展协议层，而不是在任务 `005` 中直接 widening。

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
- Rollback / recovery: revert task diff or restore `docs/workflow/CURRENT_TASK.md` from task start base
- Release evidence: local command output

## 实现方案

- Goal: 在 `003` 已稳定 lifecycle contract、`004` 已落地 lifecycle runtime skills 的前提下，为 `investigate-root-cause`、`run-regression`、`sync-review-findings` 与 `WORKFLOW_GUIDE` 补齐 ownership-aware blocker / root-cause / finding routing。
- Architecture impact:
  - 主影响面是 3 个 skill template、1 个 guide template、对应 generated reference outputs 与生成测试。
  - `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`scripts/workflow-runtime.ts`、`scripts/task-identity.ts`、`scripts/workflow-doc-contracts.ts`、`scripts/run-validation.ts` 作为已锁定基础契约，只能被消费，不能在本任务中重写。
  - 本任务不新增持久 DTO；只在 skill 内部 routing contract、guide 文案与测试断言层收敛 owner-sensitive 路由。
- Technical approach:
  - 先在三个目标 skill 中统一 canonical route 闭集、skill-local alias 映射、`Ownership assessment` / `Ownership evidence` / `Recommended route` / `Recommended handoff` 输出契约。
  - 以 `investigate-root-cause` 作为 canonical routing 文案与 guard-aware handoff 的主收敛面，再把同一套 route / alias / evidence 读取骨架复用于 `run-regression` 与 `sync-review-findings`，避免三个 skill 各自发明 owner 判定语义。
  - 再把 `TASKS/paused/**` 与 `TASKS/interrupted/**` 纳入 frontmatter `reads` 和正文 `Required Reads`，要求命中 paused / interrupted owner 候选时必须先读取 matching suspended package evidence。
  - 然后在 `run-regression` 中保持 report-only terminal 规则，在 `sync-review-findings` 中把 queue 写入前置到 owner 判定。
  - 最后更新 `WORKFLOW_GUIDE` 与生成测试，确保 active-owner guard、resume guard alias、new bug / lock-scope / ask-user routing 在 generated reference outputs 中稳定呈现，同时不破坏 `investigate-root-cause` 既有 `External Documentation Gate`；guide 只解释消费路径，不新增长期 contract 或新的编排入口。
- Alternatives considered:
  - 重开 protocol / schema：拒绝。任务 `003/004` 已稳定 foundation / runtime contract，本任务只做 consumer-layer routing。
  - 新增 inbox / backlog artifact 或 ownership ledger：拒绝。会扩大治理面并引入新的持久状态。
  - 自动挑选最近 suspended package：拒绝。多 package 并存时会引入误恢复风险。
  - 把 route 直接映射成实现授权：拒绝。归属判断与修复授权必须分离。
- Data / state flow:
  - 当前 active task 仍由 live `docs/workflow/CURRENT_TASK.md` 的 `当前状态 + 生命周期状态` 决定。
  - paused / interrupted package 只提供 recovery evidence，不得被当作当前 live owner。
  - root-cause / regression / finding routing 先消费 live task、当前 diff review target、failure evidence 与 matching suspended package evidence，再产出 canonical route。
  - 若 route 指向 paused / interrupted owner，还必须经过 active-owner guard；guard blocked 时只能 handoff `ask-user`。
- Compatibility:
  - 对 protocol / schema / runtime manifest / install / health report contract 保持 `backward-compatible` 不变。
  - 对 workflow skill surface 是兼容性扩展：新增 owner-sensitive route、guard-aware handoff、required reads 与 fail-closed 文本断言。
  - 生成链保持 templates -> generator -> generated reference -> freshness，不允许从 generated output 反向维护。
- Risks and rollback:
  - 主要风险 1：把 paused / interrupted owner 的问题错误吸收到当前 active task，掩盖 scope drift。
  - 主要风险 2：把 ownership-aware routing 做成自动修复授权，绕过 `lock-scope`、`create-current-task` 或人工确认。
  - 主要风险 3：`report-only` 被意外改成可继续 handoff，破坏 `review-current-diff` 的 terminal report 约束。
  - 主要风险 4：`sync-review-findings` 把非当前任务 owner 的 finding 写入当前任务队列，导致后续错误修复。
  - 主要风险 5：direct resume 覆盖仍持有 active ownership 的 `CURRENT_TASK.md`，导致当前任务丢失或 active owner 被隐式替换。
  - 主要风险 6：为了表达 routing，顺手引入新的 schema / artifact / protocol 字段，重新打开 `003/004` 已锁定边界。
  - 回滚策略：回退到 Task start base `5833b5cc`，只撤销本任务 diff；若仅任务包初稿需要回退，可直接恢复 `docs/workflow/CURRENT_TASK.md`。
- Validation strategy:
  - 聚焦验证：`bun run test:workflow-skills`、`bun run test:workflow-docs`。
  - 按 `LESSONS.md` 中的 propagation chain 与 freshness closure 经验，先闭合 `templates -> generated reference -> tests/freshness`，再做全量 workflow 回归，避免只改模板却遗漏 registry / generated skill / guide / 测试断言。
  - 全量验证：`bun run gen:all`、`bun run test:registry`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。
  - Conditional File 验证：确认 generated diff 只来自 3 个 skill、guide render 与必要的 registry metadata 变化。
  - 若出现 protocol / schema / runtime / `DOCUMENT_CATALOG` / 范围外 generated diff，停止并回 `/lock-scope`。
- External Documentation Gate: not triggered。当前任务只依赖仓库内已稳定的 protocol、schema、templates、tests 与治理文档，没有第三方 current behavior 影响正确性。
- Open decisions: none
- Handoff: `decompose-task`

## 审查问题队列

- 无。

## 传播治理记录

### change_start_set

- 对象路径：`templates/skills/investigate-root-cause.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：把 root-cause 结论扩展为 ownership-aware route 判定，并输出 route / handoff 建议。
- 对象路径：`templates/skills/run-regression.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：在 fail / blocked / report-only 报告中补充 ownership assessment，并保留 report-only terminal rule。
- 对象路径：`templates/skills/sync-review-findings.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：把 finding queue 写入前置到 owner 判定，避免跨 owner 错写。
- 对象路径：`templates/docs/WORKFLOW_GUIDE.md.tmpl`
  - 对象类型：workflow doc template
  - 变更起点语义：补充 interrupt 遗留 blocker 的 owner-sensitive routing 入口与 active-owner guard 说明。

### discovery evidence

- `EvidenceRecord`：
  - mechanism：conversation-analysis
  - query_or_entrypoint：`docs/workflow/NEXT_TASK_DRAFT_005_OWNERSHIP_AWARE_ROOT_CAUSE_ROUTING.md`
  - scope：任务目标、Allowed / Conditional / Forbidden Files、canonical route 闭集、guard-aware alias、验收标准与回滚点
  - result_summary：草案已把任务 `005` 收敛为“ownership-aware root-cause / regression / finding routing + guide 显式化”，并明确禁止重开 protocol / schema / runtime 范围。
  - confidence：high
  - gaps：none
- `EvidenceRecord`：
  - mechanism：source-of-truth review
  - query_or_entrypoint：`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`
  - scope：确认 `003/004` contract 已稳定、source-of-truth precedence、source repo 目录边界与 quality gates
  - result_summary：任务 `005` 可以只消费既有 lifecycle / resume gate / artifact path / runtime routing contract，不需要在创建阶段扩大到 protocol / schema / runtime。
  - confidence：high
  - gaps：若实现证据否定这一点，必须回 `/lock-scope`

### aggregation / complexity

- `evidence_diff_threshold`：
  - absolute_diff：3
  - relative_diff_ratio：0.5
- `EvidenceAggregation`：
  - aggregation_strategy：union
  - candidate_impact_set：`templates/skills/investigate-root-cause.SKILL.md.tmpl`、`templates/skills/run-regression.SKILL.md.tmpl`、`templates/skills/sync-review-findings.SKILL.md.tmpl`、`templates/docs/WORKFLOW_GUIDE.md.tmpl`、对应 tests 与 Conditional Files
  - significant_divergence：false
  - divergence_reason：not-applicable
  - unresolved_gaps：none
  - aggregated_confidence：high
- `ComplexityAssessment`：
  - propagation_depth：3
  - direct_consumers：5
  - total_candidate_consumers：8
  - cross_boundary_hops：1
  - exceeded_metrics：none
  - threshold_status：within-limit
  - forced_strategy：direct-change
- `over_limit_policy`：
  - threshold_trigger：not-triggered
  - selected_branch：none
  - rationale：当前影响面仍可收敛在 template / guide / generated reference / tests；若命中 protocol / schema / runtime，应停下而不是继续扩面。

### eligibility / candidate / registry

- `MutationEligibilityAssessment`：
  - common.object_path：`ownership-aware root-cause / regression / finding routing`
  - common.object_kind：shared workflow routing surface
  - common.explicit_contract_state：compatible-extension-only
  - common.discovered_direct_consumers：guide、generated skills、generated guide、registry、tests、host runtime users
  - common.cross_boundary：yes
  - common.critical_path_hit：yes
  - common.locked_hit_chain：yes
  - common.registry_freshness：to-be-validated
  - common.rationale：任务 `005` 命中共享 skill routing surface，但已明确只做 contract consumer 与 reference sync，不重写 foundation / runtime。
- `implicit_shared_object_detection`：
  - object_path：`ownership-aware routing canonical route + guard-aware alias`
  - object_kind：workflow routing contract
  - direct_consumers：`investigate-root-cause`、`run-regression`、`sync-review-findings`、`WORKFLOW_GUIDE`、`SKILL_REGISTRY`
  - cross_boundary：yes
  - critical_path_hit：yes
  - locked_hit_chain：yes
  - proposed_contract_state：locked-candidate
  - writeback_required：yes
- `RegistryFreshnessReport`：
  - object_path：`docs/workflow/generated/workflow-skills/**`、`docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`、`docs/workflow/SKILL_REGISTRY.md`
  - registry_consumers：generated workflow reference outputs
  - discovered_consumers：`bun run gen:all` / `bun run validate:freshness`
  - effective_consumers：任务 `005` 仅允许同步 3 个 skill render、guide render 与必要的 registry metadata 变化
  - freshness：to-be-established
  - reconciliation：requires generator sync only after template changes land

### layout / behavior / migration / regression

- `LayoutContract`：
  - container_path：`templates/skills/`、`templates/docs/`、`docs/workflow/generated/`、`docs/workflow/SKILL_REGISTRY.md`
  - machine_anchor：skill template -> generated skill；guide template -> generated guide；registry generator -> generated registry
  - layout_model：live governance docs 继续在 `docs/workflow/*.md`，generated reference 继续在 `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md`
  - locked_properties：generated outputs generated-only；`docs/workflow/` 不吸收 product / methodology 文档
  - locked_relations：suspended package 仍留在 `TASKS/paused/**` 与 `TASKS/interrupted/**`；不升级为 governance catalog 常驻对象
  - cascade_sources：`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/skills/**`、`templates/docs/WORKFLOW_GUIDE.md.tmpl`
  - sibling_reflow_sensitive：yes
- `BehaviorContract`：
  - object_path：`ownership-aware route -> guarded handoff`
  - assertions：
    - canonical ownership route 闭集固定为 6 项，不得扩展
    - resume 路由必须先经过 active-owner guard
    - `run-regression(report-only)` 只能报告 route，不能自动执行 route
    - `sync-review-findings` 只允许把当前任务可修问题写入当前队列
    - `investigate-root-cause` 的显式 `External Documentation Gate` 必须保留
    - generated outputs 与 registry 只能由生成器写入
  - verification：聚焦生成测试 + 全量回归
- `LinkedRegressionRecord`：
  - regression_chain_id：task-005-ownership-aware-root-cause-routing
  - current_issue：首次把 lifecycle runtime skills 之后的 owner-sensitive blocker / route / queue 判断推进到可执行任务包
  - prior_fix_refs：`TASK-003-current-task-suspend-resume-contract-foundation`、`TASK-004-current-task-lifecycle-runtime-skills`
  - window_scope：current governance task cycle
  - window_size：2
  - shared_objects：canonical route、active-owner guard、report-only terminal rule、generated reference discipline
  - relation：routing-on-top-of-lifecycle-runtime
  - escalation：not-triggered

### blockers / gate status

- 当前执行步骤：`archive-task`
- 已完成 discovery：草案目标核对、`CONTRACTS.md` / `DECISIONS.md` / `STATUS.md` source-of-truth precedence 核对、Allowed / Conditional / Forbidden Files 收敛、回滚点三字段补齐、Design / Release 章节适用性审查、传播治理影响集合确认、决策分类、实现方案收敛、步骤拆解完成，以及第 6 步 `investigate-root-cause`、第 7 步 `run-regression`、第 8 步 `sync-review-findings` 与第 9 步 `WORKFLOW_GUIDE` 的 ownership-aware routing 模板 / guide / 测试同步。
- 剩余 blocker：
  - 无阻断项；任务已归档到 `TASKS/TASK-005-ownership-aware-root-cause-routing.md`，下一轮入口为 `/create-current-task`。
  - 若后续实现证据表明必须触碰 protocol / schema / runtime / `DOCUMENT_CATALOG`，必须停止并回到 `/lock-scope` 重新锁范围。
- `ContractCompatibilityResult`：
  - error_code：none
  - object_path：`ownership-aware root-cause / regression / finding routing`
  - severity：none
  - default_blocker_level：none
  - evidence：当前任务包未覆盖 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 或 runtime 脚本；兼容策略均为 `backward-compatible`，且风险已通过 Allowed / Conditional / Forbidden Files 与 widening 条件上浮。
  - strategy_origin.divergence_state：no_divergence
  - branch_gate_mapping.merge_gate：进入 `create-current-task`；若后续发现需要继续扩大到 protocol / schema / runtime，则重新开任务并回 `/lock-scope`
  - branch_gate_mapping.ship_gate：`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`
  - suggested_resolution：进入 `create-current-task`

## 实施步骤

- [x] 步骤 1：运行 `/review-current-task`，复审任务 `005` 的边界、验收标准、Allowed / Conditional / Forbidden Files、传播治理记录与回滚点。
  - 输入：本 `CURRENT_TASK.md` 初稿、`docs/workflow/NEXT_TASK_DRAFT_005_OWNERSHIP_AWARE_ROOT_CAUSE_ROUTING.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`.workflow-system/PROJECT_PROFILE.yaml`
  - 输出：边界收敛且可执行的任务包
  - 验证：无阻断待确认问题；handoff 已进入 `lock-scope`
- [x] 步骤 2：运行 `/lock-scope`，锁定 skill template、guide、tests 与 Conditional Files 的白名单范围。
  - 输入：审查后的任务包和 widening 候选
  - 输出：补齐或确认 `Safety mode`、`Dangerous surfaces`、`Unlock / widening conditions`
  - 验证：未列入 Allowed / Conditional 的文件默认禁止修改；当前 handoff 已更新为 `classify-decisions`
- [x] 步骤 3：运行 `/classify-decisions`，把 routing 任务中的 mechanical / taste / user_challenge 决策分类。
  - 输入：验收标准、已确认决策、传播治理记录
  - 输出：结构化决策分类
  - 验证：taste 决策为空或显式记录；user_challenge 禁止项明确
- [x] 步骤 4：运行 `/plan-implementation`，形成最终实现方案与验证策略。
  - 输入：已稳定的 `003/004` contract、现有 skill / guide / tests
  - 输出：收敛后的 `## 实现方案`
  - 验证：External Documentation Gate 明确 not triggered；若发现必须改 protocol / schema / runtime，停止并回 `/lock-scope`；当前 handoff 已更新为 `decompose-task`
- [x] 步骤 5：运行 `/decompose-task`，把三个 skill、guide、generated sync 和回归拆成独立小步。
  - 输入：实现方案、Allowed Files、Contract impact
  - 输出：步骤 6-10 的细化执行清单
  - 验证：每步都有输入、输出和验证；不混入范围外工作；当前 handoff 已更新为 `implement-current-step`
- [x] 步骤 6：更新 `templates/skills/investigate-root-cause.SKILL.md.tmpl`。
  - 子目标：收敛 canonical route、`Ownership assessment` / `Ownership evidence` / `Recommended route` / `Recommended handoff`、matching suspended package evidence 读取规则与 guard-aware handoff
  - 验证：`bun test test/gen-workflow-skills.test.ts` 已通过；evidence 未读取或 owner 不唯一时保持 fail-closed，且不会直接导向 resume 成功链；当前 handoff 已更新为 `review-diff`
- [x] 步骤 7：更新 `templates/skills/run-regression.SKILL.md.tmpl`。
  - 子目标：在 fail / blocked / report-only 结果中输出 ownership-aware routing，并保持 report-only terminal rule
  - 验证：`bun test test/gen-workflow-skills.test.ts` 已通过；生成测试证明 report-only 仍不会自动 handoff，resume route 会报告 active-owner guard 结果，且 evidence gap 不会直接导向 resume success chain；当前 handoff 已更新为 `review-diff`
- [x] 步骤 8：更新 `templates/skills/sync-review-findings.SKILL.md.tmpl`。
  - 子目标：把 finding owner 判定前置到 queue 写入之前，只把当前任务可修问题写入当前队列
  - 验证：生成测试证明 paused / interrupted / new bug / user decision findings 不会错写进当前 `CURRENT_TASK.md > 审查问题队列`，且 resume route 只能通过 guard-aware alias 进入恢复链；当前 handoff 已更新为 `review-diff`
- [x] 步骤 9：更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 并同步 Conditional Files。
  - 子目标：补齐 interrupt 遗留 blocker 的 owner-sensitive routing、active-owner guard 与 `resume-*` / `lock-scope` / `create-current-task` / `ask-user` 指引
  - 验证：生成 docs 测试已覆盖 active-owner guard、`resume-*` / `ask-user` / `create-current-task` / `lock-scope` 指引，以及当前 live task 仍 active 时必须先让用户决定是否 pause / interrupt 当前任务；当前 handoff 已更新为 `review-diff`
- [x] 步骤 10：运行回归并在稳定后按需执行 `/sync-current-task`、`/sync-status`、`/sync-contracts`、`/sync-decisions`、`/capture-lessons`。
  - 子目标：确认 generator、tests、protocol validation、freshness 与 workflow health 仍稳定，并只在边界稳定后回写 live docs
  - 验证：`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 全部通过；`docs/workflow/STATUS.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md` 已完成稳定事实回写；当前 handoff 已更新为 `close-current-task`

## 回归检查项

- [x] `bun run gen:all`
- [x] `bun run test:workflow-skills`
- [x] `bun run test:registry`
- [x] `bun run test:workflow-docs`
- [x] `bun run test:workflow-all`
- [x] `bun run validate:protocol`
- [x] `bun run validate:freshness`
- [x] `bun run workflow:health --root .`

## 回滚点

- Task start base: 5833b5cc
- Last reviewed checkpoint: not-yet-created
- Current diff review target: working-tree

## 执行记录

- 2026-05-27：按 `/create-current-task` 从 `docs/workflow/NEXT_TASK_DRAFT_005_OWNERSHIP_AWARE_ROOT_CAUSE_ROUTING.md` 生成任务 `005` 的 `docs/workflow/CURRENT_TASK.md` 初稿；已读取草案、`docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`，确认当前任务目标明确、验收标准可验证、Allowed / Conditional / Forbidden Files 已显式列出、Design / Release 章节适用 `none`、Change Propagation Check 已补齐、回滚点三字段齐备；本步未进入实现，下一步 handoff 为 `/review-current-task`。
- 2026-05-27：执行 `/review-current-task`；已复审 `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` 与 `.workflow-system/PROJECT_PROFILE.yaml` 的 source-of-truth precedence，确认当前任务仍只有一个主目标、无未确认 taste 决策、Design / Release 章节适用 `none`、Allowed / Conditional / Forbidden Files 可支撑范围锁定、回滚点三字段有效且可审计，并补充“`investigate-root-cause` 必须保留显式 `External Documentation Gate`”这一已锁定核心 skill 契约；当前 handoff 更新为 `/lock-scope`。
- 2026-05-27：执行 `/lock-scope`；已按 skill frontmatter 复核 `docs/workflow/CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`，确认 Allowed Files 仍收敛在 3 个 skill template、1 个 guide template、2 个测试文件与 `CURRENT_TASK.md`，Conditional Files 已逐项写明触发条件、证据与验证方式，`Safety mode = frozen-scope` 与当前任务风险匹配且无需升级为 `guarded`，Dangerous surfaces、锁定契约、Change Propagation Check 与 widening 条件均已显式记录；未触发越界或锁定契约冲突，下一步 handoff 为 `/classify-decisions`。
- 2026-05-27：执行 `/classify-decisions`；已读取 `docs/workflow/CURRENT_TASK.md` 与 `docs/workflow/DECISIONS.md`，确认现有决策分类区已覆盖 Mechanical、Taste、User challenge 三类：本任务的 route 闭集、guard-aware alias、report-only terminal rule、finding queue isolation、External Documentation Gate 保留与 generated-only 同步均属于 mechanical 收敛；当前无未确认 taste 决策；user_challenge 项明确禁止扩大到 protocol / schema / runtime / inbox backlog / dedicated ownership state / 自动挑选 suspended package。未发现用户目标与既有决策冲突，下一步 handoff 为 `/plan-implementation`。
- 2026-05-27：执行 `/plan-implementation`；已按 skill frontmatter 读取 `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md` 与 `.workflow-system/PROJECT_PROFILE.yaml`，确认当前目标、验收、Allowed Files 与决策分类足以支撑最小可行实现路径，且无需扩大 scope。已将实现方案收敛为“以 `investigate-root-cause` 为 canonical routing 主收敛面，复用到 `run-regression` 与 `sync-review-findings`，再以 `WORKFLOW_GUIDE` 和生成测试闭合传播链”，并明确 `External Documentation Gate: not triggered`、兼容策略、主要风险、回滚方式与分层验证顺序；未触发 Forbidden Files / taste / user_challenge 停机条件，下一步 handoff 为 `/decompose-task`。
- 2026-05-27：执行 `/decompose-task`；已按 skill frontmatter 读取 `docs/workflow/CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/DECISIONS.md` 与 `docs/workflow/CONTRACTS.md`，确认现有实现方案已覆盖架构影响、技术路线、兼容性、风险与验证策略，且 Design mode 为 `none`，无需额外设计探索 / 视觉 QA 拆分。已将执行清单确认收敛为“一文件 / 一类改动 / 一步一验”的 6-10 步：三个 skill template 各自独立实现、一条 guide + Conditional Files 同步链、最后统一回归与治理回写；未发现未确认取舍、跨层越界或多模块混改风险，下一步 handoff 为 `/implement-current-step`。
- 2026-05-27：执行 `/implement-current-step`（步骤 6）；已读取 `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md`，确认审查问题队列为空、Design mode = `none`、本步只落在 `templates/skills/investigate-root-cause.SKILL.md.tmpl`、`test/gen-workflow-skills.test.ts` 与触发后的 Conditional File `docs/workflow/generated/workflow-skills/investigate-root-cause.SKILL.md`。已为 `investigate-root-cause` 补齐 ownership-aware routing：frontmatter `reads` 新增 `TASKS/paused/**` 与 `TASKS/interrupted/**`，输出契约新增 `Ownership assessment` / `Ownership evidence` / `Recommended route` / `Recommended handoff`，正文新增 canonical route 闭集、guard-aware alias 映射、matching suspended package evidence 读取规则、active-owner guard 与 fail-closed 文本；同步更新生成测试以断言 guard-aware handoff 和 evidence-gap 行为，并用 `bun test test/gen-workflow-skills.test.ts` 完成本步最小验证。当前 handoff 更新为 `/review-diff`。
- 2026-05-27：执行 `/implement-current-step`（步骤 7）；已读取 `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md`，确认审查问题队列为空、Design mode = `none`、本步只落在 `templates/skills/run-regression.SKILL.md.tmpl`、`test/gen-workflow-skills.test.ts` 与触发后的 Conditional File `docs/workflow/generated/workflow-skills/run-regression.SKILL.md`。已为 `run-regression` 补齐 ownership-aware routing：frontmatter `reads` 新增 `TASKS/paused/**` 与 `TASKS/interrupted/**`，输出契约新增 `Ownership assessment` / `Ownership evidence` / `Recommended route` / `Recommended handoff`，并新增 guard-aware `conditional_handoff`；正文补齐 matching suspended package evidence 读取规则、canonical route 闭集、active-owner guard、report-only 只报告 route / handoff 不自动执行，以及 evidence gap fail-closed 约束；同步更新生成测试以断言 guard-aware alias、report-only terminal rule 与 resume success chain 防逃逸，并用 `bun test test/gen-workflow-skills.test.ts` 完成本步最小验证。当前 handoff 更新为 `/review-diff`。
- 2026-05-27：执行 `/implement-current-step`（步骤 8）；已读取 `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md`，确认审查问题队列为空、Design mode = `none`、本步只落在 `templates/skills/sync-review-findings.SKILL.md.tmpl`、`test/gen-workflow-skills.test.ts` 与触发后的 Conditional File `docs/workflow/generated/workflow-skills/sync-review-findings.SKILL.md`。已为 `sync-review-findings` 补齐 owner-sensitive queue routing：frontmatter `reads` 新增 `TASKS/paused/**` 与 `TASKS/interrupted/**`，输出契约新增 `Ownership assessment` / `Ownership evidence` / `Recommended route` / `Recommended handoff`，并新增 guard-aware `conditional_handoff`；正文补齐 canonical route 闭集、matching suspended package evidence 读取规则、active-owner guard、只允许 `current_task_owned` 入当前审查问题队列，以及 paused / interrupted / new bug / user decision findings 的 fail-closed 队列隔离；同步更新生成测试以断言 guard-aware alias、owner-sensitive queue routing 与 evidence-gap 行为。当前 handoff 更新为 `/review-diff`。
- 2026-05-27：执行 `/implement-current-step`（步骤 9）；已读取 `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md`，确认 Design mode = `none`，本步只落在 `templates/docs/WORKFLOW_GUIDE.md.tmpl`、`test/gen-workflow-docs.test.ts` 与触发后的 Conditional File `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`。已在 guide 中显式补齐“旧任务遗留 blocker 阻断当前 active task”时的 ownership-aware routing：明确 `scope_widening_candidate -> /lock-scope`、唯一 paused / interrupted owner 在 matching suspended package evidence 完整且 active-owner guard 通过时才进入 `resume-*`，否则转 `ask-user` 或 `create-current-task`；并强调当前 live task 仍 active 时必须先让用户决定是否 `/pause-current-task` 或 `/interrupt-current-task` 当前任务。同步更新 docs 生成测试以断言 active-owner guard 与 `resume-*` / `ask-user` / `create-current-task` / `lock-scope` 指引。当前 handoff 更新为 `/review-diff`。
- 2026-05-27：执行步骤 10 收尾回归与治理回写；已运行 `bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`，全部通过。已同步 `docs/workflow/SKILL_REGISTRY.md`、受影响 generated reference outputs，并把 ownership-aware routing 的长期边界写入 `docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`docs/workflow/LESSONS.md`；当前 handoff 更新为 `/close-current-task`。
- 2026-05-27：执行 `/archive-task`；已按归档模板生成 `TASKS/TASK-005-ownership-aware-root-cause-routing.md`，归档内容覆盖任务定义、实际改动、稳定契约 / 决策、回归与 review 证据、Lessons 回写和后续入口建议。live `docs/workflow/CURRENT_TASK.md` 已切换为合法的 `archived + archived` tuple，并把下一轮 handoff 更新为 `/create-current-task`。
