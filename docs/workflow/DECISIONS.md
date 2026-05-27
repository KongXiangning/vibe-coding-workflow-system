# docs/workflow/DECISIONS.md

## 使用规则

- 本文件记录“为什么这样做”和“明确不做什么”。
- 已确认决策不应被 AI 在实现时自行改写。
- 原决策失效时，新增变更记录，不覆盖原条目。
- 决策被替代时，在 `## 🔁 已演进 / 已替代` 中记录原决策、后继决策和生效版本窗口。

## 🏗️ 架构决策

### AD-001: Source repo self-use 禁止 self-install

- 状态：accepted
- 背景：本仓库既是 workflow-system source repo，又需要使用 workflow-system 管理自身开发。直接把 `$target` 设为本仓库并执行 `workflow:install --root .` 会混淆 source repo 与 target repo 身份。
- 决策：source repo self-use 不走 `workflow:install --root .`；允许通过 `workflow:sync --root . --host <host> --write` 同步本地 host skills，并通过 `legacy-inventory -> adopt-existing-project` 建立 live governance docs。
- 原因：避免 install-state、managed files、drift repair 和 target-owned facts 与 source repo 管理面交叉。
- 约束：外部 target project 的标准 install/adoption/sync 流程不变。
- 影响范围：`workflow:install`, `workflow:sync`, `docs/workflow/**`, `.codex/skills/**`, `.claude/skills/**`
- 替代方案：设计独立 `workflow:self-sync` / `workflow:source-repair` 等新语义；当前不实现。
- 验证方式：manual command review; `workflow:health --root .`; future guard tests if implemented.

### AD-002: Source-repo quality gates 不复用 target-project validation slots

- 状态：accepted
- 背景：`.workflow-system/PROJECT_PROFILE.yaml` 中 `unit`、`integration`、`e2e-smoke`、`contract-compatibility` 等 project-level slots 属于 target project Adoption A4。
- 决策：source repo 不绑定这些 `owner: target-project` slots。本仓库质量控制使用 `validate:protocol`、`validate:freshness`、`test:workflow-all`、`workflow:health --root .`。
- 原因：保持 protocol-level validation、source-repo quality checks 和 target-project validation ownership 清晰。
- 约束：如未来需要 source-repo-specific gates，必须新增明确入口或协议扩展。
- 影响范围：`.workflow-system/PROJECT_PROFILE.yaml`, `docs/workflow/BASELINES.md`, validation reports
- 替代方案：将 target-project slots 绑定为 source repo 命令；已否决，因为会混淆 layer 语义。
- 验证方式：`validate:all` 报告 project-level unbound slots; protocol-level checks pass.

### AD-003: `docs/workflow/` 只承载治理管理面

- 状态：accepted
- 背景：source repo 和外部 target repo 都使用 `docs/workflow/*.md` 作为 live governance docs；同时 source repo 还维护产品说明、方法论和 generated reference outputs。
- 决策：`docs/workflow/*.md` 只记录本仓库如何被治理；产品、业务、方法论、使用说明和运维文档放在 `README.md`、`vibe-coding/**`、`docs/product/**`、`docs/guides/**`、`docs/ops/**` 等非 workflow 目录。
- 原因：避免治理管理面、产品化文档和 generated reference 混淆。
- 约束：`docs/workflow/generated/**` 和 `docs/workflow/SKILL_REGISTRY.md` 仍是 generated reference，不手改。
- 影响范围：docs taxonomy, `DOCUMENT_CATALOG.md`, `WORKFLOW_GUIDE.md`
- 替代方案：给 source repo 改用另一套 workflow home；不采用，因为 workflow home 已由协议/profile 固定为 `docs/workflow`。
- 验证方式：review docs placement during adoption and task close.

### AD-004: 核心实现与审查 skill 使用条件性 External Documentation Gate

- 状态：accepted
- 背景：`plan-implementation`、`implement-current-step`、`investigate-root-cause`、`review-implementation` 是最容易因第三方 library / framework / SDK / API / CLI tool / cloud service current behavior 过期而产生方案、实现、根因或评审错误的核心 skill。
- 决策：仅这 4 个核心 skill 在本轮接入同名 `External Documentation Gate`。gate 只在第三方 current behavior 会影响方案、实现正确性、根因判断或评审结论时触发；调用优先级固定为 ctx7 MCP -> 可确认 current docs 的 ctx7 / docs skill -> `ctx7` CLI -> blocked reason。
- 原因：把 current docs 取证放在真正依赖外部行为的环节，避免对纯内部任务强制查询，同时防止用训练数据默默替代当前第三方文档判断。
- 约束：AI 不得静默扩大到所有 workflow skill；不得把 `create-current-task` 改造成 ctx7 主查询入口；不得在 gate 触发且无法取得 current docs evidence 时继续做依赖第三方 current behavior 的关键判断。
- 影响范围：`templates/skills/plan-implementation.SKILL.md.tmpl`, `templates/skills/implement-current-step.SKILL.md.tmpl`, `templates/skills/investigate-root-cause.SKILL.md.tmpl`, `templates/skills/review-implementation.SKILL.md.tmpl`, `docs/workflow/generated/workflow-skills/**`, `test/gen-workflow-skills.test.ts`
- 替代方案：只在宿主指引中要求 ctx7；接入所有 skill；把 `create-current-task` 作为主查询入口。均不采用。
- 验证方式：`bun run gen:workflow-skills --dry-run`; `bun run gen:registry --dry-run`; `bun run test:workflow-skills`; `bun run validate:protocol`; `bun run validate:freshness`.

### AD-005: CURRENT_TASK lifecycle foundation 先稳定契约再实现 runtime skills

- 状态：accepted
- 背景：任务 `003` 需要补齐 `CURRENT_TASK` 暂停 / 中断 / 恢复协议与工件契约，但原始大任务已被收窄为第一阶段 contract foundation。
- 决策：第一阶段只稳定 lifecycle state、resume review gate、task artifact path、active ownership、suspended package validation 和 protocol-level synthesized check；不实现 pause / resume / interrupt runtime skills，不改 guide / registry routing，不新增 inbox / backlog artifact。
- 原因：先让 protocol、schema、template、resolver、bootstrap output 和 validator 对同一套 contract 收敛，避免 runtime skill 在语义未稳定前复制或发明状态规则。
- 约束：AI 不得把后续 runtime lifecycle skill、routing、guide、registry、inbox / backlog artifact 或 runtime manifest / install / health report contract 静默并入本阶段；需要时必须单独开任务并重新锁范围。
- 影响范围：`.workflow-system/WORKFLOW_PROTOCOL.md`, `.workflow-system/FILE_SCHEMAS.md`, `templates/docs/CURRENT_TASK.md.tmpl`, `scripts/task-identity.ts`, `scripts/bootstrap-project-governance.ts`, `scripts/workflow-doc-contracts.ts`, `scripts/run-validation.ts`, `docs/workflow/generated/workflow-docs/CURRENT_TASK.md`
- 替代方案：直接实现 lifecycle runtime skills；已否决，因为会扩大到 routing、handoff、guide、registry 和 generated outputs。
- 验证方式：`bun run gen:all`; `bun run test:workflow-all`; `bun run validate:protocol`; `bun run validate:freshness`; `bun run workflow:health --root .`.

### AD-006: CURRENT_TASK active ownership 由 workflow status 与 lifecycle state 共同决定

- 状态：accepted
- 背景：`CURRENT_TASK.md` 已有 `当前状态` 字段，但暂停 / 中断 / 恢复需要独立表达 lifecycle ownership，不能把所有语义继续塞进 workflow task status。
- 决策：`当前状态` 继续表达 workflow task record 状态；`生命周期状态` 表达 lifecycle state。`draft + active` 与 `active + active` 是 active owner tuple；`suspended + paused_* / interrupted` 是 non-active suspended marker；suspended package 不能反推 active ownership。
- 原因：分离 identity completeness、workflow status、lifecycle state 和 ownership derivation，避免 live task 与 suspended package 形成双活或 split-brain。
- 约束：AI 不得把 `TaskIdentityStatus`、`CurrentTaskWorkflowStatus`、`TaskLifecycleState` 或 `CurrentTaskOwnershipStatus` 混用；非法 tuple 和 resume gate drift 必须 fail-closed 或进入 review gate。
- 影响范围：`docs/workflow/CURRENT_TASK.md`, `templates/docs/CURRENT_TASK.md.tmpl`, `scripts/task-identity.ts`, `.workflow-system/FILE_SCHEMAS.md`
- 替代方案：继续让 `当前状态` 独自承担 lifecycle 语义；已否决，因为会污染现有 workflow / ownership status。
- 验证方式：`bun run test:task-identity`; `bun run validate:protocol`; `bun run test:workflow-all`.

### AD-007: suspended package 是 task artifact，不是 workflow governance catalog 对象

- 状态：accepted
- 背景：暂停和中断恢复需要持久化 package，但 `docs/workflow/` 目录只承载 live governance docs，`DOCUMENT_CATALOG` 不应被临时 task artifacts 扩面污染。
- 决策：`TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md` 与 `TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md` 是 recovery input artifact；`workflow-doc-contracts.ts` 校验其路径与结构，但不把每个 suspended package 提升为 governance catalog 常驻文档对象。
- 原因：保持 live governance docs、generated reference outputs 和 task artifacts 的目录职责清晰。
- 约束：AI 不得为了“可发现性”静默修改 `templates/docs/DOCUMENT_CATALOG.md.tmpl` 或 `docs/workflow/DOCUMENT_CATALOG.md` 来收纳 suspended packages。
- 影响范围：`.workflow-system/WORKFLOW_PROTOCOL.md`, `.workflow-system/FILE_SCHEMAS.md`, `scripts/workflow-doc-contracts.ts`, `scripts/run-validation.ts`
- 替代方案：把 suspended package 纳入 `DOCUMENT_CATALOG`；当前不采用。
- 验证方式：`bun run test:workflow-docs`; `bun run validate:protocol`; `bun run test:workflow-all`.

### AD-008: lifecycle runtime skills 统一在阶段 7 通过 review-current-task 完成恢复审查

- 状态：accepted
- 背景：任务 `003` 已稳定 `CURRENT_TASK` suspend / interrupt / resume contract foundation；任务 `004` 需要在不重开 protocol / schema foundation 的前提下，把 runtime skills、guide / registry routing 和 generated reference 闭环补齐。
- 决策：新增 `pause-current-task`、`interrupt-current-task`、`resume-paused-task`、`resume-interrupted-task` 四个 runtime skill；suspend transaction 必须 fail-closed 并保留完整 payload；resume 成功后固定回到 `review-current-task`，不新增 dedicated resume review skill，不允许自动挑选 suspended package。`WORKFLOW_GUIDE`、`SKILL_REGISTRY` 与 generated reference outputs 统一把它们放在 `阶段 7：状态同步`，并用 branch-style summary 表达 suspend / resume 与 steady-state sync 链。
- 原因：把恢复安全性、review gate 消费和 registry / guide discoverability 收敛到同一条可审计链路，避免 resume 直接进入实现或由多个 skill 分裂消费 gate。
- 约束：AI 不得新增 lifecycle state、resume reason、artifact kind、artifact path 或 protocol-level named error；不得把范围扩大到 inbox / backlog artifact 或 runtime manifest / install / health report contract。
- 影响范围：`templates/skills/{pause-current-task,interrupt-current-task,resume-paused-task,resume-interrupted-task,review-current-task}.SKILL.md.tmpl`, `templates/docs/WORKFLOW_GUIDE.md.tmpl`, `scripts/gen-registry.ts`, `docs/workflow/generated/workflow-skills/**`, `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`, `docs/workflow/SKILL_REGISTRY.md`, `test/gen-workflow-skills.test.ts`, `test/gen-registry.test.ts`, `test/gen-workflow-docs.test.ts`
- 替代方案：让 resume 直接 handoff 到实现；新增 dedicated resume review skill；依赖字母排序隐式决定 registry 顺序。均不采用。
- 验证方式：`bun run gen:all`; `bun run test:workflow-skills`; `bun run test:registry`; `bun run test:workflow-docs`; `bun run test:workflow-all`; `bun run validate:protocol`; `bun run validate:freshness`; `bun run workflow:health --root .`.

### AD-009: ownership-aware blocker / root-cause / finding routing 保持 canonical route + guard-aware handoff 分离

- 状态：accepted
- 背景：任务 `005` 需要让 `investigate-root-cause`、`run-regression`、`sync-review-findings` 与 `WORKFLOW_GUIDE` 在遇到旧任务遗留 blocker、当前任务失败或 review finding 时，能稳定区分当前任务、scope widening、paused owner、interrupted owner、独立 bug 和人工决策。
- 决策：owner 归属统一收敛到 6 个 canonical route：`current_task_owned`、`scope_widening_candidate`、`resume_paused_required`、`resume_interrupted_required`、`new_bug_task_required`、`user_decision_required`。skill-local alias 只表达 guard-aware handoff 或 pre-routing state，不扩展 route 闭集；恢复链只能通过 `resume_*_guard_passed` / `resume_*_guard_blocked` 进入。`run-regression(report-only)` 只报告 route，不自动执行 handoff；`sync-review-findings` 只允许 `current_task_owned` 且当前范围内可修的 mechanical finding 入当前队列。
- 原因：把 owner 判断和下一步执行权限分离，避免把“应该恢复哪个任务”偷换成“现在就自动恢复 / 修复”，同时保证 evidence gap、owner 不唯一和 active-owner guard 未通过时能 fail-closed。
- 约束：AI 不得跳过 matching suspended package evidence 读取；不得仅凭 package presence、运行时记忆或模糊相似性猜测 owner；不得把 paused / interrupted / new bug / user decision findings 错写到当前 `CURRENT_TASK.md > 审查问题队列`；不得让 `report-only` 流程自动进入恢复或修复链。
- 影响范围：`templates/skills/{investigate-root-cause,run-regression,sync-review-findings}.SKILL.md.tmpl`, `templates/docs/WORKFLOW_GUIDE.md.tmpl`, `docs/workflow/generated/workflow-skills/**`, `docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md`, `docs/workflow/SKILL_REGISTRY.md`, `test/gen-workflow-skills.test.ts`, `test/gen-workflow-docs.test.ts`
- 替代方案：让每个 skill 自己发明 owner route；保留 `resume_*_required -> resume-*` 一跳 handoff；让 `report-only` 或 review finding 自动触发恢复 / 修复链。均不采用。
- 验证方式：`bun run gen:all`; `bun run test:workflow-skills`; `bun run test:registry`; `bun run test:workflow-docs`; `bun run test:workflow-all`; `bun run validate:protocol`; `bun run validate:freshness`; `bun run workflow:health --root .`.

### AD-010: `workflow:install` 对 source-target root crossing 采用 fail-closed target-root guard

- 状态：accepted
- 背景：任务 `006` 需要把 adoption baseline 中“source repo 不得 self-install、target project 必须使用独立 root”的规则落到 runtime，否则 `workflow:install --root .`、source parent / ancestor root 或 shared `.git` crossing 仍可能误伤 source repo 自身。
- 决策：在 `installWorkflowBundle()` 的 bundle integrity 校验后、其他 install preflight 之前接入独立的 `scripts/guard-target-root.ts` helper；命中 source repo root、source parent / ancestor root 或 shared `.git` root crossing 时，统一以 `PreflightFailure.category = incompatible_target` fail-closed 返回。`workflow:sync --root . --host <host> --write` 继续保留为 source repo self-use allow path，不复用 install guard。
- 原因：把 source/target ownership collision 收敛到 install 入口，避免在非法 target root 上继续计算 planned writes、drift repair 或 bootstrap plan，同时保持现有 CLI surface 与错误分类闭集不扩大。
- 约束：AI 不得静默把 guard 扩大到 `workflow:install` 之外的其他 root 参数入口；不得新增 protocol-level named error 或修改 protocol / schema / templates / generated outputs，除非先重新锁范围。
- 影响范围：`scripts/workflow-runtime.ts`, `scripts/guard-target-root.ts`, `test/workflow-runtime.test.ts`, `test/guard-target-root.test.ts`, `docs/workflow/{CURRENT_TASK,CONTRACTS,STATUS}.md`
- 替代方案：把逻辑内联进 `workflow-runtime.ts`；为 crossing guard 新增 failure category / 协议错误码；立即扩大到所有 root 参数入口。均不采用。
- 验证方式：`bun run test:workflow-all`; `bun run validate:protocol`; `bun run validate:freshness`; `bun run workflow:health --root .`

## 🎨 口味决策

### TD-001: 中文治理文档风格

- 状态：accepted
- 背景：仓库 AGENTS 指令要求中文回答，workflow 管理文档主要服务中文维护流程。
- 决策：live governance docs 使用中文为主，命令、路径、协议术语保留英文原文。
- 原因：降低本仓库维护时的协作成本，同时保持技术标识精确。
- 约束：不要翻译命令、路径、error code、field name。
- 影响范围：`docs/workflow/**`, `docs/adoption/**`
- 替代方案：全英文治理文档；当前不采用。
- 复议条件：项目维护者明确要求英文交付或外部协作者成为主要维护者。

## ⏸️ 暂缓决策

### DEFER-001: Target root guard 实现

- 状态：deferred
- 背景：inventory 提出可新增 `scripts/guard-target-root.ts` 或等价 guard，阻止 source/target root 交叉。
- 当前结论：本轮 adoption 只固化规则，不修改 `scripts/**` 或 `test/**`。
- 暂缓原因：需要单独任务评估协议、错误分类、runtime 接入点和测试范围。
- 触发复议条件：准备修改 `workflow:install` root validation，或发现维护者再次尝试 self-install。
- 明确不做范围：本轮不实现 guard，不修改 runtime 脚本。

### DEFER-002: External docs evidence 协议化

- 状态：deferred
- 背景：任务 `001` 已在 4 个核心 skill 模板中稳定落地 `External Documentation Gate`，但 evidence 当前只写入实现方案、执行记录、debug evidence 或 review finding / clean 结论。
- 当前结论：本轮不在 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 或 `templates/docs/CURRENT_TASK.md.tmpl` 中新增标准 evidence 字段或章节。
- 暂缓原因：当前需求可由模板级行为规则覆盖；提前 schema 化会扩大协议、任务包结构和生成文档变更面。
- 触发复议条件：多个任务复用后证明需要机器可读 evidence 字段，或审查 / 归档流程需要稳定读取 external docs evidence。
- 明确不做范围：本轮不新增 `CURRENT_TASK.md` 标准章节，不改协议/schema，不把 evidence 结构提升为持久 DTO。

### DEFER-003: Lifecycle runtime skills and routing

- 状态：deferred
- 背景：任务 `003` 已稳定 suspend / interrupt / resume 的第一阶段协议契约，但尚未实现 pause / resume / interrupt runtime skills。
- 当前结论：本轮不新增 lifecycle runtime skill 模板，不修改 `WORKFLOW_GUIDE` routing，不更新 `SKILL_REGISTRY` 语义，不改 runtime manifest / install / health report contract。
- 暂缓原因：runtime 行为需要在已稳定 contract foundation 之上单独设计 handoff、幂等、恢复事务和失败回滚流程。
- 触发复议条件：准备实现 pause / resume / interrupt skill，或需要让 host workflow 自动消费 paused / interrupted packages。
- 明确不做范围：本轮不触碰 `templates/skills/**`、`templates/docs/WORKFLOW_GUIDE.md.tmpl`、`scripts/workflow-runtime.ts`、`test/workflow-runtime.test.ts`。

## 🔁 已演进 / 已替代

### SUPERSEDED-001: 暂无

- 当前状态：not-applicable
- 原决策编号：无
- 后继决策编号 / 基线：无
- 生效版本 / 里程碑：无
- 变更原因：无
- 兼容 / 迁移要求：无
- 审计备注：首版 adoption baseline。

### SUPERSEDED-002: DEFER-003 已由 AD-008 落地替代

- 当前状态：accepted-and-replaced
- 原决策编号：DEFER-003
- 后继决策编号 / 基线：AD-008
- 生效版本 / 里程碑：任务 `004` / `current-task-lifecycle-runtime-skills`
- 变更原因：contract foundation 已在任务 `003` 稳定，后续任务 `004` 重新锁范围并完成 runtime skill、guide / registry routing 和 generated reference 的实现闭环。
- 兼容 / 迁移要求：继续保持不新增 dedicated resume review skill、不自动挑选 package、不扩大到 inbox / backlog artifact 或 runtime manifest / install / health report contract。
- 审计备注：保留 DEFER-003 作为历史范围边界记录；当前有效决策以后继 AD-008 为准。

### SUPERSEDED-003: DEFER-001 已由 AD-010 落地替代

- 当前状态：accepted-and-replaced
- 原决策编号：DEFER-001
- 后继决策编号 / 基线：AD-010
- 生效版本 / 里程碑：任务 `006` / `target-root-guard`
- 变更原因：target root guard 已在 install-first 边界内完成 helper、runtime 接入、shared `.git` crossing 覆盖与 self-sync unaffected 回归，不再只是 adoption 阶段的 deferred candidate。
- 兼容 / 迁移要求：继续保持 install-first-only；若未来要扩大到其他 root 参数入口、source-repair 等价流程或 protocol-level named error，必须单独开任务并重新锁范围。
- 审计备注：保留 DEFER-001 作为 adoption 阶段“先不实现 guard”的历史边界记录；当前有效决策以后继 AD-010 为准。

## ❌ 已否决

### REJECTED-001: 将 source repo 作为 target root 执行 install

- 状态：rejected
- 背景：曾讨论是否把 `$target` 设为 `vibe-coding-workflow-system` 来让本仓库自用 workflow-system。
- 否决原因：会混淆 source repo 与 target repo ownership，带来 install-state、managed-file drift repair、target-owned facts 覆盖风险。
- 替代方案：source repo 执行 `gen:all`、`workflow:sync --root . --host <host> --write`、`workflow:health --root .`，并通过 adoption 建立 live docs。
- 如果再次被提出时的默认处理：先引用 AD-001 和 CONTRACTS 中 source/target isolation，不直接执行。

### REJECTED-002: 手工编辑 generated reference outputs

- 状态：rejected
- 背景：任务 `003` 中 `templates/docs/CURRENT_TASK.md.tmpl` 新增 lifecycle / resume gate 字段后，`docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 出现 freshness drift。
- 否决原因：generated reference outputs 是生成证据，不承载 live facts；手工编辑会破坏 templates / scripts -> generated reference -> freshness 的结构变更流。
- 替代方案：仅通过 `bun run gen:workflow-docs` 或 `bun run gen:all` 同步单一 Conditional File，并用 diff 证明只同步模板新增字段。
- 如果再次被提出时的默认处理：引用 CONTRACTS 中 generated-only 边界；除非协议 / schema / templates / generator 已变更并通过 freshness 验证，否则不手改 generated 文件。

### REJECTED-003: 将 CURRENT_TASK lifecycle foundation 扩大为一般 generated maintenance

- 状态：rejected
- 背景：任务 `003` 只允许同步 `docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 这一单一 Conditional File。
- 否决原因：其他 `docs/workflow/generated/**` 或 `docs/workflow/SKILL_REGISTRY.md` diff 表示影响面超过当前任务边界，可能把 registry、guide、runtime 或 skill template 工作混入 contract foundation。
- 替代方案：若 `bun run gen:all` 产生其他 generated / registry diff，停止并回到 `/lock-scope` 或拆后续任务。
- 如果再次被提出时的默认处理：先检查 diff 范围；超出单一 Conditional File 时不得继续作为任务 `003` 收尾处理。
