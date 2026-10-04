---
{
  "schema": "vnext-product-doc/v2",
  "items": [
    {"id":"DES-CSV","type":"design","intent_state":"adopted","links":[{"id":"L-REQ","relation":"addresses","target":"REQ-IMPORT","origin":"declared","state":"active"}],"sources":[{"kind":"file","path":"inputs/brief.md","sha256":"31ce0b643e33cb528d7c4f288229056e18e2ee424cb6cb1cc8d9d6c58d429207"},{"kind":"file","path":"docs/evidence/initial-check.json","sha256":"0a4d54c74d450f8fb76cf68cc16b4d67dba30eae188f5dfc874d4641f9c6d314"},{"kind":"file","path":"docs/evidence/fixed-check.json","sha256":"061bfb90e631467673f0274c7107b95c994b97a946d7374a7b106917c214576c"}]}
  ]
}
---
# 隔离业务验收

## [DES-CSV] 本地 CSV 解析方案
### 设计方案
使用小型 Node 解析函数；先解析字段，再校验本地记录。
### 约束与取舍
离线、仅两个已约定字段；不引入存储或额外服务。
### 实际实现与差异
已创建隔离 baseline 解析函数并检查有效单台/空 label；此次正整数 ID 常见边界已实际修复并核对；额外列、大数仍未核对，其他业务未实施。

