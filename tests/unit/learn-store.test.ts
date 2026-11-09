import { describe, expect, test } from "vitest";
import { FIRST, GROW } from "@/lib/learn/rules";
import { type Entry, logged, logKey, migrate, nodeKey, pick, SETTINGS, SYNCED } from "@/lib/learn/store";
import { build } from "@/lib/learn/tree";

const entry = (id: string, at: number, m = at, points: number | null = 90): Entry => ({ id, at, node: "s:1:0-0:x", slide: 1,
  kind: "sentence", height: 0, words: 5, before: 0.5, bar: 0.75, after: 0.7, hidden: 0.4, points, pass: points === null ? null : points >= 60,
  ms: 3000, gap: null, why: "up", m });

describe("keys", () => {
  test("nodes, settings and the day's log", () => {
    expect([nodeKey("s:1:0-0:x"), logKey("2026-11-10"), SETTINGS.aim]).toEqual(["learn:n:s:1:0-0:x", "learn:log:2026-11-10", "learn:set:aim"]);
    expect(["learn:n:a", "flow:s:1:1:a", "flow:w:1:0:1", "flow:1:1", "train:days"].map((k) => SYNCED.test(k)))
      .toEqual([true, true, true, false, false]);
  });
});

describe("the log", () => {
  test("an attempt added in time order, or changed in place by a recount", () => {
    let log = logged(null, entry("b", 20));
    log = logged(log, entry("a", 10));
    expect(log.list.map((x) => x.id)).toEqual(["a", "b"]);
    expect(log.at).toBe(20);
    log = logged(log, { ...entry("a", 10, 30), points: 85 });
    expect(log.list.map((x) => [x.id, x.points])).toEqual([["a", 85], ["b", 90]]);
    expect(log.at).toBe(30);
  });
});

describe("pick: two devices", () => {
  test("the newer at wins; mine on a tie; one side missing", () => {
    expect(pick("learn:n:x", { s: 1, at: 5 }, { s: 2, at: 6 })).toEqual({ s: 2, at: 6 });
    expect(pick("learn:n:x", { s: 1, at: 6 }, { s: 2, at: 5 })).toEqual({ s: 1, at: 6 });
    expect(pick("learn:n:x", { s: 1, at: 6 }, { s: 2, at: 6 })).toEqual({ s: 1, at: 6 });
    expect(pick("learn:set:aim", undefined, { v: "gist", at: 1 })).toEqual({ v: "gist", at: 1 });
    expect(pick("learn:set:aim", { v: "gist", at: 1 }, null)).toEqual({ v: "gist", at: 1 });
    expect(pick("flow:s:1:1:a", { m: 1 }, { m: 2, at: 1 })).toEqual({ m: 2, at: 1 });
  });

  test("a window without at: the one with more attempts", () => {
    expect(pick("flow:w:1:0:1", { n: 2, done: false }, { n: 3, done: true })).toEqual({ n: 3, done: true });
    expect(pick("flow:w:1:0:1", { n: 3, done: false }, { n: 2, done: true })).toEqual({ n: 3, done: false });
    expect(pick("flow:w:1:0:1", { n: 1, done: false, at: 9 }, { n: 3, done: true })).toEqual({ n: 1, done: false, at: 9 });
  });

  test("the logs of a day joined by attempt, the newer copy of each", () => {
    const mine = { at: 30, list: [entry("a", 10), entry("b", 20, 20, 40)] };
    const theirs = { at: 40, list: [entry("b", 20, 40, 85), entry("c", 15), entry("a", 10, 5, 0)] };
    const out = pick("learn:log:2026-11-10", mine, theirs) as { at: number; list: Entry[] };
    expect(out.at).toBe(40);
    expect(out.list.map((x) => [x.id, x.points])).toEqual([["a", 90], ["c", 90], ["b", 85]]);
  });
});

describe("migration from the old trainer", () => {
  test("each sentence's running score seeds its node and its clauses", () => {
    const long = "We looked at the data closely, and we found that most variants were rare; so we asked families.";
    const slides = [{ n: 1, sentences: [{ i: 1, text: "Good morning.", hash: "aa" }, { i: 2, text: long, hash: "bb" }] },
      { n: 2, sentences: [{ i: 1, text: "Hello.", hash: "cc" }] }, { n: 3, sentences: [] }];
    const tree = build(slides);
    const old: Record<string, unknown> = {
      "flow:s:1:1:aa": { m: 0.8, at: 100, passes: 2, n: 3 }, "flow:s:1:2:bb": { m: 0.3, at: 50, passes: 0, n: 1 },
      "flow:s:2:1:cc": { m: 0.9, at: 70, passes: 9, n: 9 }, "flow:s:1:2:old": { m: 1, at: 1, passes: 1, n: 1 },
    };
    const out = migrate(tree, slides, (k) => old[k] ?? null, "verbatim");
    const [s1, c1, c2, c12, c3, s2] = tree.order;
    expect(out[nodeKey(s1)]).toEqual({ s: 0.8, at: 100, interval: FIRST * GROW ** 2, n: 3, passes: 2, lastPass: 100, run: 0, hid: 0.85 });
    // the long sentence and its clauses alike
    expect([s2, c1, c2, c12, c3].map((id) => out[nodeKey(id)]?.s)).toEqual([0.3, 0.3, 0.3, 0.3, 0.3]);
    expect(out[nodeKey(s2)]).toMatchObject({ lastPass: 0, interval: FIRST, hid: 0.1 });
    // a one-sentence slide: the slide itself; passes count up to 4
    expect(out[nodeKey(tree.roots.get(2) as string)]).toMatchObject({ s: 0.9, interval: FIRST * GROW ** 4 });
    // nothing for the slide of two sentences as a whole, nor for anything else
    expect(Object.keys(out)).toHaveLength(7);
    expect(migrate(tree, slides, () => null, "gist")).toEqual({});
  });
});
