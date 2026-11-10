import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// No dev tools button: it sits over the bar at the bottom of the screen.
const nextConfig: NextConfig = { devIndicators: false };

export default nextConfig;

// Lets `next dev` reach the Cloudflare bindings (D1, R2) through getCloudflareContext(). E2E_STATE: where the local D1
// and R2 are kept, so the browser tests start from an empty one each run (playwright.config.ts).
initOpenNextCloudflareForDev(process.env.E2E_STATE ? { persist: { path: process.env.E2E_STATE } } : undefined);
