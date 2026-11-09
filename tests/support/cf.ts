// Local D1 and R2 through Wrangler's platform proxy (workerd, as in a deployed Worker), in memory, with the
// migrations applied.
import { readdirSync, readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";

export async function local() {
  const proxy = await getPlatformProxy<{ DB: D1Database; FILES: R2Bucket }>({
    configPath: "tests/support/wrangler.test.jsonc", persist: false,
  });
  const db = proxy.env.DB, files = proxy.env.FILES;
  for (const f of readdirSync("migrations").sort()) {
    const sql = readFileSync(`migrations/${f}`, "utf8").replace(/--.*$/gm, "");
    await db.batch(sql.split(";").map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
  }
  return { mf: proxy, db, files };
}
