import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  evaluateValidationEvidence,
  type ExistingValidationEvidence,
  type ValidateChangeRequest,
} from '../scripts/vnext-validate-change';

const temporaryRoots: string[] = [];

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function treeDigest(root: string): string {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(path.relative(root, fullPath).replace(/\\/g, '/'));
    }
  };
  walk(root);
  const hash = createHash('sha256');
  for (const relativePath of files) {
    const content = fs.readFileSync(path.join(root, ...relativePath.split('/')));
    hash.update(relativePath);
    hash.update('\0');
    hash.update(content);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function virtualProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-vnext-validate-project-'));
  temporaryRoots.push(root);
  write(root, '.workflow-system/PROJECT_PROFILE.yaml', [
    'project:',
    '  name: Pure vNext Validation Fixture',
    '  slug: pure-vnext-validation-fixture',
    'paths:',
    '  workflow_home: docs/workflow',
    '',
  ].join('\n'));
  const runtimeState = {
    schema_version: 1,
    kind: 'vnext-current-task-runtime-state',
    task_id: '901',
    task_slug: 'pure-vnext-validation-fixture',
    workflow_status: 'active',
    lifecycle_state: 'active',
    resume_requires_review: false,
    resume_review_reasons: [],
    active_step_id: 'step-1',
    active_step_status: 'ready',
    finding_queue_revision: 0,
    review_cycle: {
      id: 'review-cycle-0',
      cycle_phase: 'discovery',
      repair_round: 0,
      counted_repair_wave_ids: [],
      active_repair_wave_id: null,
      verification_new_finding_wave_used: false,
      verification_new_finding_wave_id: null,
    },
    findings: [],
    execution_log: [],
    applied_proposals: [],
  };
  const currentTask = [
    '---',
    'schema_version: 1',
    'kind: vnext-current-task',
    'document_id: doc-000000000000000000000000',
    'runtime_state:',
    ...stringify(runtimeState).trimEnd().split(/\r?\n/).map(line => `  ${line}`),
    '---',
    '',
    '# vNext CURRENT_TASK',
    '',
    '## 任务信息',
    '',
    '- 任务 ID：901',
    '- 任务标题：Pure vNext Validation Fixture',
    '- 任务 slug：pure-vnext-validation-fixture',
    '- 当前状态：active',
    '- 生命周期状态：active',
    '- 恢复需审查：false',
    '- 恢复审查原因：',
    '',
    '## 背景与上下文',
    '',
    '- synthetic validation context',
    '',
    '## 验收标准',
    '',
    '- [ ] evidence policy remains read-only',
    '',
    '## 允许修改范围',
    '',
    '### Allowed Files',
    '',
    '- src/**',
    '',
    '### Conditional Files',
    '',
    '- none',
    '',
    '## 禁止修改范围',
    '',
    '### Forbidden Files',
    '',
    '- .git/**',
    '- docs/workflow/**',
    '',
    '## 受影响的契约',
    '',
    '- validation evidence contract',
    '',
    '## 已确认决策',
    '',
    '- validation is read-only',
    '',
    '## 待确认问题',
    '',
    '- none',
    '',
    '## 实现方案',
    '',
    '- synthetic fixture only',
    '',
    '## 审查问题队列',
    '',
    '- none',
    '',
    '## 实施步骤',
    '',
    '- step-1: validate evidence',
    '',
    '## 回归检查项',
    '',
    '- existing evidence',
    '',
    '## 回滚点',
    '',
    '- no mutation',
    '',
    '## 设计约束',
    '',
    '- no Runtime transaction',
    '',
    '## 发布后验证',
    '',
    '- not applicable',
    '',
    '## 执行记录',
    '',
    '- fixture baseline',
    '',
  ].join('\n');
  write(root, 'docs/workflow/CURRENT_TASK.md', currentTask);
  write(root, 'docs/workflow/STATUS.md', [
    '# STATUS.md',
    '',
    '## 项目概览',
    '',
    '- 项目：Pure vNext Validation Fixture',
    '',
    '## ✅ 已完成且稳定',
    '',
    '- [ ] baseline',
    '',
    '## 🔨 正在开发',
    '',
    '- [ ] validation fixture',
    '',
    '## 📋 待开发',
    '',
    '- none',
    '',
    '## ⚠️ 已知风险 / 观察点',
    '',
    '- none',
    '',
    '## ❌ 已移除 / 推迟',
    '',
    '- none',
    '',
    '## 🔜 下一检查点',
    '',
    '- evidence result',
    '',
    '## 最近更新记录',
    '',
    '- initial',
    '',
  ].join('\n'));
  write(root, 'docs/workflow/LESSONS.md', [
    '# LESSONS.md',
    '',
    '## 使用规则',
    '',
    '- reusable only',
    '',
    '## 通用',
    '',
    '- none',
    '',
  ].join('\n'));
  write(root, 'TASKS/inbox/.gitkeep', '');
  write(root, 'src/login.ts', 'export function login() { return true; }\n');
  return root;
}

function request(overrides: Partial<ValidateChangeRequest> = {}): ValidateChangeRequest {
  return {
    validation_target: {
      claim: 'the login boundary rejects invalid tokens',
      boundary: 'authentication behavior',
    },
    ...overrides,
  };
}

function evidence(value: ExistingValidationEvidence): ExistingValidationEvidence {
  return value;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('vNext validate-change expert evidence policy', () => {
  test('selects an existing regression as minimum-sufficient evidence without writes', () => {
    const root = virtualProject();
    write(root, 'tests/login-invalid-token.test.ts', 'existing regression fixture\n');
    const before = treeDigest(root);

    const result = evaluateValidationEvidence(request({
      requested_evidence: ['existing-regression'],
      existing_evidence: [evidence({
        kind: 'existing-regression',
        ref: 'tests/login-invalid-token.test.ts',
        status: 'passed',
        reason: 'Existing regression directly covers invalid-token rejection.',
      })],
    }));

    expect(result.validation_result.verdict).toBe('passed');
    expect(result.validation_result.selected_evidence).toEqual([{
      kind: 'existing-regression',
      reason: 'Existing regression directly covers invalid-token rejection.',
    }]);
    expect(result.validation_result.evidence_refs).toEqual(['tests/login-invalid-token.test.ts']);
    expect(result.validation_result.side_effects).toEqual({
      product_mutations: 0,
      governance_mutations: 0,
      runtime_transactions: 0,
    });
    expect(treeDigest(root)).toBe(before);
  });

  test('selects integration smoke for an integration behavior claim', () => {
    const root = virtualProject();
    const before = treeDigest(root);

    const result = evaluateValidationEvidence(request({
      validation_target: {
        claim: 'the session survives reconnect',
        boundary: 'session and transport integration',
      },
      requested_evidence: ['integration-smoke'],
      existing_evidence: [evidence({
        kind: 'integration-smoke',
        ref: 'evidence:session-reconnect-smoke',
        status: 'passed',
        reason: 'The claim crosses the session and transport boundary.',
      })],
    }));

    expect(result.validation_result.verdict).toBe('passed');
    expect(result.validation_result.selected_evidence[0]?.kind).toBe('integration-smoke');
    expect(treeDigest(root)).toBe(before);
  });

  test('truthfully blocks when required real-device evidence is unavailable', () => {
    const root = virtualProject();
    const before = treeDigest(root);

    const result = evaluateValidationEvidence(request({
      validation_target: {
        claim: 'the biometric login flow works on the supported phone',
        boundary: 'real-device authentication behavior',
      },
      requested_evidence: ['real-device-evidence'],
      environment_context: {
        available_evidence: [],
        unavailable_reasons: { 'real-device-evidence': 'real-device evidence unavailable' },
      },
    }));

    expect(result.validation_result.verdict).toBe('blocked');
    expect(result.validation_result.evidence_gaps).toContain('real-device evidence unavailable');
    expect(result.validation_result.selected_evidence).toEqual([]);
    expect(treeDigest(root)).toBe(before);
  });

  test('routes a persistent-test evidence gap without creating a persistent test', () => {
    const root = virtualProject();
    const before = treeDigest(root);

    const result = evaluateValidationEvidence(request({
      validation_target: {
        claim: 'reconnect preserves the authenticated session',
        boundary: 'session recovery regression boundary',
      },
      requested_evidence: ['focused-test'],
      existing_evidence: [evidence({
        kind: 'focused-test',
        ref: 'tests/session-reconnect.test.ts',
        status: 'not-run',
        sufficient: false,
        reason: 'No existing focused check proves the reconnect boundary.',
      })],
      caller_context: {
        persistent_test_required: true,
        persistent_test_reason: 'A durable regression is the minimum sufficient proof for this critical invariant.',
      },
    }));

    expect(result.validation_result.verdict).toBe('blocked');
    expect(result.validation_result.evidence_gaps).toContain('No existing focused check proves the reconnect boundary.');
    expect(result.validation_result.recommended_route).toMatchObject({ entry: 'execute-step' });
    expect(fs.existsSync(path.join(root, 'tests', 'session-reconnect.test.ts'))).toBe(false);
    expect(treeDigest(root)).toBe(before);
  });

  test('reports failed evidence without admitting a finding or mutating task state', () => {
    const root = virtualProject();
    const before = treeDigest(root);

    const result = evaluateValidationEvidence(request({
      requested_evidence: ['existing-regression'],
      existing_evidence: [evidence({
        kind: 'existing-regression',
        ref: 'tests/login-invalid-token.test.ts',
        status: 'failed',
        reason: 'The existing regression observed an accepted invalid token.',
      })],
    }));

    expect(result.validation_result.verdict).toBe('failed');
    expect(result.validation_result.recommended_route).toMatchObject({ entry: 'debug-task' });
    expect(result.validation_result.side_effects).toEqual({
      product_mutations: 0,
      governance_mutations: 0,
      runtime_transactions: 0,
    });
    expect(treeDigest(root)).toBe(before);
  });
});
