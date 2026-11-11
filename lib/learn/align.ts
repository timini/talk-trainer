// Where the judge's problems fall in the text (docs/learning.md). The judge quotes the words a problem affected, but
// not always exactly: "foundation-model" for "foundation model", "nine" for 9, a word changed or added. So each quoted
// phrase is placed by alignment, not by an exact match: the span of the text, starting and ending at a matching word,
// that matches the most of the phrase's words in order (lib/grade.ts tokens, so case, punctuation and number words do
// not matter, and match, so learned is close to learn). It needs at least PLACE of the phrase's words; on a tie the
// earliest span wins, then the shortest. A span already taken by an earlier problem is not used again.
//
// The same placement marks the missed words on the card, charges each problem to the leaves it falls in, and
// adds to each word's trouble.

import { match, tokens } from "../grade";
import type { Problem } from "../judge";
import { score } from "../score";
import { HIT, PLACE, STUMBLE } from "./rules";

type Tok = { t: string; o: number[] };

// The tokens of the text that a phrase falls on, from and to (both included), or null when it is not found.
export const locate = (phrase: string, toks: Tok[], taken: Set<number> = new Set()): [number, number] | null => {
  const p = tokens(phrase).map((x) => x.t), m = p.length, n = toks.length;
  if (!m) return null;
  const same = (k: number, w: string) => !taken.has(k) && (toks[k].t === w || match(toks[k].t, w) !== null);
  let best: [number, number, number] | null = null;
  for (let i = 0; i < n; i += 1) {
    if (!p.some((w) => same(i, w))) continue;
    const span = Math.min(n - i, m + 2);
    // the longest common subsequence of the phrase and toks[i .. i + len), for each len
    let row = new Array<number>(span + 1).fill(0);
    for (let a = 1; a <= m; a += 1) {
      const next = [0];
      for (let len = 1; len <= span; len += 1) {
        next.push(same(i + len - 1, p[a - 1]) ? row[len - 1] + 1 : Math.max(row[len], next[len - 1]));
      }
      row = next;
    }
    for (let len = 1; len <= span; len += 1) {
      // a span ends at a word that matched
      if (row[len] === row[len - 1]) continue;
      if (!best || row[len] > best[2]) best = [i, i + len - 1, row[len]];
    }
  }
  return best && best[2] >= Math.ceil(PLACE * m) ? [best[0], best[1]] : null;
};

// Each problem placed on the words of the text (their places, from 0, in the text split at spaces), or null when it
// cannot be placed. An order problem is never placed.
export const place = (problems: Problem[], text: string): { problem: Problem; words: number[] | null }[] => {
  const toks = tokens(text), taken = new Set<number>();
  return problems.map((problem) => {
    const at = problem.kind === "order" ? null : locate(problem.script, toks, taken);
    if (!at) return { problem, words: null };
    const words = new Set<number>();
    for (let k = at[0]; k <= at[1]; k += 1) { taken.add(k); toks[k].o.forEach((w) => words.add(w)); }
    return { problem, words: [...words].sort((a, b) => a - b) };
  });
};

const COST = { left_out: 150, changed: 100 } as const;
// How much each problem adds to a word's trouble.
const TROUBLE = { left_out: HIT, changed: HIT, wrong_term: HIT, stumble: STUMBLE, order: 0 } as const;

// An attempt at the leaves with these texts: each leaf's score, each word's trouble added (per leaf, a number a
// word), and the words missed and the wrong terms (places in the whole text). A problem placed in a leaf costs it as
// in lib/score.ts: a left-out phrase 150 points times the share of the leaf's words it covers (at least 20), a changed
// one 100 times it, a wrong term 45, a stumble 20; an order problem costs every leaf 20, and a problem that cannot be
// placed costs every leaf what it would cost the whole.
export const placed = (problems: Problem[], texts: string[]) => {
  const counts = texts.map((t) => t.split(/\s+/).filter(Boolean).length), text = texts.join(" ");
  const leafOf: number[] = counts.flatMap((c, k) => new Array<number>(c).fill(k));
  const start = counts.map((_, k) => counts.slice(0, k).reduce((a, b) => a + b, 0));
  const cost = texts.map(() => 0), trouble = counts.map((c) => new Array<number>(c).fill(0));
  const missed = new Set<number>(), crit = new Set<number>();
  for (const { problem: p, words } of place(problems, text)) {
    if (!words) {
      const all = p.kind === "order" ? 20 : 100 - score([p], text);
      cost.forEach((_, k) => { cost[k] += all; });
      continue;
    }
    const hit = new Map<number, number>();
    for (const w of words) {
      const k = leafOf[w];
      hit.set(k, (hit.get(k) ?? 0) + 1);
      trouble[k][w - start[k]] += TROUBLE[p.kind];
      if (p.kind !== "stumble") missed.add(w);
      if (p.kind === "wrong_term") crit.add(w);
    }
    hit.forEach((n, k) => {
      const share = Math.min(1, n / counts[k]);
      cost[k] += p.kind === "left_out" || p.kind === "changed" ? Math.max(20, COST[p.kind] * share) : p.kind === "wrong_term" ? 45 : 20;
    });
  }
  return { scores: cost.map((c) => Math.max(0, Math.round(100 - c))), trouble, missed, crit };
};
