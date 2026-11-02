import { describe, expect, test } from "vite-plus/test";

import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import {
  clipLayerId,
  hasLayer,
  withClipLayer,
  withoutLayer,
} from "@core/usecases/animationStateMachine/authoring.ts";

const BASE = {
  schemaVersion: 1,
  name: "test",
  inputs: [{ kind: "trigger", name: "wave" }],
  layers: [
    {
      id: "base",
      priority: 0,
      blend: "override",
      weight: 1,
      entry: [{ to: "idle" }],
      states: [{ id: "idle", type: "clip", clip: "demo.idle" }],
      transitions: [],
    },
  ],
} as unknown as MachineDefinition;

describe("clipLayerId", () => {
  test("slugifies a Theatre clip id", () => {
    expect(clipLayerId("FloatScene/Float Sphere")).toBe("clip.floatscene-float-sphere");
  });

  test("never produces an empty id", () => {
    expect(clipLayerId("///")).toBe("clip.unnamed");
  });
});

describe("withClipLayer", () => {
  test("appends a layer that plays the clip from its entry state", () => {
    const next = withClipLayer(BASE, { clipId: "FloatScene/Float Sphere" });
    const layer = next.layers[next.layers.length - 1];
    expect(layer?.id).toBe("clip.floatscene-float-sphere");
    const state = layer?.states[0];
    expect(state?.type).toBe("clip");
    expect(state?.type === "clip" ? state.clip : null).toBe("FloatScene/Float Sphere");
    expect(layer?.entry?.[0]?.to).toBe(layer?.states[0]?.id);
  });

  test("priorities above every existing layer, so the new clip wins ties", () => {
    const next = withClipLayer(BASE, { clipId: "a/b" });
    const layer = next.layers[next.layers.length - 1];
    expect(layer?.priority).toBe(1);
  });

  test("is additive: the existing layers are untouched", () => {
    const next = withClipLayer(BASE, { clipId: "a/b" });
    expect(next.layers[0]).toBe(BASE.layers[0]);
    expect(next.layers).toHaveLength(2);
  });

  test("replaces a layer with the same id instead of stacking a second override", () => {
    const once = withClipLayer(BASE, { clipId: "a/b", layerId: "orbit" });
    const twice = withClipLayer(once, { clipId: "c/d", layerId: "orbit" });
    expect(twice.layers.filter((layer) => layer.id === "orbit")).toHaveLength(1);
    const orbit = twice.layers.find((layer) => layer.id === "orbit")?.states[0];
    expect(orbit?.type === "clip" ? orbit.clip : null).toBe("c/d");
    expect(twice.layers).toHaveLength(2);
  });

  test("a blank clip id is refused, not written as an unplayable layer", () => {
    expect(() => withClipLayer(BASE, { clipId: "   " })).toThrow(/clip id is required/);
  });

  test("does not mutate the definition it was given", () => {
    const before = JSON.stringify(BASE);
    withClipLayer(BASE, { clipId: "a/b" });
    expect(JSON.stringify(BASE)).toBe(before);
  });
});

describe("withoutLayer / hasLayer", () => {
  test("removes the named layer and keeps the rest", () => {
    const two = withClipLayer(BASE, { clipId: "Other/Thing" });
    const next = withoutLayer(two, "base");
    expect(next.layers.map((layer) => layer.id)).toStrictEqual(["clip.other-thing"]);
  });

  test("removing the last layer throws — the loader requires at least one", () => {
    expect(() => withoutLayer(BASE, "base")).toThrow(/at least one layer/);
  });

  test("an unknown id is a no-op", () => {
    expect(withoutLayer(BASE, "nope").layers).toHaveLength(1);
  });

  test("hasLayer answers for the pane's add/replace label", () => {
    expect(hasLayer(BASE, "base")).toBe(true);
    expect(hasLayer(BASE, "orbit")).toBe(false);
  });
});
