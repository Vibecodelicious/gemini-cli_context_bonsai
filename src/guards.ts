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
   * Optional per-turn monotonic step identifier. If two messages share the
   * same step, the guard treats them as belonging to the same model step and
   * rejects same-step retrieve.
   */
  readonly stepId?: string;
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
  if (fromMatches.length > 1) {
    return {
      ok: false,
      error:
        `from_pattern is ambiguous (matched ${fromMatches.length} messages). ` +
        'Refine the pattern to uniquely identify one message.',
    };
  }
  if (toMatches.length === 0) {
    return {
      ok: false,
      error: `to_pattern did not match any message: ${args.toPattern}`,
    };
  }
  if (toMatches.length > 1) {
    return {
      ok: false,
      error:
        `to_pattern is ambiguous (matched ${toMatches.length} messages). ` +
        'Refine the pattern to uniquely identify one message.',
    };
  }

  const startIndex = fromMatches[0] as number;
  const endIndex = toMatches[0] as number;
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
