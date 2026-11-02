/**
 * The React ↔ machine bridge.
 *
 * The machine itself is **not** in the store: it is a mutable object with a frame loop,
 * and putting it in zustand means every `step()` either mutates state React cannot see or
 * triggers a render 60 times a second. It lives in the hook's ref; the store holds only
 * what a panel reads — the active states, the counters, and the tail of the event log.
 *
 * Written through module-scope helpers (`publishFrame`, `publishEvent`) so the React
 * Compiler stays quiet: a component that called `set(...)` from a render or an effect body
 * would be re-running that write on every compile pass.
 */

import { create } from "zustand";

import type { MachineEventName, MachineEvents } from "@core/models/animationStateMachine.ts";
import type { ActiveStateInfo } from "@core/models/animationStateMachine.ts";

export interface MachineEventLine {
  at: number;
  kind: MachineEventName;
  text: string;
}

export interface MachineSnapshot {
  layer: string;
  state: string;
  progress: number;
  remaining: number;
  speed: number;
}

interface MachineStore {
  /** One line per layer, written once per frame from the loop. */
  active: MachineSnapshot[];
  /** Total frames the loop has produced — a stalled number is a dead loop, visible at a glance. */
  frames: number;
  bonesWritten: number;
  influencesWritten: number;
  events: MachineEventLine[];
  error: string | null;
  setSnapshot: (
    active: MachineSnapshot[],
    frames: number,
    bones: number,
    influences: number,
  ) => void;
  pushEvent: (line: MachineEventLine) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

/** Keep the log bounded: a page left open for an hour must not grow an array forever. */
const LOG_LIMIT = 40;

export const useMachineStore = create<MachineStore>((set) => ({
  active: [],
  frames: 0,
  bonesWritten: 0,
  influencesWritten: 0,
  events: [],
  error: null,
  setSnapshot: (active, frames, bonesWrite, influencesWrite) =>
    set((state) => {
      /*
       * Only re-render when something a human can see changed. `progress` moves every
       * frame, so it is rounded to 1 % — a bar that steps 1 % at a time is what the panel
       * draws, and it turns 60 renders a second into ~2.
       */
      const changed =
        state.active.length !== active.length ||
        active.some((entry, index) => {
          const previous = state.active[index];
          return (
            previous == null ||
            previous.layer !== entry.layer ||
            previous.state !== entry.state ||
            Math.abs(previous.progress - entry.progress) > 0.01
          );
        });
      /* The frame counter still has to move while nothing else does, or a healthy loop
         reads as a dead one: 15 is ~4 Hz, enough to see it tick and far below a re-render
         per frame. */
      if (!changed && frames % 15 !== 0) return state;
      return { active, frames, bonesWritten: bonesWrite, influencesWritten: influencesWrite };
    }),
  pushEvent: (line) =>
    set((state) => ({
      events: [line, ...state.events].slice(0, LOG_LIMIT),
    })),
  setError: (error) => set({ error }),
  clear: () => set({ active: [], frames: 0, events: [], error: null }),
}));

/* ── Module-scope writers the frame loop and the event subscriptions use ── */

export function snapshotLine(layer: string, info: ActiveStateInfo | null): MachineSnapshot | null {
  if (info == null) return null;
  return {
    layer,
    state: info.state,
    progress: info.progress,
    remaining: info.remaining,
    speed: info.speed,
  };
}

/** Human-readable one-liner for the log. Kept here so the panel does not grow a switch. */
export function describeEvent<K extends MachineEventName>(
  kind: K,
  payload: MachineEvents[K],
): string {
  switch (kind) {
    case "transition": {
      const event = payload as MachineEvents["transition"];
      return `${event.layer}: ${event.from} → ${event.to}`;
    }
    case "stateEnter": {
      const event = payload as MachineEvents["stateEnter"];
      return `${event.layer} entered ${event.state}`;
    }
    case "stateExit": {
      const event = payload as MachineEvents["stateExit"];
      return `${event.layer} left ${event.state}`;
    }
    case "marker": {
      const event = payload as MachineEvents["marker"];
      return `marker ${event.name}`;
    }
    case "timelineEvent": {
      const event = payload as MachineEvents["timelineEvent"];
      return `timeline ${event.timeline}: ${event.name}`;
    }
    case "listener": {
      const event = payload as MachineEvents["listener"];
      return `${event.listener} · ${event.event} → action #${String(event.action)}`;
    }
    case "blocked": {
      const event = payload as MachineEvents["blocked"];
      return `${event.layer}: ${event.to} blocked (${event.reason})`;
    }
    case "cycle": {
      const event = payload as MachineEvents["cycle"];
      return `cycle ${event.constraint} on ${event.channel}`;
    }
    default:
      return kind;
  }
}
