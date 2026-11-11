// Learning rates, from the attempts logged (lib/learn/store.ts Entry) and the nodes' states (docs/learning.md): the
// slides at their aim, the pass rate this session against the 70 to 85% target, the attempts each kind of node took
// to reach its bar, retention after a gap, and the parts that have taken the most attempts.

import { type States, troubleOf } from "./model";
import { type Aim, GAP, PACE_HIGH, PACE_LOW, TROUBLE_LOW } from "./rules";
import { standing } from "./scheduler";
import type { Entry } from "./store";
import type { Node, Tree } from "./tree";

// The weakest phrases: runs of words whose trouble is TROUBLE_LOW or more, the most trouble first, at most n.
export const weakest = (tree: Tree, get: States, now: number, n = 5) => {
  const out: { slide: number; phrase: string; trouble: number }[] = [];
  for (const id of tree.order) {
    const leaf = tree.nodes.get(id) as Node, t = leaf.kids.length ? null : troubleOf(get(id), now);
    if (!t) continue;
    const words = leaf.text.split(/\s+/);
    let run: number[] = [];
    const flush = () => {
      if (run.length) out.push({ slide: leaf.slides[0], phrase: run.map((w) => words[w]).join(" "), trouble: run.reduce((a, w) => a + t[w], 0) });
      run = [];
    };
    t.forEach((x, w) => { if (x >= TROUBLE_LOW) run.push(w); else flush(); });
    flush();
  }
  return out.sort((a, b) => b.trouble - a.trouble).slice(0, n).map((x) => ({ ...x, trouble: Math.round(x.trouble * 100) / 100 }));
};

const rate = (xs: Entry[]) => {
  const counted = xs.filter((x) => x.pass !== null);
  return { n: counted.length, passed: counted.filter((x) => x.pass).length,
    rate: counted.length ? counted.filter((x) => x.pass).length / counted.length : null };
};
const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// The slides to work on, from getting familiar: each slide's last attempt with a score, the lowest first, at most n,
// with the half of the score that was lower (the meaning, or the delivery).
export const weakSlides = (entries: Entry[], n = 5) => {
  const last = new Map<number, Entry>();
  entries.filter((x) => x.read && x.points !== null).forEach((x) => last.set(x.slide, x));
  return [...last.values()].sort((a, b) => (a.points as number) - (b.points as number) || a.slide - b.slide).slice(0, n)
    .map((x) => ({ slide: x.slide, points: x.points as number,
      low: (x.read as NonNullable<Entry["read"]>).meaning < (x.read as NonNullable<Entry["read"]>).delivery ? "meaning" : "delivery" }));
};

// The strip across the top of a session: each slide in talk order, how well it is known (its estimate as a share of
// its bar, at most 1), whether it was ever tried and whether it is at its bar.
export const strip = (tree: Tree, get: States, now: number, aim: Aim) => {
  const s = standing(tree, get, now, aim);
  return [...tree.roots].map(([n, id]) => ({ n, known: Math.min(1, (s.est.get(id) as number) / s.bar(id)), tried: !!get(id), at: s.at(id) }));
};

// The slides at their aim now, of the slides with a script; and how many nodes are due.
export const slidesAt = (tree: Tree, get: States, now: number, aim: Aim) => {
  const s = standing(tree, get, now, aim);
  return { at: [...tree.roots.values()].filter((id) => s.at(id)).length, total: tree.roots.size,
    due: tree.order.filter((id) => s.due(id)).length };
};

// since: when this session started. entries: every attempt logged, oldest first.
export const metrics = (entries: Entry[], since: number) => {
  const session = rate(entries.filter((x) => x.at >= since));
  // each node's attempts until the first that left it at its bar
  const byNode = new Map<string, Entry[]>();
  entries.filter((x) => x.why !== "known").forEach((x) => byNode.set(x.node, [...(byNode.get(x.node) ?? []), x]));
  const reached = new Map<string, number[]>();
  const slow: { node: string; slide: number; kind: string; attempts: number; reached: boolean }[] = [];
  byNode.forEach((xs, node) => {
    const k = xs.findIndex((x) => x.after !== null && x.after >= x.bar);
    if (k >= 0) reached.set(xs[0].kind, [...(reached.get(xs[0].kind) ?? []), k + 1]);
    slow.push({ node, slide: xs[0].slide, kind: xs[0].kind, attempts: k >= 0 ? k + 1 : xs.length, reached: k >= 0 });
  });
  return {
    session: { ...session, low: PACE_LOW, high: PACE_HIGH },
    toBar: [...reached].map(([kind, ns]) => ({ kind, nodes: ns.length, median: median(ns) })),
    retention: rate(entries.filter((x) => x.gap !== null && x.gap > GAP)),
    slowest: slow.sort((a, b) => b.attempts - a.attempts || a.slide - b.slide).slice(0, 5),
  };
};
