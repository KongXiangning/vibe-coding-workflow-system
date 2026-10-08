# 项目规划与持续选取：实施交付证据

日期：2026-10-08。依据为用户附件 `vnext-project-planning-next-step-sol.md`（91 行），不是把附件另存即视为实施。实际开始 HEAD 与远端 `codex/maintain-project-v1` 均为 `84589392b27394cd6fcce16d6029f37faed2b962`，工作区干净；已有本地合并分支据此切至维护分支，未 reset 或覆盖后续工作。交付提交 SHA 由交付包顶层报告列明，避免提交记录自身 SHA 的递归提交。

## 1. 实际改动

- `references/plan.md`：预先规划、无总体 plan 的持续选取、混合策略；按范围切换、实际剩余工作、直接选下一项、无 plan 保存／prepare／TaskBinding、历史及权限边界
- `references/inventory.md`：共享资料充分性及前提候选规则，先复用信息，再核对矛盾和缺口；四类问题、前提性质／满足依据／必要时点／最小复用及旧处置
- `references/reconcile.md` 复用上述规则，并连接部分交付、新需求与旧 PASS 下的范围化后续选择
- 正式 requirements、contract、README、使用指南、验收矩阵及主 Skill 的最小路由同步
- `scripts/product-maintenance-assets.ts` 生成无 plan 与多 plan／跨阶段消费样例；在已有产品及安装测试中补必要结构行为断言
- 从源重建契约副本、样例、Runtime 和分发；未手改生成资产

现有 `read(detail=items)` 和离线输出已经保留所需正文、元数据、数组顺序及覆盖。实际样例与宿主链未暴露新增 Schema／消费者算法的必要缺口，因此没有新增 current_plan_id、排序／策略字段、管理对象、审批流或任务 reducer。TraceLens 交付限于消费约定与样例。

## 2. 源码与确定性检查

最终不同通过用例共 **63 项、1509 个断言**；不将重复运行或独立复审重复选中的用例叠加计数。

| 检查 | 实际结果 | 原始记录 |
|---|---|---|
| 产品源码 + 安装／离线套件 | 39 pass，0 fail，1243 assertions | `checks/product-final.log` |
| vNext source 注册套件 | 19 pass，0 fail，115 assertions | `checks/test-workflow-vnext-source.log` |
| 定向分发：版本一致性、可移植身份、新装、同版本只读／漂移、旧版本升级 | 5 pass，0 fail，151 assertions | `checks/distribution-focused.log` |
| source contract、protocol、freshness | 通过 | `checks/validate-*.log` |
| Runtime／分发正常构建 | 通过 | `checks/build-*-final.log` |
| 最终 45 项维护支持资产／helper 源与安装摘要 | 全部一致 | `checks/final-asset-equality.json` |

每个命令退出码保留在对应 `.exit`。没有默认运行 `test:workflow-all`；未改 Runtime 生命周期或解析／写入器，不将文案规则逐条变成 contains 测试。

提交时纳入此前未跟踪的生成样例和原始日志后，默认 `git diff <基线> HEAD --check` 报 11 处末尾空行：9 份 `newDocument` 生成样例及 2 份原始构建日志。保留生成器与原日志字节；仅排除 `blank-at-eof` 的内容检查通过，没有其他空白错误。两次命令及真实退出码见 `checks/final-*-diff-check.*`；前期只检查已跟踪工作区的通过不覆盖这次最终范围。

## 3. 分发、安装与已知环境问题

最终本地候选仍为未发布的 **0.24.1**：

- bundle：`bundle-629757db81d1bf4288b6180f`
- manifest：`5d9bafc597790d81b6e639418a72e0f6d334b45da6ae2824cc9b145941ef83d7`
- Node helper：`f70c25a6d3ea282805295fb093eaff7b1585e2285a2fee0a4bab51c1af43c17f`
- 交付 tgz：`vibe-governance-0.24.1.tgz`，SHA-256 `45d5ea4d7d2ab8d239ad51843ce001588b05039bb5c8afd619ee5cb8f74d8975`

最终候选新装返回 installed／read_back_verified=true。安装后主 Skill、全部 references、contract、样例和独立 Node helper 可达。初次安装因默认 npm cache 不可写而失败，改用已有授权可写缓存后通过；失败结果仍在 checks，不当作产品已修缺陷。

另实际运行原有 packed npm 用例：包已安装到测试消费者，但 `/tmp/.git` 沙箱锚点使包装源与目标被判同一 Git 根，安全返回 TARGET_ROOT_DENIED。原用例本环境下 **1 fail**，记录为 `checks/distribution-packed.log`，不计入上述 63 项通过。一次错误工作目录导致未匹配测试，单独保留 initial-no-match 记录，也不计为测试运行。

随后用两个实际独立 `git init` 的隔离目录安装同一交付 tgz：正常 guard 返回 allowed=true，CLI installed／read_back_verified=true，已安装 helper 的未启用读取正常。见 `checks/packed-git-roots.txt`、`packed-root-guard.json`、`packed-isolated-install.json`、`packed-node-smoke.json`。未改防护、未删除 `/tmp/.git`；这是独立打包安装 smoke，不能替代原用例的失败事实。

还发现安装目录的 `node_modules/.bin/yaml` 指向已移除的暂存绝对路径。只读核对上轮两个 0.24.1 安装目录也存在该问题，见 `checks/yaml-bin-prior-candidate-observations.json`。本轮未改安装器；主 helper、Node 模块和离线 reader 未受影响。这个既有辅助命令链接问题未在本轮修复，不宣称完整安装器无已知缺陷。

没有发布、部署或向真实业务项目安装。既有“同版本不同内容不能强制覆盖”规则未放宽；此本地候选不应当作可覆盖另一份 0.24.1 的正式升级发行。

## 4. 实际宿主业务验收

两组宿主在真正安装后的隔离合成项目中，先读自然语言输入与已装 Skill／资料，再作决定、调用真实工具、保存并回读。原始输入、决定、请求、结果、UTC 时间、历史字节及状态快照保存在 `host-agent-evidence.zip`；不是把预填业务答案的脚本当作宿主判断。

| 计划要求 | 实际观察及定位 |
|---|---|
| 三种策略、切换、无 plan 直接 prepare | selection 01、03、04：真实 TASK-001 及绑定先于任何 plan；后来预规划全部已知范围，再局部改混合，8 个工作项、原 task 与历史保留 |
| 部分交付后新增／修改需求 | selection 02a／02b：实际一个 provider-ID 成功样例通过；关闭原 task 后增加已退款记录与重查提示，完整需求保留，旧 PASS 仍局部；只保存后续建议 |
| 已有信息、缺口、可选前提、旧否定 | selection 01／05：复用整数分／日志约束，区别 30／45 天矛盾、未读生产资料、幂等未知和可选方向，钱包否定未复活；纯讨论无业务写入 |
| 多计划、跨阶段与部分读取 | selection 06：实际完整 helper／独立离线输出一致；显式选择 PLAN-IMPORT，保留三个独立计划、工作项原顺序与跨阶段覆盖；只读需求文件不冒充全量上下文 |
| 厚基线上的目标转向 | evolution 03 基线先有设计、部分交付、旧 PASS、绑定和待做工作；10／20 将 50% 调为三分之一，再换异常定位目标，保留离线／导出等约束和未同步设计 |
| 旧 PASS／绑定后的需求演进 | evolution 30–70：先拆实施批次，再真拆需求、合并、收紧小数验收、恢复整数原文；当前摘要保持未复验，旧 PASS／绑定／代码／测试／报告保留；80-audit 核对 13 项不变式 |

两组真实任务分别为 `task-a032ed964e2eeb5cedbebc0abf83caf9` 和 `task-1d991d0962e5673c41f5e57b0a869ed9`，仅存在于隔离验收项目。分别实际运行 1 项查询及 3 项整数导入测试；这些是有限合成实现检查，不能称生产支付／发票产品已验证。任务关闭保留未完成／未审查事实，不伪造独立业务审查。

- [规划／资料／消费者宿主结果](selection-result.md)
- [实际消费者解释](consumer-interpretation.md)
- [厚基线／需求演进宿主结果](evolution-result.md)
- [独立实施复审](independent-review.md)
- `host-evidence-manifest.json`：归档内各文件摘要与范围

宿主使用的第一轮候选与最终候选 helper、Skill、plan／inventory／reconcile 资料摘要相同；唯一相关差别为独立审查指出的 contract.selection 措辞，最终构建／新装已修正文案并验证。见 `checks/installed-provenance.json`。源码规则、安装可用性、模型实际判断与消费者展示解释分别取证。

## 5. 未验证与交付边界

未实施／验证 TraceLens 页面，未改 LawAgent、TermLink 或任何真实用户项目。未运行全套 Runtime／全仓库测试、真实生产集成、Windows 原生行为或跨模型重复评测；不能以本次合成业务链推断这些通过。旧报告与历史缺口不被本轮通过数覆盖。

宿主中途暂停后按已有状态继续，未重复 prepare、实现或测试。无关附带安装问题及 packed 用例环境失败已明确保留。源项目的既有 CURRENT_TASK 和记录未修改。交付只有获授权的本地实现、检查、提交及可验证小包；未推送、发布或部署。

next_route: null；本次本地实施与验收收束，发布或真实项目升级需另行授权。
