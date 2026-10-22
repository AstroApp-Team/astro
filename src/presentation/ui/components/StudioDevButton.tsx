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
 * production timeline.
 */
export default function StudioDevButton() {
  if (!import.meta.env.DEV) return null;

  const suffix = isDesktopBrowser() ? "" : " (desktop)";

  return (
    <nav className="studio-dev-links">
      <Link className="studio-dev-button" to="/rig/sting">
        {`Rig bench${suffix}`}
      </Link>
      <Link className="studio-dev-button" to="/studio-corner">
        {`Studio Corner${suffix}`}
      </Link>
    </nav>
  );
}
