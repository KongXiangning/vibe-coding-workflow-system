---
{
  "schema": "vnext-product-doc/v5",
  "items": [
    {
      "id": "REQ-BATCH",
      "type": "requirement",
      "scope": "current",
      "assessment_id": null,
      "task_bindings": [
        {
          "id": "B-OLD-BATCH",
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
          "coverage": "记录工具的数据输入基础",
          "origin": "declared",
          "state": "active",
          "reason": "早期盘点把解析器与记录输入功能关联。",
          "sources": [
            {
              "kind": "file",
              "path": ".workflow-system/records/events/key-a4cef41a59372c4358f03c43ce72525e8f6d0cdf0c27d86bb33f967b77462243.json"
            },
            {
              "kind": "file",
              "path": "docs/evidence/parser-test.txt"
            }
          ],
          "contribution": "direct"
        }
      ]
    }
  ]
}
---
## [REQ-BATCH] 交互式批量导入
### 需求内容
用户在浏览器选择文本文件、预览各行错误并确认导入；确认后可在批次历史查看成功/失败数量。
### 范围边界
解析函数可作为组件，但单独解析不提供上传、预览、确认或历史查询体验。
### 验收要求
在浏览器完成上传、纠错预览、确认及历史回看；未确认不得写入批次。
