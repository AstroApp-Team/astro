/**
 * The `Astro` runtime every view runs on. Injected by `sealViewHtml` as a
 * classic script, after htm's Preact standalone build (which defines the
 * `htmPreact` global), so it executes inside the sandboxed frame — never in
 * the app. Plain JS because it ships as text: it is imported `?raw`.
 *
 * Why a runtime at all: a model writing a page as global variables plus DOM
 * pokes produces code where every feature touches every other one, and edits
 * pile up into contradictions. This fixes the page's shape instead:
 *
 *   Astro.state({...})           one plain object, the only thing that persists
 *   Astro.view((s, a) => html``) the whole screen as a function of it
 *   Astro.actions({ name(s, ...args) { mutate s } })
 *
 * Each goes in its own <script> so the view paints the moment its tag closes
 * while the page is still streaming in. The runtime re-renders after every
 * action, carries state across the frame reloads an edit causes, and — in
 * check mode — exercises the page and reports what broke.
 *
 * Message types are the literals from shared/view.ts; keep them in step.
 */
(() => {
  const { html, render, useState, useEffect, useRef } = window.htmPreact;

  /** Set by `sealViewHtml(html, { check: true })` on the hidden check frame. */
  const CHECK = window.__astroCheck === true;
  const SAVE_INTERVAL_MS = 200;

  let initial = {};
  let state = {};
  let hasState = false;
  let view = null;
  let after = null;
  let start = null;
  let restore = null;
  const raw = {};
  const bound = {};

  /** State posted back by the parent before `Astro.state` ran. */
  let pendingSaved;
  let renderQueued = false;
  let saveTimer = null;
  const errors = [];

  const post = (message) => {
    try {
      parent.postMessage(message, "*");
    } catch (error) {
      // A state with a function or DOM node in it cannot be cloned.
      reportError(error, "posting to the app");
    }
  };

  function reportError(error, where) {
    const message =
      (where ? `${where}: ` : "") + (error instanceof Error ? error.message : String(error));
    errors.push(message);
    if (!CHECK) post({ type: "astro:error", message: message.slice(0, 300) });
  }

  addEventListener("error", (event) => reportError(event.error ?? event.message));
  addEventListener("unhandledrejection", (event) => reportError(event.reason));

  /** Through JSON on purpose: state has to survive the parent's JSON check anyway. */
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const kind = (value) => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

  /**
   * Saved state may come from an older version of this page or from a
   * different page entirely. Keep the starting shape, and take a saved value
   * only where its key exists and its kind matches.
   */
  function merge(start, saved) {
    if (kind(saved) !== "object") return start;
    const next = { ...start };
    for (const key of Object.keys(start)) {
      if (key in saved && kind(saved[key]) === kind(start[key])) next[key] = saved[key];
    }
    return next;
  }

  function applySaved(saved) {
    try {
      state = restore ? restore(saved, clone(initial)) : merge(clone(initial), saved);
    } catch (error) {
      reportError(error, "Astro.restore");
      state = clone(initial);
    }
    schedule();
  }

  function root() {
    let node = document.getElementById("astro-root");
    if (node == null && document.body != null) {
      node = document.createElement("div");
      node.id = "astro-root";
      document.body.append(node);
    }
    return node;
  }

  function renderNow() {
    renderQueued = false;
    const node = root();
    if (view == null || node == null) return;
    try {
      render(view(state, bound), node);
    } catch (error) {
      reportError(error, "Astro.view");
      return;
    }
    if (after != null) {
      try {
        after(state, node);
      } catch (error) {
        reportError(error, "Astro.after");
      }
    }
  }

  function schedule() {
    if (renderQueued) return;
    renderQueued = true;
    if (document.body == null) {
      addEventListener("DOMContentLoaded", renderNow, { once: true });
    } else {
      queueMicrotask(renderNow);
    }
  }

  function save() {
    if (CHECK || saveTimer != null) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      post({ type: "astro:state", state });
    }, SAVE_INTERVAL_MS);
  }

  window.Astro = {
    html,
    useState,
    useEffect,
    useRef,

    state(value) {
      hasState = true;
      initial = clone(value ?? {});
      state = clone(initial);
      if (pendingSaved !== undefined) applySaved(pendingSaved);
      schedule();
    },

    view(fn) {
      view = fn;
      schedule();
    },

    actions(map) {
      for (const [name, fn] of Object.entries(map)) {
        raw[name] = fn;
        bound[name] = (...args) => {
          try {
            fn(state, ...args);
          } catch (error) {
            reportError(error, `action ${name}`);
          }
          schedule();
          save();
        };
      }
      schedule();
    },

    /** Runs after every render with the root node — for drawing on a canvas. */
    after(fn) {
      after = fn;
      schedule();
    },

    /** Runs once, after the page has loaded — for timers and game loops. */
    start(fn) {
      start = fn;
    },

    /** Custom migration of saved state: `(saved, initial) => state`. */
    restore(fn) {
      restore = fn;
    },

    /** Tell the voice assistant the user did something meaningful. */
    emit(name, value) {
      if (!CHECK) post({ type: "astro:event", name, value });
    },
  };
  window.html = html;

  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "astro:state") return;
    if (!hasState) {
      pendingSaved = event.data.state;
    } else {
      applySaved(event.data.state);
    }
  });

  addEventListener("load", () => {
    if (CHECK) {
      runCheck();
      return;
    }
    if (start != null) {
      try {
        start(bound);
      } catch (error) {
        reportError(error, "Astro.start");
      }
    }
  });

  /**
   * Renders the starting state, then runs every action that takes no
   * arguments from a fresh copy of it and renders again. Arity is what makes
   * this safe to automate: an action that needs arguments would throw on
   * `undefined` for reasons that are not bugs.
   */
  function runCheck() {
    const pageScripts = [...document.scripts].filter((s) => !s.hasAttribute("data-astro"));
    if (pageScripts.length > 0 && view == null) {
      errors.push(
        "The page has a script but never calls Astro.view(...) — everything on screen " +
          "must come from the view.",
      );
    }

    renderNow();
    for (const name of Object.keys(raw)) {
      if (raw[name].length > 1) continue;
      state = clone(initial);
      try {
        raw[name](state);
      } catch (error) {
        reportError(error, `action ${name}() from the starting state`);
        continue;
      }
      renderNow();
    }

    post({ type: "astro:check", problems: [...new Set(errors)].slice(0, 10) });
  }
})();
