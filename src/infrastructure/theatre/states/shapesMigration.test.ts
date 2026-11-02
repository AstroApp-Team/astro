import { describe, expect, it } from "vite-plus/test";

import { migrateLegacyShapes } from "@infra/theatre/states/index.ts";

const entry = {
  id: "sphere-0",
  kind: "sphere",
  theatreKey: "Sphere-0",
  position: [2.4, 0.75, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

describe("migrateLegacyShapes", () => {
  it("moves the flat entries list into the file's sheetId bucket", () => {
    const migrated = migrateLegacyShapes({
      ordinal: 3,
      sheetId: "SurfaceScene",
      cameraKey: "Surface Camera",
      entries: [entry],
    });

    expect(migrated).to.eql({
      ordinal: 3,
      sheetId: "SurfaceScene",
      cameraKey: "Surface Camera",
      entries: [entry],
      shapesBySheet: { SurfaceScene: [entry] },
    });
  });

  it("lands the entries in StudioSandbox when the file names no sheet", () => {
    const migrated = migrateLegacyShapes({ ordinal: 1, entries: [entry] });

    expect((migrated as { shapesBySheet: Record<string, unknown> }).shapesBySheet).to.eql({
      StudioSandbox: [entry],
    });
  });

  it("passes a file that is already in the new layout through untouched", () => {
    const current = {
      ordinal: 2,
      sheetId: "StudioSandbox",
      cameraKey: "Camera",
      shapesBySheet: { HubScene: [entry] },
    };

    expect(migrateLegacyShapes(current)).to.equal(current);
  });

  it("passes garbage through for the schema to reject, instead of inventing a bucket", () => {
    expect(migrateLegacyShapes(null)).to.equal(null);
    expect(migrateLegacyShapes(7)).to.equal(7);
    expect(migrateLegacyShapes({ ordinal: 1, entries: "nope" })).to.eql({
      ordinal: 1,
      entries: "nope",
    });
  });
});
