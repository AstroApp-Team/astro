import { describe, expect, it } from "vite-plus/test";

import { STING_NODES } from "@core/models/scene.ts";
import {
  SHOWCASE_PANELS,
  showcasePanelFor,
} from "@presentation/ui/components/showcasePanels/registry.ts";

/**
 * The registry is a mapping between two independently-edited lists: the scene's
 * node array and four panel components. Nothing in the app checks that the two
 * still agree, so these tests are the check.
 */
describe("SHOWCASE_PANELS", () => {
  const keys = Object.keys(SHOWCASE_PANELS);

  it("covers exactly the four satellites, and not the core", () => {
    expect(keys).toEqual(["Sting-Sat-1", "Sting-Sat-2", "Sting-Sat-3", "Sting-Sat-4"]);
    expect(SHOWCASE_PANELS["Sting-Core"]).toBeUndefined();
  });

  /**
   * The naming rule: a panel is called what the card on top of its cube says.
   *
   * `title` and `SceneNode.label` are two strings in two files. Rename a label in
   * `STING_NODES` and the scene's card says one word while the sheet that opens
   * says another, with nothing in the app to notice.
   */
  it("names each panel after the label its cube paints", () => {
    for (const [key, entry] of Object.entries(SHOWCASE_PANELS)) {
      const node = STING_NODES.find((candidate) => candidate.theatreKey === key);
      expect(node, `no scene node has theatreKey ${key}`).toBeDefined();
      expect(entry.title).toBe(node?.label);
    }
  });

  it("registers a component for every entry", () => {
    for (const entry of Object.values(SHOWCASE_PANELS)) {
      expect(typeof entry.Panel).toBe("function");
    }
  });

  it("every satellite key in the scene opens a panel", () => {
    for (const node of STING_NODES) {
      const opens = showcasePanelFor(node.theatreKey) != null;
      expect(opens).toBe(node.theatreKey !== "Sting-Core");
    }
  });
});

describe("showcasePanelFor", () => {
  it("returns null for nothing selected", () => {
    expect(showcasePanelFor(null)).toBeNull();
  });

  it("returns null for keys the scene does not mount", () => {
    expect(showcasePanelFor("Sphere-0")).toBeNull();
    expect(showcasePanelFor("Cube-3")).toBeNull();
    expect(showcasePanelFor("Sting Camera")).toBeNull();
  });

  it("resolves a satellite key to its panel", () => {
    expect(showcasePanelFor("Sting-Sat-2")?.title).toBe("Archive");
  });
});
