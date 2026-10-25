import { NextResponse } from "next/server";
import { attachSession, requireUser } from "@/lib/auth/server";
import { clientKey, recordCodeGuess, tooManyCodeGuesses } from "@/lib/auth/ratelimit";
import { describeOrg } from "@/lib/org-view";
import { AlreadyInOrgError, findOrgByCode, joinOrg, normalizeCode } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** A signed-in person enters a colleague's business code, joins that organization and moves into its shared workspace. */
export async function POST(request: Request) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  let body: { code?: unknown } = {};
  try { body = await request.json() as { code?: unknown }; } catch { /* handled below */ }
  const code = normalizeCode(body?.code);
  if (!code) return fail("invalid_code", 400);
  const key = `${clientKey(request)}|${user.id}`;
  if (tooManyCodeGuesses(key)) return fail("too_many_attempts", 429);
  try {
    const org = await findOrgByCode(code);
    if (!org) { recordCodeGuess(key); return fail("invalid_code", 404); }
    await joinOrg(user.id, org);
    const reply = NextResponse.json(await describeOrg({ ...user, org: org.id }));
    return await attachSession(reply, { id: user.id, email: user.email, name: user.name, org: org.id });
  } catch (error) {
    if (error instanceof AlreadyInOrgError) return fail("other_org", 409);
    console.error("Unable to join organization", error);
    return fail("server_error", 500);
  }
}
