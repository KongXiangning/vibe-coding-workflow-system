# docs/workflow/ROADMAP.md

## 使用规则

- 本文件记录 `vibe-coding-workflow-system` 源仓库的版本窗口、治理阶段和跨阶段依赖。
- 本文件只记录已进入当前窗口的治理缺口、迁移计划和候选事项；不把重构候选当作已批准任务。
- 正式协议、schema、模板结构、错误码和校验规则仍以 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md` 和 `templates/**` 为准。
- source repo 自身使用 workflow-system 时，不通过 `workflow:install --root .` self-install；self-use 路径需要通过生成、host sync、inventory/adoption 和 live docs 固化完成。

## 生命周期阶段

- 当前版本：0.14.5
- 当前治理阶段：
  - 阶段名称：source repo self-adoption baseline
  - 目标：使用 legacy inventory 产物建立首版 live governance baseline，明确 source repo / target repo 边界、生成链、runtime sync、质量治理思想、validation layer 隔离和 adoption 风险。
  - 退出条件：`docs/workflow/CONTRACTS.md`、`BASELINES.md`、`STATUS.md`、`DECISIONS.md`、`ROADMAP.md` 已建立，并能支撑 `/create-current-task`。
- 下一治理阶段：
  - 阶段名称：source repo governed task loop
  - 进入条件：创建首个 `docs/workflow/CURRENT_TASK.md` 并进入标准任务流。

## 版本里程碑

### M1: Source Repo Self-Adoption

- 目标版本 / 时间窗：0.14.x
- 目标结果：本仓库具备可日常使用的 live workflow 治理基线，并明确不使用 self-install。
- 进入条件：
  - generated reference outputs fresh。
  - 本仓库 runtime skills 可通过 `workflow:sync --root .` 同步到 Codex / Claude。
  - legacy inventory 产物已形成。
- 完成定义：
  - [x] `/adopt-existing-project` 消费 `docs/adoption/**` 后，生成或更新首版 `docs/workflow/CONTRACTS.md`、`BASELINES.md`、`STATUS.md`、`DECISIONS.md`、`ROADMAP.md`。
  - [x] source repo self-use 命令链和禁止 self-install 边界被写入长期治理文档。
  - [x] source-repo 质量控制端与 target-project 消费端的物理路径、命令语义和 validation layer 隔离被写入长期治理文档。
  - `bun run gen:all`、`bun run validate:protocol`、`bun run validate:freshness`、`bun run workflow:health --root .` 通过。
- 依赖：
  - `.workflow-system/WORKFLOW_PROTOCOL.md` 的 source repo / target repo / runtime sync 语义。
  - `.workflow-system/FILE_SCHEMAS.md` 的 workflow docs 结构。
  - `vibe-coding/*.md` 中的任务治理、质量治理和传播治理思想。
- 风险：
  - 把 source repo 当 target repo 执行 `workflow:install --root .`。
  - 把 target-project validation slots 绑定为 source repo 命令，混淆 validation layer ownership。
  - 把方法论文档中的概念直接当成 schema 或生成规则。
  - 混淆 `docs/workflow/generated/**` reference render 与 live `docs/workflow/*.md`。
  - 把 source repo 产品 / 业务文档放入 `docs/workflow/`，混淆治理管理面与产品说明。

### M2: Protocol and Runtime Hardening

- 目标版本 / 时间窗：0.15.x 或后续版本窗口
- 目标结果：source repo self-use 中发现的边界、health、sync、freshness 和 adoption 风险进入协议或测试保护。
- 进入条件：
  - M1 完成。
  - self-adoption 过程中出现的 confirmed 风险已进入 `STATUS.md` 或 `CONTRACTS.md`。
- 完成定义：
  - 必要协议变更先写入 `.workflow-system/WORKFLOW_PROTOCOL.md` 或 `.workflow-system/FILE_SCHEMAS.md`。
  - 模板、生成器和测试与协议变更同步。
  - `test:workflow-all` 覆盖新增或调整的 runtime/adoption 行为。
  - 如确认需要 guard，实现并测试 target root 隔离规则，阻止 source root / parent root / 交叉 `.git` root 被当作 target root。
- 依赖：
  - M1 的 adoption report 和风险登记。
  - 维护者对 validation slots / CI 策略的确认。
- 风险：
  - 在没有协议登记的情况下直接改模板或测试。
  - 为 source repo 特例破坏 target repo install/sync 通用语义。

## 当前窗口

- 当前主线：完成 `/adopt-existing-project` 首版治理基线，并进入首个 `CURRENT_TASK.md` 任务流。
- 已锁定范围：
  - 新增 / 更新 `docs/adoption/**`。
  - 新增 / 更新 `docs/workflow/ROADMAP.md`、`CONTRACTS.md`、`BASELINES.md`、`STATUS.md`、`DECISIONS.md`。
- 明确不做：
  - 不修改 `scripts/**`、`test/**`、`templates/**`。
  - 不修改 `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`.workflow-system/PROJECT_PROFILE.yaml`。
  - 本轮 adoption 不创建 `docs/workflow/CURRENT_TASK.md`；下一步由 `/create-current-task` 创建。
  - 不执行 `workflow:install --root .`。
  - 不绑定 source repo 的 target-project validation slots。
- 需要前置决策：
  - 是否需要新增 source-repo-specific quality gate 入口；不复用 target-project validation slots。
  - 是否在协议或 guide 中显式登记 source repo self-use 路径。
  - 是否新增 `scripts/guard-target-root.ts` 或等价 guard。
  - 是否在 `DOCUMENT_CATALOG.md` / `WORKFLOW_GUIDE.md` 中明确 `docs/workflow/` 只承载治理管理面。

## 候选事项池

- 候选事项：source repo live workflow docs baseline
  - 所属里程碑：M1
  - 进入条件：维护者确认执行 `/adopt-existing-project`。
  - 推迟原因：`legacy-inventory` 只输出事实盘点，不越权写 `CONTRACTS.md` / `STATUS.md` / `BASELINES.md`。
- 候选事项：self-use contract clarification
  - 所属里程碑：M1 / M2
  - 进入条件：维护者确认“source repo 不 self-install”需要长期契约化。
  - 推迟原因：需要决定落点是 `CONTRACTS.md`、`WORKFLOW_GUIDE.md`，还是协议源。
- 候选事项：source-repo quality gate separation
  - 所属里程碑：M2
  - 进入条件：确认 source repo 是否需要 protocol 之外的质量 gate。
  - 推迟原因：当前协议显示 target-project slots 面向 Adoption A4；source repo 不应复用这些 slots。
- 候选事项：target root guard
  - 所属里程碑：M2
  - 进入条件：确认需要用脚本阻止 source/target root 交叉。
  - 推迟原因：本轮是 inventory，不修改 runtime 脚本或测试。
- 候选事项：docs taxonomy hardening
  - 所属里程碑：M1 / M2
  - 进入条件：`/adopt-existing-project` 需要固化 source repo 的 live governance home 与产品 / 业务文档目录边界。
  - 推迟原因：本轮只盘点并记录边界，不越权改 `DOCUMENT_CATALOG.md` / `WORKFLOW_GUIDE.md` live docs。
- 候选事项：CI gate materialization
  - 所属里程碑：M2
  - 进入条件：确认仓库需要自动化 merge gate。
  - 推迟原因：当前仓库事实未显示 CI 配置。

## 风险与依赖

- 关键风险：
  - source repo / target repo 身份混淆。
  - source-repo quality gate 与 target-project validation slots 混淆。
  - generated reference outputs 与 live docs 混淆。
  - workflow 治理文档与 source repo 产品 / 业务文档混淆。
  - 方法论文档越权成为 schema 来源。
  - 外部 target repo 的历史安装兼容性未知。
- 外部依赖：
  - Bun runtime。
  - Codex / Claude / Factory host 对 `.*/skills/workflow-system-*` namespace 的支持。
  - 外部 target repo 对 bundle install/sync 的实际消费情况。
- 需要复核的假设：
  - 当前没有数据库、HTTP API 或部署 runtime。
  - 本仓库自用 workflow-system 需要先同步 runtime skills，再执行 inventory/adoption。
  - `workflow:install --root .` 不应作为 source repo self-use 初始化方式。
  - target-project root 必须与 source repo root 物理隔离；测试 target 只能使用 `.tmp/target-projects/**` 或最小化 `test/fixtures/target-projects/**`。

## 变更记录

- 2026-05-07：根据 `legacy-inventory` 盘点结果建立 source repo self-adoption roadmap 草案。
- 2026-05-07：执行 `/adopt-existing-project`，建立首版 live governance baseline。
