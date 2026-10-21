import type { ComponentType } from "react";

import type { SceneId } from "@core/models/scene.ts";
import ArchiveScene from "@presentation/canvas/scenes/ArchiveScene.tsx";
import CareerJourneyScene from "@presentation/canvas/scenes/CareerJourneyScene.tsx";
import HubScene from "@presentation/canvas/scenes/HubScene.tsx";
import InfraMapScene from "@presentation/canvas/scenes/InfraMapScene.tsx";
import StudioSandboxScene from "@presentation/canvas/studio/StudioSandboxScene.tsx";

/**
 * Scene id → component.
 *
 * A plain record, not a lazy import map: these are a handful of small scenes and
 * the app is a mobile app whose first paint matters more than a few hundred
 * kilobytes split across a route. `MainCanvas` reads this table, so adding a
 * scene is one entry here and one file — no change to the canvas.
 */
export const SCENE_COMPONENTS: Record<SceneId, ComponentType> = {
  hub: HubScene,
  "infra-map": InfraMapScene,
  "career-journey": CareerJourneyScene,
  archive: ArchiveScene,
  "studio-sandbox": StudioSandboxScene,
};
