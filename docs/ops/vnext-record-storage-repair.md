# 记录存储兼容性与查询复用修复

修复基线：`b3ec33afc2733eaf348a7e4162651b8a5beac13b`。范围仅为已确认的两个
Windows 写入接点及归档索引在同一次批量查询中的重复结构验证；不改记录格式、归档格式、
任务 reducer、历史事实或默认归档/回收策略。

## 最小设计

1. `syncDir` 仍打开并确认目录，仍调用目录 fsync。仅 Windows 的目录 fsync `EPERM`
   视为该平台不支持的目录同步；文件 fsync、打开目录失败、Linux `EPERM`、`EIO` 和其他
   权限错误继续失败。既有 `EINVAL`/`ENOTSUP`/`EBADF` 兼容边界不扩大。
   这不承诺 Windows 具备 POSIX 目录断电持久性。
2. snapshot 保留内部生成的 repository-relative 临时引用，用绝对路径执行本机文件 I/O，
   用相对引用调用逻辑存储发布。逻辑存储的盘符、越界、`..`、`.git` 和符号链接防护保持
   原样，不能为接收一个内部绝对路径而放宽公共输入。
3. 批量只读操作复用本次操作内已验证的归档 catalog/index 结构。复用绑定项目根、归档集合
   和参与目录/文件的身份；在查询边界核对变化，变更时失效或以 `SOURCE_CHANGED` 拒绝
   返回旧结论。正文块校验和 loose/archive 冲突检查继续逐次执行，不缓存 loose 内容。
   单引用冷读仍按 manifest 范围选择索引；写入/归档/回收验证不依赖查询缓存。
   结构内存受既有 metadata/记录/chunk 上限和显式缓存预算约束，操作结束即释放。

## 验证与交付边界

- Windows 分支用 Linux 上的平台/文件系统故障注入验证，另检验目录打开、文件同步和
  非 Windows 错误仍传播；不得把它写成真实 Windows 宿主通过。
- 临时引用用真实 snapshot 行为与 Windows 路径模型验证，外部/穿越/符号链接仍拒绝。
- 同口径 500 条、83,000 B 合法事件对比冷 CLI find/status 输出 hash、结构访问次数和
  时间；计数仅在外部分析副本中插入，不进入分发源码。
- 覆盖归档 metadata/index/pack 替换、损坏、缺失、集合变化、loose 冲突、上下文寿命、
  写入失效与既有 create/quarantine/reclaim/restore、旧引用、任务及捕获保护。
- 重建分发来源并核对安装/源码新鲜度；独立审查后本地提交。全量已知基线/宿主失败单列，
  不称全平台通过。此次不推送、不升级或清理真实项目。

## 已实现与定向验证

新增 `withStoreReadContext` 为同步、项目根绑定的 opaque context。每个 context 只保留一个
完整 catalog 或最近的单 target catalog，退出 finally 释放；关闭后、跨项目或异步保留均
拒绝。`find`、`task-status`、`task status`、`context` 自动使用，低层读取者可显式传入。
无 list 的单引用首次读取仍按原 routing 跳过无关 shard，交替 target 不累计多个 catalog。

Native assistance 全组 **216/216** 通过，其中新增 portability **9/9**、read-context
**18/18**。同一 portability 测试放到精确 b3ec33a 基线时恰好失败两项，对应两个待修问题；
其他权限和路径拒绝用例保持通过。实际 Node 安装/升级 **5/5、104 assertions** 通过，
涵盖归档、新旧事件、固定引用、codec 和已有记录/展示保留。构建、生成、protocol、freshness、
health 通过；源码与分发、migration-source 两份支持模块逐字节一致。

独立审查重复通过 portability 9、read-context 18；额外在复用身份检查之后、pack open
之前篡改选中块，读取拒绝 `ARCHIVE_CORRUPT`，操作出口检测 `SOURCE_CHANGED`，未返回坏
字节。目录/metadata/pack 变更、缺失、符号链接、loose 冲突、写入失效和上下文寿命均覆盖。

## 同口径独立性能复验

Linux x86_64、Node v24.19.0；500 条合法 observation、原字节合计 83,000 B，同一
archive/index shard。每个版本/状态/命令启动三个新的 Node CLI 进程，取中位数；应用缓存
冷，未清空 OS page cache。计时用原源码，结构计数另用只插入 counter 的临时副本。

| 检查 | b3ec33a | 修复后 |
| --- | ---: | ---: |
| archived find 中位数 | 3440.486 ms | 319.642 ms |
| archived task-status 中位数 | 1866.909 ms | 247.144 ms |
| find loadArchive | 1001 | 1 |
| status loadArchive | 503 | 2 |
| find entry/chunk-description visits | 500,500 | 500 |
| status entry/chunk-description visits | 251,000 | 500 |
| 每种命令 payload chunk 校验 | 500 | 500 |

find 全部扫描、零匹配、零 issues、cursor=null；status 扫描 500 条、零 issues。
新旧及 loose/archive 的完整 CLI stdout SHA256 相同：

- find：`fff49658d34973bf784c3347c2f706f808c148b2fa8e4393e6e879a2786ef9f9`
- status：`77b92c8fa0a4e3fd8559d5b2450dbfd2f16ddc390802e4941895a271ec84967b`

实现侧独立 fixture 复跑也得到同输出与结构计数；其 lstat 次数 find 63,605→49,669，
status 35,191→28,277，readdir 2,003→3 / 1,007→5。签名检查仍为
lookup 数 × 已加载 backing 文件数，不把此单 shard 改善说成任意多归档总成本线性。
完整任务 reducer 仍全量重放，不新增状态缓存或自动归档。

## 聚合和平台限制

最终 `test:workflow-all` 与精确 b3ec33a 同环境对照一致：已执行 363 项，356 pass /
7 fail；Runtime 组 295 pass / 7 fail 后停止，后续 && 阶段未运行。七个失败名称完全
相同：六个旧安装 fixture 的临时包/目标共享 /tmp Git 根而被 `TARGET_ROOT_DENIED`
拒绝，一个旧 task-context 用例期待 partial 而辅助默认路径返回 available。未修改这些
测试或安全守卫，不称聚合全绿。首次新云环境缺少可写的默认 npm
cache，安装阶段返回 ENOENT；指定隔离可写 cache 后安装/升级组完整通过，未改变安装
安全守卫。这个环境问题保留在初次日志中，不算源码修复，也不隐藏失败。

此次没有真实 Windows 宿主、断电或网络文件系统验证；Windows 目录 fsync 不支持的
兼容路径不提供 POSIX 目录持久性保证。没有运行或修改 LawAgent、TermLink 项目，
没有自动归档/回收、更改包格式或重写任何旧事件。恢复包包含源码 bundle、完整/增量
patch、冻结摘要、合成计数和测试证据，不含凭据或业务项目原文。
