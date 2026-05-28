# AI 辅助开发方法论：面向大型 Vibe Coding 项目的治理体系

这是一份把以下三份文档合并、去重、重构后的完整方法论文档：

- 历史 gstack 分析材料（迁移前位于 gstack 源仓库）
- [`vibe-coding-quality-system.md`](./vibe-coding-quality-system.md)
- [`vibe-coding-workflow.md`](./vibe-coding-workflow.md)

它不是对 `gstack` 的逐句翻译，也不是一套提示词合集。

它的目标是把 `gstack` 最值得迁移的部分提炼出来，变成一套适合个人开发者、尤其适合 `Codex CLI + Copilot CLI` 组合使用的 **项目治理系统**。

这份文档重点解决的是：

- 项目变大后，AI 顺手改坏稳定功能
- 一次局部修改扩散到无关模块
- 新增需求、删除需求、改需求后，项目状态逐渐失控
- AI 在没有明确授权的情况下替你做了产品或架构决策
- 修 bug 越修越乱，最后无法判断哪些东西还是可信的

如果只想先理解治理思想，可以从本文开始；正式结构、流程执行规则和生成链仍以 [`.workflow-system/WORKFLOW_PROTOCOL.md`](../.workflow-system/WORKFLOW_PROTOCOL.md)、[`.workflow-system/FILE_SCHEMAS.md`](../.workflow-system/FILE_SCHEMAS.md) 与 [`vibe-coding-workflow.md`](./vibe-coding-workflow.md) 为准。

---

## 一、方法论来源与背景

### 1.1 `gstack` 是什么

`gstack` 本质上是一套 AI 工程工作流系统，而不是一堆零散工具。

它的核心思想不是：

- “给 AI 更多提示词”
- “把 agent 调得更聪明”
- “堆更多角色”

而是：

- 把开发过程拆成明确阶段
- 让每个阶段产出下一阶段要消费的工件
- 让代码改动通过固定关卡，而不是只靠聊天上下文自然延续

它更像一个 AI 时代的软件开发操作系统。

---

### 1.2 `gstack` 最有价值的不是技能数量，而是流程骨架

`gstack` 公开强调的一点非常关键：

> 它是 process，不只是 a collection of tools。

它把开发主线固定成：

```text
Think → Plan → Build → Review → Test → Ship → Reflect
```

再进一步展开，可以映射为：

```text
office-hours → plan-* → implement → review → qa → ship → document-release → learn / retro
```

也就是说，它真正强的地方不是“有 30 多个 skill”，而是：

- 每一步都知道自己在解决什么问题
- 每一步都留下可复核的工件
- 每一步都有明确的质量门槛
- 后面的步骤不是凭感觉接上，而是消费前一步的输出

---

### 1.3 为什么这套思路值得迁移到个人 Vibe Coding

对于个人开发者来说，真正的问题通常不是“开发不够快”，而是：

- 快速生成的新代码会侵蚀旧代码的稳定性
- 需求解释权被 AI 偷走
- 项目状态只存在聊天记录里，不存在工程工件里
- 随着上下文漂移，AI 越来越容易在错误边界内继续工作

AI 最大的改变，不只是把写代码变快了，而是把 **“把事情做完整”** 的成本压低了。

以前你会跳过：

- 先定义边界
- 先写清楚任务包
- 提交前做范围复核
- 更新状态与经验文档

因为这些步骤很费时间。

现在这些步骤本身也可以由 AI 帮你完成，所以最合理的策略不再是“省掉它们”，而是“让 AI 帮你把它们做掉”。

---

### 1.4 我们从 `gstack` 提炼了什么

我们保留的不是 `gstack` 的全部形态，而是它最可迁移的主干：

1. **流程化**：把开发拆成固定阶段
2. **工件化**：让阶段之间靠文档工件衔接，而不是靠聊天记忆
3. **治理化**：让 AI 在边界、决策、状态三个层面都受到约束
4. **审计化**：让每次改动都有来源、有边界、有证据、有回滚、有后续同步

我们没有照搬的部分包括：

- 大量角色化 skill 的完整编排
- 多 agent 并行冲刺
- 复杂的浏览器 QA 编排
- 完整的 release orchestration

这些东西对于个人项目不是没价值，而是优先级低于“先把治理内核搭起来”。

---

## 二、核心理念

### 2.1 核心原则：约束 AI 的自由度，而不是约束 AI 的速度

大型 Vibe Coding 项目最容易失控的原因，不是 AI 生成代码太快，而是 AI 的“自由发挥”范围太大。

所以正确的目标不是：

- 让 AI 少做事
- 让 AI 变慢
- 让 AI 每一步都等你确认

而是：

- 让 AI 在明确定义的边界内快速工作
- 把它不能决定的事情显式写出来
- 让它每次改完都必须证明自己没有越界

一句话总结：

> **保留速度，压缩自由度。**

---

### 2.2 这套体系不是“流程”，而是“治理系统”

如果你只有流程，没有治理，你会得到：

- 一套看起来完整的步骤
- 但 AI 仍然可能偷偷改变架构、需求、口味选择
- 文档写了，但没有形成真正的约束力

真正的治理系统至少要包含三层：

#### 1. 边界系统

定义：

- 什么能改
- 什么不能改
- 这次允许改到哪里
- 哪些稳定接口或结构不能被静默修改

核心工件：

- `CONTRACTS.md`
- `CURRENT_TASK.md`

#### 2. 决策系统

定义：

- 为什么这么做
- 哪些是架构决策
- 哪些是口味选择
- 哪些已经明确否决
- 哪些暂缓，不允许 AI 提前替你实现

核心工件：

- `DECISIONS.md`

#### 3. 状态系统

定义：

- 项目现在处于什么状态
- 哪些功能稳定
- 哪些功能正在开发
- 哪些功能取消或推迟
- 哪些坑已经踩过

核心工件：

- `STATUS.md`
- `LESSONS.md`

这三层合起来，才是治理系统。

---

### 2.3 工件链路优先于聊天上下文

在大型项目里，聊天上下文一定会丢。

所以不能让关键信息只存在于：

- 某次对话
- 某次临时提示
- 某个模型的短期记忆

必须把关键控制信息落成工件。

项目初始化或接入完成后，所有具体变更都应该统一进入同一条日常任务链路：

```text
需求 / 想法
    ↓
CURRENT_TASK.md
    ↓
受影响边界：CONTRACTS.md
    ↓
相关决策：DECISIONS.md
    ↓
开发执行 + git diff
    ↓
范围复核 + 回归验证
    ↓
状态同步：STATUS.md / LESSONS.md
    ↓
任务归档：TASKS/
```

这就是从“靠聊天推动”升级为“靠工件驱动”。

注意，这条链路的前置条件是：项目治理基线已经建立。新项目和老项目进入这条链路之前，入口不同。

在当前 workflow-system 里，这条主链还有两个需要被读者显式看见的分支：

1. **record-only intake branch**：如果当前任务执行中冒出与当前范围无关、但值得留档的新事项，不应直接污染 `CURRENT_TASK.md`，而应通过 `capture-work-item` 写入 `TASKS/inbox/**`，再由人工决定是否另开任务。
2. **lifecycle / ownership branch**：如果验证或排障过程中发现问题实际属于旧任务，不能直接覆盖当前 live task；必须先判断 owner，必要时暂停或中断当前任务，再从可恢复工件回到恢复链。

#### 新项目：先设计基线，再治理固化

新项目不是直接进入 `CURRENT_TASK.md`。当项目只有原始需求或产品想法时，应该先走：

```text
原始需求 / 产品想法
    ↓
design-baseline-init
    ↓
ROADMAP.md / ARCHITECTURE.md / DATABASE.md / docs/designs/**
    ↓
greenfield-init
    ↓
PROJECT_PROFILE.yaml / CONTRACTS.md / DECISIONS.md / BASELINES.md / STATUS.md
    ↓
create-current-task
    ↓
CURRENT_TASK.md
    ↓
日常任务链路
```

`design-baseline-init` 负责把需求推导成首版设计基线：目标用户、核心场景、非目标、成功标准、总体架构、领域模型、数据库设计、接口边界、关键流程、错误路径、权限、异步任务和边界条件。

`greenfield-init` 负责把已经确认的设计固化成治理基线。它不重新设计系统，只把稳定接口、模块边界、数据约束写入 `CONTRACTS.md`，把架构取舍、替代方案和否决方案写入 `DECISIONS.md`，把版本窗口写入 `ROADMAP.md`，把测试、发布、安全、部署、性能等要求写入 `BASELINES.md`。

#### 老项目：先事实盘点，再现状固化

老项目不能按新项目那样重新设计。它应该先做事实盘点、现状固化和风险标注：

```text
现有代码 / 文档 / 数据库 / 部署状态
    ↓
legacy-inventory
    ↓
ARCHITECTURE.md / DATABASE.md / docs/adoption/**
    ↓
adopt-existing-project
    ↓
PROJECT_PROFILE.yaml / CONTRACTS.md / DECISIONS.md / BASELINES.md / STATUS.md / ROADMAP.md
    ↓
create-current-task
    ↓
CURRENT_TASK.md
    ↓
日常任务链路
```

`legacy-inventory` 只描述当前事实：目录、模块、入口、依赖、运行方式、测试方式、真实 API、真实数据模型、真实边界、部署线索和风险区域。结论必须标明 `confirmed`、`inferred` 或 `unknown`。

`adopt-existing-project` 负责把确认后的老项目事实固化为治理基线。`CONTRACTS.md` 优先锁定已经被代码依赖的 API、数据库字段、公共模块、目录职责和兼容性行为；`STATUS.md` 标记 stable / fragile / unknown / deprecated；`DECISIONS.md` 补录历史决策时可以写 `source: inferred from existing implementation`、`original reason: unknown` 和 `review condition`，不能强行编造历史原因。

---

### 2.4 从 `gstack` 借来的强约束规则

以下规则在 `gstack` 中反复出现，也应该成为你的常驻规则：

- **零静默失败**：不要写“处理错误”，要写清楚错误是什么、怎么暴露
- **显式失败模式**：非平凡流程必须考虑 success / empty / nil / error 等路径
- **先复用后抽象**：先搜索现有实现，再决定是否新建抽象
- **先定义范围再实现**：没有边界的实现一定会漂移
- **测试映射要明确**：至少说明本次改动验证了哪些 code path
- **非平凡系统要有图**：复杂依赖、状态流、数据流最好有 ASCII 图
- **文档不是收尾工作**：文档和状态同步应嵌入每次变更流程

### 2.5 传播治理：先判断影响链，再决定能不能直接改

传播治理在方法论层面只表示：**不要把局部改动当成“改一个点”，而要先看它是否会沿着消费方、边界或关键路径扩散。**

这会改变大型 Vibe Coding 的默认动作：

1. 先定义变更起点，而不是直接改文件
2. 先收集影响证据，再判断影响范围
3. 先判断能不能兼容扩展，再决定要不要直接改
4. 如果影响面不再是普通局部修改，就把它当成治理问题，而不是纯实现问题

落实到工程里，至少要形成 5 个判断习惯：

- 明确改动起点，而不是直接按文件开改
- 收集影响证据，判断影响面汇总是否可信
- 判断当前对象能否直接修改旧语义
- 影响面变大时，先评估兼容扩展、边界隔离、分阶段迁移或任务拆分是否更稳，而不是默认原位修改
- 把布局、行为、迁移路径、链式回归当成额外治理面，而不是“顺手注意一下”

注意：这些概念仅作为认知模型使用，不构成触发条件、对象状态、固定字段结构或处置分支。任何字段级表达、结构约束、枚举值、错误码、blocker、gate 规则和处置分支，都不在本文定义；一律以 `WORKFLOW_PROTOCOL.md` 和 `FILE_SCHEMAS.md` 为准。

映射声明：本文中的传播治理概念是理解和决策用的抽象层表达。在当前仓库的 workflow-system 参考实现中，这些概念会被映射为正式协议对象，并由 `WORKFLOW_PROTOCOL.md` / `FILE_SCHEMAS.md` 负责字段结构、枚举、gate、错误码和校验规则。本文不维护协议对象字段结构，也不作为模板或生成器的 schema 来源。

---

## 三、治理体系的核心意图

治理文件集合会随 workflow-system 演进；本文只解释边界、决策、状态、任务、经验这几类治理意图。当前正式文档集合、必填章节和落地顺序以 `FILE_SCHEMAS.md` 为准。

---

### 3.1 `CLAUDE.md`

#### 作用

定义 AI 在这个项目里必须遵守的通用工作规则。

它不是任务说明，而是“项目宪法”。

#### 应该记录什么

- AI 每次开始前必须先读哪些文件
- 哪些类型的改动必须停下来确认
- 完成后必须做哪些复核
- 修 bug 的停止条件
- 是否允许顺手重构
- 是否允许修改稳定契约

#### 行为约束示例（非 CLAUDE.md schema）

```md
# CLAUDE.md

开始任何代码修改前，先读取：
- CONTRACTS.md
- STATUS.md
- DECISIONS.md
- CURRENT_TASK.md
- LESSONS.md

规则：
1. 如果要修改 CURRENT_TASK.md 允许范围以外的文件，先停下来说明原因
2. 如果要修改 CONTRACTS.md 中标记为 🔒 的内容，先停下来
3. 如果要覆盖 DECISIONS.md 中已确认的决策，先停下来
4. 只完成 CURRENT_TASK.md 中当前步骤，不要顺手重构
5. 完成后必须执行范围复核和回归验证
6. 修 bug 连续 3 次失败后必须停止继续猜测
```

#### 何时必须启用

- 任何打算长期维护的项目
- 任何会跨会话继续开发的项目
- 任何会交给多个 AI 工具轮流操作的项目

---

### 3.2 `CONTRACTS.md`

#### 作用

定义项目的稳定边界。

它不是简单的接口列表，而是两层契约：

1. **接口契约**
2. **架构契约**

#### 为什么必须两层

很多项目不是函数签名先坏，而是结构先坏。

例如：

- 页面层开始直连数据库
- 下层模块反向依赖上层模块
- 状态流被绕开
- DTO 字段名被偷偷改掉

这些问题单靠“函数签名不能改”是防不住的。

#### 应该记录什么

##### 接口契约层

- 已上线 API 的路径、入参、返回结构
- 核心函数签名
- 已稳定表结构
- 已稳定模块导出

##### 架构契约层

- 依赖方向
- 状态流向
- 目录职责
- DTO/事件语义
- 分层规则
- 受保护对象与兼容约束
- 布局 / 行为 / 响应式 / 样式级联保护面
- API 变更后的前端下游验证面

#### 治理意图示例

本节只说明 `CONTRACTS.md` 应承载稳定边界、兼容约束和架构保护面的治理意图。正式章节、字段、状态标记和模板内容以 `FILE_SCHEMAS.md` 与 `templates/docs/**` 为准；本文不提供可复制模板。

#### 何时必须启用

- 一旦项目存在“已经稳定、不能再乱改”的模块
- 一旦项目开始出现跨模块依赖
- 一旦项目开始分层

---

### 3.3 `STATUS.md`

#### 作用

定义项目当前的真实状态。

它不是计划，而是“盘点表”。

#### 应该记录什么

- 已完成且稳定的功能
- 正在开发中的功能
- 待开发功能
- 已取消或推迟功能

#### 治理意图说明

本节只说明 `STATUS.md` 应承载项目状态盘点和稳定性边界。正式章节、字段、状态标记和模板内容以 `FILE_SCHEMAS.md` 与 `templates/docs/**` 为准；本文不提供可复制模板。

#### 何时必须启用

- 项目开始超过单一功能时
- 你发现自己开始记不清“哪些已经稳定，哪些还在动”时

---

### 3.4 `DECISIONS.md`

#### 作用

记录已经确认的决策、口味选择、暂缓项、否决项。

这是从“流程系统”升级为“治理系统”的关键文件。

很多大型项目失控，不是代码先坏，而是：

- AI 替你改了产品解释
- AI 替你改了设计偏好
- AI 悄悄把一个已否决的技术方案又引回来了

#### 应该记录什么

方法论层面只要求区分“技术/架构约束、产品或口味选择、暂缓事项、明确否决事项”等决策意图；正式分类、章节、字段和编号方式以 `FILE_SCHEMAS.md` 与 `templates/docs/**` 为准。

#### 治理意图说明

本节只说明 `DECISIONS.md` 应承载已确认决策、口味选择、暂缓项和否决项。正式章节、字段、编号方式、状态标记和模板内容以 `FILE_SCHEMAS.md` 与 `templates/docs/**` 为准；本文不提供可复制模板。

#### 何时必须启用

- 当你发现 AI 经常替你做“偏好判断”时
- 当项目出现多个可行但你已经选定其一的方案时
- 当你有明确“以后不要再讨论了”的问题时

---

### 3.5 `CURRENT_TASK.md`

#### 作用

把“当前变更”从散落在对话里的信息，变成一个标准任务包。

它是整个体系里最重要的运行时工件。

#### 应该记录什么

- 当前任务目标
- 验收标准
- 允许修改范围
- 禁止修改范围
- 受影响契约
- 高传播面附加检查（如适用）
- 回归检查项
- 回滚点
- 决策分类
- 执行记录

#### 治理意图说明

本节只说明 `CURRENT_TASK.md` 应承载当前任务目标、边界、验收、风险、决策和执行记录。正式章节、字段、占位符、状态标记和模板内容以 `FILE_SCHEMAS.md` 与 `templates/docs/**` 为准；本文不提供可复制模板。

#### 何时必须启用

- 任何跨多个文件的任务
- 任何需要多轮开发的任务
- 任何你担心 scope drift 的任务

---

### 3.6 `LESSONS.md`

#### 作用

记录跨会话经验，避免同一个坑反复踩。

它是轻量版的项目长期记忆系统。

#### 应该记录什么

- 技术坑
- 环境坑
- 数据坑
- 提示词经验
- AI 容易误改的边界

#### 治理意图说明

本节只说明 `LESSONS.md` 应承载可复用经验、触发信号和应对动作。正式章节、字段和模板内容以 `FILE_SCHEMAS.md` 与 `templates/docs/**` 为准；本文不提供可复制模板。

#### 何时必须启用

- 当你发现“这个坑我明明踩过”时
- 当项目跨会话越来越长时

---

## 四、五层防线

五层防线是这套体系的操作层。

它解决的是三类失控：

| 层次 | 常见症状 | 对应手段 |
| --- | --- | --- |
| 代码层 | 稳定接口被顺手改掉 | 契约锁定 |
| 变更层 | 一次需求修改波及无关文件 | 范围锁定 |
| 项目层 | 不知道哪些稳定、哪些在变 | 状态追踪 |

---

### 第一层：契约锁定

目的：

- 防止 AI 修改稳定接口
- 防止 AI 修改稳定结构

这里的关键不是“把所有东西都锁死”，而是：

- 把真正不能随便变的东西显式标出来
- 区分可扩展与不可破坏

契约锁定包括：

1. 接口契约锁定
2. 架构契约锁定

高风险信号包括：

- 改已有 API 的入参或返回
- 改核心函数签名
- 改已上线表结构
- 改依赖方向
- 绕过状态流
- 更改 DTO / 事件字段名

只要触碰这些内容，就不应让 AI 静默完成。

---

### 第二层：范围锁定

目的：

- 防止 AI 为了完成一个需求，顺手把别的地方也改掉

范围锁定围绕 `CURRENT_TASK.md` 展开：

- 允许修改哪些文件 / 目录
- 禁止修改哪些文件 / 目录
- 如果要越界修改，必须先说明原因

推荐固定表达：

```md
本次任务只允许修改：
- ...
- ...

禁止修改：
- ...
- ...

如果认为必须修改范围外文件，先停下来说明：
1. 要改哪个文件
2. 为什么不改无法完成
3. 准备怎么改
```

这相当于把 `gstack` 里的 `freeze + scope drift detection` 用工件化方式搬了过来。

---

### 第三层：项目状态追踪

目的：

- 保证 AI 和你都知道当前项目的真实状态

核心不是计划，而是“稳定性分区”：

- 哪些功能已经稳定
- 哪些功能正在开发
- 哪些功能即将开发
- 哪些功能已经废弃

这由 `STATUS.md` 承担。

如果不做状态追踪，AI 会天然倾向于：

- 把稳定功能也视作“可随意改动”
- 把半成品与成品同等对待
- 忘记已经取消的需求，又把它重新实现回来

---

### 第四层：变更验证

目的：

- 确保每轮开发完成后，有证据证明没有越界和误伤

变更验证不是“跑个测试”就够了，而是至少包含四类检查：

#### 1. 改动范围检查

```bash
git --no-pager diff --stat
```

确认：

- 改动文件是否都在允许范围内
- 是否有未审批的越界改动
- 是否存在“顺手重构”

#### 2. 接口契约检查

对照 `CONTRACTS.md` 接口契约层：

- API 路径、入参、返回结构是否变化
- 核心函数签名是否变化
- 表结构是否变化
- 稳定导出是否破坏

#### 3. 架构契约检查

对照 `CONTRACTS.md` 架构契约层：

- 是否出现反向依赖
- 是否跨层直接调用
- 状态流是否被绕开
- DTO / 事件字段是否被改
- 目录职责是否混乱

#### 4. 决策一致性检查

对照 `DECISIONS.md` 与 `CURRENT_TASK.md`：

- 本轮改动是否只服务于当前任务
- 有没有“顺手做了别的”
- 有没有覆盖已确认的口味决策
- 有没有引入已否决技术

这一步本质上对应的是 `gstack review` 的核心价值：

> 检查实际 diff 是否仍然符合最初意图与已确认决策。

---

### 第五层：失控停止机制

目的：

- 当修复或开发开始失控时，强制停机，而不是让 AI 无限猜

核心规则：

1. 先诊断，再修复
2. 只做最小修复
3. 禁止顺手优化或重构
4. 连续 3 次尝试失败后必须停止
5. 停止时输出根因分析、尝试记录、下一步建议

推荐规则文本：

```md
修 bug 时先确认根因，再动手修改。
只允许做最小修复，不要顺手优化或重构。
如果连续 3 次尝试没有解决问题，停止并汇报：
1. 已确认的现象
2. 你认为的根因
3. 你已经尝试过什么
4. 你建议的下一步
```

这对应 `gstack` 里的：

- `investigate`
- `qa` 中的自我停止逻辑

### Bug 调查闭环：先证明根因，再允许修复

`gstack /investigate` 最值得迁移的不是“会修 bug”，而是它把调试从猜测式补丁变成了可审计的调查流程。

在大型 Vibe Coding 项目里，只要出现测试失败、回归验证失败、实现过程中出现异常，或者连续修复没有收敛，就不应该继续让 AI “试一个修复”。正确动作是进入 Bug 调查闭环。

#### 触发条件

- 测试失败但原因不明
- 回归验证失败
- 实现过程中出现无法解释的异常
- 同一个 bug 连续修复没有收敛
- 问题可能来自范围外系统、共享模块或架构边界

#### 五步闭环

1. **收集现象**：记录错误信息、失败断言、堆栈、用户可见行为和已知复现步骤。
2. **建立复现**：先确认能否稳定复现；不能复现时先补证据，不直接修。
3. **追踪路径**：从症状反向追代码路径、数据流、状态流、最近 diff 和相关日志。
4. **提出假设**：写出一条可验证的 `Root cause hypothesis`，说明“哪里错了”以及“为什么会导致这个现象”。
5. **验证假设**：用测试、日志、断言、debug 输出或最小复现证明假设成立后，才允许提出最小修复。

#### 硬规则

- 未验证 root cause hypothesis 前不得修复。
- 一次只验证一个假设，不得同时尝试多个修复方向。
- 修复必须针对已证明的根因，而不是隐藏报错、扩大兜底或绕过失败路径。
- 如果 3 个假设都失败，停止并汇报已验证证据，不继续猜。
- 如果根因或最小修复路径超出 `CURRENT_TASK.md` 的允许范围，回到范围锁定，而不是直接扩大改动。
- 如果修复需要改变产品行为、接口契约或架构边界，必须停下确认。

#### 最小调查报告

```md
Bug 调查报告：
- Symptom:
- Reproduction:
- Root cause hypothesis:
- Evidence:
- Minimal fix path:
- Regression check:
- Remaining risk:
```

这对应 workflow-system 中的 `/investigate-root-cause`：方法论文档说明“为什么”，实际项目执行时应由 skill 模板和 `WORKFLOW_GUIDE.md` 承载“怎么做、什么时候用”。

### QA 模式分流：先选验证深度，再跑检查

`gstack` 的 `/qa`、`/qa-only`、`/browse`、`/setup-browser-cookies` 不是四个孤立动作，而是一套验证分流思想：

- `/qa` 提供差异感知验证、完整 QA、快速 smoke 和回归对比。
- `/qa-only` 提供只报告不修复的只读验证模式。
- `/browse` 让 AI 能看到真实 UI、登录状态、交互结果、控制台错误和页面状态。
- `/setup-browser-cookies` 解决认证态页面验证的前置条件。

在 workflow-system 中，这组能力不需要照搬成同名 skill；更稳的落点是阶段 6 的 `/run-regression`。它应该先判断本轮需要哪种 QA mode，再决定要跑哪些测试、是否需要 browser-backed smoke、是否需要 session/cookie。

同时，阶段 6 在当前实现里已经不是“验证失败后直接继续修”的单线流程。验证或排障如果发现问题不属于当前 active task，还必须先做 **ownership-aware routing**：

- 问题仍属于当前任务时，才继续当前修复链。
- 问题虽然属于当前目标，但最小修复面已经越出当前范围时，应先回到范围锁定。
- 问题明显属于之前暂停或中断的任务时，只有在 suspended package evidence 完整、且 active-owner guard 通过时，才允许进入恢复链。
- 其余情况应 fail-closed 到人工决策或新任务，而不是把“旧问题存在”偷换成“现在就自动恢复 / 自动修复”。

#### QA mode

| 模式 | 使用场景 | 验证重点 |
| --- | --- | --- |
| `diff-aware` | 默认模式；一般功能改动 | 根据 `CURRENT_TASK.md`、当前 diff 和回归项验证受影响路径 |
| `quick-smoke` | 小任务、低风险改动 | 相关测试、关键入口、最小 smoke check |
| `full-qa` | 大任务、UI / 交互、高传播面改动 | 核心路径、页面状态、控制台错误、关键用户流程 |
| `report-only` | 冻结期、外部验收、只读审查 | 只输出问题和证据，不修复、不进入实现 |
| `authenticated-browser` | 登录态页面、权限流、账号状态 | 先确认 session/cookie 或人工登录可用 |
| `regression-baseline` | 有 baseline、截图、历史报告 | 前后行为、视觉或性能对比 |

#### 分流规则

- 默认使用 `diff-aware`，不要盲目跑全量 QA。
- UI / 登录 / 表单 / 路由 / 状态流任务，必须说明是否做过 browser-backed smoke。
- 需要登录但 session/cookie 不可用时，应标记为 blocked，而不是把未验证页面记为通过。
- `report-only` 模式下，即使发现问题，也只输出证据，不直接修复。
- `/run-regression` 发现真实失败后，进入 `/investigate-root-cause`；修复仍由实现阶段完成。
- 不把具体浏览器工具写死进方法论；有工具就执行 browser-backed smoke，没有工具就记录人工验证项或 blocked risk。

这里还要额外强调一点：`report-only` 不是“先报告，后面默认继续修”的弱提示，而是**terminal evidence path**。它的职责是停在只读审查或外部验收现场，只交付问题与证据，不自动接入同步链、恢复链或修复链。

#### 最小 QA 报告

```md
QA Report:
- QA mode:
- Target surface:
- Checks run:
- Browser/session requirement:
- Findings:
- Pass / fail:
- Evidence:
- Handoff:
```

### 安全修改边界：把安全模式写进任务工件

`gstack` 的 `/careful`、`/freeze`、`/guard`、`/unfreeze` 不是要在 workflow-system 里照搬成同名 skill，而是下沉到任务级安全边界：

- `/careful`：危险命令不是禁止，而是必须识别、解释、确认。
- `/freeze`：不是依赖 session hook，而是写入 `CURRENT_TASK.md` 的 Allowed Files / Forbidden Files / Conditional Files。
- `/guard`：用于生产、数据库、权限、认证、支付、部署、迁移、批量删除、force push、历史重写等高风险任务。
- `/unfreeze`：不是随手解锁，而是范围扩大流程，必须回到 `/lock-scope` 并留下理由和证据。

workflow-system 不依赖 Claude hook 或 shell 拦截器。即使没有原生 hook，安全约束也必须由 skill 模板、`WORKFLOW_GUIDE.md`、`CURRENT_TASK.md` 和 `/review-diff` 执行。

#### Safety mode

| 模式 | 使用场景 | 落地点 |
| --- | --- | --- |
| `normal` | 普通低风险任务 | `/lock-scope` 仍声明三类修改范围 |
| `careful` | 可能需要危险命令或高影响操作 | `/implement-current-step` 执行 dangerous command gate |
| `frozen-scope` | 只允许改一个模块或一组明确文件 | `CURRENT_TASK.md` 锁定 Allowed / Forbidden / Conditional Files |
| `guarded` | 生产、数据、权限、认证、支付、部署、迁移等高风险任务 | 范围锁定 + 危险命令确认 + `/review-diff` 安全边界审查 |

#### 范围扩大规则

当实现需要修改范围外文件、解除冻结或扩大范围时，不能直接继续实现。正确动作是回到 `/lock-scope`，重新写明：

- 为什么必须扩大范围
- 影响哪些文件
- 风险是什么
- 如何验证
- 新的 Allowed Files / Forbidden Files / Conditional Files

#### 危险命令规则

`/implement-current-step` 遇到递归删除、数据库破坏操作、force push、hard reset、批量移动/删除、生产部署/删除、容器/集群破坏性操作时，必须先输出命令、风险、目标、回滚或恢复方式、范围检查和确认状态。普通构建产物清理可以标为低风险，但仍不得越过任务范围。

#### 安全审查规则

`/review-diff` 不只看 diff 是否能运行，还要检查是否出现：

- 未授权范围扩大
- Forbidden Files 被修改
- Conditional Files 条件不成立
- 危险命令、部署、数据库、权限相关变更
- 绕过 `/lock-scope` 的解锁或扩大范围流程

### 设计生产链路：从设计约束到视觉证据

`gstack` 的 `/design-consultation`、`/design-shotgun`、`/design-html`、`/design-review` 在 workflow-system 中不复制成同名 skill，而是下沉为当前任务级 `设计约束` 和现有执行链路：

- `/design-consultation`：迁移为 `design-system`，用于从零建立任务级设计方向、字体、颜色、间距、布局、动效和设计约束。
- `/design-shotgun`：迁移为 `exploration`，用于 UI 方向不确定时的多方案探索与用户选择。
- `/design-html`：迁移为 `design-to-code`，用于把已批准 mockup、参考图或设计方向转成实现规格。
- `/design-review`：迁移为 `visual-qa`，用于实现后的视觉 QA 和 design drift review。

这不是 native 工具能力的等价实现。workflow-system 不绑定图片生成、comparison board、Pretext、browse daemon 或具体设计工具；如果宿主或项目有这些能力，可以作为 Design evidence 使用，否则记录人工验收或 blocked reason。

#### 任务级设计约束

`CURRENT_TASK.md` 的 `## 设计约束` 只对当前任务生效，不替代长期 `DESIGN.md`、`PROJECT_PROFILE.yaml` 或项目基线。长期设计系统需要另开同步计划。

```md
## 设计约束

- Design mode:
- Design source:
- Design acceptance:
- Design evidence:
- Design open decisions:
```

`DESIGN.md` 只能作为 optional source，不加入 required reads。没有 `DESIGN.md`、mockup、截图或参考链接时，UI 任务必须进入 `design-system` 或 `exploration`，不能直接实现。

#### 设计链路规则

- `/create-current-task` / `/review-current-task` 负责识别 UI / 视觉任务，并锁定 Design mode。
- `/decompose-task` 只消费 Design mode，把 design exploration、design implementation、visual QA 拆成独立步骤。
- `/implement-current-step` 只能实现已确认设计，不得静默更换字体、颜色、布局、动效或品牌语气。
- `/run-regression` 必须输出 visual QA、browser-backed smoke、visual evidence 或 blocked reason。
- `/review-diff` 必须检查 design drift、AI slop、响应式缺口、状态遗漏和无证据视觉结论。

### 发布后验证链路：从 release gate 到上线观察

`gstack` 的 `/land-and-deploy`、`/canary`、`/benchmark`、`/setup-deploy` 在 workflow-system 中不复制成同名 skill，而是下沉为当前任务级 `发布后验证`、长期 `BASELINES.md` 和现有验证 / 状态同步链路：

- `/setup-deploy`：迁移为 `BASELINES.md` 的部署基线和任务级 `Deploy source`，用于记录 production URL、health endpoint、deploy status source、回滚要求。
- `/land-and-deploy`：迁移为 `deploy-verification`，用于记录 CI、deploy log、health check、Release evidence 和 Rollback / recovery。
- `/canary`：迁移为 `canary`，用于记录观察周期、采样次数、失败阈值、默认动作和 remaining observation。
- `/benchmark`：迁移为 `benchmark`，用于记录 performance baseline、baseline source、允许回退阈值和对比证据。

这不是 native 工具能力的等价实现。workflow-system 不执行真实 merge、push、deploy 或监控轮询，也不绑定 Fly、Vercel、Render、browse daemon、Lighthouse 或 Web Vitals runner；这些动作只能由宿主、CI/CD 或项目工具执行，并作为 Release evidence 写回任务。

#### 任务级发布后验证

`CURRENT_TASK.md` 的 `## 发布后验证` 只对当前任务生效，不替代长期 `BASELINES.md`。

```md
## 发布后验证

- Release mode:
- Deploy source:
- Target environment:
- Health checks:
- Canary window:
- Performance baseline:
- Rollback / recovery:
- Release evidence:
```

没有 deploy baseline、health endpoint、production URL、deploy log 或性能 baseline 时，必须输出 blocked risk，不能把任务标记为已稳定。

#### 发布后验证链路规则

- `/create-current-task` / `/review-current-task` 负责识别发布、部署、生产、性能、可靠性或上线后观察任务，并锁定 Release mode。
- `/lock-scope` 对生产、部署、回滚、CI/CD、监控配置、性能基线变更选择 `guarded` 或记录例外。
- `/run-regression` 只读执行 release-readiness、deploy-verification、canary、benchmark 验证并输出证据或 blocked reason。
- `/sync-status` 只能将发布后状态同步为 stable、observing、blocked、rolled-back。
- `/prepare-delivery-summary` 和 `/archive-task` 必须保留 Release evidence、canary result、performance baseline result、rollback status 和 remaining observation。

---

## 五、标准工作流

这一套治理系统，日常运行时落成一个 8 阶段工作流。

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

---

### 阶段 1：需求进入

#### 目标

先定义这次到底要做什么，不要直接让 AI 开始写。

#### 先回答三个问题

1. 这次要解决什么问题
2. 最小可接受结果是什么
3. 哪些现有功能绝对不能被破坏

#### 产出

创建或更新 `CURRENT_TASK.md`。

这个阶段完成后，你应该拥有：

- 任务目标
- 验收标准
- 修改边界
- 回归项
- 回滚点

在 workflow-system 的当前实现里，阶段 1 也不再是“所有想法都直接进入 `CURRENT_TASK.md`”：

- **主链**仍是围绕 `create-current-task` / `review-current-task` 展开的可执行任务包收敛过程。
- **record-only branch** 用于处理当前任务执行中冒出的无关新事项：这类事项先通过 `capture-work-item` 写入 `TASKS/inbox/**`，不自动变成新任务，也不自动切换当前任务。

这样做的目的，是把“记录新事项”和“切换当前任务”分开，避免方法论层默认把所有新想法都解释成当前任务改写或立即建新任务。

#### 阶段门槛

如果 `CURRENT_TASK.md` 还没写清楚，不进入阶段 4。

---

### 阶段 2：范围锁定

#### 目标

明确这次允许 AI 修改哪里，不允许改哪里。

#### 需要同时检查三类边界

1. `CURRENT_TASK.md` 的允许 / 禁止修改范围
2. `CONTRACTS.md` 的接口契约
3. `CONTRACTS.md` 的架构契约

#### 典型提示

```md
本次任务只允许修改以下范围：
- ...

禁止修改：
- ...

如果必须修改范围外文件，先停下来说明原因。
如果要修改 CONTRACTS.md 中标记为 🔒 的内容，也必须先停下来。
如果要覆盖 DECISIONS.md 中已确认的决策，也必须先停下来。
```

#### 阶段门槛

没有明确边界，不进入实现阶段。

---

### 阶段 3：方案拆解

#### 目标

不要让 AI 一次做完整个复杂功能，而是先拆成不会互相污染的小步。

#### 先做决策分级

对应 `gstack /autoplan` 的思想，把决策分成三类：

##### 1. 可自动决策

AI 可以自己判断。

例如：

- 用 `Array.filter` 还是 `for`
- 某个 helper 放哪个文件更顺手

##### 2. 口味决策

有多种合理方案，但需要你拍板。

例如：

- 筛选器放上方还是侧边栏
- 空态文案怎么写
- 错误提示用 toast 还是 inline

##### 3. 不可被 AI 静默改变的决策

已经确认过，AI 不能擅自推翻。

例如：

- 状态管理就是 Zustand
- 当前不引入 i18n
- 当前保持单体，不拆微服务

#### 再做步骤拆解

推荐拆法：

- 先数据 / 接口层
- 再状态 / 服务层
- 最后 UI / 交互层

或者：

- 先打通读
- 再打通写
- 再补异常与边界
- 最后补体验和样式

#### 产出

把步骤写入 `CURRENT_TASK.md` 的执行记录区。

---

### 阶段 4：小步实现

#### 目标

一次只做一个小步，做完立即停，立即检查。

#### 原则

1. 一次只让 AI 完成一个明确子任务
2. 不允许同一轮里同时修 bug、加功能、顺手重构
3. 每轮完成后必须输出“实际改了什么”
4. 如果触碰稳定契约，立即停止

#### 推荐指令

```md
现在只做 CURRENT_TASK.md 中的步骤 2。

要求：
- 只改这一步需要的代码
- 不要顺手重构
- 不要修改已有接口签名
- 完成后列出修改文件和改动点
```

#### 阶段门槛

不能在一轮里既做实现又做口味改动又做结构调整。

---

### 阶段 5：范围复核

#### 目标

每做完一步，都确认本轮改动没有越界。

#### 推荐检查维度（非输出结构）

##### 1. 改动范围检查

```bash
git --no-pager diff --stat
```

确认：

- 改动文件是否都在允许范围内
- 是否有未审批的越界改动
- 是否出现与当前步骤无关的文件改动

##### 2. 接口契约检查

对照 `CONTRACTS.md`：

- API 路径 / 入参 / 返回是否变化
- 核心函数签名是否变化
- 表结构是否变化
- 稳定导出是否被破坏

##### 3. 架构契约检查

对照 `CONTRACTS.md`：

- 是否引入反向依赖
- 是否跨层直接调用
- 状态流是否变化
- DTO / 事件字段是否变化
- 目录职责是否被破坏

##### 4. 决策一致性检查

对照 `DECISIONS.md` 和 `CURRENT_TASK.md`：

- 是否仍然只服务当前子任务
- 是否覆盖了已确认的架构决策
- 是否覆盖了已确认的口味决策
- 是否引入了已否决方案

##### 5. 传播治理检查

对于 API、DTO、共享组件、UI 结构、状态入口这类高传播面改动，再补一层检查。以下条目是执行提示，不是固定 schema：

- 这次改动的起点是什么
- 影响证据是否足够支持当前判断
- 是否存在需要回到 `WORKFLOW_PROTOCOL.md` / `FILE_SCHEMAS.md` 判断的非局部影响风险
- 是否需要按协议源确认正式记录、blocker、gate 或处置路径

#### 阶段门槛

范围复核不通过，不进入后续交付。

---

### 阶段 6：回归验证

#### 目标

确认新增需求没有把旧功能带崩。

#### 优先顺序

##### A. 先选择 QA mode

根据任务风险选择：

- `diff-aware`：默认模式，验证当前 diff 影响面
- `quick-smoke`：小任务或低风险改动
- `full-qa`：大任务、UI / 交互或高传播面改动
- `report-only`：只报告不修复
- `authenticated-browser`：需要登录态或权限验证
- `regression-baseline`：需要前后对比

没有 QA mode，就容易出现两种错误：小改动过度验证，或者高风险 UI 改动只跑了单元测试。

##### B. 跑已有测试

- 先跑与当前改动直接相关的测试
- 再跑核心稳定功能相关测试

##### C. 做最小 smoke check

如果测试不完善，至少检查：

- 核心页面能否打开
- 核心 API 是否仍返回原结构
- 关键流程是否仍走通
- 关键 import / 路由 / 状态流是否断裂
- 高传播面附加检查的结论和剩余风险是否仍然自洽
- UI / 登录 / 表单 / 路由 / 状态流任务是否完成 browser-backed smoke，或明确记录 blocked risk

对于使用 workflow-system 的项目，可追加当前仓库的参考实现校验：

```bash
bun run validate:all
# 或至少
bun run workflow:health
```

##### D. 发现 bug 时按最小修复原则处理

- 先进入 Bug 调查闭环，验证 root cause hypothesis
- 只修已证明的当前 bug
- 禁止顺手优化
- 3 个假设失败后必须停

#### 阶段门槛

没有验证结论，不进入状态同步。

---

### 阶段 7：状态同步

#### 目标

把本轮开发的结果更新回治理系统，而不是只留在聊天记录里。

一轮任务结束后，应检查治理文档是否需要同步；正式同步对象、更新时机、章节、字段和生成/校验规则以 `FILE_SCHEMAS.md`、`templates/docs/**` 与 workflow sync 规则为准。

在当前 workflow-system 中，阶段 7 还承担另一类高层职责：**active ownership 的安全交接**。也就是说，状态同步不只是在任务做完后回写 `STATUS.md` / `LESSONS.md`，还包括：

- 当当前任务需要让出 active ownership 时，通过 `pause-current-task` 或 `interrupt-current-task` 写出可恢复工件。
- 当旧任务需要恢复时，只能从显式、可审计的 suspended package 进入恢复链，而不是凭聊天上下文直接“继续上次任务”。
- 恢复成功后，不允许直接进入实现；恢复后的首个强制消费者必须是 `review-current-task`，由它消费 resume gate、rollback point 和恢复原因，再决定是否重新进入后续实现链。

换句话说，阶段 7 现在同时覆盖两条路径：

1. **steady-state sync**：把当前轮次已经确认的事实写回治理工件。
2. **lifecycle sync**：在 pause / interrupt / resume 时保持 active ownership、恢复输入和后续审查链可审计。

#### 阶段门槛

如果状态没有同步，下轮开发就会在过期上下文里继续。

---

### 阶段 8：交付沉淀

#### 目标

把“做完一轮”变成“可继续推进下一轮”。

#### 每轮可用以下提示收敛交付信息（非 TASK_SUMMARY.md schema）

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

#### 如果是大任务结束

再做三件事：

1. 把 `CURRENT_TASK.md` 归档到 `TASKS/`
2. 把项目文档同步到最新状态
3. 写出下一轮任务的 `CURRENT_TASK.md`

---

## 六、按任务大小选择流程深度

不是每个任务都要跑完整流程。

更实用的做法是：主流程固定，执行深度分档。

---

### 6.1 小任务

#### 适用场景

- 文案修改
- 小 UI 调整
- 单文件小 bug

#### 推荐流程

```text
需求进入 → 范围锁定 → 小步实现 → 范围复核 → 状态同步
```

#### 最少工件

- `CLAUDE.md`
- `CURRENT_TASK.md`

---

### 6.2 中任务

#### 适用场景

- 一个完整页面功能
- 一个 API 的新增能力
- 一个模块内的局部重构

#### 推荐流程

```text
需求进入 → 范围锁定 → 方案拆解 → 小步实现 → 范围复核 → 回归验证 → 状态同步
```

#### 最少工件

- `CLAUDE.md`
- `CONTRACTS.md`
- `CURRENT_TASK.md`
- `STATUS.md`

---

### 6.3 大任务

#### 适用场景

- 多模块联动功能
- 核心流程改造
- 大型重构
- 复杂业务需求

#### 推荐流程

```text
需求进入 → 范围锁定 → 方案拆解 → 多轮小步实现 → 每轮范围复核 → 回归验证 → 状态同步 → 交付沉淀
```

#### 最少工件

- 六个文件全上
- 推荐使用 `TASKS/` 归档历史任务

---

## 七、工具分工：Codex CLI + Copilot CLI

这套方法论最适合的不是“两个工具同时乱跑”，而是 **固定角色**。

推荐默认分工：

- **Copilot CLI**：实现者
- **Codex CLI**：审查者
- **你**：边界和决策的最终裁判

---

### 7.1 推荐默认分工

#### Copilot CLI 负责

- 按 `CURRENT_TASK.md` 的单步实现
- 写样板代码
- 做小范围修改
- 做当前步骤的本地总结

#### Codex CLI 负责

- 只读当前 diff
- 检查 scope drift
- 检查接口契约破坏
- 检查架构契约破坏
- 检查决策漂移

#### 你负责

- 判断是否允许越界修改
- 判断是否允许修改稳定契约
- 做口味决策
- 做架构拍板

---

### 7.2 不要两个工具同时改同一轮代码

强烈建议：

- 一轮任务只指定一个主要实现者
- 另一个工具只做 review，不改代码

否则很容易出现：

- diff 交叉污染
- 谁改坏了无法追责
- 两个模型互相覆盖

推荐模式：

```text
Copilot 实现 → Codex 审查 → 你判断 → Copilot 修正
```

或者：

```text
Codex 做架构审查 / review → Copilot 实现 → Codex 复核
```

---

### 7.3 适合你的四种典型使用模式

#### 模式 A：功能开发

1. 你写 `CURRENT_TASK.md`
2. Copilot CLI 实现当前步骤
3. Codex CLI 只审查 diff，不改代码
4. 你决定是否继续下一步

#### 模式 B：复杂架构任务

1. 你先更新 `DECISIONS.md`
2. Codex CLI 先做结构级 review
3. Copilot CLI 再按已定方案实现
4. Codex CLI 再做边界审查

#### 模式 C：Bug 修复

1. Copilot CLI 做现象收集、复现和代码路径追踪
2. Codex CLI 只挑战 root cause hypothesis 是否有证据
3. 未确认根因前，任何 CLI 都不实施修复
4. 确认后由一个工具实施最小修复，并回到回归验证

#### 模式 D：发布前复核

1. Copilot CLI 汇总本轮改动与验证结果
2. Codex CLI 审查是否越界、是否有回归风险
3. 你决定是否进入下一轮或归档

---

### 7.4 两个 CLI 的推荐提示模板

#### 给实现者（通常是 Copilot CLI）

```md
请先读取：
- CLAUDE.md
- CONTRACTS.md
- STATUS.md
- DECISIONS.md
- CURRENT_TASK.md
- LESSONS.md

现在只执行 CURRENT_TASK.md 中的当前步骤。

要求：
- 只修改允许范围内的文件
- 不要顺手重构
- 不要覆盖已确认决策
- 如果要触碰 🔒 契约，先停下来
- 完成后列出修改文件和改动点
```

#### 给审查者（通常是 Codex CLI）

```md
请不要修改代码，只审查当前 diff。

重点检查：
1. 是否超出 CURRENT_TASK.md 的修改范围
2. 是否破坏 CONTRACTS.md 的接口契约
3. 是否破坏 CONTRACTS.md 的架构契约
4. 是否覆盖 DECISIONS.md 中已确认的决策
5. 是否有明显回归风险

只输出有问题的点；如果没有问题，就直接说 clean。
```

---

### 7.5 单次任务的完整操作流程

前面的章节讲的是原则、文件和阶段，这一节给你的是**日常真正可执行的操作手册**。

建议默认角色固定为：

- **Copilot CLI**：实现者
- **Codex CLI**：审查者
- **你**：边界、口味和架构决策的最终裁判

并且至少准备以下最小治理骨架：

- `CONTRACTS.md`
- `STATUS.md`
- `CURRENT_TASK.md`

项目变复杂后，再补上：

- `DECISIONS.md`
- `LESSONS.md`
- `TASKS/`

你可以把它们理解成：

- `CONTRACTS.md`：哪些东西不能乱动
- `STATUS.md`：项目当前稳定到哪里
- `CURRENT_TASK.md`：这一轮到底只做什么
- `DECISIONS.md`：哪些方案已经拍板
- `LESSONS.md`：哪些坑以后别再踩
- `TASKS/`：历史任务归档

#### 步骤 1：先写任务包，再让 AI 动手

不要直接把一句需求丢给 AI。先在 `CURRENT_TASK.md` 里写清楚：

- 任务目标
- 验收标准
- 允许修改范围
- 禁止修改范围
- 受影响契约
- 回归检查项
- 回滚点
- 决策分类
- 执行记录

如果这些没写清楚，就不要进入实现阶段。

#### 步骤 2：先做决策分级，防止 AI 偷偷解释需求

每轮任务开始前，先把决策分成三类：

- `Mechanical`：机械性小决定，可自动处理
- `Taste`：风格与体验类决定，可做但要汇报
- `User challenge`：会改变你原始方向的，不能静默决定

这样可以防止“代码还没坏，需求解释权先被 AI 偷走”。

#### 步骤 3：让 Copilot CLI 只实现当前步骤

实现者的任务不是“把整个相关模块顺手做好”，而是：

- 先读取治理文件
- 只执行 `CURRENT_TASK.md` 当前步骤
- 只改允许范围内的文件
- 做最小必要验证
- 输出修改文件列表与验证结果
- 回写 `CURRENT_TASK.md` 执行记录

推荐提示结构如下：

```md
请先读取：
- CONTRACTS.md
- STATUS.md
- DECISIONS.md
- CURRENT_TASK.md
- LESSONS.md

本次任务定义全部以 CURRENT_TASK.md 为准。

要求：
- 只执行当前步骤
- 只修改允许范围内的文件
- 不要顺手重构
- 不要覆盖已确认决策
- 如果要触碰 🔒 契约，先停下来
- 完成后列出修改文件、验证方式、未解决风险
- 完成后更新 CURRENT_TASK.md 的执行记录
```

#### 步骤 4：先做最小验证，不要直接相信“已完成”

实现完成后，至少做三类核对：

1. **范围核对**：改动文件是否都在允许范围内
2. **契约核对**：是否破坏接口、状态流、目录职责、DTO 语义
3. **回归核对**：本轮影响到的旧功能有没有坏

如果项目已有测试，就跑已有测试；如果没有，也至少做最小人工验证，比如：

- 关键页面能否正常打开
- 主流程能否走通
- 原有按钮、表单、接口是否正常
- 错误状态有没有明显损坏

#### 步骤 5：让 Codex CLI 做只读审查，不参与写代码

这一轮里，`Codex CLI` 的职责不是优化实现，而是做第二道边界审查。

推荐提示结构如下：

```md
请只做审查，不要修改代码。

请基于以下文件审查本轮 diff：
- CURRENT_TASK.md
- CONTRACTS.md
- DECISIONS.md
- STATUS.md

只回答下面问题：
1. 是否超出 CURRENT_TASK.md 的允许修改范围
2. 是否破坏 CONTRACTS.md 的接口契约
3. 是否破坏 CONTRACTS.md 的架构契约
4. 是否覆盖 DECISIONS.md 中已确认的决策
5. 是否存在明显回归风险
6. 是否有应该补充验证但尚未验证的点

如果没有问题，就明确说“本轮改动边界安全”。
```

这里最重要的原则是：**审查者只看 diff 和边界，不接管实现。**

#### 步骤 6：审查不过时，不要继续叠加修改

如果审查发现问题，就回到实现者修正；但当出现以下情况时，要立即停下来，先恢复治理，再继续开发：

- 同一问题连续 2 到 3 次还没收敛
- AI 开始猜需求
- 改动扩散到未授权区域
- 你自己已经说不清项目当前状态

这时不要继续靠聊天硬推进，而是先更新：

- `CURRENT_TASK.md`
- `DECISIONS.md`
- `CONTRACTS.md`

必要时把任务重新拆小，再进入下一轮。

#### 步骤 7：完成后同步 5 类状态

一轮任务结束，不能只停在“代码已经改完”。还要把项目状态写回工件：

1. 更新 `CURRENT_TASK.md`：记录执行结果、验证结果、剩余问题
2. 更新 `STATUS.md`：把功能从“开发中”移动到“稳定”或“待继续”
3. 更新 `CONTRACTS.md`：如果形成了新接口或新边界，就补进去
4. 更新 `DECISIONS.md`：如果这轮确认了方案，就记录为正式决策
5. 更新 `LESSONS.md`：如果踩到了坑，就沉淀为后续经验

如果这轮任务已经结束，再把 `CURRENT_TASK.md` 归档到 `TASKS/`，然后为下一轮创建新的任务包。

#### 步骤 8：按任务大小切换流程深度

不是每个任务都要走满配流程。

- **小任务**：至少用 `CURRENT_TASK.md`，必要时配合 `STATUS.md`
- **中任务**：加上 `CONTRACTS.md` 与 `DECISIONS.md`
- **大任务**：使用完整六件套，并保留 `TASKS/` 归档

核心原则不是“每次都最重”，而是**随着风险升高，逐步增加治理强度**。

---

### 7.6 最容易失控的五个点

在日常使用里，真正常见的失控点不是 AI 不会写代码，而是下面五类：

1. AI 偷偷扩大修改范围
2. AI 覆盖已经确认的决策
3. AI 改了接口或架构边界，但没有同步契约
4. 功能做完了，但没有真正做回归验证
5. 当前任务结束后，项目状态没有写回文档

所以你每轮至少要问自己五个问题：

1. 改动范围有没有越界
2. 契约有没有被破坏
3. 已确认决策有没有被偷偷改写
4. 旧功能有没有回归风险
5. 项目记忆有没有同步更新

一句话口诀：

> 先写任务包，再让 AI 动手；先锁定范围，再修改代码；先做审查验证，再算任务完成；每轮结束后，把状态写回文件。

---

## 八、可直接复用的使用提示

以下提示仅是对话启动示例，不定义 skill、文档、审查报告或输出 schema；如与 `WORKFLOW_PROTOCOL.md`、`FILE_SCHEMAS.md`、`templates/**` 或生成器实现冲突，以规范源和生成器为准。

本节只提供对话提示写法，不提供治理文档模板。`CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md` 等文档的章节、字段、必填项和校验规则，以 `FILE_SCHEMAS.md` 及 `templates/docs/**` 为准。

---

### 8.1 通用任务提示

```md
这是一次大型项目中的局部开发任务。

请先读取：
- CLAUDE.md
- CONTRACTS.md
- STATUS.md
- DECISIONS.md
- LESSONS.md
- CURRENT_TASK.md

本次任务定义全部以 CURRENT_TASK.md 为准。

规则：
1. 如果要修改范围外文件，先停下来说明原因
2. 如果要改 CONTRACTS.md 中的 🔒 内容（接口或架构），先停下来
3. 如果要改 DECISIONS.md 中已确认的决策，先停下来
4. 只完成 CURRENT_TASK.md 中当前步骤，不要顺手重构
5. 完成后列出修改文件，并对比 CURRENT_TASK.md 的允许范围
6. 完成后执行范围复核（接口契约 + 架构契约 + 决策一致性）
7. 如果连续 3 次修复失败，停止并汇报
8. 完成后更新 CURRENT_TASK.md 的执行记录
```

---

### 8.2 Bug 调查提示

```md
请进入 Bug 调查闭环，不要先修代码。

先输出：
1. 已确认现象
2. 最小复现路径
3. 相关代码路径 / 数据流
4. Root cause hypothesis
5. 准备用什么证据验证该假设

只有当根因被验证后，才允许提出最小修复。
如果 3 个假设都失败，停止并汇报，不要继续猜。
```

---

### 8.3 `CLAUDE.md` 的最小规则提示

```md
开始任何代码修改前，先读取：
- CONTRACTS.md
- STATUS.md
- DECISIONS.md
- CURRENT_TASK.md
- LESSONS.md

规则：
1. 不要修改 CURRENT_TASK.md 范围外的文件
2. 不要修改 CONTRACTS.md 中的 🔒 内容
3. 不要覆盖 DECISIONS.md 中已确认的决策
4. 只完成当前步骤，不要顺手重构
5. 完成后执行范围复核和回归验证
6. 连续 3 次修复失败后停止继续猜测
```

---

### 8.4 审查阶段提示

```md
请不要修改代码，只审查当前改动。

重点检查：
1. 是否超出 CURRENT_TASK.md 的允许修改范围
2. 是否修改了禁止修改的内容
3. 是否破坏 CONTRACTS.md 中的接口或架构契约
4. 是否覆盖 DECISIONS.md 中已确认的决策
5. 是否引入未说明的额外行为或隐性变更

输出：
- 列出所有改动文件
- 指出潜在问题（如果有）
- 如果没有问题，直接说明“本轮改动边界安全”
```

---

### 8.5 QA 模式分流提示

```md
请先做 QA 模式分流，不要默认全量测试，也不要默认通过。

先输出：
1. QA mode：diff-aware / quick-smoke / full-qa / report-only / authenticated-browser / regression-baseline
2. Target surface：本轮 diff 影响到哪些页面、接口、流程或状态
3. Browser/session requirement：是否需要真实浏览器、登录态、cookie/session
4. Checks run：准备跑哪些测试、smoke check 或人工验证项
5. 如果是 report-only，只报告问题和证据，不修复

需要登录但 session/cookie 不可用时，标记 blocked，不要把未验证页面记为通过。
```

---

### 8.6 回归验证提示

```md
请执行回归验证。

要求：
- 对照 CURRENT_TASK.md 的验收标准逐条核对
- 检查本次改动是否影响已有功能
- 检查关键流程是否仍然可用
- 检查是否引入异常路径或错误状态
- UI / 登录 / 表单 / 路由 / 状态流任务必须说明是否做过 browser-backed smoke

输出：
- 已验证的关键点
- 每一项结论（通过 / 风险 / blocked / 未覆盖）
- 如存在问题，说明影响范围
- 给出是否可以继续推进的结论
```

---

### 8.7 状态同步提示

```md
请同步当前任务状态。

要求：
- 更新 CURRENT_TASK.md 执行记录
- 标记已完成步骤
- 补充本轮实际发生的关键变化
- 标记是否存在未解决问题或风险

输出：
- 当前任务状态（进行中 / 已完成 / 需修正）
- 已完成内容总结
- 当前风险或问题（如有）
- 是否可以进入下一阶段
```

---

## 九、落地路径

不要一开始就追求“全套上齐”。

更可行的是分阶段升级。

---

### 9.1 最小集合

```text
CLAUDE.md + CONTRACTS.md（接口层） + STATUS.md
```

适用：

- 新项目刚起步
- 你先想解决“误改稳定接口”和“项目状态混乱”

这时先不要追求完整治理，只先把：

- 哪些不能改
- 哪些已经稳定

明确出来。

---

### 9.2 中级集合

```text
最小集合 + CONTRACTS.md（架构层） + DECISIONS.md + LESSONS.md
```

适用：

- 项目出现明显分层
- AI 开始偷偷改变结构或口味决策
- 同类问题开始重复出现

这时说明你需要的不只是边界，还需要：

- 决策系统
- 长期经验系统

---

### 9.3 完整集合

```text
中级集合 + CURRENT_TASK.md + TASKS/ 归档
```

适用：

- 多轮复杂任务
- 多文件修改
- 核心流程迭代
- 长周期项目维护

这时的核心不是再加更多约束，而是：

> 让每次变更都变成标准工单。

---

### 9.4 什么情况下应该升级

#### 当出现下面情况时，补 `DECISIONS.md`

- AI 替你换了 UI 风格
- AI 替你换了技术路线
- 已经说过“不做”的东西又被重新引入

#### 当出现下面情况时，补 `CURRENT_TASK.md`

- 任务边界总散落在对话里
- 一轮开发过后忘了本轮到底要完成什么
- diff 经常超范围

#### 当出现下面情况时，补 `CONTRACTS.md` 架构契约层

- 项目开始分层
- AI 开始跨层调用
- 依赖方向开始变脏

#### 当出现下面情况时，补 `LESSONS.md`

- 同一个坑反复踩
- 每次跨会话都重新解释同样的边界

---

## 十、与 `gstack` 原始机制的对应关系

这套体系不是照搬 `gstack`，而是把它最值得迁移的机制翻译成更适合个人项目的形式：

下表只是概念映射，不是 workflow-system 的实现映射、skill 清单、文档字段或生成规则来源；正式实现关系以 `WORKFLOW_PROTOCOL.md`、`FILE_SCHEMAS.md`、`templates/**` 和脚本实现为准。

| `gstack` 机制 | 对应简化实现 |
| --- | --- |
| `freeze` | `CURRENT_TASK.md` 的任务级允许修改范围 |
| `careful` | 危险操作需确认 |
| `review scope drift` | `git diff --stat` + 范围复核 |
| `plan completion audit` | `STATUS.md` 追踪完成与变更 |
| `autoplan decision types` | `DECISIONS.md` 区分架构 / 口味 / 暂缓 / 否决 |
| `SPEC_LOCKED / plan items` | `CURRENT_TASK.md` 的验收标准与执行记录 |
| `learnings` | `LESSONS.md` 记录项目经验 |
| `investigate` | 连续 3 次失败自动停机 |
| `qa regression thinking` | 每次完成后做最小回归检查 |
| `review-army / adversarial` | 用第二个 CLI 做只读审查 |
| `architecture diagrams` | `CONTRACTS.md` 的架构契约层 |
| `document-release` | 每轮结束同步 STATUS / CONTRACTS / DECISIONS |
| `retro / learn` | `LESSONS.md` + `TASKS/` 归档复盘 |

---

## 十〇、生成管线与自动化工具

本节不定义当前仓库的 workflow-system 生成链。实际 `dist/workflow-system/**` 来源链以 `WORKFLOW_PROTOCOL.md §1.2` 和 runtime manifest 为准；本文只说明治理体系可以被自动化这一方法论观点。

方法论层面只保留一个判断：治理规则如果长期靠人工复制，就会漂移；更稳的做法是让规范源、模板、生成器、校验器和运行时打包流程形成可复查链路。

因此，本节不维护模板数量、生成命令、测试命令、配置字段或输入优先级。涉及模板集合、占位符、生成器输入、校验规则、manifest、`dist/workflow-system/**` 打包范围时，必须回到 `WORKFLOW_PROTOCOL.md`、`FILE_SCHEMAS.md` 和对应脚本实现。

---

## 十一、附录：`gstack` 技术架构速览

这一部分不是为了教你实现 `gstack`，而是帮助你理解这套方法论背后的结构来源：它为什么能把 AI 开发流程做成一套持续运转的工程系统，而不只是一些提示词。

---

### 11.1 Skill 模板系统

本节描述 native gstack skill-doc 生成机制，不描述 workflow-system 的 `dist/workflow-system/**` 规范链；后者以 `WORKFLOW_PROTOCOL.md §1.2` 和 runtime manifest 为准。

`gstack` 的核心不是零散的 `SKILL.md` 文件，而是一套模板生成系统。仓库中真正维护的是 `SKILL.md.tmpl`，然后通过统一的生成脚本产出不同 host 可消费的最终文档。

```text
SKILL.md.tmpl -> scripts/gen-skill-docs.ts -> host-specific SKILL.md
```

它的大致生成链路有 5 步：

1. 在仓库根目录及其下一层目录发现 `SKILL.md.tmpl`
2. 读取模板 frontmatter 与正文
3. 扫描 `{{PREAMBLE}}`、`{{INVOKE_SKILL:plan-ceo-review}}` 之类占位符
4. 交给 `scripts/resolvers/index.ts` 分发到对应 resolver 解析
5. 生成面向不同 host 的 `SKILL.md`

常见 frontmatter 字段大致如下：

```yaml
---
name: qa
preamble-tier: 4
version: 2.0.0
description: |
  Systematically QA test a web application and fix bugs found.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
benefits-from:
  - /plan-ceo-review
---
```

以下仅是 native gstack skill-doc 的历史示例项说明，不可迁移为 workflow-system metadata schema；workflow-system skill 字段只以 `WORKFLOW_PROTOCOL.md` 为准。

- `name`：skill 身份标识
- `preamble-tier`：注入多少层共享上下文与政策约束
- `version`：模板版本
- `description`：路由提示与 host 侧简介
- `allowed-tools`：允许使用的工具边界
- `benefits-from`：上游技能依赖关系

这套设计的意义在于：项目规范不是靠人复制粘贴到每个 skill，而是通过模板和 resolver 统一注入。对我们迁移方法论时最重要的启发是：**规则应当可复用、可生成、可升级，而不是散落在每个对话里临时重写。**

---

### 11.2 Resolver 架构

`scripts/resolvers/` 是 `gstack` 的真正中枢。模板中的占位符最终都通过 resolver 展开，因此公共能力、流程约束、质量规则、浏览器说明、文档治理要求，实际上都是“系统性注入”的。

主要 resolver 家族包括：

- `preamble.ts`：注入会话上下文、协作规则、行为边界、基础遥测/约束
- `review.ts`：审查仪表板、完成度检查、scope drift、spec review 逻辑
- `review-army.ts`：并行 specialist 审查编排与聚合
- `design.ts`：设计方法、anti-slop 规则、设计打分流程
- `browse.ts`：浏览器启动说明、命令参考、快照机制文档
- `testing.ts`：测试启动、覆盖率要求、验证规范
- `utility.ts`：基础工具逻辑，如 base branch 检测、QA 工作流、deploy/bootstrap、changelog 支持
- `learnings.ts`：长期经验的读取、筛选、写入
- `confidence.ts`：审查发现的置信度规则
- `composition.ts`：通过 `{{INVOKE_SKILL:...}}` 进行 skill 组合

这里最值得学习的不是某个 resolver 细节，而是它背后的工程思路：

1. 把“跨技能共享规则”收敛到统一层
2. 把“技能之间的衔接关系”显式化
3. 把“审查、测试、文档、经验沉淀”都做成基础设施，而不是额外提醒

对我们自己的方法论来说，这正对应了 `CURRENT_TASK.md`、`CONTRACTS.md`、`DECISIONS.md`、`STATUS.md` 这些工件为什么要持续读取：因为**项目约束必须由系统提供，不应依赖模型临时记忆。**

---

### 11.3 文档生成生命周期

`gstack` 最强的思想之一，是把文档视为生命周期中的连续产物，而不是开发完成后的整理工作。

```text
IDEA -> DESIGN -> REVIEW -> CODE -> SHIP -> DOCUMENT -> RETRO -> LEARN
```

下面是仓库里最关键的 10 个文档/流程技能，以及它们各自产出的工件、核心规则、生命周期位置。

#### 1. `/office-hours`：需求澄清与问题重构

**主要产出物**：

- `~/.gstack/projects/$SLUG/*-design-*.md` 下的问题/设计文档

**核心规则**：

- 有 `startup mode` 与 `builder mode` 两种运行方式
- 只产出问题与设计文档，不直接进入实现
- 通过强制提问挑战问题是否真实存在、是否足够具体
- 鼓励证据与不舒服的澄清，而不是圆滑泛化
- 若要做 web 研究，要先征得用户许可

**生命周期角色**：

它是原始想法进入工程化流程的前门，把模糊意图变成后续计划评审可以消费的材料。

#### 2. `/plan-ceo-review`：战略级规划文档

**主要产出物**：

- `~/.gstack/projects/$SLUG/ceo-plans/...` 下的 CEO 级计划文档

**核心规则**：

- 必须先 challenge scope，再进入详细规划
- 不允许 silent failure
- 每个错误都要命名，不能只写“处理错误”
- 关键流程必须考虑四种 shadow path：`nil`、`empty`、`error`、`success`
- 非平凡系统必须画 ASCII 图
- 必须有 `NOT in scope` 区域
- 偏向完整性，而不是为了快而删减关键约束

**典型内容**：

- premise challenge
- existing-code leverage map
- dream-state comparison
- implementation alternatives
- scope decisions
- error and rescue registry
- failure modes registry
- system architecture diagrams
- data-flow / observability expectations

**生命周期角色**：

把产品意图转化成高强度战略计划，并把结果继续交给设计与工程评审阶段。

#### 3. `/plan-eng-review`：工程架构评审

**主要产出物**：

- 结构化 engineering review
- 持久化的 review 元数据
- 内联 ASCII 图、测试映射、failure-mode registry

**核心规则**：

- 在新增抽象前，先检查是否能复用现有代码
- 大型或复杂计划必须被 challenge
- 架构、代码质量、测试、性能都是强制章节
- 关键流程必须配图
- 测试覆盖必须映射到代码路径
- 失败场景必须显式写出
- 每完成一个大 review section 都应该停下来让用户反馈

**生命周期角色**：

这是进入实现之前最主要的技术严谨性关卡。

#### 4. `/plan-design-review`：设计规划评审

**主要产出物**：

- 视觉 mockup
- 回写到计划文档里的设计注释
- design 目录下的比较稿与评审工件

**核心规则**：

- 每个设计维度按 0-10 打分
- 先描述“10 分长什么样”，再修计划，再复评分
- 强调 `specificity over vibes`
- 空状态属于功能本身，不是边角料
- 响应式不等于简单堆叠布局
- 可访问性是强制项
- 通用 AI 味的界面模式被视为失败模式

**主要维度**：

- information architecture
- interaction state coverage
- user journey / emotional arc
- AI slop risk
- design system alignment
- responsive behavior
- accessibility deep dive

**生命周期角色**：

在写代码之前，把体验、交互和视觉决策提前做实，减少“写完再补设计”的返工。

#### 5. `/autoplan`：规划阶段总编排

**主要产出物**：

- 顺序更新的 plan file
- restore point snapshots
- phase summaries
- 最终 approval gate

**核心规则**：

它按顺序编排：

1. CEO review
2. 如果存在 UI 范围，则进入 design review
3. 最后进入 engineering review

它还内置一个很重要的决策模型：

- `Mechanical`：可自动决定，不必打扰用户
- `Taste`：可以自动决定，但需要在最终 gate 向用户显式汇报
- `User challenge`：如果模型想改变用户原始方向，绝不能静默决定

**生命周期角色**：

它是计划流水线的总协调器，把想法、设计、工程评审接成一条连续链路。

#### 6. `/review`：合并前审查报告

**主要产出物**：

- review log 中持久化的审查报告
- 分成 `CRITICAL` 与 `INFORMATIONAL` 的结构化发现
- `Auto-fix` 与 `Ask` 分类结果
- learning capture

**核心规则**：

- fix-first：先找问题，再自动修安全问题，再把高风险问题交给用户判断
- 会交叉检查 `TODOS.md`
- 会检测文档是否陈旧
- 会把审查结果持久化，给 `/ship` 与仪表板复用

**生命周期角色**：

这是代码合并前的直接质量门禁。

#### 7. `/ship`：交付与发布文档

**主要产出物**：

- `VERSION`
- `CHANGELOG.md`
- `TODOS.md`
- PR / MR body
- logical, bisectable commits
- shipping metrics

**核心规则**：

- 属于当前分支的测试失败会阻塞继续推进
- coverage gate 可以阻塞，或要求显式 override
- 计划完成度与验证结果都可能阻塞 shipping
- 测试后如果又改代码，必须重新验证
- commit 必须逻辑清晰、可 bisect

**PR / MR body 通常包含**：

- summary
- test coverage
- pre-landing review
- design review
- eval results
- scope drift
- plan completion
- verification results
- TODO completion

**生命周期角色**：

它把代码、过程证据、发布说明、变更范围压缩成一次可交付的正式输出。

#### 8. `/document-release`：发布后的文档同步

**主要产出物**：

- `README.md` 更新
- `ARCHITECTURE.md` 更新
- `CONTRIBUTING.md` 更新
- `CLAUDE.md` 更新
- `CHANGELOG.md` 语气打磨
- `TODOS.md` 清理
- 文档健康度总结

**核心规则**：

- 编辑前必须完整阅读相关文件
- 事实性更新可自动完成
- 叙事性或有歧义的变更必须问用户
- 不能覆盖 changelog 历史
- 不能静默 bump version
- 需要检查 discoverability：关键文档必须从关键入口文档可达

**生命周期角色**：

它负责把“已经交付的真实行为”同步回项目文档，避免文档和代码长期漂移。

#### 9. `/retro`：复盘报告

**主要产出物**：

- repo 或 team retrospective report
- metrics table
- per-author leaderboard
- time distribution / session analysis
- hotspot / churn analysis
- trend analysis

**关注内容**：

- commit history
- work sessions
- file churn
- PR size patterns
- skill usage
- backlog / TODO health
- test 与 review signals

**生命周期角色**：

它不是为当前变更服务，而是把仓库活动转化成流程层面的经验与管理洞察。

#### 10. `/learn`：经验知识沉淀

**主要产出物**：

- `learnings.jsonl`
- search / prune / export / stats / add 等操作
- 可导出为适合 `CLAUDE.md` 这类参考文档的 Markdown

**每条 learning 的字段**：

- `skill`
- `type`
- `key`
- `insight`
- `confidence`
- `source`
- `related files`
- `timestamp`

**生命周期角色**：

它把模式、坑、架构选择、偏好变成长期记忆，让系统具备复利效应。

这 10 个技能串起来看，`gstack` 真正做成的是：**每个阶段都产出下一阶段能消费的文档工件。** 这也是为什么它适合被抽象成治理系统，而不是“好用的提示词集合”。

---

### 11.4 QA 报告结构

以下仅描述 native gstack 既有机制，不属于 workflow-system 文档、报告或 TODO schema；如需纳入 workflow-system，必须先登记到 `WORKFLOW_PROTOCOL.md` / `FILE_SCHEMAS.md` 并由 `templates/**` 承载。

仓库里不仅定义了 QA 行为，还提供了标准 QA 报告模板：`qa/templates/qa-report-template.md`。

这个 native 模板通常覆盖以下信息维度，作为设计参考而非 workflow-system 报告 schema：

- metadata table
- 按类别拆分的 health score
- top 3 issues
- console health summary
- severity breakdown
- 带 repro steps 与 screenshots 的详细问题条目
- fixes applied
- regression section

这意味着 `gstack` 对 QA 的要求不是“跑一下看看”，而是：**验证结果也必须结构化、可复核、可回传到后续流程。**

对我们自己的方法论，这直接对应了 `CURRENT_TASK.md` 里的验收标准、回归项，以及 `STATUS.md` 中的验证状态同步。

---

### 11.5 TODO 治理格式

以下仅描述 native gstack 既有机制，不属于 workflow-system 文档、报告或 TODO schema；如需纳入 workflow-system，必须先登记到 `WORKFLOW_PROTOCOL.md` / `FILE_SCHEMAS.md` 并由 `templates/**` 承载。

`gstack` 没把 TODO 当作随手便签，它有明确的 TODO 格式规范，仓库里还有单独的 `review/TODOS-format.md`。

这个 native TODO 格式通常覆盖以下信息维度，作为设计参考而非 workflow-system TODO schema：

```text
# TODOS

## <Skill or Component>
### <Title>
What
Why
Context
Effort
Priority
Depends on

## Completed
```

其中每个信息维度承担明确职责：

- `What`：到底要做什么
- `Why`：为什么值得做
- `Context`：延迟接手时也能继续推进的背景
- `Effort`：工作量判断
- `Priority`：优先级必须显式化
- `Depends on`：依赖关系必须写出来

还有几个关键治理要求：

- Context 必须足够完整，保证任务搁置后也能重新接续
- 完成项要写清版本与日期
- TODO 是正式项目记忆，不是随手草稿

这和我们建议的 `TASKS/` 或 `CURRENT_TASK.md` 是同一类思想：**任务必须被结构化表达，才能被 AI 和人稳定接力。**

---

### 11.6 状态持久化模型

`gstack` 的很多能力之所以不像一次性对话，是因为它把运行状态持久化在 `~/.gstack/` 下面。典型结构包括：

```text
~/.gstack/
  freeze-dir.txt
  browse.json
  sessions/
  reviews/
  projects/$SLUG/
    ceo-plans/
    design/
    learnings.jsonl
```

这些状态分别承担不同角色：

- `freeze-dir.txt`：记录当前冻结的目录边界
- `browse.json`：浏览器会话相关状态
- `sessions/`：会话级数据
- `reviews/`：审查记录
- `projects/$SLUG/ceo-plans/`：规划文档与阶段工件
- `projects/$SLUG/design/`：设计评审与比较工件
- `projects/$SLUG/learnings.jsonl`：长期经验沉淀

它的关键思想是：

1. 会话状态不是只存在上下文窗口里
2. 项目状态与流程工件可以跨轮次复用
3. 审查、设计、计划、学习都能形成可回溯痕迹

这也是为什么我们在自己的体系里强调 `STATUS.md`、`DECISIONS.md`、`LESSONS.md`、`TASKS/`：它们本质上是在本地项目里构建一个轻量版的持久化状态层。

---

### 11.7 强制横切规则

如果你通读 `gstack`，会发现有一批规则反复出现在不同 skill 里。它们不是某个角色的偏好，而是整个系统的横切约束。

最重要的 10 条包括：

1. **Zero silent failures**：禁止无声失败
2. **Named errors**：错误必须被明确命名，不能笼统写“处理异常”
3. **Failure-mode thinking**：必须显式思考失败路径
4. **Diagrams for non-trivial flows**：复杂逻辑和流程要画图
5. **Scope challenge before implementation**：先挑战范围，再动手实现
6. **Completeness over cheap shortcuts**：优先完整性，而不是便宜捷径
7. **Search and reuse before rebuild**：先搜索与复用，再新建抽象
8. **Explicit test coverage**：测试覆盖要明确映射到路径与行为
9. **Discoverable documentation**：文档要可发现、可导航，不可只散落在深层目录
10. **User-facing release notes**：发布说明是给人看的，不是 commit message 拼接物

这 10 条规则之所以重要，是因为它们约束的不是“某一段代码怎么写”，而是**系统如何避免在规模上失控**。

我们的方法论里五层防线、本轮任务包、决策分级、文档同步，本质上都可以视为这些横切规则在单人 AI 开发场景中的落地版本。

---

### 11.8 持久化浏览器系统

`gstack` 的另一个标志性组件是 `browse`：

```text
Agent -> browse CLI -> localhost server -> Chromium via CDP
```

它的价值在于：

- 浏览器常驻，不必每次冷启动
- cookies、tabs、sessions、localStorage 持续存在
- 首次启动几秒，之后命令大约百毫秒级
- 空闲超时后自动关闭
- 更适合真实 QA 与交互式调试

这部分对你最直接的启发是：

- QA 不应该只靠“代码看起来没问题”
- 真实运行验证比静态阅读更能发现问题
- 如果你的项目依赖前端交互、登录状态、复杂流程，保留真实浏览器上下文会显著降低验证成本

它体现的不是“有个浏览器工具”这么简单，而是：**验证基础设施也应该被产品化，而不是每轮临时搭环境。**

---

### 11.9 仓库阅读路径

如果你想把 `gstack` 读透，比较好的顺序不是从每个 skill 随机点开，而是按以下路径：

1. `README.md`：先理解它的总 thesis
2. `ARCHITECTURE.md`：理解 browse daemon 与整体结构
3. `scripts/gen-skill-docs.ts` 与 `scripts/resolvers/`：理解 skill 是怎么生成和组合的
4. `office-hours/`、`plan-ceo-review/`、`plan-eng-review/`、`plan-design-review/`：看规划与评审工件如何形成链路
5. `review/`、`ship/`、`document-release/`：看交付、审查、文档治理怎么衔接
6. `qa/` 与 `browse/`：看执行与验证层如何落地

这个阅读顺序的价值在于：你看到的不是一个“技能菜单”，而是一条完整的工程流。

---

### 11.10 为什么值得研究

`gstack` 值得研究，不是因为它命令很多，而是因为它把以下事情做成了默认：

- 先规划，再实现
- 先定义 scope，再写代码
- 审查与 QA 是固定阶段，不是心血来潮
- 文档同步是流程一部分，不是收尾补丁
- 经验与复盘会沉淀成下一轮输入
- 规则通过模板、resolver、状态文件和工件链路持续生效

一句话总结：

> `gstack` 的核心价值，不是帮 AI 写代码，而是逼着 AI 在结构化关卡中交付代码，并为每一轮变更留下可复核的工件、边界和证据。

---

## 结语

对于大型 Vibe Coding 项目，最重要的不是让 AI 更聪明，而是让项目更不容易失控。

真正有效的方法不是“更复杂”，而是把这些东西固定下来：

- 哪些东西不能改
- 这次允许改哪里
- 哪些决策不能被静默改写
- 项目现在处于什么状态
- 每次改完后如何证明没有越界
- 什么时候必须停下来，不再继续猜

当这些规则是显式的、持久的、每轮都会被读取的，项目就不再只是“由聊天驱动”，而会逐渐变成一个真正可治理、可审计、可持续推进的 AI 协作工程系统。
