# C01–C03 修后复审：两个边界发现

日期：2026-10-06。分支 `codex/maintain-project-v1`，实际 HEAD
`20ba0275270493b94b4f02eca33cc3b8c38b198d`；审查对象为未提交的本地 0.24.1
候选，helper SHA `cc4ebd6af391d43e601d499404efa88d3e5b2469581edca6295ff919d24d2387`。
本次仅做源码只读审查、隔离验证和审查记录；产品源码、产物、权威文档及旧审查不改写。

## 结论与原覆盖关系

原 F01–F06/R01–R04、C01 未知字段保护、C02 唯一既有 active 关系、C03 坏邻项的
已覆盖分支仍通过。但本次补充核对发现两个合法维护误拒绝：一个由 C03 分隔符调整引入，
另一个是 C02 对未变关系的修复遗漏。它们不是两个新的业务状态，也不构成用户开发准入。
合法替代路径实际可用，不能以一次 helper 失败否决用户明确的新增或范围调整。

| Finding | 具体触发与原行为 | 当前影响和位置 | 修复方向 |
| --- | --- | --- | --- |
| D01，P2，新增回归 | 完全可用的需求最后是闭合 HTML table，文件仅一个末尾 LF；旧 20ba 和本次修前三项的二进制 append 都 saved。原文读取无诊断。 | writer.ts:151 复用末尾 LF 而不补 Markdown 分隔空行，新根标题被归入旧 HTML 块；当前 append failed/BODY_BOUNDARY，新增项未保存，原文件不变。 | 候选生成保留合法 Markdown 根边界；不能只按 EOF 是否有行尾判断，不禁用原已支持 HTML，不削弱正文边界检查或坏邻项原字节保护。 |
| D02，P2，C02 遗留回归 | 同一 owner 有 dismissed 历史和既有 active 关系，active ID 在列表重复；本次不改 links/task_bindings，仅把 scope 改 planned。旧 20ba saved；条目仍 usable，重复只是 warning。 | writer.ts:201–202 将 matches.length!=1 当作激活，调用方在关系字段未变时仍检查；当前局部/整文件均 failed/DISMISSED_RELATION。对 bindings 同样复现。 | 针对实际字段/关系变更检查历史；原未改的重复记录保留诊断，不让无关字段更新依赖先清理这些记录，不借机删除历史或伪造新依据。 |

D01 是既有受支持文档的兼容回归，不是要求新增任意 Markdown 兼容。D02 不是要求自动
选择/修改重复关联；相反，正常范围维护应保留重复记录原值与 warning，而不重新作关联审批。
两项失败都只影响本次未保存操作，没有新增 task 状态、审批、维护 gate 或全项目禁令。

[本次审查记录](../../../../.workflow-system/records/events/key-bc1faf91d3630c0bd56c500c93e4652c006f3ea5dd09c9b265f4f4c5610c1900.json)
已 recorded、association=applied。[回读](summary.json)确认最新 verdict=findings、D01/D02
均保留，上一轮范围 clean 原文未改。源任务仍 draft，CURRENT_TASK 原字节不变；展示投影
仍 partial/drift，不以覆盖旧展示来抹掉缺口。本次审查来源为 self-review。

## 实际证据

本次重新运行 `bun test test/product-maintenance.test.ts test/product-maintenance-install.test.ts
test/workflow-vnext-source.test.ts`：**51 pass / 0 fail / 775 assertions**，见
[回归](regressions.txt)。这是本次真实运行结果，不能覆盖新反例而宣布整体 clean。

[Node 对照](results.json)在实际 20ba、修前三项和当前三套二进制分别取得原文/read、apply
和保存后/read。8 类场景共 24 组观察，输入、前后字节、诊断和可用条目全部保留；输出见
[简要探针](probes.txt)。脚本 exit0 只说明证据已收集，不是整体 PASS。

D01 对照：闭合 table 后有空行可 append；普通正文单 LF 可 append；精确合法完整候选
补足 HTML 分隔空行后能保存新条目且保留原业务内容。原 helper 新增/当前 helper 失败的
差异仅为追加分隔策略，不是并发、权限、缺失身份或原条目结构错误。

D02 对照：已有 active 使用不同 ID 时当前 scope 更新可保存。重复 active ID 不变则失败，
links 局部/整文件及 bindings 均同样；原文件保持不变，旧版本可以保存。[普通编辑恢复](fallback.txt)
在同一隔离失败夹具内保存旧原文、检查候选格式、重新核对读版本后，只改 scope 为 planned；
links 和正文原值保留，重复 warning 保留。该结果是宿主普通编辑方法可用，不是 helper
apply 已修好或 Agent 每次都会自动正确恢复。

当前源码 helper 与上轮实际安装目录 helper SHA 相同，离线 reader 仍为
`8b923e073a8cc27c8bf8cd8c0524980df6082525f8d05fb402d239ae5179de2a`，与离线目录一致。
未重建、升级旧候选目录、修改真实项目、提交、推送、发布或部署。`git diff --check` 通过。

## 范围和限制

同宿主自审，不是独立或跨模型审查。确定性合成夹具不替代真实宿主 Agent 的业务语义、
恢复遵从、真实项目/硬件/TraceLens UI 验收。未重演 S01–S13，没有运行完整 workflow/
任务服务套件、Linux/最低 Node20 或 npm/tgz 检查；本次没有新构建/重新验证真实版本升级。
原正确保存/失败结果和旧范围 clean verdict 均作为历史保留；新增审查记录 findings 明确
绑定实际修后执行。review 本身不执行修复、采用计划、结束步骤或关闭源任务。

探针复现需将本目录 probes.ts 放到源码 `.tmp/post-c-p2-review/probes.ts`，按文件内三个
已存在二进制路径运行；fallback.cjs 使用刚收集的失败夹具及 results.json，不应作为对真实
业务文件的自动编辑器。所有目标 helper 由 Node 执行，源码探针由 Bun 组织。
