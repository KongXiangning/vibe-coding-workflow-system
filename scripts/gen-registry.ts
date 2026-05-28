#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import {
  type JsonValue,
  type JsonObject,
  RESERVED_FAILURE_TARGETS,
  getWorkflowProfilePath,
  readText,
  loadProfile,
  normalizeList,
  projectPlaceholders,
  parseFrontmatter,
  renderValue,
  renderWorkflowDocReferences,
  validateProfilePathSemantics,
  validatePathEntries,
  validateWriteBoundaryConflicts,
  validateUnresolvedPlaceholders,
  validateRuntimeSkillStages,
  validateRequiredFields,
  extractHandoff,
  validateHandoff,
  resolveRoot,
  getWorkflowGeneratedRelativeDir,
  getWorkflowRegistryPath,
  executeWrites,
  runGenerator,
} from './workflow-core';

type SkillTemplate = {
  name: string;
  filePath: string;
  frontmatter: JsonObject;
};

type RegistrySkill = {
  name: string;
  purpose: string;
  stage: string;
  trigger: string;
  reads: string[];
  writes: string[];
  handoffSuccess: string;
  handoffFailure: string;
};

type StageSection = {
  stage: string;
  sectionTitle: string;
  summaryLabel: string;
};

const ROOT = resolveRoot();
const PROFILE_PATH = getWorkflowProfilePath(ROOT);
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'skills');
const DRY_RUN = process.argv.includes('--dry-run');

const REQUIRED_FIELDS = ['name', 'purpose', 'stage', 'trigger', 'reads', 'writes', 'handoff'] as const;
const ALLOWED_UNRESOLVED = new Set(['{{TASK_ID}}', '{{TASK_SLUG}}']);
const HIGH_RISK_SKILLS = [
  'execute-current-task',
  'supersede-current-task',
  'capture-work-item',
  'continue-current-step',
  'debug-and-fix-current-task',
  'review-current-diff',
  'close-current-task',
  'implement-current-step',
  'review-diff',
  'sync-review-findings',
  'plan-implementation',
  'review-implementation',
  'verify-contracts',
  'run-regression',
  'pause-current-task',
  'interrupt-current-task',
  'resume-paused-task',
  'resume-interrupted-task',
  'sync-contracts',
  'sync-decisions',
  'archive-task',
];
const WORKFLOW_ORDER = [
  'design-baseline-init',
  'realign-workflow-assets',
  'greenfield-init',
  'legacy-inventory',
  'adopt-existing-project',
  'execute-current-task',
  'create-current-task',
  'supersede-current-task',
  'capture-work-item',
  'review-current-task',
  'lock-scope',
  'classify-decisions',
  'plan-implementation',
  'decompose-task',
  'continue-current-step',
  'implement-current-step',
  'debug-and-fix-current-task',
  'investigate-root-cause',
  'review-current-diff',
  'review-diff',
  'review-implementation',
  'sync-review-findings',
  'verify-contracts',
  'run-regression',
  'pause-current-task',
  'interrupt-current-task',
  'resume-paused-task',
  'resume-interrupted-task',
  'sync-current-task',
  'sync-status',
  'sync-contracts',
  'sync-decisions',
  'sync-host-guidance',
  'close-current-task',
  'capture-lessons',
  'prepare-delivery-summary',
  'archive-task',
] as const;
const STAGE_SECTIONS: StageSection[] = [
  { stage: '初始化', sectionTitle: '### 3.1 初始化', summaryLabel: '初始化' },
  { stage: '阶段 1：需求进入', sectionTitle: '### 3.2 阶段 1：需求进入', summaryLabel: '阶段 1：需求进入' },
  { stage: '阶段 2：范围锁定', sectionTitle: '### 3.3 阶段 2：范围锁定', summaryLabel: '阶段 2：范围锁定' },
  { stage: '阶段 3：方案拆解', sectionTitle: '### 3.4 阶段 3：方案拆解', summaryLabel: '阶段 3：方案拆解' },
  { stage: '阶段 4：小步实现', sectionTitle: '### 3.5 阶段 4：小步实现', summaryLabel: '阶段 4：小步实现' },
  {
    stage: '阶段 4/6：实现或验证异常',
    sectionTitle: '### 3.6 阶段 4/6：异常处理',
    summaryLabel: '阶段 4/6：异常处理',
  },
  { stage: '阶段 5：范围复核', sectionTitle: '### 3.7 阶段 5：范围复核', summaryLabel: '阶段 5：范围复核' },
  { stage: '阶段 6：回归验证', sectionTitle: '### 3.8 阶段 6：回归验证', summaryLabel: '阶段 6：回归验证' },
  { stage: '阶段 7：状态同步', sectionTitle: '### 3.9 阶段 7：状态同步', summaryLabel: '阶段 7：状态同步' },
  { stage: '阶段 8：交付沉淀', sectionTitle: '### 3.10 阶段 8：交付沉淀', summaryLabel: '阶段 8：交付沉淀' },
];

const WORKFLOW_ORDER_INDEX = new Map(WORKFLOW_ORDER.map((name, index) => [name, index]));

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeTableText(value: string): string {
  return compactText(value).replace(/\|/g, ' / ');
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return '`[]`';
  }

  return items.map(item => `\`${escapeTableText(item)}\``).join('、');
}

function formatSkillRefs(names: string[]): string {
  return names.map(name => `\`${name}\``).join(' → ');
}

function validateWorkflowOrder(skills: RegistrySkill[]): void {
  const names = new Set(skills.map(skill => skill.name));
  for (const requiredName of WORKFLOW_ORDER) {
    if (!names.has(requiredName)) {
      throw new Error(`Missing required workflow skill: ${requiredName}`);
    }
  }

  if (names.size !== WORKFLOW_ORDER.length) {
    const extra = [...names].filter(name => !WORKFLOW_ORDER_INDEX.has(name)).sort();
    throw new Error(`Unexpected workflow skills missing explicit order: ${extra.join(', ')}`);
  }
}

function loadTemplates(): SkillTemplate[] {
  const files = fs
    .readdirSync(TEMPLATE_DIR)
    .filter(file => file.endsWith('.SKILL.md.tmpl'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No skill templates found in ${TEMPLATE_DIR}`);
  }

  return files.map(file => {
    const filePath = path.join(TEMPLATE_DIR, file);
    const { frontmatter } = parseFrontmatter(readText(filePath), filePath);
    const name = String(frontmatter.name ?? '').trim();
    if (!name) {
      throw new Error(`Missing name in ${filePath}`);
    }
    return { name, filePath, frontmatter };
  });
}

function toRegistrySkill(frontmatter: JsonObject, filePath: string): RegistrySkill {
  const handoff = extractHandoff(frontmatter, filePath);

  return {
    name: String(frontmatter.name ?? '').trim(),
    purpose: escapeTableText(String(frontmatter.purpose ?? '')),
    stage: String(frontmatter.stage ?? '').trim(),
    trigger: escapeTableText(String(frontmatter.trigger ?? '')),
    reads: normalizeList(frontmatter.reads).map(escapeTableText),
    writes: normalizeList(frontmatter.writes).map(escapeTableText),
    handoffSuccess: handoff.success,
    handoffFailure: handoff.failure,
  };
}

function sortSkills(skills: RegistrySkill[]): RegistrySkill[] {
  return [...skills].sort((left, right) => {
    const leftIndex = WORKFLOW_ORDER_INDEX.get(left.name);
    const rightIndex = WORKFLOW_ORDER_INDEX.get(right.name);
    if (leftIndex == null || rightIndex == null) {
      throw new Error(`Missing workflow order mapping for ${left.name} or ${right.name}`);
    }
    return leftIndex - rightIndex;
  });
}

function renderStageSection(section: StageSection, skills: RegistrySkill[]): string {
  const rows = skills.map(
    skill =>
      `| \`${skill.name}\` | ${skill.purpose} | ${skill.trigger} | ${formatList(skill.reads)} | ${formatList(skill.writes)} | \`${skill.handoffSuccess}\` | \`${skill.handoffFailure}\` |`,
  );

  if (rows.length === 0) {
    throw new Error(`No skills found for stage ${section.stage}`);
  }

  return [
    section.sectionTitle,
    '',
    '| Skill | 作用 | 触发条件 | 读取 | 写入 | handoff.success | handoff.failure |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function renderRegistry(skills: RegistrySkill[], workflowSkillDir: string): string {
  const sortedSkills = sortSkills(skills);
  const grouped = new Map<string, RegistrySkill[]>();

  for (const section of STAGE_SECTIONS) {
    grouped.set(section.stage, []);
  }

  for (const skill of sortedSkills) {
    const bucket = grouped.get(skill.stage);
    if (!bucket) {
      throw new Error(`No registry section configured for stage "${skill.stage}"`);
    }
    bucket.push(skill);
  }

  const summaryRows = STAGE_SECTIONS.map(section => {
    const stageSkills = grouped.get(section.stage) ?? [];
    if (section.stage === '初始化') {
      return `| ${section.summaryLabel} | \`design-baseline-init\` → \`realign-workflow-assets\` → \`greenfield-init\` / \`legacy-inventory\` → \`adopt-existing-project\` |`;
    }
    if (section.stage === '阶段 1：需求进入') {
      const stageSkillNames = stageSkills.map(skill => skill.name);
      if (stageSkillNames.includes('capture-work-item')) {
        const mainChain = stageSkills
          .filter(skill => skill.name !== 'capture-work-item')
          .map(skill => skill.name);
        return `| ${section.summaryLabel} | main chain: ${formatSkillRefs(mainChain)}；record-only branch: \`capture-work-item\` → \`ask-user\` |`;
      }
    }
    if (section.stage === '阶段 5：范围复核') {
      return `| ${section.summaryLabel} | \`review-diff\` → \`review-implementation\` → \`verify-contracts\`；findings detour: \`review-diff\` / \`review-implementation\` → \`sync-review-findings\` → \`implement-current-step\` |`;
    }
    if (section.stage === '阶段 7：状态同步') {
      return `| ${section.summaryLabel} | suspend branch: \`pause-current-task\` / \`interrupt-current-task\`；resume branch: \`resume-paused-task\` / \`resume-interrupted-task\` → \`review-current-task\`；steady-state sync: \`sync-current-task\` → \`sync-status\` → \`sync-contracts\` → \`sync-decisions\` → \`sync-host-guidance\` → \`capture-lessons\` |`;
    }
    return `| ${section.summaryLabel} | ${formatSkillRefs(stageSkills.map(skill => skill.name))} |`;
  });

  const stageSections = STAGE_SECTIONS.map(section =>
    renderStageSection(section, grouped.get(section.stage) ?? []),
  );

  return `# SKILL_REGISTRY.md

本文件记录 workflow-skill 系统中各 skill 的职责、触发条件、输入输出工件与 handoff 关系。

它的作用不是替代 skill 文件本身，而是提供一个便于人类审计和维护的目录层视图。

---

## 1. 注册表使用规则

- 本文件面向人类阅读与审查
- 本文件由 \`bun run gen:registry\` 自动生成，请勿手工编辑
- 元数据来源为 \`templates/skills/*.SKILL.md.tmpl\` frontmatter，并按 \`.workflow-system/PROJECT_PROFILE.yaml\` 解析项目级占位符
- 真实执行协议以 \`${workflowSkillDir}/*.SKILL.md\` 为准

---

## 2. 工作流总览

| 阶段 | Skill |
|---|---|
${summaryRows.join('\n')}

失败分支：

- \`run-regression\` 失败时进入 \`investigate-root-cause\`
- 大多数其他 skill 在失败时 handoff 到 \`ask-user\`

---

## 3. Skill 清单

${stageSections.join('\n\n')}

---

## 4. 高风险 / 重点审计 skill

以下 skill 应优先关注，因为它们最容易造成越界或状态失真：

${HIGH_RISK_SKILLS.map(name => `- \`${name}\``).join('\n')}

重点检查点：

- 是否读了规定的治理文档
- 是否只写允许写入的工件
- 是否遵守 handoff 图
- 是否把失败显式交给 \`ask-user\` 或根因调查路径

---

## 5. 建议的后续演进

下一步可以把本文件继续升级为：

1. 增加每个 skill 的 \`must_check\`、\`stop_conditions\` 摘要
2. 增加和 \`.workflow-system/FILE_SCHEMAS.md\`、\`.workflow-system/PROJECT_PROFILE.yaml\` 的交叉引用
3. 增加按风险级别或 stage 的细分视图
`;
}

function main(): void {
  const profile = loadProfile(PROFILE_PATH);
  validateProfilePathSemantics(profile);
  const outputPath = getWorkflowRegistryPath(ROOT, profile);
  const workflowSkillDir = getWorkflowGeneratedRelativeDir(profile, 'workflow-skills');

  const replacements = projectPlaceholders(profile);
  const templates = loadTemplates();
  const renderedSkills: RegistrySkill[] = [];
  const knownNames = new Set(templates.map(template => template.name));

  for (const template of templates) {
    const renderedFrontmatter = renderWorkflowDocReferences(
      renderValue(template.frontmatter, replacements),
      profile,
    ) as JsonObject;
    validateRequiredFields(renderedFrontmatter, REQUIRED_FIELDS, template.filePath);
    validatePathEntries(renderedFrontmatter, ['reads', 'writes', 'forbidden_writes'], template.filePath);
    validateWriteBoundaryConflicts(renderedFrontmatter, template.filePath);
    const skill = toRegistrySkill(renderedFrontmatter, template.filePath);
    validateHandoff(
      { success: skill.handoffSuccess, failure: skill.handoffFailure },
      knownNames,
      template.filePath,
    );
    renderedSkills.push(skill);
  }

  validateRuntimeSkillStages(renderedSkills.map(skill => skill.stage));
  validateWorkflowOrder(renderedSkills);

  const content = renderRegistry(renderedSkills, workflowSkillDir);
  validateUnresolvedPlaceholders('registry', content, ALLOWED_UNRESOLVED);

  executeWrites(
    [{ path: outputPath, content }],
    DRY_RUN,
    `Generated workflow skill registry to ${outputPath}`,
  );
}

runGenerator('gen:registry', main);
