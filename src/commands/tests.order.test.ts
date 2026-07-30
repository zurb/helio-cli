import { describe, it, expect } from 'vitest';
import { buildOrderBlocks, buildWalkthroughScreens, buildQuestionNumberIndex, buildBranchingSummary, type SectionData, type TestShowResponse } from './tests.js';

// ─── buildOrderBlocks ────────────────────────────────────────────────────────
// Block index and question number are separate numbering systems. A metric
// block collapses several questions into one block, so the two diverge from
// that block onward — `tests order` must not conflate them with `--position`.

const section = (id: string, position: number, type: string | null, extra: Partial<SectionData> = {}) =>
  ({
    id,
    type,
    position,
    instructions: `<p>${id}</p>`,
    stripped_instructions: id,
    likert_type: '',
    ...extra,
  }) as unknown as SectionData;

describe('buildOrderBlocks', () => {
  it('numbers blocks and questions identically when no metric spans multiple questions', () => {
    const blocks = buildOrderBlocks([
      section('a', 0, 'MultipleChoiceDirectiveSection'),
      section('b', 1, 'FreeResponseDirectiveSection'),
    ]);

    expect(blocks.map(b => b.question_number)).toEqual([1, 2]);
    expect(blocks.map(b => b.key)).toEqual(['section:a', 'section:b']);
  });

  it('collapses a multi-question metric into one block, diverging block index from question number', () => {
    const blocks = buildOrderBlocks([
      section('a', 0, 'MultipleChoiceDirectiveSection'),
      section('b', 1, 'FreeResponseDirectiveSection'),
      section('m1', 2, 'LikertDirectiveSection', { ux_metric: { metric_type: 'desirability' } }),
      section('m2', 3, 'LikertDirectiveSection', { ux_metric: { metric_type: 'desirability' } }),
      section('marker', 4, 'FreeResponseDirectiveSection'),
    ]);

    // Four blocks, five questions.
    expect(blocks).toHaveLength(4);

    // The metric block is block 3 and starts at Q3 — it covers Q3 AND Q4.
    expect(blocks[2]).toMatchObject({
      key: 'metric:desirability',
      question_number: 3,
      question_count: 2,
    });

    // The block AFTER it is block index 4 but question 5. This is the exact
    // divergence that made the old single `position` field misleading.
    expect(blocks[3]).toMatchObject({ key: 'section:marker', question_number: 5 });
    expect(blocks[3].question_number).not.toBe(4);
  });

  it('sorts by section position rather than array order', () => {
    const blocks = buildOrderBlocks([
      section('second', 1, 'FreeResponseDirectiveSection'),
      section('first', 0, 'MultipleChoiceDirectiveSection'),
    ]);

    expect(blocks.map(b => b.key)).toEqual(['section:first', 'section:second']);
    expect(blocks.map(b => b.question_number)).toEqual([1, 2]);
  });

  it('labels a null section type as "unknown type" rather than [undefined]', () => {
    // Every section of a test containing a click_test comes back with a null
    // type from GET /tests/:id (tracked upstream in zurb/helio).
    const blocks = buildOrderBlocks([section('a', 0, null)]);

    expect(blocks[0].label).toContain('[unknown type]');
    expect(blocks[0].label).not.toContain('undefined');
    expect(blocks[0].label).not.toContain('null');
  });
});

// ─── degraded-type handling in the walkthrough ───────────────────────────────

describe('walkthrough type labels with degraded API data', () => {
  const degraded: TestShowResponse = {
    id: 'test-degraded',
    name: 'Test with a click test',
    status: 'draft',
    responses_count: 0,
    project_id: 'proj-1',
    project_name: 'P',
    introduction: '',
    sections: [section('a', 0, null), section('b', 1, null)],
  } as unknown as TestShowResponse;

  it('never renders undefined/null into a question type label', () => {
    const screens = buildWalkthroughScreens(degraded);
    const questions = screens.filter(s => s.kind === 'question') as { type_label: string }[];

    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.type_label).not.toMatch(/undefined|null/);
    }
  });
});

// ─── buildOrderBlocks: repeated metric types ─────────────────────────────────
// Since the 2026-07-30 API release a metric type may be on a test more than
// once, each instance owning its own sections and score. Blocks are per
// INSTANCE, and a repeated type can no longer be identified by `metric:<type>`.

describe('buildOrderBlocks — repeated metric types', () => {
  const metricSection = (
    id: string,
    position: number,
    metricId: number,
    metricType: string,
  ): SectionData => ({
    id,
    type: 'LikertDirectiveSection',
    position,
    instructions: '',
    stripped_instructions: '',
    likert_type: '',
    variations: [],
    ux_metric: { id: metricId, metric_type: metricType },
  });

  it('gives each instance of a repeated type its own block', () => {
    const blocks = buildOrderBlocks([
      metricSection('s1', 1, 10, 'expectations'),
      metricSection('s2', 2, 10, 'expectations'),
      metricSection('s3', 3, 11, 'expectations'),
      metricSection('s4', 4, 11, 'expectations'),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.question_count)).toEqual([2, 2]);
    expect(blocks.map(b => b.label)).toEqual([
      'expectations metric #1 (2 questions)',
      'expectations metric #2 (2 questions)',
    ]);
  });

  it('flags repeated types as ambiguous, since reorder needs metric:<uuid>', () => {
    const blocks = buildOrderBlocks([
      metricSection('s1', 1, 10, 'expectations'),
      metricSection('s2', 2, 11, 'expectations'),
      metricSection('s3', 3, 12, 'sentiment'),
    ]);
    expect(blocks.map(b => b.ambiguous)).toEqual([true, true, undefined]);
    expect(blocks.map(b => b.metric_type)).toEqual(['expectations', 'expectations', 'sentiment']);
  });

  it('leaves a type that appears once unambiguous and unnumbered', () => {
    const blocks = buildOrderBlocks([
      metricSection('s1', 1, 10, 'sentiment'),
      metricSection('s2', 2, 11, 'loyalty'),
    ]);
    expect(blocks.map(b => b.ambiguous)).toEqual([undefined, undefined]);
    expect(blocks.map(b => b.key)).toEqual(['metric:sentiment', 'metric:loyalty']);
    expect(blocks[0].label).toBe('sentiment metric (1 question)');
  });

  it('falls back to collapsing by type when a payload omits the metric id', () => {
    const blocks = buildOrderBlocks([
      { ...metricSection('s1', 1, 0, 'sentiment'), ux_metric: { metric_type: 'sentiment' } },
      { ...metricSection('s2', 2, 0, 'sentiment'), ux_metric: { metric_type: 'sentiment' } },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].ambiguous).toBeUndefined();
  });
});

// ─── Branch target numbering ─────────────────────────────────────────────────
// Two numbering systems: everything the CLI prints counts ALL sections, while a
// branch's `question` counts researcher questions only. Resolving the branch's
// section_id against the CLI's own listing sidesteps the mismatch.

describe('buildQuestionNumberIndex / buildBranchingSummary', () => {
  const metric = (id: string, position: number): SectionData => ({
    id, type: 'LikertDirectiveSection', position,
    instructions: '', stripped_instructions: '', likert_type: '',
    variations: [], ux_metric: { id: 10, metric_type: 'sentiment' },
  });
  const question = (id: string, position: number, extra: Record<string, unknown> = {}): SectionData => ({
    id, type: 'MultipleChoiceDirectiveSection', position,
    instructions: '', stripped_instructions: `Q@${position}`, likert_type: '',
    variations: [], ...extra,
  });

  // Metric at pos 1 means the API calls the free_response "question 2" while
  // the CLI lists it as Q3 — the drift this index exists to absorb.
  const sections: SectionData[] = [
    metric('11', 1),
    question('22', 2, {
      branching: [
        { source: 'choice', index: 0, label: 'Yes', action: 'skip_to_question', question: 2, section_id: 33, message: null, redirect_url: null },
        { source: 'choice', index: 1, label: 'No', action: 'end_test', question: null, section_id: null, message: 'Not a fit', redirect_url: null },
      ],
    }),
    question('33', 3),
  ];

  it('numbers every section, metric sections included', () => {
    expect([...buildQuestionNumberIndex(sections).entries()]).toEqual([[11, 1], [22, 2], [33, 3]]);
  });

  it('resolves a branch target into the CLI listing, not the API question space', () => {
    const [skip] = buildBranchingSummary(sections) as any[];
    // The API says question 2; the section it names is the CLI's Q3.
    expect(skip.question).toBe(2);
    expect(skip.target_question_number).toBe(3);
    expect(skip.from_question_number).toBe(2);
    expect(skip.from_section_id).toBe('22');
  });

  it('leaves target_question_number null for end_test', () => {
    const [, end] = buildBranchingSummary(sections) as any[];
    expect(end.action).toBe('end_test');
    expect(end.target_question_number).toBeNull();
  });

  it('returns null rather than a wrong number when the target is absent', () => {
    const orphan = [question('22', 1, {
      branching: [{ source: 'choice', index: 0, label: 'Y', action: 'skip_to_question', question: 9, section_id: 999, message: null, redirect_url: null }],
    })];
    expect((buildBranchingSummary(orphan) as any[])[0].target_question_number).toBeNull();
  });

  it('handles an empty section list', () => {
    expect(buildQuestionNumberIndex(undefined).size).toBe(0);
    expect(buildBranchingSummary(undefined)).toEqual([]);
  });
});
