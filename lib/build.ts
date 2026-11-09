// The background build of an uploaded talk: read the deck, write its slides and sentences, render the slide images,
// voice each sentence, then mark the talk ready. Each stage is a step that can be retried on its own; in production
// a Cloudflare Workflow runs the steps (workers/build.ts), and in local development they run in the request.

import { unzipSync } from "fflate";
import { parseDeck } from "./pptx";
import { glossary, mustSay, sentences } from "./text";
import { clipKey, sha256 } from "./tts";

export type Deps = {
  db: D1Database;
  files: R2Bucket;
  // The deck to images: a zip of PNGs, one a slide, named with the slide number. null: no renderer here.
  render: ((deck: ReadableStream) => Promise<Uint8Array>) | null;
  // One sentence to a WAV clip.
  speak: (text: string) => Promise<Uint8Array>;
  now?: () => number;
};

// Runs one named step and returns its result, which must be plain JSON.
export type Step = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export type Talk = {
  id: string; title: string; status: string; deck_key: string; slides: number; sentences: number; images: number;
  voiced: number; glossary: string; error: string | null; created: number; updated: number;
};

const time = (deps: Deps) => (deps.now ?? Date.now)();

export const log = (deps: Deps, talk: string, step: string, message: string) =>
  deps.db.prepare("INSERT INTO build_log (talk, at, step, message) VALUES (?, ?, ?, ?)")
    .bind(talk, time(deps), step, message).run();

const update = (deps: Deps, talk: string, fields: Record<string, string | number | null>) => {
  const names = Object.keys(fields);
  return deps.db.prepare(`UPDATE talks SET ${names.map((n) => `${n} = ?`).join(", ")}, updated = ? WHERE id = ?`)
    .bind(...names.map((n) => fields[n]), time(deps), talk).run();
};

const talkRow = async (deps: Deps, talk: string) => {
  const row = await deps.db.prepare("SELECT * FROM talks WHERE id = ?").bind(talk).first<Talk>();
  if (!row) throw new Error(`No talk ${talk}.`);
  return row;
};

const deck = async (deps: Deps, row: Talk) => {
  const obj = await deps.files.get(row.deck_key);
  if (!obj) throw new Error("The uploaded deck is missing.");
  return obj;
};

// Read the deck and write its slides and sentences, replacing any from an earlier run.
export const parse = async (deps: Deps, talk: string) => {
  const row = await talkRow(deps, talk);
  await update(deps, talk, { status: "parsing" });
  const slides = parseDeck(new Uint8Array(await (await deck(deps, row)).arrayBuffer()));
  if (!slides.length) throw new Error("The deck has no slides.");
  const rows = await Promise.all(slides.map(async (s) => ({
    ...s, sentences: await Promise.all(sentences(s.notes).map(async (text) =>
      ({ text, hash: (await sha256(text)).slice(0, 12), must: mustSay(text) }))),
  })));
  const db = deps.db;
  await db.batch([
    db.prepare("DELETE FROM sentences WHERE talk = ?").bind(talk),
    db.prepare("DELETE FROM slides WHERE talk = ?").bind(talk),
    ...rows.map((s) => db.prepare("INSERT INTO slides (talk, n, title, notes) VALUES (?, ?, ?, ?)").bind(talk, s.n, s.title, s.notes)),
    ...rows.flatMap((s) => s.sentences.map((x, i) => db.prepare(
      "INSERT INTO sentences (talk, slide, i, text, hash, must_say) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(talk, s.n, i + 1, x.text, x.hash, JSON.stringify(x.must)))),
  ]);
  const count = rows.reduce((a, s) => a + s.sentences.length, 0);
  const names = glossary(rows.map((s) => ({ must_say: [], sentences: s.sentences.map((x) => x.text) })));
  await update(deps, talk, { status: "rendering", slides: rows.length, sentences: count, images: 0, voiced: 0,
    glossary: JSON.stringify(names) });
  const silent = rows.filter((s) => !s.sentences.length).map((s) => s.n);
  await log(deps, talk, "parse", `${rows.length} slides, ${count} sentences.`
    + (silent.length ? ` Slides with no notes: ${silent.join(", ")}.` : ""));
  return { slides: rows.length, sentences: count };
};

// Render the slide images and store one PNG a slide.
export const render = async (deps: Deps, talk: string) => {
  const row = await talkRow(deps, talk);
  if (!deps.render) {
    await log(deps, talk, "render", "No renderer is set up here, so the slides have no images.");
    await update(deps, talk, { status: "voicing" });
    return 0;
  }
  const zip = unzipSync(await deps.render((await deck(deps, row)).body));
  const pngs = Object.keys(zip).filter((k) => /\d+\.png$/i.test(k))
    .sort((a, b) => Number(/(\d+)\.png$/i.exec(a)![1]) - Number(/(\d+)\.png$/i.exec(b)![1]));
  const n = Math.min(pngs.length, row.slides);
  for (let k = 0; k < n; k += 1) {
    const key = `talks/${talk}/slides/${k + 1}.png`;
    await deps.files.put(key, zip[pngs[k]], { httpMetadata: { contentType: "image/png" } });
    await deps.db.prepare("UPDATE slides SET image_key = ? WHERE talk = ? AND n = ?").bind(key, talk, k + 1).run();
  }
  await update(deps, talk, { status: "voicing", images: n });
  await log(deps, talk, "render", pngs.length === row.slides ? `${n} slide images.`
    : `${pngs.length} images for ${row.slides} slides: the first ${n} are used.`);
  return n;
};

// The sentences still without a clip, as [slide, i].
export const unvoiced = async (deps: Deps, talk: string) => (await deps.db
  .prepare("SELECT slide, i FROM sentences WHERE talk = ? AND clip_key IS NULL ORDER BY slide, i").bind(talk)
  .all<{ slide: number; i: number }>()).results.map((r) => [r.slide, r.i] as [number, number]);

// Voice one sentence, or reuse the clip of the same text, and count the talk's clips.
export const voice = async (deps: Deps, talk: string, slide: number, i: number) => {
  const row = await deps.db.prepare("SELECT text FROM sentences WHERE talk = ? AND slide = ? AND i = ?")
    .bind(talk, slide, i).first<{ text: string }>();
  if (!row) throw new Error(`No sentence ${slide}.${i}.`);
  const key = await clipKey(row.text);
  const reused = !!(await deps.files.head(key));
  if (!reused) await deps.files.put(key, await deps.speak(row.text), { httpMetadata: { contentType: "audio/wav" } });
  await deps.db.batch([
    deps.db.prepare("UPDATE sentences SET clip_key = ? WHERE talk = ? AND slide = ? AND i = ?").bind(key, talk, slide, i),
    deps.db.prepare("UPDATE talks SET voiced = (SELECT COUNT(*) FROM sentences WHERE talk = ? AND clip_key IS NOT NULL), "
      + "updated = ? WHERE id = ?").bind(talk, time(deps), talk),
  ]);
  return reused;
};

export const finish = async (deps: Deps, talk: string) => {
  const row = await talkRow(deps, talk);
  await update(deps, talk, { status: "ready", error: null });
  await log(deps, talk, "finish", `Ready: ${row.voiced} of ${row.sentences} sentences voiced.`);
  return true;
};

// The whole build, step by step. A step that still fails after its retries marks the talk failed, with the reason.
export const build = async (deps: Deps, talk: string, step: Step) => {
  try {
    await step("parse", () => parse(deps, talk));
    await step("render", () => render(deps, talk));
    for (const [slide, i] of await step("list sentences", () => unvoiced(deps, talk))) {
      await step(`voice ${slide}.${i}`, () => voice(deps, talk, slide, i));
    }
    await step("finish", () => finish(deps, talk));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await update(deps, talk, { status: "failed", error: message });
    await log(deps, talk, "failed", message);
    throw err;
  }
};

// Steps run in the request: each tried up to 3 times, waiting a little longer each time.
export const inline = (wait = 1000): Step => async (name, fn) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, wait * attempt));
    }
  }
};
