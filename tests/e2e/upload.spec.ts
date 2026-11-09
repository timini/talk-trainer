import { expect, test } from "@playwright/test";
import { signIn } from "./signin";

test("upload a deck and watch its build finish", async ({ page }) => {
  await signIn(page, "/talks");
  await expect(page).toHaveURL(/\/talks$/);
  const title = `Bread ${test.info().project.name} ${Date.now()}`;
  await page.getByLabel(/^Deck/).setInputFiles("tests/fixtures/three-slides.pptx");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Upload" }).click();

  const row = page.getByTestId("talk").filter({ hasText: title });
  await expect(row.locator(".status")).toHaveText("Ready: 3 slides, 4 sentences", { timeout: 30000 });
  await expect(row).toContainText("Slides with no notes (no script): 3");

  // the slide images are served behind the sign-in
  const { talks } = await (await page.request.get("/api/talks")).json() as { talks: { id: string; title: string }[] };
  const id = talks.find((t) => t.title === title)!.id;
  const image = await page.request.get(`/api/files/talks/${id}/slides/2.png`);
  expect([image.status(), image.headers()["content-type"]]).toEqual([200, "image/png"]);
  const missing = await page.request.get(`/api/files/talks/${id}/slides/9.png`);
  expect(missing.status()).toBe(404);
});

test("a file that is not a deck is refused", async ({ page }) => {
  await signIn(page, "/talks");
  await page.getByLabel(/^Deck/).setInputFiles({ name: "notes.pptx", mimeType: "text/plain", buffer: Buffer.from("just text") });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator(".error[role=alert]")).toHaveText("That file is not a .pptx deck.");
});
