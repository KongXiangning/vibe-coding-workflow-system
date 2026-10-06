---
schema: vnext-product-doc/v2
items:
  - {"id":"AS-INTEGER","type":"assessment","target":"REQ-EXCEL","target_basis":{"kind":"file","path":"docs/product/REQUIREMENTS.md","item_id":"REQ-EXCEL"},"target_definition_sha256":"ce620df7436d3a0b7eee1dd06f14b4a41f765a88808c3b2d87eb6542bcf52be3","checked_at":"2026-10-05","subject":{"kind":"working-copy","value":"合成 amount.mjs 初始函数，具体字节随检查快照保存"},"implementation":"partial-reported","verification":"pass-reported","sources":[{"kind":"file","path":"docs/evidence/integer-pass.txt"}],"pending_sources":[{"kind":"file","path":"docs/evidence/external-failure.txt"},{"kind":"file","path":"docs/evidence/decimal-before.txt"}]}
  - {"id":"AS-DECIMAL","type":"assessment","target":"REQ-EXCEL","target_basis":{"kind":"file","path":"docs/product/REQUIREMENTS.md","item_id":"REQ-EXCEL"},"target_definition_sha256":"ce620df7436d3a0b7eee1dd06f14b4a41f765a88808c3b2d87eb6542bcf52be3","checked_at":"2026-10-05","subject":{"kind":"working-copy","value":"合成 src/amount.mjs sha256 e382a794680286e006a91d5017450bea4a4a817478783ea656c7bd1033f853dd；不是全项目快照"},"implementation":"partial-reported","verification":"pass-reported","sources":[{"kind":"file","path":"docs/evidence/actual-checks.json"},{"kind":"file","path":"docs/evidence/decimal-after.txt"},{"kind":"file","path":"docs/evidence/integer-after.txt"},{"kind":"file","path":"docs/evidence/decimal-before.txt"}],"pending_sources":[{"kind":"file","path":"docs/evidence/external-failure.txt","note":"外部对象版本未知，不能用局部样本 PASS 清除"}]}
---
# 合成范围化对账
## [AS-INTEGER] 原整数检查与新待核对材料
### 覆盖范围
只检查合成函数 [1,2] 金额合计，不覆盖小数输入、支付退货、导出或整个需求。
### 交付与验证依据
本轮 Node 整数检查实际 exit 0；外部材料是合成用户报告，decimal-before 是 Agent 本地夹具复现 exit 1，两者区别保留。
### 剩余与待核对
新失败已进入 pending_sources。需求定义未变不代表当前完整通过，旧整数 PASS 保留为历史。

## [AS-DECIMAL] 本轮局部金额复验
### 覆盖范围
仅本轮受控函数整数 [1,2] 与小数 [0.1,0.2]，具体新字节摘要记录在 actual-checks；未验证导出、生产数据或所有金额格式。
### 交付与验证依据
Agent 本地复现 before exit 1，实际修复后两命令 exit 0。原整数报告、原失败、原 assessment 保留；合成外部报告与本地复现分别解释。
### 剩余与待核对
外部用户报告对象版本未知仍 pending；支付退货共享风险及 E6C 实际可靠输入前提仍待核对。修复 task close 本身没有改变任何结论。
