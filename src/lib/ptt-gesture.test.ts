import { describe, expect, it } from "vite-plus/test";

import {
  isOffButton,
  lockProgress,
  PTT_IDLE,
  PTT_LOCK_THRESHOLD_PX,
  pttTransition,
  type PttAction,
  type PttState,
} from "./ptt-gesture.ts";

const run = (start: PttState, ...actions: PttAction[]) => {
  let state = start;
  const effects: string[] = [];
  for (const action of actions) {
    const next = pttTransition(state, action);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
};

describe("pttTransition", () => {
  it("starts recording only after the hold delay, and release sends it", () => {
    const pressed = run(PTT_IDLE, { type: "press", y: 400 });
    expect(pressed.state.phase).toBe("pressing");
    expect(pressed.effects).toEqual([]);

    const done = run(pressed.state, { type: "holdElapsed" }, { type: "release" });
    expect(done.state).toEqual(PTT_IDLE);
    expect(done.effects).toEqual(["start", "end-send"]);
  });

  it("treats a release before the hold delay as a tap that never records", () => {
    const { state, effects } = run(PTT_IDLE, { type: "press", y: 400 }, { type: "release" });
    expect(state).toEqual(PTT_IDLE);
    expect(effects).toEqual(["too-short"]);
  });

  it("locks once the slide passes the threshold, and the lock survives the release", () => {
    const { state, effects } = run(
      PTT_IDLE,
      { type: "press", y: 400 },
      { type: "holdElapsed" },
      { type: "move", y: 400 - PTT_LOCK_THRESHOLD_PX, offButton: false },
      { type: "release" },
      { type: "cancel" },
    );
    expect(state.phase).toBe("locked");
    expect(effects).toEqual(["start", "lock"]);
  });

  it("starts the recording as it locks when the slide beats the hold delay", () => {
    const { state, effects } = run(
      PTT_IDLE,
      { type: "press", y: 400 },
      { type: "move", y: 300, offButton: false },
    );
    expect(state.phase).toBe("locked");
    expect(effects).toEqual(["start", "lock"]);
  });

  it("sends a locked recording when stop is tapped", () => {
    const { state, effects } = run({ phase: "locked" }, { type: "release" }, { type: "stop" });
    expect(state).toEqual(PTT_IDLE);
    expect(effects).toEqual(["end-send"]);
  });

  it("ends like a release when dragged off the button before the threshold", () => {
    const held = run(
      PTT_IDLE,
      { type: "press", y: 400 },
      { type: "holdElapsed" },
      { type: "move", y: 410, offButton: true },
    );
    expect(held.state).toEqual(PTT_IDLE);
    expect(held.effects).toEqual(["start", "end-send"]);

    const early = run(
      PTT_IDLE,
      { type: "press", y: 400 },
      { type: "move", y: 410, offButton: true },
    );
    expect(early.effects).toEqual(["too-short"]);
  });

  it("tracks slide progress while pressing", () => {
    const { state } = run(
      PTT_IDLE,
      { type: "press", y: 400 },
      { type: "move", y: 400 - PTT_LOCK_THRESHOLD_PX / 2, offButton: false },
    );
    expect(state).toMatchObject({ phase: "pressing", progress: 0.5 });
  });

  it("discards on a system cancel, and a reset always goes idle", () => {
    expect(
      run(PTT_IDLE, { type: "press", y: 1 }, { type: "holdElapsed" }, { type: "cancel" }).effects,
    ).toEqual(["start", "end-discard"]);
    expect(run({ phase: "locked" }, { type: "reset" })).toEqual({ state: PTT_IDLE, effects: [] });
  });
});

describe("helpers", () => {
  it("clamps slide progress and ignores keyboard presses", () => {
    expect(lockProgress(400, 500)).toBe(0);
    expect(lockProgress(400, 0)).toBe(1);
    expect(lockProgress(null, 0)).toBe(0);
  });

  it("treats above the button as part of the slide, not as off the button", () => {
    const rect = { left: 100, right: 300, bottom: 500 };
    expect(isOffButton({ x: 200, y: 100 }, rect)).toBe(false);
    expect(isOffButton({ x: 340, y: 480 }, rect)).toBe(true);
    expect(isOffButton({ x: 200, y: 560 }, rect)).toBe(true);
  });
});
