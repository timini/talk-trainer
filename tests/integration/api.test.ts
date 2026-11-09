import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { type ApiEnv, file, LIMIT, list, localDeps, starter, status, upload } from "@/lib/api";
import * as standins from "@/lib/standins";
import { local } from "../support/cf";
import { deck } from "../support/deck.mjs";

let cf: Awaited<ReturnType<typeof local>>;
let env: ApiEnv;
beforeAll(async () => { cf = await local(); env = { DB: cf.db, FILES: cf.files }; });
afterAll(async () => { await cf.mf.dispose(); });

const DECK = deck([{ title: "One", notes: ["Hello there.", "We use example.io daily."] }, { title: "Two" }]);
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("https://x.test/api/talks", { method: "POST", body, headers });
const answer = async (res: Response) => [res.status, await res.json()];

describe("upload", () => {
  test("stores the deck, creates the talk and starts its build", async () => {
    const started: string[] = [];
    const res = await upload(post(DECK, { "X-Title": encodeURIComponent("My talk: café") }), env,
      async (id) => { started.push(id); }, 5);
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect(started).toEqual([id]);
    const talk = await cf.db.prepare("SELECT * FROM talks WHERE id = ?").bind(id).first();
    expect(talk).toMatchObject({ title: "My talk: café", status: "queued", deck_key: `talks/${id}/deck.pptx`, created: 5 });
    const stored = await cf.files.get(`talks/${id}/deck.pptx`);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(DECK);
    expect(stored!.httpMetadata!.contentType).toMatch(/presentationml/);
  });

  test("a title not encoded, or none, and the clock by default", async () => {
    const none = async () => undefined;
    const a = await (await upload(post(DECK, { "X-Title": "100% done" }), env, none)).json() as { id: string };
    const b = await (await upload(post(DECK), env, none)).json() as { id: string };
    const titles = await cf.db.prepare("SELECT id, title, created FROM talks WHERE id IN (?, ?)").bind(a.id, b.id).all();
    expect(Object.fromEntries(titles.results.map((r) => [r.id, r.title]))).toEqual({ [a.id]: "100% done", [b.id]: "Untitled talk" });
    expect(titles.results[0].created).toBeGreaterThan(1e12);
  });

  test("an empty body, a file that is not a deck, or one too large is refused", async () => {
    const none = async () => undefined;
    expect(await answer(await upload(post(null), env, none))).toEqual([400, { error: "Choose a .pptx deck to upload." }]);
    expect(await answer(await upload(post("hello"), env, none))).toEqual([400, { error: "That file is not a .pptx deck." }]);
    expect(await answer(await upload(post("PX"), env, none))).toEqual([400, { error: "That file is not a .pptx deck." }]);
    expect(await answer(await upload(post(DECK, { "Content-Length": String(LIMIT + 1) }), env, none)))
      .toEqual([413, { error: "The deck is over 100 MB." }]);
    const big = { headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(LIMIT + 1) } as unknown as Request;
    expect(await answer(await upload(big, env, none))).toEqual([413, { error: "The deck is over 100 MB." }]);
  });
});

describe("starting a build", () => {
  test("as a Workflow when there is one", async () => {
    const create = vi.fn(async () => ({}));
    await starter({ ...env, BUILD: { create } }, null, () => {})("t1");
    expect(create).toHaveBeenCalledWith({ id: "t1", params: { talk: "t1" } });
  });

  test("in the request otherwise, after the reply; a failure is recorded, not thrown", async () => {
    const id = await (await (await upload(post(DECK), env, async () => undefined)).json() as { id: string }).id;
    const waits: Promise<unknown>[] = [];
    await starter(env, localDeps(env, { STANDINS: "1" }), (p) => waits.push(p), 0)(id);
    await Promise.all(waits);
    const s = await (await status(env, id)).json() as Record<string, unknown>;
    expect(s).toMatchObject({ status: "ready", slides: 2, sentences: 2, images: 2, voiced: 2, glossary: ["example.io"],
      noNotes: [2] });
    expect((s.log as { message: string }[]).map((l) => l.message)).toEqual(
      ["2 slides, 2 sentences. Slides with no notes: 2.", "2 slide images.", "Ready: 2 of 2 sentences voiced."]);
    const failing: Promise<unknown>[] = [];
    await starter(env, localDeps(env, { STANDINS: "1" }), (p) => failing.push(p), 0)("missing");
    await expect(Promise.all(failing)).resolves.toEqual([undefined]);
  });

  test("local dependencies: stand-ins, or Gemini and no renderer", async () => {
    const real = localDeps(env, { GEMINI_KEY: "k" });
    expect(real.render).toBeNull();
    expect(localDeps(env, { STANDINS: "1" }).speak).toBe(standins.speak);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(real.speak("Hi.")).rejects.toThrow("Gemini answered 500");
    vi.unstubAllGlobals();
    expect(() => localDeps(env, {}).speak("Hi.")).toThrow("GEMINI_KEY is not set.");
  });
});

describe("reading talks and files", () => {
  test("the list, newest first, and an unknown talk", async () => {
    const { talks } = await (await list(env)).json() as { talks: { created: number; title: string }[] };
    expect(talks.length).toBeGreaterThan(2);
    expect(talks.map((t) => t.created)).toEqual([...talks.map((t) => t.created)].sort((a, b) => b - a));
    expect(await answer(await status(env, "nope"))).toEqual([404, { error: "No such talk." }]);
  });

  test("a stored file, whole or a byte range, and a missing one", async () => {
    await cf.files.put("clips/test.wav", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { httpMetadata: { contentType: "audio/wav" } });
    const whole = await file(new Request("https://x.test/"), env, "clips/test.wav");
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Content-Type")).toBe("audio/wav");
    expect(whole.headers.get("Content-Length")).toBe("10");
    expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const part = await file(new Request("https://x.test/", { headers: { Range: "bytes=2-4" } }), env, "clips/test.wav");
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]));
    await cf.files.put("plain", new Uint8Array([1]));
    expect((await file(new Request("https://x.test/"), env, "plain")).headers.get("Content-Type")).toBe("application/octet-stream");
    expect(await answer(await file(new Request("https://x.test/"), env, "nope"))).toEqual([404, { error: "Not found." }]);
  });
});
