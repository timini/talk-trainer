// Tim's budget for the AMP talk (tests/sim/budget.ts): his sessions so far, then the hours left to Friday 13 November,
// against the learner fitted to his first sessions with /learn (FIT_11_NOV). The figures that chose the settings in
// lib/learn/rules.ts are in docs/learning.md; this checks the chosen settings still give them, roughly.

import { describe, expect, test } from "vitest";
import { build } from "@/lib/learn/tree";
import { budget } from "./budget";
import { FIT_10_NOV, FIT_11_NOV, Learner, rng } from "./learner";

describe("the learner refitted to Tim's attempts with /learn (9 and 10 November)", () => {
  test("half hidden, sentences known: 1 sentence about 90%, 2 about 60%, 4 about 38%, 7 about 24%", () => {
    const rates = [1, 2, 4, 7].map((n) => {
      const tree = build([{ n: 1, sentences: Array.from({ length: n }, (_, i) => ({ text: `S${i} the data shows that most of our variants are rare indeed.` })) }]);
      const root = tree.nodes.get(tree.roots.get(1) as string)!, ws = root.leaves.map((l) => tree.nodes.get(l)!.words);
      const rand = rng(n * 13 + 1);
      let ok = 0;
      for (let t = 0; t < 1500; t += 1) {
        const l = new Learner(rand, FIT_10_NOV);
        root.leaves.forEach((x) => l.know(x, 0.85, 0));
        const s = l.say(tree, root.leaves, new Map(root.leaves.map((x) => [x, 0.5])), 0);
        if (root.leaves.reduce((a, x, k) => a + (s.get(x) as number) * ws[k], 0) / ws.reduce((a, b) => a + b, 0) >= 60) ok += 1;
      }
      return ok / 1500;
    });
    [0.9, 0.6, 0.38, 0.24].forEach((want, k) => expect(rates[k]).toBeCloseTo(want, 1));
  });
});

describe("the learner fitted to Tim's first sessions (FIT_11_NOV)", () => {
  // his log, 9 and 10 November: 167 attempts in about 1.75 hours, 7 slides started, 4 at the gist bar and 3 just under;
  // slides passed 82%, sentences 93%, bridges 79%; 86% after more than 3 hours
  test("replaying his sessions gives about what his log shows", () => {
    for (const seed of [1, 2]) {
      const h = budget("gist", seed, FIT_11_NOV).history;
      expect(h.attempts).toBeGreaterThan(140);
      expect(h.attempts).toBeLessThan(200);
      expect(h.started).toBeGreaterThanOrEqual(6);
      expect(h.started).toBeLessThanOrEqual(12);
      expect(h.slides).toBeGreaterThanOrEqual(4);
      expect(h.slides).toBeLessThanOrEqual(11);
      expect(Math.abs(h.byKind.slide - 0.82)).toBeLessThan(0.12);
      expect(Math.abs(h.byKind.sentence - 0.93)).toBeLessThan(0.12);
      expect(Math.abs(h.byKind.bridge - 0.79)).toBeLessThan(0.15);
      expect(h.night).toBeGreaterThan(0.75);
    }
  });
});

// With the settings before 10 November (ALPHA_GOOD as ALPHA, FIRST 10 minutes, GROW 2.5) the same run gave, the mean
// of 5: under FIT_11_NOV a Saturday score of 0.40, 31 slides at the bar and 34 started; under FIT_10_NOV 0.28, 20 and 24.
describe("Tim's budget at the gist", () => {
  test("under the fitted learner: within the hours, the pass rate held, more of the talk known on Saturday", () => {
    for (const seed of [1, 2]) {
      const r = budget("gist", seed, FIT_11_NOV);
      expect(r.attempts).toBeGreaterThan(850);
      expect(r.attempts).toBeLessThan(1100);
      r.blocks.forEach((x) => { expect(x).toBeGreaterThan(0.6); expect(x).toBeLessThanOrEqual(1); });
      expect(r.saturday).toBeGreaterThan(0.45);
      expect(r.slides).toBeGreaterThanOrEqual(35);
      expect(r.started).toBeGreaterThanOrEqual(40);
      expect(r.known).toBeGreaterThan(0.9);
    }
  });
  test("under the 10 November learner, which forgets faster: little worse than before", () => {
    const r = budget("gist", 1, FIT_10_NOV);
    expect(r.saturday).toBeGreaterThan(0.23);
    expect(r.slides).toBeGreaterThanOrEqual(18);
  });
});
