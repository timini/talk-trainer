import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type Attempt, judge } from "@/lib/judgeApi";

// Each judged attempt is kept for 14 days in KV under debug/, for replaying when the judge seems wrong.
const KEEP = 14 * 24 * 60 * 60;

export async function POST(request: Request) {
  const env = { GEMINI_KEY: process.env.GEMINI_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL, STANDINS: process.env.STANDINS };
  let record: ((a: Attempt) => void) | undefined;
  try {
    const { env: cf, ctx } = getCloudflareContext();
    const kv = (cf as unknown as { FILES_KV?: KVNamespace }).FILES_KV;
    if (kv) {
      record = (a) => ctx.waitUntil(kv.put(`debug/${a.at}-${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(a),
        { expirationTtl: KEEP }).catch(() => {}));
    }
  } catch { /* outside a Worker: nothing is kept */ }
  return judge(request, env, Date.now(), record);
}
