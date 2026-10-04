---
{
  "schema": "vnext-product-doc/v2",
  "items": [
    {
      "id": "REQ-IMPORT",
      "type": "requirement",
      "scope": "current",
      "links": [
        {
          "id": "L-MOD",
          "relation": "part_of",
          "target": "MOD-IMPORT",
          "origin": "declared",
          "state": "active"
        }
      ],
      "sources": [
        {
          "kind": "file",
          "path": "inputs/brief.md",
          "sha256": "31ce0b643e33cb528d7c4f288229056e18e2ee424cb6cb1cc8d9d6c58d429207"
        }
      ]
    },
    {
      "id": "REQ-ERROR",
      "type": "requirement",
      "scope": "current",
      "sources": [
        {
          "kind": "file",
          "path": "inputs/brief.md",
          "sha256": "31ce0b643e33cb528d7c4f288229056e18e2ee424cb6cb1cc8d9d6c58d429207"
        }
      ]
    },
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
失败时说明实际输入行号和具体原因。
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

