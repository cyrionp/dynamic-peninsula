import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Tauri reads the built frontend from ../dist
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "esnext",
    emptyOutDir: true,
    // Two pages: the peninsula, and the taskbar dock's own window.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        dock: fileURLToPath(new URL("dock.html", import.meta.url)),
      },
    },
  },
});
