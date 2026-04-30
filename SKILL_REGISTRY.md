# SKILL_REGISTRY.md

本文件记录 workflow-skill 系统中各 skill 的职责、触发条件、输入输出工件与 handoff 关系。

它的作用不是替代 skill 文件本身，而是提供一个便于人类审计和维护的目录层视图。

---

## 1. 注册表使用规则

- 本文件面向人类阅读与审查
- 本文件由 `bun run gen:registry` 自动生成，请勿手工编辑
- 元数据来源为 `templates/skills/*.SKILL.md.tmpl` frontmatter，并按 `.workflow-system/PROJECT_PROFILE.yaml` 解析项目级占位符
- 真实执行协议以 `generated/workflow-skills/*.SKILL.md` 为准

---

## 2. 工作流总览

| 阶段 | Skill |
|---|---|
| 初始化 | `design-baseline-init` → `greenfield-init` / `legacy-inventory` → `adopt-existing-project` |
| 阶段 1：需求进入 | `create-current-task` → `review-current-task` |
| 阶段 2：范围锁定 | `lock-scope` |
| 阶段 3：方案拆解 | `classify-decisions` → `decompose-task` |
| 阶段 4：小步实现 | `implement-current-step` |
| 阶段 4/6：异常处理 | `investigate-root-cause` |
| 阶段 5：范围复核 | `review-diff` → `verify-contracts` |
| 阶段 6：回归验证 | `run-regression` |
| 阶段 7：状态同步 | `sync-current-task` → `sync-status` → `sync-contracts` → `sync-decisions` → `sync-host-guidance` → `capture-lessons` |
| 阶段 8：交付沉淀 | `prepare-delivery-summary` → `archive-task` |

失败分支：

- `run-regression` 失败时进入 `investigate-root-cause`
- 大多数其他 skill 在失败时 handoff 到 `ask-user`

---

## 3. Skill 清单

### 3.1 初始化

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `design-baseline-init` | 为新项目完成首版设计基线，包括路线图、架构、领域模型、数据库、接口边界和详细设计草案。 | 当新项目只有产品想法或原始需求，尚未形成架构设计、数据库设计、详细设计或接口边界时。 | `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`README.md`、`package.json` | `ROADMAP.md`、`ARCHITECTURE.md`、`DATABASE.md`、`docs/designs/database-design.md`、`docs/designs/detailed-design.md`、`docs/designs/api-contracts.md`、`docs/designs/domain-model.md`、`BASELINES.md`、`DECISIONS.md` | `greenfield-init` | `ask-user` |
| `greenfield-init` | 基于已确认设计基线，为新项目建立首版治理基线，包括项目画像、协作约束、契约边界、状态、路线图、基线和决策文档。 | 当项目刚开始，尚未建立治理体系，需要先把项目基线搭起来时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`ROADMAP.md`、`ARCHITECTURE.md`、`DATABASE.md`、`docs/designs/`、`BASELINES.md`、`README.md`、`package.json` | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`ROADMAP.md`、`CONTRACTS.md`、`BASELINES.md`、`STATUS.md`、`DECISIONS.md` | `create-current-task` | `ask-user` |
| `legacy-inventory` | 对老项目做事实盘点、现状固化和风险标注，为 adopt-existing-project 提供可验证输入。 | 当老项目已有代码、文档、数据库或部署线索，但尚未接入 workflow-system 治理时。 | `.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`README.md`、`docs/`、`package.json`、`scripts`、`browse/src`、`design/src`、`test`、`browse/test` | `ARCHITECTURE.md`、`DATABASE.md`、`docs/adoption/API_INVENTORY.md`、`docs/adoption/RISK_REGISTER.md`、`docs/adoption/ADOPTION_REPORT.md`、`ROADMAP.md` | `adopt-existing-project` | `ask-user` |
| `adopt-existing-project` | 消费老项目事实盘点结果，在确认后建立首版治理基线，供后续任务流使用。 | 当老项目已存在，但还没有 workflow 治理工件，或者准备正式接入 workflow 时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`.workflow-system/WORKFLOW_PROTOCOL.md`、`.workflow-system/FILE_SCHEMAS.md`、`templates/docs/`、`ARCHITECTURE.md`、`DATABASE.md`、`docs/adoption/`、`ROADMAP.md`、`BASELINES.md`、`README.md`、`docs/`、`package.json`、`scripts/`、`test/`、`src/` | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`ROADMAP.md`、`CONTRACTS.md`、`BASELINES.md`、`STATUS.md`、`DECISIONS.md`、`docs/adoption/ADOPTION_REPORT.md` | `create-current-task` | `ask-user` |

### 3.2 阶段 1：需求进入

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `create-current-task` | 根据用户需求生成可执行的 CURRENT_TASK.md 初稿。 | 当用户提出新需求，且当前没有可直接执行的任务包时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`CONTRACTS.md`、`STATUS.md`、`DECISIONS.md` | `CURRENT_TASK.md` | `review-current-task` | `ask-user` |
| `review-current-task` | 审查 CURRENT_TASK.md 初稿并收敛成可执行任务包。 | 当 CURRENT_TASK.md 初稿已经生成，进入实现前。 | `CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` | `CURRENT_TASK.md` | `lock-scope` | `ask-user` |

### 3.3 阶段 2：范围锁定

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `lock-scope` | 锁定本轮允许修改与禁止修改的边界。 | 在任何实现动作开始前。 | `CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`CONTRACTS.md`、`DECISIONS.md` | `CURRENT_TASK.md` | `classify-decisions` | `ask-user` |

### 3.4 阶段 3：方案拆解

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `classify-decisions` | 把任务中的决策分为 Mechanical、Taste、User challenge。 | 开始拆步骤前。 | `CURRENT_TASK.md`、`DECISIONS.md` | `CURRENT_TASK.md` | `decompose-task` | `ask-user` |
| `decompose-task` | 把任务拆成独立、可验证、低污染的小步骤。 | 完成决策分级后。 | `CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml`、`DECISIONS.md` | `CURRENT_TASK.md` | `implement-current-step` | `ask-user` |

### 3.5 阶段 4：小步实现

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `implement-current-step` | 只实现 CURRENT_TASK.md 中当前步骤，禁止顺手扩散。 | 进入具体编码实现时。 | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` | `scripts`、`browse/src`、`design/src`、`test`、`browse/test`、`CURRENT_TASK.md` | `review-diff` | `ask-user` |

### 3.6 阶段 4/6：异常处理

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `investigate-root-cause` | 先做根因定位，再提出最小修复建议。 | 测试失败、验证失败或实现过程中出现异常时。 | `CURRENT_TASK.md` | `CURRENT_TASK.md` | `implement-current-step` | `ask-user` |

### 3.7 阶段 5：范围复核

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `review-diff` | 审查当前 diff 是否越界、是否偏离任务意图。 | 每完成一个实现步骤后。 | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | `[]` | `verify-contracts` | `ask-user` |
| `verify-contracts` | 专门核查接口契约和架构契约是否被破坏。 | diff 较大、涉及稳定边界，或 review-diff 发现潜在契约风险时。 | `CONTRACTS.md`、`CURRENT_TASK.md` | `[]` | `run-regression` | `ask-user` |

### 3.8 阶段 6：回归验证

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `run-regression` | 选择合适 QA 模式，运行已有测试或最小 smoke check，确认旧功能未被破坏。 | 通过范围复核后。 | `CURRENT_TASK.md`、`.workflow-system/PROJECT_PROFILE.yaml` | `[]` | `sync-current-task` | `investigate-root-cause` |

### 3.9 阶段 7：状态同步

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `sync-current-task` | 回写 CURRENT_TASK.md 的执行状态、验证结果和剩余问题。 | 每轮实现与验证完成后。 | `CURRENT_TASK.md` | `CURRENT_TASK.md` | `sync-status` | `ask-user` |
| `sync-status` | 更新 STATUS.md，反映当前项目整体进度和稳定状态。 | 任务阶段完成或状态发生变化时。 | `STATUS.md`、`CURRENT_TASK.md` | `STATUS.md` | `sync-contracts` | `ask-user` |
| `sync-contracts` | 将新形成的稳定接口或架构边界写入 CONTRACTS.md。 | 本轮任务新增了稳定接口、稳定结构或稳定架构规则时。 | `CONTRACTS.md`、`CURRENT_TASK.md` | `CONTRACTS.md` | `sync-decisions` | `ask-user` |
| `sync-decisions` | 把本轮已确认的决策写入 DECISIONS.md。 | 本轮实现明确形成了新的架构决策、口味决策、暂缓项或否决项时。 | `DECISIONS.md`、`CURRENT_TASK.md` | `DECISIONS.md` | `sync-host-guidance` | `ask-user` |
| `sync-host-guidance` | 同步 AGENTS.md 与 CLAUDE.md，确保 Claude / Codex 两侧宿主都读取同一套已确认的项目级协作约束、命令入口和 workflow 指引。 | 项目级协作约束、统一命令入口、宿主说明或 workflow 指引发生变化时。 | `.workflow-system/PROJECT_PROFILE.yaml`、`AGENTS.md`、`CLAUDE.md`、`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md`、`BASELINES.md` | `AGENTS.md`、`CLAUDE.md` | `capture-lessons` | `ask-user` |
| `capture-lessons` | 把本轮踩坑经验和稳定协作方式沉淀到 LESSONS.md。 | 任务收尾、踩坑后复盘，或发现新的高价值协作经验时。 | `LESSONS.md`、`CURRENT_TASK.md` | `LESSONS.md` | `prepare-delivery-summary` | `ask-user` |

### 3.10 阶段 8：交付沉淀

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `prepare-delivery-summary` | 整理本轮任务摘要，形成可交付、可复核的结果记录。 | 一轮任务完成后，准备收尾或交付时。 | `CURRENT_TASK.md`、`STATUS.md` | `[]` | `archive-task` | `ask-user` |
| `archive-task` | 将本轮任务归档到 TASKS/，并为下一轮留下清晰入口。 | 任务正式完成并确认可以归档时。 | `CURRENT_TASK.md`、`STATUS.md` | `TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md`、`CURRENT_TASK.md` | `create-current-task` | `ask-user` |

---

## 4. 高风险 / 重点审计 skill

以下 skill 应优先关注，因为它们最容易造成越界或状态失真：

- `implement-current-step`
- `review-diff`
- `verify-contracts`
- `run-regression`
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
