import { expect, test } from "@playwright/test";
import { PASSWORD } from "../../playwright.config";

test("a visitor without the cookie is sent to the sign-in page, pages and API routes alike", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await expect(page.getByRole("heading", { name: "Talk Trainer" })).toBeVisible();
  const res = await request.get("/api/anything", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toMatch(/\/login\?next=%2Fapi%2Fanything$/);
});

test("a wrong password is refused, and the right one signs in with an httpOnly cookie", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText("That password is not right.");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("The trainer is coming")).toBeVisible();
  const [cookie] = (await context.cookies()).filter((c) => c.name === "beta");
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");

  // still signed in after a reload
  await page.reload();
  await expect(page.getByText("The trainer is coming")).toBeVisible();
});

test("a forged cookie does not get in", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "beta", value: `${Date.now() + 1e9}.forged`, url: baseURL as string }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
