# SKILL_REGISTRY.md

本文件记录 workflow-skill 系统中各 skill 的职责、触发条件、输入输出工件与 handoff 关系。

它的作用不是替代 skill 文件本身，而是提供一个便于人类审计和维护的目录层视图。

---

## 1. 注册表使用规则

- 本文件面向人类阅读与审查
- 本文件由 `bun run gen:registry` 自动生成，请勿手工编辑
- 元数据来源为 `templates/skills/*.SKILL.md.tmpl` frontmatter，并按 `.workflow-system/PROJECT_PROFILE.yaml` 解析项目级占位符
- 真实执行协议以 `docs/workflow/generated/workflow-skills/*.SKILL.md` 为准

---

## 2. 工作流总览

| 阶段 | Skill |
|---|---|
| 初始化 | `design-baseline-init` → `realign-workflow-assets` → `greenfield-init` / `legacy-inventory` → `adopt-existing-project` |
| 阶段 1：需求进入 | main chain: `execute-current-task` → `create-current-task` → `supersede-current-task` → `review-current-task`；record-only branch: `capture-work-item` → `ask-user` |
| 阶段 2：范围锁定 | `lock-scope` |
| 阶段 3：方案拆解 | `classify-decisions` → `plan-implementation` → `decompose-task` |
| 阶段 4：小步实现 | `continue-current-step` → `implement-current-step` |
| 阶段 4/6：异常处理 | `debug-and-fix-current-task` → `investigate-root-cause` |
| 阶段 5：范围复核 | `review-diff` → `review-implementation` → `verify-contracts`；findings detour: `review-diff` / `review-implementation` → `sync-review-findings` → `implement-current-step` |
| 阶段 6：回归验证 | `run-regression` |
| 阶段 7：状态同步 | suspend branch: `pause-current-task` / `interrupt-current-task`；resume branch: `resume-paused-task` / `resume-interrupted-task` → `review-current-task`；steady-state sync: `sync-current-task` → `sync-status` → `sync-contracts` → `sync-decisions` → `sync-host-guidance` → `capture-lessons` |
| 阶段 8：交付沉淀 | `close-current-task` → `prepare-delivery-summary` → `archive-task` |

失败分支：

- `run-regression` 失败时进入 `investigate-root-cause`
- 大多数其他 skill 在失败时 handoff 到 `ask-user`

---

## 3. Skill 清单

### 3.1 初始化

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `design-baseline-init` | 为新项目完成首版设计基线，包括路线图、架构、领域模型、数据库、接口边界和详细设计草案。 | 当新项目只有产品想法或原始需求，尚未形成架构设计、数据库设计、详细设计或接口边界时。 | `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`README.md`、`package.json` | `docs/workflow/ROADMAP.md`、`docs/designs/architecture.md`、`docs/designs/database.md`、`docs/designs/detailed-design.md`、`docs/designs/api-contracts.md`、`docs/designs/domain-model.md`、`docs/workflow/BASELINES.md`、`docs/workflow/DECISIONS.md` | `greenfield-init` | `ask-user` |
| `realign-workflow-assets` | 在不清空 target project 的前提下，按当前 workflow 规范重排已有 runtime skills、generated docs、host guidance 和 project profile。 | 当目标项目已经跑过 `design-baseline-init`、已经安装过旧版 workflow-system，或仓库里同时存在旧路径和新路径的 workflow 资产时。 | `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`templates/docs/`、`templates/skills/`、`docs/workflow/DOCUMENT_CATALOG.md`、`docs/workflow/`、`docs/designs/`、`docs/adoption/`、`AGENTS.md`、`CLAUDE.md`、`SKILL_REGISTRY.md`、`generated/workflow-docs/**`、`generated/workflow-skills/**`、`ARCHITECTURE.md`、`DATABASE.md`、`./ROADMAP.md`、`./CONTRACTS.md`、`./BASELINES.md`、`./STATUS.md`、`./DECISIONS.md`、`./CURRENT_TASK.md`、`.claude/skills/`、`.codex/skills/`、`.factory/skills/`、`package.json` | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`docs/workflow/`、`docs/designs/`、`docs/adoption/`、`SKILL_REGISTRY.md`、`generated/workflow-docs/**`、`generated/workflow-skills/**`、`ARCHITECTURE.md`、`DATABASE.md`、`./ROADMAP.md`、`./CONTRACTS.md`、`./BASELINES.md`、`./STATUS.md`、`./DECISIONS.md`、`./CURRENT_TASK.md`、`.claude/skills/**`、`.codex/skills/**`、`.factory/skills/**` | `greenfield-init` | `ask-user` |
| `greenfield-init` | 基于已确认设计基线，为新项目建立首版治理基线，包括项目画像、协作约束、契约边界、状态、路线图、基线和决策文档。 | 当项目刚开始，尚未建立治理体系，需要先把项目基线搭起来时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`docs/workflow/ROADMAP.md`、`docs/designs/architecture.md`、`docs/designs/database.md`、`docs/designs/`、`docs/workflow/BASELINES.md`、`README.md`、`package.json` | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`docs/workflow/ROADMAP.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/BASELINES.md`、`docs/workflow/STATUS.md`、`docs/workflow/DECISIONS.md` | `create-current-task` | `ask-user` |
| `legacy-inventory` | 对老项目做事实盘点、现状固化和风险标注，为 adopt-existing-project 提供可验证输入。 | 当老项目已有代码、文档、数据库或部署线索，但尚未接入 workflow-system 治理时。 | `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`README.md`、`docs/`、`package.json`、`scripts`、`test` | `docs/adoption/architecture-inventory.md`、`docs/adoption/database-inventory.md`、`docs/adoption/API_INVENTORY.md`、`docs/adoption/RISK_REGISTER.md`、`docs/adoption/ADOPTION_REPORT.md`、`docs/workflow/ROADMAP.md` | `adopt-existing-project` | `ask-user` |
| `adopt-existing-project` | 消费老项目事实盘点结果，在确认后建立首版治理基线，供后续任务流使用。 | 当老项目已存在，但还没有 workflow 治理工件，或者准备正式接入 workflow 时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`docs/adoption/architecture-inventory.md`、`docs/adoption/database-inventory.md`、`docs/adoption/`、`docs/workflow/ROADMAP.md`、`docs/workflow/BASELINES.md`、`README.md`、`docs/`、`package.json`、`scripts/`、`test/`、`src/` | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`docs/workflow/ROADMAP.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/BASELINES.md`、`docs/workflow/STATUS.md`、`docs/workflow/DECISIONS.md`、`docs/adoption/ADOPTION_REPORT.md` | `create-current-task` | `ask-user` |

### 3.2 阶段 1：需求进入

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `execute-current-task` | 按标准顺序执行当前任务，从任务复核、范围锁定、决策分类、实现方案分析和步骤拆解进入实现与验证链。 | docs/workflow/CURRENT_TASK.md 已存在，用户要求继续执行或自动推进当前任务时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md` | `[]` | `review-current-task` | `ask-user` |
| `create-current-task` | 根据用户需求生成可执行的 docs/workflow/CURRENT_TASK.md 初稿。 | 当用户提出新需求，且当前没有可直接执行的任务包时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/CONTRACTS.md`、`docs/workflow/STATUS.md`、`docs/workflow/DECISIONS.md` | `docs/workflow/CURRENT_TASK.md` | `review-current-task` | `ask-user` |
| `supersede-current-task` | 当未完成的当前任务因目标、范围锁或验收标准失效而不能继续时，用新任务包安全替代旧任务包。 | docs/workflow/CURRENT_TASK.md 尚未完成，但执行中发现原任务目标、范围锁或验收标准失效，必须替代当前任务包时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/STATUS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/CONTRACTS.md` | `docs/workflow/CURRENT_TASK.md` | `review-current-task` | `ask-user` |
| `capture-work-item` | 将与当前任务无关的新事项记录到 TASKS/inbox/**，不切换当前 active task。 | 当执行当前任务时冒出一个已判断与当前 live task 无关、但需要留档的新事项。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`TASKS/inbox/**` | `TASKS/inbox/**` | `create-current-task` | `ask-user` |
| `review-current-task` | 审查 docs/workflow/CURRENT_TASK.md 初稿并收敛成可执行任务包。 | 当 docs/workflow/CURRENT_TASK.md 初稿已经生成，进入实现前。 | `docs/workflow/CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md` | `docs/workflow/CURRENT_TASK.md` | `lock-scope` | `ask-user` |

### 3.3 阶段 2：范围锁定

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `lock-scope` | 锁定本轮允许修改与禁止修改的边界。 | 在任何实现动作开始前。 | `docs/workflow/CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md` | `docs/workflow/CURRENT_TASK.md` | `classify-decisions` | `ask-user` |

### 3.4 阶段 3：方案拆解

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `classify-decisions` | 把任务中的决策分为 Mechanical、Taste、User challenge。 | 开始拆步骤前。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/DECISIONS.md` | `docs/workflow/CURRENT_TASK.md` | `plan-implementation` | `ask-user` |
| `plan-implementation` | 针对 docs/workflow/CURRENT_TASK.md 分析接下来要实现的架构、技术路线和方案，并形成可拆解的实现计划。 | 完成决策分级后、拆解实施步骤前。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md`、`.workflow-system/PROJECT_PROFILE.yaml` | `docs/workflow/CURRENT_TASK.md` | `decompose-task` | `ask-user` |
| `decompose-task` | 把任务拆成独立、可验证、低污染的小步骤。 | 完成实现方案分析后。 | `docs/workflow/CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`docs/workflow/DECISIONS.md`、`docs/workflow/CONTRACTS.md` | `docs/workflow/CURRENT_TASK.md` | `implement-current-step` | `ask-user` |

### 3.5 阶段 4：小步实现

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `continue-current-step` | 执行已锁定范围内的当前实施步骤，并自动进入范围审查、实现质量审查、契约验证和回归验证。 | docs/workflow/CURRENT_TASK.md 已完成范围锁定和步骤拆解，用户要求继续当前 step 时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md` | `[]` | `implement-current-step` | `ask-user` |
| `implement-current-step` | 只实现 docs/workflow/CURRENT_TASK.md 中当前步骤，禁止顺手扩散。 | 进入具体编码实现时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md` | `scripts`、`test`、`docs/workflow/CURRENT_TASK.md` | `review-diff` | `ask-user` |

### 3.6 阶段 4/6：异常处理

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `debug-and-fix-current-task` | 针对当前 bug 任务先调查根因，再执行最小修复并完成审查和回归验证。 | 测试失败、回归失败、实现异常或用户要求自动调查并修复当前 bug 时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md` | `[]` | `investigate-root-cause` | `ask-user` |
| `investigate-root-cause` | 先做根因定位，再提出最小修复建议。 | 当前任务的测试失败、验证失败或实现过程中出现异常时；不是新 bug 登记入口。 | `docs/workflow/CURRENT_TASK.md`、`TASKS/paused/**`、`TASKS/interrupted/**` | `docs/workflow/CURRENT_TASK.md` | `plan-implementation` | `ask-user` |

### 3.7 阶段 5：范围复核

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `review-current-diff` | 只审查当前 diff，不修复；输出范围、实现质量、契约和回归验证风险。 | 用户要求 review、只报告问题、不要改代码，或准备合并前需要审查当前 diff 时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md`、`.workflow-system/PROJECT_PROFILE.yaml` | `[]` | `review-diff` | `ask-user` |
| `review-diff` | 审查当前 diff 是否越界、是否偏离任务意图。 | 每完成一个实现步骤后。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md` | `[]` | `review-implementation` | `ask-user` |
| `review-implementation` | 审查当前实现是否真正解决任务目标，并检查代码合理性、鲁棒性和测试充分性。 | review-diff 通过后、进入契约验证前。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md` | `[]` | `verify-contracts` | `ask-user` |
| `sync-review-findings` | 将 review-diff / review-implementation 发现的实现问题写入 docs/workflow/CURRENT_TASK.md 的审查问题队列，作为下一轮修复输入。 | 只读审查输出 P1 / P2 / P3 implementation findings，且这些 finding 需要在进入修复前持久记录时。 | `docs/workflow/CURRENT_TASK.md`、`TASKS/paused/**`、`TASKS/interrupted/**` | `docs/workflow/CURRENT_TASK.md` | `implement-current-step` | `ask-user` |
| `verify-contracts` | 专门核查接口契约和架构契约是否被破坏。 | diff 较大、涉及稳定边界，或 review-diff 发现潜在契约风险时。 | `docs/workflow/CONTRACTS.md`、`docs/workflow/CURRENT_TASK.md` | `[]` | `run-regression` | `ask-user` |

### 3.8 阶段 6：回归验证

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `run-regression` | 选择合适 QA 模式，运行已有测试或最小 smoke check，确认旧功能未被破坏。 | 通过范围复核后。 | `docs/workflow/CURRENT_TASK.md`、`TASKS/paused/**`、`TASKS/interrupted/**`、`.workflow-system/PROJECT_PROFILE.yaml` | `[]` | `sync-current-task` | `investigate-root-cause` |

### 3.9 阶段 7：状态同步

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `pause-current-task` | 将当前 active task 安全暂停为 paused suspended package，并保留可恢复的完整任务快照。 | 当前任务需要暂时让出 active ownership，但后续仍可能恢复时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md` | `docs/workflow/CURRENT_TASK.md`、`TASKS/paused/**` | `create-current-task` | `ask-user` |
| `interrupt-current-task` | 将当前 active task 中断为 interrupted package，并保留完整恢复证据与任务快照。 | 当前任务必须中断，且恢复时需要基于 checkpoint、dirty 状态和环境证据重建上下文时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md` | `docs/workflow/CURRENT_TASK.md`、`TASKS/interrupted/**` | `create-current-task` | `ask-user` |
| `resume-paused-task` | 从一个明确的 paused suspended package 恢复 live docs/workflow/CURRENT_TASK.md，并把流程固定交回 review-current-task。 | 用户明确要求恢复一个 paused task，且目标 package 已显式给定或可无歧义解析时。 | `docs/workflow/CURRENT_TASK.md`、`TASKS/paused/**`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md` | `docs/workflow/CURRENT_TASK.md`、`TASKS/paused/**` | `review-current-task` | `ask-user` |
| `resume-interrupted-task` | 从一个明确的 interrupted suspended package 恢复 live docs/workflow/CURRENT_TASK.md，并把流程固定交回 review-current-task。 | 用户明确要求恢复一个 interrupted task，且目标 package 已显式给定或可无歧义解析时。 | `docs/workflow/CURRENT_TASK.md`、`TASKS/interrupted/**`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md` | `docs/workflow/CURRENT_TASK.md`、`TASKS/interrupted/**` | `review-current-task` | `ask-user` |
| `sync-current-task` | 回写 docs/workflow/CURRENT_TASK.md 的执行状态、验证结果和剩余问题。 | 每轮实现与验证完成后。 | `docs/workflow/CURRENT_TASK.md` | `docs/workflow/CURRENT_TASK.md` | `sync-status` | `ask-user` |
| `sync-status` | 更新 docs/workflow/STATUS.md，反映当前项目整体进度和稳定状态。 | 任务阶段完成或状态发生变化时。 | `docs/workflow/STATUS.md`、`docs/workflow/CURRENT_TASK.md` | `docs/workflow/STATUS.md` | `sync-contracts` | `ask-user` |
| `sync-contracts` | 将新形成的稳定接口或架构边界写入 docs/workflow/CONTRACTS.md。 | 本轮任务新增了稳定接口、稳定结构或稳定架构规则时。 | `docs/workflow/CONTRACTS.md`、`docs/workflow/CURRENT_TASK.md` | `docs/workflow/CONTRACTS.md` | `sync-decisions` | `ask-user` |
| `sync-decisions` | 把本轮已确认的决策写入 docs/workflow/DECISIONS.md。 | 本轮实现明确形成了新的架构决策、口味决策、暂缓项或否决项时。 | `docs/workflow/DECISIONS.md`、`docs/workflow/CURRENT_TASK.md` | `docs/workflow/DECISIONS.md` | `sync-host-guidance` | `ask-user` |
| `sync-host-guidance` | 同步 AGENTS.md 与 CLAUDE.md，确保 Claude / Codex 两侧宿主都读取同一套已确认的项目级协作约束、命令入口和 workflow 指引。 | 项目级协作约束、统一命令入口、宿主说明或 workflow 指引发生变化时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`docs/workflow/CURRENT_TASK.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/STATUS.md`、`docs/workflow/BASELINES.md` | `AGENTS.md`、`CLAUDE.md` | `capture-lessons` | `ask-user` |
| `capture-lessons` | 把本轮踩坑经验和稳定协作方式沉淀到 docs/workflow/LESSONS.md。 | 任务收尾、踩坑后复盘，或发现新的高价值协作经验时。 | `docs/workflow/LESSONS.md`、`docs/workflow/CURRENT_TASK.md` | `docs/workflow/LESSONS.md` | `prepare-delivery-summary` | `ask-user` |

### 3.10 阶段 8：交付沉淀

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `close-current-task` | 在实现和验证完成后，按顺序同步任务、状态、契约、决策、宿主指引、经验、交付摘要和归档。 | 当前任务实现、审查和验证完成，用户要求收尾、交付或归档时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/STATUS.md`、`docs/workflow/CONTRACTS.md`、`docs/workflow/DECISIONS.md`、`docs/workflow/LESSONS.md` | `[]` | `sync-current-task` | `ask-user` |
| `prepare-delivery-summary` | 整理本轮任务摘要，形成可交付、可复核的结果记录。 | 一轮任务完成后，准备收尾或交付时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/STATUS.md` | `[]` | `archive-task` | `ask-user` |
| `archive-task` | 将本轮任务归档到 TASKS/，并为下一轮留下清晰入口。 | 任务正式完成并确认可以归档时。 | `docs/workflow/CURRENT_TASK.md`、`docs/workflow/STATUS.md` | `TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md`、`docs/workflow/CURRENT_TASK.md` | `create-current-task` | `ask-user` |

---

## 4. 高风险 / 重点审计 skill

以下 skill 应优先关注，因为它们最容易造成越界或状态失真：

- `execute-current-task`
- `supersede-current-task`
- `capture-work-item`
- `continue-current-step`
- `debug-and-fix-current-task`
- `review-current-diff`
- `close-current-task`
- `implement-current-step`
- `review-diff`
- `sync-review-findings`
- `plan-implementation`
- `review-implementation`
- `verify-contracts`
- `run-regression`
- `pause-current-task`
- `interrupt-current-task`
- `resume-paused-task`
- `resume-interrupted-task`
- `sync-contracts`
- `sync-decisions`
- `archive-task`

重点检查点：

- 是否读了规定的治理文档
- 是否只写允许写入的工件
- 是否遵守 handoff 图
- 是否把失败显式交给 `ask-user` 或根因调查路径

---

## 5. 建议的后续演进

下一步可以把本文件继续升级为：

1. 增加每个 skill 的 `must_check`、`stop_conditions` 摘要
2. 增加和 `.workflow-system/FILE_SCHEMAS.md`、`.workflow-system/PROJECT_PROFILE.yaml` 的交叉引用
3. 增加按风险级别或 stage 的细分视图
