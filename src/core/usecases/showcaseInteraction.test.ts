import { describe, expect, it } from "vite-plus/test";

import { STING_NODES } from "@core/models/scene.ts";
import {
  SPAWN_ROTATION,
  spawnPositionFor,
  spawnScaleFor,
  shapeTheatreKey,
} from "@core/models/shapes.ts";
import type { SpawnedShape } from "@core/models/shapes.ts";
import {
  DEFAULT_ACCENT,
  findDynamicShape,
  randomAccentColor,
  replayRange,
  showsSelectionHighlight,
} from "@core/usecases/showcaseInteraction.ts";

/** The shape the Studio's Save button writes for `Sphere-0`, by hand. */
function sphere(ordinal: number): SpawnedShape {
  return {
    id: `sphere-${ordinal}`,
    kind: "sphere",
    theatreKey: shapeTheatreKey("sphere", ordinal),
    position: spawnPositionFor(ordinal),
    rotation: [...SPAWN_ROTATION.sphere] as [number, number, number],
    scale: spawnScaleFor("sphere"),
  };
}

describe("randomAccentColor", () => {
  it("keeps saturation and lightness fixed and moves only the hue", () => {
    expect(randomAccentColor(() => 0)).toBe("hsl(0 72% 56%)");
    expect(randomAccentColor(() => 0.5)).toBe("hsl(180 72% 56%)");
    expect(randomAccentColor(() => 0.999999)).toBe("hsl(359 72% 56%)");
  });

  it("stays inside the readable band for every draw", () => {
    for (let i = 0; i < 500; i += 1) {
      const color = randomAccentColor();
      const match = /^hsl\((\d{1,3}) (\d{2})% (\d{2})%\)$/.exec(color);
      expect(match).not.toBeNull();
      const [, hue, saturation, lightness] = match as unknown as [string, string, string, string];
      expect(Number(hue)).toBeGreaterThanOrEqual(0);
      expect(Number(hue)).toBeLessThan(360);
      expect(Number(saturation)).toBe(72);
      expect(Number(lightness)).toBe(56);
    }
  });

  it("clamps a port that leaves [0, 1) rather than emitting a negative hue", () => {
    expect(randomAccentColor(() => -1)).toBe("hsl(0 72% 56%)");
    expect(randomAccentColor(() => 4)).toBe("hsl(359 72% 56%)");
  });

  it("is not the resting accent, so a click visibly changes the button", () => {
    expect(randomAccentColor(() => 0.5)).not.toBe(DEFAULT_ACCENT);
  });
});

describe("findDynamicShape", () => {
  const shapes = [sphere(0), sphere(1)];

  it("matches the theatreKey the raycast writes", () => {
    expect(findDynamicShape(shapes, "Sphere-0")?.id).toBe("sphere-0");
    expect(findDynamicShape(shapes, "Sphere-1")?.id).toBe("sphere-1");
  });

  it("returns null for a prefab key, so the demo hook stays keyed on spawned shapes", () => {
    for (const node of STING_NODES) {
      expect(findDynamicShape(shapes, node.theatreKey)).toBeNull();
    }
  });

  it("returns null for nothing selected and for an unknown key", () => {
    expect(findDynamicShape(shapes, null)).toBeNull();
    expect(findDynamicShape(shapes, "Sphere-9")).toBeNull();
    expect(findDynamicShape([], "Sphere-0")).toBeNull();
  });
});

describe("replayRange", () => {
  it("spans the whole rigged sequence", () => {
    expect(replayRange(4)).toEqual([0, 4]);
  });

  it("returns null for a sheet nobody has rigged, which sequence.play() rejects", () => {
    expect(replayRange(0)).toBeNull();
    expect(replayRange(Number.NaN)).toBeNull();
    expect(replayRange(Number.POSITIVE_INFINITY)).toBeNull();
    expect(replayRange(-2)).toBeNull();
  });
});

describe("showsSelectionHighlight", () => {
  it("highlights the selected node on the rigging side", () => {
    expect(showsSelectionHighlight(true, "Sphere-0", "Sphere-0")).toBe(true);
  });

  it("never highlights a node that is not the selected one", () => {
    expect(showsSelectionHighlight(true, "Sphere-0", "Cube-0")).toBe(false);
    expect(showsSelectionHighlight(true, null, "Sphere-0")).toBe(false);
  });

  /**
   * The showcase's rule: the highlight is off, the selection is not. A
   * `selectionVisuals` flag that also cleared `selectedNodeId` would pass the
   * first two assertions here and break the page, whose whole sphere hook is
   * that write.
   */
  it("draws nothing as selected when the page turns selection visuals off", () => {
    expect(showsSelectionHighlight(false, "Sphere-0", "Sphere-0")).toBe(false);
    expect(showsSelectionHighlight(false, "Sphere-0", "Cube-0")).toBe(false);
    expect(showsSelectionHighlight(false, null, "Sphere-0")).toBe(false);
  });
});
