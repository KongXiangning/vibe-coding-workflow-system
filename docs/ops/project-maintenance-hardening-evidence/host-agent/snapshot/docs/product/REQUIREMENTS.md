---
schema: vnext-product-doc/v2
items:
  - {"id":"REQ-REG","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current"}
  - {"id":"REQ-INVITE","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"planned"}
  - {"id":"REQ-TRIAL","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current"}
  - {"id":"REQ-COUPON","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"retired"}
  - {"id":"REQ-PAY","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current"}
  - {"id":"REQ-REFUND","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current"}
  - {"id":"REQ-BOOK","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current"}
  - {"id":"REQ-PERM","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current","task_bindings":[{"id":"B-PERM","task":{"task_id":"task-cfd8fc8e0c81467f9e0812390b66241c","source":{"kind":"file","path":".workflow-system/records/events/key-d09fd8b04aa8e49a17f0dcbea2880050e0fb8f7a3037ac5a48b29c10e1888ece.json"},"plan_ref":".workflow-system/records/events/key-d09fd8b04aa8e49a17f0dcbea2880050e0fb8f7a3037ac5a48b29c10e1888ece.json"},"role":"implementation","coverage":"接口权限，尚未执行","origin":"declared","state":"active","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}]}]}
  - {"id":"REQ-AUDIT","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current","task_bindings":[{"id":"B-ACTOR","task":{"task_id":"task-cfd8fc8e0c81467f9e0812390b66241c","source":{"kind":"file","path":".workflow-system/records/events/key-d09fd8b04aa8e49a17f0dcbea2880050e0fb8f7a3037ac5a48b29c10e1888ece.json"},"plan_ref":".workflow-system/records/events/key-d09fd8b04aa8e49a17f0dcbea2880050e0fb8f7a3037ac5a48b29c10e1888ece.json"},"role":"implementation","coverage":"只提供操作人字段，尚未执行；不覆盖查询导出","origin":"declared","state":"active","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"plan_items":[{"plan_id":"PLAN-ORDERS","work_item_id":"AUDIT-ACTOR"}]}]}
  - {"id":"REQ-LOG","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current","task_bindings":[{"id":"B-PROBE","task":{"task_id":"task-790e97b72cd9ca627fa33a63d805a8eb","source":{"kind":"file","path":".workflow-system/records/events/key-1ba90847b5eec631d22bd103c72836251d6b7400a928fc808ede143a37b779f2.json"},"plan_ref":".workflow-system/records/events/key-1ba90847b5eec631d22bd103c72836251d6b7400a928fc808ede143a37b779f2.json"},"role":"exploration","coverage":"仅受限可行性探索，不是产品交付","origin":"declared","state":"active","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"plan_items":[{"plan_id":"PLAN-ORDERS","work_item_id":"LOG-PROBE"}]}]}
  - {"id":"REQ-EXCEL","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"current","task_bindings":[{"id":"B-E6A","task":{"task_id":"task-a90ec0f56920f3f91b016ece3fb95e3a","source":{"kind":"file","path":".workflow-system/records/events/key-81a12f2432b8abc7cbdf4d9e78875fadaa3c4835917f0115af8da9139ff52b48.json"},"plan_ref":".workflow-system/records/events/key-81a12f2432b8abc7cbdf4d9e78875fadaa3c4835917f0115af8da9139ff52b48.json","step_id":"E6A","label":"原 task 内 E6A"},"role":"implementation","coverage":"导入基础，仅整数夹具检查","origin":"declared","state":"active","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"plan_items":[{"plan_id":"PLAN-ORDERS","work_item_id":"E6A"}]},{"id":"B-E6B","task":{"task_id":"task-a90ec0f56920f3f91b016ece3fb95e3a","source":{"kind":"file","path":".workflow-system/records/events/key-81a12f2432b8abc7cbdf4d9e78875fadaa3c4835917f0115af8da9139ff52b48.json"},"plan_ref":".workflow-system/records/events/key-81a12f2432b8abc7cbdf4d9e78875fadaa3c4835917f0115af8da9139ff52b48.json","step_id":"E6B","label":"原 task 内 E6B"},"role":"implementation","coverage":"整数处理基础","origin":"declared","state":"active","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"plan_items":[{"plan_id":"PLAN-ORDERS","work_item_id":"E6B"}]},{"id":"B-E6R","task":{"task_id":"task-3d3d473c824d8b1d2c12ea2a9773b683","source":{"kind":"file","path":".workflow-system/records/events/key-3172e8a11447d5a110aebea7f7a853841045f52bf53b1b35f2748287852bc5e6.json"},"plan_ref":".workflow-system/records/events/key-3172e8a11447d5a110aebea7f7a853841045f52bf53b1b35f2748287852bc5e6.json"},"role":"repair","coverage":"当前 Excel 小数样本，未覆盖支付退货/其他格式","origin":"declared","state":"active","sources":[{"kind":"file","path":"docs/evidence/external-failure.txt"},{"kind":"file","path":"docs/evidence/decimal-before.txt"}],"plan_items":[{"plan_id":"PLAN-ORDERS","work_item_id":"E6R"}],"repairs":[{"task":{"task_id":"task-a90ec0f56920f3f91b016ece3fb95e3a","source":{"kind":"file","path":".workflow-system/records/events/key-81a12f2432b8abc7cbdf4d9e78875fadaa3c4835917f0115af8da9139ff52b48.json"},"plan_ref":".workflow-system/records/events/key-81a12f2432b8abc7cbdf4d9e78875fadaa3c4835917f0115af8da9139ff52b48.json","step_id":"E6A","label":"原 task 内 E6A"},"coverage":"旧整数导入范围相关，未知缺陷引入者","sources":[{"kind":"file","path":"docs/evidence/external-failure.txt"},{"kind":"file","path":"docs/evidence/decimal-before.txt"}]}]}],"assessment_id":"AS-DECIMAL"}
  - {"id":"REQ-ERROR","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"},{"kind":"file","path":"docs/product/raw/interview.txt","sha256":"63b83e5d48b09e6c913a5ec4098437716711a8ddca6a746153297d85335eb750","lines":{"start":3,"end":3}},{"kind":"file","path":"docs/evidence/decisions.txt","lines":{"start":2,"end":2}}],"scope":"current"}
  - {"id":"REQ-MULTI","type":"requirement","sources":[{"kind":"file","path":"docs/product/raw/interview.txt","sha256":"63b83e5d48b09e6c913a5ec4098437716711a8ddca6a746153297d85335eb750","lines":{"start":4,"end":4}}],"scope":"candidate"}
  - {"id":"REQ-REPORT","type":"requirement","sources":[{"kind":"file","path":"docs/evidence/brief.txt"}],"scope":"planned"}
---
# 合成当前已知要求

## [REQ-REG] 注册简化
### 需求内容
保留注册简化服务试用目标。
### 范围边界
不因目标改变声明删除原分享代码。
### 验收要求
转付费结果需要独立材料。

## [REQ-INVITE] 邀请奖励
### 需求内容
邀请奖励延期。
### 范围边界
本轮不安排实施。
### 验收要求
延期不是完成。

## [REQ-TRIAL] 试用引导
### 需求内容
新增试用引导。
### 范围边界
具体方案仍需细化。
### 验收要求
尚无当前交付证据。

## [REQ-COUPON] 优惠券退出首发
### 需求内容
优惠券不再属于首发义务。
### 范围边界
叠加旧失败保留；代码是否删除未知。
### 验收要求
退出不是 PASS；无先修历史失败要求。

## [REQ-PAY] 支付金额
### 需求内容
保留支付金额能力。
### 范围边界
共享金额函数可能受优惠券及导入问题影响，需局部核对。
### 验收要求
未检查的支付实现不标通过。

## [REQ-REFUND] 退货金额
### 需求内容
保留退货金额能力。
### 范围边界
共享金额风险保留，未要求全项目修复。
### 验收要求
实际版本与覆盖未取得。

## [REQ-BOOK] 预约改期
### 需求内容
改期包含时段校验、通知、费用处理。
### 范围边界
三个实施批次，仍是一个业务要求。
### 验收要求
不得将任一批次 close 当整体通过。

## [REQ-PERM] 接口权限
### 需求内容
接口权限校验。
### 范围边界
同一任务可为审计提供操作人字段。
### 验收要求
尚无实际接口检查。

## [REQ-AUDIT] 客户审计
### 需求内容
操作人、查询及导出。
### 范围边界
提供操作人字段不完成全部查询与导出。
### 验收要求
分别核对覆盖，不按 task 数计算。

## [REQ-LOG] 断电日志恢复
### 需求内容
待同步日志恢复方案未知，可先受限探索。
### 范围边界
不得上传设备原始数据，诊断同样遵守；并非禁止所有联网。
### 验收要求
探索不可行可结束探索，产品要求仍未交付。

### 诊断约束补充
不得上传设备原始数据，诊断同样遵守。其他联网仍按现有范围判断。
## [REQ-EXCEL] Excel 金额导入导出
### 需求内容
订单金额导入、处理、导出。
### 范围边界
E6A/B/C 是实施工作，复用 CSV 函数不恢复 retired CSV 要求。
### 验收要求
整数历史 PASS 不覆盖小数新输入；新失败需单独对账。

## [REQ-ERROR] 导入错误提示
### 需求内容
仅采纳选定议题二：错误必须显示行号与原因，便于用户纠正。
### 范围边界
云同步和多设备未采纳；未取得其他观点不转为正式义务。
### 验收要求
按实际输入核对行号和原因，当前尚未执行此检查。
## [REQ-MULTI] 多设备备选
### 需求内容
多设备是备选，不是本期决定。
### 范围边界
未采纳不一律等于否定。
### 验收要求
无 task 仍可见。

## [REQ-REPORT] 报表优化
### 需求内容
报表优化被审计导出推迟。
### 范围边界
保留原安排及延期理由。
### 验收要求
延期不计已完成。
