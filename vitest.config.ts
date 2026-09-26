import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      thresholds: { lines: 85, functions: 90, branches: 75, statements: 85 },
    },
  },
});
