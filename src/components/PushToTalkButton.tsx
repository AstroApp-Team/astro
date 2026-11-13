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

/** A soft, rounded arrow head in orange glass: gradient body, bright rim, a sheen on top. */
function ArrowHead() {
  const body =
    "M16 2.5C17.9 2.5 19.2 3.5 20.3 5.2L28.4 16.4C29.7 18.2 28.5 20 26.3 20H5.7C3.5 20 2.3 18.2 3.6 16.4L11.7 5.2C12.8 3.5 14.1 2.5 16 2.5Z";
  return (
    <svg viewBox="0 0 32 22" width="34" height="24">
      <defs>
        <linearGradient id="ptt-arrow-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb347" />
          <stop offset="1" stopColor="#fe3402" />
        </linearGradient>
        <linearGradient id="ptt-arrow-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fefbf5" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fefbf5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={body} fill="url(#ptt-arrow-fill)" />
      <path d={body} fill="url(#ptt-arrow-sheen)" />
      <path d={body} fill="none" stroke="#fefbf5" strokeOpacity="0.5" strokeWidth="0.8" />
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
          {/* Just the head of an arrow, only while the finger is down: it can still slide up to lock. */}
          {state.phase === "pressing" && (
            <span className="ptt__arrow" aria-hidden="true">
              <ArrowHead />
            </span>
          )}
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
            <LiquidGlassIcon name="stop" tone="cream" size={26} />
            <span>Enviar</span>
          </>
        ) : state.phase === "pressing" ? (
          <>
            <AudioWaveform stream={micStream} active={waveformActive} />
            <span>Solte para enviar</span>
          </>
        ) : (
          <>
            <LiquidGlassIcon name="mic" tone="cream" size={28} />
            <span>Segurar para falar</span>
          </>
        )}
      </button>
    </>
  );
}
