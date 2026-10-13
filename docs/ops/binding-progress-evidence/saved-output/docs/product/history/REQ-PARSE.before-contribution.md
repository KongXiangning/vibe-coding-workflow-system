---
{
  "schema": "vnext-product-doc/v3",
  "items": [
    {
      "id": "REQ-PARSE",
      "type": "requirement",
      "scope": "current",
      "assessment_id": null,
      "task_bindings": [
        {
          "id": "B-OLD-PARSER",
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
          ]
        }
      ]
    }
  ]
}
---
## [REQ-PARSE] 固定格式文本解析
### 需求内容
接受头为id,value的无引号文本；输出逐行id/value数组；缺失字段指出行号。
### 范围边界
不要求浏览器上传、网络传输或批次历史。
### 验收要求
两个合法记录保留值；缺失value的第二行明确报row 2。
