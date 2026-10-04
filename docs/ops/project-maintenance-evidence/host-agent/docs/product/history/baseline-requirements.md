---
{
  "schema": "vnext-product-doc/v2",
  "items": [
    {"id":"REQ-IMPORT","type":"requirement","scope":"current","links":[{"id":"L-MOD","relation":"part_of","target":"MOD-IMPORT","origin":"declared","state":"active"}],"sources":[{"kind":"file","path":"inputs/brief.md","sha256":"31ce0b643e33cb528d7c4f288229056e18e2ee424cb6cb1cc8d9d6c58d429207"}],"task_bindings":[{"id":"B-E6A","task":{"task_id":"task-19a48ef12e4ed85aa3c8d751388b6bcc","plan_ref":".workflow-system/records/events/key-bfe2d7a14611f8e0dd2e7143e89d3fba5d4363e3a6f323f5d488f5595dd09b28.json","source":{"kind":"file","path":".workflow-system/records/events/key-bfe2d7a14611f8e0dd2e7143e89d3fba5d4363e3a6f323f5d488f5595dd09b28.json","sha256":"a8b034fc94266b4622cd53402185f712a9994791522d99f338a30a55412c917b"},"label":"E6A"},"role":"implementation","coverage":"导入脚本基础与有效单台样例","origin":"declared","state":"active","plan_items":[{"plan_id":"PLAN-IMPORT","work_item_id":"E6A"}]}]},
    {"id":"REQ-ERROR","type":"requirement","scope":"current","sources":[{"kind":"file","path":"inputs/brief.md","sha256":"31ce0b643e33cb528d7c4f288229056e18e2ee424cb6cb1cc8d9d6c58d429207"},{"kind":"file","path":"docs/product/raw/selected-discussion.txt","sha256":"063c5a27f5fa22151f7b642086d24ce9beae000463eef6d51e1f4cbc18bb3594","lines":{"start":2,"end":2},"note":"只采纳本条错误说明，其他观点未采用"}],"task_bindings":[{"id":"B-E6B","task":{"task_id":"task-b826bc13b6b2256830175acc5597a7be","plan_ref":".workflow-system/records/events/key-f8a9826b255a93d9aebea66b040d2d5c93303180249856b62c11eff1333a5d75.json","source":{"kind":"file","path":".workflow-system/records/events/key-f8a9826b255a93d9aebea66b040d2d5c93303180249856b62c11eff1333a5d75.json","sha256":"fd6130c80d606bb040833a7c823ec835a1abd14f515faf5eb4244ef29bc62637"},"label":"E6B"},"role":"implementation","coverage":"空 label 行号与原因核对","origin":"declared","state":"active","plan_items":[{"plan_id":"PLAN-IMPORT","work_item_id":"E6B"}]}]},
    {
      "id": "REQ-MULTI",
      "type": "requirement",
      "scope": "candidate",
      "sources": [
        {
          "kind": "file",
          "path": "inputs/brief.md",
          "sha256": "31ce0b643e33cb528d7c4f288229056e18e2ee424cb6cb1cc8d9d6c58d429207"
        }
      ]
    }
  ]
}
---
# 隔离业务验收

## [REQ-IMPORT] 导入一台设备
### 需求内容
CSV 字段为 device_id,label；device_id 必须为正整数，label 去除首尾空格后非空。一次导入一台设备；无效输入拒绝。
### 范围边界
不支持网络上传、数据库、统计看板及未约定字段；当前不扩大为三台。
### 验收要求
有效单台输入保留 id 与 label；空、非正整数 id 或空 label 不进入结果。多个设备不属于本期接受范围。


## [REQ-ERROR] 失败输入诊断
### 需求内容
失败时说明实际输入行号和具体原因；空 device_id 必须指出正整数要求，而不是仅显示泛化失败。
### 范围边界
本地错误提示，未建立 UI 或远程日志服务。
### 验收要求
无效字段错误含 CSV 实际行号和原因，不用泛化成功提示。


## [REQ-MULTI] 后续多设备候选
### 需求内容
可以研究批量设备范围；目前未采用。
### 范围边界
没有 task、设计或本期交付义务；不把当前单台实现说成多设备交付。
### 验收要求
待实际范围决定后定义，不编造目前验收。


