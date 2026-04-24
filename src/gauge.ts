/**
 * Pure gauge-severity logic for Context Bonsai.
 *
 * The shared spec requires four locked severity bands keyed on used-token
 * ratio (used / usable budget):
 *   <30%  : informational continue-working guidance
 *   30-60%: prune-ready advisory
 *   61-80%: stronger reminder with recency/drift cues
 *   >80%  : explicit urgent prune language with `PRUNE NOW`
 *
 * If `usedTokens` or `usableBudget` is missing, unavailable, or non-positive,
 * the gauge remains silent (returns undefined) per the fail-closed rule.
 */

export type GaugeSeverity = 'info' | 'advisory' | 'warning' | 'urgent';

export interface GaugeReading {
  readonly severity: GaugeSeverity;
  /** Integer 0-100 representing used/usable budget percentage. */
  readonly percent: number;
  /** Human/model-visible text to inject into the request. */
  readonly text: string;
}

export interface GaugeInput {
  readonly usedTokens?: number;
  readonly usableBudget?: number;
  /** 1-based turn counter. Gauge is only emitted on cadence-aligned turns. */
  readonly turnNumber: number;
  /** Default cadence is every 5 turns. */
  readonly cadence?: number;
}

/**
 * Compute gauge severity from a raw percent (0-100).
 *
 * Band edges:
 *   <30 : info
 *   <=60: advisory
 *   <=80: warning
 *   >80 : urgent
 */
export function severityForPercent(percent: number): GaugeSeverity {
  if (percent < 30) return 'info';
  if (percent <= 60) return 'advisory';
  if (percent <= 80) return 'warning';
  return 'urgent';
}

/**
 * Build gauge text for a given severity and percent.
 *
 * The wording follows the OpenCode reference semantics. Wording may be
 * adapted minimally, but the meaning of each band must stay equivalent.
 */
export function gaugeText(severity: GaugeSeverity, percent: number): string {
  const pct = `${percent}%`;
  switch (severity) {
    case 'info':
      return (
        `[context-bonsai] Context usage: ${pct}. You have ample ` +
        `headroom — continue working; pruning is not needed yet.`
      );
    case 'advisory':
      return (
        `[context-bonsai] Context usage: ${pct}. You are in prune-ready ` +
        `territory. Consider archiving older completed discussion blocks ` +
        `with context-bonsai-prune.`
      );
    case 'warning':
      return (
        `[context-bonsai] Context usage: ${pct}. Context pressure is high. ` +
        `Prune older completed ranges now. Favor the oldest contiguous ` +
        `block that has fully served its purpose; watch for drift.`
      );
    case 'urgent':
      return (
        `[context-bonsai] Context usage: ${pct}. PRUNE NOW. The session is ` +
        `near overflow — call context-bonsai-prune against the oldest ` +
        `completed range before continuing other work.`
      );
    default: {
      const exhaustive: never = severity;
      return exhaustive;
    }
  }
}

/**
 * Compute a gauge reading, or return undefined if the gauge must stay silent.
 *
 * Silent conditions:
 *   - Token/budget unavailable (undefined, non-number, <= 0).
 *   - Cadence not aligned: (turnNumber % cadence) !== 0. Default cadence 5.
 */
export function computeGauge(input: GaugeInput): GaugeReading | undefined {
  const cadence = input.cadence ?? 5;
  if (cadence <= 0) return undefined;
  if (!Number.isFinite(input.turnNumber) || input.turnNumber <= 0) {
    return undefined;
  }
  if (input.turnNumber % cadence !== 0) return undefined;

  const used = input.usedTokens;
  const usable = input.usableBudget;
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) {
    return undefined;
  }
  if (typeof usable !== 'number' || !Number.isFinite(usable) || usable <= 0) {
    return undefined;
  }

  const ratio = used / usable;
  // Clamp to [0, 999] to keep ridiculous edge values readable.
  const rawPercent = Math.floor(ratio * 100);
  const percent = Math.max(0, Math.min(999, rawPercent));
  const severity = severityForPercent(percent);
  return {
    severity,
    percent,
    text: gaugeText(severity, percent),
  };
}
