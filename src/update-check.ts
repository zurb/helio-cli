import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_DIR = join(homedir(), '.helio-cli');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;
// After the command finishes, wait at most this long for an in-flight registry check.
const FINISH_GRACE_MS = 250;

export const REGISTRY_URL = 'https://registry.npmjs.org/@zurb/helio-cli/latest';

export interface UpdateCache {
  lastCheckedAt?: number;
  latestVersion?: string;
}

export function readUpdateCache(file: string = CACHE_FILE): UpdateCache {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeUpdateCache(cache: UpdateCache, file: string = CACHE_FILE): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(cache, null, 2) + '\n');
  } catch {
    // Cache is best-effort; never fail the command over it.
  }
}

export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10));
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

export function shouldCheckForUpdate(
  cache: UpdateCache,
  now: number,
  intervalMs: number = CHECK_INTERVAL_MS,
): boolean {
  return !cache.lastCheckedAt || now - cache.lastCheckedAt >= intervalMs;
}

export function updateCheckDisabled(): boolean {
  return (
    process.env.HELIO_NO_UPDATE_CHECK === '1' ||
    !!process.env.CI ||
    process.env.__HELIO_OUTPUT === 'json' ||
    !process.stderr.isTTY
  );
}

export async function fetchLatestVersion(
  timeoutMs: number = FETCH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(REGISTRY_URL, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

export function formatUpdateNotice(current: string, latest: string): string {
  return (
    `\n\x1b[33mUpdate available:\x1b[0m helio-cli ${current} → ${latest}\n` +
    `Run \`helio-cli update\` (or \`npm install -g @zurb/helio-cli@latest\`)`
  );
}

/**
 * Kick off a throttled background check against the npm registry and return a
 * finish function to call after the command completes. The finish function
 * prints an update notice to stderr when a newer version is known, waiting at
 * most FINISH_GRACE_MS for an in-flight check before falling back to the
 * cached result.
 */
export function startUpdateCheck(currentVersion: string): () => Promise<void> {
  if (updateCheckDisabled()) return async () => {};

  const cache = readUpdateCache();
  let refresh: Promise<void> | null = null;
  const controller = new AbortController();

  if (shouldCheckForUpdate(cache, Date.now())) {
    refresh = fetchLatestVersion(FETCH_TIMEOUT_MS, controller.signal)
      .then(latest => {
        writeUpdateCache({
          lastCheckedAt: Date.now(),
          latestVersion: latest ?? cache.latestVersion,
        });
      })
      .catch(() => {});
  }

  return async () => {
    if (refresh) {
      await Promise.race([
        refresh,
        new Promise<void>(resolve => setTimeout(resolve, FINISH_GRACE_MS).unref()),
      ]);
      controller.abort();
    }
    // Re-check: JSON mode may only have been detected during argument parsing.
    if (updateCheckDisabled()) return;
    const { latestVersion } = readUpdateCache();
    if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
      process.stderr.write(formatUpdateNotice(currentVersion, latestVersion) + '\n');
    }
  };
}
