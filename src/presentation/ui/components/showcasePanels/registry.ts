import type { ComponentType } from "react";

import type { ShowcasePanelProps } from "./types.ts";
import ArchivePanel from "./ArchivePanel.tsx";
import InfraPanel from "./InfraPanel.tsx";
import JourneyPanel from "./JourneyPanel.tsx";
import VoicePanel from "./VoicePanel.tsx";

/**
 * What a showcase panel is made of.
 *
 * `title` is the cube's own label — the text the drei `<Html>` card paints on top
 * of that cube in the scene. It is not a second name invented for the panel: the
 * card the user taps and the panel that opens say the same word, and
 * `registry.test.ts` fails if the two ever drift from `STING_NODES`.
 */
export type ShowcasePanelEntry = {
  title: string;
  Panel: ComponentType<ShowcasePanelProps>;
};

/**
 * Cube → panel, keyed by `theatreKey`.
 *
 * The keys are the four satellites. `Sting-Core` is deliberately absent: the core
 * is the thing the ring is arranged around, and a panel for it would mean a tap
 * anywhere near the middle of the frame opens a sheet over the scene.
 *
 * Keyed on `theatreKey` and not on the label because the key is the identity the
 * raycast writes into `useSceneStore` — the same string the Studio's outliner
 * shows, the same string `SpawnedShapeMesh` uses. Matching on the label would put
 * a second, human-editable identity in the middle of a lookup that already has a
 * stable one.
 */
export const SHOWCASE_PANELS: Record<string, ShowcasePanelEntry> = {
  "Sting-Sat-1": { title: "Voice", Panel: VoicePanel },
  "Sting-Sat-2": { title: "Archive", Panel: ArchivePanel },
  "Sting-Sat-3": { title: "Infra", Panel: InfraPanel },
  "Sting-Sat-4": { title: "Journey", Panel: JourneyPanel },
};

/**
 * The panel a raycast hit opens, or null.
 *
 * Null is the common case, not the error case: the core, the spawned sphere and
 * any shape the Studio adds all hit here, and the page opens nothing for them.
 */
export function showcasePanelFor(nodeId: string | null): ShowcasePanelEntry | null {
  if (nodeId == null) return null;
  return SHOWCASE_PANELS[nodeId] ?? null;
}
