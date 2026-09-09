// vitest/config re-exports vite's defineConfig, so this stays the build config too.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // The layout tests measure a jsPDF document; no DOM is involved.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});