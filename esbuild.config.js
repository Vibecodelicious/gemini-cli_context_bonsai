// Build entry points for the side repo:
// - dist/index.js         : library entry (re-exports for the agent-repo `file:` dep)
// - dist/bootstrap.js     : runtime hook registration helpers
// - dist/mcp-server.js    : stdio MCP server executable (referenced by agent repo)
// - dist/mcp-server-path.js : tiny helper that exports the absolute path to
//                             `dist/mcp-server.js`. The agent repo imports this
//                             so it can set `command: process.execPath, args: [path]`.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

/**
 * Shared build options for Node.js ESM output.
 */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  // Keep @modelcontextprotocol/sdk external so we use the installed dep rather
  // than bundling. Node built-ins are external by default with platform=node.
  external: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*'],
};

async function run() {
  // Library entry: re-exports pure-logic modules for consumers.
  await build({
    ...shared,
    entryPoints: [resolve(root, 'src/index.ts')],
    outfile: resolve(root, 'dist/index.js'),
  });

  // Bootstrap helpers (imported by agent-repo CLI startup).
  await build({
    ...shared,
    entryPoints: [resolve(root, 'src/bootstrap.ts')],
    outfile: resolve(root, 'dist/bootstrap.js'),
  });

  // MCP stdio server binary (referenced by agent repo via absolute path).
  await build({
    ...shared,
    entryPoints: [resolve(root, 'src/mcp-server.ts')],
    outfile: resolve(root, 'dist/mcp-server.js'),
    banner: {
      js: '#!/usr/bin/env node',
    },
  });

  // Tiny helper: exports the absolute on-disk path to dist/mcp-server.js so the
  // agent repo can wire it into its MCP bootstrap without hardcoding a path.
  await build({
    ...shared,
    entryPoints: [resolve(root, 'src/mcp-server-path.ts')],
    outfile: resolve(root, 'dist/mcp-server-path.js'),
  });
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
