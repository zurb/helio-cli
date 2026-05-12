import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Command } from 'commander';
import { readConfig, writeConfig, setConfigValue, getConfigValue } from '../config.js';
import { HelioClient } from '../client.js';
import { HelioApiError } from '../types.js';
import { isJsonMode, printJson, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function resolveBaseUrl(program: Command): string {
  const opts = program.opts<GlobalOptions>();
  return (
    opts.baseUrl ||
    process.env.HELIO_BASE_URL ||
    getConfigValue('base-url') ||
    'https://my.helio.app'
  );
}

async function readSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const { stdin } = process;

  // Non-TTY: read from piped stdin without raw mode
  if (!stdin.isTTY) {
    return new Promise(resolve => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', chunk => { data += chunk; });
      stdin.on('end', () => resolve(data.trim()));
      stdin.resume();
    });
  }

  // TTY: read character-by-character with echo suppressed
  return new Promise(resolve => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const onData = (char: string) => {
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
          break;
        case '\u0003':
          stdin.setRawMode(wasRaw ?? false);
          process.exit(130);
          break;
        case '\u007F':
        case '\b':
          input = input.slice(0, -1);
          break;
        default:
          input += char;
          break;
      }
    };
    stdin.on('data', onData);
  });
}

export function registerAuthCommand(program: Command): void {
  const cmd = program.command('auth').description('Authenticate with the Helio API');

  cmd
    .command('login')
    .description('Set up API credentials interactively')
    .option('--api-id <id>', 'API ID (skip prompt)')
    .option('--api-token <token>', 'API token (skip prompt)')
    .action(
      withErrorHandling(async (cmdOpts) => {
        let apiId: string = cmdOpts.apiId || '';
        let apiToken: string = cmdOpts.apiToken || '';

        if (!apiId || !apiToken) {
          const credentialUrl = `${resolveBaseUrl(program)}/account/organization`;
          console.log('\nGet your API credentials from:');
          console.log(`  \x1b[4m${credentialUrl}\x1b[0m`);
          console.log('  (scroll down to the API section)\n');

          const rl = createInterface({ input: stdin, output: stdout });
          try {
            if (!apiId) {
              apiId = (await rl.question('API ID: ')).trim();
            }
          } finally {
            rl.close();
          }
          if (!apiToken) {
            apiToken = (await readSecret('API Token: ')).trim();
          }
        }

        if (!apiId || !apiToken) {
          throw new Error('Both API ID and API Token are required.');
        }

        // Validate credentials against the API
        const baseUrl = resolveBaseUrl(program);
        const client = new HelioClient({ baseUrl, apiId, apiToken });

        if (!isJsonMode()) {
          process.stdout.write('Verifying credentials... ');
        }

        await client.get('status');

        // Credentials valid — save them
        setConfigValue('api-id', apiId);
        setConfigValue('api-token', apiToken);

        if (isJsonMode()) {
          printJson({ status: 'authenticated', api_id: apiId });
        } else {
          console.log('ok');
          console.log(`Credentials saved. You're authenticated as ${apiId}.`);
        }
      }),
    );

  cmd
    .command('status')
    .description('Check current authentication status')
    .action(
      withErrorHandling(async () => {
        const config = readConfig();
        const apiId = config['api-id'];
        const apiToken = config['api-token'];
        const baseUrl = resolveBaseUrl(program);

        if (!apiId || !apiToken) {
          if (isJsonMode()) {
            printJson({ authenticated: false, reason: 'no credentials configured' });
          } else {
            console.log('Not authenticated. Run `helio-cli auth login` to set up credentials.');
          }
          return;
        }

        const client = new HelioClient({ baseUrl, apiId, apiToken });
        try {
          await client.get('status');
          if (isJsonMode()) {
            printJson({ authenticated: true, api_id: apiId, base_url: baseUrl });
          } else {
            console.log(`Authenticated as ${apiId}`);
            console.log(`API endpoint: ${baseUrl}`);
          }
        } catch (err) {
          const isAuthError =
            err instanceof HelioApiError && (err.status === 401 || err.status === 403);
          const reason = isAuthError ? 'credentials rejected by API' : `API unreachable: ${(err as Error).message}`;
          if (isJsonMode()) {
            printJson({ authenticated: false, api_id: apiId, reason });
          } else {
            if (isAuthError) {
              console.log(`Credentials configured (${apiId}) but rejected by the API.`);
              console.log('Run `helio-cli auth login` to update credentials.');
            } else {
              console.log(`Credentials configured (${apiId}) but API is unreachable.`);
              console.log(`Error: ${(err as Error).message}`);
            }
          }
        }
      }),
    );

  cmd
    .command('logout')
    .description('Remove stored credentials')
    .action(
      withErrorHandling(async () => {
        const config = readConfig();
        delete config['api-id'];
        delete config['api-token'];

        writeConfig(config);

        if (isJsonMode()) {
          printJson({ status: 'logged out' });
        } else {
          console.log('Credentials removed.');
        }
      }),
    );
}
