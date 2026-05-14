import { defineConfig } from "vite";

export default defineConfig({
  root: "viewer",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/events": "http://127.0.0.1:8787"
    }
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
