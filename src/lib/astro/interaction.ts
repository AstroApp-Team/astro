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
