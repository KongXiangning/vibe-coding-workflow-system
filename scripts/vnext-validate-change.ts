/**
 * Read-only vNext validation policy.
 *
 * This is deliberately a policy/evidence evaluator, not a test runner or a
 * Runtime operation. A host or harness supplies the result of an already
 * permitted check; this module chooses the minimum-sufficient evidence and
 * returns the ephemeral validation_result consumed by that caller. It has no
 * filesystem, process, or Runtime write path.
 */

export const VNEXT_VALIDATION_EVIDENCE_KINDS = [
  'static-proof',
  'existing-regression',
  'focused-test',
  'integration-smoke',
  'browser-session-check',
  'visual-evidence',
  'real-device-evidence',
  'external-documentation',
  'release-health',
] as const;
export type VNextValidationEvidenceKind = (typeof VNEXT_VALIDATION_EVIDENCE_KINDS)[number];

export const VNEXT_VALIDATION_VERDICTS = ['passed', 'failed', 'inconclusive', 'blocked'] as const;
export type VNextValidationVerdict = (typeof VNEXT_VALIDATION_VERDICTS)[number];

export type VNextValidationRoute = 'execute-step' | 'debug-task' | 'review-change' | null;
export type VNextValidationEvidenceStatus = 'passed' | 'failed' | 'unavailable' | 'not-run';

export type ValidationTarget = {
  claim: string;
  boundary: string;
};

export type ExistingValidationEvidence = {
  kind: VNextValidationEvidenceKind;
  ref: string;
  status: VNextValidationEvidenceStatus;
  sufficient?: boolean;
  reason?: string;
};

export type ValidationEnvironmentContext = {
  available_evidence?: readonly VNextValidationEvidenceKind[];
  unavailable_reasons?: Partial<Record<VNextValidationEvidenceKind, string>>;
};

export type ValidationCallerContext = {
  persistent_test_required?: boolean;
  persistent_test_reason?: string;
};

export type ValidateChangeRequest = {
  validation_target: ValidationTarget;
  changed_paths?: readonly string[];
  diff_target?: string;
  expected_behavior?: string;
  existing_evidence?: readonly ExistingValidationEvidence[];
  requested_evidence?: readonly VNextValidationEvidenceKind[];
  environment_context?: ValidationEnvironmentContext;
  caller_context?: ValidationCallerContext;
};

export type ValidationResultPayload = {
  target: ValidationTarget;
  verdict: VNextValidationVerdict;
  selected_evidence: Array<{
    kind: VNextValidationEvidenceKind;
    reason: string;
  }>;
  observations: string[];
  evidence_refs: string[];
  evidence_gaps: string[];
  side_effects: {
    product_mutations: 0;
    governance_mutations: 0;
    runtime_transactions: 0;
  };
  recommended_route: {
    entry: VNextValidationRoute;
    reason: string;
  };
};

export type ValidationResult = {
  validation_result: ValidationResultPayload;
};

const EVIDENCE_KIND_SET = new Set<string>(VNEXT_VALIDATION_EVIDENCE_KINDS);
const EVIDENCE_STATUS_SET = new Set<string>(['passed', 'failed', 'unavailable', 'not-run']);
const EVIDENCE_SELECTION_ORDER: readonly VNextValidationEvidenceKind[] = VNEXT_VALIDATION_EVIDENCE_KINDS;

const READ_ONLY_SIDE_EFFECTS = {
  product_mutations: 0,
  governance_mutations: 0,
  runtime_transactions: 0,
} as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function blockedResult(
  target: ValidationTarget,
  evidenceGaps: string[],
  reason: string,
  route: VNextValidationRoute = null,
): ValidationResult {
  return {
    validation_result: {
      target,
      verdict: 'blocked',
      selected_evidence: [],
      observations: [],
      evidence_refs: [],
      evidence_gaps: evidenceGaps,
      side_effects: READ_ONLY_SIDE_EFFECTS,
      recommended_route: { entry: route, reason },
    },
  };
}

function validateRequestShape(request: ValidateChangeRequest): string[] {
  const issues: string[] = [];
  const rawTarget = (request as unknown as { validation_target?: unknown } | null | undefined)?.validation_target;
  if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
    return ['validation_target is missing or malformed'];
  }
  const target = rawTarget as Record<string, unknown>;
  if (!isNonEmptyString(target.claim)) issues.push('validation_target.claim is missing');
  if (!isNonEmptyString(target.boundary)) issues.push('validation_target.boundary is missing');

  const requested = request.requested_evidence ?? [];
  if (unique(requested).length !== requested.length) issues.push('requested_evidence contains duplicates');
  for (const kind of requested) {
    if (!EVIDENCE_KIND_SET.has(kind)) issues.push(`unsupported evidence kind: ${String(kind)}`);
  }

  for (const [index, evidence] of (request.existing_evidence ?? []).entries()) {
    if (!evidence || !EVIDENCE_KIND_SET.has(evidence.kind)) issues.push(`existing_evidence[${index}].kind is unsupported`);
    if (!evidence || !isNonEmptyString(evidence.ref)) issues.push(`existing_evidence[${index}].ref is missing`);
    if (!evidence || !EVIDENCE_STATUS_SET.has(evidence.status)) issues.push(`existing_evidence[${index}].status is unsupported`);
  }
  return issues;
}

function targetFromRequest(request: ValidateChangeRequest | null | undefined): ValidationTarget {
  const raw = (request as unknown as { validation_target?: unknown } | null | undefined)?.validation_target;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { claim: '<invalid claim>', boundary: '<invalid boundary>' };
  }
  const target = raw as Record<string, unknown>;
  return {
    claim: isNonEmptyString(target.claim) ? target.claim.trim() : '<invalid claim>',
    boundary: isNonEmptyString(target.boundary) ? target.boundary.trim() : '<invalid boundary>',
  };
}

function gapForUnavailableEvidence(
  kind: VNextValidationEvidenceKind,
  environment: ValidationEnvironmentContext | undefined,
  candidate?: ExistingValidationEvidence,
): string {
  return candidate?.reason?.trim()
    || environment?.unavailable_reasons?.[kind]?.trim()
    || (environment?.available_evidence?.includes(kind)
      ? `${kind} evidence was not supplied or did not produce a result`
      : `${kind} evidence is unavailable`);
}

function candidateOrder(
  requested: readonly VNextValidationEvidenceKind[],
  candidates: readonly ExistingValidationEvidence[],
): VNextValidationEvidenceKind[] {
  const requestedSet = new Set(requested);
  const candidateKinds = EVIDENCE_SELECTION_ORDER.filter(kind => candidates.some(candidate => candidate.kind === kind));
  return unique([...requested, ...candidateKinds]).filter(kind =>
    requested.length === 0 || requestedSet.has(kind),
  ) as VNextValidationEvidenceKind[];
}

function evaluateSelectedEvidence(
  target: ValidationTarget,
  selected: ExistingValidationEvidence,
): ValidationResult {
  const reason = selected.reason?.trim() || `selected as minimum-sufficient ${selected.kind} evidence`;
  const base = {
    target,
    selected_evidence: [{ kind: selected.kind, reason }],
    evidence_refs: [selected.ref.trim()],
    side_effects: READ_ONLY_SIDE_EFFECTS,
  } as const;
  if (selected.status === 'failed') {
    return {
      validation_result: {
        ...base,
        verdict: 'failed',
        observations: [`${selected.kind} reported failed`],
        evidence_gaps: [],
        recommended_route: {
          entry: 'debug-task',
          reason: 'Validation failed; root-cause investigation requires its own entry and authority.',
        },
      },
    };
  }
  return {
    validation_result: {
      ...base,
      verdict: 'passed',
      observations: [`${selected.kind} reported passed`],
      evidence_gaps: [],
      recommended_route: { entry: null, reason: 'Minimum-sufficient evidence was obtained; no further route is implied.' },
    },
  };
}

/**
 * Evaluate caller-supplied evidence without creating or changing any project
 * artifact. The input evidence represents checks already executed under the
 * caller's read-only policy; this function performs only deterministic
 * admission, selection, and result shaping.
 */
export function evaluateValidationEvidence(request: ValidateChangeRequest): ValidationResult {
  const target = targetFromRequest(request);
  const shapeIssues = validateRequestShape(request);
  if (shapeIssues.length > 0) {
    return blockedResult(
      target,
      shapeIssues,
      'Repair the validation request before any evidence check is considered.',
    );
  }

  const requested = request.requested_evidence ?? [];
  const candidates = [...(request.existing_evidence ?? [])].sort((left, right) => left.ref.localeCompare(right.ref));
  const gaps: string[] = [];
  const order = candidateOrder(requested, candidates);

  for (const kind of order) {
    const candidate = candidates.find(item => item.kind === kind);
    if (!candidate) {
      const available = request.environment_context?.available_evidence;
      if (requested.includes(kind) && available && !available.includes(kind)) {
        gaps.push(gapForUnavailableEvidence(kind, request.environment_context));
      }
      continue;
    }
    if (candidate.sufficient === false) {
      gaps.push(candidate.reason?.trim() || `${kind} evidence is insufficient for the target`);
      continue;
    }
    if (candidate.status === 'unavailable' || candidate.status === 'not-run') {
      gaps.push(gapForUnavailableEvidence(kind, request.environment_context, candidate));
      continue;
    }
    return evaluateSelectedEvidence(target, candidate);
  }

  if (requested.length > 0 && gaps.length === 0) {
    for (const kind of requested) {
      gaps.push(gapForUnavailableEvidence(kind, request.environment_context));
    }
  }
  if (gaps.length === 0) gaps.push('No sufficient evidence was supplied for the validation target');

  if (request.caller_context?.persistent_test_required === true) {
    const persistentReason = request.caller_context.persistent_test_reason?.trim()
      || 'minimum-sufficient durable regression evidence requires a new persistent test';
    return blockedResult(
      target,
      [...gaps, persistentReason],
      'Persistent test creation requires explicit P-12 admission and write authority; this entry does not create it.',
      'execute-step',
    );
  }

  return {
    validation_result: {
      target,
      verdict: requested.length > 0 && gaps.some(gap => /unavailable/i.test(gap)) ? 'blocked' : 'inconclusive',
      selected_evidence: [],
      observations: [],
      evidence_refs: [],
      evidence_gaps: gaps,
      side_effects: READ_ONLY_SIDE_EFFECTS,
      recommended_route: {
        entry: null,
        reason: 'Evidence is unavailable or insufficient; no finding or repair decision is implied.',
      },
    },
  };
}
