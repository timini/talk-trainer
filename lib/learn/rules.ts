// Every threshold of the learning engine, in one place. docs/learning.md says what each is for, the learning theory
// behind it and the data it rests on (226 of Tim's attempts on 9 November). The simulation (tests/sim/sim.test.ts)
// checks them; where it chose a value, the run is noted against it.

import { GOOD, NEARLY } from "../score";

const MIN = 60 * 1000;

// The tree. A sentence of more than SPLIT words splits at a comma, semicolon, colon or dash into clauses of at least
// CLAUSE words. With no section titles, sections are groups of SECTION slides.
export const SPLIT = 12;
export const CLAUSE = 4;
export const SECTION = 5;

// The score: an exponentially weighted moving average, each attempt moving it ALPHA of the way to that attempt's
// score, so the last 3 attempts carry about 88% of the weight. An attempt at a node moves each part under it only
// UNDER of the way to that part's own score: where the judge's problems fall is a guess, so it is weaker evidence.
// Simulation: UNDER 0.25 against 0.5 took 63 attempts to learn a slide of 4 sentences word for word instead of 73.
export const ALPHA = 0.5;
export const UNDER = 0.25;
// A confident pass (GOOD or more, with at least SURE of its words hidden) moves the node attempted ALPHA_GOOD of the
// way instead, so a part said well is not asked again and again (10 November: slide 2 took 24 attempts, 23 of them
// passes). Simulation (tests/sim/budget.test.ts, the learner fitted to Tim's first sessions): with GROW 4 and FIRST 20
// minutes below, an expected Saturday score over the whole talk of 0.53 instead of 0.39, 37 slides at the gist bar
// instead of 21 and 45 started instead of 33, at the same pass rate.
export const ALPHA_GOOD = 0.9;
export const SURE = 0.45;
// A node is known at least as well as the mean of its parts times JOIN: joining parts is harder than the parts (9
// November: in 34 of 55 missed multi-sentence attempts every sentence was at 0.6 or more). A node still has to be
// tried once before it counts as at its bar. Simulation: JOIN 0.9 took 52 attempts for 4 sentences and 166 for 9;
// 0.85, 64 and 317; 0.75, 65 and 331.
export const JOIN = 0.9;

// Spacing. A node's interval starts at FIRST, grows GROW times after a pass that came at least one interval after the
// last pass, and goes back to FIRST after a miss. A node is trusted for its interval; after it the score fades as
// (1 + t / interval) ^ -FADE, t the time past the interval: a power law, the shape of forgetting curves. A node is due
// once it has faded below its bar. Simulation: halving every interval instead wiped a day's work overnight (a node
// with a 10 minute interval was at 0 after 3 hours), so every session started again from reading aloud. FIRST 20
// minutes and GROW 4 (from 10 and 2.5): Tim passed 86% after a night (10 November), so a pass can be trusted longer;
// a miss still goes back to FIRST.
export const FIRST = 20 * MIN;
export const GROW = 4;
export const FADE = 0.3;

// An attempt's score out of 100 (lib/score.ts): GOOD (85) or more is got; NEARLY (60) to 84 counts as a pass for the
// interval but moves the score by its true value; below 60 is a miss.
export { GOOD, NEARLY };
// "Count it as got" or "Count it as missed", and marking yourself, score the attempt one of these.
export const RECOUNT = { got: 85, missed: 50 };
// An attempt is not counted as heard only with no words, or with a fluency and clarity of 1 and fewer than EMPTY words.
export const EMPTY = 3;
// "I know this one": the node and its parts to this score.
export const KNOWN = 0.9;

// Hiding. Each leaf hides (s - HIDE_FROM) / HIDE_SPAN of its words, in steps of HIDE_STEP: nothing below 0.2,
// everything from 0.9. The gist never hides more than GIST_HIDE. Terms (names, numbers, acronyms) are in full below
// TERM_HINT, then their first letter below TERM_HIDE, then hidden like any word. The first CUE words of a node and of
// each of its parts stay shown until the node has been passed once: the join cues.
export const HIDE_FROM = 0.2;
export const HIDE_SPAN = 0.7;
export const HIDE_STEP = 0.05;
export const GIST_HIDE = 0.5;
export const TERM_HINT = 0.5;
export const TERM_HIDE = 0.8;
export const CUE = 3;

// The bars: the score at which a node counts as known, by aim. top: a slide, a section or the whole talk; node:
// everything else. Word for word, a slide is said with every word hidden, and is at its bar only after such an
// attempt. Simulation: the word for word node bar 0.75 took 52 attempts for 4 sentences and 166 for 9; 0.8, 64 and
// 317, with the same pass rate. The gist node bar 0.5 (from 0.6) took 14 attempts for 4 sentences and 30 for 9,
// against 19 and 38, with the slide still at 0.8; see GIST_CLAUSES.
export type Aim = "familiar" | "gist" | "verbatim";
export const BARS: Record<Aim, { node: number; top: number }> = {
  verbatim: { node: 0.75, top: 0.85 },
  gist: { node: 0.5, top: 0.8 },
  familiar: { node: 0.4, top: 0.6 },
};

// Get familiar (Tim, 11 November): breadth first over the talk, to read every slide well before learning any. Only
// whole slides are practised; the next new slide comes before reviews and before trying a slide again, and a miss
// moves on instead of going down. At most FAMILIAR_HIDE is hidden, and an attempt never lifts a node's score above
// FAMILIAR_CAP (or above where it was), so reading a slide aloud does not count toward the gist's bar of 0.8.
export const FAMILIAR_HIDE = 0.3;
// Getting familiar hides in steps, a staircase per slide (Tim, 11 November: "I go from reading to not being able to
// read at all"). Since 0.2 one good reading put a slide at the 30% cap at once, and 30% straight after one reading
// was recalled 1 time in 4. The staircase steps on recall, the meaning half of a reading's score (or the Peek score
// offline), at FAMILIAR_OK or more: when words were hidden it was the meaning that fell (0, 0 and 29 at 30%), while
// the delivery half barely moved; with nothing hidden the meaning was 80 or more in 91% of his readings.
// A slide hides FAMILIAR_UP more after FAMILIAR_STREAK readings in a row recalled well (no Peek), or FAMILIAR_RELEARN
// more after one while it is below the most it was recalled well at before (a slide forgotten climbs back quickly),
// and FAMILIAR_DOWN less after any other. Simulation (tests/sim/familiar.test.ts, the learners fitted to his sessions,
// 6 readings of every slide of his talk): readings recalled 74% (both fits) and at most 12% hidden, against 51% and a
// 30% jump before; up 5% after every recalled reading gave 64 to 66%, up 2% after two gave 75 to 76% but at most 8%.
export const FAMILIAR_OK = 80;
export const FAMILIAR_UP = 0.03;
export const FAMILIAR_STREAK = 2;
export const FAMILIAR_RELEARN = 0.06;
export const FAMILIAR_DOWN = 0.1;
// Offline (no microphone, no judge), an attempt scores 100 less PEEK_COST a second of Peek held. A starting value:
// 1.5 s of peeking is still good, about 4 s a miss. To be refitted from online readings, which log peeks and the
// judge's score together.
export const PEEK_COST = 10;

// Across modes (Tim, 11 Nov: how one mode's data feeds the next). A cap on how much a whole slide hides at the gist
// beyond what it was recalled at was tried and left out: on every slide it cut the budget simulation's expected
// Saturday score from over 0.45 to 0.23; on the slides getting familiar had read, the first three gist attempts a day
// later were recalled 5% of the time with it and 1% without (the fitted learner keeps little a day after reading with
// few words hidden), short of the 15 points asked of it. To be decided from his first gist session after getting
// familiar, which the log now marks with the mode.
// A familiar reading with more than WEAK_PEEK of Peek marks its slide as hard, for the gist to start on (ms).
export const WEAK_PEEK = 3000;
export const FAMILIAR_CAP = 0.65;

// The gist, to fit Tim's budget (about 1100 attempts over 10 hours, Tuesday 10 to Friday 13 November; the talk on
// Saturday). GIST_TOP: each slide starts whole, read aloud first, and its sentences and groups are practised only where
// an attempt at the slide missed, until they are passed again. GIST_CLAUSES false: the clauses of a sentence are never
// practised on their own (a clause hides by its sentence's score). GIST_GROUP: groups of this many sentences or fewer
// that are not a whole slide are passed over even after a miss, which then goes straight to the sentences.
// Simulation (tests/sim/budget.test.ts, the learner refitted to Tim's first attempts with /learn, from nothing learned,
// the mean of 5 runs): from the sentences up, 8 of 86 slides at the gist bar by Friday night, 16 started, an expected
// Saturday pass rate over the whole talk of 17%; whole slides first, 11 at the bar, 22 started, 22%; and with pairs
// passed over (chosen), 13, 23 and 24%. A slide at its bar passes on Saturday about 99% of the time. Breadth first
// (every slide's sentences before any slide), a slide bar of 0.7, and no section run-throughs all did worse.
export const GIST_TOP = true;
export const GIST_CLAUSES = false;
export const GIST_GROUP = 2;

// Pacing for desirable difficulty: the pass rate of the last PACE_OF counted attempts of the session (once there are
// PACE_MIN) is kept between PACE_LOW and PACE_HIGH. Above it, a node is ready to try once its parts are within EASE
// of their bars, and SHIFT is added to each leaf's score when hiding, so more is hidden. Below it, a miss zooms down
// two levels instead of one, and SHIFT is taken off, so more of the text shows.
export const PACE_OF = 10;
export const PACE_MIN = 5;
export const PACE_LOW = 0.7;
export const PACE_HIGH = 0.85;
export const EASE = 0.05;
export const SHIFT = 0.15;

// Liveness. A node missed STUCK times running needs its parts LIFT above their bars before it is tried again, and
// they are practised until they are. At most REVIEWS due reviews come before one step of new material. A node picked
// SAME times in a row is passed over once, if there is anything else. Simulation: with SAME 4 a talk of 7 slides
// had one node picked 7 times in a row; with 3, at most 5.
export const STUCK = 3;
export const LIFT = 0.1;
export const REVIEWS = 5;
export const SAME = 3;

// Placing the judge's problems (lib/learn/align.ts): a quoted phrase is placed where at least PLACE of its words match.
// Each word placed in a problem takes on trouble: HIT for a phrase left out, changed or a wrong term, STUMBLE for a
// stumble; every other word of the leaf attempted keeps KEEP of its trouble, and trouble fades with time as the score
// does. The card colours a word low from TROUBLE_LOW and high from TROUBLE_HIGH; the Progress screen lists runs of
// words at TROUBLE_LOW or more as the weakest phrases.
export const PLACE = 0.6;
export const HIT = 1;
export const STUMBLE = 0.5;
export const KEEP = 0.6;
export const TROUBLE_LOW = 0.3;
export const TROUBLE_HIGH = 1;

// Metrics: an attempt after a gap of more than GAP counts toward retention.
export const GAP = 30 * MIN;
