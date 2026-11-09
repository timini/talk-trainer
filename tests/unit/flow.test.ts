import { describe, expect, test } from "vitest";
import {
  clipsOf, firstStep, header, INSTRUCTIONS, nextLabel, type Item, learned, migrate, MOST, move, mustOf, next, record, summary, textOf,
  unitsOf, units, warmUp,
} from "@/lib/flow";
import { merge } from "@/lib/schedule";
import type { Slide } from "@/lib/train";

const NOW = Date.parse("2026-11-10T12:00:00Z"), YESTERDAY = NOW - 24 * 3600 * 1000;
const slide = (n: number, count: number, clips = true): Slide => ({ n, title: `Slide ${n}`, image: null,
  sentences: Array.from({ length: count }, (_, i) => ({ i: i + 1, text: `Sentence ${n}.${i + 1}.`, hash: `h${n}${i}`,
    clip: clips ? `/c/${n}-${i}.wav` : null, must_say: [`${n}${i}`] })) });
// A store of progress items, as the engine keeps them.
const store = (items: Record<string, unknown> = {}) => {
  const get = <T>(k: string, d: T): T => (k in items ? (items[k] as T) : d);
  return { items, get, apply: (e: Record<string, unknown>) => Object.assign(items, e) };
};

describe("parts", () => {
  test("a slide of up to 3 sentences is one part, the whole slide; more are split into 3s, then the whole slide", () => {
    const shape = (count: number) => unitsOf(slide(1, count)).map((u) => [u.from, u.to, u.whole]);
    expect(shape(0)).toEqual([]);
    expect(shape(1)).toEqual([[0, 1, true]]);
    expect(shape(2)).toEqual([[0, 2, true]]);
    expect(shape(3)).toEqual([[0, 3, true]]);
    expect(shape(4)).toEqual([[0, 3, false], [3, 4, false], [0, 4, true]]);
    expect(shape(5)).toEqual([[0, 3, false], [3, 5, false], [0, 5, true]]);
    expect(shape(6)).toEqual([[0, 3, false], [3, 6, false], [0, 6, true]]);
    expect(shape(7)).toEqual([[0, 3, false], [3, 6, false], [6, 7, false], [0, 7, true]]);
    expect(shape(8)).toEqual([[0, 3, false], [3, 6, false], [6, 8, false], [0, 8, true]]);
    expect(shape(9)).toEqual([[0, 3, false], [3, 6, false], [6, 9, false], [0, 9, true]]);
    expect(MOST).toBe(3);
    const u = unitsOf(slide(4, 4));
    expect(u.map((x) => [x.key, x.part, x.parts])).toEqual([["flow:4:1", 1, 3], ["flow:4:2", 2, 3], ["flow:4:3", 3, 3]]);
    expect(units([slide(1, 1), slide(2, 0), slide(3, 2)]).map((x) => x.key)).toEqual(["flow:1:1", "flow:3:1"]);
  });

  test("a unit's text, clips and must-say items", () => {
    const [first, , whole] = unitsOf(slide(2, 4));
    expect(textOf(first)).toBe("Sentence 2.1. Sentence 2.2. Sentence 2.3.");
    expect(clipsOf(whole)).toEqual(["/c/2-0.wav", "/c/2-1.wav", "/c/2-2.wav", "/c/2-3.wav"]);
    expect(mustOf(first)).toEqual(["20", "21", "22"]);
    expect(clipsOf(unitsOf(slide(3, 2, false))[0])).toBeNull();
  });
});

describe("steps", () => {
  test("step 1 always moves on; step 2 goes on or repeats; step 3 learns or goes back to step 2", () => {
    expect([move(1, true), move(1, false)]).toEqual([{ step: 2, learned: false }, { step: 2, learned: false }]);
    expect([move(2, true), move(2, false)]).toEqual([{ step: 3, learned: false }, { step: 2, learned: false }]);
    expect([move(3, true), move(3, false)]).toEqual([{ step: 3, learned: true }, { step: 2, learned: false }]);
    const [part, , whole] = unitsOf(slide(1, 4));
    expect([firstStep(part), firstStep(whole), firstStep(unitsOf(slide(1, 2))[0])]).toEqual([1, 3, 1]);
    const item = (step: 1 | 2 | 3, warm = false, u = part): Item => ({ unit: u, step, warm });
    expect([nextLabel(item(1), false), nextLabel(item(2), false), nextLabel(item(2), true), nextLabel(item(3), true),
      nextLabel(item(3, false, whole), true), nextLabel(item(3, true, whole), true), nextLabel(item(3), false)])
      .toEqual(["Next step", "Try again", "Next step", "Next part", "Next slide", "Next", "Try again"]);
    expect(INSTRUCTIONS).toEqual({ 1: "Read it aloud.", 2: "Say it from the first letters.", 3: "Say it from the slide." });
  });

  test("a slide goes through its steps, then the next slide starts, in talk order", () => {
    const slides = [slide(1, 2), slide(2, 0), slide(3, 1)], s = store();
    const walk: string[] = [];
    for (const pass of [true, true, false, true, true, true]) {
      const item = next(slides, s.get, NOW) as Item;
      walk.push(header(item, 3));
      s.apply(record(item, pass, s.get, NOW));
    }
    expect(walk).toEqual(["Slide 1 of 3, step 1 of 3", "Slide 1 of 3, step 2 of 3", "Slide 1 of 3, step 3 of 3",
      "Slide 1 of 3, step 2 of 3", "Slide 1 of 3, step 3 of 3", "Slide 3 of 3, step 1 of 3"]);
    expect(s.items["flow:1:1"]).toEqual({ step: 3, learned: true, last: NOW, at: NOW });
    expect(s.items["flow:3:1"]).toEqual({ step: 2, learned: false, last: NOW });
    expect(learned(s.get, slides[0])).toBe(true);
    expect(learned(s.get, slides[1])).toBe(false);
  });

  test("a split slide: each part from step 1, then the whole slide from step 3; the total never grows", () => {
    const slides = [slide(1, 4)], s = store();
    const walk: string[] = [];
    for (const pass of [true, true, true, true, true, true, false, true, true]) {
      const item = next(slides, s.get, NOW) as Item;
      walk.push(header(item, 86));
      s.apply(record(item, pass, s.get, NOW));
    }
    expect(walk).toEqual([
      "Slide 1 of 86, part 1 of 2, step 1 of 3", "Slide 1 of 86, part 1 of 2, step 2 of 3", "Slide 1 of 86, part 1 of 2, step 3 of 3",
      "Slide 1 of 86, part 2 of 2, step 1 of 3", "Slide 1 of 86, part 2 of 2, step 2 of 3", "Slide 1 of 86, part 2 of 2, step 3 of 3",
      "Slide 1 of 86, whole slide, step 3 of 3", "Slide 1 of 86, whole slide, step 2 of 3", "Slide 1 of 86, whole slide, step 3 of 3",
    ]);
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
    expect(walk).toEqual(["Warm up: slide 1 of 4, step 3 of 3", "Warm up: slide 2 of 4, step 3 of 3",
      "Warm up: slide 2 of 4, step 2 of 3", "Warm up: slide 2 of 4, step 3 of 3", "Slide 4 of 4, step 1 of 3"]);
    expect(s.items["flow:warm:2026-11-10"]).toEqual({ done: [1, 2], step: 3 });
    // the warm-up does not change what was learned; tomorrow it starts again with all three
    expect(s.items["flow:2:1"]).toEqual({ step: 3, learned: true, last: YESTERDAY, at: YESTERDAY });
    expect(warmUp(slides, s.get, NOW + 24 * 3600 * 1000).map((x) => x.n)).toEqual([1, 2, 3]);
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
