# 生成端减量：限定验证与交付边界

基线：4266b895d83907c17a59e0449033db3cc93b3f90。方案见
../product/vnext-record-generation.md。仅本地源码、隔离测试与交付，不推送或安装实际项目。

## 本轮何时生效

- 新task事件生成时：重复长正文按需使用同事件request指针；只有更小且可完整还原才采用v2
- 正常record/task同步时：事实revision继续更新，展示语义未变则不新增task-view/恢复副本
- 旧材料复用：Agent/调用者需按已更新约定明确使用evidence_refs，Runtime验证身份但不推断累计报告是否有用
- files请求仍完整捕获；不同运行、失败、决定、数据库before/after不因相似省略
- 历史归档仍是明确的archive操作；本轮不改写任何旧事件或自动清理记录

## 可复核合成量化

所有数字为新增文件/内容字节，未运行压缩归档；不是整个项目或Git历史节省比例。

| 场景 | 4266或明确累计捕获 | 新行为 | 保留性 |
| --- | ---: | ---: | --- |
| 20条仅改变事实revision的观察 | 20 events + 20 views + 40 recovery；新增86,454B | 20 events，0新view/recovery；新增8,514B | 所有20个原事实存在，source/view revision改变，CURRENT_TASK字节/inode不变 |
| 192,512B长报告的单次task execution事件 | 394,499B | 198,222B | 两处逻辑正文完整还原，完整请求相同，重试原ref/原bytes不变 |
| 12轮显式累计捕获，对比同一新Runtime的固定基线引用＋本轮输出 | 新对象1,734,342B，总新增1,760,125B | 新对象17,283B，总新增55,546B | 12轮独立输出、旧基线与请求的字节全部核验；两边都新增12对象，未把运行合并 |

第三行比较**调用者选择**，不是相同files输入被自动裁剪。测试材料明确声明append-only，
所以可由固定基线＋有序本轮输出恢复各轮累计内容；这不构成通用自动delta/重建功能。
显式请求完整累计文件的独立用例确认每个完整版本仍被保存。
第二行是单个事件的减量：完整任务缓存仍保留原逻辑视图，并未顺手压缩/删减cache。

## 真实样本兼容与模拟

Lawagent a83756c 的407个事件、TermLink 5687148的320个事件在隔离副本以新旧读取器对比：
source_revision、view_revision、任务、头引用、冲突/诊断、未关联项与选择语义相同。
原始样本与副本的全部records路径、长度、SHA256前后不变，未执行业务项目脚本。

只在内存模拟“以后生成相同形状的新task事件”，没有写回旧事件：

- Lawagent：393个可比较task事件中301个可用v2；同格式序列化6,837,844→4,221,403B
- TermLink：299个可比较task事件中233个可用v2；5,694,318→3,475,708B
- 全部逻辑payload逐项相等。以上不是已经清理旧库或旧Git历史的收益

## 最终检查

- Native assistance全组189/189，保留默认测试并发；包括既有归档/任务/checkpoint与新capture、codec、display、引用闭包
- 新旧真实Node安装升级5/5；codec、固定引用、v1/v2原字节、logical read、分页file-context、记录与CURRENT_TASK保留均检查
- 新checkpoint＋原有归档checkpoint47/47；实际Git index/commit、离线clone、新正文及固定引用恢复通过
- 独立审查新功能49/49、锁边界3/3及真实双CLI prepare通过；最终没有遗留已确认未修复的阻断问题
- Bun1.3.10构建、gen:all、protocol、freshness、workflow health和diff检查通过；四个原生模块与实际分发/migration-source逐字节一致

最终test:workflow-all仍**不是全绿**：runtime组295 pass / 7 fail后停止。7个失败名称、
断言与4266上一轮一致，相关旧测试/安装守卫源码未改。一个为旧task-context测试仍期待
legacy partial，六个为当前云沙箱空.git锚点使临时source/target被已有guard判同Git根；
本轮当前安装探针再次得到TARGET_ROOT_DENIED，未绕过或更改安全guard。
新功能专属实际安装升级通过。该aggregate停止后未重新跑所有后续无关组，不引用上一轮
后半段成绩冒充本轮全量结果。

## 已确认修正与限制

本轮发现的编码重放边角已修：损坏主key存在时，找到已验证的有效冲突记录就复用其原ref，
不再次随机追加同请求。编码优化全过程异常回退普通v1；未知外层/任务版本明确诊断，
任意raw observation同名自由字段仍不擅自解释。

并发探针复现4266的短锁STORE_BUSY可能造成记录未保存或暂未编号。最小基线增强只在
获取锁前等活跃owner最多2秒，不重跑回调/业务、不偷锁、不自动恢复dead-owner。
独立审查发现EEXIST→ENOENT竞争原可越过期限，已纳入同一单调截止时间并复验；
超时仍STORE_BUSY，原64层恢复链及显式恢复不变。

不保证旧Runtime可以解释新v2；完整request仍原样可读，语义消费者应升级到本次build，
或使用显式logical读取。大逻辑读取受64MiB/4096引用限制，原始分页读取保持可用。
完整任务状态仍全量重放，本文不承诺增量reducer、任意大历史或Windows真实宿主验证。
