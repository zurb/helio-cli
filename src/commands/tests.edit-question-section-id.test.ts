import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerTestsCommand } from './tests.js';
import { GUIDE_JSON } from './guide.js';

// ─── Contract ────────────────────────────────────────────────────────────────
// `edit-question --type` used to give the question a new section id, and
// Helio deleted every skip rule on other questions that pointed at the old one
// (ZURB-4587). Helio now rebuilds the question on the same section. The help
// and guide say so, and say that everything else comes from the call.

function editQuestion(): Command {
  const program = new Command();
  registerTestsCommand(program);
  const tests = program.commands.find(c => c.name() === 'tests')!;
  return tests.commands.find(c => c.name() === 'edit-question')!;
}

describe('edit-question wording', () => {
  it('says a replacement keeps the section id and the skip rules that point at it', () => {
    const description = editQuestion().description();
    expect(description).toContain('section id');
    expect(description).toContain('skip rules');
    expect(description).not.toMatch(/Helio version/i);
  });

  it('says the same in the guide, and to pass per-question settings again', () => {
    const json = JSON.stringify(GUIDE_JSON);
    expect(json).toContain('keeps its position, section id and the skip rules that point at it');
    expect(json).toContain('pass --skip-question-intro / --display-seconds / --randomize-choices / --branching / --followup again');
    expect(json).not.toMatch(/Helio versions with ZURB-4587/);
  });
});
