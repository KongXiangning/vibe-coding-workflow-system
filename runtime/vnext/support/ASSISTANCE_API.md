# vNext management API — assistance, not admission

```sh
node .workflow-system/runtime/support/assistance.mjs <command> --root <project>
```

Source-repository equivalent: `node runtime/vnext/support/assistance.mjs`.
Input is JSON on stdin. Commands: context, task-status, task, record, snapshot, read, find, git-checkpoint.
Native modules assistance.mjs and task-management.mjs use Node built-ins, not the old
transaction/qualification kernel. The service never executes product commands or tests.
`task git` reads local commit objects but writes the requested association and management
views. It is optional, for explicitly requested persistent associations; ordinary commits
are verified and reported directly from Git without calling it. It does not commit or push.

## Two responsibilities, separate results

User instructions and Skills determine work and informed workflow-deviation choices.
`record` preserves arbitrary observations; `task` maintains identity, adopted plans,
steps, execution, reviews/dispositions, Git observations and closure in the same journal.
Do not substitute a generic note for a task operation. Full action shapes, examples and
existing-record recovery: **TASK_MANAGEMENT_API.md** beside this file.

Every response retains development_gate=false and qualification=not-evaluated. These are
not permission grants or PASS. Task operations report fact persistence, association and
view publication independently. A projection/association failure never discards the saved
fact or revokes a still-visible user decision; it also is not complete management success.

State queries use `task-status` or `context.management`, computed from all task facts.
CURRENT_TASK is a generated presentation, not a second current authority. A stale display,
one literal-search page or a raw legacy tuple must not decide the current task. Read-only
queries rebuild in memory and report projection freshness; they do not write files.

One-time confirmation for material workflow deviations is in WORKFLOW_PROTOCOL. Read,
search, save and deterministic view maintenance need no new approval. Ask only about an
unresolved choice with real consequences. After the choice, perform the actual operation
and update its view, without legacy gate/waiver/preflight recovery. Never fabricate consent,
PASS or independent review. A user's review disposition does not edit the review verdict.

## Task queries: full computation, on-demand presentation

Derived prerequisite tasks use explicit origin, entry checkpoint, dependency outcome and
return policy; full action shapes are in TASK_MANAGEMENT_API.md. Reads and task operations
expose actual `next_task_id`/`next_step_id` alongside route/mode/action. These describe the
current focus, which can differ from the affected or explicitly selected task. Summaries
retain origin, dependency/return state and continuation; closure never implies fulfillment
or automatic parent-step finish. Focus restoration performs no business commands.

The CLI defaults for `task-status`, `context` and `task {"action":"status"}` are
now compact. All still rebuild from the entire journal before selecting output;
this is not an incremental cache, truncated search or change to state semantics.
The compiled CLI's ordinary `task-context` delegates to the same native entry.

| stdin field `detail` | Returned task content |
| --- | --- |
| `summary` (default) | One page of task summaries: identity, lifecycle/plan refs, current step result/review/decision refs and counts, remaining work and advisory routes |
| `task` | One complete selected task, including its plans, steps and histories; other tasks are not expanded |
| `step` | One step from the selected task's adopted/legacy plan, including its effective execution, tests, findings, decisions and effective review; not all historical executions |
| `full` | The original complete response shape, for existing CLI consumers and explicit diagnostic/export use |

Use `task_ref` with a stable ID or unambiguous display number to select a task.
Without it, task/step detail uses only the reducer's unique current focus. A missing
or ambiguous selection stays null with `selection.status=unresolved`; it never falls
back to another task. Step detail requires an exact `step_id`, and reports
`selection.step_status`. Read historical plan/event refs using `read`, or obtain the
selected task's complete history with `detail=task`. Query selectors are not task
mutation fields: use `task_ref`, not `task_id`; `plan_ref` is not a query selector.

Each line below is a separate stdin request, not one combined JSON document.

```jsonl
{"detail":"summary"}
{"detail":"task","task_ref":"<returned stable task ID>"}
{"detail":"step","task_ref":"<returned stable task ID>","step_id":"<actual step ID>"}
{"detail":"full"}
```

Compact `task-status` returns `kind:task-query/v1`; `context` puts the same response
once under `management`, without duplicate top-level tasks/current_task or a raw
first search page. Use `current_task_id`, `selection`, `tasks` and their
`detail_request` values for navigation; compact results do not contain the old
full `current_task` object. Read needed plan/step details before reasoning about
implementation or review; an omitted body or a ref does not mean it has been read.
All generated detail and pagination requests retain the effective workflow_home,
including an explicit override or a profile-resolved home. Following a request keeps
that directory context without changing task focus or creating management writes.

Summary tasks use `offset` (default 0) and `limit` (default 20, maximum 100).
`task_count` and `lifecycle_counts` always cover all reconstructed tasks;
`pagination.total` covers the selected output list. Follow
`pagination.next_request` until null. Continuation includes
`expected_view_revision`; a changed live view returns `QUERY_VIEW_CHANGED` and
requires restarting this read, not workflow repair or user approval. This is a
cross-read consistency check, not a transactional snapshot of concurrent writers.
`state_completeness` describes associations, not whether all output pages were read.

Global `issues`, `unassociated_records`, health, source/view revisions and projection
freshness remain visible on every compact page, even when selecting another task.
Diagnostics are not filtered, paged or silently clipped. `coverage` explicitly
states which history is not expanded. Summary/detail are not fixed-token-budget
interfaces: unusual diagnostics or requested full task bodies may still be large.

Existing JS exports `taskStatus`, `context` and `task` retain their full result
contracts. New exports `queryStatus` and `queryContext` implement the compact read
presentation used by the CLI. Mutation results, immutable event/evidence bytes,
CURRENT_TASK publication, the reducer, `read` byte paging and `find` cursors are
unchanged. `detail` never changes how a mutation is recorded or authorized.

### Read-only consumer contract (VN-02)

确定日期：2026-10-11。本节固定现有 CLI 的 TraceLens 消费约定，只维护 `task-query/v1`
一套当前接口。软件发行版本用于诊断，不是另一条协议分支。本轮未改 Runtime 实现。
修订 0.3.1（2026-10-11）补齐宿主可信登记与既有文件快照降级；这两项是消费契约，尚未在 TraceLens 实现。
源码样例为 `docs/ops/contract-examples/task-query-v1.json`，验收记录为
`docs/ops/vnext-contracts-vn01-vn02-validation.md`；它们尚未随分发交付。

#### 可信入口和项目上下文

服务端从用户登记的项目／工作副本 root 解析唯一固定入口
`<root>/.workflow-system/runtime/support/assistance.mjs`，使用宿主可信 Node 可执行文件，
以参数数组传入 `task-status` 或 `read`、`--root` 和绝对 root，JSON 只走 stdin，不通过
shell 拼命令。context 可用于额外导航，任务只读其 management。调用前确认 root、固定
入口及相邻模块存在，拒绝越界、符号链接／junction 重定向和未登记入口。**登记项目 root
只允许读取项目资料，不自动信任或执行目录中的脚本。**PRODUCT、正文、TaskRef、响应或
URI 不能另提供执行程序，也不能给固定路径的脚本补发信任。

assistance.mjs、task-management.mjs、task-event-codec.mjs、record-storage.mjs 须配套
安装。无需编译 CLI、kernel 或 npm 依赖；复制模块冒烟仍不等于构建产物安装验收。
缺入口不回退执行产品文件中的命令，不为项目启动常驻 HTTP 服务。

执行前，TraceLens 的宿主登记须同时具备：该 root／副本的读取身份；用户实际选择的可信
Runtime 来源；来自该可信来源的上述四个模块的 SHA-256；允许该副本使用这些已核对字节
执行 task-status／read／context 的选择。信任依据在宿主登记中保存，不能仅来自待观察项目
自己提供的 checksum 或“已安装”标识。可用来源是宿主已信任的分发清单，或用户明确选定
并核对的本机 Runtime 源目录；版本号和四个文件存在本身都不是信任依据。不需要新增
Runtime 握手、网络服务、approval token 或自动安装动作。

调用时核对固定入口及四模块字节与已选来源相符。未登记可信来源为 runtime-untrusted，
字节不符为 runtime-bytes-changed，缺模块为 runtime-incomplete；这些是**消费方诊断**，
不是 Runtime CLI 新错误码。均不启动该进程，按下面的快照规则降级；重新采用变动来源须有
实际的信任选择，不由刷新、文件存在或返回 kind 自动批准。此处只约定明确字节的信任，
不承诺仅靠普通文件检查消除所有外部并发替换；TL-01 须保留核对中变化的失败及读取边界。
信任失败也不限制 Agent 在项目中的已授权工作，不恢复 Task 准入。

root 是进程参数，不是 stdin 字段，响应也不回显它。workflow_home 是 stdin 可选字段：
显式值优先，否则 best-effort 读取 `.workflow-system/PROJECT_PROFILE.yaml` 中的标量
workflow_home，缺失／失败回退 docs/workflow 并保留可用诊断。home 定位当前／旧展示，
不是另一处事实存储，事实仍在 root 的 `.workflow-system/records`。消费方应将有效 home
绑定到项目登记，不能让返回请求扩展目录权限。

| task-status 请求字段 | 约束 |
| --- | --- |
| detail | 可选，默认 summary；另有 task、step、full。full 是原 task-view 兼容／导出形状，不是 task-query/v1。 |
| workflow_home | 可选，项目内相对目录或实际位于该 root 内的绝对路径；登记时宜规范化为相对路径。 |
| task_ref | 可选非空稳定 ID 或无歧义 display_id／显示编号；初次查到后用真实 task_id 导航，不用标题。 |
| step_id | detail=step 必填，只选 adopted／legacy plan 的精确步骤；其他 detail 禁止提供。 |
| offset、limit | 只供 summary；offset 默认 0，非负安全整数；limit 默认 20，整数 1..100。offset>0 必须带 expected_view_revision。 |
| expected_view_revision | 可选非空字符串；有值须等于本次 view_revision，首次 summary 可省略。 |

task_id、plan_ref 不是查询选择字段，提供即 INVALID_QUERY。缺省 task_ref 只采用唯一
焦点，无法解析不改选其他 task。指定 task_ref 的 summary 只分页该任务，但全局计数和
诊断不缩小。选择失败是 available＋selection.status=unresolved＋对象=null，不能
解释成 I/O 失败或无历史。step_id 无唯一匹配时 step_status=unresolved。

#### 响应必需字段与可选字段

“必需”指消费方识别结果的最小条件；当前附加字段不因此成为必需。缺失与明确 null
分别校验，null 只在表中允许时有效。忽略未知附加字段，不用闭合 Schema 拒绝整个响应。

| 层级 | 必需字段／类型 | 当前返回的可选展示及诊断字段 |
| --- | --- | --- |
| compact 成功结果 | kind=task-query/v1；detail=summary／task／step；status=available；workflow_home:string；view_revision:非空字符串；selection:object；issues:array；task_count:非负整数；lifecycle_counts:非负整数值对象 | source_revision、display_revision、runtime_role、development_gate、qualification、current_task_id、focus、next_task_id、next_step_id、next_route、next_mode、next_action、health、state_completeness、records_scanned、projection、recovery_options、unassociated_records、coverage、note |
| selection | requested_task_ref:string或null；task_id:string或null；status=resolved／unresolved | detail_request:object或null；step detail 还必须有 requested_step_id、step_status |
| summary | tasks:array；pagination:object | 不含完整计划／执行历史，正文省略不是无历史 |
| summary task | task_id:非空字符串；lifecycle=draft／active／paused／closed／ambiguous；detail_request:合法 task 请求，指向该 ID 和同一 home | display_id、title、lifecycle_ref、plan_status、adopted_plan_ref、adopted_by、legacy_plan_ref、legacy_source、current_step_id、current_step、counts、remaining_work、gaps；origin、dependency、dependencies、return_result、waiting_on_task_ids、continuation；advisory next_*、recommendation_only |
| pagination | total、offset、limit:整数；next_offset:非负整数或null；view_revision:等于顶层；next_request:同上下文合法 summary 请求或null | total 为当前输出列表数量，不等于有 task_ref 筛选时的全局 task_count；最后一页两个 next 值为 null |
| task detail | task:object或null；非null 至少 task_id、lifecycle、steps:array | 当前还有 plan、plans、adoption、candidate_plan_refs、executions、tests、reviews、review_decisions、commits、dispositions、origin、dependency、return_entry、return_result、dependencies、waiting_on_task_ids、continuation、heads、legacy_plan、计划及生命周期引用和路由；缺失的可选数组不证明没有相应事实 |
| step detail | task:object或null，非null 至少 task_id、lifecycle；step:object或null；selection.requested_step_id:string、step_status=resolved／unresolved | review:object或null；detail_request 指向 task 历史，不是下一 step；task 在此只是身份与计划引用摘要 |
| 完整 step | id:非空字符串；state:非空字符串 | title、environment、validation 等原计划字段；legacy_step_status、execution_ref、execution、review_ref、review_status、findings、review_choice、review_decision_ref、review_decisions、tests、disposition_ref、historical_execution_refs |
| summary.current_step | 有对象时至少 id、state；无当前步骤为 null | title、legacy_step_status、execution_ref、execution_result、review_ref、review_status、review_choice、review_decision_ref、disposition_ref、finding_count、test_count |

Task 的原计划和历史保留调用者业务字段，不另设业务字段闭合结构。step.state 当前可能为
not-started、executed、in-progress、finished、skipped、closed、ambiguous、legacy-state。
review_status 为实际 verdict 或 not-reviewed／ambiguous，execution_result 也保留原报告值，
不是封闭 PASS 枚举。未知局部值显示原值或未知；closed Task 可保留未完成步骤和失败测试。

resolved 必须与请求、返回 task_id 一致；step 还须匹配 step_id。必需字段错误、未知 kind
或不可识别 lifecycle 使相关查询区域不可用。可选 title／counts／review 缺失只隐藏相关信息；
可以用真实 ID 标识，不能将 null review 当成通过，也不能在诊断缺失时显示“无问题”。

#### 续读、详情与视图版本

每次查询绑定登记 root／工作副本身份、home、配置版本和请求批次。对返回请求只提取已知
选择字段，校验类型、范围及登记上下文再调用；不能直接执行其中的 command、root、文件名
或未知字段。task_id 只在该副本内定位，不跨项目／副本复用缓存。

pagination.next_request 已带 home 和 expected_view_revision。**detail_request 当前不自带
expected_view_revision**，只保留 home、task_ref；要保持 summary→task→step 同一视图，
消费方须补上首个结果的 view_revision。版本不一致时 QUERY_VIEW_CHANGED、退出码 1；
丢弃本批次混合结果，从 offset=0 重读。达到 TL-01 设定的有界预算仍不稳定时，显示暂不可用
或同一旧快照，不锁 Agent 正常写入，不调用 rebuild。view_revision 不是 Git SHA、业务版本
或跨读事务快照。下一次显式刷新开启新批次。

task_count／lifecycle_counts 覆盖全量重算，分页只影响展示。state_completeness 描述事实关联，
与是否读完分页不同。projection.cache/display 只表示保存投影的新鲜度，read_only_rebuilt=true
表示在内存重算；缓存缺失或损坏不能替代这个重算结果。全局诊断不按页／选中任务裁剪。

#### 文件快照与内存结果降级

主查询不可用、入口不可信、读取持续变化或超预算时，消费方可只读既有固定文件
`<registered root>/.workflow-system/records/task-view.json`，不执行不可信 Runtime 的 read
来取得它。宿主文件读取仍须核对 root、固定路径、普通文件、无符号链接／junction 和预算。
这是原有投影 `task-view/v1` 的消费，不是第二套查询协议、reducer 或新快照生产接口。

| 文件字段 | 可识别快照的最低约束 |
| --- | --- |
| kind | 固定 task-view/v1；不把 task-query/v1 或 CURRENT_TASK.md 当成同形全量文件。 |
| source_revision、view_revision、workflow_home | 非空字符串；home 必须归属同一登记上下文。revision 仅是文件已发布版本，不能证明覆盖最新事实。 |
| tasks | 完整数组；成员至少有 task_id:非空字符串、合法 lifecycle、steps:数组；步骤沿用上面的完整 step 条件。任务 ID 在该文件内唯一。 |
| issues、unassociated_records、state_completeness | 两个数组及非空字符串；保留已发布诊断与关联缺口，缺这些字段不能宣布已识别完整任务视图。 |
| current_task_id | 字符串或null；有身份时须在 tasks 中可唯一定位；current_task 如提供须同身份，否则相关焦点信息不可用。 |
| 附加字段 | current_task、focus、health、next_*、display_revision、heads 及完整历史可以存在；未知附加字段忽略，不从可选缺失推断无记录。 |

只有整份文件在预算内读取、JSON 可解析且上述字段可识别，才作为文件快照。文件读取
前后应核对同一文件版本；读取中变化则有界重读，仍不稳定按不可用处理，不组合两次
读取的片段。损坏、未知 kind、必需字段错误、路径不安全或超预算时保留具体诊断，不解析
截断前缀后冒充全量，不通过遍历 journal／CURRENT_TASK 补齐它。tasks=[] 只说明这个旧文件
为空，不证明当前零任务。
task_count／生命周期统计可从文件 tasks 计数，但须一直标为快照计数。

消费侧另带来源说明，不写回文件／Runtime：source=file-snapshot、固定逻辑路径、绑定的
root／副本和 home、source_revision／view_revision、实际 read_at、可取得的 file_mtime，
freshness=stale-or-unknown、query_failure。file_mtime 是文件修改时间，read_at 是本次读取
时间，均不冒称业务发生或生成时间；本格式没有可靠 generated_at，未提供时明确写未提供。
这组说明是消费视图字段，不得伪装成 Runtime 响应字段或成功查询。

没有可用文件时可保留同 root／副本、同 home、当前登记配置下的最近成功内存批次，标为
memory-snapshot，保留原 query_read_at 和本次 reuse_at，freshness 同样不能称实时。内存
summary 只包含已取得的页与详情，要保留原分页／覆盖范围；未读页或未缓存详情不可用，
不能补成空。配置或登记身份改变后的旧批次不再用于当前项目。文件优先；二者皆不可用则
任务数据暂不可用，产品资料仍独立可读。

一次降级展示只用一个来源与一个 view_revision，文件自带的 Task／Step 可以下钻；未缓存
或不可读的详情单独不可用，不拼接 live 列表、旧文件详情或另一批内存。不可变来源字节的
独立 read 不改变任务快照来源；若 Runtime 本身不可信，来源只按宿主已有安全读取能力
读取，不能为来源重启它。具体预算、重读和缓存实现仍由 TL-01 负责，关闭／重建／安装均
不由降级触发。源码 JSON 样例中的 snapshot_examples 与 consumer_scenarios 仅为交接资料。

#### 来源 read、字段和失败

按明确 ref 或 TaskBinding 的登记文件来源调用同一入口的 read，还须通过消费方的项目来源
范围检查。SourceRef.uri／text 不是文件请求；read 不按 item_id／section 拆正文，可以取得
字节后定位。不用名称或 URI 拼进程命令。普通 read 请求如下：

| 字段 | 当前约束 |
| --- | --- |
| path 或 ref | 二选一，项目内文件／保留对象引用；同时提供时 path 优先，消费方宜拒绝歧义。绝对路径仍须在 root 内。 |
| sha256 | 可选，实际 64 位摘要；可独立定位保存证据或配合 ref 核对。缺历史对象不能用当前文件猜原字节。 |
| workflow_home | 同登记上下文；固定证据定位可能使用该 home 的既有 evidence-objects。 |
| offset | 字节偏移，默认 0；实现对非法偏移回退 0，消费方须先校验非负安全整数。 |
| max_bytes | 默认 8192、上限 65536；实现对正整数截到上限，其他值回退默认，消费方传合法预算。 |
| format | 主路径省略，返回原始字节；logical-task-event 是有展开预算的完整逻辑事件，不允许 sha256 或非零 offset，不作为普通分页。 |

普通 read 成功必需：status=read、ref:string、size/offset:非负整数、next_offset:整数或null、
encoding=base64、data:string。text_preview、sha256、actual_sha256、storage、verification、
read_metrics、issues、note 为附加字段。精确恢复只解码 data，UTF-8 preview 可能截断字符。
拼页须核对 ref、size、偏移和可用的实际摘要；可变文件跨页不稳定则重读或保留未知，不能
声称历史完整。优先引用不可变事件／证据。SourceRef.sha256 本身不证明当前适用性。

read 不提供 expected_view_revision 保护，未知输入可能被忽略；同批任务导航应给 task-status
加版本条件。原始 read 没有 kind 字段，不套用 task-query 的 kind 校验。逻辑事件响应包含
payload、wire_sha256 等，按该 format 单独处理。

CLI 可解析失败共同形状：status=unavailable、recorded=false、command、code、message、
development_gate=false、qualification=not-evaluated，退出码 1，失败不一定含 kind。
INVALID_QUERY、QUERY_VIEW_CHANGED 是请求／版本错误；ENOENT、UNSAFE_PATH、
HISTORICAL_OBJECT_UNAVAILABLE、OBJECT_CORRUPT、SOURCE_CHANGED 等是 I/O、范围或存储错误，
不成为 Task 门槛。进程启动失败、超时、输出超预算、非 JSON 或 stderr 是宿主查询失败，
保留真实原因，不伪造 Runtime 响应或零任务。单来源失败仅影响来源区；已定位 Task 仍可打开，
来源未核对与明确身份矛盾分别表达。

#### 只读、计算成本与交付边界

task-status、context、read 不写事实、焦点、labels、task-view 或 CURRENT_TASK。summary
仍读取完整日志并重算，响应更小不代表计算更便宜。TL-01 负责异步短进程、全局并发／输出
预算、请求合并、缓存及有限重读的实现和默认值；本包没有性能保证。

查询与正常任务写入可并存，不承诺跨读事务隔离。已有事实而 task-view.json 缺失可以重算；
仅安装 Runtime 而没有保留事实不能恢复丢失任务。确认的空事实集可返回 task_count=0，
失败或事实来源不完整不能当成真实零任务。

写侧 recorded/ref、association、projection 分别报告事实保存、解释关联、投影发布；保存成功
与投影失败可以同时存在。读侧保留诊断，不写修复。本契约不等于 TraceLens 接入、Schema
分发、完整安装或业务项目升级已完成。

## Raw facts: save first

`record` accepts arbitrary JSON. kind, task_ref, source_revision, body, links,
idempotency_key and files are conventional fields. Missing IDs or unknown kinds do not
prevent retention. Malformed JSON passed to record is retained as a raw observation.
The raw payload is saved before optional attachments; missing/changed attachments are
reported separately, not used to reject the report. Do not capture secrets/unrelated files.

```json
{"kind":"test-run","task_ref":"TASK-016","source_revision":"actually-tested-version","idempotency_key":"actual-run-1","body":{"command":"authorized selector","result":"failed","observation":"actual output"},"files":["reports/test.txt"]}
```

The result includes recorded, ref, payload hash, attachment references/issues and management
publication status. Exact replay returns the original record and does not recapture changed
files. Conflicting input with the same key is retained separately, linked to the original,
never overwrites it. Task-command retries compare the original semantic request, so changed
derived defaults/heads do not turn a retry into another adoption or task.

Raw records live in `.workflow-system/records/events`, attachment indexes in records/attachments,
immutable bytes in records/evidence-objects. Task events use this same store. task-labels stores
stable display allocation; task-view.json/task-views are rebuildable presentations. Original
legacy displays are retained under records/legacy. None are software distribution assets.

## Fixed evidence

`snapshot {"path":"reports/test.txt"}` captures an explicit regular file using buffered I/O.
An optional sha256 requests exact historical bytes. A saved digest is resolved first in the
journal, then in the existing workflow-home evidence-objects directory. Changed live content
is never relabelled with the old digest. Missing/corrupt original bytes are reported, not guessed.
This does not prevent new reports or other evidence from being saved.

`read` accepts a path/ref or sha256, workflow_home when needed, offset and max_bytes.
In-repository absolute paths and common separators are normalized. External and symbolic
paths are not followed. Historical reads do not require a live plan, current task or review.

```json
{"sha256":"<actual 64-character digest>","workflow_home":"docs/workflow","offset":0,"max_bytes":8192}
```

Read responses contain exact base64 data, text_preview, size and next_offset. Follow
next_offset until null. Decode base64 for exact reconstruction: the UTF-8 preview may split
a character at a byte boundary. Page limits are not evidence failures. There is no old
one-MiB qualification limit. Availability, historical truth and current applicability are
separate; an old PASS only reports that old run until current applicability is established.

## Navigation and literal search

`context {"task_ref":"TASK-016"}` returns unified task management plus legacy and journal
source navigation. workflow_home is optional; a simple profile hint is read best-effort.
For unusual/ambiguous YAML provide the actual home explicitly. No report save requires it.

`find` searches literal stored bytes, not decoded semantics of arbitrary historical payloads.
Use query and optional roots to narrow evidence searches. It returns paths/byte offsets for read.
Encoded legacy reports may need reading and decoding; do not claim decoded full-text coverage.

```json
{"query":"TASK-016","max_results":20}
```

Follow next_cursor with the same query. partial is pagination, not failure or permission denial.
A cursor is not an immutable snapshot; concurrent additions may need a fresh search. Unreadable
objects appear in issues without excluding other files. Do not interpret no hit on one page as
proof no plan, review or user decision exists; current state is a task-status query.

## Failures, recovery and compatibility

A real raw I/O failure returns unavailable, recorded=false and exit 1; do not claim it saved.
Preserve output through another authorized means and report unsaved state. A task request with
incomplete meaning can still be recorded with association=unresolved. Offer the relevant
rebuild/link/correct/resolve/defer operation, not hand editing or repeating user approval.
Rebuild never reruns tests, execution, git commit or deployment.

Unsupported legacy/free-text associations are reported with source refs. Supplement the real
meaning by linking records; do not replay preparation or confirmation. Unknown or conflicting
facts are not silently selected by latest timestamp. Corrections append, original bytes remain.

Existing file-context, historical task-read/export, knowledge and evidence APIs remain optional
specialized tools in CONTEXT_API.md. The compiled CLI's default task-context delegates to the
unified view after the software is rebuilt; --legacy explicitly opts into the old historical
reader, which may not parse the new CURRENT_TASK display. Do not use it for current status or
send accepted user choices back through old complete/replan/close gates.

## Git checkpoint: one git-commit invocation

The **Git checkpoint policy** in WORKFLOW_PROTOCOL makes an ordinary authorized task/stage
commit include project-wide persistent records, not just business filenames. It never grants
push or includes other tasks' business work. Narrow user instructions and an existing local-only
policy override it. This section is the internal recipe for git-commit, not another public Skill.

`git-checkpoint` performs read-only Git/filesystem inspection. It never stages, commits, writes
configuration, updates task state or deletes anything. All actions retain development_gate=false.
The Skill performs the authorized writes with normal tools. No separate user invocation or
per-record approval is required. API shapes are deliberately not permission/qualification tokens.

### Plan

```json
{"action":"plan","mode":"checkpoint","business_paths":["src/example.ts"],"exclude_paths":[],"untrack_derived":true}
```

Send this to `assistance.mjs git-checkpoint --root <exact Git worktree root>`.
`business_paths` are exact file or Gitlink paths whose intended diffs the Skill has identified,
not globs or an entire directory collection. `exclude_paths` are exact files or directory prefixes (never glob rules).
`mode=paths` restricts candidates to business_paths and proposes no configuration or untracking;
use it for an explicit files-only/staged-only instruction or an existing records opt-out.
`workflow_home` is supported as in other assistance commands. No task identity or clean state
is required. All tasks' records are considered because parents/attachments cross task boundaries.

`source=worktree` (default) plans the authorized working copies. `source=index` plans the
already prepared index content for business_paths: blob OIDs, Git modes and HEAD/index deletions.
For a staged-only request use `{"mode":"paths","source":"index","business_paths":["<selected staged path>"]}`.
These business entries are never placed in add_paths, and their working copies need not exist
or equal the index. The helper still detects later index content/mode changes and staged paths
outside scope. With checkpoint mode, source=index can preserve selected business hunks while
automatically selected management records and policy files continue to come from the worktree.

Index blob hashing uses fixed-size file reads after Git writes its raw output directly to a
private OS temporary file. Blob payloads do not pass through the 64 MiB command-output buffer.
Temporary files are removed after inspection, including errors; project files and the index
are unchanged. The synchronous API remains available, and temporary-storage/I/O failures are
reported as inspection issues rather than silently dropping selected content.

Business symlinks use mode 120000 and their link value, never their target's file bytes. Ancestor
symlinks remain unsafe for worktree I/O; index inspection does not traverse working copies.
Windows placeholders for tracked links are supported when core.symlinks=false. A Gitlink is
supported with source=index by its mode 160000 and selected commit pointer, without entering
or staging the submodule. Worktree planning reports GITLINK_INDEX_SOURCE_REQUIRED: review/stage
the intended pointer with native Git and re-plan using the index. Pointer verification does
not verify nested content, submodule availability, clean state or deployment. Evidence/record
I/O retains its regular-file and no-symlink boundary. Independent authorized native Git work
remains available when a requested operation is outside the helper's supported inspection.

The result is `kind=git-checkpoint-plan/v1` with `base_head`, a file manifest (path, role,
source, Git mode when selected from the index or a link, sha256, raw_git_oid, size, byte_exact), `add_paths`, `delete_paths`, `untrack_paths`,
configuration proposals, omitted paths, issues, reference_issues and counts. Keep the full JSON
in an **OS temporary file**, not under records or a distribution-owned path; show the user
counts, scope and actionable exceptions, not every hash. A plan is a snapshot of inspected
files, not a transaction over ongoing writers. Configuration proposals are not yet applied.
Gitlinks have no blob bytes: sha256/size are null and raw_git_oid is the commit pointer.

| Existing path | Default treatment |
| --- | --- |
| records/events/*.json, attachments/*.json, task-labels/*.json | Preserve, even if a saved report is malformed/unassociated |
| records/evidence-objects/<sha256>.blob, legacy/baseline.json, legacy/current-<sha256>.md | Preserve original bytes; retain and report known digest/reference gaps |
| Historical workflow_home/evidence-objects/<sha256>.blob referenced by structured attachment manifests | Preserve the actual referenced object with the same byte checks, including already tracked objects |
| legacy/display-<sha256>.md, legacy/display-capture-*.md | Conservatively preserve as **recovery material**, not as new task facts |
| task-view.json, task-views/, task-view*.lock, *.tmp | Local derived/temporary data; omit from default staging, do not delete |
| Other paths in records | Report classification-required, never silently collect or discard |

Historical object discovery follows typed content-addressed refs in attachment manifests,
including a different workflow_home used when capturing the attachment. It does not scan the
old workflow directory or follow arbitrary strings in reports. Explicitly selected evidence
object paths also retain their fact role and byte requirements in paths mode. User exclusions,
missing or unsupported refs and corrupt originals remain explicit reference gaps. Objects are
not copied into a new location or rewritten to repair their historical meaning.

Recovery snapshots intentionally remain in Git at this stage. The captured original file is
not moved, deduplicated, truncated or deleted; later writes through an existing descriptor can
still arrive and will be reported at the next inspection. This fixes checkpoint omission, not
physical file growth. A saved snapshot is not a backup of future writes or an audit certification.

### Scoped configuration and staging

For checkpoint mode, `configuration` proposes appended managed blocks in records/.gitignore
and records/.gitattributes. The attribute block disables text, filter, ident and working-tree-encoding
transformations for record bytes. Existing content/newlines are retained. A recognizable generated
CURRENT_TASK, byte-equal to its saved task-view, also permits a workflow-home/.gitignore proposal.
An edited/unrecognized display is retained and reported, not automatically hidden.
For selected historical objects outside records, the same policy proposes a .gitattributes
block scoped to *.blob in each referenced evidence-objects directory. These policy files use
the same preservation, exclusion, freeze and customization checks; unrelated legacy files
and unreferenced objects are not automatically selected.

Check each proposal's `before_sha256` immediately before applying it. Review existing project
rules, freeze governance and any custom filters/encoding; do not silently override an explicit
storage choice. A changed managed block or frozen target requires reconciliation, not replacement.
These are target-owned policy files created on the first authorized checkpoint, not software
assets overwritten by install/upgrade. Default setup can be completed in this invocation; only
an actually conflicting user-owned choice needs one combined question.

After applying authorized proposals, **re-plan** to include their exact files in the same commit.
Honor `SELECTED_PATH_IGNORED`, `TRACKED_FACT_CHANGED`, partial staging and scope conflicts. Do not
use force-add, blanket add, automatic renormalization or reset to make a plan pass. Existing corrupt
history may be saved unchanged with its known gaps; changing a previously committed immutable
fact is a different operation and must not slip in as checkpoint cleanup.

Stage only the listed authorized paths. For large lists or unusual names, pass NUL-separated
paths on stdin to `git --literal-pathspecs add --pathspec-from-file=- --pathspec-file-nul`.
When `untrack_derived=true` was authorized, remove only `untrack_paths` **from the index** using
`git --literal-pathspecs rm --cached --pathspec-from-file=- --pathspec-file-nul`, without `-f`.
This retains working files. No automatic untracking of staged derived changes is proposed.
Missing persistent files are reported, not turned into cleanup deletions. Explicit business
file deletions can be listed in business_paths; records are never implicitly deleted.

Review `git diff --cached` and the actual existing index. A list is not authority. For a staged-only
or partial-hunk request, retain the approved business index content rather than replaying a
whole-file add from add_paths. Include only explicitly authorized paths in the plan. The helper
verifies management bytes and path scope, not the intent or correctness of business hunks.

### Verify the index and actual commit

```json
{"action":"verify-index","plan":"<the parsed plan object, not its filename>"}
```

The example's plan placeholder must be replaced programmatically with the saved JSON object.
This checks the same HEAD, planned file presence, byte-exact records against Git index OIDs,
byte-preserving index attributes, requested index removals, source drift and unapproved staged
paths. `status=mismatch` is a real failed snapshot/scope check, not success. Do not pretend it
passed, force a commit or repair task state to work around it. Independent authorized business
commits remain possible when their own scope can be established; disclose unsaved records.
A known historical reference gap alone does not prohibit saving the available original bytes.

On a verified and reviewed index with actual staged changes, perform the user's normal Git commit
(no `-a`, bypassed hooks, implicit push or empty recursive checkpoint). Save the index verification
in OS temporary storage. Then pass the **actual full SHA** and that result back:

```json
{"action":"verify-commit","plan":"<parsed plan object>","commit_sha":"<actual full SHA>","index_verification":"<parsed verify-index result>"}
```

The actual commit's tree must contain the byte-exact record snapshot and only the authorized
changes relative to base_head; its tree fingerprint is also compared with the reviewed index.
This is for ordinary single-parent/root commits, not merge/cherry-pick/rebase automation.
No Git operation is replayed. Hooks or concurrent writers may change what is committed; report
any mismatch with the real SHA, without automatic amend/reset or claiming a verified checkpoint.
The plan is not an authorization object. Do not alter its scope merely to hide an unexpected diff.

`remaining_records` lists new/changed/unclassified local records that differ from the saved
snapshot, including ignored entries. `planning_issues` and `reference_issues` remain visible.
Missing objects, transformed object bytes and unsafe index attributes found during verification
also remain reference gaps; an earlier clean plan cannot make them report no-known-gaps.
Verification reads planned attachment manifests from the actual index/commit and checks their
typed object dependencies there, including legacy objects omitted by an older v1 plan. It does
not substitute the current working copies, scan arbitrary strings or enlarge the planned scope.
An omitted dependency reports a reference gap; a previously saved dependency is checked by its
actual Git mode, digest and attachment metadata even if it was absent from the plan. Available
planned bytes can still be snapshot_verified with gaps-retained; use a fresh authorized plan
to save a missing dependency. New records outside the plan remain pending for a later checkpoint.
`reviewed_index_compared` states whether the index comparison was supplied; omitting it does not
prove business hunks were preserved. `snapshot_verified` concerns only the inspected planned
snapshot; it is not task PASS, absence of secrets, future-write coverage or remote backup.
Use Git status for all remaining business/index changes as well. Commit success does not imply
push, deployment, task closure or that all records in the worktree were selected.

Inspection leaves project files, the Git index/history and task state unchanged; raw Git blob
inspection uses automatically cleaned OS temporary files. Verification mismatch exits 1 with
its structured result. Service failure also exits 1, with status=unavailable. A completed plan
exits 0 even with reported choices
or reference gaps. No state/record is written for these commands. Do not write task git/record,
refresh CURRENT_TASK, or recursively commit a new event merely to report the commit's own SHA.

## Indexed lossless record archives

`archive` changes physical representation only. It does not change task states, event
bytes, IDs, parents, payload digests or CAS identities. It has no development gate and
never runs automatically during installation, upgrade, task closure or Git checkpoint.
The installed module uses native Node built-ins. Existing old Runtime versions and
external direct-filesystem readers must retain loose files, or restore them first.

Send JSON on stdin to `node .workflow-system/runtime/support/assistance.mjs archive
--root <project>` (source checkout: `node runtime/vnext/support/assistance.mjs`).

| action | behavior |
| --- | --- |
| `plan` | Read-only eligible paths, exact sizes/digests and format limits |
| `create` | Copy stable eligible loose facts into verified immutable indexed packs; retain all originals |
| `verify` | Verify every selected archive/index/pack/chunk and reconstructed object, including loose collisions |
| `quarantine` | After complete verification, move matching loose originals into recoverable quarantine |
| `reclaim` | Separate explicit operation: verify again and remove only duplicate quarantined bytes; archive-backed restore remains available |
| `restore` | Recreate original paths and exact bytes from verified archives without overwriting conflicts |
| `recover-lock` | Explicitly recover only a demonstrably dead lock owner on this host; never steal by age |

`create`/`plan` accept optional `refs: [exact logical paths]`; no refs means all eligible
loose facts. `quarantine`/`restore` accept optional `archive_ids` and `refs`.
`reclaim` accepts `archive_ids` only and requires the complete archive to have been
explicitly quarantined. Omitted archive selection means all existing archives.
Read the preview and retain an independent project backup before actual project cleanup.
A request to implement or install this feature is not consent to clean a business project.

Only events, attachments, CAS evidence objects, task-label reservations, and preserved
legacy baseline/current files qualify. All display recovery files (including mutable
old-editor capture inodes), task-view revisions and CURRENT_TASK are excluded. Late
observations and attachments remain new loose facts; task closure is not a storage seal.

The immutable `records/archives/<manifest-sha256>/` directory contains a versioned
manifest plus numbered indices and packs. Blocks expand to at most 64 KiB. A segment
holds at most 64 MiB raw data, 2,048 record entries and a 4 MiB index; a large object can
span segments. Cold lookups route through manifests to matching indices, under explicit
16 MiB total catalog metadata / 4,096 archive limits. Creation checks the complete
post-activation catalog before publishing and refuses growth beyond these v1 limits
while retaining the original loose facts. Lookups fail with `ARCHIVE_CATALOG_LIMIT` rather than
silently omitting history. Enumeration and full task replay still scale with history.

`read` reports `storage`, `verification` and `read_metrics`. `indexed-selected-chunks`
means the returned archive page is bound to the verified index and block hashes; it does
not mean this page read recomputed the whole object's SHA-256. `archive verify` performs
that complete check. A loose/archive collision, missing index/pack, invalid path, hash,
length or unsupported format is an error. Never rename arbitrary bytes to a historical
SHA or fall back to an unverified duplicate.

The ordinary `read`, `find`, task replay, idempotent recording, snapshots and label
reservation operate on logical original paths. Product SourceRef reads and file-context
exact reads do too. SourceRef locator-free reads support byte paging; structured locators
retain their existing file-size budget. File-context whole-file reads over 64 MiB report
`READ_TOO_LARGE`; use assistance paging. Literal `find` uses range-only discovery: when both representations exist it compares
the selected loose range to the indexed archive page, and does not claim whole-object
duplicate verification for unread pages. A conflicting page is reported while independent
files continue to be searched; gaps are partial results. Native ripgrep file-context search cannot see
packed bodies and reports its archive coverage gap explicitly; use assistance `find`.
Product document writers cannot write into the managed records store, even when a custom
product manifest registers it as a capture target; use the record/snapshot APIs instead.

Checkpoint plans include all necessary manifest/index/pack bytes, validate typed logical
references, and account for explicit verified archive migrations in `delete_paths`.
Actual index/commit verification checks the stored packs, not the worktree's cached
claims. Review the exact plan before staging; the command itself never stages or commits.
Keep the archives and their indices in the same backup/commit. A fresh offline clone can
read and restore old logical refs without local quarantine receipts. A missing index must
be restored from the paired backup/commit; this version does not expose automatic index
reconstruction, although pack frames retain the reconstruction metadata. An explicit restore
materializes loose compatibility copies; keep/reclaim them deliberately before planning
the next checkpoint. No receipt recording the checkpoint's own SHA is needed.

Quarantine alone reduces files in the active record directories but does not save total
project bytes. Report archive bytes, quarantine bytes and final retained bytes separately.
Reclaim saves physical duplicate files while preserving every logical fact in the archive;
it does not erase old Git blobs or promise an equal reduction of `.git` history.

## Generation-side evidence and display reduction

### Fixed material versus this run's capture

`record` and `task` accept `evidence_refs`, an array of immutable `{ref, sha256}`
identities, or `{sha256}` for an existing content-addressed object. Optional fields are
`size`, `label`, `purpose`, `role`, and `workflow_home`. `ref` may identify an existing
record event/attachment, preserved legacy current baseline, or a content-addressed
`evidence-objects/<sha256>.blob`; a mutable business document path is rejected.
Obtain the actual identity from a record/snapshot/attachment result, the raw read's
`actual_sha256`, or a logical task-event read's `wire_sha256`.

The original observation is saved first. Each reference is fully byte-verified and
associated with this event in its attachment manifest as `status: referenced`,
`kind: fixed-evidence-reference/v1`, with `live_source_read: false`. No live source
is recaptured and no new evidence blob is created for that reference. Missing/corrupt,
wrong-size or invalid references produce explicit unavailable attachment entries;
they are never silently replaced with live files. A same-request retry reuses the old
event and manifest rather than creating another run.

`files` retains its existing meaning: capture the complete, explicitly requested current
bytes. The Runtime never crops a cumulative report, infers that similar runs are redundant,
or discards different failures, decisions, uncommitted states or database before/after
results. Use fixed old identities plus this run's necessary `files`; choosing those
materials is explicit caller/Skill policy, not automatic content inference.

Example record input:

```json
{"kind":"test-run","idempotency_key":"actual-run-2","body":{"run":"2","result":"failed"},"evidence_refs":[{"ref":".workflow-system/records/evidence-objects/<actual-sha256>.blob","sha256":"<actual-sha256>","role":"fixed-baseline"}],"files":["reports/run-2.txt"]}
```

### One full report, unchanged logical request

New task-generated events may use `task_event.version: 2` with
`data_encoding.kind: request-json-pointers`. The complete original request remains
inside this same event; repeated long data subtrees refer to that request through
validated event-local JSON pointers and its canonical request SHA256. No extra body
file or mutable external lookup is introduced. Encoding is used only if the complete
stored event becomes smaller and self-decoding exactly recovers the logical v1 payload;
otherwise it retains v1. Arbitrary raw `record` inputs are not rewritten.

The stored `payload_sha256` describes wire bytes' payload, not the hydrated logical
payload. Readers verify that digest first, then resolve only supported own-property
pointers. Bad/unknown versions, invalid paths, request mismatch or expansion limits
are explicit diagnostics; original bytes remain available. Old v1 bytes and IDs are
not rewritten. Replays compare the complete original request identity, so changed
heads or focus do not rewrite the first observation.

Default `read` remains original byte paging. For an explicit complete semantic view:

```json
{"ref":".workflow-system/records/events/<actual-event>.json","format":"logical-task-event"}
```

It returns the logical v1 `payload`, `wire_size`, `wire_sha256`, `wire_payload_sha256`,
`logical_payload_sha256`, `request_sha256`, and `encoded`. Default/maximum expansion is
64MiB and at most 4,096 pointer references; `max_bytes` can further limit the returned
logical payload. This format accepts no byte offset or evidence-object SHA selector.
Raw paged reading remains available when a complete logical read is too large.
The entire report remains searchable in events-only `find`, because it remains in request.
Older Runtime versions are not consumers of the new task v2 encoding: upgrade readers
or explicitly export the verified logical view, rather than interpreting the wire template.

### CURRENT_TASK semantic identity

New derived displays use `schema_version: 2`, `kind: vnext-task-view`, a `display_revision`,
and the v2 marker. Their canonical text contains no volatile fact source/view revisions.
`task-status`, `context` and the mutable `task-view.json` still carry current fact revisions;
`display_revision` identifies only the displayed semantic content.

An ordinary fact append that changes source/view revision but not displayed meaning updates
the cache without creating another task-view snapshot, renaming CURRENT_TASK or producing
recovery copies. `projection.display: unchanged` describes that write result. Read-only
status may report display `current` with `display_comparison: semantic-content`; it does
not claim a retained v1 header contains the newest fact revision. Known v1 baselines remain
byte-exact until a real displayed change warrants v2 publication.

Current bytes must match an actual readable published baseline before overwrite. Missing
baselines are not generated to legitimize user content; unknown formats and edits remain
drift. Real publications keep old-inode capture and late-editor-write protection. Existing
view snapshots and recovery originals are not deleted, and no per-revision pointer files
are created. Querying status remains read-only; this is not a new task state or admission.

### Short store-lock contention

A live record-store writer may be awaited for up to two seconds, measured with a monotonic
clock, before acquiring the original exclusive lock. Only the unacquired lock is retried;
no business operation or write callback is replayed. Timeout remains `STORE_BUSY`, and dead
owners still require explicit recovery. This bounded contention improvement does not steal
locks or change archive reclamation permission.

### Archive query contexts and Windows directory sync

`find`, `task-status`, `task status`, and `context` reuse the validated archive graph
within one synchronous call. This changes neither stored bytes nor full-journal replay.
Native storage callers may use `withStoreReadContext(root, readContext => ...)` and
pass `{ readContext }` to `storeList`, `storeStat`, `storeExists`, `storeRead`, or
`storeReadFile`. A context is root-bound, synchronous, and closed on return or error;
retaining it for a later call fails with `INVALID_READ_CONTEXT`.

Only one full or routed catalog is retained per context, under the existing 16 MiB
metadata budget. Reuse checks archive directories and all loaded manifest/index/pack
identities (including safe paths and inode/size/mtime/ctime). Changed backing is
revalidated; a change detected at query exit is `SOURCE_CHANGED`. Writes invalidate
active contexts and use fresh validation. Loose bytes, collisions, and selected chunk
digests are still checked on each read. This removes repeated shard entry validation;
the conservative signature checks still cost lookups × loaded backing files.

Snapshot publishing passes its internally generated relative temporary reference to
storage; the public path guards still reject drive-qualified storage refs and traversal.
On Windows only, `EPERM` from fsync of an already-opened, confirmed directory is treated
as unsupported directory sync. Directory-open errors and file fsync errors still fail.
This compatibility path does not promise POSIX directory-fsync power-loss durability.
