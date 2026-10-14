import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { buildProjectCreateBody, buildProjectUpdateBody, registerProjectsCommand } from './projects.js';

// ─── buildProjectCreateBody ──────────────────────────────────────────────────
// POST /projects takes {name, tags, account_id}. Name is required and unique
// per account; account_id is only honored for ZURB tokens.

describe('buildProjectCreateBody', () => {
  it('requires a non-blank name', () => {
    expect(() => buildProjectCreateBody({})).toThrow(/--name/);
    expect(() => buildProjectCreateBody({ name: '   ' })).toThrow(/--name/);
  });

  it('sends only the name when nothing else is passed', () => {
    expect(buildProjectCreateBody({ name: ' Checkout ' })).toEqual({ name: 'Checkout' });
  });

  it('carries tags and maps --account-id to account_id', () => {
    expect(buildProjectCreateBody({ name: 'Checkout', tags: ['ux', ' q4 ', ''], accountId: 'acct_1' })).toEqual({
      name: 'Checkout',
      tags: ['ux', 'q4'],
      account_id: 'acct_1',
    });
  });

  it('rejects tags over 33 characters before the request, naming them', () => {
    const long = 'x'.repeat(34);
    expect(() => buildProjectCreateBody({ name: 'Checkout', tags: ['ok', long] })).toThrow(new RegExp(long));
    expect(() => buildProjectCreateBody({ name: 'Checkout', tags: ['y'.repeat(33)] })).not.toThrow();
  });
});

// ─── buildProjectUpdateBody ──────────────────────────────────────────────────
// PATCH /projects/:id replaces tags wholesale, so --tags and --clear-tags are
// the two ways to write the list, and a bare `update <id>` is a mistake.

describe('buildProjectUpdateBody', () => {
  it('refuses an update with nothing to change', () => {
    expect(() => buildProjectUpdateBody({})).toThrow(/Nothing to update/);
  });

  it('renames', () => {
    expect(buildProjectUpdateBody({ name: 'Checkout v2' })).toEqual({ name: 'Checkout v2' });
  });

  it('rejects a blank rename rather than sending an empty name', () => {
    expect(() => buildProjectUpdateBody({ name: '  ' })).toThrow(/blank/);
  });

  it('replaces tags', () => {
    expect(buildProjectUpdateBody({ tags: ['ux'] })).toEqual({ tags: ['ux'] });
  });

  it('clears tags with an explicit empty list', () => {
    expect(buildProjectUpdateBody({ clearTags: true })).toEqual({ tags: [] });
  });

  it('rejects --tags with --clear-tags', () => {
    expect(() => buildProjectUpdateBody({ tags: ['ux'], clearTags: true })).toThrow(/not both/);
  });
});

// ─── Commands end to end (fetch mocked) ──────────────────────────────────────

type FetchCall = { url: string; init: RequestInit };

let calls: FetchCall[];
let logged: string[];

const project = {
  id: 'proj-uuid-1',
  name: 'Checkout',
  tests_count: 0,
  responses_count: 0,
  tags: ['ux'],
  created_at: '2026-10-14T00:00:00Z',
  last_activity_at: '2026-10-14T00:00:00Z',
};

beforeEach(() => {
  calls = [];
  logged = [];
  process.env.__HELIO_OUTPUT = 'json';
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ project }), {
      status: init?.method === 'POST' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
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
  registerProjectsCommand(program);
  await program.parseAsync(
    ['--api-id', 'id-1', '--api-token', 'tok-1', '--base-url', 'https://my.helio.app', ...args],
    { from: 'user' },
  );
}

describe('projects create', () => {
  it('POSTs name, tags and account_id to /projects and prints the project', async () => {
    await run('projects', 'create', '--name', 'Checkout', '--tags', 'ux', 'q4', '--account-id', 'acct_1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://my.helio.app/api/public/projects');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'Checkout',
      tags: ['ux', 'q4'],
      account_id: 'acct_1',
    });
    expect(JSON.parse(logged.join('\n'))).toEqual({ project });
  });
});

describe('projects update', () => {
  it('PATCHes /projects/:id with the rename', async () => {
    await run('projects', 'update', 'proj-uuid-1', '--name', 'Checkout v2');
    expect(calls[0].url).toBe('https://my.helio.app/api/public/projects/proj-uuid-1');
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: 'Checkout v2' });
  });

  it('sends tags: [] for --clear-tags', async () => {
    await run('projects', 'update', 'proj-uuid-1', '--clear-tags');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ tags: [] });
  });

  it('makes no request when there is nothing to update', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    await expect(run('projects', 'update', 'proj-uuid-1')).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(calls).toHaveLength(0);
  });
});
