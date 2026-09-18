# D：测试选择效果回放（源码仓库运维材料）

此目录不随目标项目安装，不是 Test Registry、Runtime schema、Skill、发布 gate
或目标任务的新文档义务。正常项目只使用已有 prepare/review/execute 入口和
`CONTEXT_API.md` 的 **Failure-oriented validation selection**。

## 证据分层

| 材料 | 证明什么 | 不证明什么 |
| --- | --- | --- |
| `rollout-incident.json` | 用户提供的真实任务、执行报告与持久审查存在具体矛盾 | 原 Rust 源码在本轮被重新执行；109 项都无价值 |
| `replay-prompts.md` | 给新会话 Agent 的行为评估任务，以及缺少源码时的边界 | 模型已经自动完成这些任务 |
| `reviewer-guide.md` | 独立评估准则、可辨别业务错误的观察，以及不过度测试的对照 | 唯一正确的测试数量、唯一 selector 或新的完成门槛 |
| `implementation-evidence.md` | 本轮实际执行的有限校准与限制 | 跨模型提升率、原目标项目已修好、完整 D dogfood 已通过 |

这批材料以真实失败为中心，而不是人工填好 `selection` 再验证 Runtime
会接受它。原始私有 CURRENT_TASK、Task Basis、会话定位和产品数据不入库。
允许列表摘录保留原文件 SHA-256、字段坐标及报告/审查的不同来源。

## 后续独立回放

在不影响工作区的隔离副本中，用最终安装的 Skill 执行一次任务准备；另起
无作者上下文的会话审查同一份 draft。记录模型/宿主、workflow commit、业务
源码 commit、实际输入、读取过的源码/fixture、原始输出和实际选择的 invocation。
不要把 reviewer-guide、参考答案或本轮结论预先放进 prepare 会话。
已有历史结论暴露给 Agent 的运行只能标为 informed replay，不能称 blind eval。
缺少业务源码时明确标为 planning-only / source-unavailable，不虚构 selector、
PASS 或正式可执行 draft。

评估者按 reviewer-guide 检查观察是否检出相关缺陷、是否减少无必要执行、是否
保留到期的真实 flow 义务。允许等价最小方案和合格非测试证据，不做关键词打分。
准备/草稿审查阶段不执行测试；有足够理由时，之后在另行获准的隔离验证中
对旧缺陷版本和修复版本运行所选检查，分别保留真实结果与失败原因。
环境/导入/构建失败不是缺陷检出。无需为每个任务做 pre-fix/突变运行。

一个模型的一次成功选择不证明稳定效果。收集少量代表性真实任务再判断是否
达到设计目标；不要求用户现在更新目标项目，仍按 A/B/C/D 后统一安装的计划。
不把此评估变成每次正常 prepare/execute 的强制仪式。

## 当前停止线

D 修改的是现有 Skill 的选择/评审行为和可复用案例。Runtime 的 claim →
observation → boundary → granularity → invocation → result 结构不再扩张。
不增加字段、blocker、测试数上限、全量回归、自动 E2E 或独立测试平台。
