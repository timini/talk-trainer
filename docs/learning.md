# How the trainer teaches a talk

This is the design of the learning engine behind `/talks/[id]/learn`: what it does, why, the learning theory behind
each rule and the data it rests on. The code is in `lib/learn/`. Every threshold is in `lib/learn/rules.ts` and
nowhere else.

## The aim

Tim learns a talk to one of two aims.

- **Word for word:** every slide said with all of its words hidden.
- **Get the gist:** every slide said with the meaning right, at a score of about 80, with at most half of it hidden.

The judge (`lib/judge.ts`, Gemini) listens to each attempt and lists what went wrong: a point left out, a meaning
changed, a wrong number or name, the order, a stumble. `lib/score.ts` turns that into a score out of 100. Got it is 85
or more, Nearly 60 to 84, Missed under 60.

## What the data showed

226 of Tim's attempts on 9 November, with the old trainer, analysed with the audio removed:

| Target | Passed |
|---|---|
| 1 sentence | 81% |
| 2 sentences | 34% |
| 4 or more sentences | 30% |
| Under 15 words | 78% |
| 50 words or more | 17% |

- Nothing hidden passed 80%; anything from 5% to 95% hidden passed 52 to 53%. Length and joins were the problem, not
  how much was hidden.
- In missed multi-sentence attempts, the joins between sentences went wrong 44 times, and 42 of those 44 were left
  out.
- 78% of misses had something left out. 57% heard under 60% of the words. Most misses are dropping content and
  trailing off, not misremembering.
- Overall success was 53%, below the 70 to 85% where practice teaches best.
- After a gap of more than 30 minutes, 15 of 32 known targets passed (47%). The pass rate did not rise across
  attempts 1 to 4 (66%, 49%, 58%, 43%).
- In 34 of 55 missed multi-sentence attempts, the old model rated every sentence at 0.6 or more: it overrated chains.

## The tree (`tree.ts`)

The talk is a tree, learned from the leaves up.

- **Clauses** are the leaves. A sentence of more than `SPLIT` (12) words splits after a comma, semicolon, colon or
  dash, into pieces of at least `CLAUSE` (4) words. A shorter sentence is one leaf.
- **Sentences** are nodes over their clauses.
- **Groups** of sentences. When the speaker notes have paragraphs, each paragraph is a group. Within a paragraph, and
  when there are none, the parts are paired into a balanced binary tree, so a node is never much more than twice the
  size of its parts.
- **The slide** is the top of its own tree.
- **Bridges.** Between each pair of spoken slides there is a bridge: the last sentence of one and the first sentence
  of the next, so the change of slide is practised directly.
- **Sections** of about `SECTION` (5) slides (a remainder of fewer than 3 joins the section before), and **the talk**
  over them. With 7 slides or fewer there is just the talk. These are practised as run-throughs, slide by slide.

A slide of 9 short sentences has 17 nodes: 9 sentences, 7 groups and the slide. The old trainer had 45 windows.

**Why.** Learning a long passage by parts that grow is the progressive part method: learn a piece, then the next,
then both together. The data says the step from one sentence to two is the biggest drop, so each step up the tree
only doubles. Clauses give long sentences the same small first step. Bridges target the joins between slides, where
the data shows most failures, without practising two whole slides together (50 words or more passed 17%).

**Ids.** `s:<slide>:<from>-<to>:<hash>` for a span of a slide's leaves, `b:<slide>:<hash>` for the bridge from a
slide to the next, `sec:<i>` and `t`. The hash is of the node's text, so a slide that is edited starts again where it
changed and keeps the rest.

**Paragraphs.** `lib/pptx.ts` keeps the notes' paragraph breaks (joined with a new line). The build splits sentences
with the breaks as spaces, exactly as before, so sentence hashes do not change. The script API finds each sentence in
the notes and marks the ones that start a paragraph. Talks built before this have no breaks, so they use the binary
pairing until they are built again.

## The score of each node (`model.ts`)

Each node keeps `{ s, at, interval, n, passes, lastPass, run, hid }`.

**The score `s`** is an exponentially weighted moving average of the node's attempt scores. Each attempt moves it
`ALPHA` (0.5) of the way to that attempt's score, so the last 3 attempts carry about 88% of the weight.

**Scores flow down.** The judge's problems are placed on the leaves (`perSentence` from `lib/score.ts`, run over the
clauses), and every node under the attempted one is scored by its own leaves. These move only `UNDER` (0.25) of the
way: where a problem falls is a guess, so it is weaker evidence than an attempt at that part.

**A node is known at least as well as its parts, joined:** its estimate is the higher of its own faded score and the
mean of its parts' estimates times `JOIN` (0.9). The penalty is for joining, which the data says is harder than the
parts (finding 5). A node still has to be tried once before it counts as at its bar.

**Spacing.** Each node has an interval: `FIRST` (10 minutes) at first, `GROW` (2.5) times longer after a pass, back to
10 minutes after a miss. A pass grows the interval only if it came at least one interval after the last pass, so three
passes in ten minutes count as one. This is expanding retrieval (the Leitner system, SM-2): reviews are spaced out as
the memory gets stronger, which is what builds retention after a gap (finding 4).

**Fading.** A node is trusted for its interval. After that its score fades as `(1 + t / interval) ^ -FADE`, with `t`
the time past the interval and `FADE` 0.3. Forgetting curves follow a power law more closely than an exponential
(Wixted and Ebbesen, 1991). A node is due once it has faded below its bar. What is shown fades with it, so a node comes
back after a break with more of its text.

## Hiding

- Each leaf hides `(s - 0.2) / 0.7` of its words, in steps of 5%: nothing below 0.2, everything from 0.9. The hidden
  words are chosen afresh each attempt, seeded.
- The gist hides at most 50%.
- Word for word, a whole slide is said with every word hidden: that is the aim, and the slide is at its bar only after
  such an attempt.
- Terms (names, numbers, acronyms) are in full below 0.5, then their first letter below 0.8, then hidden.
- The first 3 words of a node, and of each of its parts, stay shown until the node has been passed once. These cue the
  joins (finding 1).

**Why.** Recalling with the words hidden is retrieval practice, which builds memory better than rereading (Roediger
and Karpicke, 2006). Hiding more as the score rises keeps each attempt effortful but possible.

## What to say next (`scheduler.ts`)

One rule, in order:

1. **A due node**, the lowest first: within the current slide, then earlier slides, then the rest.
2. Else, if the last attempt missed, **zoom down**: the part of the missed node with the lowest estimate. A leaf is
   tried again. A bridge goes down to its two sentences, a run-through to its slides and bridges.
3. Else **zoom up**: the first node, in talk order, that is not at its bar while its parts all are. A node comes after
   its parts, so a slide is learned sentence 1, sentence 2, the pair, sentence 3, and so on.
4. Else **the first leaf of the next new slide**, within today's goal (the last slide to work on today).

**The bars** (the score at which a node counts as known):

| Aim | Clauses, sentences, groups, bridges | Slides, sections, the talk |
|---|---|---|
| Word for word | 0.75 | 0.85, and every word hidden |
| Gist | 0.6 | 0.8, at most half hidden |

**Pacing for desirable difficulty.** Practice teaches best when most attempts succeed with effort (Bjork's desirable
difficulties; Wilson and others, 2019, put the best rate near 85%). The data's 53% was too hard. The scheduler keeps
the pass rate of the last 10 counted attempts of the session between 70% and 85%:

- Above 85%: a node is ready once its parts are within `EASE` (0.05) of their bars, and each leaf hides as if its
  score were `SHIFT` (0.15) higher.
- Below 70%: a miss zooms down two levels instead of one, and each leaf hides as if its score were 0.15 lower.

**Liveness.**

- A node missed `STUCK` (3) times running needs its parts `LIFT` (0.1) above their bars before it is tried again, and
  they are practised until they are.
- At most `REVIEWS` (5) due reviews come before one step of new material, so reviews cannot starve progress.
- A node picked `SAME` (3) times in a row is passed over once, if there is anything else to do.

## An attempt (`attempt.ts`)

- **Not counted:** an attempt where almost nothing was heard (a tap too soon, the microphone), or one that started at
  another part of the slide (a wrong place, not forgetting).
- **Nearly is one rule everywhere:** 60 to 84 counts as a pass for the interval and moves the score by its true value.
- **Recount.** "Count it as got" or "Count it as missed" rescore the attempt as 85 or 50, every leaf alike. Marking
  yourself without the microphone does the same.
- **I know this one** sets the node and every part under it to 0.9, passed now. **Show me** shows every word for this
  attempt and changes nothing.
- **Run-throughs** (a section, or the talk) are said slide by slide, one recording each, with the slide pictures and
  each slide's opening words. Each slide is scored as an attempt at that slide with every word hidden; a slide that was
  empty or started in the wrong place scores 0, as in a run-through it was not said. Each bridge between two slides
  said scores the mean of its leaves, each section whose slides were all said the mean of its parts, and the
  run-through the mean of its parts. A miss zooms down to the weakest slide or bridge.

## Data and sync (`store.ts`)

Kept in the browser's localStorage under `talk-trainer:<talk id>:` and online in D1, per talk:

- `learn:n:<node id>`: a node's state.
- `learn:set:aim`, `learn:set:goal`, `learn:set:mic`: the settings, each `{ v, at }`.
- `learn:log:<day>`: the day's attempts, for the metrics, `{ at, list }`.

**Merge, on the client and the server:** for every `learn:` key the newer `at` wins, and the logs are joined by
attempt id (the newer copy of an attempt wins, so a recount carries). The same rule now applies to the old trainer's
`flow:s:` and `flow:w:` keys, where before the last device to save won outright and two devices overwrote each other.
Old window records have no `at`; the one with more attempts wins.

**Migration, once, on the first load of `/learn`:** each `flow:s:` sentence score of the old trainer seeds its
sentence node and that sentence's clauses (the score from `m`, the interval from the passes). Nothing else is carried
over. The old keys stay for the old page.

## Learning rates (`metrics.ts`, and the Progress screen)

Each attempt is logged with the node, its kind and height, its size in words, the estimate before, the share hidden,
the score, whether it passed, how long the judge took, and the gap since the node was last tried. The judge's log in
KV gets the same fields. The Progress screen shows:

- slides at their aim;
- the pass rate this session, against the 70 to 85% target;
- attempts to reach the bar, by kind of node;
- retention: the pass rate after a gap of more than 30 minutes;
- the parts that have taken the most attempts.

## Verification

- Unit tests cover `lib/learn/` completely: the tree for 1, 2, 4, 9 and 12 sentences, clauses and paragraphs; the
  score, fading, spacing and reset; hiding; placing problems on leaves; every scheduler rule, the pacing and liveness;
  merge and migration; metrics.
- The engine (`app/talks/[id]/learn/engine.ts`) is tested with a fake fetch, recorder and storage.
- `tests/sim/` runs the engine against a simulated learner (below).
- Playwright walks the page in a browser.

### The simulation

The simulated learner keeps a memory of each clause and of each join between two clauses: a strength and a
stability. Recall decays with time, a shown word is read with chance 0.95, and practice strengthens memory, more when
the words were hidden and when it came after a gap. It is fitted to the 9 November data: a known sentence alone passes
81%, two together 34%, and hiding costs about 28 points against reading.

It is run on slides of 1, 2, 4, 6, 9 and 12 sentences (20 of each) and on a talk of 7 slides, at both aims, in
sessions of 30 minutes with gaps of 3 and 14 hours. It checks that the top is always reached, that the pass rate stays
near the 70 to 85% band, and that no node is picked more than 6 times in a row while there is anything else to do.
Attempts to reach the slide's bar (median and 95th percentile) and the pass rate, with the constants chosen:

| Sentences | Word for word | Gist |
|---|---|---|
| 1 | 11 / 19, 86% | 8 / 17, 83% |
| 2 | 23 / 41, 86% | 16 / 23, 87% |
| 4 | 52 / 72, 82% | 35 / 50, 82% |
| 6 | 78 / 155, 85% | 53 / 78, 81% |
| 9 | 168 / 265, 86% | 82 / 139, 84% |
| 12 | 332 / 426, 89% | 146 / 159, 85% |

A talk of 7 slides (17 sentences) to its run-through: 492 to 872 attempts word for word (6 to 10 sessions of 30 minutes),
243 to 340 for the gist (3 to 4 sessions).

What the simulation changed from the first design:

- **Fading.** Halving the score every interval wiped a day's work overnight: a node with a 10 minute interval was at 0
  after 3 hours, so every session started again from reading aloud. The power-law fade keeps some of it.
- **`JOIN` 0.9** (from 0.85) and **the word for word node bar 0.75** (from 0.8): with the earlier values a slide of 9
  sentences took 317 attempts and one of 12 took 495, at the same pass rate.
- **`UNDER` 0.25:** with the full 0.5, a passing attempt at a slide that slipped on one clause knocked that clause below
  its bar, and the slide could not be tried again until it was relearned.
- **A node must be tried once** to count as at its bar; otherwise bridges were skipped, as their two slides already
  made them look known.
- **`SAME` 3** (from 4): with 4, one node was picked 7 times in a row in a talk of 7 slides.

The learner is a model, so these numbers are a guide to the shape, not a promise of minutes. The real numbers come
from the Progress screen after Tim's first sessions.
