import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteCommonjs } from "@originjs/vite-plugin-commonjs";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    viteCommonjs(),
    nodePolyfills({
      include: ["buffer", "process", "util", "crypto", "stream"],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @lumera-protocol/sdk-js depends on undici (Node-only HTTP client)
      // but only reaches for it in the non-browser branch of its own
      // getFetch() environment check — in a browser it uses window.fetch
      // and never touches undici. Vite follows that dynamic import
      // statically anyway and dies on undici's require('node:util/types'),
      // because the browser `util` polyfill ships no types subpath. This
      // alias resolves it to a stub that is never called.
      undici: path.resolve(__dirname, "./src/lib/undici-browser-stub.ts"),
    },
  },
  optimizeDeps: {
    // @bokuweb/zstd-wasm (pulled in by @lumera-protocol/sdk-js for the
    // Cascade upload) finds its own WASM payload with
    //   new URL("./zstd.wasm", import.meta.url)
    // i.e. "the .wasm sitting next to this file". Vite's dependency
    // pre-bundler rewrites the JS into node_modules/.vite/deps/ but does
    // not copy zstd.wasm along with it, so that URL 404s, the dev server
    // answers the 404 with index.html, and WebAssembly.instantiate fails
    // with "expected magic word 00 61 73 6d, found 3c 21 64 6f" — 3c 21
    // 64 6f being the ASCII for "<!do", the start of <!doctype html>.
    // Excluding it from pre-bundling leaves it served from its real
    // directory, where the .wasm is genuinely adjacent.
    exclude: ["@bokuweb/zstd-wasm"],
  },

  build: {
    // Two entry points. index.html is the real app and carries the Midnight
    // SDK and its wasm; demo.html is a standalone replay of a recorded run
    // that imports none of it, so it loads instantly for anyone evaluating
    // the project without a wallet, DUST or a proof server.
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        demo: path.resolve(__dirname, "demo.html"),
      },
    },
    // esnext supports top-level await natively, which is why
    // vite-plugin-top-level-await is not in the plugin list: its 1.6.0
    // release (the latest) pins @swc/core ^1.12.14, and swc 1.16+ changed
    // its AST shape, so the plugin crashes the production build with
    // "missing field `type`". Keeping this target avoids needing it at all.
    target: "esnext",
    minify: false,
  },
});
