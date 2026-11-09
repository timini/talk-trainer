// The talk as a tree, the thing Tim learns by (docs/learning.md). The leaves are clauses: a sentence of more than SPLIT
// words splits at a comma, semicolon, colon or dash into clauses of at least CLAUSE words. Above them are the sentences,
// then groups of sentences, then the whole slide. Groups are the paragraphs of the speaker notes, where there are
// several; within a paragraph, and with no paragraphs, the parts are paired into a balanced binary tree, so a node is
// never much more than twice the size of its children. Above the slides: a bridge between each pair of spoken slides
// (the last sentence of one and the first of the next), sections of about SECTION slides, and the whole talk.
//
// Node ids: s:<slide>:<from>-<to>:<hash> for a span of a slide's leaves (from and to count from 0, both included),
// b:<slide>:<hash> for the bridge from a slide to the next, sec:<i> and t. The hash is of the node's text, so an
// edited slide starts again where it changed.

import { CLAUSE, SECTION, SPLIT } from "./rules";

export type Kind = "clause" | "clauses" | "sentence" | "group" | "slide" | "bridge" | "section" | "talk";
export type Input = { n: number; title?: string; sentences: { text: string; must_say?: string[] }[]; paras?: number[] };

export type Node = {
  id: string;
  kind: Kind;
  // the slides it covers, in order; a slide's own nodes cover one
  slides: number[];
  // a span of a slide: its leaves, from and to (both included); the sentences it touches (from 0)
  from: number;
  to: number;
  first: number;
  last: number;
  text: string;
  words: number;
  // what has to be at its bar before this is tried (the parts it is made of), and where a miss zooms down to (the
  // same, but for a bridge its two sentences)
  kids: string[];
  down: string[];
  // its parent within the slide, for the breadcrumb; a section or the talk for a slide or bridge
  parent: string | null;
  // every node an attempt at this one also scores (its parts, and theirs), and its leaves
  under: string[];
  leaves: string[];
  // 0 for a leaf, one more than its tallest part
  height: number;
  // a slide, a section or the talk: the higher bar
  top: boolean;
};
export type Tree = { nodes: Map<string, Node>; order: string[]; roots: Map<number, string>; talk: string | null };

// A short hash of a text (FNV-1a), in base 36.
export const hash = (text: string) =>
  ([...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) >>> 0).toString(36);

const count = (text: string) => text.split(/\s+/).filter(Boolean).length;

// A sentence's clauses: cut after a word ending in a comma, semicolon, colon or dash (or a dash on its own), when the
// piece before and the rest are each at least CLAUSE words. A sentence of SPLIT words or fewer is one clause.
export const clauses = (sentence: string): string[] => {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length <= SPLIT) return [words.join(" ")];
  const out: string[] = [];
  let from = 0;
  words.forEach((w, i) => {
    const cut = /[,;:\-\u2013\u2014]$/.test(w);
    if (cut && i + 1 - from >= CLAUSE && words.length - (i + 1) >= CLAUSE) {
      out.push(words.slice(from, i + 1).join(" "));
      from = i + 1;
    }
  });
  out.push(words.slice(from).join(" "));
  return out;
};

// The sentences that start a paragraph of the notes (from 0; always 0): those with a paragraph break between the end of
// the sentence before and their start. The sentences were split from the notes with the breaks as spaces, so each is
// found there in order; one that is not found starts no paragraph.
export const paragraphs = (notes: string, sentences: string[]): number[] => {
  const flat = notes.replace(/\n/g, " ");
  const out = [0];
  let at = 0;
  sentences.forEach((s, k) => {
    const i = flat.indexOf(s, at);
    if (i < 0) return;
    if (k > 0 && notes.slice(at, i).includes("\n")) out.push(k);
    at = i + s.length;
  });
  return out;
};

type Span = { from: number; to: number; first: number; last: number; id: string };

// A slide's nodes, leaves first, then each node after its parts.
const slideNodes = (slide: Input, nodes: Map<string, Node>, order: string[]): string | null => {
  const sentences = slide.sentences.map((s) => clauses(s.text));
  const leaves: { text: string; sentence: number }[] = sentences.flatMap((cs, k) => cs.map((text) => ({ text, sentence: k })));
  if (!leaves.length) return null;
  const n = slide.n, end = leaves.length - 1, lastSentence = sentences.length - 1;
  const starts = sentences.map((_, k) => leaves.findIndex((l) => l.sentence === k));
  const kindOf = (from: number, to: number): Kind => {
    if (from === 0 && to === end) return "slide";
    const a = leaves[from].sentence, b = leaves[to].sentence;
    if (a !== b) return "group";
    const whole = starts[a] === from && (a === lastSentence ? end : starts[a + 1] - 1) === to;
    return whole ? "sentence" : from === to ? "clause" : "clauses";
  };
  const make = (from: number, to: number, kids: Span[]): Span => {
    const text = leaves.slice(from, to + 1).map((l) => l.text).join(" ");
    const id = `s:${n}:${from}-${to}:${hash(text)}`;
    const under = kids.flatMap((k) => [k.id, ...(nodes.get(k.id) as Node).under]);
    const leafIds = kids.length ? kids.flatMap((k) => (nodes.get(k.id) as Node).leaves) : [id];
    const kind = kindOf(from, to);
    nodes.set(id, { id, kind, slides: [n], from, to, first: leaves[from].sentence, last: leaves[to].sentence, text,
      words: count(text), kids: kids.map((k) => k.id), down: kids.map((k) => k.id), parent: null, under, leaves: leafIds,
      height: kids.length ? 1 + Math.max(...kids.map((k) => (nodes.get(k.id) as Node).height)) : 0, top: kind === "slide" });
    kids.forEach((k) => { (nodes.get(k.id) as Node).parent = id; });
    order.push(id);
    return { from, to, first: leaves[from].sentence, last: leaves[to].sentence, id };
  };
  // a balanced binary tree over a list of parts, each made before the node over it
  const pair = (parts: (() => Span)[]): Span => {
    if (parts.length === 1) return parts[0]();
    const mid = Math.ceil(parts.length / 2);
    const left = pair(parts.slice(0, mid)), right = pair(parts.slice(mid));
    return make(left.from, right.to, [left, right]);
  };
  const sentence = (k: number) => () => pair(sentences[k].map((_, c) => () => make(starts[k] + c, starts[k] + c, [])));
  const paras = [...new Set((slide.paras ?? [0]).filter((p) => p > 0 && p <= lastSentence))].sort((a, b) => a - b);
  const bounds = [0, ...paras, sentences.length];
  const groups = bounds.slice(0, -1).map((b, g) => () => pair(sentences.slice(b, bounds[g + 1]).map((_, k) => sentence(b + k))));
  return pair(groups).id;
};

// The whole talk's tree. Slides with no script are left out of the bridges, sections and talk.
export const build = (slides: Input[]): Tree => {
  const nodes = new Map<string, Node>(), order: string[] = [], roots = new Map<number, string>();
  const spoken: Input[] = [];
  for (const s of slides) {
    const root = slideNodes(s, nodes, order);
    if (root) { roots.set(s.n, root); spoken.push(s); }
  }
  const node = (id: string) => nodes.get(id) as Node;
  const bridges: Node[] = [];
  spoken.slice(1).forEach((s, k) => {
    const prev = spoken[k], a = node(roots.get(prev.n) as string), b = node(roots.get(s.n) as string);
    // the last sentence of one slide and the first of the next: the nodes over just those sentences
    const end = [...a.under, a.id].map(node).find((x) => x.first === x.last && x.last === a.last && (x.kind === "sentence" || x.kind === "slide")) as Node;
    const start = [...b.under, b.id].map(node).find((x) => x.first === x.last && x.first === 0 && (x.kind === "sentence" || x.kind === "slide")) as Node;
    const text = `${end.text} ${start.text}`, id = `b:${prev.n}:${hash(text)}`;
    const bridge: Node = { id, kind: "bridge", slides: [prev.n, s.n], from: 0, to: 0, first: 0, last: 0, text, words: count(text),
      kids: [a.id, b.id], down: [end.id, start.id], parent: null, under: [end.id, ...end.under, start.id, ...start.under], leaves: [...end.leaves, ...start.leaves],
      height: Math.max(a.height, b.height) + 1, top: false };
    nodes.set(id, bridge);
    order.push(id);
    bridges.push(bridge);
  });
  // a run-through over some slides: their roots and the bridges between them
  const run = (id: string, kind: Kind, slideNs: number[], kids: string[]) => {
    const text = slideNs.map((n) => node(roots.get(n) as string).text).join(" ");
    const r: Node = { id, kind, slides: slideNs, from: 0, to: 0, first: 0, last: 0, text, words: count(text), kids, down: kids, parent: null,
      under: [], leaves: [], height: 1 + Math.max(...kids.map((k) => node(k).height)), top: true };
    nodes.set(id, r);
    order.push(id);
    kids.forEach((k) => { node(k).parent = id; });
    return r;
  };
  const within = (ns: number[]) => [...ns.map((n) => roots.get(n) as string),
    ...bridges.filter((b) => ns.includes(b.slides[0]) && ns.includes(b.slides[1])).map((b) => b.id)];
  let talk: string | null = null;
  if (spoken.length > 1) {
    // sections of SECTION slides; a remainder of fewer than 3 joins the section before
    const groups: number[][] = [];
    for (let k = 0; k < spoken.length; k += SECTION) groups.push(spoken.slice(k, k + SECTION).map((s) => s.n));
    if (groups.length > 1 && groups[groups.length - 1].length < 3) groups[groups.length - 2].push(...(groups.pop() as number[]));
    const all = spoken.map((s) => s.n);
    if (groups.length === 1) run("t", "talk", all, within(all));
    else {
      const secs = groups.map((g, i) => run(`sec:${i + 1}`, "section", g, within(g)));
      const between = bridges.filter((b) => !secs.some((sec) => sec.kids.includes(b.id)));
      run("t", "talk", all, [...secs.map((s) => s.id), ...between.map((b) => b.id)]);
    }
    talk = "t";
  }
  return { nodes, order, roots, talk };
};
