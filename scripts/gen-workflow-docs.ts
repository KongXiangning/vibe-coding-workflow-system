#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import {
  type JsonValue,
  type WriteOperation,
  getWorkflowProfilePath,
  readText,
  loadProfile,
  projectPlaceholders,
  stringifyInline,
  validateProfilePathSemantics,
  validateUnresolvedPlaceholders,
  resolveRoot,
  getWorkflowGeneratedDir,
  ensureCleanOutputDir,
  executeWrites,
  runGenerator,
} from './workflow-core';
import {
  WORKFLOW_DOC_NAMES,
  WORKFLOW_DOC_RUNTIME_PLACEHOLDERS,
  isWorkflowDocName,
  validateWorkflowDocContract,
} from './workflow-doc-contracts';

const ROOT = resolveRoot();
const PROFILE_PATH = getWorkflowProfilePath(ROOT);
const VERSION_PATH = path.join(ROOT, 'VERSION');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'docs');
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

  validateWorkflowDocContract(fileName, content);
}

function main(): void {
  const profile = loadProfile(PROFILE_PATH);
  validateProfilePathSemantics(profile);
  const outputDir = getWorkflowGeneratedDir(ROOT, profile, 'workflow-docs');

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

    pendingWrites.push({ path: path.join(outputDir, outputName), content });
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
    `Generated ${pendingWrites.length} workflow docs to ${outputDir}`,
  );

  if (!DRY_RUN) {
    ensureCleanOutputDir(
      outputDir,
      '.md',
      pendingWrites.map(operation => operation.path),
    );
  }
}

runGenerator('gen:workflow-docs', main);
