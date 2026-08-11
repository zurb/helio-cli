import { describe, it, expect } from 'vitest';
import { buildAudienceListParams, prepareAudienceRows } from './audiences.js';

// ─── buildAudienceListParams ─────────────────────────────────────────────────
// GET /audiences takes source=customer_list (default) | enroll. The ids each
// source returns are exactly what --audiences accepts on create/update.

describe('buildAudienceListParams', () => {
  it('omits source when not passed, keeping older APIs working', () => {
    expect(buildAudienceListParams({})).toEqual({});
  });

  it('passes source=enroll through', () => {
    expect(buildAudienceListParams({ source: 'enroll' })).toEqual({ source: 'enroll' });
  });

  it('rejects unknown sources and names the valid ones', () => {
    expect(() => buildAudienceListParams({ source: 'all' })).toThrow(/customer_list, enroll/);
  });

  it('rejects --recent with source=enroll (recently_used is customer-list only)', () => {
    expect(() => buildAudienceListParams({ recent: true, source: 'enroll' })).toThrow(/--recent/);
  });

  it('keeps --recent working for the default source', () => {
    expect(buildAudienceListParams({ recent: true })).toEqual({ sort: 'recently_used' });
    expect(buildAudienceListParams({ recent: true, source: 'customer_list' })).toEqual({
      sort: 'recently_used',
      source: 'customer_list',
    });
  });

  it('carries page and name filters for both sources', () => {
    expect(buildAudienceListParams({ page: '2', name: 'design', source: 'enroll' })).toEqual({
      page: '2',
      name: 'design',
      source: 'enroll',
    });
  });
});

// ─── prepareAudienceRows ─────────────────────────────────────────────────────
// Enroll rows return participants_count / tests_count / last_used_at as null —
// "—" in the table, never 0, which would read as a real count.

describe('prepareAudienceRows', () => {
  it('renders null usage columns as em-dashes', () => {
    const rows = prepareAudienceRows([
      { id: '01J8ENROLL', name: 'US Designers', source: 'enroll', participants_count: null, tests_count: null, last_used_at: null },
    ]);
    expect(rows[0]).toMatchObject({ participants_count: '—', tests_count: '—', last_used_at: '—' });
  });

  it('leaves real values (including zero) alone', () => {
    const rows = prepareAudienceRows([
      { id: '01J8LIST', name: 'Beta users', source: 'customer_list', participants_count: 0, tests_count: 3, last_used_at: '2026-08-01' },
    ]);
    expect(rows[0]).toMatchObject({ participants_count: 0, tests_count: 3, last_used_at: '2026-08-01' });
  });
});
