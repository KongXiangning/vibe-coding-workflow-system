# vNext 逐点结构契约修复与验证

日期：2026-10-21。范围为本源码仓库的 vNext 生产、静态读取和本地分发产物；
TraceLens 接入留在后续阶段，未修改 LawAgent 或 TraceLens 文件。

## 问题与变更

原维护指引只要求报告覆盖功能点，模板没有逐点结构，helper 不检查正文表格；
TraceLens 又有独立的表头白名单。TASK-824 和 TASK-825 都曾保存和选中成功，
但新报告的自然语言表头不能被页面识别，逐点结构问题只能在展示后被发现。

新增 `vnext-functional-points/v1`：

- `functional-points.ts` 是生产与消费共用的纯解析实现；固定标准列与旧别名映射，
  保留原字段、原行和定位，不推导实现或业务验收结论。
- 生成 ASSESSMENT 模板使用同一标准列；维护指引、文档契约和使用指南要求一点一条
  主记录，未覆盖点写明原因，不合并编号、不用保存或范围选择成功代替结构检查。
- read、候选 check、apply 文件回执和离线读取返回独立的 functional_points。
  区分 absent、unrecognized、partial、parsed；覆盖分 complete、incomplete、unavailable。
  漏号、重号、合并编号、未知编号和无法映射字段有明确 warning，不改变历史可用性、
  业务结论、定义摘要算法或任务生命周期。
- 构建和分发包含契约说明、标准模板和无外部依赖的 Node ESM `functional-points.js`。
  新指引声明该契约时，包校验要求三个资产齐全；旧指引的包继续兼容。

## 真实反例

原件位置和整份文件 SHA-256 随 `test/fixtures/product-points` 摘录保留。
测试不依赖其他工作区；不是重新执行业务验证或重新判定原交付结论。

| 原报告 | 新读取结果 | 保留的结构缺口 |
| --- | --- | --- |
| TASK-824 司法 | 旧表头可映射，3 行主记录；partial/incomplete | F4 重复；F1/F2/F3/F5 没有主记录 |
| TASK-825 司法 | 旧表头及成果/边界可映射；6 行，parsed/complete | 无逐点结构缺口，业务结论不变 |
| TASK-825 投影 | 旧表头可映射；4 行，partial/incomplete | 合并编号不自动分配；仅 F10 有唯一编号主记录 |

另用最终构建的 Node helper 对 LawAgent 两份完整修复前报告做只读候选 check，
与当前实际需求六点／十点清单核对，结果与上表相符。TASK-824 的相邻 F4-M1…M10
验收矩阵不计为功能点，不误报为无法识别的逐点表格。原件、当前报告、需求及 PRODUCT
在操作前后 SHA-256 一致；只读检查没有写入项目或执行其业务命令。

## 实际验证

- `bun run test:product-maintenance`：195 pass、0 fail，覆盖八个产品维护测试文件。
  包含旧格式、范围选择、证据保留、局部写入、并发及本次功能点回归。
- `bun test --timeout 45000 test/product-maintenance-install.test.ts`：6 pass、0 fail。
  包含隔离安装、旧版升级、目标自有字节保全，以及无 node_modules 的共用解析器消费。
- 最后收紧 F4-M1 验收编号识别并补入真实矩阵后，重新构建并复跑功能点定向测试：
  19 pass、0 fail；重建本地分发，再复跑新安装消费用例：1 pass、0 fail。
- `gen:all`、`validate:protocol`、`validate:freshness`、`validate:vnext-source`、
  `workflow:health --root .` 与 `git diff --check` 通过。
- 用 simplify 方法自查新增代码，合并重复的评估响应包装，保留显式编号匹配和诊断分支；
  这是实施者自查，不冒称独立审查。

本地候选保持软件版本 0.24.16，未发布新版本、提交、推送或升级业务项目。
未运行 test:workflow-all；本轮验证不代表 TraceLens 页面已更新或跨平台发布验收。
后续 TraceLens 应复用共用契约，显示结构状态及原文诊断，保留原报告选择和业务边界。
