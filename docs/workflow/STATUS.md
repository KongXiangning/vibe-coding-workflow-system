# docs/workflow/STATUS.md

## 项目概览

- 项目：vibe-coding-workflow-system
- 项目类型：ai-engineering-workflow
- 技术栈：TypeScript, Markdown
- 核心目录：scripts, test
- 测试命令：bun run test:workflow-all, bun run validate:protocol, bun run validate:freshness
- 当前版本：0.14.5

## ✅ 已完成且稳定

- [x] source repo 画像、协议、schema、模板、生成器、runtime 和测试入口已存在。
- [x] generated reference outputs 由 `docs/workflow/generated/**` 和 `docs/workflow/SKILL_REGISTRY.md` 承载。
- [x] `legacy-inventory` 产物已建立在 `docs/adoption/**`。
- [x] source repo self-use 不走 self-install 的边界已进入 adoption 基线。
- [x] `docs/workflow/` 治理管理面与 source repo 产品 / 业务文档目录边界已进入 adoption 基线。
- [x] 任务 `001` / `ctx7-skill-gate`：4 个核心 workflow skill 已接入条件性 `External Documentation Gate`；`plan-implementation`、`implement-current-step`、`investigate-root-cause`、`review-implementation` 模板及对应 generated reference outputs 已同步，回归通过。
- [x] 任务 `002` / `supersede-current-task-skill`：`supersede-current-task` 已加入 workflow skill 模板集；registry 顺序、高风险审计列表、`WORKFLOW_GUIDE` 路由、聚焦测试与 generated reference outputs 已同步，`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness` 通过。
- [x] 任务 `003` / `current-task-suspend-resume-contract-foundation`：`CURRENT_TASK` 暂停 / 中断 / 恢复第一阶段协议契约已落地；`WORKFLOW_PROTOCOL`、`FILE_SCHEMAS`、`CURRENT_TASK` 模板、task identity resolver、bootstrap task identity output、suspended package validator 与 protocol-level validation flow 已同步；单一 `CURRENT_TASK.md` generated reference render 已由生成器同步，`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过。
- [x] 任务 `004` / `current-task-lifecycle-runtime-skills`：`pause-current-task`、`interrupt-current-task`、`resume-paused-task`、`resume-interrupted-task` 四个 runtime skill 已落地；`review-current-task` 已成为 resumed task 的首个强制消费者；`WORKFLOW_GUIDE`、`SKILL_REGISTRY`、对应 generated reference outputs 与聚焦测试已同步；任务已归档到 `TASKS/TASK-004-current-task-lifecycle-runtime-skills.md`，`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过。
- [x] 任务 `005` / `ownership-aware-root-cause-routing`：`investigate-root-cause`、`run-regression`、`sync-review-findings` 与 `WORKFLOW_GUIDE` 已收敛 ownership-aware routing；canonical route 闭集、guard-aware handoff、matching suspended package evidence 读取、report-only terminal rule、finding queue isolation 与 active-owner guard 指引已落地，相关 generated reference outputs 与 `SKILL_REGISTRY.md` 已同步；`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过。
- [x] 任务 `006` / `target-root-guard`：`workflow:install` 已新增 fail-closed target-root guard，能够拒绝 source repo self-install、source parent / ancestor root 与 shared `.git` root crossing，同时保留 isolated target install 与 source repo self-sync allow path；`scripts/guard-target-root.ts`、`installWorkflowBundle()` 集成、runtime / guard tests 与 live `CURRENT_TASK.md` 已同步，`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过。
- [x] 任务 `007` / `capture-work-item-inbox`：已新增 `capture-work-item` skill template、`TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md` record-only artifact contract、validator fail-closed 校验，以及 `WORKFLOW_GUIDE` / `SKILL_REGISTRY` 的阶段 1 record-only branch 暴露；generated reference outputs 已同步到 `docs/workflow/generated/workflow-skills/capture-work-item.SKILL.md`、`docs/workflow/generated/workflow-docs/WORKFLOW_GUIDE.md` 与 `docs/workflow/SKILL_REGISTRY.md`。`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过。
- [x] 任务 `008` / `methodology-docs-cover-003-007-skill-branches`：已补齐 `vibe-coding/vibe-coding-methodology.md` 与 `vibe-coding/vibe-coding-workflow.md` 对任务 `003-007` 新增 workflow 分支的高层叙事；已完成全文检索复核与归档，`bun run test:workflow-all`（209 pass / 0 fail）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过，归档文件为 `TASKS/TASK-008-methodology-docs-cover-003-007-skill-branches.md`。

## 🔨 正在开发

- [ ] source repo self-adoption baseline：将 inventory 结论固化为 live workflow docs。
- [ ] 明确 source-repo quality gate 与 target-project validation slots 的长期分层。

## 📋 待开发

- [ ] 评估是否需要 source-repo-specific CI gate，而不是绑定 target-project slots。

## ⚠️ 已知风险 / 观察点

- source repo / target project 身份混淆：禁止 `workflow:install --root .`。
- target-root guard 已在任务 `006` 收紧 source self-install、ancestor root 和 shared `.git` crossing；如未来要扩大到其他 root 参数入口、协议级错误分类或更宽的 source-repair 语义，仍需单独开任务并重新锁范围。
- validation layer 混淆：source repo 不绑定 `owner: target-project` slots。
- generated/live docs 混淆：`docs/workflow/generated/**` 是 reference render，`docs/workflow/*.md` 是 live governance docs。
- docs taxonomy 混淆：`docs/workflow/` 只放治理管理面；产品、业务、方法论、使用说明放非 workflow 目录。
- 外部 target repo 的历史安装版本与兼容窗口未知。
- `docs/workflow/generated/workflow-skills/{plan-implementation,implement-current-step,investigate-root-cause,review-implementation}.SKILL.md` 已随模板生成链派生更新；必须继续保持 generated 文件只由生成器更新。
- lifecycle runtime skills、generated guide / registry 与 resumed-task review routing 已在任务 `004` 收敛；后续若要继续扩到 inbox / backlog artifact 或 runtime manifest / install / health report contract，仍必须单独开任务并重新锁范围。
- ownership-aware route 闭集、guard-aware alias 和 finding queue isolation 已在任务 `005` 收敛；后续若要继续扩大到 protocol / schema / runtime 级别的 owner state、manifest 或自动恢复策略，仍必须单独开任务并重新锁范围。
- `capture-work-item` 与 `TASKS/inbox/**` 已稳定为 record-only branch / artifact family；后续若要继续扩到 promote、prioritization、`DOCUMENT_CATALOG.md`、task identity contract、runtime manifest / install / health report 或 lifecycle state，仍必须单独开任务并重新锁范围。

## ❌ 已移除 / 推迟

- [ ] self-install 等价流程：当前版本不支持；如未来需要，必须先设计新协议和 runtime 保护。
- [ ] project-level target slots 绑定为 source repo 命令：当前不采用。

## 🔜 下一检查点

- 任务 `005` 已完成 ownership-aware root-cause / regression / review-finding routing 与 guide 显式化；如需继续推进 owner routing 相关工作，应评估是否需要 protocol / schema / runtime 级别的 dedicated owner state、自动恢复策略或 inbox / backlog artifact，并单独开任务重新锁范围。
- 任务 `006` 已完成 target root guard；如需继续扩大到 `workflow:install` 之外的 root 参数入口、协议级错误分类或 source-repair 等价流程，必须单独开任务并重新锁范围。
- 任务 `007` 已完成 record-only `capture-work-item` / inbox artifact 能力；如需继续推进 promote / backlog triage、`DOCUMENT_CATALOG.md` 收录、task identity 感知、或 runtime/host routing 扩面，必须单独开任务重新锁范围。
- 任务 `008` 已完成高层方法论 / 工作流叙事补全；如需继续处理需求文档漂移、项目类型专用宿主指引或 Codex `.agents/skills` 迁移，应单独创建新任务并重新锁定范围。
- adoption 后运行 `bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。

## 最近更新记录

- 2026-05-26：任务 `003` / `current-task-suspend-resume-contract-foundation` 已完成第一阶段协议契约、schema、模板、resolver、bootstrap output、suspended package validation 与 protocol-level synthesized check；`docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 已按 Conditional File 由生成器同步。最终回归通过：`bun run gen:all`、`bun run test:workflow-all`（201 pass / 0 fail）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。Release mode 为 none，发布后状态不适用。
- 2026-05-26：任务 `004` / `current-task-lifecycle-runtime-skills` 已完成四个 lifecycle runtime skill、`review-current-task` 的 resume gate 消费扩展、`WORKFLOW_GUIDE` / `SKILL_REGISTRY` 路由同步、generated reference outputs 同步、全量回归、完成审核修正与归档；归档文件为 `TASKS/TASK-004-current-task-lifecycle-runtime-skills.md`。最终回归通过：`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`（201 pass / 0 fail）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。Release mode 为 none，发布后状态不适用。
- 2026-05-27：任务 `005` / `ownership-aware-root-cause-routing` 已完成 `investigate-root-cause`、`run-regression`、`sync-review-findings` 与 `WORKFLOW_GUIDE` 的 ownership-aware routing 收敛；canonical route 闭集、guard-aware alias、matching suspended package evidence 读取、report-only terminal rule、finding queue isolation 与 guide 中的 active-owner guard 指引已同步到模板、generated reference outputs、`SKILL_REGISTRY.md`、`CONTRACTS.md`、`DECISIONS.md` 与 `LESSONS.md`。最终回归通过：`bun run gen:all`、`bun run test:workflow-skills`、`bun run test:registry`、`bun run test:workflow-docs`、`bun run test:workflow-all`（201 pass / 0 fail）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。Release mode 为 none，发布后状态不适用。
- 2026-05-27：任务 `006` / `target-root-guard` 已完成 fail-closed target-root guard helper、`installWorkflowBundle()` preflight 接入、shared `.git` crossing / self-sync unaffected 覆盖，以及第二轮 `review-diff`、`review-implementation`、`verify-contracts` 与 `/run-regression`。最终回归通过：`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。Release mode 为 none，发布后状态不适用。
- 2026-07-14：任务 `008` / `methodology-docs-cover-003-007-skill-branches` 已完成高层文档补全、收尾回归与归档；`bun run test:workflow-all`（209 pass / 0 fail）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过。Release mode 为 none，发布后状态不适用。
- 2026-05-22：任务 `002` / `supersede-current-task-skill` 已完成模板、registry、guide、聚焦测试、generated outputs 和最终复核；`review-diff`、`review-implementation`、`verify-contracts` 结论为 clean，`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness` 通过。Release mode 为 none，发布后状态不适用。
- 2026-05-13：任务 `001` / `ctx7-skill-gate` 已完成步骤 9-11 并通过回归；`bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .` 均通过。Release mode 为 none，发布后状态不适用。
- 2026-05-13：任务 `001` / `ctx7-skill-gate` 已完成四个目标模板的 `External Documentation Gate` 接入，并完成四模板一致性检查与最小生成测试；当时进入步骤 9-11 的生成 / registry dry-run、generated reference 确认和任务级回归，后续已完成。
- 2026-05-12：任务 `001` / `ctx7-skill-gate` 进入开发中；`plan-implementation` 模板已加入 `External Documentation Gate`，并完成 `RI-001` 失败处理修复。局部验证通过：`gen:workflow-skills --dry-run`、`gen:registry --dry-run`、`test:workflow-skills`、`validate:protocol`、`validate:freshness`。
- 2026-05-07：建立 source repo self-adoption 首版状态基线。
