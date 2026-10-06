---
schema: vnext-product-doc/v2
items:
  - {"id":"G-REGISTER","type":"goal","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"retired"}
  - {"id":"G-TRIAL","type":"goal","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current","links":[{"id":"L-GOAL-REPLACES","relation":"replaces","target":"G-REGISTER","origin":"declared","state":"active"}]}
  - {"id":"G-CLOUD","type":"goal","sources":[{"kind":"file","path":"docs/product/raw/interview.txt","sha256":"63b83e5d48b09e6c913a5ec4098437716711a8ddca6a746153297d85335eb750","lines":{"start":2,"end":2}},{"kind":"file","path":"docs/evidence/decisions.txt","lines":{"start":4,"end":4}}],"scope":"candidate"}
  - {"id":"MOD-ORDERS","type":"module","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current"}
---
# 合成目标与模块

## [G-REGISTER] 历史注册增长
### 目标说明
材料报告的旧目标；已被转付费目标替代。
### 范围边界
旧注册简化继续有价值；退出目标不是宣称代码已删除。

## [G-TRIAL] 试用转付费
### 目标说明
当前目标为改善试用到付费；9月合成观察90个样本、18个付费，统计方法和来源完整性未知，未认证达成。
### 范围边界
保留注册简化，延期邀请奖励，新增试用引导；结果材料使用正文和 sources。

## [G-CLOUD] 可选云同步候选
### 目标说明
由访谈作为候选提出，尚非当前离线义务。
### 范围边界
没有启用、实现或正式采纳承诺。

## [MOD-ORDERS] 离线订单工具
### 业务能力
订单导入、改期、支付、退货及授权资料中的诊断。
### 范围边界
未盘点营销渠道，分组不创建额外业务义务。
