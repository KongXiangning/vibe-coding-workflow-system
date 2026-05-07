# Database Inventory

## 盘点规则

- 本文件只记录仓库中可证明的数据存储、schema、迁移和状态事实。
- 没有证据时标为 `unknown` 或 `not-applicable`，不推断数据库存在。

## 数据库结论

| 事项 | 状态 | 证据 |
| --- | --- | --- |
| 业务数据库 | not-applicable | 仓库是 workflow-system source repo，`package.json` 未声明数据库相关依赖，文件清单未显示 migrations/schema 目录。 |
| 数据库迁移 | not-applicable | 未发现 migration 文件或数据库迁移脚本。 |
| ORM / query builder | not-applicable | `package.json` 依赖仅包含 `yaml`。 |
| 持久化业务数据 | not-applicable | 仓库职责是协议、模板、生成器和文档治理，不提供运行中的业务数据服务。 |

## 文件型状态与生成产物

| 对象 | 类型 | 分类 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| `.workflow-system/PROJECT_PROFILE.yaml` | YAML 配置 | stable | confirmed | `.workflow-system/PROJECT_PROFILE.yaml`; `scripts/workflow-core.ts` 读取 profile |
| `docs/workflow/generated/workflow-docs/**` | Markdown generated reference | stable | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §14` |
| `docs/workflow/generated/workflow-skills/**` | Markdown generated reference | stable | confirmed | `README.md`; `scripts/gen-workflow-skills.ts` |
| `docs/workflow/SKILL_REGISTRY.md` | Markdown generated registry | stable | confirmed | `README.md`; `scripts/gen-registry.ts` |
| `dist/workflow-system/**` | bundle 输出 | generated / ephemeral | confirmed | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |
| `.workflow-system/install-state.json` | target install state | target-only | inferred | `.workflow-system/WORKFLOW_PROTOCOL.md §17`; 当前 source repo 未跟踪该文件 |

## 数据约束

| 约束 | 状态 | 证据 |
| --- | --- | --- |
| profile 必须包含 project/runtime/paths/boundaries/validation 等被生成器和 runtime 消费的结构。 | confirmed | `.workflow-system/PROJECT_PROFILE.yaml`; `.workflow-system/WORKFLOW_PROTOCOL.md` |
| generated reference outputs 不能作为独立规范源手工维护。 | confirmed | `README.md`; `.workflow-system/WORKFLOW_PROTOCOL.md §14` |
| target install-state 只应由 install 成功后写入 target repo。 | confirmed | `.workflow-system/WORKFLOW_PROTOCOL.md §17` |

## 高风险字段 / 文件

| 对象 | 风险 | 分类 | 建议 |
| --- | --- | --- | --- |
| `.workflow-system/PROJECT_PROFILE.yaml` | 错误修改 source repo facts 会影响生成输出、host sync 和验证矩阵。 | fragile | 只在明确改变本 source repo 画像时修改；不要为了模拟 target repo 覆盖它。 |
| generated docs / skills | 手工修改会造成 freshness drift。 | stable | 修改模板或协议后运行 `bun run gen:all`，不要直接编辑 generated 输出。 |
| `dist/workflow-system/**` | 打包输出可能过期。 | generated | 需要发布/安装时重新 `workflow:pack`。 |

## Unknown

- 没有外部数据库、队列、缓存、对象存储或部署状态的仓库证据。
- 没有 runtime production data retention、backup、migration rollback 等数据库运维要求。
