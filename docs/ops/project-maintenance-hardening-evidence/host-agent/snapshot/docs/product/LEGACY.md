---
schema: vnext-product-doc/v2
items:
  - id: REQ-CSV
    type: requirement
    scope: retired
  - id: REQ-HAND
    type: requirement
    scope: current
  - id: REQ-BAD-KEEP
    type: requirement
    scope: current
    unknown_keep: true
---
# 合成历史及用户手工编辑夹具
## [REQ-CSV] 历史 CSV 金额解析
### 需求内容
旧版 CSV 解析的历史范围，现已退出。
### 范围边界
当前 Excel 修复不自动恢复此目标。
### 验收要求
历史报告保留；不是当前通过。
## [REQ-HAND] 当前手工业务要求
### 需求内容
用户刚刚增加的业务例外保持，格式修复不得恢复旧意。
### 范围边界
仅修未知字段。
### 验收要求
手工业务内容不变。
## [REQ-BAD-KEEP] 未选坏条目
### 需求内容
本轮不改本条目原文。
### 范围边界
原 YAML 字节保留。
### 验收要求
继续报告局部不可用。
