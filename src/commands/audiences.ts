import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

export function registerAudiencesCommand(program: Command): void {
  const cmd = program.command('audiences').alias('a').description('Manage audiences');

  cmd
    .command('list')
    .description('List audiences')
    .option('--page <n>', 'Page number')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.page) params.page = cmdOpts.page;

        const data = (await client.get('audiences', params)) as {
          audiences: Record<string, unknown>[];
          total_count: number;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.audiences, ['id', 'name']);
          console.log(`\nTotal: ${data.total_count}`);
        }
      }),
    );

  cmd
    .command('get <id>')
    .description('Get audience details')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`audiences/${id}`)) as {
          audience: Record<string, unknown>;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data.audience);
        }
      }),
    );
}
