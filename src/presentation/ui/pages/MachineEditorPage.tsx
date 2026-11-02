/**
 * `/editor` — the machine authoring workspace.
 *
 * Two gates, and both are deliberate:
 *
 * - **Development only.** The editor writes the definition file, and a production build has no
 *   write endpoint; the page refuses rather than loading a workspace whose Save button would
 *   silently do nothing.
 * - **`?editor`.** The route exists in every dev build, but opening the editor while reading
 *   something else is not a thing to stumble into: the query is the intent signal, the same way
 *   the Studio's Save is an explicit gesture.
 *
 * The route itself is registered unconditionally (a route that only exists in dev is a route
 * nobody has seen fail); the guard is inside the page.
 */

import { IonContent, IonPage } from "@ionic/react";

import { EditorApp } from "@presentation/ui/editor/App.tsx";

export default function MachineEditorPage() {
  const allowed = import.meta.env.DEV;
  const intended = new URL(globalThis.location.href).searchParams.has("editor");

  return (
    <IonPage>
      <IonContent className="ed-content" scrollY={false}>
        {!allowed ? (
          <p className="ed-empty">The machine editor is a development tool.</p>
        ) : !intended ? (
          <p className="ed-empty">
            Append <code>?editor</code> to edit the machine.
          </p>
        ) : (
          <EditorApp />
        )}
      </IonContent>
    </IonPage>
  );
}
