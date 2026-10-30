import { describe, expect, it } from "vite-plus/test";

import { SHAPE_KINDS } from "@core/models/shapes.ts";
import {
  SAVED_SHAPE_KINDS,
  StudioSavePayloadSchema,
  THEATRE_STATE_DEFINITION_VERSION,
  emptySavedShapes,
  emptyTheatreState,
  mergeProjectState,
  type TheatreState,
} from "@shared/studio-save.ts";

const state = (sheetsById: Record<string, unknown>): TheatreState => ({
  definitionVersion: THEATRE_STATE_DEFINITION_VERSION,
  sheetsById,
  revisionHistory: [],
});

const shape = {
  id: "cube-0",
  kind: "cube" as const,
  theatreKey: "Cube-0",
  position: [1, 2, 3] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

describe("mergeProjectState", () => {
  it("returns the canonical file untouched when there is no local save", () => {
    const canonical = { sheetsById: { StingScene: { a: 1 } }, definitionVersion: "0.4.0" };
    expect(mergeProjectState(canonical, null)).to.equal(canonical);
  });

  it("returns the canonical file when the local save has no sheets", () => {
    const canonical = { sheetsById: { StingScene: { a: 1 } } };
    expect(mergeProjectState(canonical, state({}))).to.equal(canonical);
  });

  it("lets the local copy of a sheet win, sheet by sheet", () => {
    const canonical = {
      sheetsById: { StingScene: { rig: "canonical" }, HubScene: { rig: "hub" } },
    };
    const merged = mergeProjectState(canonical, state({ StingScene: { rig: "local" } }));

    expect(merged.sheetsById).to.eql({
      StingScene: { rig: "local" },
      HubScene: { rig: "hub" },
    });
  });

  it("keeps a sheet the local save has never heard of", () => {
    // The CLI lands rigs in the canonical file; a local save of the sandbox must
    // not be able to erase a scene nobody opened in the Studio.
    const canonical = { sheetsById: { StingScene: { rig: "canonical" } } };
    const merged = mergeProjectState(canonical, state({ StudioSandbox: { rig: "local" } }));

    expect(Object.keys(merged.sheetsById as Record<string, unknown>).sort()).to.eql([
      "StingScene",
      "StudioSandbox",
    ]);
  });
});

describe("StudioSavePayloadSchema", () => {
  const payload = {
    state: state({ StudioSandbox: {} }),
    shapes: { ...emptySavedShapes(), entries: [shape] },
  };

  it("accepts what the Save button builds", () => {
    expect(StudioSavePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("carries the spawn ordinal through, because a reload must not reissue a theatreKey", () => {
    const parsed = StudioSavePayloadSchema.parse({
      ...payload,
      shapes: { ...payload.shapes, ordinal: 7 },
    });
    expect(parsed.shapes.ordinal).toBe(7);
  });

  it("rejects a shape kind outside the catalogue", () => {
    const bad = {
      ...payload,
      shapes: { ...payload.shapes, entries: [{ ...shape, kind: "dodecahedron" }] },
    };
    const parsed = StudioSavePayloadSchema.safeParse(bad);

    expect(parsed.success).toBe(false);
  });

  it("rejects a fractional ordinal, which is a counter, not a quantity", () => {
    expect(
      StudioSavePayloadSchema.safeParse({ ...payload, shapes: { ...payload.shapes, ordinal: 1.5 } })
        .success,
    ).toBe(false);
  });

  it("rejects a state object with no sheetsById", () => {
    const parsed = StudioSavePayloadSchema.safeParse({
      ...payload,
      state: { definitionVersion: THEATRE_STATE_DEFINITION_VERSION },
    });

    expect(parsed.success).toBe(false);
  });

  it("lets Theatre's own extra keys through untouched", () => {
    // `.loose()` on purpose: a state file that carries a key this schema has never
    // seen is a newer @theatre/core, not a malformed payload.
    const parsed = StudioSavePayloadSchema.safeParse({
      ...payload,
      state: { ...payload.state, nextRevision: 12 },
    });

    expect(parsed.success).toBe(true);
  });
});

describe("the empty files a checkout ships", () => {
  it("writes the definition version this @theatre/core reads", () => {
    expect(emptyTheatreState().definitionVersion).toBe(THEATRE_STATE_DEFINITION_VERSION);
    expect(emptyTheatreState().sheetsById).to.eql({});
  });

  it("starts the counter at zero on the sandbox sheet", () => {
    const shapes = emptySavedShapes();
    expect(shapes.ordinal).toBe(0);
    expect(shapes.sheetId).toBe("StudioSandbox");
    expect(shapes.entries).to.eql([]);
  });
});

describe("shape kinds", () => {
  it("match the catalogue in core/models/shapes.ts", () => {
    // `shared/` sits below `src/` in the import graph, so it cannot import the
    // catalogue. This test is the drift guard: add a shape to `SHAPE_KINDS` and
    // the save schema starts rejecting it, loudly, here.
    expect([...SAVED_SHAPE_KINDS].sort()).to.eql([...SHAPE_KINDS].sort());
  });
});
