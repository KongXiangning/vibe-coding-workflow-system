# vNext 任务上下文与受管聚合存储量化报告

版本：0.19.5（源码与隔离分发验证）
审查基线：`4a8c36bdce57c9300170f8f999fc935ce065b460`
测量日期：2026-09-16

最终隔离分发包：`vibe-governance-0.19.5.tgz`；SHA-256：`18fa9b573f9cf42f59a45f7b1d13ffa24b4a818490cb40adda5aba662e7ddae0`。

本报告只测量源码仓库生成的通用、隔离 fixture，不包含上传样本、真实目标项目或业务名称。字节均为 UTF-8 序列化字节；没有宿主 tokenizer 或 usage 数据，因此不报告 token/费用。

## 默认读取与迁移边界

日常读取顺序是 `validate --summary` → `task-context(entry, mode)` → 跟随全部 required continuation → `task-read`/`file-context`/`review-read` 精确读取 → 原有 preflight、execute、review 或 lifecycle。`task-context` 是有界 DTO，不展开原始 RuntimeState；required 内容未读完时 `complete_for_operation` 为 false。

`CURRENT_TASK.md` 保留完整现行定义、当前状态、未完成义务、门禁和工作集引用。compact v2 只保留最多 8 条、最多 8 KiB 的历史导航预览；完整 execution/idempotency 事实由同一提交头承认的 `task-data/<document_id>` 读取。缺失、损坏、跨任务引用、pending journal 或 source/manifest 冲突均须阻塞，不能退化为空历史或无界 Markdown fallback。

软件升级不自动改写运行中的任务。`task-storage-migration` 必须先 preview，再确认精确 `source_revision`，最后 commit；迁移保存旧 CURRENT_TASK 原字节、已知历史及旧 locator，未知/缺失材料保持明确缺失，不改目标、验收、预算或业务结论。

## 字节测量

测量 fixture 依次经过真实 `prepareDraft`、`confirmDraft`、`preflightStep` 与 `recordStepResult`；最后一步记录了一个真实的 blocked step-result，未直接调用 store 写入伪造成功。上下文响应按 `JSON.stringify(response)` 测量，包含协议元数据；本 fixture 每页均在默认 16 KiB 预算内完成。

| 指标 | 实测值 |
| --- | ---: |
| `CURRENT_TASK.md` 原始字节数 | 7,726（确认后 4,465；真实 step-result 后 7,726） |
| 首次 `preflight-step` 操作上下文完整响应 | 8,236；1 页；`complete_for_operation=true` |
| 同一 `definition_revision` 的后续操作上下文完整响应 | 5,604；1 页；显式复用定义；状态事件后为 8,019 |
| task store 总字节数（对象、事件、索引、manifest） | 52,502（对象 37,965；事件 8,757；索引 4,133；manifest 1,647） |
| 每次代表性真实事件新增独有存储 | 23,230（store 由 29,272 增至 52,502） |
| 必需信息续读总量与模型可见响应总量 | 首次 8,236；后续 5,604；均为 1 页、无未展开 required 内容 |

上述 store 在测量结束时通过 `aggregate-and-full-history` 校验：4 个已提交事件、4 个幂等条目、19 个对象，状态为 `valid`。当前状态事件使 CURRENT_TASK 从 4,465 增至 7,726，属于当前工作状态/阻塞记录的真实增长，不是无关历史增长。

## 等价性与完整性

等价性与完整性检查已覆盖：完整 Runtime suite 185 tests / 2,157 assertions；system-E2E 16 tests / 625 assertions；task store 测量 fixture 的 current aggregate 与 full history 均为 `valid`，保留其 4 个事件、4 个幂等键及对象引用。Unicode 分页、迁移前后模型等价、事务阶段恢复、索引重建、早期历史查询和固定分发包 CLI 读回分别由 vNext task-context/task-store、Runtime/recovery 与 system-E2E 测试覆盖；这些字节值不代表真实目标项目业务验收。
