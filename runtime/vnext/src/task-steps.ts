/**
 * Canonical implementation-step parsing for the vNext task-state transaction.
 *
 * The task document remains the only source of step order and checkpoint
 * policy. This module only parses that existing Markdown section; it does not
 * create a second task-definition or execution state.
 */

const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type TaskStepCheckpointPolicy = 'required' | 'not-required';

export type TaskStepDefinition = {
  id: string;
  description: string;
  purpose: string | null;
  mutation_scope: string | null;
  required_evidence: string | null;
  review_checkpoint: TaskStepCheckpointPolicy | null;
  checkpoint_boundary: string | null;
  metadata_complete: boolean;
};

export type TaskStepResolution = {
  steps: TaskStepDefinition[];
  current: TaskStepDefinition;
  index: number;
  next: TaskStepDefinition | null;
};

export type TaskStepErrorCode = 'TASK_STEPS_INVALID' | 'TASK_STEP_NOT_FOUND';

export class TaskStepDefinitionError extends Error {
  readonly code: TaskStepErrorCode;

  constructor(code: TaskStepErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'TaskStepDefinitionError';
    this.code = code;
  }
}

type StepMetadataKey = 'purpose' | 'mutation_scope' | 'required_evidence' | 'review_checkpoint';

type ParsedStep = {
  id: string;
  description: string;
  metadata: Partial<Record<StepMetadataKey, string>>;
};

const HEADING_ALIASES = new Set(['实施步骤', 'implementation steps', 'implementation_steps', 'steps']);

const METADATA_ALIASES = new Map<string, StepMetadataKey>([
  ['purpose', 'purpose'],
  ['目标', 'purpose'],
  ['目的', 'purpose'],
  ['mutation scope', 'mutation_scope'],
  ['mutation_scope', 'mutation_scope'],
  ['mutation boundary', 'mutation_scope'],
  ['变更范围', 'mutation_scope'],
  ['修改范围', 'mutation_scope'],
  ['required evidence', 'required_evidence'],
  ['required_evidence', 'required_evidence'],
  ['必要证据', 'required_evidence'],
  ['必需证据', 'required_evidence'],
  ['review checkpoint', 'review_checkpoint'],
  ['review_checkpoint', 'review_checkpoint'],
  ['审查检查点', 'review_checkpoint'],
  ['评审检查点', 'review_checkpoint'],
]);

function normalizeLabel(value: string): string {
  return value
    .replace(/`/gu, '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\u00a0]/gu, ' ')
    .replace(/\s+/gu, ' ');
}

function headingInfo(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
  if (!match) return null;
  return { level: match[1].length, title: normalizeLabel(match[2]) };
}

function stepSectionLines(body: string): string[] {
  const lines = body.replace(/\r\n?/gu, '\n').split('\n');
  const start = lines.findIndex(line => {
    const heading = headingInfo(line);
    return heading?.level === 2 && HEADING_ALIASES.has(heading.title);
  });
  if (start < 0) throw new TaskStepDefinitionError('TASK_STEPS_INVALID', 'CURRENT_TASK is missing the implementation steps section.');

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = headingInfo(lines[index]);
    if (heading && heading.level <= 2) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function metadataKey(value: string): StepMetadataKey | null {
  const normalized = normalizeLabel(value);
  return METADATA_ALIASES.get(normalized)
    ?? METADATA_ALIASES.get(normalized.replace(/\s+/gu, '_'))
    ?? null;
}

function cleanMetadataValue(value: string): string {
  return value
    .trim()
    .replace(/^\s*[-–—:]\s*/u, '')
    .trim();
}

function parseCheckpoint(value: string): { policy: TaskStepCheckpointPolicy | null; boundary: string | null } {
  const normalized = cleanMetadataValue(value);
  if (/^(?:not[-\s]?required|optional|none|无需|不需要|非必需)(?=\s|[:：,，()（）[\]{}\-–—]|$)/iu.test(normalized)) {
    return { policy: 'not-required', boundary: null };
  }
  const required = /^(?:required|mandatory|必需|必须|需要)(?=\s|[:：,，()（）[\]{}\-–—]|$)/iu.exec(normalized);
  if (!required) return { policy: null, boundary: null };
  const boundary = normalized
    .slice(required[0].length)
    .replace(/^[\s:：,，()（）[\]{}\-–—]+/u, '')
    .replace(/[\s,，()（）[\]{}\-–—]+$/u, '')
    .trim();
  return { policy: 'required', boundary: boundary || null };
}

function stepLine(line: string): { indent: number; id: string; description: string } | null {
  const match = /^(\s*)[-*]\s+(?:\[[ xX]\]\s*)?(?:(?:步骤|step)\s+([0-9]+)|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))\s*[:：]\s*(.*?)\s*$/iu.exec(line);
  if (!match) return null;
  const candidate = match[2] ? `step-${match[2]}` : match[3];
  if (!candidate || !STEP_ID_PATTERN.test(candidate) || metadataKey(candidate) !== null) return null;
  return { indent: match[1].length, id: candidate, description: match[4].trim() };
}

function metadataLine(line: string): { key: StepMetadataKey; value: string } | null {
  const match = /^\s*(?:[-*]\s+)?(?:\[[ xX]\]\s*)?([^:：]+?)\s*[:：]\s*(.*?)\s*$/u.exec(line);
  if (!match) return null;
  const key = metadataKey(match[1]);
  return key ? { key, value: cleanMetadataValue(match[2]) } : null;
}

function parseRawSteps(lines: string[]): ParsedStep[] {
  const parsed: ParsedStep[] = [];
  let primaryIndent: number | null = null;
  let current: ParsedStep | null = null;

  for (const line of lines) {
    const candidate = stepLine(line);
    if (candidate && (primaryIndent === null || candidate.indent <= primaryIndent)) {
      if (primaryIndent === null) primaryIndent = candidate.indent;
      if (candidate.indent === primaryIndent) {
        if (parsed.some(step => step.id === candidate.id)) {
          throw new TaskStepDefinitionError('TASK_STEPS_INVALID', `implementation steps contain duplicate step ID ${candidate.id}.`);
        }
        current = { id: candidate.id, description: candidate.description, metadata: {} };
        parsed.push(current);
        continue;
      }
    }

    if (!current) continue;
    const metadata = metadataLine(line);
    if (!metadata) continue;
    if (current.metadata[metadata.key] !== undefined) {
      throw new TaskStepDefinitionError('TASK_STEPS_INVALID', `step ${current.id} declares ${metadata.key} more than once.`);
    }
    current.metadata[metadata.key] = metadata.value;
  }

  if (parsed.length === 0) {
    throw new TaskStepDefinitionError('TASK_STEPS_INVALID', 'implementation steps must contain at least one labelled step ID.');
  }
  return parsed;
}

function materializeStep(step: ParsedStep): TaskStepDefinition {
  const purpose = step.metadata.purpose || null;
  const mutationScope = step.metadata.mutation_scope || null;
  const requiredEvidence = step.metadata.required_evidence || null;
  const checkpoint = step.metadata.review_checkpoint === undefined
    ? { policy: null, boundary: null }
    : parseCheckpoint(step.metadata.review_checkpoint);
  const metadataComplete = Boolean(
    purpose
    && mutationScope
    && requiredEvidence
    && checkpoint.policy
    && (checkpoint.policy === 'not-required' || checkpoint.boundary),
  );
  return {
    id: step.id,
    description: step.description,
    purpose,
    mutation_scope: mutationScope,
    required_evidence: requiredEvidence,
    review_checkpoint: checkpoint.policy,
    checkpoint_boundary: checkpoint.boundary,
    metadata_complete: metadataComplete,
  };
}

export function parseImplementationSteps(implementationSteps: string): TaskStepDefinition[] {
  const lines = implementationSteps.replace(/\r\n?/gu, '\n').split('\n');
  return parseRawSteps(lines).map(materializeStep);
}

export function parseTaskStepDefinitions(body: string): TaskStepDefinition[] {
  return parseRawSteps(stepSectionLines(body)).map(materializeStep);
}

export function resolveTaskStep(body: string, activeStepId: string): TaskStepResolution {
  const steps = parseTaskStepDefinitions(body);
  const index = steps.findIndex(step => step.id === activeStepId);
  if (index < 0) {
    throw new TaskStepDefinitionError('TASK_STEP_NOT_FOUND', `active_step_id ${activeStepId} is not declared in implementation steps.`);
  }
  return {
    steps,
    current: steps[index],
    index,
    next: steps[index + 1] ?? null,
  };
}
