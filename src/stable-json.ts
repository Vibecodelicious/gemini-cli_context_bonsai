/**
 * Deterministic JSON serialization helpers used by pattern-resolution search
 * text. Ported verbatim (behavior-preserving) from the OpenCode reference at
 * `opencode_context_bonsai_plugin/src/prune-pattern.ts:6-51`.
 *
 * Why this exists: the cross-agent spec's Pattern Matching Contract requires
 * tool-call name, input, and output to be reachable by pattern. Object keys
 * must serialize in a stable order so that matchers see byte-identical text
 * regardless of how the host produced the underlying object.
 *
 * Behavior summary:
 *   - Object keys sorted lexicographically.
 *   - `undefined` / functions / symbols are dropped from objects; in arrays
 *     they become `null` (matching `JSON.stringify` array semantics for holes).
 *   - `bigint` becomes its decimal string representation.
 *   - Values exposing `toJSON` are normalized via that representation.
 *   - Top-level `undefined` (or a value whose normalized form is undefined)
 *     serializes to the literal `'null'` rather than the JS string `'undefined'`.
 */

function normalizeForStableJson(value: unknown): unknown {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === 'bigint') {
    return String(value);
  }

  if (
    valueType === 'string' ||
    valueType === 'number' ||
    valueType === 'boolean'
  ) {
    return value;
  }

  if (
    valueType === 'undefined' ||
    valueType === 'function' ||
    valueType === 'symbol'
  ) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = normalizeForStableJson(item);
      return normalized === undefined ? null : normalized;
    });
  }

  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return normalizeForStableJson(
      (value as { toJSON: () => unknown }).toJSON(),
    );
  }

  const sortedEntries = Object.keys(value as Record<string, unknown>)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => {
      const normalized = normalizeForStableJson(
        (value as Record<string, unknown>)[key],
      );
      return [key, normalized] as const;
    })
    .filter(([, normalized]) => normalized !== undefined);

  return Object.fromEntries(sortedEntries);
}

export function stableSerialize(value: unknown): string {
  const normalized = normalizeForStableJson(value);
  const serialized = JSON.stringify(normalized);
  return serialized === undefined ? 'null' : serialized;
}

export { normalizeForStableJson };
