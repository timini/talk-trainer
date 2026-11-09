// The route handlers, with getCloudflareContext giving local D1 and R2: under next dev there is no Workflow binding,
// so a build runs in the request.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { local } from "../support/cf";
import { deck } from "../support/deck.mjs";

const ctx = vi.hoisted(() => ({ env: {} as Record<string, unknown>, waits: [] as Promise<unknown>[] }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: ctx.env, ctx: { waitUntil: (p: Promise<unknown>) => ctx.waits.push(p) } }),
}));

const talks = await import("@/app/api/talks/route");
const one = await import("@/app/api/talks/[id]/route");
const files = await import("@/app/api/files/[...key]/route");
const grade = await import("@/app/api/grade/route");
const scriptRoute = await import("@/app/api/talks/[id]/script/route");
const progressRoute = await import("@/app/api/talks/[id]/progress/route");

let cf: Awaited<ReturnType<typeof local>>;
beforeAll(async () => {
  cf = await local();
  ctx.env = { DB: cf.db, FILES: cf.files };
  vi.stubEnv("STANDINS", "1");
});
afterAll(async () => { vi.unstubAllEnvs(); await cf.mf.dispose(); });

describe("the talk routes", () => {
  test("upload, build in the request, poll, list and fetch a slide image", async () => {
    const res = await talks.POST(new Request("https://x.test/api/talks", { method: "POST",
      body: deck([{ title: "Hi", notes: ["Hello there."] }]), headers: { "X-Title": "Route test" } }));
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    await Promise.all(ctx.waits);
    const s = await one.GET(new Request(`https://x.test/api/talks/${id}`), { params: Promise.resolve({ id }) });
    expect(await s.json()).toMatchObject({ title: "Route test", status: "ready", voiced: 1, images: 1 });
    const all = await (await talks.GET()).json() as { talks: { id: string }[] };
    expect(all.talks.map((t) => t.id)).toContain(id);
    const img = await files.GET(new Request("https://x.test/"), { params: Promise.resolve({ key: ["talks", id, "slides", "1.png"] }) });
    expect([img.status, img.headers.get("Content-Type")]).toEqual([200, "image/png"]);
    const params = { params: Promise.resolve({ id }) };
    const changed = await one.PATCH(new Request("https://x.test/", { method: "PATCH", body: JSON.stringify({ talkAt: 5 }) }), params);
    expect(await changed.json()).toMatchObject({ talkAt: 5 });
    const sc = await (await scriptRoute.GET(new Request("https://x.test/"), params)).json() as { slides: unknown[] };
    expect(sc.slides).toHaveLength(1);
    await progressRoute.PUT(new Request("https://x.test/", { method: "PUT", body: JSON.stringify({ items: { "train:days": ["2026-11-09"] } }) }), params);
    expect(await (await progressRoute.GET(new Request("https://x.test/"), params)).json()).toMatchObject({ items: { "train:days": ["2026-11-09"] } });
    const judged = await grade.POST(new Request("https://x.test/api/grade", { method: "POST",
      body: JSON.stringify({ mode: "card", audio: "QQ==", mime: "audio/webm", target: "Hello there." }) }));
    expect(await judged.json()).toMatchObject({ verbatim: true, heard: "Hello there." });
  });

  test("with a Workflow binding, the upload starts the Workflow", async () => {
    const create = vi.fn(async () => ({}));
    ctx.env = { DB: cf.db, FILES: cf.files, BUILD: { create } };
    const res = await talks.POST(new Request("https://x.test/api/talks", { method: "POST", body: deck([{ title: "W" }]) }));
    const { id } = await res.json() as { id: string };
    expect(create).toHaveBeenCalledWith({ id, params: { talk: id } });
  });
});
