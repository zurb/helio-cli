import { describe, it, expect } from 'vitest';
import {
  validateQuestions,
  validateUxMetrics,
  buildQuestionsFromSections,
  mergeSectionFieldsIntoReportQuestions,
  buildWalkthroughScreens,
  renderWalkthroughScreen,
  walkthroughScreenJson,
  sectionStimulusLines,
  parseDevices,
  validateDevices,
  formatDevices,
  QUESTION_TYPES,
  type SectionData,
  type TestShowResponse,
  type ValidationError,
} from './tests.js';
import { GUIDE_JSON } from './guide.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// Two editor settings API-built tests could not reach, closed by the
// 2026-09-19 Public API release (zurb/helio#5048), so CLI sessions kept
// reporting them as platform limits.
//
// Device targeting: `devices` (any of desktop, tablet, mobile) on POST /tests
// and PATCH /tests/:id, read back on GET /tests/:id. Omitted means all three.
// An unknown name 400s; an empty list is refused on both writes.
//
// Image display timer: `display_seconds` (5, 10 or 15; null = always show) on a
// question — the image is shown for that long, then hidden and the question
// revealed. Needs an image asset_id on the same question. Only the types whose
// take screens read the timer take it: preference, card_sort and click_test
// 400. update_question rebuilds the section, so an edit that leaves it out
// turns the timer off; the UX metric section edit path ignores it entirely.

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

const TIMED_TYPES = [
  'free_response', 'multiple_choice', 'likert', 'nps', 'ranking',
  'matrix', 'point_allocation', 'max_diff',
];
const UNTIMED_TYPES = ['preference', 'card_sort', 'click_test'];

const question = (type: string, extra: Record<string, unknown> = {}) => [
  { instructions: 'Valid instructions', ...MINIMAL[type], ...extra },
];

const timed = (type: string, extra: Record<string, unknown> = {}) =>
  question(type, { asset_id: 61016, display_seconds: 10, ...extra });

const section = (
  type: string,
  variation: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): SectionData =>
  ({
    id: `sec-${type}`,
    type,
    position: 1,
    instructions: '<p>What did you notice?</p>',
    stripped_instructions: 'What did you notice?',
    likert_type: '',
    variations: [{ id: 'v1', name: 'V1', type, choices: [], ...variation }],
    ...extra,
  }) as unknown as SectionData;

const oneSectionTest = (s: SectionData): TestShowResponse =>
  ({ introduction: '', sections: [s] }) as unknown as TestShowResponse;

// ─── validateQuestions — display_seconds ─────────────────────────────────────

describe('validateQuestions — display_seconds', () => {
  it.each(TIMED_TYPES)('accepts a timer on %s with an image stimulus', type => {
    expect(validateQuestions(timed(type))).toEqual([]);
  });

  it.each([5, 10, 15])('accepts %i seconds, one of the editor dropdown durations', seconds => {
    expect(validateQuestions(timed('multiple_choice', { display_seconds: seconds }))).toEqual([]);
  });

  it('accepts a digit string, which the API parses the same way', () => {
    expect(validateQuestions(timed('likert', { display_seconds: '15' }))).toEqual([]);
  });

  it.each([null, undefined])('treats %s as "always show the image", even with no asset', value => {
    expect(validateQuestions(question('nps', { display_seconds: value }))).toEqual([]);
  });

  it.each([0, 3, 20, 7.5, 'ten', true])('rejects %j, a duration the editor cannot render back', value => {
    const errors = validateQuestions(timed('free_response', { display_seconds: value }));
    expect(fields(errors)).toEqual(['display_seconds']);
    expect(errors[0].message).toMatch(/5, 10 or 15/);
  });

  it('rejects a timer with no asset_id, since there is no image to hide', () => {
    const errors = validateQuestions(question('multiple_choice', { display_seconds: 10 }));
    expect(fields(errors)).toEqual(['display_seconds']);
    expect(errors[0].message).toMatch(/asset_id/);
    expect(errors[0].message).toMatch(/image/);
  });

  it.each(UNTIMED_TYPES)('rejects it on %s, whose take screen never hides the image', type => {
    const errors = validateQuestions(question(type, { display_seconds: 10 }));
    expect(fields(errors)).toEqual(['display_seconds']);
    expect(errors[0].message).toMatch(new RegExp(`not supported on ${type}`));
  });

  it('allows null on an untimed type, as the API does', () => {
    expect(validateQuestions(question('click_test', { display_seconds: null }))).toEqual([]);
  });
});

describe('validateUxMetrics — display_seconds override', () => {
  it('rejects it in a metric section override, which the API drops', () => {
    const errors = validateUxMetrics([{ type: 'appeal', sections: [{ asset_id: 61016, display_seconds: 10 }] }]);
    expect(fields(errors)).toEqual(['ux_metrics[0].sections[0].display_seconds']);
    expect(errors[0].message).toMatch(/editor/);
  });
});

// ─── QUESTION_TYPES (what `tests question-types` prints) ────────────────────

describe('QUESTION_TYPES — display_seconds', () => {
  const schema = (type: string) => QUESTION_TYPES[type as keyof typeof QUESTION_TYPES] as Record<string, unknown>;

  it.each(TIMED_TYPES)('lists display_seconds as optional on %s', type => {
    expect(schema(type).optional).toContain('display_seconds');
  });

  it.each(UNTIMED_TYPES)('does not offer display_seconds on %s', type => {
    expect(schema(type).optional).not.toContain('display_seconds');
  });
});

// ─── Devices ─────────────────────────────────────────────────────────────────

describe('parseDevices', () => {
  it('takes space-separated values as given', () => {
    expect(parseDevices(['desktop', 'mobile'])).toEqual(['desktop', 'mobile']);
  });

  it('also splits comma-separated values, trimming around them', () => {
    expect(parseDevices(['desktop, tablet', 'mobile'])).toEqual(['desktop', 'tablet', 'mobile']);
  });
});

describe('validateDevices', () => {
  it('accepts any non-empty subset of desktop, tablet and mobile', () => {
    expect(validateDevices(['desktop'])).toEqual([]);
    expect(validateDevices(['tablet', 'mobile'])).toEqual([]);
    expect(validateDevices(['desktop', 'tablet', 'mobile'])).toEqual([]);
  });

  it('names an unknown device and lists the valid ones', () => {
    const errors = validateDevices(['desktop', 'watch']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/"watch"/);
    expect(errors[0]).toMatch(/desktop, tablet, mobile/);
  });

  it('points "phone" at the name the API uses', () => {
    expect(validateDevices(['phone']).join(' ')).toMatch(/mobile/);
  });

  it('rejects an empty list, which would leave a test nobody can take', () => {
    expect(validateDevices([]).join(' ')).toMatch(/at least one/);
  });
});

describe('formatDevices', () => {
  it('says "only" for a single device', () => {
    expect(formatDevices(['desktop'])).toBe('desktop only');
  });

  it('lists a partial set', () => {
    expect(formatDevices(['desktop', 'mobile'])).toBe('desktop, mobile');
  });

  it('calls out the untargeted default', () => {
    expect(formatDevices(['desktop', 'tablet', 'mobile'])).toBe('all (desktop, tablet, mobile)');
  });
});

// ─── Preview read-back ───────────────────────────────────────────────────────

describe('buildQuestionsFromSections — display_seconds', () => {
  it('emits the timer under its write key', () => {
    const [q] = buildQuestionsFromSections([
      section('MultipleChoiceSection', { asset_id: 61016 }, { display_seconds: 10 }),
    ]) as Record<string, unknown>[];
    expect(q.display_seconds).toBe(10);
  });

  it('emits null on an untimed question of a timed type', () => {
    const [q] = buildQuestionsFromSections([section('LikertSection')]) as Record<string, unknown>[];
    expect(q.display_seconds).toBeNull();
  });

  it.each(['PreferenceSection', 'CardSortSection', 'ClickSection'])(
    'omits it on %s, which a write would reject',
    type => {
      const [q] = buildQuestionsFromSections([section(type, {}, { display_seconds: 10 })]) as Record<string, unknown>[];
      expect(q).not.toHaveProperty('display_seconds');
    },
  );
});

describe('mergeSectionFieldsIntoReportQuestions — display_seconds', () => {
  it('carries the timer onto the report question it lines up with', () => {
    const [q] = mergeSectionFieldsIntoReportQuestions(
      [{ id: '01J', position: 1, type: 'MultipleChoice', question: 'What did you notice?' } as never],
      [section('MultipleChoiceSection', { asset_id: 61016 }, { display_seconds: 15 })],
    );
    expect(q.display_seconds).toBe(15);
  });
});

describe('sectionStimulusLines — display timer', () => {
  const text = (s: SectionData) => sectionStimulusLines(s).join('\n');

  it('says how long the image shows before the question is revealed', () => {
    const lines = text(section('FreeResponseSection', { asset_id: 61016 }, { display_seconds: 5 }));
    expect(lines).toMatch(/5s/);
    expect(lines).toMatch(/hidden/);
  });

  it('prints nothing about a timer on an untimed question', () => {
    expect(text(section('FreeResponseSection', { asset_id: 61016 }))).not.toMatch(/⏱/);
  });

  it('ignores a leftover timer on a type whose take screen never reads it', () => {
    expect(text(section('PreferenceSection', {}, { display_seconds: 10 }))).not.toMatch(/⏱/);
  });
});

// ─── Walkthrough ─────────────────────────────────────────────────────────────

describe('walkthrough — display timer', () => {
  it('carries and renders the timer on a timed screen', () => {
    const [screen] = buildWalkthroughScreens(
      oneSectionTest(section('LikertSection', { asset_id: 61016 }, { display_seconds: 10 })),
    );
    expect(screen.kind === 'question' && screen.display_seconds).toBe(10);
    expect(renderWalkthroughScreen(screen).join('\n')).toMatch(/10s, then hidden/);
    expect(walkthroughScreenJson(screen).display_seconds).toBe(10);
  });

  it('serializes an untimed screen as null and renders no timer', () => {
    const [screen] = buildWalkthroughScreens(oneSectionTest(section('LikertSection', { asset_id: 61016 })));
    expect(walkthroughScreenJson(screen).display_seconds).toBeNull();
    expect(renderWalkthroughScreen(screen).join('\n')).not.toMatch(/⏱/);
  });
});

// ─── Guide ───────────────────────────────────────────────────────────────────

describe('GUIDE_JSON — devices and the display timer', () => {
  const creatable = GUIDE_JSON.question_types.creatable as Record<string, Record<string, unknown>>;
  const tests = GUIDE_JSON.commands.tests as Record<string, Record<string, unknown>>;

  it.each(TIMED_TYPES)('lists display_seconds as optional on %s', type => {
    expect(creatable[type].optional).toContain('display_seconds');
  });

  it.each(['preference', 'card_sort'])('does not offer display_seconds on %s', type => {
    expect(JSON.stringify(creatable[type].optional ?? [])).not.toContain('display_seconds');
  });

  it('documents --display-seconds on both question-editing commands', () => {
    for (const command of ['add-question', 'edit-question']) {
      expect(JSON.stringify(tests[command])).toContain('--display-seconds');
    }
  });

  it('says a UX metric section edit cannot set the timer', () => {
    const modes = tests['edit-question'].modes as Record<string, unknown>;
    expect(JSON.stringify(modes.ux_metric_section)).toMatch(/--display-seconds/);
  });

  it('documents --devices on create and update', () => {
    for (const command of ['create', 'update']) {
      const blob = JSON.stringify(tests[command]);
      expect(blob).toContain('--devices');
      expect(blob).toMatch(/desktop, tablet, mobile/);
    }
  });
});
