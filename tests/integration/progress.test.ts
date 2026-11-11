import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type ApiEnv, change, getProgress, localDeps, putProgress, script, starter, upload } from "@/lib/api";
import { local } from "../support/cf";
import { deck } from "../support/deck.mjs";

let cf: Awaited<ReturnType<typeof local>>;
let env: ApiEnv;
let id: string;
beforeAll(async () => {
  cf = await local();
  env = { DB: cf.db, FILES: cf.files };
  const waits: Promise<unknown>[] = [];
  const res = await upload(new Request("https://x.test/", { method: "POST", body: deck([
    { title: "Bread", notes: ["Mix 500 grams of flour.", "Add water."], section: "Baking" }, { title: "End" }]) }), env,
  starter(env, localDeps(env, { STANDINS: "1" }), (p) => waits.push(p), 0));
  id = (await res.json() as { id: string }).id;
  await Promise.all(waits);
});
afterAll(async () => { await cf.mf.dispose(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const answer = async (res: Response): Promise<[number, any]> => [res.status, await res.json()];
const patch = (body: unknown) => new Request("https://x.test/", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) });
const put = (body: unknown) => new Request("https://x.test/", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("the talk's date and title", () => {
  test("set, cleared, and bad changes refused", async () => {
    const [code, s] = await answer(await change(patch({ title: " Bread talk ", talkAt: 1794682800000 }), env, id, 7));
    expect(code).toBe(200);
    expect(s).toMatchObject({ title: "Bread talk", talkAt: 1794682800000, updated: 7 });
    expect((await answer(await change(patch({ talkAt: null }), env, id)))[1]).toMatchObject({ talkAt: null, title: "Bread talk" });
    expect(await answer(await change(patch({ title: " ", talkAt: "soon" }), env, id))).toEqual([400, { error: "Send a title or a talk date." }]);
    expect(await answer(await change(patch("{nope"), env, id))).toEqual([400, { error: "Not JSON." }]);
    expect(await answer(await change(patch({ title: "x" }), env, "nope"))).toEqual([404, { error: "No such talk." }]);
  });
});

describe("the script", () => {
  test("each slide with its image and sentences, with clips and must-say items", async () => {
    const [code, s] = await answer(await script(env, id));
    expect(code).toBe(200);
    expect(s.talk).toMatchObject({ id, status: "ready", glossary: [] });
    expect(s.slides.map((x: { n: number; title: string; image: string }) => [x.n, x.title, x.image])).toEqual([
      [1, "Bread", expect.stringMatching(new RegExp(`^/api/files/talks/${id}/slides/1\\.png\\?v=\\d+$`))],
      [2, "End", expect.stringMatching(new RegExp(`^/api/files/talks/${id}/slides/2\\.png\\?v=\\d+$`))]]);
    expect(s.slides[0].sentences[0]).toMatchObject({ i: 1, text: "Mix 500 grams of flour.", must_say: ["500"] });
    expect(s.slides[0].sentences[1].clip).toMatch(/^\/api\/files\/clips\/[0-9a-f]{64}\.wav$/);
    expect(s.slides[1].sentences).toEqual([]);
    // the notes' two paragraphs: the second sentence starts one
    expect([s.slides[0].paras, s.slides[1].paras]).toEqual([[0, 1], [0]]);
    // the deck's section, kept with each slide
    expect([s.slides[0].section, s.slides[1].section]).toEqual(["Baking", "Baking"]);
    await cf.db.prepare("UPDATE sentences SET clip_key = NULL WHERE talk = ? AND i = 2").bind(id).run();
    await cf.db.prepare("UPDATE slides SET image_key = NULL WHERE talk = ? AND n = 2").bind(id).run();
    const again = (await (await script(env, id)).json()) as { slides: { image: string | null; sentences: { clip: string | null }[] }[] };
    expect([again.slides[0].sentences[1].clip, again.slides[1].image]).toEqual([null, null]);
    expect(await answer(await script(env, "nope"))).toEqual([404, { error: "No such talk." }]);
  });
});

describe("progress", () => {
  test("nothing saved, then saves merged: the newer card wins, days join, the sender's settings win", async () => {
    expect(await answer(await getProgress(env, id))).toEqual([200, { items: {}, saved: null }]);
    expect(await answer(await putProgress(put({ items: {} }), env, id, 5))).toEqual([200, { items: {}, saved: 5 }]);
    const first = { "train:1:1:aaa": { level: 2, last: 10 }, "train:days": ["2026-11-08"], "train:log:2026-11-08": { n: 1, got: 1 } };
    await putProgress(put({ items: first }), env, id, 100);
    const second = { "train:1:1:aaa": { level: 1, last: 5 }, "train:1:2:bbb": { level: 0, last: 20 }, "train:days": ["2026-11-09"],
      "train:log:2026-11-08": { n: 2, got: 1 } };
    const [code, merged] = await answer(await putProgress(put({ items: second }), env, id, 200));
    const want = { "train:1:1:aaa": { level: 2, last: 10 }, "train:1:2:bbb": { level: 0, last: 20 },
      "train:days": ["2026-11-08", "2026-11-09"], "train:log:2026-11-08": { n: 2, got: 1 } };
    expect([code, merged]).toEqual([200, { items: want, saved: 200 }]);
    expect(await answer(await getProgress(env, id))).toEqual([200, { items: want, saved: 200 }]);
    // the same again writes nothing
    await putProgress(put({ items: want }), env, id, 300);
    expect(await answer(await getProgress(env, id))).toEqual([200, { items: want, saved: 200 }]);
    // the clock defaults to now
    expect(((await (await putProgress(put({ items: {} }), env, id)).json()) as { saved: number }).saved).toBeGreaterThan(1e12);
  });

  test("bad saves are refused", async () => {
    expect(await answer(await getProgress(env, "nope"))).toEqual([404, { error: "No such talk." }]);
    expect(await answer(await putProgress(put({ items: {} }), env, "nope"))).toEqual([404, { error: "No such talk." }]);
    expect(await answer(await putProgress(put("{nope"), env, id))).toEqual([400, { error: "Not JSON." }]);
    for (const bad of [null, {}, { items: [] }, { items: 3 }]) {
      expect(await answer(await putProgress(put(bad), env, id))).toEqual([400, { error: "items are needed." }]);
    }
    expect(await answer(await putProgress(put("x".repeat(1024 * 1024 + 1)), env, id))).toEqual([413, { error: "Too large." }]);
  });
});
