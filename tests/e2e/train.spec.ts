import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./signin";
import { attempt, newTalk, type Script } from "./talk";

// The stand-in judge, but slow enough to see "Checking...".
const slow = (page: Page) => page.route("**/api/grade", async (route) => {
  await new Promise((r) => setTimeout(r, 800));
  await route.continue();
});
// A judge with a set verdict.
const verdict = (page: Page, json: Record<string, unknown>) => page.route("**/api/grade", (route) => route.fulfill({
  json: { heard: "", clarity: 5, fluency: 5, pace: "good", tip: "Good.", ...json } }));
const status = (page: Page) => page.getByTestId("status");
const big = (page: Page, name: string) => page.locator(".actions").getByRole("button", { name, exact: true });

async function open(page: Page, title: string, aim: "gist" | "verbatim" = "verbatim"): Promise<Script> {
  await signIn(page);
  const s = await newTalk(page, title);
  await page.goto(`/talks/${s.talk.id}/train`);
  await expect(page.getByTestId("learned")).toHaveText("0 of 2 slides learned");
  if (aim === "verbatim") await page.getByLabel(/Word for word/).check();
  return s;
}
// Pass the attempt on screen with the stand-in judge, then Next.
async function pass(page: Page) {
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await big(page, "Next").click();
}
const blanks = async (page: Page) => page.locator(".cue .gap").count();

test("a new slide is read in full, then more of it is hidden with each pass, until the slide alone; then the next", async ({ page }) => {
  const s = await open(page, "Flow test");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(status(page)).toHaveText("Slide 1 of 3");
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud.");
  await expect(page.getByTestId("cue")).toHaveText("Good morning, and thank you for coming. Today we bake bread.");

  // Hear it plays the slide's clips one after another
  const heard: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/files/clips/")) heard.push(new URL(r.url()).pathname); });
  await page.getByRole("button", { name: "Hear it" }).click();
  await expect.poll(() => [...new Set(heard)], { timeout: 10000 }).toEqual(s.slides[0].sentences.map((x) => x.clip));

  // the verdict on the same card, after "Checking..."
  await slow(page);
  await attempt(page);
  await expect(page.getByTestId("checking")).toHaveText("Checking...");
  await expect(page.getByTestId("card").getByTestId("verdict")).toContainText("Got it");
  await page.unroute("**/api/grade");
  await big(page, "Next").click();

  // more hidden each time: 55%, 85%, 95%, then the slide alone
  await expect(page.getByTestId("instruction")).toHaveText("Say it, filling in the blanks (55% hidden).");
  const first = await blanks(page);
  await pass(page);
  await expect(page.getByTestId("instruction")).toHaveText("Say it, filling in the blanks (85% hidden).");
  expect(await blanks(page)).toBeGreaterThan(first);
  await pass(page);
  await expect(page.getByTestId("instruction")).toHaveText("Say it, filling in the blanks (95% hidden).");
  await pass(page);
  await expect(page.getByTestId("instruction")).toHaveText("From memory: say it from the slide.");
  // every word hidden but the opening three, each gap the width of its word, and where to start shown
  await expect(page.getByTestId("position")).toHaveText("The whole slide: all 2 sentences");
  await expect(page.locator(".cue .gap")).toHaveCount(8);
  await expect(page.getByTestId("cue")).toContainText("Good morning, and");
  await pass(page);
  await expect(status(page)).toHaveText("Slide 2 of 3");
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud.");
});

test("a miss shows more of the text next time; Show me shows all of it; I know this one hides it all", async ({ page }) => {
  await open(page, "Miss test");
  await page.getByRole("button", { name: "Start" }).click();
  await pass(page);
  await pass(page);
  await expect(page.getByTestId("instruction")).toHaveText("Say it, filling in the blanks (85% hidden).");
  await verdict(page, { heard: "Good morning, and thank you for coming.", meaning_ok: false,
    problems: [{ kind: "left_out", script: "Today we bake bread." }] });
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Missed");
  await expect(page.locator(".cue .miss")).toHaveText(["Today", "we", "bake", "bread."]);
  await page.unroute("**/api/grade");
  await big(page, "Next").click();
  // only the missed sentence drops: the first stays at 85% hidden, the second comes back to 15%
  await expect(page.getByTestId("instruction")).toHaveText("Say it, filling in the blanks (75% hidden).");
  await page.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud.");
  await page.getByRole("button", { name: "I know this one" }).click();
  await expect(page.getByTestId("instruction")).toHaveText("From memory: say it from the slide.");
});

test("a long pause does not stop the recording", async ({ page }) => {
  await open(page, "Pause test");
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Tap to speak" }).click();
  await expect(big(page, "Tap to stop")).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(big(page, "Tap to stop")).toBeVisible();
  await big(page, "Tap to stop").click();
  await expect(page.getByTestId("verdict")).toContainText("Got it");
});

test("progress survives a reload and comes back from the site; after a long gap a slide comes back with text", async ({ page }) => {
  const s = await open(page, "Progress test");
  await page.getByRole("button", { name: "Start" }).click();
  for (let k = 0; k < 5; k += 1) await pass(page);
  await expect(status(page)).toHaveText("Slide 2 of 3");
  await page.reload();
  await expect(page.getByTestId("learned")).toHaveText("1 of 2 slides learned");
  await expect(page.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  // this browser's copy gone: the online copy brings it back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("learned")).toHaveText("1 of 2 slides learned");
  await expect(page.getByTestId("from")).toHaveText("Start at slide 2: Flour and water.");

  // six hours later, got once: slide 1 has faded, so it comes back first, with some of its text showing
  await page.evaluate((id) => {
    Object.keys(localStorage).filter((k) => k.startsWith(`talk-trainer:${id}:flow:s:1:`)).forEach((key) => {
      const st = JSON.parse(localStorage.getItem(key) as string);
      localStorage.setItem(key, JSON.stringify({ ...st, passes: 1, at: Date.now() - 6 * 3600 * 1000 }));
    });
  }, s.talk.id);
  await page.reload();
  await expect(page.getByTestId("due")).toHaveText("1 part to go over again first: it has faded since you last said it.");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(status(page)).toHaveText("Again: slide 1 of 3");
  await expect(page.getByTestId("instruction")).toHaveText(/filling in the blanks/);
});

test("cards from the earlier trainer: a slide well known there counts as learned", async ({ page }) => {
  const s = await open(page, "Migration test");
  await page.evaluate(({ id, hashes }) => {
    hashes.forEach((h, i) => localStorage.setItem(`talk-trainer:${id}:train:1:${i + 1}:${h}`, JSON.stringify({ level: 2, last: 1 })));
    Object.keys(localStorage).filter((k) => k.includes(":flow:")).forEach((k) => localStorage.removeItem(k));
  }, { id: s.talk.id, hashes: s.slides[0].sentences.map((x) => x.hash) });
  await page.reload();
  await expect(page.getByTestId("from")).toHaveText(/slide 2: Flour and water\./);
});

test("get the gist: about half hidden, then the next slide; today's goal stops it, and Carry on goes further", async ({ page }) => {
  await open(page, "Gist test", "gist");
  await expect(page.getByLabel(/Get the gist/)).toBeChecked();
  await page.getByLabel("Up to slide").fill("1");
  await expect(page.getByTestId("left")).toHaveText("1 part to go, about 1 minute.");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(status(page)).toHaveText("Slide 1 of 3 (gist)");
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud.");
  await pass(page);
  await expect(page.getByTestId("instruction")).toHaveText("Say it, filling in the blanks (55% hidden).");
  await pass(page);
  await expect(page.getByTestId("goal-reached")).toContainText("Goal reached: slides 1 to 1 at the gist");
  await page.getByRole("button", { name: "Carry on to slide 3" }).click();
  await expect(status(page)).toHaveText("Slide 2 of 3 (gist)");
  // the aim and the goal are kept
  await page.reload();
  await expect(page.getByLabel(/Get the gist/)).toBeChecked();
  await expect(page.getByLabel("Up to slide")).toHaveValue("3");
});

test("an attempt that starts at another sentence is not counted, and says where to start", async ({ page }) => {
  await open(page, "Place test");
  await page.getByRole("button", { name: "Start" }).click();
  await verdict(page, { heard: "Today we bake bread.", meaning_ok: false, problems: [{ kind: "left_out", script: "Good morning, and thank you for coming." }] });
  await attempt(page);
  await expect(page.getByRole("status")).toContainText("That started at sentence 2 ('Today we bake bread'). This one starts at sentence 1: 'Good morning, and thank...'.");
  await expect(page.getByTestId("verdict")).toHaveCount(0);
  await page.unroute("**/api/grade");
  await page.locator(".actions").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("instruction")).toHaveText("Read it aloud."); // the score did not move
});
