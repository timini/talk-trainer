import { describe, expect, test } from "vitest";
import { grade } from "@/lib/grade";
import { CARD, judged, MODEL, prompt, report, RUN, same } from "@/lib/judge";

describe("the judge's prompt and schemas", () => {
  test("a card: the meaning, every fail rule and what never fails, the must-say items, and the delivery", () => {
    const text = prompt({ mode: "card", target: "We tried four of them.", glossary: ["CADD"], must: ["four"] });
    expect(text).toMatch(/so that each sentence carries the same meaning as the script\. It does not have to be word for word\./);
    expect(text).toMatch(/The target: We tried four of them\./);
    expect(text).toMatch(/Names in this talk, spelled as they should be written: CADD\./);
    expect(text).toMatch(/Must be said exactly: four\./);
    for (const rule of ["left_out: a point of the script", "changed: the meaning changed", "wrong_term: a number, a name",
      "order: the points were said in a different order", "stumble: a false start, a repeated phrase or a self-correction"]) {
      expect(text).toContain(rule);
    }
    for (const fine of ["a small word added or dropped", "a contraction", "a greeting or a filler", "a synonym that keeps the meaning",
      "light rewording within a point", "how names are spelled"]) {
      expect(text).toContain(fine);
    }
    expect(text).toMatch(/Set meaning_ok to true only when there are no problems/);
    expect(text).toMatch(/whether the voice drops or trails off at the end/);
    expect(prompt({ target: "x" })).toMatch(/Must be said exactly: nothing beyond the names and numbers\./);
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(CARD.required).toEqual(["heard", "meaning_ok", "problems", "clarity", "fluency", "pace", "tip"]);
    expect(Object.keys(CARD.properties).sort()).toEqual([...CARD.required].sort());
    expect(CARD.properties.problems.items.properties.kind.enum).toEqual(["left_out", "changed", "wrong_term", "order", "stumble"]);
    expect(CARD.properties.problems.items.required).toEqual(["kind", "script"]);
    expect(CARD.properties.pace.enum).toEqual(["too slow", "good", "too fast"]);
    expect(MODEL).toMatch(/^gemini-/);
  });

  test("a run-through: its own prompt and schema", () => {
    const text = prompt({ mode: "run", target: "x" });
    expect(text).toMatch(/a run-through of part of the talk/);
    expect(text).toMatch(/Names in this talk, spelled as they should be written: \./);
    expect(RUN.required).toEqual(["pace", "unclear", "work_on"]);
    expect(Object.keys(RUN.properties).sort()).toEqual([...RUN.required].sort());
  });
});

describe("same", () => {
  test("strings are compared whole", () => {
    expect(same("abc", "abc")).toBe(true);
    expect(same("abc", "abd")).toBe(false);
    expect(same("abc", "abcd")).toBe(false);
    expect(same("abcd", "abc")).toBe(false);
    expect(same("", "")).toBe(true);
    expect(same("café", "cafe")).toBe(false);
  });
});

describe("judged", () => {
  const marked = (r: ReturnType<typeof judged>) => r.parts.flatMap((p) => p.words.filter((w) => !w.ok).map((w) => [w.w, w.crit]));
  const line = ["I am not a scientist and have no clinical qualifications.", "What I have learned is mine."];
  const local = grade(line, "", []);

  test("the meaning came through: a pass, nothing marked, even where the page heard nothing", () => {
    const r = judged(local, { heard: "I am not a scientist and I have no clinical qualifications. What I have learned is mine.",
      meaning_ok: true, problems: [], tip: "Good." });
    expect([r.pass, r.acc, marked(r), r.problems, r.judge.tip]).toEqual([true, 1, [], [], "Good."]);
    expect(r.parts.every((p) => p.pass && p.critWrong === 0)).toBe(true);
  });

  test("a left-out phrase marks only its run, not the same word elsewhere", () => {
    const r = judged(local, { meaning_ok: false, problems: [{ kind: "left_out", script: "and have no clinical qualifications" }] });
    expect(r.pass).toBe(false);
    expect(marked(r)).toEqual([["and", false], ["have", false], ["no", false], ["clinical", false], ["qualifications.", false]]);
    expect(r.parts[1].words.every((w) => w.ok)).toBe(true);
    expect(r.acc).toBe(11 / 16);
  });

  test("a repeated word: each quote takes the first run not already taken; case and punctuation do not matter", () => {
    const r = judged(local, { meaning_ok: false, problems: [{ kind: "changed", script: "I", said: "we" }, { kind: "changed", script: "i" }] });
    expect(marked(r)).toEqual([["I", false], ["I", false]]);
    expect(r.parts.map((p) => p.words.filter((w) => !w.ok).length)).toEqual([1, 1]);
    const r2 = judged(local, { meaning_ok: false, problems: [{ kind: "changed", script: "WHAT I HAVE LEARNED" }] });
    expect(marked(r2)).toEqual([["What", false], ["I", false], ["have", false], ["learned", false]]);
  });

  test("a wrong term is marked as a must-say miss; an order problem or a stumble marks nothing; an unknown phrase marks nothing", () => {
    const nums = grade(["Mix 500 grams of flour."], "", ["500"]);
    const r = judged(nums, { meaning_ok: false, problems: [{ kind: "wrong_term", script: "500", said: "400" }] });
    expect([r.pass, marked(r), r.parts[0].critWrong]).toEqual([false, [["500", true]], 1]);
    // one slip is Nearly: it counts, nothing is marked for an order problem, a restart or a phrase not in the target
    for (const problem of [{ kind: "order" as const, script: "I am not a scientist" }, { kind: "stumble" as const, script: "I am", said: "I am I am" },
      { kind: "left_out" as const, script: "never in it" }, { kind: "left_out" as const, script: "..." }]) {
      const x = judged(local, { meaning_ok: false, problems: [problem] });
      expect([x.pass, x.band, marked(x)], problem.kind).toEqual([true, "nearly", []]);
    }
    // a number said in words is the same number: no problem left, so Got it
    const said = judged(nums, { meaning_ok: false, problems: [{ kind: "wrong_term", script: "500", said: "five hundred" }] });
    expect([said.pass, said.band, said.score, said.problems]).toEqual([true, "good", 100, []]);
  });

  test("the pass rule: the score; one restart is Nearly, two slips are Missed", () => {
    const one = judged(local, { meaning_ok: true, problems: [{ kind: "stumble", script: "I am", said: "I am I am" }] });
    expect([one.pass, one.band, one.score]).toEqual([true, "nearly", 80]);
    const two = judged(local, { meaning_ok: false, problems: [{ kind: "stumble", script: "I am", said: "I am I am" },
      { kind: "order", script: "x" }, { kind: "stumble", script: "What", said: "what what" }] });
    expect([two.pass, two.band, two.score]).toEqual([false, "missed", 40]);
    expect(judged(local, { meaning_ok: false, problems: [] }).pass).toBe(false);
    expect(judged(local, {}).pass).toBe(false);
    const empty = judged(grade([""], "", []), { meaning_ok: true });
    expect([empty.pass, empty.acc, empty.parts[0].acc]).toEqual([true, 1, 1]);
  });
});

describe("report", () => {
  test("the run-through report from the judge's pieces", () => {
    const one = { pace: "Steady.", unclear: ["CADD"], work_on: ["Slow down on names.", "Pause at slide changes."] };
    const two = { pace: "Faster at the end.", unclear: ["CADD", "GPN-MSA"],
      work_on: ["Slow down on names.", "Breathe.", "Finish words.", "Look up.", "Smile."] };
    expect(report([{ from: 1, to: 12, reply: one }])).toEqual(
      { pace: ["Steady."], unclear: ["CADD"], work_on: ["Slow down on names.", "Pause at slide changes."] });
    expect(report([{ from: 1, to: 12, reply: one }, { from: 13, to: 20, reply: two }])).toEqual({
      pace: ["Slides 1 to 12: Steady.", "Slides 13 to 20: Faster at the end."], unclear: ["CADD", "GPN-MSA"],
      work_on: ["Slow down on names.", "Pause at slide changes.", "Breathe.", "Finish words.", "Look up."] });
  });
});
