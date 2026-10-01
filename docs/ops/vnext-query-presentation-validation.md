# vNext 查询展示改造：范围与验证

实现基线：`abc4e69be1ac5f6cb4e95b9eaa446a5a96285835`。

## 本次改变

仅实施“内部查全、外部按需返回”。原生 assistance CLI 的 `task-status`、
`context` 和 `task action=status` 默认返回 summary；`detail=task/step` 按需展开，
`detail=full` 保留旧完整响应。context 的任务数据只出现于 management。
完整输入输出契约见 `runtime/vnext/support/ASSISTANCE_API.md`。

这是程序字段投影，不是模型生成摘要。默认展示身份、采用计划引用、当前步骤执行结果、
审查/处置状态、来源引用、计数、剩余工作和建议入口；不展开所有计划及执行原文。
所有模式仍从完整日志计算，保留全局问题、未关联记录、版本和投影新鲜度。
查询选择不等于修改工作焦点；选择失败不会自动换成另一个任务。

summary 的任务列表可分页，默认 20、最多 100 项；诊断不分页、不静默截断。
下一页请求携带前一页 view_revision。变化时只重启查询，不产生开发门槛。
分页检查不承诺在并发写入下获得事务快照，原 reducer 的读取一致性边界不变。

## 明确不改

- task-management.mjs、全量扫描、因果算法、记录格式和字节、CURRENT_TASK 发布均不改。
- 不新增数据库、持久化索引、缓存授权、记录清理、自动 Git 操作或业务测试。
- 原 JS taskStatus/context/task 导出及 mutation 返回契约不变；新增 queryStatus/queryContext。
- read 的 Base64/文本预览双表示和 find 的待扫描列表游标留待独立改造。
- 不提升版本号、不发布分发包、不修改目标项目安装和真实任务状态。

完整 task/full 请求和异常诊断仍可能较大。本次不承诺固定 token 上限或状态计算提速。

## 已执行验证

环境：Linux 容器、Node.js v22.16.0。通过 GitHub 读取所需源文件，在容器中以 Git blob
SHA 校验重建测试所需副本；不是完整仓库 clone。baseline assistance.mjs 的 blob 为
`7f6853f76f0af75c0c04288bf800c780ceff2637`，未修改的 task-management.mjs 为
`d9296ca05e1b1695cf7eb0d9ee85473d405e733c`。

```sh
node --check runtime/vnext/support/assistance.mjs
node --test test/vnext-assistance.test.mjs
```

结果：11 项通过，包括原有 6 项行为回归，以及扩展的 5 组查询行为场景：

1. summary/full 计算字段相同；精简 context 无重复；task/step 原文、失败和用户处置保留；
   缓存损坏不影响读事实；按引用分页读回事件和固定证据；查询不改变文件摘要或 mtime。
2. 多活跃任务不猜焦点；即使只选择另一个任务，也保留因果冲突、损坏事件和暂缓的关联问题。
3. 23 个任务跨 summary 页不漏不重，完整计数和诊断保持；变化的版本不能静默接续旧分页。
4. 空库、关闭任务、错误选择和无效输入有明确结果；错误查询不写日志、不制造任务。
5. 将两个原生模块复制到目标安装布局后，CLI 三种状态入口默认精简，full 保持旧响应；
   状态查询错误不落盘，真实 mutation 继续返回原契约并保留调用者的任意字段。

没有为标题、注释或文案新增测试；未运行完整工作流测试、完整类型检查、Bun 分发构建、
正式安装/升级事务或目标项目业务测试。安装路径验证只是原生模块复制后的运行验证。

## 用户记录样本的隔离回放

使用用户提供的 records 包和 CURRENT_TASK 副本，不使用或改动目标项目工作区。
同一隔离目录比较旧模块和改造后模块，包含 207 条事件、5 个任务和 15 个步骤。
所有低层完整响应、full 兼容响应、逐任务/逐步骤详情、诊断及版本字段均深比较一致；
原有 7 项问题和 7 项未关联记录保持，current_task_id 仍为 null，不擅自选择任务。
查询前后全部样本文件的 SHA-256 和 mtime 相同。

| 序列化 JSON 的 UTF-8 字节（包含一个结尾换行） | 改造前 | summary | 减少 |
| --- | ---: | ---: | ---: |
| task-status | 1,237,976 | 16,229 | 98.69% |
| context | 2,536,213 | 17,505 | 99.31% |

这是同一输入的响应字节比较，不是模型 token 实测、性能基准或目标设备运行保证。
用户样本、任务标题、证据和原始输出均未加入源码仓库；这里只记录聚合验证结果。

## 集成与升级

CLI 的默认 JSON 形状发生改变。依赖旧 current_task/tasks 全量结构的 CLI 调用方先改用
`{"detail":"full"}`；Agent 按新的 summary/detail 契约读取。现有 JS 调用方无需改动。
全部 Skill 已引用安装目录的 ASSISTANCE_API/TASK_MANAGEMENT_API，因此查询规则集中更新于
这两份 API 文档，不逐个扩写 Skill。读到 ref 或计数不等于已经读取计划、报告或用户原话。

原生模块本身无需编译；正式分发仍需在完整仓库按既有流程重建清单/产物并验证安装：

```sh
node --test test/vnext-assistance.test.mjs test/vnext-task-management.test.mjs
bun run build:vnext-runtime
bun run build:vibe-governance-distribution
```

以上完整套件与分发命令是后续集成步骤，不是本次全部已经执行的命令。
不要把源代码分支提交当成目标项目已经升级；不要覆盖目标项目的 records 或 CURRENT_TASK。

## R4：详情请求保留目录上下文（2026-10-01）

后续修复统一生成 summary 任务列表、selection、step 到 task 的 detail_request 及分页
next_request，继承重建结果的有效 workflow_home。它既保留显式目录覆盖，也保留 profile
解析出的目录；随后 profile 变化不会让已有导航请求静默返回另一个目录。
查询目标和工作焦点仍分开，读取不写缓存、展示或事实，不新增确认或审批。

新增一项回归实际从 custom/workflow 的旧任务读取列表、选择、步骤和 context，逐个
跟随后续请求回读任务，并核对文件、mtime 和焦点不变。还覆盖分页、隐式 profile
目录及 profile 变化后的既有请求；修复前在缺少 workflow_home 时失败，修复后通过。

本轮 Windows，Node.js v24.12.0，Git 2.47.0.windows.2。结合 R1–R3 的三个原生测试
文件共 55 项：54 通过、0 失败、1 项因实体符号链接权限跳过；源码契约通过，相关
源码测试 19 通过。没有修改 task-management.mjs、事件格式或完整响应契约；未进行
分发构建、正式安装/升级、真实目标项目验证、提交或发布。
