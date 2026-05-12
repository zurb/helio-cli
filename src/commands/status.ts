import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Check API connectivity and credentials')
    .action(
      withErrorHandling(async () => {
        const opts = program.opts<GlobalOptions>();
        const creds = resolveCredentials(opts);
        const client = new HelioClient(creds);
        const data = await client.get('status');
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );
}
