# vNext：用户授权意图、执行事实与完成资格

状态：源码实现待 agent 端行为验证。基线：`c1caf591`（0.21.17）。
适用：全部公开 Skill、全部 mode、它们调用的内部事务及生命周期组合。
本文件固定设计目标与约束，不是测试通过证明。验证交接见
`docs/ops/vnext-authorized-intent-validation.md`。

## 1. 核心目标

用户授权确定可执行意图及其边界；Runtime 根据当前状态构造符合该意图的
合法事务。流程政策只能影响默认路径、风险告知与确认要求，不得在用户
作出有效决定后继续否决相同决定。不能把“通过现有所有 gate”循环定义为合法。

Runtime 管理 agent 的权限、事实和事务完整性，不管理用户必须按照哪条
偏好的流程行事。用户负责目标、范围、取舍和风险决定；agent 负责在授权内
完成必要内部手续；Runtime 负责准确绑定与记录。可实现的请求应落到实际
操作、幂等已完成结果、明确待确认的选择，或具体客观障碍，不应落入无出口
的流程状态。新增入口和未列举组合也必须服从此规则。

## 2. 必须分开的五类判断

| 类型 | 处理原则 |
| --- | --- |
| 权限 | 任务身份、写范围、禁止目标、外部影响必须匹配；新范围需真正授权。 |
| 事实与完整性 | 不伪造 PASS、clean、resolved、执行记录、回执；保持原子提交和幂等。 |
| 同意图内部手续 | 回读、登记、合法补充 preflight、机械调整、预算分析由系统处理，原指令覆盖则不重复索权。 |
| 用户可决定政策 | 停止、带例外推进、修改计划等展示具体后果；有效确认必须进入实际转换。 |
| 完成资格 | verified/clean/验收通过只取决于真实有效证据，不因用户选择继续或停止而成立。 |

Runtime 缺少合法转换属于能力缺陷，不能改称用户授权不足。未知错误先诊断，
不是自动允许，也不是循环调用 task-context。无可实施补救时保留原始请求和
已发生的事实，报告准确缺口；业务项目内的 agent 不因此得到修改工作流软件
或其他仓库的权限。不得引入全局 force、关闭校验开关或平行“忽略错误”表。
现有 `POLICY_GATE_DESCRIPTORS` 继续作为政策路由来源。

## 3. 执行事实和步骤完成

`operation-semantics.ts` 以实际请求效果区分 record-execution、complete-step、
record-progress。带 execution_result 的请求一定是事实登记，即使旧调用方
填写了 completed，也不再隐含推进。新事实记录：非 blocked 为 in-progress，
blocked 为 blocked；旧已提交历史不改写。

`record-step-result` 必须绑定原 preflight、计划、逻辑 change set、真实改动
和报告。repair 先登记，再验证；未解除反证和 finding 不得阻止登记，也不得
在登记时自动解除。失败必须如实报告为 blocked/failed，不能为通过校验改成
implemented/passed。声明 test-red 仍需真正的行为失败证据，环境/语法失败
不冒充 Red。

普通免审查步骤：登记 → `complete-executed-step`。必需审查或 repair：登记 →
实际 review → `complete-reviewed-step`。完成操作不执行命令、不新造证据。
后续完成条件未满足不撤销已经登记的工作。任务上下文分别显示默认后续操作
和用户决定入口，而不是把 next_entry 当作唯一可选项。

repair 波次/次数在返回可执行的 begin-repair 回执前登记；恢复同一波次
不得再次计数。历史旧调用仍有兼容处理。checkpoint ID 是历史引用，不是业务
尝试配额；不通过截断历史绕过限额。实际磁盘、锁和原子发布失败仍是客观障碍。

## 4. 用户决定与二次确认

`closure-decision-context`、`step-decision-context` 是只读后果预览，不是同意。
agent 展示后果后，才能以用户真实来源和原文调用 record-user-decision。
Runtime 自动生成完整内部目标集合、review/change-set 绑定和确认 digest，
用户不需手工理解或输入 finding ID、gate ID 等。

确认 digest 绑定任务、文档、语义定义、相关状态、义务及覆盖目标的代码/证据。
事务 source_revision 仍由锁内检查。只发生无语义变化的审计追加时，重新回读
并绑定新事务版本，不重复询问；后果、证据、任务目标或覆盖代码实质改变时
重新展示并确认。系统不能把自己的分析写成用户的新指令。摘要是风险决定的
对象，digest 只保证绑定，不证明外部身份或独立验收。

### 4.1 未完成关闭

正常 verified 关闭保留原严格完成条件。用户停止或带例外关闭分别记为
stopped-by-user / completed-with-exceptions，不等于 verified。

关闭可从真实 live tuple 出发：draft、active、blocked_by_replan、superseded、
replaced 的 active lifecycle，以及 suspended 的 paused_pending_closure、
paused_blocked、interrupted。不先恢复 active，不先取消 replan，不先完成
步骤，不先清空 finding，不为终止而补造 acceptance 计划。

先展示未完成工作、真实失败/缺失证据、开放发现、发布/回滚/观测后果及代码
保持现状，再二次确认。archive 保留这些事实和真实来源 tuple。归档后照旧
完成文档知识、Lesson、STATUS 对账；重入只补缺失记录，不重关、不回滚历史。
关闭绝不自动授权删除、回滚、Git commit/push、部署或其他业务副作用。

### 4.2 带例外推进

用户可决定跳过当前工作或承担已知风险，不需先制造一次 findings/blocked
审查。step-decision-context 归集该决定的具体义务，确认后记录
user-directed-with-exceptions 和用户决定 ID。缺失/失败报告保持原样，不伪造
not-run 报告、clean/disposition review 或执行记录。已存在的真实审查结果
仍可按其事实消费。旧 disposition receipt 作为历史继续可读。

存在已准入但未结算执行时，先如实登记或对“确实未执行”的 preflight 做合法
对账，不能偷偷遗失进行中的工作；独立终止路径仍可使用。推进不执行下一步，
不扩大权限，不解除 challenge。精确义务的用户例外可以允许后续执行，但
不能使这些义务获得证据通过资格。

## 5. 准备、纠正与证据调整

准备和确认纠正计划不要求历史尝试全部成功，也不要求先清掉 pending review
或 finding。仅未有实际结果的当前准入尝试需要结算；旧审查与执行血缘保留，
其范围不能冒充新定义的审查。共享反证引用在 Runtime 组装时去重，不放松
引用唯一性或伪造 challenge。

同目标、同 Acceptance、同权限的 evidence selector 调整继续使用现有同任务
amendment；不升级为 successor，不借 finding 冒充 evidence challenge。
真正目标/权限改变走相应用户决定和 amendment；方向替代才走 successor。
暂停状态恢复执行需要其真实恢复资料，这不妨碍用户直接选择停止。

## 6. 迟到结果与历史兼容

暂停/终止不让已经发生的执行消失。原 document、step、计划、preflight 和
授权 footprint 仍匹配时，允许迟到结果追加为历史。它不激活任务、不改变
归档镜像、不改变 live claim 资格、不消费 pending review、不解除 finding。
若身份或定义实质改变，先对账原目标和历史，不能把结果绑到新任务。
不能仅因回执丢失重执行业务命令。

保留既有 task store、单提交头、历史对象、证据引用和旧 archive audit。
新增 archive source tuple 接受真实合法来源；旧 active→closed 归档继续可读。
新语义不能通过重置任务、删除历史、强制 rebootstrap 或手工改 CURRENT_TASK
获得表面干净状态。

## 7. 全入口适用矩阵

| 公开入口 | 保持的意图边界 |
| --- | --- |
| prepare-task | 准备/确认及必要内部衔接，不代用户改目标或扩大权限。 |
| review-draft | 输出真实审查结论；只读授权不变实施授权。 |
| execute-step | 当前授权步骤/repair 的实施和事实登记，完成资格另判。 |
| review-change | 真实 verdict，不因用户取舍伪造 clean。 |
| debug-task | 调查/修复依其 mode 和原指令，不借恢复越界。 |
| task-lifecycle | 如实暂停、恢复、替代并保留义务，不清洗历史。 |
| capture-work-item | 登记工作项不等于激活任务或授权实施。 |
| close-task | verified 与用户终止分开；一次后果确认有实际终止路径。 |
| bootstrap-project | 管理初始化不是业务实施；不覆写项目既有事实。 |
| validate-change | 如实验证，不把失败隐藏为通过或擅自修复。 |
| git-commit | 核对真实 Git 影响及授权，不借工作流继续扩大提交范围。 |

该矩阵不是11份例外表，也不是声称所有组合已经验证。新增 mode/操作必须明确
实际影响、授权来源、内部手续、用户选择和结果资格；只有维护这些共同原则
才可避免下一次以新状态名重新阻塞同一个合法决定。

## 8. 不在本次改造范围

不替换检索/分页/文档导航，不重建 Task Store，不更改知识晋升和安装模型，
不增加全局权限模式、不增加模型专属配置、不强迫 claim 测试化。不更改业务
项目，不发布版本、不自动升级目标安装。不为改几行文字新增文本快照测试。

源码与 Skill 的一致性是本次修改内容；可用性、旧状态兼容、所有终端组合
必须由 agent 在重建的分发包上验证。未验证前不得把“设计目标固定”或“源码
已提交”写成“全生命周期已经证明无死路”。
