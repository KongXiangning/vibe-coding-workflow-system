# 行为回放输入

由评估者提供匹配源码/fixture，或明确说明不可用。仅摘录真实任务和旧报告
不会变出可执行项目。以下 prompt 是评估材料，不是新的工作流入口。

## 准备：缺失历史补齐

> 使用当前安装的 prepare-task。需求：plain JSONL 超过单窗口但在请求预算内时，
> 从合法 intent、continuation 或 known_complete_range 补读缺失历史，推进到完整
> snapshot；正序归约且 tool 归属/key 稳定；raw records 不整份常驻；规划及边界
> I/O 中响应取消/deadline；仅在完整安全覆盖时 promotion，公共 cursor/checkpoint
> 原样被 append 消费。另有后续步骤的 Node → stdio → Rust → 文件 store 义务。
> 当前任务的 rule/flow 义务到期步骤依原计划，不提前假称完成。
>
> 候选包括 backfill 集成测试、protocol/conformance target 和业务 collector 测试。
> 从需求识别错误的可观察结果，再读取候选的实际断言/fixture 和生产路径，选择
> 最少必要证据。不执行命令，不默认跑整个 target 或 E2E；输出正常 draft。
> 复用/修改/新增测试分开判断，使用现有字段，不增加额外测试账本。
> 若提供的只是报告摘要而没有源码，明确缺什么以及为何不能据此确认 selector，
> 不把候选名称、旧 PASS 总数或自身推断当成检出力证明。

评估者只提供 `rollout-incident.json` 中 claim 和相关候选材料，不提供
persisted_review 或 reviewer-guide。正式评估须有匹配源码；目前保存的原
准备 commit 未能从已连接目标仓库解析，不把其他分支当原始故障版本。

## 草稿审查：宽命令是否足以证明 claim

> 使用 review-draft，对上述真实任务准备的 draft 做一次只读审查。独立读取
> 原要求、候选测试/fixture 与运行配置。判断这些检查实际能发现什么业务错误，
> 是否有同等有效但更小的检查、是否遗漏必要 flow，oracle 是否跟着错误实现变。
> 不执行测试，不因 draft 尚无报告而报错；不新增字段或要求更多测试来凑覆盖。
> 将有材料支持的缺口一次汇总，区分需求决定与实现者可直接修正的问题。

另一个负向输入：旧报告声称 109 PASS、C1 satisfied，但这里只是执行者报告。
将它交给 review-change 时必须附真实实施目标/审查上下文；未提供这些上下文
时只能做证据材料分析，不能编造正式 Runtime review verdict。

## 防止过度测试的对照

以下是明确标注的设计对照，不冒充额外真实 incident：

> 只修改一个已有关键金额规则函数；已有 focused test 精确检查所改规则，
> fixture/expectation 独立，业务流程边界没有改变。选择所需验证，不默认新增
> integration、浏览器 E2E、第二个同义测试或整套支付 suite。

> 只修改文档说明，不改可执行行为。使用足够的静态检查；不要求新 unit、flow、E2E。

> 用户/发布策略明确要求相关宽回归。保留真实来源并选择必要范围；不能为了
> “少测”删除 policy 义务，也不能把无关 PASS 自动归因给所有 claim。
