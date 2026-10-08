# Indexed record archives：验证记录

基线：813d3146561c974c1437fc4d116144dc800bc1ad。隔离源码分支实现；无推送、发布或
真实 Lawagent/TermLink 项目整理。完整设计见 ../product/vnext-indexed-record-archives.md。

本文件在验证结束后更新实际结果。不把运行中的检查、已有基线失败或Linux测试等同于
全部平台/全部未来历史均受验证。运行时 Node；生成产物由固定 Bun 1.3.10 从源码构建。

## 覆盖要求

- loose 与归档旧路径逐字节读取、digest/length、不覆盖幂等、编号不复用
- task-status/reducer/query结果与源版本一致，失败/冲突/因果父引用不变
- 块级范围读实测，冷CLI跨包索引路由、路由限额与完整核验的区别
- 缺索引/包、坏manifest/块、路径穿越、符号链接、解压上限、loose collision
- 激活中断、显式dead-owner恢复、并发追加/归档/回收、迟到附件
- archivecreate默认不清理；quarantine、reclaim、restore往返和冲突不覆盖
- checkpoint精确业务范围、pack/index持久化、Git index/commit验证和离线clone
- 升级保留全部记录，旧SourceRef/file-context兼容；旧版/外部fs读者需restore
- ignored task views及CURRENT_TASK基线不清，display-capture旧句柄迟到写入不丢

## 平台和成本边界

原生文件系统支持由实际Node/libuv提供。会尝试目录fsync；已识别的不支持错误被忽略，因此这类平台不承诺目录元数据掉电耐久性；
本轮实际运行Linux云电脑，没有Windows真实宿主、网络共享文件系统或突然断电测试。
线程/进程中断不是物理断电验收。完整任务查询仍重放全部事件。

真实样本仅使用指定Git提交导出的隔离副本，不执行项目脚本。单独统计原树、archivecreate
保留副本、quarantine、最终reclaim占用；原样本树摘要前后核对。Git历史体积变化另述。

## 指定提交隔离样本首轮实测

以下为工作树 records 的普通文件数与逻辑字节（十进制），包含归档和隔离恢复凭据，
不含既有 `.git`、目录 inode/文件系统块分配、代码和被忽略的真实电脑文件。

| 样本 | 原始文件/字节 | create 后总字节 | quarantine 后总字节 | reclaim 后文件/字节 |
| --- | ---: | ---: | ---: | ---: |
| Lawagent a83756c | 3,012 / 148,312,320 | 199,347,828 | 199,347,921 | 821 / 54,364,098 |
| TermLink 5687148 | 2,332 / 82,491,899 | 101,977,862 | 101,977,955 | 625 / 22,371,939 |

Lawagent 2,200条事实进入7个归档文件；810个display恢复文件全部保留。
TermLink 1,714条事实进入5个归档文件；616个display恢复文件全部保留。
最终各保留2个小恢复凭据；quarantine阶段保留全部原件，不能宣称该阶段节省总空间。

首轮两样本全体旧ref（3,012 / 2,332）原字节、大小和SHA256一致；完整task-status和
诊断与基线一致，reclaim前后restore原路径、重复quarantine/reclaim均通过。原样本目录
树摘要前后不变，未执行业务项目脚本。

最大对象跨块64B页面的独立冷Node CLI读取均只解压两个64KiB块（131,072B）。
Lawagent仅加载1个索引，metadata 614,355B、compressed payload 34,427B；
TermLink仅加载1个索引，metadata 865,457B、compressed payload 15,943B。指标只证明该页实际路径，非全部历史重放有界承诺。

## 最终检查结果（冻结源码，2026-10-08）

- `test:workflow-assistance`：137/137通过（原有assistance/task/checkpoint与新core/归档集成/归档checkpoint）
- 最后find长度冲突修正后，core＋归档集成32/32再次通过；独立审查6/6及原3个故障探针复验通过
- 新消费者真实Node安装/升级/读取/restore：4/4，58断言；相关五文件66 pass / 1已证实旧CLI契约失败
- 固定Bun1.3.10 build:vnext-runtime、build:vibe-governance-distribution成功；gen:all、validate:protocol、validate:freshness、workflow:health和git diff --check通过
- 串行Bootstrap与宿主指引：16/16；独立安装分发25 pass / 1宿主fixture守卫失败
- knowledge 9/9、fixflow cleanup 5/5、fixflow upgrade 7/7、workflow docs 12/12、registry 12/12

全仓 `test:workflow-all` **不是全绿**：runtime组295 pass / 7 fail后停止。随后各组串行补跑，
不把前段成功说成完整aggregate通过。明确保留的已核对问题：

1. 旧task-context CLI用例仍期待legacy partial，但813d314已默认转assistance available；从未修改基线提取CLI复现同差异
2. 六个runtime安装、四个recovery安装、一个packed distribution以及一个generic workflow安装fixture，因本云沙箱/tmp或/workspace/shared的空.git锚点被现有target-root guard判为共同Git根；未绕过或修改guard。真实repo内软件来源、外部目标的新归档安装升级及旧产品资料安装场景均通过
3. 八个migration用例在未修改813d314隔离基线上复跑，名称与失败完全一致（13 pass / 8 fail）
4. D02用旧0.18.7 npm .bin符号链接入口时退出0却无stdout，直接Node入口正常；失败发生在本实现执行前

串行补跑system E2E为8 pass / 5 fail，migration为13 pass / 8 fail；generic组六文件189 pass / 1宿主守卫fail。
较早并行生成包与检查重叠的Bootstrap七项失败未作为最终结果；停止重建竞争后串行重测16/16通过。
没有为了让旧aggregate变绿更改无关安装安全守卫或旧任务状态契约。

独立审查修复4个确认问题：find扫描预算、归档容量激活前拒绝、snapshot复用完整校验、
变长loose冲突按记录隔离。最终没有遗留已确认未修复的阻断问题；这不是全平台无缺陷保证。

两真实样本在最终候选再次完整往返，结果与表格相同；最后冻结源码还对两个完成reclaim的
副本执行完整verify通过。原样本目录未变。补充本云文件系统文件块分配量（不含目录）：
Lawagent 155,627,520→55,746,560B；TermLink 87,420,928→23,298,048B。
