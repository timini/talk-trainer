// How well each node of the tree is known (docs/learning.md). A node keeps a score s from 0 to 1, an exponentially
// weighted moving average of its attempts' scores, and an interval: how long it is trusted. After its interval the
// score fades, so a node comes back with more of its text showing. A pass grows the interval only when it came at
// least one interval after the last pass, so three passes in ten minutes count as one.
//
// An attempt at a node also scores every part under it, from where the judge's problems fall on its leaves
// (lib/learn/align.ts), with the smaller weight UNDER. A node is known at least as well
// as its parts, less a penalty for joining them.

import { placed } from "./align";
import type { Problem } from "../judge";
import { ALPHA, ALPHA_GOOD, type Aim, BARS, CUE, FADE, FAMILIAR_CAP, FAMILIAR_HIDE, FIRST, GIST_HIDE, GROW, HIDE_FROM, HIDE_SPAN, HIDE_STEP, JOIN, KEEP, KNOWN, NEARLY,
  GIST_CLAUSES, GIST_GROUP, GIST_TOP, GOOD, PACE_HIGH, PACE_LOW, SHIFT, SURE, TERM_HIDE, TERM_HINT, UNDER } from "./rules";
import type { Node, Tree } from "./tree";

// s: the score; at: the last attempt; interval (ms); n: attempts; passes: attempts of NEARLY or more; lastPass: when
// the last of them was (0: never); run: misses running; hid: the share of words hidden on the last attempt.
// trouble (a leaf's only): how much trouble each of its words has given, from the problems placed on it.
export type State = { s: number; at: number; interval: number; n: number; passes: number; lastPass: number; run: number; hid: number;
  trouble?: number[] };
export type States = (id: string) => State | null;

// The score now: trusted for the interval, then fading as a power of the time past it, in intervals.
export const fading = (st: State, now: number) => (1 + Math.max(0, now - st.at - st.interval) / st.interval) ** -FADE;
export const fade = (st: State, now: number) => st.s * fading(st, now);

// Every node's estimate now: its own faded score, or the mean of its parts' estimates times JOIN if that is higher (a
// leaf never attempted: 0).
export const estimates = (tree: Tree, get: States, now: number) => {
  const out = new Map<string, number>();
  const est = (id: string): number => {
    const have = out.get(id);
    if (have !== undefined) return have;
    const st = get(id), node = tree.nodes.get(id) as Node;
    const joined = node.kids.length ? JOIN * (node.kids.reduce((a, k) => a + est(k), 0) / node.kids.length) : 0;
    const v = Math.max(st ? fade(st, now) : 0, joined);
    out.set(id, v);
    return v;
  };
  tree.order.forEach(est);
  return out;
};

// The bar a node must reach at an aim.
export const barOf = (node: Node, aim: Aim) => (node.top ? BARS[aim].top : BARS[aim].node);

// A node after an attempt scored points (0 to 100). base: its estimate before; hid: the share of its words hidden;
// alpha: how far the score moves (ALPHA for the node attempted, ALPHA_GOOD after a confident pass, UNDER for the
// parts under it).
export const update = (st: State | null, base: number, points: number, now: number, hid: number, alpha = ALPHA): State => {
  const pass = points >= NEARLY;
  const spaced = !!st && st.lastPass > 0 && now - st.lastPass >= st.interval;
  return {
    s: (1 - alpha) * base + alpha * (points / 100), at: now,
    interval: !pass ? FIRST : spaced ? (st as State).interval * GROW : st?.interval ?? FIRST,
    n: (st?.n ?? 0) + 1, passes: (st?.passes ?? 0) + (pass ? 1 : 0), lastPass: pass ? now : st?.lastPass ?? 0,
    run: pass ? 0 : (st?.run ?? 0) + 1, hid,
  };
};

// The share of a leaf's words hidden at its score, in steps of HIDE_STEP: none below HIDE_FROM, all from
// HIDE_FROM + HIDE_SPAN. The gist hides at most GIST_HIDE, getting familiar at most FAMILIAR_HIDE.
export const hidden = (s: number, aim: Aim) => {
  const x = Math.min(1, Math.max(0, (s - HIDE_FROM) / HIDE_SPAN));
  return Math.min(Math.round(Math.floor(x / HIDE_STEP + 1e-9) * HIDE_STEP * 100) / 100, aim === "gist" ? GIST_HIDE : aim === "familiar" ? FAMILIAR_HIDE : 1);
};

// Each leaf's share hidden on an attempt at a node, from its estimate. rate: the session's pass rate (null: too few
// attempts yet); below PACE_LOW, SHIFT is taken off each estimate first, so more shows, and above PACE_HIGH it is
// added. Word for word, a whole slide is said with every word hidden: that is the aim.
// A leaf passed over at this aim takes the estimate of the nearest node over it that is not (up to the node attempted),
// when that is higher.
export const hiding = (tree: Tree, node: Node, est: Map<string, number>, aim: Aim, rate: number | null) => {
  const shift = rate === null ? 0 : rate < PACE_LOW ? -SHIFT : rate > PACE_HIGH ? SHIFT : 0;
  const of = (l: string) => {
    let x = tree.nodes.get(l) as Node;
    while (x !== node && skipped(x, aim) && x.parent) x = tree.nodes.get(x.parent) as Node;
    return Math.max(est.get(l) as number, est.get(x.id) as number);
  };
  return new Map(node.leaves.map((l) => [l, aim === "verbatim" && node.kind === "slide" && node.kids.length ? 1 : hidden(of(l) + shift, aim)]));
};

// The nodes not practised on their own at an aim: for the gist, the clauses of a sentence (GIST_CLAUSES) and the groups
// of GIST_GROUP sentences or fewer that are not a whole slide. With GIST_TOP the gist starts each slide whole, so its
// sentences and groups are passed over too, except a part whose last attempt missed (the slide's misses fall on it),
// until it is passed again.
// Getting familiar practises whole slides only.
const PARTS = new Set<Node["kind"]>(["clause", "clauses", "sentence", "group"]);
export const skipped = (n: Node, aim: Aim, st: State | null = null) => aim === "familiar" ? n.kind !== "slide" : aim === "gist"
  && ((GIST_TOP && (st?.run ?? 0) === 0 && PARTS.has(n.kind)) || (!GIST_CLAUSES && (n.kind === "clause" || n.kind === "clauses"))
    || (n.kind === "group" && n.last - n.first + 1 <= GIST_GROUP));

// How a leaf's terms show at its score: in full, by their first letter, or hidden like any word.
export const terms = (s: number): "full" | "initial" | "hide" => (s < TERM_HINT ? "full" : s < TERM_HIDE ? "initial" : "hide");

// The words shown as cues on a node: its first CUE words and those of each of its parts, until it has been passed
// once.
export const cues = (tree: Tree, node: Node, st: State | null): string[] => {
  if (st?.passes || node.kids.length < 2) return [opening(node.text)];
  return [node, ...node.kids.map((k) => tree.nodes.get(k) as Node)].map((x) => opening(x.text));
};
export const opening = (text: string) => text.split(/\s+/).slice(0, CUE).join(" ");

// The score of every node an attempt touches. leafScores: each leaf's score from where the problems fell (the
// attempted node gets points, its own score); a part gets the mean of its leaves' scores, by their words.
export const scores = (tree: Tree, node: Node, leafScores: Map<string, number>, points: number) => {
  const out = new Map<string, number>([[node.id, points]]);
  for (const id of node.under) {
    const x = tree.nodes.get(id) as Node;
    const ws = x.leaves.map((l) => (tree.nodes.get(l) as Node).words);
    out.set(id, Math.round(x.leaves.reduce((a, l, k) => a + (leafScores.get(l) as number) * ws[k], 0) / ws.reduce((a, b) => a + b, 0)));
  }
  return out;
};

// The judge's problems placed on the node's leaves (lib/learn/align.ts): each leaf's score and the trouble each of its
// words takes on, and the words missed and the wrong terms, by their place in the node's text.
export const place = (tree: Tree, node: Node, problems: Problem[]) => {
  const got = placed(problems, node.leaves.map((l) => (tree.nodes.get(l) as Node).text));
  return { leaves: new Map(node.leaves.map((l, k) => [l, got.scores[k]])), trouble: new Map(node.leaves.map((l, k) => [l, got.trouble[k]])),
    missed: got.missed, crit: got.crit };
};

// A leaf's trouble now, a number a word: its stored trouble faded as its score fades (null: none yet).
export const troubleOf = (st: State | null, now: number) => (st?.trouble ? st.trouble.map((x) => x * fading(st, now)) : null);
// A leaf's trouble after an attempt: each word hit goes up by what it was hit with, every other word is kept KEEP.
const troubled = (st: State | null, now: number, add: number[]) => {
  const old = troubleOf(st, now);
  return add.map((a, w) => Math.round(((old?.[w] ?? 0) * (a > 0 ? 1 : KEEP) + a) * 100) / 100);
};

// The new states an attempt writes: the attempted node and every part under it, each with its own score. hide: each
// leaf's share hidden on this attempt.
// trouble: what each leaf's words took on in this attempt; without it, the trouble stays as it was.
export const record = (tree: Tree, get: States, node: Node, leafScores: Map<string, number>, points: number, now: number,
  hide: Map<string, number>, est: Map<string, number>, trouble?: Map<string, number[]>): Map<string, State> => {
  const out = new Map<string, State>();
  for (const [id, p] of scores(tree, node, leafScores, points)) {
    const x = tree.nodes.get(id) as Node, leaves = x.leaves.length ? x.leaves : [id];
    const ws = leaves.map((l) => (tree.nodes.get(l) as Node).words), all = ws.reduce((a, b) => a + b, 0);
    const hid = leaves.reduce((a, l, k) => a + (hide.get(l) ?? 1) * ws[k], 0) / all;
    const h = Math.round(hid * 100) / 100, alpha = id !== node.id ? UNDER : p >= GOOD && h >= SURE ? ALPHA_GOOD : ALPHA;
    const st = get(id), next = update(st, est.get(id) as number, p, now, h, alpha);
    const add = trouble?.get(id);
    if (add) next.trouble = troubled(st, now, add);
    else if (st?.trouble) next.trouble = st.trouble;
    out.set(id, next);
  }
  return out;
};

// Getting familiar: no node's score goes above FAMILIAR_CAP, or above where it was if that is higher.
export const familiar = (states: Map<string, State>, get: States) =>
  new Map([...states].map(([id, st]) => [id, { ...st, s: Math.min(st.s, Math.max(get(id)?.s ?? 0, FAMILIAR_CAP)) }]));

// "I know this one": the node and every part under it to KNOWN, passed now.
export const known = (tree: Tree, get: States, node: Node, now: number): Map<string, State> =>
  new Map([node.id, ...node.under].map((id) => {
    const st = get(id);
    return [id, { s: Math.max(KNOWN, st?.s ?? 0), at: now, interval: st?.interval ?? FIRST, n: st?.n ?? 0,
      passes: Math.max(1, st?.passes ?? 0), lastPass: now, run: 0, hid: 1 }];
  }));
