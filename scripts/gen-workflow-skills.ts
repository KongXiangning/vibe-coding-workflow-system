#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  type JsonValue,
  type JsonObject,
  RESERVED_FAILURE_TARGETS,
  readText,
  loadProfile,
  getRequiredPath,
  normalizeList,
  projectPlaceholders,
  parseFrontmatter,
  stringifyInline,
  renderValue,
  validateUnresolvedPlaceholders,
  validateStages,
} from './workflow-core';

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
  const profile = loadProfile(PROFILE_PATH);

  const replacements = projectPlaceholders(profile);
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
    validateUnresolvedPlaceholders(outputPath, content, ALLOWED_UNRESOLVED);

    renderedSkills.push(renderedFile);
    pendingWrites.push({ outputPath, content });
  }

  validateStages(renderedSkills.map(skill => String(skill.frontmatter.stage)));

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
