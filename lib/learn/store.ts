// What the learning engine keeps (docs/learning.md), in the browser under talk-trainer:<talk id>: and online per talk:
// learn:n:<node id> a node's state (lib/learn/model.ts), learn:set:<name> a setting as {v, at}, and learn:log:<day>
// the day's attempts as {at, list}. Every value has an at, and when two devices disagree the newer at wins; the logs
// are joined by attempt id.
//
// The same rule holds for the old trainer's flow:s: (a sentence's score, with at) and flow:w: (a window, which had no
// at until 10 November: the one with more attempts wins).

import { hidden, type State } from "./model";
import { type Aim, FIRST, GROW } from "./rules";
import type { Node, Tree } from "./tree";

export const nodeKey = (id: string) => `learn:n:${id}`;
export const logKey = (day: string) => `learn:log:${day}`;
export const SETTINGS = { aim: "learn:set:aim", goal: "learn:set:goal", mic: "learn:set:mic", migrated: "learn:set:migrated" };
export type Setting<T> = { v: T; at: number };

// One attempt, for the metrics (lib/learn/metrics.ts). kind and height: the node's; words: its size; before: its
// estimate before the attempt; hidden: the share of its words hidden; points: the score (null when not counted);
// pass: 60 or more (null when not counted); ms: how long the judge took; gap: the time since the node was last tried
// (null: never); m: when this entry was last changed (a recount changes it).
export type Entry = { id: string; at: number; node: string; slide: number; kind: string; height: number; words: number;
  before: number; bar: number; after: number | null; hidden: number; points: number | null; pass: boolean | null; ms: number;
  gap: number | null; why: string; m: number };
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
