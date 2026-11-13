import {
  IonButtons,
  IonContent,
  IonHeader,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
  useIonRouter,
  useIonViewWillEnter,
} from "@ionic/react";
import { useEffect } from "react";

import LiquidGlassIcon from "../components/LiquidGlassIcon.tsx";
import ModelPicker from "../components/ModelPicker.tsx";
import UsageMeter from "../components/UsageMeter.tsx";
import { useAstroStore } from "../lib/astro/store.ts";
import { setPassword, usePassword } from "../lib/password.ts";
import { setTheme, type Theme, useTheme } from "../lib/theme.ts";

const THEMES: { value: Theme; label: string; icon: "moon" | "sun" }[] = [
  { value: "dark", label: "Escuro", icon: "moon" },
  { value: "light", label: "Claro", icon: "sun" },
];

/**
 * Dedicated Settings screen holding accumulated spend controls and device
 * password management, kept off the main stage so the header stays uncluttered.
 */
export default function Settings() {
  const router = useIonRouter();
  const password = usePassword();
  const theme = useTheme();

  useEffect(() => {
    useAstroStore.getState().setHidden(true);
  }, []);

  useIonViewWillEnter(() => {
    useAstroStore.getState().setHidden(true);
  });

  const handleBack = () => {
    if (router.canGoBack()) {
      router.goBack();
    } else {
      router.push("/voice", "back", "replace");
    }
  };

  const handleForgetPassword = () => {
    setPassword("");
    handleBack();
  };

  return (
    <IonPage>
      <IonHeader className="astro-header">
        <IonToolbar className="astro-toolbar">
          <IonButtons slot="start" className="astro-header__start">
            <button
              type="button"
              className="apple-liquid-glass-btn apple-liquid-glass-btn--sm"
              onClick={handleBack}
              title="Voltar"
              aria-label="Voltar"
            >
              <LiquidGlassIcon name="arrow-back" size={24} />
            </button>
          </IonButtons>
          <IonTitle className="astro-header__title">Configurações</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="ion-padding settings-content">
        <div className="settings-layout">
          <section className="settings-card" aria-labelledby="settings-usage-title">
            <div className="settings-card__header">
              <h2 id="settings-usage-title" className="settings-card__title">
                Visor de gastos
              </h2>
              <IonNote className="settings-card__subtitle">
                Acompanhe o consumo acumulado de voz e criação de páginas neste dispositivo.
              </IonNote>
            </div>
            <UsageMeter />
          </section>

          <section className="settings-card" aria-labelledby="settings-theme-title">
            <div className="settings-card__header">
              <h2 id="settings-theme-title" className="settings-card__title">
                Aparência
              </h2>
              <IonNote className="settings-card__subtitle">
                Escolha o tema do app neste dispositivo.
              </IonNote>
            </div>
            <fieldset className="theme-switch" aria-label="Tema">
              {THEMES.map((option) => {
                const selected = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`apple-liquid-glass-pill apple-liquid-glass-pill--dark theme-switch__option${selected ? " apple-liquid-glass-btn--active" : ""}`}
                    aria-pressed={selected}
                    onClick={() => setTheme(option.value)}
                  >
                    <LiquidGlassIcon
                      name={option.icon}
                      tone={selected ? "active" : "default"}
                      size={22}
                    />
                    {option.label}
                  </button>
                );
              })}
            </fieldset>
          </section>

          <section className="settings-card" aria-labelledby="settings-model-title">
            <div className="settings-card__header">
              <h2 id="settings-model-title" className="settings-card__title">
                Modelo
              </h2>
              <IonNote className="settings-card__subtitle">
                O modelo que cria e edita as páginas. Trocar pede a senha.
              </IonNote>
            </div>
            <ModelPicker />
          </section>

          <section className="settings-card" aria-labelledby="settings-security-title">
            <div className="settings-card__header">
              <h2 id="settings-security-title" className="settings-card__title">
                Acesso e senha
              </h2>
              <IonNote className="settings-card__subtitle">
                {password !== ""
                  ? "Remove a senha salva neste navegador e retorna à tela de desbloqueio."
                  : "Nenhuma senha está salva neste dispositivo no momento."}
              </IonNote>
            </div>
            <button
              type="button"
              className="apple-liquid-glass-pill apple-liquid-glass-pill--ember apple-liquid-glass-pill--block"
              disabled={password === ""}
              onClick={handleForgetPassword}
            >
              <LiquidGlassIcon name="lock-open" tone="cream" size={20} />
              Esquecer senha
            </button>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
