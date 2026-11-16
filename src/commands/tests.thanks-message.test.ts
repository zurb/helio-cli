import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTestsCommand, customThanksMessage, stripHtml, type TestShowResponse } from './tests.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// The end-of-test thank-you message (thanks_message) was read back by
// GET /tests/:id but never written by POST /tests or PATCH /tests/:id, and the
// CLI had no flag for it, so a session asking for one got a 200 and the
// default message (ZURB-4588). Since the API fix both writes take it.

let logged: string[];
let requests: { url: string; method: string; body: Record<string, unknown> | null }[];
let responseBody: Record<string, unknown>;

beforeEach(() => {
  logged = [];
  requests = [];
  responseBody = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const isReport = String(url).includes('/report');
    return new Response(JSON.stringify(isReport ? { error: 'not found' } : responseBody), {
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
  const program = new Command()
    .option('--api-id <id>')
    .option('--api-token <token>')
    .option('--base-url <url>');
  registerTestsCommand(program);
  await program.parseAsync(
    ['--api-id', 'id-1', '--api-token', 'tok-1', '--base-url', 'https://my.helio.app', ...args],
    { from: 'user' },
  );
}

const writes = () => requests.filter(r => r.method !== 'GET');

const createArgs = [
  'tests', 'create', '--project-id', 'proj-1', '--name', 'N', '--intro', 'Hi',
  '--target-audience-size', '10', '--questions', '[{"type":"free_response","instructions":"Why?"}]',
];

describe('customThanksMessage', () => {
  const base = { introduction: 'Hi', sections: [] } as unknown as TestShowResponse;

  it('returns the message when the toggle is on', () => {
    expect(customThanksMessage({ ...base, has_thanks_message: true, thanks_message: 'Thanks, team!' })).toBe('Thanks, team!');
  });

  it('strips the auto-link markup GET adds', () => {
    const linked = 'See <a href="https://x.co" target="_blank">x.co</a> for more';
    expect(customThanksMessage({ ...base, has_thanks_message: true, thanks_message: linked })).toBe('See x.co for more');
  });

  it('keeps text that only looks like a tag, and decodes entities', () => {
    expect(customThanksMessage({ ...base, has_thanks_message: true, thanks_message: '<p>We <3 you &amp; your team > all</p>' }))
      .toBe('We <3 you & your team > all');
  });

  it('is null when the toggle is off, even if text is stored', () => {
    expect(customThanksMessage({ ...base, has_thanks_message: false, thanks_message: 'Old text' })).toBeNull();
    expect(customThanksMessage(base)).toBeNull();
  });
});

describe('tests create --thanks-message', () => {

  it('sends thanks_message in the create body', async () => {
    responseBody = { test_id: 't-1', thanks_message: 'Thanks for your time' };
    await run(...createArgs, '--thanks-message', 'Thanks for your time');
    expect(writes()[0].body?.thanks_message).toBe('Thanks for your time');
  });

  it('leaves it out when the flag is not given', async () => {
    responseBody = { test_id: 't-1' };
    await run(...createArgs);
    expect(writes()[0].body).not.toHaveProperty('thanks_message');
  });

  it('adds no warnings to the JSON output', async () => {
    responseBody = { test_id: 't-1' };
    process.env.__HELIO_OUTPUT = 'json';
    await run(...createArgs, '--thanks-message', 'Thanks');
    expect(JSON.parse(logged.join('\n')).warnings).toBeUndefined();
  });

  it('shows it in --dry-run', async () => {
    process.env.__HELIO_OUTPUT = 'json';
    await run(...createArgs, '--thanks-message', 'Thanks', '--dry-run');
    expect(JSON.parse(logged.join('\n')).thanks_message).toBe('Thanks');
    expect(writes()).toHaveLength(0);
  });
});

describe('stripHtml', () => {
  it('removes real tags only', () => {
    expect(stripHtml('<p>a</p><br/>b')).toBe('ab');
    expect(stripHtml('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2');
    expect(stripHtml('Q&amp;A &lt;beta&gt; &#39;now&#39;')).toBe("Q&A <beta> 'now'");
  });

  it('decodes entities once, so an escaped entity stays literal', () => {
    expect(stripHtml('&amp;#65; &amp;lt;')).toBe('&#65; &lt;');
  });

  it('decodes code points above U+FFFF instead of wrapping them', () => {
    expect(stripHtml('&#128512;')).toBe('\u{1F600}');
    // fromCharCode(65563) wrapped to 27, a real ESC.
    expect(stripHtml('a&#65563;b')).toBe('a\u{1001B}b');
    expect(stripHtml('a&#1114112;b&#55296;c')).toBe('a\uFFFDb\uFFFDc');
  });

  it('drops control characters that would act on the terminal', () => {
    expect(stripHtml('&#27;[31mred&#27;[0m')).toBe('[31mred[0m');
    expect(stripHtml('ding&#7; &#127;&#133;&#159;done')).toBe('ding done');
    expect(stripHtml('raw\x1b[2Jclear\x00\r')).toBe('raw[2Jclear');
  });

  it('keeps tabs and newlines', () => {
    expect(stripHtml('a&#9;b&#10;c\td\ne')).toBe('a\tb\nc\td\ne');
  });
});

describe('--thanks-message "" (reset to the default)', () => {
  it('update sends it on its own instead of failing "at least one field"', async () => {
    responseBody = { test_id: 't-1', thanks_message: null };
    await run('tests', 'update', 't-1', '--thanks-message', '');
    expect(writes()[0]).toMatchObject({ method: 'PATCH', body: { thanks_message: '' } });
  });

  it('update sends it alongside other fields', async () => {
    responseBody = { test_id: 't-1', name: 'X', thanks_message: null };
    await run('tests', 'update', 't-1', '--name', 'X', '--thanks-message', '');
    expect(writes()[0].body).toEqual({ name: 'X', thanks_message: '' });
  });

  it('update still refuses it with --clear-thanks-message', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run('tests', 'update', 't-1', '--thanks-message', '', '--clear-thanks-message')).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    exit.mockRestore();
  });

  it('create sends it', async () => {
    responseBody = { test_id: 't-1' };
    await run(...createArgs, '--thanks-message', '');
    expect(writes()[0].body).toMatchObject({ thanks_message: '' });
  });

  it('create --dry-run shows it as the default', async () => {
    await run(...createArgs, '--thanks-message', '', '--dry-run');
    expect(logged.some(l => l.includes('Thanks:') && l.includes('(Helio default)'))).toBe(true);
  });
});

describe('tests update --thanks-message / --clear-thanks-message', () => {
  it('sends the message', async () => {
    responseBody = { test_id: 't-1', thanks_message: 'Bye' };
    await run('tests', 'update', 't-1', '--thanks-message', 'Bye');
    expect(writes()[0]).toMatchObject({ method: 'PATCH', body: { thanks_message: 'Bye' } });
  });

  it('sends null to go back to the default', async () => {
    responseBody = { test_id: 't-1', thanks_message: null };
    await run('tests', 'update', 't-1', '--clear-thanks-message');
    expect(writes()[0].body).toEqual({ thanks_message: null });
  });

  it('rejects both flags together before any request', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run('tests', 'update', 't-1', '--thanks-message', 'Bye', '--clear-thanks-message')).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    exit.mockRestore();
  });
});

describe('tests preview thank-you message', () => {
  const show = (extra: Record<string, unknown>) => ({
    test: { id: 't-1', name: 'N', status: 'draft', introduction: 'Hi', sections: [], ...extra },
  });

  it('prints a custom message under the intro', async () => {
    responseBody = show({ has_thanks_message: true, thanks_message: 'Thanks, team!' });
    await run('tests', 'preview', 't-1');
    expect(logged).toContain('Thanks: Thanks, team!');
  });

  it('prints nothing for the default message', async () => {
    responseBody = show({ has_thanks_message: false, thanks_message: null });
    await run('tests', 'preview', 't-1');
    expect(logged.some(l => l.startsWith('Thanks:'))).toBe(false);
  });

  it('carries it in the JSON test block, null for the default', async () => {
    process.env.__HELIO_OUTPUT = 'json';
    responseBody = show({ has_thanks_message: true, thanks_message: 'Thanks, team!' });
    await run('tests', 'preview', 't-1');
    expect(JSON.parse(logged.join('\n')).test.thanks_message).toBe('Thanks, team!');

    logged = [];
    responseBody = show({ has_thanks_message: false });
    await run('tests', 'preview', 't-1');
    expect(JSON.parse(logged.join('\n')).test.thanks_message).toBeNull();
  });
});
