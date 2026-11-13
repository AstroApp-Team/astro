/**
 * The push-to-talk gesture as a pure state machine — no React, no timers, no DOM.
 *
 * Three phases:
 *
 *   idle ──press──▶ pressing ──slide up past the threshold──▶ locked
 *     ▲                │                                         │
 *     └── release / drag off / cancel ◀──┘     tap on stop ──────┘
 *
 * `pressing` has two sub-states, tracked by `held`. A press only *becomes a recording* once it
 * has lasted `PTT_HOLD_DELAY_MS` (the `holdElapsed` action); a release before that is a tap, which
 * must not open the microphone and is reported as `too-short` so the UI can say "hold to talk".
 *
 * `pttTransition` returns the next state plus the side effects the caller must run, in order.
 * Keeping the effects as data is what lets this file be tested without a browser.
 */

/** Slide this far (px) up from where the press began to lock the microphone open. */
export const PTT_LOCK_THRESHOLD_PX = 70;

/** A press shorter than this is a tap: no recording starts. */
export const PTT_HOLD_DELAY_MS = 150;

/**
 * How far (px) the pointer may stray sideways or below the button before the hold counts as
 * dragged off. Above the button is *not* off: that is the direction of the lock slide.
 */
export const PTT_OFF_BUTTON_SLOP_PX = 32;

export type PttState =
  | { phase: "idle" }
  | {
      phase: "pressing";
      /** Where the press began, or `null` for a keyboard press (which cannot slide). */
      originY: number | null;
      /** True once the press has lasted long enough to be a recording. */
      held: boolean;
      /** How close the slide is to locking, `0..1`. */
      progress: number;
    }
  | { phase: "locked" };

export type PttAction =
  | { type: "press"; y: number | null }
  | { type: "holdElapsed" }
  /** `offButton` is computed by the caller from the button's rectangle. */
  | { type: "move"; y: number; offButton: boolean }
  /** The finger or key came up. */
  | { type: "release" }
  /** The system took the gesture away (pointer cancel, window blur): discard, do not send. */
  | { type: "cancel" }
  /** A tap on the stop button while locked. */
  | { type: "stop" }
  /** The session ended underneath the gesture: back to idle, no effects. */
  | { type: "reset" };

export type PttEffect =
  /** Open the microphone and start the turn. */
  | "start"
  /** The lock just engaged: give haptic feedback. */
  | "lock"
  /** End the recording and process it like a normal release. */
  | "end-send"
  /** End the recording and throw it away. */
  | "end-discard"
  /** A press that ended before it counted as a hold: show "hold to talk". */
  | "too-short";

export type PttTransition = { state: PttState; effects: PttEffect[] };

export const PTT_IDLE: PttState = { phase: "idle" };

const stay = (state: PttState): PttTransition => ({ state, effects: [] });

/** How far along the slide is, `0..1`. */
export function lockProgress(originY: number | null, y: number): number {
  if (originY == null) return 0;
  return Math.min(1, Math.max(0, (originY - y) / PTT_LOCK_THRESHOLD_PX));
}

/** Is the pointer far enough outside the button (sideways or below) to count as dragged off? */
export function isOffButton(
  point: { x: number; y: number },
  rect: { left: number; right: number; bottom: number },
): boolean {
  return (
    point.x < rect.left - PTT_OFF_BUTTON_SLOP_PX ||
    point.x > rect.right + PTT_OFF_BUTTON_SLOP_PX ||
    point.y > rect.bottom + PTT_OFF_BUTTON_SLOP_PX
  );
}

export function pttTransition(state: PttState, action: PttAction): PttTransition {
  if (action.type === "reset") return { state: PTT_IDLE, effects: [] };

  switch (state.phase) {
    case "idle":
      if (action.type !== "press") return stay(state);
      return {
        state: { phase: "pressing", originY: action.y, held: false, progress: 0 },
        effects: [],
      };

    case "pressing": {
      switch (action.type) {
        case "holdElapsed":
          if (state.held) return stay(state);
          return { state: { ...state, held: true }, effects: ["start"] };

        case "move": {
          const progress = lockProgress(state.originY, action.y);
          if (progress >= 1) {
            /* Sliding fast can beat the hold delay: the recording starts as it locks. */
            return {
              state: { phase: "locked" },
              effects: state.held ? ["lock"] : ["start", "lock"],
            };
          }
          if (action.offButton) {
            return { state: PTT_IDLE, effects: [state.held ? "end-send" : "too-short"] };
          }
          if (progress === state.progress) return stay(state);
          return { state: { ...state, progress }, effects: [] };
        }

        case "release":
          return { state: PTT_IDLE, effects: [state.held ? "end-send" : "too-short"] };

        case "cancel":
          return { state: PTT_IDLE, effects: state.held ? ["end-discard"] : [] };

        default:
          return stay(state);
      }
    }

    case "locked":
      /* The lock outlives the finger: only the stop button ends it. */
      if (action.type !== "stop") return stay(state);
      return { state: PTT_IDLE, effects: ["end-send"] };
  }
}
