import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadProfile } from '../scripts/workflow-core';
import {
  buildHostSyncPlan,
  buildWorkflowHealthReport,
  detectRuntimeHost,
  getExportManifest,
  installWorkflowBundle,
  packWorkflowBundle,
  parseRuntimeCliArgs,
  syncWorkflowHost,
} from '../scripts/workflow-runtime';

const ROOT = path.resolve(import.meta.dir, '..');

function withTempRoot(run: (root: string) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-runtime-'));
  try {
    run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeGeneratedSkill(root: string, name: string, content = '# Skill\n'): void {
  const skillDir = path.join(root, 'generated', 'workflow-skills');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, `${name}.SKILL.md`), content, 'utf8');
}

function writeProfile(root: string, primaryHost: string): void {
  fs.writeFileSync(
    path.join(root, 'PROJECT_PROFILE.yaml'),
    [
      'schema_version: 1',
      '',
      'project:',
      '  name: temp-project',
      '  type: sample',
      '  primary_hosts:',
      `    - ${primaryHost}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

function buildManifestPackageJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '1.0.0',
    type: 'module',
    engines: { bun: '>=1.0.0' },
    scripts: {
      'gen:workflow-docs': 'bun run scripts/gen-workflow-docs.ts',
      'gen:workflow-skills': 'bun run scripts/gen-workflow-skills.ts',
      'gen:registry': 'bun run scripts/gen-registry.ts',
      'gen:all': 'bun run gen:workflow-skills && bun run gen:workflow-docs && bun run gen:registry',
      'bootstrap:project-governance': 'bun run scripts/bootstrap-project-governance.ts --dry-run',
      'validate:protocol': 'bun run scripts/run-validation.ts --layer=protocol',
      'validate:all': 'bun run scripts/run-validation.ts',
      'validate:freshness': 'bun run scripts/check-freshness.ts',
      'workflow:health': 'bun run scripts/workflow-runtime.ts health',
      'workflow:manifest': 'bun run scripts/workflow-runtime.ts manifest',
      'workflow:sync': 'bun run scripts/workflow-runtime.ts sync',
      'workflow:pack': 'bun run scripts/workflow-runtime.ts pack',
      'workflow:install': 'bun run scripts/workflow-runtime.ts install',
    },
    dependencies: { yaml: '^2.8.3' },
    ...overrides,
  }, null, 2);
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function listRelativeFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, fullPath).replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return files.sort();
}

describe('workflow-runtime manifest', () => {
  test('export manifest includes runtime contract artifacts and host notes', () => {
    const manifest = getExportManifest(ROOT);
    expect(manifest.contract_version).toBe(1);
    expect(manifest.artifacts.some(artifact => artifact.path === 'scripts/workflow-runtime.ts' && artifact.required)).toBe(true);
    expect(manifest.artifacts.some(artifact => artifact.path === 'WORKFLOW_PROTOCOL.md' && artifact.category === 'protocol')).toBe(true);
    expect(manifest.artifacts.some(artifact => artifact.path === 'generated/workflow-docs/**' && artifact.category === 'generated')).toBe(true);
    expect(manifest.artifacts.some(artifact =>
      artifact.path === 'package.json' &&
      artifact.category === 'config' &&
      artifact.description.includes('workflow:* / gen:* / validate:* script contract'),
    )).toBe(true);
    expect(manifest.source_pipeline.normative_sources.protocol).toEqual(['WORKFLOW_PROTOCOL.md']);
    expect(manifest.source_pipeline.normative_sources.schemas).toEqual(['FILE_SCHEMAS.md']);
    expect(manifest.source_pipeline.generated_references).toContain('generated/workflow-docs/**');
    expect(manifest.source_pipeline.generated_references).toContain('generated/workflow-skills/**');
    expect(manifest.source_pipeline.bundle_output_root).toBe('dist/workflow-system');
    expect(manifest.package_json_contract.type).toBe('module');
    expect(manifest.package_json_contract.engines.bun).toBe('>=1.0.0');
    expect(manifest.package_json_contract.dependencies.yaml).toBe('^2.8.3');
    expect(manifest.package_json_contract.scripts['gen:all']).toBe('bun run gen:workflow-skills && bun run gen:workflow-docs && bun run gen:registry');
    expect(manifest.package_json_contract.scripts['workflow:health']).toBe('bun run scripts/workflow-runtime.ts health');
    expect(manifest.import_contract.install.adoption_stage).toBe('A1');
    expect(manifest.import_contract.install.steps.map(step => step.name)).toContain('package-json-integration');
    expect(manifest.import_contract.install.steps.map(step => step.name)).not.toContain('generate-outputs');
    expect(manifest.import_contract.install.steps.map(step => step.name)).not.toContain('sync-host-runtime');
    expect(manifest.import_contract.init.adoption_stage).toBe('A2');
    expect(manifest.import_contract.init.steps.map(step => step.name)).toContain('invoke-bootstrap-skill');
    expect(manifest.import_contract.adopt.adoption_stage).toBe('A3');
    expect(manifest.import_contract.adopt.steps.map(step => step.name)).toEqual([
      'generate-outputs',
      'sync-host-runtime',
      'verify-health',
    ]);
    expect(manifest.import_contract.adopt.steps.find(step => step.name === 'sync-host-runtime')?.command).toContain('--write');
    expect(manifest.host_compatibility.codex.runtime_root).toBe(path.join('.codex', 'skills'));
    expect(manifest.host_compatibility.codex.isolated_prefix).toBe('workflow-system-');
    expect(manifest.verification).toContain('bun run workflow:health');
    expect(manifest.verification).toContain('bun run workflow:sync --host <claude|codex|factory> --write');
  });

  test('export manifest fails when package.json type is not module', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({ type: 'commonjs' }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow module contract: "type": "module"',
      );
    });
  });

  test('export manifest fails when a required workflow script contract entry is missing', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({
          scripts: {
            'gen:workflow-docs': 'bun run scripts/gen-workflow-docs.ts',
            'gen:workflow-skills': 'bun run scripts/gen-workflow-skills.ts',
            'gen:registry': 'bun run scripts/gen-registry.ts',
            'bootstrap:project-governance': 'bun run scripts/bootstrap-project-governance.ts --dry-run',
            'validate:protocol': 'bun run scripts/run-validation.ts --layer=protocol',
            'validate:all': 'bun run scripts/run-validation.ts',
            'validate:freshness': 'bun run scripts/check-freshness.ts',
            'workflow:health': 'bun run scripts/workflow-runtime.ts health',
            'workflow:manifest': 'bun run scripts/workflow-runtime.ts manifest',
            'workflow:sync': 'bun run scripts/workflow-runtime.ts sync',
          },
        }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow script contract entry: gen:all',
      );
    });
  });

  test('export manifest fails when yaml runtime dependency is missing', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({ dependencies: {} }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow runtime dependency: yaml',
      );
    });
  });

  test('export manifest fails when bun engine contract is missing', () => {
    withTempRoot(root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        buildManifestPackageJson({ engines: {} }),
        'utf8',
      );

      expect(() => getExportManifest(root)).toThrow(
        'package.json is missing required workflow engine contract: engines.bun',
      );
    });
  });
});

describe('workflow protocol v26 propagation governance', () => {
  test('protocol defines runtime governance gates for mode, precedence, mutation scope, and propagation', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    expect(protocol).toContain('### 4b.1 Mode Selection Rules');
    expect(protocol).toContain('### 4b.2 Source of Truth Precedence');
    expect(protocol).toContain('### 4b.3 Mutation Scope Rules');
    expect(protocol).toContain('### 4b.4 Change Propagation Check');
    expect(protocol).toContain('CONTRACTS.md` — current stable interface');
    expect(protocol).toContain('Any file or contract surface not explicitly listed');
    expect(protocol).toContain('DECISIONS.md` records why a decision was made');
  });

  test('file schemas require task mutation scope buckets and constrain decisions authority', () => {
    const schemas = fs.readFileSync(path.join(ROOT, 'FILE_SCHEMAS.md'), 'utf8');
    expect(schemas).toContain('Allowed Files');
    expect(schemas).toContain('Forbidden Files');
    expect(schemas).toContain('Conditional Files');
    expect(schemas).toContain('## 设计约束');
    expect(schemas).toContain('Design mode');
    expect(schemas).toContain('Design source');
    expect(schemas).toContain('Design acceptance');
    expect(schemas).toContain('Design evidence');
    expect(schemas).toContain('Design open decisions');
    expect(schemas).toContain('DESIGN.md` 只能作为 optional source');
    expect(schemas).toContain('## 发布后验证');
    expect(schemas).toContain('Release mode');
    expect(schemas).toContain('Deploy source');
    expect(schemas).toContain('Target environment');
    expect(schemas).toContain('Health checks');
    expect(schemas).toContain('Canary window');
    expect(schemas).toContain('Performance baseline');
    expect(schemas).toContain('Rollback / recovery');
    expect(schemas).toContain('Release evidence');
    expect(schemas).toContain('未列入 `Allowed Files`');
    expect(schemas).toContain('`DECISIONS.md` 只记录原因、历史、替代方案和复议条件');
  });

  test('protocol enumerates the full v26 public interface surface', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    for (const name of [
      'EvidenceRecord',
      'UIAnchorReplacement',
      'ContractCompatibilityResult',
      'EvidenceAggregation',
      'ComplexityAssessment',
      'over_limit_policy',
      'evidence_diff_threshold',
      'MutationEligibilityAssessment',
      'EntityMutationChecklist',
      'LayoutContract',
      'RegistryFreshnessReport',
      'LinkedRegressionRecord',
      'BehaviorContract',
      'StagedMigrationPlan',
      'migration_plan_requirement',
      'implicit_shared_object_detection',
    ]) {
      expect(protocol).toContain(`- \`${name}\``);
    }
  });

  test('protocol documents the v26 public interfaces and conditional eligibility schema', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    expect(protocol).toContain('### §18.6 Propagation-governance public interfaces');
    expect(protocol).toContain('- `ContractCompatibilityResult`');
    expect(protocol).toContain('- `MutationEligibilityAssessment`');
    expect(protocol).toContain('when_pending_prerequisites:');
    expect(protocol).toContain('when_completed:');
    expect(protocol).toContain('locked_hit_gap_unresolved');
    expect(protocol).toContain('REGISTRY_FRESHNESS_STALE_LOCKED_HIT');
  });

  test('protocol pins the compatibility-result field contract and severity semantics', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    expect(protocol).toContain('contract_compatibility_result:');
    expect(protocol).toContain('default_blocker_level: <warning-only|blocks-merge|blocks-ship>');
    expect(protocol).toContain('over_limit_policy_branch: <recommend_task_split|enforce_compat_layer|enforce_adapter_boundary|hard_stop|none>');
    expect(protocol).toContain('divergence_state: <no_divergence|significant_divergence|locked_hit_gap>');
    expect(protocol).toContain('`warning` is allowed only for `warning-only`');
    expect(protocol).toContain('`error` is the default severity for `blocks-merge` blockers');
    expect(protocol).toContain('`none` is allowed only in `strategy_origin.over_limit_policy_branch`');
  });

  test('protocol covers over-limit branches and their blocker outputs', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    expect(protocol).toContain('over_limit_policy:');
    expect(protocol).toContain('`ComplexityAssessment` formalizes the strategy decision');
    expect(protocol).toContain('forced_strategy: <direct-change|recommend_task_split|enforce_compat_layer|enforce_adapter_boundary|hard_stop>');
    expect(protocol).toContain('`hard_stop` must emit `IMPACT_HARD_STOP_REQUIRED`');
    expect(protocol).toContain('`enforce_adapter_boundary` without boundary artifacts must emit `COMPAT_ADAPTER_BOUNDARY_MISSING`');
    expect(protocol).toContain('`enforce_compat_layer` without a compat-layer path must emit `COMPAT_LAYER_REQUIRED_BUT_MISSING`');
    expect(protocol).toContain('ignoring `recommend_task_split` while still widening scope must emit `IMPACT_TASK_SPLIT_IGNORED`');
  });

  test('protocol covers migration, layout, behavior, and linked-regression blocker branches', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    expect(protocol).toContain('layout break coverage must include sibling reflow, breakpoint drift, specificity override, and stacking-context break');
    expect(protocol).toContain('`MIGRATION_PLAN_REQUIRED_BUT_MISSING`');
    expect(protocol).toContain('`MIGRATION_RUNTIME_STATE_UNDECLARED`');
    expect(protocol).toContain('`MIGRATION_PLAN_INCOMPLETE`');
    expect(protocol).toContain('`LINKED_REGRESSION_EARLY_STOP`');
    expect(protocol).toContain('layout breaks must emit `LAYOUT_CONTRACT_BREAK`; behavior breaks must emit `BEHAVIOR_CONTRACT_BREAK`');
  });

  test('protocol documents v26 gate mapping and execution order rules', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    expect(protocol).toContain('#### §18.6.5 Error-code, gate, and execution-order rules');
    expect(protocol).toContain('IMPACT_HARD_STOP_REQUIRED');
    expect(protocol).toContain('MIGRATION_RUNTIME_STATE_UNDECLARED');
    expect(protocol).toContain('COMPAT_REMOVAL_PRECONDITION_UNMET');
    expect(protocol).toContain('1. establish the `change_start_set`');
    expect(protocol).toContain('all must be emitted; fix order follows blocker priority');
  });

  test('protocol formalizes the remaining v26 consumer, registry, and downstream validation rules', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    expect(protocol).toContain('`direct_consumers_exceeded` must enter `over_limit_policy`; its semantic meaning is "protect the existing direct entrypoints"');
    expect(protocol).toContain('`total_consumers_exceeded` must enter `over_limit_policy`; its semantic meaning is "control the total propagation surface"');
    expect(protocol).toContain('effective_consumers:');
    expect(protocol).toContain('reconciliation: <aligned|registry-only|discovered-union>');
    expect(protocol).toContain('the effective impact set must expand by discovered union');
    expect(protocol).toContain('covered_categories:');
    expect(protocol).toContain('gap_resolution:');
    expect(protocol).toContain('the protocol must preserve `A` and introduce an `A -> AA` wrapper / compat object');
    expect(protocol).toContain('backend API changes must extend downstream validation across frontend `hook`, `store`, `page`, `widget`, `form`, `table`, and `detail view` consumers');
  });

  test('protocol owns formal schema, default rules, and test requirements for public interfaces', () => {
    const protocol = fs.readFileSync(path.join(ROOT, 'WORKFLOW_PROTOCOL.md'), 'utf8');
    const schemas = fs.readFileSync(path.join(ROOT, 'FILE_SCHEMAS.md'), 'utf8');
    expect(protocol).toContain('every public interface listed in `§18.6` must carry three things in the normative source: a formal schema, default rules, and conformance-test requirements');
    expect(protocol).toContain('#### §18.6.6 Conformance test requirements');
    expect(protocol).toContain('Every propagation-governance conformance case must record:');
    expect(protocol).toContain('- `EntityMutationChecklist`: category coverage across storage / api / dto / event / projection / ui');
    expect(schemas).toContain('## 1.1 传播治理公开结构承载位置');
    expect(schemas).toContain('字段级 schema、枚举、gate、错误码、默认 blocker 规则和 conformance 测试要求均以 `WORKFLOW_PROTOCOL.md §18.6` 为唯一来源');
    expect(schemas).toContain('| `ContractCompatibilityResult` | `CURRENT_TASK.md > blockers / gate status` |');
    expect(schemas).toContain('| `implicit_shared_object_detection` | `CURRENT_TASK.md > eligibility / candidate / registry` 与 `CONTRACTS.md > candidate 回写记录` |');
  });
});

describe('workflow-runtime pack', () => {
  test('packWorkflowBundle changes bundle identity when --include-tests changes', () => {
    withTempRoot(bundleOutDir => {
      const withoutTests = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      const withTests = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir, includeTests: true });

      expect(withoutTests.bundle_id).not.toBe(withTests.bundle_id);

      const withoutTestsBundle = readJson(path.join(withoutTests.output_directory, 'workflow-bundle.json'));
      const withTestsBundle = readJson(path.join(withTests.output_directory, 'workflow-bundle.json'));
      expect(withoutTestsBundle.includes_optional_tests).toBe(false);
      expect(withTestsBundle.includes_optional_tests).toBe(true);
      expect((withoutTestsBundle.source_pipeline as Record<string, unknown>).bundle_output_root).toBe('dist/workflow-system');
      expect(
        (withoutTestsBundle.artifacts as Array<Record<string, unknown>>).some(artifact => String(artifact.path).startsWith('test/')),
      ).toBe(false);
      expect(
        (withTestsBundle.artifacts as Array<Record<string, unknown>>).some(artifact => String(artifact.path).startsWith('test/')),
      ).toBe(true);
      expect(
        (withoutTestsBundle.artifacts as Array<Record<string, unknown>>).some(artifact => String(artifact.path).startsWith('generated/workflow-docs/')),
      ).toBe(true);
      expect(
        (withoutTestsBundle.artifacts as Array<Record<string, unknown>>).some(artifact => String(artifact.path).startsWith('generated/workflow-skills/')),
      ).toBe(true);
      expect(
        (withoutTestsBundle.artifacts as Array<Record<string, unknown>>).some(artifact => String(artifact.path) === 'SKILL_REGISTRY.md'),
      ).toBe(true);
    });
  });

  test('workflow-bundle.json artifact list matches actual bundle contents', () => {
    withTempRoot(bundleOutDir => {
      const report = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir, includeTests: true });
      const bundle = readJson(path.join(report.output_directory, 'workflow-bundle.json'));
      const actualFiles = listRelativeFiles(report.output_directory).filter(file => file !== 'workflow-bundle.json');
      const manifestFiles = (bundle.artifacts as Array<Record<string, unknown>>).map(artifact => String(artifact.path)).sort();
      expect(actualFiles).toEqual(manifestFiles);
    });
  });
});

describe('workflow-runtime host detection', () => {
  test('directory marker wins over profile fallback, and explicit host wins over both', () => {
    withTempRoot(root => {
      writeProfile(root, 'claude');
      fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
      const profile = loadProfile(path.join(root, 'PROJECT_PROFILE.yaml'));

      expect(detectRuntimeHost(root, profile).host).toBe('codex');
      expect(detectRuntimeHost(root, profile, 'factory').host).toBe('factory');
    });
  });

  test('profile fallback works when no host directory is present', () => {
    withTempRoot(root => {
      writeProfile(root, 'codex');
      const profile = loadProfile(path.join(root, 'PROJECT_PROFILE.yaml'));
      const detected = detectRuntimeHost(root, profile);
      expect(detected.host).toBe('codex');
      expect(detected.source).toBe('profile');
    });
  });
});

describe('workflow-runtime sync', () => {
  test('host sync plan uses isolated workflow-system targets and reports orphaned workflow-system dirs only', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'archive-task');
      fs.mkdirSync(path.join(root, '.codex', 'skills', 'workflow-system-stale-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, '.codex', 'skills', 'workflow-system-stale-skill', 'SKILL.md'), '# stale\n', 'utf8');
      fs.mkdirSync(path.join(root, '.codex', 'skills', 'gstack-existing-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, '.codex', 'skills', 'gstack-existing-skill', 'SKILL.md'), '# native\n', 'utf8');
      const plan = buildHostSyncPlan(root, 'codex');
      expect(plan.isolated).toBe(true);
      expect(plan.entries).toHaveLength(1);
      expect(path.relative(root, plan.entries[0].target)).toBe(
        path.join('.codex', 'skills', 'workflow-system-archive-task', 'SKILL.md'),
      );
      expect(plan.planned_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.codex', 'skills', 'workflow-system-stale-skill'),
      ]);
    });
  });

  test('syncWorkflowHost copies generated skills into host namespace', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'archive-task', '# Archive Task\n');
      writeGeneratedSkill(root, 'review-diff', '# Review Diff\n');

      const result = syncWorkflowHost({ root, host: 'claude', write: true });
      expect(result.synced).toBe(2);
      expect(result.pruned).toBe(0);
      expect(result.planned_prune_targets).toEqual([]);
      expect(result.applied_prune_targets).toEqual([]);

      const archivePath = path.join(root, '.claude', 'skills', 'workflow-system-archive-task', 'SKILL.md');
      const reviewPath = path.join(root, '.claude', 'skills', 'workflow-system-review-diff', 'SKILL.md');
      expect(fs.readFileSync(archivePath, 'utf8')).toBe('# Archive Task\n');
      expect(fs.readFileSync(reviewPath, 'utf8')).toBe('# Review Diff\n');
    });
  });

  test('syncWorkflowHost prunes orphaned workflow-system dirs while preserving non-workflow namespaces', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'review-diff', '# Review Diff\n');
      fs.mkdirSync(path.join(root, '.codex', 'skills', 'workflow-system-archive-task'), { recursive: true });
      fs.writeFileSync(path.join(root, '.codex', 'skills', 'workflow-system-archive-task', 'SKILL.md'), '# stale\n', 'utf8');
      fs.mkdirSync(path.join(root, '.codex', 'skills', 'gstack-existing-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, '.codex', 'skills', 'gstack-existing-skill', 'SKILL.md'), '# native\n', 'utf8');

      const result = syncWorkflowHost({ root, host: 'codex', write: true });
      expect(result.synced).toBe(1);
      expect(result.pruned).toBe(1);
      expect(result.planned_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.codex', 'skills', 'workflow-system-archive-task'),
      ]);
      expect(result.applied_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.codex', 'skills', 'workflow-system-archive-task'),
      ]);
      expect(fs.existsSync(path.join(root, '.codex', 'skills', 'workflow-system-archive-task'))).toBe(false);
      expect(fs.existsSync(path.join(root, '.codex', 'skills', 'workflow-system-review-diff', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(root, '.codex', 'skills', 'gstack-existing-skill', 'SKILL.md'))).toBe(true);
    });
  });

  test('dry-run sync reports orphaned workflow-system dirs without deleting them', () => {
    withTempRoot(root => {
      writeGeneratedSkill(root, 'review-diff', '# Review Diff\n');
      fs.mkdirSync(path.join(root, '.factory', 'skills', 'workflow-system-archive-task'), { recursive: true });
      fs.writeFileSync(path.join(root, '.factory', 'skills', 'workflow-system-archive-task', 'SKILL.md'), '# stale\n', 'utf8');

      const result = syncWorkflowHost({ root, host: 'factory', write: false });
      expect(result.write).toBe(false);
      expect(result.pruned).toBe(0);
      expect(result.planned_prune_targets.map(target => path.relative(root, target))).toEqual([
        path.join('.factory', 'skills', 'workflow-system-archive-task'),
      ]);
      expect(result.applied_prune_targets).toEqual([]);
      expect(fs.existsSync(path.join(root, '.factory', 'skills', 'workflow-system-archive-task', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(root, '.factory', 'skills', 'workflow-system-review-diff', 'SKILL.md'))).toBe(false);
    });
  });
});

describe('workflow-runtime health', () => {
  test('health check passes for the current repository', () => {
    const report = buildWorkflowHealthReport({ root: ROOT });
    expect(report.ok).toBe(true);
    expect(report.components.find(component => component.name === 'profile')?.status).toBe('passed');
    expect(report.components.find(component => component.name === 'generators')?.status).toBe('passed');
    expect(report.components.find(component => component.name === 'protocol')?.status).toBe('passed');
  });

  test('health check fails cleanly when PROJECT_PROFILE.yaml is invalid', () => {
    withTempRoot(root => {
      fs.writeFileSync(path.join(root, 'PROJECT_PROFILE.yaml'), '[]\n', 'utf8');
      const report = buildWorkflowHealthReport({ root });
      expect(report.ok).toBe(false);
      expect(report.blocked_by).toContain('profile');
      expect(report.blocked_by).toContain('generators');
      expect(report.blocked_by).toContain('protocol');
    });
  });
});

describe('workflow-runtime install', () => {
  test('installWorkflowBundle installs the bundle into an empty target project', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        const report = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });

        expect(report.success).toBe(true);
        expect(report.exit_code).toBe(0);
        expect(fs.existsSync(path.join(targetRoot, 'package.json'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, 'PROJECT_PROFILE.yaml'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, 'VERSION'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, 'AGENTS.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, 'CLAUDE.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.workflow-system', 'install-state.json'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, 'scripts', 'workflow-runtime.ts'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.claude', 'skills', 'workflow-system-design-baseline-init', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.claude', 'skills', 'workflow-system-greenfield-init', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.claude', 'skills', 'workflow-system-legacy-inventory', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.claude', 'skills', 'workflow-system-adopt-existing-project', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.codex', 'skills', 'workflow-system-design-baseline-init', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.codex', 'skills', 'workflow-system-greenfield-init', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.codex', 'skills', 'workflow-system-legacy-inventory', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetRoot, '.codex', 'skills', 'workflow-system-adopt-existing-project', 'SKILL.md'))).toBe(true);
        const greenfieldInit = fs.readFileSync(path.join(targetRoot, '.codex', 'skills', 'workflow-system-greenfield-init', 'SKILL.md'), 'utf8');
        expect(greenfieldInit).toContain('AGENTS.md');
        expect(greenfieldInit).toContain('CLAUDE.md');
        expect(greenfieldInit).toContain('docs/workflow/CONTRACTS.md');
        expect(greenfieldInit).toContain('docs/workflow/STATUS.md');
        expect(greenfieldInit).toContain('docs/workflow/DECISIONS.md');
        expect(greenfieldInit).not.toContain('当前宿主对应文件');
        expect(greenfieldInit).not.toContain('`CONTRACTS.md`、`STATUS.md`、`DECISIONS.md`');

        const profile = loadProfile(path.join(targetRoot, 'PROJECT_PROFILE.yaml'));
        expect(profile.project?.primary_hosts).toEqual(['claude', 'codex']);

        const packageJson = readJson(path.join(targetRoot, 'package.json'));
        expect(packageJson.type).toBe('module');
        expect((packageJson.scripts as Record<string, unknown>)['workflow:install']).toBe('bun run scripts/workflow-runtime.ts install');
        expect((packageJson.scripts as Record<string, unknown>)['workflow:sync']).toBe('bun run scripts/workflow-runtime.ts sync');

        const installState = readJson(path.join(targetRoot, '.workflow-system', 'install-state.json'));
        expect(installState.bundle_id).toBe(packReport.bundle_id);
        expect(installState.managed_files).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: '.claude/skills/workflow-system-design-baseline-init/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
            expect.objectContaining({
              path: '.claude/skills/workflow-system-greenfield-init/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
            expect.objectContaining({
              path: '.claude/skills/workflow-system-legacy-inventory/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
            expect.objectContaining({
              path: '.claude/skills/workflow-system-adopt-existing-project/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
            expect.objectContaining({
              path: '.codex/skills/workflow-system-design-baseline-init/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
            expect.objectContaining({
              path: '.codex/skills/workflow-system-greenfield-init/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
            expect.objectContaining({
              path: '.codex/skills/workflow-system-legacy-inventory/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
            expect.objectContaining({
              path: '.codex/skills/workflow-system-adopt-existing-project/SKILL.md',
              mode: 'bootstrap-skill-install',
            }),
          ]),
        );
      });
    });
  });

  test('installWorkflowBundle preserves unrelated package.json fields while merging workflow fragment', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        fs.writeFileSync(
          path.join(targetRoot, 'package.json'),
          JSON.stringify({
            name: 'custom-target',
            version: '1.2.3',
            private: true,
            type: 'module',
            scripts: { lint: 'bun test' },
            dependencies: { yaml: '^2.8.0' },
            engines: { bun: '>=1.0.0' },
          }, null, 2),
          'utf8',
        );

        const report = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });

        expect(report.success).toBe(true);
        const packageJson = readJson(path.join(targetRoot, 'package.json'));
        expect((packageJson.scripts as Record<string, unknown>).lint).toBe('bun test');
        expect((packageJson.scripts as Record<string, unknown>)['workflow:health']).toBe('bun run scripts/workflow-runtime.ts health');
        expect((packageJson.scripts as Record<string, unknown>)['workflow:sync']).toBe('bun run scripts/workflow-runtime.ts sync');
        expect((packageJson.dependencies as Record<string, unknown>).yaml).toBe('^2.8.0');
        expect((packageJson.engines as Record<string, unknown>).bun).toBe('>=1.0.0');
      });
    });
  });

  test('installWorkflowBundle allows CommonJS targets without rewriting package type', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        fs.writeFileSync(
          path.join(targetRoot, 'package.json'),
          JSON.stringify({ name: 'cjs-target', version: '0.0.1', type: 'commonjs' }, null, 2),
          'utf8',
        );

        const report = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });

        expect(report.success).toBe(true);
        expect(report.exit_code).toBe(0);
        const packageJson = readJson(path.join(targetRoot, 'package.json'));
        expect(packageJson.type).toBe('commonjs');
        expect((packageJson.scripts as Record<string, unknown>)['workflow:health']).toBe('bun run scripts/workflow-runtime.ts health');
        expect((packageJson.dependencies as Record<string, unknown>).yaml).toBeDefined();
        expect(fs.existsSync(path.join(targetRoot, '.workflow-system', 'install-state.json'))).toBe(true);
      });
    });
  });

  test('installWorkflowBundle is safe to rerun on an unmodified target', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        const first = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });
        expect(first.success).toBe(true);

        const second = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
          dryRun: true,
        });
        expect(second.success).toBe(true);
        expect(second.failures).toEqual([]);
      });
    });
  });

  test('installWorkflowBundle reports local drift for modified replace-managed files', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        const first = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });
        expect(first.success).toBe(true);

        fs.appendFileSync(path.join(targetRoot, 'scripts', 'workflow-core.ts'), '\n// local drift\n', 'utf8');

        const second = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
          dryRun: true,
        });
        expect(second.success).toBe(false);
        expect(second.exit_code).toBe(2);
        expect(second.failures.some(failure => failure.category === 'local_drift')).toBe(true);
      });
    });
  });

  test('installWorkflowBundle reports local drift for modified bootstrap init skills', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        const first = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });
        expect(first.success).toBe(true);

        fs.appendFileSync(
          path.join(targetRoot, '.codex', 'skills', 'workflow-system-design-baseline-init', 'SKILL.md'),
          '\n<!-- local drift -->\n',
          'utf8',
        );

        const second = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
          dryRun: true,
        });
        expect(second.success).toBe(false);
        expect(second.exit_code).toBe(2);
        expect(
          second.failures.some(
            failure =>
              failure.category === 'local_drift' &&
              failure.path === '.codex/skills/workflow-system-design-baseline-init/SKILL.md',
          ),
        ).toBe(true);
      });
    });
  });

  test('installWorkflowBundle blocks frozen planned writes before install', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        fs.writeFileSync(path.join(targetRoot, 'FREEZE_REGISTRY.md'), '- scripts/workflow-core.ts\n', 'utf8');

        const report = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
          dryRun: true,
        });

        expect(report.success).toBe(false);
        expect(report.exit_code).toBe(2);
        expect(report.failures.some(failure => failure.category === 'frozen_path')).toBe(true);
      });
    });
  });

  test('installWorkflowBundle treats profile forbidden_paths as frozen governance rules', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        const first = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });
        expect(first.success).toBe(true);

        const profilePath = path.join(targetRoot, 'PROJECT_PROFILE.yaml');
        const profileText = fs.readFileSync(profilePath, 'utf8');
        fs.writeFileSync(
          profilePath,
          profileText.replace(
            '  forbidden_paths:\n    - .git/**\n    - node_modules/**',
            '  forbidden_paths:\n    - .git/**\n    - node_modules/**\n    - scripts/workflow-core.ts',
          ),
          'utf8',
        );
        fs.rmSync(path.join(targetRoot, 'scripts', 'workflow-core.ts'), { force: true });

        const second = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
          dryRun: true,
        });
        expect(second.success).toBe(false);
        expect(second.failures.some(failure => failure.category === 'frozen_path')).toBe(true);
      });
    });
  });

  test('installWorkflowBundle reports local drift for modified workflow-owned profile fragments', () => {
    withTempRoot(bundleOutDir => {
      const packReport = packWorkflowBundle({ root: ROOT, outDir: bundleOutDir });
      withTempRoot(targetRoot => {
        const first = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
        });
        expect(first.success).toBe(true);

        const profilePath = path.join(targetRoot, 'PROJECT_PROFILE.yaml');
        const profileText = fs.readFileSync(profilePath, 'utf8');
        fs.writeFileSync(
          profilePath,
          profileText.replace('  primary_hosts:\n    - claude\n    - codex', '  primary_hosts:\n    - claude\n    - codex\n    - factory'),
          'utf8',
        );

        const second = installWorkflowBundle({
          bundleDir: packReport.output_directory,
          root: targetRoot,
          dryRun: true,
        });
        expect(second.success).toBe(false);
        expect(second.failures.some(failure => failure.category === 'local_drift' && failure.path === 'PROJECT_PROFILE.yaml')).toBe(true);
      });
    });
  });
});

describe('workflow-runtime CLI routing', () => {
  test('parseRuntimeCliArgs accepts pack, install, sync commands', () => {
    const pack = parseRuntimeCliArgs(['pack', '--out-dir', '/tmp/bundle', '--include-tests']);
    expect(pack.command).toBe('pack');
    expect(pack.outDir).toBe('/tmp/bundle');
    expect(pack.includeTests).toBe(true);

    const install = parseRuntimeCliArgs(['install', '--bundle', '/tmp/bundle', '--root', '/tmp/target', '--host', 'claude', '--dry-run']);
    expect(install.command).toBe('install');
    expect(install.bundle).toBe('/tmp/bundle');
    expect(install.root).toBe('/tmp/target');
    expect(install.host).toBe('claude');
    expect(install.dryRun).toBe(true);

    const sync = parseRuntimeCliArgs(['sync', '--root', '/tmp/target', '--host', 'codex', '--write']);
    expect(sync.command).toBe('sync');
    expect(sync.root).toBe('/tmp/target');
    expect(sync.host).toBe('codex');
    expect(sync.write).toBe(true);
  });

  test('install command fails with actionable runtime errors when prerequisites are missing', () => {
    expect(() => {
      const child = Bun.spawnSync(['bun', 'run', 'scripts/workflow-runtime.ts', 'install'], { cwd: ROOT });
      if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    }).toThrow(/requires --bundle/);
  });
});
