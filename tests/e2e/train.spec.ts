import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./signin";
import { attempt, newTalk } from "./talk";

// A judge that heard a restart, after a short wait.
const restart = (page: Page) => page.route("**/api/grade", async (route) => {
  await new Promise((r) => setTimeout(r, 600));
  await route.fulfill({ json: { heard: "Today we today we bake bread.", meaning_ok: true,
    problems: [{ kind: "stumble", script: "Today we", said: "Today we today we" }], clarity: 4, fluency: 2, pace: "good",
    tip: "Say it in one breath." } });
});
// A judge with a set verdict.
const verdict = (page: Page, json: Record<string, unknown>) => page.route("**/api/grade", (route) => route.fulfill({
  json: { clarity: 5, fluency: 5, pace: "good", tip: "Good.", ...json } }));
// The stand-in judge, but slow.
const slow = (page: Page) => page.route("**/api/grade", async (route) => {
  await new Promise((r) => setTimeout(r, 1500));
  await route.continue();
});

test("a session flows on without waiting: the strip follows the verdicts and a missed card comes back", async ({ page }) => {
  await signIn(page);
  const s = await newTalk(page, "Session test");
  await page.goto(`/talks/${s.talk.id}/train`);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByLabel("Wait for each verdict").uncheck();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("3 days to the talk")).toBeVisible();
  await expect(page.getByTestId("startinfo")).toHaveText("4 sentences, about 1 minute. 0 to review, 4 new.");
  await page.getByRole("button", { name: "Start today's session" }).click();

  await expect(page.getByTestId("kind")).toHaveText("New sentence");
  await expect(page.getByTestId("cue")).toHaveText("Good morning, and thank you for coming.");
  const clip = page.waitForRequest((r) => r.url().endsWith(s.slides[0].sentences[0].clip));
  await page.getByRole("button", { name: "Hear it" }).click();
  await clip;

  // the next card comes up at once; the stand-in judge passes the first in the background
  await attempt(page);
  await expect(page.getByTestId("cue")).toHaveText("Today we bake bread.");
  await expect(page.getByTestId("status")).toHaveText("2 of 4");
  await expect(page.getByTestId("strip")).toHaveText("Last: Got it");

  // a judge that heard a restart: checking, then missed, and the card is due again
  await restart(page);
  await attempt(page);
  await expect(page.getByTestId("cue")).toHaveText("Mix 500 grams of flour with 350 grams of water.");
  await expect(page.getByTestId("strip")).toHaveText("Last: checking...");
  await expect(page.getByTestId("strip")).toHaveText("Last: Missed, it will come back (a restart)");
  await expect(page.getByTestId("status")).toHaveText("3 of 5");
  await page.unroute("**/api/grade");
  // the full feedback for it, in a sheet
  await page.getByTestId("strip").click();
  const sheet = page.getByRole("dialog", { name: "The last card" });
  await expect(sheet).toContainText("You restarted: 'Today we today we'. Say it in one smooth line.");
  await expect(sheet.locator(".tip")).toHaveText("Tip: Say it in one breath.");
  await expect(sheet.getByRole("button", { name: "Count it as got" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();

  // the missed card comes back next: due cards come before new ones
  await attempt(page);
  await expect(page.getByTestId("cue")).toHaveText("Today we bake bread.");
  await expect(page.getByTestId("kind")).toHaveText("Review");
  await attempt(page);
  await expect(page.getByTestId("cue")).toHaveText("Let it rest for an hour.");
  // the last verdict is slow: the done screen waits for it
  await slow(page);
  await attempt(page);
  await expect(page.getByTestId("dsum")).toHaveText("Checking the last one...");
  await expect(page.getByTestId("dsum")).toHaveText(/^5 cards: 4 got, 1 missed\./, { timeout: 10000 });
});

test("a missed card counted as got from its sheet does not come back", async ({ page }) => {
  await signIn(page);
  const s = await newTalk(page, "Recount test");
  await page.goto(`/talks/${s.talk.id}/train`);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByLabel("Wait for each verdict").uncheck();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Start today's session" }).click();
  await restart(page);
  await attempt(page);
  await expect(page.getByTestId("strip")).toHaveText("Last: Missed, it will come back (a restart)");
  await expect(page.getByTestId("status")).toHaveText("2 of 5");
  await page.getByTestId("strip").click();
  await page.getByRole("dialog", { name: "The last card" }).getByRole("button", { name: "Count it as got" }).click();
  await expect(page.getByTestId("strip")).toHaveText("Last: Got it");
  await expect(page.getByTestId("status")).toHaveText("2 of 4");
});

test("with Wait for each verdict on, each card waits; the meaning judge passes small differences and marks only a left-out run", async ({ page }) => {
  await signIn(page);
  const s = await newTalk(page, "Wait test");
  await page.goto(`/talks/${s.talk.id}/train`);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByLabel("Wait for each verdict").check();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Start today's session" }).click();

  // an added "I": the meaning came through, nothing marked
  await verdict(page, { heard: "Good morning, and I thank you for coming.", meaning_ok: true, problems: [] });
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await expect(page.getByTestId("verdict")).toContainText("The meaning came through.");
  await expect(page.getByTestId("verdict")).toContainText("Small wording differences are fine.");
  await expect(page.locator(".cue .miss")).toHaveCount(0);
  await expect(page.locator(".feedback .delivery")).toContainText("clarity 5 of 5, flow 5 of 5, pace good.");
  await page.unroute("**/api/grade");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // a restart fails
  await restart(page);
  await attempt(page);
  await expect(page.getByTestId("judging")).toHaveText("The Gemini judge is listening to your attempt...");
  await expect(page.getByTestId("verdict")).toContainText("Missed");
  await expect(page.getByTestId("verdict")).toContainText("You restarted: 'Today we today we'. Say it in one smooth line.");
  await page.unroute("**/api/grade");
  await page.keyboard.press("Enter");
  // the missed card comes back at once
  await expect(page.getByTestId("kind")).toHaveText("Review");
  await expect(page.getByTestId("cue")).toHaveText(/^T/);
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await page.keyboard.press("Enter");

  // a left-out phrase: only its run is marked, not the same words earlier in the sentence
  await expect(page.getByTestId("cue")).toHaveText("Mix 500 grams of flour with 350 grams of water.");
  await verdict(page, { heard: "Mix 500 grams of flour.", meaning_ok: false,
    problems: [{ kind: "left_out", script: "with 350 grams of water" }] });
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Left out 'with 350 grams of water'.");
  await expect(page.locator(".cue .miss")).toHaveText(["with", "350", "grams", "of", "water."]);
  await page.unroute("**/api/grade");
  await page.keyboard.press("Enter");

  // it comes back too; a verdict on screen counts as marked when the page goes away
  await expect(page.getByTestId("kind")).toHaveText("Review");
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await page.reload();
  await expect(page.getByTestId("today")).toHaveText("Today: 5 cards, 3 got (60%). Streak: 1 day in a row.");
});

test("Hear it on a chain card plays the chain's clips in order", async ({ page }) => {
  await signIn(page);
  const s = await newTalk(page, "Chain test");
  const [a, b] = s.slides[0].sentences;
  await page.goto(`/talks/${s.talk.id}/train`);
  // the first sentence is at level 2 and not due, so the second is said as a chain from the slide's start
  await page.evaluate(([id, key]) => localStorage.setItem(`talk-trainer:${id}:${key}`, JSON.stringify(
    { level: 2, due: Date.now() + 1e9, streak: 2, lapses: 0, intro: Date.now(), acc: 1, last: Date.now() })),
  [s.talk.id, `train:1:1:${a.hash}`]);
  await page.reload();
  await page.getByRole("button", { name: "Start today's session" }).click();
  await expect(page.getByTestId("kind")).toHaveText("Say sentences 1 to 2 of this slide");
  const heard: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/files/clips/")) heard.push(new URL(r.url()).pathname); });
  await page.getByRole("button", { name: "Hear it" }).click();
  await expect.poll(() => heard.filter((u, i) => heard.indexOf(u) === i), { timeout: 10000 }).toEqual([a.clip, b.clip]);
});

test("progress survives a reload, and comes back from the site", async ({ page }) => {
  await signIn(page);
  const s = await newTalk(page, "Progress test");
  await page.goto(`/talks/${s.talk.id}/train`);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByLabel("Wait for each verdict").uncheck();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("today")).toHaveText("No cards yet today.");
  await page.getByRole("button", { name: "Start today's session" }).click();
  await attempt(page);
  await expect(page.getByTestId("strip")).toHaveText("Last: Got it");
  await page.reload();
  await expect(page.getByTestId("today")).toHaveText("Today: 1 card, 1 got (100%). Streak: 1 day in a row.");
  await expect(page.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  // this browser's copy gone: the online copy brings it back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("today")).toHaveText("Today: 1 card, 1 got (100%). Streak: 1 day in a row.");
  await expect(page.getByTestId("startinfo")).toHaveText(/^3 sentences/);
});
