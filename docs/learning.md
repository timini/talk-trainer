# How the trainer teaches a talk

This is the design of the learning engine behind `/talks/[id]/learn`: what it does, why, the learning theory behind
each rule and the data it rests on. The code is in `lib/learn/`. Every threshold is in `lib/learn/rules.ts` and
nowhere else.

## The aim

Tim learns a talk to one of three aims.

- **Get familiar:** every slide read aloud well, the whole talk before any slide again, with at most 30% hidden.
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
- **Sections** are the deck's own PowerPoint sections (`lib/pptx.ts` reads the section list in `presentation.xml`, and
  the build keeps each slide's section in D1). A slide in no section stays with the section before, and a section of
  one spoken slide is just that slide. A deck with no sections gets groups of about `SECTION` (5) slides, a remainder
  of fewer than 3 joining the section before. With one section there is just the talk. **The talk** is over the
  sections. These are practised as run-throughs, slide by slide.

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
`ALPHA` (0.5) of the way to that attempt's score, so the last 3 attempts carry about 88% of the weight. A confident
pass, 85 or more with at least `SURE` (45%) of its words hidden, moves it `ALPHA_GOOD` (0.9) of the way instead, so a
part said well is not asked again and again (see "Tim's first sessions").

**Scores flow down.** The judge's problems are placed on the leaves (below), and every node under the attempted one is
scored by its own leaves. These move only `UNDER` (0.25) of the
way: where a problem falls is a guess, so it is weaker evidence than an attempt at that part.

**A node is known at least as well as its parts, joined:** its estimate is the higher of its own faded score and the
mean of its parts' estimates times `JOIN` (0.9). The penalty is for joining, which the data says is harder than the
parts (finding 5). A node still has to be tried once before it counts as at its bar.

**Spacing.** Each node has an interval: `FIRST` (20 minutes) at first, `GROW` (4) times longer after a pass, back to
20 minutes after a miss (10 minutes and 2.5 until 10 November; see "Tim's first sessions"). A pass grows the interval only if it came at least one interval after the last pass, so three
passes in ten minutes count as one. This is expanding retrieval (the Leitner system, SM-2): reviews are spaced out as
the memory gets stronger, which is what builds retention after a gap (finding 4).

**Fading.** A node is trusted for its interval. After that its score fades as `(1 + t / interval) ^ -FADE`, with `t`
the time past the interval and `FADE` 0.3. Forgetting curves follow a power law more closely than an exponential
(Wixted and Ebbesen, 1991). A node is due once it has faded below its bar. What is shown fades with it, so a node comes
back after a break with more of its text.

## Where a problem falls (`align.ts`)

The judge quotes the words each problem affected, but not always exactly: "foundation-model" for "foundation model",
"nine" for 9, a word changed or one added. An exact match then marks nothing, and in real use missed words often were
not shown. So each quoted phrase is placed by alignment: the span of the text, starting and ending at a matching word,
that matches the most of the phrase's words in order, after the grader's normalising (case, punctuation, number
words) and allowing close word forms (learned and learn). It needs at least `PLACE` (60%) of the phrase's words. On a
tie the earliest span wins, then the shortest, and a span already taken by an earlier problem is not used again.

The same placement marks the missed words on the card, charges each problem to the leaves it falls in (the costs of
`lib/score.ts`), and adds to each word's trouble.

## What Tim does not know, word by word

Each leaf keeps a trouble value for each of its words, in its state. On an attempt, each word inside a placed problem
gets `HIT` (1) more for a phrase left out, changed or a wrong term, or `STUMBLE` (0.5) for a stumble, and every other
word of the leaves attempted keeps `KEEP` (0.6) of its trouble. Trouble fades with time as the score does.

After each verdict the card shows the text with each word shaded by its trouble: none plain, from `TROUBLE_LOW` (0.3)
pale amber, from `TROUBLE_HIGH` (1) deep red. This attempt's misses are also underlined in bold, so colour is never
the only sign. The Progress screen lists the weakest phrases: runs of words with trouble of 0.3 or more, the most
trouble first.

"Count it as got" takes back the trouble the attempt added; "Count it as missed" puts it back.

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
   its parts, so a slide is learned sentence 1, sentence 2, the pair, sentence 3, and so on. "At its bar" is the node's
   own score, once it has been tried, and its last attempt was not a miss; the estimate from its parts only sets where
   its score starts and how much is hidden. A node is not ready while any part under it missed on its last attempt. So
   after a miss and a pass lower down, the climb goes back through the node missed, one level at a time, and never
   jumps over it to the whole slide. (Tim, 9 November, slide 4: a group of 54 words was missed, its last sentence
   passed, and the next card was the whole slide of 128 words, because the group's estimate from its parts was above
   its bar.)
4. Else **the first leaf of the next new slide**, within the slides chosen to practise.

**The slides to practise** are a range: from one slide to another, one of the talk's sections by its name (the deck's
own, or the run-through groups), the whole talk, or the opening and close (the first and last sections). Nothing
outside the range is picked, so a part that fades outside it waits until the range takes it in again. Before ranges
there was a goal, the last slide to work on (from slide 1); it becomes the range from slide 1 to it.

**The bars** (the score at which a node counts as known):

| Aim | Clauses, sentences, groups, bridges | Slides, sections, the talk |
|---|---|---|
| Word for word | 0.75 | 0.85, and every word hidden |
| Gist | 0.5 | 0.8, at most half hidden |
| Get familiar | (not practised) | 0.6, at most 30% hidden |

**Getting familiar goes breadth first** (Tim, 11 November): to read the whole talk well before learning any slide.
Only whole slides are practised: no clauses, sentences, groups, bridges or run-throughs. The next new slide in the range
comes first, before due reviews and before a slide is tried again, and a miss moves on to the next slide instead of
going down. Once every slide in the range has started, it is due reviews, then the slides not yet at 0.6 in talk
order. At most `FAMILIAR_HIDE` (30%) is hidden. An attempt never lifts a node's score above `FAMILIAR_CAP` (0.65), or
above where it was if that is higher, so reading a slide aloud never counts toward the gist's slide bar of 0.8. A
slide read well twice, the second time with some words hidden, is at its bar.

**One button, judged in the background** (Tim, 11 November: a verdict distracts from reading through the talk).
Start records the first slide. Next slide stops the recording, sends it to the judge and shows the next slide at
once, already recording. No verdict, score or tip is ever shown in this mode. Each verdict is counted on the slide it
was for, whatever is on screen by then. A slide still with the judge is not picked again while there is another. A
recording not heard, or a judge error, is logged with no score and changes nothing. Without the microphone, Next slide
counts the slide as read (85, logged `why: "read"`).

**The judge listens for meaning and delivery** (`prompt` mode `read` in `lib/judge.ts`). A problem is listed only
where the meaning suffers; order, rewording and a false start put right at once are fine. The score
(`readScore` in `lib/score.ts`) is the mean of the meaning (the problems, stumbles aside) and the delivery
(`(clarity + fluency) × 10`). Each attempt logs both halves with the clarity, fluency, pace and tip. The Progress
screen's "Slides to work on" lists the five slides with the lowest last score, each with the half that was lower:
that is where the data shows, and only there.

**Version 0.2, from Tim's first session** (11 November, 42 minutes, 107 attempts, 73 scored as readings; the first
23 were before reading scores). Median score 90; 82% scored 85 or more, 8% under 60. Delivery was the weaker half (27
readings at 70 or below, against 11 that lost any meaning). The judge's tips were mostly to pause (23) and to finish
the sentence (7). About 16 seconds a slide; the judge took about 3.6 seconds, well inside that. The lowest slides (54,
51, 73, 86, 97, 76, 107) include three Tim had already noted as confusing. The changes:

- **The bounce** (slides 106 and 1, again and again). Each attempt at a slide with a short first sentence ("Three
  takeaways.", "Good morning, everyone.") was thrown away as started in the wrong place: `start()` in
  `lib/score.ts` found the next sentence's first 4 words within the first 8 heard and preferred the longer match.
  A sentence's first word must now open what was heard (`ANCHOR`, one stray word allowed). An attempt not counted
  left the slide new, so it was picked first again; now a slide not counted twice in a session is passed over as new
  while there is anything else.
- **One good reading is enough.** A reading of 85 or more moves the slide `ALPHA_GOOD` of the way whatever is hidden
  (`record(..., sure)`), so it is at the bar at once: with 82% of readings there, the second time round is about a
  fifth of the talk, not all of it.
- **Read again next.** Tim liked going back to a slide that was not read well. A verdict under 85, or an attempt not
  counted, brings that slide next ("Again"), once a session.
- **Waiting, not repeating.** When the only slides left are with the judge, the session waits for their verdicts
  ("Checking your last reading") instead of showing the last slide again.
- **The strip.** Across the top of a session, one cell a slide in talk order: grey not tried, amber to green by its
  estimate against the bar, green at the bar, the slide on screen outlined, a slide with the judge faded.

**Version 0.3: hiding in small steps, Peek and offline** (11 November). Tim: "I go from reading to not being able to
read at all." Since 0.2 one good reading put a slide at the 30% cap at once. Across his 331 scored attempts, whole
slides were read well 81% of the time with nothing hidden, 46% at half hidden on the gist after practice, but only
1 time in 4 at 30% straight after one reading. When words were hidden it was the meaning half that fell (0, 0, 29),
not the delivery. So:

- **A staircase per slide** (`staircase` in `lib/learn/model.ts`). It steps on recall: the meaning half of the score
  (or the Peek score offline) at `FAMILIAR_OK` (80) or more, which with nothing hidden he met 91% of the time. Up
  `FAMILIAR_UP` (3%) after `FAMILIAR_STREAK` (2) readings in a row recalled well, up `FAMILIAR_RELEARN` (6%) after one
  while below the most it was recalled at before (relearning is quick), down `FAMILIAR_DOWN` (10%) after any other;
  at most 30%. The hidden words are given out over the whole slide in whole words, so 3% of a 35-word slide is one
  word (per clause it rounded to none). Names and numbers stay in full.
- **Simulation** (`tests/sim/familiar.test.ts`, learners fitted to his sessions, 6 readings of every slide):
  readings recalled 79% with no jump over 6%, against 51% and a 30% jump before, and 85% with nothing ever hidden.
  A grid of steps: up 5% after every recalled reading gave 64 to 66%; up 3% after two, 74%; up 2% after two, 75 to
  76% but at most 8% hidden.
- **Peek** (hold the button, or Space): the hidden words show while held. Each attempt logs `peeks` and `peekMs`.
  Online the judge's score stands, but a reading with a Peek does not step the staircase up, and at the gist and word
  for word it is at most Nearly.
- **Show me counts as missed** (Tim: "it didn't penalise me for looking"): said off the screen, it is scored 50, so it
  comes back easier, not harder.
- **Offline** (no microphone, no judge): each attempt scores 100 less `PEEK_COST` (10) a second of Peek held. A starting
  value, to be refitted from online readings, which log peeks with the judge's score.
- **Keys:** Space held is Peek, the Right arrow the next slide (or on after a verdict), Enter speaks or stops.
- **The strip** underlines the slides being practised and dims the rest.

**The gist starts each slide whole** (`GIST_TOP`), to fit Tim's budget (below). A new slide is read aloud whole first,
then said with more hidden each time. Its sentences and groups are practised only where an attempt at the slide missed
(the misses fall on them), until they are passed again; then the slide comes back. A clause is never practised on its
own at the gist (`GIST_CLAUSES`), and a missed pair of sentences goes straight to its sentences (`GIST_GROUP` 2). Each
part passed over hides by the score of the node over it, when that is higher. The gist asks for the meaning, which a
slide carries whole; word for word still climbs from the clauses up.

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

- `learn:n:<node id>`: a node's state, with a leaf's trouble.
- `learn:set:aim`, `learn:set:range`, `learn:set:mic`: the settings, each `{ v, at }`; the range is a list of spans
  `[from, to]`. `learn:set:goal`, from before ranges, is read once if there is no range.
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
the score, whether it passed, how long the judge took, and the gap since the node was last tried. Since 10 November,
for fitting the learner directly, it also has the version of the rules (`v`, a hash of `rules.ts`), each leaf's score,
the judge's problems by kind, each slide's points on a run-through, whether Show me was used, the time spoken and the
wait before speaking. "I know this one" is logged too, with `why: "known"` and no score; the metrics leave it out.
The judge's log in KV gets the place in the tree as well, kept 14 days with the audio. The Progress screen shows:

- slides at their aim;
- the pass rate this session, against the 70 to 85% target;
- attempts to reach the bar, by kind of node;
- retention: the pass rate after a gap of more than 30 minutes;
- the weakest phrases;
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
| 1 | 11 / 22, 86% | 5 / 7, 86% |
| 2 | 30 / 42, 84% | 8 / 11, 91% |
| 4 | 55 / 77, 84% | 17 / 21, 84% |
| 6 | 82 / 167, 86% | 27 / 35, 83% |
| 9 | 177 / 348, 88% | 39 / 48, 85% |
| 12 | 337 / 487, 90% | 50 / 57, 85% |

A talk of 7 slides (17 sentences) to its run-through: 664 to 1035 attempts word for word (8 to 12 sessions of 30
minutes), 117 to 145 for the gist. The simulation also checks that a climb after a miss never passes over the node
missed. Making the climb go back through it cost a few attempts: before, the gist took 14 for 4 sentences and 30 for 9,
and word for word 52 and 168, with the climb sometimes skipping a missed node (19 to 30 times in 20 slides at the
gist).

The gist before it passed over clauses, with its node bar at 0.6: 8, 16, 35, 53, 82 and 146 attempts (medians, for 1
to 12 sentences), and 243 to 340 for the talk of 7 slides. Each step on its own: passing over clauses gave 19 for 4
sentences and 38 for 9; the bar 0.5 then 14 and 30. The gist now runs a little above the 70 to 85% band (up to 93% for
2 sentences), where the pacing hides more.

### Tim's budget (`tests/sim/budget.ts`)

These figures are from before his first sessions; the budget now replays them, under the fitted learner (see "Tim's
first sessions").

Tim has about 10 hours from Tuesday 10 to Friday 13 November (3, 3, 2.5 and 1.5 hours, in blocks of 45 minutes with
nights between), about 1100 attempts at the 95 to 110 an hour his sessions ran at, and gives the talk on Saturday 14.
The talk has 86 slides, 301 sentences and 4508 words, in 6 sections of 4, 10, 34, 19, 15 and 4 slides.

**The learner refitted** to his first 36 attempts with /learn (9 and 10 November): under 15 words passed 89%, 15 to 30
words 73%, 30 to 60 words 38%, 60 or more 25%; sentences 86%, groups 50%, slides 60%, bridges 33%. The 9 November
learner passed long attempts far too often, as a few shown words carried it across each join. The refit: a join leans
little on the words shown around it (it is read with the chance (1 - h) ^ 4, h the share hidden), a new join between
sentences is known 0.4, and after a slip the place is found again at the next hidden leaf only 20% of the time
(trailing off, as in the data). With each sentence known, half hidden, it passes 90% for one sentence, 60% for two
(a long sentence alone is 89%, so the 15 to 30 word bucket is about 73%), 38% for four and 24% for seven.

**The budget run**, from nothing learned, the mean of 5 runs. Slides at the gist bar, bridges and sections at theirs by
Friday night; slides started; the share of the talk's words in slides at the bar; the expected pass rate on Saturday
morning over every slide said from memory with nothing shown (and over the slides at the bar alone); attempts; the
pass rate of each 45 minute block.

| Settings | Slides at bar | Bridges | Sections | Started | Words | Saturday (at bar) | Attempts | Blocks |
|---|---|---|---|---|---|---|---|---|
| From the sentences up (before) | 8 | 12 | 1 | 16 | 13% | 17% (99%) | 1009 | 76 to 98% |
| Pairs passed over | 10 | 12 | 2 | 17 | 16% | 18% (99%) | 998 | 78 to 96% |
| Slide bar 0.7 | 8 | 12 | 1 | 15 | 13% | 16% (97%) | 1033 | 72 to 97% |
| No section run-throughs | 9 | 6 | 0 | 15 | 14% | 15% (95%) | 1030 | 76 to 97% |
| Breadth first (every slide's sentences first) | 0 | 0 | 0 | 34 | 0% | 0% | 1211 | 58 to 82% |
| Whole slides first | 11 | 13 | 2 | 22 | 17% | 22% (99%) | 940 | 81 to 92% |
| Whole slides first, slide bar 0.7 | 11 | 13 | 2 | 23 | 16% | 20% (97%) | 968 | 74 to 89% |
| **Whole slides first, pairs passed over (chosen)** | **13** | **14** | **2** | **23** | **20%** | **24% (98%)** | **931** | **76 to 96%** |

**Nothing covers the whole talk** in this budget, from nothing learned: the best reaches 13 of 86 slides at the gist
bar and starts 23. Covering all of it would take about 4 to 5 times the budget under this learner. A slide that reaches
its bar is very likely to hold on Saturday (about 98%), so depth on fewer slides beats a thin pass over all of them
(breadth first left no slide at its bar). Tim is not starting from nothing: the old trainer's sentence scores carry
over for the slides he has practised, so the real figure should be better; the Progress screen will tell after
Tuesday.

**What to put first**, with the range of slides on the home screen: Opening and close (sections 1 and 6) first, as the
first and last words land hardest; then section 2 (slides 5 to 14); then section 3 in order.

What the simulation changed from the first design:

- **Fading.** Halving the score every interval wiped a day's work overnight: a node with a 10 minute interval was at 0
  after 3 hours, so every session started again from reading aloud. The power-law fade keeps some of it.
- **`JOIN` 0.9** (from 0.85) and **the word for word node bar 0.75** (from 0.8): with the earlier values a slide of 9
  sentences took 317 attempts and one of 12 took 495, at the same pass rate.
- **`UNDER` 0.25:** with the full 0.5, a passing attempt at a slide that slipped on one clause knocked that clause below
  its bar, and the slide could not be tried again until it was relearned.
- **A node must be tried once** to count as at its bar; otherwise bridges were skipped, as their two slides already
  made them look known.
- **The gist** starts each slide whole, passes over clauses and pairs, and its node bar is 0.5 (from 0.6), to fit Tim's
  budget (above).
- **A node just missed is not at its bar**, and nothing over a part just missed is ready (see zoom up).
- **`SAME` 3** (from 4): with 4, one node was picked 7 times in a row in a talk of 7 slides.

The learner is a model, so these numbers are a guide to the shape, not a promise of minutes. The real numbers come
from the Progress screen after Tim's first sessions.

### Tim's first sessions (10 November)

Tim's log on 9 and 10 November: 167 attempts in four sessions, about 1.75 hours, on slides 1 to 7. 93 of them were
with the gist fitted to his budget. The talk is now v41: 81 slides, 274 sentences, 4092 words.

**What matched the simulation.**
- The pass rate held in its band: 74%, 83%, 84% and 100% by session.
- 7 slides were started; the simulation said 7 to 10.
- About 90 attempts an hour, against the 95 to 110 assumed.

**What did not.**
- Long attempts were far easier for him than for the 10 November learner. Half hidden, attempts of 60 words or more
  passed 81% (22 of 27); the learner gives 25%. Bridges passed 82%, against 33%. The transcripts show near word for
  word recall, so the judge is not lenient.
- Memory lasted longer: 18 of 21 attempts after a night passed (86%), where the learner halves a memory in 3 hours.
- The pass rate alone cannot tell learners apart. The pacing holds it in its band whatever the learner, by showing
  more or going down. Re-run on this version, even the 10 November learner passes 80 to 84%.
- Much of the practice confirmed what he knew. Slide 2 took 24 attempts, 23 of them passes; slide 3, 9 and 9. At the
  gist the hiding sat at its 50% cap on 80% of attempts, so a slide climbed by repetition. Slide 4, the longest and
  changed by v41 midway, took 69 of the 167.

**The fitted learner** (`FIT_11_NOV`). The simulation replays his four sessions on the shape of the v41 talk, then the
hours left. A grid of 648 learners was scored against his log: the pass rates by kind and by length, first attempts,
attempts after more than 3 hours, and the slides started and at the bar. The best: a memory lasts 8 hours before
spacing (from 3) and a spaced success grows it 3 times (from 1.5), with new joins at 0.55. The top fits are close
and differ most in the joins, so every setting was checked against three: the best, the next (memory 24 hours, joins
leaning less on the words shown, slower learning), and the 10 November learner.

**The settings search.** The measure: the expected Saturday score over the whole talk, each slide said with nothing
shown, weighted by its words, a slide never started counting 0; then the slides at the gist bar by Friday night, and
the slides started. Each cell is the best fit, the next and the 10 November learner, the mean of 3 runs (a scratch
copy of the engine with every setting open).

| Settings | Saturday score | Slides at bar | Started |
|---|---|---|---|
| Before | 0.39, 0.37, 0.27 | 21, 19, 13 | 33, 32, 23 |
| A new slide every 5 picks | 0.33, 0.31, 0.23 | 17, 15, 8 | 81, 81, 81 |
| A new slide every 12 picks | 0.35, 0.34, 0.23 | 18, 18, 11 | 56, 56, 59 |
| A node rests 20 minutes after a pass | 0.33, 0.34, 0.20 | 16, 18, 9 | 37, 40, 25 |
| `ALPHA_GOOD` 0.9 | 0.47, 0.42, 0.28 | 26, 20, 13 | 40, 36, 25 |
| `GROW` 4, `FIRST` 20 minutes | 0.47, 0.41, 0.28 | 29, 28, 18 | 39, 36, 25 |
| **Both (chosen)** | **0.53, 0.45, 0.26** | **37, 32, 17** | **45, 39, 26** |
| Both, and a new slide every 15 picks | 0.48, 0.45, 0.23 | 36, 33, 13 | 52, 49, 50 |

Also tried, with little change: the gist hiding cap at 0.8, `ALPHA` 0.7, the slide bar 0.7 or 0.75, `REVIEWS` 2, 3 or
10, `FADE` 0.2, `UNDER` 0.5, `GROW` 5, `FIRST` 30 minutes.

What it shows:
- **More exposure to later slides sooner makes Saturday worse** under every learner. A slide seen a few times and
  not brought to its bar does not hold, and the time comes from slides that would have.
- **The time went on confirming known slides, not on the order.** Trusting a confident pass and spacing further
  reaches later slides sooner by itself: 45 started instead of 33, 37 at the bar instead of 21, at the same pass rate.
- **The cost, if he forgets faster than his log says.** Under the 10 November learner the chosen settings are about
  even on the Saturday score (0.26 against 0.28). The slides at the bar hold less well, 80% on Saturday against 94%,
  since a pass is trusted longer. His 86% after a night is the evidence against that learner.

In the repo's budget run (`tests/sim/budget.ts`, the mean of 5) the chosen settings give, under `FIT_11_NOV`, a
Saturday score of 0.53, 41 slides at the bar and 44 started (0.40, 31 and 34 before); under the 10 November learner
0.26, 23 and 26 (0.28, 20 and 24).

**Next, from the new log fields:** fit the joins and the recall of each leaf from each leaf's score; check retention
from the run-throughs' slides, said with every word hidden; and separate the versions of the rules by `v`.
