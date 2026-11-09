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

async function open(page: Page, title: string): Promise<Script> {
  await signIn(page);
  const s = await newTalk(page, title);
  await page.goto(`/talks/${s.talk.id}/train`);
  await expect(page.getByTestId("learned")).toHaveText("0 of 2 slides learned");
  return s;
}
// Pass the step on screen with the stand-in judge.
async function pass(page: Page, then: string) {
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await big(page, then).click();
}

test("one slide at a time: from memory first, so a known slide takes one attempt", async ({ page }) => {
  const s = await open(page, "Flow test");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(status(page)).toHaveText("Slide 1 of 3: from memory");
  await expect(page.getByTestId("instruction")).toHaveText("From memory: say it from the slide.");
  await expect(page.getByTestId("cue")).toHaveCount(0);
  await expect(page.locator(".slidecol img")).toBeVisible();

  // Hear it plays the slide's clips one after another
  const heard: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/files/clips/")) heard.push(new URL(r.url()).pathname); });
  await page.getByRole("button", { name: "Hear it" }).click();
  await expect.poll(() => [...new Set(heard)], { timeout: 10000 }).toEqual(s.slides[0].sentences.map((x) => x.clip));

  // the verdict comes on the same card, after "Checking..."; a pass learns the slide and the next one starts
  await slow(page);
  await attempt(page);
  await expect(page.getByTestId("checking")).toHaveText("Checking...");
  await expect(page.getByTestId("card").getByTestId("verdict")).toContainText("Got it");
  await expect(page.getByTestId("strip")).toHaveCount(0);
  await page.unroute("**/api/grade");
  await big(page, "Next slide").click();
  await expect(status(page)).toHaveText("Slide 2 of 3: from memory");

  // Show me first: read it aloud, then the first letters, then from memory
  await page.getByRole("button", { name: "Show me first" }).click();
  await expect(status(page)).toHaveText("Slide 2 of 3: read it");
  await expect(page.getByTestId("cue")).toHaveText("Mix 500 grams of flour with 350 grams of water. Let it rest for an hour.");
  await pass(page, "Next step");
  await expect(status(page)).toHaveText("Slide 2 of 3: with hints");
  await expect(page.getByTestId("cue")).toHaveText("M 5 g o f w 3 g o w. L i r f a h.");
  await pass(page, "Next step");
  await expect(status(page)).toHaveText("Slide 2 of 3: from memory");
});

test("a miss hides only what was missed, then memory again; the total never grows", async ({ page }) => {
  await open(page, "Miss test");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(status(page)).toHaveText("Slide 1 of 3: from memory");
  await verdict(page, { heard: "Good morning, and thank you for coming.", meaning_ok: false,
    problems: [{ kind: "left_out", script: "Today we bake bread." }] });
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Missed");
  await expect(page.getByTestId("verdict")).toContainText("Left out 'Today we bake bread'.");
  await expect(page.locator(".cue .miss")).toHaveText(["Today", "we", "bake", "bread."]);
  await expect(page.getByRole("button", { name: "Count it as got" })).toBeVisible();
  await page.unroute("**/api/grade");
  await big(page, "Try with hints").click();
  await expect(status(page)).toHaveText("Slide 1 of 3: with hints");
  await expect(page.getByTestId("cue")).toHaveText("Good morning, and thank you for coming. T w b b.");
  await pass(page, "Next step");
  await expect(status(page)).toHaveText("Slide 1 of 3: from memory");
  await pass(page, "Next slide");
  await expect(status(page)).toHaveText("Slide 2 of 3: from memory");
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

test("progress survives a reload and comes back from the site; the next day starts with a warm-up", async ({ page }) => {
  const s = await open(page, "Progress test");
  await page.getByRole("button", { name: "Start" }).click();
  await pass(page, "Next slide");
  await expect(status(page)).toHaveText("Slide 2 of 3: from memory");
  await page.reload();
  await expect(page.getByTestId("learned")).toHaveText("1 of 2 slides learned");
  await expect(page.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  // this browser's copy gone: the online copy brings it back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("learned")).toHaveText("1 of 2 slides learned");
  await expect(page.getByTestId("from")).toHaveText("Start at slide 2: Flour and water.");

  // the next day: slide 1 was learned yesterday, so it is warmed up first, from the slide
  await page.evaluate((id) => {
    const key = `talk-trainer:${id}:flow:1:1`, yesterday = Date.now() - 24 * 3600 * 1000;
    localStorage.setItem(key, JSON.stringify({ step: 3, learned: true, at: yesterday, last: Date.now() + 1e6 }));
  }, s.talk.id);
  await page.reload();
  await expect(page.getByTestId("warm")).toHaveText("Warm up: 1 slide learned before today, each said once from the slide.");
  await expect(page.getByTestId("from")).toHaveText("Then new slides from slide 2: Flour and water.");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(status(page)).toHaveText("Warm up: slide 1 of 3: from memory");
  await pass(page, "Next");
  await expect(status(page)).toHaveText("Slide 2 of 3: from memory");
});

test("cards from the earlier trainer: a slide well known there counts as learned", async ({ page }) => {
  const s = await open(page, "Migration test");
  await page.evaluate(({ id, hashes }) => {
    hashes.forEach((h, i) => localStorage.setItem(`talk-trainer:${id}:train:1:${i + 1}:${h}`, JSON.stringify({ level: 2, last: 1 })));
    Object.keys(localStorage).filter((k) => k.includes(":flow:")).forEach((k) => localStorage.removeItem(k));
  }, { id: s.talk.id, hashes: s.slides[0].sentences.map((x) => x.hash) });
  await page.reload();
  await expect(page.getByTestId("learned")).toHaveText("1 of 2 slides learned");
  await expect(page.getByTestId("warm")).toHaveText("Warm up: 1 slide learned before today, each said once from the slide.");
});
