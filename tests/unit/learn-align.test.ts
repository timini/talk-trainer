import { describe, expect, test } from "vitest";
import { tokens } from "@/lib/grade";
import { locate, place, placed } from "@/lib/learn/align";

const TEXT = "We trained a foundation model on 9 cohorts and then we asked the families what they thought.";
const words = TEXT.split(" ");
const at = (phrase: string) => {
  const p = place([{ kind: "left_out", script: phrase }], TEXT)[0].words;
  return p && p.map((w) => words[w]).join(" ");
};

describe("placing a quoted phrase by alignment", () => {
  test("an exact quote", () => {
    expect(at("asked the families")).toBe("asked the families");
  });
  test("near-quotes: a hyphen, a number in words, one word changed, an extra word", () => {
    expect(at("foundation-model")).toBe("foundation model");
    expect(at("on nine cohorts")).toBe("on 9 cohorts");
    expect(at("we asked the parents what they thought")).toBe("we asked the families what they thought.");
    expect(at("asked all the families")).toBe("asked the families");
    // close word forms count
    expect(at("we train a foundation model")).toBe("We trained a foundation model");
  });
  test("a phrase that is not there, or matches too little of it, is not placed", () => {
    expect(at("the weather in Cambridge was lovely")).toBeNull();
    expect(at("they cooked the dinner for everyone today")).toBeNull();
    expect(at("...")).toBeNull();
    expect(at("on 8 cohorts")).toBe("on 9 cohorts"); // 2 of 3 words: placed
    expect(at("8")).toBeNull();
  });
  test("the earliest best span; a span already taken is not used again", () => {
    const toks = tokens("we went and we went");
    expect(locate("we went", toks)).toEqual([0, 1]);
    expect(locate("we went", toks, new Set([0, 1]))).toEqual([3, 4]);
    const both = place([{ kind: "left_out", script: "we went" }, { kind: "changed", script: "we went" }, { kind: "order", script: "we" }],
      "we went and we went");
    expect(both.map((x) => x.words)).toEqual([[0, 1], [3, 4], null]);
  });
});

describe("an attempt's problems on the leaves", () => {
  const leaves = ["We trained a foundation model on 9 cohorts", "and then we asked the families what they thought."];
  test("each leaf charged where its problem falls, near-quote or not; the words missed and the wrong terms", () => {
    const got = placed([{ kind: "left_out", script: "and then we asked the parents what they thought" },
      { kind: "wrong_term", script: "nine" }], leaves);
    expect(got.scores).toEqual([55, 0]);
    expect([...got.missed].sort((a, b) => a - b)).toEqual([6, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect([...got.crit]).toEqual([6]);
    expect(got.trouble).toEqual([[0, 0, 0, 0, 0, 0, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1, 1]]);
  });
  test("a stumble adds half; an order problem costs every leaf 20; a phrase not placed costs every leaf its whole cost", () => {
    const got = placed([{ kind: "stumble", script: "a foundation" }, { kind: "order", script: "x" },
      { kind: "changed", script: "the weather in Cambridge was lovely" }], leaves);
    expect(got.trouble[0]).toEqual([0, 0, 0.5, 0.5, 0, 0, 0, 0]);
    expect(got.missed.size).toBe(0);
    expect(got.scores).toEqual([25, 45]);
  });
});
