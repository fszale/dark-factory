import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "apps/web",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: "apps/web/index.html",
        benchmark: "apps/web/benchmark.html",
        atelier: "apps/web/atelier.html",
      },
    },
    chunkSizeWarningLimit: 2500,
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3000", ws: true } },
  },
});
