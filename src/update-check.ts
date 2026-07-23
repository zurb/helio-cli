import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from './config.js';
import { isJsonMode } from './output.js';

const CACHE_FILE = join(CONFIG_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export const PACKAGE_NAME = '@zurb/helio-cli';
export const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

export interface UpdateCache {
  lastCheckedAt?: number;
  latestVersion?: string;
}

export function readUpdateCache(file: string = CACHE_FILE): UpdateCache {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    if (typeof raw !== 'object' || raw === null) return {};
    const cache: UpdateCache = {};
    const { lastCheckedAt, latestVersion } = raw as Record<string, unknown>;
    if (typeof lastCheckedAt === 'number') cache.lastCheckedAt = lastCheckedAt;
    if (typeof latestVersion === 'string') cache.latestVersion = latestVersion;
    return cache;
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

interface ParsedVersion {
  nums: number[];
  pre: string[] | null;
}

function parseVersion(v: string): ParsedVersion {
  const [core, ...preParts] = v.replace(/^v/, '').split('-');
  return {
    nums: core.split('.').map(n => parseInt(n, 10)),
    pre: preParts.length ? preParts.join('-').split('.') : null,
  };
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    const x = a.nums[i] ?? 0;
    const y = b.nums[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  // Same core version: a stable release is newer than any of its prereleases.
  if (!a.pre) return b.pre !== null;
  if (!b.pre) return false;
  // Both prereleases: semver precedence per identifier.
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return false;
    if (y === undefined) return true;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = parseInt(x, 10) - parseInt(y, 10);
      if (diff !== 0) return diff > 0;
    } else if (xNum !== yNum) {
      // Numeric identifiers have lower precedence than alphanumeric ones.
      return yNum;
    } else if (x !== y) {
      return x > y;
    }
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

function inCI(): boolean {
  const ci = process.env.CI;
  return ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0';
}

export function updateCheckDisabled(): boolean {
  return (
    process.env.HELIO_NO_UPDATE_CHECK === '1' ||
    inCI() ||
    isJsonMode() ||
    !process.stderr.isTTY
  );
}

export async function fetchLatestVersion(
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(timeoutMs),
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
    `Run \`helio-cli update\` (or \`npm install -g ${PACKAGE_NAME}@latest\`)`
  );
}

/**
 * Spawn the detached refresh worker so the registry fetch completes even when
 * this process exits immediately (fast commands, --help, error paths).
 */
function startBackgroundRefresh(): void {
  try {
    const workerPath = fileURLToPath(new URL('./update-check-worker.js', import.meta.url));
    if (!existsSync(workerPath)) return;
    spawn(process.execPath, [workerPath], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Best-effort; never fail the command over it.
  }
}

/**
 * Throttled update check. Stamps the daily throttle synchronously, hands the
 * registry fetch to a detached worker, and returns a finish function that
 * prints an update notice from the cache (which may hold the result of a
 * previous run's check).
 */
export function startUpdateCheck(
  currentVersion: string,
  cacheFile: string = CACHE_FILE,
): () => void {
  if (updateCheckDisabled()) return () => {};

  const cache = readUpdateCache(cacheFile);
  if (shouldCheckForUpdate(cache, Date.now())) {
    // Stamp before spawning so exit-before-finish paths still engage the throttle.
    writeUpdateCache({ ...cache, lastCheckedAt: Date.now() }, cacheFile);
    startBackgroundRefresh();
  }

  return () => {
    // Re-check: JSON mode may only have been detected during argument parsing.
    if (updateCheckDisabled()) return;
    const { latestVersion } = readUpdateCache(cacheFile);
    if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
      process.stderr.write(formatUpdateNotice(currentVersion, latestVersion) + '\n');
    }
  };
}
