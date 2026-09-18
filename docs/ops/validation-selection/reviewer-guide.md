# 回放评估准则（不提供给准备会话）

## 原事件的证据边界

来源：`rollout-incident.json`。旧执行报告声称 109 PASS 与 C1 satisfied；任务
快照保存的独立审查为 findings，C1 rule/flow 仍 missing、due S3。不能把它
改述成 Runtime 已因 109 PASS 完成了 claim。旧报告的 200-byte 参数与审查的
1000-byte 参数冲突，本轮没有原测试源码裁决；应检查真实 fixture 后再报告。

## 语义评价，不做字段/关键词评分

| 真实失败类型 | 合格选择需要辨别的事实 | 应拒绝的替代证明 |
| --- | --- | --- |
| known_complete_range 重读 | 请求下一缺失范围，完成覆盖严格向正确终态推进；只容许契约要求的重叠，独立预期不能复制当前返回范围 | 只验证成功、非空，或把重读 known range 写进 expected |
| 多窗口但全部 raw 常驻 | 固定窗口规模下检查 raw-record 的生命周期/峰值；与 reducer/output 的必要状态区分，输入须真的跨足够窗口 | 窗口数 > 1、单窗口大小合规、最终记录数正确 |
| 边界扫描缺取消/deadline | 在进入扫描后再改变取消/时钟，并观察受控的后续 I/O 上界与结果；允许可靠静态论证或已准入的确定性 hook | 只测预先取消，sleep 超时，或读取成功 |
| 弱 oracle / 跨窗 key 关联 | fixture 证明确实跨边界；独立确定 tool 与 turn 的精确归属，retry/overlap 的 key 值相等 | 只检查非空 key/ID 或存在 tool details |
| 报告夸大 / 假 flow | 参数与记录的实际运行一致；公共 promotion 结果原样交给 append，必要时走已规划的真实 Node/stdin/store 再读取链条 | 手改 cursor kind、读 opaque payload、mock consumer，或从 suite 总数推出覆盖 |

不要求每行新建一个 test；多个观察能由同一条真实业务路径可靠取得时合并。
local rule 和 business-flow 各自满足，并不要求重复执行两套能证明同样事实的测试。
内存/取消不能由最终成功输出推断；bounded raw residency 也不是“总 RSS 常数”。
不规定必须采 RSS、强制插 instrumentation 或新增 E2E。
测试已存在不等于能复用作证明；必要的 assertion 增强优先于同义新测试。

## 防止评价本身推动过度治理

没有确定 oracle 时先找原要求，不能写符合当前代码的 expected。没有候选源码
时承认不能确认其检出力；不能声称从旧报告中看到了不存在的断言。
未写出的新测试可以先有清楚、可实施的 setup + 独立预期，不要求 prepare 运行它。
到期前的缺报告不是当前 draft/S1 的自动阻塞；不要删掉后续 flow 义务来省测试。
有依据的相关宽回归/E2E 仍可准入；无关额外 PASS 不提升 assurance，也不单独
造成运行中 task 永久阻塞。正常 adjustment 继续使用已有 bounded repair 路径。

判定记录用普通说明即可：所读源版本、选/不选的检查及原因、它能击中的错误、
尚未证明的边界、执行/未执行状态。不要为目标 Runtime 新增这些字段。
分别报告 guidance guard、人工知情回放、真实源码故障对照、独立 Agent 运行。
前三者不能自动升级成最后一种。

## 可执行的本仓库历史检出力对照

这不是原 Rust incident 的替身证明，而是另一组有真实提交的产品失败。
`a37115d` 的 C metrics 原实现在审查中遗漏并发采样、旧默认值和 Task Basis
空行；`b3d8410` 修复它们。先从业务义务选择以下最小已有 checks，再执行。

| 业务义务 | 选择现有 test（名称完整匹配） | 为什么能检出 |
| --- | --- | --- |
| 一条样本不能混 revision | `storage metrics review invalidates samples when a real commit crosses the start or final sampling boundary` | 真实 prepareDraft 在读取中提交，检查 unavailable 与清空数据；稳定后再用真实 CLI 对照 |
| 存储迁移不制造逻辑增长 | `storage metrics review normalizes missing legacy defaults before computing migration deltas` | 原 bootstrap 缺字段输入，实际 migration 后业务模型相同，独立预期增量为 0 |
| 合法引用须正确计数 | `storage metrics review uses canonical Task Basis references without imposing blank-line spelling` | 实际文件与 canonical parser 成功，无空行布局仍应报告精确 UTF-8 字节，真实 Node CLI 也要一致 |

在隔离 `a37115d` 源码副本上仅带入 `b3d8410` 的这些既有测试（不可带入修复
实现），保留旧 Runtime/CLI；在 `b3d8410` 上使用相同测试。匹配失败断言后
才算检出，不能把 import/build 错误算作成功。测试文件沿用完整 helpers，运行
用精确 name pattern，不因此执行整个 target。不要修改真实目标项目。

这是故障检出校准，不是新 Agent 的盲测：本轮实现者已知历史缺陷和回归答案。
校准通过不证明新提示比旧提示的选择率更高，也不要求每次任务都双版本测试。
