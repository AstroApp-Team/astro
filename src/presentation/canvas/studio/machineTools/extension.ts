/**
 * The Studio extension for the state machine: one toolbar icon, one pane, one flyout.
 *
 * It mirrors `shapeTools/extension.ts`, including the two rules that file learned the hard
 * way: `studio.extend()` runs **before** `studio.initialize()` (a late `extend` lands one
 * toolbar paint late), and the toolset is *data* — `toolbars.global` hands over a `set`, so
 * anything that changes (the clip list) has to `set` again rather than re-render.
 *
 * The pane does the work; the toolbar is the way in. That split is why the flyout items and
 * the pane's buttons call the same store-free helpers: there is no state to keep in two
 * places, because both read the project state at module load.
 */

import type { IExtension, IStudio, ToolConfig } from "@theatre/studio";

import { withClipLayer } from "@core/usecases/animationStateMachine/authoring.ts";
import { listTheatreClips } from "@infra/theatre/animationStateMachine/theatreAssetResolver.ts";
import { mountMachinePane } from "@presentation/canvas/studio/machineTools/MachinePane.tsx";
import {
  loadMachineDefinition,
  writeDefinitionOverride,
} from "@presentation/canvas/machine/machineAuthoring.ts";

export const MACHINE_TOOLS_EXTENSION_ID = "astro.machine-tools";

/** The `PaneClassDefinition.class` for the pane. Keep it in sync with `MACHINE_PANE_CLASS`. */
export const MACHINE_PANE_CLASS = "astro-machine-pane";

let studioInstance: IStudio | null = null;

const ICONS = {
  machine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="7" r="2.4"/><circle cx="18" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M8.4 7h7.2M7 9.2l3.6 5.6M17 9.2l-3.6 5.6"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5l11 7-11 7z"/></svg>`,
} as const;

/**
 * Add (or replace) the layer that plays `clipId`.
 *
 * Adding twice is the same write, not two layers: `withClipLayer` keys on the layer id, so
 * the flyout item is idempotent and the toolbar does not need to know which case it is in.
 * The pane is where the result is legible — the toolbar has no toast surface.
 */
function addClipLayer(clipId: string): void {
  writeDefinitionOverride(withClipLayer(loadMachineDefinition(), { clipId }));
}

function buildToolset(): ToolConfig[] {
  const clips = listTheatreClips();
  return [
    {
      type: "Icon",
      title: "Open the Machine pane (Theatre timelines as layers)",
      svgSource: ICONS.machine,
      onClick: () => {
        studioInstance?.createPane(MACHINE_PANE_CLASS);
      },
    },
    {
      type: "Icon",
      title: "Open /machine with the current definition",
      svgSource: ICONS.play,
      onClick: () => {
        window.open("/machine", "_blank", "noopener");
      },
    },
    {
      type: "Flyout",
      label: `Machine (${clips.length})`,
      items:
        clips.length === 0
          ? [{ label: "No clips in the project state", onClick: () => {} }]
          : clips.map((clip) => ({
              label: `Add ${clip.id} as a layer`,
              onClick: () => {
                addClipLayer(clip.id);
              },
            })),
    },
  ];
}

function buildExtension(): IExtension {
  return {
    id: MACHINE_TOOLS_EXTENSION_ID,
    toolbars: {
      global: (set) => {
        set(buildToolset());
        /* Static for the life of the page: the clip list is module state read from the
           exported project state, which a Save replaces only on reload. */
        return () => {};
      },
    },
    panes: [
      {
        class: MACHINE_PANE_CLASS,
        mount: ({ node }) => {
          if (studioInstance == null) {
            node.textContent = "Machine: the Studio instance was never captured.";
            return () => {
              node.replaceChildren();
            };
          }
          return mountMachinePane(node);
        },
      },
    ],
  };
}

/** Register before `studio.initialize()`; re-registers in place under HMR. */
export function registerMachineToolsExtension(studio: IStudio): void {
  const isReconfigure = studioInstance !== null;
  studioInstance = studio;
  studio.extend(buildExtension(), isReconfigure ? { __experimental_reconfigure: true } : {});
}
