import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isNewerVersion,
  shouldCheckForUpdate,
  formatUpdateNotice,
  fetchLatestVersion,
  readUpdateCache,
  writeUpdateCache,
  updateCheckDisabled,
  startUpdateCheck,
} from './update-check.js';

describe('isNewerVersion', () => {
  it('detects newer patch, minor, and major versions', () => {
    expect(isNewerVersion('0.3.1', '0.3.0')).toBe(true);
    expect(isNewerVersion('0.4.0', '0.3.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('returns false for equal or older versions', () => {
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.2.9', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.3.0', '1.0.0')).toBe(false);
  });

  it('ignores v prefixes', () => {
    expect(isNewerVersion('v0.4.0', '0.3.0')).toBe(true);
  });

  it('treats a stable release as newer than its own prerelease', () => {
    expect(isNewerVersion('0.4.0', '0.4.0-beta.1')).toBe(true);
    expect(isNewerVersion('0.4.0-beta.1', '0.4.0')).toBe(false);
  });

  it('orders prereleases by semver precedence', () => {
    expect(isNewerVersion('0.4.0-beta.2', '0.4.0-beta.1')).toBe(true);
    expect(isNewerVersion('0.4.0-beta.1', '0.4.0-beta.2')).toBe(false);
    expect(isNewerVersion('0.4.0-beta', '0.4.0-alpha')).toBe(true);
    expect(isNewerVersion('0.4.0-beta.1', '0.4.0-beta.1')).toBe(false);
    expect(isNewerVersion('0.4.0-beta.1.1', '0.4.0-beta.1')).toBe(true);
    // Numeric identifiers rank below alphanumeric ones.
    expect(isNewerVersion('0.4.0-alpha', '0.4.0-1')).toBe(true);
  });

  it('still detects newer cores across prerelease boundaries', () => {
    expect(isNewerVersion('0.4.0-beta.1', '0.3.0')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.4.0-beta.1')).toBe(false);
  });

  it('returns false for unparseable versions', () => {
    expect(isNewerVersion('not-a-version', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.4.0', 'garbage')).toBe(false);
  });
});

describe('shouldCheckForUpdate', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('checks when there is no cache', () => {
    expect(shouldCheckForUpdate({}, Date.now())).toBe(true);
  });

  it('skips when checked within the interval', () => {
    const now = 1_000_000 + DAY;
    expect(shouldCheckForUpdate({ lastCheckedAt: now - DAY / 2 }, now)).toBe(false);
  });

  it('checks again once the interval has passed', () => {
    const now = 1_000_000 + 2 * DAY;
    expect(shouldCheckForUpdate({ lastCheckedAt: now - DAY }, now)).toBe(true);
  });
});

describe('formatUpdateNotice', () => {
  it('includes both versions and the update command', () => {
    const notice = formatUpdateNotice('0.3.0', '0.4.0');
    expect(notice).toContain('0.3.0');
    expect(notice).toContain('0.4.0');
    expect(notice).toContain('helio-cli update');
    expect(notice).toContain('npm install -g @zurb/helio-cli@latest');
  });
});

describe('updateCheckDisabled', () => {
  const originalIsTTY = process.stderr.isTTY;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('HELIO_NO_UPDATE_CHECK', '');
    vi.stubEnv('CI', '');
    vi.stubEnv('__HELIO_OUTPUT', '');
    process.stderr.isTTY = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.stderr.isTTY = originalIsTTY;
  });

  it('is enabled on a plain TTY', () => {
    expect(updateCheckDisabled()).toBe(false);
  });

  it('disables via HELIO_NO_UPDATE_CHECK, JSON mode, and non-TTY', () => {
    vi.stubEnv('HELIO_NO_UPDATE_CHECK', '1');
    expect(updateCheckDisabled()).toBe(true);
    vi.stubEnv('HELIO_NO_UPDATE_CHECK', '');

    vi.stubEnv('__HELIO_OUTPUT', 'json');
    expect(updateCheckDisabled()).toBe(true);
    vi.stubEnv('__HELIO_OUTPUT', '');

    process.stderr.isTTY = false as never;
    expect(updateCheckDisabled()).toBe(true);
  });

  it('treats CI=true as CI but CI=false/0/empty as not CI', () => {
    vi.stubEnv('CI', 'true');
    expect(updateCheckDisabled()).toBe(true);
    vi.stubEnv('CI', '1');
    expect(updateCheckDisabled()).toBe(true);
    vi.stubEnv('CI', 'false');
    expect(updateCheckDisabled()).toBe(false);
    vi.stubEnv('CI', '0');
    expect(updateCheckDisabled()).toBe(false);
    vi.stubEnv('CI', '');
    expect(updateCheckDisabled()).toBe(false);
  });
});

describe('fetchLatestVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the version from the registry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.9.0' }),
    }));
    expect(await fetchLatestVersion()).toBe('0.9.0');
  });

  it('returns null on non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null when the body has no version string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchLatestVersion()).toBeNull();
  });
});

describe('update cache', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'helio-update-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips through a file and tolerates a missing one', () => {
    const file = join(dir, 'nested', 'update-check.json');
    expect(readUpdateCache(file)).toEqual({});
    writeUpdateCache({ lastCheckedAt: 123, latestVersion: '0.4.0' }, file);
    expect(readUpdateCache(file)).toEqual({ lastCheckedAt: 123, latestVersion: '0.4.0' });
  });

  it('returns an empty cache for non-object JSON instead of crashing', () => {
    const file = join(dir, 'update-check.json');
    for (const content of ['null', '"oops"', '42', '[1,2]', '{not json']) {
      writeFileSync(file, content);
      expect(readUpdateCache(file)).toEqual({});
    }
  });

  it('drops fields with unexpected types', () => {
    const file = join(dir, 'update-check.json');
    writeFileSync(file, JSON.stringify({ lastCheckedAt: 'yesterday', latestVersion: 4 }));
    expect(readUpdateCache(file)).toEqual({});
  });
});

describe('startUpdateCheck', () => {
  let dir: string;
  const originalIsTTY = process.stderr.isTTY;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'helio-update-'));
    vi.stubEnv('HELIO_NO_UPDATE_CHECK', '');
    vi.stubEnv('CI', '');
    vi.stubEnv('__HELIO_OUTPUT', '');
    process.stderr.isTTY = true;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.stderr.isTTY = originalIsTTY;
  });

  it('prints a notice when the cache holds a newer version', () => {
    const file = join(dir, 'update-check.json');
    writeUpdateCache({ lastCheckedAt: Date.now(), latestVersion: '99.0.0' }, file);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    startUpdateCheck('0.3.0', file)();

    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toContain('0.3.0 → 99.0.0');
  });

  it('prints nothing when up to date or when the cache is corrupt', () => {
    const file = join(dir, 'update-check.json');
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    writeUpdateCache({ lastCheckedAt: Date.now(), latestVersion: '0.3.0' }, file);
    startUpdateCheck('0.3.0', file)();

    writeFileSync(file, 'null');
    startUpdateCheck('0.3.0', file)();

    expect(write).not.toHaveBeenCalled();
  });

  it('stamps the throttle on a stale cache so exit paths stay throttled', () => {
    const file = join(dir, 'update-check.json');
    const before = Date.now();
    startUpdateCheck('0.3.0', file);
    const { lastCheckedAt } = readUpdateCache(file);
    expect(lastCheckedAt).toBeGreaterThanOrEqual(before);
  });

  it('preserves a known latestVersion when stamping the throttle', () => {
    const file = join(dir, 'update-check.json');
    writeUpdateCache({ lastCheckedAt: 1, latestVersion: '99.0.0' }, file);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    startUpdateCheck('0.3.0', file)();

    expect(readUpdateCache(file).latestVersion).toBe('99.0.0');
    expect(write).toHaveBeenCalledOnce();
  });

  it('does nothing at all when disabled', () => {
    const file = join(dir, 'update-check.json');
    vi.stubEnv('HELIO_NO_UPDATE_CHECK', '1');
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    startUpdateCheck('0.3.0', file)();

    expect(readUpdateCache(file)).toEqual({});
    expect(write).not.toHaveBeenCalled();
  });
});
