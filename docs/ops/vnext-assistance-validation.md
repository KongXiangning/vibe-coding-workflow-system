# vNext 辅助型 Runtime：交付与有限验证

## 一次确认规则增量（基线 1f2d7b0f）

目标：不止审批，对所有有实质后果的流程偏离进行一次知情确认；用户确认后执行所选
动作，而非重新进入 Runtime 审批。纯记录/读取、技术元数据和索引问题不触发确认。
修改范围：共享协议、11 个 Skill、API 记录惯例、产品设计及本文件/AGENTS 入口提醒。
没有改变 assistance.mjs、kernel、完成命令、schema、版本号或打包器；没有新增测试声明。

### 本轮实际检查

环境：Node.js v22.16.0；仅持有与 GitHub 指定基线逐文件 SHA 匹配的源码参考，不是完整检出。

- `node --test test/vnext-assistance.test.mjs`：6 pass、0 fail，复用原有测试，文件未修改。
- 临时隔离项目决定/结果回读：通过。破损旧任务下保存决定，审计变化后相同记录重放，
  find/read 找回原话及作用范围，关联 step-disposition，失败报告和旧投影均保持原样。
  这是既有存储能力的冒烟检查，不是模型是否会提问或是否遵从决定的验证。
- 11 个 Skill YAML 与基线逐项相同，协议 YAML 可解析；无新增 mode、必填确认字段或门禁。
- `git diff --check`：通过。临时检查脚本不加入仓库，不为每条说明新增永久用例。

### 交互验收示例（仅静态规则核对，尚未运行 Agent 实测）

| 用户意图/情形 | 期望 |
| --- | --- |
| 完成步骤，但有原约定审查/检查尚未完成 | 汇总已知后果一次询问，确认后记录结束；审查和失败不改为通过 |
| 已明确“知道未审查，仍结束 S1” | 不再追问；不自动开始 S2、关闭任务或提交 |
| 调整计划/范围/验收/验证选择或原有顺序 | 只确认未明确的实质变化；确认后实施选择，不制造 replan/waiver 通行证 |
| 暂停、恢复、替换或关闭未完成工作 | 按实际后果确认，不要求先恢复 active/clean |
| 同一对象/动作/后果，仅新增审计或换会话 | 复用能够找回且适用的决定，不因 revision/TTL 过期 |
| 多个已知缺口或新的重要后果 | 已知缺口合并询问；后来只为新的实质变化再次确认 |
| 旧证据过期、读取失败或索引异常 | 不审批、不伪造事实；报告缺口，继续独立已授权工作 |
| 用户未回复、撤销或拒绝 | 不执行该偏离；不把计划中的问题保存为已批准决定 |

未运行 Agent 交互评测、Bun source validator/测试、分发构建/安装、全量 Runtime 或
`test:workflow-all`。不得把上述服务检查称为“所有模型必定二次确认”。
后续只在实际有安装/模板接入疑问时执行对应检查；不要因本次 Skill 修改自动扩测。
源码落库状态以实际提交/交付清单为准；没有发布版本或升级业务项目。

## 初次辅助服务交付记录

基线为 `4fdc7af22d2136a9a18df1555dd2d99d8b430bcc`（0.22.1）。
本次交付包含实际服务源码、11 个 Skill 模板、协议、打包接入、设计与定向测试。
初次交付时 GitHub 写入被工具拒绝，随后用户已将源码包以
`1f2d7b0f0170715af92a80af906f5d1d3d47543d` 提交推送。以下初次环境和结果保留为历史记录，
不代表最新规则已部署；本次也不发布或升级业务项目。
源码文件在交付包 `source/` 下，按仓库相对路径排列；不是生成补丁的维护 Python。

本地参考目录并非整个最新仓库的完整检出，不得用于全仓库构建验证。交付范围内已有文件
以 GitHub 指定基线的 blob SHA 核对；新增文件无旧版本。未纳入交付的本地参考文件
不随包发送，不用于声称当前仓库完整通过。`SOURCE_MANIFEST.json` 标明文件及基线。

## 实际实施范围

- 原生 `runtime/vnext/support/assistance.mjs`：context / record / snapshot / read / find。
- 原始报告独立保存到 `.workflow-system/records`；旧 CURRENT_TASK、Task Store 和历史原样保留。
- 11 个公开 Skill 和 WORKFLOW_PROTOCOL 改为辅助接口优先；不先修复旧准入内核。
- 原分发生成器增加服务及 API 文档两个正式 artifact，记录目录不归安装器所有。
- 软件升级不再验证当前任务状态；原安装归属、文件漂移、锁和原子发布仍保留。现有两条
  升级场景改为检查草稿/不可读任务及 journal 原样保留，未新增升级测试声明。
- source validator 取消强制旧恢复驱动及跨入口停止的正文门槛；保留结构、入口和权限校验。
- 现有 source 测试去掉四项过时正文/流程断言，其余保持结构验证；现有单条安装场景增加
  “未 bootstrap 也可保存失败观察”的接入断言，不新建安装测试套件。

旧 kernel 和专用事务没有删除，也没有把它们的 fail 批量改成 success。它们不再是新服务
或默认 Skill 的依赖，但显式调用旧接口仍可能返回原有错误。这不代表旧接口已经全部改成
非阻塞。新 journal 记录计划/结果/处置，不自动把旧严格投影同步成新的 verified 状态。

## 已执行的检查

环境：Node.js v22.16.0，隔离临时项目；无 Bun 项目依赖安装。

```sh
node --check runtime/vnext/support/assistance.mjs
node --test test/vnext-assistance.test.mjs
```

结果：**6 pass，0 fail**。原始输出见交付包 `evidence/node-tests.tap`。

| 场景 | 实际观察 |
| --- | --- |
| 旧活跃状态损坏 | 失败报告、缺失附件说明与用户终止观察仍可保存/读取/检索；旧 CURRENT_TASK 字节不变 |
| 历史证据 | 同名当前文件改变后仍读取旧 hash 对应内容；自定义 workflow home 的旧 blob 可读；损坏对象如实报错，不妨碍新记录 |
| 相同/冲突重放 | 相同输入复用原记录、不重新抓取附件；不同输入保留为冲突新观察；旧记录损坏也不会被新观察覆盖 |
| 大文件及分页 | 2 MiB 对象可保存；跨 64 KiB 边界及文件末尾的字面查询可以分页找到 |
| I/O 边界 | 路径穿越和 .git 附件不被读取，原始报告仍保存，用户文件未被覆盖 |
| 原生 CLI 与并发 | 仅将模块复制到安装位置即可执行，无 kernel/依赖；并发相同 key 只形成一条报告；一次读取失败不会影响后续记录 |

最后一项是**模块复制后的 CLI 冒烟**，不是完整 npm/tgz 安装验收。

同时执行五个变更 TypeScript 文件的解析检查及模板 YAML/结构静态核对，未报告语法问题。
这不是项目完整类型检查，不是运行 `validate:vnext-source`，也不是 Bun 测试通过证明。

## 明确未执行

未执行全仓库构建、完整 TypeScript 类型检查、Bun source 测试、真实分发安装/升级、
`test:workflow-all`、整个 Runtime 测试组或目标项目部署。现有安装测试已接入新场景，
但本地没有执行它。没有重建或修改旧 `runtime/vnext/dist/cli.js`：新入口是直接执行的
原生 `.mjs`，打包接入已修改，分发产物仍需在完整源码仓库生成。

## 引入与有限验证

将交付包的 `source/` 文件引入完整源码仓库前，先核对 `SOURCE_MANIFEST.json` 中的
基线文件 SHA。已有其他修改时做常规合并，不覆盖或重置用户改动。没有必要重跑维护 Python。

先查看实际 diff，并确认只有清单中的源码、模板和文档变化。随后限定于：

```sh
node --test test/vnext-assistance.test.mjs
bun run validate:vnext-source
bun test test/workflow-vnext-source.test.ts
bun run build:vibe-governance-distribution
bun test test/vibe-governance-distribution.test.ts --test-name-pattern 'fresh Node install promotes complete software and leaves governance unbootstrapped|vNext upgrade preserves an unconfirmed or unreadable task'
git diff --check
```

这里没有要求先执行全量 Runtime。若一个定向检查失败，先判断是接入缺陷、旧文案预期还是
环境问题，不自动扩测，不为旧测试恢复必须 preflight、run-entry、审查通过才能记录的规则。
分发构建失败不能被标为已安装；日常服务调用失败也不能被标为开发权限不足。

源码提交、分发发布和业务项目升级是不同动作。只有实际完成相应动作后才报告其完成状态。
新旧数据关联/投影对账可后续单独处理，不能成为开始使用辅助接口或继续开发的前置条件。
