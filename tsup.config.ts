import { chmod } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: ['!cli.js'],
    treeshake: true,
    target: 'node18',
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    async onSuccess() {
      await chmod('dist/cli.js', 0o755);
    },
  },
]);
