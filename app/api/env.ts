import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type ApiEnv, localDeps, starter } from "@/lib/api";
import { filesOf } from "@/lib/kvfiles";

// The Cloudflare bindings, and how to start a build: the Workflow in a deployed Worker, or in the request when
// there is no Workflow binding or BUILD_INLINE is "1" (as under next dev).
export const cloudflare = () => {
  const { env, ctx } = getCloudflareContext();
  const raw = env as unknown as ApiEnv & { FILES_KV?: unknown };
  const api: ApiEnv = { ...raw, FILES: filesOf(raw) };
  const here = process.env.BUILD_INLINE === "1" || !api.BUILD;
  return { env: api, start: starter(api, here ? localDeps(api, { STANDINS: process.env.STANDINS, GEMINI_KEY: process.env.GEMINI_KEY }) : null, (p) => ctx.waitUntil(p)) };
};
