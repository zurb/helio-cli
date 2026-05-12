import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling, parseJsonOrFile } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

export function registerCustomListsCommand(program: Command): void {
  const cmd = program.command('custom-lists').alias('cl').description('Manage custom lists');

  cmd
    .command('list')
    .description('List custom lists')
    .option('--page <n>', 'Page number')
    .option('--per <n>', 'Items per page')
    .option('--with-segments', 'Include segment data')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.page) params.page = cmdOpts.page;
        if (cmdOpts.per) params.per = cmdOpts.per;
        if (cmdOpts.withSegments) params.with_segments = true;

        const data = (await client.get('custom_lists', params)) as {
          data: Record<string, unknown>[];
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.data, ['id', 'name', 'participants_count', 'created_at']);
        }
      }),
    );

  cmd
    .command('get <id>')
    .description('Get custom list details')
    .option('--with-segments', 'Include segment data')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.withSegments) params.with_segments = true;

        const data = await client.get(`custom_lists/${id}`, params);
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('participants <id>')
    .description('List participants in a custom list')
    .option('--page <n>', 'Page number')
    .option('--per <n>', 'Items per page')
    .option('--with-views', 'Include view records')
    .option('--with-responses', 'Include response records')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.page) params.page = cmdOpts.page;
        if (cmdOpts.per) params.per = cmdOpts.per;
        if (cmdOpts.withViews) params.with_views = true;
        if (cmdOpts.withResponses) params.with_responses = true;

        const data = (await client.get(`custom_lists/${id}/participants`, params)) as {
          data: Record<string, unknown>[];
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.data, ['id', 'full_name', 'email']);
        }
      }),
    );

  cmd
    .command('add-participants <id>')
    .description('Bulk-add participants to a custom list')
    .requiredOption('--data <json>', 'JSON array of {email, full_name} objects or @path/to/file.json')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const participants = parseJsonOrFile(cmdOpts.data);

        const data = await client.post(`custom_lists/${id}/participants`, {
          data: participants,
        });
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log('Participants added successfully.');
        }
      }),
    );
}
