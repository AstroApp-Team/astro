/**
 * Pointer listeners (§10).
 *
 * The machine never raycasts. The host forwards hits with a phase — `enter`, `move`,
 * `down`, `up`, `leave` — and this module derives the nine events from the phase
 * sequence plus its own bookkeeping (hover set, press timing, drag capture).
 *
 * Actions are **queued, not applied inline**. A listener that fired on `pointerDown`
 * must not change an input that a transition already evaluated this frame, so the
 * actions land at the start of the next frame. That is the same rule the input snapshot
 * enforces from the other side.
 *
 * `drag` capture is per pointer: the mesh that received `dragStart` owns the drag until
 * `dragEnd`, which is what makes a drag that leaves the mesh keep driving the input it
 * started on. Without capture a drag across a mesh boundary fires enter/leave on
 * whatever the pointer passes over, and a slider being dragged drives the mesh under the
 * finger instead.
 */

import type {
  ListenerAction,
  ListenerDef,
  PointerEventName,
  PointerHit,
} from "@core/models/animationStateMachine.ts";
import { remap } from "@core/usecases/animationStateMachine/mathUtil.ts";
import type { InputStore } from "@core/usecases/animationStateMachine/inputStore.ts";
import {
  fireTrigger,
  setBoolean,
  setNumber,
} from "@core/usecases/animationStateMachine/inputStore.ts";
import type { MachineRuntime } from "@core/usecases/animationStateMachine/types.ts";

/** Double-click window in seconds. Ratchet-free: two clicks inside it is a doubleClick. */
export const DOUBLE_CLICK_WINDOW = 0.35;

export interface ListenerEmit {
  (event: "listener", payload: { listener: string; event: PointerEventName; action: number }): void;
}

/**
 * Ingest forwarded hits (§10.1).
 *
 * Returns the events derived this frame, in the order the phases arrived. A listener
 * matching an event queues its actions; nothing here touches an input.
 */
export function ingestPointerHits(
  hits: PointerHit[],
  listeners: ListenerDef[],
  runtime: MachineRuntime,
  emit: ListenerEmit,
): void {
  for (const hit of hits) {
    const previous = runtime.pointers.get(hit.pointerId);
    const mesh = hit.mesh ?? previous?.mesh;

    // enter / leave are mesh transitions, not phase transitions: a `move` onto a new
    // mesh is a leave on the old one and an enter on the new one.
    if (mesh !== previous?.mesh) {
      if (previous?.mesh != null) {
        dispatch("pointerLeave", previous.mesh, hit, listeners, runtime, emit);
      }
      if (mesh != null) {
        dispatch("pointerEnter", mesh, hit, listeners, runtime, emit);
      }
    }

    if (hit.phase === "leave") {
      if (mesh != null) dispatch("pointerLeave", mesh, hit, listeners, runtime, emit);
      runtime.pointers.delete(hit.pointerId);
      runtime.dragOwner.delete(hit.pointerId);
      continue;
    }

    const state = {
      pointerId: hit.pointerId,
      mesh,
      surface: hit.surface ?? previous?.surface,
      uv: hit.uv ?? previous?.uv,
      world: hit.world ?? previous?.world,
      screen: hit.screen ?? previous?.screen,
      down: hit.phase === "down" ? true : hit.phase === "up" ? false : (previous?.down ?? false),
      drag: previous?.drag ?? false,
    };

    if (hit.phase === "down") {
      const last = runtime.lastClick;
      if (
        last != null &&
        mesh != null &&
        last.mesh === mesh &&
        runtime.elapsed - last.at <= DOUBLE_CLICK_WINDOW &&
        last.button === (hit.button ?? 0)
      ) {
        dispatch("doubleClick", mesh, hit, listeners, runtime, emit);
        runtime.lastClick = null;
      } else {
        runtime.lastClick = { mesh: mesh ?? "", at: runtime.elapsed, button: hit.button ?? 0 };
      }
      dispatch("pointerDown", mesh ?? "", hit, listeners, runtime, emit);
      if (mesh != null) {
        runtime.dragOwner.set(hit.pointerId, mesh);
        state.drag = true;
        dispatch("dragStart", mesh, hit, listeners, runtime, emit);
      }
    } else if (hit.phase === "up") {
      const owner = runtime.dragOwner.get(hit.pointerId);
      if (owner != null) {
        dispatch("dragEnd", owner, hit, listeners, runtime, emit);
        runtime.dragOwner.delete(hit.pointerId);
        state.drag = false;
      }
      if (mesh != null) dispatch("pointerUp", mesh, hit, listeners, runtime, emit);
      // A click is a press and a release on the same mesh. A release elsewhere is a
      // drag end, not a click, and must not fire one.
      if (
        mesh != null &&
        mesh === runtime.lastClick?.mesh &&
        runtime.elapsed - runtime.lastClick.at <= DOUBLE_CLICK_WINDOW
      ) {
        dispatch("click", mesh, hit, listeners, runtime, emit);
      }
    } else if (hit.phase === "move") {
      const owner = runtime.dragOwner.get(hit.pointerId);
      if (owner != null) {
        dispatch("drag", owner, hit, listeners, runtime, emit);
        state.drag = true;
      }
    }

    runtime.pointers.set(hit.pointerId, state);
  }

  runtime.pendingPointers = [];
}

/**
 * Fire every listener matching an event.
 *
 * `layer` restricts a listener to one layer's hit region. The machine does not know
 * which layer a mesh belongs to, so the restriction is a name match against the
 * listener's own `layer` field and the mesh's owning layer, which the host supplies on
 * the hit's `surface`. A listener with no `layer` matches every hit.
 */
function dispatch(
  event: PointerEventName,
  mesh: string,
  hit: PointerHit,
  listeners: ListenerDef[],
  runtime: MachineRuntime,
  emit: ListenerEmit,
): void {
  for (const [index, listener] of listeners.entries()) {
    if (listener.event !== event) continue;
    if (listener.target.mesh !== mesh) continue;
    if (listener.layer != null && hit.surface != null && hit.surface !== listener.layer) continue;

    for (const [actionIndex, action] of listener.actions.entries()) {
      runtime.queuedListenerActions.push({ listenerId: listenerId(index, listener), action });
      emit("listener", { listener: listenerId(index, listener), event, action: actionIndex });
    }
  }
}

function listenerId(index: number, listener: ListenerDef): string {
  return `${listener.target.mesh}:${listener.event}[${String(index)}]`;
}

/**
 * Apply the actions queued last frame (§10.2).
 *
 * `setFromDrag` is the only action with arithmetic: it maps a drag axis through a
 * four-number range. The axis names the coordinate the hit carries, so `u` and `v` read
 * the surface UV and `distance` reads the hit's distance from the press point.
 */
export function applyQueuedActions(runtime: MachineRuntime, store: InputStore): void {
  const queue = runtime.queuedListenerActions;
  if (queue.length === 0) return;

  for (const record of queue) {
    applyAction(record.action, store, runtime);
  }
  queue.length = 0;
}

function applyAction(action: ListenerAction, store: InputStore, runtime: MachineRuntime): void {
  if ("set" in action) {
    const def = store.defs.get(action.set);
    if (def?.kind === "number" && typeof action.to === "number")
      setNumber(store, action.set, action.to);
    else if (def?.kind === "boolean" && typeof action.to === "boolean")
      setBoolean(store, action.set, action.to);
    return;
  }
  if ("fire" in action) {
    fireTrigger(store, action.fire);
    return;
  }
  if ("toggle" in action) {
    const def = store.defs.get(action.toggle);
    if (def?.kind === "boolean")
      setBoolean(store, action.toggle, !store.booleans.get(action.toggle)?.value);
    else if (def?.kind === "trigger") fireTrigger(store, action.toggle);
    return;
  }
  if ("add" in action) {
    const current = store.numbers.get(action.add)?.value;
    if (current != null) setNumber(store, action.add, current + action.amount);
    return;
  }
  if ("setFromDrag" in action) {
    const value = dragValue(action.axis, runtime);
    if (value == null) return;
    const [inMin, inMax, outMin, outMax] = action.map;
    setNumber(store, action.setFromDrag, remap(value, inMin, inMax, outMin, outMax));
  }
}

/**
 * The value a drag axis carries. `null` when no pointer is dragging, which is the
 * normal case for a `dragEnd`-triggered action arriving the next frame.
 */
function dragValue(
  axis: "x" | "y" | "u" | "v" | "distance",
  runtime: MachineRuntime,
): number | null {
  for (const hit of runtime.pointers.values()) {
    if (!hit.drag) continue;
    if (axis === "x") return hit.uv?.[0] ?? hit.screen?.[0] ?? hit.world?.[0] ?? null;
    if (axis === "y") return hit.uv?.[1] ?? hit.screen?.[1] ?? hit.world?.[1] ?? null;
    if (axis === "u") return hit.uv?.[0] ?? null;
    if (axis === "v") return hit.uv?.[1] ?? null;
    const world = hit.world;
    if (world == null) return null;
    return Math.hypot(world[0], world[1], world[2]);
  }
  return null;
}

export type { ListenerDef, PointerHit };
