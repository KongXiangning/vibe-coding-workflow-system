# API Inventory

## 盘点规则

- 本文件记录可被外部调用或被 target repo 依赖的命令、脚本、文件契约和 host runtime surfaces。
- 本仓库未发现 HTTP 服务 API；此处的 API 主要是 CLI/script contract、模板/schema contract 与 generated artifact contract。

## CLI / Script Contract

| API | 类型 | 当前语义 | 消费者 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `bun run gen:workflow-skills` | CLI script | 渲染 / 校验 workflow skill reference outputs。 | source repo 维护者；CI；target render 流程 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `bun run gen:workflow-docs` | CLI script | 渲染 / 校验 workflow doc reference outputs。 | source repo 维护者；CI；target render 流程 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `bun run gen:registry` | CLI script | 生成 skill registry。 | source repo 维护者；CI | confirmed | `package.json`; `docs/workflow/SKILL_REGISTRY.md` |
| `bun run gen:all` | CLI script | 顺序执行 skills、docs、registry 生成。 | source repo 维护者；target adoption 后 re-render | confirmed | `package.json`; `README.md` |
| `bun run validate:protocol` | CLI script | 执行 protocol-layer validation。 | source repo 维护者；CI | confirmed | `package.json`; `.workflow-system/PROJECT_PROFILE.yaml` |
| `bun run validate:freshness` | CLI script | 检查 generated reference outputs fresh。 | source repo 维护者；CI | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md §14` |
| `bun run test:workflow-all` | CLI script | 执行 generator、runtime、validation、task identity 等测试集合。 | source repo 维护者；CI | confirmed | `package.json` |
| `bun run workflow:health` | CLI script | 检查 profile、host、freshness、protocol validation。 | source repo 与 target repo operator | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |
| `bun run workflow:manifest --json` | CLI script | 输出 target import contract / manifest。 | target install operator | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |
| `bun run workflow:pack --json` | CLI script | 打包 workflow-system bundle。 | target install operator | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |
| `bun run workflow:install --bundle <dir> --root <target>` | CLI script | 将 install surface 和 bootstrap skills 安装到 target repo。 | target repo operator | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |
| `bun run workflow:sync --root <target> --host <host> --write` | CLI script | 将 generated skills 同步到 host runtime namespace。 | source repo operator；target repo operator | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17.4` |

## Install Drift Repair API

| API / flag | 适用场景 | 当前语义 | 限制 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `workflow:install --dry-run --json --replace-managed-drift` | 已安装并完成 bootstrap/adoption 的 target repo 报告 `local_drift`，且 drift 被确认只发生在 install-state 中 `replace-managed` 管理项。 | 允许 install 用 bundle 替换或裁剪 `replace-managed` 条目，例如协议/schema 文件、runtime scripts、templates 等 workflow-system 管理面。 | 不得修复 `package.json` 或 `.workflow-system/PROJECT_PROFILE.yaml` merge-managed drift；不得绕过 `frozen_path`、`contract_conflict`、`incompatible_target`；不得重做项目事实盘点。 | confirmed | `README.md`; `vibe-coding/README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17.3`; `scripts/workflow-runtime.ts` |
| `workflow:install --dry-run --json --repair-bootstrap-drift` | 已安装 target repo 的 bootstrap skill 安装面出现 drift。 | 允许重新渲染或裁剪 install 阶段预装的 bootstrap skills，范围限于 install-state 中 `bootstrap-skill-install` 条目。 | 只修 `.claude/skills/workflow-system-*` / `.codex/skills/workflow-system-*` 等 bootstrap skill 安装面；不代表重新初始化项目；不覆盖已存在的 `AGENTS.md` / `CLAUDE.md`。 | confirmed | `README.md`; `vibe-coding/README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17.3`; `scripts/workflow-runtime.ts` |
| `workflow:install --replace-managed-drift --repair-bootstrap-drift` | 对上述 dry-run 计划完成人工复核后应用修复。 | 同时放开 workflow-system managed files 和 bootstrap skill install surface 的受限修复。 | 必须先 dry-run 并确认 planned writes / deletes 符合预期；这些 flag 不初始化 target facts，不执行 inventory/adoption。 | confirmed | `README.md`; `vibe-coding/README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17.3` |

## Host Runtime API

| Surface | 当前语义 | 消费者 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| `.claude/skills/workflow-system-*/SKILL.md` | Claude 侧 workflow skill runtime namespace。 | Claude host | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md §17.4`; `README.md` |
| `.codex/skills/workflow-system-*/SKILL.md` | Codex 侧 workflow skill runtime namespace。 | Codex host | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md §17.4`; `vibe-coding/README.md` |
| `.factory/skills/workflow-system-*/SKILL.md` | Factory 侧 workflow skill runtime namespace。 | Factory host | confirmed | `.workflow-system/PROJECT_PROFILE.yaml`; `.workflow-system/WORKFLOW_PROTOCOL.md §17.4` |

## File / Schema Contract

| Surface | 当前语义 | 兼容承诺 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| `.workflow-system/WORKFLOW_PROTOCOL.md` | 协议、阶段、生成、验证、runtime 和传播治理的正式来源。 | 变更必须先在协议登记，再传播到模板/脚本/测试。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `.workflow-system/FILE_SCHEMAS.md` | workflow 文档结构和 required headings 的正式来源。 | 文档模板和校验必须与 schema 对齐。 | confirmed | `.workflow-system/FILE_SCHEMAS.md` |
| `.workflow-system/PROJECT_PROFILE.yaml` | 项目级变量、路径、边界、validation matrix。 | source repo facts 不应被 target repo facts 覆盖。 | confirmed | `.workflow-system/PROJECT_PROFILE.yaml`; `AGENTS.md` |
| `templates/docs/*.md.tmpl` | 文档模板输入。 | 不得新增 schema 未声明结构。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md`; `templates/docs/**` |
| `templates/skills/*.SKILL.md.tmpl` | skill 模板输入。 | reads/writes/handoff 必须满足协议。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md`; `templates/skills/**` |
| `docs/workflow/generated/**` | source-repo reference render。 | freshness 通过才可作为参考证据；不作为 target live docs。 | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §14` |

## HTTP / Network API

| API | 状态 | 证据 |
| --- | --- | --- |
| HTTP 服务接口 | not-applicable | 未发现 server framework、route 文件或 HTTP dependency。 |
| WebSocket / RPC / GraphQL | not-applicable | 未发现相关依赖或入口。 |
| 外部 SaaS API 集成 | unknown | 仓库无明确集成实现；GitHub/CI 可能存在于外部环境但不在当前文件事实中。 |

## Unknown Consumers

- 已安装到外部 target repo 的历史 bundle 消费者未知。
- 外部 CI 工作流文件未在当前文件清单中发现；是否存在远端 CI 配置未知。
- 其他宿主或工具是否直接读取 generated docs/skills，当前仓库事实不足以确认。
