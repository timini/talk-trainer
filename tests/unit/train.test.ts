import { describe, expect, test } from "vitest";
import { grade } from "@/lib/grade";
import { judged, type Problem } from "@/lib/judge";
import { chainStart } from "@/lib/text";
import {
  cardsOf, checkingLine, deliveryLine, heardAll, lastLine, problemLine, reason, doneLines, exportFile, importFile, kind, LEVELS, plural, savedLine, type Slide, startInfo,
  todayLine, verdict, view, weakLine, when,
} from "@/lib/train";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const slide = (n: number, texts: string[], clips = true): Slide => ({ n, title: `Slide ${n}`, image: null,
  sentences: texts.map((text, i) => ({ i: i + 1, text, hash: `ab${n}${i}`, clip: clips ? `/api/files/clips/${n}-${i}.wav` : null,
    must_say: text.match(/\d+/g) ?? [] })) });
const SLIDES = [slide(1, ["Good morning.", "Today we bake 2 loaves.", "Then we eat."]), slide(2, ["Questions?"], false)];

describe("cards and what a card shows", () => {
  const cards = cardsOf(SLIDES);

  test("one card a sentence, keyed by slide, number and hash", () => {
    expect(cards.map((c) => [c.key, c.i, c.words])).toEqual([["train:1:1:ab10", 0, 2], ["train:1:2:ab11", 1, 5],
      ["train:1:3:ab12", 2, 3], ["train:2:1:ab20", 0, 1]]);
  });

  test("a sentence alone until those before it are at level 2, then the chain from the slide's start", () => {
    const levels: Record<string, number | null> = { "train:1:1:ab10": 2, "train:1:2:ab11": 1, "train:1:3:ab12": null };
    const level = (c: { key: string }) => levels[c.key] ?? null;
    expect(view(cards, cards[2], level, chainStart)).toEqual({ lv: 0, chain: false, parts: ["Then we eat."], levels: [0],
      clips: ["/api/files/clips/1-2.wav"], must: [] });
    levels["train:1:2:ab11"] = 3;
    levels["train:1:3:ab12"] = 1;
    expect(view(cards, cards[2], level, chainStart)).toEqual({ lv: 1, chain: true,
      parts: ["Good morning.", "Today we bake 2 loaves.", "Then we eat."], levels: [2, 3, 1],
      clips: ["/api/files/clips/1-0.wav", "/api/files/clips/1-1.wav", "/api/files/clips/1-2.wav"], must: ["2"] });
    // a chain whose earlier level is unknown counts it as 0; a sentence without a clip has none to play
    expect(view(cards, cards[2], level, () => 0).levels).toEqual([2, 3, 1]);
    expect(view(cards, cards[1], () => null, () => 0).levels).toEqual([0, 0]);
    expect(view(cards, cards[3], level, chainStart).clips).toBeNull();
    expect(kind({ chain: true }, cards[2], null)).toBe("Say sentences 1 to 3 of this slide");
    expect(kind({ chain: false }, cards[2], { level: 1, due: 0, streak: 1, lapses: 0, intro: 0, acc: 1, last: 0 })).toBe("Review");
    expect(kind({ chain: false }, cards[2], null)).toBe("New sentence");
  });
});

describe("the words on each screen", () => {
  test("plurals, times and the start line", () => {
    expect([plural(1, "card"), plural(2, "card")]).toEqual(["1 card", "2 cards"]);
    expect(when(Date.parse("2026-11-09T14:30:00Z"), NOW)).toBe("today at 14:30");
    expect(when(Date.parse("2026-11-10T09:00:00Z"), NOW)).toBe("tomorrow at 09:00");
    expect(when(Date.parse("2026-11-12T18:00:00Z"), NOW)).toBe("Thursday at 18:00");
    expect(startInfo({ queue: [{ words: 3 }, { words: 4 }], due: [1], news: [1], next: null }, 1, NOW))
      .toBe("2 sentences, about 1 minute. 1 to review, 1 new.");
    expect(startInfo({ queue: [], due: [], news: [], next: Date.parse("2026-11-10T09:00:00Z") }, 1, NOW))
      .toBe("Come back tomorrow at 09:00 for the next review.");
    expect(startInfo({ queue: [], due: [], news: [], next: null }, 1, NOW)).toBe("Nothing is due.");
    expect(LEVELS).toHaveLength(6);
  });

  test("the progress panel", () => {
    expect(todayLine({ n: 4, got: 3 }, 2, null, NOW)).toBe("Today: 4 cards, 3 got (75%). Streak: 2 days in a row.");
    expect(todayLine(null, 0, { at: Date.parse("2026-11-08T20:00:00Z"), done: 5, got: 4 }, NOW))
      .toBe("No cards yet today. Last session: 5 cards, 4 got, Sunday.");
    expect(todayLine(null, 0, null, NOW)).toBe("No cards yet today.");
    expect(weakLine([{ n: 3, title: "Bread", misses: 1 }, { n: 7, title: "Water", misses: 4 }]))
      .toBe("Missed most: 3. Bread (1 miss); 7. Water (4 misses).");
    expect(weakLine([])).toBe("");
    expect([savedLine("on", NOW - 120000, NOW), savedLine("saving", 0, NOW), savedLine("error", 0, NOW), savedLine("", 0, NOW)])
      .toEqual(["Saved in this browser and online, 2 min ago.", "Saving online...",
        "Saved in this browser; the online copy could not be reached and will be tried again.", "Saved in this browser."]);
  });

  test("the verdict: the meaning came through, or up to 2 problems; the page's own grade without the judge", () => {
    const line = ["Mix 500 grams of flour with 350 grams of water."];
    const local = grade(line, "", ["500"]);
    expect(verdict(judged(local, { heard: "mix 500 grams of flour with 350 grams of water", meaning_ok: true, problems: [] })))
      .toEqual({ head: "Got it", detail: "The meaning came through.", note: "", good: true });
    expect(verdict(judged(local, { heard: "so I mix 500 grams of flour with 350 grams of water", meaning_ok: true, problems: [] })))
      .toEqual({ head: "Got it", detail: "The meaning came through.", note: "Small wording differences are fine.", good: true });
    expect(verdict(judged(local, { meaning_ok: true })).note).toBe("");
    const miss = (problems: Problem[]) => verdict(judged(local, { meaning_ok: false, problems }));
    expect(miss([{ kind: "left_out", script: "with 350 grams of water." }]))
      .toEqual({ head: "Missed", detail: "Left out 'with 350 grams of water'.", note: "", good: false });
    expect(miss([{ kind: "changed", script: "Mix", said: "Stir" }]).detail).toBe("Changed 'Mix' (you said 'Stir').");
    expect(miss([{ kind: "changed", script: "Mix" }]).detail).toBe("Changed 'Mix'.");
    expect(miss([{ kind: "wrong_term", script: "500", said: "400" }]).detail).toBe("'500' wrong (you said '400').");
    expect(miss([{ kind: "order", script: "x" }]).detail).toBe("Order changed.");
    expect(miss([{ kind: "stumble", script: "Mix 500", said: "mix 5 mix 500" }]).detail)
      .toBe("You restarted: 'mix 5 mix 500'. Say it in one smooth line.");
    expect(miss([{ kind: "stumble", script: "Mix 500" }]).detail).toBe("You restarted: 'Mix 500'. Say it in one smooth line.");
    expect(miss([{ kind: "left_out", script: "of water" }, { kind: "wrong_term", script: "500" }, { kind: "order", script: "" },
      { kind: "changed", script: "Mix" }]).detail).toBe("Left out 'of water'; '500' wrong and 2 more.");
    expect(miss([]).detail).toBe("The meaning did not come through.");
    expect(problemLine({ kind: "other" as Problem["kind"], script: "Mix" })).toBe("'Mix' not right");
    // the page's own grade, when the judge could not answer
    expect(verdict(grade(["Add water."], "add water", []))).toEqual({ head: "Got it", detail: "Every word came through.", note: "", good: true });
    expect(verdict(grade(line, "mix 400 grams of flour with 350 grams of water", ["500"])).detail).toBe("A number or must-say item was wrong.");
    expect(verdict(grade(["Add the cold water slowly."], "add the slowly", [])).detail).toBe("2 words missed: cold, water.");
    expect(verdict(grade(["Add the water."], "add the", [])).detail).toBe("1 word missed: water.");
    expect(verdict(grade(["b c d e f g h j"], "", [])).detail).toBe("8 words missed: b, c, d, e, f, g...");
    expect(deliveryLine({ clarity: 4, fluency: 3, pace: "good" })).toBe("clarity 4 of 5, flow 3 of 5, pace good.");
    expect(deliveryLine({})).toBe("clarity ? of 5, flow ? of 5, pace ?.");
  });

  test("the session done screen", () => {
    expect(doneLines({ done: 3, got: 2, missed: 1, top: 1 }, { top: 2, total: 9, next: Date.parse("2026-11-09T14:30:00Z") }, NOW))
      .toEqual(["3 cards: 2 got, 1 missed. 1 more sentence learned; 2 of 9 in all.",
        "Come back today at 14:30: that is when the next review is due."]);
    expect(doneLines({ done: 0, got: 0, missed: 0, top: 0 }, { top: 0, total: 9, next: null }, NOW))
      .toEqual(["No cards marked.", "Nothing more is due before the talk."]);
  });

  test("export and import", () => {
    const text = exportFile("t1", { "train:days": ["2026-11-09"] }, NOW);
    expect(JSON.parse(text)).toEqual({ kind: "talk-trainer-progress", talk: "t1", exported: "2026-11-09T12:00:00.000Z",
      items: { "train:days": ["2026-11-09"] } });
    expect(importFile(text)).toEqual({ "train:days": ["2026-11-09"] });
    for (const bad of ["{nope", "null", '{"kind":"other","items":{}}', '{"kind":"talk-trainer-progress"}',
      '{"kind":"talk-trainer-progress","items":[]}', '{"kind":"talk-trainer-progress","items":3}']) {
      expect(() => importFile(bad), bad).toThrow("That file is not a progress export.");
    }
  });
});

describe("judging in the background", () => {
  const line = ["Mix 500 grams of flour with water."];
  const local = grade(line, "", ["500"]);

  test("the recording stops once the recogniser has heard the last words", () => {
    expect(heardAll(line, [["mix 500 grams of flour"]], ["500"])).toBe(false);
    expect(heardAll(line, [["mix 500 grams of flour"], ["with water"]], ["500"])).toBe(true);
    expect(heardAll(line, [["mix five hundred grams", "mix 500 grams"], ["of flour with water"]], ["500"])).toBe(true);
    expect(heardAll(line, [], [])).toBe(false);
  });

  test("why a card was missed, in a few words", () => {
    const why = (problems: Problem[], meaning_ok = false) => reason(judged(local, { meaning_ok, problems }));
    expect(why([{ kind: "left_out", script: "with water" }])).toBe("left out a point");
    expect(why([{ kind: "changed", script: "Mix" }])).toBe("changed the meaning");
    expect(why([{ kind: "wrong_term", script: "500" }])).toBe("a number, name or term wrong");
    expect(why([{ kind: "order", script: "" }])).toBe("order changed");
    expect(why([{ kind: "stumble", script: "Mix", said: "mix mix" }], true)).toBe("a restart");
    expect(why([{ kind: "other" as Problem["kind"], script: "Mix" }])).toBe("something not right");
    expect(why([])).toBe("the meaning did not come through");
    // the page's own grade
    expect(reason(grade(line, "mix 400 grams of flour with water", ["500"]))).toBe("a number or must-say item");
    expect(reason(grade(["Add the cold water slowly now."], "add the", []))).toBe("missed cold, water, slowly...");
    expect(reason(grade(["Add the cold water."], "add the water", []))).toBe("missed cold");
    expect(reason(grade(["Add water."], "add water", []))).toBe("not enough of the words");
  });

  test("the strip about the last card", () => {
    const missed = judged(local, { meaning_ok: true, problems: [{ kind: "stumble", script: "Mix", said: "mix mix" }] });
    const got = judged(local, { meaning_ok: true, problems: [] });
    expect(lastLine({ checking: true, result: null, marked: null, error: "" })).toEqual({ text: "Last: checking...", tone: "" });
    expect(lastLine({ checking: false, result: got, marked: true, error: "" })).toEqual({ text: "Last: Got it", tone: "good" });
    expect(lastLine({ checking: false, result: missed, marked: false, error: "" }))
      .toEqual({ text: "Last: Missed, it will come back (a restart)", tone: "bad" });
    // counted as missed by hand, though the judge passed it
    expect(lastLine({ checking: false, result: got, marked: false, error: "" }).text).toBe("Last: Missed, it will come back");
    expect(lastLine({ checking: false, result: null, marked: false, error: "" }).text).toBe("Last: Missed, it will come back");
    expect(lastLine({ checking: false, result: null, marked: null, error: "The judge answered 502." }))
      .toEqual({ text: "Last: not checked. The judge answered 502.", tone: "bad" });
    expect([checkingLine(1), checkingLine(2)]).toEqual(["Checking the last one...", "Checking the last 2..."]);
  });
});
