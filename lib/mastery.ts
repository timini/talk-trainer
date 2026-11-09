// How well each sentence of the talk is known, and what to say next. Each sentence keeps a running score, m from 0
// to 1: after each attempt at a unit (a part of a slide, or the whole slide; lib/flow.ts unitsOf) it moves halfway to
// that sentence's own score (lib/score.ts perSentence), so the last three attempts carry most of the weight. It fades
// with time, halving every 2 hours at first, and more slowly the more often the sentence has been got (8 hours, a
// day, 3 days), so after a break a sentence comes back with more of its text showing. Each sentence hides that same
// share of its words, chosen afresh on each attempt: a sentence Tim knows can be hidden while a shaky one beside it
// keeps its cues (Tim, 9 November). Its names, numbers and acronyms fade on the same scale: in full, then the first
// letter, then hidden.
//
// A unit is as well known as its weakest sentence. Kept as flow:s:<slide>:<i>:<hash> = {m, at (the last attempt),
// passes (85 or more), n (attempts), focus (phrases missed last time), full (attempts left with the terms in full,
// after a wrong term)}, and flow:u:<slide>:<part> = {n (attempts), done (got with every sentence hidden)}.

import { learned, type Unit, units } from "./flow";
import type { Problem } from "./judge";
import { perSentence } from "./score";
import type { Sentence, Slide } from "./train";

export type State = { m: number; at: number; passes: number; n: number; focus: string[]; full: number };
// done: got at the aim held in aim (0.9 when missing, from before there were aims).
export type UnitState = { n: number; done: boolean; aim?: number };

// The aims: the running score at which a part counts as done. Get the gist moves on once the meaning is right with
// about half the words hidden (2 attempts a part); word for word drills each part until it is fully hidden.
export type Aim = "gist" | "verbatim";
export const AIMS: Record<Aim, number> = { gist: 0.5, verbatim: 0.9 };
// The score that counts as got: Nearly (60) is enough for the gist.
const gotAt = (aim: number) => (aim < 0.9 ? 60 : GOT);
type Get = <T>(key: string, fallback: T) => T;

const HOUR = 3600 * 1000;
// Half-lives by how often the sentence has been got: 0, 1, 2, then 3 or more times.
export const HALF = [2 * HOUR, 8 * HOUR, 24 * HOUR, 72 * HOUR];
// Below this a started unit is due again; at or above GOT an attempt counts as got.
export const DUE = 0.7;
export const GOT = 85;
// The terms of a sentence: in full below HINT, the first letter below TERMS, then hidden like any word.
export const HINT = 0.5;
export const TERMS = 0.8;

export const sentenceKey = (slide: Slide, s: Sentence) => `flow:s:${slide.n}:${s.i}:${s.hash}`;
export const unitKey = (u: Unit) => `flow:u:${u.slide.n}:${u.part}`;
const said = (u: Unit) => u.slide.sentences.slice(u.from, u.to);

// The running score now, after the fading since the last attempt.
export const effective = (st: State | null, now: number) => {
  if (!st) return 0;
  const half = HALF[Math.min(st.passes, HALF.length - 1)];
  return st.m * 0.5 ** (Math.max(0, now - st.at) / half);
};

// The share of a sentence's words hidden: in proportion to its running score, so that 0.9 hides it all, in steps of
// 5%. A new sentence got every time goes 0, 55%, 85%, 95%, then all of it: 5 attempts.
// With an aim below word for word, no more is hidden than at the aim (55% for the gist).
export const hidden = (eff: number, aim = 0.9) => {
  const share = (x: number) => (x >= 0.9 ? 1 : Math.round((x / 0.9) * 20) / 20);
  return Math.min(share(eff), share(aim));
};

// How a sentence's terms show: in full, by their first letter, or hidden like any word.
export const termMode = (eff: number, st: State | null): "full" | "initial" | "hide" =>
  ((st?.full ?? 0) > 0 || eff < HINT ? "full" : eff < TERMS ? "initial" : "hide");

// A sentence after an attempt with this score. focus: the phrases missed in it; wrong: a term in it was wrong.
export const update = (st: State | null, points: number, now: number, focus: string[] = [], wrong = false): State => ({
  m: 0.5 * effective(st, now) + 0.5 * (points / 100), at: now, passes: (st?.passes ?? 0) + (points >= GOT ? 1 : 0),
  n: (st?.n ?? 0) + 1, focus, full: wrong ? 2 : Math.max(0, (st?.full ?? 0) - 1),
});

// "Show me": the whole text again. "I know this one": all of it hidden.
export const showAll = (st: State | null, now: number): State =>
  ({ m: 0, at: now, passes: st?.passes ?? 0, n: st?.n ?? 0, focus: st?.focus ?? [], full: st?.full ?? 0 });
export const knowIt = (st: State | null, now: number): State =>
  ({ m: 0.9, at: now, passes: Math.max(1, st?.passes ?? 0), n: st?.n ?? 0, focus: st?.focus ?? [], full: 0 });

export type Line = { sentence: Sentence; state: State | null; eff: number; share: number };
export type Pick = { unit: Unit; lines: Line[]; eff: number; share: number; due: boolean; state: UnitState | null };

// A unit now: its sentences, its weakest sentence's score, and the share of its words hidden overall.
export const view = (u: Unit, get: Get, now: number, aim = 0.9): Pick => {
  const lines = said(u).map((sentence) => {
    const state = get<State | null>(sentenceKey(u.slide, sentence), null), eff = effective(state, now);
    return { sentence, state, eff, share: hidden(eff, aim) };
  });
  const state = get<UnitState | null>(unitKey(u), null);
  const eff = Math.min(...lines.map((l) => l.eff));
  const words = lines.map((l) => l.sentence.text.split(/\s+/).length), all = words.reduce((a, b) => a + b, 0);
  const share = Math.round((20 * lines.reduce((a, l, k) => a + l.share * words[k], 0)) / all) / 20;
  return { unit: u, lines, eff, share, due: !!state && eff < (DUE * aim) / 0.9, state };
};

// Whether a unit is done at this aim: got at it, or at a higher one.
export const doneAt = (st: UnitState | null, aim: number) => !!st?.done && (st.aim ?? 0.9) >= aim;

// What to say next: a started unit whose weakest sentence has faded below DUE, lowest first; else a started unit not
// yet done, lowest first; else the first new unit in talk order. null: everything is done and nothing is due.
// goal: the last slide to work on today.
export const pick = (slides: Slide[], get: Get, now: number, aim = 0.9, goal = Infinity): Pick | null => {
  const all = units(slides.filter((s) => s.n <= goal)).map((u) => view(u, get, now, aim));
  const started = all.filter((x) => x.state);
  const low = (xs: Pick[]) => xs.slice().sort((a, b) => a.eff - b.eff)[0];
  return low(started.filter((x) => x.due)) ?? low(started.filter((x) => !doneAt(x.state, aim)))
    ?? all.find((x) => !x.state) ?? null;
};

// The progress entries one attempt writes: each sentence's score from where its problems fall, the unit's attempt
// count, and done when the whole unit was got with every sentence hidden. byHand: marked got (100) or missed (0) by
// Tim, for every sentence.
export const record = (p: Pick, problems: Problem[], unitScore: number, now: number, byHand?: boolean, aim = 0.9): Record<string, unknown> => {
  const texts = p.lines.map((l) => l.sentence.text);
  const scores = byHand === undefined ? perSentence(problems, texts) : texts.map(() => (byHand ? 100 : 0));
  const out: Record<string, unknown> = {};
  p.lines.forEach((l, k) => {
    const lower = l.sentence.text.toLowerCase();
    const mine = byHand === undefined ? problems.filter((x) => x.kind !== "order" && lower.includes(x.script.toLowerCase().trim())) : [];
    out[sentenceKey(p.unit.slide, l.sentence)] = update(l.state, scores[k], now,
      mine.filter((x) => x.kind !== "stumble").map((x) => x.script), mine.some((x) => x.kind === "wrong_term"));
  });
  const got = byHand === undefined ? unitScore >= gotAt(aim) : byHand;
  const done = got && p.lines.every((l) => l.share >= hidden(1, aim));
  // got at a lower aim than one already reached keeps the higher one
  const best = Math.max(done ? aim : 0, p.state?.done ? p.state.aim ?? 0.9 : 0);
  out[unitKey(p.unit)] = best ? { n: (p.state?.n ?? 0) + 1, done: true, aim: best } : { n: (p.state?.n ?? 0) + 1, done: false };
  return out;
};

// "Show me" and "I know this one" for every sentence of a unit; the unit counts as started.
export const adjust = (p: Pick, to: typeof showAll, now: number): Record<string, unknown> => ({
  ...Object.fromEntries(p.lines.map((l) => [sentenceKey(p.unit.slide, l.sentence), to(l.state, now)])),
  [unitKey(p.unit)]: { n: p.state?.n ?? 0, done: false },
});

// The home screen: slides known (every unit done and not faded), the next new slide, and how many units are due.
// Within the goal: slides up to that number.
export const summary = (slides: Slide[], get: Get, now: number, aim = 0.9, goal = Infinity) => {
  const spoken = slides.filter((s) => s.sentences.length && s.n <= goal);
  const all = units(spoken).map((u) => view(u, get, now, aim));
  const known = (s: Slide) => all.filter((x) => x.unit.slide === s).every((x) => doneAt(x.state, aim) && !x.due);
  return { learned: spoken.filter(known).length, total: spoken.length, from: all.find((x) => !x.state)?.unit.slide ?? null,
    due: all.filter((x) => x.due).length, left: all.filter((x) => !doneAt(x.state, aim) || x.due).length };
};

// Earlier progress, once: a unit's running score (flow:m:<slide>:<part>, the whole-unit version) seeds each of its
// sentences; a slide the step-by-step flow had learned is well known (0.9, got twice), from when it was learned.
export const migrate = (slides: Slide[], get: Get, now: number): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const s of slides) {
    if (!s.sentences.length) continue;
    const flowLearned = learned(get, s);
    const whole = units([s]).at(-1) as Unit;
    const when = get<{ at?: number; last?: number } | null>(whole.key, null);
    for (const u of units([s])) {
      const old = get<{ m: number; at: number; passes: number; n: number; done: boolean } | null>(`flow:m:${s.n}:${u.part}`, null);
      if (!old && !flowLearned) continue;
      const seed: State = old ? { m: old.m, at: old.at, passes: old.passes, n: old.n, focus: [], full: 0 }
        : { m: 0.9, at: when?.at || when?.last || now, passes: 2, n: 0, focus: [], full: 0 };
      for (const x of said(u)) {
        const key = sentenceKey(s, x), have = out[key] as State | undefined;
        if (!have || seed.m > have.m) out[key] = seed;
      }
      out[unitKey(u)] = { n: old?.n ?? 0, done: old ? old.done : true };
    }
  }
  return out;
};

// The seed for an attempt's hidden words in one sentence: the sentence and how many attempts it has had.
export const seedOf = (slide: Slide, l: Line) =>
  [...`${sentenceKey(slide, l.sentence)}:${l.state?.n ?? 0}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

// The header over the card.
export const header = (p: Pick, total: number, aim = 0.9) => {
  const u = p.unit;
  const part = u.parts === 1 ? "" : u.whole ? ", whole slide" : `, part ${u.part} of ${u.parts - 1}`;
  return `${p.due ? "Again: slide" : "Slide"} ${u.slide.n} of ${total}${part}${aim < 0.9 ? " (gist)" : ""}`;
};

// Where the unit is in its slide, always shown, so a fully hidden card still says what to say.
export const position = (u: Unit) => {
  const n = u.slide.sentences.length;
  if (u.whole) return n === 1 ? "The whole slide: 1 sentence" : `The whole slide: all ${n} sentences`;
  return `${u.to - u.from === 1 ? `Sentence ${u.from + 1}` : `Sentences ${u.from + 1} to ${u.to}`} of ${n} (part ${u.part} of ${u.parts - 1})`;
};
// The opening words of a unit, always shown: its first sentence's first 3 words.
export const opening = (u: Unit) => u.slide.sentences[u.from].text.split(/\s+/).slice(0, 3).join(" ");

// What the card asks for.
export const instruction = (share: number) => (share === 0 ? "Read it aloud."
  : share >= 1 ? "From memory: say it from the slide."
  : `Say it, filling in the blanks (${Math.round(share * 100)}% hidden).`);
