import type { Page } from "@playwright/test";
import { PASSWORD } from "../../playwright.config";

export async function signIn(page: Page, path = "/") {
  await page.goto(path);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
