import { describe, expect, test } from "vitest";
import { estimates, hiding, record, type State } from "@/lib/learn/model";
import { FIRST, PACE_OF, REVIEWS } from "@/lib/learn/rules";
import { after, begin, pace, pick, type Session, standing } from "@/lib/learn/scheduler";
import { build, type Input, type Node } from "@/lib/learn/tree";

const said = (n: number, texts: string[]): Input => ({ n, sentences: texts.map((text) => ({ text })) });
// slide 1: two sentences; slide 2: one; slide 3: one. A bridge from 1 to 2 and from 2 to 3, and the talk.
const tree = build([said(1, ["Good morning, and thank you for coming.", "Today we bake bread."]), said(2, ["Mix the flour."]),
  said(3, ["Then let it rest."])]);
const [a, b, one, two, three] = tree.order;
const bridge12 = tree.order.find((id) => id.startsWith("b:1:")) as string;
const bridge23 = tree.order.find((id) => id.startsWith("b:2:")) as string;
const NOW = 1e12;
const st = (s: number, over: Partial<State> = {}): State => ({ s, at: NOW, interval: FIRST, n: 1, passes: 1, lastPass: NOW, run: 0, hid: 1, ...over });
const from = (states: Record<string, State>) => (id: string) => states[id] ?? null;
const session = (over: Partial<Session> = {}): Session => ({ ...begin(), ...over });
const go = (states: Record<string, State>, s: Session = begin(), aim: "gist" | "verbatim" = "verbatim", goal = Infinity, now = NOW) => {
  const p = pick(tree, from(states), now, aim, goal, s);
  return p && [p.node.id, p.why];
};
const known = { [a]: st(0.9), [b]: st(0.9), [one]: st(0.9), [two]: st(0.9), [three]: st(0.9), [bridge12]: st(0.9), [bridge23]: st(0.9) };

describe("pace", () => {
  test("the pass rate of the last 10 counted attempts, once there are 5", () => {
    expect(pace(session({ recent: [true, true, true, false] }))).toBeNull();
    expect(pace(session({ recent: [true, true, true, false, true] }))).toBe(0.8);
    expect(pace(session({ recent: [...Array(10).fill(false), true, true] }))).toBe(0.2);
  });
});

describe("standing", () => {
  test("at its bar only once tried; word for word a slide only after an attempt with all of it hidden; due once faded", () => {
    const s = standing(tree, from({ [a]: st(0.8), [b]: st(0.7), [one]: st(0.9, { hid: 0.5 }) }), NOW, "verbatim");
    expect([s.at(a), s.at(b), s.at(one), s.at(two)]).toEqual([true, false, false, false]);
    expect(standing(tree, from({ [one]: st(0.9, { hid: 0.5 }) }), NOW, "gist").at(one)).toBe(true);
    const later = standing(tree, from({ [a]: st(0.8) }), NOW + 5 * FIRST, "verbatim");
    expect([later.at(a), later.due(a), later.due(b)]).toEqual([false, true, false]);
    // missed below its bar: not due, it is just not known yet
    expect(standing(tree, from({ [a]: st(0.5) }), NOW + 5 * FIRST, "verbatim").due(a)).toBe(false);
  });

  test("ready: not at its bar, its parts at theirs (within EASE when the pace is high; LIFT above when it is stuck)", () => {
    expect(standing(tree, from({ [a]: st(0.8), [b]: st(0.8) }), NOW, "verbatim").ready(one)).toBe(true);
    expect(standing(tree, from({ [a]: st(0.8), [b]: st(0.72) }), NOW, "verbatim").ready(one)).toBe(false);
    const fast = session({ recent: Array(10).fill(true) });
    expect(standing(tree, from({ [a]: st(0.8), [b]: st(0.72) }), NOW, "verbatim", fast).ready(one)).toBe(true);
    const stuck = { [a]: st(0.8), [b]: st(0.8), [one]: st(0.3, { run: 3 }) };
    expect(standing(tree, from(stuck), NOW, "verbatim").ready(one)).toBe(false);
    expect(standing(tree, from({ ...stuck, [a]: st(0.86), [b]: st(0.9) }), NOW, "verbatim").ready(one)).toBe(true);
    expect(standing(tree, from({}), NOW, "verbatim").ready(a)).toBe(true);
  });
});

describe("pick", () => {
  test("a new talk starts at the first leaf; then each part in order, a node once its parts are at their bars", () => {
    expect(go({})).toEqual([a, "new"]);
    expect(go({ [a]: st(0.5) })).toEqual([a, "up"]);
    expect(go({ [a]: st(0.8) })).toEqual([b, "up"]);
    expect(go({ [a]: st(0.8), [b]: st(0.8) })).toEqual([one, "up"]);
    // the slide known: the next slide, then the bridge between them once both are known
    expect(go({ [a]: st(0.8), [b]: st(0.8), [one]: st(0.9) })).toEqual([two, "new"]);
    expect(go({ [a]: st(0.8), [b]: st(0.8), [one]: st(0.9), [two]: st(0.9) })).toEqual([bridge12, "up"]);
    // everything known but the talk: the run-through
    expect(go(known)).toEqual(["t", "up"]);
    expect(go({ ...known, t: st(0.9) })).toBeNull();
  });

  test("today's goal: no new slide past it, and nothing that reaches past it", () => {
    expect(go({ [a]: st(0.8), [b]: st(0.8), [one]: st(0.9) }, begin(), "verbatim", 1)).toBeNull();
    expect(go({ ...known, [bridge23]: st(0.1, { passes: 0 }) }, begin(), "verbatim", 2)).toBeNull();
  });

  test("a faded node comes back first: the current slide, then earlier slides, then the rest, lowest first", () => {
    const faded = (s: number) => st(s, { at: NOW - 30 * FIRST });
    const old = { ...known, [a]: faded(0.8), t: st(0.9) };
    expect(go(old)).toEqual([a, "due"]);
    // the last attempt on slide 3: its own faded node first, then slide 1's (an earlier slide)
    const s3 = session({ last: { id: three, pass: true }, same: 1 });
    expect(go({ ...old, [three]: faded(0.9) }, s3)).toEqual([three, "due"]);
    expect(go(old, s3)).toEqual([a, "due"]);
    // the lowest first
    expect(go({ ...old, [b]: faded(0.76) })).toEqual([b, "due"]);
    // after REVIEWS reviews, a step of new material if there is one, else the review
    const many = session({ reviews: REVIEWS });
    expect(go({ [a]: faded(0.8), [b]: st(0.8), [one]: st(0.9) }, many)).toEqual([two, "new"]);
    expect(go(old, many)).toEqual([a, "due"]);
    // the rest: a later slide's faded node when the last attempt was on slide 1
    const s1 = session({ last: { id: a, pass: true }, same: 1 });
    expect(go({ ...known, t: st(0.9), [two]: faded(0.9) }, s1)).toEqual([two, "due"]);
  });

  test("after a miss, down to the weakest part; a leaf again; a bridge to its sentences; two levels when the pace is low", () => {
    const missed = (id: string, more: Partial<Session> = {}) => session({ last: { id, pass: false }, same: 1, ...more });
    expect(go({ [a]: st(0.8), [b]: st(0.6), [one]: st(0.5) }, missed(one))).toEqual([b, "down"]);
    expect(go({ [a]: st(0.3) }, missed(a))).toEqual([a, "down"]);
    expect(go({ ...known, [b]: st(0.6), [bridge12]: st(0.4) }, missed(bridge12))).toEqual([b, "down"]);
    const t2 = build([said(1, ["We looked at the data closely, and we found that most variants were rare; so we asked families."]),
      said(2, ["Hello."])]);
    const [c1, c2, c12, c3, root] = t2.order;
    const low = missed(root, { recent: [false, false, false, false, false] });
    const states = { [c1]: st(0.8), [c2]: st(0.5), [c12]: st(0.6), [c3]: st(0.8), [root]: st(0.4) };
    expect(pick(t2, from(states), NOW, "verbatim", Infinity, low)?.node.id).toBe(c2);
    expect(pick(t2, from(states), NOW, "verbatim", Infinity, missed(root))?.node.id).toBe(c12);
    // two levels down from a node whose weakest part is a leaf: just the leaf
    expect(pick(t2, from(states), NOW, "verbatim", Infinity, missed(c12, { recent: [false, false, false, false, false] }))?.node.id).toBe(c2);
  });

  test("a stuck node: its parts practised until LIFT above their bars, then it again", () => {
    const stuck = { [a]: st(0.8), [b]: st(0.9), [one]: st(0.3, { run: 3 }) };
    expect(go(stuck)).toEqual([a, "up"]);
    expect(go({ ...stuck, [a]: st(0.86) })).toEqual([one, "up"]);
  });

  test("a node picked 3 times in a row is passed over once, unless there is nothing else", () => {
    const s = session({ last: { id: a, pass: true }, same: 3 });
    expect(go({ [a]: st(0.5) }, s)).toEqual([b, "up"]);
    expect(go({ [a]: st(0.5), [b]: st(0.8) }, s, "verbatim", 1)).toEqual([a, "up"]);
  });

  test("the run-throughs come after the parts they are made of", () => {
    const t10 = build(Array.from({ length: 8 }, (_, k) => said(k + 1, [`Slide ${k + 1} says this.`])));
    const all = Object.fromEntries(t10.order.filter((id) => id.startsWith("s:") || id.startsWith("b:")).map((id) => [id, st(0.9)]));
    expect(pick(t10, from(all), NOW, "verbatim", Infinity, begin())?.node.id).toBe("sec:1");
    expect(pick(t10, from({ ...all, "sec:1": st(0.9) }), NOW, "verbatim", Infinity, begin())?.node.id).toBe("sec:2");
    expect(pick(t10, from({ ...all, "sec:1": st(0.9), "sec:2": st(0.9) }), NOW, "verbatim", Infinity, begin())?.node.id).toBe("t");
  });
});

describe("after a miss, the climb goes back through the node missed (Tim, 9 November, slide 4)", () => {
  test("a group missed, its weakest sentence passed: the group next, not the slide; then the slide", () => {
    // word for word, which goes up from the sentences (the gist starts each slide whole)
    const t4 = build([said(4, ["This talk asks when a score is enough.", "We looked at the data.", "Most variants were rare.",
      "So we asked the families."])]);
    const [s0, s1, g01, s2, s3, g23, root] = t4.order;
    const states = new Map<string, State>();
    const get = (id: string) => states.get(id) ?? null;
    let now = NOW, session = begin();
    const attempt = (id: string, leaves: number[], points: number) => {
      const est = estimates(t4, get, now), n = t4.nodes.get(id) as Node;
      const scores = new Map(n.leaves.map((l, k) => [l, leaves[k]]));
      record(t4, get, n, scores, points, now, new Map(n.leaves.map((l) => [l, 0.5])), est).forEach((v, k) => states.set(k, v));
      now += 30000;
    };
    const next = () => {
      const p = pick(t4, get, now, "verbatim", Infinity, session) as NonNullable<ReturnType<typeof pick>>;
      return p;
    };
    // the first group and both sentences of the second known
    for (const id of [s0, s1, s2, s3]) { attempt(id, [100], 100); attempt(id, [100], 100); }
    attempt(g01, [100, 100], 100);
    // the second group, up: missed on its last sentence
    let p = next();
    expect([p.node.id, p.why]).toEqual([g23, "up"]);
    attempt(g23, [100, 0], 45);
    session = after(session, p, false);
    expect(standing(t4, get, now, "verbatim", session).at(g23)).toBe(false);
    // down to the sentence missed, passed
    p = next();
    expect([p.node.id, p.why]).toEqual([s3, "down"]);
    attempt(s3, [100], 100);
    session = after(session, p, true);
    // back up to the group missed, not the whole slide
    expect(standing(t4, get, now, "verbatim", session).ready(root)).toBe(false);
    p = next();
    expect([p.node.id, p.why]).toEqual([g23, "up"]);
    attempt(g23, [100, 100], 100);
    session = after(session, p, true);
    expect(next().node.id).toBe(root);
  });

  test("nothing over a part whose last attempt missed is ready, even when its own score is still at the bar", () => {
    const missed = { [a]: st(0.8), [b]: st(0.7, { run: 1 }) };
    expect(standing(tree, from({ ...missed }), NOW, "gist").at(b)).toBe(false);
    expect(standing(tree, from({ ...missed }), NOW, "gist").ready(one)).toBe(false);
    // a part missed deeper down: the talk waits too
    expect(standing(tree, from({ ...known, [b]: st(0.9, { run: 1 }) }), NOW, "gist").ready("t")).toBe(false);
  });
});

describe("the gist starts each slide whole", () => {
  test("the whole slide first, read aloud; a miss goes down to the sentence it fell on, and back up once it is passed", () => {
    const t2 = build([said(1, ["We looked at the data closely, and we found that most variants were rare; so we asked families.",
      "Then we wrote."])]);
    const [c1, c2, c12, c3, s1, s2, root] = t2.order;
    expect(pick(t2, () => null, NOW, "gist", Infinity, begin())?.node.id).toBe(root);
    expect(pick(t2, () => null, NOW, "verbatim", Infinity, begin())?.node.id).toBe(c1);
    // the slide missed on its first sentence: down to it, and it again after another miss
    const missed = (id: string) => session({ last: { id, pass: false }, same: 1 });
    const after1 = { [root]: st(0.3, { run: 1 }), [s1]: st(0.2, { run: 1 }), [s2]: st(0.6) };
    expect(pick(t2, from(after1), NOW, "gist", Infinity, missed(root))?.node.id).toBe(s1);
    expect(pick(t2, from(after1), NOW, "gist", Infinity, missed(s1))?.node.id).toBe(s1);
    expect(standing(t2, from(after1), NOW, "gist").ready(root)).toBe(false);
    // passed: the slide again
    expect(pick(t2, from({ ...after1, [s1]: st(0.6) }), NOW, "gist", Infinity, begin())?.node.id).toBe(root);
    expect(standing(t2, from({}), NOW, "gist").ready(c12)).toBe(false);
    // a part passed over hides by the node over it, up to the node attempted
    const est = new Map([[c1, 0.2], [c2, 0.9], [c12, 0], [c3, 0.2], [s1, 0.7], [s2, 0.3], [root, 0.45]]);
    expect([...hiding(t2, t2.nodes.get(s1) as Node, est, "gist", null).values()]).toEqual([0.5, 0.5, 0.5]);
    expect([...hiding(t2, t2.nodes.get(root) as Node, est, "gist", null).values()]).toEqual([0.35, 0.5, 0.35, 0.35]);
    expect([...hiding(t2, t2.nodes.get(s1) as Node, est, "verbatim", null).values()]).toEqual([0, 1, 0]);
  });
});

describe("after", () => {
  test("keeps the last 10 counted passes, the last pick, the picks of it running, and the reviews since new material", () => {
    const node = (id: string) => tree.nodes.get(id) as Node;
    let s = after(begin(), { node: node(a), why: "due", est: 0, bar: 0.75 }, true);
    expect(s).toEqual({ recent: [true], last: { id: a, pass: true }, same: 1, reviews: 1 });
    s = after(s, { node: node(a), why: "down", est: 0, bar: 0.75 }, null);
    expect(s).toEqual({ recent: [true], last: { id: a, pass: null }, same: 2, reviews: 1 });
    s = after(s, { node: node(b), why: "up", est: 0, bar: 0.75 }, false);
    expect(s).toEqual({ recent: [true, false], last: { id: b, pass: false }, same: 1, reviews: 0 });
    for (let k = 0; k < 12; k += 1) s = after(s, { node: node(b), why: "new", est: 0, bar: 0.75 }, true);
    expect(s.recent).toHaveLength(PACE_OF);
  });
});
