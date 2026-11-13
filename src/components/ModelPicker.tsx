import { IonInput, IonText } from "@ionic/react";
import { useState } from "react";

import { VIEW_MODEL_IDS, VIEW_MODEL_INFO, type ViewModelId } from "../../shared/view-models.ts";
import { api } from "../lib/api.ts";
import { setViewModel, useViewModel } from "../lib/view-model.ts";

/**
 * Picks the model that builds and edits the pages (Settings → Modelo).
 *
 * Changing it always asks for the password, every time — even though the app already holds it
 * from the unlock screen. The typed password is checked by the Worker (`POST /api/auth`) and
 * the choice is saved only if that succeeds, so a phone left unlocked on the table cannot
 * switch the app to a model that costs several times as much.
 */
export default function ModelPicker() {
  const current = useViewModel();
  const [pending, setPending] = useState<ViewModelId | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const cancel = () => {
    setPending(null);
    setValue("");
    setError(null);
  };

  const choose = (id: ViewModelId) => {
    // Tapping the model already in use just closes any open password prompt.
    if (id === current) return cancel();
    setPending(id);
    setValue("");
    setError(null);
  };

  const confirm = async () => {
    if (pending == null) return;
    if (value.length === 0) {
      setError("Digite a senha para trocar o modelo.");
      return;
    }

    setChecking(true);
    setError(null);
    // No `finally`: the React Compiler cannot lower it, so every path clears `checking` itself.
    let ok = false;
    try {
      ok = (await api.auth.$post({ json: { password: value } })).ok;
    } catch {
      setChecking(false);
      setError("Não foi possível verificar a senha. Confira a conexão.");
      return;
    }

    setChecking(false);
    if (!ok) {
      setError("Senha incorreta.");
      return;
    }
    setViewModel(pending);
    cancel();
  };

  return (
    <div className="model-picker">
      <div className="model-picker__options">
        {VIEW_MODEL_IDS.map((id) => {
          const selected = id === current;
          const info = VIEW_MODEL_INFO[id];
          return (
            <button
              key={id}
              type="button"
              className={`apple-liquid-glass-pill apple-liquid-glass-pill--dark model-picker__option${selected ? " apple-liquid-glass-btn--active" : ""}`}
              aria-pressed={selected}
              onClick={() => choose(id)}
            >
              <span className="model-picker__label">{info.label}</span>
              <span className="model-picker__hint">{info.hint}</span>
            </button>
          );
        })}
      </div>

      {pending != null && (
        <form
          className="model-picker__unlock"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <IonText className="model-picker__ask">
            <p>
              Digite a senha para trocar para <strong>{VIEW_MODEL_INFO[pending].label}</strong>.
            </p>
          </IonText>

          <IonInput
            className="password-gate__input"
            fill="outline"
            label="Senha"
            labelPlacement="stacked"
            placeholder="Senha compartilhada"
            type="password"
            value={value}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="go"
            onIonInput={(event) => {
              setValue(event.detail.value ?? "");
              setError(null);
            }}
          />

          {error != null && (
            <IonText color="danger" className="password-gate__error">
              <p>{error}</p>
            </IonText>
          )}

          <div className="model-picker__actions">
            <button
              type="button"
              className="apple-liquid-glass-pill apple-liquid-glass-pill--dark"
              onClick={cancel}
              disabled={checking}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="apple-liquid-glass-pill apple-liquid-glass-pill--primary"
              disabled={checking}
            >
              {checking ? "Verificando…" : "Confirmar"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
