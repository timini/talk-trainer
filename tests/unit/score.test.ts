import { describe, expect, test } from "vitest";
import { band, empty, GOOD, NEARLY, real, score, start } from "@/lib/score";

// 20 words
const T = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";

describe("the score", () => {
  test("no problem is 100; one slip is Nearly; a quarter left out, a wrong number or two slips is Missed", () => {
    expect(score([], T)).toBe(100);
    expect(score([{ kind: "stumble", script: "one" }], T)).toBe(80);
    expect(score([{ kind: "order", script: "x" }], T)).toBe(80);
    expect(score([{ kind: "left_out", script: "one two" }], T)).toBe(80); // 10% left out costs the floor of 20
    expect(score([{ kind: "left_out", script: "one two three four five" }], T)).toBe(63); // 25%: 37.5
    expect(score([{ kind: "left_out", script: "one two three four five six" }], T)).toBe(55);
    expect(score([{ kind: "changed", script: "one two three four five six" }], T)).toBe(70);
    expect(score([{ kind: "wrong_term", script: "3", said: "4" }], T)).toBe(55);
    expect(score([{ kind: "stumble", script: "a" }, { kind: "stumble", script: "b" }], T)).toBe(60);
    expect(score([{ kind: "left_out", script: T }, { kind: "left_out", script: T }], T)).toBe(0);
    expect(score([{ kind: "left_out", script: "x" }], "")).toBe(0); // an empty target counts as one word
    expect([band(100), band(GOOD), band(GOOD - 1), band(NEARLY), band(NEARLY - 1)]).toEqual(["good", "good", "nearly", "nearly", "missed"]);
  });

  test("a number said in words is not a wrong number", () => {
    expect(real([{ kind: "wrong_term", script: "Part 3", said: "part three" }, { kind: "wrong_term", script: "500", said: "400" },
      { kind: "wrong_term", script: "AVI" }, { kind: "left_out", script: "3", said: "three" }]))
      .toEqual([{ kind: "wrong_term", script: "500", said: "400" }, { kind: "wrong_term", script: "AVI" },
        { kind: "left_out", script: "3", said: "three" }]);
  });

  test("an empty attempt: fluency and clarity 1, under a fifth of the words heard, or over 80% left out", () => {
    const heard = T.split(" ").slice(0, 10).join(" ");
    expect(empty({ heard: T, fluency: 1, clarity: 1 }, T)).toBe(true);
    expect(empty({ heard: "one two three" }, T)).toBe(true);
    expect(empty({}, T)).toBe(true);
    expect(empty({ heard, problems: [{ kind: "left_out", script: T.split(" ").slice(0, 17).join(" ") }] }, T)).toBe(true);
    expect(empty({ heard, fluency: 1, clarity: 3, problems: [{ kind: "left_out", script: "one two" }, { kind: "stumble", script: "x" }] }, T)).toBe(false);
    expect(empty({ heard: "x" }, "")).toBe(false);
  });
});

describe("where to start", () => {
  // invented sentences shaped like Tim's slide 2: two parts of three, then the whole slide
  const S = ["I am Sam Jones, a baker at Hill Farm.", "I am not a chef and have no catering training.",
    "This talk is what I have learned baking at home.", "I write up what I learn on my blog.",
    "It is not advice, and it is not Hill Farm's view.", "The views are my own."];
  test("the sentence an attempt started at; another part or a later sentence is the wrong place", () => {
    // part 2 asked for, part 1 said (as at 19:14:06), with a greeting and a contraction
    expect(start("Hi, I'm Sam Jones, a baker at Hill Farm. I am not a chef", S, 3)).toBe(0);
    // part 2 asked for, started at its second sentence (19:15:43)
    expect(start("It is not advice, and it is not Hill Farm's view.", S, 3)).toBe(4);
    // the whole slide asked for, only part 2 said (19:20:15)
    expect(start("I write up what I learn on my blog. It is not advice", S, 0)).toBe(3);
    // right starts
    expect(start("I write up what I learn on my blog.", S, 3)).toBe(3);
    expect(start("So, um, I am Sam Jones, a baker", S, 0)).toBe(0);
    expect(start("I'm not a chef, and I have no catering training", S, 1)).toBe(1);
    // nothing recognisable: not known
    expect(start("Something else entirely here today", S, 0)).toBeNull();
    expect(start("", S, 0)).toBeNull();
    // a tie goes to the expected sentence; a very short sentence needs all its words
    expect(start("The views are my own", ["The views are mine.", "The views are my own."], 1)).toBe(1);
    expect(start("Yes indeed", ["Yes.", "Yes indeed."], 1)).toBe(1);
    expect(start("x", [""], 0)).toBeNull();
    // a later sentence with fewer words matched, or tied but not expected, does not take over
    expect(start("We bake bread daily now", ["We bake bread daily.", "We bake bread weekly."], 1)).toBe(0);
    expect(start("We bake bread here", ["We bake bread here.", "We bake bread here too."], 0)).toBe(0);
  });

});
