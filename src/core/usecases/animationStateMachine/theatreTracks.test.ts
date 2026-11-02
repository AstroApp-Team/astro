import { describe, expect, test } from "vite-plus/test";

import {
  bezierEase,
  quatFromEuler,
  sampleNumberTrack,
  unionKeyTimes,
  type TheatreKeyframe,
} from "@core/usecases/animationStateMachine/theatreTracks.ts";

const LINEAR = [1 / 3, 1 / 3, 2 / 3, 2 / 3];

function track(...keys: TheatreKeyframe[]): TheatreKeyframe[] {
  return keys;
}

describe("bezierEase", () => {
  test("Theatre's default handles are the identity", () => {
    for (const s of [0, 0.1, 0.25, 0.5, 0.77, 1]) {
      expect(bezierEase(s, ...(LINEAR as [number, number, number, number]))).toBeCloseTo(s, 9);
    }
  });

  test("the endpoints are exact", () => {
    expect(bezierEase(0, 0.42, 0, 1, 1)).toBe(0);
    expect(bezierEase(1, 0.42, 0, 1, 1)).toBe(1);
  });

  test("ease-in holds the value back early and catches up late", () => {
    const half = bezierEase(0.5, 0.42, 0, 1, 1);
    expect(half).toBeLessThan(0.5);
    expect(bezierEase(0.9, 0.42, 0, 1, 1)).toBeGreaterThan(0.8);
  });

  test("an overshoot curve passes 1 mid-segment — the reason linear sampling is not enough", () => {
    /* y2 = 3 pulls the curve above the segment's end value; a linear sampler cannot do this. */
    let peak = -1;
    for (let i = 0; i <= 100; i += 1) peak = Math.max(peak, bezierEase(i / 100, 0.1, 0, 0.5, 3));
    expect(peak).toBeGreaterThan(1.5);
  });

  test("is monotonic in s for a monotonic curve", () => {
    let previous = -1;
    for (let i = 0; i <= 20; i += 1) {
      const value = bezierEase(i / 20, 0.42, 0, 0.58, 1);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("sampleNumberTrack", () => {
  test("a two-key linear segment interpolates linearly", () => {
    const keys = track(
      { value: 0, position: 0, handles: LINEAR },
      { value: 2, position: 2, handles: LINEAR },
    );
    expect(sampleNumberTrack(keys, 0.5)).toBeCloseTo(0.5, 9);
    expect(sampleNumberTrack(keys, 1)).toBeCloseTo(1, 9);
  });

  test("a missing handle array is linear, not zero", () => {
    const keys = track({ value: 10, position: 0 }, { value: 20, position: 1 });
    expect(sampleNumberTrack(keys, 0.25)).toBeCloseTo(12.5, 9);
  });

  test("the ease in the handles is respected, not skipped", () => {
    const eased = track(
      { value: 0, position: 0, handles: [0.42, 0, 1, 1] },
      { value: 1, position: 1, handles: [0.42, 0, 1, 1] },
    );
    const linear = track(
      { value: 0, position: 0, handles: LINEAR },
      { value: 1, position: 1, handles: LINEAR },
    );
    expect(sampleNumberTrack(eased, 0.5)).toBeLessThan(sampleNumberTrack(linear, 0.5) - 0.1);
  });

  test("a `hold` keyframe freezes its value until the next key", () => {
    const keys = track(
      { value: 1, position: 0, type: "hold" },
      { value: 9, position: 1, type: "hold" },
    );
    expect(sampleNumberTrack(keys, 0.99)).toBe(1);
    expect(sampleNumberTrack(keys, 1)).toBe(9);
  });

  test("a flat segment stays flat at any handle setting", () => {
    const keys = track(
      { value: 3, position: 0, handles: [0, 0, 0, 1.4] },
      { value: 3, position: 1, handles: [0, 0, 0, 1.4] },
    );
    expect(sampleNumberTrack(keys, 0.5)).toBe(3);
  });

  test("outside the range the value is held, so a long clip settles instead of snapping", () => {
    const keys = track({ value: 5, position: 1 }, { value: 7, position: 2 });
    expect(sampleNumberTrack(keys, 0)).toBe(5);
    expect(sampleNumberTrack(keys, 9)).toBe(7);
  });

  test("an empty track is zero rather than NaN", () => {
    expect(sampleNumberTrack([], 0.5)).toBe(0);
  });

  test("a zero-length segment returns a finite value, not NaN", () => {
    /* Two keys at the same time is a degenerate track; the clamp wins and it collapses. */
    const keys = track({ value: 1, position: 1 }, { value: 4, position: 1 });
    expect(Number.isFinite(sampleNumberTrack(keys, 1))).toBe(true);
    expect(sampleNumberTrack(keys, 1)).toBe(1);
  });
});

describe("unionKeyTimes", () => {
  test("merges, dedupes and sorts", () => {
    expect(
      unionKeyTimes([
        track({ value: 0, position: 0 }, { value: 1, position: 2 }),
        track({ value: 0, position: 1 }),
      ]),
    ).toEqual([0, 1, 2]);
  });
});

describe("quatFromEuler", () => {
  test("zero rotation is the identity quaternion", () => {
    expect(quatFromEuler(0, 0, 0)).toEqual([0, 0, 0, 1]);
  });

  test("a quarter turn about Y is half a radian pair on Y", () => {
    const [x, y, z, w] = quatFromEuler(0, Math.PI / 2, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(Math.SQRT1_2, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(w).toBeCloseTo(Math.SQRT1_2, 12);
  });

  test("is always unit length", () => {
    const q = quatFromEuler(0.3, -1.2, 2.4);
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 12);
  });
});
