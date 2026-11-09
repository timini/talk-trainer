import { describe, expect, test } from "vitest";
import { band, empty, GOOD, NEARLY, real, score } from "@/lib/score";

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
