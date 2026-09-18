# D 实施证据与尚未验证的部分

基线：`b3d8410bd37db6a135783d10b6c3ef291cf119c5`。
本轮只改四个既有 Skill、已随包分发的 CONTEXT_API guidance、现有 P-12 源码
契约 guard，以及本目录的回放资料。没有 Runtime/schema/gate/registry 改动。

## 原业务事件

对照用户上传的真实 `CURRENT_TASK.md` 和验证报告提取允许列表字段。
`rollout-incident.json` 保留原文件 hash、字段坐标、原要求、报告和审查的分层。
未保存会话定位、用户身份、整个私有任务或业务数据。

原准备 commit `036c514458d689de660f7cc0d40199dc6f184f09` 未能从本轮已连接的
`KongXiangning/TermLink` 读取；默认分支也没有该 target_source 路径。没有把
其他 branch 当原故障代码，也没有重新实现一个简化 backfill 并声称复现原项目。
本轮对该事件完成的是源材料核对与可执行计划的评估准则，不是原 Rust 重跑。

## 已执行的真实源码检出力校准

按 reviewer-guide 中三个业务义务，选择已有 C 回归，不创建同义测试。
旧代码为 `a37115df5cb97dae969582e8c9570653cd0cd20a`，修复代码为上述基线。
旧隔离副本只带入新版这两份测试文件的内容，保留旧生产实现并重新构建旧 CLI。
实际执行相同的命令：

```sh
bun test --timeout 60000 test/vnext-runtime.test.ts test/vnext-task-metrics.test.ts --test-name-pattern 'storage metrics review (invalidates samples when a real commit crosses the start or final sampling boundary|uses canonical Task Basis references without imposing blank-line spelling|normalizes missing legacy defaults before computing migration deltas)$'
```

| 源码 | 结果 | 失败/成功的含义 |
| --- | --- | --- |
| a37115d + 相同已选测试 | 0 PASS、3 FAIL | 并发样本错误 complete；实际 405-byte Basis 被报 0；应为 0 的 claim 增量报 2 |
| b3d8410 + 相同已选测试 | 3 PASS、0 FAIL | 三个真实入口的对应业务观察成立，含编译后的 Node CLI |

失败是相关业务断言，不是 import、构建或环境错误。没有执行完整 Runtime
target，也没有执行 test:workflow-all。这里使用真实事务、原 legacy 输入和实际
文件/CLI 观察，而不是手工声明 selection 或 command_results=passed。

**这是知情实现者选择后的检出力校准，不是 fresh Agent 盲测，不是旧/新提示的
A/B 效果对照。** D 没有修改这三个产品缺陷的实现；不能把它们的 PASS 归功于
提示本身。本轮没有独立执行另一个 Agent，也不报告选择准确率或跨模型提升。

## Guidance 与分发

现有源码 guard 增补顺序、反例、oracle 和非强制 Red 的断言；只证明这些提示
确实在分发源中，不证明模型理解或执行了它们。

```sh
bun test test/workflow-vnext-source.test.ts --test-name-pattern 'preserves P-12|keeps execute-step focused|requires prepare-task to map'
bun run validate:vnext-source
bun run gen:all
bun run validate:freshness
bun run scripts/build-vibe-governance-distribution.ts --out <isolated-output>
```

前三个已选源码 guard 通过。已核对临时包包含修改后的四个 Skill 和 support
原文，不包含本目录的评估答案；未发布/安装到真实目标项目。无版本变化。

## 独立效果验收仍需实际运行

后续按 replay-prompts，在隔离真实源码上保留新 prepare-task 的原始输出，再由
独立 review-draft 按 reviewer-guide 判断最小必要性、检出力与 flow。局部逻辑、
文档变更和有依据的宽回归作为防过严对照。不因材料包齐全或源码 guard 通过
就宣告“真实业务测试选择已达到目标”。不把这项验证变成每个目标任务的新 gate。
