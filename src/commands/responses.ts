import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

export function registerResponsesCommand(program: Command): void {
  const cmd = program.command('responses').alias('r').description('Submit responses');

  cmd
    .command('create')
    .description('Submit a response to a test (requires Enterprise)')
    .requiredOption('--test-id <id>', 'Test UUID or report UUID')
    .requiredOption('--c-id <cid>', 'Client-provided unique response ID')
    .option('--email <email>', 'Participant email')
    .option('--name <name>', 'Participant name')
    .option('--company <company>', 'Participant company')
    .option('--age <age>', 'Age bracket (e.g. 25-34)')
    .option('--gender <gender>', 'Gender')
    .option('--education <education>', 'Education level')
    .option('--income <income>', 'Income bracket')
    .option('--country <country>', 'Country')
    .option('--state <state>', 'State')
    .option('--city <city>', 'City')
    .option('--zip <zip>', 'Zip code')
    .option('--section-responses <json>', 'Section responses as JSON array')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const body: Record<string, unknown> = {
          test_id: cmdOpts.testId,
          response: {
            c_id: cmdOpts.cId,
          } as Record<string, unknown>,
        };

        const response = body.response as Record<string, unknown>;
        if (cmdOpts.email) response.email = cmdOpts.email;
        if (cmdOpts.name) response.name = cmdOpts.name;
        if (cmdOpts.company) response.company = cmdOpts.company;
        if (cmdOpts.age) response.age = cmdOpts.age;
        if (cmdOpts.gender) response.gender = cmdOpts.gender;
        if (cmdOpts.education) response.education = cmdOpts.education;
        if (cmdOpts.income) response.income = cmdOpts.income;
        if (cmdOpts.country) response.country = cmdOpts.country;
        if (cmdOpts.state) response.state = cmdOpts.state;
        if (cmdOpts.city) response.city = cmdOpts.city;
        if (cmdOpts.zip) response.zip = cmdOpts.zip;

        if (cmdOpts.sectionResponses) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(cmdOpts.sectionResponses);
          } catch {
            throw new Error('--section-responses must be valid JSON');
          }
          if (!Array.isArray(parsed)) {
            throw new Error('--section-responses must be a JSON array');
          }
          response.section_responses_attributes = parsed;
        }

        const data = await client.post('responses', body);
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );
}
