import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { lockOpenOutline, trashOutline } from "ionicons/icons";
import { useState } from "react";

import AstroOverlay from "../components/astro/AstroOverlay.tsx";
import PasswordGate from "../components/PasswordGate.tsx";
import VoiceSession from "../components/VoiceSession.tsx";
import { setPassword, usePassword } from "../lib/password.ts";
import { usageToUsd, useVoiceUsage } from "../lib/voice-usage.ts";

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
  const usd = usageToUsd(useVoiceUsage());

  return (
    <>
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Astro</IonTitle>
            {password !== "" && (
              <IonButtons slot="end">
                {/* The total only; the breakdown and the reset are in the transcript sheet. */}
                <IonNote className="voice-cost" title="Spent so far">
                  ${usd.toFixed(4)}
                </IonNote>
                <IonButton
                  onClick={() => setSessionKey((key) => key + 1)}
                  title="Clear the conversation"
                >
                  <IonIcon slot="icon-only" icon={trashOutline} />
                </IonButton>
                <IonButton onClick={() => setPassword("")} title="Forget the password">
                  <IonIcon slot="icon-only" icon={lockOpenOutline} />
                </IonButton>
              </IonButtons>
            )}
          </IonToolbar>
        </IonHeader>

        {/* `VoiceSession` brings its own content, footer bar and transcript sheet: the
            generated app is the whole page, and the conversation is something you open. */}
        {password === "" ? (
          <IonContent className="ion-padding">
            <PasswordGate />
          </IonContent>
        ) : (
          <VoiceSession key={sessionKey} password={password} />
        )}
      </IonPage>

      {/*
       * The character is drawn over this page, not inside it, and whether or not the
       * password is in place: a phone can be handed over and the WebGL path checked in
       * the WebView with no Gateway key and no socket. He is in the bottom-right corner,
       * and the layer is `pointer-events: none`, so nothing underneath him stops working.
       * The page keeps that corner clear: the footer bar packs its buttons to the left.
       */}
      <AstroOverlay />
    </>
  );
}
