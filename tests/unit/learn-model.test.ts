import { describe, expect, test } from "vitest";
import { barOf, cues, troubleOf, estimates, fade, hidden, hiding, known, opening, place, record, scores, type State, terms, update }
  from "@/lib/learn/model";
import { ALPHA, FIRST, GROW, JOIN, UNDER } from "@/lib/learn/rules";
import { build, type Input, type Node } from "@/lib/learn/tree";

const MIN = 60000;
const st = (over: Partial<State> = {}): State => ({ s: 0.8, at: 0, interval: FIRST, n: 1, passes: 1, lastPass: 0, run: 0, hid: 0, ...over });
const said = (n: number, texts: string[]): Input => ({ n, sentences: texts.map((text) => ({ text })) });
const tree = build([said(1, ["Good morning, and thank you for coming.", "Today we bake bread."])]);
const [a, b, root] = tree.order;
const node = (id: string) => tree.nodes.get(id) as Node;

describe("the score and its fading", () => {
  test("trusted for its interval, then fading as a power of the time past it", () => {
    expect(fade(st(), 0)).toBe(0.8);
    expect(fade(st(), FIRST)).toBe(0.8);
    expect(fade(st(), 2 * FIRST)).toBeCloseTo(0.8 * 2 ** -0.3);
    expect(fade(st({ interval: 6 * FIRST }), 7 * FIRST)).toBeCloseTo(0.8 * (7 / 6) ** -0.3);
    // a day after a 10 minute interval, some is left
    expect(fade(st({ s: 0.9 }), 24 * 60 * MIN)).toBeGreaterThan(0.2);
  });

  test("an attempt moves it ALPHA of the way; the interval grows only after a spaced pass, and resets after a miss", () => {
    const first = update(null, 0, 100, 1000, 0);
    expect(first).toEqual({ s: ALPHA, at: 1000, interval: FIRST, n: 1, passes: 1, lastPass: 1000, run: 0, hid: 0 });
    // passed again 5 minutes later: no growth
    const soon = update(first, 0.5, 100, 1000 + 5 * MIN, 0.4);
    expect(soon).toMatchObject({ s: 0.75, interval: FIRST, passes: 2, lastPass: 1000 + 5 * MIN, hid: 0.4 });
    // a full interval after the last pass: it grows
    const later = update(soon, 0.75, 70, 1000 + 15 * MIN, 1);
    expect(later).toMatchObject({ s: 0.725, interval: FIRST * GROW, passes: 3, n: 3 });
    // a miss: back to the first interval, the misses run on, the last pass kept
    const miss = update(later, 0.725, 30, 1000 + 20 * MIN, 1);
    expect(miss).toMatchObject({ interval: FIRST, passes: 3, run: 1, lastPass: 1000 + 15 * MIN });
    expect(update(miss, 0.5, 0, 1000 + 21 * MIN, 1).run).toBe(2);
    expect(update(null, 0, 40, 5, 0)).toMatchObject({ run: 1, lastPass: 0, passes: 0 });
    expect(update(null, 0.4, 100, 5, 0, 0.25).s).toBeCloseTo(0.55);
  });

  test("a node is known at least as well as its parts, joined; a leaf never tried is 0", () => {
    const states: Record<string, State> = { [a]: st({ s: 0.8 }), [b]: st({ s: 0.6 }) };
    const est = estimates(tree, (id) => states[id] ?? null, 0);
    expect(est.get(root)).toBeCloseTo(JOIN * 0.7);
    expect(estimates(tree, () => null, 0).get(a)).toBe(0);
    // its own score when higher, the joined parts when they are higher
    expect(estimates(tree, (id) => (id === root ? st({ s: 0.9 }) : states[id] ?? null), 0).get(root)).toBe(0.9);
    expect(estimates(tree, (id) => (id === root ? st({ s: 0.1 }) : states[id] ?? null), 0).get(root)).toBeCloseTo(JOIN * 0.7);
  });

  test("the bars", () => {
    expect([barOf(node(a), "verbatim"), barOf(node(root), "verbatim"), barOf(node(a), "gist"), barOf(node(root), "gist")])
      .toEqual([0.75, 0.85, 0.6, 0.8]);
  });
});

describe("hiding", () => {
  test("none below 0.2, all from 0.9, in steps of 5%; the gist at most half", () => {
    expect([0, 0.2, 0.3, 0.55, 0.89, 0.9, 1].map((s) => hidden(s, "verbatim"))).toEqual([0, 0, 0.1, 0.5, 0.95, 1, 1]);
    expect(hidden(0.9, "gist")).toBe(0.5);
    expect(hidden(0.3, "gist")).toBe(0.1);
  });

  test("each leaf by its own estimate, moved by the pace; a whole slide word for word all hidden", () => {
    const est = new Map([[a, 0.55], [b, 0.3], [root, 0.4]]);
    expect([...hiding(node(root), est, "gist", null).values()]).toEqual([0.5, 0.1]);
    expect([...hiding(node(root), est, "verbatim", null).values()]).toEqual([1, 1]);
    expect([...hiding(node(a), est, "verbatim", null).values()]).toEqual([0.5]);
    expect([...hiding(node(a), est, "verbatim", 0.5).values()]).toEqual([0.25]);
    expect([...hiding(node(a), est, "verbatim", 0.9).values()]).toEqual([0.7]);
    expect([...hiding(node(a), est, "verbatim", 0.8).values()]).toEqual([0.5]);
    // a slide of one leaf is hidden by its score
    const one = build([said(2, ["Hello there."])]), only = one.nodes.get(one.order[0]) as Node;
    expect([...hiding(only, new Map([[only.id, 0.3]]), "verbatim", null).values()]).toEqual([0.1]);
  });

  test("terms in full, then their first letter, then hidden", () => {
    expect([0.2, 0.5, 0.79, 0.8].map(terms)).toEqual(["full", "initial", "initial", "hide"]);
  });

  test("the join cues: the opening words of the node and of each part until it is passed once", () => {
    expect(opening("Good morning, and thank you.")).toBe("Good morning, and");
    expect(cues(tree, node(root), null)).toEqual(["Good morning, and", "Good morning, and", "Today we bake"]);
    expect(cues(tree, node(root), st({ passes: 0 }))).toHaveLength(3);
    expect(cues(tree, node(root), st())).toEqual(["Good morning, and"]);
    expect(cues(tree, node(b), null)).toEqual(["Today we bake"]);
  });
});

describe("an attempt", () => {
  test("the judge's problems placed on the leaves, and each part scored by its leaves' words", () => {
    const { leaves } = place(tree, node(root), [{ kind: "left_out", script: "Today we bake bread." }]);
    expect([...leaves.values()]).toEqual([100, 0]);
    const s = scores(tree, node(root), leaves, 55);
    expect(Object.fromEntries(s)).toEqual({ [root]: 55, [a]: 100, [b]: 0 });
  });

  test("writes the node (ALPHA) and every part under it (UNDER), each with its share hidden", () => {
    const states: Record<string, State> = { [a]: st({ s: 0.8, at: 0 }) };
    const get = (id: string) => states[id] ?? null, est = estimates(tree, get, 1000);
    const out = record(tree, get, node(root), new Map([[a, 100], [b, 0]]), 55, 1000, new Map([[a, 0.5], [b, 0]]), est);
    expect([...out.keys()]).toEqual([root, a, b]);
    expect(out.get(root)?.s).toBeCloseTo((1 - ALPHA) * (est.get(root) as number) + ALPHA * 0.55);
    expect(out.get(a)?.s).toBeCloseTo((1 - UNDER) * 0.8 + UNDER);
    expect(out.get(b)).toMatchObject({ s: 0, run: 1, n: 1 });
    // the node's share hidden is its leaves', by their words (7 and 4)
    expect(out.get(root)?.hid).toBe(0.32);
    expect(out.get(a)?.hid).toBe(0.5);
  });

  test("trouble: words hit go up, the rest keep 0.6 of theirs, it fades as the score does; kept when not given", () => {
    const get0 = () => null, est = estimates(tree, get0, 0);
    const first = record(tree, get0, node(root), new Map([[a, 50], [b, 100]]), 70, 0, new Map([[a, 1], [b, 1]]), est,
      new Map([[a, [0, 1, 1, 0, 0, 0, 0]], [b, [0, 0, 0, 0.5]]]));
    expect(first.get(a)?.trouble).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(first.get(root)?.trouble).toBeUndefined();
    const states = Object.fromEntries(first);
    const get1 = (id: string) => states[id] ?? null;
    const again = record(tree, get1, node(a), new Map([[a, 100]]), 100, 1000, new Map([[a, 1]]), estimates(tree, get1, 1000),
      new Map([[a, [0, 1, 0, 0, 0, 0, 0]]]));
    expect(again.get(a)?.trouble).toEqual([0, 2, 0.6, 0, 0, 0, 0]);
    // no trouble given: kept as it was
    expect(record(tree, get1, node(b), new Map([[b, 100]]), 100, 1000, new Map([[b, 1]]), estimates(tree, get1, 1000)).get(b)?.trouble)
      .toEqual([0, 0, 0, 0.5]);
    // fading with time, as the score does
    expect(troubleOf(states[a], 2 * FIRST)?.[1]).toBeCloseTo(2 ** -0.3);
    expect(troubleOf(null, 0)).toBeNull();
    expect(troubleOf(states[root], 0)).toBeNull();
  });

  test("a run-through has no leaves of its own: only it is written, all hidden", () => {
    const two = build([said(1, ["Hello there."]), said(2, ["Goodbye now."])]), t = two.nodes.get("t") as Node;
    const out = record(two, () => null, t, new Map(), 70, 9, new Map(), estimates(two, () => null, 9));
    expect([...out.keys()]).toEqual(["t"]);
    expect(out.get("t")).toMatchObject({ s: 0.35, hid: 1, passes: 1 });
  });

  test("I know this one: the node and its parts to 0.9, passed now", () => {
    const out = known(tree, (id) => (id === a ? st({ s: 0.95, n: 4, passes: 3, interval: 3 * FIRST }) : null), node(root), 50);
    expect(out.get(root)).toEqual({ s: 0.9, at: 50, interval: FIRST, n: 0, passes: 1, lastPass: 50, run: 0, hid: 1 });
    expect(out.get(a)).toMatchObject({ s: 0.95, n: 4, passes: 3, interval: 3 * FIRST });
  });
});
