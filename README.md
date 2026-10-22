# Astro

A voice-to-voice conversation with xAI's Grok voice model that can also _draw_:
ask for something visual and a coding agent builds a live web page next to the
conversation while you keep talking.

One Cloudflare Worker serves both halves — a Hono API and a React 19 (Ionic)
SPA from static assets. The same client bundle is packaged for Android by
Capacitor. `vp` is the whole toolchain: package manager, dev server, test
runner, linter, formatter.

## Get it running (three steps)

```sh
vp install                      # deps, pinned runtime and all
cp .dev.vars.example .dev.vars  # then fill in the two values, see below
vp dev                          # prints a local URL — open it
```

The app opens on a password gate. Type whatever you set as `APP_PASSWORD`.
Then hold the mic button and talk.

### The two secrets

Both live in `.dev.vars`, which is gitignored. `.dev.vars.example` is the
template.

| name                 | what it is                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_GATEWAY_API_KEY` | A [Vercel AI Gateway](https://vercel.com/ai-gateway) key. Mints the realtime voice token and runs the page-building agent. The Gateway needs a card on file before it answers at all. |
| `APP_PASSWORD`       | Any non-empty string. Not real auth — it stops a stranger who finds the public URL from opening voice sessions on your card.                                                          |

The deployed Worker gets the same two names as secrets:

```sh
pnpm exec wrangler secret put AI_GATEWAY_API_KEY
pnpm exec wrangler secret put APP_PASSWORD
```

> **Voice bills by wall-clock time, not by speech.** An idle open socket costs
> the same as a conversation, which is why the footer shows a running meter and
> the session hangs itself up when the tab is hidden or after two minutes of
> silence. Those guards are the point, not a bug.

## Everyday commands

`vp` is the front door. Built-in commands run directly; anything in
`package.json` runs through `vp run <name>`.

| command                   | does                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `vp dev`                  | Worker + SPA on one origin, hot reloaded                           |
| `vp check`                | format, lint and type check (`--fix` to apply)                     |
| `vp test`                 | Vitest, both projects (plain Node and real workerd)                |
| `vp build`                | production build into `dist/`                                      |
| `vp preview`              | serve the built output                                             |
| `vp run deploy`           | build, then `wrangler deploy`                                      |
| `vp run cf-typegen`       | regenerate `worker-configuration.d.ts` after a binding change      |
| `vp run db:generate`      | new Drizzle migration from the schema                              |
| `vp run db:migrate:local` | apply migrations to the local D1 (optional — nothing reads D1 yet) |

Use `pnpx`, not `npx` — `npx` fails on this repo's pnpm `devEngines` pin.

## Android

Needs a JDK (21 works), the Android SDK, and a device with USB debugging on or
a running emulator.

```sh
vp run cap:run     # builds the native bundle, syncs it, installs, launches
```

That is the only command you need — `cap run` syncs on its own. The reason it
is wrapped in a script is the _web_ build in front of it: `vp build --mode
capacitor` bakes the deployed Worker's absolute URL into the bundle, because
inside the app there is no Worker on the origin. A plain `vp build` bakes a
relative path instead, and an app built from that reaches nothing.

Reinstall (not just re-sync) after anything that changes the Android manifest —
a new permission only takes effect in a freshly installed APK:

```sh
vp run cap:run                        # simplest: it reinstalls
cd android && ./gradlew installDebug  # or just the install
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The `android/` project is committed on purpose. It carries the `RECORD_AUDIO`
declaration the microphone needs; regenerating the platform with `cap add`
would silently drop it.

## Layout

```
src/        the SPA (Ionic + React 19, React Compiler on)
worker/     the Hono API and the page-building agent
shared/     code both sides import — Zod schemas, realtime constants, view rules
drizzle/    D1 schema and migrations
android/    the Capacitor project
disciplina/ coursework for ENG4030 (PUC-Rio), in Portuguese — not code
```

`disciplina/` holds what the course asks for (MVP planning, deliverable
drafts), kept next to the code it is about. Nothing in it is built or shipped;
see `disciplina/README.md`.

`AGENTS.md` is the file to read before changing anything: it lists the traps
this codebase has already fallen into.
