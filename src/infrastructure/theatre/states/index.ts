/**
 * Exported Theatre.js project state.
 *
 * The Studio exports a project's animation state as JSON keyed by **sheet id**.
 * Production reads a sheet by the string in `SHEET_IDS`, so the export has to be
 * renamed onto that id before anything plays — `src/infrastructure/theatre/
 * states/portfolio-project.state.json` is the single canonical file that holds
 * every rigged sheet, merged, and `pnpm run theatre:state -- import <export>
 * --to <SheetId>` does the rename and the merge.
 *
 * Empty by default: a project with no state plays its props at their initial
 * values, which is exactly what a scene that has not been rigged in the Studio
 * yet should do.
 *
 * The whole file is imported as one state object because `getProject` takes
 * state once, at construction, and it is keyed by project id — not per sheet.
 * Rigging a second scene means adding a sheet to this file, not a new entry
 * here.
 *
 * ── The second file: the Studio's Save button ───────────────────────────────
 *
 * `astro.local.state.json` and `astro.local.shapes.json` are what the Scene Tools
 * pane writes with its Save button (dev only — see `scripts/studio-save-plugin.ts`
 * and `presentation/canvas/studio/shapeTools/saveService.ts`). They exist because
 * the canonical file is a *landed* rig: importing from it is a CLI step and a
 * commit, and a rig being edited all afternoon needs a save that is neither.
 *
 * They are merged **per sheet**, so a locally-saved `StudioSandbox` cannot shadow
 * a `StingScene` landed from the CLI, and the local copy of a sheet wins over the
 * canonical copy of that same sheet. Both are imported at module scope because
 * `getProject` accepts state only at construction, and a construction-time read
 * cannot be awaited.
 *
 * The `import.meta.env.DEV` guard is what keeps them out of the app: in a
 * production build the local state is `null`, the merge returns the canonical
 * file untouched, and the shape seed is empty.
 */

import portfolioProjectState from "./portfolio-project.state.json";
import astroLocalShapes from "./astro.local.shapes.json";
import astroLocalState from "./astro.local.state.json";

import {
  SavedShapesSchema,
  TheatreStateSchema,
  emptySavedShapes,
  mergeProjectState,
  THEATRE_STATE_DEFINITION_VERSION,
  type SavedShapes,
  type TheatreState,
} from "@shared/studio-save.ts";

export const PROJECT_ID = "PortfolioProject";

/** Paths, printed by the Scene Tools pane so a save says where it went. */
export const LOCAL_STATE_FILE = "src/infrastructure/theatre/states/astro.local.state.json";
export const LOCAL_SHAPES_FILE = "src/infrastructure/theatre/states/astro.local.shapes.json";

/**
 * The dev-only local save, validated.
 *
 * A file the human edits by hand is a file that will be edited by hand, so a
 * mismatch is a console warning naming the version and the app continues from the
 * canonical state — the alternative is a page that renders nothing and says
 * nothing, which is how Theatre already treats a sheet id that is not in
 * `sheetsById`.
 */
function parseLocalState(raw: unknown): TheatreState | null {
  const parsed = TheatreStateSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[studio-save] ${LOCAL_STATE_FILE} is not readable as project state:`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
    return null;
  }
  if (parsed.data.definitionVersion !== THEATRE_STATE_DEFINITION_VERSION) {
    console.warn(
      `[studio-save] ${LOCAL_STATE_FILE} has definitionVersion ${parsed.data.definitionVersion}, ` +
        `this @theatre/core reads ${THEATRE_STATE_DEFINITION_VERSION}. Ignoring it; the rig ` +
        `would load at its initial values with no error at all.`,
    );
    return null;
  }
  return parsed.data;
}

const localState: TheatreState | null = import.meta.env.DEV
  ? parseLocalState(astroLocalState)
  : null;

/** Project id → the state object as exported by the Studio. */
export const projectStates: Record<string, unknown> = {
  [PROJECT_ID]: mergeProjectState(portfolioProjectState, localState),
};

/**
 * The shapes the last Save spawned, for `useShapeStore` to start from.
 *
 * Empty in production, and empty when the file is unparseable — with a warning,
 * because "my shapes vanished" is exactly the silent failure this file exists to
 * prevent.
 */
/**
 * Old files carried one flat `entries` list, which every scene rendered. A file
 * in that layout is migrated on load: everything lands in the file's `sheetId`
 * bucket, which is where the shapes were being worked on (the tools' context).
 * A hand-edit that half-migrates a file keeps whichever shape parses first —
 * `shapesBySheet` wins, because it is the newer layout.
 */
export function migrateLegacyShapes(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;

  const value = raw as Record<string, unknown>;
  if (value["shapesBySheet"] != null) return value;
  if (!Array.isArray(value["entries"])) return value;

  const sheetId = typeof value["sheetId"] === "string" ? value["sheetId"] : "StudioSandbox";
  return { ...value, shapesBySheet: { [sheetId]: value["entries"] } };
}

export function readLocalShapesSeed(): SavedShapes {
  if (!import.meta.env.DEV) return emptySavedShapes();

  const parsed = SavedShapesSchema.safeParse(migrateLegacyShapes(astroLocalShapes));
  if (!parsed.success) {
    console.warn(
      `[studio-save] ${LOCAL_SHAPES_FILE} is not readable as saved shapes:`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
    return emptySavedShapes();
  }
  return parsed.data;
}
