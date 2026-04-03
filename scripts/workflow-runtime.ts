#!/usr/bin/env bun

/**
 * Runtime entrypoints for the workflow-system.
 *
 * Implements WORKFLOW_PROTOCOL.md §17:
 * - repo-local health checks
 * - packaging/export manifest
 * - host-specific sync entrypoints
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  executeWrites,
  getRequiredPath,
  loadProfile,
  normalizeList,
  readText,
  resolveRoot,
  type JsonObject,
  type WriteOperation,
} from './workflow-core';
import { runFreshnessChecks } from './check-freshness';
import { runValidation } from './run-validation';

export const SUPPORTED_RUNTIME_HOSTS = ['claude', 'codex', 'factory'] as const;
export type RuntimeHost = (typeof SUPPORTED_RUNTIME_HOSTS)[number];
export type DetectedRuntimeHost = RuntimeHost | 'unknown';
export type RuntimeCommand = 'health' | 'manifest' | 'sync';
export type ManifestCategory = 'script' | 'protocol' | 'template' | 'config' | 'test';
export type SyncMode = 'copy';

export type WorkflowHealthComponent = {
  name: 'profile' | 'generators' | 'protocol' | 'host';
  status: 'passed' | 'failed' | 'warning';
  message: string;
  details?: string[];
};

export type WorkflowHealthReport = {
  root: string;
  host: DetectedRuntimeHost;
  ok: boolean;
  blocked_by: string[];
  components: WorkflowHealthComponent[];
};

export type ExportArtifact = {
  path: string;
  category: ManifestCategory;
  required: boolean;
  description: string;
};

export type HostCompatibilityNote = {
  runtime_root: string;
  isolated_prefix: string;
  sync_mode: SyncMode;
  notes: string[];
};

export type ExportManifest = {
  contract_version: 1;
  workflow_system_version: string;
  artifacts: ExportArtifact[];
  requirements: string[];
  post_install: string[];
  verification: string[];
  import_contract: {
    adoption_stage: 'A1';
    steps: Array<{
      name: string;
      description: string;
      command?: string;
    }>;
  };
  host_compatibility: Record<RuntimeHost, HostCompatibilityNote>;
};

export type HostSyncEntry = {
  skill_name: string;
  source: string;
  target: string;
};

export type HostSyncPlan = {
  host: RuntimeHost;
  runtime_root: string;
  isolated_prefix: string;
  mode: SyncMode;
  isolated: boolean;
  entries: HostSyncEntry[];
};

export type HostSyncResult = HostSyncPlan & {
  write: boolean;
  synced: number;
};

export type BuildWorkflowHealthOptions = {
  root?: string;
  host?: RuntimeHost;
};

export type SyncWorkflowHostOptions = {
  root?: string;
  host: RuntimeHost;
  write?: boolean;
};

type ParsedCliArgs = {
  command: RuntimeCommand;
  host?: RuntimeHost;
  json: boolean;
  write: boolean;
  root?: string;
};

type HostResolution = {
  host: DetectedRuntimeHost;
  source: 'cli' | 'env' | 'directory' | 'profile' | 'fallback';
  warning?: string;
};

const WORKFLOW_RUNTIME_PREFIX = 'workflow-system-';

const HOST_SKILL_DIRECTORIES: Record<RuntimeHost, string> = {
  claude: path.join('.claude', 'skills'),
  codex: path.join('.agents', 'skills'),
  factory: path.join('.factory', 'skills'),
};

const HOST_MARKERS: ReadonlyArray<{ host: RuntimeHost; marker: string }> = [
  { host: 'claude', marker: '.claude' },
  { host: 'codex', marker: '.agents' },
  { host: 'factory', marker: '.factory' },
];

const EXPORT_ARTIFACTS: readonly ExportArtifact[] = [
  { path: 'scripts/workflow-core.ts', category: 'script', required: true, description: 'Shared workflow generator core.' },
  { path: 'scripts/repo-path-patterns.ts', category: 'script', required: true, description: 'Restricted repo-path grammar and validation helpers.' },
  { path: 'scripts/workflow-doc-contracts.ts', category: 'script', required: true, description: 'Shared workflow-doc contract rules.' },
  { path: 'scripts/task-identity.ts', category: 'script', required: true, description: 'Task identity contract and archive naming rules.' },
  { path: 'scripts/bootstrap-project-governance.ts', category: 'script', required: true, description: 'Adoption bootstrap planning entrypoint.' },
  { path: 'scripts/validation-model.ts', category: 'script', required: true, description: 'Validation-layer and blocker-level model.' },
  { path: 'scripts/run-validation.ts', category: 'script', required: true, description: 'Protocol/project validation runner.' },
  { path: 'scripts/check-freshness.ts', category: 'script', required: true, description: 'Freshness gate for generated artifacts.' },
  { path: 'scripts/gen-workflow-skills.ts', category: 'script', required: true, description: 'Workflow skill generator.' },
  { path: 'scripts/gen-workflow-docs.ts', category: 'script', required: true, description: 'Workflow governance-doc generator.' },
  { path: 'scripts/gen-registry.ts', category: 'script', required: true, description: 'Workflow skill registry generator.' },
  { path: 'scripts/workflow-runtime.ts', category: 'script', required: true, description: 'P10 runtime health, manifest, and host sync entrypoints.' },
  { path: 'WORKFLOW_PROTOCOL.md', category: 'protocol', required: true, description: 'Authoritative workflow-system protocol, including §17 runtime contract.' },
  { path: 'FILE_SCHEMAS.md', category: 'protocol', required: true, description: 'Schema contract for workflow docs and related artifacts.' },
  { path: 'PROJECT_PROFILE.yaml', category: 'config', required: true, description: 'Project profile declaring hosts, paths, and validation matrix.' },
  { path: 'templates/skills/**', category: 'template', required: true, description: 'Workflow skill templates to be rendered in the target project.' },
  { path: 'templates/docs/**', category: 'template', required: true, description: 'Workflow governance-doc templates to be rendered in the target project.' },
  { path: 'test/gen-workflow-skills.test.ts', category: 'test', required: false, description: 'Workflow skill generator tests.' },
  { path: 'test/gen-workflow-docs.test.ts', category: 'test', required: false, description: 'Workflow docs generator tests.' },
  { path: 'test/gen-registry.test.ts', category: 'test', required: false, description: 'Registry generator tests.' },
  { path: 'test/bootstrap-project-governance.test.ts', category: 'test', required: false, description: 'Bootstrap planning tests.' },
  { path: 'test/task-identity.test.ts', category: 'test', required: false, description: 'Task identity contract tests.' },
  { path: 'test/validation-model.test.ts', category: 'test', required: false, description: 'Validation model tests.' },
  { path: 'test/run-validation.test.ts', category: 'test', required: false, description: 'Validation runner and freshness tests.' },
  { path: 'test/workflow-runtime.test.ts', category: 'test', required: false, description: 'Runtime manifest, health, and sync tests.' },
];

const POST_INSTALL_COMMANDS = [
  'bun install',
  'bun run gen:all',
  'bun run workflow:health',
];

const VERIFICATION_COMMANDS = [
  'bun run validate:protocol',
  'bun run workflow:manifest --json',
  'bun run workflow:sync --host <claude|codex|factory>',
];

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRuntimeHost(value: string): value is RuntimeHost {
  return (SUPPORTED_RUNTIME_HOSTS as readonly string[]).includes(value);
}

function getFlagValue(argv: string[], flag: string): string | undefined {
  const exactIndex = argv.indexOf(flag);
  if (exactIndex >= 0) {
    return argv[exactIndex + 1];
  }

  const prefixed = argv.find(arg => arg.startsWith(`${flag}=`));
  if (prefixed) {
    return prefixed.slice(flag.length + 1);
  }

  return undefined;
}

export function parseRuntimeCliArgs(argv: string[]): ParsedCliArgs {
  const hasSubcommand = argv[0] && !argv[0].startsWith('--');
  const command = (hasSubcommand ? argv[0] : 'health') as RuntimeCommand;
  if (!['health', 'manifest', 'sync'].includes(command)) {
    throw new Error(`Unknown workflow-runtime command: ${command}`);
  }

  const flags = hasSubcommand ? argv.slice(1) : argv;
  const hostValue = getFlagValue(flags, '--host');
  if (hostValue && !isRuntimeHost(hostValue)) {
    throw new Error(`--host must be one of ${SUPPORTED_RUNTIME_HOSTS.join(', ')}. Got: ${hostValue}`);
  }

  const root = getFlagValue(flags, '--root');

  for (const flag of flags) {
    if (
      flag === '--json' ||
      flag === '--write' ||
      flag === '--host' ||
      flag === '--root' ||
      flag.startsWith('--host=') ||
      flag.startsWith('--root=')
    ) {
      continue;
    }
    if ((flag === hostValue || flag === root) && !flag.startsWith('--')) {
      continue;
    }
    if (flag.startsWith('--')) {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  return {
    command,
    host: hostValue,
    json: flags.includes('--json'),
    write: flags.includes('--write'),
    root,
  };
}

function getRuntimeSkillRoot(root: string, host: RuntimeHost): string {
  return path.join(root, HOST_SKILL_DIRECTORIES[host]);
}

function readWorkflowProfile(root: string): JsonObject {
  return loadProfile(path.join(root, 'PROJECT_PROFILE.yaml'));
}

export function detectRuntimeHost(
  root: string,
  profile?: JsonObject,
  explicitHost?: RuntimeHost,
): HostResolution {
  if (explicitHost) {
    return { host: explicitHost, source: 'cli' };
  }

  const envHost = process.env.WORKFLOW_HOST;
  if (envHost) {
    if (isRuntimeHost(envHost)) {
      return { host: envHost, source: 'env' };
    }
    return {
      host: 'unknown',
      source: 'fallback',
      warning: `WORKFLOW_HOST is not supported: ${envHost}`,
    };
  }

  for (const marker of HOST_MARKERS) {
    if (fs.existsSync(path.join(root, marker.marker))) {
      return { host: marker.host, source: 'directory' };
    }
  }

  if (profile) {
    const primaryHosts = normalizeList(getRequiredPath(profile, 'project.primary_hosts'));
    const firstHost = primaryHosts[0];
    if (firstHost && isRuntimeHost(firstHost)) {
      return { host: firstHost, source: 'profile' };
    }
    if (firstHost) {
      return {
        host: 'unknown',
        source: 'fallback',
        warning: `project.primary_hosts[0] is not supported: ${firstHost}`,
      };
    }
  }

  return {
    host: 'unknown',
    source: 'fallback',
    warning: 'No supported runtime host detected.',
  };
}

function getHostCompatibilityNotes(): Record<RuntimeHost, HostCompatibilityNote> {
  return {
    claude: {
      runtime_root: HOST_SKILL_DIRECTORIES.claude,
      isolated_prefix: WORKFLOW_RUNTIME_PREFIX,
      sync_mode: 'copy',
      notes: [
        'Workflow skills are copied into .claude/skills/workflow-system-<skill>/SKILL.md.',
        'This namespace is separate from native gstack runtime outputs.',
      ],
    },
    codex: {
      runtime_root: HOST_SKILL_DIRECTORIES.codex,
      isolated_prefix: WORKFLOW_RUNTIME_PREFIX,
      sync_mode: 'copy',
      notes: [
        'Workflow skills are copied into .agents/skills/workflow-system-<skill>/SKILL.md.',
        'The sync layer stays separate from .agents/skills/gstack-* artifacts.',
      ],
    },
    factory: {
      runtime_root: HOST_SKILL_DIRECTORIES.factory,
      isolated_prefix: WORKFLOW_RUNTIME_PREFIX,
      sync_mode: 'copy',
      notes: [
        'Factory is supported through the same isolated copy-based sync model.',
        'Workflow runtime outputs remain outside the native gstack namespace.',
      ],
    },
  };
}

export function getExportManifest(root?: string): ExportManifest {
  const resolvedRoot = path.resolve(root ?? resolveRoot());
  const packageJson = JSON.parse(readText(path.join(resolvedRoot, 'package.json'))) as {
    version?: string;
  };

  return {
    contract_version: 1,
    workflow_system_version: packageJson.version ?? '0.0.0',
    artifacts: [...EXPORT_ARTIFACTS],
    requirements: [
      'bun >= 1.0.0',
      'package.json with `"type": "module"`',
      'yaml dependency available to the imported workflow scripts',
    ],
    post_install: [...POST_INSTALL_COMMANDS],
    verification: [...VERIFICATION_COMMANDS],
    import_contract: {
      adoption_stage: 'A1',
      steps: [
        {
          name: 'copy-artifacts',
          description: 'Import the required workflow-system scripts, templates, protocol docs, and profile scaffold.',
        },
        {
          name: 'install-dependencies',
          description: 'Install runtime dependencies required by the imported workflow scripts.',
          command: 'bun install',
        },
        {
          name: 'generate-outputs',
          description: 'Render the workflow skills, docs, and registry inside the target project.',
          command: 'bun run gen:all',
        },
        {
          name: 'verify-health',
          description: 'Run repo-local health checks before enabling host sync.',
          command: 'bun run workflow:health',
        },
        {
          name: 'sync-host-runtime',
          description: 'Copy generated workflow skills into the target host namespace.',
          command: 'bun run workflow:sync --host <claude|codex|factory>',
        },
      ],
    },
    host_compatibility: getHostCompatibilityNotes(),
  };
}

function collectGeneratedSkillFiles(root: string): string[] {
  const skillDir = path.join(root, 'generated', 'workflow-skills');
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Generated workflow skill directory not found: ${skillDir}`);
  }

  const files = fs.readdirSync(skillDir)
    .filter(entry => entry.endsWith('.SKILL.md'))
    .map(entry => path.join(skillDir, entry))
    .sort();

  if (files.length === 0) {
    throw new Error(`No generated workflow skills found in: ${skillDir}`);
  }

  return files;
}

function getSkillName(filePath: string): string {
  const fileName = path.basename(filePath);
  if (!fileName.endsWith('.SKILL.md')) {
    throw new Error(`Workflow skill file must end with .SKILL.md: ${filePath}`);
  }
  return fileName.slice(0, -'.SKILL.md'.length);
}

export function buildHostSyncPlan(root: string, host: RuntimeHost): HostSyncPlan {
  const runtimeRoot = getRuntimeSkillRoot(root, host);
  const entries = collectGeneratedSkillFiles(root).map(source => {
    const skillName = getSkillName(source);
    return {
      skill_name: skillName,
      source,
      target: path.join(runtimeRoot, `${WORKFLOW_RUNTIME_PREFIX}${skillName}`, 'SKILL.md'),
    };
  });

  const isolated = entries.every(entry =>
    path.basename(path.dirname(entry.target)).startsWith(WORKFLOW_RUNTIME_PREFIX),
  );
  if (!isolated) {
    throw new Error('Host sync plan is not isolated from native runtime outputs.');
  }

  return {
    host,
    runtime_root: runtimeRoot,
    isolated_prefix: WORKFLOW_RUNTIME_PREFIX,
    mode: 'copy',
    isolated,
    entries,
  };
}

export function syncWorkflowHost(options: SyncWorkflowHostOptions): HostSyncResult {
  const resolvedRoot = path.resolve(options.root ?? resolveRoot());
  const plan = buildHostSyncPlan(resolvedRoot, options.host);
  const operations: WriteOperation[] = plan.entries.map(entry => ({
    path: entry.target,
    content: readText(entry.source),
  }));

  executeWrites(
    operations,
    !options.write,
    `workflow-runtime: ${options.write ? 'synced' : 'planned'} ${operations.length} skills for ${options.host}`,
  );

  return {
    ...plan,
    write: Boolean(options.write),
    synced: operations.length,
  };
}

export function buildWorkflowHealthReport(
  options: BuildWorkflowHealthOptions = {},
): WorkflowHealthReport {
  const root = path.resolve(options.root ?? resolveRoot());
  const components: WorkflowHealthComponent[] = [];
  let profile: JsonObject | undefined;

  try {
    profile = readWorkflowProfile(root);
    const projectName = String(getRequiredPath(profile, 'project.name'));
    const projectType = String(getRequiredPath(profile, 'project.type'));
    components.push({
      name: 'profile',
      status: 'passed',
      message: `Loaded PROJECT_PROFILE.yaml for ${projectName} (${projectType}).`,
    });
  } catch (error) {
    components.push({
      name: 'profile',
      status: 'failed',
      message: formatError(error),
    });
  }

  let hostResolution: HostResolution;
  try {
    hostResolution = detectRuntimeHost(root, profile, options.host);
  } catch (error) {
    hostResolution = {
      host: 'unknown',
      source: 'fallback',
      warning: formatError(error),
    };
  }

  if (hostResolution.host === 'unknown') {
    components.push({
      name: 'host',
      status: 'warning',
      message: hostResolution.warning ?? 'No supported runtime host detected.',
    });
  } else {
    components.push({
      name: 'host',
      status: 'passed',
      message: `Using ${hostResolution.host} runtime namespace.`,
      details: [
        `source: ${hostResolution.source}`,
        `runtime_root: ${HOST_SKILL_DIRECTORIES[hostResolution.host]}`,
        `isolated_prefix: ${WORKFLOW_RUNTIME_PREFIX}`,
      ],
    });
  }

  if (!profile) {
    components.push({
      name: 'generators',
      status: 'failed',
      message: 'Skipped because PROJECT_PROFILE.yaml is invalid.',
    });
    components.push({
      name: 'protocol',
      status: 'failed',
      message: 'Skipped because PROJECT_PROFILE.yaml is invalid.',
    });
  } else {
    try {
      const freshness = runFreshnessChecks(root);
      const issues = freshness.results.filter(result => result.status !== 'fresh');
      if (issues.length === 0) {
        components.push({
          name: 'generators',
          status: 'passed',
          message: 'Generated artifacts are fresh.',
        });
      } else {
        components.push({
          name: 'generators',
          status: 'failed',
          message: 'Generated artifacts are stale or had freshness errors.',
          details: issues.map(issue =>
            issue.error
              ? `${issue.target}: ${issue.status} (${issue.error})`
              : `${issue.target}: ${issue.status}${issue.stale_files.length > 0 ? ` [${issue.stale_files.join(', ')}]` : ''}`,
          ),
        });
      }
    } catch (error) {
      components.push({
        name: 'generators',
        status: 'failed',
        message: formatError(error),
      });
    }

    try {
      const validation = runValidation({ root, layer: 'protocol' });
      if (validation.protocol_passed) {
        components.push({
          name: 'protocol',
          status: 'passed',
          message: 'Protocol-level validation passed.',
        });
      } else {
        components.push({
          name: 'protocol',
          status: 'failed',
          message: 'Protocol-level validation failed.',
          details: validation.blocked_gates,
        });
      }
    } catch (error) {
      components.push({
        name: 'protocol',
        status: 'failed',
        message: formatError(error),
      });
    }
  }

  const blockedBy = components
    .filter(component => component.status === 'failed')
    .map(component => component.name);

  return {
    root,
    host: hostResolution.host,
    ok: blockedBy.length === 0,
    blocked_by: blockedBy,
    components,
  };
}

export function formatWorkflowHealthReport(report: WorkflowHealthReport): string {
  const lines: string[] = [];
  lines.push(`workflow-runtime health: ${report.ok ? 'OK' : 'FAILED'}`);
  lines.push(`host: ${report.host}`);
  lines.push('');

  for (const component of report.components) {
    const icon = component.status === 'passed' ? '✓' : component.status === 'warning' ? '!' : '✗';
    lines.push(`${icon} ${component.name}: ${component.message}`);
    for (const detail of component.details ?? []) {
      lines.push(`  - ${detail}`);
    }
  }

  if (report.blocked_by.length > 0) {
    lines.push('');
    lines.push(`blocked by: ${report.blocked_by.join(', ')}`);
  }

  return lines.join('\n');
}

export function formatExportManifest(manifest: ExportManifest): string {
  return [
    `workflow-runtime manifest v${manifest.contract_version}`,
    `workflow-system version: ${manifest.workflow_system_version}`,
    `required artifacts: ${manifest.artifacts.filter(artifact => artifact.required).length}`,
    `optional tests: ${manifest.artifacts.filter(artifact => !artifact.required).length}`,
    `supported hosts: ${Object.keys(manifest.host_compatibility).join(', ')}`,
  ].join('\n');
}

export function formatHostSyncResult(result: HostSyncResult): string {
  const lines = [
    `workflow-runtime sync: ${result.write ? 'APPLIED' : 'PLANNED'}`,
    `host: ${result.host}`,
    `runtime_root: ${result.runtime_root}`,
    `skills: ${result.synced}`,
  ];

  for (const entry of result.entries) {
    lines.push(`- ${entry.skill_name} -> ${entry.target}`);
  }

  return lines.join('\n');
}

function main(): void {
  const args = parseRuntimeCliArgs(process.argv.slice(2));
  const root = path.resolve(args.root ?? resolveRoot());

  if (args.command === 'health') {
    const report = buildWorkflowHealthReport({ root, host: args.host });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatWorkflowHealthReport(report));
    if (!report.ok) {
      process.exit(1);
    }
    return;
  }

  if (args.command === 'manifest') {
    const manifest = getExportManifest(root);
    console.log(args.json ? JSON.stringify(manifest, null, 2) : formatExportManifest(manifest));
    return;
  }

  const profile = fs.existsSync(path.join(root, 'PROJECT_PROFILE.yaml'))
    ? readWorkflowProfile(root)
    : undefined;
  const detected = detectRuntimeHost(root, profile);
  const host = args.host ?? (detected.host === 'unknown' ? undefined : detected.host);
  if (!host) {
    throw new Error('workflow-runtime sync requires --host when no supported runtime host can be detected.');
  }

  const result = syncWorkflowHost({ root, host, write: args.write });
  console.log(args.json ? JSON.stringify(result, null, 2) : formatHostSyncResult(result));
}

if (import.meta.main) {
  main();
}
