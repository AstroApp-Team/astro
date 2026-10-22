import { getProject, type IProject, type ISheet } from "@theatre/core";

import type { SceneId } from "@core/models/scene.ts";
import { PROJECT_ID, projectStates } from "@infra/theatre/states/index.ts";

/**
 * The root Theatre.js project, created once.
 *
 * `getProject` is a registry lookup keyed by id: calling it twice with the same
 * id returns the same project, so a module-level singleton is not strictly
 * required — but a *sheet* is created per call site, and a scene that calls
 * `project.sheet()` during render would build a new sheet object on every
 * render. Sheets are therefore created here, at module scope, and handed out by
 * `getSheet()`.
 *
 * The exported state (see `states/index.ts`) is passed in at creation, because
 * `getProject` only accepts it once — the project reads its state as it is
 * constructed.
 */
export const portfolioProject: IProject = getProject(
  PROJECT_ID,
  projectStates[PROJECT_ID] != null ? { state: projectStates[PROJECT_ID] } : undefined,
);

/**
 * Sheet ids, one per scene. Theatre requires an id longer than three characters,
 * which is why these are words and not `hub` / `map`.
 */
export const SHEET_IDS = {
  hub: "HubScene",
  infraMap: "InfraMapScene",
  careerJourney: "CareerJourneyScene",
  archive: "ArchiveScene",
  sting: "StingScene",
  studioSandbox: "StudioSandbox",
} as const;

export type SheetId = (typeof SHEET_IDS)[keyof typeof SHEET_IDS];

/**
 * Scene id → the sheet that scene mounts.
 *
 * A `Record` keyed by `SceneId`, not a partial map: adding a scene to
 * `SCENE_IDS` without adding it here is a compile error, which is the good
 * failure mode. The alternative is a scene that mounts a sheet nobody rigs,
 * which is silent — it plays at its initial values forever.
 *
 * This is also the table the Studio workflow reads: the string on the right is
 * the key the exported state has to land on (`pnpm run theatre:state -- import
 * <export> --to <that string>`).
 */
export const SCENE_SHEET_IDS: Record<SceneId, SheetId> = {
  hub: SHEET_IDS.hub,
  "infra-map": SHEET_IDS.infraMap,
  "career-journey": SHEET_IDS.careerJourney,
  archive: SHEET_IDS.archive,
  sting: SHEET_IDS.sting,
  "studio-sandbox": SHEET_IDS.studioSandbox,
};

const sheets = new Map<string, ISheet>();

/** The sheet for a scene, created on first use and cached after that. */
export function getSheet(id: SheetId): ISheet {
  const cached = sheets.get(id);
  if (cached != null) return cached;

  const created = portfolioProject.sheet(id);
  sheets.set(id, created);
  return created;
}

/** The Studio Corner's own sheet — the sandbox rig animates against this. */
export const studioSheet: ISheet = getSheet(SHEET_IDS.studioSandbox);
