/**
 * Runtime hook registration helpers for Context Bonsai on Gemini CLI.
 *
 * The agent repo imports this module from its CLI startup path (`gemini.tsx`
 * via `contextBonsaiBootstrap.ts`) and calls `registerBonsaiHooks` with the
 * host-provided hook registration surface.
 *
 * The helpers stay host-agnostic in type signatures to avoid a circular build
 * dependency on the agent repo: the caller supplies the hook system adapter
 * and the current session context, and this module installs the guidance
 * injector, gauge injector, and structured-placeholder preserver.
 */

import { computeGauge, type GaugeReading } from './gauge.js';
import {
  type BonsaiPlaceholder,
  isBonsaiPlaceholder,
  renderPlaceholderText,
} from './placeholder.js';

/**
 * Host-neutral adapter for registering a runtime hook. Callers provide a
 * function that takes a hook event name + action and wires it into whatever
 * hook registry the host uses.
 */
export interface BonsaiHookAdapter {
  /**
   * Register a runtime hook to fire before a model request. The action is
   * given the current LLM request and may mutate it (e.g. append gauge text
   * to the last user turn, inject system guidance, preserve placeholder
   * structure). The action must return the mutated request.
   */
  registerBeforeModel(
    name: string,
    action: (req: BonsaiRequestContext) => Promise<BonsaiRequestContext> | BonsaiRequestContext,
  ): void;
  /**
   * Register a runtime hook to fire on session start. The action returns
   * optional additional context string to be added to the session prelude.
   */
  registerSessionStart(
    name: string,
    action: () => Promise<string | undefined> | string | undefined,
  ): void;
}

/**
 * Minimal, host-neutral projection of the data the bonsai hooks need from a
 * model request. The agent-repo shim maps its internal LLMRequest into this
 * shape and back.
 */
export interface BonsaiRequestContext {
  /**
   * Current turn number (1-based). Used for gauge cadence.
   */
  readonly turnNumber: number;
  /** Token budget total (e.g. model input token limit). */
  readonly usableBudget?: number;
  /** Tokens already consumed by the prompt. */
  readonly usedTokens?: number;
  /**
   * Mutable history as a plain array of turn descriptors. The first turn must
   * not be mutated (typically a system message); gauge text appends inside the
   * last user turn.
   */
  history: BonsaiTurn[];
  /**
   * Structured placeholders encountered during translation. The agent-repo
   * shim populates this so the bootstrap knows which turns to re-render from
   * structured metadata rather than plain text.
   */
  placeholders?: BonsaiPlaceholder[];
}

/**
 * Minimal turn descriptor. The agent-repo shim maps between this and the
 * Gemini `Content` shape.
 */
export interface BonsaiTurn {
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  /**
   * Optional reference to a structured placeholder rendered into this turn.
   * The translator seam uses this to round-trip structured data through the
   * text-oriented hook path.
   */
  placeholder?: BonsaiPlaceholder;
}

export const BONSAI_GUIDANCE = [
  'You have two Context Bonsai tools available:',
  '  - context-bonsai-prune: archive an older completed contiguous range of ' +
    'conversation. Prefer the oldest completed block first. Boundaries are ' +
    'selected with unique substring patterns (from_pattern / to_pattern); do ' +
    'not expose your internal ranking before you call the tool.',
  '  - context-bonsai-retrieve: restore a previously archived range by ' +
    'anchor_id.',
  'Protected by default: operational rules, session goal, unresolved tasks, ' +
    'unmet acceptance criteria, active validation loops. Do not prune these ' +
    'unless explicitly told to.',
  'Pruning is non-destructive. Retrieval is available. If you are unsure a ' +
    'range is done, leave it.',
  'When the gauge reads PRUNE NOW, prune before continuing other work.',
].join('\n');

/**
 * Install bonsai hooks into a host-neutral adapter.
 *
 * Registered hooks:
 *   - SessionStart: returns the BONSAI_GUIDANCE prelude.
 *   - BeforeModel : on cadence-aligned turns, appends gauge text to the last
 *                   user turn; also re-renders any structured placeholder
 *                   turns from their preserved metadata so the model always
 *                   sees the canonical placeholder shape regardless of what
 *                   the hook translator did.
 */
export function registerBonsaiHooks(adapter: BonsaiHookAdapter): void {
  adapter.registerSessionStart('context-bonsai-guidance', () => BONSAI_GUIDANCE);

  adapter.registerBeforeModel('context-bonsai-request', (req) => {
    return applyBonsaiBeforeModel(req);
  });
}

/**
 * Pure version of the BeforeModel mutation. Exported so tests can drive it
 * directly without constructing a full hook adapter.
 */
export function applyBonsaiBeforeModel(
  req: BonsaiRequestContext,
): BonsaiRequestContext {
  // 1. Re-render structured placeholders. If the translator preserved a
  //    placeholder envelope on a turn, we project it back out to canonical
  //    text. This is the structured-history seam's user-facing payoff.
  for (const turn of req.history) {
    if (turn.placeholder && isBonsaiPlaceholder(turn.placeholder)) {
      turn.text = renderPlaceholderText(turn.placeholder);
    }
  }

  // 2. Gauge injection on cadence-aligned turns.
  const reading: GaugeReading | undefined = computeGauge({
    turnNumber: req.turnNumber,
    usedTokens: req.usedTokens,
    usableBudget: req.usableBudget,
  });
  if (reading) {
    const lastUser = findLastUserTurn(req.history);
    if (lastUser) {
      const sep = lastUser.text.length > 0 ? '\n\n' : '';
      lastUser.text = `${lastUser.text}${sep}<system-reminder>\n${reading.text}\n</system-reminder>`;
    }
  }

  return req;
}

function findLastUserTurn(
  history: BonsaiTurn[],
): BonsaiTurn | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i];
    if (t && t.role === 'user') return t;
  }
  return undefined;
}
