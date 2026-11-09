// The judge: Gemini listens to one recorded attempt and says whether the sentence was said word for word, and how
// it was delivered; or, for a run-through, reports on the delivery of a stretch of the talk. Its verdict replaces
// the page's own grade.

import { normalise, PASS, type Part, type Result } from "./grade";

// The newest stable Flash model that takes audio.
export const MODEL = "gemini-3.8-flash";

// The reply for one card.
export const CARD = {
  type: "OBJECT",
  properties: {
    heard: { type: "STRING", description: "What was said, word for word, with the names spelled as in the glossary." },
    verbatim: { type: "BOOLEAN", description: "True only if the target sentence was said word for word, in order, "
      + "with no false start, repeated phrase or self-correction." },
    missed: { type: "ARRAY", items: { type: "STRING" }, description: "Target words left out or changed." },
    stumbles: { type: "ARRAY", items: { type: "STRING" },
      description: "Each false start, repeated phrase or self-correction, quoted as it was said." },
    fluency: { type: "INTEGER", description: "How smoothly it flowed, 1 (stop and start) to 5 (one smooth line)." },
    clarity: { type: "INTEGER", description: "How clearly it was spoken, 1 (hard to follow) to 5 (very clear)." },
    pace: { type: "STRING", enum: ["too slow", "good", "too fast"] },
    tip: { type: "STRING", description: "One short, specific delivery tip in plain English." },
  },
  required: ["heard", "verbatim", "missed", "stumbles", "clarity", "fluency", "pace", "tip"],
} as const;

// The reply for a piece of a run-through.
export const RUN = {
  type: "OBJECT",
  properties: {
    pace: { type: "STRING", description: "The pace, and where it changed." },
    unclear: { type: "ARRAY", items: { type: "STRING" }, description: "Words or names that were hard to make out." },
    work_on: { type: "ARRAY", items: { type: "STRING" }, description: "The three things to work on, most useful first." },
  },
  required: ["pace", "unclear", "work_on"],
} as const;

export type Verdict = {
  heard?: string; verbatim?: boolean; missed?: string[]; stumbles?: string[]; clarity?: number; fluency?: number;
  pace?: string; tip?: string;
};
export type RunReply = { pace: string; unclear: string[]; work_on: string[] };

export const prompt = ({ mode, target, glossary }: { mode?: string; target: string; glossary?: string[] }): string => {
  const names = `Names in this talk, spelled as they should be written: ${(glossary || []).join(", ")}.`;
  const style = "Write in plain English, with no dashes.";
  if (mode === "run") {
    return [
      "You are coaching a speaker rehearsing a conference talk. The recording is a run-through of part of the talk.",
      `The script for this part: ${target}`, names,
      "Report on the delivery: the pace, the words or names that were hard to make out, and the three things to work on.",
      style,
    ].join("\n\n");
  }
  return [
    "You are checking a speaker who is learning one sentence of a conference talk by heart.",
    `The target sentence: ${target}`, names,
    "Judge whether the sentence came out as written, but ignore spelling, punctuation and how names are written. A "
      + "changed number, a wrong name or term, a left out phrase or a changed meaning is a miss; a filler such as um is not.",
    "Small words added or dropped (I, and, the, a, so, that, have, it), contractions (I'm for I am) and a greeting "
      + "before the sentence are not misses: count the sentence as word for word and do not list them in missed.",
    "Be strict about restarts: if the speaker starts a phrase, stops and says it again, repeats words, or corrects "
      + "themselves, the sentence was not said word for word, even if the final version is right. Quote each one in "
      + "stumbles. A sentence said as one smooth line has none.",
    "Then judge the delivery as a speaking coach would, from the sound: how clearly each word comes across, how "
      + "smoothly it flows, the pace, whether the voice drops or trails off at the end, and whether the key words "
      + "and numbers are stressed. Give one short, specific tip on the biggest problem in this attempt.",
    style,
  ].join("\n\n");
};

// Equal strings, in time that does not depend on where they differ.
export const same = (a: string, b: string): boolean => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
};

// The judge's verdict over the page's own grade: the words it lists as missed are marked (numbers and must-say
// items stay marked as such), and the card passes by the page's own rule (PASS of the words, no number or must-say
// item wrong), so one dropped small word is not a miss. Not word for word with no word listed is a miss, and so
// is any false start, repeat or self-correction the judge lists in stumbles.
export const judged = (local: Result, j: Verdict): Result & { stumbles: string[]; judge: Verdict } => {
  const missed = new Set((j.missed || []).flatMap(normalise));
  const parts: Part[] = local.parts.map((p) => {
    const words = p.words.map((w) => {
      const bad = !j.verbatim && normalise(w.w).some((t) => missed.has(t));
      return { ...w, ok: !bad, close: false };
    });
    const wrong = words.filter((w) => !w.ok);
    const acc = words.length ? 1 - wrong.length / words.length : 1, critWrong = wrong.filter((w) => w.crit).length;
    return { ...p, words, acc, critWrong, pass: !!j.verbatim || (wrong.length > 0 && acc >= PASS && !critWrong) };
  });
  const all = parts.flatMap((p) => p.words);
  const stumbles = j.stumbles || [];
  return { ...local, parts, pass: parts.every((x) => x.pass) && !stumbles.length, stumbles,
    acc: all.length ? all.filter((w) => w.ok).length / all.length : 1, judge: j };
};

// The judge's run-through report, from its reply on each piece of the recording ({from, to, reply}: slide numbers
// and the reply): the pace piece by piece, the unclear words once each, and up to 5 things to work on.
export const report = (pieces: { from: number; to: number; reply: RunReply }[]): { pace: string[]; unclear: string[]; work_on: string[] } => ({
  pace: pieces.map((p) => (pieces.length > 1 ? `Slides ${p.from} to ${p.to}: ${p.reply.pace}` : p.reply.pace)),
  unclear: [...new Set(pieces.flatMap((p) => p.reply.unclear))],
  work_on: [...new Set(pieces.flatMap((p) => p.reply.work_on))].slice(0, 5),
});
