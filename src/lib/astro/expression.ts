/**
 * Astro expression logic — pure, no React, no three.
 *
 * Ported from the refactor branch's `core/usecases/astroExpression.ts`, with the
 * Theatre-only parts (`ASTRO_KEY`, `isAstroNode`) dropped: on `main` the character
 * has no sheet, so nothing here needs a node key.
 *
 * Two jobs:
 *
 *   1. **Expire.** `alert`, `wonder`, `happy`, `think-*` are reactions. The owner
 *      asks when to return, and to what.
 *   2. **Identify.** Which states are reactions and which rest.
 */

import {
  ASTRO_DEFAULT_EXPRESSION,
  ASTRO_EXPRESSIONS,
  ASTRO_STATES,
  type AstroExpression,
  type AstroExpressionSpec,
} from "./astro.ts";

/**
 * A transient state is a reaction: it needs an exit. Resting states (`idle`,
 * `look-*`, `doze`, `sleep`, `deep-sleep`) persist until something changes them.
 */
const TRANSIENT_STATES: ReadonlySet<AstroExpression> = new Set(
  ASTRO_STATES.filter((state) => ASTRO_EXPRESSIONS[state].transient),
);

/** How long a reaction holds before returning to the previous state. */
export const ASTRO_REACTION_MS = { min: 900, max: 1600 } as const;

export function expressionSpec(expression: AstroExpression): AstroExpressionSpec {
  return ASTRO_EXPRESSIONS[expression];
}

export function isTransient(expression: AstroExpression): boolean {
  return TRANSIENT_STATES.has(expression);
}

/**
 * What a reaction returns to.
 *
 * `previous` is whatever the character was doing before the reaction started, so
 * a reaction fired while asleep returns to sleep, not to `idle`. A reaction that
 * somehow replaces itself also returns to the fallback, never to itself — a state
 * that resolves to itself never ends.
 */
export function returnExpression(
  previous: AstroExpression | null,
  current: AstroExpression,
): AstroExpression {
  if (previous == null) return ASTRO_DEFAULT_EXPRESSION;
  if (previous === current) return ASTRO_DEFAULT_EXPRESSION;
  return previous;
}

/** Cycle for a squish-free "wake up" tap: deep-sleep → sleep → doze → idle. */
export function wakeUp(expression: AstroExpression): AstroExpression {
  if (expression === "deep-sleep") return "sleep";
  if (expression === "sleep") return "doze";
  return ASTRO_DEFAULT_EXPRESSION;
}
