// Tim's budget (10 November): about 10 hours of practice from Tuesday 10 to Friday 13 November, the talk on Saturday
// 14 November, run against the simulated learner on the shape of his talk (tim.json: the sentences and words of each
// of its 86 slides and the section each is in; not its text). Practice is in blocks of 45 minutes with 15 minute
// breaks, in the evening, with the nights between. An attempt takes 24 s plus 0.4 s a word, with the verdict and the pause before the next (his median gap was 19 s, but
// sustained sessions ran 95 to 110 an hour); a run-through, that for each slide.

import { readFileSync } from "node:fs";
import { run } from "@/lib/learn/attempt";
import { hiding, record, type State } from "@/lib/learn/model";
import type { Aim } from "@/lib/learn/rules";
import { after, begin, pick, standing } from "@/lib/learn/scheduler";
import { build, type Input, type Node } from "@/lib/learn/tree";
import { type Fit, Learner, rng } from "./learner";

const MIN = 60000, HOUR = 60 * MIN;
const shape = JSON.parse(readFileSync(new URL("./tim.json", import.meta.url), "utf8")) as
  { sentences: number[]; words: number[]; sections: string[] };
const WORDS = "the data shows that most of our variants are rare and hard to read without more evidence from families".split(" ");

// The talk: each slide's words shared out over its sentences, a little uneven.
export const talk = (seed: number): Input[] => {
  const rand = rng(seed);
  return shape.sentences.map((n, k) => {
    const weights = Array.from({ length: n }, () => 0.6 + 0.8 * rand()), all = weights.reduce((a, b) => a + b, 0);
    return {
      n: k + 1, section: shape.sections[k],
      sentences: weights.map((w, i) => {
        const len = Math.max(3, Math.round((shape.words[k] * w) / all));
        return { text: Array.from({ length: len }, (_, j) => `${WORDS[(j * 7 + i * 3 + k) % WORDS.length]}${j > 0 && j % 6 === 5 ? "," : ""}`)
          .join(" ").replace(/^\w/, (c) => `${c.toUpperCase()}${k}x${i}`) + "." };
      }),
    };
  });
};

// The days: Tuesday 3 h, Wednesday 3 h, Thursday 2.5 h, Friday 1.5 h, each from 17:00 (UTC, London in November).
export const DAYS = [{ day: 10, hours: 3 }, { day: 11, hours: 3 }, { day: 12, hours: 2.5 }, { day: 13, hours: 1.5 }];
const at = (day: number, hour: number) => Date.UTC(2026, 10, day, hour);
const secs = (n: Node) => 24 + 0.4 * n.words;

export type Budget = { attempts: number; blocks: number[]; slides: number; bridges: number; sections: number;
  started: number; words: number; saturday: number; known: number; why: Record<string, number>; byWords: Record<string, [number, number]>; byKind: Record<string, [number, number]> };

export const budget = (aim: Aim, seed: number, fit: Fit, days = DAYS): Budget => {
  const slides = talk(seed), tree = build(slides), rand = rng(seed * 7 + 1), learner = new Learner(rand, fit);
  const states = new Map<string, State>();
  const get = (id: string) => states.get(id) ?? null;
  let attempts = 0;
  const why: Record<string, number> = {};
  const blocks: number[] = [], byWords: Budget["byWords"] = {}, byKind: Budget["byKind"] = {};
  const tally = (t: Record<string, [number, number]>, k: string, pass: boolean) => {
    t[k] ??= [0, 0];
    t[k][0] += pass ? 1 : 0;
    t[k][1] += 1;
  };
  const bucket = (w: number) => (w < 15 ? "<15" : w < 30 ? "15-30" : w < 60 ? "30-60" : "60+");
  const mean = (n: Node, s: Map<string, number>) => {
    const ws = n.leaves.map((l) => (tree.nodes.get(l) as Node).words);
    return n.leaves.reduce((a, l, k) => a + (s.get(l) as number) * ws[k], 0) / ws.reduce((a, b) => a + b, 0);
  };
  for (const { day, hours } of days) {
    let now = at(day, 17), left = hours * HOUR;
    while (left > 0) {
      const end = now + Math.min(45 * MIN, left);
      left -= Math.min(45 * MIN, left);
      let session = begin(), passes = 0, n = 0;
      while (now < end) {
        const p = pick(tree, get, now, aim, Infinity, session);
        if (!p) break;
        const { est, rate } = standing(tree, get, now, aim, session), node = p.node;
        why[`${p.why} ${node.kind}`] = (why[`${p.why} ${node.kind}`] ?? 0) + 1;
        let points: number;
        if (node.kind === "section" || node.kind === "talk") {
          const said = new Map<number, { points: number; leaves: Map<string, number> }>();
          for (const k of node.slides) {
            const root = tree.nodes.get(tree.roots.get(k) as string) as Node;
            const leaves = learner.say(tree, root.leaves, new Map(root.leaves.map((l) => [l, 1])), now);
            said.set(k, { points: mean(root, leaves), leaves });
            now += secs(root) * 1000;
            attempts += 1;
          }
          run(tree, get, node, said, now, est).forEach((v, k) => states.set(k, v));
          points = [...said.values()].reduce((a, x) => a + x.points, 0) / said.size;
        } else {
          const hide = hiding(tree, node, est, aim, rate);
          const leaves = learner.say(tree, node.leaves, hide, now);
          points = Math.round(mean(node, leaves));
          now += secs(node) * 1000;
          attempts += 1;
          record(tree, get, node, leaves, points, now, hide, est).forEach((v, k) => states.set(k, v));
          if (day === DAYS[0].day) { tally(byWords, bucket(node.words), points >= 60); tally(byKind, node.kind, points >= 60); }
        }
        session = after(session, p, points >= 60);
        n += 1;
        passes += points >= 60 ? 1 : 0;
      }
      if (n) blocks.push(passes / n);
      now = end + 15 * MIN;
    }
  }
  // Friday night: where it stands
  const end = at(DAYS.at(-1)!.day, 23), s = standing(tree, get, end, aim);
  const kinds = (k: string) => tree.order.filter((id) => tree.nodes.get(id)!.kind === k);
  const roots = [...tree.roots.values()];
  const done = roots.filter((id) => s.at(id));
  // Saturday 09:00: each slide said from memory, nothing shown, 40 times without practising: passed at 60 or more
  const saturday = at(14, 9);
  const sat = roots.map((id) => {
    const root = tree.nodes.get(id) as Node, all = new Map(root.leaves.map((l) => [l, 1]));
    let ok = 0;
    for (let k = 0; k < 40; k += 1) if (mean(root, learner.say(tree, root.leaves, all, saturday, false)) >= 60) ok += 1;
    return ok / 40;
  });
  const started = new Set<number>();
  for (const id of tree.order) if (get(id)) tree.nodes.get(id)!.slides.forEach((k) => started.add(k));
  return {
    attempts, blocks, slides: done.length, bridges: kinds("bridge").filter((id) => s.at(id)).length,
    sections: kinds("section").filter((id) => s.at(id)).length, started: started.size,
    words: done.reduce((a, id) => a + tree.nodes.get(id)!.words, 0) / roots.reduce((a, id) => a + tree.nodes.get(id)!.words, 0),
    saturday: sat.reduce((a, b) => a + b, 0) / sat.length, byWords, byKind, why,
    known: done.length ? done.reduce((a, id) => a + sat[roots.indexOf(id)], 0) / done.length : 0,
  };
};
