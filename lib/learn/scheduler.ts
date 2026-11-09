// What to say next: up and down the tree (docs/learning.md). One rule, in order:
// 1. A due node (it was at its bar and has faded below it), lowest first: within the current slide, then earlier
//    slides, then the rest. At most REVIEWS of these in a row before one step of new material, if there is one.
// 2. Else, after a miss, zoom down: the part of the missed node with the lowest estimate (a leaf is tried again; a
//    bridge goes down to its two sentences).
// 3. Else zoom up: the first node, in talk order, that is not at its bar while its parts all are. A leaf of a slide
//    already started has no parts, so it is ready.
// 4. Else the first leaf of the next new slide within today's goal.
// Pacing keeps the session's pass rate between PACE_LOW and PACE_HIGH: above it a node is ready once its parts are
// within EASE of their bars; below it a miss zooms down two levels. A node missed STUCK times running needs its parts
// LIFT above their bars before it is tried again, and they are practised until they are. A node picked SAME times in
// a row is passed over once.

import { barOf, estimates, type States } from "./model";
import { type Aim, EASE, LIFT, PACE_HIGH, PACE_LOW, PACE_MIN, PACE_OF, REVIEWS, SAME, STUCK } from "./rules";
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
export const standing = (tree: Tree, get: States, now: number, aim: Aim, session: Session = begin()) => {
  const est = estimates(tree, get, now), rate = pace(session);
  const node = (id: string) => tree.nodes.get(id) as Node;
  const bar = (id: string) => barOf(node(id), aim);
  // at its bar: attempted, and its estimate at the bar; word for word, a slide also needs its last attempt with every
  // word hidden
  const at = (id: string, margin = 0) => {
    const st = get(id);
    return !!st && (est.get(id) as number) >= bar(id) + margin && !(aim === "verbatim" && node(id).kind === "slide" && st.hid < 1);
  };
  const due = (id: string) => {
    const st = get(id);
    return !!st && st.s >= bar(id) && (est.get(id) as number) < bar(id);
  };
  const stuck = (id: string) => (get(id)?.run ?? 0) >= STUCK;
  const margin = rate !== null && rate > PACE_HIGH ? -EASE : 0;
  const ready = (id: string) => !at(id) && node(id).kids.every((k) => at(k, stuck(id) ? LIFT : margin));
  return { est, rate, bar, at, due, stuck, ready };
};

export const pick = (tree: Tree, get: States, now: number, aim: Aim, goal: number, session: Session): Pick | null => {
  const { est, rate, bar, at, due, stuck, ready } = standing(tree, get, now, aim, session);
  const node = (id: string) => tree.nodes.get(id) as Node;
  const started = new Set<number>();
  for (const id of tree.order) if (get(id)) node(id).slides.forEach((n) => started.add(n));
  const live = tree.order.filter((id) => node(id).slides.every((n) => n <= goal && started.has(n)));
  const last = session.last, skip = last && session.same >= SAME ? last.id : null;
  const make = (id: string, why: Why): Pick => ({ node: node(id), why, est: est.get(id) as number, bar: bar(id) });
  const lowest = (ids: string[]) => ids.slice().sort((a, b) => (est.get(a) as number) - (est.get(b) as number))[0];

  const choose = (skip: string | null): Pick | null => {
    const ok = (id: string) => id !== skip;
    // 1. due, current slide first, then earlier slides, then the rest
    const dues = live.filter((id) => ok(id) && due(id));
    const here = last ? Math.max(...node(last.id).slides) : 0;
    const review = lowest(dues.filter((id) => node(id).slides.includes(here)))
      ?? lowest(dues.filter((id) => Math.max(...node(id).slides) < here)) ?? lowest(dues);
    if (review && session.reviews < REVIEWS) return make(review, "due");
    // 2. down after a miss
    if (last && last.pass === false) {
      const missed = node(last.id);
      let down = missed.down.length ? lowest(missed.down) : missed.id;
      if (rate !== null && rate < PACE_LOW && node(down).down.length) down = lowest(node(down).down);
      if (ok(down)) return make(down, "down");
    }
    // 3. up: ready (a due node is a review, rule 1), and the parts of a stuck node that are below its lifted bar
    const lifted = new Set(live.filter(stuck).flatMap((id) => node(id).kids.filter((k) => !at(k, LIFT))));
    const order = (id: string) => {
      const n = node(id);
      return [Math.max(...n.slides), n.kind === "bridge" ? 1 : n.kind === "section" ? 2 : n.kind === "talk" ? 3 : 0, n.to, n.height];
    };
    const cmp = (a: string, b: string) => {
      const x = order(a), y = order(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3];
    };
    const up = live.filter((id) => ok(id) && !due(id) && (ready(id) || lifted.has(id))).sort(cmp)[0];
    if (up) return make(up, "up");
    // 4. the next new slide
    const fresh = [...tree.roots.keys()].find((n) => n <= goal && !started.has(n));
    if (fresh !== undefined) return make(tree.order.find((id) => node(id).slides[0] === fresh) as string, "new");
    return review ? make(review, "due") : null;
  };
  return choose(skip) ?? choose(null);
};

// The session after an attempt at a pick. pass: null when it was not counted.
export const after = (session: Session, p: Pick, pass: boolean | null): Session => ({
  recent: pass === null ? session.recent : [...session.recent, pass].slice(-PACE_OF),
  last: { id: p.node.id, pass },
  same: session.last?.id === p.node.id ? session.same + 1 : 1,
  reviews: p.why === "due" ? session.reviews + 1 : p.why === "down" ? session.reviews : 0,
});
