import { IonButtons, IonContent, IonHeader, IonPage, IonToolbar, useIonRouter } from "@ionic/react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import LiquidGlassIcon from "../components/LiquidGlassIcon.tsx";
import PasswordGate from "../components/PasswordGate.tsx";
import VoiceSession, { type VoiceSessionHandle } from "../components/VoiceSession.tsx";
import { useAstroStore } from "../lib/astro/store.ts";
import { usePassword } from "../lib/password.ts";
import { useFullscreen } from "../lib/use-fullscreen.ts";

export default function Voice() {
  /**
   * The realtime hook has no "clear messages" call — its state lives in a ref
   * inside the component. Bumping the key remounts the session, which disposes
   * the old store (closing the socket and the audio contexts) and builds an
   * empty one. The running cost total lives in localStorage, so clearing the
   * conversation does not clear the bill.
   */
  const [sessionKey, setSessionKey] = useState(0);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const sessionRef = useRef<VoiceSessionHandle>(null);
  const password = usePassword();
  const router = useIonRouter();
  const { pathname } = useLocation();
  const {
    fullscreen,
    enter: enterFullscreen,
    exit: exitFullscreen,
  } = useFullscreen(password !== "");

  const onVoiceRoute = pathname === "/voice" || pathname === "/";

  useEffect(() => {
    useAstroStore.getState().setHidden(fullscreen || !onVoiceRoute);
  }, [fullscreen, onVoiceRoute]);

  useEffect(() => () => useAstroStore.getState().setHidden(false), []);

  const toggleProjects = () => {
    if (!projectsOpen) sessionRef.current?.closeTranscript();
    setProjectsOpen((open) => !open);
  };

  const openSettings = () => {
    sessionRef.current?.closeTranscript();
    setProjectsOpen(false);
    router.push("/settings", "forward", "push");
  };

  return (
    <IonPage>
      {!fullscreen && (
        <IonHeader className="astro-header astro-header--compact">
          <IonToolbar className="astro-toolbar">
            {password !== "" && (
              <IonButtons slot="start" className="astro-header__start">
                <button
                  type="button"
                  className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
                  onClick={openSettings}
                  title="Configurações"
                  aria-label="Configurações"
                >
                  <LiquidGlassIcon name="settings" size={24} />
                </button>
                <button
                  type="button"
                  className={`apple-liquid-glass-btn apple-liquid-glass-btn--sm${projectsOpen ? " apple-liquid-glass-btn--active" : ""}`}
                  onClick={toggleProjects}
                  title={projectsOpen ? "Ocultar projetos" : "Projetos salvos"}
                  aria-label={projectsOpen ? "Ocultar projetos" : "Projetos salvos"}
                >
                  <LiquidGlassIcon
                    name="folder"
                    tone={projectsOpen ? "active" : "default"}
                    size={24}
                  />
                </button>
                <button
                  type="button"
                  className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
                  onClick={() => {
                    sessionRef.current?.closeTranscript();
                    setProjectsOpen(false);
                    enterFullscreen();
                  }}
                  title="Tela cheia"
                  aria-label="Tela cheia"
                >
                  <LiquidGlassIcon name="fullscreen" size={24} />
                </button>
                <button
                  type="button"
                  className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
                  onClick={() => {
                    setProjectsOpen(false);
                    setSessionKey((key) => key + 1);
                  }}
                  title="Limpar conversa"
                  aria-label="Limpar conversa"
                >
                  <LiquidGlassIcon name="trash" size={24} />
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
          projectsOpen={projectsOpen}
          onOpenTranscript={() => setProjectsOpen(false)}
          onCloseProjects={() => setProjectsOpen(false)}
          onExitFullscreen={exitFullscreen}
          sessionRef={sessionRef}
        />
      )}
    </IonPage>
  );
}
