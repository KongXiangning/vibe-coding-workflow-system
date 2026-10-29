# 旧任务迁移后保留来源的读取验证

日期：2026-10-30。通用修复纳入 0.24.22，范围是 workflow-system 源码、构建后的迁移工具及隔离验收。
发行版本、Runtime、VERSION 与生成参考已对齐并重建本地发行构建；未发布 npm 包，
未升级、迁移或修改任何真实目标项目。

## 问题和修复

旧 journal 视图的生命周期引用可让 TraceLens 打开原始事件；切换到 Task 当前记录后，
旧事件引用不再等同于物理来源入口。若该文件又不在 PRODUCT 的读取范围内，迁移即使
保留了原路径与 SHA，原文接口仍会返回 403。原迁移验证只核对文件和任务状态，漏掉此边界。

通用迁移工具现在会：

- 在只读计划中列出实际引用且保留的来源，以及缺少的精确 source_paths 登记。
- 合并必要登记，保持原有范围、其他配置和业务文档；已有有效登记不改写。
- 区分直接引用与为完整性保留的归档容器依赖，不自动登记整目录或全部容器内部文件。
- 在删除旧过程文件前完成读取登记，通过原生 read 分页读完整原文并核对字节数和 SHA。
- 尊重显式排除与冻结；写入或读取失败保留旧过程文件，支持同一已验证计划继续。
- 对重试重新检查冻结和计划指纹，避免用户修改后的策略被旧计划静默覆盖。

`verify` 返回 readable_sources 和 source_readability。旧计划缺少读取清单时返回
not-recorded-in-plan，历史文件验证不冒充新加入的读取验证。

实现及交付文件：
[迁移源码](../../runtime/vnext/src/task-state-migration.ts)、
[构建产物](../../runtime/vnext/dist/task-state-migration.js)、
[操作说明](../../runtime/vnext/support/TASK_STATE_MIGRATION.md)。

## Runtime 回归

`node --test test/vnext-task-state-migration.test.mjs`：18 项通过。
新增场景覆盖缺失读取登记、只读计划、已有范围不改、精确登记与注释保留、备份恢复原配置、
重复执行无新增、移除登记后 verify 报错、显式排除、冻结、源配置变化、策略写入失败后
不回收旧文件、冻结后的重试拒绝及同一计划继续。原有归档、身份、范围、失败结果、时间、
焦点、来源保留及恢复回归继续通过。

`bun run test:legacy-task-cleanup`：7 项通过、115 个断言；独立旧 Task Store 工具无回归。

## TraceLens 实际消费验证

命令：

```powershell
bun run test:task-state-migration:tracelens --tracelens-root E:/coding/tracelens
```

此命令使用现有本地 TraceLens 生产构建。脚本在系统临时目录创建合成项目及独立登记，
通过实际 HTTP 路由和请求校验访问原文，不读取或更新用户的正式项目登记。
没有修改或重新构建 TraceLens。

| 合成场景 | 新增精确登记 | 实时读取 | 快照读取 |
| --- | ---: | --- | --- |
| 原文保留、原范围未登记 | 1 | HTTP 200，全文及 SHA 一致 | HTTP 200，全文及 SHA 一致 |
| 原文已进入归档，迁移恢复原路径 | 1 | HTTP 200，全文及 SHA 一致 | HTTP 200，全文及 SHA 一致 |
| 原读取范围已经包含来源 | 0，配置字节不变 | HTTP 200，全文及 SHA 一致 | HTTP 200，全文及 SHA 一致 |

三个项目均在迁移前以旧视图打开原文，再完成迁移，检查新格式下的 Task 身份、关闭状态、
绑定范围及业务文档字节，最后分别通过两种模式的 task-source 打开保留来源。
每份原文为 253,215 字节，包含中文，实际覆盖多页读取与 UTF-8 字节边界。
比较迁移前完整字节及 SHA，不把文件存在、只读第一页或仅返回 200 当作全文通过。

这些结果限于当前 Windows / Node v24.12.0 / Bun 1.3.10 以及该本地消费构建，
不是其他真实项目已经修复或已安装新版本的证明。

## 源码检查和部署边界

validate:vnext-source、validate:protocol、validate:freshness、workflow:health --root .、
Node 脚本语法与 git diff --check 均通过。没有运行 test:workflow-all 或业务工程测试。

0.24.22 本地发行构建通过版本一致性检查；Runtime validate-contract 确认版本 0.24.22。
隔离安装／升级／策略回滚回归 8 项通过、67 个断言；源码协议与生成新鲜度复核通过。

已重建 task-state-migration.js；新增联合验证脚本与命令可供后续维护使用。
既有目标项目及以前生成的安装包不会因源码修改自动更新，后续部署／补修需另行明确执行。
