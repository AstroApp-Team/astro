import { IonInput, IonNote, IonText } from "@ionic/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../lib/api.ts";
import { setPassword } from "../lib/password.ts";

/**
 * Checks the shared password before anything can open a billable session.
 * The Worker re-checks it on every request — this only exists so a wrong
 * password fails here instead of as an opaque WebSocket error.
 */
export default function PasswordGate() {
  const [value, setValue] = useState("");

  const unlock = useMutation({
    mutationFn: async (password: string) => {
      const res = await api.auth.$post({ json: { password } });
      if (!res.ok) throw new Error("Senha incorreta");
      setPassword(password);
    },
  });

  /*
   * `disabled` used to guard the empty field, and it read as "the button is broken": Ionic dims
   * a disabled button to a muted `--background` with dark text, and on the ink/orange palette
   * that pair is nearly invisible. A tap that does nothing is worse than a tap that explains
   * itself, so the button stays live and an empty submit says what is missing.
   */
  const [emptySubmit, setEmptySubmit] = useState(false);

  return (
    <form
      className="password-gate"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.length === 0) {
          setEmptySubmit(true);
          return;
        }
        setEmptySubmit(false);
        unlock.mutate(value);
      }}
    >
      <IonNote className="password-gate__note">
        Este aplicativo faz chamadas de voz pagas e é protegido por uma senha compartilhada.
      </IonNote>

      <IonInput
        className="password-gate__input"
        /* `fill="outline"` is what makes this look like a field. Ionic's modern input with no
           `fill` renders a floating label over a bare line — on a phone that reads as "there is
           no textbox here", which is exactly how the gate was reported. */
        fill="outline"
        label="Senha"
        labelPlacement="stacked"
        placeholder="Senha compartilhada"
        type="password"
        value={value}
        autocomplete="current-password"
        autocapitalize="off"
        spellcheck={false}
        enterkeyhint="go"
        onIonInput={(event) => {
          setValue(event.detail.value ?? "");
          setEmptySubmit(false);
        }}
      />

      <button
        className="apple-liquid-glass-pill apple-liquid-glass-pill--primary apple-liquid-glass-pill--block"
        type="submit"
        disabled={unlock.isPending}
      >
        {unlock.isPending ? "Verificando…" : "Desbloquear"}
      </button>

      {emptySubmit && (
        <IonText color="danger" className="password-gate__error">
          <p>Digite a senha compartilhada.</p>
        </IonText>
      )}

      {unlock.isError && (
        <IonText color="danger" className="password-gate__error">
          <p>{unlock.error.message}</p>
        </IonText>
      )}
    </form>
  );
}
