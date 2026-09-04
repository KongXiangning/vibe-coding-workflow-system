/**
 * Release-time assembly for the publishable `vibe-governance` package.
 *
 * This is source/release engineering. Target projects receive the resulting
 * Node package and never need the source repository, Bun, gen, pack, or sync
 * commands to install the distribution.
 */

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildVNextBundle,
  validateVNextBundle,
  type VNextBundleManifest,
} from './vnext-migration-pack';
import {
  VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_FILE,
  VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_KIND,
  VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH,
  VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH,
  VIBE_GOVERNANCE_PACKAGE_NAME,
  VIBE_GOVERNANCE_PRODUCT,
  VIBE_GOVERNANCE_RUNTIME_DEPENDENCY_RELATIVE_PATH,
  type DistributionManifest,
} from './vibe-governance-distribution';
import { VNEXT_RUNTIME_NODE_MIN_VERSION } from './vnext-runtime';

type BuildDistributionOptions = {
  sourceRoot?: string;
  outputRoot?: string;
};

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, stableValue((value as Record<string, unknown>)[key])]));
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function copyFile(sourceRoot: string, targetRoot: string, relativePath: string): void {
  const source = path.join(sourceRoot, ...relativePath.split('/'));
  const target = path.join(targetRoot, ...relativePath.split('/'));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Distribution source file is missing: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(sourceRoot: string, targetRoot: string, relativePath: string): void {
  const source = path.join(sourceRoot, ...relativePath.split('/'));
  const target = path.join(targetRoot, ...relativePath.split('/'));
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`Distribution source directory is missing: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function bundleArtifactSpecs(): Array<{ source_path: string; target_path: string; category: 'protocol' | 'schema' | 'skill' | 'runtime' | 'config' | 'generated' }> {
  const skillEntries = ['bootstrap-project', 'prepare-task', 'review-change', 'execute-step', 'debug-task', 'task-lifecycle', 'capture-work-item', 'close-task', 'validate-change'];
  const runtimeSources = ['cli.ts', 'current-task.ts', 'task-state-transaction.ts', 'finding-queue-transaction.ts', 'kernel.ts', 'runtime-io.ts', 'task-identity.ts', 'bootstrap.ts', 'mutation-scope.ts', 'task-steps.ts'];
  return [
    { source_path: 'templates/vnext/bootstrap/WORKFLOW_PROTOCOL.md', target_path: '.workflow-system/WORKFLOW_PROTOCOL.md', category: 'protocol' },
    { source_path: 'templates/vnext/bootstrap/FILE_SCHEMAS.md', target_path: '.workflow-system/FILE_SCHEMAS.md', category: 'schema' },
    { source_path: 'templates/vnext/bootstrap/CURRENT_TASK.md', target_path: 'docs/workflow/CURRENT_TASK.md', category: 'generated' },
    { source_path: '.workflow-system/vnext/SOURCE_CONTRACT.yaml', target_path: '.workflow-system/vnext/SOURCE_CONTRACT.yaml', category: 'config' },
    { source_path: '.workflow-system/vnext/RUNTIME_CONTRACT.yaml', target_path: '.workflow-system/vnext/RUNTIME_CONTRACT.yaml', category: 'protocol' },
    { source_path: 'runtime/vnext/dist/cli.js', target_path: '.workflow-system/runtime/dist/cli.js', category: 'runtime' },
    { source_path: 'runtime/vnext/package.json', target_path: '.workflow-system/runtime/package.json', category: 'runtime' },
    { source_path: 'runtime/vnext/package-lock.json', target_path: '.workflow-system/runtime/package-lock.json', category: 'runtime' },
    ...runtimeSources.map(file => ({ source_path: `runtime/vnext/src/${file}`, target_path: `.workflow-system/runtime/src/${file}`, category: 'runtime' as const })),
    ...skillEntries.map(entry => ({ source_path: `templates/vnext/skills/${entry}.SKILL.md.tmpl`, target_path: `.agents/skills/${entry}/SKILL.md`, category: 'skill' as const })),
  ];
}

function copyMigrationSource(sourceRoot: string, targetRoot: string): void {
  const paths = [
    '.workflow-system/vnext/SOURCE_CONTRACT.yaml',
    '.workflow-system/vnext/RUNTIME_CONTRACT.yaml',
    'templates/vnext/bootstrap/WORKFLOW_PROTOCOL.md',
    'templates/vnext/bootstrap/FILE_SCHEMAS.md',
    'templates/vnext/bootstrap/CURRENT_TASK.md',
  ];
  for (const relativePath of paths) copyFile(sourceRoot, targetRoot, relativePath);
  copyDirectory(sourceRoot, targetRoot, 'templates/vnext/skills');
  // Legacy templates are migration input only. They are never listed as
  // target Distribution artifacts and never installed under the project.
  copyDirectory(sourceRoot, targetRoot, 'templates/skills');
  for (const relativePath of [
    'runtime/vnext/dist/cli.js',
    'runtime/vnext/package.json',
    'runtime/vnext/package-lock.json',
  ]) copyFile(sourceRoot, targetRoot, relativePath);
  copyDirectory(sourceRoot, targetRoot, 'runtime/vnext/src');
}

function buildManifest(bundle: VNextBundleManifest, sourceRoot: string): DistributionManifest {
  const artifacts = bundle.artifacts
    .filter(artifact => artifact.target_path !== 'docs/workflow/CURRENT_TASK.md')
    .map(artifact => ({
      source_path: `vnext-bundle/${artifact.source_path}`,
      target_path: artifact.target_path,
      category: artifact.category === 'generated' ? 'config' as const : artifact.category as 'protocol' | 'schema' | 'skill' | 'runtime' | 'config',
      required: artifact.required,
      checksum: artifact.checksum,
    }))
    .sort((left, right) => left.target_path.localeCompare(right.target_path));
  const base = {
    schema_version: 1 as const,
    kind: VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_KIND,
    product: VIBE_GOVERNANCE_PRODUCT,
    package_name: VIBE_GOVERNANCE_PACKAGE_NAME,
    distribution_version: JSON.parse(fs.readFileSync(path.join(sourceRoot, 'packages', 'vibe-governance', 'package.json'), 'utf8')).version as string,
    minimum_node: VNEXT_RUNTIME_NODE_MIN_VERSION,
    runtime_dependency_path: VIBE_GOVERNANCE_RUNTIME_DEPENDENCY_RELATIVE_PATH,
    artifact_source: 'embedded-release' as const,
    artifacts,
    state: {
      path: VIBE_GOVERNANCE_DISTRIBUTION_STATE_RELATIVE_PATH,
      in_progress_path: VIBE_GOVERNANCE_DISTRIBUTION_IN_PROGRESS_RELATIVE_PATH,
    },
    support: {
      bundle_path: 'vnext-bundle' as const,
      bundle_manifest_sha256: '',
      migration_source_path: 'migration-source' as const,
    },
    manifest_digest: '',
  };
  return base as DistributionManifest;
}

export function buildVibeGovernanceDistribution(options: BuildDistributionOptions = {}): { packageRoot: string; manifest: DistributionManifest; bundle: VNextBundleManifest } {
  const sourceRoot = path.resolve(options.sourceRoot ?? path.resolve(import.meta.dir, '..'));
  const packageRoot = path.resolve(options.outputRoot ?? path.join(sourceRoot, 'packages', 'vibe-governance'));
  if (packageRoot !== path.resolve(sourceRoot, 'packages', 'vibe-governance')) {
    const templateRoot = path.join(sourceRoot, 'packages', 'vibe-governance');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.copyFileSync(path.join(templateRoot, 'package.json'), path.join(packageRoot, 'package.json'));
    fs.copyFileSync(path.join(templateRoot, 'README.md'), path.join(packageRoot, 'README.md'));
  }
  const payloadRoot = path.join(packageRoot, 'payload');
  const migrationSourceRoot = path.join(payloadRoot, 'migration-source');
  const bundleRoot = path.join(payloadRoot, 'vnext-bundle');
  fs.rmSync(payloadRoot, { recursive: true, force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });
  copyMigrationSource(sourceRoot, migrationSourceRoot);

  const temporaryBundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-governance-release-bundle-'));
  let bundle: VNextBundleManifest;
  try {
    bundle = buildVNextBundle({ sourceRoot: migrationSourceRoot, bundleDir: temporaryBundleRoot, artifacts: bundleArtifactSpecs() });
    fs.cpSync(temporaryBundleRoot, bundleRoot, { recursive: true });
  } finally {
    fs.rmSync(temporaryBundleRoot, { recursive: true, force: true });
  }
  bundle = validateVNextBundle({ bundleDir: bundleRoot, sourceRoot: migrationSourceRoot, portable: true });
  const manifest = buildManifest(bundle, sourceRoot);
  const bundleManifestPath = path.join(bundleRoot, 'vnext-bundle.json');
  manifest.support.bundle_manifest_sha256 = sha256(fs.readFileSync(bundleManifestPath));
  manifest.manifest_digest = sha256(stableJson({ ...manifest, manifest_digest: '' }));
  fs.writeFileSync(path.join(payloadRoot, VIBE_GOVERNANCE_DISTRIBUTION_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
  const cliSource = path.join(sourceRoot, 'packages', 'vibe-governance', 'src', 'cli.ts');
  const cliOutput = path.join(packageRoot, 'dist', 'cli.js');
  execFileSync('bun', ['build', cliSource, '--target=node', '--outfile', cliOutput, '--external', 'yaml'], { cwd: sourceRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  return { packageRoot, manifest, bundle };
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const outputIndex = argv.indexOf('--out');
    const outputRoot = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
    if (outputIndex >= 0 && !outputRoot) throw new Error('--out requires a package output directory.');
    const result = buildVibeGovernanceDistribution({ outputRoot });
    console.log(JSON.stringify({ package_root: result.packageRoot, manifest_digest: result.manifest.manifest_digest, distribution_version: result.manifest.distribution_version, bundle_id: result.bundle.bundle_id }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
