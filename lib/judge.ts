// The judge: Gemini listens to one recorded attempt and says whether the sentence came across with the same meaning
// as the script, what went wrong if not, and how it was delivered; or, for a run-through, reports on the delivery of
// a stretch of the talk. Its verdict replaces the page's own grade.
//
// The speaker learns the script so that it carries the same meaning, not word for word. A card fails for a point
// left out, a changed meaning, a wrong number, name or key term, points in a different order, or a stumble (a false
// start, a repeat or a self-correction). Small words added or dropped, contractions, synonyms and light rewording
// within a point are fine.

import { normalise, type Part, type Result } from "./grade";

// The newest stable Flash model that takes audio.
export const MODEL = "gemini-3.8-flash";

export const KINDS = ["left_out", "changed", "wrong_term", "order", "stumble"] as const;
export type Kind = (typeof KINDS)[number];
export type Problem = { kind: Kind; script: string; said?: string };

// The reply for one card.
export const CARD = {
  type: "OBJECT",
  properties: {
    heard: { type: "STRING", description: "What was said, word for word, with the names spelled as in the glossary." },
    meaning_ok: { type: "BOOLEAN", description: "True only if none of the fail rules apply: no point left out, no "
      + "meaning changed, no number, name or key term wrong, the points in the script's order, and no stumble." },
    problems: {
      type: "ARRAY",
      description: "One item for each fail rule that applies; empty when meaning_ok is true.",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: [...KINDS] },
          script: { type: "STRING", description: "The exact words of the target that were affected, quoted from it." },
          said: { type: "STRING", description: "What was said instead, if anything; for a stumble, the stumble as said." },
        },
        required: ["kind", "script"],
      },
    },
    fluency: { type: "INTEGER", description: "How smoothly it flowed, 1 (stop and start) to 5 (one smooth line)." },
    clarity: { type: "INTEGER", description: "How clearly it was spoken, 1 (hard to follow) to 5 (very clear)." },
    pace: { type: "STRING", enum: ["too slow", "good", "too fast"] },
    tip: { type: "STRING", description: "One short, specific delivery tip in plain English." },
  },
  required: ["heard", "meaning_ok", "problems", "clarity", "fluency", "pace", "tip"],
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
  heard?: string; meaning_ok?: boolean; problems?: Problem[]; clarity?: number; fluency?: number; pace?: string;
  tip?: string;
};
export type RunReply = { pace: string; unclear: string[]; work_on: string[] };

export const prompt = ({ mode, target, glossary, must }:
  { mode?: string; target: string; glossary?: string[]; must?: string[] }): string => {
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
    "You are checking a speaker who is learning a conference talk so that each sentence carries the same meaning as "
      + "the script. It does not have to be word for word.",
    `The target: ${target}`, names,
    `Must be said exactly: ${must?.length ? must.join(", ") : "nothing beyond the names and numbers"}.`,
    "List a problem for each of these, and only these:\n"
      + "left_out: a point of the script, a clause or an idea, was not said.\n"
      + "changed: the meaning changed, for example \"adds little\" said as \"helps\".\n"
      + "wrong_term: a number, a name from the list above, a must-say item or a key term was wrong or missing. These "
      + "must come out exactly: \"9 in 10\" said as \"8 in 10\" is wrong, \"nine in ten\" is right.\n"
      + "order: the points were said in a different order from the script.\n"
      + "stumble: a false start, a repeated phrase or a self-correction, even if the final version is right. Put the "
      + "stumble as it was said in \"said\".",
    "These are fine and are never a problem: a small word added or dropped (I, and, the, so, a, that), a contraction "
      + "(I'm for I am), a greeting or a filler before or inside the sentence (hi, so, um), a synonym that keeps the "
      + "meaning, light rewording within a point, and how names are spelled.",
    "For each problem, copy into \"script\" the exact words of the target that were affected, and put in \"said\" what "
      + "was said instead, if anything. Set meaning_ok to true only when there are no problems.",
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

// Where a quoted phrase of the target is: the tokens of the first run, in order, that matches it and does not overlap
// a run already taken. Tokens are compared as normalise() makes them, so case and punctuation do not matter.
type At = { t: string; p: number; w: number };
const find = (tokens: At[], phrase: string, taken: Set<number>): number[] => {
  const seq = normalise(phrase);
  if (!seq.length) return [];
  for (let i = 0; i + seq.length <= tokens.length; i += 1) {
    if (seq.every((t, k) => tokens[i + k].t === t && !taken.has(i + k))) {
      const run = seq.map((_, k) => i + k);
      run.forEach((k) => taken.add(k));
      return run;
    }
  }
  return [];
};

// The judge's verdict over the page's own grade. The card passes when the meaning came through (meaning_ok) and
// there are no problems; a stumble is a problem. Each problem's quoted phrase is marked as a run of words, so a word
// said right elsewhere is never marked: left_out and changed as missed, wrong_term as a must-say miss (crit). A
// stumble or an order problem marks nothing. A phrase that cannot be found marks nothing, and the problem still
// counts.
export const judged = (local: Result, j: Verdict): Result & { problems: Problem[]; judge: Verdict } => {
  const problems = j.problems ?? [];
  const parts: Part[] = local.parts.map((p) => ({ ...p, words: p.words.map((w) => ({ ...w, ok: true, close: false, crit: false })) }));
  const tokens: At[] = parts.flatMap((p, pi) => p.words.flatMap((w, wi) => normalise(w.w).map((t) => ({ t, p: pi, w: wi }))));
  const taken = new Set<number>();
  problems.filter((x) => x.kind !== "stumble" && x.kind !== "order").forEach((x) => {
    find(tokens, x.script, taken).forEach((i) => {
      const w = parts[tokens[i].p].words[tokens[i].w];
      w.ok = false;
      w.crit = w.crit || x.kind === "wrong_term";
    });
  });
  const pass = j.meaning_ok === true && !problems.length;
  const out = parts.map((p) => {
    const wrong = p.words.filter((w) => !w.ok);
    return { ...p, acc: p.words.length ? 1 - wrong.length / p.words.length : 1, critWrong: wrong.filter((w) => w.crit).length, pass };
  });
  const all = out.flatMap((p) => p.words);
  return { ...local, parts: out, pass, problems, acc: all.length ? all.filter((w) => w.ok).length / all.length : 1, judge: j };
};

// The judge's run-through report, from its reply on each piece of the recording ({from, to, reply}: slide numbers
// and the reply): the pace piece by piece, the unclear words once each, and up to 5 things to work on.
export const report = (pieces: { from: number; to: number; reply: RunReply }[]): { pace: string[]; unclear: string[]; work_on: string[] } => ({
  pace: pieces.map((p) => (pieces.length > 1 ? `Slides ${p.from} to ${p.to}: ${p.reply.pace}` : p.reply.pace)),
  unclear: [...new Set(pieces.flatMap((p) => p.reply.unclear))],
  work_on: [...new Set(pieces.flatMap((p) => p.reply.work_on))].slice(0, 5),
});
