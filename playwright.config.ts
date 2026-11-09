import { defineConfig, devices } from "@playwright/test";

// A made-up password for the tests only. To test a preview build instead of `next dev`, set E2E_BASE_URL and
// E2E_PASSWORD to the preview's address and its BETA_PASSWORD from .dev.vars.
export const PASSWORD = process.env.E2E_PASSWORD ?? "test-only-password";
const PORT = 3100;
const BASE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE ?? `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: BASE ? undefined : {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    env: { BETA_PASSWORD: PASSWORD },
    timeout: 120000,
  },
});
