# vNext：repair 兼容修复与高价值测试精简

## 交付状态与适用范围

基线：`f4d14b46f1fdd8de1ad30f576513139c6d0e34c1`，分支：
`codex/evidence-plan-amendment-vnext`。

**本提交交付的是可应用的修改包，不表示 Runtime 源码、测试和 dist 已被修改。**
编辑环境不能直接执行仓库大文件的远端修补，因此使用普通文件提交精确变换脚本。
应用入口为 `scripts/maintenance/apply-repair-review-and-test-pruning.py`。
它默认只预览，`--apply` 才修改列出的九个源码/测试/配置文件；不会运行测试、
构建、提交、推送、发布、升级或修改业务项目。全部变换必须先成功计算，才开始写入。

脚本要求指定基线为当前分支祖先，并逐文件核对基线原文。已完全应用的结果可重入；
其他未提交改动或后续提交改动、冻结登记、符号链接等会停止应用并保留现场。
每个文件使用临时文件替换；这不是多文件崩溃原子事务，不与其他编辑进程并行执行。

本文件固定本次选择，不新建测试准入状态机；不以用例数充当产品正确性证明。

## 1. 两项修复

### 旧 repair 的合法续接

`assertReviewExecutionEligible` 继续接受新的 `in-progress/blocked` 待验证记录，
同时接受历史 `completed + repair-awaiting-verification`。这里的旧 completed
表示修复执行已登记，不是步骤已验收完成。旧记录原样读取，不迁移改写、不重做修复。

既有的后续实际完成记录、步骤身份、真实执行、逻辑改动集及目标一致性校验继续生效。
新执行仍按新状态登记；不会为了兼容恢复“先 completed 才能登记”的错误模型。

扩展现有多 finding repair 场景：使用只读历史表示验证接受、错误步骤拒绝、
非待验证记录拒绝、真实完成后拒绝再次消费。不会新增一套历史 fixture 生成器。
这项定向断言验证兼容读取的准入函数，不冒充完整旧版 repair 安装升级 E2E。

### 恢复资格只在完成阶段验证

保留 `restore-retry` 安装后 CLI 场景，登记和审查完成后再验证：

- 只剩真实旧尝试的完成凭据时，不能完成新尝试；原旧凭据并未删除或伪造。
- 当前完成凭据损坏时，不能完成。
- clean 审查后恢复目标再次变化时，不能完成，而且保留后来写入的文件内容。

三种拒绝都由现有 rejected 辅助函数检查 CURRENT_TASK 不变；恢复测试现场后才允许
合法完成。目标偏移在公开完成入口触发 `REVIEW_TARGET_STALE`，不是声称直接覆盖了
每个内部 artifact 检查分支。删除的登记阶段旧门槛不恢复；报告失败仍可如实登记。

## 2. 保留标准

只因文件名、标题、注释或提示词出现某句话而存在的测试，优先删除。旧预期若没有
独立的行为义务，不为保住用例数量继续修缮。保留以下直接保护用户结果的检查：

| 保留范围 | 保护的实际结果 |
| --- | --- |
| 授权与真实完成 | 范围内操作可继续；越权、错身份、伪造通过不能放行 |
| 执行／审查／终止分离 | repair 可登记，未完成可按用户决定终止，不清理失败历史 |
| 状态与数据完整性 | 并发、崩溃、回滚、凭据复用不损坏用户数据或重复执行 |
| 证据与定义演进 | 同任务证据计划调整、共用反证、迟到结果保留身份和历史 |
| 分发与旧状态兼容 | 少量真实安装链路及旧版升级，不为每个错误组合重复打包 |
| 文档与上下文能力 | 结构、路径、安全读写、生成与实际安装契约，而非普通措辞 |

目录、mode、typed boundary、写入权限等结构校验仍保留。源码契约验证器移除四组
普通指导语 substring 列表及恢复指导语词表，避免测试删了但验证器仍锁死原句。
公开终端的机器边界标识检查仍保留。没有修改 Skill 意图、权限策略或运行时事实校验。

## 3. 实质删除规模

以下数量针对六个经过审查的测试文件，不是整个仓库：

| 文件 | 基线注册用例 | 应用后 | 删除 |
| --- | ---: | ---: | ---: |
| `test/vnext-runtime.test.ts` | 237 | 169 | 68 |
| `test/workflow-vnext-source.test.ts` | 31 | 11 | 20 |
| `test/gen-workflow-docs.test.ts` | 24 | 10 | 14 |
| `test/gen-workflow-skills.test.ts` | 29 | 19 | 10 |
| `test/workflow-core.test.ts` | 85 | 62 | 23 |
| `test/vnext-task-recovery-e2e.test.ts` | 9 | 5 | 4 |
| **合计** | **415** | **276** | **139** |

共删除 135 个具名测试及 4 个参数化安装场景，不使用 skip、不改成隐藏选择器，
也不将多个原测试塞进一个循环来压低计数。精确删除标题以脚本中的 PRUNE 为准。
现有两个场景添加必要断言，不增加新的 test 声明。

Runtime 文件删除集中于重复 disabled-replan、重复元数据/投影校验、STATUS/LESSON
表现形式、深层预算排列，以及已由保留安装链和语义测试代表的重复分发流程。
保留未完成终止、身份/范围、错误证据、原子回滚、真实恢复等主干行为。

**覆盖取舍：**不声称被删测试全部逻辑等价或毫无价值；罕见层数、特定格式、排列和
若干旧表示的自动化覆盖会减少。这是按用户要求，以维护／执行成本换取更小的高价值
回归集。出现具体新风险时再扩展现有行为场景，不因抽象“可能有问题”补回所有排列。
未审查的测试文件不按比例盲删。历史完整保留在 Git，不另藏一份仍需维护的测试副本。

官方 Runtime 组加入此前遗漏的已有 `vnext-entry-runner.test.ts` 与
`vnext-task-metrics.test.ts`，共 8 个现有测试。按基线注册数计算，该组由 302 变为
`302 - 68 + 8 = 242`。这不是声称已经执行并通过了 242 项。

## 4. 降低实际执行成本

恢复 E2E 从 8 个安装参数场景保留 4 个：`full-chain`、`shared-evidence`、
`reverse-interleaved`、`restore-retry`；另保留真实 0.18.7 升级场景。

同一测试进程懒生成一次当前 Runtime tgz，仅复用不可变包。每个场景仍有独立的消费
安装目录、任务、证据和历史；失败后也清理临时工作区。升级场景继续单独取得真正的
旧版包，不能用新包模拟旧版。`VNEXT_RECOVERY_TGZ` 显式覆盖仍可用。

不再为正反方向都重复执行同一长链，不把每个细粒度错误都放到安装层再测一遍。
现有 30 秒 Runtime 组上限不继续增加；不声称删减后已测得某个运行时间或加速比。

## 5. 应用及有限验证

在 workflow-system 源仓库的上述分支执行，不在 LawAgent 等业务项目执行：

```sh
python scripts/maintenance/apply-repair-review-and-test-pruning.py
python scripts/maintenance/apply-repair-review-and-test-pruning.py --apply
bun run build:vnext-runtime
```

第一条是预览，可以直接使用第二条。构建必须用原生成器，不手改 dist。脚本拒绝
原文不匹配时，先对账其他修改，不能删除用户工作树、重置任务或强行应用。

本次优先验证两个受影响场景，以及被删 prose gate 后仍保留的结构检查：

```sh
bun test --timeout 30000 test/vnext-runtime.test.ts --test-name-pattern 'hands multiple review findings across sessions through one bounded repair wave and verification'
bun test test/vnext-task-recovery-e2e.test.ts --test-name-pattern 'fixed tgz recovery: restore-retry'
bun test test/workflow-vnext-source.test.ts test/gen-workflow-docs.test.ts test/gen-workflow-skills.test.ts test/workflow-core.test.ts
bun run validate:vnext-source
git diff --check
```

遇到失败，先判断是否属于保留的真实行为，再决定修实现、调整必要预期或删除无价值
断言；不为全绿恢复旧死锁。不自动启动 `test:workflow-all`，不因每次定向修改从头
重跑整个仓库。最终发布是否需一次更广回归，按最后改动范围决定；分组已通过不能
冒充完整官方脚本退出成功。

## 6. 本次实际检查和未验证项

编辑端检查了 Python 语法、变换锚点和生成 TypeScript 语法；恢复 E2E 原文重建与
远端 blob hash 一致，两个独立变换结果一致。Runtime 大文件的删减锚点来自基线历史
内容及所涉提交差异；最终脚本仍以本地 Git 中的精确 f4d14b46 原文核对后再应用。

没有在编辑端完成仓库依赖安装、完整 TypeScript 类型检查、Runtime 构建、Bun 行为
回归、安装验收或业务项目升级。源码语法检查不能证明行为正确。应用后的完整测试
计数和实际用时也尚未实测，表中为注册项清点和脚本变换的预期。
