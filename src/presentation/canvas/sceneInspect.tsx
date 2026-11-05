/**
 * The bridge between the studio's DOM panels and the live scene graph.
 *
 * Mounted inside `<Canvas>` next to the route's scene, so it is present on every page and outlives
 * scene remounts (it is not keyed). Three jobs:
 *
 * 1. Publish the root so the Shader panel can enumerate what is actually on screen. Theatre builds
 *    the object tree after the first commit, hence the deferred `refresh()`.
 * 2. Apply material overrides. Keyed by object **name**, not uuid: a uuid is per-instance, so a
 *    scene remount (which is every route change) would orphan every override. `name` is what the
 *    sheet and the outliner already use.
 * 3. Render imported glTF models. They are not Theatre objects — the sheet is compile-time — so
 *    they live in the store instead and are mounted here for every scene.
 */

import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import type * as THREE from "three";

import { materialFor } from "@presentation/canvas/materialRegistry.ts";
import { useInspectStore } from "@presentation/state/useInspectStore.ts";

/** uuid → the material a mesh was wearing before the first override, so `—` can restore it. */
const originals = new Map<string, THREE.Material | THREE.Material[]>();

export function SceneIntrospection() {
  const scene = useThree((state) => state.scene);
  const overrides = useInspectStore((state) => state.overrides);
  const rev = useInspectStore((state) => state.rev);

  useEffect(() => {
    useInspectStore.getState().setRoot(scene);
    /* Theatre's editable nodes are created in a commit after this effect; the list is stale once. */
    const timer = globalThis.setTimeout(() => {
      useInspectStore.getState().refresh();
    }, 250);
    return () => {
      globalThis.clearTimeout(timer);
      useInspectStore.getState().setRoot(null);
    };
  }, [scene]);

  useEffect(() => {
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!("isMesh" in node) || mesh.material == null) return;
      const wanted = overrides[node.name];
      const current = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (wanted == null) {
        const original = originals.get(node.uuid);
        if (original != null && current !== original) {
          mesh.material = original;
          originals.delete(node.uuid);
        }
        return;
      }
      const next = materialFor(wanted);
      if (next == null || next === current) return;
      if (!originals.has(node.uuid)) originals.set(node.uuid, mesh.material);
      mesh.material = next;
    });
  }, [scene, overrides, rev]);

  return null;
}

function ImportedModel({ url, name }: { url: string; name: string }) {
  const { scene } = useGLTF(url);
  /* A loaded scene is shared by drei's cache: clone it so two imports of one file are two objects. */
  return <primitive object={scene.clone(true)} name={name} />;
}

export function ImportedModels() {
  const imports = useInspectStore((state) => state.imports);
  if (imports.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {imports.map((item) => (
        <ImportedModel key={item.id} url={item.url} name={item.name} />
      ))}
    </Suspense>
  );
}
