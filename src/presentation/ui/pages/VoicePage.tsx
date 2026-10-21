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

import { USD_PER_SESSION_SECOND } from "@shared/realtime.ts";
import { formatDuration, usageToUsd } from "@core/models/voiceUsage.ts";
import { setPassword } from "@infra/api/credentialStore.ts";
import { resetUsage, useVoiceUsage } from "@presentation/state/useVoiceUsageStore.ts";
import PasswordGate from "@presentation/ui/components/PasswordGate.tsx";
import StudioDevButton from "@presentation/ui/components/StudioDevButton.tsx";
import VoiceSession from "@presentation/ui/components/VoiceSession.tsx";
import { usePassword } from "@presentation/ui/hooks/usePassword.ts";

export default function VoicePage() {
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

        {/**
         * Dev-only. The route is registered in production too — a link that only
         * exists in dev is a route nobody has tested.
         */}
        <StudioDevButton />
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
  );
}
