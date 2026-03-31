# 面向大型项目的 Vibe Coding 工作流程

这份工作流基于两份文档整理而成：

- `gstack-analysis.md`：提供了 gstack 的完整流程框架
- `vibe-coding-quality-system.md`：提供了适合个人开发者的质量控制体系

目标是把 gstack 的“规划 → 审查 → QA → 交付 → 复盘”主线，结合个人 vibe coding 的高速度开发方式，变成一套更轻、更稳、更适合大项目长期推进的流程。

---

## 一、这套流程解决什么问题

它主要解决 4 类常见失控：

1. 新需求推进时，AI 顺手改坏稳定功能
2. 一次局部改动扩散到无关模块
3. 项目变大后，不知道当前整体进度和稳定边界
4. 需求增删频繁，导致代码、接口、文档、状态不同步

所以这套流程的核心不是“怎么让 AI 写得更快”，而是：

- 让 AI 改动有边界
- 让功能迭代有阶段
- 让质量检查有固定入口
- 让项目状态持续可见

---

## 二、总流程总览

推荐把一个需求从提出到完成，拆成下面 8 个阶段：

```text
1. 需求进入
2. 范围锁定
3. 方案拆解
4. 小步实现
5. 范围复核
6. 回归验证
7. 状态同步
8. 交付沉淀
```

如果映射到 gstack 的理念，大致对应：

```text
office-hours / autoplan
    ↓
plan-eng-review / plan-design-review
    ↓
implement
    ↓
review
    ↓
qa
    ↓
ship
    ↓
document-release / learn / retro
```

但对于个人项目，不需要每次都完整跑一遍重流程。更适合的是“主流程固定、执行深度按任务大小调整”。

---

## 三、把流程变成可复用的 Skill 系统

如果你要把这套工作流真正变成“可调用、可约束、可重复使用”的系统，那么不能只停留在口头规范，而应该拆成三层：

1. **标准化协议层**
2. **模板层**
3. **项目实例层**

这三层的关系是：

```text
标准化协议
    ↓
文档模板 + skill 模板
    ↓
项目配置 / 项目画像
    ↓
当前项目可执行的 skill 集合
```

也就是说：

- **不是**每个项目都重新从零写一套 skill
- **也不是**所有项目共用完全相同的一份 skill 文本
- 而是：**协议统一、模板统一、实例按项目生成**

这正是 `gstack` 最值得迁移的地方：不是“很多 prompt”，而是“模板化的流程系统”。

---

### 3.1 标准化协议层：哪些东西必须固定

如果要让 AI 稳定地产生、更新、审查这些治理文档，首先要固定的不是文案，而是**协议**。

最少要固定 4 类协议：

#### 1. 文档协议

每类文档都要明确：

- 它的用途是什么
- 谁在什么时候读取它
- 谁在什么时候更新它
- 必须包含哪些字段
- 哪些字段更新时必须停下来请你确认

例如 `CURRENT_TASK.md` 协议就必须固定：

- 必有 `任务信息`
- 必有 `验收标准`
- 必有 `允许修改范围`
- 必有 `禁止修改范围`
- 必有 `受影响的契约`
- 必有 `回归检查项`
- 必有 `回滚点`
- 必有 `决策分类`
- 必有 `执行记录`

#### 2. Skill 协议

每个 skill 都不应该只是“一段提示词”，而应当有固定结构：

```text
Skill 名称
用途
触发条件
读取哪些文档
允许更新哪些文档
必须检查什么
何时必须停止并提问
完成后交给哪个下游 skill
```

也就是说，一个合格的 skill 不是只说“帮我做 X”，而是要有：

- 输入边界
- 输出边界
- 停机条件
- 交接关系

#### 3. 状态流转协议

工作流阶段之间的文档流转也要固定。

例如：

- 阶段 1 结束，必须产出 `CURRENT_TASK.md`
- 阶段 2 结束，必须明确允许/禁止修改范围
- 阶段 3 结束，必须写入步骤拆解和决策分类
- 阶段 5 结束，必须给出范围复核结论
- 阶段 7 结束，必须回写状态类文档
- 阶段 8 结束，必须决定是否归档到 `TASKS/`

如果没有这种流转协议，AI 就会把每轮任务当成独立聊天，而不是连续工程。

#### 4. 升级协议

不同大小任务使用不同深度的流程，这也必须标准化：

- 小任务：只启用轻量 skill 集
- 中任务：启用任务包 + 决策 + 契约审查
- 大任务：启用完整文档链 + 归档 + 复盘

所以协议不是写给某一个模型的，而是写给整个系统的。

---

### 3.2 模板层：什么应该做成模板

一旦协议固定，下一层就应该是模板。

模板至少分两类：

#### A. 文档模板

这些模板定义“文档长什么样”：

- `CURRENT_TASK.md.tmpl`
- `CONTRACTS.md.tmpl`
- `STATUS.md.tmpl`
- `DECISIONS.md.tmpl`
- `LESSONS.md.tmpl`
- `TASK_SUMMARY.md.tmpl`
- `TASK_ARCHIVE.md.tmpl`

#### B. Skill 模板

这些模板定义“不同任务类型应该怎么驱动 AI”：

- `init-governance.SKILL.md.tmpl`
- `create-current-task.SKILL.md.tmpl`
- `review-current-task.SKILL.md.tmpl`
- `lock-scope.SKILL.md.tmpl`
- `classify-decisions.SKILL.md.tmpl`
- `decompose-task.SKILL.md.tmpl`
- `implement-current-step.SKILL.md.tmpl`
- `review-diff.SKILL.md.tmpl`
- `run-regression.SKILL.md.tmpl`
- `sync-state.SKILL.md.tmpl`
- `archive-task.SKILL.md.tmpl`

这类模板不写死项目细节，而是保留变量位，例如：

- `{PROJECT_TYPE}`
- `{TECH_STACK}`
- `{CODE_DIRECTORIES}`
- `{TEST_COMMANDS}`
- `{FORBIDDEN_PATHS}`
- `{ARCHITECTURE_RULES}`
- `{DECISION_TYPES}`
- `{RELEASE_FLOW}`

所以模板层的作用不是替你写内容，而是确保**所有项目都遵循同一语义结构**。

---

### 3.3 项目实例层：不同项目为什么不能直接共用一份 skill

标准化不等于所有项目使用完全相同的 skill 文本。

同样一个 `create-current-task`：

- 在前端项目里，要强调页面层、组件层、状态层边界
- 在后端项目里，要强调接口契约、事务边界、表结构风险
- 在全栈项目里，要同时区分前端、后端、数据库、部署影响范围

所以正确做法是：

```text
通用协议
+ 通用模板
+ 项目配置
= 当前项目 skill 集
```

也就是说，**skill 的骨架是标准化的，skill 的内容是项目实例化的。**

项目实例化最少需要一份“项目画像”文件，至少描述：

- 项目类型（前端 / 后端 / 全栈 / 工具链）
- 技术栈
- 核心目录结构
- 测试命令
- 构建命令
- 部署方式
- 关键禁改区域
- 关键架构边界
- 常见决策类型
- 当前使用的治理文档集合

---

### 3.4 推荐的 Skill 标准结构

建议你给每个 skill 固定下面这套结构：

```md
# Skill: <name>

## Purpose

## Trigger

## Reads
- ...

## Writes
- ...

## Must Check
- ...

## Stop Conditions
- ...

## Output
- ...

## Handoff
- next skill: ...
```

其中最重要的是 4 个约束：

1. **Reads**：执行前必须读取哪些文档
2. **Writes**：执行后允许更新哪些文档
3. **Must Check**：强制检查项
4. **Stop Conditions**：哪些情况必须停下并问你

如果没有这 4 项，skill 只是提示词，不是治理单元。

---

### 3.5 Skill 字段 Schema：通用字段规范

如果你想让 skill 真正可生成、可组合、可审计，那么上面的结构还不够，还需要把字段进一步标准化成 schema。

也就是说，不只是“这个 skill 大概有这些章节”，而是要明确：

- 每个字段是干什么的
- 哪些字段必须有
- 哪些字段只能填写固定类型的内容
- 哪些字段决定是否允许执行
- 哪些字段决定是否必须停下来问你

推荐把每个 skill 的通用 schema 固定成下面这些字段：

| 字段 | 是否必须 | 作用 | 典型内容 |
|---|---|---|---|
| `name` | 必须 | skill 唯一标识 | `create-current-task` |
| `purpose` | 必须 | skill 的唯一目标 | 生成任务包初稿 |
| `stage` | 必须 | 所属工作流阶段 | `阶段 1：需求进入` |
| `trigger` | 必须 | 什么情况下调用它 | 新需求进入时 |
| `inputs` | 必须 | skill 的输入来源 | 用户需求、已有文档、diff、测试结果 |
| `reads` | 必须 | 执行前必须读取的文件 | `CURRENT_TASK.md`、`DECISIONS.md` |
| `writes` | 必须 | 允许写入的文件；纯分析 / 纯审查 skill 可为空列表 `[]` | `CURRENT_TASK.md` |
| `forbidden_writes` | 建议必须 | 明确禁止修改的文件 | 代码文件、`CONTRACTS.md` |
| `must_check` | 必须 | 执行时必须检查的项 | 范围、契约、决策一致性 |
| `stop_conditions` | 必须 | 哪些情况必须停下来请你确认 | 越界修改、覆盖已确认决策 |
| `output` | 必须 | 该 skill 必须产出什么 | 任务包初稿、风险清单、验证结果 |
| `handoff` | 必须 | skill 完成后的流转；应使用 `success` / `failure` 子字段 | `success: review-current-task` |
| `decision_policy` | 建议必须 | 哪类决策可自动处理，哪类不可 | Mechanical / Taste / User challenge |
| `verification` | 建议必须 | 如何证明这一步真的完成了 | 文件已更新、diff 已检查、测试通过 |
| `notes` | 可选 | 补充说明 | 项目特例、特殊限制 |

从作用上看，这些字段可以分成 5 组：

#### A. 身份字段

用于定义这个 skill 是什么：

- `name`
- `purpose`
- `stage`

#### B. 触发与输入字段

用于定义它什么时候可以运行，以及靠什么运行：

- `trigger`
- `inputs`
- `reads`

#### C. 执行边界字段

用于限制它能做什么、不能做什么：

- `writes`
- `forbidden_writes`
- `must_check`
- `stop_conditions`
- `decision_policy`

#### D. 输出与流转字段

用于把它接进完整工作流：

- `output`
- `handoff`
- `verification`

#### E. 补充字段

用于承接项目特例：

- `notes`

这样一来，skill 就不再是“看起来像 prompt 的说明文”，而是一个**有边界、有输入输出、有流转关系的标准流程节点**。

#### 推荐的结构化写法

如果将来你要把 skill 做成模板文件，建议采用这种结构：

```yaml
name: create-current-task
purpose: Generate the first draft of CURRENT_TASK.md from a user request.
stage: 阶段 1：需求进入
trigger: 当用户提出新需求，且当前没有可直接执行的任务包时
inputs:
  - user_request
  - project_profile
  - current_status
reads:
  - PROJECT_PROFILE.yaml
  - STATUS.md
  - DECISIONS.md
writes:
  - CURRENT_TASK.md
forbidden_writes:
  - CONTRACTS.md
  - codebase/*
must_check:
  - 是否写清任务目标
  - 是否写清允许修改范围
  - 是否写清禁止修改范围
  - 是否写清验收标准
stop_conditions:
  - 用户需求本身仍然模糊
  - 任务边界无法确定
  - 触及已确认决策但未显式说明
output:
  - CURRENT_TASK.md draft
handoff:
  success: review-current-task
  failure: ask-user
decision_policy:
  mechanical: 可自动补全字段格式
  taste: 不可自动假设验收标准细节
  user_challenge: 不可擅自改写任务目标
verification:
  - CURRENT_TASK.md 含所有必填章节
  - 修改范围与禁止范围明确
notes:
  - 如项目尚未建立治理文件，先提示使用 init-governance
```

这个 schema 最重要的价值是：以后你不是在维护“很多 skill 文本”，而是在维护**一套一致的 skill 协议**。

补充约束：

- `handoff.failure` 可以指向另一个 skill，也可以指向保留的人工交互节点 `ask-user`
- 纯分析 / 纯审查类 skill 应使用 `writes: []`，而不是模糊写成 “response only”

---

### 3.6 各类 Skill 的扩展字段

虽然所有 skill 都应该遵循统一的通用 schema，但不同类型的 skill 还会有各自专属字段。

推荐按 6 类补充扩展字段：

#### 1. 任务生成类 Skill

适用：

- `create-current-task`
- `review-current-task`
- `decompose-task`

建议增加：

- `task_scope_rules`：如何定义允许/禁止修改范围
- `required_sections`：文档中必须包含的章节
- `acceptance_rules`：验收标准应达到什么粒度
- `step_granularity`：拆步应细到什么程度

#### 2. 范围与契约类 Skill

适用：

- `lock-scope`
- `verify-contracts`
- `review-diff`

建议增加：

- `contract_layers`：检查接口契约还是架构契约
- `scope_sources`：边界定义来自哪些文档
- `diff_filters`：审查哪些文件类型或目录
- `violation_levels`：越界问题如何分级

#### 3. 实现类 Skill

适用：

- `implement-current-step`
- `investigate-root-cause`

建议增加：

- `allowed_change_types`：允许做新增、修改、删除中的哪些
- `disallowed_patterns`：禁止顺手重构、禁止扩大范围等
- `step_limit`：一次最多执行几个步骤
- `regression_expectation`：完成后最少要做哪些验证

#### 4. 验证类 Skill

适用：

- `run-regression`
- `review-diff`

建议增加：

- `test_sources`：从哪里读取测试命令
- `smoke_checks`：最低人工检查清单
- `pass_criteria`：什么叫通过
- `failure_policy`：失败后是停机、重试还是进入根因定位

#### 5. 状态同步类 Skill

适用：

- `sync-current-task`
- `sync-status`
- `sync-contracts`
- `sync-decisions`
- `capture-lessons`

建议增加：

- `sync_rules`：何种情况下应该更新此文档
- `stability_threshold`：什么程度才允许写入稳定契约
- `decision_record_policy`：什么决策值得正式记录
- `lesson_capture_rules`：什么坑值得写入长期经验

#### 6. 交付与归档类 Skill

适用：

- `prepare-delivery-summary`
- `archive-task`

建议增加：

- `summary_fields`：交付摘要必须包含哪些字段
- `archive_naming`：归档文件命名规则
- `archive_conditions`：什么时候允许归档
- `next_task_policy`：是否需要自动提示下一任务

这些扩展字段的作用是：在不破坏通用 schema 的前提下，让每类 skill 更适配自己的工作职责。

---

### 3.7 每个 Skill 的最小字段建议

下面这张表，是你后续真要实现 skill 模板时最有用的“最小字段要求”。

| Skill | 最少必须补充的字段 |
|---|---|
| `init-governance` | `inputs`、`writes`、`output`、`verification` |
| `create-current-task` | `required_sections`、`task_scope_rules`、`acceptance_rules` |
| `review-current-task` | `must_check`、`stop_conditions`、`decision_policy` |
| `lock-scope` | `scope_sources`、`contract_layers`、`violation_levels` |
| `classify-decisions` | `decision_policy`、`output`、`handoff` |
| `decompose-task` | `step_granularity`、`acceptance_rules`、`verification` |
| `implement-current-step` | `allowed_change_types`、`disallowed_patterns`、`step_limit` |
| `investigate-root-cause` | `inputs`、`must_check`、`failure_policy` |
| `review-diff` | `diff_filters`、`contract_layers`、`violation_levels` |
| `verify-contracts` | `contract_layers`、`pass_criteria`、`stop_conditions` |
| `run-regression` | `test_sources`、`smoke_checks`、`pass_criteria` |
| `sync-current-task` | `sync_rules`、`verification` |
| `sync-status` | `sync_rules`、`output` |
| `sync-contracts` | `stability_threshold`、`contract_layers` |
| `sync-decisions` | `decision_record_policy`、`decision_policy` |
| `capture-lessons` | `lesson_capture_rules`、`output` |
| `prepare-delivery-summary` | `summary_fields`、`verification` |
| `archive-task` | `archive_naming`、`archive_conditions`、`next_task_policy` |

这个表的意义是：  
你以后就算先不做完整模板系统，也可以先检查“某个 skill 是否已经达到最低治理标准”。

---

### 3.8 完整 Skill 清单

下面这份清单，是把这套工作流真正系统化时，最值得先具备的标准 skill 集。

| Skill | 作用 | 触发时机 | 读取 | 更新/输出 | 对应阶段 |
|---|---|---|---|---|---|
| `init-governance` | 初始化治理骨架 | 新项目开始使用体系时 | 项目目录、项目画像 | 生成建议的文档集合与缺失清单 | 初始化 |
| `create-current-task` | 根据需求生成任务包初稿 | 新需求进入时 | `STATUS.md`、`DECISIONS.md`、项目画像 | `CURRENT_TASK.md` 初稿 | 阶段 1 |
| `review-current-task` | 审查并收敛任务包 | 任务包初稿完成后 | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | 修订后的任务包、待确认项 | 阶段 1 |
| `lock-scope` | 明确本轮修改边界 | 实现前 | `CURRENT_TASK.md`、`CONTRACTS.md` | 范围锁定说明 | 阶段 2 |
| `classify-decisions` | 做决策分级 | 方案拆解前 | `CURRENT_TASK.md`、`DECISIONS.md` | 决策分类结果 | 阶段 3 |
| `decompose-task` | 把任务拆成独立步骤 | 决策分级后 | `CURRENT_TASK.md`、项目画像 | 步骤清单、建议顺序 | 阶段 3 |
| `implement-current-step` | 实现当前步骤 | 进入开发时 | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` | 代码改动、执行记录 | 阶段 4 |
| `investigate-root-cause` | 做根因定位 | 修 bug 或验证失败时 | 当前 diff、报错、`CURRENT_TASK.md` | 根因判断、最小修复建议 | 阶段 4/6 |
| `review-diff` | 审查是否越界或破坏契约 | 每步实现后 | diff、`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | 审查结论、问题清单 | 阶段 5 |
| `verify-contracts` | 专查接口与架构契约 | diff 较大或风险较高时 | diff、`CONTRACTS.md` | 契约风险清单 | 阶段 5 |
| `run-regression` | 跑测试或做 smoke check | 实现后 | `CURRENT_TASK.md`、项目画像中的测试命令 | 验证结果 | 阶段 6 |
| `sync-current-task` | 回写任务执行状态 | 每轮结束 | `CURRENT_TASK.md`、实际结果 | 更新任务记录 | 阶段 7 |
| `sync-status` | 更新项目整体状态 | 任务阶段完成后 | `STATUS.md`、`CURRENT_TASK.md` | 新状态记录 | 阶段 7 |
| `sync-contracts` | 新稳定边界写入契约 | 形成新接口/新规则时 | `CONTRACTS.md`、实际改动 | 契约更新建议 | 阶段 7 |
| `sync-decisions` | 把确认过的决策落盘 | 出现新决策时 | `DECISIONS.md`、`CURRENT_TASK.md` | 决策记录 | 阶段 7 |
| `capture-lessons` | 沉淀可复用经验 | 任务收尾或踩坑后 | `LESSONS.md`、本轮结果 | lessons 记录 | 阶段 7 |
| `prepare-delivery-summary` | 形成本轮摘要 | 一轮任务完成时 | `CURRENT_TASK.md`、验证结果、diff | `TASK_SUMMARY` 内容 | 阶段 8 |
| `archive-task` | 归档本轮任务 | 任务正式完成时 | `CURRENT_TASK.md`、摘要 | `TASKS/` 归档文件 | 阶段 8 |

这套 skill 清单本身就是标准化协议的一部分：  
以后你不是每次临时想“该怎么提示 AI”，而是**按阶段调用固定 skill**。

---

### 3.9 所有需要的文件清单（先定义，不先生成）

如果你要把这套体系真正做成“模板 + skill + 协议”的系统，建议把文件分成 4 层。

#### A. 协议与配置层

这些文件负责定义规则本身：

- `PROJECT_PROFILE.yaml`：项目画像，描述技术栈、目录、测试命令、禁改区域、架构边界
- `WORKFLOW_PROTOCOL.md`：工作流协议，定义阶段流转、状态更新要求、停止条件
- `SKILL_REGISTRY.md`：skill 清单、职责、触发条件、输入输出说明
- `FILE_SCHEMAS.md`：各治理文档必须包含的字段与更新时机

#### B. 模板层

这些文件负责定义未来如何生成文档和 skill：

- `templates/docs/CURRENT_TASK.md.tmpl`
- `templates/docs/CONTRACTS.md.tmpl`
- `templates/docs/STATUS.md.tmpl`
- `templates/docs/DECISIONS.md.tmpl`
- `templates/docs/LESSONS.md.tmpl`
- `templates/docs/TASK_SUMMARY.md.tmpl`
- `templates/docs/TASK_ARCHIVE.md.tmpl`
- `templates/skills/init-governance.SKILL.md.tmpl`
- `templates/skills/create-current-task.SKILL.md.tmpl`
- `templates/skills/review-current-task.SKILL.md.tmpl`
- `templates/skills/lock-scope.SKILL.md.tmpl`
- `templates/skills/classify-decisions.SKILL.md.tmpl`
- `templates/skills/decompose-task.SKILL.md.tmpl`
- `templates/skills/implement-current-step.SKILL.md.tmpl`
- `templates/skills/investigate-root-cause.SKILL.md.tmpl`
- `templates/skills/review-diff.SKILL.md.tmpl`
- `templates/skills/verify-contracts.SKILL.md.tmpl`
- `templates/skills/run-regression.SKILL.md.tmpl`
- `templates/skills/sync-current-task.SKILL.md.tmpl`
- `templates/skills/sync-status.SKILL.md.tmpl`
- `templates/skills/sync-contracts.SKILL.md.tmpl`
- `templates/skills/sync-decisions.SKILL.md.tmpl`
- `templates/skills/capture-lessons.SKILL.md.tmpl`
- `templates/skills/prepare-delivery-summary.SKILL.md.tmpl`
- `templates/skills/archive-task.SKILL.md.tmpl`

#### C. 运行时治理文档层

这些文件是项目实际运行中持续被读取、更新的工件：

- `CLAUDE.md`
- `CONTRACTS.md`
- `STATUS.md`
- `DECISIONS.md`
- `CURRENT_TASK.md`
- `LESSONS.md`
- `TASKS/`

#### D. 可选的验证与摘要层

这些文件不是每个项目都必须，但当你想让交付更可审计时很有价值：

- `reports/TASK-xxx-verification.md`
- `reports/TASK-xxx-summary.md`
- `reports/TASK-xxx-review.md`

也可以不单独保留 `reports/`，而是把这些内容合并进 `TASKS/` 归档文件中。

---

### 3.10 文件与工作流步骤的对应关系

下面这张表，是你真正落地时最关键的映射。

| 工作流步骤 | 核心 skill | 必读文件 | 主要输出/更新 | 必备模板 |
|---|---|---|---|---|
| 阶段 1：需求进入 | `create-current-task` / `review-current-task` | `PROJECT_PROFILE.yaml`、`STATUS.md`、`DECISIONS.md` | `CURRENT_TASK.md` 初稿与修订版 | `CURRENT_TASK.md.tmpl` |
| 阶段 2：范围锁定 | `lock-scope` | `CURRENT_TASK.md`、`CONTRACTS.md` | 范围锁定说明、禁止修改清单 | `lock-scope.SKILL.md.tmpl` |
| 阶段 3：方案拆解 | `classify-decisions` / `decompose-task` | `CURRENT_TASK.md`、`DECISIONS.md`、`PROJECT_PROFILE.yaml` | 决策分类、步骤拆解 | `decompose-task.SKILL.md.tmpl` |
| 阶段 4：小步实现 | `implement-current-step` | `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` | 代码改动、执行记录 | `implement-current-step.SKILL.md.tmpl` |
| 阶段 5：范围复核 | `review-diff` / `verify-contracts` | diff、`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` | 越界结论、契约风险清单 | `review-diff.SKILL.md.tmpl` |
| 阶段 6：回归验证 | `run-regression` / `investigate-root-cause` | `CURRENT_TASK.md`、`PROJECT_PROFILE.yaml`、测试结果 | 验证结论、修复建议 | `run-regression.SKILL.md.tmpl` |
| 阶段 7：状态同步 | `sync-current-task` / `sync-status` / `sync-contracts` / `sync-decisions` / `capture-lessons` | `CURRENT_TASK.md`、`STATUS.md`、`CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` | 文档同步结果 | 对应各 sync 模板 |
| 阶段 8：交付沉淀 | `prepare-delivery-summary` / `archive-task` | `CURRENT_TASK.md`、验证结果、摘要内容 | `TASKS/` 归档、任务摘要 | `TASK_SUMMARY.md.tmpl`、`TASK_ARCHIVE.md.tmpl` |

这张表背后的原则是：

- 每个阶段都有固定 skill
- 每个 skill 都有固定输入
- 每个阶段结束都必须产出下阶段可消费的工件

这时你的系统才不是“靠聊天记忆推进”，而是**靠工件链路推进**。

---

## 四、标准工作流

## 阶段 1：需求进入

目标：先定义这次要做什么，不要直接让 AI 开始写。

你需要先回答 3 个问题：

1. 这次要解决什么问题
2. 最小可接受结果是什么
3. 哪些现有功能绝对不能被破坏

然后创建或更新 `CURRENT_TASK.md`，把这次变更变成一个标准任务包：

```md
# CURRENT_TASK.md

## 任务信息
- 任务 ID：TASK-xxx
- 目标：
- 创建时间：

## 验收标准
- ...

## 允许修改范围
- ...

## 禁止修改范围
- ...

## 受影响的契约
- （对照 CONTRACTS.md，列出本次可能触碰的契约项）

## 回归检查项
- （本次改动后需要验证哪些已有功能仍正常）

## 回滚点
- （如果出问题，怎么撤回）

## 决策分类
- （哪些是技术必然，哪些是口味选择，AI 不可自行更改口味决策）

## 执行记录
- [ ] 步骤 1：...
- [ ] 步骤 2：...
```

`CURRENT_TASK.md` 的核心价值：**每次改动都有来源、有边界、有证据、有回滚、有后续状态同步**。
它不是给人看的文档，而是 AI 每轮开始工作前必须读取的"工单"。

同时检查 `DECISIONS.md`：本次需求是否涉及已确认的决策？是否需要新增决策记录？

这一阶段对应 gstack 的 `/office-hours` + `/autoplan` 思路：先想清楚，再动手。

---

## 阶段 2：范围锁定

目标：明确这次允许 AI 修改哪里，不允许改哪里。

这里使用两套边界：

- `CONTRACTS.md` 的**接口契约**：哪些 API、函数、表结构不能破坏
- `CONTRACTS.md` 的**架构契约**：哪些依赖方向、分层规则、状态流不能违反
- `CURRENT_TASK.md` 的**允许/禁止修改范围**

推荐你在每次下指令时使用这个模板：

```md
本次任务只允许修改以下范围：
- ...
- ...

禁止修改：
- ...
- ...

如果你认为必须修改范围外文件，先停下来告诉我原因。
如果你要改 CONTRACTS.md 中标记为 🔒 的内容（包括架构契约），也必须先停下来。
如果你要改 DECISIONS.md 中已确认的决策（架构决策或口味决策），也必须先停下来。
```

特别注意架构契约的保护——AI 最容易悄悄破坏的往往不是函数签名，而是：

- 引入反向依赖（下层 import 上层）
- 跨层直接调用（页面直连数据库）
- 改变状态流向（绕过 store 直接操作）
- 改变已锁定的事件/DTO 字段名

这一阶段对应 gstack 的：

- `freeze`：限制修改边界
- `careful`：防止危险操作
- `scope drift detection`：防止改动漂移

---

## 阶段 3：方案拆解

目标：不要让 AI 一次做完整个复杂功能，而是先拆成不会互相污染的小步。

拆步之前，先做**决策分级**：

把本次需求涉及的决策分成三类（对应 gstack `/autoplan` 的 Mechanical / Taste / User challenge）：

1. **可自动决策**：纯技术实现，AI 可以自行判断
   - 例：用 `Array.filter` 还是 `for` 循环
2. **口味决策**：有多种合理选择，但需要你定
   - 例：筛选器放列表上方还是侧边栏
   - 例：空状态显示什么文案
3. **不可被 AI 静默改变**：已有的架构/产品决策
   - 例：不引入 GraphQL（已否决）
   - 例：状态管理用 Zustand（已确认）

口味决策和已确认决策写入 `DECISIONS.md` 和 `CURRENT_TASK.md` 的决策分类区。
**AI 只能自行处理第 1 类，第 2、3 类必须明确记录且不可自行变更。**

然后再拆步骤。推荐拆法：

- 先拆“数据/接口层”
- 再拆“状态/服务层”
- 最后拆“UI/交互层”

或者按业务流程拆：

- 第一步：只打通读
- 第二步：只打通写
- 第三步：只补异常和边界
- 第四步：只补体验和样式

每一步都要满足：

- 有明确输入
- 有明确输出
- 能独立验证
- 不需要同时改太多模块

把步骤写回 `CURRENT_TASK.md` 的执行记录区：

```md
## 执行记录
- [ ] 步骤 1：补订单筛选参数解析（可自动决策）
- [ ] 步骤 2：补后端查询逻辑（可自动决策）
- [ ] 步骤 3：补前端筛选 UI（包含口味决策：位置已定在列表上方）
- [ ] 步骤 4：集成联调 + 回归验证
```

这一阶段对应 gstack 的：

- `/autoplan`（决策分级 + 步骤拆解）
- `/plan-eng-review`（技术可行性）
- `/plan-design-review`（设计决策）

对于个人项目，不一定要出大文档，但一定要先拆步、先定决策。

---

## 阶段 4：小步实现

目标：一次只做一个小步，做完立即停，立即检查。

推荐执行规则：

1. 一次只让 AI 完成一个明确子任务
2. 不允许在同一轮里同时修 bug、加功能、顺手重构
3. 每轮完成后必须输出“实际改了什么”
4. 如果触碰稳定契约，立即停止

推荐提示词模板：

```md
现在只做第 2 步：补后端查询逻辑。

要求：
- 只改这一步需要的代码
- 不要顺手重构
- 不要改已有接口签名
- 完成后列出修改文件和具体改动点
```

这是整个流程里最关键的一点：

> 大型项目不是不能 vibe coding，而是不能“整块交给 AI 一口气乱写”。

---

## 阶段 5：范围复核

目标：每做完一步，都确认这轮改动有没有越界。

固定检查项：

### 1. 改动范围检查

```bash
git --no-pager diff --stat
```

确认：

- 改动文件是否都在允许范围内
- 是否出现没有事先批准的越界修改
- 是否出现与当前子任务无关的文件改动

### 2. 接口契约检查

对照 `CONTRACTS.md` 接口契约层检查：

- API 路径、入参、返回结构是否变了
- 核心函数签名是否变了
- 表结构是否变了
- 稳定导出是否被破坏

### 3. 架构契约检查

对照 `CONTRACTS.md` 架构契约层检查：

- 是否引入了反向依赖（下层 import 上层）
- 是否跨层直接调用（页面直连 DB 等）
- 状态流是否被改变或绕过
- 已锁定的 DTO/事件字段名是否被改
- 目录职责是否被混淆（业务逻辑写进了路由层等）

### 4. 决策一致性检查

对照 `DECISIONS.md` 和 `CURRENT_TASK.md` 检查：

1. 本轮改动是否只服务于当前子任务
2. 有没有“顺手做了别的”
3. 有没有为了省事改掉稳定逻辑
4. 有没有静默覆盖已确认的口味决策或架构决策
5. 有没有引入了已否决的方案（如 DECISIONS.md 中 REJECTED 的技术）

这一阶段就是 gstack `review` 里的核心价值：**检查实际 diff 是否仍然符合最初意图和已确认的决策。**

---

## 阶段 6：回归验证

目标：确认这次新增需求没有把旧功能带崩。

优先级从高到低：

### A. 跑已有测试

如果项目已经有测试：

- 先跑与当前改动直接相关的测试
- 再跑核心稳定功能相关测试

### B. 做最小 smoke check

如果测试不完善，至少做下面几类检查：

- 核心页面能否打开
- 核心 API 是否仍返回原结构
- 关键提交流程是否仍走通
- 关键 import / 路由 / 状态流是否断裂

### C. 修 bug 采用最小修复原则

如果验证中发现 bug：

- 先定位根因
- 只修当前 bug
- 禁止顺手优化
- 3 次失败后必须停

这一阶段对应 gstack 的：

- `/qa`
- regression test thinking
- investigate-before-fix

---

## 阶段 7：状态同步

目标：每轮开发结束后，把项目状态更新回系统里，而不是只留在聊天记录里。

至少更新这 5 类信息：

### 1. 更新 `CURRENT_TASK.md` 的执行记录

- 把完成的步骤打 [x]
- 记录实际改动与预期的差异（如有）
- 如果是大功能最后一步，将 CURRENT_TASK.md 归档到 TASKS/ 目录

### 2. 更新 `STATUS.md`

- 哪个子任务完成了
- 哪个模块从"开发中"进入"稳定"
- 哪个需求被取消或推迟

### 3. 更新 `CONTRACTS.md`

如果本轮新增了新的稳定接口、稳定方法、稳定数据结构：

- 把它们记进契约文件（接口契约层或架构契约层）

注意：

- 只有真正稳定了再写进契约
- 正在迭代的临时接口不要太早锁死
- 如果本轮确立了新的架构规则（如新增的依赖方向约束），也写入架构契约层

### 4. 更新 `DECISIONS.md`

如果本轮做出了新的决策：

- 新的架构决策 → 记入 🏗️ 架构决策
- 新的口味选择 → 记入 🎨 口味决策
- 暂缓的方案 → 记入 ⏸️ 暂缓决策
- 评估后否决的方案 → 记入 ❌ 已否决

每条决策至少记录：做了什么选择、为什么、有什么约束、AI 不可自行变更。

### 5. 更新 `LESSONS.md`

记录：

- 本轮踩了什么坑
- 哪些边界容易被 AI 误改
- 哪种提示方式更稳定
- 哪些决策类型容易被 AI 偷换

这一阶段对应 gstack 的：

- `/document-release`（文档同步）
- `/learn`（经验沉淀）

---

## 阶段 8：交付沉淀

目标：把这轮工作从“做完”变成“可继续推进”。

每轮完成时最好产出一份固定摘要：

```md
本轮任务摘要：
- 任务目标：
- 完成情况：
- 实际修改文件：
- 是否越界修改：
- 是否触碰稳定契约：
- 验证结果：
- 下一步建议：
```

如果是大功能完成，还应该补三件事：

- 把 `CURRENT_TASK.md` 归档到 `TASKS/` 目录（如 `TASKS/TASK-012-订单筛选.md`）
- 把文档同步到项目文档中
- 把下一阶段任务写回 `STATUS.md`，并创建新的 `CURRENT_TASK.md`

这一阶段对应 gstack 的：

- `/ship`
- `/document-release`
- `/retro`

---

## 五、按任务大小选择流程深度

不是每个任务都要跑完整流程。

推荐用 3 档：

## 1. 小任务流程

适用：

- 文案修改
- 小 UI 调整
- 单文件小 bug

流程：

```text
需求进入 → 范围锁定 → 小步实现 → 范围复核 → 状态同步
```

## 2. 中任务流程

适用：

- 一个完整页面功能
- 一个 API 的新增能力
- 一个模块内的局部重构

流程：

```text
需求进入 → 范围锁定 → 方案拆解 → 小步实现 → 范围复核 → 回归验证 → 状态同步
```

## 3. 大任务流程

适用：

- 多模块联动功能
- 核心流程改造
- 复杂业务需求或重要重构

流程：

```text
需求进入 → 范围锁定 → 方案拆解 → 多轮小步实现 → 每轮范围复核 → 回归验证 → 状态同步 → 交付沉淀
```

大任务的关键不在“写得更慢”，而在“每轮都能停住并重新看清全局”。

---

## 六、推荐的日常使用方式

如果你日常用的是 `Codex CLI + Copilot CLI`，推荐这样分工：

### Copilot CLI

适合：

- 快速实现
- 写样板代码
- 按明确范围完成单步任务

### Codex CLI

适合：

- 做第二视角审查
- 检查 scope creep
- 检查接口破坏
- 复核大 diff 是否偏离任务意图

推荐组合方式：

1. 先用一个工具做实现
2. 再用另一个工具做“只找问题不改代码”的审查
3. 最后由你做收口确认

这相当于把 gstack 里的 `review / adversarial / cross-model` 思路，轻量化地放进你的日常流程。

---

## 七、你每次都可以直接复用的执行模板

下面是一份适合直接发给 AI 的任务模板：

```md
这是一次大型项目中的局部开发任务。

请先阅读：
- CLAUDE.md
- CONTRACTS.md（接口契约 + 架构契约）
- STATUS.md
- DECISIONS.md
- LESSONS.md
- CURRENT_TASK.md（本次任务的完整定义）

本次任务定义在 CURRENT_TASK.md 中，包括：
- 任务目标和验收标准
- 允许/禁止修改范围
- 受影响的契约
- 回归检查项
- 决策分类（哪些你可以自行决定，哪些不能改）

规则：
1. 如果要修改范围外文件，先停下来说明原因
2. 如果要改 CONTRACTS.md 中的 🔒 内容（接口或架构），先停下来
3. 如果要改 DECISIONS.md 中已确认的决策，先停下来
4. 只完成 CURRENT_TASK.md 中当前步骤，不要顺手重构
5. 完成后列出修改文件，对比 CURRENT_TASK.md 的允许范围
6. 完成后执行范围复核（接口契约 + 架构契约 + 决策一致性）
7. 如果连续 3 次修复失败，停止并汇报
8. 完成后更新 CURRENT_TASK.md 的执行记录
```

---

## 八、最终建议

把这套流程真正用起来时，不要追求一次到位。

推荐的升级路径：

```text
最小集合    CLAUDE.md + CONTRACTS.md（接口层） + STATUS.md
    ↓
中级集合    + CONTRACTS.md（架构层） + DECISIONS.md + LESSONS.md
    ↓
完整集合    + CURRENT_TASK.md + TASKS/ 归档
```

最好的落地顺序是：

1. 先固定 `CONTRACTS.md`（至少写好接口契约层）
2. 再固定每轮任务用 `CURRENT_TASK.md` 定义修改范围
3. 再固定每轮结束后的范围复核（`git diff --stat` + 契约检查 + 决策检查）
4. 再把 `STATUS.md` 和 `LESSONS.md` 持续维护起来
5. 当出现"决策被 AI 悄悄覆盖"时，补上 `DECISIONS.md`
6. 当项目架构变复杂时，补上 `CONTRACTS.md` 架构契约层

这套体系的最终目标不是"让开发变慢"，而是：

> 从"防失控流程"升级为"可审计的项目治理系统"——
> 让每次改动都有来源、有边界、有证据、有回滚、有后续状态同步。

你可以继续保持 vibe coding 的速度，但项目不会那么容易失控。
