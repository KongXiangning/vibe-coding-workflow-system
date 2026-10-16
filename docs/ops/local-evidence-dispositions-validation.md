# 局部证据处置与 TraceLens 变更聚合验证

日期：2026-10-15。范围为 workflow-system 与 TraceLens 本地源码、本地产物和临时合成项目。保留开始前的未提交修改；未改 LawAgent 的任务、需求或报告，未提交、发布或升级业务项目。

## 行为与交付

- 普通成功步骤只保存 Task／Step 执行与测试证据，不自动创建需求 pending。实质义务／验收／职责／采用范围变化、新反例和授权阶段评估才局部对账；共享 Task 或调用领域工具只提供定位线索。
- v6 可选 `assessment.evidence_dispositions` 通过现有 read／apply 保存和读取。固定来源、局部范围、对象、原报告及依赖来源未变时复用；原 pending 保留历史。新反例、来源变化、原证据删除／替换、延期和冲突保持待处理，不生成审批令牌、PASS 或新流程动作。
- 同目标其他需求的范围声明增删改不会重开本范围；目标共同正文、关系、本范围和目标自评仍受保护。旧定义依据不可恢复、报告冲突等原有检查不被豁免。
- TraceLens 消费同一 v6 Schema 与算法；明确区分范围变化、反例、交付证据、来源变化、报告／处置冲突、元数据及旧材料未分类，按精确来源合并调查，保留每份报告的独立目标／范围／对象、原结论和入口。

## 已完成验证

| 层次 | 结果 |
| --- | --- |
| 产品维护源码及 Node bundle | `bun run test:product-maintenance`：149 通过、0 失败，含 29 个处置及预算场景，原 v1–v5 Schema 字节一致 |
| TraceLens | `npm test -- --maxWorkers=4`：44 文件、470 通过；类型检查与生产构建通过，含真实快照处置、展示与范围分组回归 |
| 跨消费者 | `bun run scripts/check-evidence-dispositions-consumers.ts E:/coding/tracelens`：22 个相同夹具，生产源码／Node bundle／TraceLens 的 basis、结论、选择、原因、有效 pending、handled 与复用状态一致，读取不改写报告 |
| 隔离安装 | 本地构建分发包后 `bun test test/product-maintenance-install.test.ts`：5 通过、348 条断言；含新安装的 v6 Node 程序实际保存并复用精确处置，原 pending 和读前字节保持，旧 v4/v5 与升级保留场景通过 |
| 浏览器 | `node tests/overview-browser.mjs` 通过：同一来源跨需求合并分组、逐报告范围／原结论与来源入口、复制及剪贴板失败回退、桌面与移动宽度均可用；本轮产物位于 TraceLens `output/playwright/overview-5ZIYAS` |
| 源码规则 | protocol、freshness、vnext-source 与 workflow health 通过；未运行 test:workflow-all |

独立只读检查发现的“全 Goal 摘要导致其他范围变化重开”和“v6 详情入口遗漏”已修复并通过复审。保留原报告来源集合可追加的基线比较，防止删除或替换证据仍复用；不把该集合检查描述为全部旧业务证据的当前适用性认证。

TASK-022 的实施、限定范围的独立源码复审与步骤处置已通过 assistance 保存并关联，回读为 closed。开始前已有的 CURRENT_TASK 用户修改／展示漂移保留，因此展示发布仍报告 partial；实时 task-status 可读到已保存事实，不覆盖旧展示，也不把这项维护缺口当作代码交付门槛。

首次 TraceLens 全量测试有两个旧断言需要随新增 v6／来源聚合更新，以及一个并发运行下超过 5 秒的输出保护测试；调整正确预期并使用 4 个测试 worker 后全部 453 项通过，未放宽安全断言或测试超时。最后的局部代码简化及来源原因聚合后，6 文件、100 项定向测试及生产构建再次通过。隔离安装中的旧离线版本断言已随当前 v6 契约更新，同时继续断言兼容 v5；新增安装场景与旧场景合计 5 项全部通过。源码、合成安装、真实业务升级分别解释。

## 三项审查问题修复与再次审查

本轮仅修复上一轮确认的三项问题，没有增加 schema 必填字段、审批、确认步骤或普通开发门槛。

- 详情、工作项和需求摘要使用 `assessmentEvidence` 的有效 pending，与概览和导出一致。原始 pending 留作“已处理的历史材料”，正常报告概况即可展开处置原因、适用范围、交付对象、原处置时间及来源；本次快照复用不冒充新的报告检查时间。延期、冲突、来源变化和新反例仍显示待核对。全套测试捕获的旧报告适用性提示遗漏也已按有效 pending 恢复，未通过放宽旧断言掩盖。
- `scope-definition-changed` 增加可选观察元数据；只有需求、目标、scope 和变化前后 coverage 身份完整一致才共享分组。换行按既有定义语义规范化；不同身份、不同变化版本、缺失旧 coverage 或旧 issue 元数据均保持独立。每份原报告的 subject、结论、来源及原因保留，未改变选择器判定。
- Catalog 在分析前保存有效预算；诊断、详情、选择、直接来源读取及 `resolve_sources` 继承该预算。证据观察只在单次 Catalog 内共享，报告 metadata／body／basis 或预算改变时重判，下次请求重新读取来源。默认仍为 4 MiB。

新增回归包含：15 KiB 预算读取 20 KiB 带 locator 来源、显式预算允许超过默认 4 MiB 的来源、跨请求文件变化、同 Catalog 预算变化、候选 metadata／body／pending 变化；范围变更跨 subject 聚合及防误并；正常报告概况、原字段、当前范围、规划摘要与导出的有效 pending 一致性。

最终结果：产品维护 149／149，TraceLens 470／470，跨消费者 22／22，隔离安装 5／5；两仓构建及 protocol、freshness、vnext-source、workflow health、diff check 通过。预算、分组、展示分别由未参与对应实现的代理只读复审，未发现新增 P1／P2；其独立专项分别通过 50、32、126 项测试。未运行 `test:workflow-all`。

真实浏览器验收使用复制样例和独立注册表，未操作 LawAgent：

- `node tests/evidence-presentation-browser.mjs`：已处理时概览和导出为零，普通报告概况保留历史与复用依据；延期后概览、详情、原因弹窗和实际复制导出均为 1 项变更／1 份报告。原文读取字节不变，处置来源可打开并返回报告及同一概览，1440／390 宽度无横向溢出、无页面异常。最终产物：TraceLens `output/playwright/evidence-presentation-63wafH`。
- `node tests/requirement-task-navigation-browser.mjs`：需求与 Task 原有导航通过；产物：TraceLens `output/playwright/requirement-task-navigation-MZ6u69`。
- 原有概览浏览器回归通过项目切换、过滤、记录与来源跳转、返回、复制失败回退及四种宽度布局。已检查本轮新增报告页面截图。

验证边界：上一轮已知的旧 `browser-smoke.mjs` 颜色断言及 `product-browser.mjs` 标题等待问题未纳入本轮通过结果；它们不由本轮三项修复消除。额外 `scoped-browser.mjs` 尝试在夹具入口检查即退出（缺少 `TRACELENS_TEST_INPUT`），没有执行其浏览器场景；其安装样例与独立服务未在本轮重建。以上不等于全站历史页面组合均已穷尽验证，也不等于真实业务项目已升级。

TASK-023 的两步执行、限定范围复审及完成处置均已保存关联，实时查询为 closed；CURRENT_TASK 原有展示漂移继续保留，未将展示发布 partial 隐藏为完整成功。

## 2026-10-17：移除定义核验与整文件字节的耦合

触发案例为 TermLink 的 TASK-20260869：需求文件只增加终端输入需求的任务关联，69 个需求的定义摘要相比该项目 HEAD 均未变化，整文件 SHA 却变化。旧选择器把来源文件 changed 同时当成 definition-unverified，导致共用该文件的范围报告被连带降级。

本轮修改 vNext 的 scoped 选择器：可读且唯一定位的依据条目，其定义算法及摘要与原报告一致时保持定义核验结果；整文件字节变化仍由原 SourceRef 读取接口报告 SOURCE_CHANGED 和 content_is_referenced_bytes=false。其他范围比较同样先验证原目标完整定义，再比较本范围；无关文件字节变化不否定这份定义。报告原哈希、checked_at、结论及 pending 历史不改写。真实定义／范围变化、歧义、缺失、预算限制、反证及固定证据／处置来源的字节核验继续保留。

同步修改执行与维护 Skill 模板、安装指引和文档契约，并重新生成 Node bundle、随包契约及本地分发包。未新增 schema 字段、摘要算法或 Runtime 操作。

验证结果：

- 新增行为回归在修复前的源码及旧 Node bundle 均复现误降级，修复后通过。覆盖 Task 关联、邻项义务变化、展示顺序、CRLF、原目标依据文件的无关变化与真实定义篡改；读取不重写旧报告。
- 产品维护定向测试：7 文件，176 通过、0 失败；保留新反证、处置来源变化、冲突及字节预算测试。
- vNext 源码契约通过；对应源码规则测试 19 通过。重建分发后的 installed v6 Node 用例 1 通过；这是隔离安装验证。
- 使用修复后的源码只读回放 TermLink 的 66 份 AS-CURRENT-20261014 报告：目录 available、覆盖完整，所有选择均无额外 reason，保留各自原四值结论。未改写 TermLink 资料。

本轮仅交付本地 vNext 源码、指引与构建产物，未发布新版本或升级 TermLink。TraceLens 自有选择器尚未修改，不能将本轮结果称为其界面已修复；未执行 test:workflow-all。

## 使用与限制

v6 仅在需要保存局部处置的报告文件显式迁移，不要求全项目迁移。先读取当前 `disposition_basis`，在真实局部判断后连同实际来源、理由和处置通过原 apply 保存，再分别读回报告和选择结果。没有新材料的重复读取不追加处置或更新时间。批量来源未读、维护失败或旧记录缺项不阻止普通开发、提交、步骤结束或关闭。

旧版报告保持原有 pending；本次不自动替 LawAgent 清除上次职责调整的待核对，也不声称其领域需求已经重新验收。是否把本地产物升级到该项目属于另一个交付范围。
