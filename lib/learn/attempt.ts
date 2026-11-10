// An attempt's result (docs/learning.md). The judge's verdict (lib/judge.ts) is scored out of 100 (lib/score.ts), and
// its problems placed on the node's leaves. An attempt is not counted when nothing was heard (no words, or a fluency
// and clarity of 1 with under EMPTY words: a tap too soon or the microphone) or when it started at another part of
// the slide (a wrong place, not forgetting). An attempt that starts right but stops early is a miss, the rest left
// out: on 9 November Tim said 5 of a slide's 128 words, it was thrown away as not heard, and marked got. Nearly (60 to
// 84) counts as a pass for the interval and moves the score by its true value. "Count it as got" or "missed", and
// marking yourself without the microphone, score the attempt RECOUNT.got or RECOUNT.missed, every leaf alike.
//
// A run-through (a section, or the whole talk) is said slide by slide, one recording each. Each slide is scored as an
// attempt at that slide, with every word hidden; a slide that was empty or started in the wrong place scores 0, as
// in a run-through it was not said. Each bridge between two slides said scores the mean of its leaves, each section
// all of whose slides were said scores the mean of its slides, and the run-through itself the mean of all of them.

import { judged, type Verdict } from "../judge";
import { grade, normalise } from "../grade";
import { empty, start } from "../score";
import { sentences } from "../text";
import { place, record, type State, type States } from "./model";
import { EMPTY, NEARLY, RECOUNT } from "./rules";
import type { Node, Tree } from "./tree";

export type Result = ReturnType<typeof judged>;
export type Outcome = { counted: false; why: string }
  | { counted: true; points: number; leaves: Map<string, number>; trouble: Map<string, number[]>; result: Result };

// The leaves of the slides a node is on, in order, and where the node starts among them.
const where = (tree: Tree, node: Node) => {
  const all = node.slides.flatMap((n) => (tree.nodes.get(tree.roots.get(n) as string) as Node).leaves);
  return { texts: all.map((id) => (tree.nodes.get(id) as Node).text), from: all.indexOf(node.leaves[0]) };
};

// An attempt at a node from the judge's verdict. must: the must-say items of its text.
export const outcome = (tree: Tree, node: Node, v: Verdict, must: string[]): Outcome => {
  const { texts, from } = where(tree, node);
  const begun = start(v.heard ?? "", texts, from);
  if (begun !== null && begun !== from) {
    const opening = (i: number) => texts[i].split(/\s+/).slice(0, 4).join(" ").replace(/[.,;:]+$/, "");
    return { counted: false, why: `That started at '${opening(begun)}'. This one starts at '${opening(from)}...'.` };
  }
  const said = normalise(v.heard ?? "").length;
  if (!said || (v.fluency === 1 && v.clarity === 1 && said < EMPTY)) return { counted: false, why: "I didn't catch that." };
  let result = judged(grade(sentences(node.text), "", must), v);
  // stopped early: whatever the judge said, the words after those heard were left out
  if (empty(v, node.text) && result.score >= NEARLY) {
    const rest = node.text.split(/\s+/).slice(said).join(" ");
    result = judged(grade(sentences(node.text), "", must),
      { ...v, meaning_ok: false, problems: [...(v.problems ?? []), { kind: "left_out", script: rest }] });
  }
  // the words missed, as placed by alignment, not only where the judge's quote matched exactly
  const at = place(tree, node, result.problems);
  let w = 0;
  const parts = result.parts.map((p) => ({ ...p, words: p.words.map((x) => {
    const k = w;
    w += 1;
    return { ...x, ok: !at.missed.has(k), crit: at.crit.has(k) };
  }) }));
  return { counted: true, points: result.score, leaves: at.leaves, trouble: at.trouble, result: { ...result, parts } };
};

// Every leaf scored alike: a recount, or marking yourself.
export const byHand = (node: Node, got: boolean) => {
  const points = got ? RECOUNT.got : RECOUNT.missed;
  return { points, leaves: new Map(node.leaves.map((l) => [l, points])) };
};

// The states a run-through writes. said: each slide said, with its points and leaf scores.
export const run = (tree: Tree, get: States, node: Node,
  said: Map<number, { points: number; leaves: Map<string, number>; trouble?: Map<string, number[]> }>,
  now: number, est: Map<string, number>): Map<string, State> => {
  const out = new Map<string, State>(), done = new Map<string, number>();
  const all = new Map([...said.values()].flatMap((x) => [...x.leaves]));
  const full = (n: Node) => new Map(n.leaves.map((l) => [l, 1]));
  for (const [n, x] of said) {
    const root = tree.nodes.get(tree.roots.get(n) as string) as Node;
    record(tree, get, root, x.leaves, x.points, now, full(root), est, x.trouble).forEach((v, k) => out.set(k, v));
    done.set(root.id, x.points);
  }
  // the bridges, then the sections, then the run-through itself, each from the parts said
  const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const inside = (id: string): string[] => {
    const x = tree.nodes.get(id) as Node;
    return x.kind === "section" || x.kind === "talk" ? [id, ...x.kids.flatMap(inside)] : x.kind === "bridge" ? [id] : [];
  };
  const runs = inside(node.id).reverse();
  for (const id of runs) {
    const x = tree.nodes.get(id) as Node;
    if (!x.slides.every((n) => said.has(n))) continue;
    const points = x.kind === "bridge" ? mean(x.leaves.map((l) => all.get(l) as number))
      : mean(x.kids.map((k) => done.get(k) as number));
    const one = x.kind === "bridge"
      ? record(tree, get, x, new Map(x.leaves.map((l) => [l, all.get(l) as number])), points, now, full(x), est).get(id) as State
      : record(tree, get, x, new Map(), points, now, new Map(), est).get(id) as State;
    out.set(id, one);
    done.set(id, points);
  }
  return out;
};
