import { describe, expect, test } from "vitest";
import { byHand, outcome, run } from "@/lib/learn/attempt";
import { estimates, type State } from "@/lib/learn/model";
import { ALPHA_GOOD } from "@/lib/learn/rules";
import { build, type Input, type Node } from "@/lib/learn/tree";

const said = (n: number, texts: string[]): Input => ({ n, sentences: texts.map((text) => ({ text })) });
const tree = build([said(1, ["Good morning, and thank you for coming.", "Today we bake bread."]), said(2, ["Mix the flour well."]),
  said(3, ["Then let it rest."])]);
const [a, b, one, two, three] = tree.order;
const node = (id: string) => tree.nodes.get(id) as Node;
const heard = (text: string, problems: { kind: "left_out" | "changed" | "wrong_term" | "order" | "stumble"; script: string }[] = []) =>
  ({ heard: text, meaning_ok: !problems.length, problems, clarity: 5, fluency: 5, pace: "good", tip: "Good." });

describe("outcome", () => {
  test("a pass: scored, and each leaf scored where the problems fell", () => {
    const o = outcome(tree, node(one), heard("Good morning, and thank you for coming. Today we bake bread."), []);
    expect(o.counted && o.points).toBe(100);
    expect(o.counted && [...o.leaves.values()]).toEqual([100, 100]);
    expect(o.counted && o.result.band).toBe("good");
  });

  test("a miss on one sentence lands on its leaf", () => {
    const o = outcome(tree, node(one), heard("Good morning, and thank you for coming.", [{ kind: "left_out", script: "Today we bake bread." }]), []);
    expect(o.counted && [o.points, ...o.leaves.values()]).toEqual([45, 100, 0]);
  });

  test("a near-quote is placed: its words marked missed on the card and given trouble", () => {
    const o = outcome(tree, node(one), heard("Good morning, and thank you for coming.", [{ kind: "left_out", script: "today we baked the bread" }]), []);
    expect(o.counted && o.result.parts.flatMap((p) => p.words.filter((w) => !w.ok).map((w) => w.w))).toEqual(["Today", "we", "bake", "bread."]);
    expect(o.counted && o.trouble.get(b)).toEqual([1, 1, 1, 1]);
    expect(o.counted && o.trouble.get(a)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const t = outcome(tree, node(one), heard("Good morning, and thank you for coming. Today we bake bread.", [{ kind: "wrong_term", script: "bread" }]), []);
    expect(t.counted && t.result.parts[1].words.map((w) => w.crit)).toEqual([false, false, false, true]);
  });

  test("not counted: started at another part, or almost nothing heard", () => {
    expect(outcome(tree, node(a), heard("Today we bake bread."), [])).toEqual({ counted: false,
      why: "That started at 'Today we bake bread'. This one starts at 'Good morning, and thank...'." });
    // nothing heard: no words, or a fluency and clarity of 1 with under 3 words
    expect(outcome(tree, node(b), { ...heard("Today we"), fluency: 1, clarity: 1 }, [])).toEqual({ counted: false,
      why: "I didn't catch that." });
    expect(outcome(tree, node(b), { fluency: 5, clarity: 5 }, []).counted).toBe(false);
    expect(outcome(tree, node(b), { ...heard("  "), fluency: 5, clarity: 5 }, []).counted).toBe(false);
    expect(outcome(tree, node(b), { ...heard("Today we bake bread."), fluency: 1, clarity: 1 }, []).counted).toBe(true);
    // what was heard starts nowhere in the slide: judged as it is
    const o = outcome(tree, node(b), heard("Yesterday we bought cake.", [{ kind: "changed", script: "Today we bake bread." }]), []);
    expect(o.counted && o.points).toBe(0);
    // a bridge starts at the last sentence of its first slide
    const bridge = node(tree.order.find((id) => id.startsWith("b:1:")) as string);
    expect(outcome(tree, bridge, heard("Today we bake bread. Mix the flour well."), []).counted).toBe(true);
    expect(outcome(tree, bridge, heard("Good morning, and thank you for coming."), []).counted).toBe(false);
  });

  test("started right but stopped early: a miss, the rest left out, not 'not heard' (Tim, 9 November)", () => {
    // the judge passed it: the rest is left out all the same
    const o = outcome(tree, node(one), heard("Good morning"), []);
    expect(o.counted).toBe(true);
    expect(o.counted && o.points).toBeLessThan(60);
    expect(o.counted && o.result.parts.flatMap((p) => p.words.filter((w) => !w.ok).map((w) => w.w))).toEqual(
      ["and", "thank", "you", "for", "coming.", "Today", "we", "bake", "bread."]);
    expect(o.counted && [...o.leaves.values()]).toEqual([0, 0]);
    const bare = outcome(tree, node(one), { heard: "Good morning", meaning_ok: true, fluency: 5, clarity: 5 }, []);
    expect(bare.counted && bare.points).toBeLessThan(60);
    // the judge already missed it: its own problems stand
    const m = outcome(tree, node(one), heard("Good morning", [{ kind: "left_out", script: "Today we bake bread." }]), []);
    expect(m.counted && m.points).toBe(45);
  });

  test("by hand: every leaf alike, 85 or 50", () => {
    expect(byHand(node(one), true)).toEqual({ points: 85, leaves: new Map([[a, 85], [b, 85]]) });
    expect(byHand(node(one), false).points).toBe(50);
  });
});

describe("a run-through", () => {
  const get = () => null as State | null, est = estimates(tree, get, 0);
  const slide = (n: number, points: number) => [n, { points, leaves: new Map(node(tree.roots.get(n) as string).leaves.map((l) => [l, points])) }] as const;

  test("each slide said is scored as that slide, all hidden; each bridge between two said; the run from its parts", () => {
    const out = run(tree, get, node("t"), new Map([slide(1, 100), slide(2, 40), slide(3, 100)]), 5, est);
    const bridge12 = tree.order.find((id) => id.startsWith("b:1:")) as string;
    const bridge23 = tree.order.find((id) => id.startsWith("b:2:")) as string;
    expect(out.get(one)).toMatchObject({ hid: 1, passes: 1 });
    expect(out.get(two)).toMatchObject({ run: 1, passes: 0 });
    expect(out.get(a)?.n).toBe(1);
    // a bridge scores the mean of its leaves: slide 1's last sentence (100) and slide 2's (40)
    expect(out.get(bridge12)?.s).toBeCloseTo(0.35);
    expect(out.get(bridge23)?.s).toBeCloseTo(0.35);
    // the talk: the mean of its parts (100, 40, 100, 70, 70)
    expect(out.get("t")?.s).toBeCloseTo(0.38);
    expect(out.get(three)?.passes).toBe(1);
    // with the trouble placed on a slide's words
    const withTrouble = run(tree, get, node("t"), new Map([[2, { points: 40, leaves: new Map([[two, 40]]), trouble: new Map([[two, [0, 1, 1, 1, 0]]]) }]]), 5, est);
    expect(withTrouble.get(two)?.trouble).toEqual([0, 1, 1, 1, 0]);
  });

  test("on the ladder (13 Nov): the run and a slide never said at 1 record the card's share; a slide said at 1 keeps it", () => {
    const hide = new Map([...node("t").slides.flatMap((n) => node(tree.roots.get(n) as string).leaves), "t"].map((l) => [l, 0.6]));
    const was = (id: string) => (id === one ? { s: 0.9, at: 0, interval: 1, n: 1, passes: 1, lastPass: 0, run: 0, hid: 1 } : null);
    const out = run(tree, was, node("t"), new Map([slide(1, 100), slide(2, 100), slide(3, 100)]), 5, estimates(tree, was, 0), hide);
    expect([out.get("t")?.hid, out.get(one)?.hid, out.get(two)?.hid]).toEqual([0.6, 1, 0.6]);
  });

  test("stopped part way: only the slides said, and the bridges and runs whose slides were all said", () => {
    const out = run(tree, get, node("t"), new Map([slide(1, 100), slide(2, 100)]), 5, est);
    expect(out.has(tree.order.find((id) => id.startsWith("b:1:")) as string)).toBe(true);
    expect(out.has(tree.order.find((id) => id.startsWith("b:2:")) as string)).toBe(false);
    expect(out.has("t")).toBe(false);
  });

  test("a talk in sections: each section from its slides and bridges, the talk from the sections and the bridges between", () => {
    const t8 = build(Array.from({ length: 8 }, (_, k) => said(k + 1, [`Slide ${k + 1} says this.`])));
    const all = new Map(Array.from({ length: 8 }, (_, k) => {
      const root = t8.nodes.get(t8.roots.get(k + 1) as string) as Node;
      return [k + 1, { points: k === 0 ? 0 : 100, leaves: new Map(root.leaves.map((l) => [l, k === 0 ? 0 : 100])) }] as const;
    }));
    const out = run(t8, () => null, t8.nodes.get("t") as Node, all, 5, estimates(t8, () => null, 5));
    expect(out.has("sec:1") && out.has("sec:2") && out.has("t")).toBe(true);
    // section 1: slides 100 x4 and 0, bridges 50 and 100 x3: mean 78
    expect(out.get("sec:1")?.passes).toBe(1);
    // section 2: every slide and bridge at 100, said with every word hidden: a confident pass
    expect(out.get("sec:2")?.s).toBeCloseTo((1 - ALPHA_GOOD) * (estimates(t8, () => null, 5).get("sec:2") as number) + ALPHA_GOOD);
  });
});
