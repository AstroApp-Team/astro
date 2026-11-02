import { Link } from "react-router-dom";

import { isDesktopBrowser } from "@infra/native/PlatformService.ts";

/**
 * Dev-only links to the two Theatre.js surfaces.
 *
 * Rendered when `import.meta.env.DEV`, so the production transform removes the
 * whole component from the Capacitor bundle. The routes themselves are
 * registered in production as well — a route that only exists in dev is a route
 * nobody has seen fail.
 *
 * On a phone the label says so: the routes work, the Theatre.js panel does not
 * load there, and a button that promises a panel it will never show is worse
 * than a button that admits it.
 *
 * `/rig/<scene>` is the one to use for a new animation: it mounts the real
 * scene on the real sheet, so the export needs no key rename. `/studio-corner`
 * is the isolated sandbox — rig there when you want a clip that cannot touch a
 * production timeline. `/showcase` is the other side of the same rig: the scene
 * with a scrolling page over it and no Studio, i.e. what the end user gets.
 * `/float` is the inversion: a plain page with a transparent canvas over it.
 * `/surface` is the third arrangement: React pages rasterized into mesh textures.
 */
export default function StudioDevButton() {
  if (!import.meta.env.DEV) return null;

  const suffix = isDesktopBrowser() ? "" : " (desktop)";

  return (
    <nav className="studio-dev-links">
      <Link className="studio-dev-button" to="/rig/sting">
        {`Rig bench${suffix}`}
      </Link>
      <Link className="studio-dev-button" to="/showcase/sting">
        Showcase
      </Link>
      <Link className="studio-dev-button" to="/float">
        Float overlay
      </Link>
      <Link className="studio-dev-button" to="/astro">
        Astro overlay
      </Link>
      <Link className="studio-dev-button" to="/astro-v2">
        Astro v2
      </Link>
      <Link className="studio-dev-button" to="/machine">
        Machine
      </Link>
      <Link className="studio-dev-button" to="/editor?editor">
        Machine editor
      </Link>
      <Link className="studio-dev-button" to="/surface">
        Page textures
      </Link>
      <Link className="studio-dev-button" to="/studio-corner">
        {`Studio Corner${suffix}`}
      </Link>
    </nav>
  );
}
