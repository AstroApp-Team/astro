import { describe, expect, it } from "vite-plus/test";

import {
  SHAPE_KINDS,
  SHAPE_MENU,
  SHAPE_SPECS,
  SPAWN_ROTATION,
  isShapeKind,
  shapeTheatreKey,
  spawnPositionFor,
  spawnScaleFor,
} from "@core/models/shapes.ts";

/**
 * The catalogue the Studio menu reads.
 *
 * The interesting properties are the ones a menu click cannot see: keys are
 * unique (a duplicate `theatreKey` means two meshes share one outliner row, one
 * set of props and one set of keyframes, and nothing warns you), keys are long
 * enough for Theatre to accept, and the flat shapes really do lie flat.
 */
describe("shape catalogue", () => {
  it("lists exactly the four shapes the menu promises", () => {
    expect(SHAPE_MENU.map((spec) => spec.kind)).toEqual([...SHAPE_KINDS]);
    expect(SHAPE_MENU.map((spec) => spec.label)).toEqual([
      "Cube",
      "Sphere",
      "Flat Square",
      "Flat Circle",
    ]);
  });

  it("gives every kind a geometry with args", () => {
    for (const kind of SHAPE_KINDS) {
      const spec = SHAPE_SPECS[kind];
      expect(spec.args.length).toBeGreaterThan(0);
      expect(spec.args.every((n) => Number.isFinite(n) && n > 0)).toBe(true);
    }
  });

  it("guards the menu's string at the edge", () => {
    expect(isShapeKind("cube")).toBe(true);
    expect(isShapeKind("Cube")).toBe(false);
    expect(isShapeKind(undefined)).toBe(false);
    expect(isShapeKind("drop-table")).toBe(false);
  });
});

describe("shapeTheatreKey", () => {
  it("is unique across kinds and ordinals", () => {
    const keys = SHAPE_KINDS.flatMap((kind) => [0, 1, 2].map((n) => shapeTheatreKey(kind, n)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is long enough for Theatre to accept", () => {
    // Theatre rejects short ids; `c0` is not a key, and the failure is at
    // object-creation time, far from the menu click that caused it.
    for (const kind of SHAPE_KINDS) {
      expect(shapeTheatreKey(kind, 0).length).toBeGreaterThan(3);
    }
  });

  it("is stable for the same kind and ordinal", () => {
    expect(shapeTheatreKey("flat-square", 7)).toBe(shapeTheatreKey("flat-square", 7));
    expect(shapeTheatreKey("flat-square", 7)).toBe("Flat-Square-7");
  });
});

describe("spawn transforms", () => {
  it("lays the flat shapes on the grid and leaves the solids upright", () => {
    for (const kind of SHAPE_KINDS) {
      const rotation = SPAWN_ROTATION[kind];
      if (SHAPE_SPECS[kind].flat) {
        expect(rotation[0]).toBeCloseTo(-Math.PI / 2);
      } else {
        expect(rotation).toEqual([0, 0, 0]);
      }
    }
  });

  it("spawns the first dozen shapes in twelve different places", () => {
    const positions = Array.from({ length: 12 }, (_, i) => spawnPositionFor(i).join(","));
    expect(new Set(positions).size).toBe(12);
  });

  it("keeps every spawn above the floor", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(spawnPositionFor(i)[1]).toBeGreaterThan(0);
    }
  });

  it("gives the flat shapes a wider footprint than the solids", () => {
    expect(spawnScaleFor("flat-circle")[0]).toBeGreaterThan(spawnScaleFor("cube")[0]);
  });
});
