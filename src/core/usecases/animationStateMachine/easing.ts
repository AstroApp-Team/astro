/**
 * Easing curves (§8.4) and the normalized-fade mapping (§8.3).
 *
 * Every curve is defined on the **source** progress, which is what the name means:
 * `linear` on a 0.5-second fade is a straight ramp in *source* time, so the blended
 * output is `targetCurve(sourceProgress)`. That is the whole of §8.3 — the blend
 * fraction is never `elapsed / duration` when a curve is involved.
 *
 * `blendFraction` is the one function callers use. It takes the fade's own curve and
 * returns the number a blend layer multiplies by.
 */

import type { Easing } from "@core/models/animationStateMachine.ts";

export type EaseFn = (t: number) => number;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * `smoothstep` is the default (§8.4). `easeInCubic` is the same curve, named the way
 * the spec names it, so a definition that asks for it by name gets the default.
 */
const smoothstep: EaseFn = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * Standard cubic-bezier solve. `x1`/`y1`/`x2`/`y2` are the control points with the
 * endpoints pinned at (0,0) and (1,1), which is why only four numbers are stored.
 * Newton-Raphson on x, then evaluate y — 8 iterations converges to well under a
 * millisecond of timing error at any duration the runtime uses.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  return (raw) => {
    const x = clamp01(raw);
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) break;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    return sampleY(clamp01(t));
  };
}

/** Resolve an easing to a function. An unknown name is linear, never a throw. */
export function easingFn(easing: Easing | undefined): EaseFn {
  if (easing == null) return smoothstep;
  switch (easing.kind) {
    case "linear":
      return (t) => clamp01(t);
    case "easeIn":
      return cubicBezier(0.42, 0, 1, 1);
    case "easeOut":
      return cubicBezier(0, 0, 0.58, 1);
    case "easeInOut":
      return cubicBezier(0.42, 0, 0.58, 1);
    case "cubicBezier":
      return cubicBezier(easing.x1, easing.y1, easing.x2, easing.y2);
    case "smoothstep":
      return smoothstep;
    default:
      return (t) => clamp01(t);
  }
}

/**
 * The blend fraction for a fade in flight (§8.3).
 *
 * `sourceProgress` is `elapsed / duration` clamped to [0, 1]; `targetCurve` is the
 * **fade's** easing, applied to the source progress. The result is what a blend layer
 * multiplies the incoming pose by.
 */
export function blendFraction(sourceProgress: number, targetCurve: Easing | undefined): number {
  const fn = easingFn(targetCurve);
  return fn(clamp01(sourceProgress));
}

/**
 * A curve applied to a normalized 0..1 position, for `normalized` fades and for
 * timeline `speedCurve`. Same function, different meaning of the input.
 */
export function applyCurve(position: number, curve: Easing | undefined): number {
  return easingFn(curve)(clamp01(position));
}

export { smoothstep, cubicBezier };
