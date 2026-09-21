import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/**
 * Builds the render page into a static bundle.
 *
 * `base: "./"` matters: the page is served from an in-memory route table at
 * render time, not from a web root, so every asset reference has to be
 * relative.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./render-page", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist/render", import.meta.url)),
    emptyOutDir: true,
    target: "es2023",
  },
});
