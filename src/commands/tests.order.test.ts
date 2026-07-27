import { describe, it, expect } from 'vitest';
import { buildOrderBlocks, buildWalkthroughScreens, type SectionData, type TestShowResponse } from './tests.js';

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
