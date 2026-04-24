/**
 * Stdio MCP server implementing `context-bonsai-prune` and `context-bonsai-retrieve`.
 *
 * The server is transport only. Transcript mutation happens on the agent side
 * (via the hook translator seam). Here we:
 *
 *   - Validate tool input against the shared guard contract.
 *   - Persist archive records to the sidecar JSON store.
 *   - Return deterministic plain-text results / errors.
 *
 * Transcript pattern resolution is the responsibility of the agent-repo
 * bootstrap, which supplies a resolver function when constructing the tool
 * handlers via `createBonsaiToolHandlers`. For standalone stdio usage (agent
 * repo wires it as a built-in MCP server pointing at `process.execPath`), the
 * resolver is supplied out-of-band through an environment hand-off: the
 * resolver runs on the host side via a companion read-only endpoint, and the
 * server works against whatever transcript snapshot the host persists.
 *
 * For v1 the server runs in a simplified "state-only" mode: it persists and
 * retrieves archive metadata keyed by anchor id and exposes deterministic
 * error text for guard failures. The actual transcript mutation is layered on
 * top by the agent-repo hook translator seam using the same placeholder
 * schema from `./placeholder.js`.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ArchiveStore } from './archive-store.js';
import {
  checkSameStep,
  type PruneArgs,
  validatePruneArgs,
} from './guards.js';
import type { BonsaiPlaceholder } from './placeholder.js';
import { renderPlaceholderText } from './placeholder.js';

export interface BonsaiServerOptions {
  readonly baseDir: string;
  readonly sessionId: string;
  /** Optional clock override for tests. */
  readonly now?: () => Date;
  /**
   * Optional hook so the host can correlate a `stepId` into archive records.
   * When omitted, same-step guard is a no-op on retrieve.
   */
  readonly currentStepId?: () => string | undefined;
}

export interface BonsaiToolCallResult {
  readonly isError: boolean;
  readonly content: ReadonlyArray<{ type: 'text'; text: string }>;
}

/**
 * Build tool-handler callbacks that implement the shared prune/retrieve
 * contract against an `ArchiveStore`.
 *
 * This is factored out so tests and the agent-repo MCP transport can share the
 * same guard + persistence logic without spinning up stdio.
 */
export function createBonsaiToolHandlers(opts: BonsaiServerOptions): {
  readonly store: ArchiveStore;
  handlePrune(input: unknown): Promise<BonsaiToolCallResult>;
  handleRetrieve(input: unknown): Promise<BonsaiToolCallResult>;
} {
  const store = new ArchiveStore({
    baseDir: opts.baseDir,
    sessionId: opts.sessionId,
  });
  const now = opts.now ?? (() => new Date());
  const currentStepId = opts.currentStepId ?? (() => undefined);

  async function handlePrune(
    input: unknown,
  ): Promise<BonsaiToolCallResult> {
    const parsed = parsePruneInput(input);
    if (!parsed.ok) return errorResult(parsed.error);

    const validated = validatePruneArgs(parsed.value);
    if (!validated.ok) return errorResult(validated.error);

    const args = validated.value;

    // Per shared-spec §2: pattern resolution MUST run agent-side before the
    // tool call is dispatched. The server is pure transport; it never sees
    // raw patterns. The host is required to supply resolved `anchor_id` /
    // `range_end_id` derived from its own transcript by calling
    // `resolveBoundary` (see `guards.ts`) before invoking this tool. If the
    // host omits them, we fail deterministically — a silent fallback to
    // patterns-as-ids would silently mutate archive state on ambiguous input.
    const obj = input as Record<string, unknown>;
    const rawAnchor = obj['anchor_id'];
    const rawEnd = obj['range_end_id'];
    if (typeof rawAnchor !== 'string' || rawAnchor.length === 0) {
      return errorResult(
        'anchor_id is required. The host must resolve patterns to a unique ' +
          'message id before calling context-bonsai-prune (see guards.resolveBoundary).',
      );
    }
    if (typeof rawEnd !== 'string' || rawEnd.length === 0) {
      return errorResult(
        'range_end_id is required. The host must resolve patterns to a unique ' +
          'message id before calling context-bonsai-prune (see guards.resolveBoundary).',
      );
    }
    const anchorId = rawAnchor;
    const rangeEndId = rawEnd;

    const existing = await store.findByAnchor(anchorId);
    if (existing) {
      return errorResult(
        `An archive already exists for anchor ${anchorId}. Retrieve it or ` +
          'choose a different range.',
      );
    }

    const stepId = currentStepId();
    await store.add({
      anchorId,
      rangeEndId,
      summary: args.summary,
      indexTerms: args.indexTerms,
      reason: args.reason,
      createdAt: now().toISOString(),
      stepId,
    });

    const placeholder: BonsaiPlaceholder = {
      kind: 'context-bonsai-placeholder',
      anchorId,
      rangeEndId,
      summary: args.summary,
      indexTerms: args.indexTerms,
      reason: args.reason,
    };

    return successResult(
      [
        `Archived range ${anchorId} to ${rangeEndId}.`,
        renderPlaceholderText(placeholder),
      ].join('\n\n'),
    );
  }

  async function handleRetrieve(
    input: unknown,
  ): Promise<BonsaiToolCallResult> {
    const obj = (input ?? {}) as Record<string, unknown>;
    const anchorId = obj['anchor_id'];
    if (typeof anchorId !== 'string' || anchorId.length === 0) {
      return errorResult(
        'anchor_id is required and must be a non-empty string.',
      );
    }
    const record = await store.findByAnchor(anchorId);
    if (!record) {
      return errorResult(`No archive found for anchor_id ${anchorId}.`);
    }

    const guard = checkSameStep({
      anchorStepId: record.stepId,
      currentStepId: currentStepId(),
    });
    if (!guard.ok) return errorResult(guard.error);

    const removed = await store.removeByAnchor(anchorId);
    if (!removed) {
      // Race / already retrieved — report deterministically.
      return errorResult(`No archive found for anchor_id ${anchorId}.`);
    }

    return successResult(
      `Restored range ${removed.anchorId} to ${removed.rangeEndId}.`,
    );
  }

  return { store, handlePrune, handleRetrieve };
}

/**
 * Tool names (exported so agent-repo allowlist carve-out can reference them).
 */
export const BONSAI_TOOLS = {
  prune: 'context-bonsai-prune',
  retrieve: 'context-bonsai-retrieve',
} as const;

/**
 * JSON Schemas for the prune and retrieve tools. These are published to MCP
 * clients on the `ListTools` response.
 */
export const BONSAI_TOOL_SCHEMAS = {
  prune: {
    type: 'object',
    required: [
      'from_pattern',
      'to_pattern',
      'summary',
      'index_terms',
      'anchor_id',
      'range_end_id',
    ],
    properties: {
      from_pattern: {
        type: 'string',
        description:
          'Unique substring identifying the first message of the range to archive. ' +
          'Used by the host to resolve the boundary; never consumed by the server.',
      },
      to_pattern: {
        type: 'string',
        description:
          'Unique substring identifying the last message of the range to archive. ' +
          'Used by the host to resolve the boundary; never consumed by the server.',
      },
      summary: {
        type: 'string',
        description: 'One-sentence summary of what the archived range covered.',
      },
      index_terms: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Short keyword breadcrumbs that let you decide later whether to retrieve.',
      },
      reason: {
        type: 'string',
        description:
          'Optional: why the range is safe to archive (e.g. task completed).',
      },
      anchor_id: {
        type: 'string',
        description:
          'Resolved id of the first message in the range. The host MUST resolve ' +
          'from_pattern to a unique message id via its transcript before calling ' +
          'this tool; raw patterns are not accepted as ids.',
      },
      range_end_id: {
        type: 'string',
        description:
          'Resolved id of the last message in the range. The host MUST resolve ' +
          'to_pattern to a unique message id via its transcript before calling ' +
          'this tool; raw patterns are not accepted as ids.',
      },
    },
    additionalProperties: false,
  },
  retrieve: {
    type: 'object',
    required: ['anchor_id'],
    properties: {
      anchor_id: {
        type: 'string',
        description:
          'Anchor identifier returned by a prior context-bonsai-prune call.',
      },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Build a configured MCP server bound to the given handlers.
 */
export function createBonsaiMcpServer(opts: BonsaiServerOptions): {
  server: Server;
  store: ArchiveStore;
} {
  const { store, handlePrune, handleRetrieve } =
    createBonsaiToolHandlers(opts);

  const server = new Server(
    {
      name: 'context-bonsai',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: BONSAI_TOOLS.prune,
        description:
          'Archive a contiguous conversation range (non-destructive). Replaces the range with a compact placeholder and persists metadata so the range can be retrieved later by anchor_id.',
        inputSchema: BONSAI_TOOL_SCHEMAS.prune,
      },
      {
        name: BONSAI_TOOLS.retrieve,
        description:
          'Restore a previously archived range by anchor_id. Removes the placeholder effect and returns the archived range to the visible transcript.',
        inputSchema: BONSAI_TOOL_SCHEMAS.retrieve,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    if (name === BONSAI_TOOLS.prune) {
      const result = await handlePrune(args);
      return { content: [...result.content], isError: result.isError };
    }
    if (name === BONSAI_TOOLS.retrieve) {
      const result = await handleRetrieve(args);
      return { content: [...result.content], isError: result.isError };
    }
    return {
      content: [
        { type: 'text', text: `Unknown tool: ${String(name)}` },
      ],
      isError: true,
    };
  });

  return { server, store };
}

function parsePruneInput(input: unknown): {
  ok: true;
  value: PruneArgs;
} | {
  ok: false;
  error: string;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'tool input must be a JSON object.' };
  }
  const o = input as Record<string, unknown>;
  const from = o['from_pattern'];
  const to = o['to_pattern'];
  const summary = o['summary'];
  const indexTerms = o['index_terms'];
  const reason = o['reason'];
  if (typeof from !== 'string') {
    return { ok: false, error: 'from_pattern is required and must be a string.' };
  }
  if (typeof to !== 'string') {
    return { ok: false, error: 'to_pattern is required and must be a string.' };
  }
  if (typeof summary !== 'string') {
    return { ok: false, error: 'summary is required and must be a string.' };
  }
  if (!Array.isArray(indexTerms)) {
    return {
      ok: false,
      error: 'index_terms is required and must be an array of strings.',
    };
  }
  const stringTerms: string[] = [];
  for (const t of indexTerms) {
    if (typeof t !== 'string') {
      return {
        ok: false,
        error: 'index_terms must contain only strings.',
      };
    }
    stringTerms.push(t);
  }
  const args: PruneArgs = {
    fromPattern: from,
    toPattern: to,
    summary,
    indexTerms: stringTerms,
    ...(typeof reason === 'string' ? { reason } : {}),
  };
  return { ok: true, value: args };
}

function successResult(text: string): BonsaiToolCallResult {
  return {
    isError: false,
    content: [{ type: 'text', text }],
  };
}

function errorResult(text: string): BonsaiToolCallResult {
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}

/**
 * Process entry point. Reads `CONTEXT_BONSAI_BASE_DIR` and
 * `CONTEXT_BONSAI_SESSION_ID` from the environment. Both are required; if
 * either is missing the server exits with a non-zero code (fail-closed).
 */
export async function runStdio(): Promise<void> {
  const baseDir = process.env['CONTEXT_BONSAI_BASE_DIR'];
  const sessionId = process.env['CONTEXT_BONSAI_SESSION_ID'];
  if (!baseDir || !sessionId) {
    // eslint-disable-next-line no-console
    console.error(
      'context-bonsai MCP server: CONTEXT_BONSAI_BASE_DIR and ' +
        'CONTEXT_BONSAI_SESSION_ID environment variables are required.',
    );
    process.exit(2);
  }

  const { server } = createBonsaiMcpServer({ baseDir, sessionId });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-run when invoked as a script. Guarded so importing from tests does not
// start the stdio transport.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  // Heuristic: when bundled as dist/mcp-server.js and launched as a binary,
  // argv[1] ends with `mcp-server.js`. Tests import this module, which leaves
  // argv[1] pointing at vitest.
  /mcp-server\.(m?js|ts)$/.test(process.argv[1]);
if (isDirectRun) {
  runStdio().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('context-bonsai MCP server failed:', err);
    process.exit(1);
  });
}
