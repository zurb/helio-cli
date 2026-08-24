import { describe, it, expect } from 'vitest';
import { GUIDE_JSON } from './guide.js';

describe('GUIDE_JSON command coverage', () => {
  it('lists the top-level update command so agents can discover the updater', () => {
    const update = GUIDE_JSON.commands.update as Record<string, unknown>;
    expect(update).toBeDefined();
    expect(update.description).toMatch(/latest/i);
    expect(JSON.stringify(update)).toContain('--check');
  });

  it('lists the doctor command as the diagnostics entry point', () => {
    const doctor = GUIDE_JSON.commands.doctor as Record<string, unknown>;
    expect(doctor).toBeDefined();
    expect(doctor.description).toMatch(/diagnos/i);
  });
});

// The JSON guide is what an agent reads instead of the man page, so a contract
// the CLI enforces but the guide omits is a contract the agent will break.

describe('GUIDE_JSON — preference variations', () => {
  const preference = GUIDE_JSON.question_types.creatable.preference as Record<string, unknown>;

  it('names variations, not choices, as the required option key', () => {
    expect(preference.required).toContain('variations (min 2)');
    expect(JSON.stringify(preference.required)).not.toContain('choices');
  });

  it('explains the alias, the image requirement, and the launch blocker', () => {
    const blob = JSON.stringify(preference);
    expect(blob).toMatch(/legacy alias/);
    expect(blob).toMatch(/asset_id/);
    expect(blob).toMatch(/launch blocker/);
  });

  it('documents --variations on both question-editing commands', () => {
    const tests = GUIDE_JSON.commands.tests as Record<string, Record<string, unknown>>;
    for (const command of ['add-question', 'edit-question']) {
      expect(JSON.stringify(tests[command])).toContain('--variations');
    }
  });
});

describe('GUIDE_JSON — audience exclusions', () => {
  const tests = GUIDE_JSON.commands.tests as Record<string, Record<string, unknown>>;

  it('documents --exclude-tests on create, with the gates and the symmetry rule', () => {
    const create = JSON.stringify(tests.create);
    expect(create).toContain('--exclude-tests');
    expect(create).toMatch(/SYMMETRIC|symmetric/);
    expect(create).toMatch(/basic, targeted, advanced/);
  });

  it('documents both exclusion flags on update and that neither needs --audience-type', () => {
    const update = JSON.stringify(tests.update);
    expect(update).toContain('--exclude-tests');
    expect(update).toContain('--clear-exclude-tests');
    expect(update).toMatch(/does NOT need --audience-type/);
  });
});
