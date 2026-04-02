#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import {
  type JsonValue,
  type WriteOperation,
  readText,
  loadProfile,
  projectPlaceholders,
  stringifyInline,
  validateProfilePathSemantics,
  validateUnresolvedPlaceholders,
  resolveRoot,
  ensureCleanOutputDir,
  executeWrites,
  runGenerator,
} from './workflow-core';
import {
  WORKFLOW_DOC_NAMES,
  WORKFLOW_DOC_REQUIRED_HEADINGS,
  WORKFLOW_DOC_RUNTIME_PLACEHOLDERS,
  isWorkflowDocName,
} from './workflow-doc-contracts';

const ROOT = resolveRoot();
const PROFILE_PATH = path.join(ROOT, 'PROJECT_PROFILE.yaml');
const VERSION_PATH = path.join(ROOT, 'VERSION');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'docs');
const OUTPUT_DIR = path.join(ROOT, 'generated', 'workflow-docs');
const DRY_RUN = process.argv.includes('--dry-run');

const REQUIRED_DOCS = new Set(WORKFLOW_DOC_NAMES);

function renderTemplate(content: string, replacements: Record<string, JsonValue>): string {
  let rendered = content;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(stringifyInline(replacement));
  }
  return rendered;
}

function validateRequiredHeadings(fileName: string, content: string): void {
  if (!isWorkflowDocName(fileName)) {
    throw new Error(`No required heading spec found for ${fileName}`);
  }

  for (const heading of WORKFLOW_DOC_REQUIRED_HEADINGS[fileName]) {
    if (!content.includes(heading)) {
      throw new Error(`Missing required heading "${heading}" in ${fileName}`);
    }
  }
}

function main(): void {
  const profile = loadProfile(PROFILE_PATH);
  validateProfilePathSemantics(profile);

  const version = readText(VERSION_PATH).trim();
  if (!version) {
    throw new Error(`VERSION file is empty or contains only whitespace: ${VERSION_PATH}`);
  }
  const replacements = { ...projectPlaceholders(profile), '{{VERSION}}': version };
  const templateFiles = fs.readdirSync(TEMPLATE_DIR).filter(file => file.endsWith('.md.tmpl')).sort();

  if (templateFiles.length === 0) {
    throw new Error(`No docs templates found in ${TEMPLATE_DIR}`);
  }

  // Phase 1: render all templates and validate in memory
  const pendingWrites: WriteOperation[] = [];

  for (const file of templateFiles) {
    const inputPath = path.join(TEMPLATE_DIR, file);
    const outputName = file.replace(/\.tmpl$/, '');
    const content = renderTemplate(readText(inputPath), replacements);

    validateRequiredHeadings(outputName, content);
    validateUnresolvedPlaceholders(outputName, content, WORKFLOW_DOC_RUNTIME_PLACEHOLDERS);

    pendingWrites.push({ path: path.join(OUTPUT_DIR, outputName), content });
  }

  const renderedNames = new Set(pendingWrites.map(w => path.basename(w.path)));
  for (const requiredDoc of REQUIRED_DOCS) {
    if (!renderedNames.has(requiredDoc)) {
      throw new Error(`Missing required generated doc: ${requiredDoc}`);
    }
  }

  // Phase 2: write only after all validations pass
  executeWrites(
    pendingWrites,
    DRY_RUN,
    `Generated ${pendingWrites.length} workflow docs to ${OUTPUT_DIR}`,
  );

  if (!DRY_RUN) {
    ensureCleanOutputDir(
      OUTPUT_DIR,
      '.md',
      pendingWrites.map(operation => operation.path),
    );
  }
}

runGenerator('gen:workflow-docs', main);
