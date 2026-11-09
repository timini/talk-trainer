import { describe, expect, test } from "vitest";
import {
  clipsOf, firstStep, focusOf, header, INSTRUCTIONS, nextLabel, type Item, learned, migrate, MOST, move, mustOf, next, record, showFirst,
  summary, textOf, unitsOf, units, warmUp,
} from "@/lib/flow";
import { merge } from "@/lib/schedule";
import type { Slide } from "@/lib/train";

const NOW = Date.parse("2026-11-10T12:00:00Z"), YESTERDAY = NOW - 24 * 3600 * 1000;
// A sentence of 99 characters: two fit in one part (199 with the space between), three do not.
const say = (n: number, i: number) => `Sentence ${n}.${i + 1} ${"word ".repeat(16)}`.padEnd(95, "w") + "end.";
const slide = (n: number, count: number, clips = true): Slide => ({ n, title: `Slide ${n}`, image: null,
  sentences: Array.from({ length: count }, (_, i) => ({ i: i + 1, text: say(n, i), hash: `h${n}${i}`,
    clip: clips ? `/c/${n}-${i}.wav` : null, must_say: [`${n}${i}`] })) });
// A store of progress items, as the engine keeps them.
const store = (items: Record<string, unknown> = {}) => {
  const get = <T>(k: string, d: T): T => (k in items ? (items[k] as T) : d);
  return { items, get, apply: (e: Record<string, unknown>) => Object.assign(items, e) };
};

describe("parts", () => {
  test("parts of at most 200 characters at sentence ends, then the whole slide; a longer sentence stands alone", () => {
    expect(say(1, 0).length).toBe(99);
    const shape = (count: number) => unitsOf(slide(1, count)).map((u) => [u.from, u.to, u.whole]);
    expect(shape(0)).toEqual([]);
    expect(shape(1)).toEqual([[0, 1, true]]);
    expect(shape(2)).toEqual([[0, 2, true]]);
    expect(shape(3)).toEqual([[0, 2, false], [2, 3, false], [0, 3, true]]);
    expect(shape(5)).toEqual([[0, 2, false], [2, 4, false], [4, 5, false], [0, 5, true]]);
    const odd: Slide = { ...slide(9, 3), sentences: ["Short one.", "x".repeat(250) + ".", "Short two."].map((text, i) =>
      ({ i: i + 1, text, hash: `o${i}`, clip: null, must_say: [] })) };
    expect(unitsOf(odd).map((u) => [u.from, u.to])).toEqual([[0, 1], [1, 2], [2, 3], [0, 3]]);
    expect(MOST).toBe(200);
    const u = unitsOf(slide(4, 4));
    expect(u.map((x) => [x.key, x.part, x.parts])).toEqual([["flow:4:1", 1, 3], ["flow:4:2", 2, 3], ["flow:4:3", 3, 3]]);
    expect(units([slide(1, 1), slide(2, 0), slide(3, 2)]).map((x) => x.key)).toEqual(["flow:1:1", "flow:3:1"]);
  });

  test("a unit's text, clips and must-say items", () => {
    const [first, , whole] = unitsOf(slide(2, 4));
    expect(textOf(first)).toBe(`${say(2, 0)} ${say(2, 1)}`);
    expect(clipsOf(whole)).toEqual(["/c/2-0.wav", "/c/2-1.wav", "/c/2-2.wav", "/c/2-3.wav"]);
    expect(mustOf(first)).toEqual(["20", "21"]);
    expect(clipsOf(unitsOf(slide(3, 2, false))[0])).toBeNull();
  });
});

describe("steps", () => {
  test("step 1 always moves on; step 2 goes on or repeats; step 3 learns or goes back to step 2", () => {
    expect([move(1, true), move(1, false)]).toEqual([{ step: 2, learned: false }, { step: 2, learned: false }]);
    expect([move(2, true), move(2, false)]).toEqual([{ step: 3, learned: false }, { step: 1, learned: false }]);
    expect([move(3, true), move(3, false)]).toEqual([{ step: 3, learned: true }, { step: 2, learned: false }]);
    const [part, , whole] = unitsOf(slide(1, 4));
    expect(firstStep()).toBe(3);
    const item = (step: 1 | 2 | 3, warm = false, u = part): Item => ({ unit: u, step, warm });
    expect([nextLabel(item(1), false), nextLabel(item(2), false), nextLabel(item(2), true), nextLabel(item(3), true),
      nextLabel(item(3, false, whole), true), nextLabel(item(3, true, whole), true), nextLabel(item(3), false)])
      .toEqual(["Next step", "Read it first", "Next step", "Next part", "Next slide", "Next", "Try with hints"]);
    expect(INSTRUCTIONS).toEqual({ 1: "Read it aloud.", 2: "Say it, filling in the hidden words.", 3: "From memory: say it from the slide." });
  });

  test("each slide starts from memory: a known slide takes one attempt; a miss gets hints, then memory again", () => {
    const slides = [slide(1, 2), slide(2, 0), slide(3, 1)], s = store();
    const walk: string[] = [];
    for (const [pass, missed] of [[false, ["Sentence 1.2"]], [false, ["1.1"]], [true, []], [true, []], [true, []], [true, []]] as [boolean, string[]][]) {
      const item = next(slides, s.get, NOW) as Item;
      walk.push(header(item, 3));
      s.apply(record(item, pass, s.get, NOW, missed));
      if (walk.length === 2) expect(focusOf(next(slides, s.get, NOW) as Item, s.get, NOW)).toEqual(["Sentence 1.2", "1.1"]);
    }
    expect(walk).toEqual(["Slide 1 of 3: from memory", "Slide 1 of 3: with hints", "Slide 1 of 3: read it",
      "Slide 1 of 3: with hints", "Slide 1 of 3: from memory", "Slide 3 of 3: from memory"]);
    // learning a unit clears what was missed
    expect(s.items["flow:1:1"]).toEqual({ step: 3, learned: true, last: NOW, at: NOW });
    expect(s.items["flow:3:1"]).toEqual({ step: 3, learned: true, last: NOW, at: NOW });
    expect([learned(s.get, slides[0]), learned(s.get, slides[1])]).toEqual([true, false]);
  });

  test("a Nearly from memory learns the unit and keeps its weak phrases for the warm-up's hints", () => {
    const slides = [slide(1, 1)], s = store();
    s.apply(record(next(slides, s.get, NOW) as Item, true, s.get, NOW, ["weak phrase"]));
    expect(s.items["flow:1:1"]).toEqual({ step: 3, learned: true, last: NOW, at: NOW, focus: ["weak phrase"] });
    const tomorrow = NOW + 24 * 3600 * 1000, warm = next(slides, s.get, tomorrow) as Item;
    expect(warm.warm).toBe(true);
    expect(focusOf(warm, s.get, tomorrow)).toEqual(["weak phrase"]);
  });

  test("Show me first reads it aloud, keeping what was missed, then hints; not in the warm-up", () => {
    const slides = [slide(1, 1)], s = store({ "flow:1:1": { step: 2, learned: false, last: 1, focus: ["x"] } });
    const item = next(slides, s.get, NOW) as Item;
    s.apply(showFirst(item, s.get, NOW));
    expect(s.items["flow:1:1"]).toEqual({ step: 1, learned: false, last: NOW, focus: ["x"] });
    const read = next(slides, s.get, NOW) as Item;
    expect(header(read, 1)).toBe("Slide 1 of 1: read it");
    s.apply(record(read, false, s.get, NOW, ["y"]));
    expect(s.items["flow:1:1"]).toEqual({ step: 2, learned: false, last: NOW, focus: ["x", "y"] });
    expect(showFirst({ ...read, warm: true }, s.get, NOW)).toEqual({});
    expect(focusOf({ ...read, warm: true }, store().get, NOW)).toEqual([]);
    expect(focusOf(read, store().get, NOW)).toEqual([]);
  });

  test("a split slide: each part from memory, then the whole slide; the total never grows", () => {
    const slides = [slide(1, 4)], s = store();
    const walk: string[] = [];
    for (const pass of [true, false, true, true, true]) {
      const item = next(slides, s.get, NOW) as Item;
      walk.push(header(item, 86));
      s.apply(record(item, pass, s.get, NOW));
    }
    expect(walk).toEqual(["Slide 1 of 86, part 1 of 2: from memory", "Slide 1 of 86, part 2 of 2: from memory",
      "Slide 1 of 86, part 2 of 2: with hints", "Slide 1 of 86, part 2 of 2: from memory", "Slide 1 of 86, whole slide: from memory"]);
    expect(next(slides, s.get, NOW)).toBeNull();
    expect(summary(slides, s.get, NOW)).toEqual({ learned: 1, total: 1, from: null, warm: 0 });
  });
});

describe("the warm-up", () => {
  test("slides learned before today, in talk order, each once from the slide; a miss goes back to step 2", () => {
    const slides = [slide(1, 1), slide(2, 2), slide(3, 1), slide(4, 1)];
    const s = store({
      "flow:1:1": { step: 3, learned: true, last: YESTERDAY, at: YESTERDAY },
      "flow:2:1": { step: 3, learned: true, last: YESTERDAY, at: YESTERDAY },
      "flow:3:1": { step: 3, learned: true, last: NOW, at: NOW },
    });
    expect(warmUp(slides, s.get, NOW).map((x) => x.n)).toEqual([1, 2]);
    expect(summary(slides, s.get, NOW)).toEqual({ learned: 3, total: 4, from: slides[3], warm: 2 });
    const walk: string[] = [];
    for (const pass of [true, false, true, true, true]) {
      const item = next(slides, s.get, NOW) as Item;
      walk.push(header(item, 4));
      s.apply(record(item, pass, s.get, NOW));
    }
    expect(walk).toEqual(["Warm up: slide 1 of 4: from memory", "Warm up: slide 2 of 4: from memory",
      "Warm up: slide 2 of 4: with hints", "Warm up: slide 2 of 4: from memory", "Slide 4 of 4: from memory"]);
    expect(s.items["flow:warm:2026-11-10"]).toEqual({ done: [1, 2], step: 3 });
    // the warm-up does not change what was learned; tomorrow it has all four (slide 4 was passed from memory today)
    expect(s.items["flow:2:1"]).toEqual({ step: 3, learned: true, last: YESTERDAY, at: YESTERDAY });
    expect(warmUp(slides, s.get, NOW + 24 * 3600 * 1000).map((x) => x.n)).toEqual([1, 2, 3, 4]);
    // a learned state with no time counts as learned long ago
    expect(learned(store({ "flow:1:1": { step: 3, learned: true, last: NOW } }).get, slides[0], NOW)).toBe(true);
  });
});

describe("progress from the earlier trainer", () => {
  test("a slide whose every sentence card is at level 2 or more counts as learned before today", () => {
    const slides = [slide(1, 2), slide(2, 4), slide(3, 1), slide(4, 0)];
    const items = { "train:1:1:h10": { level: 2 }, "train:1:2:h11": { level: 4 },
      "train:2:1:h20": { level: 3 }, "train:2:2:h21": { level: 3 }, "train:2:3:h22": { level: 2 }, "train:2:4:h23": { level: 2 },
      "train:3:1:h30": { level: 1 } };
    const out = migrate(slides, items);
    expect(Object.keys(out)).toEqual(["flow:1:1", "flow:2:1", "flow:2:2", "flow:2:3"]);
    expect(out["flow:2:3"]).toEqual({ step: 3, learned: true, last: 0, at: 0 });
    const s = store({ ...out });
    expect(summary(slides, s.get, NOW)).toEqual({ learned: 2, total: 3, from: slides[2], warm: 2 });
    // a changed sentence (another hash) is a new card: its slide is not learned
    expect(migrate([slide(1, 2)], { "train:1:1:other": { level: 4 }, "train:1:2:h11": { level: 4 } })).toEqual({});
  });

  test("the newer state of a part wins when progress is merged", () => {
    expect(merge({ "flow:1:1": { step: 2, last: 5 } }, { "flow:1:1": { step: 3, last: 9 }, "flow:warm:2026-11-10": { done: [1] } }))
      .toEqual({ "flow:1:1": { step: 3, last: 9 }, "flow:warm:2026-11-10": { done: [1] } });
  });
});
