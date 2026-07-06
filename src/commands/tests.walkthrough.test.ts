import { describe, it, expect } from 'vitest';
import {
  buildWalkthroughScreens,
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
      variations: [],
    },
    {
      id: 'sec-fr',
      type: 'FreeResponseDirectiveSection',
      position: 4,
      instructions: '<p>What would you improve?</p>',
      stripped_instructions: '',
      likert_type: '',
      variations: [],
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

  it('question screens expose the agent-facing field set', () => {
    expect(Object.keys(json[2]).sort()).toEqual([
      'allow_multiple', 'choices', 'kind', 'position', 'q_number',
      'question', 'randomize_choices', 'raw_type', 'renderable',
      'scale_type', 'type', 'type_label', 'ux_metric',
    ]);
  });
});
