import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import {
  registerTestsCommand,
  validateUxMetrics,
  regularQuestionNeedsTypeHint,
} from './tests.js';
import { HelioApiError } from '../types.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// "Skip question introduction" (disable_instruction_card) could be set on a
// hand-written question but not on a UX metric section: the API's metric edit
// path and its create-time section overrides never read it, so the CLI
// refused the flag there (ZURB-4590). Helio now accepts it in both places.

let requests: { url: string; method: string; body: Record<string, unknown> | null }[];
let logged: string[];
let reply: { status: number; body: unknown };

beforeEach(() => {
  requests = [];
  logged = [];
  reply = { status: 200, body: { section_id: 's-1', metric_type: 'sentiment', disable_instruction_card: true } };
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
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

function captureErrors() {
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((msg: unknown = '') => {
    errors.push(String(msg));
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
  return errors;
}

describe('edit-question --skip-question-intro without --type', () => {
  it('sends disable_instruction_card on its own as a metric-section safe edit', async () => {
    await run('tests', 'edit-question', 't-1', 's-1', '--skip-question-intro');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'PATCH', body: { disable_instruction_card: true } });
    expect(requests[0].url).toContain('/tests/t-1/questions/s-1/update_question');
    expect(logged.join('\n')).not.toContain('⚠');
  });

  it('sends false for --no-skip-question-intro', async () => {
    await run('tests', 'edit-question', 't-1', 's-1', '--no-skip-question-intro');
    expect(requests[0].body).toEqual({ disable_instruction_card: false });
  });

  it('passes the response through to JSON output', async () => {
    reply = { status: 200, body: { section_id: 's-1', disable_instruction_card: true } };
    process.env.__HELIO_OUTPUT = 'json';
    await run('tests', 'edit-question', 't-1', 's-1', '--skip-question-intro');
    expect(JSON.parse(logged.join('\n'))).toEqual({ section_id: 's-1', disable_instruction_card: true });
  });

  it('explains what to do when the section is a regular question', async () => {
    reply = { status: 400, body: { error: 'no question type found' } };
    const errors = captureErrors();
    await expect(run('tests', 'edit-question', 't-1', 's-1', '--skip-question-intro')).rejects.toThrow(/exit/);
    expect(errors.join('\n')).toMatch(/regular question.*needs --type/);
    expect(errors.join('\n')).toContain('tests preview');
  });
});

describe('regularQuestionNeedsTypeHint', () => {
  it('leaves other errors and --type edits alone', () => {
    expect(regularQuestionNeedsTypeHint(new HelioApiError(400, { error: 'Section not found.' }), {})).toBeNull();
    expect(regularQuestionNeedsTypeHint(new HelioApiError(400, { error: 'no question type found' }), { type: 'nps' })).toBeNull();
    expect(regularQuestionNeedsTypeHint(new Error('no question type found'), {})).toBeNull();
  });
});

describe('--ux-metrics-json section override disable_instruction_card', () => {
  it('accepts a boolean', () => {
    expect(validateUxMetrics([{ type: 'sentiment', sections: [{ disable_instruction_card: true }] }])).toEqual([]);
  });

  it('rejects anything else, null included (the API 400s on it)', () => {
    for (const value of ['yes', null]) {
      const errors = validateUxMetrics([{ type: 'sentiment', sections: [{ disable_instruction_card: value }] }]);
      expect(errors.map(e => e.field)).toEqual(['ux_metrics[0].sections[0].disable_instruction_card']);
    }
  });

  it('is named in the --ux-metrics-json help', () => {
    const program = new Command();
    registerTestsCommand(program);
    const create = program.commands.find(c => c.name() === 'tests')!.commands.find(c => c.name() === 'create')!;
    const help = create.options.find(o => o.long === '--ux-metrics-json')!.description;
    expect(help).toContain('disable_instruction_card');
  });
});
