# Vibe Coding Methodology

这个目录收纳 gstack 中面向大型 Vibe Coding 项目的方法论文档。它们是理解 workflow-system 设计取舍的背景材料，不是生成器的唯一规范源。

## 阅读顺序

1. [`vibe-coding-methodology.md`](./vibe-coding-methodology.md)
   - 总入口。解释为什么大型 AI 辅助开发需要边界、任务、状态和决策治理。
2. [`vibe-coding-workflow.md`](./vibe-coding-workflow.md)
   - 执行流程。把一次需求从进入、拆解、实现、复核到交付沉淀串起来。
3. [`vibe-coding-quality-system.md`](./vibe-coding-quality-system.md)
   - 质量体系。聚焦契约锁定、范围锁定、状态追踪、回归验证和失控诊断。

## 怎么用

这个目录不是一套必须从头到尾执行的规范，而是给大型 AI 辅助开发提供操作方法。按你的场景选择入口：

| 场景 | 先看 | 目的 |
| --- | --- | --- |
| 想理解为什么项目会被 AI 改乱 | [`vibe-coding-methodology.md`](./vibe-coding-methodology.md) | 建立边界、任务、状态、决策治理的整体模型 |
| 准备让 AI 开始做一个需求 | [`vibe-coding-workflow.md`](./vibe-coding-workflow.md) | 把需求拆成“进入 → 锁范围 → 实现 → 复核 → 同步”的任务链 |
| 项目已经变大，担心误改稳定功能 | [`vibe-coding-quality-system.md`](./vibe-coding-quality-system.md) | 建立契约锁定、范围锁定和回归检查 |
| 要改 workflow-system 的协议、模板或生成器 | `.workflow-system/` 正式规范 | 以 [`.workflow-system/WORKFLOW_PROTOCOL.md`](../.workflow-system/WORKFLOW_PROTOCOL.md)、[`.workflow-system/FILE_SCHEMAS.md`](../.workflow-system/FILE_SCHEMAS.md) 和 `templates/**` 为准 |

### 最小使用流程

如果你只是想在现有项目里约束 AI，不需要先实现完整 workflow-system。可以按下面 5 步使用：

1. 先写清楚本次任务目标。
2. 明确允许修改范围，最好具体到目录或文件。
3. 明确禁止修改范围，包括稳定模块、共享层、数据库、配置、已上线 API 等。
4. 要求 AI 如果必须越界，先停下来说明原因，不要直接修改。
5. 完成后用 `git diff --stat` 和实际改动文件对照允许范围，发现越界就回滚或单独开任务。

可直接复制给 AI 的任务边界示例：

```md
本次任务只关注 <模块或功能名>。

允许查询范围：
- <module-a>/**
- <shared-readonly-area>/**

允许修改范围：
- <module-a>/**
- <module-a-tests>/**

禁止修改范围：
- <module-b>/**
- <module-c>/**
- <shared-stable-area>/**
- 数据库迁移、部署配置、已上线 API 契约

如果你认为必须修改禁止范围内的文件，先停下来说明：
1. 为什么当前任务无法在允许范围内完成
2. 需要修改哪些文件
3. 不修改会有什么后果

未经确认，不要顺手重构、改名、调整目录结构或修改共享层。
完成后列出实际修改文件，并逐项对照允许修改范围。
```

### 在 workflow-system 中落地

如果项目已经接入 workflow-system，把上面的边界写入 `CURRENT_TASK.md`：

- `## 允许修改范围`
- `## 禁止修改范围`
- `## 受影响的契约`
- `## 回归检查项`

然后使用范围锁定和复核链路：

1. `/lock-scope`：实现前锁定允许/禁止范围。
2. `/implement-current-step`：只做当前步骤，不扩大任务。
3. `/review-diff`：实现后检查实际 diff 是否越界。
4. `/verify-contracts`：检查稳定接口、架构边界、目录职责是否被破坏。
5. `/run-regression`：按 `CURRENT_TASK.md` 的回归检查项验证。

## 产出物怎么用

workflow-system 的治理产出物分工如下。这里说明使用入口和更新时机；详细章节、必填字段和校验要求以 [`.workflow-system/FILE_SCHEMAS.md`](../.workflow-system/FILE_SCHEMAS.md) 与 [`templates/docs/`](../templates/docs/) 为准。

| 产出物 | 用途 | 什么时候读 | 什么时候更新 |
| --- | --- | --- | --- |
| `CURRENT_TASK.md` | 本轮任务工单，固定目标、范围、验收、回归和执行记录 | AI 每轮工作前必须读 | 范围锁定后、每个实施步骤完成后、验证完成后 |
| `CONTRACTS.md` | 稳定接口、架构边界、目录职责和不可破坏约束 | 规划、实现、审核和契约复核前 | 新增稳定接口、稳定模块边界或架构约束时 |
| `DECISIONS.md` | 已确认的架构、产品、口味、暂缓和否决决策 | 涉及选择、取舍或可能推翻旧决定时 | 用户确认新决策、替代旧决策或否决方案后 |
| `STATUS.md` | 项目状态、稳定模块、当前开发项、风险和下一检查点 | 开始任务前判断当前项目状态 | 任务结束、稳定边界变化或风险状态变化后 |
| `LESSONS.md` | 可复用经验、踩坑记录和未来触发条件 | 遇到类似问题、复盘或调试前 | 发现可复用规律、根因或防错动作后 |
| `ROADMAP.md` | 里程碑、当前窗口、候选事项和跨阶段风险 | 规划阶段、排优先级或判断任务是否该做时 | 里程碑、当前窗口或候选事项变化后 |
| `BASELINES.md` | 发布、兼容、安全、部署、性能和 gate 基线 | 涉及非功能要求、发布 gate 或兼容窗口时 | 基线、gate、错误码或发布要求变化后 |
| `WORKFLOW_GUIDE.md` | 目标项目里的操作手册，说明什么时候用什么文档和 skill | 不确定流程入口、skill 选择或文档职责时 | workflow skill、标准流程或治理文档集合变化后 |
| `TASK_SUMMARY.md` | 交付摘要结构参考，记录目标、结果、范围、验证和风险 | 交付前准备对外说明时 | 作为 `/prepare-delivery-summary` 输出摘要的结构参考 |
| `TASK_ARCHIVE.md` | 任务归档结构参考，沉淀任务快照、实际改动和验证证据 | 查历史任务、追溯决策或复盘时 | 作为 `/archive-task` 写入 `TASKS/TASK-...` 的结构参考 |

推荐使用顺序：

1. 先看 `STATUS.md` / `ROADMAP.md` 判断当前项目状态和任务是否处在正确窗口。
2. 用 `CURRENT_TASK.md` 固定本轮目标、允许/禁止范围、验收标准和回归检查项。
3. 实现前对照 `CONTRACTS.md` / `DECISIONS.md`，确认不会破坏稳定边界或已确认决策。
4. 实现后运行 `/review-diff`、`/verify-contracts`、`/run-regression` 做范围、契约和回归复核。
5. 结束时同步 `STATUS.md`，必要时更新 `LESSONS.md`，用 `/prepare-delivery-summary` 输出交付摘要，再由 `/archive-task` 归档到 `TASKS/TASK-...`。

## 常用命令模版

本节只放可直接复制后替换少量路径的命令。正式命令行为以根目录的 [`package.json`](../package.json) 和 [`.workflow-system/WORKFLOW_PROTOCOL.md`](../.workflow-system/WORKFLOW_PROTOCOL.md) 为准。

### 打包 workflow-system

在 gstack 仓库根目录执行：

```powershell
bun run workflow:pack --json
```

生成结果会写到 `dist\workflow-system\workflow-system-<version>+<hash>`。

### 选择最新 bundle

```powershell
$bundle = Get-ChildItem "dist\workflow-system" -Directory |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$bundle.FullName
```

### 安装到目标项目，先 dry-run

把 `$target` 改成你的目标项目根目录：

```powershell
$target = "E:\coding\github\your-project"

bun run workflow:install --bundle $bundle.FullName --root $target --dry-run --json
```

确认 dry-run 输出没有 `frozen_path`、`local_drift`、`contract_conflict`、`incompatible_target` 后，再执行真实安装：

```powershell
bun run workflow:install --bundle $bundle.FullName --root $target
```

`workflow:install` 现在默认按双宿主 bootstrap 语义执行，因此 install 阶段不需要再显式传 `--host codex`。

安装完成后，以下现象是**预期行为**，不是安装失败：

- `.workflow-system/FILE_SCHEMAS.md`
- `.workflow-system/WORKFLOW_PROTOCOL.md`
- `.workflow-system/PROJECT_PROFILE.yaml`
- `.workflow-system/install-state.json`
- `scripts/workflow-*.ts`
- `templates/**`

这些文件就是 workflow-system 的 runtime / protocol / template 安装面，会直接落在目标项目中。

安装阶段会同时预装两侧宿主的 **5 个 bootstrap skills**，不是一次性写入全量 workflow skills：

- `.claude/skills/workflow-system-design-baseline-init/SKILL.md`
- `.claude/skills/workflow-system-realign-workflow-assets/SKILL.md`
- `.claude/skills/workflow-system-greenfield-init/SKILL.md`
- `.claude/skills/workflow-system-legacy-inventory/SKILL.md`
- `.claude/skills/workflow-system-adopt-existing-project/SKILL.md`
- `.codex/skills/workflow-system-design-baseline-init/SKILL.md`
- `.codex/skills/workflow-system-realign-workflow-assets/SKILL.md`
- `.codex/skills/workflow-system-greenfield-init/SKILL.md`
- `.codex/skills/workflow-system-legacy-inventory/SKILL.md`
- `.codex/skills/workflow-system-adopt-existing-project/SKILL.md`

其中 **Codex** 侧的隔离 namespace 位于：

- `.codex/skills/workflow-system-<skill>/SKILL.md`

这层 sync 通过 `workflow-system-*` 前缀与其他 Codex skill 隔离。

### 让目标项目完成 bootstrap / adoption

`workflow:install` 会把 runtime、模板、协议文档和 bootstrap skills 装进目标项目，并且只会对**缺失**的 `AGENTS.md` / `CLAUDE.md` 做 scaffold-once；它**不会**覆盖已存在的宿主指引文件，也不会自动完成项目事实盘点或治理基线接管。

为了避免目标项目在 install 后“看不到下一步该做什么”，install 现在还会额外留下一份**最小本地指引**：

- `docs/workflow/WORKFLOW_GUIDE.md`

这份 guide 不等于完整生成产物，但会明确告诉你：

- 该先走哪条 bootstrap 链
- 什么时候执行 `bun run gen:all`
- 什么时候执行 `workflow:sync`
- 为什么 install 后暂时只有 5 个 bootstrap skills

安装后请在 **Claude 或 Codex 任一目标宿主里**调用 bootstrap skill 链：

- **新项目**：`/design-baseline-init` -> `/greenfield-init`
- **如果目标项目里已经有旧路径或混排的 workflow 资产**：先执行 `/realign-workflow-assets`，再继续下一步
- **已有项目**：`/legacy-inventory` -> `/adopt-existing-project`

其中 `realign-workflow-assets` 的职责不是重新初始化项目，而是把已经存在的 workflow 文档、runtime skills、`AGENTS.md` / `CLAUDE.md` 和 `.workflow-system/PROJECT_PROFILE.yaml` 对齐到当前 layout 规范，避免“文档位置搬了，但 skill 还按旧路径找”的漂移。

其中：

- `workflow:install` 只会为缺失的 `AGENTS.md` / `CLAUDE.md` 补首版 scaffold
- `greenfield-init` / `adopt-existing-project` 会再把这两份宿主指引文件补全到可用治理基线

完成 bootstrap / adoption 后，在目标项目根目录执行：

```powershell
bun install
bun run gen:all
bun run workflow:sync --host claude --write
bun run workflow:sync --host codex --write
```

执行完这组命令后，宿主目录会从上面的 5 个 bootstrap skills 扩展成当前目标项目 profile 渲染出的**完整 workflow skill 集**。

如果后续在 vibe coding 过程中修改了项目级 AI 协作约束、统一命令入口或宿主指引，不要只改一个宿主文件。应在目标宿主里执行：

- `/sync-host-guidance`

让 `AGENTS.md` 与 `CLAUDE.md` 保持同一治理基线。

### 在目标项目里验证

进入目标项目根目录后执行：

```powershell
bun run workflow:health
bun run validate:all
```

如果只验证 workflow-system 协议层：

```powershell
bun run validate:protocol
```

### 在 gstack 仓库里验证模板和生成器

```powershell
bun run gen:workflow-skills --dry-run
bun run gen:workflow-docs --dry-run
bun run gen:registry --dry-run
bun run test:workflow-skills
bun run test:workflow-docs
bun run test:registry
```

### AI 指令：只开发一个模块

```md
本次任务只开发 <module-name> 模块。

允许查询范围：
- <module-path>/**
- <related-test-path>/**
- <readonly-shared-path>/**

允许修改范围：
- <module-path>/**
- <related-test-path>/**

禁止修改范围：
- <other-module-path>/**
- <stable-shared-path>/**
- 数据库迁移、部署配置、已上线 API 契约

如果必须越界，先停下来说明原因、文件清单和不越界的替代方案。未经确认不要修改范围外文件。
```

### AI 指令：只审核一个模块

```md
只审核 <module-name> 模块相关 diff。

审核范围：
- <module-path>/**
- <related-test-path>/**

请输出：
1. 范围内的 bug / 回归风险 / 缺失测试
2. 是否出现范围外文件改动
3. 范围外改动是否应阻塞本任务

不要对无关模块做风格建议或顺手重构建议。
```

### AI 指令：只查询一个模块

```md
只查询 <module-name> 模块。

允许读取：
- <module-path>/**
- <readonly-contract-or-doc-path>

禁止读取或推断：
- <unrelated-module-path>/**
- 与本问题无关的全仓库扫描

请先说明你读取了哪些文件，再回答问题。若需要扩大查询范围，先说明原因。
```

### AI 指令：实现后范围复核

```md
请做本轮范围复核。

对照 CURRENT_TASK.md 的允许修改范围和禁止修改范围，检查：
1. 实际修改文件是否全部在允许范围内
2. 是否触碰禁止范围
3. 是否改变稳定接口、架构边界、目录职责或已确认决策
4. 是否需要拆出新任务处理越界内容

请基于 git diff --stat 和 git diff 输出结论。
```

## 与正式规范的关系

这些文档解释治理思想和使用方式；正式字段、协议、模板和校验规则仍以仓库中的 `.workflow-system/` 规范源为准：

- [`.workflow-system/WORKFLOW_PROTOCOL.md`](../.workflow-system/WORKFLOW_PROTOCOL.md)
- [`.workflow-system/FILE_SCHEMAS.md`](../.workflow-system/FILE_SCHEMAS.md)
- [`.workflow-system/PROJECT_PROFILE.yaml`](../.workflow-system/PROJECT_PROFILE.yaml)
- [`templates/docs/`](../templates/docs/)
- [`templates/skills/`](../templates/skills/)

如果本文档和正式规范冲突，按正式规范和生成器实现执行。

## 维护边界

- 方法论文档可以描述原则、流程意图和人工判断标准。
- 不在这里维护字段结构、枚举值、错误码、模板章节或生成器行为。
- 涉及 workflow-system 的机器可执行规则时，先更新正式规范源，再让这些文档补充解释。
