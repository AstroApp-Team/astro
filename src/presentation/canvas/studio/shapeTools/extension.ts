import type { IExtension, IStudio, ToolsetConfig } from "@theatre/studio";

import type { ShapeKind } from "@core/models/shapes.ts";
import { SHAPE_MENU } from "@core/models/shapes.ts";
import {
  aimCameraAt,
  aimCameraAtShapeId,
  resetCameraRotation,
} from "@presentation/canvas/studio/shapeTools/aimService.ts";
import ShapePalettePane, {
  mountShapePalettePane,
} from "@presentation/canvas/studio/shapeTools/ShapePalettePane.tsx";
import { openShapeMenu } from "@presentation/canvas/studio/shapeTools/shapeMenuController.tsx";
import {
  clearStudioSave,
  describeSave,
  saveStudioToDisk,
  STUDIO_SAVE_FILES,
} from "@presentation/canvas/studio/shapeTools/saveService.ts";
import { useShapeStore } from "@presentation/state/useShapeStore.ts";

/**
 * The Studio extension: "Add Shape", "Aim Camera" and "Save", in the global
 * toolbar.
 *
 * ── Ordering, the part that is easy to get wrong ────────────────────────────
 *
 * `studio.extend()` is called **before** `studio.initialize()`, from
 * `initTheatreStudio()` in `infrastructure/theatre/studioInit.ts`. The toolbar
 * component reads extensions out of the Studio's state atom through a prism, so
 * an extension registered after `initialize()` does eventually appear — after a
 * re-render of chrome that has already painted once without it. Register first,
 * initialize second, and the toolbar is there on the first paint.
 *
 * ── What the toolbar API is ─────────────────────────────────────────────────
 *
 * `IExtension.toolbars.global` is a subscription, not a component:
 *
 *   ```ts
 *   toolbars: { global: (set, studio) => { set(config); return unsubscribe } }
 *   ```
 *
 * The Studio calls it in a `useLayoutEffect` keyed on the extension object, and
 * the `set` it hands over is a bound `Atom.set`. So the toolset is data — an
 * array of `Icon` / `Switch` / `Flyout` configs — and it is refreshed by calling
 * `set` again. That is why the shape count in the flyout label is live: the
 * store subscription re-`set`s the config on every spawn.
 *
 * `ToolConfig` has exactly three shapes: `Icon` (`svgSource`, `title`,
 * `onClick`), `Switch` (a row of icons) and `Flyout` (`label` +
 * `{label, onClick}[]`). There is no "render this React component into the
 * toolbar" entry point, which is the whole reason the shape menu is a DOM
 * overlay in the light DOM rather than a React dropdown: the toolbar gives us a
 * click handler, and a click handler can open a portal host.
 *
 * ── Why the pane exists alongside the toolbar ───────────────────────────────
 *
 * `panes[].mount` is the one place the Studio hands over a DOM node it owns, so
 * that is where React is legitimate. The pane is the toolbar with memory: the
 * shape list, the camera key, the sheet, the Euler it wrote.
 */

export const SCENE_TOOLS_EXTENSION_ID = "astro.scene-tools";

/** The `PaneClassDefinition.class` for the palette. Keep it in sync with `createPane`. */
export const SHAPE_PANE_CLASS = "astro-shape-palette";

/**
 * The Studio instance, captured at registration.
 *
 * The toolbar callback receives it, `panes[].mount` does not, and the aim tools
 * need it for `transaction()` and `selection`. One module variable, set once,
 * before `initialize()`.
 */
let studioInstance: IStudio | null = null;

/** 1em inline glyphs; the Studio injects these with `dangerouslySetInnerHTML`. */
const ICONS = {
  addShape: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/><path d="M19 3v4M17 5h4"/></svg>`,
  aim: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>`,
  pane: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>`,
  save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M9 4v5h6V4"/><rect x="8" y="13" width="8" height="6"/></svg>`,
} as const;

function spawnShape(kind: ShapeKind): void {
  useShapeStore.getState().addShape(kind);
}

function runAim(studio: IStudio, targetKey: string | null): void {
  const outcome = aimCameraAt(studio, targetKey);
  if (!outcome.ok) useShapeStore.getState().setToolStatus(outcome.reason);
}

/**
 * Write the rig to disk.
 *
 * The toolbar's `onClick` is sync, so the outcome lands in the store when the
 * request settles — the same `toolStatus` line the pane and the flyout read, so a
 * save that failed names the field the dev server named.
 */
function runSave(studio: IStudio): void {
  const store = useShapeStore.getState();
  store.setToolStatus("Saving to disk…");

  void saveStudioToDisk(studio).then((outcome) => {
    const after = useShapeStore.getState();
    if (outcome.ok) after.setLastSavedAt(outcome.savedAt);
    after.setToolStatus(describeSave(outcome, "save"));
  });
}

/**
 * Empty the two files, and say that the screen has not changed.
 *
 * The store still holds this session's shapes — clearing the file is not clearing
 * the scene, and a readout that implied otherwise is how someone ends up
 * reloading mid-rig. Reload applies the empty file.
 */
function runClear(): void {
  const store = useShapeStore.getState();
  store.setToolStatus("Clearing the saved files…");

  void clearStudioSave().then((outcome) => {
    const after = useShapeStore.getState();
    if (outcome.ok) after.setLastSavedAt(null);
    after.setToolStatus(describeSave(outcome, "clear"));
  });
}

/**
 * The toolset, rebuilt from current store state.
 *
 * Rebuilding is cheap and it is what keeps the labels honest — `Flyout` items
 * are `{label, onClick}` snapshots, so a config built once says "Shapes (0)"
 * forever.
 */
function buildToolset(studio: IStudio): ToolsetConfig {
  const { shapes, sheetId, cameraKey } = useShapeStore.getState();
  // The toolbar acts on the active sheet: the labels count the shapes that
  // route renders, and "last" is the last spawn in that bucket.
  const activeShapes = shapes[sheetId] ?? [];
  const lastShape = activeShapes[activeShapes.length - 1] ?? null;

  return [
    {
      type: "Icon",
      title: "Add Shape — spawn an editable.mesh into the scene",
      svgSource: ICONS.addShape,
      onClick: () => {
        // `anchor: null` — the toolbar's own DOM is inside the Studio's shadow
        // root, so there is no rect of ours to hang the menu under. The menu
        // takes its deterministic top-centre slot below the toolbar instead.
        openShapeMenu({ anchor: null, onPick: spawnShape });
      },
    },
    {
      type: "Icon",
      title: `Aim "${cameraKey}" at the Studio selection`,
      svgSource: ICONS.aim,
      onClick: () => runAim(studio, null),
    },
    {
      type: "Icon",
      title: "Open the Scene Tools pane",
      svgSource: ICONS.pane,
      onClick: () => {
        studio.createPane(SHAPE_PANE_CLASS);
      },
    },
    {
      type: "Icon",
      title: `Save to disk — writes ${STUDIO_SAVE_FILES.state} and ${STUDIO_SAVE_FILES.shapes}`,
      svgSource: ICONS.save,
      onClick: () => runSave(studio),
    },
    {
      type: "Flyout",
      label: `Shapes (${activeShapes.length})`,
      items: [
        ...SHAPE_MENU.map((spec) => ({
          label: `Add ${spec.label}`,
          onClick: () => spawnShape(spec.kind),
        })),
        {
          label: "Aim camera at selection",
          onClick: () => runAim(studio, null),
        },
        {
          label:
            lastShape == null
              ? "Aim camera at last shape (none)"
              : `Aim camera at ${lastShape.theatreKey}`,
          onClick: () => {
            if (lastShape == null) {
              useShapeStore.getState().setToolStatus("No spawned shape to aim at.");
              return;
            }
            const outcome = aimCameraAtShapeId(studio, lastShape.id);
            if (!outcome.ok) useShapeStore.getState().setToolStatus(outcome.reason);
          },
        },
        {
          label: "Reset camera rotation",
          onClick: () => {
            const outcome = resetCameraRotation(studio);
            if (!outcome.ok) useShapeStore.getState().setToolStatus(outcome.reason);
          },
        },
        {
          label: `Clear ${activeShapes.length} spawned shape${activeShapes.length === 1 ? "" : "s"}`,
          onClick: () => useShapeStore.getState().clearShapes(),
        },
        {
          label: lastShape == null ? "Remove last shape (none)" : `Remove ${lastShape.theatreKey}`,
          onClick: () => useShapeStore.getState().removeLastShape(),
        },
        {
          label: "Save to disk",
          onClick: () => runSave(studio),
        },
        {
          label: "Reload page (apply the saved files)",
          onClick: () => {
            window.location.reload();
          },
        },
        {
          label: "Clear saved files",
          onClick: () => runClear(),
        },
      ],
    },
  ];
}

function buildExtension(): IExtension {
  const studio = studioInstance;

  return {
    id: SCENE_TOOLS_EXTENSION_ID,
    toolbars: {
      global: (set, studioFromStudio) => {
        set(buildToolset(studioFromStudio));

        // The toolset is data, so it has to be re-set when the data changes.
        // Without this the flyout label freezes at the count from mount.
        return useShapeStore.subscribe(() => {
          set(buildToolset(studioFromStudio));
        });
      },
    },
    panes: [
      {
        class: SHAPE_PANE_CLASS,
        mount: ({ paneId, node }) => {
          if (studio == null) {
            node.textContent = "Scene Tools: the Studio instance was never captured.";
            return () => {
              node.replaceChildren();
            };
          }
          return mountShapePalettePane(node, studio, paneId);
        },
      },
    ],
  };
}

/**
 * Register the extension. Call this **before** `studio.initialize()`.
 *
 * Re-running it (HMR) re-registers with `__experimental_reconfigure`, which is
 * the documented way to swap an extension's definition in place. Without it the
 * Studio keeps the first definition for the life of the page, and a pane class
 * that no longer exists leaves its instances on screen.
 */
export function registerSceneToolsExtension(studio: IStudio): void {
  const isReconfigure = studioInstance !== null;
  studioInstance = studio;

  studio.extend(buildExtension(), isReconfigure ? { __experimental_reconfigure: true } : {});
}

/** The pane component, exported so the app can render it outside the Studio too. */
export { ShapePalettePane };
