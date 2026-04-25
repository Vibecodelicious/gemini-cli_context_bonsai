import { describe, expect, it } from 'vitest';

import {
  normalizeForStableJson,
  stableSerialize,
} from '../src/stable-json.js';

describe('stableSerialize', () => {
  it('sorts object keys lexicographically', () => {
    expect(stableSerialize({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it('produces identical output for objects with the same keys reordered', () => {
    const a = { foo: 'x', bar: 1, baz: [1, 2] };
    const b = { baz: [1, 2], bar: 1, foo: 'x' };
    expect(stableSerialize(a)).toBe(stableSerialize(b));
  });

  it('sorts nested object keys recursively', () => {
    const value = { outer: { z: 1, a: 2, m: { y: 1, x: 2 } } };
    expect(stableSerialize(value)).toBe(
      '{"outer":{"a":2,"m":{"x":2,"y":1},"z":1}}',
    );
  });

  it('replaces undefined inside arrays with null (matching JSON.stringify array hole semantics)', () => {
    expect(stableSerialize([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('drops undefined-valued keys from objects', () => {
    expect(stableSerialize({ a: 1, b: undefined, c: 2 })).toBe(
      '{"a":1,"c":2}',
    );
  });

  it('serializes bigint as a decimal string', () => {
    expect(stableSerialize({ n: 42n })).toBe('{"n":"42"}');
  });

  it('honors toJSON on objects that define it', () => {
    const obj = {
      toJSON() {
        return { synthetic: true, value: 7 };
      },
    };
    expect(stableSerialize(obj)).toBe('{"synthetic":true,"value":7}');
  });

  it('returns "null" for null inputs', () => {
    expect(stableSerialize(null)).toBe('null');
  });

  it('returns "null" for undefined inputs (top-level fallback)', () => {
    expect(stableSerialize(undefined)).toBe('null');
  });

  it('returns "{}" for an empty object', () => {
    expect(stableSerialize({})).toBe('{}');
  });

  it('returns "[]" for an empty array', () => {
    expect(stableSerialize([])).toBe('[]');
  });

  it('drops functions and symbols from objects', () => {
    const value = {
      a: 1,
      fn: () => 42,
      sym: Symbol('s'),
      b: 2,
    };
    expect(stableSerialize(value)).toBe('{"a":1,"b":2}');
  });
});

describe('normalizeForStableJson', () => {
  it('returns null for null', () => {
    expect(normalizeForStableJson(null)).toBe(null);
  });

  it('returns undefined for undefined / functions / symbols', () => {
    expect(normalizeForStableJson(undefined)).toBe(undefined);
    expect(normalizeForStableJson(() => 1)).toBe(undefined);
    expect(normalizeForStableJson(Symbol('s'))).toBe(undefined);
  });

  it('produces objects whose JSON.stringify output is byte-identical regardless of original key order', () => {
    const a = normalizeForStableJson({ b: 1, a: 2 });
    const b = normalizeForStableJson({ a: 2, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
