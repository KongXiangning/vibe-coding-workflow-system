---
schema: vnext-product-doc/v3
items:
  - id: PROJECT
    type: project
    inventory:
      state: partial
      checked_sources: []
      unreviewed_sources: []
  - id: REQ-20
    type: requirement
    scope: current
---
# 合成项目

## [PROJECT] 权限分阶段示例
### 项目定位
演示一个需求跨阶段安排。
### 盘点范围与未核对项
只有合成定义；未读取真实代码或交付材料。

## [REQ-20] 权限、隐私和审计
### 需求内容
公共与租户边界、来源授权、隐私、必要审计及角色权限。
### 范围边界
基础约束与完整角色实现分阶段，但仍为同一需求。
### 验收要求
按实际对象分别核对每阶段；基础任务关闭不等于完整需求满足。
