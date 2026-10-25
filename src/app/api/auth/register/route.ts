import { NextResponse } from "next/server";
import { claimOrphanInterviews } from "@/lib/interviews";
import { hashPassword } from "@/lib/auth/password";
import { attachSession, isSameOrigin } from "@/lib/auth/server";
import { clientKey, recordCodeGuess, tooManyCodeGuesses } from "@/lib/auth/ratelimit";
import { CodeTakenError, createOrg, defaultOrgName, findOrgByCode, generateCode, joinOrg, normalizeCode, validateOrgName } from "@/lib/orgs";
import { validateRegistration } from "@/lib/auth/validate";
import { EmailTakenError, createUser } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }
  const parsed = validateRegistration(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, email, password } = parsed.value;
  // An optional business code at sign-up: checked first, so a wrong code never leaves a half-made account behind.
  const rawCode = (body as { code?: unknown }).code;
  const code = typeof rawCode === "string" && rawCode.trim() !== "" ? normalizeCode(rawCode) : null;
  if (typeof rawCode === "string" && rawCode.trim() !== "" && !code) return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  // "Create my business": the new account becomes the owner of a new organization with a freshly generated code.
  const { newBusiness, businessName } = body as { newBusiness?: unknown; businessName?: unknown };
  const makeBusiness = newBusiness === true;
  if (makeBusiness && code) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const blankBusinessName = businessName === undefined || businessName === null || (typeof businessName === "string" && businessName.trim() === "");
  const orgName = makeBusiness ? (blankBusinessName ? defaultOrgName(name) : validateOrgName(businessName)) : null;
  if (makeBusiness && !orgName) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  try {
    let orgId: string | null = null;
    if (code) {
      const key = clientKey(request);
      if (tooManyCodeGuesses(key)) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
      const org = await findOrgByCode(code);
      if (!org) { recordCodeGuess(key); return NextResponse.json({ error: "invalid_code" }, { status: 404 }); }
      orgId = org.id;
    }
    // Password sign-ups are not email-verified (verification needs an email service). See linkGoogleAccount for how that is handled.
    const { user, isFirst } = await createUser({ email, name, passwordHash: await hashPassword(password), emailVerified: false });
    if (isFirst) await claimOrphanInterviews(user.id);
    if (orgId) { const org = await findOrgByCode(code!); if (org) await joinOrg(user.id, org); else orgId = null; }
    let createdCode: string | null = null, businessFailed = false;
    if (makeBusiness && orgName) {
      try {
        for (let attempt = 0; attempt < 6 && !orgId; attempt++) {
          try { const org = await createOrg({ name: orgName, code: generateCode(), ownerId: user.id }); orgId = org.id; createdCode = org.code; }
          catch (error) { if (!(error instanceof CodeTakenError)) throw error; }
        }
        if (!orgId) businessFailed = true;
      } catch (error) {
        // The account exists, so the person is signed in personally and can create the business from the Business code screen.
        console.error("Unable to create the business during sign-up", error);
        businessFailed = true;
      }
    }
    return await attachSession(NextResponse.json({ ok: true, org: orgId !== null, ...(createdCode ? { code: createdCode } : {}), ...(businessFailed ? { businessFailed: true } : {}) }, { status: 201 }),
      { id: user.id, email: user.email, name: user.name, org: orgId });
  } catch (error) {
    if (error instanceof EmailTakenError) return NextResponse.json({ error: "email_taken" }, { status: 409 });
    console.error("Unable to register account", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
