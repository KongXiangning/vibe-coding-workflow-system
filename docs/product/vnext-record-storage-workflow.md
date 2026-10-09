# maintain-project：记录存储整理子流程

基线：617bcb5540f1f8f29d2c7366ea56bda26973f004。本轮补齐既有归档 Runtime 的
可发现调用流程，复用 maintain-project，不新增公开 Skill、PRODUCT intent/schema、
任务状态或归档资格判断。Runtime 的记录格式与归档代码保持不变。

## 入口与职责

maintain-project 在业务资料维护前识别“检查记录占用”“归档历史记录”“归档并回收”
“恢复归档”等记录存储意图，读取已安装的 `product-maintenance/references/record-storage.md`，
调用同目录 assistance 的 archive 服务。不要求 PRODUCT manifest、业务资料维护 enabled、
活动任务或新建业务文档。业务资料维护继续使用原 product-maintenance helper 与原契约。
现有 metadata 的 product_files 约束直接业务写入；records 只通过既有 assistance 委托
修改，不扩充旧 typed-transaction runtime_operations 枚举或授权直接文件删除。

“归档任务/项目”存在实质范围歧义时才澄清；明确记录存储意图不逐字段重复确认。
检查、归档保留原件、归档并回收、恢复分别对应真实用户选择。安装/升级/任务关闭/Git
提交不自动运行这条子流程；已有充分授权覆盖连续阶段，不每一步重问。

## 实施边界

- 默认检查只读：Runtime plan 提供候选及摘要，普通只读 stat/list 补充占用与排除组。
  不复制 candidate 正则、不以年龄/任务关闭/相似度判断证据价值，不创建任务或展示。
- archive create 保留 loose，verify 验证现有全部归档；不能把 create 当净节省或把
  quarantine 的目录搬移当整项目减量。回收需明确授权、独立备份和完整校验成功。
- 后续变更显式传已授权 archive_ids/refs；选定 refs 落在含其他记录的旧包时，不以完整
  pack 回收要求扩大原范围。预览过期、缺失/冲突/失败停后续回收，保留实际部分成功。
- 恢复按明确请求使用 restore，冲突不覆盖；原 ID、正文、摘要、因果关系保持不变，
  display/capture 恢复原件、task-view(s)、CURRENT_TASK 均按现有 Runtime 排除规则处理。
- 报告逻辑事实、loose/archive/quarantine/其他保留内容的实际数量和字节，说明备份占用，
  给出恢复路径；Git 仅在已有明确授权时走现有精确 checkpoint 流程，不自动提交/推送。

## 验证计划

构建实际安装产物后，以隔离合成项目进行五条原生 Agent 自然语言验收：只检查、归档
不回收、授权回收、校验失败停止、恢复与冲突保护。准备数据和故障可脚本化；宿主自行
读取安装入口、作出路由和恢复选择并调用工具，保留请求、实际调用/输出和结果文件证据。
另验证安装/升级包含路由和参考、无 PRODUCT manifest 也能使用、旧资料和保护文件不变。

此轮不推送，不触碰真实 LawAgent/TermLink 项目。Linux 合成宿主验收不代表所有模型或
Windows 实机均通过；既有聚合基线失败与本次新增行为结果分开报告。
