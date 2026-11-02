import { z } from "zod";

/**
 * The contract between the Studio's Save button and the dev server that writes
 * it to disk.
 *
 * Three sides read this file, which is why it lives in `shared/`:
 *
 *   - the browser (`presentation/canvas/studio/shapeTools/saveService.ts`) builds
 *     the payload out of `studio.createContentOfSaveFile()` and the shape store;
 *   - the Vite plugin (`scripts/studio-save-plugin.ts`) parses it before it
 *     touches the filesystem — the middleware is the trust boundary, so the
 *     validation runs there and not in the caller;
 *   - the app reads the two files back at module scope (`infrastructure/theatre/
 *     states/index.ts`), because `getProject()` accepts state only at
 *     construction, and a construction-time read cannot be awaited.
 *
 * The payload is deliberately two objects, not one: `state` is Theatre's own
 * on-disk format, byte-for-byte what `createContentOfSaveFile()` returns, and
 * `shapes` is ours. Splicing our keys into Theatre's object would make the file
 * something Theatre has to tolerate, and a parser that tolerates unknown keys
 * today is a parser that rejects them in the next release.
 */

/** Dev-server endpoints. `apply: "serve"` — in a build, none of these exist. */
export const STUDIO_SAVE_ENDPOINT = "/__astro-studio/save";
export const STUDIO_LOAD_ENDPOINT = "/__astro-studio/state";
export const STUDIO_CLEAR_ENDPOINT = "/__astro-studio/clear";

/**
 * Header every studio-save request must carry.
 *
 * The dev server is reachable over the LAN — the phone is a supported client — so
 * "is the request from the machine running the server?" is not a usable answer.
 * This is the guard that replaces it. A cross-origin page can only send a handful
 * of headers on a `fetch` without a CORS preflight, and a custom header is not one
 * of them: the browser preflights, the dev server does not answer the preflight,
 * and the write never happens. The app itself is same-origin, so sending it costs
 * nothing.
 *
 * It is a drive-by-write guard, not an access-control list. Anyone who can load
 * the app in a browser on that dev server can write these two files — which is
 * exactly what a dev server is for.
 */
export const STUDIO_SAVE_HEADER = "x-astro-studio-save";

/** The header's value. A name is not enough; the middleware compares this. */
export const STUDIO_SAVE_HEADER_VALUE = "1";

/**
 * Ceiling on the serialized payload.
 *
 * A rigged sheet is tens of KB; a project with a few hundred keyframed tracks is
 * low single-digit MB. This is the number that turns "the browser sent me
 * something enormous" into a 413 instead of a stalled dev server.
 */
export const MAX_STUDIO_SAVE_BYTES = 8 * 1024 * 1024;

/** Must match `currentProjectStateDefinitionVersion` in the installed @theatre/core. */
export const THEATRE_STATE_DEFINITION_VERSION = "0.4.0";

/**
 * Shape kinds, spelled out here rather than imported from `core/models/shapes.ts`.
 *
 * `shared/` sits below `src/` in the import graph — `core/` imports `shared/`,
 * and a `shared/` that imports back into `core/` is a cycle the bundler will
 * happily build and the layering rule will not survive. The drift is covered by
 * a test (`shared/studio-save.test.ts`) that fails the moment the two lists
 * disagree, which is the same trade the aliases make in `vite.config.ts`.
 */
export const SAVED_SHAPE_KINDS = ["cube", "sphere", "flat-square", "flat-circle"] as const;

/**
 * The tuple shape `core/models/scene.ts` calls `Vec3`.
 *
 * Spelled out here rather than imported, for the same reason the kinds above are:
 * `shared/` sits under `src/` in the import graph. Exported because the save
 * service builds these and the schema reads them back.
 */
export type SavedVec3 = [number, number, number];

const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** One spawned shape, as it was in `useShapeStore` at the moment of the save. */
export const SavedShapeSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(SAVED_SHAPE_KINDS),
  /** The outliner key. Theatre rejects anything shorter than four characters. */
  theatreKey: z.string().min(4).max(120),
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema,
});

/**
 * The shape half of the save file.
 *
 * `ordinal` is not cosmetic: `useShapeStore` hands out `<Kind>-<ordinal>` keys
 * from a module-scope counter, and a reload that restarts that counter at zero
 * hands out `Cube-0` a second time. Theatre then binds two meshes to the same
 * props, the same outliner row and the same keyframes — the shapes overlap and
 * animating one animates both. Saving the counter is what keeps a reload a
 * continuation instead of a fresh start. The ordinal is **global, not per
 * sheet**: restarting it per sheet would reissue a live `theatreKey` the moment
 * a second sheet spawns, and the two sheets' meshes would bind to one set of
 * props.
 *
 * `shapesBySheet` is the partition that keeps a shape spawned in one scene from
 * rendering in every scene: `<SpawnedShapes />` renders only the bucket matching
 * the `SheetProvider` it is mounted in, so a cube in `SurfaceScene` is invisible
 * on `/float`. A bucket whose key is not a sheet this app mounts is inert — it
 * round-trips through Save untouched, and nothing renders it.
 *
 * `sheetId` and `cameraKey` are the tools' context, so a reload lands on the
 * sheet and camera the rig was being edited against.
 */
export const SavedShapesSchema = z.object({
  ordinal: z.number().int().min(0).max(100_000),
  sheetId: z.string().min(4).max(60),
  cameraKey: z.string().min(1).max(60),
  shapesBySheet: z.record(z.string().min(4).max(60), z.array(SavedShapeSchema).max(200)),
});

/**
 * Theatre's own project state, checked at the edges that matter.
 *
 * `.loose()` on purpose: `revisionHistory` and whatever the next @theatre/core
 * adds must pass through untouched. The two keys the app reads are
 * `definitionVersion` (a mismatch means the file came from a different core, and
 * loading it is silent garbage) and `sheetsById`.
 */
export const TheatreStateSchema = z
  .object({
    definitionVersion: z.string().min(1).max(20),
    sheetsById: z.record(z.string(), z.unknown()),
  })
  .loose();

/** What `POST /__astro-studio/save` must carry. */
export const StudioSavePayloadSchema = z.object({
  state: TheatreStateSchema,
  shapes: SavedShapesSchema,
});

export type SavedShape = z.infer<typeof SavedShapeSchema>;
export type SavedShapes = z.infer<typeof SavedShapesSchema>;
export type TheatreState = z.infer<typeof TheatreStateSchema>;
export type StudioSavePayload = z.infer<typeof StudioSavePayloadSchema>;

/** The empty file a checkout ships, and what "Clear" writes back. */
export const SHAPES_FILE_HINT =
  "Written by the Studio's Save button (dev only). Hand-edit it and reload the page: `shapesBySheet` maps a sheet id (e.g. SurfaceScene) to the shapes that scene renders, `ordinal` is the next spawn number (one global counter, shared by every sheet), `sheetId` and `cameraKey` are the tools' context. A shape needs id, kind (cube | sphere | flat-square | flat-circle), theatreKey (4+ chars, unique in the sheet), and position/rotation/scale as [x,y,z] — rotation in radians. A file in the old single-`entries` layout is migrated automatically on load: everything lands in its `sheetId` bucket. Unknown keys are dropped; a malformed entry fails the whole load, and the dev server answers 400 naming the field.";

export function emptyTheatreState(): TheatreState {
  return {
    definitionVersion: THEATRE_STATE_DEFINITION_VERSION,
    sheetsById: {},
    revisionHistory: [],
  };
}

export function emptySavedShapes(sheetId = "StudioSandbox", cameraKey = "Camera"): SavedShapes {
  return { ordinal: 0, sheetId, cameraKey, shapesBySheet: {} };
}

/** Total shapes across every sheet — the count the save readout prints. */
export function countSavedShapes(shapes: SavedShapes): number {
  return Object.values(shapes.shapesBySheet).reduce((total, entries) => total + entries.length, 0);
}

/**
 * Merge the dev-only local save over the canonical exported state, per sheet.
 *
 * Per sheet, not wholesale: a rig imported with `pnpm run theatre:state -- import
 * … --to StingScene` has to stay visible when the local save only carries
 * `StudioSandbox`, and a locally-saved sheet has to win over the canonical
 * version of the same sheet. Wholesale replacement gets one of those right and
 * silently loses the other.
 *
 * `local === null` is the production shape — the caller folds the branch away at
 * build time, so a shipped bundle carries the canonical file and nothing else.
 */
export function mergeProjectState(
  canonical: Record<string, unknown>,
  local: TheatreState | null,
): Record<string, unknown> {
  const canonicalSheets = (canonical["sheetsById"] as Record<string, unknown> | undefined) ?? {};
  if (local == null) return canonical;

  const localSheets = local.sheetsById;
  const localIds = Object.keys(localSheets);
  if (localIds.length === 0) return canonical;

  return {
    ...canonical,
    sheetsById: { ...canonicalSheets, ...localSheets },
    revisionHistory: local["revisionHistory"] ?? canonical["revisionHistory"] ?? [],
  };
}

/** The empty payload the pane shows before the first save. */
export function isSavedShapes(value: unknown): value is SavedShapes {
  return SavedShapesSchema.safeParse(value).success;
}
