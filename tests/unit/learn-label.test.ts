import { describe, expect, test } from "vitest";
import { crumbs, instruction, position, sections } from "@/lib/learn/label";
import { build, type Input, type Node } from "@/lib/learn/tree";

const said = (n: number, texts: string[]): Input => ({ n, sentences: texts.map((text) => ({ text })) });
const long = "We looked at the data closely, and we found that most variants were rare; so we asked families.";
const tree = build([said(1, ["First one here.", long, "Third one here.", "Fourth one here."]), said(2, ["Just one."]), said(3, [long])]);
const at = (slide: number, kind: string, k = 0) => tree.order.map((id) => tree.nodes.get(id) as Node)
  .filter((x) => x.slides[0] === slide && x.slides.length === 1 && x.kind === kind)[k];

describe("position and the path to it", () => {
  test("clauses, sentences, groups and the slide", () => {
    expect(position(tree, at(1, "clause", 1))).toBe("Sentence 2, clause 2 of 3");
    expect(position(tree, at(1, "clauses"))).toBe("Sentence 2, clauses 1 to 2 of 3");
    expect(position(tree, at(1, "sentence", 1))).toBe("Sentence 2 of 4");
    expect(position(tree, at(1, "group"))).toBe("Sentences 1 to 2 of 4");
    expect(position(tree, at(1, "slide"))).toBe("Whole slide: all 4 sentences");
    expect(position(tree, at(2, "slide"))).toBe("Whole slide: 1 sentence");
    expect(crumbs(tree, at(1, "clause", 1))).toEqual(["Slide 1", "Sentences 1 to 2", "Sentence 2", "Sentence 2, clauses 1 to 2",
      "Sentence 2, clause 2"]);
    expect(crumbs(tree, at(1, "slide"))).toEqual(["Slide 1"]);
    const lone = build([said(1, ["One.", "Two."])]);
    expect(crumbs(lone, lone.nodes.get(lone.order[1]) as Node)).toEqual(["Slide 1", "Sentence 2"]);
    // a slide of one long sentence: its clauses under the slide
    expect(crumbs(tree, at(3, "clause", 2))).toEqual(["Slide 3", "Sentence 1, clause 3"]);
  });

  test("bridges, sections and the talk", () => {
    const b = tree.nodes.get(tree.order.find((id) => id.startsWith("b:2:")) as string) as Node;
    expect([position(tree, b), crumbs(tree, b)]).toEqual(["From slide 2 into slide 3", []]);
    expect([position(tree, tree.nodes.get("t") as Node), crumbs(tree, tree.nodes.get("t") as Node)]).toEqual(["Run-through: the whole talk", []]);
    const big = build(Array.from({ length: 8 }, (_, k) => said(k + 1, ["Hello there."])));
    expect(position(big, big.nodes.get("sec:2") as Node)).toBe("Run-through: slides 6 to 8");
    const named = build([{ ...said(1, ["One."]), section: "Opening" }, said(2, ["Two."]), { ...said(3, ["Three."]), section: "Close" }, said(4, ["Four."])]);
    expect(position(named, named.nodes.get("sec:1") as Node)).toBe("Run-through: Opening, slides 1 to 2");
  });
});

test("the sections to choose from: the deck's own, else the run-through groups, else none", () => {
    const deckOwn = [{ n: 1, section: "Opening" }, { n: 2, section: null }, { n: 3, section: "Data" }, { n: 4 }, { n: 5, section: "" }];
    expect(sections([{ n: 1 }, { n: 2, section: "Data" }], tree)).toEqual([{ name: "Slides 1 to 1", from: 1, to: 1 }, { name: "Data", from: 2, to: 2 }]);
    expect(sections(deckOwn, tree)).toEqual([{ name: "Opening", from: 1, to: 2 }, { name: "Data", from: 3, to: 5 }]);
    const big = build(Array.from({ length: 8 }, (_, k) => said(k + 1, ["Hello there."])));
    expect(sections(Array.from({ length: 8 }, (_, k) => ({ n: k + 1 })), big)).toEqual([{ name: "Slides 1 to 5", from: 1, to: 5 },
      { name: "Slides 6 to 8", from: 6, to: 8 }]);
    expect(sections([{ n: 1 }, { n: 2 }], tree)).toEqual([]);
});

test("what the card asks for", () => {
  expect([instruction(0), instruction(0.45), instruction(1), instruction(1, true)]).toEqual(["Read it aloud.",
    "Say it, filling in the blanks (45% hidden).", "From memory: say it from the slide.", "From memory: say each slide, then tap Next slide."]);
});
