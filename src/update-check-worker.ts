// Detached background worker: fetch the latest published version and record it
// in the update cache. Spawned by startUpdateCheck so the check completes even
// when the CLI process exits immediately. Failures leave the cache untouched
// (the daily throttle was already stamped by the parent).
import { fetchLatestVersion, readUpdateCache, writeUpdateCache } from './update-check.js';

const latest = await fetchLatestVersion();
if (latest) {
  writeUpdateCache({
    ...readUpdateCache(),
    lastCheckedAt: Date.now(),
    latestVersion: latest,
  });
}
