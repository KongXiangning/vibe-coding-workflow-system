# 逐点记录生产与消费契约

契约标识：`vnext-functional-points/v1`。适用于现有 v1–v6 Assessment 正文，
不改变文档 Schema、评估选择、摘要算法或业务结论。旧报告不需批量迁移。

## 生产格式

在独立详细报告的“交付与验证依据”中使用 GFM 表格：

| 功能点 | 实现判断 | 本次已知交付/保留成果 | 本对象验证与限制 | 剩余、发现与边界 |
| --- | --- | --- | --- | --- |
| F1 原功能名称 | | 实际有据成果或明确未知 | 对象、版本、输入、验证及限制 | 剩余、未知或未覆盖原因 |

以目标需求明确的功能清单为编号依据，一点一条主记录。可写 `REQ-ID/F1 名称`，
不得写 `F1/F3`、`F1–F3` 或在同一单元格列出多个编号；同一点的多个子题写在同一行。
未覆盖的点保留一行并写明原因，不改需求、不缩范围、不伪造已评估/已实现。
“实现判断”可以留空；其他字段记录实际事实或明确未知，不能用 PASS 推导实现状态。
标准模板不是业务事实。目标为 Goal 或没有明确功能清单时，不人为补造 F 编号。

需求点仅取“功能点”“功能点与输入输出”“功能点清单”“功能点拆分”“功能拆分”
或“功能清单”标题下的顶层列表。优先沿用显式 F 编号；旧无编号清单依原顺序取 F1…Fn，
与既有展示约定一致；嵌套列表是原点细节。标题之外的普通段落和验收列表不成为功能点。

## 共用读取接口

随支持文件分发的 `functional-points.js` 是可直接导入的 Node ESM，无外部依赖、
无文件 I/O。消费者复用该实现；不要再维护独立表头白名单。源文件为
`runtime/vnext/src/product-maintenance/functional-points.ts`。

```javascript
import { readRequirementPoints, readAssessmentPoints } from './functional-points.js';
const points = readRequirementPoints(requirement.body, requirement.line);
const result = readAssessmentPoints(report.body, report.target, points, report.line);
```

目标定义未唯一读到或不可信时传 `null`，不得按报告行序猜出预期集合。
接口同时导出 `functionalPointContract`、`standardPointHeaders`、`pointFieldAliases`。
传入 Markdown 条目及其真实起始行即可保留源行定位。加粗、链接、转义竖线按 GFM 解析；
代码块中的示例不参与识别。原始 Markdown 始终留在原文中，解析不改写报告。

helper 的 `read.usable_items[].functional_points` 和离线读取器返回同一结果；
候选 `check` 与 `apply.files[]` 的 `functional_points` 为
`{report_id, path, functional_points}` 数组。`apply` 只报告本次受影响的报告，
成功保存仍须另行回读；跨文件写入仍是逐文件事务。

| 字段 | 含义 |
| --- | --- |
| status=absent | 没有发现逐点表格；不表示需求没有功能点 |
| status=unrecognized | 发现疑似逐点表格，但功能列或 GFM 结构无法识别 |
| status=partial | 已识别部分结构，但有漏号、重号、合并编号、未知字段等诊断 |
| status=parsed | 表格和字段可读取；不代表实现、验证或评估已完成 |
| coverage=complete/incomplete/unavailable | 相对已读需求的结构覆盖；未知定义不称完整 |
| expected_points | 已唯一读取的预期编号；未知为 null |
| missing_points/duplicate_points/unknown_points | 漏号、重复主记录、目标需求不存在的编号 |
| rows | point_id、原始 point_text、源 line、supplementary，以及保留原 label/text 的 fields |
| diagnostics | 可定位的问题代码和说明；helper 另带 path、item_id、warning |

`fields[].field` 为 judgment、implementation、verification、remaining、evidence 或 null。
未知列保留原标签与内容并诊断，不能默默丢失或猜作成果。合并编号、跨需求限定编号、
无法唯一匹配的名称保留原行，point_id=null；不自动复制成果到多个点。
“剩余分类／补充说明／补充分类”标题中的补充表保留 supplementary=true，
必须有唯一主记录，不能代替缺失主记录或制造第二个实现判断。

兼容既有表头及 TASK-824/825 的自然语言别名，例如“当前领域子项／已确认成果／保留边界”
和“原功能点/条款／有据成果／本对象边界”。完整映射由导出的 pointFieldAliases 定义。
也兼容“原功能N”和与已读功能名称唯一对应的行；不做模糊文本匹配。
兼容读取不隐去重复 F4、合并编号或未知覆盖，也不自动修订历史字节。

## 静态检查与边界

`check` 的候选内容替换同路径当前条目，再与本次实际已读的唯一目标需求核对；
`paths` 限制未读到需求时，只检查报告内部结构并返回 coverage=unavailable。
诊断包括 POINT_TABLE_UNRECOGNIZED、POINT_TABLE_EMPTY、POINT_FIELD_UNMAPPED、POINT_FIELD_DUPLICATE、
POINT_FIELDS_MISSING、POINT_ROW_EMPTY、POINT_GROUPED_ID、POINT_ID_UNRECOGNIZED、
POINT_TARGET_MISMATCH、POINT_ID_MISSING、POINT_ID_DUPLICATE、POINT_ID_UNKNOWN、
POINT_SUPPLEMENT_UNRESOLVED、POINT_DEFINITION_CONFLICT、POINT_COVERAGE_UNAVAILABLE、
POINT_RECORDS_ABSENT。

这些是展示结构警告，不使历史条目不可读、不撤销评估结论、不阻止保存原始事实或任务操作。
`status=valid/saved` 与逐点结构结果必须分开报告；不能用退出码、保存、范围选择成功
代替逐点核对。消费者应分别显示“没有逐点记录”和“有表格但格式无法识别”，
并保留原文、具体诊断及已识别部分。结构检查直接调用共用实现，不要求逐次访问浏览器。
业务语义、原结论适用性、需求定义变化与证据充分性继续使用既有机制。
