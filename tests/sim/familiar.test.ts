// Getting familiar against the learner fitted to Tim's sessions (FIT_11_NOV), on the shape of his talk: each slide
// read 6 times (now, 20 and 40 minutes later, the next morning, 20 minutes after that, and a day later), the share
// hidden set by the rule before 11 November (0, then the 30% cap after one good reading) or by the staircase. It
// checks what the staircase is for: most readings good, no jump of more than 10% between two readings of a slide.
// The figures are in docs/learning.md.

import { describe, expect, test } from "vitest";
import { hiding, type State, staircase } from "@/lib/learn/model";
import { FAMILIAR_HIDE, FAMILIAR_OK } from "@/lib/learn/rules";
import { build, type Node } from "@/lib/learn/tree";
import { talk } from "./budget";
import { FIT_11_NOV, Learner, rng } from "./learner";

const MIN = 60000, HOUR = 60 * MIN;
const TIMES = [0, 20 * MIN, 40 * MIN, 14 * HOUR, 14 * HOUR + 20 * MIN, 38 * HOUR];
type Rule = "before" | "staircase" | "read";

export const walk = (rule: Rule, seed: number) => {
  const tree = build(talk()), rand = rng(seed), l = new Learner(rand, FIT_11_NOV);
  let good = 0, n = 0, jump = 0, last = 0;
  for (const [, id] of tree.roots) {
    const leaves = (tree.nodes.get(id) as Node).leaves, words = leaves.map((x) => (tree.nodes.get(x) as Node).words);
    let st: State | null = null, share = 0, prevShare = 0;
    TIMES.forEach((t, k) => {
      const node = tree.nodes.get(id) as Node;
      const hide = rule === "staircase" ? hiding(tree, node, new Map(), "familiar", null, st) : new Map(leaves.map((x) => [x, share]));
      const said = l.say(tree, leaves, hide, t);
      const points = Math.round(leaves.reduce((a, x, i) => a + (said.get(x) as number) * words[i], 0) / words.reduce((a, b) => a + b, 0));
      n += 1;
      // the learner's score is recall alone (no delivery half), so it is the staircase's measure
      if (points >= FAMILIAR_OK) good += 1;
      if (k) jump = Math.max(jump, share - prevShare);
      prevShare = share;
      if (rule === "read") share = 0;
      else if (rule === "staircase") {
        const s = staircase(st, share, points);
        st = { s: 0, at: t, interval: 0, n: k + 1, passes: 0, lastPass: 0, run: 0, hid: share, ...s };
        share = s.next;
      } else share = points >= FAMILIAR_OK ? FAMILIAR_HIDE : 0;
    });
    last += share;
  }
  return { good: good / n, jump: Math.round(jump * 100) / 100, hidden: Math.round((100 * last) / tree.roots.size) / 100 };
};

describe("getting familiar: hiding in steps", () => {
  test("the staircase keeps most readings recalled with no jump over 10%; the rule before jumped 30% at once", () => {
    const runs = (rule: Rule) => Array.from({ length: 5 }, (_, k) => walk(rule, k + 1));
    const mean = (xs: number[]) => Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 100;
    const before = runs("before"), stair = runs("staircase");
    const sum = (rs: ReturnType<typeof walk>[]) => ({ good: mean(rs.map((r) => r.good)), jump: Math.max(...rs.map((r) => r.jump)),
      hidden: mean(rs.map((r) => r.hidden)) });
    const b = sum(before), s = sum(stair), r = sum(runs("read"));
    process.stderr.write(`\nfamiliar sim: read only ${JSON.stringify(r)}; before ${JSON.stringify(b)}; staircase ${JSON.stringify(s)}\n`);
    expect(b.jump).toBe(FAMILIAR_HIDE);
    expect(s.jump).toBeLessThanOrEqual(0.1);
    expect(s.good).toBeGreaterThanOrEqual(0.7);
    expect(s.good).toBeLessThanOrEqual(0.9);
    expect(s.good).toBeGreaterThan(b.good);
  });
});
