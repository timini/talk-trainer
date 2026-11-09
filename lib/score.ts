// A score out of 100 for an attempt, from the judge's problems, so one small slip in a long passage is not a miss.
// Got it (85 or more) only with no problem at all. Any one slip (a restart, a phrase left out or changed, the order)
// costs at least 20, so it is Nearly (60 to 84): it counts, and the phrases come back hidden. A left-out phrase costs
// 150 points times the share of the words it covers (a quarter or more left out is Missed), a changed one 100, and a wrong number, name or term costs 45, so
// it is Missed (under 60), as are several slips together. Set from Tim's attempts on 9 November: a 300 character
// slide with one restart is Nearly; a sentence left out of a short slide, or a wrong number, is Missed.
import { normalise } from "./grade";
import type { Problem, Verdict } from "./judge";

export const GOOD = 85;
export const NEARLY = 60;
export type Band = "good" | "nearly" | "missed";

const words = (text: string | undefined) => normalise(text ?? "").length;

// A "wrong" number that was the same number said in words (three for 3) is not a problem.
export const real = (problems: Problem[]) => problems.filter((p) => !(p.kind === "wrong_term" && p.said
  && normalise(p.script).join(" ") === normalise(p.said).join(" ")));

export const score = (problems: Problem[], target: string): number => {
  const n = Math.max(1, words(target));
  const cost = problems.reduce((sum, p) => {
    const share = Math.min(1, words(p.script) / n);
    return sum + { left_out: Math.max(20, 150 * share), changed: Math.max(20, 100 * share), wrong_term: 45, order: 20,
      stumble: 20 }[p.kind];
  }, 0);
  return Math.max(0, Math.round(100 - cost));
};

export const band = (s: number): Band => (s >= GOOD ? "good" : s >= NEARLY ? "nearly" : "missed");

// Whether the judge heard almost nothing: a tap too soon or a microphone problem, not forgetting. Fluency and
// clarity both 1, a transcript under a fifth of the target's words, or more than 80% of the words left out.
export const empty = (v: Verdict, target: string): boolean => {
  const n = Math.max(1, words(target));
  if (v.fluency === 1 && v.clarity === 1) return true;
  if (words(v.heard) < 0.2 * n) return true;
  const left = (v.problems ?? []).filter((p) => p.kind === "left_out").reduce((a, p) => a + words(p.script), 0);
  return left > 0.8 * n;
};
