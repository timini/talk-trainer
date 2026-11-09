// Beta access: one shared password and no accounts. A right password gets a cookie holding its expiry time and an
// HMAC of it, keyed from the password, so changing BETA_PASSWORD signs everyone out.

import { same } from "./judge";

export const COOKIE = "beta";
// How long a sign-in lasts, in seconds.
export const AGE = 30 * 24 * 60 * 60;

const bytes = (text: string) => new TextEncoder().encode(text);
const base64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The signing key: an HMAC key made from a hash of the password, so the password itself is never the key.
const key = async (password: string) => crypto.subtle.importKey("raw",
  await crypto.subtle.digest("SHA-256", bytes(`talk-trainer beta cookie:${password}`)),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

const mac = async (password: string, expires: number) =>
  base64url(await crypto.subtle.sign("HMAC", await key(password), bytes(`beta:${expires}`)));

// The cookie value for a sign-in at now (ms): "<expiry in ms>.<signature>".
export const sign = async (password: string, now: number): Promise<string> => {
  const expires = now + AGE * 1000;
  return `${expires}.${await mac(password, expires)}`;
};

// Whether a cookie value is one this password signed and has not expired. No password set lets no one in.
export const check = async (value: string | undefined, password: string | undefined, now: number): Promise<boolean> => {
  if (!value || !password) return false;
  const m = /^(\d+)\.([\w-]+)$/.exec(value);
  if (!m || Number(m[1]) <= now) return false;
  return same(m[2], await mac(password, Number(m[1])));
};

// Whether the password given at sign-in is the beta password. No password set lets no one in.
export const allowed = (given: string, password: string | undefined): boolean => !!password && same(given, password);

// Where to go after signing in: a path on this site, or the home page.
export const after = (next: string | null | undefined): string =>
  (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
