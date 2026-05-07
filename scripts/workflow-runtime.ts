#!/usr/bin/env bun

/**
 * Runtime entrypoints for the workflow-system.
 *
 * Implements WORKFLOW_PROTOCOL.md §17:
 * - repo-local health checks
 * - packaging/export manifest
 * - host-specific sync entrypoints
 */

import { execSync, spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse, stringify } from 'yaml';
import {
  executeWrites,
  getWorkflowDocPath,
  getWorkflowDocRelativePath,
  getWorkflowGeneratedDir,
  getWorkflowProfilePath,
  getRequiredPath,
  loadProfile,
  normalizeList,
  readText,
  renderWorkflowDocReferences,
  resolveRoot,
  validateProfilePathSemantics,
  WORKFLOW_PROFILE_RELATIVE_PATH,
  WORKFLOW_PROTOCOL_RELATIVE_PATH,
  WORKFLOW_SCHEMAS_RELATIVE_PATH,
  type JsonObject,
  type WriteOperation,
} from './workflow-core';
import { repoPatternMatchesPath } from './repo-path-patterns';
import { runFreshnessChecks } from './check-freshness';
import { runValidation } from './run-validation';

export const SUPPORTED_RUNTIME_HOSTS = ['claude', 'codex', 'factory'] as const;
export type RuntimeHost = (typeof SUPPORTED_RUNTIME_HOSTS)[number];
export type DetectedRuntimeHost = RuntimeHost | 'unknown';
export type RuntimeCommand = 'health' | 'manifest' | 'sync' | 'pack' | 'install';
export type ManifestCategory = 'script' | 'protocol' | 'template' | 'config' | 'test' | 'generated';
export type SyncMode = 'copy';

export type WorkflowSourcePipeline = {
  normative_sources: {
    protocol: string[];
    schemas: string[];
  };
  template_roots: string[];
  generated_references: string[];
  runtime_entry: string;
  bundle_output_root: string;
};

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
  source_pipeline: WorkflowSourcePipeline;
  package_json_contract: {
    type: 'module';
    engines: {
      bun: string;
    };
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  requirements: string[];
  post_install: string[];
  verification: string[];
  import_contract: {
    install: {
      adoption_stage: 'A1';
      steps: Array<{
        name: string;
        description: string;
        command?: string;
      }>;
    };
    init: {
      adoption_stage: 'A2';
      steps: Array<{
        name: string;
        description: string;
        command?: string;
      }>;
    };
    adopt: {
      adoption_stage: 'A3';
      steps: Array<{
        name: string;
        description: string;
        command?: string;
      }>;
    };
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
  planned_prune_targets: string[];
};

export type HostSyncResult = HostSyncPlan & {
  write: boolean;
  synced: number;
  pruned: number;
  applied_prune_targets: string[];
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
  bundle?: string;
  dryRun: boolean;
  outDir?: string;
  includeTests: boolean;
  repairBootstrapDrift: boolean;
  replaceManagedDrift: boolean;
};

export type BundleArtifact = {
  path: string;
  category: ManifestCategory;
  required: boolean;
  checksum: string;
};

export type WorkflowBundle = {
  contract_version: 1;
  workflow_system_version: string;
  bundle_id: string;
  source_commit: string;
  source_tree_hash: string;
  created_at: string;
  artifacts: BundleArtifact[];
  source_pipeline: WorkflowSourcePipeline;
  package_json_contract: ExportManifest['package_json_contract'];
  profile_scaffold_template: JsonObject;
  post_install: string[];
  verification: string[];
  import_contract: ExportManifest['import_contract'];
  host_compatibility: Record<RuntimeHost, HostCompatibilityNote>;
  includes_optional_tests: boolean;
};

export type PackReport = {
  report_version: 1;
  bundle_id: string;
  workflow_system_version: string;
  source_commit: string;
  source_tree_hash: string;
  output_directory: string;
  artifact_count: number;
  includes_optional_tests: boolean;
  created_at: string;
};

export type PackOptions = {
  root?: string;
  outDir?: string;
  includeTests?: boolean;
  dryRun?: boolean;
};

export type FailureCategory = 'frozen_path' | 'local_drift' | 'contract_conflict' | 'incompatible_target';

export type PreflightFailure = {
  category: FailureCategory;
  path: string;
  message: string;
};

export type ManagedFileEntry = {
  path: string;
  mode: 'replace-managed' | 'bootstrap-skill-install';
  bundle_checksum: string;
  installed_checksum: string;
};

export type HostSyncStateEntry = {
  namespace: string;
  synced_at: string | null;
  synced_entries: Array<{ skill_name: string; target_path: string }>;
};

export type InstallState = {
  state_version: 1;
  bundle_id: string;
  workflow_system_version: string;
  installed_at: string;
  managed_files: ManagedFileEntry[];
  package_json_fragment: JsonObject;
  project_profile_fragment: JsonObject;
  host_sync_state: Record<string, HostSyncStateEntry>;
};

export type PlannedWrite = {
  path: string;
  action: 'create' | 'overwrite' | 'merge' | 'scaffold' | 'delete';
  mode: string;
  content?: string;
};

export type InstallReport = {
  report_version: 1;
  bundle_id: string;
  workflow_system_version: string;
  dry_run: boolean;
  success: boolean;
  failures: PreflightFailure[];
  planned_writes: Array<{ path: string; action: string; mode: string }>;
  exit_code: number;
};

export type InstallOptions = {
  bundleDir: string;
  root?: string;
  host?: RuntimeHost;
  dryRun?: boolean;
  repairBootstrapDrift?: boolean;
  replaceManagedDrift?: boolean;
};

type HostResolution = {
  host: DetectedRuntimeHost;
  source: 'cli' | 'env' | 'directory' | 'profile' | 'fallback';
  warning?: string;
};

const WORKFLOW_RUNTIME_PREFIX = 'workflow-system-';
const DEFAULT_BOOTSTRAP_HOSTS: readonly RuntimeHost[] = ['claude', 'codex'];
const BOOTSTRAP_INIT_SKILLS = [
  'design-baseline-init',
  'realign-workflow-assets',
  'greenfield-init',
  'legacy-inventory',
  'adopt-existing-project',
] as const;

const HOST_SKILL_DIRECTORIES: Record<RuntimeHost, string> = {
  claude: path.join('.claude', 'skills'),
  codex: path.join('.codex', 'skills'),
  factory: path.join('.factory', 'skills'),
};

const HOST_MARKERS: ReadonlyArray<{ host: RuntimeHost; marker: string }> = [
  { host: 'claude', marker: '.claude' },
  { host: 'codex', marker: '.codex' },
  { host: 'factory', marker: '.factory' },
];

const EXPORT_ARTIFACTS: readonly ExportArtifact[] = [
  { path: 'scripts/workflow-core.ts', category: 'script', required: true, description: 'Shared workflow generator core.' },
  { path: 'scripts/repo-path-patterns.ts', category: 'script', required: true, description: 'Restricted repo-path grammar and validation helpers.' },
  { path: 'scripts/workflow-doc-contracts.ts', category: 'script', required: true, description: 'Shared workflow-doc contract rules.' },
  { path: 'scripts/propagation-governance.ts', category: 'script', required: true, description: 'Runtime propagation-governance semantic validation.' },
  { path: 'scripts/task-identity.ts', category: 'script', required: true, description: 'Task identity contract and archive naming rules.' },
  { path: 'scripts/bootstrap-project-governance.ts', category: 'script', required: true, description: 'Adoption bootstrap planning entrypoint.' },
  { path: 'scripts/validation-model.ts', category: 'script', required: true, description: 'Validation-layer and blocker-level model.' },
  { path: 'scripts/run-validation.ts', category: 'script', required: true, description: 'Protocol/project validation runner.' },
  { path: 'scripts/check-freshness.ts', category: 'script', required: true, description: 'Freshness gate for generated artifacts.' },
  { path: 'scripts/gen-workflow-skills.ts', category: 'script', required: true, description: 'Workflow skill generator.' },
  { path: 'scripts/gen-workflow-docs.ts', category: 'script', required: true, description: 'Workflow governance-doc generator.' },
  { path: 'scripts/gen-registry.ts', category: 'script', required: true, description: 'Workflow skill registry generator.' },
  { path: 'scripts/workflow-runtime.ts', category: 'script', required: true, description: 'P10 runtime health, manifest, and host sync entrypoints.' },
  { path: WORKFLOW_PROTOCOL_RELATIVE_PATH, category: 'protocol', required: true, description: 'Authoritative workflow-system protocol, including §17 runtime contract.' },
  { path: WORKFLOW_SCHEMAS_RELATIVE_PATH, category: 'protocol', required: true, description: 'Schema contract for workflow docs and related artifacts.' },
  { path: 'package.json', category: 'config', required: true, description: 'Runtime dependency manifest and required workflow:* / gen:* / validate:* script contract.' },
  { path: WORKFLOW_PROFILE_RELATIVE_PATH, category: 'config', required: true, description: 'Project profile declaring hosts, paths, and validation matrix.' },
  { path: 'templates/skills/**', category: 'template', required: true, description: 'Workflow skill templates to be rendered in the target project.' },
  { path: 'templates/docs/**', category: 'template', required: true, description: 'Workflow governance-doc templates to be rendered in the target project.' },
  { path: 'docs/workflow/generated/workflow-skills/**', category: 'generated', required: false, description: 'Freshness-checked reference workflow skills rendered in the source workflow-system repo.' },
  { path: 'docs/workflow/generated/workflow-docs/**', category: 'generated', required: false, description: 'Freshness-checked reference governance docs rendered in the source workflow-system repo.' },
  { path: 'docs/workflow/SKILL_REGISTRY.md', category: 'generated', required: false, description: 'Freshness-checked reference registry rendered in the source workflow-system repo.' },
  { path: 'test/gen-workflow-skills.test.ts', category: 'test', required: false, description: 'Workflow skill generator tests.' },
  { path: 'test/gen-workflow-docs.test.ts', category: 'test', required: false, description: 'Workflow docs generator tests.' },
  { path: 'test/gen-registry.test.ts', category: 'test', required: false, description: 'Registry generator tests.' },
  { path: 'test/bootstrap-project-governance.test.ts', category: 'test', required: false, description: 'Bootstrap planning tests.' },
  { path: 'test/task-identity.test.ts', category: 'test', required: false, description: 'Task identity contract tests.' },
  { path: 'test/validation-model.test.ts', category: 'test', required: false, description: 'Validation model tests.' },
  { path: 'test/run-validation.test.ts', category: 'test', required: false, description: 'Validation runner and freshness tests.' },
  { path: 'test/workflow-runtime.test.ts', category: 'test', required: false, description: 'Runtime manifest, health, and sync tests.' },
];

const SOURCE_PIPELINE: WorkflowSourcePipeline = {
  normative_sources: {
    protocol: [WORKFLOW_PROTOCOL_RELATIVE_PATH],
    schemas: [WORKFLOW_SCHEMAS_RELATIVE_PATH],
  },
  template_roots: ['templates/skills', 'templates/docs'],
  generated_references: ['docs/workflow/generated/workflow-skills/**', 'docs/workflow/generated/workflow-docs/**', 'docs/workflow/SKILL_REGISTRY.md'],
  runtime_entry: 'scripts/workflow-runtime.ts',
  bundle_output_root: 'dist/workflow-system',
};

const POST_INSTALL_COMMANDS = [
  'Invoke /design-baseline-init -> /realign-workflow-assets -> /greenfield-init when a new project already contains workflow assets that need migration, or /legacy-inventory -> /adopt-existing-project for existing repos.',
  'From the workflow-system source repo: WORKFLOW_SYSTEM_ROOT=<target-repo> bun run gen:all',
  'From the workflow-system source repo: bun run workflow:sync --root <target-repo> --host <claude|codex|factory> --write',
  'From the workflow-system source repo: bun run workflow:health --root <target-repo>',
];

const VERIFICATION_COMMANDS = [
  'bun run validate:protocol',
  'bun run workflow:manifest --json',
  'bun run workflow:health --root <target-repo>',
  'bun run workflow:sync --root <target-repo> --host <claude|codex|factory> --write',
];

const REQUIRED_PACKAGE_SCRIPTS = [
  'gen:workflow-docs',
  'gen:workflow-skills',
  'gen:registry',
  'gen:all',
  'bootstrap:project-governance',
  'validate:protocol',
  'validate:all',
  'validate:freshness',
  'workflow:health',
  'workflow:manifest',
  'workflow:sync',
  'workflow:pack',
  'workflow:install',
] as const;

const EXACT_MATCH_PROFILE_PATHS = [] as const;
const SUPERSET_PROFILE_PATHS = [
  'paths.workflow_template_directories',
  'paths.generated_artifacts',
  'boundaries.workflow_owned_paths',
] as const;
const ADDITIVE_PROFILE_PATHS = ['project.primary_hosts', 'validation.matrix'] as const;
const REQUIRED_PROFILE_FIELDS = [
  'project.name',
  'project.slug',
  'project.type',
  'runtime.languages',
  'runtime.test_commands',
  'decision_types',
  'architecture_rules',
  'paths.source_directories',
  'boundaries.forbidden_paths',
  'paths.documentation_files',
  'paths.existing_skill_template_patterns',
  'paths.generated_artifacts',
  'boundaries.generated_only_paths',
  'boundaries.workflow_owned_paths',
  'governance.current_documents',
] as const;

function buildPackageJsonContract(packageJson: {
  type?: string;
  engines?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
}): ExportManifest['package_json_contract'] {
  if (packageJson.type !== 'module') {
    throw new Error('package.json is missing required workflow module contract: "type": "module"');
  }

  const scripts = Object.fromEntries(
    REQUIRED_PACKAGE_SCRIPTS.map(name => {
      const command = packageJson.scripts?.[name];
      if (typeof command !== 'string' || command.length === 0) {
        throw new Error(`package.json is missing required workflow script contract entry: ${name}`);
      }
      return [name, command];
    }),
  );

  const yamlDependency = packageJson.dependencies?.yaml;
  if (typeof yamlDependency !== 'string' || yamlDependency.length === 0) {
    throw new Error('package.json is missing required workflow runtime dependency: yaml');
  }

  const bunEngine = packageJson.engines?.bun;
  if (typeof bunEngine !== 'string' || bunEngine.length === 0) {
    throw new Error('package.json is missing required workflow engine contract: engines.bun');
  }

  return {
    type: packageJson.type,
    engines: {
      bun: bunEngine,
    },
    scripts,
    dependencies: {
      yaml: yamlDependency,
    },
  };
}

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
  if (!['health', 'manifest', 'sync', 'pack', 'install'].includes(command)) {
    throw new Error(`Unknown workflow-runtime command: ${command}`);
  }

  const flags = hasSubcommand ? argv.slice(1) : argv;
  const hostValue = getFlagValue(flags, '--host');
  if (hostValue && !isRuntimeHost(hostValue)) {
    throw new Error(`--host must be one of ${SUPPORTED_RUNTIME_HOSTS.join(', ')}. Got: ${hostValue}`);
  }

  const root = getFlagValue(flags, '--root');
  const bundle = getFlagValue(flags, '--bundle');
  const outDir = getFlagValue(flags, '--out-dir');

  for (const flag of flags) {
    if (
        flag === '--json' ||
        flag === '--write' ||
        flag === '--host' ||
        flag === '--root' ||
        flag === '--bundle' ||
        flag === '--dry-run' ||
        flag === '--repair-bootstrap-drift' ||
        flag === '--replace-managed-drift' ||
      flag === '--out-dir' ||
        flag === '--include-tests' ||
        flag.startsWith('--host=') ||
        flag.startsWith('--root=') ||
        flag.startsWith('--bundle=') ||
        flag.startsWith('--out-dir=')
    ) {
      continue;
    }
    if ((flag === hostValue || flag === root || flag === bundle || flag === outDir) && !flag.startsWith('--')) {
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
    bundle,
    dryRun: flags.includes('--dry-run'),
    outDir,
    includeTests: flags.includes('--include-tests'),
    repairBootstrapDrift: flags.includes('--repair-bootstrap-drift'),
    replaceManagedDrift: flags.includes('--replace-managed-drift'),
  };
}

function getRuntimeSkillRoot(root: string, host: RuntimeHost): string {
  return path.join(root, HOST_SKILL_DIRECTORIES[host]);
}

function getBootstrapInitSkillTemplatePath(root: string, skillName: (typeof BOOTSTRAP_INIT_SKILLS)[number]): string {
  return path.join(root, 'templates', 'skills', `${skillName}.SKILL.md.tmpl`);
}

function getBootstrapInitSkillTarget(root: string, host: RuntimeHost, skillName: (typeof BOOTSTRAP_INIT_SKILLS)[number]): string {
  return path.join(getRuntimeSkillRoot(root, host), `${WORKFLOW_RUNTIME_PREFIX}${skillName}`, 'SKILL.md');
}

function renderBootstrapInitSkillTemplate(content: string, profile: JsonObject): string {
  return String(renderWorkflowDocReferences(content, profile));
}

function getBootstrapHosts(profile?: JsonObject, explicitHost?: RuntimeHost): RuntimeHost[] {
  const hosts = new Set<RuntimeHost>(DEFAULT_BOOTSTRAP_HOSTS);
  if (profile) {
    for (const host of normalizeList(getRequiredPath(profile, 'project.primary_hosts'))) {
      if (isRuntimeHost(host)) {
        hosts.add(host);
      }
    }
  }
  if (explicitHost) {
    hosts.add(explicitHost);
  }
  return [...hosts];
}

function buildBootstrapInitSkillWrites(root: string, bundleDir: string, hosts: readonly RuntimeHost[], profile: JsonObject): PlannedWrite[] {
  return hosts.flatMap(host => BOOTSTRAP_INIT_SKILLS.map(skillName => {
    const targetPath = getBootstrapInitSkillTarget(root, host, skillName);
    const templatePath = getBootstrapInitSkillTemplatePath(bundleDir, skillName);
    return {
      path: targetPath,
      action: fs.existsSync(targetPath) ? 'overwrite' : 'create',
      mode: 'bootstrap-skill-install',
      content: renderBootstrapInitSkillTemplate(readText(templatePath), profile),
    };
  }));
}

function readWorkflowProfile(root: string): JsonObject {
  return loadProfile(getWorkflowProfilePath(root));
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
        'Workflow skills are copied into .codex/skills/workflow-system-<skill>/SKILL.md.',
        'The sync layer stays isolated by the workflow-system-* prefix inside the Codex runtime root.',
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

// --- Pack implementation ---

function expandGlobArtifacts(root: string, artifacts: readonly ExportArtifact[]): ExportArtifact[] {
  const expanded: ExportArtifact[] = [];
  for (const artifact of artifacts) {
    if (artifact.path.endsWith('/**')) {
      const baseDir = artifact.path.slice(0, -3);
      const fullDir = path.join(root, baseDir);
      if (!fs.existsSync(fullDir)) {
        throw new Error(`Artifact glob directory not found: ${fullDir}`);
      }
      const files = collectFilesRecursively(fullDir);
      for (const file of files) {
        const relativePath = path.relative(root, file).replace(/\\/g, '/');
        expanded.push({
          path: relativePath,
          category: artifact.category,
          required: artifact.required,
          description: artifact.description,
        });
      }
    } else {
      expanded.push({ ...artifact });
    }
  }
  return expanded;
}

function collectFilesRecursively(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function computeFileChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function computeContentChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Compute source_tree_hash per the plan's algorithm:
 * 1. Enumerate included source files from EXPORT_ARTIFACTS (filtered by --include-tests)
 * 2. Expand globs to concrete paths
 * 3. Normalize to forward-slash, sort lexicographically
 * 4. For each file: SHA-256(utf8(normalized_path) + 0x00 + raw_file_bytes)
 * 5. Concatenate all hex digests (already sorted by path order)
 * 6. SHA-256 of the concatenated string
 */
export function computeSourceTreeHash(root: string, includeTests: boolean): string {
  const included = EXPORT_ARTIFACTS.filter(a => {
    if (!includeTests && a.category === 'test') return false;
    // config category: only package.json is included; profile scaffold is bundled separately
    if (a.category === 'config' && a.path === WORKFLOW_PROFILE_RELATIVE_PATH) return false;
    return true;
  });

  const expanded = expandGlobArtifacts(root, included);

  // Normalize to forward-slash and sort
  const sortedPaths = expanded
    .map(a => a.path.replace(/\\/g, '/'))
    .sort();

  const perFileDigests: string[] = [];
  for (const normalizedPath of sortedPaths) {
    const fullPath = path.join(root, normalizedPath.replace(/\//g, path.sep));
    const rawBytes = fs.readFileSync(fullPath);
    const pathBytes = Buffer.from(normalizedPath, 'utf8');
    const separator = Buffer.from([0x00]);
    const combined = Buffer.concat([pathBytes, separator, rawBytes]);
    const digest = crypto.createHash('sha256').update(combined).digest('hex');
    perFileDigests.push(digest);
  }

  const concatenated = perFileDigests.join('');
  return crypto.createHash('sha256').update(concatenated, 'utf8').digest('hex');
}

function getSourceCommit(root: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function buildProfileScaffoldTemplate(): JsonObject {
  return {
    schema_version: 1,
    project: {
      type: 'application',
      summary: 'TODO: describe this project',
    },
    runtime: {
      languages: ['TypeScript'],
      package_manager: 'bun',
      module_system: 'esm',
      build_commands: [],
      test_commands: ['bun test'],
      dev_commands: [],
    },
    paths: {
      workflow_home: 'docs/workflow',
      source_directories: ['scripts'],
      documentation_files: ['README.md'],
      workflow_template_directories: ['templates/docs', 'templates/skills'],
      existing_skill_template_patterns: ['*/SKILL.md.tmpl', 'SKILL.md.tmpl'],
      generated_artifacts: [
        'docs/workflow/generated/workflow-docs/**',
        'docs/workflow/generated/workflow-skills/**',
        'docs/workflow/SKILL_REGISTRY.md',
      ],
    },
    boundaries: {
      forbidden_paths: ['.git/**', 'node_modules/**'],
      generated_only_paths: [
        'docs/workflow/generated/workflow-docs/**',
        'docs/workflow/generated/workflow-skills/**',
        'docs/workflow/SKILL_REGISTRY.md',
      ],
      workflow_owned_paths: [
        'AGENTS.md',
        'CLAUDE.md',
        '.workflow-system/**',
        'docs/workflow/**',
        'scripts/workflow-core.ts',
        'scripts/repo-path-patterns.ts',
        'scripts/workflow-doc-contracts.ts',
        'scripts/task-identity.ts',
        'scripts/bootstrap-project-governance.ts',
        'scripts/validation-model.ts',
        'scripts/run-validation.ts',
        'scripts/check-freshness.ts',
        'scripts/gen-workflow-skills.ts',
        'scripts/gen-workflow-docs.ts',
        'scripts/gen-registry.ts',
        'scripts/workflow-runtime.ts',
        'templates/docs/**',
        'templates/skills/**',
      ],
    },
    architecture_rules: [
      'Keep workflow automation and generators in scripts/.',
      'Treat templates/skills/ as workflow skill template sources, not runtime outputs.',
      'Do not hand-edit generated outputs.',
    ],
    decision_types: ['mechanical', 'taste', 'user_challenge'],
    governance: {
      current_documents: [
        WORKFLOW_PROFILE_RELATIVE_PATH,
        WORKFLOW_PROTOCOL_RELATIVE_PATH,
        WORKFLOW_SCHEMAS_RELATIVE_PATH,
        'AGENTS.md',
        'CLAUDE.md',
        'docs/workflow/SKILL_REGISTRY.md',
        'docs/workflow/DOCUMENT_CATALOG.md',
        'docs/workflow/BASELINES.md',
        'docs/workflow/CONTRACTS.md',
        'docs/workflow/CURRENT_TASK.md',
        'docs/workflow/DECISIONS.md',
        'docs/workflow/LESSONS.md',
        'docs/workflow/ROADMAP.md',
        'docs/workflow/STATUS.md',
        'docs/workflow/TASK_ARCHIVE.md',
        'docs/workflow/TASK_SUMMARY.md',
        'docs/workflow/WORKFLOW_GUIDE.md',
      ],
      planned_documents: [],
    },
    validation: {
      matrix_seed: [
        { name: 'workflow-skills-validation', layer: 'protocol', command: 'bun run gen:workflow-skills --dry-run', blocker_level: 'blocks-generator', description: 'Validate workflow skill templates.', phase: 'P9', owner: 'workflow-system' },
        { name: 'workflow-docs-validation', layer: 'protocol', command: 'bun run gen:workflow-docs --dry-run', blocker_level: 'blocks-generator', description: 'Validate generated governance doc structure.', phase: 'P9', owner: 'workflow-system' },
        { name: 'registry-validation', layer: 'protocol', command: 'bun run gen:registry --dry-run', blocker_level: 'blocks-generator', description: 'Validate registry generation.', phase: 'P9', owner: 'workflow-system' },
        { placeholder: true, name: 'unit', layer: 'project', command: '', blocker_level: 'blocks-merge', description: 'Bind target project unit-test command during A4.', phase: 'A4', owner: 'target-project' },
        { placeholder: true, name: 'integration', layer: 'project', command: '', blocker_level: 'blocks-merge', description: 'Bind target project integration-test command during A4.', phase: 'A4', owner: 'target-project' },
        { placeholder: true, name: 'e2e-smoke', layer: 'project', command: '', blocker_level: 'blocks-merge', description: 'Bind target project smoke validation during A4.', phase: 'A4', owner: 'target-project' },
        { placeholder: true, name: 'contract-compatibility', layer: 'project', command: '', blocker_level: 'blocks-merge', description: 'Bind target project contract checks during A4.', phase: 'A4', owner: 'target-project' },
      ],
    },
  };
}

export function packWorkflowBundle(options: PackOptions = {}): PackReport {
  const root = path.resolve(options.root ?? resolveRoot());
  const manifest = getExportManifest(root);
  const includeTests = options.includeTests ?? false;
  const dryRun = options.dryRun ?? false;

  // Compute source_tree_hash
  const sourceTreeHash = computeSourceTreeHash(root, includeTests);
  const sourceTreeHashShort = sourceTreeHash.slice(0, 12);
  const version = manifest.workflow_system_version;
  const bundleId = `workflow-system@${version}+${sourceTreeHashShort}`;
  const sourceCommit = getSourceCommit(root);

  // Determine output directory
  const outParent = options.outDir
    ? path.resolve(options.outDir)
    : path.join(root, 'dist', 'workflow-system');
  const bundleDirName = `workflow-system-${version}+${sourceTreeHashShort}`;
  const bundleDir = path.join(outParent, bundleDirName);

  // Filter artifacts to include in the bundle (exclude config; tests remain opt-in)
  const artifactsToInclude = EXPORT_ARTIFACTS.filter(a => {
    if (a.category === 'config') return false;
    if (a.category === 'test' && !includeTests) return false;
    return true;
  });

  // Expand globs for the actual file copy
  const expandedArtifacts = expandGlobArtifacts(root, artifactsToInclude);

  // Build artifact list with checksums
  const bundleArtifacts: BundleArtifact[] = expandedArtifacts.map(a => ({
    path: a.path.replace(/\\/g, '/'),
    category: a.category,
    required: a.required,
    checksum: computeFileChecksum(path.join(root, a.path.replace(/\//g, path.sep))),
  }));

  const createdAt = new Date().toISOString();

  const bundleJson: WorkflowBundle = {
    contract_version: 1,
    workflow_system_version: version,
    bundle_id: bundleId,
    source_commit: sourceCommit,
    source_tree_hash: sourceTreeHash,
    created_at: createdAt,
    artifacts: bundleArtifacts,
    source_pipeline: deepClone(manifest.source_pipeline),
    package_json_contract: manifest.package_json_contract,
    profile_scaffold_template: buildProfileScaffoldTemplate(),
    post_install: manifest.post_install,
    verification: manifest.verification,
    import_contract: manifest.import_contract,
    host_compatibility: manifest.host_compatibility,
    includes_optional_tests: includeTests,
  };

  if (!dryRun) {
    // Create bundle directory
    fs.mkdirSync(bundleDir, { recursive: true });

    // Copy artifact files
    for (const artifact of expandedArtifacts) {
      const sourcePath = path.join(root, artifact.path.replace(/\//g, path.sep));
      const targetPath = path.join(bundleDir, artifact.path.replace(/\//g, path.sep));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }

    // Write workflow-bundle.json
    fs.writeFileSync(
      path.join(bundleDir, 'workflow-bundle.json'),
      JSON.stringify(bundleJson, null, 2) + '\n',
      'utf8',
    );
  }

  return {
    report_version: 1,
    bundle_id: bundleId,
    workflow_system_version: version,
    source_commit: sourceCommit,
    source_tree_hash: sourceTreeHash,
    output_directory: bundleDir,
    artifact_count: bundleArtifacts.length,
    includes_optional_tests: includeTests,
    created_at: createdAt,
  };
}

export function formatPackReport(report: PackReport): string {
  return [
    `workflow:pack ${report.bundle_id}`,
    `version: ${report.workflow_system_version}`,
    `source_commit: ${report.source_commit}`,
    `source_tree_hash: ${report.source_tree_hash}`,
    `output: ${report.output_directory}`,
    `artifacts: ${report.artifact_count}`,
    `includes tests: ${report.includes_optional_tests}`,
  ].join('\n');
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function getRelativePath(root: string, fullPath: string): string {
  return normalizeRelativePath(path.relative(root, fullPath));
}

function isNonEmptyValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getDottedValue(obj: JsonObject, dottedPath: string): unknown {
  const parts = dottedPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setDottedValue(obj: JsonObject, dottedPath: string, value: unknown): void {
  const parts = dottedPath.split('.');
  let current: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value as JsonObject[keyof JsonObject];
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ensureObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function parseWorkflowBundle(bundleDir: string): WorkflowBundle {
  const manifestPath = path.join(bundleDir, 'workflow-bundle.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Bundle manifest not found: ${manifestPath}`);
  }
  return JSON.parse(readText(manifestPath)) as WorkflowBundle;
}

function verifyBundleIntegrity(bundleDir: string, bundle: WorkflowBundle): void {
  const expected = new Set(bundle.artifacts.map(artifact => normalizeRelativePath(artifact.path)));
  for (const artifact of bundle.artifacts) {
    const fullPath = path.join(bundleDir, artifact.path.replace(/\//g, path.sep));
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Bundle artifact missing: ${artifact.path}`);
    }
    const checksum = computeFileChecksum(fullPath);
    if (checksum !== artifact.checksum) {
      throw new Error(`Bundle artifact checksum mismatch: ${artifact.path}`);
    }
  }

  const actualFiles = collectFilesRecursively(bundleDir)
    .map(file => getRelativePath(bundleDir, file))
    .filter(file => file !== 'workflow-bundle.json');
  for (const file of actualFiles) {
    if (!expected.has(file)) {
      throw new Error(`Bundle contains unlisted artifact: ${file}`);
    }
  }
}

function readInstallState(root: string): InstallState | undefined {
  const installStatePath = path.join(root, '.workflow-system', 'install-state.json');
  if (!fs.existsSync(installStatePath)) {
    return undefined;
  }
  return JSON.parse(readText(installStatePath)) as InstallState;
}

function getManagedBundleArtifacts(bundle: WorkflowBundle): BundleArtifact[] {
  return bundle.artifacts.filter(
    artifact => artifact.category === 'script' || artifact.category === 'protocol' || artifact.category === 'template',
  );
}

function getDefaultHost(root: string, explicitHost?: RuntimeHost, profile?: JsonObject): RuntimeHost {
  const resolved = detectRuntimeHost(root, profile, explicitHost);
  if (resolved.host !== 'unknown') {
    return resolved.host;
  }
  return explicitHost ?? 'codex';
}

function parseVersion(version: string): [number, number, number] {
  const normalized = version.trim().replace(/^[^\d]*/, '');
  const [major = '0', minor = '0', patch = '0'] = normalized.split('.');
  return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0];
}

function compareVersions(left: string, right: string): number {
  const l = parseVersion(left);
  const r = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (l[index] < r[index]) return -1;
    if (l[index] > r[index]) return 1;
  }
  return 0;
}

function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed.startsWith('>=')) {
    return compareVersions(version, trimmed.slice(2)) >= 0;
  }
  if (trimmed.startsWith('^')) {
    const base = trimmed.slice(1);
    const [major, minor, patch] = parseVersion(base);
    if (compareVersions(version, base) < 0) {
      return false;
    }
    const [vMajor, vMinor, vPatch] = parseVersion(version);
    if (major > 0) {
      return vMajor === major;
    }
    if (minor > 0) {
      return vMajor === 0 && vMinor === minor && vPatch >= patch;
    }
    return vMajor === 0 && vMinor === 0 && vPatch >= patch;
  }
  return compareVersions(version, trimmed) === 0;
}

function rangesIntersect(left: string, right: string): boolean {
  return satisfiesRange(parseMinimumVersion(left), right) || satisfiesRange(parseMinimumVersion(right), left);
}

function parseMinimumVersion(range: string): string {
  const trimmed = range.trim();
  if (trimmed.startsWith('>=')) {
    return trimmed.slice(2);
  }
  if (trimmed.startsWith('^')) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function packageFragmentFromContract(contract: ExportManifest['package_json_contract']): JsonObject {
  return {
    scripts: deepClone(contract.scripts),
    dependencies: { yaml: contract.dependencies.yaml },
    engines: { bun: contract.engines.bun },
  };
}

function extractPackageJsonFragment(packageJson: JsonObject): JsonObject {
  const scriptsValue = ensureObject(packageJson.scripts ?? {}, 'package.json.scripts');
  const dependenciesValue = ensureObject(packageJson.dependencies ?? {}, 'package.json.dependencies');
  const enginesValue = ensureObject(packageJson.engines ?? {}, 'package.json.engines');
  const scripts: Record<string, string> = {};
  for (const name of REQUIRED_PACKAGE_SCRIPTS) {
    const value = scriptsValue[name];
    if (typeof value === 'string') {
      scripts[name] = value;
    }
  }
  const fragment: JsonObject = { scripts };
  if (typeof dependenciesValue.yaml === 'string') {
    fragment.dependencies = { yaml: dependenciesValue.yaml };
  }
  if (typeof enginesValue.bun === 'string') {
    fragment.engines = { bun: enginesValue.bun };
  }
  return fragment;
}

function deriveProjectSlug(root: string, packageJson?: JsonObject): string {
  const packageName = typeof packageJson?.name === 'string' && packageJson.name.trim().length > 0
    ? packageJson.name.trim()
    : path.basename(root);
  return packageName.toLowerCase().replace(/\s+/g, '-');
}

function buildScaffoldPackageJson(root: string, bundle: WorkflowBundle): JsonObject {
  const name = deriveProjectSlug(root);
  return {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: deepClone(bundle.package_json_contract.scripts),
    dependencies: { yaml: bundle.package_json_contract.dependencies.yaml },
    engines: { bun: bundle.package_json_contract.engines.bun },
  };
}

function renderProfileScaffold(root: string, bundle: WorkflowBundle, packageJson?: JsonObject): JsonObject {
  const template = deepClone(bundle.profile_scaffold_template);
  const project = ensureObject(template.project, 'profile_scaffold_template.project');
  project.name = deriveProjectSlug(root, packageJson);
  project.slug = deriveProjectSlug(root, packageJson);
  project.primary_hosts = [...DEFAULT_BOOTSTRAP_HOSTS];
  const validation = ensureObject(template.validation, 'profile_scaffold_template.validation');
  const matrixSeed = Array.isArray(validation.matrix_seed) ? validation.matrix_seed : [];
  validation.matrix = matrixSeed.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    const copy = { ...(entry as Record<string, unknown>) };
    delete copy.placeholder;
    return copy;
  }) as JsonObject[keyof JsonObject];
  delete validation.matrix_seed;
  return template;
}

function buildHostGuidanceContent(root: string, profile: JsonObject, fileName: 'AGENTS.md' | 'CLAUDE.md'): string {
  const projectName = String(getRequiredPath(profile, 'project.name') ?? deriveProjectSlug(root));
  return [
    `# ${projectName} workflow-system guidance`,
    '',
    '## workflow-system',
    '',
    '- This project uses workflow-system for AI delivery governance.',
    `- Read \`${WORKFLOW_PROFILE_RELATIVE_PATH}\`, \`${WORKFLOW_PROTOCOL_RELATIVE_PATH}\`, \`${WORKFLOW_SCHEMAS_RELATIVE_PATH}\`, and \`docs/workflow/WORKFLOW_GUIDE.md\` before changing workflow-managed docs.`,
    '- Bootstrap skills are preinstalled in both `.claude/skills/workflow-system-*` and `.codex/skills/workflow-system-*`.',
    '- New project: `/design-baseline-init` -> `/greenfield-init`, and insert `/realign-workflow-assets` first if the repo already contains old workflow assets.',
    '- Existing project: `/legacy-inventory` -> `/adopt-existing-project`.',
    '- After bootstrap or workflow template changes, run generation from the workflow-system source repo with `WORKFLOW_SYSTEM_ROOT=<target-repo>`, then run `workflow:sync --root <target-repo>` and `workflow:health --root <target-repo>`.',
    '- When project-wide AI collaboration rules, host instructions, or shared workflow commands change later, run `/sync-host-guidance` so `AGENTS.md` and `CLAUDE.md` stay aligned.',
    '',
    `This file was scaffolded during workflow-system install so ${fileName === 'AGENTS.md' ? 'Codex-compatible agents' : 'Claude'} can start from the same governance baseline.`,
    '',
  ].join('\n');
}

function buildBootstrapWorkflowGuideContent(root: string, profile: JsonObject): string {
  const projectName = String(getRequiredPath(profile, 'project.name') ?? deriveProjectSlug(root));
  return [
    '# WORKFLOW_GUIDE.md',
    '',
    `本文件是 ${projectName} 在 **workflow-system 刚安装完成、但尚未完成 bootstrap / gen / sync** 时的最小本地指引。`,
    '',
    '## 当前状态',
    '',
    '- workflow-system runtime、模板、协议文档和 5 个 bootstrap skills 已安装到当前项目。',
    '- 这一步还没有生成完整的 `docs/workflow/generated/**` 和全量宿主 skills。',
    '- 如果项目里已有 `AGENTS.md` / `CLAUDE.md`，install 也不会覆盖它们，所以这份 guide 是 install 后的保底入口。',
    '',
    '## 先做什么',
    '',
    '根据项目类型，在目标宿主里先调用 bootstrap skill 链：',
    '',
    '- 新项目：`/design-baseline-init` -> `/greenfield-init`',
    '- 如果新项目或已接管项目里还残留旧路径 workflow 资产：先执行 `/realign-workflow-assets`，再继续下一步',
    '- 老项目：`/legacy-inventory` -> `/adopt-existing-project`',
    '',
    '## 然后做什么',
    '',
    '完成 bootstrap / adoption 后，回到 workflow-system 源仓库执行，不要为了 workflow-system 迁移在目标项目里跑 `bun install`：',
    '',
    '```powershell',
    '$target = "<target-repo>"',
    '$env:WORKFLOW_SYSTEM_ROOT = $target',
    'bun run gen:all',
    '$env:WORKFLOW_SYSTEM_ROOT = $null',
    'bun run workflow:sync --root $target --host claude --write',
    'bun run workflow:sync --root $target --host codex --write',
    'bun run workflow:health --root $target',
    '```',
    '',
    '执行完这组命令后，项目里会出现完整的 `docs/workflow/` 生成产物和全量 workflow skills。',
    '',
    '## 已预装的 bootstrap skills',
    '',
    '- `.claude/skills/workflow-system-design-baseline-init/SKILL.md`',
    '- `.claude/skills/workflow-system-realign-workflow-assets/SKILL.md`',
    '- `.claude/skills/workflow-system-greenfield-init/SKILL.md`',
    '- `.claude/skills/workflow-system-legacy-inventory/SKILL.md`',
    '- `.claude/skills/workflow-system-adopt-existing-project/SKILL.md`',
    '- `.codex/skills/workflow-system-design-baseline-init/SKILL.md`',
    '- `.codex/skills/workflow-system-realign-workflow-assets/SKILL.md`',
    '- `.codex/skills/workflow-system-greenfield-init/SKILL.md`',
    '- `.codex/skills/workflow-system-legacy-inventory/SKILL.md`',
    '- `.codex/skills/workflow-system-adopt-existing-project/SKILL.md`',
    '',
    '## 后续维护',
    '',
    '- 项目级 AI 协作约束、统一命令入口或宿主说明变化后，执行 `/sync-host-guidance`。',
    '- 当 `docs/workflow/generated/**` 已生成后，以更完整的 workflow guide 和 skill registry 为准。',
    '',
  ].join('\n');
}

function buildBootstrapWorkflowGuideWrites(root: string, profile: JsonObject): PlannedWrite[] {
  const targetPath = path.join(root, 'docs', 'workflow', 'WORKFLOW_GUIDE.md');
  if (fs.existsSync(targetPath)) {
    return [];
  }

  return [{
    path: targetPath,
    action: 'scaffold',
    mode: 'scaffold-once',
    content: buildBootstrapWorkflowGuideContent(root, profile),
  }];
}

function buildHostGuidanceWrites(root: string, profile: JsonObject): PlannedWrite[] {
  return (['AGENTS.md', 'CLAUDE.md'] as const)
    .filter(fileName => !fs.existsSync(path.join(root, fileName)))
    .map(fileName => ({
      path: path.join(root, fileName),
      action: 'scaffold' as const,
      mode: 'scaffold-once',
      content: buildHostGuidanceContent(root, profile, fileName),
    }));
}

function extractProfileFragment(profile: JsonObject): JsonObject {
  const fragment: JsonObject = {};
  for (const dottedPath of [...EXACT_MATCH_PROFILE_PATHS, ...SUPERSET_PROFILE_PATHS, ...ADDITIVE_PROFILE_PATHS]) {
    const value = getDottedValue(profile, dottedPath);
    if (value !== undefined) {
      if (dottedPath === 'validation.matrix' && Array.isArray(value)) {
        setDottedValue(
          fragment,
          dottedPath,
          value.filter(entry =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            String((entry as Record<string, unknown>).owner ?? '') === 'workflow-system',
          ).map(entry => deepClone(entry as JsonObject)),
        );
      } else {
        setDottedValue(fragment, dottedPath, deepClone(value));
      }
    }
  }
  return fragment;
}

function normalizeInstalledProfileFragment(fragment: JsonObject): JsonObject {
  return extractProfileFragment(fragment);
}

function checkProfileCompleteness(profile: JsonObject): string[] {
  return REQUIRED_PROFILE_FIELDS.filter(field => !isNonEmptyValue(getDottedValue(profile, field)));
}

function mergeUniqueStringArray(current: unknown, required: unknown): string[] {
  const existing = Array.isArray(current) ? current.map(item => String(item)) : [];
  const needed = Array.isArray(required) ? required.map(item => String(item)) : [];
  return [...existing, ...needed.filter(item => !existing.includes(item))];
}

function mergeValidationMatrix(current: unknown, seeded: unknown): JsonObject[] {
  const existing = Array.isArray(current) ? current.map(item => ensureObject(item, 'validation.matrix entry')) : [];
  const incoming = Array.isArray(seeded) ? seeded.map(item => ensureObject(item, 'validation.matrix seed entry')) : [];
  const names = new Set(existing.map(item => String(item.name ?? '')));
  return [...existing, ...incoming.filter(item => !names.has(String(item.name ?? '')))];
}

function mergeProfileWithBundle(
  root: string,
  bundle: WorkflowBundle,
  existingProfile?: JsonObject,
): { profile: JsonObject; fragment: JsonObject; failures: PreflightFailure[] } {
  const failures: PreflightFailure[] = [];
  const template = renderProfileScaffold(root, bundle);
  if (!existingProfile) {
    const profile = deepClone(template);
    return { profile, fragment: extractProfileFragment(profile), failures };
  }

  const missingFields = checkProfileCompleteness(existingProfile);
  if (missingFields.length > 0) {
    return {
      profile: existingProfile,
      fragment: extractProfileFragment(existingProfile),
      failures: missingFields.map(field => ({
        category: 'incompatible_target',
        path: WORKFLOW_PROFILE_RELATIVE_PATH,
        message: `Missing required target profile field: ${field}`,
      })),
    };
  }

  const merged = deepClone(existingProfile);
  for (const dottedPath of EXACT_MATCH_PROFILE_PATHS) {
    const current = getDottedValue(merged, dottedPath);
    const required = getDottedValue(template, dottedPath);
    if (current === undefined) {
      setDottedValue(merged, dottedPath, deepClone(required));
      continue;
    }
    if (!deepEqual(current, required)) {
      failures.push({
        category: 'contract_conflict',
        path: WORKFLOW_PROFILE_RELATIVE_PATH,
        message: `Incompatible workflow-owned profile field: ${dottedPath}`,
      });
    }
  }
  for (const dottedPath of SUPERSET_PROFILE_PATHS) {
    setDottedValue(
      merged,
      dottedPath,
      mergeUniqueStringArray(getDottedValue(merged, dottedPath), getDottedValue(template, dottedPath)),
    );
  }
  setDottedValue(
    merged,
    'project.primary_hosts',
    mergeUniqueStringArray(getDottedValue(merged, 'project.primary_hosts'), DEFAULT_BOOTSTRAP_HOSTS),
  );
  setDottedValue(
    merged,
    'validation.matrix',
    mergeValidationMatrix(getDottedValue(merged, 'validation.matrix'), getDottedValue(template, 'validation.matrix')),
  );
  return { profile: merged, fragment: extractProfileFragment(merged), failures };
}

function readJsonObject(filePath: string): JsonObject {
  return ensureObject(JSON.parse(readText(filePath)) as unknown, filePath);
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readFreezeRegistry(root: string): string[] {
  const registryPath = path.join(root, 'FREEZE_REGISTRY.md');
  if (!fs.existsSync(registryPath)) {
    return [];
  }
  return readText(registryPath)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.replace(/^[-*]\s*/, '').replace(/^`|`$/g, ''))
    .map(normalizeRelativePath);
}

function getGovernanceForbiddenPatterns(profile?: JsonObject): string[] {
  const value = profile ? getDottedValue(profile, 'boundaries.forbidden_paths') : undefined;
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function pathIsFrozen(root: string, targetPath: string, profile?: JsonObject): boolean {
  const relative = getRelativePath(root, targetPath);
  for (const pattern of [...readFreezeRegistry(root), ...getGovernanceForbiddenPatterns(profile)]) {
    if (repoPatternMatchesPath(relative, pattern)) {
      return true;
    }
  }
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    const header = fs.readFileSync(targetPath, 'utf8').slice(0, 500);
    if (header.includes('@frozen') || header.includes('DO NOT MODIFY')) {
      return true;
    }
  }
  return false;
}

function buildPackageJsonPlan(
  root: string,
  bundle: WorkflowBundle,
  installState?: InstallState,
): { packageJson: JsonObject; fragment: JsonObject; failures: PreflightFailure[]; writeNeeded: boolean } {
  const packagePath = path.join(root, 'package.json');
  const failures: PreflightFailure[] = [];
  if (!fs.existsSync(packagePath)) {
    const packageJson = buildScaffoldPackageJson(root, bundle);
    return { packageJson, fragment: extractPackageJsonFragment(packageJson), failures, writeNeeded: true };
  }

  const packageJson = readJsonObject(packagePath);
  const currentScripts = ensureObject(packageJson.scripts ?? {}, 'package.json.scripts');
  const currentDependencies = ensureObject(packageJson.dependencies ?? {}, 'package.json.dependencies');
  const currentEngines = ensureObject(packageJson.engines ?? {}, 'package.json.engines');
  const contract = bundle.package_json_contract;

  if (installState) {
    const currentFragment = extractPackageJsonFragment(packageJson);
    if (!deepEqual(currentFragment, installState.package_json_fragment)) {
      failures.push({
        category: 'local_drift',
        path: 'package.json',
        message: 'Workflow-owned package.json fragment was modified locally since last install.',
      });
      return { packageJson, fragment: currentFragment, failures, writeNeeded: false };
    }
  } else {
    for (const [name, expected] of Object.entries(contract.scripts)) {
      const current = currentScripts[name];
      if (current !== undefined && current !== expected) {
        failures.push({
          category: 'contract_conflict',
          path: 'package.json',
          message: `Existing workflow script conflicts with bundle contract: scripts.${name}`,
        });
      }
    }
    if (typeof currentDependencies.yaml === 'string' && !rangesIntersect(currentDependencies.yaml, contract.dependencies.yaml)) {
      failures.push({
        category: 'contract_conflict',
        path: 'package.json',
        message: 'Existing dependencies.yaml does not intersect the bundle contract.',
      });
    }
    if (typeof currentEngines.bun === 'string' && !satisfiesRange(parseMinimumVersion(contract.engines.bun), currentEngines.bun)) {
      failures.push({
        category: 'contract_conflict',
        path: 'package.json',
        message: 'Existing engines.bun excludes the bundle minimum version.',
      });
    }
    if (failures.length > 0) {
      return { packageJson, fragment: extractPackageJsonFragment(packageJson), failures, writeNeeded: false };
    }
  }

  const merged = deepClone(packageJson);
  const mergedScripts = { ...(merged.scripts as Record<string, unknown> ?? {}) };
  for (const [name, expected] of Object.entries(contract.scripts)) {
    mergedScripts[name] =
      !installState && typeof currentScripts[name] === 'string'
        ? currentScripts[name]
        : expected;
  }
  merged.scripts = mergedScripts;

  const mergedDependencies = { ...(merged.dependencies as Record<string, unknown> ?? {}) };
  mergedDependencies.yaml =
    !installState && typeof currentDependencies.yaml === 'string' && rangesIntersect(currentDependencies.yaml, contract.dependencies.yaml)
      ? currentDependencies.yaml
      : contract.dependencies.yaml;
  merged.dependencies = mergedDependencies;

  const mergedEngines = { ...(merged.engines as Record<string, unknown> ?? {}) };
  mergedEngines.bun =
    !installState && typeof currentEngines.bun === 'string' && satisfiesRange(parseMinimumVersion(contract.engines.bun), currentEngines.bun)
      ? currentEngines.bun
      : contract.engines.bun;
  merged.engines = mergedEngines;
  const currentContent = JSON.stringify(packageJson, null, 2);
  const nextContent = JSON.stringify(merged, null, 2);
  return {
    packageJson: merged,
    fragment: extractPackageJsonFragment(merged),
    failures,
    writeNeeded: currentContent !== nextContent,
  };
}

function buildReplaceManagedPlan(
  root: string,
  bundleDir: string,
  bundle: WorkflowBundle,
  installState?: InstallState,
  options: { replaceManagedDrift?: boolean } = {},
): { plannedWrites: PlannedWrite[]; managedFiles: ManagedFileEntry[]; failures: PreflightFailure[] } {
  const failures: PreflightFailure[] = [];
  const plannedWrites: PlannedWrite[] = [];
  const managedFiles: ManagedFileEntry[] = [];
  const currentStateByPath = new Map((installState?.managed_files ?? []).map(entry => [normalizeRelativePath(entry.path), entry]));
  const bundleArtifacts = getManagedBundleArtifacts(bundle);
  const bundlePaths = new Set(bundleArtifacts.map(artifact => normalizeRelativePath(artifact.path)));

  for (const artifact of bundleArtifacts) {
    const relativePath = normalizeRelativePath(artifact.path);
    const targetPath = path.join(root, relativePath.replace(/\//g, path.sep));
    const stateEntry = currentStateByPath.get(relativePath);
    const currentExists = fs.existsSync(targetPath);
    const currentChecksum = currentExists ? computeFileChecksum(targetPath) : undefined;
    managedFiles.push({
      path: relativePath,
      mode: 'replace-managed',
      bundle_checksum: artifact.checksum,
      installed_checksum: artifact.checksum,
    });

    if (!installState) {
      if (!currentExists) {
        plannedWrites.push({ path: targetPath, action: 'create', mode: 'replace-managed' });
      } else if (currentChecksum !== artifact.checksum) {
        failures.push({
          category: 'contract_conflict',
          path: relativePath,
          message: 'Existing managed file differs from bundle content on first install.',
        });
      }
      continue;
    }

    if (currentExists && stateEntry && currentChecksum !== stateEntry.installed_checksum) {
      if (currentChecksum === artifact.checksum) {
        continue;
      }
      if (!options.replaceManagedDrift) {
        failures.push({
          category: 'local_drift',
          path: relativePath,
          message: 'Managed file was modified locally since last install. Re-run with --replace-managed-drift only after confirming workflow-system managed files may be replaced from the bundle.',
        });
        continue;
      }
      plannedWrites.push({
        path: targetPath,
        action: 'overwrite',
        mode: 'replace-managed',
      });
      continue;
    }

    if (!currentExists || !stateEntry || stateEntry.bundle_checksum !== artifact.checksum) {
      plannedWrites.push({
        path: targetPath,
        action: currentExists ? 'overwrite' : 'create',
        mode: 'replace-managed',
      });
    }
  }

  for (const prior of installState?.managed_files ?? []) {
    if (prior.mode !== 'replace-managed') {
      continue;
    }
    if (!bundlePaths.has(normalizeRelativePath(prior.path))) {
      const targetPath = path.join(root, prior.path.replace(/\//g, path.sep));
      if (fs.existsSync(targetPath) && computeFileChecksum(targetPath) !== prior.installed_checksum) {
        if (!options.replaceManagedDrift) {
          failures.push({
            category: 'local_drift',
            path: prior.path,
            message: 'Managed file slated for prune was modified locally since last install. Re-run with --replace-managed-drift only after confirming workflow-system managed files may be pruned.',
          });
          continue;
        }
      }
      plannedWrites.push({ path: targetPath, action: 'delete', mode: 'replace-managed' });
    }
  }

  return { plannedWrites, managedFiles, failures };
}

function buildBootstrapManagedPlan(
  root: string,
  bundleDir: string,
  hosts: readonly RuntimeHost[],
  profile: JsonObject,
  installState?: InstallState,
  options: { repairBootstrapDrift?: boolean } = {},
): { plannedWrites: PlannedWrite[]; managedFiles: ManagedFileEntry[]; failures: PreflightFailure[] } {
  const failures: PreflightFailure[] = [];
  const plannedWrites: PlannedWrite[] = [];
  const managedFiles: ManagedFileEntry[] = [];
  const currentStateByPath = new Map((installState?.managed_files ?? []).map(entry => [normalizeRelativePath(entry.path), entry]));
  const bootstrapWrites = buildBootstrapInitSkillWrites(root, bundleDir, hosts, profile);
  const bootstrapPaths = new Set<string>();

  for (const planned of bootstrapWrites) {
    const relativePath = getRelativePath(root, planned.path);
    const stateEntry = currentStateByPath.get(relativePath);
    const currentExists = fs.existsSync(planned.path);
    const currentChecksum = currentExists ? computeFileChecksum(planned.path) : undefined;
    const expectedChecksum = computeContentChecksum(planned.content ?? '');
    bootstrapPaths.add(relativePath);

    managedFiles.push({
      path: relativePath,
      mode: 'bootstrap-skill-install',
      bundle_checksum: expectedChecksum,
      installed_checksum: expectedChecksum,
    });

    if (!installState) {
      if (!currentExists) {
        plannedWrites.push(planned);
      } else if (currentChecksum !== expectedChecksum) {
        failures.push({
          category: 'contract_conflict',
          path: relativePath,
          message: 'Existing bootstrap skill differs from rendered workflow content on first install.',
        });
      }
      continue;
    }

    if (currentExists && stateEntry && currentChecksum !== stateEntry.installed_checksum) {
      if (currentChecksum === expectedChecksum) {
        continue;
      }
      if (!options.repairBootstrapDrift) {
        failures.push({
          category: 'local_drift',
          path: relativePath,
          message: 'Bootstrap skill was modified locally since last install. Re-run with --repair-bootstrap-drift to replace workflow-system bootstrap skills only.',
        });
        continue;
      }
      plannedWrites.push({
        ...planned,
        action: 'overwrite',
      });
      continue;
    }

    if (!currentExists || !stateEntry || stateEntry.bundle_checksum !== expectedChecksum) {
      plannedWrites.push({
        ...planned,
        action: currentExists ? 'overwrite' : 'create',
      });
    }
  }

  for (const prior of installState?.managed_files ?? []) {
    if (prior.mode !== 'bootstrap-skill-install' || bootstrapPaths.has(normalizeRelativePath(prior.path))) {
      continue;
    }
    const targetPath = path.join(root, prior.path.replace(/\//g, path.sep));
    if (fs.existsSync(targetPath) && computeFileChecksum(targetPath) !== prior.installed_checksum) {
      if (!options.repairBootstrapDrift) {
        failures.push({
          category: 'local_drift',
          path: prior.path,
          message: 'Bootstrap skill slated for prune was modified locally since last install. Re-run with --repair-bootstrap-drift to prune workflow-system bootstrap skills only.',
        });
        continue;
      }
    }
    plannedWrites.push({ path: targetPath, action: 'delete', mode: 'bootstrap-skill-install' });
  }

  return { plannedWrites, managedFiles, failures };
}

function writePlannedFiles(
  root: string,
  bundleDir: string,
  bundle: WorkflowBundle,
  plannedWrites: PlannedWrite[],
  packageJson?: JsonObject,
  profile?: JsonObject,
  versionContent?: string,
  installState?: InstallState,
): void {
  for (const planned of plannedWrites) {
    if (planned.action === 'delete') {
      if (fs.existsSync(planned.path)) {
        fs.rmSync(planned.path, { recursive: true, force: true });
      }
      continue;
    }

    if (planned.path === path.join(root, 'package.json') && packageJson) {
      writeTextFile(planned.path, `${JSON.stringify(packageJson, null, 2)}\n`);
      continue;
    }
    if (planned.path === getWorkflowProfilePath(root) && profile) {
      writeTextFile(planned.path, stringify(profile).trimEnd() + '\n');
      continue;
    }
    if (planned.path === path.join(root, 'VERSION') && typeof versionContent === 'string') {
      writeTextFile(planned.path, `${versionContent}\n`);
      continue;
    }
    if (planned.path === path.join(root, '.workflow-system', 'install-state.json') && installState) {
      writeTextFile(planned.path, `${JSON.stringify(installState, null, 2)}\n`);
      continue;
    }
    if (typeof planned.content === 'string') {
      writeTextFile(planned.path, planned.content);
      continue;
    }

    const relative = getRelativePath(root, planned.path);
    const sourcePath = path.join(bundleDir, relative.replace(/\//g, path.sep));
    writeTextFile(planned.path, fs.readFileSync(sourcePath, 'utf8'));
  }
}

export function installWorkflowBundle(options: InstallOptions): InstallReport {
  const root = path.resolve(options.root ?? process.cwd());
  const bundleDir = path.resolve(options.bundleDir);
  const bundle = parseWorkflowBundle(bundleDir);
  verifyBundleIntegrity(bundleDir, bundle);
  const existingInstallState = readInstallState(root);
  const existingProfile = fs.existsSync(getWorkflowProfilePath(root))
    ? loadProfile(getWorkflowProfilePath(root))
    : undefined;
  const failures: PreflightFailure[] = [];

  const replaceManagedPlan = buildReplaceManagedPlan(
    root,
    bundleDir,
    bundle,
    existingInstallState,
    { replaceManagedDrift: options.replaceManagedDrift },
  );
  failures.push(...replaceManagedPlan.failures);

  const packagePlan = buildPackageJsonPlan(root, bundle, existingInstallState);
  failures.push(...packagePlan.failures);

  if (existingInstallState) {
    if (!existingProfile) {
      failures.push({
        category: 'local_drift',
        path: WORKFLOW_PROFILE_RELATIVE_PATH,
        message: `Workflow-owned ${WORKFLOW_PROFILE_RELATIVE_PATH} fragment is missing since last install.`,
      });
    } else {
      const currentProfileFragment = extractProfileFragment(existingProfile);
      if (!deepEqual(currentProfileFragment, normalizeInstalledProfileFragment(existingInstallState.project_profile_fragment))) {
        failures.push({
          category: 'local_drift',
          path: WORKFLOW_PROFILE_RELATIVE_PATH,
          message: `Workflow-owned ${WORKFLOW_PROFILE_RELATIVE_PATH} fragment was modified locally since last install.`,
        });
      }
    }
  }

  const profilePlan = mergeProfileWithBundle(root, bundle, existingProfile);
  failures.push(...profilePlan.failures);
  if (profilePlan.failures.length === 0) {
    try {
      validateProfilePathSemantics(profilePlan.profile);
    } catch (error) {
      failures.push({
        category: 'incompatible_target',
        path: WORKFLOW_PROFILE_RELATIVE_PATH,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const bootstrapHosts = getBootstrapHosts(profilePlan.profile, options.host);
  const bootstrapPlan = buildBootstrapManagedPlan(
    root,
    bundleDir,
    bootstrapHosts,
    profilePlan.profile,
    existingInstallState,
    { repairBootstrapDrift: options.repairBootstrapDrift },
  );
  failures.push(...bootstrapPlan.failures);

  const versionPath = path.join(root, 'VERSION');
  const packageVersion = typeof packagePlan.packageJson.version === 'string' && packagePlan.packageJson.version.trim().length > 0
    ? packagePlan.packageJson.version.trim()
    : '0.0.0';
  const versionWriteNeeded = !fs.existsSync(versionPath);
  const versionContent = versionWriteNeeded ? packageVersion : undefined;

  const installedAt = new Date().toISOString();
  const nextInstallState: InstallState = {
    state_version: 1,
    bundle_id: bundle.bundle_id,
    workflow_system_version: bundle.workflow_system_version,
    installed_at: installedAt,
    managed_files: [...replaceManagedPlan.managedFiles, ...bootstrapPlan.managedFiles],
    package_json_fragment: packagePlan.fragment,
    project_profile_fragment: profilePlan.fragment,
    host_sync_state: {
      ...(existingInstallState?.host_sync_state ?? {}),
      ...Object.fromEntries(
        bootstrapHosts.map(host => [
          host,
          existingInstallState?.host_sync_state?.[host] ?? {
            namespace: 'workflow-system-*',
            synced_at: null,
            synced_entries: [],
          },
        ]),
      ),
    },
  };

  const plannedWrites: PlannedWrite[] = [...replaceManagedPlan.plannedWrites];
  if (packagePlan.writeNeeded) {
    plannedWrites.push({
      path: path.join(root, 'package.json'),
      action: fs.existsSync(path.join(root, 'package.json')) ? 'merge' : 'scaffold',
      mode: 'merge-managed',
    });
  }
  if (!existingProfile || !deepEqual(existingProfile, profilePlan.profile)) {
    plannedWrites.push({
      path: getWorkflowProfilePath(root),
      action: existingProfile ? 'merge' : 'scaffold',
      mode: 'merge-managed',
    });
  }
  if (versionWriteNeeded) {
    plannedWrites.push({ path: versionPath, action: 'scaffold', mode: 'scaffold-once' });
  }
  plannedWrites.push(...buildBootstrapWorkflowGuideWrites(root, profilePlan.profile));
  plannedWrites.push(...buildHostGuidanceWrites(root, profilePlan.profile));
  plannedWrites.push(...bootstrapPlan.plannedWrites);
  plannedWrites.push({
    path: path.join(root, '.workflow-system', 'install-state.json'),
    action: 'create',
    mode: 'install-infrastructure',
  });

  for (const planned of plannedWrites) {
    if (pathIsFrozen(root, planned.path, existingProfile ?? profilePlan.profile)) {
      failures.push({
        category: 'frozen_path',
        path: getRelativePath(root, planned.path),
        message: 'Planned write targets a frozen path.',
      });
    }
  }

  const success = failures.length === 0;
  const exit_code = success ? 0 : failures.some(failure => failure.category === 'contract_conflict' || failure.category === 'incompatible_target') ? 3 : 2;

  if (success && !options.dryRun) {
    writePlannedFiles(root, bundleDir, bundle, plannedWrites, packagePlan.packageJson, profilePlan.profile, versionContent, nextInstallState);
  }

  return {
    report_version: 1,
    bundle_id: bundle.bundle_id,
    workflow_system_version: bundle.workflow_system_version,
    dry_run: Boolean(options.dryRun),
    success,
    failures,
    planned_writes: plannedWrites.map(write => ({
      path: getRelativePath(root, write.path),
      action: write.action,
      mode: write.mode,
    })),
    exit_code,
  };
}

export function formatInstallReport(report: InstallReport): string {
  const lines = [
    `workflow:install ${report.success ? 'OK' : 'FAILED'}`,
    `bundle: ${report.bundle_id}`,
    `version: ${report.workflow_system_version}`,
    `dry-run: ${report.dry_run}`,
    `planned writes: ${report.planned_writes.length}`,
  ];
  for (const failure of report.failures) {
    lines.push(`- ${failure.category}: ${failure.path} (${failure.message})`);
  }
  return lines.join('\n');
}

function writeCliReport(reportText: string, options?: { json?: boolean; success?: boolean }): void {
  if (options?.json || options?.success !== false) {
    console.log(reportText);
    return;
  }
  console.error(reportText);
}

export function getExportManifest(root?: string): ExportManifest {
  const resolvedRoot = path.resolve(root ?? resolveRoot());
  const packageJson = JSON.parse(readText(path.join(resolvedRoot, 'package.json'))) as {
    version?: string;
    type?: string;
    engines?: Record<string, unknown>;
    scripts?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
  };
  const packageJsonContract = buildPackageJsonContract(packageJson);

  return {
    contract_version: 1,
    workflow_system_version: packageJson.version ?? '0.0.0',
    artifacts: [...EXPORT_ARTIFACTS],
    source_pipeline: deepClone(SOURCE_PIPELINE),
    package_json_contract: packageJsonContract,
    requirements: [
      'bun >= 1.0.0',
      'package.json with `"type": "module"`',
      'yaml dependency available to the imported workflow scripts',
    ],
    post_install: [...POST_INSTALL_COMMANDS],
    verification: [...VERIFICATION_COMMANDS],
    import_contract: {
      install: {
        adoption_stage: 'A1',
        steps: [
          {
            name: 'copy-artifacts',
            description: 'Import the required workflow-system scripts, templates, protocol docs, and profile scaffold.',
          },
          {
            name: 'package-json-integration',
            description: 'Merge the minimum package.json contract required for workflow:* / gen:* / validate:* scripts and runtime dependencies.',
          },
        ],
      },
      init: {
        adoption_stage: 'A2',
        steps: [
          {
            name: 'invoke-bootstrap-skill',
            description: 'Invoke the installed bootstrap skill entrypoint: design-baseline-init -> realign-workflow-assets -> greenfield-init when workflow assets need migration, or legacy-inventory -> adopt-existing-project for existing repos.',
          },
        ],
      },
      adopt: {
        adoption_stage: 'A3',
        steps: [
          {
            name: 'generate-outputs',
            description: 'After the init skill writes the project baseline, render the workflow skills, docs, and registry from the workflow-system source repo against the target root.',
            command: 'WORKFLOW_SYSTEM_ROOT=<target-repo> bun run gen:all',
          },
          {
            name: 'sync-host-runtime',
            description: 'Expand the target host namespace from the preinstalled bootstrap entrypoints into the full generated workflow skill set.',
            command: 'bun run workflow:sync --root <target-repo> --host <claude|codex|factory> --write',
          },
          {
            name: 'verify-health',
            description: 'Run workflow health checks from the workflow-system source repo against the target root after host sync.',
            command: 'bun run workflow:health --root <target-repo>',
          },
        ],
      },
    },
    host_compatibility: getHostCompatibilityNotes(),
  };
}

function collectGeneratedSkillFiles(root: string): string[] {
  const profile = fs.existsSync(getWorkflowProfilePath(root))
    ? readWorkflowProfile(root)
    : {};
  const skillDir = getWorkflowGeneratedDir(root, profile, 'workflow-skills');
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

function listOrphanRuntimeTargets(runtimeRoot: string, expectedTargets: Set<string>): string[] {
  if (!fs.existsSync(runtimeRoot)) {
    return [];
  }

  return fs.readdirSync(runtimeRoot)
    .map(entry => path.join(runtimeRoot, entry))
    .filter(fullPath => {
      if (!fs.statSync(fullPath).isDirectory()) {
        return false;
      }

      const name = path.basename(fullPath);
      if (!name.startsWith(WORKFLOW_RUNTIME_PREFIX)) {
        return false;
      }

      return !expectedTargets.has(path.join(fullPath, 'SKILL.md'));
    })
    .sort();
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

  const plannedPruneTargets = listOrphanRuntimeTargets(
    runtimeRoot,
    new Set(entries.map(entry => entry.target)),
  );

  return {
    host,
    runtime_root: runtimeRoot,
    isolated_prefix: WORKFLOW_RUNTIME_PREFIX,
    mode: 'copy',
    isolated,
    entries,
    planned_prune_targets: plannedPruneTargets,
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

  const appliedPruneTargets: string[] = [];
  if (options.write) {
    for (const pruneTarget of plan.planned_prune_targets) {
      fs.rmSync(pruneTarget, { recursive: true, force: true });
      appliedPruneTargets.push(pruneTarget);
    }
  }

  return {
    ...plan,
    write: Boolean(options.write),
    synced: operations.length,
    pruned: appliedPruneTargets.length,
    applied_prune_targets: appliedPruneTargets,
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
      message: `Loaded ${WORKFLOW_PROFILE_RELATIVE_PATH} for ${projectName} (${projectType}).`,
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
      message: `Skipped because ${WORKFLOW_PROFILE_RELATIVE_PATH} is invalid.`,
    });
    components.push({
      name: 'protocol',
      status: 'failed',
      message: `Skipped because ${WORKFLOW_PROFILE_RELATIVE_PATH} is invalid.`,
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
    `optional artifacts: ${manifest.artifacts.filter(artifact => !artifact.required).length}`,
    `reference outputs: ${manifest.source_pipeline.generated_references.join(', ')}`,
    `supported hosts: ${Object.keys(manifest.host_compatibility).join(', ')}`,
  ].join('\n');
}

export function formatHostSyncResult(result: HostSyncResult): string {
  const lines = [
    `workflow-runtime sync: ${result.write ? 'APPLIED' : 'PLANNED'}`,
    `host: ${result.host}`,
    `runtime_root: ${result.runtime_root}`,
    `skills: ${result.synced}`,
    `planned prune dirs: ${result.planned_prune_targets.length}`,
    `pruned: ${result.pruned}`,
  ];

  for (const entry of result.entries) {
    lines.push(`- ${entry.skill_name} -> ${entry.target}`);
  }

  for (const pruneTarget of result.planned_prune_targets) {
    lines.push(`- planned prune ${pruneTarget}`);
  }

  for (const pruneTarget of result.applied_prune_targets) {
    lines.push(`- applied prune ${pruneTarget}`);
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

  if (args.command === 'pack') {
    const report = packWorkflowBundle({
      root,
      outDir: args.outDir,
      includeTests: args.includeTests,
      dryRun: args.dryRun,
    });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatPackReport(report));
    return;
  }

  if (args.command === 'install') {
    if (!args.bundle) {
      throw new Error('workflow:install requires --bundle <dir>.');
    }
    const report = installWorkflowBundle({
      bundleDir: args.bundle,
      root: args.root ?? process.cwd(),
      host: args.host,
      dryRun: args.dryRun,
      repairBootstrapDrift: args.repairBootstrapDrift,
      replaceManagedDrift: args.replaceManagedDrift,
    });
    writeCliReport(args.json ? JSON.stringify(report, null, 2) : formatInstallReport(report), {
      json: args.json,
      success: report.success,
    });
    if (!report.success) {
      process.exit(report.exit_code);
    }
    return;
  }

  const profile = fs.existsSync(getWorkflowProfilePath(root))
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
