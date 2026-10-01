# vNext 因果计算内存优化：实现与验证

基线：`c5107603e6a5bab5e5b343bf96f0c16f687f7f73`。
本次仅实施改造二，保留上一提交的 summary/task/step/full 查询展示。

## 实现范围

`runtime/vnext/support/task-management.mjs` 用查询内的直接父边图替代每个事件的完整祖先 Set。
通过迭代式强连通分量计算和分量间直接父边，准确处理有环输入；在分量 DAG 上让一批候选
共享向前遍历，计算 maxima。单个候选不能因自环而覆盖自身；同一分量中的不同候选仍按
旧规则互相覆盖。返回保留原顺序、重复 ref 和原记录对象。缺失引用是无出边端点，不被
猜测成不存在的事件，也不增加新的阻断或诊断规则。循环检测使用同一图的分量成员关系。

直接图、分量图和临时遍历集合的辅助空间为 O(V+E)，不保存全节点的传递闭包。
V 包括被引用但当前缺失的端点，E 是实际保存的直接父边；这不是对整个 Runtime 的固定
内存上限。全量读取、原始记录、聚合输出和多次候选比较仍有成本，不能宣称完整 taskView
在所有输入下都是线性时间。深链处理不使用递归调用栈。

`link/correct` 成功应用以及无效解释剔除后，在原清空祖先缓存的位置重建临时图；不更改
关联处理顺序、因果 heads 默认值、选择/更正/冲突规则和事实保存逻辑。

### 特殊兼容边界

基线的“解释冲突 -> all.delete(ref)”分支不会清空已经按需计算的祖先缓存。因此，在该
删除与下次清空之间，已经查询的根与尚未查询的根可能观察到不同的图。直接统一重建当前
图会改变某些旧循环诊断。这次不顺带修正该语义，使用删除序号与每个根的首次观察序号
重现原边界，而不是保留旧祖先 Set。只缓存一份分量图；成功更正后一起重置这些元数据。
这些序号仅存在于一次计算中，不写入事件，不是权限/有效期或跨查询缓存。

新增行为用例覆盖这个边界。互相循环的更正集合等原有不受支持的解释情形，也不借此次
优化制造新的成功结果；这不是旧关联异常的全面修复。

## 未改变

- 事件和证据存储格式、内容、编号与 legacy 基线；没有清理、归档或数据迁移。
- 全量日志扫描、摘要校验、全局冲突与未关联诊断；没有最近 N 条/时间截断。
- assistance.mjs、API 响应、summary/task/step/full、read/find 及其分页行为。
- CURRENT_TASK、缓存与展示发布的写入流程、延迟编辑保护、幂等请求和 Git 关联。
- 没有数据库、磁盘索引、后台服务、开发准入或新增安装依赖；仍是原来两个原生模块。
- 不修改版本号，不发布分发包，不修改目标项目安装或真实工作区。

## 已执行验证

环境：Linux x64，Node.js v22.16.0。网络 clone 不可用，通过 GitHub 读取并以 Git blob SHA
验证重建所需源文件副本；不是完整仓库 clone。基线 task-management.mjs 的 blob 为
`d9296ca05e1b1695cf7eb0d9ee85473d405e733c`，management 测试的 blob 为
`a47aaa653b9b478713fb0c5cfe59c6c62bb88527`。assistance.mjs 保持上一提交的
`2c12f092a87fbb2df1da9c8da14c5e234eb5c2d8`。

```sh
node --check runtime/vnext/support/task-management.mjs
node --check test/vnext-task-management.test.mjs
node --check scripts/benchmark-vnext-causality.mjs
node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs
```

基线现有 22 项测试通过；改造后共 27 项通过、0 失败。复用原套件并增加 5 项行为测试：
50 组确定种子的有环/无环图与独立可达性计算对比；循环更正的自身/其他候选区分；解释
冲突后的观察边界；更正父边恢复失败执行且不改原文；6000 条历史在独立 Node 进程
`--max-old-space-size=128` 下完整重建。该堆限制仅用于回归测试，不是 Runtime 新限制。
原有安装路径、并发重放、延迟编辑写入和改造一查询展示测试继续通过。

此外执行两组隔离差分检查（不向源码库提交真实用户资料）：

- 10000 个确定种子的直接图，在删除、更换父边、循环、缺失端点和重复候选场景下，对比
  新算法与原祖先集合算法，共 1639231 次检查一致；测试脚本临时提取内部函数，不增加公开 API。
- 500 个合成任务日志，包含多任务、采纳、执行、测试、审查、处置、link/correct、未知
  动作及缺失引用；新旧 taskView 全对象及 effective_refs 深比较一致，500 个均返回结果。

### 用户提供记录的只读差分

只读取 records.zip 与 CURRENT_TASK 的隔离副本。207 条事件、5 个任务、15 个步骤，原有
7 项问题和 7 项未关联记录不变，当前任务仍为 null。25 组完整视图、summary/full context、
逐任务/逐步骤查询深比较一致，source_revision、view_revision 和 effective_refs 一致。
查询前后 1043 个样本文件的 SHA-256 和 mtime 均不变。样本未进入源码库。

## 长链内存测量

测量脚本：`scripts/benchmark-vnext-causality.mjs`。父进程在临时目录生成单任务长链，
子进程分别加载基线/改造后的完整 assistance 服务并调用 taskStatus。生成夹具不计入
测量进程；两个版本使用相同 `--max-old-space-size=2048`。报告 process.resourceUsage 的
maxRSS（进程启动以来峰值 RSS，含 Node 启动与加载开销），KiB 换算 MiB；不是堆净增量。
耗时范围是 taskStatus 调用。重复测试交替执行顺序；没有清除 OS 文件缓存。

| 事件数 | 完成测量次数（每版本） | 基线峰值 RSS | 改造后峰值 RSS | 降低 | 基线耗时 | 改造后耗时 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2000 | 3，取中位数 | 151.93 MiB | 56.79 MiB | 62.62% | 1206.65 ms | 167.04 ms |
| 4000 | 3，取中位数 | 449.01 MiB | 70.57 MiB | 84.28% | 4583.79 ms | 217.55 ms |
| 8000 | 1 | 1388.68 MiB | 95.75 MiB | 93.11% | 20379.49 ms | 468.41 ms |

每次完成的对比都返回同样的 view_revision、事件数和诊断。以上是合成稀疏长链，不是
LawAgent 实机或任意大项目的保证，也不是 token 测量。最初 8000 条、三轮的组合命令超出
外层 90 秒执行窗口，未使用该次不完整汇总；表中 8000 条来自重新完成的一组独立对比。

复现示例（两个路径应指向分别从基线和本次提交检出的 assistance.mjs，且旁边有相应的
 task-management.mjs；脚本只生成临时夹具，不接收目标项目工作区）：

```sh
node scripts/benchmark-vnext-causality.mjs /path/to/baseline/runtime/vnext/support/assistance.mjs /path/to/candidate/runtime/vnext/support/assistance.mjs 4000 3
```

## 集成边界

只完成原生模块的语法、行为、样本差分和合成内存验证，没有运行完整工作流测试、完整
类型检查、Bun 构建、分发清单生成或正式安装/升级事务；没有运行目标项目业务测试。
没有独立审查者的复审。源码分支不代表 LawAgent 已升级。

在完整源码仓库按既有分发流程重建并验证安装；保留目标项目 records 和 CURRENT_TASK：

```sh
node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs
bun run build:vnext-runtime
bun run build:vibe-governance-distribution
```

API/Skill 无需为本次算法优化改变调用方式。改造一的兼容规则继续适用。
