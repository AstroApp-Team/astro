/**
 * Astro's page-side state — pure, no React, no three, no timers.
 *
 * Ported from the refactor branch's `core/usecases/astroInteraction.ts`, minus the tap
 * rules and the playhead/log helpers: on `main` the character is a presence in the
 * corner, not a thing you press, and there is no Theatre clip to seek or tap log to
 * render. What is here is the voice session's lifecycle, expressed as a face.
 */

import { type AstroExpression } from "./astro.ts";

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
