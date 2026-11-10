// Tim's budget (10 November): about 10 hours of practice from Tuesday 10 to Friday 13 November, the talk on Saturday
// 14 November, run against the simulated learner on the shape of his talk (tim.json: the words of each sentence of
// each of its 81 slides, and the section each slide is in; not its text). His four sessions so far are replayed as he
// had them (HISTORY), then the hours left (LEFT): blocks of 45 minutes with 15 minute breaks, in the evening, with the
// nights between. An attempt takes 24 s plus 0.4 s a word, with the verdict and the pause before the next (he ran at
// about 90 an hour); a run-through, that for each slide.

import { readFileSync } from "node:fs";
import { run } from "@/lib/learn/attempt";
import { hiding, record, type State } from "@/lib/learn/model";
import type { Aim } from "@/lib/learn/rules";
import { after, begin, pick, standing } from "@/lib/learn/scheduler";
import { build, type Input, type Node } from "@/lib/learn/tree";
import { type Fit, Learner, rng } from "./learner";

const MIN = 60000, HOUR = 60 * MIN;
const shape = JSON.parse(readFileSync(new URL("./tim.json", import.meta.url), "utf8")) as
  { sentences: number[][]; sections: string[] };
const WORDS = "the data shows that most of our variants are rare and hard to read without more evidence from families".split(" ");

// The talk: each sentence its own number of words, with a comma every 6.
export const talk = (): Input[] => shape.sentences.map((lens, k) => ({
  n: k + 1, section: shape.sections[k],
  sentences: lens.map((len, i) => ({
    text: Array.from({ length: len }, (_, j) => `${WORDS[(j * 7 + i * 3 + k) % WORDS.length]}${j > 0 && j % 6 === 5 ? "," : ""}`)
      .join(" ").replace(/^\w/, (c) => `${c.toUpperCase()}${k}x${i}`) + ".",
  })),
}));

const at = (day: number, hour: number, min = 0) => Date.UTC(2026, 10, day, hour, min);
export type Sessions = [start: number, minutes: number][];
// His sessions with /learn so far (UTC, London in November).
export const HISTORY: Sessions = [[at(9, 21, 29), 11], [at(10, 8, 13), 30], [at(10, 10, 9), 54], [at(10, 11, 55), 11]];
// The hours left, each day from 17:00: Tuesday 1.25 h, Wednesday 3 h, Thursday 2.5 h, Friday 1.5 h.
const blocks = (day: number, hours: number): Sessions => {
  const out: Sessions = [];
  for (let t = at(day, 17), left = hours * 60; left > 0; t += HOUR, left -= 45) out.push([t, Math.min(45, left)]);
  return out;
};
export const LEFT: Sessions = [...blocks(10, 1.25), ...blocks(11, 3), ...blocks(12, 2.5), ...blocks(13, 1.5)];

type Tally = Record<string, [number, number]>;
export type Budget = { attempts: number; blocks: number[]; slides: number; started: number; saturday: number; known: number;
  // over HISTORY alone, to compare with the log: the pass rates by kind, by words and of first attempts, the pass
  // rate after more than 3 hours, and the slides started and at the bar at its end
  history: { attempts: number; started: number; slides: number; byKind: Record<string, number>; byWords: Record<string, number>;
    first: number; night: number } };

export const budget = (aim: Aim, seed: number, fit: Fit, sessions: Sessions = [...HISTORY, ...LEFT]): Budget => {
  const slides = talk(), tree = build(slides), rand = rng(seed * 7 + 1), learner = new Learner(rand, fit);
  const states = new Map<string, State>();
  const get = (id: string) => states.get(id) ?? null;
  const roots = [...tree.roots.values()];
  const startedNow = () => roots.filter((id) => (tree.nodes.get(id) as Node).leaves.some((l) => get(l)) || get(id)).length;
  const mean = (n: Node, s: Map<string, number>) => {
    const ws = n.leaves.map((l) => (tree.nodes.get(l) as Node).words);
    return n.leaves.reduce((a, l, k) => a + (s.get(l) as number) * ws[k], 0) / ws.reduce((a, b) => a + b, 0);
  };
  const byKind: Tally = {}, byWords: Tally = {}, first: Tally = {}, night: Tally = {};
  const tally = (t: Tally, k: string, pass: boolean) => {
    t[k] ??= [0, 0];
    t[k][0] += pass ? 1 : 0;
    t[k][1] += 1;
  };
  const rate = (t: Tally) => Object.fromEntries(Object.entries(t).map(([k, [p, n]]) => [k, p / n]));
  const bucket = (w: number) => (w < 15 ? "<15" : w < 30 ? "15-30" : w < 60 ? "30-60" : "60+");
  let attempts = 0, now = 0;
  const blocksPassed: number[] = [];
  let history: Budget["history"] | null = null;
  sessions.forEach(([start, minutes], i) => {
    now = start;
    const end = start + minutes * MIN, past = i < HISTORY.length && sessions[i] === HISTORY[i];
    let session = begin(), passes = 0, n = 0;
    while (now < end) {
      const p = pick(tree, get, now, aim, Infinity, session);
      if (!p) break;
      const { est, rate: pace } = standing(tree, get, now, aim, session), node = p.node, before = get(node.id);
      let points: number;
      if (node.kind === "section" || node.kind === "talk") {
        const said = new Map<number, { points: number; leaves: Map<string, number> }>();
        for (const k of node.slides) {
          const root = tree.nodes.get(tree.roots.get(k) as string) as Node;
          const leaves = learner.say(tree, root.leaves, new Map(root.leaves.map((l) => [l, 1])), now);
          said.set(k, { points: mean(root, leaves), leaves });
          now += (24 + 0.4 * root.words) * 1000;
          attempts += 1;
        }
        run(tree, get, node, said, now, est).forEach((v, k) => states.set(k, v));
        points = [...said.values()].reduce((a, x) => a + x.points, 0) / said.size;
      } else {
        const hide = hiding(tree, node, est, aim, pace);
        const leaves = learner.say(tree, node.leaves, hide, now);
        points = Math.round(mean(node, leaves));
        now += (24 + 0.4 * node.words) * 1000;
        attempts += 1;
        record(tree, get, node, leaves, points, now, hide, est).forEach((v, k) => states.set(k, v));
      }
      const pass = points >= 60;
      if (past) {
        tally(byKind, node.kind, pass);
        tally(byWords, bucket(node.words), pass);
        tally(first, before ? "seen" : "first", pass);
        if (before && now - before.at > 3 * HOUR) tally(night, "night", pass);
      }
      session = after(session, p, pass);
      n += 1;
      passes += pass ? 1 : 0;
    }
    if (n) blocksPassed.push(passes / n);
    if (past && i === HISTORY.length - 1) {
      const s = standing(tree, get, now, aim);
      history = { attempts, started: startedNow(), slides: roots.filter((id) => s.at(id)).length, byKind: rate(byKind),
        byWords: rate(byWords), first: rate(first).first ?? NaN, night: rate(night).night ?? NaN };
    }
  });
  // Friday night: where it stands
  const s = standing(tree, get, now + 30 * MIN, aim);
  const done = roots.filter((id) => s.at(id));
  // Saturday 09:00: each slide said from memory, nothing shown, 40 times without practising: passed at 60 or more;
  // the talk's score is the mean over its slides by their words (a slide never started counts 0)
  const saturday = at(14, 9), words = roots.map((id) => (tree.nodes.get(id) as Node).words);
  const sat = roots.map((id) => {
    const root = tree.nodes.get(id) as Node, all = new Map(root.leaves.map((l) => [l, 1]));
    let ok = 0;
    for (let k = 0; k < 40; k += 1) if (mean(root, learner.say(tree, root.leaves, all, saturday, false)) >= 60) ok += 1;
    return ok / 40;
  });
  return {
    attempts, blocks: blocksPassed, slides: done.length, started: startedNow(),
    saturday: sat.reduce((a, v, k) => a + v * words[k], 0) / words.reduce((a, b) => a + b, 0),
    known: done.length ? done.reduce((a, id) => a + sat[roots.indexOf(id)], 0) / done.length : 0,
    history: history ?? { attempts: 0, started: 0, slides: 0, byKind: {}, byWords: {}, first: NaN, night: NaN },
  };
};
