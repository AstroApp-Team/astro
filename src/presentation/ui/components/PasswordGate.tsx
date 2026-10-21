import { IonButton, IonInput, IonNote, IonText } from "@ionic/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "@infra/api/httpClient.ts";
import { setPassword } from "@infra/api/credentialStore.ts";

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
      if (!res.ok) throw new Error("Wrong password");
      setPassword(password);
    },
  });

  return (
    <form
      className="password-gate"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.length > 0) unlock.mutate(value);
      }}
    >
      <IonNote>This app makes paid voice calls, so it is behind a shared password.</IonNote>

      <IonInput
        label="Password"
        labelPlacement="stacked"
        type="password"
        value={value}
        autocomplete="current-password"
        onIonInput={(event) => setValue(event.detail.value ?? "")}
      />

      <IonButton expand="block" type="submit" disabled={value.length === 0 || unlock.isPending}>
        {unlock.isPending ? "Checking…" : "Unlock"}
      </IonButton>

      {unlock.isError && (
        <IonText color="danger">
          <p>{unlock.error.message}</p>
        </IonText>
      )}
    </form>
  );
}
