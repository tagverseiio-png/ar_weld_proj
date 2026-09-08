import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the TanStack Start vite plugin crashes under
// vitest's bundled vite, so tests run with a minimal config (no Start plugin).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "backend/**/*.test.ts"],
    environment: "node",
  },
});
