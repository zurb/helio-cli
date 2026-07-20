import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { registerAuthCommand } from './commands/auth.js';
import { registerConfigCommand } from './commands/config-cmd.js';
import { registerStatusCommand } from './commands/status.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerGuideCommand } from './commands/guide.js';
import { registerTestsCommand } from './commands/tests.js';
import { registerProjectsCommand } from './commands/projects.js';
import { registerParticipantsCommand } from './commands/participants.js';
import { registerCustomListsCommand } from './commands/custom-lists.js';
import { registerAudiencesCommand } from './commands/audiences.js';
import { registerInterceptsCommand } from './commands/intercepts.js';
import { registerResponsesCommand } from './commands/responses.js';
import { registerAssetsCommand } from './commands/assets.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string };

// Detect --output json before Commander parses so parse-time errors are also JSON.
const rawIdx = process.argv.indexOf('--output');
if ((rawIdx !== -1 && process.argv[rawIdx + 1] === 'json') || process.argv.includes('-o') && process.argv[process.argv.indexOf('-o') + 1] === 'json') {
  process.env.__HELIO_OUTPUT = 'json';
}

const program = new Command();

program
  .name('helio-cli')
  .description('CLI for the Helio Public API')
  .version(pkg.version)
  .option('--output <format>', 'Output format: json or text', 'text')
  .option('--api-id <id>', 'API ID (overrides config/env)')
  .option('--api-token <token>', 'API token (overrides config/env)')
  .option('--base-url <url>', 'Base URL (default: https://my.helio.app)')
  .exitOverride()
  .configureOutput({
    writeErr: str => {
      if (process.env.__HELIO_OUTPUT !== 'json') {
        process.stderr.write(str);
      }
    },
    writeOut: str => process.stdout.write(str),
    outputError: (str, _write) => {
      const cleaned = str.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (process.env.__HELIO_OUTPUT === 'json') {
        console.log(JSON.stringify({ error: cleaned }));
      } else {
        process.stderr.write(str);
      }
    },
  })
  .hook('preAction', command => {
    const root = command.opts();
    if (root.output === 'json') {
      process.env.__HELIO_OUTPUT = 'json';
    }
  });

// Core commands
registerAuthCommand(program);
registerConfigCommand(program);
registerStatusCommand(program);
registerDoctorCommand(program);
registerGuideCommand(program);

// Resource commands
registerTestsCommand(program);
registerProjectsCommand(program);
registerParticipantsCommand(program);
registerCustomListsCommand(program);
registerAudiencesCommand(program);
registerInterceptsCommand(program);
registerResponsesCommand(program);
registerAssetsCommand(program);

program.parseAsync().catch((err: Error & { exitCode?: number }) => {
  // Commander throws on parse errors with exitOverride(); outputError already printed the message.
  process.exit(err.exitCode ?? 1);
});
