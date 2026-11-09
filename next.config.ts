import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// No dev tools button: it sits over the bar at the bottom of the screen.
const nextConfig: NextConfig = { devIndicators: false };

export default nextConfig;

// Lets `next dev` reach the Cloudflare bindings (D1, R2) through getCloudflareContext().
initOpenNextCloudflareForDev();
