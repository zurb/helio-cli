import { describe, it, expect } from 'vitest';
import { buildVersionCheck } from './doctor.js';

describe('buildVersionCheck', () => {
  it('passes when the CLI is up to date', () => {
    const check = buildVersionCheck('0.8.0', '0.8.0');
    expect(check.name).toBe('CLI version');
    expect(check.status).toBe('pass');
    expect(check.message).toContain('0.8.0');
    expect(check.message).toMatch(/up to date/i);
  });

  it('passes when the local version is ahead of the registry (pre-release dev builds)', () => {
    expect(buildVersionCheck('0.9.0', '0.8.0').status).toBe('pass');
  });

  it('warns with both versions and the update command when a newer version exists', () => {
    const check = buildVersionCheck('0.8.0', '0.9.0');
    expect(check.status).toBe('warn');
    expect(check.message).toContain('0.8.0');
    expect(check.message).toContain('0.9.0');
    expect(check.message).toContain('helio-cli update');
  });

  it('warns without failing doctor when the registry is unreachable', () => {
    const check = buildVersionCheck('0.8.0', null);
    expect(check.status).toBe('warn');
    expect(check.message).toContain('0.8.0');
    expect(check.message).toMatch(/could not/i);
  });
});
