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

import { USD_PER_SESSION_SECOND } from "../../shared/realtime.ts";
import AstroOverlay from "../components/astro/AstroOverlay.tsx";
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
    <>
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
          {password === "" ? (
            <PasswordGate />
          ) : (
            <VoiceSession key={sessionKey} password={password} />
          )}
        </IonContent>

        <IonFooter>
          <IonToolbar>
            <div className="usage-meter">
              <div>
                <strong>${usd.toFixed(4)}</strong>
                <IonNote> spent · {formatDuration(usage.seconds)} connected</IonNote>
              </div>
              <IonNote className="usage-meter__detail">
                {usage.sessions} session{usage.sessions === 1 ? "" : "s"} · $
                {(USD_PER_SESSION_SECOND * 60).toFixed(2)}/min while the session is open
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

      {/*
       * The character is drawn over this page, not inside it, and whether or not the
       * password is in place: a phone can be handed over and the WebGL path checked in
       * the WebView with no Gateway key and no socket. He is in the bottom-right corner,
       * and the layer is `pointer-events: none`, so nothing underneath him stops working.
       */}
      <AstroOverlay />
    </>
  );
}
