import { Component, type ReactNode } from "react";

/**
 * Keeps a failed WebGL canvas from taking the page with it.
 *
 * `new WebGLRenderer()` throws when the browser has no usable WebGL context — a blocklisted GPU,
 * hardware acceleration turned off, a locked-down WebView. R3F builds the renderer inside the
 * `<Canvas>` subtree, so the exception propagates out of React and unmounts the whole tree: every
 * canvas route (`/float`, `/astro`, `/astro-v2`, `/surface`, `/rig/*`, `/showcase/*`) went **blank
 * white**, with the only explanation in the console.
 *
 * The boundary is scoped to the canvas on purpose. The page around it is plain DOM — it can still
 * render its text, its log and its buttons — so the app keeps working minus the 3D.
 */
interface Props {
  children: ReactNode;
  /** What could not be drawn, in the page's own words: "the sphere", "the character". */
  what: string;
}

interface State {
  error: Error | null;
}

export class CanvasBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error(`canvas failed: ${this.props.what}`, error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error == null) return this.props.children;
    return (
      <div className="canvas-fallback" role="alert">
        <p className="canvas-fallback__title">3D unavailable</p>
        <p className="canvas-fallback__body">
          {this.props.what} cannot be drawn because this browser has no usable WebGL context. The
          rest of the page still works.
        </p>
        <p className="canvas-fallback__detail mono">{error.message}</p>
      </div>
    );
  }
}
