import { readFileSync } from 'node:fs';
import { HelioApiError } from './types.js';

export function isJsonMode(): boolean {
  return process.env.__HELIO_OUTPUT === 'json';
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(
  rows: Record<string, unknown>[],
  columns?: string[],
): void {
  if (rows.length === 0) {
    console.log('No results.');
    return;
  }
  const cols = columns || Object.keys(rows[0]);
  const widths = cols.map(c =>
    Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)),
  );

  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const separator = widths.map(w => '-'.repeat(w)).join('  ');
  console.log(header);
  console.log(separator);
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

export function printKeyValue(obj: Record<string, unknown>): void {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    console.log('(empty)');
    return;
  }
  const maxKey = Math.max(...keys.map(k => k.length));
  for (const [key, value] of Object.entries(obj)) {
    const displayValue =
      typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : String(value ?? '');
    console.log(`${key.padEnd(maxKey)}  ${displayValue}`);
  }
}

export function handleError(err: unknown): never {
  if (err instanceof HelioApiError) {
    if (isJsonMode()) {
      printJson({ error: err.message, code: err.status, details: err.body });
    } else {
      console.error(`Error ${err.status}: ${err.message}`);
    }
  } else if (err instanceof Error) {
    if (isJsonMode()) {
      printJson({ error: err.message });
    } else {
      console.error(`Error: ${err.message}`);
    }
  } else {
    if (isJsonMode()) {
      printJson({ error: String(err) });
    } else {
      console.error(String(err));
    }
  }
  process.exit(1);
}

export function parseJsonOrFile(value: string): unknown {
  if (value.startsWith('@')) {
    const path = value.slice(1);
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${path}`);
      }
      throw new Error(`Invalid JSON in ${path}: ${(err as Error).message}`);
    }
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Invalid JSON. Pass inline JSON or @path/to/file.json');
  }
}

export function withErrorHandling<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      handleError(err);
    }
  };
}
