import { create } from "zustand";

import type { SceneEvent, SceneEventName, SceneId, Vec3 } from "@core/models/scene.ts";

/**
 * The bridge between the 2D DOM and the 3D canvas.
 *
 * This store is the *only* channel between them. An HTML button does not reach
 * into a mesh, and a mesh does not render into a toolbar: both sides read and
 * write this state, which is what keeps `presentation/ui` and `presentation/canvas`
 * independently testable and lets the Studio Corner verify a click on a prefab by
 * reading the same field the toolbar displays.
 *
 * Subscribing with a selector (`useSceneStore((s) => s.selectedNodeId)`) is the
 * pattern to use in components — a bare `useSceneStore()` re-renders on every
 * field, including the camera target the canvas writes 60 times a second.
 */
export type SceneStore = {
  activeScene: SceneId;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  cameraTarget: Vec3;
  /**
   * Bumped whenever the scene changes. R3F keeps GL objects in refs, not state,
   * so a scene that must rebuild its Theatre.js bindings needs a key to remount
   * on — this is that key.
   */
  epoch: number;
  lastEvent: SceneEvent | null;

  setActiveScene(scene: SceneId): void;
  selectNode(nodeId: string | null): void;
  hoverNode(nodeId: string | null): void;
  focusCamera(target: Vec3): void;
  /** Records something happened. The canvas and the UI both call this. */
  emit(name: SceneEventName, nodeId: string | null): void;
};

export const useSceneStore = create<SceneStore>((set) => ({
  activeScene: "hub",
  selectedNodeId: null,
  hoveredNodeId: null,
  cameraTarget: [0, 5, 10],
  epoch: 0,
  lastEvent: null,

  setActiveScene(scene) {
    set((state) => ({
      activeScene: scene,
      selectedNodeId: null,
      hoveredNodeId: null,
      epoch: state.epoch + 1,
      lastEvent: { name: "scene-changed", at: Date.now(), nodeId: scene },
    }));
  },

  selectNode(nodeId) {
    set({
      selectedNodeId: nodeId,
      lastEvent: {
        name: nodeId == null ? "node-deselected" : "node-selected",
        at: Date.now(),
        nodeId,
      },
    });
  },

  hoverNode(nodeId) {
    set({ hoveredNodeId: nodeId });
  },

  focusCamera(target) {
    set({ cameraTarget: target });
  },

  emit(name, nodeId) {
    set({ lastEvent: { name, at: Date.now(), nodeId } });
  },
}));
