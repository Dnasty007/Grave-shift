import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    // Dedicated port so this never silently falls through to other Vite apps (e.g. default 5173).
    port: 5733,
    strictPort: true
  },
  preview: {
    host: true,
    port: 5734
  }
});
