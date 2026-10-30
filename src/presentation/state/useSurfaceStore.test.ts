import { beforeEach, describe, expect, it } from "vite-plus/test";

import { MAX_SURFACE_ROWS, SPHERE_COLORS } from "@core/usecases/surfaceInteraction.ts";
import { useSurfaceStore } from "@presentation/state/useSurfaceStore.ts";

import type { SurfacePress } from "@presentation/state/useSurfaceStore.ts";

/**
 * The store is the only channel between the meshes and the two page DOMs, so these
 * tests are about the two rules that fail silently: a press must *advance* state, and
 * a teardown must not undo a newer mount's state.
 *
 * The store is a module singleton, hence the `reset()` between cases.
 */

const press = (action: SurfacePress["action"], from = 1): SurfacePress => ({
  action,
  source: "texture",
  point: { x: 40, y: 20 },
  from,
});

const canvas = (label: string) => ({ label }) as unknown as HTMLCanvasElement;

beforeEach(() => {
  useSurfaceStore.getState().reset();
});

describe("useSurfaceStore.press", () => {
  /**
   * `nextSphereColor` jumps forward by a random offset, so the palette order is not
   * the sequence. What the page promises is weaker and must hold exactly: the colour
   * is always one of the swatches the page shows, and a press always changes it — a
   * button that repaints the sphere the same colour reads as a dead button.
   */
  it("repaints the sphere to a palette colour, never the same one twice", () => {
    const seen: string[] = [];

    for (let i = 0; i < 40; i += 1) {
      useSurfaceStore.getState().press(press("paint-sphere"));
      seen.push(useSurfaceStore.getState().sphereColor);
    }

    expect(seen).toHaveLength(40);
    for (const [i, color] of seen.entries()) {
      expect(SPHERE_COLORS).toContain(color);
      if (i > 0) expect(color).not.toBe(seen[i - 1]);
    }

    expect(useSurfaceStore.getState().log.rows).toHaveLength(40);
    expect(useSurfaceStore.getState().log.rows[0]?.source).toBe("texture");
  });

  /**
   * The spin request is a counter, not a boolean. A boolean is the same value the
   * second time the button is pressed, a selector on it does not re-render, and the
   * square stops turning after the first press with nothing in the UI to say so.
   */
  it("counts spin requests upward", () => {
    for (const expected of [1, 2, 3]) {
      useSurfaceStore.getState().press(press("spin-square"));
      expect(useSurfaceStore.getState().spinRequest).toBe(expected);
    }

    expect(useSurfaceStore.getState().sphereColor).toBe(SPHERE_COLORS[0]);
  });

  it("leaves the colour alone for a spin request", () => {
    useSurfaceStore.getState().press(press("paint-sphere"));
    const painted = useSurfaceStore.getState().sphereColor;

    useSurfaceStore.getState().press(press("spin-square"));
    expect(useSurfaceStore.getState().sphereColor).toBe(painted);
  });

  it("caps the log at MAX_SURFACE_ROWS rows", () => {
    for (let i = 0; i < MAX_SURFACE_ROWS + 25; i += 1) {
      useSurfaceStore.getState().press(press("spin-square"));
    }

    expect(useSurfaceStore.getState().log.rows).toHaveLength(MAX_SURFACE_ROWS);
  });
});

describe("useSurfaceStore canvases", () => {
  it("publishes a canvas and reports it back", () => {
    const square = canvas("square");
    useSurfaceStore.getState().registerCanvas("square", square);

    expect(useSurfaceStore.getState().canvases.square).toBe(square);
    expect(useSurfaceStore.getState().canvases.sphere).toBeNull();
  });

  /**
   * StrictMode mounts, unmounts and remounts. The unmount's cleanup releases the
   * canvas it registered, and by then the newer mount has published its own — a
   * plain `set(null)` would drop the live canvas, and the mesh would keep the
   * placeholder material for the rest of the session.
   */
  it("does not let a stale release drop the live canvas", () => {
    const first = canvas("first");
    const second = canvas("second");

    useSurfaceStore.getState().registerCanvas("square", first);
    useSurfaceStore.getState().registerCanvas("square", second);
    useSurfaceStore.getState().releaseCanvas("square", first);

    expect(useSurfaceStore.getState().canvases.square).toBe(second);

    useSurfaceStore.getState().releaseCanvas("square", second);
    expect(useSurfaceStore.getState().canvases.square).toBeNull();
  });
});

describe("useSurfaceStore versions", () => {
  /**
   * The scene uploads the texture when this counter moves. A bump on both surfaces
   * per raster is a 1 MB upload for pixels that did not change.
   */
  it("bumps only the surface that was rasterized", () => {
    useSurfaceStore.getState().notifyRaster("square");
    useSurfaceStore.getState().notifyRaster("square");

    expect(useSurfaceStore.getState().versions.square).toBe(2);
    expect(useSurfaceStore.getState().versions.sphere).toBe(0);
  });
});

describe("useSurfaceStore.reset", () => {
  it("clears the log, returns to the first swatch, and keeps the playhead", () => {
    useSurfaceStore.getState().setPlayhead(2.4);
    useSurfaceStore.getState().press(press("paint-sphere"));
    useSurfaceStore.getState().press(press("spin-square"));

    useSurfaceStore.getState().reset();

    const state = useSurfaceStore.getState();
    expect(state.log.rows).toHaveLength(0);
    expect(state.sphereColor).toBe(SPHERE_COLORS[0]);
    expect(state.spinRequest).toBe(0);
    expect(state.playhead).toBe(2.4);
  });
});
