/**
 * Astro's page-side interaction — pure, no React, no three, no timers.
 *
 * Ported from the refactor branch's `core/usecases/astroInteraction.ts`. The tap
 * rules are unchanged; the playhead/log helpers are not, because on `main` the
 * character has no Theatre clip to seek and no tap log to render. What replaces
 * them is the second half of this file: the voice session's lifecycle, expressed
 * as a face.
 */

import { type AstroExpression } from "./astro.ts";
import { isTransient, wakeUp } from "./expression.ts";

/**
 * The expression a tap produces.
 *
 * Resting states react: asleep wakes one notch, everything else says `happy`.
 * A transient state is already a reaction, so the tap is a no-op — letting a tap
 * retrigger `happy` would restart its timer on every poke and the character would
 * hold a single expression for as long as the user kept tapping.
 */
export function hitReaction(current: AstroExpression): AstroExpression {
  if (isTransient(current)) return current;
  if (current === "doze" || current === "sleep" || current === "deep-sleep") {
    return wakeUp(current);
  }
  return "happy";
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
 * `disconnected` → `doze` rather than `idle`: a closed session is a quiet room, and
 * a dozing character that wakes when poked (see `hitReaction`) reads better on a
 * phone than one that stares at you while nothing is happening.
 */
export function faceForSession({ status, isCapturing, isPlaying, hasError }: VoiceFaceInput) {
  if (hasError) return { expression: "alert" as AstroExpression, sustained: false };
  if (status === "connecting") return { expression: "wonder" as AstroExpression, sustained: false };
  if (status !== "connected") return { expression: "doze" as AstroExpression, sustained: true };
  if (isPlaying) return { expression: "happy" as AstroExpression, sustained: false };
  if (isCapturing) return { expression: "look-right" as AstroExpression, sustained: true };
  return { expression: "idle" as AstroExpression, sustained: true };
}

/**
 * The expression a tap-and-pick list offers.
 *
 * A subset of the sheet's 12, chosen so a phone can verify every *shape* the
 * character has (`open`, `happy`, `dash`) and every glyph (`alert`, `question`, `zs`)
 * without a twelve-button row nobody can tap at 320 px.
 */
export const ASTRO_FACE_PICKER: readonly AstroExpression[] = [
  "idle",
  "look-right",
  "look-left",
  "wonder",
  "alert",
  "happy",
  "doze",
  "sleep",
];
