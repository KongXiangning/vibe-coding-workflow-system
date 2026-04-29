import * as fs from 'fs';
import * as path from 'path';
import {
  getWorkflowDocPath,
  getWorkflowGeneratedDir,
  getWorkflowProfilePath,
  loadProfile,
  type JsonObject,
} from './workflow-core';
import { validateWorkflowDocContract } from './workflow-doc-contracts';

export type PropagationGovernanceMode = 'protocol' | 'project';

const ALLOWED_BLOCKING_GAPS = new Set([
  'locked_hit_gap_unresolved',
  'registry_freshness_stale_locked_hit',
]);

const ALLOWED_RECONCILIATION = new Set([
  'aligned',
  'registry-only',
  'discovered-union',
]);

const ENTITY_CATEGORIES = ['storage', 'api', 'dto', 'event', 'projection', 'ui'] as const;
const API_DOWNSTREAM_SURFACES = ['hook', 'store', 'page', 'widget', 'form', 'table', 'detail view'] as const;

const OVER_LIMIT_BRANCH_ERROR_CODE: Record<string, string> = {
  hard_stop: 'IMPACT_HARD_STOP_REQUIRED',
  enforce_adapter_boundary: 'COMPAT_ADAPTER_BOUNDARY_MISSING',
  enforce_compat_layer: 'COMPAT_LAYER_REQUIRED_BUT_MISSING',
  recommend_task_split: 'IMPACT_TASK_SPLIT_IGNORED',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMaterialValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.includes('{{');
}

function splitInlineValues(value: string | null | undefined): string[] {
  if (!hasMaterialValue(value)) {
    return [];
  }
  return String(value)
    .split(/[,\uFF0C]/)
    .map(token => token.trim())
    .filter(Boolean);
}

function normalizeInlineSet(value: string | null | undefined): string[] {
  return splitInlineValues(value).sort();
}

function findLabelValue(content: string, label: string): string | null {
  const pattern = new RegExp(`^[ \\t]*-[ \\t]+${escapeRegExp(label)}：[ \\t]*(.*)$`, 'm');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function findIndentedBlock(content: string, label: string): string[] {
  const lines = content.split(/\r?\n/);
  const pattern = new RegExp(`^([ \\t]*)-[ \\t]+${escapeRegExp(label)}：[ \\t]*(.*)$`);
  const startIndex = lines.findIndex(line => pattern.test(line));
  if (startIndex === -1) {
    return [];
  }

  const match = lines[startIndex]?.match(pattern);
  const baseIndent = match?.[1].length ?? 0;
  const block: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      block.push(line);
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= baseIndent && /^(\s*)(-|#)/.test(line)) {
      break;
    }
    block.push(line);
  }

  return block;
}

function blockHasMaterializedChildren(content: string, label: string): boolean {
  return findIndentedBlock(content, label).some(line => {
    const match = line.match(/^\s*-\s+[^：]+：\s*(.*)$/);
    return hasMaterialValue(match?.[1] ?? '');
  });
}

function loadRootProfile(root: string): JsonObject {
  return loadProfile(getWorkflowProfilePath(root));
}

function resolveDocPath(root: string, profile: JsonObject, file: 'CURRENT_TASK.md' | 'CONTRACTS.md' | 'BASELINES.md', mode: PropagationGovernanceMode): string {
  const livePath = getWorkflowDocPath(root, profile, file);
  const generatedPath = path.join(getWorkflowGeneratedDir(root, profile, 'workflow-docs'), file);

  if (mode === 'protocol') {
    if (fs.existsSync(generatedPath)) {
      return generatedPath;
    }
    if (fs.existsSync(livePath)) {
      return livePath;
    }
  } else {
    if (fs.existsSync(livePath)) {
      return livePath;
    }
    if (fs.existsSync(generatedPath)) {
      return generatedPath;
    }
  }

  throw new Error(`Missing ${file}. Expected ${livePath} or ${generatedPath}.`);
}

function requireSnippets(content: string, file: string, snippets: readonly string[], issues: string[]): void {
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      issues.push(`${file} is missing required propagation-governance snippet "${snippet}".`);
    }
  }
}

function validateCurrentTask(content: string, issues: string[]): void {
  validateWorkflowDocContract('CURRENT_TASK.md', content);
  requireSnippets(content, 'CURRENT_TASK.md', [
    '- direct_consumers_semantics：',
    '- total_candidate_consumers_semantics：',
    '- effective_consumers：',
    '- reconciliation：',
    '- covered_categories：',
    '- gap_resolution：',
    '- stable_source_object：',
    '- successor_wrapper_or_compat_object：',
    '- API downstream validation：',
    '### conformance / verification cases',
  ], issues);

  const pendingStatus = findLabelValue(content, 'when_pending_prerequisites.assessment_status');
  const completedStatus = findLabelValue(content, 'when_completed.assessment_status');
  const blockingGaps = findLabelValue(content, 'when_pending_prerequisites.blocking_gaps');
  const eligibility = findLabelValue(content, 'when_completed.eligibility');

  if (pendingStatus === 'pending-prerequisites') {
    if (!hasMaterialValue(blockingGaps)) {
      issues.push('CURRENT_TASK.md must record non-empty blocking_gaps when assessment_status=pending-prerequisites.');
    }
    if (hasMaterialValue(eligibility)) {
      issues.push('CURRENT_TASK.md must not materialize when_completed.eligibility when assessment_status=pending-prerequisites.');
    }
  }

  if (completedStatus === 'completed') {
    if (!hasMaterialValue(eligibility)) {
      issues.push('CURRENT_TASK.md must record when_completed.eligibility when assessment_status=completed.');
    }
    if (hasMaterialValue(blockingGaps)) {
      issues.push('CURRENT_TASK.md must not keep pending blocking_gaps once assessment_status=completed.');
    }
  }

  for (const gap of splitInlineValues(blockingGaps)) {
    if (!ALLOWED_BLOCKING_GAPS.has(gap)) {
      issues.push(`CURRENT_TASK.md uses unsupported blocking gap "${gap}".`);
    }
  }

  const thresholdTrigger = findLabelValue(content, 'threshold_trigger');
  const directSemantics = findLabelValue(content, 'direct_consumers_semantics');
  const totalSemantics = findLabelValue(content, 'total_candidate_consumers_semantics');
  if (splitInlineValues(thresholdTrigger).includes('direct_consumers_exceeded') && !hasMaterialValue(directSemantics)) {
    issues.push('CURRENT_TASK.md must explain direct_consumers_exceeded semantics when that threshold trigger is materialized.');
  }
  if (splitInlineValues(thresholdTrigger).includes('total_consumers_exceeded') && !hasMaterialValue(totalSemantics)) {
    issues.push('CURRENT_TASK.md must explain total_consumers_exceeded semantics when that threshold trigger is materialized.');
  }

  const registryConsumers = normalizeInlineSet(findLabelValue(content, 'registry_consumers'));
  const discoveredConsumers = normalizeInlineSet(findLabelValue(content, 'discovered_consumers'));
  const effectiveConsumers = findLabelValue(content, 'effective_consumers');
  const reconciliation = findLabelValue(content, 'reconciliation');
  if (
    registryConsumers.length > 0 &&
    discoveredConsumers.length > 0 &&
    registryConsumers.join('|') !== discoveredConsumers.join('|') &&
    !hasMaterialValue(effectiveConsumers) &&
    reconciliation !== 'discovered-union'
  ) {
    issues.push('CURRENT_TASK.md must materialize effective_consumers or reconciliation=discovered-union when registry and discovery diverge.');
  }
  if (hasMaterialValue(reconciliation) && !ALLOWED_RECONCILIATION.has(String(reconciliation))) {
    issues.push(`CURRENT_TASK.md uses unsupported reconciliation "${reconciliation}".`);
  }

  const entityName = findLabelValue(content, 'entity_name');
  const coveredCategories = normalizeInlineSet(findLabelValue(content, 'covered_categories'));
  const unresolvedCategories = splitInlineValues(findLabelValue(content, 'unresolved_categories'));
  if (hasMaterialValue(entityName)) {
    for (const category of ENTITY_CATEGORIES) {
      if (!coveredCategories.includes(category)) {
        issues.push(`CURRENT_TASK.md must include entity category "${category}" inside covered_categories when EntityMutationChecklist is materialized.`);
      }
    }
  }
  if (unresolvedCategories.length > 0 && !blockHasMaterializedChildren(content, 'gap_resolution')) {
    issues.push('CURRENT_TASK.md must materialize gap_resolution when unresolved entity categories are present.');
  }

  const stableSource = findLabelValue(content, 'stable_source_object');
  const successorWrapper = findLabelValue(content, 'successor_wrapper_or_compat_object');
  const preservedEntrypoints = findLabelValue(content, 'preserved_direct_entrypoints');
  const wrapperRationale = findLabelValue(content, 'decision_rationale');
  if (hasMaterialValue(stableSource)) {
    if (!hasMaterialValue(successorWrapper) || !hasMaterialValue(preservedEntrypoints) || !hasMaterialValue(wrapperRationale)) {
      issues.push('CURRENT_TASK.md must fully materialize same-file wrapper / compat decisions once stable_source_object is set.');
    }
  }

  const objectKind = findLabelValue(content, 'common.object_kind');
  if (hasMaterialValue(objectKind) && String(objectKind).includes('api')) {
    const hasDownstreamCoverage = API_DOWNSTREAM_SURFACES.some(surface => hasMaterialValue(findLabelValue(content, surface)));
    if (!hasDownstreamCoverage) {
      issues.push('CURRENT_TASK.md must materialize API downstream validation surfaces when common.object_kind targets an API surface.');
    }
  }

  const selectedBranch = findLabelValue(content, 'selected_branch');
  const strategyBranch = findLabelValue(content, 'strategy_origin.over_limit_policy_branch');
  const errorCode = findLabelValue(content, 'error_code');
  if (hasMaterialValue(selectedBranch)) {
    if (selectedBranch === 'direct-change') {
      issues.push('CURRENT_TASK.md must not use direct-change inside over_limit_policy.selected_branch.');
    }
    if (hasMaterialValue(strategyBranch) && strategyBranch !== selectedBranch) {
      issues.push('CURRENT_TASK.md selected_branch and strategy_origin.over_limit_policy_branch must stay aligned when both are materialized.');
    }
    if (selectedBranch in OVER_LIMIT_BRANCH_ERROR_CODE) {
      const expected = OVER_LIMIT_BRANCH_ERROR_CODE[selectedBranch];
      if (!hasMaterialValue(errorCode)) {
        issues.push(`CURRENT_TASK.md must emit ${expected} when selected_branch=${selectedBranch}.`);
      } else if (errorCode !== expected) {
        issues.push(`CURRENT_TASK.md error_code must be ${expected} when selected_branch=${selectedBranch}; got ${errorCode}.`);
      }
    }
  }

  const severity = findLabelValue(content, 'severity');
  const blockerLevel = findLabelValue(content, 'default_blocker_level');
  if (severity === 'warning' && blockerLevel !== 'warning-only') {
    issues.push('CURRENT_TASK.md warning severity must map to default_blocker_level=warning-only.');
  }
  if (severity === 'error' && hasMaterialValue(blockerLevel) && blockerLevel !== 'blocks-merge') {
    issues.push('CURRENT_TASK.md error severity must map to default_blocker_level=blocks-merge unless intentionally escalated to critical.');
  }

  const hasMaterialDecision = [selectedBranch, errorCode, eligibility, pendingStatus, completedStatus].some(hasMaterialValue);
  if (hasMaterialDecision) {
    for (const label of ['输入场景', 'discovery evidence', '期望 `ContractCompatibilityResult`', '期望 gate / severity / `strategy_origin`']) {
      if (!hasMaterialValue(findLabelValue(content, label))) {
        issues.push(`CURRENT_TASK.md must materialize conformance field "${label}" once propagation decisions are materialized.`);
      }
    }
  }
}

function validateContracts(content: string, issues: string[]): void {
  validateWorkflowDocContract('CONTRACTS.md', content);
  requireSnippets(content, 'CONTRACTS.md', [
    '### compat path / wrapper rules',
    '### API change downstream validation',
    '- detail view：',
  ], issues);

  const stableSource = findLabelValue(content, 'stable source object');
  if (hasMaterialValue(stableSource)) {
    for (const label of ['same-file reuse pattern', 'successor wrapper / compat object', 'preserved direct entrypoints', 'decision rationale']) {
      if (!hasMaterialValue(findLabelValue(content, label))) {
        issues.push(`CONTRACTS.md must materialize "${label}" once compat path / wrapper rules are in use.`);
      }
    }
  }
}

function validateBaselines(content: string, issues: string[]): void {
  validateWorkflowDocContract('BASELINES.md', content);
  const strategyLineCount = (content.match(/- 相关 strategy_origin \/ branch 语义：/g) ?? []).length;
  if (strategyLineCount < 7) {
    issues.push('BASELINES.md must record strategy_origin / branch semantics for every GATE-001..GATE-007 baseline entry.');
  }
}

export function validatePropagationGovernanceDocs(root: string, mode: PropagationGovernanceMode = 'protocol'): void {
  const issues: string[] = [];
  const profile = loadRootProfile(root);
  const currentTask = fs.readFileSync(resolveDocPath(root, profile, 'CURRENT_TASK.md', mode), 'utf8');
  const contracts = fs.readFileSync(resolveDocPath(root, profile, 'CONTRACTS.md', mode), 'utf8');
  const baselines = fs.readFileSync(resolveDocPath(root, profile, 'BASELINES.md', mode), 'utf8');

  validateCurrentTask(currentTask, issues);
  validateContracts(contracts, issues);
  validateBaselines(baselines, issues);

  if (issues.length > 0) {
    throw new Error(issues.join('\n'));
  }
}
