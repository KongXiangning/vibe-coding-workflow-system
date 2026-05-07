# docs/workflow/CONTRACTS.md

## 使用规则

- 修改任何代码前先阅读本文件。
- 变更 `🔒` 项必须先记录到 `docs/workflow/DECISIONS.md` 并获得明确确认。
- 变更 `🟡` 项允许执行，但必须在任务总结中显式说明。
- `🟢` 项可自由修改，但仍需遵守整体分层与依赖方向。
- 本文件只固化 confirmed 事实；inferred / unknown 项进入 `docs/workflow/STATUS.md`、`docs/workflow/ROADMAP.md` 或 `docs/adoption/**`。

## 一、接口契约

### 🔒 已锁定接口

- 名称：source repo CLI contract
  - 路径 / 符号：`package.json` scripts
  - 当前语义：`gen:*`、`validate:*`、`test:*`、`workflow:*` 是本仓库和外部 target 项目消费 workflow-system 的公开命令入口。
  - 不可破坏项：命令名、source repo / target repo 语义、dry-run / write 语义、错误分类必须保持可追溯。
  - 备注：证据见 `docs/adoption/API_INVENTORY.md`。
- 名称：runtime install/sync contract
  - 路径 / 符号：`scripts/workflow-runtime.ts`
  - 当前语义：`workflow:install` 只面向外部 target root；`workflow:sync --root .` 可用于 source repo self-use 的 host skill 同步。
  - 不可破坏项：source repo 禁止 self-install；target project 必须使用独立 root；host sync 必须保留 `workflow-system-*` 隔离 namespace。
  - 备注：未来若需要 source-repo import/repair 等价流程，必须先在协议和 runtime 中设计独立语义。

### 🔒 已锁定核心函数 / 导出

- 模块：`scripts/workflow-runtime.ts`
  - 函数 / 符号：`workflow:health`、`workflow:manifest`、`workflow:pack`、`workflow:install`、`workflow:sync`
  - 输入输出：CLI flags、manifest/install/sync/health report。
  - 不可破坏项：install、sync、pack、health 的语义不能互相替代；install drift repair flags 只修对应 managed surface。
  - 备注：`--replace-managed-drift` / `--repair-bootstrap-drift` 不是重新初始化入口。
- 模块：`scripts/gen-workflow-skills.ts`、`scripts/gen-workflow-docs.ts`、`scripts/gen-registry.ts`
  - 函数 / 符号：`gen:workflow-skills`、`gen:workflow-docs`、`gen:registry`
  - 输入输出：`.workflow-system/PROJECT_PROFILE.yaml`、协议/schema、templates -> generated reference outputs。
  - 不可破坏项：不得从 generated outputs 反向维护规范；结构变更必须从协议/schema/templates 开始。
  - 备注：generated freshness 是 protocol-level gate。

### 🔒 已锁定数据结构 / DTO / 事件 / 表结构

- 名称：`.workflow-system/PROJECT_PROFILE.yaml`
  - 结构：project/runtime/paths/boundaries/governance/validation matrix。
  - 语义：source repo 长期项目画像、路径、边界和 validation 声明。
  - 不可破坏项：不得为了模拟 target repo 覆盖 source repo facts；`owner: target-project` 的 slots 不用于 source repo quality gate。
  - 备注：source repo 若需要额外 quality gate，应新增明确 source-repo-specific 入口或后续协议扩展。
- 名称：workflow generated reference outputs
  - 结构：`docs/workflow/generated/workflow-docs/**`、`docs/workflow/generated/workflow-skills/**`、`docs/workflow/SKILL_REGISTRY.md`
  - 语义：source repo 产品化生成证据。
  - 不可破坏项：不可手改；必须通过 templates / scripts 重新生成。
  - 备注：live docs 才承载本仓库运行事实。

### 🟡 可扩展不可破坏

- 可以新增 source-repo-specific quality gate，但不能复用 target-project validation slots 伪装 protocol checks。
- 可以新增 target root guard，例如 `scripts/guard-target-root.ts`，但必须先明确协议入口、错误分类和测试覆盖。
- 可以扩展 `docs/product/**`、`docs/guides/**`、`docs/ops/**` 等产品/业务文档目录，但不能把这些内容放入 `docs/workflow/` 治理管理面。

### 🟢 自由修改

- `docs/adoption/**` 中的 inventory / adoption 报告内容，按 bootstrap/adoption 流程维护。
- `docs/workflow/*.md` 中 live 内容，按 workflow skills 和本文件约束维护。
- 非 generated 的说明文档可在对应目录中维护，但涉及协议/schema/模板结构时必须回到正式规范源。

## 二、架构契约

### 🔒 依赖方向

- `.workflow-system/WORKFLOW_PROTOCOL.md` 和 `.workflow-system/FILE_SCHEMAS.md` 是结构与规则源头。
- `templates/**` 只能承载协议/schema 已声明的结构。
- `scripts/**` 实现生成、验证、pack/install/sync/runtime 行为。
- `test/**` 验证协议、生成器、runtime 和契约。
- `docs/workflow/generated/**` 和 `docs/workflow/SKILL_REGISTRY.md` 只能由生成器写入。

### 🔒 分层规则

- source repo 质量控制端与 target-project 消费端必须物理路径隔离、命令语义隔离、validation layer 隔离。
- source repo 负责规范、生成、验证、打包、同步能力。
- target project 只在独立 root 中消费 install、bootstrap/adoption 和 host sync。
- `workflow:install --root .` 对 source repo 是禁止路径。
- `workflow:sync --root . --host <host> --write` 是 source repo self-use 的允许路径。

### 🔒 状态流 / 数据流

- 结构变更：协议/schema/templates -> generator -> generated reference -> freshness。
- 项目事实变更：workflow skill -> live `docs/workflow/*.md`。
- target 安装：source repo bundle -> external target root -> target bootstrap/adoption -> source repo render/sync target。
- source self-use：source repo generated skills -> `.codex/skills/workflow-system-*` / `.claude/skills/workflow-system-*`。

### 🔒 目录职责

- `docs/workflow/*.md`：本 source repo 的 live governance docs，只记录治理状态、任务、契约、决策、路线图、基线和经验。
- `docs/workflow/generated/**`：产品化 reference render，不承载运行事实。
- `docs/workflow/SKILL_REGISTRY.md`：generated registry，不手改。
- `docs/adoption/**`：self-adoption inventory / 接管材料。
- `docs/designs/**`：后续设计基线。
- `README.md`、`vibe-coding/**`、`docs/product/**`、`docs/guides/**`、`docs/ops/**`：source repo 产品、业务、方法论、使用或运维说明。

### 🔒 事件 / DTO 语义

- validation matrix 的 `layer: protocol` 归 workflow-system；`layer: project` 且 `owner: target-project` 的 slots 归 target project Adoption A4。
- install drift repair flags：
  - `--replace-managed-drift` 只修 install-state 中 `replace-managed` 管理项。
  - `--repair-bootstrap-drift` 只修 install-state 中 `bootstrap-skill-install` 管理项。
  - 两者都不重做 inventory/adoption，不覆盖 target-owned project facts。

## 三、变更规则

- 任何跨层依赖变动都必须先明确记录原因和影响。
- 任何接口返回结构变化都必须有兼容策略或明确升级计划。
- 任何“顺手重构”如果超出当前任务范围，必须停止并单独立项。
- source repo / target project 隔离规则变更必须进入 `DECISIONS.md`，并同步 `BASELINES.md` 与相关测试计划。
- generated/live docs 边界变更必须先更新协议/schema/templates/generator，不得只改 live 文档。

## 四、传播治理补充

### candidate 回写记录

- 对象路径：`workflow:install --root <target>`
  - 当前状态：`locked-candidate`
  - direct consumers：external target repo operators
  - cross_boundary：source repo -> target repo
  - critical_path_hit：yes
  - locked_hit_chain：install-state / managed files / bootstrap skills
  - writeback_required：yes, contract and baseline

### LayoutContract

- 容器路径：`docs/`
  - machine_anchor：directory taxonomy
  - layout_model：workflow governance / generated reference / adoption inventory / product docs separated by directory
  - locked_properties：`docs/workflow/generated/**` generated-only; `docs/workflow/*.md` live governance only
  - locked_relations：`docs/workflow/` must not absorb product/business docs
  - cascade_sources：`.workflow-system/FILE_SCHEMAS.md`; `templates/docs/DOCUMENT_CATALOG.md.tmpl`; `WORKFLOW_GUIDE.md.tmpl`
  - sibling_reflow_sensitive：yes
  - insertion_guard：
    - mode：review-required
    - protected_siblings：`docs/workflow/generated/**`, `docs/adoption/**`, `vibe-coding/**`
  - breakpoint_contracts：not-applicable
  - stacking_context：not-applicable
  - side_effect_scope：documentation discoverability and governance ownership

### BehaviorContract

- 对象路径：source repo self-use flow
  - assertions：
    - source repo must not self-install
    - source repo may self-sync host skills
    - target project must use external or isolated root
  - verification：manual command review now; future `guard-target-root` tests if implemented

### compat path / wrapper rules

- stable source object：`workflow:install`
  - same-file reuse pattern：none approved for self-install
  - successor wrapper / compat object：future `workflow:self-sync` / `workflow:source-repair` only after protocol design
  - preserved direct entrypoints：external target install
  - decision rationale：avoid source/target ownership collision

### API change downstream validation

- hook：not-applicable
- store：not-applicable
- page：not-applicable
- widget：not-applicable
- form：not-applicable
- table：not-applicable
- detail view：not-applicable

### frozen zone / UI anchor migration

- frozen zone：
  - zone type：`fully-frozen`
  - protected siblings：`docs/workflow/generated/**`, `docs/workflow/SKILL_REGISTRY.md`
  - removal precondition：protocol/schema/templates/generator change plus freshness validation
- `UIAnchorReplacement`：
  - old_anchor：not-applicable
  - successor_anchor：not-applicable
  - transition_window：not-applicable
  - alias_policy：none
  - alias_details：not-applicable
  - relation_migration：not-applicable
  - removal_precondition：not-applicable
  - verification：not-applicable
