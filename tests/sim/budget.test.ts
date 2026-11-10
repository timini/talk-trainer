// Tim's budget for the AMP talk (tests/sim/budget.ts): about 1100 attempts over 10 hours, Tuesday 10 to Friday 13
// November, against the learner refitted to his first attempts with /learn. The figures that chose the gist settings in
// lib/learn/rules.ts are in docs/learning.md; this checks the chosen settings still give them, roughly.

import { describe, expect, test } from "vitest";
import { build } from "@/lib/learn/tree";
import { budget } from "./budget";
import { FIT_10_NOV, Learner, rng } from "./learner";

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

describe("Tim's budget at the gist", () => {
  test("within the hours, the pass rate in the band, slides at the bar known on Saturday", () => {
    for (const seed of [1, 2]) {
      const r = budget("gist", seed, FIT_10_NOV);
      expect(r.attempts).toBeGreaterThan(850);
      expect(r.attempts).toBeLessThan(1100);
      r.blocks.forEach((x) => { expect(x).toBeGreaterThan(0.65); expect(x).toBeLessThan(0.99); });
      expect(r.slides).toBeGreaterThanOrEqual(10);
      expect(r.started).toBeGreaterThanOrEqual(20);
      expect(r.known).toBeGreaterThan(0.9);
      expect(r.saturday).toBeGreaterThan(0.2);
    }
  });
});
