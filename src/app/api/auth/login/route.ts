import { NextResponse } from "next/server";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { attachSession, isSameOrigin } from "@/lib/auth/server";
import { assertSessionSecret } from "@/lib/auth/session";
import { clientKey, recordCodeGuess, tooManyCodeGuesses } from "@/lib/auth/ratelimit";
import { AlreadyInOrgError, findOrgByCode, joinOrg, normalizeCode } from "@/lib/orgs";
import { validateLogin } from "@/lib/auth/validate";
import { clearFailedLogins, findUserByEmail, recordFailedLogin } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }
  const parsed = validateLogin(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.error === "invalid_credentials" ? 401 : 400 });
  const { email, password } = parsed.value;
  // "Sign in with a business code": the same account check as always, then the person lands in their organization's shared workspace.
  const rawCode = (body as { code?: unknown }).code;
  const wantsOrg = typeof rawCode === "string" && rawCode.trim() !== "";
  const code = wantsOrg ? normalizeCode(rawCode) : null;
  if (wantsOrg && !code) return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  try {
    // Without a usable AUTH_SECRET the session cannot be signed, so fail here with the reason logged rather than after the password check.
    assertSessionSecret();
    const user = await findUserByEmail(email);
    if (user && user.lockedUntil > Date.now()) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
    // Accounts created with Google have no password; they and unknown emails get the same slow check and the same answer.
    const valid = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
    if (!user || !valid) {
      if (user?.passwordHash) await recordFailedLogin(user);
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    let orgId: string | null = null;
    if (code) {
      // A wrong code with a right password still counts as a failed attempt, so a stolen password cannot be used to guess codes for ever.
      const key = `${clientKey(request)}|${user.id}`;
      if (tooManyCodeGuesses(key)) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
      const org = await findOrgByCode(code);
      if (!org) { recordCodeGuess(key); await recordFailedLogin(user); return NextResponse.json({ error: "invalid_code" }, { status: 404 }); }
      try { await joinOrg(user.id, org); } catch (error) {
        if (error instanceof AlreadyInOrgError) return NextResponse.json({ error: "other_org" }, { status: 409 });
        throw error;
      }
      orgId = org.id;
    }
    await clearFailedLogins(user);
    return await attachSession(NextResponse.json({ ok: true, org: orgId !== null, preferences: user.preferences }), { id: user.id, email: user.email, name: user.name, org: orgId });
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
