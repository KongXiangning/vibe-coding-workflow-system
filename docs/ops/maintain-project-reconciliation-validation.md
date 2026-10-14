# maintain-project：反证影响与报告正文维护修正

## 修正范围

此次修正维护源码、Skill 模板和随软件安装的参考/API/契约，不修改 LawAgent 的产品文档。
已有 README、指南、update 参考及生成产物的未提交改动保留；指南只增加本次规则，产物从当前源码重建。

- 局部需求／评估读取默认返回影响候选；显式 impact_ids 仍可指定或清空种子。
- 候选包含直接关系、活动的已知 Task 身份、具体实现或范围化文件来源；保留理由、定位、读取范围及未解析种子。
- Skill 要求新反证核对直接相关义务，对账或保存原证据为 pending_sources；只读、延期、未知与失败返回具体未处理位置。
- 详细功能点、验收与证据只维护一份范围／对象报告，旧进展表使用短摘要与链接。
- read/check/apply 提示 ASSESSMENT_BODY_COPY；精确不同的 v3+ 对象／范围不作镜像诊断。诊断不阻断保存、不自动合并或删除事实。
- Request 与文档 Schema 不变，没有新 Runtime 状态、审批、必填反证字段或报告注册库。

## 实际验证

- `bun run test:product-maintenance`：100 pass、0 fail，包含5个新增行为用例。
- `bun run validate:vnext-source`：PASSED。
- `bun run build:product-maintenance` 与 `bun run build:vibe-governance-distribution`：成功。
- 定向安装回归：2 pass、0 fail，验证 Node 安装产物可执行、升级保全目标拥有的业务字节、混合版本贡献与离线读取。
- LawAgent 原树只读对比：原安装 helper 的 REQ-JUDICIAL 候选不含 REQ-INGEST；新 Node helper 通过共享 Task／导入源码找到它。
- 新 helper 识别 CASE/JUDICIAL/EVIDENCE 独立报告与 IMPLEMENTATION_STATUS 对应正文的三组镜像；development_gate 仍为 false。

新增测试覆盖：未显式链接的批量义务定位；忽略共享总目标／已否定绑定／未知 Task；来源换摘要和字段顺序；受限读取与空种子；原 PASS 与新 pending 事实分离；候选检查及保存后的镜像提示；摘要改写前历史字节落盘；精确不同对象／范围保留。

## 交付边界

本地分发候选仍为软件版本 0.24.10，bundle 为 `bundle-f4fd1ab63b2361bbb4d45c55`。
没有发布版本、提交推送或升级真实 LawAgent；同版本候选不代表目标项目会自动接受升级，应走既有归属／漂移核对。
未运行 test:workflow-all，也未用未来宿主 Agent 自动重评生产需求来证明模型必定遵从。
候选发现与正文匹配是确定性服务；业务影响、范围适用性及是否为独立事实仍由宿主读取后判断。
