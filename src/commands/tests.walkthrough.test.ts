import { describe, it, expect } from 'vitest';
import {
  buildWalkthroughScreens,
  resolveTestMeta,
  walkthroughScreenJson,
  type TestShowResponse,
} from './tests.js';

// ─── Fixture ─────────────────────────────────────────────────────────────────
// A draft test with an HTML intro and four sections deliberately out of order,
// covering: multiple choice (flags + choice-position sorting), likert with a
// UX metric, an asset-heavy click test (placeholder), and free response.

const choice = (id: string, text: string, position: number) => ({ id, text, position });

const fixture: TestShowResponse = {
  id: 'test-1',
  name: 'Homepage V2 eval',
  status: 'draft',
  responses_count: 0,
  project_id: 'proj-1',
  project_name: 'Homepage',
  introduction: '<p>Welcome to our <strong>test</strong>!</p>',
  sections: [
    {
      id: 'sec-likert',
      type: 'LikertDirectiveSection',
      position: 2,
      instructions: '<p>How well do you understand the offering?</p>',
      stripped_instructions: 'How well do you understand the offering?',
      likert_type: 'comprehension',
      ux_metric: { metric_type: 'comprehension' },
      variations: [
        {
          id: 'v-likert', name: 'V1', type: 'LikertDirectiveSection',
          site_link: 'https://example.com/landing',
          choices: [
            choice('c1', 'Not at all', 1),
            choice('c2', 'Slightly', 2),
            choice('c3', 'Mostly', 3),
            choice('c4', 'Completely', 4),
          ],
        },
      ],
    },
    {
      id: 'sec-mc',
      type: 'MultipleChoiceDirectiveSection',
      position: 1,
      instructions: '<p>How does this page feel?</p>',
      stripped_instructions: 'How does this page feel?',
      likert_type: '',
      randomize_choices: true,
      allow_multiple: true,
      variations: [
        {
          id: 'v-mc', name: 'V1', type: 'MultipleChoiceDirectiveSection',
          // choices intentionally out of position order
          choices: [
            choice('c6', 'Confusing', 3),
            choice('c4', 'Helpful', 1),
            choice('c5', 'Clear', 2),
          ],
        },
      ],
    },
    {
      id: 'sec-click',
      type: 'ClickTestDirectiveSection',
      position: 3,
      instructions: '<p>Click where you would go first.</p>',
      stripped_instructions: 'Click where you would go first.',
      likert_type: '',
      variations: [
        {
          id: 'v-click', name: 'Homepage', type: 'ClickVariation',
          choices: [],
          asset_id: 7,
          has_asset: true,
          asset_type: 'image',
          asset_status: 'processing',
          screenshot_url: 'https://cdn.example.com/click-full.png',
          thumb_url: 'https://cdn.example.com/click-thumb.png',
        },
      ],
    },
    {
      id: 'sec-fr',
      type: 'FreeResponseDirectiveSection',
      position: 4,
      instructions: '<p>What would you improve?</p>',
      stripped_instructions: '',
      likert_type: '',
      variations: [
        {
          id: 'v-fr', name: 'Mock', type: 'FreeResponseVariation',
          choices: [],
          asset_id: 42,
          has_asset: true,
          asset_type: 'image',
          asset_status: 'complete',
          screenshot_url: 'https://cdn.example.com/fr-full.png',
          thumb_url: 'https://cdn.example.com/fr-thumb.png',
        },
      ],
    },
  ],
};

// ─── buildWalkthroughScreens ─────────────────────────────────────────────────

describe('buildWalkthroughScreens', () => {
  const screens = buildWalkthroughScreens(fixture);

  it('leads with a stripped-HTML intro screen', () => {
    expect(screens[0]).toEqual({ kind: 'intro', position: 1, text: 'Welcome to our test!' });
  });

  it('produces one question screen per section, ordered by section position', () => {
    expect(screens).toHaveLength(5);
    const types = screens.slice(1).map(s => (s.kind === 'question' ? s.type : ''));
    expect(types).toEqual(['multiple_choice', 'likert', 'click_test', 'free_response']);
  });

  it('numbers questions sequentially and positions continuously after the intro', () => {
    const qs = screens.filter(s => s.kind === 'question');
    expect(qs.map(s => (s.kind === 'question' ? s.q_number : 0))).toEqual([1, 2, 3, 4]);
    expect(screens.map(s => s.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('sorts choices by their position field, not array order', () => {
    const mc = screens[1];
    expect(mc.kind).toBe('question');
    if (mc.kind === 'question') {
      expect(mc.choices).toEqual(['Helpful', 'Clear', 'Confusing']);
      expect(mc.randomize_choices).toBe(true);
      expect(mc.allow_multiple).toBe(true);
    }
  });

  it('carries scale_type and ux_metric on likert sections', () => {
    const likert = screens[2];
    if (likert.kind === 'question') {
      expect(likert.scale_type).toBe('comprehension');
      expect(likert.ux_metric).toBe('comprehension');
      expect(likert.raw_type).toBe('LikertDirectiveSection');
    }
  });

  it('marks asset-heavy sections as placeholder and others as full', () => {
    const renderables = screens.slice(1).map(s => (s.kind === 'question' ? s.renderable : ''));
    expect(renderables).toEqual(['full', 'full', 'placeholder', 'full']);
  });

  it('falls back to stripping instructions HTML when stripped_instructions is empty', () => {
    const fr = screens[4];
    if (fr.kind === 'question') {
      expect(fr.question).toBe('What would you improve?');
    }
  });

  it('omits the intro screen when introduction is empty', () => {
    const noIntro = buildWalkthroughScreens({ ...fixture, introduction: '' });
    expect(noIntro[0].kind).toBe('question');
    expect(noIntro).toHaveLength(4);
    expect(noIntro[0].position).toBe(1);
  });

  it('collects stimulus assets from variations', () => {
    const fr = screens[4];
    expect(fr.kind).toBe('question');
    if (fr.kind === 'question') {
      expect(fr.assets).toEqual([
        {
          variation_id: 'v-fr',
          variation_name: 'Mock',
          asset_id: 42,
          type: 'image',
          status: 'complete',
          url: 'https://cdn.example.com/fr-full.png',
          thumb_url: 'https://cdn.example.com/fr-thumb.png',
        },
      ]);
    }
  });

  it('includes assets on placeholder screens too', () => {
    const click = screens[3];
    if (click.kind === 'question') {
      expect(click.renderable).toBe('placeholder');
      expect(click.assets).toHaveLength(1);
      expect(click.assets[0].url).toBe('https://cdn.example.com/click-full.png');
    }
  });

  it('carries the asset upload status so a processing stimulus is detectable', () => {
    const click = screens[3];
    if (click.kind === 'question') {
      expect(click.assets[0].status).toBe('processing');
    }
    const mcNoAsset = screens[1];
    if (mcNoAsset.kind === 'question') {
      expect(mcNoAsset.assets).toEqual([]);
    }
  });

  it('returns an empty assets array for asset-less screens', () => {
    const mc = screens[1];
    if (mc.kind === 'question') {
      expect(mc.assets).toEqual([]);
    }
  });

  it('carries site_link when the variation has one', () => {
    const likert = screens[2];
    if (likert.kind === 'question') {
      expect(likert.site_link).toBe('https://example.com/landing');
    }
  });

  it('handles a test with no sections', () => {
    const empty = buildWalkthroughScreens({ ...fixture, sections: [] });
    expect(empty).toEqual([{ kind: 'intro', position: 1, text: 'Welcome to our test!' }]);
  });
});

// ─── walkthroughScreenJson (the --output json contract) ─────────────────────

describe('walkthroughScreenJson', () => {
  const screens = buildWalkthroughScreens(fixture);
  const json = screens.map(walkthroughScreenJson);

  it('serializes the full screen list to the stable JSON contract', () => {
    expect(json).toMatchSnapshot();
  });

  it('intro screens carry only position/kind/text', () => {
    expect(Object.keys(json[0]).sort()).toEqual(['kind', 'position', 'text']);
  });

  it('question screens null out missing scale_type and ux_metric', () => {
    const mc = json[1];
    expect(mc.scale_type).toBeNull();
    expect(mc.ux_metric).toBeNull();
  });

  it('question screens carry stimulus assets and null out missing site_link', () => {
    const fr = json[4] as { assets: unknown[]; site_link: unknown };
    expect(fr.assets).toHaveLength(1);
    expect(fr.site_link).toBeNull();
    const likert = json[2] as { site_link: unknown };
    expect(likert.site_link).toBe('https://example.com/landing');
  });

  it('question screens expose the agent-facing field set', () => {
    expect(Object.keys(json[2]).sort()).toEqual([
      'allow_multiple', 'assets', 'choices', 'kind', 'position', 'q_number',
      'question', 'randomize_choices', 'raw_type', 'renderable',
      'scale_type', 'site_link', 'type', 'type_label', 'ux_metric',
    ]);
  });
});

// ─── resolveTestMeta ─────────────────────────────────────────────────────────
// The live tests/:id show response omits id/name/status/responses_count/
// project_name and returns the internal numeric project_id, so header fields
// are backfilled from the report endpoint's study object when available.

describe('resolveTestMeta', () => {
  const study = {
    id: '01TESTULID',
    name: 'Homepage V2 eval',
    status: 'draft',
    total_responses: 12,
    project_id: '01PROJULID',
    project_name: 'Homepage',
    account_id: '01ACCTULID',
    account_name: 'ZURB',
  };

  it('prefers show-response fields when the API provides them', () => {
    const meta = resolveTestMeta('01REQUESTED', fixture, study);
    expect(meta.id).toBe('test-1');
    expect(meta.name).toBe('Homepage V2 eval');
    expect(meta.status).toBe('draft');
    expect(meta.responses_count).toBe(0);
    expect(meta.project_id).toBe('proj-1');
    expect(meta.project_name).toBe('Homepage');
  });

  it('backfills missing fields from the report study object', () => {
    const bare = { sections: [] } as unknown as TestShowResponse;
    const meta = resolveTestMeta('01REQUESTED', bare, study);
    expect(meta).toEqual({
      id: '01TESTULID',
      name: 'Homepage V2 eval',
      status: 'draft',
      responses_count: 12,
      project_id: '01PROJULID',
      project_name: 'Homepage',
      account_id: '01ACCTULID',
      account_name: 'ZURB',
    });
  });

  it('prefers the study project ULID over the internal numeric project_id', () => {
    const bare = { project_id: 55, sections: [] } as unknown as TestShowResponse;
    const meta = resolveTestMeta('01REQUESTED', bare, study);
    expect(meta.project_id).toBe('01PROJULID');
  });

  it('keeps the numeric project_id when no study is available', () => {
    const bare = { project_id: 55, sections: [] } as unknown as TestShowResponse;
    const meta = resolveTestMeta('01REQUESTED', bare, null);
    expect(meta.project_id).toBe(55);
  });

  it('falls back to the requested id and nulls when both sources are empty', () => {
    const bare = { sections: [] } as unknown as TestShowResponse;
    const meta = resolveTestMeta('01REQUESTED', bare, null);
    expect(meta).toEqual({
      id: '01REQUESTED',
      name: null,
      status: null,
      responses_count: null,
      project_id: null,
      project_name: null,
      account_id: null,
      account_name: null,
    });
  });

  it('takes account fields from the show-response account object when study lacks them', () => {
    const bare = { sections: [] } as unknown as TestShowResponse;
    const meta = resolveTestMeta('01REQUESTED', bare, null, { id: 139, name: 'ZURB' });
    expect(meta.account_id).toBe(139);
    expect(meta.account_name).toBe('ZURB');
  });

  it('preserves a zero responses_count from the show response', () => {
    const meta = resolveTestMeta('01REQUESTED', fixture, study);
    expect(meta.responses_count).toBe(0);
  });
});
