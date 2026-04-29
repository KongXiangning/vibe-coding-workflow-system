export const WORKFLOW_DOC_NAMES = [
  'BASELINES.md',
  'CONTRACTS.md',
  'CURRENT_TASK.md',
  'DECISIONS.md',
  'LESSONS.md',
  'ROADMAP.md',
  'STATUS.md',
  'TASK_ARCHIVE.md',
  'TASK_SUMMARY.md',
  'WORKFLOW_GUIDE.md',
] as const;

export type WorkflowDocName = (typeof WORKFLOW_DOC_NAMES)[number];

export const WORKFLOW_DOC_SET = new Set<WorkflowDocName>(WORKFLOW_DOC_NAMES);

export const WORKFLOW_DOC_REQUIRED_HEADINGS: Record<WorkflowDocName, readonly string[]> = {
  'BASELINES.md': [
    '## 使用规则',
    '## 版本治理概览',
    '## 发布基线',
    '## 兼容性基线',
    '## 安全基线',
    '## 部署基线',
    '## 性能与可靠性基线',
    '## Gate 与错误码基线',
    '## 基线变更记录',
  ],
  'CONTRACTS.md': ['## 使用规则', '## 一、接口契约', '## 二、架构契约', '## 三、变更规则', '## 四、传播治理补充'],
  'CURRENT_TASK.md': [
    '## 任务信息',
    '## 背景与上下文',
    '## 验收标准',
    '## 允许修改范围',
    '## 禁止修改范围',
    '## 受影响的契约',
    '## 已确认决策',
    '## 待确认问题',
    '## 传播治理记录',
    '## 实施步骤',
    '## 回归检查项',
    '## 回滚点',
    '## 执行记录',
  ],
  'DECISIONS.md': [
    '## 使用规则',
    '## 🏗️ 架构决策',
    '## 🎨 口味决策',
    '## ⏸️ 暂缓决策',
    '## 🔁 已演进 / 已替代',
    '## ❌ 已否决',
  ],
  'LESSONS.md': [
    '## 使用规则',
    '## 通用',
    '## 数据与存储',
    '## 前端与交互',
    '## 后端与服务',
    '## 测试与回归',
    '## 部署与运行时',
  ],
  'ROADMAP.md': [
    '## 使用规则',
    '## 生命周期阶段',
    '## 版本里程碑',
    '## 当前窗口',
    '## 候选事项池',
    '## 风险与依赖',
    '## 变更记录',
  ],
  'STATUS.md': [
    '## 项目概览',
    '## ✅ 已完成且稳定',
    '## 🔨 正在开发',
    '## 📋 待开发',
    '## ⚠️ 已知风险 / 观察点',
    '## ❌ 已移除 / 推迟',
    '## 🔜 下一检查点',
    '## 最近更新记录',
  ],
  'TASK_ARCHIVE.md': [
    '## 任务元数据',
    '## 原始任务包快照',
    '## 实际改动摘要',
    '## 契约与决策记录',
    '## 验证与交付证据',
    '## Lessons 回写',
    '## 后续关联',
  ],
  'TASK_SUMMARY.md': [
    '## 任务信息',
    '## 目标与结果',
    '## 改动范围',
    '## 契约与决策变化',
    '## 验证结果',
    '## 风险与后续',
    '## 交付清单',
  ],
  'WORKFLOW_GUIDE.md': [
    '## 使用规则',
    '## 文档速查',
    '## Skill 速查',
    '## 标准任务流程',
    '## 按场景选择',
    '## 越界处理',
    '## 交付检查',
  ],
};

export const WORKFLOW_DOC_REQUIRED_SNIPPETS: Partial<Record<WorkflowDocName, readonly string[]>> = {
  'BASELINES.md': [
    '### REL-001:',
    '- 状态：',
    '- 生效版本 / 窗口：',
    '- 证据 / 验证入口：',
    '- 例外处理：',
    '### COMP-001:',
    '- 生效版本 / 范围：',
    '- 验证入口 / 观察指标：',
    '- 升级 / 迁移说明：',
    '### SEC-001:',
    '- 最低要求：',
    '- 禁止项：',
    '- 验证入口 / 审查方式：',
    '### DEP-001:',
    '- 生效版本 / 环境：',
    '- 发布步骤 / 回滚要求：',
    '- health endpoint：',
    '- production URL：',
    '- deploy status source：',
    '- 观测与告警：',
    '- canary window：',
    '### NFR-001:',
    '- 指标：',
    '- 目标阈值：',
    '- performance regression threshold：',
    '- baseline source：',
    '- 观测周期：',
    '- 验证入口：',
    '## Gate 与错误码基线',
    '### GATE-001:',
    '- blocker level：',
    '- merge gate：',
    '- ship gate：',
    '- 相关 strategy_origin / branch 语义：',
  ],
  'CONTRACTS.md': [
    '## 四、传播治理补充',
    '### candidate 回写记录',
    '### LayoutContract',
    '### BehaviorContract',
    '### compat path / wrapper rules',
    '### API change downstream validation',
    '### frozen zone / UI anchor migration',
  ],
  'CURRENT_TASK.md': [
    '## 设计约束',
    '- Design mode:',
    '- Design source:',
    '- Design acceptance:',
    '- Design evidence:',
    '- Design open decisions:',
    '## 发布后验证',
    '- Release mode:',
    '- Deploy source:',
    '- Target environment:',
    '- Health checks:',
    '- Canary window:',
    '- Performance baseline:',
    '- Rollback / recovery:',
    '- Release evidence:',
    '## 传播治理记录',
    '### change_start_set',
    '### discovery evidence',
    '- `EvidenceRecord`：',
    '- `MutationEligibilityAssessment`：',
    '- `ContractCompatibilityResult`：',
    '### conformance / verification cases',
    '- 输入场景：',
    '- 期望 gate / severity / `strategy_origin`：',
  ],
  'DECISIONS.md': [
    '### SUPERSEDED-001:',
    '- 当前状态：superseded',
    '- 原决策编号：',
    '- 后继决策编号 / 基线：',
    '- 生效版本 / 里程碑：',
    '- 变更原因：',
    '- 兼容 / 迁移要求：',
  ],
  'ROADMAP.md': [
    '### M1:',
    '- 目标版本 / 时间窗：',
    '- 目标结果：',
    '- 进入条件：',
    '- 完成定义：',
    '- 依赖：',
    '- 风险：',
    '- 当前主线：',
    '- 已锁定范围：',
    '- 明确不做：',
  ],
  'WORKFLOW_GUIDE.md': [
    '| `CURRENT_TASK.md` |',
    '| `/create-current-task` |',
    '| `/lock-scope` |',
    '| `/implement-current-step` |',
    '| `/review-diff` |',
    '| `/verify-contracts` |',
    '| `/run-regression` |',
    '| 回归验证失败 | `/investigate-root-cause` |',
    '`diff-aware`',
    '`report-only`',
    '`authenticated-browser`',
    'browser-backed smoke',
    'session/cookie',
    'Root cause hypothesis',
    'Safety mode',
    '`guarded`',
    'dangerous command gate',
    '回到 `/lock-scope`',
    '不依赖 native hook',
    'Design mode',
    'Design source',
    'Design acceptance',
    'Design evidence',
    'design drift review',
    'DESIGN.md` 只能作为 optional source',
    'Release mode',
    'Deploy source',
    'Target environment',
    'Health checks',
    'Canary window',
    'Performance baseline',
    'Rollback / recovery',
    'Release evidence',
    'workflow-system 不绑定部署平台',
    '`.workflow-system/FILE_SCHEMAS.md`',
    'Allowed Files',
    'Conditional Files',
    '未明确允许的文件默认禁止修改',
  ],
};

export type LifecycleGovernanceDoc = 'BASELINES.md' | 'DECISIONS.md' | 'ROADMAP.md';

const LIFECYCLE_GOVERNANCE_DOC_REQUIREMENTS: Record<
  LifecycleGovernanceDoc,
  readonly { description: string; pattern: RegExp }[]
> = {
  'BASELINES.md': [
    { description: 'a release baseline entry', pattern: /^### REL-\d+:/m },
    { description: 'release status field', pattern: /- 状态：/ },
    { description: 'release effective window field', pattern: /- 生效版本 \/ 窗口：/ },
    { description: 'a compatibility baseline entry', pattern: /^### COMP-\d+:/m },
    { description: 'compatibility effective scope field', pattern: /- 生效版本 \/ 范围：/ },
    { description: 'compatibility verification field', pattern: /- 验证入口 \/ 观察指标：/ },
    { description: 'compatibility migration field', pattern: /- 升级 \/ 迁移说明：/ },
    { description: 'a security baseline entry', pattern: /^### SEC-\d+:/m },
    { description: 'security minimum requirements field', pattern: /- 最低要求：/ },
    { description: 'security forbidden items field', pattern: /- 禁止项：/ },
    { description: 'security review field', pattern: /- 验证入口 \/ 审查方式：/ },
    { description: 'a deploy baseline entry', pattern: /^### DEP-\d+:/m },
    { description: 'deploy effective environment field', pattern: /- 生效版本 \/ 环境：/ },
    { description: 'deploy rollback field', pattern: /- 发布步骤 \/ 回滚要求：/ },
    { description: 'deploy health endpoint field', pattern: /- health endpoint：/ },
    { description: 'deploy status source field', pattern: /- deploy status source：/ },
    { description: 'deploy canary window field', pattern: /- canary window：/ },
    { description: 'deploy observability field', pattern: /- 观测与告警：/ },
    { description: 'a non-functional baseline entry', pattern: /^### NFR-\d+:/m },
    { description: 'non-functional metrics field', pattern: /- 指标：/ },
    { description: 'non-functional threshold field', pattern: /- 目标阈值：/ },
    { description: 'non-functional observation field', pattern: /- 观测周期：/ },
    { description: 'non-functional verification field', pattern: /- 验证入口：/ },
    { description: 'performance regression threshold field', pattern: /- performance regression threshold：/ },
    { description: 'gate baseline section', pattern: /## Gate 与错误码基线/ },
    { description: 'a gate baseline entry', pattern: /^### GATE-\d+:/m },
    { description: 'gate blocker level field', pattern: /- blocker level：/ },
    { description: 'gate merge field', pattern: /- merge gate：/ },
    { description: 'gate ship field', pattern: /- ship gate：/ },
  ],
  'DECISIONS.md': [
    { description: 'a superseded decision entry', pattern: /^### SUPERSEDED-\d+:/m },
    { description: 'superseded status field', pattern: /- 当前状态：superseded/ },
    { description: 'original decision reference field', pattern: /- 原决策编号：/ },
    { description: 'successor decision or baseline field', pattern: /- 后继决策编号 \/ 基线：/ },
    { description: 'effective version or milestone field', pattern: /- 生效版本 \/ 里程碑：/ },
    { description: 'change reason field', pattern: /- 变更原因：/ },
    { description: 'migration handling field', pattern: /- 兼容 \/ 迁移要求：/ },
  ],
  'ROADMAP.md': [
    { description: 'a roadmap milestone entry', pattern: /^### M\d+:/m },
    { description: 'milestone version window field', pattern: /- 目标版本 \/ 时间窗：/ },
    { description: 'milestone target outcome field', pattern: /- 目标结果：/ },
    { description: 'milestone entry condition field', pattern: /- 进入条件：/ },
    { description: 'milestone done definition field', pattern: /- 完成定义：/ },
    { description: 'milestone dependency field', pattern: /- 依赖：/ },
    { description: 'milestone risk field', pattern: /- 风险：/ },
    { description: 'current window focus field', pattern: /- 当前主线：/ },
    { description: 'current window locked scope field', pattern: /- 已锁定范围：/ },
    { description: 'current window non-goals field', pattern: /- 明确不做：/ },
  ],
};

export const OPTIONAL_BASELINE_SLOT_SECTION: Record<string, string> = {
  compatibility: '## 兼容性基线',
  deploy: '## 部署基线',
  performance: '## 性能与可靠性基线',
  reliability: '## 性能与可靠性基线',
  security: '## 安全基线',
};

export const OPTIONAL_BASELINE_SLOT_ENTRY_PREFIX: Record<string, string> = {
  compatibility: '### COMP-',
  deploy: '### DEP-',
  performance: '### NFR-',
  reliability: '### NFR-',
  security: '### SEC-',
};

export const WORKFLOW_DOC_RUNTIME_PLACEHOLDERS = new Set([
  '{{TASK_ID}}',
  '{{TASK_TITLE}}',
  '{{TASK_SLUG}}',
  '{{DATE}}',
  '{{AUTHOR}}',
]);

export type MarkdownHeading = {
  level: number;
  text: string;
};

export function isWorkflowDocName(value: string): value is WorkflowDocName {
  return WORKFLOW_DOC_SET.has(value as WorkflowDocName);
}

export function parseMarkdownHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const pattern = /^(#{1,6})\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
    });
  }

  return headings;
}

export function headingsEqual(left: MarkdownHeading[], right: MarkdownHeading[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (heading, index) => heading.level === right[index]?.level && heading.text === right[index]?.text,
  );
}

export function validateWorkflowDocContract(file: WorkflowDocName, content: string): void {
  for (const heading of WORKFLOW_DOC_REQUIRED_HEADINGS[file]) {
    if (!content.includes(heading)) {
      throw new Error(`Workflow doc contract missing heading "${heading}" in ${file}`);
    }
  }

  for (const snippet of WORKFLOW_DOC_REQUIRED_SNIPPETS[file] ?? []) {
    if (!content.includes(snippet)) {
      throw new Error(`Workflow doc contract missing required snippet "${snippet}" in ${file}`);
    }
  }
}

export function validateLifecycleGovernanceDoc(file: LifecycleGovernanceDoc, content: string): void {
  for (const heading of WORKFLOW_DOC_REQUIRED_HEADINGS[file]) {
    if (!content.includes(heading)) {
      throw new Error(`Workflow governance doc contract missing heading "${heading}" in ${file}`);
    }
  }

  for (const requirement of LIFECYCLE_GOVERNANCE_DOC_REQUIREMENTS[file]) {
    if (!requirement.pattern.test(content)) {
      throw new Error(`Workflow governance doc contract missing ${requirement.description} in ${file}`);
    }
  }
}

export function validateBaselineCoverageForBoundSlots(
  baselinesContent: string,
  boundSlotNames: readonly string[],
): void {
  for (const slotName of boundSlotNames) {
    const sectionHeading = OPTIONAL_BASELINE_SLOT_SECTION[slotName];
    const entryPrefix = OPTIONAL_BASELINE_SLOT_ENTRY_PREFIX[slotName];
    if (!sectionHeading || !entryPrefix) {
      continue;
    }

    if (!baselinesContent.includes(sectionHeading)) {
      throw new Error(
        `BASELINES.md is missing required section "${sectionHeading}" for bound validation slot "${slotName}".`,
      );
    }

    const sectionStart = baselinesContent.indexOf(sectionHeading);
    const remaining = baselinesContent.slice(sectionStart + sectionHeading.length);
    const nextSectionMatch = remaining.match(/\n##\s+/);
    const sectionBody =
      nextSectionMatch === null ? remaining : remaining.slice(0, nextSectionMatch.index ?? remaining.length);

    if (!sectionBody.includes(entryPrefix)) {
      throw new Error(
        `BASELINES.md section "${sectionHeading}" must contain a baseline entry prefixed with "${entryPrefix}" when validation slot "${slotName}" is bound.`,
      );
    }
  }
}
