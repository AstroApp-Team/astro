/**
 * R3F pointer events → `PointerHit`.
 *
 * The bridge does not raycast: R3F already did. It reads the intersection, the mesh's name
 * and the UV, and forwards a hit. Two traps live here, both already documented repo-wide:
 *
 * - **`ThreeEvent.target` is not a DOM node.** It is R3F's pointer-capture shim, so a
 *   press gate written against `event.target instanceof HTMLElement` is always false and
 *   compiles clean. The element the finger landed on is `event.nativeEvent.target`.
 * - **A press on a control is not a press on the mesh.** On an overlay canvas the DOM
 *   element under the pointer may be a button or a link; forwarding it would make the
 *   character react to every UI click that happens to sit over it.
 *
 * The gate is exported so a scene can reuse the same predicate the `/float` and `/surface`
 * scenes use instead of inventing a third one.
 */

import type { PointerHit } from "@core/models/animationStateMachine.ts";
import type { ThreeEvent } from "@react-three/fiber";

/** Events R3F delivers that the machine understands. */
export type BridgedEvent = "enter" | "move" | "down" | "up" | "leave";

/** Anonymous event source: the bridge needs the mesh name, not the mesh. */
export function isMeshPressTarget(event: ThreeEvent<PointerEvent>): boolean {
  const target: unknown = event.nativeEvent.target;
  if (typeof Element === "undefined" || !(target instanceof Element)) return true;
  if (target.closest("button, a, input, select, textarea, label, [role='button']") != null) {
    return false;
  }
  return target.closest(".no-mesh-press") == null;
}

export function toPointerHit(
  event: ThreeEvent<PointerEvent>,
  phase: BridgedEvent,
  mesh: string,
): PointerHit {
  const { uv, point, nativeEvent } = event;
  return {
    pointerId: nativeEvent.pointerId,
    mesh,
    uv: uv == null ? undefined : [uv.x, uv.y],
    world: [point.x, point.y, point.z],
    screen: [nativeEvent.clientX, nativeEvent.clientY],
    phase,
    button: nativeEvent.button,
  };
}

export interface PointerBridgeOptions {
  /** The mesh name the definition refers to. */
  mesh: string;
  /** Which phases to forward. Defaults to the four the machine names, minus `move` (chatty). */
  phases?: readonly BridgedEvent[];
  /** Forward presses that land on a DOM control. Off by default — see the module note. */
  allowControls?: boolean;
}

/**
 * Build the six R3F handlers a mesh needs, bound to one machine sink.
 *
 * `push` is `machine.pushPointer`. The bridge keeps no state: the machine owns pointers,
 * so a scene that re-renders cannot resurrect a stale one.
 */
export function createPointerBridge(
  push: (hit: PointerHit) => void,
  options: PointerBridgeOptions,
): {
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: (event: ThreeEvent<PointerEvent>) => void;
} {
  const phases = new Set<BridgedEvent>(options.phases ?? ["enter", "down", "up", "leave"]);
  const allowControls = options.allowControls ?? false;

  const forward = (phase: BridgedEvent) => (event: ThreeEvent<PointerEvent>) => {
    if (phase === "down" && !allowControls && !isMeshPressTarget(event)) return;
    if (!phases.has(phase)) return;
    push(toPointerHit(event, phase, options.mesh));
  };

  return {
    onPointerOver: forward("enter"),
    onPointerMove: forward("move"),
    onPointerDown: forward("down"),
    onPointerUp: forward("up"),
    onPointerOut: forward("leave"),
  };
}
