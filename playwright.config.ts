import { defineConfig, devices } from "@playwright/test";

// A made-up password for the tests only. To test a preview build instead of `next dev`, set E2E_BASE_URL and
// E2E_PASSWORD to the preview's address and its BETA_PASSWORD from .dev.vars.
export const PASSWORD = process.env.E2E_PASSWORD ?? "test-only-password";
const PORT = 3100;
const BASE = process.env.E2E_BASE_URL;
// A fake microphone (a tone), allowed without asking.
const MIC = { permissions: ["microphone"], launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } };

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE ?? `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...MIC } },
    { name: "phone", use: { ...devices["Pixel 7"], ...MIC } },
  ],
  webServer: BASE ? undefined : {
    // Local D1 with the migrations applied; builds run in the request with stand-ins for the renderer and voice.
    command: `npx wrangler d1 migrations apply DB --local && npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    env: { BETA_PASSWORD: PASSWORD, STANDINS: "1", BUILD_INLINE: "1" },
    timeout: 120000,
  },
});
