import { describe, expect, it } from "vite-plus/test";

import {
  BLINK_DURATION_S,
  BLINK_INTERVAL_S,
  BLINK_PEAK,
  DOUBLE_BLINK_GAP_S,
  blinkWeight,
  nextBlinkDelay,
} from "./blink.ts";

describe("blinkWeight", () => {
  it("is open before and after the blink", () => {
    expect(blinkWeight(-0.1)).toBe(0);
    expect(blinkWeight(0)).toBe(0);
    expect(blinkWeight(BLINK_DURATION_S)).toBe(0);
    expect(blinkWeight(BLINK_DURATION_S + 1)).toBe(0);
  });

  it("closes a little past the asleep shape in the middle of the blink", () => {
    const peak = Math.max(
      ...Array.from({ length: 100 }, (_, i) => blinkWeight((i / 100) * BLINK_DURATION_S)),
    );
    expect(peak).toBeCloseTo(BLINK_PEAK, 2);
    expect(peak).toBeGreaterThan(1);
  });

  it("closes faster than it opens", () => {
    const quarter = BLINK_DURATION_S * 0.25;
    const threeQuarters = BLINK_DURATION_S * 0.75;
    expect(blinkWeight(quarter)).toBeGreaterThan(blinkWeight(threeQuarters));
  });

  it("stays within [0, BLINK_PEAK]", () => {
    for (let i = 0; i <= 200; i += 1) {
      const weight = blinkWeight((i / 200) * BLINK_DURATION_S);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(BLINK_PEAK);
    }
  });
});

describe("nextBlinkDelay", () => {
  it("waits a few seconds between ordinary blinks", () => {
    expect(nextBlinkDelay(0, 0.99)).toBeCloseTo(BLINK_INTERVAL_S.min, 6);
    expect(nextBlinkDelay(1, 0.99)).toBeCloseTo(BLINK_INTERVAL_S.max, 6);
    expect(nextBlinkDelay(0.5, 0.99)).toBeGreaterThan(BLINK_INTERVAL_S.min);
  });

  it("sometimes blinks twice in a row", () => {
    expect(nextBlinkDelay(0.5, 0)).toBe(DOUBLE_BLINK_GAP_S);
    /* The second blink must start after the first one has finished. */
    expect(DOUBLE_BLINK_GAP_S).toBeGreaterThan(BLINK_DURATION_S);
  });
});
