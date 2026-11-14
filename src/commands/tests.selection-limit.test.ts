import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import {
  registerTestsCommand,
  validateQuestions,
  sectionSelection,
  buildQuestionsFromSections,
  buildWalkthroughScreens,
  renderWalkthroughScreen,
  type SectionData,
  type TestShowResponse,
} from './tests.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// "Select up to N" on a multiple choice question is the editor's Selection
// Limit: enable_selection_limit true + choice_selection_limit N. The API had
// no write key for it, so allow_multiple always meant "no limit" and whatever
// a session sent (choice_selection_limit, max_selections) was dropped without
// an error (ZURB-4589). It is now selection_limit: N, with allow_multiple:
// true, from 2 to the number of choices.

const mc = (extra: Record<string, unknown> = {}) => [
  { type: 'multiple_choice', instructions: 'Pick', choices: ['A', 'B', 'C', 'D'], ...extra },
];
const fields = (errors: { field: string }[]) => errors.map(e => e.field);

describe('validateQuestions selection_limit', () => {
  it('accepts a limit between 2 and the number of choices on a multi-select question', () => {
    expect(validateQuestions(mc({ allow_multiple: true, selection_limit: 2 }))).toEqual([]);
    expect(validateQuestions(mc({ allow_multiple: true, selection_limit: 4 }))).toEqual([]);
  });

  it('rejects a limit without allow_multiple', () => {
    const errors = validateQuestions(mc({ selection_limit: 2 }));
    expect(fields(errors)).toEqual(['selection_limit']);
    expect(errors[0].message).toContain('allow_multiple');
  });

  it('rejects a limit outside 2..choices', () => {
    expect(fields(validateQuestions(mc({ allow_multiple: true, selection_limit: 1 })))).toEqual(['selection_limit']);
    const tooMany = validateQuestions(mc({ allow_multiple: true, selection_limit: 5 }));
    expect(tooMany[0].message).toContain('(4)');
  });

  it('rejects a non-integer limit', () => {
    expect(fields(validateQuestions(mc({ allow_multiple: true, selection_limit: '2' })))).toEqual(['selection_limit']);
    expect(fields(validateQuestions(mc({ allow_multiple: true, selection_limit: 2.5 })))).toEqual(['selection_limit']);
  });

  it('rejects a limit on any other type', () => {
    const errors = validateQuestions([{ type: 'ranking', instructions: 'Rank', choices: ['A', 'B', 'C'], selection_limit: 2 }]);
    expect(fields(errors)).toEqual(['selection_limit']);
  });

  it('names the read-only spellings an agent tries, which the API drops', () => {
    for (const key of ['choice_selection_limit', 'max_selections']) {
      const errors = validateQuestions(mc({ allow_multiple: true, [key]: 2 }));
      expect(fields(errors)).toEqual([key]);
      expect(errors[0].message).toContain('selection_limit');
    }
  });

  it('counts the choices as sent, the way the API does', () => {
    // Helio checks choices.length, so choices that differ only in case or
    // spacing still count. Rejecting them here would block a valid request.
    expect(
      validateQuestions([
        { type: 'multiple_choice', instructions: 'Pick', choices: ['a', 'A', 'b'], allow_multiple: true, selection_limit: 3 },
      ]),
    ).toEqual([]);
    const errors = validateQuestions([
      { type: 'multiple_choice', instructions: 'Pick', choices: ['a', 'A', 'b'], allow_multiple: true, selection_limit: 4 },
    ]);
    expect(fields(errors)).toEqual(['selection_limit']);
    expect(errors[0].message).toContain('number of choices (3)');
  });

  it('treats null as no limit', () => {
    expect(validateQuestions(mc({ allow_multiple: true, selection_limit: null }))).toEqual([]);
  });
});

const section = (extra: Record<string, unknown>): SectionData =>
  ({
    id: '11',
    type: 'MultipleChoiceSection',
    position: 0,
    instructions: 'Pick',
    stripped_instructions: 'Pick',
    likert_type: '',
    variations: [{ id: 'v', name: 'V', type: 'MultipleChoiceVariation', choices: ['A', 'B', 'C', 'D'].map((text, position) => ({ id: text, text, position })) }],
    ...extra,
  }) as unknown as SectionData;

describe('sectionSelection (read-back from GET /tests/:id columns)', () => {
  it('reads a single-select question', () => {
    expect(sectionSelection(section({ enable_selection_limit: true, choice_selection_limit: 1 }))).toEqual({ allow_multiple: false, selection_limit: null });
  });

  it('reads "no limit"', () => {
    expect(sectionSelection(section({ enable_selection_limit: false, choice_selection_limit: 4 }))).toEqual({ allow_multiple: true, selection_limit: null });
  });

  it('reads "select up to N"', () => {
    expect(sectionSelection(section({ enable_selection_limit: true, choice_selection_limit: 3 }))).toEqual({ allow_multiple: true, selection_limit: 3 });
  });

  it('is null on other types', () => {
    expect(sectionSelection(section({ type: 'NpsSection' }))).toBeNull();
  });
});

describe('preview JSON and walkthrough', () => {
  it('emits allow_multiple and selection_limit as write keys', () => {
    const [q] = buildQuestionsFromSections([section({ enable_selection_limit: true, choice_selection_limit: 3 })]) as Record<string, unknown>[];
    expect(q).toMatchObject({ allow_multiple: true, selection_limit: 3 });
    const [single] = buildQuestionsFromSections([section({ enable_selection_limit: true, choice_selection_limit: 1 })]) as Record<string, unknown>[];
    expect(single.allow_multiple).toBe(false);
    expect(single).not.toHaveProperty('selection_limit');
  });

  it('renders the limit on the walkthrough screen', () => {
    const test = { introduction: '', sections: [section({ enable_selection_limit: true, choice_selection_limit: 2 })] } as unknown as TestShowResponse;
    const [screen] = buildWalkthroughScreens(test);
    expect(screen).toMatchObject({ allow_multiple: true, selection_limit: 2 });
    const text = renderWalkthroughScreen(screen).join('\n');
    expect(text).toContain('select up to 2');
    expect(text).toContain('☐');
  });

  it('shows a GET multi-select as multi-select (it used to render as single-select)', () => {
    const test = { introduction: '', sections: [section({ enable_selection_limit: false, choice_selection_limit: 4 })] } as unknown as TestShowResponse;
    const [screen] = buildWalkthroughScreens(test);
    expect(screen).toMatchObject({ allow_multiple: true });
  });
});

let requests: { url: string; method: string; body: Record<string, unknown> | null }[];
let logged: string[];
let reply: Record<string, unknown>;

beforeEach(() => {
  requests = [];
  logged = [];
  reply = { section_id: 's-1', test_id: 't-1', selection_limit: 2 };
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const isReport = String(url).includes('/report');
    return new Response(JSON.stringify(isReport ? { error: 'not found' } : reply), {
      status: isReport ? 404 : 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
  vi.spyOn(console, 'log').mockImplementation((msg: unknown = '') => {
    logged.push(String(msg));
  });
});

afterEach(() => {
  delete process.env.__HELIO_OUTPUT;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run(...args: string[]): Promise<void> {
  const program = new Command().option('--api-id <id>').option('--api-token <token>').option('--base-url <url>');
  registerTestsCommand(program);
  await program.parseAsync(['--api-id', 'id-1', '--api-token', 'tok-1', '--base-url', 'https://my.helio.app', ...args], { from: 'user' });
}

describe('--selection-limit', () => {
  it('add-question sends selection_limit as a number', async () => {
    await run('tests', 'add-question', 't-1', '--type', 'multiple_choice', '--instructions', 'Pick',
      '--choices', 'A', 'B', 'C', '--allow-multiple', '--selection-limit', '2');
    expect(requests[0].body).toMatchObject({ allow_multiple: true, selection_limit: 2 });
  });

  it('add-question refuses a limit without --allow-multiple, before any request', async () => {
    await run('tests', 'add-question', 't-1', '--type', 'multiple_choice', '--instructions', 'Pick',
      '--choices', 'A', 'B', 'C', '--selection-limit', '2');
    expect(requests).toHaveLength(0);
    expect(logged.join('\n')).toContain('selection_limit');
  });

  it('edit-question --type sends it', async () => {
    await run('tests', 'edit-question', 't-1', 's-1', '--type', 'multiple_choice', '--instructions', 'Pick',
      '--choices', 'A', 'B', 'C', '--allow-multiple', '--selection-limit', '3');
    expect(requests[0]).toMatchObject({ method: 'PATCH', body: { selection_limit: 3 } });
  });

  it('edit-question without --type rejects it as structural', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run('tests', 'edit-question', 't-1', 's-1', '--selection-limit', '2')).rejects.toThrow();
    expect(requests).toHaveLength(0);
    exit.mockRestore();
  });
});

describe('older Helio that drops selection_limit', () => {
  const addArgs = ['tests', 'add-question', 't-1', '--type', 'multiple_choice', '--instructions', 'Pick',
    '--choices', 'A', 'B', 'C', '--allow-multiple', '--selection-limit', '3'];

  it('add-question is quiet when Helio echoes the limit', async () => {
    reply = { section_id: 's-1', selection_limit: 3 };
    await run(...addArgs);
    expect(logged.join('\n')).not.toContain('ignores selection_limit');
  });

  it('add-question warns when the echo is missing', async () => {
    reply = { section_id: 's-1' };
    await run(...addArgs);
    expect(logged.join('\n')).toMatch(/ignores selection_limit.*not up to 3/);
  });

  it('edit-question puts the warning in JSON output', async () => {
    reply = { section_id: 's-1' };
    process.env.__HELIO_OUTPUT = 'json';
    await run('tests', 'edit-question', 't-1', 's-1', '--type', 'multiple_choice', '--instructions', 'Pick',
      '--choices', 'A', 'B', 'C', '--allow-multiple', '--selection-limit', '2');
    expect(JSON.parse(logged.join('\n')).warnings).toHaveLength(1);
  });

  it('does not warn when no limit was sent', async () => {
    reply = { section_id: 's-1' };
    await run('tests', 'add-question', 't-1', '--type', 'multiple_choice', '--instructions', 'Pick',
      '--choices', 'A', 'B', '--allow-multiple');
    expect(logged.join('\n')).not.toContain('ignores selection_limit');
  });
});

describe('tests preview text', () => {
  const show = (extra: Record<string, unknown>) => ({
    test: {
      id: 't-1', name: 'N', status: 'draft', introduction: 'Hi',
      sections: [{
        id: 11, type: 'MultipleChoiceSection', position: 0, instructions: 'Pick', stripped_instructions: 'Pick',
        likert_type: '',
        variations: [{ id: 'v', name: 'V', type: 'MultipleChoiceVariation', choices: ['A', 'B', 'C', 'D'].map((text, position) => ({ id: text, text, position })) }],
        ...extra,
      }],
    },
  });

  it('prints "select up to N" for a limited multi-select question', async () => {
    reply = show({ enable_selection_limit: true, choice_selection_limit: 3 });
    await run('tests', 'preview', 't-1');
    expect(logged.some(l => l.includes('select up to 3'))).toBe(true);
  });

  it('prints "select any number" when there is no limit', async () => {
    reply = show({ enable_selection_limit: false, choice_selection_limit: 4 });
    await run('tests', 'preview', 't-1');
    expect(logged.some(l => l.includes('select any number'))).toBe(true);
  });

  it('prints neither for single select', async () => {
    reply = show({ enable_selection_limit: true, choice_selection_limit: 1 });
    await run('tests', 'preview', 't-1');
    expect(logged.some(l => /select up to|select any number/.test(l))).toBe(false);
  });
});
