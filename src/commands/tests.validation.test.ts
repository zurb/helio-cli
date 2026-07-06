import { describe, it, expect } from 'vitest';
import {
  validateQuestions,
  validateUxMetrics,
  formatValidationErrors,
  parsePositiveInt,
  type ValidationError,
} from './tests.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fields = (errors: ValidationError[]) => errors.map(e => e.field);
const q = (overrides: Record<string, unknown>) => [{ instructions: 'Valid instructions', ...overrides }];

// ─── validateQuestions: top-level shape ──────────────────────────────────────

describe('validateQuestions — top-level shape', () => {
  it('rejects non-array input', () => {
    const errors = validateQuestions({ type: 'nps' });
    expect(fields(errors)).toEqual(['questions']);
    expect(errors[0].message).toMatch(/JSON array/);
  });

  it('rejects an empty array', () => {
    const errors = validateQuestions([]);
    expect(errors[0].message).toMatch(/At least one question/);
  });

  it('rejects non-object entries', () => {
    const errors = validateQuestions(['not an object']);
    expect(errors[0]).toMatchObject({ question: 1, field: 'question' });
  });

  it('requires type', () => {
    const errors = validateQuestions([{ instructions: 'Hi' }]);
    expect(errors[0]).toMatchObject({ question: 1, field: 'type', message: 'Required' });
  });

  it('rejects unknown types and lists creatable ones', () => {
    const errors = validateQuestions(q({ type: 'slider' }));
    expect(errors[0].field).toBe('type');
    expect(errors[0].message).toMatch(/Unknown type "slider"/);
    expect(errors[0].message).toMatch(/free_response/);
  });

  it('rejects non-creatable types with a UI-only message', () => {
    for (const type of ['click_test', 'tree_test', 'prototype_task']) {
      const errors = validateQuestions(q({ type }));
      expect(errors[0].message).toMatch(/only be created via the UI/);
    }
  });

  it('requires non-empty instructions', () => {
    const errors = validateQuestions([{ type: 'nps', instructions: '   ' }]);
    expect(fields(errors)).toContain('instructions');
  });

  it('reports the 1-based question number', () => {
    const errors = validateQuestions([
      { type: 'nps', instructions: 'Fine' },
      { type: 'likert', instructions: 'Missing scale' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].question).toBe(2);
  });
});

// ─── validateQuestions: PascalCase aliases ───────────────────────────────────

describe('validateQuestions — type aliases', () => {
  const aliasPairs: Array<[string, Record<string, unknown>]> = [
    ['FreeResponse', {}],
    ['MultipleChoice', { choices: ['A', 'B'] }],
    ['Likert', { scale_type: 'agreement' }],
    ['NPS', {}],
    ['Ranking', { choices: ['A', 'B', 'C'] }],
    ['Preference', { choices: ['A', 'B'] }],
    ['Matrix', { choices: ['Row'], categories: ['C1', 'C2'] }],
    ['CardSort', { choices: ['A', 'B'], categories: ['C1', 'C2'] }],
    ['PointAllocation', { choices: ['A', 'B'] }],
    ['MaxDiff', { choices: ['A', 'B', 'C', 'D'] }],
  ];

  it.each(aliasPairs)('accepts PascalCase alias %s', (type, extra) => {
    expect(validateQuestions(q({ type, ...extra }))).toEqual([]);
  });
});

// ─── validateQuestions: per-type rules ───────────────────────────────────────

describe('validateQuestions — multiple_choice', () => {
  it('accepts a minimal valid payload', () => {
    expect(validateQuestions(q({ type: 'multiple_choice', choices: ['A', 'B'] }))).toEqual([]);
  });

  it('requires at least 2 choices', () => {
    const errors = validateQuestions(q({ type: 'multiple_choice', choices: ['Only one'] }));
    expect(errors[0].message).toMatch(/at least 2/);
  });

  it('rejects empty-string choices', () => {
    const errors = validateQuestions(q({ type: 'multiple_choice', choices: ['A', '  '] }));
    expect(fields(errors)).toContain('choices[1]');
  });
});

describe('validateQuestions — likert', () => {
  const validScales = [
    'agreement', 'occurrence', 'importance', 'quality', 'comprehension',
    'impression', 'expectations', 'usefulness', 'difficulty', 'likelihood',
  ];

  it.each(validScales)('accepts scale_type %s', scale_type => {
    expect(validateQuestions(q({ type: 'likert', scale_type }))).toEqual([]);
  });

  it('requires scale_type', () => {
    const errors = validateQuestions(q({ type: 'likert' }));
    expect(errors[0].field).toBe('scale_type');
  });

  it('rejects unknown scale_type', () => {
    const errors = validateQuestions(q({ type: 'likert', scale_type: 'vibes' }));
    expect(errors[0].message).toMatch(/Invalid "vibes"/);
  });

  it('custom scale requires exactly 4 or 5 custom_choices', () => {
    const make = (n: number) =>
      validateQuestions(q({ type: 'likert', scale_type: 'custom', custom_choices: Array.from({ length: n }, (_, i) => `L${i}`) }));
    expect(make(3)[0]?.field).toBe('custom_choices');
    expect(make(4)).toEqual([]);
    expect(make(5)).toEqual([]);
    expect(make(6)[0]?.field).toBe('custom_choices');
  });

  it('custom choices must be non-empty strings', () => {
    const errors = validateQuestions(q({ type: 'likert', scale_type: 'custom', custom_choices: ['A', 'B', 'C', ' '] }));
    expect(errors[0].message).toMatch(/non-empty string/);
  });
});

describe('validateQuestions — choice-count minimums', () => {
  it.each([
    ['ranking', 3],
    ['preference', 2],
    ['point_allocation', 2],
    ['max_diff', 4],
  ] as Array<[string, number]>)('%s requires at least %i choices', (type, min) => {
    const under = Array.from({ length: min - 1 }, (_, i) => `C${i}`);
    const exact = Array.from({ length: min }, (_, i) => `C${i}`);
    expect(validateQuestions(q({ type, choices: under }))[0].field).toBe('choices');
    expect(validateQuestions(q({ type, choices: exact }))).toEqual([]);
  });
});

describe('validateQuestions — matrix and card_sort', () => {
  it('matrix requires ≥1 row and ≥2 categories', () => {
    expect(validateQuestions(q({ type: 'matrix', choices: [], categories: ['A', 'B'] }))[0].field).toBe('choices');
    expect(validateQuestions(q({ type: 'matrix', choices: ['Row'], categories: ['Only'] }))[0].field).toBe('categories');
    expect(validateQuestions(q({ type: 'matrix', choices: ['Row'], categories: ['A', 'B'] }))).toEqual([]);
  });

  it('card_sort requires ≥2 cards and ≥2 categories', () => {
    expect(validateQuestions(q({ type: 'card_sort', choices: ['One'], categories: ['A', 'B'] }))[0].field).toBe('choices');
    expect(validateQuestions(q({ type: 'card_sort', choices: ['A', 'B'], categories: ['Only'] }))[0].field).toBe('categories');
    expect(validateQuestions(q({ type: 'card_sort', choices: ['A', 'B'], categories: ['C1', 'C2'] }))).toEqual([]);
  });
});

describe('validateQuestions — free_response and nps', () => {
  it('free_response needs only type + instructions', () => {
    expect(validateQuestions(q({ type: 'free_response' }))).toEqual([]);
  });

  it('nps needs only type + instructions', () => {
    expect(validateQuestions(q({ type: 'nps' }))).toEqual([]);
  });
});

// ─── validateUxMetrics ───────────────────────────────────────────────────────

describe('validateUxMetrics', () => {
  const creatable = [
    'sentiment', 'feeling', 'appeal', 'reaction', 'comprehension', 'frequency',
    'loyalty', 'intent', 'desirability', 'usefulness', 'expectations',
  ];
  const excluded = ['brand_score', 'engagement', 'success', 'completion', 'usability', 'satisfaction', 'effort'];

  it('accepts every creatable metric', () => {
    expect(validateUxMetrics(creatable)).toEqual([]);
  });

  it.each(excluded)('rejects excluded metric %s with the click-test/prototype explanation', m => {
    const errors = validateUxMetrics([m]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/click tests or prototypes/);
  });

  it('rejects unknown metric names', () => {
    const errors = validateUxMetrics(['delight']);
    expect(errors[0].message).toMatch(/Unknown metric type "delight"/);
  });

  it('rejects duplicates', () => {
    const errors = validateUxMetrics(['sentiment', 'loyalty', 'sentiment']);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Duplicate metric type "sentiment"/);
    expect(errors[0].field).toBe('ux_metrics[2]');
  });

  it('rejects non-array input', () => {
    expect(validateUxMetrics('sentiment')[0].message).toMatch(/Must be an array/);
  });

  it('rejects non-string entries', () => {
    expect(validateUxMetrics([42])[0].message).toMatch(/must be a string/);
  });
});

// ─── formatValidationErrors ──────────────────────────────────────────────────

describe('formatValidationErrors', () => {
  it('prefixes per-question errors with the question number and array-level with "Questions"', () => {
    const out = formatValidationErrors([
      { question: 2, field: 'choices', message: 'Required' },
      { question: 0, field: 'questions', message: 'Must be a JSON array' },
    ]);
    expect(out).toContain('Question 2 → choices: Required');
    expect(out).toContain('Questions → questions: Must be a JSON array');
    expect(out.startsWith('Validation failed:')).toBe(true);
  });
});

// ─── parsePositiveInt ────────────────────────────────────────────────────────

describe('parsePositiveInt', () => {
  it('parses positive integers', () => {
    expect(parsePositiveInt('100', '--target-audience-size')).toBe(100);
    expect(parsePositiveInt('1', '--n')).toBe(1);
  });

  it.each(['', undefined])('throws "required" for %j', v => {
    expect(() => parsePositiveInt(v as string | undefined, '--n')).toThrow(/--n is required/);
  });

  it.each(['0', '-5', '1.5', 'abc', 'NaN', 'Infinity'])('rejects %s', v => {
    expect(() => parsePositiveInt(v, '--n')).toThrow(/positive integer/);
  });
});
