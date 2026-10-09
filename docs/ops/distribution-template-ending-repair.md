# 分发模板末尾空行兼容修复

适用版本：0.24.4 起。本文补充现有分发升级行为；历史分发设计和证据保持原样。

## 问题与边界

TermLink 的 0.24.2 安装状态中，19 个纳管模板、示例 Markdown 的实际文件末尾为
一个 LF，而旧分发摘要对应两个 LF。正文逐字节一致，但升级因摘要不一致而拒绝。
这是末尾空行数量差异，不是文件未以 LF 结尾，也不能据此确定是 Git 删掉了空行。

修复仅用于 `upgrade`，并限定在已被旧安装状态纳管的以下路径：

- `.workflow-system/runtime/support/product-maintenance/templates/` 的已知 Markdown 格式模板。
- `examples/e6/docs/product/`、`examples/planning/no-plan/docs/product/` 和
  `examples/planning/multiple-plans/docs/product/` 下的 Markdown 产品文档示例；
  这些目录同样位于上述 `product-maintenance/` 分发支持目录。

## 比较与升级

旧状态只有原始字节摘要，没有旧文件正文。升级器保留目标文件中末尾 LF 之前的所有
原始字节，并重建 0～32 个末尾 LF 的候选摘要。只有某个候选与已记录的旧摘要完全
一致，才确认属于格式差异。这个上限限制旧分发候选的重建开销；不限制目标末尾 LF
数量。旧模板正文可以与新版不同，因此正常模板内容更新仍能升级。

不做 `trim()`、CRLF 转换、尾随空格处理或语义解析。不放宽 Skill、协议、运行时、
schema、原文附件、示例 raw 文件、项目资料和历史证据的字节检查。未登记所有权、
正文变化、缺失文件及冻结路径继续按既有规则处理。

可处理的差异显示为 `TEMPLATE_ENDING_NORMALIZED` 提示。预览不改目标文件；实际
更新通过原有事务写入新版完整字节。依赖暂存后重新检查纳管文件，正文在暂存期间
改变会停止发布。成功回读仍逐文件核对原始发布摘要，状态文件不记录虚假的摘要。
失败回滚使用实际原始文件，恢复用户修改过的空行数量和旧状态文件，而非规范化正文。
同版本 `upgrade` 也能执行这种事务修复；同版本 `install` 仍要求精确回读。

实质编辑的保留、合并或新版副本策略不在本次修复中，正文冲突不会被静默覆盖。

## 本次验证

环境：Windows；Bun 1.3.10 构建及 TypeScript 测试；公开分发 CLI 由 Node 执行。

`test/vibe-governance-distribution.test.ts` 定向执行 9 个用例，结果 9 pass、0 fail。
其中 4 个新增回归用例检查真实 CLI 的预览及升级、旧版正文与新版不同、减少或增加
末尾 LF、同版本修复、冻结注册、正文与尾随空格变化、未纳管文件、其他软件及原文
文件仍被保护，以及注入发布后失败时的原始字节回滚。其余复用既有新安装、同版本
读取、身份对齐、项目指引事务及旧纳管文件清理场景。

Runtime 构建、`validate:protocol`、`validate:freshness`、`validate:vnext-source`
与 `git diff --check` 通过。未执行 `test:workflow-all` 或完整分发测试套件。
这些是源码和隔离安装检查；实际目标项目升级结果以升级事务回读为准。
