# Architecture Inventory

## 盘点规则

- 本文件是 `legacy-inventory` 的当前事实版输出，只记录仓库中可由代码、配置、协议或文档证明的事实。
- 结论状态使用 `confirmed`、`inferred`、`unknown`。
- 方法论文档用于解释设计意图；当它与 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 或脚本实现冲突时，正式规范源和实现优先。

## 项目定位

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| 本仓库是 `vibe-coding-workflow-system` 的独立源码仓库。 | confirmed | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |
| 仓库职责是维护 workflow governance 的协议、schema、模板、生成器、runtime install/sync、测试和 source-repo reference render。 | confirmed | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml`; `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `vibe-coding/` 下方法论文档是背景材料，不是生成器唯一规范源。 | confirmed | `vibe-coding/README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |

## 运行时与技术栈

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| 运行环境使用 Bun，`package.json` 声明 `bun >=1.0.0`。 | confirmed | `package.json` |
| 项目语言主体是 TypeScript 与 Markdown。 | confirmed | `.workflow-system/PROJECT_PROFILE.yaml`; `scripts/*.ts`; `templates/**/*.tmpl` |
| 模块系统是 ESM。 | confirmed | `package.json` 的 `"type": "module"` |
| 运行依赖目前只有 `yaml`。 | confirmed | `package.json` |

## 目录职责

| 目录 / 文件 | 当前职责 | 状态 | 证据 |
| --- | --- | --- | --- |
| `.workflow-system/WORKFLOW_PROTOCOL.md` | 工作流协议、阶段、生成链、验证矩阵、runtime install/sync 规则的正式来源。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `.workflow-system/FILE_SCHEMAS.md` | workflow 治理文档章节、结构和校验要求的正式来源。 | confirmed | `.workflow-system/FILE_SCHEMAS.md` |
| `.workflow-system/PROJECT_PROFILE.yaml` | 本 source repo 的项目画像、路径、边界和 validation matrix。 | confirmed | `.workflow-system/PROJECT_PROFILE.yaml` |
| `templates/skills/*.SKILL.md.tmpl` | workflow skill 模板源。 | confirmed | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |
| `templates/docs/*.md.tmpl` | workflow 文档模板源。 | confirmed | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |
| `scripts/` | 生成、校验、打包、安装、同步、运行时健康检查和共享工具实现。 | confirmed | `README.md`; `package.json`; `scripts/*.ts` |
| `test/` | 生成器、验证模型、runtime、bootstrap 和任务身份契约测试。 | confirmed | `package.json`; `test/*.test.ts` |
| `docs/workflow/generated/**` | source-repo reference render，用于 freshness evidence，不是 target live docs。 | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `docs/workflow/SKILL_REGISTRY.md` | 由 registry 生成器维护的 skill 索引。 | confirmed | `README.md`; `package.json` |
| `vibe-coding/` | 方法论、workflow、质量体系和历史对比背景材料。 | confirmed | `vibe-coding/README.md` |
| `dist/workflow-system/**` | 打包输出。 | confirmed | `.workflow-system/PROJECT_PROFILE.yaml`; `README.md` |

### `docs/` 归属边界

| 路径 | 归属 | 性质 | 是否手改 | 用途 |
| --- | --- | --- | --- | --- |
| `docs/workflow/*.md` | source repo 自用 | live governance docs | 可以，通过 workflow skills 或 adoption 流程修改 | 记录本仓库自身的治理状态、任务、契约、决策、路线图、基线和经验。 |
| `docs/workflow/generated/workflow-docs/**` | source repo 产品化证据 | generated reference render | 不可手改 | 证明当前 doc templates 和 source profile 会渲染出什么结构骨架，用于 freshness。 |
| `docs/workflow/generated/workflow-skills/**` | source repo 产品化证据 | generated reference render | 不可手改 | 证明当前 skill templates 会渲染出什么 host runtime skill。 |
| `docs/workflow/SKILL_REGISTRY.md` | source repo 产品化证据 | generated registry | 不可手改 | 当前 workflow skill 集合索引。 |
| `docs/adoption/**` | source repo 自用 | adoption inventory / 接管材料 | 可以，通过 bootstrap/adoption skills 修改 | 本仓库作为已有项目接管自身治理基线的盘点材料。 |
| `docs/designs/**` | source repo 自用 | design baseline | 可以，通过 design/adoption skills 修改 | 如后续需要为本仓库补设计基线，放在这里。 |
| `docs/workflow/TASKS/**` | source repo 自用 | archived tasks | 可以，通过 archive skill 写入 | 本仓库自身任务历史归档。 |
| `docs/product/**`、`docs/guides/**`、`docs/ops/**` 等 | source repo 产品 / 业务文档 | human-facing docs | 可以，按对应文档规范修改 | 记录项目是什么、怎么用、怎么运维；不承载 workflow 治理状态。 |

边界规则：

- `docs/workflow/` 只放 workflow 治理管理面，不放 source repo 产品化说明、用户指南、方法论正文或业务文档。
- source repo 产品 / 业务文档应放在 `README.md`、`vibe-coding/**`、`docs/product/**`、`docs/guides/**`、`docs/ops/**` 等非 workflow 治理目录。
- `docs/workflow/*.md` 记录“项目怎么被治理”；其他 docs / README / `vibe-coding/**` 记录“项目是什么、怎么用、为什么这样设计”。
- 外部 target repo 也使用 `docs/workflow/*.md` 作为自己的 live governance docs；隔离依赖不同 repo root，而不是给 source repo 更换 workflow home。
- 同一 repo root 内必须区分 `docs/workflow/*.md` live docs 与 `docs/workflow/generated/**` generated reference。

## 源码模块盘点

| 模块 | 当前职责 | 状态 | 证据 |
| --- | --- | --- | --- |
| `scripts/gen-workflow-skills.ts` | 从 skill 模板生成 workflow skill reference outputs，并执行模板/metadata/handoff 相关校验。 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md`; 文件名与脚本入口 |
| `scripts/gen-workflow-docs.ts` | 从文档模板生成 workflow doc reference outputs，并校验文档结构与占位符处理。 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `scripts/gen-registry.ts` | 生成 `docs/workflow/SKILL_REGISTRY.md`。 | confirmed | `package.json`; `docs/workflow/SKILL_REGISTRY.md` |
| `scripts/check-freshness.ts` | 校验 generated reference outputs 与当前生成器输出一致。 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md §14` |
| `scripts/run-validation.ts` / `scripts/validation-model.ts` | 执行 protocol / project validation matrix。 | confirmed | `package.json`; `.workflow-system/PROJECT_PROFILE.yaml`; `.workflow-system/WORKFLOW_PROTOCOL.md §16` |
| `scripts/workflow-runtime.ts` | workflow health、manifest、pack、install、host sync runtime 入口。 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |
| `scripts/bootstrap-project-governance.ts` | bootstrap/adoption planning 的 dry-run 能力。 | confirmed | `package.json`; skill registry |
| `scripts/task-identity.ts` | `CURRENT_TASK.md` 中任务身份与归档路径相关契约。 | confirmed | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `scripts/workflow-doc-contracts.ts` | workflow 文档 heading/structure contract 的共享实现。 | confirmed | `.workflow-system/FILE_SCHEMAS.md`; 文件名与测试 |
| `scripts/propagation-governance.ts` | 传播治理模型/兼容性相关实现。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md §18.6`; 文件名 |
| `scripts/repo-path-patterns.ts` | repo-level path pattern 解析/匹配能力。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md` 中 path grammar 相关章节; 文件名 |

## 架构边界

| 边界 | 状态 | 证据 |
| --- | --- | --- |
| 协议和 schema 先于模板、生成器、测试变更；模板和测试不能发明未声明的结构。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md` |
| `docs/workflow/generated/**` 与 `docs/workflow/SKILL_REGISTRY.md` 不应手工编辑。 | confirmed | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |
| `workflow:install` 面向 target repo；source repo 自身不应通过 `--root .` self-install。 | inferred | `.workflow-system/WORKFLOW_PROTOCOL.md §17`; `README.md` 的 source repo / target repo 分工 |
| host runtime sync 通过 `workflow-system-*` namespace 隔离，不能覆盖 native host skills。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md §17.4`; `scripts/workflow-runtime.ts` |
| 方法论文档可以解释原则，不能替代 `.workflow-system/WORKFLOW_PROTOCOL.md` / `.workflow-system/FILE_SCHEMAS.md` / `templates/**` 成为 schema 来源。 | confirmed | `vibe-coding/README.md`; `vibe-coding/vibe-coding-methodology.md` |
| source-repo 质量控制端与 target-project 消费端必须隔离；source repo 不绑定 target-project validation slots，target project 必须使用独立 root。 | inferred | `.workflow-system/WORKFLOW_PROTOCOL.md §16`; `.workflow-system/WORKFLOW_PROTOCOL.md §17`; 本轮用户确认的架构方向 |

## 工作流链路事实

| 链路 | 当前事实 | 状态 | 证据 |
| --- | --- | --- | --- |
| source repo 生成 reference outputs | `bun run gen:all` 串联 skill、doc、registry 生成。 | confirmed | `package.json` |
| source repo 验证 | `validate:protocol`、`validate:freshness`、`test:workflow-all` 是核心检查入口。 | confirmed | `package.json`; `.workflow-system/PROJECT_PROFILE.yaml` |
| 打包到 target | `workflow:pack` 产出 bundle。 | confirmed | `README.md`; `package.json` |
| 安装到 target | `workflow:install --bundle <dir> --root <target>` 写入 install surface 和 bootstrap skills。 | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |
| target bootstrap/adoption | 新项目走 `design-baseline-init -> greenfield-init`，已有项目走 `legacy-inventory -> adopt-existing-project`。 | confirmed | `README.md`; `vibe-coding/README.md`; `WORKFLOW_GUIDE.md.tmpl` |
| adoption 后 sync | 回到 source repo 执行 `WORKFLOW_SYSTEM_ROOT=<target> bun run gen:all` 和 `workflow:sync --root <target>`。 | confirmed | `README.md`; `vibe-coding/README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |

## Stable / Fragile / Unknown / Deprecated

| 区域 | 分类 | 理由 | 证据 |
| --- | --- | --- | --- |
| `.workflow-system/WORKFLOW_PROTOCOL.md` 与 `.workflow-system/FILE_SCHEMAS.md` | stable | 正式规范源，变更会传播到模板、生成器、测试和 target install/sync 行为。 | `.workflow-system/WORKFLOW_PROTOCOL.md`; `.workflow-system/FILE_SCHEMAS.md` |
| `scripts/workflow-runtime.ts` 的 install/sync/pack/health 行为 | stable | 是 target repo 导入和 host runtime 激活的核心入口。 | `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md §17` |
| `templates/docs/**` 与 `templates/skills/**` | stable | 变更会影响 generated reference outputs 和 target runtime outputs。 | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |
| generated reference freshness | stable | freshness 是 source repo 完整性 gate。 | `README.md`; `package.json`; `.workflow-system/WORKFLOW_PROTOCOL.md §14` |
| live workflow docs for this source repo | unknown | 当前盘点前未作为正式自用治理基线固化；是否物化和由哪些 skill 管理需要 adoption 后确认。 | 当前仓库状态; 用户本轮需求 |
| target project self-install 语义 | fragile | source repo / target repo 身份混淆会影响 install-state 和 drift repair 语义。 | `.workflow-system/WORKFLOW_PROTOCOL.md §17`; `README.md` |
| 数据库、HTTP API、部署环境 | unknown | 仓库事实未显示数据库迁移、HTTP 服务或部署配置。 | `rg --files`; `package.json` |
| gstack native 历史能力 | deprecated / background | 已作为方法论或历史对比材料，不直接作为 workflow-system schema 或命令来源。 | `vibe-coding/README.md`; `vibe-coding/对比.md` |

## 待确认问题

- 是否批准为本 source repo 物化 live `docs/workflow/*.md`，并让日常规范开发使用这些 live docs。
- 是否把本 source repo 的 project-level validation slots 从 target-project unbound 状态绑定为本仓库具体命令。
- 是否需要在 `/adopt-existing-project` 阶段固化“source repo 不能 self-install，只能 self-sync / self-adopt”的显式契约。

## 待确认问题的潜在问题分析

| 待确认问题 | 若不确认 / 不处理 | 若处理方式错误 | 建议进入 adoption 的判断点 |
| --- | --- | --- | --- |
| 是否物化 live `docs/workflow/*.md` 并用于 source repo 日常开发 | 后续规范、模板、生成器和 runtime 改动仍可能只停留在对话或临时记录中；`STATUS.md`、`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` 等 live 状态缺位，导致任务边界、已确认决策和回归证据不可追溯。 | 如果直接把 `docs/workflow/generated/**` 当 live docs 修改，会破坏 freshness 语义；如果一次性复制全部 live docs 但不明确维护责任，后续可能出现 generated reference 与 live docs 结构漂移。 | 明确 live docs 的首版物化范围、维护入口和与 generated reference 的关系；至少需要说明哪些文件由 `/adopt-existing-project` 建立，哪些文件保留为 reference-only。 |
| 是否绑定 source repo 的 project-level validation slots | profile 中 `unit`、`integration`、`e2e-smoke`、`contract-compatibility` 等 slots 继续为空，`validate:all` 只能执行 protocol 层；日常开发可能误以为项目级 gate 已完整覆盖。 | 如果把 target-project slots 直接绑定为 source repo 命令，可能改变 `.workflow-system/WORKFLOW_PROTOCOL.md §16` 中“target project during Adoption A4”的语义；也可能与 protocol-level checks 重复，造成 gate 含义不清。 | 先判断本仓库是否需要 project-level gates；若需要，区分 source-repo-specific validation 与 target-project adoption slots，避免用同一字段承载两类语义。 |
| 是否固化“source repo 不能 self-install，只能 self-sync / self-adopt” | 维护者可能继续尝试把 `$target` 设为本仓库并执行 `workflow:install --root .`；这会混淆 source repo 与 target repo 身份，并可能引入 install-state / managed-file drift repair 语义风险。 | 如果把该规则写得过死，可能阻断未来明确设计过的 source-repo import/repair 流程；如果只写在 README 而不进入治理基线，执行时仍可能被忽略。 | 明确当前版本的规则是“本 source repo self-use 不走 self-install”；如未来需要 self-install 等价流程，必须先在协议和 runtime 中设计独立语义与保护。 |

### live docs / generated docs 处理原则

- `/adopt-existing-project` 负责建立首版 live docs。
- `docs/workflow/generated/**` 只提供结构骨架和 freshness reference，不承载项目运行事实。
- 后续任务写入 live `docs/workflow/*.md`。
- 结构变更必须回到 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/**` 和 generator。
- 状态变更必须回写 `STATUS.md`、`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` 等 live docs。

### source-repo / target-project 隔离原则

- source repo 只负责规范、生成、验证、打包和同步能力。
- target project 只在独立 root 中消费 install、bootstrap/adoption 和 host sync。
- source repo 可以执行 `workflow:sync --root . --host <host> --write` 激活本地 runtime skills，但禁止执行 `workflow:install --root .` self-install。
- source repo 不绑定 `.workflow-system/PROJECT_PROFILE.yaml` 中 `owner: target-project` 的 project-level validation slots；这些 slots 只属于 target project Adoption A4。
- source repo 质量控制使用明确的 source-repo 命令：`bun run validate:protocol`、`bun run validate:freshness`、`bun run test:workflow-all`、`bun run workflow:health --root .`。
- 真实 target project 必须通过外部 `$target` root 指定；测试 target 必须放入隔离目录，例如 `.tmp/target-projects/<case-name>/` 或最小化 `test/fixtures/target-projects/<case-name>/`。
- 后续可新增 `scripts/guard-target-root.ts` 或等价 guard，在 install 前阻止 source root / parent root / 交叉 `.git` root 被当作 target root。
