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

## 🔨 正在开发

- [ ] source repo self-adoption baseline：将 inventory 结论固化为 live workflow docs。
- [ ] 明确 source-repo quality gate 与 target-project validation slots 的长期分层。

## 📋 待开发

- [ ] 评估是否需要 `scripts/guard-target-root.ts` 或等价 guard。
- [ ] 如需要 guard，补协议、runtime 实现和测试。
- [ ] 评估是否需要 source-repo-specific CI gate，而不是绑定 target-project slots。
- [ ] 后续按任务流创建 `docs/workflow/CURRENT_TASK.md`。

## ⚠️ 已知风险 / 观察点

- source repo / target project 身份混淆：禁止 `workflow:install --root .`。
- validation layer 混淆：source repo 不绑定 `owner: target-project` slots。
- generated/live docs 混淆：`docs/workflow/generated/**` 是 reference render，`docs/workflow/*.md` 是 live governance docs。
- docs taxonomy 混淆：`docs/workflow/` 只放治理管理面；产品、业务、方法论、使用说明放非 workflow 目录。
- 外部 target repo 的历史安装版本与兼容窗口未知。

## ❌ 已移除 / 推迟

- [ ] self-install 等价流程：当前版本不支持；如未来需要，必须先设计新协议和 runtime 保护。
- [ ] project-level target slots 绑定为 source repo 命令：当前不采用。

## 🔜 下一检查点

- 创建首个 `CURRENT_TASK.md`，进入日常任务流。
- 若要实现 target root guard，先开独立任务并锁定 `scripts/**`、`test/**`、协议和基线影响范围。
- adoption 后运行 `bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .`。

## 最近更新记录

- 2026-05-07：建立 source repo self-adoption 首版状态基线。
