import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  type JsonObject,
  STAGE_MAP,
  STAGE_ALIASES,
  REQUIRED_STAGES,
  REQUIRED_RUNTIME_SKILL_STAGES,
  RESERVED_FAILURE_TARGETS,
  normalizeList,
  getRequiredPath,
  parseFrontmatter,
  stringifyInline,
  renderValue,
  projectPlaceholders,
  normalizePathEntry,
  validatePathEntry,
  validatePathEntries,
  normalizeRepoPattern,
  validateRepoPatternEntry,
  validateRepoPatternEntries,
  repoPatternMatchesPath,
  validateProfilePathSemantics,
  pathEntriesOverlap,
  validateWriteBoundaryConflicts,
  validateUnresolvedPlaceholders,
  validateStages,
  validateRuntimeSkillStages,
  validateRequiredFields,
  extractHandoff,
  validateHandoff,
  executeWrites,
  resolveRoot,
  runGenerator,
} from '../scripts/workflow-core';

describe('workflow-core', () => {
  test('resolveRoot honors WORKFLOW_SYSTEM_ROOT override', () => {
    const original = process.env.WORKFLOW_SYSTEM_ROOT;
    try {
      process.env.WORKFLOW_SYSTEM_ROOT = path.join(os.tmpdir(), 'workflow-root-override');
      expect(resolveRoot()).toBe(path.resolve(process.env.WORKFLOW_SYSTEM_ROOT));
    } finally {
      if (original === undefined) {
        delete process.env.WORKFLOW_SYSTEM_ROOT;
      } else {
        process.env.WORKFLOW_SYSTEM_ROOT = original;
      }
    }
  });

  // --- Stage enum ---

  describe('stage enum', () => {
    test('STAGE_MAP has 10 entries', () => {
      expect(STAGE_MAP.size).toBe(10);
    });

    test('STAGE_ALIASES has 10 entries (reverse of STAGE_MAP)', () => {
      expect(STAGE_ALIASES.size).toBe(10);
    });

    test('STAGE_MAP and STAGE_ALIASES are consistent inverses', () => {
      for (const [canonical, display] of STAGE_MAP) {
        expect(STAGE_ALIASES.get(display)).toBe(canonical);
      }
    });

    test('REQUIRED_STAGES contains all Chinese display names', () => {
      for (const display of STAGE_MAP.values()) {
        expect(REQUIRED_STAGES.has(display)).toBe(true);
      }
    });

    test('REQUIRED_RUNTIME_SKILL_STAGES excludes init but keeps numbered phases', () => {
      expect(REQUIRED_RUNTIME_SKILL_STAGES.has('初始化')).toBe(false);
      for (const display of STAGE_MAP.values()) {
        if (display === '初始化') continue;
        expect(REQUIRED_RUNTIME_SKILL_STAGES.has(display)).toBe(true);
      }
    });

    test('every canonical ID maps to a non-empty display name', () => {
      for (const [canonical, display] of STAGE_MAP) {
        expect(canonical.length).toBeGreaterThan(0);
        expect(display.length).toBeGreaterThan(0);
      }
    });
  });

  // --- validateStages ---

  describe('validateStages', () => {
    const allChineseStages = [...STAGE_MAP.values()];
    const allCanonicalStages = [...STAGE_MAP.keys()];

    test('accepts all Chinese display names', () => {
      expect(() => validateStages(allChineseStages)).not.toThrow();
    });

    test('accepts all English canonical IDs', () => {
      expect(() => validateStages(allCanonicalStages)).not.toThrow();
    });

    test('accepts a mix of Chinese and English', () => {
      const mixed = [
        '初始化',
        'phase-1-intake',
        '阶段 2：范围锁定',
        'phase-3-decomposition',
        '阶段 4：小步实现',
        'phase-4-6-exception',
        '阶段 5：范围复核',
        'phase-6-regression',
        '阶段 7：状态同步',
        'phase-8-delivery',
      ];
      expect(() => validateStages(mixed)).not.toThrow();
    });

    test('throws on missing stage', () => {
      const incomplete = allChineseStages.slice(1); // missing first
      expect(() => validateStages(incomplete)).toThrow(/Missing required stage coverage/);
    });

    test('throws on extra unknown stages', () => {
      const withExtra = [...allChineseStages, 'unknown-stage'];
      expect(() => validateStages(withExtra)).toThrow(/Invalid stage value/);
    });
  });

  describe('validateRuntimeSkillStages', () => {
    const runtimeChineseStages = [...STAGE_MAP.values()].filter(stage => stage !== '初始化');
    const runtimeCanonicalStages = [...STAGE_MAP.entries()]
      .filter(([, display]) => display !== '初始化')
      .map(([canonical]) => canonical);

    test('accepts numbered workflow stages without init', () => {
      expect(() => validateRuntimeSkillStages(runtimeChineseStages)).not.toThrow();
      expect(() => validateRuntimeSkillStages(runtimeCanonicalStages)).not.toThrow();
    });

    test('throws when a numbered runtime stage is missing', () => {
      expect(() => validateRuntimeSkillStages(runtimeChineseStages.slice(1))).toThrow(/Missing required stage coverage/);
    });
  });

  // --- validateRequiredFields ---

  describe('validateRequiredFields', () => {
    const fields = ['name', 'purpose', 'stage'] as const;

    test('passes when all fields present', () => {
      const obj: JsonObject = { name: 'test', purpose: 'testing', stage: 'init' };
      expect(() => validateRequiredFields(obj, fields, 'test.md')).not.toThrow();
    });

    test('throws on missing field', () => {
      const obj: JsonObject = { name: 'test', purpose: 'testing' };
      expect(() => validateRequiredFields(obj, fields, 'test.md')).toThrow(
        /Missing required field "stage" in test\.md/,
      );
    });

    test('passes with extra fields present', () => {
      const obj: JsonObject = { name: 'test', purpose: 'testing', stage: 'init', extra: 'ok' };
      expect(() => validateRequiredFields(obj, fields, 'test.md')).not.toThrow();
    });
  });

  // --- path validation ---

  describe('path validation', () => {
    test('normalizes host separators and whitespace', () => {
      expect(normalizePathEntry('  scripts\\\\foo.ts  ')).toBe('scripts/foo.ts');
    });

    test('accepts explicit paths and restricted directory patterns', () => {
      expect(() => validatePathEntry('scripts/foo.ts', 'reads', 'test.md')).not.toThrow();
      expect(() => validatePathEntry('scripts/', 'writes', 'test.md')).not.toThrow();
      expect(() => validatePathEntry('scripts/**', 'forbidden_writes', 'test.md')).not.toThrow();
    });

    test('rejects unsupported wildcard patterns', () => {
      expect(() => validatePathEntry('**/*.md', 'reads', 'test.md')).toThrow(/unsupported wildcard pattern/);
      expect(() => validatePathEntry('*.ts', 'reads', 'test.md')).toThrow(/unsupported wildcard pattern/);
      expect(() => validatePathEntry('foo/**/bar', 'reads', 'test.md')).toThrow(/unsupported wildcard pattern/);
    });

    test('rejects absolute and parent traversal paths', () => {
      expect(() => validatePathEntry('/tmp/file', 'reads', 'test.md')).toThrow(/absolute path/);
      expect(() => validatePathEntry('C:/tmp/file', 'reads', 'test.md')).toThrow(/absolute path/);
      expect(() => validatePathEntry('../escape', 'reads', 'test.md')).toThrow(/parent traversal/);
    });

    test('validates all configured path fields', () => {
      const obj: JsonObject = {
        reads: ['README.md', 'scripts/**'],
        writes: ['scripts'],
        forbidden_writes: ['.git/**'],
      };
      expect(() => validatePathEntries(obj, ['reads', 'writes', 'forbidden_writes'], 'test.md')).not.toThrow();
    });
  });

  describe('path overlap', () => {
    test('detects directory and descendant overlap', () => {
      expect(pathEntriesOverlap('scripts', 'scripts/foo.ts')).toBe(true);
      expect(pathEntriesOverlap('scripts/**', 'scripts/foo.ts')).toBe(true);
      expect(pathEntriesOverlap('scripts/foo.ts', 'scripts/**')).toBe(true);
      expect(pathEntriesOverlap('scripts/**', 'scripts/**')).toBe(true);
    });

    test('does not report overlap for separate paths', () => {
      expect(pathEntriesOverlap('scripts', 'test')).toBe(false);
      expect(pathEntriesOverlap('scripts/**', 'browse/src')).toBe(false);
    });

    test('rejects overlapping writes and forbidden_writes entries', () => {
      const obj: JsonObject = {
        writes: ['scripts/**'],
        forbidden_writes: ['scripts/foo.ts'],
      };
      expect(() => validateWriteBoundaryConflicts(obj, 'test.md')).toThrow(/writes\/forbidden_writes conflict/);
    });
  });

  describe('repo pattern grammar', () => {
    test('normalizes repo patterns with host separators', () => {
      expect(normalizeRepoPattern('  templates\\\\skills\\\\*.SKILL.md.tmpl  ')).toBe(
        'templates/skills/*.SKILL.md.tmpl',
      );
    });

    test('accepts explicit paths and repo-wide glob patterns', () => {
      expect(() =>
        validateRepoPatternEntry('SKILL_REGISTRY.md', 'paths.generated_artifacts', 'PROJECT_PROFILE.yaml'),
      ).not.toThrow();
      expect(() =>
        validateRepoPatternEntry('**/SKILL.md', 'paths.generated_artifacts', 'PROJECT_PROFILE.yaml'),
      ).not.toThrow();
      expect(() =>
        validateRepoPatternEntry('templates/docs/*.md.tmpl', 'governance.current_documents', 'PROJECT_PROFILE.yaml'),
      ).not.toThrow();
    });

    test('rejects absolute, parent traversal, and unsupported glob syntax', () => {
      expect(() =>
        validateRepoPatternEntry('/tmp/file', 'paths.generated_artifacts', 'PROJECT_PROFILE.yaml'),
      ).toThrow(/absolute path/);
      expect(() =>
        validateRepoPatternEntry('../escape', 'paths.generated_artifacts', 'PROJECT_PROFILE.yaml'),
      ).toThrow(/parent traversal/);
      expect(() =>
        validateRepoPatternEntry('{foo,bar}', 'paths.generated_artifacts', 'PROJECT_PROFILE.yaml'),
      ).toThrow(/unsupported glob syntax/);
    });

    test('matches repo patterns using shared glob semantics', () => {
      expect(repoPatternMatchesPath('browse/src/commands.ts', 'browse/src/**')).toBe(true);
      expect(repoPatternMatchesPath('test/fixtures/review-eval-enum.rb', 'test/fixtures/review-eval-enum*.rb')).toBe(true);
      expect(repoPatternMatchesPath('templates/skills/review.SKill.md.tmpl', 'templates/skills/*.SKILL.md.tmpl')).toBe(false);
      expect(repoPatternMatchesPath('qa/SKILL.md', 'qa/**')).toBe(true);
      expect(repoPatternMatchesPath('qa/SKILL.md', 'review/**')).toBe(false);
    });

    test('validates grouped repo pattern fields', () => {
      const obj: JsonObject = {
        paths: {
          documentation_files: ['README.md', 'docs/*.md'],
          existing_skill_template_patterns: ['*/SKILL.md.tmpl'],
          generated_artifacts: ['**/SKILL.md'],
        },
        boundaries: {
          generated_only_paths: ['browse/dist/**'],
          workflow_owned_paths: ['templates/docs/**'],
        },
        governance: {
          current_documents: ['templates/docs/*.md.tmpl'],
        },
      };
      expect(() =>
        validateRepoPatternEntries(
          obj,
          [
            'paths.documentation_files',
            'paths.existing_skill_template_patterns',
            'paths.generated_artifacts',
            'boundaries.generated_only_paths',
            'boundaries.workflow_owned_paths',
            'governance.current_documents',
          ],
          'PROJECT_PROFILE.yaml',
        ),
      ).not.toThrow();
    });
  });

  describe('profile path semantics', () => {
    test('accepts the split workflow/profile path grammars', () => {
      const profile: JsonObject = {
        paths: {
          documentation_files: ['README.md', 'docs/*.md'],
          existing_skill_template_patterns: ['*/SKILL.md.tmpl', 'SKILL.md.tmpl'],
          generated_artifacts: ['**/SKILL.md', 'generated/workflow-docs/**'],
        },
        boundaries: {
          forbidden_paths: ['.git/**', 'node_modules/**'],
          generated_only_paths: ['**/SKILL.md'],
          workflow_owned_paths: ['templates/docs/**', 'templates/skills/**'],
        },
        governance: {
          current_documents: ['templates/docs/*.md.tmpl', 'templates/skills/*.SKILL.md.tmpl'],
        },
      };
      expect(() => validateProfilePathSemantics(profile)).not.toThrow();
    });

    test('does not require optional repo-level path fields to exist', () => {
      const profile: JsonObject = {
        boundaries: {
          forbidden_paths: ['.git/**'],
        },
      };
      expect(() => validateProfilePathSemantics(profile)).not.toThrow();
    });

    test('rejects wide globs inside workflow-facing forbidden_paths', () => {
      const profile: JsonObject = {
        paths: {
          existing_skill_template_patterns: ['*/SKILL.md.tmpl'],
          generated_artifacts: ['**/SKILL.md'],
        },
        boundaries: {
          forbidden_paths: ['**/SKILL.md'],
          generated_only_paths: ['**/SKILL.md'],
          workflow_owned_paths: ['templates/docs/**'],
        },
        governance: {
          current_documents: ['templates/docs/*.md.tmpl'],
        },
      };
      expect(() => validateProfilePathSemantics(profile)).toThrow(/unsupported wildcard pattern/);
    });
  });

  // --- extractHandoff ---

  describe('extractHandoff', () => {
    test('extracts valid handoff', () => {
      const fm: JsonObject = {
        handoff: { success: 'next-skill', failure: 'ask-user' },
      };
      const ref = extractHandoff(fm, 'test.md');
      expect(ref.success).toBe('next-skill');
      expect(ref.failure).toBe('ask-user');
    });

    test('throws on missing handoff', () => {
      const fm: JsonObject = {};
      expect(() => extractHandoff(fm, 'test.md')).toThrow(/Invalid handoff structure/);
    });

    test('throws on array handoff', () => {
      const fm: JsonObject = { handoff: ['a', 'b'] };
      expect(() => extractHandoff(fm, 'test.md')).toThrow(/Invalid handoff structure/);
    });

    test('throws on empty success', () => {
      const fm: JsonObject = {
        handoff: { success: '', failure: 'ask-user' },
      };
      expect(() => extractHandoff(fm, 'test.md')).toThrow(/Incomplete handoff structure/);
    });

    test('throws on empty failure', () => {
      const fm: JsonObject = {
        handoff: { success: 'next-skill', failure: '' },
      };
      expect(() => extractHandoff(fm, 'test.md')).toThrow(/Incomplete handoff structure/);
    });

    test('trims whitespace from values', () => {
      const fm: JsonObject = {
        handoff: { success: '  next-skill  ', failure: '  ask-user  ' },
      };
      const ref = extractHandoff(fm, 'test.md');
      expect(ref.success).toBe('next-skill');
      expect(ref.failure).toBe('ask-user');
    });
  });

  // --- validateHandoff ---

  describe('validateHandoff', () => {
    const knownNames = new Set(['skill-a', 'skill-b', 'skill-c']);

    test('passes with valid success and failure targets', () => {
      expect(() =>
        validateHandoff({ success: 'skill-a', failure: 'skill-b' }, knownNames, 'test.md'),
      ).not.toThrow();
    });

    test('passes with reserved failure target', () => {
      expect(() =>
        validateHandoff({ success: 'skill-a', failure: 'ask-user' }, knownNames, 'test.md'),
      ).not.toThrow();
    });

    test('throws on unknown success target', () => {
      expect(() =>
        validateHandoff({ success: 'unknown', failure: 'skill-b' }, knownNames, 'test.md'),
      ).toThrow(/Invalid handoff\.success/);
    });

    test('throws on unknown failure target', () => {
      expect(() =>
        validateHandoff({ success: 'skill-a', failure: 'unknown' }, knownNames, 'test.md'),
      ).toThrow(/Invalid handoff\.failure/);
    });
  });

  // --- runGenerator ---

  describe('runGenerator', () => {
    test('emits structured JSON error and summary line on failure', () => {
      const originalError = console.error;
      const originalExit = process.exit;
      const errors: string[] = [];
      let exitCode: number | undefined;

      console.error = (message?: unknown) => {
        errors.push(String(message));
      };
      process.exit = ((code?: number) => {
        exitCode = Number(code ?? 0);
        throw new Error(`EXIT_${exitCode}`);
      }) as typeof process.exit;

      try {
        expect(() =>
          runGenerator('gen:workflow-skills', () => {
            throw new Error('Invalid handoff.success "missing" in test.md');
          }),
        ).toThrow(/EXIT_2/);

        expect(errors.length).toBe(2);
        expect(() => JSON.parse(errors[0] as string)).not.toThrow();
        const payload = JSON.parse(errors[0] as string);
        expect(payload.generator).toBe('gen:workflow-skills');
        expect(payload.severity).toBe('error');
        expect(payload.code).toBe('HANDOFF_001');
        expect(errors[1]).toBe('gen:workflow-skills: generation failed - 1 errors, 0 warnings');
        expect(exitCode).toBe(2);
      } finally {
        console.error = originalError;
        process.exit = originalExit;
      }
    });

    test('classifies invalid stage values as STAGE_002', () => {
      const originalError = console.error;
      const originalExit = process.exit;
      const errors: string[] = [];
      let exitCode: number | undefined;

      console.error = (message?: unknown) => {
        errors.push(String(message));
      };
      process.exit = ((code?: number) => {
        exitCode = Number(code ?? 0);
        throw new Error(`EXIT_${exitCode}`);
      }) as typeof process.exit;

      try {
        expect(() =>
          runGenerator('gen:workflow-skills', () => {
            throw new Error('Invalid stage value: typo-stage');
          }),
        ).toThrow(/EXIT_2/);

        const payload = JSON.parse(errors[0] as string);
        expect(payload.code).toBe('STAGE_002');
        expect(payload.message).toBe('Invalid stage value');
        expect(exitCode).toBe(2);
      } finally {
        console.error = originalError;
        process.exit = originalExit;
      }
    });

    test('classifies invalid path entries as PATH_001', () => {
      const originalError = console.error;
      const originalExit = process.exit;
      const errors: string[] = [];
      let exitCode: number | undefined;

      console.error = (message?: unknown) => {
        errors.push(String(message));
      };
      process.exit = ((code?: number) => {
        exitCode = Number(code ?? 0);
        throw new Error(`EXIT_${exitCode}`);
      }) as typeof process.exit;

      try {
        expect(() =>
          runGenerator('gen:workflow-skills', () => {
            throw new Error('Invalid path entry in test.md.writes: "*.ts" (unsupported wildcard pattern)');
          }),
        ).toThrow(/EXIT_2/);

        const payload = JSON.parse(errors[0] as string);
        expect(payload.code).toBe('PATH_001');
        expect(payload.message).toBe('Invalid path entry');
        expect(exitCode).toBe(2);
      } finally {
        console.error = originalError;
        process.exit = originalExit;
      }
    });
  });

  // --- executeWrites ---

  describe('executeWrites', () => {
    test('rolls back committed files when a later rename fails', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-'));
      const firstPath = path.join(tempDir, 'first.md');
      const secondPath = path.join(tempDir, 'second.md');
      fs.writeFileSync(firstPath, 'old-first', 'utf8');
      fs.writeFileSync(secondPath, 'old-second', 'utf8');

      let tempRenameCount = 0;
      const fileSystem = {
        ...fs,
        renameSync(from: fs.PathLike, to: fs.PathLike) {
          if (String(from).endsWith('.tmp')) {
            tempRenameCount += 1;
            if (tempRenameCount === 2) {
              throw new Error('simulated rename failure');
            }
          }
          return fs.renameSync(from, to);
        },
      };

      try {
        expect(() =>
          executeWrites(
            [
              { path: firstPath, content: 'new-first' },
              { path: secondPath, content: 'new-second' },
            ],
            false,
            'test write',
            undefined,
            fileSystem,
          ),
        ).toThrow(/simulated rename failure/);

        expect(fs.readFileSync(firstPath, 'utf8')).toBe('old-first');
        expect(fs.readFileSync(secondPath, 'utf8')).toBe('old-second');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('keeps staging and backup files outside generated live directories', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-generated-'));
      const generatedDir = path.join(tempDir, 'generated', 'workflow-skills');
      const targetPath = path.join(generatedDir, 'review-diff.SKILL.md');
      fs.mkdirSync(generatedDir, { recursive: true });
      fs.writeFileSync(targetPath, 'old-content', 'utf8');

      const observedRenames: Array<{ from: string; to: string }> = [];
      const fileSystem = {
        ...fs,
        renameSync(from: fs.PathLike, to: fs.PathLike) {
          observedRenames.push({ from: String(from), to: String(to) });
          return fs.renameSync(from, to);
        },
      };

      try {
        executeWrites(
          [{ path: targetPath, content: 'new-content' }],
          false,
          'test write',
          undefined,
          fileSystem,
        );

        expect(fs.readFileSync(targetPath, 'utf8')).toBe('new-content');
        expect(
          observedRenames.some(
            entry =>
              entry.from.includes(generatedDir) &&
              entry.from.endsWith('.tmp'),
          ),
        ).toBe(false);
        expect(
          observedRenames.some(
            entry =>
              entry.to.includes(generatedDir) &&
              entry.to.includes('.bak.'),
          ),
        ).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // --- normalizeList ---

  describe('normalizeList', () => {
    test('returns empty array for null', () => {
      expect(normalizeList(null)).toEqual([]);
    });

    test('wraps single value in array', () => {
      expect(normalizeList('hello')).toEqual(['hello']);
    });

    test('converts array items to strings', () => {
      expect(normalizeList([1, 'two', true])).toEqual(['1', 'two', 'true']);
    });

    test('returns empty array for undefined-like', () => {
      expect(normalizeList(null)).toEqual([]);
    });
  });

  // --- getRequiredPath ---

  describe('getRequiredPath', () => {
    const profile: JsonObject = {
      project: { name: 'test-project', type: 'backend-service' },
      runtime: { languages: ['TypeScript'] },
    };

    test('resolves dotted path', () => {
      expect(getRequiredPath(profile, 'project.name')).toBe('test-project');
    });

    test('resolves nested path', () => {
      expect(getRequiredPath(profile, 'runtime.languages')).toEqual(['TypeScript']);
    });

    test('throws on missing path', () => {
      expect(() => getRequiredPath(profile, 'project.version')).toThrow(
        /Missing required profile field/,
      );
    });

    test('throws on deep missing path', () => {
      expect(() => getRequiredPath(profile, 'nonexistent.deep.path')).toThrow(
        /Missing required profile field/,
      );
    });
  });

  // --- parseFrontmatter ---

  describe('parseFrontmatter', () => {
    test('parses valid frontmatter and body', () => {
      const content = '---\nname: test\nstage: init\n---\n\n# Body content\n';
      const result = parseFrontmatter(content, 'test.md');
      expect(result.frontmatter.name).toBe('test');
      expect(result.frontmatter.stage).toBe('init');
      expect(result.body).toContain('# Body content');
    });

    test('throws on missing frontmatter', () => {
      expect(() => parseFrontmatter('no frontmatter here', 'test.md')).toThrow(
        /Invalid frontmatter block/,
      );
    });

    test('throws on non-mapping frontmatter', () => {
      const content = '---\n- item1\n- item2\n---\nbody';
      expect(() => parseFrontmatter(content, 'test.md')).toThrow(/not a mapping/);
    });
  });

  // --- stringifyInline ---

  describe('stringifyInline', () => {
    test('stringifies array as comma-separated', () => {
      expect(stringifyInline(['a', 'b', 'c'])).toBe('a, b, c');
    });

    test('stringifies object as JSON', () => {
      expect(stringifyInline({ key: 'value' })).toBe('{"key":"value"}');
    });

    test('stringifies primitive as string', () => {
      expect(stringifyInline(42)).toBe('42');
      expect(stringifyInline(true)).toBe('true');
      expect(stringifyInline('hello')).toBe('hello');
    });
  });

  // --- renderValue ---

  describe('renderValue', () => {
    const replacements: Record<string, any> = {
      '{{NAME}}': 'TestProject',
      '{{ITEMS}}': ['item1', 'item2'],
    };

    test('replaces exact match with value', () => {
      expect(renderValue('{{NAME}}', replacements)).toBe('TestProject');
    });

    test('replaces placeholder in longer string', () => {
      expect(renderValue('Hello {{NAME}}!', replacements)).toBe('Hello TestProject!');
    });

    test('replaces array placeholder with inline string', () => {
      expect(renderValue('Items: {{ITEMS}}', replacements)).toBe('Items: item1, item2');
    });

    test('recurses into objects', () => {
      const obj: JsonObject = { a: '{{NAME}}', b: 'static' };
      const result = renderValue(obj, replacements);
      expect(result).toEqual({ a: 'TestProject', b: 'static' });
    });

    test('recurses into arrays', () => {
      const arr = ['{{NAME}}', 'literal'];
      const result = renderValue(arr, replacements);
      expect(result).toEqual(['TestProject', 'literal']);
    });

    test('leaves non-matching strings unchanged', () => {
      expect(renderValue('no placeholders', replacements)).toBe('no placeholders');
    });
  });

  // --- validateUnresolvedPlaceholders ---

  describe('validateUnresolvedPlaceholders', () => {
    const allowed = new Set(['{{TASK_ID}}', '{{TASK_SLUG}}']);

    test('passes with no placeholders', () => {
      expect(() => validateUnresolvedPlaceholders('test', 'no placeholders', allowed)).not.toThrow();
    });

    test('passes with only allowed placeholders', () => {
      expect(() =>
        validateUnresolvedPlaceholders('test', 'Task: {{TASK_ID}} / {{TASK_SLUG}}', allowed),
      ).not.toThrow();
    });

    test('throws on unresolved non-allowed placeholder', () => {
      expect(() =>
        validateUnresolvedPlaceholders('test', 'Name: {{PROJECT_NAME}}', allowed),
      ).toThrow(/Unresolved placeholders/);
    });
  });
});
