// The talks API, behind the beta gate: upload a deck (which starts its build), list the talks, poll one talk's
// build, and serve stored files (slide images, voice clips) from R2.

import { build, type Deps, inline, type Talk } from "./build";
import { merge } from "./schedule";
import * as standins from "./standins";
import { speak } from "./tts";

// The largest deck accepted. The build reads the whole deck into memory to unzip it, so it has to fit in a Worker.
export const LIMIT = 100 * 1024 * 1024;
export const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type ApiEnv = { DB: D1Database; FILES: R2Bucket; BUILD?: { create(o: { id: string; params: { talk: string } }): Promise<unknown> } };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// How a build starts: as a Workflow when there is one and inline mode is off; otherwise in this request, after the
// reply (waitUntil), with the given dependencies.
export const starter = (env: ApiEnv, local: Deps | null, waitUntil: (p: Promise<unknown>) => void, wait?: number) =>
  async (talk: string) => {
    if (!local) {
      await env.BUILD!.create({ id: talk, params: { talk } });
      return;
    }
    waitUntil(build(local, talk, inline(wait)).catch(() => undefined));
  };

// The dependencies of a build run in the request: no renderer (that needs the container), and Gemini for the
// voice; or stand-ins for both when STANDINS is "1".
export const localDeps = (env: ApiEnv, vars: { STANDINS?: string; GEMINI_KEY?: string }): Deps => ({
  db: env.DB,
  files: env.FILES,
  render: vars.STANDINS === "1" ? standins.render : null,
  speak: vars.STANDINS === "1" ? standins.speak : (text) => {
    if (!vars.GEMINI_KEY) throw new Error("GEMINI_KEY is not set.");
    return speak(vars.GEMINI_KEY, text);
  },
});

const titleOf = (raw: string | null, fallback: string) => {
  let t = raw ?? "";
  try { t = decodeURIComponent(t); } catch { /* sent unencoded */ }
  return t.trim().slice(0, 200) || fallback;
};

// POST /api/talks: the deck as the body, its title in X-Title (URI-encoded). Stores the deck, creates the talk and
// starts its build. 201 {id}.
export const upload = async (request: Request, env: ApiEnv, start: (talk: string) => Promise<void>, now = Date.now()) => {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > LIMIT) return json(413, { error: "The deck is over 100 MB." });
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length) return json(400, { error: "Choose a .pptx deck to upload." });
  if (body.length > LIMIT) return json(413, { error: "The deck is over 100 MB." });
  // A .pptx is a zip, which starts PK.
  if (body[0] !== 0x50 || body[1] !== 0x4b) return json(400, { error: "That file is not a .pptx deck." });
  const id = crypto.randomUUID(), key = `talks/${id}/deck.pptx`;
  await env.FILES.put(key, body, { httpMetadata: { contentType: PPTX } });
  await env.DB.prepare("INSERT INTO talks (id, title, deck_key, created, updated) VALUES (?, ?, ?, ?, ?)")
    .bind(id, titleOf(request.headers.get("X-Title"), "Untitled talk"), key, now, now).run();
  await start(id);
  return json(201, { id });
};

const view = (t: Talk) => ({
  id: t.id, title: t.title, status: t.status, slides: t.slides, sentences: t.sentences, images: t.images,
  voiced: t.voiced, error: t.error, created: t.created, updated: t.updated, talkAt: t.talk_at,
});

// GET /api/talks: every talk, newest first.
export const list = async (env: ApiEnv) => {
  const { results } = await env.DB.prepare("SELECT * FROM talks ORDER BY created DESC").all<Talk>();
  return json(200, { talks: results.map(view) });
};

// GET /api/talks/:id: one talk's build, the slides with no notes, and the last 20 lines of its build log.
export const status = async (env: ApiEnv, id: string) => {
  const talk = await env.DB.prepare("SELECT * FROM talks WHERE id = ?").bind(id).first<Talk>();
  if (!talk) return json(404, { error: "No such talk." });
  const [silent, logs] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT n FROM slides s WHERE talk = ? AND NOT EXISTS "
      + "(SELECT 1 FROM sentences x WHERE x.talk = s.talk AND x.slide = s.n) ORDER BY n").bind(id),
    env.DB.prepare("SELECT at, step, message FROM build_log WHERE talk = ? ORDER BY id DESC LIMIT 20").bind(id),
  ]);
  return json(200, { ...view(talk), glossary: JSON.parse(talk.glossary), noNotes: silent.results.map((r) => r.n),
    log: logs.results.reverse() });
};

// GET /api/files/<key>: a stored file, with byte ranges so audio can seek. Keys are content hashes or per-talk
// paths, so a file never changes under its key.
export const file = async (request: Request, env: ApiEnv, key: string) => {
  const range = request.headers.get("Range");
  const obj = await env.FILES.get(key, range ? { range: request.headers } : undefined);
  if (!obj) return json(404, { error: "Not found." });
  const headers = new Headers({ "Cache-Control": "private, max-age=31536000, immutable", "Accept-Ranges": "bytes",
    ETag: obj.httpEtag, "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream" });
  const part = obj.range as { offset: number; length: number } | undefined;
  if (range && part) {
    headers.set("Content-Range", `bytes ${part.offset}-${part.offset + part.length - 1}/${obj.size}`);
    headers.set("Content-Length", String(part.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
};

const talkOf = (env: ApiEnv, id: string) => env.DB.prepare("SELECT * FROM talks WHERE id = ?").bind(id).first<Talk>();

// PATCH /api/talks/:id: {title?, talkAt? (ms, or null)}.
export const change = async (request: Request, env: ApiEnv, id: string, now = Date.now()) => {
  if (!(await talkOf(env, id))) return json(404, { error: "No such talk." });
  let body: { title?: unknown; talkAt?: unknown };
  try { body = await request.json(); } catch { return json(400, { error: "Not JSON." }); }
  const fields: Record<string, string | number | null> = {};
  if (typeof body.title === "string" && body.title.trim()) fields.title = body.title.trim().slice(0, 200);
  if (body.talkAt === null || (typeof body.talkAt === "number" && Number.isFinite(body.talkAt))) fields.talk_at = body.talkAt;
  const names = Object.keys(fields);
  if (!names.length) return json(400, { error: "Send a title or a talk date." });
  await env.DB.prepare(`UPDATE talks SET ${names.map((n) => `${n} = ?`).join(", ")}, updated = ? WHERE id = ?`)
    .bind(...names.map((n) => fields[n]), now, id).run();
  return status(env, id);
};

// GET /api/talks/:id/script: what the trainer needs: the talk, and each slide with its image and its sentences,
// each with its voice clip and must-say items. File addresses are under /api/files/.
export const script = async (env: ApiEnv, id: string) => {
  const talk = await talkOf(env, id);
  if (!talk) return json(404, { error: "No such talk." });
  const [slides, sentences] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT n, title, image_key FROM slides WHERE talk = ? ORDER BY n").bind(id),
    env.DB.prepare("SELECT slide, i, text, hash, clip_key, must_say FROM sentences WHERE talk = ? ORDER BY slide, i").bind(id),
  ]);
  const file = (key: unknown) => (key ? `/api/files/${key}` : null);
  return json(200, {
    talk: { id: talk.id, title: talk.title, status: talk.status, talkAt: talk.talk_at, glossary: JSON.parse(talk.glossary) },
    slides: slides.results.map((s) => ({ n: s.n, title: s.title, image: file(s.image_key),
      sentences: sentences.results.filter((x) => x.slide === s.n).map((x) => ({ i: x.i, text: x.text, hash: x.hash,
        clip: file(x.clip_key), must_say: JSON.parse(x.must_say as string) })) })),
  });
};

const PROGRESS_LIMIT = 1024 * 1024;

const saved = async (env: ApiEnv, id: string) => {
  const { results } = await env.DB.prepare("SELECT card, state, updated FROM progress WHERE talk = ?").bind(id)
    .all<{ card: string; state: string; updated: number }>();
  return { items: Object.fromEntries(results.map((r) => [r.card, JSON.parse(r.state)])) as Record<string, unknown>,
    saved: results.reduce((a, r) => Math.max(a, r.updated), 0) || null };
};

// GET /api/talks/:id/progress: the talk's saved progress, {items, saved (ms or null)}: the same keys the trainer
// keeps in the browser (cards, practice days, the day's log).
export const getProgress = async (env: ApiEnv, id: string) => {
  if (!(await talkOf(env, id))) return json(404, { error: "No such talk." });
  return json(200, await saved(env, id));
};

// PUT /api/talks/:id/progress {items}: merged into the saved copy (the newer review of each card wins, practice
// days are joined, and for anything else the sender's value wins), and the merge answered, {items, saved}.
export const putProgress = async (request: Request, env: ApiEnv, id: string, now = Date.now()) => {
  if (!(await talkOf(env, id))) return json(404, { error: "No such talk." });
  const text = await request.text();
  if (text.length > PROGRESS_LIMIT) return json(413, { error: "Too large." });
  let body: { items?: unknown };
  try { body = JSON.parse(text); } catch { return json(400, { error: "Not JSON." }); }
  if (!body || !body.items || typeof body.items !== "object" || Array.isArray(body.items)) {
    return json(400, { error: "items are needed." });
  }
  const items = merge(body.items as Record<string, unknown>, (await saved(env, id)).items);
  const rows = Object.entries(items);
  if (rows.length) {
    await env.DB.batch(rows.map(([k, v]) => env.DB.prepare("INSERT INTO progress (talk, card, state, updated) VALUES (?, ?, ?, ?) "
      + "ON CONFLICT (talk, card) DO UPDATE SET state = excluded.state, updated = excluded.updated").bind(id, k, JSON.stringify(v), now)));
  }
  return json(200, { items, saved: now });
};
