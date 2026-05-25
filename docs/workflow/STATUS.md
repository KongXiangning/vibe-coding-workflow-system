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

## 🔨 正在开发

- [ ] source repo self-adoption baseline：将 inventory 结论固化为 live workflow docs。
- [ ] 明确 source-repo quality gate 与 target-project validation slots 的长期分层。

## 📋 待开发

- [ ] 评估是否需要 `scripts/guard-target-root.ts` 或等价 guard。
- [ ] 如需要 guard，补协议、runtime 实现和测试。
- [ ] 评估是否需要 source-repo-specific CI gate，而不是绑定 target-project slots。

## ⚠️ 已知风险 / 观察点

- source repo / target project 身份混淆：禁止 `workflow:install --root .`。
- validation layer 混淆：source repo 不绑定 `owner: target-project` slots。
- generated/live docs 混淆：`docs/workflow/generated/**` 是 reference render，`docs/workflow/*.md` 是 live governance docs。
- docs taxonomy 混淆：`docs/workflow/` 只放治理管理面；产品、业务、方法论、使用说明放非 workflow 目录。
- 外部 target repo 的历史安装版本与兼容窗口未知。
- `docs/workflow/generated/workflow-skills/{plan-implementation,implement-current-step,investigate-root-cause,review-implementation}.SKILL.md` 已随模板生成链派生更新；必须继续保持 generated 文件只由生成器更新。
- lifecycle runtime skills、routing、guide / registry 扩展、inbox / backlog artifact 与 runtime manifest / install / health report contract 仍未进入任务 `003` 范围；后续如需实现必须单独开任务并重新锁范围。

## ❌ 已移除 / 推迟

- [ ] self-install 等价流程：当前版本不支持；如未来需要，必须先设计新协议和 runtime 保护。
- [ ] project-level target slots 绑定为 source repo 命令：当前不采用。

## 🔜 下一检查点

- 继续任务 `003` 收尾：按当前 handoff 判断是否需要同步 `CONTRACTS.md` / `DECISIONS.md`；若无新增稳定接口记录需求，准备交付总结并进入任务关闭流程。
- 若要实现 target root guard，先开独立任务并锁定 `scripts/**`、`test/**`、协议和基线影响范围。
- adoption 后运行 `bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。

## 最近更新记录

- 2026-05-26：任务 `003` / `current-task-suspend-resume-contract-foundation` 已完成第一阶段协议契约、schema、模板、resolver、bootstrap output、suspended package validation 与 protocol-level synthesized check；`docs/workflow/generated/workflow-docs/CURRENT_TASK.md` 已按 Conditional File 由生成器同步。最终回归通过：`bun run gen:all`、`bun run test:workflow-all`（201 pass / 0 fail）、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。Release mode 为 none，发布后状态不适用。
- 2026-05-22：任务 `002` / `supersede-current-task-skill` 已完成模板、registry、guide、聚焦测试、generated outputs 和最终复核；`review-diff`、`review-implementation`、`verify-contracts` 结论为 clean，`bun run gen:all`、`bun run test:workflow-all`、`bun run validate:protocol`、`bun run validate:freshness` 通过。Release mode 为 none，发布后状态不适用。
- 2026-05-13：任务 `001` / `ctx7-skill-gate` 已完成步骤 9-11 并通过回归；`bun run gen:workflow-skills --dry-run`、`bun run gen:registry --dry-run`、`bun run test:workflow-skills`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .` 均通过。Release mode 为 none，发布后状态不适用。
- 2026-05-13：任务 `001` / `ctx7-skill-gate` 已完成四个目标模板的 `External Documentation Gate` 接入，并完成四模板一致性检查与最小生成测试；当时进入步骤 9-11 的生成 / registry dry-run、generated reference 确认和任务级回归，后续已完成。
- 2026-05-12：任务 `001` / `ctx7-skill-gate` 进入开发中；`plan-implementation` 模板已加入 `External Documentation Gate`，并完成 `RI-001` 失败处理修复。局部验证通过：`gen:workflow-skills --dry-run`、`gen:registry --dry-run`、`test:workflow-skills`、`validate:protocol`、`validate:freshness`。
- 2026-05-07：建立 source repo self-adoption 首版状态基线。
