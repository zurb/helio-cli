import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/update-check-worker.ts'],
  // Keep each entry self-contained: the worker is spawned as a standalone
  // script and the published files list has no shared chunks.
  splitting: false,
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
