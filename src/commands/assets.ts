import { statSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Command } from 'commander';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printKeyValue, withErrorHandling } from '../output.js';
import type { GlobalOptions } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

interface AssetItem {
  id: number;
  name: string;
  type: string;
  status: string;
  width: number | null;
  height: number | null;
  url: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

interface AssetListResponse {
  assets: AssetItem[];
  pagination: { limit: number; offset: number; total: number };
}

const UPLOAD_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Client-side gate matching the server's rules (jpg/jpeg/png/gif, 10MB) so bad
// uploads fail fast without a network round-trip. Exported for tests.
export function validateUploadFile(file: string): { mime: string; size: number } {
  const ext = extname(file).toLowerCase();
  const mime = UPLOAD_MIME_TYPES[ext];
  if (!mime) {
    throw new Error(`Unsupported file type "${ext || file}". Supported types: jpg, jpeg, png, gif.`);
  }
  let size: number;
  try {
    size = statSync(file).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${file}`);
    }
    throw err;
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is ${(size / 1024 / 1024).toFixed(1)}MB — the maximum upload size is 10MB.`);
  }
  return { mime, size };
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAssetRow(a: AssetItem): string {
  const dims = a.width && a.height ? `${a.width}x${a.height}` : a.status;
  return `  \x1b[1m${a.name}\x1b[0m\n    id ${a.id}  \x1b[90m·  ${a.type}, ${dims}  ·  uploaded ${formatDate(a.created_at)}\x1b[0m`;
}

function printAsset(a: AssetItem): void {
  printKeyValue({
    id: a.id,
    name: a.name,
    type: a.type,
    status: a.status,
    dimensions: a.width && a.height ? `${a.width}x${a.height}` : '(pending)',
    url: a.url ?? '(processing)',
    thumbnail_url: a.thumbnail_url ?? '(processing)',
    created_at: a.created_at,
  });
}

export function registerAssetsCommand(program: Command): void {
  const cmd = program.command('assets').description('Manage account assets (images for question stimuli)');

  cmd
    .command('list')
    .description('List assets — use an asset id with `tests add-question --asset-id`')
    .option('--type <type>', 'Filter by type: image, video or audio')
    .option('--name <search>', 'Filter by filename (case-insensitive partial match)')
    .option('--limit <n>', 'Page size (default 25, max 100)')
    .option('--offset <n>', 'Records to skip')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {};
        if (cmdOpts.type) params.type = cmdOpts.type;
        if (cmdOpts.name) params.name = cmdOpts.name;
        if (cmdOpts.limit) params.limit = cmdOpts.limit;
        if (cmdOpts.offset) params.offset = cmdOpts.offset;

        const data = (await client.get('assets', params)) as AssetListResponse;
        if (isJsonMode()) {
          printJson(data);
          return;
        }
        if (!data.assets?.length) {
          console.log('No assets found.');
          return;
        }
        const { limit, offset, total } = data.pagination;
        console.log(`\x1b[1m${data.assets.length} of ${total} asset${total === 1 ? '' : 's'}\x1b[0m (limit ${limit}, offset ${offset})\n`);
        for (const a of data.assets) {
          console.log(formatAssetRow(a));
        }
      }),
    );

  cmd
    .command('get <id>')
    .description('Show one asset, including its signed URLs')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`assets/${id}`)) as { asset: AssetItem };
        if (isJsonMode()) {
          printJson(data);
          return;
        }
        printAsset(data.asset);
      }),
    );

  cmd
    .command('upload <file>')
    .description('Upload an image (jpg, jpeg, png, gif; max 10MB)')
    .action(
      withErrorHandling(async (file: string) => {
        const { mime } = validateUploadFile(file);

        const form = new FormData();
        form.append('file', new Blob([readFileSync(file)], { type: mime }), basename(file));

        const client = makeClient(program);
        const data = (await client.postMultipart('assets', form)) as { asset: AssetItem };
        if (isJsonMode()) {
          printJson(data);
          return;
        }
        console.log('Uploaded. Processing usually takes a few seconds.\n');
        printAsset(data.asset);
        console.log(`\nUse it as a question stimulus with: helio-cli tests add-question <test-id> --asset-id ${data.asset.id}`);
      }),
    );
}
