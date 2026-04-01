import { describe, test, expect } from 'bun:test';
import {
  type JsonObject,
  STAGE_MAP,
  STAGE_ALIASES,
  REQUIRED_STAGES,
  RESERVED_FAILURE_TARGETS,
  normalizeList,
  getRequiredPath,
  parseFrontmatter,
  stringifyInline,
  renderValue,
  projectPlaceholders,
  validateUnresolvedPlaceholders,
  validateStages,
  validateRequiredFields,
  extractHandoff,
  validateHandoff,
} from '../scripts/workflow-core';

describe('workflow-core', () => {
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

    test('does not throw on extra unknown stages', () => {
      const withExtra = [...allChineseStages, 'unknown-stage'];
      expect(() => validateStages(withExtra)).not.toThrow();
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
