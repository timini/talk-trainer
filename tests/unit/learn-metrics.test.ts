import { describe, expect, test } from "vitest";
import { metrics, slidesAt, weakest, weakSlides } from "@/lib/learn/metrics";
import type { State } from "@/lib/learn/model";
import { FIRST, GAP } from "@/lib/learn/rules";
import type { Entry } from "@/lib/learn/store";
import { build } from "@/lib/learn/tree";

const e = (node: string, at: number, points: number | null, after: number | null, over: Partial<Entry> = {}): Entry => ({
  id: `${node}${at}`, at, node, slide: 1, kind: "sentence", height: 0, words: 5, before: 0, bar: 0.75, after, hidden: 0.5, points,
  pass: points === null ? null : points >= 60, ms: 0, gap: null, why: "up", m: at, ...over });

describe("metrics", () => {
  test("the session's pass rate, attempts to the bar by kind, retention and the parts that took most attempts", () => {
    const log = [
      e("a", 1, 100, 0.5), e("a", 2, 100, 0.8), e("a", 3, 40, 0.5),
      e("b", 4, 30, 0.2, { slide: 2 }), e("b", 5, null, null, { slide: 2 }), e("b", 6, 70, 0.5, { slide: 2, gap: GAP + 1 }),
      e("c", 7, 100, 0.9, { kind: "group", gap: GAP + 5 }), e("d", 8, 100, 0.5), e("d", 9, 100, 0.76), e("d", 10, 100, 0.9),
      e("f", 11, 100, 0.5), e("f", 12, 100, 0.8), e("f", 13, 100, 0.9), e("f", 14, 100, 0.95), e("f", 15, 100, 0.95),
    ];
    const m = metrics(log, 4);
    expect(m.session).toEqual({ n: 11, passed: 10, rate: 10 / 11, low: 0.7, high: 0.85 });
    expect(m.toBar).toEqual([{ kind: "sentence", nodes: 3, median: 2 }, { kind: "group", nodes: 1, median: 1 }]);
    expect(m.retention).toEqual({ n: 2, passed: 2, rate: 1 });
    expect(m.slowest.map((x) => [x.node, x.attempts, x.reached])).toEqual([["b", 3, false], ["a", 2, true], ["d", 2, true],
      ["f", 2, true], ["c", 1, true]]);
    expect(metrics([], 0).session.rate).toBeNull();
    expect(metrics([e("x", 1, 100, 0.9), e("y", 2, 100, 0.5), e("y", 3, 100, 0.9)], 0).toBar).toEqual([{ kind: "sentence", nodes: 2, median: 1.5 }]);
  });

  test("the weakest phrases: runs of troubled words, the most trouble first", () => {
    const tree = build([{ n: 1, sentences: [{ text: "We asked the families what they thought." }, { text: "Then we wrote it up." }] },
      { n: 2, sentences: [{ text: "Thank you all." }] }]);
    const [a, b] = tree.order, c = tree.roots.get(2) as string;
    const st = (trouble?: number[]): State => ({ s: 0.5, at: 0, interval: FIRST, n: 1, passes: 1, lastPass: 0, run: 0, hid: 0, trouble });
    const states: Record<string, State> = { [a]: st([0, 1, 1, 0.2, 0.4, 0.5, 0]), [b]: st([2, 2, 0, 0, 0]), [c]: st(), [tree.roots.get(1) as string]: st() };
    expect(weakest(tree, (id) => states[id] ?? null, 0)).toEqual([
      { slide: 1, phrase: "Then we", trouble: 4 }, { slide: 1, phrase: "asked the", trouble: 2 }, { slide: 1, phrase: "what they", trouble: 0.9 }]);
    expect(weakest(tree, (id) => states[id] ?? null, 0, 1)).toHaveLength(1);
  });

  test("slides at the aim and nodes due", () => {
    const tree = build([{ n: 1, sentences: [{ text: "Hello there." }] }, { n: 2, sentences: [{ text: "Goodbye now." }] }]);
    const st: State = { s: 0.9, at: 0, interval: FIRST, n: 1, passes: 1, lastPass: 0, run: 0, hid: 1 };
    const one = tree.roots.get(1) as string, two = tree.roots.get(2) as string;
    expect(slidesAt(tree, (id) => (id === one ? st : null), 0, "verbatim")).toEqual({ at: 1, total: 2, due: 0 });
    expect(slidesAt(tree, (id) => (id === one || id === two ? st : null), 10 * FIRST, "verbatim")).toEqual({ at: 0, total: 2, due: 2 });
  });
});

describe("weakSlides", () => {
  test("each slide's last familiar score, lowest first, at most n, with the lower half", () => {
    const read = (slide: number, at: number, points: number | null, meaning: number, delivery: number) =>
      e(`s${slide}`, at, points, null, { slide, read: { meaning, delivery } });
    const log = [read(1, 1, 40, 30, 50), read(1, 2, 90, 100, 80), read(2, 3, 70, 60, 80), read(3, 4, 70, 90, 50),
      read(4, 5, null, 0, 0), e("x", 6, 20, null, { slide: 5 })];
    expect(weakSlides(log)).toEqual([{ slide: 2, points: 70, low: "meaning" }, { slide: 3, points: 70, low: "delivery" },
      { slide: 1, points: 90, low: "delivery" }]);
    expect(weakSlides(log, 1)).toHaveLength(1);
  });
});
