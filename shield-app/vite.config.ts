/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { outDir: "dist", sourcemap: true },
  test: {
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
