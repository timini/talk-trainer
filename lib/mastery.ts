// How well each unit of the talk is known, and what to say next. Each unit (a part of a slide, or the whole slide;
// lib/flow.ts unitsOf) keeps a running score, m from 0 to 1: after each attempt it moves halfway to the attempt's
// score (lib/score.ts), so the last three attempts carry most of the weight. It fades with time, halving every 2
// hours at first, and more slowly the more often the unit has been got (8 hours, a day, 3 days), so after a break a
// slide comes back with more of its text showing. The words hidden are that same share of the text, chosen afresh on
// each attempt, so a miss shows more text next time and a pass less, with no fixed levels (Tim, 9 November).
//
// Kept as flow:m:<slide>:<part> = {m, at (the last attempt), passes (85 or more), n (attempts), done (got with
// everything hidden), focus (phrases missed last time)}.

import { learned, type Unit, units } from "./flow";
import type { Slide } from "./train";

export type State = { m: number; at: number; passes: number; n: number; done: boolean; focus: string[] };
type Get = <T>(key: string, fallback: T) => T;

const HOUR = 3600 * 1000;
// Half-lives by how often the unit has been got: 0, 1, 2, then 3 or more times.
export const HALF = [2 * HOUR, 8 * HOUR, 24 * HOUR, 72 * HOUR];
// Below this a started unit is due again; at or above GOT an attempt counts as got.
export const DUE = 0.7;
export const GOT = 85;
// Names, numbers and acronyms stay shown until the unit is this well known.
export const TERMS = 0.8;

export const keyOf = (u: Unit) => `flow:m:${u.slide.n}:${u.part}`;
export const stateOf = (get: Get, u: Unit) => get<State | null>(keyOf(u), null);

// The running score now, after the fading since the last attempt.
export const effective = (st: State | null, now: number) => {
  if (!st) return 0;
  const half = HALF[Math.min(st.passes, HALF.length - 1)];
  return st.m * 0.5 ** (Math.max(0, now - st.at) / half);
};

// The share of the words hidden: in proportion to the running score, so that 0.9 hides everything (the slide
// alone), in steps of 5%. A new unit got every time goes 0, 55%, 85%, 95%, then everything: 5 attempts.
export const hidden = (eff: number) => (eff >= 0.9 ? 1 : Math.round((eff / 0.9) * 20) / 20);

// After an attempt with this score (0 to 100) and this share hidden. focus: the phrases missed.
export const update = (st: State | null, score: number, share: number, now: number, focus: string[] = []): State => {
  const m = 0.5 * effective(st, now) + 0.5 * (score / 100);
  const got = score >= GOT;
  return { m, at: now, passes: (st?.passes ?? 0) + (got ? 1 : 0), n: (st?.n ?? 0) + 1, done: got && share >= 1, focus };
};

// "Show me": the whole text again. "I know this one": nearly all hidden.
export const showAll = (st: State | null, now: number): State =>
  ({ m: 0, at: now, passes: st?.passes ?? 0, n: st?.n ?? 0, done: false, focus: st?.focus ?? [] });
export const knowIt = (st: State | null, now: number): State =>
  ({ m: 0.9, at: now, passes: Math.max(1, st?.passes ?? 0), n: st?.n ?? 0, done: false, focus: st?.focus ?? [] });

export type Pick = { unit: Unit; eff: number; share: number; due: boolean; state: State | null };

// What to say next: a started unit whose score has faded below DUE, lowest first; else a started unit not yet
// done, lowest first; else the first new unit in talk order. null: everything is done and nothing is due.
export const pick = (slides: Slide[], get: Get, now: number): Pick | null => {
  const all = units(slides).map((unit) => {
    const state = stateOf(get, unit), eff = effective(state, now);
    return { unit, state, eff, share: hidden(eff), due: !!state && eff < DUE };
  });
  const started = all.filter((x) => x.state);
  const low = (xs: typeof all) => xs.slice().sort((a, b) => a.eff - b.eff)[0];
  return low(started.filter((x) => x.due)) ?? low(started.filter((x) => !x.state?.done)) ?? all.find((x) => !x.state) ?? null;
};

// The home screen: slides known (every unit done and not faded), the next new slide, and how many units are due.
export const summary = (slides: Slide[], get: Get, now: number) => {
  const spoken = slides.filter((s) => s.sentences.length);
  const known = (s: Slide) => units([s]).every((u) => {
    const st = stateOf(get, u);
    return !!st?.done && effective(st, now) >= DUE;
  });
  const fresh = units(slides).find((u) => !stateOf(get, u));
  const due = units(slides).filter((u) => { const st = stateOf(get, u); return !!st && effective(st, now) < DUE; }).length;
  return { learned: spoken.filter(known).length, total: spoken.length, from: fresh?.slide ?? null, due };
};

// The earlier flow's progress: a slide it had learned is well known here (0.9, got twice), from when it was learned.
export const migrate = (slides: Slide[], get: Get, now: number): Record<string, State> => {
  const out: Record<string, State> = {};
  for (const s of slides) {
    if (!learned(get, s)) continue;
    const whole = units([s]).at(-1) as Unit;
    const at = get<{ at?: number; last?: number } | null>(whole.key, null);
    for (const u of units([s])) out[keyOf(u)] = { m: 0.9, at: at?.at || at?.last || now, passes: 2, n: 0, done: true, focus: [] };
  }
  return out;
};

// The seed for an attempt's hidden words: the unit and how many attempts it has had, so each attempt differs.
export const seedOf = (p: Pick) => [...`${keyOf(p.unit)}:${p.state?.n ?? 0}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

// The header over the card.
export const header = (p: Pick, total: number) => {
  const u = p.unit;
  const part = u.parts === 1 ? "" : u.whole ? ", whole slide" : `, part ${u.part} of ${u.parts - 1}`;
  return `${p.due ? "Again: slide" : "Slide"} ${u.slide.n} of ${total}${part}`;
};

// What the card asks for.
export const instruction = (share: number) => (share === 0 ? "Read it aloud."
  : share >= 1 ? "From memory: say it from the slide."
  : `Say it, filling in the blanks (${Math.round(share * 100)}% hidden).`);

