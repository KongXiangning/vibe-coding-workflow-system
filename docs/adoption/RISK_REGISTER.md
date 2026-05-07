# Risk Register

## 分类规则

- `stable`：已有明确契约或被验证链路保护，变更必须谨慎。
- `fragile`：可工作但容易因身份、路径、生成顺序或漂移造成误用。
- `unknown`：缺少仓库事实或外部依赖不可见。
- `deprecated`：保留为历史或背景，不应作为当前实现来源。

## Stable

| 对象 | 风险 | 保护方式 | 证据 |
| --- | --- | --- | --- |
| `.workflow-system/WORKFLOW_PROTOCOL.md` | 协议变更会影响模板、生成器、测试、runtime 和 target install/sync。 | 先改协议，再传播实现；运行 protocol/freshness/test。 | `.workflow-system/WORKFLOW_PROTOCOL.md`; `package.json` |
| `.workflow-system/FILE_SCHEMAS.md` | 文档结构变更会影响 templates、generated docs 和 doc validation。 | 保持 required headings 与 generator/test 对齐。 | `.workflow-system/FILE_SCHEMAS.md` |
| `templates/**` | 模板变更会改变 generated outputs 和 target runtime 行为。 | 改后运行 `bun run gen:all`、`validate:freshness`、相关测试。 | `README.md`; `package.json` |
| `scripts/workflow-runtime.ts` | install/sync/pack/health 变更可能破坏 target repo adoption。 | 增加/更新 runtime tests；保留错误分类。 | `.workflow-system/WORKFLOW_PROTOCOL.md §17`; `test/workflow-runtime.test.ts` |
| generated freshness | 手工改 generated 输出会导致 source repo evidence 不可信。 | 禁止手改 `docs/workflow/generated/**` 和 `SKILL_REGISTRY.md`。 | `README.md`; `.workflow-system/PROJECT_PROFILE.yaml` |

## Fragile

| 对象 | 风险 | 当前建议 | 证据 |
| --- | --- | --- | --- |
| source repo self-use | 容易把 source repo 当 target repo 执行 `workflow:install --root .`，造成 install-state / managed surface 语义混淆。 | 本仓库自用时执行 self-sync / legacy inventory / adoption，不执行 self-install。 | `.workflow-system/WORKFLOW_PROTOCOL.md §17`; 用户本轮讨论 |
| source-repo / target-project path crossing | 如果 target root 等于 source repo root、source repo 父目录，或包含当前 source repo `.git`，install/adoption/sync 的 ownership 会交叉。 | 真实 target 必须是外部独立 root；测试 target 放入 `.tmp/target-projects/**` 或最小化 `test/fixtures/target-projects/**`；后续考虑 `scripts/guard-target-root.ts`。 | `.workflow-system/WORKFLOW_PROTOCOL.md §17`; 本轮用户确认的隔离规则 |
| target project drift repair | `--replace-managed-drift` / `--repair-bootstrap-drift` 若误用会覆盖管理面文件。 | 必须先 dry-run 并确认 drift 仅限 workflow-system managed files。 | `README.md`; `vibe-coding/README.md` |
| 方法论文档与正式规范的边界 | 方法论原则可能被误当成 schema 或实现规则。 | 涉及字段、错误码、模板结构时回到 `.workflow-system/**` 和 `templates/**`。 | `vibe-coding/README.md`; `vibe-coding/vibe-coding-methodology.md` |
| project-level validation slots | profile 中 unit/integration/e2e 等 target-project slots 仍为空；若绑定为 source repo 命令，会混淆 validation layer ownership。 | source repo 不绑定 target-project slots；本仓库质量控制继续使用 source-repo 命令，target-project slots 只在 target project Adoption A4 绑定。 | `.workflow-system/PROJECT_PROFILE.yaml`; `.workflow-system/WORKFLOW_PROTOCOL.md §16`; 本轮用户确认的隔离规则 |
| live workflow docs for source repo | 当前 source repo 主要提交 reference renders；live docs 是否长期维护尚未固化。 | `/adopt-existing-project` 后建立首版 live docs，并明确与 generated reference 的关系。 | 当前仓库状态; `.workflow-system/WORKFLOW_PROTOCOL.md §14` |
| docs 目录语义混淆 | `docs/workflow/` 可能被误用来承载 source repo 产品说明、用户指南或方法论正文，导致治理管理面与业务/产品文档混在一起。 | `docs/workflow/` 只放治理管理面；产品/业务文档放 `README.md`、`vibe-coding/**`、`docs/product/**`、`docs/guides/**`、`docs/ops/**` 等非 workflow 目录。 | `templates/docs/DOCUMENT_CATALOG.md.tmpl`; `WORKFLOW_GUIDE.md.tmpl`; 本轮用户确认的目录边界 |

## Unknown

| 对象 | 未知点 | 影响 | 建议 |
| --- | --- | --- | --- |
| 外部 target repos | 已安装过哪些版本、是否依赖旧 install/sync 行为未知。 | 变更 runtime/import contract 可能影响迁移。 | 发布前补 manifest/pack/install 回归和迁移说明。 |
| CI 配置 | 当前仓库未发现 workflow 配置文件。 | merge gate 是否自动执行未知。 | 后续确认是否需要 `.github/workflows` 或等效 CI。 |
| 数据库 / 部署 | 无仓库事实。 | 不应写入数据库或部署基线为 confirmed。 | 保持 not-applicable/unknown，除非后续新增事实。 |
| Factory host 真实运行方式 | profile 声明支持 factory，但具体宿主行为未在本轮盘点验证。 | host sync 兼容风险。 | 需要专门 runtime smoke 或文档确认。 |

## Deprecated / Background

| 对象 | 状态 | 处理方式 | 证据 |
| --- | --- | --- | --- |
| gstack native 历史命令与实现细节 | background / historical | 只作为方法论和对比材料；不直接迁移为 workflow-system schema。 | `vibe-coding/README.md`; `vibe-coding/对比.md` |
| root-level legacy workflow docs | not-present / deprecated pattern | 当前规范要求治理文档进入 `docs/workflow/`、设计进入 `docs/designs/`、接管材料进入 `docs/adoption/`。 | `templates/docs/DOCUMENT_CATALOG.md.tmpl`; `WORKFLOW_GUIDE.md.tmpl` |

## 优先处理建议

1. 先完成 source repo adoption：由本文件和其他 inventory 产物进入 `/adopt-existing-project`。
2. 明确 self-use 操作边界：source repo 不 self-install；允许 self-sync runtime skills。
3. 固化 live docs 与 generated reference 的关系，避免后续任务只在对话中记录状态。
4. 将 source-repo 质量控制端与 target-project 消费端的物理路径、命令语义和 validation layer 隔离写入 adoption 后的长期治理文档。
5. 固化 `docs/workflow/` 只承载治理管理面的目录边界，避免把 source repo 产品 / 业务文档放入 workflow home。
6. 决定是否为 source repo 增加 CI；不要用 target-project slots 伪装 source-repo quality gates。
