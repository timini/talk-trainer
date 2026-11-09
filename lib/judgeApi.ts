// POST /api/grade: the judge. Gemini listens to one recorded attempt (mode "card") or a piece of a run-through (mode
// "run") and answers JSON in the CARD or RUN schema. The Gemini key stays on the server.
//
// Request: {mode, audio (base64), mime, target (the sentence, or the slides' script), glossary (the talk's names)}.
// Reply: the model's JSON, or {error}. With STANDINS=1 a stand-in answers instead: word for word, for tests.

import { CARD, MODEL, prompt, RUN } from "./judge";

export const API = "https://generativelanguage.googleapis.com";
export const LIMIT = 1024 * 1024;
// Requests a minute, for each running copy of the Worker: a session is one card every few seconds at most.
export const RATE = 60;

export type JudgeEnv = { GEMINI_KEY?: string; GEMINI_MODEL?: string; STANDINS?: string };
type Body = { mode?: string; audio?: string; mime?: string; target?: string; glossary?: string[] };

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

// The stand-in judge: everything said word for word.
export const standin = (body: Body) => (body.mode === "run"
  ? { pace: "Steady.", unclear: [], work_on: [] }
  : { heard: body.target, verbatim: true, missed: [], stumbles: [], clarity: 5, fluency: 5, pace: "good",
    tip: "Keep it up." });

export async function judge(request: Request, env: JudgeEnv, now = Date.now()) {
  if (!env.GEMINI_KEY && env.STANDINS !== "1") return json(503, { error: "The judge is not set up on this site." });
  if (Number(request.headers.get("Content-Length") ?? 0) > LIMIT) return json(413, { error: "The recording is too long." });
  const text = await request.text();
  if (text.length > LIMIT) return json(413, { error: "The recording is too long." });
  if (!allowed(now)) return json(429, { error: "Too many attempts in a minute. Wait a moment." });
  let body: Body;
  try { body = JSON.parse(text); } catch { return json(400, { error: "Not JSON." }); }
  if (!body.audio || !body.mime || !body.target) return json(400, { error: "audio, mime and target are needed." });
  if (env.STANDINS === "1") return json(200, standin(body));
  const run = body.mode === "run";
  const res = await fetch(`${API}/v1beta/models/${env.GEMINI_MODEL || MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_KEY as string, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt({ mode: body.mode, target: body.target, glossary: body.glossary }) },
        { inline_data: { mime_type: body.mime, data: body.audio } }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: run ? RUN : CARD, temperature: 0,
        thinkingConfig: { thinkingLevel: "low" } },
    }),
  });
  if (!res.ok) return json(502, { error: `The judge answered ${res.status}.` });
  try {
    const reply = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
    return json(200, JSON.parse(reply.candidates[0].content.parts[0].text));
  } catch {
    return json(502, { error: "The judge's reply could not be read." });
  }
}
