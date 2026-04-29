#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  type JsonValue,
  type JsonObject,
  type WriteOperation,
  getWorkflowProfilePath,
  readText,
  loadProfile,
  getRequiredPath,
  projectPlaceholders,
  parseFrontmatter,
  stringifyInline,
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
  getWorkflowGeneratedDir,
  ensureCleanOutputDir,
  executeWrites,
  runGenerator,
} from './workflow-core';

type SkillFile = {
  name: string;
  filePath: string;
  frontmatter: JsonObject;
  body: string;
};

const ROOT = resolveRoot();
const PROFILE_PATH = getWorkflowProfilePath(ROOT);
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'skills');
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

const PROJECT_VARIABLE_NOTE =
  'Replace project variables with concrete project-specific values during skill generation.';

const REFERENCE_RENDER_NOTE = [
  '## Reference Render Semantics',
  '',
  '- This generated file is a source-repo reference render produced from the current `.workflow-system/PROJECT_PROFILE.yaml`.',
  '- The concrete project values shown here reflect this repository\'s profile, not a universal target-project default.',
  '- Target projects render workflow skills from their own `.workflow-system/PROJECT_PROFILE.yaml` during install / sync.',
].join('\n');

function renderBody(body: string, replacements: Record<string, JsonValue>, projectType: string): string {
  let rendered = body;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(stringifyInline(replacement));
  }

  rendered = rendered.replace(
    PROJECT_VARIABLE_NOTE,
    'This source-repo reference render already expands the current `.workflow-system/PROJECT_PROFILE.yaml`; target projects re-render these values during install / sync.',
  );

  const emphasis = PROJECT_TYPE_EMPHASIS[projectType] ?? [];
  const referenceSection = `\n\n${REFERENCE_RENDER_NOTE}\n`;
  if (emphasis.length === 0) {
    return `${rendered.trimEnd()}${referenceSection}`;
  }

  return `${rendered.trimEnd()}${referenceSection}\n## Project-Type Emphasis\n\n${emphasis.map(item => `- ${item}`).join('\n')}\n`;
}

function validateWrites(skill: SkillFile): void {
  validatePathEntries(skill.frontmatter, ['reads', 'writes', 'forbidden_writes'], skill.filePath);
  validateWriteBoundaryConflicts(skill.frontmatter, skill.filePath);
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

function main(): void {
  const profile = loadProfile(PROFILE_PATH);
  validateProfilePathSemantics(profile);
  const outputDir = getWorkflowGeneratedDir(ROOT, profile, 'workflow-skills');

  const replacements = projectPlaceholders(profile);
  const projectType = String(getRequiredPath(profile, 'project.type'));
  const templates = loadTemplates();
  const knownNames = new Set(templates.map(template => template.name));
  const renderedSkills: SkillFile[] = [];
  const pendingWrites: WriteOperation[] = [];

  // Phase 1: Render and validate all templates in memory
  for (const template of templates) {
    const renderedFrontmatter = renderWorkflowDocReferences(
      renderValue(template.frontmatter, replacements),
      profile,
    ) as JsonObject;
    const renderedBody = renderWorkflowDocReferences(
      renderBody(template.body, replacements, projectType),
      profile,
    ) as string;
    const renderedFile: SkillFile = {
      name: template.name,
      filePath: template.filePath,
      frontmatter: renderedFrontmatter,
      body: renderedBody,
    };

    validateRequiredFields(renderedFrontmatter, REQUIRED_FIELDS, template.filePath);
    validateWrites(renderedFile);
    const handoff = extractHandoff(renderedFrontmatter, template.filePath);
    validateHandoff(handoff, knownNames, template.filePath);

    const outputPath = path.join(outputDir, `${template.name}.SKILL.md`);
    const content = formatSkill(renderedFrontmatter, renderedBody);
    validateUnresolvedPlaceholders(outputPath, content, ALLOWED_UNRESOLVED);

    renderedSkills.push(renderedFile);
    pendingWrites.push({ path: outputPath, content });
  }

  validateRuntimeSkillStages(renderedSkills.map(skill => String(skill.frontmatter.stage)));

  // Phase 2: Write all files only after all validations pass
  executeWrites(
    pendingWrites,
    DRY_RUN,
    `Generated ${renderedSkills.length} workflow skills to ${outputDir}`,
  );

  if (!DRY_RUN) {
    ensureCleanOutputDir(
      outputDir,
      '.SKILL.md',
      pendingWrites.map(operation => operation.path),
    );
  }
}

runGenerator('gen:workflow-skills', main);
