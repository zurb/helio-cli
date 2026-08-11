import { describe, it, expect } from 'vitest';
import {
  sectionMetric,
  buildOrderBlocks,
  buildQuestionsFromSections,
  buildWalkthroughScreens,
  buildHotspotSummary,
  uxMetricQuestionLabel,
  type SectionData,
  type TestShowResponse,
  type UxMetricSummaryEntry,
} from './tests.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────
// The 2026-08 API release stamps metric-owned sections with metric_id (uuid)
// + metric_type and REMOVES the nested ux_metric object. Older API versions
// still send the nested object (numeric id). The CLI reads both: stamps
// preferred, nested as fallback.

const section = (id: string, position: number, type: string, extra: Partial<SectionData> = {}) =>
  ({
    id,
    type,
    position,
    instructions: `<p>${id}</p>`,
    stripped_instructions: id,
    likert_type: '',
    ...extra,
  }) as unknown as SectionData;

const stamped = (id: string, position: number, type: string, metricId: string, metricType: string, extra: Partial<SectionData> = {}) =>
  section(id, position, type, { metric_id: metricId, metric_type: metricType, ...extra });

// ─── sectionMetric ───────────────────────────────────────────────────────────

describe('sectionMetric', () => {
  it('reads the new metric_id/metric_type stamps', () => {
    const s = stamped('a', 0, 'LikertDirectiveSection', '01J8METRIC', 'sentiment');
    expect(sectionMetric(s)).toEqual({ id: '01J8METRIC', type: 'sentiment' });
  });

  it('falls back to the legacy nested ux_metric object', () => {
    const s = section('a', 0, 'LikertDirectiveSection', {
      ux_metric: { metric_type: 'sentiment', id: 42 },
    });
    expect(sectionMetric(s)).toEqual({ id: 42, type: 'sentiment' });
  });

  it('prefers stamps when both are present', () => {
    const s = section('a', 0, 'LikertDirectiveSection', {
      metric_id: '01J8METRIC',
      metric_type: 'sentiment',
      ux_metric: { metric_type: 'stale', id: 42 },
    });
    expect(sectionMetric(s)).toEqual({ id: '01J8METRIC', type: 'sentiment' });
  });

  it('returns null for hand-written sections', () => {
    expect(sectionMetric(section('a', 0, 'FreeResponseDirectiveSection'))).toBeNull();
  });
});

// ─── buildOrderBlocks with stamps ────────────────────────────────────────────
// The v0.7.0 gap: repeated metric types were not reorderable from a fresh
// session because GET /tests/:id only had numeric metric ids. With uuid
// stamps, repeated instances get metric:<uuid> keys and stop being ambiguous.

describe('buildOrderBlocks — metric_id stamps', () => {
  it('groups stamped sections into metric blocks like the nested form did', () => {
    const blocks = buildOrderBlocks([
      section('a', 0, 'MultipleChoiceDirectiveSection'),
      stamped('m1', 1, 'LikertDirectiveSection', '01J8METRIC', 'desirability'),
      stamped('m2', 2, 'LikertDirectiveSection', '01J8METRIC', 'desirability'),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      key: 'metric:desirability',
      question_number: 2,
      question_count: 2,
    });
  });

  it('keys repeated metric types on their uuid and drops the ambiguous flag', () => {
    const blocks = buildOrderBlocks([
      stamped('a1', 0, 'MultipleChoiceDirectiveSection', '01J8FIRST', 'sentiment'),
      stamped('a2', 1, 'FreeResponseDirectiveSection', '01J8FIRST', 'sentiment'),
      section('q', 2, 'FreeResponseDirectiveSection'),
      stamped('b1', 3, 'MultipleChoiceDirectiveSection', '01J8SECOND', 'sentiment'),
      stamped('b2', 4, 'FreeResponseDirectiveSection', '01J8SECOND', 'sentiment'),
    ]);

    expect(blocks.map(b => b.key)).toEqual(['metric:01J8FIRST', 'section:q', 'metric:01J8SECOND']);
    expect(blocks.filter(b => b.ambiguous)).toHaveLength(0);
    // Instance labels still tell the two apart for humans.
    expect(blocks[0].label).toMatch(/#1/);
    expect(blocks[2].label).toMatch(/#2/);
  });

  it('still marks repeated types ambiguous when only legacy numeric ids exist', () => {
    const blocks = buildOrderBlocks([
      section('a1', 0, 'MultipleChoiceDirectiveSection', { ux_metric: { metric_type: 'sentiment', id: 1 } }),
      section('b1', 1, 'MultipleChoiceDirectiveSection', { ux_metric: { metric_type: 'sentiment', id: 2 } }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.every(b => b.ambiguous)).toBe(true);
  });
});

// ─── buildQuestionsFromSections carries metric membership ───────────────────
// This is the draft-preview path agents read. Metric-owned questions must be
// distinguishable from hand-written ones or agents edit auto-generated
// sections as if they were theirs.

describe('buildQuestionsFromSections — ux_metric', () => {
  it('tags metric-owned questions with the metric id and type', () => {
    const questions = buildQuestionsFromSections([
      section('q', 0, 'FreeResponseDirectiveSection'),
      stamped('m', 1, 'LikertDirectiveSection', '01J8METRIC', 'satisfaction'),
    ]) as Record<string, unknown>[];

    expect(questions[0]).not.toHaveProperty('ux_metric');
    expect(questions[1].ux_metric).toEqual({ id: '01J8METRIC', type: 'satisfaction' });
  });

  it('tags from the legacy nested object when talking to an older API', () => {
    const questions = buildQuestionsFromSections([
      section('m', 0, 'LikertDirectiveSection', { ux_metric: { metric_type: 'appeal', id: 7 } }),
    ]) as Record<string, unknown>[];
    expect(questions[0].ux_metric).toEqual({ id: 7, type: 'appeal' });
  });
});

// ─── walkthrough + hotspot summaries read stamps ─────────────────────────────

describe('buildWalkthroughScreens — ux_metric from stamps', () => {
  it('carries the metric type on stamped screens', () => {
    const test = {
      introduction: '',
      sections: [stamped('m', 0, 'LikertDirectiveSection', '01J8METRIC', 'sentiment')],
    } as unknown as TestShowResponse;
    const screens = buildWalkthroughScreens(test);
    expect(screens[0]).toMatchObject({ kind: 'question', ux_metric: 'sentiment' });
  });
});

describe('buildHotspotSummary — scores_zero from stamps', () => {
  it('flags a stamped hotspot-scored metric section with no hotspots', () => {
    const summary = buildHotspotSummary([
      stamped('c', 0, 'ClickTestDirectiveSection', '01J8METRIC', 'usability', { hotspots: [] }),
    ]) as { ux_metric: string | null; scores_zero: boolean }[];
    expect(summary[0].ux_metric).toBe('usability');
    expect(summary[0].scores_zero).toBe(true);
  });
});

// ─── uxMetricQuestionLabel ───────────────────────────────────────────────────
// Human-readable question span for the preview UX Metrics block, from the
// top-level summary's spec-pinned 1-based positions.

const summaryEntry = (positions: number[]): UxMetricSummaryEntry => ({
  id: '01J8METRIC',
  metric_type: 'sentiment',
  section_count: positions.length,
  sections: positions.map(position => ({
    section_id: `01J8SEC${position}`,
    type: 'LikertDirective',
    position,
    instructions: 'Q',
  })),
});

describe('uxMetricQuestionLabel', () => {
  it('renders a single question', () => {
    expect(uxMetricQuestionLabel(summaryEntry([5]))).toBe('1 question: Q5');
  });

  it('renders a contiguous range', () => {
    expect(uxMetricQuestionLabel(summaryEntry([3, 4]))).toBe('2 questions: Q3–Q4');
  });

  it('lists non-contiguous questions individually (post-reorder layouts)', () => {
    expect(uxMetricQuestionLabel(summaryEntry([2, 5]))).toBe('2 questions: Q2, Q5');
  });
});
