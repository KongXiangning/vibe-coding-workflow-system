---
{
  "schema": "vnext-product-doc/v3",
  "items": [
    {
      "id": "REQ-TYPEFACE",
      "type": "requirement",
      "scope": "current",
      "assessment_id": null,
      "task_bindings": [
        {
          "id": "B-DISMISSED-FONT",
          "task": {
            "task_id": "task-0102c3bd2813bcffa3e597e327d47300",
            "source": {
              "kind": "file",
              "path": ".workflow-system/records/events/key-a4cef41a59372c4358f03c43ce72525e8f6d0cdf0c27d86bb33f967b77462243.json"
            },
            "plan_ref": ".workflow-system/records/events/key-a4cef41a59372c4358f03c43ce72525e8f6d0cdf0c27d86bb33f967b77462243.json",
            "step_id": "S-PARSE"
          },
          "role": "implementation",
          "coverage": "导入页字号切换",
          "origin": "declared",
          "state": "dismissed",
          "reason": "解析函数没有任何浏览器字号或偏好存储代码，旧标题相似不足以成立关系。",
          "sources": [
            {
              "kind": "file",
              "path": "docs/evidence/font-decision.md"
            }
          ]
        }
      ]
    }
  ]
}
---
## [REQ-TYPEFACE] 导入页字号
### 需求内容
提供导入页字号切换，支持14px和18px，并在重载后保持选择。
### 范围边界
只涉及可见文字样式；不改变文本解析格式。
### 验收要求
切换两种字号后截图核对；重载保留选择。
