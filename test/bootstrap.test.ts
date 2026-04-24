import { describe, expect, it } from 'vitest';

import {
  applyBonsaiBeforeModel,
  BONSAI_GUIDANCE,
  registerBonsaiHooks,
  type BonsaiHookAdapter,
  type BonsaiRequestContext,
} from '../src/bootstrap.js';
import type { BonsaiPlaceholder } from '../src/placeholder.js';

function mkReq(
  overrides: Partial<BonsaiRequestContext> = {},
): BonsaiRequestContext {
  return {
    turnNumber: overrides.turnNumber ?? 1,
    usedTokens: overrides.usedTokens,
    usableBudget: overrides.usableBudget,
    history: overrides.history ?? [
      { role: 'user', text: 'hello' },
    ],
    placeholders: overrides.placeholders,
  };
}

describe('BONSAI_GUIDANCE', () => {
  it('mentions both tools and the non-destructive property', () => {
    expect(BONSAI_GUIDANCE).toContain('context-bonsai-prune');
    expect(BONSAI_GUIDANCE).toContain('context-bonsai-retrieve');
    expect(BONSAI_GUIDANCE).toContain('non-destructive');
    expect(BONSAI_GUIDANCE).toContain('from_pattern');
  });
});

describe('registerBonsaiHooks', () => {
  it('registers session start and beforeModel hooks', () => {
    const registered: string[] = [];
    const adapter: BonsaiHookAdapter = {
      registerBeforeModel: (name) => {
        registered.push(`beforeModel:${name}`);
      },
      registerSessionStart: (name) => {
        registered.push(`sessionStart:${name}`);
      },
    };
    registerBonsaiHooks(adapter);
    expect(registered).toContain('sessionStart:context-bonsai-guidance');
    expect(registered).toContain('beforeModel:context-bonsai-request');
  });

  it('session start action returns guidance text', () => {
    let action: (() => Promise<string | undefined> | string | undefined) | undefined;
    const adapter: BonsaiHookAdapter = {
      registerBeforeModel: () => {},
      registerSessionStart: (_name, a) => {
        action = a;
      },
    };
    registerBonsaiHooks(adapter);
    expect(action).toBeDefined();
    expect(action!()).toBe(BONSAI_GUIDANCE);
  });
});

describe('applyBonsaiBeforeModel', () => {
  it('injects gauge text on cadence turn, appended to last user turn', () => {
    const req = mkReq({
      turnNumber: 5,
      usedTokens: 300,
      usableBudget: 1000,
      history: [{ role: 'user', text: 'hello' }],
    });
    const result = applyBonsaiBeforeModel(req);
    expect(result.history[0]?.text).toContain('<system-reminder>');
    expect(result.history[0]?.text).toContain('[context-bonsai] Context usage: 30%');
    expect(result.history[0]?.text).toContain('hello');
  });

  it('does not inject gauge on off-cadence turn', () => {
    const req = mkReq({
      turnNumber: 4,
      usedTokens: 300,
      usableBudget: 1000,
      history: [{ role: 'user', text: 'hello' }],
    });
    const result = applyBonsaiBeforeModel(req);
    expect(result.history[0]?.text).toBe('hello');
  });

  it('silent when tokens unavailable', () => {
    const req = mkReq({
      turnNumber: 5,
      history: [{ role: 'user', text: 'hello' }],
    });
    const result = applyBonsaiBeforeModel(req);
    expect(result.history[0]?.text).toBe('hello');
  });

  it('urgent band wording on high usage', () => {
    const req = mkReq({
      turnNumber: 5,
      usedTokens: 900,
      usableBudget: 1000,
      history: [{ role: 'user', text: 'hello' }],
    });
    const result = applyBonsaiBeforeModel(req);
    expect(result.history[0]?.text).toContain('PRUNE NOW');
  });

  it('re-renders placeholders on history turns', () => {
    const placeholder: BonsaiPlaceholder = {
      kind: 'context-bonsai-placeholder',
      anchorId: 'a-1',
      rangeEndId: 'a-9',
      summary: 'csv pipeline discussion',
      indexTerms: ['csv', 'pipeline'],
    };
    const req = mkReq({
      turnNumber: 1,
      history: [
        { role: 'user', text: 'lossy text', placeholder },
        { role: 'user', text: 'continue' },
      ],
    });
    const result = applyBonsaiBeforeModel(req);
    expect(result.history[0]?.text).toContain('[PRUNED: a-1 to a-9]');
    expect(result.history[0]?.text).toContain('Summary: csv pipeline discussion');
  });

  it('appends gauge to last user turn even when earlier turns exist', () => {
    const req = mkReq({
      turnNumber: 5,
      usedTokens: 900,
      usableBudget: 1000,
      history: [
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'reply' },
        { role: 'user', text: 'second' },
      ],
    });
    const result = applyBonsaiBeforeModel(req);
    expect(result.history[0]?.text).toBe('first');
    expect(result.history[1]?.text).toBe('reply');
    expect(result.history[2]?.text).toContain('second');
    expect(result.history[2]?.text).toContain('PRUNE NOW');
  });
});
