import { type ComponentProps, useEffect, useState } from "react";

import type { PttState } from "../lib/ptt-gesture.ts";
import AudioWaveform from "./AudioWaveform.tsx";
import LiquidGlassIcon from "./LiquidGlassIcon.tsx";

type Props = {
  state: PttState;
  /** A tap was too short to record: say how the button works. */
  tooShort: boolean;
  /** The pointer and keyboard handlers from `usePushToTalk`. */
  buttonProps: ComponentProps<"button">;
  micStream: MediaStream | null;
  /** Whether the waveform should be animating (the mic is open and Astro is silent). */
  waveformActive: boolean;
};

/** `m:ss`, ticking while the lock is held. Mounted only while locked, so it always starts at 0. */
function RecordingTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      250,
    );
    return () => window.clearInterval(id);
  }, []);

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <span className="ptt__timer" role="timer" aria-label="Tempo de gravação">
      {mm}:{ss}
    </span>
  );
}

/** A padlock whose shackle closes as `progress` goes from 0 to 1. */
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        className="ptt__lock-shackle"
        d="M8 11V8a4 4 0 0 1 8 0v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="5.5" y="11" width="13" height="9.5" rx="2.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The push-to-talk button, drawn from the gesture state. It decides nothing: which phase it is
 * in, and what a press means, belong to `usePushToTalk` and `pttTransition`.
 *
 *   idle      "Segurar para falar" — a mic
 *   pressing  waveform, "Solte para enviar", and the lock badge filling as the finger slides up
 *   locked    pulsing dot, timer, and a stop icon — a tap sends
 */
export default function PushToTalkButton({
  state,
  tooShort,
  buttonProps,
  micStream,
  waveformActive,
}: Props) {
  const progress = state.phase === "pressing" ? state.progress : state.phase === "locked" ? 1 : 0;
  const label =
    state.phase === "locked"
      ? "Parar e enviar"
      : state.phase === "pressing"
        ? "Solte para enviar"
        : "Segurar para falar";

  return (
    <>
      {state.phase !== "idle" ? (
        <div
          className={`ptt__lock${state.phase === "locked" ? " ptt__lock--locked" : ""}`}
          style={{ "--ptt-progress": progress } as React.CSSProperties}
          aria-live="polite"
        >
          <span className="ptt__lock-badge">
            <LockIcon />
          </span>
          <span className="ptt__lock-label">
            {state.phase === "locked" ? "Gravando" : "Deslize para cima para travar"}
          </span>
        </div>
      ) : (
        tooShort && (
          <output className="ptt__lock ptt__lock--hint">
            <span className="ptt__lock-label">Segure para falar</span>
          </output>
        )
      )}

      <button
        type="button"
        className={`apple-liquid-glass-pill ${
          state.phase === "idle"
            ? "apple-liquid-glass-pill--primary"
            : "apple-liquid-glass-pill--ember voice-bar__ptt--active"
        } voice-bar__ptt`}
        aria-pressed={state.phase !== "idle"}
        aria-label={label}
        title={label}
        {...buttonProps}
      >
        {state.phase === "locked" ? (
          <>
            <span className="ptt__pulse" aria-hidden="true" />
            <RecordingTimer />
            <LiquidGlassIcon name="stop" tone="cream" size={20} />
            <span>Enviar</span>
          </>
        ) : state.phase === "pressing" ? (
          <>
            <AudioWaveform stream={micStream} active={waveformActive} />
            <span>Solte para enviar</span>
          </>
        ) : (
          <>
            <LiquidGlassIcon name="mic" tone="cream" size={22} />
            <span>Segurar para falar</span>
          </>
        )}
      </button>
    </>
  );
}
