// POST /api/grade: the judge. Gemini listens to one recorded attempt (mode "card") or a piece of a run-through (mode
// "run") and answers JSON in the CARD or RUN schema. The Gemini key stays on the server.
//
// Request: {mode, audio (base64), mime, target (the sentence, or the slides' script), glossary (the talk's names),
// must (the must-say items)}. Reply: the model's JSON, or {error}. With STANDINS=1 a stand-in answers instead: the
// meaning came through, for tests.
//
// record, when given, gets each attempt Gemini judged (the request, the reply or the error, and how long Gemini
// took), so real attempts can be replayed when the judge seems wrong (tools/debug-pull.mjs).

import { hedge } from "./hedge";
import { CARD, MODEL, prompt, RUN } from "./judge";

export const API = "https://generativelanguage.googleapis.com";
export const LIMIT = 1024 * 1024;
// Requests a minute, for each running copy of the Worker: a session is one card every few seconds at most.
export const RATE = 60;
// When a second Gemini request goes out, and when to give up (ms).
export const HEDGE_AFTER = 4000;
export const HEDGE_LIMIT = 12000;

export type JudgeEnv = { GEMINI_KEY?: string; GEMINI_MODEL?: string; STANDINS?: string };
// at: where in the talk the attempt was (the unit, the flow step, warm-up or not), kept with it for learning metrics.
type At = Record<string, unknown>;
type Body = { mode?: string; audio?: string; mime?: string; target?: string; glossary?: string[]; must?: string[]; at?: At };
export type Attempt = { at: number; ms: number; model: string; mode?: string; target: string; glossary?: string[];
  mime: string; audio: string; status: number; reply?: unknown; error?: string; where?: At };

// The rate limit: a count for the current minute, in this copy of the Worker.
const counter = { minute: -1, count: 0 };
export const allowed = (now: number) => {
  const minute = Math.floor(now / 60000);
  if (minute !== counter.minute) Object.assign(counter, { minute, count: 0 });
  counter.count += 1;
  return counter.count <= RATE;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The stand-in judge: every attempt carries the meaning.
export const standin = (body: Body) => (body.mode === "run"
  ? { pace: "Steady.", unclear: [], work_on: [] }
  : { heard: body.target, meaning_ok: true, problems: [], clarity: 5, fluency: 5, pace: "good", tip: "Keep it up." });

export async function judge(request: Request, env: JudgeEnv, now = Date.now(),
  record: (a: Attempt) => void = () => {}, clock: () => number = Date.now) {
  if (!env.GEMINI_KEY && env.STANDINS !== "1") return json(503, { error: "The judge is not set up on this site." });
  if (Number(request.headers.get("Content-Length") ?? 0) > LIMIT) return json(413, { error: "The recording is too long." });
  const text = await request.text();
  if (text.length > LIMIT) return json(413, { error: "The recording is too long." });
  if (!allowed(now)) return json(429, { error: "Too many attempts in a minute. Wait a moment." });
  let body: Body;
  try { body = JSON.parse(text); } catch { return json(400, { error: "Not JSON." }); }
  if (!body.audio || !body.mime || !body.target) return json(400, { error: "audio, mime and target are needed." });
  if (env.STANDINS === "1") return json(200, standin(body));
  const run = body.mode === "run", model = env.GEMINI_MODEL || MODEL, start = clock();
  const seen = (status: number, out: { reply?: unknown; error?: string }) => {
    record({ at: now, ms: clock() - start, model, mode: body.mode, target: body.target as string, glossary: body.glossary,
      mime: body.mime as string, audio: body.audio as string, status, ...out, ...(body.at ? { where: body.at } : {}) });
  };
  // Gemini usually answers in 3 to 6 s but now and then takes 26 s: a second request goes out after HEDGE_AFTER, the
  // first answer wins, and after HEDGE_LIMIT the page is told to use its own grade.
  const ask = async (signal: AbortSignal) => {
    const res = await fetch(`${API}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal,
      headers: { "x-goog-api-key": env.GEMINI_KEY as string, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt({ mode: body.mode, target: body.target as string, glossary: body.glossary, must: body.must }) },
          { inline_data: { mime_type: body.mime, data: body.audio } }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: run ? RUN : CARD, temperature: 0,
          thinkingConfig: { thinkingLevel: "low" } },
      }),
    });
    if (!res.ok) throw new Error(`The judge answered ${res.status}.`);
    try {
      const reply = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
      return JSON.parse(reply.candidates[0].content.parts[0].text) as unknown;
    } catch {
      throw new Error("The judge's reply could not be read.");
    }
  };
  try {
    const out = await hedge(ask, HEDGE_AFTER, HEDGE_LIMIT);
    seen(200, { reply: out });
    return json(200, out);
  } catch (e) {
    const slow = (e as Error).message === "timeout";
    const error = slow ? "The judge took too long, so this is the page's own grade." : (e as Error).message;
    seen(slow ? 504 : 502, { error });
    return json(slow ? 504 : 502, { error });
  }
}
