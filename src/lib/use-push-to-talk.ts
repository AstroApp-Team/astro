import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import {
  isOffButton,
  PTT_HOLD_DELAY_MS,
  PTT_IDLE,
  pttTransition,
  type PttAction,
  type PttEffect,
  type PttState,
} from "./ptt-gesture.ts";

/** How long the "hold to talk" hint stays after a tap that was too short to record. */
export const PTT_TOO_SHORT_HINT_MS = 1_600;

/** The buzz when the lock engages, where the platform has a vibrator. */
const LOCK_VIBRATION_MS = 15;

type Options = {
  /** The press has lasted long enough: open the microphone and start the turn. */
  onStart: () => void;
  /** The recording is over. `send` is false when the gesture was taken away and must be discarded. */
  onEnd: (send: boolean) => void;
};

/**
 * Pointer and keyboard handling for the push-to-talk button, driving `pttTransition`.
 *
 * This hook owns what the pure machine cannot: the hold-delay timer, pointer capture, which
 * pointer the gesture belongs to, the "hold to talk" hint's timer, and the haptic buzz. It owns
 * nothing about audio — `onStart` and `onEnd` are where the session plugs in — so the recording
 * logic and the gesture can change independently.
 *
 * Everything the handlers touch is a ref or a state setter, so the callbacks may be re-created
 * every render without going stale.
 */
export function usePushToTalk({ onStart, onEnd }: Options) {
  const [state, setState] = useState<PttState>(PTT_IDLE);
  const [tooShort, setTooShort] = useState(false);

  const stateRef = useRef<PttState>(PTT_IDLE);
  const pointerIdRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | undefined>(undefined);
  const hintTimerRef = useRef<number | undefined>(undefined);
  const optionsRef = useRef<Options>({ onStart, onEnd });
  useEffect(() => {
    optionsRef.current = { onStart, onEnd };
  });

  const runEffect = (effect: PttEffect) => {
    switch (effect) {
      case "start":
        optionsRef.current.onStart();
        return;
      case "end-send":
        optionsRef.current.onEnd(true);
        return;
      case "end-discard":
        optionsRef.current.onEnd(false);
        return;
      case "lock":
        try {
          if (typeof navigator.vibrate === "function") navigator.vibrate(LOCK_VIBRATION_MS);
        } catch {
          /* Vibration can be blocked by the browser; the lock is still visible. */
        }
        return;
      case "too-short":
        setTooShort(true);
        window.clearTimeout(hintTimerRef.current);
        hintTimerRef.current = window.setTimeout(() => setTooShort(false), PTT_TOO_SHORT_HINT_MS);
        return;
    }
  };

  const dispatch = (action: PttAction) => {
    const { state: next, effects } = pttTransition(stateRef.current, action);
    stateRef.current = next;
    setState(next);

    if (next.phase !== "pressing") window.clearTimeout(holdTimerRef.current);
    if (next.phase === "idle") pointerIdRef.current = null;
    if (action.type === "press" && next.phase === "pressing") {
      window.clearTimeout(hintTimerRef.current);
      setTooShort(false);
      holdTimerRef.current = window.setTimeout(
        () => dispatchRef.current({ type: "holdElapsed" }),
        PTT_HOLD_DELAY_MS,
      );
    }

    for (const effect of effects) runEffect(effect);
  };

  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  });

  /* Losing the window mid-hold means the release will never arrive. A lock is unaffected. */
  const pressing = state.phase === "pressing";
  useEffect(() => {
    if (!pressing) return;
    const onWindowBlur = () => dispatchRef.current({ type: "cancel" });
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, [pressing]);

  useEffect(
    () => () => {
      window.clearTimeout(holdTimerRef.current);
      window.clearTimeout(hintTimerRef.current);
    },
    [],
  );

  const ownsPointer = (event: PointerEvent) => event.pointerId === pointerIdRef.current;

  const buttonProps = {
    onContextMenu: (event: { preventDefault(): void }) => event.preventDefault(),

    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button > 0) return;
      event.preventDefault();

      /* A locked recording ends with a tap, and the tap is the press itself. */
      if (stateRef.current.phase === "locked") {
        dispatch({ type: "stop" });
        return;
      }
      if (stateRef.current.phase !== "idle") return;

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture can be absent in synthetic or headless tests. */
      }
      pointerIdRef.current = event.pointerId;
      dispatch({ type: "press", y: event.clientY });
    },

    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!ownsPointer(event)) return;
      const offButton = isOffButton(
        { x: event.clientX, y: event.clientY },
        event.currentTarget.getBoundingClientRect(),
      );
      dispatch({ type: "move", y: event.clientY, offButton });
    },

    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (ownsPointer(event)) dispatch({ type: "release" });
    },

    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (ownsPointer(event)) dispatch({ type: "cancel" });
    },

    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
      if (ownsPointer(event)) dispatch({ type: "cancel" });
    },

    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (event.repeat) return;
      dispatch(stateRef.current.phase === "locked" ? { type: "stop" } : { type: "press", y: null });
    },

    onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      dispatch({ type: "release" });
    },

    onBlur: () => dispatch({ type: "cancel" }),
  };

  return {
    state,
    /** True for a moment after a tap that was too short to count as a hold. */
    tooShort,
    /** Back to idle without ending anything — for when the session ended underneath the gesture. */
    reset: () => dispatch({ type: "reset" }),
    buttonProps,
  };
}
