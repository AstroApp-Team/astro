import { useEffect, useRef, useState } from "react";

import {
  parseViewEvent,
  parseViewState,
  VIEW_ERROR_TYPE,
  VIEW_STATE_TYPE,
  type ViewEvent,
} from "../../shared/view.ts";

/** Enough to show a pattern to the coding agent, few enough to fit `pageErrors`. */
const MAX_PAGE_ERRORS = 5;

/** A live page's uncaught error. The id makes a repeat of the same text news again. */
export type PageError = { id: number; message: string };

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
export function useViewEvents({ finishedHtml }: { finishedHtml: string | null }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [event, setEvent] = useState<ViewEvent | null>(null);

  /**
   * Errors are tagged with the page they came from and only count while that
   * page is still the one on screen: an edit replaces the code that threw.
   * `finishedHtml` is null while a draft is streaming in — a half-written
   * script throws by construction, and that is not a bug worth reporting.
   */
  const [errors, setErrors] = useState<{ html: string; list: PageError[] }>({ html: "", list: [] });
  const finishedHtmlRef = useRef(finishedHtml);
  useEffect(() => {
    finishedHtmlRef.current = finishedHtml;
  }, [finishedHtml]);

  /**
   * A ref, not state: nothing renders from it. The page posts state whenever
   * its state changes; only the latest matters, and it matters exactly once —
   * when the next version of the page loads.
   */
  const savedStateRef = useRef<unknown>(undefined);
  /** Reactive counter + payload for silent auto-save to D1. */
  const [latestState, setLatestState] = useState<{ id: number; data: unknown } | null>(null);

  useEffect(() => {
    const onMessage = (message: MessageEvent) => {
      if (message.source !== frameRef.current?.contentWindow) return;

      const state = parseViewState(message.data);
      if (state != null) {
        savedStateRef.current = state.state;
        setLatestState((previous) => ({ id: (previous?.id ?? 0) + 1, data: state.state }));
        return;
      }

      const error = parseViewError(message.data);
      if (error != null) {
        const html = finishedHtmlRef.current;
        if (html == null) return;
        setErrors((previous) => {
          const list = previous.html === html ? previous.list : [];
          if (list.some((known) => known.message === error)) return previous;
          const id = (previous.list.at(-1)?.id ?? 0) + 1;
          return { html, list: [...list, { id, message: error }].slice(-MAX_PAGE_ERRORS) };
        });
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

  /**
   * Seeds `savedStateRef` when switching to a saved project (or `undefined` when
   * starting a blank one) without triggering an immediate redundant auto-save.
   */
  const restoreState = (state: unknown) => {
    savedStateRef.current = state;
    setLatestState(null);

    const target = frameRef.current?.contentWindow;
    if (target != null && state !== undefined) {
      target.postMessage({ type: VIEW_STATE_TYPE, state }, "*");
    }
  };

  const pageErrors = errors.html === finishedHtml ? errors.list : [];

  return { frameRef, event, pageErrors, latestState, onFrameLoad, restoreState };
}

/** The parent-side check for `astro:error`: a short string, nothing else. */
export function parseViewError(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;

  const { type, message } = data as { type?: unknown; message?: unknown };
  if (type !== VIEW_ERROR_TYPE || typeof message !== "string" || message.trim() === "") {
    return null;
  }
  return message.slice(0, 300);
}

/** Phrased for the voice model, which has to describe this out loud. */
export function describeViewEvent(event: ViewEvent): string {
  return (
    `The user interacted with the page: ${event.name}` +
    (event.value === undefined ? "." : ` = ${String(event.value)}.`)
  );
}
