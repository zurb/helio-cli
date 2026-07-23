import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { HelioConfig } from './types.js';

export const CONFIG_DIR = join(homedir(), '.helio-cli');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function readConfig(): HelioConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

export function writeConfig(config: HelioConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(CONFIG_DIR, 0o700); } catch { /* may fail on some platforms */ }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  chmodSync(CONFIG_FILE, 0o600);
}

export function getConfigValue(key: string): string | undefined {
  const config = readConfig();
  return config[key as keyof HelioConfig];
}

export function setConfigValue(key: string, value: string): void {
  const config = readConfig();
  config[key as keyof HelioConfig] = value;
  writeConfig(config);
}

const VALID_KEYS: (keyof HelioConfig)[] = ['api-id', 'api-token', 'base-url'];

export function isValidConfigKey(key: string): key is keyof HelioConfig {
  return VALID_KEYS.includes(key as keyof HelioConfig);
}

export function validConfigKeys(): string[] {
  return [...VALID_KEYS];
}

export function resolveCredentials(opts: {
  apiId?: string;
  apiToken?: string;
  baseUrl?: string;
}): { apiId: string; apiToken: string; baseUrl: string } {
  const apiId =
    opts.apiId || process.env.HELIO_API_ID || getConfigValue('api-id');
  const apiToken =
    opts.apiToken || process.env.HELIO_API_TOKEN || getConfigValue('api-token');
  const baseUrl =
    opts.baseUrl ||
    process.env.HELIO_BASE_URL ||
    getConfigValue('base-url') ||
    'https://my.helio.app';

  if (!apiId || !apiToken) {
    throw new Error(
      'Missing API credentials. Set them via:\n' +
        '  helio-cli config set api-id <your-api-id>\n' +
        '  helio-cli config set api-token <your-api-token>\n' +
        'Or use env vars HELIO_API_ID and HELIO_API_TOKEN.',
    );
  }

  return { apiId, apiToken, baseUrl };
}
