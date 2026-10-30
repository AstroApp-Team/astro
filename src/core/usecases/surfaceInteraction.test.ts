import { describe, expect, it } from "vite-plus/test";

import { SURFACE_SPECS } from "@core/models/surface.ts";
import {
  EMPTY_SURFACE_LOG,
  LOOP_STRIP_HEIGHT,
  LOOP_TILE_HEIGHT,
  MAX_SURFACE_ROWS,
  MAX_WHEEL_DELTA,
  MIN_VISIBLE_SIZE,
  SPHERE_COLORS,
  SURFACE_ACTIONS,
  WHEEL_LINE_PIXELS,
  advanceLoopScroll,
  appendSurfaceAction,
  clampWheelDelta,
  clipRectToWindow,
  describeAction,
  findSurfaceRect,
  isSurfaceAction,
  nextSphereColor,
  surfaceSummary,
  uvToSurfacePoint,
  wheelDeltaToPixels,
  type SurfaceRect,
} from "@core/usecases/surfaceInteraction.ts";

const square = SURFACE_SPECS.square;

/** The square page's button, as the page would publish it. */
const PAINT_BUTTON: SurfaceRect = {
  action: "paint-sphere",
  x: 34,
  y: 300,
  width: 300,
  height: 96,
};

describe("isSurfaceAction", () => {
  it("accepts only the ids the pages publish", () => {
    for (const action of SURFACE_ACTIONS) {
      expect(isSurfaceAction(action)).toBe(true);
    }
    expect(isSurfaceAction("spin-plane")).toBe(false);
    expect(isSurfaceAction(null)).toBe(false);
    expect(isSurfaceAction(0)).toBe(false);
  });
});

describe("uvToSurfacePoint", () => {
  /**
   * The flip is the whole test.
   *
   * three uploads a canvas with `flipY` set, so UV `v = 1` is the **top** row of the
   * page. Skip the flip and every hit is mirrored: a button at the bottom answers
   * taps at the top, which reads as "the buttons are a bit off" rather than as a
   * missing `1 - v`.
   */
  it("maps v = 1 to the top of the page", () => {
    const point = uvToSurfacePoint(0.5, 1, square);
    expect(point).not.toBeNull();
    expect(point?.y).toBeCloseTo(0, 5);
  });

  it("maps v = 0 to the bottom of the page", () => {
    const point = uvToSurfacePoint(0.5, 0, square);
    expect(point?.y).toBeCloseTo(square.height, 5);
  });

  it("maps u = 0 and u = 1 to the left and right edges", () => {
    expect(uvToSurfacePoint(0, 0.5, square)?.x).toBeCloseTo(0, 5);
    expect(uvToSurfacePoint(1, 0.5, square)?.x).toBeCloseTo(square.width, 5);
  });

  it("scales by the page's own pixels, not by the mesh's metres", () => {
    const point = uvToSurfacePoint(0.25, 0.5, square);
    expect(point?.x).toBeCloseTo(square.width * 0.25, 5);

    const sphere = SURFACE_SPECS.sphere;
    expect(uvToSurfacePoint(0.25, 0.5, sphere)?.x).toBeCloseTo(sphere.width * 0.25, 5);
    expect(uvToSurfacePoint(0.25, 0.5, sphere)?.y).toBeCloseTo(sphere.height * 0.5, 5);
  });

  it("refuses a UV outside the texture and a UV that is not a number", () => {
    expect(uvToSurfacePoint(-0.01, 0.5, square)).toBeNull();
    expect(uvToSurfacePoint(1.01, 0.5, square)).toBeNull();
    expect(uvToSurfacePoint(Number.NaN, 0.5, square)).toBeNull();
    expect(uvToSurfacePoint(0.5, Number.POSITIVE_INFINITY, square)).toBeNull();
  });
});

describe("findSurfaceRect", () => {
  it("finds the button a page pixel lands inside", () => {
    const rect = findSurfaceRect([PAINT_BUTTON], { x: 100, y: 350 });
    expect(rect?.action).toBe("paint-sphere");
  });

  it("includes both edges, so a hit on the border still presses", () => {
    expect(findSurfaceRect([PAINT_BUTTON], { x: 34, y: 300 })?.action).toBe("paint-sphere");
    expect(findSurfaceRect([PAINT_BUTTON], { x: 334, y: 396 })?.action).toBe("paint-sphere");
    expect(findSurfaceRect([PAINT_BUTTON], { x: 335, y: 397 })).toBeNull();
  });

  /**
   * The 0×0 case is the failure mode of the off-screen host: a subtree the browser
   * did not lay out publishes rects with no size, and a rect that swallows every
   * hit is worse than one that matches nothing.
   */
  it("skips a rect with no size", () => {
    const collapsed: SurfaceRect = { action: "paint-sphere", x: 0, y: 0, width: 0, height: 512 };
    expect(findSurfaceRect([collapsed], { x: 0, y: 0 })).toBeNull();

    const flat: SurfaceRect = { action: "spin-square", x: 0, y: 0, width: 512, height: 0 };
    expect(findSurfaceRect([flat], { x: 0, y: 0 })).toBeNull();
  });

  it("misses a pixel in the gap between buttons", () => {
    expect(findSurfaceRect([PAINT_BUTTON], { x: 100, y: 460 })).toBeNull();
  });

  it("takes the first rect when two overlap", () => {
    const overlay: SurfaceRect = { action: "spin-square", x: 0, y: 0, width: 512, height: 512 };
    expect(findSurfaceRect([PAINT_BUTTON, overlay], { x: 100, y: 350 })?.action).toBe(
      "paint-sphere",
    );
    expect(findSurfaceRect([overlay, PAINT_BUTTON], { x: 100, y: 350 })?.action).toBe(
      "spin-square",
    );
  });

  it("returns null for a page that published nothing", () => {
    expect(findSurfaceRect([], { x: 100, y: 350 })).toBeNull();
  });
});

describe("a press through the texture", () => {
  /**
   * The end-to-end pair the page depends on: a UV on the mesh, and the button the
   * page published at that pixel. Both halves are pure, and the composition is the
   * feature — so the composition is tested, not just the halves.
   */
  it("resolves the UV over the button to the button's action", () => {
    const centreX = (PAINT_BUTTON.x + PAINT_BUTTON.width / 2) / square.width;
    const centreY = 1 - (PAINT_BUTTON.y + PAINT_BUTTON.height / 2) / square.height;

    const point = uvToSurfacePoint(centreX, centreY, square);
    if (point == null) throw new Error("a UV inside the texture must produce a page pixel");
    expect(findSurfaceRect([PAINT_BUTTON], point)?.action).toBe("paint-sphere");
  });

  it("resolves the mirrored UV to nothing, which is the bug the flip prevents", () => {
    const centreX = (PAINT_BUTTON.x + PAINT_BUTTON.width / 2) / square.width;
    const unflipped = (PAINT_BUTTON.y + PAINT_BUTTON.height / 2) / square.height;

    const point = uvToSurfacePoint(centreX, unflipped, square);
    if (point == null) throw new Error("a UV inside the texture must produce a page pixel");
    expect(findSurfaceRect([PAINT_BUTTON], point)).toBeNull();
  });
});

describe("nextSphereColor", () => {
  it("never returns the colour the sphere already is", () => {
    for (const color of SPHERE_COLORS) {
      for (const draw of [0, 0.13, 0.5, 0.87, 0.999]) {
        expect(nextSphereColor(color, () => draw)).not.toBe(color);
      }
    }
  });

  it("returns a member of the palette for a colour outside it", () => {
    for (const draw of [0, 0.5, 0.999]) {
      expect(SPHERE_COLORS).toContain(nextSphereColor("#ffffff", () => draw));
    }
    expect(SPHERE_COLORS).toContain(nextSphereColor(null, () => 0.42));
  });

  it("walks the palette with a steady draw", () => {
    const first = nextSphereColor(SPHERE_COLORS[0] ?? null, () => 0);
    expect(first).toBe(SPHERE_COLORS[1]);
    expect(nextSphereColor(first, () => 0)).toBe(SPHERE_COLORS[2]);
  });

  it("stays inside the palette for a random draw", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(SPHERE_COLORS).toContain(nextSphereColor(SPHERE_COLORS[3] ?? null, Math.random));
    }
  });
});

describe("clampWheelDelta", () => {
  it("keeps a small delta and caps a large one in both directions", () => {
    expect(clampWheelDelta(37)).toBe(37);
    expect(clampWheelDelta(-37)).toBe(-37);
    expect(clampWheelDelta(4000)).toBe(MAX_WHEEL_DELTA);
    expect(clampWheelDelta(-4000)).toBe(-MAX_WHEEL_DELTA);
  });

  /**
   * `deltaMode: lines` and a flung trackpad both produce non-finite numbers on real
   * devices, and one of them reaching a transform is a page that vanishes.
   */
  it("scrolls nothing for a delta that is not a number", () => {
    expect(clampWheelDelta(Number.NaN)).toBe(0);
    expect(clampWheelDelta(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("wheelDeltaToPixels", () => {
  /**
   * Firefox and a mouse report `deltaMode: 1`, so a notch arrives as `3`. A page that
   * scrolls 3 px per notch reads as a wheel that barely moves, and that is exactly how a
   * correct-looking handler behaves on one browser and not the other.
   */
  it("converts a line-mode notch to pixels", () => {
    expect(wheelDeltaToPixels(3, 1)).toBe(WHEEL_LINE_PIXELS * 3);
    expect(wheelDeltaToPixels(-3, 1)).toBe(-WHEEL_LINE_PIXELS * 3);
  });

  it("leaves a pixel-mode delta alone", () => {
    expect(wheelDeltaToPixels(37, 0)).toBe(37);
    expect(wheelDeltaToPixels(-100, 0)).toBe(-100);
  });

  it("clamps after converting, so a line-mode delta is not clamped away", () => {
    // Five line-mode notches is 160 px, which the clamp shortens to one event's travel.
    expect(wheelDeltaToPixels(5, 1)).toBe(MAX_WHEEL_DELTA);
    // The same notch count in pixels is under the clamp, which is the point of
    // converting first: clamping `5` because it looks small would scroll 5 px.
    expect(wheelDeltaToPixels(5, 0)).toBe(5);
    expect(wheelDeltaToPixels(3, 1)).toBe(WHEEL_LINE_PIXELS * 3);
  });

  it("scrolls nothing for a delta that is not a number", () => {
    expect(wheelDeltaToPixels(Number.NaN, 0)).toBe(0);
    expect(wheelDeltaToPixels(Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});

describe("advanceLoopScroll", () => {
  it("stays inside one tile for any run of deltas", () => {
    let offset = 0;
    for (const delta of [120, 120, 120, -400, 900, -1200, 60, 60, 60, 60, 60]) {
      offset = advanceLoopScroll(offset, delta);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(LOOP_TILE_HEIGHT);
    }
  });

  /**
   * The seam test. A duplicated tile is invisible only if scrolling a full tile returns
   * you to the same offset — that is the moment the second tile takes over from the
   * first, and any drift shows as a jump at the wrap.
   *
   * The tile is travelled in clamped steps, because one wheel event cannot travel more
   * than `MAX_WHEEL_DELTA`: a caller that hands this function a 600 px delta is asking for
   * a scroll the clamp refuses, and a test that hands it one is testing the clamp, not
   * the wrap.
   */
  it("returns to the same offset after one full tile", () => {
    const steps = LOOP_TILE_HEIGHT / MAX_WHEEL_DELTA;
    expect(Number.isInteger(steps)).toBe(true);

    for (const start of [0, 17, 300, LOOP_TILE_HEIGHT - 1]) {
      let forward = start;
      let backward = start;
      for (let step = 0; step < steps; step += 1) {
        forward = advanceLoopScroll(forward, MAX_WHEEL_DELTA);
        backward = advanceLoopScroll(backward, -MAX_WHEEL_DELTA);
      }

      expect(forward).toBeCloseTo(start, 6);
      expect(backward).toBeCloseTo(start, 6);
    }
  });

  it("wraps backwards below zero without going negative", () => {
    expect(advanceLoopScroll(10, -30)).toBe(LOOP_TILE_HEIGHT - 20);
    expect(advanceLoopScroll(0, -1)).toBe(LOOP_TILE_HEIGHT - 1);
  });

  it("starts from zero when the current offset is not a number", () => {
    expect(advanceLoopScroll(Number.NaN, 40)).toBe(40);
  });

  it("returns zero for a tile with no height", () => {
    expect(advanceLoopScroll(120, 40, 0)).toBe(0);
  });

  it("respects a tile height the caller passes", () => {
    expect(advanceLoopScroll(90, 20, 100)).toBe(10);
  });
});

describe("loop geometry", () => {
  /**
   * The invariant the rect measurement depends on. The loop draws the tile twice, and both
   * copies are measured and published. That is only safe because the copies are
   * `LOOP_TILE_HEIGHT` apart and the window is `LOOP_STRIP_HEIGHT` tall, so at most one
   * copy is ever inside the window — and the window clip drops the rect of a copy that is
   * outside it. If the tile ever shrinks below two windows, two copies are on screen at
   * once, and a tap in the gap between them has two rects to land in.
   */
  it("keeps the tiles far enough apart that one window shows one copy", () => {
    expect(LOOP_TILE_HEIGHT).toBeGreaterThanOrEqual(LOOP_STRIP_HEIGHT * 2);
  });

  it("keeps the tile divisible by the wheel clamp", () => {
    expect(LOOP_TILE_HEIGHT % MAX_WHEEL_DELTA).toBe(0);
  });
});

describe("clipRectToWindow", () => {
  const window = { action: "spin-square", x: 0, y: 100, width: 640, height: 300 } as const;

  it("keeps a rect fully inside the window, unchanged", () => {
    const rect = { action: "spin-square", x: 40, y: 140, width: 200, height: 56 } as const;
    expect(clipRectToWindow(rect, window)).toEqual(rect);
  });

  it("clips a rect that hangs out of the window", () => {
    const clipped = clipRectToWindow(
      { action: "spin-square", x: 40, y: 60, width: 200, height: 100 },
      window,
    );

    expect(clipped).toEqual({ action: "spin-square", x: 40, y: 100, width: 200, height: 60 });
  });

  /**
   * The bug this exists for. A looped page clips its content at the window, but
   * `getBoundingClientRect` reports the element's full box wherever it has travelled, so
   * a button that is not drawn keeps a rect that reaches into the window and a tap on a
   * row that *is* drawn fires it.
   */
  it("publishes nothing for a rect entirely outside the window", () => {
    expect(
      clipRectToWindow({ action: "spin-square", x: 40, y: -200, width: 200, height: 56 }, window),
    ).toBeNull();
    expect(
      clipRectToWindow({ action: "spin-square", x: 700, y: 140, width: 200, height: 56 }, window),
    ).toBeNull();
  });

  it("publishes nothing for a sliver the user cannot aim at", () => {
    const sliver = clipRectToWindow(
      { action: "spin-square", x: 40, y: 96, width: 200, height: 10 },
      window,
      MIN_VISIBLE_SIZE,
    );

    // The window starts at y 100; the button spans 96–106, so 6 px of it is on screen.
    // That is not a target.
    expect(sliver).toBeNull();
  });

  it("keeps a rect clipped to exactly the minimum", () => {
    const kept = clipRectToWindow(
      { action: "spin-square", x: 40, y: 96, width: 200, height: 12 },
      window,
      MIN_VISIBLE_SIZE,
    );

    // 96–108 clipped to 100–108: exactly MIN_VISIBLE_SIZE of visible button.
    expect(kept?.height).toBe(MIN_VISIBLE_SIZE);
  });
});

describe("appendSurfaceAction", () => {
  it("numbers rows from the running count, newest first", () => {
    let log = EMPTY_SURFACE_LOG;
    log = appendSurfaceAction(log, "paint-sphere", "texture", { x: 1, y: 2 }, null);
    log = appendSurfaceAction(log, "spin-square", "page", null, 1.25);

    expect(log.rows.map((row) => row.id)).toEqual([2, 1]);
    expect(log.count).toBe(2);
  });

  it("keeps the source, the point and the playhead a press carried", () => {
    const log = appendSurfaceAction(
      EMPTY_SURFACE_LOG,
      "spin-square",
      "texture",
      { x: 8, y: 9 },
      2.5,
    );
    const row = log.rows[0];
    expect(row?.source).toBe("texture");
    expect(row?.point).toEqual({ x: 8, y: 9 });
    expect(row?.from).toBe(2.5);
  });

  it("caps the visible rows and keeps counting", () => {
    let log = EMPTY_SURFACE_LOG;
    for (let index = 0; index < MAX_SURFACE_ROWS + 25; index += 1) {
      log = appendSurfaceAction(log, "paint-sphere", "page", null, index / 10);
    }

    expect(log.rows.length).toBe(MAX_SURFACE_ROWS);
    expect(log.count).toBe(MAX_SURFACE_ROWS + 25);
    // Newest first: the newest press is at the top, and the window has dropped the
    // first 25.
    expect(log.rows[0]?.id).toBe(MAX_SURFACE_ROWS + 25);
    expect(log.rows[MAX_SURFACE_ROWS - 1]?.id).toBe(26);
  });
});

describe("describeAction", () => {
  it("names both actions in words a reader can use", () => {
    expect(describeAction("paint-sphere")).toBe("paint the colour sphere");
    expect(describeAction("spin-square")).toBe("spin the square page");
  });
});

describe("surfaceSummary", () => {
  it("says nothing happened when nothing happened", () => {
    expect(surfaceSummary(EMPTY_SURFACE_LOG)).toBe("Nothing pressed yet.");
  });

  it("counts presses through the texture separately", () => {
    let log = EMPTY_SURFACE_LOG;
    log = appendSurfaceAction(log, "paint-sphere", "texture", { x: 1, y: 2 }, null);
    log = appendSurfaceAction(log, "paint-sphere", "page", null, null);
    log = appendSurfaceAction(log, "spin-square", "texture", { x: 3, y: 4 }, 1);

    const summary = surfaceSummary(log);
    expect(summary).toContain("3 presses");
    expect(summary).toContain("2 through the texture");
    expect(summary).toContain("2 paints");
    expect(summary).toContain("1 spin");
  });

  it("says when the window is shorter than the count", () => {
    let log = EMPTY_SURFACE_LOG;
    for (let index = 0; index < MAX_SURFACE_ROWS + 10; index += 1) {
      log = appendSurfaceAction(log, "spin-square", "page", null, null);
    }
    expect(surfaceSummary(log)).toContain(`showing last ${MAX_SURFACE_ROWS}`);
  });
});
