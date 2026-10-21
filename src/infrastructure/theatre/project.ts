import { getProject, type IProject, type ISheet } from "@theatre/core";

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
  studioSandbox: "StudioSandbox",
} as const;

export type SheetId = (typeof SHEET_IDS)[keyof typeof SHEET_IDS];

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
