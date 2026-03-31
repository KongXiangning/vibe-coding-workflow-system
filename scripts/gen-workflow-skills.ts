#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { parse, stringify } from 'yaml';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type SkillFile = {
  name: string;
  filePath: string;
  frontmatter: JsonObject;
  body: string;
};

const ROOT = path.resolve(import.meta.dir, '..');
const PROFILE_PATH = path.join(ROOT, 'PROJECT_PROFILE.yaml');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'skills');
const OUTPUT_DIR = path.join(ROOT, 'generated', 'workflow-skills');
const DRY_RUN = process.argv.includes('--dry-run');

const REQUIRED_FIELDS = [
  'name',
  'purpose',
  'stage',
  'trigger',
  'inputs',
  'reads',
  'writes',
  'forbidden_writes',
  'must_check',
  'stop_conditions',
  'output',
  'handoff',
  'decision_policy',
  'verification',
] as const;

const REQUIRED_STAGES = new Set([
  '初始化',
  '阶段 1：需求进入',
  '阶段 2：范围锁定',
  '阶段 3：方案拆解',
  '阶段 4：小步实现',
  '阶段 4/6：实现或验证异常',
  '阶段 5：范围复核',
  '阶段 6：回归验证',
  '阶段 7：状态同步',
  '阶段 8：交付沉淀',
]);

const RESERVED_FAILURE_TARGETS = new Set(['ask-user']);
const ALLOWED_UNRESOLVED = new Set(['{{TASK_ID}}', '{{TASK_SLUG}}']);

const PROJECT_TYPE_EMPHASIS: Record<string, string[]> = {
  'frontend-app': [
    'Emphasize page, component, and state boundaries.',
    'Bias validation toward UI smoke checks and interaction coverage.',
    'Treat empty states and responsive behavior as first-class checks.',
  ],
  'backend-service': [
    'Emphasize API contract stability, auth boundaries, and migration risk.',
    'Bias validation toward request/response correctness and transaction safety.',
    'Treat schema and DTO drift as high-priority regression risks.',
  ],
  'fullstack-app': [
    'Emphasize frontend/backend/database boundary clarity.',
    'Bias validation toward end-to-end flow integrity and DTO consistency.',
    'Treat cross-layer scope drift as a first-class review concern.',
  ],
  'ai-engineering-workflow': [
    'Emphasize script boundaries, generated artifact discipline, and host compatibility.',
    'Bias validation toward generator correctness, workflow closure, and documentation sync.',
    'Treat accidental interference with existing generation pipelines as a critical risk.',
  ],
  'tooling-cli': [
    'Emphasize script boundaries, CLI surface stability, and generated artifact discipline.',
    'Bias validation toward command correctness, output determinism, and docs alignment.',
    'Treat host/runtime compatibility issues as first-class failures.',
  ],
};

function readText(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function parseFrontmatter(content: string, filePath: string): { frontmatter: JsonObject; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid frontmatter block in ${filePath}`);
  }

  const frontmatter = parse(match[1]) as JsonObject;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Frontmatter is not a mapping in ${filePath}`);
  }

  return { frontmatter, body: match[2] };
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

function normalizeList(value: JsonValue): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(item => String(item));
  return [String(value)];
}

function placeholderMap(profile: JsonObject): Record<string, JsonValue> {
  return {
    '{{PROJECT_NAME}}': getRequiredPath(profile, 'project.name'),
    '{{PROJECT_TYPE}}': getRequiredPath(profile, 'project.type'),
    '{{TECH_STACK}}': getRequiredPath(profile, 'runtime.languages'),
    '{{TEST_COMMANDS}}': getRequiredPath(profile, 'runtime.test_commands'),
    '{{DECISION_TYPES}}': getRequiredPath(profile, 'decision_types'),
    '{{CODE_DIRECTORIES}}': getRequiredPath(profile, 'paths.source_directories'),
    '{{FORBIDDEN_PATHS}}': getRequiredPath(profile, 'boundaries.forbidden_paths'),
    '{{ARCHITECTURE_RULES}}': getRequiredPath(profile, 'architecture_rules'),
  };
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

function renderValue(value: JsonValue, replacements: Record<string, JsonValue>): JsonValue {
  if (Array.isArray(value)) {
    const rendered: JsonValue[] = [];
    for (const item of value) {
      const next = renderValue(item, replacements);
      if (Array.isArray(next)) {
        rendered.push(...next);
      } else {
        rendered.push(next);
      }
    }
    return rendered;
  }

  if (value && typeof value === 'object') {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = renderValue(child, replacements);
    }
    return result;
  }

  if (typeof value !== 'string') {
    return value;
  }

  if (value in replacements) {
    return replacements[value];
  }

  let rendered = value;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(stringifyInline(replacement));
  }
  return rendered;
}

function renderBody(body: string, replacements: Record<string, JsonValue>, projectType: string): string {
  let rendered = body;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(stringifyInline(replacement));
  }

  const emphasis = PROJECT_TYPE_EMPHASIS[projectType] ?? [];
  if (emphasis.length === 0) {
    return rendered;
  }

  return `${rendered.trimEnd()}\n\n## Project-Type Emphasis\n\n${emphasis.map(item => `- ${item}`).join('\n')}\n`;
}

function validateRequiredFields(skill: SkillFile): void {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in skill.frontmatter)) {
      throw new Error(`Missing required field "${field}" in ${skill.filePath}`);
    }
  }
}

function validateHandoff(skill: SkillFile, knownNames: Set<string>): void {
  const handoff = skill.frontmatter.handoff;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    throw new Error(`Invalid handoff structure in ${skill.filePath}`);
  }

  const success = (handoff as JsonObject).success;
  const failure = (handoff as JsonObject).failure;

  if (typeof success !== 'string' || !knownNames.has(success)) {
    throw new Error(`Invalid handoff.success "${String(success)}" in ${skill.filePath}`);
  }

  if (
    typeof failure !== 'string' ||
    (!knownNames.has(failure) && !RESERVED_FAILURE_TARGETS.has(failure))
  ) {
    throw new Error(`Invalid handoff.failure "${String(failure)}" in ${skill.filePath}`);
  }
}

function validateWrites(skill: SkillFile): void {
  const writes = new Set(normalizeList(skill.frontmatter.writes));
  const forbidden = new Set(normalizeList(skill.frontmatter.forbidden_writes));
  for (const entry of writes) {
    if (forbidden.has(entry)) {
      throw new Error(`writes/forbidden_writes conflict "${entry}" in ${skill.filePath}`);
    }
  }
}

function validateUnresolvedPlaceholders(filePath: string, content: string): void {
  const matches = content.match(/{{[^}]+}}/g) ?? [];
  const invalid = matches.filter(token => !ALLOWED_UNRESOLVED.has(token));
  if (invalid.length > 0) {
    throw new Error(`Unresolved placeholders in ${filePath}: ${invalid.join(', ')}`);
  }
}

function validateStages(skills: SkillFile[]): void {
  const stages = new Set(skills.map(skill => String(skill.frontmatter.stage)));
  for (const stage of REQUIRED_STAGES) {
    if (!stages.has(stage)) {
      throw new Error(`Missing required stage coverage: ${stage}`);
    }
  }
}

function formatSkill(frontmatter: JsonObject, body: string): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${body.trimStart()}`;
}

function loadTemplates(): SkillFile[] {
  const files = fs
    .readdirSync(TEMPLATE_DIR)
    .filter(file => file.endsWith('.SKILL.md.tmpl'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No skill templates found in ${TEMPLATE_DIR}`);
  }

  return files.map(file => {
    const filePath = path.join(TEMPLATE_DIR, file);
    const { frontmatter, body } = parseFrontmatter(readText(filePath), filePath);
    const name = String(frontmatter.name ?? '').trim();
    if (!name) {
      throw new Error(`Missing name in ${filePath}`);
    }
    return { name, filePath, frontmatter, body };
  });
}

function prepareOutputDir(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const entry of fs.readdirSync(OUTPUT_DIR)) {
    if (entry.endsWith('.SKILL.md')) {
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
  const projectType = String(getRequiredPath(profile, 'project.type'));
  const templates = loadTemplates();
  const knownNames = new Set(templates.map(template => template.name));
  const renderedSkills: SkillFile[] = [];
  const pendingWrites: Array<{ outputPath: string; content: string }> = [];

  // Phase 1: Render and validate all templates in memory
  for (const template of templates) {
    const renderedFrontmatter = renderValue(template.frontmatter, replacements) as JsonObject;
    const renderedBody = renderBody(template.body, replacements, projectType);
    const renderedFile: SkillFile = {
      name: template.name,
      filePath: template.filePath,
      frontmatter: renderedFrontmatter,
      body: renderedBody,
    };

    validateRequiredFields(renderedFile);
    validateWrites(renderedFile);
    validateHandoff(renderedFile, knownNames);

    const outputPath = path.join(OUTPUT_DIR, `${template.name}.SKILL.md`);
    const content = formatSkill(renderedFrontmatter, renderedBody);
    validateUnresolvedPlaceholders(outputPath, content);

    renderedSkills.push(renderedFile);
    pendingWrites.push({ outputPath, content });
  }

  validateStages(renderedSkills);

  // Phase 2: Write all files only after all validations pass
  if (!DRY_RUN) {
    prepareOutputDir();
    for (const { outputPath, content } of pendingWrites) {
      fs.writeFileSync(outputPath, content, 'utf8');
    }
  }

  const summary = `Generated ${renderedSkills.length} workflow skills to ${OUTPUT_DIR}${DRY_RUN ? ' (dry-run)' : ''}`;
  console.log(summary);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Workflow skill generation failed: ${message}`);
  process.exit(1);
}
