import { describe, expect, test } from "vitest";
import { hide, blank, chainStart, cue, cues, glossary, mustSay, redact, redactBits, sentences, shows } from "@/lib/text";

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

describe("mustSay", () => {
  test("the names and numbers in a sentence, each once, in order", () => {
    expect(mustSay("We ran BRCA1 on an H100, at 87% and 0.95, then BRCA1 again for 2026’s budget at example.io."))
      .toEqual(["BRCA1", "H100", "87%", "0.95", "2026", "example.io"]);
    expect(mustSay("Nothing to see here.")).toEqual([]);
  });
});

describe("hide", () => {
  test("only the phrases missed become first letters; with none missed, every word does", () => {
    const t = "I am not a clinical scientist and have no clinical qualifications.";
    expect(hide(t, [])).toBe("I a n a c s a h n c q.");
    expect(hide(t, ["and have no clinical qualifications"])).toBe("I am not a clinical scientist a h n c q.");
    // case and punctuation aside; a repeated word is hidden only where the phrase is
    expect(hide(t, ["Clinical Qualifications!"])).toBe("I am not a clinical scientist and have no c q.");
    expect(hide("We scored 0.95, then 13,000.", ["0.95"])).toBe("We scored 0, then 13,000.");
    // a phrase not found, or with no words, hides nothing; two phrases each hide their run
    expect(hide(t, ["not here", "..."])).toBe(t);
    expect(hide(t, ["I am", "no"])).toBe("I a not a clinical scientist and have n clinical qualifications.");
  });
});

describe("redact", () => {
  const T = "We combined CADD, SpliceAI, REVEL and AlphaMissense to rank 9 in 10 cases first.";
  test("hides that share of the words, terms shown in full or by their first letter, missed phrases cued, varied by seed", () => {
    const half = redact(T, 0.5, [], [], 1);
    expect(half.split(" ").filter((w) => /^_+[,.]?$/.test(w)).length).toBe(7);
    expect(redact(T, 0.5, [], [], 1)).toBe(half);
    expect(redact(T, 0.5, [], [], 2)).not.toBe(half);
    const terms = ["CADD", "SpliceAI", "REVEL", "AlphaMissense", "9 in 10"];
    const kept = redact(T, 0.95, terms, [], 3);
    for (const term of ["CADD", "SpliceAI", "REVEL", "AlphaMissense"]) expect(kept).toContain(term);
    const firsts = redact(T, 0.1, [], [], 3, ["SpliceAI", "AlphaMissense"]);
    expect(firsts).toContain("S_______");
    expect(firsts).toContain("A____________");
    expect(redact(T, 0.9, [], ["to rank"], 4)).toMatch(/\bt_ r___\b/);
    expect(redact(T, 0.9, [], ["not in it", "..."], 4)).toBe(redact(T, 0.9, [], [], 4));
    expect([redact(T, 0, [], [], 5), redact(T, 1, [], [], 5)]).toEqual([T, ""]);
  });
});

describe("redactBits", () => {
  test("redaction pieces: hidden words keep their own text, so each gap is as long as the word", () => {
    const bits = redactBits("We bake bread, slowly.", 1, ["We"], [], 7, []);
    expect(bits).toEqual([{ kind: "word", t: "We" }, { kind: "text", t: " " }, { kind: "hidden", t: "bake" }, { kind: "text", t: " " },
      { kind: "hidden", t: "bread" }, { kind: "text", t: ", " }, { kind: "hidden", t: "slowly" }, { kind: "text", t: "." }]);
    expect(redactBits("Bake it", 1, [], ["bake"], 1, ["it"]).map((b) => b.kind)).toEqual(["cue", "text", "cue"]);
    expect(redactBits("Go", 0, [], [], 1)).toEqual([{ kind: "word", t: "Go" }]);
  });

  test("hidden words are spread evenly: the share exactly, never three gaps in a row up to 30%, different per seed", () => {
    const text = "Published benchmarks test models on ClinVar in bulk, and clinical filtering leaves only about twenty rare candidates to rank.";
    const gaps = (seed: number, share: number) => redactBits(text, share, [], [], seed).filter((b) => b.kind !== "text")
      .map((b) => b.kind === "hidden");
    for (let seed = 1; seed <= 200; seed += 1) {
      const g = gaps(seed, 0.3);
      expect(g.filter(Boolean).length).toBe(Math.round(0.3 * g.length));
      expect(g.some((x, i) => x && g[i + 1] && g[i + 2])).toBe(false);
    }
    expect(gaps(1, 0.3)).not.toEqual(gaps(2, 0.3));
  });
});
