// Delivery: how a card was said, not only what. Measures come from speech recognition (confidence, timing, the
// words heard) and a level meter on the microphone that stays in the browser.

import type { Result } from "./grade";

export type Measures = {
  conf: number | null; unclear: string[]; wpm: number | null; drop: number | null; level: number | null;
  pauses: string[]; fillers: string[];
};

// Pace: words a minute. Under a second of speech, or over 400 words a minute, is a timing that went wrong, not a
// pace: null.
export const pace = (words: number, ms: number): number | null => {
  const wpm = words > 0 && ms >= 1000 ? Math.round((words * 60000) / ms) : null;
  return wpm !== null && wpm <= 400 ? wpm : null;
};

// The mean of a level trace (one level a sample, 0 to 1); null when there is none.
export const loudness = (levels: number[]): number | null =>
  (levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null);

// Silence: below a tenth of the mean level. The level trace while speaking runs from the first sample above that
// to the last.
const silent = (levels: number[]) => 0.1 * (loudness(levels) || 0);
export const voiced = (levels: number[]): number[] => {
  const floor = silent(levels);
  const first = levels.findIndex((x) => x > floor);
  let last = levels.length - 1;
  while (last >= 0 && !(levels[last] > floor)) last -= 1;
  return first < 0 ? [] : levels.slice(first, last + 1);
};

// How much the voice drops in the last fifth of the sentence against the rest: 0 none, 0.5 half as loud. Null
// when the trace is too short to tell.
export const dropAtEnd = (levels: number[]): number | null => {
  const v = voiced(levels), cut = Math.floor(v.length * 0.8);
  if (v.length < 10) return null;
  const start = loudness(v.slice(0, cut)) as number, end = loudness(v.slice(cut)) as number;
  return Math.max(0, Math.round((1 - end / start) * 100) / 100);
};

// Silences of more than 1.2 seconds inside the sentence (not before or after it), as fractions of the way
// through it. step: seconds a sample.
const PAUSE = 1.2;
export const pauses = (levels: number[], step: number): number[] => {
  const v = voiced(levels), floor = silent(levels), out: number[] = [];
  let from = -1;
  v.forEach((x, i) => {
    if (x <= floor && from < 0) from = i;
    if (x > floor && from >= 0) { if ((i - from) * step > PAUSE) out.push(Math.round((from / v.length) * 100) / 100); from = -1; }
  });
  return out;
};

// The word of the sentence about that far through it, for "You paused before ...".
export const wordAt = (text: string, at: number): string => {
  const ws = text.split(/\s+/).filter(Boolean);
  return ws.length ? ws[Math.min(ws.length - 1, Math.round(at * ws.length))].replace(/[^\p{L}\p{N}'’-]/gu, "") : "";
};

// Fillers heard that the script does not have: um, uh, er, erm, like, you know, and so at the start.
const FILLERS = ["um", "umm", "uh", "er", "erm", "like"];
export const fillers = (heard: string, script: string): string[] => {
  const h = heard.toLowerCase().match(/[\p{L}']+/gu) || [], s = script.toLowerCase().match(/[\p{L}']+/gu) || [];
  const count = (ws: string[], w: string) => ws.filter((x) => x === w).length;
  const out: string[] = [];
  FILLERS.forEach((w) => { for (let n = count(h, w) - count(s, w); n > 0; n -= 1) out.push(w); });
  const knows = (ws: string[]) => ws.filter((x, i) => x === "you" && ws[i + 1] === "know").length;
  for (let n = knows(h) - knows(s); n > 0; n -= 1) out.push("you know");
  if (h[0] === "so" && s[0] !== "so") out.push("so");
  return out;
};

// Words worth saying more clearly: missed or only close, and a name (a capital inside the sentence, or a digit)
// or a long word (8 letters or more).
export const unclear = (result: Result): string[] => result.parts.flatMap((p) => p.words.map((w, i) => ({ ...w, i })))
  .filter((w) => !w.ok || w.close)
  .map((w) => ({ w: w.w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""), i: w.i }))
  .filter(({ w, i }) => w && (/\d/.test(w) || (i > 0 && /\p{Lu}/u.test(w)) || w.length >= 8))
  .map(({ w }) => w);

// The most useful tip for one card, or "".
const QUIET = 0.02;
export const tip = (m: Measures): string => {
  if (m.unclear.length >= 2 || (m.conf !== null && m.conf < 0.75)) {
    return m.unclear.length ? `Some words were unclear: ${m.unclear.slice(0, 3).join(", ")}. Finish the consonants and slow down on names.`
      : "The recogniser was unsure of you. Finish the consonants and slow down a little.";
  }
  if (m.wpm !== null && m.wpm > 160) return `About ${m.wpm} words a minute. Aim for 120 to 140 on stage.`;
  if (m.pauses.length) return `You paused before "${m.pauses[0]}". That is the word to practise.`;
  if (m.drop !== null && m.drop >= 0.4) return "Your voice drops at the end of the sentence. Keep the last word up.";
  if (m.level !== null && m.level < QUIET) return "You were quiet. Speak up as if to the back of the room.";
  if (m.fillers.length) {
    const n = m.fillers.length;
    return `${n === 1 ? "One filler" : `${n} fillers`} (${[...new Set(m.fillers)].join(", ")}). Pause silently instead.`;
  }
  if (m.wpm !== null && m.wpm < 100) return "A little slow; keep it moving.";
  return "";
};

// One line on how it was said, under the verdict.
export const delivery = (m: Measures): string => [m.conf !== null ? `Clarity ${Math.round(m.conf * 100)}%` : "",
  m.wpm !== null ? `${m.wpm} words a minute` : "",
  m.drop !== null ? (m.drop >= 0.4 ? "voice drops at the end" : "volume steady") : ""].filter(Boolean).join(", ");

// A session's or a day's delivery: cards measured, mean pace and clarity, and the words most often unclear.
export const sumUp = (ms: Measures[]) => {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const wpm = mean(ms.map((m) => m.wpm).filter((x): x is number => x !== null));
  const conf = mean(ms.map((m) => m.conf).filter((x): x is number => x !== null));
  const count: Record<string, number> = {};
  ms.forEach((m) => m.unclear.forEach((w) => { count[w] = (count[w] || 0) + 1; }));
  const words = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b)).slice(0, 3);
  return { cards: ms.length, wpm: wpm === null ? null : Math.round(wpm), conf: conf === null ? null : Math.round(conf * 100) / 100, words };
};

// A day's running totals for progress: {n, wpm (sum), wpmN, conf (sum), confN}.
type Day = { n: number; wpm: number; wpmN: number; conf: number; confN: number };
export const addDay = (day: Day | null, m: Pick<Measures, "wpm" | "conf">): Day => {
  const d = day || { n: 0, wpm: 0, wpmN: 0, conf: 0, confN: 0 };
  return { n: d.n + 1, wpm: d.wpm + (m.wpm || 0), wpmN: d.wpmN + (m.wpm === null ? 0 : 1),
    conf: d.conf + (m.conf || 0), confN: d.confN + (m.conf === null ? 0 : 1) };
};
