import { IonIcon } from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { useEffect } from "react";

import type { ShowcasePanelEntry } from "./registry.ts";

import "@presentation/ui/styles/showcase-panels.css";

export type ShowcasePanelHostProps = {
  /** The registry entry to render, or null for nothing mounted. */
  entry: ShowcasePanelEntry | null;
  onClose(): void;
};

/**
 * The sheet a showcase panel sits on.
 *
 * The page resolves a cube's `theatreKey` to an entry and hands it here; this
 * component owns the chrome (title, close button, Escape, the scrim) and the
 * panel owns everything inside `.showcase-panel__body`. That split is what keeps
 * the four panels independent: none of them draws a header, and the page does not
 * know what any of them contains.
 *
 * The title is the cube's label, read off the entry — the same word the card in
 * the scene paints.
 */
export default function ShowcasePanelHost({ entry, onClose }: ShowcasePanelHostProps) {
  /**
   * Escape closes the panel.
   *
   * Registered only while something is open: a global keydown listener mounted on
   * a page that scrolls over a WebGL canvas is a listener that fires on every key
   * press for the whole life of the route.
   */
  useEffect(() => {
    if (entry == null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entry, onClose]);

  if (entry == null) return null;

  const Panel = entry.Panel;

  return (
    /**
     * A native `<dialog open>`, not a `div role="dialog"`: jsx-a11y wants the
     * semantic tag, and the tag is the honest one here. This sheet is not modal — it
     * traps no focus, the scene keeps playing behind it, and the band above it stays
     * tappable.
     */
    <dialog open className="showcase-panel" aria-label={`${entry.title} panel`}>
      {/** The scrim swallows taps in the lower half of the scene while a panel is
          open, which is the point: a tap there should close the sheet, not open a
          different one. The upper band — where the scene and the sphere live — is
          outside the scrim and stays tappable. */}
      <button
        type="button"
        className="showcase-panel__scrim"
        aria-label="Close panel"
        onClick={onClose}
      />

      <header className="showcase-panel__head">
        <h2>{entry.title}</h2>
        <button
          type="button"
          className="showcase-panel__close"
          aria-label="Close panel"
          onClick={onClose}
        >
          <IonIcon icon={closeOutline} />
        </button>
      </header>

      <div className="showcase-panel__body">
        <Panel onClose={onClose} />
      </div>
    </dialog>
  );
}
