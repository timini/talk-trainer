import { describe, expect, test } from "vitest";
import {
  addDay, delivery, dropAtEnd, fillers, loudness, type Measures, pace, pauses, sumUp, tip, unclear, voiced, wordAt,
} from "@/lib/delivery";
import { grade } from "@/lib/grade";

const m = (kw: Partial<Measures> = {}): Measures =>
  ({ conf: 0.95, unclear: [], wpm: 130, drop: 0.1, level: 0.2, pauses: [], fillers: [], ...kw });

describe("delivery", () => {
  test("pace in words a minute, null under a second or over 400", () => {
    expect([pace(20, 6000), pace(0, 6000), pace(20, 0), pace(20, 900), pace(40, 5000), pace(10, 1000)]).toEqual(
      [200, null, null, null, null, null]);
    expect(pace(30, 6000)).toBe(300);
    expect(pace(40, 6000)).toBe(400);
  });

  test("the level meter", () => {
    expect([loudness([0.1, 0.3]), loudness([])]).toEqual([0.2, null]);
    // the trace while speaking: silence (under a tenth of the mean) trimmed from both ends
    expect(voiced([0, 0, 0.2, 0, 0.2, 0])).toEqual([0.2, 0, 0.2]);
    expect(voiced([0, 0])).toEqual([]);
    // a voice that falls in the last fifth: 0.8 means it ends at a fifth of its level; too short to tell is null
    const steady = Array(20).fill(0.2), falling = [...Array(16).fill(0.2), ...Array(4).fill(0.04)];
    expect([dropAtEnd(steady), dropAtEnd(falling), dropAtEnd([0.2, 0.2]), dropAtEnd([0, 0, 0])]).toEqual([0, 0.8, null, null]);
    expect(dropAtEnd([...Array(16).fill(0.1), ...Array(4).fill(0.3)])).toBe(0); // louder at the end is no drop
    // pauses over 1.2 seconds inside the sentence, as fractions of the way through it; not before or after it
    const trace = [0, 0.2, 0.2, 0.2, ...Array(7).fill(0), 0.2, 0.2, 0];
    expect([pauses(trace, 0.2), pauses(trace, 0.1), pauses([0.2, 0.2], 0.2)]).toEqual([[0.25], [], []]);
    expect([wordAt("You paused before calibrated scores.", 0.5), wordAt("Last word.", 1), wordAt("", 0.5)]).toEqual(
      ["calibrated", "word", ""]);
  });

  test("fillers the script does not have", () => {
    expect(fillers("um so the the model um you know", "so the model")).toEqual(["um", "um", "you know"]);
    expect(fillers("so erm uh like it", "it is like this")).toEqual(["uh", "erm", "so"]);
    expect(fillers("so we stop", "So we stop.")).toEqual([]);
    expect(fillers("", "")).toEqual([]);
  });

  test("unclear words are missed or close names and long words", () => {
    const g = grade(["We scored BRCA1 with CADD and calibrated thresholds, then we stop."],
      "we scored brca 2 with cad and calibrate thresholds then we", []);
    // BRCA1 (a digit), CADD (a capital inside the sentence) and calibrated (long, only close) are unclear; "stop"
    // was missed but is short and plain
    expect(unclear(g)).toEqual(["BRCA1", "CADD", "calibrated"]);
    expect(unclear(grade(["Diagnostic labs work."], "labs work", []))).toEqual(["Diagnostic"]);
    expect(unclear(grade(["Hello there."], "hello there", []))).toEqual([]);
    expect(unclear(grade(["A -- b."], "a b", []))).toEqual([]);
  });

  test("one tip a card, the most useful first", () => {
    expect([m({ unclear: ["CADD", "SpliceAI", "REVEL", "GPU"] }), m({ conf: 0.6 }), m({ conf: 0.6, unclear: ["CADD"] }),
      m({ wpm: 175, drop: 0.6 }), m({ pauses: ["calibrated"], drop: 0.6 }), m({ drop: 0.5, level: 0.01 }),
      m({ level: 0.01 }), m({ fillers: ["um", "um"] }), m({ fillers: ["so"] }), m({ wpm: 90 }), m(),
      m({ conf: null, wpm: null, drop: null, level: null })].map(tip)).toEqual([
      "Some words were unclear: CADD, SpliceAI, REVEL. Finish the consonants and slow down on names.",
      "The recogniser was unsure of you. Finish the consonants and slow down a little.",
      "Some words were unclear: CADD. Finish the consonants and slow down on names.",
      "About 175 words a minute. Aim for 120 to 140 on stage.",
      'You paused before "calibrated". That is the word to practise.',
      "Your voice drops at the end of the sentence. Keep the last word up.",
      "You were quiet. Speak up as if to the back of the room.",
      "2 fillers (um). Pause silently instead.",
      "One filler (so). Pause silently instead.",
      "A little slow; keep it moving.",
      "",
      "",
    ]);
    // one unclear word alone, with good confidence, is not worth a tip
    expect(tip(m({ unclear: ["CADD"] }))).toBe("");
  });

  test("the delivery line and the summaries", () => {
    expect([delivery(m()), delivery(m({ drop: 0.5 })), delivery(m({ conf: null, drop: null })),
      delivery(m({ conf: null, wpm: null, drop: null }))]).toEqual([
      "Clarity 95%, 130 words a minute, volume steady", "Clarity 95%, 130 words a minute, voice drops at the end",
      "130 words a minute", ""]);
    const ms = [m({ unclear: ["CADD", "GPU"], wpm: 120, conf: 0.8 }), m({ unclear: ["CADD"], wpm: 141, conf: 0.9 }),
      m({ unclear: ["AVI", "GPU", "CADD"], wpm: null, conf: null }), m({ unclear: ["REVEL"] })];
    expect(sumUp(ms)).toEqual({ cards: 4, wpm: 130, conf: 0.88, words: ["CADD", "GPU", "AVI"] });
    expect(sumUp([])).toEqual({ cards: 0, wpm: null, conf: null, words: [] });
    // a day's totals, for pace and clarity in progress
    expect(addDay(addDay(null, m({ wpm: 120, conf: 0.8 })), m({ wpm: null, conf: null }))).toEqual(
      { n: 2, wpm: 120, wpmN: 1, conf: 0.8, confN: 1 });
  });
});
