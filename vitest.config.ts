import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Dates are local days, so the tests run in one time zone: London, which is on UTC in November.
process.env.TZ = "Europe/London";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    env: { TZ: "Europe/London" },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      reporter: ["text", "html"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
