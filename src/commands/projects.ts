import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

interface ProjectListItem {
  id: string;
  name: string;
  tests_count: number;
  responses_count: number;
  tags: string[];
  created_at: string;
  last_activity_at: string;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatProjectRow(p: ProjectListItem): string {
  const tags = p.tags?.length ? ` \x1b[90m[${p.tags.join(', ')}]\x1b[0m` : '';
  const tests = `${p.tests_count} test${p.tests_count === 1 ? '' : 's'}`;
  const responses = `${p.responses_count} response${p.responses_count === 1 ? '' : 's'}`;
  const activity = formatDate(p.last_activity_at);
  return `  \x1b[1m${p.name}\x1b[0m${tags}\n    ${p.id}\n    ${tests}, ${responses}  \x1b[90m·  last activity ${activity}\x1b[0m`;
}

export function registerProjectsCommand(program: Command): void {
  const cmd = program.command('projects').alias('p').description('Manage projects');

  cmd
    .command('list')
    .description('List all projects')
    .option('--name <search>', 'Filter by name (case-insensitive partial match)')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.name) params.name = cmdOpts.name;
        const data = (await client.get('projects', params)) as {
          projects: ProjectListItem[];
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          if (!data.projects?.length) {
            console.log('No projects found.');
            return;
          }
          console.log(`\x1b[1m${data.projects.length} project${data.projects.length === 1 ? '' : 's'}\x1b[0m\n`);
          for (const p of data.projects) {
            console.log(formatProjectRow(p));
            console.log();
          }
        }
      }),
    );

  cmd
    .command('get <id>')
    .description('Get project details')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`projects/${id}`)) as {
          project: Record<string, unknown>;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data.project);
        }
      }),
    );

  cmd
    .command('tests <id>')
    .description('List tests in a project')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`projects/${id}/tests`)) as {
          tests: { id: string; name: string; status: string; responses_count: number; sections_count: number; updated_at: string }[];
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          if (!data.tests?.length) {
            console.log('No tests in this project.');
            return;
          }
          const statusColors: Record<string, string> = {
            draft: '\x1b[33m',
            running: '\x1b[32m',
            complete: '\x1b[36m',
            paused: '\x1b[33m',
            stopped: '\x1b[31m',
          };
          console.log(`\x1b[1m${data.tests.length} test${data.tests.length === 1 ? '' : 's'}\x1b[0m\n`);
          for (const t of data.tests) {
            const color = statusColors[t.status] ?? '\x1b[90m';
            const status = `${color}(${t.status})\x1b[0m`;
            const responses = `${t.responses_count} response${t.responses_count === 1 ? '' : 's'}`;
            const sections = `${t.sections_count} question${t.sections_count === 1 ? '' : 's'}`;
            const updated = formatDate(t.updated_at);
            console.log(`  \x1b[1m${t.name}\x1b[0m ${status}`);
            console.log(`    ${t.id}`);
            console.log(`    ${sections}, ${responses}  \x1b[90m·  updated ${updated}\x1b[0m`);
            console.log();
          }
        }
      }),
    );
}
