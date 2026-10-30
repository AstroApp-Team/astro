/**
 * CSS for the palette pane, as a string.
 *
 * The Studio mounts its UI inside `#theatrejs-studio-root` with
 * `attachShadow({mode:'open'})`, and a pane's node lives in that shadow root.
 * Shadow DOM is a style boundary: `studio.css`, Ionic's global CSS and every
 * design token in the app stop at the boundary. A pane that relies on them
 * renders as unstyled buttons in the top-left corner of its panel.
 *
 * So the stylesheet travels with the pane: `mountShapePalettePane()` writes this
 * into a `<style>` element inside the pane's own node, and the rules apply
 * exactly as long as the pane exists.
 *
 * Class names are prefixed `astro-pane-` for the same reason the file exists —
 * inside the shadow root the Studio's own styled-components class names are in
 * play, and `.pane` / `.toolbar` are taken.
 */
export const PANE_CSS = `
.astro-pane {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 10px 12px;
  color: #e2e8f0;
  font:
    400 12px/1.5 ui-sans-serif,
    system-ui,
    sans-serif;
  overflow: auto;
  background: #0f172a;
}

.astro-pane * {
  box-sizing: border-box;
}

.astro-pane__title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
}

.astro-pane__title code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #64748b;
}

.astro-pane__row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.astro-pane button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid rgb(148 163 184 / 32%);
  border-radius: 7px;
  background: #1e293b;
  color: #e2e8f0;
  font: inherit;
  cursor: pointer;
}

.astro-pane button:hover:not(:disabled) {
  border-color: #38bdf8;
}

.astro-pane button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.astro-pane__field {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #94a3b8;
}

.astro-pane select,
.astro-pane input {
  padding: 5px 7px;
  border: 1px solid rgb(148 163 184 / 32%);
  border-radius: 6px;
  background: #1e293b;
  color: #e2e8f0;
  font: inherit;
}

.astro-pane__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.astro-pane__shape {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid rgb(148 163 184 / 20%);
  border-radius: 8px;
  background: rgb(30 41 59 / 65%);
}

.astro-pane__shape-key {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #cbd5e1;
}

.astro-pane__shape-kind {
  color: #7dd3fc;
  font-weight: 600;
}

.astro-pane__status {
  margin: 0;
  padding: 6px 8px;
  border-left: 2px solid #38bdf8;
  background: rgb(56 189 248 / 8%);
  color: #cbd5e1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.astro-pane__empty {
  margin: 0;
  color: #64748b;
}

/* The Save readout: a path and a timestamp, so it reads as a file, not a toast. */
.astro-pane__hint {
  margin: 0;
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}

.astro-pane__hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #94a3b8;
}
`;
