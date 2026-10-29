# Task 当前记录：第五步隔离联合验证

日期：2026-10-29。范围：workflow-system 与 TraceLens 当前工作区源码、隔离候选包及合成项目。
未升级真实业务项目，未递增版本、发布或提交／推送源码。本轮 Git 提交仅发生在临时合成仓库。

## 验证链路与结果

在 Windows／Node v24.12.0／Bun 1.3.10 下，从当前源码构建本地 0.24.20 候选包，用其真实
Node 安装入口建立中文路径项目，workflow_home 使用 `notes/工作流`。这是未发布候选包，
不是旧发行版到新发行版的验收。真实项目数据迁移仍属于第六步。

1. install 干跑前后项目文件一致，实际安装保留已有画像、业务文件及自定义 Git 规则。
2. 用安装后的 assistance 创建／采用任务，先记录真实合成单元命令失败，修复合成代码后
   执行 100 次同一单元命令。同一检查位置被更新，正式任务目录始终只有 Task JSON 与
   state.json；原始输出、合成体积负载和 blob 留在该任务临时目录，未生成永久 events。
3. 另记录模拟现场检查失败，保留开放发现。建立父子任务和旁路任务；关闭前置子任务后
   恢复父任务焦点。只清理子任务，父任务和旁路任务的临时材料及字节保持。
4. 按安装后的 close-task 规则，先明确保留一份 64 字节的合成现场日志，保存／回读关闭，
   再用安装后的 product helper 保存独立 Assessment 并回读其选择与逐点结构，最后 cleanup。
   F1 保留已实施／验证失败，F2 保留未实施／未运行，结论 not-satisfied，未从关闭推出满足。
5. 主任务清理后临时文件为 0，Task 字节及修订、报告固定引用的 Task SHA 均不变，评估仍可选。
   旁路任务材料先作为未被误删的控制，之后单独关闭清理；重复 cleanup 不改变文件集合或字节。
6. 删除测试项目的已知 Git 策略块，实际执行同版本 upgrade 补齐规则，核对干跑无写入，
   任务、历史与报告保持。用 Git checkpoint 完成第二次实际提交及原生 index／commit 校验。
7. Git 克隆没有临时材料或生成展示，仍能用 Runtime 读取相同任务身份、交付、失败结果及遗留
   问题。再在克隆中安装同一候选包，正式 Task 字节仍相同。临时仓库路径较长，因此仅为
   这些临时仓库设置 core.longpaths；没有改动全局或真实项目 Git 配置。
8. 另建既有 journal 控制项目：软件安装／升级保持 v1，旧事件原字节不变，未自动转换为 v2。

数据体积统计如下，均为合成项目实测，不包含软件安装文件、测试代码及产品文档：

| 对象 | 文件数 | 字节数 |
| --- | --- | --- |
| 主任务关闭前的临时目录 | 204 | 7,285,048（约 6.95 MiB） |
| 主任务 cleanup 后的临时目录 | 0 | 0 |
| 3 个任务的正式保存材料：3 份 Task、1 份项目状态、1 个明确保留附件 | 5 | 11,296（约 11 KiB） |
| 本地固定展示缓存／基线／正常恢复副本 | 3 | 24,544 |

三个已关闭任务均无临时材料。tmp/tasks 根目录另有固定 `.gitignore`，1 个文件、14 字节；
CURRENT_TASK 仍是单独的生成展示。它们不是新增业务事实，也不随每轮执行追加历史。

## TraceLens 联合消费

使用 TraceLens 生产构建、独立 Registry，并明确登记安装后五个原生模块的实际摘要。
原项目、Git 克隆和旧 journal 控制共三个项目均通过真实 Runtime／Snapshot 接口读取。

- Task／目标／需求／功能点关联、真实 task_id、plan_ref／step_id、创建／关闭时间可读。
- 页面可从目标进入需求，再进入关联 Task 与 S1；F1／F2 的实施与验证分别显示，100 轮后仍
  只保留当前单元结果及独立的模拟现场失败，开放发现和未实施范围没有消失。
- 原文入口只列真实 Task JSON 和选定日志；Task 原文可打开，Git 克隆的 Task 来源摘要与
  清理前的最终摘要一致。逻辑计划和执行编号没有被当作文件。
- 旧 journal 项目仍显示其原 Task。克隆保留关联，不把原工作副本的评估自动当作新对象认证。
- Edge 页面在 1440×1080 与 390×844 下检查；窄屏整页宽度为 390，表格自身可横向滚动
  （内容宽 452、容器宽 326、实际 scrollLeft=126），能查看完整验证列。控制台错误／警告为 0。
- 全部读取和页面操作结束后，三个被观察项目的逐文件 SHA 与 mtime 均与读取前一致。

截图与精简结果位于 TraceLens 的 Git 忽略目录 `output/playwright/joint-c6d54c/`，保留
`task-desktop.png`、`task-mobile.png`、`task-mobile-results.png`、`task-clone-desktop.png`
及 `validation-result.json`。浏览器与服务已退出。自动审批拒绝删除本轮临时项目／候选包
与 `.playwright-cli` 诊断目录的命令，仅返回 blocked by policy，未给具体原因；未换工具
重试删除。用户在开始第六步前已确认手动删除这两处验收目录；截图及结果文件保留，
任务自身 cleanup 已完成。
OS 临时根为 `C:/Users/kongx/AppData/Local/Temp/vnext-joint-c6d54c36415348b187285a16ddc527c7`。

## 本轮发现并修复

中文路径下，本机原生 Node 的 `fs.rmSync(file, { force: true })` 在最小复现中返回后仍留下
文件。断点确认锁释放流程已执行；同一场景的 `unlinkSync` 可删除文件。首轮联合验证因此
发现 320 个锁暂存文件及 8 个展示暂存文件，未将该失败轮计为通过。

Runtime 现在用共享的直接 unlink 清理自己创建的普通暂存文件，仅忽略 ENOENT，其他删除
失败继续如实返回。覆盖锁、展示、重复捕获和保留材料的暂存路径；没有增加后台维护、
目录遍历清扫或真实项目历史文件回收。新 Native CLI 中文路径回归修复前失败、修复后通过。
随后用重建候选包在新隔离项目重新执行 100 轮与结项，确认没有这些残留。

页面另发现关联面板把合法的 closed 生命周期标为“未识别”。已补齐 closed／ambiguous 的
状态识别，保持关闭与业务验证结论分开，页面重载确认修正。

## 定向回归与边界

- Node 的 task-state、task-management、task-display、task-state-checkpoint 四文件：93 项通过，
  包含新增中文路径原生回归；未跳过。覆盖旧展示保护、并发、父子任务及真实 Git 提交／克隆。
- TraceLens 显式指定当前 Runtime 源码，runtime-state、runtime-state-ui、requirement-work：
  21 项通过。状态标签修正后 product-hierarchy 与 runtime-state-ui：11 项通过；两组有重叠。
- 三个原生模块的 node --check、vNext source contract、生成 freshness、协议校验及两个仓库
  的 git diff --check 通过。TraceLens 类型检查、Web 构建、服务端编译通过。

重跑关键回归：

```powershell
# workflow-system 仓库
node --test --test-concurrency=2 test/vnext-task-state.test.mjs test/vnext-task-management.test.mjs test/vnext-task-display.test.mjs test/vnext-task-state-checkpoint.test.mjs

# TraceLens 仓库
$env:TRACELENS_RUNTIME_SOURCE = 'E:/coding/vibe-coding-workflow-system/runtime/vnext/support'
npx vitest run tests/runtime-state.test.ts tests/runtime-state-ui.test.tsx tests/requirement-work.test.ts --maxWorkers=2
npx vitest run tests/product-hierarchy.test.tsx tests/runtime-state-ui.test.tsx --maxWorkers=2
npm run build
```

这是按安装后的 Skill 顺序串接真实组件的隔离验收，没有进行无人值守模型自动选择／触发
Skill 的实验，不认证真实手机或业务功能。未运行 test:workflow-all，也未迁移真实项目旧数据。
以上是第五步当时的交付边界。后续第六步见 [旧数据副本迁移记录](task-state-migration-validation.md)；
第七步正式发行与真实目标升级尚未执行。
