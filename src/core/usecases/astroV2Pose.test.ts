import { describe, expect, test } from "vite-plus/test";

import { ASTRO_STATES } from "@core/models/astro.ts";
import {
  followPointer,
  followsPointer,
  isAsleep,
  resolveEyePose,
} from "@core/usecases/astroV2Pose.ts";

describe("resolveEyePose", () => {
  test("every state resolves to weights inside 0..1 and a look inside ±1", () => {
    for (const state of ASTRO_STATES) {
      const pose = resolveEyePose(state);
      expect(pose.happy).toBeGreaterThanOrEqual(0);
      expect(pose.happy).toBeLessThanOrEqual(1);
      expect(pose.sleepy).toBeGreaterThanOrEqual(0);
      expect(pose.sleepy).toBeLessThanOrEqual(1);
      expect(Math.abs(pose.look.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(pose.look.y)).toBeLessThanOrEqual(1);
      expect(pose.stretch).toBeGreaterThanOrEqual(1);
    }
  });

  test("the morph weights follow the sheet's feature, not the state's name", () => {
    expect(resolveEyePose("happy").happy).toBe(1);
    expect(resolveEyePose("happy").sleepy).toBe(0);

    for (const state of ["doze", "sleep", "deep-sleep"] as const) {
      expect(resolveEyePose(state).sleepy).toBe(1);
      expect(resolveEyePose(state).happy).toBe(0);
    }

    expect(resolveEyePose("idle").happy).toBe(0);
    expect(resolveEyePose("idle").sleepy).toBe(0);
  });

  test("a raised pair is stretched, a resting one is not", () => {
    expect(resolveEyePose("alert").stretch).toBeGreaterThan(1);
    expect(resolveEyePose("wonder").stretch).toBeGreaterThan(1);
    expect(resolveEyePose("idle").stretch).toBe(1);
  });

  test("the look vector keeps the sheet's directions: +x right, +y up", () => {
    expect(resolveEyePose("look-left").look.x).toBeLessThan(0);
    expect(resolveEyePose("look-right").look.x).toBeGreaterThan(0);
    expect(resolveEyePose("think-right").look.x).toBe(1);
    // The sheet's y is down, so "above the equator" is a positive look here.
    expect(resolveEyePose("wonder").look.y).toBeGreaterThan(0);
    expect(resolveEyePose("doze").look.y).toBeLessThan(resolveEyePose("wonder").look.y);
  });
});

describe("followPointer", () => {
  const idle = resolveEyePose("idle");

  test("no pointer means the resting pose, untouched", () => {
    expect(followPointer(idle, null, true)).toBe(idle);
  });

  test("a pointer only moves a face that follows it", () => {
    const still = followPointer(resolveEyePose("sleep"), { x: 1, y: 0 }, false);
    expect(still.look).toEqual(resolveEyePose("sleep").look);

    const moved = followPointer(idle, { x: 1, y: 0 }, true);
    expect(moved.look.x).toBeGreaterThan(idle.look.x);
  });

  test("the clamp is radial, so a corner cannot leave the unit circle", () => {
    const edge = followPointer(idle, { x: 1, y: 0 }, true);
    const corner = followPointer(idle, { x: 1, y: 1 }, true);

    /*
     * The bug this test exists for: an *independent* clamp on each axis would put the
     * corner at `(1, 1)` — radius `1.41` — while the edge sits at radius `1`. The radial
     * clamp keeps every direction on or inside the unit circle.
     */
    expect(Math.hypot(corner.look.x, corner.look.y)).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.hypot(edge.look.x, edge.look.y)).toBeLessThanOrEqual(1 + 1e-9);

    /*
     * …and it scales both axes equally, so the corner's *direction* survives the cap. The
     * expected point is the raw pull normalised, not `(1, 1)`: `idle` has its own resting
     * offset, so the corner is not symmetric. With gain 1 (see `followPointer`) both pulls
     * saturate on the circle — that is the point of the gain, not a regression.
     */
    const rawX = idle.look.x + 1;
    const rawY = idle.look.y + 1;
    const raw = Math.hypot(rawX, rawY);
    expect(corner.look.x).toBeCloseTo(rawX / raw, 10);
    expect(corner.look.y).toBeCloseTo(rawY / raw, 10);
    expect(Math.hypot(corner.look.x, corner.look.y)).toBeCloseTo(1, 10);
    expect(Math.hypot(edge.look.x, edge.look.y)).toBeCloseTo(1, 10);
  });

  test("a resting placement plus a small pointer pull stays inside the range", () => {
    const pulled = followPointer(resolveEyePose("look-right"), { x: 1, y: 0.4 }, true);
    expect(Math.hypot(pulled.look.x, pulled.look.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("state predicates", () => {
  test("only resting, open-eyed states follow the pointer", () => {
    expect(followsPointer("idle")).toBe(true);
    expect(followsPointer("look-left")).toBe(true);
    expect(followsPointer("happy")).toBe(false);
    expect(followsPointer("sleep")).toBe(false);
  });

  test("the three sleep states are the ones with closed eyes", () => {
    expect(isAsleep("doze")).toBe(true);
    expect(isAsleep("sleep")).toBe(true);
    expect(isAsleep("deep-sleep")).toBe(true);
    expect(isAsleep("idle")).toBe(false);
    expect(isAsleep("happy")).toBe(false);
  });
});
