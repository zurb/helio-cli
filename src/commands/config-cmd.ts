import { Command } from 'commander';
import {
  readConfig,
  getConfigValue,
  setConfigValue,
  isValidConfigKey,
  validConfigKeys,
} from '../config.js';
import { isJsonMode, printJson, printKeyValue } from '../output.js';
import { withErrorHandling } from '../output.js';

export function registerConfigCommand(program: Command): void {
  const cmd = program.command('config').description('Manage CLI configuration');

  cmd
    .command('set <key> <value>')
    .description(`Set a config value. Keys: ${validConfigKeys().join(', ')}`)
    .action(
      withErrorHandling(async (key: string, value: string) => {
        if (!isValidConfigKey(key)) {
          throw new Error(
            `Invalid key "${key}". Valid keys: ${validConfigKeys().join(', ')}`,
          );
        }
        setConfigValue(key, value);
        const display = key === 'api-token' ? '********' : value;
        if (isJsonMode()) {
          printJson({ key, value: display, status: 'saved' });
        } else {
          console.log(`Set ${key} = ${display}`);
        }
      }),
    );

  cmd
    .command('get <key>')
    .description('Get a config value')
    .action(
      withErrorHandling(async (key: string) => {
        if (!isValidConfigKey(key)) {
          throw new Error(
            `Invalid key "${key}". Valid keys: ${validConfigKeys().join(', ')}`,
          );
        }
        const value = getConfigValue(key);
        const display = key === 'api-token' && value ? '********' : (value ?? null);
        if (isJsonMode()) {
          printJson({ key, value: display });
        } else {
          console.log(display ?? '(not set)');
        }
      }),
    );

  cmd
    .command('show')
    .description('Show all config values')
    .action(
      withErrorHandling(async () => {
        const config = readConfig();
        const display = { ...config };
        if (display['api-token']) {
          display['api-token'] = '********';
        }
        if (isJsonMode()) {
          printJson(display);
        } else if (Object.keys(display).length === 0) {
          console.log('No configuration set.');
        } else {
          printKeyValue(display as Record<string, unknown>);
        }
      }),
    );
}
