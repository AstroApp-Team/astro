import { describe, expect, test } from "vite-plus/test";

import {
  staticResolver,
  type AssetResolver,
  type ClipAsset,
} from "@core/interfaces/animationAssets.ts";
import { withClipLayer, withoutLayer } from "@core/usecases/animationStateMachine/authoring.ts";
import type { MachineDefinition } from "@core/models/animationStateMachine.ts";
import {
  combinedResolver,
  listTheatreClips,
  theatreAssetResolver,
} from "@infra/theatre/animationStateMachine/theatreAssetResolver.ts";
import { loadDefinition } from "@infra/theatre/animationStateMachine/machineDefinitionStore.ts";

/**
 * Two rules that a demo cannot check and a type cannot express.
 *
 * 1. **A resolver that has never heard of an id answers `undefined`, not a throw.** A static
 *    clip table is the obvious primary in a combined resolver, and the first version of
 *    `combinedResolver` forwarded that `undefined` straight out — so every Theatre clip behind
 *    a static primary failed validation with "the resolver cannot produce <id>", pointing at a
 *    clip that was right there. That is what the first test pins.
 * 2. **What `withClipLayer` writes, `loadDefinition` must accept.** Authoring emits objects and
 *    the loader validates JSON against the same contract; when those two drift, the Studio
 *    writes a definition that `/machine` refuses to load with no clue where the edit went.
 */

const LINEAR: [number, number, number, number] = [1 / 3, 1 / 3, 2 / 3, 2 / 3];

/** Theatre's prop-path keys are JSON strings of the accessor path, not dotted names. */
function prop(...path: readonly string[]): string {
  return JSON.stringify(path);
}

function numberTrack(name: string, values: readonly (readonly [number, number])[]): unknown {
  return {
    type: "BasicKeyframedTrack",
    __debugName: name,
    keyframes: values.map(([position, value]) => ({
      type: "bezier",
      value,
      position,
      connectedRight: true,
      handles: LINEAR,
    })),
  };
}

/** A project state shaped like the exported file, with one object and one animated axis pair. */
const STATE = {
  sheetsById: {
    BallScene: {
      sequence: {
        length: 2,
        tracksByObject: {
          Ball: {
            trackIdByPropPath: {
              [prop("position", "x")]: "x",
              [prop("position", "y")]: "y",
              [prop("position", "z")]: "z",
            },
            trackData: {
              x: numberTrack("Ball.position.x", [
                [0, 0],
                [2, 1],
              ]),
              y: numberTrack("Ball.position.y", [
                [0, 0],
                [2, 0],
              ]),
              z: numberTrack("Ball.position.z", [
                [0, 0],
                [2, 0],
              ]),
            },
          },
        },
      },
    },
  },
};

/** `AssetResolver.clip` answers `null` for "not mine"; a test that wants one asserts it. */
function mustClip(resolver: AssetResolver, id: string): ClipAsset {
  const clip = resolver.clip(id);
  if (clip == null) throw new Error(`expected a clip for "${id}"`);
  return clip;
}

function theatreOnly(): AssetResolver {
  return theatreAssetResolver({ state: STATE });
}

const EMPTY_STATIC: AssetResolver = staticResolver([], []);

describe("combinedResolver", () => {
  test("a primary that answers undefined does not shadow the fallback", () => {
    const combined = combinedResolver(EMPTY_STATIC, theatreOnly());
    const clip = mustClip(combined, "BallScene/Ball");
    expect(clip.id).toBe("BallScene/Ball");
    expect(clip.duration).toBe(2);
    expect(clip.bones.map((bone) => bone.bone)).toStrictEqual(["Ball"]);
  });

  test("a primary that answers wins without touching the fallback", () => {
    const primary = staticResolver([{ id: "own", duration: 1, bones: [], morphs: [] }], []);
    let asked = 0;
    const fallback: AssetResolver = {
      clip: (id) => {
        asked += 1;
        return EMPTY_STATIC.clip(id);
      },
      morphCurve: () => null,
    };
    const combined = combinedResolver(primary, fallback);
    expect(mustClip(combined, "own").id).toBe("own");
    expect(asked).toBe(0);
  });

  test("a primary that throws falls through as well", () => {
    const primary: AssetResolver = {
      clip: () => {
        throw new Error("primary: nope");
      },
      morphCurve: () => null,
    };
    const combined = combinedResolver(primary, theatreOnly());
    expect(mustClip(combined, "BallScene/Ball").id).toBe("BallScene/Ball");
  });

  test("two resolvers that both miss still report a named failure", () => {
    const combined = combinedResolver(EMPTY_STATIC, theatreOnly());
    /* The failure names the sheet it looked in, which is the thing that was wrong. */
    expect(() => combined.clip("Nope/Missing")).toThrow(/sheet "Nope" has no sequence/);
  });

  test("listTheatreClips names the ids the resolver accepts", () => {
    const ids = listTheatreClips(STATE).map((clip) => clip.id);
    expect(ids).toStrictEqual(["BallScene/Ball"]);
  });
});

describe("authoring → loader parity", () => {
  const BASE = {
    schemaVersion: 1,
    name: "test",
    inputs: [],
    layers: [],
    constants: {},
    constraints: [],
  } as unknown as MachineDefinition;

  test("a layer emitted by withClipLayer survives the JSON the loader validates", () => {
    const edited = withClipLayer(BASE, { clipId: "BallScene/Ball" });
    const parsed = JSON.parse(JSON.stringify(edited)) as unknown;
    const loaded = loadDefinition(parsed);
    expect(loaded.layers).toHaveLength(1);
    expect(loaded.layers[0]?.states[0]).toMatchObject({ type: "clip", clip: "BallScene/Ball" });
    expect(loaded.layers[0]?.entry[0]?.to).toBe("clip");
  });

  test("adding the same clip twice edits the layer instead of stacking a second one", () => {
    const once = withClipLayer(BASE, { clipId: "BallScene/Ball" });
    const twice = withClipLayer(once, { clipId: "BallScene/Ball" });
    expect(twice.layers).toHaveLength(1);
  });

  test("removing the last layer throws rather than writing an unloadable definition", () => {
    const edited = withClipLayer(BASE, { clipId: "BallScene/Ball" });
    expect(() => withoutLayer(edited, "clip.ballscene-ball")).toThrow(/at least one layer/);
  });

  test("removing one of two layers still loads", () => {
    const two = withClipLayer(withClipLayer(BASE, { clipId: "BallScene/Ball" }), {
      clipId: "Other/Thing",
    });
    const removed = withoutLayer(two, "clip.ballscene-ball");
    const loaded = loadDefinition(JSON.parse(JSON.stringify(removed)) as unknown);
    expect(loaded.layers.map((layer) => layer.id)).toStrictEqual(["clip.other-thing"]);
  });
});
