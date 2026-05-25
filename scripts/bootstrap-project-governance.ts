#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  getWorkflowProfilePath,
  getRequiredPath,
  getWorkflowDocPath,
  getWorkflowDocRelativePath,
  getWorkflowGeneratedDir,
  loadProfile,
  readText,
  resolveRoot,
  validateProfilePathSemantics,
  type JsonObject,
} from './workflow-core';
import {
  classifyTaskIdentityFromCurrentTask,
  getTaskArtifactPath,
  type TaskArtifactKind,
  type TaskIdentityStatus,
} from './task-identity';
import {
  WORKFLOW_DOC_NAMES,
  WORKFLOW_DOC_REQUIRED_HEADINGS,
  type MarkdownHeading,
  type WorkflowDocName,
  headingsEqual,
  parseMarkdownHeadings,
} from './workflow-doc-contracts';

export type BootstrapDocLifecycle = 'absent' | 'materialized' | 'drifted';
export type BootstrapDocClassification =
  | 'not-applicable'
  | 'structure-compatible'
  | 'structure-drifted but mergeable'
  | 'incompatible and diff-only until confirmed';
export type BootstrapPlannedAction = 'materialize' | 'propose-diff only';
export type BootstrapExecutionState = 'ready' | 'awaiting-confirmation' | 'blocked';
export type BootstrapNextAction = 'none' | 'refresh-structure' | 'merge-safe update' | 'manual review';

export type GeneratorCheckResult = {
  name: string;
  command: string;
  status: 'passed';
  output?: string;
};

export type MinimalWorkflowCheck = {
  name: string;
  layer: 'protocol';
  command: string;
  purpose: string;
};

export type ValidationEntrypointSlot = {
  slot: string;
  phase: 'A4';
  owner: 'target-project';
  binding_status: 'unbound';
  blocker_level: 'blocks-merge' | 'target-project-defined';
  description: string;
};

export type BootstrapGovernedDocPlan = {
  file: string;
  doc_name: WorkflowDocName;
  generated_path: string;
  live_path: string;
  lifecycle: BootstrapDocLifecycle;
  classification: BootstrapDocClassification;
  planned_action: BootstrapPlannedAction;
  next_action: BootstrapNextAction;
  execution_state: BootstrapExecutionState;
  confirmation_required: boolean;
  reasons: string[];
  diff_preview?: string;
};

export type BootstrapTaskIdentityPlan = {
  current_task_path: string;
  required_fields: ['任务 ID', '任务标题', '任务 slug'];
  artifact_paths: {
    archive: 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md';
    paused: 'TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md';
    interrupted: 'TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md';
  };
  identity_source: 'CURRENT_TASK.md##任务信息';
  materialization_phase: 'A3';
  bootstrap_behavior: 'preserve-placeholders';
  status: 'absent' | TaskIdentityStatus;
  current_identity?: {
    id: string | null;
    title: string | null;
    slug: string | null;
    artifact_paths?: Record<TaskArtifactKind, string>;
  };
  output_impact_assessment: {
    scope: 'source-repo-governance-output';
    affected_output: 'bootstrap:project-governance';
    runtime_manifest_contract: 'unchanged';
    runtime_install_contract: 'unchanged';
    runtime_health_report_contract: 'unchanged';
    follow_up: 'none';
    reasons: string[];
  };
  reasons: string[];
};

export type BootstrapPlan = {
  schema_version: 'bootstrap-plan/v0.1.0';
  mode: 'dry-run';
  system_root: string;
  target_root: string;
  profile: {
    name: string;
    slug: string;
    type: string;
  };
  generator_checks: GeneratorCheckResult[];
  minimal_workflow_checks: MinimalWorkflowCheck[];
  governed_docs: BootstrapGovernedDocPlan[];
  task_identity: BootstrapTaskIdentityPlan;
  summary: {
    materialize: number;
    propose_diff_only: number;
    awaiting_confirmation: number;
    blocked: number;
  };
  first_run_checklist: string[];
  validation_entrypoint_slots: ValidationEntrypointSlot[];
  warnings: string[];
};

export type BuildBootstrapPlanOptions = {
  systemRoot?: string;
  targetRoot?: string;
  runGeneratorChecks?: boolean;
};

type ExistingDocClassification = {
  lifecycle: 'materialized' | 'drifted';
  classification: Exclude<BootstrapDocClassification, 'not-applicable'>;
  reasons: string[];
};

type BootstrapCliArgs = {
  dryRun: boolean;
  json: boolean;
  targetRoot?: string;
};

const GENERATOR_COMMANDS = [
  {
    name: 'gen:workflow-skills',
    args: ['run', 'scripts/gen-workflow-skills.ts', '--dry-run'],
    purpose: 'Validate workflow skill templates, metadata, path boundaries, and handoff closure.',
  },
  {
    name: 'gen:workflow-docs',
    args: ['run', 'scripts/gen-workflow-docs.ts', '--dry-run'],
    purpose: 'Validate generated governance doc structure, required headings, and placeholder handling.',
  },
  {
    name: 'gen:registry',
    args: ['run', 'scripts/gen-registry.ts', '--dry-run'],
    purpose: 'Validate registry generation against the shared workflow metadata baseline.',
  },
] as const;

const VALIDATION_ENTRYPOINT_SLOTS: ValidationEntrypointSlot[] = [
  {
    slot: 'unit',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'blocks-merge',
    description: 'Bind the target project unit-test command or runner during Adoption A4.',
  },
  {
    slot: 'integration',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'blocks-merge',
    description: 'Bind the target project integration-test command or runner during Adoption A4.',
  },
  {
    slot: 'e2e-smoke',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'blocks-merge',
    description: 'Bind the target project smoke or end-to-end validation command during Adoption A4.',
  },
  {
    slot: 'contract-compatibility',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'blocks-merge',
    description: 'Bind target-project contract compatibility checks during Adoption A4.',
  },
  {
    slot: 'performance',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'target-project-defined',
    description: 'Bind target-project performance checks during Adoption A4 if required.',
  },
  {
    slot: 'reliability',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'target-project-defined',
    description: 'Bind target-project reliability checks during Adoption A4 if required.',
  },
  {
    slot: 'compatibility',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'target-project-defined',
    description: 'Bind target-project compatibility checks during Adoption A4 if required.',
  },
  {
    slot: 'security',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'target-project-defined',
    description: 'Bind target-project security checks during Adoption A4 if required.',
  },
  {
    slot: 'deploy',
    phase: 'A4',
    owner: 'target-project',
    binding_status: 'unbound',
    blocker_level: 'target-project-defined',
    description: 'Bind target-project deploy or release checks during Adoption A4 if required.',
  },
];

const TASK_ARTIFACT_PATH_PATTERNS: BootstrapTaskIdentityPlan['artifact_paths'] = {
  archive: 'TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md',
  paused: 'TASKS/paused/TASK-<TASK_ID>-<TASK_SLUG>.md',
  interrupted: 'TASKS/interrupted/TASK-<TASK_ID>-<TASK_SLUG>.md',
};

function buildTaskArtifactPaths(taskId: string, taskSlug: string): Record<TaskArtifactKind, string> {
  return {
    archive: getTaskArtifactPath(taskId, taskSlug, 'archive'),
    paused: getTaskArtifactPath(taskId, taskSlug, 'paused'),
    interrupted: getTaskArtifactPath(taskId, taskSlug, 'interrupted'),
  };
}

function buildTaskIdentityImpactAssessment(): BootstrapTaskIdentityPlan['output_impact_assessment'] {
  return {
    scope: 'source-repo-governance-output',
    affected_output: 'bootstrap:project-governance',
    runtime_manifest_contract: 'unchanged',
    runtime_install_contract: 'unchanged',
    runtime_health_report_contract: 'unchanged',
    follow_up: 'none',
    reasons: [
      'This step upgrades only the source-repo bootstrap planning output from a single archive path to schema-backed multi-artifact path mappings.',
      'workflow:manifest, workflow:install, and workflow:health contracts remain unchanged in task 003 phase 1 and are not modified here.',
    ],
  };
}

function parseCliArgs(argv: string[]): BootstrapCliArgs {
  const parsed: BootstrapCliArgs = {
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--target-root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --target-root');
      }
      parsed.targetRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--target-root=')) {
      parsed.targetRoot = path.resolve(arg.slice('--target-root='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function ensureGeneratedDocContract(file: WorkflowDocName, content: string): void {
  for (const heading of WORKFLOW_DOC_REQUIRED_HEADINGS[file]) {
    if (!content.includes(heading)) {
      throw new Error(`Generated workflow doc contract missing heading "${heading}" in ${file}`);
    }
  }
}

function headingKey(heading: MarkdownHeading): string {
  return `${heading.level}:${heading.text}`;
}

function parseHeadingKey(key: string): { level: number; text: string } {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex < 0) {
    throw new Error(`Invalid heading key: ${key}`);
  }
  return {
    level: Number(key.slice(0, separatorIndex)),
    text: key.slice(separatorIndex + 1),
  };
}

function countHeadings(headings: MarkdownHeading[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const heading of headings) {
    const key = headingKey(heading);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function createDiffPreview(file: WorkflowDocName, liveContent: string, generatedContent: string): string {
  const header = [`--- live/${file}`, `+++ generated/${file}`];
  if (liveContent === generatedContent) {
    return [...header, '(no content diff)'].join('\n');
  }

  const liveLines = liveContent.split(/\r?\n/);
  const generatedLines = generatedContent.split(/\r?\n/);
  const preview = [...header];
  const maxLines = Math.max(liveLines.length, generatedLines.length);
  let emitted = 0;
  let truncated = false;

  for (let index = 0; index < maxLines; index += 1) {
    const liveLine = liveLines[index];
    const generatedLine = generatedLines[index];
    if (liveLine === generatedLine) {
      continue;
    }

    const diffLines: string[] = [];
    if (liveLine !== undefined) {
      diffLines.push(`- ${liveLine}`);
    }
    if (generatedLine !== undefined) {
      diffLines.push(`+ ${generatedLine}`);
    }

    if (emitted + diffLines.length > 40) {
      truncated = true;
      break;
    }

    preview.push(...diffLines);
    emitted += diffLines.length;
  }

  if (truncated) {
    preview.push('... diff preview truncated');
  }

  return preview.join('\n');
}

export function classifyExistingLiveDoc(
  file: WorkflowDocName,
  generatedContent: string,
  liveContent: string,
): ExistingDocClassification {
  const reasons: string[] = [];
  const generatedHeadings = parseMarkdownHeadings(generatedContent);
  const liveHeadings = parseMarkdownHeadings(liveContent);
  const generatedCounts = countHeadings(generatedHeadings);
  const liveCounts = countHeadings(liveHeadings);
  const expectedRequiredHeadings = WORKFLOW_DOC_REQUIRED_HEADINGS[file].map(requiredHeading => {
    const expected = generatedHeadings.find(heading => `## ${heading.text}` === requiredHeading);
    if (!expected) {
      throw new Error(`Generated workflow doc contract missing required heading metadata for ${file}`);
    }
    return expected;
  });

  const matchedPositions: number[] = [];
  for (const expectedHeading of expectedRequiredHeadings) {
    const matches = liveHeadings
      .map((heading, index) => ({ heading, index }))
      .filter(entry => entry.heading.text === expectedHeading.text);

    if (matches.length === 0) {
      reasons.push(`Missing required heading "${expectedHeading.text}"`);
      continue;
    }
    if (matches.length > 1) {
      reasons.push(`Ambiguous duplicate heading "${expectedHeading.text}"`);
      continue;
    }
    if (matches[0].heading.level !== expectedHeading.level) {
      reasons.push(
        `Required heading "${expectedHeading.text}" appears at level ${matches[0].heading.level}, expected level ${expectedHeading.level}`,
      );
      continue;
    }

    matchedPositions.push(matches[0].index);
  }

  for (const [key, liveCount] of liveCounts) {
    const generatedCount = generatedCounts.get(key) ?? 0;
    if (liveCount > generatedCount) {
      const heading = parseHeadingKey(key);
      reasons.push(
        `Extra live heading outside generated contract: ${'#'.repeat(heading.level)} ${heading.text}`,
      );
    }
  }

  if (reasons.length > 0) {
    return {
      lifecycle: 'drifted',
      classification: 'incompatible and diff-only until confirmed',
      reasons,
    };
  }

  const requiredInOrder = matchedPositions.every(
    (position, index) => index === 0 || matchedPositions[index - 1] < position,
  );
  const generatedSequenceMatches = headingsEqual(generatedHeadings, liveHeadings);
  const missingGeneratedStructure = [...generatedCounts.entries()]
    .filter(([key, generatedCount]) => (liveCounts.get(key) ?? 0) < generatedCount)
    .map(([key]) => key);

  if (generatedSequenceMatches) {
    return {
      lifecycle: 'materialized',
      classification: 'structure-compatible',
      reasons: ['Existing live doc matches the generated heading contract.'],
    };
  }

  if (!requiredInOrder) {
    return {
      lifecycle: 'drifted',
      classification: 'structure-drifted but mergeable',
      reasons: ['Required headings are present but not in canonical order.'],
    };
  }

  if (missingGeneratedStructure.length > 0) {
    return {
      lifecycle: 'drifted',
      classification: 'structure-drifted but mergeable',
      reasons: [
        `Generated-owned structure drift detected: ${missingGeneratedStructure
          .map(entry => {
            const heading = parseHeadingKey(entry);
            return `${'#'.repeat(heading.level)} ${heading.text}`;
          })
          .join(', ')}`,
      ],
    };
  }

  return {
    lifecycle: 'drifted',
    classification: 'structure-drifted but mergeable',
    reasons: ['Generated-owned structure differs and requires reviewed reconciliation.'],
  };
}

function planGovernedDoc(
  systemRoot: string,
  targetRoot: string,
  systemProfile: JsonObject,
  targetProfile: JsonObject,
  file: WorkflowDocName,
  generatedContent: string,
): BootstrapGovernedDocPlan {
  const relativeLiveFile = getWorkflowDocRelativePath(targetProfile, file);
  const livePath = getWorkflowDocPath(targetRoot, targetProfile, file);
  const generatedPath = path.join(getWorkflowGeneratedDir(systemRoot, systemProfile, 'workflow-docs'), file);

  if (!fs.existsSync(livePath)) {
    return {
      file: relativeLiveFile,
      doc_name: file,
      generated_path: generatedPath,
      live_path: livePath,
      lifecycle: 'absent',
      classification: 'not-applicable',
      planned_action: 'materialize',
      next_action: 'none',
      execution_state: 'ready',
      confirmation_required: false,
      reasons: ['Live doc is absent and may be materialized during Adoption A3.'],
    };
  }

  const liveContent = readText(livePath);
  const classification = classifyExistingLiveDoc(file, generatedContent, liveContent);
  const diffPreview = createDiffPreview(file, liveContent, generatedContent);

  if (classification.classification === 'structure-compatible') {
    return {
      file: relativeLiveFile,
      doc_name: file,
      generated_path: generatedPath,
      live_path: livePath,
      lifecycle: classification.lifecycle,
      classification: classification.classification,
      planned_action: 'propose-diff only',
      next_action: 'refresh-structure',
      execution_state: 'awaiting-confirmation',
      confirmation_required: true,
      reasons: classification.reasons,
      diff_preview: diffPreview,
    };
  }

  if (classification.classification === 'structure-drifted but mergeable') {
    return {
      file: relativeLiveFile,
      doc_name: file,
      generated_path: generatedPath,
      live_path: livePath,
      lifecycle: classification.lifecycle,
      classification: classification.classification,
      planned_action: 'propose-diff only',
      next_action: 'merge-safe update',
      execution_state: 'awaiting-confirmation',
      confirmation_required: true,
      reasons: classification.reasons,
      diff_preview: diffPreview,
    };
  }

  return {
    file: relativeLiveFile,
    doc_name: file,
    generated_path: generatedPath,
    live_path: livePath,
    lifecycle: classification.lifecycle,
    classification: classification.classification,
    planned_action: 'propose-diff only',
    next_action: 'manual review',
    execution_state: 'blocked',
    confirmation_required: true,
    reasons: classification.reasons,
    diff_preview: diffPreview,
  };
}

export function runProtocolGeneratorChecks(systemRoot: string): GeneratorCheckResult[] {
  const bunExecutable = process.execPath;
  return GENERATOR_COMMANDS.map(command => {
    const result = spawnSync(bunExecutable, command.args, {
      cwd: systemRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (result.error) {
      throw new Error(`Failed to execute ${command.name}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`Protocol-level bootstrap check failed for ${command.name}: ${output}`);
    }

    return {
      name: command.name,
      command: `"${bunExecutable}" ${command.args.join(' ')}`,
      status: 'passed' as const,
      output: output || undefined,
    };
  });
}

function loadGeneratedDocs(systemRoot: string, profile: JsonObject): Map<WorkflowDocName, string> {
  const generatedDocs = new Map<WorkflowDocName, string>();
  for (const file of WORKFLOW_DOC_NAMES) {
    const generatedPath = path.join(getWorkflowGeneratedDir(systemRoot, profile, 'workflow-docs'), file);
    const content = readText(generatedPath);
    ensureGeneratedDocContract(file, content);
    generatedDocs.set(file, content);
  }
  return generatedDocs;
}

function summarizePlans(governedDocs: BootstrapGovernedDocPlan[]): BootstrapPlan['summary'] {
  return governedDocs.reduce(
    (summary, docPlan) => {
      if (docPlan.planned_action === 'materialize') {
        summary.materialize += 1;
      } else {
        summary.propose_diff_only += 1;
      }
      if (docPlan.execution_state === 'awaiting-confirmation') {
        summary.awaiting_confirmation += 1;
      }
      if (docPlan.execution_state === 'blocked') {
        summary.blocked += 1;
      }
      return summary;
    },
    {
      materialize: 0,
      propose_diff_only: 0,
      awaiting_confirmation: 0,
      blocked: 0,
    },
  );
}

function buildChecklist(governedDocs: BootstrapGovernedDocPlan[]): string[] {
  const blockedFiles = governedDocs.filter(doc => doc.execution_state === 'blocked').map(doc => doc.file);
  const confirmFiles = governedDocs
    .filter(doc => doc.execution_state === 'awaiting-confirmation')
    .map(doc => `${doc.file} -> ${doc.next_action}`);
  const materializeFiles = governedDocs
    .filter(doc => doc.planned_action === 'materialize')
    .map(doc => doc.file);

  const checklist = [
    'Bootstrap planning is non-destructive in P7a; no live-doc, task-identity, or validation writes are performed here.',
    'Confirm protocol-level generator checks before treating the adoption plan as authoritative.',
    `Materialize absent governed docs only during Adoption A3: ${
      materializeFiles.length > 0 ? materializeFiles.join(', ') : 'none'
    }.`,
    'Materialize TASK_ID, TASK_TITLE, and TASK_SLUG inside CURRENT_TASK.md during Adoption A3 before archive-task resolves any TASKS/TASK-<id>-<slug>.md path.',
    `Review per-file diff previews before any write for existing live docs: ${
      confirmFiles.length > 0 ? confirmFiles.join(', ') : 'none'
    }.`,
    'Do not execute validation commands during bootstrap; bind validation slots only in Adoption A4.',
    'Do not materialize task identity during bootstrap; task identity remains an Adoption A3 concern owned by P7b.',
  ];

  if (blockedFiles.length > 0) {
    checklist.push(`Keep blocked files on manual diff-only review: ${blockedFiles.join(', ')}.`);
  }

  return checklist;
}

function buildMinimalWorkflowChecks(): MinimalWorkflowCheck[] {
  return GENERATOR_COMMANDS.map(command => ({
    name: command.name,
    layer: 'protocol',
    command: `bun run ${command.args[1]} --dry-run`,
    purpose: command.purpose,
  }));
}

function buildTaskIdentityPlan(targetRoot: string, profile: JsonObject): BootstrapTaskIdentityPlan {
  const currentTaskPath = getWorkflowDocPath(targetRoot, profile, 'CURRENT_TASK.md');
  if (!fs.existsSync(currentTaskPath)) {
    return {
      current_task_path: currentTaskPath,
      required_fields: ['任务 ID', '任务标题', '任务 slug'],
      artifact_paths: TASK_ARTIFACT_PATH_PATTERNS,
      identity_source: 'CURRENT_TASK.md##任务信息',
      materialization_phase: 'A3',
      bootstrap_behavior: 'preserve-placeholders',
      status: 'absent',
      output_impact_assessment: buildTaskIdentityImpactAssessment(),
      reasons: ['CURRENT_TASK.md is absent; task identity must first be materialized into the live task package during Adoption A3.'],
    };
  }

  const currentTaskContent = readText(currentTaskPath);
  const assessment = classifyTaskIdentityFromCurrentTask(currentTaskContent);
  const currentIdentity = {
    ...assessment.identity,
    artifact_paths:
      assessment.status === 'materialized' && assessment.identity.id && assessment.identity.slug
        ? buildTaskArtifactPaths(assessment.identity.id, assessment.identity.slug)
        : undefined,
  };

  return {
    current_task_path: currentTaskPath,
    required_fields: ['任务 ID', '任务标题', '任务 slug'],
    artifact_paths: TASK_ARTIFACT_PATH_PATTERNS,
    identity_source: 'CURRENT_TASK.md##任务信息',
    materialization_phase: 'A3',
    bootstrap_behavior: 'preserve-placeholders',
    status: assessment.status,
    current_identity: currentIdentity,
    output_impact_assessment: buildTaskIdentityImpactAssessment(),
    reasons: assessment.reasons,
  };
}

export function buildBootstrapPlan(options: BuildBootstrapPlanOptions = {}): BootstrapPlan {
  const systemRoot = path.resolve(options.systemRoot ?? resolveRoot());
  const targetRoot = path.resolve(options.targetRoot ?? systemRoot);
  const profilePath = getWorkflowProfilePath(targetRoot);
  const profile = loadProfile(profilePath);
  validateProfilePathSemantics(profile);
  const systemProfile = loadProfile(getWorkflowProfilePath(systemRoot));
  validateProfilePathSemantics(systemProfile);

  const generatedDocs = loadGeneratedDocs(systemRoot, systemProfile);
  const generatorChecks = options.runGeneratorChecks === false ? [] : runProtocolGeneratorChecks(systemRoot);
  const governedDocs = WORKFLOW_DOC_NAMES.map(file =>
    planGovernedDoc(systemRoot, targetRoot, systemProfile, profile, file, generatedDocs.get(file)!),
  );

  return {
    schema_version: 'bootstrap-plan/v0.1.0',
    mode: 'dry-run',
    system_root: systemRoot,
    target_root: targetRoot,
    profile: {
      name: String(getRequiredPath(profile, 'project.name')),
      slug: String(getRequiredPath(profile, 'project.slug')),
      type: String(getRequiredPath(profile, 'project.type')),
    },
    generator_checks: generatorChecks,
    minimal_workflow_checks: buildMinimalWorkflowChecks(),
    governed_docs: governedDocs,
    task_identity: buildTaskIdentityPlan(targetRoot, profile),
    summary: summarizePlans(governedDocs),
    first_run_checklist: buildChecklist(governedDocs),
    validation_entrypoint_slots: VALIDATION_ENTRYPOINT_SLOTS,
    warnings: [],
  };
}

export function formatBootstrapPlan(plan: BootstrapPlan): string {
  const lines = [
    `Bootstrap planning complete for ${plan.profile.name} (${plan.mode})`,
    `System root: ${plan.system_root}`,
    `Target root: ${plan.target_root}`,
    '',
    'Protocol-level checks:',
    ...plan.generator_checks.map(check => `- PASS ${check.name}`),
    '',
    `Task identity: status=${plan.task_identity.status}, phase=${plan.task_identity.materialization_phase}, artifacts=${Object.entries(
      plan.task_identity.artifact_paths,
    )
      .map(([kind, artifactPath]) => `${kind}=${artifactPath}`)
      .join(', ')}`,
    ...plan.task_identity.reasons.map(reason => `- ${reason}`),
    ...plan.task_identity.output_impact_assessment.reasons.map(reason => `- impact: ${reason}`),
    '',
    'Governed docs:',
    ...plan.governed_docs.map(
      doc =>
        `- ${doc.file}: lifecycle=${doc.lifecycle}, classification=${doc.classification}, action=${doc.planned_action}, state=${doc.execution_state}, next=${doc.next_action}`,
    ),
    '',
    `Summary: materialize=${plan.summary.materialize}, propose-diff only=${plan.summary.propose_diff_only}, awaiting-confirmation=${plan.summary.awaiting_confirmation}, blocked=${plan.summary.blocked}`,
    '',
    'First-run checklist:',
    ...plan.first_run_checklist.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Validation entrypoint slots:',
    ...plan.validation_entrypoint_slots.map(
      slot => `- ${slot.slot}: ${slot.description} [${slot.binding_status}]`,
    ),
  ];

  return lines.join('\n');
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const plan = buildBootstrapPlan({
    targetRoot: args.targetRoot,
    runGeneratorChecks: true,
  });
  console.log(args.json ? JSON.stringify(plan, null, 2) : formatBootstrapPlan(plan));
}

if (import.meta.main) {
  main();
}
