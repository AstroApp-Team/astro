import { IonButton, IonIcon, IonNote } from "@ionic/react";
import { refreshOutline } from "ionicons/icons";

import { resetUsage, usageToUsd, useVoiceUsage } from "../lib/voice-usage.ts";

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
            spent · voice ${usage.voiceUsd.toFixed(4)} · pages ${usage.viewUsd.toFixed(4)}
          </IonNote>
        </div>
        <IonNote className="usage-meter__detail">
          {usage.sessions} session{usage.sessions === 1 ? "" : "s"} ·{" "}
          {formatDuration(usage.seconds)} connected
        </IonNote>
      </div>
      <IonButton fill="clear" size="small" onClick={resetUsage} title="Reset the running total">
        <IonIcon slot="icon-only" icon={refreshOutline} />
      </IonButton>
    </div>
  );
}
