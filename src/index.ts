/**
 * Public API re-exports for the Context Bonsai side repo.
 *
 * The Gemini CLI agent repo pulls this package in via a `file:` dependency and
 * imports:
 *
 *   - `registerBonsaiHooks`, `applyBonsaiBeforeModel` — runtime hook wiring
 *   - `BONSAI_GUIDANCE` — the session-start guidance prelude
 *   - `BONSAI_TOOLS`, `BONSAI_TOOL_SCHEMAS` — tool identity + schemas
 *   - `getMcpServerPath` — absolute path to the built stdio server
 *   - `renderPlaceholderText`, `isBonsaiPlaceholder`, `BonsaiPlaceholder` — the
 *     structured-placeholder contract preserved by the hook translator seam
 *
 * Only this entry point is covered by semver guarantees for the agent-repo
 * consumer; everything else is internal.
 */

export {
  applyBonsaiBeforeModel,
  BONSAI_GUIDANCE,
  registerBonsaiHooks,
  type BonsaiHookAdapter,
  type BonsaiRequestContext,
  type BonsaiTurn,
} from './bootstrap.js';

export {
  BONSAI_TOOLS,
  BONSAI_TOOL_SCHEMAS,
  createBonsaiMcpServer,
  createBonsaiToolHandlers,
  type BonsaiServerOptions,
  type BonsaiToolCallResult,
} from './mcp-server.js';

export {
  ArchiveStore,
  sanitizeFilenamePart,
  type ArchiveFile,
  type ArchiveRecord,
  type ArchiveStoreOptions,
} from './archive-store.js';

export {
  checkSameStep,
  resolveBoundary,
  validatePruneArgs,
  type GuardResult,
  type PruneArgs,
  type ResolvedBoundary,
  type SameStepGuardInput,
  type TranscriptMessage,
} from './guards.js';

export {
  computeGauge,
  gaugeText,
  severityForPercent,
  type GaugeInput,
  type GaugeReading,
  type GaugeSeverity,
} from './gauge.js';

export {
  isBonsaiPlaceholder,
  renderPlaceholderText,
  type BonsaiPlaceholder,
} from './placeholder.js';

export { getMcpServerPath, mcpServerPath } from './mcp-server-path.js';

export { normalizeForStableJson, stableSerialize } from './stable-json.js';
