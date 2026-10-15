# close-task 范围化交付对账修复与验证

日期：2026-10-16。范围：当前 workflow-system 源码及隔离合成项目；未发布版本或升级业务项目。

## 缺口与修复

原入口允许将“完成局部评价”理解为追加旧进展摘要，未明确要求读取共享对账规则、核对当前功能点、保存可选择的范围报告，或在缺声明／报告时持久保留具体待处理项。现有 helper 已将缺范围或缺适用报告读为 undetermined；本轮修复宿主 Skill 的执行与结果表述，不把语义判断塞进 Runtime close。

- close-task 先保存真实关闭并回读，然后在维护启用、授权覆盖且无适用延期时，同次完成局部对账。
- 对照当前需求正文及验收，保留任务交付切片、功能点、对象／版本／输入、实施与验证依据、已知未交付和未知部分；旧表没有的新功能点仍须纳入。
- 有声明和可用依据时，保存或复用独立范围 Assessment，并回读报告及范围选择。undetermined 可以如实表达评估过的证据局限，不等于没有做评价，也不等于产品交付完成。
- 缺少声明／适用评价或实际延期／保存失败时，在收口报告或获授权维护位置保存 Task／关闭引用、需求／功能点、已知目标及声明／报告位置、对象与证据、原因和下一维护动作；不可写则返回未保存位置及原因。
- 只追加进展摘要、pending_sources、获得 clean 或保存 close，均不能宣称范围对账或管理闭环完成。未完成的评价明确报告为“任务已关闭；该范围交付对账待处理”。

共享执行细节位于 `runtime/vnext/support/product-maintenance/references/reconcile.md`，安装后位于 `.workflow-system/runtime/support/product-maintenance/references/reconcile.md`。入口模板与使用指南引用同一规则；不新增命令、Schema、Runtime 字段或中央待办库。

## 自动化验证

| 检查 | 本轮结果与边界 |
| --- | --- |
| `bun test test/product-maintenance-reconciliation.test.ts` | 7 pass、0 fail、65 expect；其中新增两项用真实 Node assistance CLI 关闭合成任务，再追加旧版进展并保存待处理位置。缺目标范围／适用报告仍分别为 scope-unavailable／no-applicable-report，结论 undetermined；旧评价元数据、关闭事件原字节及任务 closed 保持，未新增测试事实或重放任务操作。 |
| `bun test test/product-maintenance-v3.test.ts` | 39 pass、0 fail、392 expect；覆盖独立报告、目标范围／对象选择、旧格式和证据适用边界，包含源码及既有 Node bundle 路径。 |
| `bun run validate:vnext-source` 与 `bun test test/workflow-vnext-source.test.ts` | 源契约通过；19 pass、0 fail、115 expect，未扩大入口／写入契约。 |
| `bun run validate:protocol`、`bun run validate:freshness` | 均通过，现有生成物 fresh；未手改生成文件。 |
| `bun run workflow:health --root .` | OK，协议及生成新鲜度正常。 |
| 临时分发构建与隔离安装 | 构建成功，安装返回 installed；安装后的 close-task 技能与共享 reconcile 引用逐字节匹配源码。仅临时目录，不是目标业务项目升级。 |

新增回归最初在 Bun 进程内直接调用原生 assistance 时遇到 ENOENT，未进入预期断言；改为其约定的 Node CLI 后，两项及原五项全部通过。本轮没有修补或认证 Bun 执行原生管理服务。

## 隔离宿主行为验证

依 skill-creator 的 Independent Forward-Testing 方法，另一代理未获得预期答案，仅收到两个合成项目、各自 REQUEST 与更新后的项目内技能，实际完成关闭、评价／待处理记录及回读。输入均明确禁止新业务测试、修改需求／目标、提交及启动下一任务。

| 合成场景 | 实际观察 |
| --- | --- |
| alpha：任务只交付F1，当前目标声明覆盖F1＋F2；只有旧版进展评价 | 保存独立v3 `AS-CLOSE-MD-PDF`；helper apply=saved，范围选择实际选中该报告，conclusion=undetermined、reasons=[]。报告保留F1合成成果、F2未知，未从关闭或clean推导满足。 |
| beta：同样的任务与功能点，但目标 `assessment_scopes=[]` | 仍保存关闭；helper选择为undetermined、assessment_id=null、scope-unavailable。收口报告实际保存并回读需求／功能点、缺失声明、Task／close、对象／证据及后续动作，明确产品交付对账待处理。未补造scope或报告已完成评价。 |

两个项目最终均为closed、P1 finished、无当前／下一任务或步骤、cache/display current、health consistent；需求、目标及旧进展经Git比对未变。没有重开、重跑业务命令、提交或启动下一任务。alpha的undetermined是已执行评价的结果；beta是缺范围导致正式评价待处理，两种情况分开报告。

行为检查也提示空的直接写入边界与授权文档子流程容易混淆；入口现已明确报告写入使用共享maintain-project文档边界和helper，不授予业务实现修改权限。旧Assessment模板仍为v2，本次独立评价按明确引用的契约第10节保存v3，不迁移或改写旧报告。

## 非阻塞与交付边界

关闭、报告保存、当前范围选择及待处理项分别报告。缺评价不撤销关闭，不强制重开任务、创建修复任务、重跑业务测试、清空无关历史 pending 或抢占父任务续接焦点。纯 Runtime close 仍只记录事实；用户只读／延期／暂停维护的选择继续有效。

本轮未执行 `test:workflow-all`，未提交／推送／部署，未改 LawAgent 的任务和产品文档。自动化断言与隔离行为观察均不保证所有宿主／模型一定遵循指引，也不认证真实业务功能。
