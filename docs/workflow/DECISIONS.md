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

## 🔁 已演进 / 已替代

### SUPERSEDED-001: 暂无

- 当前状态：not-applicable
- 原决策编号：无
- 后继决策编号 / 基线：无
- 生效版本 / 里程碑：无
- 变更原因：无
- 兼容 / 迁移要求：无
- 审计备注：首版 adoption baseline。

## ❌ 已否决

### REJECTED-001: 将 source repo 作为 target root 执行 install

- 状态：rejected
- 背景：曾讨论是否把 `$target` 设为 `vibe-coding-workflow-system` 来让本仓库自用 workflow-system。
- 否决原因：会混淆 source repo 与 target repo ownership，带来 install-state、managed-file drift repair、target-owned facts 覆盖风险。
- 替代方案：source repo 执行 `gen:all`、`workflow:sync --root . --host <host> --write`、`workflow:health --root .`，并通过 adoption 建立 live docs。
- 如果再次被提出时的默认处理：先引用 AD-001 和 CONTRACTS 中 source/target isolation，不直接执行。
