/**
 * Pure guard logic for Context Bonsai prune and retrieve operations.
 *
 * Per the shared spec, guards MUST run before any mutation. A failure is
 * deterministic plain text and MUST leave transcript state untouched. This
 * module contains only pure data validation; persistence, I/O, and transcript
 * mutation live elsewhere.
 */

/**
 * Minimal transcript message shape used by the guards and pattern resolver.
 *
 * Hosts map their internal turn representation into this structure. `id` is a
 * stable identifier chosen by the host (session-entry id, content-hash, etc.).
 * `searchText` is the already-stabilized text representation used for pattern
 * matching — synthetic rendering-only content is expected to be excluded.
 */
export interface TranscriptMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'tool' | 'system';
  readonly searchText: string;
  /** Optional: true if this message is inside an already-pruned range. */
  readonly inPrunedRange?: boolean;
  /** Optional: true if this message represents an incomplete/malformed tool call. */
  readonly isIncompleteToolCall?: boolean;
  /**
   * true if this message is a prior `mcp_context-bonsai_context-bonsai-prune`
   * tool-use wrapper; resolver MUST exclude these from ambiguous match counts.
   */
  readonly isPruneWrapper?: boolean;
  /**
   * Optional per-turn monotonic step identifier. If two messages share the
   * same step, the guard treats them as belonging to the same model step and
   * rejects same-step retrieve.
   */
  readonly stepId?: string;
}

/**
 * Minimal structural shape used to detect prior prune-tool wrapper messages.
 * Kept narrow on purpose so callers in different agents can pass through
 * their own richer tool-call record types via structural typing.
 */
export interface ToolCallRecord {
  readonly name: string;
}

/** The MCP-qualified tool name for the bonsai prune wrapper in Gemini CLI. */
const PRUNE_WRAPPER_TOOL_NAME = 'mcp_context-bonsai_context-bonsai-prune';

/**
 * Return true iff the supplied record carries a prior prune-tool wrapper
 * call. Tolerates a missing `toolCalls` array (returns false). Used to mark
 * `TranscriptMessage.isPruneWrapper` during snapshot construction so the
 * resolver can exclude wrappers from ambiguous match counts on retry.
 */
export function isPruneToolWrapperRecord(record: {
  toolCalls?: readonly ToolCallRecord[];
}): boolean {
  const calls = record.toolCalls;
  if (!calls) return false;
  for (const tc of calls) {
    if (tc?.name === PRUNE_WRAPPER_TOOL_NAME) return true;
  }
  return false;
}

export interface PruneArgs {
  readonly fromPattern: string;
  readonly toPattern: string;
  readonly summary: string;
  readonly indexTerms: readonly string[];
  readonly reason?: string;
}

export interface ResolvedBoundary {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startId: string;
  readonly endId: string;
}

export type GuardResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * Validate structural correctness of prune arguments. Does not resolve
 * patterns — that is a separate step that requires transcript access.
 */
export function validatePruneArgs(args: PruneArgs): GuardResult<PruneArgs> {
  if (typeof args.fromPattern !== 'string' || args.fromPattern.length === 0) {
    return { ok: false, error: 'from_pattern is required and must be a non-empty string.' };
  }
  if (typeof args.toPattern !== 'string' || args.toPattern.length === 0) {
    return { ok: false, error: 'to_pattern is required and must be a non-empty string.' };
  }
  if (typeof args.summary !== 'string' || args.summary.trim().length === 0) {
    return { ok: false, error: 'summary is required and must be a non-empty string.' };
  }
  if (!Array.isArray(args.indexTerms) || args.indexTerms.length === 0) {
    return { ok: false, error: 'index_terms must be a non-empty array of non-empty strings.' };
  }
  for (const t of args.indexTerms) {
    if (typeof t !== 'string' || t.trim().length === 0) {
      return {
        ok: false,
        error: 'index_terms must be a non-empty array of non-empty strings.',
      };
    }
  }
  if (args.reason !== undefined && typeof args.reason !== 'string') {
    return { ok: false, error: 'reason, if provided, must be a string.' };
  }
  return { ok: true, value: args };
}

/**
 * Resolve `from_pattern` / `to_pattern` to exactly one message each, producing
 * a contiguous inclusive range. Ambiguous or unresolved matches fail.
 *
 * Pattern semantics:
 *   - Case-sensitive substring match against `searchText`.
 *   - `from_pattern` must match exactly one message, and so must `to_pattern`.
 *   - The resolved start must precede or equal the resolved end.
 *   - The resolved range must not cut through incomplete/malformed tool calls.
 *   - The resolved range must not start or end inside an already-pruned range.
 */
export function resolveBoundary(
  transcript: readonly TranscriptMessage[],
  args: PruneArgs,
): GuardResult<ResolvedBoundary> {
  const fromMatches: number[] = [];
  const toMatches: number[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const m = transcript[i];
    if (!m) continue;
    if (m.searchText.includes(args.fromPattern)) fromMatches.push(i);
    if (m.searchText.includes(args.toPattern)) toMatches.push(i);
  }

  if (fromMatches.length === 0) {
    return {
      ok: false,
      error: `from_pattern did not match any message: ${args.fromPattern}`,
    };
  }
  // When more than one message matches, exclude prior prune-tool wrappers
  // before reporting ambiguity. Spec: cross-agent Pattern Matching Contract
  // (commit cb61f00) — wrappers MUST NOT be counted as ambiguous candidates.
  let fromIndex: number;
  if (fromMatches.length === 1) {
    fromIndex = fromMatches[0] as number;
  } else {
    const fromSurvivors = fromMatches.filter(
      (i) => !transcript[i]?.isPruneWrapper,
    );
    if (fromSurvivors.length === 1) {
      fromIndex = fromSurvivors[0] as number;
    } else {
      return {
        ok: false,
        error:
          `from_pattern is ambiguous (matched ${fromMatches.length} messages). ` +
          'Refine the pattern to uniquely identify one message.',
      };
    }
  }
  if (toMatches.length === 0) {
    return {
      ok: false,
      error: `to_pattern did not match any message: ${args.toPattern}`,
    };
  }
  let toIndex: number;
  if (toMatches.length === 1) {
    toIndex = toMatches[0] as number;
  } else {
    const toSurvivors = toMatches.filter(
      (i) => !transcript[i]?.isPruneWrapper,
    );
    if (toSurvivors.length === 1) {
      toIndex = toSurvivors[0] as number;
    } else {
      return {
        ok: false,
        error:
          `to_pattern is ambiguous (matched ${toMatches.length} messages). ` +
          'Refine the pattern to uniquely identify one message.',
      };
    }
  }

  const startIndex = fromIndex;
  const endIndex = toIndex;
  if (startIndex > endIndex) {
    return {
      ok: false,
      error:
        'Resolved from_pattern occurs after to_pattern; the range must be non-inverted.',
    };
  }

  const start = transcript[startIndex];
  const end = transcript[endIndex];
  if (!start || !end) {
    return { ok: false, error: 'Internal error: resolved boundary messages missing.' };
  }
  if (start.inPrunedRange) {
    return {
      ok: false,
      error: 'from_pattern resolved inside an already-pruned range.',
    };
  }
  if (end.inPrunedRange) {
    return {
      ok: false,
      error: 'to_pattern resolved inside an already-pruned range.',
    };
  }

  for (let i = startIndex; i <= endIndex; i++) {
    const m = transcript[i];
    if (!m) continue;
    if (m.isIncompleteToolCall) {
      return {
        ok: false,
        error:
          'Resolved range would cut through an incomplete or malformed ' +
          'tool-call sequence. Prune a different range.',
      };
    }
  }

  return {
    ok: true,
    value: {
      startIndex,
      endIndex,
      startId: start.id,
      endId: end.id,
    },
  };
}

export interface SameStepGuardInput {
  readonly anchorStepId: string | undefined;
  readonly currentStepId: string | undefined;
}

/**
 * Reject retrieve calls made in the same model step that created the archive.
 * Returns ok=true if the guard passes (different step, or either step id is
 * missing and therefore cannot be compared reliably).
 */
export function checkSameStep(input: SameStepGuardInput): GuardResult<void> {
  if (!input.anchorStepId || !input.currentStepId) {
    // Cannot assert same-step without both ids; be permissive to avoid
    // false negatives on hosts that do not expose step identifiers.
    return { ok: true, value: undefined };
  }
  if (input.anchorStepId === input.currentStepId) {
    return {
      ok: false,
      error:
        'Same-step retrieve rejected: retrieval cannot run in the same ' +
        'model step that created the archive.',
    };
  }
  return { ok: true, value: undefined };
}
