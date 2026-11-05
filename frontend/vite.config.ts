import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies the backend so the browser sees ONE origin.
// That keeps the HttpOnly refresh cookie (path /api/v1/auth) and the
// readable CSRF cookie working without CORS. Production must serve the
// SPA and the API under the same site for the same reason.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/static": { target: API_TARGET, changeOrigin: true },
    },
  },
});
