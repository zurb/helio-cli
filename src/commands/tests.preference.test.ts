import { describe, it, expect } from 'vitest';
import { preferenceOptions, buildQuestionsFromSections, type SectionData } from './tests.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────
// A preference question's options are PreferenceVariation records — one
// full-size image each — NOT Choice records hanging off variations[0] the way
// every other type's options are. GET /tests/:id has always read them back
// under `variations`, and since the 2026-08-23 API release that is also the
// key a write takes. Reading them as choices produced an empty option list on
// every render path and a payload that could not be sent back.

const variation = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `v-${name}`,
  name,
  type: 'PreferenceVariation',
  choices: [],
  ...extra,
});

const section = (type: string, variations: Record<string, unknown>[]): SectionData =>
  ({
    id: 'sec-1',
    type,
    position: 0,
    instructions: '<p>Which do you prefer?</p>',
    stripped_instructions: 'Which do you prefer?',
    likert_type: '',
    variations,
  }) as unknown as SectionData;

// ─── preferenceOptions ───────────────────────────────────────────────────────

describe('preferenceOptions', () => {
  it('returns null for every non-preference section, so callers keep the choice path', () => {
    expect(preferenceOptions(section('MultipleChoiceDirectiveSection', [variation('V1')]))).toBeNull();
    expect(preferenceOptions(section('LikertDirectiveSection', [variation('V1')]))).toBeNull();
  });

  it('reads the options off the variations of a preference section', () => {
    const options = preferenceOptions(
      section('PreferenceDirectiveSection', [
        variation('Data In', { asset_id: 61016, has_asset: true }),
        variation('The Vertical', { asset_id: 61017, has_asset: true, site_link: 'https://example.com' }),
      ]),
    );
    expect(options).toEqual([
      { name: 'Data In', asset_id: 61016, has_asset: true, site_link: null },
      { name: 'The Vertical', asset_id: 61017, has_asset: true, site_link: 'https://example.com' },
    ]);
  });

  it('recognises the report vocabulary as well as the section vocabulary', () => {
    expect(preferenceOptions(section('preference', [variation('A'), variation('B')]))).toHaveLength(2);
  });

  it('reports an option with no image, which is a launch blocker', () => {
    const options = preferenceOptions(
      section('PreferenceDirectiveSection', [
        variation('Data In', { asset_id: 61016 }),
        variation('The Vertical', { asset_id: null }),
      ]),
    );
    expect(options?.map(o => o.has_asset)).toEqual([true, false]);
    expect(options?.[1].asset_id).toBeNull();
  });

  it('accepts any of the signals a payload uses to say an image is attached', () => {
    const options = preferenceOptions(
      section('PreferenceDirectiveSection', [
        variation('by has_asset', { has_asset: true }),
        variation('by screenshot_url', { screenshot_url: 'https://cdn.example/a.png' }),
        variation('by thumb_url', { thumb_url: 'https://cdn.example/a-thumb.png' }),
      ]),
    );
    expect(options?.every(o => o.has_asset)).toBe(true);
  });

  it('handles a section with no variations at all', () => {
    expect(preferenceOptions(section('PreferenceDirectiveSection', []))).toEqual([]);
  });
});

// ─── buildQuestionsFromSections ──────────────────────────────────────────────
// This is the draft-preview path agents read. Emitting a preference question's
// options under `variations` is what makes the output feedable back into a
// write; `choices: []` was both wrong and unusable.

describe('buildQuestionsFromSections — preference', () => {
  it('emits variations instead of an empty choices list', () => {
    const [question] = buildQuestionsFromSections([
      section('PreferenceDirectiveSection', [
        variation('Data In', { asset_id: 61016, has_asset: true }),
        variation('The Vertical', { asset_id: 61017, has_asset: true }),
      ]),
    ]) as Record<string, unknown>[];

    expect(question).not.toHaveProperty('choices');
    expect(question.variations).toEqual([
      { name: 'Data In', asset_id: 61016, has_asset: true, site_link: null },
      { name: 'The Vertical', asset_id: 61017, has_asset: true, site_link: null },
    ]);
  });

  it('leaves every other type on the choices key', () => {
    const [question] = buildQuestionsFromSections([
      section('MultipleChoiceDirectiveSection', [
        { id: 'v1', name: 'V1', type: 'MultipleChoiceDirectiveSection', choices: [{ id: 'c1', text: 'Yes', position: 1 }] },
      ]),
    ]) as Record<string, unknown>[];

    expect(question).not.toHaveProperty('variations');
    expect(question.choices).toEqual(['Yes']);
  });
});
