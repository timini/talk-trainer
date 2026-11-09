import { expect, test } from "@playwright/test";
import { signIn } from "./signin";
import { attempt, newTalk } from "./talk";

test("a session: Hear it plays the sentence, a card passes, and a restart fails one", async ({ page }) => {
  await signIn(page);
  const s = await newTalk(page, "Session test");
  await page.goto(`/talks/${s.talk.id}/train`);
  await expect(page.getByText("3 days to the talk")).toBeVisible();
  await expect(page.getByTestId("startinfo")).toHaveText("4 sentences, about 1 minute. 0 to review, 4 new.");
  await page.getByRole("button", { name: "Start today's session" }).click();

  await expect(page.getByTestId("kind")).toHaveText("New sentence");
  await expect(page.getByTestId("cue")).toHaveText("Good morning, and thank you for coming.");
  const clip = page.waitForRequest((r) => r.url().endsWith(s.slides[0].sentences[0].clip));
  await page.getByRole("button", { name: "Hear it" }).click();
  await clip;

  // the stand-in judge: word for word
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  await expect(page.getByTestId("verdict")).toContainText("Word for word.");
  await expect(page.locator(".feedback .heard")).toBeVisible();
  await expect(page.locator(".feedback .delivery")).toContainText("clarity 5 of 5, flow 5 of 5, pace good.");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // a judge that heard a restart
  await expect(page.getByTestId("cue")).toHaveText("Today we bake bread.");
  await page.route("**/api/grade", async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ json: { heard: "Today we today we bake bread.", verbatim: true, missed: [], stumbles: ["Today we today we"],
      clarity: 4, fluency: 2, pace: "good", tip: "Say it in one breath." } });
  });
  await attempt(page);
  await expect(page.getByTestId("judging")).toHaveText("The Gemini judge is listening to your attempt...");
  await expect(page.getByTestId("verdict")).toContainText("Missed");
  await expect(page.getByTestId("verdict")).toContainText('You restarted: "Today we today we". Say it in one smooth line.');
  await expect(page.locator(".feedback .tip")).toContainText("Say it in one breath.");
  await page.unroute("**/api/grade");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("status")).toHaveText("3 of 5"); // the missed card is due again

  // the rest, then the session is done; the missed card came back once
  for (let n = 0; n < 3; n += 1) {
    await attempt(page);
    await expect(page.getByTestId("verdict")).toContainText("Got it");
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("dsum")).toHaveText(/^5 cards: 4 got, 1 missed\./);
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

test("progress survives a reload, and a card with a verdict counts when the page goes away", async ({ page }) => {
  await signIn(page);
  const s = await newTalk(page, "Progress test");
  await page.goto(`/talks/${s.talk.id}/train`);
  await expect(page.getByTestId("today")).toHaveText("No cards yet today.");
  await page.getByRole("button", { name: "Start today's session" }).click();
  await attempt(page);
  await expect(page.getByTestId("verdict")).toContainText("Got it");
  // not marked yet: going away marks it and saves it online at once
  await page.reload();
  await expect(page.getByTestId("today")).toHaveText("Today: 1 card, 1 got (100%). Streak: 1 day in a row.");
  await expect(page.getByTestId("saved")).toHaveText(/^Saved in this browser and online/);
  // this browser's copy gone: the online copy brings it back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("today")).toHaveText("Today: 1 card, 1 got (100%). Streak: 1 day in a row.");
  await expect(page.getByTestId("startinfo")).toHaveText(/^3 sentences/);
});
