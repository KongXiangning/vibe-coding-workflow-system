---
{
  "schema": "vnext-product-doc/v2",
  "items": [
    {
      "id": "CHG-THREE",
      "type": "change",
      "recorded_at": "2026-10-04T15:03:44.250Z",
      "basis": {
        "kind": "delegated",
        "text": "依 A04 的授权验收顺序，将本轮导入上限调整为3台，代码适用性另行检查",
        "sources": [
          {
            "kind": "text",
            "label": "合成验收中的委托变更（不是实际用户原话）",
            "text": "依 A04 的授权验收顺序，将本轮导入上限调整为3台，代码适用性另行检查"
          }
        ]
      },
      "deltas": [
        {
          "target": "REQ-IMPORT",
          "before": "最多一台设备",
          "after": "最多3台设备",
          "note": "保留正整数、非空 label、离线及排除项；文字恢复不证明代码恢复"
        }
      ]
    },
    {
      "id": "CHG-ONE",
      "type": "change",
      "recorded_at": "2026-10-04T15:03:44.438Z",
      "basis": {
        "kind": "delegated",
        "text": "依 A04 的授权验收顺序，将本轮导入上限调整为1台，代码适用性另行检查",
        "sources": [
          {
            "kind": "text",
            "label": "合成验收中的委托变更（不是实际用户原话）",
            "text": "依 A04 的授权验收顺序，将本轮导入上限调整为1台，代码适用性另行检查"
          }
        ]
      },
      "deltas": [
        {
          "target": "REQ-IMPORT",
          "before": "最多三台设备",
          "after": "最多1台设备",
          "note": "保留正整数、非空 label、离线及排除项；文字恢复不证明代码恢复"
        }
      ]
    }
  ]
}
---
# 隔离业务验收

## [CHG-THREE] 3台安排
### 变更说明
本轮委托验收的局部范围变更，有可恢复旧文档来源。
### 影响与未同步项
当前实现尚未执行；不继承旧 PASS，不拓展网络边界。


## [CHG-ONE] 1台安排
### 变更说明
本轮委托验收的局部范围变更，有可恢复旧文档来源。
### 影响与未同步项
当前实现尚未执行；不继承旧 PASS，不拓展网络边界。

