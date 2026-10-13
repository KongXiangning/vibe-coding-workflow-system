---
{
  "schema": "vnext-product-doc/v5",
  "items": [
    {"id":"REQ-BATCH","type":"requirement","scope":"current","assessment_id":null,"task_bindings":[{"id":"B-OLD-BATCH","task":{"task_id":"task-0102c3bd2813bcffa3e597e327d47300","source":{"kind":"file","path":".workflow-system/records/events/key-a4cef41a59372c4358f03c43ce72525e8f6d0cdf0c27d86bb33f967b77462243.json"},"plan_ref":".workflow-system/records/events/key-a4cef41a59372c4358f03c43ce72525e8f6d0cdf0c27d86bb33f967b77462243.json","step_id":"S-PARSE"},"role":"implementation","coverage":"提供无引号两列文本解析和错误行号，供批量导入的后续行检查/错误呈现使用；不履行浏览器选文件、预览、确认、未确认不写入和批次历史查询义务。","origin":"declared","state":"active","reason":"REQ-BATCH原文只把解析函数列为可用组件，旧Task采用范围明确排除浏览器、上传和批次列表。已有解析实现是明确支撑机制，不是交互导入义务的直接完成；因此纠正原direct为supporting，保留原ID、旧理由与来源快照。没有现成depends_on能替代此独立支撑说明。","sources":[{"kind":"file","path":"docs/product/history/REQ-BATCH.before-contribution.md","sha256":"d906dace0e51ba662c574596d1e3f98c950e2d9ae839f290b7e1104872c89b4c","item_id":"REQ-BATCH"},{"kind":"file","path":".workflow-system/records/events/key-a4cef41a59372c4358f03c43ce72525e8f6d0cdf0c27d86bb33f967b77462243.json","sha256":"2f13152c4766cceec1bcaf02d16ec255016f00004147438bd1851bcfbbd95684"},{"kind":"file","path":"src/parse.mjs","sha256":"22668d3cdcad69a4de72a4b060388467a0138f5a5da427f64aa13b092e882e87"},{"kind":"file","path":"docs/evidence/parser-test.txt","sha256":"470a61153acb6323f91d6bb637769d8dcf0b3751c54acb67e3ef05ac2d39daf6"}],"contribution":"supporting"}]}
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
