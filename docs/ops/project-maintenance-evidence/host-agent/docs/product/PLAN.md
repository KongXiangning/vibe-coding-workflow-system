---
{
  "schema": "vnext-product-doc/v2",
  "items": [
    {"id":"PLAN-IMPORT","type":"plan","intent_state":"adopted","targets":[{"target":"REQ-IMPORT","coverage":"导入与后续本地使用"},{"target":"REQ-ERROR","coverage":"错误诊断"}],"work_items":[{"id":"E6A","title":"导入脚本基础","outcome":"提供可执行解析函数及最小有效输入检查","scope":"输入解析与局部错误，排除统计界面","targets":[{"target":"REQ-IMPORT","coverage":"导入脚本"}],"state":"included","origin":"initial"},{"id":"E6B","title":"诊断范围","outcome":"整理并核对错误定位","scope":"错误原因及行号，排除上传","targets":[{"target":"REQ-ERROR","coverage":"本地诊断"}],"state":"included","origin":"initial","depends_on":[{"item_id":"E6A","kind":"order","reason":"先有导入函数再核对诊断"}]},{"id":"E6R","title":"修复正整数 ID 验证","outcome":"空/零/小数输入不导入且提供实际诊断","scope":"已有正整数要求的局部修复，排除多设备和上传","targets":[{"target":"REQ-IMPORT","coverage":"正整数输入边界"},{"target":"REQ-ERROR","coverage":"空 ID 错误原因与行号"}],"state":"included","origin":"added","sources":[{"kind":"file","path":"docs/product/raw/external-empty-id.json","sha256":"08d2cbdfca2eed8d98b631b6a9e99e7bb6c684c8c22fb6ea3e4ef201fd57ef1b"}]},{"id":"E6C","title":"后续本地使用","outcome":"使用有效导入数据","scope":"只消费约定可靠数据，当前不提前创建 task","targets":[{"target":"REQ-IMPORT","coverage":"后续数据使用"}],"state":"included","origin":"initial","depends_on":[{"item_id":"E6B","kind":"order","reason":"原分批安排"},{"item_id":"E6R","kind":"prerequisite","reason":"后续本地消费必须取得正整数 ID 的实际可靠结果，task close 本身不证明该前提"}]}]}
  ]
}
---
# 隔离业务验收

## [PLAN-IMPORT] 导入分批安排
### 实施策略
在合成验收授权下选择 A/B/C 三项；仍是原业务需求，不为工作项再制造需求。
### 阶段与工作项说明
原定 E6A、E6B、E6C；近期只准备 A/B 的真实 task，C 暂无 task。
### 调整与未决事项
依据实际无 task 检查失败，在 E6C 前加入 E6R；原 A/B 的历史关闭保留，其他业务未盘点、多设备仍候选。项目 plan 不属于 Runtime plan_ref。

