import { defineConfig } from "vitest/config";

// Tauri expects a fixed dev port and no auto-open. The test block is vitest's:
// the core suites run on plain node, no DOM, no tauri.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
