import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateUploadFile } from './assets.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'helio-assets-test-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeFile = (name: string, bytes: number): string => {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(bytes));
  return path;
};

describe('validateUploadFile', () => {
  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['mock.png', 'image/png'],
    ['loop.gif', 'image/gif'],
  ])('accepts %s and resolves its mime type', (name, mime) => {
    const path = writeFile(name, 100);
    expect(validateUploadFile(path)).toEqual({ mime, size: 100 });
  });

  it('maps extensions case-insensitively', () => {
    const path = writeFile('SHOUTY.PNG', 10);
    expect(validateUploadFile(path).mime).toBe('image/png');
  });

  it('rejects unsupported extensions without touching the filesystem', () => {
    expect(() => validateUploadFile('/nonexistent/movie.mp4')).toThrow(/Unsupported file type "\.mp4"/);
    expect(() => validateUploadFile('/nonexistent/doc.pdf')).toThrow(/Supported types: jpg, jpeg, png, gif/);
  });

  it('rejects files with no extension, naming the file', () => {
    expect(() => validateUploadFile('noext')).toThrow(/Unsupported file type "noext"/);
  });

  it('rejects missing files with a friendly message', () => {
    expect(() => validateUploadFile(join(dir, 'ghost.png'))).toThrow(/File not found/);
  });

  it('accepts a file exactly at the 10MB limit', () => {
    const path = writeFile('exact.png', 10 * 1024 * 1024);
    expect(validateUploadFile(path).size).toBe(10 * 1024 * 1024);
  });

  it('rejects files over 10MB with the size in the message', () => {
    const path = writeFile('big.png', 10 * 1024 * 1024 + 1);
    expect(() => validateUploadFile(path)).toThrow(/maximum upload size is 10MB/);
  });
});
