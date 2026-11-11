import { IonNote } from "@ionic/react";

import { resetUsage, usageToUsd, useVoiceUsage } from "../lib/voice-usage.ts";
import LiquidGlassIcon from "./LiquidGlassIcon.tsx";

function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/**
 * The running bill, itemized. The header shows only the total; this is the
 * breakdown and the reset, kept in the transcript sheet so the bottom-right of
 * the screen stays Astro's.
 */
export default function UsageMeter() {
  const usage = useVoiceUsage();

  return (
    <div className="usage-meter">
      <div className="usage-meter__text">
        <div>
          <strong>${usageToUsd(usage).toFixed(4)}</strong>
          <IonNote>
            {" "}
            gasto · voz ${usage.voiceUsd.toFixed(4)} · páginas ${usage.viewUsd.toFixed(4)}
          </IonNote>
        </div>
        <IonNote className="usage-meter__detail">
          {usage.sessions} {usage.sessions === 1 ? "sessão" : "sessões"} ·{" "}
          {formatDuration(usage.seconds)} conectado
        </IonNote>
      </div>
      <button
        type="button"
        className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
        onClick={resetUsage}
        title="Zerar total acumulado"
        aria-label="Zerar total acumulado"
      >
        <LiquidGlassIcon name="refresh" size={16} />
      </button>
    </div>
  );
}
