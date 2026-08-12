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
