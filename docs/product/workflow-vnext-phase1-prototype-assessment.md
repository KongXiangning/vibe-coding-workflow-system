# Workflow vNext Phase 1 原型盘点与后续处理结论

- 状态：记录性决策；原型保留但暂停扩展，未推广、未接管现有 workflow
- 日期：2026-08-31
- 适用范围：本轮新增的 Phase 1 shadow、context、validation、sample 和测试文件
- 关联计划：[workflow-vnext-migration-plan.md](workflow-vnext-migration-plan.md)

## 1. 结论先行

本轮新增内容不应被理解为“已经决定要实现一套新的验证服务”。它们主要是一次过度展开的 Phase 1 探索，帮助把 vNext 的目标语义具体化。

当前处理原则如下：

1. 不删除这些文件，保留为未提交的探索材料和设计证据。
2. 不继续扩展 `validate-change` 沙盒、legacy/shadow 执行器或大规模样本回归体系。
3. 不把这些代码接入默认入口、Runtime、registry、host sync、install 或现有 37 个 Skill。
4. 不把本轮测试结果当成现有 Skill 的质量证明，也不把它们当成 vNext 推广前置门槛。
5. 后续先完成“精简目标蓝图”，再决定哪些语义抽取为轻量实现，哪些原型归档或删除。

## 2. 本轮新增内容及价值

| 内容 | 规模 | 有价值的部分 | 当前处理 |
|---|---:|---|---|
| `docs/designs/workflow-vnext-target-architecture.md` | 约 896 行 | 意图入口、曝光层级、兼容旧 Skill、上下文/知识、原地迁移等目标决策 | 保留为架构记录；Phase 1 原型段落以后需按本文件降级描述 |
| `docs/product/workflow-vnext-migration-plan.md` | 已更新 | 阶段边界、迁移顺序和“不先删 37 Skill”的原则 | 保留；本文件是其 Phase 1 状态补充 |
| `scripts/project-context-resolver.ts` | 约 1,063 行 | “按相关性读取 CONTRACTS / DECISIONS / LESSONS”、权威优先级、冲突显式化、知识准入的概念 | 只保留语义和字段方向；暂不把整套实现视为必需 Runtime |
| `scripts/workflow-review-shadow.ts` | 约 1,717 行 | 将多个 review Skill 归纳为一次统一审查输入/输出的思路 | 作为语义映射材料；暂停作为执行器继续发展 |
| `scripts/workflow-validate-shadow.ts` | 约 873 行 | 说明 `validate-change` 可以是专家/CI 可调用的可选证据入口 | 当前实现过重，暂存参考，不作为当前项目建设目标 |
| `scripts/workflow-shadow-samples.ts` | 约 1,366 行 | 把不可丢的行为情境显式列出来 | 提取场景清单；不继续维护运行器 |
| `test/fixtures/workflow-vnext-shadow-sample-matrix.yaml` | 约 554 行 | 12 类代表性情境的语义检查点 | 作为设计检查表，不作为真实跨模型回归证据 |
| 四组新增测试 | 约 1,537 行 | 给上下文选择、统一审查、收敛和报告终止语义提供示例 | 保留作参考；不应成为正式服务式测试体系 |
| `package.json` 的 shadow 测试入口 | 少量 | 记录了这些原型曾被集中运行 | 暂不视为正式质量门禁，后续精简时再决定是否移出 |

## 3. 真正需要带入精简方案的语义

以下内容与“减少 Skill 编排、把通用推理还给模型/harness”直接相关，应进入后续目标蓝图：

- 用户入口表达意图，不表达历史阶段；普通阅读、规划、测试选择和一般审查不再各自成为大型 Skill。
- 37 个旧 Skill 先保持兼容；合并入口不能丢旧入口的授权边界、停止条件、责任归属和项目事实。
- 日常入口、管理入口、专家/自动化入口、内部能力和兼容别名分层，不把内部能力暴露成用户清单。
- `CONTRACTS.md`、`DECISIONS.md`、`LESSONS.md` 按任务相关性读取；权威冲突要显式报告，Lesson 不能越权，重复知识要合并而不是持续膨胀。
- 审查可以统一输出，但“发现问题”与“进入修复/调试队列”仍是不同语义；产品判断、架构判断和用户授权不能由模型观察自动取得。
- 已安装项目的 active、finding、paused、interrupted 状态需要原地迁移，不要求重新 bootstrap/adopt；这是迁移契约，不等于现在就实现迁移 Runtime。
- 构建、部署、ADB、发布、删除、数据库迁移等项目/环境特有知识继续由专项 Skill 或明确门禁承载。

这些是“不可在精简时无意丢失的语义”，不是要求把每条语义都实现成独立 Skill、测试文件或状态机。

## 4. 本轮内容中暂不纳入当前目标的部分

下列内容是本轮误加的工程化验证支架，当前项目不是服务型验证平台，不需要继续建设：

- clean-copy、shell 约束、临时目录清理、工作区快照和逃逸检测；
- legacy 与 shadow 的可执行双跑器、跨模型/跨 harness 轴覆盖和 promotion eligibility；
- 12 个虚构样本的完整 fixture 运行框架；
- 将所有 hard/soft 指标、mutation count、source revision 绑定做成新的运行时协议；
- 将这些测试加入正式全量质量门禁。

它们最多说明“如果将来需要证明行为等价，可以从哪些维度观察”，不能反向决定 workflow-system 必须采用这套复杂架构。

## 5. 后续执行时的读取规则

后续任何继续实现 vNext 的任务，都应先读取本文件，并遵守以下顺序：

1. 先从 37 Skill 审计中确定要合并的真实入口和治理语义。
2. 再形成 6–10 个左右的目标入口草案，逐项标明 Keep、Merge、Runtime、Delete，以及不可丢失的语义。
3. 为每个目标入口确定模型负责的通用推理、harness 负责的编排，以及项目资料/专项 Skill 负责的事实和操作。
4. 只为确实需要确定性、项目特有知识或高风险门禁的部分设计轻量实现。
5. 在目标蓝图明确并确认前，不继续扩展本轮 Phase 1 原型，也不改变默认入口、生成器、registry、host、install 或 37 个 Skill。

## 6. 当前文件处置

本轮文件全部暂时保留，不做清除；它们的地位是：

- 未提交的探索草稿；
- 不属于现有 workflow 的默认路径；
- 不构成 Phase 1 完成或 vNext 推广证据；
- 后续精简设计完成后，再按“抽取语义、归档参考、删除冗余”的结果处理。

因此，当前不需要为了纠正方向而立即删除文件。需要避免的是继续围绕这些原型投入实现工作，或让后续执行者误以为它们已经是正式目标。
