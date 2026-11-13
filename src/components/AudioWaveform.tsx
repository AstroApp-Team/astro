import { useEffect, useRef } from "react";

const BAR_REST = [0.22, 0.34, 0.26, 0.34, 0.22] as const;

type AudioWaveformProps = {
  stream: MediaStream | null;
  active: boolean;
};

function resetBars(bars: (HTMLSpanElement | null)[]) {
  for (let i = 0; i < BAR_REST.length; i++) {
    const el = bars[i];
    if (el) el.style.transform = `scaleY(${BAR_REST[i]})`;
  }
}

function startWaveformMeter(stream: MediaStream, bars: (HTMLSpanElement | null)[]): () => void {
  let rafId = 0;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;

  try {
    ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.65;
    source.connect(analyser);
  } catch {
    return () => {
      resetBars(bars);
    };
  }

  const buffer = new Uint8Array(analyser.fftSize);
  let smoothedLevel = 0;

  const tick = (now: number) => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(buffer);

    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const centered = ((buffer[i] ?? 128) - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / buffer.length);
    const rawLevel = Math.min(1, Math.max(0, (rms - 0.008) * 14));
    smoothedLevel = smoothedLevel * 0.68 + rawLevel * 0.32;

    const t = now * 0.0085;
    for (let i = 0; i < BAR_REST.length; i++) {
      const el = bars[i];
      if (!el) continue;

      const rest = BAR_REST[i] ?? 0.25;
      if (smoothedLevel < 0.04) {
        el.style.transform = `scaleY(${rest})`;
      } else {
        const wave = 0.55 + 0.45 * Math.sin(t + i * 1.15);
        const scale = Math.min(1, rest + smoothedLevel * 0.78 * wave);
        el.style.transform = `scaleY(${scale.toFixed(3)})`;
      }
    }

    rafId = window.requestAnimationFrame(tick);
  };

  rafId = window.requestAnimationFrame(tick);

  return () => {
    window.cancelAnimationFrame(rafId);
    source?.disconnect();
    analyser?.disconnect();
    if (ctx) void ctx.close().catch(() => {});
    resetBars(bars);
  };
}

/**
 * Minimalist Liquid Glass soundwave that animates organically in response to
 * the user's microphone amplitude while speaking, and rests quietly when idle.
 */
export default function AudioWaveform({ stream, active }: AudioWaveformProps) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    resetBars(barsRef.current);
    if (!active || stream == null || typeof AudioContext === "undefined") {
      return;
    }

    return startWaveformMeter(stream, barsRef.current);
  }, [stream, active]);

  return (
    <div className="voice-waveform" aria-hidden="true">
      {BAR_REST.map((_, index) => (
        <span
          key={index}
          ref={(node) => {
            barsRef.current[index] = node;
          }}
          className="voice-waveform__bar"
        />
      ))}
    </div>
  );
}
