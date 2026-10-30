import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addViewCost,
  addVoiceCost,
  getUsage,
  resetUsage,
  startSessionClock,
  stopSessionClock,
  usageToUsd,
} from "./voice-usage.ts";

/**
 * The meter is the only thing standing between a forgotten open session and a
 * surprise bill, so the arithmetic and the clock are tested directly.
 */
describe("the cost total", () => {
  afterEach(() => resetUsage());

  it("adds both models' costs into one total and keeps them apart", () => {
    resetUsage();

    addVoiceCost(0.005478);
    addVoiceCost(0.001251);
    addViewCost(0.0000243);

    expect(getUsage().voiceUsd).toBeCloseTo(0.006729, 12);
    expect(getUsage().viewUsd).toBeCloseTo(0.0000243, 12);
    expect(usageToUsd(getUsage())).toBeCloseTo(0.0067533, 12);
  });

  it("ignores a cost that is not a positive number", () => {
    resetUsage();

    addVoiceCost(Number.NaN);
    addViewCost(-1);

    expect(usageToUsd(getUsage())).toBe(0);
  });

  it("does not price connected time — an open session with no turns costs nothing", async () => {
    vi.useFakeTimers();
    resetUsage();

    startSessionClock();
    await vi.advanceTimersByTimeAsync(60_000);
    stopSessionClock();

    expect(getUsage().seconds).toBeCloseTo(60, 2);
    expect(usageToUsd(getUsage())).toBe(0);
    vi.useRealTimers();
  });
});

describe("the session clock", () => {
  afterEach(() => {
    stopSessionClock();
    resetUsage();
    vi.useRealTimers();
  });

  it("banks wall-clock time while the session is open", async () => {
    vi.useFakeTimers();
    resetUsage();

    startSessionClock();
    await vi.advanceTimersByTimeAsync(5_000);

    // Ticked while live, without waiting for the session to end.
    expect(getUsage().seconds).toBeCloseTo(5, 2);
    expect(getUsage().sessions).toBe(1);

    stopSessionClock();
    await vi.advanceTimersByTimeAsync(10_000);

    // A closed session stops costing money.
    expect(getUsage().seconds).toBeCloseTo(5, 2);
  });

  it("counts each session and keeps the running total across them", async () => {
    vi.useFakeTimers();
    resetUsage();

    startSessionClock();
    await vi.advanceTimersByTimeAsync(2_000);
    stopSessionClock();

    startSessionClock();
    await vi.advanceTimersByTimeAsync(3_000);
    stopSessionClock();

    expect(getUsage().sessions).toBe(2);
    expect(getUsage().seconds).toBeCloseTo(5, 2);
  });

  it("ignores a second start while one is already running", async () => {
    vi.useFakeTimers();
    resetUsage();

    startSessionClock();
    startSessionClock();
    await vi.advanceTimersByTimeAsync(1_000);
    stopSessionClock();

    expect(getUsage().sessions).toBe(1);
  });
});
