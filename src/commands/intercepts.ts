import { Command } from 'commander';
import { resolveCredentials, getConfigValue } from '../config.js';
import { HelioClient } from '../client.js';
import { HelioApiError } from '../types.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

export function registerInterceptsCommand(program: Command): void {
  const cmd = program.command('intercepts').alias('ic').description('Manage intercepts');

  cmd
    .command('get <id>')
    .description('Get intercept details (authenticated)')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`intercepts/${id}`)) as {
          intercept: Record<string, unknown>;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data.intercept);
        }
      }),
    );

  cmd
    .command('list <account-id>')
    .description('List active intercepts for an account (unauthenticated)')
    .action(
      withErrorHandling(async (accountId: string) => {
        const opts = program.opts<GlobalOptions>();
        const baseUrl =
          opts.baseUrl ||
          process.env.HELIO_BASE_URL ||
          getConfigValue('base-url') ||
          'https://my.helio.app';
        // This endpoint is unauthenticated — use raw fetch
        const url = new URL(
          `/api/public/v1/intercepts/list/${accountId}`,
          baseUrl,
        );
        const res = await fetch(url.toString(), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new HelioApiError(res.status, await res.text());
        const data = (await res.json()) as {
          intercepts: Record<string, unknown>[];
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.intercepts, ['id', 'name']);
        }
      }),
    );

  cmd
    .command('track <id>')
    .description('Increment view count for an intercept (unauthenticated)')
    .action(
      withErrorHandling(async (id: string) => {
        const opts = program.opts<GlobalOptions>();
        const baseUrl =
          opts.baseUrl ||
          process.env.HELIO_BASE_URL ||
          getConfigValue('base-url') ||
          'https://my.helio.app';
        const url = new URL(
          `/api/public/v1/intercepts/${id}/track`,
          baseUrl,
        );
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new HelioApiError(res.status, await res.text());
        const data = await res.json();
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );
}
