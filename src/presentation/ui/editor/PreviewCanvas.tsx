/**
 * The editor's preview: a scissored studio render of the rig, stepped only while playing.
 *
 * It is `MachineCanvas` with one difference that matters: `playing` gates `step`. The demo page
 * never pauses, so its loop always steps; an editor's transport has to be able to hold a pose,
 * and a loop that kept stepping behind a paused button would make every pause a lie (§7.2).
 *
 * Build order is the demo's, and for the same reason: step → apply → publish. A scene that
 * autoplayed a Theatre sequence over the same bones would win silently — the machine is the
 * only owner of these transforms here too.
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

function PreviewLoop({
  machine,
  targets,
  layers,
  playing,
}: {
  machine: Machine;
  targets: MachineTargets;
  layers: readonly string[];
  playing: boolean;
}) {
  useFrame((_, delta) => {
    if (!playing) return;
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
      useMachineStore.getState().setError(error instanceof Error ? error.message : String(error));
    }
  });
  return null;
}

export function PreviewCanvas({
  handle,
  layers,
  playing,
}: {
  handle: AnimationMachineHandle;
  layers: readonly string[];
  playing: boolean;
}) {
  const [targets] = useState<MachineTargets>(() => ({ bones: new Map(), morphs: new Map() }));
  const pointer = createPointerBridge((hit) => handle.machine?.pushPointer(hit), {
    mesh: "head",
    phases: ["enter", "down", "up", "leave"],
  });
  const machine = handle.machine;

  return (
    <div className="ed-preview__canvas">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.5, 3.5], fov: 42 }}
        gl={{ antialias: false, failIfMajorPerformanceCaveat: false }}
        shadows={false}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(new THREE.Color("#0b1020"), 1);
          camera.lookAt(0, 0.22, 0);
        }}
      >
        <MachineScene targets={targets} pointer={pointer} />
        {machine == null ? null : (
          <PreviewLoop machine={machine} targets={targets} layers={layers} playing={playing} />
        )}
      </Canvas>
    </div>
  );
}
