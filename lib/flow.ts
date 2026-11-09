// The trainer's flow: one slide at a time, in talk order. A slide's script is learned as one piece, the way it is
// said on stage. A slide of more than 3 sentences is split into parts of at most 3 at sentence ends; each part is
// learned on its own, then the whole slide is said once at the end.
//
// Each slide or part starts with a test from memory, so what Tim already knows costs one attempt:
// 3. Say it from the slide alone. A pass learns it; a miss goes to step 2.
// 2. Fill in the hidden words: the phrases the judge said were missed are hidden as first letters and the rest is
//    shown (with nothing missed yet, every word is first letters). A pass goes back to step 3; a miss goes to step 1.
// 1. Read it aloud, with the text shown: after a miss with hints, or when Tim asks ("Show me first"). It cannot
//    fail; then step 2.
// The phrases missed on a unit are kept (focus) until it is learned, so the help is only where it is needed.
//
// Each day starts with a warm-up: the slides learned before today, in talk order, each said once from the slide
// (step 3). A miss in the warm-up goes back to step 2 for that slide, then step 3 again. Then new slides carry on
// from where the speaker stopped.
//
// Progress is kept as flow:<slide>:<part> = {step, learned, last, at} (at: when it was learned), and the day's
// warm-up as flow:warm:<yyyy-mm-dd> = {done (slide numbers), step}.

import { dayStart, ymd } from "./schedule";
import type { Slide } from "./train";

export type Step = 1 | 2 | 3;
export type PartState = { step: Step; learned: boolean; last: number; at?: number; focus?: string[] };
export type Warm = { done: number[]; step: Step; focus?: string[] };
// One thing to learn: a part of a slide (sentences from to to, end not included), or the whole slide.
// lead: the unit starts with the previous part's last sentence, said again to link the two.
export type Unit = { slide: Slide; part: number; parts: number; from: number; to: number; whole: boolean; key: string; lead: boolean };
export type Item = { unit: Unit; step: Step; warm: boolean };
type Get = <T>(key: string, fallback: T) => T;

// At most about this many characters are said in one go: on 9 November Tim passed 2 of 7 attempts of 250 or more
// characters, and most under 150. A longer sentence stands alone.
export const MOST = 200;

// A slide's parts: sentences grouped, in order, into parts of at most MOST characters of new sentences (a longer
// sentence on its own), each after the first led in by the sentence before it, then the whole slide. A slide that
// fits in one part is just the whole slide. None for a slide with no script.
export const unitsOf = (slide: Slide): Unit[] => {
  const n = slide.sentences.length;
  if (!n) return [];
  const spans: [number, number][] = [];
  let from = 0, size = 0;
  slide.sentences.forEach((x, i) => {
    if (i > from && size + 1 + x.text.length > MOST) { spans.push([from, i]); from = i; size = 0; }
    size += (size ? 1 : 0) + x.text.length;
  });
  if (spans.length) spans.push([from, n]);
  spans.push([0, n]);
  // each part after the first starts with the last sentence of the part before, so the join is said every time (on
  // 9 November Tim knew both parts of a slide but missed the join in every one of 4 attempts at the whole slide)
  return spans.map(([from, to], k) => {
    const whole = k === spans.length - 1, lead = k > 0 && !whole;
    return { slide, part: k + 1, parts: spans.length, from: lead ? from - 1 : from, to, whole, key: `flow:${slide.n}:${k + 1}`, lead };
  });
};
export const units = (slides: Slide[]) => slides.flatMap(unitsOf);
// Where a slide's parts join: the first new sentence of each part after the first.
export const joins = (slide: Slide) => unitsOf(slide).filter((u) => u.lead).map((u) => u.from + 1);

// The text and clips of a unit.
export const textOf = (u: Unit) => u.slide.sentences.slice(u.from, u.to).map((x) => x.text).join(" ");
export const clipsOf = (u: Unit) => {
  const said = u.slide.sentences.slice(u.from, u.to);
  return said.every((x) => x.clip) ? said.map((x) => x.clip as string) : null;
};
export const mustOf = (u: Unit) => u.slide.sentences.slice(u.from, u.to).flatMap((x) => x.must_say);

// The step a unit starts at: always from memory.
export const firstStep = (): Step => 3;

// Where an attempt leads.
// A miss goes down a level (memory to hints, hints to reading it), so Tim is never stuck on something he cannot
// recall, such as an acronym; reading it always goes on to hints.
export const move = (step: Step, pass: boolean): { step: Step; learned: boolean } => {
  if (step === 1) return { step: 2, learned: false };
  if (!pass) return { step: step === 3 ? 2 : 1, learned: false };
  return step === 2 ? { step: 3, learned: false } : { step: 3, learned: true };
};

const warmKey = (now: number) => `flow:warm:${ymd(now)}`;

// The phrases still being worked on for an item.
export const focusOf = (item: Item, get: Get, now: number): string[] => {
  const own = get<PartState | null>(item.unit.key, null)?.focus ?? [];
  return item.warm ? joined(own, get<Warm>(warmKey(now), { done: [], step: 3 }).focus ?? []) : own;
};
const joined = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const wholeOf = (s: Slide) => unitsOf(s).at(-1) as Unit;
const stateOf = (get: Get, u: Unit) => get<PartState | null>(u.key, null);

// Whether a slide is learned: its whole is learned. before: learned before this time.
export const learned = (get: Get, s: Slide, before = Infinity) => {
  if (!s.sentences.length) return false;
  const st = stateOf(get, wholeOf(s));
  return !!st?.learned && (st.at ?? 0) < before;
};

// The slides to warm up today: learned before today and not yet said today, in talk order.
export const warmUp = (slides: Slide[], get: Get, now: number) => {
  const done = new Set(get<Warm>(warmKey(now), { done: [], step: 3 }).done);
  return slides.filter((s) => learned(get, s, dayStart(now)) && !done.has(s.n));
};

// What to say next: the warm-up first, then the first unit not learned, at its step. null: everything is learned.
export const next = (slides: Slide[], get: Get, now: number): Item | null => {
  const warm = warmUp(slides, get, now);
  if (warm.length) return { unit: wholeOf(warm[0]), step: get<Warm>(warmKey(now), { done: [], step: 3 }).step, warm: true };
  const u = units(slides).find((x) => !stateOf(get, x)?.learned);
  return u ? { unit: u, step: stateOf(get, u)?.step ?? firstStep(), warm: false } : null;
};

// The progress entries an attempt writes. missed: the phrases the judge said were left out, changed or wrong.
export const record = (item: Item, pass: boolean, get: Get, now: number, missed: string[] = []): Record<string, unknown> => {
  const focus = joined(focusOf(item, get, now), missed);
  const to = move(item.step, pass);
  if (item.warm) {
    const w = get<Warm>(warmKey(now), { done: [], step: 3 });
    return { [warmKey(now)]: to.learned ? { done: w.done.concat(item.unit.slide.n), step: 3 } : { ...w, step: to.step, focus } };
  }
  return { [item.unit.key]: to.learned ? { step: 3, learned: true, last: now, at: now, ...(missed.length ? { focus: missed } : {}) }
    : { step: to.step, learned: false, last: now, focus } };
};

// "Show me first": the unit goes to step 1 (read it aloud), keeping what was missed. Not in the warm-up.
export const showFirst = (item: Item, get: Get, now: number): Record<string, unknown> =>
  (item.warm ? {} : { [item.unit.key]: { step: 1, learned: false, last: now, focus: focusOf(item, get, now) } });

// The fixed position over the card, and how the unit is being said.
export const MODES: Record<Step, string> = { 1: "read it", 2: "with hints", 3: "from memory" };
export const header = (item: Item, total: number) => {
  const u = item.unit;
  const part = u.parts === 1 ? "" : u.whole ? ", whole slide" : `, part ${u.part} of ${u.parts - 1}`;
  return `${item.warm ? "Warm up: slide" : "Slide"} ${u.slide.n} of ${total}${part}: ${MODES[item.step]}`;
};

// What each step asks for.
export const INSTRUCTIONS: Record<Step, string> = {
  1: "Read it aloud.",
  2: "Say it, filling in the hidden words.",
  3: "From memory: say it from the slide.",
};

// The home screen's figures: slides learned of those with a script, the slide to start from, and today's warm-up.
export const summary = (slides: Slide[], get: Get, now: number) => {
  const spoken = slides.filter((s) => s.sentences.length);
  const from = units(slides).find((x) => !stateOf(get, x)?.learned)?.slide ?? null;
  return { learned: spoken.filter((s) => learned(get, s)).length, total: spoken.length, from, warm: warmUp(slides, get, now).length };
};

// Progress kept by the earlier trainer (train:<slide>:<n>:<hash> cards with a level 0 to 4): a slide whose every
// sentence card is at level 2 or more counts as learned, before today, so it is warmed up rather than learned again.
export const migrate = (slides: Slide[], items: Record<string, unknown>): Record<string, PartState> => {
  const out: Record<string, PartState> = {};
  for (const s of slides) {
    const levels = s.sentences.map((x, i) => (items[`train:${s.n}:${i + 1}:${x.hash}`] as { level?: number } | undefined)?.level ?? -1);
    if (!levels.length || levels.some((l) => l < 2)) continue;
    for (const u of unitsOf(s)) out[u.key] = { step: 3, learned: true, last: 0, at: 0 };
  }
  return out;
};

// The big button after a verdict: step 1 always goes on; a miss says where it goes down to (hints, or reading it);
// a pass goes to the next step, or on to the next part, slide or warm-up slide.
export const nextLabel = (item: Item, pass: boolean) => {
  if (item.step === 1) return "Next step";
  if (!pass) return item.step === 3 ? "Try with hints" : "Read it first";
  if (item.step === 2) return "Next step";
  return item.warm ? "Next" : item.unit.whole ? "Next slide" : "Next part";
};
