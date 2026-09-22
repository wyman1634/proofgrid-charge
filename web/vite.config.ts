import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  base: process.env.GITHUB_ACTIONS ? "/proofgrid-charge/" : "/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
