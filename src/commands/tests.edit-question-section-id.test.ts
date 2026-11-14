import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTestsCommand, sectionIdChangeWarning } from './tests.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// `edit-question --type` used to give the question a new section id, and
// Helio deleted every skip rule on other questions that pointed at the old one
// (ZURB-4587). Helio now rebuilds the question on the same section, so the id
// comes back unchanged. If a different section_id ever comes back, the CLI
// says so, since the rules that pointed at the old one may be gone.

const SECTION = '01JSECTIONUUIDAAAAAAAAAAAA';
let logged: string[];
let returnedSectionId: string;
let lastRequest: { url: string; method: string; body: unknown } | null;

beforeEach(() => {
  logged = [];
  returnedSectionId = SECTION;
  lastRequest = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    lastRequest = { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    return new Response(
      JSON.stringify({ section_id: returnedSectionId, type: 'NPS', instructions: 'Updated', position: 3, test_id: 'test-1' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
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

describe('sectionIdChangeWarning', () => {
  it('is quiet when the section keeps its id', () => {
    expect(sectionIdChangeWarning(SECTION, { section_id: SECTION })).toBeNull();
  });

  it('warns when a different section id comes back', () => {
    const warning = sectionIdChangeWarning(SECTION, { section_id: '01JNEWSECTIONUUIDBBBBBBBBB' });
    expect(warning).toContain('01JNEWSECTIONUUIDBBBBBBBBB');
    expect(warning).toContain('Skip rules');
    expect(warning).not.toMatch(/version/i);
  });

  // tests preview shows numeric section ids, and the response names the
  // section by uuid, so the two can't be compared.
  it('does not check a numeric id against the uuid', () => {
    expect(sectionIdChangeWarning('4512', { section_id: SECTION })).toBeNull();
  });

  it('is quiet when the response has no section_id', () => {
    expect(sectionIdChangeWarning(SECTION, {})).toBeNull();
    expect(sectionIdChangeWarning(SECTION, null)).toBeNull();
  });
});

describe('tests edit-question --type', () => {
  it('PATCHes update_question and prints no warning when the id is kept', async () => {
    await run('tests', 'edit-question', 'test-1', SECTION, '--type', 'nps', '--instructions', 'Updated');
    expect(lastRequest?.method).toBe('PATCH');
    expect(lastRequest?.url).toContain(`/tests/test-1/questions/${SECTION}/update_question`);
    expect(logged.some(l => l.includes('⚠'))).toBe(false);
  });

  it('warns in text output when the id changed', async () => {
    returnedSectionId = '01JNEWSECTIONUUIDBBBBBBBBB';
    await run('tests', 'edit-question', 'test-1', SECTION, '--type', 'nps', '--instructions', 'Updated');
    expect(logged.some(l => l.includes('⚠') && l.includes('different section id'))).toBe(true);
  });

  it('adds the warning to JSON output when the id changed', async () => {
    returnedSectionId = '01JNEWSECTIONUUIDBBBBBBBBB';
    process.env.__HELIO_OUTPUT = 'json';
    await run('tests', 'edit-question', 'test-1', SECTION, '--type', 'nps', '--instructions', 'Updated');
    const out = JSON.parse(logged.join('\n'));
    expect(out.section_id).toBe('01JNEWSECTIONUUIDBBBBBBBBB');
    expect(out.warnings).toHaveLength(1);
  });

  it('leaves JSON output unchanged when the id is kept', async () => {
    process.env.__HELIO_OUTPUT = 'json';
    await run('tests', 'edit-question', 'test-1', SECTION, '--type', 'nps', '--instructions', 'Updated');
    const out = JSON.parse(logged.join('\n'));
    expect(out.warnings).toBeUndefined();
  });

  it('is quiet for a numeric id copied from preview', async () => {
    await run('tests', 'edit-question', 'test-1', '4512', '--type', 'nps', '--instructions', 'Updated');
    expect(lastRequest?.url).toContain('/tests/test-1/questions/4512/update_question');
    expect(logged.some(l => l.includes('⚠'))).toBe(false);
  });

  it('does not check a UX metric section edit, which never changed the id', async () => {
    returnedSectionId = '01JNEWSECTIONUUIDBBBBBBBBB';
    await run('tests', 'edit-question', 'test-1', SECTION, '--instructions', 'Reworded');
    expect(logged.some(l => l.includes('⚠'))).toBe(false);
  });
});
