/**
 * Structured archive-placeholder schema and rendering for Context Bonsai.
 *
 * The placeholder replaces a contiguous pruned range in the model-visible
 * transcript. It is authoritative across agent implementations; the Gemini
 * agent-repo hook translator must preserve this structure through request
 * translation rather than flattening to plain text only.
 */

/**
 * Canonical structured representation of an archive placeholder.
 *
 * The host-side hook translator must preserve these fields when rendering into
 * a `user`-role turn inside the LLM request, so that the model sees the full
 * semantic breadcrumb trail instead of a lossy single-string concatenation.
 */
export interface BonsaiPlaceholder {
  readonly kind: 'context-bonsai-placeholder';
  readonly anchorId: string;
  readonly rangeEndId: string;
  readonly summary: string;
  readonly indexTerms: readonly string[];
  readonly reason?: string;
}

/**
 * Render a placeholder to the canonical plain-text representation described in
 * the shared Context Bonsai spec. Used for fallback rendering, for test
 * assertions, and for plain-text tool-result output paths.
 */
export function renderPlaceholderText(p: BonsaiPlaceholder): string {
  const indexLine = p.indexTerms.join(', ');
  const body = [
    `[PRUNED: ${p.anchorId} to ${p.rangeEndId}]`,
    `Summary: ${p.summary}`,
    `Index: ${indexLine}`,
  ];
  if (p.reason && p.reason.trim().length > 0) {
    body.push(`Reason: ${p.reason}`);
  }
  return body.join('\n');
}

/**
 * Type guard: narrows an unknown value to a structured placeholder envelope.
 *
 * This matches the envelope written by the hook translator into the structured
 * LLM request; hosts that preserve the envelope can re-render from it, and
 * hosts that strip it down to plain text still get a valid rendering via
 * `renderPlaceholderText`.
 */
export function isBonsaiPlaceholder(v: unknown): v is BonsaiPlaceholder {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o['kind'] !== 'context-bonsai-placeholder') return false;
  if (typeof o['anchorId'] !== 'string' || o['anchorId'].length === 0) {
    return false;
  }
  if (typeof o['rangeEndId'] !== 'string' || o['rangeEndId'].length === 0) {
    return false;
  }
  if (typeof o['summary'] !== 'string') return false;
  const terms = o['indexTerms'];
  if (!Array.isArray(terms)) return false;
  for (const t of terms) {
    if (typeof t !== 'string') return false;
  }
  if (o['reason'] !== undefined && typeof o['reason'] !== 'string') {
    return false;
  }
  return true;
}
