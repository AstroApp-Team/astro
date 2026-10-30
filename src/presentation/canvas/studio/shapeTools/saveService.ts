import type { IStudio } from "@theatre/studio";

import { PROJECT_ID, LOCAL_SHAPES_FILE, LOCAL_STATE_FILE } from "@infra/theatre/states/index.ts";
import {
  STUDIO_CLEAR_ENDPOINT,
  STUDIO_SAVE_ENDPOINT,
  STUDIO_SAVE_HEADER,
  STUDIO_SAVE_HEADER_VALUE,
  StudioSavePayloadSchema,
  type SavedShapes,
  type StudioSavePayload,
} from "@shared/studio-save.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

/**
 * The Save button's side of the dev-server contract.
 *
 * ── What gets written ───────────────────────────────────────────────────────
 *
 * Two files, one request. `state` is `studio.createContentOfSaveFile()` verbatim
 * — Theatre's own on-disk format, every sheet in the project, keyframes included.
 * `shapes` is the spawn list out of `useShapeStore`, because the *existence* of a
 * spawned shape is app state, not Theatre state: Theatre holds the tracks for
 * `Cube-0`, and nothing in Theatre says `Cube-0` should be mounted at all. Save
 * one without the other and a reload gives you a mesh with keyframes and no mesh,
 * or a mesh with no keyframes.
 *
 * ── Why the write is a POST and the read is an import ───────────────────────
 *
 * Reading has to be synchronous: `getProject()` takes state at construction, at
 * module scope, and a promise is not a value you can hand it. So the app *imports*
 * the two files (`infrastructure/theatre/states/index.ts`) and only *writes* over
 * HTTP. The dev server is the writer; see `scripts/studio-save-plugin.ts`.
 *
 * ── Why Theatre's own autosave is off ───────────────────────────────────────
 *
 * `studio.initialize()` persists to `localStorage` by default and restores it on
 * the next load, after `getProject()` has already read the file. Left on, a
 * hand-edit of `astro.local.state.json` is overwritten by the browser's snapshot
 * the moment the page reloads — the file would look like it did nothing.
 * `studioInit.ts` passes `usePersistentStorage: false`, so the file is the only
 * persistence and Save is the thing that persists.
 */

export type SaveOutcome =
  | { ok: true; savedAt: string | null; sheets: number; shapes: number }
  | { ok: false; reason: string };

/** False in a production build: the endpoints are `apply: "serve"` only. */
export const isStudioSaveAvailable: boolean = import.meta.env.DEV;

/** Where the files live, for the pane's readout. */
export const STUDIO_SAVE_FILES = { state: LOCAL_STATE_FILE, shapes: LOCAL_SHAPES_FILE };

/**
 * The one wording for what a save did.
 *
 * The toolbar flyout, the pane and the toolbar status line all report the same
 * outcome, and three phrasings of it is three places where a failure can read
 * differently. The clear branch says the shapes are still on screen because
 * clearing a file is not clearing a scene, and a readout that blurs the two is how
 * someone reloads mid-rig.
 */
export function describeSave(outcome: SaveOutcome, action: "save" | "clear" = "save"): string {
  if (!outcome.ok) return `${action === "save" ? "Save" : "Clear"} failed: ${outcome.reason}`;

  if (action === "clear") {
    return "Cleared both files. The shapes on screen are still here — reload to apply the empty file.";
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `Saved ${plural(outcome.sheets, "sheet")} and ${plural(outcome.shapes, "shape")}. Reload to apply.`;
}

function shapesPayload(): SavedShapes {
  const { shapes, sheetId, cameraKey } = useShapeStore.getState();
  return {
    // The counter is module-scope state in the store, not a field of it.
    ordinal: useShapeStore.getState().spawnOrdinal(),
    sheetId,
    cameraKey,
    entries: shapes.map((shape) => ({
      id: shape.id,
      kind: shape.kind,
      theatreKey: shape.theatreKey,
      position: shape.position,
      rotation: shape.rotation,
      scale: shape.scale,
    })),
  };
}

/**
 * One POST to the dev-server middleware, and an outcome in the words the pane
 * prints. A non-2xx is turned into the server's own message plus its field list,
 * because "400" is not actionable and "shapes.entries.0.kind: invalid enum value"
 * is.
 */
async function post(endpoint: string, body?: unknown): Promise<SaveOutcome> {
  if (!isStudioSaveAvailable) {
    return { ok: false, reason: "Saving is a dev-server feature; this build has no dev server." };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      // The save header on every call, body or not. Same-origin, so it costs no
      // preflight, and it is the only thing standing between "the app can write
      // these files" and "any webpage on any machine can write these files".
      headers:
        body === undefined
          ? { [STUDIO_SAVE_HEADER]: STUDIO_SAVE_HEADER_VALUE }
          : {
              [STUDIO_SAVE_HEADER]: STUDIO_SAVE_HEADER_VALUE,
              "Content-Type": "application/json",
            },
      body: body === undefined ? null : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      savedAt?: string | null;
      sheets?: number;
      shapes?: number;
      error?: string;
      issues?: string[];
    } | null;

    if (!res.ok) {
      const issues = data?.issues;
      return {
        ok: false,
        reason: `${data?.error ?? `dev server answered ${res.status}`}${issues?.length ? ` — ${issues.join("; ")}` : ""}`,
      };
    }

    return {
      ok: true,
      savedAt: data?.savedAt ?? null,
      sheets: data?.sheets ?? 0,
      shapes: data?.shapes ?? 0,
    };
  } catch (cause) {
    return { ok: false, reason: `dev server unreachable: ${(cause as Error).message}` };
  }
}

/**
 * Snapshot the Studio and the shape store, and write both to disk.
 *
 * Validation runs here as well as on the server: `createContentOfSaveFile()` is
 * typed `Record<string, unknown>`, and catching a shape mismatch before the
 * request turns a 400 into a message naming the field.
 */
export async function saveStudioToDisk(studio: IStudio): Promise<SaveOutcome> {
  const payload: StudioSavePayload = {
    state: studio.createContentOfSaveFile(PROJECT_ID) as StudioSavePayload["state"],
    shapes: shapesPayload(),
  };

  const parsed = StudioSavePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `refusing to write: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    };
  }

  return await post(STUDIO_SAVE_ENDPOINT, payload);
}

/** Empty both files — the shapes go with the rig, on purpose. */
export async function clearStudioSave(): Promise<SaveOutcome> {
  return await post(STUDIO_CLEAR_ENDPOINT);
}
