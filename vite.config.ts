/// <reference types="vitest" />
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  // "/" locally; the GitHub Pages workflow sets BASE_PATH (e.g. "/wca-rankings/").
  base: process.env.BASE_PATH ?? "/",
  plugins: [preact()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
