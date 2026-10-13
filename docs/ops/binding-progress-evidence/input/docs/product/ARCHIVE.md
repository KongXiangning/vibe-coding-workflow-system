---
{
  "schema": "vnext-product-doc/v3",
  "items": [
    {
      "id": "REQ-ARCHIVE",
      "type": "requirement",
      "scope": "current",
      "assessment_id": null,
      "task_bindings": [
        {
          "id": "B-UNRESOLVED",
          "task": {
            "task_id": null,
            "source": {
              "kind": "file",
              "path": "docs/evidence/archive-note.md"
            }
          },
          "role": "implementation",
          "coverage": "归档相关",
          "origin": "declared",
          "state": "active"
        }
      ]
    }
  ]
}
---
## [REQ-ARCHIVE] 历史归档检索
### 需求内容
用户按批次日期检索归档，保持原始批次记录。
### 范围边界
历史材料只有一句“做过归档”，没有可恢复任务身份或验收。
### 验收要求
日期过滤返回匹配批次且记录原文不变。
