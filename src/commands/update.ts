import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { Command } from 'commander';
import { isJsonMode, printJson, withErrorHandling } from '../output.js';
import {
  PACKAGE_NAME,
  fetchLatestVersion,
  isNewerVersion,
  writeUpdateCache,
} from '../update-check.js';

// This updater only knows how to update a global npm install. If the running
// binary came from another package manager, npm would install a second copy
// that never wins on PATH — refuse with the right command instead.
const OTHER_INSTALLERS: Record<string, string> = {
  '.pnpm': `pnpm add -g ${PACKAGE_NAME}@latest`,
  pnpm: `pnpm add -g ${PACKAGE_NAME}@latest`,
  '.volta': `volta install ${PACKAGE_NAME}`,
  volta: `volta install ${PACKAGE_NAME}`,
  yarn: `yarn global add ${PACKAGE_NAME}@latest`,
  _npx: `npx ${PACKAGE_NAME}@latest (npx always runs the latest version; nothing to update)`,
};

function detectOtherInstaller(): string | null {
  try {
    const binPath = realpathSync(process.argv[1] ?? '');
    for (const segment of binPath.split(/[\\/]/)) {
      const hint = OTHER_INSTALLERS[segment];
      if (hint) return hint;
    }
  } catch {
    // Can't resolve the running binary; assume npm.
  }
  return null;
}

function installFailureHint(code: number | null): string {
  if (process.platform === 'win32') {
    return (
      `npm install failed (exit code ${code}). Files may be locked by a running ` +
      `helio-cli process — close other terminals and run: npm install -g ${PACKAGE_NAME}@latest`
    );
  }
  return (
    `npm install failed (exit code ${code}). ` +
    `You may need elevated permissions: sudo npm install -g ${PACKAGE_NAME}@latest`
  );
}

function runNpmInstall(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
      stdio: isJsonMode() ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', err => reject(new Error(`Failed to run npm: ${err.message}`)));
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(installFailureHint(code)));
      }
    });
  });
}

export function registerUpdateCommand(program: Command, currentVersion: string): void {
  program
    .command('update')
    .description('Update helio-cli to the latest published version')
    .option('--check', 'Only check whether a newer version exists; do not install')
    .action(withErrorHandling(async (opts: { check?: boolean }) => {
      const latest = await fetchLatestVersion();
      if (!latest) {
        throw new Error('Could not reach the npm registry to check for updates.');
      }
      const updateAvailable = isNewerVersion(latest, currentVersion);

      if (!updateAvailable) {
        if (isJsonMode()) {
          printJson({ current: currentVersion, latest, updateAvailable: false });
        } else {
          console.log(`helio-cli ${currentVersion} is up to date.`);
        }
        return;
      }

      if (opts.check) {
        if (isJsonMode()) {
          printJson({ current: currentVersion, latest, updateAvailable: true });
        } else {
          console.log(`Update available: helio-cli ${currentVersion} → ${latest}`);
          console.log('Run `helio-cli update` to install it.');
        }
        return;
      }

      const otherInstaller = detectOtherInstaller();
      if (otherInstaller) {
        throw new Error(
          'This helio-cli does not appear to be a global npm install, so ' +
            `\`npm install -g\` would not update the copy on your PATH. Run: ${otherInstaller}`,
        );
      }

      if (!isJsonMode()) {
        console.log(`Updating helio-cli ${currentVersion} → ${latest}...`);
      }
      await runNpmInstall();
      writeUpdateCache({ lastCheckedAt: Date.now(), latestVersion: latest });

      if (isJsonMode()) {
        printJson({ current: currentVersion, latest, updateAvailable: true, updated: true });
      } else {
        console.log(`Updated helio-cli to ${latest}.`);
      }
    }));
}
