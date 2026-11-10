/**
 * Astro's page-side state — pure, no React, no three, no timers.
 *
 * Ported from the refactor branch's `core/usecases/astroInteraction.ts`, minus the playhead
 * and log helpers (there is no Theatre clip to seek and no tap log to render). What is here
 * is the voice session's lifecycle, expressed as a face, plus the screen-space hit test the
 * corner overlay needs because its canvas cannot receive events.
 */

import { ASTRO_DEFAULT_EXPRESSION, type AstroExpression } from "./astro.ts";

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
 * The inverse: a pointer position in CSS pixels as `[-1, 1]` viewport space, y up.
 *
 * Dragging is why this exists. The drag handle sees `clientX/clientY` and the character's
 * position lives in the camera's space, so the pointer has to be expressed in the same
 * units the anchor is — and the y flip has to happen exactly once, in one place, or a
 * drag up moves him down.
 */
export function pixelsToViewport(
  point: ScreenPoint,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: (point.x / width) * 2 - 1, y: -((point.y / height) * 2 - 1) };
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
 * What a press on the character means.
 *
 * The character is the page's start button, and a press is the whole interaction: it starts a
 * conversation when there is none, and once one is open it is only a greeting. Hanging up is
 * deliberately *not* something a press can do — he is draggable, so a press is also how a drag
 * begins, and a control that ended a call every time it was poked would hang up by accident.
 *
 * Split out of the component because this is the product rule, not an implementation detail:
 * `"start"` and `"greet"` are the two answers, and the test can hold the rule still while the
 * event plumbing changes around it.
 */
export type TapIntent = "start" | "greet";

export function tapIntent(live: boolean): TapIntent {
  return live ? "greet" : "start";
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
 * `disconnected` → `idle`, not `doze`. A dozing character was supposed to read as "a quiet
 * room", and it does — but a *page* is not a room: he is the only thing on it, sitting in the
 * corner of a form the visitor has not filled in yet, and a sleeping mascot next to an empty
 * password field reads as "nothing here is awake", not as calm. `idle` keeps him looking
 * around instead, and `followsPointer("idle")` is true, so his eyes track the cursor while
 * the visitor decides.
 */
export function faceForSession({ status, isCapturing, isPlaying, hasError }: VoiceFaceInput) {
  if (hasError) return { expression: "alert" as AstroExpression, sustained: false };
  if (status === "connecting") return { expression: "wonder" as AstroExpression, sustained: false };
  if (status !== "connected")
    return { expression: ASTRO_DEFAULT_EXPRESSION as AstroExpression, sustained: true };
  if (isPlaying) return { expression: "happy" as AstroExpression, sustained: false };
  if (isCapturing) return { expression: "look-right" as AstroExpression, sustained: true };
  return { expression: "idle" as AstroExpression, sustained: true };
}
