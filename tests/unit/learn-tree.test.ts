import { describe, expect, test } from "vitest";
import { build, clauses, hash, type Input, type Node, paragraphs } from "@/lib/learn/tree";

const said = (n: number, texts: string[], paras?: number[]): Input => ({ n, sentences: texts.map((text) => ({ text })), paras });
const short = (k: number) => `Sentence ${k} is short.`;
const shape = (tree: ReturnType<typeof build>, slide: number) => tree.order.map((id) => tree.nodes.get(id) as Node)
  .filter((x) => x.slides.length === 1 && x.slides[0] === slide && x.kind !== "talk").map((x) => `${x.kind} ${x.from}-${x.to}`);

describe("clauses", () => {
  test("a sentence of 12 words or fewer is one clause", () => {
    expect(clauses("One, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve.")).toHaveLength(1);
    expect(clauses("  Spaces   are   tidied.  ")).toEqual(["Spaces are tidied."]);
  });
  test("a longer one splits after a comma, semicolon, colon or dash, into clauses of at least 4 words", () => {
    expect(clauses("We looked at the data closely, and we found that most variants were rare; so we asked families - "
      + "and they all answered.")).toEqual(["We looked at the data closely,", "and we found that most variants were rare;",
      "so we asked families -", "and they all answered."]);
    // a cut that would leave fewer than 4 words before or after is not made
    expect(clauses("Yes, we looked at the data closely and found that the variants were rare, mostly.")).toEqual([
      "Yes, we looked at the data closely and found that the variants were rare, mostly."]);
    expect(clauses("One two three four five six seven eight nine ten eleven twelve: thirteen.")).toHaveLength(1);
  });
});

describe("paragraphs", () => {
  test("the sentences that start a paragraph of the notes", () => {
    const notes = "First one. Second one.\nThird one.\nFourth one. Fifth one.";
    expect(paragraphs(notes, ["First one.", "Second one.", "Third one.", "Fourth one.", "Fifth one."])).toEqual([0, 2, 3]);
  });
  test("no breaks, a sentence across a break, and a sentence not found", () => {
    expect(paragraphs("One. Two.", ["One.", "Two."])).toEqual([0]);
    expect(paragraphs("One and\ntwo. Three.\nFour.", ["One and two.", "Three.", "Four."])).toEqual([0, 2]);
    expect(paragraphs("One.\nTwo.\nThree.", ["One.", "Changed.", "Three."])).toEqual([0, 2]);
    expect(paragraphs("\nOne.", ["One."])).toEqual([0]);
  });
});

describe("a slide's tree", () => {
  test("1 sentence: one node, the whole slide", () => {
    const t = build([said(1, ["Good morning."])]);
    expect(shape(t, 1)).toEqual(["slide 0-0"]);
    const root = t.nodes.get(t.roots.get(1) as string) as Node;
    expect(root).toMatchObject({ kind: "slide", top: true, kids: [], under: [], leaves: [root.id], height: 0, parent: null,
      words: 2, first: 0, last: 0 });
    expect(root.id).toBe(`s:1:0-0:${hash("Good morning.")}`);
    expect(t.talk).toBeNull();
  });

  test("2 sentences: each, then the slide", () => {
    const t = build([said(1, [short(1), short(2)])]);
    expect(shape(t, 1)).toEqual(["sentence 0-0", "sentence 1-1", "slide 0-1"]);
    const root = t.nodes.get(t.roots.get(1) as string) as Node;
    expect(root.kids.map((k) => t.nodes.get(k)?.text)).toEqual([short(1), short(2)]);
    expect(root.text).toBe(`${short(1)} ${short(2)}`);
    expect(t.nodes.get(root.kids[0])?.parent).toBe(root.id);
  });

  test("4 sentences: pairs, then the slide", () => {
    const t = build([said(1, [1, 2, 3, 4].map(short))]);
    expect(shape(t, 1)).toEqual(["sentence 0-0", "sentence 1-1", "group 0-1", "sentence 2-2", "sentence 3-3", "group 2-3", "slide 0-3"]);
  });

  test("9 sentences: 17 nodes, never more than twice the size of a part, learned in order", () => {
    const t = build([said(1, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(short))]);
    const nodes = shape(t, 1);
    expect(nodes).toHaveLength(17);
    expect(nodes.slice(0, 5)).toEqual(["sentence 0-0", "sentence 1-1", "group 0-1", "sentence 2-2", "group 0-2"]);
    expect(nodes.at(-1)).toBe("slide 0-8");
    for (const id of t.order) {
      const x = t.nodes.get(id) as Node;
      for (const k of x.kids) expect(x.leaves.length).toBeLessThanOrEqual(2 * (t.nodes.get(k) as Node).leaves.length + 1);
    }
    const root = t.nodes.get(t.roots.get(1) as string) as Node;
    expect(root.under).toHaveLength(16);
    expect(root.height).toBe(4);
  });

  test("12 sentences", () => {
    const t = build([said(1, Array.from({ length: 12 }, (_, k) => short(k + 1)))]);
    expect(shape(t, 1)).toHaveLength(23);
    expect((t.nodes.get(t.roots.get(1) as string) as Node).kids.map((k) => t.nodes.get(k)?.to)).toEqual([5, 11]);
  });

  test("a long sentence splits into clauses, which are leaves under it", () => {
    const long = "We looked at the data closely, and we found that most variants were rare; so we asked families.";
    const t = build([said(1, [short(1), long])]);
    expect(shape(t, 1)).toEqual(["sentence 0-0", "clause 1-1", "clause 2-2", "clauses 1-2", "clause 3-3", "sentence 1-3", "slide 0-3"]);
    const s = t.nodes.get(t.order[5]) as Node;
    expect(s).toMatchObject({ first: 1, last: 1, words: 18 });
    expect(s.leaves).toEqual([t.order[1], t.order[2], t.order[4]]);
    // a slide of one long sentence: its clauses under the slide
    expect(shape(build([said(2, [long])]), 2)).toEqual(["clause 0-0", "clause 1-1", "clauses 0-1", "clause 2-2", "slide 0-2"]);
  });

  test("paragraphs are the groups; within one, and over them, parts are paired", () => {
    const t = build([said(1, [1, 2, 3, 4, 5].map(short), [0, 3, 3, 9, -1])]);
    expect(shape(t, 1)).toEqual(["sentence 0-0", "sentence 1-1", "group 0-1", "sentence 2-2", "group 0-2",
      "sentence 3-3", "sentence 4-4", "group 3-4", "slide 0-4"]);
    expect(shape(build([said(1, [1, 2, 3, 4].map(short), [3, 1])]), 1)).toEqual(["sentence 0-0", "sentence 1-1", "sentence 2-2",
      "group 1-2", "group 0-2", "sentence 3-3", "slide 0-3"]);
  });

  test("an edited sentence gets new ids where it changed", () => {
    const a = build([said(1, [short(1), short(2)])]), b = build([said(1, [short(1), "Something else."])]);
    expect(b.order[0]).toBe(a.order[0]);
    expect(b.order[1]).not.toBe(a.order[1]);
    expect(b.order[2]).not.toBe(a.order[2]);
  });
});

describe("the talk's tree", () => {
  test("bridges between spoken slides, and one run-through of the talk for up to 7 slides", () => {
    const long = "We looked at the data closely, and we found that most variants were rare; so we asked families.";
    const t = build([said(1, [short(1), short(2)]), said(2, []), said(3, [long]), said(4, [short(4)])]);
    expect([...t.roots.keys()]).toEqual([1, 3, 4]);
    const bridges = t.order.map((id) => t.nodes.get(id) as Node).filter((x) => x.kind === "bridge");
    expect(bridges.map((b) => [b.slides, b.text])).toEqual([[[1, 3], `${short(2)} ${long}`], [[3, 4], `${long} ${short(4)}`]]);
    const [b1] = bridges;
    expect(b1.id).toMatch(/^b:1:/);
    expect(b1.kids).toEqual([t.roots.get(1), t.roots.get(3)]);
    expect(b1.leaves).toHaveLength(4);
    // its parts: the last sentence of slide 1, and slide 3 (one sentence) with its clauses
    expect(b1.under.map((id) => t.nodes.get(id)?.kind)).toEqual(["sentence", "slide", "clauses", "clause", "clause", "clause"]);
    expect(b1.parent).toBe("t");
    const talk = t.nodes.get("t") as Node;
    expect(talk).toMatchObject({ kind: "talk", slides: [1, 3, 4], top: true, under: [], leaves: [] });
    expect(talk.kids).toEqual([t.roots.get(1), t.roots.get(3), t.roots.get(4), ...bridges.map((b) => b.id)]);
    expect(t.talk).toBe("t");
    expect(t.order.at(-1)).toBe("t");
  });

  test("sections of 5 slides, a short remainder joined to the section before, and the talk over them", () => {
    const talk = (n: number) => build(Array.from({ length: n }, (_, k) => said(k + 1, [short(k + 1)])));
    const sections = (n: number) => { const t = talk(n); return (t.nodes.get("t") as Node).kids.filter((k) => k.startsWith("sec:")).map((k) => t.nodes.get(k)?.slides); };
    expect(sections(5)).toEqual([]);
    expect(sections(7)).toEqual([]);
    expect(sections(8)).toEqual([[1, 2, 3, 4, 5], [6, 7, 8]]);
    expect(sections(12)).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11, 12]]);
    const t = talk(10), sec = t.nodes.get("sec:1") as Node, top = t.nodes.get("t") as Node;
    // a section: its slides and the bridges inside it; the talk: the sections and the bridge between them
    expect(sec.kids.filter((k) => k.startsWith("b:"))).toHaveLength(4);
    expect(sec).toMatchObject({ kind: "section", parent: "t", top: true });
    expect(top.kids.filter((k) => k.startsWith("b:")).map((k) => t.nodes.get(k)?.slides)).toEqual([[5, 6]]);
    expect(top.words).toBe(40);
    expect(top.text.startsWith(short(1))).toBe(true);
  });
});
