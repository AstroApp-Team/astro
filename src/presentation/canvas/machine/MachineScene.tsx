/**
 * The demo rig: three meshes with the bone names the definition refers to, one of them
 * carrying a morph target.
 *
 * Names are the contract. `root`, `hand` and `head` appear in `machine-demo.definition.json`,
 * and the adapter resolves them through the register/unregister pair below — a mismatch
 * throws in `applyMachineOutput` with the bone's name in the message, which is the loudest
 * failure the adapter can give without a rig description.
 */

import { useLayoutEffect, useState } from "react";
import { Edges } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import type { MachineTargets } from "@infra/theatre/animationStateMachine/applyMachineOutput.ts";

export interface DemoPointerHandlers {
  onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (event: ThreeEvent<PointerEvent>) => void;
}

export interface MachineSceneProps {
  /** Filled in by this component; owned by the canvas so it survives re-renders. */
  targets: MachineTargets;
  pointer: DemoPointerHandlers;
}

/** One morph target that squashes the head vertically — a blink, in geometry. */
function buildHeadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.34, 32, 24);
  const base = geometry.getAttribute("position");
  const squashed = base.clone();
  /* The morph target's name comes from the *attribute*, not from the dictionary: three's
     `updateMorphTargets()` rebuilds `morphTargetDictionary` out of these names, so a target
     registered by hand is wiped the moment the mesh updates. `blink` is the contract with
     the clip's morph track. */
  squashed.name = "blink";
  for (let i = 0; i < squashed.count; i += 1) {
    squashed.setY(i, squashed.getY(i) * 0.25);
  }
  geometry.morphAttributes.position = [squashed];
  geometry.morphTargetsRelative = false;
  return geometry;
}

/** Built once: a geometry per render is a GPU leak the demo would hide behind its frame rate. */
const HEAD_GEOMETRY = buildHeadGeometry();

/** Builds `morphTargetDictionary` / `morphTargetInfluences` from the geometry's targets. */
function configureMorphs(mesh: THREE.Mesh): void {
  mesh.updateMorphTargets();
}

export function MachineScene({ targets, pointer }: MachineSceneProps) {
  /*
   * Registration is a layout effect, not a ref callback: the canvas's frame loop starts on
   * the first frame, and a ref callback that runs after it would let one frame throw
   * "the scene does not provide bone root". The effect also runs after the meshes exist, so
   * the maps are complete before the first `applyMachineOutput`.
   */
  /* The scene owns the mutable maps and hands them to the adapter as read-only ones: the
     `MachineTargets` contract is "the adapter may only read", and `Map` is assignable to
     `ReadonlyMap` for free. The maps live in state so their identity survives a re-render —
     the adapter caches nothing, but the ref callbacks below run once per mesh. */
  const [maps] = useState(() => ({
    bones: new Map<string, THREE.Object3D>(),
    morphs: new Map<string, THREE.Object3D>(),
  }));

  useLayoutEffect(() => {
    targets.bones = maps.bones;
    targets.morphs = maps.morphs;
    return () => {
      maps.bones.clear();
      maps.morphs.clear();
    };
  }, [targets, maps]);

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 5, 4]} intensity={2.1} />

      <group name="rig">
        <mesh
          name="root"
          position={[0, -0.55, 0]}
          ref={(object) => {
            if (object != null) maps.bones.set("root", object);
          }}
        >
          <boxGeometry args={[0.9, 0.22, 0.9]} />
          <meshStandardMaterial color="#2b2f3a" roughness={0.7} />
          <Edges color="#8ea2c6" />
        </mesh>

        <mesh
          name="hand"
          position={[1.1, 0.1, 0]}
          ref={(object) => {
            if (object != null) maps.bones.set("hand", object);
          }}
        >
          <sphereGeometry args={[0.19, 24, 18]} />
          <meshStandardMaterial color="#FB8A5B" roughness={0.5} />
        </mesh>

        <mesh
          name="head"
          position={[0, 0.35, 0]}
          geometry={HEAD_GEOMETRY}
          ref={(object) => {
            if (object == null) return;
            maps.bones.set("head", object);
            configureMorphs(object);
            maps.morphs.set("head:blink", object);
          }}
          {...pointer}
        >
          <meshStandardMaterial color="#FEFBF5" roughness={0.9} />
          <Edges color="#FEFBF5" threshold={15} />
        </mesh>
      </group>
    </>
  );
}
