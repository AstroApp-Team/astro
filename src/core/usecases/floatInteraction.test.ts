import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_HIT_LOG,
  FLOAT_SPHERE_KEY,
  HIT_MESSAGE,
  MAX_HITS,
  appendHit,
  hitSummary,
  isFloatSphere,
  nextSeekTime,
} from "@core/usecases/floatInteraction.ts";

describe("isFloatSphere", () => {
  it("matches the key the float scene mounts", () => {
    expect(isFloatSphere(FLOAT_SPHERE_KEY)).toBe(true);
  });

  it("ignores every other hit, including nothing", () => {
    expect(isFloatSphere(null)).toBe(false);
    expect(isFloatSphere("Sting-Core")).toBe(false);
    expect(isFloatSphere("Sphere-0")).toBe(false);
  });
});

describe("nextSeekTime", () => {
  it("stays inside the rigged range", () => {
    for (const draw of [0, 0.25, 0.5, 0.75, 0.999]) {
      const at = nextSeekTime(6, 3, () => draw);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(6);
    }
  });

  it("returns 0 for a sheet nobody has rigged", () => {
    expect(nextSeekTime(0, 0, () => 0.5)).toBe(0);
  });

  /**
   * The point of the mirror. A draw that lands where the sphere already is would
   * make the tap look like a no-op, which is the failure this page exists to not
   * have.
   *
   * The arithmetic, spelled out: a draw scales onto `[0, length - 0.05]` (so a draw
   * of 1 cannot land on the sequence's end), rounded to hundredths, and a result
   * within `minGap` of `from` is shifted by half the loop. `0.5` on a 6s sheet is
   * 2.98, which is 0.02 from `from = 3` → mirrored to 5.98, not to 3.
   */
  it("mirrors a draw that lands on top of the current position", () => {
    expect(nextSeekTime(6, 0, () => 0)).toBe(3);
    expect(nextSeekTime(6, 3, () => 0.5)).toBe(5.98);
  });

  it("keeps a draw that is already far enough away", () => {
    // 0.9 × 5.95 = 5.355 → 5.36, and 5.36 is 5.36 away from `from = 0`, so the
    // mirror does not fire.
    expect(nextSeekTime(6, 0, () => 0.9)).toBe(5.36);
  });

  it("clamps a random source that leaves [0, 1]", () => {
    expect(nextSeekTime(6, 0, () => -3)).toBe(3);
    expect(nextSeekTime(6, 0, () => 9)).toBeLessThan(6);
  });

  it("is deterministic for a given draw, so the jump is testable", () => {
    expect(nextSeekTime(6, 1, () => 0.4)).toBe(nextSeekTime(6, 1, () => 0.4));
  });
});

describe("appendHit", () => {
  it("appends the message the sphere is supposed to say", () => {
    const log = appendHit(EMPTY_HIT_LOG, 1.234, "hsl(210 80% 65%)");

    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]?.text).toBe(HIT_MESSAGE);
    expect(log.rows[0]?.id).toBe(1);
    expect(log.rows[0]?.hue).toBe("hsl(210 80% 65%)");
  });

  it("rounds the playhead to hundredths", () => {
    const log = appendHit(EMPTY_HIT_LOG, 2.3456, "x");

    expect(log.rows[0]?.playhead).toBe(2.35);
  });

  it("numbers rows past the cap, so a dropped row does not reuse an id", () => {
    let log = EMPTY_HIT_LOG;
    for (let i = 0; i < MAX_HITS + 5; i += 1) {
      log = appendHit(log, i, "x");
    }

    expect(log.rows).toHaveLength(MAX_HITS);
    expect(log.count).toBe(MAX_HITS + 5);
    expect(log.dropped).toBe(5);
    expect(log.rows[0]?.id).toBe(6);
    expect(log.rows[log.rows.length - 1]?.id).toBe(MAX_HITS + 5);
  });

  it("does not mutate the log it was given", () => {
    const before = appendHit(EMPTY_HIT_LOG, 1, "x");
    const after = appendHit(before, 2, "y");

    expect(before.rows).toHaveLength(1);
    expect(after.rows).toHaveLength(2);
  });
});

describe("hitSummary", () => {
  it("says so when nothing has happened", () => {
    expect(hitSummary(EMPTY_HIT_LOG)).toBe("No hits yet — the sphere is waiting.");
  });

  it("counts every hit, not just the rows that survived the cap", () => {
    let log = EMPTY_HIT_LOG;
    for (let i = 0; i < MAX_HITS + 2; i += 1) {
      log = appendHit(log, i, "x");
    }

    expect(hitSummary(log)).toBe(
      `${MAX_HITS + 2} hits · last at t ${MAX_HITS + 1}s · 2 earlier rows dropped`,
    );
  });

  it("uses the singular for one hit", () => {
    expect(hitSummary(appendHit(EMPTY_HIT_LOG, 4, "x"))).toBe("1 hit · last at t 4s");
  });
});
