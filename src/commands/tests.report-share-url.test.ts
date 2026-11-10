import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTestsCommand } from './tests.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// The shareable report link (report_uuid) used to come back only from
// POST /tests/:id/send, so after launch there was no way to print it again.
// Since the 2026-11-10 API release (ZURB-4548) GET /tests/:id and GET /tests
// return report_uuid and report_share_url. `tests get` and `tests list
// --output json` pass them through untouched; `tests preview` surfaces the
// link in its header and its JSON `test` block.

const SHARE_URL = 'https://my.helio.app/report/01REPORTUUID';

let logged: string[];
let showTest: Record<string, unknown>;

beforeEach(() => {
  logged = [];
  showTest = {
    id: 'test-uuid-1',
    name: 'Donor signals',
    status: 'running',
    responses_count: 3,
    project_id: 'proj-uuid-1',
    project_name: 'Next Best Action',
    introduction: 'Hi',
    sections: [],
    report_uuid: '01REPORTUUID',
    report_share_url: SHARE_URL,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    // preview tolerates a 404 report (draft with no responses)
    const body = String(url).includes('/report') ? { error: 'not found' } : { test: showTest };
    return new Response(JSON.stringify(body), {
      status: String(url).includes('/report') ? 404 : 200,
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

describe('tests preview report link', () => {
  it('prints the share link in the header', async () => {
    await run('tests', 'preview', 'test-uuid-1');
    expect(logged).toContain(`Report: ${SHARE_URL}`);
  });

  it('carries report_uuid and report_share_url in the JSON test block', async () => {
    process.env.__HELIO_OUTPUT = 'json';
    await run('tests', 'preview', 'test-uuid-1');
    const out = JSON.parse(logged.join('\n'));
    expect(out.test.report_uuid).toBe('01REPORTUUID');
    expect(out.test.report_share_url).toBe(SHARE_URL);
  });

  it('omits the header line and returns null against an older API', async () => {
    delete showTest.report_uuid;
    delete showTest.report_share_url;
    await run('tests', 'preview', 'test-uuid-1');
    expect(logged.some(l => l.startsWith('Report:'))).toBe(false);

    logged = [];
    process.env.__HELIO_OUTPUT = 'json';
    await run('tests', 'preview', 'test-uuid-1');
    const out = JSON.parse(logged.join('\n'));
    expect(out.test.report_uuid).toBeNull();
    expect(out.test.report_share_url).toBeNull();
  });
});
