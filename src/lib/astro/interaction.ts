/**
 * Astro's page-side state — pure, no React, no three, no timers.
 *
 * Ported from the refactor branch's `core/usecases/astroInteraction.ts`, minus the playhead
 * and log helpers (there is no Theatre clip to seek and no tap log to render). What is here
 * is the voice session's lifecycle, expressed as a face, plus the screen-space hit test the
 * corner overlay needs because its canvas cannot receive events.
 */

import { type AstroExpression } from "./astro.ts";

/** A point in CSS pixels, y **down** — the space pointer events are written in. */
export type ScreenPoint = { x: number; y: number };

/**
 * The character's centre in CSS pixels, from the `[-1, 1]` viewport position the canvas
 * writes into `lookOrigin`.
 *
 * The y flip is the whole reason this is a function and not two inline expressions: the
 * canvas works in three's camera space, where y is **up**, and pointer events are y-down.
 * Interpolating the origin straight into pixels puts every tap target in the top-right of
 * the window while the character sits in the bottom-right — a character that ignores every
 * press and reacts to ones nowhere near him.
 */
export function viewportToPixels(
  origin: { x: number; y: number },
  width: number,
  height: number,
): ScreenPoint {
  return { x: ((origin.x + 1) / 2) * width, y: ((1 - origin.y) / 2) * height };
}

/**
 * Whether a press landed on him, given his centre and the radius of the tappable disc.
 *
 * The canvas layer is `pointer-events: none` (the page keeps its clicks), so the browser
 * never delivers a press to the character and R3F's raycast never runs. A tap on him is
 * therefore this: a plain distance test in screen space. A press that misses is left
 * untouched, so the page's own controls still receive it.
 */
export function hitsCharacter(pointer: ScreenPoint, centre: ScreenPoint, radius: number): boolean {
  return Math.hypot(pointer.x - centre.x, pointer.y - centre.y) <= radius;
}

/**
 * The direction he should look, given where the pointer is and where he is.
 *
 * Both inputs are `[-1, 1]` viewport space with y up. A corner character never sits at
 * `(0, 0)`, so the pointer cannot be the gaze directly: with absolute viewport coordinates,
 * a cursor parked next to him (bottom-right) reads as `(1, -1)` and he stares at the corner
 * instead of at the cursor. Subtracting his own position is the difference between "where
 * the pointer is" and "which way the pointer is from him".
 *
 * Normalised to length 1 at most, not clamped per axis: `followPointer` adds this to the
 * expression's resting look and radially clamps the sum, so a vector longer than 1 would let
 * a cursor far away erase his resting look instead of pulling it to the rim.
 */
export function gazeDirection(
  pointer: { x: number; y: number },
  origin: { x: number; y: number },
): { x: number; y: number } {
  const direction = { x: pointer.x - origin.x, y: pointer.y - origin.y };
  const length = Math.hypot(direction.x, direction.y);
  const scale = length > 1 ? 1 / length : 1;
  return { x: direction.x * scale, y: direction.y * scale };
}

/**
 * The parts of the realtime session the face cares about.
 *
 * Typed structurally rather than as `Experimental_RealtimeStatus`: this is the
 * only place the voice page and the character agree, and a pure function with its
 * own input type can be tested without a WebSocket or a microphone.
 */
export type VoiceFaceInput = {
  status: string;
  isCapturing: boolean;
  isPlaying: boolean;
  hasError: boolean;
};

/**
 * Which face a session state shows.
 *
 * Sustained states use **resting** expressions (`idle`, `look-right`, `doze`) and
 * momentary ones use **transient** ones (`alert`, `wonder`, `happy`). That is the
 * whole reason the split exists here: a sustained state written as a transient
 * expression has no exit, so the character would hold `wonder` forever once the
 * socket opened. A momentary state written as a resting expression would linger
 * until the next status change, which for `speaking` means the character looks
 * attentive after the model has stopped talking.
 *
 * `disconnected` → `doze` rather than `idle`: a closed session is a quiet room, and a
 * dozing character reads better in a corner than one that stares at you while nothing
 * is happening.
 */
export function faceForSession({ status, isCapturing, isPlaying, hasError }: VoiceFaceInput) {
  if (hasError) return { expression: "alert" as AstroExpression, sustained: false };
  if (status === "connecting") return { expression: "wonder" as AstroExpression, sustained: false };
  if (status !== "connected") return { expression: "doze" as AstroExpression, sustained: true };
  if (isPlaying) return { expression: "happy" as AstroExpression, sustained: false };
  if (isCapturing) return { expression: "look-right" as AstroExpression, sustained: true };
  return { expression: "idle" as AstroExpression, sustained: true };
}
