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
 */

import portfolioProjectState from "./portfolio-project.state.json";

export const PROJECT_ID = "PortfolioProject";

/** Project id → the state object as exported by the Studio. */
export const projectStates: Record<string, unknown> = {
  [PROJECT_ID]: portfolioProjectState,
};
