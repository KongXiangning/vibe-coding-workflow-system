---
{
  "schema": "vnext-product-doc/v2",
  "items": [{"id":"AS-BASE","type":"assessment","target":"REQ-IMPORT","target_basis":{"kind":"file","path":"docs/product/history/baseline-requirements.md","sha256":"a832de3c38fd0bb58fd34680569ae5d1ad891461ba77d4e2c67ca8a4684f0320","item_id":"REQ-IMPORT"},"target_definition_sha256":"df0de15f51c84db509579d589f679bd949dc8f3f5c2bbb1774830acc04247fc9","checked_at":"2026-10-04T15:05:33.291Z","subject":{"kind":"working-copy","value":"C:\\Users\\kongx\\AppData\\Local\\Temp\\vnext-maintain-project-agent-QnIf72"},"implementation":"partial-reported","verification":"pass-reported","sources":[{"kind":"file","path":"docs/evidence/initial-check.json","sha256":"0a4d54c74d450f8fb76cf68cc16b4d67dba30eae188f5dfc874d4641f9c6d314"}],"pending_sources":[{"kind":"file","path":"docs/product/raw/external-empty-id.json","sha256":"08d2cbdfca2eed8d98b631b6a9e99e7bb6c684c8c22fb6ea3e4ef201fd57ef1b"}]},{"id":"AS-FIXED","type":"assessment","target":"REQ-IMPORT","target_basis":{"kind":"file","path":"docs/product/history/baseline-requirements.md","item_id":"REQ-IMPORT","sha256":"a832de3c38fd0bb58fd34680569ae5d1ad891461ba77d4e2c67ca8a4684f0320"},"target_definition_sha256":"df0de15f51c84db509579d589f679bd949dc8f3f5c2bbb1774830acc04247fc9","checked_at":"2026-10-04T15:08:16.603Z","subject":{"kind":"working-copy","value":"C:\\Users\\kongx\\AppData\\Local\\Temp\\vnext-maintain-project-agent-QnIf72"},"implementation":"partial-reported","verification":"pass-reported","sources":[{"kind":"file","path":"docs/product/raw/external-empty-id.json","sha256":"08d2cbdfca2eed8d98b631b6a9e99e7bb6c684c8c22fb6ea3e4ef201fd57ef1b"},{"kind":"file","path":"docs/evidence/fixed-check.json","sha256":"061bfb90e631467673f0274c7107b95c994b97a946d7374a7b106917c214576c"}],"pending_sources":[]}]
}
---
# 隔离业务验收

## [AS-BASE] 基础输入检查
### 覆盖范围
只有有效单台与空 label 输入，工作副本标签不是整个代码快照。
### 交付与验证依据
初始 Node 检查实际通过；原文件带实际代码文件摘要。A/B 关闭不证明需求完整通过。
### 剩余与待核对
空、零、小数 ID 等未检查；原报告完整保留，后续新失败必须纳入。

## [AS-FIXED] 输入边界修复后的实际核对
### 覆盖范围
当前实际执行：有效单台，空/零/负数/小数/非数字 ID 拒绝，空 label；额外列、大数、其他业务仍未核对。工作副本不是全项目精确快照；报告带实际 importer 文件 SHA。
### 交付与验证依据
原 baseline 的有效输入 PASS 与新增反例失败均保留；修复后同一个空 ID 反例与扩展输入检查实际通过。不同代码文件摘要分别解释，原报告不删除。
### 剩余与待核对
E6C 未执行；额外列、大数与未盘点业务仍有范围缺口。AS-BASE 的历史 pending 保留，新入口说明该失败如何完成局部对账；关闭 task 不产生本摘要。
