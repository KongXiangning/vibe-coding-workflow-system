# vNext 授权意图改造：agent 验证交接

## 当前交付状态

基线 `c1caf591`，分支 `codex/evidence-plan-amendment-vnext`。
本次交付为 Runtime/Skill/契约/设计源码修改，**未运行项目测试、完整类型检查、
构建、分发生成、安装验证或目标项目升级**。没有新增测试文件，没有改业务项目，
没有发布新版本。`0.21.17` 的已提交旧 dist 不能证明新源码行为。

编辑端仅检查变更格式、TypeScript 语法及缺依赖环境下的增量诊断；这不等于
仓库编译或任何行为测试通过。远端一次性工作流仅应用源码 patch 并删除自身，
其 success 只证明补丁提交成功。不得把它当作 CI 验证通过。

先读 `docs/product/vnext-authorized-intent.md` 和源码差异。设计原则为本次验收
依据，不得为了修测试重新引入“用户必须先完成才可停止”的旧门槛。

## 准备与构建

在独立 checkout/工作树中拉取本分支，保留其他人的未提交改动。不要直接在
LawAgent 等业务项目试验，不重置真实任务状态。依仓库工具链执行：

```sh
bun install
bun run build:vnext-runtime
bun run build:vibe-governance-distribution
bun run gen:all
bun run validate:protocol
bun run validate:vnext-source
bun run validate:freshness
bun run scripts/vnext-runtime.ts validate-contract --root .
git diff --check
```

核对真正调用的是刚构建的 dist，不能只修改 src 后运行旧安装包。生成产物
必须使用生成器，不手工改 `runtime/vnext/dist/**` 或 generated docs。
版本统一、发布和升级依原发布流程另外办理，不把源码版本未变当成已部署。

## 行为验证范围

优先复用下列已有测试文件和夹具。只有当前回归确实无法表达核心行为时才
增加/扩展行为用例；不为文案、标题、注释或逐句原则新增断言。

| 场景 | 必须观察的结果 | 现有入口/文件 |
| --- | --- | --- |
| 普通执行 | record-step-result 不推进；免审查时 complete-executed-step 独立完成；上下文不强推额外 review | vnext-daily-semantics.test.ts、vnext-task-context.test.ts |
| repair 组合 | correction→findings→begin-repair→实际结果登记→review→完成；登记不要求事先 clean、不解除 challenge | vnext-runtime.test.ts、vnext-task-recovery-e2e.test.ts |
| 失败及预算 | 失败可登记；准入先计波次；相同回执恢复/登记不多计；原指令覆盖的继续无需新用户措辞 | vnext-runtime.test.ts |
| 同源反证 | 两个 challenge 共用 evidence blob，确认引用去重而 challenge/历史完整 | vnext-task-recovery-e2e.test.ts |
| 纠正保留 | pending review 和 in-progress finding 不使已结算执行的纠正候选被拒；旧审查不能资格化新定义 | vnext-task-recovery.test.ts、vnext-runtime.test.ts |
| 未完成终止 | draft、active、blocked_by_replan、superseded、replaced 及三种 suspended tuple 都能预览→确认→归档→回读 | vnext-lifecycle-e2e.test.ts、vnext-close-reconciliation-e2e.test.ts |
| 确认绑定 | 初次仅预览不写；无确认拒绝；漏/伪造目标拒绝；纯审计追加不重复问；计划/证据/覆盖代码实变须重新确认 | vnext-runtime.test.ts、vnext-close-reconciliation-e2e.test.ts |
| 无 review 推进 | ready/in-progress 时允许后果确认；记录 user-directed-with-exceptions，不造执行、review、not-run、PASS | vnext-daily-semantics.test.ts、vnext-runtime.test.ts |
| 推进后执行 | 精确缺失前置义务的例外可继续，但未满足槽仍不能用于 verified；新权限仍拒绝 | vnext-runtime.test.ts |
| 迟到结果 | 原 preflight 对应结果在暂停/终止后追加；不复活任务、不改 archive/live claim；错 document/plan 拒绝 | vnext-lifecycle-e2e.test.ts、vnext-runtime.test.ts |
| 幂等恢复 | 已提交但回执丢失不重做；相同键不同报告拒绝；close 重入只补知识/status/lesson 对账 | vnext-close-reconciliation-e2e.test.ts、vnext-task-store.test.ts |
| 保留边界 | 越界路径、假预检、假用户来源、错误 execution/review 绑定、假成功拒绝且不扩大权限 | vnext-mutation-scope.test.ts、vnext-runtime.test.ts |
| 未改能力 | file-context/task-read 分页、task store、文档知识、安装升级与旧历史读写正常 | vnext-context.test.ts、vnext-task-store.test.ts、vnext-knowledge-promotion.test.ts、vibe-governance-distribution.test.ts |

建议先跑相关文件，再按修改传播范围选择全套回归：

```sh
bun test test/vnext-daily-semantics.test.ts test/vnext-runtime.test.ts test/vnext-task-context.test.ts
bun test test/vnext-task-recovery.test.ts test/vnext-task-recovery-e2e.test.ts
bun test test/vnext-lifecycle-e2e.test.ts test/vnext-close-reconciliation-e2e.test.ts
bun test test/vnext-mutation-scope.test.ts test/vnext-context.test.ts test/vnext-task-store.test.ts
bun test test/vnext-knowledge-promotion.test.ts test/vibe-governance-distribution.test.ts
# 修复相关问题后，依必要范围运行：
bun run test:workflow-all
```

## 旧用例如何调整

旧夹具若把 `status: completed + execution_result` 当作推进，必须改成先断言
事实登记，再调用实际完成操作；不删除该断言或放松为“任何状态均可”。旧的
repair blocked→completed 预期改为 blocked 事实记录，保留原 review 义务。
关闭例外用例应先读取 closure-decision-context，再用固定测试用户确认，不能
随意拼 target ID 或复用不同后果的 digest。无 review 推进应断言没有新 review
和执行结果，不能为了复用旧夹具人工制造一个 blocked review。

不得将源码片段/关键字包含测试当作行为证据；不得为让新测试通过清空历史、
删 finding、伪造 clean、重建真实用户任务或关闭身份/范围校验。

## 终端结果与记录

逐场景记录：commit、构建产物、入口、原始状态、授权/确认、操作结果、实际
状态差异、保留义务、是否幂等、执行证据。指出 Runtime capability gap 与真实
业务/依赖错误的区别。新问题应修实际事务路径，不继续给用户添加内部手续。

安装后的 CLI 场景必须覆盖，不以源码函数测试替代。生成产物和测试修复另行
提交并报告；失败/未运行项如实保留。只有关键路径和不变能力验证完成后，才
把本次授权意图改造标为已验收；通过一个 repair 用例不足以验收全生命周期。
