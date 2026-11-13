import { type Browser, expect, type Page, test } from "@playwright/test";
import { deck } from "../support/deck.mjs";
import { signIn } from "./signin";
import { newTalk, type Script } from "./talk";

// The new trainer, /learn, with the stand-in judge (every attempt got) unless a test sets a verdict.
const verdict = (page: Page, json: Record<string, unknown>) => page.route("**/api/grade", (route) => route.fulfill({
  json: { heard: "", clarity: 5, fluency: 5, pace: "good", tip: "Good.", ...json } }));
const position = (page: Page) => page.getByTestId("position");
const big = (page: Page, name: string) => page.locator(".actions").getByRole("button", { name, exact: true });

async function open(page: Page, title: string, data?: Uint8Array): Promise<Script> {
  await signIn(page);
  const s = await newTalk(page, title, data);
  await page.goto(`/talks/${s.talk.id}/learn`);
  await expect(page.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  await page.getByLabel(/Word for word/).check();
  return s;
}
// Say an attempt: tap to speak, wait until the microphone is recording, a moment more, then tap to stop.
async function attempt(page: Page) {
  await page.getByRole("button", { name: "Tap to speak" }).click();
  await expect(page.getByTestId("listening")).toHaveText(/^Listening/);
  await page.waitForTimeout(400);
  // a join card turns to its second slide first (13 Nov)
  const turn = page.locator(".actions").getByRole("button", { name: /^Next slide: \d+$/ });
  if (await turn.isVisible()) await turn.click();
  await big(page, "Tap to stop").click();
}
// Say the card on screen with the stand-in judge, then Next.
async function pass(page: Page) {
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await big(page, "Next").click();
}
// The positions of the next n cards, each passed.
async function walk(page: Page, n: number) {
  const seen: string[] = [];
  for (let k = 0; k < n; k += 1) {
    seen.push(await position(page).innerText());
    await pass(page);
  }
  return seen;
}

// The whole slide said well with every word hidden is a confident pass (ALPHA_GOOD), at its bar the first time.
test("a slide of 2 sentences: each sentence, then the whole slide, all hidden; then the next slide", async ({ page }) => {
  await open(page, "Learn walk");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("status")).toHaveText("Slide 1 of 3");
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud.");
  await expect(page.getByTestId("crumbs")).toHaveText("Slide 1 > Sentence 1");
  expect(await walk(page, 5)).toEqual(["Sentence 1 of 2", "Sentence 1 of 2", "Sentence 2 of 2", "Sentence 2 of 2",
    "Whole slide: all 2 sentences"]);
  await expect(page.getByTestId("status")).toHaveText("Slide 2 of 3");
  await expect(position(page)).toHaveText("Sentence 1 of 2");
});

test("getting familiar: one button, the next slide, recording; judged in the background and never shown", async ({ page }) => {
  await open(page, "Learn familiar", deck([{ title: "One", notes: ["Three takeaways.", "First, look past the headline numbers."] },
    { title: "Two", notes: ["Mix the flour."] }, { title: "Three", notes: ["Then let it rest."] }]));
  await page.getByLabel(/Get familiar/).check();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud, then tap Next slide.");
  await expect(page.getByTestId("strip").locator("span")).toHaveCount(3);
  const seen: string[] = [];
  for (let k = 0; k < 3; k += 1) {
    await expect(page.getByTestId("listening")).toHaveText(/^Listening/);
    seen.push(await page.getByTestId("status").innerText());
    await expect(page.getByTestId("strip").locator("span").nth(k)).toHaveClass(/now/);
    await page.waitForTimeout(300);
    await big(page, "Next slide").click();
  }
  // each slide read well once (a short first sentence is counted, 11 November): nothing due, so it reads on from slide 1
  // (12 November) until End
  expect(seen).toEqual(["Slide 1 of 3 (familiar)", "Slide 2 of 3 (familiar)", "Slide 3 of 3 (familiar)"]);
  await expect(page.getByTestId("status")).toHaveText("Slide 1 of 3 (familiar)");
  await expect(page.getByTestId("verdict")).toHaveCount(0);
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Progress" }).click();
  await expect(page.getByTestId("p-weakslides")).toContainText("slide 1: 100");
});

test("offline: no microphone and no judge; rate yourself: Up harder, Right the same; hidden words as first letters", async ({ page }) => {
  await open(page, "Learn offline", deck([{ title: "One", notes: ["Good morning, and thank you."] },
    { title: "Two", notes: ["Mix the flour."] }]));
  let graded = 0;
  await page.route("**/api/grade", (route) => { graded += 1; return route.fulfill({ json: {} }); });
  await page.getByLabel(/Get familiar/).check();
  await page.getByLabel(/Offline \/ silent mode/).check();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("status")).toHaveText("Slide 1 of 2 (familiar)");
  const peek = page.locator(".actions").getByRole("button", { name: "Peek" });
  await peek.hover();
  await page.mouse.down();
  await expect(peek).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  for (const name of ["Easier", "Same", "Harder"]) await expect(page.locator(".actions").getByRole("button", { name })).toBeVisible();
  await expect(page.locator(".keys")).toContainText("Up arrow harder");
  // Up: harder next time
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("status")).toHaveText("Slide 2 of 2 (familiar)");
  await expect(page.getByTestId("strip").locator("span.learning")).toHaveCount(2);
  // Right: the same difficulty, and on; nothing due, so it reads on from slide 1, now with words hidden (it was rated
  // harder), each by its first letter
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("status")).toHaveText("Slide 1 of 2 (familiar)");
  await expect(page.locator(".leaf > span > .gap").first()).toBeVisible();
  await expect(page.locator(".leaf > .gap")).toHaveCount(0);
  expect(graded).toBe(0);
});

test("a long sentence: its clauses, then the sentence", async ({ page }) => {
  const long = "We looked at the data very closely, and we found that most variants were rare; so we asked the families.";
  await open(page, "Learn clauses", deck([{ title: "Data", notes: [long, "That is all."] }, { title: "End", notes: ["Thank you."] }]));
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("cue")).toHaveText(/^1We looked at the data very closely,$/);
  const seen = await walk(page, 6);
  expect(seen.slice(0, 4)).toEqual(["Sentence 1, clause 1 of 3", "Sentence 1, clause 1 of 3", "Sentence 1, clause 2 of 3",
    "Sentence 1, clause 2 of 3"]);
  expect(seen[4]).toBe("Sentence 1, clauses 1 to 2 of 3");
});

test("a miss zooms down to the part missed, and a pass climbs back up", async ({ page }) => {
  await open(page, "Learn miss");
  await page.getByRole("button", { name: "Start" }).click();
  await walk(page, 4);
  await expect(position(page)).toHaveText("Whole slide: all 2 sentences");
  await expect(page.getByTestId("instruction")).toHaveText("From memory: say it from the slide.");
  // the judge's quote is not exact: placed all the same
  await verdict(page, { heard: "Good morning, and thank you for coming.", meaning_ok: false,
    problems: [{ kind: "left_out", script: "today we baked the bread" }] });
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Missed");
  await expect(page.getByTestId("known")).toHaveText(/^Known \d+% to \d+%; the bar is 85%\.$/);
  // the words missed: underlined, and shaded by the trouble they have given
  await expect(page.locator(".cue .miss.t-high")).toHaveText(["Today", "we", "bake", "bread."]);
  await expect(page.locator(".cue .legend")).toBeVisible();
  await page.unroute("**/api/grade");
  await big(page, "Next").click();
  await expect(position(page)).toHaveText("Sentence 2 of 2");
  await expect(page.getByTestId("instruction")).not.toHaveText("Read it aloud.");
  await pass(page);
  await expect(position(page)).toHaveText("Whole slide: all 2 sentences");
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Progress" }).click();
  await expect(page.getByTestId("p-weakest")).toHaveText("slide 1: 'Today we bake bread.'");
});

test("nothing heard: not counted, the reason by the buttons, Try again or Show me, no Got it", async ({ page }) => {
  await open(page, "Learn empty");
  await page.getByRole("button", { name: "Start" }).click();
  await verdict(page, { heard: "", meaning_ok: false, problems: [], clarity: 1, fluency: 1 });
  await attempt(page);
  const note = page.locator(".actions").getByRole("status");
  await expect(note).toHaveText("I didn't catch that. Try again, or tap Show me to read it first.");
  await expect(note).toBeInViewport();
  await expect(big(page, "Try again")).toBeVisible();
  await expect(big(page, "Show me")).toBeVisible();
  await expect(big(page, "Got it")).toHaveCount(0);
  await expect(page.getByTestId("verdict")).toHaveCount(0);
  await page.unroute("**/api/grade");
  await big(page, "Show me").click();
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud.");
  await pass(page);
});

test("started right but stopped early: Missed, and down to a part", async ({ page }) => {
  await open(page, "Learn early");
  await page.getByRole("button", { name: "Start" }).click();
  await walk(page, 4);
  await expect(position(page)).toHaveText("Whole slide: all 2 sentences");
  // the judge passed it, but only 2 of 11 words were said
  await verdict(page, { heard: "Good morning", meaning_ok: true, problems: [] });
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Missed");
  await page.unroute("**/api/grade");
  await big(page, "Next").click();
  await expect(position(page)).toHaveText(/^Sentence \d of 2$/);
});

test("after 2 hours a node is due and comes back first; the Progress screen shows the numbers", async ({ page }) => {
  const s = await open(page, "Learn gap");
  await page.getByRole("button", { name: "Start" }).click();
  await walk(page, 3);
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Progress" }).click();
  await expect(page.getByTestId("p-session")).toHaveText("100% of 3 (the aim is 70% to 85%)");
  await expect(page.getByTestId("p-tobar")).toHaveText("sentence: 2 (1 part)");
  await expect(page.getByTestId("p-slides")).toHaveText("0 of 2");
  await page.getByRole("button", { name: "Back to the start" }).click();
  await expect(page.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  // two hours ago, as if
  await page.evaluate((id) => {
    Object.keys(localStorage).filter((k) => k.startsWith(`talk-trainer:${id}:learn:n:`)).forEach((key) => {
      const st = JSON.parse(localStorage.getItem(key) as string);
      localStorage.setItem(key, JSON.stringify({ ...st, at: st.at - 2 * 3600 * 1000 }));
    });
  }, s.talk.id);
  await page.route("**/progress", (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId("due")).toHaveText("1 part to go over again first: faded since you last said it.");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("status")).toHaveText("Again: slide 1 of 3");
  await expect(position(page)).toHaveText("Sentence 1 of 2");
});

test("two devices: the newer attempt wins", async ({ page, browser }) => {
  const s = await open(page, "Learn sync");
  await page.getByRole("button", { name: "Start" }).click();
  await pass(page);
  // saved online a few seconds later
  await expect.poll(async () => Object.keys((await page.request.get(`/api/talks/${s.talk.id}/progress`).then((r) => r.json()) as
    { items: Record<string, unknown> }).items).some((k) => k.startsWith("learn:n:s:1:0-0:")), { timeout: 10000 }).toBe(true);
  const leaf = async (p: Page) => p.evaluate((id) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith(`talk-trainer:${id}:learn:n:s:1:0-0:`)) as string;
    return JSON.parse(localStorage.getItem(key) as string) as { s: number; n: number };
  }, s.talk.id);
  await expect.poll(async () => (await leaf(page)).n).toBe(1);
  // the other device: the same leaf again, later
  const other = await second(browser);
  await other.goto(`/talks/${s.talk.id}/learn`);
  await expect(other.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  await other.getByRole("button", { name: "Start" }).click();
  await expect(position(other)).toHaveText("Sentence 1 of 2");
  await pass(other);
  expect((await leaf(other)).n).toBe(2);
  // saved online a few seconds later
  await expect.poll(async () => Object.entries((await page.request.get(`/api/talks/${s.talk.id}/progress`).then((r) => r.json()) as
    { items: Record<string, { n: number }> }).items).find(([k]) => k.startsWith("learn:n:s:1:0-0:"))?.[1].n, { timeout: 10000 }).toBe(2);
  // the first device opens again: the newer copy wins over its own
  await page.reload();
  await expect(page.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  await expect.poll(async () => (await leaf(page)).n).toBe(2);
  await other.context().close();
});

async function second(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use, permissions: ["microphone"] });
  const p = await context.newPage();
  await signIn(p);
  return p;
}

test("the slides to practise: a range, a section by its name, or the opening and close", async ({ page }) => {
  const say = (n: number) => [`Slide ${n} says its first thing.`, `Then slide ${n} says more.`];
  await open(page, "Learn sections", deck([{ title: "One", notes: say(1), section: "Opening" }, { title: "Two", notes: say(2) },
    { title: "Three", notes: say(3), section: "Middle" }, { title: "Four", notes: say(4), section: "Close" }]));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("range")).toHaveText("Practising slide 4");
  await page.getByRole("button", { name: "Opening and close" }).click();
  await expect(page.getByTestId("range")).toHaveText("Practising slides 1 to 2 and 4");
  await page.getByLabel("From slide").fill("2");
  await expect(page.getByTestId("range")).toHaveText("Practising slides 2 to 4");
  await page.getByLabel("To slide").fill("3");
  await expect(page.getByTestId("range")).toHaveText("Practising slides 2 to 3");
  await page.getByRole("button", { name: "Middle" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("status")).toHaveText("Slide 3 of 4");
  // kept
  await page.reload();
  await expect(page.getByTestId("range")).toHaveText("Practising slide 3");
});

// Hear me (13 Nov): the recording the verdict judged, played back as an object URL. The page's play() is wrapped to
// record what it was asked to play, since nothing can be heard here.
test("Hear me on a verdict plays the recording that was judged", async ({ page }) => {
  await open(page, "Learn hear me", deck([{ title: "One", notes: ["Good morning, and thank you."] }, { title: "Two", notes: ["Mix the flour."] }]));
  await page.getByRole("button", { name: "Start" }).click();
  await page.evaluate(() => {
    const played: string[] = [];
    Object.assign(window, { played });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { played.push(this.src); return play.call(this); };
  });
  await expect(page.locator(".actions").getByRole("button", { name: "Hear me" })).toHaveCount(0);
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await expect(page.locator(".keys")).toContainText("M to hear your recording");
  await page.locator(".actions").getByRole("button", { name: "Hear me" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { played: string[] }).played)).toEqual([expect.stringMatching(/^blob:/)]);
  await page.keyboard.press("m");
  await expect.poll(() => page.evaluate(() => (window as unknown as { played: string[] }).played.length)).toBe(2);
  // the next card: nothing to hear yet
  await big(page, "Next").click();
  await expect(page.locator(".actions").getByRole("button", { name: "Hear me" })).toHaveCount(0);
});

// A run-through on the same hiding ladder as a slide (13 Nov): below the top it is drawn like a slide, grouped by slide,
// every word at least a first letter; at the top, the opener list.
test("a run-through below the top of the ladder shows every slide's words as first letters and blanks, grouped by slide", async ({ page }) => {
  await open(page, "Learn run ladder", deck([{ title: "One", notes: ["Good morning, and thank you."] }, { title: "Two", notes: ["Mix the flour."] }]));
  await page.getByLabel(/Get the gist/).check();
  await page.getByRole("button", { name: "Start" }).click();
  // each slide whole, then the bridge, then the talk (the gist hides a run-through by its score, here 95%)
  for (let k = 0; k < 12 && !/each slide/.test(await page.getByTestId("instruction").innerText()); k += 1) await pass(page);
  await expect(page.getByTestId("instruction")).toHaveText(/^Say each slide, filling in the blanks \(\d+% hidden\), then tap Next slide\.$/);
  await expect(page.getByTestId("status")).toHaveText("Slide 1 of 2 (gist)");
  await expect(page.locator(".cue .change")).toHaveText(["Slide 1", "Slide 2"]);
  await expect(page.locator(".runs")).toHaveCount(0);
  // the hidden words as gaps (at 95% nearly all blank; the opening words of each slide kept until it is passed)
  await expect(page.locator(".cue .gap").first()).toBeVisible();
  await expect(page.locator(".actions").getByRole("button", { name: "Peek" })).toBeVisible();
  // said slide by slide, as before
  await page.getByRole("button", { name: "Tap to speak" }).click();
  await expect(page.getByTestId("listening")).toHaveText(/^Listening/);
  await expect(page.locator(".cue .change.on")).toHaveText("Slide 1");
  await page.waitForTimeout(300);
  await big(page, "Next slide").click();
  await expect(page.locator(".cue .change.on")).toHaveText("Slide 2");
  await page.waitForTimeout(300);
  await big(page, "Tap to stop").click();
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  // once judged: the opener list with each slide's points
  await expect(page.locator(".runs li")).toHaveText([/^Slide 1: Good morning, and\.\.\. 100$/, /^Slide 2: Mix the flour\.\.\.\. 100$/]);
  await expect(page.locator(".actions").getByRole("button", { name: "Hear me" })).toBeVisible();
});

test("the old trainer's address opens the trainer", async ({ page }) => {
  const s = await open(page, "Learn link");
  await page.goto(`/talks/${s.talk.id}/train`);
  await expect(page).toHaveURL(new RegExp(`/talks/${s.talk.id}/learn$`));
});
