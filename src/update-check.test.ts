import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isNewerVersion,
  shouldCheckForUpdate,
  formatUpdateNotice,
  fetchLatestVersion,
  readUpdateCache,
  writeUpdateCache,
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

  it('ignores v prefixes and prerelease suffixes', () => {
    expect(isNewerVersion('v0.4.0', '0.3.0')).toBe(true);
    expect(isNewerVersion('0.4.0-beta.1', '0.3.0')).toBe(true);
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
  it('round-trips through a file and tolerates a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helio-update-'));
    const file = join(dir, 'nested', 'update-check.json');
    try {
      expect(readUpdateCache(file)).toEqual({});
      writeUpdateCache({ lastCheckedAt: 123, latestVersion: '0.4.0' }, file);
      expect(readUpdateCache(file)).toEqual({ lastCheckedAt: 123, latestVersion: '0.4.0' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
