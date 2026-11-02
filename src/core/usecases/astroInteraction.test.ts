import { describe, expect, it } from "vite-plus/test";

import { ASTRO_STATES } from "@core/models/astro.ts";
import {
  ASTRO_ACCENTS,
  ASTRO_HIT_MESSAGE,
  EMPTY_ASTRO_HIT_LOG,
  MAX_HITS,
  appendAstroHit,
  astroHitSummary,
  hitReaction,
  nextAstroSeek,
  rollAstroAccent,
} from "@core/usecases/astroInteraction.ts";

describe("appendAstroHit", () => {
  it("prepends a row, stamps the playhead and bumps the lifetime count", () => {
    const first = appendAstroHit(EMPTY_ASTRO_HIT_LOG, 1.25, "happy");
    expect(first.count).toBe(1);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toEqual({
      id: 1,
      text: ASTRO_HIT_MESSAGE,
      playhead: 1.25,
      expression: "happy",
    });

    const second = appendAstroHit(first, 2.5, "alert");
    expect(second.count).toBe(2);
    expect(second.rows.map((row) => row.id)).toEqual([2, 1]);
  });

  it("never grows past MAX_HITS but keeps counting", () => {
    let log = EMPTY_ASTRO_HIT_LOG;
    for (let i = 0; i < MAX_HITS + 5; i += 1) log = appendAstroHit(log, i, "idle");

    expect(log.rows).toHaveLength(MAX_HITS);
    expect(log.count).toBe(MAX_HITS + 5);
    expect(log.rows[0]?.id).toBe(MAX_HITS + 5);
    expect(log.rows[MAX_HITS - 1]?.id).toBe(6);
  });

  it("falls back to 0 for a non-finite playhead", () => {
    const log = appendAstroHit(EMPTY_ASTRO_HIT_LOG, Number.NaN, "idle");
    expect(log.rows[0]?.playhead).toBe(0);
  });
});

describe("astroHitSummary", () => {
  it("says so when nothing has been tapped", () => {
    expect(astroHitSummary(EMPTY_ASTRO_HIT_LOG)).toBe("No taps yet — the character is waiting.");
  });

  it("uses the singular and names the last expression", () => {
    const one = appendAstroHit(EMPTY_ASTRO_HIT_LOG, 0, "happy");
    expect(astroHitSummary(one)).toBe("1 tap · last: happy");
    const two = appendAstroHit(one, 1, "wonder");
    expect(astroHitSummary(two)).toBe("2 taps · last: wonder");
  });
});

describe("hitReaction", () => {
  it("greets an awake character with a transient happy", () => {
    expect(hitReaction("idle")).toBe("happy");
    expect(hitReaction("look-left")).toBe("happy");
    expect(hitReaction("look-right-shifted")).toBe("happy");
  });

  it("wakes a sleeping character one notch instead", () => {
    expect(hitReaction("deep-sleep")).toBe("sleep");
    expect(hitReaction("sleep")).toBe("doze");
    expect(hitReaction("doze")).toBe("idle");
  });

  it("ignores a tap that lands during a reaction", () => {
    for (const state of ASTRO_STATES) {
      const next = hitReaction(state);
      if (
        state === "alert" ||
        state === "wonder" ||
        state === "happy" ||
        state.startsWith("think")
      ) {
        expect(next).toBe(state);
      }
    }
  });
});

describe("rollAstroAccent", () => {
  it("only ever returns a colour the character's own body is drawn in", () => {
    for (const draw of [0, 0.24, 0.26, 0.5, 0.75, 0.999]) {
      expect(ASTRO_ACCENTS).toContain(rollAstroAccent(() => draw));
    }
  });

  it("walks the palette in order and clamps out-of-range draws", () => {
    expect(rollAstroAccent(() => 0)).toBe(ASTRO_ACCENTS[0]);
    expect(rollAstroAccent(() => 0.999)).toBe(ASTRO_ACCENTS[ASTRO_ACCENTS.length - 1]);
    expect(rollAstroAccent(() => -1)).toBe(ASTRO_ACCENTS[0]);
    expect(rollAstroAccent(() => 2)).toBe(ASTRO_ACCENTS[ASTRO_ACCENTS.length - 1]);
  });
});

describe("nextAstroSeek", () => {
  it("moves a quarter of the clip forward", () => {
    expect(nextAstroSeek(8, 0)).toBe(2);
    expect(nextAstroSeek(8, 2)).toBe(4);
    expect(nextAstroSeek(8, 7)).toBe(1);
  });

  it("stays inside the clip for every start", () => {
    for (let from = 0; from <= 8; from += 0.25) {
      const at = nextAstroSeek(8, from);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(8);
    }
  });

  it("returns 0 for a sheet with no length", () => {
    expect(nextAstroSeek(0, 3)).toBe(0);
    expect(nextAstroSeek(Number.NaN, 3)).toBe(0);
  });
});
