# Adoption Report

## 报告范围

- 本报告汇总 `legacy-inventory` 对 `vibe-coding-workflow-system` 源仓库的盘点结果。
- 输入材料包括 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`templates/docs/WORKFLOW_GUIDE.md.tmpl`、`vibe-coding/*.md`、根目录 `README.md`、`package.json`、`scripts/`、`test/`。
- 本报告不执行 `/adopt-existing-project` 的写入范围，不创建 `CURRENT_TASK.md`，不修改 `CONTRACTS.md`。

## 关键结论

| 结论 | 状态 | 证据 |
| --- | --- | --- |
| 本仓库已经具备 source repo 画像、正式协议、文件 schema、模板、生成器、runtime、测试和 reference outputs。 | confirmed | `.workflow-system/PROJECT_PROFILE.yaml`; `README.md`; `package.json` |
| 本仓库要自用 workflow-system 时，不应把 `$target` 设为自身并执行 self-install。 | inferred | `.workflow-system/WORKFLOW_PROTOCOL.md §17`; source repo / target repo 分工; 本轮用户澄清 |
| 本仓库可通过生成和 host sync 让本地 Codex/Claude runtime 可调用 workflow skills。 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md §17.4`; `workflow:sync` 语义 |
| `legacy-inventory -> adopt-existing-project` 仍适用于本仓库作为“已有项目”接管自身治理基线。 | confirmed | `vibe-coding/README.md`; `WORKFLOW_GUIDE.md.tmpl`; generated skill metadata |
| 方法论文档提供需求、思想和质量控制背景；正式规则仍以 `.workflow-system/**`、`templates/**` 和脚本实现为准。 | confirmed | `vibe-coding/README.md`; `vibe-coding/vibe-coding-methodology.md` |
| source-repo 质量控制端与 target-project 消费端必须物理路径隔离、命令语义隔离、validation layer 隔离。 | inferred | `.workflow-system/WORKFLOW_PROTOCOL.md §16`; `.workflow-system/WORKFLOW_PROTOCOL.md §17`; 本轮用户确认的架构方向 |

## 证据摘要

| 证据 | 用途 |
| --- | --- |
| `README.md` | source layout、核心命令、target install/adoption/sync 流程。 |
| `vibe-coding/README.md` | 方法论文档入口、目标项目 install/adoption 说明、source repo / target repo 边界。 |
| `vibe-coding/vibe-coding-workflow.md` | 从 source repo 到 target repo，再到日常 8 阶段任务流的执行思想。 |
| `vibe-coding/vibe-coding-methodology.md` | 边界、任务、状态、决策、传播治理和失控停止机制的设计背景。 |
| `vibe-coding/vibe-coding-quality-system.md` | 契约锁定、范围锁定、状态追踪、回归验证和失控诊断的质量体系。 |
| `.workflow-system/WORKFLOW_PROTOCOL.md` | 正式协议、生成链、hybrid sync、validation matrix、runtime install/sync contract。 |
| `.workflow-system/FILE_SCHEMAS.md` | workflow 文档 required headings 和结构契约。 |
| `templates/docs/WORKFLOW_GUIDE.md.tmpl` | 目标项目操作手册结构和 skill 使用入口。 |
| `package.json` | 实际命令入口、Bun/ESM/runtime/test scripts。 |

## 推断与限制

| 项目 | 判断 | 依据 | 限制 |
| --- | --- | --- | --- |
| source repo self-use 应先 sync skills，再执行 inventory/adoption | inferred | source repo 没有 install 阶段预装 bootstrap skills；`workflow:sync` 可将 generated skills 写入 host namespace。 | 这是一条 self-use 操作建议，尚未在协议中作为显式契约单列。 |
| live workflow docs 应由 adoption 阶段建立 | inferred | FILE_SCHEMAS / templates 已提供结构；本轮需求是让规范开发自身使用 workflow。 | 是否提交全部 live docs 需要用户/维护者确认。 |
| project-level validation slots 不应用于 source repo quality gates | inferred | profile 当前保留 target-project unbound slots；协议定义 project-layer entrypoints 由 target project 在 Adoption A4 绑定。 | source repo 若需要额外质量 gate，应使用 source-repo-specific 命令或后续协议扩展，不应复用 target-project slots。 |
| target root guard 尚未实现 | unknown | 当前讨论提出 `scripts/guard-target-root.ts` 方案，但本轮 inventory 不改脚本。 | 需要后续协议/实现任务确认 guard 规则与接入点。 |

## 冲突与风险

| 风险 | 分类 | 说明 |
| --- | --- | --- |
| self-install 风险 | fragile | `workflow:install --root .` 会把 source repo 当 target repo，可能引入 install-state 和 managed-file drift repair 语义混淆。 |
| source/target 路径交叉 | fragile | target root 若等于 source root、source parent，或与当前 source repo `.git` 交叉，会破坏 install/adoption/sync ownership。 |
| validation layer 混淆 | fragile | 将 target-project slots 绑定为 source repo 命令会混淆 protocol-level validation 和 project-level validation 的 owner 与 gate 语义。 |
| 方法论误用 | fragile | `vibe-coding/*.md` 里的概念不能直接新增为 schema、field、error code 或模板结构。 |
| generated/live docs 混淆 | fragile | `docs/workflow/generated/**` 是 reference render；live `docs/workflow/*.md` 才承载当前项目运行状态。 |
| workflow docs / 产品文档混淆 | fragile | `docs/workflow/*.md` 应只承载治理管理面；source repo 产品说明、方法论正文、用户指南和运维材料应放在 `README.md`、`vibe-coding/**` 或其他非 workflow docs 目录。 |
| 外部 target 兼容未知 | unknown | 已安装历史版本的外部 target repo 不在当前仓库事实中。 |

## 建议固化项

| 建议 | 目标文档 | 状态 |
| --- | --- | --- |
| 固化“source repo 不 self-install；self-use 通过 gen/sync + legacy/adopt 完成”的操作边界。 | `docs/workflow/CONTRACTS.md` 或 `docs/workflow/WORKFLOW_GUIDE.md` | 待 `/adopt-existing-project` 确认 |
| 固化 source-repo 质量控制端与 target-project 消费端的隔离规则：物理路径隔离、命令语义隔离、validation layer 隔离。 | `docs/workflow/CONTRACTS.md`、`docs/workflow/BASELINES.md`、`docs/workflow/WORKFLOW_GUIDE.md`、`docs/adoption/RISK_REGISTER.md` | 待 `/adopt-existing-project` 确认 |
| 固化 `docs/workflow/` 只放治理管理面，source repo 产品 / 业务文档放 `README.md`、`vibe-coding/**`、`docs/product/**`、`docs/guides/**`、`docs/ops/**` 等非 workflow 目录。 | `docs/workflow/CONTRACTS.md`、`docs/workflow/WORKFLOW_GUIDE.md`、`docs/workflow/DOCUMENT_CATALOG.md` | 待 `/adopt-existing-project` 确认 |
| 建立 source repo 的 live `ROADMAP.md`、`STATUS.md`、`CONTRACTS.md`、`BASELINES.md`、`DECISIONS.md`。 | `docs/workflow/**` | 待 `/adopt-existing-project` |
| 将本次 inventory 中 stable / fragile / unknown 分类写入治理基线。 | `STATUS.md` / `ROADMAP.md` | 待 `/adopt-existing-project` |
| 保持 source repo 不绑定 target-project validation slots；如需要 source-repo-specific gates，另立协议或脚本入口。 | `.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/BASELINES.md` | 待确认 |
| 评估 `scripts/guard-target-root.ts` 或等价 guard，阻止 `workflow:install --root .` 和 source/target root 交叉。 | `.workflow-system/WORKFLOW_PROTOCOL.md`、`scripts/**`、`test/**` | 后续实现任务 |

## 下一步

1. 已执行 `/adopt-existing-project`，并消费本目录 inventory 产物建立首版 source repo live governance baseline。
2. 后续执行 `/create-current-task`，为下一轮协议、模板、runtime 或文档任务建立 `docs/workflow/CURRENT_TASK.md`。
3. adoption 完成后运行：

```powershell
bun run gen:all
bun run workflow:sync --root . --host codex --write
bun run workflow:sync --root . --host claude --write
bun run workflow:health --root .
```

## Adoption 写入摘要

| 文件 | 写入状态 | 说明 |
| --- | --- | --- |
| `docs/workflow/CONTRACTS.md` | created | 固化 source/target 隔离、generated/live docs 边界、docs taxonomy、runtime/install/sync 契约。 |
| `docs/workflow/BASELINES.md` | created | 固化 source repo quality gates、target-project slots 分离、source/target root separation 和 generated mutation guard。 |
| `docs/workflow/STATUS.md` | created | 记录 self-adoption 当前状态、风险、下一检查点。 |
| `docs/workflow/DECISIONS.md` | created | 记录禁止 self-install、不复用 target-project slots、`docs/workflow/` 只承载治理管理面等决策。 |
| `docs/workflow/ROADMAP.md` | updated by inventory | 已承载 self-adoption roadmap 和后续 hardening 候选事项。 |
| `AGENTS.md` / `CLAUDE.md` | updated | 补充 source repo governance boundaries 和常用检查入口。 |
| `.workflow-system/PROJECT_PROFILE.yaml` | unchanged | 当前 profile 已能代表 source repo facts；未绑定 target-project slots。 |
