# vNext业务证据实施包

## 交付物

- PLAN.md：完整自包含规格、边界、验收矩阵和源码导航。
- CONTEXT.md：每个新会话最小背景与已定决策。
- HANDOFF.md：待S0填写的工作区、接口、状态和证据交接模板，不是Runtime状态。
- steps/S0-S5：六份单步实施提示词，限定读写范围、验收和停止边界。
- PROMPTS.md：可直接复制的初始化、实施、恢复和审查入口。
- REVIEW.md：独立聚焦审查说明。

## 使用方法

把整个目录放到仓库 `docs/designs/vnext-business-evidence/`，或把包作为附件提供并使用实际文件位置。不要覆盖同名现有文件；已有同类计划时先核实并复用，不制造两个权威副本。

先把PROMPTS.md中的S0块交给xhigh（用户所用模型档位）。它核实实际repo并记录具体接口，不实现代码。之后逐个复制S1-S5块给medium，一次一项；本地步骤尚有finding时先按合法修复路径收敛，不自动继续。

不要求每次都贴完整PLAN。新会话先读CONTEXT+HANDOFF+本步文件，再按符号导航取必要源码。PLAN只在S0完整读取，后续按章节读取。不要把大计划塞进AGENTS.md，也不要为此新增自动加载整包的Skill。

xhigh首次读取的价值是留下明确接口和交接，不是保证medium或新会话继承隐藏理解。缓存和会话上下文是不同问题；跨会话以文件为依据，不依赖缓存命中。

## 这份计划与旧回答的修订

仍是三条工程主线，但纠正了“只改三个开关就够”的说法：默认三mode缺少无顺序出口；多槽必须真实使用并绑定结果；减少review必须维护累计目标。此外，最小测试语义审查/结果可信度标注/失效/同计划retry不能被无限延期。

完整执行Provider、全局Test ID、test catalog、AST/全框架reporter和独立测试状态机仍不属于本期。交付保证明确为“caller-reported assurance下的业务证据治理”，不是任意环境下的执行真实性或防篡改保证。

## 审查范围

历史源码基线为 `166d2ce0f6ce76fe666b94c5181b23a252b9be1e`。ChatGPT阶段只读了该提交相关源码与用户提供进度，未修改远程仓库，未查看本地工作区，未跑项目测试。S0必须核实后续变化。

官方关于持久化执行计划与缓存的参考（非项目新依赖）：
- OpenAI Cookbook，Using PLANS.md for multi-hour problem solving：文档路径 `/cookbook/articles/codex_exec_plans`，来源 developers.openai.com。
- OpenAI API，Prompt caching：文档路径 `/api/docs/guides/prompt-caching`，来源 developers.openai.com。

本包采用自己的逐步停止与不自动提交边界，不继承参考示例中的自动继续或频繁commit行为。
