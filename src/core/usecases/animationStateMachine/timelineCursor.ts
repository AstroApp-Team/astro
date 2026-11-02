/**
 * The timeline cursor (§5.2).
 *
 * A cursor stores **seconds** and derives normalized time at the edges. Storing
 * normalized time and multiplying by duration is the same arithmetic in the other
 * direction, and it loses: a speed change mid-playback moves the seconds, and the
 * normalized value must follow.
 *
 * The cursor is a pure function of `(time, dt, speed, style, duration)`. It owns no
 * state, so a state's cursor lives in `LayerRuntime` and two states sharing a timeline
 * keep two cursors with one shared phase only when `syncGroup` says so.
 */

import type { PlayStyle, TimelineDef } from "@core/models/animationStateMachine.ts";
import type { Cursor } from "@core/usecases/animationStateMachine/types.ts";

export interface CursorStep {
  time: number;
  direction: 1 | -1;
  loops: number;
  finished: boolean;
  /** Set when the step crossed a loop boundary, for marker and event dispatch. */
  wrapped: boolean;
}

/**
 * Advance a cursor by `dt * speed` seconds (§5.2).
 *
 * `speed` is already resolved (input binding, scale, offset, speed curve applied) and
 * already clamped away from zero. A negative speed runs the clip backwards, which is
 * what `pingPong` is built from, so the style machine sees a signed step.
 */
export function advanceCursor(
  cursor: Cursor,
  dt: number,
  speed: number,
  duration: number,
): CursorStep {
  const style = cursorStyle(cursor, duration);
  const step = dt * speed;
  let time = cursor.time + step;
  let direction = cursor.direction;
  let loops = cursor.loops;
  let finished = false;
  let wrapped = false;

  switch (style.kind) {
    case "once": {
      if (time >= duration) {
        const onEnd = style.onEnd ?? "stop";
        if (onEnd === "loop") {
          time = time % duration;
          loops += 1;
          wrapped = true;
        } else if (onEnd === "hold") {
          time = duration;
          finished = true;
        } else {
          time = duration;
          finished = true;
        }
      } else if (time < 0) {
        time = 0;
        finished = true;
      }
      break;
    }

    case "loop": {
      // `time % duration` on a negative time is negative in JS, which is the whole
      // reason the wrap is written out rather than expressed as a modulo.
      if (time >= duration || time < 0) {
        const cycles = Math.floor(time / duration);
        time -= cycles * duration;
        loops += cycles;
        wrapped = true;
        if (time < 0) {
          time += duration;
          loops += 1;
        }
      }
      break;
    }

    case "pingPong": {
      // One round trip is two durations. `count` counts round trips, so count 1 ends
      // after the return leg, not at the far end.
      const span = duration * 2;
      let guard = 0;
      while ((time < 0 || time > span) && guard < 64) {
        guard += 1;
        if (time > span) {
          time -= span;
          loops += 1;
          wrapped = true;
        } else {
          time = -time;
          direction = direction === 1 ? -1 : 1;
        }
      }
      direction = time > duration ? -1 : 1;
      if (style.count != null && loops >= style.count) {
        finished = true;
        time = duration;
      }
      break;
    }

    case "clampForever": {
      // Past the end the cursor keeps counting. Normalized time exceeds 1 and the
      // sampler clamps its index, so the pose holds while `progress` keeps growing.
      if (time < 0) time = 0;
      break;
    }

    default:
      break;
  }

  return { time, direction, loops, finished, wrapped };
}

/**
 * The style a cursor runs. A state that references a timeline takes the timeline's
 * style; a state with an inline clip and no timeline runs `once`.
 */
function cursorStyle(cursor: Cursor, duration: number): PlayStyle {
  void duration;
  return cursor.style ?? { kind: "once", onEnd: "stop" };
}

/** Normalized 0..1 of a cursor's time. `clampForever` deliberately exceeds 1. */
export function normalizedTime(cursor: { time: number }, duration: number): number {
  if (duration <= 0) return 0;
  return cursor.time / duration;
}

/** Seconds remaining in the current pass, for `getActiveState().remaining`. */
export function remainingSeconds(cursor: Cursor, duration: number): number {
  const style = cursorStyle(cursor, duration);
  switch (style.kind) {
    case "once":
      return Math.max(0, duration - cursor.time);
    case "loop":
      return Math.max(0, duration - (cursor.time % duration));
    case "pingPong":
      return cursor.direction === 1
        ? Math.max(0, duration - cursor.time)
        : Math.max(0, cursor.time);
    case "clampForever":
      return Number.POSITIVE_INFINITY;
    default:
      return 0;
  }
}

/**
 * Create a cursor for a state's first frame (§5.3).
 *
 * `startAt` is normalized and converts with `duration`. `"random"` draws from the
 * injected RNG — never `Math.random`, because a definition that starts at a random
 * phase must reproduce in a test.
 */
export function createCursor(
  timeline: TimelineDef | undefined,
  duration: number,
  startAt: number | "random" | undefined,
  rng: () => number,
): Cursor {
  const style: PlayStyle = timeline?.playStyle ?? { kind: "once", onEnd: "stop" };
  const raw = startAt ?? timeline?.startAt ?? 0;
  const normalized = raw === "random" ? rng() : raw;
  const time = clampSeconds(normalized * duration, duration, style);

  return {
    timelineId: timeline?.id ?? "",
    time,
    direction: 1,
    loops: 0,
    finished: false,
    style,
    duration,
  };
}

function clampSeconds(time: number, duration: number, style: PlayStyle): number {
  if (style.kind === "clampForever") return Math.max(0, time);
  if (style.kind === "pingPong") return Math.min(Math.max(0, time), duration * 2);
  return Math.min(Math.max(0, time), duration);
}

/**
 * Re-anchor a cursor for `syncTime` (§8.1).
 *
 * The conversion is **normalized, never raw seconds**: the from state's normalized time
 * is applied to the to state's duration. Two clips of different lengths then land on the
 * same phase, which is the only reading that makes `syncTime` mean anything.
 */
export function syncCursorTo(cursor: Cursor, fromNormalized: number, toDuration: number): Cursor {
  return {
    ...cursor,
    time: clampSeconds(fromNormalized, toDuration, cursor.style),
  };
}

/**
 * The phase-lock for `syncGroup` (§5.5).
 *
 * Members advance on one clock: the group's time is the maximum of its members, and a
 * member behind it is pulled forward. The validator guarantees members agree on
 * duration, so a pull is always a phase correction, never a jump.
 */
export function alignGroupCursors(cursors: Cursor[], duration: number): void {
  let leader = 0;
  for (const cursor of cursors) {
    leader = Math.max(leader, cursor.time);
  }
  for (const cursor of cursors) {
    if (cursor.time < leader) {
      cursor.time = clampSeconds(leader, duration, cursor.style);
    }
  }
}

export type { Cursor };
