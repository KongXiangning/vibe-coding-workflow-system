#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const ROOT = path.resolve(import.meta.dir, '..');
const PROFILE_PATH = path.join(ROOT, 'PROJECT_PROFILE.yaml');
const VERSION_PATH = path.join(ROOT, 'VERSION');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'docs');
const OUTPUT_DIR = path.join(ROOT, 'generated', 'workflow-docs');
const DRY_RUN = process.argv.includes('--dry-run');

const REQUIRED_DOCS = new Set([
  'CONTRACTS.md',
  'CURRENT_TASK.md',
  'DECISIONS.md',
  'LESSONS.md',
  'STATUS.md',
  'TASK_ARCHIVE.md',
  'TASK_SUMMARY.md',
]);

const REQUIRED_HEADINGS: Record<string, string[]> = {
  'CONTRACTS.md': ['## 使用规则', '## 一、接口契约', '## 二、架构契约', '## 三、变更规则'],
  'CURRENT_TASK.md': [
    '## 任务信息',
    '## 背景与上下文',
    '## 验收标准',
    '## 允许修改范围',
    '## 禁止修改范围',
    '## 受影响的契约',
    '## 已确认决策',
    '## 待确认问题',
    '## 实施步骤',
    '## 回归检查项',
    '## 回滚点',
    '## 执行记录',
  ],
  'DECISIONS.md': ['## 使用规则', '## 🏗️ 架构决策', '## 🎨 口味决策', '## ⏸️ 暂缓决策', '## ❌ 已否决'],
  'LESSONS.md': [
    '## 使用规则',
    '## 通用',
    '## 数据与存储',
    '## 前端与交互',
    '## 后端与服务',
    '## 测试与回归',
    '## 部署与运行时',
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
};

const ALLOWED_UNRESOLVED = new Set([
  '{{TASK_ID}}',
  '{{TASK_TITLE}}',
  '{{TASK_SLUG}}',
  '{{DATE}}',
  '{{AUTHOR}}',
]);

function readText(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function getRequiredPath(obj: JsonObject, dottedPath: string): JsonValue {
  const parts = dottedPath.split('.');
  let current: JsonValue = obj;

  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(part in current)) {
      throw new Error(`Missing required profile field: ${dottedPath}`);
    }
    current = current[part];
  }

  return current;
}

function stringifyInline(value: JsonValue): string {
  if (Array.isArray(value)) {
    return value.map(item => stringifyInline(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function placeholderMap(profile: JsonObject): Record<string, JsonValue> {
  const version = readText(VERSION_PATH).trim();
  if (!version) {
    throw new Error(`VERSION file is empty or contains only whitespace: ${VERSION_PATH}`);
  }
  return {
    '{{PROJECT_NAME}}': getRequiredPath(profile, 'project.name'),
    '{{PROJECT_TYPE}}': getRequiredPath(profile, 'project.type'),
    '{{TECH_STACK}}': getRequiredPath(profile, 'runtime.languages'),
    '{{TEST_COMMANDS}}': getRequiredPath(profile, 'runtime.test_commands'),
    '{{CODE_DIRECTORIES}}': getRequiredPath(profile, 'paths.source_directories'),
    '{{FORBIDDEN_PATHS}}': getRequiredPath(profile, 'boundaries.forbidden_paths'),
    '{{ARCHITECTURE_RULES}}': getRequiredPath(profile, 'architecture_rules'),
    '{{VERSION}}': version,
  };
}

function renderTemplate(content: string, replacements: Record<string, JsonValue>): string {
  let rendered = content;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(stringifyInline(replacement));
  }
  return rendered;
}

function validateRequiredHeadings(fileName: string, content: string): void {
  const headings = REQUIRED_HEADINGS[fileName];
  if (!headings) {
    throw new Error(`No required heading spec found for ${fileName}`);
  }

  for (const heading of headings) {
    if (!content.includes(heading)) {
      throw new Error(`Missing required heading "${heading}" in ${fileName}`);
    }
  }
}

function validateUnresolvedPlaceholders(fileName: string, content: string): void {
  const matches = content.match(/{{[^}]+}}/g) ?? [];
  const invalid = matches.filter(token => !ALLOWED_UNRESOLVED.has(token));
  if (invalid.length > 0) {
    throw new Error(`Unresolved placeholders in ${fileName}: ${invalid.join(', ')}`);
  }
}

function prepareOutputDir(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const entry of fs.readdirSync(OUTPUT_DIR)) {
    if (entry.endsWith('.md')) {
      fs.rmSync(path.join(OUTPUT_DIR, entry), { force: true });
    }
  }
}

function main(): void {
  const profile = parse(readText(PROFILE_PATH)) as JsonObject;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('PROJECT_PROFILE.yaml must parse to a mapping');
  }

  const replacements = placeholderMap(profile);
  const templateFiles = fs.readdirSync(TEMPLATE_DIR).filter(file => file.endsWith('.md.tmpl')).sort();

  if (templateFiles.length === 0) {
    throw new Error(`No docs templates found in ${TEMPLATE_DIR}`);
  }

  // Phase 1: render all templates and validate in memory
  const rendered: { outputName: string; content: string }[] = [];

  for (const file of templateFiles) {
    const inputPath = path.join(TEMPLATE_DIR, file);
    const outputName = file.replace(/\.tmpl$/, '');
    const content = renderTemplate(readText(inputPath), replacements);

    validateRequiredHeadings(outputName, content);
    validateUnresolvedPlaceholders(outputName, content);

    rendered.push({ outputName, content });
  }

  const renderedNames = new Set(rendered.map(r => r.outputName));
  for (const requiredDoc of REQUIRED_DOCS) {
    if (!renderedNames.has(requiredDoc)) {
      throw new Error(`Missing required generated doc: ${requiredDoc}`);
    }
  }

  // Phase 2: write only after all validations pass
  if (!DRY_RUN) {
    prepareOutputDir();
    for (const { outputName, content } of rendered) {
      fs.writeFileSync(path.join(OUTPUT_DIR, outputName), content, 'utf8');
    }
  }

  console.log(
    `Generated ${rendered.length} workflow docs to ${OUTPUT_DIR}${DRY_RUN ? ' (dry-run)' : ''}`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Workflow docs generation failed: ${message}`);
  process.exit(1);
}
