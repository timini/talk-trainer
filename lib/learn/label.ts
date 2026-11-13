// The words on the card about where a node is in the talk: its position ("Sentence 7, clause 2 of 2", "Sentences 5 to 8
// of 9", "Whole slide"), the path to it from the slide, and what the card asks for.

import type { Node, Tree } from "./tree";

type Short = { position: string; crumb: string };

// The sentences of the node's slide, and the clauses of one sentence.
const sentencesOf = (tree: Tree, node: Node) => (tree.nodes.get(tree.roots.get(node.slides[0]) as string) as Node).last + 1;
const clausesOf = (tree: Tree, node: Node, k: number) => {
  const root = tree.nodes.get(tree.roots.get(node.slides[0]) as string) as Node;
  return root.leaves.map((l) => tree.nodes.get(l) as Node).filter((l) => l.first === k);
};

const words = (tree: Tree, node: Node): Short => {
  const n = sentencesOf(tree, node), s = node.first + 1;
  switch (node.kind) {
    case "clause":
    case "clauses": {
      const all = clausesOf(tree, node, node.first), a = all.findIndex((l) => l.from === node.from) + 1;
      const b = all.findIndex((l) => l.to === node.to) + 1;
      const span = a === b ? `clause ${a}` : `clauses ${a} to ${b}`;
      return { position: `Sentence ${s}, ${span} of ${all.length}`, crumb: `Sentence ${s}, ${span}` };
    }
    case "sentence":
      return { position: `Sentence ${s} of ${n}`, crumb: `Sentence ${s}` };
    case "group":
      return { position: `Sentences ${s} to ${node.last + 1} of ${n}`, crumb: `Sentences ${s} to ${node.last + 1}` };
    case "slide":
      return { position: n === 1 ? "Whole slide: 1 sentence" : `Whole slide: all ${n} sentences`, crumb: `Slide ${node.slides[0]}` };
    case "bridge":
      return { position: `From slide ${node.slides[0]} into slide ${node.slides[1]}`, crumb: "" };
    case "section":
      return { position: `Run-through: ${node.name ? `${node.name}, ` : ""}slides ${node.slides[0]} to ${node.slides.at(-1)}`, crumb: "" };
    default:
      return { position: "Run-through: the whole talk", crumb: "" };
  }
};

export const position = (tree: Tree, node: Node) => words(tree, node).position;

// The path from the slide down to the node, for a node inside a slide: "Slide 3 > Sentences 5 to 8 > Sentence 7".
export const crumbs = (tree: Tree, node: Node): string[] => {
  if (node.kind === "bridge" || node.kind === "section" || node.kind === "talk") return [];
  const out: string[] = [];
  for (let x: Node | undefined = node; x && x.kind !== "talk" && x.kind !== "section"; x = tree.nodes.get(x.parent ?? "")) {
    out.unshift(words(tree, x).crumb);
  }
  return out;
};

// The talk's sections, for choosing what to practise: the deck's own (consecutive slides with the same name; a slide
// with none stays in the section before), or else the run-through groups of the tree, named by their slides.
export const sections = (slides: { n: number; section?: string | null }[], tree: Tree) => {
  const out: { name: string; from: number; to: number }[] = [];
  if (slides.some((s) => s.section)) {
    slides.forEach((s, k) => {
      if (k === 0 || (s.section && s.section !== out[out.length - 1].name)) out.push({ name: s.section ?? "", from: s.n, to: s.n });
      out[out.length - 1].to = s.n;
    });
    return out.map((x) => ({ ...x, name: x.name || `Slides ${x.from} to ${x.to}` }));
  }
  return tree.order.filter((id) => id.startsWith("sec:")).map((id) => tree.nodes.get(id) as Node)
    .map((x) => ({ name: `Slides ${x.slides[0]} to ${x.slides.at(-1)}`, from: x.slides[0], to: x.slides.at(-1) as number }));
};

// What the card asks for, by the share hidden.
export const instruction = (share: number, run = false) => (run && share === 0 ? "Read each slide aloud, then tap Next slide."
  : run && share < 1 ? `Say each slide, filling in the blanks (${Math.round(share * 100)}% hidden), then tap Next slide.`
  : run ? "From memory: say each slide, then tap Next slide."
  : share === 0 ? "Read it aloud."
  : share >= 1 ? "From memory: say it from the slide."
  : `Say it, filling in the blanks (${Math.round(share * 100)}% hidden).`);
