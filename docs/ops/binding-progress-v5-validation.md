# 需求实施关联与进度聚焦：v5 生产交付与验证

日期：2026-10-13 UTC（方案日期为 2026-10-14）。输入：BINDING-PROGRESS-v2。
固定源码基线：`dcf7b0af7a65c53bde7218eac3a3639921d59d31`。本轮在隔离 Linux 云目录执行，Node v24.19.0 / Bun 1.3.10。

## 1. 实施范围

C0/V1/V2 已落实到生产源码、生成资产、安装和实际宿主路径：

- `vnext-product-doc/v5` 继承 v4 Roadmap；仅 v5 TaskBinding 增加可选 `contribution: direct | supporting`。旧 v1–v4 Schema 与基线逐字节一致。
- v5 parser/model/writer/check、反向关系与 `plan_tasks`、离线读者、模板、正式契约及分发同步。未知未来版本不自动兼容。
- 新建/重分类的 v5 active 绑定要求具体 coverage/reason/sources；旧缺分类可保持。新 reference+direct 要求澄清，原样历史只诊断。
- contribution 不作为重复关系身份，不把冲突中的 direct 自动选为权威；沿用同 ID 更正、已否定关系保护、逐文件 optimistic hash、preimage 和回读。
- 需求定义算法未改，纯贡献纠正不变更义务摘要；可变整文件引用仍诚实报告字节差异。
- 一份共享判定 reference 接入 maintain-project、prepare/adopt 后绑定、execute/debug/review/validate/close；存量重判覆盖义务解释、关系、交付与必要安排。普通开发不新增检查门槛。
- 未改 Task reducer/生命周期语义；`kernel.ts` 仅发行版本常量变化。没有全局需求状态机、自动下一 Task 或新的关联中央库。

## 2. 版本与分发

正式源码版本同步为 **0.24.10**，没有发布 npm 或部署。

本轮发现若沿用 0.24.9，新受管文件会被正常升级器视为同版本 drift，因此做了必要的 lockstep 升版，并验证真正的基线升级，而不是只把测试 state 改成旧版本。

- 候选 bundle：`bundle-e13beab22ce7fac54bb37f25`
- Distribution manifest digest：`936f3308775cf8402fa4e27c8360f1bf3a5c00321a1ed2d36214a1fd78c2a412`
- v5 Schema SHA-256：`a3797f92ba11e1b678c78b77d82a37e8501bb26cf8794b038cdaecbe0a9f3561`
- Node helper SHA-256：`27c3c2d4759c06e3d911469ca9ad812a50891ab59178f08f3f52b33e67cba893`
- Offline reader SHA-256：`4fd4f5538f19dcc1417dbd9f6940f1ebe86b8df9172a36a276769104d42f69c2`

从固定基线源码实际构建 0.24.9，安装到隔离目录，再正常升级 0.24.10：`upgraded / read_back_verified=true`；7 份原业务/事件文件字节不变；再次升级 `no-op`。没有修改 Distribution State 来伪造此路径。

实际宿主也先通过正常安装，再在重判完成后升级至 0.24.10：54 份业务/记录文件字节完全保留，重复升级 no-op。初次 npm 缓存目录权限不足通过指定隔离临时 npm cache 解决，没有改变系统安全设置。

## 3. 已执行的源码与安装检查

| 检查 | 本轮结果 |
|---|---|
| product-maintenance / v3 / v5 / Roadmap 四文件定向回归 | 89 pass，0 fail，1731 assertions |
| 隔离分发安装与旧数据保全 | 4 pass，0 fail，330 assertions |
| 源码/宿主契约测试 | 22 pass |
| 原 Task 管理（含父任务续接） | 54 pass |
| 源契约 validator | 通过 |
| 正常 runtime/helper/distribution 构建 | 通过 |
| protocol 验证、生成新鲜度、git diff --check | 通过 |

遵循仓库 AGENTS，没有自动执行 `test:workflow-all`。定向通过不冒充全仓所有检查、全部宿主或平台通过。实际命令和输出在 [checks](binding-progress-evidence/checks/)。

## 4. 实际宿主行为证据

这是未预填新正确分类的隔离合成案例，由实际 Agent 读取安装 Skill、原需求、Task 原采用范围、源码和测试输出后完成维护；独立来源复核在操作前形成参考结论，操作后逐字节核对一致。不是脚本预填枚举后只测 Schema。

1. 仅分析阶段，44 个既存输入文件 hash 不变，旧 Runtime 四个事件不变。
2. 实际 prepare/adopt 新 TASK-002，范围为三类解析错误输入的验证；未执行测试。最终单步 `not-started`，executions/tests/reviews 均空，未把采用当作执行。
3. 旧 `B-OLD-PARSER` 同 ID 补直接实施，新验证保存单独 direct verification；旧 `B-OLD-BATCH` 同 ID 从 direct 改为 supporting，明确不覆盖上传/预览/确认/批次历史。
4. 字号已 dismissed 关系无新依据不复活；归档资料不足仍缺 contribution、task_id=null，不新造 Task，不强填分类。
5. 同一 apply 两文件中 PARSE 成功，BATCH 因故意错误 expected_sha256 被拒；保留成功部分，仅重试 BATCH 管理写。此为故障注入，**没有验证真实外部并发编辑器竞争或跨文件事务**。
6. 原文件通过正常 preimage 机制保存；为此只把该合成项目 capture_paths 最小增加 history 目录并保留 manifest 原字节。
7. 保存有限 PARSE-BASE Assessment，依据已有两项实际测试与同 SHA 源码，明确不是新三类验证已运行，也不涵盖交互/归档/字号。当前指定 scope/subject 回读为 satisfied；不是全项目完成。
8. 重复无新材料维护：422 个文件新增、删除、字节、mtime 变化均为 0。四个需求正文及定义摘要、旧 closed Task 的完整对象/焦点、原事件均保全。

原始输入、保存后材料与实际工具响应见 [证据目录](binding-progress-evidence/README.md)。新 Task 只增加 prepare/adopt 两个事件，没有重复执行业务工作。

## 5. 验收映射与未验证范围

| 范围 | 本轮证据与边界 |
|---|---|
| QA-01/03/04/14–16/21–24/34/35/41–44/49 | Schema、读写、同 ID 修正、旧数据/混合格式、冲突及摘要定向测试；关键历史处置另有上述实际宿主记录 |
| QA-02/06/09/13/18/19/33/40 | 实际宿主的无依据不新增、未执行验证、只读阶段、局部保存恢复和有限成果；全部为合成业务范围 |
| QA-20/25/26/29/32/45–47/50/51 | 由生产 Roadmap/Assessment 回归与 TraceLens 同源 oracle/派生检查覆盖相应确定性边界，不能替代真实项目语义验收 |
| QA-38/39 | 原 Task 管理与指导回归；没有引入 Runtime gate，未把管理保存失败升级为执行失败 |
| QA-05/07/08/10–12/17/27/28/30/31/36/37/48/52 | 需结合 TraceLens 的消费者测试及边界记录；本仓不单独宣称图形/全部平台通过 |

TraceLens 对同一正式 v4/v5 契约做了只读消费、贡献/焦点摘要与缓存升级。其独立检查和本轮 UI 限制记录在对方仓库 `docs/ops/binding-progress-v5-validation.md`。

**未验证/未执行：**

- 浏览器 UI 验收未通过运行：本机 Chromium 启动受 socket 权限限制；受支持云浏览器与执行服务 localhost 隔离。单元/API/SSR 结果不冒充真实浏览器 PASS。
- 没有真实业务项目 J1 授权；未读取或修改 LawAgent、TermLink 或其他真实项目，未证明所有存量项目/模型可正确重判。
- 新准备的三类业务验证未执行；没有手机、Windows/macOS 宿主验证，没有 npm 发布或部署。
- 没有给 52 条矩阵逐条盖 PASS。表格是证据定位及局限，不是把源码测试扩张为所有行为已验证。
