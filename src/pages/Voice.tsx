import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { lockOpenOutline, refreshOutline, trashOutline } from "ionicons/icons";
import { useState } from "react";

import PasswordGate from "../components/PasswordGate.tsx";
import VoiceSession from "../components/VoiceSession.tsx";
import { setPassword, usePassword } from "../lib/password.ts";
import { resetUsage, usageToUsd, useVoiceUsage } from "../lib/voice-usage.ts";

function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

export default function Voice() {
  /**
   * The realtime hook has no "clear messages" call — its state lives in a ref
   * inside the component. Bumping the key remounts the session, which disposes
   * the old store (closing the socket and the audio contexts) and builds an
   * empty one. The running cost total lives out here, so clearing the
   * conversation does not clear the bill.
   */
  const [sessionKey, setSessionKey] = useState(0);
  const password = usePassword();
  const usage = useVoiceUsage();

  const usd = usageToUsd(usage);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Astro</IonTitle>
          {password !== "" && (
            <IonButtons slot="end">
              <IonButton onClick={() => setSessionKey((key) => key + 1)}>
                <IonIcon slot="start" icon={trashOutline} />
                Clear
              </IonButton>
              <IonButton onClick={() => setPassword("")} title="Forget the password">
                <IonIcon slot="icon-only" icon={lockOpenOutline} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {password === "" ? <PasswordGate /> : <VoiceSession key={sessionKey} password={password} />}
      </IonContent>

      <IonFooter>
        <IonToolbar>
          <div className="usage-meter">
            <div>
              <strong>${usd.toFixed(4)}</strong>
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
          <IonButtons slot="end">
            <IonButton onClick={resetUsage} title="Reset the running total">
              <IonIcon slot="icon-only" icon={refreshOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonFooter>
    </IonPage>
  );
}
