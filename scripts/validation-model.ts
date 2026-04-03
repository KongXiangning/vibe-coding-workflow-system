/**
 * Validation model for the workflow-system.
 *
 * Defines validation layers, blocker levels, entrypoint contracts, and matrix
 * parsing. Implements WORKFLOW_PROTOCOL.md §16.
 */

// --- Types ---

export type ValidationLayer = 'protocol' | 'project';

export type BlockerLevel = 'blocks-generator' | 'blocks-merge' | 'blocks-ship' | 'warning-only';

export type EntrypointOwner = 'workflow-system' | 'target-project';

export type BindingStatus = 'bound' | 'unbound';

export type ValidationEntrypoint = {
  name: string;
  layer: ValidationLayer;
  command: string;
  blocker_level: BlockerLevel;
  description: string;
  phase: string;
  owner: EntrypointOwner;
};

export type ValidationMatrix = {
  entrypoints: ValidationEntrypoint[];
};

export type ValidationResult = {
  entrypoint: string;
  layer: ValidationLayer;
  blocker_level: BlockerLevel;
  status: 'passed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
};

export type ValidationReport = {
  protocol_results: ValidationResult[];
  project_results: ValidationResult[];
  protocol_passed: boolean;
  project_passed: boolean;
  project_authoritative: boolean;
  blocked_gates: BlockerLevel[];
};

// --- Constants ---

export const VALID_LAYERS: readonly ValidationLayer[] = ['protocol', 'project'];
export const VALID_BLOCKER_LEVELS: readonly BlockerLevel[] = [
  'blocks-generator',
  'blocks-merge',
  'blocks-ship',
  'warning-only',
];
export const VALID_OWNERS: readonly EntrypointOwner[] = ['workflow-system', 'target-project'];

const BLOCKER_SEVERITY: Record<BlockerLevel, number> = {
  'blocks-generator': 3,
  'blocks-merge': 2,
  'blocks-ship': 1,
  'warning-only': 0,
};

/**
 * Protocol-level entrypoints defined by the workflow-system.
 * These are the minimum validation matrix per WORKFLOW_PROTOCOL.md §16.4.
 */
export const PROTOCOL_ENTRYPOINTS: readonly ValidationEntrypoint[] = [
  {
    name: 'workflow-skills-validation',
    layer: 'protocol',
    command: 'bun run gen:workflow-skills --dry-run',
    blocker_level: 'blocks-generator',
    description: 'Validate workflow skill templates, metadata, path boundaries, and handoff closure.',
    phase: 'P9',
    owner: 'workflow-system',
  },
  {
    name: 'workflow-docs-validation',
    layer: 'protocol',
    command: 'bun run gen:workflow-docs --dry-run',
    blocker_level: 'blocks-generator',
    description: 'Validate generated governance doc structure, required headings, and placeholder handling.',
    phase: 'P9',
    owner: 'workflow-system',
  },
  {
    name: 'registry-validation',
    layer: 'protocol',
    command: 'bun run gen:registry --dry-run',
    blocker_level: 'blocks-generator',
    description: 'Validate registry generation against the shared workflow metadata baseline.',
    phase: 'P9',
    owner: 'workflow-system',
  },
  {
    name: 'workflow-skills-tests',
    layer: 'protocol',
    command: 'bun run test:workflow-skills',
    blocker_level: 'blocks-merge',
    description: 'Run workflow skill generator tests.',
    phase: 'P9',
    owner: 'workflow-system',
  },
  {
    name: 'workflow-docs-tests',
    layer: 'protocol',
    command: 'bun run test:workflow-docs',
    blocker_level: 'blocks-merge',
    description: 'Run workflow docs generator tests.',
    phase: 'P9',
    owner: 'workflow-system',
  },
  {
    name: 'registry-tests',
    layer: 'protocol',
    command: 'bun run test:registry',
    blocker_level: 'blocks-merge',
    description: 'Run registry generator tests.',
    phase: 'P9',
    owner: 'workflow-system',
  },
  {
    name: 'bootstrap-tests',
    layer: 'protocol',
    command: 'bun run test:bootstrap-governance',
    blocker_level: 'blocks-merge',
    description: 'Run bootstrap planning capability tests.',
    phase: 'P9',
    owner: 'workflow-system',
  },
  {
    name: 'task-identity-tests',
    layer: 'protocol',
    command: 'bun run test:task-identity',
    blocker_level: 'blocks-merge',
    description: 'Run task identity contract tests.',
    phase: 'P9',
    owner: 'workflow-system',
  },
];

/**
 * Default project-level entrypoint slots (unbound).
 * Target projects bind these during Adoption A4.
 */
export const DEFAULT_PROJECT_SLOTS: readonly ValidationEntrypoint[] = [
  {
    name: 'unit',
    layer: 'project',
    command: '',
    blocker_level: 'blocks-merge',
    description: 'Bind the target project unit-test command or runner during Adoption A4.',
    phase: 'A4',
    owner: 'target-project',
  },
  {
    name: 'integration',
    layer: 'project',
    command: '',
    blocker_level: 'blocks-merge',
    description: 'Bind the target project integration-test command or runner during Adoption A4.',
    phase: 'A4',
    owner: 'target-project',
  },
  {
    name: 'e2e-smoke',
    layer: 'project',
    command: '',
    blocker_level: 'blocks-merge',
    description: 'Bind the target project smoke or end-to-end validation command during Adoption A4.',
    phase: 'A4',
    owner: 'target-project',
  },
  {
    name: 'contract-compatibility',
    layer: 'project',
    command: '',
    blocker_level: 'blocks-merge',
    description: 'Bind target-project contract compatibility checks during Adoption A4.',
    phase: 'A4',
    owner: 'target-project',
  },
];

/** Optional non-functional entrypoint slot names. */
export const OPTIONAL_SLOT_NAMES = [
  'performance',
  'reliability',
  'compatibility',
  'security',
  'deploy',
] as const;

// --- Validation ---

export function isValidLayer(value: string): value is ValidationLayer {
  return (VALID_LAYERS as readonly string[]).includes(value);
}

export function isValidBlockerLevel(value: string): value is BlockerLevel {
  return (VALID_BLOCKER_LEVELS as readonly string[]).includes(value);
}

export function isValidOwner(value: string): value is EntrypointOwner {
  return (VALID_OWNERS as readonly string[]).includes(value);
}

export function isEntrypointBound(entrypoint: ValidationEntrypoint): boolean {
  return entrypoint.command.trim().length > 0 && !entrypoint.command.trim().startsWith('{{');
}

export function blockerSeverity(level: BlockerLevel): number {
  return BLOCKER_SEVERITY[level];
}

export function blockerLevelExceeds(left: BlockerLevel, right: BlockerLevel): boolean {
  return BLOCKER_SEVERITY[left] > BLOCKER_SEVERITY[right];
}

// --- Matrix parsing ---

function validateEntrypointFields(entry: Record<string, unknown>, index: number): void {
  const required = ['name', 'layer', 'command', 'blocker_level', 'description', 'phase', 'owner'];
  for (const field of required) {
    if (!(field in entry) || entry[field] === undefined || entry[field] === null) {
      throw new Error(`Validation matrix entry [${index}] is missing required field "${field}".`);
    }
  }

  const layer = String(entry.layer);
  if (!isValidLayer(layer)) {
    throw new Error(
      `Validation matrix entry [${index}] has invalid layer "${layer}". Expected: ${VALID_LAYERS.join(', ')}.`,
    );
  }

  const blockerLevel = String(entry.blocker_level);
  if (!isValidBlockerLevel(blockerLevel)) {
    throw new Error(
      `Validation matrix entry [${index}] has invalid blocker_level "${blockerLevel}". Expected: ${VALID_BLOCKER_LEVELS.join(', ')}.`,
    );
  }

  const owner = String(entry.owner);
  if (!isValidOwner(owner)) {
    throw new Error(
      `Validation matrix entry [${index}] has invalid owner "${owner}". Expected: ${VALID_OWNERS.join(', ')}.`,
    );
  }
}

function validateBlockerRules(entry: ValidationEntrypoint, index: number): void {
  if (entry.layer === 'project' && entry.blocker_level === 'blocks-generator') {
    throw new Error(
      `Validation matrix entry [${index}] "${entry.name}": project-layer entrypoints cannot use blocker_level "blocks-generator".`,
    );
  }

  if (entry.layer === 'protocol' && entry.owner === 'workflow-system') {
    if (blockerLevelExceeds('blocks-merge', entry.blocker_level)) {
      throw new Error(
        `Validation matrix entry [${index}] "${entry.name}": protocol-level workflow-system entrypoints cannot be demoted below blocks-merge.`,
      );
    }
  }
}

export function parseValidationMatrix(
  matrixEntries: unknown[],
): ValidationMatrix {
  const entrypoints: ValidationEntrypoint[] = [];
  const seenNames = new Set<string>();

  for (let index = 0; index < matrixEntries.length; index++) {
    const raw = matrixEntries[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Validation matrix entry [${index}] must be an object.`);
    }

    const entry = raw as Record<string, unknown>;
    validateEntrypointFields(entry, index);

    const name = String(entry.name).trim();
    if (seenNames.has(name)) {
      throw new Error(`Duplicate validation entrypoint name "${name}" at index ${index}.`);
    }
    seenNames.add(name);

    const parsed: ValidationEntrypoint = {
      name,
      layer: String(entry.layer) as ValidationLayer,
      command: String(entry.command ?? ''),
      blocker_level: String(entry.blocker_level) as BlockerLevel,
      description: String(entry.description),
      phase: String(entry.phase),
      owner: String(entry.owner) as EntrypointOwner,
    };

    validateBlockerRules(parsed, index);
    entrypoints.push(parsed);
  }

  return { entrypoints };
}

// --- Layer separation ---

export function partitionByLayer(entrypoints: ValidationEntrypoint[]): {
  protocol: ValidationEntrypoint[];
  project: ValidationEntrypoint[];
} {
  return {
    protocol: entrypoints.filter(e => e.layer === 'protocol'),
    project: entrypoints.filter(e => e.layer === 'project'),
  };
}

export function getBoundEntrypoints(entrypoints: ValidationEntrypoint[]): ValidationEntrypoint[] {
  return entrypoints.filter(isEntrypointBound);
}

export function getBlockedGates(results: ValidationResult[]): BlockerLevel[] {
  const failedLevels = new Set<BlockerLevel>();
  for (const result of results) {
    if (result.status === 'failed' && result.blocker_level !== 'warning-only') {
      failedLevels.add(result.blocker_level);
    }
  }
  return [...failedLevels].sort((a, b) => BLOCKER_SEVERITY[b] - BLOCKER_SEVERITY[a]);
}

export function buildValidationReport(
  protocolResults: ValidationResult[],
  projectResults: ValidationResult[],
): ValidationReport {
  const protocolPassed = protocolResults.every(
    r => r.status === 'passed' || r.status === 'skipped' || r.blocker_level === 'warning-only',
  );

  const projectPassed = projectResults.every(
    r => r.status === 'passed' || r.status === 'skipped' || r.blocker_level === 'warning-only',
  );

  return {
    protocol_results: protocolResults,
    project_results: projectResults,
    protocol_passed: protocolPassed,
    project_passed: projectPassed,
    project_authoritative: protocolPassed,
    blocked_gates: getBlockedGates([...protocolResults, ...projectResults]),
  };
}
