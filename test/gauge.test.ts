import { describe, it, expect } from 'vitest';

import {
  computeGauge,
  gaugeText,
  severityForPercent,
} from '../src/gauge.js';

describe('gauge severity bands', () => {
  it('info below 30%', () => {
    expect(severityForPercent(0)).toBe('info');
    expect(severityForPercent(15)).toBe('info');
    expect(severityForPercent(29)).toBe('info');
  });

  it('advisory 30-60% inclusive', () => {
    expect(severityForPercent(30)).toBe('advisory');
    expect(severityForPercent(45)).toBe('advisory');
    expect(severityForPercent(60)).toBe('advisory');
  });

  it('warning 61-80% inclusive', () => {
    expect(severityForPercent(61)).toBe('warning');
    expect(severityForPercent(70)).toBe('warning');
    expect(severityForPercent(80)).toBe('warning');
  });

  it('urgent above 80%', () => {
    expect(severityForPercent(81)).toBe('urgent');
    expect(severityForPercent(95)).toBe('urgent');
    expect(severityForPercent(200)).toBe('urgent');
  });
});

describe('gaugeText wording', () => {
  it('includes percent', () => {
    expect(gaugeText('info', 10)).toContain('10%');
    expect(gaugeText('advisory', 45)).toContain('45%');
    expect(gaugeText('warning', 70)).toContain('70%');
    expect(gaugeText('urgent', 90)).toContain('90%');
  });

  it('urgent band says PRUNE NOW', () => {
    expect(gaugeText('urgent', 90)).toContain('PRUNE NOW');
  });

  it('non-urgent bands do not say PRUNE NOW', () => {
    expect(gaugeText('info', 10)).not.toContain('PRUNE NOW');
    expect(gaugeText('advisory', 45)).not.toContain('PRUNE NOW');
    expect(gaugeText('warning', 70)).not.toContain('PRUNE NOW');
  });
});

describe('computeGauge', () => {
  it('emits reading on cadence-aligned turn', () => {
    const r = computeGauge({
      turnNumber: 5,
      usedTokens: 300,
      usableBudget: 1000,
    });
    expect(r).toBeDefined();
    expect(r?.percent).toBe(30);
    expect(r?.severity).toBe('advisory');
  });

  it('silent on off-cadence turn', () => {
    const r = computeGauge({
      turnNumber: 3,
      usedTokens: 300,
      usableBudget: 1000,
    });
    expect(r).toBeUndefined();
  });

  it('silent when usable budget is missing or zero', () => {
    expect(
      computeGauge({ turnNumber: 5, usedTokens: 500, usableBudget: 0 }),
    ).toBeUndefined();
    expect(
      computeGauge({ turnNumber: 5, usedTokens: 500 }),
    ).toBeUndefined();
  });

  it('silent when used tokens is missing', () => {
    expect(
      computeGauge({ turnNumber: 5, usableBudget: 1000 }),
    ).toBeUndefined();
  });

  it('custom cadence', () => {
    expect(
      computeGauge({
        turnNumber: 2,
        usedTokens: 900,
        usableBudget: 1000,
        cadence: 2,
      }),
    ).toBeDefined();
  });

  it('urgent reading above 80%', () => {
    const r = computeGauge({
      turnNumber: 5,
      usedTokens: 900,
      usableBudget: 1000,
    });
    expect(r?.severity).toBe('urgent');
    expect(r?.text).toContain('PRUNE NOW');
  });
});
