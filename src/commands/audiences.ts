import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

export const AUDIENCE_SOURCES = ['customer_list', 'enroll'] as const;

/**
 * Query params for GET /audiences. `source` selects which catalog: your
 * customer lists (default, unchanged) or Helio's active panel segments
 * (`enroll`, for advanced audiences). Either way the returned ids are exactly
 * what `--audiences` accepts on tests create/update. There is no combined
 * view — run once per source. Omitting `source` keeps older APIs working.
 */
export function buildAudienceListParams(opts: {
  page?: string;
  name?: string;
  recent?: boolean;
  source?: string;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (opts.source !== undefined) {
    if (!(AUDIENCE_SOURCES as readonly string[]).includes(opts.source)) {
      throw new Error(
        `Invalid --source "${opts.source}". Valid sources: ${AUDIENCE_SOURCES.join(', ')} (no combined view — run once per source)`,
      );
    }
    params.source = opts.source;
  }
  if (opts.recent) {
    if (opts.source === 'enroll') {
      throw new Error(
        '--recent sorts by last use in your tests, which only applies to customer lists — drop --recent with --source enroll',
      );
    }
    params.sort = 'recently_used';
  }
  if (opts.page) params.page = opts.page;
  if (opts.name) params.name = opts.name;
  return params;
}

// Enroll rows return these as null — a panel segment has no usage history in
// your account. Rendered as an em-dash: a 0 would read as a real count.
const NULLABLE_USAGE_COLUMNS = ['participants_count', 'tests_count', 'last_used_at'] as const;

export function prepareAudienceRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => {
    const out: Record<string, unknown> = { ...row };
    for (const col of NULLABLE_USAGE_COLUMNS) {
      if (out[col] === null || out[col] === undefined) out[col] = '—';
    }
    return out;
  });
}

export function registerAudiencesCommand(program: Command): void {
  const cmd = program.command('audiences').alias('a').description('Manage audiences');

  cmd
    .command('list')
    .description('List audiences (ids feed --audiences on tests create/update)')
    .option('--page <n>', 'Page number')
    .option('--name <name>', 'Filter by partial name match (case-insensitive)')
    .option('--recent', 'Sort by most recently used in a test first (customer lists only)')
    .option(
      '--source <source>',
      "Audience source: customer_list (default; your lists) or enroll (Helio's panel catalog, for advanced audiences)",
    )
    .action(
      withErrorHandling(async (cmdOpts) => {
        // Flag validation before credential resolution, so a bad --source
        // errors usefully even in an unauthenticated shell.
        const params = buildAudienceListParams({
          page: cmdOpts.page,
          name: cmdOpts.name,
          recent: cmdOpts.recent,
          source: cmdOpts.source,
        });
        const client = makeClient(program);

        const data = (await client.get('audiences', params)) as {
          audiences: Record<string, unknown>[];
          total_count: number;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(prepareAudienceRows(data.audiences), [
            'id',
            'name',
            'source',
            'participants_count',
            'tests_count',
            'last_used_at',
          ]);
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
