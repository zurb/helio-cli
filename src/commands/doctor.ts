import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { CONFIG_FILE, getConfigValue } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, withErrorHandling } from '../output.js';

interface Check {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose configuration and connectivity issues')
    .action(withErrorHandling(async () => {
      const checks: Check[] = [];

      // 1. Config file exists
      const configPath = CONFIG_FILE;
      if (existsSync(configPath)) {
        checks.push({ name: 'Config file', status: 'pass', message: configPath });
      } else {
        checks.push({
          name: 'Config file',
          status: 'warn',
          message: `Not found at ${configPath}. Run \`helio-cli auth login\` to create it.`,
        });
      }

      // 2. API ID configured
      const apiId =
        process.env.HELIO_API_ID || getConfigValue('api-id');
      if (apiId) {
        checks.push({ name: 'API ID', status: 'pass', message: apiId });
      } else {
        checks.push({ name: 'API ID', status: 'fail', message: 'Not set' });
      }

      // 3. API Token configured
      const apiToken =
        process.env.HELIO_API_TOKEN || getConfigValue('api-token');
      if (apiToken) {
        checks.push({ name: 'API Token', status: 'pass', message: '********' });
      } else {
        checks.push({ name: 'API Token', status: 'fail', message: 'Not set' });
      }

      // 4. Base URL
      const baseUrl =
        process.env.HELIO_BASE_URL ||
        getConfigValue('base-url') ||
        'https://my.helio.app';
      checks.push({ name: 'Base URL', status: 'pass', message: baseUrl });

      // 5. API reachable + credentials valid
      if (apiId && apiToken) {
        const client = new HelioClient({ baseUrl, apiId, apiToken });
        try {
          await client.get('status');
          checks.push({ name: 'API connection', status: 'pass', message: 'Authenticated successfully' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Invalid API Credentials') || msg.includes('401')) {
            checks.push({ name: 'API connection', status: 'fail', message: 'Credentials rejected by API' });
          } else {
            checks.push({ name: 'API connection', status: 'fail', message: `Unreachable: ${msg}` });
          }
        }
      } else {
        checks.push({ name: 'API connection', status: 'fail', message: 'Skipped (missing credentials)' });
      }

      // 6. Node version
      const nodeVersion = process.version;
      const major = parseInt(nodeVersion.slice(1), 10);
      if (major >= 22) {
        checks.push({ name: 'Node.js', status: 'pass', message: nodeVersion });
      } else if (major >= 18) {
        checks.push({ name: 'Node.js', status: 'warn', message: `${nodeVersion} (22+ recommended)` });
      } else {
        checks.push({ name: 'Node.js', status: 'fail', message: `${nodeVersion} (22+ required)` });
      }

      // Output
      const hasFail = checks.some(c => c.status === 'fail');

      if (isJsonMode()) {
        printJson({ checks, ok: !hasFail });
      } else {
        const icons = { pass: '\x1b[32m✓\x1b[0m', fail: '\x1b[31m✗\x1b[0m', warn: '\x1b[33m!\x1b[0m' };
        for (const check of checks) {
          console.log(`  ${icons[check.status]} ${check.name}: ${check.message}`);
        }
        console.log();
        if (hasFail) {
          console.log('Some checks failed. See above for details.');
        } else {
          console.log('All checks passed.');
        }
      }

      if (hasFail) process.exit(1);
    }));
}
