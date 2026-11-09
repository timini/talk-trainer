import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export type Script = { talk: { id: string }; slides: { n: number; sentences: { i: number; text: string; hash: string; clip: string }[] }[] };

// Uploads the fixture deck (or the deck given), waits for its build (stand-ins), sets the talk three days ahead, and
// returns its script.
export async function newTalk(page: Page, title: string, data: Buffer | Uint8Array = readFileSync("tests/fixtures/three-slides.pptx")): Promise<Script> {
  const res = await page.request.post("/api/talks", { data: Buffer.from(data),
    headers: { "Content-Type": "application/octet-stream", "X-Title": encodeURIComponent(title) } });
  expect(res.status()).toBe(201);
  const { id } = await res.json() as { id: string };
  // next dev may answer a first request while it is still compiling the route: such a reply counts as not ready yet
  await expect.poll(async () => {
    const res = await page.request.get(`/api/talks/${id}`);
    try { return ((await res.json()) as { status: string }).status; } catch { return `HTTP ${res.status()}, not JSON`; }
  }, { timeout: 30000 }).toBe("ready");
  await page.request.patch(`/api/talks/${id}`, { data: { talkAt: Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000 } });
  return await (await page.request.get(`/api/talks/${id}/script`)).json() as Script;
}

// Say an attempt: tap to speak, wait a moment, tap to stop.
export async function attempt(page: Page) {
  await page.getByRole("button", { name: "Tap to speak" }).click();
  const stop = page.getByRole("button", { name: "Tap to stop" });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(800);
  await stop.click();
}
