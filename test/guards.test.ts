import { describe, it, expect } from 'vitest';

import {
  checkSameStep,
  isPruneToolWrapperRecord,
  resolveBoundary,
  validatePruneArgs,
  type PruneArgs,
  type TranscriptMessage,
} from '../src/guards.js';

const base: PruneArgs = {
  fromPattern: 'hello',
  toPattern: 'world',
  summary: 'summary',
  indexTerms: ['foo'],
};

describe('validatePruneArgs', () => {
  it('accepts canonical input', () => {
    const r = validatePruneArgs(base);
    expect(r.ok).toBe(true);
  });

  it('rejects empty from_pattern', () => {
    const r = validatePruneArgs({ ...base, fromPattern: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/from_pattern/);
  });

  it('rejects empty to_pattern', () => {
    const r = validatePruneArgs({ ...base, toPattern: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects whitespace-only summary', () => {
    const r = validatePruneArgs({ ...base, summary: '   ' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty index_terms', () => {
    const r = validatePruneArgs({ ...base, indexTerms: [] });
    expect(r.ok).toBe(false);
  });

  it('rejects whitespace index term', () => {
    const r = validatePruneArgs({ ...base, indexTerms: ['ok', '  '] });
    expect(r.ok).toBe(false);
  });

  it('accepts optional reason', () => {
    const r = validatePruneArgs({ ...base, reason: 'done' });
    expect(r.ok).toBe(true);
  });

  it('rejects non-string reason', () => {
    const r = validatePruneArgs({
      ...base,
      reason: 42 as unknown as string,
    });
    expect(r.ok).toBe(false);
  });
});

function tmsg(
  id: string,
  searchText: string,
  extras: Partial<TranscriptMessage> = {},
): TranscriptMessage {
  return {
    id,
    role: 'user',
    searchText,
    ...extras,
  };
}

describe('resolveBoundary', () => {
  const transcript: TranscriptMessage[] = [
    tmsg('m1', 'hello there'),
    tmsg('m2', 'middle stuff'),
    tmsg('m3', 'world ends here'),
    tmsg('m4', 'trailing chatter'),
  ];

  it('resolves unambiguous boundary', () => {
    const r = resolveBoundary(transcript, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startId).toBe('m1');
      expect(r.value.endId).toBe('m3');
      expect(r.value.startIndex).toBe(0);
      expect(r.value.endIndex).toBe(2);
    }
  });

  it('rejects ambiguous from_pattern', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'hello there'),
      tmsg('m2', 'hello again'),
      tmsg('m3', 'world'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ambiguous/);
  });

  it('rejects unmatched from_pattern', () => {
    const r = resolveBoundary(transcript, {
      ...base,
      fromPattern: 'nothing-here',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/did not match/);
  });

  it('rejects ambiguous to_pattern', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'hello there'),
      tmsg('m2', 'world one'),
      tmsg('m3', 'world two'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ambiguous/);
  });

  it('rejects inverted range', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'world ends here'),
      tmsg('m2', 'hello there'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-inverted|after/);
  });

  it('rejects range containing incomplete tool call', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'hello there'),
      tmsg('m2', 'pending tool', { isIncompleteToolCall: true }),
      tmsg('m3', 'world'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/incomplete|malformed/);
  });

  it('rejects boundary inside an already-pruned range', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'hello there', { inPrunedRange: true }),
      tmsg('m2', 'middle'),
      tmsg('m3', 'world'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pruned/);
  });
});

describe('resolveBoundary prune-wrapper filter', () => {
  // When ambiguity arises from a prior prune-tool wrapper colliding with a
  // genuine retry pattern, the resolver MUST exclude wrappers from the match
  // count. Spec: cross-agent Pattern Matching Contract (commit cb61f00).

  it('from filter→1: ambiguous between wrapper + real msg resolves to real msg', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'tool:mcp_context-bonsai_context-bonsai-prune args:{"from_pattern":"hello"}', {
        isPruneWrapper: true,
      }),
      tmsg('m2', 'hello there'),
      tmsg('m3', 'world ends here'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startId).toBe('m2');
      expect(r.value.endId).toBe('m3');
    }
  });

  it('to filter→1: ambiguous between wrapper + real msg resolves to real msg', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'hello there'),
      tmsg('m2', 'tool:mcp_context-bonsai_context-bonsai-prune args:{"to_pattern":"world"}', {
        isPruneWrapper: true,
      }),
      tmsg('m3', 'world ends here'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startId).toBe('m1');
      expect(r.value.endId).toBe('m3');
    }
  });

  it('from filter→>1: two real msgs match → still ambiguous', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'tool:mcp_context-bonsai_context-bonsai-prune args:{"from_pattern":"hello"}', {
        isPruneWrapper: true,
      }),
      tmsg('m2', 'hello first'),
      tmsg('m3', 'hello second'),
      tmsg('m4', 'world ends here'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/from_pattern is ambiguous/);
      // The error must report the unfiltered match count verbatim.
      expect(r.error).toMatch(/matched 3 messages/);
    }
  });

  it('to filter→>1: two real msgs match → still ambiguous', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'hello there'),
      tmsg('m2', 'tool:mcp_context-bonsai_context-bonsai-prune args:{"to_pattern":"world"}', {
        isPruneWrapper: true,
      }),
      tmsg('m3', 'world one'),
      tmsg('m4', 'world two'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/to_pattern is ambiguous/);
      expect(r.error).toMatch(/matched 3 messages/);
    }
  });

  it('from filter→0: only wrappers match → still ambiguous', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'tool:mcp_context-bonsai_context-bonsai-prune hello a', {
        isPruneWrapper: true,
      }),
      tmsg('m2', 'tool:mcp_context-bonsai_context-bonsai-prune hello b', {
        isPruneWrapper: true,
      }),
      tmsg('m3', 'world ends here'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/from_pattern is ambiguous/);
      expect(r.error).toMatch(/matched 2 messages/);
    }
  });

  it('to filter→0: only wrappers match → still ambiguous', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'hello there'),
      tmsg('m2', 'tool:mcp_context-bonsai_context-bonsai-prune world a', {
        isPruneWrapper: true,
      }),
      tmsg('m3', 'tool:mcp_context-bonsai_context-bonsai-prune world b', {
        isPruneWrapper: true,
      }),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/to_pattern is ambiguous/);
      expect(r.error).toMatch(/matched 2 messages/);
    }
  });

  it('single-match-untouched: one match (a wrapper) resolves to it', () => {
    const t: TranscriptMessage[] = [
      tmsg('m1', 'tool:mcp_context-bonsai_context-bonsai-prune hello once', {
        isPruneWrapper: true,
      }),
      tmsg('m2', 'world ends here'),
    ];
    const r = resolveBoundary(t, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startId).toBe('m1');
      expect(r.value.endId).toBe('m2');
    }
  });
});

describe('isPruneToolWrapperRecord', () => {
  it('returns true when toolCalls contains the qualified prune wrapper name', () => {
    expect(
      isPruneToolWrapperRecord({
        toolCalls: [
          { name: 'mcp_context-bonsai_context-bonsai-prune' },
        ],
      }),
    ).toBe(true);
  });

  it('returns false for non-prune tool names', () => {
    expect(
      isPruneToolWrapperRecord({
        toolCalls: [{ name: 'read_file' }, { name: 'edit' }],
      }),
    ).toBe(false);
  });

  it('returns false for an empty toolCalls array', () => {
    expect(isPruneToolWrapperRecord({ toolCalls: [] })).toBe(false);
  });

  it('returns false when toolCalls is missing', () => {
    expect(isPruneToolWrapperRecord({})).toBe(false);
  });

  it('returns true when at least one entry in a mixed-name array matches', () => {
    expect(
      isPruneToolWrapperRecord({
        toolCalls: [
          { name: 'read_file' },
          { name: 'mcp_context-bonsai_context-bonsai-prune' },
          { name: 'edit' },
        ],
      }),
    ).toBe(true);
  });
});

describe('checkSameStep', () => {
  it('rejects when step ids match', () => {
    const r = checkSameStep({
      anchorStepId: 's-1',
      currentStepId: 's-1',
    });
    expect(r.ok).toBe(false);
  });

  it('passes when step ids differ', () => {
    const r = checkSameStep({
      anchorStepId: 's-1',
      currentStepId: 's-2',
    });
    expect(r.ok).toBe(true);
  });

  it('passes permissively when ids are missing', () => {
    expect(
      checkSameStep({ anchorStepId: undefined, currentStepId: 's-1' }).ok,
    ).toBe(true);
    expect(
      checkSameStep({ anchorStepId: 's-1', currentStepId: undefined }).ok,
    ).toBe(true);
  });
});
