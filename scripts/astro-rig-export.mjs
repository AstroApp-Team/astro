#!/usr/bin/env node
/**
 * Emits a Studio-shaped export for the `AstroScene` sheet.
 *
 * The Studio is the normal way to author a rig, and `/rig/astro` rigs this exact
 * sheet — this script exists because the rig the `/astro` page needs is a slow
 * three-axis drift, and there is no headless browser here to click a Studio with.
 * It writes the same JSON the Studio writes (same `definitionVersion`, same
 * `sheetsById` → `sequence.tracksByObject` → `trackData` shape as the landed
 * `FloatScene` and `SurfaceScene` sheets), so the sanctioned land step is
 * unchanged:
 *
 *   node scripts/astro-rig-export.mjs --out /tmp/astro.export.json
 *   pnpm run theatre:state -- import /tmp/astro.export.json --to AstroScene
 *
 * What it rigs, and why nothing else:
 *
 *   `Astro.position.{x,y,z}` — a figure-of-eight-ish sway across `ASTRO_AUTOPLAY`,
 *   eight seconds, five keys per axis. The character is calm (`05-motion.md`):
 *   the amplitude is under one body diameter in x and half of one in y, and every
 *   curve starts and ends at rest because the first and last keys sit on the same
 *   value as their neighbour's mirror.
 *
 * That is the only keyframed object on the sheet. What is deliberately absent:
 *
 *   - **no `rotation` track.** The character is a flat plane wearing a texture;
 *     a keyframed turn shows the page its edge and the drawing disappears. The
 *     plane faces the camera for the whole clip.
 *   - **no `expression` track.** There is no such prop — the face is
 *     `useAstroStore.expression`, a texture swap. A keyframed face would win over
 *     the page's picker silently.
 *   - **no camera keys.** `AstroScene` passes `ASTRO_CAMERA` as Theatre's initial
 *     value; nothing moves it, and `astroTexture.ts` measured the body size
 *     against that exact framing, so a camera track would rescale the one number
 *     that was measured.
 */

import { writeFileSync } from "node:fs";

/** Must match `currentProjectStateDefinitionVersion` in the installed @theatre/core. */
const DEFINITION_VERSION = "0.4.0";

const SHEET_ID = "AstroScene";
const OBJECT = "Astro";

/** Mirrors `ASTRO_AUTOPLAY` in `src/core/models/scene.ts`. */
const LENGTH = 8;

/** Mirrors `subUnitsPerUnit` on every other sheet in the canonical file. */
const SUB_UNITS_PER_UNIT = 30;

/** Theatre's default eased handle pair: ⅓ and ⅔ of the gap to the neighbour. */
const HANDLES = [1 / 3, 1 / 3, 2 / 3, 2 / 3];

/** The drift's centre, mirroring `ASTRO_NODES[0].position`. */
const CENTRE = { x: 0, y: 1.6, z: 0 };

/**
 * One curve per axis, as `[position, value]` pairs.
 *
 * x sways the full ±0.7, y bobs ±0.22 around 1.6, z breathes ±0.3 so the
 * character's apparent size changes a little — but no axis ever moves enough to
 * put the body outside the camera's 35–65% band, because the page's log panel
 * starts below that band and a character resting on top of the panel is a
 * character whose taps fight the panel's text selection.
 */
const CURVES = {
  x: [
    [0, CENTRE.x],
    [2, CENTRE.x + 0.7],
    [4, CENTRE.x],
    [6, CENTRE.x - 0.7],
    [8, CENTRE.x],
  ],
  y: [
    [0, CENTRE.y],
    [2, CENTRE.y + 0.22],
    [4, CENTRE.y],
    [6, CENTRE.y - 0.22],
    [8, CENTRE.y],
  ],
  z: [
    [0, CENTRE.z],
    [2, CENTRE.z - 0.3],
    [4, CENTRE.z],
    [6, CENTRE.z + 0.3],
    [8, CENTRE.z],
  ],
};

const AXES = [
  ["x", "t-a-px"],
  ["y", "t-a-py"],
  ["z", "t-a-pz"],
];

function keyframes(axis, frames) {
  return frames.map(([position, value], index) => ({
    id: `kf-a-${axis}-${String(index + 1).padStart(3, "0")}`,
    value: Number(value.toFixed(4)),
    position: Number(position.toFixed(4)),
    handles: HANDLES,
    connectedRight: true,
    type: "bezier",
  }));
}

const trackIdByPropPath = {};
const trackData = {};

for (const [axis, trackId] of AXES) {
  trackIdByPropPath[`["position","${axis}"]`] = trackId;
  trackData[trackId] = {
    type: "BasicKeyframedTrack",
    __debugName: `${OBJECT}.position.${axis}`,
    keyframes: keyframes(axis, CURVES[axis]),
  };
}

const exportState = {
  sheetsById: {
    [SHEET_ID]: {
      staticOverrides: { byObject: {} },
      sequence: {
        type: "PositionalSequence",
        length: LENGTH,
        subUnitsPerUnit: SUB_UNITS_PER_UNIT,
        tracksByObject: {
          [OBJECT]: { trackIdByPropPath, trackData },
        },
      },
    },
  },
  revisionHistory: ["rev-astro-export"],
  definitionVersion: DEFINITION_VERSION,
};

const outIndex = process.argv.indexOf("--out");
const outPath = outIndex === -1 ? null : process.argv[outIndex + 1];

if (outPath == null) {
  console.error("usage: node scripts/astro-rig-export.mjs --out <path>");
  process.exit(1);
}

writeFileSync(outPath, `${JSON.stringify(exportState, null, 2)}\n`);
console.log(
  `wrote ${outPath}: sheet ${SHEET_ID}, ${OBJECT}.position.xyz, ${LENGTH}s, 5 keys per axis`,
);
