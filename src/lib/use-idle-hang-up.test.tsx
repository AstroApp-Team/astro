// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { IDLE_TIMEOUT_MS, useIdleHangUp, type IdleActivity } from "./use-idle-hang-up.ts";

const quiet: IdleActivity = { messages: [], isPlaying: false, report: null, viewEvent: null };

function setup(active = true) {
  const onIdle = vi.fn();
  const hook = renderHook(
    ({ active, activity }: { active: boolean; activity: IdleActivity }) =>
      useIdleHangUp(active, activity, () => onIdle()),
    { initialProps: { active, activity: quiet } },
  );
  return { onIdle, ...hook };
}

describe("useIdleHangUp", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hangs up after two silent minutes, once", () => {
    const { onIdle } = setup();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 3);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Partial<IdleActivity>]>([
    ["a new transcript line", { messages: [{ id: "1" }] }],
    ["the model starting to speak", { isPlaying: true }],
    ["a finished build", { report: { text: "landed" } }],
    ["a click inside the app", { viewEvent: { type: "click" } }],
  ])("restarts the two minutes on %s", (_, change) => {
    const { onIdle, rerender } = setup();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1_000);
    rerender({ active: true, activity: { ...quiet, ...change } });

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not count a re-render with the same activity", () => {
    const { onIdle, rerender } = setup();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1_000);
    rerender({ active: true, activity: { ...quiet } });

    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("never fires while the session is not connected", () => {
    const { onIdle, rerender } = setup(false);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();

    /* Connected, then hung up before the time ran out. */
    rerender({ active: true, activity: quiet });
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    rerender({ active: false, activity: quiet });
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
