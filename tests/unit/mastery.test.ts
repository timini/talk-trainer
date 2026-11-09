import { describe, expect, test } from "vitest";
import { units } from "@/lib/flow";
import { DUE, effective, HALF, header, hidden, instruction, keyOf, knowIt, migrate, pick, seedOf, showAll, type State, stateOf, summary, update } from "@/lib/mastery";
import { redact } from "@/lib/text";
import type { Slide } from "@/lib/train";

const NOW = Date.parse("2026-11-10T12:00:00Z"), HOUR = 3600 * 1000;
const say = (n: number, i: number) => `Sentence ${n}.${i + 1} ${"word ".repeat(16)}`.padEnd(95, "w") + "end.";
const slide = (n: number, count: number): Slide => ({ n, title: `Slide ${n}`, image: null,
  sentences: Array.from({ length: count }, (_, i) => ({ i: i + 1, text: say(n, i), hash: `h${n}${i}`, clip: null, must_say: [] })) });
const store = (items: Record<string, unknown> = {}) => {
  const get = <T>(k: string, d: T): T => (k in items ? (items[k] as T) : d);
  return { items, get, apply: (e: Record<string, unknown>) => Object.assign(items, e) };
};
const st = (m: number, at = NOW, passes = 0, done = false): State => ({ m, at, passes, n: 1, done, focus: [] });

describe("the running score", () => {
  test("moves halfway to each attempt's score, and fades with a half-life that grows with each time it is got", () => {
    expect(update(null, 100, 0, NOW)).toEqual({ m: 0.5, at: NOW, passes: 1, n: 1, done: false, focus: [] });
    expect(update(st(0.5), 100, 0.5, NOW).m).toBe(0.75);
    expect(update(st(0.8), 40, 0.8, NOW, ["x"])).toEqual({ m: expect.closeTo(0.6), at: NOW, passes: 0, n: 2, done: false, focus: ["x"] });
    // got with everything hidden is done
    expect(update(st(0.95), 90, 1, NOW).done).toBe(true);
    expect(update(st(0.95), 80, 1, NOW).done).toBe(false);
    expect(effective(null, NOW)).toBe(0);
    expect(effective(st(0.8), NOW)).toBe(0.8);
    expect(effective(st(0.8, NOW - 2 * HOUR, 0), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW - 8 * HOUR, 1), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW - 24 * HOUR, 2), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW - 72 * HOUR, 9), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW + HOUR), NOW)).toBe(0.8); // a clock behind the last attempt
    expect(HALF.length).toBe(4);
    // the fading is counted before the new score is added
    expect(update(st(0.8, NOW - 2 * HOUR), 100, 0.4, NOW).m).toBeCloseTo(0.7);
  });

  test("the share hidden is in proportion to the score, in steps of 5%, and everything from 0.9", () => {
    expect([hidden(0), hidden(0.12), hidden(0.5), hidden(0.75), hidden(0.874), hidden(0.9), hidden(1)]).toEqual([0, 0.15, 0.55, 0.85, 0.95, 1, 1]);
    expect([instruction(0), instruction(0.6), instruction(1)]).toEqual(["Read it aloud.", "Say it, filling in the blanks (60% hidden).",
      "From memory: say it from the slide."]);
  });

  test("Show me shows all of it; I know this one hides nearly all", () => {
    expect(showAll(st(0.8, 1, 2), NOW)).toEqual({ m: 0, at: NOW, passes: 2, n: 1, done: false, focus: [] });
    expect(showAll(null, NOW)).toEqual({ m: 0, at: NOW, passes: 0, n: 0, done: false, focus: [] });
    expect(knowIt(null, NOW)).toEqual({ m: 0.9, at: NOW, passes: 1, n: 0, done: false, focus: [] });
    expect(knowIt(st(0.2, 1, 3), NOW).passes).toBe(3);
  });
});

describe("what comes next", () => {
  test("a new slide reads in full, then hides more with each pass until got with everything hidden; then the next slide", () => {
    const slides = [slide(1, 1), slide(2, 1)], s = store();
    const walk: [number, number][] = [];
    for (let k = 0; k < 6; k += 1) {
      const p = pick(slides, s.get, NOW)!;
      walk.push([p.unit.slide.n, p.share]);
      s.apply({ [keyOf(p.unit)]: update(p.state, 100, p.share, NOW) });
    }
    expect(walk).toEqual([[1, 0], [1, 0.55], [1, 0.85], [1, 0.95], [1, 1], [2, 0]]);
    expect(summary(slides, s.get, NOW)).toEqual({ learned: 1, total: 2, from: null, due: 1 }); // slide 2 is under way
  });

  test("a miss shows more text next time; a faded slide comes back first, the lowest first", () => {
    const slides = [slide(1, 1), slide(2, 1), slide(3, 1)], [a, b, c] = units(slides);
    const s = store({ [keyOf(a)]: st(0.9, NOW - 3 * HOUR, 0, true), [keyOf(b)]: st(0.9, NOW - 10 * HOUR, 1, true), [keyOf(c)]: st(0.6) });
    const first = pick(slides, s.get, NOW)!;
    expect([first.unit.slide.n, first.due]).toEqual([1, true]); // 0.9 after 3 hours at a 2 hour half-life is 0.32
    expect(header(first, 3)).toBe("Again: slide 1 of 3");
    s.apply({ [keyOf(a)]: update(first.state, 30, first.share, NOW) });
    expect(stateOf(s.get, a)!.m).toBeLessThan(first.eff);
    expect(summary(slides, s.get, NOW)).toEqual({ learned: 0, total: 3, from: null, due: 3 });
    // nothing due and everything done: nothing to say
    const done = store({ [keyOf(a)]: st(0.95, NOW, 3, true) });
    expect(pick([slides[0]], done.get, NOW)).toBeNull();
  });

  test("the header for parts and the whole slide; the seed changes with each attempt", () => {
    const [part, , whole] = units([slide(4, 3)]);
    const p = { unit: part, eff: 0, share: 0, due: false, state: null };
    expect(header(p, 86)).toBe("Slide 4 of 86, part 1 of 2");
    expect(header({ ...p, unit: whole }, 86)).toBe("Slide 4 of 86, whole slide");
    expect(header({ ...p, unit: units([slide(5, 1)])[0] }, 86)).toBe("Slide 5 of 86");
    expect(seedOf(p)).not.toBe(seedOf({ ...p, state: st(0.5) }));
    expect(seedOf(p)).toBe(seedOf({ ...p }));
  });

  test("the earlier flow's learned slides are well known, from when they were learned", () => {
    const slides = [slide(1, 3), slide(2, 1)];
    const s = store({ "flow:1:3": { step: 3, learned: true, last: 5, at: 7 }, "flow:1:1": { step: 3, learned: true, last: 5, at: 7 },
      "flow:1:2": { step: 3, learned: true, last: 5, at: 7 } });
    const out = migrate(slides, s.get, NOW);
    expect(Object.keys(out)).toEqual(["flow:m:1:1", "flow:m:1:2", "flow:m:1:3"]);
    expect(out["flow:m:1:1"]).toEqual({ m: 0.9, at: 7, passes: 2, n: 0, done: true, focus: [] });
    const t = store({ "flow:2:1": { step: 3, learned: true, last: 5 } });
    expect(migrate(slides, t.get, NOW)["flow:m:2:1"].at).toBe(5);
    const u = store({ "flow:2:1": { step: 3, learned: true } });
    expect(migrate(slides, u.get, NOW)["flow:m:2:1"].at).toBe(NOW);
  });
});

describe("redact", () => {
  const T = "We combined CADD, SpliceAI, REVEL and AlphaMissense to rank 9 in 10 cases first.";
  test("hides that share of the words, keeps the terms shown, cues missed phrases, and varies with the seed", () => {
    const words = (x: string) => x.split(/\s+/).length;
    const blanks = (x: string) => (x.match(/_{2,}|\b_+/g) ?? []).length;
    const half = redact(T, 0.5, [], [], 1);
    expect(words(half)).toBe(words(T));
    expect(half.split(" ").filter((w) => /^_+[,.]?$/.test(w)).length).toBe(7); // half of 14 words, rounded
    expect(redact(T, 0.5, [], [], 1)).toBe(half);
    expect(redact(T, 0.5, [], [], 2)).not.toBe(half);
    // the terms stay, even with everything else hidden
    const kept = redact(T, 0.95, ["CADD", "SpliceAI", "REVEL", "AlphaMissense", "9 in 10"], [], 3);
    for (const term of ["CADD", "SpliceAI", "REVEL", "AlphaMissense", "9", "10"]) expect(kept).toContain(term);
    // a missed phrase, when hidden, shows its first letter
    const cued = redact(T, 0.9, [], ["to rank"], 4);
    expect(cued).toMatch(/\bt_ r___\b/);
    expect(redact(T, 0.9, [], ["not in it", "..."], 4)).toBe(redact(T, 0.9, [], [], 4));
    expect([redact(T, 0, [], [], 5), redact(T, 1, [], [], 5)]).toEqual([T, ""]);
    expect(blanks).toBeTypeOf("function");
  });
});
