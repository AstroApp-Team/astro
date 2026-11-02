/**
 * The event bus (§11.4).
 *
 * A machine reports through `MachineEvents` and nothing else: a host that wants to know
 * a marker fired, a layer cut, or a cycle froze subscribes to the bus. Keeping the
 * dispatch in one place is what makes the events *ordered* — a listener that mutates
 * inputs cannot make an earlier event fire a second time, because the payload was built
 * before the emit.
 *
 * The bus is deliberately not a queue. §11.4 wants the host to see an event in the frame
 * that produced it; a queue would let one frame's markers arrive after the next frame's
 * pose, which is worse than no event at all.
 */

import type { MachineEventName, MachineEvents } from "@core/models/animationStateMachine.ts";

export type EventListener<K extends MachineEventName> = (payload: MachineEvents[K]) => void;

export interface EventBus {
  listeners: Map<MachineEventName, Set<(payload: never) => void>>;
}

export function createEventBus(): EventBus {
  return { listeners: new Map() };
}

/**
 * Subscribe to one event. Returns the unsubscribe function, so a React effect can clean
 * up without holding the listener reference.
 */
export function subscribe<K extends MachineEventName>(
  bus: EventBus,
  event: K,
  listener: EventListener<K>,
): () => void {
  let set = bus.listeners.get(event);
  if (set == null) {
    set = new Set();
    bus.listeners.set(event, set);
  }
  set.add(listener as (payload: never) => void);
  return () => {
    set?.delete(listener as (payload: never) => void);
  };
}

/**
 * Emit one event to every subscriber.
 *
 * Iteration is over a **copy**: a listener that unsubscribes itself while handling its
 * own event — a one-shot listener, which is the common case for `marker` — would
 * otherwise mutate the set mid-iteration and skip the next listener.
 */
export function emit<K extends MachineEventName>(
  bus: EventBus,
  event: K,
  payload: MachineEvents[K],
): void {
  const set = bus.listeners.get(event);
  if (set == null || set.size === 0) return;
  for (const listener of [...set]) {
    (listener as unknown as EventListener<K>)(payload);
  }
}

/** Drop every listener. `dispose` calls this so a torn-down machine cannot leak a host. */
export function clearBus(bus: EventBus): void {
  bus.listeners.clear();
}
