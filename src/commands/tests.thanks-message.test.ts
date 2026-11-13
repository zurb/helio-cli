import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTestsCommand, customThanksMessage, thanksMessageDropWarning, type TestShowResponse } from './tests.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// The end-of-test thank-you message (thanks_message) was read back by
// GET /tests/:id but never written by POST /tests or PATCH /tests/:id, and the
// CLI had no flag for it, so a session asking for one got a 200 and the
// default message (ZURB-4588). Since the API fix both writes take it, and
// both responses echo it back, which is how the CLI tells an older API that
// dropped it.

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

describe('customThanksMessage', () => {
  const base = { introduction: 'Hi', sections: [] } as unknown as TestShowResponse;

  it('returns the message when the toggle is on', () => {
    expect(customThanksMessage({ ...base, has_thanks_message: true, thanks_message: 'Thanks, team!' })).toBe('Thanks, team!');
  });

  it('strips the auto-link markup GET adds', () => {
    const linked = 'See <a href="https://x.co" target="_blank">x.co</a> for more';
    expect(customThanksMessage({ ...base, has_thanks_message: true, thanks_message: linked })).toBe('See x.co for more');
  });

  it('is null when the toggle is off, even if text is stored', () => {
    expect(customThanksMessage({ ...base, has_thanks_message: false, thanks_message: 'Old text' })).toBeNull();
    expect(customThanksMessage(base)).toBeNull();
  });
});

describe('thanksMessageDropWarning', () => {
  it('is quiet when nothing was sent', () => {
    expect(thanksMessageDropWarning(false, {})).toBeNull();
  });

  it('is quiet when the response echoes the field, null included', () => {
    expect(thanksMessageDropWarning(true, { thanks_message: 'Thanks' })).toBeNull();
    expect(thanksMessageDropWarning(true, { thanks_message: null })).toBeNull();
  });

  it('warns when an older API leaves it out', () => {
    expect(thanksMessageDropWarning(true, { test_id: 't' })).toContain('ignores thanks_message');
  });
});

describe('tests create --thanks-message', () => {
  const createArgs = [
    'tests', 'create', '--project-id', 'proj-1', '--name', 'N', '--intro', 'Hi',
    '--target-audience-size', '10', '--questions', '[{"type":"free_response","instructions":"Why?"}]',
  ];

  it('sends thanks_message in the create body', async () => {
    responseBody = { test_id: 't-1', thanks_message: 'Thanks for your time' };
    await run(...createArgs, '--thanks-message', 'Thanks for your time');
    expect(writes()[0].body?.thanks_message).toBe('Thanks for your time');
    expect(logged.some(l => l.includes('ignores thanks_message'))).toBe(false);
  });

  it('leaves it out when the flag is not given', async () => {
    responseBody = { test_id: 't-1' };
    await run(...createArgs);
    expect(writes()[0].body).not.toHaveProperty('thanks_message');
    expect(logged.some(l => l.includes('ignores thanks_message'))).toBe(false);
  });

  it('warns when an older API drops it', async () => {
    responseBody = { test_id: 't-1' };
    process.env.__HELIO_OUTPUT = 'json';
    await run(...createArgs, '--thanks-message', 'Thanks');
    const out = JSON.parse(logged.join('\n'));
    expect(out.warnings.some((w: string) => w.includes('ignores thanks_message'))).toBe(true);
  });

  it('shows it in --dry-run', async () => {
    process.env.__HELIO_OUTPUT = 'json';
    await run(...createArgs, '--thanks-message', 'Thanks', '--dry-run');
    expect(JSON.parse(logged.join('\n')).thanks_message).toBe('Thanks');
    expect(writes()).toHaveLength(0);
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
    expect(logged.some(l => l.includes('ignores thanks_message'))).toBe(false);
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

  it('warns when an older API drops it', async () => {
    responseBody = { test_id: 't-1', name: 'N' };
    await run('tests', 'update', 't-1', '--thanks-message', 'Bye');
    expect(logged.some(l => l.includes('ignores thanks_message'))).toBe(true);
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
