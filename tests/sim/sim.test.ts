// The learning engine against a simulated learner (tests/sim/learner.ts), on slides of 1 to 12 sentences and on a
// talk of 7 slides, at both aims. It checks that the top is always reached, that the session's pass rate stays near
// the 70 to 85% band, and that no node is picked more than 6 times in a row while there is anything else to do.
//
// The figures, median and 95th percentile attempts to the slide at its bar and the pass rate, 20 slides of each size,
// are in docs/learning.md with the constants they chose. A climb after a miss must go back through the node missed
// (Tim, 9 November): checked here for every run.

import { describe, expect, test } from "vitest";
import type { Aim } from "@/lib/learn/rules";
import { build } from "@/lib/learn/tree";
import { Learner, practise, READ, rng, type Run, slide } from "./learner";

const SIZES = [1, 2, 4, 6, 9, 12];
const quantile = (xs: number[], q: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];
const rate = (rs: Run[]) => rs.reduce((a, r) => a + r.passes, 0) / rs.reduce((a, r) => a + r.counted, 0);

describe("the learner is fitted to the 9 November data", () => {
  test("a known sentence alone passes about 81%, two together about 34%, and a read one about READ", () => {
    const rand = rng(1), tree = build([{ n: 1, sentences: [{ text: "One short sentence here." }, { text: "And another short one." }] }]);
    const [a, b] = tree.nodes.get(tree.roots.get(1) as string)!.leaves;
    const trials = (leaves: string[], hide: number) => {
      let pass = 0;
      for (let k = 0; k < 4000; k += 1) {
        const l = new Learner(rand);
        leaves.forEach((x) => l.know(x, 0.81, 0));
        const s = l.say(tree, leaves, new Map(leaves.map((x) => [x, hide])), 0);
        if ([...s.values()].every((v) => v >= 75)) pass += 1;
      }
      return pass / 4000;
    };
    expect(trials([a], 1)).toBeCloseTo(0.81, 1);
    expect(trials([a, b], 1)).toBeCloseTo(0.34, 1);
    expect(trials([a], 0)).toBeCloseTo(READ, 1);
  });
});

describe.each(["verbatim", "gist"] as Aim[])("%s", (aim) => {
  test.each(SIZES)("a slide of %i sentences reaches its bar", (n) => {
    const rs = Array.from({ length: 20 }, (_, k) => practise([slide(n, 1, rng(k + 100 * n))], aim, k + 1));
    const got = rs.map((r) => r.reached);
    // a climb after a miss never skips the node missed
    expect(rs.map((r) => r.skips)).toEqual(rs.map(() => 0));
    expect(got.every((x) => x !== null)).toBe(true);
    const at = got as number[];
    // fewer attempts than 40 a sentence at the 95th percentile, and the pass rate near the band
    expect(quantile(at, 0.95)).toBeLessThan(45 * n + 20);
    expect(quantile(at, 0.5)).toBeLessThanOrEqual(quantile(at, 0.95));
    expect(rate(rs)).toBeGreaterThan(0.7);
    expect(rate(rs)).toBeLessThan(0.95);
  });

  test("a talk of 7 slides reaches the talk run-through, through its bridges, never 6 picks of one node in a row", () => {
    const rs = Array.from({ length: 5 }, (_, k) => practise([2, 3, 1, 4, 2, 3, 2].map((n, i) => slide(n, i + 1, rng(k * 10 + i))), aim, k + 7));
    for (const r of rs) {
      expect(r.reached).not.toBeNull();
      expect(r.sameMax).toBeLessThanOrEqual(6);
      expect(r.skips).toBe(0);
      expect(r.picks.some((p) => p.node.kind === "bridge")).toBe(true);
      expect(r.picks.at(-1)?.node.kind).toBe("talk");
    }
    expect(rate(rs)).toBeGreaterThan(0.7);
    expect(rate(rs)).toBeLessThan(0.95);
  });
});
