// The trainer's plain logic, apart from React: the cards of a talk, what a card shows (its chain, levels and clips),
// and the words on each screen.

import type { Result } from "./grade";
import type { Verdict } from "./judge";
import { ago, type Card, days } from "./schedule";

export type Sentence = { i: number; text: string; hash: string; clip: string | null; must_say: string[] };
export type Slide = { n: number; title: string; image: string | null; sentences: Sentence[] };
export type Script = { talk: { id: string; title: string; status: string; talkAt: number | null; glossary: string[] };
  slides: Slide[] };
// A card: one sentence. i counts from 0 within its slide.
export type TrainCard = { key: string; s: Slide; i: number; text: string; words: number };

// One card per sentence, kept as train:<slide>:<n>:<sentence hash>, so a changed sentence starts again.
export const cardsOf = (slides: Slide[]): TrainCard[] => slides.flatMap((s) => s.sentences.map((x, i) =>
  ({ key: `train:${s.n}:${i + 1}:${x.hash}`, s, i, text: x.text, words: x.text.split(/\s+/).filter(Boolean).length })));

// The card on screen: its sentence, or the chain from the slide's start once the sentences before it are at level 2
// (lib/text chainStart). parts: the sentences to say; levels: each one's level for the cue; clips: their voice clips
// in order, or null when one is missing; must: the must-say items of all of them.
export const view = (cards: TrainCard[], c: TrainCard, level: (c: TrainCard) => number | null,
  chainStart: (levels: (number | null)[], k: number) => number) => {
  const mates = cards.filter((x) => x.s === c.s), levels = mates.map(level);
  const from = chainStart(levels, c.i), lv = levels[c.i] ?? 0;
  const said = c.s.sentences.slice(from, c.i + 1);
  return {
    lv, chain: from < c.i, parts: said.map((x) => x.text), levels: levels.slice(from, c.i).map((l) => l ?? 0).concat(lv),
    clips: said.every((x) => x.clip) ? said.map((x) => x.clip as string) : null, must: said.flatMap((x) => x.must_say),
  };
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A time in words: today at 14:30, tomorrow at 09:00, Thursday at 18:00.
export const when = (t: number, now: number) => {
  const time = new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const d = days(now, t);
  return d === 0 ? `today at ${time}` : d === 1 ? `tomorrow at ${time}`
    : `${new Date(t).toLocaleDateString("en-GB", { weekday: "long" })} at ${time}`;
};

// Under the Start button.
export const startInfo = (p: { queue: { words: number }[]; due: unknown[]; news: unknown[]; next: number | null },
  minutes: number, now: number) => (p.queue.length
  ? `${plural(p.queue.length, "sentence")}, about ${plural(minutes, "minute")}. ${p.due.length} to review, ${p.news.length} new.`
  : p.next ? `Come back ${when(p.next, now)} for the next review.` : "Nothing is due.");

export const LEVELS = ["new", "level 0", "level 1", "level 2", "level 3", "learned"];

// The first line of the progress panel: today's cards, the streak, or the last session.
export const todayLine = (today: { n: number; got: number } | null, streak: number,
  last: { at: number; done: number; got: number } | null, now: number) => [
  today ? `Today: ${plural(today.n, "card")}, ${today.got} got (${Math.round((100 * today.got) / today.n)}%).` : "No cards yet today.",
  streak ? `Streak: ${plural(streak, "day")} in a row.` : "",
  last && !today ? `Last session: ${plural(last.done, "card")}, ${last.got} got, ${when(last.at, now).replace(/ at .*/, "")}.` : "",
].filter(Boolean).join(" ");

export const weakLine = (weak: { n: number; title: string; misses: number }[]) => (weak.length
  ? `Missed most: ${weak.map((w) => `${w.n}. ${w.title} (${w.misses} ${w.misses === 1 ? "miss" : "misses"})`).join("; ")}.` : "");

// Where the progress is kept.
export type Sync = "" | "saving" | "on" | "error";
export const savedLine = (state: Sync, at: number, now: number) => (state === "on"
  ? `Saved in this browser and online, ${ago(at, now)}.`
  : state === "saving" ? "Saving online..."
  : state === "error" ? "Saved in this browser; the online copy could not be reached and will be tried again."
  : "Saved in this browser.");

export type Judged = Result & { stumbles?: string[]; judge?: Verdict };

// The verdict banner over a judged card.
export const verdict = (r: Judged) => {
  const crit = r.parts.some((x) => x.critWrong);
  const missed = r.parts.flatMap((x) => x.words.filter((w) => !w.ok)
    .map((w) => w.w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")));
  const stumbles = r.stumbles ?? [];
  const detail = stumbles.length ? `You restarted: ${stumbles.map((x) => `"${x}"`).join(", ")}. Say it in one smooth line.`
    : crit ? "A number or must-say item was wrong."
    : missed.length ? `${missed.length === 1 ? "1 word" : `${missed.length} words`} missed: ${missed.slice(0, 6).join(", ")}${missed.length > 6 ? "..." : "."}`
    : r.pass ? "Word for word." : "Not quite word for word.";
  return { head: r.pass ? "Got it" : "Missed", detail, good: r.pass };
};

// The delivery line from the judge.
export const deliveryLine = (j: Verdict) =>
  `clarity ${j.clarity ?? "?"} of 5, flow ${j.fluency ?? "?"} of 5, pace ${j.pace ?? "?"}.`;

// What a card is: a chain, a review or a new sentence.
export const kind = (v: { chain: boolean }, c: TrainCard, state: Card | null) =>
  (v.chain ? `Say sentences 1 to ${c.i + 1} of this slide` : state ? "Review" : "New sentence");

// The session done screen.
export const doneLines = (s: { done: number; got: number; missed: number; top: number },
  p: { top: number; total: number; next: number | null }, now: number) => [
  s.done ? `${plural(s.done, "card")}: ${s.got} got, ${s.missed} missed. ${plural(p.top - s.top, "more sentence")} learned; `
    + `${p.top} of ${p.total} in all.` : "No cards marked.",
  p.next ? `Come back ${when(p.next, now)}: that is when the next review is due.` : "Nothing more is due before the talk.",
];

// Export and import: a file of the progress items of one talk.
export const KIND = "talk-trainer-progress";
export const exportFile = (talk: string, items: Record<string, unknown>, now: number) =>
  JSON.stringify({ kind: KIND, talk, exported: new Date(now).toISOString(), items });
export const importFile = (text: string): Record<string, unknown> => {
  let got: { kind?: string; items?: unknown };
  try { got = JSON.parse(text); } catch { throw new Error("That file is not a progress export."); }
  if (!got || got.kind !== KIND || !got.items || typeof got.items !== "object" || Array.isArray(got.items)) {
    throw new Error("That file is not a progress export.");
  }
  return got.items as Record<string, unknown>;
};
