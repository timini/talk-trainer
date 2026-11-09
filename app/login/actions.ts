"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AGE, after, allowed, COOKIE, sign } from "@/lib/auth";

export type State = { error: string } | null;

// Checks the password and, if it is right, sets the sign-in cookie and goes on to the page asked for.
export async function login(_: State, form: FormData): Promise<State> {
  const password = process.env.BETA_PASSWORD;
  if (!allowed(String(form.get("password") ?? ""), password)) return { error: "That password is not right." };
  (await cookies()).set(COOKIE, await sign(password as string, Date.now()), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: AGE,
  });
  redirect(after(String(form.get("next") ?? "")));
}
