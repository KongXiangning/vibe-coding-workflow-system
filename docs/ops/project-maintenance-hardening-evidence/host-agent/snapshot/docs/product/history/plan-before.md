---
schema: vnext-product-doc/v2
items:
  - {"id":"PLAN-ORDERS","type":"plan","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"intent_state":"proposed","targets":[{"target":"REQ-EXCEL","coverage":"导入处理导出"},{"target":"REQ-BOOK","coverage":"预约改期"},{"target":"REQ-LOG","coverage":"日志恢复探索"},{"target":"REQ-AUDIT","coverage":"操作记录与导出"},{"target":"REQ-REPORT","coverage":"报表优化"}],"work_items":[{"id":"E6A","title":"导入","outcome":"导入订单金额","scope":"导入基础","targets":[{"target":"REQ-EXCEL","coverage":"导入基础"}],"state":"included","origin":"initial"},{"id":"E6B","title":"处理","outcome":"处理已导入金额","scope":"处理基础","targets":[{"target":"REQ-EXCEL","coverage":"处理基础"}],"state":"included","origin":"initial"},{"id":"E6C","title":"导出","outcome":"输出可靠金额","scope":"导出，尚未开始","targets":[{"target":"REQ-EXCEL","coverage":"导出，尚未开始"}],"state":"included","origin":"initial"},{"id":"BOOK-CHECK","title":"时段校验","outcome":"校验改期","scope":"时段范围","targets":[{"target":"REQ-BOOK","coverage":"时段范围"}],"state":"included","origin":"initial"},{"id":"BOOK-NOTIFY","title":"改期通知","outcome":"发送通知","scope":"通知范围","targets":[{"target":"REQ-BOOK","coverage":"通知范围"}],"state":"included","origin":"initial"},{"id":"BOOK-FEE","title":"改期费用","outcome":"计算费用","scope":"费用范围","targets":[{"target":"REQ-BOOK","coverage":"费用范围"}],"state":"included","origin":"initial"},{"id":"LOG-PROBE","title":"断电日志受限探索","outcome":"确认方案可行性","scope":"探索，不代表需求交付","targets":[{"target":"REQ-LOG","coverage":"探索，不代表需求交付"}],"state":"included","origin":"initial"},{"id":"AUDIT-ACTOR","title":"权限与操作人","outcome":"取得可靠操作记录","scope":"仅操作人字段","targets":[{"target":"REQ-AUDIT","coverage":"仅操作人字段"}],"state":"included","origin":"initial"},{"id":"REPORT-OPT","title":"报表优化","outcome":"优化报表","scope":"原安排","targets":[{"target":"REQ-REPORT","coverage":"原安排"}],"state":"included","origin":"initial"}]}
---
# 合成实施安排

## [PLAN-ORDERS] 订单实施安排
### 实施策略
候选安排；没有自动采用 Runtime 计划。
### 阶段与工作项说明
预约三个工作项属于同一 REQ；E6A/B/C 身份稳定；远期未分配 task。
### 调整与未决事项
未知日志恢复先探索；客户新优先级将在局部更新记录。
