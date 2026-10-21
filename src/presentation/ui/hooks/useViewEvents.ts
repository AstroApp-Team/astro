import { useEffect, useRef, useState } from "react";

import { parseViewEvent, parseViewState, VIEW_STATE_TYPE, type ViewEvent } from "@shared/view.ts";

/**
 * The parent's side of both channels a published view has: events (things the
 * voice agent should hear about) and state (things the next version of the
 * page should resume from).
 *
 * Owns the iframe ref as well as the listener, so the two cannot be wired up
 * apart: a view runs on an opaque origin, which reports itself as the string
 * "null" and is shared by every sandboxed frame on the page. Identity has to
 * come from the frame's own window, and the shape from the parsers —
 * everything else on the `message` bus is somebody else's traffic.
 *
 * Returns the latest event rather than taking a callback, so the caller sends
 * it from an effect — the voice socket is reached through a ref, and building a
 * function during render that touches one is what the React Compiler refuses to
 * optimize.
 */
export function useViewEvents() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [event, setEvent] = useState<ViewEvent | null>(null);

  /**
   * A ref, not state: nothing renders from it. The page posts state whenever
   * its state changes; only the latest matters, and it matters exactly once —
   * when the next version of the page loads.
   */
  const savedStateRef = useRef<unknown>(undefined);

  useEffect(() => {
    const onMessage = (message: MessageEvent) => {
      if (message.source !== frameRef.current?.contentWindow) return;

      const state = parseViewState(message.data);
      if (state != null) {
        savedStateRef.current = state.state;
        return;
      }

      const parsed = parseViewEvent(message.data);
      if (parsed != null) setEvent(parsed);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /**
   * Attached to the iframe's `onLoad`, which fires after the document's own
   * scripts have run — so its `message` listener is installed by the time this
   * posts. `"*"` because an opaque origin has no other address; the message
   * carries nothing the page did not give us in the first place.
   */
  const onFrameLoad = () => {
    const target = frameRef.current?.contentWindow;
    if (target == null || savedStateRef.current === undefined) return;

    target.postMessage({ type: VIEW_STATE_TYPE, state: savedStateRef.current }, "*");
  };

  return { frameRef, event, onFrameLoad };
}

/** Phrased for the voice model, which has to describe this out loud. */
export function describeViewEvent(event: ViewEvent): string {
  return (
    `The user interacted with the page: ${event.name}` +
    (event.value === undefined ? "." : ` = ${String(event.value)}.`)
  );
}
