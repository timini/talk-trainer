import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// Lets `next dev` reach the Cloudflare bindings (D1, R2) through getCloudflareContext().
initOpenNextCloudflareForDev();
