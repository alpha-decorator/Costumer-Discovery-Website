import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, appOrigin, completeGoogleSignIn, googleConfigured, unpackOAuthCookie } from "@/lib/auth/google";
import { safeNext } from "@/lib/auth/redirect";
import { attachSession } from "@/lib/auth/server";
import { claimOrphanInterviews } from "@/lib/interviews";
import { AlreadyInOrgError, findOrgByCode, joinOrg } from "@/lib/orgs";
import { createUser, findUserByEmail, findUserByGoogleSub, linkGoogleAccount, type User } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 2: Google sends the browser back here with a one-time code. */
export async function GET(request: NextRequest) {
  const origin = appOrigin(new URL(request.url).origin);
  const finish = (response: NextResponse) => { response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 }); return response; };
  const fail = (code: string) => finish(NextResponse.redirect(new URL(`/login?error=${code}${code === "invalid_code" || code === "other_org" ? "&tab=institution" : ""}`, origin)));

  const params = request.nextUrl.searchParams;
  if (!googleConfigured()) return fail("google_unavailable");
  if (params.get("error")) return fail("google_cancelled");
  const saved = unpackOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  if (!saved || !code || params.get("state") !== saved.state) return fail("google_failed");

  try {
    const profile = await completeGoogleSignIn(origin, code, saved.verifier);
    let user: User | null = await findUserByGoogleSub(profile.sub);
    if (!user) {
      const existing = await findUserByEmail(profile.email);
      if (existing) {
        await linkGoogleAccount(existing, profile.sub);
        user = existing;
      } else {
        const created = await createUser({ email: profile.email, name: profile.name, googleSub: profile.sub, emailVerified: true });
        if (created.isFirst) await claimOrphanInterviews(created.user.id);
        user = created.user;
      }
    }
    let orgId: string | null = null;
    if (saved.orgCode) {
      const org = await findOrgByCode(saved.orgCode);
      if (!org) return fail("invalid_code");
      try { await joinOrg(user.id, org); } catch (error) { if (error instanceof AlreadyInOrgError) return fail("other_org"); throw error; }
      orgId = org.id;
    }
    const response = NextResponse.redirect(new URL(safeNext(saved.next), origin));
    await attachSession(response, { id: user.id, email: user.email, name: user.name, org: orgId });
    return finish(response);
  } catch (error) {
    console.error("Google sign-in failed", error);
    return fail("google_failed");
  }
}
