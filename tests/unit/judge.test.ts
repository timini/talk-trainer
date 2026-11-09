import { describe, expect, test } from "vitest";
import { grade } from "@/lib/grade";
import { CARD, judged, MODEL, prompt, report, RUN, same } from "@/lib/judge";

describe("the judge's prompt and schemas", () => {
  test("a card: the sentence, the glossary, strict on restarts, and the delivery", () => {
    const text = prompt({ mode: "card", target: "We tried four of them.", glossary: ["CADD"] });
    expect(text).toMatch(/The target sentence: We tried four of them\./);
    expect(text).toMatch(/Names in this talk, spelled as they should be written: CADD\./);
    expect(text).toMatch(/ignore spelling, punctuation and how names are written/);
    expect(text).toMatch(/Be strict about restarts/);
    expect(text).toMatch(/whether the voice drops or trails off at the end/);
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(CARD.required).toEqual(["heard", "verbatim", "missed", "stumbles", "clarity", "fluency", "pace", "tip"]);
    expect(Object.keys(CARD.properties).sort()).toEqual([...CARD.required].sort());
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
  const line = ["Together, they put the right answer first in about 9 cases in 10."];
  const must = ["9 cases in 10"];

  test("the judge heard a wrong number: the card fails and the number is marked", () => {
    const local = grade(line, "together they put the right answer first in about 9 cases in 10", must);
    const g = judged(local, { heard: "...", verbatim: false, missed: ["9"], clarity: 5, pace: "good", tip: "Nine." });
    expect(g.pass).toBe(false);
    expect(g.parts[0].critWrong).toBe(1);
    expect(Math.round(g.acc * 1000) / 1000).toBe(0.923);
    expect(g.parts[0].words.filter((w) => !w.ok).map((w) => w.w)).toEqual(["9"]);
    expect(g.judge.tip).toBe("Nine.");
  });

  test("word for word: a pass, even where the page heard it wrong; no dotted words", () => {
    const bad = grade(line, "together they put the right answer first in about", must);
    const g = judged(bad, { heard: "...", verbatim: true, missed: [], clarity: 4, pace: "good", tip: "Good." });
    expect(g.pass).toBe(true);
    expect(g.acc).toBe(1);
    expect(g.parts[0].words.every((w) => w.ok && !w.close)).toBe(true);
  });

  test("one small word dropped is a pass by the 85% rule; two of nine is a miss; a restart fails", () => {
    const names = ["We tried four of them: CADD, SpliceAI, REVEL and AlphaMissense."];
    const local = grade(names, "tried four of them cad splice ai rebel and alchemist sense", []);
    const one = judged(local, { heard: "...", verbatim: false, missed: ["We"], clarity: 5, pace: "good", tip: "We." });
    expect(one.pass).toBe(true);
    expect(one.parts[0].words.filter((w) => !w.ok).map((w) => w.w)).toEqual(["We"]);
    expect(judged(local, { heard: "...", verbatim: false, missed: ["We", "four"], clarity: 5, pace: "good", tip: "." })
      .pass).toBe(false);
    const restart = judged(local, { heard: "...", verbatim: true, missed: [], stumbles: ["a lab searches when a lab"],
      clarity: 4, fluency: 2, pace: "good", tip: "." });
    expect(restart.pass).toBe(false);
    expect(restart.stumbles).toEqual(["a lab searches when a lab"]);
  });

  test("not word for word with nothing listed fails, with no words marked; an empty sentence counts in full", () => {
    const g = judged(grade([""], "", []), { verbatim: false });
    expect(g.pass).toBe(false);
    expect(g.acc).toBe(1);
    expect(g.parts[0].acc).toBe(1);
    expect(judged(grade(["Hello there."], "hello", []), { verbatim: false }).pass).toBe(false);
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
