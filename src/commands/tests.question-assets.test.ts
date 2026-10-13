import { describe, it, expect } from 'vitest';
import {
  validateQuestions,
  buildQuestionsFromSections,
  buildWalkthroughScreens,
  renderWalkthroughScreen,
  walkthroughScreenJson,
  sectionStimulusLines,
  QUESTION_TYPES,
  type SectionData,
  type TestShowResponse,
  type ValidationError,
} from './tests.js';
import { GUIDE_JSON } from './guide.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// Two gaps that read like platform limits from the CLI, both closed by the
// 2026-09-15 Public API release (zurb/helio#5039). Every single-variation question type has one
// stimulus upload slot in the editor, but the API only saved a question-level
// asset_id on free_response and click_test — multiple_choice, likert, nps,
// ranking, matrix, point_allocation and max_diff took it with a 200 and dropped
// it. And "Skip question introduction" (disable_instruction_card) exists on
// every section but was missing from the write permit lists. Preference (images
// live on each option) and card sort (no slot) now 400 a question-level
// asset_id instead of dropping it.

const fields = (errors: ValidationError[]) => errors.map(e => e.field);

const MINIMAL: Record<string, Record<string, unknown>> = {
  free_response: { type: 'free_response' },
  multiple_choice: { type: 'multiple_choice', choices: ['A', 'B'] },
  likert: { type: 'likert', scale_type: 'agreement' },
  nps: { type: 'nps' },
  ranking: { type: 'ranking', choices: ['A', 'B', 'C'] },
  matrix: { type: 'matrix', choices: ['Row'], categories: ['Col 1', 'Col 2'] },
  point_allocation: { type: 'point_allocation', choices: ['A', 'B'] },
  max_diff: { type: 'max_diff', choices: ['A', 'B', 'C', 'D'] },
  click_test: { type: 'click_test', asset_id: 61016 },
  preference: { type: 'preference', variations: ['A', 'B'] },
  card_sort: { type: 'card_sort', choices: ['A', 'B'], categories: ['X', 'Y'] },
};

const STIMULUS_TYPES = [
  'free_response', 'multiple_choice', 'likert', 'nps', 'ranking',
  'matrix', 'point_allocation', 'max_diff', 'click_test',
];

const question = (type: string, extra: Record<string, unknown> = {}) => [
  { instructions: 'Valid instructions', ...MINIMAL[type], ...extra },
];

const section = (
  type: string,
  variation: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): SectionData =>
  ({
    id: `sec-${type}`,
    type,
    position: 1,
    instructions: '<p>Which label is clearer?</p>',
    stripped_instructions: 'Which label is clearer?',
    likert_type: '',
    variations: [{ id: 'v1', name: 'V1', type, choices: [], ...variation }],
    ...extra,
  }) as unknown as SectionData;

const oneSectionTest = (s: SectionData): TestShowResponse =>
  ({ introduction: '', sections: [s] }) as unknown as TestShowResponse;

// ─── validateQuestions ───────────────────────────────────────────────────────

describe('validateQuestions — fixtures', () => {
  it.each(Object.keys(MINIMAL))('treats the minimal %s question as valid', type => {
    expect(validateQuestions(question(type))).toEqual([]);
  });
});

describe('validateQuestions — question-level asset_id', () => {
  it.each(STIMULUS_TYPES)('accepts a stimulus asset on %s', type => {
    expect(validateQuestions(question(type, { asset_id: 61016 }))).toEqual([]);
  });

  it('rejects it on preference and points at the per-option key', () => {
    const errors = validateQuestions(question('preference', { asset_id: 61016 }));
    expect(fields(errors)).toEqual(['asset_id']);
    expect(errors[0].message).toMatch(/variations/);
    expect(errors[0].message).toMatch(/each option/);
  });

  it('rejects it on card sort, which has no stimulus slot', () => {
    const errors = validateQuestions(question('card_sort', { asset_id: 61016 }));
    expect(fields(errors)).toEqual(['asset_id']);
    expect(errors[0].message).toMatch(/no stimulus slot/);
  });

  it('treats a null or empty asset_id as absent, matching the API', () => {
    expect(validateQuestions(question('card_sort', { asset_id: null }))).toEqual([]);
    expect(validateQuestions(question('preference', { asset_id: '' }))).toEqual([]);
  });
});

describe('validateQuestions — question-level site_link', () => {
  it.each(['free_response', 'click_test'])('accepts it on %s, which saves it', type => {
    expect(validateQuestions(question(type, { site_link: 'https://example.com' }))).toEqual([]);
  });

  it('rejects it on a type the API drops it from, naming the types that keep it', () => {
    const errors = validateQuestions(question('multiple_choice', { site_link: 'https://example.com' }));
    expect(fields(errors)).toEqual(['site_link']);
    expect(errors[0].message).toMatch(/free_response and click_test/);
  });

  it('points a preference question at the per-option key', () => {
    const errors = validateQuestions(question('preference', { site_link: 'https://example.com' }));
    expect(fields(errors)).toEqual(['site_link']);
    expect(errors[0].message).toMatch(/variations/);
  });
});

describe('validateQuestions — disable_instruction_card', () => {
  it.each(Object.keys(MINIMAL))('accepts true on %s', type => {
    expect(validateQuestions(question(type, { disable_instruction_card: true }))).toEqual([]);
  });

  it('accepts false and null', () => {
    expect(validateQuestions(question('likert', { disable_instruction_card: false }))).toEqual([]);
    expect(validateQuestions(question('likert', { disable_instruction_card: null }))).toEqual([]);
  });

  it.each(['true', 1])('rejects the non-boolean %j, which the API 400s', value => {
    const errors = validateQuestions(question('likert', { disable_instruction_card: value }));
    expect(fields(errors)).toEqual(['disable_instruction_card']);
    expect(errors[0].message).toMatch(/true or false/);
  });
});

// ─── QUESTION_TYPES (what `tests question-types` prints) ────────────────────

describe('QUESTION_TYPES — stimulus and intro card fields', () => {
  const schema = (type: string) => QUESTION_TYPES[type as keyof typeof QUESTION_TYPES] as Record<string, unknown>;

  it.each(STIMULUS_TYPES.filter(t => t !== 'click_test'))('lists asset_id as optional on %s', type => {
    expect(schema(type).optional).toContain('asset_id');
  });

  it.each(['preference', 'card_sort'])('does not offer a question-level asset_id on %s', type => {
    expect(schema(type).optional).not.toContain('asset_id');
  });

  it.each(Object.keys(MINIMAL))('lists disable_instruction_card as optional on %s', type => {
    expect(schema(type).optional).toContain('disable_instruction_card');
  });
});

// ─── Preview read-back ───────────────────────────────────────────────────────

describe('buildQuestionsFromSections — stimulus and intro card', () => {
  it('emits the stimulus asset_id and the intro card flag under their write keys', () => {
    const [q] = buildQuestionsFromSections([
      section('MultipleChoiceDirectiveSection', { asset_id: 61016 }, { disable_instruction_card: true }),
    ]) as Record<string, unknown>[];
    expect(q.asset_id).toBe(61016);
    expect(q.disable_instruction_card).toBe(true);
  });

  it('defaults to no asset and a shown intro card', () => {
    const [q] = buildQuestionsFromSections([section('LikertDirectiveSection')]) as Record<string, unknown>[];
    expect(q.asset_id).toBeNull();
    expect(q.disable_instruction_card).toBe(false);
  });

  it.each(['PreferenceDirectiveSection', 'CardSortDirectiveSection'])(
    'omits a question-level asset_id on %s, which a write would reject',
    type => {
      const [q] = buildQuestionsFromSections([section(type, {}, { disable_instruction_card: true })]) as Record<string, unknown>[];
      expect(q).not.toHaveProperty('asset_id');
      expect(q.disable_instruction_card).toBe(true);
    },
  );
});

describe('sectionStimulusLines — preview text', () => {
  const text = (s: SectionData) => sectionStimulusLines(s).join('\n');

  it('names the stimulus asset on a single-variation type', () => {
    expect(text(section('MultipleChoiceDirectiveSection', { asset_id: 61016 }))).toContain('asset 61016');
  });

  it('prints the site link when the section has one', () => {
    expect(text(section('FreeResponseDirectiveSection', { site_link: 'https://example.com' }))).toContain(
      'https://example.com',
    );
  });

  it('says when the question introduction is skipped', () => {
    expect(text(section('LikertDirectiveSection', {}, { disable_instruction_card: true }))).toMatch(
      /skips the question introduction/,
    );
  });

  it('prints nothing for a plain question', () => {
    expect(sectionStimulusLines(section('NpsDirectiveSection'))).toEqual([]);
  });

  it('leaves preference images to the option list but still reports the intro card', () => {
    const lines = text(
      section('PreferenceDirectiveSection', { asset_id: 61016 }, { disable_instruction_card: true }),
    );
    expect(lines).not.toContain('asset 61016');
    expect(lines).toMatch(/skips the question introduction/);
  });
});

// ─── Walkthrough ─────────────────────────────────────────────────────────────

describe('walkthrough — stimulus on single-variation types', () => {
  it('collects a stimulus identified only by asset_id', () => {
    const [screen] = buildWalkthroughScreens(
      oneSectionTest(section('MultipleChoiceDirectiveSection', { asset_id: 61016 })),
    );
    expect(screen.kind === 'question' && screen.assets.map(a => a.asset_id)).toEqual([61016]);
    expect(renderWalkthroughScreen(screen).join('\n')).toContain('asset 61016');
  });

  it('carries the intro card flag, defaulting to shown', () => {
    const [skipped] = buildWalkthroughScreens(
      oneSectionTest(section('LikertDirectiveSection', {}, { disable_instruction_card: true })),
    );
    const [shown] = buildWalkthroughScreens(oneSectionTest(section('LikertDirectiveSection')));
    expect(skipped.kind === 'question' && skipped.disable_instruction_card).toBe(true);
    expect(shown.kind === 'question' && shown.disable_instruction_card).toBe(false);
  });

  it('renders the skipped intro card and serializes the flag', () => {
    const [skipped] = buildWalkthroughScreens(
      oneSectionTest(section('LikertDirectiveSection', {}, { disable_instruction_card: true })),
    );
    const [shown] = buildWalkthroughScreens(oneSectionTest(section('LikertDirectiveSection')));
    expect(renderWalkthroughScreen(skipped).join('\n')).toMatch(/no question introduction/);
    expect(renderWalkthroughScreen(shown).join('\n')).not.toMatch(/introduction/);
    expect(walkthroughScreenJson(skipped).disable_instruction_card).toBe(true);
  });
});

// ─── Guide ───────────────────────────────────────────────────────────────────

describe('GUIDE_JSON — question stimulus and intro card', () => {
  const creatable = GUIDE_JSON.question_types.creatable as Record<string, Record<string, unknown>>;
  const tests = GUIDE_JSON.commands.tests as Record<string, Record<string, unknown>>;

  it.each(STIMULUS_TYPES.filter(t => t !== 'click_test' && t in creatable))(
    'lists asset_id and disable_instruction_card as optional on %s',
    type => {
      expect(creatable[type].optional).toEqual(expect.arrayContaining(['asset_id', 'disable_instruction_card']));
    },
  );

  it.each(['preference', 'card_sort'])('does not offer a question-level asset_id on %s', type => {
    expect(JSON.stringify(creatable[type].optional ?? [])).not.toContain('asset_id');
  });

  it('documents --asset-id and --skip-question-intro on both question-editing commands', () => {
    for (const command of ['add-question', 'edit-question']) {
      const blob = JSON.stringify(tests[command]);
      expect(blob).toContain('--asset-id');
      expect(blob).toContain('--skip-question-intro');
    }
  });

  it('says a UX metric section edit cannot set the intro card', () => {
    const modes = tests['edit-question'].modes as Record<string, unknown>;
    expect(JSON.stringify(modes.ux_metric_section)).toMatch(/--skip-question-intro/);
  });
});
