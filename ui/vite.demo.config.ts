import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Build for the public demo page only (demo.html). It imports no Midnight SDK
 * and no wasm, so it needs none of the polyfills the real app does. Output
 * goes to dist-demo/ with relative asset paths, so it works from any
 * sub-path, e.g. https://<user>.github.io/midnight-mandate/.
 *
 *   npx vite build -c vite.demo.config.ts
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: { demo: path.resolve(__dirname, "demo.html") },
    },
  },
});
