import {
  IonButtons,
  IonContent,
  IonHeader,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { useEffect, useState } from "react";

import LiquidGlassIcon from "../components/LiquidGlassIcon.tsx";
import PasswordGate from "../components/PasswordGate.tsx";
import VoiceSession from "../components/VoiceSession.tsx";
import { useAstroStore } from "../lib/astro/store.ts";
import { setPassword, usePassword } from "../lib/password.ts";
import { useFullscreen } from "../lib/use-fullscreen.ts";
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
  const {
    fullscreen,
    enter: enterFullscreen,
    exit: exitFullscreen,
  } = useFullscreen(password !== "");

  useEffect(() => {
    useAstroStore.getState().setHidden(fullscreen);
    return () => useAstroStore.getState().setHidden(false);
  }, [fullscreen]);

  return (
    <IonPage>
      {!fullscreen && (
        <IonHeader className="astro-header">
          <IonToolbar className="astro-toolbar">
            <IonTitle className="astro-header__title">Astro</IonTitle>
            {password !== "" && (
              <IonButtons slot="end" className="astro-header__actions">
                {/* The total only; the breakdown and the reset are in the transcript sheet. */}
                <IonNote className="voice-cost" title="Gasto até agora">
                  ${usd.toFixed(4)}
                </IonNote>
                <button
                  type="button"
                  className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
                  onClick={enterFullscreen}
                  title="Tela cheia"
                  aria-label="Tela cheia"
                >
                  <LiquidGlassIcon name="fullscreen" size={17} />
                </button>
                <button
                  type="button"
                  className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
                  onClick={() => setSessionKey((key) => key + 1)}
                  title="Limpar conversa"
                  aria-label="Limpar conversa"
                >
                  <LiquidGlassIcon name="trash" size={17} />
                </button>
                <button
                  type="button"
                  className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
                  onClick={() => {
                    exitFullscreen();
                    setPassword("");
                  }}
                  title="Esquecer senha"
                  aria-label="Esquecer senha"
                >
                  <LiquidGlassIcon name="lock-open" size={17} />
                </button>
              </IonButtons>
            )}
          </IonToolbar>
        </IonHeader>
      )}

      {/* `VoiceSession` brings its own content, footer bar and transcript sheet: the
            generated app is the whole page, and the conversation is something you open. */}
      {password === "" ? (
        <IonContent className="ion-padding">
          <PasswordGate />
        </IonContent>
      ) : (
        <VoiceSession
          key={sessionKey}
          password={password}
          fullscreen={fullscreen}
          onExitFullscreen={exitFullscreen}
        />
      )}
    </IonPage>
  );
}
