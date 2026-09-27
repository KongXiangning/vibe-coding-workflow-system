# vNext：测试维护记录

## 范围与依据

本次基于 `docs/product/vnext-authorized-intent.md` 复核维护脚本中的 PRUNE 候选，
只精简测试及普通指导语的逐字校验。上一阶段
`45498d172131ef1666396c2763567b28817ec15a` 的 repair 兼容与
restore 完成保护原样保留；未修改 `runtime/vnext/src/**` 或 Runtime dist。
未执行维护 Python 的 `--apply`，且已删除不再使用的捆绑脚本。

删除标准是独立行为价值，不以预定数量为目标。保留身份与权限、事实和完成资格、
幂等、原子提交、崩溃恢复、历史血缘和用户文件保护的测试。旧的流程阻塞预期、
仅比对文案的断言和重复输入排列不继续维护。恢复 E2E 仍使用独立的安装目录、
任务和证据；未改变产品或业务项目。

## 实际删减

| 文件 | 修改前注册场景 | 修改后 | 删除 |
| --- | ---: | ---: | ---: |
| `test/vnext-runtime.test.ts` | 237 | 224 | 13 |
| `test/workflow-vnext-source.test.ts` | 31 | 22 | 9 |
| `test/gen-workflow-docs.test.ts` | 24 | 12 | 12 |
| `test/gen-workflow-skills.test.ts` | 29 | 25 | 4 |
| `test/workflow-core.test.ts` | 85 | 62 | 23 |
| `test/vnext-task-recovery-e2e.test.ts` | 9 | 5 | 4 |
| **合计** | **415** | **350** | **65** |

六个文件共删除 61 个具名测试及 4 个参数化安装场景。没有使用 skip、
隐藏选择器或把多个原测试合并成一个循环来压低计数。恢复 E2E 保留
`full-chain`、`shared-evidence`、`reverse-interleaved`、
`restore-retry` 和真实 0.18.7 升级场景；删去的四条重复安装排列是
`first-restore`、`same-report`、`failure-budget`、`interleaved`。

## 保留的保护与取舍

- `restore-retry` 包含首次真实恢复、阻塞后重试、旧 attempt 凭据不能完成、
  损坏凭据不能完成、审查后目标变化不能完成且不得覆盖新内容。
  `shared-evidence` 保留共享反证的独立身份；`reverse-interleaved` 保留
  同报告交错纠正、历史缺失及损坏时的拒绝。执行重试预算仍由保留的 Runtime
  `retry-step` 上限场景保护。删去独立安装层的四轮预算排列后，不声称它在
  安装链路上仍有同样深度的自动覆盖。
- Runtime 保留原始任务与 Task Basis、preflight 身份、真实执行登记、
  repair 验证、用户决定、重复消费、归档回放、事务回滚、恢复凭据和 scope
  继承的检查。删去的 STATUS 特定文案排列由保留的无关内容保留及投影修复场景
  代表；重复 Lesson 去重排列由保留的可见记录与复用证明场景代表。
  旧 `blocked_by_replan` 和直接 replan 阻塞用例不再锁定与授权意图相冲突的流程。
- source 校验继续检查封闭目录、mode、entry 元数据、能力与 Runtime 绑定、
  写入边界、公开路由及跨公开入口的终止边界。移除四组普通指导语 substring
  列表、恢复指导语词表及旧 mode 的正文词语禁令。旧 mode 仍由封闭 mode 集
  拒绝。保留的 source 测试直接变异 review-draft 的权限 capability 和写边界。
- 生成文档与 Skill 测试继续检查文件集合、占位符、任务身份字段、路径语法、
  读写冲突、handoff、暂停/中断恢复包及危险操作边界。
  `workflow-core` 保留原子回滚、生成目录隔离、路径权限语法和错误分类。
  已删除的简单值转换排列仍由保留的生成结果与结构校验间接使用，但不声称逐个
  分支仍被单元测试覆盖。

## 实际验证

- `bun test test/workflow-vnext-source.test.ts test/gen-workflow-docs.test.ts test/gen-workflow-skills.test.ts test/workflow-core.test.ts`：
  首次 120 pass、1 fail。失败是已移除文案校验对应的旧预期；改为权限
  capability 与只读写边界断言后重跑，121 pass、0 fail。
- `bun test test/vnext-task-recovery-e2e.test.ts --test-name-pattern 'fixed tgz recovery: (restore-retry|shared-evidence)'`：
  2 pass、0 fail、3 filtered out。
- `bun run validate:vnext-source`：通过（Phase 2；8 个 daily entry、1 个
  administrative entry、2 个 expert entry、27 个 capability、11 个 Runtime operation）。
- `git diff --check`：通过。

本次未运行 `test:workflow-all`、整个 Runtime 组或其他测试。Runtime
测试文件的删减已静态复核，但未在本次执行，不能把保留用例列为本次通过证明。
