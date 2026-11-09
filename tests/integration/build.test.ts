import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { build, type Deps, finish, inline, parse, render, unvoiced, voice } from "@/lib/build";
import * as standins from "@/lib/standins";
import { clipKey } from "@/lib/tts";
import { local } from "../support/cf";
import { deck } from "../support/deck.mjs";

let env: Awaited<ReturnType<typeof local>>;
beforeAll(async () => { env = await local(); });
afterAll(async () => { await env.mf.dispose(); });

const SLIDES = [
  { title: "Welcome", notes: ["Good morning, and thank you for coming.", "Today we bake bread at example.io."] },
  { title: "Flour and water", notes: ["Mix 500 grams of flour with 350 grams of water."] },
  { title: "Questions", body: ["Thank you"] },
];

let n = 0;
// A talk with its deck stored, as an upload leaves it.
const talk = async (slides = SLIDES) => {
  const id = `t${(n += 1)}`;
  await env.files.put(`talks/${id}/deck.pptx`, deck(slides));
  await env.db.prepare("INSERT INTO talks (id, title, deck_key, created, updated) VALUES (?, 'A talk', ?, 1, 1)")
    .bind(id, `talks/${id}/deck.pptx`).run();
  return id;
};
const row = (id: string) => env.db.prepare("SELECT * FROM talks WHERE id = ?").bind(id).first<Record<string, unknown>>();
const logs = async (id: string) => (await env.db.prepare("SELECT step, message FROM build_log WHERE talk = ? ORDER BY id")
  .bind(id).all<{ step: string; message: string }>()).results;

const deps = (over: Partial<Deps> = {}): Deps & { spoken: string[] } => {
  const spoken: string[] = [];
  return { db: env.db, files: env.files, render: standins.render, now: () => 42,
    speak: async (text) => { spoken.push(text); return standins.speak(text); }, spoken, ...over };
};

describe("the build", () => {
  test("reads the deck, renders, voices every sentence and is ready", async () => {
    const id = await talk(), d = deps();
    await build(d, id, inline(0));
    expect(await row(id)).toMatchObject({ status: "ready", slides: 3, sentences: 3, images: 3, voiced: 3, error: null,
      glossary: '["example.io"]', updated: 42 });
    const sentences = (await env.db.prepare("SELECT slide, i, text, hash, clip_key, must_say FROM sentences WHERE talk = ? "
      + "ORDER BY slide, i").bind(id).all()).results;
    expect(sentences.map((s) => [s.slide, s.i, s.text, s.must_say])).toEqual([
      [1, 1, "Good morning, and thank you for coming.", "[]"],
      [1, 2, "Today we bake bread at example.io.", '["example.io"]'],
      [2, 1, "Mix 500 grams of flour with 350 grams of water.", '["500","350"]'],
    ]);
    expect(sentences[0].hash).toMatch(/^[0-9a-f]{12}$/);
    expect(sentences[0].clip_key).toBe(await clipKey("Good morning, and thank you for coming."));
    const slides = (await env.db.prepare("SELECT n, title, notes, image_key FROM slides WHERE talk = ? ORDER BY n").bind(id).all()).results;
    expect(slides.map((s) => [s.n, s.title, s.image_key])).toEqual([[1, "Welcome", `talks/${id}/slides/1.png`],
      [2, "Flour and water", `talks/${id}/slides/2.png`], [3, "Questions", `talks/${id}/slides/3.png`]]);
    expect(new Uint8Array(await (await env.files.get(`talks/${id}/slides/2.png`))!.arrayBuffer())).toEqual(standins.PNG);
    const clip = await env.files.get(sentences[2].clip_key as string);
    expect(clip!.httpMetadata!.contentType).toBe("audio/wav");
    expect(d.spoken.length).toBe(3);
    expect((await logs(id)).map((l) => l.message)).toEqual(["3 slides, 3 sentences. Slides with no notes: 3.",
      "3 slide images.", "Ready: 3 of 3 sentences voiced."]);
  });

  test("a sentence voiced before is not voiced again", async () => {
    const d = deps();
    await build(d, await talk([{ title: "Again", notes: ["Good morning, and thank you for coming.", "Something new."] }]), inline(0));
    expect(d.spoken).toEqual(["Something new."]);
  });

  test("a rebuild replaces the slides and sentences, and only unvoiced sentences are listed", async () => {
    const id = await talk(), d = deps();
    await build(d, id, inline(0));
    expect(await unvoiced(d, id)).toEqual([]);
    expect(await parse(d, id)).toEqual({ slides: 3, sentences: 3 });
    expect(await unvoiced(d, id)).toEqual([[1, 1], [1, 2], [2, 1]]);
    expect(await voice(d, id, 1, 1)).toBe(true);
  });

  test("without a renderer the slides have no images; images that do not match the slides are counted", async () => {
    const id = await talk();
    await build(deps({ render: null }), id, inline(0));
    expect(await row(id)).toMatchObject({ status: "ready", images: 0 });
    expect((await logs(id))[1].message).toBe("No renderer is set up here, so the slides have no images.");
    const two = await talk();
    const d = deps({ render: async (s) => { const z = await standins.render(s); return z; } });
    await parse(d, two);
    const { zipSync } = await import("fflate");
    expect(await render({ ...d, render: async () => zipSync({ "b/slide-10.png": standins.PNG, "a/slide-2.png": standins.PNG,
      "notes.txt": new Uint8Array(1) }) }, two)).toBe(2);
    expect((await logs(two)).at(-1)!.message).toBe("2 images for 3 slides: the first 2 are used.");
  });

  test("a step that keeps failing fails the talk with the reason; a passing retry does not", async () => {
    const id = await talk([{ title: "Fresh", notes: ["A sentence never voiced before."] }]);
    let tries = 0;
    const d = deps({ speak: async () => { tries += 1; throw new Error("Gemini answered 429: slow down"); } });
    await expect(build(d, id, inline(0))).rejects.toThrow("Gemini answered 429");
    expect(tries).toBe(3);
    expect(await row(id)).toMatchObject({ status: "failed", error: "Gemini answered 429: slow down" });
    expect((await logs(id)).at(-1)).toEqual({ step: "failed", message: "Gemini answered 429: slow down" });
    let once = 0;
    expect(await inline(1)("x", async () => { once += 1; if (once < 2) throw new Error("again"); return "done"; })).toBe("done");
    // a failure that is not an Error is recorded as text
    const odd = await talk([{ title: "Fresh", notes: ["Another sentence never voiced."] }]);
    await expect(build(deps({ speak: () => Promise.reject("plain") }), odd, inline(0))).rejects.toBe("plain");
    expect(await row(odd)).toMatchObject({ status: "failed", error: "plain" });
  });

  test("missing pieces are clear errors", async () => {
    const d = deps();
    await expect(parse(d, "nope")).rejects.toThrow("No talk nope.");
    await expect(finish(d, "nope")).rejects.toThrow("No talk nope.");
    const gone = await talk();
    await env.files.delete(`talks/${gone}/deck.pptx`);
    await expect(parse(d, gone)).rejects.toThrow("The uploaded deck is missing.");
    await expect(parse(d, await talk([]))).rejects.toThrow("The deck has no slides.");
    await expect(voice(d, gone, 9, 9)).rejects.toThrow("No sentence 9.9.");
    // the clock defaults to now
    const id = await talk();
    await parse({ ...d, now: undefined }, id);
    expect((await row(id))!.updated).toBeGreaterThan(1e12);
  });
});
