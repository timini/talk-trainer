import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MODEL } from "@/lib/judge";
import { allowed, judge, LIMIT, RATE, standin } from "@/lib/judgeApi";

const ENV = { GEMINI_KEY: "k" };
const BODY = { mode: "card", audio: "QUJD", mime: "audio/webm", target: "We tried four of them.", glossary: ["CADD"], must: ["four"] };
const post = (body: unknown = BODY, headers: Record<string, string> = {}) => new Request("https://x.test/api/grade",
  { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const answer = async (res: Response) => [res.status, await res.json()];
let minute = 0;
const call = (req: Request, env: Parameters<typeof judge>[1] = ENV) => judge(req, env, (minute += 1) * 60000);

let calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
let replies: { status: number; body: unknown }[] = [];
const reply = (obj: unknown) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> });
    const r = replies.shift() ?? reply({ heard: "x" });
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the judge route", () => {
  test("a card: the clip, the sentence and the glossary go to Gemini, and its JSON comes back", async () => {
    const verdict = { heard: "We tried four of them.", meaning_ok: true, problems: [], clarity: 5, fluency: 5,
      pace: "good", tip: "Good." };
    replies.push(reply(verdict));
    expect(await answer(await call(post()))).toEqual([200, verdict]);
    const [{ url, body, headers }] = calls;
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`);
    expect(headers["x-goog-api-key"]).toBe("k");
    const [text, audio] = (body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(audio).toEqual({ inline_data: { mime_type: "audio/webm", data: "QUJD" } });
    expect(text.text).toMatch(/The target: We tried four of them\./);
    expect(text.text).toMatch(/Must be said exactly: four\./);
    expect(text.text).toMatch(/Names in this talk, spelled as they should be written: CADD\./);
    const config = body.generationConfig as { responseSchema: { required: string[] }; thinkingConfig: unknown };
    expect(config.responseSchema.required).toEqual(["heard", "meaning_ok", "problems", "clarity", "fluency", "pace", "tip"]);
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  test("a run-through has its own schema; GEMINI_MODEL picks the model", async () => {
    await call(post({ ...BODY, mode: "run" }), { ...ENV, GEMINI_MODEL: "gemini-9-flash" });
    expect(calls[0].url).toMatch(/models\/gemini-9-flash:generateContent$/);
    expect((calls[0].body.generationConfig as { responseSchema: { required: string[] } }).responseSchema.required)
      .toEqual(["pace", "unclear", "work_on"]);
  });

  test("no key: 503; the stand-in says the meaning came through", async () => {
    expect(await answer(await call(post(), {}))).toEqual([503, { error: "The judge is not set up on this site." }]);
    expect(await answer(await call(post(), { STANDINS: "1" }))).toEqual([200, standin(BODY)]);
    expect(standin(BODY)).toMatchObject({ heard: "We tried four of them.", meaning_ok: true, problems: [] });
    expect(standin({ mode: "run" })).toEqual({ pace: "Steady.", unclear: [], work_on: [] });
    expect(calls.length).toBe(0);
  });

  test("size, bad requests and bad replies", async () => {
    expect(await answer(await call(post(BODY, { "Content-Length": String(LIMIT + 1) })))).toEqual([413, { error: "The recording is too long." }]);
    expect(await answer(await call(post({ ...BODY, audio: "x".repeat(LIMIT) })))).toEqual([413, { error: "The recording is too long." }]);
    expect(await answer(await call(post("{nope")))).toEqual([400, { error: "Not JSON." }]);
    expect(await answer(await call(post({ ...BODY, audio: "" })))).toEqual([400, { error: "audio, mime and target are needed." }]);
    replies.push({ status: 500, body: "down" });
    expect(await answer(await call(post()))).toEqual([502, { error: "The judge answered 500." }]);
    replies.push({ status: 200, body: { candidates: [] } });
    expect(await answer(await call(post()))).toEqual([502, { error: "The judge's reply could not be read." }]);
  });

  test("the rate limit: so many a minute, then a new minute starts again", async () => {
    const t = 1e12;
    for (let i = 0; i < RATE; i += 1) expect(allowed(t)).toBe(true);
    expect(allowed(t + 1000)).toBe(false);
    expect(await answer(await judge(post(), ENV, t + 2000))).toEqual([429, { error: "Too many attempts in a minute. Wait a moment." }]);
    expect(allowed(t + 60000)).toBe(true);
    // the clock defaults to now
    expect((await judge(post(), ENV)).status).toBe(200);
  });
});

describe("recording attempts for debugging", () => {
  test("each judged attempt is recorded with its reply or error and how long Gemini took", async () => {
    const seen: unknown[] = [];
    let t = 1000;
    const clock = () => (t += 250);
    replies.push(reply({ heard: "x" }), { status: 500, body: "no" }, { status: 200, body: "not json" });
    await judge(post(), ENV, 1e12, (a) => seen.push(a), clock);
    await judge(post(), ENV, 1e12 + 60000, (a) => seen.push(a), clock);
    await judge(post(), ENV, 1e12 + 120000, (a) => seen.push(a), clock);
    const base = { model: MODEL, mode: "card", target: BODY.target, glossary: BODY.glossary, mime: "audio/webm", audio: "QUJD", ms: 250 };
    expect(seen).toEqual([
      { ...base, at: 1e12, status: 200, reply: { heard: "x" } },
      { ...base, at: 1e12 + 60000, status: 502, error: "The judge answered 500." },
      { ...base, at: 1e12 + 120000, status: 502, error: "The judge's reply could not be read." },
    ]);
  });
});
