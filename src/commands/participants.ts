import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

export function registerParticipantsCommand(program: Command): void {
  const cmd = program.command('participants').alias('pt').description('Manage participants');

  cmd
    .command('list')
    .description('List participants')
    .option('--page <n>', 'Page number')
    .option('--per <n>', 'Items per page')
    .option('--with-views', 'Include view records')
    .option('--with-responses', 'Include response records')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.page) params.page = cmdOpts.page;
        if (cmdOpts.per) params.per = cmdOpts.per;
        if (cmdOpts.withViews) params.with_views = true;
        if (cmdOpts.withResponses) params.with_responses = true;

        const data = (await client.get('participants', params)) as {
          data: Record<string, unknown>[];
          page: number;
          per: number;
          total: number;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.data, ['id', 'full_name', 'email', 'created_at']);
        }
      }),
    );

  cmd
    .command('get <id>')
    .description('Get participant details (UUID, email, or c_id)')
    .option('--with-views', 'Include view records')
    .option('--with-responses', 'Include response records')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.withViews) params.with_views = true;
        if (cmdOpts.withResponses) params.with_responses = true;

        const data = await client.get(`participants/${id}`, params);
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('create')
    .description('Create a participant and add to a custom list')
    .requiredOption('--email <email>', 'Participant email')
    .requiredOption('--customer-list-id <id>', 'Custom list UUID')
    .option('--full-name <name>', 'Full name')
    .option('--c-id <cid>', 'External client ID')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const body: Record<string, unknown> = {
          email: cmdOpts.email,
          customer_list_id: cmdOpts.customerListId,
        };
        if (cmdOpts.fullName) body.full_name = cmdOpts.fullName;
        if (cmdOpts.cId) body.c_id = cmdOpts.cId;

        const data = await client.post('participants', body);
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('update <id>')
    .description('Update a participant')
    .option('--email <email>', 'New email')
    .option('--full-name <name>', 'New full name')
    .option('--c-id <cid>', 'New external client ID')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const body: Record<string, unknown> = {};
        if (cmdOpts.email) body.email = cmdOpts.email;
        if (cmdOpts.fullName) body.full_name = cmdOpts.fullName;
        if (cmdOpts.cId) body.c_id = cmdOpts.cId;

        if (Object.keys(body).length === 0) {
          throw new Error('At least one field is required: --email, --full-name, or --c-id');
        }

        const data = await client.put(`participants/${id}`, body);
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('delete <id>')
    .description('Delete a participant')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        await client.delete(`participants/${id}`);
        if (isJsonMode()) {
          printJson({ status: 'deleted', id });
        } else {
          console.log(`Deleted participant ${id}`);
        }
      }),
    );
}
