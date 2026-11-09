// Beta access: every page and API route sends a visitor without a signed sign-in cookie to /login.
import { NextResponse, type NextRequest } from "next/server";
import { check, COOKIE } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  if (await check(request.cookies.get(COOKIE)?.value, process.env.BETA_PASSWORD, Date.now())) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// Everything but Next's static files and the icon.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
