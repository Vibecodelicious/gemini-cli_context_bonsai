/**
 * Helper that resolves the absolute on-disk path to the built MCP server
 * artifact (`dist/mcp-server.js`).
 *
 * The agent repo consumes this from its MCP bootstrap so it can wire up the
 * built-in `context-bonsai` server with
 * `command: process.execPath, args: [mcpServerPath]`. We resolve relative to
 * this file so the lookup works no matter where the package is installed on
 * disk (workspace path, symlink, absolute file: dep, etc.).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute filesystem path of the built `mcp-server.js` entrypoint.
 *
 * Safe to call at import time: it is a pure path computation with no I/O.
 * The agent repo is expected to fail closed if this file is missing; see the
 * side-repo build step which emits it.
 */
export function getMcpServerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'mcp-server.js');
}

export const mcpServerPath: string = getMcpServerPath();
