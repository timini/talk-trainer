import { describe, expect, test } from "vitest";
import { units } from "@/lib/flow";
import {
  adjust, effective, HALF, header, hidden, instruction, knowIt, migrate, pick, record, seedOf, sentenceKey, showAll, type State,
  summary, termMode, unitKey, update, view,
} from "@/lib/mastery";
import { perSentence } from "@/lib/score";
import { redact } from "@/lib/text";
import type { Slide } from "@/lib/train";

const NOW = Date.parse("2026-11-10T12:00:00Z"), HOUR = 3600 * 1000;
// sentences of 99 characters (17 words): two fit in a part
const say = (n: number, i: number) => `Sentence ${n}.${i + 1} ${"word ".repeat(16)}`.padEnd(95, "w") + "end.";
const slide = (n: number, count: number): Slide => ({ n, title: `Slide ${n}`, image: null,
  sentences: Array.from({ length: count }, (_, i) => ({ i: i + 1, text: say(n, i), hash: `h${n}${i}`, clip: null, must_say: [] })) });
const store = (items: Record<string, unknown> = {}) => {
  const get = <T>(k: string, d: T): T => (k in items ? (items[k] as T) : d);
  return { items, get, apply: (e: Record<string, unknown>) => Object.assign(items, e) };
};
const st = (m: number, at = NOW, passes = 0, full = 0): State => ({ m, at, passes, n: 1, focus: [], full });

describe("a sentence's running score", () => {
  test("moves halfway to the attempt's score, and fades with a half-life that grows with each time it is got", () => {
    expect(update(null, 100, NOW)).toEqual({ m: 0.5, at: NOW, passes: 1, n: 1, focus: [], full: 0 });
    expect(update(st(0.5), 100, NOW).m).toBe(0.75);
    expect(update(st(0.8, NOW, 0, 2), 40, NOW, ["x"], false)).toEqual({ m: expect.closeTo(0.6), at: NOW, passes: 0, n: 2, focus: ["x"], full: 1 });
    expect(update(st(0.8), 40, NOW, [], true).full).toBe(2);
    expect(effective(null, NOW)).toBe(0);
    expect(effective(st(0.8, NOW - 2 * HOUR, 0), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW - 8 * HOUR, 1), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW - 24 * HOUR, 2), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW - 72 * HOUR, 9), NOW)).toBeCloseTo(0.4);
    expect(effective(st(0.8, NOW + HOUR), NOW)).toBe(0.8);
    expect(HALF.length).toBe(4);
  });

  test("the share hidden, and the terms: in full, then the first letter, then hidden", () => {
    expect([hidden(0), hidden(0.12), hidden(0.5), hidden(0.75), hidden(0.874), hidden(0.9)]).toEqual([0, 0.15, 0.55, 0.85, 0.95, 1]);
    expect([termMode(0.3, null), termMode(0.6, null), termMode(0.85, null), termMode(0.85, st(0.85, NOW, 0, 1))])
      .toEqual(["full", "initial", "hide", "full"]);
    expect([instruction(0), instruction(0.6), instruction(1)]).toEqual(["Read it aloud.", "Say it, filling in the blanks (60% hidden).",
      "From memory: say it from the slide."]);
    expect(showAll(st(0.8, 1, 2), NOW)).toEqual({ m: 0, at: NOW, passes: 2, n: 1, focus: [], full: 0 });
    expect(showAll(null, NOW)).toEqual({ m: 0, at: NOW, passes: 0, n: 0, focus: [], full: 0 });
    expect(knowIt(null, NOW)).toEqual({ m: 0.9, at: NOW, passes: 1, n: 0, focus: [], full: 0 });
    expect(knowIt(st(0.2, 1, 3, 2), NOW).passes).toBe(3);
  });
});

describe("scores per sentence", () => {
  const texts = ["I am Tim Richardson, a software engineer.", "I am not a clinical scientist and have no qualifications.",
    "This talk is what I have learned."];
  test("each problem is charged to the sentence it falls in", () => {
    // Tim at 17:04:49: the first sentence said, the other two lost
    expect(perSentence([{ kind: "left_out", script: "I am not a clinical scientist and have no qualifications" },
      { kind: "left_out", script: "is what I have learned" }], texts)).toEqual([100, 0, 0]);
    expect(perSentence([{ kind: "stumble", script: "Tim Richardson" }], texts)).toEqual([80, 100, 100]);
    expect(perSentence([{ kind: "wrong_term", script: "software", said: "hardware" }, { kind: "changed", script: "learned" }], texts))
      .toEqual([55, 100, 80]);
    expect(perSentence([{ kind: "order", script: "x" }], texts)).toEqual([80, 80, 80]);
    // a phrase across two sentences is charged to both; one not found is charged to all, as for the whole unit
    expect(perSentence([{ kind: "left_out", script: "engineer. I am not" }], texts)).toEqual([79, 55, 100]);
    expect(perSentence([{ kind: "stumble", script: "never said" }], texts)).toEqual([80, 80, 80]);
    expect(perSentence([], texts)).toEqual([100, 100, 100]);
  });
});

describe("what comes next", () => {
  test("a new slide is read in full, then hidden more with each pass, until got with all of it hidden; then the next", () => {
    const slides = [slide(1, 1), slide(2, 1)], s = store();
    const walk: [number, number][] = [];
    for (let k = 0; k < 6; k += 1) {
      const p = pick(slides, s.get, NOW)!;
      walk.push([p.unit.slide.n, p.share]);
      s.apply(record(p, [], 100, NOW));
    }
    expect(walk).toEqual([[1, 0], [1, 0.55], [1, 0.85], [1, 0.95], [1, 1], [2, 0]]);
    expect(summary(slides, s.get, NOW)).toEqual({ learned: 1, total: 2, from: null, due: 1 }); // slide 2 is under way
  });

  test("a miss on one sentence drops only that sentence; the unit is as well known as its weakest", () => {
    const slides = [slide(1, 2)], [u] = units(slides);
    const s = store({ [unitKey(u)]: { n: 3, done: false } });
    slides[0].sentences.forEach((x) => s.apply({ [sentenceKey(slides[0], x)]: st(0.87) }));
    const p = view(u, s.get, NOW);
    expect([p.eff, p.share, p.lines.map((l) => l.share)]).toEqual([0.87, 0.95, [0.95, 0.95]]);
    s.apply(record(p, [{ kind: "left_out", script: say(1, 1) }], 40, NOW));
    const after = view(u, s.get, NOW);
    expect(after.lines.map((l) => Math.round(l.eff * 100) / 100)).toEqual([0.94, 0.44]);
    expect(after.lines.map((l) => l.share)).toEqual([1, 0.5]);
    expect(after.eff).toBeCloseTo(0.435);
    expect(after.state).toEqual({ n: 4, done: false });
    // the missed phrase is kept on its sentence, to be cued
    expect(after.lines[1].state?.focus).toEqual([say(1, 1)]);
  });

  test("marked by hand, Show me and I know this one", () => {
    const slides = [slide(1, 1)], [u] = units(slides), s = store();
    const p = pick(slides, s.get, NOW)!;
    s.apply(record(p, [], 0, NOW, true));
    expect(view(u, s.get, NOW).lines[0].state?.m).toBe(0.5);
    s.apply(record(view(u, s.get, NOW), [], 100, NOW, false));
    expect(view(u, s.get, NOW).lines[0].state?.m).toBe(0.25);
    s.apply(adjust(view(u, s.get, NOW), knowIt, NOW));
    expect([view(u, s.get, NOW).share, view(u, s.get, NOW).state]).toEqual([1, { n: 2, done: false }]);
    s.apply(adjust(view(u, s.get, NOW), showAll, NOW));
    expect(view(u, s.get, NOW).share).toBe(0);
    s.apply(adjust({ ...view(u, s.get, NOW), state: null }, showAll, NOW));
    expect(view(u, s.get, NOW).state).toEqual({ n: 0, done: false });
  });

  test("a faded unit comes back first, the lowest first; nothing to do when all are done and fresh", () => {
    const slides = [slide(1, 1), slide(2, 1), slide(3, 1)], [a, b, c] = units(slides);
    const s = store({
      [unitKey(a)]: { n: 5, done: true }, [sentenceKey(slides[0], slides[0].sentences[0])]: st(0.9, NOW - 3 * HOUR, 0),
      [unitKey(b)]: { n: 5, done: true }, [sentenceKey(slides[1], slides[1].sentences[0])]: st(0.9, NOW - 10 * HOUR, 1),
      [unitKey(c)]: { n: 1, done: false }, [sentenceKey(slides[2], slides[2].sentences[0])]: st(0.6),
    });
    const first = pick(slides, s.get, NOW)!;
    expect([first.unit.slide.n, first.due, header(first, 3)]).toEqual([1, true, "Again: slide 1 of 3"]);
    expect(summary(slides, s.get, NOW)).toEqual({ learned: 0, total: 3, from: null, due: 3 });
    const done = store({ [unitKey(a)]: { n: 5, done: true }, [sentenceKey(slides[0], slides[0].sentences[0])]: st(0.95, NOW, 3) });
    expect(pick([slides[0]], done.get, NOW)).toBeNull();
  });

  test("the header for parts and the whole slide; each attempt has its own seed", () => {
    const [part, , whole] = units([slide(4, 3)]);
    const p = view(part, store().get, NOW);
    expect(header(p, 86)).toBe("Slide 4 of 86, part 1 of 2");
    expect(header({ ...p, unit: whole }, 86)).toBe("Slide 4 of 86, whole slide");
    expect(header(view(units([slide(5, 1)])[0], store().get, NOW), 86)).toBe("Slide 5 of 86");
    expect(seedOf(part.slide, p.lines[0])).not.toBe(seedOf(part.slide, { ...p.lines[0], state: st(0.5) }));
    expect(seedOf(part.slide, p.lines[0])).not.toBe(seedOf(part.slide, p.lines[1]));
  });
});

describe("earlier progress", () => {
  test("a unit's running score seeds its sentences; a slide the step-by-step flow learned is well known", () => {
    const slides = [slide(1, 3), slide(2, 1), slide(3, 1)];
    const s = store({
      "flow:m:1:1": { m: 0.7, at: 5, passes: 1, n: 4, done: false }, "flow:m:1:3": { m: 0.9, at: 6, passes: 2, n: 2, done: true },
      "flow:2:1": { step: 3, learned: true, last: 5, at: 7 },
    });
    const out = migrate(slides, s.get, NOW);
    const k = (n: number, i: number) => sentenceKey(slides[n - 1], slides[n - 1].sentences[i]);
    // sentences 1 and 2 are in part 1 (0.7) and the whole slide (0.9): the higher wins
    expect(out[k(1, 0)]).toEqual({ m: 0.9, at: 6, passes: 2, n: 2, focus: [], full: 0 });
    expect(out[k(1, 2)]).toEqual({ m: 0.9, at: 6, passes: 2, n: 2, focus: [], full: 0 });
    expect([out["flow:u:1:1"], out["flow:u:1:3"], out["flow:u:1:2"]]).toEqual([{ n: 4, done: false }, { n: 2, done: true }, undefined]);
    expect(out[k(2, 0)]).toEqual({ m: 0.9, at: 7, passes: 2, n: 0, focus: [], full: 0 });
    expect(out["flow:u:2:1"]).toEqual({ n: 0, done: true });
    expect(out[k(3, 0)]).toBeUndefined();
    // a slide with no script is skipped
    expect(migrate([{ n: 9, title: "Empty", image: null, sentences: [] }], s.get, NOW)).toEqual({});
    // a part higher than the whole slide keeps the higher score
    const lower = migrate([slides[0]], store({ "flow:m:1:1": { m: 0.8, at: 5, passes: 1, n: 1, done: false },
      "flow:m:1:3": { m: 0.3, at: 6, passes: 0, n: 1, done: false } }).get, NOW);
    expect([(lower[k(1, 0)] as State).m, (lower[k(1, 2)] as State).m]).toEqual([0.8, 0.3]);
    expect((migrate([slides[1]], store({ "flow:2:1": { step: 3, learned: true, last: 5 } }).get, NOW)[k(2, 0)] as State).at).toBe(5);
    expect((migrate([slides[1]], store({ "flow:2:1": { step: 3, learned: true } }).get, NOW)[k(2, 0)] as State).at).toBe(NOW);
  });
});

describe("redact", () => {
  const T = "We combined CADD, SpliceAI, REVEL and AlphaMissense to rank 9 in 10 cases first.";
  test("hides that share of the words, terms shown in full or by their first letter, missed phrases cued, varied by seed", () => {
    const half = redact(T, 0.5, [], [], 1);
    expect(half.split(" ").filter((w) => /^_+[,.]?$/.test(w)).length).toBe(7);
    expect(redact(T, 0.5, [], [], 1)).toBe(half);
    expect(redact(T, 0.5, [], [], 2)).not.toBe(half);
    const terms = ["CADD", "SpliceAI", "REVEL", "AlphaMissense", "9 in 10"];
    const kept = redact(T, 0.95, terms, [], 3);
    for (const term of ["CADD", "SpliceAI", "REVEL", "AlphaMissense"]) expect(kept).toContain(term);
    const firsts = redact(T, 0.1, [], [], 3, ["SpliceAI", "AlphaMissense"]);
    expect(firsts).toContain("S_______");
    expect(firsts).toContain("A____________");
    expect(redact(T, 0.9, [], ["to rank"], 4)).toMatch(/\bt_ r___\b/);
    expect(redact(T, 0.9, [], ["not in it", "..."], 4)).toBe(redact(T, 0.9, [], [], 4));
    expect([redact(T, 0, [], [], 5), redact(T, 1, [], [], 5)]).toEqual([T, ""]);
  });
});
