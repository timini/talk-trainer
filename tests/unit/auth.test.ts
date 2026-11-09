import { describe, expect, test } from "vitest";
import { AGE, after, allowed, check, sign } from "@/lib/auth";

const NOW = Date.UTC(2026, 10, 9, 12);

describe("the sign-in cookie", () => {
  test("a cookie signed with the password checks out until it expires", async () => {
    const value = await sign("a test password", NOW);
    expect(value).toMatch(/^\d+\.[\w-]+$/);
    expect(await check(value, "a test password", NOW)).toBe(true);
    expect(await check(value, "a test password", NOW + AGE * 1000 - 1)).toBe(true);
    expect(await check(value, "a test password", NOW + AGE * 1000)).toBe(false);
  });

  test("another password, a changed expiry or signature, or junk do not", async () => {
    const value = await sign("a test password", NOW);
    const [expires, sig] = value.split(".");
    expect(await check(value, "another password", NOW)).toBe(false);
    expect(await check(`${Number(expires) + 1000}.${sig}`, "a test password", NOW)).toBe(false);
    expect(await check(`${expires}.${sig.slice(0, -1)}A`, "a test password", NOW)).toBe(false);
    for (const junk of ["", "x", `${expires}`, `${expires}.`, `.${sig}`, `${expires}.${sig}.x`, `-1.${sig}`]) {
      expect(await check(junk, "a test password", NOW), junk).toBe(false);
    }
    expect(await check(undefined, "a test password", NOW)).toBe(false);
  });

  test("with no password set, nothing checks out", async () => {
    const value = await sign("", NOW);
    expect(await check(value, "", NOW)).toBe(false);
    expect(await check(value, undefined, NOW)).toBe(false);
  });
});

describe("signing in", () => {
  test("the password must match exactly, and one must be set", () => {
    expect(allowed("a test password", "a test password")).toBe(true);
    expect(allowed("a test passwor", "a test password")).toBe(false);
    expect(allowed("", "")).toBe(false);
    expect(allowed("x", undefined)).toBe(false);
  });

  test("after signing in, only a path on this site is followed", () => {
    expect(after("/talks?x=1")).toBe("/talks?x=1");
    for (const next of [null, undefined, "", "https://example.com", "//example.com", "/\\example.com", "talks"]) {
      expect(after(next), String(next)).toBe("/");
    }
  });
});
