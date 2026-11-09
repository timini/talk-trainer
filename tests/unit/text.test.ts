import { describe, expect, test } from "vitest";
import { blank, chainStart, cue, cues, glossary, sentences, shows } from "@/lib/text";

describe("sentences", () => {
  test("split after . ! or ? and a closing quote or bracket, so 0.95 stays whole", () => {
    expect(sentences('AUROC was 0.95. Is it good? "Yes." Then (we stop.) End')).toEqual(
      ["AUROC was 0.95.", "Is it good?", '"Yes."', "Then (we stop.)", "End"]);
    expect(sentences("  ")).toEqual([]);
    expect(sentences("One.  Two!")).toEqual(["One.", "Two!"]);
    expect(sentences("One.  Two! Three’s 0.5% ‘x’) four")).toEqual(["One.", "Two!", "Three’s 0.5% ‘x’) four"]);
    expect(sentences("Ends here.")).toEqual(["Ends here."]);
  });
});

describe("cues", () => {
  test("the cue keeps first letters, punctuation and capitals", () => {
    expect(cue("Good morning, and welcome. Don’t score 9 billion variants (yet); it's GEL-wide!"))
      .toBe("G m, a w. D s 9 b v (y); i G-w!");
  });

  test("vanishing text blanks more each round", () => {
    const text = "One two three four five six seven eight. It’s 0.95 now, so we stop.";
    expect([0, 1, 2, 3, 4].map((r) => blank(text, r))).toEqual([
      text,
      // a number such as 0.95 is one word
      "One two three ____ five six seven _____. It’s 0.95 now, __ we stop.",
      "One ___ three ____ five ___ seven _____. It’s ____ now, __ we ____.",
      "O t t f f s s e. I 0.9 n, s w s.",
      "________\n________",
    ]);
  });

  test("cue levels, and a chain shows each sentence at its own level", () => {
    const parts = ["One two three four five.", "Six seven."];
    expect([0, 1, 2, 3, 4].map((l) => cues(parts, [l, l]))).toEqual([
      "One two three four five. Six seven.",
      "One two three ____ five. Six seven.",
      "One ___ three ____ five. Six _____.",
      "O t t f f. S s.",
      "________ ________",
    ]);
    expect(cues(parts, [3, 0])).toBe("O t t f f. Six seven.");
  });

  test("levels 0 to 2 show the slide, its key point and the sentence before; 3 the letters; 4 the slide only", () => {
    expect([0, 1, 2, 3, 4].map(shows)).toEqual([
      ...Array(3).fill({ image: true, point: true, before: true }),
      { image: false, point: false, before: false }, { image: true, point: false, before: false }]);
  });

  test("a chain from the slide's start once every sentence before is at level 2", () => {
    expect([chainStart([2, 3, null], 2), chainStart([2, 1, null], 2), chainStart([null], 0),
      chainStart([null, null], 1), chainStart([4, 0], 1)]).toEqual([0, 2, 0, 1, 0]);
  });
});

describe("glossary", () => {
  test("the talk's names for the judge", () => {
    const slides = [{
      must_say: ["AlphaMissense and REVEL", "9 cases in 10", "a long must say item"],
      sentences: ["We combined CADD, SpliceAI and GPN-MSA’s scores at example.io.",
        "BRCA1 on an H100, 2026 and 9 billion; Then Done."],
    }];
    expect(glossary(slides)).toEqual(["AlphaMissense and REVEL", "BRCA1", "CADD", "example.io", "GPN-MSA", "H100",
      "SpliceAI"]);
  });

  test("names the same but for case are sorted by case, each once; none from plain words", () => {
    expect(glossary([{ must_say: ["iPad"], sentences: ["An IPad, an iPAD and an iPad."] }])).toEqual(["IPad", "iPAD", "iPad"]);
    expect(glossary([{ must_say: ["iPad", "IPad"], sentences: [] }])).toEqual(["IPad", "iPad"]);
    expect(glossary([{ must_say: [], sentences: ["Hello there."] }, { must_say: ["Zed", "ZedA"], sentences: [] }]))
      .toEqual(["Zed", "ZedA"]);
  });
});
