import {
  getTaskArtifactPath,
  normalizeResumeReviewReasons,
  parseBooleanField,
  parseTaskLifecycleState,
  type ResumeReviewReason,
  type TaskArtifactKind,
  type TaskLifecycleState,
  validateCurrentTaskResumeGate,
  validateTaskId,
  validateTaskSlug,
  validateTaskTitle,
} from './task-identity';

export const WORKFLOW_DOC_NAMES = [
  'BASELINES.md',
  'CONTRACTS.md',
  'DOCUMENT_CATALOG.md',
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
  'DOCUMENT_CATALOG.md': ['## 使用规则', '## 目录分类规则', '## 文档总览', '## 使用建议'],
  'CURRENT_TASK.md': [
    '## 任务信息',
    '## 背景与上下文',
    '## 验收标准',
    '## 允许修改范围',
    '## 禁止修改范围',
    '## 受影响的契约',
    '## 已确认决策',
    '## 待确认问题',
    '## 实现方案',
    '## 审查问题队列',
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
    '## 目录分类规则',
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
  'DOCUMENT_CATALOG.md': [
    'docs/workflow/',
    'docs/designs/',
    'docs/adoption/',
    '| `docs/workflow/WORKFLOW_GUIDE.md` |',
    '| `docs/designs/architecture.md` |',
    '| `docs/adoption/ADOPTION_REPORT.md` |',
    'git log -1 --format=%cI -- docs/workflow/DOCUMENT_CATALOG.md',
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
    '## 实现方案',
    '- Architecture impact:',
    '- Technical approach:',
    '- Alternatives considered:',
    '- Data / state flow:',
    '- Compatibility:',
    '- Risks and rollback:',
    '- Validation strategy:',
    '- Open decisions:',
    '## 审查问题队列',
    '- 当前来源：',
    'Finding ID：',
    '- Failure scenario：',
    '- Minimal fix direction：',
    '- Required test：',
    '- Handoff：',
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
    'docs/workflow/',
    'docs/designs/',
    'docs/adoption/',
    '`docs/workflow/DOCUMENT_CATALOG.md`',
    '| `docs/workflow/CURRENT_TASK.md` |',
    '| `/create-current-task` |',
    '| `/execute-current-task` |',
    '| `/continue-current-step` |',
    '| `/debug-and-fix-current-task` |',
    '| `/review-current-diff` |',
    '| `/close-current-task` |',
    '| `/plan-implementation` |',
    '```mermaid',
    'flowchart TD',
    'RegressionReport[run-regression report-only terminal report]',
    '## 新需求流程',
    '| 1 | `/create-current-task` | 把需求写成任务包初稿',
    '| 5 | `/plan-implementation` | 分析架构影响、技术路线、候选方案、风险和验证策略',
    '| 17 | `/archive-task` | 归档任务并清理当前入口',
    '## 新 Bug 流程',
    '| 4 | `/investigate-root-cause` | 复现问题、收集证据、确认 root cause 和最小修复路径',
    '| 5 | `/plan-implementation` | 基于 root cause 分析最小修复方案、架构影响、兼容性和验证策略',
    '| 16 | `/archive-task` | 归档 bug 任务',
    '| `/lock-scope` |',
    '| `/implement-current-step` |',
    '| `/review-diff` |',
    '| `/review-implementation` |',
    '| `/sync-review-findings` |',
    '| `/verify-contracts` |',
    '| `/run-regression` |',
    '实现质量',
    '边界条件和异常路径是否鲁棒',
    '测试是否覆盖原始问题和关键边界路径',
    'child override',
    'qa_mode=report-only',
    'file_or_symbol',
    'failing_scenario',
    'required_test_or_smoke_evidence',
    '审查问题队列',
    '`/sync-review-findings`',
    'CURRENT_TASK.md > 审查问题队列',
    '| 登记或记录一个新 bug，尚未授权修复 | `/create-current-task` |',
    '当前任务执行/验证失败，且不确定 bug 根因',
    '| 当前任务测试失败但原因不明 | `/investigate-root-cause` |',
    '| 当前任务回归验证失败 | `/investigate-root-cause` |',
    '| 当前任务实现过程中出现异常 | `/investigate-root-cause` |',
    '| 当前任务内连续修复没有收敛 | `/investigate-root-cause` |',
    '| 当前任务问题可能来自范围外系统或架构边界 | `/investigate-root-cause` |',
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

export type SuspendedTaskArtifactKind = Extract<TaskArtifactKind, 'paused' | 'interrupted'>;
export type SuspendedTaskPackageRehydrationStatus = 'write_incomplete' | 'ready_for_resume' | 'rehydrated';
export type SuspendedTaskPackageOwnershipState = 'recovery_only' | 'rehydrated';

export type SuspendedTaskArtifactPath = {
  relativePath: string;
  kind: SuspendedTaskArtifactKind;
  taskId: string;
  taskSlug: string;
};

export type SuspendedTaskPackageContract = SuspendedTaskArtifactPath & {
  taskTitle: string;
  artifactKind: SuspendedTaskArtifactKind;
  lifecycleState: TaskLifecycleState;
  suspensionReason: string;
  taskStartBase: string;
  lastReviewedCheckpoint: string;
  currentDiffReviewTarget: string;
  resumeRequiresReview: boolean;
  resumeReviewReasons: ResumeReviewReason[];
  rehydrationStatus: SuspendedTaskPackageRehydrationStatus;
  ownershipState: SuspendedTaskPackageOwnershipState;
  blockerStatus?: string;
  blockingEvidence?: string;
  remainingAcceptance?: string;
  failedChecks?: string[];
  checkpointEvidence?: string;
  dirtyAttribution?: string;
  environmentState?: string;
  recoveryStrategy?: string;
  rawFields: Record<string, string>;
};

export type InboxArtifactKind = 'inbox_item';
export type InboxItemType = 'requirement' | 'idea' | 'bug' | 'chore' | 'question';
export type InboxItemSource = 'user' | 'implementation' | 'review' | 'regression' | 'root_cause' | 'other';
export type InboxRelationToCurrentTask = 'unrelated';
export type InboxSuggestedNextAction = 'triage_later' | 'ask_user';
export type InboxArtifactStatus = 'captured';

export type InboxArtifactPath = {
  relativePath: string;
  dateStamp: string;
  shortId: string;
  itemSlug: string;
};

export type InboxArtifactContract = InboxArtifactPath & {
  itemId: string;
  title: string;
  artifactKind: InboxArtifactKind;
  type: InboxItemType;
  source: InboxItemSource;
  capturedAt: string;
  relationToCurrentTask: InboxRelationToCurrentTask;
  currentTaskId: string;
  description: string;
  evidence: string;
  suggestedNextAction: InboxSuggestedNextAction;
  status: InboxArtifactStatus;
  rawFields: Record<string, string>;
};

export const SUSPENDED_TASK_ARTIFACT_PATH_TEMPLATES: Record<SuspendedTaskArtifactKind, string> = {
  paused: 'TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md',
  interrupted: 'TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md',
};
export const INBOX_ARTIFACT_PATH_TEMPLATE = 'TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md';

export const SUSPENDED_TASK_PACKAGE_REQUIRED_FIELDS = [
  'task_id',
  'task_title',
  'task_slug',
  'artifact_kind',
  'lifecycle_state',
  'suspension_reason',
  'task_start_base',
  'last_reviewed_checkpoint',
  'current_diff_review_target',
  'resume_requires_review',
  'resume_review_reasons',
  'rehydration_status',
  'ownership_state',
] as const;
export const INBOX_ARTIFACT_REQUIRED_FIELDS = [
  'artifact_kind',
  'item_id',
  'title',
  'type',
  'source',
  'captured_at',
  'relation_to_current_task',
  'current_task_id',
  'description',
  'evidence',
  'suggested_next_action',
  'status',
] as const;

const SUSPENDED_TASK_ARTIFACT_PATH_PATTERNS: Record<SuspendedTaskArtifactKind, RegExp> = {
  paused: /^TASKS\/paused\/TASK-([0-9]{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/,
  interrupted: /^TASKS\/interrupted\/TASK-([0-9]{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/,
};
const INBOX_ARTIFACT_PATH_PATTERN = /^TASKS\/inbox\/INBOX-([0-9]{8})-([a-z0-9]{4,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const SUSPENDED_TASK_PACKAGE_REHYDRATION_STATUSES = new Set<SuspendedTaskPackageRehydrationStatus>([
  'write_incomplete',
  'ready_for_resume',
  'rehydrated',
]);
const SUSPENDED_TASK_PACKAGE_OWNERSHIP_STATES = new Set<SuspendedTaskPackageOwnershipState>([
  'recovery_only',
  'rehydrated',
]);
const INBOX_ARTIFACT_KINDS = new Set<InboxArtifactKind>(['inbox_item']);
const INBOX_ITEM_TYPES = new Set<InboxItemType>(['requirement', 'idea', 'bug', 'chore', 'question']);
const INBOX_ITEM_SOURCES = new Set<InboxItemSource>([
  'user',
  'implementation',
  'review',
  'regression',
  'root_cause',
  'other',
]);
const INBOX_RELATIONS_TO_CURRENT_TASK = new Set<InboxRelationToCurrentTask>(['unrelated']);
const INBOX_SUGGESTED_NEXT_ACTIONS = new Set<InboxSuggestedNextAction>(['triage_later', 'ask_user']);
const INBOX_ARTIFACT_STATUSES = new Set<InboxArtifactStatus>(['captured']);
const WORKFLOW_GUIDE_CAPTURE_REQUIRED_SNIPPETS = ['/capture-work-item', 'record-only', 'ask-user'] as const;

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

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function extractArtifactFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:-\s*)?([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    fields[match[1]] = match[2].trim();
  }

  return fields;
}

function getRequiredArtifactField(
  fields: Record<string, string>,
  field: (typeof SUSPENDED_TASK_PACKAGE_REQUIRED_FIELDS)[number],
  relativePath: string,
): string {
  const value = fields[field];
  if (!value) {
    throw new Error(`Suspended task package missing required field "${field}" in ${relativePath}.`);
  }
  return value;
}

function getOptionalArtifactField(fields: Record<string, string>, field: string): string | undefined {
  const value = fields[field];
  return value && value.length > 0 ? value : undefined;
}

function getRequiredInboxArtifactField(
  fields: Record<string, string>,
  field: (typeof INBOX_ARTIFACT_REQUIRED_FIELDS)[number],
  relativePath: string,
): string {
  const value = fields[field];
  if (!value) {
    throw new Error(`Inbox artifact missing required field "${field}" in ${relativePath}.`);
  }
  return value;
}

function parseInboxClosedFieldValue<T extends string>(value: string, allowedValues: Set<T>, field: string, relativePath: string): T {
  if (!allowedValues.has(value as T)) {
    throw new Error(
      `Inbox artifact field "${field}" in ${relativePath} must use one of: ${[...allowedValues].join(', ')}.`,
    );
  }
  return value as T;
}

function parseClosedFieldValue<T extends string>(value: string, allowedValues: Set<T>, field: string, relativePath: string): T {
  if (!allowedValues.has(value as T)) {
    throw new Error(
      `Suspended task package field "${field}" in ${relativePath} must use one of: ${[...allowedValues].join(', ')}.`,
    );
  }
  return value as T;
}

function parseCommaSeparatedList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function ensureNonEmptyOptionalField(fields: Record<string, string>, field: string, relativePath: string): string {
  const value = getOptionalArtifactField(fields, field);
  if (!value) {
    throw new Error(`Suspended task package missing required field "${field}" in ${relativePath}.`);
  }
  return value;
}

function assertSuspendedLifecycleMatchesArtifactKind(
  kind: SuspendedTaskArtifactKind,
  lifecycleState: TaskLifecycleState,
  relativePath: string,
): void {
  if (kind === 'paused' && !['paused_pending_closure', 'paused_blocked'].includes(lifecycleState)) {
    throw new Error(
      `Suspended task package ${relativePath} must use lifecycle_state paused_pending_closure or paused_blocked when artifact_kind=paused.`,
    );
  }

  if (kind === 'interrupted' && lifecycleState !== 'interrupted') {
    throw new Error(
      `Suspended task package ${relativePath} must use lifecycle_state interrupted when artifact_kind=interrupted.`,
    );
  }
}

function requiresFailedChecks(blockerStatus: string | undefined, blockingEvidence: string | undefined): boolean {
  const source = `${blockerStatus ?? ''} ${blockingEvidence ?? ''}`;
  return /(validation|test|smoke|protocol)/i.test(source);
}

function assertArtifactStatusConsistency(
  rehydrationStatus: SuspendedTaskPackageRehydrationStatus,
  ownershipState: SuspendedTaskPackageOwnershipState,
  resumeRequiresReview: boolean,
  relativePath: string,
): void {
  if (rehydrationStatus === 'write_incomplete' && ownershipState !== 'recovery_only') {
    throw new Error(
      `Suspended task package ${relativePath} must keep ownership_state=recovery_only when rehydration_status=write_incomplete.`,
    );
  }

  if (rehydrationStatus === 'ready_for_resume') {
    if (ownershipState !== 'recovery_only') {
      throw new Error(
        `Suspended task package ${relativePath} must use ownership_state=recovery_only when rehydration_status=ready_for_resume.`,
      );
    }
    if (!resumeRequiresReview) {
      throw new Error(
        `Suspended task package ${relativePath} must use resume_requires_review=true when rehydration_status=ready_for_resume.`,
      );
    }
  }

  if (rehydrationStatus === 'rehydrated' && ownershipState !== 'rehydrated') {
    throw new Error(
      `Suspended task package ${relativePath} must use ownership_state=rehydrated when rehydration_status=rehydrated.`,
    );
  }
}

export function parseSuspendedTaskArtifactPath(filePath: string): SuspendedTaskArtifactPath | null {
  const relativePath = normalizeRelativePath(filePath);

  for (const [kind, pattern] of Object.entries(SUSPENDED_TASK_ARTIFACT_PATH_PATTERNS) as [
    SuspendedTaskArtifactKind,
    RegExp,
  ][]) {
    const match = pattern.exec(relativePath);
    if (!match) {
      continue;
    }

    return {
      relativePath,
      kind,
      taskId: match[1],
      taskSlug: match[2],
    };
  }

  return null;
}

export function validateSuspendedTaskArtifactPath(filePath: string): SuspendedTaskArtifactPath {
  const parsed = parseSuspendedTaskArtifactPath(filePath);
  if (!parsed) {
    throw new Error(
      `Suspended task artifact path must match ${SUSPENDED_TASK_ARTIFACT_PATH_TEMPLATES.paused} or ${SUSPENDED_TASK_ARTIFACT_PATH_TEMPLATES.interrupted}. Got: ${normalizeRelativePath(filePath)}`,
    );
  }
  return parsed;
}

export function parseInboxArtifactPath(filePath: string): InboxArtifactPath | null {
  const relativePath = normalizeRelativePath(filePath);
  const match = INBOX_ARTIFACT_PATH_PATTERN.exec(relativePath);
  if (!match) {
    return null;
  }

  return {
    relativePath,
    dateStamp: match[1],
    shortId: match[2],
    itemSlug: match[3],
  };
}

export function validateInboxArtifactPath(filePath: string): InboxArtifactPath {
  const parsed = parseInboxArtifactPath(filePath);
  if (!parsed) {
    throw new Error(
      `Inbox artifact path must match ${INBOX_ARTIFACT_PATH_TEMPLATE}. Got: ${normalizeRelativePath(filePath)}`,
    );
  }
  return parsed;
}

export function validateInboxArtifactPackage(filePath: string, content: string): InboxArtifactContract {
  const artifactPath = validateInboxArtifactPath(filePath);
  const fields = extractArtifactFields(content);

  const artifactKindValue = getRequiredInboxArtifactField(fields, 'artifact_kind', artifactPath.relativePath);
  const itemId = getRequiredInboxArtifactField(fields, 'item_id', artifactPath.relativePath);
  const title = getRequiredInboxArtifactField(fields, 'title', artifactPath.relativePath);
  const typeValue = getRequiredInboxArtifactField(fields, 'type', artifactPath.relativePath);
  const sourceValue = getRequiredInboxArtifactField(fields, 'source', artifactPath.relativePath);
  const capturedAt = getRequiredInboxArtifactField(fields, 'captured_at', artifactPath.relativePath);
  const relationToCurrentTaskValue = getRequiredInboxArtifactField(fields, 'relation_to_current_task', artifactPath.relativePath);
  const currentTaskId = getRequiredInboxArtifactField(fields, 'current_task_id', artifactPath.relativePath);
  const description = getRequiredInboxArtifactField(fields, 'description', artifactPath.relativePath);
  const evidence = getRequiredInboxArtifactField(fields, 'evidence', artifactPath.relativePath);
  const suggestedNextActionValue = getRequiredInboxArtifactField(fields, 'suggested_next_action', artifactPath.relativePath);
  const statusValue = getRequiredInboxArtifactField(fields, 'status', artifactPath.relativePath);

  validateTaskTitle(title);
  validateTaskId(currentTaskId);

  const artifactKind = parseInboxClosedFieldValue(
    artifactKindValue,
    INBOX_ARTIFACT_KINDS,
    'artifact_kind',
    artifactPath.relativePath,
  );
  const type = parseInboxClosedFieldValue(typeValue, INBOX_ITEM_TYPES, 'type', artifactPath.relativePath);
  const source = parseInboxClosedFieldValue(sourceValue, INBOX_ITEM_SOURCES, 'source', artifactPath.relativePath);
  const relationToCurrentTask = parseInboxClosedFieldValue(
    relationToCurrentTaskValue,
    INBOX_RELATIONS_TO_CURRENT_TASK,
    'relation_to_current_task',
    artifactPath.relativePath,
  );
  const suggestedNextAction = parseInboxClosedFieldValue(
    suggestedNextActionValue,
    INBOX_SUGGESTED_NEXT_ACTIONS,
    'suggested_next_action',
    artifactPath.relativePath,
  );
  const status = parseInboxClosedFieldValue(statusValue, INBOX_ARTIFACT_STATUSES, 'status', artifactPath.relativePath);

  return {
    ...artifactPath,
    itemId,
    title,
    artifactKind,
    type,
    source,
    capturedAt,
    relationToCurrentTask,
    currentTaskId,
    description,
    evidence,
    suggestedNextAction,
    status,
    rawFields: fields,
  };
}

export function validateSuspendedTaskPackage(filePath: string, content: string): SuspendedTaskPackageContract {
  const artifactPath = validateSuspendedTaskArtifactPath(filePath);
  const fields = extractArtifactFields(content);

  const taskId = getRequiredArtifactField(fields, 'task_id', artifactPath.relativePath);
  const taskTitle = getRequiredArtifactField(fields, 'task_title', artifactPath.relativePath);
  const taskSlug = getRequiredArtifactField(fields, 'task_slug', artifactPath.relativePath);
  const artifactKind = getRequiredArtifactField(fields, 'artifact_kind', artifactPath.relativePath);
  const lifecycleStateValue = getRequiredArtifactField(fields, 'lifecycle_state', artifactPath.relativePath);
  const suspensionReason = getRequiredArtifactField(fields, 'suspension_reason', artifactPath.relativePath);
  const taskStartBase = getRequiredArtifactField(fields, 'task_start_base', artifactPath.relativePath);
  const lastReviewedCheckpoint = getRequiredArtifactField(fields, 'last_reviewed_checkpoint', artifactPath.relativePath);
  const currentDiffReviewTarget = getRequiredArtifactField(fields, 'current_diff_review_target', artifactPath.relativePath);
  const resumeRequiresReviewValue = getRequiredArtifactField(fields, 'resume_requires_review', artifactPath.relativePath);
  const resumeReviewReasonsValue = getRequiredArtifactField(fields, 'resume_review_reasons', artifactPath.relativePath);
  const rehydrationStatusValue = getRequiredArtifactField(fields, 'rehydration_status', artifactPath.relativePath);
  const ownershipStateValue = getRequiredArtifactField(fields, 'ownership_state', artifactPath.relativePath);

  validateTaskId(taskId);
  validateTaskTitle(taskTitle);
  validateTaskSlug(taskSlug);

  if (taskId !== artifactPath.taskId || taskSlug !== artifactPath.taskSlug) {
    throw new Error(
      `Suspended task package identity fields in ${artifactPath.relativePath} must match its path-derived TASK_ID/TASK_SLUG.`,
    );
  }

  const parsedArtifactKind = parseClosedFieldValue(
    artifactKind,
    new Set<SuspendedTaskArtifactKind>(['paused', 'interrupted']),
    'artifact_kind',
    artifactPath.relativePath,
  );
  if (parsedArtifactKind !== artifactPath.kind) {
    throw new Error(
      `Suspended task package ${artifactPath.relativePath} must keep artifact_kind=${artifactPath.kind} to match its path contract.`,
    );
  }

  const lifecycleState = parseTaskLifecycleState(lifecycleStateValue);
  assertSuspendedLifecycleMatchesArtifactKind(parsedArtifactKind, lifecycleState, artifactPath.relativePath);

  const resumeRequiresReview = parseBooleanField(resumeRequiresReviewValue, 'resume_requires_review');
  const { resumeReviewReasons } = validateCurrentTaskResumeGate(
    lifecycleState,
    resumeRequiresReview,
    resumeReviewReasonsValue,
  );

  const rehydrationStatus = parseClosedFieldValue(
    rehydrationStatusValue,
    SUSPENDED_TASK_PACKAGE_REHYDRATION_STATUSES,
    'rehydration_status',
    artifactPath.relativePath,
  );
  const ownershipState = parseClosedFieldValue(
    ownershipStateValue,
    SUSPENDED_TASK_PACKAGE_OWNERSHIP_STATES,
    'ownership_state',
    artifactPath.relativePath,
  );
  assertArtifactStatusConsistency(
    rehydrationStatus,
    ownershipState,
    resumeRequiresReview,
    artifactPath.relativePath,
  );

  const blockerStatus = getOptionalArtifactField(fields, 'blocker_status');
  const blockingEvidence = getOptionalArtifactField(fields, 'blocking_evidence');
  const remainingAcceptance = getOptionalArtifactField(fields, 'remaining_acceptance');
  const failedChecks = parseCommaSeparatedList(getOptionalArtifactField(fields, 'failed_checks'));
  const checkpointEvidence = getOptionalArtifactField(fields, 'checkpoint_evidence');
  const dirtyAttribution = getOptionalArtifactField(fields, 'dirty_attribution');
  const environmentState = getOptionalArtifactField(fields, 'environment_state');
  const recoveryStrategy = getOptionalArtifactField(fields, 'recovery_strategy');

  if (lifecycleState === 'paused_blocked') {
    ensureNonEmptyOptionalField(fields, 'blocker_status', artifactPath.relativePath);
    ensureNonEmptyOptionalField(fields, 'blocking_evidence', artifactPath.relativePath);
    ensureNonEmptyOptionalField(fields, 'remaining_acceptance', artifactPath.relativePath);
    if (requiresFailedChecks(blockerStatus, blockingEvidence) && (!failedChecks || failedChecks.length === 0)) {
      throw new Error(
        `Suspended task package ${artifactPath.relativePath} must record failed_checks when paused_blocked evidence indicates a validation failure.`,
      );
    }
  }

  if (parsedArtifactKind === 'interrupted') {
    ensureNonEmptyOptionalField(fields, 'checkpoint_evidence', artifactPath.relativePath);
    ensureNonEmptyOptionalField(fields, 'dirty_attribution', artifactPath.relativePath);
    ensureNonEmptyOptionalField(fields, 'environment_state', artifactPath.relativePath);
    ensureNonEmptyOptionalField(fields, 'recovery_strategy', artifactPath.relativePath);
  }

  return {
    ...artifactPath,
    taskTitle,
    artifactKind: parsedArtifactKind,
    lifecycleState,
    suspensionReason,
    taskStartBase,
    lastReviewedCheckpoint,
    currentDiffReviewTarget,
    resumeRequiresReview,
    resumeReviewReasons: normalizeResumeReviewReasons(resumeReviewReasonsValue),
    rehydrationStatus,
    ownershipState,
    blockerStatus,
    blockingEvidence,
    remainingAcceptance,
    failedChecks,
    checkpointEvidence,
    dirtyAttribution,
    environmentState,
    recoveryStrategy,
    rawFields: fields,
  };
}

export function getSuspendedTaskArtifactExpectedPath(
  taskId: string,
  taskSlug: string,
  kind: SuspendedTaskArtifactKind,
): string {
  return getTaskArtifactPath(taskId, taskSlug, kind);
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

export function validateWorkflowGuideCaptureContract(content: string): void {
  if (!content.includes('/capture-work-item')) {
    return;
  }

  for (const snippet of WORKFLOW_GUIDE_CAPTURE_REQUIRED_SNIPPETS) {
    if (!content.includes(snippet)) {
      throw new Error(`Workflow doc contract missing capture-work-item guide snippet "${snippet}" in WORKFLOW_GUIDE.md`);
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
