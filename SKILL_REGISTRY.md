# SKILL_REGISTRY.md

本文件记录 workflow-skill 系统中各 skill 的职责、触发条件、输入输出工件与 handoff 关系。

它的作用不是替代 skill 文件本身，而是提供一个便于人类审计和维护的目录层视图。

---

## 1. 注册表使用规则

- 本文件面向人类阅读与审查
- 真实执行协议以 `generated/workflow-skills/*.SKILL.md` 为准
- 当 skill 模板、handoff 图或读写边界发生变化时，应同步更新本文件
- 如果后续引入自动生成，本文件应变成生成产物或生成源之一，而不是长期手工维护

---

## 2. 工作流总览

| 阶段 | Skill |
|---|---|
| 初始化 | `init-governance` |
| 阶段 1：需求进入 | `create-current-task` → `review-current-task` |
| 阶段 2：范围锁定 | `lock-scope` |
| 阶段 3：方案拆解 | `classify-decisions` → `decompose-task` |
| 阶段 4：小步实现 | `implement-current-step` |
| 阶段 4/6：异常处理 | `investigate-root-cause` |
| 阶段 5：范围复核 | `review-diff` → `verify-contracts` |
| 阶段 6：回归验证 | `run-regression` |
| 阶段 7：状态同步 | `sync-current-task` → `sync-status` → `sync-contracts` → `sync-decisions` → `capture-lessons` |
| 阶段 8：交付沉淀 | `prepare-delivery-summary` → `archive-task` |

失败分支：

- `run-regression` 失败时进入 `investigate-root-cause`
- 大多数其他 skill 在失败时 handoff 到 `ask-user`

---

## 3. Skill 清单

### 3.1 初始化

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `init-governance` | 建立治理文档与 workflow 运行前提 | 项目第一次接入方法论或治理文件缺失 | 项目根目录、`README.md`、`ARCHITECTURE.md`、`package.json` 等 | `[]` | `create-current-task` | `ask-user` |

### 3.2 阶段 1：需求进入

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `create-current-task` | 生成任务包初稿 | 出现新需求且尚无可执行任务包 | `PROJECT_PROFILE.yaml`、`STATUS.md`、`DECISIONS.md` | `CURRENT_TASK.md` | `review-current-task` | `ask-user` |
| `review-current-task` | 审核任务包边界与可执行性 | `CURRENT_TASK.md` 初稿已存在 | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` | `CURRENT_TASK.md` | `lock-scope` | `ask-user` |

### 3.3 阶段 2：范围锁定

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `lock-scope` | 锁定允许 / 禁止修改边界 | 实现动作开始前 | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | `CURRENT_TASK.md` | `classify-decisions` | `ask-user` |

### 3.4 阶段 3：方案拆解

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `classify-decisions` | 识别本轮涉及的决策类型 | 开始拆步骤前 | `CURRENT_TASK.md`、`DECISIONS.md` | `CURRENT_TASK.md`、`DECISIONS.md` | `decompose-task` | `ask-user` |
| `decompose-task` | 把任务拆成可单步执行步骤 | 完成决策分级后 | `CURRENT_TASK.md`、`PROJECT_PROFILE.yaml`、`DECISIONS.md` | `CURRENT_TASK.md` | `implement-current-step` | `ask-user` |

### 3.5 阶段 4：小步实现

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `implement-current-step` | 在当前任务边界内执行实现 | 进入具体编码实现时 | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` | 代码目录 + `CURRENT_TASK.md` | `review-diff` | `ask-user` |

### 3.6 阶段 4/6：异常处理

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `investigate-root-cause` | 对失败和异常做根因调查 | 测试失败、验证失败或实现异常 | `CURRENT_TASK.md`、错误信息、当前 diff、日志 / 测试结果 | `CURRENT_TASK.md` | `implement-current-step` | `ask-user` |

### 3.7 阶段 5：范围复核

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `review-diff` | 检查越界修改与不必要改动 | 每完成一个实现步骤后 | `git diff`、`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | `[]` | `verify-contracts` | `ask-user` |
| `verify-contracts` | 检查稳定边界是否被破坏 | diff 较大或涉及稳定边界时 | `git diff`、`CONTRACTS.md`、`CURRENT_TASK.md` | `[]` | `run-regression` | `ask-user` |

### 3.8 阶段 6：回归验证

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `run-regression` | 运行测试与验证清单 | 范围复核通过后 | `CURRENT_TASK.md`、`PROJECT_PROFILE.yaml`、测试命令、验证清单 | `[]` | `sync-current-task` | `investigate-root-cause` |

### 3.9 阶段 7：状态同步

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `sync-current-task` | 回写任务包执行结果 | 每轮实现与验证完成后 | `CURRENT_TASK.md`、验证结果、实际修改结果 | `CURRENT_TASK.md` | `sync-status` | `ask-user` |
| `sync-status` | 同步项目当前状态 | 任务阶段完成或状态变化时 | `STATUS.md`、`CURRENT_TASK.md`、验证结果 | `STATUS.md` | `sync-contracts` | `ask-user` |
| `sync-contracts` | 同步新稳定边界 | 本轮新增稳定接口、结构或规则时 | `CONTRACTS.md`、`CURRENT_TASK.md`、实际改动、验证结果 | `CONTRACTS.md` | `sync-decisions` | `ask-user` |
| `sync-decisions` | 记录新决策、暂缓项或否决项 | 本轮形成新决策时 | `DECISIONS.md`、`CURRENT_TASK.md`、实际结果、用户确认信息 | `DECISIONS.md` | `capture-lessons` | `ask-user` |
| `capture-lessons` | 沉淀可复用经验 | 收尾复盘或发现高价值经验时 | `LESSONS.md`、`CURRENT_TASK.md`、验证结果、问题修复过程 | `LESSONS.md` | `prepare-delivery-summary` | `ask-user` |

### 3.10 阶段 8：交付沉淀

| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |
|---|---|---|---|---|---|---|
| `prepare-delivery-summary` | 准备交付总结 | 一轮任务完成、准备交付时 | `CURRENT_TASK.md`、验证结果、`git diff --stat`、状态同步结果 | `[]` | `archive-task` | `ask-user` |
| `archive-task` | 归档任务和摘要 | 任务正式完成并确认可以归档时 | `CURRENT_TASK.md`、任务摘要、`STATUS.md` | `TASKS/TASK-{{TASK_ID}}-{{TASK_SLUG}}.md`、`CURRENT_TASK.md` | `create-current-task` | `ask-user` |

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

1. 自动从 `generated/workflow-skills/*.SKILL.md` 生成
2. 增加每个 skill 的 `must_check`、`stop_conditions` 摘要
3. 增加和 `FILE_SCHEMAS.md`、`PROJECT_PROFILE.yaml` 的交叉引用
