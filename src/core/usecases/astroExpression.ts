/**
 * Astro expression logic — pure, no React, no three.
 *
 * Three jobs:
 *
 *   1. **Look.** Turn a direction of attention into one of the sheet's own eye
 *      positions. The character has no continuous eye movement in the stylesheet;
 *      it has seven eye placements, so "follow the pointer" is a quantised choice,
 *      not an interpolation. Interpolating would produce positions the sheet never
 *      draws, which is how a character stops looking like itself.
 *   2. **Expire.** `alert`, `wonder`, `happy`, `think-*` are reactions. The owner
 *      asks when to return, and to what.
 *   3. **Identify.** The mesh/group and the store agree on one key.
 *
 * Everything here is measured-free: the numbers live in `@core/models/astro.ts`.
 */

import {
  ASTRO_DEFAULT_EXPRESSION,
  ASTRO_EXPRESSIONS,
  ASTRO_NODE_KEY,
  ASTRO_STATES,
  type AstroExpression,
  type AstroExpressionSpec,
} from "@core/models/astro.ts";

/**
 * A transient state is a reaction: it needs an exit. Resting states (`idle`,
 * `look-*`, `doze`, `sleep`, `deep-sleep`) persist until something changes them.
 */
const TRANSIENT_STATES: ReadonlySet<AstroExpression> = new Set(
  ASTRO_STATES.filter((state) => ASTRO_EXPRESSIONS[state].transient),
);

/** How long a reaction holds before returning to the previous state. */
export const ASTRO_REACTION_MS = { min: 900, max: 1600 } as const;

/** The `theatreKey` of the character's editable group. */
export const ASTRO_KEY = ASTRO_NODE_KEY;

/** Is this `theatreKey` the character? */
export function isAstroNode(nodeId: string | null | undefined): boolean {
  return nodeId === ASTRO_NODE_KEY;
}

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

/**
 * Quantise a direction of attention to one of the sheet's eye placements.
 *
 * `dx` / `dy` are in fractions of the body diameter `D`: `(0, 0)` is the centre of
 * the body, `(0.45, 0)` is the rim. The thresholds are the sheet's own eye
 * midpoints, so "the pointer is to the right" produces exactly the placement the
 * stylesheet draws for looking right.
 *
 * Horizontal dominates: an eye pair that drifts up-left when the pointer is
 * slightly high reads as "startled" rather than "looking up", so `dy` only wins
 * when it is clearly larger than `dx`.
 */
export function lookTowards(dx: number, dy: number): AstroExpression {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return ASTRO_DEFAULT_EXPRESSION;

  const ax = Math.abs(dx);

  /** Attention well above the equator, and not dominated by a sideways pull. */
  if (dy < -0.16 && ax < 0.18) {
    return dx < 0 ? "think-left" : "wonder";
  }

  if (ax < 0.055) return ASTRO_DEFAULT_EXPRESSION;
  if (dx > 0) return ax > 0.22 ? "look-right-shifted" : "look-right";
  return "look-left";
}

/**
 * The topmost eye placement when attention is above the equator.
 *
 * Separate from `lookTowards` because a raised pair is only reachable in two
 * directions (up-left or up-), and both are already distinct states. Exported so
 * a caller can express "point at the thing above me" without re-encoding the
 * thresholds.
 */
export function lookUp(dx: number): AstroExpression {
  return dx < 0 ? "think-left" : "wonder";
}

/** The inverse of `lookTowards`, for a caller that has a placement and wants a direction. */
export function directionOf(expression: AstroExpression): { x: number; y: number } {
  const spec = ASTRO_EXPRESSIONS[expression];
  return { x: spec.midpointX, y: spec.midpointY };
}

/** Cycle for a squish-free "wake up" tap: deep-sleep → sleep → doze → idle. */
export function wakeUp(expression: AstroExpression): AstroExpression {
  if (expression === "deep-sleep") return "sleep";
  if (expression === "sleep") return "doze";
  return ASTRO_DEFAULT_EXPRESSION;
}
