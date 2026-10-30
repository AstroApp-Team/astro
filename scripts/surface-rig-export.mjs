#!/usr/bin/env node
/**
 * Emits a Studio-shaped export for the `SurfaceScene` sheet.
 *
 * The Studio is the normal way to author a rig, and `/rig/surface` rigs this exact
 * sheet — this script exists because the rig the `/surface` page needs is a single
 * numeric curve, and there is no headless browser here to click a Studio with. It
 * writes the same JSON the Studio writes (same `definitionVersion`, same
 * `sheetsById` → `sequence.tracksByObject` → `trackData` shape as the landed
 * `FloatScene` sheet), so the sanctioned land step is unchanged:
 *
 *   node scripts/surface-rig-export.mjs --out /tmp/surface.export.json
 *   pnpm run theatre:state -- import /tmp/surface.export.json --to SurfaceScene
 *
 * What it rigs, and why nothing else:
 *
 *   `Surface Plane.rotation.y` — one slow turn, 0 → 2π across `SPIN_RANGE`, with
 *   eased tangents at both ends so the plane starts from rest and arrives at rest.
 *
 * That is the only keyframed prop on the sheet. `Surface Plane.position`, both
 * sphere transforms, the camera and the lights are JSX, and the colour sphere's
 * colour is app state — a prop keyframed *and* written from code is a prop the clip
 * wins silently, with nothing to warn you.
 *
 * The curve is a smoothstep sampled at five points, not a straight ramp: a linear
 * ramp has a corner at each end, so the plane snaps into the turn and snaps out of
 * it, which is exactly the "slowly, with smooth tangents" the page promises.
 */

import { writeFileSync } from "node:fs";

/** Must match `currentProjectStateDefinitionVersion` in the installed @theatre/core. */
const DEFINITION_VERSION = "0.4.0";

const SHEET_ID = "SurfaceScene";
const OBJECT = "Surface Plane";
const PROP_PATH = '["rotation","y"]';
const TRACK_ID = "t-sp-ry";

/** Mirrors `SPIN_RANGE` in `src/core/models/scene.ts`. */
const SPIN_START = 0;
const SPIN_END = 3;
const SPIN_ANGLE = Math.PI * 2;

/** Mirrors `subUnitsPerUnit` on every other sheet in the canonical file. */
const SUB_UNITS_PER_UNIT = 30;

/** Theatre's default eased handle pair: ⅓ and ⅔ of the gap to the neighbour. */
const HANDLES = [1 / 3, 1 / 3, 2 / 3, 2 / 3];

/**
 * Smoothstep: zero derivative at 0 and 1, so the turn leaves rest and reaches rest.
 * `u` is the normalized position through the spin.
 */
function ease(u) {
  return u * u * (3 - 2 * u);
}

function keyframes() {
  const samples = 4;
  const frames = [];

  for (let index = 0; index <= samples; index += 1) {
    const u = index / samples;
    const position = SPIN_START + (SPIN_END - SPIN_START) * u;
    const value = SPIN_ANGLE * ease(u);

    frames.push({
      id: `kf-sp-${String(index + 1).padStart(3, "0")}`,
      value: Number(value.toFixed(4)),
      position: Number(position.toFixed(4)),
      handles: HANDLES,
      connectedRight: true,
      type: "bezier",
    });
  }

  return frames;
}

const exportState = {
  sheetsById: {
    [SHEET_ID]: {
      staticOverrides: { byObject: {} },
      sequence: {
        type: "PositionalSequence",
        length: SPIN_END,
        subUnitsPerUnit: SUB_UNITS_PER_UNIT,
        tracksByObject: {
          [OBJECT]: {
            trackIdByPropPath: { [PROP_PATH]: TRACK_ID },
            trackData: {
              [TRACK_ID]: {
                type: "BasicKeyframedTrack",
                __debugName: `${OBJECT}.rotation.y`,
                keyframes: keyframes(),
              },
            },
          },
        },
      },
    },
  },
  revisionHistory: ["rev-surface-export"],
  definitionVersion: DEFINITION_VERSION,
};

const outIndex = process.argv.indexOf("--out");
const outPath = outIndex === -1 ? null : process.argv[outIndex + 1];

if (outPath == null) {
  console.error("usage: node scripts/surface-rig-export.mjs --out <path>");
  process.exit(1);
}

writeFileSync(outPath, `${JSON.stringify(exportState, null, 2)}\n`);
console.log(`wrote ${outPath}: sheet ${SHEET_ID}, ${OBJECT}.rotation.y, 5 keyframes`);
