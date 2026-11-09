// The talks API, behind the beta gate: upload a deck (which starts its build), list the talks, poll one talk's
// build, and serve stored files (slide images, voice clips) from R2.

import { build, type Deps, inline, type Talk } from "./build";
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
  voiced: t.voiced, error: t.error, created: t.created, updated: t.updated,
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
