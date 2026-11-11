// What the learning engine keeps (docs/learning.md), in the browser under talk-trainer:<talk id>: and online per talk:
// learn:n:<node id> a node's state (lib/learn/model.ts), learn:set:<name> a setting as {v, at}, and learn:log:<day>
// the day's attempts as {at, list}. Every value has an at, and when two devices disagree the newer at wins; the logs
// are joined by attempt id.
//
// The same rule holds for the old trainer's flow:s: (a sentence's score, with at) and flow:w: (a window, which had no
// at until 10 November: the one with more attempts wins).

import { hidden, type State } from "./model";
import * as rules from "./rules";
import { type Aim, FIRST, GROW } from "./rules";
import { hash, type Node, type Tree } from "./tree";

export const nodeKey = (id: string) => `learn:n:${id}`;
export const logKey = (day: string) => `learn:log:${day}`;
export const SETTINGS = { aim: "learn:set:aim", goal: "learn:set:goal", range: "learn:set:range", mic: "learn:set:mic",
  migrated: "learn:set:migrated" };

// The slides to work on: spans of slide numbers, from and to, both included ("Opening and close" is two).
export type Range = [number, number][];
export const inRange = (r: Range) => (n: number) => r.some(([a, b]) => n >= a && n <= b);
// A range kept within a talk of total slides, each span in order; an empty one is the whole talk.
export const tidy = (r: Range, total: number): Range => {
  const out = r.map(([a, b]) => [Math.min(a, b), Math.max(a, b)].map((x) => Math.min(total, Math.max(1, Math.round(x)))) as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((x, y) => x[0] - y[0]);
  return out.length ? out : [[1, total]];
};
// A range in words: "slides 1 to 4 and 83 to 86", "slide 5".
export const rangeLine = (r: Range) => `${r.length === 1 && r[0][0] === r[0][1] ? "slide" : "slides"} ${r.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`)).join(" and ")}`;
export type Setting<T> = { v: T; at: number };

// One attempt, for the metrics (lib/learn/metrics.ts). kind and height: the node's; words: its size; before: its
// estimate before the attempt; hidden: the share of its words hidden; points: the score (null when not counted);
// pass: 60 or more (null when not counted); ms: how long the judge took; gap: the time since the node was last tried
// (null: never); m: when this entry was last changed (a recount changes it).
// An attempt logged. why: the scheduler's reason, or "known" for "I know this one" (points and pass null). For fitting
// the learner later (docs/learning.md, "Tim's first sessions"): v, the version of the rules (RULES); leaves, each
// leaf's score in leaf order; probs, the judge's problems by kind; slides, on a run-through, each slide's points;
// shown, Show me used; speak, the time recorded (ms); wait, from the card shown to the first recording (ms); ms, the
// judge's time.
export type Entry = { id: string; at: number; node: string; slide: number; kind: string; height: number; words: number;
  before: number; bar: number; after: number | null; hidden: number; points: number | null; pass: boolean | null; ms: number;
  gap: number | null; why: string; m: number; v?: string; leaves?: number[]; probs?: Record<string, number>;
  slides?: [number, number][]; shown?: boolean; speak?: number; wait?: number | null;
  // getting familiar: the meaning and delivery halves of the score, and the judge's delivery ratings and tip
  read?: { meaning: number; delivery: number; clarity?: number; fluency?: number; pace?: string; tip?: string };
  // Peek: how many times it was held, and for how long in all (ms)
  peeks?: number; peekMs?: number;
  // the mode, and whether it was offline (from 11 Nov; earlier entries have neither)
  aim?: string; offline?: boolean };
// The version of the rules: a hash of every value in lib/learn/rules.ts.
export const RULES = hash(JSON.stringify(rules));
export type Log = { at: number; list: Entry[] };

// The day's log with an attempt added, or changed when it is there already.
export const logged = (log: Log | null, e: Entry): Log => {
  const list = (log?.list ?? []).filter((x) => x.id !== e.id);
  return { at: Math.max(log?.at ?? 0, e.m), list: [...list, e].sort((a, b) => a.at - b.at) };
};

// Two logs of a day joined: each attempt once, the newer copy of it.
const joinLogs = (a: Log, b: Log): Log => {
  const byId = new Map(a.list.map((x) => [x.id, x]));
  b.list.forEach((x) => { const have = byId.get(x.id); if (!have || x.m > have.m) byId.set(x.id, x); });
  return { at: Math.max(a.at, b.at), list: [...byId.values()].sort((x, y) => x.at - y.at) };
};

const at = (v: unknown) => ((v as { at?: number } | null)?.at ?? 0);

// The keys this rule covers.
export const SYNCED = /^(learn:|flow:s:|flow:w:)/;

// One key's value from two devices. mine wins a tie.
export const pick = (key: string, mine: unknown, theirs: unknown): unknown => {
  if (mine === undefined || mine === null) return theirs;
  if (theirs === undefined || theirs === null) return mine;
  if (key.startsWith("learn:log:")) return joinLogs(mine as Log, theirs as Log);
  if (key.startsWith("flow:w:") && at(mine) === at(theirs)) return (theirs as { n: number }).n > (mine as { n: number }).n ? theirs : mine;
  return at(theirs) > at(mine) ? theirs : mine;
};

// Progress from the old trainer, once: each sentence's running score (flow:s:<slide>:<i>:<hash>, i from 1) seeds that
// sentence's node and its clauses, with the interval its passes would have grown to. Nothing else is carried over.
type Old = { m: number; at: number; passes: number; n: number };
export const migrate = (tree: Tree, slides: { n: number; sentences: { i: number; hash: string }[] }[],
  get: (key: string) => unknown, aim: Aim): Record<string, State> => {
  const out: Record<string, State> = {};
  for (const slide of slides) {
    const root = tree.roots.get(slide.n);
    if (!root) continue;
    const mine = [root, ...(tree.nodes.get(root) as Node).under].map((id) => tree.nodes.get(id) as Node);
    slide.sentences.forEach((x, k) => {
      const old = get(`flow:s:${slide.n}:${x.i}:${x.hash}`) as Old | null;
      // the node over just this sentence: the tallest one that starts and ends in it
      const node = mine.filter((y) => y.first === k && y.last === k).sort((a, b) => b.height - a.height)[0];
      if (!old) return;
      const st: State = { s: old.m, at: old.at, interval: FIRST * GROW ** Math.min(old.passes, 4), n: old.n, passes: old.passes,
        lastPass: old.passes ? old.at : 0, run: 0, hid: hidden(old.m, aim) };
      [node.id, ...node.under].forEach((id) => { out[nodeKey(id)] = st; });
    });
  }
  return out;
};
