import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTestsCommand, sectionIdChangeWarning } from './tests.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// `edit-question --type` used to give the question a new section id, and
// Helio deleted every skip rule on other questions that pointed at the old one
// (ZURB-4587). Helio now rebuilds the question on the same section, so the id
// comes back unchanged. Against an older Helio the CLI can still see the
// change: the response's section_id differs from the one it asked for.

const SECTION = '01JSECTIONUUIDAAAAAAAAAAAA';
let logged: string[];
let returnedSectionId: string;
let returnedNumericId: number | undefined;
let lastRequest: { url: string; method: string; body: unknown } | null;

beforeEach(() => {
  logged = [];
  returnedSectionId = SECTION;
  returnedNumericId = undefined;
  lastRequest = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    lastRequest = { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    return new Response(
      JSON.stringify({ section_id: returnedSectionId, id: returnedNumericId, type: 'NPS', instructions: 'Updated', position: 3, test_id: 'test-1' }),
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

  it('warns when an older Helio hands back a new id', () => {
    const warning = sectionIdChangeWarning(SECTION, { section_id: '01JNEWSECTIONUUIDBBBBBBBBB' });
    expect(warning).toContain('01JNEWSECTIONUUIDBBBBBBBBB');
    expect(warning).toContain('skip rules');
  });

  // tests preview and GET /tests/:id show numeric section ids, so that is
  // what gets copied into edit-question.
  it('compares a numeric id with the numeric id Helio echoes, as strings', () => {
    expect(sectionIdChangeWarning('4512', { section_id: SECTION, id: 4512 })).toBeNull();
    expect(sectionIdChangeWarning('4512', { section_id: SECTION, id: '4512' })).toBeNull();
    expect(sectionIdChangeWarning('4512', { section_id: SECTION, id: 4513 })).toContain('new section id');
  });

  it('warns for a numeric id when an older Helio sends no numeric id back', () => {
    expect(sectionIdChangeWarning('4512', { section_id: '01JNEWSECTIONUUIDBBBBBBBBB' })).toContain('skip rules');
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
    expect(logged.some(l => l.includes('⚠') && l.includes('new section id'))).toBe(true);
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

  it('warns for a numeric id copied from preview when an older Helio rebuilt the section', async () => {
    returnedSectionId = '01JNEWSECTIONUUIDBBBBBBBBB';
    await run('tests', 'edit-question', 'test-1', '4512', '--type', 'nps', '--instructions', 'Updated');
    expect(logged.some(l => l.includes('⚠') && l.includes('new section id'))).toBe(true);
  });

  it('is quiet for a numeric id that Helio echoes back unchanged', async () => {
    returnedNumericId = 4512;
    await run('tests', 'edit-question', 'test-1', '4512', '--type', 'nps', '--instructions', 'Updated');
    expect(logged.some(l => l.includes('⚠'))).toBe(false);
  });

  it('does not check a UX metric section edit, which never changed the id', async () => {
    returnedSectionId = '01JNEWSECTIONUUIDBBBBBBBBB';
    await run('tests', 'edit-question', 'test-1', SECTION, '--instructions', 'Reworded');
    expect(logged.some(l => l.includes('⚠'))).toBe(false);
  });
});
