---
{
  "schema": "vnext-product-doc/v2",
  "items": [
    {
      "id": "PROJECT-DEVICES",
      "type": "project",
      "inventory": {
        "state": "partial",
        "checked_sources": [
          {
            "kind": "file",
            "path": "inputs/brief.md",
            "sha256": "31ce0b643e33cb528d7c4f288229056e18e2ee424cb6cb1cc8d9d6c58d429207"
          }
        ],
        "unreviewed_sources": [
          {
            "kind": "file",
            "path": "inputs/unreviewed.md",
            "note": "此轮未读取，不宣称全项目盘点"
          }
        ]
      }
    },
    {
      "id": "GOAL-IMPORT",
      "type": "goal",
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
      "id": "MOD-IMPORT",
      "type": "module",
      "scope": "current",
      "links": [
        {
          "id": "L-GOAL",
          "relation": "supports",
          "target": "GOAL-IMPORT",
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
    }
  ]
}
---
# 隔离业务验收

## [PROJECT-DEVICES] 离线设备导入验收项目
### 项目定位
隔离合成业务，用实际 CLI 操作和执行材料检查 maintain-project；不是用户业务项目。
### 盘点范围与未核对项
只读取 brief.md 的导入范围；其他业务未核对。


## [GOAL-IMPORT] 可靠离线导入
### 目标说明
把受约定约束的设备记录导入为本地数据。
### 范围边界
保持离线；无网络上传、数据库或统计看板。


## [MOD-IMPORT] 设备清单处理
### 业务能力
输入解析、错误定位和后续本地使用。
### 范围边界
只组织导入业务，不扩展上传或统计功能。

