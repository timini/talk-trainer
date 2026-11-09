import { describe, expect, test } from "vitest";
import { crumbs, instruction, position } from "@/lib/learn/label";
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
  });
});

test("what the card asks for", () => {
  expect([instruction(0), instruction(0.45), instruction(1), instruction(1, true)]).toEqual(["Read it aloud.",
    "Say it, filling in the blanks (45% hidden).", "From memory: say it from the slide.", "From memory: say each slide, then tap Next slide."]);
});
