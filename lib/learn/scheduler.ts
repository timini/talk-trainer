// What to say next: up and down the tree (docs/learning.md). One rule, in order:
// 1. A due node (it was at its bar and has faded below it), lowest first: within the current slide, then earlier
//    slides, then the rest. At most REVIEWS of these in a row before one step of new material, if there is one.
// 2. Else, after a miss, zoom down: the part of the missed node with the lowest estimate (a leaf is tried again; a
//    bridge goes down to its two sentences).
// 3. Else zoom up: the first node, in talk order, that is not at its bar while its parts all are. A leaf of a slide
//    already started has no parts, so it is ready.
// 4. Else the first leaf of the next new slide within today's range of slides.
// Pacing keeps the session's pass rate between PACE_LOW and PACE_HIGH: above it a node is ready once its parts are
// within EASE of their bars; below it a miss zooms down two levels. A node missed STUCK times running needs its parts
// LIFT above their bars before it is tried again, and they are practised until they are. A node picked SAME times in
// a row is passed over once. The slides getting familiar found hard (weak) come before the rest of rule 3. Getting
// familiar goes breadth first: the next new slide comes first, then rule 1, then
// rule 3, and a miss does not go down; with nothing left it reads on in talk order (readOn).

import { barOf, estimates, fade, skipped, type States } from "./model";
import { type Aim, EASE, LIFT, PACE_HIGH, PACE_LOW, PACE_MIN, PACE_OF, REVIEWS, SAME, STUCK, SURE } from "./rules";
import type { Node, Tree } from "./tree";

// The session so far: each counted attempt's pass, the last attempt, how many times running that node was picked,
// and the due reviews since the last step of new material.
export type Session = { recent: boolean[]; last: { id: string; pass: boolean | null } | null; same: number; reviews: number };
export const begin = (): Session => ({ recent: [], last: null, same: 0, reviews: 0 });
export type Why = "due" | "down" | "up" | "new";
export type Pick = { node: Node; why: Why; est: number; bar: number };

// The session's pass rate, once there are PACE_MIN counted attempts; null before.
export const pace = (s: Session) => {
  const r = s.recent.slice(-PACE_OF);
  return r.length < PACE_MIN ? null : r.filter(Boolean).length / r.length;
};

// Where each node stands now.
// weak: the slides getting familiar found hard, in the order to take them (lowest first); at the gist they start at
// their sentences. gistTop: the gist pass level for a slide or a run-through (barOf).
export const standing = (tree: Tree, get: States, now: number, aim: Aim, session: Session = begin(), weak: number[] = [],
  gistTop?: number) => {
  const est = estimates(tree, get, now), rate = pace(session);
  const node = (id: string) => tree.nodes.get(id) as Node;
  const bar = (id: string) => barOf(node(id), aim, gistTop);
  // at its bar: attempted, its last attempt not a miss, and its own faded score at the bar (not the estimate from its
  // parts: a node just missed is not known, however well its parts are, nor however high its score still is); word for
  // word, a slide also needs its last attempt with every word hidden. A run-through the same (13 Nov: it climbs the
  // ladder too, so word for word it needs the opener list, hid 1).
  const at = (id: string, margin = 0) => {
    const st = get(id), top = TOP.has(node(id).kind);
    return !!st && st.run === 0 && fade(st, now) >= bar(id) + margin && !(aim === "verbatim" && top && st.hid < 1)
      // at the gist, a slide also needs its last attempt with at least SURE hidden (11 Nov: a slide read in getting
      // familiar reached the gist's bar after one attempt with 20% hidden)
      && !(aim === "gist" && top && st.hid < SURE);
  };
  const due = (id: string) => {
    const st = get(id);
    return !!st && st.s >= bar(id) && (est.get(id) as number) < bar(id);
  };
  const stuck = (id: string) => (get(id)?.run ?? 0) >= STUCK;
  const margin = rate !== null && rate > PACE_HIGH ? -EASE : 0;
  // a node's parts and where a miss goes down to, through the parts passed over at this aim
  const hard = new Set(weak);
  const skip = (id: string) => skipped(node(id), aim, get(id), hard.has(node(id).slides[0]));
  const through = (ids: string[]): string[] => ids.flatMap((k) => (skip(k) ? through(node(k).kids) : [k]));
  const parts = (id: string) => through(node(id).kids);
  const down = (id: string) => through(node(id).down);
  // a part anywhere under a node whose last attempt missed (passing over the parts not practised at this aim): the node
  // waits for it, so a climb never passes over a miss
  const below = new Map<string, boolean>();
  const missedBelow = (id: string): boolean => {
    const have = below.get(id);
    if (have !== undefined) return have;
    const v = parts(id).some((k) => (get(k)?.run ?? 0) > 0 || missedBelow(k));
    below.set(id, v);
    return v;
  };
  const ready = (id: string) => !skip(id) && !at(id) && !missedBelow(id) && parts(id).every((k) => at(k, stuck(id) ? LIFT : margin));
  return { est, rate, bar, at, due, stuck, ready, skip, parts, down };
};

// The nodes whose last attempt must have hidden enough to count: a slide and the run-throughs.
const TOP = new Set<Node["kind"]>(["slide", "section", "talk"]);
// In talk order, a slide's own nodes come before the bridge after it, then the section, then the talk.
const RANK: Partial<Record<Node["kind"], number>> = { bridge: 1, section: 2, talk: 3 };

// goal: the slides to work on now, the last one (from slide 1) or a test of a slide's number; nothing outside it is
// picked, so a due node outside it waits.
export const pick = (tree: Tree, get: States, now: number, aim: Aim, goal: number | ((n: number) => boolean), session: Session,
  weak: number[] = [], gistTop?: number): Pick | null => {
  const within = typeof goal === "number" ? (n: number) => n <= goal : goal;
  const { est, rate, bar, at, due, stuck, ready, skip: passed, parts, down: under } = standing(tree, get, now, aim, session, weak, gistTop);
  const node = (id: string) => tree.nodes.get(id) as Node;
  const started = new Set<number>();
  for (const id of tree.order) if (get(id)) node(id).slides.forEach((n) => started.add(n));
  const live = tree.order.filter((id) => !passed(id) && node(id).slides.every((n) => within(n) && started.has(n)));
  const last = session.last, skip = last && session.same >= SAME ? last.id : null;
  const make = (id: string, why: Why): Pick => ({ node: node(id), why, est: est.get(id) as number, bar: bar(id) });
  const lowest = (ids: string[]) => ids.slice().sort((a, b) => (est.get(a) as number) - (est.get(b) as number))[0];

  const choose = (skip: string | null): Pick | null => {
    const ok = (id: string) => id !== skip;
    const fresh = [...tree.roots.keys()].find((n) => within(n) && !started.has(n));
    const first = (n: number) => make(tree.order.find((id) => node(id).slides[0] === n && !passed(id)) as string, "new");
    if (aim === "familiar" && fresh !== undefined) return first(fresh);
    // 1. due, current slide first, then earlier slides, then the rest
    const dues = live.filter((id) => ok(id) && due(id));
    const here = last ? Math.max(...node(last.id).slides) : 0;
    const review = lowest(dues.filter((id) => node(id).slides.includes(here)))
      ?? lowest(dues.filter((id) => Math.max(...node(id).slides) < here)) ?? lowest(dues);
    if (review && session.reviews < REVIEWS) return make(review, "due");
    // 2. down after a miss
    if (last && last.pass === false && aim !== "familiar") {
      const missed = node(last.id);
      let down = under(missed.id).length ? lowest(under(missed.id)) : missed.id;
      if (rate !== null && rate < PACE_LOW && under(down).length) down = lowest(under(down));
      if (ok(down)) return make(down, "down");
    }
    // 3. up: ready (a due node is a review, rule 1), and the parts of a stuck node that are below its lifted bar
    const lifted = new Set(live.filter(stuck).flatMap((id) => parts(id).filter((k) => !at(k, LIFT))));
    const order = (id: string) => {
      const n = node(id);
      return [Math.max(...n.slides), RANK[n.kind] ?? 0, n.to, n.height];
    };
    const cmp = (a: string, b: string) => {
      const x = order(a), y = order(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3];
    };
    const candidates = live.filter((id) => ok(id) && !due(id) && (ready(id) || lifted.has(id))).sort(cmp);
    // the slides getting familiar found hard come first, the hardest first (Tim, 11 Nov)
    const hard = weak.flatMap((n) => candidates.filter((id) => node(id).slides.includes(n)).slice(0, 1))[0];
    if (hard) return make(hard, "up");
    const up = candidates[0];
    if (up) return make(up, "up");
    // 4. the next new slide
    if (fresh !== undefined) return first(fresh);
    return review ? make(review, "due") : null;
  };
  return choose(skip) ?? choose(null);
};

// Getting familiar with nothing due or ready: read on, the slide after the last one in talk order within the range,
// back to the first after the end, at its own level of hiding (Tim, 12 Nov: a second read-through of the whole talk).
export const readOn = (tree: Tree, within: (n: number) => boolean, last: string | null, now: number, get: States): Pick | null => {
  const slides = [...tree.roots.keys()].filter(within).sort((x, y) => x - y);
  const here = last ? Math.max(...(tree.nodes.get(last) as Node).slides) : 0;
  const n = slides.find((x) => x > here) ?? slides[0];
  if (n === undefined) return null;
  const id = tree.roots.get(n) as string, est = estimates(tree, get, now);
  return { node: tree.nodes.get(id) as Node, why: "up", est: est.get(id) as number, bar: barOf(tree.nodes.get(id) as Node, "familiar") };
};

// The session after an attempt at a pick. pass: null when it was not counted.
export const after = (session: Session, p: Pick, pass: boolean | null): Session => ({
  recent: pass === null ? session.recent : [...session.recent, pass].slice(-PACE_OF),
  last: { id: p.node.id, pass },
  same: session.last?.id === p.node.id ? session.same + 1 : 1,
  reviews: p.why === "due" ? session.reviews + 1 : p.why === "down" ? session.reviews : 0,
});
