import { describe, it, expect } from 'vitest';
import {
  preferenceOptions,
  buildQuestionsFromSections,
  buildWalkthroughScreens,
  renderWalkthroughScreen,
  sectionStimulusLines,
  mergeSectionFieldsIntoReportQuestions,
  type SectionData,
  type TestShowResponse,
} from './tests.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// GET /tests/:id names a section by the model's own STI class —
// MultipleChoiceSection, RankSection, NpsSection, ClickSection — while the CLI
// only knew the "…DirectiveSection" spellings of older payloads. Anything
// keyed off the canonical type therefore fell through on real tests: preference
// options read as empty, click/tree/prototype screens rendered as if they were
// answerable, and a question's stimulus asset_id was left out of preview JSON.

const section = (
  type: string,
  variation: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): SectionData =>
  ({
    id: 1,
    type,
    position: 0,
    instructions: '<p>Which label is clearer?</p>',
    stripped_instructions: 'Which label is clearer?',
    likert_type: '',
    variations: [{ id: 'v1', name: 'V1', type, choices: [], ...variation }],
    ...extra,
  }) as unknown as SectionData;

const choice = (id: string, text: string, position: number) => ({ id, text, position });

describe('section type vocabulary — the STI names GET actually returns', () => {
  it.each([
    ['FreeResponseSection', 'free_response'],
    ['MultipleChoiceSection', 'multiple_choice'],
    ['LikertSection', 'likert'],
    ['NpsSection', 'nps'],
    ['RankSection', 'ranking'],
    ['MatrixSection', 'matrix'],
    ['CardSortSection', 'card_sort'],
    ['MaxDiffSection', 'max_diff'],
    ['PointAllocationSection', 'point_allocation'],
    ['ClickSection', 'click_test'],
    ['TreeTestSection', 'tree_test'],
    ['PreferenceSection', 'preference'],
  ])('maps %s to %s on a walkthrough screen', (raw, canonical) => {
    const [screen] = buildWalkthroughScreens({
      introduction: '',
      sections: [section(raw)],
    } as unknown as TestShowResponse);
    expect(screen.kind === 'question' && screen.type).toBe(canonical);
  });

  it('labels a section by its type rather than echoing the class name', () => {
    const [screen] = buildWalkthroughScreens({
      introduction: '',
      sections: [section('MultipleChoiceSection')],
    } as unknown as TestShowResponse);
    expect(screen.kind === 'question' && screen.type_label).toBe('Multiple Choice');
  });

  it('renders multiple choice as answerable options, not a bare list', () => {
    const [screen] = buildWalkthroughScreens({
      introduction: '',
      sections: [
        section('MultipleChoiceSection', { choices: [choice('c1', 'Open the shop', 1), choice('c2', 'My account', 2)] }),
      ],
    } as unknown as TestShowResponse);
    expect(renderWalkthroughScreen(screen).join('\n')).toContain('○ Open the shop');
  });

  it('still treats a click section as a browser-only placeholder', () => {
    const [screen] = buildWalkthroughScreens({
      introduction: '',
      sections: [section('ClickSection', { asset_id: 61157, has_asset: true })],
    } as unknown as TestShowResponse);
    expect(screen.kind === 'question' && screen.renderable).toBe('placeholder');
  });

  it('reads preference options off a PreferenceSection', () => {
    const options = preferenceOptions(
      section('PreferenceSection', {}, {
        variations: [
          { id: 'v1', name: 'Data In', type: 'PreferenceVariation', choices: [], asset_id: 61016, has_asset: true },
          { id: 'v2', name: 'The Vertical', type: 'PreferenceVariation', choices: [], asset_id: null },
        ],
      }),
    );
    expect(options?.map(o => o.name)).toEqual(['Data In', 'The Vertical']);
    expect(options?.map(o => o.has_asset)).toEqual([true, false]);
  });

  it('emits a stimulus asset_id in preview JSON for the STI names', () => {
    const [q] = buildQuestionsFromSections([
      section('NpsSection', { asset_id: 61157 }, { disable_instruction_card: true }),
    ]) as Record<string, unknown>[];
    expect(q.asset_id).toBe(61157);
    expect(q.disable_instruction_card).toBe(true);
  });

  it('still omits a question-level asset_id where a write would reject it', () => {
    const [q] = buildQuestionsFromSections([section('CardSortSection')]) as Record<string, unknown>[];
    expect(q).not.toHaveProperty('asset_id');
  });

  it('names the stimulus in preview text for the STI names', () => {
    expect(sectionStimulusLines(section('LikertSection', { asset_id: 61157 })).join('\n')).toContain('asset 61157');
  });
});

// ─── Report path ─────────────────────────────────────────────────────────────
// A test with report data (every real draft has it, at 0 responses) renders
// from questions_summary, which carries neither field. The two lists share no
// id — a report question's id is a ULID, a section's is numeric, and
// temporary_uuid comes back null — so position order is the only join.

describe('mergeSectionFieldsIntoReportQuestions', () => {
  const reportQuestions = [
    { id: '01ULID1', position: 0, type: 'multiple_choice', question: 'Q1', response_count: 0, has_followup: false, results: [] },
    { id: '01ULID2', position: 1, type: 'card_sort', question: 'Q2', response_count: 0, has_followup: false, results: [] },
  ];
  const sections = [
    section('MultipleChoiceSection', { asset_id: 61157 }, { position: 0, disable_instruction_card: true }),
    section('CardSortSection', {}, { position: 1 }),
  ];

  it('adds the stimulus and intro card to the questions the report describes', () => {
    const merged = mergeSectionFieldsIntoReportQuestions(reportQuestions, sections);
    expect(merged[0]).toMatchObject({ id: '01ULID1', asset_id: 61157, disable_instruction_card: true });
  });

  it('omits asset_id where the type has no stimulus slot', () => {
    const merged = mergeSectionFieldsIntoReportQuestions(reportQuestions, sections);
    expect(merged[1]).not.toHaveProperty('asset_id');
    expect(merged[1].disable_instruction_card).toBe(false);
  });

  it('keeps the report data untouched when the two lists do not line up', () => {
    const merged = mergeSectionFieldsIntoReportQuestions(reportQuestions, [sections[0]]);
    expect(merged).toEqual(reportQuestions);
  });

  it('matches by position, not array order', () => {
    const merged = mergeSectionFieldsIntoReportQuestions([reportQuestions[1], reportQuestions[0]], sections);
    expect(merged.map(q => q.id)).toEqual(['01ULID1', '01ULID2']);
    expect(merged[0].asset_id).toBe(61157);
  });
});
