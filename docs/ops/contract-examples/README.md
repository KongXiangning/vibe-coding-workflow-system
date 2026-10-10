# VN-02 当前只读查询共用响应

状态：2026-10-11 契约交接样例。唯一字段与行为约定在 [ASSISTANCE_API.md](../../../runtime/vnext/support/ASSISTANCE_API.md#read-only-consumer-contract-vn-02)，本目录不建立另一套 Schema 或 reducer。

修订 0.3.1：保留原 20 个 query cases，增加 3 个 snapshot_examples 和 9 个 consumer_scenarios，区分实际保存的文件投影与消费侧输入变体；没有执行 TraceLens 实现。

[task-query-v1.json](task-query-v1.json) 是 JSON 文档，含 command、request、response、expectation 和 provenance。command 只描述合成调用，不允许作为项目提供的可执行命令；root 必须来自 TraceLens 登记，入口必须按契约重新解析。样例 task_id、事件引用、版本戳、时间和结果都属于临时合成目录，不能用于业务项目调用或判断。

| case.id | 来源与应验证的消费行为 |
| --- | --- |
| summary、summary-next | 实际源码 CLI；有事实无缓存，分页保持版本与全局计数。 |
| task、step、closed-task | 实际源码 CLI；完整任务、精确步骤，执行／失败测试／关闭与未完成分开。 |
| context | 实际源码 CLI；任务只在 management。 |
| source-read、source-read-next | 实际源码 CLI；base64 字节分页，不要求 task-query kind。 |
| unresolved-task、unresolved-step | 实际源码 CLI；available 但选择未解决，不擅自替换对象。 |
| invalid-selector、source-failure、unsafe-source | 实际源码 CLI；INVALID_QUERY、ENOENT、UNSAFE_PATH，均退出 1。来源失败不使 Task 消失。 |
| view-changed | 实际源码 CLI；模拟正常事实追加后，以旧分页请求得到 QUERY_VIEW_CHANGED，需重启读取。 |
| empty-retained-facts | 实际源码 CLI；空事实集查询不写文件，不会凭安装创造历史任务。 |
| unknown-additive-field | 人工响应变体；新增未知字段忽略。 |
| optional-fields-absent | 人工响应变体；title／counts／current_step／projection 缺失只影响相关显示。 |
| required-field-error、required-field-absent | 人工响应变体；task_id 类型错误／view_revision 缺失，相应结果不能当成正常视图。 |
| unrecognized-kind | 人工响应变体；不能识别 kind 时降级，提示配套更新。 |

真实 CLI 共 15 例，消费输入变体共 5 例。合成目录的文件路径、mtime 和内容 SHA-256 在只读请求组前后完全相同；追加事实后的版本失败查询也未再改写文件。消费变体只有约定预期，未执行 TraceLens 类型校验、降级或 UI 测试，不能报告为消费实现通过。

普通原始 read 的响应无 kind；status=read 是该操作的成功标识。分页 data 需要 base64 解码后拼接；不要拼 text_preview。详情请求中的 expected_view_revision 是本次示例消费方补入的，Runtime 返回的 detail_request 当前只有 home 和选择参数。

## 修订后的入口与快照样例

以下是同一个 JSON 文档的附加交接资料，不是新 Runtime 请求或字段。不要把 consumer_metadata 发送给 Runtime，也不把消费侧诊断写成 Runtime 退出码。

| 样例／场景 | 来源与一致性预期 |
| --- | --- |
| existing-file-without-runtime | 实际源码 task 操作在独立临时目录发布的 task-view/v1；目录没有安装入口，直接只读固定快照文件。读取前后字节和 mtime 不变，原生投影没有 generated_at。可显示两个旧视图 Task，已关闭项仍保留 OLD 缺口；不声明 live 成功。 |
| snapshot-unknown-kind、snapshot-required-field-absent | 人工文件变体：未知 kind、缺 state_completeness 时不认可完整快照；保持来源诊断，改用可用同上下文内存或显示任务暂不可用。 |
| trusted-installed-entry | 人工宿主登记场景：明确选定可信来源并核对四模块真实摘要后才执行固定只读命令。样例符号摘要不是实际分发校验依据。 |
| root-registration-only、runtime-bytes-replaced、runtime-module-missing | 人工宿主登记场景：仅有项目 root／同路径文件、字节变动或缺模块，均不启动进程；不由刷新自动建立信任，可安全读取已有快照。 |
| snapshot-output-over-budget、snapshot-unreadable-file | 人工故障场景：不使用截断或读取失败的文件作全量视图，不补成零任务。 |
| partial-memory-batch | 人工消费场景，引用原 summary／task／step 样例的同版本结果：保留未读页、缺详情及原读取时间，复用时另记 reuse_at；不能宣称全量或实时。 |
| snapshot-context-changed | 人工消费场景：副本或配置改变后，旧内存批次不可复用。 |
| snapshot-list-live-detail-mixed | 人工消费场景：不同来源／版本不能拼接；文件已带步骤可读，其他详情单独不可用或整体刷新。 |

snapshot_examples 的实际文件与原 query cases 是不同临时副本、不同 view_revision，故意不共享身份。文件读取的 source_revision／view_revision 只是已保存的版本；read_at、file_mtime、未提供的 generated_at 和 freshness 在独立 consumer_metadata 中表达。生产方与消费方后续实现都须遵守这些预期，本轮的静态核对不替代真实信任登记、预算、缓存或页面测试。
