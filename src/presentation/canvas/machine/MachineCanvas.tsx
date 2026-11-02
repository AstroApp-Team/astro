/**
 * The R3F host for the demo: one frame loop, one machine, one adapter.
 *
 * The machine is created by the page (so the controls and the loop share **one** instance)
 * and handed down; this component owns the loop and the pointer bridge only.
 *
 * Ordering is the whole reason this is a component and not a hook:
 *
 * 1. `step(dt)` — the machine advances and produces a sparse output;
 * 2. `applyMachineOutput` — the adapter writes it onto the rig;
 * 3. publish a snapshot to the store — throttled, because the panel's bar does not need 60 Hz.
 *
 * The scene does **not** autoplay anything else. The machine is the only owner of these
 * transforms; a Theatre sequence playing the same props would win silently, which is the
 * ownership rule this repo has already paid for twice.
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { useState } from "react";
import * as THREE from "three";

import type { Machine } from "@core/models/animationStateMachine.ts";
import {
  applyMachineOutput,
  type MachineTargets,
} from "@infra/theatre/animationStateMachine/applyMachineOutput.ts";
import { createPointerBridge } from "@infra/theatre/animationStateMachine/pointerBridge.ts";
import { MachineScene } from "@presentation/canvas/machine/MachineScene.tsx";
import type { AnimationMachineHandle } from "@presentation/canvas/machine/useAnimationMachine.ts";
import { snapshotLine, useMachineStore } from "@presentation/state/useMachineStore.ts";

/** Layers the panel shows, in draw order. */
export interface MachineCanvasProps {
  handle: AnimationMachineHandle;
  /** Layer ids, in definition order, so the readout matches the file. */
  layers: readonly string[];
}

function MachineLoop({
  machine,
  targets,
  layers,
}: {
  machine: Machine;
  targets: MachineTargets;
  layers: readonly string[];
}) {
  useFrame((_, delta) => {
    try {
      const output = machine.step(delta, performance.now() / 1000);
      const written = applyMachineOutput(output, targets);
      const active = layers.flatMap((layer) => {
        const line = snapshotLine(layer, machine.getActiveState(layer));
        return line == null ? [] : [line];
      });
      const store = useMachineStore.getState();
      store.setSnapshot(active, store.frames + 1, written.bones, written.influences);
    } catch (error) {
      /* A throw inside `useFrame` is swallowed by R3F's loop and reads as a frozen scene;
         moving it into the store is what makes a wiring mistake visible in the panel. */
      useMachineStore.getState().setError(error instanceof Error ? error.message : String(error));
    }
  });
  return null;
}

export function MachineCanvas({ handle, layers }: MachineCanvasProps) {
  const [targets] = useState<MachineTargets>(() => ({ bones: new Map(), morphs: new Map() }));

  /*
   * Built per render on purpose: five closures over `handle.machine`, which is a ref read at
   * call time. Memoizing would only pin the first frame's `null`.
   */
  const pointer = createPointerBridge((hit) => handle.machine?.pushPointer(hit), {
    mesh: "head",
    phases: ["enter", "down", "up", "leave"],
  });

  const machine = handle.machine;

  return (
    <div className="machine-canvas">
      <Canvas
        dpr={[1, 1.5]}
        /* z 3.5 keeps the hand's 1.3 m excursion inside a portrait canvas: at z 2.9 the half-width
           is ~1.26 and the wave exit clips off the right edge, which reads as a broken clip. */
        camera={{ position: [0, 0.5, 3.5], fov: 42 }}
        gl={{ antialias: false, failIfMajorPerformanceCaveat: false }}
        shadows={false}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(new THREE.Color("#0b1020"), 1);
          /* R3F leaves the camera looking down its own -Z; aiming it at the rig's centre is
             what puts the box under the spheres instead of half out of frame. */
          camera.lookAt(0, 0.22, 0);
        }}
      >
        <MachineScene targets={targets} pointer={pointer} />
        {machine == null ? null : (
          <MachineLoop machine={machine} targets={targets} layers={layers} />
        )}
      </Canvas>
    </div>
  );
}
