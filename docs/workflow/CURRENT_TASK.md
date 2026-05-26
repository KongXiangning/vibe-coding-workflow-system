# CURRENT_TASK.md

## 任务信息

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 任务 ID：004
- 任务标题：实现 CURRENT_TASK lifecycle runtime skills 与 resume review handoff（第二阶段）
- 任务 slug：current-task-lifecycle-runtime-skills
- 当前状态：draft
- 生命周期状态：active
- 恢复需审查：false
- 恢复审查原因：
- 当前 handoff：close-current-task
- 创建时间：2026-05-26

## 背景与上下文

- 任务 `003` 已完成并归档；`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`scripts/task-identity.ts`、`scripts/workflow-doc-contracts.ts` 与 `scripts/run-validation.ts` 已稳定第一阶段 lifecycle contract foundation。
- 用户提供 `docs/workflow/NEXT_TASK_DRAFT_004_LIFECYCLE_RUNTIME_SKILLS.md` 作为任务 `004` 草案；本次 `/create-current-task` 仅将该草案 materialize 为新的 live `CURRENT_TASK.md` 初稿，不进入实现。
- 本任务目标是在不重开 `003` 协议 / schema 基础范围的前提下，补齐以下 runtime 技能与路由面：
  - `pause-current-task`
  - `resume-paused-task`
  - `interrupt-current-task`
  - `resume-interrupted-task`
  - `review-current-task` 对 resume review gate 的消费扩展
- 恢复 skill 的职责只到“从合法 suspended package 重建 live `CURRENT_TASK.md` 并回写来源 package marker”；恢复成功后固定回到 `review-current-task`，不得直接进入实现。
- 本任务仍明确排除以下范围：ownership-aware root-cause routing、inbox / backlog artifact、新的 lifecycle state / resume reason / artifact kind / artifact path / protocol-level named error，以及 runtime manifest / install / health report contract 变更。
- 本任务属于 source repo 内部 workflow-system 演进任务；generated outputs 只能由生成器同步，不能手工编辑。

## 验收标准

- 已新增 `templates/skills/pause-current-task.SKILL.md.tmpl`、`templates/skills/resume-paused-task.SKILL.md.tmpl`、`templates/skills/interrupt-current-task.SKILL.md.tmpl`、`templates/skills/resume-interrupted-task.SKILL.md.tmpl` 四个 runtime skill template。
- 四个 lifecycle skill 的 stage 都是 `阶段 7：状态同步`，且在 registry 中位于 `sync-current-task` 之前，顺序稳定可测试。
- `pause-current-task` 明确区分 `paused_pending_closure` 与 `paused_blocked`，并要求对应 `resume_review_reasons`、blocker evidence 与 fail-closed file transaction。
- `interrupt-current-task` 明确要求 checkpoint evidence、dirty attribution、environment state、recovery strategy；缺失任一证据时必须 fail-closed。
- `pause-current-task` 与 `interrupt-current-task` 都必须声明文件事务顺序：`write_incomplete + recovery_only` -> live `CURRENT_TASK.md` suspended tuple -> read-back validation -> `ready_for_resume + recovery_only`；任一步失败都不得 handoff.success。
- `pause-current-task` 与 `interrupt-current-task` 生成的 suspended package 必须保留完整 live `CURRENT_TASK.md` snapshot，作为 canonical restore payload；不得只写最小 marker 字段。
- `resume-paused-task` 与 `resume-interrupted-task` 只接受显式、无歧义、`rehydration_status = ready_for_resume`、`ownership_state = recovery_only` 的输入，不允许“自动挑最新 package”。
- 两个 resume skill 都必须从完整 payload 重建 `docs/workflow/CURRENT_TASK.md`；payload 缺失、截断、marker drift、gate drift、active owner conflict 或 interrupted evidence 缺失时必须 fail-closed。
- 两个 resume skill 恢复成功后都必须把 live `CURRENT_TASK.md` 写成：
  - `当前状态：active`
  - `生命周期状态：active`
  - `恢复需审查：true`
  - `恢复审查原因：<规范化 reasons>`
  - `当前 handoff：review-current-task`
- 两个 resume skill 恢复成功后都必须把来源 package 写成：
  - `rehydration_status = rehydrated`
  - `ownership_state = rehydrated`
- `templates/skills/review-current-task.SKILL.md.tmpl` 已扩展为 resume gate consumer：必须审查 `恢复需审查`、`恢复审查原因`、rollback point 三字段、drift / blocker / remaining acceptance / validation pending 等恢复前提，但不得静默清空 gate。
- `templates/docs/WORKFLOW_GUIDE.md.tmpl`、`scripts/gen-registry.ts`、`docs/workflow/SKILL_REGISTRY.md` 和对应 generated skill / guide outputs 能稳定反映 lifecycle runtime skills、resume 后回到 `review-current-task` 的规则，以及 `阶段 7：状态同步` 的 branch-style summary。
- `scripts/gen-registry.ts` 已把四个 lifecycle skill 纳入显式 `WORKFLOW_ORDER` 与 `HIGH_RISK_SKILLS`，不能依赖字母排序。
- 不新增 lifecycle state、resume reason、artifact kind、artifact path、protocol-level named error。
- 不实现 ownership-aware root-cause routing，不引入 inbox / backlog artifact，不修改 runtime manifest / install / health report contract。
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

Conditional Files:

- `docs/workflow/generated/workflow-skills/pause-current-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/resume-paused-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/interrupt-current-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/resume-interrupted-task.SKILL.md`
- `docs/workflow/generated/workflow-skills/review-current-task.SKILL.md`
  - condition：仅当对应 template 经 `bun run gen:workflow-skills` 或 `bun run gen:all` 成功生成时允许同步。
  - required evidence：diff 只来自新增 4 个 lifecycle skill 与 `review-current-task` 的 template 变更；不得手工编辑。
  - validation：`bun run test:workflow-skills`、`bun run validate:freshness`
- `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - condition：仅当 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 为 lifecycle routing 更新而变化时允许同步。
  - required evidence：diff 只反映 lifecycle skill 入口、resume handoff 规则和 `阶段 7：状态同步` branch-style summary 的对应 render。
  - validation：`bun run test:workflow-docs`、`bun run validate:freshness`
- `docs/workflow/SKILL_REGISTRY.md`
  - condition：仅当 `scripts/gen-registry.ts` 与新增 skill templates 导致 registry order / stage / high-risk list 更新时允许同步。
  - required evidence：diff 只反映任务 `004` 范围内 skill 的注册、stage、handoff、顺序与高风险审计列表变化。
  - validation：`bun run test:registry`、`bun run validate:freshness`
- `docs/workflow/STATUS.md`
  - condition：仅当任务 `004` 完成后由 `/sync-status` 记录 lifecycle runtime skills、guide / registry 更新和验证结果时允许。
  - required evidence：diff 只反映任务 `004` 的完成状态、验证证据和剩余 deferred 项，不引入范围外事实。
  - validation：`bun run validate:protocol`
- `docs/workflow/CONTRACTS.md`
  - condition：仅当任务 `004` 形成新的稳定 runtime skill / handoff / registry contract，并由 `/sync-contracts` 固化时允许。
  - required evidence：diff 只记录 pause / interrupt / resume runtime skill、resume review handoff、stage 7 registry ordering 或 generated discipline 的稳定边界；不得重写 `003` protocol / schema foundation。
  - validation：`bun run validate:protocol`
- `docs/workflow/DECISIONS.md`
  - condition：仅当任务 `004` 产生需要长期保留的 architecture / deferred / rejected decision，并由 `/sync-decisions` 写入时允许。
  - required evidence：diff 只记录已确认的 `004` 决策，例如 resume 后回到 `review-current-task`、不新增 dedicated resume review skill、不实现 inbox / backlog artifact。
  - validation：`bun run validate:protocol`
- `docs/workflow/LESSONS.md`
  - condition：仅当任务 `004` 过程中出现可复用 lesson，并由 `/capture-lessons` 写入时允许；无 lesson 时必须 no-op。
  - required evidence：diff 只记录跨任务可复用 lesson，不记录一次性执行流水。
  - validation：`bun run validate:protocol`

Safety mode:

- `frozen-scope`
- 选择理由：任务 `004` 只应落在 skill template、guide、registry、generated reference 和生成测试面；风险主要来自 handoff 漂移、generated churn 与 resume gate 语义误消费，不应顺手扩到 protocol / schema / runtime。
- 不选 `guarded`：本任务不触碰 production、database、permissions、authentication、payments、deployment、rollback、CI/CD、monitoring config、performance baseline、migration、bulk delete、force push 或 history rewrite，也不需要危险命令 gate。

Dangerous surfaces:

- `task-state mutation semantics`：pause / interrupt / resume 只能消费既有 contract，不能在 skill 文本里偷偷改写状态机。
- `generated artifact discipline`：generated skills、generated guide、registry 只能由生成器同步。
- `registry order / stage drift`：新增 skill 必须显式进入 `WORKFLOW_ORDER` 和 `HIGH_RISK_SKILLS`，不能依赖字母排序。

Unlock / widening conditions:

- 默认不允许扩大范围；未列入 Allowed Files 的文件一律禁止修改。
- 如果实现证据证明现有 `003` contract 无法被 runtime skills 明确消费，必须回到 `/lock-scope`，而不是直接改协议、schema 或 runtime。
- 触发 widening 时必须同时写明：
  - reason：为什么当前白名单无法完成闭环。
  - impacted files：新增涉及的具体文件。
  - risks：新增范围会引入哪些 contract / generated / runtime 风险。
  - validation：新增或扩大的验证方式。
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

Forbidden Files:

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

## 受影响的契约

- 触碰 workflow skill public surface：
  - `templates/skills/pause-current-task.SKILL.md.tmpl`
  - `templates/skills/resume-paused-task.SKILL.md.tmpl`
  - `templates/skills/interrupt-current-task.SKILL.md.tmpl`
  - `templates/skills/resume-interrupted-task.SKILL.md.tmpl`
  - `templates/skills/review-current-task.SKILL.md.tmpl`
  - 兼容策略：`backward-compatible`；新增 skill 与 `review-current-task` 扩展都必须消费既有 `003` contract，不得改写协议 / schema / runtime。
- 触碰 guide / registry contract：
  - `templates/docs/WORKFLOW_GUIDE.md.tmpl`
  - `scripts/gen-registry.ts`
  - `docs/workflow/SKILL_REGISTRY.md`（Conditional File）
  - 兼容策略：`backward-compatible`；仅新增 lifecycle runtime skills 的入口、顺序、stage 和高风险审计说明。
- 触碰 generated reference discipline：
  - `docs/workflow/generated/workflow-skills/**`
  - `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - 兼容策略：`backward-compatible`；生成结果只能由模板 / generator 派生，不得手工修补。
- 触碰恢复审查 handoff contract：
  - resume 成功后的固定 handoff 为 `review-current-task`
  - `review-current-task` 必须消费 `恢复需审查` / `恢复审查原因` / rollback point 三字段
  - 兼容策略：`backward-compatible`；恢复后的首个消费者固定为 review，不新增 dedicated resume-review skill。
- 需要在任务完成后评估是否同步：
  - `docs/workflow/CONTRACTS.md`
  - `docs/workflow/DECISIONS.md`
  - `docs/workflow/STATUS.md`
  - 回归检查项

## Change Propagation Check

- trigger：yes；本任务会触碰 workflow skill public surface、guide / registry contract 和 generated reference discipline。
- impacted consumers：
  - `docs/workflow/generated/workflow-skills/**`
  - `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`
  - `docs/workflow/SKILL_REGISTRY.md`
  - `test/gen-workflow-skills.test.ts`
  - `test/gen-registry.test.ts`
  - `test/gen-workflow-docs.test.ts`
- compatibility strategy：`backward-compatible`；runtime skills 只消费任务 `003` 已锁定 contract，不新增 lifecycle state、resume reason、artifact kind、artifact path 或 protocol-level named error。
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

- 任务 `004` 不重开 `003` 的 protocol / schema foundation；runtime skill 只消费既有 lifecycle state、resume gate、artifact path、ownership marker 与 fail-closed contract。
- resume 成功后统一回到 `review-current-task`；不新增 dedicated resume review skill，不允许直接 handoff 到实现类 skill。
- resume gate 保留为可审计信号；恢复 skill 不负责清 gate，`review-current-task` 负责消费 gate。
- resume 输入必须显式；不做“自动挑最近 package”之类模糊恢复。
- 四个 lifecycle runtime skills 统一归入 `阶段 7：状态同步`，通过 registry branch-style summary 表达与 steady-state sync 链的关系，不新增新的全局 stage heading。
- interrupt 后若旧任务遗留问题阻断新 active task，任务 `004` 只把它作为当前 active task blocker 暴露；是否 widening 吸收、resume 旧任务修复或拆独立 bug task，留待后续任务或人工决策。
- generated outputs、`docs/workflow/SKILL_REGISTRY.md` 与 `docs/workflow/generated/**` 只能由生成器同步；本任务不得手工编辑。
- 当前任务不触发外部文档门；`create-current-task` 仍不是 ctx7 主查询入口。

## 决策分类

Mechanical:

- 四个 lifecycle runtime skill 只消费 `003` 已稳定的 lifecycle / resume gate / artifact path contract，不新增 protocol / schema 字段、枚举或 named error。
- resume 成功后的固定 handoff 为 `review-current-task`，以及 `review-current-task` 对 resume gate / rollback point 的消费，属于既有审查链路的机械闭环。
- `阶段 7：状态同步` 的 registry 顺序、high-risk audit list、generated skills / guide / registry 同步规则，属于生成链与审计链的一致性收敛。

Taste:

- 无。当前任务不涉及 UI、视觉、交互、命名文案风格或其他未确认口味决策。

User challenge:

- 不得把任务 `004` 扩大为 protocol / schema / runtime manifest / install / health report contract 变更。
- 不得新增 dedicated resume review skill、ownership-aware root-cause routing、inbox / backlog artifact，或自动挑选 suspended package。

## 待确认问题

- 无阻断项。
- 若实现证据表明 `review-current-task` 仍无法充分消费 resume gate，必须回到 `/lock-scope` 评估是否需要单独任务，而不是在任务 `004` 中直接扩面。

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

- Goal: 在 `003` 已稳定的 lifecycle contract foundation 之上，新增 pause / interrupt / resume runtime skills，并把 resume review gate 正式接回 `review-current-task`。
- Architecture impact:
  - 主影响面是 skill template、guide template、registry generator、generated reference outputs 与 generator tests。
  - `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`scripts/task-identity.ts`、`scripts/workflow-doc-contracts.ts`、`scripts/run-validation.ts` 作为已锁定基础契约，只能被消费，不能在本任务中重写。
  - `review-current-task` 成为 resumed task 的首个强制消费者；guide 与 registry 只是把该 handoff 显式化并可审计化。
- Technical approach:
  - 先新增 4 个 lifecycle skill template，锁定各自 `trigger`、`reads`、`writes`、`forbidden_writes`、`must_check`、`stop_conditions`、`handoff` 与必要的 `conditional_handoff`。
  - 再扩展 `templates/skills/review-current-task.SKILL.md.tmpl`，使其稳定消费 `恢复需审查`、`恢复审查原因` 与 rollback point 三字段，并覆盖 resumed task 的 drift / blocker / remaining acceptance / validation pending 场景。
  - 然后更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 与 `scripts/gen-registry.ts`，把 lifecycle runtime skills 纳入 `阶段 7：状态同步`、high-risk audit list、branch-style summary 和 resume-review routing。
  - 最后补足 `test/gen-workflow-skills.test.ts`、`test/gen-registry.test.ts`、`test/gen-workflow-docs.test.ts`，再通过生成器同步 Conditional Files 并做全量回归。
- Alternatives considered:
  - 重开 protocol / schema：拒绝。`003` 已稳定基础契约，本任务只做 runtime consumer。
  - 新增 dedicated resume-review skill：拒绝。恢复后直接回 `review-current-task` 更符合既有“先审查再实现”的稳定链路。
  - 自动挑选最近 suspended package：拒绝。多 package 并存时会引入误恢复风险。
  - 顺手扩 ownership-aware root-cause routing / inbox / backlog artifact：拒绝。它们属于后续任务，不应和 runtime skill 首次落地混做。
- Data / state flow:
  - live ownership 仍只由 `docs/workflow/CURRENT_TASK.md` 的 `当前状态 + 生命周期状态` 决定。
  - `pause-current-task` / `interrupt-current-task` 把 live task 转成 suspended tuple，并把完整 snapshot 写入 `TASKS/paused/**` 或 `TASKS/interrupted/**`。
  - `resume-paused-task` / `resume-interrupted-task` 从合法 suspended package 重建 live `CURRENT_TASK.md`，然后固定 handoff 到 `review-current-task`。
  - `review-current-task` 消费 resume gate，guide / registry / generated reference 只负责把这个链路显式化。
- Compatibility:
  - 对 protocol / schema / runtime manifest / install / health report contract 保持 `backward-compatible` 不变。
  - 对 workflow skill surface 是兼容性扩展：新增 4 个 skill，并让 `review-current-task` 增加 resumed-task 审查职责。
  - 生成链保持 templates -> generator -> generated reference -> freshness，不允许从 generated output 反向维护。
- Risks and rollback:
  - 主要风险 1：skill template 文本偷改状态机语义，导致与 `003` contract 漂移。
  - 主要风险 2：resume handoff 若未固定回 `review-current-task`，会让恢复后的任务绕过审查直接进入实现。
  - 主要风险 3：registry / guide / generated outputs 若未同步，会形成 skill surface 与 reference evidence 不一致。
  - 主要风险 4：如果实现中发现必须改 protocol / schema / runtime，当前任务必须立即停止并回 `/lock-scope`，而不是继续 widening。
  - 回滚策略：回退到 Task start base `06bfc714`，只撤销本任务 diff；若仅 `CURRENT_TASK.md` 初稿需要回退，可直接恢复本文件。
- Validation strategy:
  - 聚焦验证：`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`。
  - 全量验证：`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。
  - Conditional File 验证：确认 generated diff 只来自新增 lifecycle skill、`review-current-task` render、`WORKFLOW_GUIDE` render 与 `SKILL_REGISTRY`。
  - 若出现 protocol / schema / runtime / `DOCUMENT_CATALOG` / 其他范围外 generated diff，停止并回 `/lock-scope`。
- External Documentation Gate: not triggered。当前任务只依赖仓库内已稳定的 protocol、schema、templates、scripts、tests 与治理文档，没有第三方 current behavior 影响正确性。
- Open decisions: none
- Handoff: `decompose-task`

## 审查问题队列

- 无。

## 传播治理记录

### change_start_set

- 对象路径：`templates/skills/pause-current-task.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：把 active task 安全切到 paused suspended package，并保持完整 restore payload 与 fail-closed transaction。
- 对象路径：`templates/skills/interrupt-current-task.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：把 active task 安全切到 interrupted package，并记录 checkpoint / dirty attribution / environment / recovery strategy。
- 对象路径：`templates/skills/resume-paused-task.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：从合法 paused package 恢复 live task，并固定 handoff 到 `review-current-task`。
- 对象路径：`templates/skills/resume-interrupted-task.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：从合法 interrupted package 恢复 live task，并保留 interrupted evidence 的审查链。
- 对象路径：`templates/skills/review-current-task.SKILL.md.tmpl`
  - 对象类型：workflow skill template
  - 变更起点语义：把 resumed task 的 resume gate / rollback point 消费纳入审查入口。
- 对象路径：`templates/docs/WORKFLOW_GUIDE.md.tmpl`
  - 对象类型：workflow doc template
  - 变更起点语义：把 lifecycle runtime skills 与 resume-review routing 明确写入 guide。
- 对象路径：`scripts/gen-registry.ts`
  - 对象类型：registry generator
  - 变更起点语义：把四个 lifecycle skill 纳入 `阶段 7：状态同步`、显式顺序与 high-risk audit list。

### discovery evidence

- `EvidenceRecord`：
  - mechanism：conversation-analysis
  - query_or_entrypoint：`NEXT_TASK_DRAFT_004_LIFECYCLE_RUNTIME_SKILLS.md`
  - scope：任务目标、Allowed / Conditional / Forbidden Files、建议验收标准、回滚点与范围边界
  - result_summary：草案已把任务 `004` 收敛为“runtime skills + resume review handoff”单一主目标，并明确禁止重开 protocol / schema / runtime 范围。
  - confidence：high
  - gaps：none
- `EvidenceRecord`：
  - mechanism：source-of-truth review
  - query_or_entrypoint：`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`
  - scope：确认 `003` contract 已稳定、source-of-truth precedence、source repo 目录边界与 quality gates
  - result_summary：任务 `004` 可以只消费既有 lifecycle / resume gate / artifact path contract，不需要在创建阶段扩大到 protocol / schema / runtime。
  - confidence：high
  - gaps：若实现证据否定这一点，必须回 `/lock-scope`

### aggregation / complexity

- `evidence_diff_threshold`：
  - absolute_diff：3
  - relative_diff_ratio：0.5
- `EvidenceAggregation`：
  - aggregation_strategy：union
  - candidate_impact_set：`templates/skills/*.SKILL.md.tmpl`（新增 4 个 lifecycle skill 与 `review-current-task`）、`templates/docs/WORKFLOW_GUIDE.md.tmpl`、`scripts/gen-registry.ts`、对应 tests 与 Conditional Files
  - significant_divergence：false
  - divergence_reason：not-applicable
  - unresolved_gaps：none
  - aggregated_confidence：high
- `ComplexityAssessment`：
  - propagation_depth：3
  - direct_consumers：6
  - total_candidate_consumers：10
  - cross_boundary_hops：1
  - exceeded_metrics：none
  - threshold_status：within-limit
  - forced_strategy：direct-change
- `over_limit_policy`：
  - threshold_trigger：not-triggered
  - selected_branch：none
  - rationale：当前影响面仍可收敛在 template / registry / generated reference / tests；若命中 protocol / schema / runtime，则应停下而不是继续扩面。

### eligibility / candidate / registry

- `MutationEligibilityAssessment`：
  - common.object_path：`CURRENT_TASK lifecycle runtime skills + resume review handoff`
  - common.object_kind：shared workflow runtime surface
  - common.explicit_contract_state：compatible-extension-only
  - common.discovered_direct_consumers：guide、registry、generated skills、generated guide、tests、host runtime consumers
  - common.cross_boundary：yes
  - common.critical_path_hit：yes
  - common.locked_hit_chain：yes
  - common.registry_freshness：to-be-validated
  - common.rationale：任务 `004` 命中共享 skill surface，但已明确只做 contract consumer 与 reference sync，不重写 foundation。
- `implicit_shared_object_detection`：
  - object_path：`resume review handoff`
  - object_kind：workflow routing contract
  - direct_consumers：`resume-paused-task`、`resume-interrupted-task`、`review-current-task`、`WORKFLOW_GUIDE`、`SKILL_REGISTRY`
  - cross_boundary：yes
  - critical_path_hit：yes
  - locked_hit_chain：yes
  - proposed_contract_state：locked-candidate
  - writeback_required：yes
- `RegistryFreshnessReport`：
  - object_path：`docs/workflow/generated/workflow-skills/**`、`docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`、`docs/workflow/SKILL_REGISTRY.md`
  - registry_consumers：generated workflow reference outputs
  - discovered_consumers：`bun run gen:all` / `bun run validate:freshness`
  - effective_consumers：任务 `004` 仅允许同步 lifecycle runtime skills、guide render 与 registry render
  - freshness：to-be-established
  - reconciliation：requires generator sync only after template / registry changes land

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
  - object_path：`resume success -> review-current-task`
  - assertions：
    - resume 成功后不得直接进入实现
    - `review-current-task` 必须消费 resume gate 与 rollback point 三字段
    - pause / interrupt / resume skill 只能消费 `003` foundation，不得改写 status tuple / marker contract
    - generated outputs 与 registry 只能由生成器写入
  - verification：聚焦生成测试 + 全量回归
- `LinkedRegressionRecord`：
  - regression_chain_id：task-004-lifecycle-runtime-skills
  - current_issue：首次把 lifecycle runtime skills 与 resume review handoff 从 defer 状态推进到可执行任务包
  - prior_fix_refs：`TASK-003-current-task-suspend-resume-contract-foundation`
  - window_scope：current governance task cycle
  - window_size：1
  - shared_objects：lifecycle runtime skills、resume gate、registry stage 7 ordering、generated reference discipline
  - relation：runtime-on-top-of-foundation
  - escalation：not-triggered

### blockers / gate status

- 当前执行步骤：`close-current-task`
- 已完成 discovery：草案目标核对、`CONTRACTS.md` / `DECISIONS.md` / `STATUS.md` source-of-truth precedence 核对、Allowed / Conditional / Forbidden Files 收敛、回滚点三字段核对、传播治理影响集合确认、Design / Release 章节适用性审查、scope lock 收敛、决策分类、实现方案记录、执行步骤拆解、步骤 6-8 的模板 / guide / registry / 测试改动核对、步骤 6-8 的 working-tree diff review / implementation review / contract verification / targeted regression、步骤 9 的 Conditional Files 同步与 freshness 验证、步骤 10 的全量回归，以及步骤 11 的 live governance docs 同步。
- 剩余 blocker：
  - 无阻断项；步骤 11 已完成且治理文档已同步，当前轮可进入 `close-current-task` 做交付摘要与归档。
  - 若后续实现证据表明必须触碰 protocol / schema / runtime / `DOCUMENT_CATALOG`，必须停止并回到 `/lock-scope` 重新锁范围。
- `ContractCompatibilityResult`：
  - error_code：none
  - object_path：`CURRENT_TASK lifecycle runtime skills + resume review handoff`
  - severity：none
  - default_blocker_level：none
  - evidence：当前任务包未覆盖 `docs/workflow/CONTRACTS.md` 或 `.workflow-system/PROJECT_PROFILE.yaml`，兼容策略均为 `backward-compatible`，且风险已通过 Allowed / Conditional / Forbidden Files 与 widening 条件上浮。
  - strategy_origin.divergence_state：no_divergence
  - branch_gate_mapping.merge_gate：继续进入 `close-current-task`；若后续发现必须 touching protocol / schema / runtime，则立即停下并重锁范围
  - branch_gate_mapping.ship_gate：`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`
  - suggested_resolution：进入 `close-current-task`

## 实施步骤

- [x] 步骤 1：运行 `/review-current-task`，复审任务 `004` 的边界、验收标准、Allowed / Conditional / Forbidden Files、传播治理记录与回滚点。
  - 输入：本 `CURRENT_TASK.md` 初稿、`docs/workflow/NEXT_TASK_DRAFT_004_LIFECYCLE_RUNTIME_SKILLS.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`.workflow-system/PROJECT_PROFILE.yaml`
  - 输出：边界收敛且可执行的任务包
  - 验证：无阻断待确认问题；handoff 进入 `lock-scope`
- [x] 步骤 2：运行 `/lock-scope`，锁定 skill template、guide、registry、tests 与 Conditional Files 的白名单范围。
  - 输入：审查后的任务包和 widening 候选
  - 输出：补齐或确认 `Safety mode`、`Dangerous surfaces`、`Unlock / widening conditions`
  - 验证：未列入 Allowed / Conditional 的文件默认禁止修改
- [x] 步骤 3：运行 `/classify-decisions`，把 runtime skill 任务中的 mechanical / taste / user_challenge 决策分类。
  - 输入：验收标准、已确认决策、传播治理记录
  - 输出：结构化决策分类
  - 验证：taste 决策为空或显式记录；user_challenge 禁止项明确
- [x] 步骤 4：运行 `/plan-implementation`，形成最终实现方案与验证策略。
  - 输入：已稳定的 `003` contract、现有 template / registry / tests
  - 输出：收敛后的 `## 实现方案`
  - 验证：External Documentation Gate 明确 not triggered；若发现必须改 protocol / schema / runtime，停止并回 `/lock-scope`
- [x] 步骤 5：运行 `/decompose-task`，把 template、guide、registry、tests、generated sync 和回归拆成独立小步。
  - 输入：实现方案、Allowed Files、Contract impact
  - 输出：步骤 6-11 的细化执行清单
  - 验证：每步都有输入、输出和验证；不混入范围外工作
- [x] 步骤 6：新增 4 个 lifecycle runtime skill template。
  - 子目标：锁定 `trigger`、`reads`、`writes`、`forbidden_writes`、`must_check`、`stop_conditions`、`handoff` 与必要的 `conditional_handoff`
  - 验证：`test/gen-workflow-skills.test.ts` 覆盖新增模板、stage、handoff、transaction 语义与 payload / gate 规则
- [x] 步骤 7：扩展 `templates/skills/review-current-task.SKILL.md.tmpl`。
  - 子目标：消费 `恢复需审查`、`恢复审查原因`、rollback point 三字段与恢复后 drift / blocker / validation pending 场景
  - 验证：聚焦测试证明 resumed task 会回到 review，且不会静默清 gate
- [x] 步骤 8：更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 与 `scripts/gen-registry.ts`。
  - 子目标：补齐 lifecycle runtime skills 入口、`阶段 7：状态同步` branch-style summary、显式顺序与 high-risk audit list
  - 验证：`test/gen-registry.test.ts`、`test/gen-workflow-docs.test.ts` 覆盖 stage、summary、guide routing 与 registry ordering
- [x] 步骤 9：同步 Conditional Files 并做聚焦生成 / freshness 验证。
  - 子目标：只通过生成器同步 generated skills、generated `WORKFLOW_GUIDE.md` 与 `SKILL_REGISTRY.md`
  - 验证：generated diff 仅命中任务 `004` 范围；`bun run validate:freshness` 通过
- [x] 步骤 10：运行全量回归。
  - 子目标：确认 generator、tests、protocol validation、freshness 与 workflow health 仍稳定
  - 验证：执行回归检查项中的全部命令
- [x] 步骤 11：若任务稳定完成，按需运行 `/sync-current-task`、`/sync-status`、`/sync-contracts`、`/sync-decisions`、`/capture-lessons`。
  - 子目标：只在稳定边界成立后回写 live docs
  - 验证：所有治理同步都受 Conditional Files 约束，且不引入范围外事实

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

- Task start base: 06bfc714
- Last reviewed checkpoint: not-yet-created
- Current diff review target: working-tree

## 执行记录

- 2026-05-26：按 `/create-current-task` 从 `docs/workflow/NEXT_TASK_DRAFT_004_LIFECYCLE_RUNTIME_SKILLS.md` 生成任务 `004` 的 `docs/workflow/CURRENT_TASK.md` 初稿；已读取草案、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`，确认当前任务目标明确、验收标准可验证、Allowed / Conditional / Forbidden Files 已显式列出、回滚点三字段齐备；本步未进入实现，下一步 handoff 为 `/review-current-task`。
- 2026-05-26：执行 `/review-current-task`；已复审当前任务包与 `CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` 的 precedence，补齐 `## 决策分类` 与 `blockers / gate status`，确认当前任务仍只有一个主目标、无未确认 taste 决策、Design / Release 章节均为 `none` / not applicable、回滚点三字段有效且允许进入锁范围；当前 handoff 更新为 `/lock-scope`。
- 2026-05-26：再次执行 `/review-current-task`；复核 `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` 后未发现新的 precedence 冲突、范围漂移、未分类决策或回滚点缺口；当前任务继续保持单一主目标，Design / Release 章节仍适用 `none`，当前 handoff 保持 `/lock-scope`。
- 2026-05-26：执行 `/lock-scope`；补充 `not guarded` 的显式理由，并新增 `## Change Propagation Check`，把 impacted consumers、compatibility strategy 与 regression checks 单独上浮审计；确认只允许修改 `docs/workflow/CURRENT_TASK.md` 且当前范围足以覆盖任务 `004`，随后将当前 handoff 更新为 `/classify-decisions`。
- 2026-05-26：执行 `/classify-decisions`；复核 `CURRENT_TASK.md` 与 `DECISIONS.md`，确认当前任务的决策分类已经收敛为 `Mechanical` 为主、`Taste` 无阻断项、`User challenge` 仅保留禁止扩面的边界；未发现需要新增用户确认的问题，当前 handoff 更新为 `/plan-implementation`。
- 2026-05-26：执行 `/plan-implementation`；确认现有 `## 实现方案` 已覆盖 architecture impact、technical approach、alternatives、data / state flow、compatibility、risk / rollback、validation strategy 与 `External Documentation Gate`，仅把方案 handoff 固化为 `/decompose-task`，未修改代码或长期治理文档。
- 2026-05-26：执行 `/decompose-task`；将治理步骤 2-5 标记为已完成，确认步骤 6-11 具备单步输入、输出与验证边界，当前任务不涉及 UI / 视觉设计拆解，且下一步可以直接进入步骤 6 的实现；当前 handoff 更新为 `/implement-current-step`。
- 2026-05-26：执行 `/implement-current-step` 的步骤 6；新增 `templates/skills/pause-current-task.SKILL.md.tmpl`、`templates/skills/interrupt-current-task.SKILL.md.tmpl`、`templates/skills/resume-paused-task.SKILL.md.tmpl`、`templates/skills/resume-interrupted-task.SKILL.md.tmpl` 四个 runtime skill template，并为 `test/gen-workflow-skills.test.ts` 增加定向断言，覆盖 stage、handoff、`conditional_handoff`、fail-closed transaction、canonical restore payload、resume marker 与 forbidden writes；最小验证为 `bun run test:workflow-skills` 通过，当前 handoff 更新为 `/review-diff`。
- 2026-05-26：执行 `/review-diff`、`/review-implementation`、`/verify-contracts` 与 `/run-regression`；本轮统一沿用 `diff_review_target = working tree`（`git diff` + `git diff --cached`），确认 diff 仅触碰步骤 6 相关的 Allowed / Conditional 文件，没有越界、决策漂移或锁定契约破坏；`QA mode = diff-aware`，定向回归命中 `bun run test:workflow-skills` 并通过，当前 handoff 更新为 `/sync-status`。
- 2026-05-26：再次执行 `/implement-current-step` 的步骤 7；扩展 `templates/skills/review-current-task.SKILL.md.tmpl`，把 resumed task 的 `恢复需审查` / `恢复审查原因` / rollback point 三字段检查、`base_drift` / `checkpoint_drift` / `diff_review_target_changed` / `environment_recovery_pending` 处理要求，以及“不得静默清空 resume gate”的正文约束写入模板；同时为 `test/gen-workflow-skills.test.ts` 增加对应断言，证明 `review-current-task` 会消费 resume gate 而不是绕过它；最小验证为 `bun run test:workflow-skills` 通过，当前 handoff 更新为 `/review-diff`。
- 2026-05-26：执行步骤 7 完成后的 `/review-diff`、`/review-implementation`、`/verify-contracts` 与 `/run-regression`；本轮继续沿用 `diff_review_target = working tree`（`git diff` + `git diff --cached`），确认 diff 仅触碰步骤 7 相关的 Allowed / Conditional 文件，没有越界、决策漂移或锁定契约破坏；`QA mode = diff-aware`，定向回归仍命中 `bun run test:workflow-skills` 并通过，当前 handoff 更新为 `/sync-status`。
- 2026-05-26：执行 `/implement-current-step` 的步骤 8；更新 `templates/docs/WORKFLOW_GUIDE.md.tmpl` 与 `scripts/gen-registry.ts`，把 pause / interrupt / resume lifecycle runtime skills 纳入 skill 速查、标准任务流程与场景入口，并在 registry 生成器中显式加入 `WORKFLOW_ORDER`、`HIGH_RISK_SKILLS` 与 `阶段 7：状态同步` 的 branch-style summary；同时补充 `test/gen-registry.test.ts` 与 `test/gen-workflow-docs.test.ts`，覆盖 stage 7 顺序、高风险审计列表、resume 回到 `review-current-task` 与“不得直接进入 `/implement-current-step`”的 guide routing；最小验证为 `bun run gen:registry --dry-run` 与 `bun run gen:workflow-docs --dry-run` 通过，当前 handoff 更新为 `/review-diff`。
- 2026-05-26：执行步骤 8 完成后的 `/review-diff`、`/review-implementation`、`/verify-contracts` 与 `/run-regression`；本轮继续沿用 `diff_review_target = working tree`（`git diff` + `git diff --cached`），确认新增改动只落在 `templates/docs/WORKFLOW_GUIDE.md.tmpl`、`scripts/gen-registry.ts`、`test/gen-registry.test.ts`、`test/gen-workflow-docs.test.ts` 与 `docs/workflow/CURRENT_TASK.md` 这些 Allowed Files，且没有新增 open 审查问题、没有把 resume handoff 从 `review-current-task` 漂移到实现链，也没有把 lifecycle skill 从 `阶段 7：状态同步` 漂移到其他 stage；`QA mode = diff-aware`，本步最小回归维持 `bun run gen:registry --dry-run` 与 `bun run gen:workflow-docs --dry-run` 通过，当前 handoff 更新为 `/sync-status`。
- 2026-05-26：执行 `/implement-current-step` 的步骤 9；通过 `bun run gen:workflow-skills`、`bun run gen:workflow-docs` 与 `bun run gen:registry` 正式同步 Conditional Files，并以 `bun run validate:freshness` 证明 generated workflow skills、generated workflow guide 与 `SKILL_REGISTRY.md` 已全部 fresh；working tree 中新增 / 更新的 generated diff 仅命中任务 `004` 已授权的 Conditional Files，当前 handoff 更新为 `/review-diff`。
- 2026-05-26：执行步骤 9 完成后的 `/review-diff`、`/review-implementation`、`/verify-contracts` 与 `/run-regression`；本轮继续沿用 `diff_review_target = working tree`（`git diff` + `git diff --cached`），确认 generated sync 只反映新增 lifecycle runtime skills、`review-current-task` 的 resume gate 消费、`WORKFLOW_GUIDE` lifecycle routing 与 `SKILL_REGISTRY` 的 stage 7 branch-style summary，没有出现范围外 generated churn；`QA mode = diff-aware`，定向回归命中 `bun run validate:freshness` 并通过，当前 handoff 更新为 `/sync-status`。
- 2026-05-26：执行步骤 10 的全量回归；先后运行 `bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`，期间发现 `test:registry` 的 stage 7 断言漏掉既有成员 `capture-lessons`，随后收敛 `scripts/gen-registry.ts` 的 branch-style summary 与对应测试，再次重跑全部剩余检查并全部通过；当前 handoff 更新为 `/sync-status`。
- 2026-05-26：执行步骤 11 的治理同步；更新 `docs/workflow/STATUS.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md` 与 `docs/workflow/LESSONS.md`，把 lifecycle runtime skills、resume-review routing、stage 7 registry branch-style summary、generated-only 边界与回归教训固化为 live governance facts；未发现需要补充的 `sync-host-guidance` 变更，当前 handoff 更新为 `/close-current-task`。
