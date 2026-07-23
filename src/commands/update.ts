import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { isJsonMode, printJson, withErrorHandling } from '../output.js';
import {
  fetchLatestVersion,
  isNewerVersion,
  writeUpdateCache,
} from '../update-check.js';

const INSTALL_ARGS = ['install', '-g', '@zurb/helio-cli@latest'];

function runNpmInstall(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', INSTALL_ARGS, {
      stdio: isJsonMode() ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', err => reject(new Error(`Failed to run npm: ${err.message}`)));
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `npm install failed (exit code ${code}). ` +
              'You may need elevated permissions: sudo npm install -g @zurb/helio-cli@latest',
          ),
        );
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
      const latest = await fetchLatestVersion(5000);
      if (!latest) {
        throw new Error('Could not reach the npm registry to check for updates.');
      }
      const updateAvailable = isNewerVersion(latest, currentVersion);

      if (opts.check) {
        if (isJsonMode()) {
          printJson({ current: currentVersion, latest, updateAvailable });
        } else if (updateAvailable) {
          console.log(`Update available: helio-cli ${currentVersion} → ${latest}`);
          console.log('Run `helio-cli update` to install it.');
        } else {
          console.log(`helio-cli ${currentVersion} is up to date.`);
        }
        return;
      }

      if (!updateAvailable) {
        if (isJsonMode()) {
          printJson({ current: currentVersion, latest, updated: false, upToDate: true });
        } else {
          console.log(`helio-cli ${currentVersion} is already up to date.`);
        }
        return;
      }

      if (!isJsonMode()) {
        console.log(`Updating helio-cli ${currentVersion} → ${latest}...`);
      }
      await runNpmInstall();
      writeUpdateCache({ lastCheckedAt: Date.now(), latestVersion: latest });

      if (isJsonMode()) {
        printJson({ current: currentVersion, latest, updated: true });
      } else {
        console.log(`Updated helio-cli to ${latest}.`);
      }
    }));
}
