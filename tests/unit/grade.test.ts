import { describe, expect, test } from "vitest";
import { align, best, edits, flat, grade, match, normalise, phon, said, tokens } from "@/lib/grade";

describe("normalise", () => {
  test("number words count as digits", () => {
    const heard = "Nine cases in ten, zero point nine five nine, two hundred thousand genomes; 87 percent, $11 -0.834 5'";
    const written = "9 cases in 10, 0.959, 200,000 genomes; 87%, $11 -0.834 5'";
    const want = ["9", "cases", "in", "10", "0.959", "200000", "genomes", "87", "percent", "11", "dollars", "minus",
      "0.834", "5", "prime"];
    expect([normalise(heard), normalise(written)]).toEqual([want, want]);
  });

  test("case, punctuation and apostrophes go; a dot inside a word is dot; a comma or full stop ends a number", () => {
    expect(normalise("It’s GPN-MSA, example.io. Nine, two; one two; one hundred and five, a hundred")).toEqual([
      "its", "gpn", "msa", "example", "dot", "io", "9", "2", "1", "2", "100", "and", "5", "a", "hundred"]);
  });

  test("each token knows the display words it came from", () => {
    expect(tokens("Splice AI, two hundred")).toEqual([{ t: "splice", o: [0] }, { t: "ai", o: [1], stop: true },
      { t: "200", o: [2, 3] }]);
  });

  test("more number words: twenty one, a thousand, point at the end, a stop inside a decimal, & and nothing", () => {
    expect(normalise("twenty one thousand")).toEqual(["21000"]);
    expect(normalise("thousand hundred")).toEqual(["thousand", "hundred"]);
    expect(normalise("one thousand thousand, one thousand hundred")).toEqual(["2000", "1100"]);
    expect(normalise("nine point")).toEqual(["9", "point"]);
    expect(normalise("nine point five. two")).toEqual(["9.5", "2"]);
    expect(normalise("nine point x")).toEqual(["9", "point", "x"]);
    expect(normalise("R&D -- ...")).toEqual(["r", "and", "d"]);
  });
});

describe("match and align", () => {
  test("words match exactly, closely or not at all", () => {
    const pairs = [["clinvar", "clinvar"], ["learn", "learned"], ["model", "models"], ["ranked", "ranking"],
      ["make", "making"], ["need", "needs"], ["pathogenicity", "pathogenicty"], ["pathogenicity", "patogenicty"],
      ["variant", "varients"], ["the", "thing"], ["score", "scare"], ["0.959", "0.95"], ["9", "9s"], ["dot", ""],
      ["", ""]];
    expect(pairs.map(([a, b]) => match(a, b))).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, null, null, null, null, null, 0]);
    // words of 8 letters or more: up to a quarter of the letters; 6 or 7 letters: one
    expect([match("calibrated", "calibrator"), match("calibrated", "celebrations"), match("models", "modals"),
      match("models", "medals")]).toEqual([1, null, 1, null]);
    expect(edits("", "abc")).toBe(3);
  });

  test("alignment: which written words were said, and a part said so far lines up with the start", () => {
    expect(align(["a", "b", "c", "d"], ["a", "x", "c"])).toEqual(["ok", false, "ok", false]);
    expect(align(["the", "cat", "the", "dog"], ["the"])).toEqual(["ok", false, false, false]);
    expect(align([], ["a"])).toEqual([]);
    expect(align(["a"], [])).toEqual([false]);
    expect(align(["i", "learn", "it"], ["i", "learned", "it", "now"])).toEqual(["ok", "close", "ok"]);
  });

  test("split and joined words match without a list", () => {
    // up to 5 spoken words for one written word, and one spoken word for up to 3 written ones
    expect(align(["at", "example", "dot", "io"], ["at", "exam", "ple", "dot", "io"])).toEqual(Array(4).fill("ok"));
    expect(align(["brca1", "gene"], ["b", "r", "c", "a", "1", "gene"])).toEqual(["ok", "ok"]);
    expect(align(["evo", "2", "model"], ["evo2", "model"])).toEqual(["ok", "ok", "ok"]);
    expect(align(["u", "dot", "k"], ["uk"])).toEqual(["ok", "ok", "ok"]); // a dot need not be said
    expect(align(["b", "r", "c", "a", "1", "x"], ["brca1x"])).toEqual(Array(6).fill(false)); // 3 at most
    const spoken: Record<string, string> = {
      SpliceAI: "Splice AI", AlphaMissense: "alpha missense", gnomAD: "gnom AD", BRCA1: "B R C A one", H100: "H 100",
      "Evo 2": "evo2", L40S: "L 40 S", FP32: "FP 32", ClinVar: "clin var", ClinGen: "Clin Gen", PP3: "P P 3",
      BP4: "B P 4", AVI: "A V I", ESM1b: "ESM 1b", "87%": "87 per cent", "example.io": "example dot io",
    };
    expect(Object.entries(spoken).filter(([w, s]) => !grade([w], s, [w]).pass)).toEqual([]);
  });

  test("names match by sound however the recogniser spells them", () => {
    // vowels after the first letter go, doubled letters are one, ph f, ck and q k, z s, soft c s
    expect(["alphamissense", "alphamssense", "cadd", "cad", "phone", "quick", "zinc", "cell", ""].map(phon)).toEqual(
      ["alfmsns", "alfmsns", "kd", "kd", "fn", "k", "snk", "sl", ""]);
    // by sound only for names (or words of 8 letters or more)
    expect([match("cadd", "cad", true), match("cadd", "cat", true), match("phase", "faze", true), match("phase", "faze"),
      match("revel", "level", true), match("missense", "misense")]).toEqual([1, null, 1, null, null, 1]);
    // sound keys of 5 letters or more may be one apart
    expect(match("calibrated", "kalibraten", true)).toBe(1);
  });
});

describe("grade", () => {
  test("a close word counts and is marked close", () => {
    const g = grade(["I write up what I learn in the open at example.io."],
      "I write up what I learned in The Open at example.io", ["example.io"]);
    expect(g.pass).toBe(true);
    expect(g.acc).toBe(1);
    expect(g.parts[0].critWrong).toBe(0);
    expect(g.parts[0].words.filter((w) => w.close).map((w) => w.w)).toEqual(["learn"]);
    expect(g.parts[0].words.every((w) => w.ok)).toBe(true);
  });

  test("the pass rule: 85% of the words, and no number or must-say item wrong", () => {
    const twenty = [..."abcdefghijklmnopqrst"].map((c) => `w${c}ord`).join(" ");
    const first = (n: number) => twenty.split(" ").slice(0, n).join(" ");
    let g = grade([twenty], first(17), []);
    expect(g.pass).toBe(true);
    expect(g.acc).toBe(0.85);
    expect(g.parts[0].words.map((w) => w.ok)).toEqual([...Array(17).fill(true), ...Array(3).fill(false)]);
    g = grade([twenty], first(16), []);
    expect(g.pass).toBe(false);
    expect(g.acc).toBe(0.8);
    // a wrong must-say number fails the card, and the whole item is marked
    const line = "Together, they put the right answer first in about 9 cases in 10.";
    g = grade([line], "together they put the right answer first in about eight cases in ten", ["9 cases in 10"]);
    expect(g.pass).toBe(false);
    expect(g.parts[0].critWrong).toBe(4);
    expect(g.parts[0].words[9]).toEqual({ w: "9", ok: false, crit: true, close: false });
    // said in words, or split by the recogniser, a must-say item counts
    for (const heard of ["together they put the right answers first in about nine cases in ten",
      "together they put the right answer first in about 9 cases in 10"]) {
      expect(grade([line], heard, ["9 cases in 10"]).pass).toBe(true);
    }
    // a number written as a digit counts as must-say even when it is not in the slide's list
    g = grade([line], "together they put the right answer first in about 9 cases in 11", []);
    expect(g.pass).toBe(false);
    expect(g.parts[0].critWrong).toBe(1);
  });

  test("a must-say name said as something clearly different fails, all of it marked; split, it passes", () => {
    const names = "We tried four of them: CADD, SpliceAI, REVEL and AlphaMissense.";
    const must = ["CADD, SpliceAI, REVEL and AlphaMissense"];
    let g = grade([names], "we tried four of them cadd splice ai revel and alpha fold", must);
    expect(g.pass).toBe(false);
    expect(g.parts[0].critWrong).toBe(5);
    g = grade([names], "we tried 4 of them cadd splice ai revel and alpha missense", must);
    expect(g.pass).toBe(true);
    expect(g.acc).toBe(1);
  });

  test("a must-say item is said only as a whole run of spoken words", () => {
    expect([said("1", ["10"]), said("1", ["a", "1"]), said("example.io", ["example", "dot", "io"]), said("", ["x"]),
      said("x y", [])]).toEqual([false, true, true, true, false]);
    expect(said("example.io", ["exam", "ple", "io"])).toBe(true);
    // said exactly as a run, it counts in full even where the alignment left a word out
    const g = grade(["See abc.de now."], "see ab cde now", ["abc.de"]);
    expect([g.pass, g.acc]).toEqual([true, 1]);
  });

  test("an empty sentence passes; numbers written as words in the script are not must-say", () => {
    expect(grade([""], "", []).pass).toBe(true);
    expect(grade(["one two three four five six seven eight nine ten"], "one two three four five six seven eight nine", [])
      .pass).toBe(true);
    // a must-say item that is not in the sentence, or is empty, changes nothing
    expect(grade(["Hello there."], "hello there", ["absent", ""]).pass).toBe(true);
  });

  test("a chain passes only if every sentence passes, and a run-through follows the words", () => {
    const parts = ["Good morning, and welcome.", "Diagnostic labs have to decide.", "Today we look."];
    const g = grade(parts, "good morning and welcome diagnostic labs must think today we look", []);
    expect(g.parts.map((p) => p.pass)).toEqual([true, false, true]);
    expect(g.pass).toBe(false);
    // a small word left out ("to") does not count, and is not marked; an added word never counts
    const small = grade(parts, "good morning and welcome so diagnostic labs have decided today we look", []);
    expect(small.parts.map((p) => p.pass)).toEqual([true, true, true]);
    expect(small.parts[1].words.map((w) => w.ok)).toEqual([true, true, true, true, true]);
    expect(small.parts[1].acc).toBe(1);
    const all = "good morning and welcome diagnostic labs have to decide today we look";
    expect(grade(parts, all, []).pass).toBe(true);
    // said so far: the first display word not yet said (counted across sentences), and the words left
    const where = (heard: string) => { const r = grade(parts, heard, []); return [r.at, r.left]; };
    expect(where("good morning and welcome diagnostic")).toEqual([5, 7]);
    expect(where("")).toEqual([0, 12]);
    expect(where(all)).toEqual([12, 0]);
    expect(flat(parts).slice(4, 9)).toEqual([{ w: "Diagnostic", p: 1 }, { w: "labs", p: 1 }, { w: "have", p: 1 },
      { w: "to", p: 1 }, { w: "decide.", p: 1 }]);
    expect(grade([], "anything", []).acc).toBe(1);
  });

  test("names heard in real sessions, and likely spellings of others", () => {
    // AlphaMissense heard as "alpha Ms sense": it counts, dotted, and the must-say item is said
    const line = "We tried four of them: CADD, SpliceAI, REVEL and AlphaMissense.";
    let g = grade([line], "we tried four of them cadd splice AI revel and alpha Ms sense",
      ["CADD, SpliceAI, REVEL and AlphaMissense"]);
    expect([g.pass, g.acc, g.parts[0].critWrong]).toEqual([true, 1, 0]);
    expect(g.parts[0].words.filter((w) => w.close).map((w) => w.w)).toEqual(["AlphaMissense."]);
    // example.io heard as "exam ple.io"
    g = grade(["I write up what I learn in the open at example.io."],
      "I write up what I learned in The Open at exam ple.io", ["example.io"]);
    expect([g.pass, g.acc]).toEqual([true, 1]);
    const heard: Record<string, string> = {
      gnomAD: "gnome ad", ClinVar: "clin var", SpliceAI: "spice AI", "Evo 2": "evo to", "GPN-MSA": "GPN MSA",
      AlphaGenome: "Alpha genome", CADD: "cad", REVEL: "revel",
    };
    expect(Object.entries(heard).map(([w, h]) => [w, grade([`We ran ${w} today.`], `we ran ${h} today`, [w]).pass]))
      .toEqual(Object.keys(heard).map((w) => [w, true]));
    // "to" is 2 only straight after a name: not in plain words, and not for other numbers
    expect([grade(["Go to 2 places."], "go to to places", []).pass,
      grade(["We ran Evo 3 today."], "we ran evo to today", ["Evo 3"]).pass,
      grade(["We ran Evo 4 today."], "we ran evo for today", ["Evo 4"]).pass]).toEqual([false, false, true]);
    // clearly different words still fail
    for (const [w, h] of [["REVEL", "level"], ["CADD", "cat"], ["AlphaMissense", "alpha fold"], ["SpliceAI", "price"],
      ["Evo 2", "evo 3"]]) {
      expect(grade([`We ran ${w} today.`], `we ran ${h} today`, [w]).pass, w).toBe(false);
    }
  });
});

describe("best", () => {
  test("the best of the recogniser's guesses is graded", () => {
    const line = ["Splice AI scores splicing."];
    const b = best(line, [["spliced eye", "spliceai"], ["scars slicing", "scores splicing", "scores"]], ["SpliceAI"]);
    expect(b.heard).toBe("spliceai scores splicing");
    expect(b.result.pass).toBe(true);
    expect(b.result.acc).toBe(1);
    expect(b.pick).toEqual([1, 1]);
    // no better guess: the first stays
    expect(best(line, [["spliceai scores splicing", "nothing"]], []).heard).toBe("spliceai scores splicing");
    expect(best(line, [], []).heard).toBe("");
  });
});

describe("the page's own grade is loose about small words", () => {
  test("small words left out do not count against the 85%; other words and must-say items still do", () => {
    const line = ["I am not a scientist and I have no clinical qualifications."];
    expect(grade(line, "not scientist no clinical qualifications", []).pass).toBe(true);
    expect(grade(line, "i am not a scientist and i have no qualifications", []).pass).toBe(true);
    expect(grade(line, "i am not a scientist and i have", []).pass).toBe(false);
    // a must-say small word still counts
    expect(grade(["We have 2 of them."], "we 2 them", ["of"]).parts[0].critWrong).toBe(1);
  });
});
