---
schema: vnext-product-doc/v2
items:
  - {"id":"CHG-HARDENING-HOST","type":"change","recorded_at":"2026-10-05","basis":{"kind":"delegated","text":"仅隔离合成验收中按 brief/decisions 作本轮范围化整理","sources":[{"kind":"file","path":"docs/evidence/brief.txt"},{"kind":"file","path":"docs/evidence/decisions.txt"}]},"deltas":[{"target":"G-REGISTER","before":"扩大注册（来源 brief，旧规范原文不可得）","after":"retired，目标去向 G-TRIAL","note":"注册简化仍保留，代码是否删除未知"},{"target":"G-TRIAL","before":null,"after":"提升试用转付费，结果材料口径未知","note":"新增目标不是 KPI 计算或达成声明"},{"target":"REQ-COUPON","before":null,"after":"退出首发，历史失败保留","note":"旧规范未取得；共享支付退货风险仍 current"},{"target":"PLAN-ORDERS","before":"E6A/B/C 与原报表安排，见 plan-before.md","after":"E6R 插到 C 前；审计导出优先，报表延期","note":"先修过排序方向，当前 REPORT-OPT 在 AUDIT-EXPORT 后；工程前提需真实检查"}],"sources":[{"kind":"file","path":"docs/product/history/plan-before.md"}]}
---
# 合成本轮变化依据
## [CHG-HARDENING-HOST] 目标和计划演进
### 变更说明
保留原决定、未改要求和去向。只采纳错误议题，云目标重新关联不代表观点采纳。
### 影响与未同步项
营销未取得；支付退货、完整审计、导出以及生产对象未验证。延期维护和停止不要求先清除历史失败。
