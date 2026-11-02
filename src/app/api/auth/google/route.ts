import { NextResponse } from "next/server";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE, appOrigin, googleConfigured, packOAuthCookie, startGoogleSignIn } from "@/lib/auth/google";
import { safeNext } from "@/lib/auth/redirect";
import { assertSessionSecret } from "@/lib/auth/session";
import { clientKey, recordCodeGuess, tooManyCodeGuesses } from "@/lib/auth/ratelimit";
import { findOrgByCode, normalizeCode } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 1: send the browser to Google. Link to this with <a href="/api/auth/google?next=/">. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOrigin(url.origin);
  if (!googleConfigured()) return NextResponse.redirect(new URL("/login?error=google_unavailable", origin));
  // Fail before the trip to Google if the session cannot be signed; the callback would otherwise fail after the person has signed in there.
  try { assertSessionSecret(); } catch (error) { console.error("Google sign-in unavailable", error); return NextResponse.redirect(new URL("/login?error=google_failed", origin)); }
  // Institution sign-in: the business code travels in the (httpOnly) OAuth cookie and is checked again when Google sends the person back.
  const rawCode = url.searchParams.get("code");
  let orgCode = "";
  if (rawCode && rawCode.trim()) {
    const code = normalizeCode(rawCode);
    const key = clientKey(request);
    if (!code) return NextResponse.redirect(new URL("/login?error=invalid_code&tab=institution", origin));
    if (tooManyCodeGuesses(key)) return NextResponse.redirect(new URL("/login?error=too_many_attempts&tab=institution", origin));
    if (!(await findOrgByCode(code))) { recordCodeGuess(key); return NextResponse.redirect(new URL("/login?error=invalid_code&tab=institution", origin)); }
    orgCode = code;
  }
  const { url: googleUrl, state, verifier } = await startGoogleSignIn(origin);
  const response = NextResponse.redirect(googleUrl);
  response.cookies.set(OAUTH_COOKIE, packOAuthCookie(state, verifier, safeNext(url.searchParams.get("next")), orgCode), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return response;
}
