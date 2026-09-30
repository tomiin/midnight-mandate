/**
 * Build-time stub for `undici`, which is never used in a browser.
 *
 * @lumera-protocol/sdk-js depends on undici (a Node-only HTTP client) and
 * reaches for it in exactly one place — dist/esm/internal/http.js's
 * getFetch():
 *
 *     const isBrowser = typeof window !== "undefined"
 *       && typeof window.fetch === "function";
 *     if (isBrowser) { this.fetchImpl = window.fetch.bind(window); }
 *     else { const { fetch } = await import("undici"); ... }
 *
 * In a browser the first branch always wins, so undici is never executed.
 * Vite's bundler doesn't know that: it follows the dynamic import
 * statically, tries to bundle undici, and fails on undici's
 * `require('node:util/types')` — the browser `util` polyfill package ships
 * util.js only, with no types subpath.
 *
 * Aliasing undici to this file (see ui/vite.config.ts) resolves the import
 * to something trivial instead. If the Node branch is ever somehow
 * reached in a browser, the throw below says exactly what happened rather
 * than failing somewhere deep in a polyfill.
 */

export const fetch = (): never => {
  throw new Error(
    "undici is not available in the browser — the Lumera SDK should be using window.fetch here. " +
      "See ui/src/lib/undici-browser-stub.ts.",
  );
};

export default { fetch };
