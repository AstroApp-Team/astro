import { IonNote } from "@ionic/react";

import { resetUsage, usageToUsd, useVoiceUsage } from "../lib/voice-usage.ts";
import LiquidGlassIcon from "./LiquidGlassIcon.tsx";

function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/**
 * The running bill, itemized on the Settings screen.
 */
export default function UsageMeter() {
  const usage = useVoiceUsage();

  return (
    <div className="usage-meter">
      <div className="usage-meter__text">
        <div className="usage-meter__headline">
          <strong className="usage-meter__total">${usageToUsd(usage).toFixed(4)}</strong>
          <IonNote>gasto acumulado</IonNote>
        </div>
        <IonNote className="usage-meter__detail">
          voz ${usage.voiceUsd.toFixed(4)} · páginas ${usage.viewUsd.toFixed(4)}
        </IonNote>
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
        <LiquidGlassIcon name="refresh" size={23} />
      </button>
    </div>
  );
}
