// A simulated learner and a driver that runs the learning engine against it, for tests/sim/sim.test.ts.
//
// The learner keeps a memory of each leaf (clause) and of each join between two leaves: a strength m and a
// stability S. The chance of recalling it is m * 0.5^(elapsed / S). A word shown is read, with chance READ; so a leaf
// with a share h hidden is said with chance (1 - h) * READ + h * recall, and the join into it likewise. Fitted to
// Tim's 226 attempts on 9 November: a known sentence said alone passed 81%, two sentences 34% (0.81 * 0.81 * a join of
// about 0.5), and hiding anything cost about 28 points (READ against recall). Practice moves m toward 1, more when the
// words were hidden (retrieval practice), and a success after a gap grows S (spacing).

import { hiding, type State } from "@/lib/learn/model";
import { run } from "@/lib/learn/attempt";
import { record } from "@/lib/learn/model";
import { after, begin, pick, type Pick, standing } from "@/lib/learn/scheduler";
import type { Aim } from "@/lib/learn/rules";
import { build, type Input, type Node, type Tree } from "@/lib/learn/tree";

export const READ = 0.95;
const MIN = 60000, HOUR = 60 * MIN;

// A seeded random number generator (mulberry32).
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Mem = { m: number; S: number; at: number };
const WORDS = "the data shows that most of our variants are rare and hard to read without more evidence from families".split(" ");

// A slide of n sentences, each 6 to 22 words; a long one has commas, so it splits into clauses.
export const slide = (n: number, k: number, rand: () => number): Input => ({
  n: k,
  sentences: Array.from({ length: n }, (_, i) => {
    const len = 6 + Math.floor(rand() * 17);
    const words = Array.from({ length: len }, (_, w) => `${WORDS[(w * 7 + i * 3 + k) % WORDS.length]}${w > 0 && w % 6 === 5 ? "," : ""}`);
    return { text: `S${k}x${i} ${words.join(" ")}.` };
  }),
});

// How a learner learns: read, the chance of reading a shown word aloud right; join0, a new join between sentences;
// S0, how long a new memory lasts (halving time); grow, how much a retrieval after a gap makes it last longer; per,
// the words a leaf's recall is for (a leaf of 2 * per words is recalled with the chance squared; 0: any length alike);
// back, after a slip, the chance of finding the place again at the next hidden leaf (1: a slip never trails on);
// cue, how much a join leans on the words shown around it: it is read with the chance (1 - h) ^ cue, h the share
// hidden (1: as much as a word does; 2 or more: a few words shown help a join little).
export type Fit = { read: number; join0: number; S0: number; grow: number; per: number; back: number; cue: number };
export const FIT_9_NOV: Fit = { read: READ, join0: 0.5, S0: 180 * MIN, grow: 1.5, per: 0, back: 1, cue: 1 };
// Refitted to Tim's 36 attempts with /learn on 9 and 10 November, half hidden at the gist with each sentence known
// (passing alone about 86%): under 15 words 89%, 15 to 30 words 73%, 30 to 60 words 38%, 60 or more 25%. This learner
// gives 90%, 60% (two sentences; a long sentence alone is 89%, so the bucket is about 73%), 38% and 24%.
export const FIT_10_NOV: Fit = { read: READ, join0: 0.4, S0: 180 * MIN, grow: 1.5, per: 0, back: 0.2, cue: 4 };
// Fitted to Tim's first 167 attempts with /learn (9 and 10 November) by replaying his four sessions on the shape of
// his talk (tests/sim/budget.ts): a grid of 648 learners scored on the pass rates by kind and by length, first
// attempts, attempts after more than 3 hours, and the slides started and at the bar. A memory lasts longer (8 hours
// before spacing) and a spaced success grows it more (3 times): he passed 86% after a night. The best few fits are
// close; they differ most in the joins, which the log cannot tell apart while the pacing holds the pass rate in its
// band (docs/learning.md, "Tim's first sessions").
export const FIT_11_NOV: Fit = { read: READ, join0: 0.55, S0: 8 * HOUR, grow: 3, per: 0, back: 0.2, cue: 4 };

export class Learner {
  private mem = new Map<string, Mem>();
  private join0: number;
  private S0: number;
  private grow: number;
  constructor(private rand: () => number, join0: number | Fit = 0.5, S0 = 180 * MIN, grow = 1.5, private fit?: Fit) {
    const f = typeof join0 === "number" ? { ...FIT_9_NOV, join0, S0, grow } : join0;
    this.fit = f;
    this.join0 = f.join0;
    this.S0 = f.S0;
    this.grow = f.grow;
  }
  private get(key: string, start: number, now: number): Mem {
    let x = this.mem.get(key);
    if (!x) { x = { m: start, S: this.S0, at: now }; this.mem.set(key, x); }
    return x;
  }
  // Set a leaf's strength, for the fit to the data.
  know(key: string, m: number, now: number) { this.mem.set(key, { m, S: this.S0, at: now }); }
  private recall(x: Mem, now: number) { return x.m * 0.5 ** ((now - x.at) / x.S); }
  private learn(x: Mem, ok: boolean, h: number, now: number) {
    const cur = this.recall(x, now), gap = now - x.at;
    x.m = cur + (ok ? 0.25 + 0.35 * h : 0.1) * (1 - cur);
    if (ok && h > 0.3) x.S *= this.grow + 2 * Math.min(1, gap / x.S);
    x.at = now;
  }
  // Say the leaves of a node with these shares hidden: each leaf's score. A leaf's first word after another leaf goes
  // through the join between them; clauses of one sentence join more easily than sentences. learn: false to test
  // without practising (Saturday).
  say(tree: Tree, leaves: string[], hide: Map<string, number>, now: number, learn = true): Map<string, number> {
    const out = new Map<string, number>(), f = this.fit as Fit;
    const keep = (x: Mem) => (learn ? x : { ...x });
    let lost = false;
    leaves.forEach((l, i) => {
      const h = hide.get(l) as number, leaf = keep(this.get(l, 0, now)), words = (tree.nodes.get(l) as Node).words;
      const recall = this.recall(leaf, now) ** (f.per ? words / f.per : 1);
      let ok = this.rand() < (1 - h) * f.read + h * recall;
      if (i > 0) {
        const a = tree.nodes.get(leaves[i - 1]) as Node, b = tree.nodes.get(l) as Node;
        const inner = a.slides[0] === b.slides[0] && a.first === b.first;
        const j = keep(this.get(`${leaves[i - 1]}>${l}`, inner ? 0.85 : this.join0, now));
        const shown = (1 - h) ** f.cue;
        const joined = this.rand() < shown * f.read + (1 - shown) * this.recall(j, now);
        this.learn(j, joined, h, now);
        ok = ok && joined;
      }
      // lost the place: trailing off, unless the place is found again or the words are shown
      if (lost && f.back < 1 && this.rand() >= (1 - h) + h * f.back) ok = false;
      lost = !ok;
      this.learn(leaf, ok, h, now);
      out.set(l, ok ? (this.rand() < 0.85 ? 100 : 75) : Math.round(this.rand() * 40));
    });
    return out;
  }
}

export type Run = { attempts: number; reached: number | null; passes: number; counted: number; sameMax: number;
  sessions: number; picks: Pick[]; skips: number; log: { sentences: number; words: number; hid: number; pass: boolean }[] };

// Practise a talk until its top node (the talk, or the one slide) is at its bar: sessions of 30 minutes, with gaps
// of 3 hours and 14 hours in turn, at most 40 sessions.
export const practise = (slides: Input[], aim: Aim, seed: number, join0 = 0.5): Run => {
  const tree = build(slides), rand = rng(seed), learner = new Learner(rand, join0);
  const states = new Map<string, State>();
  const get = (id: string) => states.get(id) ?? null;
  const top = tree.talk ?? (tree.roots.get(slides[0].n) as string);
  let now = Date.UTC(2026, 10, 9, 8), attempts = 0, passes = 0, counted = 0, sameMax = 0, sessions = 0;
  const picks: Pick[] = [], log: Run["log"] = [];
  // a climb after a miss that skips the missed node: a node over it tried (to go up) before it
  let missed: Node | null = null, skips = 0;
  const over = (p: Node, x: Node) => p !== x && (p.under.includes(x.id) || ((p.kind === "section" || p.kind === "talk")
    && x.slides.every((n) => p.slides.includes(n))));
  for (; sessions < 40; sessions += 1) {
    let session = begin();
    const end = now + 30 * MIN;
    while (now < end) {
      const p = pick(tree, get, now, aim, Infinity, session);
      if (!p) break;
      const { est, rate } = standing(tree, get, now, aim, session);
      const node = p.node;
      let points: number;
      if (node.kind === "section" || node.kind === "talk") {
        const said = new Map<number, { points: number; leaves: Map<string, number> }>();
        for (const n of node.slides) {
          const root = tree.nodes.get(tree.roots.get(n) as string) as Node;
          const leaves = learner.say(tree, root.leaves, new Map(root.leaves.map((l) => [l, 1])), now);
          said.set(n, { points: mean(root, tree, leaves), leaves });
          now += (15 + 0.4 * root.words) * 1000;
        }
        run(tree, get, node, said, now, est).forEach((v, k) => states.set(k, v));
        points = [...said.values()].reduce((a, x) => a + x.points, 0) / said.size;
      } else {
        const hide = hiding(tree, node, est, aim, rate);
        const leaves = learner.say(tree, node.leaves, hide, now);
        points = mean(node, tree, leaves);
        log.push({ sentences: node.last - node.first + 1 + (node.kind === "bridge" ? 1 : 0), words: node.words,
          hid: Math.max(...hide.values()), pass: points >= 60 });
        now += (15 + 0.4 * node.words) * 1000;
        record(tree, get, node, leaves, points, now, hide, est).forEach((v, k) => states.set(k, v));
      }
      if (missed && p.why === "up" && over(node, missed)) skips += 1;
      if (missed && (node === missed || !(missed.slides.some((n) => node.slides.includes(n))))) missed = null;
      picks.push(p);
      attempts += 1;
      counted += 1;
      if (points >= 60) passes += 1;
      session = after(session, p, points >= 60);
      if (points < 60) missed = node;
      sameMax = Math.max(sameMax, session.same);
      if (standing(tree, get, now, aim).at(top)) {
        return { attempts, reached: attempts, passes, counted, sameMax, sessions: sessions + 1, picks, skips, log };
      }
    }
    now = end + (sessions % 2 ? 14 : 3) * HOUR;
  }
  return { attempts, reached: null, passes, counted, sameMax, sessions, picks, skips, log };
};

// A node's score from its leaves' scores, by their words.
const mean = (node: Node, tree: Tree, leaves: Map<string, number>) => {
  const ws = node.leaves.map((l) => (tree.nodes.get(l) as Node).words);
  return Math.round(node.leaves.reduce((a, l, k) => a + (leaves.get(l) as number) * ws[k], 0) / ws.reduce((a, b) => a + b, 0));
};
