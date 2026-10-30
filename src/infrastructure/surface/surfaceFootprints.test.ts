import { beforeEach, describe, expect, it } from "vite-plus/test";

import { FOOTPRINT_EPSILON } from "@core/usecases/surfaceFootprint.ts";
import {
  clearSurfaceFootprint,
  getSurfaceFootprint,
  setSurfaceFootprint,
  subscribeSurfaceFootprint,
} from "@infra/surface/surfaceFootprints.ts";

import type { SurfaceFootprint } from "@core/usecases/surfaceFootprint.ts";

/**
 * The channel between the render loop and the touch shield.
 *
 * Two rules matter, and both are invisible when they break. A footprint that notifies
 * on every frame is a DOM write 60 times a second for a sphere that bobs by a third of
 * a pixel; a footprint left behind on teardown is a shield that keeps swallowing
 * touches on a page with no mesh under it.
 */

const box: SurfaceFootprint = { left: 40, top: 120, width: 180, height: 180 };

beforeEach(() => {
  clearSurfaceFootprint("square");
  clearSurfaceFootprint("sphere");
});

describe("setSurfaceFootprint / getSurfaceFootprint", () => {
  it("publishes a box and reports it back", () => {
    setSurfaceFootprint("sphere", box);
    expect(getSurfaceFootprint("sphere")).toEqual(box);
  });

  it("keeps the two surfaces apart", () => {
    setSurfaceFootprint("square", box);
    expect(getSurfaceFootprint("sphere")).toBeNull();
  });

  it("clears on a null publish", () => {
    setSurfaceFootprint("sphere", box);
    setSurfaceFootprint("sphere", null);
    expect(getSurfaceFootprint("sphere")).toBeNull();
  });
});

describe("subscribeSurfaceFootprint", () => {
  it("fires immediately with the current box, so a late mount starts in place", () => {
    setSurfaceFootprint("sphere", box);

    const seen: (SurfaceFootprint | null)[] = [];
    const unsubscribe = subscribeSurfaceFootprint("sphere", (footprint) => {
      seen.push(footprint);
    });

    expect(seen).toEqual([box]);
    unsubscribe();
  });

  it("fires on a real move and on a clear", () => {
    const seen: (SurfaceFootprint | null)[] = [];
    const unsubscribe = subscribeSurfaceFootprint("sphere", (footprint) => {
      seen.push(footprint);
    });

    setSurfaceFootprint("sphere", box);
    setSurfaceFootprint("sphere", { ...box, top: box.top + 40 });
    clearSurfaceFootprint("sphere");

    expect(seen).toEqual([null, box, { ...box, top: box.top + 40 }, null]);
    unsubscribe();
  });

  /**
   * The bob. `useFrame` publishes every frame, and a box that moved by a third of a
   * pixel is the same box — without this check the shield writes `style.left` on every
   * frame of every clip, forever.
   */
  it("does not notify for a move below the epsilon", () => {
    setSurfaceFootprint("sphere", box);

    let calls = 0;
    const unsubscribe = subscribeSurfaceFootprint("sphere", () => {
      calls += 1;
    });
    const baseline = calls;

    setSurfaceFootprint("sphere", {
      ...box,
      left: box.left + FOOTPRINT_EPSILON / 3,
      top: box.top + FOOTPRINT_EPSILON / 3,
      width: box.width + FOOTPRINT_EPSILON / 3,
      height: box.height + FOOTPRINT_EPSILON / 3,
    });

    expect(calls).toBe(baseline);
    unsubscribe();
  });

  it("stops notifying once unsubscribed", () => {
    let calls = 0;
    const unsubscribe = subscribeSurfaceFootprint("sphere", () => {
      calls += 1;
    });

    unsubscribe();
    setSurfaceFootprint("sphere", box);

    expect(calls).toBe(1);
  });

  it("keeps one subscriber's box for the other surface", () => {
    const sphere: (SurfaceFootprint | null)[] = [];
    const unsubscribe = subscribeSurfaceFootprint("sphere", (footprint) => {
      sphere.push(footprint);
    });

    setSurfaceFootprint("square", box);
    // The subscribe fired once with the sphere's own (empty) box, and nothing since.
    expect(sphere).toEqual([null]);

    unsubscribe();
  });
});
