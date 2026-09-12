# Runtime 按需上下文实施增量

授权：2026-09-12 用户确认本会话计划并要求实施。起点 HEAD `5d5cafef18fff8306371966f50855c400187f9be`，0.16.0，工作树干净。此增量不重新设计 S1–S5，不使用旧治理渠道，不修改真实任务，不执行新的业务 dogfood，不 commit/push/发布。

## 冻结范围

- 首触基线仍完整保存在现有 canonical。默认审查只输出累计文件目录、受限文本 diff 和必要上下文；增加按文件、行范围、字节范围读取，保留版本校验。
- Runtime 封装 rg 检索当前树中的旧测试、helper、fixture、配置；读取不制造修改/基线/报告。复用沿用既有 check 身份、subject_paths、相关版本失效与 P-12。
- 安装时优先复用兼容 rg；否则下载校验固定平台版本到项目 Runtime。沿用安装暂存、自检、目录提交及回滚。只读调用不下载；原始 validate 兼容，普通模型使用显式 summary。
- 不增加数据库、测试生命周期、Provider、AST、全局 Test ID、已删除 Git 历史索引或公共 Skill。能力版本 0.17.0，canonical 与业务证据版本不变。

## 接口与步骤

接口唯一详细定义：`runtime/vnext/support/CONTEXT_API.md`，随安装分发。实施顺序：只读读取/diff → rg 包装与安装依赖 → 现有 Skill 简短路由 → Runtime/安装版回归与分发一致性 → HANDOFF 真实记录。

## 验收义务

- 大基线、小修改保持精确首触内容和小输出；累计免审/repair 义务不变，旧 receipt 拒绝。
- UTF-8/长单行/CRLF、范围续读、二进制和链接、添加删除、缺基线及 diff 限制明确可见。
- 已有测试真实 rg 查找与读取，不自动产生证据；部分/失败/无匹配区分。
- 兼容 PATH、本地复用、无 rg、失败下载/校验/解包、受管目录所有权及回滚；安装版 Node CLI 正常入口无需源码 helper。
- 完整现有检查及生成同步。未运行平台、真实下载受阻或业务 dogfood 未做如实列出；自检通过不标 independent clean。

最终结果、验证数量和限制以 HANDOFF 追加记录为准。
