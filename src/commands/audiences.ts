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
    .option('--name <name>', 'Filter by partial name match (case-insensitive)')
    .option('--recent', 'Sort by most recently used in a test first')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.page) params.page = cmdOpts.page;
        if (cmdOpts.name) params.name = cmdOpts.name;
        if (cmdOpts.recent) params.sort = 'recently_used';

        const data = (await client.get('audiences', params)) as {
          audiences: Record<string, unknown>[];
          total_count: number;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.audiences, ['id', 'name', 'participants_count', 'tests_count', 'last_used_at']);
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

  cmd
    .command('clone <id>')
    .description('Clone an audience into the same customer list')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.post(`audiences/${id}/clone`)) as {
          audience: Record<string, unknown>;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Cloned audience ${id}`);
          printKeyValue(data.audience);
        }
      }),
    );
}
